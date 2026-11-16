//! Opgaver: liste og board som i web, med filtre, søgning, gruppering,
//! træk-og-slip mellem kolonner, hurtig oprettelse i en kolonne og et
//! detaljepanel med tidsposter.
//!
//! Tastatur: N = ny opgave, `[` og `]` (eller Alt+pil) flytter den valgte
//! opgave til forrige eller næste status, T starter timeren på den, Esc
//! lukker panelet eller formularen. Kort og rækker kan tabbes til; Enter
//! åbner panelet.

mod board;
mod ikon;
pub(crate) mod logic;
mod panel;
mod widgets;

use std::path::PathBuf;

use chrono::NaiveDate;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::component::select::SelectEvent;
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::{
    Customer, DateRange, Entry, Id, Project, ProjectStatus, Task, TaskInput, TaskLane,
    TaskPriority, TaskStatus, TimerTarget,
};
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf};
use crate::ui::forms::{self, Choice, ChoiceList, ChoiceState};
use crate::ui::{self, Loadable, format, pickers};

use ikon::{Ic, ikon, priority_icon, status_icon};
use logic::{Filters, Grouping, Prefs, View};
use widgets::{chip, dot, hsla_of, icon_button, pill, pressable};

/// Alt skærmen viser, hentet samlet.
#[derive(Clone, Debug)]
pub struct Data {
    pub customers: Vec<Customer>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    /// Tavlens kolonner i rækkefølge (web's egne statusser).
    pub lanes: Vec<TaskLane>,
    /// `false`: kolonnerne kunne ikke hentes, og boardet viser de fire faste
    /// (`logic::fixed_lanes`), der flyttes med `set_task_status`.
    pub lanes_live: bool,
}

/// De fire faste kolonner med oversatte navne.
fn fixed_lanes() -> Vec<TaskLane> {
    logic::fixed_lanes(|s| status_label(s).to_string())
}

/// Rækkefølgen på statusfilteret i listen.
pub const STATUS_FILTERS: [Option<TaskStatus>; 5] = [
    None,
    Some(TaskStatus::Backlog),
    Some(TaskStatus::Todo),
    Some(TaskStatus::InProgress),
    Some(TaskStatus::Done),
];

/// Statusnavnet på det valgte sprog (som i web: Backlog, Todo, I gang,
/// Afsluttet).
pub fn status_label(s: TaskStatus) -> &'static str {
    match s {
        TaskStatus::Backlog => t("opx.status.backlog"),
        TaskStatus::Todo => t("opx.status.todo"),
        TaskStatus::InProgress => t("opx.status.in_progress"),
        TaskStatus::Done => t("opx.status.done"),
    }
}

pub fn priority_label(p: TaskPriority) -> &'static str {
    match p {
        TaskPriority::Low => t("opx.priority.low"),
        TaskPriority::Medium => t("opx.priority.medium"),
        TaskPriority::High => t("opx.priority.high"),
        TaskPriority::Urgent => t("opx.priority.urgent"),
    }
}

/// "5,67 t af 10 t" med estimat, ellers "5,67 t".
pub fn progress_text(task: &Task) -> String {
    match task.estimate_minutes {
        Some(e) => tf(
            "opgaver.progress.of",
            &[
                ("logged", &format::hours(task.logged_minutes)),
                ("estimate", &format::hours(e)),
            ],
        ),
        None => format::hours(task.logged_minutes),
    }
}

/// Kortets og rækkens sted: "Kunde · Projekt", "Kunde" uden projekt, eller
/// `None` uden begge.
pub fn place_label(d: &Data, task: &Task) -> Option<String> {
    logic::place_label(&d.customers, &d.projects, task, t("opgaver.label.unknown_customer"))
}

/// "Kunde · Projekt".
pub fn project_label(customers: &[Customer], p: &Project) -> String {
    logic::project_label(customers, p, t("opgaver.label.unknown_customer"))
}

/// Valg i projektfilteret. Uden kunde: alle projekter som "Kunde · Projekt".
/// Med kunde: kundens projekter ved navn.
pub fn project_filter_choices(
    customers: &[Customer],
    projects: &[Project],
    customer: Option<&str>,
) -> Vec<Choice> {
    let mut v: Vec<(String, &Project)> = projects
        .iter()
        .filter(|p| customer.is_none_or(|c| p.customer_id == c))
        .map(|p| {
            let label = if customer.is_some() {
                p.name.clone()
            } else {
                project_label(customers, p)
            };
            (label, p)
        })
        .collect();
    v.sort_by_key(|(l, _)| l.to_lowercase());
    std::iter::once(Choice::new("", t("opgaver.filter.all_projects")))
        .chain(v.into_iter().map(|(l, p)| Choice::new(p.id.clone(), l)))
        .collect()
}

/// Valg i "Ny opgave": aktive projekter hos kunder, der ikke er arkiveret.
pub fn new_task_choices(customers: &[Customer], projects: &[Project]) -> Vec<Choice> {
    let mut v: Vec<(String, &Project)> = projects
        .iter()
        .filter(|p| p.status == ProjectStatus::Active)
        .filter(|p| {
            customers
                .iter()
                .any(|c| c.id == p.customer_id && !c.archived)
        })
        .map(|p| (project_label(customers, p), p))
        .collect();
    v.sort_by_key(|(l, _)| l.to_lowercase());
    v.into_iter()
        .map(|(l, p)| Choice::new(p.id.clone(), l))
        .collect()
}

/// Valg i prioritetsfilteret.
fn priority_choices() -> Vec<Choice> {
    std::iter::once(Choice::new("", t("opx.filter.all_priorities")))
        .chain(
            TaskPriority::ALL
                .into_iter()
                .rev()
                .map(|p| Choice::new(p.as_str(), priority_label(p))),
        )
        .collect()
}

/// Valg i formularens prioritet. "Ingen" findes kun, når opgaven ikke har en
/// prioritet: web kan ikke fjerne den igen, og en rettelse uden valg lader
/// den stå.
fn form_priority_choices(with_none: bool) -> Vec<Choice> {
    with_none
        .then(|| Choice::new("", t("opx.priority.none")))
        .into_iter()
        .chain(
            TaskPriority::ALL
                .into_iter()
                .map(|p| Choice::new(p.as_str(), priority_label(p))),
        )
        .collect()
}

/// Tid som i web (45m, 1,5t) med enhederne på det valgte sprog.
pub(super) fn mins(minutes: u32) -> String {
    logic::format_minutes_with(minutes, t("opx.unit.minute"), t("ui.unit.hour"))
}

fn status_choices() -> Vec<Choice> {
    TaskStatus::ALL
        .into_iter()
        .map(|s| Choice::new(status_key(s), status_label(s)))
        .collect()
}

use logic::status_key;

/// Fejl pr. felt i opgaveformularen.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TaskErrors {
    pub project: Option<&'static str>,
    pub title: Option<&'static str>,
    pub due: Option<&'static str>,
    pub estimate: Option<&'static str>,
}

/// Validerer formularens felter. Ren funktion, så den kan testes.
pub fn validate_task(
    project_id: Option<&str>,
    title: &str,
    due: &str,
    estimate: &str,
    today: NaiveDate,
) -> Result<TaskInput, TaskErrors> {
    let mut err = TaskErrors::default();
    if project_id.is_none() {
        err.project = Some(t("opgaver.err.project"));
    }
    if title.trim().is_empty() {
        err.title = Some(t("opgaver.err.title"));
    }
    let due = if due.trim().is_empty() {
        None
    } else {
        let d = forms::parse_date(due, today);
        if d.is_none() {
            err.due = Some(t("opgaver.err.due"));
        }
        d
    };
    let estimate = pickers::parse_optional_total_hours(estimate)
        .map_err(|e| err.estimate = Some(e))
        .ok();
    if err != TaskErrors::default() {
        return Err(err);
    }
    Ok(TaskInput {
        project_id: project_id.unwrap_or_default().to_string(),
        title: title.trim().to_string(),
        due,
        estimate_minutes: estimate.flatten(),
        ..TaskInput::default()
    })
}

/// Værdien i panelets kunde/projekt-valg: `p:<projekt>`, `c:<kunde>` eller
/// tom (ingen af dem).
pub fn place_value(task: &Task) -> String {
    match (task.project_id.as_str(), task.customer_id.as_deref()) {
        ("", Some(c)) => format!("c:{c}"),
        ("", None) => String::new(),
        (p, _) => format!("p:{p}"),
    }
}

/// Valgene i panelets kunde/projekt-felt: "Ingen", kunderne alene og deres
/// aktive projekter som "Kunde · Projekt", alfabetisk, så hver kunde står
/// over sine projekter. Opgavens nuværende kunde og projekt er altid med.
pub fn place_choices(customers: &[Customer], projects: &[Project], task: &Task) -> Vec<Choice> {
    let current = place_value(task);
    let mut v: Vec<(String, String)> = customers
        .iter()
        .filter(|c| !c.archived || current == format!("c:{}", c.id))
        .map(|c| (c.name.clone(), format!("c:{}", c.id)))
        .collect();
    v.extend(
        projects
            .iter()
            .filter(|p| {
                let open = p.status == ProjectStatus::Active
                    && customers.iter().any(|c| c.id == p.customer_id && !c.archived);
                open || p.id == task.project_id
            })
            .map(|p| (project_label(customers, p), format!("p:{}", p.id))),
    );
    v.sort_by_key(|(l, _)| l.to_lowercase());
    std::iter::once(Choice::new("", t("opx.panel.no_place")))
        .chain(v.into_iter().map(|(l, val)| Choice::new(val, l)))
        .collect()
}

/// Rettelsen fra panelet som `TaskInput`: titel, kunde/projekt, frist og
/// beskrivelse; estimat, status og prioritet er uændrede. Ren funktion, så
/// den kan testes.
pub fn panel_input(
    task: &Task,
    place: &str,
    title: &str,
    due: &str,
    description: &str,
    today: NaiveDate,
) -> Result<TaskInput, TaskErrors> {
    let mut err = TaskErrors::default();
    if title.trim().is_empty() {
        err.title = Some(t("opgaver.err.title"));
    }
    let due = if due.trim().is_empty() {
        None
    } else {
        let d = forms::parse_date(due, today);
        if d.is_none() {
            err.due = Some(t("opgaver.err.due"));
        }
        d
    };
    if err != TaskErrors::default() {
        return Err(err);
    }
    let (project_id, customer_id) = match place.split_once(':') {
        Some(("p", p)) => (p.to_string(), None),
        Some(("c", c)) => (String::new(), Some(c.to_string())),
        _ => (String::new(), None),
    };
    Ok(TaskInput {
        project_id,
        customer_id,
        title: title.trim().to_string(),
        due,
        estimate_minutes: task.estimate_minutes,
        status: None,
        priority: None,
        description: Some(description.trim().to_string()),
    })
}

/// Fristen, som den står i et felt.
fn due_field(d: Option<NaiveDate>) -> String {
    d.map(|d| d.format("%d.%m.%Y").to_string())
        .unwrap_or_default()
}

/// Felterne i panelet, der rettes direkte (titel, kunde/projekt, frist og
/// beskrivelse). Bygges, når en opgave åbnes, og igen efter en gemning.
struct PanelEdit {
    task_id: Id,
    title: Entity<InputState>,
    place: Entity<ChoiceState>,
    due: Entity<InputState>,
    description: Entity<InputState>,
    errors: TaskErrors,
    error: Option<SharedString>,
    busy: bool,
    _subs: Vec<Subscription>,
}

struct TaskForm {
    /// Opgaven, der rettes. `None` = ny opgave.
    editing: Option<Id>,
    project: Entity<ChoiceState>,
    title: Entity<InputState>,
    due: Entity<InputState>,
    estimate: Entity<InputState>,
    status: Entity<ChoiceState>,
    priority: Entity<ChoiceState>,
    description: Entity<InputState>,
    errors: TaskErrors,
    error: Option<SharedString>,
    busy: bool,
    _subs: Vec<Subscription>,
}

/// Hurtig oprettelse øverst i en kolonne (board) eller på listen.
struct InlineAdd {
    status: TaskStatus,
    /// Kolonnen på tavlen (indeks), eller `None` øverst på listen.
    lane: Option<usize>,
    project: Entity<ChoiceState>,
    title: Entity<InputState>,
    error: Option<SharedString>,
    busy: bool,
    _subs: Vec<Subscription>,
}

pub struct OpgaverScreen {
    ctx: AppCtx,
    focus: FocusHandle,
    window: AnyWindowHandle,
    data: Loadable<Data>,
    customer_filter: Entity<ChoiceState>,
    project_filter: Entity<ChoiceState>,
    priority_filter: Entity<ChoiceState>,
    search: Entity<InputState>,
    status_filter: usize,
    mine: bool,
    due_soon: bool,
    prefs: Prefs,
    prefs_dir: Option<PathBuf>,
    /// Opgaven, panelet viser og tastaturet flytter.
    selected: Option<Id>,
    /// Tidsposter på den valgte opgave.
    entries: Loadable<Vec<Entry>>,
    /// Hubbens revision, da tidsposterne sidst blev hentet.
    entries_rev: u64,
    /// Tæller hentninger, så et forældet svar ikke overskriver et nyere.
    load_gen: u64,
    /// Statusskift og flyt, der er sendt men ikke bekræftet (status og evt.
    /// kolonne). Lægges oven på nyhentede data, så en hentning, der startede
    /// før skiftet, ikke ruller kortet tilbage.
    pending: std::collections::HashMap<Id, (TaskStatus, Option<Id>)>,
    form: Option<TaskForm>,
    inline: Option<InlineAdd>,
    /// Panelets felter for den valgte opgave.
    edit: Option<PanelEdit>,
    /// Sidst brugte projekt i hurtig oprettelse.
    last_project: Option<Id>,
    /// Kvittering eller fejl efter en handling (rolle `Status`/`Alert`).
    notice: Option<(SharedString, bool)>,
    /// `TT_DEMO=ret`/`fyld`/`opg-*`: åbn en tilstand, når data er hentet
    /// (skærmbilleder).
    demo: Option<String>,
    _subs: Vec<Subscription>,
}

impl OpgaverScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let customer_filter = forms::choice_state(
            vec![Choice::new("", t("opgaver.filter.all_customers"))],
            None,
            window,
            cx,
        );
        let project_filter = forms::choice_state(
            vec![Choice::new("", t("opgaver.filter.all_projects"))],
            None,
            window,
            cx,
        );
        let priority_filter = forms::choice_state(priority_choices(), None, window, cx);
        let search = forms::input(t("opx.search.placeholder"), "", window, cx);
        // Valget af visning huskes i datamappen. Tests rører ikke disken.
        let prefs_dir = (!cfg!(test)).then(crate::backend::services::data_dir);
        let prefs = prefs_dir.as_deref().map(Prefs::load).unwrap_or_default();
        let subs = vec![
            cx.observe(&ctx.hub, |this, _, cx| this.reload(cx)),
            cx.subscribe_in(
                &customer_filter,
                window,
                |this, _, _: &SelectEvent<ChoiceList>, window, cx| {
                    this.sync_project_choices(window, cx);
                    cx.notify();
                },
            ),
            cx.subscribe(&project_filter, |_, _, _: &SelectEvent<ChoiceList>, cx| {
                cx.notify()
            }),
            cx.subscribe(
                &priority_filter,
                |_, _, _: &SelectEvent<ChoiceList>, cx| cx.notify(),
            ),
            cx.subscribe(&search, |_, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::Change) {
                    cx.notify();
                }
            }),
        ];
        let mut this = OpgaverScreen {
            ctx,
            focus: cx.focus_handle(),
            window: window.window_handle(),
            data: Loadable::Loading,
            customer_filter,
            project_filter,
            priority_filter,
            search,
            status_filter: 0,
            mine: false,
            due_soon: false,
            prefs,
            prefs_dir,
            selected: None,
            entries: Loadable::Ready(Vec::new()),
            entries_rev: 0,
            load_gen: 0,
            pending: Default::default(),
            form: None,
            inline: None,
            edit: None,
            last_project: None,
            notice: None,
            demo: std::env::var("TT_DEMO")
                .ok()
                .filter(|d| d == "ret" || d == "fyld" || d.starts_with("opg-")),
            _subs: subs,
        };
        this.reload(cx);
        this
    }

    pub fn reload(&mut self, cx: &mut Context<Self>) {
        self.load_gen += 1;
        let generation = self.load_gen;
        self.ctx.fetch(
            cx,
            |b| {
                // Kan kolonnerne ikke hentes (og er de ikke husket), vises de
                // fire faste; opgaverne vises stadig.
                let (lanes, lanes_live) = match b.task_lanes() {
                    Ok(l) if !l.is_empty() => (l, true),
                    _ => (fixed_lanes(), false),
                };
                Ok(Data {
                    customers: b.customers(true)?,
                    projects: b.projects(None, true)?,
                    tasks: b.tasks(None)?,
                    lanes,
                    lanes_live,
                })
            },
            move |this, res, cx| {
                if generation != this.load_gen {
                    return; // En nyere hentning er på vej eller landet.
                }
                this.data = Loadable::from_result(res);
                if let Loadable::Ready(d) = &mut this.data {
                    for t in &mut d.tasks {
                        if let Some((s, lane)) = this.pending.get(&t.id) {
                            t.status = *s;
                            if lane.is_some() {
                                t.status_id = lane.clone();
                            }
                        }
                    }
                }
                // Den valgte opgave kan være slettet i web.
                if let (Some(id), Some(d)) = (this.selected.as_ref(), this.data.ready())
                    && !d.tasks.iter().any(|t| &t.id == id)
                {
                    this.selected = None;
                }
                this.refresh_filters(cx);
                // Tidsposterne hentes kun igen, når data faktisk er ændret.
                if this.ctx.hub.read(cx).revision != this.entries_rev {
                    this.reload_entries(cx);
                }
            },
        );
    }

    /// Henter tidsposterne på den valgte opgave.
    fn reload_entries(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected.clone() else {
            return;
        };
        let today = self.ctx.backend.today();
        let requested = id.clone();
        self.entries_rev = self.ctx.hub.read(cx).revision;
        self.ctx.fetch(
            cx,
            move |b| {
                let range = DateRange {
                    from: NaiveDate::from_ymd_opt(2000, 1, 1).unwrap_or(today),
                    to: today + chrono::Days::new(366),
                };
                let mut v: Vec<Entry> = b
                    .entries(range)?
                    .into_iter()
                    .filter(|e| e.task_id.as_deref() == Some(id.as_str()))
                    .collect();
                v.sort_by_key(|e| std::cmp::Reverse((e.date, e.start)));
                Ok((id, v))
            },
            move |this, res, _| {
                // Svaret hører til den opgave, der var valgt, da det blev bedt om.
                if this.selected.as_deref() != Some(requested.as_str()) {
                    return;
                }
                match res {
                    Ok((_, v)) => this.entries = Loadable::Ready(v),
                    Err(e) => this.entries = Loadable::from_result(Err(e)),
                }
            },
        );
    }

    fn customer_items(d: &Data) -> Vec<Choice> {
        let mut cs: Vec<&Customer> = d
            .customers
            .iter()
            .filter(|c| !c.archived || d.projects.iter().any(|p| p.customer_id == c.id))
            .collect();
        cs.sort_by_key(|c| c.name.to_lowercase());
        std::iter::once(Choice::new("", t("opgaver.filter.all_customers")))
            .chain(
                cs.into_iter()
                    .map(|c| Choice::new(c.id.clone(), c.name.clone())),
            )
            .collect()
    }

    /// Henter nye valg til begge filtre efter en hentning (uden `Window`).
    fn refresh_filters(&mut self, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let keep_customer = forms::chosen(&self.customer_filter, cx);
        let keep_project = forms::chosen(&self.project_filter, cx);
        let customers = Self::customer_items(d);
        let projects = project_filter_choices(&d.customers, &d.projects, keep_customer.as_deref());
        pickers::refresh_choices(
            self.window,
            &self.customer_filter,
            customers,
            keep_customer,
            cx,
        );
        pickers::refresh_choices(
            self.window,
            &self.project_filter,
            projects,
            keep_project,
            cx,
        );
    }

    /// Projektfilteret følger den valgte kunde. Kaldes når kunden skiftes.
    fn sync_project_choices(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let customer = forms::chosen(&self.customer_filter, cx);
        let keep = forms::chosen(&self.project_filter, cx);
        let items = project_filter_choices(&d.customers, &d.projects, customer.as_deref());
        // Behold kun valget, hvis projektet hører til den nye kunde.
        let keep = keep.filter(|k| items.iter().any(|c| c.value.as_ref() == k));
        forms::set_choices(&self.project_filter, items, keep.as_deref(), window, cx);
    }

    /// Vælger kunde i filteret (bruges af tests og genveje).
    pub fn set_customer_filter(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        forms::select_value(&self.customer_filter, id, window, cx);
        self.sync_project_choices(window, cx);
        cx.notify();
    }

    /// Vælger projekt i filteret (bruges af tests og genveje).
    pub fn set_project_filter(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        forms::select_value(&self.project_filter, id, window, cx);
        cx.notify();
    }

    fn set_status_filter(&mut self, ix: usize, cx: &mut Context<Self>) {
        self.status_filter = ix.min(STATUS_FILTERS.len() - 1);
        cx.notify();
    }

    /// De aktuelle filtre, samlet.
    fn filters(&self, cx: &App) -> Filters {
        Filters {
            customer: forms::chosen(&self.customer_filter, cx),
            project: forms::chosen(&self.project_filter, cx),
            priority: forms::chosen(&self.priority_filter, cx)
                .as_deref()
                .and_then(TaskPriority::parse),
            status: STATUS_FILTERS[self.status_filter],
            mine: self.mine,
            due_soon: self.due_soon,
            hide_done: self.prefs.hide_done,
            query: self.search.read(cx).value().to_string(),
        }
    }

    fn save_prefs(&self) {
        if let Some(dir) = &self.prefs_dir
            && let Err(e) = self.prefs.save(dir)
        {
            eprintln!("TT kunne ikke gemme visningen af opgaver: {e}");
        }
    }

    pub fn set_view(&mut self, view: View, cx: &mut Context<Self>) {
        if self.prefs.view != view {
            self.prefs.view = view;
            self.save_prefs();
            cx.notify();
        }
    }

    fn set_grouping(&mut self, g: Grouping, cx: &mut Context<Self>) {
        self.prefs.grouping = g;
        self.save_prefs();
        cx.notify();
    }

    fn toggle_hide_done(&mut self, cx: &mut Context<Self>) {
        self.prefs.hide_done = !self.prefs.hide_done;
        self.save_prefs();
        cx.notify();
    }

    fn clear_filters(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        forms::select_value(&self.customer_filter, "", window, cx);
        self.sync_project_choices(window, cx);
        forms::select_value(&self.project_filter, "", window, cx);
        forms::select_value(&self.priority_filter, "", window, cx);
        self.search
            .update(cx, |s, cx| s.set_value("", window, cx));
        self.status_filter = 0;
        self.mine = false;
        self.due_soon = false;
        cx.notify();
    }

    /// Åbner panelet på en opgave.
    pub fn select(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.selected.as_deref() != Some(id) {
            self.entries = Loadable::Loading;
        }
        self.selected = Some(id.to_string());
        self.reload_entries(cx);
        cx.notify();
    }

    fn deselect(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.selected = None;
        self.edit = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    /// Bygger panelets felter for den valgte opgave, når den skifter (kaldes
    /// fra `render`, der har et vindue).
    fn sync_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.selected.clone() else {
            self.edit = None;
            return;
        };
        if self.edit.as_ref().is_some_and(|e| e.task_id == id) {
            return;
        }
        let Some(d) = self.data.ready() else {
            return;
        };
        let Some(task) = d.tasks.iter().find(|t| t.id == id).cloned() else {
            return;
        };
        let choices = place_choices(&d.customers, &d.projects, &task);
        let place = forms::choice_state(choices, Some(&place_value(&task)), window, cx);
        let title = forms::input(t("opgaver.form.placeholder_title"), &task.title, window, cx);
        let due = forms::input(
            t("opgaver.form.placeholder_due"),
            &due_field(task.due),
            window,
            cx,
        );
        let description = forms::input(
            t("opx.panel.no_description"),
            task.description.as_deref().unwrap_or(""),
            window,
            cx,
        );
        let mut subs: Vec<Subscription> = [&title, &due, &description]
            .into_iter()
            .map(|i| pickers::enter_to_save(i, window, cx, Self::save_edit))
            .collect();
        subs.push(cx.subscribe(&place, |_, _, _: &SelectEvent<ChoiceList>, cx| cx.notify()));
        subs.extend([&title, &due, &description].into_iter().map(|i| {
            cx.subscribe(i, |_, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::Change) {
                    cx.notify();
                }
            })
        }));
        self.edit = Some(PanelEdit {
            task_id: id,
            title,
            place,
            due,
            description,
            errors: TaskErrors::default(),
            error: None,
            busy: false,
            _subs: subs,
        });
    }

    /// Er panelets felter ændret i forhold til opgaven?
    fn edit_dirty(&self, cx: &App) -> bool {
        let (Some(e), Some(d)) = (self.edit.as_ref(), self.data.ready()) else {
            return false;
        };
        let Some(task) = d.tasks.iter().find(|t| t.id == e.task_id) else {
            return false;
        };
        forms::value(&e.title, cx) != task.title.trim()
            || forms::value(&e.due, cx) != due_field(task.due)
            || forms::value(&e.description, cx) != task.description.as_deref().unwrap_or("").trim()
            || e.place.read(cx).selected_value().map(|v| v.to_string()).unwrap_or_default()
                != place_value(task)
    }

    /// Gemmer panelets felter (`tasks.update`).
    pub fn save_edit(&mut self, cx: &mut Context<Self>) {
        let today = self.ctx.backend.today();
        let dirty = self.edit_dirty(cx);
        let (Some(e), Some(d)) = (self.edit.as_ref(), self.data.ready()) else {
            return;
        };
        if e.busy || !dirty {
            return;
        }
        let Some(task) = d.tasks.iter().find(|t| t.id == e.task_id).cloned() else {
            return;
        };
        let place = e
            .place
            .read(cx)
            .selected_value()
            .map(|v| v.to_string())
            .unwrap_or_default();
        let sent = (
            place,
            forms::value(&e.title, cx),
            forms::value(&e.due, cx),
            forms::value(&e.description, cx),
        );
        // Panelet, som det så ud før rettelsen (bygges det igen imens, når
        // en anden opgave har været valgt).
        let before = (
            place_value(&task),
            task.title.trim().to_string(),
            due_field(task.due),
            task.description.as_deref().unwrap_or("").trim().to_string(),
        );
        let res = panel_input(&task, &sent.0, &sent.1, &sent.2, &sent.3, today);
        let Some(e) = self.edit.as_mut() else {
            return;
        };
        let input = match res {
            Ok(i) => i,
            Err(errors) => {
                e.errors = errors;
                cx.notify();
                return;
            }
        };
        e.errors = TaskErrors::default();
        e.error = None;
        e.busy = true;
        cx.notify();
        let id = task.id.clone();
        let sent_id = id.clone();
        self.ctx.mutate(
            cx,
            move |b| b.update_task(&id, input),
            move |this, res, cx| match res {
                Ok(saved) => {
                    // Kortet viser rettelsen med det samme; felterne bygges
                    // igen ud fra den gemte opgave.
                    if let Loadable::Ready(d) = &mut this.data
                        && let Some(t) = d.tasks.iter_mut().find(|t| t.id == saved.id)
                    {
                        t.title = saved.title.clone();
                        t.project_id = saved.project_id.clone();
                        t.customer_id = saved.customer_id.clone();
                        t.due = saved.due;
                        t.description = saved.description.clone();
                    }
                    // Kun felterne, der blev gemt (eller den gamle udgave):
                    // er en anden opgave valgt, eller er der skrevet videre
                    // imens, bliver de stående.
                    if let Some(e) = this.edit.as_mut()
                        && e.task_id == saved.id
                    {
                        let now = (
                            e.place.read(cx).selected_value().map(|v| v.to_string()).unwrap_or_default(),
                            forms::value(&e.title, cx),
                            forms::value(&e.due, cx),
                            forms::value(&e.description, cx),
                        );
                        if now == sent || now == before {
                            this.edit = None;
                        } else {
                            e.busy = false;
                        }
                    }
                    this.notice = Some((
                        tf("opgaver.notice.updated", &[("title", &saved.title)]).into(),
                        false,
                    ));
                    cx.notify();
                }
                Err(err) => {
                    if let Some(e) = this.edit.as_mut()
                        && e.task_id == sent_id
                    {
                        e.busy = false;
                        e.error = Some(err.to_string().into());
                    }
                }
            },
        );
    }

    /// Fortryd: felterne viser opgaven igen.
    fn revert_edit(&mut self, cx: &mut Context<Self>) {
        self.edit = None;
        cx.notify();
    }

    /// Åbner formularen. `edit` = id på opgaven, der rettes (felterne
    /// udfyldes); `None` = ny opgave.
    pub fn open_form(&mut self, edit: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let existing = edit
            .and_then(|id| d.tasks.iter().find(|t| t.id == id))
            .cloned();
        let mut items = new_task_choices(&d.customers, &d.projects);
        // En opgave på et projekt, der ikke længere er aktivt, kan stadig
        // rettes uden at skifte projekt.
        if let Some(t) = &existing
            && !items
                .iter()
                .any(|c| c.value.as_ref() == t.project_id.as_str())
            && let Some(p) = d.projects.iter().find(|p| p.id == t.project_id)
        {
            items.push(Choice::new(p.id.clone(), project_label(&d.customers, p)));
        }
        let preselect = match &existing {
            Some(t) => Some(t.project_id.clone()),
            None => forms::chosen(&self.project_filter, cx).or_else(|| self.last_project.clone()),
        };
        let project = forms::choice_state(items, preselect.as_deref(), window, cx);
        let ex = existing.as_ref();
        let title = forms::input(
            t("opgaver.form.placeholder_title"),
            ex.map_or("", |x| &x.title),
            window,
            cx,
        );
        let due = forms::input(
            t("opgaver.form.placeholder_due"),
            &ex.and_then(|x| x.due)
                .map(|d| d.format("%d.%m.%Y").to_string())
                .unwrap_or_default(),
            window,
            cx,
        );
        let estimate = forms::input(
            t("opgaver.form.placeholder_estimate"),
            &ex.and_then(|x| x.estimate_minutes)
                .map(forms::hours_field)
                .unwrap_or_default(),
            window,
            cx,
        );
        let status = forms::choice_state(
            status_choices(),
            Some(status_key(ex.map_or(TaskStatus::Todo, |x| x.status))),
            window,
            cx,
        );
        let priority = forms::choice_state(
            form_priority_choices(ex.is_none_or(|x| x.priority.is_none())),
            ex.and_then(|x| x.priority).map(TaskPriority::as_str),
            window,
            cx,
        );
        let description = forms::input(
            t("opx.form.placeholder_description"),
            ex.and_then(|x| x.description.as_deref()).unwrap_or(""),
            window,
            cx,
        );
        let subs = [&title, &due, &estimate, &description]
            .into_iter()
            .map(|i| pickers::enter_to_save(i, window, cx, Self::save_form))
            .collect();
        title.update(cx, |s, cx| s.focus(window, cx));
        self.form = Some(TaskForm {
            editing: existing.map(|t| t.id),
            project,
            title,
            due,
            estimate,
            status,
            priority,
            description,
            errors: TaskErrors::default(),
            error: None,
            busy: false,
            _subs: subs,
        });
        cx.notify();
    }

    fn close_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.form = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn save_form(&mut self, cx: &mut Context<Self>) {
        let today = self.ctx.backend.today();
        let Some(form) = self.form.as_mut() else {
            return;
        };
        if form.busy {
            return;
        }
        let project = forms::chosen(&form.project, cx);
        let res = validate_task(
            project.as_deref(),
            &forms::value(&form.title, cx),
            &forms::value(&form.due, cx),
            &forms::value(&form.estimate, cx),
            today,
        );
        let mut input = match res {
            Ok(i) => i,
            Err(e) => {
                form.errors = e;
                cx.notify();
                return;
            }
        };
        input.status = forms::chosen(&form.status, cx).and_then(|k| {
            TaskStatus::ALL
                .into_iter()
                .find(|s| status_key(*s) == k.as_str())
        });
        input.priority = forms::chosen(&form.priority, cx)
            .as_deref()
            .and_then(TaskPriority::parse);
        // Tom beskrivelse på en rettelse fjerner den.
        input.description = Some(forms::value(&form.description, cx));
        form.errors = TaskErrors::default();
        form.error = None;
        form.busy = true;
        self.last_project = Some(input.project_id.clone());
        let editing = form.editing.clone();
        self.ctx.mutate(
            cx,
            move |b| match &editing {
                Some(id) => b.update_task(id, input).map(|t| (t, true)),
                None => b.create_task(input).map(|t| (t, false)),
            },
            |this, res, cx| match res {
                Ok((task, updated)) => {
                    this.form = None;
                    let text = if updated {
                        tf("opgaver.notice.updated", &[("title", &task.title)])
                    } else {
                        tf("opgaver.notice.created", &[("title", &task.title)])
                    };
                    this.notice = Some((text.into(), false));
                    cx.notify();
                }
                Err(e) => {
                    if let Some(f) = this.form.as_mut() {
                        f.busy = false;
                        f.error = Some(e.to_string().into());
                    }
                }
            },
        );
    }

    /// Åbner hurtig oprettelse i en kolonne (eller øverst på listen).
    pub fn open_inline(
        &mut self,
        status: TaskStatus,
        lane: Option<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let items = new_task_choices(&d.customers, &d.projects);
        let preselect = forms::chosen(&self.project_filter, cx)
            .filter(|p| items.iter().any(|c| c.value.as_ref() == p.as_str()))
            .or_else(|| {
                self.last_project
                    .clone()
                    .filter(|p| items.iter().any(|c| c.value.as_ref() == p.as_str()))
            });
        let project = forms::choice_state(items, preselect.as_deref(), window, cx);
        let title = forms::input(t("opx.inline.placeholder"), "", window, cx);
        let sub = pickers::enter_to_save(&title, window, cx, Self::save_inline);
        title.update(cx, |s, cx| s.focus(window, cx));
        self.inline = Some(InlineAdd {
            status,
            lane,
            project,
            title,
            error: None,
            busy: false,
            _subs: vec![sub],
        });
        cx.notify();
    }

    fn close_inline(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.inline = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn save_inline(&mut self, cx: &mut Context<Self>) {
        let today = self.ctx.backend.today();
        let Some(f) = self.inline.as_mut() else {
            return;
        };
        if f.busy {
            return;
        }
        let project = forms::chosen(&f.project, cx);
        let mut input = match validate_task(
            project.as_deref(),
            &forms::value(&f.title, cx),
            "",
            "",
            today,
        ) {
            Ok(i) => i,
            Err(e) => {
                f.error = e.title.or(e.project).map(SharedString::from);
                cx.notify();
                return;
            }
        };
        input.status = Some(f.status);
        f.error = None;
        f.busy = true;
        self.last_project = Some(input.project_id.clone());
        // En egen kolonne: opgaven lægges i den, ikke kun i dens kategori.
        let lane_id = f
            .lane
            .zip(self.data.ready().filter(|d| d.lanes_live))
            .and_then(|(ix, d)| d.lanes.get(ix))
            .map(|l| l.id.clone());
        self.ctx.mutate(
            cx,
            move |b| {
                let task = b.create_task(input)?;
                if let Some(lane) = lane_id {
                    b.move_task(&task.id, &lane)?;
                }
                Ok(task)
            },
            |this, res, _| match res {
                Ok(task) => {
                    this.inline = None;
                    this.notice = Some((
                        tf("opgaver.notice.created", &[("title", &task.title)]).into(),
                        false,
                    ));
                }
                Err(e) => {
                    if let Some(f) = this.inline.as_mut() {
                        f.busy = false;
                        f.error = Some(e.to_string().into());
                    }
                }
            },
        );
    }

    pub fn set_status(&mut self, id: &str, status: TaskStatus, cx: &mut Context<Self>) {
        let id = id.to_string();
        let title = self
            .data
            .ready()
            .and_then(|d| d.tasks.iter().find(|t| t.id == id))
            .map(|t| t.title.clone())
            .unwrap_or_default();
        // Kortet flytter med det samme; en fejl henter de rigtige data igen.
        self.pending.insert(id.clone(), (status, None));
        let done_id = id.clone();
        if let Loadable::Ready(d) = &mut self.data
            && let Some(t) = d.tasks.iter_mut().find(|t| t.id == id)
        {
            t.status = status;
            cx.notify();
        }
        self.ctx.mutate(
            cx,
            move |b| b.set_task_status(&id, status),
            move |this, res, cx| {
                // Hentningen efter en vellykket ændring (`changed`) viser nu
                // den nye status; skiftet behøver ikke længere at ligge ovenpå.
                if this.pending.get(&done_id) == Some(&(status, None)) {
                    this.pending.remove(&done_id);
                }
                if res.is_err() {
                    this.reload(cx);
                }
                this.notice = Some(match res {
                    Ok(()) => (
                        tf(
                            "opgaver.notice.status_set",
                            &[("title", &title), ("status", status_label(status))],
                        )
                        .into(),
                        false,
                    ),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    /// Flytter opgaven til kolonnen `ix` på tavlen (træk-og-slip, `[`/`]` og
    /// panelets statusknapper). Kolonnens kategori giver den gamle status, så
    /// kortet flytter med det samme; serveren får `tasks.move`.
    pub fn move_to_lane(&mut self, id: &str, ix: usize, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let (Some(lane), Some(task)) = (d.lanes.get(ix).cloned(), d.tasks.iter().find(|t| t.id == id))
        else {
            return;
        };
        if !d.lanes_live {
            // De faste kolonner: id'et er statussen.
            let status = logic::legacy_status_for_lane(&lane, task.status);
            return self.set_status(id, status, cx);
        }
        let status = logic::legacy_status_for_lane(&lane, task.status);
        let title = task.title.clone();
        let id = id.to_string();
        let pend = (status, Some(lane.id.clone()));
        self.pending.insert(id.clone(), pend.clone());
        if let Loadable::Ready(d) = &mut self.data
            && let Some(t) = d.tasks.iter_mut().find(|t| t.id == id)
        {
            t.status = status;
            t.status_id = Some(lane.id.clone());
            cx.notify();
        }
        let done_id = id.clone();
        let lane_id = lane.id.clone();
        self.ctx.mutate(
            cx,
            move |b| b.move_task(&id, &lane_id),
            move |this, res, cx| {
                if this.pending.get(&done_id) == Some(&pend) {
                    this.pending.remove(&done_id);
                }
                if res.is_err() {
                    this.reload(cx);
                }
                this.notice = Some(match res {
                    Ok(()) => (
                        tf(
                            "opgaver.notice.status_set",
                            &[("title", &title), ("status", &lane.name)],
                        )
                        .into(),
                        false,
                    ),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    /// Kolonnen (indeks), opgaven står i på tavlen.
    pub fn lane_of(&self, id: &str) -> Option<usize> {
        let d = self.data.ready()?;
        let task = d.tasks.iter().find(|t| t.id == id)?;
        logic::resolve_lane(task, &d.lanes)
    }

    /// Flytter opgaven til nabokolonnen (tastaturalternativ til træk-og-slip).
    pub fn step(&mut self, id: &str, forward: bool, cx: &mut Context<Self>) {
        let (Some(cur), Some(len)) = (self.lane_of(id), self.data.ready().map(|d| d.lanes.len()))
        else {
            return;
        };
        if let Some(next) = logic::step_lane(cur, len, forward) {
            self.move_to_lane(id, next, cx);
        }
    }

    /// Ændrer prioriteten fra panelet (resten af opgaven uændret).
    pub fn set_priority(&mut self, id: &str, p: TaskPriority, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let Some(task) = d.tasks.iter().find(|t| t.id == id) else {
            return;
        };
        let input = TaskInput {
            project_id: task.project_id.clone(),
            title: task.title.clone(),
            due: task.due,
            estimate_minutes: task.estimate_minutes,
            status: None,
            priority: Some(p),
            description: None,
            customer_id: task.customer_id.clone(),
        };
        let id = id.to_string();
        self.ctx.mutate(
            cx,
            move |b| b.update_task(&id, input),
            |this, res, _| {
                if let Err(e) = res {
                    this.notice = Some((e.to_string().into(), true));
                }
            },
        );
    }

    pub fn start_timer(&mut self, task_id: &str, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let Some(task) = d.tasks.iter().find(|t| t.id == task_id) else {
            return;
        };
        let customer_id = logic::project_of(&d.projects, task).map(|p| p.customer_id.clone());
        let target = TimerTarget {
            customer_id,
            project_id: Some(task.project_id.clone()),
            task_id: Some(task.id.clone()),
            description: task.title.clone(),
        };
        let title = task.title.clone();
        self.ctx.mutate(
            cx,
            move |b| b.timer_start(target),
            move |this, res, _| {
                this.notice = Some(match res {
                    Ok(_) => (
                        tf("opgaver.notice.timer_running", &[("title", &title)]).into(),
                        false,
                    ),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    fn on_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.form.is_some() || !self.focus.contains_focused(window, cx) {
            return;
        }
        let m = &ev.keystroke.modifiers;
        let key = ev.keystroke.key.as_str();
        if m.platform || m.control {
            return;
        }
        // Ikke mens der skrives i et felt: der er fokus i et inputfelt, som
        // selv tager imod tegnene.
        let typing = self.search.read(cx).focus_handle(cx).is_focused(window)
            || self
                .inline
                .as_ref()
                .is_some_and(|i| i.title.read(cx).focus_handle(cx).is_focused(window))
            || self.edit.as_ref().is_some_and(|e| {
                [&e.title, &e.due, &e.description]
                    .into_iter()
                    .any(|i| i.read(cx).focus_handle(cx).is_focused(window))
            });
        if typing {
            return;
        }
        let selected = self.selected.clone();
        match (key, m.alt) {
            ("n", false) => {
                self.open_form(None, window, cx);
                cx.stop_propagation();
            }
            ("[", _) | ("left", true) => {
                if let Some(id) = selected {
                    self.step(&id, false, cx);
                    cx.stop_propagation();
                }
            }
            ("]", _) | ("right", true) => {
                if let Some(id) = selected {
                    self.step(&id, true, cx);
                    cx.stop_propagation();
                }
            }
            ("t", false) => {
                if let Some(id) = selected {
                    self.start_timer(&id, cx);
                    cx.stop_propagation();
                }
            }
            _ => {}
        }
    }

    // ------------------------------------------------------------ visning

    fn render_toolbar(&self, b: &Brand, cx: &mut Context<Self>) -> Div {
        let filters = self.filters(cx);
        let view = self.prefs.view;
        let weak = cx.entity().downgrade();
        let search = div()
            .w(px(240.))
            .child(forms::text_field(
                b,
                "opgaver-soeg",
                t("opx.search.label"),
                &self.search,
                None,
            ))
            .flex_none();
        let row1 = h_flex()
            .gap_3()
            .items_end()
            .flex_wrap()
            .child(search)
            .child(div().w(px(220.)).child(forms::select_field(
                b,
                "opgaver-kunde",
                t("opgaver.field.customer"),
                &self.customer_filter,
            )))
            .child(div().w(px(240.)).child(forms::select_field(
                b,
                "opgaver-projekt",
                t("opgaver.field.project"),
                &self.project_filter,
            )))
            .child(div().w(px(160.)).child(forms::select_field(
                b,
                "opgaver-prioritet",
                t("opx.field.priority"),
                &self.priority_filter,
            )))
            .child(div().flex_1())
            .child(forms::segmented(
                b,
                "opgaver-visning",
                t("opx.view.label"),
                &[t("opx.view.list"), t("opx.view.board")],
                usize::from(view == View::Board),
                {
                    let weak = weak.clone();
                    move |ix, _, cx| {
                        let v = if ix == 1 { View::Board } else { View::List };
                        let _ = weak.update(cx, |this, cx| this.set_view(v, cx));
                    }
                },
            ))
            .child(
                Button::new("opgave-ny")
                    .label(t("opgaver.action.new"))
                    .primary()
                    .tooltip("N")
                    .on_click(cx.listener(|this, _, w, cx| this.open_form(None, w, cx))),
            );
        let mut row2 = h_flex()
            .gap_2()
            .items_center()
            .flex_wrap()
            .child(
                div()
                    .text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(b.grey)
                    .child(t("opx.filter.quick")),
            )
            .child(
                chip(
                    b,
                    "opgaver-mine",
                    Some(Ic::Timer),
                    t("opx.filter.mine").into(),
                    self.mine,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.mine = !this.mine;
                    cx.notify();
                })),
            )
            .child(
                chip(
                    b,
                    "opgaver-snart",
                    Some(Ic::CalendarClock),
                    t("opx.filter.due_soon").into(),
                    self.due_soon,
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.due_soon = !this.due_soon;
                    cx.notify();
                })),
            )
            .child(
                chip(
                    b,
                    "opgaver-skjul-afsluttede",
                    Some(Ic::CheckCircle2),
                    t("opx.filter.hide_done").into(),
                    self.prefs.hide_done,
                )
                .on_click(cx.listener(|this, _, _, cx| this.toggle_hide_done(cx))),
            );
        if view == View::List {
            row2 = row2
                .child(div().w(px(12.)))
                .child(forms::segmented(
                    b,
                    "opgaver-gruppering",
                    t("opx.group.label"),
                    &[t("opx.group.none"), t("opx.group.customer"), t("opx.group.project")],
                    Grouping::ALL
                        .iter()
                        .position(|g| *g == self.prefs.grouping)
                        .unwrap_or(0),
                    {
                        let weak = weak.clone();
                        move |ix, _, cx| {
                            let g = Grouping::ALL[ix.min(2)];
                            let _ = weak.update(cx, |this, cx| this.set_grouping(g, cx));
                        }
                    },
                ))
                .child(forms::segmented(
                    b,
                    "opgaver-status",
                    t("opgaver.filter.status_label"),
                    &[
                        t("opgaver.filter.all"),
                        t("opx.status.backlog"),
                        t("opx.status.todo"),
                        t("opx.status.in_progress"),
                        t("opx.status.done"),
                    ],
                    self.status_filter,
                    move |ix, _, cx| {
                        let _ = weak.update(cx, |this, cx| this.set_status_filter(ix, cx));
                    },
                ));
        }
        if filters.narrows() || (view == View::List && self.status_filter != 0) {
            row2 = row2.child(
                Button::new("opgaver-ryd")
                    .label(t("opx.filter.clear"))
                    .ghost()
                    .small()
                    .on_click(cx.listener(|this, _, w, cx| this.clear_filters(w, cx))),
            );
        }
        v_flex().gap_3().child(row1).child(row2)
    }

    fn render_row(
        &self,
        b: &Brand,
        d: &Data,
        task: &Task,
        today: NaiveDate,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let dark = b.dark;
        let year = chrono::Datelike::year(&today);
        let place = place_label(d, task);
        let customer = logic::customer_of(&d.customers, &d.projects, task);
        let overdue = logic::is_overdue(task, today);
        let due = task
            .due
            .map(|d| {
                tf(
                    "opgaver.row.due",
                    &[("date", &format::date_medium(d, year))],
                )
            })
            .unwrap_or_else(|| t("opgaver.row.no_due").into());
        let progress = progress_text(task);
        let prio = task
            .priority
            .map(|p| tf("opx.card.priority", &[("priority", priority_label(p))]))
            .unwrap_or_default();
        let label = tf(
            if overdue {
                "opgaver.row.label_overdue"
            } else {
                "opgaver.row.label"
            },
            &[
                ("title", &task.title),
                ("place", place.as_deref().unwrap_or("")),
                ("status", status_label(task.status)),
                ("due", &due),
                ("progress", &progress),
            ],
        );
        // Uden kunde og projekt udelades stedet (og dets komma).
        let label = if place.is_none() {
            label.replacen(", , ", ", ", 1)
        } else {
            label
        };
        let label = if prio.is_empty() {
            label
        } else {
            format!("{label}, {prio}")
        };
        let done = task.status == TaskStatus::Done;
        let selected = self.selected.as_deref() == Some(task.id.as_str());
        let timer_id = task.id.clone();
        let edit_id = task.id.clone();
        let open_id = task.id.clone();
        let sp = logic::status_palette(task.status, dark);
        let color = logic::customer_color_of(customer);
        let row_bg = if selected {
            b.primary_soft
        } else {
            gpui_kit::transparent_black()
        };
        ui::list_row(b, SharedString::from(format!("opgave-{}", task.id)), label)
            .bg(row_bg)
            .child(ikon(status_icon(task.status), 18., hsla_of(sp.accent)))
            .child(
                pressable(
                    b,
                    SharedString::from(format!("opgave-{}-aabn", task.id)),
                    Role::Button,
                    tf("opx.row.open", &[("title", &task.title)]),
                )
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .rounded(px(6.))
                .px_1()
                .child(
                    div()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if done { b.grey } else { b.ink })
                        .child(task.title.clone()),
                )
                .children(place.map(|place| {
                    h_flex()
                        .gap_1p5()
                        .items_center()
                        .text_xs()
                        .text_color(b.grey)
                        .child(dot(b, color))
                        .child(place)
                }))
                .on_click(cx.listener(move |this, _, _, cx| this.select(&open_id, cx))),
            )
            .child(
                div().w(px(92.)).flex_none().children(
                    task.priority.map(|p| {
                        pill(
                            Some(priority_icon(p)),
                            priority_label(p),
                            logic::priority_palette(p, dark),
                        )
                    }),
                ),
            )
            .child(
                v_flex()
                    .w(px(124.))
                    .flex_none()
                    .gap_0p5()
                    .items_start()
                    .child(
                        h_flex()
                            .gap_1()
                            .items_center()
                            .text_color(b.grey)
                            .child(ikon(Ic::Calendar, 13., b.grey))
                            .child(due),
                    )
                    .when(overdue, |d| {
                        d.child(
                            ui::badge(
                                b,
                                SharedString::from(format!("opgave-{}-overskredet", task.id)),
                                t("opgaver.row.overdue"),
                                ui::Tone::Danger,
                            ),
                        )
                    }),
            )
            .child(
                h_flex()
                    .w(px(120.))
                    .flex_none()
                    .gap_1()
                    .items_center()
                    .text_color(b.grey)
                    .child(ikon(Ic::Clock, 13., b.grey))
                    .child(progress),
            )
            .child(
                h_flex().gap_0p5().children(
                    TaskStatus::ALL
                        .into_iter()
                        .enumerate()
                        .map(|(n, s)| {
                            self.status_button(b, &task.id, &task.title, task.status, s, n, cx)
                        })
                        .collect::<Vec<_>>(),
                ),
            )
            .child(
                icon_button(
                    b,
                    SharedString::from(format!("opgave-{}-ret", task.id)),
                    Ic::Pencil,
                    tf("opgaver.row.edit_for", &[("title", &task.title)]),
                    b.grey,
                )
                .on_click(cx.listener(move |this, _, w, cx| this.open_form(Some(&edit_id), w, cx))),
            )
            .child(
                icon_button(
                    b,
                    SharedString::from(format!("opgave-{}-timer", task.id)),
                    Ic::Play,
                    tf("opgaver.row.start_timer_on", &[("title", &task.title)]),
                    b.primary,
                )
                .on_click(cx.listener(move |this, _, _, cx| this.start_timer(&timer_id, cx))),
            )
            .into_any_element()
    }

    /// Statusikon, der sætter opgavens status (liste og panel).
    #[allow(clippy::too_many_arguments)]
    fn status_button(
        &self,
        b: &Brand,
        id: &str,
        title: &str,
        current: TaskStatus,
        s: TaskStatus,
        n: usize,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let on = current == s;
        let p = logic::status_palette(s, b.dark);
        let task_id = id.to_string();
        let label = tf(
            if on {
                "opgaver.row.status_selected"
            } else {
                "opgaver.row.status_set"
            },
            &[("title", title), ("status", status_label(s))],
        );
        let hover = b.border.opacity(0.7);
        pressable(
            b,
            SharedString::from(format!("opgave-{id}-status-{n}")),
            Role::Button,
            label,
        )
        .aria_selected(on)
        .size(px(28.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(6.))
        .when(on, |d| d.bg(hsla_of(p.bg)))
        .when(!on, |d| d.hover(move |s| s.bg(hover)))
        .child(ikon(
            status_icon(s),
            16.,
            if on { hsla_of(p.accent) } else { b.grey.opacity(0.8) },
        ))
        .on_click(cx.listener(move |this, _, _, cx| this.set_status(&task_id, s, cx)))
        .into_any_element()
    }

    fn render_list(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let today = self.ctx.backend.today();
        let filters = self.filters(cx);
        let rows = logic::visible(&d.tasks, &d.customers, &d.projects, &filters, today);
        if rows.is_empty() {
            return self.render_empty(b, d, &filters, cx);
        }
        let count = rows.len();
        let groups = logic::group(
            rows,
            &d.customers,
            &d.projects,
            self.prefs.grouping,
            t("opgaver.label.unknown_customer"),
        );
        let grouped = self.prefs.grouping != Grouping::None;
        let mut out = v_flex().gap_3();
        if let Some(add) = self.render_inline(b, None, cx) {
            out = out.child(add);
        }
        out.child(
            v_flex()
                .gap_3()
                .children(groups.into_iter().enumerate().map(|(gi, g)| {
                    let color = g
                        .customer_id
                        .as_deref()
                        .and_then(|c| d.customers.iter().find(|x| x.id == c))
                        .and_then(logic::customer_color);
                    let n = g.tasks.len();
                    let rows: Vec<AnyElement> = g
                        .tasks
                        .iter()
                        .map(|t| self.render_row(b, d, t, today, cx))
                        .collect();
                    v_flex()
                        .gap_1()
                        .when(grouped, |c| {
                            c.child(
                                h_flex()
                                    .gap_2()
                                    .items_center()
                                    .px_3()
                                    .child(dot(b, color))
                                    .child(ui::heading(
                                        b,
                                        SharedString::from(format!("opgaver-gruppe-{gi}")),
                                        g.label.clone(),
                                        3,
                                    ))
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(b.grey)
                                            .child(n.to_string()),
                                    ),
                            )
                        })
                        .child(
                            ui::list(
                                SharedString::from(format!("opgave-liste-{gi}")),
                                if grouped && n == 1 {
                                    tf("opx.list.group_label_one", &[("group", &g.label)])
                                } else if grouped {
                                    tf(
                                        "opx.list.group_label",
                                        &[("group", &g.label), ("count", &n.to_string())],
                                    )
                                } else {
                                    tf("opgaver.list.label", &[("count", &count.to_string())])
                                },
                            )
                            .children(rows),
                        )
                })),
        )
        .into_any_element()
    }

    /// Tom tilstand: ingen opgaver endnu, eller ingen der matcher.
    fn render_empty(&self, b: &Brand, d: &Data, f: &Filters, cx: &mut Context<Self>) -> AnyElement {
        let (title, body) = if d.tasks.is_empty() {
            (t("opgaver.list.empty_title"), t("opgaver.list.empty_body"))
        } else if f.narrows() || f.status.is_some() {
            (t("opgaver.list.none_title"), t("opgaver.list.none_body"))
        } else {
            (t("opx.empty.all_done_title"), t("opx.empty.all_done_body"))
        };
        let el = ui::empty_state(b, "opgaver-tom", title, body);
        if d.tasks.is_empty() {
            el.child(
                Button::new("opgaver-tom-ny")
                    .label(t("opgaver.action.new"))
                    .primary()
                    .on_click(cx.listener(|this, _, w, cx| this.open_form(None, w, cx))),
            )
        } else {
            el.child(
                Button::new("opgaver-tom-ryd")
                    .label(t("opx.filter.clear"))
                    .on_click(cx.listener(|this, _, w, cx| {
                        this.prefs.hide_done = false;
                        this.save_prefs();
                        this.clear_filters(w, cx);
                    })),
            )
        }
        .into_any_element()
    }

    fn render_form(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let f = self.form.as_ref()?;
        let title = if f.editing.is_some() {
            t("opgaver.form.title_edit")
        } else {
            t("opgaver.action.new")
        };
        let (overlay, dialog) = forms::modal(b, "opgave-formular", title);
        let err = |e: Option<&'static str>| e.map(SharedString::from);
        Some(
            overlay.child(
                dialog
                    .child(forms::select_field(
                        b,
                        "opgave-projekt",
                        t("opgaver.field.project"),
                        &f.project,
                    ))
                    .children(
                        f.errors
                            .project
                            .map(|e| forms::form_error(b, "opgave-projekt-fejl", e)),
                    )
                    .child(forms::text_field(
                        b,
                        "opgave-titel",
                        t("opgaver.field.title"),
                        &f.title,
                        err(f.errors.title),
                    ))
                    .child(forms::text_field(
                        b,
                        "opgave-beskrivelse",
                        t("opx.field.description"),
                        &f.description,
                        None,
                    ))
                    .child(
                        h_flex()
                            .gap_3()
                            .items_start()
                            .child(div().flex_1().child(forms::select_field(
                                b,
                                "opgave-status",
                                t("opx.field.status"),
                                &f.status,
                            )))
                            .child(div().flex_1().child(forms::select_field(
                                b,
                                "opgave-prioritet",
                                t("opx.field.priority"),
                                &f.priority,
                            ))),
                    )
                    .child(
                        h_flex()
                            .gap_3()
                            .items_start()
                            .child(forms::text_field(
                                b,
                                "opgave-frist",
                                t("opgaver.field.due"),
                                &f.due,
                                err(f.errors.due),
                            ))
                            .child(forms::text_field(
                                b,
                                "opgave-estimat",
                                t("opgaver.field.estimate"),
                                &f.estimate,
                                err(f.errors.estimate),
                            )),
                    )
                    .children(
                        f.error
                            .clone()
                            .map(|e| forms::form_error(b, "opgave-formular-fejl", e)),
                    )
                    .child(forms::form_buttons(
                        "opgave-formular",
                        t("opgaver.form.save"),
                        f.busy,
                        cx.listener(|this, _, _, cx| this.save_form(cx)),
                        cx.listener(|this, _, w, cx| this.close_form(w, cx)),
                    )),
            ),
        )
    }

    /// Tilstande til skærmbilleder (`TT_DEMO=opg-...`) og den gamle `ret`.
    fn apply_demo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(demo) = self.demo.take() else {
            return;
        };
        let first = self
            .data
            .ready()
            .and_then(|d| d.tasks.first())
            .map(|t| t.id.clone());
        match demo.as_str() {
            "ret" | "fyld" => {
                if let Some(id) = first {
                    self.open_form(Some(&id), window, cx);
                }
            }
            "opg-board" | "opg-kolonner" => self.prefs.view = View::Board,
            "opg-panel" | "opg-kolonner-panel" => {
                self.prefs.view = View::Board;
                // Skærmbillede: posterne hentes med det samme (ingen ventetid).
                let id = if demo == "opg-panel" { "opg_1" } else { "opg_10" };
                self.selected = Some(id.into());
                let today = self.ctx.backend.today();
                let range = DateRange {
                    from: today - chrono::Days::new(400),
                    to: today + chrono::Days::new(366),
                };
                let v = self
                    .ctx
                    .backend
                    .entries(range)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|e| e.task_id.as_deref() == Some(id))
                    .collect();
                self.entries = Loadable::Ready(v);
            }
            "opg-add" => {
                self.prefs.view = View::Board;
                let todo = self.data.ready().and_then(|d| {
                    d.lanes.iter().position(|l| {
                        logic::legacy_status_for_lane(l, TaskStatus::Todo) == TaskStatus::Todo
                    })
                });
                self.open_inline(TaskStatus::Todo, todo, window, cx);
            }
            "opg-liste" => {
                self.prefs.grouping = Grouping::Customer;
            }
            "opg-filter" => {
                self.prefs.view = View::Board;
                self.due_soon = true;
            }
            "opg-tom" => {
                self.prefs.view = View::Board;
                self.search
                    .update(cx, |s, cx| s.set_value("zzzz", window, cx));
            }
            "opg-form" => self.open_form(None, window, cx),
            _ => {}
        }
        cx.notify();
    }
}

impl Render for OpgaverScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.demo.is_some() && self.data.ready().is_some() {
            self.apply_demo(window, cx);
        }
        self.sync_edit(window, cx);
        let b = brand(cx);
        let subtitle = self.data.ready().map(|d| {
            let n = d
                .tasks
                .iter()
                .filter(|t| t.status != TaskStatus::Done)
                .count();
            SharedString::from(if n == 1 {
                t("opgaver.subtitle.one").to_string()
            } else {
                tf("opgaver.subtitle.many", &[("count", &n.to_string())])
            })
        });
        let toolbar = self.render_toolbar(&b, cx);
        let content = match &self.data {
            Loadable::Loading => {
                ui::loading_state(&b, "opgaver-indlaeser", t("opgaver.loading.what"))
                    .into_any_element()
            }
            Loadable::Failed(e) => ui::error_state(&b, "opgaver-fejl", e.clone())
                .child(
                    Button::new("opgaver-igen")
                        .label(t("opgaver.action.retry"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.data = Loadable::Loading;
                            this.reload(cx);
                        })),
                )
                .into_any_element(),
            Loadable::Ready(d) => {
                let d = d.clone();
                match self.prefs.view {
                    View::List => self.render_list(&b, &d, cx),
                    View::Board => self.render_board(&b, &d, cx),
                }
            }
        };
        let notice = self
            .notice
            .clone()
            .map(|(msg, is_err)| pickers::notice(&b, "opgaver-besked", msg, is_err));
        let panel = self.render_panel(&b, cx);
        div()
            .relative()
            .size_full()
            .track_focus(&self.focus)
            .key_context("Opgaver")
            .on_key_down(cx.listener(Self::on_key))
            .capture_key_down(cx.listener(|this, ev: &KeyDownEvent, w, cx| {
                if ev.keystroke.key == "escape" {
                    if this.form.is_some() {
                        this.close_form(w, cx);
                        cx.stop_propagation();
                    } else if this.inline.is_some() {
                        this.close_inline(w, cx);
                        cx.stop_propagation();
                    } else if this.selected.is_some() {
                        this.deselect(w, cx);
                        cx.stop_propagation();
                    }
                }
            }))
            .child(
                ui::page(&b, "opgaver", t("opgaver.page.title"), subtitle)
                    .child(toolbar)
                    .children(notice)
                    .child(content),
            )
            .children(panel)
            .children(self.render_form(&b, cx))
    }
}

#[cfg(test)]
mod tests;
