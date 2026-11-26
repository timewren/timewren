//! Indstillinger → Påmindelser: idle-spørgsmål, påmindelser, pomodoro og
//! notifikationer (spec D21). Alle valg gemmes med det samme.
//!
//! Tal og klokkeslæt ændres med Mindre/Mere i faste trin i stedet for
//! tekstfelter, så der ikke kan skrives en ugyldig værdi.

use chrono::{NaiveTime, Timelike};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{Disableable as _, Selectable as _, Sizable as _, h_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::{IndstillingerScreen, row};
use crate::backend::Settings;
use crate::brand::Brand;
use crate::i18n::{t, tf};
use crate::ui;

use super::Data;

const IDLE_MINUTES: &[u32] = &[1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const QUIET_MINUTES: &[u32] = &[5, 10, 15, 30, 45, 60, 90, 120, 240, 480];
const LONG_HOURS: &[u32] = &[1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24];
const WORK_MINUTES: &[u32] = &[15, 20, 25, 30, 45, 50, 60, 90, 120];
const SHORT_BREAKS: &[u32] = &[3, 5, 10, 15, 20, 30, 45, 60];
const LONG_BREAKS: &[u32] = &[10, 15, 20, 30, 45, 60];
const ROUNDS: &[u32] = &[2, 3, 4, 5, 6, 8, 10];
/// Klokkeslæt i halve timer (minutter siden midnat).
const HALF_HOURS: &[u32] = &{
    let mut a = [0u32; 48];
    let mut i = 0;
    while i < 48 {
        a[i] = i as u32 * 30;
        i += 1;
    }
    a
};

/// Næste (eller forrige) værdi i trinene. Står `cur` mellem to trin, rykkes
/// der til det nærmeste i den ønskede retning; i enden bliver den stående.
pub(super) fn step_preset(cur: u32, presets: &[u32], up: bool) -> u32 {
    if up {
        presets
            .iter()
            .copied()
            .find(|p| *p > cur)
            .unwrap_or(cur.max(*presets.last().unwrap_or(&cur)))
    } else {
        presets
            .iter()
            .rev()
            .copied()
            .find(|p| *p < cur)
            .unwrap_or(cur.min(*presets.first().unwrap_or(&cur)))
    }
}

pub(super) fn hm(minutes: u32) -> NaiveTime {
    NaiveTime::from_hms_opt((minutes / 60).min(23), minutes % 60, 0).expect("gyldigt klokkeslæt")
}

pub(super) fn minutes_of(t: NaiveTime) -> u32 {
    t.hour() * 60 + t.minute()
}

fn fmt_clock(minutes: u32) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

fn fmt_minutes(n: u32) -> String {
    tf("indstillinger.rutiner.minutes", &[("n", &n.to_string())])
}

fn fmt_hours(n: u32) -> String {
    tf("indstillinger.rutiner.hours", &[("n", &n.to_string())])
}

fn fmt_rounds(n: u32) -> String {
    tf("indstillinger.rutiner.rounds", &[("n", &n.to_string())])
}

impl IndstillingerScreen {
    #[allow(clippy::too_many_arguments)]
    fn rutiner_toggle(
        &self,
        b: &Brand,
        id: &'static str,
        title: &str,
        help: &str,
        checked: bool,
        set: impl Fn(&mut Settings, bool) + Clone + 'static,
        cx: &mut Context<Self>,
    ) -> Div {
        row(b, id, title, help).child(
            Switch::new(SharedString::from(format!("{id}-kontakt")))
                .checked(checked)
                .accessibility_label(title.to_string())
                .on_click(cx.listener(move |this, on: &bool, _, cx| {
                    let on = *on;
                    let set = set.clone();
                    this.update(t("indstillinger.rutiner.saved"), move |s| set(s, on), cx);
                })),
        )
    }

    /// En værdi med Mindre/Mere.
    #[allow(clippy::too_many_arguments)]
    fn rutiner_stepper(
        &self,
        b: &Brand,
        id: &'static str,
        title: &str,
        help: &str,
        cur: u32,
        presets: &'static [u32],
        fmt: fn(u32) -> String,
        set: impl Fn(&mut Settings, u32) + Clone + 'static,
        cx: &mut Context<Self>,
    ) -> Div {
        let down = step_preset(cur, presets, false);
        let up = step_preset(cur, presets, true);
        let shown = fmt(cur);
        let label = tf(
            "indstillinger.rutiner.change_label",
            &[("what", title), ("value", &shown)],
        );
        let button = |suffix: &'static str, text: &'static str, target: u32, enabled: bool| {
            let set = set.clone();
            Button::new(SharedString::from(format!("{id}-{suffix}")))
                .label(if suffix == "mindre" { "−" } else { "+" })
                .ghost()
                .small()
                .disabled(!enabled)
                .accessibility_label(format!("{label}: {text}"))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let set = set.clone();
                    this.update(
                        t("indstillinger.rutiner.saved"),
                        move |s| set(s, target),
                        cx,
                    );
                }))
        };
        row(b, id, title, help).child(
            h_flex()
                .gap_2()
                .items_center()
                .child(button(
                    "mindre",
                    t("indstillinger.rutiner.less"),
                    down,
                    down != cur,
                ))
                .child(
                    div()
                        .w(px(120.))
                        .text_center()
                        .text_sm()
                        .child(ui::text(SharedString::from(format!("{id}-vaerdi")), shown)),
                )
                .child(button(
                    "mere",
                    t("indstillinger.rutiner.more"),
                    up,
                    up != cur,
                )),
        )
    }

    pub(super) fn render_rutiner(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let s = &d.settings.d21;
        let r = &s.reminders;
        let days = (1u8..=7)
            .map(|day| {
                let on = r.work_days.contains(&day);
                let name = t(match day {
                    1 => "indstillinger.rem.day_1",
                    2 => "indstillinger.rem.day_2",
                    3 => "indstillinger.rem.day_3",
                    4 => "indstillinger.rem.day_4",
                    5 => "indstillinger.rem.day_5",
                    6 => "indstillinger.rem.day_6",
                    _ => "indstillinger.rem.day_7",
                });
                Button::new(("arbejdsdag", usize::from(day)))
                    .label(name)
                    .small()
                    .selected(on)
                    .when(on, |bt| bt.primary())
                    .accessibility_label(format!("{name}: {}", if on { "✓" } else { "–" }))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.update(
                            t("indstillinger.rutiner.saved"),
                            move |s| {
                                let days = &mut s.d21.reminders.work_days;
                                if let Some(i) = days.iter().position(|d| *d == day) {
                                    days.remove(i);
                                } else {
                                    days.push(day);
                                    days.sort_unstable();
                                }
                            },
                            cx,
                        );
                    }))
            })
            .collect::<Vec<_>>();

        ui::card(b, "rutiner", t("indstillinger.rutiner.title"))
            .child(ui::heading(
                b,
                "rutiner-titel",
                t("indstillinger.rutiner.title"),
                2,
            ))
            // ---- idle
            .child(ui::heading(
                b,
                "idle-overskrift",
                t("indstillinger.idle.heading"),
                3,
            ))
            .child(self.rutiner_toggle(
                b,
                "idle-til",
                t("indstillinger.idle.enabled"),
                t("indstillinger.idle.enabled_help"),
                s.idle_prompt.enabled,
                |s, v| s.d21.idle_prompt.enabled = v,
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "idle-minutter",
                t("indstillinger.idle.minutes"),
                t("indstillinger.idle.minutes_help"),
                s.idle_prompt.minutes,
                IDLE_MINUTES,
                fmt_minutes,
                |s, v| s.d21.idle_prompt.minutes = v,
                cx,
            ))
            // ---- påmindelser
            .child(ui::heading(
                b,
                "paamindelser-overskrift",
                t("indstillinger.rem.heading"),
                3,
            ))
            .child(self.rutiner_toggle(
                b,
                "paamind-start",
                t("indstillinger.rem.start"),
                t("indstillinger.rem.start_help"),
                r.start_timer,
                |s, v| s.d21.reminders.start_timer = v,
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "paamind-stille",
                t("indstillinger.rem.quiet"),
                "",
                r.idle_before_start_minutes,
                QUIET_MINUTES,
                fmt_minutes,
                |s, v| s.d21.reminders.idle_before_start_minutes = v,
                cx,
            ))
            .child(self.rutiner_toggle(
                b,
                "paamind-lang",
                t("indstillinger.rem.long"),
                "",
                r.long_running,
                |s, v| s.d21.reminders.long_running = v,
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "paamind-lang-timer",
                t("indstillinger.rem.long_hours"),
                "",
                r.long_running_hours,
                LONG_HOURS,
                fmt_hours,
                |s, v| s.d21.reminders.long_running_hours = v,
                cx,
            ))
            .child(self.rutiner_toggle(
                b,
                "paamind-gennemgang",
                t("indstillinger.rem.review"),
                t("indstillinger.rem.review_help"),
                r.review,
                |s, v| s.d21.reminders.review = v,
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "paamind-gennemgang-tid",
                t("indstillinger.rem.review_time"),
                "",
                minutes_of(r.review_time),
                HALF_HOURS,
                fmt_clock,
                |s, v| s.d21.reminders.review_time = hm(v),
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "arbejdstid-start",
                t("indstillinger.rem.work_start"),
                "",
                minutes_of(r.work_start),
                HALF_HOURS,
                fmt_clock,
                |s, v| s.d21.reminders.work_start = hm(v),
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "arbejdstid-slut",
                t("indstillinger.rem.work_end"),
                "",
                minutes_of(r.work_end),
                HALF_HOURS,
                fmt_clock,
                |s, v| s.d21.reminders.work_end = hm(v),
                cx,
            ))
            .child(
                row(b, "arbejdsdage", t("indstillinger.rem.work_days"), "")
                    .child(h_flex().gap_1().children(days)),
            )
            .into_any_element()
    }

    pub(super) fn render_pomodoro(
        &self,
        b: &Brand,
        d: &Data,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let s = &d.settings.d21;
        let p = &s.pomodoro;
        let n = &s.notifications;
        ui::card(b, "pomodoro", t("indstillinger.pomo.title"))
            .child(ui::heading(
                b,
                "pomodoro-titel",
                t("indstillinger.pomo.title"),
                2,
            ))
            .child(ui::heading(
                b,
                "pomodoro-overskrift",
                t("indstillinger.pomo.heading"),
                3,
            ))
            .child(self.rutiner_toggle(
                b,
                "pomodoro-til",
                t("indstillinger.pomo.enabled"),
                t("indstillinger.pomo.enabled_help"),
                p.enabled,
                |s, v| s.d21.pomodoro.enabled = v,
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "pomodoro-arbejde",
                t("indstillinger.pomo.work"),
                "",
                p.work_minutes,
                WORK_MINUTES,
                fmt_minutes,
                |s, v| s.d21.pomodoro.work_minutes = v,
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "pomodoro-kort",
                t("indstillinger.pomo.short"),
                "",
                p.short_break_minutes,
                SHORT_BREAKS,
                fmt_minutes,
                |s, v| s.d21.pomodoro.short_break_minutes = v,
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "pomodoro-lang",
                t("indstillinger.pomo.long"),
                "",
                p.long_break_minutes,
                LONG_BREAKS,
                fmt_minutes,
                |s, v| s.d21.pomodoro.long_break_minutes = v,
                cx,
            ))
            .child(self.rutiner_stepper(
                b,
                "pomodoro-runder",
                t("indstillinger.pomo.rounds"),
                "",
                p.sessions_before_long,
                ROUNDS,
                fmt_rounds,
                |s, v| s.d21.pomodoro.sessions_before_long = v,
                cx,
            ))
            .child(self.rutiner_toggle(
                b,
                "pomodoro-pause-timer",
                t("indstillinger.pomo.pause_timer"),
                t("indstillinger.pomo.pause_timer_help"),
                p.pause_timer_on_break,
                |s, v| s.d21.pomodoro.pause_timer_on_break = v,
                cx,
            ))
            // ---- notifikationer
            .child(ui::heading(
                b,
                "notif-overskrift",
                t("indstillinger.notif.heading"),
                3,
            ))
            .child(self.rutiner_toggle(
                b,
                "notif-til",
                t("indstillinger.notif.enabled"),
                t("indstillinger.notif.enabled_help"),
                n.enabled,
                |s, v| s.d21.notifications.enabled = v,
                cx,
            ))
            .child(self.rutiner_toggle(
                b,
                "notif-idle",
                t("indstillinger.notif.idle"),
                "",
                n.idle_return,
                |s, v| s.d21.notifications.idle_return = v,
                cx,
            ))
            .child(self.rutiner_toggle(
                b,
                "notif-paamindelser",
                t("indstillinger.notif.reminders"),
                "",
                n.reminders,
                |s, v| s.d21.notifications.reminders = v,
                cx,
            ))
            .child(self.rutiner_toggle(
                b,
                "notif-pomodoro",
                t("indstillinger.notif.pomodoro"),
                "",
                n.pomodoro,
                |s, v| s.d21.notifications.pomodoro = v,
                cx,
            ))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    // Ikke `super::*`: GPUI's glob-import bringer sin egen `#[test]` med.
    use super::{
        HALF_HOURS, IDLE_MINUTES, LONG_BREAKS, LONG_HOURS, QUIET_MINUTES, ROUNDS, SHORT_BREAKS,
        WORK_MINUTES, fmt_clock, hm, minutes_of, step_preset,
    };
    use chrono::NaiveTime;

    #[test]
    fn trin_op_og_ned_med_stop_i_enderne() {
        assert_eq!(step_preset(25, WORK_MINUTES, true), 30);
        assert_eq!(step_preset(25, WORK_MINUTES, false), 20);
        // Står værdien mellem to trin, rykkes den til det nærmeste i retningen
        assert_eq!(step_preset(27, WORK_MINUTES, true), 30);
        assert_eq!(step_preset(27, WORK_MINUTES, false), 25);
        // Enderne
        assert_eq!(step_preset(120, WORK_MINUTES, true), 120);
        assert_eq!(step_preset(15, WORK_MINUTES, false), 15);
        // En værdi uden for trinene (fra en gammel fil) mistes ikke
        assert_eq!(step_preset(200, WORK_MINUTES, true), 200);
        assert_eq!(step_preset(7, WORK_MINUTES, false), 7);
    }

    #[test]
    fn alle_standarder_ligger_paa_et_trin() {
        let d = crate::backend::d21::D21Settings::default();
        assert!(IDLE_MINUTES.contains(&d.idle_prompt.minutes));
        assert!(QUIET_MINUTES.contains(&d.reminders.idle_before_start_minutes));
        assert!(LONG_HOURS.contains(&d.reminders.long_running_hours));
        assert!(WORK_MINUTES.contains(&d.pomodoro.work_minutes));
        assert!(SHORT_BREAKS.contains(&d.pomodoro.short_break_minutes));
        assert!(LONG_BREAKS.contains(&d.pomodoro.long_break_minutes));
        assert!(ROUNDS.contains(&d.pomodoro.sessions_before_long));
        assert!(HALF_HOURS.contains(&minutes_of(d.reminders.work_start)));
        assert!(HALF_HOURS.contains(&minutes_of(d.reminders.review_time)));
    }

    #[test]
    fn trinene_holder_sig_inden_for_det_gyldige() {
        let mut d = crate::backend::d21::D21Settings::default();
        for (list, set) in [
            (IDLE_MINUTES, 0),
            (WORK_MINUTES, 1),
            (SHORT_BREAKS, 2),
            (LONG_BREAKS, 3),
            (ROUNDS, 4),
            (LONG_HOURS, 5),
            (QUIET_MINUTES, 6),
        ] {
            for v in list {
                match set {
                    0 => d.idle_prompt.minutes = *v,
                    1 => d.pomodoro.work_minutes = *v,
                    2 => d.pomodoro.short_break_minutes = *v,
                    3 => d.pomodoro.long_break_minutes = *v,
                    4 => d.pomodoro.sessions_before_long = *v,
                    5 => d.reminders.long_running_hours = *v,
                    _ => d.reminders.idle_before_start_minutes = *v,
                }
                assert!(
                    crate::backend::d21::validate(&d).is_ok(),
                    "trin {v} i liste {set} er ugyldigt"
                );
            }
            d = crate::backend::d21::D21Settings::default();
        }
    }

    #[test]
    fn klokkeslaet_runde_tur() {
        assert_eq!(fmt_clock(9 * 60 + 30), "09:30");
        assert_eq!(minutes_of(hm(17 * 60)), 17 * 60);
        assert_eq!(
            hm(23 * 60 + 30),
            NaiveTime::from_hms_opt(23, 30, 0).unwrap()
        );
        assert_eq!(HALF_HOURS.len(), 48);
        assert_eq!(*HALF_HOURS.last().unwrap(), 23 * 60 + 30);
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use gpui_kit::TestAppContext;

    use crate::backend::licens::{Access, LockReason};
    use crate::backend::{Backend as _, DateRange, TimerStatus, TimerTarget};
    use crate::idle::IdlePrompt;
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    fn target() -> TimerTarget {
        TimerTarget {
            customer_id: Some("kunde_bageriet".into()),
            project_id: Some("proj_webshop".into()),
            task_id: None,
            description: "Idle-test".into(),
        }
    }

    #[gpui_kit::test]
    fn rutiner_gemmer_valgene(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-rutiner");
        p.assert_label(cx, "Påmindelser");
        p.assert_all_labelled(cx);

        p.click(cx, "idle-minutter-mindre");
        assert_eq!(p.mock.settings().unwrap().d21.idle_prompt.minutes, 5);
        p.click(cx, ("arbejdsdag", 6usize));
        assert!(
            p.mock
                .settings()
                .unwrap()
                .d21
                .reminders
                .work_days
                .contains(&6)
        );
        p.click(cx, ("arbejdsdag", 1usize));
        assert!(
            !p.mock
                .settings()
                .unwrap()
                .d21
                .reminders
                .work_days
                .contains(&1)
        );
        p.click(cx, "paamind-start-kontakt");
        assert!(!p.mock.settings().unwrap().d21.reminders.start_timer);
        // Arbejdstiden kan ikke slutte før den begynder: afvises og gemmes ikke
        for _ in 0..40 {
            p.click(cx, "arbejdstid-slut-mindre");
        }
        let r = p.mock.settings().unwrap().d21.reminders;
        assert!(r.work_end > r.work_start);
        p.assert_label(cx, "Arbejdstiden skal slutte efter den begynder");
    }

    #[gpui_kit::test]
    fn pomodoro_og_notifikationer_gemmes(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-pomodoro");
        p.assert_label(cx, "Pomodoro og notifikationer");
        p.assert_all_labelled(cx);
        p.click(cx, "pomodoro-til-kontakt");
        assert!(p.mock.settings().unwrap().d21.pomodoro.enabled);
        p.click(cx, "pomodoro-arbejde-mere");
        assert_eq!(p.mock.settings().unwrap().d21.pomodoro.work_minutes, 30);
        p.click(cx, "pomodoro-arbejde-mindre");
        p.click(cx, "pomodoro-arbejde-mindre");
        assert_eq!(p.mock.settings().unwrap().d21.pomodoro.work_minutes, 20);
        p.click(cx, "pomodoro-runder-mere");
        assert_eq!(
            p.mock.settings().unwrap().d21.pomodoro.sessions_before_long,
            5
        );
        p.click(cx, "notif-pomodoro-kontakt");
        assert!(!p.mock.settings().unwrap().d21.notifications.pomodoro);
        p.click(cx, "notif-til-kontakt");
        assert!(!p.mock.settings().unwrap().d21.notifications.enabled);
    }

    #[gpui_kit::test]
    fn idle_dialogen_traekker_tid_fra_og_stopper(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_timer(target(), 3600 + 30);
        let p = open(cx, mock, Screen::Hjem);
        let hub = p.app.read_with(cx, |a, _| a.ctx.hub.clone());
        let prompt = IdlePrompt {
            away_since: testing::now(),
            back_at: testing::now(),
            away_secs: 20 * 60,
            target: target(),
            timer_started: p.mock.timer().unwrap().started_at,
            periods: 1,
        };
        cx.update(|cx| {
            hub.update(cx, |h, cx| {
                h.idle.push(prompt);
                cx.notify();
            })
        });
        p.settle(cx);
        p.assert_label(cx, "Du har været væk");
        p.assert_label(cx, "Behold tiden");
        p.click(cx, "idle-traek-fra-stop");
        p.settle(cx);
        p.assert_no_label(cx, "Du har været væk");
        assert_eq!(p.mock.timer().unwrap().status, TimerStatus::Idle);
        let mins: Vec<u32> = p
            .mock
            .entries(DateRange::day(p.mock.today()))
            .unwrap()
            .into_iter()
            .filter(|e| e.description == "Idle-test")
            .map(|e| e.minutes)
            .collect();
        assert_eq!(mins, vec![40], "60 minutter minus 20");
    }

    #[gpui_kit::test]
    fn idle_dialogen_behold_aendrer_intet(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_timer(target(), 3600);
        let p = open(cx, mock, Screen::Hjem);
        let hub = p.app.read_with(cx, |a, _| a.ctx.hub.clone());
        let prompt = IdlePrompt {
            away_since: testing::now(),
            back_at: testing::now(),
            away_secs: 600,
            target: target(),
            timer_started: p.mock.timer().unwrap().started_at,
            periods: 1,
        };
        cx.update(|cx| {
            hub.update(cx, |h, cx| {
                h.idle.push(prompt);
                cx.notify();
            })
        });
        p.settle(cx);
        p.click(cx, "idle-behold");
        p.assert_no_label(cx, "Du har været væk");
        assert_eq!(p.mock.timer().unwrap().status, TimerStatus::Running);
    }

    /// To pauser for samme timer før svaret: ét spørgsmål med summen, og
    /// "Træk fra og stop" trækker begge fra (#14).
    #[gpui_kit::test]
    fn idle_dialogen_samler_pauser_for_samme_timer(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_timer(target(), 3600 + 30);
        let p = open(cx, mock, Screen::Hjem);
        let hub = p.app.read_with(cx, |a, _| a.ctx.hub.clone());
        let started = p.mock.timer().unwrap().started_at;
        let now = testing::now();
        for (from, away) in [(50, 10), (20, 15)] {
            let prompt = IdlePrompt {
                away_since: now - chrono::Duration::minutes(from),
                back_at: now - chrono::Duration::minutes(from - away),
                away_secs: (away * 60) as u64,
                target: target(),
                timer_started: started,
                periods: 1,
            };
            cx.update(|cx| {
                hub.update(cx, |h, cx| {
                    h.idle.push(prompt);
                    cx.notify();
                })
            });
        }
        p.settle(cx);
        p.assert_label(cx, "Du var væk i alt 25 minutter, fordelt på 2 pauser");
        p.click(cx, "idle-traek-fra-stop");
        p.settle(cx);
        p.assert_no_label(cx, "Du har været væk");
        let mins: Vec<u32> = p
            .mock
            .entries(DateRange::day(p.mock.today()))
            .unwrap()
            .into_iter()
            .filter(|e| e.description == "Idle-test")
            .map(|e| e.minutes)
            .collect();
        assert_eq!(mins, vec![35], "60 minutter minus 10 og 15");
    }

    #[gpui_kit::test]
    fn banneret_vises_naar_adgangen_er_laast(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Hjem);
        let hub = p.app.read_with(cx, |a, _| a.ctx.hub.clone());
        p.assert_no_label(cx, "prøveperiode");
        cx.update(|cx| {
            hub.update(cx, |h, cx| {
                h.access = Access::Locked(LockReason::TrialExpired);
                h.timer_active = true;
                cx.notify();
            })
        });
        p.settle(cx);
        p.assert_label(cx, "Din prøveperiode er udløbet");
        p.assert_label(cx, "Din kørende timer kan stadig stoppes");
        p.click(cx, "licens-banner-konto");
        p.assert_label(cx, "Sektioner i indstillinger");
        // Låses op igen
        cx.update(|cx| {
            hub.update(cx, |h, cx| {
                h.access = Access::Full;
                cx.notify();
            })
        });
        p.settle(cx);
        p.assert_no_label(cx, "Din prøveperiode er udløbet");
    }

    #[gpui_kit::test]
    fn pomodoro_linjen_vises_i_menuen(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Hjem);
        let hub = p.app.read_with(cx, |a, _| a.ctx.hub.clone());
        cx.update(|cx| {
            hub.update(cx, |h, cx| {
                h.pomodoro = Some("Arbejde 24:00 · runde 1 af 4".into());
                cx.notify();
            })
        });
        p.settle(cx);
        p.assert_label(cx, "Arbejde 24:00");
    }
}
