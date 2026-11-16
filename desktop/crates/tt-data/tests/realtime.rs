//! Live-strømmen: en ændring i web ses som hændelse og i data, strømmen
//! genforbinder efter et brud, `revoked` logger ud, og 503 giver polling.

mod common;

use std::time::Duration;

use common::*;
use futures_lite::future::block_on;
use tt_data::cloud::sse::RealtimeConfig;
use tt_data::*;

const WAIT: Duration = Duration::from_secs(5);

#[test]
fn web_change_invalidates_cache_and_reaches_ui() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    assert!(block_on(repo.list_clients(false)).unwrap().is_empty());
    repo.start_realtime();
    wait_for(&events, WAIT, |e| *e == Event::Realtime { connected: true });
    // Ved forbindelse kan der være sket noget imens: alt hentes igen.
    let ev = wait_for(&events, WAIT, |e| matches!(e, Event::DataChanged { .. }));
    assert_eq!(ev, Event::DataChanged { entities: Entity::ALL.to_vec() });
    let before = mock.calls("extension.clients.list");
    block_on(repo.list_clients(false)).unwrap();
    assert_eq!(mock.calls("extension.clients.list"), before + 1);

    // Strømmen kører, så cachen er nu frisk uden ny hentning …
    block_on(repo.list_clients(false)).unwrap();
    assert_eq!(mock.calls("extension.clients.list"), before + 1);

    // … indtil web siger, at kunderne er ændret.
    mock.web_create_client("Ny fra web");
    let ev = wait_for(&events, WAIT, |e| matches!(e, Event::DataChanged { .. }));
    assert_eq!(ev, Event::DataChanged { entities: vec![Entity::Clients] });
    let clients = block_on(repo.list_clients(false)).unwrap();
    assert_eq!(clients[0].name, "Ny fra web");
    repo.stop_realtime();
}

#[test]
fn shared_timer_started_in_web_shows_in_desktop() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    repo.start_realtime();
    wait_for(&events, WAIT, |e| *e == Event::Realtime { connected: true });
    mock.web_start_timer("Startet i web", clock.now());
    wait_for(&events, WAIT, |e| matches!(e, Event::TimerChanged { .. }));
    let t = block_on(repo.timer()).unwrap();
    assert!(t.is_running);
    assert_eq!(t.description, "Startet i web");
    // Og omvendt: stop i desktop rydder den fælles timer.
    clock.advance_minutes(45);
    let out = block_on(repo.timer_stop(StopTimer::default())).unwrap();
    assert_eq!(out.entry.unwrap().entry.hours, d("0.75"));
    assert!(!mock.timer_state().is_active(), "den fælles timer er ryddet på serveren");
    let saved = block_on(mock.repo().entries_for_day(day())).unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].timer_session_id, t.session_id);
    repo.stop_realtime();
}

#[test]
fn reconnects_after_drop_and_refetches_everything() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    repo.start_realtime();
    wait_for(&events, WAIT, |e| *e == Event::Realtime { connected: true });

    // Proxyen lukker forbindelsen (Traefik/Cloudflare-timeout).
    mock.drop_streams();
    wait_for(&events, WAIT, |e| *e == Event::Realtime { connected: false });
    wait_for(&events, WAIT, |e| *e == Event::Realtime { connected: true });
    // Hændelser kan være tabt i hullet: alt meldes ændret.
    let ev = wait_for(&events, WAIT, |e| matches!(e, Event::DataChanged { .. }));
    assert_eq!(ev, Event::DataChanged { entities: Entity::ALL.to_vec() });

    // Og nye hændelser kommer igennem på den nye forbindelse.
    wait_until(WAIT, || mock.open_streams() == 1);
    mock.publish_data(&["invoices"]);
    let ev = wait_for(&events, WAIT, |e| matches!(e, Event::DataChanged { .. }));
    assert_eq!(ev, Event::DataChanged { entities: vec![Entity::Invoices] });

    // Server nede et stykke tid: backoff, og forbindelsen kommer igen.
    mock.set_offline(true);
    wait_for(&events, WAIT, |e| *e == Event::Realtime { connected: false });
    std::thread::sleep(Duration::from_millis(400));
    mock.set_offline(false);
    wait_for(&events, WAIT, |e| *e == Event::Realtime { connected: true });
    repo.stop_realtime();
}

#[test]
fn revoked_device_is_logged_out() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    repo.start_realtime();
    wait_for(&events, WAIT, |e| *e == Event::Realtime { connected: true });
    mock.publish_revoked();
    wait_for(&events, WAIT, |e| *e == Event::LoggedOut { reason: LogoutReason::Revoked });
    assert!(!repo.is_logged_in());
}

#[test]
fn realtime_disabled_falls_back_to_polling() {
    let clock = FakeClock::new();
    let mock = tt_data::mock::MockWeb::start(TOKEN);
    mock.set_realtime_disabled(true);
    let mut cfg = CloudConfig::new(mock.base_url(), device());
    cfg.realtime = RealtimeConfig { poll_interval: Duration::from_millis(150), ..fast_realtime() };
    let repo = CloudRepo::new(cfg, std::sync::Arc::new(MemorySecretStore::with(credentials())))
        .unwrap()
        .with_rules_and_clock(std::sync::Arc::new(DefaultRules), clock.clock());
    let events = repo.events().subscribe();
    repo.start_realtime();
    for _ in 0..2 {
        let ev = wait_for(&events, WAIT, |e| matches!(e, Event::DataChanged { .. }));
        assert_eq!(ev, Event::DataChanged { entities: Entity::ALL.to_vec() });
    }
    assert_eq!(mock.open_streams(), 0);
    repo.stop_realtime();
}

#[test]
fn stream_401_without_refresh_logs_out() {
    let clock = FakeClock::new();
    let (mock, repo) = cloud(&clock);
    let events = repo.events().subscribe();
    mock.revoke(TOKEN);
    repo.start_realtime();
    wait_for(&events, WAIT, |e| *e == Event::LoggedOut { reason: LogoutReason::Unauthorized });
}
