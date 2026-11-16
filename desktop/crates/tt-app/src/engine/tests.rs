//! Motoren uden OS: aktivitet skrives i en `ActivityStore` i en midlertidig
//! mappe (eller afspilles med `ScriptedPlatform`), og `Detection` bruges som
//! RepoBackend bruger den.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone, Utc};
use tt_ai as tai;
use tt_ai::SecretStore as _;
use tt_tracker as tr;
use tt_tracker::testing::{Frame, ScriptedPlatform};

use super::ai::fakes::FakeProvider;
use super::*;
use crate::backend::{AiSettings, ProjectStatus};

/// Uden AI virker alt: hentning og indlæsning, der fejler.
mod uden_ai;
/// Aktivitet: blokke og handlinger (0.2.25).
mod aktivitet;
/// Observatøren, manuelle valg, gren → opgave og eksporten.
mod observatoer;

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 20).unwrap()
}

fn other_day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 21).unwrap()
}

fn at(date: NaiveDate, h: u32, m: u32) -> DateTime<Utc> {
    Local
        .from_local_datetime(&date.and_hms_opt(h, m, 0).unwrap())
        .earliest()
        .unwrap()
        .with_timezone(&Utc)
}

fn time(h: u32, m: u32) -> NaiveTime {
    NaiveTime::from_hms_opt(h, m, 0).unwrap()
}

fn customer(id: &str, name: &str) -> Customer {
    Customer {
        id: id.into(),
        name: name.into(),
        email: None,
        hourly_rate: None,
        archived: false,
        cvr: None,
        ..Default::default()
    }
}

fn project(id: &str, customer_id: &str, name: &str, patterns: &[&str]) -> Project {
    Project {
        id: id.into(),
        customer_id: customer_id.into(),
        name: name.into(),
        status: ProjectStatus::Active,
        hourly_rate: None,
        budget_minutes: None,
        url_patterns: patterns.iter().map(|p| p.to_string()).collect(),
    }
}

fn customers() -> Vec<Customer> {
    vec![customer("k_alfa", "Alfa"), customer("k_beta", "Beta")]
}

fn projects() -> Vec<Project> {
    vec![
        project("p_webshop", "k_alfa", "Webshop", &["*alfa-shop.dk*"]),
        project("p_drift", "k_beta", "Drift", &[]),
    ]
}

/// Et browsersegment på `date` fra `from` til `to`.
fn browser(
    date: NaiveDate,
    from: (u32, u32),
    to: (u32, u32),
    title: &str,
    domain: &str,
) -> tr::ActivitySegment {
    tr::ActivitySegment {
        id: None,
        app: "Google Chrome".into(),
        app_id: "google chrome".into(),
        title: title.into(),
        url: Some(format!("https://{domain}/side")),
        domain: Some(domain.into()),
        repo_remote: None,
        repo_root: None,
        branch: None,
        path: None,
        document: None,
        start: at(date, from.0, from.1),
        end: at(date, to.0, to.1),
        idle: false,
    }
}

fn put(dir: &Path, segments: &[tr::ActivitySegment]) {
    let store = tr::ActivityStore::open(&dir.join("activity.db")).unwrap();
    for s in segments {
        store.insert(s).unwrap();
    }
}

fn engine(dir: &Path) -> Engine {
    Engine::new(dir.to_path_buf(), None).with_secrets(Arc::new(tai::MemorySecrets::default()))
}

fn suggest(e: &Engine, date: NaiveDate) -> Vec<Suggestion> {
    e.suggestions(date, &customers(), &projects()).unwrap()
}

fn correction_to(customer: &str) -> SuggestionCorrection {
    SuggestionCorrection {
        customer_id: Some(customer.into()),
        ..Default::default()
    }
}

fn settings(mode: AiMode) -> Settings {
    let mut s = Settings::defaults();
    s.ai = AiSettings {
        mode,
        builtin_model: None,
        local_server: None,
        local_model: None,
        cloud_provider: None,
        cloud_keys: vec![],
    };
    s
}

// ---------- forslag ----------

#[test]
fn a_days_activity_becomes_a_suggestion_for_the_right_customer_in_local_time() {
    let dir = tempfile::tempdir().unwrap();
    let mut seg = browser(day(), (9, 0), (10, 15), "Ordrer", "alfa-shop.dk");
    seg.id = None;
    put(dir.path(), &[seg]);
    let e = engine(dir.path());
    let s = suggest(&e, day());
    assert_eq!(s.len(), 1, "{s:?}");
    assert_eq!(s[0].customer_id.as_deref(), Some("k_alfa"));
    assert_eq!(s[0].project_id.as_deref(), Some("p_webshop"));
    assert_eq!((s[0].start, s[0].end), (time(9, 0), time(10, 15)));
    assert_eq!(s[0].date, day());
    assert_eq!(s[0].minutes(), 75);
    assert!(!s[0].reason.is_empty());
    assert!(s[0].confidence > 0.5);
    // Samme dag igen: samme id. En anden dag: intet.
    assert_eq!(suggest(&e, day())[0].id, s[0].id);
    assert!(suggest(&e, other_day()).is_empty());
}

#[test]
fn idle_time_never_becomes_a_suggestion() {
    let dir = tempfile::tempdir().unwrap();
    let mut idle = browser(day(), (9, 0), (10, 0), "Ordrer", "alfa-shop.dk");
    idle.idle = true;
    put(dir.path(), &[idle]);
    assert!(suggest(&engine(dir.path()), day()).is_empty());
}

#[test]
fn unknown_activity_without_ai_shows_nothing() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[browser(
            day(),
            (9, 0),
            (10, 0),
            "Interessant artikel",
            "ukendt-sted.dk",
        )],
    );
    assert!(suggest(&engine(dir.path()), day()).is_empty());
}

#[test]
fn archived_customers_and_completed_projects_get_no_suggestions() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[browser(day(), (9, 0), (10, 0), "Ordrer", "alfa-shop.dk")],
    );
    let e = engine(dir.path());
    let mut done = projects();
    done[0].status = ProjectStatus::Completed;
    let s = e.suggestions(day(), &customers(), &done).unwrap();
    assert!(
        s.iter()
            .all(|s| s.project_id.as_deref() != Some("p_webshop")),
        "{s:?}"
    );
}

// ---------- entry_for ----------

#[test]
fn entry_for_builds_the_entry_and_applies_the_correction() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[browser(day(), (9, 0), (10, 30), "Ordrer", "alfa-shop.dk")],
    );
    let e = engine(dir.path());
    let id = suggest(&e, day())[0].id.clone();

    let plain = e.entry_for(&id, None).unwrap();
    assert_eq!(plain.customer_id, "k_alfa");
    assert_eq!(plain.project_id.as_deref(), Some("p_webshop"));
    assert_eq!(plain.date, day());
    assert_eq!(
        (plain.start, plain.end),
        (Some(time(9, 0)), Some(time(10, 30)))
    );
    assert_eq!(plain.minutes, 90);
    assert!(plain.billable);
    assert!(plain.description.is_empty());
    assert_eq!(plain.task_id, None);

    // Skifter kunden, arves projektet ikke.
    let to_beta = e.entry_for(&id, Some(&correction_to("k_beta"))).unwrap();
    assert_eq!(to_beta.customer_id, "k_beta");
    assert_eq!(to_beta.project_id, None);

    // Kunde og projekt, tider og beskrivelse.
    let full = SuggestionCorrection {
        customer_id: Some("k_beta".into()),
        project_id: Some("p_drift".into()),
        description: Some("Serverflyt".into()),
        start: Some(time(9, 30)),
        end: Some(time(10, 0)),
        ..Default::default()
    };
    let e2 = e.entry_for(&id, Some(&full)).unwrap();
    assert_eq!(e2.project_id.as_deref(), Some("p_drift"));
    assert_eq!(e2.description, "Serverflyt");
    assert_eq!(
        (e2.start, e2.end, e2.minutes),
        (Some(time(9, 30)), Some(time(10, 0)), 30)
    );

    // Kun tider: kunde og projekt bliver.
    let times = SuggestionCorrection {
        end: Some(time(10, 0)),
        ..Default::default()
    };
    let t = e.entry_for(&id, Some(&times)).unwrap();
    assert_eq!(t.project_id.as_deref(), Some("p_webshop"));
    assert_eq!(t.minutes, 60);

    // Ugyldig tid og ukendt forslag.
    let bad = SuggestionCorrection {
        start: Some(time(11, 0)),
        ..Default::default()
    };
    assert!(matches!(
        e.entry_for(&id, Some(&bad)),
        Err(BackendError::Validation(_))
    ));
    assert!(matches!(
        e.entry_for("fs_findes_ikke", None),
        Err(BackendError::NotFound(_))
    ));
}

#[test]
fn effective_target_rules() {
    let s = Suggestion {
        id: "x".into(),
        date: day(),
        start: time(9, 0),
        end: time(10, 0),
        customer_id: Some("k_alfa".into()),
        project_id: Some("p_webshop".into()),
        reason: String::new(),
        confidence: 0.8,
        task_id: None,
        task_title: None,
    };
    assert_eq!(
        effective_target(&s, None),
        ("k_alfa".into(), Some("p_webshop".into()))
    );
    let same_customer = correction_to("k_alfa");
    assert_eq!(
        effective_target(&s, Some(&same_customer)),
        ("k_alfa".into(), Some("p_webshop".into()))
    );
    assert_eq!(
        effective_target(&s, Some(&correction_to("k_beta"))),
        ("k_beta".into(), None)
    );
    // Fra den fælles mål-vælger: "Uden projekt" på samme kunde gælder.
    let explicit = SuggestionCorrection { target_explicit: true, ..correction_to("k_alfa") };
    assert_eq!(effective_target(&s, Some(&explicit)), ("k_alfa".into(), None));
    let intern = SuggestionCorrection {
        customer_id: Some(String::new()),
        project_id: Some("p_admin".into()),
        target_explicit: true,
        ..Default::default()
    };
    assert_eq!(effective_target(&s, Some(&intern)), (String::new(), Some("p_admin".into())));
    let only_project = SuggestionCorrection {
        project_id: Some("p_andet".into()),
        ..Default::default()
    };
    assert_eq!(
        effective_target(&s, Some(&only_project)),
        ("k_alfa".into(), Some("p_andet".into()))
    );
}

// ---------- afvis og bekræft ----------

#[test]
fn reject_hides_the_suggestion_and_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[
            browser(day(), (9, 0), (10, 0), "Ordrer", "alfa-shop.dk"),
            browser(day(), (13, 0), (14, 0), "Ordrer", "alfa-shop.dk"),
        ],
    );
    let e = engine(dir.path());
    let all = suggest(&e, day());
    assert_eq!(all.len(), 2, "{all:?}");
    e.reject(&all[0].id).unwrap();
    let left = suggest(&e, day());
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].start, time(13, 0));
    // Afvist to gange er en fejl (forslaget er væk).
    assert!(matches!(
        e.reject(&all[0].id),
        Err(BackendError::NotFound(_))
    ));

    let restarted = engine(dir.path());
    let after = suggest(&restarted, day());
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].start, time(13, 0));
}

#[test]
fn confirmed_suggestions_are_filtered_out_even_with_a_correction() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[
            browser(day(), (9, 0), (10, 0), "Ordrer", "alfa-shop.dk"),
            browser(day(), (13, 0), (14, 0), "Ordrer", "alfa-shop.dk"),
        ],
    );
    let e = engine(dir.path());
    let all = suggest(&e, day());
    // Bekræft den første som den er, ret den anden til Beta.
    e.confirmed(&all[0].id, None, "entry-1");
    e.confirmed(&all[1].id, Some(&correction_to("k_beta")), "entry-2");
    // Intet kommer igen, heller ikke under en anden kunde (mønstrene har
    // flyttet blokken, men tidsrummet er afgjort).
    assert!(suggest(&e, day()).is_empty());
    assert!(suggest(&engine(dir.path()), day()).is_empty());
}

#[test]
fn only_the_undecided_part_of_a_growing_block_comes_back() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[browser(day(), (9, 0), (10, 0), "Ordrer", "alfa-shop.dk")],
    );
    let e = engine(dir.path());
    let first = suggest(&e, day());
    e.reject(&first[0].id).unwrap();
    // Brugeren bliver ved på samme side: blokken vokser til 11:00.
    put(
        dir.path(),
        &[browser(day(), (10, 0), (11, 0), "Ordrer", "alfa-shop.dk")],
    );
    let s = suggest(&e, day());
    assert_eq!(s.len(), 1, "{s:?}");
    assert_eq!((s[0].start, s[0].end), (time(10, 0), time(11, 0)));
}

#[test]
fn a_correction_teaches_the_next_day_and_the_lesson_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    // Dag 1: titlen nævner Alfa, men siden hører til Beta.
    put(
        dir.path(),
        &[browser(
            day(),
            (9, 0),
            (10, 0),
            "Notat om Alfa",
            "tilbud-tool.dk",
        )],
    );
    let e = engine(dir.path());
    let first = suggest(&e, day());
    assert_eq!(first.len(), 1, "{first:?}");
    assert_eq!(first[0].customer_id.as_deref(), Some("k_alfa"), "uden læring gætter navnet");
    let entry = e
        .entry_for(&first[0].id, Some(&correction_to("k_beta")))
        .unwrap();
    assert_eq!(entry.customer_id, "k_beta");
    e.confirmed(&first[0].id, Some(&correction_to("k_beta")), "entry-1");
    assert!(dir.path().join("patterns.json").exists());

    // Dag 2: samme side, andet navn i titlen.
    put(
        dir.path(),
        &[browser(
            other_day(),
            (9, 0),
            (10, 0),
            "Notat om Alfa igen",
            "tilbud-tool.dk",
        )],
    );
    let learned = suggest(&e, other_day());
    assert_eq!(learned.len(), 1, "{learned:?}");
    assert_eq!(learned[0].customer_id.as_deref(), Some("k_beta"));

    // En ny motor på samme mappe husker det.
    let restarted = engine(dir.path());
    let again = suggest(&restarted, other_day());
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].customer_id.as_deref(), Some("k_beta"));
}

#[test]
fn confirming_without_a_change_reinforces_and_saves_patterns() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[browser(
            day(),
            (9, 0),
            (10, 0),
            "Notat om Alfa",
            "tilbud-tool.dk",
        )],
    );
    let e = engine(dir.path());
    let s = suggest(&e, day());
    assert!(!dir.path().join("patterns.json").exists());
    e.confirmed(&s[0].id, None, "entry-1");
    let saved: tt_matcher::PatternStore =
        serde_json::from_slice(&std::fs::read(dir.path().join("patterns.json")).unwrap()).unwrap();
    assert!(!saved.patterns.is_empty());
    // Gemt uden hele titler (privatliv): ingen "Notat om Alfa".
    let text = serde_json::to_string(&saved).unwrap();
    assert!(!text.contains("Notat om Alfa"), "{text}");
}

#[test]
fn corrupt_state_is_kept_aside_with_a_warning() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("patterns.json"), b"{ikke json").unwrap();
    let e = engine(dir.path());
    let w = e.warnings();
    assert_eq!(w.len(), 1, "{w:?}");
    assert!(w[0].contains("patterns.json"));
    assert!(
        std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains("korrupt"))
    );
}

// ---------- AI ----------

fn unclear_day(dir: &Path) {
    put(
        dir,
        &[browser(
            day(),
            (9, 0),
            (10, 0),
            "Interessant artikel",
            "ukendt-sted.dk",
        )],
    );
}

#[test]
fn ai_resolves_an_unclear_block_once_and_remembers_the_answer() {
    let dir = tempfile::tempdir().unwrap();
    unclear_day(dir.path());
    let e = engine(dir.path());
    let fake = FakeProvider::picking("k_beta", Some("p_drift"));
    e.set_ai_chain(Some(Arc::new(tai::ProviderChain::new(vec![fake.clone()]))));

    let s = suggest(&e, day());
    assert_eq!(s.len(), 1, "{s:?}");
    assert_eq!(s[0].customer_id.as_deref(), Some("k_beta"));
    assert_eq!(s[0].project_id.as_deref(), Some("p_drift"));
    assert!(s[0].reason.starts_with("AI:"), "{}", s[0].reason);
    assert!(s[0].confidence <= 0.70 + 1e-6);
    assert_eq!(fake.calls(), 1);
    // Kandidaterne er kunder og projekter, og udbyderen så titlen.
    let seen = fake.seen.lock().unwrap();
    assert_eq!(seen[0].0.title, "Interessant artikel");
    assert_eq!(seen[0].0.domain.as_deref(), Some("ukendt-sted.dk"));
    assert!(seen[0].1.len() >= 4);
    drop(seen);

    // Igen: ingen nye kald (mønster eller kædens cache).
    assert_eq!(suggest(&e, day())[0].customer_id.as_deref(), Some("k_beta"));
    assert_eq!(fake.calls(), 1);
    assert!(dir.path().join("ai").join("cache.json").exists());
}

#[test]
fn correcting_an_ai_answer_makes_the_chain_forget_it() {
    let dir = tempfile::tempdir().unwrap();
    unclear_day(dir.path());
    let e = engine(dir.path());
    let chain = Arc::new(tai::ProviderChain::new(vec![FakeProvider::picking(
        "k_beta", None,
    )]));
    e.set_ai_chain(Some(chain.clone()));
    let s = suggest(&e, day());
    assert_eq!(chain.cache_len(), 1);
    e.confirmed(&s[0].id, Some(&correction_to("k_alfa")), "entry-1");
    assert_eq!(chain.cache_len(), 0, "det rettede svar skal glemmes");
}

#[test]
fn confirming_an_ai_answer_keeps_it() {
    let dir = tempfile::tempdir().unwrap();
    unclear_day(dir.path());
    let e = engine(dir.path());
    let chain = Arc::new(tai::ProviderChain::new(vec![FakeProvider::picking(
        "k_beta", None,
    )]));
    e.set_ai_chain(Some(chain.clone()));
    let s = suggest(&e, day());
    e.confirmed(&s[0].id, None, "entry-1");
    assert_eq!(chain.cache_len(), 1);
}

#[test]
fn the_ai_time_budget_defers_questions_and_signals_a_reload() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[
            browser(day(), (9, 0), (10, 0), "Artikel et", "sted-et.dk"),
            browser(day(), (11, 0), (12, 0), "Artikel to", "sted-to.dk"),
        ],
    );
    let e = engine(dir.path()).with_ai_budget(Duration::from_secs(5), 1);
    let fake = FakeProvider::picking("k_beta", None);
    e.set_ai_chain(Some(Arc::new(tai::ProviderChain::new(vec![fake.clone()]))));
    let rx = e.changes().unwrap();

    assert_eq!(suggest(&e, day()).len(), 1);
    assert_eq!(fake.calls(), 1);
    assert!(rx.try_recv().is_ok(), "UI'et skal bede om en ny hentning");
    // Næste hentning tager resten.
    assert_eq!(suggest(&e, day()).len(), 2);
    assert_eq!(fake.calls(), 2);
}

#[test]
fn cloud_is_not_asked_unless_the_user_chose_it() {
    let dir = tempfile::tempdir().unwrap();
    unclear_day(dir.path());
    let e = engine(dir.path());
    let cloud = FakeProvider::cloud("k_beta");
    // Uden samtykke (kædens standard).
    e.set_ai_chain(Some(Arc::new(tai::ProviderChain::new(vec![cloud.clone()]))));
    assert!(suggest(&e, day()).is_empty());
    assert_eq!(cloud.calls(), 0);
}

#[test]
fn settings_decide_whether_a_cloud_chain_exists() {
    let dir = tempfile::tempdir().unwrap();
    let secrets = Arc::new(tai::MemorySecrets::default());
    let e = Engine::new(dir.path().to_path_buf(), None).with_secrets(secrets.clone());

    // Gem en nøgle via traitet, ligesom Indstillinger → AI gør.
    e.set_cloud_ai_key(CloudAiProvider::OpenAi, "  sk-test  ".into())
        .unwrap();
    assert_eq!(
        secrets
            .get(&tai::api_key_name(tai::ProviderKind::OpenAi))
            .unwrap()
            .as_deref(),
        Some("sk-test")
    );
    assert_eq!(e.cloud_keys(), vec![CloudAiProvider::OpenAi]);
    assert!(matches!(
        e.set_cloud_ai_key(CloudAiProvider::Gemini, "  ".into()),
        Err(BackendError::Validation(_))
    ));

    // Nøglen findes, men AI er slået fra eller lokal: ingen kæde.
    for mode in [AiMode::Off, AiMode::Builtin] {
        let mut s = settings(mode);
        s.tracking.enabled = false;
        s.ai.cloud_provider = Some(CloudAiProvider::OpenAi);
        e.apply_settings(&s);
        let chain = e.chain();
        assert!(
            chain.is_none_or(|c| c.providers().iter().all(|p| !p.sends_data_off_device)),
            "{mode:?}"
        );
    }

    // Cloud valgt: kæden har udbyderen, og samtykket er givet.
    let mut s = settings(AiMode::Cloud);
    s.tracking.enabled = false;
    s.ai.cloud_provider = Some(CloudAiProvider::OpenAi);
    e.apply_settings(&s);
    let chain = e.chain().expect("kæde");
    assert_eq!(chain.providers().len(), 1);
    assert!(chain.providers()[0].sends_data_off_device);
    assert!(chain.cloud_opt_in());

    // Nøglen fjernes: kæden bygges om uden udbyder.
    e.remove_cloud_ai_key(CloudAiProvider::OpenAi).unwrap();
    assert!(e.chain().is_none());
    assert!(e.cloud_keys().is_empty());
    assert!(
        e.warnings().iter().any(|w| w.contains("API-nøgle")),
        "{:?}",
        e.warnings()
    );

    // Slås AI fra igen: ingen kæde.
    e.apply_settings(&settings(AiMode::Off));
    assert!(e.chain().is_none());
}

#[test]
fn the_ai_cache_is_saved_when_the_chain_is_replaced() {
    let dir = tempfile::tempdir().unwrap();
    unclear_day(dir.path());
    let e = engine(dir.path());
    let fake = FakeProvider::picking("k_beta", None);
    e.set_ai_chain(Some(Arc::new(tai::ProviderChain::new(vec![fake]))));
    suggest(&e, day());
    // Nu slås AI fra (kæden gemmer cachen) og ... en ny motor ser filen.
    e.apply_settings(&settings(AiMode::Off));
    assert!(dir.path().join("ai").join("cache.json").exists());
}

/// En lille Ollama: `/api/tags` giver `models`, `/api/chat` noterer, hvilken
/// model der blev spurgt, og svarer "ingen passer".
struct MockOllama {
    server: Arc<tiny_http::Server>,
    asked: Arc<Mutex<Vec<String>>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl MockOllama {
    fn start(models: &[&str]) -> Self {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
        let asked = Arc::new(Mutex::new(Vec::new()));
        let tags = serde_json::json!({
            "models": models.iter().map(|m| serde_json::json!({"name": m})).collect::<Vec<_>>()
        })
        .to_string();
        let (s, a) = (server.clone(), asked.clone());
        let thread = std::thread::spawn(move || {
            for mut req in s.incoming_requests() {
                let body = if req.url() == "/api/tags" {
                    tags.clone()
                } else {
                    let mut text = String::new();
                    std::io::Read::read_to_string(req.as_reader(), &mut text).unwrap();
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                    a.lock().unwrap().push(v["model"].as_str().unwrap().to_string());
                    serde_json::json!({"message": {"content":
                        "{\"candidate\": null, \"confidence\": 0.1, \"reasoning\": \"usikker\"}"}})
                    .to_string()
                };
                let _ = req.respond(tiny_http::Response::from_string(body).with_header(
                    "Content-Type: application/json".parse::<tiny_http::Header>().unwrap(),
                ));
            }
        });
        Self {
            server,
            asked,
            thread: Some(thread),
        }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.server.server_addr().to_ip().unwrap().port())
    }
}

impl Drop for MockOllama {
    fn drop(&mut self) {
        self.server.unblock();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// En fil-server med Range, der svarer langsomt nok til, at en annullering
/// når at ramme midt i hentningen.
fn file_server(data: Arc<Vec<u8>>) -> (Arc<tiny_http::Server>, std::thread::JoinHandle<()>, String) {
    let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
    let url = format!(
        "http://127.0.0.1:{}",
        server.server_addr().to_ip().unwrap().port()
    );
    let s = server.clone();
    let thread = std::thread::spawn(move || {
        for req in s.incoming_requests() {
            let range = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Range"))
                .map(|h| h.value.to_string())
                .unwrap_or_default();
            let (a, b) = range
                .trim_start_matches("bytes=")
                .split_once('-')
                .map(|(a, b)| (a.parse::<usize>().unwrap(), b.parse::<usize>().unwrap()))
                .unwrap_or((0, data.len() - 1));
            std::thread::sleep(Duration::from_millis(40));
            let _ = req.respond(
                tiny_http::Response::from_data(data[a..=b].to_vec()).with_status_code(206),
            );
        }
    });
    (server, thread, url)
}

#[test]
fn a_model_download_reports_progress_can_be_cancelled_and_leaves_no_half_file() {
    let dir = tempfile::tempdir().unwrap();
    let models = dir.path().join("ai").join("models");
    std::fs::create_dir_all(&models).unwrap();
    let data: Arc<Vec<u8>> = Arc::new((0..2_000_000u32).map(|i| (i % 251) as u8).collect());
    let sha = {
        let p = dir.path().join("kilde.bin");
        std::fs::write(&p, &*data).unwrap();
        tai::models::sha256_file(&p, &AtomicBool::new(false)).unwrap()
    };
    let (server, thread, url) = file_server(data.clone());
    let spec = tai::ModelSpec {
        id: "stor".into(),
        name: "Testmodel".into(),
        description: "Kun til tests".into(),
        repo: "x/y".into(),
        revision: "abc".into(),
        file: "stor.gguf".into(),
        size_bytes: data.len() as u64,
        sha256: sha,
        license: "Apache-2.0".into(),
        license_url: "https://example.org".into(),
        license_note: None,
        min_ram_gb: 1,
    };
    let e = engine(dir.path());
    let e = Engine {
        models: tai::ModelManager::with_source(&models, &url, vec![spec])
            .with_chunking(200_000, Duration::from_secs(5)),
        ..e
    };
    assert!(e.model_progress("stor").is_none());

    // Første forsøg: annulleres, når der er kommet data.
    let first = std::thread::scope(|s| {
        let job = s.spawn(|| e.download_model("stor"));
        let started = Instant::now();
        loop {
            if e.model_progress("stor").is_some_and(|p| p.downloaded > 0) {
                break;
            }
            assert!(started.elapsed() < Duration::from_secs(10), "ingen fremskridt");
            std::thread::sleep(Duration::from_millis(5));
        }
        let p = e.model_progress("stor").unwrap();
        assert_eq!(p.total, 2_000_000);
        assert!(p.percent() < 100);
        e.cancel_model_download("stor");
        job.join().unwrap()
    });
    assert!(
        first.as_ref().is_err_and(|e| e.to_string().contains("annulleret")),
        "{first:?}"
    );
    assert!(e.model_progress("stor").is_none(), "hentningen er slut");
    let files: Vec<String> = std::fs::read_dir(&models)
        .unwrap()
        .map(|f| f.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".part") || n.ends_with(".gguf"))
        .collect();
    assert!(files.is_empty(), "halve filer: {files:?}");
    assert!(!e.ai_models().unwrap()[0].downloaded);

    // Nyt forsøg: hele filen kommer, den er korrekt, og modellen er klar.
    e.download_model("stor").unwrap();
    assert!(e.ai_models().unwrap()[0].downloaded);
    assert_eq!(std::fs::read(models.join("stor.gguf")).unwrap(), *data);

    server.unblock();
    thread.join().unwrap();
}

#[test]
fn the_chosen_model_on_a_local_server_is_used_and_remembered() {
    let dir = tempfile::tempdir().unwrap();
    unclear_day(dir.path());
    let mock = MockOllama::start(&["alfa:1b", "beta:3b"]);
    let e = engine(dir.path());
    // Motoren kender kun den ene model. Brugeren har hentet "beta:3b" siden.
    *lock(&e.servers) = vec![tai::DiscoveredServer {
        kind: tai::ProviderKind::Ollama,
        base_url: mock.url(),
        api_base_url: mock.url(),
        models: vec!["alfa:1b".into()],
        requires_auth: false,
    }];
    let mut s = settings(AiMode::LocalServer);
    s.ai.local_server = Some(mock.url());
    s.ai.local_model = Some("beta:3b".into());
    e.apply_settings(&s);
    assert!(e.warnings().is_empty(), "{:?}", e.warnings());
    suggest(&e, day());
    assert_eq!(*mock.asked.lock().unwrap(), vec!["beta:3b"]);

    // Uden et valg bruges serverens første model.
    let dir2 = tempfile::tempdir().unwrap();
    unclear_day(dir2.path());
    let e2 = engine(dir2.path());
    *lock(&e2.servers) = lock(&e.servers).clone();
    s.ai.local_model = None;
    e2.apply_settings(&s);
    suggest(&e2, day());
    assert_eq!(mock.asked.lock().unwrap().last().unwrap(), "alfa:1b");

    // Er den valgte model væk, falder den tilbage til den første, med en advarsel.
    s.ai.local_model = Some("slettet:7b".into());
    e2.apply_settings(&s);
    assert!(e2.warnings().iter().any(|w| w.contains("slettet:7b")));
}

#[test]
fn models_are_listed_downloaded_and_deleted_through_the_model_manager() {
    let dir = tempfile::tempdir().unwrap();
    let models = dir.path().join("ai").join("models");
    std::fs::create_dir_all(&models).unwrap();
    let spec = tai::ModelSpec {
        id: "lille".into(),
        name: "Lille testmodel".into(),
        description: "Kun til tests".into(),
        repo: "x/y".into(),
        revision: "abc".into(),
        file: "lille.gguf".into(),
        size_bytes: 12,
        sha256: "0".repeat(64),
        license: "Apache-2.0".into(),
        license_url: "https://example.org".into(),
        license_note: None,
        min_ram_gb: 1,
    };
    std::fs::write(models.join("lille.gguf"), b"tolv bytes!!").unwrap();
    let e = engine(dir.path());
    let e = Engine {
        models: tai::ModelManager::with_source(&models, "http://127.0.0.1:9", vec![spec]),
        ..e
    };

    let list = e.ai_models().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!((list[0].id.as_str(), list[0].downloaded), ("lille", true));
    // Allerede hentet: ingen netværkskald, og modellen bliver den aktive.
    e.download_model("lille").unwrap();
    assert_eq!(
        e.models.active().unwrap().map(|(s, _)| s.id),
        Some("lille".into())
    );
    e.delete_model("lille").unwrap();
    assert!(!e.ai_models().unwrap()[0].downloaded);
    assert!(matches!(
        e.download_model("findes-ikke"),
        Err(BackendError::NotFound(_))
    ));
    assert!(matches!(
        e.delete_model("findes-ikke"),
        Err(BackendError::NotFound(_))
    ));
}

/// Resident hukommelse for denne proces i MB (macOS/Linux).
#[cfg(feature = "local-llm")]
fn rss_mb() -> f64 {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f64>()
        .unwrap()
        / 1024.0
}

/// Hele kæden med en rigtig lille model: aktivitet → forslag → AI-mål, og så
/// frigivelse efter inaktivitet. Kræver en hentet model, derfor `#[ignore]`:
///
/// ```sh
/// TT_AI_E2E_MODELS=~/dev/cargo-target/ai/models \
///   cargo test -p tt-app --release --features local-llm --lib -- --ignored --nocapture local_llm_end_to_end
/// ```
///
/// Modellen ligger uden for repoet og bliver aldrig committet. Kunderne er opdigtede.
#[cfg(feature = "local-llm")]
#[test]
#[ignore = "kræver en hentet model, se TT_AI_E2E_MODELS"]
fn local_llm_end_to_end_with_a_small_model() {
    let models_dir = std::env::var("TT_AI_E2E_MODELS").expect("sæt TT_AI_E2E_MODELS");
    let dir = tempfile::tempdir().unwrap();
    // Opdigtede kunder. Titlen nævner ikke navnet helt ("Solsikkens"), så reglerne
    // giver op, og kun modellen kan se, at det handler om bageriet.
    let customers = vec![
        customer("k_bager", "Bageriet Solsikken"),
        customer("k_friser", "Frisør Nord"),
        customer("k_byg", "Nordlys Byg ApS"),
    ];
    let projects = vec![
        project("p_bager_web", "k_bager", "Bestillingsside", &[]),
        project("p_byg_tilbud", "k_byg", "Tilbud og kalkulation", &[]),
    ];
    put(
        dir.path(),
        &[browser(
            day(),
            (9, 0),
            (10, 0),
            "Solsikkens ordreliste: rundstykker, rugbrød og kager til lørdag",
            "regneark.example.org",
        )],
    );
    let e = engine(dir.path());
    let e = Engine {
        models: tai::ModelManager::new(&models_dir),
        ..e
    };

    let before = rss_mb();
    e.apply_settings(&{
        let mut s = settings(AiMode::Builtin);
        s.ai.builtin_model = Some(tai::DEFAULT_MODEL_ID.into());
        s
    });
    assert!(e.warnings().is_empty(), "{:?}", e.warnings());
    let after_settings = rss_mb();

    // Første spørgsmål: indlæsning af modellen + svar.
    let t = Instant::now();
    let first = e.suggestions(day(), &customers, &projects).unwrap();
    let first_ms = t.elapsed().as_millis();
    let rss_loaded = rss_mb();
    assert_eq!(first.len(), 1, "{first:?}");
    assert_eq!(first[0].customer_id.as_deref(), Some("k_bager"));
    assert!(first[0].reason.starts_with("AI:"), "{}", first[0].reason);
    eprintln!(
        "E2E første forslag: {first_ms} ms (indlæsning + svar), kunde={:?}, årsag: {}",
        first[0].customer_id, first[0].reason
    );

    // Andet spørgsmål, på et andet domæne (så det ikke er det lærte mønster,
    // der svarer): ren svartid med en varm model.
    put(
        dir.path(),
        &[browser(
            day(),
            (11, 0),
            (11, 45),
            "Solsikkens kageliste til fredag: lagkager og kanelsnegle",
            "ark2.example.net",
        )],
    );
    let t = Instant::now();
    let second = e.suggestions(day(), &customers, &projects).unwrap();
    eprintln!(
        "E2E andet spørgsmål (model varm): {} ms, forslag: {:?}",
        t.elapsed().as_millis(),
        second
            .iter()
            .map(|s| (s.customer_id.clone(), s.project_id.clone(), s.reason.clone()))
            .collect::<Vec<_>>()
    );
    eprintln!(
        "E2E RAM: før {before:.0} MB, efter indstillinger {after_settings:.0} MB, model indlæst {rss_loaded:.0} MB"
    );

    // Frigivelse efter inaktivitet, med rigtigt ur og korte tider. Motoren
    // droppes først, så der kun er én model i RAM ad gangen.
    let (spec, path) = ai::pick_model(&e.models, Some(tai::DEFAULT_MODEL_ID)).unwrap();
    drop(e);
    eprintln!("E2E RAM efter motoren er droppet: {:.0} MB", rss_mb());
    let lazy = Arc::new(ai::LazyLocal::with_idle(
        &spec,
        path,
        Arc::new(tai::idle::SystemClock::new()),
        Duration::from_millis(1_500),
        Duration::from_millis(200),
    ));
    let chain = tai::ProviderChain::new(vec![lazy.clone()]);
    let block = tai::BlockSummary {
        app: "Google Chrome".into(),
        title: "Solsikkens ordreliste: rundstykker og kager".into(),
        domain: None,
        path: None,
        git_branch: None,
        duration_secs: 600,
    };
    let candidates = vec![tai::Candidate {
        client_id: "k_bager".into(),
        client_name: "Bageriet Solsikken".into(),
        project_id: None,
        project_name: None,
        keywords: vec![],
    }];
    assert!(!lazy.is_loaded());
    let t = Instant::now();
    let answer = chain.classify(&block, &candidates);
    eprintln!("E2E ny instans, indlæsning + svar: {} ms", t.elapsed().as_millis());
    assert!(answer.answer.is_some());
    assert!(lazy.is_loaded());
    let rss_before_release = rss_mb();
    let idle_since = Instant::now();
    while lazy.is_loaded() {
        assert!(idle_since.elapsed() < Duration::from_secs(15), "ikke frigivet");
        std::thread::sleep(Duration::from_millis(50));
    }
    let rss_released = rss_mb();
    eprintln!(
        "E2E RAM ved frigivelse: {rss_before_release:.0} MB → {rss_released:.0} MB (frigivet efter {:.1} s)",
        idle_since.elapsed().as_secs_f32()
    );
    assert!(
        rss_released < rss_before_release,
        "RAM skal falde efter frigivelse"
    );

    // Næste behov indlæser modellen igen.
    chain.forget(&answer.key);
    let t = Instant::now();
    assert!(chain.classify(&block, &candidates).answer.is_some());
    eprintln!("E2E indlæsning igen efter frigivelse + svar: {} ms", t.elapsed().as_millis());
    assert_eq!(lazy.loads_and_releases().0, 2);
}

// ---------- tilladelser ----------

#[test]
fn permissions_are_mapped() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let p = e.permissions().unwrap();
    if cfg!(target_os = "macos") {
        assert!(matches!(
            p.accessibility,
            PermissionState::Granted | PermissionState::Denied | PermissionState::Unknown
        ));
    } else {
        assert_eq!(p.accessibility, PermissionState::NotNeeded);
        assert_eq!(p.screen_recording, PermissionState::NotNeeded);
        assert_eq!(
            e.request_permission(Permission::Accessibility).unwrap(),
            PermissionState::NotNeeded
        );
    }
    assert_eq!(
        map_state(tr::PermissionState::NotRequired),
        PermissionState::NotNeeded
    );
    assert_eq!(
        map_state(tr::PermissionState::Granted),
        PermissionState::Granted
    );
}

// ---------- tracker ----------

fn chrome_window(title: &str) -> tr::RawWindow {
    tr::RawWindow {
        app_name: "Google Chrome".into(),
        exe_path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into(),
        pid: Some(1),
        window_id: Some(1),
        title: title.into(),
        document: None,
        accessibility_hints: Vec::new(),
    }
}

fn wait_for_signal(rx: &ChangeRx) -> bool {
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        if rx.try_recv().is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn a_replayed_day_flows_through_the_tracker_into_a_suggestion() {
    let dir = tempfile::tempdir().unwrap();
    // 450 polls à 2 s = 15 minutter i Alfas webshop.
    let frames = (0..450)
        .map(|_| Frame {
            window: Some(chrome_window("Ordrer - Alfa Shop")),
            idle_secs: 0,
        })
        .collect();
    let mut platform = ScriptedPlatform::new(at(day(), 9, 0), frames);
    platform.url = Some("https://alfa-shop.dk/admin?x=1".into());
    let e = Engine::new(dir.path().to_path_buf(), Some(Box::new(platform)))
        .with_secrets(Arc::new(tai::MemorySecrets::default()));
    let rx = e.changes().unwrap();
    assert_eq!(e.tracking_state(), TrackingState::NotStarted);

    e.apply_settings(&settings(AiMode::Off));
    assert!(wait_for_signal(&rx), "trackeren skulle give et signal");
    // Trackeren gemmer, og forslaget kommer uden at rå aktivitet forlader motoren.
    let until = Instant::now() + Duration::from_secs(10);
    let s = loop {
        let s = suggest(&e, day());
        if !s.is_empty() || Instant::now() > until {
            break s;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(s.len(), 1, "{s:?}");
    assert_eq!(s[0].customer_id.as_deref(), Some("k_alfa"));
    assert_eq!(s[0].start, time(9, 0));
    assert!(s[0].minutes() >= 14);
}

#[test]
fn tracking_is_paused_and_resumed_by_the_settings() {
    let dir = tempfile::tempdir().unwrap();
    let frames = vec![Frame {
        window: Some(chrome_window("Ordrer")),
        idle_secs: 0,
    }];
    let platform = ScriptedPlatform::new(at(day(), 9, 0), frames);
    let e = Engine::new(dir.path().to_path_buf(), Some(Box::new(platform)));

    // Slået fra fra start: trackeren startes ikke.
    let mut off = settings(AiMode::Off);
    off.tracking.enabled = false;
    e.apply_settings(&off);
    assert_eq!(e.tracking_state(), TrackingState::NotStarted);

    let mut on = settings(AiMode::Off);
    on.tracking.enabled = true;
    e.apply_settings(&on);
    assert_eq!(e.tracking_state(), TrackingState::Running);

    e.apply_settings(&off);
    assert_eq!(e.tracking_state(), TrackingState::Paused);
    e.apply_settings(&on);
    assert_eq!(e.tracking_state(), TrackingState::Running);
}

/// Et vindue, der bliver ved med at være fremme. Uret går 2 s pr. poll, men
/// der ventes kun 1 ms, så et segment på flere minutter tager et øjeblik.
struct Steady {
    clock: DateTime<Utc>,
}

impl tr::Platform for Steady {
    fn foreground(&mut self) -> Option<tr::RawWindow> {
        Some(chrome_window("Ordrer - Alfa Shop"))
    }
    fn idle_seconds(&mut self) -> u64 {
        0
    }
    fn now(&mut self) -> DateTime<Utc> {
        self.clock
    }
    fn sleep(&mut self, d: Duration, stop: &tr::platform::StopSignal) {
        self.clock += chrono::Duration::from_std(d).unwrap_or_default();
        stop.wait(Duration::from_millis(1));
    }
}

#[test]
fn stop_tracking_gemmer_det_igangvaerende_segment() {
    // Afslutter brugeren appen (Cmd+Q, log ud, sluk), mens et vindue er
    // fremme, skal det segment gemmes. Set på en rigtig Mac: 40 s i Safari
    // forsvandt, fordi trackeren aldrig blev stoppet ved afslutning.
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().to_path_buf(), Some(Box::new(Steady { clock: at(day(), 9, 0) })))
        .with_secrets(Arc::new(tai::MemorySecrets::default()));
    e.apply_settings(&settings(AiMode::Off));
    assert_eq!(e.tracking_state(), TrackingState::Running);
    std::thread::sleep(Duration::from_millis(200));
    let store = tr::ActivityStore::open(&dir.path().join("activity.db")).unwrap();
    let all = |s: &tr::ActivityStore| s.segments_between(at(day(), 0, 0), at(day(), 23, 59), true).unwrap();
    assert!(all(&store).is_empty(), "segmentet er stadig i gang");

    e.stop_tracking();
    let saved = all(&store);
    assert_eq!(saved.len(), 1, "{saved:?}");
    assert_eq!(saved[0].app, "Google Chrome");
    // Uret går et skridt pr. sleep; hvor mange skridt der når at ske på
    // 200 ms, afhænger af OS-timeren (ca. 15 ms på Windows). Det vigtige er,
    // at segmentet gemmes med varighed.
    assert!(saved[0].duration_secs() > 0, "{saved:?}");
    assert_eq!(e.tracking_state(), TrackingState::NotStarted);
    // Et kald mere gør intet.
    e.stop_tracking();
}

#[test]
fn without_a_platform_settings_never_start_tracking() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    e.apply_settings(&settings(AiMode::Off));
    assert_eq!(e.tracking_state(), TrackingState::NotStarted);
    assert_eq!(e.current_app(), None);
}

#[test]
fn changes_can_be_signalled_and_coalesce() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let rx = e.changes().unwrap();
    assert!(rx.try_recv().is_err());
    e.signal_change();
    e.signal_change();
    assert!(rx.try_recv().is_ok());
    assert!(rx.try_recv().is_err(), "flere signaler samles til ét");
}

#[test]
fn the_engine_is_a_detection() {
    fn assert_detection<T: Detection + Send + Sync>() {}
    assert_detection::<Engine>();
}

fn logged_entry(id: &str, customer: &str, from: (u32, u32), to: (u32, u32)) -> crate::backend::Entry {
    crate::backend::Entry {
        id: id.into(),
        customer_id: customer.into(),
        project_id: None,
        task_id: None,
        description: String::new(),
        date: day(),
        start: Some(time(from.0, from.1)),
        end: Some(time(to.0, to.1)),
        minutes: 60,
        billable: true,
        invoice_id: None,
    }
}

fn saved_model(dir: &Path) -> tt_matcher::UserModel {
    serde_json::from_slice(&std::fs::read(dir.join("model.json")).unwrap()).unwrap()
}

#[test]
fn entries_with_times_teach_the_model_once_and_stay_local() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[
            browser(day(), (9, 0), (10, 0), "Ordrer – Kundeportal", "portal.beta-kunde.dk"),
            browser(day(), (11, 0), (11, 30), "Ordrer – Kundeportal", "portal.beta-kunde.dk"),
        ],
    );
    let e = engine(dir.path());
    e.learn_from_entries(day(), &[logged_entry("e1", "k_beta", (9, 0), (10, 0))]);
    suggest(&e, day());
    let m = saved_model(dir.path());
    assert!(m.nb.classes().contains(&"k_beta"), "{:?}", m.nb.classes());
    assert_eq!(m.learned_entries.len(), 1);
    let weight = m.nb.prior["k_beta"];
    // Samme post igen: intet læres dobbelt.
    e.learn_from_entries(day(), &[logged_entry("e1", "k_beta", (9, 0), (10, 0))]);
    suggest(&e, day());
    assert_eq!(saved_model(dir.path()).nb.prior["k_beta"], weight);
    // Titlen gemmes ikke som tekst; mønstrene til web er uændrede.
    let text = std::fs::read_to_string(dir.path().join("model.json")).unwrap();
    assert!(!text.to_lowercase().contains("ordrer"), "{text}");
}

#[test]
fn an_entry_from_a_confirmed_suggestion_is_not_learned_twice() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[browser(day(), (9, 0), (10, 0), "Webshop", "alfa-shop.dk")],
    );
    let e = engine(dir.path());
    let s = suggest(&e, day());
    e.confirmed(&s[0].id, None, "entry-1");
    let after_confirm = saved_model(dir.path());
    // Posten, bekræftelsen lavede, kommer tilbage som dagens post.
    e.learn_from_entries(day(), &[logged_entry("entry-1", "k_alfa", (9, 0), (10, 0))]);
    suggest(&e, day());
    assert_eq!(saved_model(dir.path()).nb, after_confirm.nb);
}

#[test]
fn deleting_all_activity_also_forgets_the_model() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[browser(day(), (9, 0), (10, 0), "Ordrer", "portal.beta-kunde.dk")],
    );
    let e = engine(dir.path());
    e.learn_from_entries(day(), &[logged_entry("e1", "k_beta", (9, 0), (10, 0))]);
    suggest(&e, day());
    assert!(dir.path().join("model.json").exists());
    e.delete_all_activity().unwrap();
    assert!(!dir.path().join("model.json").exists());
    // Og den kommer ikke tilbage fra hukommelsen ved næste læring af mønstre.
    assert!(lock(&e.patterns).model.nb.is_empty());
}
