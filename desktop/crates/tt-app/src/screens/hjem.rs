//! I dag: timer-kort, kunde/projekt-vælger, forslagstidslinje, dagens poster,
//! hurtig registrering og klippekort for den valgte kunde.

use std::time::Duration;

use chrono::{Local, NaiveDate, NaiveTime, Timelike};
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Disableable, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

// gendan: ugens total og over budget.
mod uge;
// observer: "Lær TimeTrack at kende".
pub mod laer;

use crate::app::AppCtx;
use crate::backend::{
    Backend, Customer, Entry, EntryInput, Id, Project, PunchCard, Suggestion,
    SuggestionCorrection, TimerState, TimerStatus, TimerTarget,
};
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf, tf_n};
use crate::ui::maal::{Hint, PickTarget};
use crate::ui::maalvaelger::{TargetPicker, TargetPickerEvent};
use crate::ui::tokens as tk;
use crate::ui::{self, Icon, Loadable, Tone, farver, format};

/// Hvad brugeren har valgt i den fælles mål-vælger. Uden kunde = intern tid.
pub type Target = PickTarget;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PickFor {
    Timer,
    Quick,
    Correct(Id),
    /// Svar på observatørens spørgsmål (gruppens id).
    Observer(Id),
}

/// Alt, skærmen viser, hentet i ét kald.
#[derive(Clone, Debug)]
pub struct Snapshot {
    pub today: NaiveDate,
    pub timer: TimerState,
    pub customers: Vec<Customer>,
    pub projects: Vec<Project>,
    pub entries: Vec<Entry>,
    pub suggestions: Vec<Suggestion>,
    pub cards: Vec<PunchCard>,
    /// gendan: ugens total og projekter over budget.
    pub week: uge::WeekStats,
    /// aktivitet: dagens blokke uden kunde (antal, sekunder).
    pub unclear: (usize, u32),
}

impl Snapshot {
    fn load(b: &dyn Backend) -> crate::backend::Result<Snapshot> {
        let today = b.today();
        let projects = b.projects(None, true)?;
        Ok(Snapshot {
            today,
            timer: b.timer()?,
            customers: b.customers(true)?,
            week: uge::load(b, today, &projects)?,
            projects,
            entries: b.entries(crate::backend::DateRange::day(today))?,
            suggestions: b.suggestions(today)?,
            cards: b.punch_cards(None)?,
            // Aktiviteten er en ekstra; fejler den, vises kortet uden.
            unclear: b
                .activity_day(today)
                .map(|d| d.total(crate::backend::ActivityStatus::Unclear))
                .unwrap_or_default(),
        })
    }

    pub fn customer_name(&self, id: &str) -> String {
        self.customers
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| t("hjem.ukendt_kunde").into())
    }

    pub fn project_name(&self, id: Option<&str>) -> Option<String> {
        id.and_then(|id| self.projects.iter().find(|p| p.id == id))
            .map(|p| p.name.clone())
    }

    /// "Bageriet på Hjørnet · Ny webshop".
    /// Forslagets mål: uden kunde er det intern tid.
    pub fn suggestion_label(&self, customer: Option<&str>, project: Option<&str>) -> String {
        match customer {
            Some(_) => self.target_label(customer, project).unwrap_or_default(),
            None => match self.project_name(project) {
                Some(p) => tf("hjem.intern_tid_projekt", &[("projekt", &p)]),
                None => t("hjem.intern_tid").into(),
            },
        }
    }

    pub fn target_label(&self, customer: Option<&str>, project: Option<&str>) -> Option<String> {
        let c = self.customer_name(customer?);
        Some(match self.project_name(project) {
            Some(p) => format!("{c} · {p}"),
            None => c,
        })
    }

    /// Det valgte mål som tekst: "Kunde · Projekt" eller "Intern tid · Projekt".
    pub fn pick_label(&self, t: &Target) -> String {
        match t.customer_id.as_deref() {
            Some(c) => self.target_label(Some(c), t.project_id.as_deref()).unwrap_or_default(),
            None => self.suggestion_label(None, t.project_id.as_deref()),
        }
    }

    /// Kundens farve (grå for intern tid).
    pub fn color_of(&self, customer: Option<&str>) -> Hsla {
        farver::color_in(&self.customers, customer)
    }

    /// Forslag til vælgeren: dagens forslag, der dækker nu eller sluttede for
    /// nylig, nyeste først.
    pub fn hints_now(&self, now: NaiveTime) -> Vec<Hint> {
        let mut recent: Vec<&Suggestion> = self
            .suggestions
            .iter()
            .filter(|s| s.start <= now && (now - s.end).num_minutes() <= 30)
            .collect();
        recent.sort_by_key(|s| std::cmp::Reverse(s.end));
        recent.into_iter().take(3).map(suggestion_hint).collect()
    }
}

/// Forslaget som hint i vælgeren med detektionens begrundelse.
pub fn suggestion_hint(s: &Suggestion) -> Hint {
    Hint {
        target: PickTarget::from_parts(s.customer_id.as_deref(), s.project_id.as_deref(), s.task_id.as_deref()),
        reason: s.reason.clone(),
    }
}

impl Snapshot {

    /// Kundens aktive klippekort (det ældste først), ellers det senest købte.
    pub fn card_for(&self, customer: &str) -> Option<&PunchCard> {
        let mut cards: Vec<&PunchCard> = self
            .cards
            .iter()
            .filter(|c| c.customer_id == customer)
            .collect();
        cards.sort_by_key(|c| (!c.is_active(self.today), c.purchased));
        cards.first().copied()
    }

    pub fn total_minutes(&self) -> u32 {
        self.entries.iter().map(|e| e.minutes).sum()
    }
}

pub struct Quick {
    pub hours: Entity<InputState>,
    pub description: Entity<InputState>,
    pub target: Option<Target>,
    pub errors: Vec<(&'static str, SharedString)>,
    pub saved: Option<SharedString>,
}

pub struct HjemScreen {
    ctx: AppCtx,
    pub data: Loadable<Snapshot>,
    pub picker: Entity<TargetPicker>,
    pub pick_for: Option<PickFor>,
    pub description: Entity<InputState>,
    /// Kunde/projekt til næste start, når timeren står stille.
    pub next_target: Option<Target>,
    /// Start timeren, så snart der er valgt et mål.
    start_after_pick: bool,
    pub quick: Quick,
    pub confirm_discard: bool,
    pub error: Option<SharedString>,
    /// Timerens version ved sidste indlæsning; ændres den (fx fra web), hentes beskrivelsen ind i feltet.
    timer_version: Option<u64>,
    pending_description: Option<String>,
    clear_quick: bool,
    /// TT_DEMO=vaelger eller nykunde: skærmbilleder (ret-win).
    demo: Option<String>,
    load_seq: u64,
    /// Kortet "Lær TimeTrack at kende".
    pub laer: laer::Laer,
    focus: FocusHandle,
    _tasks: Vec<Task<()>>,
    _subs: Vec<Subscription>,
}

impl HjemScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        // Ingen kunder eller ingen træffere: "Opret kunde 'X'" i vælgeren.
        let picker = cx.new(|cx| TargetPicker::new(ctx.clone(), "vaelger", window, cx));
        let description = cx.new(|cx| {
            InputState::new(window, cx).placeholder(t("hjem.timer.beskrivelse_placeholder"))
        });
        let hours = cx
            .new(|cx| InputState::new(window, cx).placeholder(t("hjem.hurtig.timer_placeholder")));
        let quick_desc = cx.new(|cx| {
            InputState::new(window, cx).placeholder(t("hjem.hurtig.beskrivelse_placeholder"))
        });
        let subs = vec![
            cx.observe(&ctx.hub, |this, _, cx| this.reload(cx)),
            cx.subscribe_in(&picker, window, Self::on_picker),
            cx.subscribe_in(&hours, window, |this, _, ev: &InputEvent, window, cx| {
                if matches!(ev, InputEvent::PressEnter { .. }) {
                    this.submit_quick(window, cx);
                }
            }),
            cx.subscribe_in(
                &quick_desc,
                window,
                |this, _, ev: &InputEvent, window, cx| {
                    if matches!(ev, InputEvent::PressEnter { .. }) {
                        this.submit_quick(window, cx);
                    }
                },
            ),
            cx.subscribe_in(&description, window, |this, _, ev: &InputEvent, _, cx| {
                if matches!(ev, InputEvent::PressEnter { .. }) {
                    this.save_description(cx);
                }
            }),
        ];
        // Sekund-tick: tegn kun igen, når timeren kører.
        let tick = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                let running = this.update(cx, |this, cx| {
                    if this
                        .data
                        .ready()
                        .is_some_and(|d| d.timer.status == TimerStatus::Running)
                    {
                        cx.notify();
                    }
                });
                if running.is_err() {
                    break;
                }
            }
        });
        let mut this = HjemScreen {
            ctx,
            data: Loadable::Loading,
            picker,
            pick_for: None,
            description,
            next_target: None,
            start_after_pick: false,
            quick: Quick {
                hours,
                description: quick_desc,
                target: None,
                errors: vec![],
                saved: None,
            },
            confirm_discard: false,
            error: None,
            timer_version: None,
            pending_description: None,
            clear_quick: false,
            demo: std::env::var("TT_DEMO")
                .ok()
                .filter(|d| ["vaelger", "nykunde"].iter().any(|k| d.contains(k))),
            load_seq: 0,
            laer: laer::Laer::default(),
            focus: cx.focus_handle(),
            _tasks: vec![tick],
            _subs: subs,
        };
        this.reload(cx);
        // TT_DEMO=kortstop: beskeden efter et stop under ét minut (skærmbillede).
        if std::env::var("TT_DEMO").is_ok_and(|d| d.contains("kortstop")) {
            let ctx = this.ctx.clone();
            cx.defer(move |cx| ctx.notify_user(t("hjem.timer.under_minut"), cx));
        }
        // TT_DEMO=genvejsbesked: en lang besked (genveje optaget), der skal ombrydes.
        if std::env::var("TT_DEMO").is_ok_and(|d| d.contains("genvejsbesked")) {
            let ctx = this.ctx.clone();
            cx.defer(move |cx| {
                ctx.notify_user(
                    crate::i18n::tf(
                        "d21.keys.failed_many",
                        &[("keys", "Ctrl+Shift+T, Ctrl+Shift+Space, Ctrl+Shift+P, Ctrl+Alt+Shift+N")],
                    ),
                    cx,
                )
            });
        }
        this
    }

    pub fn reload(&mut self, cx: &mut Context<Self>) {
        // Indlæsninger kører parallelt på background executor; kun den nyeste tæller.
        self.load_seq += 1;
        let seq = self.load_seq;
        self.load_laer(cx);
        self.ctx.fetch(cx, Snapshot::load, move |this, res, _| {
            if seq != this.load_seq {
                return;
            }
            if let Ok(s) = &res {
                this.error = None;
                if this.timer_version.is_none_or(|v| s.timer.version > v) {
                    this.timer_version = Some(s.timer.version);
                    this.pending_description = Some(s.timer.description.clone());
                }
                if s.timer.status == TimerStatus::Idle {
                    this.confirm_discard = false;
                }
            }
            this.data = match (res, std::mem::take(&mut this.data)) {
                (Ok(s), _) => Loadable::Ready(s),
                // Behold det, vi viser, hvis en genindlæsning fejler.
                (Err(e), Loadable::Ready(old)) => {
                    this.error = Some(e.to_string().into());
                    Loadable::Ready(old)
                }
                (Err(e), _) => Loadable::Failed(e.to_string().into()),
            };
        });
    }

    fn mutate<T: Send + 'static>(
        &mut self,
        cx: &mut Context<Self>,
        op: impl FnOnce(&dyn Backend) -> crate::backend::Result<T> + Send + 'static,
    ) {
        self.error = None;
        self.ctx.mutate(cx, op, |this, res, _| {
            if let Err(e) = res {
                this.error = Some(e.to_string().into());
            }
        });
    }

    // ---------- Vælger ----------

    pub fn open_picker(&mut self, for_: PickFor, window: &mut Window, cx: &mut Context<Self>) {
        let title = match &for_ {
            PickFor::Timer => t("hjem.vaelger.titel_timer"),
            PickFor::Quick => t("hjem.vaelger.titel"),
            PickFor::Correct(_) => t("hjem.vaelger.titel_ret"),
            PickFor::Observer(_) => t("observer.vaelg"),
        };
        // Foreslåede øverst: forslaget, der rettes, eller det, detektionen ser nu.
        let hints = match (&for_, self.data.ready()) {
            (PickFor::Correct(id), Some(d)) => {
                d.suggestions.iter().filter(|s| &s.id == id).map(suggestion_hint).collect()
            }
            (PickFor::Timer | PickFor::Quick, Some(d)) => d.hints_now(Local::now().time()),
            _ => vec![],
        };
        self.pick_for = Some(for_);
        self.picker.update(cx, |p, cx| p.open(title, hints, window, cx));
        cx.notify();
    }

    fn close_picker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.pick_for = None;
        self.start_after_pick = false;
        self.focus.focus(window, cx);
        cx.notify();
    }

    fn on_picker(
        &mut self,
        _: &Entity<TargetPicker>,
        ev: &TargetPickerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match ev {
            TargetPickerEvent::Dismissed => self.close_picker(window, cx),
            TargetPickerEvent::Picked(t) => self.apply_pick(t.clone(), window, cx),
        }
    }

    /// Brug det valgte mål til det, vælgeren blev åbnet for, og luk den.
    fn apply_pick(&mut self, t: Target, window: &mut Window, cx: &mut Context<Self>) {
        let for_ = self.pick_for.take();
        let start = std::mem::take(&mut self.start_after_pick);
        match for_ {
            Some(PickFor::Timer) => self.set_timer_target(t, start, cx),
            Some(PickFor::Quick) => {
                self.quick.target = Some(t);
                self.quick.errors.retain(|e| e.0 != "kunde");
            }
            Some(PickFor::Correct(id)) => {
                // "" = intern tid: en tom kunde skal vinde over forslagets kunde.
                let correction = SuggestionCorrection {
                    customer_id: Some(t.customer_or_empty()),
                    project_id: t.project_id,
                    target_explicit: true,
                    ..Default::default()
                };
                self.mutate(cx, move |b| b.confirm_suggestion(&id, Some(correction)));
            }
            Some(PickFor::Observer(id)) => self.answer_laer(
                id,
                crate::backend::ObserverReply::Target {
                    customer_id: t.customer_or_empty(),
                    project_id: t.project_id,
                },
                cx,
            ),
            None => {}
        }
        self.close_picker(window, cx);
    }

    /// Skærmbilleder: `TT_DEMO=…,vaelger` (vælgeren åben), `vaelger-soeg`
    /// (søgning på tværs) og `vaelger-kunde` (kundens projekter).
    fn run_demo(&mut self, demo: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.open_picker(PickFor::Timer, window, cx);
        if demo.contains("vaelger-soeg") {
            self.picker.update(cx, |p, cx| p.set_query("bageri", window, cx));
        } else if demo.contains("vaelger-kunde") {
            self.picker.update(cx, |p, cx| {
                p.view = crate::ui::maal::View::Customer("kunde_bageriet".into());
                p.set_query("", window, cx);
            });
        } else if demo.contains("nykunde") {
            self.picker.update(cx, |p, cx| p.set_query("Tømrer Hansen", window, cx));
        }
    }

    // ---------- Timer ----------

    fn timer_state(&self) -> Option<&TimerState> {
        self.data.ready().map(|d| &d.timer)
    }

    fn set_timer_target(&mut self, t: Target, start: bool, cx: &mut Context<Self>) {
        let running = self
            .timer_state()
            .is_some_and(|s| s.status != TimerStatus::Idle);
        let description = self.description.read(cx).value().to_string();
        let target = TimerTarget {
            customer_id: t.customer_id.clone(),
            project_id: t.project_id.clone(),
            task_id: t.task_id.clone(),
            description,
        };
        if running {
            self.mutate(cx, move |b| b.timer_set_target(target));
        } else if start {
            self.next_target = Some(t);
            self.mutate(cx, move |b| b.timer_start(target));
        } else {
            self.next_target = Some(t);
        }
    }

    /// Start (åbner vælgeren først, hvis der ikke er valgt kunde), pause eller fortsæt.
    pub fn toggle_timer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(state) = self.timer_state().cloned() else {
            return;
        };
        match state.status {
            TimerStatus::Idle => match self.next_target.clone() {
                Some(t) => self.set_timer_target(t, true, cx),
                None => {
                    self.start_after_pick = true;
                    self.open_picker(PickFor::Timer, window, cx);
                }
            },
            TimerStatus::Running => {
                let update = self.unsaved_description(cx);
                self.mutate(cx, move |b| {
                    if let Some(t) = update {
                        b.timer_set_target(t)?;
                    }
                    b.timer_pause()
                })
            }
            TimerStatus::Paused => {
                let update = self.unsaved_description(cx);
                self.mutate(cx, move |b| {
                    if let Some(t) = update {
                        b.timer_set_target(t)?;
                    }
                    b.timer_resume()
                })
            }
        }
    }

    pub fn stop_timer(&mut self, cx: &mut Context<Self>) {
        let update = self.unsaved_description(cx);
        self.error = None;
        self.ctx.mutate(
            cx,
            move |b| {
                if let Some(t) = update {
                    b.timer_set_target(t)?;
                }
                b.timer_stop()
            },
            |this, res, cx| match res {
                Ok(saved) => {
                    if let Some(msg) = crate::timer::stop_notice(saved.as_ref()) {
                        this.ctx.notify_user(msg, cx);
                    }
                }
                Err(e) => this.error = Some(e.to_string().into()),
            },
        );
    }

    /// Beskrivelsen i feltet, hvis brugeren har skrevet uden at trykke Enter.
    /// Gemmes før pause, fortsæt og stop, så teksten ikke går tabt.
    fn unsaved_description(&self, cx: &App) -> Option<TimerTarget> {
        let s = self.timer_state()?;
        let text = self.description.read(cx).value().to_string();
        (s.status != TimerStatus::Idle && text != s.description).then(|| TimerTarget {
            customer_id: s.customer_id.clone(),
            project_id: s.project_id.clone(),
            task_id: s.task_id.clone(),
            description: text,
        })
    }

    pub fn discard_timer(&mut self, cx: &mut Context<Self>) {
        self.confirm_discard = false;
        self.mutate(cx, |b| b.timer_discard());
    }

    fn save_description(&mut self, cx: &mut Context<Self>) {
        let Some(s) = self.timer_state().cloned() else {
            return;
        };
        if s.status == TimerStatus::Idle {
            return;
        }
        let description = self.description.read(cx).value().to_string();
        let target = TimerTarget {
            customer_id: s.customer_id,
            project_id: s.project_id,
            task_id: s.task_id,
            description,
        };
        self.mutate(cx, move |b| b.timer_set_target(target));
    }

    // ---------- Forslag ----------

    pub fn confirm_suggestion(&mut self, id: Id, cx: &mut Context<Self>) {
        self.mutate(cx, move |b| b.confirm_suggestion(&id, None));
    }

    pub fn reject_suggestion(&mut self, id: Id, cx: &mut Context<Self>) {
        self.mutate(cx, move |b| b.reject_suggestion(&id));
    }

    pub fn confirm_day(&mut self, cx: &mut Context<Self>) {
        let Some(day) = self.data.ready().map(|d| d.today) else {
            return;
        };
        self.mutate(cx, move |b| b.confirm_day(day));
    }

    // ---------- Hurtig registrering ----------

    pub fn submit_quick(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let hours = self.quick.hours.read(cx).value();
        let description = self.quick.description.read(cx).value().trim().to_string();
        let mut errors: Vec<(&'static str, SharedString)> = vec![];
        let minutes = format::parse_hours(&hours);
        if let Err(e) = minutes {
            errors.push(("timer", e.into()));
        }
        if self.quick.target.is_none() {
            errors.push(("kunde", t("hjem.hurtig.fejl_kunde").into()));
        }
        self.quick.saved = None;
        self.quick.errors = errors;
        let (Ok(minutes), Some(t), Some(today)) = (
            minutes,
            self.quick.target.clone(),
            self.data.ready().map(|d| d.today),
        ) else {
            cx.notify();
            return;
        };
        // Som web: tid på en intern kunde er ikke fakturerbar som standard.
        let billable = self
            .data
            .ready()
            .is_none_or(|d| crate::backend::default_billable(&d.customers, t.customer_id.as_deref()));
        let input = EntryInput {
            customer_id: t.customer_or_empty(),
            project_id: t.project_id,
            task_id: t.task_id,
            description,
            date: today,
            start: None,
            end: None,
            minutes,
            billable,
        };
        self.error = None;
        self.ctx.mutate(
            cx,
            move |b| b.create_entry(input),
            |this, res, _| match res {
                Ok(e) => {
                    this.quick.saved = Some(
                        tf(
                            "hjem.hurtig.registreret",
                            &[("timer", &format::hours(e.minutes))],
                        )
                        .into(),
                    );
                    // Felterne tømmes først, når posten er gemt (i render, der har vinduet).
                    this.clear_quick = true;
                }
                Err(e) => this.error = Some(e.to_string().into()),
            },
        );
    }

    /// Kunden, klippekortet skal vise: timerens, ellers den valgte til næste start, ellers hurtig registrering.
    fn focus_customer(&self) -> Option<Id> {
        let d = self.data.ready()?;
        d.timer
            .customer_id
            .clone()
            .filter(|_| d.timer.status != TimerStatus::Idle)
            .or_else(|| self.next_target.as_ref().and_then(|t| t.customer_id.clone()))
            .or_else(|| self.quick.target.as_ref().and_then(|t| t.customer_id.clone()))
    }
}

// ---------- Visning ----------

const DAY_START: f32 = 7.0;
const DAY_END: f32 = 19.0;

fn hour_f(t: NaiveTime) -> f32 {
    t.hour() as f32 + t.minute() as f32 / 60.0
}

fn pos(h: f32) -> f32 {
    ((h - DAY_START) / (DAY_END - DAY_START)).clamp(0.0, 1.0)
}

impl HjemScreen {
    fn render_timer(&self, d: &Snapshot, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement {
        let tm = &d.timer;
        let secs = tm.elapsed_secs(self.ctx.backend.local_now());
        let (status, tone, status_icon) = match tm.status {
            TimerStatus::Running => (t("hjem.timer.status_kaerer"), Tone::Primary, Icon::PlayCircle),
            TimerStatus::Paused => (t("hjem.timer.status_pause"), Tone::Warning, Icon::Pause),
            TimerStatus::Idle => (t("hjem.timer.status_klar"), Tone::Neutral, Icon::Circle),
        };
        let chosen = if tm.status == TimerStatus::Idle {
            self.next_target.clone()
        } else {
            (tm.customer_id.is_some() || tm.project_id.is_some())
                .then(|| PickTarget::from_parts(tm.customer_id.as_deref(), tm.project_id.as_deref(), None))
        };
        let target = chosen.as_ref().map(|x| d.pick_label(x));
        let color = chosen.as_ref().map(|x| d.color_of(x.customer_id.as_deref()));
        let (toggle_label, toggle_icon) = match tm.status {
            TimerStatus::Idle => (t("hjem.timer.start"), Icon::Play),
            TimerStatus::Running => (t("hjem.timer.pause"), Icon::Pause),
            TimerStatus::Paused => (t("hjem.timer.fortsaet"), Icon::Play),
        };
        let idle = tm.status == TimerStatus::Idle;
        let running = tm.status == TimerStatus::Running;
        // Timeren er skærmens primære handling: et bredt kort øverst med uret
        // til venstre og mål, beskrivelse og knapper til højre.
        let clock = ui::el(
                "timer-tid",
                Role::Timer,
                tf("hjem.timer.tid_label", &[("tid", &format::clock_hms(secs))]),
            )
            .text_size(px(tk::TEXT_DISPLAY))
            .line_height(px(tk::TEXT_DISPLAY + 4.))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(if idle { b.grey } else { b.ink })
            .child(format::clock_hms(secs));
        // ux-vaelger: den fælles mål-knap med kundens farve.
        let target_el = crate::ui::maalvaelger::target_button(
            b,
            "timer-maal",
            target,
            color,
            cx.listener(|this, _, window, cx| this.open_picker(PickFor::Timer, window, cx)),
        );
        let buttons = h_flex()
            .gap_2()
            .child(
                Button::new("timer-start")
                    .primary()
                    .icon(toggle_icon)
                    .label(toggle_label)
                    .on_click(cx.listener(|this, _, window, cx| this.toggle_timer(window, cx))),
            )
            .child(
                Button::new("timer-stop")
                    .outline()
                    .icon(Icon::Square)
                    .label(t("hjem.timer.stop_gem"))
                    .disabled(idle)
                    .on_click(cx.listener(|this, _, _, cx| this.stop_timer(cx))),
            )
            .child(
                Button::new("timer-kasser")
                    .ghost()
                    .icon(Icon::Trash2)
                    .label(t("hjem.timer.kasser"))
                    .disabled(idle)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.confirm_discard = true;
                        cx.notify();
                    })),
            );
        ui::titled_card(
            b,
            "timer",
            t("hjem.timer.titel"),
            ui::badge_icon(b, "timer-status", status, tone, status_icon),
        )
        // Kører timeren, står kortet i granskov (sammen med mærket, ikke alene).
        .when(running, |c| c.border_color(b.primary))
        .child(
            h_flex()
                .flex_wrap()
                .items_center()
                .gap(px(tk::SPACE_6))
                .child(div().flex_none().min_w(px(250.)).child(clock))
                .child(
                    v_flex()
                        .flex_1()
                        .min_w(px(300.))
                        .gap_2()
                        .child(target_el)
                        .child(
                            Input::new(&self.description)
                                .id("timer-beskrivelse")
                                .aria_label(t("hjem.timer.beskrivelse_label")),
                        )
                        .child(buttons),
                ),
        )
        .when(self.confirm_discard && !idle, |c| {
            c.child(
                ui::el(
                    "kasser-bekraeft",
                    Role::AlertDialog,
                    tf(
                        "hjem.timer.kasser_bekraeft",
                        &[("tid", &format::clock_hm(secs))],
                    ),
                )
                .flex()
                .flex_col()
                .gap_2()
                .p_3()
                .rounded(px(8.))
                .border_1()
                .border_color(b.danger)
                .child(div().text_sm().text_color(b.ink).child(tf(
                    "hjem.timer.kasser_bekraeft",
                    &[("tid", &format::clock_hm(secs))],
                )))
                .child(
                    h_flex()
                        .gap_2()
                        .child(
                            Button::new("kasser-ja")
                                .danger()
                                .small()
                                .icon(Icon::Trash2)
                                .label(t("hjem.timer.kasser_ja"))
                                .on_click(cx.listener(|this, _, _, cx| this.discard_timer(cx))),
                        )
                        .child(
                            Button::new("kasser-nej")
                                .outline()
                                .small()
                                .label(t("hjem.timer.fortryd"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.confirm_discard = false;
                                    cx.notify();
                                })),
                        ),
                ),
            )
        })
    }

    fn render_punch(&self, d: &Snapshot, b: &Brand) -> impl IntoElement {
        let customer = self.focus_customer();
        let card = customer.as_deref().and_then(|c| d.card_for(c));
        let title = match &customer {
            Some(c) => tf(
                "hjem.klippekort.titel_kunde",
                &[("kunde", &d.customer_name(c))],
            ),
            None => t("hjem.klippekort.titel").into(),
        };
        let body: AnyElement = match (customer, card) {
            (None, _) => ui::muted(b, "klip-ingen-kunde", t("hjem.klippekort.ingen_kunde"))
                .into_any_element(),
            (Some(_), None) => {
                ui::muted(b, "klip-intet", t("hjem.klippekort.intet")).into_any_element()
            }
            (Some(_), Some(c)) => v_flex()
                .gap_2()
                .child(
                    h_flex()
                        .justify_between()
                        .child(ui::muted(b, "klip-navn", c.name.clone()))
                        .child(if c.overflow_minutes() > 0 {
                            ui::text(
                                "klip-rest",
                                tf(
                                    "hjem.klippekort.over",
                                    &[("timer", &format::hours(c.overflow_minutes()))],
                                ),
                            )
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(b.danger)
                        } else {
                            ui::text(
                                "klip-rest",
                                tf(
                                    "hjem.klippekort.tilbage",
                                    &[
                                        ("timer", &format::hours(c.remaining_minutes() as u32)),
                                        ("total", &format::hours(c.total_minutes)),
                                    ],
                                ),
                            )
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(b.primary)
                        }),
                )
                .child(ui::punch_card_holes(
                    b,
                    "klip-huller",
                    c.total_minutes,
                    c.used_minutes,
                ))
                // gendan: advarsel om lav saldo (som web: højst 1 t eller 20 % af kortet).
                .children(crate::screens::klippekort::is_low(c.remaining_minutes(), c.total_minutes).then(|| {
                    let text = tf(
                        "gendan.klippekort.low_warning",
                        &[("timer", &format::hours(c.remaining_minutes() as u32))],
                    );
                    ui::el("klip-lav", Role::Status, text.clone())
                        .text_sm()
                        .text_color(b.warning)
                        .child(text)
                }))
                .into_any_element(),
        };
        ui::card(b, "klippekort", title.clone())
            .child(ui::heading(b, "klippekort-titel", title, 2))
            .child(body)
    }

    fn render_quick(&self, d: &Snapshot, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement {
        let q = &self.quick;
        let err = |k: &str| q.errors.iter().find(|e| e.0 == k).map(|e| e.1.clone());
        let target = q.target.as_ref().map(|x| d.pick_label(x));
        let color = q.target.as_ref().map(|x| d.color_of(x.customer_id.as_deref()));
        ui::titled_card(b, "hurtig", t("hjem.hurtig.titel"), div())
            .child(
                h_flex()
                    .gap_2()
                    .items_start()
                    .child(div().w(px(96.)).child(ui::field(
                        b,
                        "hurtig-timer",
                        t("hjem.hurtig.timer"),
                        &q.hours,
                        err("timer"),
                    )))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .gap_1()
                            .child(
                                ui::text("hurtig-kunde-etiket", t("hjem.hurtig.kunde_etiket"))
                                    .text_xs()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(b.grey),
                            )
                            .child(crate::ui::maalvaelger::target_button(
                                b,
                                "hurtig-kunde",
                                target,
                                color,
                                cx.listener(|this, _, window, cx| {
                                    this.open_picker(PickFor::Quick, window, cx)
                                }),
                            ))
                            .children(err("kunde").map(|e| {
                                ui::el("hurtig-kunde-fejl", Role::Alert, e.clone())
                                    .text_xs()
                                    .text_color(b.danger)
                                    .child(e)
                            })),
                    ),
            )
            .child(ui::field(
                b,
                "hurtig-beskrivelse",
                t("hjem.hurtig.beskrivelse"),
                &q.description,
                None,
            ))
            .child(
                h_flex()
                    .gap_3()
                    .child(
                        Button::new("hurtig-gem")
                            .primary()
                            .icon(Icon::Plus)
                            .label(t("hjem.hurtig.registrer"))
                            .on_click(
                                cx.listener(|this, _, window, cx| this.submit_quick(window, cx)),
                            ),
                    )
                    .children(q.saved.clone().map(|s| {
                        ui::el("hurtig-gemt", Role::Status, s.clone())
                            .text_sm()
                            .text_color(b.primary)
                            .child(s)
                    })),
            )
    }

    fn render_suggestions(
        &self,
        d: &Snapshot,
        b: &Brand,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        // Med kundens farve fra web (ux-vaelger).
        let timed: Vec<(f32, f32, Hsla)> = d
            .entries
            .iter()
            .filter_map(|e| Some((hour_f(e.start?), hour_f(e.end?), d.color_of(Some(&e.customer_id)))))
            .collect();
        let timeline_label = tf(
            "hjem.forslag.tidslinje_label",
            &[
                ("poster", &timed.len().to_string()),
                ("forslag", &d.suggestions.len().to_string()),
            ],
        );
        let timeline = ui::el("tidslinje", Role::Image, timeline_label)
            .relative()
            .h(px(36.))
            .rounded(px(6.))
            .bg(b.surface)
            .border_1()
            .border_color(b.border)
            .children(timed.iter().map(|&(s, e, color)| {
                div()
                    .absolute()
                    .top(px(5.))
                    .bottom(px(5.))
                    .left(relative(pos(s)))
                    .w(relative(pos(e) - pos(s)))
                    .rounded(px(4.))
                    .bg(color)
            }))
            .children(d.suggestions.iter().map(|s| {
                let color = d.color_of(s.customer_id.as_deref());
                div()
                    .absolute()
                    .top(px(5.))
                    .bottom(px(5.))
                    .left(relative(pos(hour_f(s.start))))
                    .w(relative(pos(hour_f(s.end)) - pos(hour_f(s.start))))
                    .rounded(px(4.))
                    .bg(color.opacity(0.3))
                    .border_1()
                    .border_dashed()
                    .border_color(color)
            }));
        let hours = h_flex()
            .justify_between()
            .text_xs()
            .text_color(b.grey)
            .children((7..=19).step_by(2).map(|h| div().child(format!("{h:02}"))));

        let rows =
            d.suggestions.iter().enumerate().map(|(i, s)| {
                let target = d.suggestion_label(s.customer_id.as_deref(), s.project_id.as_deref());
                let headline = format!("{} {}?", format::span(Some(s.start), Some(s.end)), target);
                let id_ok = s.id.clone();
                let id_edit = s.id.clone();
                let id_no = s.id.clone();
                ui::el(
                    ("forslag", i),
                    Role::Group,
                    tf(
                        "hjem.forslag.gruppe_label",
                        &[("overskrift", &headline), ("begrundelse", &s.reason)],
                    ),
                )
                .flex()
                .items_center()
                .gap_3()
                .p_2()
                .rounded(px(8.))
                .bg(b.suggestion)
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .text_sm()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(b.ink)
                                .child(headline),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(b.grey)
                                .truncate()
                                .child(confidence_line(&s.reason, s.confidence)),
                        )
                        // observer: opgaven fra git-grenen eller et commit.
                        .children(s.task_title.as_ref().map(|title| {
                            ui::text(
                                ("forslag-opgave", i),
                                tf("observer.opgave", &[("titel", title)]),
                            )
                            .text_xs()
                            .text_color(b.grey)
                            .truncate()
                        }))
                        // gendan: hvad bekræftelsen trækker fra kundens klippekort.
                        .children(
                            s.customer_id
                                .as_deref()
                                .and_then(|c| d.card_for(c))
                                .filter(|k| k.is_active(d.today))
                                .map(|k| {
                                    let (text, low) =
                                        crate::screens::klippekort::deduction_text(k, s.minutes());
                                    ui::text(("forslag-klip", i), text)
                                        .text_xs()
                                        .text_color(if low { b.warning } else { b.grey })
                                }),
                        ),
                )
                .child(
                    Button::new("bekraeft")
                        .primary()
                        .small()
                        .icon(Icon::Check)
                        .label(t("hjem.forslag.bekraeft"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.confirm_suggestion(id_ok.clone(), cx)
                        })),
                )
                .child(
                    Button::new("ret")
                        .outline()
                        .small()
                        .icon(Icon::Pencil)
                        .label(t("hjem.forslag.ret"))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.open_picker(PickFor::Correct(id_edit.clone()), window, cx)
                        })),
                )
                .child(
                    Button::new("afvis")
                        .ghost()
                        .small()
                        .icon(Icon::X)
                        .label(t("hjem.forslag.afvis"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.reject_suggestion(id_no.clone(), cx)
                        })),
                )
            });

        let n = d.suggestions.len();
        let actions = h_flex().when(n > 1, |h| {
            h.child(
                Button::new("bekraeft-dagen")
                    .outline()
                    .small()
                    .icon(Icon::CheckCircle2)
                    .label(tf("hjem.forslag.bekraeft_dagen", &[("n", &n.to_string())]))
                    .on_click(cx.listener(|this, _, _, cx| this.confirm_day(cx))),
            )
        });
        // aktivitet: uklare blokke vises ikke som forslag; sig, at de findes.
        let unclear = (d.unclear.0 > 0).then(|| {
            let msg = tf_n(
                "aktivitet.hjem.uklare",
                d.unclear.0,
                &[("tid", &crate::screens::aktivitet::duration(d.unclear.1))],
            );
            ui::el("forslag-uklare", Role::Group, msg.clone())
                .flex()
                .items_center()
                .gap_3()
                .p_2()
                .rounded(px(8.))
                .border_1()
                .border_color(b.warning)
                .child(div().flex_1().text_sm().text_color(b.ink).child(msg))
                .child(
                    ui::a11y_button(
                        "forslag-vis-aktivitet",
                        t("aktivitet.hjem.vis"),
                        false,
                        |b| b.outline().small(),
                        |_, window, cx| {
                            window.dispatch_action(Box::new(crate::app::GaTilAktivitet), cx)
                        },
                    ),
                )
        });
        ui::titled_card(b, "forslag", t("hjem.forslag.titel"), actions)
            .child(v_flex().gap_1().child(timeline).child(hours))
            .children(unclear)
            .child(if n == 0 {
                ui::muted(b, "forslag-ingen", suggestions_empty_text()).into_any_element()
            } else {
                ui::list("forslag-liste", t("hjem.forslag.liste_label"))
                    .gap_2()
                    .children(rows)
                    .into_any_element()
            })
    }

    fn render_entries(&self, d: &Snapshot, b: &Brand) -> impl IntoElement {
        let total = tf(
            "hjem.poster.i_alt",
            &[("timer", &format::hours(d.total_minutes()))],
        );
        let rows = d.entries.iter().enumerate().map(|(i, e)| {
            let target = d
                .target_label(Some(&e.customer_id), e.project_id.as_deref())
                .unwrap_or_default();
            let span = format::span(e.start, e.end);
            let hours = format::hours(e.minutes);
            let desc = if e.description.is_empty() {
                String::new()
            } else {
                format!(" · {}", e.description)
            };
            ui::list_row(b, ("post", i), format!("{span}, {target}{desc}, {hours}"))
                .child(div().w(px(110.)).flex_none().text_color(b.grey).child(span))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .child(format!("{target}{desc}")),
                )
                .child(
                    div()
                        .w(px(64.))
                        .flex_none()
                        .text_right()
                        .font_weight(FontWeight::MEDIUM)
                        .child(hours),
                )
        });
        ui::titled_card(
            b,
            "poster",
            t("hjem.poster.titel"),
            ui::text("poster-total", total)
                .text_sm()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(b.ink),
        )
        .child(if d.entries.is_empty() {
            ui::empty_state_icon(
                b,
                "poster-tom",
                Icon::Clock,
                t("hjem.poster.tom_titel"),
                t("hjem.poster.tom_tekst"),
            )
            .into_any_element()
        } else {
            ui::list("poster-liste", t("hjem.poster.titel"))
                .children(rows)
                .into_any_element()
        })
    }
}

fn confidence_line(reason: &str, c: f32) -> String {
    let key = if c >= 0.85 {
        "hjem.forslag.sikkerhed_meget"
    } else if c >= 0.65 {
        "hjem.forslag.sikkerhed_ret"
    } else {
        "hjem.forslag.sikkerhed_lidt"
    };
    tf(key, &[("begrundelse", reason)])
}

impl Render for HjemScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.data.ready().is_some()
            && let Some(demo) = self.demo.take()
        {
            self.run_demo(&demo, window, cx);
        }
        if std::mem::take(&mut self.clear_quick) {
            self.quick
                .hours
                .update(cx, |s, cx| s.set_value("", window, cx));
            self.quick
                .description
                .update(cx, |s, cx| s.set_value("", window, cx));
        }
        if let Some(text) = self.pending_description.take() {
            self.description
                .update(cx, |s, cx| s.set_value(text, window, cx));
        }
        let b = brand(cx);
        let narrow = window.viewport_size().width < px(tk::NAV_AUTO_COLLAPSE_BELOW + 60.);
        let subtitle = self
            .data
            .ready()
            .map(|d| SharedString::from(format::date_long(d.today)));
        let mut page = ui::page(&b, "hjem", t("hjem.side.titel"), subtitle);
        page = match &self.data {
            Loadable::Loading => page.child(ui::loading_state(
                &b,
                "hjem-indlaeser",
                t("hjem.side.indlaeser"),
            )),
            Loadable::Failed(e) => page.child(
                ui::error_state(&b, "hjem-fejl", e.clone()).child(
                    Button::new("hjem-igen")
                        .outline()
                        .icon(Icon::RefreshCw)
                        .label(t("hjem.side.proev_igen"))
                        .on_click(cx.listener(|this, _, _, cx| this.reload(cx))),
                ),
            ),
            Loadable::Ready(d) => {
                let d = d.clone();
                page.children(self.error.clone().map(|e| {
                    ui::el("hjem-besked", Role::Alert, e.clone())
                        .text_sm()
                        .text_color(b.danger)
                        .child(e)
                }))
                .child(self.render_timer(&d, &b, cx))
                .child(
                    h_flex()
                        .items_start()
                        .gap(px(tk::GAP_SECTION))
                        .child(
                            v_flex()
                                // Smalle vinduer: lidt smallere venstrekolonne.
                                .w(px(if narrow { 320. } else { 380. }))
                                .flex_none()
                                .gap(px(tk::GAP_SECTION))
                                .child(self.render_punch(&d, &b))
                                .child(self.render_quick(&d, &b, cx)),
                        )
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .gap(px(tk::GAP_SECTION))
                                .children(self.render_laer(&d, &b, cx))
                                .child(self.render_suggestions(&d, &b, cx))
                                .child(self.render_entries(&d, &b))
                                .child(self.render_week(&d, &b))
                                .children(self.render_over_budget(&d, &b)),
                        ),
                )
            }
        };
        div()
            .track_focus(&self.focus)
            .relative()
            .size_full()
            .child(page)
            .when(self.pick_for.is_some(), |d| {
                d.child(ui::modal(
                    "vaelger-dialog",
                    self.picker.read(cx).title(),
                    self.picker.clone(),
                    cx.listener(|this, _: &MouseDownEvent, w, cx| this.close_picker(w, cx)),
                ))
            })
    }
}

fn suggestions_empty_text() -> &'static str {
    t(if crate::mas::ENABLED {
        "mas.hjem.forslag.ingen"
    } else {
        "hjem.forslag.ingen"
    })
}

#[cfg(test)]
mod tests {
    use super::{Snapshot, pos};
    use crate::backend::{Backend, MockBackend};
    use chrono::NaiveDate;

    fn snap() -> Snapshot {
        let m = MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
        Snapshot::load(&m as &dyn Backend).unwrap()
    }

    #[test]
    fn maal_etiket_farve_og_forslag_nu() {
        let s = snap();
        assert_eq!(
            s.pick_label(&super::PickTarget::project(Some("kunde_bageriet"), "proj_webshop")),
            "Bageriet på Hjørnet · Ny webshop"
        );
        assert_eq!(s.pick_label(&super::PickTarget::internal()), crate::i18n::t("hjem.intern_tid"));
        // Bageriet har web-farven #f59e0b i demoen.
        assert_eq!(s.color_of(Some("kunde_bageriet")), gpui_kit::Hsla::from(gpui_kit::rgb(0xf59e0b)));
        // Forslaget 09:00-11:00 dækker 10:00; kl. 12:00 er det for gammelt.
        let at = |h, m| chrono::NaiveTime::from_hms_opt(h, m, 0).unwrap();
        let hints = s.hints_now(at(10, 0));
        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].target.project_id.as_deref(), Some("proj_webshop"));
        assert!(!hints[0].reason.is_empty());
        assert!(s.hints_now(at(12, 0)).is_empty());
    }

    #[test]
    fn klippekort_for_kunde() {
        let s = snap();
        assert_eq!(s.card_for("kunde_bageriet").unwrap().id, "kort_bageriet");
        assert_eq!(
            s.card_for("kunde_cafe").unwrap().id,
            "kort_cafe",
            "opbrugt kort vises stadig"
        );
        assert!(s.card_for("kunde_klinik").is_none());
    }

    #[test]
    fn tidslinje_position() {
        assert_eq!(pos(7.0), 0.0);
        assert_eq!(pos(13.0), 0.5);
        assert_eq!(pos(22.0), 1.0);
    }
}

/// Headless tests af hele skærmen: `cargo test --features probe hjem`.
#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use std::sync::Arc;

    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AnyWindowHandle, AppContext as _, Entity, TestAppContext};

    use super::{HjemScreen, PickFor};
    use crate::app::AppView;
    use crate::backend::{Backend, BackendError, DateRange, MockBackend, TimerStatus, TimerTarget};
    use crate::screens::Screen;
    use crate::testing;

    fn open(
        cx: &mut TestAppContext,
        m: Arc<MockBackend>,
    ) -> (AnyWindowHandle, Entity<AppView>, Entity<HjemScreen>) {
        let (handle, app) = testing::open_app(cx, m);
        testing::navigate(cx, handle, &app, Screen::Hjem);
        let hjem = app
            .read_with(cx, |a, _| a.view_for(Screen::Hjem))
            .unwrap()
            .downcast::<HjemScreen>()
            .ok()
            .unwrap();
        (handle, app, hjem)
    }

    fn settle(cx: &mut TestAppContext, handle: AnyWindowHandle) {
        cx.run_until_parked();
        testing::render(cx, handle);
        cx.run_until_parked();
        testing::render(cx, handle);
    }

    fn click(cx: &mut TestAppContext, handle: AnyWindowHandle, id: &'static str) {
        cx.update_window(handle, |_, w, cx| w.click(id, cx))
            .unwrap();
        settle(cx, handle);
    }

    /// gendan: ugens total og et projekt over budget.
    #[gpui_kit::test]
    fn uge_og_over_budget(cx: &mut TestAppContext) {
        let m = testing::mock();
        // Et lille budget på webshoppen, så den er over.
        let p = m
            .projects(None, false)
            .unwrap()
            .into_iter()
            .find(|p| p.id == "proj_webshop")
            .unwrap();
        m.update_project(
            &p.id,
            crate::backend::ProjectInput {
                customer_id: p.customer_id.clone(),
                name: p.name.clone(),
                hourly_rate: p.hourly_rate,
                budget_minutes: Some(60),
            },
        )
        .unwrap();
        let (h, _app, _hjem) = open(cx, m.clone());
        settle(cx, h);
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Denne uge: "), "{:?}", a.labels);
        assert!(a.has_label_containing("i forhold til sidste uge") || a.has_label_containing("som sidste uge"));
        assert!(a.has_label_containing("Over budget"));
        assert!(a.has_label_containing(&format!("{}: ", p.name)) || a.has_label_containing(&p.name));
        assert!(a.has_label_containing("af 1 t"));
    }

    #[gpui_kit::test]
    fn hurtig_registrerings_felter_har_etiketten_som_navn(cx: &mut TestAppContext) {
        // Set med AX på en rigtig Mac: felterne hed "1,5" og "Hvad lavede
        // du?" (pladsholderne), så VoiceOver ikke sagde Timer/Beskrivelse.
        let (h, _app, _hjem) = open(cx, testing::mock());
        settle(cx, h);
        let a = testing::a11y(cx, h);
        let input = |label: &str| a.labels.iter().any(|(r, l)| r.contains("Text") && l == label);
        assert!(input("Timer"), "{:?}", a.labels);
        assert!(input("Beskrivelse"), "{:?}", a.labels);
    }

    #[cfg(feature = "mas")]
    #[gpui_kit::test]
    fn mas_forslag_tom_tilstand_naevner_kalenderen(cx: &mut TestAppContext) {
        let m = testing::mock();
        for suggestion in m.suggestions(m.today()).unwrap() {
            m.reject_suggestion(&suggestion.id).unwrap();
        }
        let (handle, _, _) = open(cx, m);
        settle(cx, handle);
        let a = testing::a11y(cx, handle);
        assert!(
            a.has_label(
                "Ingen åbne forslag. Aftaler fra din kalender bliver foreslået som registreringer her."
            ),
            "{:?}",
            a.labels
        );
    }

    /// gendan: forslag på en kunde med klippekort viser træk og rest.
    #[gpui_kit::test]
    fn forslag_viser_traek_og_rest_paa_klippekortet(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (h, _app, _hjem) = open(cx, m.clone());
        settle(cx, h);
        let a = testing::a11y(cx, h);
        let with_card = m
            .suggestions(m.today())
            .unwrap()
            .into_iter()
            .filter(|s| {
                s.customer_id.as_deref().is_some_and(|c| {
                    m.punch_cards(Some(c)).unwrap().iter().any(|k| k.is_active(m.today()))
                })
            })
            .count();
        assert!(with_card > 0, "demoen har forslag på en kunde med klippekort");
        assert!(a.has_label_containing("Træk "), "{:?}", a.labels);
        assert!(a.has_label_containing(", rest "));
    }

    #[gpui_kit::test]
    fn hjem_har_roller_og_danske_labels(cx: &mut TestAppContext) {
        let (handle, _, _) = open(cx, testing::mock());
        let a = testing::a11y(cx, handle);
        println!("PROBE hjem roller={} {:?}", a.with_role, a.roles);
        assert_eq!(a.count("Timer"), 1);
        assert_eq!(
            a.count("Meter"),
            0,
            "intet klippekort før en kunde er valgt"
        );
        assert!(
            a.count("Button") >= 3 + 3 * 3 + 2,
            "timer-, forslags- og registreringsknapper"
        );
        assert!(a.has_label("Forslag: 09:00-11:00 Bageriet på Hjørnet · Ny webshop? VS Code og Figma: bageriet-webshop"));
        assert!(
            a.has_label_containing("Uden tidspunkt"),
            "post uden tidspunkt vises"
        );
        assert!(a.has_label("I alt 2,5 t"));
        assert!(a.has_label("Bekræft hele dagen (3)"));
        assert!(a.has_label_containing("Tidslinje 07-19: 2 poster og 3 forslag"));
    }

    /// aktivitet: uklare blokke nævnes, og linket åbner Aktivitet.
    #[gpui_kit::test]
    fn uklare_blokke_vises_og_aabner_aktivitet(cx: &mut TestAppContext) {
        let (handle, app, _) = open(cx, testing::mock());
        let a = testing::a11y(cx, handle);
        assert!(a.has_label("3 blokke uden kunde (1 t 50 min). Hvad var det?"));
        click(cx, handle, "forslag-vis-aktivitet");
        assert_eq!(app.read_with(cx, |a, _| a.screen), Screen::Aktivitet);
    }

    #[gpui_kit::test]
    fn start_uden_kunde_aabner_vaelger_og_starter(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, hjem) = open(cx, m.clone());
        click(cx, handle, "timer-start");
        assert_eq!(
            hjem.read_with(cx, |h, _| h.pick_for.clone()),
            Some(PickFor::Timer)
        );
        cx.update_window(handle, |_, w, cx| w.input("bagr web", cx))
            .unwrap();
        settle(cx, handle);
        let sel = hjem.read_with(cx, |h, cx| {
            let p = h.picker.read(cx);
            p.rows()[p.selected].title.clone()
        });
        assert_eq!(sel, "Ny webshop", "fuzzy-søgning står på Bageriet · Ny webshop");
        cx.update_window(handle, |_, w, cx| w.press("enter", cx))
            .unwrap();
        settle(cx, handle);
        let t = m.timer().unwrap();
        assert_eq!(t.status, TimerStatus::Running);
        assert_eq!(t.customer_id.as_deref(), Some("kunde_bageriet"));
        assert_eq!(t.project_id.as_deref(), Some("proj_webshop"));
        assert!(hjem.read_with(cx, |h, _| h.pick_for.is_none()));
        // Klippekortet for kunden vises nu.
        assert!(testing::a11y(cx, handle).has_label("Klippekort: 7 t tilbage af 20 t"));
        // Pause og fortsæt.
        click(cx, handle, "timer-start");
        assert_eq!(m.timer().unwrap().status, TimerStatus::Paused);
        click(cx, handle, "timer-start");
        assert_eq!(m.timer().unwrap().status, TimerStatus::Running);
    }

    #[gpui_kit::test]
    fn esc_lukker_vaelgeren(cx: &mut TestAppContext) {
        let (handle, _, hjem) = open(cx, testing::mock());
        click(cx, handle, "timer-maal");
        assert!(hjem.read_with(cx, |h, _| h.pick_for.is_some()));
        cx.update_window(handle, |_, w, cx| w.press("escape", cx))
            .unwrap();
        settle(cx, handle);
        assert!(hjem.read_with(cx, |h, _| h.pick_for.is_none()));
    }

    #[gpui_kit::test]
    fn kasser_kraever_bekraeftelse(cx: &mut TestAppContext) {
        let m = testing::mock();
        m.demo_timer(
            TimerTarget {
                customer_id: Some("kunde_cafe".into()),
                description: "Åbningstider på forsiden".into(),
                ..Default::default()
            },
            3600,
        );
        let (handle, _, hjem) = open(cx, m.clone());
        assert_eq!(
            hjem.read_with(cx, |h, cx| h.description.read(cx).value().to_string()),
            "Åbningstider på forsiden",
            "beskrivelsen fra den fælles timer vises"
        );
        click(cx, handle, "timer-kasser");
        assert!(hjem.read_with(cx, |h, _| h.confirm_discard));
        assert_eq!(
            m.timer().unwrap().status,
            TimerStatus::Running,
            "første klik kasserer ikke"
        );
        assert!(testing::a11y(cx, handle).has_label("Kassér 1:00? Tiden gemmes ikke."));
        click(cx, handle, "kasser-nej");
        assert_eq!(m.timer().unwrap().status, TimerStatus::Running);
        click(cx, handle, "timer-kasser");
        click(cx, handle, "kasser-ja");
        assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
        let n = m.entries(DateRange::day(m.today())).unwrap().len();
        assert_eq!(n, 3, "kasseret tid gemmes ikke");
    }

    #[gpui_kit::test]
    fn stop_gemmer_post(cx: &mut TestAppContext) {
        let m = testing::mock();
        m.demo_timer(
            TimerTarget {
                customer_id: Some("kunde_yoga".into()),
                project_id: Some("proj_yoga_app".into()),
                ..Default::default()
            },
            45 * 60,
        );
        let (handle, _, _) = open(cx, m.clone());
        click(cx, handle, "timer-stop");
        assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
        let e = m.entries(DateRange::day(m.today())).unwrap();
        assert!(
            e.iter()
                .any(|e| e.customer_id == "kunde_yoga" && e.minutes == 45)
        );
        assert!(testing::a11y(cx, handle).has_label("I alt 3,25 t"));
    }

    #[gpui_kit::test]
    fn forslag_bekraeft_ret_og_hele_dagen(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, hjem) = open(cx, m.clone());
        cx.update_window(handle, |_, w, cx| {
            w.within(("forslag", 0usize)).click("bekraeft", cx)
        })
        .unwrap();
        settle(cx, handle);
        assert_eq!(m.suggestions(m.today()).unwrap().len(), 2);
        // Ret det næste (Klinik) til Tømreren.
        cx.update_window(handle, |_, w, cx| {
            w.within(("forslag", 0usize)).click("ret", cx)
        })
        .unwrap();
        settle(cx, handle);
        assert!(matches!(
            hjem.read_with(cx, |h, _| h.pick_for.clone()),
            Some(PickFor::Correct(_))
        ));
        cx.update_window(handle, |_, w, cx| w.input("tømrer tilbud", cx))
            .unwrap();
        settle(cx, handle);
        cx.update_window(handle, |_, w, cx| w.press("enter", cx))
            .unwrap();
        settle(cx, handle);
        let e = m.entries(DateRange::day(m.today())).unwrap();
        assert!(
            e.iter()
                .any(|e| e.customer_id == "kunde_toemrer" && e.minutes == 45),
            "rettet forslag gemt på ny kunde"
        );
        assert_eq!(m.suggestions(m.today()).unwrap().len(), 1);
        // Afvis det sidste.
        cx.update_window(handle, |_, w, cx| {
            w.within(("forslag", 0usize)).click("afvis", cx)
        })
        .unwrap();
        settle(cx, handle);
        assert!(m.suggestions(m.today()).unwrap().is_empty());
        assert!(testing::a11y(cx, handle).has_label_containing("Ingen åbne forslag"));
    }

    /// Review (ux-vaelger): Ret til "Uden projekt" på samme kunde fjerner projektet.
    #[gpui_kit::test]
    fn ret_til_uden_projekt_paa_samme_kunde(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, _) = open(cx, m.clone());
        // Forslag 0: Bageriet · Ny webshop.
        cx.update_window(handle, |_, w, cx| w.within(("forslag", 0usize)).click("ret", cx)).unwrap();
        settle(cx, handle);
        cx.update_window(handle, |_, w, cx| w.input("bageriet", cx)).unwrap();
        settle(cx, handle);
        // Markøren står på kunden selv (uden projekt).
        cx.update_window(handle, |_, w, cx| w.press("enter", cx)).unwrap();
        settle(cx, handle);
        let e = m.entries(DateRange::day(m.today())).unwrap();
        let fixed = e.iter().find(|e| e.customer_id == "kunde_bageriet" && e.minutes == 120).expect("posten er gemt");
        assert_eq!(fixed.project_id, None, "Uden projekt gælder");
    }

    #[gpui_kit::test]
    fn bekraeft_hele_dagen(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, _) = open(cx, m.clone());
        click(cx, handle, "bekraeft-dagen");
        assert!(m.suggestions(m.today()).unwrap().is_empty());
        assert_eq!(m.entries(DateRange::day(m.today())).unwrap().len(), 6);
    }

    #[gpui_kit::test]
    fn hurtig_registrering_validerer_og_gemmer(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, hjem) = open(cx, m.clone());
        click(cx, handle, "hurtig-timer");
        cx.update_window(handle, |_, w, cx| w.input("1,5x", cx))
            .unwrap();
        click(cx, handle, "hurtig-gem");
        let errs = hjem.read_with(cx, |h, _| {
            h.quick.errors.iter().map(|e| e.0).collect::<Vec<_>>()
        });
        assert_eq!(errs, vec!["timer", "kunde"]);
        assert!(testing::a11y(cx, handle).has_label("Vælg en kunde"));
        // Ret timetallet og vælg kunde.
        click(cx, handle, "hurtig-timer");
        cx.update_window(handle, |_, w, cx| {
            w.press("cmd-a", cx);
            w.input("1,5", cx);
        })
        .unwrap();
        click(cx, handle, "hurtig-kunde");
        assert_eq!(
            hjem.read_with(cx, |h, _| h.pick_for.clone()),
            Some(PickFor::Quick)
        );
        cx.update_window(handle, |_, w, cx| w.input("bageriet drift", cx))
            .unwrap();
        settle(cx, handle);
        cx.update_window(handle, |_, w, cx| w.press("enter", cx))
            .unwrap();
        settle(cx, handle);
        click(cx, handle, "hurtig-beskrivelse");
        cx.update_window(handle, |_, w, cx| w.input("Møde på Østerbro, æblekage", cx))
            .unwrap();
        let before = m.punch_cards(Some("kunde_bageriet")).unwrap()[0].used_minutes;
        click(cx, handle, "hurtig-gem");
        let e = m.entries(DateRange::day(m.today())).unwrap();
        let ny = e
            .iter()
            .find(|e| e.description == "Møde på Østerbro, æblekage")
            .expect("posten er gemt med æøå");
        assert_eq!(
            (ny.minutes, ny.start, ny.project_id.as_deref()),
            (90, None, Some("proj_bageri_drift"))
        );
        assert_eq!(
            m.punch_cards(Some("kunde_bageriet")).unwrap()[0].used_minutes,
            before + 90
        );
        assert!(testing::a11y(cx, handle).has_label("Registreret 1,5 t"));
        assert!(
            hjem.read_with(cx, |h, cx| h.quick.hours.read(cx).value().is_empty()),
            "feltet tømmes"
        );
    }

    #[gpui_kit::test]
    fn vaelgeren_blokerer_klik_og_lukker_ved_klik_udenfor(cx: &mut TestAppContext) {
        let m = testing::mock();
        m.demo_timer(
            TimerTarget {
                customer_id: Some("kunde_cafe".into()),
                ..Default::default()
            },
            600,
        );
        let (handle, _, hjem) = open(cx, m.clone());
        click(cx, handle, "timer-maal");
        assert!(hjem.read_with(cx, |h, _| h.pick_for.is_some()));
        // "Stop og gem" ligger under det mørke lag: klikket rammer baggrunden,
        // som lukker vælgeren, men timeren må ikke stoppe.
        click(cx, handle, "timer-stop");
        assert_eq!(m.timer().unwrap().status, TimerStatus::Running);
        assert!(hjem.read_with(cx, |h, _| h.pick_for.is_none()));
        click(cx, handle, "timer-maal");
        // Klik i dialogen lukker den ikke.
        click(cx, handle, "vaelger-titel");
        assert!(hjem.read_with(cx, |h, _| h.pick_for.is_some()));
        // Klik på baggrunden lukker.
        cx.update_window(handle, |_, w, cx| {
            w.click_at(
                "vaelger-dialog-lag",
                gpui_kit::point(gpui_kit::px(10.), gpui_kit::px(10.)),
                cx,
            )
        })
        .unwrap();
        settle(cx, handle);
        assert!(hjem.read_with(cx, |h, _| h.pick_for.is_none()));
    }

    #[gpui_kit::test]
    fn uindtastet_beskrivelse_gemmes_ved_pause(cx: &mut TestAppContext) {
        let m = testing::mock();
        m.demo_timer(
            TimerTarget {
                customer_id: Some("kunde_cafe".into()),
                ..Default::default()
            },
            600,
        );
        let (handle, _, hjem) = open(cx, m.clone());
        click(cx, handle, "timer-beskrivelse");
        cx.update_window(handle, |_, w, cx| w.input("Mødenoter", cx))
            .unwrap();
        click(cx, handle, "timer-start");
        let t = m.timer().unwrap();
        assert_eq!(t.status, TimerStatus::Paused);
        assert_eq!(t.description, "Mødenoter");
        assert_eq!(
            hjem.read_with(cx, |h, cx| h.description.read(cx).value().to_string()),
            "Mødenoter"
        );
    }

    #[gpui_kit::test]
    fn hurtig_registrering_beholder_felter_ved_fejl(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, hjem) = open(cx, m.clone());
        hjem.update(cx, |h, _| {
            h.quick.target = Some(super::Target::customer("kunde_cafe"))
        });
        click(cx, handle, "hurtig-timer");
        cx.update_window(handle, |_, w, cx| w.input("2", cx))
            .unwrap();
        m.set_failure(Some(BackendError::Offline));
        click(cx, handle, "hurtig-gem");
        assert_eq!(
            hjem.read_with(cx, |h, cx| h.quick.hours.read(cx).value().to_string()),
            "2",
            "feltet bevares, når gem fejler"
        );
        assert!(testing::a11y(cx, handle).has_label_containing("Du er offline"));
        m.set_failure(None);
        click(cx, handle, "hurtig-gem");
        assert!(hjem.read_with(cx, |h, cx| h.quick.hours.read(cx).value().is_empty()));
        assert!(
            !testing::a11y(cx, handle).has_label_containing("Du er offline"),
            "gammel fejl forsvinder"
        );
    }

    #[gpui_kit::test]
    fn fejl_vises_og_proev_igen(cx: &mut TestAppContext) {
        let m = testing::mock();
        m.set_failure(Some(BackendError::Offline));
        let (handle, _, _) = open(cx, m.clone());
        let a = testing::a11y(cx, handle);
        assert!(a.has_label_containing("Du er offline"));
        m.set_failure(None);
        click(cx, handle, "hjem-igen");
        assert_eq!(testing::a11y(cx, handle).count("Timer"), 1);
    }
}
