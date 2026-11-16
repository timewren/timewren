use super::{AiConfig, ClassificationResult};
use crate::i18n;
use reqwest::Client;
use std::time::Duration;

/// Classify activities using OpenAI's chat completions API.
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
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["OpenAI"]))?;
    let model = config.model.as_deref().unwrap_or("gpt-4o-mini");

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
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                i18n::t_fmt("error.timeout", &["OpenAI", "30"])
            } else if e.is_connect() {
                i18n::t_fmt("error.couldNotConnect", &["OpenAI"])
            } else {
                i18n::t_fmt("error.connectionError", &["OpenAI", &e.to_string()])
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["OpenAI", &status.to_string(), &error_body]));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| i18n::t_fmt("error.couldNotParse", &["OpenAI", &e.to_string()]))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| i18n::t_fmt("error.noResponseFrom", &["OpenAI"]))?;

    serde_json::from_str(content)
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
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["OpenAI"]))?;
    let model = config.model.as_deref().unwrap_or("gpt-4o-mini");

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "user", "content": "Svar med: {\"status\":\"ok\"}"}
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 20
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| i18n::t_fmt("error.connectionError", &["OpenAI", &e.to_string()]))?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["OpenAI", &status.to_string(), &error_body]));
    }

    Ok(i18n::t_fmt("error.connectionOk", &["OpenAI", model]))
}
