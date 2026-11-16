//! HTTP mod web-appens tRPC-API (blokerende ureq; kaldes fra blocking-
//! trådpuljen). Samme format som udvidelsens `client.ts`: queries som GET
//! med `?input={"json":…}`, mutationer som POST med `{"json":…}`, token og
//! organisation i input, og `x-timetrack-client`-headeren.

use std::time::Duration;

use serde_json::Value;

use crate::error::{DataError, Result};
use crate::trpc;

pub const CLIENT_HEADER: &str = "x-timetrack-client";
/// Almindelige kald (som udvidelsen).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
/// Gem af en post får længere tid: en langsom server, der alligevel når at
/// gemme, må ikke ligne en fejl (det gav dobbelte poster i udvidelsen).
pub const SAVE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Query,
    Mutation,
}

#[derive(Clone)]
pub struct Api {
    agent: ureq::Agent,
    base_url: String,
    client_header: String,
}

impl Api {
    pub fn new(base_url: &str, app_version: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .new_agent();
        Api {
            agent,
            base_url: base_url.trim_end_matches('/').to_owned(),
            client_header: format!("desktop/{app_version}"),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn client_header(&self) -> &str {
        &self.client_header
    }

    /// Kald én tRPC-procedure. `input` er allerede beriget med token/org.
    pub fn call(
        &self,
        kind: Kind,
        procedure: &str,
        input: Value,
        date_paths: &[&str],
        timeout: Duration,
    ) -> Result<Value> {
        // Tokenet sendes også i `Authorization` (web's `tokenProcedure`, fra
        // feat/desktop-api-3). TODO(web): når den version er i drift overalt,
        // fjernes tokenet fra input, så det ikke står i `?input=` på queries.
        let bearer = input.get("token").and_then(Value::as_str).map(|t| format!("Bearer {t}"));
        let body = trpc::encode_input(input, date_paths);
        let url = format!("{}/api/trpc/{procedure}", self.base_url);
        let result = match kind {
            Kind::Query => {
                let mut u = url::Url::parse(&url).map_err(|e| DataError::InvalidResponse(e.to_string()))?;
                u.query_pairs_mut().append_pair("input", &body.to_string());
                let mut req = self.agent.get(u.as_str()).header(CLIENT_HEADER, &self.client_header);
                if let Some(b) = &bearer {
                    req = req.header("Authorization", b);
                }
                req.config().timeout_global(Some(timeout)).build().call()
            }
            Kind::Mutation => {
                let mut req = self
                    .agent
                    .post(&url)
                    .header(CLIENT_HEADER, &self.client_header)
                    .header("Content-Type", "application/json");
                if let Some(b) = &bearer {
                    req = req.header("Authorization", b);
                }
                req.config().timeout_global(Some(timeout)).build().send(body.to_string())
            }
        };
        let mut response = result.map_err(map_ureq_error)?;
        let status = response.status().as_u16();
        let text = response.body_mut().read_to_string().map_err(map_ureq_error)?;
        let json: Option<Value> = serde_json::from_str(&text).ok();
        if !(200..300).contains(&status) {
            return Err(trpc::error_from_response(status, json.as_ref()));
        }
        let json = json.ok_or_else(|| DataError::InvalidResponse("svaret var ikke JSON".into()))?;
        trpc::decode_result(&json)
    }

    /// Åbn SSE-strømmen. Læsninger time'er ud efter `idle` uden data (web
    /// pinger hvert 25. s), så en død forbindelse opdages.
    pub fn open_stream(
        &self,
        token: &str,
        organization_id: Option<&str>,
        idle: Duration,
    ) -> Result<(u16, Box<dyn std::io::Read + Send>)> {
        let mut u = url::Url::parse(&format!("{}/api/ext/stream", self.base_url))
            .map_err(|e| DataError::InvalidResponse(e.to_string()))?;
        if let Some(org) = organization_id {
            u.query_pairs_mut().append_pair("organizationId", org);
        }
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_per_read(Some(idle))
            .build()
            .new_agent();
        let response = agent
            .get(u.as_str())
            .header("Authorization", &format!("Bearer {token}"))
            .header("Accept", "text/event-stream")
            .header(CLIENT_HEADER, &self.client_header)
            .call()
            .map_err(map_ureq_error)?;
        let status = response.status().as_u16();
        Ok((status, Box::new(response.into_body().into_reader())))
    }
}

pub fn map_ureq_error(e: ureq::Error) -> DataError {
    match e {
        ureq::Error::Timeout(_) => DataError::Timeout,
        ureq::Error::Io(io) if io.kind() == std::io::ErrorKind::TimedOut => DataError::Timeout,
        ureq::Error::BadUri(u) => DataError::InvalidResponse(format!("ugyldig adresse: {u}")),
        ureq::Error::BodyExceedsLimit(_) => DataError::InvalidResponse("svaret var for stort".into()),
        // Forbindelse nægtet/lukket, DNS, TLS, afbrudt svar: usikkert, så
        // skrivninger må gentages med samme idempotensnøgle.
        _ => DataError::Offline,
    }
}
