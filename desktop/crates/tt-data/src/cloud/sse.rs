//! Live-strømmen `/api/ext/stream` (SSE) med genforbindelse og backoff.
//!
//! Web sender kun type og version (`timer`, `data`, `ping`, `revoked`),
//! aldrig forretningsdata; klienten henter selv det ændrede. Løbenumrene
//! (`id:`) starter forfra ved hver forbindelse, så efter enhver
//! genforbindelse regnes alt som ændret (huller kan ikke ses).
//!
//! Strømmen kører i sin egen tråd, uafhængigt af UI'ets executor. Er den
//! nede eller slået fra (503), poller tråden i stedet: hvert
//! `poll_interval` gøres alt stale, og UI'et får `DataChanged`.

use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::events::Entity;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub id: Option<String>,
    pub event: String,
    pub data: String,
}

/// Linjebaseret SSE-parser (WHATWG-formatet, det web skriver).
#[derive(Debug, Default)]
pub struct SseParser {
    id: Option<String>,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn push_line(&mut self, line: &str) -> Option<SseEvent> {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            if self.data.is_empty() && self.event.is_none() {
                return None;
            }
            let ev = SseEvent {
                id: self.id.take(),
                event: self.event.take().unwrap_or_else(|| "message".into()),
                data: std::mem::take(&mut self.data).join("\n"),
            };
            return Some(ev);
        }
        if line.starts_with(':') {
            return None; // kommentar (": connected")
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_owned()),
            "data" => self.data.push(value.to_owned()),
            "id" => self.id = Some(value.to_owned()),
            _ => {}
        }
        None
    }
}

/// Hvad en hændelse fra web betyder for klienten.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamSignal {
    Timer { version: i64 },
    Data(Vec<Entity>),
    Revoked,
    Ping,
    Other,
}

#[derive(Deserialize)]
struct TimerFrame {
    #[serde(default)]
    version: i64,
}

#[derive(Deserialize)]
struct DataFrame {
    #[serde(default)]
    entities: Vec<String>,
}

pub fn classify(ev: &SseEvent) -> StreamSignal {
    match ev.event.as_str() {
        "timer" => StreamSignal::Timer {
            version: serde_json::from_str::<TimerFrame>(&ev.data).map(|t| t.version).unwrap_or(0),
        },
        "data" => StreamSignal::Data(
            serde_json::from_str::<DataFrame>(&ev.data)
                .map(|d| d.entities.iter().filter_map(|e| Entity::from_wire(e)).collect())
                .unwrap_or_else(|_| Entity::ALL.to_vec()),
        ),
        "revoked" => StreamSignal::Revoked,
        "ping" => StreamSignal::Ping,
        _ => StreamSignal::Other,
    }
}

/// Eksponentiel backoff med jitter (±20 %).
#[derive(Debug, Clone)]
pub struct Backoff {
    initial: Duration,
    max: Duration,
    current: Duration,
}

impl Backoff {
    pub fn new(initial: Duration, max: Duration) -> Self {
        Backoff { initial, max, current: initial }
    }

    pub fn next_delay(&mut self) -> Duration {
        let base = self.current;
        self.current = (self.current * 2).min(self.max);
        let nanos = uuid::Uuid::new_v4().as_u128() as u64 % 1000;
        let factor = 0.8 + (nanos as f64 / 1000.0) * 0.4;
        base.mul_f64(factor).min(self.max)
    }

    pub fn reset(&mut self) {
        self.current = self.initial;
    }
}

#[derive(Debug, Clone)]
pub struct RealtimeConfig {
    pub backoff_initial: Duration,
    pub backoff_max: Duration,
    /// Uden data så længe (web pinger hvert 25. s) = død forbindelse.
    pub idle_timeout: Duration,
    /// Polling-fallback, når strømmen er nede eller slået fra.
    pub poll_interval: Duration,
}

impl Default for RealtimeConfig {
    fn default() -> Self {
        RealtimeConfig {
            backoff_initial: Duration::from_secs(1),
            backoff_max: Duration::from_secs(60),
            idle_timeout: Duration::from_secs(60),
            poll_interval: Duration::from_secs(60),
        }
    }
}

pub enum Opened {
    Stream(Box<dyn Read + Send>),
    Unauthorized,
    /// 503: realtime slået fra på serveren. Poll i stedet.
    Disabled,
    Failed,
}

/// Det, strøm-tråden har brug for fra `CloudRepo`.
pub trait RealtimeHost: Send + Sync {
    /// None = ikke logget ind (tråden venter).
    fn open(&self, idle: Duration) -> Option<Opened>;
    fn connected(&self, connected: bool);
    fn signal(&self, signal: StreamSignal);
    /// Svar 401: prøv refresh. False = logget ud, stop tråden.
    fn unauthorized(&self) -> bool;
    /// Polling-fallback: gør alt stale og meld det.
    fn poll_tick(&self);
}

/// Kør strømmen, til `stop` sættes eller værten forsvinder.
pub fn run(host: Weak<dyn RealtimeHost>, stop: Arc<AtomicBool>, cfg: RealtimeConfig) {
    let mut backoff = Backoff::new(cfg.backoff_initial, cfg.backoff_max);
    let mut last_poll = Instant::now();
    while !stop.load(Ordering::SeqCst) {
        let Some(h) = host.upgrade() else { return };
        let opened = h.open(cfg.idle_timeout);
        drop(h);
        let wait = match opened {
            None => cfg.backoff_initial,
            Some(Opened::Stream(reader)) => {
                let Some(h) = host.upgrade() else { return };
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                h.connected(true);
                // Hændelser kan være tabt, mens der ikke var forbindelse (også
                // før første forbindelse: cachen kan være fra sidste kørsel).
                h.signal(StreamSignal::Data(Entity::ALL.to_vec()));
                backoff.reset();
                drop(h);
                let revoked = pump(reader, &host, &stop);
                // En stoppet tråd (fx ved org-skift) må ikke melde noget, så
                // den ikke overskriver den nye tråds tilstand.
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                if let Some(h) = host.upgrade() {
                    h.connected(false);
                }
                if revoked {
                    return;
                }
                last_poll = Instant::now();
                backoff.next_delay()
            }
            Some(Opened::Unauthorized) => {
                let Some(h) = host.upgrade() else { return };
                if !h.unauthorized() {
                    return;
                }
                backoff.next_delay()
            }
            Some(Opened::Disabled) => {
                if let Some(h) = host.upgrade() {
                    h.connected(false);
                }
                cfg.poll_interval
            }
            Some(Opened::Failed) => backoff.next_delay(),
        };
        // Vent (afbrydeligt) og poll undervejs, hvis ventetiden er lang.
        let deadline = Instant::now() + wait;
        while Instant::now() < deadline {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            if last_poll.elapsed() >= cfg.poll_interval {
                last_poll = Instant::now();
                match host.upgrade() {
                    Some(h) => h.poll_tick(),
                    None => return,
                }
            }
            std::thread::sleep(Duration::from_millis(20).min(wait));
        }
    }
}

/// Læs hændelser, til forbindelsen dør. True = tokenet er tilbagekaldt.
fn pump(reader: Box<dyn Read + Send>, host: &Weak<dyn RealtimeHost>, stop: &AtomicBool) -> bool {
    let mut parser = SseParser::default();
    let mut lines = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match lines.read_line(&mut line) {
            Ok(0) | Err(_) => return false,
            Ok(_) => {}
        }
        if stop.load(Ordering::SeqCst) {
            return false;
        }
        let Some(ev) = parser.push_line(line.trim_end_matches('\n')) else { continue };
        if stop.load(Ordering::SeqCst) {
            return false;
        }
        let signal = classify(&ev);
        let Some(h) = host.upgrade() else { return false };
        let revoked = signal == StreamSignal::Revoked;
        h.signal(signal);
        if revoked {
            return true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Vec<SseEvent> {
        let mut p = SseParser::default();
        text.split('\n').filter_map(|l| p.push_line(l)).collect()
    }

    #[test]
    fn parses_web_frames() {
        let text = ": connected\n\nevent: ping\ndata: {\"t\":1}\n\nid: 1\nevent: timer\ndata: {\"type\":\"timer\",\"event\":\"sync\",\"version\":7}\n\nid: 2\nevent: data\ndata: {\"type\":\"data\",\"entities\":[\"entries\",\"klippekort\",\"ukendt\"]}\n\nevent: revoked\ndata: {}\n\n";
        let evs = parse(text);
        assert_eq!(evs.len(), 4);
        assert_eq!(classify(&evs[0]), StreamSignal::Ping);
        assert_eq!(evs[1].id.as_deref(), Some("1"));
        assert_eq!(classify(&evs[1]), StreamSignal::Timer { version: 7 });
        assert_eq!(classify(&evs[2]), StreamSignal::Data(vec![Entity::Entries, Entity::Klippekort]));
        assert_eq!(classify(&evs[3]), StreamSignal::Revoked);
    }

    #[test]
    fn multiline_data_and_crlf() {
        let evs = parse("data: a\r\ndata: b\r\n\r\n");
        assert_eq!(evs[0].data, "a\nb");
        assert_eq!(evs[0].event, "message");
    }

    #[test]
    fn backoff_grows_to_max_and_resets() {
        let mut b = Backoff::new(Duration::from_secs(1), Duration::from_secs(8));
        let d: Vec<f64> = (0..6).map(|_| b.next_delay().as_secs_f64()).collect();
        assert!(d[0] >= 0.8 && d[0] <= 1.2, "{d:?}");
        assert!(d[3] >= 6.4 && d[3] <= 8.0, "{d:?}");
        assert!(d[5] <= 8.0);
        b.reset();
        assert!(b.next_delay() <= Duration::from_millis(1200));
    }
}
