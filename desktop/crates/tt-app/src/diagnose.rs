//! `timetrack --diagnose-activity`: tal om Aktivitet til fejlsøgning.
//!
//! Kun tal og datoer, aldrig titler, URL'er eller navne, så outputtet kan
//! sendes videre. Starter hverken UI, én-instans-lås, afløsning eller
//! deep link-registrering, og rører hverken netværk, nøglering eller tokens:
//! motoren åbnes uden sporing og uden AI-kæde, og `activity_day` går gennem
//! samme kalender-indpakning som appen (`startup::real`). Datamappen vises
//! med hjemmemappen som `~`.
//!
//! Den læser kun, men som appen selv: `activity.db` åbnes i WAL (kan give
//! `-wal`/`-shm` og migrere skemaet fra en ældre version), og en ødelagt
//! json-fil i `detektion/` omdøbes til `*.korrupt-<tid>`.

use std::path::Path;
use std::sync::Arc;

use chrono::{Duration, NaiveDate};

use crate::backend::services::{Detection, data_dir};
use crate::engine::Engine;
use crate::kalenderkilder::{CalendarDetection, Kalender};

pub const FLAG: &str = "--diagnose-activity";

/// Er `--diagnose-activity` blandt argumenterne?
pub fn wanted(mut args: impl Iterator<Item = std::ffi::OsString>) -> bool {
    args.any(|a| a == FLAG)
}

/// Skriver rapporten for appens datamappe på stdout.
pub fn print_activity() {
    #[cfg(target_os = "windows")]
    attach_console();
    let today = chrono::Local::now().date_naive();
    for line in activity_report(&data_dir(), today) {
        println!("{line}");
    }
}

/// Rapportens linjer for datamappen `dir` set fra `today`.
pub fn activity_report(dir: &Path, today: NaiveDate) -> Vec<String> {
    let det = dir.join(crate::migrate::laering::DETECTION_DIR);
    let db = det.join("activity.db");
    let mut out = vec![
        format!("{} {} {FLAG}", tt_core::edition::EDITION.name, env!("CARGO_PKG_VERSION")),
        format!("datamappe: {}", without_home(dir, home().as_deref())),
    ];
    let settings = crate::backend::repo::files::load_settings(dir);
    match &settings {
        Ok(s) => out.push(format!("retention_days (settings.json): {}", s.tracking.retention_days)),
        Err(_) => out.push("retention_days (settings.json): kunne ikke læses".into()),
    }
    if !db.exists() {
        // Åbnes den, oprettes en tom database; det skal en diagnose ikke.
        out.push("activity.db: findes ikke".into());
        return out;
    }
    match tt_tracker::ActivityStore::open(&db) {
        Ok(store) => {
            for back in 0..3 {
                let d = today - Duration::days(back);
                match store.segments_for_day(d, true) {
                    Ok(segs) => out.push(format!("segmenter {d}: {}", segs.len())),
                    Err(_) => out.push(format!("segmenter {d}: kunne ikke læses")),
                }
            }
        }
        Err(_) => {
            out.push("activity.db: kunne ikke åbnes".into());
            return out;
        }
    }

    let engine = Arc::new(Engine::new(det, None));
    if let Ok(s) = settings {
        engine.set_settings_only(s);
    }
    let kalender = Arc::new(Kalender::new(None, Box::new(|_| vec![])));
    let detection = CalendarDetection::new(engine, kalender);
    match detection.activity_storage() {
        Ok(s) => {
            out.push(format!("segmenter i alt: {}", s.segments));
            out.push(format!("dage med aktivitet: {}", s.days));
        }
        Err(_) => out.push("segmenter i alt: kunne ikke læses".into()),
    }
    match detection.activity_day(today, &[], &[], &[]) {
        Ok(day) => {
            out.push(format!("earliest: {}", day.earliest));
            out.push(format!("blokke i dag ({today}): {}", day.blocks.len()));
        }
        Err(_) => out.push("blokke i dag: kunne ikke læses".into()),
    }
    out
}

fn home() -> Option<std::path::PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(Into::into)
}

/// Stien med hjemmemappen som `~`, så brugernavnet ikke kommer med.
fn without_home(dir: &Path, home: Option<&Path>) -> String {
    match home.and_then(|h| dir.strip_prefix(h).ok()) {
        Some(rest) => Path::new("~").join(rest).display().to_string(),
        None => dir.display().to_string(),
    }
}

/// Windows-appen har intet konsolvindue (`windows_subsystem`): skriv i
/// konsollen, den blev startet fra. Omdirigeret output (`> fil.txt`) virker
/// også uden.
#[cfg(target_os = "windows")]
fn attach_console() {
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
        fn GetStdHandle(std_handle: u32) -> *mut std::ffi::c_void;
    }
    // SAFETY: begge tager kun tal; AttachConsole fejler ufarligt (fx når
    // forælderen ikke har en konsol). Er stdout omdirigeret, bruges den.
    unsafe {
        let h = GetStdHandle(STD_OUTPUT_HANDLE);
        if h.is_null() || h as isize == -1 {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

#[cfg(test)]
mod tests;
