use crate::i18n;
use reqwest::Client;
use serde::{Deserialize, Serialize};

const DEFAULT_BASE_URL: &str = "https://app.timetrack.dk";

/// Headeren serveren læser klientens type og version fra (web #781). Med den
/// kan serveren afvise skrivninger fra en for gammel desktop-version.
pub const KLIENT_HEADER: &str = "x-timetrack-client";

/// Markør foran fejlteksten, når serveren svarer 426 `CLIENT_TOO_OLD`.
/// Frontenden genkender den, viser opdateringsprompten og skjuler markøren.
pub const KLIENT_FOR_GAMMEL: &str = "CLIENT_TOO_OLD";

/// `desktop/<version>` — appens version er crate-versionen (tauri.conf.json
/// har ingen egen, så Tauri bruger også Cargo.toml's).
pub fn klient_version() -> String {
    format!("desktop/{}", env!("CARGO_PKG_VERSION"))
}

/// Serveren svarer 426 Upgrade Required, når versionen er under minimummet.
/// Intet er gemt — de lokale ændringer bliver i køen til efter opdateringen.
pub fn er_klient_for_gammel(status: u16) -> bool {
    status == 426
}

/// Fejlteksten for en afvist, for gammel version (med markøren foran).
pub fn klient_for_gammel_fejl() -> String {
    format!("{}: {}", KLIENT_FOR_GAMMEL, i18n::t("sync.clientTooOld"))
}

/// Sand når en fejltekst stammer fra `klient_for_gammel_fejl`.
pub fn er_klient_for_gammel_fejl(fejl: &str) -> bool {
    fejl.starts_with(KLIENT_FOR_GAMMEL)
}

/// Fejlteksten uden markøren — klar til at vise.
pub fn uden_klient_markoer(fejl: &str) -> String {
    fejl.strip_prefix(KLIENT_FOR_GAMMEL)
        .map(|rest| rest.trim_start_matches(':').trim_start().to_string())
        .unwrap_or_else(|| fejl.to_string())
}

fn klient_headers() -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(værdi) = reqwest::header::HeaderValue::from_str(&klient_version()) {
        headers.insert(KLIENT_HEADER, værdi);
    }
    headers
}

pub struct SyncClient {
    client: Client,
    base_url: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserInfo,
    pub tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEntity {
    #[serde(rename = "type")]
    pub entity_type: String,
    pub action: String,
    pub data: serde_json::Value,
    #[serde(rename = "localId", skip_serializing_if = "Option::is_none")]
    pub local_id: Option<String>,
    #[serde(rename = "localUpdatedAt", skip_serializing_if = "Option::is_none")]
    pub local_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResponse {
    pub accepted: Vec<AcceptedEntity>,
    pub conflicts: Vec<ConflictEntity>,
    /// De rækker serveren afviste — **én ad gangen**, i en `try` omkring hver
    /// entitet. Kaldet svarer 200 og lægger dem her, så et svar uden feltet
    /// (`#[serde(default)]`) kan ikke glemme dem: serveren har *allerede* gjort
    /// arbejdet, og den eneste vej videre er at læse dem.
    #[serde(default)]
    pub errors: Vec<PushError>,
    #[serde(rename = "serverTime")]
    pub server_time: String,
}

/// Én afvisning fra serverens push-rute.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushError {
    /// Hvilken lokal række det var. `None` når serveren afviste en hel
    /// entitetstype, den ikke kender — så er der ingen lokal række at pege på.
    #[serde(rename = "localId", default)]
    pub local_id: Option<String>,
    #[serde(rename = "type", default)]
    pub entity_type: String,
    /// Serverens egen fejltekst. Det er den, der afgør om en afvisning er
    /// permanent eller bare et mistet svar (se `engine::klassificer_push_fejl`).
    #[serde(default)]
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcceptedEntity {
    #[serde(rename = "localId")]
    pub local_id: String,
    #[serde(rename = "remoteId")]
    pub remote_id: String,
    #[serde(rename = "type")]
    pub entity_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictEntity {
    #[serde(rename = "localId")]
    pub local_id: String,
    #[serde(rename = "type")]
    pub entity_type: String,
    #[serde(rename = "serverData")]
    pub server_data: serde_json::Value,
}

/// Én indstilling på tråden. `value: null` betyder «ryd den» — så kan
/// serveren fortælle at brugeren har slettet noget, i stedet for at desktop
/// skulle gætte det ud fra en manglende nøgle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingPair {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
}

/// Svaret fra `GET /api/desktop/settings`.
///
/// `settings: null` er et udtrykkeligt «endpointet findes ikke» — en server
/// uden den route svarer 404, og vi oversætter det hertil. Derfor er feltet
/// `Option` og ikke en tom vektor: en tom vektor er et *svar*, og den må ikke
/// forveksles med en server der endnu ikke kan svare.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsResponse {
    #[serde(default)]
    pub settings: Option<Vec<SettingPair>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResponse {
    pub entities: Vec<SyncEntity>,
    #[serde(rename = "serverTime")]
    pub server_time: String,
    /// User profile data from Cloud (only present in full sync responses).
    #[serde(rename = "userProfile", default)]
    pub user_profile: Option<serde_json::Value>,
}

impl SyncClient {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .default_headers(klient_headers())
                .build()
                // Uden timeout, men aldrig uden versionsheaderen.
                .or_else(|_| Client::builder().default_headers(klient_headers()).build())
                .unwrap_or_else(|_| Client::new()),
            base_url: DEFAULT_BASE_URL.to_string(),
            token: None,
        }
    }

    pub fn with_base_url(mut self, url: &str) -> Self {
        self.base_url = url.trim_end_matches('/').to_string();
        self
    }

    pub fn set_token(&mut self, token: String) {
        self.token = Some(token);
    }

    pub fn has_token(&self) -> bool {
        self.token.is_some()
    }

    /// Authenticate with email/password, returns token
    pub async fn login(
        &mut self,
        email: &str,
        password: &str,
        device_name: &str,
        machine_id: &str,
    ) -> Result<AuthResponse, String> {
        let resp = self
            .client
            .post(format!("{}/api/desktop/auth/token", self.base_url))
            .json(&serde_json::json!({
                "email": email,
                "password": password,
                "deviceName": device_name,
                "machineId": machine_id,
                "os": std::env::consts::OS
            }))
            .send()
            .await
            .map_err(|e| i18n::t_fmt("sync.connectionError", &[&e.to_string()]))?;

        if er_klient_for_gammel(resp.status().as_u16()) {
            return Err(klient_for_gammel_fejl());
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();

            // Try to extract a user-friendly error message from JSON
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(msg) = json.get("error").and_then(|e| e.as_str()) {
                    return Err(msg.to_string());
                }
            }

            return Err(i18n::t_fmt("sync.loginFailed", &[&status.to_string(), &body]));
        }

        let auth: AuthResponse = resp
            .json()
            .await
            .map_err(|e| i18n::t_fmt("sync.invalidServerResponse", &[&e.to_string()]))?;
        self.token = Some(auth.token.clone());
        Ok(auth)
    }

    /// Push local changes to server
    pub async fn push(&self, entities: Vec<SyncEntity>) -> Result<PushResponse, String> {
        let token = self.token.as_ref().ok_or(&i18n::t("sync.notLoggedInShort"))?;
        let resp = self
            .client
            .post(format!("{}/api/desktop/sync/push", self.base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({ "entities": entities }))
            .send()
            .await
            .map_err(|e| i18n::t_fmt("sync.pushError", &[&e.to_string()]))?;

        if resp.status().as_u16() == 401 {
            return Err(i18n::t("sync.sessionExpired"));
        }

        if er_klient_for_gammel(resp.status().as_u16()) {
            return Err(klient_for_gammel_fejl());
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(i18n::t_fmt("sync.pushFailed", &[&status.to_string(), &body]));
        }

        resp.json()
            .await
            .map_err(|e| i18n::t_fmt("sync.invalidPushResponse", &[&e.to_string()]))
    }

    /// Pull remote changes since timestamp
    pub async fn pull(&self, since: Option<&str>) -> Result<PullResponse, String> {
        let token = self.token.as_ref().ok_or(&i18n::t("sync.notLoggedInShort"))?;
        let mut url = format!("{}/api/desktop/sync/pull", self.base_url);
        if let Some(since) = since {
            url = format!("{}?since={}", url, urlencoding::encode(since));
        }
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| i18n::t_fmt("sync.pullError", &[&e.to_string()]))?;

        if resp.status().as_u16() == 401 {
            return Err(i18n::t("sync.sessionExpired"));
        }

        if er_klient_for_gammel(resp.status().as_u16()) {
            return Err(klient_for_gammel_fejl());
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(i18n::t_fmt("sync.pullFailed", &[&status.to_string(), &body]));
        }

        resp.json()
            .await
            .map_err(|e| i18n::t_fmt("sync.invalidPullResponse", &[&e.to_string()]))
    }

    /// Hent integrationsindstillinger fra webben.
    ///
    /// `Ok(None)` betyder at endpointet ikke findes (30/9 har webben ingen
    /// `/api/desktop/settings`). Det er **ikke** en fejl: desktop skal kunne
    /// synke tidsregistreringer mod en server, der ikke har routen endnu, og en
    /// fejl ville stoppe hele synken for en indstilling.
    pub async fn hent_indstillinger(&self) -> Result<Option<Vec<SettingPair>>, String> {
        let token = self.token.as_ref().ok_or(&i18n::t("sync.notLoggedInShort"))?;
        let resp = self
            .client
            .get(format!("{}/api/desktop/settings", self.base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| i18n::t_fmt("sync.settingsFetchError", &[&e.to_string()]))?;

        if resp.status().as_u16() == 401 {
            return Err(i18n::t("sync.sessionExpired"));
        }

        if er_klient_for_gammel(resp.status().as_u16()) {
            return Err(klient_for_gammel_fejl());
        }

        // Ruten findes ikke endnu. Ikke en fejl — se docblock'en.
        if resp.status().as_u16() == 404 {
            return Ok(None);
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(i18n::t_fmt("sync.settingsFetchFailed", &[&status.to_string(), &body]));
        }

        let svar: SettingsResponse = resp
            .json()
            .await
            .map_err(|e| i18n::t_fmt("sync.invalidSettingsResponse", &[&e.to_string()]))?;
        Ok(svar.settings)
    }

    /// Skriv integrationsindstillinger tilbage til webben.
    pub async fn gem_indstillinger(&self, settings: &[SettingPair]) -> Result<(), String> {
        let token = self.token.as_ref().ok_or(&i18n::t("sync.notLoggedInShort"))?;
        let resp = self
            .client
            .put(format!("{}/api/desktop/settings", self.base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({ "settings": settings }))
            .send()
            .await
            .map_err(|e| i18n::t_fmt("sync.settingsPushError", &[&e.to_string()]))?;

        if resp.status().as_u16() == 401 {
            return Err(i18n::t("sync.sessionExpired"));
        }

        if er_klient_for_gammel(resp.status().as_u16()) {
            return Err(klient_for_gammel_fejl());
        }

        // Uden ruten er der intet at skrive til. Ikke en fejl — samme
        // oversættelse som i `hent_indstillinger`, så fra-og-til ligner hinanden.
        if resp.status().as_u16() == 404 {
            return Ok(());
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(i18n::t_fmt("sync.settingsPushFailed", &[&status.to_string(), &body]));
        }

        Ok(())
    }

    /// Full initial sync — pulls all user data
    pub async fn full_sync(&self) -> Result<PullResponse, String> {
        let token = self.token.as_ref().ok_or(&i18n::t("sync.notLoggedInShort"))?;
        let resp = self
            .client
            .get(format!("{}/api/desktop/sync/full", self.base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| i18n::t_fmt("sync.fullSyncError", &[&e.to_string()]))?;

        if resp.status().as_u16() == 401 {
            return Err(i18n::t("sync.sessionExpired"));
        }

        if er_klient_for_gammel(resp.status().as_u16()) {
            return Err(klient_for_gammel_fejl());
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(i18n::t_fmt("sync.fullSyncFailed", &[&status.to_string(), &body]));
        }

        resp.json()
            .await
            .map_err(|e| i18n::t_fmt("sync.invalidSyncResponse", &[&e.to_string()]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn klient_version_er_desktop_og_crate_versionen() {
        assert_eq!(klient_version(), format!("desktop/{}", env!("CARGO_PKG_VERSION")));
        assert!(klient_headers().get(KLIENT_HEADER).is_some());
    }

    #[test]
    fn kun_426_er_for_gammel() {
        assert!(er_klient_for_gammel(426));
        assert!(!er_klient_for_gammel(412));
        assert!(!er_klient_for_gammel(401));
        assert!(!er_klient_for_gammel(500));
    }

    #[test]
    fn for_gammel_fejlen_har_markoer_som_kan_fjernes() {
        let fejl = klient_for_gammel_fejl();
        assert!(er_klient_for_gammel_fejl(&fejl));
        let vist = uden_klient_markoer(&fejl);
        assert!(!vist.starts_with(KLIENT_FOR_GAMMEL));
        assert!(!vist.is_empty());
        assert_eq!(uden_klient_markoer("Push fejlede (500)"), "Push fejlede (500)");
        assert!(!er_klient_for_gammel_fejl("Push fejlede (500)"));
    }
}
