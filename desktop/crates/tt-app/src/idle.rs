//! Idle-spørgsmålet (spec D21): brugeren har været væk, mens en timer kørte.
//!
//! Trackeren giver et signal, når brugeren er tilbage efter en pause
//! ([`IdleReturnEvent`]). Kørte en timer hele tiden, spørger appen: **behold**
//! tiden, **træk** den fra, eller **træk den fra og stop** timeren.
//!
//! Fradraget er ét kald ([`Backend::timer_subtract_idle`]): timeren stoppes,
//! og posten gemmes allerede kortet. Ved "træk fra" startes timeren igen på
//! samme mål. "Træk fra og tildel til …" registrerer tiden på en anden
//! kunde, før den trækkes fra ([`resolve_assign`]). Det gælder som et stop, så det virker også, når appen er låst
//! (prøven er udløbet). Går noget galt, er den gemte tid aldrig tabt: enten
//! er stop og kortning sket, eller intet er ændret.

use chrono::{DateTime, Local, Utc};

use crate::backend::d21::IdlePromptSettings;
use crate::backend::services::IdleReturnEvent;
use crate::backend::{
    Backend, BackendError, EntryInput, Result, TimerState, TimerStatus, TimerTarget,
};
use crate::i18n::{t, tf};

/// Spørgsmålet, brugeren skal svare på.
#[derive(Clone, Debug, PartialEq)]
pub struct IdlePrompt {
    pub away_since: DateTime<Local>,
    pub back_at: DateTime<Local>,
    /// Sekunder væk, regnet fra det senere af pausens start og timerens start.
    pub away_secs: u64,
    /// Timerens mål, så "træk fra" kan starte en ny på det samme.
    pub target: TimerTarget,
    /// Starten på den timer, spørgsmålet gælder. Er timeren skiftet, før
    /// brugeren svarer, trækkes intet fra (`IdleOutcome::TimerChanged`).
    pub timer_started: Option<DateTime<Local>>,
    /// Antal pauser, spørgsmålet samler (1, medmindre flere pauser kom for
    /// den samme timer, før brugeren svarede; se [`IdleQueue::push`]).
    pub periods: u32,
}

impl IdlePrompt {
    /// "12 minutter" eller "1 t 5 min".
    pub fn away_text(&self) -> String {
        format_away(self.away_secs)
    }

    /// Hele minutter, der trækkes fra (rundet, mindst 1).
    pub fn minutes_to_subtract(&self) -> u32 {
        (((self.away_secs + 30) / 60) as u32).max(1)
    }

    /// Teksten i dialogen: hvor længe og hvornår. Samler spørgsmålet flere
    /// pauser, siges det, og tiden er summen.
    pub fn text(&self) -> String {
        let range = tf(
            "d21.idle.range",
            &[
                ("from", &self.away_since.format("%H:%M").to_string()),
                ("to", &self.back_at.format("%H:%M").to_string()),
            ],
        );
        if self.periods > 1 {
            tf(
                "d21.idle.text_many",
                &[
                    ("away", &self.away_text()),
                    ("n", &self.periods.to_string()),
                    ("range", &range),
                ],
            )
        } else {
            tf("d21.idle.text", &[("away", &self.away_text()), ("range", &range)])
        }
    }

    /// Gælder spørgsmålene den samme timer: samme start og samme mål? Uden
    /// kendt start kan det ikke afgøres, og så er svaret nej.
    pub fn same_timer(&self, other: &IdlePrompt) -> bool {
        self.timer_started.is_some()
            && self.timer_started == other.timer_started
            && self.target.customer_id == other.target.customer_id
            && self.target.project_id == other.target.project_id
            && self.target.task_id == other.target.task_id
    }

    /// Læg en senere pause for samme timer til. Tid, der overlapper den
    /// pause, spørgsmålet allerede har, tælles kun én gang.
    fn absorb(&mut self, later: &IdlePrompt) {
        let from = later.away_since.max(self.back_at);
        let extra = (later.back_at - from).num_seconds().max(0) as u64;
        self.away_secs += extra;
        self.away_since = self.away_since.min(later.away_since);
        self.back_at = self.back_at.max(later.back_at);
        self.periods += later.periods.max(1);
    }
}

/// Idle-spørgsmålene, der venter på svar. Det første vises; resten venter i
/// rækkefølge.
///
/// Kommer en ny pause, mens et spørgsmål er ubesvaret, og gælder den samme
/// timer (samme start og mål), lægges den sammen med det ubesvarede: det
/// viser den samlede tid, og "Træk fra" trækker summen fra. Gælder den en
/// anden timer, stilles den i kø bag de andre og vises, når de er besvaret.
/// Hvert spørgsmål husker sin timer, så "Træk fra" kun rammer den.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct IdleQueue {
    prompts: Vec<IdlePrompt>,
}

impl IdleQueue {
    pub fn push(&mut self, p: IdlePrompt) {
        match self.prompts.iter_mut().find(|q| q.same_timer(&p)) {
            Some(q) => q.absorb(&p),
            None => self.prompts.push(p),
        }
    }

    /// Spørgsmålet, der vises nu.
    pub fn current(&self) -> Option<&IdlePrompt> {
        self.prompts.first()
    }

    /// Tag spørgsmålet, der vises nu (brugeren har svaret). Det næste i
    /// køen vises derefter.
    pub fn take(&mut self) -> Option<IdlePrompt> {
        (!self.prompts.is_empty()).then(|| self.prompts.remove(0))
    }

    /// Antal ubesvarede spørgsmål.
    pub fn len(&self) -> usize {
        self.prompts.len()
    }

    pub fn is_empty(&self) -> bool {
        self.prompts.is_empty()
    }
}

pub fn format_away(secs: u64) -> String {
    let minutes = (secs + 30) / 60;
    match (minutes / 60, minutes % 60) {
        (0, 1) => t("d21.away.minute").to_owned(),
        (0, m) => tf("d21.away.minutes", &[("n", &m.to_string())]),
        (h, 0) => tf("d21.away.hours", &[("h", &h.to_string())]),
        (h, m) => tf(
            "d21.away.hours_minutes",
            &[("h", &h.to_string()), ("m", &m.to_string())],
        ),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdleChoice {
    /// Tiden var arbejde (et møde, en telefon). Intet ændres.
    Keep,
    /// Træk tiden væk fra posten, og lad timeren fortsætte.
    Subtract,
    /// Træk tiden væk, og stop timeren.
    SubtractAndStop,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdleOutcome {
    Kept,
    Subtracted { minutes: u32 },
    SubtractedAndStopped { minutes: u32 },
    /// Trukket fra og registreret på en anden kunde (`resolve_assign`).
    Assigned { minutes: u32, customer: String },
    /// Timeren er stoppet eller skiftet siden; intet er ændret.
    TimerChanged,
}

impl IdleOutcome {
    pub fn message(&self) -> String {
        match self {
            IdleOutcome::Kept => t("d21.idle.kept").to_owned(),
            IdleOutcome::Subtracted { minutes } => {
                tf("d21.idle.subtracted", &[("minutes", &minutes.to_string())])
            }
            IdleOutcome::SubtractedAndStopped { minutes } => tf(
                "d21.idle.subtracted_stopped",
                &[("minutes", &minutes.to_string())],
            ),
            IdleOutcome::Assigned { minutes, customer } => tf(
                "kalenderkilder.idle.assigned",
                &[("minutes", &minutes.to_string()), ("customer", customer)],
            ),
            IdleOutcome::TimerChanged => t("d21.idle.timer_changed").to_owned(),
        }
    }
}

/// Skal brugeren spørges? Kun hvis en timer kørte (ikke var på pause) og var
/// kørt mindst `cfg.minutes` af pausen.
pub fn prompt_for(
    ev: &IdleReturnEvent,
    timer: &TimerState,
    cfg: &IdlePromptSettings,
) -> Option<IdlePrompt> {
    if !cfg.enabled || timer.status != TimerStatus::Running {
        return None;
    }
    let started = timer.started_at?.with_timezone(&Utc);
    let away_start = ev.start.max(started);
    let secs = (ev.end - away_start).num_seconds();
    if secs <= 0 || (secs as u64) < u64::from(cfg.minutes) * 60 {
        return None;
    }
    Some(IdlePrompt {
        away_since: away_start.with_timezone(&Local),
        back_at: ev.end.with_timezone(&Local),
        away_secs: secs as u64,
        target: TimerTarget {
            customer_id: timer.customer_id.clone(),
            project_id: timer.project_id.clone(),
            task_id: timer.task_id.clone(),
            description: timer.description.clone(),
        },
        timer_started: timer.started_at,
        periods: 1,
    })
}

/// Er timeren stoppet eller skiftet, siden spørgsmålet blev stillet?
fn timer_changed(b: &dyn Backend, p: &IdlePrompt) -> Result<bool> {
    let Some(started) = p.timer_started else {
        return Ok(false);
    };
    let now = b.timer()?;
    // Også et skift af kunde/projekt/opgave imens: "Træk fra" starter
    // timeren igen på `p.target` og ville rulle skiftet tilbage.
    let same_target = now.customer_id == p.target.customer_id
        && now.project_id == p.target.project_id
        && now.task_id == p.target.task_id;
    Ok(now.status == TimerStatus::Idle || now.started_at != Some(started) || !same_target)
}

/// "Træk fra og tildel til …" (Clockify): tiden trækkes fra timeren, som
/// kører videre, og registreres på `to` (fx et møde uden computer).
///
/// Posten på `to` gemmes først. Fejler det, er intet ændret. Fejler
/// fradraget bagefter, slettes den nye post igen, så tiden ikke tælles to
/// gange.
pub fn resolve_assign(b: &dyn Backend, p: &IdlePrompt, to: &TimerTarget) -> Result<IdleOutcome> {
    let customer_id = to.customer_id.clone().ok_or_else(|| {
        BackendError::Validation(t("kalenderkilder.err.customer").into())
    })?;
    if timer_changed(b, p)? {
        return Ok(IdleOutcome::TimerChanged);
    }
    let minutes = p.minutes_to_subtract();
    let customer = b
        .customers(true)?
        .into_iter()
        .find(|c| c.id == customer_id)
        .map(|c| c.name)
        .unwrap_or_default();
    // Én pause: det rigtige tidsrum. Flere pauser (eller over midnat): kun minutterne.
    let end = p.away_since + chrono::Duration::minutes(i64::from(minutes));
    let (start, end) = if p.periods == 1 && end.date_naive() == p.away_since.date_naive() {
        (Some(p.away_since.time()), Some(end.time()))
    } else {
        (None, None)
    };
    let entry = b
        .create_entry(EntryInput {
            customer_id,
            project_id: to.project_id.clone(),
            task_id: to.task_id.clone(),
            description: to.description.clone(),
            date: p.away_since.date_naive(),
            start,
            end,
            minutes,
            billable: true,
        })
        .map_err(|e| {
            BackendError::Other(tf(
                "kalenderkilder.idle.assign_failed",
                &[("customer", &customer), ("error", &e.to_string())],
            ))
        })?;
    let done = match b.timer_subtract_idle(minutes, Some(p.target.clone())) {
        Ok(d) => d,
        Err(e) => {
            // Fradraget fejlede: fjern den nye post igen. Lykkes det heller
            // ikke, skal brugeren vide, at tiden nu står to steder.
            if let Err(undo) = b.delete_entry(&entry.id) {
                return Err(BackendError::Other(tf(
                    "kalenderkilder.idle.undo_failed",
                    &[("customer", &customer), ("error", &undo.to_string())],
                )));
            }
            return Err(e);
        }
    };
    if let Some(error) = done.restart_error {
        return Err(BackendError::Other(tf(
            "d21.idle.restart_failed",
            &[("error", &error)],
        )));
    }
    Ok(IdleOutcome::Assigned { minutes, customer })
}

/// Udfør svaret. Kaldes på en baggrundstråd.
pub fn resolve(b: &dyn Backend, p: &IdlePrompt, choice: IdleChoice) -> Result<IdleOutcome> {
    if choice == IdleChoice::Keep {
        return Ok(IdleOutcome::Kept);
    }
    let minutes = p.minutes_to_subtract();
    if timer_changed(b, p)? {
        return Ok(IdleOutcome::TimerChanged);
    }
    // Stop og kort i ét kald (#10): fejler det (fx ingen kunde valgt, eller
    // web afviser posten), er intet ændret, og timeren kører videre. Der er
    // ingen rettelse bagefter, som en låst app kunne afvise.
    let restart = (choice == IdleChoice::Subtract).then(|| p.target.clone());
    let done = b.timer_subtract_idle(minutes, restart)?;
    if let Some(error) = done.restart_error {
        return Err(BackendError::Other(tf(
            "d21.idle.restart_failed",
            &[("error", &error)],
        )));
    }
    match choice {
        IdleChoice::Subtract => Ok(IdleOutcome::Subtracted { minutes }),
        _ => Ok(IdleOutcome::SubtractedAndStopped { minutes }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{DateRange, MockBackend};
    use chrono::{Duration, NaiveDate, TimeZone};
    use tt_tracker::segmenter::{Observation, Segmenter};
    use tt_tracker::{Signals, TrackerConfig, TrackerEvent};

    fn cfg() -> IdlePromptSettings {
        IdlePromptSettings {
            enabled: true,
            minutes: 10,
        }
    }

    fn utc(h: u32, m: u32, s: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 26, h, m, s).unwrap()
    }

    fn running(started: DateTime<Utc>) -> TimerState {
        TimerState {
            status: TimerStatus::Running,
            customer_id: Some("kunde_bageriet".into()),
            project_id: Some("proj_webshop".into()),
            task_id: None,
            description: "Produktsider".into(),
            started_at: Some(started.with_timezone(&Local)),
            accumulated_secs: 0,
            version: 1,
        }
    }

    fn ev(start: DateTime<Utc>, end: DateTime<Utc>) -> IdleReturnEvent {
        IdleReturnEvent {
            start,
            end,
            duration_secs: (end - start).num_seconds(),
        }
    }

    /// Afspiller aktivitet gennem trackerens rigtige segmenter: 2 minutters
    /// arbejde, `gap_min` minutter uden input, og så input igen. Giver de
    /// idle-signaler, trackeren sender.
    fn replay(gap_min: i64) -> Vec<IdleReturnEvent> {
        let t0 = utc(9, 0, 0);
        let mut seg = Segmenter::new(TrackerConfig::default());
        let sig = Signals {
            app: "Code".into(),
            app_id: "code".into(),
            title: "main.rs".into(),
            ..Signals::default()
        };
        let mut out = vec![];
        let mut last_input = t0;
        let work_end = t0 + Duration::minutes(2);
        let back = work_end + Duration::minutes(gap_min);
        let mut at = t0;
        while at <= back + Duration::seconds(10) {
            // Input under arbejdet og igen efter pausen; ellers stilhed.
            if at <= work_end || at >= back {
                last_input = at;
            }
            let idle_secs = (at - last_input).num_seconds().max(0) as u64;
            for e in seg.observe(Observation {
                at,
                idle_secs,
                window: Some(sig.clone()),
            }) {
                if let TrackerEvent::IdleReturn {
                    start,
                    end,
                    duration_secs,
                } = e
                {
                    out.push(IdleReturnEvent {
                        start,
                        end,
                        duration_secs,
                    });
                }
            }
            at += Duration::seconds(5);
        }
        out
    }

    #[test]
    fn afspillet_aktivitet_med_lang_pause_giver_spoergsmaal() {
        let events = replay(15);
        assert_eq!(events.len(), 1, "{events:?}");
        let e = &events[0];
        assert!(
            (e.duration_secs - 15 * 60).abs() <= 10,
            "pausen er ca. 15 min: {e:?}"
        );
        // En timer, der kørte hele tiden
        let t = running(utc(8, 30, 0));
        let p = prompt_for(e, &t, &cfg()).expect("spørgsmål");
        assert_eq!(p.minutes_to_subtract(), 15);
        assert_eq!(p.target.customer_id.as_deref(), Some("kunde_bageriet"));
        assert_eq!(p.away_text(), "15 minutter");
    }

    #[test]
    fn afspillet_aktivitet_med_kort_pause_giver_intet_signal() {
        // 4 minutter er under trackerens egen tærskel
        assert!(replay(4).is_empty());
        // 8 minutter er idle for trackeren men under standardtærsklen for spørgsmålet
        let events = replay(8);
        let t = running(utc(8, 30, 0));
        for e in &events {
            assert!(prompt_for(e, &t, &cfg()).is_none());
        }
    }

    #[test]
    fn intet_spoergsmaal_uden_koerende_timer_eller_naar_det_er_slaaet_fra() {
        let e = ev(utc(9, 0, 0), utc(9, 20, 0));
        let mut t = running(utc(8, 0, 0));
        assert!(prompt_for(&e, &t, &cfg()).is_some());
        t.status = TimerStatus::Paused;
        assert!(prompt_for(&e, &t, &cfg()).is_none(), "timeren var på pause");
        t.status = TimerStatus::Idle;
        assert!(prompt_for(&e, &t, &cfg()).is_none());
        let t = running(utc(8, 0, 0));
        let off = IdlePromptSettings {
            enabled: false,
            ..cfg()
        };
        assert!(prompt_for(&e, &t, &off).is_none());
    }

    #[test]
    fn timer_startet_midt_i_pausen_tæller_kun_fra_starten() {
        // Pause 9:00-9:30, men timeren blev startet (fra web) kl. 9:25: kun 5 min.
        let e = ev(utc(9, 0, 0), utc(9, 30, 0));
        let t = running(utc(9, 25, 0));
        assert!(prompt_for(&e, &t, &cfg()).is_none());
        let t = running(utc(9, 10, 0));
        assert_eq!(
            prompt_for(&e, &t, &cfg()).unwrap().away_secs,
            20 * 60,
            "20 min fra timerens start"
        );
    }

    #[test]
    fn tærsklen_kan_ændres() {
        let e = ev(utc(9, 0, 0), utc(9, 6, 0));
        let t = running(utc(8, 0, 0));
        assert!(prompt_for(&e, &t, &cfg()).is_none());
        let five = IdlePromptSettings {
            enabled: true,
            minutes: 5,
        };
        assert!(prompt_for(&e, &t, &five).is_some());
    }

    #[test]
    fn tekst_for_tid_vaek() {
        assert_eq!(format_away(60), "1 minut");
        assert_eq!(format_away(12 * 60), "12 minutter");
        assert_eq!(format_away(3600), "1 t");
        assert_eq!(format_away(3600 + 5 * 60), "1 t 5 min");
    }

    /// Det faste tidspunkt, mockens timer går efter: kl. 12 på testdagen.
    /// En timer på 1:00:30 når ikke 1:01, mens en langsom CI-maskine kører.
    fn now() -> DateTime<Local> {
        let noon = NaiveDate::from_ymd_opt(2026, 10, 26)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        Local.from_local_datetime(&noon).single().expect("entydigt tidspunkt")
    }

    fn mock_with_timer(elapsed_secs: i64) -> MockBackend {
        let clock = crate::ur::ManualClock::new(now().with_timezone(&Utc));
        let m = MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap())
            .with_clock(std::sync::Arc::new(clock));
        m.demo_timer(
            TimerTarget {
                customer_id: Some("kunde_bageriet".into()),
                project_id: Some("proj_webshop".into()),
                task_id: None,
                description: "Produktsider".into(),
            },
            elapsed_secs,
        );
        m
    }

    fn prompt(away_min: u64, target: TimerTarget) -> IdlePrompt {
        IdlePrompt {
            away_since: now(),
            back_at: now(),
            away_secs: away_min * 60,
            target,
            timer_started: None,
            periods: 1,
        }
    }

    fn todays_minutes(m: &MockBackend) -> Vec<u32> {
        let mut v: Vec<u32> = m
            .entries(DateRange::day(m.today()))
            .unwrap()
            .into_iter()
            .filter(|e| e.description == "Produktsider")
            .map(|e| e.minutes)
            .collect();
        v.sort();
        v
    }

    /// Brugeren stoppede timeren (tray, genvej, web) og startede en ny, før
    /// spørgsmålet blev besvaret: den nye timer og den gamle post røres ikke.
    #[test]
    fn traek_fra_roerer_ikke_en_anden_timer_end_den_spoergsmaalet_gjaldt() {
        let m = mock_with_timer(3600 + 30);
        let target = TimerTarget {
            customer_id: Some("kunde_bageriet".into()),
            project_id: Some("proj_webshop".into()),
            task_id: None,
            description: "Produktsider".into(),
        };
        let p = IdlePrompt {
            timer_started: m.timer().unwrap().started_at,
            ..prompt(20, target)
        };
        m.timer_stop().unwrap();
        let other = TimerTarget {
            description: "Kunde B".into(),
            ..TimerTarget::default()
        };
        m.timer_start(other).unwrap();
        for choice in [IdleChoice::Subtract, IdleChoice::SubtractAndStop] {
            assert_eq!(resolve(&m, &p, choice).unwrap(), IdleOutcome::TimerChanged);
            assert_eq!(todays_minutes(&m), vec![60], "den gamle post er urørt");
            let t = m.timer().unwrap();
            assert_eq!((t.status, t.description.as_str()), (TimerStatus::Running, "Kunde B"));
        }
    }

    /// Brugeren skiftede projekt på den kørende timer, mens spørgsmålet var
    /// åbent: skiftet må ikke rulles tilbage af "Træk fra".
    #[test]
    fn traek_fra_ruller_ikke_et_projektskift_tilbage() {
        let m = mock_with_timer(3600 + 30);
        let target = TimerTarget {
            customer_id: Some("kunde_bageriet".into()),
            project_id: Some("proj_webshop".into()),
            task_id: None,
            description: "Produktsider".into(),
        };
        let p = IdlePrompt {
            timer_started: m.timer().unwrap().started_at,
            ..prompt(20, target.clone())
        };
        m.timer_set_target(TimerTarget {
            project_id: None,
            ..target
        })
        .unwrap();
        assert_eq!(resolve(&m, &p, IdleChoice::Subtract).unwrap(), IdleOutcome::TimerChanged);
        let t = m.timer().unwrap();
        assert_eq!((t.status, t.project_id), (TimerStatus::Running, None));
    }

    #[test]
    fn behold_aendrer_intet() {
        let m = mock_with_timer(3600);
        let t = m.timer().unwrap();
        let p = prompt(12, TimerTarget::default());
        assert_eq!(
            resolve(&m, &p, IdleChoice::Keep).unwrap(),
            IdleOutcome::Kept
        );
        assert_eq!(m.timer().unwrap(), t);
        assert!(todays_minutes(&m).is_empty());
    }

    #[test]
    fn traek_fra_korter_posten_og_starter_timeren_igen() {
        let m = mock_with_timer(3600 + 30);
        let target = TimerTarget {
            customer_id: Some("kunde_bageriet".into()),
            project_id: Some("proj_webshop".into()),
            task_id: None,
            description: "Produktsider".into(),
        };
        let out = resolve(&m, &prompt(12, target), IdleChoice::Subtract).unwrap();
        assert_eq!(out, IdleOutcome::Subtracted { minutes: 12 });
        assert_eq!(todays_minutes(&m), vec![48], "60 minutter minus 12");
        let t = m.timer().unwrap();
        assert_eq!(t.status, TimerStatus::Running, "ny timer på samme mål");
        assert_eq!(t.customer_id.as_deref(), Some("kunde_bageriet"));
        assert_eq!(t.description, "Produktsider");
    }

    #[test]
    fn traek_fra_og_stop_efterlader_ingen_timer() {
        let m = mock_with_timer(3600 + 30);
        let out = resolve(
            &m,
            &prompt(20, TimerTarget::default()),
            IdleChoice::SubtractAndStop,
        )
        .unwrap();
        assert_eq!(out, IdleOutcome::SubtractedAndStopped { minutes: 20 });
        assert_eq!(todays_minutes(&m), vec![40]);
        assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
    }

    #[test]
    fn fradrag_der_æder_hele_posten_sletter_den() {
        let m = mock_with_timer(10 * 60 + 5);
        resolve(
            &m,
            &prompt(15, TimerTarget::default()),
            IdleChoice::SubtractAndStop,
        )
        .unwrap();
        assert!(todays_minutes(&m).is_empty());
        assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
    }

    #[test]
    fn fejl_ved_stop_aendrer_ingenting() {
        // Timeren uden kunde kan ikke gemmes: tiden må ikke gå tabt.
        let m = MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
        m.demo_timer(TimerTarget::default(), 3600);
        let err = resolve(
            &m,
            &prompt(10, TimerTarget::default()),
            IdleChoice::SubtractAndStop,
        )
        .unwrap_err();
        assert!(matches!(err, BackendError::Validation(_)));
        assert_eq!(m.timer().unwrap().status, TimerStatus::Running);
    }

    // ---- flere pauser før svaret (#14)

    fn bageriet() -> TimerTarget {
        TimerTarget {
            customer_id: Some("kunde_bageriet".into()),
            project_id: Some("proj_webshop".into()),
            task_id: None,
            description: "Produktsider".into(),
        }
    }

    /// Pause `from`-`to` (UTC-klokkeslæt på testdagen) for timeren `started`.
    fn period(started: DateTime<Utc>, from: (u32, u32), to: (u32, u32)) -> IdlePrompt {
        let e = ev(utc(from.0, from.1, 0), utc(to.0, to.1, 0));
        prompt_for(&e, &running(started), &cfg()).expect("spørgsmål")
    }

    #[test]
    fn ny_pause_for_samme_timer_laegges_sammen_med_den_ubesvarede() {
        let started = utc(8, 0, 0);
        let mut q = IdleQueue::default();
        q.push(period(started, (9, 0), (9, 12)));
        q.push(period(started, (10, 0), (10, 20)));
        assert_eq!(q.len(), 1, "ét spørgsmål");
        let p = q.current().unwrap();
        assert_eq!((p.periods, p.away_secs), (2, 32 * 60));
        assert_eq!(p.minutes_to_subtract(), 32, "\"Træk fra\" trækker summen fra");
        assert_eq!(p.away_since, utc(9, 0, 0).with_timezone(&Local));
        assert_eq!(p.back_at, utc(10, 20, 0).with_timezone(&Local));
        let text = p.text();
        assert!(text.starts_with("Du var væk i alt 32 minutter, fordelt på 2 pauser ("), "{text}");
        // Én pause giver den almindelige tekst
        let one = period(started, (9, 0), (9, 12));
        assert!(one.text().starts_with("Du var væk i 12 minutter ("), "{}", one.text());
    }

    #[test]
    fn overlappende_pauser_taelles_kun_en_gang() {
        let started = utc(8, 0, 0);
        let mut queue = IdleQueue::default();
        queue.push(period(started, (9, 0), (9, 20)));
        // Trackeren melder 9:10-9:30: kun 9:20-9:30 er ny tid.
        queue.push(period(started, (9, 10), (9, 30)));
        assert_eq!(queue.current().unwrap().away_secs, 30 * 60);
    }

    #[test]
    fn pause_for_en_anden_timer_stilles_i_koe() {
        let mut q = IdleQueue::default();
        q.push(period(utc(8, 0, 0), (9, 0), (9, 15)));
        // Ny timer (anden start), og samme timer med skiftet projekt
        q.push(period(utc(9, 30, 0), (10, 0), (10, 20)));
        let mut moved = period(utc(8, 0, 0), (11, 0), (11, 15));
        moved.target.project_id = None;
        q.push(moved);
        assert_eq!(q.len(), 3);
        let first = q.take().unwrap();
        assert_eq!((first.away_secs, first.periods), (15 * 60, 1), "det ældste vises først");
        assert_eq!(q.current().unwrap().away_secs, 20 * 60, "det næste i køen");
        q.take();
        q.take();
        assert!(q.is_empty() && q.take().is_none());
        // En ukendt start lægges aldrig sammen
        let mut q = IdleQueue::default();
        let mut a = period(utc(8, 0, 0), (9, 0), (9, 15));
        a.timer_started = None;
        q.push(a.clone());
        q.push(a);
        assert_eq!(q.len(), 2);
    }

    #[test]
    fn samlet_spoergsmaal_traekker_summen_fra() {
        let m = mock_with_timer(3600 + 30);
        let started = m.timer().unwrap().started_at;
        let mut q = IdleQueue::default();
        // 10 minutter for 40 minutter siden og de sidste 15 minutter
        let now = now();
        for (from, away) in [(40, 10), (15, 15)] {
            q.push(IdlePrompt {
                away_since: now - Duration::minutes(from),
                back_at: now - Duration::minutes(from - away),
                timer_started: started,
                ..prompt(away as u64, bageriet())
            });
        }
        let p = q.take().unwrap();
        assert_eq!(p.periods, 2);
        assert_eq!(
            resolve(&m, &p, IdleChoice::SubtractAndStop).unwrap(),
            IdleOutcome::SubtractedAndStopped { minutes: 25 }
        );
        assert_eq!(todays_minutes(&m), vec![35], "60 minutter minus 10 og 15");
    }

    /// To spørgsmål i kø for hver sin timer: "Træk fra" på det første rammer
    /// ikke den timer, der kører nu, og det andet rammer kun sin egen.
    #[test]
    fn koeens_spoergsmaal_rammer_kun_deres_egen_timer() {
        let m = mock_with_timer(3600 + 30);
        let mut q = IdleQueue::default();
        q.push(IdlePrompt {
            timer_started: m.timer().unwrap().started_at,
            ..prompt(20, bageriet())
        });
        // Brugeren skifter timer (tray/web), og en ny pause kommer.
        m.timer_stop().unwrap();
        let other = TimerTarget {
            customer_id: Some("kunde_cafe".into()),
            description: "Menukort".into(),
            ..TimerTarget::default()
        };
        m.demo_timer(other.clone(), 3600 + 30);
        q.push(IdlePrompt {
            timer_started: m.timer().unwrap().started_at,
            ..prompt(15, other)
        });
        assert_eq!(q.len(), 2);

        let first = q.take().unwrap();
        assert_eq!(resolve(&m, &first, IdleChoice::Subtract).unwrap(), IdleOutcome::TimerChanged);
        assert_eq!(todays_minutes(&m), vec![60], "den første timers post er urørt");
        let second = q.take().unwrap();
        assert_eq!(
            resolve(&m, &second, IdleChoice::SubtractAndStop).unwrap(),
            IdleOutcome::SubtractedAndStopped { minutes: 15 }
        );
        let menu: Vec<u32> = m
            .entries(DateRange::day(m.today()))
            .unwrap()
            .into_iter()
            .filter(|e| e.description == "Menukort")
            .map(|e| e.minutes)
            .collect();
        assert_eq!(menu, vec![45]);
        assert_eq!(todays_minutes(&m), vec![60]);
    }

    // ---- træk fra og tildel til … (kalender)

    #[test]
    fn tildel_flytter_tiden_til_en_anden_kunde_og_timeren_koerer_videre() {
        let m = mock_with_timer(3600 + 30);
        let started = m.timer().unwrap().started_at;
        let away_since = now() - Duration::minutes(25);
        let p = IdlePrompt {
            away_since,
            back_at: away_since + Duration::minutes(20),
            timer_started: started,
            ..prompt(20, bageriet())
        };
        let to = TimerTarget {
            customer_id: Some("kunde_cafe".into()),
            description: "Møde uden computer".into(),
            ..TimerTarget::default()
        };
        let out = resolve_assign(&m, &p, &to).unwrap();
        assert!(matches!(out, IdleOutcome::Assigned { minutes: 20, .. }), "{out:?}");
        assert_eq!(todays_minutes(&m), vec![40], "60 minutter minus 20");
        let moved: Vec<_> = m
            .entries(DateRange::day(away_since.date_naive()))
            .unwrap()
            .into_iter()
            .filter(|e| e.description == "Møde uden computer")
            .collect();
        assert_eq!(moved.len(), 1);
        assert_eq!((moved[0].customer_id.as_str(), moved[0].minutes), ("kunde_cafe", 20));
        if away_since.date_naive() == (away_since + Duration::minutes(20)).date_naive() {
            assert_eq!(moved[0].start, Some(away_since.time()));
        }
        let t = m.timer().unwrap();
        assert_eq!((t.status, t.customer_id.as_deref()), (TimerStatus::Running, Some("kunde_bageriet")));
        assert!(out.message().contains("20 min"));
    }

    #[test]
    fn tildel_uden_kunde_eller_med_skiftet_timer_aendrer_intet() {
        let m = mock_with_timer(3600 + 30);
        let p = IdlePrompt {
            timer_started: m.timer().unwrap().started_at,
            ..prompt(20, bageriet())
        };
        assert!(matches!(
            resolve_assign(&m, &p, &TimerTarget::default()),
            Err(BackendError::Validation(_))
        ));
        m.timer_stop().unwrap();
        m.timer_start(bageriet()).unwrap();
        let to = TimerTarget {
            customer_id: Some("kunde_cafe".into()),
            ..TimerTarget::default()
        };
        assert_eq!(resolve_assign(&m, &p, &to).unwrap(), IdleOutcome::TimerChanged);
        assert!(m.entries(DateRange::day(m.today())).unwrap().iter().all(|e| e.customer_id != "kunde_cafe" || e.minutes != 20));
    }

    #[test]
    fn tildel_der_ikke_kan_trække_fra_sletter_den_nye_post_igen() {
        // Timeren uden kunde kan ikke stoppes og gemmes: fradraget fejler.
        let m = MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
        m.demo_timer(TimerTarget::default(), 3600);
        let before = m.entries(DateRange::day(m.today())).unwrap().len();
        let to = TimerTarget {
            customer_id: Some("kunde_cafe".into()),
            description: "Telefon".into(),
            ..TimerTarget::default()
        };
        assert!(resolve_assign(&m, &prompt(10, TimerTarget::default()), &to).is_err());
        assert_eq!(m.entries(DateRange::day(m.today())).unwrap().len(), before, "ingen dobbelt tid");
        assert_eq!(m.timer().unwrap().status, TimerStatus::Running);
    }
}
