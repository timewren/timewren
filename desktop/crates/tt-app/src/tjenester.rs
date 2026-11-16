//! Baggrundstjenesterne (spec D21 og licens): pomodoro, påmindelser, adgang
//! (licens/plan) og idle-spørgsmålet.
//!
//! `tick` og `idle_flow` er almindelige funktioner mod `Backend`, så de kan
//! testes med `MockBackend` og et manuelt ur. `install` kører dem på
//! baggrundsexecutoren og lægger resultatet i `DataHub`, så UI'et kun
//! tegner: det kalder aldrig datalaget på UI-tråden.

use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::licens::Access;
use crate::backend::services::{IdleReturnEvent, IdleRx};
use crate::backend::{Backend, DateRange, TimerStatus};
use crate::i18n::{t, tf};
use crate::idle::{self, IdlePrompt};
use crate::notify::{Dispatcher, Notification, NotificationKind, NotifyAction};
use crate::paamindelser::{Context as ReminderContext, Reminder, Reminders};
use crate::pomodoro::{Effect, Pomodoro};
use crate::ur::{Clock, SystemClock};

/// Hvor ofte baggrundsopgaven kører.
const TICK: StdDuration = StdDuration::from_secs(5);
/// Hvor ofte planen spørges hos web (ellers læses kun de lokale filer).
const ACCESS_REFRESH: Duration = Duration::minutes(5);

pub struct TickState {
    pub reminders: Reminders,
    pub pomodoro: Pomodoro,
    last_access_refresh: Option<DateTime<Utc>>,
    /// Kalender og møder (kalender). `None` i tests uden kalender.
    pub kalender: Option<Arc<crate::kalenderkilder::Kalender>>,
}

impl Default for TickState {
    fn default() -> Self {
        Self::new()
    }
}

impl TickState {
    pub fn new() -> Self {
        TickState {
            reminders: Reminders::new(),
            pomodoro: Pomodoro::new(),
            last_access_refresh: None,
            kalender: crate::kalenderkilder::global(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TickOutput {
    pub access: Access,
    pub pomodoro: Option<String>,
    pub timer_active: bool,
    /// Tickens egne handlinger (fx pause i pomodoro) har ændret data.
    pub changed: bool,
    /// Et møde er slut og venter på svar (kalender).
    pub meetings_changed: bool,
}

/// Slutningen på dagens seneste registrerede tid.
fn last_tracked(b: &dyn Backend, today: NaiveDate) -> Option<DateTime<Local>> {
    use chrono::TimeZone;
    b.entries(DateRange::day(today))
        .ok()?
        .into_iter()
        .filter(|e| e.date == today)
        .filter_map(|e| e.end)
        .max()
        .and_then(|t| Local.from_local_datetime(&today.and_time(t)).earliest())
}

pub fn tick(
    b: &dyn Backend,
    st: &mut TickState,
    clock: &dyn Clock,
    notifier: &Dispatcher,
) -> TickOutput {
    let now = clock.now();
    let mut changed = false;

    // ---- adgang (licens/plan): spørg web sjældent, læs ellers filerne
    let due = st
        .last_access_refresh
        .is_none_or(|l| now - l >= ACCESS_REFRESH);
    let access = if due {
        st.last_access_refresh = Some(now);
        b.refresh_access()
    } else {
        b.access()
    };

    let (Ok(settings), Ok(timer)) = (b.settings(), b.timer()) else {
        return TickOutput {
            access,
            pomodoro: None,
            timer_active: false,
            changed,
            meetings_changed: false,
        };
    };
    let cfg = &settings.d21;
    let timer_active = timer.status != TimerStatus::Idle;

    // ---- pomodoro
    for effect in st.pomodoro.update(&cfg.pomodoro, now, timer.status) {
        match effect {
            Effect::Notify(n) => {
                notifier.dispatch(&cfg.notifications, &n);
            }
            Effect::PauseTimer => {
                // Fejler pausen, kører timeren videre: tiden går ikke tabt.
                changed |= b.timer_pause().is_ok();
            }
        }
    }
    let pomodoro = st.pomodoro.label(&cfg.pomodoro);

    // ---- påmindelser
    let local = clock.local();
    let r = &cfg.reminders;
    if r.start_timer || r.long_running || r.review {
        let today = local.date_naive();
        let review_due = r.review && local.time() >= r.review_time;
        let ctx = ReminderContext {
            now: local,
            timer: timer.status,
            timer_elapsed_secs: timer.elapsed_secs(local),
            last_tracked_at: if r.start_timer {
                last_tracked(b, today)
            } else {
                None
            },
            unconfirmed_suggestions: 0,
        };
        let open = if review_due {
            b.suggestions(today).unwrap_or_default()
        } else {
            vec![]
        };
        let ctx = ReminderContext {
            unconfirmed_suggestions: open.len(),
            ..ctx
        };
        for reminder in st.reminders.tick(r, &ctx) {
            let n = with_actions(&reminder, &open);
            notifier.dispatch(&cfg.notifications, &n);
        }
    }

    // ---- møder (kalender): et møde, der er slut, venter på svar. Uden for
    // arbejdstiden sendes ingen notifikation; mødekortet i appen venter.
    let mut meetings_changed = false;
    if let Some(k) = st.kalender.as_ref()
        && let Some(p) = k.poll(now)
    {
        meetings_changed = true;
        if already_tracked(b, &timer, &p) {
            // En timer kørte under mødet, eller tiden er registreret: spørg ikke.
            k.take_pending(&p.meeting.id);
        } else if r.in_work_hours(local) {
            notifier.dispatch(&cfg.notifications, &meeting_notification(&p));
        }
    }

    TickOutput {
        access,
        pomodoro,
        timer_active,
        changed,
        meetings_changed,
    }
}

/// Er mødets tid allerede med: en timer, der kørte fra mødets start, eller
/// poster, der dækker mindst 80 % af mødet?
pub fn already_tracked(
    b: &dyn Backend,
    timer: &crate::backend::TimerState,
    p: &crate::kalenderkilder::PendingMeeting,
) -> bool {
    use chrono::TimeZone;
    let (start, end) = (p.meeting.start, p.meeting.end);
    if timer.status != TimerStatus::Idle
        && timer.started_at.is_some_and(|s| s.with_timezone(&Utc) <= start + Duration::minutes(1))
    {
        return true;
    }
    let day = start.with_timezone(&Local).date_naive();
    let Ok(entries) = b.entries(DateRange::day(day)) else {
        return false;
    };
    let total = (end - start).num_seconds().max(1);
    let mut spans: Vec<(i64, i64)> = entries
        .iter()
        .filter_map(|e| {
            let s = Local.from_local_datetime(&day.and_time(e.start?)).earliest()?;
            let t = Local.from_local_datetime(&day.and_time(e.end?)).earliest()?;
            Some((s.timestamp().max(start.timestamp()), t.timestamp().min(end.timestamp())))
        })
        .filter(|(x, y)| x < y)
        .collect();
    spans.sort();
    let (mut covered, mut reach) = (0i64, start.timestamp());
    for (x, y) in spans {
        let x = x.max(reach);
        if y > x {
            covered += y - x;
            reach = y;
        }
    }
    covered * 10 >= total * 8
}

/// Knapperne på påmindelserne (kalender): "Ingen timer" får **Start
/// sidste** og **Vælg …**; dagens gennemgang med ét forslag får **Bekræft**.
pub fn with_actions(r: &Reminder, open: &[crate::backend::Suggestion]) -> Notification {
    let n = r.notification();
    match r {
        Reminder::StartTimer { .. } => {
            n.with_actions(vec![NotifyAction::StartLast, NotifyAction::Choose])
        }
        Reminder::Review { .. } => match open {
            [one] if one.customer_id.is_some() => n.with_actions(vec![
                NotifyAction::Confirm(one.id.clone()),
                NotifyAction::Review,
            ]),
            _ => n.with_actions(vec![NotifyAction::Review]),
        },
        Reminder::LongRunning { .. } => n,
    }
}

/// "Mødet med Bageriet varede 42 min. Registrér?" med Registrér, Ret og
/// Ignorér. Uden kunde er der intet at registrere på, så kun Ret og Ignorér.
pub fn meeting_notification(p: &crate::kalenderkilder::PendingMeeting) -> Notification {
    let id = p.meeting.id.clone();
    let mut actions = vec![];
    if p.customer_id.is_some() {
        actions.push(NotifyAction::MeetingRegister(id.clone()));
    }
    actions.push(NotifyAction::MeetingEdit(id.clone()));
    actions.push(NotifyAction::MeetingIgnore(id));
    Notification::new(
        NotificationKind::Meeting,
        t("moeder.notify.title"),
        crate::moedekort::meeting_text(p),
    )
    .with_actions(actions)
}

/// Trackeren melder, at brugeren er tilbage. Giver spørgsmålet, hvis en timer
/// kørte, og sender en notifikation, så det også ses, når appen ikke har fokus.
pub fn idle_flow(
    b: &dyn Backend,
    ev: &IdleReturnEvent,
    notifier: &Dispatcher,
) -> Option<IdlePrompt> {
    let settings = b.settings().ok()?;
    let timer = b.timer().ok()?;
    let prompt = idle::prompt_for(ev, &timer, &settings.d21.idle_prompt)?;
    notifier.dispatch(
        &settings.d21.notifications,
        &Notification::new(
            NotificationKind::IdleReturn,
            t("d21.idle.notify_title"),
            tf("d21.idle.notify_body", &[("away", &prompt.away_text())]),
        ),
    );
    Some(prompt)
}

/// Starter baggrundstjenesterne. Kaldes én gang, når app-roden er åbnet.
pub fn install(ctx: AppCtx, idle: Option<IdleRx>, cx: &mut App) {
    let notifier = Dispatcher::os();
    let state = Arc::new(Mutex::new(TickState::new()));

    {
        let ctx = ctx.clone();
        let notifier = notifier.clone();
        cx.spawn(async move |cx| {
            loop {
                cx.background_executor().timer(TICK).await;
                let backend = ctx.backend.clone();
                let state = state.clone();
                let notifier = notifier.clone();
                let out = cx
                    .background_executor()
                    .spawn(async move {
                        let mut st = state.lock().unwrap_or_else(|p| p.into_inner());
                        tick(&*backend, &mut st, &SystemClock, &notifier)
                    })
                    .await;
                cx.update(|cx| {
                    let me = ctx.clone();
                    ctx.hub.update(cx, |h, cx| {
                        if h.access != out.access
                            || h.pomodoro != out.pomodoro
                            || h.timer_active != out.timer_active
                        {
                            h.access = out.access.clone();
                            h.pomodoro = out.pomodoro.clone();
                            h.timer_active = out.timer_active;
                            cx.notify();
                        }
                    });
                    if out.changed {
                        me.changed(cx);
                    }
                    if out.meetings_changed {
                        crate::moedekort::MoedeKort::sync_hub(&me, cx);
                    }
                });
            }
        })
        .detach();
    }

    // ---- kalender: hent kilderne i baggrunden (højst hvert 15. minut).
    if let Some(k) = crate::kalenderkilder::global() {
        let ctx = ctx.clone();
        cx.spawn(async move |cx| {
            loop {
                let k = k.clone();
                let changed = cx
                    .background_executor()
                    .spawn(async move { k.refresh(Utc::now(), false) })
                    .await;
                if changed {
                    cx.update(|cx| ctx.changed(cx));
                }
                cx.background_executor().timer(StdDuration::from_secs(60)).await;
            }
        })
        .detach();
    }

    // ---- macOS: svar fra notifikationernes knapper.
    #[cfg(target_os = "macos")]
    if crate::notify_mac::available() {
        crate::notify_mac::install();
        let rx = crate::notify_mac::actions();
        cx.spawn(async move |cx| {
            while let Ok(action) = rx.recv().await {
                cx.update(|cx| crate::app::perform_action(action, cx));
            }
        })
        .detach();
    }

    if let Some(rx) = idle {
        cx.spawn(async move |cx| {
            while let Ok(ev) = rx.recv().await {
                let backend = ctx.backend.clone();
                let notifier = notifier.clone();
                let prompt = cx
                    .background_executor()
                    .spawn(async move { idle_flow(&*backend, &ev, &notifier) })
                    .await;
                // Et nyt spørgsmål erstatter ikke et ubesvaret (#14): samme
                // timer lægges sammen, en anden stilles i kø (`IdleQueue`).
                if let Some(p) = prompt {
                    cx.update(|cx| {
                        ctx.hub.update(cx, |h, cx| {
                            h.idle.push(p);
                            cx.notify();
                        });
                    });
                }
            }
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    // Ikke `super::*`: GPUI's glob-import bringer sin egen `#[test]` med.
    use super::{
        Access, Arc, Backend, Clock, Dispatcher, Duration, IdleReturnEvent, Local, NotifyAction,
        Reminder, TickOutput, TickState, TimerStatus, Utc, idle_flow, tick, with_actions,
    };
    use crate::backend::MockBackend;
    use crate::backend::TimerTarget;
    use crate::notify::RecordingNotifier;
    use crate::ur::ManualClock;

    struct Rig {
        b: MockBackend,
        clock: ManualClock,
        st: TickState,
        rec: Arc<RecordingNotifier>,
        notifier: Dispatcher,
    }

    impl Rig {
        fn new() -> Self {
            // Tom database: demodataens poster ligger på faste klokkeslæt
            let b = MockBackend::empty(Local::now().date_naive());
            // Arbejdstid hele døgnet, alle ugens dage, så testen ikke afhænger af uret
            let mut s = b.settings().unwrap();
            s.d21.reminders.work_start = chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap();
            s.d21.reminders.work_end = chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap();
            s.d21.reminders.work_days = vec![1, 2, 3, 4, 5, 6, 7];
            s.d21.reminders.review = false;
            s.d21.reminders.idle_before_start_minutes = 30;
            b.save_settings(s).unwrap();
            let rec = Arc::new(RecordingNotifier::default());
            Rig {
                b,
                clock: ManualClock::new(Utc::now()),
                st: TickState::new(),
                notifier: Dispatcher::new(rec.clone()),
                rec,
            }
        }

        fn tick(&mut self) -> TickOutput {
            tick(&self.b, &mut self.st, &self.clock, &self.notifier)
        }

        fn titles(&self) -> Vec<String> {
            self.rec
                .sent
                .lock()
                .unwrap()
                .iter()
                .map(|n| n.title.clone())
                .collect()
        }

        fn edit(&self, f: impl FnOnce(&mut crate::backend::Settings)) {
            let mut s = self.b.settings().unwrap();
            f(&mut s);
            self.b.save_settings(s).unwrap();
        }
    }

    fn target() -> TimerTarget {
        TimerTarget {
            customer_id: Some("kunde_bageriet".into()),
            ..Default::default()
        }
    }

    #[test]
    fn paamindelse_om_at_starte_timer_foerst_naar_der_er_gaaet_30_min() {
        let mut r = Rig::new();
        r.edit(|s| s.d21.reminders.long_running = false);
        // Arbejdstiden begyndte ved midnat, så der er gået mere end 30 min (undtagen lige efter midnat)
        let out = r.tick();
        assert_eq!(out.access, Access::Full);
        let local = r.clock.local();
        if local.time() >= chrono::NaiveTime::from_hms_opt(0, 31, 0).unwrap() {
            assert_eq!(r.titles(), vec!["Skal timeren køre?"]);
            // ... og ikke igen med det samme
            r.clock.advance(Duration::seconds(5));
            r.tick();
            assert_eq!(r.titles().len(), 1);
        }
    }

    #[test]
    fn notifikationer_kan_slaas_fra_i_indstillingerne() {
        let mut r = Rig::new();
        r.edit(|s| s.d21.notifications.reminders = false);
        r.tick();
        assert!(r.titles().is_empty());
        r.edit(|s| {
            s.d21.notifications.enabled = false;
            s.d21.notifications.reminders = true;
        });
        r.clock.advance(Duration::hours(2));
        r.tick();
        assert!(r.titles().is_empty());
    }

    #[test]
    fn pomodoro_pauser_timeren_og_siger_til() {
        let mut r = Rig::new();
        r.edit(|s| {
            s.d21.pomodoro.enabled = true;
            s.d21.reminders.start_timer = false;
            s.d21.reminders.long_running = false;
        });
        r.b.timer_start(target()).unwrap();
        // Tiden går, 5 sekunder ad gangen, som i appen
        let mut last = r.tick();
        assert!(last.pomodoro.as_deref().unwrap().starts_with("Arbejde"));
        for _ in 0..(25 * 60 / 5 + 2) {
            r.clock.advance(Duration::seconds(5));
            last = r.tick();
        }
        assert_eq!(r.titles(), vec!["Arbejdsrunden er slut"]);
        assert_eq!(r.b.timer().unwrap().status, TimerStatus::Paused);
        assert!(last.pomodoro.as_deref().unwrap().starts_with("Pause"));
        assert!(last.timer_active);
    }

    #[test]
    fn lang_timer_giver_paamindelse_en_gang() {
        let mut r = Rig::new();
        r.edit(|s| {
            s.d21.reminders.start_timer = false;
            s.d21.reminders.long_running_hours = 1;
        });
        r.b.demo_timer(target(), 2 * 3600);
        r.tick();
        r.tick();
        assert_eq!(r.titles(), vec!["Timeren har kørt længe"]);
    }

    #[test]
    fn idle_flow_spoerger_kun_naar_timeren_koerte_og_notificerer() {
        let r = Rig::new();
        let end = Utc::now();
        let ev = IdleReturnEvent {
            start: end - Duration::minutes(20),
            end,
            duration_secs: 20 * 60,
        };
        // Ingen timer: intet spørgsmål
        assert!(idle_flow(&r.b, &ev, &r.notifier).is_none());
        assert!(r.titles().is_empty());
        // En timer, der har kørt længe nok
        r.b.demo_timer(target(), 3600);
        let p = idle_flow(&r.b, &ev, &r.notifier).expect("spørgsmål");
        assert_eq!(p.away_secs, 20 * 60);
        assert_eq!(r.titles(), vec!["Velkommen tilbage"]);
        // Spørgsmålet kan slås fra
        r.edit(|s| s.d21.idle_prompt.enabled = false);
        assert!(idle_flow(&r.b, &ev, &r.notifier).is_none());
    }

    #[test]
    fn adgang_spoerges_hos_web_hvert_5_minut() {
        let mut r = Rig::new();
        r.tick();
        assert!(r.st.last_access_refresh.is_some());
        let first = r.st.last_access_refresh;
        r.clock.advance(Duration::minutes(2));
        r.tick();
        assert_eq!(r.st.last_access_refresh, first);
        r.clock.advance(Duration::minutes(4));
        r.tick();
        assert_ne!(r.st.last_access_refresh, first);
    }

    // ---- kalender: møder og knapper

    fn meeting_rig(r: &mut Rig) -> Arc<std::sync::Mutex<crate::moeder::Foreground>> {
        use crate::moeder::Foreground;
        let k = Arc::new(crate::kalenderkilder::Kalender::new(None, Box::new(|_| vec![])));
        let fg = Arc::new(std::sync::Mutex::new(Foreground::Other));
        let f2 = fg.clone();
        k.set_foreground(Box::new(move || f2.lock().unwrap().clone()));
        k.set_catalog(&r.b.customers(false).unwrap(), &r.b.projects(None, false).unwrap());
        r.st.kalender = Some(k);
        r.edit(|s| {
            s.d21.reminders.start_timer = false;
            s.d21.reminders.long_running = false;
        });
        fg
    }

    fn zoom_meeting(r: &mut Rig, fg: &std::sync::Mutex<crate::moeder::Foreground>) -> Vec<TickOutput> {
        use crate::moeder::{Foreground, MeetingKind};
        *fg.lock().unwrap() = Foreground::Meeting {
            kind: MeetingKind::Zoom,
            hint: "Zoom Meeting".into(),
        };
        let mut outs = vec![];
        for _ in 0..(30 * 60 / 5) {
            outs.push(r.tick());
            r.clock.advance(Duration::seconds(5));
        }
        *fg.lock().unwrap() = Foreground::Other;
        for _ in 0..40 {
            outs.push(r.tick());
            r.clock.advance(Duration::seconds(5));
        }
        outs
    }

    #[test]
    fn moede_der_slutter_giver_notifikation_med_knapper_i_arbejdstiden() {
        let mut r = Rig::new();
        let fg = meeting_rig(&mut r);
        let outs = zoom_meeting(&mut r, &fg);
        assert_eq!(outs.iter().filter(|o| o.meetings_changed).count(), 1);
        let sent = r.rec.sent.lock().unwrap().clone();
        assert_eq!(sent.len(), 1, "{sent:?}");
        let n = &sent[0];
        assert_eq!(n.title, "Mødet er slut");
        assert_eq!(n.body, "Zoom-mødet varede 30 min. Registrér?");
        // Uden kunde: Ret og Ignorér
        assert_eq!(n.actions.iter().map(|a| a.verb()).collect::<Vec<_>>(), vec!["moede-ret", "moede-ignorer"]);
        assert_eq!(r.st.kalender.as_ref().unwrap().pending().len(), 1);
    }

    #[test]
    fn moede_uden_for_arbejdstid_venter_i_appen_uden_notifikation() {
        let mut r = Rig::new();
        let fg = meeting_rig(&mut r);
        // Kun overmorgen er arbejdsdag (mødet varer over en halv time, så
        // efter 23.27 ville "i morgen" nås, før det slutter)
        use chrono::Datelike;
        let today = r.clock.local().weekday().number_from_monday() as u8;
        r.edit(|s| s.d21.reminders.work_days = vec![(today + 1) % 7 + 1]);
        let outs = zoom_meeting(&mut r, &fg);
        assert!(outs.iter().any(|o| o.meetings_changed));
        assert!(r.titles().is_empty());
        assert_eq!(r.st.kalender.as_ref().unwrap().pending().len(), 1);
        // Notifikationen for møder kan også slås fra for sig
        let mut r = Rig::new();
        let fg = meeting_rig(&mut r);
        r.edit(|s| s.d21.notifications.meetings = false);
        zoom_meeting(&mut r, &fg);
        assert!(r.titles().is_empty());
    }

    #[test]
    fn paamindelser_faar_knapper() {
        let n = with_actions(&Reminder::StartTimer { idle_minutes: 30 }, &[]);
        assert_eq!(n.actions, vec![NotifyAction::StartLast, NotifyAction::Choose]);
        let b = MockBackend::demo();
        let open: Vec<_> = b
            .suggestions(b.today())
            .unwrap()
            .into_iter()
            .filter(|s| s.customer_id.is_some())
            .take(1)
            .collect();
        if let [one] = open.as_slice() {
            let n = with_actions(&Reminder::Review { suggestions: 1 }, &open);
            assert_eq!(n.actions, vec![NotifyAction::Confirm(one.id.clone()), NotifyAction::Review]);
        }
        let n = with_actions(&Reminder::Review { suggestions: 3 }, &[]);
        assert_eq!(n.actions, vec![NotifyAction::Review]);
        assert!(with_actions(&Reminder::LongRunning { running_secs: 4 * 3600 }, &[]).actions.is_empty());
    }

    #[test]
    fn moede_mens_timeren_koerte_giver_intet_spoergsmaal() {
        let mut r = Rig::new();
        let fg = meeting_rig(&mut r);
        r.b.timer_start(target()).unwrap();
        let outs = zoom_meeting(&mut r, &fg);
        assert!(outs.iter().any(|o| o.meetings_changed));
        assert!(r.titles().is_empty(), "{:?}", r.titles());
        assert!(r.st.kalender.as_ref().unwrap().pending().is_empty());
    }
}
