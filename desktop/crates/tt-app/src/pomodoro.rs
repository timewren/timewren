//! Pomodoro koblet til timeren (spec D21).
//!
//! Arbejdsintervallet tæller kun ned, mens timeren kører. Når det er slut,
//! kommer en notifikation, og (hvis det er valgt) timeren sættes på pause i
//! pausen. Efter `sessions_before_long` arbejdsrunder er pausen den lange.
//! Pausen er slut, når tiden er gået, og en ny arbejdsrunde begynder, når
//! timeren køres igen. Stopper brugeren timeren, begynder cyklussen forfra.
//!
//! Standardværdierne (25/5/15 efter 4) er de samme som i `pomodoroStore`.
//! Alt er en ren tilstandsmaskine drevet af et tidspunkt og timerens status,
//! så den kan testes uden at vente.

use chrono::{DateTime, Duration, Utc};

use crate::backend::TimerStatus;
use crate::backend::d21::PomodoroSettings;
use crate::i18n::{t, tf};
use crate::notify::{Notification, NotificationKind};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Venter på, at timeren kører.
    Off,
    Work,
    ShortBreak,
    LongBreak,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Effect {
    Notify(Notification),
    /// Sæt timeren på pause (pausen begynder).
    PauseTimer,
}

/// Længste tidsskridt mellem to opdateringer, der tælles med. Længere huller
/// er en computer i dvale; tiden dér er ikke arbejde (og ikke pause).
const MAX_STEP: Duration = Duration::seconds(90);
/// Efter vi har bedt om en pause, ignoreres en timer, der endnu står som
/// "kører", så den ikke læses som at brugeren selv genoptog.
const PAUSE_GRACE: Duration = Duration::seconds(15);

#[derive(Clone, Debug)]
pub struct Pomodoro {
    phase: Phase,
    remaining: Duration,
    /// Gennemførte arbejdsrunder i denne cyklus.
    sessions_done: u32,
    last_update: Option<DateTime<Utc>>,
    ignore_running_until: Option<DateTime<Utc>>,
}

impl Default for Pomodoro {
    fn default() -> Self {
        Pomodoro {
            phase: Phase::Off,
            remaining: Duration::zero(),
            sessions_done: 0,
            last_update: None,
            ignore_running_until: None,
        }
    }
}

fn minutes(m: u32) -> Duration {
    Duration::minutes(i64::from(m))
}

impl Pomodoro {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn remaining_secs(&self) -> u64 {
        self.remaining.num_seconds().max(0) as u64
    }

    pub fn sessions_done(&self) -> u32 {
        self.sessions_done
    }

    pub fn reset(&mut self) {
        *self = Pomodoro::default();
    }

    /// Kort tekst til menulinjen og siden: "Arbejde 12:34 · runde 2 af 4".
    pub fn label(&self, cfg: &PomodoroSettings) -> Option<String> {
        let clock = format!(
            "{:02}:{:02}",
            self.remaining_secs() / 60,
            self.remaining_secs() % 60
        );
        match self.phase {
            Phase::Off => None,
            Phase::Work => {
                let rounds = cfg.sessions_before_long.max(1);
                Some(tf(
                    "d21.pomo.work_label",
                    &[
                        ("clock", &clock),
                        ("round", &(self.sessions_done % rounds + 1).to_string()),
                        ("rounds", &rounds.to_string()),
                    ],
                ))
            }
            Phase::ShortBreak => Some(tf("d21.pomo.break_label", &[("clock", &clock)])),
            Phase::LongBreak => Some(tf("d21.pomo.long_label", &[("clock", &clock)])),
        }
    }

    /// Kald jævnligt (hvert par sekunder) med uret og timerens status.
    pub fn update(
        &mut self,
        cfg: &PomodoroSettings,
        now: DateTime<Utc>,
        timer: TimerStatus,
    ) -> Vec<Effect> {
        if !cfg.enabled {
            self.reset();
            return vec![];
        }
        let step = self.last_update.map_or(Duration::zero(), |l| {
            (now - l).clamp(Duration::zero(), MAX_STEP)
        });
        self.last_update = Some(now);

        let mut timer = timer;
        if timer == TimerStatus::Running && self.ignore_running_until.is_some_and(|u| now < u) {
            timer = TimerStatus::Paused;
        }

        match self.phase {
            Phase::Off => {
                if timer == TimerStatus::Running {
                    self.phase = Phase::Work;
                    self.remaining = minutes(cfg.work_minutes);
                }
                vec![]
            }
            Phase::Work => match timer {
                TimerStatus::Idle => {
                    // Timeren er stoppet: cyklussen slutter.
                    self.reset();
                    self.last_update = Some(now);
                    vec![]
                }
                TimerStatus::Paused => vec![],
                TimerStatus::Running => {
                    self.remaining -= step;
                    if self.remaining <= Duration::zero() {
                        self.finish_work(cfg, now, timer)
                    } else {
                        vec![]
                    }
                }
            },
            Phase::ShortBreak | Phase::LongBreak => {
                // Er timeren ikke sat på pause af os, kører den bare videre
                // gennem pausen, og det ændrer ikke på nedtællingen.
                if timer == TimerStatus::Running && cfg.pause_timer_on_break {
                    // Brugeren genoptog selv timeren: pausen er slut.
                    self.phase = Phase::Work;
                    self.remaining = minutes(cfg.work_minutes);
                    return vec![];
                }
                self.remaining -= step;
                if self.remaining > Duration::zero() {
                    return vec![];
                }
                self.phase = Phase::Off;
                self.remaining = Duration::zero();
                vec![Effect::Notify(Notification::new(
                    NotificationKind::Pomodoro,
                    t("d21.pomo.break_done"),
                    t("d21.pomo.break_done_body"),
                ))]
            }
        }
    }

    fn finish_work(
        &mut self,
        cfg: &PomodoroSettings,
        now: DateTime<Utc>,
        timer: TimerStatus,
    ) -> Vec<Effect> {
        self.sessions_done += 1;
        let long = self
            .sessions_done
            .is_multiple_of(cfg.sessions_before_long.max(1));
        let (phase, len) = if long {
            (Phase::LongBreak, cfg.long_break_minutes)
        } else {
            (Phase::ShortBreak, cfg.short_break_minutes)
        };
        self.phase = phase;
        self.remaining = minutes(len);
        let mut out = vec![Effect::Notify(Notification::new(
            NotificationKind::Pomodoro,
            t("d21.pomo.work_done"),
            tf(
                if long {
                    "d21.pomo.long_break"
                } else {
                    "d21.pomo.short_break"
                },
                &[("minutes", &len.to_string())],
            ),
        ))];
        if cfg.pause_timer_on_break && timer == TimerStatus::Running {
            self.ignore_running_until = Some(now + PAUSE_GRACE);
            out.push(Effect::PauseTimer);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ur::{Clock, ManualClock};
    use chrono::TimeZone;

    fn cfg() -> PomodoroSettings {
        PomodoroSettings {
            enabled: true,
            ..PomodoroSettings::default()
        }
    }

    struct Rig {
        clock: ManualClock,
        p: Pomodoro,
        cfg: PomodoroSettings,
        timer: TimerStatus,
        effects: Vec<Effect>,
    }

    impl Rig {
        fn new() -> Self {
            Rig {
                clock: ManualClock::new(Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap()),
                p: Pomodoro::new(),
                cfg: cfg(),
                timer: TimerStatus::Idle,
                effects: vec![],
            }
        }

        /// Lader tiden gå i hop på 5 sekunder, som baggrundsopgaven gør.
        fn run(&mut self, secs: i64) {
            let mut left = secs;
            while left > 0 {
                let d = left.min(5);
                self.clock.advance(Duration::seconds(d));
                left -= d;
                let fx = self.p.update(&self.cfg, self.clock.now(), self.timer);
                for e in &fx {
                    // Som tjenesten: en pause-effekt sætter timeren på pause.
                    if *e == Effect::PauseTimer {
                        self.timer = TimerStatus::Paused;
                    }
                }
                self.effects.extend(fx);
            }
        }

        fn notified(&self) -> Vec<String> {
            self.effects
                .iter()
                .filter_map(|e| match e {
                    Effect::Notify(n) => Some(n.title.clone()),
                    _ => None,
                })
                .collect()
        }
    }

    #[test]
    fn arbejdsrunde_paa_25_min_giver_kort_pause_og_pauser_timeren() {
        let mut r = Rig::new();
        r.timer = TimerStatus::Running;
        r.run(5); // første opdatering: Work begynder
        assert_eq!(r.p.phase(), Phase::Work);
        r.run(24 * 60);
        assert_eq!(r.p.phase(), Phase::Work);
        assert!(r.notified().is_empty());
        r.run(70);
        assert_eq!(r.p.phase(), Phase::ShortBreak);
        assert_eq!(r.notified(), vec!["Arbejdsrunden er slut"]);
        assert!(r.effects.contains(&Effect::PauseTimer));
        assert_eq!(r.timer, TimerStatus::Paused);
        assert_eq!(r.p.sessions_done(), 1);
        match &r.effects[0] {
            Effect::Notify(n) => assert!(n.body.contains("kort pause på 5 minutter"), "{n:?}"),
            e => panic!("{e:?}"),
        }
    }

    #[test]
    fn pausen_slutter_efter_5_min_og_ny_runde_starter_naar_timeren_koerer() {
        let mut r = Rig::new();
        r.timer = TimerStatus::Running;
        r.run(25 * 60 + 10);
        assert_eq!(r.p.phase(), Phase::ShortBreak);
        r.run(4 * 60);
        assert_eq!(r.p.phase(), Phase::ShortBreak);
        r.run(70);
        assert_eq!(r.p.phase(), Phase::Off);
        assert_eq!(
            r.notified(),
            vec!["Arbejdsrunden er slut", "Pausen er slut"]
        );
        // Timeren køres igen: ny arbejdsrunde, runde 2
        r.timer = TimerStatus::Running;
        r.run(10);
        assert_eq!(r.p.phase(), Phase::Work);
        assert!(r.p.label(&r.cfg).unwrap().contains("runde 2 af 4"));
    }

    #[test]
    fn fjerde_runde_giver_lang_pause() {
        let mut r = full_cycle(4);
        assert_eq!(r.p.phase(), Phase::LongBreak);
        assert_eq!(r.p.sessions_done(), 4);
        match r.effects.iter().rev().find_map(|e| match e {
            Effect::Notify(n) => Some(n.clone()),
            _ => None,
        }) {
            Some(n) => assert!(n.body.contains("lang pause på 15 minutter"), "{n:?}"),
            None => panic!("ingen notifikation"),
        }
        // Lang pause varer 15 min
        r.run(14 * 60);
        assert_eq!(r.p.phase(), Phase::LongBreak);
        r.run(80);
        assert_eq!(r.p.phase(), Phase::Off);
    }

    /// Kører `rounds` fulde arbejdsrunder med pause imellem.
    fn full_cycle(rounds: u32) -> Rig {
        let mut r = Rig::new();
        for _ in 0..rounds {
            r.timer = TimerStatus::Running;
            r.run(25 * 60 + 10);
            if r.p.phase() == Phase::ShortBreak {
                r.run(5 * 60 + 10);
            }
        }
        r
    }

    #[test]
    fn arbejdsintervallet_staar_stille_mens_timeren_er_paa_pause() {
        let mut r = Rig::new();
        r.timer = TimerStatus::Running;
        r.run(10 * 60);
        let before = r.p.remaining_secs();
        r.timer = TimerStatus::Paused;
        r.run(30 * 60);
        assert_eq!(r.p.remaining_secs(), before, "intet tæller på pause");
        assert_eq!(r.p.phase(), Phase::Work);
        r.timer = TimerStatus::Running;
        r.run(60);
        assert_eq!(r.p.remaining_secs(), before - 60);
    }

    #[test]
    fn stop_af_timeren_afslutter_cyklussen() {
        let mut r = full_cycle(2);
        assert_eq!(r.p.sessions_done(), 2);
        r.timer = TimerStatus::Running;
        r.run(10);
        assert_eq!(r.p.phase(), Phase::Work);
        r.timer = TimerStatus::Idle;
        r.run(10);
        assert_eq!(r.p.phase(), Phase::Off);
        assert_eq!(r.p.sessions_done(), 0);
    }

    #[test]
    fn genoptager_man_timeren_midt_i_pausen_begynder_en_ny_runde() {
        let mut r = Rig::new();
        r.timer = TimerStatus::Running;
        r.run(25 * 60 + 10);
        assert_eq!(r.p.phase(), Phase::ShortBreak);
        r.run(60);
        r.timer = TimerStatus::Running;
        r.run(10);
        assert_eq!(r.p.phase(), Phase::Work);
        assert!(r.p.remaining_secs() > 24 * 60);
    }

    #[test]
    fn pauseeffekten_laeses_ikke_som_at_brugeren_genoptog() {
        // Timeren når at stå som "kører" ét tidsskridt efter pausen er bedt om.
        let mut r = Rig::new();
        r.timer = TimerStatus::Running;
        r.run(25 * 60 + 5);
        assert!(r.effects.contains(&Effect::PauseTimer));
        assert_eq!(r.p.phase(), Phase::ShortBreak);
        // Tjenesten når ikke at sætte timeren på pause før næste opdatering
        r.timer = TimerStatus::Running;
        r.run(5);
        assert_eq!(r.p.phase(), Phase::ShortBreak);
        // ... men efter tolerancen er en kørende timer brugerens eget valg
        r.run(20);
        assert_eq!(r.p.phase(), Phase::Work);
    }

    #[test]
    fn dvale_taeller_ikke_som_arbejde() {
        let mut p = Pomodoro::new();
        let c = cfg();
        let t0 = Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap();
        p.update(&c, t0, TimerStatus::Running);
        p.update(&c, t0 + Duration::seconds(5), TimerStatus::Running);
        // Computeren sov i 3 timer, og timeren står stadig som "kører"
        p.update(&c, t0 + Duration::hours(3), TimerStatus::Running);
        assert_eq!(p.phase(), Phase::Work, "højst ét tidsskridt tæller");
        assert!(p.remaining_secs() > 23 * 60);
    }

    #[test]
    fn slaaet_fra_nulstiller_og_gør_ingenting() {
        let mut r = Rig::new();
        r.timer = TimerStatus::Running;
        r.run(30);
        r.cfg.enabled = false;
        r.run(30 * 60);
        assert_eq!(r.p.phase(), Phase::Off);
        assert!(r.effects.is_empty());
        assert!(r.p.label(&r.cfg).is_none());
    }

    #[test]
    fn pause_uden_at_pause_timeren_naar_det_er_fravalgt() {
        let mut r = Rig::new();
        r.cfg.pause_timer_on_break = false;
        r.timer = TimerStatus::Running;
        r.run(25 * 60 + 10);
        assert_eq!(r.p.phase(), Phase::ShortBreak);
        assert!(!r.effects.contains(&Effect::PauseTimer));
        assert_eq!(r.timer, TimerStatus::Running);
    }

    #[test]
    fn egne_laengder_og_runder() {
        let mut r = Rig::new();
        r.cfg.work_minutes = 50;
        r.cfg.short_break_minutes = 10;
        r.cfg.sessions_before_long = 2;
        r.timer = TimerStatus::Running;
        r.run(49 * 60);
        assert_eq!(r.p.phase(), Phase::Work);
        r.run(2 * 60);
        assert_eq!(r.p.phase(), Phase::ShortBreak);
        r.run(10 * 60 + 10);
        assert_eq!(r.p.phase(), Phase::Off);
        r.timer = TimerStatus::Running;
        r.run(51 * 60);
        assert_eq!(r.p.phase(), Phase::LongBreak, "anden runde → lang pause");
    }

    #[test]
    fn label_viser_fase_og_nedtaelling() {
        let mut r = Rig::new();
        r.timer = TimerStatus::Running;
        r.run(5);
        r.run(60);
        assert_eq!(r.p.label(&r.cfg).unwrap(), "Arbejde 24:00 · runde 1 af 4");
    }
}
