#![allow(dead_code)]

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, TimeZone, Utc};
use parking_lot::Mutex;
use tt_data::cloud::sse::RealtimeConfig;
use tt_data::mock::{MOCK_USER_ID, MockWeb};
use tt_data::*;

pub const TOKEN: &str = "tok-1";

/// Fast ur, testen selv flytter.
#[derive(Clone)]
pub struct FakeClock(Arc<Mutex<DateTime<Utc>>>);

impl FakeClock {
    pub fn new() -> Self {
        FakeClock(Arc::new(Mutex::new(Utc.with_ymd_and_hms(2026, 10, 26, 8, 0, 0).unwrap())))
    }
    pub fn advance_minutes(&self, m: i64) {
        *self.0.lock() += chrono::Duration::minutes(m);
    }
    pub fn now(&self) -> DateTime<Utc> {
        *self.0.lock()
    }
    pub fn clock(&self) -> Clock {
        let c = self.0.clone();
        Arc::new(move || *c.lock())
    }
}

pub fn device() -> DeviceInfo {
    DeviceInfo {
        device_id: "dev-test".into(),
        device_name: "Testmaskine".into(),
        os: "macos".into(),
        app_version: "1.0.0-test".into(),
    }
}

pub fn local(clock: &FakeClock) -> LocalRepo {
    LocalRepo::in_memory(device()).unwrap().with_clock(clock.clock())
}

pub fn fast_realtime() -> RealtimeConfig {
    RealtimeConfig {
        backoff_initial: Duration::from_millis(50),
        backoff_max: Duration::from_millis(200),
        idle_timeout: Duration::from_secs(5),
        poll_interval: Duration::from_secs(3600),
    }
}

pub fn credentials() -> Credentials {
    Credentials {
        access_token: TOKEN.into(),
        refresh_token: None,
        expires_at: None,
        user: User { id: MOCK_USER_ID.into(), name: "Mads Holst Jensen".into(), email: "mads@example.dk".into() },
        organization_id: None,
    }
}

/// CloudRepo logget ind mod en ny mock-server.
pub fn cloud(clock: &FakeClock) -> (MockWeb, CloudRepo) {
    let mock = MockWeb::start(TOKEN);
    let repo = cloud_for(&mock, clock, Some(credentials()));
    (mock, repo)
}

pub fn cloud_for(mock: &MockWeb, clock: &FakeClock, creds: Option<Credentials>) -> CloudRepo {
    let store = match creds {
        Some(c) => MemorySecretStore::with(c),
        None => MemorySecretStore::new(),
    };
    let mut cfg = CloudConfig::new(mock.base_url(), device());
    cfg.realtime = fast_realtime();
    CloudRepo::new(cfg, Arc::new(store)).unwrap().with_rules_and_clock(Arc::new(DefaultRules), clock.clock())
}

pub fn d(s: &str) -> rust_decimal::Decimal {
    s.parse().unwrap()
}

pub fn day() -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
}

/// Vent på en hændelse, der opfylder `pred` (eller fejl efter `timeout`).
pub fn wait_for(rx: &async_channel::Receiver<Event>, timeout: Duration, pred: impl Fn(&Event) -> bool) -> Event {
    let deadline = Instant::now() + timeout;
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        while let Ok(ev) = rx.try_recv() {
            if pred(&ev) {
                return ev;
            }
            seen.push(ev);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("hændelsen kom ikke inden for {timeout:?}; set: {seen:?}");
}

pub fn wait_until(timeout: Duration, mut cond: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if cond() {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("betingelsen blev ikke opfyldt inden for {timeout:?}");
}

pub trait DrainEvents {
    fn try_iter_all(&self) -> Vec<Event>;
}

impl DrainEvents for async_channel::Receiver<Event> {
    fn try_iter_all(&self) -> Vec<Event> {
        let mut out = Vec::new();
        while let Ok(e) = self.try_recv() {
            out.push(e);
        }
        out
    }
}
