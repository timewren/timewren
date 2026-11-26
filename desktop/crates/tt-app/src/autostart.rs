//! Start ved login som valg i Indstillinger → Sporing (som 0.2's "Start ved
//! opstart"). Tilstanden bor i OS'et, ikke i indstillingerne, så den altid
//! viser det, der faktisk sker:
//!
//! - **macOS:** LaunchAgent `~/Library/LaunchAgents/TimeTrack.plist` (samme
//!   fil som 0.2's autostart-plugin), med `--autostart`, så appen starter
//!   skjult i menulinjen. Slået fra = filen findes ikke.
//! - **Windows:** værdien `TimeTrack` under `HKCU\…\CurrentVersion\Run` med
//!   `"…\timetrack.exe" --autostart` (samme værdi som installeren).
//!
//! - **Mac App Store-udgaven** (`mas`): `SMAppService.mainAppService`
//!   (macOS 13+). Sandkassen må ikke skrive i `~/Library/LaunchAgents`, og
//!   macOS viser selv appen under Login-emner. Appen starter uden
//!   `--autostart` og viser derfor vinduet.
//!
//! `TT_AUTOSTART_DIR` peger LaunchAgent-mappen et andet sted hen; demo og
//! tests bruger altid en midlertidig mappe (begge OS'er).
//!
//! "Start sporing ved opstart" (`TrackingSettings::start_on_launch`) slår
//! sporingen til, når appen starter, selv om den var sat på pause sidst.

use crate::afloesning::AUTOSTART_ARG;
#[cfg(target_os = "windows")]
use crate::afloesning::{RUN_KEY, RUN_VALUE};

/// LaunchAgentens etiket og filnavn (som 0.2).
pub const LAUNCH_AGENT_LABEL: &str = tt_core::edition::EDITION.name;

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// LaunchAgent-plisten, der starter `exe` skjult ved login.
pub fn launch_agent_plist(exe: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
    <string>{AUTOSTART_ARG}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
        xml_escape(exe)
    )
}

/// Værdien i Run-nøglen på Windows.
pub fn run_value(exe: &str) -> String {
    format!("\"{exe}\" {AUTOSTART_ARG}")
}

fn exe() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("appens placering kan ikke findes: {e}"))
}

/// En mappe i stedet for OS'et: `TT_AUTOSTART_DIR`, ellers en midlertidig
/// mappe i demo og tests, så de aldrig rører den rigtige autostart.
fn sandbox() -> Option<std::path::PathBuf> {
    if let Some(d) = std::env::var_os("TT_AUTOSTART_DIR") {
        return Some(d.into());
    }
    (cfg!(test) || std::env::var_os("TT_DEMO").is_some())
        .then(|| std::env::temp_dir().join("tt-autostart-sandbox"))
}

/// Mappen med LaunchAgents (macOS) eller sandkassen.
pub fn launch_agent_dir() -> Option<std::path::PathBuf> {
    sandbox().or_else(|| std::env::var_os("HOME").map(|h| std::path::Path::new(&h).join("Library/LaunchAgents")))
}

fn plist_path() -> Option<std::path::PathBuf> {
    launch_agent_dir().map(|d| d.join(format!("{LAUNCH_AGENT_LABEL}.plist")))
}

/// Starter appen ved login?
pub fn is_enabled() -> bool {
    #[cfg(all(target_os = "macos", feature = "mas"))]
    if sandbox().is_none() {
        return login_item::status() == Some(SM_ENABLED);
    }
    if cfg!(target_os = "windows") && sandbox().is_none() {
        return windows::query().is_some();
    }
    plist_path().is_some_and(|p| p.is_file())
}

/// Slå start ved login til eller fra. Fejlteksten er dansk.
pub fn set_enabled(on: bool) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "mas"))]
    if sandbox().is_none() {
        return login_item::set(on);
    }
    if cfg!(target_os = "windows") && sandbox().is_none() {
        return if on { windows::add(&run_value(&exe()?)) } else { windows::delete() };
    }
    let path = plist_path().ok_or("hjemmemappen kan ikke findes")?;
    if on {
        let dir = path.parent().expect("plisten ligger i en mappe");
        std::fs::create_dir_all(dir).map_err(|e| format!("kan ikke oprette {}: {e}", dir.display()))?;
        let tmp = path.with_extension("plist.tmp");
        std::fs::write(&tmp, launch_agent_plist(&exe()?))
            .and_then(|_| std::fs::rename(&tmp, &path))
            .map_err(|e| format!("start ved login kunne ikke slås til: {e}"))
    } else {
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("start ved login kunne ikke slås fra: {e}")),
        }
    }
}

/// "Start sporing ved opstart": slå sporingen til, hvis valget er sat og
/// sporingen står på pause. Kaldes én gang ved opstart.
pub fn apply_start_on_launch(b: &dyn crate::backend::Backend) -> crate::backend::Result<bool> {
    let mut s = b.settings()?;
    if !s.tracking.start_on_launch || s.tracking.enabled {
        return Ok(false);
    }
    s.tracking.enabled = true;
    b.save_settings(s)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
mod windows {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    use super::{RUN_KEY, RUN_VALUE};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn reg(args: &[&str]) -> std::io::Result<std::process::Output> {
        Command::new("reg.exe")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
    }

    pub fn query() -> Option<String> {
        let out = reg(&["query", RUN_KEY, "/v", RUN_VALUE]).ok().filter(|o| o.status.success())?;
        crate::afloesning::parse_reg_query(&String::from_utf8_lossy(&out.stdout), RUN_VALUE)
    }

    pub fn add(value: &str) -> Result<(), String> {
        let ok = reg(&["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", value, "/f"])
            .is_ok_and(|o| o.status.success());
        if ok { Ok(()) } else { Err("start ved login kunne ikke slås til".into()) }
    }

    pub fn delete() -> Result<(), String> {
        if query().is_none() {
            return Ok(());
        }
        let ok = reg(&["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]).is_ok_and(|o| o.status.success());
        if ok { Ok(()) } else { Err("start ved login kunne ikke slås fra".into()) }
    }
}

#[cfg(not(target_os = "windows"))]
mod windows {
    pub fn query() -> Option<String> {
        None
    }
    pub fn add(_: &str) -> Result<(), String> {
        Err("kun på Windows".into())
    }
    pub fn delete() -> Result<(), String> {
        Err("kun på Windows".into())
    }
}

/// `SMAppServiceStatus`: 0 ikke registreret, 1 slået til, 2 venter på
/// brugerens godkendelse, 3 ikke fundet.
pub const SM_ENABLED: isize = 1;
pub const SM_REQUIRES_APPROVAL: isize = 2;

/// Svaret på et forsøg på at slå `SMAppService` til eller fra, ud fra
/// status bagefter. Fejlteksten er dansk.
pub fn login_item_result(on: bool, registered: bool, status: isize) -> Result<(), String> {
    match (on, status) {
        (true, SM_ENABLED) | (false, 0 | 3) => Ok(()),
        (true, SM_REQUIRES_APPROVAL) => Err(format!(
            "Godkend {} under Systemindstillinger → Generelt → Login-emner",
            tt_core::edition::EDITION.name
        )),
        // Ikke registreret eller ikke fundet bagefter: så er det ikke slået
        // til, selv om kaldet svarede ja.
        (true, 0 | 3) => Err("start ved login kunne ikke slås til".into()),
        _ if registered => Ok(()),
        (true, _) => Err("start ved login kunne ikke slås til".into()),
        (false, _) => Err("start ved login kunne ikke slås fra".into()),
    }
}

/// App Store-udgaven: login-emnet via ServiceManagement (`SMAppService`).
#[cfg(all(target_os = "macos", feature = "mas"))]
mod login_item {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSError;

    #[link(name = "ServiceManagement", kind = "framework")]
    unsafe extern "C" {}

    fn main_app() -> Option<Retained<AnyObject>> {
        // macOS 13+; findes klassen ikke, er der intet login-emne.
        let cls = AnyClass::get(c"SMAppService")?;
        unsafe { msg_send![cls, mainAppService] }
    }

    pub fn status() -> Option<isize> {
        let svc = main_app()?;
        Some(unsafe { msg_send![&*svc, status] })
    }

    pub fn set(on: bool) -> Result<(), String> {
        let svc = main_app().ok_or("start ved login kræver macOS 13 eller nyere")?;
        // `_`: objc2 giver Err, når metoden svarer NO (NSError ** ud).
        let res: Result<(), Retained<NSError>> = if on {
            unsafe { msg_send![&*svc, registerAndReturnError: _] }
        } else {
            unsafe { msg_send![&*svc, unregisterAndReturnError: _] }
        };
        let now: isize = unsafe { msg_send![&*svc, status] };
        super::login_item_result(on, res.is_ok(), now)
    }
}

/// Tests, der slår autostart til og fra, deler sandkassen.
#[cfg(test)]
pub(crate) static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plisten_starter_skjult_ved_login() {
        let p = launch_agent_plist("/Applications/TimeTrack & Co.app/Contents/MacOS/timetrack");
        assert!(p.contains("<string>TimeTrack</string>"));
        assert!(p.contains("<string>/Applications/TimeTrack &amp; Co.app/Contents/MacOS/timetrack</string>"));
        assert!(p.contains("<string>--autostart</string>"));
        assert!(p.contains("<key>RunAtLoad</key>\n  <true/>"));
        // Afløsningen genkender den som allerede rettet.
        assert_eq!(crate::afloesning::launch_agent_with_flag(&p), None);
        assert_eq!(run_value(r"C:\a b\timetrack.exe"), r#""C:\a b\timetrack.exe" --autostart"#);
    }

    #[test]
    fn slaas_til_og_fra_i_sandkassen() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        set_enabled(false).unwrap();
        assert!(!is_enabled());
        set_enabled(true).unwrap();
        assert!(is_enabled());
        let p = std::fs::read_to_string(launch_agent_dir().unwrap().join("TimeTrack.plist")).unwrap();
        assert!(p.contains("--autostart"));
        assert!(launch_agent_dir().unwrap().starts_with(std::env::temp_dir()), "aldrig den rigtige mappe i tests");
        set_enabled(false).unwrap();
        assert!(!is_enabled());
        set_enabled(false).unwrap();
    }

    /// SMAppService (App Store-udgaven): status efter forsøget afgør svaret.
    #[test]
    fn login_emnets_svar() {
        assert_eq!(login_item_result(true, true, SM_ENABLED), Ok(()));
        assert!(login_item_result(true, true, SM_REQUIRES_APPROVAL).unwrap_err().contains("Login-emner"));
        assert!(login_item_result(true, false, 0).is_err());
        assert!(login_item_result(true, true, 0).is_err(), "registreret, men status 0");
        assert!(login_item_result(true, true, 3).is_err(), "registreret, men ikke fundet");
        assert_eq!(login_item_result(false, true, 0), Ok(()));
        assert_eq!(login_item_result(false, false, 3), Ok(()), "ikke fundet = slået fra");
        assert!(login_item_result(false, false, SM_ENABLED).is_err());
    }

    #[test]
    fn sporing_slaas_til_ved_opstart_kun_med_valget() {
        use crate::backend::{Backend, MockBackend};
        let m = MockBackend::with_today(chrono::NaiveDate::from_ymd_opt(2026, 10, 27).unwrap());
        let mut s = m.settings().unwrap();
        s.tracking.enabled = false;
        m.save_settings(s.clone()).unwrap();
        assert!(!apply_start_on_launch(&m).unwrap(), "valget er fra");
        assert!(!m.settings().unwrap().tracking.enabled);
        s.tracking.start_on_launch = true;
        m.save_settings(s).unwrap();
        assert!(apply_start_on_launch(&m).unwrap());
        assert!(m.settings().unwrap().tracking.enabled);
        assert!(!apply_start_on_launch(&m).unwrap(), "allerede til");
    }
}

#[cfg(test)]
mod brand_tests {
    /// Autostart-etiketten er udgavens, så de to apps ikke overskriver hinandens.
    #[test]
    fn brand_autostart_etiketten_er_udgavens() {
        assert_eq!(super::LAUNCH_AGENT_LABEL, tt_core::edition::EDITION.name);
    }
}
