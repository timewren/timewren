use crate::db::Database;
use crate::i18n;
use crate::license::{machine_id, LicenseManager, LicenseProof, LicenseStatus};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialStatus {
    pub is_active: bool,
    pub days_remaining: i32,
    pub started_at: Option<String>,
}

// --- Obfuscated trial storage ---
// Trial date is XOR-encoded and stored in non-obvious locations to prevent
// casual tampering. The key is derived from the machine ID.

const OBFUSCATION_SALT: &[u8] = b"tt_desktop_2026_eval";

fn obfuscate(date: &str, mid: &str) -> String {
    let key_bytes: Vec<u8> = mid.bytes().chain(OBFUSCATION_SALT.iter().copied()).collect();
    let encoded: Vec<u8> = date
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ key_bytes[i % key_bytes.len()])
        .collect();
    base64_encode(&encoded)
}

fn deobfuscate(encoded: &str, mid: &str) -> Option<String> {
    let key_bytes: Vec<u8> = mid.bytes().chain(OBFUSCATION_SALT.iter().copied()).collect();
    let decoded = base64_decode(encoded)?;
    let original: Vec<u8> = decoded
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ key_bytes[i % key_bytes.len()])
        .collect();
    let date_str = String::from_utf8(original).ok()?;
    chrono::NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").ok()?;
    Some(date_str)
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(triple & 0x3F) as usize] as char); } else { result.push('='); }
    }
    result
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const DECODE: [i8; 128] = {
        let mut table = [-1i8; 128];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            table[chars[i] as usize] = i as i8;
            i += 1;
        }
        table
    };
    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'=').collect();
    let mut result = Vec::new();
    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 { break; }
        let vals: Vec<u8> = chunk.iter().filter_map(|&b| {
            if (b as usize) < 128 { let v = DECODE[b as usize]; if v >= 0 { Some(v as u8) } else { None } } else { None }
        }).collect();
        if vals.len() >= 2 { result.push((vals[0] << 2) | (vals[1] >> 4)); }
        if vals.len() >= 3 { result.push((vals[1] << 4) | (vals[2] >> 2)); }
        if vals.len() >= 4 { result.push((vals[2] << 6) | vals[3]); }
    }
    Some(result)
}

/// Hidden file path — uses a non-obvious name in a system directory.
/// Windows: %LOCALAPPDATA%\.cache\.sys_preferences
/// macOS/Linux: ~/.local/share/.font_cache_v2
fn hidden_trial_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|dir| PathBuf::from(dir).join(".cache").join(".sys_preferences"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .ok()
            .map(|home| PathBuf::from(home).join(".local").join("share").join(".font_cache_v2"))
    }
}

/// Read obfuscated trial date from hidden file.
fn read_hidden_trial() -> Option<String> {
    let mid = machine_id();
    let path = hidden_trial_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    deobfuscate(content.trim(), &mid)
}

/// Write obfuscated trial date to hidden file.
fn write_hidden_trial(date: &str) -> Result<(), String> {
    let mid = machine_id();
    let path = hidden_trial_path()
        .ok_or_else(|| i18n::t("license.couldNotFindTrialPath"))?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let encoded = obfuscate(date, &mid);
    std::fs::write(&path, encoded)
        .map_err(|e| i18n::t_fmt("license.couldNotSaveTrial", &[&e.to_string()]))?;
    Ok(())
}

/// Windows Registry storage — stores under an innocuous key name.
#[cfg(target_os = "windows")]
fn read_registry_trial() -> Option<String> {
    use crate::util::CommandExtHidden;
    let mid = machine_id();
    let output = std::process::Command::new("reg")
        .hidden_console()
        .args(["query", r"HKCU\Software\Microsoft\InputMethod\Settings", "/v", "CacheTimestamp"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("CacheTimestamp") {
            let val = line.split_whitespace().last()?;
            return deobfuscate(val, &mid);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn write_registry_trial(date: &str) -> Result<(), String> {
    use crate::util::CommandExtHidden;
    let mid = machine_id();
    let encoded = obfuscate(date, &mid);
    std::process::Command::new("reg")
        .hidden_console()
        .args(["add", r"HKCU\Software\Microsoft\InputMethod\Settings", "/v", "CacheTimestamp", "/t", "REG_SZ", "/d", &encoded, "/f"])
        .output()
        .map_err(|e| i18n::t_fmt("license.registryWriteError", &[&e.to_string()]))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn read_registry_trial() -> Option<String> { None }
#[cfg(not(target_os = "windows"))]
fn write_registry_trial(_date: &str) -> Result<(), String> { Ok(()) }

/// Legacy plain-text file for backwards compatibility.
fn legacy_trial_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    { std::env::var("USERPROFILE").ok().map(|h| PathBuf::from(h).join(".timetrack-trial")) }
    #[cfg(not(target_os = "windows"))]
    { std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".timetrack-trial")) }
}

fn read_external_trial() -> Option<String> {
    // Try hidden obfuscated file first
    if let Some(date) = read_hidden_trial() {
        return Some(date);
    }
    // Try Windows Registry
    if let Some(date) = read_registry_trial() {
        return Some(date);
    }
    // Fallback: legacy plain-text
    let path = legacy_trial_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    let trimmed = content.trim().to_string();
    chrono::NaiveDate::parse_from_str(&trimmed, "%Y-%m-%d").ok()?;
    Some(trimmed)
}

/// Write trial date to ALL hidden locations.
fn write_external_trial(date: &str) -> Result<(), String> {
    let _ = write_hidden_trial(date);
    let _ = write_registry_trial(date);
    // Also write legacy for backwards compat
    if let Some(path) = legacy_trial_path() {
        let _ = std::fs::write(&path, date);
    }
    Ok(())
}

/// Try to register or check trial with the server (best-effort).
async fn server_trial_check(mid: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://app.timetrack.dk/api/desktop/license/trial")
        .header(crate::sync::api::KLIENT_HEADER, crate::sync::api::klient_version())
        .json(&serde_json::json!({
            "machineId": mid,
            "os": std::env::consts::OS,
        }))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    #[derive(Deserialize)]
    struct ServerTrialResponse {
        started_at: String,
    }

    let body: ServerTrialResponse = resp.json().await.ok()?;
    // Validate it's a date
    chrono::NaiveDate::parse_from_str(&body.started_at, "%Y-%m-%d").ok()?;
    Some(body.started_at)
}

/// Number of days a non-monotonic clock may drift backwards before we treat it
/// as deliberate tampering rather than benign skew/timezone noise.
const TRIAL_ROLLBACK_TOLERANCE_DAYS: i64 = 1;

/// Pure trial elapsed-day computation, hardened against clock rollback.
///
/// `today` is the wall-clock date; `last_seen` is the newest date we have ever
/// observed for this install (a monotonic high-water mark). If `today` is
/// meaningfully *before* `last_seen` the clock has been rolled back, so we
/// anchor the elapsed calculation to `last_seen` instead of `today`. This stops
/// the trivial "set the system clock back" attack from shrinking elapsed days
/// and reviving an expired trial.
///
/// Returns `(elapsed_days, effective_today)` where `effective_today` is the
/// date that should be persisted as the new high-water mark.
fn trial_elapsed_days(
    started: chrono::NaiveDate,
    today: chrono::NaiveDate,
    last_seen: Option<chrono::NaiveDate>,
) -> (i64, chrono::NaiveDate) {
    // Effective "now" is never allowed to fall meaningfully below the
    // high-water mark.
    let effective_today = match last_seen {
        Some(seen) if today < seen - chrono::Duration::days(TRIAL_ROLLBACK_TOLERANCE_DAYS) => seen,
        _ => today,
    };
    // High-water mark advances to the larger of (today, last_seen) so honest
    // forward progress is recorded while rollbacks are ignored.
    let new_high_water = match last_seen {
        Some(seen) if seen > effective_today => seen,
        _ => effective_today,
    };
    let elapsed = effective_today.signed_duration_since(started).num_days();
    (elapsed.max(0), new_high_water)
}

/// Given an optional date string, compute the TrialStatus. `last_seen` is the
/// persisted monotonic high-water timestamp (if any).
fn compute_trial_status_at(
    started_at: Option<String>,
    today: chrono::NaiveDate,
    last_seen: Option<chrono::NaiveDate>,
) -> Result<TrialStatus, String> {
    match started_at {
        Some(ref date_str) => {
            let started =
                chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|e| {
                    i18n::t_fmt("license.invalidTrialFormat", &[&e.to_string()])
                })?;
            let (elapsed, _) = trial_elapsed_days(started, today, last_seen);
            let days_remaining = (30 - elapsed).max(0) as i32;
            let is_active = elapsed < 30;

            Ok(TrialStatus {
                is_active,
                days_remaining,
                started_at: Some(date_str.clone()),
            })
        }
        None => Ok(TrialStatus {
            is_active: false,
            days_remaining: 0,
            started_at: None,
        }),
    }
}

/// Convenience wrapper used by the command handlers: reads wall-clock `today`
/// and the supplied high-water mark.
fn compute_trial_status_with_anchor(
    started_at: Option<String>,
    last_seen: Option<String>,
) -> Result<TrialStatus, String> {
    let today = chrono::Local::now().date_naive();
    let last_seen_date =
        last_seen.and_then(|s| chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok());
    compute_trial_status_at(started_at, today, last_seen_date)
}

/// Pick the oldest (most tamper-resistant) date from multiple sources.
fn oldest_date(dates: &[Option<String>]) -> Option<String> {
    dates
        .iter()
        .filter_map(|d| d.as_ref())
        .filter_map(|d| {
            chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .ok()
                .map(|parsed| (parsed, d.clone()))
        })
        .min_by_key(|(parsed, _)| *parsed)
        .map(|(_, s)| s)
}

#[tauri::command]
pub async fn activate_license(
    license_manager: State<'_, LicenseManager>,
    license_key: String,
) -> Result<LicenseProof, String> {
    license_manager.activate(&license_key).await
}

#[tauri::command]
pub async fn verify_license(
    license_manager: State<'_, LicenseManager>,
) -> Result<LicenseStatus, String> {
    license_manager.verify().await
}

#[tauri::command]
pub async fn deactivate_license(
    license_manager: State<'_, LicenseManager>,
) -> Result<(), String> {
    license_manager.deactivate().await
}

#[tauri::command]
pub fn get_license_info(
    license_manager: State<'_, LicenseManager>,
) -> Result<Option<LicenseProof>, String> {
    Ok(license_manager.get_cached())
}

/// Read the persisted monotonic high-water timestamp ("last seen" date).
fn read_trial_last_seen(db: &Database) -> Option<String> {
    let conn = crate::db::lås(&db.conn);
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'trial_last_seen'",
        [],
        |row| row.get(0),
    )
    .ok()
}

/// Advance the monotonic high-water timestamp. Never moves it backwards: the
/// stored value is the max of (existing, today). This is the anchor that
/// defeats clock-rollback trial revival.
fn bump_trial_last_seen(db: &Database) {
    let today = chrono::Local::now().date_naive();
    let existing = read_trial_last_seen(db)
        .and_then(|s| chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok());
    let new_value = match existing {
        Some(seen) if seen > today => seen,
        _ => today,
    };
    {
        let conn = crate::db::lås(&db.conn);
        let _ = conn.execute(
            "INSERT INTO settings (key, value) VALUES ('trial_last_seen', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![new_value.format("%Y-%m-%d").to_string()],
        );
    }
}

#[tauri::command]
pub async fn check_trial_status(db: State<'_, Database>) -> Result<TrialStatus, String> {
    // Source 1: settings table (scoped to release lock before await)
    let db_date: Option<String> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'trial_started_at'",
            [],
            |row| row.get(0),
        )
        .ok()
    };

    // Monotonic anchor (read before bump so we compare against the prior max).
    let last_seen = read_trial_last_seen(&db);

    // Source 2: external file
    let file_date = read_external_trial();

    // Source 3: server (best-effort, async — no lock held)
    let mid = machine_id();
    let server_date = server_trial_check(&mid).await;

    // Use the oldest date (most tamper-resistant)
    let effective_date = oldest_date(&[db_date.clone(), file_date.clone(), server_date.clone()]);

    // If we found a date from server or file that the DB doesn't have, sync it back
    if let Some(ref date) = effective_date {
        if db_date.is_none() {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('trial_started_at', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![date],
            );
        }
        if file_date.is_none() {
            let _ = write_external_trial(date);
        }
    }

    let status = compute_trial_status_with_anchor(effective_date, last_seen)?;
    // Record forward progress of the wall clock (never moves backwards).
    bump_trial_last_seen(&db);
    Ok(status)
}

#[tauri::command]
pub async fn start_trial(db: State<'_, Database>) -> Result<TrialStatus, String> {
    let mid = machine_id();

    // 1. Check if trial already exists from ANY source
    let db_date: Option<String> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'trial_started_at'",
            [],
            |row| row.get(0),
        )
        .ok()
    };
    let file_date = read_external_trial();

    // Try server check (no lock held)
    let server_date = server_trial_check(&mid).await;

    let existing_date = oldest_date(&[db_date.clone(), file_date.clone(), server_date.clone()]);

    // If a trial already exists, return that (don't allow reset)
    if let Some(ref date) = existing_date {
        let last_seen = read_trial_last_seen(&db);
        // Ensure all sources are synced
        {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('trial_started_at', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![date],
            );
        }
        let _ = write_external_trial(date);

        let status = compute_trial_status_with_anchor(Some(date.clone()), last_seen)?;
        bump_trial_last_seen(&db);
        return Ok(status);
    }

    // 2. No existing trial — create new one
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Save to DB (scoped block to release lock)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('trial_started_at', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![today],
        )
        .map_err(|e| e.to_string())?;
    }

    // Save to external file
    let _ = write_external_trial(&today);

    // Initialize the monotonic high-water anchor at trial creation.
    bump_trial_last_seen(&db);

    // Register with server (best-effort, don't fail if offline)
    let _ = server_trial_check(&mid).await;

    Ok(TrialStatus {
        is_active: true,
        days_remaining: 30,
        started_at: Some(today),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    // --- Bug 5: trial clock-rollback revives trial ---

    #[test]
    fn rollback_does_not_shrink_elapsed() {
        // Started 20 days ago; high-water mark proves we already reached day 20.
        let started = d("2026-06-01");
        let last_seen = Some(d("2026-06-21")); // 20 days elapsed observed
        // Attacker rolls the clock back to day 5.
        let today = d("2026-06-05");
        let (elapsed, hwm) = trial_elapsed_days(started, today, last_seen);
        assert_eq!(elapsed, 20, "rollback must not reduce elapsed days");
        assert_eq!(hwm, d("2026-06-21"), "high-water mark must not move back");
    }

    #[test]
    fn rollback_keeps_expired_trial_expired() {
        let last_seen = Some(d("2026-06-15")); // 45 days observed → expired
        let today = d("2026-05-03"); // rolled back to day 2
        let status =
            compute_trial_status_at(Some("2026-05-01".to_string()), today, last_seen).unwrap();
        assert!(!status.is_active, "rolled-back expired trial must stay expired");
        assert_eq!(status.days_remaining, 0);
    }

    #[test]
    fn honest_forward_progress_advances_high_water() {
        let started = d("2026-06-01");
        let last_seen = Some(d("2026-06-05"));
        let today = d("2026-06-10");
        let (elapsed, hwm) = trial_elapsed_days(started, today, last_seen);
        assert_eq!(elapsed, 9);
        assert_eq!(hwm, d("2026-06-10"), "honest progress advances high-water mark");
    }

    #[test]
    fn small_backward_skew_within_tolerance_is_allowed() {
        // One day of skew (timezone/DST noise) is tolerated, not treated as attack.
        let started = d("2026-06-01");
        let last_seen = Some(d("2026-06-10"));
        let today = d("2026-06-09"); // 1 day back, within tolerance
        let (elapsed, _) = trial_elapsed_days(started, today, last_seen);
        // Uses today (not anchored), so elapsed reflects the (benign) skew.
        assert_eq!(elapsed, 8);
    }

    #[test]
    fn no_last_seen_uses_today() {
        let started = d("2026-06-01");
        let today = d("2026-06-11");
        let (elapsed, hwm) = trial_elapsed_days(started, today, None);
        assert_eq!(elapsed, 10);
        assert_eq!(hwm, today);
    }

    #[test]
    fn active_trial_within_30_days() {
        let status =
            compute_trial_status_at(Some("2026-06-01".to_string()), d("2026-06-10"), None).unwrap();
        assert!(status.is_active);
        assert_eq!(status.days_remaining, 21);
    }

    #[test]
    fn no_trial_is_inactive() {
        let status = compute_trial_status_at(None, d("2026-06-10"), None).unwrap();
        assert!(!status.is_active);
        assert_eq!(status.days_remaining, 0);
    }

    // -----------------------------------------------------------------------
    // Højeste-tidspunktet skal overleve en forgiftet lås
    // -----------------------------------------------------------------------

    fn test_db() -> Database {
        use std::sync::Mutex;
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .expect("settings-tabel");
        Database {
            conn: Mutex::new(conn),
            recovery: Mutex::new(None),
        }
    }

    /// Gør låsen forgiftet, som en panik under en skrivning gør det.
    fn forgift(db: &Database) {
        let panik = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            std::thread::scope(|omfang| {
                omfang.spawn(|| {
                    let _vagt = db.conn.lock().expect("låsen er ikke forgiftet endnu");
                    panic!("skrivning, der går galt under låsen");
                });
            });
        }));
        assert!(panik.is_err(), "tråden skal panikkere for at forgifte låsen");
        assert!(db.conn.is_poisoned(), "låsen skal være forgiftet");
    }

    /// `trial_last_seen` er detanker, der gør det umuligt at genstarte
    /// prøveperioden ved at rulle uret tilbage: højeste-tidspunktet flytter sig
    /// aldrig bagud, så en rullet-tilbage-dag ikke tælles med.
    ///
    /// Den gamle kode skrev det med `if let Ok(conn) = db.conn.lock()` — så en
    /// forgiftet lås holdt **stille op** med at flytte ankaret. Brugeren så en
    /// fortsat aktiv prøveperiode, og beskyttelsen var væk uden at nogen kunne se
    /// hvorfor. Porten `db::lås` genopbygger låsen i stedet.
    #[test]
    fn hoejeste_tidspunktet_bevarer_eget_naar_laasen_er_forgiftet() {
        let db = test_db();
        forgift(&db);

        bump_trial_last_seen(&db);

        let gemt = read_trial_last_seen(&db);
        let i_dag = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        assert_eq!(
            gemt.as_deref(),
            Some(i_dag.as_str()),
            "ankaret skal skrives selv om låsen er forgiftet — ellers genstarter \
             prøveperioden, når uret rulles tilbage"
        );
    }

    /// Samme port på læsevejen: `read_trial_last_seen` svarede `None` på en
    /// forgiftet lås, hvilket er præcis det svar en *aldrig set* database giver.
    #[test]
    fn laesningen_af_ankaret_fejler_ikke_paa_en_forgiftet_laas() {
        let db = test_db();
        crate::db::lås(&db.conn)
            .execute(
                "INSERT INTO settings (key, value) VALUES ('trial_last_seen', '2026-06-21')",
                [],
            )
            .expect("skriv anker");
        forgift(&db);

        assert_eq!(
            read_trial_last_seen(&db).as_deref(),
            Some("2026-06-21"),
            "et gemt anker skal kunne læses trods en forgiftet lås"
        );
    }
}
