//! `tt-ai`: klassifikation af uklare aktivitetsblokke til kunde og projekt.
//!
//! AI er altid valgfrit. Uden udbydere returnerer [`ProviderChain`] bare intet
//! svar, og resten af appen (regler og mønstre i `tt-matcher`) virker uændret.
//!
//! Rækkefølgen af kilder:
//! 1. Indbygget lokal model (cargo-feature `local-llm`, llama.cpp i egen proces).
//! 2. Lokale servere, som [`discovery`] finder (Ollama, LM Studio, Jan, llamafile).
//! 3. Cloud (OpenAI, Anthropic, Gemini, OpenRouter) med brugerens egen nøgle, kun
//!    efter opt-in. Rå titler forlader kun maskinen i det tilfælde.
//!
//! Alle kald er blokerende og skal køres på GPUI's background executor.

pub mod chain;
pub mod config;
pub mod cpu;
pub mod discovery;
pub mod gguf;
mod http;
pub mod idle;
#[cfg(feature = "local-llm")]
pub mod local;
pub mod models;
pub mod ollama;
pub mod prompt;
pub mod providers;
pub mod sanitize;
pub mod scan;
pub mod secrets;
mod types;

pub use chain::{
    AnswerSource, Attempt, AttemptOutcome, CachedAnswer, ChainResult, ProviderChain, QuestionKey,
};
pub use config::{AiSettings, BuildWarning, ProviderConfig, build_chain};
pub use discovery::{DiscoveredServer, ProbeTarget, discover, discover_default, refresh_models};
pub use models::{DEFAULT_MODEL_ID, DownloadProgress, ModelManager, ModelSpec, recommended_models};
pub use providers::{Anthropic, Gemini, Ollama, OpenAiCompatible};
pub use secrets::{KeyringSecrets, MemorySecrets, SecretStore, api_key_name};
pub use types::{
    AiError, BlockSummary, Candidate, Classification, Classifier, ParsedAnswer, ProviderInfo,
    ProviderKind,
};
