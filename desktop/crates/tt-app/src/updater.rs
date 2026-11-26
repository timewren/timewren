//! Opdateringer i samme format som Tauri-updateren i 0.2.x.
//!
//! - Kanal: `latest.json` på `mahope/timetrack-releases` (samme adresse som
//!   `src-tauri/tauri.conf.json`), med `version`, `notes`, `pub_date` og
//!   `platforms.{darwin-aarch64,darwin-x86_64,windows-x86_64}.{url,signature}`.
//!   Derfor opdaterer eksisterende 0.2.22-installationer sig selv til 0.2.23,
//!   og 0.2.23 læser de samme filer.
//! - Signatur: minisign med den samme offentlige nøgle som Tauri-appen
//!   (`PUBKEY`). `signature` er base64 af `.sig`-filen. Pakken afvises, før
//!   den skrives til disken, hvis signaturen ikke passer.
//! - Installation:
//!   - macOS: `.app.tar.gz` pakkes ud ved siden af den kørende `TimeTrack.app`,
//!     som byttes ud (den gamle beholdes, til den nye er på plads).
//!   - Windows: NSIS-installeren hentes og startes ved genstart med Tauri's
//!     argumenter (`/P /R /UPDATE`), og appen lukker. Installeren starter
//!     appen igen.
//!   - Genstart sker først, når brugeren har accepteret.
//! - App Store-udgaven (`mas`): slået helt fra. Intet netværkskald, ingen
//!   installation og ingen genstart; alt giver [`UpdateError::Disabled`].

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Deserialize;

use crate::i18n::tf;

/// Stabil kanal. TimeTrack: repoets seneste release (samme adresse som
/// Tauri-appen). TimeWren: det faste `timewren-stable`-release, som aldrig er
/// repoets "latest", så de to apps' brugere aldrig får hinandens versioner
/// (`tt_core::edition`, `docs/v1/UDGIVELSE.md`).
pub const ENDPOINT: &str = tt_core::edition::EDITION.update_stable_url;
/// Beta-kanal: et fast release (`beta` eller `timewren-beta`) på samme repo,
/// som release-workflowen overskriver.
pub const ENDPOINT_BETA: &str = tt_core::edition::EDITION.update_beta_url;
/// Tauri-appens minisign-nøgle (`plugins.updater.pubkey`), key id 79C1EBC058733350.
pub const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc5QzFFQkMwNTg3MzMzNTAKUldSUU0zTll3T3ZCZWJaMkVYOFpnaXFFVmhyTGZQZkJqODhTU0hGODRBZ0QxVDlNSUZYaVN0cVcK";

/// Største pakke, vi henter (0.2.22 er 6-12 MB, 0.2.23 ca. 13 MB).
const MAX_BYTES: u64 = 400 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdateError {
    /// Netværk eller HTTP-fejl.
    Network(String),
    /// `latest.json` kan ikke læses.
    Manifest(String),
    /// Ingen pakke til denne platform.
    NoPlatform(String),
    /// Signaturen passer ikke (eller mangler).
    Signature(String),
    /// Installationen fejlede. Den installerede app er urørt.
    Install(String),
    /// App Store-udgaven (`mas`): App Store opdaterer appen.
    Disabled,
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdateError::Network(e) => f.write_str(&tf("opdatering.err.network", &[("error", e)])),
            UpdateError::Manifest(e) => f.write_str(&tf("opdatering.err.manifest", &[("error", e)])),
            UpdateError::NoPlatform(p) => {
                f.write_str(&tf("opdatering.err.no_platform", &[("platform", p)]))
            }
            UpdateError::Signature(e) => f.write_str(&tf("opdatering.err.signature", &[("error", e)])),
            UpdateError::Install(e) => f.write_str(&tf("opdatering.err.install", &[("error", e)])),
            UpdateError::Disabled => f.write_str(crate::i18n::t("mas.opdateringer.tekst")),
        }
    }
}

impl std::error::Error for UpdateError {}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    pub platforms: BTreeMap<String, PlatformAsset>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct PlatformAsset {
    pub url: String,
    pub signature: String,
}

/// En tilgængelig, nyere version.
#[derive(Clone, Debug, PartialEq)]
pub struct Update {
    pub version: String,
    pub notes: Option<String>,
    pub url: String,
    pub signature: String,
}

/// Tauri's platformnøgle for denne build.
pub fn platform_key() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("darwin-aarch64"),
        ("macos", "x86_64") => Some("darwin-x86_64"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        _ => None,
    }
}

pub fn parse_version(s: &str) -> Option<semver::Version> {
    semver::Version::parse(s.trim().trim_start_matches('v')).ok()
}

/// `remote` er nyere end `current` efter semver (0.2.23 > 0.2.22, 0.2.23 > 0.2.23-beta.1).
pub fn is_newer(remote: &str, current: &str) -> bool {
    match (parse_version(remote), parse_version(current)) {
        (Some(r), Some(c)) => r > c,
        _ => false,
    }
}

/// Læs `latest.json` og vælg pakken til `platform`, hvis den er nyere.
pub fn select(json: &str, current: &str, platform: &str) -> Result<Option<Update>, UpdateError> {
    let m: Manifest =
        serde_json::from_str(json).map_err(|e| UpdateError::Manifest(e.to_string()))?;
    if parse_version(&m.version).is_none() {
        return Err(UpdateError::Manifest(format!("ugyldig version {:?}", m.version)));
    }
    if !is_newer(&m.version, current) {
        return Ok(None);
    }
    let asset = m
        .platforms
        .get(platform)
        .ok_or_else(|| UpdateError::NoPlatform(platform.to_string()))?;
    Ok(Some(Update {
        version: m.version.trim_start_matches('v').to_string(),
        notes: m.notes.filter(|n| !n.trim().is_empty()),
        url: asset.url.clone(),
        signature: asset.signature.clone(),
    }))
}

fn b64_text(s: &str, what: &str) -> Result<String, UpdateError> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| UpdateError::Signature(format!("{what} er ikke base64: {e}")))?;
    String::from_utf8(raw).map_err(|_| UpdateError::Signature(format!("{what} er ikke tekst")))
}

/// Tjek `data` mod en Tauri-signatur (base64 af minisign-`.sig`) og en
/// Tauri-nøgle (base64 af minisign-`.pub`), som Tauri-updateren gør.
pub fn verify_signature(data: &[u8], signature_b64: &str, pubkey_b64: &str) -> Result<(), UpdateError> {
    let pk = minisign_verify::PublicKey::decode(&b64_text(pubkey_b64, "Nøglen")?)
        .map_err(|e| UpdateError::Signature(format!("nøgle: {e}")))?;
    let sig = minisign_verify::Signature::decode(&b64_text(signature_b64, "Signaturen")?)
        .map_err(|e| UpdateError::Signature(format!("signatur: {e}")))?;
    pk.verify(data, &sig, true)
        .map_err(|e| UpdateError::Signature(e.to_string()))
}

/// Spørg kanalen. `Ok(None)` = ingen nyere version.
pub fn check(endpoint: &str, current: &str) -> Result<Option<Update>, UpdateError> {
    enabled()?;
    let platform = platform_key()
        .ok_or_else(|| UpdateError::NoPlatform(std::env::consts::OS.to_string()))?;
    let json = http_get(endpoint, 1024 * 1024)?;
    let json = String::from_utf8(json).map_err(|e| UpdateError::Manifest(e.to_string()))?;
    select(&json, current, platform)
}

/// Beta tjekker både beta og stabil og tager den nyeste, så en beta-bruger
/// også får stabile versioner (og intet mister, hvis beta-kanalen mangler).
pub fn check_channel(beta: bool, current: &str) -> Result<Option<Update>, UpdateError> {
    if !beta {
        return check(ENDPOINT, current);
    }
    newest(vec![check(ENDPOINT_BETA, current), check(ENDPOINT, current)])
}

/// Den nyeste af flere svar. Fejl tæller kun, hvis alle fejlede.
pub fn newest(results: Vec<Result<Option<Update>, UpdateError>>) -> Result<Option<Update>, UpdateError> {
    let mut best: Option<Update> = None;
    let mut first_err = None;
    let mut any_ok = false;
    for r in results {
        match r {
            Ok(u) => {
                any_ok = true;
                if let Some(u) = u
                    && best.as_ref().is_none_or(|b| is_newer(&u.version, &b.version))
                {
                    best = Some(u);
                }
            }
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    match (any_ok, first_err) {
        (false, Some(e)) => Err(e),
        _ => Ok(best),
    }
}

/// `Err(Disabled)` i App Store-udgaven, før noget andet sker.
fn enabled() -> Result<(), UpdateError> {
    if crate::mas::UPDATER { Ok(()) } else { Err(UpdateError::Disabled) }
}

fn http_get(url: &str, max: u64) -> Result<Vec<u8>, UpdateError> {
    enabled()?;
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(600)))
        .user_agent(format!("{}/{}", tt_core::edition::EDITION.name, env!("CARGO_PKG_VERSION")))
        .build()
        .new_agent();
    let mut resp = agent
        .get(url)
        .call()
        .map_err(|e| UpdateError::Network(e.to_string()))?;
    let mut out = vec![];
    resp.body_mut()
        .as_reader()
        .take(max + 1)
        .read_to_end(&mut out)
        .map_err(|e| UpdateError::Network(e.to_string()))?;
    if out.len() as u64 > max {
        return Err(UpdateError::Network("pakken er for stor".into()));
    }
    Ok(out)
}

/// Hent pakken og tjek signaturen. Intet skrives til disken før tjekket.
pub fn download(update: &Update) -> Result<Vec<u8>, UpdateError> {
    download_with(update, PUBKEY)
}

fn download_with(update: &Update, pubkey: &str) -> Result<Vec<u8>, UpdateError> {
    let bytes = http_get(&update.url, MAX_BYTES)?;
    verify_signature(&bytes, &update.signature, pubkey)?;
    Ok(bytes)
}

/// Det, der skal ske efter installationen, når brugeren genstarter.
#[derive(Clone, Debug, PartialEq)]
pub enum Installed {
    /// macOS: den nye `TimeTrack.app` ligger på stien; start den og luk.
    App(PathBuf),
    /// Windows: installeren ligger klar; den startes ved genstart og
    /// starter selv appen igen.
    Installer(PathBuf),
}

/// Installér en verificeret pakke.
pub fn install(bytes: &[u8]) -> Result<Installed, UpdateError> {
    enabled()?;
    let exe = std::env::current_exe().map_err(|e| UpdateError::Install(e.to_string()))?;
    install_for(&exe, bytes)
}

#[cfg(target_os = "macos")]
fn install_for(exe: &Path, bytes: &[u8]) -> Result<Installed, UpdateError> {
    let app = bundle_of(exe).ok_or_else(|| {
        UpdateError::Install(format!("appen kører ikke fra en installeret {}.app", tt_core::edition::EDITION.name))
    })?;
    replace_bundle(&app, bytes)?;
    Ok(Installed::App(app))
}

#[cfg(target_os = "windows")]
fn install_for(_exe: &Path, bytes: &[u8]) -> Result<Installed, UpdateError> {
    // Kun skrevet her. Installeren lukker appen, så den startes først, når
    // brugeren trykker "Genstart" (`relaunch`).
    let path = std::env::temp_dir().join(format!("{}-opdatering-{}-setup.exe", tt_core::edition::EDITION.name, std::process::id()));
    std::fs::write(&path, bytes).map_err(|e| UpdateError::Install(e.to_string()))?;
    Ok(Installed::Installer(path))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn install_for(_exe: &Path, _bytes: &[u8]) -> Result<Installed, UpdateError> {
    Err(UpdateError::NoPlatform(std::env::consts::OS.to_string()))
}

/// Samme argumenter som Tauri-updaterens NSIS-tilstand "passive":
/// `/P` uden spørgsmål, `/R` start appen bagefter, `/UPDATE` opdatering.
/// `bundle/windows/installer.nsi` forstår dem, så både 0.2.22 og den nye app kan
/// starte installeren.
pub const WINDOWS_INSTALLER_ARGS: [&str; 3] = ["/P", "/R", "/UPDATE"];

/// Kaldes lige før appen lukker: macOS starter den nye app, Windows starter
/// installeren (som lukker resten og starter appen igen med `/R`).
pub fn relaunch(installed: &Installed) -> Result<(), UpdateError> {
    enabled()?;
    let res = match installed {
        Installed::App(app) => std::process::Command::new("/usr/bin/open").arg("-n").arg(app).spawn(),
        Installed::Installer(setup) => std::process::Command::new(setup).args(WINDOWS_INSTALLER_ARGS).spawn(),
    };
    res.map(|_| ()).map_err(|e| UpdateError::Install(e.to_string()))
}

/// `…/TimeTrack.app/Contents/MacOS/timetrack-desktop` → `…/TimeTrack.app`.
pub fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let app = contents.parent()?;
    let ok = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && app.extension()? == "app";
    ok.then(|| app.to_path_buf())
}

/// Pak `.app.tar.gz` ud ved siden af `app` og byt. Den gamle bundle flyttes
/// væk først og lægges tilbage, hvis noget går galt.
pub fn replace_bundle(app: &Path, tar_gz: &[u8]) -> Result<(), UpdateError> {
    let err = |e: std::io::Error| UpdateError::Install(e.to_string());
    let parent = app
        .parent()
        .ok_or_else(|| UpdateError::Install("ingen mappe".into()))?;
    let pid = std::process::id();
    let work = parent.join(format!(".{}-opdatering-{pid}", tt_core::edition::EDITION.name));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            // Tauri bad om administrator-adgang her; vi beder brugeren gøre det selv.
            UpdateError::Install(tf(
                "opdatering.err.no_write",
                &[("dir", &parent.display().to_string())],
            ))
        } else {
            err(e)
        }
    })?;
    let result = (|| {
        let archive = work.join("pakke.tar.gz");
        std::fs::write(&archive, tar_gz).map_err(err)?;
        let out = std::process::Command::new("tar")
            .arg("-xzf")
            .arg(&archive)
            .arg("-C")
            .arg(&work)
            .output()
            .map_err(err)?;
        if !out.status.success() {
            return Err(UpdateError::Install(format!(
                "pakken kan ikke pakkes ud: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        let new_app = std::fs::read_dir(&work)
            .map_err(err)?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|x| x == "app") && p.is_dir())
            .ok_or_else(|| UpdateError::Install("pakken indeholder ingen .app".into()))?;
        if !new_app.join("Contents/Info.plist").is_file() {
            return Err(UpdateError::Install("pakken er ikke en hel app".into()));
        }
        let old = parent.join(format!(".{}-gammel-{pid}.app", tt_core::edition::EDITION.name));
        let _ = std::fs::remove_dir_all(&old);
        std::fs::rename(app, &old).map_err(err)?;
        if let Err(e) = std::fs::rename(&new_app, app) {
            let _ = std::fs::rename(&old, app);
            return Err(err(e));
        }
        let _ = std::fs::remove_dir_all(&old);
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&work);
    result
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod brand_tests {
    /// Hver udgave læser sin egen `latest.json`, så TimeTrack-brugere aldrig
    /// får TimeWren og omvendt.
    #[test]
    fn brand_opdateringskanalen_er_udgavens() {
        let e = tt_core::edition::EDITION;
        assert_eq!(super::ENDPOINT, e.update_stable_url);
        assert_eq!(super::ENDPOINT_BETA, e.update_beta_url);
        for other in tt_core::edition::Edition::ALL.iter().filter(|o| o.id != e.id) {
            assert_ne!(super::ENDPOINT, other.update_stable_url);
            assert_ne!(super::ENDPOINT_BETA, other.update_beta_url);
        }
        if e.is_timewren() {
            assert!(super::ENDPOINT.contains("/timewren-stable/"));
            assert!(super::ENDPOINT_BETA.contains("/timewren-beta/"));
        } else {
            // Uændret: repoets seneste release og det faste beta-release.
            assert!(super::ENDPOINT.ends_with("/releases/latest/download/latest.json"));
            assert!(super::ENDPOINT_BETA.ends_with("/releases/download/beta/latest.json"));
        }
    }
}
