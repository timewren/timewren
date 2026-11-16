//! Grænsefladen mellem datalaget (`repo::RepoBackend`, tt-data) og
//! detektionen (`engine`, tt-tracker → tt-matcher → tt-ai).
//!
//! `RepoBackend` implementerer `Backend` og spørger `Detection` om forslag,
//! AI og tilladelser. Detektionen kender kun kunder og projekter, som
//! `RepoBackend` giver den, og opretter aldrig selv poster: rå aktivitet
//! bliver i detektionslaget (spec D3).

use std::path::PathBuf;

use chrono::NaiveDate;

use super::*;

/// Signal om, at noget er ændret, og at UI'et bør hente igen.
pub type ChangeRx = async_channel::Receiver<()>;

/// Brugeren er tilbage efter en lang pause (trackerens idle-signal).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IdleReturnEvent {
    pub start: chrono::DateTime<chrono::Utc>,
    pub end: chrono::DateTime<chrono::Utc>,
    pub duration_secs: i64,
}

pub type IdleRx = async_channel::Receiver<IdleReturnEvent>;

/// Data til matcherens katalog, som ikke står på UI-typerne: kundernes egne
/// domæner (web's `Client.domains`) og udvidelsens site-koblinger (web's
/// `siteMappings.list`, lokalt domæne-reglerne).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WebCatalog {
    /// Kunde-id → domæner (normaliserede, uden "www.").
    pub client_domains: std::collections::HashMap<Id, Vec<String>>,
    pub site_mappings: Vec<WebSiteMapping>,
    /// Brugerens regler (web's `rules.getMatchingRules`, lokalt
    /// `matching_rules`) uden projekternes URL-mønstre, inkl. "ikke arbejde".
    pub rules: Vec<WebRule>,
}

/// En regel fra datalaget: slags + mønster → mål, eller "ikke arbejde".
#[derive(Clone, Debug, PartialEq)]
pub struct WebRule {
    pub id: Id,
    pub kind: tt_data::RuleKind,
    pub pattern: String,
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
    /// Aktiviteten er bevidst ikke arbejde og må aldrig foreslås.
    pub not_work: bool,
}

/// Domæne → projekt og/eller kunde.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WebSiteMapping {
    pub domain: String,
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
    pub usage_count: u32,
}

pub trait Detection: Send + Sync {
    // ---------- Forslag ----------

    /// Forslag for `date` ud fra aktiviteten og kataloget (aktive kunder og
    /// projekter). Bekræftede og afviste forslag er filtreret fra.
    fn suggestions(
        &self,
        date: NaiveDate,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<Vec<Suggestion>>;

    /// Kundedomæner og site-koblinger til kataloget. `RepoBackend` sætter
    /// dem før `suggestions`; de gælder, til de sættes igen.
    fn set_web_catalog(&self, _catalog: WebCatalog) {}

    /// Bekræft eller Ret, trin 1: posten, der skal oprettes for forslaget
    /// (med rettelsen lagt på). Lærer ikke endnu.
    fn entry_for(&self, id: &str, correction: Option<&SuggestionCorrection>) -> Result<EntryInput>;

    /// Bekræft eller Ret, trin 2: posten er gemt. Lærer mønsteret (Ret, hvis
    /// `correction` skifter kunde/projekt, ellers Bekræft) og skjuler forslaget.
    fn confirmed(&self, id: &str, correction: Option<&SuggestionCorrection>, entry_id: &str);

    /// Afvis: lærer og skjuler forslaget.
    fn reject(&self, id: &str) -> Result<()>;

    // ---------- Indstillinger ----------

    /// Sporing og AI er ændret (eller appen er startet): genstart/genkonfigurér
    /// trackeren og byg AI-kæden igen.
    fn apply_settings(&self, settings: &Settings);

    // ---------- AI (tt-ai) ----------

    fn ai_models(&self) -> Result<Vec<LocalModel>>;
    /// Hvorfor den valgte AI ikke virker lige nu (dansk), ellers `None`:
    /// en model, der ikke kunne indlæses, en processor uden AVX2, en server,
    /// der er væk. Forslag fra regler og mønstre virker uanset.
    fn ai_problem(&self) -> Option<String> {
        None
    }
    /// Blokerer, til modellen er hentet og tjekket (SHA256).
    fn download_model(&self, id: &str) -> Result<()>;
    /// Fremskridt for en igangværende hentning, ellers `None`.
    fn model_progress(&self, _id: &str) -> Option<ModelProgress> {
        None
    }
    /// Annullerer en igangværende hentning og rydder den halve fil.
    fn cancel_model_download(&self, _id: &str) {}
    fn delete_model(&self, id: &str) -> Result<()>;
    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>>;
    /// Modeller, andre programmer har hentet (den gemte søgning).
    fn found_models(&self) -> Result<FoundModels> {
        Ok(FoundModels::default())
    }
    /// Søger igen og blokerer, til søgningen er færdig.
    fn rescan_models(&self) -> Result<FoundModels> {
        self.found_models()
    }
    /// Starter Ollama-serveren, hvis den er installeret.
    fn start_ollama(&self) -> Result<()> {
        Err(BackendError::Validation("Ollama kan ikke startes her".into()))
    }
    fn set_cloud_ai_key(&self, provider: CloudAiProvider, key: String) -> Result<()>;
    fn remove_cloud_ai_key(&self, provider: CloudAiProvider) -> Result<()>;

    // ---------- Tilladelser (macOS) ----------

    fn permissions(&self) -> Result<Permissions>;
    fn request_permission(&self, permission: Permission) -> Result<PermissionState>;

    /// Nye forslag eller ændret tilstand (fx et nyt segment fra trackeren).
    fn changes(&self) -> Option<ChangeRx> {
        None
    }

    /// Idle-signalet: brugeren er tilbage efter en pause på mindst den
    /// tærskel, indstillingerne siger. Spørgsmålet stilles af appen (modulet idle).
    fn idle_returns(&self) -> Option<IdleRx> {
        None
    }

    // ---------- Observatøren (se `backend/observer.rs`) ----------

    /// Tidsrum på `date`, som brugeren selv har registreret (poster med
    /// start og slut). Manuelle valg vinder altid: de foreslås ikke igen.
    /// `RepoBackend` sætter dem før `suggestions`.
    fn set_logged_spans(&self, _date: NaiveDate, _spans: Vec<(chrono::NaiveTime, chrono::NaiveTime)>) {}

    /// Dagens poster (alle, også dem uden tidspunkt). Detektionen lærer af
    /// aktiviteten inden for poster med tidspunkt (en timer eller en manuel
    /// post), én gang pr. post. `RepoBackend` sætter dem før `suggestions`.
    fn learn_from_entries(&self, _date: NaiveDate, _entries: &[crate::backend::Entry]) {}

    /// Åbne opgaver, der kan foreslås ud fra git-gren og commits.
    fn set_tasks(&self, _tasks: Vec<Task>) {}

    /// Kortet "Lær TimeTrack at kende" ud fra kataloget.
    fn observer_card(&self, _customers: &[Customer], _projects: &[Project]) -> Result<ObserverCard> {
        Ok(ObserverCard::default())
    }

    /// Alle grupper, også dem, matcheren kender (Aktivitet).
    fn observer_groups(&self, _customers: &[Customer], _projects: &[Project]) -> Result<Vec<ObserverGroup>> {
        Ok(vec![])
    }

    /// Svar på en gruppe. `NewCustomer` er løst til `Target` af `RepoBackend`.
    fn observer_answer(
        &self,
        _group_id: &str,
        _reply: &ObserverReply,
        _customers: &[Customer],
        _projects: &[Project],
    ) -> Result<()> {
        Ok(())
    }

    /// Anonymiseret testsæt (JSON) for de seneste `days` dage med `entries`
    /// som facit. Se `Backend::export_test_set`.
    fn export_test_set(
        &self,
        _entries: &[Entry],
        _customers: &[Customer],
        _projects: &[Project],
        _days: u32,
    ) -> Result<String> {
        Err(BackendError::Validation("Sporing er ikke tilgængelig".into()))
    }

    /// Synkroniserer de lærte mønstre med web (kun cloud). `scope` er
    /// "bruger@org": skifter den, starter synkroniseringen forfra, så
    /// mønstre fra en anden konto aldrig blandes ind. Standard: intet.
    fn sync_patterns(&self, _web: &dyn PatternWeb, _scope: &str) -> Result<PatternSyncReport> {
        Ok(PatternSyncReport::default())
    }

    // ---------- Aktivitet (0.2.25) ----------

    /// Dagens rå aktivitet som blokke. `registered` er dagens poster med
    /// tidspunkt, så blokke under en post vises som registreret.
    fn activity_day(
        &self,
        date: NaiveDate,
        _customers: &[Customer],
        _projects: &[Project],
        _registered: &[RegisteredSpan],
    ) -> Result<ActivityDay> {
        Ok(ActivityDay::empty(date, date))
    }

    /// Poster er oprettet for tidsrummene (unix-sekunder): skjul dem som
    /// forslag, og lær mønsteret, hvis `remember`.
    fn activity_assigned(
        &self,
        _spans: &[(i64, i64)],
        _customer_id: &str,
        _project_id: Option<&str>,
        _remember: bool,
        _customers: &[Customer],
        _projects: &[Project],
    ) {
    }

    fn activity_not_work(&self, _spans: &[(i64, i64)]) -> Result<()> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    fn merge_activity(&self, _span: (i64, i64)) -> Result<()> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    fn split_activity(&self, _span: (i64, i64), _at: i64) -> Result<()> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    fn delete_activity(&self, _spans: &[(i64, i64)]) -> Result<()> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    fn delete_all_activity(&self) -> Result<()> {
        Ok(())
    }
    fn activity_storage(&self) -> Result<ActivityStorage> {
        Ok(ActivityStorage::default())
    }
    fn stored_exclusions(&self) -> Result<Vec<StoredExclusion>> {
        Ok(vec![])
    }
    fn remove_stored_exclusion(&self, _id: i64) -> Result<()> {
        Ok(())
    }

    // ---------- ux-vaelger: regler (backend/regler.rs) ----------

    /// Omfang, de valgte tidsrum kunne have en regel for (højst ét pr. slags).
    fn rule_candidates(&self, _spans: &[(i64, i64)]) -> Vec<(ScopeKind, String)> {
        vec![]
    }

    /// Antal blokke pr. regel (datalagets slags og mønster) på dagene i alt.
    fn rule_hit_counts(&self, rules: &[(tt_data::RuleKind, String)], _days: &[NaiveDate]) -> Vec<usize> {
        vec![0; rules.len()]
    }

    /// Dagens tidsrum, hvor reglen matcher og matcheren (med alle regler og
    /// mønstre) giver målet, og som hverken er afgjort, registreret manuelt
    /// eller "ikke arbejde". `customer` "" = intern tid.
    #[allow(clippy::too_many_arguments)]
    fn rule_open_runs(
        &self,
        _kind: tt_data::RuleKind,
        _pattern: &str,
        _date: NaiveDate,
        _customer: &str,
        _project: Option<&str>,
        _customers: &[Customer],
        _projects: &[Project],
    ) -> Result<Vec<(i64, i64)>> {
        Ok(vec![])
    }

    /// De lærte mønstre som rækker med træffere på dagene.
    fn pattern_rows(&self, _days: &[NaiveDate]) -> Vec<RuleRow> {
        vec![]
    }

    /// Regler og mønstre (rækkernes id), der er slået fra på denne enhed.
    fn disabled_rules(&self) -> std::collections::BTreeSet<Id> {
        Default::default()
    }

    fn set_rule_disabled(&self, _id: &str, _disabled: bool) -> Result<()> {
        Err(BackendError::Validation("Sporing er ikke tilgængelig".into()))
    }

    /// Lært mønster: nyt mål (som et klart svar fra brugeren).
    fn retarget_pattern(&self, _id: &str, _customer_id: Option<Id>, _project_id: Option<Id>) -> Result<()> {
        Err(BackendError::Validation("Sporing er ikke tilgængelig".into()))
    }

    fn forget_pattern(&self, _id: &str) -> Result<()> {
        Err(BackendError::Validation("Sporing er ikke tilgængelig".into()))
    }
}

/// En registrering på dagen set fra Aktivitet: tidsrum og mål.
#[derive(Clone, Debug, PartialEq)]
pub struct RegisteredSpan {
    pub start: i64,
    pub end: i64,
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
}

/// Web's lager for lærte mønstre (`extension.patterns.list/upsert`), som
/// `RepoBackend` giver detektionen ved en synkronisering.
pub trait PatternWeb {
    /// Mønstre ændret siden `since` (web giver 60 s overlap).
    fn list(&self, since: chrono::DateTime<chrono::Utc>) -> tt_data::Result<tt_data::LearnedPatterns>;
    /// Gem mønstre. Web erstatter pr. nøgle (sidste vinder) og fletter ikke.
    fn upsert(&self, patterns: Vec<tt_data::LearnedPatternRecord>) -> tt_data::Result<usize>;
}

/// Hvad en synkronisering af mønstrene gjorde.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PatternSyncReport {
    /// Mønstre hentet fra web.
    pub pulled: usize,
    /// Mønstre sendt og bekræftet af web.
    pub pushed: usize,
    /// Egne ændringer, web afviste (fx et slettet projekt), og som er glemt.
    pub rejected: usize,
}

/// Detektion uden tracker og uden AI: ingen forslag. Bruges i tests og når
/// sporingen ikke kan startes.
#[derive(Default)]
pub struct NoDetection;

impl Detection for NoDetection {
    fn suggestions(&self, _: NaiveDate, _: &[Customer], _: &[Project]) -> Result<Vec<Suggestion>> {
        Ok(vec![])
    }
    fn entry_for(&self, _: &str, _: Option<&SuggestionCorrection>) -> Result<EntryInput> {
        Err(BackendError::NotFound("Forslaget".into()))
    }
    fn confirmed(&self, _: &str, _: Option<&SuggestionCorrection>, _: &str) {}
    fn reject(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn apply_settings(&self, _: &Settings) {}
    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        Ok(vec![])
    }
    fn download_model(&self, _: &str) -> Result<()> {
        Err(BackendError::Validation("AI er ikke tilgængelig".into()))
    }
    fn delete_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        Ok(vec![])
    }
    fn set_cloud_ai_key(&self, _: CloudAiProvider, _: String) -> Result<()> {
        Err(BackendError::Validation("AI er ikke tilgængelig".into()))
    }
    fn remove_cloud_ai_key(&self, _: CloudAiProvider) -> Result<()> {
        Ok(())
    }
    fn permissions(&self) -> Result<Permissions> {
        Ok(Permissions {
            accessibility: PermissionState::NotNeeded,
            screen_recording: PermissionState::NotNeeded,
        })
    }
    fn request_permission(&self, _: Permission) -> Result<PermissionState> {
        Ok(PermissionState::NotNeeded)
    }
}

/// Appens datamappe. `TT_DATA_DIR` vinder (tests, demo). Ellers
/// `~/Library/Application Support/TimeTrack` på macOS og
/// `%APPDATA%\TimeTrack` på Windows. Den gamle Tauri-app bruger
/// `dk.timetrack.desktop`, så de to apps deler ikke filer.
pub fn data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("TT_DATA_DIR") {
        return PathBuf::from(d);
    }
    #[cfg(windows)]
    {
        if let Some(a) = std::env::var_os("APPDATA") {
            return PathBuf::from(a).join("TimeTrack");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(h) = std::env::var_os("HOME") {
            return PathBuf::from(h).join("Library/Application Support/TimeTrack");
        }
    }
    if let Some(h) = std::env::var_os("HOME") {
        return PathBuf::from(h).join(".local/share/timetrack");
    }
    PathBuf::from(".timetrack")
}
