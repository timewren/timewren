use crate::i18n;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

// Canonical desktop backend host. The API lives under app.timetrack.dk
// (timetrack.dk is the marketing site). This MUST match the deployed Next.js
// route group at src/app/api/desktop/license/* in the timetrack-web repo.
const BASE_URL: &str = "https://app.timetrack.dk/api/desktop/license";
const OFFLINE_GRACE_LIFETIME_DAYS: i64 = 30;
const OFFLINE_GRACE_SUBSCRIPTION_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseProof {
    pub license_key: String,
    pub tier: String, // "lifetime" | "solo" | "team"
    pub valid_until: Option<String>,
    pub devices_allowed: u32,
    pub issued_at: String,
    pub verified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseStatus {
    pub is_valid: bool,
    pub tier: Option<String>,
    pub days_until_expiry: Option<i64>,
    pub offline_days: i64,
    pub needs_verification: bool,
}

/// Activation request body. The server destructures camelCase keys
/// (`licenseKey`, `machineId`, `deviceName`, `os`), so we serialize as camelCase.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivateRequest {
    license_key: String,
    machine_id: String,
    os: String,
    device_name: String,
}

/// The server wraps the proof in a `{ "proof": { ... } }` envelope and signs it
/// with a server-only HMAC secret (which the client cannot and does not verify).
/// Proof fields are snake_case on the wire; `signature` is present but ignored.
#[derive(Debug, Deserialize)]
struct ActivateEnvelope {
    proof: ServerProof,
}

#[derive(Debug, Deserialize)]
struct ServerProof {
    license_key: String,
    tier: String,
    #[serde(default)]
    valid_until: Option<String>,
    devices_allowed: u32,
    issued_at: String,
}

/// Shape of the `/verify` response. `valid` is required, so a captive-portal or
/// proxy body that lacks it fails to parse and is treated as "unrecognized"
/// (→ offline grace) rather than a trusted verification.
#[derive(Debug, Deserialize)]
struct VerifyResponse {
    valid: bool,
    #[serde(default)]
    tier: Option<String>,
    #[serde(default, rename = "devicesAllowed")]
    devices_allowed: Option<u32>,
    #[serde(default, rename = "expiresAt")]
    expires_at: Option<String>,
    /// Present so we can tell a *revoked* license (isActive=false) apart from a
    /// merely *expired* one when the server reports `valid:false`.
    #[serde(default, rename = "isActive")]
    is_active: Option<bool>,
}

fn parse_verify_response(body: &str) -> Option<VerifyResponse> {
    serde_json::from_str::<VerifyResponse>(body).ok()
}

/// A human-friendly device label (the machine hostname) sent at activation so
/// the user can recognize their devices in the licensing dashboard.
fn device_name() -> String {
    hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

/// Get a stable machine fingerprint based on hostname and OS.
///
/// Used for license activation/verification and cloud sync device identification.
pub fn machine_id() -> String {
    let hostname = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let os = std::env::consts::OS;
    let input = format!("{}-{}", os, hostname);

    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    let hex = result
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    format!("{}-{}", os, &hex[..16])
}

pub struct LicenseManager {
    app_data_dir: PathBuf,
}

impl LicenseManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self { app_data_dir }
    }

    fn proof_path(&self) -> PathBuf {
        self.app_data_dir.join("license.json")
    }

    /// Activate a license key with the TimeTrack server
    pub async fn activate(&self, license_key: &str) -> Result<LicenseProof, String> {
        let body = ActivateRequest {
            license_key: license_key.to_string(),
            machine_id: machine_id(),
            os: std::env::consts::OS.to_string(),
            device_name: device_name(),
        };

        let client = reqwest::Client::new();
        let resp = client
            .post(format!("{}/activate", BASE_URL))
            .header(crate::sync::api::KLIENT_HEADER, crate::sync::api::klient_version())
            .json(&body)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| {
                i18n::t_fmt("license.couldNotConnectServer", &[&e.to_string()])
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            // Prefer the JSON `{ "error": "..." }` message so the user sees a
            // clean reason (e.g. "Invalid license key") instead of a raw HTML
            // page. Fall back to the raw body only when it isn't JSON.
            let message = extract_error_message(&body_text);
            return Err(i18n::t_fmt(
                "license.activationFailed",
                &[&status.to_string(), &message],
            ));
        }

        // The server returns `{ "proof": { ... } }` (snake_case fields) without a
        // `verified_at`; we stamp verification time locally at activation.
        let envelope: ActivateEnvelope = resp
            .json()
            .await
            .map_err(|e| i18n::t_fmt("license.invalidResponse", &[&e.to_string()]))?;

        let proof = LicenseProof {
            license_key: envelope.proof.license_key,
            tier: envelope.proof.tier,
            valid_until: envelope.proof.valid_until,
            devices_allowed: envelope.proof.devices_allowed,
            issued_at: envelope.proof.issued_at,
            verified_at: Utc::now().to_rfc3339(),
        };

        // Save proof locally
        self.save_proof(&proof)?;

        Ok(proof)
    }

    /// Verify current license (called periodically)
    pub async fn verify(&self) -> Result<LicenseStatus, String> {
        let proof = match self.get_cached() {
            Some(p) => p,
            None => {
                return Ok(LicenseStatus {
                    is_valid: false,
                    tier: None,
                    days_until_expiry: None,
                    offline_days: 0,
                    needs_verification: false,
                })
            }
        };

        // Try online verification
        let client = reqwest::Client::new();
        let online_result = client
            .get(format!("{}/verify", BASE_URL))
            .header(crate::sync::api::KLIENT_HEADER, crate::sync::api::klient_version())
            .query(&[("key", proof.license_key.as_str())])
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;

        match online_result {
            Ok(resp) if resp.status().is_success() => {
                // HTTP 200 is NOT sufficient on its own: captive portals, MITM
                // proxies, and error-pages-with-200 can all masquerade as a
                // successful verification. We only trust a body that parses as
                // the server's verify shape (a required `valid` bool); anything
                // else falls through to the offline grace window.
                let body_text = resp.text().await.unwrap_or_default();

                match parse_verify_response(&body_text) {
                    Some(v) if v.valid => {
                        // Server confirms the license is valid. Refresh the
                        // proof (verified_at, tier, expiry, seats) from the
                        // authoritative response.
                        let mut updated_proof = proof.clone();
                        updated_proof.verified_at = Utc::now().to_rfc3339();
                        if let Some(tier) = v.tier {
                            updated_proof.tier = tier;
                        }
                        updated_proof.valid_until = v.expires_at;
                        if let Some(seats) = v.devices_allowed {
                            updated_proof.devices_allowed = seats;
                        }

                        let _ = self.save_proof(&updated_proof);

                        let days_until_expiry = self.days_until_expiry(&updated_proof);
                        // Even a freshly-verified license can be expired by date.
                        let expired = is_expired_by_valid_until(&updated_proof, Utc::now());

                        Ok(LicenseStatus {
                            is_valid: !expired,
                            tier: Some(updated_proof.tier),
                            days_until_expiry,
                            offline_days: 0,
                            needs_verification: false,
                        })
                    }
                    Some(v) => {
                        // Server authoritatively reports the license as invalid.
                        // A revoked license (isActive=false) MUST have its proof
                        // dropped so the offline grace window can never revive
                        // it. A merely expired subscription keeps its proof: the
                        // `valid_until` date already enforces invalidity offline,
                        // and keeping the key lets the UI offer renewal without
                        // forcing the user to re-enter it.
                        let revoked = v.is_active == Some(false);
                        if revoked {
                            let _ = self.remove_proof();
                        }
                        Ok(LicenseStatus {
                            is_valid: false,
                            tier: Some(proof.tier),
                            days_until_expiry: None,
                            offline_days: 0,
                            needs_verification: false,
                        })
                    }
                    None => {
                        // Unrecognized 200 body (captive portal / proxy). Treat
                        // as a failed verification, NOT a success; fall back to
                        // the offline grace window.
                        self.offline_status(&proof)
                    }
                }
            }
            Ok(resp) => {
                // Server responded with a non-2xx status.
                let status = resp.status().as_u16();
                if status == 401 || status == 403 || status == 410 {
                    // Authentication/revocation failures — the license is
                    // invalid. Do NOT fail open into the offline grace window.
                    let _ = self.remove_proof();
                    Ok(LicenseStatus {
                        is_valid: false,
                        tier: Some(proof.tier),
                        days_until_expiry: None,
                        offline_days: 0,
                        needs_verification: false,
                    })
                } else {
                    // Transient server error (404/500/etc.) — treat as offline.
                    self.offline_status(&proof)
                }
            }
            Err(_) => {
                // Network error — use offline grace period
                self.offline_status(&proof)
            }
        }
    }

    /// Deactivate this device
    pub async fn deactivate(&self) -> Result<(), String> {
        let proof = self.get_cached();

        if let Some(proof) = &proof {
            let client = reqwest::Client::new();
            // Best-effort server deactivation — don't fail if server is unreachable
            let _ = client
                .post(format!("{}/deactivate", BASE_URL))
                .header(crate::sync::api::KLIENT_HEADER, crate::sync::api::klient_version())
                .json(&serde_json::json!({
                    "licenseKey": proof.license_key,
                    "machineId": machine_id(),
                }))
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await;
        }

        // Always remove local proof
        self.remove_proof()?;

        Ok(())
    }

    /// Get cached proof without network call
    pub fn get_cached(&self) -> Option<LicenseProof> {
        let path = self.proof_path();
        if !path.exists() {
            return None;
        }

        let data = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str(&data).ok()
    }

    fn save_proof(&self, proof: &LicenseProof) -> Result<(), String> {
        std::fs::create_dir_all(&self.app_data_dir)
            .map_err(|e| i18n::t_fmt("license.couldNotCreateDataDir", &[&e.to_string()]))?;

        let json = serde_json::to_string_pretty(proof)
            .map_err(|e| i18n::t_fmt("license.serializationError", &[&e.to_string()]))?;

        std::fs::write(self.proof_path(), json)
            .map_err(|e| i18n::t_fmt("license.couldNotSave", &[&e.to_string()]))?;

        Ok(())
    }

    fn remove_proof(&self) -> Result<(), String> {
        let path = self.proof_path();
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| i18n::t_fmt("license.couldNotRemove", &[&e.to_string()]))?;
        }
        Ok(())
    }

    fn days_until_expiry(&self, proof: &LicenseProof) -> Option<i64> {
        let valid_until = proof.valid_until.as_ref()?;
        let expiry = chrono::DateTime::parse_from_rfc3339(valid_until).ok()?;
        let now = Utc::now();
        Some((expiry.signed_duration_since(now)).num_days())
    }

    fn offline_status(&self, proof: &LicenseProof) -> Result<LicenseStatus, String> {
        compute_offline_status(proof, Utc::now())
            .ok_or_else(|| i18n::t_fmt("license.invalidVerifiedAt", &[&proof.verified_at]))
    }
}

/// Returns the offline grace window (in days) for a given tier.
fn grace_days_for_tier(tier: &str) -> i64 {
    if tier == "lifetime" {
        OFFLINE_GRACE_LIFETIME_DAYS
    } else {
        OFFLINE_GRACE_SUBSCRIPTION_DAYS
    }
}

/// True when the license has a `valid_until` that is strictly in the past
/// relative to `now`. A license without `valid_until` (e.g. lifetime) never
/// expires by date. An unparseable `valid_until` is treated as expired
/// (fail-closed) — we cannot prove it is still valid.
fn is_expired_by_valid_until(proof: &LicenseProof, now: chrono::DateTime<Utc>) -> bool {
    match proof.valid_until.as_ref() {
        None => false,
        Some(valid_until) => match chrono::DateTime::parse_from_rfc3339(valid_until) {
            Ok(expiry) => now > expiry.with_timezone(&Utc),
            Err(_) => true,
        },
    }
}

/// Pure offline-grace evaluation, parameterized on `now` for testability.
///
/// Hardening rules:
/// 1. Clock-rollback (now < verified_at) is treated as tampering: we clamp
///    offline_days to 0 and force `needs_verification` (fail-closed). The
///    license is NOT considered valid purely on the strength of a rolled-back
///    clock — it must be re-verified online.
/// 2. `valid_until` gates validity regardless of the grace window: an expired
///    subscription is invalid even while still inside the offline grace period.
///
/// Returns `None` only when `verified_at` cannot be parsed.
fn compute_offline_status(
    proof: &LicenseProof,
    now: chrono::DateTime<Utc>,
) -> Option<LicenseStatus> {
    let verified_at = chrono::DateTime::parse_from_rfc3339(&proof.verified_at)
        .ok()?
        .with_timezone(&Utc);

    let raw_days = now.signed_duration_since(verified_at).num_days();
    // Clock moved backwards relative to last verification → tampering / skew.
    let clock_went_backwards = now < verified_at;
    // Clamp to a non-negative window so a rolled-back clock can never make the
    // license look "freshly verified".
    let offline_days = raw_days.max(0);

    let grace_days = grace_days_for_tier(&proof.tier);
    let expired = is_expired_by_valid_until(proof, now);

    // Valid only if: clock is sane, within grace window, and not date-expired.
    let is_valid = !clock_went_backwards && offline_days <= grace_days && !expired;

    // If the clock went backwards we always demand re-verification.
    let needs_verification = clock_went_backwards || offline_days > (grace_days / 2);

    Some(LicenseStatus {
        is_valid,
        tier: Some(proof.tier.clone()),
        days_until_expiry: proof
            .valid_until
            .as_ref()
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            .map(|expiry| expiry.with_timezone(&Utc).signed_duration_since(now).num_days()),
        offline_days,
        needs_verification,
    })
}

/// Extract a clean, user-facing error message from a failed HTTP response body.
/// The server returns `{ "error": "..." }` JSON; prefer that string. If the body
/// isn't JSON (e.g. an HTML error page from the wrong host), fall back to a
/// trimmed, length-capped snippet so we never dump a whole page into a toast.
fn extract_error_message(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(msg) = value.get("error").and_then(|e| e.as_str()) {
            return msg.to_string();
        }
    }
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return i18n::t("license.unknownError");
    }
    trimmed.chars().take(200).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proof(tier: &str, verified_at: &str, valid_until: Option<&str>) -> LicenseProof {
        LicenseProof {
            license_key: "TT-TEST-KEY".to_string(),
            tier: tier.to_string(),
            valid_until: valid_until.map(|s| s.to_string()),
            devices_allowed: 1,
            issued_at: "2026-01-01T00:00:00Z".to_string(),
            verified_at: verified_at.to_string(),
        }
    }

    fn at(s: &str) -> chrono::DateTime<Utc> {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .with_timezone(&Utc)
    }

    // --- Bug 1: clock-rollback never expires offline grace ---

    #[test]
    fn clock_backwards_is_fail_closed() {
        // verified_at is in the "future" relative to now → clock rolled back.
        let p = proof("solo", "2026-06-20T00:00:00Z", Some("2027-01-01T00:00:00Z"));
        let now = at("2026-06-10T00:00:00Z"); // 10 days BEFORE verified_at
        let status = compute_offline_status(&p, now).unwrap();

        assert!(!status.is_valid, "rolled-back clock must not stay valid");
        assert!(
            status.needs_verification,
            "rolled-back clock must force re-verification"
        );
        assert_eq!(status.offline_days, 0, "offline_days must be clamped to 0");
    }

    #[test]
    fn clock_exactly_at_verified_at_is_valid_within_grace() {
        let p = proof("solo", "2026-06-10T00:00:00Z", Some("2027-01-01T00:00:00Z"));
        let now = at("2026-06-10T00:00:00Z");
        let status = compute_offline_status(&p, now).unwrap();
        assert!(status.is_valid);
        assert_eq!(status.offline_days, 0);
    }

    #[test]
    fn within_grace_window_is_valid() {
        let p = proof("solo", "2026-06-01T00:00:00Z", Some("2027-01-01T00:00:00Z"));
        let now = at("2026-06-05T00:00:00Z"); // 4 days, grace = 7
        let status = compute_offline_status(&p, now).unwrap();
        assert!(status.is_valid);
        assert_eq!(status.offline_days, 4);
    }

    #[test]
    fn beyond_grace_window_is_invalid() {
        let p = proof("solo", "2026-06-01T00:00:00Z", Some("2027-01-01T00:00:00Z"));
        let now = at("2026-06-20T00:00:00Z"); // 19 days, grace = 7
        let status = compute_offline_status(&p, now).unwrap();
        assert!(!status.is_valid);
        assert!(status.needs_verification);
    }

    // --- Bug 2: offline_status ignores valid_until ---

    #[test]
    fn expired_subscription_invalid_even_within_grace() {
        // verified yesterday (well within the 7-day grace) but the
        // subscription itself expired before now.
        let p = proof("solo", "2026-06-09T00:00:00Z", Some("2026-06-09T12:00:00Z"));
        let now = at("2026-06-10T00:00:00Z");
        let status = compute_offline_status(&p, now).unwrap();
        assert_eq!(status.offline_days, 1, "within the 7-day grace window");
        assert!(
            !status.is_valid,
            "expired valid_until must override the grace window"
        );
    }

    #[test]
    fn unparseable_valid_until_is_treated_as_expired() {
        let p = proof("solo", "2026-06-09T00:00:00Z", Some("not-a-date"));
        let now = at("2026-06-10T00:00:00Z");
        assert!(is_expired_by_valid_until(&p, now));
        let status = compute_offline_status(&p, now).unwrap();
        assert!(!status.is_valid);
    }

    #[test]
    fn lifetime_without_valid_until_never_date_expires() {
        let p = proof("lifetime", "2026-06-01T00:00:00Z", None);
        let now = at("2026-06-20T00:00:00Z"); // 19 days, lifetime grace = 30
        assert!(!is_expired_by_valid_until(&p, now));
        let status = compute_offline_status(&p, now).unwrap();
        assert!(status.is_valid);
    }

    #[test]
    fn unparseable_verified_at_returns_none() {
        let p = proof("solo", "garbage", Some("2027-01-01T00:00:00Z"));
        let now = at("2026-06-10T00:00:00Z");
        assert!(compute_offline_status(&p, now).is_none());
    }

    // --- Verify response parsing (real server shape) ---

    #[test]
    fn verify_response_rejects_non_json() {
        // A captive portal / wrong-host HTML page with a 200 status must NOT be
        // parsed as a verification.
        assert!(parse_verify_response("<html><body>Login to continue</body></html>").is_none());
    }

    #[test]
    fn verify_response_rejects_body_without_valid_field() {
        // A JSON body that lacks the required `valid` bool is not our server's
        // shape → unrecognized → caller falls back to offline grace.
        assert!(parse_verify_response(r#"{"status":"ok"}"#).is_none());
    }

    #[test]
    fn verify_response_accepts_valid_true_with_fields() {
        let body = r#"{
            "valid": true,
            "tier": "solo",
            "devicesUsed": 1,
            "devicesAllowed": 3,
            "expiresAt": "2027-01-01T00:00:00.000Z",
            "isActive": true,
            "isExpired": false
        }"#;
        let v = parse_verify_response(body).expect("should parse");
        assert!(v.valid);
        assert_eq!(v.tier.as_deref(), Some("solo"));
        assert_eq!(v.devices_allowed, Some(3));
        assert_eq!(v.expires_at.as_deref(), Some("2027-01-01T00:00:00.000Z"));
    }

    #[test]
    fn verify_response_accepts_valid_false_not_found() {
        // The server returns HTTP 200 with valid:false for an unknown key.
        let body = r#"{"valid":false,"error":"License key not found"}"#;
        let v = parse_verify_response(body).expect("should parse");
        assert!(!v.valid);
    }

    #[test]
    fn verify_response_distinguishes_revoked_from_expired() {
        // Revoked: isActive=false → caller must drop the proof.
        let revoked = parse_verify_response(
            r#"{"valid":false,"tier":"solo","isActive":false,"isExpired":false}"#,
        )
        .expect("parses");
        assert_eq!(revoked.is_active, Some(false));

        // Expired: isActive=true but isExpired=true → caller keeps the proof.
        let expired = parse_verify_response(
            r#"{"valid":false,"tier":"solo","isActive":true,"isExpired":true}"#,
        )
        .expect("parses");
        assert_eq!(expired.is_active, Some(true));
    }

    #[test]
    fn verify_response_lifetime_has_null_expiry() {
        let body = r#"{"valid":true,"tier":"lifetime","devicesUsed":1,"devicesAllowed":1,"expiresAt":null,"isActive":true,"isExpired":false}"#;
        let v = parse_verify_response(body).expect("should parse");
        assert!(v.valid);
        assert_eq!(v.expires_at, None);
    }

    // --- Activate response envelope ({ "proof": { ... } }) ---

    #[test]
    fn activate_envelope_parses_wrapped_proof() {
        // The server wraps the proof and adds a `signature` we ignore; there is
        // no `verified_at` on the wire (we stamp it locally).
        let body = r#"{
            "proof": {
                "license_key": "TT-ABCD-EFGH-JKLM-NPQR",
                "tier": "solo",
                "valid_until": "2027-01-01T00:00:00.000Z",
                "devices_allowed": 3,
                "issued_at": "2026-07-15T10:00:00.000Z",
                "signature": "abc123_ignored"
            }
        }"#;
        let env: ActivateEnvelope = serde_json::from_str(body).expect("should parse envelope");
        assert_eq!(env.proof.license_key, "TT-ABCD-EFGH-JKLM-NPQR");
        assert_eq!(env.proof.tier, "solo");
        assert_eq!(env.proof.devices_allowed, 3);
        assert_eq!(env.proof.valid_until.as_deref(), Some("2027-01-01T00:00:00.000Z"));
    }

    #[test]
    fn activate_envelope_lifetime_has_null_valid_until() {
        let body = r#"{"proof":{"license_key":"TT-LIFE","tier":"lifetime","valid_until":null,"devices_allowed":1,"issued_at":"2026-07-15T10:00:00.000Z","signature":"x"}}"#;
        let env: ActivateEnvelope = serde_json::from_str(body).expect("should parse");
        assert_eq!(env.proof.valid_until, None);
    }

    // --- Error message extraction ---

    #[test]
    fn error_message_prefers_json_error_field() {
        assert_eq!(
            extract_error_message(r#"{"error":"Invalid license key"}"#),
            "Invalid license key"
        );
    }

    #[test]
    fn error_message_truncates_html_fallback() {
        let html = "<html>".to_string() + &"x".repeat(500) + "</html>";
        let msg = extract_error_message(&html);
        assert!(msg.chars().count() <= 200, "must cap non-JSON bodies");
    }
}
