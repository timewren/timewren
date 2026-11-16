use std::path::{Path, PathBuf};

use chrono::{Local, NaiveDate, TimeZone};

use super::*;
use crate::backend::services::Detection as _;
use crate::backend::{Customer, Project, ProjectStatus};

const SCHEMA: &str = include_str!("../schema-0.2.sql");
const FIXTURE: &str = include_str!("../fixture-laering-0.2.sql");
const LOGGED_IN: &str =
    "INSERT INTO settings (key, value) VALUES ('sync_email', 'test@example.invalid');";

fn device() -> tt_data::DeviceInfo {
    tt_data::DeviceInfo {
        device_id: "test".into(),
        device_name: "test".into(),
        os: "macos".into(),
        app_version: "0.2.25".into(),
    }
}

/// En gammel 0.2-mappe med læring (og `extra_sql` oveni).
fn old_dir(extra_sql: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let c = Connection::open(dir.path().join("timetrack.db")).unwrap();
    c.pragma_update(None, "journal_mode", "WAL").unwrap();
    c.execute_batch(SCHEMA).unwrap();
    c.execute_batch(FIXTURE).unwrap();
    c.execute_batch(extra_sql).unwrap();
    dir
}

/// En aktivitet i 0.2 (RFC 3339 i UTC, som 0.2's tracker skrev den).
#[allow(clippy::too_many_arguments)]
fn activity(
    app: &str,
    title: &str,
    url: Option<&str>,
    start: DateTime<Utc>,
    minutes: i64,
    confirmed: bool,
    project: Option<&str>,
    idle: bool,
) -> String {
    let q = |v: Option<&str>| v.map_or("NULL".to_string(), |v| format!("'{v}'"));
    let end = start + Duration::minutes(minutes);
    format!(
        "INSERT INTO activities (app_name, window_title, url, started_at, ended_at, duration, is_confirmed, project_id, is_idle) \
         VALUES ('{app}', '{title}', {}, '{}', '{}', {}, {}, {}, {});",
        q(url),
        start.to_rfc3339(),
        end.to_rfc3339(),
        minutes * 60,
        i32::from(confirmed),
        q(project),
        i32::from(idle),
    )
}

fn det(new: &Path) -> PathBuf {
    new.join(DETECTION_DIR)
}

fn learning(new: &Path) -> LocalLearning {
    serde_json::from_slice(&std::fs::read(det(new).join(state::LOCAL_LEARNING)).unwrap()).unwrap()
}

fn pattern_store(new: &Path) -> mm::PatternStore {
    serde_json::from_slice(&std::fs::read(det(new).join("patterns.json")).unwrap()).unwrap()
}

fn store(new: &Path) -> tr::ActivityStore {
    tr::ActivityStore::open(&det(new).join("activity.db")).unwrap()
}

fn all_segments(new: &Path) -> Vec<tr::ActivitySegment> {
    store(new)
        .segments_between(
            Utc::now() - Duration::days(365),
            Utc::now() + Duration::days(1),
            true,
        )
        .unwrap()
}

fn shop() -> mm::Target {
    mm::Target::project(Some("web-kunde-bager"), "web-proj-shop")
}

fn bager() -> mm::Target {
    mm::Target::client("web-kunde-bager")
}

/// Kør som ved opstart: først den gamle migrering, så læringen.
fn start(old: &Path, new: &Path, now: DateTime<Utc>) -> LaeringReport {
    let first = crate::migrate::run_once(old, new, device());
    assert!(first.error.is_none(), "{first:?}");
    run_at(old, new, device(), now)
}

#[test]
fn logget_ind_flytter_bindinger_regler_moenstre_og_eksklusioner_med_webs_id() {
    let old = old_dir(LOGGED_IN);
    let new = tempfile::tempdir().unwrap();
    let r = start(old.path(), new.path(), Utc::now());
    // Den gamle markør fandtes allerede (brugeren er migreret til 0.2.23/24).
    assert!(new.path().join(crate::migrate::MARKER).is_file());
    assert!(r.error.is_none(), "{r:?}");
    assert!(r.found && r.was_logged_in);
    assert_eq!(
        r.in_old,
        Counts {
            identities: 7,
            rules: 7,
            patterns: 4,
            exclusions: 5,
            segments: 0
        }
    );
    assert_eq!(
        r.moved,
        Counts {
            identities: 5,
            rules: 3,
            patterns: 2,
            exclusions: 3,
            segments: 0
        }
    );
    // Binding 4 + regel 7 + mønster 4 (p-lokal uden remote_id).
    assert_eq!(r.skipped.unmapped_target, 3);
    assert_eq!(r.skipped.unknown_kind, 1);
    assert_eq!(r.skipped.regex_rules, 1);
    assert_eq!(r.skipped.inactive, 2);
    assert_eq!(r.skipped.rules_without_target, 1);
    assert_eq!(r.skipped.patterns_without_key, 1);
    assert_eq!(r.skipped.invalid_exclusions, 1);
    assert_eq!(r.skipped.already_in_app, 0);

    let l = learning(new.path());
    assert!(l.identities.contains(&mm::IdentityBinding {
        kind: mm::IdentityKind::Domain,
        value: "ovnen.example".into(),
        app: None,
        target: Some(shop()),
    }));
    // "Ikke arbejde" flyttes altid.
    assert!(l.identities.contains(&mm::IdentityBinding {
        kind: mm::IdentityKind::Domain,
        value: "nyheder.ovnen.example".into(),
        app: None,
        target: None,
    }));
    assert!(l.identities.contains(&mm::IdentityBinding {
        kind: mm::IdentityKind::AppKeyword,
        value: "kagekatalog".into(),
        app: None,
        target: Some(bager()),
    }));
    assert!(!l.identities.iter().any(|b| b.value.contains("andet")));
    let has_rule = |field, op, value: &str, target: Option<mm::Target>| {
        l.rules
            .iter()
            .any(|r| r.field == field && r.op == op && r.value == value && r.target == target)
    };
    use mm::{RuleField as F, RuleOp as O};
    assert!(has_rule(F::App, O::Equals, "Figma", Some(shop())));
    assert!(has_rule(
        F::Title,
        O::Contains,
        "bestillinger",
        Some(bager())
    ));
    assert!(has_rule(F::App, O::Equals, "Kassesystem", Some(shop())));
    // Repo-navnet "webshop" rammer remote'n og mappen.
    assert!(has_rule(F::Repo, O::Glob, "*/webshop", Some(shop())));
    assert!(has_rule(F::Path, O::Glob, "*/webshop/*", Some(shop())));
    assert!(has_rule(F::Repo, O::Glob, "*/webs*", Some(shop())));
    assert!(
        !l.rules
            .iter()
            .any(|r| r.value.contains("x\\.example") || r.value == "Mail" || r.value == "Noter")
    );

    // Mønstrene ligger under matcherens egne nøgler og giver et træf.
    let p = pattern_store(new.path());
    let code = mm::ActivitySegment {
        app: "Code".into(),
        title: "lib.rs — kagesider".into(),
        repo_remote: Some("git@github.com:eksempel/kagesider.git".into()),
        start: 0,
        end: 600,
        ..Default::default()
    };
    let hit = p.lookup(&code).expect("repo-mønsteret");
    assert_eq!(hit.target, shop());
    assert_eq!(hit.confirmations, 4);
    let admin = mm::ActivitySegment {
        app: "Safari".into(),
        title: "Ordrer".into(),
        url: Some("https://admin.bageriet.example/ordrer/7".into()),
        start: 0,
        end: 600,
        ..Default::default()
    };
    assert_eq!(p.lookup(&admin).unwrap().target, bager());

    // Eksklusionerne ligger i trackerens tabel.
    let ex = store(new.path()).active_exclusion_rules().unwrap();
    assert_eq!(ex.len(), 3);
    assert!(ex.contains(&tr::ExclusionRule::new(
        "url",
        "regex",
        "^https://bank\\.example"
    )));

    // Den gamle markør er urørt og læringens egen er skrevet.
    let saved: LaeringReport =
        serde_json::from_str(&std::fs::read_to_string(new.path().join(MARKER)).unwrap()).unwrap();
    assert_eq!(saved, r);
}

#[test]
fn lokal_tilstand_oversaetter_id_paa_navnene_i_local_db() {
    let old = old_dir("");
    let new = tempfile::tempdir().unwrap();
    let r = start(old.path(), new.path(), Utc::now());
    assert!(r.error.is_none(), "{r:?}");
    assert!(!r.was_logged_in);
    let repo = LocalRepo::open(new.path().join("local.db"), device()).unwrap();
    let clients = block_on(repo.list_clients(true)).unwrap();
    let projects = block_on(repo.list_projects(true)).unwrap();
    let id_of = |name: &str| clients.iter().find(|c| c.name == name).unwrap().id.clone();
    let proj_of = |name: &str| projects.iter().find(|p| p.name == name).unwrap().id.clone();
    let shop = mm::Target::project(Some(&id_of("Bageriet")), &proj_of("Webshop"));
    let lokal = mm::Target::project(Some(&id_of("Andet ApS")), &proj_of("Lokalt"));

    // Bindinger og regler kom ind i local.db med den første migrering; kun
    // repo-navnene (som den ikke kunne udtrykke) kommer i læringsfilen.
    // Bindinger 1, 2, 4-7 og regler 1, 2, 6, 7.
    assert_eq!(r.skipped.already_in_app, 6 + 4);
    assert_eq!(r.moved.identities, 1);
    assert_eq!(r.moved.rules, 1);
    let l = learning(new.path());
    assert!(l.identities.is_empty());
    assert!(
        l.rules.iter().all(|r| r.target.as_ref() == Some(&shop)),
        "{l:?}"
    );
    assert!(l.rules.iter().any(|r| r.value == "*/webshop"));

    // Alle tre mønstre med mål kan oversættes lokalt.
    assert_eq!(r.moved.patterns, 3);
    assert_eq!(r.skipped.unmapped_target, 0);
    let p = pattern_store(new.path());
    let andet = mm::ActivitySegment {
        app: "Code".into(),
        title: "lib.rs".into(),
        path: Some("/Users/test/dev/kunder/andet/app/src".into()),
        start: 0,
        end: 600,
        ..Default::default()
    };
    assert_eq!(p.lookup(&andet).unwrap().target, lokal);
}

#[test]
fn to_koersler_giver_samme_resultat_uden_dubletter() {
    let now = Utc::now();
    let old = old_dir(&format!(
        "{LOGGED_IN}{}",
        activity(
            "Safari",
            "Kurv",
            Some("https://bageriet.example/kurv?x=1"),
            now - Duration::hours(30),
            20,
            true,
            Some("p-shop"),
            false
        )
    ));
    let new = tempfile::tempdir().unwrap();
    let first = start(old.path(), new.path(), now);
    let files = |dir: &Path| {
        ["laering-0.2.json", "patterns.json", "handled.json"]
            .map(|f| std::fs::read(det(dir).join(f)).unwrap())
    };
    let after_first = files(new.path());
    let segments = all_segments(new.path());
    assert_eq!(segments.len(), 1);
    // Forespørgslen er væk (privatliv, som trackeren selv gør).
    assert_eq!(
        segments[0].url.as_deref(),
        Some("https://bageriet.example/kurv")
    );
    assert_eq!(segments[0].domain.as_deref(), Some("bageriet.example"));

    // Med markøren: intet sker.
    assert_eq!(run_at(old.path(), new.path(), device(), now), first);
    // Uden markøren: alt findes allerede.
    std::fs::remove_file(new.path().join(MARKER)).unwrap();
    let again = run_at(old.path(), new.path(), device(), now);
    assert!(again.error.is_none(), "{again:?}");
    assert_eq!(files(new.path()), after_first);
    assert_eq!(all_segments(new.path()).len(), 1);
    assert_eq!(again.skipped.overlapping_activity, 1);
    assert_eq!(again.handled_spans, 0);
    assert_eq!(store(new.path()).active_exclusion_rules().unwrap().len(), 3);
}

#[test]
fn eksisterende_moenstre_og_synk_bevares_og_stemmer_laegges_ikke_oven_i() {
    let old = old_dir(LOGGED_IN);
    let new = tempfile::tempdir().unwrap();
    let key = mm::PatternKey::Repo {
        remote: "github.com/eksempel/kagesider".into(),
    };
    let other = mm::PatternKey::Domain {
        domain: "andet.example".into(),
    };
    let existing = serde_json::json!({
        "patterns": [
            { "key": key, "votes": [{ "target": shop(), "weight": 7.0, "confirmations": 7 }] },
            { "key": other, "votes": [{ "target": bager(), "weight": 1.0, "confirmations": 1 }] }
        ],
        "sync": { "noget": "fra web" }
    });
    std::fs::create_dir_all(det(new.path())).unwrap();
    std::fs::write(det(new.path()).join("patterns.json"), existing.to_string()).unwrap();
    let r = start(old.path(), new.path(), Utc::now());
    assert!(r.error.is_none(), "{r:?}");
    let raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(det(new.path()).join("patterns.json")).unwrap())
            .unwrap();
    assert_eq!(raw["sync"]["noget"], "fra web");
    let p = pattern_store(new.path());
    let vote =
        |k: &mm::PatternKey| p.patterns.iter().find(|x| &x.key == k).unwrap().votes[0].clone();
    // Den nye app havde mere end 0.2 (4): uændret.
    assert_eq!(vote(&key).weight, 7.0);
    assert_eq!(vote(&key).confirmations, 7);
    assert_eq!(vote(&other).confirmations, 1);
}

#[test]
fn aktivitet_aeldre_end_retention_og_overlap_springes_over() {
    let now = Utc::now();
    let mut sql = LOGGED_IN.to_string();
    // Ny: bekræftet og ubekræftet; gammel (> 14 dage); overlapper; idle.
    sql += &activity(
        "Safari",
        "Kurv",
        Some("https://bageriet.example/kurv"),
        now - Duration::hours(30),
        20,
        true,
        Some("p-shop"),
        false,
    );
    sql += &activity(
        "Code",
        "main.rs",
        None,
        now - Duration::hours(28),
        30,
        false,
        None,
        false,
    );
    sql += &activity(
        "Safari",
        "Gammelt",
        None,
        now - Duration::days(20),
        30,
        true,
        Some("p-shop"),
        false,
    );
    sql += &activity(
        "Safari",
        "Overlap",
        None,
        now - Duration::hours(5),
        60,
        true,
        Some("p-shop"),
        false,
    );
    sql += &activity(
        "Idle",
        "",
        None,
        now - Duration::hours(26),
        10,
        true,
        Some("p-shop"),
        true,
    );
    let old = old_dir(&sql);
    let new = tempfile::tempdir().unwrap();
    // Den nye app har sporet i fire timer siden opgraderingen.
    let tracked = tr::ActivitySegment {
        id: None,
        app: "Code".into(),
        app_id: "code".into(),
        title: "nyt".into(),
        url: None,
        domain: None,
        repo_remote: None,
        repo_root: None,
        branch: None,
        path: None,
        document: None,
        start: now - Duration::hours(4) - Duration::minutes(30),
        end: now,
        idle: false,
    };
    store(new.path()).insert(&tracked).unwrap();

    let r = start(old.path(), new.path(), now);
    assert!(r.error.is_none(), "{r:?}");
    assert_eq!(r.in_old.segments, 5);
    assert_eq!(r.moved.segments, 3);
    assert_eq!(r.skipped.old_activity, 1);
    assert_eq!(r.skipped.overlapping_activity, 1);
    let segs = all_segments(new.path());
    assert_eq!(segs.len(), 4);
    assert!(segs.iter().any(|s| s.title == "nyt"));
    assert!(segs.iter().any(|s| s.idle && s.app == "Idle"));
    assert!(
        !segs
            .iter()
            .any(|s| s.title == "Gammelt" || s.title == "Overlap")
    );

    // Kun den bekræftede, ikke-idle aktivitet bliver afgjort.
    assert_eq!(r.handled_spans, 1);
    let start_ts = (now - Duration::hours(30)).timestamp();
    let mut warnings = vec![];
    let handled = state::HandledStore::load(
        det(new.path()).join("handled.json"),
        now.timestamp(),
        &mut warnings,
    );
    assert_eq!(handled.spans(), vec![(start_ts, start_ts + 20 * 60)]);
    assert_eq!(handled.all()[0].kind, Handling::Confirmed);
}

#[test]
fn retention_foelger_de_nye_indstillinger() {
    let now = Utc::now();
    let mut sql = LOGGED_IN.to_string();
    sql += &activity(
        "Safari",
        "Ti dage",
        None,
        now - Duration::days(10),
        20,
        false,
        None,
        false,
    );
    sql += &activity(
        "Safari",
        "To dage",
        None,
        now - Duration::days(2),
        20,
        false,
        None,
        false,
    );
    let old = old_dir(&sql);
    let new = tempfile::tempdir().unwrap();
    let mut s = crate::backend::Settings::defaults();
    s.tracking.retention_days = 7;
    crate::backend::repo::files::store_settings(new.path(), &s).unwrap();
    let r = start(old.path(), new.path(), now);
    assert_eq!(r.moved.segments, 1);
    assert_eq!(r.skipped.old_activity, 1);
    assert_eq!(all_segments(new.path())[0].title, "To dage");
}

#[test]
fn undtaget_aktivitet_flyttes_ikke() {
    let now = Utc::now();
    let mut sql = LOGGED_IN.to_string();
    let t0 = now - Duration::days(1);
    sql += &activity("Signal", "Chat", None, t0, 10, false, None, false);
    sql += &activity("Safari", "Mit Privat budget", None, t0 + Duration::minutes(15), 10, false, None, false);
    sql += &activity("Safari", "Konto", Some("https://netbank.example/konto"), t0 + Duration::minutes(30), 10, false, None, false);
    sql += &activity("Safari", "Ordre", Some("https://bageriet.example/ordre"), t0 + Duration::minutes(45), 10, false, None, false);
    let old = old_dir(&sql);
    let new = tempfile::tempdir().unwrap();
    let mut s = crate::backend::Settings::defaults();
    s.tracking.excluded_apps = vec!["Signal".into()];
    s.tracking.excluded_titles = vec!["privat".into()];
    s.tracking.excluded_domains = vec!["netbank.example".into()];
    crate::backend::repo::files::store_settings(new.path(), &s).unwrap();
    let r = start(old.path(), new.path(), now);
    assert_eq!(r.skipped.excluded_activity, 3, "{r:?}");
    let titles: Vec<_> = all_segments(new.path()).into_iter().map(|x| x.title).collect();
    assert_eq!(titles, vec!["Ordre".to_string()]);
}

#[test]
fn ingen_gammel_app_skriver_markoeren_og_intet_andet() {
    let old = tempfile::tempdir().unwrap();
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(!r.found);
    assert!(new.path().join(MARKER).is_file());
    assert!(!det(new.path()).exists());
}

#[test]
fn den_gamle_mappe_roeres_ikke() {
    let old = old_dir(LOGGED_IN);
    let before: Vec<_> = std::fs::read_dir(old.path())
        .unwrap()
        .flatten()
        .map(|e| (e.file_name(), std::fs::read(e.path()).unwrap()))
        .collect();
    let new = tempfile::tempdir().unwrap();
    run_once(old.path(), new.path(), device());
    for (name, bytes) in before {
        assert_eq!(
            std::fs::read(old.path().join(&name)).unwrap(),
            bytes,
            "{name:?}"
        );
    }
}

#[test]
fn en_oedelagt_laeringsfil_giver_fejl_og_nyt_forsoeg_uden_markoer() {
    let old = old_dir(LOGGED_IN);
    let new = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(det(new.path())).unwrap();
    std::fs::write(det(new.path()).join(state::LOCAL_LEARNING), b"{ikke json").unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(r.error.is_some());
    assert!(!new.path().join(MARKER).exists());
}

#[test]
fn windows_bruger_localappdata_naar_appdata_ingen_database_har() {
    let roaming = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    let pick = || {
        crate::migrate::pick_old_dir(
            Some(roaming.path().to_path_buf()),
            Some(local.path().to_path_buf()),
        )
    };
    assert_eq!(pick(), Some(roaming.path().to_path_buf()));
    std::fs::write(local.path().join("timetrack.db"), b"").unwrap();
    assert_eq!(pick(), Some(local.path().to_path_buf()));
    std::fs::write(roaming.path().join("timetrack.db"), b"").unwrap();
    assert_eq!(pick(), Some(roaming.path().to_path_buf()));
}

// ---------------------------------------------------------------- ende til ende

fn customers() -> Vec<Customer> {
    vec![Customer {
        id: "web-kunde-bager".into(),
        name: "Bageriet".into(),
        email: None,
        hourly_rate: None,
        archived: false,
        cvr: None,
        ..Default::default()
    }]
}

fn projects() -> Vec<Project> {
    vec![Project {
        id: "web-proj-shop".into(),
        customer_id: "web-kunde-bager".into(),
        name: "Webshop".into(),
        status: ProjectStatus::Active,
        hourly_rate: None,
        budget_minutes: None,
        url_patterns: vec![],
    }]
}

fn at(date: NaiveDate, h: u32) -> DateTime<Utc> {
    Local
        .from_local_datetime(&date.and_hms_opt(h, 0, 0).unwrap())
        .earliest()
        .unwrap()
        .with_timezone(&Utc)
}

fn browser(date: NaiveDate, from: u32, to: u32, url: &str) -> tr::ActivitySegment {
    tr::ActivitySegment {
        id: None,
        app: "Firefox".into(),
        app_id: "firefox".into(),
        title: "Side".into(),
        domain: tr::url::domain_of(url),
        url: Some(url.into()),
        repo_remote: None,
        repo_root: None,
        branch: None,
        path: None,
        document: None,
        start: at(date, from),
        end: at(date, to),
        idle: false,
    }
}

#[test]
fn motoren_foreslaar_den_rigtige_kunde_ud_fra_den_flyttede_binding_og_moenster() {
    let old = old_dir(LOGGED_IN);
    let new = tempfile::tempdir().unwrap();
    let r = start(old.path(), new.path(), Utc::now());
    assert!(r.error.is_none(), "{r:?}");
    let day = (Utc::now() - Duration::days(3))
        .with_timezone(&Local)
        .date_naive();
    let s = store(new.path());
    // Bindingen: ovnen.example (navnet "Bageriet" står ikke i den) → Bageriet / Webshop.
    s.insert(&browser(day, 9, 10, "https://ovnen.example/kurv"))
        .unwrap();
    // "Ikke arbejde" på et underdomæne: ellers ville ovnen.example give Bageriet.
    s.insert(&browser(
        day,
        11,
        12,
        "https://nyheder.ovnen.example/forside",
    ))
    .unwrap();
    // Mønsteret (repoet bekræftet fire gange i 0.2), uden bindinger at falde på.
    s.insert(&tr::ActivitySegment {
        app: "Zed".into(),
        app_id: "zed".into(),
        title: "lib.rs".into(),
        url: None,
        domain: None,
        repo_remote: Some("github.com/eksempel/kagesider".into()),
        start: at(day, 14),
        end: at(day, 15),
        ..browser(day, 14, 15, "https://x.invalid")
    })
    .unwrap();
    drop(s);

    let engine = crate::engine::Engine::new(det(new.path()), None);
    assert!(engine.warnings().is_empty(), "{:?}", engine.warnings());
    let out = engine.suggestions(day, &customers(), &projects()).unwrap();
    let morning = out
        .iter()
        .find(|x| x.start == at(day, 9).with_timezone(&Local).time())
        .expect("forslag kl. 9");
    assert_eq!(morning.customer_id.as_deref(), Some("web-kunde-bager"));
    assert_eq!(morning.project_id.as_deref(), Some("web-proj-shop"));
    assert!(
        !out.iter()
            .any(|x| x.start == at(day, 11).with_timezone(&Local).time()),
        "ikke arbejde må ikke foreslås: {out:?}"
    );
    let afternoon = out
        .iter()
        .find(|x| x.start == at(day, 14).with_timezone(&Local).time())
        .expect("forslag kl. 14");
    assert_eq!(afternoon.customer_id.as_deref(), Some("web-kunde-bager"));
    assert_eq!(afternoon.project_id.as_deref(), Some("web-proj-shop"));
}
