//! Platformlaget: hvad OS'et kan fortælle om forgrundsvinduet.
//!
//! Al logik ligger uden for dette lag; her er kun FFI. [`Platform`] er et
//! trait, så trackeren kan køres mod en scriptet platform i tests
//! ([`crate::testing::ScriptedPlatform`]).

use std::sync::{Condvar, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};

use crate::types::{BrowserUrl, RawWindow};

pub mod permissions;

// `mas` (Mac App Store-udgaven, App Sandbox): ingen sonder. Tilgængelighed,
// Apple Events og andre programmers vinduer er ikke tilladt i sandkassen, så
// koden bygges slet ikke ind, og `native()` giver en platform, der intet ser.
#[cfg(all(target_os = "macos", not(feature = "mas")))]
mod macos;
#[cfg(all(windows, not(feature = "mas")))]
mod url_windows;
#[cfg(all(windows, not(feature = "mas")))]
mod windows;

/// Kan denne bygning se forgrundsvinduet? Falsk i App Store-udgaven (`mas`)
/// og på Linux.
pub const CAPTURE_SUPPORTED: bool =
    !cfg!(feature = "mas") && cfg!(any(target_os = "macos", windows));

pub trait Platform: Send {
    /// Forgrundsvinduet lige nu.
    fn foreground(&mut self) -> Option<RawWindow>;
    /// Sekunder siden sidste tastatur- eller musinput.
    fn idle_seconds(&mut self) -> u64;
    /// Adresselinjen for browservinduet `w` (og om det er privat).
    fn browser_url(&mut self, _w: &RawWindow) -> BrowserUrl {
        BrowserUrl::Unknown
    }
    /// Den fokuserede terminalfanes arbejdsmappe, når OS'et eller terminalen
    /// selv kan oplyse den (Terminal.app, iTerm2). Ellers bruges procestræet.
    fn terminal_cwd(&mut self, _w: &RawWindow) -> Option<String> {
        None
    }
    /// Om procestræet må bruges som sidste udvej for terminalens cwd.
    fn process_tree_allowed(&self) -> bool {
        true
    }
    fn now(&mut self) -> DateTime<Utc> {
        Utc::now()
    }
    /// Venter til næste poll eller til trackeren stoppes.
    fn sleep(&mut self, d: Duration, stop: &StopSignal) {
        stop.wait(d);
    }
}

/// Vækker trackerens tråd, når den skal stoppe, så `stop()` ikke venter en
/// hel poll.
#[derive(Default)]
pub struct StopSignal {
    stopped: Mutex<bool>,
    cv: Condvar,
}

impl StopSignal {
    pub fn wait(&self, d: Duration) {
        let guard = self.stopped.lock().unwrap_or_else(|p| p.into_inner());
        if *guard {
            return;
        }
        let _ = self.cv.wait_timeout(guard, d);
    }

    pub fn stop(&self) {
        *self.stopped.lock().unwrap_or_else(|p| p.into_inner()) = true;
        self.cv.notify_all();
    }

    pub fn is_stopped(&self) -> bool {
        *self.stopped.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// Den rigtige platform for denne maskine.
pub fn native() -> Box<dyn Platform> {
    #[cfg(all(target_os = "macos", not(feature = "mas")))]
    {
        Box::new(macos::MacPlatform::new())
    }
    #[cfg(all(windows, not(feature = "mas")))]
    {
        Box::new(windows::WindowsPlatform::new())
    }
    #[cfg(any(feature = "mas", not(any(target_os = "macos", windows))))]
    {
        Box::new(Unsupported)
    }
}

/// Linux er droppet (spec D4), og App Store-udgaven (`mas`) må ikke se andre
/// programmer. Trackeren ser intet, men crate'en kompilerer.
#[cfg(any(feature = "mas", not(any(target_os = "macos", windows))))]
struct Unsupported;

#[cfg(any(feature = "mas", not(any(target_os = "macos", windows))))]
impl Platform for Unsupported {
    fn foreground(&mut self) -> Option<RawWindow> {
        None
    }
    fn idle_seconds(&mut self) -> u64 {
        0
    }
}

/// App-navn fra en exe-sti uden `.exe` (Windows) eller fra `.app`-bundlen.
pub fn app_name_from_exe(exe_path: &str) -> String {
    if let Some(bundle) = app_bundle_name(exe_path) {
        return bundle;
    }
    let file = exe_path.rsplit(['\\', '/']).next().unwrap_or(exe_path);
    if file.is_empty() {
        return "Unknown".to_string();
    }
    let lower = file.to_ascii_lowercase();
    if lower.ends_with(".exe") {
        file[..file.len() - 4].to_string()
    } else {
        file.to_string()
    }
}

/// `/Applications/Visual Studio Code.app/Contents/MacOS/Electron` →
/// `Visual Studio Code`. Den yderste bundle vinder (hjælpeprocesser ligger
/// i indre bundles).
pub fn app_bundle_name(exe_path: &str) -> Option<String> {
    exe_path
        .split('/')
        .find(|c| c.len() > 4 && c.to_ascii_lowercase().ends_with(".app"))
        .map(|c| c[..c.len() - 4].to_string())
}

/// Stabilt program-id i små bogstaver (se [`crate::ActivitySegment::app_id`]).
pub fn app_id(exe_path: &str, app_name: &str) -> String {
    if exe_path.trim().is_empty() {
        return app_name.trim().to_lowercase();
    }
    app_name_from_exe(exe_path).to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_name_from_exe_handles_both_platforms() {
        assert_eq!(
            app_name_from_exe(r"C:\Program Files\Microsoft VS Code\Code.exe"),
            "Code"
        );
        assert_eq!(app_name_from_exe(r"C:\Windows\explorer.EXE"), "explorer");
        assert_eq!(app_name_from_exe(""), "Unknown");
        assert_eq!(app_name_from_exe("notepad.exe"), "notepad");
        assert_eq!(
            app_name_from_exe("/Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
            "Visual Studio Code"
        );
        assert_eq!(
            app_name_from_exe(
                "/Applications/Google Chrome.app/Contents/Frameworks/x.app/Contents/MacOS/Helper"
            ),
            "Google Chrome"
        );
        assert_eq!(app_name_from_exe("/usr/local/bin/nvim"), "nvim");
    }

    #[test]
    fn app_id_falls_back_to_name() {
        assert_eq!(app_id("", " Safari "), "safari");
        assert_eq!(
            app_id(
                "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
                "Terminal"
            ),
            "terminal"
        );
        assert_eq!(
            app_id(r"C:\x\WindowsTerminal.exe", "WindowsTerminal"),
            "windowsterminal"
        );
    }

    /// App Store-udgaven: platformen ser intet, heller ikke på en Mac.
    #[cfg(feature = "mas")]
    #[test]
    fn mas_platform_sees_nothing() {
        const { assert!(!CAPTURE_SUPPORTED) };
        let mut p = native();
        assert!(p.foreground().is_none());
        assert_eq!(p.idle_seconds(), 0);
    }

    #[test]
    fn stop_signal_wakes_immediately() {
        let s = std::sync::Arc::new(StopSignal::default());
        let s2 = s.clone();
        let h = std::thread::spawn(move || {
            let t = std::time::Instant::now();
            s2.wait(Duration::from_secs(30));
            t.elapsed()
        });
        std::thread::sleep(Duration::from_millis(50));
        s.stop();
        assert!(h.join().unwrap() < Duration::from_secs(5));
        assert!(s.is_stopped());
        s.wait(Duration::from_secs(30)); // returnerer straks efter stop
    }
}
