//! Overgang fra den gamle Tauri-app (0.2.x) til den nye app (0.2.23).
//!
//! Ved første start læses den gamle apps datamappe (`dk.timetrack.desktop`):
//!
//! - `settings`-tabellen i `timetrack.db` → `settings.json` (sporing, pause,
//!   udseende, sprog og en lokal AI-server).
//! - Brugte den gamle app **ikke** cloud-synk, flyttes de lokale data ind i
//!   den nye `local.db`: kunder, projekter, klippekort, poster, fakturaer
//!   (som kladde, sendt eller betalt) og regler (`classification_rules` og
//!   `project_matchers`).
//! - Var den logget ind, ligger kunder, projekter, poster og klippekort
//!   allerede på kontoen. De hentes ved login, så de importeres ikke igen.
//!   Det gamle login (email/adgangskode-token mod `/api/desktop/auth/token`)
//!   virker ikke mod device-API'et, så brugeren skal logge ind igen.
//!
//! Den gamle mappe røres ikke: databasen (med `-wal`) kopieres til en
//! midlertidig mappe og læses derfra. Importen sker én gang; markøren
//! `migrering-0.2.json` i den nye datamappe gemmer resultatet. Den skrives
//! også, når der intet var at hente, så importen aldrig kører to gange.
//!
//! Hemmeligheder (cloud-AI-nøgler, Billy-nøgle og synk-token i nøgleringen)
//! flyttes ikke. Cloud-AI kræver, at advarslen bekræftes i den nye app.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use futures_lite::future::block_on;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use tt_data::{
    LocalRepo, MatchingRule, NewClient, NewInvoiceDraft, NewPrepaidPackage, NewProject,
    NewTimeEntry, ProjectStatus, Repository, RuleKind, RuleSource,
};

use crate::backend::{AiMode, Appearance, Language, Settings};
use crate::i18n::{t, tf};

/// Den gamle apps bundle-id og datamappe.
pub const OLD_IDENTIFIER: &str = "dk.timetrack.desktop";
pub const MARKER: &str = "migrering-0.2.json";
/// Findes, mens en import ikke er afsluttet (fejlet eller afbrudt). Næste
/// start prøver igen og lægger de gamle data til brugerens egne.
const PENDING: &str = "migrering-0.2.paabegyndt";
/// Logget ind: poster fra 0.2, der ikke nåede kontoen (semikolon-CSV).
pub const UNSYNCED_CSV: &str = "ikke-synkroniseret-fra-0.2.csv";

/// Resultatet, gemt i `MARKER`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MigrationReport {
    /// Fandtes der en gammel database?
    pub found: bool,
    pub source: Option<String>,
    pub imported_at: Option<DateTime<Utc>>,
    /// Den gamle app var logget ind på en konto (synk).
    pub was_logged_in: bool,
    /// Den gamle app havde en aktiveret licens (`license.json`).
    pub had_license: bool,
    /// En livstidslicens fra 0.2 er gemt i den nye `license.json`, så appen
    /// ikke er låst efter opgraderingen.
    pub license_moved: bool,
    /// Starttiden på en timer, der kørte i 0.2. Den flyttes ikke og skal
    /// registreres igen, så beskeden nævner den.
    pub running_since: Option<DateTime<Utc>>,
    pub settings: bool,
    pub customers: u32,
    pub projects: u32,
    pub punch_cards: u32,
    pub entries: u32,
    pub invoices: u32,
    pub rules: u32,
    /// Logget ind: poster, der ikke nåede kontoen (gemt i `unsynced_file`).
    pub unsynced_entries: u32,
    pub unsynced_file: Option<String>,
    /// Logget ind: 0.2's lokale fakturaer og regler, som ikke er på kontoen.
    pub local_only_invoices: u32,
    pub local_only_rules: u32,
    /// 0.2's fakturaopsætning (afsender, bank, nummerering) er flyttet. // gendan
    pub invoice_profile: bool,
    /// Danske noter om det, der ikke kunne flyttes.
    pub skipped: Vec<String>,
    /// Fejl, der stoppede importen (den gamle mappe er urørt).
    pub error: Option<String>,
}

impl MigrationReport {
    /// Dansk besked til onboardingen, eller `None`, når der intet er at sige.
    pub fn notice(&self) -> Option<String> {
        if !self.found {
            return None;
        }
        let mut parts = vec![];
        if self.was_logged_in {
            parts.push(t("migrering.logged_in").to_string());
        }
        if self.unsynced_entries > 0 {
            parts.push(tf(
                "migrering.unsynced",
                &[
                    ("count", &self.unsynced_entries.to_string()),
                    ("file", self.unsynced_file.as_deref().unwrap_or(UNSYNCED_CSV)),
                ],
            ));
        }
        if self.was_logged_in && (self.local_only_invoices > 0 || self.local_only_rules > 0) {
            parts.push(tf(
                "migrering.local_only",
                &[
                    ("invoices", &self.local_only_invoices.to_string()),
                    ("rules", &self.local_only_rules.to_string()),
                ],
            ));
        }
        let moved = self.customers + self.projects + self.entries + self.punch_cards;
        if moved > 0 {
            parts.push(tf(
                "migrering.moved",
                &[
                    ("customers", &self.customers.to_string()),
                    ("projects", &self.projects.to_string()),
                    ("entries", &self.entries.to_string()),
                    ("cards", &self.punch_cards.to_string()),
                ],
            ));
        } else if self.settings && !self.was_logged_in {
            parts.push(t("migrering.settings").into());
        }
        if let Some(start) = self.running_since {
            let start = start.with_timezone(&Local).format("%Y-%m-%d %H:%M").to_string();
            parts.push(tf("migrering.running", &[("start", &start)]));
        }
        if self.license_moved {
            parts.push(t("migrering.license_moved").into());
        } else if self.had_license {
            parts.push(t("migrering.license").into());
        }
        if let Some(e) = &self.error {
            parts.push(tf("migrering.error", &[("error", e)]));
        }
        (!parts.is_empty()).then(|| parts.join(". ") + ".")
    }
}

/// Den gamle apps datamappe på denne maskine. `TT_OLD_DATA_DIR` overstyrer
/// (tests og manuel afprøvning).
pub fn old_data_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("TT_OLD_DATA_DIR") {
        return Some(PathBuf::from(d));
    }
    #[cfg(target_os = "windows")]
    {
        let dir = |var: &str| std::env::var_os(var).map(|a| PathBuf::from(a).join(OLD_IDENTIFIER));
        pick_old_dir(dir("APPDATA"), dir("LOCALAPPDATA"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join("Library/Application Support").join(OLD_IDENTIFIER))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join(".local/share").join(OLD_IDENTIFIER))
    }
}

/// Windows: 0.2 lå i `%APPDATA%`, men nogle installationer har databasen i
/// `%LOCALAPPDATA%`. Den første mappe med `timetrack.db` vinder; ellers
/// `%APPDATA%`-mappen (som før).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn pick_old_dir(roaming: Option<PathBuf>, local: Option<PathBuf>) -> Option<PathBuf> {
    let has_db = |d: &Option<PathBuf>| d.as_ref().is_some_and(|d| d.join("timetrack.db").is_file());
    if !has_db(&roaming) && has_db(&local) {
        return local;
    }
    roaming
}

/// Kør importen én gang. Returnerer rapporten (også en gemt fra tidligere).
pub fn run_once(old_dir: &Path, new_dir: &Path, device: tt_data::DeviceInfo) -> MigrationReport {
    let marker = new_dir.join(MARKER);
    if let Ok(s) = std::fs::read_to_string(&marker)
        && let Ok(r) = serde_json::from_str::<MigrationReport>(&s)
    {
        return r;
    }
    let mut report = MigrationReport::default();
    if old_dir.join("timetrack.db").is_file() {
        report.found = true;
        report.source = Some(old_dir.display().to_string());
        report.imported_at = Some(Utc::now());
        // `PENDING` ligger, indtil en import er lykkedes: findes den allerede,
        // er et tidligere forsøg fejlet eller blevet afbrudt.
        let pending = new_dir.join(PENDING);
        let retry = pending.exists();
        let _ = std::fs::create_dir_all(new_dir);
        let _ = std::fs::write(&pending, "");
        if let Err(e) = import(old_dir, new_dir, device, retry, &mut report) {
            report.error = Some(e);
        }
    }
    // Fejlede importen, prøves den igen ved næste start (intet er halvt
    // flyttet; se `import`).
    if report.error.is_some() {
        return report;
    }
    let _ = std::fs::create_dir_all(new_dir);
    if let Ok(json) = serde_json::to_string_pretty(&report)
        && let Err(e) = std::fs::write(&marker, json)
    {
        eprintln!("TT kunne ikke gemme {MARKER}: {e}");
    } else {
        let _ = std::fs::remove_file(new_dir.join(PENDING));
    }
    report
}

fn import(
    old_dir: &Path,
    new_dir: &Path,
    device: tt_data::DeviceInfo,
    retry: bool,
    report: &mut MigrationReport,
) -> Result<(), String> {
    let copy = TempCopy::new()?;
    for name in ["timetrack.db", "timetrack.db-wal"] {
        let from = old_dir.join(name);
        if from.is_file() {
            std::fs::copy(&from, copy.0.join(name))
                .map_err(|e| format!("kan ikke læse {name}: {e}"))?;
        }
    }
    let old = Connection::open_with_flags(
        copy.0.join("timetrack.db"),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("den gamle database kan ikke åbnes: {e}"))?;
    let kv = old_settings(&old);
    report.had_license = old_dir.join("license.json").is_file();
    // Logget ind = en aktiv synk-konto. 0.2 rydder `sync_email` ved logud;
    // `remote_id` alene betyder kun, at brugeren var logget ind engang.
    report.was_logged_in = kv.get("sync_email").is_some_and(|v| !v.trim().is_empty());

    std::fs::create_dir_all(new_dir).map_err(|e| e.to_string())?;
    report.running_since = old
        .query_row(
            "SELECT start_time FROM time_entries WHERE is_running = 1 ORDER BY start_time DESC LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|s| old_instant(&s));
    report.license_moved = move_lifetime_license(old_dir, new_dir);
    if !new_dir.join("settings.json").exists() {
        let mut s = Settings::defaults();
        report.settings = apply_settings(&kv, &mut s, &mut report.skipped);
        keep_old_shortcuts(&mut s, crate::genveje::Os::current());
        let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
        std::fs::write(new_dir.join("settings.json"), json).map_err(|e| e.to_string())?;
    }

    if report.was_logged_in {
        report
            .skipped
            .push(t("migrering.skip.from_account").into());
        return keep_unsynced(&old, new_dir, report);
    }
    let target = new_dir.join("local.db");
    // En lykket import står i selve databasen (`DONE_TABLE`), så den kan
    // aldrig køre to gange, heller ikke hvis markøren ikke blev skrevet.
    if target.exists() && imported_into(&target) {
        report.skipped.push(t("migrering.skip.already").into());
        return Ok(());
    }
    if target.exists() && !retry {
        // Sikkerhed mod dubletter, hvis markøren er slettet efter en lykket
        // import: importér kun ind i en tom database. Efter en fejlet import
        // (`retry`) findes brugerens egne data derimod, og de skal med.
        let repo = LocalRepo::open(&target, device.clone())
            .map_err(|e| format!("den nye database kan ikke åbnes: {e}"))?;
        if !block_on(repo.list_clients(true)).map_err(|e| e.to_string())?.is_empty() {
            report
                .skipped
                .push(t("migrering.skip.already").into());
            return Ok(());
        }
    }
    // Importér altid i en kopi ved siden af (af den eksisterende `local.db`,
    // hvis der er en, ellers en ny) og flyt den på plads, når alt er lykkedes.
    // En fejl undervejs efterlader intet halvt, og brugerens egne data i en
    // eksisterende database røres ikke, før importen er færdig.
    let staging = new_dir.join("local.db.migrering");
    let remove_staging = || {
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", staging.display()));
        }
    };
    remove_staging();
    let result = (|| {
        if target.exists() {
            copy_database(&target, &staging)?;
        }
        let repo = LocalRepo::open(&staging, device)
            .map_err(|e| format!("den nye database kan ikke åbnes: {e}"))?;
        import_data(&old, &repo, &staging, report)?;
        drop(repo);
        // Skriv WAL'en ind i selve filen, så kun én fil skal flyttes, og
        // markér importen i samme fil (flyttes på plads med den).
        let c = Connection::open(&staging).map_err(|e| e.to_string())?;
        c.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {DONE_TABLE} (imported_at TEXT NOT NULL); \
             INSERT INTO {DONE_TABLE} VALUES (datetime('now')); \
             PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"
        ))
        .map_err(|e| e.to_string())?;
        drop(c);
        // Den gamle databases WAL hører ikke til den nye fil.
        for ext in ["-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", target.display()));
        }
        std::fs::rename(&staging, &target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        remove_staging();
    }
    result
}

/// Tabellen i `local.db`, der viser, at 0.2-data er importeret i den.
const DONE_TABLE: &str = "tt_migrering_0_2";

/// Er 0.2-data allerede importeret i `db`? Kan filen ikke læses, svares nej,
/// og importen (som selv åbner filen) melder fejlen.
fn imported_into(db: &Path) -> bool {
    Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|c| {
            c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [DONE_TABLE],
                |r| r.get::<_, i64>(0),
            )
        })
        .is_ok_and(|n| n > 0)
}

/// Konsistent kopi af en SQLite-fil (inkl. det, der endnu ligger i WAL'en).
fn copy_database(from: &Path, to: &Path) -> Result<(), String> {
    let c = Connection::open(from).map_err(|e| format!("den nye database kan ikke åbnes: {e}"))?;
    c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;
    c.execute("VACUUM INTO ?1", [to.to_string_lossy().as_ref()])
        .map_err(|e| format!("den nye database kan ikke kopieres: {e}"))?;
    Ok(())
}

/// 0.2's `license.json` (et bevis fra licensserveren). En livstidslicens
/// gemmes i den nye app, så en betalende lokal bruger ikke er låst efter
/// opgraderingen. Abonnementer (solo/team) hører til kontoen og flyttes ikke.
/// `true`, når den nye app har livstidslicensen med den gamle nøgle.
fn move_lifetime_license(old_dir: &Path, new_dir: &Path) -> bool {
    #[derive(Deserialize)]
    struct OldProof {
        license_key: String,
        tier: String,
    }
    let Some(proof) = std::fs::read_to_string(old_dir.join("license.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<OldProof>(&s).ok())
        .filter(|p| p.tier == "lifetime" && !p.license_key.trim().is_empty())
    else {
        return false;
    };
    use crate::backend::repo::files;
    let key = proof.license_key.trim().to_ascii_uppercase();
    match files::load_license(new_dir) {
        Ok(f) if f.lifetime.as_ref().is_some_and(|l| l.key == key) => true,
        // En anden licens, der allerede er aktiveret i den nye app, røres ikke.
        Ok(f) if f.lifetime.is_some() => false,
        Ok(_) => {
            let now = Utc::now();
            match files::save_lifetime(new_dir, &key, now, now.with_timezone(&Local).date_naive()) {
                Ok(_) => true,
                Err(e) => {
                    eprintln!("TT licensen fra 0.2 kunne ikke gemmes: {e}");
                    false
                }
            }
        }
        Err(e) => {
            eprintln!("TT licensen i den nye datamappe kan ikke læses: {e}");
            false
        }
    }
}

/// Logget ind: poster, der aldrig nåede kontoen, og 0.2's lokale fakturaer og
/// regler (de synkroniseres ikke) må ikke forsvinde i stilhed. De ikke-
/// synkroniserede poster gemmes som CSV i den nye datamappe, og onboardingen
/// siger det. Alt ligger desuden urørt i den gamle mappe.
fn keep_unsynced(old: &Connection, new_dir: &Path, report: &mut MigrationReport) -> Result<(), String> {
    report.local_only_invoices =
        count(old, "SELECT COUNT(*) FROM invoice_drafts WHERE status <> 'draft'") as u32;
    report.local_only_rules = (count(old, "SELECT COUNT(*) FROM classification_rules WHERE is_active = 1")
        + count(old, "SELECT COUNT(*) FROM project_matchers")) as u32;
    let unsynced = rows(
        old,
        "SELECT t.start_time, t.end_time, t.duration, c.name, p.name, t.description
         FROM time_entries t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN clients c ON c.id = COALESCE(t.client_id, p.client_id)
         WHERE t.is_running = 0 AND (t.remote_id IS NULL OR t.synced_at IS NULL)
         ORDER BY t.start_time",
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        },
    )?;
    if unsynced.is_empty() {
        return Ok(());
    }
    // Samme format som eksporten af afviste registreringer (tt_data::unsynced_csv).
    let rows: Vec<_> = unsynced
        .iter()
        .map(|(start, end, secs, client, project, desc)| {
            let s = old_instant(start).map(|t| t.with_timezone(&Local));
            let e = end.as_deref().and_then(old_instant).map(|t| t.with_timezone(&Local));
            tt_data::unsynced_csv::Row {
                date: s.map(|t| t.format("%Y-%m-%d").to_string()).unwrap_or_else(|| start.clone()),
                start: s.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                end: e.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                hours: secs.map(tt_data::unsynced_csv::hours_from_secs).unwrap_or_default(),
                client: client.clone().unwrap_or_default(),
                project: project.clone().unwrap_or_default(),
                description: desc.clone().unwrap_or_default(),
            }
        })
        .collect();
    let csv = tt_data::unsynced_csv::write(&rows);
    let path = new_dir.join(UNSYNCED_CSV);
    std::fs::write(&path, csv).map_err(|e| e.to_string())?;
    report.unsynced_entries = unsynced.len() as u32;
    report.unsynced_file = Some(path.display().to_string());
    Ok(())
}

/// Midlertidig mappe til kopien af den gamle database. Slettes bagefter.
struct TempCopy(PathBuf);

impl TempCopy {
    fn new() -> Result<Self, String> {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let nanos = Utc::now().timestamp_nanos_opt().unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "timetrack-migrering-{}-{n}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(TempCopy(dir))
    }
}

impl Drop for TempCopy {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap_or(0)
}

fn old_settings(c: &Connection) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Ok(mut st) = c.prepare("SELECT key, value FROM settings")
        && let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
    {
        out.extend(rows.flatten());
    }
    out
}

/// Gamle nøgler → nye indstillinger. Returnerer `true`, hvis noget blev flyttet.
/// Den gamle apps faste globale genveje (⌘⇧T timer, ⌘⇧Mellemrum sporing)
/// følger med på macOS, så brugeren kan blive ved med at bruge dem. På
/// Windows er de allerede standarden (`genveje::default_global`).
pub fn keep_old_shortcuts(s: &mut Settings, os: crate::genveje::Os) {
    if os != crate::genveje::Os::Mac {
        return;
    }
    for (action, keys) in crate::genveje::OLD_APP_MAC {
        if let Some(sc) = s.shortcuts.iter_mut().find(|x| x.action == action) {
            sc.keys = keys.to_owned();
        }
    }
}

pub fn apply_settings(
    kv: &HashMap<String, String>,
    s: &mut Settings,
    skipped: &mut Vec<String>,
) -> bool {
    let mut any = false;
    let get = |k: &str| kv.get(k).map(|v| v.trim()).filter(|v| !v.is_empty());
    // gendan: 0.2's Eksport (csv_separator, date_format).
    if let Some(v) = get("csv_separator") {
        s.export.comma = v == "comma";
        any = true;
    }
    if let Some(v) = get("date_format") {
        s.export.iso_dates = v == "YYYY-MM-DD";
        any = true;
    }
    // kalender: 0.2's Indstillinger → Integrationer → iCal-adresse.
    if let Some(v) = get("ical_url") {
        let https = crate::kalenderkilder::ics::normalize_url(v);
        if https.starts_with("https://") {
            s.calendar.ics_url = Some(v.to_string());
            any = true;
        } else {
            skipped.push(t("migrering.skip.ical_http").into());
        }
    }
    if let Some(v) = get("idle_threshold_minutes").and_then(|v| v.parse::<u32>().ok())
        && (1..=120).contains(&v)
    {
        s.tracking.idle_minutes = v;
        any = true;
    }
    if get("auto_start_tracking") == Some("false") {
        s.tracking.enabled = false;
        any = true;
    }
    if let Some(v) = get("excluded_apps") {
        for app in v.split(',').map(str::trim).filter(|a| !a.is_empty()) {
            if !s.tracking.excluded_apps.iter().any(|x| x.eq_ignore_ascii_case(app)) {
                s.tracking.excluded_apps.push(app.to_string());
            }
        }
        any = true;
    }
    if let Some(v) = get("theme") {
        s.appearance = match v {
            "light" => Appearance::Light,
            "dark" => Appearance::Dark,
            _ => Appearance::System,
        };
        any = true;
    }
    if let Some(v) = get("language") {
        s.language = match v {
            "en" => Language::En,
            "de" => Language::De,
            "sv" => Language::Sv,
            "nb" => Language::Nb,
            "es" => Language::Es,
            _ => Language::Da,
        };
        any = true;
    }
    if let Some(cfg) = get("ai_config").and_then(|v| serde_json::from_str::<serde_json::Value>(v).ok()) {
        let provider = cfg.get("provider").and_then(|p| p.as_str()).unwrap_or("");
        match provider {
            "ollama" => {
                let url = cfg
                    .get("base_url")
                    .and_then(|u| u.as_str())
                    .filter(|u| !u.is_empty())
                    .unwrap_or("http://localhost:11434");
                s.ai.mode = AiMode::LocalServer;
                s.ai.local_server = Some(url.to_string());
                any = true;
            }
            "" | "none" => {}
            _ => skipped.push(
                t("migrering.skip.cloud_ai").into(),
            ),
        }
    }
    any
}

fn dec(v: Option<f64>) -> Option<Decimal> {
    v.and_then(|f| Decimal::try_from(f).ok()).map(|d| d.round_dp(2))
}

/// En tid fra den gamle `time_entries`-kolonne: UTC med offset eller lokal
/// naiv væg-tid (se den gamle apps `tid.rs`).
pub fn old_instant(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Some(t.with_timezone(&Utc));
    }
    for f in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(s, f) {
            // Et klokkeslæt i forårets sommertidshul findes ikke lokalt; brug
            // tiden en time senere (som uret viste efter springet).
            let t = Local.from_local_datetime(&n).earliest().or_else(|| {
                Local
                    .from_local_datetime(&(n + chrono::Duration::hours(1)))
                    .earliest()
            });
            return t.map(|t| t.with_timezone(&Utc));
        }
    }
    None
}

fn old_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}

type Rows<T> = Vec<T>;

fn rows<T>(
    c: &Connection,
    sql: &str,
    f: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Rows<T>, String> {
    let mut st = c.prepare(sql).map_err(|e| e.to_string())?;
    let out = st
        .query_map([], f)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<T>>>()
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn has_column(c: &Connection, table: &str, col: &str) -> bool {
    c.prepare(&format!("SELECT {col} FROM {table} LIMIT 0")).is_ok()
}

fn import_data(
    old: &Connection,
    repo: &LocalRepo,
    db: &Path,
    report: &mut MigrationReport,
) -> Result<(), String> {
    let e = |e: tt_data::DataError| e.to_string();
    // Kunder.
    let mut clients: HashMap<String, String> = HashMap::new();
    let mut archived_clients = vec![];
    for (id, name, email, phone, company, cvr, rate, notes, archived) in rows(
        old,
        "SELECT id, name, email, phone, company, cvr, hourly_rate, notes, is_archived FROM clients ORDER BY created_at",
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<f64>>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, i64>(8)? != 0,
            ))
        },
    )? {
        let c = block_on(repo.create_client(NewClient {
            name,
            email,
            phone,
            company,
            cvr_number: cvr,
            notes,
            default_hourly_rate: dec(rate),
            ..Default::default()
        }))
        .map_err(e)?;
        if archived {
            archived_clients.push(c.id.clone());
        }
        clients.insert(id, c.id);
        report.customers += 1;
    }

    // Projekter.
    let mut projects: HashMap<String, String> = HashMap::new();
    let mut project_client: HashMap<String, String> = HashMap::new();
    let est = if has_column(old, "projects", "estimated_hours") { "estimated_hours" } else { "NULL" };
    for (id, client, name, rate, budget, archived) in rows(
        old,
        &format!("SELECT id, client_id, name, hourly_rate, {est}, is_archived FROM projects ORDER BY created_at"),
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<f64>>(3)?,
                r.get::<_, Option<f64>>(4)?,
                r.get::<_, i64>(5)? != 0,
            ))
        },
    )? {
        let client_id = client.and_then(|c| clients.get(&c).cloned());
        let p = block_on(repo.create_project(NewProject {
            name,
            client_id: client_id.clone(),
            hourly_rate: dec(rate),
            budget_hours: dec(budget),
            ..Default::default()
        }))
        .map_err(e)?;
        if archived {
            block_on(repo.set_project_status(&p.id, ProjectStatus::Archived)).map_err(e)?;
        }
        if let Some(c) = client_id {
            project_client.insert(p.id.clone(), c);
        }
        projects.insert(id, p.id);
        report.projects += 1;
    }

    // Klippekort (kun med kunde; web kræver det).
    let mut cards: HashMap<String, String> = HashMap::new();
    let mut inactive_cards = vec![];
    let auto = if has_column(old, "klippekort", "auto_deduct") { "auto_deduct" } else { "1" };
    for (id, client, project, name, total, rate, status, expires, created, auto_deduct) in rows(
        old,
        &format!(
            "SELECT id, client_id, project_id, name, total_hours, hourly_rate, status, expires_at, created_at, {auto} FROM klippekort ORDER BY created_at"
        ),
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, f64>(4)?,
                r.get::<_, Option<f64>>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, i64>(9)? != 0,
            ))
        },
    )? {
        // Kortet kan høre til et projekt uden selv at have kunden.
        let client_id = client.and_then(|c| clients.get(&c).cloned()).or_else(|| {
            project
                .and_then(|p| projects.get(&p))
                .and_then(|p| project_client.get(p).cloned())
        });
        let Some(client_id) = client_id else {
            report.skipped.push(tf("migrering.skip.card_no_client", &[("name", &name)]));
            continue;
        };
        let k = block_on(repo.create_klippekort(NewPrepaidPackage {
            name,
            client_id,
            total_hours: dec(Some(total)).unwrap_or_default(),
            hourly_rate: dec(rate).unwrap_or_default(),
            purchase_date: created.get(..10).unwrap_or("").to_string(),
            expiry_date: expires.as_deref().and_then(old_date).map(|d| d.to_string()),
            auto_deduct: Some(auto_deduct),
            ..Default::default()
        }))
        .map_err(e)?;
        if status != "active" {
            inactive_cards.push(k.id.clone());
        }
        cards.insert(id, k.id);
        report.punch_cards += 1;
    }

    // Poster (ikke en kørende timer).
    let mut entries: HashMap<String, String> = HashMap::new();
    let mut card_fallback = 0;
    for (id, project, client, card, description, start, end, duration, billable) in rows(
        old,
        "SELECT id, project_id, client_id, klippekort_id, description, start_time, end_time, duration, is_billable
         FROM time_entries WHERE is_running = 0 ORDER BY start_time",
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<i64>>(7)?,
                r.get::<_, i64>(8)? != 0,
            ))
        },
    )? {
        let Some(start_at) = old_instant(&start) else {
            report.skipped.push(tf("migrering.skip.bad_start", &[("start", &start)]));
            continue;
        };
        let end_at = end.as_deref().and_then(old_instant);
        let secs = duration
            .filter(|d| *d > 0)
            .or_else(|| end_at.map(|e| (e - start_at).num_seconds()))
            .unwrap_or(0);
        if secs <= 0 {
            continue;
        }
        let project_id = project.and_then(|p| projects.get(&p).cloned());
        let client_id = client
            .and_then(|c| clients.get(&c).cloned())
            .or_else(|| project_id.as_ref().and_then(|p| project_client.get(p).cloned()));
        let mut input = NewTimeEntry {
            project_id,
            client_id,
            description: description.unwrap_or_default(),
            hours: (Decimal::from(secs) / Decimal::from(3600)).round_dp(4),
            date: start_at.with_timezone(&Local).date_naive(),
            start_time: Some(start_at),
            end_time: end_at,
            is_billable: Some(billable),
            prepaid_package_id: card.and_then(|k| cards.get(&k).cloned()),
            ..Default::default()
        };
        let created = match block_on(repo.create_entry(input.clone())) {
            Ok(c) => c,
            // Et udløbet eller opbrugt kort afviser posten. Gem den uden kort.
            Err(_) if input.prepaid_package_id.is_some() => {
                input.prepaid_package_id = None;
                card_fallback += 1;
                block_on(repo.create_entry(input)).map_err(e)?
            }
            Err(err) => return Err(err.to_string()),
        };
        entries.insert(id, created.entry.id);
        report.entries += 1;
    }
    let running = count(old, "SELECT COUNT(*) FROM time_entries WHERE is_running = 1");
    if running > 0 {
        report.skipped.push(
            t("migrering.skip.running").into(),
        );
    }
    if card_fallback > 0 {
        report.skipped.push(format!(
            "{card_fallback} registreringer kunne ikke trækkes fra deres klippekort (udløbet eller opbrugt) og er gemt uden kort"
        ));
    }

    // Fakturaer: kladde med de samme poster, derefter sendt/betalt. Udstedte
    // fakturaer beholder nummer og dato fra 0.2 (sat direkte i `invoices`
    // bagefter), så et nummer, kunden har fået, aldrig skifter. tt-core
    // fortsætter efter det højeste slutnummer, så intet genbruges.
    // "exported" (sendt til Billy) tæller som sendt, så posterne ikke kan
    // faktureres igen.
    let number_col = if has_column(old, "invoice_drafts", "invoice_number") {
        "d.invoice_number"
    } else {
        "NULL"
    };
    let title_col = if has_column(old, "invoice_drafts", "title") { "d.title" } else { "NULL" };
    let mut keep_numbers: Vec<(String, String, String)> = vec![];
    let mut titles: Vec<(String, String)> = vec![];
    let invoices = rows(
        old,
        &format!(
            "SELECT d.id, d.client_id, d.status, d.due_date, d.notes, {number_col}, d.created_at, {title_col} FROM invoice_drafts d ORDER BY d.created_at"
        ),
        |r| {
            Ok((
                (
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                ),
                r.get::<_, Option<String>>(7)?,
            ))
        },
    )?;
    for ((id, client, status, due, notes, number, created), title) in invoices {
        let Some(client_id) = clients.get(&client).cloned() else { continue };
        let mut st = old
            .prepare("SELECT time_entry_id FROM invoice_lines WHERE invoice_id = ?1 AND time_entry_id IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = st
            .query_map([&id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .filter_map(|old_id| entries.get(&old_id).cloned())
            .collect();
        if ids.is_empty() {
            report.skipped.push(t("migrering.skip.invoice_empty").into());
            continue;
        }
        let inv = match block_on(repo.create_invoice_draft(NewInvoiceDraft {
            client_id,
            time_entry_ids: ids,
            notes,
            due_date: due.as_deref().and_then(old_date),
        })) {
            Ok(i) => i,
            Err(err) => {
                report.skipped.push(tf("migrering.skip.invoice", &[("error", &err.to_string())]));
                continue;
            }
        };
        if matches!(status.as_str(), "sent" | "paid" | "exported") {
            block_on(repo.send_invoice(&inv.id)).map_err(e)?;
            if let Some(n) = number.filter(|n| !n.trim().is_empty()) {
                let date = old_instant(&created).unwrap_or_else(Utc::now);
                // Samme tekstform som tt-data selv gemmer (serde).
                let date = serde_json::to_value(date).map_err(|e| e.to_string())?;
                keep_numbers.push((inv.id.clone(), n, date.as_str().unwrap_or_default().to_string()));
            }
        }
        if status == "paid" {
            block_on(repo.mark_invoice_paid(&inv.id, None)).map_err(e)?;
        }
        if let Some(t) = title.filter(|t| !t.trim().is_empty()) {
            titles.push((inv.id.clone(), t.trim().to_string()));
        }
        report.invoices += 1;
    }
    if !keep_numbers.is_empty() || !titles.is_empty() {
        let c = Connection::open(db).map_err(|e| e.to_string())?;
        c.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        for (id, number, date) in keep_numbers {
            c.execute(
                "UPDATE invoices SET invoice_number = ?2, issue_date = ?3 WHERE id = ?1",
                rusqlite::params![id, number, date],
            )
            .map_err(|e| format!("fakturanummer {number}: {e}"))?;
        }
        for (id, title) in titles {
            c.execute("UPDATE invoices SET title = ?2 WHERE id = ?1", rusqlite::params![id, title])
                .map_err(|e| format!("fakturatitel: {e}"))?;
        }
    }

    // Fakturaopsætningen (gendan). Gemmes efter fakturaerne, så tælleren
    // står, hvor 0.2 slap (udstedelserne ovenfor må ikke tælle den op).
    let kv = old_settings(old);
    if let Some(p) = invoice_profile_from_0_2(&kv, report.invoices > 0, &mut report.skipped) {
        repo.save_invoice_profile(p).map_err(e)?;
        report.invoice_profile = true;
    }

    // Regler.
    let mut rules = vec![];
    if has_column(old, "classification_rules", "condition_type") {
        let tc = if has_column(old, "classification_rules", "target_client_id") { "target_client_id" } else { "NULL" };
        for (kind, op, value, project, client, active) in rows(
            old,
            &format!(
                "SELECT condition_type, condition_op, condition_value, target_project_id, {tc}, is_active FROM classification_rules"
            ),
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i64>(5)? != 0,
                ))
            },
        )? {
            if !active {
                continue;
            }
            match rule_from_condition(&kind, &op, &value) {
                Some((k, p)) => rules.push((k, p, project, client)),
                None => report.skipped.push(format!(
                    "Reglen \"{kind} {op} {value}\" kan ikke udtrykkes i den nye app og blev ikke flyttet"
                )),
            }
        }
    }
    if has_column(old, "project_matchers", "kind") {
        let mc = if has_column(old, "project_matchers", "client_id") { "client_id" } else { "NULL" };
        for (kind, value, project, client) in rows(
            old,
            &format!("SELECT kind, value, project_id, {mc} FROM project_matchers"),
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            },
        )? {
            let k = match kind.as_str() {
                "domain" => RuleKind::Domain,
                "git_repo" | "path" => RuleKind::Repo,
                "app" => RuleKind::App,
                "keyword" => RuleKind::TitleTemplate,
                _ => continue,
            };
            rules.push((k, value, project, client));
        }
    }
    for (kind, pattern, project, client) in rules {
        let project_id = project.and_then(|p| projects.get(&p).cloned());
        let client_id = client
            .and_then(|c| clients.get(&c).cloned())
            .or_else(|| project_id.as_ref().and_then(|p| project_client.get(p).cloned()));
        let not_work = project_id.is_none() && client_id.is_none();
        block_on(repo.upsert_rule(MatchingRule {
            id: String::new(),
            kind,
            pattern,
            project_id,
            client_id,
            source: RuleSource::User,
            confirmations: 0,
            not_work,
            updated_at: None,
        }))
        .map_err(e)?;
        report.rules += 1;
    }

    // Arkivér til sidst, så poster kunne bruge kunder og kort.
    for id in inactive_cards {
        block_on(repo.archive_klippekort(&id)).map_err(e)?;
    }
    for id in archived_clients {
        block_on(repo.archive_client(&id)).map_err(e)?;
    }
    let pomodoro: Option<i64> = old
        .query_row("SELECT COUNT(*) FROM pomodoro_sessions", [], |r| r.get(0))
        .optional()
        .ok()
        .flatten();
    if pomodoro.unwrap_or(0) > 0 {
        report.skipped.push(t("migrering.skip.pomodoro").into());
    }
    Ok(())
}

/// Gammel regel (`condition_type`, `condition_op`, `condition_value`) → ny
/// regelart og mønster. Regex kan ikke udtrykkes og giver `None`.
/// 0.2's Indstillinger → Fakturaopsætning (`settings`-nøgler) som
/// fakturaopsætning. `None`, hvis 0.2 hverken havde opsætning eller fakturaer.
/// Ugyldige felter springes over med en note, resten flyttes.
pub fn invoice_profile_from_0_2(
    kv: &HashMap<String, String>,
    had_invoices: bool,
    skipped: &mut Vec<String>,
) -> Option<tt_data::InvoiceProfile> {
    use tt_data::InvoiceProfile;
    const KEYS: &[&str] = &[
        "invoice_number_prefix", "invoice_next_number", "user_cvr", "user_address", "bank_reg",
        "bank_konto", "mobilepay_nr", "payment_terms_days", "invoice_company",
    ];
    let get = |k: &str| kv.get(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    if !had_invoices && !KEYS.iter().any(|k| get(k).is_some()) {
        return None;
    }
    let mut p = InvoiceProfile::default();
    let company = get("invoice_company").or_else(|| get("user_name"));
    type Apply = fn(&mut InvoiceProfile, &str) -> bool;
    let fields: [(Option<String>, &str, Apply); 11] = [
        (company, "firmanavn", |p, v| { p.company_name = v.into(); true }),
        (get("user_cvr"), "CVR", |p, v| { p.cvr = v.into(); true }),
        (get("user_address"), "adresse", |p, v| { p.address = v.into(); true }),
        (get("user_email"), "e-mail", |p, v| { p.email = v.into(); true }),
        (get("user_phone"), "telefon", |p, v| { p.phone = v.into(); true }),
        (get("bank_reg"), "reg.nr.", |p, v| { p.bank_reg = v.into(); true }),
        (get("bank_konto"), "kontonummer", |p, v| { p.bank_account = v.into(); true }),
        (get("mobilepay_nr"), "MobilePay", |p, v| { p.mobilepay = v.into(); true }),
        (get("invoice_number_prefix"), "fakturapræfiks", |p, v| { p.number_prefix = v.into(); true }),
        (get("payment_terms_days"), "betalingsfrist", |p, v| {
            v.parse().map(|d| p.payment_terms_days = d).is_ok()
        }),
        (get("invoice_next_number"), "næste fakturanummer", |p, v| {
            v.parse().map(|n| p.next_number = n).is_ok()
        }),
    ];
    // Hvert felt for sig, så ét ugyldigt felt ikke koster resten.
    for (value, label, apply) in fields {
        let Some(v) = value else { continue };
        let mut probe = InvoiceProfile::default();
        if apply(&mut probe, &v) && probe.validate().is_ok() {
            apply(&mut p, &v);
        } else {
            skipped.push(tf("gendan.migrering.invoice_field", &[("field", label)]));
        }
    }
    Some(p)
}

pub fn rule_from_condition(kind: &str, op: &str, value: &str) -> Option<(RuleKind, String)> {
    let v = value.trim();
    if v.is_empty() || op == "regex" {
        return None;
    }
    let wild = |v: &str| match op {
        "equals" => v.to_string(),
        "starts_with" => format!("{v}*"),
        _ => format!("*{v}*"),
    };
    match kind {
        "app_name" => Some(match op {
            "equals" => (RuleKind::App, v.to_string()),
            _ => (RuleKind::AppKeyword, wild(v)),
        }),
        "window_title" => Some((RuleKind::TitleTemplate, wild(v))),
        "url" => Some((RuleKind::UrlPattern, wild(v))),
        "git_repo" | "context_path" | "file_path" => Some((RuleKind::Repo, v.to_string())),
        _ => None,
    }
}

pub mod laering;

#[cfg(test)]
mod tests;
