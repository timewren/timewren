//! Kalender: uge- og dagsvisning over hele døgnet, med scroll til nu.
//!
//! - Træk i en tom kolonne for at oprette, træk en post for at flytte den
//!   (også til en anden dag), og træk i bunden af en post for at ændre længden.
//! - Klik på en post åbner rediger. Poster uden tidspunkt står i rækken
//!   "Uden tidspunkt" øverst pr. dag.
//! - Tastatur, når kalenderen har fokus: N = ny registrering, pil op/ned =
//!   forrige/næste post, Enter = rediger, Delete = slet, pil venstre/højre =
//!   forrige/næste periode, T = i dag, U/D = uge/dag. Esc lukker formularen.
//!
//! Geometri og validering ligger i rene funktioner (`geo`, `validate_entry`),
//! så de kan testes uden GPUI.

use std::cell::Cell;
use std::rc::Rc;

use chrono::{Datelike, Days, Local, NaiveDate};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::InputState;
use gpui_kit::component::{Disableable as _, Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{
    CardChoice, Customer, Entry, EntryInput, Id, PunchCard, Project, Task,
};
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf};
use crate::ui::forms::{self, Choice, ChoiceState};
use crate::ui::icons;
use crate::ui::maal::PickTarget;
use crate::ui::maalvaelger::{TargetPicker, TargetPickerEvent};
use crate::ui::{self, Loadable, format};
use legend::task_icon;

/// Hvilke poster kalenderen viser ud fra fakturering ("Faktureret" i
/// web's tidsliste): alle, kun dem på en faktura, eller kun dem uden.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InvoicedFilter {
    #[default]
    All,
    Uninvoiced,
    Invoiced,
}

impl InvoicedFilter {
    pub const ALL: [InvoicedFilter; 3] = [
        InvoicedFilter::All,
        InvoicedFilter::Uninvoiced,
        InvoicedFilter::Invoiced,
    ];

    pub fn label(self) -> &'static str {
        match self {
            InvoicedFilter::All => t("kalender.fakturering.alle"),
            InvoicedFilter::Uninvoiced => t("kalender.fakturering.ufaktureret"),
            InvoicedFilter::Invoiced => t("kalender.fakturering.faktureret"),
        }
    }

    pub fn matches(self, e: &Entry) -> bool {
        match self {
            InvoicedFilter::All => true,
            InvoicedFilter::Uninvoiced => e.invoice_id.is_none(),
            InvoicedFilter::Invoiced => e.invoice_id.is_some(),
        }
    }
}

/// Vis denne dag med kun fakturerede poster, næste gang Kalender vises (link
/// fra en faktura).
pub struct ShowInvoiced(pub NaiveDate);

impl Global for ShowInvoiced {}

/// Geometri og træk. Rene funktioner over minutter fra midnat.
// gendan: månedsvisning.
mod farver;
mod legend;
mod maaned;

pub mod geo {
    use chrono::{Datelike, Days, NaiveDate, NaiveTime, Timelike};

    /// Højde af én time i pixels.
    pub const HOUR_PX: f32 = 48.0;
    /// Træk og oprettelse runder til et kvarter.
    pub const SNAP: u32 = 15;
    pub const DAY_MIN: u32 = 24 * 60;

    pub fn min_to_y(m: u32) -> f32 {
        m as f32 * HOUR_PX / 60.0
    }

    /// Lodret position i gitteret → minutter, rundet til nærmeste kvarter.
    pub fn y_to_min(y: f32) -> u32 {
        let m = (y.max(0.0) * 60.0 / HOUR_PX).round() as u32;
        snap(m).min(DAY_MIN)
    }

    pub fn snap(m: u32) -> u32 {
        ((m + SNAP / 2) / SNAP) * SNAP
    }

    pub fn minutes_of(t: NaiveTime) -> u32 {
        t.hour() * 60 + t.minute()
    }

    /// Længden af et tidsrum i minutter. Regnes på minuttallene, ikke på
    /// tidspunkterne, så en post, der slutter 24:00 (vist som 23:59), ikke
    /// mister et minut.
    pub fn span_minutes(start: u32, end: u32) -> u32 {
        end.saturating_sub(start).max(1)
    }

    /// Minutter → tidspunkt. 24:00 bliver 23:59, så en post kan slutte ved midnat.
    pub fn time_of(m: u32) -> NaiveTime {
        let m = m.min(DAY_MIN - 1);
        NaiveTime::from_hms_opt(m / 60, m % 60, 0).expect("gyldigt tidspunkt")
    }

    pub fn week_start(d: NaiveDate) -> NaiveDate {
        d - Days::new(d.weekday().num_days_from_monday() as u64)
    }

    /// Dagene i visningen: syv fra mandag, eller én.
    pub fn days(week: bool, anchor: NaiveDate) -> Vec<NaiveDate> {
        if week {
            let s = week_start(anchor);
            (0..7).map(|i| s + Days::new(i)).collect()
        } else {
            vec![anchor]
        }
    }

    /// Tidsrum for en ny post trukket fra `anchor` til `current`. Et klik
    /// uden træk giver en time. Mindst et kvarter.
    pub fn create_span(anchor: u32, current: u32) -> (u32, u32) {
        if anchor == current {
            let start = anchor.min(DAY_MIN - 60);
            return (start, start + 60);
        }
        let (a, b) = (anchor.min(current), anchor.max(current));
        (a, b.max(a + SNAP).min(DAY_MIN))
    }

    /// Ny start for en post med længden `len`, når musen er ved `pointer` og
    /// posten blev grebet `grab` minutter under starten.
    pub fn move_start(pointer: u32, grab: u32, len: u32) -> u32 {
        let start = snap(pointer.saturating_sub(grab));
        start.min(DAY_MIN.saturating_sub(len))
    }

    /// Højden af greb-zonen i bunden af en post (pixels).
    pub const GRIP_PX: f32 = 8.0;

    /// Rammer y (pixels fra midnat) grebet i bunden af en post, der slutter ved end?
    pub fn is_resize_grip(y: f32, end: u32) -> bool {
        let bottom = min_to_y(end);
        y <= bottom && bottom - y <= GRIP_PX
    }

    /// Ny slut, når bunden trækkes til `pointer`. Mindst et kvarter.
    pub fn resize_end(start: u32, pointer: u32) -> u32 {
        snap(pointer).max(start + SNAP).min(DAY_MIN)
    }

    /// Fordeler overlappende poster i baner: (bane, antal baner i gruppen).
    /// `spans` skal være sorteret efter start.
    pub fn lanes(spans: &[(u32, u32)]) -> Vec<(usize, usize)> {
        let mut out = vec![(0, 1); spans.len()];
        let mut group: Vec<usize> = vec![];
        let mut lane_end: Vec<u32> = vec![];
        let mut group_end = 0;
        let flush = |group: &mut Vec<usize>, lane_end: &mut Vec<u32>, out: &mut Vec<(usize, usize)>| {
            let n = lane_end.len().max(1);
            for &i in group.iter() {
                out[i].1 = n;
            }
            group.clear();
            lane_end.clear();
        };
        for (i, &(s, e)) in spans.iter().enumerate() {
            if !group.is_empty() && s >= group_end {
                flush(&mut group, &mut lane_end, &mut out);
            }
            let e = e.max(s + 1);
            let lane = match lane_end.iter().position(|&end| end <= s) {
                Some(l) => {
                    lane_end[l] = e;
                    l
                }
                None => {
                    lane_end.push(e);
                    lane_end.len() - 1
                }
            };
            out[i].0 = lane;
            group.push(i);
            group_end = if group.len() == 1 { e } else { group_end.max(e) };
        }
        flush(&mut group, &mut lane_end, &mut out);
        out
    }
}

use geo::{DAY_MIN, HOUR_PX};

/// Et træk i gang. Dag er indeks i visningens dage.
#[derive(Clone, Debug, PartialEq)]
pub enum Drag {
    Create {
        day: usize,
        anchor: u32,
        current: u32,
    },
    Move {
        entry: Id,
        grab: u32,
        len: u32,
        day: usize,
        start: u32,
        moved: bool,
    },
    Resize {
        entry: Id,
        day: usize,
        start: u32,
        end: u32,
        moved: bool,
    },
}

/// Fejl pr. felt i posteditoren.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EntryErrors {
    pub customer: Option<&'static str>,
    pub date: Option<&'static str>,
    pub start: Option<&'static str>,
    pub end: Option<&'static str>,
    pub hours: Option<&'static str>,
}

/// Editorens felter som tekst.
#[derive(Clone, Debug, Default)]
pub struct EntryDraft {
    pub customer: Option<String>,
    pub project: Option<String>,
    pub task: Option<String>,
    pub date: String,
    pub untimed: bool,
    pub start: String,
    pub end: String,
    pub hours: String,
    pub description: String,
    pub billable: bool,
}

/// Validerer editoren. Slut skal være efter start; poster uden tidspunkt
/// skal have et timetal.
pub fn validate_entry(d: &EntryDraft, today: NaiveDate) -> Result<EntryInput, EntryErrors> {
    let mut err = EntryErrors::default();
    if d.customer.is_none() {
        err.customer = Some(t("kalender.fejl.kunde"));
    }
    let date = forms::parse_date(&d.date, today);
    if date.is_none() {
        err.date = Some(t("kalender.fejl.dato"));
    }
    let (mut start, mut end, mut minutes) = (None, None, 0);
    if d.untimed {
        match format::parse_hours(&d.hours) {
            Ok(m) => minutes = m,
            Err(e) => err.hours = Some(e),
        }
    } else {
        start = format::parse_time(&d.start);
        end = format::parse_time(&d.end);
        if start.is_none() {
            err.start = Some(t("kalender.fejl.start"));
        }
        if end.is_none() {
            err.end = Some(t("kalender.fejl.slut"));
        }
        if let (Some(a), Some(b)) = (start, end) {
            if b <= a {
                err.end = Some(t("kalender.fejl.slut_foer_start"));
            } else {
                minutes = (b - a).num_minutes() as u32;
            }
        }
    }
    if err != EntryErrors::default() {
        return Err(err);
    }
    Ok(EntryInput {
        customer_id: d.customer.clone().unwrap_or_default(),
        project_id: d.project.clone(),
        task_id: d.task.clone(),
        description: d.description.trim().to_string(),
        date: date.unwrap_or(today),
        start,
        end,
        minutes,
        billable: d.billable,
    })
}

/// "Uge 44 · 26. okt. - 1. nov. 2026" eller "mandag 26. oktober 2026".
pub fn range_label(days: &[NaiveDate]) -> String {
    match days {
        [d] => format::date_long(*d),
        [first, .., last] => tf(
            "kalender.periode.uge",
            &[
                ("uge", &first.iso_week().week().to_string()),
                (
                    "fra",
                    format::date_medium(*first, last.year()).trim_end_matches('.'),
                ),
                ("til", &format::date_medium(*last, last.year())),
                ("aar", &last.year().to_string()),
            ],
        ),
        [] => String::new(),
    }
}

/// Referencedata til navne og valglister.
#[derive(Clone, Debug, Default)]
struct Refs {
    customers: Vec<Customer>,
    projects: Vec<Project>,
    cards: Vec<PunchCard>,
    /// Opgaver, så poster på en opgave kan få opgavemarkering.
    tasks: Vec<Task>,
}

impl Refs {
    fn customer_name(&self, id: &str) -> &str {
        if id.is_empty() {
            return t("maal.intern");
        }
        self.customers
            .iter()
            .find(|c| c.id == id)
            .map_or(t("kalender.ukendt_kunde"), |c| c.name.as_str())
    }

    fn project_name(&self, id: Option<&str>) -> Option<&str> {
        let id = id?;
        self.projects
            .iter()
            .find(|p| p.id == id)
            .map(|p| p.name.as_str())
    }

    /// "Kunde · Projekt" eller "Intern tid · Projekt".
    fn pick_label(&self, x: &PickTarget) -> String {
        let c = match x.customer_id.as_deref() {
            Some(c) => self.customer_name(c).to_string(),
            None => t("maal.intern").to_string(),
        };
        match self.project_name(x.project_id.as_deref()) {
            Some(p) => format!("{c} · {p}"),
            None => c,
        }
    }

    fn card_choices(&self, customer: Option<&str>, today: NaiveDate) -> Vec<Choice> {
        let mut v = vec![Choice::new("auto", t("kalender.valg.automatisk"))];
        v.extend(
            self.cards
                .iter()
                .filter(|c| Some(c.customer_id.as_str()) == customer && c.is_active(today))
                .map(|c| {
                    let left = format::hours(c.remaining_minutes().max(0) as u32);
                    Choice::new(
                        c.id.clone(),
                        tf(
                            "kalender.valg.kort_tilbage",
                            &[("kort", &c.name), ("timer", &left)],
                        ),
                    )
                }),
        );
        v.push(Choice::new("ingen", t("kalender.valg.ingen_traek")));
        v
    }
}

fn card_choice(v: Option<String>) -> CardChoice {
    match v.as_deref() {
        None | Some("auto") => CardChoice::Auto,
        Some("ingen") => CardChoice::None,
        Some(id) => CardChoice::Card(id.to_string()),
    }
}

struct Editor {
    editing: Option<Entry>,
    /// Kunde, projekt og opgave fra den fælles mål-vælger (uden kunde = intern tid).
    target: Option<PickTarget>,
    card: Option<Entity<ChoiceState>>,
    date: Entity<InputState>,
    start: Entity<InputState>,
    end: Entity<InputState>,
    hours: Entity<InputState>,
    description: Entity<InputState>,
    untimed: bool,
    billable: bool,
    /// Brugeren har selv sat "Fakturerbar". Ellers følger en ny post kundens
    /// standard (intern kunde = ikke fakturerbar), også når kunden skiftes.
    billable_touched: bool,
    errors: EntryErrors,
    error: Option<SharedString>,
    busy: bool,
    confirm_delete: bool,
}

/// Udgangspunkt for en ny post.
#[derive(Clone, Debug)]
pub struct NewEntry {
    pub date: NaiveDate,
    pub span: Option<(u32, u32)>,
}

pub struct KalenderScreen {
    ctx: AppCtx,
    focus: FocusHandle,
    week: bool,
    /// gendan: månedsvisning (`week` ignoreres, mens den er slået til).
    month: bool,
    anchor: NaiveDate,
    entries: Loadable<Vec<Entry>>,
    refs: Refs,
    scroll: ScrollHandle,
    /// Kolonnernes område i vinduet (sat ved hver tegning).
    grid_bounds: Rc<Cell<Bounds<Pixels>>>,
    drag: Option<Drag>,
    cursor: Option<Id>,
    editor: Option<Editor>,
    /// Den fælles mål-vælger i editoren, og om den er åben.
    picker: Entity<TargetPicker>,
    picking: bool,
    notice: Option<(SharedString, bool)>,
    /// Filter på fakturerede poster.
    invoiced: InvoicedFilter,
    /// `TT_DEMO=editor`: åbn editoren, når data er hentet (skærmbilleder).
    demo_editor: bool,
    _subs: Vec<Subscription>,
}

impl KalenderScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let today = ctx.backend.today();
        let picker = cx.new(|cx| TargetPicker::new(ctx.clone(), "kalender-vaelger", window, cx));
        let subs = vec![
            cx.observe(&ctx.hub, |this, _, cx| this.reload(cx)),
            cx.subscribe_in(&picker, window, Self::on_picker),
        ];
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let mut this = KalenderScreen {
            ctx,
            focus,
            week: true,
            month: std::env::var("TT_KALENDER").as_deref() == Ok("maaned"),
            anchor: today,
            entries: Loadable::Loading,
            refs: Refs::default(),
            scroll: ScrollHandle::new(),
            grid_bounds: Rc::new(Cell::new(Bounds::default())),
            drag: None,
            cursor: None,
            editor: None,
            picker,
            picking: false,
            notice: None,
            invoiced: InvoicedFilter::default(),
            demo_editor: std::env::var("TT_DEMO").as_deref() == Ok("editor"),
            _subs: subs,
        };
        this.scroll_to_now();
        this.reload(cx);
        this
    }

    fn days(&self) -> Vec<NaiveDate> {
        if self.month {
            return maaned::month_grid(self.anchor);
        }
        geo::days(self.week, self.anchor)
    }

    /// Ruller, så klokken nu står lidt under toppen.
    pub fn scroll_to_now(&mut self) {
        let now = geo::minutes_of(Local::now().time());
        let y = geo::min_to_y(now.saturating_sub(90));
        self.scroll.set_offset(point(px(0.), px(-y)));
    }

    pub fn reload(&mut self, cx: &mut Context<Self>) {
        let filter = self.invoiced;
        let days = self.days();
        let range = crate::backend::DateRange {
            from: days[0],
            to: *days.last().expect("mindst én dag"),
        };
        self.ctx.fetch(
            cx,
            move |b| {
                let entries = b.entries(range)?;
                let refs = Refs {
                    customers: b.customers(true)?,
                    projects: b.projects(None, true)?,
                    cards: b.punch_cards(None)?,
                    tasks: b.tasks(None).unwrap_or_default(),
                };
                Ok((entries, refs))
            },
            move |this, res, _| {
                if this.days().first() != Some(&range.from) {
                    return; // Brugeren har skiftet periode i mellemtiden.
                }
                match res {
                    Ok((mut entries, refs)) => {
                        entries.retain(|e| filter.matches(e));
                        this.entries = Loadable::Ready(entries);
                        this.refs = refs;
                    }
                    Err(e) => this.entries = Loadable::Failed(e.to_string().into()),
                }
            },
        );
    }

    fn all(&self) -> &[Entry] {
        self.entries.ready().map(Vec::as_slice).unwrap_or(&[])
    }

    fn entry(&self, id: &str) -> Option<&Entry> {
        self.all().iter().find(|e| e.id == id)
    }

    pub fn set_invoiced_filter(&mut self, filter: InvoicedFilter, cx: &mut Context<Self>) {
        if self.invoiced == filter {
            return;
        }
        self.invoiced = filter;
        self.entries = Loadable::Loading;
        self.reload(cx);
        cx.notify();
    }

    /// Link fra en faktura: den dag, med kun de fakturerede poster.
    fn show_invoiced(&mut self, day: NaiveDate, cx: &mut Context<Self>) {
        self.anchor = day;
        self.invoiced = InvoicedFilter::Invoiced;
        self.entries = Loadable::Loading;
        self.reload(cx);
        cx.notify();
    }

    pub fn set_week(&mut self, week: bool, cx: &mut Context<Self>) {
        self.week = week;
        self.month = false;
        self.entries = Loadable::Loading;
        self.reload(cx);
        cx.notify();
    }

    pub fn shift(&mut self, dir: i64, cx: &mut Context<Self>) {
        let step = if self.week { 7 } else { 1 };
        self.anchor = if self.month {
            maaned::shift_month(self.anchor, dir)
        } else if dir < 0 {
            self.anchor - Days::new(step)
        } else {
            self.anchor + Days::new(step)
        };
        self.entries = Loadable::Loading;
        self.reload(cx);
        cx.notify();
    }

    fn go_today(&mut self, cx: &mut Context<Self>) {
        self.anchor = self.ctx.backend.today();
        self.scroll_to_now();
        self.entries = Loadable::Loading;
        self.reload(cx);
        cx.notify();
    }

    /// Id'erne på de viste poster (efter filteret på fakturering).
    pub fn shown_ids(&self) -> Vec<Id> {
        self.ordered_ids()
    }

    /// Visningens poster i rækkefølge (dato, uden tidspunkt først, start).
    fn ordered_ids(&self) -> Vec<Id> {
        let mut v: Vec<&Entry> = self.all().iter().collect();
        v.sort_by_key(|e| (e.date, e.start.is_some(), e.start));
        v.into_iter().map(|e| e.id.clone()).collect()
    }

    fn move_cursor(&mut self, delta: i32, cx: &mut Context<Self>) {
        let ids = self.ordered_ids();
        if ids.is_empty() {
            return;
        }
        let cur = self
            .cursor
            .as_ref()
            .and_then(|c| ids.iter().position(|i| i == c));
        let next = match cur {
            Some(i) => (i as i32 + delta).rem_euclid(ids.len() as i32) as usize,
            None if delta < 0 => ids.len() - 1,
            None => 0,
        };
        self.cursor = Some(ids[next].clone());
        if let Some(start) = self.entry(&ids[next]).and_then(|e| e.start) {
            let y = geo::min_to_y(geo::minutes_of(start).saturating_sub(60));
            self.scroll.set_offset(point(px(0.), px(-y)));
        }
        cx.notify();
    }

    // ---------- Editor ----------

    /// Standard for "Ny registrering": dagens næste kvarter (eller 9:00) og en time.
    fn default_new(&self) -> NewEntry {
        let today = self.ctx.backend.today();
        let days = self.days();
        let date = if days.contains(&today) { today } else { days[0] };
        let start = if date == today {
            (geo::minutes_of(Local::now().time()) / 15 * 15).min(DAY_MIN - 60)
        } else {
            9 * 60
        };
        NewEntry {
            date,
            span: Some((start, start + 60)),
        }
    }

    pub fn open_new(&mut self, new: NewEntry, window: &mut Window, cx: &mut Context<Self>) {
        self.open_editor(None, Some(new), window, cx);
    }

    pub fn open_edit(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(e) = self.entry(id).cloned() else {
            return;
        };
        self.cursor = Some(e.id.clone());
        self.open_editor(Some(e), None, window, cx);
    }

    fn open_editor(
        &mut self,
        existing: Option<Entry>,
        new: Option<NewEntry>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let today = self.ctx.backend.today();
        let e = existing.as_ref();
        let customer_id = e.map(|e| e.customer_id.clone()).or_else(|| {
            // Ny post: kunden fra den seneste post i visningen, ellers den første.
            self.all()
                .iter()
                .max_by_key(|e| (e.date, e.start))
                .map(|e| e.customer_id.clone())
        });
        let target = match e {
            Some(e) => Some(PickTarget::from_parts(
                Some(&e.customer_id),
                e.project_id.as_deref(),
                e.task_id.as_deref(),
            )),
            None => customer_id.as_deref().map(PickTarget::customer),
        };
        let chosen_customer = target.as_ref().and_then(|t| t.customer_id.clone());
        let card = existing.is_none().then(|| {
            forms::choice_state(
                self.refs.card_choices(chosen_customer.as_deref(), today),
                Some("auto"),
                window,
                cx,
            )
        });
        let (date, span) = match (e, &new) {
            (Some(e), _) => (
                e.date,
                e.start.zip(e.end).map(|(a, b)| (geo::minutes_of(a), geo::minutes_of(b))),
            ),
            (None, Some(n)) => (n.date, n.span),
            (None, None) => (today, Some((9 * 60, 10 * 60))),
        };
        let untimed = e.is_some_and(|e| e.start.is_none());
        let (s, en) = span.unwrap_or((9 * 60, 10 * 60));
        let hours = e.map(|e| forms::hours_field(e.minutes)).unwrap_or_default();
        let ed = Editor {
            editing: existing.clone(),
            target,
            card,
            date: forms::input("26.10.2026", &format::date_short(date), window, cx),
            start: forms::input("9:00", &format::time(geo::time_of(s)), window, cx),
            end: forms::input("10:00", &format::time(geo::time_of(en)), window, cx),
            hours: forms::input(t("kalender.editor.timer_placeholder"), &hours, window, cx),
            description: forms::input(
                t("kalender.editor.beskrivelse_placeholder"),
                e.map_or("", |e| e.description.as_str()),
                window,
                cx,
            ),
            untimed,
            billable: e.map_or_else(
                || crate::backend::default_billable(&self.refs.customers, chosen_customer.as_deref()),
                |e| e.billable,
            ),
            billable_touched: false,
            errors: EntryErrors::default(),
            error: None,
            busy: false,
            confirm_delete: false,
        };
        ed.description.update(cx, |s, cx| s.focus(window, cx));
        self.editor = Some(ed);
        cx.notify();
    }

    /// Åbn den fælles mål-vælger fra editoren.
    pub fn open_picker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.picking = true;
        self.picker.update(cx, |p, cx| p.open(t("kalender.editor.kunde"), vec![], window, cx));
        cx.notify();
    }

    fn on_picker(
        &mut self,
        _: &Entity<TargetPicker>,
        ev: &TargetPickerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.picking = false;
        if let TargetPickerEvent::Picked(t) = ev {
            if let Some(ed) = self.editor.as_mut() {
                ed.target = Some(t.clone());
                ed.errors.customer = None;
            }
            self.customer_changed(t.customer_id.clone(), window, cx);
        }
        if let Some(ed) = &self.editor {
            ed.description.update(cx, |s, cx| s.focus(window, cx));
        }
        cx.notify();
    }

    /// Ny kunde i editoren: klippekortene følger med, og på en ny post også
    /// "Fakturerbar" (kundens standard), medmindre brugeren selv har sat den.
    pub fn customer_changed(
        &mut self,
        customer: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let today = self.ctx.backend.today();
        let default = crate::backend::default_billable(&self.refs.customers, customer.as_deref());
        let Some(ed) = self.editor.as_mut() else {
            return;
        };
        if ed.editing.is_none() && !ed.billable_touched {
            ed.billable = default;
        }
        let ed = &*ed;
        if let Some(card) = &ed.card {
            forms::set_choices(
                card,
                self.refs.card_choices(customer.as_deref(), today),
                Some("auto"),
                window,
                cx,
            );
        }
        cx.notify();
    }

    /// Til tests: vælg kunde i editoren.
    pub fn editor_select_customer(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ed) = self.editor.as_mut() {
            ed.target = Some(PickTarget::customer(id));
        }
        self.customer_changed(Some(id.to_string()), window, cx);
    }

    /// Til tests: vælg klippekort i editoren ("auto", "ingen" eller kort-id).
    pub fn editor_select_card(&mut self, value: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(card) = self.editor.as_ref().and_then(|e| e.card.clone()) {
            forms::select_value(&card, value, window, cx);
        }
    }

    fn close_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.editor = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn save_editor(&mut self, cx: &mut Context<Self>) {
        let today = self.ctx.backend.today();
        let Some(ed) = self.editor.as_mut() else {
            return;
        };
        let draft = EntryDraft {
            // "" = intern tid: et valgt mål uden kunde er stadig et valg.
            customer: ed.target.as_ref().map(PickTarget::customer_or_empty),
            project: ed.target.as_ref().and_then(|t| t.project_id.clone()),
            task: ed.target.as_ref().and_then(|t| t.task_id.clone()),
            date: forms::value(&ed.date, cx),
            untimed: ed.untimed,
            start: forms::value(&ed.start, cx),
            end: forms::value(&ed.end, cx),
            hours: forms::value(&ed.hours, cx),
            description: forms::value(&ed.description, cx),
            billable: ed.billable,
        };
        let input = match validate_entry(&draft, today) {
            Ok(i) => i,
            Err(e) => {
                ed.errors = e;
                cx.notify();
                return;
            }
        };
        ed.errors = EntryErrors::default();
        ed.error = None;
        ed.busy = true;
        let editing = ed.editing.as_ref().map(|e| e.id.clone());
        let card = card_choice(ed.card.as_ref().and_then(|c| forms::chosen(c, cx)));
        let date = input.date;
        self.ctx.mutate(
            cx,
            move |b| match editing {
                Some(id) => b.update_entry(&id, input),
                None => b.create_entry_with_card(input, card),
            },
            move |this, res, cx| match res {
                Ok(e) => {
                    this.editor = None;
                    this.cursor = Some(e.id.clone());
                    this.notice = Some((t("kalender.besked.gemt").into(), false));
                    if !this.days().contains(&date) {
                        this.anchor = date;
                        this.reload(cx);
                    }
                }
                Err(e) => {
                    if let Some(ed) = this.editor.as_mut() {
                        ed.busy = false;
                        ed.error = Some(e.to_string().into());
                    }
                }
            },
        );
    }

    fn ask_delete(&mut self, cx: &mut Context<Self>) {
        if let Some(ed) = self.editor.as_mut() {
            ed.confirm_delete = true;
        }
        cx.notify();
    }

    pub fn delete_confirmed(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self
            .editor
            .as_ref()
            .and_then(|e| e.editing.as_ref())
            .map(|e| e.id.clone())
        else {
            return;
        };
        self.ctx.mutate(
            cx,
            move |b| b.delete_entry(&id),
            |this, res, _| match res {
                Ok(()) => {
                    this.editor = None;
                    this.cursor = None;
                    this.notice = Some((t("kalender.besked.slettet").into(), false));
                }
                Err(e) => {
                    if let Some(ed) = this.editor.as_mut() {
                        ed.confirm_delete = false;
                        ed.error = Some(e.to_string().into());
                    }
                }
            },
        );
    }

    // ---------- Træk ----------

    /// Musens position → (dag, minut) i gitteret.
    fn hit(&self, pos: Point<Pixels>) -> Option<(usize, u32)> {
        let b = self.grid_bounds.get();
        let n = self.days().len();
        let w = f32::from(b.size.width);
        if w <= 0.0 || n == 0 {
            return None;
        }
        let x = f32::from(pos.x - b.origin.x);
        let y = f32::from(pos.y - b.origin.y);
        let day = ((x / (w / n as f32)).floor().max(0.0) as usize).min(n - 1);
        Some((day, geo::y_to_min(y)))
    }

    fn start_create(&mut self, ev: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.focus.focus(window, cx);
        if let Some((day, m)) = self.hit(ev.position) {
            let m = (m / geo::SNAP * geo::SNAP).min(DAY_MIN - geo::SNAP);
            self.drag = Some(Drag::Create {
                day,
                anchor: m,
                current: m,
            });
            cx.notify();
        }
    }

    fn start_move(&mut self, id: &str, ev: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.focus.focus(window, cx);
        let Some(e) = self.entry(id).cloned() else {
            return;
        };
        let (Some(s), Some(en)) = (e.start, e.end) else {
            return;
        };
        let (s, en) = (geo::minutes_of(s), geo::minutes_of(en));
        // De nederste pixels af posten ændrer længden i stedet for at flytte.
        let y = f32::from(ev.position.y - self.grid_bounds.get().origin.y);
        if geo::is_resize_grip(y, en) {
            self.start_resize(id, window, cx);
            return;
        }
        let day = self.days().iter().position(|d| *d == e.date).unwrap_or(0);
        let pointer = self.hit(ev.position).map_or(s, |(_, m)| m);
        self.cursor = Some(e.id.clone());
        self.drag = Some(Drag::Move {
            entry: e.id,
            grab: pointer.saturating_sub(s),
            len: en.saturating_sub(s).max(geo::SNAP),
            day,
            start: s,
            moved: false,
        });
        cx.stop_propagation();
        cx.notify();
    }

    fn start_resize(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.focus.focus(window, cx);
        let Some(e) = self.entry(id).cloned() else {
            return;
        };
        let (Some(s), Some(en)) = (e.start, e.end) else {
            return;
        };
        let day = self.days().iter().position(|d| *d == e.date).unwrap_or(0);
        self.cursor = Some(e.id.clone());
        self.drag = Some(Drag::Resize {
            entry: e.id,
            day,
            start: geo::minutes_of(s),
            end: geo::minutes_of(en),
            moved: false,
        });
        cx.stop_propagation();
        cx.notify();
    }

    fn drag_to(&mut self, pos: Point<Pixels>, cx: &mut Context<Self>) {
        let Some((day_at, m)) = self.hit(pos) else {
            return;
        };
        match self.drag.as_mut() {
            Some(Drag::Create { current, .. }) => *current = m,
            Some(Drag::Move {
                grab,
                len,
                day,
                start,
                moved,
                ..
            }) => {
                let s = geo::move_start(m, *grab, *len);
                if s != *start || day_at != *day {
                    *moved = true;
                }
                *start = s;
                *day = day_at;
            }
            Some(Drag::Resize {
                start, end, moved, ..
            }) => {
                let e = geo::resize_end(*start, m);
                if e != *end {
                    *moved = true;
                }
                *end = e;
            }
            None => return,
        }
        cx.notify();
    }

    fn finish_drag(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(drag) = self.drag.take() else {
            return;
        };
        let days = self.days();
        match drag {
            Drag::Create {
                day,
                anchor,
                current,
            } => {
                let span = geo::create_span(anchor, current);
                self.open_new(
                    NewEntry {
                        date: days[day.min(days.len() - 1)],
                        span: Some(span),
                    },
                    window,
                    cx,
                );
            }
            Drag::Move {
                entry, moved: false, ..
            }
            | Drag::Resize {
                entry, moved: false, ..
            } => self.open_edit(&entry, window, cx),
            Drag::Move {
                entry,
                len,
                day,
                start,
                ..
            } => self.reschedule(&entry, days[day.min(days.len() - 1)], start, start + len, cx),
            Drag::Resize {
                entry, start, end, ..
            } => {
                let date = self.entry(&entry).map(|e| e.date);
                if let Some(date) = date {
                    self.reschedule(&entry, date, start, end, cx);
                }
            }
        }
        cx.notify();
    }

    fn reschedule(&mut self, id: &str, date: NaiveDate, start: u32, end: u32, cx: &mut Context<Self>) {
        let Some(e) = self.entry(id).cloned() else {
            return;
        };
        let (start_t, end_t) = (geo::time_of(start), geo::time_of(end));
        let input = EntryInput {
            customer_id: e.customer_id.clone(),
            project_id: e.project_id.clone(),
            task_id: e.task_id.clone(),
            description: e.description.clone(),
            date,
            start: Some(start_t),
            end: Some(end_t),
            minutes: geo::span_minutes(start, end),
            billable: e.billable,
        };
        // Vis den nye placering med det samme; genindlæsning retter op ved fejl.
        if let Some(Loadable::Ready(v)) = Some(&mut self.entries)
            && let Some(x) = v.iter_mut().find(|x| x.id == e.id)
        {
            x.date = input.date;
            x.start = input.start;
            x.end = input.end;
            x.minutes = input.minutes;
        }
        let id = e.id.clone();
        self.ctx.mutate(
            cx,
            move |b| b.update_entry(&id, input),
            |this, res, cx| match res {
                Ok(e) => {
                    this.notice = Some((
                        tf(
                            "kalender.besked.flyttet",
                            &[
                                ("dato", &format::date_short(e.date)),
                                ("tid", &format::span(e.start, e.end)),
                            ],
                        )
                        .into(),
                        false,
                    ))
                }
                Err(err) => {
                    this.notice = Some((err.to_string().into(), true));
                    this.reload(cx);
                }
            },
        );
    }

    // ---------- Tastatur ----------

    fn on_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.editor.is_some() || !self.focus.is_focused(window) {
            return;
        }
        let m = &ev.keystroke.modifiers;
        if m.platform || m.control || m.alt {
            return;
        }
        match ev.keystroke.key.as_str() {
            "n" => {
                let new = self.default_new();
                self.open_new(new, window, cx);
            }
            "down" | "j" => self.move_cursor(1, cx),
            "up" | "k" => self.move_cursor(-1, cx),
            "enter" | "space" => {
                if let Some(id) = self.cursor.clone() {
                    self.open_edit(&id, window, cx);
                }
            }
            "delete" | "backspace" => {
                if let Some(id) = self.cursor.clone() {
                    self.open_edit(&id, window, cx);
                    self.ask_delete(cx);
                }
            }
            "left" => self.shift(-1, cx),
            "right" => self.shift(1, cx),
            "t" => self.go_today(cx),
            "u" => self.set_week(true, cx),
            "d" => self.set_week(false, cx),
            "m" => self.set_month(cx),
            _ => return,
        }
        cx.stop_propagation();
    }

    // ---------- Tegning ----------

    /// Postens farver (kundens farve) og opgavemarkering.
    pub(super) fn post_style(
        &self,
        b: &Brand,
        e: &Entry,
    ) -> (farver::BlockColors, Option<farver::TaskMark>) {
        let customer = self.refs.customers.iter().find(|c| c.id == e.customer_id);
        let colors = farver::block_colors(customer, &farver::Fallback::of(b.dark), b.dark);
        let mark = farver::task_of(&self.refs.tasks, e).map(|t| farver::task_mark(t, b.dark));
        (colors, mark)
    }

    fn entry_label(&self, e: &Entry) -> String {
        let mut s = format!(
            "{}, {}, {}",
            format::span(e.start, e.end),
            format::hours(e.minutes),
            self.refs.customer_name(&e.customer_id)
        );
        if let Some(p) = self.refs.project_name(e.project_id.as_deref()) {
            s.push_str(&format!(", {p}"));
        }
        if !e.description.is_empty() {
            s.push_str(&format!(", {}", e.description));
        }
        if let Some(task) = farver::task_of(&self.refs.tasks, e) {
            s.push_str(&tf(
                "opx.kalender.opgave_suffiks",
                &[
                    ("title", &task.title),
                    ("status", crate::screens::opgaver::status_label(task.status)),
                ],
            ));
        }
        if e.invoice_id.is_some() {
            s.push_str(t("kalender.post.faktureret_suffiks"));
        }
        s
    }

    /// Værktøjslinjen. Kvitteringen står her, så gitteret ikke flytter sig,
    /// når den dukker op midt i et træk.
    fn render_toolbar(&self, b: &Brand, notice: Option<ui::El>, cx: &mut Context<Self>) -> impl IntoElement {
        let days = self.days();
        h_flex()
            .gap_2()
            .items_center()
            .child(
                Button::new("kalender-forrige")
                    .icon(Icon::ChevronLeft)
                    .small()
                    .outline()
                    .accessibility_label(if self.month {
                        t("gendan.kalender.prev_month")
                    } else if self.week {
                        t("kalender.vaerktoej.forrige_uge")
                    } else {
                        t("kalender.vaerktoej.forrige_dag")
                    })
                    .tooltip(t("kalender.vaerktoej.venstre_pil"))
                    .on_click(cx.listener(|this, _, _, cx| this.shift(-1, cx))),
            )
            .child(
                Button::new("kalender-idag")
                    .label(t("kalender.vaerktoej.i_dag"))
                    .small()
                    .outline()
                    .tooltip("T")
                    .on_click(cx.listener(|this, _, _, cx| this.go_today(cx))),
            )
            .child(
                Button::new("kalender-naeste")
                    .icon(Icon::ChevronRight)
                    .small()
                    .outline()
                    .accessibility_label(if self.month {
                        t("gendan.kalender.next_month")
                    } else if self.week {
                        t("kalender.vaerktoej.naeste_uge")
                    } else {
                        t("kalender.vaerktoej.naeste_dag")
                    })
                    .tooltip(t("kalender.vaerktoej.hoejre_pil"))
                    .on_click(cx.listener(|this, _, _, cx| this.shift(1, cx))),
            )
            .child(
                ui::text(
                    "kalender-periode",
                    if self.month { maaned::month_label(self.anchor) } else { range_label(&days) },
                )
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(b.ink)
                    .pl_2(),
            )
            .child(div().flex_1())
            .children(notice.map(|n| n.max_w(px(320.)).overflow_hidden().whitespace_nowrap()))
            .child(forms::segmented(
                b,
                "kalender-fakturering",
                t("kalender.fakturering.label"),
                &[
                    InvoicedFilter::All.label(),
                    InvoicedFilter::Uninvoiced.label(),
                    InvoicedFilter::Invoiced.label(),
                ],
                InvoicedFilter::ALL
                    .iter()
                    .position(|f| *f == self.invoiced)
                    .unwrap_or(0),
                {
                    let view = cx.entity().downgrade();
                    move |ix, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.set_invoiced_filter(InvoicedFilter::ALL[ix], cx)
                        });
                    }
                },
            ))
            .child(forms::segmented(
                b,
                "kalender-visning",
                t("kalender.vaerktoej.visning"),
                &[t("kalender.vaerktoej.uge"), t("kalender.vaerktoej.dag"), t("gendan.kalender.month")],
                if self.month { 2 } else { (!self.week) as usize },
                {
                    let view = cx.entity().downgrade();
                    move |ix, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            if ix == 2 {
                                this.set_month(cx)
                            } else {
                                this.set_week(ix == 0, cx)
                            }
                        });
                    }
                },
            ))
            .child(
                Button::new("kalender-ny")
                    .icon(Icon::Plus)
                    .label(t("kalender.ny_registrering"))
                    .primary()
                    .tooltip("N")
                    .on_click(cx.listener(|this, _, w, cx| {
                        let new = this.default_new();
                        this.open_new(new, w, cx)
                    })),
            )
    }

    fn render_grid(&self, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement {
        let days = self.days();
        let today = self.ctx.backend.today();
        let year = today.year();
        let gutter = px(56.);
        let by_day: Vec<Vec<&Entry>> = days
            .iter()
            .map(|d| self.all().iter().filter(|e| e.date == *d).collect())
            .collect();

        // Kolonneoverskrifter med dagens sum.
        let header = h_flex()
            .pl(gutter)
            .border_b_1()
            .border_color(b.border)
            .children(days.iter().enumerate().map(|(i, d)| {
                let total: u32 = by_day[i].iter().map(|e| e.minutes).sum();
                let is_today = *d == today;
                let label = tf(
                    if is_today {
                        "kalender.dag.label_i_dag"
                    } else {
                        "kalender.dag.label"
                    },
                    &[
                        ("dag", format::weekday(d.weekday())),
                        ("dato", &format::date_medium(*d, year)),
                        (
                            "tid",
                            &if total > 0 {
                                format::hours(total)
                            } else {
                                t("kalender.dag.ingen_tid").into()
                            },
                        ),
                    ],
                );
                ui::el(SharedString::from(format!("kalender-dag-{i}")), Role::ColumnHeader, label)
                    .flex_1()
                    .min_w_0()
                    .px_2()
                    .py_1()
                    .child(
                        h_flex()
                            .gap_1()
                            .text_sm()
                            .text_color(if is_today { b.primary } else { b.ink })
                            .font_weight(if is_today { FontWeight::BOLD } else { FontWeight::MEDIUM })
                            .child(format!("{} {}", format::weekday_short(d.weekday()), d.day())),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(b.grey)
                            .child(if total > 0 { format::hours(total) } else { "–".into() }),
                    )
            }));

        // Rækken "Uden tidspunkt".
        let untimed = h_flex()
            .items_start()
            .border_b_1()
            .border_color(b.border)
            .min_h(px(32.))
            .child(
                ui::text("kalender-uden-tidspunkt", t("kalender.uden_tidspunkt"))
                    .w(gutter)
                    .flex_none()
                    .text_xs()
                    .text_color(b.grey)
                    .px_1()
                    .py_1(),
            )
            .children(days.iter().enumerate().map(|(i, d)| {
                let items: Vec<&&Entry> = by_day[i].iter().filter(|e| e.start.is_none()).collect();
                ui::list(
                    SharedString::from(format!("kalender-uden-{i}")),
                    tf(
                        "kalender.uden_tidspunkt_label",
                        &[
                            ("dato", &format::date_medium(*d, year)),
                            ("n", &items.len().to_string()),
                        ],
                    ),
                )
                .flex_1()
                .min_w_0()
                .p_1()
                .children(items.into_iter().map(|e| {
                    let id = e.id.clone();
                    let selected = self.cursor.as_ref() == Some(&e.id);
                    let (colors, mark) = self.post_style(b, e);
                    ui::el(
                        SharedString::from(format!("post-{}", e.id)),
                        Role::Button,
                        format!("{}{}", self.entry_label(e), if selected { t("kalender.post.valgt_suffiks") } else { "" }),
                    )
                    .aria_selected(selected)
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .pl(px(8.))
                    .pr_1p5()
                    .py_0p5()
                    .rounded(px(6.))
                    .text_xs()
                    .relative()
                    .bg(farver::hsla(colors.fill))
                    .text_color(farver::hsla(colors.text))
                    .cursor_pointer()
                    .when(selected, |d| d.border_1().border_color(b.primary))
                    .child(
                        div()
                            .absolute()
                            .left_0()
                            .top_0()
                            .bottom_0()
                            .w(px(4.))
                            .bg(farver::hsla(colors.edge)),
                    )
                    .children(mark.map(|m| {
                        div()
                            .absolute()
                            .right_0()
                            .top_0()
                            .bottom_0()
                            .w(px(4.))
                            .bg(farver::hsla(m.edge))
                    }))
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .on_click(cx.listener(move |this, _, w, cx| this.open_edit(&id, w, cx)))
                    .children(mark.map(|m| {
                        icons::icon(task_icon(m.status)).size(11.).color(farver::hsla(m.badge_fg))
                    }))
                    .child(format!(
                        "{} · {}",
                        format::hours(e.minutes),
                        if e.description.is_empty() {
                            self.refs.customer_name(&e.customer_id).to_string()
                        } else {
                            e.description.clone()
                        }
                    ))
                }))
            }));

        // Timelinjer og tidsetiketter (dekoration; tiden står i posternes labels).
        let hours_col = div()
            .relative()
            .w(gutter)
            .flex_none()
            .h(px(24.0 * HOUR_PX))
            .children((1..24).map(|h| {
                div()
                    .absolute()
                    .top(px(h as f32 * HOUR_PX - 8.))
                    .right(px(8.))
                    .text_xs()
                    .text_color(b.grey)
                    .child(format!("{h:02}:00"))
            }));
        let lines = (1..24).map(|h| {
            div()
                .absolute()
                .left_0()
                .right_0()
                .top(px(h as f32 * HOUR_PX))
                .h(px(1.))
                .bg(b.border.opacity(0.7))
        });

        let bounds = self.grid_bounds.clone();
        let n = days.len();
        let mut day_columns = Vec::with_capacity(n);
        for (i, d) in days.iter().enumerate() {
            day_columns.push(self.render_day_column(b, i, *d, &by_day[i], i + 1 < n, cx));
        }
        let columns = div()
            .id("kalender-kolonner")
            .test_support()
            .role(Role::Grid)
            .aria_label(tf("kalender.gitter_label", &[("periode", &range_label(&days))]))
            .relative()
            .flex_1()
            .min_w_0()
            .h(px(24.0 * HOUR_PX))
            .cursor(CursorStyle::Crosshair)
            .on_mouse_down(MouseButton::Left, cx.listener(Self::start_create))
            .child(
                canvas(move |bnds, _, _| bounds.set(bnds), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            )
            .children(lines)
            .child(
                h_flex()
                    .absolute()
                    .inset_0()
                    .children(day_columns),
            );

        let grid = div()
            .id("kalender-gitter")
            .track_scroll(&self.scroll)
            .overflow_y_scroll()
            .flex_1()
            .min_h(px(320.))
            .child(h_flex().items_start().child(hours_col).child(columns));

        v_flex()
            .flex_1()
            .min_h(px(420.))
            .rounded(px(12.))
            .border_1()
            .border_color(b.border)
            .bg(b.card)
            .overflow_hidden()
            .child(header)
            .child(untimed)
            .child(grid)
    }

    fn render_day_column(
        &self,
        b: &Brand,
        i: usize,
        date: NaiveDate,
        entries: &[&Entry],
        border: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let today = self.ctx.backend.today();
        let dragged = match &self.drag {
            Some(Drag::Move { entry, moved: true, .. }) | Some(Drag::Resize { entry, moved: true, .. }) => {
                Some(entry.clone())
            }
            _ => None,
        };
        let mut timed: Vec<&Entry> = entries
            .iter()
            .copied()
            .filter(|e| e.start.is_some() && dragged.as_ref() != Some(&e.id))
            .collect();
        timed.sort_by_key(|e| e.start);
        let spans: Vec<(u32, u32)> = timed
            .iter()
            .map(|e| {
                let s = geo::minutes_of(e.start.expect("med tidspunkt"));
                let en = e.end.map_or(s + e.minutes, geo::minutes_of);
                (s, en.max(s + geo::SNAP))
            })
            .collect();
        let lanes = geo::lanes(&spans);

        let mut col = div()
            .relative()
            .flex_1()
            .min_w_0()
            .h_full()
            .when(border, |d| d.border_r_1().border_color(b.border.opacity(0.7)))
            .when(date == today, |d| d.bg(b.primary_soft.opacity(0.35)));

        for (k, e) in timed.iter().enumerate() {
            let (s, en) = spans[k];
            let (lane, n) = lanes[k];
            col = col.child(self.render_block(b, e, s, en, lane, n, cx));
        }

        // Forhåndsvisning af trækket.
        match &self.drag {
            Some(Drag::Create { day, anchor, current }) if *day == i => {
                let (s, en) = geo::create_span(*anchor, *current);
                col = col.child(preview(b, "kalender-ny-forhaand", s, en, t("kalender.ny_registrering")));
            }
            Some(Drag::Move { entry, day, start, len, moved: true, .. }) if *day == i => {
                let name = self.entry(entry).map(|e| self.refs.customer_name(&e.customer_id).to_string());
                col = col.child(preview(b, "kalender-flyt-forhaand", *start, start + len, &name.unwrap_or_default()));
            }
            Some(Drag::Resize { entry, day, start, end, moved: true, .. }) if *day == i => {
                let name = self.entry(entry).map(|e| self.refs.customer_name(&e.customer_id).to_string());
                col = col.child(preview(b, "kalender-laengde-forhaand", *start, *end, &name.unwrap_or_default()));
            }
            _ => {}
        }

        // Linjen for "nu".
        if date == today {
            let now = geo::minutes_of(Local::now().time());
            col = col.child(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .top(px(geo::min_to_y(now)))
                    .h(px(2.))
                    .bg(b.danger),
            );
        }
        col.into_any_element()
    }

    #[allow(clippy::too_many_arguments)]
    fn render_block(
        &self,
        b: &Brand,
        e: &Entry,
        s: u32,
        en: u32,
        lane: usize,
        lanes: usize,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let selected = self.cursor.as_ref() == Some(&e.id);
        let height = (geo::min_to_y(en) - geo::min_to_y(s)).max(14.);
        let short = height < 36.;
        let id_move = e.id.clone();
        let invoiced = e.invoice_id.is_some();
        let (colors, mark) = self.post_style(b, e);
        let fill = farver::hsla(colors.fill);
        let text = farver::hsla(colors.text);
        let muted = farver::hsla(colors.muted);
        ui::el(
            SharedString::from(format!("post-{}", e.id)),
            Role::Button,
            format!("{}{}", self.entry_label(e), if selected { t("kalender.post.valgt_suffiks") } else { "" }),
        )
        .aria_selected(selected)
        .absolute()
        .top(px(geo::min_to_y(s) + 1.))
        .h(px(height - 2.))
        .left(relative(lane as f32 / lanes as f32))
        .w(relative(1.0 / lanes as f32))
        .px_0p5()
        .child(
            div()
                .relative()
                .size_full()
                .overflow_hidden()
                .rounded(px(6.))
                .bg(if invoiced && !colors.custom { b.border } else { fill })
                .when(invoiced, |d| d.opacity(0.78))
                .when(selected, |d| d.border_2().border_color(b.primary))
                .pl(px(9.))
                .pr_1p5()
                .py_0p5()
                .text_xs()
                .text_color(text)
                // Kundens farve som venstrekant, opgavens status som højrekant.
                .child(
                    div()
                        .absolute()
                        .left_0()
                        .top_0()
                        .bottom_0()
                        .w(px(4.))
                        .bg(if invoiced && !colors.custom { b.grey } else { farver::hsla(colors.edge) }),
                )
                .children(mark.map(|m| {
                    div()
                        .absolute()
                        .right_0()
                        .top_0()
                        .bottom_0()
                        .w(px(4.))
                        .bg(farver::hsla(m.edge))
                }))
                .cursor(CursorStyle::OpenHand)
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, ev: &MouseDownEvent, w, cx| this.start_move(&id_move, ev, w, cx)),
                )
                .child(
                    h_flex()
                        .gap_1()
                        .items_center()
                        .children(mark.map(|m| {
                            div()
                                .flex_none()
                                .rounded_full()
                                .p(px(1.))
                                .bg(farver::hsla(m.badge_bg))
                                .child(icons::icon(task_icon(m.status)).size(11.).color(farver::hsla(m.badge_fg)))
                        }))
                        .child(
                            div()
                                .min_w_0()
                                .font_weight(FontWeight::SEMIBOLD)
                                .whitespace_nowrap()
                                .child(if short {
                                    format!("{} {}", format::time(e.start.unwrap_or_default()), self.refs.customer_name(&e.customer_id))
                                } else {
                                    self.refs.customer_name(&e.customer_id).to_string()
                                }),
                        ),
                )
                .when(!short, |d| {
                    d.child(div().text_color(muted).child(format::span(e.start, e.end)))
                        .child(div().child(e.description.clone()))
                })
                .when(!invoiced, |d| {
                    // Grebet til længden (synligt mærke; selve trækket afgøres i start_move).
                    d.child(
                        div()
                            .absolute()
                            .left(relative(0.4))
                            .w(relative(0.2))
                            .bottom(px(2.))
                            .h(px(2.))
                            .rounded_full()
                            .bg(text.opacity(0.5)),
                    )
                }),
        )
        .into_any_element()
    }

    fn render_editor(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let ed = self.editor.as_ref()?;
        if ed.confirm_delete {
            let (overlay, dialog) = forms::modal(b, "post-slet", t("kalender.slet.titel"));
            let label = ed.editing.as_ref().map(|e| self.entry_label(e)).unwrap_or_default();
            return Some(
                overlay.child(
                    dialog
                        .role(Role::AlertDialog)
                        .child(ui::text("post-slet-hvad", label).text_sm())
                        .child(ui::muted(b, "post-slet-advarsel", t("kalender.slet.advarsel")))
                        .children(ed.error.clone().map(|e| forms::form_error(b, "post-slet-fejl", e)))
                        .child(
                            h_flex()
                                .justify_end()
                                .gap_2()
                                .child(
                                    Button::new("post-slet-behold")
                                        .label(t("kalender.slet.behold"))
                                        .ghost()
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            if let Some(ed) = this.editor.as_mut() {
                                                ed.confirm_delete = false;
                                            }
                                            cx.notify();
                                        })),
                                )
                                .child(
                                    Button::new("post-slet-bekraeft")
                                        .icon(Icon::Trash2)
                                        .label(t("kalender.slet.slet"))
                                        .danger()
                                        .on_click(cx.listener(|this, _, _, cx| this.delete_confirmed(cx))),
                                ),
                        ),
                ),
            );
        }
        let title = if ed.editing.is_some() {
            t("kalender.editor.titel_ret")
        } else {
            t("kalender.ny_registrering")
        };
        let (overlay, dialog) = forms::modal(b, "post-editor", title);
        let err = |e: Option<&'static str>| e.map(SharedString::from);
        let invoiced = ed.editing.as_ref().is_some_and(|e| e.invoice_id.is_some());
        let time_fields = if ed.untimed {
            h_flex()
                .gap_3()
                .items_start()
                .child(forms::text_field(b, "post-dato", t("kalender.editor.dato"), &ed.date, err(ed.errors.date)))
                .child(forms::text_field(b, "post-timer", t("kalender.editor.timer"), &ed.hours, err(ed.errors.hours)))
        } else {
            h_flex()
                .gap_3()
                .items_start()
                .child(forms::text_field(b, "post-dato", t("kalender.editor.dato"), &ed.date, err(ed.errors.date)))
                .child(forms::text_field(b, "post-start", t("kalender.editor.start"), &ed.start, err(ed.errors.start)))
                .child(forms::text_field(b, "post-slut", t("kalender.editor.slut"), &ed.end, err(ed.errors.end)))
        };
        Some(
            overlay.child(
                dialog
                    .when(invoiced, |d| {
                        let invoice_id = ed.editing.as_ref().and_then(|e| e.invoice_id.clone());
                        d.child(
                            h_flex()
                                .gap_2()
                                .items_center()
                                .child(ui::badge(
                                    b,
                                    "post-faktureret",
                                    t("kalender.editor.faktureret"),
                                    ui::Tone::Warning,
                                ))
                                .child(
                                    Button::new("post-aabn-faktura")
                                        .label(t("kalender.editor.aabn_faktura"))
                                        .ghost()
                                        .small()
                                        .on_click(cx.listener(move |this, _, w, cx| {
                                            if let Some(id) = invoice_id.clone() {
                                                this.close_editor(w, cx);
                                                cx.set_global(
                                                    crate::screens::fakturaer::OpenInvoice(id),
                                                );
                                                w.dispatch_action(
                                                    Box::new(crate::app::GaTilFakturaer),
                                                    cx,
                                                );
                                            }
                                        })),
                                ),
                        )
                    })
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                ui::text("post-kunde-etiket", t("kalender.editor.kunde"))
                                    .text_xs()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(b.grey),
                            )
                            .child(crate::ui::maalvaelger::target_button(
                                b,
                                "post-kunde",
                                ed.target.as_ref().map(|x| self.refs.pick_label(x)),
                                ed.target
                                    .as_ref()
                                    .map(|x| crate::ui::farver::color_in(&self.refs.customers, x.customer_id.as_deref())),
                                cx.listener(|this, _, w, cx| this.open_picker(w, cx)),
                            )),
                    )
                    .children(ed.errors.customer.map(|e| forms::form_error(b, "post-kunde-fejl", e)))
                    .child(time_fields)
                    .child(
                        h_flex()
                            .gap_4()
                            .child(
                                Checkbox::new("post-uden-tidspunkt")
                                    .label(t("kalender.uden_tidspunkt"))
                                    .checked(ed.untimed)
                                    .on_change(cx.listener(|this, v: &bool, _, cx| {
                                        if let Some(ed) = this.editor.as_mut() {
                                            ed.untimed = *v;
                                        }
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Checkbox::new("post-fakturerbar")
                                    .label(t("kalender.editor.fakturerbar"))
                                    .checked(ed.billable)
                                    .on_change(cx.listener(|this, v: &bool, _, cx| {
                                        if let Some(ed) = this.editor.as_mut() {
                                            ed.billable = *v;
                                            ed.billable_touched = true;
                                        }
                                        cx.notify();
                                    })),
                            ),
                    )
                    .child(forms::text_field(b, "post-beskrivelse", t("kalender.editor.beskrivelse"), &ed.description, None))
                    .children(ed.card.as_ref().map(|c| forms::select_field(b, "post-klippekort", t("kalender.editor.klippekort"), c)))
                    .children(ed.error.clone().map(|e| forms::form_error(b, "post-editor-fejl", e)))
                    .child(
                        h_flex()
                            .gap_2()
                            .pt_2()
                            .when(ed.editing.is_some() && !invoiced, |d| {
                                d.child(
                                    Button::new("post-slet")
                                        .icon(Icon::Trash2)
                                        .label(t("kalender.slet.slet"))
                                        .ghost()
                                        .danger()
                                        .on_click(cx.listener(|this, _, _, cx| this.ask_delete(cx))),
                                )
                            })
                            .child(div().flex_1())
                            .child(
                                Button::new("post-editor-annuller")
                                    .label(t("kalender.editor.annuller"))
                                    .ghost()
                                    .on_click(cx.listener(|this, _, w, cx| this.close_editor(w, cx))),
                            )
                            .child(
                                Button::new("post-editor-gem")
                                    .label(t("kalender.editor.gem"))
                                    .primary()
                                    .loading(ed.busy)
                                    .disabled(ed.busy || invoiced)
                                    .on_click(cx.listener(|this, _, _, cx| this.save_editor(cx))),
                            ),
                    ),
            ),
        )
    }
}

fn preview(b: &Brand, id: &'static str, s: u32, en: u32, title: &str) -> impl IntoElement {
    let label = format!(
        "{title}, {}-{}",
        format::time(geo::time_of(s)),
        format::time(geo::time_of(en))
    );
    ui::el(id, Role::Status, label.clone())
        .absolute()
        .top(px(geo::min_to_y(s)))
        .h(px((geo::min_to_y(en) - geo::min_to_y(s)).max(12.)))
        .left_0()
        .right_0()
        .mx_0p5()
        .rounded(px(6.))
        .border_2()
        .border_color(b.primary)
        .bg(b.primary.opacity(0.18))
        .px_1p5()
        .text_xs()
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(b.ink)
        .child(label)
}

impl Render for KalenderScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(ShowInvoiced(day)) = cx.try_global::<ShowInvoiced>().map(|g| ShowInvoiced(g.0))
        {
            cx.remove_global::<ShowInvoiced>();
            self.show_invoiced(day, cx);
        }
        if self.demo_editor && self.entries.ready().is_some() {
            self.demo_editor = false;
            let new = NewEntry {
                date: self.ctx.backend.today(),
                span: Some((13 * 60, 14 * 60 + 30)),
            };
            self.open_new(new, window, cx);
        }
        let b = brand(cx);
        let content = match &self.entries {
            Loadable::Loading => ui::loading_state(&b, "kalender-indlaeser", t("kalender.side.indlaeser")).into_any_element(),
            Loadable::Failed(e) => ui::error_state(&b, "kalender-fejl", e.clone())
                .child(
                    Button::new("kalender-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("kalender.side.proev_igen"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.entries = Loadable::Loading;
                            this.reload(cx);
                        })),
                )
                .into_any_element(),
            Loadable::Ready(_) if self.month => self.render_month(&b, cx),
            Loadable::Ready(v) => {
                let grid = self.render_grid(&b, cx).into_any_element();
                if v.is_empty() {
                    v_flex()
                        .flex_1()
                        .gap_2()
                        .child(ui::muted(
                            &b,
                            "kalender-tom",
                            if self.week {
                                t("kalender.tom.uge")
                            } else {
                                t("kalender.tom.dag")
                            },
                        ))
                        .child(grid)
                        .into_any_element()
                } else {
                    grid
                }
            }
        };
        let notice = self.notice.clone().map(|(msg, is_err)| {
            ui::el("kalender-besked", if is_err { Role::Alert } else { Role::Status }, msg.clone())
                .text_sm()
                .text_color(if is_err { b.danger } else { b.primary })
                .child(msg)
        });
        let total: u32 = self
            .all()
            .iter()
            .filter(|e| !self.month || e.date.month() == self.anchor.month())
            .map(|e| e.minutes)
            .sum();
        let subtitle = tf(
            "kalender.side.undertitel",
            &[("timer", &format::hours(total))],
        );
        div()
            .relative()
            .size_full()
            .track_focus(&self.focus)
            .key_context("Kalender")
            .on_key_down(cx.listener(Self::on_key))
            .capture_key_down(cx.listener(|this, ev: &KeyDownEvent, w, cx| {
                // Er vælgeren åben, lukker Esc kun den (vælgeren tager tasten selv).
                if ev.keystroke.key == "escape" && this.editor.is_some() && !this.picking {
                    this.close_editor(w, cx);
                    cx.stop_propagation();
                }
            }))
            .on_mouse_move(cx.listener(|this, ev: &MouseMoveEvent, _, cx| {
                if this.drag.is_some() && ev.pressed_button == Some(MouseButton::Left) {
                    this.drag_to(ev.position, cx);
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                // Slip bruger den sidste trækposition (fra mouse move).
                cx.listener(|this, _: &MouseUpEvent, w, cx| this.finish_drag(w, cx)),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, _: &MouseUpEvent, w, cx| this.finish_drag(w, cx)),
            )
            .child(
                ui::page(&b, "kalender", t("kalender.side.titel"), Some(subtitle.into()))
                    .child(self.render_toolbar(&b, notice, cx))
                    .child(content)
                    .children(self.render_legend(&b)),
            )
            .children(self.render_editor(&b, cx))
            .when(self.picking, |d| {
                d.child(ui::modal(
                    "kalender-vaelger-dialog",
                    self.picker.read(cx).title(),
                    self.picker.clone(),
                    cx.listener(|this, _: &MouseDownEvent, _, cx| {
                        this.picking = false;
                        cx.notify();
                    }),
                ))
            })
    }
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::geo::{
        create_span, days, is_resize_grip, lanes, move_start, resize_end, span_minutes, time_of, week_start,
        y_to_min,
    };
    use super::{EntryDraft, InvoicedFilter, range_label, validate_entry};

    fn d(y: i32, m: u32, dd: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, dd).unwrap()
    }

    #[test]
    fn fakturafilter_matcher_poster_med_og_uden_faktura() {
        let mut e = crate::backend::Entry {
            id: "e".into(),
            date: d(2026, 11, 17),
            start: None,
            end: None,
            minutes: 60,
            customer_id: "k".into(),
            project_id: None,
            task_id: None,
            description: String::new(),
            billable: true,
            invoice_id: None,
        };
        assert!(InvoicedFilter::All.matches(&e));
        assert!(InvoicedFilter::Uninvoiced.matches(&e));
        assert!(!InvoicedFilter::Invoiced.matches(&e));
        e.invoice_id = Some("f".into());
        assert!(InvoicedFilter::All.matches(&e));
        assert!(!InvoicedFilter::Uninvoiced.matches(&e));
        assert!(InvoicedFilter::Invoiced.matches(&e));
    }

    #[test]
    fn uge_starter_mandag() {
        assert_eq!(week_start(d(2026, 10, 29)), d(2026, 10, 26));
        assert_eq!(week_start(d(2026, 11, 1)), d(2026, 10, 26));
        let w = days(true, d(2026, 10, 28));
        assert_eq!(w.len(), 7);
        assert_eq!(w[6], d(2026, 11, 1));
        assert_eq!(days(false, d(2026, 10, 28)), vec![d(2026, 10, 28)]);
    }

    #[test]
    fn periodens_navn() {
        assert_eq!(
            range_label(&days(true, d(2026, 10, 26))),
            "Uge 44 · 26. okt - 1. nov. 2026"
        );
        assert_eq!(range_label(&[d(2026, 10, 26)]), "mandag 26. oktober 2026");
    }

    #[test]
    fn pixels_til_kvarterer() {
        assert_eq!(y_to_min(0.0), 0);
        assert_eq!(y_to_min(48.0 * 9.0), 540);
        assert_eq!(y_to_min(48.0 * 9.0 + 4.0), 540); // 5 min → 9:00
        assert_eq!(y_to_min(48.0 * 9.0 + 9.0), 555); // 11,25 min → 9:15
        assert_eq!(y_to_min(-20.0), 0);
        assert_eq!(y_to_min(48.0 * 30.0), 1440);
        assert_eq!(time_of(1440).to_string(), "23:59:00");
    }

    #[test]
    fn post_til_midnat_beholder_alle_minutter() {
        // 23:00-24:00 er en time, selv om slutningen vises som 23:59.
        assert_eq!(span_minutes(1380, 1440), 60);
        assert_eq!(span_minutes(540, 600), 60);
        assert_eq!(span_minutes(600, 600), 1);
    }

    #[test]
    fn traek_for_at_oprette() {
        assert_eq!(create_span(540, 540), (540, 600), "klik giver en time");
        assert_eq!(create_span(600, 540), (540, 600), "opad virker også");
        assert_eq!(create_span(540, 540 + 15), (540, 555));
        assert_eq!(create_span(1430, 1430), (1380, 1440), "ikke forbi midnat");
    }

    #[test]
    fn flyt_og_aendr_laengde() {
        // Grebet 30 min inde i en 90 min-post, musen ved 10:40 → start 10:15 (snap).
        assert_eq!(move_start(640, 30, 90), 615);
        assert_eq!(move_start(10, 30, 90), 0);
        assert_eq!(move_start(1440, 0, 90), 1350, "slutter senest ved midnat");
        assert_eq!(resize_end(540, 600), 600);
        assert_eq!(resize_end(540, 530), 555, "mindst et kvarter");
        assert_eq!(resize_end(540, 2000), 1440);
        // Grebet: de nederste 8 px af en post, der slutter 10:00 (y = 480).
        assert!(is_resize_grip(478.0, 600));
        assert!(!is_resize_grip(470.0, 600));
        assert!(!is_resize_grip(481.0, 600));
    }

    #[test]
    fn overlap_fordeles_i_baner() {
        // A 9-11, B 10-12, C 11-12, D 13-14.
        let l = lanes(&[(540, 660), (600, 720), (660, 720), (780, 840)]);
        assert_eq!(l, vec![(0, 2), (1, 2), (0, 2), (0, 1)]);
        assert!(lanes(&[]).is_empty());
    }

    fn draft() -> EntryDraft {
        EntryDraft {
            customer: Some("kunde_klinik".into()),
            project: None,
            task: None,
            date: "26.10.2026".into(),
            untimed: false,
            start: "9".into(),
            end: "10:30".into(),
            hours: String::new(),
            description: " Møde ".into(),
            billable: true,
        }
    }

    #[test]
    fn validering_af_post() {
        let today = d(2026, 10, 26);
        let ok = validate_entry(&draft(), today).unwrap();
        assert_eq!(ok.minutes, 90);
        assert_eq!(ok.description, "Møde");

        let mut x = draft();
        x.end = "8:00".into();
        assert_eq!(
            validate_entry(&x, today).unwrap_err().end,
            Some("Slut skal være efter start")
        );

        let mut x = draft();
        x.customer = None;
        x.date = "32.10".into();
        let e = validate_entry(&x, today).unwrap_err();
        assert!(e.customer.is_some() && e.date.is_some());

        let mut x = draft();
        x.untimed = true;
        x.hours = "1,5".into();
        let ok = validate_entry(&x, today).unwrap();
        assert_eq!((ok.minutes, ok.start, ok.end), (90, None, None));
        x.hours = "".into();
        assert!(validate_entry(&x, today).unwrap_err().hours.is_some());
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe {
    use std::sync::Arc;

    use chrono::NaiveTime;
    use gpui_kit::test::{TestEventExt as _, TestWindowExt as _};
    use gpui_kit::{AppContext as _, Entity, MouseButton, TestAppContext, point, px};

    use super::KalenderScreen;
    use crate::app::AppView;
    use crate::backend::{Backend as _, BackendError, DateRange, MockBackend};
    use crate::screens::Screen;
    use crate::testing;

    fn screen(cx: &mut TestAppContext, app: &Entity<AppView>) -> Entity<KalenderScreen> {
        app.read_with(cx, |a, _| a.view_for(Screen::Kalender))
            .expect("kalender bygget")
            .downcast::<KalenderScreen>()
            .expect("KalenderScreen")
    }

    fn today_entries(mock: &MockBackend) -> Vec<crate::backend::Entry> {
        mock.entries(DateRange::day(testing::today())).unwrap()
    }

    #[gpui_kit::test]
    fn uge_med_poster_og_uden_tidspunkt(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Kalender);
        let a = testing::a11y(cx, h);
        println!("PROBE kalender {:?}", a.roles);
        assert_eq!(a.with_label, a.with_role);
        assert_eq!(a.count("ColumnHeader"), 7);
        assert!(a.has_label("Uge 44 · 26. okt - 1. nov. 2026"));
        assert!(a.has_label_containing("08:30-09:00, 0,5 t, Klinik Søndergade, Booking-modul"));
        assert!(a.has_label_containing("Uden tidspunkt, 0,75 t, Gartneriet Nørrebro"));
        assert!(a.has_label("mandag 26. okt., i dag, 2,5 t"));

        // Dagsvisning og navigation.
        cx.update_window(h, |_, w, cx| w.click("kalender-visning-1", cx)).unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("ColumnHeader"), 1);
        assert!(a.has_label("mandag 26. oktober 2026"));
        cx.update_window(h, |_, w, cx| w.click("kalender-forrige", cx)).unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("søndag 25. oktober 2026"));
    }

    /// ux-vaelger: editorens mål vælges i den fælles vælger, også projekt og opgave.
    #[gpui_kit::test]
    fn editoren_bruger_den_faelles_vaelger(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Kalender);
        let s = screen(cx, &app);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.focus.focus(w, cx));
            w.press("n", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(h, |_, w, cx| w.click("post-kunde", cx)).unwrap();
        cx.run_until_parked();
        assert!(s.read_with(cx, |s, _| s.picking));
        // Esc lukker kun vælgeren, ikke editoren.
        cx.update_window(h, |_, w, cx| w.press("escape", cx)).unwrap();
        cx.run_until_parked();
        assert!(s.read_with(cx, |s, _| !s.picking && s.editor.is_some()));
        cx.update_window(h, |_, w, cx| w.click("post-kunde", cx)).unwrap();
        cx.run_until_parked();
        cx.update_window(h, |_, w, cx| w.input("kurv mobilepay", cx)).unwrap();
        cx.run_until_parked();
        cx.update_window(h, |_, w, cx| w.press("enter", cx)).unwrap();
        cx.run_until_parked();
        let target = s.read_with(cx, |s, _| s.editor.as_ref().and_then(|e| e.target.clone()));
        let target = target.expect("målet er valgt");
        assert_eq!(target.project_id.as_deref(), Some("proj_webshop"));
        assert!(target.task_id.is_some(), "opgaven følger med");
        assert!(testing::a11y(cx, h).has_label_containing("Valgt: Bageriet på Hjørnet · Ny webshop"));
    }

    /// Filteret "Faktureret / Ufaktureret": kalenderen viser kun poster på en
    /// faktura, eller kun dem uden.
    #[gpui_kit::test]
    fn fakturafilter_skjuler_poster_efter_fakturering(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let ids: Vec<_> = mock
            .uninvoiced_entries("kunde_bageriet")
            .unwrap()
            .into_iter()
            .map(|e| e.id)
            .collect();
        let draft = mock.create_invoice_draft("kunde_bageriet", &ids).unwrap();
        let invoiced = mock.invoice_entries(&draft.id).unwrap();
        let day = invoiced
            .iter()
            .map(|e| e.date)
            .min()
            .expect("fakturerede poster");
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Kalender);
        let s = screen(cx, &app);
        cx.update_window(h, |_, _, cx| s.update(cx, |s, cx| s.set_week(true, cx)))
            .unwrap();
        cx.update_window(h, |_, _, cx| s.update(cx, |s, cx| s.show_invoiced(day, cx)))
            .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        let shown = s.read_with(cx, |s, _| s.shown_ids());
        assert!(!shown.is_empty());
        assert!(
            shown
                .iter()
                .all(|id| invoiced.iter().any(|e| &e.id == id) || mock_invoiced(&mock, id))
        );
        // Ufaktureret: ingen af de fakturerede poster.
        cx.update_window(h, |_, w, cx| w.click("kalender-fakturering-1", cx))
            .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        let shown = s.read_with(cx, |s, _| s.shown_ids());
        assert!(shown.iter().all(|id| !invoiced.iter().any(|e| &e.id == id)));
        // Alle: begge slags.
        cx.update_window(h, |_, w, cx| w.click("kalender-fakturering-0", cx))
            .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        let shown = s.read_with(cx, |s, _| s.shown_ids());
        assert!(invoiced.iter().filter(|e| shown.contains(&e.id)).count() > 0);
    }

    fn mock_invoiced(mock: &MockBackend, id: &str) -> bool {
        let wide = DateRange {
            from: testing::today() - chrono::Days::new(120),
            to: testing::today() + chrono::Days::new(120),
        };
        mock.entries(wide)
            .unwrap()
            .iter()
            .any(|e| e.id == id && e.invoice_id.is_some())
    }

    #[gpui_kit::test]
    fn ny_registrering_med_tastatur_og_klippekort(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Kalender);
        let s = screen(cx, &app);
        // Fokus på kalenderen og N.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.focus.focus(w, cx));
            w.press("n", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Ny registrering") && a.count("Dialog") == 1);
        // Slut før start → fejl.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.editor_select_customer("kunde_yoga", w, cx));
            w.click("post-start", cx);
            w.press("cmd-a", cx);
            w.input("10:00", cx);
            w.click("post-slut", cx);
            w.press("cmd-a", cx);
            w.input("9:00", cx);
            w.click("post-editor-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Slut skal være efter start"));
        let used_before = mock.punch_cards(Some("kunde_yoga")).unwrap()[0].used_minutes;
        cx.update_window(h, |_, w, cx| {
            w.click("post-slut", cx);
            w.press("cmd-a", cx);
            w.input("11:30", cx);
            w.click("post-beskrivelse", cx);
            w.input("Holdoversigt, æøå", cx);
            s.update(cx, |s, cx| s.editor_select_card("kort_yoga", w, cx));
            w.click("post-editor-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 0, "editoren lukker");
        assert!(a.has_label("Registreringen er gemt"));
        let e = today_entries(&mock)
            .into_iter()
            .find(|e| e.description == "Holdoversigt, æøå")
            .expect("gemt");
        assert_eq!(e.start, NaiveTime::from_hms_opt(10, 0, 0));
        assert_eq!(e.minutes, 90);
        assert_eq!(
            mock.punch_cards(Some("kunde_yoga")).unwrap()[0].used_minutes,
            used_before + 90
        );
    }

    /// Web's `pickDefaultBillable`: en ny post på en intern kunde er ikke
    /// fakturerbar. Før sendte editoren altid `isBillable: true`.
    #[gpui_kit::test]
    fn ny_post_paa_intern_kunde_er_ikke_fakturerbar(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let yoga = mock.customers(false).unwrap().into_iter().find(|c| c.id == "kunde_yoga").unwrap();
        mock.update_customer(
            "kunde_yoga",
            crate::backend::CustomerInput { name: yoga.name.clone(), internal: true, ..Default::default() },
        )
        .unwrap();
        let other = mock
            .customers(false)
            .unwrap()
            .into_iter()
            .find(|c| !c.internal)
            .expect("en almindelig kunde")
            .id;
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Kalender);
        let s = screen(cx, &app);
        let save = |cx: &mut TestAppContext, customer: &str, text: &str| {
            cx.update_window(h, |_, w, cx| {
                s.update(cx, |s, cx| s.focus.focus(w, cx));
                w.press("n", cx);
            })
            .unwrap();
            cx.run_until_parked();
            cx.update_window(h, |_, w, cx| {
                // Først en almindelig kunde, så den valgte: standarden følger med.
                s.update(cx, |s, cx| s.editor_select_customer(&other, w, cx));
                s.update(cx, |s, cx| s.editor_select_customer(customer, w, cx));
                w.click("post-beskrivelse", cx);
                w.input(text, cx);
                w.click("post-editor-gem", cx);
            })
            .unwrap();
            cx.run_until_parked();
            today_entries(&mock).into_iter().find(|e| e.description == text).expect("gemt")
        };
        assert!(!save(cx, "kunde_yoga", "Intern planlægning").billable);
        assert!(save(cx, &other, "Kundemøde").billable);
    }

    #[gpui_kit::test]
    fn traek_opretter_og_flytter(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Kalender);
        let s = screen(cx, &app);
        // Fast udsnit fra 10:00, så testen ikke afhænger af klokken.
        s.update(cx, |s, _| s.scroll.set_offset(point(px(0.), px(-480.))));
        testing::render(cx, h);
        // Kolonnernes område (indhold, der scroller) i vinduet.
        let bounds = s.read_with(cx, |s, _| s.grid_bounds.get());
        let col_w = f32::from(bounds.size.width) / 7.0;
        let at = |day: usize, minute: f32| {
            point(
                bounds.origin.x + px(col_w * (day as f32 + 0.5)),
                bounds.origin.y + px(minute * 48.0 / 60.0),
            )
        };
        // Opret: træk tirsdag 13:00 → 14:30.
        cx.update_window(h, |_, w, cx| {
            w.pointer_down(at(1, 13.0 * 60.0), MouseButton::Left, cx);
            w.pointer_move(at(1, 14.0 * 60.0), Some(MouseButton::Left), cx);
            w.pointer_move(at(1, 14.5 * 60.0), Some(MouseButton::Left), cx);
            w.pointer_up(at(1, 14.5 * 60.0), MouseButton::Left, cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 1, "træk åbner editoren");
        cx.update_window(h, |_, w, cx| {
            assert_eq!(w.find("post-start").value(), Some("13:00"));
            assert_eq!(w.find("post-slut").value(), Some("14:30"));
            assert_eq!(w.find("post-dato").value(), Some("27.10.2026"));
            w.press("escape", cx);
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 0);

        // Flyt: mandagens 11:15-12:30-post til onsdag 14:00.
        let id = today_entries(&mock)
            .into_iter()
            .find(|e| e.description == "Rettigheder og roller")
            .unwrap()
            .id;
        cx.update_window(h, |_, w, cx| {
            let grab = at(0, 11.0 * 60.0 + 30.0);
            w.pointer_down(grab, MouseButton::Left, cx);
            w.pointer_move(at(1, 13.0 * 60.0), Some(MouseButton::Left), cx);
            w.pointer_move(at(2, 14.0 * 60.0 + 15.0), Some(MouseButton::Left), cx);
            w.pointer_up(at(2, 14.0 * 60.0 + 15.0), MouseButton::Left, cx);
        })
        .unwrap();
        cx.run_until_parked();
        let moved = mock
            .entries(DateRange {
                from: testing::today(),
                to: testing::today() + chrono::Days::new(6),
            })
            .unwrap()
            .into_iter()
            .find(|e| e.id == id)
            .unwrap();
        assert_eq!(moved.date, testing::today() + chrono::Days::new(2));
        assert_eq!(moved.start, NaiveTime::from_hms_opt(14, 0, 0));
        assert_eq!(moved.end, NaiveTime::from_hms_opt(15, 15, 0));
        assert!(testing::a11y(cx, h).has_label_containing("Flyttet til 28.10.2026 14:00-15:15"));

        testing::render(cx, h);
        // Ændr længde: træk bunden af den flyttede post fra 15:15 til 16:00.
        cx.update_window(h, |_, w, cx| {
            let bottom = at(2, 15.0 * 60.0 + 15.0) - point(px(0.), px(5.));
            w.pointer_down(bottom, MouseButton::Left, cx);
            w.pointer_move(at(2, 16.0 * 60.0), Some(MouseButton::Left), cx);
            w.pointer_up(at(2, 16.0 * 60.0), MouseButton::Left, cx);
        })
        .unwrap();
        cx.run_until_parked();
        let resized = mock
            .entries(DateRange::day(testing::today() + chrono::Days::new(2)))
            .unwrap()
            .into_iter()
            .find(|e| e.id == id)
            .unwrap();
        assert_eq!(resized.start, NaiveTime::from_hms_opt(14, 0, 0));
        assert_eq!(resized.end, NaiveTime::from_hms_opt(16, 0, 0));
        assert_eq!(resized.minutes, 120);
    }

    #[gpui_kit::test]
    fn klik_retter_og_slet_kraever_bekraeftelse(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Kalender);
        let id = today_entries(&mock)
            .into_iter()
            .find(|e| e.start.is_none())
            .unwrap()
            .id;
        cx.update_window(h, |_, w, cx| w.click(gpui_kit::SharedString::from(format!("post-{id}")), cx)).unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Ret registrering"));
        cx.update_window(h, |_, w, cx| {
            assert_eq!(w.find("post-timer").value(), Some("0,75"));
            w.click("post-slet", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("AlertDialog"), 1);
        assert!(a.has_label("Det kan ikke fortrydes."));
        // Behold → intet slettet.
        cx.update_window(h, |_, w, cx| w.click("post-slet-behold", cx)).unwrap();
        cx.run_until_parked();
        assert!(today_entries(&mock).iter().any(|e| e.id == id));
        cx.update_window(h, |_, w, cx| {
            w.click("post-slet", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(h, |_, w, cx| w.click("post-slet-bekraeft", cx)).unwrap();
        cx.run_until_parked();
        assert!(!today_entries(&mock).iter().any(|e| e.id == id));
        assert!(testing::a11y(cx, h).has_label("Registreringen er slettet"));
    }

    #[gpui_kit::test]
    fn tom_og_fejl(cx: &mut TestAppContext) {
        let empty = Arc::new(MockBackend::empty(testing::today()));
        let (h, app) = testing::open_app(cx, empty);
        testing::navigate(cx, h, &app, Screen::Kalender);
        assert!(testing::a11y(cx, h).has_label_containing("Ingen registreringer i ugen"));

        let broken = testing::mock();
        broken.set_failure(Some(BackendError::Offline));
        let (h, app) = testing::open_app(cx, broken.clone());
        testing::navigate(cx, h, &app, Screen::Kalender);
        assert!(testing::a11y(cx, h).has_label_containing("Fejl: Du er offline"));
        broken.set_failure(None);
        cx.update_window(h, |_, w, cx| w.click("kalender-igen", cx)).unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label_containing("Klinik Søndergade"));
    }
}
