//! Afviste registreringer (offline-køens dead-letter): en handling, web
//! afviser endeligt, mens den sendes fra køen, må aldrig slettes. Den gemmes
//! med web's fejl, blokerer ikke resten af køen og kan sendes igen,
//! eksporteres eller kasseres (RAPPORT-review #9).

mod common;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use common::*;
use futures_lite::future::block_on;
use tt_data::mock::MockWeb;
use tt_data::*;

const CREATE: &str = "extension.entries.create";

fn entry(desc: &str) -> NewTimeEntry {
    NewTimeEntry { description: desc.into(), hours: d("1"), date: day(), ..Default::default() }
}

fn server_entries(mock: &MockWeb) -> Vec<TimeEntry> {
    block_on(mock.repo().list_entries(EntryFilter::default())).unwrap()
}

fn descriptions(mock: &MockWeb) -> Vec<String> {
    let mut v: Vec<String> = server_entries(mock).into_iter().filter_map(|e| e.description).collect();
    v.sort();
    v
}

/// Tre poster i køen (offline), hvor den midterste afvises af web.
fn queue_three(mock: &MockWeb, repo: &CloudRepo) -> NewTimeEntry {
    mock.set_offline(true);
    let bad = NewTimeEntry { client_entry_id: Some(uuid::Uuid::new_v4().to_string()), ..entry("Afvist post") };
    for e in [entry("Først"), bad.clone(), entry("Sidst")] {
        assert!(block_on(repo.create_entry(e)).unwrap().queued);
    }
    mock.set_offline(false);
    bad
}

struct Disk {
    dir: PathBuf,
    cfg: CloudConfig,
}

impl Disk {
    fn new(mock: &MockWeb) -> Disk {
        let dir = std::env::temp_dir().join(format!("tt-dlq-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut cfg = CloudConfig::new(mock.base_url(), device());
        cfg.cache_path = Some(dir.join("cache.db"));
        cfg.realtime = fast_realtime();
        Disk { dir, cfg }
    }

    fn open(&self, store: Arc<dyn SecretStore>) -> CloudRepo {
        CloudRepo::new(self.cfg.clone(), store).unwrap()
    }
}

impl Drop for Disk {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn rejected_queued_entry_is_kept_and_the_rest_of_the_queue_is_sent() {
    for (code, status) in [("FORBIDDEN", 403), ("BAD_REQUEST", 400), ("UNPROCESSABLE_CONTENT", 422), ("CONFLICT", 409)] {
        let clock = FakeClock::new();
        let (mock, repo) = cloud(&clock);
        block_on(repo.select_organization("org-2")).unwrap();
        let events = repo.events().subscribe();
        let bad = queue_three(&mock, &repo);
        mock.reject_when(CREATE, "Afvist post", code, "Planen er låst");

        assert_eq!(block_on(repo.sync_now()).unwrap(), 0, "{code}: køen er tømt");
        assert_eq!(descriptions(&mock), vec!["Først", "Sidst"], "{code}: resten af køen er sendt");
        assert_eq!(repo.dead_letter_count(), 1, "{code}");
        let dead = repo.dead_letters().unwrap();
        let d0 = &dead[0];
        assert_eq!(d0.error_code.as_deref(), Some(code));
        assert_eq!(d0.error_message, "Planen er låst");
        assert_eq!(d0.status, Some(status));
        assert_eq!(d0.op.organization_id.as_deref(), Some("org-2"), "{code}: org gemt");
        assert_eq!(d0.kind(), "create_entry");
        let e = d0.entry().expect("tidspost");
        assert_eq!(e.client_entry_id, bad.client_entry_id, "{code}: samme clientEntryId");
        assert_eq!(e.description.as_deref(), Some("Afvist post"));
        wait_for(&events, Duration::from_secs(2), |e| matches!(e, Event::QueueRejected { .. }));
        wait_for(&events, Duration::from_secs(2), |e| *e == Event::DeadLetterChanged { count: 1 });
        // Den afviste vises ikke som en ventende post.
        let shown = block_on(repo.entries_for_day(day())).unwrap();
        assert!(shown.iter().all(|e| e.description.as_deref() != Some("Afvist post")));
    }
}

#[test]
fn every_kind_of_queued_op_is_kept_when_rejected() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = mock.web_create_client("Bageriet");
    block_on(repo.list_clients(false)).unwrap();
    mock.set_offline(true);
    block_on(repo.archive_client(&c.id)).unwrap();
    mock.set_offline(false);
    mock.fail_next("extension.clients.archive", "FORBIDDEN", 1);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    let dead = repo.dead_letters().unwrap();
    assert_eq!(dead.len(), 1);
    assert_eq!(dead[0].kind(), "archive_client");
    assert_eq!(dead[0].describe(), "Arkivering af kunde");
    // Ikke en tidspost: udeladt af CSV'en (kun overskriften).
    assert_eq!(repo.dead_letters_csv().unwrap().lines().count(), 1);
}

#[test]
fn conflict_on_a_queued_create_still_stays_in_the_queue() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    mock.set_offline(true);
    assert_eq!(
        block_on(repo.create_client(NewClient { name: "Ny".into(), ..Default::default() })).unwrap_err(),
        DataError::Offline
    );
    mock.set_offline(false);
    mock.fail_next("extension.clients.create", "CONFLICT", 1);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 1, "oprettelsen kører stadig: bliver i køen");
    assert_eq!(repo.dead_letter_count(), 0);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    assert_eq!(repo.dead_letter_count(), 0);
}

#[test]
fn rejection_while_the_user_waits_is_returned_not_dead_lettered() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    mock.reject_when(CREATE, "Online afvist", "FORBIDDEN", "Planen er låst");
    let err = block_on(repo.create_entry(entry("Online afvist"))).unwrap_err();
    assert_eq!(err.to_string(), "Planen er låst");
    assert_eq!(repo.dead_letter_count(), 0, "fejlen går til kalderen, som stadig har tiden");
    assert_eq!(repo.pending_count(), 0);
}

#[test]
fn retry_that_web_accepts_creates_the_entry_once() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let bad = queue_three(&mock, &repo);
    mock.reject_when(CREATE, "Afvist post", "FORBIDDEN", "Planen er låst");
    block_on(repo.sync_now()).unwrap();
    let op_id = repo.dead_letters().unwrap()[0].op_id().to_owned();

    // Planen er låst op igen.
    mock.clear_rejections();
    let events = repo.events().subscribe();
    let out = block_on(repo.retry_dead_letters(Some(&op_id))).unwrap();
    assert_eq!(out, RetryOutcome { sent: 1, rejected: 0, queued: 0 });
    assert_eq!(repo.dead_letter_count(), 0);
    let saved: Vec<_> = server_entries(&mock).into_iter().filter(|e| e.description.as_deref() == Some("Afvist post")).collect();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].client_entry_id, bad.client_entry_id, "samme clientEntryId");
    wait_for(&events, Duration::from_secs(2), |e| *e == Event::DeadLetterChanged { count: 0 });

    // Et nyt forsøg på det samme giver ingen dublet.
    assert_eq!(block_on(repo.retry_dead_letters(Some(&op_id))).unwrap_err(), DataError::NotFound);
    assert_eq!(block_on(repo.retry_dead_letters(None)).unwrap(), RetryOutcome::default());
    assert_eq!(server_entries(&mock).len(), 3);
}

#[test]
fn retry_that_web_rejects_again_keeps_it_with_the_new_error() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    queue_three(&mock, &repo);
    mock.reject_when(CREATE, "Afvist post", "FORBIDDEN", "Planen er låst");
    block_on(repo.sync_now()).unwrap();
    let before = mock.calls(CREATE);

    mock.reject_when(CREATE, "Afvist post", "BAD_REQUEST", "Projektet er arkiveret");
    let out = block_on(repo.retry_dead_letters(None)).unwrap();
    assert_eq!(out, RetryOutcome { sent: 0, rejected: 1, queued: 0 });
    let dead = repo.dead_letters().unwrap();
    assert_eq!(dead.len(), 1, "ingen dublet blandt de afviste");
    assert_eq!(dead[0].error_message, "Projektet er arkiveret");
    assert_eq!(dead[0].error_code.as_deref(), Some("BAD_REQUEST"));
    assert_eq!(dead[0].attempts, 2);
    assert_eq!(mock.calls(CREATE), before + 1, "sendt én gang");
    assert_eq!(server_entries(&mock).len(), 2, "intet gemt");
    assert_eq!(repo.pending_count(), 0);
}

#[test]
fn retry_while_offline_goes_back_to_the_queue() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    queue_three(&mock, &repo);
    mock.reject_when(CREATE, "Afvist post", "FORBIDDEN", "Planen er låst");
    block_on(repo.sync_now()).unwrap();
    mock.clear_rejections();

    mock.set_offline(true);
    let out = block_on(repo.retry_dead_letters(None)).unwrap();
    assert_eq!(out, RetryOutcome { sent: 0, rejected: 0, queued: 1 });
    assert_eq!(repo.dead_letter_count(), 0, "ikke længere afvist");
    assert_eq!(repo.pending_count(), 1, "i den almindelige kø");
    mock.set_offline(false);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    assert_eq!(server_entries(&mock).len(), 3);
}

#[test]
fn dead_letters_survive_restart_logout_and_revoked_token() {
    let mock = MockWeb::start(TOKEN);
    let disk = Disk::new(&mock);
    let store: Arc<dyn SecretStore> = Arc::new(MemorySecretStore::with(credentials()));
    let repo = disk.open(store.clone());
    queue_three(&mock, &repo);
    mock.reject_when(CREATE, "Afvist post", "FORBIDDEN", "Planen er låst");
    block_on(repo.sync_now()).unwrap();
    let before = repo.dead_letters().unwrap();
    assert_eq!(before.len(), 1);
    drop(repo);

    // Genstart: samme cache på disken.
    let repo = disk.open(store.clone());
    assert_eq!(repo.dead_letters().unwrap(), before);

    // Tilbagekaldt token (logud fra serveren): bevares.
    mock.revoke(TOKEN);
    let _ = block_on(repo.list_invoices());
    assert!(!repo.is_logged_in());
    assert_eq!(repo.dead_letter_count(), 1, "kan stadig ses og eksporteres efter logud");
    assert!(repo.dead_letters_csv().unwrap().contains("Afvist post"));
    // Uden login kan intet sendes.
    assert_eq!(block_on(repo.retry_dead_letters(None)).unwrap_err(), DataError::Unauthorized);

    // Samme bruger logger ind igen og logger selv ud: stadig der.
    let token = mock.issue_token();
    repo.debug_sign_in(Credentials { access_token: token, ..credentials() });
    assert_eq!(repo.dead_letter_count(), 1);
    block_on(repo.logout()).unwrap();
    drop(repo);
    let repo = disk.open(Arc::new(MemorySecretStore::new()));
    assert_eq!(repo.dead_letters().unwrap(), before);
}

#[test]
fn another_user_never_sees_or_sends_them() {
    let mock = MockWeb::start(TOKEN);
    let disk = Disk::new(&mock);
    let repo = disk.open(Arc::new(MemorySecretStore::with(credentials())));
    queue_three(&mock, &repo);
    mock.reject_when(CREATE, "Afvist post", "FORBIDDEN", "Planen er låst");
    block_on(repo.sync_now()).unwrap();
    // Og en post, der ligger i køen, da brugeren går.
    mock.set_offline(true);
    block_on(repo.create_entry(entry("Usendt"))).unwrap();
    mock.set_offline(false);
    mock.clear_rejections();
    drop(repo);

    let other = Credentials {
        access_token: mock.issue_token(),
        user: User { id: "user-2".into(), name: "Anden".into(), email: "anden@example.dk".into() },
        ..credentials()
    };
    let repo = disk.open(Arc::new(MemorySecretStore::new()));
    repo.debug_sign_in(other);
    assert_eq!(repo.pending_count(), 0, "den første brugers kø sendes ikke");
    assert_eq!(repo.dead_letter_count(), 0, "og den anden bruger ser den ikke");
    assert_eq!(block_on(repo.retry_dead_letters(None)).unwrap(), RetryOutcome::default());
    assert!(repo.discard_dead_letter("findes-ikke").is_err());
    assert_eq!(descriptions(&mock), vec!["Først", "Sidst"]);

    // Den første bruger logger ind igen: begge ligger klar og kan sendes.
    repo.debug_sign_in(Credentials { access_token: mock.issue_token(), ..credentials() });
    let dead = repo.dead_letters().unwrap();
    assert_eq!(dead.len(), 2);
    assert_eq!(dead[1].error_code.as_deref(), Some(tt_data::cloud::dead_letter::OTHER_USER));
    let out = block_on(repo.retry_dead_letters(None)).unwrap();
    assert_eq!(out.sent, 2);
    assert_eq!(descriptions(&mock), vec!["Afvist post", "Først", "Sidst", "Usendt"]);
}

#[test]
fn discard_is_the_only_delete_and_csv_matches_the_migration_format() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = block_on(repo.create_client(NewClient { name: "Bageriet".into(), ..Default::default() })).unwrap();
    let p = block_on(repo.create_project(NewProject { name: "Webshop".into(), client_id: Some(c.id.clone()), ..Default::default() })).unwrap();
    block_on(repo.list_clients(false)).unwrap();
    block_on(repo.list_projects(false)).unwrap();
    mock.set_offline(true);
    let start = clock.now() - chrono::Duration::minutes(90);
    let timed = NewTimeEntry {
        project_id: Some(p.id.clone()),
        hours: d("1.5"),
        start_time: Some(start),
        end_time: Some(clock.now()),
        ..entry("Produktsider; \"kurv\"")
    };
    block_on(repo.create_entry(timed)).unwrap();
    block_on(repo.create_entry(entry("Afvist post"))).unwrap();
    mock.set_offline(false);
    mock.reject_when(CREATE, "\"description\":\"", "FORBIDDEN", "Planen er låst");
    block_on(repo.sync_now()).unwrap();
    let dead = repo.dead_letters().unwrap();
    assert_eq!(dead.len(), 2);
    assert_eq!(dead[0].client_name.as_deref(), Some("Bageriet"), "kunden via projektet");
    assert_eq!(dead[0].project_name.as_deref(), Some("Webshop"));

    let csv = repo.dead_letters_csv().unwrap();
    let mut lines = csv.split("\r\n");
    // Samme overskrift som `ikke-synkroniseret-fra-0.2.csv` (tt-app migrate.rs).
    assert_eq!(lines.next(), Some("\u{feff}Dato;Start;Slut;Timer;Kunde;Projekt;Beskrivelse"));
    let local = |t: chrono::DateTime<chrono::Utc>| t.with_timezone(&chrono::Local).format("%H:%M").to_string();
    assert_eq!(
        lines.next(),
        Some(
            format!(
                "2026-10-26;{};{};1,50;\"Bageriet\";\"Webshop\";\"Produktsider; \"\"kurv\"\"\"",
                local(start),
                local(clock.now())
            )
            .as_str()
        )
    );
    assert_eq!(lines.next(), Some("2026-10-26;;;1,00;\"\";\"\";\"Afvist post\""));

    let first = dead[0].op_id().to_owned();
    repo.discard_dead_letter(&first).unwrap();
    assert_eq!(repo.dead_letter_count(), 1);
    assert_eq!(repo.discard_dead_letter(&first).unwrap_err(), DataError::NotFound);
    assert!(!repo.dead_letters_csv().unwrap().contains("Produktsider"));
}
