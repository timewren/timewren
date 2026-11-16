//! Automatisk genkendelse af lokale AI-servere.
//!
//! Alle porte prøves parallelt med kort tidsgrænse. Intet fundet er ikke en
//! fejl; resultatet er bare en tom liste.

use crate::http;
use crate::types::{AiError, ProviderKind};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

/// Standardtidsgrænse pr. port. Lokale servere svarer på få millisekunder.
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(600);

/// Én port, der skal prøves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProbeTarget {
    pub kind: ProviderKind,
    /// Uden sti, fx `http://127.0.0.1:11434`.
    pub base_url: String,
}

impl ProbeTarget {
    pub fn new(kind: ProviderKind, base_url: impl Into<String>) -> Self {
        Self {
            kind,
            base_url: base_url.into().trim_end_matches('/').to_string(),
        }
    }

    /// Generisk OpenAI-kompatibel server på en valgfri port på denne maskine.
    pub fn openai_compatible(port: u16) -> Self {
        Self::new(
            ProviderKind::OpenAiCompatible,
            format!("http://127.0.0.1:{port}"),
        )
    }
}

/// Kendte standardporte. 127.0.0.1 i stedet for localhost undgår IPv6-omvejen.
pub fn default_targets() -> Vec<ProbeTarget> {
    vec![
        ProbeTarget::new(ProviderKind::Ollama, "http://127.0.0.1:11434"),
        ProbeTarget::new(ProviderKind::LmStudio, "http://127.0.0.1:1234"),
        ProbeTarget::new(ProviderKind::Jan, "http://127.0.0.1:1337"),
        ProbeTarget::new(ProviderKind::Llamafile, "http://127.0.0.1:8080"),
    ]
}

/// En fundet server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveredServer {
    pub kind: ProviderKind,
    pub base_url: String,
    /// Base-URL til klassifikation: `/v1` for OpenAI-formatet, uden sti for Ollama.
    pub api_base_url: String,
    pub models: Vec<String>,
    /// Serveren svarede 401/403 (fx Jan med API-nøgle slået til).
    pub requires_auth: bool,
}

/// Prøver alle mål parallelt og returnerer dem, der svarer i det forventede format.
pub fn discover(targets: &[ProbeTarget], timeout: Duration) -> Vec<DiscoveredServer> {
    std::thread::scope(|s| {
        let handles: Vec<_> = targets
            .iter()
            .map(|t| s.spawn(move || probe(t, timeout).ok().flatten()))
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok().flatten())
            .collect()
    })
}

/// Standardporte + evt. ekstra porte for generiske servere.
pub fn discover_default(extra_ports: &[u16]) -> Vec<DiscoveredServer> {
    let mut targets = default_targets();
    for &p in extra_ports {
        let t = ProbeTarget::openai_compatible(p);
        if !targets.iter().any(|d| d.base_url == t.base_url) {
            targets.push(t);
        }
    }
    discover(&targets, PROBE_TIMEOUT)
}

/// Henter modellisten fra én kendt server igen, fx efter at brugeren har
/// hentet en ny model i Ollama. Modellisten er sorteret, og embedding-modeller
/// er sorteret fra.
pub fn refresh_models(
    kind: ProviderKind,
    base_url: &str,
    timeout: Duration,
) -> Result<Vec<String>, AiError> {
    let target = ProbeTarget::new(kind, base_url);
    match probe(&target, timeout)? {
        Some(s) if s.requires_auth => Err(AiError::Http {
            status: 401,
            body: "serveren kræver en API-nøgle".into(),
        }),
        Some(s) => Ok(s.models),
        None => Err(AiError::Connect(format!(
            "ingen AI-server svarede på {}",
            target.base_url
        ))),
    }
}

/// `Ok(None)` = intet (eller noget andet end en AI-server) på porten.
fn probe(target: &ProbeTarget, timeout: Duration) -> Result<Option<DiscoveredServer>, AiError> {
    let agent = http::agent(timeout);
    let (path, api_base) = match target.kind {
        ProviderKind::Ollama => ("/api/tags", target.base_url.clone()),
        _ => ("/v1/models", format!("{}/v1", target.base_url)),
    };
    let found = |models: Vec<String>, requires_auth: bool| DiscoveredServer {
        kind: target.kind,
        base_url: target.base_url.clone(),
        api_base_url: api_base.clone(),
        models,
        requires_auth,
    };
    match http::get_json(&agent, &format!("{}{path}", target.base_url), &[], timeout) {
        Ok(v) => Ok(parse_models(target.kind, &v).map(|m| found(m, false))),
        // Kun kendte AI-porte tæller som fundet bag login; en tilfældig 401 på 8080 gør ikke.
        Err(AiError::Http {
            status: 401 | 403, ..
        }) if matches!(target.kind, ProviderKind::Jan | ProviderKind::LmStudio) => {
            Ok(Some(found(Vec::new(), true)))
        }
        Err(_) => Ok(None),
    }
}

/// Læser modellisten i Ollama- eller OpenAI-format. `None` hvis formatet ikke passer.
pub fn parse_models(kind: ProviderKind, v: &Value) -> Option<Vec<String>> {
    let (list, field) = match kind {
        ProviderKind::Ollama => (v.get("models")?.as_array()?, "name"),
        _ => (v.get("data")?.as_array()?, "id"),
    };
    let mut models: Vec<String> = list
        .iter()
        .filter_map(|m| m.get(field).and_then(Value::as_str).map(str::to_string))
        // Embedding-modeller kan ikke klassificere.
        .filter(|name| !name.to_ascii_lowercase().contains("embed"))
        .collect();
    models.sort();
    models.dedup();
    Some(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ollama_format() {
        let v = json!({"models": [{"name": "qwen2.5:3b"}, {"name": "nomic-embed-text"}, {"name": "llama3.2"}]});
        assert_eq!(
            parse_models(ProviderKind::Ollama, &v).unwrap(),
            vec!["llama3.2", "qwen2.5:3b"]
        );
    }

    #[test]
    fn openai_format() {
        let v = json!({"object": "list", "data": [{"id": "qwen2.5-7b-instruct"}, {"id": "text-embedding-nomic"}]});
        assert_eq!(
            parse_models(ProviderKind::LmStudio, &v).unwrap(),
            vec!["qwen2.5-7b-instruct"]
        );
    }

    #[test]
    fn fremmed_json_er_ikke_en_server() {
        assert!(parse_models(ProviderKind::Llamafile, &json!({"status": "ok"})).is_none());
        assert!(parse_models(ProviderKind::Ollama, &json!({"data": []})).is_none());
    }

    #[test]
    fn standardmål_bruger_ipv4_og_kendte_porte() {
        let t = default_targets();
        let ports: Vec<&str> = t
            .iter()
            .map(|t| t.base_url.rsplit(':').next().unwrap())
            .collect();
        assert_eq!(ports, vec!["11434", "1234", "1337", "8080"]);
        assert!(
            t.iter()
                .all(|t| t.base_url.starts_with("http://127.0.0.1:"))
        );
    }
}
