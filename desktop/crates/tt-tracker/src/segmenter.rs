//! Ren tilstandsmaskine: polls ind, segmenter og hændelser ud.
//!
//! Ingen IO og intet ur: tiden kommer med hver [`Observation`], så al logik
//! kan testes deterministisk (idle, søvn, midnat, sommertid).
//!
//! Rettelser i forhold til 0.2:
//! - **Idle-fratræk.** 0.2 lukkede segmentet ved den poll, der opdagede
//!   idle, så de 5 minutters tærskel blev talt som arbejde hver gang. Nu
//!   lukkes segmentet ved sidste input (`at - idle_secs`), og idle-perioden
//!   bliver sit eget segment med `idle = true`.
//! - **Søvn.** Et hul mellem to polls (låg lukket, proces frosset) blev
//!   talt med i segmentet. Nu lukkes det ved sidste poll, og hullet bliver
//!   en idle-periode.
//! - **Tilbage fra idle.** Det nye segment starter, da inputtet kom igen,
//!   ikke ved næste poll.

use chrono::{DateTime, Duration, Utc};

use crate::config::TrackerConfig;
use crate::types::{ActivitySegment, Signals, TrackerEvent};

/// Én poll.
#[derive(Debug, Clone, PartialEq)]
pub struct Observation {
    pub at: DateTime<Utc>,
    /// Sekunder siden sidste tastatur- eller musinput.
    pub idle_secs: u64,
    /// Forgrundsvinduet efter udelukkelse og berigelse. `None` når der intet
    /// er, skærmen er låst, eller vinduet er udelukket (privat).
    pub window: Option<Signals>,
}

#[derive(Debug, Clone)]
struct Open {
    sig: Signals,
    start: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct IdleOpen {
    start: DateTime<Utc>,
}

/// Se modulbeskrivelsen.
#[derive(Debug, Clone)]
pub struct Segmenter {
    cfg: TrackerConfig,
    current: Option<Open>,
    /// Et netop afsluttet segment under minimumsvarigheden, holdt tilbage én
    /// overgang: ved A(kort) → B(kort) → A fortsætter A med sin oprindelige
    /// start i stedet for at blive til to tabte stumper.
    pending_short: Option<Open>,
    idle: Option<IdleOpen>,
    last_poll: Option<DateTime<Utc>>,
    /// Sidste input set ved forrige poll (til søvn-huller).
    last_input: Option<DateTime<Utc>>,
    /// Slutningen af det senest lukkede arbejdssegment. En idle-periode starter
    /// aldrig før den, så segmenter ikke overlapper.
    last_end: Option<DateTime<Utc>>,
}

impl Segmenter {
    pub fn new(cfg: TrackerConfig) -> Self {
        Self {
            cfg,
            current: None,
            pending_short: None,
            idle: None,
            last_poll: None,
            last_input: None,
            last_end: None,
        }
    }

    /// Idle starter ved sidste input, men aldrig før det sidst lukkede segment.
    fn idle_start(&self, last_input: DateTime<Utc>, at: DateTime<Utc>) -> DateTime<Utc> {
        let s = match self.last_end {
            Some(e) => last_input.max(e),
            None => last_input,
        };
        s.min(at)
    }

    pub fn set_config(&mut self, cfg: TrackerConfig) {
        self.cfg = cfg;
    }

    pub fn config(&self) -> &TrackerConfig {
        &self.cfg
    }

    /// Det igangværende segment, som det ville se ud, hvis det sluttede `at`.
    pub fn current(&self, at: DateTime<Utc>) -> Option<ActivitySegment> {
        if let Some(c) = &self.current {
            return Some(c.sig.clone().into_segment(c.start, at.max(c.start), false));
        }
        None
    }

    /// Sand mens brugeren er idle.
    pub fn is_idle(&self) -> bool {
        self.idle.is_some()
    }

    pub fn observe(&mut self, obs: Observation) -> Vec<TrackerEvent> {
        let mut out = Vec::new();
        let at = obs.at;

        // Søvn eller frossen proces: luk det aktive segment ved sidste input
        // før hullet, og lad hullet være en idle-periode.
        if let Some(last) = self.last_poll
            && (at - last).num_seconds() > self.cfg.max_poll_gap_secs()
        {
            let end = self.last_input.unwrap_or(last).min(last);
            if let Some(cur) = self.current.take() {
                let end = end.max(cur.start);
                self.close(cur, end, &mut out);
            }
            self.pending_short = None;
            if self.idle.is_none() {
                self.idle = Some(IdleOpen {
                    start: self.idle_start(end, last),
                });
            }
        }
        // Et ur, der går baglæns (NTP), må aldrig give negative segmenter.
        let at = match self.last_poll {
            Some(last) if at < last => last,
            _ => at,
        };
        self.last_poll = Some(at);

        let last_input = at - Duration::seconds(obs.idle_secs.min(i64::MAX as u64) as i64);
        self.last_input = Some(last_input);
        let mut is_idle = decide_idle(
            obs.idle_secs,
            self.cfg.idle_threshold_secs,
            obs.window.as_ref().map(|w| w.app.as_str()),
            &self.cfg.meeting_apps,
            self.cfg.meeting_max_idle_secs,
        );
        // Møde-undtagelsen holder kun et AKTIVT segment i live. Et mødevindue,
        // der kommer i front uden input (indgående opkald), afslutter aldrig en
        // idle-periode; det kræver input.
        if self.idle.is_some() && obs.idle_secs >= self.cfg.idle_threshold_secs {
            is_idle = true;
        }

        if is_idle {
            if let Some(cur) = self.current.take() {
                // Tærsklen er ikke arbejde: segmentet sluttede ved sidste input.
                let end = last_input.max(cur.start).min(at);
                self.close(cur, end, &mut out);
            }
            self.pending_short = None;
            if self.idle.is_none() {
                self.idle = Some(IdleOpen {
                    start: self.idle_start(last_input, at),
                });
            }
            return out;
        }

        // Aktiv. Kom brugeren lige tilbage, starter det nye segment da
        // inputtet kom igen.
        let mut start_at = at;
        if let Some(idle) = self.idle.take() {
            let resume = last_input.max(idle.start).min(at);
            self.close_idle(idle.start, resume, true, &mut out);
            start_at = resume;
        }

        match (obs.window, self.current.take()) {
            (None, Some(cur)) => {
                // Låst skærm eller privat vindue: arbejdet sluttede ved sidste
                // input (tid uden input under tærsklen tælles kun, hvis
                // brugeren bliver i vinduet).
                let end = last_input.max(cur.start).min(at);
                self.close(cur, end, &mut out);
                self.pending_short = None;
            }
            (None, None) => {}
            (Some(sig), None) => {
                self.current = Some(Open {
                    sig,
                    start: start_at,
                });
            }
            (Some(sig), Some(mut cur)) => {
                if cur.sig.same_identity(&sig) {
                    // En sen URL (første probe kan time ud) må udfylde et hul,
                    // men en allerede fanget URL bevares.
                    if cur.sig.url.is_none() && sig.url.is_some() {
                        cur.sig.url = sig.url;
                        cur.sig.domain = sig.domain;
                    }
                    self.current = Some(cur);
                } else {
                    let old_is_flicker = (at - cur.start).num_seconds() < self.cfg.min_segment_secs;
                    let resumes_pending = self
                        .pending_short
                        .as_ref()
                        .is_some_and(|p| p.sig.same_identity(&sig));
                    let genvej = if old_is_flicker {
                        tag_genvej(&mut self.pending_short, resumes_pending)
                    } else {
                        None
                    };
                    if let Some(resumed) = genvej {
                        self.current = Some(resumed);
                    } else {
                        if old_is_flicker {
                            self.pending_short = Some(cur);
                        } else {
                            self.close(cur, at, &mut out);
                            self.pending_short = None;
                        }
                        self.current = Some(Open {
                            sig,
                            start: start_at.min(at),
                        });
                    }
                }
            }
        }
        out
    }

    /// Lukker alt ved stop. En åben idle-periode afsluttes også, men uden
    /// "Hvad lavede du?"-spørgsmål: brugeren er ikke kommet tilbage.
    pub fn flush(&mut self, at: DateTime<Utc>) -> Vec<TrackerEvent> {
        let mut out = Vec::new();
        let at = self.last_poll.map_or(at, |l| at.max(l));
        if let Some(cur) = self.current.take() {
            self.close(cur, at, &mut out);
        }
        if let Some(idle) = self.idle.take() {
            self.close_idle(idle.start, at, false, &mut out);
        }
        self.pending_short = None;
        // Pause eller stop: næste poll er en frisk start, ikke et søvn-hul.
        self.last_poll = None;
        self.last_input = None;
        out
    }

    fn close(&mut self, cur: Open, end: DateTime<Utc>, out: &mut Vec<TrackerEvent>) {
        let end = end.max(cur.start);
        self.last_end = Some(self.last_end.map_or(end, |e| e.max(end)));
        if (end - cur.start).num_seconds() < self.cfg.min_segment_secs {
            return;
        }
        out.push(TrackerEvent::Segment(
            cur.sig.into_segment(cur.start, end, false),
        ));
    }

    fn close_idle(
        &self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        returned: bool,
        out: &mut Vec<TrackerEvent>,
    ) {
        let secs = (end - start).num_seconds();
        if secs <= 0 {
            return;
        }
        out.push(TrackerEvent::Segment(
            Signals {
                app: "Idle".into(),
                app_id: "idle".into(),
                ..Signals::default()
            }
            .into_segment(start, end, true),
        ));
        if returned
            && should_prompt_return(
                secs as u64,
                self.cfg.idle_prompt_threshold_secs,
                self.cfg.idle_prompt_enabled,
                false,
            )
        {
            out.push(TrackerEvent::IdleReturn {
                start,
                end,
                duration_secs: secs,
            });
        }
    }
}

/// Afgør om en poll er idle.
///
/// Normalt: input inaktivt i mindst `idle_threshold` sekunder er idle.
///
/// Møde-undtagelse: er et mødeprogram i forgrunden, ser og lytter brugeren
/// sandsynligvis, så perioden er ikke idle. Men kun op til
/// `meeting_max_idle_secs`: Teams i forgrunden under en frokost på 3 timer
/// må aldrig blive til 3 timers møde. Derefter gælder normal idle, og
/// segmentet lukkes ved sidste input. "Hvad lavede du?" fanger resten.
pub fn decide_idle(
    idle_secs: u64,
    idle_threshold: u64,
    foreground_app: Option<&str>,
    meeting_apps: &[String],
    meeting_max_idle_secs: u64,
) -> bool {
    if idle_secs < idle_threshold {
        return false;
    }
    if idle_secs <= meeting_max_idle_secs
        && let Some(app) = foreground_app
        && is_meeting_app(app, meeting_apps)
    {
        return false;
    }
    true
}

/// Mødeprogram? Understreng uden hensyn til store og små bogstaver.
pub fn is_meeting_app(app_name: &str, meeting_apps: &[String]) -> bool {
    let app_lower = app_name.to_lowercase();
    meeting_apps.iter().any(|m| {
        let needle = m.trim().to_lowercase();
        !needle.is_empty() && app_lower.contains(&needle)
    })
}

/// Skal tilbagevenden fra idle give "Hvad lavede du?"-spørgsmålet?
pub fn should_prompt_return(
    idle_secs: u64,
    prompt_threshold_secs: u64,
    enabled: bool,
    paused: bool,
) -> bool {
    enabled && !paused && idle_secs >= prompt_threshold_secs
}

/// Tager det bagholdte segment, når en A→B→A-genvej er berettiget.
///
/// 0.2 havde `pending_short.take().expect(...)`: et panic i trackerens egen
/// tråd på en invariant, intet kunne håndhæve. En død poll-tråd ligner en app,
/// der bare holder op med at registrere. Derfor tages segmentet kun, hvis det
/// faktisk er der.
fn tag_genvej(pending_short: &mut Option<Open>, resumes_pending: bool) -> Option<Open> {
    if !resumes_pending {
        return None;
    }
    pending_short.take()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(secs: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 26, 8, 0, 0).unwrap() + Duration::seconds(secs)
    }

    fn sig(app: &str, title: &str) -> Signals {
        Signals {
            app: app.into(),
            app_id: app.to_lowercase(),
            title: title.into(),
            ..Signals::default()
        }
    }

    fn cfg() -> TrackerConfig {
        TrackerConfig {
            idle_threshold_secs: 300,
            min_segment_secs: 5,
            idle_prompt_threshold_secs: 600,
            poll_interval_ms: 2000,
            ..TrackerConfig::default()
        }
    }

    /// Kører en række polls hvert 2. sekund fra `from` til `to` (eksklusiv).
    fn run(
        s: &mut Segmenter,
        from: i64,
        to: i64,
        idle_at: impl Fn(i64) -> u64,
        win: impl Fn(i64) -> Option<Signals>,
    ) -> Vec<TrackerEvent> {
        let mut out = Vec::new();
        let mut x = from;
        while x < to {
            out.extend(s.observe(Observation {
                at: t(x),
                idle_secs: idle_at(x),
                window: win(x),
            }));
            x += 2;
        }
        out
    }

    fn segments(ev: &[TrackerEvent]) -> Vec<ActivitySegment> {
        ev.iter()
            .filter_map(|e| match e {
                TrackerEvent::Segment(s) => Some(s.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn idle_threshold_is_not_counted_as_work() {
        // Arbejde 0..600 s, så ingen input i 20 min. Sidste input ved 600.
        let mut s = Segmenter::new(cfg());
        let ev = run(
            &mut s,
            0,
            600 + 1200,
            |x| if x <= 600 { 0 } else { (x - 600) as u64 },
            |_| Some(sig("Code", "main.rs")),
        );
        let segs = segments(&ev);
        assert_eq!(
            segs.len(),
            1,
            "kun arbejdssegmentet er lukket endnu: {segs:?}"
        );
        assert_eq!(segs[0].start, t(0));
        assert_eq!(
            segs[0].end,
            t(600),
            "segmentet lukkes ved sidste input, ikke ved tærsklen"
        );
        assert!(!segs[0].idle);
        assert!(s.is_idle());

        // Brugeren kommer tilbage ved 1800 s.
        let ev = s.observe(Observation {
            at: t(1800),
            idle_secs: 0,
            window: Some(sig("Code", "main.rs")),
        });
        let segs = segments(&ev);
        assert_eq!(segs.len(), 1);
        assert!(segs[0].idle);
        assert_eq!((segs[0].start, segs[0].end), (t(600), t(1800)));
        assert!(ev.iter().any(|e| matches!(
            e,
            TrackerEvent::IdleReturn {
                duration_secs: 1200,
                ..
            }
        )));

        // Nyt arbejdssegment starter ved 1800.
        assert_eq!(s.current(t(1810)).unwrap().start, t(1800));
    }

    #[test]
    fn short_idle_does_not_prompt_but_is_still_subtracted() {
        let mut c = cfg();
        c.idle_threshold_secs = 60;
        let mut s = Segmenter::new(c);
        // Arbejde til 100, idle til 300 (200 s < prompt 600).
        let mut ev = run(
            &mut s,
            0,
            300,
            |x| if x <= 100 { 0 } else { (x - 100) as u64 },
            |_| Some(sig("Code", "a")),
        );
        ev.extend(s.observe(Observation {
            at: t(300),
            idle_secs: 1,
            window: Some(sig("Code", "a")),
        }));
        let segs = segments(&ev);
        assert_eq!(segs[0].end, t(100));
        assert_eq!(
            (segs[1].start, segs[1].end, segs[1].idle),
            (t(100), t(299), true)
        );
        assert!(
            !ev.iter()
                .any(|e| matches!(e, TrackerEvent::IdleReturn { .. }))
        );
        assert_eq!(
            s.current(t(300)).unwrap().start,
            t(299),
            "ny start er da inputtet kom igen"
        );
    }

    #[test]
    fn switching_windows_closes_at_switch() {
        let mut s = Segmenter::new(cfg());
        let ev = run(
            &mut s,
            0,
            100,
            |_| 0,
            |x| {
                Some(if x < 50 {
                    sig("Code", "a")
                } else {
                    sig("Safari", "b")
                })
            },
        );
        let segs = segments(&ev);
        assert_eq!(segs.len(), 1);
        assert_eq!((segs[0].start, segs[0].end), (t(0), t(50)));
        let cur = s.current(t(100)).unwrap();
        assert_eq!((cur.app.as_str(), cur.start), ("Safari", t(50)));
    }

    #[test]
    fn sleep_gap_is_not_counted_and_becomes_idle() {
        let mut s = Segmenter::new(cfg());
        let mut ev = run(&mut s, 0, 100, |_| 0, |_| Some(sig("Code", "a")));
        // Låget lukkes efter poll ved 98; næste poll 2 timer senere med frisk input
        // (macOS nulstiller idle ved opvågning).
        ev.extend(s.observe(Observation {
            at: t(98 + 7200),
            idle_secs: 0,
            window: Some(sig("Code", "a")),
        }));
        let segs = segments(&ev);
        assert_eq!(
            (segs[0].start, segs[0].end, segs[0].idle),
            (t(0), t(98), false)
        );
        assert_eq!(
            (segs[1].start, segs[1].end, segs[1].idle),
            (t(98), t(98 + 7200), true)
        );
        assert!(
            ev.iter()
                .any(|e| matches!(e, TrackerEvent::IdleReturn { .. }))
        );
        assert_eq!(s.current(t(98 + 7210)).unwrap().start, t(98 + 7200));
    }

    #[test]
    fn meeting_app_keeps_segment_until_afk_cap() {
        let mut c = cfg();
        c.meeting_max_idle_secs = 3600;
        let mut s = Segmenter::new(c);
        // Teams i forgrunden, intet input efter 0 s.
        let ev = run(
            &mut s,
            0,
            3000,
            |x| x as u64,
            |_| Some(sig("Microsoft Teams", "Møde")),
        );
        assert!(segments(&ev).is_empty(), "mødet kører stadig");
        assert_eq!(s.current(t(3000)).unwrap().start, t(0));
        // Over loftet: idle, og mødet lukkes ved sidste input (her 0 s, så
        // under minimum og intet segment). "Hvad lavede du?" fanger tiden.
        let ev = run(
            &mut s,
            3000,
            3700,
            |x| x as u64,
            |_| Some(sig("Microsoft Teams", "Møde")),
        );
        assert!(segments(&ev).iter().all(|s| s.idle) || segments(&ev).is_empty());
        assert!(s.is_idle());
    }

    #[test]
    fn meeting_with_some_input_ends_at_last_input_after_cap() {
        let mut c = cfg();
        c.meeting_max_idle_secs = 600;
        let mut s = Segmenter::new(c);
        // Input til 100 s, så stilhed. Loft 600 → idle ved 700.
        let ev = run(
            &mut s,
            0,
            800,
            |x| if x <= 100 { 0 } else { (x - 100) as u64 },
            |_| Some(sig("zoom.us", "Zoom")),
        );
        let segs = segments(&ev);
        assert_eq!(segs.len(), 1);
        assert_eq!((segs[0].start, segs[0].end), (t(0), t(100)));
    }

    #[test]
    fn flicker_a_b_a_resumes_a_with_original_start() {
        let mut s = Segmenter::new(cfg());
        let mut ev = Vec::new();
        ev.extend(s.observe(Observation {
            at: t(0),
            idle_secs: 0,
            window: Some(sig("Code", "a")),
        }));
        ev.extend(s.observe(Observation {
            at: t(2),
            idle_secs: 0,
            window: Some(sig("Slack", "b")),
        }));
        ev.extend(s.observe(Observation {
            at: t(4),
            idle_secs: 0,
            window: Some(sig("Code", "a")),
        }));
        ev.extend(run(&mut s, 6, 60, |_| 0, |_| Some(sig("Code", "a"))));
        ev.extend(s.flush(t(60)));
        let segs = segments(&ev);
        assert_eq!(segs.len(), 1, "{segs:?}");
        assert_eq!(
            (segs[0].title.as_str(), segs[0].start, segs[0].end),
            ("a", t(0), t(60))
        );
    }

    #[test]
    fn short_segments_are_dropped() {
        let mut s = Segmenter::new(cfg());
        let mut ev = Vec::new();
        ev.extend(run(&mut s, 0, 20, |_| 0, |_| Some(sig("Code", "a"))));
        ev.extend(s.observe(Observation {
            at: t(20),
            idle_secs: 0,
            window: Some(sig("X", "flimmer")),
        }));
        ev.extend(s.observe(Observation {
            at: t(22),
            idle_secs: 0,
            window: Some(sig("Y", "andet")),
        }));
        ev.extend(run(&mut s, 24, 40, |_| 0, |_| Some(sig("Y", "andet"))));
        ev.extend(s.flush(t(40)));
        let titles: Vec<_> = segments(&ev).into_iter().map(|s| s.title).collect();
        assert_eq!(titles, vec!["a", "andet"]);
    }

    #[test]
    fn no_window_closes_current() {
        let mut s = Segmenter::new(cfg());
        let mut ev = run(&mut s, 0, 30, |_| 0, |_| Some(sig("Code", "a")));
        ev.extend(s.observe(Observation {
            at: t(30),
            idle_secs: 0,
            window: None,
        }));
        let segs = segments(&ev);
        assert_eq!((segs[0].start, segs[0].end), (t(0), t(30)));
        assert!(s.current(t(31)).is_none());
    }

    #[test]
    fn identity_includes_repo_path_and_document_but_not_url() {
        let mut a = sig("Code", "main.rs");
        a.repo_remote = Some("github.com/a/website".into());
        let mut b = a.clone();
        b.repo_remote = Some("github.com/b/website".into());
        assert!(
            !a.same_identity(&b),
            "to kunders website-repo er to segmenter"
        );
        let mut c = a.clone();
        c.path = Some("/x".into());
        assert!(!a.same_identity(&c));
        let mut d = a.clone();
        d.url = Some("https://a.dk/x".into());
        assert!(a.same_identity(&d), "URL-skift splitter ikke");
    }

    #[test]
    fn late_url_backfills_but_never_replaces() {
        let mut s = Segmenter::new(cfg());
        s.observe(Observation {
            at: t(0),
            idle_secs: 0,
            window: Some(sig("Safari", "Side")),
        });
        let mut w = sig("Safari", "Side");
        w.url = Some("https://a.dk/".into());
        w.domain = Some("a.dk".into());
        s.observe(Observation {
            at: t(2),
            idle_secs: 0,
            window: Some(w),
        });
        let mut w2 = sig("Safari", "Side");
        w2.url = Some("https://b.dk/".into());
        s.observe(Observation {
            at: t(4),
            idle_secs: 0,
            window: Some(w2),
        });
        let cur = s.current(t(6)).unwrap();
        assert_eq!(cur.url.as_deref(), Some("https://a.dk/"));
        assert_eq!(cur.domain.as_deref(), Some("a.dk"));
    }

    #[test]
    fn clock_going_backwards_never_gives_negative_segments() {
        let mut s = Segmenter::new(cfg());
        let mut ev = run(&mut s, 0, 20, |_| 0, |_| Some(sig("Code", "a")));
        ev.extend(s.observe(Observation {
            at: t(10),
            idle_secs: 0,
            window: Some(sig("Safari", "b")),
        }));
        ev.extend(s.flush(t(5)));
        for seg in segments(&ev) {
            assert!(seg.end >= seg.start, "{seg:?}");
        }
    }

    #[test]
    fn flush_closes_open_idle_without_prompt() {
        let mut s = Segmenter::new(cfg());
        let mut ev = run(
            &mut s,
            0,
            1000,
            |x| if x <= 100 { 0 } else { (x - 100) as u64 },
            |_| Some(sig("Code", "a")),
        );
        ev.extend(s.flush(t(1000)));
        let segs = segments(&ev);
        assert_eq!(segs.len(), 2);
        assert!(segs[1].idle);
        assert!(
            !ev.iter()
                .any(|e| matches!(e, TrackerEvent::IdleReturn { .. }))
        );
    }

    // ---- porteret fra 0.2 ----

    #[test]
    fn decide_idle_whitelisted_app_over_threshold_not_idle() {
        let meeting = vec!["teams".to_string(), "zoom".to_string()];
        assert!(!decide_idle(600, 300, Some("Teams"), &meeting, 7200));
    }

    #[test]
    fn decide_idle_non_whitelisted_over_threshold_is_idle() {
        let meeting = vec!["teams".to_string()];
        assert!(decide_idle(600, 300, Some("code"), &meeting, 7200));
    }

    #[test]
    fn decide_idle_whitelisted_app_over_afk_cap_is_idle() {
        let meeting = vec!["teams".to_string()];
        assert!(decide_idle(8000, 300, Some("Teams"), &meeting, 7200));
    }

    #[test]
    fn decide_idle_whitelisted_app_under_threshold_not_idle() {
        let meeting = vec!["teams".to_string()];
        assert!(!decide_idle(120, 300, Some("Teams"), &meeting, 7200));
    }

    #[test]
    fn decide_idle_no_foreground_uses_normal_logic() {
        assert!(decide_idle(600, 300, None, &[], 7200));
        assert!(!decide_idle(120, 300, None, &[], 7200));
    }

    #[test]
    fn is_meeting_app_matches_case_insensitively() {
        let m = vec!["teams".to_string(), " ".to_string()];
        assert!(is_meeting_app("Microsoft Teams", &m));
        assert!(!is_meeting_app("Code", &m));
    }

    #[test]
    fn should_prompt_return_rules() {
        assert!(!should_prompt_return(240, 600, true, false));
        assert!(should_prompt_return(600, 600, true, false));
        assert!(should_prompt_return(2820, 600, true, false));
        assert!(!should_prompt_return(3600, 600, false, false));
        assert!(!should_prompt_return(3600, 600, true, true));
    }

    #[test]
    fn genvej_tager_det_bagholdte_segment() {
        let mut pending = Some(Open {
            sig: sig("code", "main.rs"),
            start: t(0),
        });
        assert!(tag_genvej(&mut pending, true).is_some());
        assert!(pending.is_none(), "segmentet må ikke kunne tages to gange");
    }

    #[test]
    fn genvej_uden_et_bagholdt_segment_draper_ikke() {
        let mut pending: Option<Open> = None;
        assert!(tag_genvej(&mut pending, true).is_none());
    }

    #[test]
    fn en_uberettiget_genvej_beholder_det_bagholdte_segment() {
        let mut pending = Some(Open {
            sig: sig("code", "main.rs"),
            start: t(0),
        });
        assert!(tag_genvej(&mut pending, false).is_none());
        assert!(pending.is_some());
    }

    // ---- review 26/10: fejl fundet af frisk review ----

    #[test]
    fn meeting_app_in_front_without_input_does_not_end_idle() {
        // Code til 0 s, idle fra 300 s. Ved 1800 s kommer Teams i front uden input.
        let mut s = Segmenter::new(cfg());
        let mut ev = run(&mut s, 0, 1800, |x| x as u64, |_| Some(sig("Code", "a")));
        ev.extend(run(
            &mut s,
            1800,
            3600,
            |x| x as u64,
            |_| Some(sig("Microsoft Teams", "Opkald")),
        ));
        assert!(
            s.is_idle(),
            "et mødevindue uden input må ikke afslutte idle"
        );
        assert!(s.current(t(3600)).is_none());
        // Brugeren kommer tilbage ved 3600 s.
        ev.extend(s.observe(Observation {
            at: t(3600),
            idle_secs: 0,
            window: Some(sig("Microsoft Teams", "Opkald")),
        }));
        let segs = segments(&ev);
        assert!(segs.iter().all(|x| x.idle || x.end <= t(0)), "{segs:?}");
        assert!(ev.iter().any(|e| matches!(
            e,
            TrackerEvent::IdleReturn {
                duration_secs: 3600,
                ..
            }
        )));
        assert_eq!(s.current(t(3601)).unwrap().start, t(3600));
    }

    #[test]
    fn pause_flush_then_resume_records_no_idle() {
        let mut s = Segmenter::new(cfg());
        let mut ev = run(&mut s, 0, 60, |_| 0, |_| Some(sig("Code", "a")));
        ev.extend(s.flush(t(60)));
        // En times pause; første poll efter genoptagelse.
        ev.extend(s.observe(Observation {
            at: t(3660),
            idle_secs: 0,
            window: Some(sig("Code", "a")),
        }));
        let segs = segments(&ev);
        assert_eq!(segs.len(), 1, "{segs:?}");
        assert!(!segs[0].idle);
        assert!(
            !ev.iter()
                .any(|e| matches!(e, TrackerEvent::IdleReturn { .. }))
        );
        assert_eq!(s.current(t(3670)).unwrap().start, t(3660));
    }

    #[test]
    fn lock_before_threshold_closes_at_last_input_without_overlap() {
        // Sidste input ved 100 s; skærmen låses ved 220 s (vindue = None).
        let mut s = Segmenter::new(cfg());
        let mut ev = run(
            &mut s,
            0,
            220,
            |x| if x <= 100 { 0 } else { (x - 100) as u64 },
            |_| Some(sig("Code", "a")),
        );
        ev.extend(run(&mut s, 220, 1000, |x| (x - 100) as u64, |_| None));
        ev.extend(s.observe(Observation {
            at: t(1000),
            idle_secs: 0,
            window: Some(sig("Code", "a")),
        }));
        let segs = segments(&ev);
        assert_eq!(
            (segs[0].start, segs[0].end, segs[0].idle),
            (t(0), t(100), false)
        );
        assert_eq!(
            (segs[1].start, segs[1].end, segs[1].idle),
            (t(100), t(1000), true)
        );
        for w in segs.windows(2) {
            assert!(w[0].end <= w[1].start, "overlap: {w:?}");
        }
    }

    #[test]
    fn sleep_gap_closes_at_last_input_before_sleep() {
        // Læser uden input fra 60 s, låget lukkes efter poll ved 98 s.
        let mut s = Segmenter::new(cfg());
        let mut ev = run(
            &mut s,
            0,
            100,
            |x| if x <= 60 { 0 } else { (x - 60) as u64 },
            |_| Some(sig("Code", "a")),
        );
        ev.extend(s.observe(Observation {
            at: t(3700),
            idle_secs: 0,
            window: Some(sig("Code", "a")),
        }));
        let segs = segments(&ev);
        assert_eq!((segs[0].end, segs[0].idle), (t(60), false));
        assert_eq!(
            (segs[1].start, segs[1].end, segs[1].idle),
            (t(60), t(3700), true)
        );
    }

    #[test]
    fn excluded_window_while_typing_ends_segment_at_switch() {
        // Vindue = None kan også være et privat vindue, mens brugeren skriver.
        let mut s = Segmenter::new(cfg());
        let mut ev = run(&mut s, 0, 50, |_| 0, |_| Some(sig("Code", "a")));
        ev.extend(s.observe(Observation {
            at: t(50),
            idle_secs: 1,
            window: None,
        }));
        let segs = segments(&ev);
        assert_eq!(segs[0].end, t(49));
    }
}
