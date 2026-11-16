//! Backup og gendannelse af den lokale database (som 0.2's Indstillinger →
//! Backup). En backup er én SQLite-fil: en kopi af `local.db` (`VACUUM
//! INTO`) med en ekstra tabel `tt_backup`, der har formatet, tidspunktet og
//! appens filer (fx `settings.json`). Gendannelse validerer filen, kopierer
//! den ind med SQLite's backup-API under databasens lås (alt eller intet) og
//! kører manglende migrationer bagefter.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags, OptionalExtension};

use super::{LocalRepo, migrations};
use crate::error::{DataError, Result};
use crate::events::Entity;

/// Formatet i `tt_backup.format`. Ændres kun, hvis filen ikke kan læses af ældre apps.
pub const BACKUP_FORMAT: &str = "timetrack-backup-1";
/// Filendelsen, appen foreslår.
pub const BACKUP_EXTENSION: &str = "ttbackup";

/// Det, en backup indeholder (vises før gendannelse).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupInfo {
    pub created_at: Option<DateTime<Utc>>,
    /// Databasens version (`PRAGMA user_version`).
    pub schema_version: u32,
    pub clients: i64,
    pub projects: i64,
    pub entries: i64,
    pub invoices: i64,
    pub klippekort: i64,
    /// Appens filer i backuppen (navn → indhold).
    pub files: BTreeMap<String, String>,
}

fn invalid(msg: &str) -> DataError {
    DataError::Validation(msg.to_owned())
}

fn count(c: &Connection, table: &str) -> Result<i64> {
    Ok(c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?)
}

/// Læs og valider en backup uden at ændre noget. Afviser filer, der ikke
/// er SQLite, er beskadigede, ikke er en TimeTrack-backup eller er fra en
/// nyere version af appen.
pub fn inspect_backup(path: &Path) -> Result<BackupInfo> {
    if !path.is_file() {
        return Err(invalid("Filen findes ikke"));
    }
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|_| invalid("Filen er ikke en TimeTrack-backup"))?;
    let check: String = c
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| invalid("Filen er ikke en TimeTrack-backup"))?;
    if check != "ok" {
        return Err(invalid("Backuppen er beskadiget"));
    }
    let has_meta: Option<String> = c
        .query_row("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tt_backup'", [], |r| r.get(0))
        .optional()?;
    if has_meta.is_none() {
        return Err(invalid("Filen er ikke en TimeTrack-backup"));
    }
    let mut meta = BTreeMap::new();
    let mut st = c.prepare("SELECT key, value FROM tt_backup")?;
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = row?;
        meta.insert(k, v);
    }
    if meta.get("format").map(String::as_str) != Some(BACKUP_FORMAT) {
        return Err(invalid("Backuppen er i et ukendt format"));
    }
    let schema_version: u32 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if schema_version as usize > migrations::MIGRATIONS.len() {
        return Err(invalid("Backuppen er fra en nyere version af TimeTrack. Opdatér appen først"));
    }
    for t in ["clients", "projects", "time_entries", "invoices", "prepaid_packages", "settings"] {
        let found: Option<String> = c
            .query_row("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1", [t], |r| r.get(0))
            .optional()?;
        if found.is_none() {
            return Err(invalid("Backuppen mangler data (ufuldstændig fil)"));
        }
    }
    // En håndlavet fil må ikke bringe triggere eller views ind i den levende database.
    let extra: i64 = c.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('trigger', 'view')",
        [],
        |r| r.get(0),
    )?;
    if extra > 0 {
        return Err(invalid("Backuppen indeholder ukendte dele og afvises"));
    }
    let files = meta
        .iter()
        .filter_map(|(k, v)| k.strip_prefix("file:").map(|n| (n.to_owned(), v.clone())))
        .collect();
    Ok(BackupInfo {
        created_at: meta
            .get("created_at")
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc)),
        schema_version,
        clients: count(&c, "clients")?,
        projects: count(&c, "projects")?,
        entries: count(&c, "time_entries")?,
        invoices: count(&c, "invoices")?,
        klippekort: count(&c, "prepaid_packages")?,
        files,
    })
}

impl LocalRepo {
    /// Skriv en backup til `path` (må ikke findes). `files` er appens filer
    /// (navn, indhold), fx `("settings.json", …)`. Filen skrives ved siden af
    /// og flyttes på plads til sidst, så en halv backup aldrig ligger der.
    pub fn export_backup(&self, path: &Path, files: &[(&str, &str)]) -> Result<BackupInfo> {
        if path.exists() {
            return Err(invalid("Filen findes allerede"));
        }
        let tmp = PathBuf::from(format!("{}.tmp", path.display()));
        let _ = std::fs::remove_file(&tmp);
        let now = (self.inner.clock)();
        let result = (|| {
            self.run_sync(|c| {
                c.execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()])?;
                Ok(())
            })?;
            let out = Connection::open(&tmp)?;
            out.execute_batch("CREATE TABLE tt_backup (key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
            let put = |k: &str, v: &str| out.execute("INSERT INTO tt_backup (key, value) VALUES (?1, ?2)", [k, v]);
            put("format", BACKUP_FORMAT)?;
            put("created_at", &now.to_rfc3339())?;
            put("device", &self.inner.device.device_name)?;
            put("app_version", &self.inner.device.app_version)?;
            for (name, content) in files {
                put(&format!("file:{name}"), content)?;
            }
            drop(out);
            std::fs::rename(&tmp, path).map_err(|e| DataError::Storage(e.to_string()))?;
            inspect_backup(path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result
    }

    /// Erstat alle data med backuppen i `path`. Valideres først; selve
    /// kopieringen sker under databasens lås og er alt eller intet. Tag selv
    /// en sikkerhedskopi med `export_backup` før.
    pub fn restore_backup(&self, path: &Path) -> Result<BackupInfo> {
        let info = inspect_backup(path)?;
        self.run_sync(|c| {
            c.restore(rusqlite::MAIN_DB, path, None::<fn(rusqlite::backup::Progress)>)?;
            c.execute_batch("DROP TABLE IF EXISTS tt_backup;")?;
            c.pragma_update(None, "foreign_keys", "ON")?;
            migrations::migrate(c)?;
            Ok(())
        })?;
        self.changed(&Entity::ALL);
        Ok(info)
    }
}
