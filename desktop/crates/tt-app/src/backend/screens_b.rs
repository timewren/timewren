//! Typer til skærmene Indstillinger, Login/onboarding og import (screens-b).
//!
//! Som resten af `backend` er de UI'ets kopi af det, tt-data/tt-detect skal
//! levere. Integrationsagenten kobler dem til de rigtige crates:
//! - indstillinger og konto: tt-data (lokal SQLite + web `extension.settings`);
//! - login: tt-data's auth (deep link `timetrack://auth?code&state`);
//! - tilladelser: capture-laget (macOS AX/Screen Recording);
//! - AI: tt-ai (lokal model, genkendelse af lokale servere, cloud-nøgler).
//!
//! Plan og grænser kommer fra web's `extension.entitlements.get`, importen
//! fra `extension.import.run` (se tt-data's `import.rs`).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::d21::{self, D21Settings};
use super::{BackendError, Id, Mode, Result};

// ---------- Konto og licens ----------

/// En plangrænse fra web (håndhæves på serveren). `limit = None` = ubegrænset.
#[derive(Clone, Debug, PartialEq)]
pub struct Entitlement {
    pub key: String,
    pub label: String,
    pub used: u32,
    pub limit: Option<u32>,
}

impl Entitlement {
    /// "3 af 5" eller "12 (ubegrænset)".
    pub fn usage(&self) -> String {
        match self.limit {
            Some(l) => format!("{} af {l}", self.used),
            None => format!("{} (ubegrænset)", self.used),
        }
    }

    pub fn is_at_limit(&self) -> bool {
        self.limit.is_some_and(|l| self.used >= l)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LicenseKind {
    /// Livstidslicens (499 kr).
    Lifetime,
    /// Prøveperiode med dage tilbage.
    Trial { days_left: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct License {
    pub kind: LicenseKind,
    /// Maskeret nøgle til visning ("TT-XXXX-…-9F2A").
    pub key_hint: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Account {
    pub mode: Mode,
    /// Brugerens egen mail (cloud). Vises kun på kontosiden.
    pub email: Option<String>,
    /// Plannavn fra web ("Gratis", "Pro", …). `None` i lokal tilstand.
    pub plan: Option<String>,
    pub entitlements: Vec<Entitlement>,
    /// Lokal licens. `None` i cloud.
    pub license: Option<License>,
    /// Lokalt: der kan startes en prøve (ingen er startet før, og der er
    /// ingen livstidslicens). Altid `false` i cloud.
    pub trial_available: bool,
}

// ---------- Indstillinger ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Appearance {
    System,
    Light,
    Dark,
}

impl Appearance {
    pub const ALL: [Appearance; 3] = [Appearance::System, Appearance::Light, Appearance::Dark];
    pub fn label(self) -> &'static str {
        match self {
            Appearance::System => "Som systemet",
            Appearance::Light => "Lys",
            Appearance::Dark => "Mørk",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    Da,
    En,
    De,
    Sv,
    Nb,
    Es,
}

impl Language {
    pub const ALL: [Language; 6] = [
        Language::Da,
        Language::En,
        Language::De,
        Language::Sv,
        Language::Nb,
        Language::Es,
    ];
    /// Sprogets eget navn.
    pub fn label(self) -> &'static str {
        match self {
            Language::Da => "Dansk",
            Language::En => "English",
            Language::De => "Deutsch",
            Language::Sv => "Svenska",
            Language::Nb => "Norsk bokmål",
            Language::Es => "Español",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

impl UpdateChannel {
    pub fn label(self) -> &'static str {
        match self {
            UpdateChannel::Stable => "Stabil",
            UpdateChannel::Beta => "Beta",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingSettings {
    pub enabled: bool,
    /// Minutter uden input, før tiden regnes som pause.
    pub idle_minutes: u32,
    /// App-navne eller bundle-id'er, der aldrig registreres.
    pub excluded_apps: Vec<String>,
    /// Domæner, der aldrig registreres (også underdomæner).
    pub excluded_domains: Vec<String>,
    /// Mapper, hvor git-repos findes (til repo-genkendelse).
    pub repo_roots: Vec<String>,
    /// Dage rå aktivitet gemmes lokalt (spec: 14).
    pub retention_days: u32,
    /// Læs adressen fra browserens adresselinje (spec 9: standard til, med
    /// fravalg). Slået fra bruges kun vinduestitlen.
    #[serde(default = "til")]
    pub browser_urls: bool,
    /// Slå sporingen til, når appen starter, også hvis den var sat på pause
    /// (0.2's "Auto-start tracking"). Standard fra. // gendan
    #[serde(default)]
    pub start_on_launch: bool,
    /// Vinduestitler, der aldrig registreres ("indeholder", uden forskel på
    /// store og små bogstaver). // aktivitet
    #[serde(default)]
    pub excluded_titles: Vec<String>,
    /// Skift kortere end så mange sekunder foldes ind i nabo-blokken på
    /// Aktivitet. 0 = fold intet. // aktivitet
    #[serde(default = "fold_standard")]
    pub fold_short_secs: u32,
    /// Spor også private/inkognito-vinduer (titlen, aldrig adressen). Standard
    /// fra; gamle indstillinger uden feltet får også fra.
    #[serde(default)]
    pub track_private_windows: bool,
}

fn til() -> bool {
    true
}

/// Standard for `fold_short_secs`: et halvt minut.
pub const FOLD_SHORT_SECS: u32 = 30;

fn fold_standard() -> u32 {
    FOLD_SHORT_SECS
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiMode {
    /// Ingen AI. Alt virker stadig (regler og mønstre).
    Off,
    /// Den indbyggede model (llama.cpp).
    Builtin,
    /// En fundet lokal server (Ollama, LM Studio, …).
    LocalServer,
    /// Cloud med egen nøgle. Titler forlader maskinen.
    Cloud,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloudAiProvider {
    OpenAi,
    Anthropic,
    Gemini,
}

impl CloudAiProvider {
    pub const ALL: [CloudAiProvider; 3] = [
        CloudAiProvider::OpenAi,
        CloudAiProvider::Anthropic,
        CloudAiProvider::Gemini,
    ];
    pub fn label(self) -> &'static str {
        match self {
            CloudAiProvider::OpenAi => "OpenAI",
            CloudAiProvider::Anthropic => "Anthropic (Claude)",
            CloudAiProvider::Gemini => "Google Gemini",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub mode: AiMode,
    /// Valgt indbygget model.
    pub builtin_model: Option<Id>,
    /// Valgt lokal server (url).
    pub local_server: Option<String>,
    /// Valgt model på den lokale server. `None` = serverens første.
    #[serde(default)]
    pub local_model: Option<String>,
    pub cloud_provider: Option<CloudAiProvider>,
    /// Udbydere med gemt nøgle. Selve nøglen ligger i nøgleringen og vises aldrig.
    pub cloud_keys: Vec<CloudAiProvider>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortcut {
    /// Stabilt navn ("timer.toggle").
    pub action: String,
    pub label: String,
    /// Normaliseret: "cmd-shift-t" / "ctrl-shift-t".
    pub keys: String,
    /// Global = virker, selv når appen ikke har fokus.
    pub global: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub tracking: TrackingSettings,
    pub ai: AiSettings,
    pub shortcuts: Vec<Shortcut>,
    pub appearance: Appearance,
    pub language: Language,
    pub update_channel: UpdateChannel,
    /// Idle-spørgsmål, påmindelser, pomodoro og notifikationer (spec D21).
    #[serde(default)]
    pub d21: D21Settings,
    /// CSV-separator og datoformat i eksporten (som 0.2's Eksport). // gendan
    #[serde(default)]
    pub export: ExportSettings,
    /// Kalenderkilder og mødedetektion. // kalender
    #[serde(default)]
    pub calendar: crate::kalenderkilder::CalendarSettings,
}

/// Format for CSV-eksport af poster og moms. // gendan
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportSettings {
    /// Komma i stedet for semikolon (og decimalpunktum i stedet for komma).
    pub comma: bool,
    /// ÅÅÅÅ-MM-DD i stedet for DD-MM-ÅÅÅÅ.
    pub iso_dates: bool,
}

impl Settings {
    /// Standarderne ved første start: som `defaults`, men på systemets sprog.
    pub fn first_start() -> Self {
        Settings {
            language: Language::system(),
            ..Settings::defaults()
        }
    }

    pub fn defaults() -> Self {
        Settings {
            tracking: TrackingSettings {
                enabled: true,
                idle_minutes: 5,
                excluded_apps: vec!["1Password".into(), "Bitwarden".into()],
                excluded_domains: vec!["netbank.dk".into()],
                repo_roots: vec!["~/dev".into()],
                retention_days: 14,
                browser_urls: true,
                start_on_launch: false,
                excluded_titles: vec![],
                fold_short_secs: FOLD_SHORT_SECS,
                track_private_windows: false,
            },
            ai: AiSettings {
                mode: AiMode::Off,
                builtin_model: None,
                local_server: None,
                local_model: None,
                cloud_provider: None,
                cloud_keys: vec![],
            },
            shortcuts: default_shortcuts(),
            appearance: Appearance::System,
            language: Language::Da,
            update_channel: UpdateChannel::Stable,
            d21: D21Settings::default(),
            export: ExportSettings::default(),
            calendar: Default::default(),
        }
    }
}

fn default_shortcuts() -> Vec<Shortcut> {
    use crate::genveje::{Os, default_global};
    let os = Os::current();
    let m = if os == Os::Mac { "cmd" } else { "ctrl" };
    // De globale genveje er de samme, som `hotkeys` registrerer fra start.
    let global = |action: &str| default_global(action, os).expect("global standard").to_owned();
    [
        ("timer.toggle", "Start eller pause timeren", global("timer.toggle"), true),
        ("timer.stop", "Stop og gem timeren", global("timer.stop"), true),
        ("app.show", "Vis TimeTrack", global("app.show"), true),
        ("tracking.toggle", "Pause eller genoptag sporingen", global("tracking.toggle"), true),
        ("palette.open", "Åbn kommandopaletten", format!("{m}-k"), false),
        ("entry.new", "Ny registrering", format!("{m}-n"), false),
    ]
    .into_iter()
    .map(|(a, l, k, g)| Shortcut {
        action: a.into(),
        label: l.into(),
        keys: k,
        global: g,
    })
    .collect()
}

// ---------- AI ----------

#[derive(Clone, Debug, PartialEq)]
pub struct LocalModel {
    pub id: Id,
    pub name: String,
    /// Størrelse i MB.
    pub size_mb: u32,
    /// Kort dansk beskrivelse ("Hurtig, god til de fleste").
    pub note: String,
    pub downloaded: bool,
}

/// Fremskridt for en igangværende modelhentning.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModelProgress {
    pub downloaded: u64,
    pub total: u64,
}

impl ModelProgress {
    /// 0..=100, afrundet ned.
    pub fn percent(&self) -> u32 {
        (self.downloaded.min(self.total) * 100)
            .checked_div(self.total)
            .unwrap_or(0) as u32
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AiServerKind {
    Ollama,
    LmStudio,
    Jan,
    Llamafile,
}

impl AiServerKind {
    pub fn label(self) -> &'static str {
        match self {
            AiServerKind::Ollama => "Ollama",
            AiServerKind::LmStudio => "LM Studio",
            AiServerKind::Jan => "Jan",
            AiServerKind::Llamafile => "llamafile",
        }
    }
    /// Standardport fra specen.
    pub fn port(self) -> u16 {
        match self {
            AiServerKind::Ollama => 11434,
            AiServerKind::LmStudio => 1234,
            AiServerKind::Jan => 1337,
            AiServerKind::Llamafile => 8080,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAiServer {
    pub kind: AiServerKind,
    pub url: String,
    pub models: Vec<String>,
}

/// Hvor godt en fundet model passer til computerens hukommelse.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelFit {
    Good,
    Tight,
    TooBig,
}

/// Id-præfikset for en model, som et andet program har hentet. Resten af
/// id'et er filens sti, så valget overlever, at søgningen køres igen.
pub const FOUND_PREFIX: &str = "found:";

/// En sprogmodel, et andet program har hentet, og som kan bruges direkte fra
/// stedet, hvor den ligger (ingen kopi).
#[derive(Clone, Debug, PartialEq)]
pub struct FoundModel {
    /// `found:<sti>`, gemmes som `AiSettings::builtin_model`.
    pub id: Id,
    /// Programmets id (`ollama`, `meetily`) og visningsnavn ("Meetily").
    pub source_id: String,
    pub source: String,
    pub name: String,
    pub size_mb: u32,
    pub params_b: Option<f32>,
    pub quant: Option<String>,
    pub context: Option<u64>,
    pub fit: ModelFit,
    /// Godt valg til at sortere aktivitet på netop denne computer.
    pub recommended: bool,
    /// Arkitekturen er kendt af llama.cpp i appen.
    pub supported: bool,
    /// Navne, en kørende server kender modellen under (Ollama-tags).
    pub serve_names: Vec<String>,
    /// Hvilken slags server der kan have samme model kørende.
    pub server_kind: Option<AiServerKind>,
    /// Filen findes stadig (tjekkes, hver gang listen hentes).
    pub available: bool,
}

/// Det, søgningen på disken har fundet.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FoundModels {
    pub models: Vec<FoundModel>,
    /// Andre AI-modeller (tale, embeddings, billede), der ikke kan bruges her.
    pub other_count: usize,
    /// Sekunder siden 1970, `None` hvis søgningen aldrig er kørt.
    pub scanned_at: Option<i64>,
    /// En søgning kører lige nu i baggrunden.
    pub scanning: bool,
    /// Ollama er installeret, men serveren kører ikke.
    pub ollama_stopped: bool,
    /// Computerens hukommelse i GB (0 = ukendt).
    pub ram_gb: u32,
}

impl FoundModel {
    /// Er filen allerede kørende som model på en af de fundne servere? Så
    /// vises den kun som server, ikke også som fil.
    pub fn served_by(&self, servers: &[LocalAiServer]) -> bool {
        let Some(kind) = self.server_kind else {
            return false;
        };
        let norm = |s: &str| -> String {
            s.chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect()
        };
        let mine = norm(&self.name);
        servers.iter().filter(|s| s.kind == kind).any(|s| {
            s.models.iter().any(|m| {
                if !self.serve_names.is_empty() {
                    self.serve_names.iter().any(|n| n == m)
                } else {
                    let theirs = norm(m);
                    // Samme model, ikke bare et kort navn inde i et langt ("qwen3" i
                    // "qwen3-30b-a3b"): det korte skal udgøre det meste af det lange.
                    let (short, long) = if mine.len() <= theirs.len() {
                        (&mine, &theirs)
                    } else {
                        (&theirs, &mine)
                    };
                    !short.is_empty() && long.contains(short.as_str()) && short.len() * 10 >= long.len() * 6
                }
            })
        })
    }
}

impl FoundModels {
    /// Modellerne, der ikke også kører som server (ingen dubletter).
    pub fn visible(&self, servers: &[LocalAiServer]) -> Vec<&FoundModel> {
        self.models.iter().filter(|m| !m.served_by(servers)).collect()
    }
}

// ---------- Login, tilladelser og import ----------

/// Start på browser-login: åbn `url`, og vent på deep link med samme `state`.
#[derive(Clone, Debug, PartialEq)]
pub struct LoginStart {
    pub url: String,
    pub state: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permission {
    Accessibility,
    ScreenRecording,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionState {
    Granted,
    Denied,
    /// Ikke spurgt endnu.
    Unknown,
    /// Platformen kræver den ikke (Windows).
    NotNeeded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Permissions {
    pub accessibility: PermissionState,
    pub screen_recording: PermissionState,
}

/// Rapport fra import lokal → cloud. Ved dry-run er intet ændret.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ImportReport {
    pub dry_run: bool,
    pub customers: u32,
    pub projects: u32,
    pub entries: u32,
    pub punch_cards: u32,
    pub tasks: u32,
    pub invoices: u32,
    /// Allerede i cloud (samme `clientEntryId`) og springes over.
    pub skipped: u32,
    /// Danske advarsler, fx "Kunden 'Café Åbrinken' findes i forvejen og flettes".
    pub warnings: Vec<String>,
    /// Afvist af web (fx planens grænser). Ved en rigtig import er de ikke
    /// flyttet, og importen kan køres igen.
    pub failed: u32,
    /// Web's fejl pr. element.
    pub errors: Vec<String>,
}

impl ImportReport {
    pub fn total(&self) -> u32 {
        self.customers
            + self.projects
            + self.entries
            + self.punch_cards
            + self.tasks
            + self.invoices
    }
}

// ---------- Mock-tilstand ----------

/// Det, `MockBackend` husker for screens-b.
pub struct MockB {
    pub(crate) inner: Mutex<MockBState>,
}

pub(crate) struct MockBState {
    pub settings: Settings,
    pub account: Account,
    pub models: Vec<LocalModel>,
    pub servers: Vec<LocalAiServer>,
    pub found: FoundModels,
    pub permissions: Permissions,
    pub login_state: Option<String>,
    pub imported: bool,
}

/// Demo: modeller fra fire andre programmer på en maskine med 16 GB.
fn mock_found() -> FoundModels {
    let m = |source_id: &str,
             source: &str,
             name: &str,
             path: &str,
             size_mb: u32,
             params: f32,
             quant: &str,
             context: u64,
             fit: ModelFit,
             recommended: bool| FoundModel {
        id: format!("{FOUND_PREFIX}{path}"),
        source_id: source_id.into(),
        source: source.into(),
        name: name.into(),
        size_mb,
        params_b: Some(params),
        quant: Some(quant.into()),
        context: Some(context),
        fit,
        recommended,
        supported: true,
        serve_names: vec![],
        server_kind: None,
        available: true,
    };
    let mut ollama = m(
        "ollama",
        "Ollama",
        "qwen3:8b",
        "/demo/ollama/blobs/sha256-qwen3-8b",
        5_030,
        8.2,
        "Q4_K_M",
        40_960,
        ModelFit::Good,
        false,
    );
    ollama.serve_names = vec!["qwen3:8b".into(), "qwen3:latest".into()];
    ollama.server_kind = Some(AiServerKind::Ollama);
    let mut ollama_small = m(
        "ollama",
        "Ollama",
        "gemma3:4b",
        "/demo/ollama/blobs/sha256-gemma3-4b",
        3_340,
        4.3,
        "Q4_K_M",
        131_072,
        ModelFit::Good,
        true,
    );
    ollama_small.serve_names = vec!["gemma3:4b".into()];
    ollama_small.server_kind = Some(AiServerKind::Ollama);
    FoundModels {
        models: vec![
            m(
                "lmstudio",
                "LM Studio",
                "Llama 3.1 70B Instruct",
                "/demo/lmstudio/llama-3.1-70b-q4.gguf",
                42_520,
                70.6,
                "Q4_K_M",
                131_072,
                ModelFit::TooBig,
                false,
            ),
            m(
                "lmstudio",
                "LM Studio",
                "Mistral Nemo Instruct",
                "/demo/lmstudio/mistral-nemo-q6.gguf",
                10_060,
                12.2,
                "Q6_K",
                128_000,
                ModelFit::Tight,
                false,
            ),
            m(
                "meetily",
                "Meetily",
                "Qwen3.5 4B",
                "/demo/meetily/Qwen3.5-4B-Q4_K_M.gguf",
                2_740,
                4.0,
                "Q4_K_M",
                32_768,
                ModelFit::Good,
                true,
            ),
            ollama,
            ollama_small,
        ],
        other_count: 3,
        scanned_at: Some(1_793_000_000),
        scanning: false,
        ollama_stopped: false,
        ram_gb: 16,
    }
}

/// Kontoen, mock starter med (cloud) eller falder tilbage til (lokal).
pub(crate) fn mock_account(cloud: bool) -> Account {
    if cloud {
        Account {
            mode: Mode::Cloud {
                organization: "Acme".into(),
            },
            email: Some("dig@example.dk".into()),
            plan: Some("Pro".into()),
            entitlements: vec![
                Entitlement {
                    key: "customers".into(),
                    label: "Kunder".into(),
                    used: 7,
                    limit: None,
                },
                Entitlement {
                    key: "devices".into(),
                    label: "Enheder".into(),
                    used: 2,
                    limit: Some(5),
                },
                Entitlement {
                    key: "invoices_month".into(),
                    label: "Fakturaer pr. måned".into(),
                    used: 3,
                    limit: Some(50),
                },
            ],
            license: None,
            trial_available: false,
        }
    } else {
        Account {
            mode: Mode::Local,
            email: None,
            plan: None,
            entitlements: vec![],
            license: None,
            trial_available: true,
        }
    }
}

impl MockB {
    pub fn new(cloud: bool) -> Self {
        let account = mock_account(cloud);
        MockB {
            inner: Mutex::new(MockBState {
                settings: Settings::defaults(),
                account,
                models: vec![
                    LocalModel {
                        id: "qwen3-1.7b-q4".into(),
                        name: "Qwen3 1.7B".into(),
                        size_mb: 1_100,
                        note: "Hurtig. God til de fleste maskiner".into(),
                        downloaded: true,
                    },
                    LocalModel {
                        id: "gemma3-4b-q4".into(),
                        name: "Gemma 3 4B".into(),
                        size_mb: 2_500,
                        note: "Mere præcis. Kræver 8 GB RAM".into(),
                        downloaded: false,
                    },
                    LocalModel {
                        id: "qwen3-8b-q4".into(),
                        name: "Qwen3 8B".into(),
                        size_mb: 4_900,
                        note: "Bedst. Kræver 16 GB RAM".into(),
                        downloaded: false,
                    },
                ],
                servers: vec![LocalAiServer {
                    kind: AiServerKind::Ollama,
                    url: "http://127.0.0.1:11434".into(),
                    models: vec!["llama3.2:3b".into(), "qwen3:8b".into()],
                }],
                found: mock_found(),
                permissions: Permissions {
                    accessibility: PermissionState::Unknown,
                    screen_recording: PermissionState::Unknown,
                },
                login_state: None,
                imported: false,
            }),
        }
    }

    pub(crate) fn with<T>(&self, f: impl FnOnce(&mut MockBState) -> Result<T>) -> Result<T> {
        f(&mut self.inner.lock().expect("mock-lås"))
    }
}

/// Validering af indstillinger, fælles for mock og rigtige datalag.
pub fn validate_settings(s: &Settings) -> Result<()> {
    let t = &s.tracking;
    if !(1..=60).contains(&t.idle_minutes) {
        return Err(BackendError::Validation(
            "Pausetærsklen skal være mellem 1 og 60 minutter".into(),
        ));
    }
    d21::validate(&s.d21)?;
    s.calendar.validate()?; // kalender
    if !(1..=90).contains(&t.retention_days) {
        return Err(BackendError::Validation(
            "Aktivitet kan gemmes mellem 1 og 90 dage".into(),
        ));
    }
    // aktivitet: korte skift foldes ind i nabo-blokken.
    if t.fold_short_secs > 600 {
        return Err(BackendError::Validation(
            "Korte skift kan højst være 600 sekunder".into(),
        ));
    }
    if s.ai.mode == AiMode::Cloud {
        match s.ai.cloud_provider {
            None => {
                return Err(BackendError::Validation(
                    "Vælg en cloud-udbyder til AI".into(),
                ));
            }
            Some(p) if !s.ai.cloud_keys.contains(&p) => {
                return Err(BackendError::Validation(format!(
                    "Gem en nøgle til {} først",
                    p.label()
                )));
            }
            _ => {}
        }
    }
    let mut seen: Vec<&str> = vec![];
    for sc in &s.shortcuts {
        if seen.contains(&sc.keys.as_str()) {
            return Err(BackendError::Validation(format!(
                "Genvejen {} bruges to gange",
                sc.keys
            )));
        }
        seen.push(&sc.keys);
    }
    Ok(())
}

/// Licensnøgle-format: `TT-` og fire grupper á fire tegn (A-Z, 0-9).
/// Kun formatet tjekkes her; signaturen verificeres i datalaget (ingen fail-open).
pub fn license_key_format_ok(key: &str) -> bool {
    let k = key.trim().to_ascii_uppercase();
    let Some(rest) = k.strip_prefix("TT-") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('-').collect();
    parts.len() == 4
        && parts
            .iter()
            .all(|p| p.len() == 4 && p.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// Maskerer en nøgle til visning: "TT-…-9F2A".
pub fn mask_key(key: &str) -> String {
    let k = key.trim().to_ascii_uppercase();
    let tail: String = k
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("TT-…-{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_indstillinger_er_gyldige() {
        let s = Settings::defaults();
        assert!(validate_settings(&s).is_ok());
        assert_eq!(s.tracking.retention_days, 14, "spec: 14 dages retention");
        assert_eq!(s.ai.mode, AiMode::Off, "cloud-AI er slået fra som standard");
    }

    #[test]
    fn korte_skift_har_en_graense() {
        let mut s = Settings::defaults();
        s.tracking.fold_short_secs = 0;
        assert!(validate_settings(&s).is_ok(), "0 = fold intet");
        s.tracking.fold_short_secs = 601;
        assert!(validate_settings(&s).is_err());
    }

    #[test]
    fn validering_af_indstillinger() {
        let mut s = Settings::defaults();
        s.tracking.idle_minutes = 0;
        assert!(validate_settings(&s).is_err());
        s.tracking.idle_minutes = 5;
        s.ai.mode = AiMode::Cloud;
        assert_eq!(
            validate_settings(&s),
            Err(BackendError::Validation(
                "Vælg en cloud-udbyder til AI".into()
            ))
        );
        s.ai.cloud_provider = Some(CloudAiProvider::Anthropic);
        assert!(
            validate_settings(&s)
                .unwrap_err()
                .to_string()
                .contains("nøgle")
        );
        s.ai.cloud_keys.push(CloudAiProvider::Anthropic);
        assert!(validate_settings(&s).is_ok());
        let dup = s.shortcuts[0].keys.clone();
        s.shortcuts[1].keys = dup;
        assert!(
            validate_settings(&s)
                .unwrap_err()
                .to_string()
                .contains("to gange")
        );
    }

    #[test]
    fn licensnoegle_format() {
        assert!(license_key_format_ok("TT-AB12-CD34-EF56-9F2A"));
        assert!(license_key_format_ok(" tt-ab12-cd34-ef56-9f2a "));
        assert!(!license_key_format_ok("AB12-CD34-EF56-9F2A"));
        assert!(!license_key_format_ok("TT-AB12-CD34-EF56"));
        assert!(!license_key_format_ok("TT-AB12-CD34-EF56-9F2Æ"));
        assert_eq!(mask_key("tt-ab12-cd34-ef56-9f2a"), "TT-…-9F2A");
    }

    #[test]
    fn plangraenser() {
        let e = Entitlement {
            key: "devices".into(),
            label: "Enheder".into(),
            used: 5,
            limit: Some(5),
        };
        assert_eq!(e.usage(), "5 af 5");
        assert!(e.is_at_limit());
        let u = Entitlement { limit: None, ..e };
        assert_eq!(u.usage(), "5 (ubegrænset)");
        assert!(!u.is_at_limit());
    }

    fn fundet(source_id: &str, name: &str, kind: Option<AiServerKind>, tags: &[&str]) -> FoundModel {
        FoundModel {
            id: format!("{FOUND_PREFIX}/m/{name}.gguf"),
            source_id: source_id.into(),
            source: source_id.into(),
            name: name.into(),
            size_mb: 1000,
            params_b: None,
            quant: None,
            context: None,
            fit: ModelFit::Good,
            recommended: false,
            supported: true,
            serve_names: tags.iter().map(|t| t.to_string()).collect(),
            server_kind: kind,
            available: true,
        }
    }

    fn server(kind: AiServerKind, models: &[&str]) -> LocalAiServer {
        LocalAiServer {
            kind,
            url: format!("http://127.0.0.1:{}", kind.port()),
            models: models.iter().map(|m| m.to_string()).collect(),
        }
    }

    #[test]
    fn model_der_kører_som_server_vises_ikke_to_gange() {
        let found = FoundModels {
            models: vec![
                fundet("ollama", "qwen3:8b", Some(AiServerKind::Ollama), &["qwen3:8b", "qwen3:latest"]),
                fundet("ollama", "llama3.2:3b", Some(AiServerKind::Ollama), &["llama3.2:3b"]),
                fundet("lmstudio", "Qwen3 8B Instruct", Some(AiServerKind::LmStudio), &[]),
                fundet("lmstudio", "Gemma 3 4B", Some(AiServerKind::LmStudio), &[]),
                fundet("meetily", "Qwen3.5 4B", None, &[]),
            ],
            ..Default::default()
        };
        let names = |servers: &[LocalAiServer]| -> Vec<String> {
            found.visible(servers).iter().map(|m| m.name.clone()).collect()
        };
        // Ingen servere kører: alt vises.
        assert_eq!(names(&[]).len(), 5);
        // Ollama kører med to af modellerne (en under sit alias).
        assert_eq!(
            names(&[server(AiServerKind::Ollama, &["qwen3:latest"])]),
            vec!["llama3.2:3b", "Qwen3 8B Instruct", "Gemma 3 4B", "Qwen3.5 4B"]
        );
        // LM Studio kender modellen under sit eget id.
        assert_eq!(
            names(&[server(AiServerKind::LmStudio, &["qwen/qwen3-8b-instruct"])]),
            vec!["qwen3:8b", "llama3.2:3b", "Gemma 3 4B", "Qwen3.5 4B"]
        );
        // Et kort navn inde i et langt er en anden model ("Qwen3" mod "qwen3-30b-a3b").
        let kort = FoundModels {
            models: vec![fundet("lmstudio", "Qwen3", Some(AiServerKind::LmStudio), &[])],
            ..Default::default()
        };
        assert_eq!(kort.visible(&[server(AiServerKind::LmStudio, &["qwen3-30b-a3b"])]).len(), 1);
        // En anden slags server skjuler intet, og et program uden server vises altid.
        assert_eq!(names(&[server(AiServerKind::Jan, &["qwen3:8b", "Qwen3.5 4B"])]).len(), 5);
    }

    #[test]
    fn ai_serverporte_fra_spec() {
        assert_eq!(AiServerKind::Ollama.port(), 11434);
        assert_eq!(AiServerKind::LmStudio.port(), 1234);
        assert_eq!(AiServerKind::Jan.port(), 1337);
        assert_eq!(AiServerKind::Llamafile.port(), 8080);
    }
}
