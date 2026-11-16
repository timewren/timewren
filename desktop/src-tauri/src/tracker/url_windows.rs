//! Browser address-bar URL capture via Windows UI Automation.
//!
//! The tracker's poll loop runs in a tokio async task where execution can hop
//! between OS threads across awaits — but a COM apartment is per-thread. All
//! UIA work therefore happens on ONE dedicated `std::thread` that calls
//! `CoInitializeEx` once and reuses a single `IUIAutomation` instance. The
//! poll loop talks to it via an mpsc request/response pair with a short
//! timeout so a slow UIA tree walk can never stall tracking.
//!
//! Privacy: values are normalized before they leave this module — the query
//! string and fragment are stripped (scheme + host + path only), and anything
//! that does not look like a real http(s) URL (search text, placeholder text
//! like "Søg eller indtast webadresse", internal chrome:// pages, file://
//! paths) is discarded.

use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use windows::core::VARIANT;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationValuePattern, TreeScope_Descendants,
    UIA_ControlTypePropertyId, UIA_EditControlTypeId, UIA_IsValuePatternAvailablePropertyId,
    UIA_ValuePatternId, UIA_ValueValuePropertyId,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

/// How long the poll loop waits for the UIA worker before giving up.
/// The result is cached by the caller, so a missed probe is retried later.
const PROBE_TIMEOUT: Duration = Duration::from_millis(250);

/// Upper bound on Edit controls inspected per probe. The address bar is part
/// of the browser chrome and appears early in tree order; web-page inputs
/// further down must not turn one probe into a full-page tree walk.
const MAX_EDIT_CANDIDATES: i32 = 10;

/// A request for the UIA worker thread: probe this window handle and send the
/// normalized URL (or `None`) back on `respond`.
struct UrlRequest {
    hwnd: isize,
    respond: mpsc::Sender<Option<String>>,
}

/// Lazily spawned singleton worker. The `Mutex` only guards cloning the
/// sender (`mpsc::Sender` is not `Sync` on older toolchains).
static WORKER: OnceLock<Mutex<mpsc::Sender<UrlRequest>>> = OnceLock::new();

fn worker_sender() -> mpsc::Sender<UrlRequest> {
    WORKER
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel::<UrlRequest>();
            // If the spawn fails the receiver is dropped and every send fails,
            // which callers already treat as "no URL".
            let _ = std::thread::Builder::new()
                .name("uia-url-probe".into())
                .spawn(move || worker_loop(rx));
            Mutex::new(tx)
        })
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
}

/// Runs on the dedicated UIA thread: initializes COM once, creates one
/// `IUIAutomation` instance, and serves probe requests until the app exits.
fn worker_loop(rx: mpsc::Receiver<UrlRequest>) {
    // MTA is the recommended apartment for UIA clients. The HRESULT is
    // intentionally ignored: RPC_E_CHANGED_MODE would only occur if someone
    // else initialized this brand-new thread, which cannot happen.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let automation: Option<IUIAutomation> =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok() };

    while let Ok(req) = rx.recv() {
        let url = automation
            .as_ref()
            .and_then(|a| read_address_bar(a, req.hwnd));
        // The receiver may have timed out and gone away — that is fine.
        let _ = req.respond.send(url);
    }
}

/// Probes the current foreground window for a browser URL.
///
/// Non-blocking beyond `PROBE_TIMEOUT`; returns `None` when the foreground
/// window is gone, the worker is busy, or no URL-looking address bar exists.
pub fn probe_foreground_browser_url() -> Option<String> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    probe_window_url(hwnd.0 as isize, PROBE_TIMEOUT)
}

/// Probes a specific window handle. Used by `probe_foreground_browser_url`
/// and by the manual verification test (which finds the browser HWND itself,
/// so the window does not need to be foreground).
pub fn probe_window_url(hwnd: isize, timeout: Duration) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    worker_sender().send(UrlRequest { hwnd, respond: tx }).ok()?;
    rx.recv_timeout(timeout).ok().flatten()
}

/// Finds the address bar inside a browser window and returns its normalized
/// value, if it looks like a URL.
///
/// Locale note: this matches on ControlType `Edit` + ValuePattern — NEVER on
/// control names ("Address and search bar"), which are locale-dependent
/// (Danish Chrome calls it "Adresse- og søgelinje").
fn read_address_bar(automation: &IUIAutomation, hwnd: isize) -> Option<String> {
    unsafe {
        let element = automation
            .ElementFromHandle(HWND(hwnd as *mut core::ffi::c_void))
            .ok()?;

        let is_edit = automation
            .CreatePropertyCondition(
                UIA_ControlTypePropertyId,
                &VARIANT::from(UIA_EditControlTypeId.0),
            )
            .ok()?;
        let has_value = automation
            .CreatePropertyCondition(UIA_IsValuePatternAvailablePropertyId, &VARIANT::from(true))
            .ok()?;
        let condition = automation.CreateAndCondition(&is_edit, &has_value).ok()?;

        // Cache the ValuePattern + its value in the same cross-process round
        // trip as the search, so reading each candidate costs no extra IPC.
        let cache = automation.CreateCacheRequest().ok()?;
        cache.AddPattern(UIA_ValuePatternId).ok()?;
        cache.AddProperty(UIA_ValueValuePropertyId).ok()?;

        let found = element
            .FindAllBuildCache(TreeScope_Descendants, &condition, &cache)
            .ok()?;
        let len = found.Length().ok()?;

        for i in 0..len.min(MAX_EDIT_CANDIDATES) {
            let Ok(el) = found.GetElement(i) else {
                continue;
            };
            let Ok(pattern) = el.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            else {
                continue;
            };
            let Ok(value) = pattern.CachedValue() else {
                continue;
            };
            if let Some(url) = normalize_url(&value.to_string()) {
                return Some(url);
            }
        }
        None
    }
}

/// Case-insensitive ASCII prefix strip (URL schemes are ASCII).
fn strip_prefix_ignore_case<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    if head.eq_ignore_ascii_case(prefix) {
        s.get(prefix.len()..)
    } else {
        None
    }
}

/// True if `host` (optionally `host:port`) is a plausible internet hostname.
fn is_plausible_host(host: &str) -> bool {
    let (name, port) = match host.split_once(':') {
        Some((n, p)) => (n, Some(p)),
        None => (host, None),
    };
    if let Some(p) = port {
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    if !name.contains('.') || name.starts_with('.') || name.ends_with('.') || name.contains("..") {
        return false;
    }
    // `is_alphanumeric` (not ascii) keeps IDN hosts like "æblegrød.dk" valid.
    name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.')
}

/// Normalizes a raw address-bar value into a privacy-reduced URL, or `None`
/// if the value does not look like one.
///
/// - Accepts only http(s); other schemes (file://, chrome://, about:) are
///   internal pages or potentially sensitive local paths.
/// - Prefixes `https://` when the browser hides the scheme.
/// - Strips the query string and fragment: scheme + host + path only.
pub(crate) fn normalize_url(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 2048 || s.chars().any(char::is_whitespace) {
        return None;
    }

    let (scheme, rest) = if let Some(r) = strip_prefix_ignore_case(s, "https://") {
        ("https://", r)
    } else if let Some(r) = strip_prefix_ignore_case(s, "http://") {
        ("http://", r)
    } else if s.contains("://") {
        return None; // non-http scheme (file://, chrome://, ...)
    } else {
        ("https://", s)
    };

    // Privacy: drop everything from the first '?' or '#'.
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    if rest.is_empty() {
        return None;
    }

    let host = rest.split('/').next().unwrap_or("");
    if !is_plausible_host(host) {
        return None;
    }

    Some(format!("{scheme}{rest}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // normalize_url — validation + privacy normalization
    // -----------------------------------------------------------------------

    #[test]
    fn strips_query_string_and_fragment() {
        assert_eq!(
            normalize_url("https://example.com/path?q=hemmelig&token=abc#afsnit"),
            Some("https://example.com/path".to_string())
        );
        assert_eq!(
            normalize_url("https://a.dk/x#section"),
            Some("https://a.dk/x".to_string())
        );
        assert_eq!(
            normalize_url("https://a.dk/?utm_source=x"),
            Some("https://a.dk/".to_string())
        );
    }

    #[test]
    fn prefixes_https_when_scheme_hidden() {
        // Browsers often display the URL without a scheme.
        assert_eq!(
            normalize_url("example.com/foo"),
            Some("https://example.com/foo".to_string())
        );
        assert_eq!(
            normalize_url("github.com"),
            Some("https://github.com".to_string())
        );
    }

    #[test]
    fn keeps_explicit_http_scheme() {
        assert_eq!(
            normalize_url("http://site.dk/a"),
            Some("http://site.dk/a".to_string())
        );
        assert_eq!(
            normalize_url("HTTPS://Example.com/A"),
            Some("https://Example.com/A".to_string())
        );
    }

    #[test]
    fn accepts_host_with_port_and_idn() {
        assert_eq!(
            normalize_url("test.local:8080/x"),
            Some("https://test.local:8080/x".to_string())
        );
        assert_eq!(
            normalize_url("æblegrød.dk/opskrift"),
            Some("https://æblegrød.dk/opskrift".to_string())
        );
    }

    #[test]
    fn rejects_placeholder_and_search_text() {
        // Danish Chrome/Edge placeholder text — must never be stored as a URL.
        assert_eq!(normalize_url("Søg eller indtast webadresse"), None);
        assert_eq!(normalize_url("Search or enter web address"), None);
        assert_eq!(normalize_url("how to cook pasta"), None);
        assert_eq!(normalize_url(""), None);
        assert_eq!(normalize_url("   "), None);
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert_eq!(normalize_url("chrome://settings"), None);
        assert_eq!(normalize_url("edge://settings/help"), None);
        assert_eq!(normalize_url("file:///C:/Users/mads/doc.pdf"), None);
        assert_eq!(normalize_url("about:blank"), None);
        assert_eq!(normalize_url("javascript:alert(1)"), None);
        assert_eq!(normalize_url("data:text/html,hi"), None);
    }

    #[test]
    fn rejects_implausible_hosts() {
        assert_eq!(normalize_url("notaurl"), None);
        assert_eq!(normalize_url("localhost:3000"), None); // no dot
        assert_eq!(normalize_url(".example.com"), None);
        assert_eq!(normalize_url("example..com"), None);
        assert_eq!(normalize_url("example.com."), None);
        assert_eq!(normalize_url("host:notaport.dk"), None);
    }

    #[test]
    fn scheme_only_or_empty_rest_is_rejected() {
        assert_eq!(normalize_url("https://"), None);
        assert_eq!(normalize_url("https://#frag"), None);
    }

    // -----------------------------------------------------------------------
    // Manual UIA verification against a real browser (run with --ignored).
    // Launches Edge on example.com, finds the window by process name (NOT by
    // localized control names), probes the URL through the worker thread, and
    // closes only the window that was verified.
    // -----------------------------------------------------------------------

    #[test]
    #[ignore = "manual: launches Microsoft Edge and reads its address bar via UIA"]
    fn manual_uia_probe_reads_edge_url() {
        use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
            PostMessageW, WM_CLOSE,
        };

        let status = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Start-Process msedge https://example.com",
            ])
            .status()
            .expect("failed to run PowerShell");
        assert!(status.success(), "Start-Process msedge failed");

        // Give the browser time to start and render.
        std::thread::sleep(Duration::from_secs(5));

        extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let windows = unsafe { &mut *(lparam.0 as *mut Vec<isize>) };
            unsafe {
                if IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
                    windows.push(hwnd.0 as isize);
                }
            }
            BOOL(1)
        }

        let mut candidates: Vec<isize> = Vec::new();
        unsafe {
            EnumWindows(Some(enum_cb), LPARAM(&mut candidates as *mut _ as isize))
                .expect("EnumWindows failed");
        }

        let mut verified: Option<isize> = None;
        for hwnd in candidates {
            let mut pid = 0u32;
            unsafe {
                GetWindowThreadProcessId(HWND(hwnd as *mut core::ffi::c_void), Some(&mut pid));
            }
            if pid == 0 {
                continue;
            }
            let exe = super::super::window_windows::get_process_exe_path(pid).unwrap_or_default();
            if !exe.to_lowercase().contains("msedge") {
                continue;
            }

            let start = std::time::Instant::now();
            let url = probe_window_url(hwnd, Duration::from_secs(3));
            println!(
                "probe hwnd={hwnd:#x} exe={exe} took {:?} -> {url:?}",
                start.elapsed()
            );
            if url.as_deref().is_some_and(|u| u.contains("example.com")) {
                verified = Some(hwnd);
                break;
            }
        }

        let hwnd = verified.expect("no Edge window yielded a URL containing example.com");

        // Close only the window we verified.
        unsafe {
            let _ = PostMessageW(
                HWND(hwnd as *mut core::ffi::c_void),
                WM_CLOSE,
                WPARAM(0),
                LPARAM(0),
            );
        }
    }
}
