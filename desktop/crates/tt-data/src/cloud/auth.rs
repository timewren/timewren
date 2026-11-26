//! Login og tokens (spec A3).
//!
//! - Browser-godkendelse med deep link: appen åbner `authorize_url`, web
//!   sender brugeren tilbage til `timetrack://auth/callback?code=…&state=…`.
//!   `state` kontrolleres (lukker login-CSRF), og koden veksles med PKCE-
//!   verifier, så en opsnappet kode ikke kan bruges af andre.
//! - Adgangstoken med refresh. Et gammelt extension-token (uden udløb) kan
//!   også bruges direkte (`login_with_token`).
//!
//! Hemmeligheder gemmes via [`SecretStore`]; appen giver en keyring-
//! implementering (macOS Keychain / Windows Credential Manager).

use std::sync::Arc;

use base64::Engine;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{DataError, Result};
use crate::model::{DeviceInfo, User};

/// Redirect-URI for deep linket i TimeTrack. Brug [`redirect_uri`], som
/// følger udgaven (TimeWren: `timewren://auth/callback`).
pub const REDIRECT_URI: &str = "timetrack://auth/callback";

/// Deep linkets adresse i denne udgave.
pub fn redirect_uri() -> String {
    tt_core::edition::EDITION.redirect_uri()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// None = udløber ikke (gammelt extension-token).
    pub expires_at: Option<DateTime<Utc>>,
    pub user: User,
    pub organization_id: Option<String>,
}

impl Credentials {
    /// Skal tokenet fornyes nu (udløber inden for et minut)?
    pub fn needs_refresh(&self, now: DateTime<Utc>) -> bool {
        self.refresh_token.is_some()
            && self.expires_at.is_some_and(|e| e - now < chrono::Duration::seconds(60))
    }
}

/// Opbevaring af login (keyring i appen).
pub trait SecretStore: Send + Sync {
    fn load(&self) -> Option<Credentials>;
    fn save(&self, credentials: &Credentials);
    fn clear(&self);
}

/// I hukommelsen (tests, og hvis keyring ikke er tilgængelig).
#[derive(Default, Clone)]
pub struct MemorySecretStore {
    inner: Arc<Mutex<Option<Credentials>>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with(credentials: Credentials) -> Self {
        Self { inner: Arc::new(Mutex::new(Some(credentials))) }
    }
}

impl SecretStore for MemorySecretStore {
    fn load(&self) -> Option<Credentials> {
        self.inner.lock().clone()
    }
    fn save(&self, credentials: &Credentials) {
        *self.inner.lock() = Some(credentials.clone());
    }
    fn clear(&self) {
        *self.inner.lock() = None;
    }
}

/// Et login i gang: `state` og PKCE-verifier lever kun i hukommelsen.
#[derive(Debug, Clone)]
pub struct PendingLogin {
    pub state: String,
    pub code_verifier: String,
    pub created_at: DateTime<Utc>,
}

/// Et login udløber, hvis browseren ikke kalder tilbage inden for 10 min.
const LOGIN_TTL_MINUTES: i64 = 10;

fn random_token() -> String {
    // 2 × UUIDv4 = 244 tilfældige bits fra OS'ets CSPRNG (getrandom).
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

pub fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

impl PendingLogin {
    pub fn new(now: DateTime<Utc>) -> Self {
        PendingLogin { state: random_token(), code_verifier: random_token(), created_at: now }
    }

    /// URL, appen åbner i browseren: web's `/auth/device`. Efter
    /// godkendelse sender web brugeren til
    /// `timetrack://auth/callback?code=<engangskode>&state=<samme state>`.
    pub fn authorize_url(&self, base_url: &str, device: &DeviceInfo) -> String {
        let mut url = url::Url::parse(&format!("{}/auth/device", base_url.trim_end_matches('/')))
            .expect("base_url er en gyldig URL");
        url.query_pairs_mut()
            .append_pair("state", &self.state)
            .append_pair("challenge", &pkce_challenge(&self.code_verifier))
            .append_pair("device_id", &device.device_id)
            .append_pair("device_name", &device.device_name)
            .append_pair("os", &device.os)
            .append_pair("kind", "desktop");
        // TimeTrack-webben sender altid brugeren til timetrack://; en anden
        // udgave beder om sit eget skema, så to apps på samme maskine ikke
        // tager hinandens login-svar.
        if tt_core::edition::EDITION.url_scheme != "timetrack" {
            url.query_pairs_mut().append_pair("redirect_uri", &tt_core::edition::EDITION.redirect_uri());
        }
        url.into()
    }

    /// Læs deep linket og kontrollér `state`. Returnerer engangskoden.
    pub fn verify_callback(&self, callback_url: &str, now: DateTime<Utc>) -> Result<String> {
        if now - self.created_at > chrono::Duration::minutes(LOGIN_TTL_MINUTES) {
            return Err(DataError::Auth("Login udløb. Prøv igen".into()));
        }
        let url = url::Url::parse(callback_url)
            .map_err(|_| DataError::Auth("Ugyldigt login-link".into()))?;
        if url.scheme() != tt_core::edition::EDITION.url_scheme {
            return Err(DataError::Auth("Ugyldigt login-link".into()));
        }
        let mut code = None;
        let mut state = None;
        let mut error = None;
        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => state = Some(v.into_owned()),
                "error" => error = Some(v.into_owned()),
                _ => {}
            }
        }
        // state først: et link uden vores state er aldrig vores svar.
        if !constant_time_eq(state.as_deref().unwrap_or("").as_bytes(), self.state.as_bytes()) {
            return Err(DataError::Auth("Login-svaret passer ikke til dette login".into()));
        }
        if let Some(e) = error {
            return Err(DataError::Auth(format!("Login blev afvist ({e})")));
        }
        code.filter(|c| !c.is_empty()).ok_or_else(|| DataError::Auth("Login-svaret mangler kode".into()))
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Svar fra `extension.device.exchangeCode({ code, codeVerifier, state,
/// deviceId })` og `extension.device.refresh({ refreshToken, deviceId })`.
/// Refresh roterer begge tokens; det gamle refresh-token virker ikke igen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub refresh_expires_at: Option<DateTime<Utc>>,
    pub user: User,
    #[serde(default)]
    pub organization_id: Option<String>,
}

impl TokenResponse {
    pub fn into_credentials(self, keep_org: Option<String>) -> Credentials {
        Credentials {
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            expires_at: self.expires_at,
            user: self.user,
            organization_id: keep_org.or(self.organization_id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> DeviceInfo {
        DeviceInfo {
            device_id: "dev-1".into(),
            device_name: "Mads' MacBook".into(),
            os: "macos".into(),
            app_version: "1.0.0".into(),
        }
    }

    #[test]
    fn authorize_url_carries_state_and_challenge() {
        let p = PendingLogin::new(Utc::now());
        let url = url::Url::parse(&p.authorize_url("https://timetrack.dk/", &device())).unwrap();
        assert_eq!(url.path(), "/auth/device");
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["state"], p.state);
        assert_eq!(q["challenge"], pkce_challenge(&p.code_verifier));
        assert_eq!(q["device_id"], "dev-1");
        assert_eq!(q["os"], "macos");
        assert_eq!(q["kind"], "desktop");
        assert_eq!(q["device_name"], "Mads' MacBook");
        assert!(!url.as_str().contains(&p.code_verifier), "verifier må aldrig i URL'en");
        // TimeTrack-webben redirecter altid selv; en anden udgave beder om sit skema.
        if tt_core::edition::EDITION.is_timewren() {
            assert_eq!(q["redirect_uri"], "timewren://auth/callback");
        } else {
            assert!(!q.contains_key("redirect_uri"));
        }
    }

    /// Et login-svar til den anden udgaves skema afvises: to apps på samme
    /// maskine må ikke tage hinandens svar.
    #[test]
    fn callback_to_the_other_editions_scheme_is_rejected() {
        let now = Utc::now();
        let p = PendingLogin::new(now);
        let other = tt_core::edition::Edition::ALL
            .iter()
            .find(|e| e.url_scheme != tt_core::edition::EDITION.url_scheme)
            .unwrap();
        let cb = format!("{}?code=abc&state={}", other.redirect_uri(), p.state);
        assert!(p.verify_callback(&cb, now).is_err());
    }

    #[test]
    fn pkce_matches_rfc7636_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn callback_requires_matching_state() {
        let now = Utc::now();
        let p = PendingLogin::new(now);
        let cb = redirect_uri();
        let ok = format!("{cb}?code=abc&state={}", p.state);
        assert_eq!(p.verify_callback(&ok, now).unwrap(), "abc");
        let csrf = format!("{cb}?code=angriber&state=forkert");
        assert!(matches!(p.verify_callback(&csrf, now), Err(DataError::Auth(_))));
        let no_state = format!("{cb}?code=abc");
        assert!(p.verify_callback(&no_state, now).is_err());
        let wrong_scheme = format!("https://evil.example/cb?code=abc&state={}", p.state);
        assert!(p.verify_callback(&wrong_scheme, now).is_err());
        let late = now + chrono::Duration::minutes(11);
        assert!(p.verify_callback(&ok, late).is_err());
        let denied = format!("{cb}?error=access_denied&state={}", p.state);
        assert!(p.verify_callback(&denied, now).is_err());
    }

    #[test]
    fn refresh_window() {
        let now = Utc::now();
        let mut c = Credentials {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: Some(now + chrono::Duration::seconds(30)),
            user: User { id: "u".into(), name: "n".into(), email: "e".into() },
            organization_id: None,
        };
        assert!(c.needs_refresh(now));
        c.expires_at = Some(now + chrono::Duration::hours(1));
        assert!(!c.needs_refresh(now));
        c.refresh_token = None;
        c.expires_at = Some(now);
        assert!(!c.needs_refresh(now), "uden refresh-token kan intet fornyes");
    }
}
