use super::{AiConfig, ClassificationResult};
use crate::i18n;
use reqwest::Client;
use std::time::Duration;

/// Classify activities using Anthropic's Messages API.
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
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["Anthropic"]))?;
    let model = config
        .model
        .as_deref()
        .unwrap_or("claude-haiku-4-5-20251001");

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt}
        ]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key.as_str())
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                i18n::t_fmt("error.timeout", &["Anthropic", "30"])
            } else if e.is_connect() {
                i18n::t_fmt("error.couldNotConnect", &["Anthropic"])
            } else {
                i18n::t_fmt("error.connectionError", &["Anthropic", &e.to_string()])
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["Anthropic", &status.to_string(), &error_body]));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| i18n::t_fmt("error.couldNotParse", &["Anthropic", &e.to_string()]))?;

    // Anthropic returns content as an array of content blocks. Newer Claude
    // models may emit a leading "thinking" or "tool_use" block that has no
    // `text` field, so blindly reading content[0] would error with
    // noTextContent and drop the whole batch. Concatenate every block whose
    // type == "text" (or that simply carries a `text` field) instead.
    let content = extract_text_blocks(&json["content"])
        .ok_or_else(|| i18n::t_fmt("error.noTextContent", &["Anthropic"]))?;

    // The response may contain text before/after the JSON. Try to extract the JSON object.
    let json_str = super::extract_json(&content).unwrap_or(&content);

    serde_json::from_str(json_str)
        .map_err(|e| i18n::t_fmt("error.couldNotParseClassification", &[&e.to_string(), &content]))
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
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["Anthropic"]))?;
    let model = config
        .model
        .as_deref()
        .unwrap_or("claude-haiku-4-5-20251001");

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 20,
        "messages": [
            {"role": "user", "content": "Svar med: ok"}
        ]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key.as_str())
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| i18n::t_fmt("error.connectionError", &["Anthropic", &e.to_string()]))?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["Anthropic", &status.to_string(), &error_body]));
    }

    Ok(i18n::t_fmt("error.connectionOk", &["Anthropic", model]))
}

/// Concatenate the text of every "text" content block in an Anthropic response.
///
/// Anthropic's `content` is an array of typed blocks. With extended-thinking or
/// tool-using models the first block may be `thinking`/`tool_use` with no `text`
/// field. We select blocks whose `type == "text"` (falling back to any block
/// that carries a `text` string for forward compatibility) and join them.
///
/// Returns `None` only when there is no text anywhere in the response.
fn extract_text_blocks(content: &serde_json::Value) -> Option<String> {
    let arr = content.as_array()?;
    let mut out = String::new();
    for block in arr {
        let is_text = block.get("type").and_then(|t| t.as_str()) == Some("text");
        // Forward-compat: accept a `text` string even if `type` is absent.
        let has_type = block.get("type").is_some();
        if is_text || !has_type {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                out.push_str(text);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn text_block_selected_when_thinking_block_precedes_it() {
        // Newer models emit a leading `thinking` block with no `text` field.
        // The classifier must still find the JSON in the following text block,
        // instead of erroring with noTextContent on content[0].
        let content = json!([
            { "type": "thinking", "thinking": "Let me reason about this..." },
            { "type": "text", "text": "{\"classifications\":[]}" }
        ]);
        let extracted = extract_text_blocks(&content).expect("should find text block");
        assert_eq!(extracted, "{\"classifications\":[]}");
    }

    #[test]
    fn text_block_selected_when_tool_use_block_precedes_it() {
        let content = json!([
            { "type": "tool_use", "id": "x", "name": "foo", "input": {} },
            { "type": "text", "text": "answer" }
        ]);
        assert_eq!(extract_text_blocks(&content).as_deref(), Some("answer"));
    }

    #[test]
    fn multiple_text_blocks_are_concatenated() {
        let content = json!([
            { "type": "text", "text": "{\"a\":" },
            { "type": "text", "text": "1}" }
        ]);
        assert_eq!(extract_text_blocks(&content).as_deref(), Some("{\"a\":1}"));
    }

    #[test]
    fn no_text_block_returns_none() {
        let content = json!([
            { "type": "thinking", "thinking": "..." }
        ]);
        assert!(extract_text_blocks(&content).is_none());
    }

    #[test]
    fn single_plain_text_block_still_works() {
        let content = json!([
            { "type": "text", "text": "hello" }
        ]);
        assert_eq!(extract_text_blocks(&content).as_deref(), Some("hello"));
    }
}
