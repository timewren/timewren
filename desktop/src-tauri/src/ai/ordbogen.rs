use super::{AiConfig, ClassificationResult};
use crate::i18n;
use reqwest::Client;
use std::time::Duration;

/// Return at most the first `max_chars` characters of `s` as an owned String.
///
/// Unlike byte-slicing (`&s[..n]`), this never panics on a multi-byte UTF-8
/// boundary — important because `s` is built from arbitrary server bytes on
/// exactly the error path where a flaky endpoint returns non-JSON.
fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Classify activities using Ordbogen.ai's OpenAI-compatible API.
pub async fn classify(
    config: &AiConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ClassificationResult, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .map_err(|e| i18n::t_fmt("error.couldNotCreateHttpClient", &[&e.to_string()]))?;

    let api_key = config
        .api_key
        .as_ref()
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["Ordbogen.ai"]))?;
    let model = config.model.as_deref().unwrap_or("odin");
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.ordbogen.ai/v1");

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

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    // Send + read the body with a few retries. Transient failures (timeouts,
    // dropped connections, interrupted/decode-failed response bodies) are common
    // for streaming LLM responses; a short backoff usually recovers them. Non-2xx
    // statuses and JSON parsing are handled below and are NOT retried.
    const MAX_ATTEMPTS: u32 = 3;
    let (status, raw_bytes) = {
        let mut attempt: u32 = 1;
        loop {
            let send_result = client
                .post(url.as_str())
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await;

            let resp = match send_result {
                Ok(resp) => resp,
                Err(e) => {
                    let transient = e.is_timeout() || e.is_connect() || e.is_request();
                    if transient && attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                        attempt += 1;
                        continue;
                    }
                    return Err(if e.is_timeout() {
                        i18n::t_fmt("error.timeout", &["Ordbogen.ai", "120"])
                    } else if e.is_connect() {
                        i18n::t_fmt("error.couldNotConnect", &["Ordbogen.ai"])
                    } else {
                        i18n::t_fmt("error.connectionError", &["Ordbogen.ai", &e.to_string()])
                    });
                }
            };

            let status = resp.status();
            match resp.bytes().await {
                Ok(bytes) => break (status, bytes),
                Err(e) => {
                    if attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                        attempt += 1;
                        continue;
                    }
                    return Err(i18n::t_fmt(
                        "error.couldNotParse",
                        &["Ordbogen.ai", &format!("bytes read failed: {}", e)],
                    ));
                }
            }
        }
    };

    if !status.is_success() {
        let error_body = String::from_utf8_lossy(&raw_bytes);
        return Err(i18n::t_fmt("error.apiError", &["Ordbogen.ai", &status.to_string(), &error_body]));
    }

    let raw_body = String::from_utf8_lossy(&raw_bytes);

    let json: serde_json::Value = serde_json::from_str(&raw_body)
        .map_err(|e| {
            let preview = truncate_chars(&raw_body, 300);
            i18n::t_fmt("error.couldNotParse", &["Ordbogen.ai", &format!("{} — raw: {}", e, preview)])
        })?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| {
            let preview = truncate_chars(&raw_body, 300);
            i18n::t_fmt("error.noResponseFrom", &[&format!("Ordbogen.ai — response: {}", preview)])
        })?;

    let json_str = super::extract_json(content).unwrap_or(content);

    serde_json::from_str(json_str)
        .map_err(|e| i18n::t_fmt("error.couldNotParseClassification", &[&e.to_string(), content]))
}

/// Test the connection by sending a trivial prompt.
pub async fn test(config: &AiConfig) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .map_err(|e| i18n::t_fmt("error.couldNotCreateHttpClient", &[&e.to_string()]))?;

    let api_key = config
        .api_key
        .as_ref()
        .ok_or_else(|| i18n::t_fmt("error.apiKeyRequired", &["Ordbogen.ai"]))?;
    let model = config.model.as_deref().unwrap_or("odin");
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.ordbogen.ai/v1");

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
        .json(&body)
        .send()
        .await
        .map_err(|e| i18n::t_fmt("error.connectionError", &["Ordbogen.ai", &e.to_string()]))?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp.text().await.unwrap_or_default();
        return Err(i18n::t_fmt("error.apiError", &["Ordbogen.ai", &status.to_string(), &error_body]));
    }

    Ok(i18n::t_fmt("error.connectionOk", &["Ordbogen.ai", model]))
}

#[cfg(test)]
mod tests {
    use super::truncate_chars;

    #[test]
    fn truncate_chars_shorter_than_limit_returns_all() {
        assert_eq!(truncate_chars("hello", 300), "hello");
    }

    #[test]
    fn truncate_chars_limits_by_char_count() {
        assert_eq!(truncate_chars("abcdef", 3), "abc");
    }

    #[test]
    fn truncate_chars_does_not_panic_on_multibyte_boundary() {
        // A multi-byte char ("ø" = 2 bytes, "✓" = 3 bytes, "😀" = 4 bytes)
        // straddling the cut point would panic with byte-slicing `&s[..n]`.
        // Build a string whose 300th *byte* lands inside a multi-byte char.
        let mut s = "a".repeat(299);
        s.push('😀'); // bytes 299..303 — byte 300 is mid-char
        s.push_str(&"b".repeat(50));

        // Must not panic, and must cut on a char boundary.
        let out = truncate_chars(&s, 300);
        assert_eq!(out.chars().count(), 300);
        assert!(out.ends_with('😀'));
    }

    #[test]
    fn truncate_chars_empty_input() {
        assert_eq!(truncate_chars("", 300), "");
    }
}
