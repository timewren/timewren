//! Filerne i datamappen ved siden af databasen: `state.json` (lokal eller
//! cloud), `settings.json` (indstillinger) og `license.json` (lokal licens).
//! Ingen hemmeligheder: login ligger i nøgleringen.
//!
//! Alle filer skrives atomisk (midlertidig fil + omdøbning) og fejler lukket:
//! en ulæselig fil giver en fejl, aldrig stiltiende standardværdier.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::backend::licens::EntitlementCache;
use crate::backend::{
    BackendError, License, LicenseKind, Result, Settings, license_key_format_ok, mask_key,
};

/// Prøveperiodens længde i dage.
pub const TRIAL_DAYS: i64 = 14;

fn io_err(what: &str, path: &Path, e: impl std::fmt::Display) -> BackendError {
    BackendError::Other(format!("{what} ({}): {e}", path.display()))
}

/// Skriv `value` som JSON atomisk.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let json =
        serde_json::to_vec_pretty(value).map_err(|e| io_err("Kan ikke skrive filen", path, e))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| io_err("Kan ikke oprette mappen", dir, e))?;
    }
    let tmp: PathBuf = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| io_err("Kan ikke gemme filen", &tmp, e))?;
    std::fs::rename(&tmp, path).map_err(|e| io_err("Kan ikke gemme filen", path, e))
}

/// Læs JSON. `Ok(None)` hvis filen ikke findes; en ulæselig fil er en fejl.
pub fn read_json<T: DeserializeOwned>(path: &Path, what: &str) -> Result<Option<T>> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_err("Kan ikke læse filen", path, e)),
    };
    serde_json::from_slice(&bytes).map(Some).map_err(|e| {
        BackendError::Other(format!(
            "{what} kan ikke læses ({e}). Filen {} er beskadiget; flyt den væk, så startes forfra",
            path.display()
        ))
    })
}

// ---------------------------------------------------------------- state.json

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StoredMode {
    Local,
    Cloud,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub mode: StoredMode,
    /// Hvornår den lokale database sidst blev importeret til cloud.
    #[serde(default)]
    pub imported_at: Option<DateTime<Utc>>,
}

impl Default for State {
    fn default() -> Self {
        State {
            mode: StoredMode::Local,
            imported_at: None,
        }
    }
}

pub fn state_path(dir: &Path) -> PathBuf {
    dir.join("state.json")
}

pub fn load_state(dir: &Path) -> Result<State> {
    Ok(read_json(&state_path(dir), "Appens tilstand")?.unwrap_or_default())
}

pub fn save_state(dir: &Path, state: &State) -> Result<()> {
    write_json(&state_path(dir), state)
}

// ---------------------------------------------------------------- settings.json

pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

pub fn load_settings(dir: &Path) -> Result<Settings> {
    Ok(read_json(&settings_path(dir), "Indstillingerne")?.unwrap_or_else(Settings::first_start))
}

pub fn store_settings(dir: &Path, settings: &Settings) -> Result<()> {
    write_json(&settings_path(dir), settings)
}

// ---------------------------------------------------------------- license.json

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lifetime {
    /// Nøglen i store bogstaver. Ikke en hemmelighed i sig selv: den kan kun
    /// aktiveres på få enheder, og serveren afviser misbrug.
    pub key: String,
    pub activated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseFile {
    #[serde(default)]
    pub lifetime: Option<Lifetime>,
    /// Første dag i prøveperioden. Gemmes også efter den er udløbet, så en
    /// prøve ikke kan startes igen.
    #[serde(default)]
    pub trial_started: Option<NaiveDate>,
    /// Seneste dato appen har set, så et ur, der stilles tilbage, ikke
    /// forlænger prøven.
    #[serde(default)]
    pub last_seen: Option<NaiveDate>,
}

impl LicenseFile {
    pub fn as_local(&self) -> crate::backend::licens::LocalLicense {
        crate::backend::licens::LocalLicense {
            lifetime: self.lifetime.is_some(),
            trial_started: self.trial_started,
            last_seen: self.last_seen,
        }
    }
}

// ---------------------------------------------------------------- entitlements.json

pub fn entitlement_cache_path(dir: &Path) -> PathBuf {
    dir.join("entitlements.json")
}

/// Det sidst kendte svar fra web's `entitlements.get` med tidsstempel.
pub fn load_entitlement_cache(dir: &Path) -> Result<Option<EntitlementCache>> {
    read_json(&entitlement_cache_path(dir), "Planens cache")
}

pub fn store_entitlement_cache(dir: &Path, cache: &EntitlementCache) -> Result<()> {
    write_json(&entitlement_cache_path(dir), cache)
}

/// Gem, at appen har set `today` (kun hvis datoen er nyere).
pub fn touch_last_seen(dir: &Path, today: NaiveDate) -> Result<()> {
    let mut file = load_license(dir)?;
    if file.last_seen.is_some_and(|s| s >= today) {
        return Ok(());
    }
    file.last_seen = Some(today);
    write_json(&license_path(dir), &file)
}

pub fn license_path(dir: &Path) -> PathBuf {
    dir.join("license.json")
}

pub fn load_license(dir: &Path) -> Result<LicenseFile> {
    Ok(read_json(&license_path(dir), "Licensen")?.unwrap_or_default())
}

pub fn trial_days_left(started: NaiveDate, today: NaiveDate) -> i64 {
    (TRIAL_DAYS - (today - started).num_days()).max(0)
}

impl LicenseFile {
    /// Licensen til visning: livstid vinder over prøve; en udløbet prøve er
    /// ingen licens.
    pub fn current(&self, today: NaiveDate) -> Option<License> {
        if let Some(l) = &self.lifetime {
            return Some(License {
                kind: LicenseKind::Lifetime,
                key_hint: mask_key(&l.key),
            });
        }
        let started = self.trial_started?;
        let today = self.last_seen.map_or(today, |s| s.max(today));
        let left = trial_days_left(started, today);
        (left > 0).then(|| License {
            kind: LicenseKind::Trial {
                days_left: left as u32,
            },
            key_hint: String::new(),
        })
    }
}

/// Start prøveperioden. Kun én gang pr. installation.
pub fn start_trial(dir: &Path, today: NaiveDate) -> Result<License> {
    let mut file = load_license(dir)?;
    if file.lifetime.is_some() {
        return Err(BackendError::Validation(
            "Du har allerede en livstidslicens".into(),
        ));
    }
    if let Some(started) = file.trial_started {
        return Err(BackendError::Validation(
            if trial_days_left(started, today) > 0 {
                "Prøveperioden er allerede i gang".into()
            } else {
                "Prøveperioden er udløbet. Aktivér en licens for at fortsætte".into()
            },
        ));
    }
    file.trial_started = Some(today);
    // Har appen set en dato efter prøvens slutning (uret var stillet frem),
    // er der ingen dage tilbage. Gem intet, så prøven kan startes senere.
    let Some(license) = file.current(today) else {
        return Err(BackendError::Validation(
            "Computerens dato ser forkert ud. Ret uret, og prøv igen".into(),
        ));
    };
    write_json(&license_path(dir), &file)?;
    Ok(license)
}

/// Gem en aktiveret livstidslicens.
pub fn save_lifetime(
    dir: &Path,
    key: &str,
    now: DateTime<Utc>,
    today: NaiveDate,
) -> Result<License> {
    let mut file = load_license(dir)?;
    file.lifetime = Some(Lifetime {
        key: key.trim().to_ascii_uppercase(),
        activated_at: now,
    });
    write_json(&license_path(dir), &file)?;
    Ok(file.current(today).expect("livstidslicens"))
}

// ---------------------------------------------------------------- aktivering

/// Det licensserveren svarer (`{ "proof": { … } }`, felter i snake_case).
/// Serveren signerer med en hemmelighed, klienten ikke har, så "tjekket" er
/// serverens svar over HTTPS. Intet svar betyder ingen aktivering (ingen
/// fail-open).
#[derive(Debug, Deserialize)]
struct Envelope {
    proof: Proof,
}

#[derive(Debug, Deserialize)]
struct Proof {
    tier: String,
    #[serde(default)]
    valid_until: Option<String>,
}

pub struct ActivationRequest<'a> {
    pub base_url: &'a str,
    pub key: &'a str,
    pub machine_id: &'a str,
    pub device_name: &'a str,
}

/// Aktivér nøglen hos licensserveren. Kun livstidslicenser accepteres her.
pub fn activate_online(req: &ActivationRequest<'_>) -> Result<()> {
    if !license_key_format_ok(req.key) {
        return Err(BackendError::Validation(
            "Nøglen skal se ud som TT-XXXX-XXXX-XXXX-XXXX".into(),
        ));
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(std::time::Duration::from_secs(10)))
        .build()
        .into();
    let body = serde_json::json!({
        "licenseKey": req.key.trim().to_ascii_uppercase(),
        "machineId": req.machine_id,
        "os": std::env::consts::OS,
        "deviceName": req.device_name,
    });
    let unreachable = || {
        BackendError::Other(
            "Kan ikke få fat i licensserveren. Tjek din forbindelse og prøv igen".into(),
        )
    };
    let mut resp = agent
        .post(&format!("{}/activate", req.base_url.trim_end_matches('/')))
        .header("Content-Type", "application/json")
        .send(body.to_string())
        .map_err(|_| unreachable())?;
    let status = resp.status().as_u16();
    let text = resp
        .body_mut()
        .read_to_string()
        .map_err(|_| unreachable())?;
    if !(200..300).contains(&status) {
        let reason = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str().map(str::to_owned)));
        return Err(match status {
            404 | 400 | 403 | 409 | 422 => BackendError::Validation(match reason {
                Some(r) => format!("Licensen blev afvist: {r}"),
                None => "Licensen blev afvist. Tjek nøglen".into(),
            }),
            _ => BackendError::Other(format!(
                "Licensserveren svarede {status}. Prøv igen om lidt"
            )),
        });
    }
    let env: Envelope = serde_json::from_str(&text).map_err(|_| {
        BackendError::Other("Licensserveren svarede med noget uventet. Prøv igen om lidt".into())
    })?;
    if env.proof.tier != "lifetime" {
        return Err(BackendError::Validation(
            "Nøglen er til et abonnement. Log ind med din konto i stedet".into(),
        ));
    }
    if let Some(until) = env.proof.valid_until.as_deref()
        && let Ok(t) = DateTime::parse_from_rfc3339(until)
        && t.with_timezone(&Utc) < Utc::now() - Duration::days(1)
    {
        return Err(BackendError::Validation("Licensen er udløbet".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{AiMode, CloudAiProvider};

    fn day(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn manglende_filer_giver_standard_og_ulaeselige_fejler_lukket() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_state(dir.path()).unwrap(), State::default());
        assert_eq!(load_settings(dir.path()).unwrap(), Settings::first_start());
        assert_eq!(load_license(dir.path()).unwrap(), LicenseFile::default());

        std::fs::write(state_path(dir.path()), "{ikke json").unwrap();
        let e = load_state(dir.path()).unwrap_err().to_string();
        assert!(e.contains("beskadiget"), "{e}");
        std::fs::write(settings_path(dir.path()), "").unwrap();
        assert!(load_settings(dir.path()).is_err());
    }

    #[test]
    fn tilstand_og_indstillinger_runde_tur() {
        let dir = tempfile::tempdir().unwrap();
        let st = State {
            mode: StoredMode::Cloud,
            imported_at: Some(Utc::now()),
        };
        save_state(dir.path(), &st).unwrap();
        assert_eq!(load_state(dir.path()).unwrap(), st);
        let text = std::fs::read_to_string(state_path(dir.path())).unwrap();
        assert!(text.contains("\"cloud\""), "{text}");

        let mut s = Settings::defaults();
        s.tracking.idle_minutes = 9;
        s.tracking.excluded_apps.push("Mail Æ".into());
        s.ai.mode = AiMode::Cloud;
        s.ai.cloud_provider = Some(CloudAiProvider::Anthropic);
        s.ai.cloud_keys = vec![CloudAiProvider::Anthropic];
        store_settings(dir.path(), &s).unwrap();
        assert_eq!(load_settings(dir.path()).unwrap(), s);
        assert!(
            !settings_path(dir.path())
                .with_extension("json.tmp")
                .exists()
        );
    }

    #[test]
    fn proeveperiode_taeller_ned_og_kan_kun_startes_en_gang() {
        let dir = tempfile::tempdir().unwrap();
        let l = start_trial(dir.path(), day(2026, 10, 26)).unwrap();
        assert_eq!(l.kind, LicenseKind::Trial { days_left: 14 });
        let f = load_license(dir.path()).unwrap();
        assert_eq!(
            f.current(day(2026, 11, 2)).unwrap().kind,
            LicenseKind::Trial { days_left: 7 }
        );
        assert_eq!(
            f.current(day(2026, 11, 8)).unwrap().kind,
            LicenseKind::Trial { days_left: 1 }
        );
        assert_eq!(f.current(day(2026, 11, 9)), None, "udløbet");
        let again = start_trial(dir.path(), day(2026, 11, 9))
            .unwrap_err()
            .to_string();
        assert!(again.contains("udløbet"), "{again}");
        let running = start_trial(dir.path(), day(2026, 10, 27))
            .unwrap_err()
            .to_string();
        assert!(running.contains("i gang"), "{running}");
    }

    #[test]
    fn livstidslicens_vinder_og_vises_maskeret() {
        let dir = tempfile::tempdir().unwrap();
        start_trial(dir.path(), day(2026, 10, 1)).unwrap();
        let l = save_lifetime(
            dir.path(),
            " tt-ab12-cd34-ef56-9f2a ",
            Utc::now(),
            day(2026, 12, 1),
        )
        .unwrap();
        assert_eq!(l.kind, LicenseKind::Lifetime);
        assert_eq!(l.key_hint, "TT-…-9F2A");
        let f = load_license(dir.path()).unwrap();
        assert_eq!(f.lifetime.as_ref().unwrap().key, "TT-AB12-CD34-EF56-9F2A");
        assert!(start_trial(dir.path(), day(2026, 12, 1)).is_err());
        assert_eq!(
            f.current(day(2030, 1, 1)).unwrap().kind,
            LicenseKind::Lifetime
        );
    }

    // ---- aktivering mod en lokal server ----

    fn serve_once(status: u16, body: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://{}", server.server_addr().to_ip().unwrap());
        let h = std::thread::spawn(move || {
            let mut req = server.recv().unwrap();
            let mut got = String::new();
            std::io::Read::read_to_string(req.as_reader(), &mut got).unwrap();
            let resp = tiny_http::Response::from_string(body)
                .with_status_code(status)
                .with_header(
                    "Content-Type: application/json"
                        .parse::<tiny_http::Header>()
                        .unwrap(),
                );
            let url = req.url().to_owned();
            req.respond(resp).unwrap();
            format!("{url} {got}")
        });
        (url, h)
    }

    fn req(url: &str) -> ActivationRequest<'_> {
        ActivationRequest {
            base_url: url,
            key: "TT-AB12-CD34-EF56-9F2A",
            machine_id: "maskine-1",
            device_name: "Mads' Mac",
        }
    }

    #[test]
    fn aktivering_accepterer_livstid() {
        let (url, h) = serve_once(
            200,
            r#"{"proof":{"license_key":"TT-AB12-CD34-EF56-9F2A","tier":"lifetime","valid_until":null,"devices_allowed":3,"issued_at":"2026-10-26T10:00:00Z","signature":"x"}}"#,
        );
        activate_online(&req(&url)).unwrap();
        let seen = h.join().unwrap();
        assert!(seen.starts_with("/activate "), "{seen}");
        assert!(
            seen.contains("\"licenseKey\":\"TT-AB12-CD34-EF56-9F2A\""),
            "{seen}"
        );
        assert!(seen.contains("\"machineId\":\"maskine-1\""), "{seen}");
    }

    #[test]
    fn aktivering_afviser_abonnement_afvist_nogle_og_fejl() {
        let (url, h) = serve_once(200, r#"{"proof":{"tier":"solo"}}"#);
        let e = activate_online(&req(&url)).unwrap_err().to_string();
        assert!(e.contains("abonnement"), "{e}");
        h.join().unwrap();

        let (url, h) = serve_once(404, r#"{"error":"Invalid license key"}"#);
        let e = activate_online(&req(&url)).unwrap_err();
        assert!(
            matches!(&e, BackendError::Validation(m) if m.contains("Invalid license key")),
            "{e:?}"
        );
        h.join().unwrap();

        let (url, h) = serve_once(503, "<html>nede</html>");
        let e = activate_online(&req(&url)).unwrap_err();
        assert!(
            matches!(&e, BackendError::Other(m) if m.contains("503")),
            "{e:?}"
        );
        h.join().unwrap();

        // Svar uden proof (fx en proxy-side med 200) aktiverer ikke.
        let (url, h) = serve_once(200, "<html>captive portal</html>");
        assert!(matches!(
            activate_online(&req(&url)),
            Err(BackendError::Other(_))
        ));
        h.join().unwrap();

        // Dårligt format afvises uden netværk.
        let bad = ActivationRequest {
            key: "nej",
            ..req("http://127.0.0.1:1")
        };
        assert!(matches!(
            activate_online(&bad),
            Err(BackendError::Validation(_))
        ));
    }

    #[test]
    fn aktivering_uden_forbindelse_er_ikke_aktiveret() {
        // Port 1 lytter ingen steder.
        let e = activate_online(&req("http://127.0.0.1:1")).unwrap_err();
        assert!(
            matches!(&e, BackendError::Other(m) if m.contains("licensserveren")),
            "{e:?}"
        );
    }
}
