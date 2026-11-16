use super::{AiConfig, ClassificationResult};
use crate::i18n;
use reqwest::Client;
use std::time::Duration;

/// Classify activities using Google's Gemini API.
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
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["Google"]))?;
    let model = config.model.as_deref().unwrap_or("gemini-2.0-flash");

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let body = serde_json::json!({
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [
            {
                "parts": [
                    {"text": user_prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "maxOutputTokens": 4096
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
                i18n::t_fmt("error.timeout", &["Google Gemini", "30"])
            } else if e.is_connect() {
                i18n::t_fmt("error.couldNotConnect", &["Google Gemini"])
            } else {
                i18n::t_fmt("error.connectionError", &["Google Gemini", &e.to_string()])
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["Google Gemini", &status.to_string(), &error_body]));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| i18n::t_fmt("error.couldNotParse", &["Google Gemini", &e.to_string()]))?;

    // Gemini returns candidates[0].content.parts[0].text
    let content = json["candidates"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|candidate| candidate["content"]["parts"].as_array())
        .and_then(|parts| parts.first())
        .and_then(|part| part["text"].as_str())
        .ok_or_else(|| i18n::t_fmt("error.noTextContent", &["Google Gemini"]))?;

    // Extract JSON in case there is surrounding text
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
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["Google"]))?;
    let model = config.model.as_deref().unwrap_or("gemini-2.0-flash");

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let body = serde_json::json!({
        "contents": [{"parts": [{"text": "Svar med: ok"}]}],
        "generationConfig": {"maxOutputTokens": 10}
    });

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| i18n::t_fmt("error.connectionError", &["Google Gemini", &e.to_string()]))?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["Google Gemini", &status.to_string(), &error_body]));
    }

    Ok(i18n::t_fmt("error.connectionOk", &["Google Gemini", model]))
}
