//! Fælles typer: spørgsmålet (blok + kandidater), svaret og fejl.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Opsummering af én uklar aktivitetsblok.
///
/// Felterne er rå titler fra maskinen. De forlader kun maskinen, hvis brugeren
/// har slået cloud-AI til (se [`crate::ProviderChain::set_cloud_opt_in`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockSummary {
    /// Programnavn, fx "Code" eller "Google Chrome".
    pub app: String,
    /// Den dominerende vinduestitel i blokken.
    pub title: String,
    /// Domæne for browser-faner, fx "github.com".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Arbejdsmappe eller repo-navn, hvis tracker kender den.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    /// Varighed i sekunder. Indgår ikke i cache-nøglen.
    #[serde(default)]
    pub duration_secs: u64,
}

/// En mulig kunde/projekt-kombination, som AI'en må vælge imellem.
///
/// AI'en vælger altid blandt kandidaterne og kan aldrig opfinde en kunde.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Candidate {
    pub client_id: String,
    pub client_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    /// Nøgleord fra projektet (domæner, repo-navne osv.).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<String>,
}

/// AI'ens svar på ét spørgsmål.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Classification {
    pub client_id: String,
    pub project_id: Option<String>,
    /// 0.0 til 1.0.
    pub confidence: f32,
    /// Kort begrundelse (renset, højst 300 tegn).
    pub reasoning: String,
}

/// Rå, valideret svar fra en udbyder: hvilken kandidat (eller ingen).
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedAnswer {
    /// Indeks i kandidatlisten (0-baseret), `None` = ingen passer.
    pub candidate: Option<usize>,
    pub confidence: f32,
    pub reasoning: String,
}

impl ParsedAnswer {
    /// Slår kandidaten op og laver det endelige svar.
    pub fn into_classification(self, candidates: &[Candidate]) -> Option<Classification> {
        let c = candidates.get(self.candidate?)?;
        Some(Classification {
            client_id: c.client_id.clone(),
            project_id: c.project_id.clone(),
            confidence: self.confidence,
            reasoning: self.reasoning,
        })
    }
}

/// Hvad slags udbyder det er.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    /// Indbygget model i appens egen proces.
    LocalModel,
    Ollama,
    LmStudio,
    Jan,
    Llamafile,
    /// Generisk OpenAI-kompatibel server (lokal eller i eget netværk).
    OpenAiCompatible,
    OpenAi,
    Anthropic,
    Gemini,
    OpenRouter,
}

impl ProviderKind {
    /// Visningsnavn i UI.
    pub fn label(self) -> &'static str {
        match self {
            Self::LocalModel => "Indbygget model",
            Self::Ollama => "Ollama",
            Self::LmStudio => "LM Studio",
            Self::Jan => "Jan",
            Self::Llamafile => "llamafile",
            Self::OpenAiCompatible => "OpenAI-kompatibel server",
            Self::OpenAi => "OpenAI",
            Self::Anthropic => "Anthropic",
            Self::Gemini => "Google Gemini",
            Self::OpenRouter => "OpenRouter",
        }
    }

    /// Cloud-udbydere, der kræver opt-in og egen nøgle.
    pub fn is_cloud(self) -> bool {
        matches!(
            self,
            Self::OpenAi | Self::Anthropic | Self::Gemini | Self::OpenRouter
        )
    }
}

/// Metadata om en udbyder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderInfo {
    /// Stabilt id, fx "ollama:qwen2.5:3b" eller "openai:gpt-5-mini".
    pub id: String,
    pub kind: ProviderKind,
    pub model: String,
    /// Sandt, hvis spørgsmålet (inkl. rå titler) sendes væk fra maskinen.
    pub sends_data_off_device: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("tidsgrænsen på {0:?} blev overskredet")]
    Timeout(Duration),
    #[error("kunne ikke forbinde: {0}")]
    Connect(String),
    #[error("HTTP {status}: {body}")]
    Http { status: u16, body: String },
    #[error("ugyldigt svar fra modellen: {0}")]
    InvalidResponse(String),
    #[error("mangler API-nøgle til {0}")]
    MissingApiKey(&'static str),
    #[error("nøgleringen: {0}")]
    Keyring(String),
    #[error("model: {0}")]
    Model(String),
    #[error("SHA256 passer ikke (forventet {expected}, fik {actual})")]
    ChecksumMismatch { expected: String, actual: String },
    #[error("annulleret")]
    Cancelled,
    #[error("modellen hentes allerede")]
    AlreadyDownloading,
    #[error("modellen kunne ikke indlæses: {0}")]
    ModelLoad(String),
    #[error("den delte model kunne ikke indlæses: {0}")]
    SharedModelLoad(String),
    #[error("processoren mangler {0}")]
    UnsupportedCpu(String),
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
}

impl AiError {
    /// Kort, dansk beskrivelse til UI uden tekniske detaljer.
    pub fn user_message(&self) -> &'static str {
        match self {
            Self::Timeout(_) => "AI'en svarede ikke i tide.",
            Self::Connect(_) => "Kunne ikke nå AI-tjenesten.",
            Self::Http {
                status: 401 | 403, ..
            }
            | Self::MissingApiKey(_) => "API-nøglen mangler eller er ugyldig.",
            Self::Http { status: 429, .. } => "AI-tjenesten afviser flere kald lige nu.",
            Self::Http { .. } => "AI-tjenesten returnerede en fejl.",
            Self::InvalidResponse(_) => "AI'en gav et svar, appen ikke kunne bruge.",
            Self::Keyring(_) => "Nøgleringen kunne ikke åbnes.",
            Self::Model(_) => "Den lokale model kunne ikke køre.",
            Self::ChecksumMismatch { .. } => "Den hentede model er beskadiget.",
            Self::Cancelled => "Annulleret.",
            Self::AlreadyDownloading => "Modellen hentes allerede.",
            Self::ModelLoad(_) => {
                "Den indbyggede model kunne ikke indlæses. Filen kan være beskadiget: slet modellen under Indstillinger → AI, og hent den igen."
            }
            Self::SharedModelLoad(_) => {
                "Modellen fra det andet program kunne ikke indlæses. Den er måske flyttet eller slettet, eller formatet understøttes ikke. Vælg en anden model under Indstillinger → AI."
            }
            Self::UnsupportedCpu(_) => crate::cpu::UNSUPPORTED_MESSAGE,
            Self::Io(_) => "Fil- eller netværksfejl.",
        }
    }
}

/// Klassificerer én uklar blok blandt et sæt kandidater.
///
/// Kaldet er blokerende og respekterer udbyderens tidsgrænse. Det køres fra
/// GPUI's background executor, aldrig på UI-tråden.
pub trait Classifier: Send + Sync {
    fn info(&self) -> ProviderInfo;

    /// `Ok(None)` betyder, at AI'en mener, at ingen kandidat passer.
    fn classify(
        &self,
        block: &BlockSummary,
        candidates: &[Candidate],
    ) -> Result<Option<Classification>, AiError>;
}
