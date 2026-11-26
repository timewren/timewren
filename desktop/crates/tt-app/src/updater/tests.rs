use super::*;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Et test-nøglepar i Tauri's form: base64 af minisign-`.pub`, og en
/// signeringsfunktion, der giver base64 af `.sig` (som `tauri signer sign`).
struct TestKey {
    kp: minisign::KeyPair,
}

impl TestKey {
    fn new() -> Self {
        TestKey { kp: minisign::KeyPair::generate_unencrypted_keypair().unwrap() }
    }
    fn pubkey_b64(&self) -> String {
        B64.encode(self.kp.pk.to_box().unwrap().to_string())
    }
    fn sign_b64(&self, data: &[u8]) -> String {
        let sig = minisign::sign(
            Some(&self.kp.pk),
            &self.kp.sk,
            std::io::Cursor::new(data),
            Some("timestamp:1791066091\tfile:TimeTrack.app.tar.gz"),
            Some("signature from tauri secret key"),
        )
        .unwrap();
        B64.encode(sig.to_string())
    }
}

#[test]
fn versioner() {
    assert!(is_newer("0.2.23", "0.2.22"));
    assert!(is_newer("v0.2.23", "0.2.9"));
    assert!(is_newer("0.2.23", "0.2.3"), "numerisk, ikke tekst");
    assert!(is_newer("0.2.100", "0.2.99"));
    assert!(is_newer("0.10.0", "0.9.9"), "semver, ikke tekst");
    assert!(is_newer("0.2.23", "0.2.23-beta.1"));
    assert!(is_newer("0.2.24-beta.1", "0.2.23"));
    assert!(!is_newer("0.2.23", "0.2.23"));
    assert!(!is_newer("0.2.22", "0.2.23"), "aldrig nedgradering");
    assert!(!is_newer("ny", "0.2.23"));
}

fn manifest(version: &str) -> String {
    format!(
        r##"{{
  "version": "{version}",
  "notes": "Tilføjet: Ny app",
  "pub_date": "2026-11-01T10:00:00Z",
  "platforms": {{
    "windows-x86_64": {{ "signature": "c2ln", "url": "https://x/TimeTrack_{version}_x64-setup.exe" }},
    "darwin-aarch64": {{ "signature": "c2ln", "url": "https://x/darwin-aarch64-TimeTrack.app.tar.gz" }},
    "darwin-x86_64": {{ "signature": "c2ln", "url": "https://x/darwin-x86_64-TimeTrack.app.tar.gz" }}
  }}
}}"##
    )
}

#[test]
fn vaelger_pakken_til_platformen() {
    let u = select(&manifest("0.2.23"), "0.2.22", "darwin-aarch64").unwrap().unwrap();
    assert_eq!(u.version, "0.2.23");
    assert_eq!(u.url, "https://x/darwin-aarch64-TimeTrack.app.tar.gz");
    assert!(u.notes.unwrap().contains("Ny app"));
    let w = select(&manifest("0.2.23"), "0.2.22", "windows-x86_64").unwrap().unwrap();
    assert!(w.url.ends_with("x64-setup.exe"));
    assert_eq!(select(&manifest("0.2.23"), "0.2.23", "darwin-aarch64").unwrap(), None);
    assert!(matches!(
        select(&manifest("0.2.24"), "0.2.23", "linux-x86_64"),
        Err(UpdateError::NoPlatform(_))
    ));
    assert!(matches!(select("{}", "0.2.23", "darwin-aarch64"), Err(UpdateError::Manifest(_))));
}

/// Den rigtige `latest.json` fra 0.2.22 (forkortet) læses uden fejl.
#[test]
fn laeser_tauris_latest_json() {
    let json = r#"{"version":"0.2.22","notes":"x","pub_date":"2026-10-03T22:40:38Z","platforms":{"darwin-aarch64":{"signature":"dW50cnVzdGVk","url":"https://github.com/mahope/timetrack-releases/releases/download/v0.2.22/darwin-aarch64-TimeTrack.app.tar.gz"}}}"#;
    let u = select(json, "0.2.21", "darwin-aarch64").unwrap().unwrap();
    assert_eq!(u.version, "0.2.22");
}

#[test]
fn signatur_med_testnoegle() {
    let key = TestKey::new();
    let data = b"TimeTrack 0.2.23 pakke".to_vec();
    let sig = key.sign_b64(&data);
    assert_eq!(verify_signature(&data, &sig, &key.pubkey_b64()), Ok(()));

    let mut tampered = data.clone();
    tampered[0] ^= 1;
    assert!(matches!(
        verify_signature(&tampered, &sig, &key.pubkey_b64()),
        Err(UpdateError::Signature(_))
    ));
    let other = TestKey::new();
    assert!(
        verify_signature(&data, &sig, &other.pubkey_b64()).is_err(),
        "en anden nøgle afvises"
    );
    assert!(
        verify_signature(&data, &sig, PUBKEY).is_err(),
        "testnøglen er ikke TimeTracks rigtige nøgle"
    );
    assert!(verify_signature(&data, "ikke base64!", &key.pubkey_b64()).is_err());
    assert!(verify_signature(&data, "", &key.pubkey_b64()).is_err());
}

#[test]
fn den_rigtige_noegle_kan_laeses() {
    let text = String::from_utf8(B64.decode(PUBKEY).unwrap()).unwrap();
    assert!(text.contains("79C1EBC058733350"));
    assert!(minisign_verify::PublicKey::decode(&text).is_ok());
}

/// Rigtig 0.2.22-pakke mod den rigtige nøgle. Kør manuelt:
/// `TT_UPDATER_REAL=/tmp/tt022 cargo test -p tt-app --lib updater -- --ignored`
/// med `latest.json` og `darwin-aarch64-TimeTrack.app.tar.gz` i mappen.
#[test]
#[ignore]
fn rigtig_0_2_22_signatur() {
    let dir = PathBuf::from(std::env::var("TT_UPDATER_REAL").expect("TT_UPDATER_REAL"));
    let json = std::fs::read_to_string(dir.join("latest.json")).unwrap();
    let u = select(&json, "0.2.0", "darwin-aarch64").unwrap().unwrap();
    let data = std::fs::read(dir.join("darwin-aarch64-TimeTrack.app.tar.gz")).unwrap();
    assert_eq!(verify_signature(&data, &u.signature, PUBKEY), Ok(()));
    let mut bad = data.clone();
    let n = bad.len() / 2;
    bad[n] ^= 1;
    assert!(verify_signature(&bad, &u.signature, PUBKEY).is_err());
}

/// Pakke signeret af `scripts/bundle-macos.sh` med Tauri-CLI'en og en
/// testnøgle (`tauri signer generate`). Kør manuelt:
/// `TT_UPDATER_PKG=<…app.tar.gz> TT_UPDATER_PUB=<k.pub> cargo test -p tt-app --lib updater -- --ignored`
#[test]
#[ignore]
fn tauri_cli_signatur_fra_bundle_scriptet() {
    let pkg = PathBuf::from(std::env::var("TT_UPDATER_PKG").expect("TT_UPDATER_PKG"));
    let pubkey = std::fs::read_to_string(std::env::var("TT_UPDATER_PUB").expect("TT_UPDATER_PUB")).unwrap();
    let data = std::fs::read(&pkg).unwrap();
    let sig = std::fs::read_to_string(format!("{}.sig", pkg.display())).unwrap();
    assert_eq!(verify_signature(&data, &sig, &pubkey), Ok(()));
    assert!(verify_signature(&data, &sig, PUBKEY).is_err(), "testnøglen er ikke den rigtige");
}

#[test]
fn bundle_sti() {
    assert_eq!(
        bundle_of(Path::new("/Applications/TimeTrack.app/Contents/MacOS/timetrack-desktop")),
        Some(PathBuf::from("/Applications/TimeTrack.app"))
    );
    assert_eq!(bundle_of(Path::new("/Users/x/target/release/timetrack")), None);
}

fn fake_app(dir: &Path, version: &str) -> PathBuf {
    let app = dir.join("TimeTrack.app");
    std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
    std::fs::write(app.join("Contents/Info.plist"), version).unwrap();
    std::fs::write(app.join("Contents/MacOS/timetrack-desktop"), version).unwrap();
    app
}

fn tar_gz_of(app_parent: &Path) -> Vec<u8> {
    let out = app_parent.join("pakke.tar.gz");
    let st = std::process::Command::new("tar")
        .arg("-czf")
        .arg(&out)
        .arg("-C")
        .arg(app_parent)
        .arg("TimeTrack.app")
        .status()
        .unwrap();
    assert!(st.success());
    std::fs::read(out).unwrap()
}

#[test]
fn bundle_byttes_ud() {
    let src = tempfile::tempdir().unwrap();
    fake_app(src.path(), "0.2.23");
    let pkg = tar_gz_of(src.path());

    let installed = tempfile::tempdir().unwrap();
    let app = fake_app(installed.path(), "0.2.22");
    std::fs::write(app.join("Contents/MacOS/gammel-fil"), "x").unwrap();
    replace_bundle(&app, &pkg).unwrap();
    assert_eq!(std::fs::read_to_string(app.join("Contents/Info.plist")).unwrap(), "0.2.23");
    assert!(!app.join("Contents/MacOS/gammel-fil").exists(), "hele bundlet er nyt");
    let rest: Vec<_> = std::fs::read_dir(installed.path()).unwrap().flatten().collect();
    assert_eq!(rest.len(), 1, "ingen midlertidige mapper efterladt");
}

#[test]
fn ugyldig_pakke_roerer_ikke_appen() {
    let installed = tempfile::tempdir().unwrap();
    let app = fake_app(installed.path(), "0.2.22");
    assert!(matches!(replace_bundle(&app, b"ikke en tar"), Err(UpdateError::Install(_))));
    // En tar uden .app.
    let src = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(src.path().join("TimeTrack.app")).unwrap();
    let empty = tar_gz_of(src.path());
    assert!(replace_bundle(&app, &empty).is_err(), "en .app uden Info.plist afvises");
    assert_eq!(std::fs::read_to_string(app.join("Contents/Info.plist")).unwrap(), "0.2.22");
    assert_eq!(std::fs::read_dir(installed.path()).unwrap().count(), 1);
}

#[test]
fn beta_tager_den_nyeste_af_kanalerne() {
    let u = |v: &str| Update { version: v.into(), notes: None, url: String::new(), signature: String::new() };
    let net = || UpdateError::Network("404".into());
    // Beta-kanalen mangler: stabil vinder stadig.
    assert_eq!(newest(vec![Err(net()), Ok(Some(u("0.2.24")))]).unwrap(), Some(u("0.2.24")));
    // Stabil er nyere end den seneste beta.
    assert_eq!(
        newest(vec![Ok(Some(u("0.2.24-beta.1"))), Ok(Some(u("0.2.24")))]).unwrap(),
        Some(u("0.2.24"))
    );
    assert_eq!(
        newest(vec![Ok(Some(u("0.2.25-beta.1"))), Ok(Some(u("0.2.24")))]).unwrap(),
        Some(u("0.2.25-beta.1"))
    );
    assert_eq!(newest(vec![Ok(None), Err(net())]).unwrap(), None);
    assert_eq!(newest(vec![Err(net()), Err(net())]), Err(net()));
}

#[test]
fn installer_argumenter_som_tauri() {
    assert_eq!(WINDOWS_INSTALLER_ARGS, ["/P", "/R", "/UPDATE"]);
}

/// Hele vejen mod en lokal server: latest.json → nyere version → hent →
/// signaturtjek → byt bundlet. En pakke med forkert signatur rører intet.
#[test]
#[cfg(not(feature = "mas"))]
fn ende_til_ende_mod_lokal_kanal() {
    let Some(platform) = platform_key() else { return };
    let key = TestKey::new();
    let src = tempfile::tempdir().unwrap();
    fake_app(src.path(), "0.2.24");
    let pkg = tar_gz_of(src.path());
    let good_sig = key.sign_b64(&pkg);
    let bad_sig = TestKey::new().sign_b64(&pkg);

    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr().to_ip().unwrap());
    let manifest = |sig: &str| {
        format!(
            r#"{{"version":"0.2.24","notes":"Rettelser","pub_date":"2026-11-01T10:00:00Z","platforms":{{"{platform}":{{"signature":"{sig}","url":"{base}/pakke.tar.gz"}}}}}}"#
        )
    };
    let (good, bad) = (manifest(&good_sig), manifest(&bad_sig));
    let body = pkg.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let data = match req.url() {
                "/latest.json" => good.clone().into_bytes(),
                "/forkert.json" => bad.clone().into_bytes(),
                "/pakke.tar.gz" => body.clone(),
                _ => {
                    let _ = req.respond(tiny_http::Response::empty(404));
                    continue;
                }
            };
            let _ = req.respond(tiny_http::Response::from_data(data));
        }
    });

    assert_eq!(check(&format!("{base}/latest.json"), "0.2.24").unwrap(), None);
    let u = check(&format!("{base}/latest.json"), "0.2.23").unwrap().unwrap();
    assert_eq!(u.version, "0.2.24");
    let installed = tempfile::tempdir().unwrap();
    let app = fake_app(installed.path(), "0.2.23");

    let forged = check(&format!("{base}/forkert.json"), "0.2.23").unwrap().unwrap();
    assert!(matches!(download_with(&forged, &key.pubkey_b64()), Err(UpdateError::Signature(_))));
    assert!(matches!(download(&u), Err(UpdateError::Signature(_))), "kun TimeTracks rigtige nøgle");

    let bytes = download_with(&u, &key.pubkey_b64()).unwrap();
    replace_bundle(&app, &bytes).unwrap();
    assert_eq!(std::fs::read_to_string(app.join("Contents/Info.plist")).unwrap(), "0.2.24");
    assert!(matches!(
        check(&format!("{base}/findes-ikke.json"), "0.2.23"),
        Err(UpdateError::Network(_))
    ));
}

/// App Store-udgaven: updateren kalder aldrig kanalen (serveren får ingen
/// forespørgsler), henter intet, installerer intet og genstarter intet.
#[test]
#[cfg(feature = "mas")]
fn mas_updater_er_slaaet_fra() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr().to_ip().unwrap());
    let hits = Arc::new(AtomicUsize::new(0));
    let seen = hits.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            seen.fetch_add(1, Ordering::SeqCst);
            let _ = req.respond(tiny_http::Response::empty(404));
        }
    });
    assert_eq!(check(&format!("{base}/latest.json"), "0.0.1"), Err(UpdateError::Disabled));
    assert_eq!(check_channel(false, "0.0.1"), Err(UpdateError::Disabled));
    assert_eq!(check_channel(true, "0.0.1"), Err(UpdateError::Disabled));
    let u = Update {
        version: "9.9.9".into(),
        notes: None,
        url: format!("{base}/pakke.tar.gz"),
        signature: String::new(),
    };
    assert_eq!(download(&u), Err(UpdateError::Disabled));
    assert_eq!(install(b"x"), Err(UpdateError::Disabled));
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(relaunch(&Installed::App(dir.path().join("X.app"))), Err(UpdateError::Disabled));
    assert_eq!(hits.load(Ordering::SeqCst), 0, "ingen netværkskald");
    assert!(!UpdateError::Disabled.to_string().is_empty());
}
