//! `Tracker`: poll-tråden, der binder platform, berigelse, segmenter og DB
//! sammen og leverer [`TrackerEvent`]s via callback eller kanal.
//!
//! Én almindelig OS-tråd (ingen async-runtime), så den passer til både GPUI's
//! executor og tests. En panik i et enkelt poll (fx i FFI) fanges og
//! rapporteres som [`TrackerEvent::Error`]; trackeren kører videre. En død
//! poll-tråd ligner nemlig en app, der bare holder op med at registrere.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;

use chrono::{DateTime, Duration, Utc};

use crate::config::TrackerConfig;
use crate::enrich::Enricher;
use crate::exclusion::ExclusionRule;
use crate::platform::{Platform, StopSignal};
use crate::segmenter::{Observation, Segmenter};
use crate::store::{ActivityStore, StoreError};
use crate::types::{ActivitySegment, TrackerEvent};

/// Modtager hændelser. Kaldes fra trackerens tråd; hold den hurtig.
pub type EventSink = Box<dyn FnMut(TrackerEvent) + Send + 'static>;

struct Shared {
    stop: StopSignal,
    paused: AtomicBool,
    config: Mutex<TrackerConfig>,
    config_dirty: AtomicBool,
    current: Mutex<Option<ActivitySegment>>,
}

/// Se modulbeskrivelsen. Stoppes med [`Tracker::stop`] eller ved drop; det
/// igangværende segment gemmes da.
pub struct Tracker {
    shared: Arc<Shared>,
    handle: Option<JoinHandle<()>>,
}

/// Hvor ofte DB-reglerne genlæses, og retention køres.
const RULES_REFRESH: Duration = Duration::seconds(30);
const RETENTION_EVERY: Duration = Duration::hours(1);

impl Tracker {
    /// Starter trackeren. `db_path = None` kører uden lagring (kun hændelser).
    pub fn start(
        config: TrackerConfig,
        db_path: Option<PathBuf>,
        platform: Box<dyn Platform>,
        sink: EventSink,
    ) -> Result<Tracker, StoreError> {
        let store = match db_path {
            Some(p) => Some(ActivityStore::open(&p)?),
            None => None,
        };
        Ok(Self::start_with_store(config, store, platform, sink))
    }

    /// Som [`Tracker::start`], men hændelserne leveres på en kanal.
    pub fn start_with_channel(
        config: TrackerConfig,
        db_path: Option<PathBuf>,
        platform: Box<dyn Platform>,
    ) -> Result<(Tracker, mpsc::Receiver<TrackerEvent>), StoreError> {
        let (tx, rx) = mpsc::channel();
        let t = Self::start(
            config,
            db_path,
            platform,
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        )?;
        Ok((t, rx))
    }

    /// Med en allerede åben DB (fx i hukommelsen i tests).
    pub fn start_with_store(
        config: TrackerConfig,
        store: Option<ActivityStore>,
        platform: Box<dyn Platform>,
        sink: EventSink,
    ) -> Tracker {
        let shared = Arc::new(Shared {
            stop: StopSignal::default(),
            paused: AtomicBool::new(false),
            config: Mutex::new(config),
            config_dirty: AtomicBool::new(false),
            current: Mutex::new(None),
        });
        let s2 = Arc::clone(&shared);
        let handle = std::thread::Builder::new()
            .name("tt-tracker".into())
            .spawn(move || run(s2, store, platform, sink))
            .expect("kunne ikke starte tracker-tråden");
        Tracker {
            shared,
            handle: Some(handle),
        }
    }

    /// Nye indstillinger; gælder fra næste poll.
    pub fn set_config(&self, config: TrackerConfig) {
        *lock(&self.shared.config) = config;
        self.shared.config_dirty.store(true, Ordering::SeqCst);
    }

    pub fn config(&self) -> TrackerConfig {
        lock(&self.shared.config).clone()
    }

    /// Det igangværende segment (til live-visning). `None` når idle eller pauset.
    pub fn current(&self) -> Option<ActivitySegment> {
        lock(&self.shared.current).clone()
    }

    /// Pause: det igangværende segment lukkes, og intet registreres, før
    /// [`Tracker::resume`].
    pub fn pause(&self) {
        self.shared.paused.store(true, Ordering::SeqCst);
    }

    pub fn resume(&self) {
        self.shared.paused.store(false, Ordering::SeqCst);
    }

    pub fn is_paused(&self) -> bool {
        self.shared.paused.load(Ordering::SeqCst)
    }

    pub fn is_running(&self) -> bool {
        self.handle.as_ref().is_some_and(|h| !h.is_finished())
    }

    /// Stopper og venter på, at det sidste segment er gemt.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.shared.stop.stop();
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for Tracker {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn run(
    shared: Arc<Shared>,
    store: Option<ActivityStore>,
    mut platform: Box<dyn Platform>,
    mut sink: EventSink,
) {
    let mut cfg = lock(&shared.config).clone();
    let mut segmenter = Segmenter::new(cfg.clone());
    let mut enricher = Enricher::new();
    let mut db_rules: Vec<ExclusionRule> = Vec::new();
    let mut rules_at: Option<DateTime<Utc>> = None;
    let mut retention_at: Option<DateTime<Utc>> = None;
    let mut was_paused = false;

    let emit = |ev: TrackerEvent, store: &Option<ActivityStore>, sink: &mut EventSink| {
        let ev = match ev {
            TrackerEvent::Segment(mut seg) => {
                if let Some(st) = store {
                    match st.insert(&seg) {
                        Ok(id) => seg.id = Some(id),
                        Err(e) => sink(TrackerEvent::Error(format!(
                            "kunne ikke gemme segment: {e}"
                        ))),
                    }
                }
                TrackerEvent::Segment(seg)
            }
            other => other,
        };
        sink(ev);
    };

    while !shared.stop.is_stopped() {
        let now = platform.now();

        if shared.config_dirty.swap(false, Ordering::SeqCst) {
            cfg = lock(&shared.config).clone();
            segmenter.set_config(cfg.clone());
        }
        if let Some(st) = &store {
            if rules_at.is_none_or(|t| now - t >= RULES_REFRESH) {
                match st.active_exclusion_rules() {
                    Ok(r) => db_rules = r,
                    Err(e) => sink(TrackerEvent::Error(format!(
                        "kunne ikke læse udelukkelsesregler: {e}"
                    ))),
                }
                rules_at = Some(now);
            }
            if retention_at.is_none_or(|t| now - t >= RETENTION_EVERY) {
                if let Err(e) = st.purge_older_than(now, cfg.retention_days) {
                    sink(TrackerEvent::Error(format!("retention fejlede: {e}")));
                }
                retention_at = Some(now);
            }
        }

        let paused = shared.paused.load(Ordering::SeqCst);
        if paused {
            if !was_paused {
                for ev in segmenter.flush(now) {
                    emit(ev, &store, &mut sink);
                }
                *lock(&shared.current) = None;
            }
            was_paused = true;
            platform.sleep(cfg.poll_interval(), &shared.stop);
            continue;
        }
        was_paused = false;

        let poll = catch_unwind(AssertUnwindSafe(|| {
            let idle_secs = platform.idle_seconds();
            let mut rules = cfg.exclusion_rules.clone();
            rules.extend(db_rules.iter().cloned());
            let window = platform
                .foreground()
                .and_then(|raw| enricher.enrich(raw, &cfg, &rules, platform.as_mut()));
            segmenter.observe(Observation {
                at: now,
                idle_secs,
                window,
            })
        }));
        match poll {
            Ok(events) => {
                for ev in events {
                    emit(ev, &store, &mut sink);
                }
            }
            Err(_) => sink(TrackerEvent::Error(
                "poll fejlede (panik fanget); trackeren kører videre".into(),
            )),
        }
        *lock(&shared.current) = segmenter.current(now);

        platform.sleep(cfg.poll_interval(), &shared.stop);
    }

    let end = platform.now();
    for ev in segmenter.flush(end) {
        emit(ev, &store, &mut sink);
    }
    *lock(&shared.current) = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{Frame, ScriptedPlatform};
    use crate::types::RawWindow;
    use chrono::TimeZone;

    fn win(app: &str, title: &str) -> Option<RawWindow> {
        Some(RawWindow {
            app_name: app.into(),
            title: title.into(),
            pid: Some(1),
            ..RawWindow::default()
        })
    }

    fn start() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 26, 8, 0, 0).unwrap()
    }

    fn frames(n: usize, f: impl Fn(usize) -> Frame) -> Vec<Frame> {
        (0..n).map(f).collect()
    }

    /// Venter til platformen selv har stoppet trackeren (scriptet er slut).
    fn collect(t: Tracker, rx: mpsc::Receiver<TrackerEvent>) -> Vec<TrackerEvent> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while t.is_running() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(!t.is_running(), "trackeren stoppede ikke selv");
        t.stop();
        rx.try_iter().collect()
    }

    #[test]
    fn end_to_end_day_with_idle_and_switch_is_stored() {
        // 2 s pr. frame: 10 min Code, 10 min Safari, så 15 min uden input, så Code.
        let f = frames(1200, |i| {
            let secs = i as u64 * 2;
            match secs {
                0..600 => Frame {
                    window: win("Code", "main.rs - api - Visual Studio Code"),
                    idle_secs: 0,
                },
                600..1200 => Frame {
                    window: win("Safari", "Kunde"),
                    idle_secs: 0,
                },
                1200..2100 => Frame {
                    window: win("Safari", "Kunde"),
                    idle_secs: secs - 1200,
                },
                _ => Frame {
                    window: win("Code", "main.rs - api - Visual Studio Code"),
                    idle_secs: 0,
                },
            }
        });
        let platform = ScriptedPlatform::new(start(), f);
        let store = ActivityStore::open_in_memory().unwrap();
        let (tx, rx) = mpsc::channel();
        let t = Tracker::start_with_store(
            TrackerConfig {
                exclude_incognito: true,
                ..TrackerConfig::default()
            },
            Some(store),
            Box::new(platform),
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        );
        let ev = collect(t, rx);
        let segs: Vec<_> = ev
            .iter()
            .filter_map(|e| {
                if let TrackerEvent::Segment(s) = e {
                    Some(s.clone())
                } else {
                    None
                }
            })
            .collect();
        let s = |x: i64| start() + Duration::seconds(x);
        assert_eq!(segs.len(), 4, "{segs:#?}");
        assert_eq!(
            (segs[0].app.as_str(), segs[0].start, segs[0].end),
            ("Code", s(0), s(600))
        );
        assert_eq!(
            (segs[1].app.as_str(), segs[1].start, segs[1].end),
            ("Safari", s(600), s(1200))
        );
        assert!(segs[2].idle);
        assert_eq!((segs[2].start, segs[2].end), (s(1200), s(2100)));
        assert_eq!((segs[3].app.as_str(), segs[3].start), ("Code", s(2100)));
        assert!(
            segs.iter().all(|x| x.id.is_some()),
            "alle segmenter er gemt"
        );
        assert!(ev.iter().any(|e| matches!(
            e,
            TrackerEvent::IdleReturn {
                duration_secs: 900,
                ..
            }
        )));
    }

    #[test]
    fn pause_closes_segment_and_records_nothing() {
        let f = frames(100, |_| Frame {
            window: win("Code", "a"),
            idle_secs: 0,
        });
        let mut platform = ScriptedPlatform::new(start(), f);
        platform.stop_when_done = true;
        let (tx, rx) = mpsc::channel();
        let t = Tracker::start_with_store(
            TrackerConfig::default(),
            None,
            Box::new(platform),
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        );
        t.pause();
        assert!(t.is_paused());
        let ev = collect(t, rx);
        // Det, der nåede at blive registreret før pausen, er højst ét segment.
        let n = ev
            .iter()
            .filter(|e| matches!(e, TrackerEvent::Segment(_)))
            .count();
        assert!(n <= 1, "{ev:?}");
    }

    #[test]
    fn excluded_windows_never_reach_sink_or_db() {
        let f = frames(30, |i| Frame {
            window: if i < 15 {
                win("KeePassXC", "Bank")
            } else {
                win("Code", "a")
            },
            idle_secs: 0,
        });
        let store = ActivityStore::open_in_memory().unwrap();
        store
            .add_exclusion_rule("app_name", "contains", "keepass")
            .unwrap();
        let (tx, rx) = mpsc::channel();
        let t = Tracker::start_with_store(
            TrackerConfig::default(),
            Some(store),
            Box::new(ScriptedPlatform::new(start(), f)),
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        );
        let ev = collect(t, rx);
        for e in &ev {
            if let TrackerEvent::Segment(s) = e {
                assert_ne!(s.app, "KeePassXC");
            }
        }
        assert!(
            ev.iter()
                .any(|e| matches!(e, TrackerEvent::Segment(s) if s.app == "Code"))
        );
    }

    #[test]
    fn stop_is_prompt_with_real_sleep() {
        struct Still;
        impl Platform for Still {
            fn foreground(&mut self) -> Option<RawWindow> {
                None
            }
            fn idle_seconds(&mut self) -> u64 {
                0
            }
        }
        let t = Tracker::start_with_store(
            TrackerConfig {
                poll_interval_ms: 60_000,
                ..TrackerConfig::default()
            },
            None,
            Box::new(Still),
            Box::new(|_| {}),
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(t.is_running());
        let at = std::time::Instant::now();
        t.stop();
        assert!(at.elapsed() < std::time::Duration::from_secs(5));
    }

    #[test]
    fn panic_in_platform_is_caught() {
        struct Boom(u32);
        impl Platform for Boom {
            fn foreground(&mut self) -> Option<RawWindow> {
                self.0 += 1;
                if self.0 == 1 {
                    panic!("FFI gik galt");
                }
                None
            }
            fn idle_seconds(&mut self) -> u64 {
                0
            }
            fn sleep(&mut self, _d: std::time::Duration, stop: &StopSignal) {
                if self.0 >= 3 {
                    stop.stop();
                }
            }
        }
        let (tx, rx) = mpsc::channel();
        let t = Tracker::start_with_store(
            TrackerConfig::default(),
            None,
            Box::new(Boom(0)),
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        );
        let ev = collect(t, rx);
        assert!(ev.iter().any(|e| matches!(e, TrackerEvent::Error(_))));
    }
}
