//! Detektionsmotoren: tracker → matcher → AI, bag `Detection`-traitet.
//!
//! ```text
//! tt-tracker (OS-tråd) ──► activity.db ──┐
//!                                        ▼
//! suggestions(dato, kunder, projekter): segmenter → Matcher::suggest
//!        → (uklare blokke) AI-kæden → UI's Suggestion
//! confirmed / reject: Matcher lærer → patterns.json, tidsrummet skjules
//! ```
//!
//! Rå aktivitet forlader aldrig motoren: UI'et ser kun [`Suggestion`]er, og
//! AI-kæden får kun rensede titler, og kun til en cloud-udbyder, hvis
//! brugeren har valgt cloud. Se `RAPPORT-integration-engine.md`.
//!
//! App-roden starter motoren sådan (på en baggrundstråd er bedre, for
//! `apply_settings` kan åbne nøgleringen og lede efter lokale servere):
//!
//! ```ignore
//! let engine = Arc::new(Engine::native(backend::services::data_dir()));
//! engine.apply_settings(&settings);          // starter sporingen, bygger AI-kæden
//! let backend = RepoBackend::new(repo, engine.clone());
//! ```

mod ai;
// Aktivitet: rå aktivitet som blokke og handlingerne på dem (0.2.25).
mod aktivitet;
mod convert;
mod modeller;
mod observer;
mod pattern_sync;
// ux-vaelger: "Altid sådan" og regeloversigten.
mod regler;
pub(crate) mod state;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::Duration;

use chrono::{Local, NaiveDate, NaiveTime, TimeZone};
use tt_ai as tai;
use tt_matcher as mm;
use tt_tracker as tr;

use crate::backend::services::{ChangeRx, Detection, IdleReturnEvent, IdleRx, WebCatalog};
use crate::backend::{
    AiMode, BackendError, CloudAiProvider, Customer, EntryInput, FoundModels, LocalAiServer,
    LocalModel, ModelProgress,
    Permission, PermissionState, Permissions, Project, Result, Settings, Suggestion,
    SuggestionCorrection,
};

pub use ai::{DEFAULT_BUDGET, DEFAULT_MAX_NEW_QUESTIONS};
use state::{HandledStore, Handling};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn other(msg: impl Into<String>) -> BackendError {
    BackendError::Other(msg.into())
}

/// Hvad sporingen laver lige nu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackingState {
    /// Ingen tracker er startet (slået fra, eller ingen platform).
    NotStarted,
    Running,
    /// Startet, men sat på pause fordi sporing er slået fra i indstillingerne.
    Paused,
}

/// En igangværende modelhentning: annulleringsflag og fremskridt, som UI'et
/// læser mens `download_model` blokerer på en baggrundstråd.
struct Download {
    cancel: AtomicBool,
    downloaded: AtomicU64,
    total: AtomicU64,
}

impl Download {
    fn new(total: u64) -> Self {
        Download {
            cancel: AtomicBool::new(false),
            downloaded: AtomicU64::new(0),
            total: AtomicU64::new(total),
        }
    }
}

struct PatternState {
    store: mm::PatternStore,
    /// Brugerens model (kalibrering, Naive Bayes, udglatning): `model.json`.
    /// Lokal, synkroniseres aldrig.
    model: mm::UserModel,
    /// Stiger, når mønstrene ændres. Bruges til ikke at overskrive en
    /// rettelse med AI-svar, der blev beregnet før den.
    generation: u64,
    /// Synkroniseringen med web (cloud). Gemmes sammen med mønstrene.
    sync: pattern_sync::SyncState,
}

/// `patterns.json`: mønstrene (som `PatternStore`, så en ældre version kan
/// læse filen) og synkroniseringens tilstand i én atomisk skrivning.
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct PatternFile {
    #[serde(flatten)]
    store: mm::PatternStore,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sync: Option<pattern_sync::SyncState>,
}

/// Et forslag, motoren kan finde igen, når brugeren bekræfter eller afviser.
struct Cached {
    date: NaiveDate,
    ui: Suggestion,
    block: mm::Suggestion,
    segments: Arc<Vec<mm::ActivitySegment>>,
    catalog: Arc<mm::Catalog>,
    /// Kædens nøgle, hvis AI'en svarede. Bruges til at glemme et rettet svar.
    ai_key: Option<tai::QuestionKey>,
}

pub struct Engine {
    dir: PathBuf,
    store: Mutex<Option<tr::ActivityStore>>,
    platform: Mutex<Option<Box<dyn tr::Platform>>>,
    tracker: Mutex<Option<tr::Tracker>>,
    changes_tx: async_channel::Sender<()>,
    changes_rx: ChangeRx,
    idle_tx: async_channel::Sender<IdleReturnEvent>,
    idle_rx: IdleRx,
    patterns: Mutex<PatternState>,
    /// Hvilke mål brugeren bruger, så AI-kandidaterne kan rangeres efter nylighed og frekvens.
    usage: Mutex<mm::UsageStore>,
    handled: Mutex<HandledStore>,
    cache: Mutex<HashMap<String, Cached>>,
    chain: RwLock<Option<Arc<tai::ProviderChain>>>,
    secrets: Arc<dyn tai::SecretStore>,
    models: tai::ModelManager,
    /// Modeller andre programmer har hentet (gemt søgning og baggrundssøgning).
    found: Arc<modeller::FoundStore>,
    downloading: Mutex<HashMap<String, Arc<Download>>>,
    servers: Mutex<Vec<tai::DiscoveredServer>>,
    settings: Mutex<Option<Settings>>,
    budget: (Duration, usize),
    state_warnings: Vec<String>,
    ai_warnings: Mutex<Vec<String>>,
    /// Seneste fejl fra kæden (fx en model, der ikke kunne indlæses), til
    /// Indstillinger → AI. Ryddes, når kæden svarer igen eller bygges om.
    ai_failure: Mutex<Option<String>>,
    /// Kundedomæner og site-koblinger fra datalaget (`set_web_catalog`).
    web: Mutex<WebCatalog>,
    /// Kun én synkronisering af mønstrene ad gangen.
    pattern_sync: Mutex<()>,
    /// Aktivitet: "ikke arbejde", fletninger og delinger (`aktivitet.json`).
    edits: Mutex<aktivitet::ActivityEdits>,
    /// Identiteter og regler flyttet fra 0.2 (`laering-0.2.json`).
    local_learning: state::LocalLearning,
    /// Observatøren ("Lær TimeTrack at kende"), manuelle tidsrum og opgaver.
    observer: Mutex<observer::ObserverRuntime>,
    /// Dagens poster med tidspunkt og mål (`learn_from_entries`).
    entries: Mutex<HashMap<NaiveDate, Vec<LoggedEntry>>>,
}

/// En post med tidspunkt: (nøgle, start, slut, mål).
type LoggedEntry = (String, i64, i64, mm::Target);

impl Engine {
    /// Motor på datamappen `dir`. `platform` er det, trackeren læser
    /// forgrundsvinduet fra: `Some(tt_tracker::native())` i appen,
    /// `Some(ScriptedPlatform)` i demo og tests, `None` uden sporing (så virker
    /// forslag, læring, AI og tilladelser stadig mod en eksisterende
    /// aktivitets-DB).
    ///
    /// Sporingen starter først i `apply_settings` og kun, hvis den er slået til.
    pub fn new(dir: PathBuf, platform: Option<Box<dyn tr::Platform>>) -> Self {
        let mut warnings = Vec::new();
        let now = unix_now();
        let store = match tr::ActivityStore::open(&dir.join("activity.db")) {
            Ok(s) => Some(s),
            Err(e) => {
                warnings.push(format!("Aktivitetsdatabasen kunne ikke åbnes: {e}"));
                None
            }
        };
        let patterns =
            state::read_json::<PatternFile>(&dir.join("patterns.json"), &mut warnings)
                .unwrap_or_default();
        let model = state::read_json::<mm::UserModel>(&dir.join("model.json"), &mut warnings)
            .unwrap_or_default();
        let usage = state::read_json::<mm::UsageStore>(&dir.join("usage.json"), &mut warnings)
            .unwrap_or_default();
        let handled = HandledStore::load(dir.join("handled.json"), now, &mut warnings);
        let edits = Self::load_edits(&dir, &mut warnings);
        let local_learning = state::read_json::<state::LocalLearning>(
            &dir.join(state::LOCAL_LEARNING),
            &mut warnings,
        )
        .unwrap_or_default();
        let observer = observer::load(&dir, &mut warnings);
        let (changes_tx, changes_rx) = async_channel::bounded(1);
        let (idle_tx, idle_rx) = async_channel::bounded(8);
        Engine {
            models: tai::ModelManager::new(dir.join("ai").join("models")),
            found: Arc::new(modeller::FoundStore::new(&dir)),
            dir,
            store: Mutex::new(store),
            platform: Mutex::new(platform),
            tracker: Mutex::new(None),
            changes_tx,
            changes_rx,
            idle_tx,
            idle_rx,
            patterns: Mutex::new(PatternState {
                store: patterns.store,
                model,
                generation: 0,
                sync: patterns.sync.unwrap_or_default(),
            }),
            usage: Mutex::new(usage),
            handled: Mutex::new(handled),
            cache: Mutex::new(HashMap::new()),
            chain: RwLock::new(None),
            secrets: Arc::new(ai::OsSecrets::default()),
            downloading: Mutex::new(HashMap::new()),
            servers: Mutex::new(Vec::new()),
            settings: Mutex::new(None),
            budget: (DEFAULT_BUDGET, DEFAULT_MAX_NEW_QUESTIONS),
            state_warnings: warnings,
            ai_warnings: Mutex::new(Vec::new()),
            ai_failure: Mutex::new(None),
            web: Mutex::new(WebCatalog::default()),
            pattern_sync: Mutex::new(()),
            edits: Mutex::new(edits),
            local_learning,
            observer: Mutex::new(observer),
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// Motor med den rigtige platform (macOS/Windows).
    pub fn native(dir: PathBuf) -> Self {
        Self::new(dir, Some(tr::native()))
    }

    /// Andre nøglelager end OS-nøgleringen (tests: `MemorySecrets`).
    pub fn with_secrets(mut self, secrets: Arc<dyn tai::SecretStore>) -> Self {
        self.secrets = secrets;
        self
    }

    /// Hvor længe og hvor mange nye AI-spørgsmål en `suggestions`-forespørgsel
    /// højst bruger. Se [`DEFAULT_BUDGET`].
    pub fn with_ai_budget(mut self, time: Duration, max_new_questions: usize) -> Self {
        self.budget = (time, max_new_questions);
        self
    }

    /// Sætter AI-kæden direkte (tests og demo). `apply_settings` bygger den om.
    pub fn set_ai_chain(&self, chain: Option<Arc<tai::ProviderChain>>) {
        *self.chain.write().unwrap_or_else(|p| p.into_inner()) = chain;
    }

    pub fn data_dir(&self) -> &std::path::Path {
        &self.dir
    }

    /// Advarsler til indstillingerne og loggen: ødelagte filer, AI-udbydere,
    /// der ikke kunne bygges. Tom, når alt er i orden.
    pub fn warnings(&self) -> Vec<String> {
        let mut w = self.state_warnings.clone();
        w.extend(lock(&self.ai_warnings).iter().cloned());
        w
    }

    pub fn tracking_state(&self) -> TrackingState {
        match lock(&self.tracker).as_ref() {
            None => TrackingState::NotStarted,
            Some(t) if t.is_paused() => TrackingState::Paused,
            Some(_) => TrackingState::Running,
        }
    }

    /// Stop sporingen for altid og gem det igangværende segment (appen
    /// afsluttes). Venter, til trackerens tråd har skrevet det.
    pub fn stop_tracking(&self) {
        let tracker = lock(&self.tracker).take();
        if let Some(t) = tracker {
            t.stop();
        }
    }

    /// Det aktive vindue lige nu som programnavn (til tray og tidslinje).
    /// Kun appens navn og varighed, aldrig titler eller URL'er.
    pub fn current_app(&self) -> Option<String> {
        lock(&self.tracker)
            .as_ref()
            .and_then(|t| t.current())
            .map(|s| s.app)
    }

    /// Trackerens igangværende segment (til mødedetektionen i
    /// `kalenderkilder`, som også er detektionslag). `None` uden sporing,
    /// på pause eller uden input.
    pub fn current_segment(&self) -> Option<tr::ActivitySegment> {
        let t = lock(&self.tracker);
        let t = t.as_ref()?;
        (!t.is_paused()).then(|| t.current()).flatten()
    }

    /// Udbydere, der har en gemt nøgle (til `AiSettings.cloud_keys`). Rører
    /// nøgleringen, så kald den, når indstillingerne indlæses, ikke i en løkke.
    pub fn cloud_keys(&self) -> Vec<CloudAiProvider> {
        CloudAiProvider::ALL
            .into_iter()
            .filter(|p| {
                self.secrets
                    .get(&tai::api_key_name(ai::provider_kind(*p)))
                    .ok()
                    .flatten()
                    .is_some_and(|k| !k.is_empty())
            })
            .collect()
    }

    /// Giver `changes()` et signal (fx efter en ændring et andet sted).
    pub fn signal_change(&self) {
        let _ = self.changes_tx.try_send(());
    }

    // ---------- sporing ----------

    fn apply_tracking(&self, config: tr::TrackerConfig, enabled: bool) {
        let mut tracker = lock(&self.tracker);
        if let Some(t) = tracker.as_ref() {
            t.set_config(config);
            if enabled {
                t.resume();
            } else {
                t.pause();
            }
            return;
        }
        if !enabled {
            return;
        }
        let Some(platform) = lock(&self.platform).take() else {
            return;
        };
        let tx = self.changes_tx.clone();
        let idle_tx = self.idle_tx.clone();
        let sink: tr::EventSink = Box::new(move |ev| match ev {
            tr::TrackerEvent::Segment(_) => {
                let _ = tx.try_send(());
            }
            tr::TrackerEvent::IdleReturn {
                start,
                end,
                duration_secs,
            } => {
                let _ = idle_tx.try_send(IdleReturnEvent {
                    start,
                    end,
                    duration_secs,
                });
                let _ = tx.try_send(());
            }
            // Teksten kan indeholde stier; kun slags fejl i loggen.
            tr::TrackerEvent::Error(_) => eprintln!("TimeTrack: trackeren meldte en fejl"),
        });
        match tr::Tracker::start(config, Some(self.dir.join("activity.db")), platform, sink) {
            Ok(t) => *tracker = Some(t),
            Err(e) => eprintln!("TimeTrack: sporingen kunne ikke startes: {e}"),
        }
    }

    // ---------- AI ----------

    fn chain(&self) -> Option<Arc<tai::ProviderChain>> {
        self.chain.read().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn cache_path(&self) -> PathBuf {
        self.dir.join("ai").join("cache.json")
    }

    fn save_chain_cache(&self, chain: &tai::ProviderChain) {
        let path = self.cache_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = chain.save_cache(&path) {
            eprintln!("TimeTrack: AI-cachen kunne ikke gemmes: {e}");
        }
    }

    /// Fundne servere. Findes den ønskede ikke i den gemte liste, ledes der
    /// efter nye (højst ca. 0,6 s, portene prøves parallelt).
    fn servers_for(&self, wanted: Option<&str>, model: Option<&str>) -> Vec<tai::DiscoveredServer> {
        let same = |s: &tai::DiscoveredServer, w: &str| {
            s.base_url.trim_end_matches('/') == w.trim_end_matches('/')
        };
        let has = |list: &[tai::DiscoveredServer]| {
            wanted.is_some_and(|w| list.iter().any(|s| same(s, w)))
        };
        let mut known = lock(&self.servers).clone();
        if has(&known) {
            // Kender vi serveren, men ikke den valgte model, kan brugeren have
            // hentet den siden sidst: spørg kun den ene server igen.
            if let (Some(w), Some(m)) = (wanted, model)
                && let Some(s) = known.iter_mut().find(|s| same(s, w))
                && !s.models.iter().any(|x| x == m)
                && let Ok(models) =
                    tai::refresh_models(s.kind, &s.base_url, tai::discovery::PROBE_TIMEOUT)
            {
                s.models = models;
                *lock(&self.servers) = known.clone();
            }
            return known;
        }
        let found = tai::discover_default(&[]);
        *lock(&self.servers) = found.clone();
        found
    }

    /// Bygger kæden ud fra de seneste indstillinger.
    fn rebuild_ai(&self) {
        let Some(settings) = lock(&self.settings).clone() else {
            return;
        };
        let ui = &settings.ai;
        let servers = if ui.mode == AiMode::LocalServer {
            self.servers_for(ui.local_server.as_deref(), ui.local_model.as_deref())
        } else {
            Vec::new()
        };
        let plan = ai::plan(ui, &servers);
        let mut warnings = plan.warnings.clone();
        let local = if plan.wants_local {
            let home = convert::home_dir();
            match ai::local_classifier(&self.models, ui.builtin_model.as_deref(), home.as_deref())
            {
                Ok((c, note)) => {
                    warnings.extend(note);
                    Some(c)
                }
                Err(e) => {
                    warnings.push(e);
                    None
                }
            }
        } else {
            None
        };
        let (chain, build_warnings) = tai::build_chain(&plan.config, &*self.secrets, local);
        warnings.extend(build_warnings.iter().map(ai::describe_warning));
        let new = (!chain.providers().is_empty()).then(|| Arc::new(chain));

        if let Some(old) = self.chain() {
            self.save_chain_cache(&old);
        }
        if let Some(n) = &new
            && let Err(e) = n.load_cache(&self.cache_path())
        {
            warnings.push(format!("AI-cachen kunne ikke læses: {e}"));
        }
        self.set_ai_chain(new);
        *lock(&self.ai_warnings) = warnings;
        *lock(&self.ai_failure) = None;
    }

    fn ai_error(e: &tai::AiError) -> BackendError {
        other(e.user_message())
    }

    // ---------- læring ----------

    fn save_patterns(&self, p: &PatternState) {
        // Lokal tilstand (aldrig synkroniseret): filen ser ud som før.
        let file = PatternFile {
            store: p.store.clone(),
            sync: (p.sync != pattern_sync::SyncState::default()).then(|| p.sync.clone()),
        };
        if let Err(e) = state::write_json_atomic(&self.dir.join("patterns.json"), &file) {
            eprintln!("TimeTrack: mønstrene kunne ikke gemmes: {e}");
        }
        if p.model != mm::UserModel::default()
            && let Err(e) = state::write_json_atomic(&self.dir.join("model.json"), &p.model)
        {
            eprintln!("TimeTrack: modellen kunne ikke gemmes: {e}");
        }
    }

    /// Lærer modellen af dagens poster med tidspunkt, som den ikke har lært af
    /// før. Poster, der kom fra et bekræftet eller afvist forslag, springes
    /// over: dem har Bekræft/Ret allerede lært.
    fn learn_entries(
        &self,
        date: NaiveDate,
        segments: &[mm::ActivitySegment],
        customers: &[Customer],
        projects: &[Project],
    ) {
        let Some(entries) = lock(&self.entries).get(&date).cloned() else {
            return;
        };
        let handled = lock(&self.handled).spans();
        let mut guard = lock(&self.patterns);
        let fresh: Vec<LoggedEntry> = entries
            .into_iter()
            .filter(|(key, a, b, _)| {
                !guard.model.entry_learned(key)
                    && !handled.iter().any(|(x, y)| x < b && a < y)
            })
            .collect();
        if fresh.is_empty() || segments.is_empty() {
            return;
        }
        let mut catalog = convert::catalog(customers, projects, &lock(&self.web));
        self.add_local_learning(&mut catalog);
        let mut matcher = mm::Matcher::new(catalog, std::mem::take(&mut guard.store))
            .with_model(std::mem::take(&mut guard.model));
        let spans: Vec<(i64, i64, mm::Target)> =
            fresh.iter().map(|(_, a, b, t)| (*a, *b, t.clone())).collect();
        matcher.learn_logged(segments, &spans);
        guard.store = matcher.patterns;
        guard.model = matcher.model;
        for (key, ..) in fresh {
            guard.model.mark_entry(key);
        }
        guard.generation += 1;
        self.save_patterns(&guard);
    }

    /// Lader matcheren lære af brugerens valg og gemmer mønstrene.
    fn learn(&self, cached: &Cached, f: impl FnOnce(&mut mm::Matcher)) {
        let mut guard = lock(&self.patterns);
        let mut matcher =
            mm::Matcher::new((*cached.catalog).clone(), std::mem::take(&mut guard.store))
                .with_model(std::mem::take(&mut guard.model));
        f(&mut matcher);
        guard.store = matcher.patterns;
        guard.model = matcher.model;
        guard.generation += 1;
        self.save_patterns(&guard);
    }

    fn record_usage(&self, target: &mm::Target, at: i64) {
        let mut usage = lock(&self.usage);
        usage.record(target, at);
        if let Err(e) = state::write_json_atomic(&self.dir.join("usage.json"), &*usage) {
            eprintln!("TimeTrack: brugen kunne ikke gemmes: {e}");
        }
    }

    fn mark_handled(&self, spans: &[(i64, i64)], kind: Handling) {
        let mut handled = lock(&self.handled);
        for &(start, end) in spans {
            if let Err(e) = handled.add(start, end, kind) {
                eprintln!("TimeTrack: kunne ikke gemme, hvad du har afgjort: {e}");
            }
        }
    }

    /// Lægger identiteterne og reglerne fra 0.2 (`migrate::laering`) i kataloget.
    fn add_local_learning(&self, catalog: &mut mm::Catalog) {
        catalog.identities.extend(self.local_learning.identities.iter().cloned());
        catalog.rules.extend(self.local_learning.rules.iter().cloned());
    }

    fn cached(&self, id: &str) -> Result<(Suggestion, mm::Suggestion)> {
        lock(&self.cache)
            .get(id)
            .map(|c| (c.ui.clone(), c.block.clone()))
            .ok_or_else(|| BackendError::NotFound("Forslaget".into()))
    }
}

/// Undtagelserne i Sporing (apps, domæner, titler) som trackerens regler.
/// Migreringen fra 0.2 bruger dem, så gammel aktivitet ikke kommer ind uden
/// om dem.
pub fn exclusion_rules(t: &crate::backend::TrackingSettings) -> Vec<tr::ExclusionRule> {
    convert::tracker_config(t, None).exclusion_rules
}

/// Kunden og projektet, forslaget ender på, når rettelsen er lagt på.
///
/// Skifter brugeren kunde, arves det gamle projekt ikke. Vælger brugeren kun
/// et projekt, bliver det projektet; kunden er den valgte eller forslagets.
pub fn effective_target(
    suggestion: &Suggestion,
    correction: Option<&SuggestionCorrection>,
) -> (String, Option<String>) {
    let suggested = suggestion.customer_id.clone().unwrap_or_default();
    let Some(c) = correction else {
        return (suggested, suggestion.project_id.clone());
    };
    let customer = c.customer_id.clone().unwrap_or_else(|| suggested.clone());
    let customer_changed = customer != suggested;
    let project = if c.target_explicit || c.project_id.is_some() || customer_changed {
        c.project_id.clone()
    } else {
        suggestion.project_id.clone()
    };
    (customer, project)
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn local_ts(date: NaiveDate, time: NaiveTime) -> Option<i64> {
    Local
        .from_local_datetime(&date.and_time(time))
        .earliest()
        .map(|d| d.timestamp())
}

fn map_state(s: tr::PermissionState) -> PermissionState {
    match s {
        tr::PermissionState::Granted => PermissionState::Granted,
        tr::PermissionState::Denied => PermissionState::Denied,
        tr::PermissionState::Unknown => PermissionState::Unknown,
        tr::PermissionState::NotRequired => PermissionState::NotNeeded,
    }
}

fn map_permission(p: Permission) -> tr::Permission {
    match p {
        Permission::Accessibility => tr::Permission::Accessibility,
        Permission::ScreenRecording => tr::Permission::ScreenRecording,
    }
}

impl Detection for Engine {
    fn suggestions(
        &self,
        date: NaiveDate,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<Vec<Suggestion>> {
        // 1. Dagens aktivitet (uden idle), uden de tidsrum der allerede er afgjort.
        let raw = {
            let store = lock(&self.store);
            let store = store
                .as_ref()
                .ok_or_else(|| other("Aktivitetsdatabasen kunne ikke åbnes"))?;
            store
                .segments_for_day(date, false)
                .map_err(|e| other(format!("Aktiviteten kunne ikke læses: {e}")))?
        };
        let segments: Vec<mm::ActivitySegment> =
            raw.iter().filter_map(convert::to_matcher).collect();
        // Modellen lærer af aktiviteten inden for brugerens egne poster (før
        // de trækkes fra nedenfor).
        self.learn_entries(date, &segments, customers, projects);
        // Manuelle valg vinder altid: afgjorte forslag og brugerens egne
        // poster foreslås ikke igen, uanset hvad mønstrene siger nu.
        let mut spans = lock(&self.handled).spans();
        if let Some(logged) = lock(&self.observer).logged.get(&date) {
            spans.extend(logged.iter().copied());
        }
        spans.extend(self.not_work_spans());
        let segments = Arc::new(convert::subtract_spans(segments, &spans));
        if segments.is_empty() {
            lock(&self.cache).retain(|_, c| c.date != date);
            return Ok(Vec::new());
        }

        // 2. Matcheren med de lærte mønstre.
        let mut catalog = convert::catalog(customers, projects, &lock(&self.web));
        self.add_local_learning(&mut catalog);
        let (mut patterns, model, generation) = {
            let p = lock(&self.patterns);
            (p.store.clone(), p.model.clone(), p.generation)
        };
        // Regler og mønstre, brugeren har slået fra på denne enhed.
        let held_back = self.hold_back_disabled(&mut catalog, &mut patterns);
        let catalog = Arc::new(catalog);
        let mut matcher = mm::Matcher::new((*catalog).clone(), patterns).with_model(model);
        matcher.usage = lock(&self.usage).clone();
        let mut blocks = matcher.suggest(&segments);

        // 3. AI på de uklare blokke (kæden cacher, og forespørgslen har et budget).
        let mut ai_keys = HashMap::new();
        if blocks.iter().any(|b| b.is_unclear())
            && let Some(chain) = self.chain()
        {
            let adapter = ai::AiAdapter::new(&chain, self.budget.0, self.budget.1);
            let report = matcher.resolve_unclear(&segments, &mut blocks, &adapter);
            if let Some(last) = report.errors.last() {
                eprintln!(
                    "TimeTrack: AI'en kunne ikke svare på {} blok(ke)",
                    report.errors.len()
                );
                // Forslagene kommer stadig fra regler og mønstre; brugeren
                // får beskeden i Indstillinger → AI. Kun hvis kæden stadig er
                // den aktuelle (indstillingerne kan være ændret imens).
                if self.chain().is_some_and(|c| Arc::ptr_eq(&c, &chain)) {
                    *lock(&self.ai_failure) = Some(last.clone());
                }
            } else if adapter.new_questions() > 0
                && self.chain().is_some_and(|c| Arc::ptr_eq(&c, &chain))
            {
                *lock(&self.ai_failure) = None;
            }
            if adapter.deferred() > 0 {
                // Resten tages ved næste forespørgsel; sig til, så UI'et henter igen.
                self.signal_change();
            }
            if adapter.new_questions() > 0 {
                self.save_chain_cache(&chain);
            }
            ai_keys = adapter.into_keys();
            if report.resolved > 0 {
                let mut p = lock(&self.patterns);
                // En rettelse imens vinder over AI-svar beregnet før den.
                if p.generation == generation {
                    p.store = matcher.patterns.clone();
                    regler::restore_held(&mut p.store, &held_back);
                    p.generation += 1;
                    self.save_patterns(&p);
                }
            }
        }

        // 4. Til UI's forslag. Uklare blokke og blokke uden kunde vises ikke.
        let mut out = Vec::new();
        let mut fresh = HashMap::new();
        for block in blocks {
            let Some(mut ui) = convert::to_ui_suggestion(date, &block) else {
                continue;
            };
            self.attach_task(&mut ui, &block, &raw, projects);
            let from_ai = block.source.is_some_and(|s| s.layer == mm::Layer::Ai);
            let ai_key = from_ai
                .then(|| ai_keys.get(&(block.start, block.end)).cloned())
                .flatten();
            out.push(ui.clone());
            fresh.insert(
                ui.id.clone(),
                Cached {
                    date,
                    ui,
                    block,
                    segments: Arc::clone(&segments),
                    catalog: Arc::clone(&catalog),
                    ai_key,
                },
            );
        }
        out.sort_by_key(|s| s.start);
        let mut cache = lock(&self.cache);
        cache.retain(|_, c| c.date != date);
        cache.extend(fresh);
        Ok(out)
    }

    fn set_web_catalog(&self, catalog: WebCatalog) {
        *lock(&self.web) = catalog;
    }

    fn entry_for(&self, id: &str, correction: Option<&SuggestionCorrection>) -> Result<EntryInput> {
        let (ui, _) = self.cached(id)?;
        let (customer_id, project_id) = effective_target(&ui, correction);
        let start = correction.and_then(|c| c.start).unwrap_or(ui.start);
        let end = correction.and_then(|c| c.end).unwrap_or(ui.end);
        let minutes = (end - start).num_minutes();
        if minutes < 1 {
            return Err(BackendError::Validation(
                "Sluttiden skal være mindst ét minut efter starttiden".into(),
            ));
        }
        // Opgaven fra git følger kun med, når projektet er det foreslåede.
        let task_id = ui.task_id.clone().filter(|_| project_id == ui.project_id);
        Ok(EntryInput {
            customer_id,
            project_id,
            task_id,
            // Forslagets begrundelse er en forklaring til brugeren, ikke en
            // beskrivelse af arbejdet, så posten starter uden.
            description: correction
                .and_then(|c| c.description.clone())
                .unwrap_or_default(),
            date: ui.date,
            start: Some(start),
            end: Some(end),
            minutes: minutes as u32,
            billable: true,
        })
    }

    fn confirmed(&self, id: &str, correction: Option<&SuggestionCorrection>, _entry_id: &str) {
        let Some(cached) = lock(&self.cache).remove(id) else {
            return;
        };
        let (customer, project) = effective_target(&cached.ui, correction);
        let changed = customer != cached.ui.customer_id.clone().unwrap_or_default()
            || project != cached.ui.project_id;
        let segments = Arc::clone(&cached.segments);
        self.record_usage(
            &mm::Target {
                client_id: Some(customer.clone()).filter(|c| !c.is_empty()),
                project_id: project.clone(),
            },
            cached.block.end,
        );
        if changed {
            let target = mm::Target {
                client_id: Some(customer).filter(|c| !c.is_empty()),
                project_id: project,
            };
            self.learn(&cached, |m| m.correct(&segments, &cached.block, &target));
            // Svaret var forkert: næste gang skal AI'en ikke gentage det fra cachen.
            if let (Some(key), Some(chain)) = (&cached.ai_key, self.chain()) {
                chain.forget(key);
                self.save_chain_cache(&chain);
            }
        } else {
            self.learn(&cached, |m| m.confirm(&segments, &cached.block));
        }

        // Tidsrummet er afgjort: blokken og det, posten kom til at dække.
        let mut spans = vec![(cached.block.start, cached.block.end)];
        if let Some(c) = correction {
            let start = c.start.unwrap_or(cached.ui.start);
            let end = c.end.unwrap_or(cached.ui.end);
            if let (Some(a), Some(b)) = (
                local_ts(cached.ui.date, start),
                local_ts(cached.ui.date, end),
            ) && (a, b) != spans[0]
            {
                spans.push((a, b));
            }
        }
        self.mark_handled(&spans, Handling::Confirmed);
    }

    fn reject(&self, id: &str) -> Result<()> {
        let cached = lock(&self.cache)
            .remove(id)
            .ok_or_else(|| BackendError::NotFound("Forslaget".into()))?;
        let segments = Arc::clone(&cached.segments);
        self.learn(&cached, |m| m.reject(&segments, &cached.block));
        self.mark_handled(
            &[(cached.block.start, cached.block.end)],
            Handling::Rejected,
        );
        Ok(())
    }

    fn apply_settings(&self, settings: &Settings) {
        *lock(&self.settings) = Some(settings.clone());
        let mut config =
            convert::tracker_config(&settings.tracking, convert::home_dir().as_deref());
        // Idle-spørgsmålet (D21) har sin egen tærskel og kan slås fra.
        config.idle_prompt_enabled = settings.d21.idle_prompt.enabled;
        config.idle_prompt_threshold_secs = u64::from(settings.d21.idle_prompt.minutes) * 60;
        self.apply_tracking(config, settings.tracking.enabled);
        self.rebuild_ai();
        // Første gang og én gang om ugen: find modeller andre programmer har hentet.
        self.found.search_if_stale();
    }

    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        Ok(ai::local_models(&self.models))
    }

    fn ai_problem(&self) -> Option<String> {
        lock(&self.ai_failure)
            .clone()
            .or_else(|| lock(&self.ai_warnings).first().cloned())
    }

    fn download_model(&self, id: &str) -> Result<()> {
        let spec = self
            .models
            .spec(id)
            .cloned()
            .ok_or_else(|| BackendError::NotFound("Modellen".into()))?;
        // Hent ikke 0,5-2,5 GB, som processoren alligevel ikke kan køre.
        if tai::cpu::local_model_supported().is_err() {
            return Err(BackendError::Validation(tai::cpu::UNSUPPORTED_MESSAGE.into()));
        }
        let state = Arc::new(Download::new(spec.size_bytes));
        {
            let mut running = lock(&self.downloading);
            if running.contains_key(&spec.id) {
                return Err(BackendError::Conflict("Modellen hentes allerede".into()));
            }
            running.insert(spec.id.clone(), state.clone());
        }
        struct Done<'a>(&'a Engine, String);
        impl Drop for Done<'_> {
            fn drop(&mut self) {
                lock(&self.0.downloading).remove(&self.1);
            }
        }
        let _done = Done(self, spec.id.clone());
        let result = self.models.download(
            &spec,
            |p| {
                state.downloaded.store(p.downloaded, Ordering::Relaxed);
                state.total.store(p.total, Ordering::Relaxed);
            },
            &state.cancel,
        );
        if let Err(e) = result {
            if matches!(e, tai::AiError::Cancelled) {
                // Brugeren sagde stop: ingen halv fil bliver liggende.
                let _ = self.models.discard_partial(&spec);
                return Err(BackendError::Other("Hentningen blev annulleret".into()));
            }
            return Err(BackendError::Other(download_error_message(&e, spec.size_bytes)));
        }
        // Den første model, brugeren henter, bliver den aktive.
        if matches!(self.models.active(), Ok(None)) {
            let _ = self.models.set_active(&spec.id);
        }
        self.rebuild_ai();
        Ok(())
    }

    fn model_progress(&self, id: &str) -> Option<ModelProgress> {
        lock(&self.downloading).get(id).map(|d| ModelProgress {
            downloaded: d.downloaded.load(Ordering::Relaxed),
            total: d.total.load(Ordering::Relaxed),
        })
    }

    fn cancel_model_download(&self, id: &str) {
        if let Some(d) = lock(&self.downloading).get(id) {
            d.cancel.store(true, Ordering::Relaxed);
        }
    }

    fn delete_model(&self, id: &str) -> Result<()> {
        let spec = self
            .models
            .spec(id)
            .cloned()
            .ok_or_else(|| BackendError::NotFound("Modellen".into()))?;
        // En igangværende hentning stoppes først, ellers skriver den videre i en slettet fil.
        self.cancel_model_download(id);
        self.models.delete(&spec).map_err(|e| Self::ai_error(&e))?;
        self.rebuild_ai();
        Ok(())
    }

    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        let found = tai::discover_default(&[]);
        *lock(&self.servers) = found.clone();
        Ok(ai::ui_servers(&found))
    }

    fn found_models(&self) -> Result<FoundModels> {
        Ok(self.found_models_view())
    }

    fn rescan_models(&self) -> Result<FoundModels> {
        Ok(self.rescan_found_models())
    }

    fn start_ollama(&self) -> Result<()> {
        self.start_ollama_server()
    }

    fn set_cloud_ai_key(&self, provider: CloudAiProvider, key: String) -> Result<()> {
        let key = key.trim();
        if key.is_empty() {
            return Err(BackendError::Validation("Nøglen må ikke være tom".into()));
        }
        self.secrets
            .set(&tai::api_key_name(ai::provider_kind(provider)), key)
            .map_err(|e| Self::ai_error(&e))?;
        if lock(&self.settings)
            .as_ref()
            .is_some_and(|s| s.ai.mode == AiMode::Cloud)
        {
            self.rebuild_ai();
        }
        Ok(())
    }

    fn remove_cloud_ai_key(&self, provider: CloudAiProvider) -> Result<()> {
        self.secrets
            .delete(&tai::api_key_name(ai::provider_kind(provider)))
            .map_err(|e| Self::ai_error(&e))?;
        if lock(&self.settings)
            .as_ref()
            .is_some_and(|s| s.ai.mode == AiMode::Cloud)
        {
            self.rebuild_ai();
        }
        Ok(())
    }

    fn permissions(&self) -> Result<Permissions> {
        Ok(Permissions {
            accessibility: map_state(tr::Permission::Accessibility.state()),
            screen_recording: map_state(tr::Permission::ScreenRecording.state()),
        })
    }

    fn request_permission(&self, permission: Permission) -> Result<PermissionState> {
        Ok(map_state(map_permission(permission).request()))
    }

    fn changes(&self) -> Option<ChangeRx> {
        Some(self.changes_rx.clone())
    }

    fn idle_returns(&self) -> Option<IdleRx> {
        Some(self.idle_rx.clone())
    }

    fn set_logged_spans(&self, date: NaiveDate, spans: Vec<(NaiveTime, NaiveTime)>) {
        let spans: Vec<(i64, i64)> = spans
            .into_iter()
            .filter_map(|(a, b)| {
                let start = local_ts(date, a)?;
                // En post til midnat slutter 00:00.
                let end = if b <= a { local_ts(date, NaiveTime::MIN)? + 86_400 } else { local_ts(date, b)? };
                Some((start, end))
            })
            .collect();
        lock(&self.observer).logged.insert(date, spans);
    }

    fn learn_from_entries(&self, date: NaiveDate, entries: &[crate::backend::Entry]) {
        let list: Vec<LoggedEntry> = entries
            .iter()
            .filter_map(|e| {
                let (a, b) = (e.start?, e.end?);
                let start = local_ts(date, a)?;
                let end = if b <= a {
                    local_ts(date, NaiveTime::MIN)? + 86_400
                } else {
                    local_ts(date, b)?
                };
                let target = mm::Target {
                    client_id: Some(e.customer_id.clone()).filter(|c| !c.is_empty()),
                    project_id: e.project_id.clone(),
                };
                // Nøglen skifter, hvis posten rettes, så den læres igen.
                let key = format!(
                    "{}|{start}|{end}|{}|{}",
                    e.id,
                    e.customer_id,
                    e.project_id.as_deref().unwrap_or("")
                );
                Some((key, start, end, target))
            })
            .collect();
        lock(&self.entries).insert(date, list);
    }

    fn set_tasks(&self, tasks: Vec<crate::backend::Task>) {
        lock(&self.observer).tasks = tasks;
    }

    fn observer_card(
        &self,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<crate::backend::ObserverCard> {
        self.card(customers, projects)
    }

    fn observer_groups(
        &self,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<Vec<crate::backend::ObserverGroup>> {
        self.groups(customers, projects)
    }

    fn observer_answer(
        &self,
        group_id: &str,
        reply: &crate::backend::ObserverReply,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<()> {
        self.answer(group_id, reply, customers, projects)
    }

    fn export_test_set(
        &self,
        entries: &[crate::backend::Entry],
        customers: &[Customer],
        projects: &[Project],
        days: u32,
    ) -> Result<String> {
        self.test_set(entries, customers, projects, days)
    }

    fn sync_patterns(
        &self,
        web: &dyn crate::backend::services::PatternWeb,
        scope: &str,
    ) -> Result<crate::backend::services::PatternSyncReport> {
        self.run_pattern_sync(web, scope)
    }

    fn activity_day(
        &self,
        date: NaiveDate,
        customers: &[Customer],
        projects: &[Project],
        registered: &[crate::backend::services::RegisteredSpan],
    ) -> Result<crate::backend::ActivityDay> {
        self.build_activity_day(date, customers, projects, registered)
    }

    fn activity_assigned(
        &self,
        spans: &[(i64, i64)],
        customer_id: &str,
        project_id: Option<&str>,
        remember: bool,
        customers: &[Customer],
        projects: &[Project],
    ) {
        self.assigned(spans, customer_id, project_id, remember, customers, projects);
    }

    fn activity_not_work(&self, spans: &[(i64, i64)]) -> Result<()> {
        self.not_work(spans)
    }

    fn merge_activity(&self, span: (i64, i64)) -> Result<()> {
        self.merge(span)
    }

    fn split_activity(&self, span: (i64, i64), at: i64) -> Result<()> {
        self.split(span, at)
    }

    fn delete_activity(&self, spans: &[(i64, i64)]) -> Result<()> {
        self.delete(spans)
    }

    fn delete_all_activity(&self) -> Result<()> {
        self.delete_all()
    }

    fn activity_storage(&self) -> Result<crate::backend::ActivityStorage> {
        self.storage()
    }

    fn stored_exclusions(&self) -> Result<Vec<crate::backend::StoredExclusion>> {
        self.exclusions()
    }

    fn remove_stored_exclusion(&self, id: i64) -> Result<()> {
        self.remove_exclusion(id)
    }

    // ux-vaelger: regler (engine/regler.rs).
    fn rule_candidates(&self, spans: &[(i64, i64)]) -> Vec<(crate::backend::ScopeKind, String)> {
        self.candidates_for(spans)
    }

    fn rule_hit_counts(&self, rules: &[(tt_data::RuleKind, String)], days: &[NaiveDate]) -> Vec<usize> {
        self.hit_counts(rules, days)
    }

    fn rule_open_runs(
        &self,
        kind: tt_data::RuleKind,
        pattern: &str,
        date: NaiveDate,
        customer: &str,
        project: Option<&str>,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<Vec<(i64, i64)>> {
        let target = mm::Target {
            client_id: Some(customer.to_string()).filter(|c| !c.is_empty()),
            project_id: project.map(str::to_string),
        };
        Ok(self.open_runs(kind, pattern, date, &target, customers, projects))
    }

    fn pattern_rows(&self, days: &[NaiveDate]) -> Vec<crate::backend::RuleRow> {
        self.patterns_as_rows(days)
    }

    fn disabled_rules(&self) -> std::collections::BTreeSet<crate::backend::Id> {
        self.disabled().ids
    }

    fn set_rule_disabled(&self, id: &str, disabled: bool) -> Result<()> {
        self.set_disabled(id, disabled)
    }

    fn retarget_pattern(
        &self,
        id: &str,
        customer_id: Option<crate::backend::Id>,
        project_id: Option<crate::backend::Id>,
    ) -> Result<()> {
        self.retarget(id, customer_id, project_id)
    }

    fn forget_pattern(&self, id: &str) -> Result<()> {
        self.forget(id)
    }
}

/// Dansk besked, når en model ikke kunne hentes. Appen kører videre uden
/// den indbyggede model; en afbrudt hentning fortsætter næste gang.
pub(crate) fn download_error_message(e: &tai::AiError, size_bytes: u64) -> String {
    use std::io::ErrorKind;
    let gb = (size_bytes as f64 / 1e9 * 10.0).ceil() / 10.0;
    let text = match e {
        tai::AiError::Io(io) if io.kind() == ErrorKind::StorageFull => format!(
            "Der er ikke plads nok på disken til modellen. Den kræver ca. {} GB.",
            format!("{gb:.1}").replace('.', ",")
        ),
        tai::AiError::Io(io) if io.kind() == ErrorKind::PermissionDenied => {
            "Appen må ikke skrive i mappen til modeller.".to_string()
        }
        tai::AiError::Io(_) => "Modellen kunne ikke gemmes på disken.".to_string(),
        tai::AiError::Connect(_) | tai::AiError::Timeout(_) => {
            "Modellen kunne ikke hentes. Tjek internetforbindelsen, og prøv igen; hentningen fortsætter, hvor den slap."
                .to_string()
        }
        tai::AiError::Http { .. } | tai::AiError::InvalidResponse(_) => {
            "Serveren med modellen svarede med en fejl. Prøv igen senere.".to_string()
        }
        tai::AiError::ChecksumMismatch { .. } => {
            "Den hentede fil var beskadiget og er slettet. Prøv igen.".to_string()
        }
        other => other.user_message().to_string(),
    };
    format!("{text} Appen virker som før uden den indbyggede model.")
}
