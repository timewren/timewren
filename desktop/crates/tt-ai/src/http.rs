//! Tynd fælles HTTP-indpakning over ureq (blokerende).

use crate::types::AiError;
use serde_json::Value;
use std::time::Duration;
use ureq::Agent;

/// Agent med én samlet tidsgrænse for hele kaldet.
pub fn agent(timeout: Duration) -> Agent {
    Agent::config_builder()
        .timeout_global(Some(timeout))
        .http_status_as_error(false)
        .user_agent("TimeTrack-Desktop")
        .build()
        .into()
}

/// Oversætter en ureq-fejl til vores fejltype.
pub fn map_err(e: ureq::Error, timeout: Duration) -> AiError {
    match e {
        ureq::Error::Timeout(_) => AiError::Timeout(timeout),
        ureq::Error::Io(io) if io.kind() == std::io::ErrorKind::TimedOut => {
            AiError::Timeout(timeout)
        }
        ureq::Error::Io(io) => AiError::Connect(io.to_string()),
        ureq::Error::ConnectionFailed | ureq::Error::HostNotFound => {
            AiError::Connect(e.to_string())
        }
        other => AiError::Connect(other.to_string()),
    }
}

/// POST med JSON-krop. Returnerer JSON-svaret, eller [`AiError::Http`] ved status >= 400.
pub fn post_json(
    agent: &Agent,
    url: &str,
    headers: &[(&str, &str)],
    body: &Value,
    timeout: Duration,
) -> Result<Value, AiError> {
    let mut req = agent.post(url);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let resp = req.send_json(body).map_err(|e| map_err(e, timeout))?;
    read_json(resp, timeout)
}

/// GET der forventer JSON.
pub fn get_json(
    agent: &Agent,
    url: &str,
    headers: &[(&str, &str)],
    timeout: Duration,
) -> Result<Value, AiError> {
    let mut req = agent.get(url);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let resp = req.call().map_err(|e| map_err(e, timeout))?;
    read_json(resp, timeout)
}

fn read_json(
    mut resp: ureq::http::Response<ureq::Body>,
    timeout: Duration,
) -> Result<Value, AiError> {
    let status = resp.status().as_u16();
    let text = resp
        .body_mut()
        .with_config()
        .limit(4 * 1024 * 1024)
        .read_to_string()
        .map_err(|e| map_err(e, timeout))?;
    if status >= 400 {
        return Err(AiError::Http {
            status,
            body: redact(&text),
        });
    }
    serde_json::from_str(&text).map_err(|e| AiError::InvalidResponse(format!("ikke JSON: {e}")))
}

/// Afkorter fejltekster, så de kan logges uden at fylde (og uden hele prompten).
fn redact(body: &str) -> String {
    body.chars().take(300).collect()
}
