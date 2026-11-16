//! Påmindelser (spec D21):
//!
//! - **Start en timer:** i arbejdstiden, på en arbejdsdag, når ingen timer
//!   kører, og der hverken er kørt en timer eller registreret tid i
//!   `idle_before_start_minutes`. Gentages højst hver time.
//! - **Usædvanligt lang timer:** en timer, der har kørt `long_running_hours`
//!   (og igen for hver ny periode af samme længde).
//! - **Dagens gennemgang:** ved `review_time`, hvis der ligger uafklarede
//!   forslag (som i den gamle app, kl. 17:00). Højst én gang om dagen.
//!
//! Alt er en ren funktion af [`Context`] (med uret i `now`), så tidspunkterne
//! kan testes uden at vente.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};

use crate::backend::TimerStatus;
use crate::backend::d21::ReminderSettings;
use crate::i18n::{t, tf};
use crate::idle::format_away;
use crate::notify::{Notification, NotificationKind};

/// Det, påmindelserne ser.
#[derive(Clone, Debug)]
pub struct Context {
    pub now: DateTime<Local>,
    pub timer: TimerStatus,
    /// Sekunder på den aktuelle timer.
    pub timer_elapsed_secs: u64,
    /// Hvornår der sidst blev optaget tid i dag (slut på seneste post eller
    /// seneste stop). `None` = intet i dag.
    pub last_tracked_at: Option<DateTime<Local>>,
    pub unconfirmed_suggestions: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reminder {
    StartTimer { idle_minutes: u32 },
    LongRunning { running_secs: u64 },
    Review { suggestions: usize },
}

impl Reminder {
    pub fn notification(&self) -> Notification {
        match self {
            Reminder::StartTimer { idle_minutes } => Notification::new(
                NotificationKind::Reminder,
                t("d21.rem.start_title"),
                tf(
                    "d21.rem.start_body",
                    &[("idle", &format_away(u64::from(*idle_minutes) * 60))],
                ),
            ),
            Reminder::LongRunning { running_secs } => Notification::new(
                NotificationKind::Reminder,
                t("d21.rem.long_title"),
                tf(
                    "d21.rem.long_body",
                    &[("time", &format_away(*running_secs))],
                ),
            ),
            Reminder::Review { suggestions } => Notification::new(
                NotificationKind::Reminder,
                t("d21.rem.review_title"),
                if *suggestions == 1 {
                    t("d21.rem.review_one").to_owned()
                } else {
                    tf("d21.rem.review_many", &[("n", &suggestions.to_string())])
                },
            ),
        }
    }
}

/// Hvad der allerede er sagt, så den samme påmindelse ikke kommer igen og igen.
#[derive(Default)]
pub struct Reminders {
    last_start_reminder: Option<DateTime<Local>>,
    long_periods_notified: u64,
    review_done_on: Option<NaiveDate>,
}

const START_REPEAT_MINUTES: i64 = 60;

impl Reminders {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn tick(&mut self, cfg: &ReminderSettings, ctx: &Context) -> Vec<Reminder> {
        let mut out = vec![];
        let now = ctx.now;
        let time = now.time();
        let work_day = cfg.is_work_day(now.weekday());

        // ---- start en timer
        if cfg.start_timer && work_day && time >= cfg.work_start && time < cfg.work_end {
            if ctx.timer == TimerStatus::Idle {
                let day_start = now
                    .date_naive()
                    .and_time(cfg.work_start)
                    .and_local_timezone(Local)
                    .earliest();
                let since = match (ctx.last_tracked_at, day_start) {
                    (Some(t), Some(s)) => Some(t.max(s)),
                    (Some(t), None) => Some(t),
                    (None, s) => s,
                };
                let quiet = since.is_some_and(|s| {
                    now - s >= Duration::minutes(i64::from(cfg.idle_before_start_minutes))
                });
                let repeat = self.last_start_reminder.is_none_or(|l| {
                    now - l
                        >= Duration::minutes(
                            START_REPEAT_MINUTES.max(i64::from(cfg.idle_before_start_minutes)),
                        )
                });
                if quiet && repeat {
                    self.last_start_reminder = Some(now);
                    out.push(Reminder::StartTimer {
                        idle_minutes: cfg.idle_before_start_minutes,
                    });
                }
            } else {
                // En timer kører: næste gang den står stille, tælles der forfra.
                self.last_start_reminder = None;
            }
        }

        // ---- lang timer
        let period = u64::from(cfg.long_running_hours.max(1)) * 3600;
        match ctx.timer {
            TimerStatus::Running => {
                let periods = ctx.timer_elapsed_secs / period;
                // En ny timer (kortere end den forrige) begynder forfra.
                self.long_periods_notified = self.long_periods_notified.min(periods);
                if cfg.long_running && periods > self.long_periods_notified {
                    out.push(Reminder::LongRunning {
                        running_secs: periods * period,
                    });
                }
                // Perioden huskes også, når påmindelsen er slået fra, så en
                // senere aktivering ikke straks melder en gammel periode.
                self.long_periods_notified = periods;
            }
            TimerStatus::Idle => self.long_periods_notified = 0,
            TimerStatus::Paused => {}
        }

        // ---- dagens gennemgang
        if cfg.review && time >= cfg.review_time && self.review_done_on != Some(now.date_naive()) {
            // Først når der er noget at gennemgå: et forslag, der dukker op
            // sent på aftenen, udløser stadig dagens ene påmindelse.
            if ctx.unconfirmed_suggestions > 0 {
                self.review_done_on = Some(now.date_naive());
                out.push(Reminder::Review {
                    suggestions: ctx.unconfirmed_suggestions,
                });
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveTime, TimeZone};

    fn at(day: u32, h: u32, m: u32) -> DateTime<Local> {
        // 26/10-2026 er en mandag
        Local.with_ymd_and_hms(2026, 10, day, h, m, 0).unwrap()
    }

    fn ctx(now: DateTime<Local>) -> Context {
        Context {
            now,
            timer: TimerStatus::Idle,
            timer_elapsed_secs: 0,
            last_tracked_at: None,
            unconfirmed_suggestions: 0,
        }
    }

    fn cfg() -> ReminderSettings {
        ReminderSettings::default() // 9-17, man-fre, 30 min, 4 t, gennemgang kl. 17
    }

    #[test]
    fn start_timer_kun_i_arbejdstiden_paa_arbejdsdage() {
        let mut r = Reminders::new();
        assert!(
            r.tick(&cfg(), &ctx(at(26, 8, 0))).is_empty(),
            "før arbejdstid"
        );
        assert!(
            r.tick(&cfg(), &ctx(at(26, 9, 10))).is_empty(),
            "kun 10 min siden start"
        );
        let got = r.tick(&cfg(), &ctx(at(26, 9, 31)));
        assert_eq!(got, vec![Reminder::StartTimer { idle_minutes: 30 }]);

        let mut r = Reminders::new();
        assert_eq!(r.tick(&cfg(), &ctx(at(23, 10, 0))).len(), 1, "fredag");
        let mut r = Reminders::new();
        assert!(r.tick(&cfg(), &ctx(at(25, 11, 0))).is_empty(), "søndag");
        assert!(
            r.tick(&cfg(), &ctx(at(26, 17, 30))).is_empty(),
            "efter arbejdstid"
        );
    }

    #[test]
    fn start_timer_gentages_hojst_hver_time_og_ikke_mens_timeren_koerer() {
        let mut r = Reminders::new();
        assert_eq!(r.tick(&cfg(), &ctx(at(26, 10, 0))).len(), 1);
        assert!(r.tick(&cfg(), &ctx(at(26, 10, 30))).is_empty());
        assert!(r.tick(&cfg(), &ctx(at(26, 10, 59))).is_empty());
        assert_eq!(r.tick(&cfg(), &ctx(at(26, 11, 0))).len(), 1);

        // En timer kører: ingen påmindelse, og tælleren starter forfra
        let mut running = ctx(at(26, 12, 30));
        running.timer = TimerStatus::Running;
        running.timer_elapsed_secs = 600;
        assert!(r.tick(&cfg(), &running).is_empty());
    }

    #[test]
    fn nylig_registreret_tid_udskyder_paamindelsen() {
        let mut r = Reminders::new();
        let mut c = ctx(at(26, 10, 0));
        c.last_tracked_at = Some(at(26, 9, 50));
        assert!(r.tick(&cfg(), &c).is_empty());
        c.now = at(26, 10, 19);
        assert!(r.tick(&cfg(), &c).is_empty());
        c.now = at(26, 10, 20);
        assert_eq!(
            r.tick(&cfg(), &c).len(),
            1,
            "30 min efter sidste registrering"
        );
    }

    #[test]
    fn start_paamindelsen_kan_slaas_fra() {
        let mut r = Reminders::new();
        let mut c = cfg();
        c.start_timer = false;
        assert!(r.tick(&c, &ctx(at(26, 11, 0))).is_empty());
    }

    #[test]
    fn lang_timer_foerste_gang_efter_graensen_og_derefter_for_hver_periode() {
        let mut r = Reminders::new();
        let mut c = ctx(at(26, 13, 0));
        c.timer = TimerStatus::Running;
        c.timer_elapsed_secs = 3 * 3600 + 59 * 60;
        assert!(r.tick(&cfg(), &c).is_empty());
        c.timer_elapsed_secs = 4 * 3600;
        assert_eq!(
            r.tick(&cfg(), &c),
            vec![Reminder::LongRunning {
                running_secs: 4 * 3600
            }]
        );
        c.timer_elapsed_secs = 4 * 3600 + 600;
        assert!(r.tick(&cfg(), &c).is_empty(), "samme periode, ikke igen");
        c.timer_elapsed_secs = 8 * 3600;
        assert_eq!(r.tick(&cfg(), &c).len(), 1, "næste periode");
    }

    #[test]
    fn lang_timer_nulstilles_naar_timeren_stoppes() {
        let mut r = Reminders::new();
        let mut c = ctx(at(26, 15, 0));
        c.timer = TimerStatus::Running;
        c.timer_elapsed_secs = 4 * 3600;
        assert_eq!(r.tick(&cfg(), &c).len(), 1);
        // Stoppet og en ny timer, der også bliver lang
        c.timer = TimerStatus::Idle;
        c.timer_elapsed_secs = 0;
        r.tick(&cfg(), &c);
        c.timer = TimerStatus::Running;
        c.timer_elapsed_secs = 4 * 3600;
        assert_eq!(r.tick(&cfg(), &c).len(), 1);
    }

    #[test]
    fn lang_timer_paa_pause_giver_ingen_paamindelse() {
        let mut r = Reminders::new();
        let mut c = ctx(at(26, 15, 0));
        c.timer = TimerStatus::Paused;
        c.timer_elapsed_secs = 5 * 3600;
        assert!(r.tick(&cfg(), &c).is_empty());
    }

    #[test]
    fn gennemgang_en_gang_om_dagen_kun_med_forslag() {
        let mut r = Reminders::new();
        let mut c = ctx(at(26, 16, 59));
        c.unconfirmed_suggestions = 3;
        // (arbejdstiden er ikke slut endnu, men start-påmindelsen er heller ikke aktuel her)
        c.last_tracked_at = Some(at(26, 16, 50));
        assert!(r.tick(&cfg(), &c).is_empty(), "før kl. 17");
        c.now = at(26, 17, 0);
        assert_eq!(
            r.tick(&cfg(), &c),
            vec![Reminder::Review { suggestions: 3 }]
        );
        c.now = at(26, 17, 5);
        assert!(r.tick(&cfg(), &c).is_empty(), "kun én gang");
        c.now = at(27, 17, 0);
        assert_eq!(r.tick(&cfg(), &c).len(), 1, "næste dag igen");

        let mut r = Reminders::new();
        let mut c = ctx(at(26, 17, 0));
        c.unconfirmed_suggestions = 0;
        assert!(r.tick(&cfg(), &c).is_empty());
        c.unconfirmed_suggestions = 2;
        c.now = at(26, 18, 0);
        assert_eq!(
            r.tick(&cfg(), &c).len(),
            1,
            "et forslag der dukker op senere"
        );
    }

    #[test]
    fn ændret_gennemgangstidspunkt() {
        let mut r = Reminders::new();
        let mut s = cfg();
        s.review_time = NaiveTime::from_hms_opt(15, 30, 0).unwrap();
        let mut c = ctx(at(26, 15, 30));
        c.unconfirmed_suggestions = 1;
        c.last_tracked_at = Some(at(26, 15, 25));
        let got = r.tick(&s, &c);
        assert_eq!(got, vec![Reminder::Review { suggestions: 1 }]);
        assert!(got[0].notification().body.contains("1 forslag"));
    }

    #[test]
    fn beskeder_er_paa_dansk() {
        let n = Reminder::LongRunning {
            running_secs: 4 * 3600,
        }
        .notification();
        assert!(n.body.contains("4 t"));
        assert_eq!(n.kind, NotificationKind::Reminder);
        let n = Reminder::StartTimer { idle_minutes: 30 }.notification();
        assert!(n.body.contains("30 minutter"));
    }
}
