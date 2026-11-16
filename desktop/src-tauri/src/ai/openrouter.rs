use super::{AiConfig, ClassificationResult};
use crate::i18n;
use reqwest::Client;
use std::time::Duration;

/// Classify activities using OpenRouter's OpenAI-compatible API.
/// Supports 100+ models via a single API key.
pub async fn classify(
    config: &AiConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ClassificationResult, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| i18n::t_fmt("error.couldNotCreateHttpClient", &[&e.to_string()]))?;

    let api_key = config
        .api_key
        .as_ref()
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["OpenRouter"]))?;
    let model = config
        .model
        .as_deref()
        .unwrap_or("anthropic/claude-haiku-4-5-20251001");
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://openrouter.ai/api/v1");

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": 4096
    });

    let resp = client
        .post(format!("{}/chat/completions", base_url.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://timetrack.dk")
        .header("X-Title", "TimeTrack")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                i18n::t_fmt("error.timeout", &["OpenRouter", "30"])
            } else if e.is_connect() {
                i18n::t_fmt("error.couldNotConnect", &["OpenRouter"])
            } else {
                i18n::t_fmt("error.connectionError", &["OpenRouter", &e.to_string()])
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["OpenRouter", &status.to_string(), &error_body]));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| i18n::t_fmt("error.couldNotParse", &["OpenRouter", &e.to_string()]))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| i18n::t_fmt("error.noResponseFrom", &["OpenRouter"]))?;

    let json_str = super::extract_json(content).unwrap_or(content);

    serde_json::from_str(json_str)
        .map_err(|e| i18n::t_fmt("error.couldNotParseClassification", &[&e.to_string(), content]))
}

/// Test the connection by sending a trivial prompt.
pub async fn test(config: &AiConfig) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| i18n::t_fmt("error.couldNotCreateHttpClient", &[&e.to_string()]))?;

    let api_key = config
        .api_key
        .as_ref()
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["OpenRouter"]))?;
    let model = config
        .model
        .as_deref()
        .unwrap_or("anthropic/claude-haiku-4-5-20251001");
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://openrouter.ai/api/v1");

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "user", "content": "Svar med: ok"}
        ],
        "max_tokens": 20
    });

    let resp = client
        .post(format!("{}/chat/completions", base_url.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://timetrack.dk")
        .header("X-Title", "TimeTrack")
        .json(&body)
        .send()
        .await
        .map_err(|e| i18n::t_fmt("error.connectionError", &["OpenRouter", &e.to_string()]))?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["OpenRouter", &status.to_string(), &error_body]));
    }

    Ok(i18n::t_fmt("error.connectionOk", &["OpenRouter", model]))
}
