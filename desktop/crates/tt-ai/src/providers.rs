//! HTTP-udbydere: OpenAI-formatet (OpenAI, OpenRouter, LM Studio, Jan,
//! llamafile, generisk), Ollama, Anthropic og Google Gemini.

use crate::http;
use crate::prompt::{self, SYSTEM_PROMPT};
use crate::types::{
    AiError, BlockSummary, Candidate, Classification, Classifier, ProviderInfo, ProviderKind,
};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Standardtidsgrænse for lokale servere (små modeller på CPU kan være langsomme).
pub const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);
/// Standardtidsgrænse for cloud-udbydere.
pub const CLOUD_TIMEOUT: Duration = Duration::from_secs(20);
/// Maks. tokens i svaret. Svaret er en kort JSON-linje.
const MAX_ANSWER_TOKENS: u32 = 300;

/// Standardmodeller for cloud. Brugeren kan vælge andre i indstillingerne.
pub fn default_cloud_model(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::OpenAi => "gpt-5-mini",
        ProviderKind::Anthropic => "claude-haiku-5-5",
        ProviderKind::Gemini => "gemini-2.5-flash-lite",
        ProviderKind::OpenRouter => "openai/gpt-5-mini",
        _ => "",
    }
}

/// Officielle endpoints for cloud-udbyderne.
pub fn default_cloud_base_url(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::OpenAi => "https://api.openai.com/v1",
        ProviderKind::Anthropic => "https://api.anthropic.com",
        ProviderKind::Gemini => "https://generativelanguage.googleapis.com",
        ProviderKind::OpenRouter => "https://openrouter.ai/api/v1",
        _ => "",
    }
}

/// Sandt, hvis URL'en peger på denne maskine.
pub fn is_loopback_url(url: &str) -> bool {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split('/').next().unwrap_or("");
    let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = if let Some(stripped) = authority.strip_prefix('[') {
        stripped.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    // Kun rigtige IP-adresser eller præcis "localhost": et navn som
    // "127.0.0.1.nip.io" ligner loopback, men kan pege hvor som helst hen.
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

fn finish(parsed: crate::types::ParsedAnswer, candidates: &[Candidate]) -> Option<Classification> {
    parsed.into_classification(candidates)
}

fn no_candidates(candidates: &[Candidate]) -> bool {
    candidates.is_empty()
}

// ---------------------------------------------------------------------------
// OpenAI-formatet
// ---------------------------------------------------------------------------

/// Chat Completions-klient for alt, der taler OpenAI-formatet.
pub struct OpenAiCompatible {
    kind: ProviderKind,
    base_url: String,
    model: String,
    api_key: Option<String>,
    timeout: Duration,
    agent: ureq::Agent,
    /// Slås fra, hvis serveren afviser `response_format` (ældre llamafile/Jan).
    structured: AtomicBool,
}

impl OpenAiCompatible {
    /// `base_url` slutter med `/v1`, fx `http://127.0.0.1:1234/v1`.
    pub fn new(kind: ProviderKind, base_url: &str, model: &str, api_key: Option<String>) -> Self {
        let timeout = if kind.is_cloud() {
            CLOUD_TIMEOUT
        } else {
            LOCAL_TIMEOUT
        };
        Self {
            kind,
            base_url: base_url.trim_end_matches('/').to_string(),
            model: model.to_string(),
            api_key: api_key.filter(|k| !k.is_empty()),
            timeout,
            agent: http::agent(timeout),
            structured: AtomicBool::new(true),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self.agent = http::agent(timeout);
        self
    }

    fn body(&self, block: &BlockSummary, candidates: &[Candidate], structured: bool) -> Value {
        let mut body = json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt::user_prompt(block, candidates)}
            ]
        });
        // OpenAI's nyere modeller afviser temperature og max_tokens; de andre vil gerne have dem.
        if self.kind != ProviderKind::OpenAi {
            body["temperature"] = json!(0);
            body["max_tokens"] = json!(MAX_ANSWER_TOKENS);
        }
        if structured {
            body["response_format"] = json!({
                "type": "json_schema",
                "json_schema": {"name": "klassifikation", "strict": true, "schema": prompt::response_schema()}
            });
        }
        body
    }

    fn send(&self, body: &Value) -> Result<Value, AiError> {
        let url = format!("{}/chat/completions", self.base_url);
        let auth = self.api_key.as_ref().map(|k| format!("Bearer {k}"));
        let mut headers: Vec<(&str, &str)> = Vec::new();
        if let Some(a) = &auth {
            headers.push(("Authorization", a));
        }
        if self.kind == ProviderKind::OpenRouter {
            headers.push(("HTTP-Referer", "https://timetrack.dk"));
            headers.push(("X-Title", "TimeTrack Desktop"));
        }
        http::post_json(&self.agent, &url, &headers, body, self.timeout)
    }
}

impl Classifier for OpenAiCompatible {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: format!("{}:{}", kind_slug(self.kind), self.model),
            kind: self.kind,
            model: self.model.clone(),
            sends_data_off_device: self.kind.is_cloud() || !is_loopback_url(&self.base_url),
        }
    }

    fn classify(
        &self,
        block: &BlockSummary,
        candidates: &[Candidate],
    ) -> Result<Option<Classification>, AiError> {
        if no_candidates(candidates) {
            return Ok(None);
        }
        if self.kind.is_cloud() && self.api_key.is_none() {
            return Err(AiError::MissingApiKey(self.kind.label()));
        }
        let structured = self.structured.load(Ordering::Relaxed);
        let resp = match self.send(&self.body(block, candidates, structured)) {
            // Ældre lokale servere kender ikke json_schema: prøv én gang uden.
            Err(AiError::Http {
                status: 400 | 422, ..
            }) if structured && !self.kind.is_cloud() => {
                self.structured.store(false, Ordering::Relaxed);
                self.send(&self.body(block, candidates, false))?
            }
            other => other?,
        };
        let content = resp["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| AiError::InvalidResponse("mangler choices[0].message.content".into()))?;
        Ok(finish(
            prompt::parse_answer(content, candidates.len())?,
            candidates,
        ))
    }
}

pub(crate) fn kind_slug(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::LocalModel => "local",
        ProviderKind::Ollama => "ollama",
        ProviderKind::LmStudio => "lmstudio",
        ProviderKind::Jan => "jan",
        ProviderKind::Llamafile => "llamafile",
        ProviderKind::OpenAiCompatible => "openai-compatible",
        ProviderKind::OpenAi => "openai",
        ProviderKind::Anthropic => "anthropic",
        ProviderKind::Gemini => "gemini",
        ProviderKind::OpenRouter => "openrouter",
    }
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

/// Ollamas eget API (`/api/chat` med `format` = JSON-skema).
pub struct Ollama {
    base_url: String,
    model: String,
    timeout: Duration,
    agent: ureq::Agent,
}

impl Ollama {
    /// `base_url` uden sti, fx `http://127.0.0.1:11434`.
    pub fn new(base_url: &str, model: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            model: model.to_string(),
            timeout: LOCAL_TIMEOUT,
            agent: http::agent(LOCAL_TIMEOUT),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self.agent = http::agent(timeout);
        self
    }
}

impl Classifier for Ollama {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: format!("ollama:{}", self.model),
            kind: ProviderKind::Ollama,
            model: self.model.clone(),
            sends_data_off_device: !is_loopback_url(&self.base_url),
        }
    }

    fn classify(
        &self,
        block: &BlockSummary,
        candidates: &[Candidate],
    ) -> Result<Option<Classification>, AiError> {
        if no_candidates(candidates) {
            return Ok(None);
        }
        let body = json!({
            "model": self.model,
            "stream": false,
            "format": prompt::response_schema(),
            "keep_alive": "10m",
            "options": {"temperature": 0, "num_predict": MAX_ANSWER_TOKENS},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt::user_prompt(block, candidates)}
            ]
        });
        let url = format!("{}/api/chat", self.base_url);
        let resp = http::post_json(&self.agent, &url, &[], &body, self.timeout)?;
        let content = resp["message"]["content"]
            .as_str()
            .ok_or_else(|| AiError::InvalidResponse("mangler message.content".into()))?;
        Ok(finish(
            prompt::parse_answer(content, candidates.len())?,
            candidates,
        ))
    }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

/// Anthropic Messages API. Struktureret svar via tvunget tool-kald.
pub struct Anthropic {
    base_url: String,
    model: String,
    api_key: String,
    timeout: Duration,
    agent: ureq::Agent,
}

const ANTHROPIC_TOOL: &str = "klassificer";

impl Anthropic {
    pub fn new(api_key: &str, model: Option<&str>) -> Self {
        Self {
            base_url: default_cloud_base_url(ProviderKind::Anthropic).to_string(),
            model: model
                .unwrap_or(default_cloud_model(ProviderKind::Anthropic))
                .to_string(),
            api_key: api_key.to_string(),
            timeout: CLOUD_TIMEOUT,
            agent: http::agent(CLOUD_TIMEOUT),
        }
    }

    /// Kun til tests og proxyer.
    pub fn with_base_url(mut self, base_url: &str) -> Self {
        self.base_url = base_url.trim_end_matches('/').to_string();
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self.agent = http::agent(timeout);
        self
    }
}

impl Classifier for Anthropic {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: format!("anthropic:{}", self.model),
            kind: ProviderKind::Anthropic,
            model: self.model.clone(),
            sends_data_off_device: true,
        }
    }

    fn classify(
        &self,
        block: &BlockSummary,
        candidates: &[Candidate],
    ) -> Result<Option<Classification>, AiError> {
        if no_candidates(candidates) {
            return Ok(None);
        }
        if self.api_key.is_empty() {
            return Err(AiError::MissingApiKey("Anthropic"));
        }
        let body = json!({
            "model": self.model,
            "max_tokens": MAX_ANSWER_TOKENS,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": prompt::user_prompt(block, candidates)}],
            "tools": [{
                "name": ANTHROPIC_TOOL,
                "description": "Registrér hvilken kandidat aktiviteten hører til.",
                "input_schema": prompt::response_schema()
            }],
            "tool_choice": {"type": "tool", "name": ANTHROPIC_TOOL}
        });
        let url = format!("{}/v1/messages", self.base_url);
        let headers = [
            ("x-api-key", self.api_key.as_str()),
            ("anthropic-version", "2023-06-01"),
        ];
        let resp = http::post_json(&self.agent, &url, &headers, &body, self.timeout)?;
        let blocks = resp["content"]
            .as_array()
            .ok_or_else(|| AiError::InvalidResponse("mangler content".into()))?;
        if let Some(input) = blocks
            .iter()
            .find(|b| b["type"] == "tool_use" && b["name"] == ANTHROPIC_TOOL)
            .map(|b| &b["input"])
        {
            return Ok(finish(
                prompt::parse_value(input, candidates.len())?,
                candidates,
            ));
        }
        // Reserve: tekstblokke (fx hvis en proxy ignorerer tool_choice).
        let text: String = blocks.iter().filter_map(|b| b["text"].as_str()).collect();
        Ok(finish(
            prompt::parse_answer(&text, candidates.len())?,
            candidates,
        ))
    }
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

/// Gemini `generateContent` med `responseSchema`. Nøglen sendes som header, ikke i URL'en.
pub struct Gemini {
    base_url: String,
    model: String,
    api_key: String,
    timeout: Duration,
    agent: ureq::Agent,
}

impl Gemini {
    pub fn new(api_key: &str, model: Option<&str>) -> Self {
        Self {
            base_url: default_cloud_base_url(ProviderKind::Gemini).to_string(),
            model: model
                .unwrap_or(default_cloud_model(ProviderKind::Gemini))
                .to_string(),
            api_key: api_key.to_string(),
            timeout: CLOUD_TIMEOUT,
            agent: http::agent(CLOUD_TIMEOUT),
        }
    }

    pub fn with_base_url(mut self, base_url: &str) -> Self {
        self.base_url = base_url.trim_end_matches('/').to_string();
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self.agent = http::agent(timeout);
        self
    }
}

impl Classifier for Gemini {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: format!("gemini:{}", self.model),
            kind: ProviderKind::Gemini,
            model: self.model.clone(),
            sends_data_off_device: true,
        }
    }

    fn classify(
        &self,
        block: &BlockSummary,
        candidates: &[Candidate],
    ) -> Result<Option<Classification>, AiError> {
        if no_candidates(candidates) {
            return Ok(None);
        }
        if self.api_key.is_empty() {
            return Err(AiError::MissingApiKey("Google Gemini"));
        }
        let body = json!({
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": prompt::user_prompt(block, candidates)}]}],
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": MAX_ANSWER_TOKENS,
                "responseMimeType": "application/json",
                "responseSchema": prompt::gemini_schema()
            }
        });
        let url = format!(
            "{}/v1beta/models/{}:generateContent",
            self.base_url, self.model
        );
        let headers = [("x-goog-api-key", self.api_key.as_str())];
        let resp = http::post_json(&self.agent, &url, &headers, &body, self.timeout)?;
        let text: String = resp["candidates"][0]["content"]["parts"]
            .as_array()
            .map(|parts| parts.iter().filter_map(|p| p["text"].as_str()).collect())
            .unwrap_or_default();
        if text.is_empty() {
            return Err(AiError::InvalidResponse(
                "Gemini returnerede ingen tekst".into(),
            ));
        }
        Ok(finish(
            prompt::parse_answer(&text, candidates.len())?,
            candidates,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_genkendes() {
        assert!(is_loopback_url("http://127.0.0.1:11434"));
        assert!(is_loopback_url("http://localhost:1234/v1"));
        assert!(is_loopback_url("http://[::1]:8080/v1"));
        assert!(is_loopback_url("http://user:pw@127.0.0.1:1/v1"));
        assert!(!is_loopback_url("http://192.168.1.20:11434"));
        assert!(!is_loopback_url("https://api.openai.com/v1"));
        assert!(!is_loopback_url("http://localhost.evil.com/v1"));
        assert!(!is_loopback_url("http://127.0.0.1.nip.io:11434"));
        assert!(!is_loopback_url("http://127.evil.com/v1"));
        assert!(is_loopback_url("http://127.0.0.2:8080"));
    }

    #[test]
    fn server_på_lan_sender_data_væk() {
        let lan = OpenAiCompatible::new(
            ProviderKind::OpenAiCompatible,
            "http://10.0.0.5:8000/v1",
            "m",
            None,
        );
        assert!(lan.info().sends_data_off_device);
        let lokal = OpenAiCompatible::new(
            ProviderKind::LmStudio,
            "http://127.0.0.1:1234/v1",
            "m",
            None,
        );
        assert!(!lokal.info().sends_data_off_device);
        assert!(
            Ollama::new("http://192.168.0.2:11434", "m")
                .info()
                .sends_data_off_device
        );
    }

    #[test]
    fn cloud_flagger_altid_data_væk() {
        let o = OpenAiCompatible::new(
            ProviderKind::OpenAi,
            "http://127.0.0.1:1/v1",
            "m",
            Some("k".into()),
        );
        assert!(o.info().sends_data_off_device);
        assert!(Anthropic::new("k", None).info().sends_data_off_device);
        assert!(Gemini::new("k", None).info().sends_data_off_device);
    }

    #[test]
    fn cloud_uden_nøgle_kalder_ikke_netværket() {
        let o = OpenAiCompatible::new(ProviderKind::OpenAi, "http://127.0.0.1:9/v1", "m", None);
        let c = vec![Candidate {
            client_id: "k".into(),
            client_name: "K".into(),
            ..Default::default()
        }];
        assert!(matches!(
            o.classify(&BlockSummary::default(), &c),
            Err(AiError::MissingApiKey(_))
        ));
    }
}
