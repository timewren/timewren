//! AI-laget: indstillinger → tt-ai's kæde, adapteren der lader matcheren
//! spørge kæden, modeller, lokale servere og nøgler.
//!
//! Cloud bruges kun, når brugeren har valgt det i UI'et (`AiMode::Cloud` efter
//! advarslen). Det er samtykket: kæden får `cloud_opt_in = true` alene i den
//! tilstand, og i alle andre tilstande bygges ingen cloud-udbyder.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use tt_ai as ai;
use tt_matcher as mm;

use crate::backend::{
    AiMode, AiServerKind, AiSettings as UiAiSettings, CloudAiProvider, FOUND_PREFIX, FoundModel,
    FoundModels, LocalAiServer, LocalModel, ModelFit,
};

/// Tid, en enkelt `suggestions`-forespørgsel højst bruger på nye AI-spørgsmål.
pub const DEFAULT_BUDGET: Duration = Duration::from_secs(8);
/// Antal nye (ikke cachede) spørgsmål pr. forespørgsel. Resten tages næste gang.
pub const DEFAULT_MAX_NEW_QUESTIONS: usize = 8;

pub fn provider_kind(p: CloudAiProvider) -> ai::ProviderKind {
    match p {
        CloudAiProvider::OpenAi => ai::ProviderKind::OpenAi,
        CloudAiProvider::Anthropic => ai::ProviderKind::Anthropic,
        CloudAiProvider::Gemini => ai::ProviderKind::Gemini,
    }
}

fn server_kind(k: ai::ProviderKind) -> Option<AiServerKind> {
    match k {
        ai::ProviderKind::Ollama => Some(AiServerKind::Ollama),
        ai::ProviderKind::LmStudio => Some(AiServerKind::LmStudio),
        ai::ProviderKind::Jan => Some(AiServerKind::Jan),
        ai::ProviderKind::Llamafile => Some(AiServerKind::Llamafile),
        _ => None,
    }
}

/// Fundne servere som UI'ets typer. Servere bag login (uden modelliste) og
/// generiske servere uden en kendt slags udelades.
pub fn ui_servers(found: &[ai::DiscoveredServer]) -> Vec<LocalAiServer> {
    found
        .iter()
        .filter(|s| !s.requires_auth)
        .filter_map(|s| {
            Some(LocalAiServer {
                kind: server_kind(s.kind)?,
                url: s.base_url.clone(),
                models: s.models.clone(),
            })
        })
        .collect()
}

/// Modelkataloget som UI'ets modelliste.
pub fn local_models(mgr: &ai::ModelManager) -> Vec<LocalModel> {
    mgr.catalog()
        .iter()
        .map(|m| LocalModel {
            id: m.id.clone(),
            name: m.name.clone(),
            size_mb: ((m.size_bytes + 500_000) / 1_000_000) as u32,
            note: m.description.clone(),
            downloaded: mgr.is_installed(m),
        })
        .collect()
}

/// Den model, den indbyggede AI skal bruge: den valgte, ellers den aktive,
/// ellers standardmodellen, hvis den er hentet.
#[cfg_attr(not(feature = "local-llm"), allow(dead_code))]
pub fn pick_model(
    mgr: &ai::ModelManager,
    wanted: Option<&str>,
) -> Option<(ai::ModelSpec, PathBuf)> {
    let installed = |spec: &ai::ModelSpec| mgr.is_installed(spec).then(|| mgr.path_for(spec));
    if let Some(spec) = wanted.and_then(|id| mgr.spec(id))
        && let Some(path) = installed(spec)
    {
        return Some((spec.clone(), path));
    }
    if let Ok(Some(active)) = mgr.active() {
        return Some(active);
    }
    let spec = mgr.spec(ai::DEFAULT_MODEL_ID)?;
    installed(spec).map(|p| (spec.clone(), p))
}

/// Modellen på en lokal server: den brugeren valgte, ellers serverens første.
/// `Ok((model, Some(ønsket)))` betyder, at den ønskede model ikke findes
/// (mere), og at den første bruges i stedet. `None` = serveren har ingen modeller.
pub fn pick_server_model<'a>(
    server: &'a ai::DiscoveredServer,
    wanted: Option<&'a str>,
) -> Option<(&'a str, Option<&'a str>)> {
    let first = server.models.first()?;
    Some(match wanted {
        Some(w) if server.models.iter().any(|m| m == w) => (w, None),
        Some(w) => (first, Some(w)),
        None => (first, None),
    })
}

/// Resultatet af at læse indstillingerne: hvad kæden skal bestå af.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub config: ai::AiSettings,
    /// Danske forklaringer på, hvorfor noget ikke kunne bygges.
    pub warnings: Vec<String>,
    /// Kæden skal bruge den indbyggede model.
    pub wants_local: bool,
}

/// Indstillingerne som kædens konfiguration. Ren funktion: de fundne servere
/// gives udefra, så den kan testes uden netværk.
pub fn plan(ui: &UiAiSettings, servers: &[ai::DiscoveredServer]) -> Plan {
    let mut warnings = Vec::new();
    let mut order = Vec::new();
    let mut cloud_opt_in = false;
    let mut wants_local = false;
    match ui.mode {
        AiMode::Off => {}
        AiMode::Builtin => {
            order.push(ai::ProviderConfig::LocalModel);
            wants_local = true;
        }
        AiMode::LocalServer => match ui.local_server.as_deref() {
            None => warnings.push("Der er ikke valgt nogen lokal AI-server".to_string()),
            Some(url) => {
                let url = url.trim_end_matches('/');
                let found = servers
                    .iter()
                    .find(|s| !s.requires_auth && s.base_url.trim_end_matches('/') == url);
                match found {
                    None => warnings.push(format!("AI-serveren på {url} blev ikke fundet")),
                    Some(server) => match pick_server_model(server, ui.local_model.as_deref()) {
                        Some((model, fallback)) => {
                            if let Some(wanted) = fallback {
                                warnings.push(format!(
                                    "Modellen {wanted} findes ikke på serveren. Bruger {model}"
                                ));
                            }
                            order.push(ai::ProviderConfig::from_discovered(server, model));
                        }
                        None => warnings.push(format!("AI-serveren på {url} har ingen modeller")),
                    },
                }
            }
        },
        AiMode::Cloud => match ui.cloud_provider {
            None => warnings.push("Der er ikke valgt nogen AI-udbyder".to_string()),
            Some(p) => {
                order.push(ai::ProviderConfig::Cloud {
                    kind: provider_kind(p),
                    model: None,
                });
                // At vælge cloud efter advarslen er samtykket.
                cloud_opt_in = true;
            }
        },
    }
    Plan {
        config: ai::AiSettings {
            order,
            cloud_opt_in,
        },
        warnings,
        wants_local,
    }
}

/// Dansk tekst til en udbyder, der ikke kunne bygges.
pub fn describe_warning(w: &ai::BuildWarning) -> String {
    match w {
        ai::BuildWarning::LocalModelUnavailable => "Den indbyggede model er ikke klar".to_string(),
        ai::BuildWarning::MissingApiKey(k) => format!("Der mangler en API-nøgle til {}", k.label()),
        ai::BuildWarning::KeyringError(k, _) => {
            format!("Nøgleringen kunne ikke læses for {}", k.label())
        }
        ai::BuildWarning::NotACloudProvider(k) => format!("{} er ikke en cloud-udbyder", k.label()),
    }
}

/// OS-nøgleringen, åbnet første gang den bruges (ikke ved opstart).
#[derive(Default)]
pub struct OsSecrets {
    store: OnceLock<Result<ai::KeyringSecrets, String>>,
}

impl OsSecrets {
    fn get_store(&self) -> Result<&ai::KeyringSecrets, ai::AiError> {
        self.store
            .get_or_init(|| ai::KeyringSecrets::os().map_err(|e| e.to_string()))
            .as_ref()
            .map_err(|e| ai::AiError::Keyring(e.clone()))
    }
}

impl ai::SecretStore for OsSecrets {
    fn get(&self, name: &str) -> Result<Option<String>, ai::AiError> {
        self.get_store()?.get(name)
    }
    fn set(&self, name: &str, value: &str) -> Result<(), ai::AiError> {
        self.get_store()?.set(name, value)
    }
    fn delete(&self, name: &str) -> Result<(), ai::AiError> {
        self.get_store()?.delete(name)
    }
}

/// Den indbyggede model, indlæst første gang den bruges og frigivet igen efter
/// [`ai::idle::DEFAULT_IDLE_AFTER`] uden brug (den fylder 1-2,5 GB RAM).
/// Indlæsning tager sekunder (Metal-shadere), og må ikke ske i `apply_settings`.
/// Markerer en indlæsningsfejl, der skyldes selve modelfilen.
#[cfg(feature = "local-llm")]
const BAD_FILE: &str = "modelfil: ";

#[cfg(feature = "local-llm")]
pub struct LazyLocal {
    id: String,
    /// Et andet programs model (id `found:…`).
    shared: bool,
    model: ai::idle::IdleLoaded<ai::local::LocalLlm>,
}

#[cfg(feature = "local-llm")]
impl LazyLocal {
    pub fn new(spec: &ai::ModelSpec, path: PathBuf) -> Self {
        Self::with_idle(
            spec,
            path,
            Arc::new(ai::idle::SystemClock::new()),
            ai::idle::DEFAULT_IDLE_AFTER,
            ai::idle::DEFAULT_CHECK_EVERY,
        )
    }

    /// Som `new`, men med eget ur og egne tider (tests).
    pub fn with_idle(
        spec: &ai::ModelSpec,
        path: PathBuf,
        clock: Arc<dyn ai::idle::Clock>,
        idle_after: Duration,
        check_every: Duration,
    ) -> Self {
        Self::with_idle_id(spec.id.clone(), path, clock, idle_after, check_every)
    }

    /// Model, et andet program har hentet: bruges direkte fra sin sti (mmap,
    /// skrivebeskyttet), uden at blive kopieret.
    pub fn shared(path: PathBuf) -> Self {
        let file = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Self::with_idle_id(
            format!("{FOUND_PREFIX}{file}"),
            path,
            Arc::new(ai::idle::SystemClock::new()),
            ai::idle::DEFAULT_IDLE_AFTER,
            ai::idle::DEFAULT_CHECK_EVERY,
        )
    }

    fn with_idle_id(
        id: String,
        path: PathBuf,
        clock: Arc<dyn ai::idle::Clock>,
        idle_after: Duration,
        check_every: Duration,
    ) -> Self {
        let name = id.clone();
        Self {
            shared: id.starts_with(FOUND_PREFIX),
            id,
            model: ai::idle::IdleLoaded::new(
                move || {
                    ai::local::LocalLlm::load(&path, &name, ai::local::LocalModelOptions::default())
                        .map_err(|e| match e {
                            // Kun en fil, llama.cpp ikke kan læse, er "beskadiget".
                            ai::AiError::ModelLoad(m) => format!("{BAD_FILE}{m}"),
                            other => other.to_string(),
                        })
                },
                clock,
                idle_after,
                check_every,
            ),
        }
    }

    /// Er modellen i hukommelsen lige nu?
    #[cfg(test)]
    pub fn is_loaded(&self) -> bool {
        self.model.is_loaded()
    }

    /// Antal indlæsninger og frigivelser hidtil.
    #[cfg(test)]
    pub fn loads_and_releases(&self) -> (u32, u32) {
        (self.model.loads(), self.model.releases())
    }
}

#[cfg(feature = "local-llm")]
impl ai::Classifier for LazyLocal {
    fn info(&self) -> ai::ProviderInfo {
        ai::ProviderInfo {
            id: format!("local:{}", self.id),
            kind: ai::ProviderKind::LocalModel,
            model: self.id.clone(),
            sends_data_off_device: false,
        }
    }

    fn classify(
        &self,
        block: &ai::BlockSummary,
        candidates: &[ai::Candidate],
    ) -> Result<Option<ai::Classification>, ai::AiError> {
        // Arc'en holdes under hele kaldet, så modellen ikke frigives midt i et svar.
        // En fil, der ikke kan indlæses, giver en fejl her; appen kører videre.
        let llm = self.model.get().map_err(|e| match e.strip_prefix(BAD_FILE) {
            // Et andet programs fil kan brugeren ikke slette her: egen besked.
            Some(m) if self.shared => ai::AiError::SharedModelLoad(m.to_string()),
            Some(m) => ai::AiError::ModelLoad(m.to_string()),
            None => ai::AiError::Model(e),
        })?;
        llm.classify(block, candidates)
    }
}

/// Stien i et `found:<sti>`-valg (en model et andet program har hentet).
#[cfg_attr(not(feature = "local-llm"), allow(dead_code))]
pub fn shared_path(wanted: Option<&str>) -> Option<PathBuf> {
    wanted
        .and_then(|w| w.strip_prefix(FOUND_PREFIX))
        .map(PathBuf::from)
}

/// Dansk besked, når et andet programs model ikke findes mere.
#[cfg_attr(not(feature = "local-llm"), allow(dead_code))]
pub fn shared_missing_message(path: &std::path::Path, home: Option<&std::path::Path>) -> String {
    let source = ai::scan::source_for_path(path, home).label;
    format!("Modellen fra {source} findes ikke mere. Programmet har flyttet eller slettet den")
}

/// Den indbyggede model som udbyder i kæden. Uden `local-llm` i dette build
/// er der ingen, og `Err` forklarer hvorfor. `Ok` kan følges af en besked:
/// et andet programs model er væk, og en hentet model bruges i stedet.
#[cfg(feature = "local-llm")]
pub fn local_classifier(
    mgr: &ai::ModelManager,
    wanted: Option<&str>,
    home: Option<&std::path::Path>,
) -> Result<(Arc<dyn ai::Classifier>, Option<String>), String> {
    ai::cpu::local_model_supported().map_err(|_| ai::cpu::UNSUPPORTED_MESSAGE.to_string())?;
    let mut note = None;
    if let Some(path) = shared_path(wanted) {
        if ai::gguf::is_gguf(&path) {
            return Ok((Arc::new(LazyLocal::shared(path)), None));
        }
        note = Some(shared_missing_message(&path, home));
    }
    let catalog_wanted = if shared_path(wanted).is_some() { None } else { wanted };
    match pick_model(mgr, catalog_wanted) {
        Some((spec, path)) => Ok((Arc::new(LazyLocal::new(&spec, path)), note)),
        None => Err(match note {
            Some(n) => format!("{n}. Vælg en anden model herunder"),
            None => "Ingen indbygget model er hentet endnu. Hent en herunder".to_string(),
        }),
    }
}

#[cfg(not(feature = "local-llm"))]
pub fn local_classifier(
    _mgr: &ai::ModelManager,
    _wanted: Option<&str>,
    _home: Option<&std::path::Path>,
) -> Result<(Arc<dyn ai::Classifier>, Option<String>), String> {
    Err("Den indbyggede model er ikke med i denne version af appen".to_string())
}

// ---------- Modeller andre programmer har hentet ----------

fn server_kind_for_source(source_id: &str) -> Option<AiServerKind> {
    match source_id {
        "ollama" => Some(AiServerKind::Ollama),
        "lmstudio" => Some(AiServerKind::LmStudio),
        "jan" => Some(AiServerKind::Jan),
        _ => None,
    }
}

/// Søgningens resultat som UI'ets typer. `ram_bytes` = 0 betyder ukendt.
pub fn ui_found(
    report: &ai::scan::ScanReport,
    ram_bytes: u64,
    ollama_stopped: bool,
    scanning: bool,
) -> FoundModels {
    let models = report
        .models
        .iter()
        .map(|m| {
            let fit = match ai::scan::assess(m, ram_bytes) {
                ai::scan::Fit::Good => ModelFit::Good,
                ai::scan::Fit::Tight => ModelFit::Tight,
                ai::scan::Fit::TooBig => ModelFit::TooBig,
            };
            FoundModel {
                id: format!("{FOUND_PREFIX}{}", m.path.display()),
                source_id: m.source.id.clone(),
                source: m.source.label.clone(),
                name: m.name.clone(),
                size_mb: ((m.size_bytes + 500_000) / 1_000_000) as u32,
                params_b: m.params_b,
                quant: m.quant.clone(),
                context: m.context,
                fit,
                recommended: ai::scan::recommended(m, ram_bytes),
                supported: m.support == ai::scan::Support::Yes,
                serve_names: m.serve_names.clone(),
                server_kind: server_kind_for_source(&m.source.id),
                available: m.path.exists(),
            }
        })
        .collect();
    FoundModels {
        models,
        other_count: report.other_count(),
        scanned_at: (report.scanned_at > 0).then_some(report.scanned_at),
        scanning,
        ollama_stopped,
        ram_gb: ((ram_bytes + 500_000_000) / 1_000_000_000) as u32,
    }
}

// ---------- Adapteren: matcherens Classifier oven på kæden ----------

/// Spørgsmålet fra matcheren som tt-ai's blokresumé. Rå titler er med; det er
/// kæden, der afgør, om de må forlade maskinen (cloud kun efter samtykke).
pub fn to_block(req: &mm::ClassifyRequest) -> ai::BlockSummary {
    let first = |v: &[mm::classifier::Weighted]| v.first().map(|w| w.value.clone());
    ai::BlockSummary {
        app: first(&req.apps).unwrap_or_default(),
        // Dokumentnavnet er det bedste, vi har, når titlen er tom.
        title: first(&req.titles)
            .or_else(|| first(&req.documents))
            .unwrap_or_default(),
        domain: first(&req.domains),
        path: first(&req.repos).or_else(|| first(&req.documents)),
        git_branch: None,
        duration_secs: (req.end - req.start).max(0) as u64,
    }
}

/// Matcherens valgmuligheder som kandidater. Interne projekter (uden kunde)
/// kan kæden ikke vælge, og der sendes højst `MAX_CANDIDATES`. Matcheren har
/// allerede sorteret valgmulighederne efter sandsynlighed (`tt_matcher::rank`),
/// så de 40 pladser går til de mest sandsynlige.
pub fn to_candidates(req: &mm::ClassifyRequest) -> Vec<ai::Candidate> {
    req.options
        .iter()
        .filter_map(|o| {
            Some(ai::Candidate {
                client_id: o.client_id.clone()?,
                client_name: o.client_name.clone().unwrap_or_default(),
                project_id: o.project_id.clone(),
                project_name: o.project_name.clone(),
                keywords: o.keywords.clone(),
            })
        })
        .take(ai::prompt::MAX_CANDIDATES)
        .collect()
}

/// Lader matcheren spørge kæden. Spørgsmål, kæden allerede kender, svares
/// altid (cachen er gratis). Nye spørgsmål stilles kun inden for tidsbudgettet
/// og højst `max_new` gange pr. forespørgsel; resten venter til næste gang.
pub struct AiAdapter<'a> {
    chain: &'a ai::ProviderChain,
    deadline: Instant,
    max_new: usize,
    new_asked: Cell<usize>,
    deferred: Cell<usize>,
    keys: RefCell<HashMap<(i64, i64), ai::QuestionKey>>,
}

impl<'a> AiAdapter<'a> {
    pub fn new(chain: &'a ai::ProviderChain, budget: Duration, max_new: usize) -> Self {
        Self {
            chain,
            deadline: Instant::now() + budget,
            max_new,
            new_asked: Cell::new(0),
            deferred: Cell::new(0),
            keys: RefCell::new(HashMap::new()),
        }
    }

    /// Antal nye spørgsmål, der blev stillet til en udbyder.
    pub fn new_questions(&self) -> usize {
        self.new_asked.get()
    }

    /// Antal nye spørgsmål, der blev udskudt af budgettet.
    pub fn deferred(&self) -> usize {
        self.deferred.get()
    }

    /// Kædens nøgle for blokken `(start, slut)`, så et svar kan glemmes igen.
    #[cfg(test)]
    pub fn key_for(&self, start: i64, end: i64) -> Option<ai::QuestionKey> {
        self.keys.borrow().get(&(start, end)).cloned()
    }

    pub fn into_keys(self) -> HashMap<(i64, i64), ai::QuestionKey> {
        self.keys.into_inner()
    }
}

impl mm::Classifier for AiAdapter<'_> {
    fn classify(
        &self,
        req: &mm::ClassifyRequest,
    ) -> Result<Option<mm::ClassifierAnswer>, mm::ClassifierError> {
        let candidates = to_candidates(req);
        if candidates.is_empty() {
            return Ok(None);
        }
        let block = to_block(req);
        let key = ai::QuestionKey::new(&block, &candidates);
        let cached = self.chain.cached(&key).is_some();
        if !cached {
            if Instant::now() >= self.deadline || self.new_asked.get() >= self.max_new {
                self.deferred.set(self.deferred.get() + 1);
                return Ok(None);
            }
            self.new_asked.set(self.new_asked.get() + 1);
        }
        let result = self.chain.classify(&block, &candidates);
        self.keys
            .borrow_mut()
            .insert((req.start, req.end), result.key.clone());
        match result.answer {
            Some(c) => Ok(Some(mm::ClassifierAnswer {
                target: mm::Target {
                    client_id: Some(c.client_id),
                    project_id: c.project_id,
                },
                confidence: c.confidence,
                reason: c.reasoning,
            })),
            // Alle udbydere fejlede: sig det (kun slags, ikke tekst fra serveren).
            None if !result.attempts.is_empty()
                && result
                    .attempts
                    .iter()
                    .all(|a| matches!(a.outcome, ai::AttemptOutcome::Failed(_))) =>
            {
                let msg = result
                    .attempts
                    .iter()
                    .filter_map(|a| match &a.outcome {
                        ai::AttemptOutcome::Failed(e) => Some(e.user_message()),
                        _ => None,
                    })
                    .next_back()
                    .unwrap_or("AI'en svarede ikke");
                Err(mm::ClassifierError(msg.to_string()))
            }
            None => Ok(None),
        }
    }
}

#[cfg(test)]
pub(crate) mod fakes {
    use super::ai;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// En udbyder, der svarer det samme hver gang og tæller kaldene.
    pub struct FakeProvider {
        pub calls: AtomicUsize,
        pub off_device: bool,
        /// Kundens id, den vælger. `None` = "ingen passer".
        pub pick: Mutex<Option<(String, Option<String>)>>,
        pub fail: bool,
        pub seen: Mutex<Vec<(ai::BlockSummary, Vec<ai::Candidate>)>>,
    }

    impl FakeProvider {
        pub fn picking(client: &str, project: Option<&str>) -> Arc<Self> {
            Arc::new(Self {
                calls: AtomicUsize::new(0),
                off_device: false,
                pick: Mutex::new(Some((client.into(), project.map(Into::into)))),
                fail: false,
                seen: Mutex::new(Vec::new()),
            })
        }

        pub fn cloud(client: &str) -> Arc<Self> {
            Arc::new(Self {
                off_device: true,
                ..Arc::try_unwrap(Self::picking(client, None)).ok().unwrap()
            })
        }

        pub fn failing() -> Arc<Self> {
            Arc::new(Self {
                fail: true,
                ..Arc::try_unwrap(Self::picking("x", None)).ok().unwrap()
            })
        }

        pub fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    use std::sync::Arc;

    impl ai::Classifier for FakeProvider {
        fn info(&self) -> ai::ProviderInfo {
            ai::ProviderInfo {
                id: if self.off_device {
                    "fake:cloud"
                } else {
                    "fake:local"
                }
                .into(),
                kind: if self.off_device {
                    ai::ProviderKind::OpenAi
                } else {
                    ai::ProviderKind::LocalModel
                },
                model: "fake".into(),
                sends_data_off_device: self.off_device,
            }
        }

        fn classify(
            &self,
            block: &ai::BlockSummary,
            candidates: &[ai::Candidate],
        ) -> Result<Option<ai::Classification>, ai::AiError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.seen
                .lock()
                .unwrap()
                .push((block.clone(), candidates.to_vec()));
            if self.fail {
                return Err(ai::AiError::Connect("hemmelig serverfejl".into()));
            }
            Ok(self.pick.lock().unwrap().clone().and_then(|(c, p)| {
                // Kun et kandidatnummer, der findes (som en rigtig udbyder).
                candidates
                    .iter()
                    .any(|k| k.client_id == c && k.project_id == p)
                    .then(|| ai::Classification {
                        client_id: c,
                        project_id: p,
                        confidence: 0.9,
                        reasoning: "titlen nævner kunden".into(),
                    })
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fakes::FakeProvider;
    use super::*;
    use mm::Classifier as _;
    use tt_ai::SecretStore as _;

    fn weighted(v: &str, secs: i64) -> mm::classifier::Weighted {
        mm::classifier::Weighted {
            value: v.into(),
            seconds: secs,
        }
    }

    fn option(
        client: Option<&str>,
        name: Option<&str>,
        project: Option<&str>,
    ) -> mm::ClassifierOption {
        mm::ClassifierOption {
            client_id: client.map(Into::into),
            client_name: name.map(Into::into),
            project_id: project.map(Into::into),
            project_name: project.map(|p| format!("Projekt {p}")),
            keywords: Vec::new(),
        }
    }

    fn request() -> mm::ClassifyRequest {
        mm::ClassifyRequest {
            start: 1_000,
            end: 1_900,
            apps: vec![weighted("Google Chrome", 800), weighted("Code", 100)],
            titles: vec![weighted("Tilbud til Alfa", 700), weighted("Mail", 200)],
            domains: vec![weighted("docs.example.dk", 700)],
            repos: vec![weighted("github.com/x/y", 300)],
            documents: vec![weighted("tilbud.docx", 500)],
            options: vec![
                option(Some("k1"), Some("Alfa"), None),
                option(Some("k1"), Some("Alfa"), Some("p1")),
                option(None, None, Some("intern")),
                option(Some("k2"), Some("Beta"), None),
            ],
        }
    }

    #[test]
    fn request_becomes_block_summary() {
        let b = to_block(&request());
        assert_eq!(b.app, "Google Chrome");
        assert_eq!(b.title, "Tilbud til Alfa");
        assert_eq!(b.domain.as_deref(), Some("docs.example.dk"));
        assert_eq!(b.path.as_deref(), Some("github.com/x/y"));
        assert_eq!(b.duration_secs, 900);

        let mut r = request();
        r.titles.clear();
        r.repos.clear();
        let b = to_block(&r);
        assert_eq!(b.title, "tilbud.docx");
        assert_eq!(b.path.as_deref(), Some("tilbud.docx"));
    }

    #[test]
    fn options_become_candidates_without_internal_projects() {
        let c = to_candidates(&request());
        let ids: Vec<(String, Option<String>)> = c
            .iter()
            .map(|c| (c.client_id.clone(), c.project_id.clone()))
            .collect();
        assert_eq!(
            ids,
            vec![
                ("k1".to_string(), None),
                ("k1".to_string(), Some("p1".to_string())),
                ("k2".to_string(), None)
            ]
        );
        assert_eq!(c[1].client_name, "Alfa");
        assert_eq!(c[1].project_name.as_deref(), Some("Projekt p1"));
    }

    #[test]
    fn candidates_are_capped() {
        let mut r = request();
        r.options = (0..60)
            .map(|i| option(Some(&format!("k{i}")), Some("K"), None))
            .collect();
        assert_eq!(to_candidates(&r).len(), ai::prompt::MAX_CANDIDATES);
    }

    #[test]
    fn the_best_candidates_survive_the_cap_with_sixty_clients() {
        let clients: Vec<mm::Client> = (0..60)
            .map(|i| mm::Client {
                id: format!("k{i:02}"),
                name: format!("Kunde {i:02}"),
                // Kunde 55 ligger bagest i kataloget, men domænet peger på den.
                domains: if i == 55 {
                    vec!["sjaelland-bygger.example".to_string()]
                } else {
                    Vec::new()
                },
                archived: false,
                ..Default::default()
            })
            .collect();
        let matcher = mm::Matcher::new(
            mm::Catalog {
                clients,
                ..Default::default()
            },
            mm::PatternStore::new(),
        );
        let segs = vec![mm::ActivitySegment {
            app: "Google Chrome".into(),
            title: "Tilbud".into(),
            url: Some("https://sjaelland-bygger.example/tilbud".into()),
            start: 0,
            end: 600,
            ..Default::default()
        }];
        let block = mm::Suggestion {
            start: 0,
            end: 600,
            target: None,
            confidence: 0.0,
            source: None,
            reason: String::new(),
            segment_indices: vec![0],
            absorbed_interruptions: 0,
            held_back: None,
        };
        let req = matcher.classify_request(&segs, &block);
        assert_eq!(req.options.len(), 60);
        let cands = to_candidates(&req);
        assert_eq!(cands.len(), ai::prompt::MAX_CANDIDATES);
        assert_eq!(cands[0].client_id, "k55");
        assert_eq!(cands[0].keywords, vec!["sjaelland-bygger.example"]);
    }

    #[test]
    fn adapter_answers_from_the_chain_and_remembers_the_key() {
        let fake = FakeProvider::picking("k1", Some("p1"));
        let chain = ai::ProviderChain::new(vec![fake.clone()]);
        let adapter = AiAdapter::new(&chain, DEFAULT_BUDGET, 5);
        let answer = adapter.classify(&request()).unwrap().unwrap();
        assert_eq!(answer.target, mm::Target::project(Some("k1"), "p1"));
        assert_eq!(answer.reason, "titlen nævner kunden");
        assert!((answer.confidence - 0.9).abs() < 1e-6);
        assert_eq!(fake.calls(), 1);
        assert!(adapter.key_for(1_000, 1_900).is_some());
        assert!(adapter.key_for(1, 2).is_none());
        // Kandidaterne, udbyderen så, har ingen intern projekt.
        assert_eq!(fake.seen.lock().unwrap()[0].1.len(), 3);
        // Samme spørgsmål igen kommer fra cachen.
        assert!(adapter.classify(&request()).unwrap().is_some());
        assert_eq!(fake.calls(), 1);
        assert_eq!(adapter.new_questions(), 1);
    }

    #[test]
    fn adapter_budget_defers_new_questions_but_serves_cached_ones() {
        let fake = FakeProvider::picking("k1", None);
        let chain = ai::ProviderChain::new(vec![fake.clone()]);
        let adapter = AiAdapter::new(&chain, DEFAULT_BUDGET, 1);
        let mut other = request();
        other.titles = vec![weighted("Noget andet", 900)];
        assert!(adapter.classify(&request()).unwrap().is_some());
        // Budgettet på ét nyt spørgsmål er brugt.
        assert!(adapter.classify(&other).unwrap().is_none());
        assert_eq!(adapter.deferred(), 1);
        assert_eq!(fake.calls(), 1);
        // Det kendte spørgsmål svares stadig.
        assert!(adapter.classify(&request()).unwrap().is_some());

        // Udløbet tidsgrænse: samme.
        let late = AiAdapter::new(&chain, Duration::ZERO, 10);
        assert!(late.classify(&other).unwrap().is_none());
        assert_eq!(fake.calls(), 1);
        assert!(late.classify(&request()).unwrap().is_some());
    }

    #[test]
    fn cloud_provider_is_not_asked_without_consent() {
        let cloud = FakeProvider::cloud("k1");
        let chain = ai::ProviderChain::new(vec![cloud.clone()]);
        let adapter = AiAdapter::new(&chain, DEFAULT_BUDGET, 5);
        // Uden samtykke: intet svar og intet kald.
        assert!(adapter.classify(&request()).unwrap().is_none());
        assert_eq!(cloud.calls(), 0);
        // Med samtykke (som `AiMode::Cloud` giver): kaldet sker.
        chain.set_cloud_opt_in(true);
        let adapter = AiAdapter::new(&chain, DEFAULT_BUDGET, 5);
        assert!(adapter.classify(&request()).unwrap().is_some());
        assert_eq!(cloud.calls(), 1);
    }

    #[test]
    fn failing_providers_are_reported_without_server_text() {
        let chain = ai::ProviderChain::new(vec![FakeProvider::failing()]);
        let adapter = AiAdapter::new(&chain, DEFAULT_BUDGET, 5);
        let err = adapter.classify(&request()).unwrap_err();
        assert_eq!(err.0, "Kunne ikke nå AI-tjenesten.");
        assert!(!err.0.contains("hemmelig"));
    }

    #[test]
    fn no_candidates_means_no_question() {
        let fake = FakeProvider::picking("k1", None);
        let chain = ai::ProviderChain::new(vec![fake.clone()]);
        let adapter = AiAdapter::new(&chain, DEFAULT_BUDGET, 5);
        let mut r = request();
        r.options = vec![option(None, None, Some("intern"))];
        assert!(adapter.classify(&r).unwrap().is_none());
        assert_eq!(fake.calls(), 0);
    }

    fn ui(mode: AiMode) -> UiAiSettings {
        UiAiSettings {
            mode,
            builtin_model: None,
            local_server: None,
            local_model: None,
            cloud_provider: None,
            cloud_keys: vec![],
        }
    }

    fn server(kind: ai::ProviderKind, port: u16, models: &[&str]) -> ai::DiscoveredServer {
        let base = format!("http://127.0.0.1:{port}");
        ai::DiscoveredServer {
            kind,
            api_base_url: if kind == ai::ProviderKind::Ollama {
                base.clone()
            } else {
                format!("{base}/v1")
            },
            base_url: base,
            models: models.iter().map(|m| m.to_string()).collect(),
            requires_auth: false,
        }
    }

    #[test]
    fn plan_off_builds_nothing() {
        let mut s = ui(AiMode::Off);
        // Selv med valgt udbyder og gemte nøgler: Fra er fra.
        s.cloud_provider = Some(CloudAiProvider::OpenAi);
        s.cloud_keys = vec![CloudAiProvider::OpenAi];
        let p = plan(&s, &[]);
        assert!(p.config.order.is_empty());
        assert!(!p.config.cloud_opt_in);
        assert!(!p.wants_local);
    }

    #[test]
    fn plan_builtin_wants_the_local_model_and_never_cloud() {
        let mut s = ui(AiMode::Builtin);
        s.cloud_provider = Some(CloudAiProvider::OpenAi);
        let p = plan(&s, &[]);
        assert_eq!(p.config.order, vec![ai::ProviderConfig::LocalModel]);
        assert!(!p.config.cloud_opt_in);
        assert!(p.wants_local);
    }

    #[test]
    fn plan_local_server_uses_the_chosen_server_and_its_first_model() {
        let found = vec![
            server(ai::ProviderKind::Ollama, 11434, &["qwen2.5:3b", "llama3"]),
            server(ai::ProviderKind::LmStudio, 1234, &["m"]),
        ];
        let mut s = ui(AiMode::LocalServer);
        s.local_server = Some("http://127.0.0.1:1234/".into());
        let p = plan(&s, &found);
        assert_eq!(
            p.config.order,
            vec![ai::ProviderConfig::OpenAiCompatible {
                kind: ai::ProviderKind::LmStudio,
                base_url: "http://127.0.0.1:1234/v1".into(),
                model: "m".into()
            }]
        );
        assert!(!p.config.cloud_opt_in);

        s.local_server = Some("http://127.0.0.1:11434".into());
        assert_eq!(
            plan(&s, &found).config.order,
            vec![ai::ProviderConfig::Ollama {
                base_url: "http://127.0.0.1:11434".into(),
                model: "qwen2.5:3b".into()
            }]
        );

        // Valgt model huskes; findes den ikke mere, bruges den første, med en advarsel.
        s.local_server = Some("http://127.0.0.1:11434".into());
        s.local_model = Some("llama3".into());
        let p = plan(&s, &found);
        assert_eq!(
            p.config.order,
            vec![ai::ProviderConfig::Ollama {
                base_url: "http://127.0.0.1:11434".into(),
                model: "llama3".into()
            }]
        );
        assert!(p.warnings.is_empty());
        s.local_model = Some("slettet:7b".into());
        let p = plan(&s, &found);
        assert_eq!(
            p.config.order,
            vec![ai::ProviderConfig::Ollama {
                base_url: "http://127.0.0.1:11434".into(),
                model: "qwen2.5:3b".into()
            }]
        );
        assert!(p.warnings[0].contains("slettet:7b"), "{:?}", p.warnings);
        s.local_model = None;

        s.local_server = Some("http://127.0.0.1:9999".into());
        let missing = plan(&s, &found);
        assert!(missing.config.order.is_empty());
        assert!(missing.warnings[0].contains("ikke fundet"));

        s.local_server = None;
        assert!(!plan(&s, &found).warnings.is_empty());
    }

    #[test]
    fn plan_cloud_is_the_consent() {
        let mut s = ui(AiMode::Cloud);
        assert!(plan(&s, &[]).config.order.is_empty());
        s.cloud_provider = Some(CloudAiProvider::Anthropic);
        let p = plan(&s, &[]);
        assert!(p.config.cloud_opt_in);
        assert_eq!(
            p.config.order,
            vec![ai::ProviderConfig::Cloud {
                kind: ai::ProviderKind::Anthropic,
                model: None
            }]
        );
    }

    #[test]
    fn cloud_chain_needs_a_key_and_only_exists_in_cloud_mode() {
        let secrets = ai::MemorySecrets::default();
        let mut s = ui(AiMode::Cloud);
        s.cloud_provider = Some(CloudAiProvider::OpenAi);

        // Uden nøgle: ingen udbyder, og opt-in er slået til men uden virkning.
        let (chain, warnings) = ai::build_chain(&plan(&s, &[]).config, &secrets, None);
        assert!(chain.providers().is_empty());
        assert_eq!(
            describe_warning(&warnings[0]),
            "Der mangler en API-nøgle til OpenAI"
        );

        // Med nøgle: udbyderen er med, og kæden må sende væk.
        secrets
            .set(&ai::api_key_name(ai::ProviderKind::OpenAi), "sk-test")
            .unwrap();
        let (chain, _) = ai::build_chain(&plan(&s, &[]).config, &secrets, None);
        assert_eq!(chain.providers().len(), 1);
        assert!(chain.providers()[0].sends_data_off_device);
        assert!(chain.cloud_opt_in());

        // Samme nøgle, men andre tilstande: ingen cloud-udbyder, intet samtykke.
        for mode in [AiMode::Off, AiMode::Builtin, AiMode::LocalServer] {
            let mut other = s.clone();
            other.mode = mode;
            let (chain, _) = ai::build_chain(&plan(&other, &[]).config, &secrets, None);
            assert!(
                chain.providers().iter().all(|p| !p.sends_data_off_device),
                "{mode:?}"
            );
            assert!(!chain.cloud_opt_in(), "{mode:?}");
        }
    }

    #[test]
    fn servers_map_to_ui_types() {
        let mut gated = server(ai::ProviderKind::Jan, 1337, &[]);
        gated.requires_auth = true;
        let found = vec![
            server(ai::ProviderKind::Ollama, 11434, &["a", "b"]),
            gated,
            server(ai::ProviderKind::OpenAiCompatible, 9000, &["x"]),
            server(ai::ProviderKind::Llamafile, 8080, &["l"]),
        ];
        let ui = ui_servers(&found);
        assert_eq!(ui.len(), 2);
        assert_eq!(ui[0].kind, AiServerKind::Ollama);
        assert_eq!(ui[0].url, "http://127.0.0.1:11434");
        assert_eq!(ui[0].models, vec!["a", "b"]);
        assert_eq!(ui[1].kind, AiServerKind::Llamafile);
    }

    #[test]
    fn model_catalog_maps_and_picks_installed_models() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = ai::ModelManager::new(dir.path().join("models"));
        let models = local_models(&mgr);
        assert_eq!(models.len(), mgr.catalog().len());
        assert!(models.iter().all(|m| !m.downloaded && m.size_mb > 100));
        assert!(models.iter().any(|m| m.id == ai::DEFAULT_MODEL_ID));
        assert!(pick_model(&mgr, None).is_none());
        assert!(pick_model(&mgr, Some(ai::DEFAULT_MODEL_ID)).is_none());
    }
}
