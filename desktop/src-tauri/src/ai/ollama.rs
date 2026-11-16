use super::{AiConfig, ClassificationResult};
use crate::i18n;
use reqwest::Client;
use std::time::Duration;

/// Classify activities using a local Ollama instance via the chat API.
pub async fn classify(
    config: &AiConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ClassificationResult, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| i18n::t_fmt("error.couldNotCreateHttpClient", &[&e.to_string()]))?;

    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("http://localhost:11434");
    let model = config.model.as_deref().unwrap_or("llama3.1:8b");

    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "format": "json",
        "stream": false,
        "options": {
            "temperature": 0.1,
            "num_predict": 4096
        }
    });

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                i18n::t_fmt("error.ollamaTimeoutTrySmaller", &[base_url])
            } else if e.is_connect() {
                i18n::t_fmt("error.ollamaNotRunning", &[base_url])
            } else {
                i18n::t_fmt("error.connectionError", &["Ollama", &e.to_string()])
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        let lower_body = error_body.to_lowercase();
        if lower_body.contains("not found") || lower_body.contains("no such model") {
            return Err(i18n::t_fmt("error.ollamaModelNotFound", &[model, model]));
        }
        return Err(i18n::t_fmt("error.ollamaError", &[&status.to_string(), &error_body]));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| i18n::t_fmt("error.couldNotParse", &["Ollama", &e.to_string()]))?;

    let content = json["message"]["content"]
        .as_str()
        .ok_or_else(|| i18n::t_fmt("error.noResponseFrom", &["Ollama"]))?;

    // Extract JSON in case the model added surrounding text
    let json_str = super::extract_json(content).unwrap_or(content);

    serde_json::from_str(json_str)
        .map_err(|e| i18n::t_fmt("error.couldNotParseClassification", &[&e.to_string(), content]))
}

/// Test the connection by checking if Ollama is reachable and listing models.
pub async fn test(config: &AiConfig) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| i18n::t_fmt("error.couldNotCreateHttpClient", &[&e.to_string()]))?;

    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("http://localhost:11434");
    let model = config.model.as_deref().unwrap_or("llama3.1:8b");

    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                i18n::t_fmt("error.ollamaNotRunning", &[base_url])
            } else {
                i18n::t_fmt("error.connectionError", &["Ollama", &e.to_string()])
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.ollamaError", &[&status.to_string(), &error_body]));
    }

    Ok(i18n::t_fmt("error.ollamaConnectionOk", &[model, base_url]))
}
