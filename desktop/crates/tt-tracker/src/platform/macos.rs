//! macOS-capture.
//!
//! - Forgrundsprogram: Tilgængeligheds-API'et (det fokuserede program og
//!   vindue), med `CGWindowListCopyWindowInfo` som fallback uden tilladelse.
//! - Titel: `AXTitle` på det fokuserede vindue; ellers `kCGWindowName`, som
//!   kræver Skærmoptagelse.
//! - Dokument/mappe: `AXDocument` (Terminal.app sætter den til cwd; Xcode,
//!   Pages, Word, Preview og TextEdit til filen).
//! - Idle: `CGEventSourceSecondsSinceLastEventType` for alle inputtyper.
//! - URL: AppleScript til Safari, Chrome, Arc, Edge, Brave, Vivaldi, Opera og
//!   Chromium. Firefox har ingen AppleScript-URL og giver `None`.
//! - Terminal: Terminal.app via `AXDocument`, iTerm2 via AppleScript.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::time::Duration;

use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_graphics::{
    CGEventSource, CGEventSourceStateID, CGEventType, CGWindowListCopyWindowInfo,
    CGWindowListOption, kCGNullWindowID, kCGWindowLayer, kCGWindowName, kCGWindowNumber,
    kCGWindowOwnerName, kCGWindowOwnerPID,
};

use super::Platform;
use crate::types::{BrowserUrl, RawWindow};
use crate::util::run_with_timeout;

type AXUIElementRef = *const c_void;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: *const CFString,
        value: *mut *const c_void,
    ) -> i32;
    fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> i32;
    fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout_secs: f32) -> i32;
}

unsafe extern "C" {
    // libproc (libSystem): fuld sti til en proces' binær.
    fn proc_pidpath(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
}

/// AppleScript-svar må aldrig holde poll-løkken.
const SCRIPT_TIMEOUT: Duration = Duration::from_millis(1500);
/// AX-kald mod et hængende program.
const AX_TIMEOUT_SECS: f32 = 0.25;

pub struct MacPlatform;

impl MacPlatform {
    pub fn new() -> Self {
        MacPlatform
    }
}

impl Platform for MacPlatform {
    fn foreground(&mut self) -> Option<RawWindow> {
        let cg = cg_front_window();
        let ax = if unsafe { AXIsProcessTrusted() } {
            ax_focused()
        } else {
            None
        };

        let (pid, ax_title, document, accessibility_hints) = match ax {
            Some(a) => (Some(a.pid), a.title, a.document, a.hints),
            None => (cg.as_ref().map(|c| c.pid), None, None, Vec::new()),
        };
        let pid = pid?;
        // CG-listens vindue hører kun til, hvis det er samme proces.
        let cg_same = cg.filter(|c| c.pid == pid);
        let exe_path = exe_path(pid).unwrap_or_default();
        let app_name = cg_same
            .as_ref()
            .map(|c| c.owner_name.clone())
            .filter(|n| !n.is_empty())
            .or_else(|| super::app_bundle_name(&exe_path))
            .unwrap_or_else(|| super::app_name_from_exe(&exe_path));
        let window_id = cg_same.as_ref().and_then(|c| c.number);
        let title = ax_title
            .filter(|t| !t.is_empty())
            .or_else(|| cg_same.and_then(|c| c.title))
            .unwrap_or_default();
        Some(RawWindow {
            app_name,
            exe_path,
            pid: Some(pid as u32),
            window_id,
            title,
            document,
            accessibility_hints,
        })
    }

    fn idle_seconds(&mut self) -> u64 {
        // kCGAnyInputEventType = ~0
        let secs = CGEventSource::seconds_since_last_event_type(
            CGEventSourceStateID::CombinedSessionState,
            CGEventType(u32::MAX),
        );
        if secs.is_finite() && secs > 0.0 {
            secs as u64
        } else {
            0
        }
    }

    fn browser_url(&mut self, w: &RawWindow) -> BrowserUrl {
        let Some(lines) = browser_script(&super::app_id(&w.exe_path, &w.app_name)) else {
            return BrowserUrl::Unknown;
        };
        parse_script_answer(osascript_lines(&lines))
    }

    fn terminal_cwd(&mut self, w: &RawWindow) -> Option<String> {
        let id = super::app_id(&w.exe_path, &w.app_name);
        if id == "terminal" {
            // Terminal.app sætter AXDocument til fanens cwd (OSC 7, standard
            // i macOS' zsh-opsætning).
            return w
                .document
                .as_deref()
                .and_then(crate::paths::path_from_file_uri);
        }
        if id.starts_with("iterm") {
            return osascript(
                "tell application \"iTerm2\" to tell current session of current window to get variable named \"path\"",
            )
            .filter(|p| crate::paths::looks_absolute(p));
        }
        None
    }
}

/// Svar fra scriptet, når browseren selv siger, vinduet er privat.
const PRIVATE_MARKER: &str = "TT-PRIVATE";

/// AppleScript-linjer, der returnerer den aktive fanes URL, pr. browser.
///
/// Chromium-browsere skriver ikke "Incognito" i vinduestitlen på macOS, så
/// titel-heuristikken fanger dem ikke. Scriptet spørger derfor browseren om
/// vinduets `mode` først. Kender browseren ikke egenskaben (Arc), fanges fejlen
/// af `try`, og URL'en læses som normalt.
///
/// Safari har ingen AppleScript-egenskab for private vinduer; se RAPPORT.md.
pub(crate) fn browser_script(app_id: &str) -> Option<Vec<String>> {
    let chromium = |name: &str| {
        vec![
            format!("tell application \"{name}\""),
            "try".to_string(),
            format!("if mode of front window is \"incognito\" then return \"{PRIVATE_MARKER}\""),
            "end try".to_string(),
            "return URL of active tab of front window".to_string(),
            "end tell".to_string(),
        ]
    };
    let safari = |name: &str| {
        vec![format!(
            "tell application \"{name}\" to get URL of front document"
        )]
    };
    Some(match app_id {
        "safari" => safari("Safari"),
        "safari technology preview" => safari("Safari Technology Preview"),
        "google chrome" => chromium("Google Chrome"),
        "google chrome beta" => chromium("Google Chrome Beta"),
        "chromium" => chromium("Chromium"),
        "arc" => chromium("Arc"),
        "microsoft edge" => chromium("Microsoft Edge"),
        "brave browser" => chromium("Brave Browser"),
        "vivaldi" => chromium("Vivaldi"),
        "opera" => chromium("Opera"),
        _ => return None,
    })
}

pub(crate) fn parse_script_answer(answer: Option<String>) -> BrowserUrl {
    match answer {
        Some(a) if a.trim() == PRIVATE_MARKER => BrowserUrl::Private,
        Some(a) if !a.trim().is_empty() && a.trim() != "missing value" => BrowserUrl::Url(a),
        _ => BrowserUrl::Unknown,
    }
}

fn osascript(script: &str) -> Option<String> {
    osascript_lines(&[script.to_string()])
}

fn osascript_lines(lines: &[String]) -> Option<String> {
    let mut cmd = std::process::Command::new("/usr/bin/osascript");
    for l in lines {
        cmd.arg("-e").arg(l);
    }
    run_with_timeout(cmd, SCRIPT_TIMEOUT)
}

struct CgWindow {
    pid: i32,
    number: Option<u64>,
    owner_name: String,
    title: Option<String>,
}

/// Første normale vindue (lag 0) i front-til-bag-rækkefølge.
fn cg_front_window() -> Option<CgWindow> {
    let opts = CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
    let list: CFRetained<CFArray> = CGWindowListCopyWindowInfo(opts, kCGNullWindowID)?;
    let count = list.count();
    for i in 0..count {
        // SAFETY: elementerne i vinduelisten er CFDictionary'er, som listen ejer.
        let dict = unsafe { list.value_at_index(i) } as *const CFDictionary;
        let Some(dict) = (unsafe { dict.as_ref() }) else {
            continue;
        };
        let layer = dict_number(dict, unsafe { kCGWindowLayer }).unwrap_or(-1);
        if layer != 0 {
            continue;
        }
        let Some(pid) = dict_number(dict, unsafe { kCGWindowOwnerPID }) else {
            continue;
        };
        let owner_name = dict_string(dict, unsafe { kCGWindowOwnerName }).unwrap_or_default();
        let title = dict_string(dict, unsafe { kCGWindowName }).filter(|t| !t.is_empty());
        let number = dict_number(dict, unsafe { kCGWindowNumber }).map(|n| n as u64);
        return Some(CgWindow {
            pid: pid as i32,
            number,
            owner_name,
            title,
        });
    }
    None
}

fn dict_value<'a>(dict: &'a CFDictionary, key: &CFString) -> Option<&'a CFType> {
    // SAFETY: nøglen er en gyldig CFString; værdien ejes af ordbogen.
    let v = unsafe { dict.value((key as *const CFString).cast()) } as *const CFType;
    unsafe { v.as_ref() }
}

fn dict_number(dict: &CFDictionary, key: &CFString) -> Option<i64> {
    dict_value(dict, key)?.downcast_ref::<CFNumber>()?.as_i64()
}

fn dict_string(dict: &CFDictionary, key: &CFString) -> Option<String> {
    Some(
        dict_value(dict, key)?
            .downcast_ref::<CFString>()?
            .to_string(),
    )
}

struct AxFocus {
    pid: i32,
    title: Option<String>,
    document: Option<String>,
    /// AXIdentifier, AXDescription og AXSubrole på vinduet (til at genkende
    /// private browservinduer, når titlen intet siger).
    hints: Vec<String>,
}

/// Wrapper, der frigiver et AX-element.
struct Ax(CFRetained<CFType>);

impl Ax {
    fn from_create(ptr: AXUIElementRef) -> Option<Self> {
        let nn = NonNull::new(ptr as *mut CFType)?;
        // SAFETY: Create-funktioner returnerer et +1-objekt, som vi nu ejer.
        Some(Ax(unsafe { CFRetained::from_raw(nn) }))
    }

    fn raw(&self) -> AXUIElementRef {
        CFRetained::as_ptr(&self.0).as_ptr() as AXUIElementRef
    }

    fn attr(&self, name: &str) -> Option<CFRetained<CFType>> {
        let key = CFString::from_str(name);
        let mut out: *const c_void = std::ptr::null();
        // SAFETY: gyldigt element og nøgle; Copy-funktionen giver +1 på out.
        let err = unsafe { AXUIElementCopyAttributeValue(self.raw(), &*key, &mut out) };
        if err != 0 {
            return None;
        }
        let nn = NonNull::new(out as *mut CFType)?;
        Some(unsafe { CFRetained::from_raw(nn) })
    }

    fn attr_element(&self, name: &str) -> Option<Ax> {
        self.attr(name).map(Ax)
    }

    fn attr_string(&self, name: &str) -> Option<String> {
        let v = self.attr(name)?;
        v.downcast_ref::<CFString>().map(|s| s.to_string())
    }
}

fn ax_focused() -> Option<AxFocus> {
    let system = Ax::from_create(unsafe { AXUIElementCreateSystemWide() })?;
    unsafe { AXUIElementSetMessagingTimeout(system.raw(), AX_TIMEOUT_SECS) };
    let app = system.attr_element("AXFocusedApplication")?;
    let mut pid: i32 = 0;
    if unsafe { AXUIElementGetPid(app.raw(), &mut pid) } != 0 || pid <= 0 {
        return None;
    }
    // Et nyt element pr. app, så timeouten også gælder dens vinduer.
    let app = Ax::from_create(unsafe { AXUIElementCreateApplication(pid) }).unwrap_or(app);
    unsafe { AXUIElementSetMessagingTimeout(app.raw(), AX_TIMEOUT_SECS) };
    let window = app
        .attr_element("AXFocusedWindow")
        .or_else(|| app.attr_element("AXMainWindow"));
    let (title, document) = match &window {
        Some(w) => (w.attr_string("AXTitle"), w.attr_string("AXDocument")),
        None => (None, None),
    };
    let hints = window
        .as_ref()
        .map(|w| {
            ["AXIdentifier", "AXDescription", "AXSubrole"]
                .iter()
                .filter_map(|a| w.attr_string(a))
                .collect()
        })
        .unwrap_or_default();
    Some(AxFocus {
        pid,
        title,
        document,
        hints,
    })
}

fn exe_path(pid: i32) -> Option<String> {
    let mut buf = vec![0u8; 4096];
    // SAFETY: bufferen er 4096 bytes (PROC_PIDPATHINFO_MAXSIZE).
    let n = unsafe { proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
    if n <= 0 {
        return None;
    }
    buf.truncate(n as usize);
    String::from_utf8(buf).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_scripts_cover_spec_browsers() {
        for id in [
            "safari",
            "google chrome",
            "arc",
            "microsoft edge",
            "brave browser",
            "vivaldi",
            "opera",
        ] {
            assert!(browser_script(id).is_some(), "{id}");
        }
        // Chromium-familien læser den aktive fane og springer private vinduer over.
        for (id, app) in [("vivaldi", "Vivaldi"), ("opera", "Opera"), ("arc", "Arc"), ("brave browser", "Brave Browser")] {
            let s = browser_script(id).unwrap().join("\n");
            assert!(s.contains(&format!("tell application \"{app}\"")), "{id}");
            assert!(s.contains("URL of active tab of front window"), "{id}");
            assert!(s.contains("incognito"), "{id}");
        }
        assert!(browser_script("firefox").is_none());
        let chrome = browser_script("google chrome").unwrap().join("\n");
        assert!(chrome.contains("tell application \"Google Chrome\""));
        assert!(chrome.contains("mode of front window is \"incognito\""));
        assert!(chrome.contains("URL of active tab of front window"));
        // Hver browser taler kun til sig selv (STP må aldrig starte Safari).
        let stp = browser_script("safari technology preview")
            .unwrap()
            .join("\n");
        assert!(stp.contains("\"Safari Technology Preview\""));
        assert!(
            !browser_script("safari")
                .unwrap()
                .join("\n")
                .contains("Preview")
        );
    }

    #[test]
    fn script_answers_map_to_browser_url() {
        assert_eq!(
            parse_script_answer(Some("TT-PRIVATE".into())),
            BrowserUrl::Private
        );
        assert_eq!(
            parse_script_answer(Some("https://a.dk/".into())),
            BrowserUrl::Url("https://a.dk/".into())
        );
        assert_eq!(
            parse_script_answer(Some("missing value".into())),
            BrowserUrl::Unknown
        );
        assert_eq!(parse_script_answer(None), BrowserUrl::Unknown);
    }

    /// Kører den rigtige `osascript` med et script uden app (ingen
    /// Automatiserings-dialog), så flerlinjeformen er afprøvet.
    #[test]
    fn multiline_osascript_runs() {
        let lines = vec![
            "try".to_string(),
            "error \"x\"".to_string(),
            "end try".to_string(),
            "return \"ok\"".to_string(),
        ];
        assert_eq!(osascript_lines(&lines).as_deref(), Some("ok"));
        assert_eq!(osascript("return \"hej\"").as_deref(), Some("hej"));
    }

    /// Kører de rigtige API'er; må aldrig gå i stå eller panikke, heller ikke
    /// uden tilladelser (CI).
    #[test]
    fn native_calls_do_not_panic() {
        let mut p = MacPlatform::new();
        let _ = p.idle_seconds();
        let _ = p.foreground();
        assert!(exe_path(std::process::id() as i32).is_some());
    }
}
