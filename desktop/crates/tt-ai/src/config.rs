//! Brugerens AI-indstillinger og opbygning af kæden ud fra dem.

use crate::chain::ProviderChain;
use crate::discovery::DiscoveredServer;
use crate::providers::{
    Anthropic, Gemini, Ollama, OpenAiCompatible, default_cloud_base_url, default_cloud_model,
};
use crate::secrets::{SecretStore, api_key_name};
use crate::types::{Classifier, ProviderKind};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Én udbyder i brugerens rækkefølge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProviderConfig {
    /// Den indbyggede model (den aktive i model-manageren).
    LocalModel,
    Ollama {
        base_url: String,
        model: String,
    },
    /// LM Studio, Jan, llamafile eller generisk. `base_url` slutter med `/v1`.
    OpenAiCompatible {
        kind: ProviderKind,
        base_url: String,
        model: String,
    },
    /// Nøglen hentes fra nøgleringen ([`api_key_name`]).
    Cloud {
        kind: ProviderKind,
        model: Option<String>,
    },
}

impl ProviderConfig {
    /// Konfiguration for en fundet lokal server og en af dens modeller.
    pub fn from_discovered(server: &DiscoveredServer, model: &str) -> Self {
        match server.kind {
            ProviderKind::Ollama => Self::Ollama {
                base_url: server.api_base_url.clone(),
                model: model.into(),
            },
            kind => Self::OpenAiCompatible {
                kind,
                base_url: server.api_base_url.clone(),
                model: model.into(),
            },
        }
    }
}

/// Gemmes i appens indstillinger. Standard: ingen AI og cloud slået fra.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiSettings {
    /// Rækkefølgen, udbyderne prøves i.
    #[serde(default)]
    pub order: Vec<ProviderConfig>,
    /// Brugerens samtykke til, at titler må sendes til cloud. Altid `false` fra start.
    #[serde(default)]
    pub cloud_opt_in: bool,
}

/// En udbyder, der ikke kunne bygges (vises i indstillingerne).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BuildWarning {
    LocalModelUnavailable,
    MissingApiKey(ProviderKind),
    KeyringError(ProviderKind, String),
    NotACloudProvider(ProviderKind),
}

/// Bygger kæden. `local` er den indlæste indbyggede model, hvis der er en.
pub fn build_chain(
    settings: &AiSettings,
    secrets: &dyn SecretStore,
    local: Option<Arc<dyn Classifier>>,
) -> (ProviderChain, Vec<BuildWarning>) {
    let mut providers: Vec<Arc<dyn Classifier>> = Vec::new();
    let mut warnings = Vec::new();
    for p in &settings.order {
        match p {
            ProviderConfig::LocalModel => match &local {
                Some(l) => providers.push(l.clone()),
                None => warnings.push(BuildWarning::LocalModelUnavailable),
            },
            ProviderConfig::Ollama { base_url, model } => {
                providers.push(Arc::new(Ollama::new(base_url, model)))
            }
            ProviderConfig::OpenAiCompatible {
                kind,
                base_url,
                model,
            } => providers.push(Arc::new(OpenAiCompatible::new(
                *kind, base_url, model, None,
            ))),
            ProviderConfig::Cloud { kind, model } => {
                if !kind.is_cloud() {
                    warnings.push(BuildWarning::NotACloudProvider(*kind));
                    continue;
                }
                let key = match secrets.get(&api_key_name(*kind)) {
                    Ok(Some(k)) if !k.is_empty() => k,
                    Ok(_) => {
                        warnings.push(BuildWarning::MissingApiKey(*kind));
                        continue;
                    }
                    Err(e) => {
                        warnings.push(BuildWarning::KeyringError(*kind, e.to_string()));
                        continue;
                    }
                };
                let model = model
                    .clone()
                    .unwrap_or_else(|| default_cloud_model(*kind).to_string());
                let c: Arc<dyn Classifier> = match kind {
                    ProviderKind::Anthropic => Arc::new(Anthropic::new(&key, Some(&model))),
                    ProviderKind::Gemini => Arc::new(Gemini::new(&key, Some(&model))),
                    _ => Arc::new(OpenAiCompatible::new(
                        *kind,
                        default_cloud_base_url(*kind),
                        &model,
                        Some(key),
                    )),
                };
                providers.push(c);
            }
        }
    }
    let chain = ProviderChain::new(providers);
    chain.set_cloud_opt_in(settings.cloud_opt_in);
    (chain, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;

    #[test]
    fn standard_er_uden_ai_og_uden_cloud() {
        let s = AiSettings::default();
        let (chain, w) = build_chain(&s, &MemorySecrets::default(), None);
        assert!(chain.providers().is_empty());
        assert!(!chain.cloud_opt_in());
        assert!(w.is_empty());
        // Gamle/tomme indstillinger kan læses.
        let parsed: AiSettings = serde_json::from_str("{}").unwrap();
        assert!(!parsed.cloud_opt_in);
    }

    #[test]
    fn rækkefølge_bevares_og_manglende_nøgle_advarer() {
        let secrets = MemorySecrets::default();
        secrets
            .set(&api_key_name(ProviderKind::Anthropic), "sk-ant")
            .unwrap();
        let s = AiSettings {
            order: vec![
                ProviderConfig::Ollama {
                    base_url: "http://127.0.0.1:11434".into(),
                    model: "qwen2.5:3b".into(),
                },
                ProviderConfig::LocalModel,
                ProviderConfig::Cloud {
                    kind: ProviderKind::OpenAi,
                    model: None,
                },
                ProviderConfig::Cloud {
                    kind: ProviderKind::Anthropic,
                    model: None,
                },
                ProviderConfig::Cloud {
                    kind: ProviderKind::Ollama,
                    model: None,
                },
            ],
            cloud_opt_in: true,
        };
        let (chain, w) = build_chain(&s, &secrets, None);
        let ids: Vec<String> = chain.providers().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["ollama:qwen2.5:3b", "anthropic:claude-haiku-5-5"]);
        assert_eq!(
            w,
            vec![
                BuildWarning::LocalModelUnavailable,
                BuildWarning::MissingApiKey(ProviderKind::OpenAi),
                BuildWarning::NotACloudProvider(ProviderKind::Ollama),
            ]
        );
        assert!(chain.cloud_opt_in());
    }

    #[test]
    fn indstillinger_rundtur_som_json() {
        let s = AiSettings {
            order: vec![
                ProviderConfig::LocalModel,
                ProviderConfig::OpenAiCompatible {
                    kind: ProviderKind::LmStudio,
                    base_url: "http://127.0.0.1:1234/v1".into(),
                    model: "qwen".into(),
                },
                ProviderConfig::Cloud {
                    kind: ProviderKind::Gemini,
                    model: Some("gemini-x".into()),
                },
            ],
            cloud_opt_in: false,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""type":"open_ai_compatible""#), "{json}");
        assert_eq!(serde_json::from_str::<AiSettings>(&json).unwrap(), s);
    }

    #[test]
    fn fundet_server_bliver_til_konfiguration() {
        let srv = DiscoveredServer {
            kind: ProviderKind::LmStudio,
            base_url: "http://127.0.0.1:1234".into(),
            api_base_url: "http://127.0.0.1:1234/v1".into(),
            models: vec!["m".into()],
            requires_auth: false,
        };
        assert_eq!(
            ProviderConfig::from_discovered(&srv, "m"),
            ProviderConfig::OpenAiCompatible {
                kind: ProviderKind::LmStudio,
                base_url: "http://127.0.0.1:1234/v1".into(),
                model: "m".into()
            }
        );
    }
}
