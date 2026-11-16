//! Hele vejen: rigtige motorer bag `RepoBackend` i cloud mod `MockWeb`,
//! der gemmer mønstre som web (erstatter pr. nøgle, normaliserer stemmerne
//! som zod). Læringen sker ved at bekræfte forslag.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};
use futures_lite::future::block_on;
use serde_json::Value;
use tt_ai as tai;
use tt_data as td;
use tt_data::Repository as _;
use tt_data::mock::MockWeb;
use tt_tracker as tr;

use super::super::{Engine, lock};
use crate::backend::Backend;
use crate::backend::repo::{Options, RepoBackend};

fn date(d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
}

fn at(date: NaiveDate, h: u32) -> DateTime<Utc> {
    Local
        .from_local_datetime(&date.and_hms_opt(h, 0, 0).unwrap())
        .earliest()
        .unwrap()
        .with_timezone(&Utc)
}

fn browser(date: NaiveDate, domain: &str) -> tr::ActivitySegment {
    tr::ActivitySegment {
        id: None,
        app: "Google Chrome".into(),
        app_id: "google chrome".into(),
        title: "Forside".into(),
        url: Some(format!("https://{domain}/side")),
        domain: Some(domain.into()),
        repo_remote: None,
        repo_root: None,
        branch: None,
        path: None,
        document: None,
        start: at(date, 9),
        end: at(date, 10),
        idle: false,
    }
}

/// Én enhed: datamappe, motor og backend logget ind på web.
struct Device {
    dir: tempfile::TempDir,
    secrets: Arc<td::MemorySecretStore>,
    engine: Arc<Engine>,
    backend: RepoBackend,
}

fn detection_dir(dir: &Path) -> std::path::PathBuf {
    dir.join("detektion")
}

fn open(mock: &MockWeb, dir: &Path, secrets: Arc<td::MemorySecretStore>) -> (Arc<Engine>, RepoBackend) {
    let engine = Arc::new(
        Engine::new(detection_dir(dir), None).with_secrets(Arc::new(tai::MemorySecrets::default())),
    );
    let mut o = Options::for_tests(dir.to_path_buf(), engine.clone());
    o.web_url = mock.base_url().to_owned();
    o.secrets = secrets;
    (engine, RepoBackend::open_with(o).unwrap())
}

impl Device {
    fn new(mock: &MockWeb, token: &str, days: &[u32], domain: &str) -> Device {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(detection_dir(dir.path())).unwrap();
        let store = tr::ActivityStore::open(&detection_dir(dir.path()).join("activity.db")).unwrap();
        for d in days {
            store.insert(&browser(date(*d), domain)).unwrap();
        }
        drop(store);
        let secrets = Arc::new(td::MemorySecretStore::new());
        let (engine, backend) = open(mock, dir.path(), secrets.clone());
        backend.login_with_token(token).unwrap();
        Device {
            dir,
            secrets,
            engine,
            backend,
        }
    }

    /// Genstart: ny motor og backend på samme mappe og login.
    fn restart(self, mock: &MockWeb) -> Device {
        let Device { dir, secrets, .. } = self;
        let (engine, backend) = open(mock, dir.path(), secrets.clone());
        Device {
            dir,
            secrets,
            engine,
            backend,
        }
    }

    /// Bekræft dagens eneste forslag (lærer mønsteret).
    fn confirm(&self, day: u32) {
        let s = self.backend.suggestions(date(day)).unwrap();
        assert_eq!(s.len(), 1, "forslag {day}: {s:?}");
        self.backend.confirm_suggestion(&s[0].id, None).unwrap();
    }

    fn sync(&self) -> crate::backend::services::PatternSyncReport {
        self.backend.sync_patterns_now().unwrap()
    }

    /// Lokale bekræftelser på bageriet.dk.
    fn local(&self) -> u32 {
        lock(&self.engine.patterns)
            .store
            .patterns
            .iter()
            .filter(|p| matches!(&p.key, tt_matcher::PatternKey::Domain { domain } if domain == "bageriet.dk"))
            .flat_map(|p| p.votes.iter().map(|v| v.confirmations))
            .sum()
    }
}

/// Web's bekræftelser på bageriet.dk.
fn on_web(mock: &MockWeb) -> u64 {
    mock.learned_patterns()
        .iter()
        .filter(|r| r["key"]["domain"] == "bageriet.dk")
        .flat_map(|r| r["votes"].as_array().cloned().unwrap_or_default())
        .map(|v| v["confirmations"].as_u64().unwrap())
        .sum()
}

fn web_client(mock: &MockWeb, domains: &[&str]) -> td::Client {
    block_on(mock.repo().create_client(td::NewClient {
        // Et navn, der ikke ligner domænet, så kun domænet kan give forslaget.
        name: "Kunde Nord".into(),
        domains: domains.iter().map(|d| d.to_string()).collect(),
        ..Default::default()
    }))
    .unwrap()
}

fn wait_until(what: &str, mut f: impl FnMut() -> bool) {
    let start = Instant::now();
    while !f() {
        assert!(start.elapsed() < Duration::from_secs(10), "{what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn to_enheder_mod_web_summen_af_laeringerne_aldrig_dobbelt() {
    let mock = MockWeb::start("tok-test");
    web_client(&mock, &["bageriet.dk"]);
    let a = Device::new(&mock, "tok-test", &[20, 21, 22], "bageriet.dk");
    // Andre dage end a: en post, a allerede har ført på samme tid, foreslås
    // ikke igen på b (manuelle valg vinder, observer).
    let b = Device::new(&mock, &mock.issue_token(), &[23, 24, 25], "bageriet.dk");

    a.confirm(20);
    a.sync();
    b.confirm(23);
    b.sync();
    a.sync();
    assert_eq!(on_web(&mock), 2);
    assert_eq!((a.local(), b.local()), (2, 2));

    a.confirm(21);
    b.confirm(24);
    b.sync();
    a.sync();
    b.sync();
    assert_eq!(on_web(&mock), 4);
    assert_eq!((a.local(), b.local()), (4, 4));

    // Runder uden læring sender intet.
    let upserts = mock.calls("extension.patterns.upsert");
    for _ in 0..3 {
        a.sync();
        b.sync();
    }
    assert_eq!(mock.calls("extension.patterns.upsert"), upserts);
    assert_eq!(on_web(&mock), 4);

    // Web's række har zod's form (ingen ekstra felter, tællere sat).
    let row = mock
        .learned_patterns()
        .into_iter()
        .find(|r| r["key"]["domain"] == "bageriet.dk")
        .unwrap();
    let vote = &row["votes"][0];
    assert!(vote["target"]["clientId"].is_string(), "{row}");
    assert_eq!(vote["aiAnswers"], Value::from(0));
}

#[test]
fn tabt_svar_og_afvist_kald_mod_web_sendes_igen_uden_dobbelttaelling() {
    let mock = MockWeb::start("tok-test");
    web_client(&mock, &["bageriet.dk"]);
    let a = Device::new(&mock, "tok-test", &[20, 21], "bageriet.dk");

    // Web gemmer, men svaret når aldrig frem.
    a.confirm(20);
    mock.drop_responses_of("extension.patterns.upsert", 1);
    assert!(a.backend.sync_patterns_now().is_err());
    assert_eq!(on_web(&mock), 1);
    wait_until("igen online", || a.backend.sync_patterns_now().is_ok());
    a.sync();
    assert_eq!(on_web(&mock), 1);
    assert_eq!(a.local(), 1);

    // Web afviser kaldet (fx en fejl på serveren) før det gemmes.
    a.confirm(21);
    mock.fail_next("extension.patterns.upsert", "INTERNAL_SERVER_ERROR", 1);
    assert!(a.backend.sync_patterns_now().is_err());
    assert_eq!(on_web(&mock), 1);
    wait_until("igen online", || a.backend.sync_patterns_now().is_ok());
    a.sync();
    assert_eq!(on_web(&mock), 2);
    assert_eq!(a.local(), 2);
}

#[test]
fn moenstre_hentes_efter_genstart() {
    let mock = MockWeb::start("tok-test");
    web_client(&mock, &["bageriet.dk"]);
    let a = Device::new(&mock, "tok-test", &[20], "bageriet.dk");
    let b = Device::new(&mock, &mock.issue_token(), &[23, 24], "bageriet.dk");
    a.confirm(20);
    a.sync();
    let a = a.restart(&mock);
    b.confirm(23);
    b.confirm(24);
    b.sync();
    assert_eq!(a.local(), 1, "lageret overlevede genstarten");
    a.sync();
    assert_eq!(a.local(), 3);
    assert_eq!(on_web(&mock), 3);
}

#[test]
fn lokal_tilstand_synkroniserer_ikke() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(Engine::new(detection_dir(dir.path()), None));
    let b = RepoBackend::open_with(Options::for_tests(dir.path().to_path_buf(), engine)).unwrap();
    assert_eq!(b.sync_patterns_now().unwrap(), Default::default());
}

#[test]
fn ikke_arbejde_fra_web_giver_intet_forslag_uden_genstart() {
    let mock = MockWeb::start("tok-test");
    web_client(&mock, &["bageriet.dk"]);
    let a = Device::new(&mock, "tok-test", &[20], "bageriet.dk");
    assert_eq!(a.backend.suggestions(date(20)).unwrap().len(), 1);
    block_on(mock.repo().upsert_rule(td::MatchingRule {
        id: String::new(),
        kind: td::RuleKind::Domain,
        pattern: "bageriet.dk".into(),
        project_id: None,
        client_id: None,
        source: td::RuleSource::User,
        confirmations: 0,
        not_work: true,
        updated_at: None,
    }))
    .unwrap();
    mock.publish_data(&["rules"]);
    wait_until("reglen nåede kataloget", || {
        a.backend.suggestions(date(20)).unwrap().is_empty()
    });
}

#[test]
fn domaener_aendret_paa_web_naar_kataloget_uden_genstart() {
    let mock = MockWeb::start("tok-test");
    let c = web_client(&mock, &[]);
    let a = Device::new(&mock, "tok-test", &[20], "bageriet.dk");
    assert!(a.backend.suggestions(date(20)).unwrap().is_empty());
    block_on(mock.repo().update_client(
        &c.id,
        td::ClientPatch {
            domains: Some(vec!["bageriet.dk".into()]),
            ..Default::default()
        },
    ))
    .unwrap();
    mock.publish_data(&["clients"]);
    wait_until("domænet nåede kataloget", || {
        a.backend.suggestions(date(20)).unwrap().len() == 1
    });
    let s = a.backend.suggestions(date(20)).unwrap();
    assert_eq!(s[0].customer_id.as_deref(), Some(c.id.as_str()));
}
