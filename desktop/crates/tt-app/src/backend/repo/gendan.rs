//! Tabte 0.2-funktioner oven på tt-data: fakturaopsætning, titel/forfald/
//! noter og sletning af kladder. Lokal tilstand bruger `LocalRepo` direkte;
//! cloud bruger web's procedurer, hvor de findes.

use std::path::{Path, PathBuf};

use chrono::Local;
use futures_lite::future::block_on;
use tt_data::local::backup as tdb;

use super::licens::Action;
use super::{RepoBackend, files, lock, map};
use crate::backend::{
    Backend as _, BackendError, BackupSummary, Invoice, InvoiceDetails, InvoiceProfile, RestoreResult, Result,
    Settings, validate_settings,
};

/// Mappen i datamappen, sikkerhedskopier før en gendannelse lægges i.
pub const SAFETY_DIR: &str = "sikkerhedskopier";

fn local_only() -> BackendError {
    BackendError::Validation("Backup findes kun i lokal tilstand. Når du er logget ind, ligger dine data på kontoen".into())
}

/// Første ledige sti `dir/stem.ext`, `dir/stem (2).ext`, …
pub(crate) fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut i = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({i}).{ext}"));
        i += 1;
    }
    path
}

fn summary(info: &tdb::BackupInfo) -> Result<BackupSummary> {
    let settings = info.files.get("settings.json");
    if let Some(json) = settings {
        // En backup med ulæselige indstillinger afvises hel (intet halvt).
        let s: Settings = serde_json::from_str(json)
            .map_err(|_| BackendError::Validation("Indstillingerne i backuppen kan ikke læses".into()))?;
        validate_settings(&s)?;
    }
    let n = |v: i64| u32::try_from(v).unwrap_or(u32::MAX);
    Ok(BackupSummary {
        created: info.created_at.map(|d| d.with_timezone(&Local)),
        customers: n(info.clients),
        projects: n(info.projects),
        entries: n(info.entries),
        invoices: n(info.invoices),
        punch_cards: n(info.klippekort),
        has_settings: settings.is_some(),
    })
}

/// Læs og valider en backup (også i cloud, hvor den ikke kan gendannes).
pub(super) fn inspect_backup(path: &Path) -> Result<BackupSummary> {
    let info = tdb::inspect_backup(path).map_err(|e| map::error(e, "Backuppen"))?;
    summary(&info)
}

impl RepoBackend {
    pub(super) fn gendan_invoice_profile(&self) -> Result<Option<InvoiceProfile>> {
        match self.local() {
            Some(l) => l.invoice_profile().map(Some).map_err(|e| map::error(e, "Fakturaopsætningen")),
            None => Ok(None),
        }
    }

    pub(super) fn gendan_save_invoice_profile(&self, profile: InvoiceProfile) -> Result<InvoiceProfile> {
        self.gate(Action::Write)?;
        let Some(l) = self.local() else {
            return Err(BackendError::Validation(
                "Fakturaopsætningen står i web, når du er logget ind".into(),
            ));
        };
        l.save_invoice_profile(profile)
            .map_err(|e| map::error(e, "Fakturaopsætningen"))
    }

    /// Lokal tilstand: en faktura må først udstedes, når afsenderen er
    /// udfyldt (navn, CVR, adresse og en betalingsmåde). Cloud: web tjekker.
    pub(super) fn require_sender(&self) -> Result<()> {
        let Some(profile) = self.gendan_invoice_profile()? else {
            return Ok(());
        };
        let missing = profile.missing();
        if missing.is_empty() {
            return Ok(());
        }
        Err(BackendError::Validation(format!(
            "Udfyld {} under Indstillinger → Faktura, før fakturaen udstedes",
            join_danish(&missing)
        )))
    }

    pub(super) fn gendan_update_invoice_details(&self, id: &str, d: InvoiceDetails) -> Result<Invoice> {
        self.gate(Action::Write)?;
        let inv = match (self.local(), self.cloud()) {
            (Some(l), _) => block_on(l.update_invoice_details(id, d.title, d.due, d.notes)),
            (None, Some(c)) => {
                if d.title.as_deref().is_some_and(|t| !t.trim().is_empty()) {
                    // TODO(web): web's fakturaer har ingen titel.
                    return Err(BackendError::Validation(
                        "Titlen kan kun gemmes i lokal tilstand".into(),
                    ));
                }
                block_on(c.update_invoice_details(id, d.due, d.notes))
            }
            (None, None) => unreachable!("enten lokal eller cloud"),
        }
        .map_err(|e| map::error(e, "Fakturaen"))?;
        let repo = self.repo();
        self.invoice_with_lines(&*repo, &inv)
    }

    pub(super) fn gendan_delete_invoice_draft(&self, id: &str) -> Result<()> {
        self.gate(Action::Write)?;
        match self.local() {
            Some(l) => block_on(l.delete_invoice_draft(id)).map_err(|e| map::error(e, "Fakturaen")),
            // Cloud: web's `extension.invoices.delete`. En server uden den
            // giver "understøtter ikke … endnu" (se `map::error`).
            None => match self.cloud() {
                Some(c) => {
                    block_on(c.delete_invoice_draft(id)).map_err(|e| map::error(e, "Fakturaen"))
                }
                None => unreachable!("enten lokal eller cloud"),
            },
        }
    }
}

impl RepoBackend {
    pub(super) fn gendan_set_punch_card_archived(&self, id: &str, archived: bool) -> Result<()> {
        self.gate(Action::Write)?;
        let res = if archived {
            block_on(self.repo().archive_klippekort(id))
        } else {
            match (self.local(), self.cloud()) {
                (Some(l), _) => block_on(l.unarchive_klippekort(id)),
                (None, Some(c)) => block_on(c.unarchive_klippekort(id)),
                (None, None) => unreachable!("enten lokal eller cloud"),
            }
        };
        res.map_err(|e| map::error(e, "Klippekortet"))
    }

    pub(super) fn gendan_delete_punch_card(&self, id: &str) -> Result<()> {
        self.gate(Action::Write)?;
        match self.local() {
            Some(l) => block_on(l.delete_klippekort(id)).map_err(|e| map::error(e, "Klippekortet")),
            // TODO(web): ext har ingen sletning af klippekort; arkivér i stedet.
            None => Err(BackendError::Validation(
                "Klippekort slettes ikke, når du er logget ind. Arkivér det i stedet".into(),
            )),
        }
    }

    fn settings_text(&self) -> Result<Option<String>> {
        let _g = lock(&self.shared.files);
        let p = files::settings_path(self.dir());
        match std::fs::read_to_string(&p) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(BackendError::Other(format!("indstillingerne kan ikke læses: {e}"))),
        }
    }

    fn write_backup(&self, l: &tt_data::LocalRepo, path: &Path) -> Result<()> {
        let settings = self.settings_text()?;
        let files: Vec<(&str, &str)> = settings.as_deref().map(|s| ("settings.json", s)).into_iter().collect();
        l.export_backup(path, &files).map_err(|e| map::error(e, "Backuppen"))?;
        Ok(())
    }

    pub(super) fn gendan_export_backup(&self, dir: &Path) -> Result<PathBuf> {
        let l = self.local().ok_or_else(local_only)?;
        std::fs::create_dir_all(dir).map_err(|e| BackendError::Other(e.to_string()))?;
        let stem = format!("{}-backup-{}", tt_core::edition::EDITION.id, self.today());
        let path = unique_path(dir, &stem, tdb::BACKUP_EXTENSION);
        self.write_backup(&l, &path)?;
        Ok(path)
    }

    /// Validér, tag en sikkerhedskopi, gendan databasen (alt eller intet) og
    /// til sidst indstillingerne (atomisk filskift).
    pub(super) fn gendan_restore_backup(&self, path: &Path) -> Result<RestoreResult> {
        self.gate(Action::Write)?;
        let l = self.local().ok_or_else(local_only)?;
        let info = tdb::inspect_backup(path).map_err(|e| map::error(e, "Backuppen"))?;
        let summary = summary(&info)?;
        let settings: Option<Settings> = info
            .files
            .get("settings.json")
            .map(|j| serde_json::from_str(j))
            .transpose()
            .map_err(|_| BackendError::Validation("Indstillingerne i backuppen kan ikke læses".into()))?;
        let dir = self.dir().join(SAFETY_DIR);
        std::fs::create_dir_all(&dir).map_err(|e| BackendError::Other(e.to_string()))?;
        let stem = format!("foer-gendannelse-{}", Local::now().format("%Y%m%d-%H%M%S"));
        let safety_copy = unique_path(&dir, &stem, tdb::BACKUP_EXTENSION);
        self.write_backup(&l, &safety_copy)?;
        // Herfra kan data være skiftet: fejl nævner sikkerhedskopien.
        let with_copy = |e: BackendError| {
            BackendError::Other(format!(
                "{e}. Dine tidligere data ligger i {}",
                safety_copy.display()
            ))
        };
        l.restore_backup(path).map_err(|e| with_copy(map::error(e, "Backuppen")))?;
        if let Some(mut s) = settings {
            // AI-nøglerne ligger i denne maskines nøglering, ikke i backuppen.
            if let Ok(current) = self.settings() {
                s.ai.cloud_keys = current.ai.cloud_keys;
            }
            {
                let _g = lock(&self.shared.files);
                files::store_settings(self.dir(), &s).map_err(with_copy)?;
            }
            self.apply_settings(&s);
        }
        Ok(RestoreResult { summary, safety_copy })
    }
}

/// "a, b og c".
pub(crate) fn join_danish(items: &[&str]) -> String {
    match items {
        [] => String::new(),
        [one] => (*one).to_string(),
        [rest @ .., last] => format!("{} og {last}", rest.join(", ")),
    }
}

#[cfg(test)]
mod tests {
    use super::join_danish;

    #[test]
    fn dansk_opremsning() {
        assert_eq!(join_danish(&["CVR"]), "CVR");
        assert_eq!(join_danish(&["CVR", "adresse"]), "CVR og adresse");
        assert_eq!(join_danish(&["firmanavn", "CVR", "adresse"]), "firmanavn, CVR og adresse");
    }
}
