//! Cloud-specifikt: offline-kø uden dubletter, single-flight, logud ved
//! UNAUTHORIZED, login med state/PKCE og token-refresh.

mod common;

use std::time::Duration;

use common::*;
use futures_lite::future::block_on;
use tt_data::mock::MockWeb;
use tt_data::*;

fn entry(desc: &str) -> NewTimeEntry {
    NewTimeEntry { description: desc.into(), hours: d("1"), date: day(), ..Default::default() }
}

fn server_entries(mock: &MockWeb) -> Vec<TimeEntry> {
    block_on(mock.repo().list_entries(EntryFilter::default())).unwrap()
}

#[test]
fn offline_writes_are_queued_and_sent_once() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    let online = block_on(repo.create_entry(entry("Før"))).unwrap();
    assert!(!online.queued);
    // Dagen er indlæst, før forbindelsen forsvinder (som i appen).
    assert_eq!(block_on(repo.entries_for_day(day())).unwrap().len(), 1);

    mock.set_offline(true);
    let created = block_on(repo.create_entry(entry("Offline"))).unwrap();
    assert!(created.queued, "skal i køen offline");
    assert!(created.entry.pending);
    wait_for(&events, Duration::from_secs(2), |e| *e == Event::Offline);
    // Ret og slet, mens posterne venter: også i køen, i rækkefølge.
    let updated = block_on(repo.update_entry(
        &created.entry.id,
        TimeEntryPatch { description: Some("Offline, rettet".into()), ..Default::default() },
    ))
    .unwrap();
    assert!(updated.pending);
    block_on(repo.delete_entry(&online.entry.id)).unwrap();
    assert_eq!(repo.pending_count(), 3);

    // UI'et ser sine egne offline-handlinger (fra cachen + køen).
    let shown = block_on(repo.entries_for_day(day())).unwrap();
    assert_eq!(shown.len(), 1);
    assert_eq!(shown[0].description.as_deref(), Some("Offline, rettet"));
    assert!(shown[0].pending);

    // Ingen forbindelse: sync gør intet, og intet går tabt.
    assert_eq!(block_on(repo.sync_now()).unwrap(), 3);
    assert_eq!(server_entries(&mock).len(), 1);

    mock.set_offline(false);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    let on_server = server_entries(&mock);
    assert_eq!(on_server.len(), 1, "kun den offline-oprettede, rettede post");
    assert_eq!(on_server[0].description.as_deref(), Some("Offline, rettet"));
    assert_eq!(on_server[0].client_entry_id, created.entry.client_entry_id);

    // Det midlertidige id virker stadig og peger på serverens post.
    let fetched = block_on(repo.get_entry(&created.entry.id)).unwrap();
    assert_eq!(fetched.id, on_server[0].id);
    // En ekstra sync sender intet igen.
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    assert_eq!(mock.calls("extension.entries.create"), 2);
    wait_for(&events, Duration::from_secs(2), |e| *e == Event::Online);
}

#[test]
fn lost_response_does_not_duplicate() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    // Serveren gemmer, men svaret går tabt (udvidelsens kunde A-fejl).
    mock.drop_next_responses(1);
    let created = block_on(repo.create_entry(entry("Tabt svar"))).unwrap();
    assert!(created.queued);
    assert_eq!(server_entries(&mock).len(), 1, "serveren nåede at gemme");
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    assert_eq!(server_entries(&mock).len(), 1, "gentagelsen med samme clientEntryId gav ingen dublet");
    assert_eq!(mock.calls("extension.entries.create"), 2);
    // Og listen viser én post, ikke den foreløbige oven i serverens.
    assert_eq!(block_on(repo.entries_for_day(day())).unwrap().len(), 1);
}

#[test]
fn concurrent_syncs_are_single_flight() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    mock.set_offline(true);
    for i in 0..5 {
        assert!(block_on(repo.create_entry(entry(&format!("Kø {i}")))).unwrap().queued);
    }
    mock.set_offline(false);
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let r = repo.clone();
            std::thread::spawn(move || block_on(r.sync_now()).unwrap())
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(repo.pending_count(), 0);
    assert_eq!(server_entries(&mock).len(), 5);
    assert_eq!(mock.calls("extension.entries.create"), 5, "hver post sendt præcis én gang");
}

#[test]
fn definite_rejection_sets_queued_op_aside_and_reports_it() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    mock.set_offline(true);
    let bad = NewTimeEntry { project_id: Some(uuid::Uuid::new_v4().to_string()), ..entry("Projekt findes ikke") };
    assert!(block_on(repo.create_entry(bad)).unwrap().queued);
    assert!(block_on(repo.create_entry(entry("God"))).unwrap().queued);
    mock.set_offline(false);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    wait_for(&events, Duration::from_secs(2), |e| matches!(e, Event::QueueRejected { .. }));
    let on_server = server_entries(&mock);
    assert_eq!(on_server.len(), 1);
    assert_eq!(on_server[0].description.as_deref(), Some("God"));
    assert_eq!(repo.dead_letter_count(), 1, "den afviste er gemt, ikke slettet");
}

#[test]
fn offline_reads_fall_back_to_cache() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    block_on(repo.create_client(NewClient { name: "Cachet".into(), ..Default::default() })).unwrap();
    assert_eq!(block_on(repo.list_clients(false)).unwrap().len(), 1);
    // Stale + offline: sidst kendte svar i stedet for en fejl.
    clock.advance_minutes(5);
    mock.set_offline(true);
    let cached = block_on(repo.list_clients(false)).unwrap();
    assert_eq!(cached[0].name, "Cachet");
    // Noget, der aldrig er hentet, fejler ærligt.
    assert_eq!(block_on(repo.list_invoices()).unwrap_err(), DataError::Offline);
    // Oprettelse af kunder køes ikke (ingen idempotensnøgle i web endnu).
    let err = block_on(repo.create_client(NewClient { name: "Ny".into(), ..Default::default() })).unwrap_err();
    assert_eq!(err, DataError::Offline);
}

/// Et ur, der stilles tilbage, gør ikke cachen frisk (negativ alder).
#[test]
fn cache_is_not_fresh_when_the_clock_goes_back() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    assert!(block_on(repo.list_clients(false)).unwrap().is_empty());
    // En anden enhed opretter en kunde; uret stilles en time tilbage.
    block_on(mock.repo().create_client(NewClient { name: "Fra web".into(), ..Default::default() })).unwrap();
    clock.advance_minutes(-60);
    assert_eq!(block_on(repo.list_clients(false)).unwrap().len(), 1, "hentet igen, ikke fra cachen");
}

#[test]
fn unauthorized_logs_out() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    block_on(repo.list_clients(false)).unwrap();
    mock.revoke(TOKEN);
    clock.advance_minutes(5);
    assert_eq!(block_on(repo.list_clients(false)).unwrap_err(), DataError::Unauthorized);
    wait_for(&events, Duration::from_secs(1), |e| {
        *e == Event::LoggedOut { reason: LogoutReason::Unauthorized }
    });
    assert!(!repo.is_logged_in());
    assert!(block_on(repo.session()).unwrap().user.is_none());
    // Uden login køes intet.
    assert_eq!(block_on(repo.create_entry(entry("x"))).unwrap_err(), DataError::Unauthorized);
    assert_eq!(repo.pending_count(), 0);
}

#[test]
fn browser_login_checks_state_and_refreshes_tokens() {
    let clock = FakeClock::new();
    let mock = MockWeb::start(TOKEN);
    let repo = cloud_for(&mock, &clock, None);
    assert!(!repo.is_logged_in());

    // Et link med forkert state afvises uden at veksle koden (login-CSRF).
    let url = repo.begin_login();
    let forged = format!("{}?code=stjaalet&state=forkert", tt_data::cloud::auth::redirect_uri());
    assert!(matches!(block_on(repo.complete_login(&forged)), Err(DataError::Auth(_))));
    assert_eq!(mock.calls("extension.device.exchangeCode"), 0);

    let url2 = repo.begin_login();
    assert_ne!(url, url2, "ny state pr. login");
    let callback = mock.approve_login(&url2);
    let session = block_on(repo.complete_login(&callback)).unwrap();
    assert_eq!(session.user.unwrap().id, tt_data::mock::MOCK_USER_ID);
    assert_eq!(session.organization_id.as_deref(), Some(tt_data::mock::MOCK_ORG_ID));
    // Web's exchangeCode får state og enheds-id med (og verifier, ikke challenge).
    let sent = mock.last_input("extension.device.exchangeCode").unwrap();
    assert_eq!(sent["deviceId"], device().device_id);
    assert!(callback.contains(&format!("state={}", sent["state"].as_str().unwrap())));
    assert!(sent["codeVerifier"].as_str().unwrap().len() >= 43);
    // Samme deep link to gange: andet forsøg har intet login i gang.
    assert!(block_on(repo.complete_login(&callback)).is_err());

    block_on(repo.list_clients(false)).unwrap();
    // Adgangstokenet udløber: fornyes én gang, og kaldet lykkes.
    let token = mock_access_token(&repo);
    mock.expire(&token);
    clock.advance_minutes(5);
    block_on(repo.list_clients(false)).unwrap();
    assert_eq!(mock.calls("extension.device.refresh"), 1);
    assert_ne!(mock_access_token(&repo), token);
    assert!(repo.is_logged_in());
    let sent = mock.last_input("extension.device.refresh").unwrap();
    assert_eq!(sent["deviceId"], device().device_id);

    // Logud tilbagekalder tokenet på serveren (device.logout).
    let token = mock_access_token(&repo);
    block_on(repo.logout()).unwrap();
    assert_eq!(mock.calls("extension.device.logout"), 1);
    assert!(!repo.is_logged_in());
    let again = cloud_for(&mock, &clock, Some(Credentials { access_token: token, ..credentials() }));
    assert_eq!(block_on(again.list_clients(false)).unwrap_err(), DataError::Unauthorized, "tokenet er tilbagekaldt");
}

#[test]
fn updates_and_timer_use_web_forms() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    // Beløb sendes som strenge (web's clientInput/projectInput).
    let c = block_on(repo.create_client(NewClient {
        name: "Kunde A/S".into(),
        email: Some("a@example.dk".into()),
        default_hourly_rate: Some(d("850")),
        ..Default::default()
    }))
    .unwrap();
    assert_eq!(mock.last_input("extension.clients.create").unwrap()["data"]["defaultHourlyRate"], "850.00");
    // clients.update er en fuld erstatning: en delvis rettelse sendes med
    // resten af kunden, så intet ryddes.
    block_on(repo.update_client(&c.id, ClientPatch { phone: Some("12345678".into()), ..Default::default() })).unwrap();
    let sent = mock.last_input("extension.clients.update").unwrap()["data"].clone();
    assert_eq!((sent["name"].as_str(), sent["email"].as_str(), sent["phone"].as_str()), (Some("Kunde A/S"), Some("a@example.dk"), Some("12345678")));
    assert_eq!(sent["defaultHourlyRate"], "850.00");

    // projects.update sætter status til "active", hvis den mangler: en
    // omdøbning må ikke hente et arkiveret projekt frem.
    let p = block_on(repo.create_project(NewProject { name: "Projekt".into(), client_id: Some(c.id.clone()), ..Default::default() })).unwrap();
    block_on(repo.set_project_status(&p.id, ProjectStatus::Archived)).unwrap();
    let renamed = block_on(repo.update_project(&p.id, ProjectPatch { name: Some("Nyt navn".into()), ..Default::default() })).unwrap();
    assert_eq!((renamed.name.as_str(), renamed.status), ("Nyt navn", ProjectStatus::Archived));
    assert_eq!(renamed.client_id.as_deref(), Some(c.id.as_str()), "kunden bevares");

    // entries.update (web's time.update) erstatter hele posten.
    let e = block_on(repo.create_entry(NewTimeEntry { project_id: Some(p.id.clone()), client_id: Some(c.id.clone()), ..entry("Før") })).unwrap();
    let patched = block_on(repo.update_entry(&e.entry.id, TimeEntryPatch { description: Some("Efter".into()), ..Default::default() })).unwrap();
    assert_eq!(patched.description.as_deref(), Some("Efter"));
    let sent = mock.last_input("extension.entries.update").unwrap()["data"].clone();
    assert!(sent["hours"].is_number() && sent["date"].is_string(), "{sent}");
    assert_eq!(sent["projectId"].as_str(), Some(p.id.as_str()));
    assert_eq!(sent["billableRate"], "850.00", "postens timepris følger med, så web ikke regner den om");
    let on_server = block_on(mock.repo().get_entry(&e.entry.id)).unwrap();
    assert_eq!(on_server.project_id.as_deref(), Some(p.id.as_str()), "projektet må ikke ryddes");

    // Timer på et projekt uden direkte kunde: klippekort-valg og stop
    // bruger projektets kunde, og opgaven gemmes på web's timer.
    let task = block_on(repo.create_task(NewTask { title: "Opgave".into(), project_id: Some(p.id.clone()), ..Default::default() })).unwrap();
    block_on(repo.timer_start(StartTimer { project_id: Some(p.id.clone()), task_id: Some(task.id.clone()), ..Default::default() })).unwrap();
    assert_eq!(mock.last_input("extension.updateTimerState").unwrap()["taskId"], serde_json::json!(task.id));
    assert_eq!(mock.timer_state().task_id.as_deref(), Some(task.id.as_str()), "web gemmer opgaven");
    block_on(repo.set_prepaid_choice(Some(PrepaidChoice::None))).unwrap();
    assert_eq!(mock.last_input("extension.setPrepaidChoice").unwrap()["clientId"], serde_json::json!(c.id));
    clock.advance_minutes(90);
    let out = block_on(repo.timer_stop(StopTimer::default())).unwrap();
    let saved = out.entry.expect("posten gemmes").entry;
    assert_eq!(saved.task_id.as_deref(), Some(task.id.as_str()));
    assert_eq!(saved.client_id.as_deref(), Some(c.id.as_str()));

    // createDraft svarer { invoice, lineItems, totalAmount }.
    let inv = block_on(repo.create_invoice_draft(NewInvoiceDraft {
        client_id: c.id.clone(),
        time_entry_ids: vec![saved.id.clone()],
        ..Default::default()
    }))
    .unwrap();
    assert!(!inv.id.is_empty(), "fakturaen pakkes ud af svaret");
    assert_eq!(inv.status, InvoiceStatus::Draft);
}

fn mock_access_token(repo: &CloudRepo) -> String {
    // Tokenet står i sessionens credentials; læs det via en kopi af lageret.
    repo.debug_access_token().expect("logget ind")
}

#[test]
fn login_with_extension_token_and_org_switch() {
    let clock = FakeClock::new();
    let mock = MockWeb::start(TOKEN);
    let repo = cloud_for(&mock, &clock, None);
    assert_eq!(block_on(repo.login_with_token("forkert")).unwrap_err(), DataError::Unauthorized);
    let s = block_on(repo.login_with_token(TOKEN)).unwrap();
    assert!(s.user.is_some());
    let orgs = block_on(repo.organizations()).unwrap();
    assert_eq!(orgs.len(), 2);
    block_on(repo.select_organization("org-2")).unwrap();
    assert_eq!(block_on(repo.session()).unwrap().organization_id.as_deref(), Some("org-2"));
    assert!(block_on(repo.select_organization("ikke-min")).unwrap_err().is_definite_rejection());
}

#[test]
fn queue_from_another_user_is_never_sent() {
    let mock = MockWeb::start(TOKEN);
    let dir = std::env::temp_dir().join(format!("tt-data-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut cfg = CloudConfig::new(mock.base_url(), device());
    cfg.cache_path = Some(dir.join("cache.db"));
    let store = std::sync::Arc::new(MemorySecretStore::with(credentials()));
    let repo = CloudRepo::new(cfg.clone(), store.clone()).unwrap();
    block_on(repo.list_clients(false)).unwrap();
    mock.set_offline(true);
    block_on(repo.create_entry(entry("Brugerens offline-post"))).unwrap();
    assert_eq!(repo.pending_count(), 1);
    drop(repo);

    // Køen overlever en genstart (cachen ligger på disk) …
    let repo = CloudRepo::new(cfg.clone(), store.clone()).unwrap();
    assert_eq!(repo.pending_count(), 1);
    drop(repo);

    // … men en anden bruger, der logger ind, får den aldrig sendt.
    let other = Credentials {
        user: User { id: "user-2".into(), name: "Anden".into(), email: "anden@example.dk".into() },
        ..credentials()
    };
    let repo = CloudRepo::new(cfg, std::sync::Arc::new(MemorySecretStore::new())).unwrap();
    mock.set_offline(false);
    repo.debug_sign_in(other);
    assert_eq!(repo.pending_count(), 0);
    // Den ligger under den første brugers afviste (se tests/dead_letter.rs).
    assert_eq!(repo.dead_letter_count(), 0);
    assert!(server_entries(&mock).is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn clearing_entry_times_sends_null_only_when_asked() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let e = block_on(repo.create_entry(entry("Uden tid"))).unwrap().entry;
    // Ingen tidspunkt og ingen rydning: felterne udelades (= uændret i web).
    block_on(repo.update_entry(&e.id, TimeEntryPatch { description: Some("Ny".into()), ..Default::default() })).unwrap();
    let sent = mock.last_input("extension.entries.update").unwrap()["data"].clone();
    assert!(sent.get("startTime").is_none() && sent.get("endTime").is_none(), "{sent}");

    let start = clock.now();
    let timed = block_on(repo.create_entry(NewTimeEntry { start_time: Some(start), end_time: Some(start + chrono::Duration::hours(1)), ..entry("Med tid") }))
        .unwrap()
        .entry;
    block_on(repo.update_entry(&timed.id, TimeEntryPatch { start_time: Some(None), end_time: Some(None), ..Default::default() })).unwrap();
    let sent = mock.last_input("extension.entries.update").unwrap()["data"].clone();
    assert!(sent["startTime"].is_null() && sent.get("startTime").is_some() && sent["endTime"].is_null(), "{sent}");
    let on_server = block_on(mock.repo().get_entry(&timed.id)).unwrap();
    assert_eq!((on_server.start_time, on_server.end_time), (None, None));
}

#[test]
fn learned_patterns_and_site_mappings_use_web_procedures() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = mock.web_create_client("Kunde");
    // tt-matchers LearnedPattern som JSON, uændret (web gemmer det sendte).
    let pattern = |key: serde_json::Value, client: &str, weight: f64| LearnedPatternRecord {
        key,
        votes: serde_json::json!([{ "target": { "clientId": client }, "weight": weight, "confirmations": 2, "corrections": 0, "aiAnswers": 0 }]),
        updated_at: None,
    };
    let repo_key = serde_json::json!({ "kind": "repo", "remote": "github.com/acme/timetrack" });
    let n = block_on(repo.upsert_learned_patterns(vec![
        pattern(repo_key.clone(), &c.id, 2.0),
        pattern(serde_json::json!({ "kind": "domain", "domain": "figma.com" }), &c.id, 1.0),
    ]))
    .unwrap();
    assert_eq!(n, 2);
    let sent = mock.last_input("extension.patterns.upsert").unwrap();
    assert_eq!(sent["patterns"][0]["key"], repo_key);
    assert!(sent["patterns"][0].get("updatedAt").is_none(), "{sent}");

    let all = block_on(repo.learned_patterns(None)).unwrap();
    assert_eq!(all.patterns.len(), 2);
    assert!(all.server_time.is_some() && all.patterns.iter().all(|p| p.updated_at.is_some()));
    // Samme nøgle igen erstatter (serveren fletter ikke).
    block_on(repo.upsert_learned_patterns(vec![pattern(repo_key.clone(), &c.id, 5.0)])).unwrap();
    let since = block_on(repo.learned_patterns(all.server_time)).unwrap();
    assert!(mock.last_input("extension.patterns.list").unwrap()["since"].is_string());
    let p = since.patterns.iter().find(|p| p.key == repo_key).unwrap();
    assert_eq!(p.votes[0]["weight"], 5.0);
    // Ukendt kunde i en stemme: web svarer NOT_FOUND.
    let ghost = block_on(repo.upsert_learned_patterns(vec![pattern(repo_key, &uuid::Uuid::new_v4().to_string(), 1.0)]));
    assert!(ghost.unwrap_err().is_definite_rejection());
    assert_eq!(block_on(repo.upsert_learned_patterns(vec![])).unwrap(), 0, "intet kald uden mønstre");

    // Site-koblinger kommer fra web's siteMappings.list.
    block_on(repo.upsert_rule(MatchingRule {
        id: String::new(),
        kind: RuleKind::Domain,
        pattern: "figma.com".into(),
        project_id: None,
        client_id: Some(c.id.clone()),
        source: RuleSource::Learned,
        confirmations: 4,
        not_work: false,
        updated_at: None,
    }))
    .unwrap();
    let maps = block_on(repo.site_mappings()).unwrap();
    assert_eq!(mock.calls("extension.siteMappings.list"), 1);
    assert_eq!((maps.len(), maps[0].domain.as_str(), maps[0].usage_count), (1, "figma.com", 4));
}

#[test]
fn draft_retry_waits_while_the_first_attempt_is_still_running() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = block_on(repo.create_client(NewClient { name: "Kunde".into(), default_hourly_rate: Some(d("850")), ..Default::default() })).unwrap();
    let e = block_on(repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("Arbejde") })).unwrap().entry;
    // 1. kald: behandlet, men svaret går tabt. 2. kald: web svarer CONFLICT
    // (den første kører stadig). 3. kald: den oprettede kladde.
    mock.drop_next_responses(1);
    mock.fail_after("extension.invoices.createDraft", "CONFLICT", 1, 1);
    let inv = block_on(repo.create_invoice_draft(NewInvoiceDraft { client_id: c.id.clone(), time_entry_ids: vec![e.id], ..Default::default() }))
        .unwrap();
    let keys = mock_inputs(&mock, "extension.invoices.createDraft");
    assert_eq!(keys.len(), 3);
    assert!(keys.iter().all(|k| *k == keys[0]), "samme nøgle hver gang");
    let on_server = block_on(mock.repo().list_invoices()).unwrap();
    assert_eq!((on_server.len(), on_server[0].id.as_str()), (1, inv.id.as_str()));
}

#[test]
fn cloud_normalizes_client_domains_before_sending() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    // Web afviser en tom linje og ting over 253 tegn; desktop normaliserer først.
    let long = format!("https://www.kunde.dk/{}", "x".repeat(300));
    let c = block_on(repo.create_client(NewClient { name: "Kunde".into(), domains: vec![long, " ".into(), "Kunde.dk".into()], ..Default::default() }))
        .unwrap();
    assert_eq!(mock.last_input("extension.clients.create").unwrap()["data"]["domains"], serde_json::json!(["kunde.dk"]));
    assert_eq!(c.domains, ["kunde.dk"]);
    let bad = block_on(repo.update_client(&c.id, ClientPatch { domains: Some(vec!["ikke et domæne".into()]), ..Default::default() }));
    assert!(matches!(bad, Err(DataError::Validation(_))), "{bad:?}");
}

#[test]
fn client_domains_are_sent_only_when_changed() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = block_on(repo.create_client(NewClient { name: "Kunde".into(), domains: vec!["kunde.dk".into()], ..Default::default() })).unwrap();
    assert_eq!(mock.last_input("extension.clients.create").unwrap()["data"]["domains"], serde_json::json!(["kunde.dk"]));
    block_on(repo.update_client(&c.id, ClientPatch { name: Some("Kunde A/S".into()), ..Default::default() })).unwrap();
    assert!(mock.last_input("extension.clients.update").unwrap()["data"].get("domains").is_none(), "udeladt = uændret i web");
    block_on(repo.update_client(&c.id, ClientPatch { domains: Some(vec![]), ..Default::default() })).unwrap();
    assert_eq!(mock.last_input("extension.clients.update").unwrap()["data"]["domains"], serde_json::json!([]));
    assert!(block_on(repo.get_client(&c.id)).unwrap().domains.is_empty());
}

fn server_clients(mock: &MockWeb) -> usize {
    block_on(mock.repo().list_clients(true)).unwrap().len()
}

#[test]
fn creates_are_queued_with_their_key_and_a_second_tap_adds_no_duplicate() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    block_on(repo.create_client(NewClient { name: "Kunde A".into(), ..Default::default() })).unwrap();
    let key = mock.last_input("extension.clients.create").unwrap()["idempotencyKey"].as_str().unwrap().to_owned();
    assert!(uuid::Uuid::parse_str(&key).is_ok(), "{key}");
    block_on(repo.create_client(NewClient { name: "Kunde B".into(), ..Default::default() })).unwrap();
    assert_ne!(mock.last_input("extension.clients.create").unwrap()["idempotencyKey"], key, "ny nøgle pr. oprettelse");

    // Standard (queue_creates til): offline lægges oprettelsen i køen.
    mock.set_offline(true);
    let offline = || block_on(repo.create_client(NewClient { name: "Offline".into(), ..Default::default() }));
    assert_eq!(offline().unwrap_err(), DataError::Offline);
    assert_eq!(repo.pending_count(), 1);
    // Brugeren trykker "Opret" igen: samme indhold giver ingen ny i køen.
    assert_eq!(offline().unwrap_err(), DataError::Offline);
    assert_eq!(repo.pending_count(), 1);
    mock.set_offline(false);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    let names: Vec<String> = block_on(mock.repo().list_clients(true)).unwrap().into_iter().map(|c| c.name).collect();
    assert_eq!(names.iter().filter(|n| *n == "Offline").count(), 1, "{names:?}");
}

#[test]
fn create_still_running_on_the_server_stays_queued() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    // Web svarer CONFLICT, mens en oprettelse med samme nøgle kører. Det er
    // ikke en afvisning: den bliver i køen og sendes igen med samme nøgle.
    mock.fail_next("extension.projects.create", "CONFLICT", 1);
    let err = block_on(repo.create_project(NewProject { name: "Projekt".into(), ..Default::default() })).unwrap_err();
    assert_eq!(err, DataError::Offline);
    assert_eq!(repo.pending_count(), 1);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    let keys = mock_inputs(&mock, "extension.projects.create");
    assert_eq!((keys.len(), &keys[0]), (2, &keys[1]));
    assert_eq!(block_on(mock.repo().list_projects(true)).unwrap().len(), 1);
    while let Ok(e) = events.try_recv() {
        assert!(!matches!(e, Event::QueueRejected { .. }), "CONFLICT må ikke meldes som afvist: {e:?}");
    }
}

#[test]
fn invoice_draft_brings_its_lines_and_retries_with_the_same_key() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = block_on(repo.create_client(NewClient { name: "Fakturakunde".into(), default_hourly_rate: Some(d("850")), ..Default::default() })).unwrap();
    let a = block_on(repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("Design") })).unwrap().entry;
    let b = block_on(repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("Kode") })).unwrap().entry;

    // Serveren laver kladden, men svaret går tabt: samme nøgle sendes igen,
    // og web giver den samme kladde i stedet for en fejl ("posterne er
    // allerede faktureret").
    mock.drop_next_responses(1);
    let inv = block_on(repo.create_invoice_draft(NewInvoiceDraft {
        client_id: c.id.clone(),
        time_entry_ids: vec![a.id.clone(), b.id.clone()],
        ..Default::default()
    }))
    .unwrap();
    let keys = mock_inputs(&mock, "extension.invoices.createDraft");
    assert_eq!(keys.len(), 2);
    assert!(keys[0].is_string() && keys[0] == keys[1], "{keys:?}");
    assert_eq!(block_on(mock.repo().list_invoices()).unwrap().len(), 1, "ingen dublet");

    // Kladden har linjer (én pr. post), og de kom med svaret.
    let lines = block_on(repo.invoice_lines(&inv.id)).unwrap();
    let mut entry_ids: Vec<_> = lines.iter().filter_map(|l| l.time_entry_id.clone()).collect();
    entry_ids.sort();
    let mut want = vec![a.id.clone(), b.id.clone()];
    want.sort();
    assert_eq!(entry_ids, want);
    assert_eq!(mock.calls("extension.invoices.lines"), 0, "linjerne hentes ikke igen");

    // Linjer for mange fakturaer i ét kald.
    let missing = uuid::Uuid::new_v4().to_string();
    let many = block_on(repo.invoice_lines_many(vec![inv.id.clone(), missing.clone()])).unwrap();
    assert_eq!(many.get(&inv.id).map(Vec::len), Some(2));
    assert!(!many.contains_key(&missing));
    assert_eq!(mock.calls("extension.invoices.linesByInvoice"), 1);
}

/// Web's to veje: "Send Faktura" på en kladde giver nummer og status uden
/// mail, `send` sender mailen, og en kladde kan slettes, så posterne bliver
/// ufaktureret igen. Kun mock-web: der sendes aldrig noget til rigtige kunder.
#[test]
fn invoice_issue_without_mail_mail_send_and_draft_delete() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = block_on(repo.create_client(NewClient {
        name: "Fakturakunde".into(),
        default_hourly_rate: Some(d("850")),
        ..Default::default()
    }))
    .unwrap();
    let draft = |name: &str| {
        let e = block_on(repo.create_entry(NewTimeEntry {
            client_id: Some(c.id.clone()),
            ..entry(name)
        }))
        .unwrap()
        .entry;
        block_on(repo.create_invoice_draft(NewInvoiceDraft {
            client_id: c.id.clone(),
            time_entry_ids: vec![e.id],
            ..Default::default()
        }))
        .unwrap()
    };

    // Udsted uden mail.
    let a = draft("Design");
    assert_eq!(a.status, InvoiceStatus::Draft);
    let issued = block_on(repo.mark_invoice_sent(&a.id)).unwrap();
    assert_eq!(issued.status, InvoiceStatus::Sent);
    assert_eq!(mock.calls("extension.invoices.send"), 0, "ingen mail");

    // Sendes med mail.
    let b = draft("Kode");
    block_on(repo.send_invoice(&b.id)).unwrap();
    assert_eq!(mock.calls("extension.invoices.send"), 1);

    // En kladde kan slettes, og posten er ufaktureret igen; en udstedt ikke.
    let e = draft("Test");
    assert!(block_on(repo.uninvoiced_entries(&c.id)).unwrap().is_empty());
    block_on(repo.delete_invoice_draft(&e.id)).unwrap();
    assert_eq!(block_on(repo.uninvoiced_entries(&c.id)).unwrap().len(), 1);
    assert!(
        block_on(repo.delete_invoice_draft(&a.id)).is_err(),
        "udstedt kan ikke slettes"
    );
}

/// Cloud's "Gem PDF" og moms: web's tal fra `totals` og web's egen PDF fra
/// `pdfLink` (præcis de bytes, ruten svarer), med web's fejl.
#[test]
fn invoice_totals_and_pdf_come_from_web() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = block_on(repo.create_client(NewClient {
        name: "Momskunde".into(),
        default_hourly_rate: Some(d("850")),
        ..Default::default()
    }))
    .unwrap();
    let e = block_on(repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("Design") }))
        .unwrap()
        .entry;
    let inv = block_on(repo.create_invoice_draft(NewInvoiceDraft {
        client_id: c.id.clone(),
        time_entry_ids: vec![e.id],
        ..Default::default()
    }))
    .unwrap();

    // Ikke momsregistreret (web's standard): ingen moms, total = subtotal.
    let t = block_on(repo.invoice_totals(&inv.id)).unwrap();
    assert_eq!(
        (t.subtotal, t.vat_amount, t.total, t.show_vat, t.currency.as_str()),
        (d("850"), d("0"), d("850"), false, "DKK")
    );
    assert_eq!(t.vat_rate, d("25"));

    // Momsregistreret: 25 % oveni, som web's PDF.
    mock.set_vat_registered(true);
    let t = block_on(repo.invoice_totals(&inv.id)).unwrap();
    assert_eq!((t.vat_amount, t.total, t.show_vat), (d("212.50"), d("1062.50"), true));

    // PDF'en er web's bytes, hentet med Bearer-tokenet via stien fra pdfLink.
    let pdf = block_on(repo.invoice_pdf(&inv.id)).unwrap();
    assert_eq!(pdf, MockWeb::invoice_pdf(&inv.id));
    assert_eq!(mock.calls("extension.invoices.pdfLink"), 1);
    assert_eq!(mock.calls("GET /api/ext/invoices/pdf"), 1);

    // Fakturamodulet slået fra: 403 fra ruten.
    mock.set_pdf_status(Some(403));
    let err = block_on(repo.invoice_pdf(&inv.id)).unwrap_err();
    assert!(matches!(&err, DataError::Rejected { code, status: 403, .. } if code == "FORBIDDEN"), "{err:?}");
    mock.set_pdf_status(None);

    // Uden net: Offline, og intet køes.
    mock.set_offline(true);
    assert_eq!(block_on(repo.invoice_pdf(&inv.id)).unwrap_err(), DataError::Offline);
    assert_eq!(block_on(repo.invoice_totals(&inv.id)).unwrap_err(), DataError::Offline);
    assert_eq!(repo.pending_count(), 0);
}

#[test]
fn queued_create_reuses_its_key_after_a_lost_response() {
    let clock = FakeClock::new();
    let mock = MockWeb::start(TOKEN);
    let mut cfg = CloudConfig::new(mock.base_url(), device());
    cfg.realtime = fast_realtime();
    cfg.queue_creates = true;
    let repo = CloudRepo::new(cfg, std::sync::Arc::new(MemorySecretStore::with(credentials())))
        .unwrap()
        .with_rules_and_clock(std::sync::Arc::new(DefaultRules), clock.clock());

    // Serveren gemmer, men svaret går tabt: kunden ligger i køen med sin nøgle.
    mock.drop_next_responses(1);
    let err = block_on(repo.create_client(NewClient { name: "Tabt svar".into(), ..Default::default() })).unwrap_err();
    assert!(matches!(err, DataError::Offline), "{err:?}");
    assert_eq!((repo.pending_count(), server_clients(&mock)), (1, 1));
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    assert_eq!(server_clients(&mock), 1, "samme nøgle gav ingen dublet");
    let keys: Vec<serde_json::Value> = mock_inputs(&mock, "extension.clients.create");
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0], keys[1], "gentagelsen sendte samme nøgle");

    // Offline: køes og sendes, når forbindelsen er tilbage.
    mock.set_offline(true);
    assert!(block_on(repo.create_task(NewTask { title: "Offline-opgave".into(), ..Default::default() })).is_err());
    assert_eq!(repo.pending_count(), 1);
    mock.set_offline(false);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    let tasks = block_on(mock.repo().list_tasks(TaskFilter::default())).unwrap();
    assert_eq!(tasks.iter().filter(|t| t.title == "Offline-opgave").count(), 1);
}

fn mock_inputs(mock: &MockWeb, procedure: &str) -> Vec<serde_json::Value> {
    mock.inputs(procedure).into_iter().map(|v| v["idempotencyKey"].clone()).collect()
}

#[test]
fn timer_target_is_a_metadata_write_on_the_same_session() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = mock.web_create_client("Kunde");
    let t = block_on(repo.timer_start(StartTimer { description: "Før".into(), ..Default::default() })).unwrap();
    block_on(repo.timer_set_target(StartTimer { client_id: Some(c.id.clone()), task_id: None, description: "Efter".into(), ..Default::default() }))
        .unwrap();
    let sent = mock.last_input("extension.updateTimerState").unwrap();
    // Uden isRunning: web ændrer hverken kørsel, tid eller ejer.
    for k in ["isRunning", "startTime", "elapsedSeconds", "baseSeconds", "isFreshStart"] {
        assert!(sent.get(k).is_none(), "{k} må ikke sendes: {sent}");
    }
    assert_eq!(sent["sessionId"], serde_json::json!(t.session_id));
    assert_eq!(sent["expectedVersion"], serde_json::json!(t.version));
    assert_eq!((sent["clientId"].as_str(), sent["projectId"].is_null()), (Some(c.id.as_str()), true));
    let on_server = mock.timer_state();
    assert_eq!((on_server.client_id.as_deref(), on_server.description.as_str()), (Some(c.id.as_str()), "Efter"));
    assert!(on_server.is_running);

    // Opgaven er en del af målet og gemmes på web's timer. Cachen viser den
    // nye, også offline.
    let task = |title: &str| block_on(repo.create_task(NewTask { title: title.into(), client_id: Some(c.id.clone()), ..Default::default() })).unwrap().id;
    let (a, b) = (task("Opgave A"), task("Opgave B"));
    let target = |task: Option<&str>| StartTimer { client_id: Some(c.id.clone()), task_id: task.map(str::to_owned), description: "Efter".into(), ..Default::default() };
    block_on(repo.timer_set_target(target(Some(&a)))).unwrap();
    let switched = block_on(repo.timer_set_target(target(Some(&b)))).unwrap();
    assert_eq!(switched.task_id.as_deref(), Some(b.as_str()), "svaret bærer opgaven");
    assert_eq!(mock.timer_state().task_id.as_deref(), Some(b.as_str()));
    mock.set_offline(true);
    assert_eq!(block_on(repo.timer()).unwrap().task_id.as_deref(), Some(b.as_str()));
    mock.set_offline(false);

    // Et mål uden opgave rydder den (taskId: null, ikke udeladt).
    block_on(repo.timer_set_target(target(None))).unwrap();
    assert!(mock.last_input("extension.updateTimerState").unwrap()["taskId"].is_null());
    assert_eq!(mock.timer_state().task_id, None);

    // En opgave sat på en anden enhed ses her og havner på posten ved stop.
    mock.web_set_timer_task(Some(&a));
    assert_eq!(block_on(repo.timer()).unwrap().task_id.as_deref(), Some(a.as_str()));
    clock.advance_minutes(30);
    let saved = block_on(repo.timer_stop(StopTimer::default())).unwrap().entry.expect("post").entry;
    assert_eq!(saved.task_id.as_deref(), Some(a.as_str()));
}

#[test]
fn queued_stop_with_an_auto_card_web_rejects_keeps_the_time() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = mock.web_create_client("Kunde");
    // Et kort med 1 time (web blokerer overtræk som standard).
    block_on(repo.create_klippekort(NewPrepaidPackage {
        name: "1 time".into(),
        client_id: c.id.clone(),
        total_hours: d("1"),
        hourly_rate: d("800"),
        purchase_date: "2026-10-01".into(),
        ..Default::default()
    }))
    .unwrap();
    block_on(repo.timer_start(StartTimer { client_id: Some(c.id.clone()), description: "Support".into(), ..Default::default() })).unwrap();
    clock.advance_minutes(90);
    // Posten kan ikke sendes nu (5xx): den lægges i køen med det automatisk
    // valgte kort, og timeren stoppes.
    mock.fail_next("extension.entries.create", "INTERNAL_SERVER_ERROR", 1);
    let out = block_on(repo.timer_stop(StopTimer::default())).unwrap();
    let queued = out.entry.expect("posten er i køen");
    assert!(queued.queued && queued.entry.prepaid_package_id.is_some());
    assert!(mock.last_input("extension.entries.create").unwrap()["data"].get("prepaidAuto").is_none(), "markeringen sendes ikke");
    // Senere afviser web kortet (1,5 t > 1 t). Før gik posten tabt; nu
    // gemmes den uden kort med samme nøgle.
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    let saved = server_entries(&mock);
    assert_eq!(saved.len(), 1, "tiden er gemt");
    assert_eq!((saved[0].hours, saved[0].prepaid_package_id.as_deref()), (d("1.5"), None));
    assert_eq!(saved[0].client_entry_id, queued.entry.client_entry_id);
}

#[test]
fn task_cleared_on_another_device_is_not_restored_at_stop() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = mock.web_create_client("Kunde");
    let t = block_on(repo.create_task(NewTask { title: "Opgave".into(), client_id: Some(c.id.clone()), ..Default::default() })).unwrap();
    block_on(repo.timer_start(StartTimer { client_id: Some(c.id.clone()), task_id: Some(t.id.clone()), description: "Arbejde".into(), ..Default::default() })).unwrap();
    assert_eq!(block_on(repo.timer()).unwrap().task_id.as_deref(), Some(t.id.as_str()));
    // Web: opgaven ryddes fra en anden enhed. Før huskede desktop opgaven
    // lokalt og satte den på posten alligevel.
    mock.web_set_timer_task(None);
    clock.advance_minutes(30);
    let saved = block_on(repo.timer_stop(StopTimer::default())).unwrap().entry.expect("post").entry;
    assert_eq!(saved.task_id, None);
}

#[test]
fn klippekort_usage_update_and_top_up_use_web_procedures() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = mock.web_create_client("Kunde");
    let kort = block_on(mock.repo().create_klippekort(NewPrepaidPackage {
        name: "Kort".into(),
        client_id: c.id.clone(),
        total_hours: d("10"),
        hourly_rate: d("500"),
        purchase_date: "2026-10-01".into(),
        description: Some("Support".into()),
        ..Default::default()
    }))
    .unwrap();
    let first = block_on(repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), prepaid_package_id: Some(kort.id.clone()), ..entry("Første") })).unwrap();
    clock.advance_minutes(60);
    block_on(repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), prepaid_package_id: Some(kort.id.clone()), ..entry("Anden") })).unwrap();

    // Historikken kommer fra web's klippekort.get (usageHistory), ikke fra
    // posterne: en post, der slettes i web, forsvinder også fra historikken.
    let usage = block_on(repo.klippekort_usage(&kort.id)).unwrap();
    assert_eq!(mock.last_input("extension.klippekort.get").unwrap()["id"], serde_json::json!(kort.id));
    assert_eq!(usage.len(), 2);
    assert_eq!(usage[0].time_entry.as_ref().and_then(|e| e.description.as_deref()), Some("Anden"), "nyeste først");
    assert_eq!(usage[1].time_entry_id.as_deref(), Some(first.entry.id.as_str()));
    assert_eq!(usage[1].time_entry.as_ref().map(|e| e.date), Some(day()));
    assert_eq!((usage[0].hours_used, usage[0].value_used), (d("1"), d("500")));

    // update er en fuld erstatning: hele kortet sendes som tal, og en
    // delvis rettelse rydder ikke beskrivelsen.
    let u = block_on(repo.update_klippekort(&kort.id, PrepaidPackagePatch { total_hours: Some(d("20")), ..Default::default() })).unwrap();
    assert_eq!((u.total_hours, u.remaining_hours), (d("20"), d("18")));
    let sent = mock.last_input("extension.klippekort.update").unwrap();
    assert_eq!(sent["id"], serde_json::json!(kort.id));
    let data = &sent["data"];
    assert_eq!((data["totalHours"].as_f64(), data["hourlyRate"].as_f64()), (Some(20.0), Some(500.0)));
    assert_eq!((data["name"].as_str(), data["purchaseDate"].as_str()), (Some("Kort"), Some("2026-10-01")));
    assert_eq!(data["description"], "Support");
    assert!(data.get("expiryDate").is_none() && data.get("overdraftRate").is_none(), "{data}");

    let t = block_on(repo.top_up_klippekort(&kort.id, d("2.5"), None)).unwrap();
    assert_eq!(t.total_hours, d("22.5"));
    let mut sent = mock.last_input("extension.klippekort.topUp").unwrap();
    assert!(sent.as_object_mut().unwrap().remove("idempotencyKey").is_some(), "optankning med nøgle");
    assert_eq!(sent, serde_json::json!({ "id": kort.id, "hours": 2.5 }));
}

#[test]
fn klippekort_and_rules_use_web_procedures() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let c = mock.web_create_client("Kunde");
    let kort = block_on(mock.repo().create_klippekort(NewPrepaidPackage {
        name: "Kort".into(),
        client_id: c.id.clone(),
        total_hours: d("5"),
        hourly_rate: d("500"),
        purchase_date: "2026-10-01".into(),
        ..Default::default()
    }))
    .unwrap();
    // Arkivering er en toggle i web: et andet arkiv-kald må ikke hente
    // kortet frem igen.
    block_on(repo.archive_klippekort(&kort.id)).unwrap();
    block_on(repo.archive_klippekort(&kort.id)).unwrap();
    assert_eq!(mock.calls("extension.klippekort.archive"), 1);
    let all = block_on(repo.list_klippekort(None, true)).unwrap();
    assert_eq!(all.len(), 1, "arkiverede kort med, når inaktive ønskes");
    assert_eq!(all[0].is_archived, Some(true));
    assert_eq!(
        mock.last_input("extension.klippekort.list").unwrap()["filter"],
        serde_json::json!({ "includeArchived": true })
    );

    // Regler: getMatchingRules, upsert({ rules }) og remove({ ids }).
    let p = block_on(repo.create_project(NewProject {
        name: "Projekt".into(),
        client_id: Some(c.id.clone()),
        url_patterns: vec!["github.com/firma/*".into()],
        ..Default::default()
    }))
    .unwrap();
    let saved = block_on(repo.upsert_rule(MatchingRule {
        id: String::new(),
        kind: RuleKind::Domain,
        pattern: "figma.com".into(),
        project_id: Some(p.id.clone()),
        client_id: None,
        source: RuleSource::Learned,
        confirmations: 3,
        not_work: false,
        updated_at: None,
    }))
    .unwrap();
    assert!(!saved.id.is_empty());
    let sent = mock.last_input("extension.rules.upsert").unwrap();
    assert_eq!(sent["rules"][0]["kind"], "domain");
    assert_eq!(sent["rules"][0]["usageCount"], 3);
    let rules = block_on(repo.matching_rules()).unwrap();
    assert!(rules.iter().any(|r| r.source == RuleSource::Project && r.client_id.as_deref() == Some(c.id.as_str())));
    assert!(rules.iter().any(|r| r.id == saved.id && r.kind == RuleKind::Domain));
    block_on(repo.delete_rule(&saved.id)).unwrap();
    assert_eq!(mock.last_input("extension.rules.remove").unwrap()["ids"], serde_json::json!([saved.id]));
    assert!(!block_on(repo.matching_rules()).unwrap().iter().any(|r| r.id == saved.id));
    // En regel uden mål og uden "ikke arbejde" afvises som i web.
    let orphan = MatchingRule { id: String::new(), project_id: None, ..saved.clone() };
    assert!(matches!(block_on(repo.upsert_rule(orphan.clone())), Err(DataError::Validation(_))));
    // "Ikke arbejde" gemmes med notWork og uden mål, og læses tilbage.
    let not_work = block_on(repo.upsert_rule(MatchingRule { pattern: "www.Netbank.dk".into(), not_work: true, ..orphan })).unwrap();
    let sent = &mock.last_input("extension.rules.upsert").unwrap()["rules"][0];
    assert_eq!(sent["notWork"], true);
    assert!(sent.get("projectId").is_none() && sent.get("clientId").is_none(), "{sent}");
    let back = block_on(repo.matching_rules()).unwrap();
    let r = back.iter().find(|r| r.id == not_work.id).expect("reglen findes");
    assert!(r.not_work && r.project_id.is_none() && r.client_id.is_none());
    assert_eq!(r.pattern, "netbank.dk", "web normaliserer domænet");
}

#[test]
fn proxy_error_without_json_keeps_the_queue() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    // Hotel-wifi/firmaproxy: 403 med en HTML-side.
    mock.set_html_error(Some(403));
    let created = block_on(repo.create_entry(entry("Bag proxy"))).unwrap();
    assert!(created.queued, "usikkert svar: posten bliver i køen");
    assert_eq!(repo.pending_count(), 1);
    mock.set_html_error(None);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    assert_eq!(server_entries(&mock).len(), 1);
    assert!(events.try_iter_all().iter().all(|e| !matches!(e, Event::QueueRejected { .. })));
}

#[test]
fn missing_procedure_keeps_queued_writes() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    // Web uden feat/device-api: proceduren findes ikke (tRPC NOT_FOUND).
    mock.hide_procedure("extension.entries.create");
    let created = block_on(repo.create_entry(entry("Venter på web"))).unwrap();
    assert!(created.queued);
    mock.hide_procedure("extension.entries.delete");
    block_on(repo.delete_entry("00000000-0000-4000-8000-000000000001")).unwrap();
    assert_eq!(repo.pending_count(), 2, "sletningen må ikke regnes som udført");
}

#[test]
fn logout_mid_queue_reports_queued_not_error() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    mock.revoke(TOKEN);
    // Tokenet er tilbagekaldt: posten ligger i køen til næste login, og
    // kalderen får ikke en fejl, der får brugeren til at taste den igen.
    let created = block_on(repo.create_entry(entry("Lige før logud"))).unwrap();
    assert!(created.queued);
    assert!(!repo.is_logged_in());
    assert_eq!(repo.pending_count(), 1);
    // Samme bruger logger ind igen: posten sendes én gang.
    repo.debug_sign_in(credentials_with_token(&mock));
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    assert_eq!(server_entries(&mock).len(), 1);
}

fn credentials_with_token(mock: &MockWeb) -> Credentials {
    let token = mock.issue_token();
    Credentials { access_token: token, ..credentials() }
}

#[test]
fn forged_deep_link_does_not_cancel_login() {
    let clock = FakeClock::new();
    let mock = MockWeb::start(TOKEN);
    let repo = cloud_for(&mock, &clock, None);
    let url = repo.begin_login();
    let forged = format!("{}?code=x&state=forkert", tt_data::cloud::auth::redirect_uri());
    assert!(block_on(repo.complete_login(&forged)).is_err());
    // Det rigtige svar virker stadig.
    let callback = mock.approve_login(&url);
    assert!(block_on(repo.complete_login(&callback)).is_ok());
}

#[test]
fn cache_from_disk_is_not_trusted_after_restart() {
    let clock = FakeClock::new();
    let mock = MockWeb::start(TOKEN);
    let dir = std::env::temp_dir().join(format!("tt-data-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut cfg = CloudConfig::new(mock.base_url(), device());
    cfg.cache_path = Some(dir.join("cache.db"));
    cfg.realtime = fast_realtime();
    let store = std::sync::Arc::new(MemorySecretStore::with(credentials()));
    let repo = CloudRepo::new(cfg.clone(), store.clone()).unwrap().with_rules_and_clock(std::sync::Arc::new(DefaultRules), clock.clock());
    assert!(block_on(repo.list_clients(false)).unwrap().is_empty());
    drop(repo);
    // Mens appen var lukket, kom der en kunde til i web.
    block_on(mock.repo().create_client(NewClient { name: "Ny i nat".into(), ..Default::default() })).unwrap();
    let repo = CloudRepo::new(cfg, store).unwrap().with_rules_and_clock(std::sync::Arc::new(DefaultRules), clock.clock());
    let events = repo.events().subscribe();
    repo.start_realtime();
    wait_for(&events, Duration::from_secs(5), |e| *e == Event::Realtime { connected: true });
    assert_eq!(block_on(repo.list_clients(false)).unwrap().len(), 1, "gammel cache må ikke vises som frisk");
    repo.stop_realtime();
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn offline_edit_of_server_entry_returns_the_known_entry() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let e = block_on(repo.create_entry(NewTimeEntry { hours: d("2.5"), ..entry("Kendt post") })).unwrap();
    assert_eq!(block_on(repo.entries_for_day(day())).unwrap().len(), 1);
    mock.set_offline(true);
    let patched = block_on(repo.update_entry(
        &e.entry.id,
        TimeEntryPatch { description: Some("Rettet offline".into()), ..Default::default() },
    ))
    .unwrap();
    assert!(patched.pending);
    assert_eq!(patched.hours, d("2.5"), "resten af posten er den kendte, ikke tom");
    assert_eq!(patched.date, day());
    assert_eq!(patched.description.as_deref(), Some("Rettet offline"));
}

// ---------------------------------------------------------------- 0.2.24: web's feat/desktop-api-3

/// Tokenet går også i `Authorization: Bearer`, på både queries og
/// mutationer, så web kan droppe det fra `?input=` (review-fund #16).
#[test]
fn token_is_sent_in_the_authorization_header_too() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let token = mock_access_token(&repo);
    block_on(repo.list_clients(false)).unwrap();
    block_on(repo.create_client(NewClient { name: "Header".into(), ..Default::default() })).unwrap();
    assert_eq!(mock.bearer_tokens("extension.clients.list"), vec![token.clone()], "query (GET)");
    assert_eq!(mock.bearer_tokens("extension.clients.create"), vec![token], "mutation (POST)");
}

fn top_up_card(mock: &MockWeb) -> PrepaidPackage {
    let c = mock.web_create_client("Kunde");
    block_on(mock.repo().create_klippekort(NewPrepaidPackage {
        name: "Kort".into(),
        client_id: c.id,
        total_hours: d("5"),
        hourly_rate: d("500"),
        purchase_date: "2026-10-01".into(),
        ..Default::default()
    }))
    .unwrap()
}

fn server_total(mock: &MockWeb, id: &str) -> rust_decimal::Decimal {
    block_on(mock.repo().list_klippekort(None, true)).unwrap().into_iter().find(|p| p.id == id).unwrap().total_hours
}

/// Optankning med idempotensnøgle. Et tabt svar efter serverens skrivning
/// fylder ikke på to gange: kortet læses, og timerne er der allerede.
#[test]
fn top_up_with_a_lost_response_fills_once() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let kort = top_up_card(&mock);
    mock.drop_responses_of("extension.klippekort.topUp", 1);
    let p = block_on(repo.top_up_klippekort(&kort.id, d("2"), None)).unwrap();
    assert_eq!(p.total_hours, d("7"));
    assert_eq!(server_total(&mock, &kort.id), d("7"), "fyldt på én gang");
    assert_eq!(mock.calls("extension.klippekort.topUp"), 1, "ikke sendt igen, da timerne var landet");
    let key = mock.last_input("extension.klippekort.topUp").unwrap()["idempotencyKey"].as_str().unwrap().to_owned();
    assert!((8..=64).contains(&key.len()), "web kræver 8-64 tegn: {key}");
}

/// Et usikkert svar, hvor serveren ikke nåede at fylde på, sendes igen med
/// samme nøgle, og timerne lægges på præcis én gang.
#[test]
fn top_up_that_did_not_land_is_sent_again_with_the_same_key() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let kort = top_up_card(&mock);
    mock.fail_next("extension.klippekort.topUp", "TOO_MANY_REQUESTS", 1);
    let p = block_on(repo.top_up_klippekort(&kort.id, d("2"), Some("Ekstra".into()))).unwrap();
    assert_eq!(p.total_hours, d("7"));
    assert_eq!(server_total(&mock, &kort.id), d("7"));
    let keys: Vec<_> = mock.inputs("extension.klippekort.topUp").iter().map(|i| i["idempotencyKey"].clone()).collect();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0], keys[1], "samme nøgle ved det nye forsøg");
}

/// "Intet klippekort" siges udtrykkeligt til web (`noPrepaid: true`), både
/// ved en manuel post og ved stop af en timer med valget "intet kort".
#[test]
fn no_card_is_sent_as_no_prepaid() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let kort = top_up_card(&mock);
    let c = kort.client_id.clone();

    let manual = NewTimeEntry { client_id: Some(c.clone()), no_prepaid: true, ..entry("Uden kort") };
    let e = block_on(repo.create_entry(manual)).unwrap().entry;
    assert_eq!(e.prepaid_package_id, None);
    let sent = mock.last_input("extension.entries.create").unwrap();
    assert_eq!(sent["data"]["noPrepaid"], serde_json::json!(true));
    assert!(sent["data"].get("prepaidPackageId").is_none());

    // Med et kort sendes noPrepaid ikke (web afviser begge på én gang).
    let both = NewTimeEntry {
        client_id: Some(c.clone()),
        prepaid_package_id: Some(kort.id.clone()),
        no_prepaid: true,
        ..entry("Med kort")
    };
    let e = block_on(repo.create_entry(both)).unwrap().entry;
    assert_eq!(e.prepaid_package_id.as_deref(), Some(kort.id.as_str()));
    let sent = mock.last_input("extension.entries.create").unwrap();
    assert!(sent["data"].get("noPrepaid").is_none(), "{sent}");

    // Timer med valget "intet kort".
    block_on(repo.timer_start(StartTimer { client_id: Some(c), description: "Timer".into(), ..Default::default() })).unwrap();
    block_on(repo.set_prepaid_choice(Some(PrepaidChoice::None))).unwrap();
    clock.advance_minutes(30);
    let out = block_on(repo.timer_stop(StopTimer::default())).unwrap().entry.unwrap();
    assert_eq!(out.entry.prepaid_package_id, None);
    assert_eq!(mock.last_input("extension.entries.create").unwrap()["data"]["noPrepaid"], serde_json::json!(true));
    assert_eq!(server_total(&mock, &kort.id), d("5"));
}

/// Første kald time'er ud, mens serveren stadig arbejder; nye forsøg med
/// samme nøgle får `CONFLICT` ("i gang"). Desktop venter og prøver igen i
/// stedet for at give op, så brugeren ikke fylder på med en ny nøgle.
#[test]
fn top_up_waits_while_the_first_attempt_is_still_running() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let kort = top_up_card(&mock);
    mock.fail_sequence("extension.klippekort.topUp", &["TOO_MANY_REQUESTS", "CONFLICT", "CONFLICT"]);
    let p = block_on(repo.top_up_klippekort(&kort.id, d("2"), None)).unwrap();
    assert_eq!(p.total_hours, d("7"));
    assert_eq!(server_total(&mock, &kort.id), d("7"));
    let keys: Vec<_> = mock.inputs("extension.klippekort.topUp").iter().map(|i| i["idempotencyKey"].clone()).collect();
    assert_eq!(keys.len(), 4);
    assert!(keys.iter().all(|k| *k == keys[0]), "samme nøgle hele vejen");
}

/// Kan det ikke afgøres, om optankningen landede, siger fejlen det, så
/// brugeren tjekker kortet i stedet for at fylde på igen.
#[test]
fn top_up_that_cannot_be_settled_says_so() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let kort = top_up_card(&mock);
    mock.fail_sequence("extension.klippekort.topUp", &["TOO_MANY_REQUESTS"; 6]);
    let err = block_on(repo.top_up_klippekort(&kort.id, d("2"), None)).unwrap_err();
    assert!(err.to_string().contains("Tjek klippekortet"), "{err}");
    assert_eq!(server_total(&mock, &kort.id), d("5"));
}

/// "Send igen" på en afvist rettelse lægger rettelsen oven på posten, som den
/// er på web nu. Web's update erstatter hele posten, så det gamle
/// øjebliksbillede ville ellers overskrive det, der er rettet på web siden
/// (review 0.2.24, fund 2).
#[test]
fn retried_edit_does_not_overwrite_a_newer_web_edit() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let e = block_on(repo.create_entry(entry("Original"))).unwrap().entry;
    block_on(repo.entries_for_day(day())).unwrap();

    mock.set_offline(true);
    let patch = TimeEntryPatch { description: Some("Rettet offline".into()), ..Default::default() };
    let _ = block_on(repo.update_entry(&e.id, patch));
    mock.set_offline(false);
    mock.reject_when("extension.entries.update", "Rettet offline", "FORBIDDEN", "Perioden er låst.");
    block_on(repo.sync_now()).unwrap();
    assert_eq!(repo.dead_letter_count(), 1);

    // Imens rettes posten på web, og perioden låses op.
    block_on(mock.repo().update_entry(&e.id, TimeEntryPatch { hours: Some(d("3")), ..Default::default() })).unwrap();
    mock.clear_rejections();

    let out = block_on(repo.retry_dead_letters(None)).unwrap();
    assert_eq!(out.sent, 1, "{out:?}");
    let on_server = server_entries(&mock);
    assert_eq!(on_server.len(), 1);
    assert_eq!(on_server[0].description.as_deref(), Some("Rettet offline"), "rettelsen kom med");
    assert_eq!(on_server[0].hours, d("3"), "web's nyere rettelse er ikke overskrevet");
}

fn lane(id: &str, name: &str, order: i32, category: &str) -> TaskLane {
    TaskLane { id: id.into(), name: name.into(), color: Some("#3b82f6".into()), order, category: Some(category.into()), ..Default::default() }
}

#[test]
fn board_lanes_survive_offline_and_moves_wait_in_the_queue() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    mock.set_task_lanes(vec![
        lane("l-todo", "Todo", 0, "not_started"),
        lane("l-venter", "Venter på kunde", 1, "in_progress"),
        lane("l-annulleret", "Annulleret", 2, "cancelled"),
    ]);
    let task = block_on(mock.repo().create_task(NewTask { title: "Logo".into(), status: TaskStatus::Todo, ..Default::default() })).unwrap();
    let names = |v: Vec<TaskLane>| v.into_iter().map(|l| l.name).collect::<Vec<_>>();
    assert_eq!(names(block_on(repo.list_task_lanes()).unwrap()), ["Todo", "Venter på kunde", "Annulleret"]);
    assert_eq!(block_on(repo.list_tasks(TaskFilter::default())).unwrap().len(), 1);

    // Offline og efter cachens levetid: de sidst kendte kolonner (SQLite).
    mock.set_offline(true);
    clock.advance_minutes(5);
    assert_eq!(block_on(repo.list_task_lanes()).unwrap().len(), 3);

    // Flyt offline: i køen, sendes som web's tasks.move, når nettet er tilbage.
    block_on(repo.move_task(MoveTask { task_id: task.id.clone(), status_id: "l-venter".into(), ordered_task_ids: None })).unwrap();
    assert_eq!(repo.pending_count(), 1);
    // Genindlæsningen viser flytningen, mens den venter (kategorien giver
    // den gamle status), og en filtreret liste følger med.
    let shown = block_on(repo.list_tasks(TaskFilter::default())).unwrap();
    let t = shown.iter().find(|t| t.id == task.id).unwrap();
    assert_eq!((t.status, t.status_id.as_deref()), (TaskStatus::InProgress, Some("l-venter")));
    let todo = TaskFilter { status: Some(TaskStatus::Todo), ..Default::default() };
    assert!(block_on(repo.list_tasks(todo)).unwrap_or_default().iter().all(|t| t.id != task.id));
    mock.set_offline(false);
    assert_eq!(block_on(repo.sync_now()).unwrap(), 0);
    let input = mock.last_input("extension.tasks.move").unwrap();
    assert_eq!(input["data"], serde_json::json!({ "taskId": task.id, "statusId": "l-venter" }));
    let on_server = block_on(repo.list_tasks(TaskFilter::default())).unwrap();
    let t = on_server.iter().find(|t| t.id == task.id).unwrap();
    assert_eq!((t.status, t.status_id.as_deref()), (TaskStatus::InProgress, Some("l-venter")));

    // Web har lagt en kolonne til: ses efter levetiden, også med strømmen oppe.
    mock.set_task_lanes(vec![lane("l-todo", "Todo", 0, "not_started"), lane("l-ny", "Review", 1, "in_progress")]);
    clock.advance_minutes(5);
    assert_eq!(names(block_on(repo.list_task_lanes()).unwrap()), ["Todo", "Review"]);
}

#[test]
fn local_mode_has_the_four_fixed_lanes_and_moves_by_status() {
    let repo = LocalRepo::in_memory(device()).unwrap();
    let lanes = block_on(repo.list_task_lanes()).unwrap();
    assert_eq!(lanes.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), ["backlog", "todo", "in_progress", "done"]);
    let task = block_on(repo.create_task(NewTask { title: "Logo".into(), status: TaskStatus::Todo, ..Default::default() })).unwrap();
    block_on(repo.move_task(MoveTask { task_id: task.id.clone(), status_id: "done".into(), ordered_task_ids: None })).unwrap();
    let t = block_on(repo.list_tasks(TaskFilter::default())).unwrap().remove(0);
    assert_eq!(t.status, TaskStatus::Done);
}
