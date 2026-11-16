//! Lærte mønstre i cloud: `RepoBackend` giver detektionen web's
//! `extension.patterns.list/upsert` (via tt-data) og kører
//! synkroniseringen periodisk, efter læring, ved login, når web melder
//! ændrede regler/mønstre, og når forbindelsen er tilbage. Lokal tilstand
//! synkroniserer ikke. Selve algoritmen står i `engine/pattern_sync.rs`.

use std::sync::mpsc;
use std::time::Duration;

use super::*;
use crate::backend::services::{PatternSyncReport, PatternWeb};

/// Hvor ofte mønstrene synkroniseres uden anden anledning.
const INTERVAL: Duration = Duration::from_secs(10 * 60);
/// Flere udløsere tæt på hinanden (Bekræft dag) bliver til én runde.
const DEBOUNCE: Duration = Duration::from_secs(3);

/// Web's mønsterlager gennem datalaget.
struct RepoPatternWeb(Arc<dyn Repository>);

impl PatternWeb for RepoPatternWeb {
    fn list(&self, since: DateTime<Utc>) -> td::Result<td::LearnedPatterns> {
        block_on(self.0.learned_patterns(Some(since)))
    }

    fn upsert(&self, patterns: Vec<td::LearnedPatternRecord>) -> td::Result<usize> {
        block_on(self.0.upsert_learned_patterns(patterns))
    }
}

impl Shared {
    /// Én runde, hvis cloud er aktiv og der er en bruger og en org.
    fn sync_patterns(&self) -> Result<PatternSyncReport> {
        let cloud = match &*read(&self.active) {
            Active::Cloud(c) => c.clone(),
            Active::Local(_) => return Ok(PatternSyncReport::default()),
        };
        let session = block_on(cloud.session()).map_err(|e| map::error(e, "Kontoen"))?;
        let Some(user) = session.user else {
            return Ok(PatternSyncReport::default());
        };
        // Uden valgt org gælder tokenets egen org på web.
        let org = session.organization_id.unwrap_or_else(|| "token".into());
        let scope = format!("{}@{}", user.id, org);
        self.opts
            .detection
            .sync_patterns(&RepoPatternWeb(Arc::new(cloud)), &scope)
    }

    /// Bed baggrundstråden om en runde snart (ingen effekt uden tråd).
    pub(super) fn trigger_pattern_sync(&self) {
        if let Some(tx) = lock(&self.pattern_sync).as_ref() {
            let _ = tx.send(());
        }
    }

    /// Start baggrundstråden. Den stopper, når backend'en droppes.
    pub(super) fn start_pattern_sync(self: &Arc<Self>) {
        if !self.opts.pattern_sync {
            return;
        }
        let (tx, rx) = mpsc::channel::<()>();
        *lock(&self.pattern_sync) = Some(tx);
        let weak = Arc::downgrade(self);
        let spawned = std::thread::Builder::new()
            .name("tt-pattern-sync".into())
            .spawn(move || {
                loop {
                    match rx.recv_timeout(INTERVAL) {
                        Ok(()) => {
                            std::thread::sleep(DEBOUNCE);
                            while rx.try_recv().is_ok() {}
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                    let Some(shared) = weak.upgrade() else { break };
                    if let Err(e) = shared.sync_patterns() {
                        // Offline o.l.: de egne ændringer venter til næste runde.
                        eprintln!("TT: mønstrene blev ikke synkroniseret: {e}");
                    }
                }
            });
        if let Err(e) = spawned {
            eprintln!("TT: kan ikke starte synkroniseringen af mønstre: {e}");
        }
    }
}

impl RepoBackend {
    /// Synkroniser de lærte mønstre med web nu (cloud; lokalt intet).
    pub fn sync_patterns_now(&self) -> Result<PatternSyncReport> {
        self.shared.sync_patterns()
    }
}
