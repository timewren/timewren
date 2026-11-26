//! Menulinje/tray via `tray-icon` (tauri-apps), som i spiken. Lever på
//! hovedtråden ved siden af GPUI. Menu-klik går gennem muda's handler ind i
//! en futures-kanal, som en GPUI-forgrundstask venter på (ingen polling).
//!
//! Titlen er `t:mm` og opdateres én gang i minuttet (ikke hvert sekund, som
//! kostede ~1,1 % CPU i spiken), plus straks når data ændres.

use std::time::Duration;

use chrono::{DateTime, Local};
use futures::StreamExt as _;
use futures::channel::mpsc::{UnboundedReceiver, unbounded};
use gpui_kit::*;
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

use crate::app::AppCtx;
use crate::backend::{Backend, Customer, Suggestion, TimerState, TimerStatus, TimerTarget};
use crate::i18n::tf;
use crate::timer;

/// Hvad trayen viser. Ren data, så den kan testes uden menulinje.
#[derive(Clone, Debug, PartialEq)]
pub struct TrayModel {
    pub title: String,
    pub tooltip: String,
    pub toggle_label: &'static str,
    pub stop_enabled: bool,
    /// "Det ligner Bageriet. Start timer?" og målet, timeren startes med.
    pub suggestion: Option<(String, TimerTarget)>,
    /// gendan: "Dagens total: 2,5 t" (dagens poster + timeren).
    pub day_total: String,
}

impl TrayModel {
    pub fn build(
        t: &TimerState,
        suggestions: &[Suggestion],
        customers: &[Customer],
        now: DateTime<Local>,
    ) -> Self {
        let toggle_label = match t.status {
            TimerStatus::Idle => crate::i18n::t("tray.menu.start"),
            TimerStatus::Running => crate::i18n::t("tray.menu.pause"),
            TimerStatus::Paused => crate::i18n::t("tray.menu.resume"),
        };
        let customer = t
            .customer_id
            .as_ref()
            .and_then(|id| customers.iter().find(|c| &c.id == id))
            .map(|c| c.name.as_str());
        let tooltip = match (t.status, customer) {
            (TimerStatus::Idle, _) => crate::i18n::t("tray.tooltip.idle").to_string(),
            (_, Some(c)) => tf(
                "tray.tooltip.running_on",
                &[("time", &timer::tray_title(t, now)), ("customer", c)],
            ),
            (_, None) => tf(
                "tray.tooltip.running",
                &[("time", &timer::tray_title(t, now))],
            ),
        };
        // Forslag kun når timeren står stille: så giver "Start timer?" mening.
        let suggestion = (t.status == TimerStatus::Idle)
            .then(|| timer::current_suggestion(suggestions, now.time()))
            .flatten()
            .and_then(|s| {
                let text = timer::suggestion_prompt(s, customers)?;
                Some((
                    text,
                    TimerTarget {
                        customer_id: s.customer_id.clone(),
                        project_id: s.project_id.clone(),
                        task_id: None,
                        description: s.reason.clone(),
                    },
                ))
            });
        TrayModel {
            title: timer::tray_title(t, now),
            tooltip,
            toggle_label,
            stop_enabled: t.status != TimerStatus::Idle,
            suggestion,
            day_total: day_total_label(0, t, now),
        }
    }

    /// Med dagens registrerede minutter (ud over timeren).
    pub fn with_day_total(mut self, entry_minutes: u32, t: &TimerState, now: DateTime<Local>) -> Self {
        self.day_total = day_total_label(entry_minutes, t, now);
        self
    }
}

/// "Dagens total: 2,5 t": dagens poster plus en kørende eller pauset timer.
pub fn day_total_label(entry_minutes: u32, t: &TimerState, now: DateTime<Local>) -> String {
    let timer_minutes = (t.elapsed_secs(now) / 60) as u32;
    tf(
        "gendan.tray.day_total",
        &[("hours", &crate::ui::format::hours(entry_minutes + timer_minutes))],
    )
}

pub enum TrayCmd {
    Toggle,
    Stop,
    Suggestion,
    Show,
    /// Vis vinduet på Aktivitet (dagens tidslinje).
    Timeline,
    /// "Luk dagen" på Aktivitet. // aktivitet
    CloseDay,
    Quit,
}

pub struct Tray {
    icon: TrayIcon,
    toggle: MenuItem,
    stop: MenuItem,
    suggestion: MenuItem,
    day_total: MenuItem,
    last: Option<TrayModel>,
}

/// 32x32 urskive som template-ikon (macOS farver det selv efter menulinjen).
fn clock_icon() -> Icon {
    let n = 32;
    let mut px = vec![0u8; n * n * 4];
    for y in 0..n {
        for x in 0..n {
            let (dx, dy) = (x as f32 - 15.5, y as f32 - 15.5);
            let r = (dx * dx + dy * dy).sqrt();
            let ring = (12.0..15.0).contains(&r);
            let hand = (dx.abs() < 1.5 && dy < 0.0 && dy > -10.0)
                || (dy.abs() < 1.5 && dx > 0.0 && dx < 7.0);
            if ring || hand {
                px[(y * n + x) * 4 + 3] = 255;
            }
        }
    }
    Icon::from_rgba(px, n as u32, n as u32).expect("ikon")
}

impl Tray {
    pub fn new() -> Result<(Self, UnboundedReceiver<TrayCmd>), String> {
        let toggle = MenuItem::new(crate::i18n::t("tray.menu.start"), true, None);
        let stop = MenuItem::new(crate::i18n::t("tray.menu.stop"), false, None);
        let suggestion = MenuItem::new(crate::i18n::t("tray.menu.no_suggestion"), false, None);
        let show = MenuItem::new(crate::i18n::t("tray.menu.show"), true, None);
        let timeline = MenuItem::new(crate::i18n::t("gendan.tray.timeline"), true, None);
        let close_day = MenuItem::new(crate::i18n::t("aktivitet.tray.luk_dagen"), true, None);
        let day_total = MenuItem::new("", false, None);
        let quit = MenuItem::new(crate::i18n::t("tray.menu.quit"), true, None);
        let menu = Menu::new();
        menu.append_items(&[
            &toggle,
            &stop,
            &PredefinedMenuItem::separator(),
            &suggestion,
            &PredefinedMenuItem::separator(),
            &day_total,
            &timeline,
            &close_day,
            &PredefinedMenuItem::separator(),
            &show,
            &quit,
        ])
        .map_err(|e| e.to_string())?;

        let (tx, rx) = unbounded();
        let ids = (
            toggle.id().clone(),
            stop.id().clone(),
            suggestion.id().clone(),
            show.id().clone(),
            quit.id().clone(),
            timeline.id().clone(),
            close_day.id().clone(),
        );
        MenuEvent::set_event_handler(Some(move |ev: MenuEvent| {
            let cmd = if ev.id == ids.0 {
                TrayCmd::Toggle
            } else if ev.id == ids.1 {
                TrayCmd::Stop
            } else if ev.id == ids.2 {
                TrayCmd::Suggestion
            } else if ev.id == ids.3 {
                TrayCmd::Show
            } else if ev.id == ids.4 {
                TrayCmd::Quit
            } else if ev.id == ids.5 {
                TrayCmd::Timeline
            } else if ev.id == ids.6 {
                TrayCmd::CloseDay
            } else {
                return;
            };
            let _ = tx.unbounded_send(cmd);
        }));

        let builder = TrayIconBuilder::new().with_menu(Box::new(menu));
        // Template-ikon og tekst i menulinjen findes kun på macOS; Windows viser ikon + tooltip.
        #[cfg(target_os = "macos")]
        let builder = builder.with_icon_templated(clock_icon());
        #[cfg(not(target_os = "macos"))]
        let builder = builder.with_icon(clock_icon());
        let icon = builder
            .with_tooltip(tt_core::edition::EDITION.name)
            .build()
            .map_err(|e| e.to_string())?;
        Ok((
            Tray {
                icon,
                toggle,
                stop,
                suggestion,
                day_total,
                last: None,
            },
            rx,
        ))
    }

    /// Rører kun AppKit/Win32, når noget faktisk har ændret sig.
    pub fn apply(&mut self, m: &TrayModel) {
        if std::env::var("TT_LOG_TRAY").is_ok() {
            eprintln!("TT tray {m:?}");
        }
        let last = self.last.as_ref();
        if last.map(|l| &l.title) != Some(&m.title) {
            self.icon.set_title(if m.title.is_empty() {
                None
            } else {
                Some(m.title.as_str())
            });
        }
        if last.map(|l| &l.tooltip) != Some(&m.tooltip) {
            let _ = self.icon.set_tooltip(Some(m.tooltip.as_str()));
        }
        if last.map(|l| l.toggle_label) != Some(m.toggle_label) {
            self.toggle.set_text(m.toggle_label);
        }
        if last.map(|l| l.stop_enabled) != Some(m.stop_enabled) {
            self.stop.set_enabled(m.stop_enabled);
        }
        if last.map(|l| &l.day_total) != Some(&m.day_total) {
            self.day_total.set_text(&m.day_total);
        }
        if last.map(|l| &l.suggestion) != Some(&m.suggestion) {
            match &m.suggestion {
                Some((text, _)) => {
                    self.suggestion.set_text(text);
                    self.suggestion.set_enabled(true);
                }
                None => {
                    self.suggestion
                        .set_text(crate::i18n::t("tray.menu.no_suggestion"));
                    self.suggestion.set_enabled(false);
                }
            }
        }
        self.last = Some(m.clone());
    }
}

struct TrayData {
    timer: TimerState,
    suggestions: Vec<Suggestion>,
    customers: Vec<Customer>,
    /// gendan: dagens registrerede minutter.
    today_minutes: u32,
}

fn load(b: &dyn Backend) -> crate::backend::Result<TrayData> {
    let today = b.today();
    Ok(TrayData {
        timer: b.timer()?,
        suggestions: b.suggestions(today)?,
        customers: b.customers(true)?,
        today_minutes: b
            .entries(crate::backend::DateRange::day(today))?
            .iter()
            .map(|e| e.minutes)
            .sum(),
    })
}

/// Holder trayen i live og opdaterer den.
pub struct TrayController {
    ctx: AppCtx,
    tray: Tray,
    timer: Option<TimerState>,
    /// Kun den nyeste indlæsning må opdatere trayen (de kører parallelt).
    load_seq: u64,
    _tasks: Vec<Task<()>>,
    _subs: Vec<Subscription>,
}

struct TrayGlobal(#[allow(dead_code)] Entity<TrayController>);
impl Global for TrayGlobal {}

/// Kører trayen? (Uden den skjuler X ikke vinduet på Windows, se `vindue`.)
pub fn is_installed(cx: &App) -> bool {
    cx.has_global::<TrayGlobal>()
}

/// Opretter trayen. `TT_NO_TRAY=1` slår den fra. Fejl vises som besked i appen.
pub fn install(ctx: AppCtx, cx: &mut App) {
    if std::env::var("TT_NO_TRAY").is_ok() {
        return;
    }
    let (tray, mut rx) = match Tray::new() {
        Ok(x) => x,
        Err(e) => {
            return ctx.notify_user(tf("tray.error.create", &[("error", &e.to_string())]), cx);
        }
    };
    let entity = cx.new(|cx: &mut Context<TrayController>| {
        let subs = vec![cx.observe(&ctx.hub, |this, _, cx| this.refresh(cx))];
        // Menu-klik.
        let menu = cx.spawn(async move |this, cx| {
            while let Some(cmd) = rx.next().await {
                if this.update(cx, |this, cx| this.on_cmd(cmd, cx)).is_err() {
                    break;
                }
            }
        });
        // Minut-tick, alignet til timerens hele minutter.
        let tick = cx.spawn(async move |this, cx| {
            loop {
                // Ventetiden regnes ud fra forrige indlæsning; den nye kommer asynkront.
                let secs = this.update(cx, |this, cx| {
                    this.refresh(cx);
                    this.next_wait()
                });
                let Ok(secs) = secs else { break };
                cx.background_executor()
                    .timer(Duration::from_secs(secs.max(1)))
                    .await;
            }
        });
        TrayController {
            ctx: ctx.clone(),
            tray,
            timer: None,
            load_seq: 0,
            _tasks: vec![menu, tick],
            _subs: subs,
        }
    });
    cx.set_global(TrayGlobal(entity));
}

impl TrayController {
    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.load_seq += 1;
        let seq = self.load_seq;
        self.ctx.fetch(cx, load, move |this, res, _| {
            if seq != this.load_seq {
                return;
            }
            if let Ok(d) = res {
                let now = this.ctx.backend.local_now();
                let m = TrayModel::build(&d.timer, &d.suggestions, &d.customers, now)
                    .with_day_total(d.today_minutes, &d.timer, now);
                this.tray.apply(&m);
                this.timer = Some(d.timer);
            }
        });
    }

    fn next_wait(&self) -> u64 {
        self.timer
            .as_ref()
            .map(|t| timer::secs_to_next_minute(t, self.ctx.backend.local_now()))
            .unwrap_or(60)
    }

    fn on_cmd(&mut self, cmd: TrayCmd, cx: &mut Context<Self>) {
        match cmd {
            TrayCmd::Toggle => timer::toggle(&self.ctx, cx),
            TrayCmd::Stop => timer::stop(&self.ctx, cx),
            TrayCmd::Suggestion => {
                if let Some((_, target)) =
                    self.tray.last.as_ref().and_then(|m| m.suggestion.clone())
                {
                    timer::start(&self.ctx, target, cx);
                }
            }
            TrayCmd::Show => crate::vindue::show(cx),
            TrayCmd::Timeline => {
                crate::vindue::show(cx);
                if let Some(w) = cx.windows().first().copied() {
                    let _ = w.update(cx, |_, window, cx| {
                        window.dispatch_action(Box::new(crate::app::GaTilAktivitet), cx)
                    });
                }
            }
            TrayCmd::CloseDay => {
                crate::vindue::show(cx);
                if let Some(w) = cx.windows().first().copied() {
                    let _ = w.update(cx, |_, window, cx| {
                        window.dispatch_action(Box::new(crate::app::LukDagen), cx)
                    });
                }
            }
            TrayCmd::Quit => cx.quit(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TrayModel;
    use crate::backend::{Backend, MockBackend, TimerStatus, TimerTarget};
    use chrono::{Local, NaiveDate, TimeZone};

    fn mock() -> MockBackend {
        MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap())
    }

    /// gendan: dagens total = poster + den kørende timer.
    #[test]
    fn dagens_total_med_timeren() {
        let m = mock();
        let now = Local.with_ymd_and_hms(2026, 10, 26, 10, 0, 0).unwrap();
        let idle = m.timer().unwrap();
        let model = TrayModel::build(&idle, &[], &[], now).with_day_total(150, &idle, now);
        assert_eq!(model.day_total, "Dagens total: 2,5 t");
        m.timer_start(TimerTarget::default()).unwrap();
        let mut running = m.timer().unwrap();
        running.started_at = Some(now - chrono::Duration::minutes(30));
        let model = TrayModel::build(&running, &[], &[], now).with_day_total(150, &running, now);
        assert_eq!(model.day_total, "Dagens total: 3 t");
        assert_eq!(running.status, TimerStatus::Running);
    }

    #[test]
    fn stille_timer_med_forslag() {
        let m = mock();
        let now = Local.with_ymd_and_hms(2026, 10, 26, 9, 30, 0).unwrap();
        let t = m.timer().unwrap();
        let model = TrayModel::build(
            &t,
            &m.suggestions(m.today()).unwrap(),
            &m.customers(true).unwrap(),
            now,
        );
        assert_eq!(model.title, "");
        assert_eq!(model.toggle_label, "Start timer");
        assert!(!model.stop_enabled);
        let (text, target) = model.suggestion.unwrap();
        assert_eq!(text, "Det ligner Bageriet på Hjørnet. Start timer?");
        assert_eq!(target.project_id.as_deref(), Some("proj_webshop"));
    }

    #[test]
    fn koerende_timer_viser_t_mm_og_intet_forslag() {
        let m = mock();
        m.demo_timer(
            TimerTarget {
                customer_id: Some("kunde_cafe".into()),
                ..Default::default()
            },
            2 * 3600 + 5 * 60 + 30,
        );
        let t = m.timer().unwrap();
        assert_eq!(t.status, TimerStatus::Running);
        let model = TrayModel::build(
            &t,
            &m.suggestions(m.today()).unwrap(),
            &m.customers(true).unwrap(),
            Local::now(),
        );
        assert_eq!(model.title, "2:05");
        assert_eq!(model.toggle_label, "Pause");
        assert!(model.stop_enabled);
        assert_eq!(model.tooltip, "TimeTrack: 2:05 på Café Åbrinken");
        assert!(model.suggestion.is_none());
        // Også midt i en forslagsblok (09:00-11:00): intet forslag, mens timeren kører
        let i_blokken = Local.with_ymd_and_hms(2026, 10, 26, 9, 30, 0).unwrap();
        let model = TrayModel::build(
            &t,
            &m.suggestions(m.today()).unwrap(),
            &m.customers(true).unwrap(),
            i_blokken,
        );
        assert!(model.suggestion.is_none());
    }
}
