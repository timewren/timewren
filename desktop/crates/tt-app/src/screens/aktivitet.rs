//! Aktivitet: dagens rå aktivitet som tidslinje og blokke, med handlinger på
//! en eller flere valgte blokke og "Luk dagen".
//!
//! Tastatur (når listen har fokus):
//! - ↑/↓ flytter markøren, Shift+↑/↓ udvider valget, Mellemrum vælger.
//! - ⌘/Ctrl+A vælger alle, Esc rydder valget.
//! - T tildeler, N "ikke arbejde", M fletter, D deler, Delete/Backspace sletter.
//! - ←/→ skifter dag, L åbner "Luk dagen".
//!
//! Rå aktivitet bliver på maskinen (D3); det står øverst på skærmen.

use std::collections::BTreeSet;

use chrono::{Days, NaiveDate, NaiveTime, Timelike};
use gpui_kit::component::button::ButtonVariants;
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{
    ActivityBlock, ActivityDay, ActivityStatus, AssignActivity, Backend, CloseDay, Customer, Id,
    Project, Task,
};
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf, tf_n};
use crate::backend::RuleScope;
use crate::ui::icons::icon;
use crate::ui::maal::{Hint, PickTarget};
use crate::ui::maalvaelger::{TargetPicker, TargetPickerEvent};
use crate::ui::{self, Loadable, Tone, farver, format, pickers};

/// Alt, skærmen viser, hentet i ét kald.
#[derive(Clone, Debug)]
pub struct Data {
    pub today: NaiveDate,
    pub day: ActivityDay,
    pub customers: Vec<Customer>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    /// Dagens kalenderaftaler og ventende møder (kalender).
    pub calendar: Vec<crate::kalenderkilder::DayItem>,
}

impl Data {
    fn load(b: &dyn Backend, date: Option<NaiveDate>) -> crate::backend::Result<Data> {
        let today = b.today();
        let customers = b.customers(true)?;
        let projects = b.projects(None, true)?;
        // kalender: dagens aftaler koblet til kunderne (også uden Hjem først).
        let calendar = crate::kalenderkilder::global()
            .map(|k| {
                k.set_catalog(&customers, &projects);
                k.day_items(date.unwrap_or(today))
            })
            .unwrap_or_default();
        Ok(Data {
            today,
            day: b.activity_day(date.unwrap_or(today))?,
            customers,
            projects,
            tasks: b.tasks(None).unwrap_or_default(),
            calendar,
        })
    }

    fn customer_name(&self, id: &str) -> Option<String> {
        self.customers
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.name.clone())
    }

    fn project_name(&self, id: &str) -> Option<String> {
        self.projects
            .iter()
            .find(|p| p.id == id)
            .map(|p| p.name.clone())
    }

    /// "Bageriet på Hjørnet · Ny webshop", eller `None` uden mål.
    pub fn target_label(&self, customer: Option<&str>, project: Option<&str>) -> Option<String> {
        let c = customer.and_then(|c| self.customer_name(c));
        let p = project.and_then(|p| self.project_name(p));
        match (c, p) {
            (Some(c), Some(p)) => Some(format!("{c} · {p}")),
            (Some(c), None) => Some(c),
            (None, Some(p)) => Some(tf("aktivitet.intern", &[("project", &p)])),
            (None, None) => None,
        }
    }

    /// Kundens farve (grå for intern tid).
    pub fn color_of(&self, customer: Option<&str>) -> Hsla {
        farver::color_in(&self.customers, customer)
    }
}

/// Et mål i "Tildel" (den fælles mål-vælger). Uden kunde = intern tid.
pub type AssignTarget = PickTarget;

/// Den åbne dialog.
#[derive(Clone, Debug, PartialEq)]
pub enum Dialog {
    Assign(Vec<Id>),
    /// "Luk dagen": vælg projekt (og opgave) til en post uden projekt.
    EntryTarget(crate::backend::Entry),
    Split(Id),
    Delete(Vec<Id>),
}

/// "N lignende blokke foreslås nu til X. Tildel dem også?"
#[derive(Clone, Debug, PartialEq)]
pub struct Similar {
    pub ids: Vec<Id>,
    pub target: AssignTarget,
}

pub struct AktivitetScreen {
    ctx: AppCtx,
    pub data: Loadable<Data>,
    /// Den viste dag. `None` = i dag.
    pub date: Option<NaiveDate>,
    pub selected: BTreeSet<Id>,
    /// Markørens række (tastatur).
    pub cursor: Option<usize>,
    anchor: Option<usize>,
    pub dialog: Option<Dialog>,
    pub picker: Entity<TargetPicker>,
    /// "Husk for lignende" i Tildel.
    pub remember: bool,
    /// "Altid sådan": omfangene for de valgte blokke og det valgte.
    pub scopes: Loadable<Vec<RuleScope>>,
    pub scope: Option<usize>,
    /// Reglen er gemt: tilbud om at registrere de matchende blokke bagud.
    pub backward: Option<(RuleScope, AssignTarget)>,
    /// Træk-markering på tidslinjen: blokken, trækket startede på.
    drag_from: Option<usize>,
    split_at: Entity<InputState>,
    split_error: Option<SharedString>,
    /// "Luk dagen": `Some`, mens panelet er åbent.
    pub close_day: Option<Loadable<CloseDay>>,
    pub similar: Option<Similar>,
    pub notice: Option<(SharedString, bool)>,
    busy: bool,
    /// TT_DEMO: skærmbilleder (se `run_demo`).
    demo: Option<String>,
    load_seq: u64,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

/// "1 t 20 min", "35 min", "under 1 min".
pub fn duration(secs: u32) -> String {
    let m = secs / 60;
    match (m / 60, m % 60) {
        (0, 0) => t("aktivitet.dur.under_minut").into(),
        (0, m) => tf("aktivitet.dur.min", &[("m", &m.to_string())]),
        (h, 0) => tf("aktivitet.dur.t", &[("h", &h.to_string())]),
        (h, m) => tf(
            "aktivitet.dur.t_min",
            &[("h", &h.to_string()), ("m", &m.to_string())],
        ),
    }
}

pub fn status_label(s: ActivityStatus) -> &'static str {
    match s {
        ActivityStatus::Registered => t("aktivitet.status.registered"),
        ActivityStatus::Suggested => t("aktivitet.status.suggested"),
        ActivityStatus::Unclear => t("aktivitet.status.unclear"),
        ActivityStatus::NotWork => t("aktivitet.status.not_work"),
        ActivityStatus::Idle => t("aktivitet.status.idle"),
    }
}

fn tone(s: ActivityStatus) -> Tone {
    match s {
        ActivityStatus::Registered => Tone::Primary,
        ActivityStatus::Suggested => Tone::Primary,
        ActivityStatus::Unclear => Tone::Warning,
        ActivityStatus::NotWork | ActivityStatus::Idle => Tone::Neutral,
    }
}

/// Detaljen under appens navn: repo, dokument, domæne eller titel.
pub fn detail(b: &ActivityBlock) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !b.title.is_empty() {
        parts.push(b.title.clone());
    }
    if let Some(r) = &b.repo {
        parts.push(r.clone());
    } else if let Some(d) = &b.domain {
        parts.push(d.clone());
    }
    if let Some(doc) = &b.document
        && !b.title.contains(doc.as_str())
    {
        parts.push(doc.clone());
    }
    parts.join(" · ")
}

/// Skærmlæserens label for en blok.
pub fn block_label(d: &Data, b: &ActivityBlock) -> String {
    let target = d
        .target_label(b.customer_id.as_deref(), b.project_id.as_deref())
        .map(|x| format!(", {x}"))
        .unwrap_or_default();
    let mut parts = vec![format::span(Some(b.start), Some(b.end))];
    // En inaktiv blok har intet program; statussen står til sidst.
    if !b.app.is_empty() {
        parts.push(b.app.clone());
    }
    let det = detail(b);
    if !det.is_empty() {
        parts.push(det);
    }
    parts.push(duration(b.seconds));
    parts.push(status_label(b.status).to_string());
    format!("{}{target}", parts.join(", "))
}

impl AktivitetScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let picker = cx.new(|cx| TargetPicker::new(ctx.clone(), "aktivitet-vaelger", window, cx)
                .compact()
                .without_bare_internal());
        let split_at =
            cx.new(|cx| InputState::new(window, cx).placeholder(t("aktivitet.del.placeholder")));
        let subs = vec![
            cx.observe(&ctx.hub, |this, _, cx| this.reload(cx)),
            cx.subscribe_in(&picker, window, Self::on_picker),
            cx.subscribe_in(&split_at, window, |this, _, ev: &InputEvent, w, cx| {
                if matches!(ev, InputEvent::PressEnter { .. }) {
                    this.submit_split(w, cx);
                }
            }),
        ];
        let mut this = AktivitetScreen {
            ctx,
            data: Loadable::Loading,
            date: None,
            selected: BTreeSet::new(),
            cursor: None,
            anchor: None,
            dialog: None,
            picker,
            remember: true,
            scopes: Loadable::Loading,
            scope: None,
            backward: None,
            drag_from: None,
            split_at,
            split_error: None,
            close_day: None,
            similar: None,
            notice: None,
            busy: false,
            demo: std::env::var("TT_DEMO").ok().filter(|d| {
                ["lukdagen", "aktivitet-valg", "aktivitet-tildel", "aktivitet-altid"]
                    .iter()
                    .any(|k| d.contains(k))
            }),
            load_seq: 0,
            focus: cx.focus_handle(),
            _subs: subs,
        };
        this.reload(cx);
        // Panelet hentes sammen med dagen, så det er klar i første billede.
        if this.demo.as_deref().is_some_and(|d| d.contains("lukdagen")) {
            this.open_close_day(cx);
        }
        this
    }

    /// Skærmbilleder: `TT_DEMO=…,lukdagen`, `…,aktivitet-valg` eller
    /// `…,aktivitet-tildel`. Køres, når data er hentet.
    fn run_demo(&mut self, demo: &str, window: &mut Window, cx: &mut Context<Self>) {
        if demo.contains("aktivitet-altid") {
            // Den første blok med et tydeligt domæne: repo/mappe/domæne at vælge imellem.
            let first = self.blocks().iter().position(|b| b.domain.is_some() || b.repo.is_some());
            if let Some(i) = first {
                self.toggle(i, false, cx);
            }
            self.open_assign(window, cx);
            return;
        }
        if demo.contains("aktivitet-valg") || demo.contains("aktivitet-tildel") {
            self.select_status(ActivityStatus::Unclear, cx);
        }
        if demo.contains("aktivitet-tildel") {
            self.open_assign(window, cx);
        }
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }

    pub fn reload(&mut self, cx: &mut Context<Self>) {
        self.load_seq += 1;
        let seq = self.load_seq;
        let date = self.date;
        self.ctx.fetch(
            cx,
            move |b| Data::load(b, date),
            move |this, res, cx| {
                if seq != this.load_seq {
                    return;
                }
                this.data = match (res, std::mem::take(&mut this.data)) {
                    (Ok(d), _) => {
                        // Valg af blokke, der ikke findes mere, ryddes.
                        this.selected
                            .retain(|id| d.day.blocks.iter().any(|b| &b.id == id));
                        if let Some(c) = this.cursor {
                            this.cursor =
                                (!d.day.blocks.is_empty()).then(|| c.min(d.day.blocks.len() - 1));
                        }
                        Loadable::Ready(d)
                    }
                    (Err(e), Loadable::Ready(old)) => {
                        this.notice = Some((e.to_string().into(), true));
                        Loadable::Ready(old)
                    }
                    (Err(e), _) => Loadable::Failed(e.to_string().into()),
                };
                if this.close_day.is_some() {
                    this.load_close_day(cx);
                }
            },
        );
    }

    fn shown_date(&self) -> Option<NaiveDate> {
        self.data.ready().map(|d| d.day.date)
    }

    fn blocks(&self) -> Vec<ActivityBlock> {
        self.data
            .ready()
            .map(|d| d.day.blocks.clone())
            .unwrap_or_default()
    }

    /// Det, en handling gælder: de valgte blokke, ellers markørens.
    pub fn targets_of_action(&self) -> Vec<ActivityBlock> {
        let blocks = self.blocks();
        if !self.selected.is_empty() {
            return blocks
                .into_iter()
                .filter(|b| self.selected.contains(&b.id))
                .collect();
        }
        self.cursor
            .and_then(|c| blocks.get(c).cloned())
            .into_iter()
            .collect()
    }

    // ---------- dag ----------

    pub fn go_day(&mut self, delta: i64, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let current = d.day.date;
        let next = if delta < 0 {
            current.checked_sub_days(Days::new(delta.unsigned_abs()))
        } else {
            current.checked_add_days(Days::new(delta as u64))
        };
        let Some(next) = next else {
            return;
        };
        if next < d.day.earliest || next > d.today {
            return;
        }
        self.date = (next != d.today).then_some(next);
        self.selected.clear();
        self.cursor = None;
        self.similar = None;
        self.notice = None;
        self.reload(cx);
    }

    pub fn go_today(&mut self, cx: &mut Context<Self>) {
        self.date = None;
        self.selected.clear();
        self.cursor = None;
        self.similar = None;
        self.reload(cx);
    }

    // ---------- valg ----------

    pub fn toggle(&mut self, ix: usize, extend: bool, cx: &mut Context<Self>) {
        let blocks = self.blocks();
        let Some(b) = blocks.get(ix) else {
            return;
        };
        if extend && let Some(a) = self.anchor.or(self.cursor) {
            let (lo, hi) = (a.min(ix), a.max(ix));
            for x in &blocks[lo..=hi] {
                self.selected.insert(x.id.clone());
            }
        } else if !self.selected.remove(&b.id) {
            self.selected.insert(b.id.clone());
            self.anchor = Some(ix);
        }
        self.cursor = Some(ix);
        cx.notify();
    }

    pub fn select_all(&mut self, cx: &mut Context<Self>) {
        self.selected = self.blocks().into_iter().map(|b| b.id).collect();
        cx.notify();
    }

    pub fn select_status(&mut self, status: ActivityStatus, cx: &mut Context<Self>) {
        self.selected = self
            .blocks()
            .into_iter()
            .filter(|b| b.status == status)
            .map(|b| b.id)
            .collect();
        self.cursor = self
            .blocks()
            .iter()
            .position(|b| self.selected.contains(&b.id));
        cx.notify();
    }

    pub fn clear_selection(&mut self, cx: &mut Context<Self>) {
        self.selected.clear();
        self.anchor = None;
        cx.notify();
    }

    fn move_cursor(&mut self, delta: i64, extend: bool, cx: &mut Context<Self>) {
        let n = self.blocks().len();
        if n == 0 {
            return;
        }
        let from = self.cursor.unwrap_or(if delta > 0 { n - 1 } else { 0 });
        let to = if self.cursor.is_none() {
            if delta > 0 { 0 } else { n - 1 }
        } else {
            (from as i64 + delta).clamp(0, n as i64 - 1) as usize
        };
        if extend {
            let anchor = *self.anchor.get_or_insert(from);
            let blocks = self.blocks();
            let (lo, hi) = (anchor.min(to), anchor.max(to));
            self.selected = blocks[lo..=hi].iter().map(|b| b.id.clone()).collect();
        }
        self.cursor = Some(to);
        cx.notify();
    }

    // ---------- handlinger ----------

    fn run<T: Send + 'static>(
        &mut self,
        cx: &mut Context<Self>,
        done_msg: Option<String>,
        op: impl FnOnce(&dyn Backend) -> crate::backend::Result<T> + Send + 'static,
    ) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.notice = None;
        self.ctx.mutate(cx, op, move |this, res, _| {
            this.busy = false;
            match res {
                Ok(_) => {
                    this.selected.clear();
                    this.anchor = None;
                    this.notice = done_msg.map(|m| (m.into(), false));
                }
                Err(e) => this.notice = Some((e.to_string().into(), true)),
            }
        });
    }

    fn date_or_today(&self) -> Option<NaiveDate> {
        self.shown_date()
    }

    pub fn open_assign(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ids: Vec<Id> = self
            .targets_of_action()
            .into_iter()
            .filter(|b| !matches!(b.status, ActivityStatus::Registered | ActivityStatus::Idle))
            .map(|b| b.id)
            .collect();
        if ids.is_empty() {
            self.notice = Some((t("aktivitet.tildel.intet").into(), true));
            cx.notify();
            return;
        }
        let hints = self.hints_for(&ids);
        self.load_scopes(ids.clone(), cx);
        let secs: u32 = self
            .blocks()
            .iter()
            .filter(|b| ids.contains(&b.id))
            .map(|b| b.seconds)
            .sum();
        let title = tf_n("aktivitet.tildel.titel_n", ids.len(), &[("tid", &duration(secs))]);
        self.dialog = Some(Dialog::Assign(ids));
        self.picker.update(cx, |p, cx| p.open(title, hints, window, cx));
        cx.notify();
    }

    /// "Luk dagen": åbn vælgeren i postens kundes projekter.
    pub fn open_entry_target(&mut self, e: crate::backend::Entry, window: &mut Window, cx: &mut Context<Self>) {
        let view = crate::ui::maal::View::Customer(e.customer_id.clone());
        let title = t("maal.luk.vaelg_projekt");
        self.dialog = Some(Dialog::EntryTarget(e));
        self.picker.update(cx, |p, cx| p.open_in(title, vec![], view, window, cx));
        cx.notify();
    }

    fn set_entry_target(&mut self, e: crate::backend::Entry, target: AssignTarget, cx: &mut Context<Self>) {
        let input = crate::backend::EntryInput {
            customer_id: target.customer_or_empty(),
            project_id: target.project_id,
            task_id: target.task_id,
            description: e.description,
            date: e.date,
            start: e.start,
            end: e.end,
            minutes: e.minutes,
            billable: e.billable,
        };
        let id = e.id;
        self.run(cx, Some(t("maal.luk.gemt").to_string()), move |b| b.update_entry(&id, input));
    }

    /// Detektionens forslag for blokkene øverst i vælgeren, med begrundelsen.
    pub fn hints_for(&self, ids: &[Id]) -> Vec<Hint> {
        let mut out: Vec<Hint> = Vec::new();
        for b in self.blocks().iter().filter(|b| ids.contains(&b.id)) {
            if b.customer_id.is_none() && b.project_id.is_none() {
                continue;
            }
            let target = PickTarget::from_parts(b.customer_id.as_deref(), b.project_id.as_deref(), None);
            if out.iter().any(|h| h.target == target) {
                continue;
            }
            let reason = b.repo.clone().or_else(|| b.domain.clone()).unwrap_or_else(|| detail(b));
            out.push(Hint { target, reason });
        }
        out
    }

    fn load_scopes(&mut self, ids: Vec<Id>, cx: &mut Context<Self>) {
        self.scopes = Loadable::Loading;
        self.scope = None;
        let Some(date) = self.date_or_today() else {
            return;
        };
        // Skærmbilleder: demoen åbner dialogen midt i en tegning, hvor en
        // hentning først kører ved næste frame. Demoens data er i hukommelsen.
        if std::env::var("TT_DEMO").is_ok_and(|d| d.contains("aktivitet-altid")) {
            let v = self.ctx.backend.rule_scopes(date, &ids).unwrap_or_default();
            self.scope = v.iter().position(|s| s.kind == crate::backend::ScopeKind::Repo);
            self.scopes = Loadable::Ready(v);
            return;
        }
        self.ctx.fetch(
            cx,
            move |b| b.rule_scopes(date, &ids),
            move |this, res, _| {
                this.scopes = match res {
                    Ok(v) => Loadable::Ready(v),
                    Err(e) => Loadable::Failed(e.to_string().into()),
                };
            },
        );
    }

    fn chosen_scope(&self) -> Option<RuleScope> {
        self.scopes.ready().and_then(|v| v.get(self.scope?).cloned())
    }

    pub fn choose_scope(&mut self, ix: Option<usize>, cx: &mut Context<Self>) {
        let n = self.scopes.ready().map_or(0, Vec::len);
        self.scope = ix.filter(|i| *i < n);
        cx.notify();
    }

    /// Ét tryk: bekræft forslagene i de valgte blokke (eller markørens).
    pub fn confirm_chosen(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<Id> = self
            .targets_of_action()
            .into_iter()
            .filter(|b| b.status == ActivityStatus::Suggested)
            .filter_map(|b| b.suggestion_id)
            .collect();
        if ids.is_empty() {
            self.notice = Some((t("maal.bekraeft.intet").into(), true));
            cx.notify();
            return;
        }
        let msg = tf("maal.bekraeft.gemt", &[("n", &ids.len().to_string())]);
        self.run(cx, Some(msg), move |b| {
            for id in &ids {
                b.confirm_suggestion(id, None)?;
            }
            Ok(())
        });
    }

    /// "Registrér dem": reglen gælder også de sidste 14 dage.
    pub fn apply_backward(&mut self, cx: &mut Context<Self>) {
        let Some((scope, target)) = self.backward.take() else {
            return;
        };
        if self.busy {
            return;
        }
        self.busy = true;
        self.notice = None;
        self.ctx.mutate(
            cx,
            move |b| b.apply_rule_backward(&scope, target.customer_id.clone(), target.project_id.clone()),
            |this, res, _| {
                this.busy = false;
                this.notice = Some(match res {
                    Ok(r) if r.entries == 0 => (t("maal.bagud.ingen").into(), false),
                    Ok(r) => (
                        tf(
                            "maal.bagud.gemt",
                            &[("n", &r.entries.to_string()), ("tid", &format::hours(r.minutes))],
                        )
                        .into(),
                        false,
                    ),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    /// Træk på tidslinjen: start (musen ned på blok `i`).
    fn drag_start(&mut self, i: usize, extend: bool, cx: &mut Context<Self>) {
        let Some(b) = self.blocks().get(i).cloned() else {
            return;
        };
        self.drag_from = Some(i);
        if !extend {
            self.selected.clear();
        }
        self.selected.insert(b.id);
        self.anchor = Some(i);
        self.cursor = Some(i);
        cx.notify();
    }

    /// Træk på tidslinjen: musen er over blok `i` med knappen nede.
    pub fn drag_over(&mut self, i: usize, cx: &mut Context<Self>) {
        let Some(from) = self.drag_from else {
            return;
        };
        let blocks = self.blocks();
        let (lo, hi) = (from.min(i), from.max(i).min(blocks.len().saturating_sub(1)));
        self.selected = blocks[lo..=hi]
            .iter()
            .filter(|b| b.status != ActivityStatus::Idle)
            .map(|b| b.id.clone())
            .collect();
        self.cursor = Some(i);
        cx.notify();
    }

    fn drag_end(&mut self, cx: &mut Context<Self>) {
        if self.drag_from.take().is_some() && self.selected.len() > 1 {
            self.notice = Some((
                tf("maal.traek.markeret", &[("n", &self.selected.len().to_string())]).into(),
                false,
            ));
            cx.notify();
        }
    }

    fn on_picker(
        &mut self,
        _: &Entity<TargetPicker>,
        ev: &TargetPickerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match ev {
            TargetPickerEvent::Dismissed => self.close_dialog(window, cx),
            TargetPickerEvent::Picked(target) => {
                match self.dialog.clone() {
                    Some(Dialog::Assign(ids)) => {
                        let scope = self.chosen_scope();
                        self.assign_with(ids, target.clone(), self.remember, scope, cx);
                    }
                    Some(Dialog::EntryTarget(e)) => self.set_entry_target(e, target.clone(), cx),
                    _ => {}
                }
                self.close_dialog(window, cx);
            }
        }
    }

    pub fn assign(&mut self, ids: Vec<Id>, target: AssignTarget, remember: bool, cx: &mut Context<Self>) {
        self.assign_with(ids, target, remember, None, cx);
    }

    /// Tildel, og gem eventuelt "Altid sådan"-reglen for `scope`.
    pub fn assign_with(
        &mut self,
        ids: Vec<Id>,
        target: AssignTarget,
        remember: bool,
        scope: Option<RuleScope>,
        cx: &mut Context<Self>,
    ) {
        let Some(date) = self.date_or_today() else {
            return;
        };
        if self.busy {
            return;
        }
        self.busy = true;
        self.notice = None;
        self.similar = None;
        self.backward = None;
        let input = AssignActivity {
            block_ids: ids,
            customer_id: target.customer_or_empty(),
            project_id: target.project_id.clone(),
            task_id: target.task_id.clone(),
            description: String::new(),
            billable: true,
            remember,
        };
        let rule_target = target.clone();
        self.ctx.mutate(
            cx,
            move |b| {
                let out = b.assign_activity(date, input)?;
                // Reglen gemmes efter posterne: fejler den, er tiden stadig registreret.
                let rule = scope.map(|s| {
                    let saved = b.create_rule(&s, rule_target.customer_id.clone(), rule_target.project_id.clone());
                    (s, saved)
                });
                Ok((out, rule))
            },
            move |this, res, _| {
                this.busy = false;
                match res {
                    Ok((out, rule)) => {
                        match rule {
                            Some((s, Ok(_))) if s.recent > s.today => {
                                this.backward = Some((s, target.clone()));
                            }
                            Some((_, Err(e))) => {
                                this.notice = Some((e.to_string().into(), true));
                                return;
                            }
                            _ => {}
                        }
                        this.selected.clear();
                        this.anchor = None;
                        let minutes: u32 = out.entries.iter().map(|e| e.minutes).sum();
                        this.notice = Some((
                            tf(
                                "aktivitet.tildel.gemt",
                                &[
                                    ("n", &out.entries.len().to_string()),
                                    ("tid", &format::hours(minutes)),
                                ],
                            )
                            .into(),
                            false,
                        ));
                        if !out.similar.is_empty() {
                            this.similar = Some(Similar {
                                ids: out.similar,
                                target,
                            });
                        }
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
            },
        );
    }

    pub fn assign_similar(&mut self, cx: &mut Context<Self>) {
        if let Some(s) = self.similar.take() {
            self.assign(s.ids, s.target, false, cx);
        }
    }

    pub fn not_work(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<Id> = self
            .targets_of_action()
            .into_iter()
            .filter(|b| !matches!(b.status, ActivityStatus::Registered | ActivityStatus::Idle))
            .map(|b| b.id)
            .collect();
        let Some(date) = self.date_or_today() else {
            return;
        };
        if ids.is_empty() {
            return;
        }
        let msg = tf_n("aktivitet.ikke_arbejde.gemt", ids.len(), &[]);
        self.run(cx, Some(msg), move |b| b.activity_not_work(date, &ids));
    }

    pub fn merge(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<Id> = self.targets_of_action().into_iter().map(|b| b.id).collect();
        let Some(date) = self.date_or_today() else {
            return;
        };
        if ids.len() < 2 {
            self.notice = Some((t("aktivitet.flet.to").into(), true));
            cx.notify();
            return;
        }
        self.run(cx, Some(t("aktivitet.flet.gemt").into()), move |b| {
            b.merge_activity(date, &ids)
        });
    }

    pub fn open_split(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let blocks = self.targets_of_action();
        let [block] = blocks.as_slice() else {
            self.notice = Some((t("aktivitet.del.en").into(), true));
            cx.notify();
            return;
        };
        // Forslag: midt i blokken, rundet til hele minutter.
        let mid = block.start + (block.end - block.start) / 2;
        let mid = mid.with_second(0).unwrap_or(mid);
        self.split_at
            .update(cx, |s, cx| s.set_value(format::time(mid), window, cx));
        self.split_error = None;
        self.dialog = Some(Dialog::Split(block.id.clone()));
        self.split_at.read(cx).focus_handle(cx).focus(window, cx);
        cx.notify();
    }

    pub fn submit_split(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Dialog::Split(id)) = self.dialog.clone() else {
            return;
        };
        let Some(block) = self.blocks().into_iter().find(|b| b.id == id) else {
            self.close_dialog(window, cx);
            return;
        };
        let raw = self.split_at.read(cx).value().to_string();
        let at = format::parse_time(&raw);
        let Some(at) = at.filter(|a| block.start < *a && *a < block.end) else {
            self.split_error = Some(
                tf(
                    "aktivitet.del.ugyldig",
                    &[("span", &format::span(Some(block.start), Some(block.end)))],
                )
                .into(),
            );
            cx.notify();
            return;
        };
        let Some(date) = self.date_or_today() else {
            return;
        };
        self.close_dialog(window, cx);
        self.run(cx, Some(t("aktivitet.del.gemt").into()), move |b| {
            b.split_activity(date, &id, at)
        });
    }

    pub fn open_delete(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<Id> = self.targets_of_action().into_iter().map(|b| b.id).collect();
        if ids.is_empty() {
            return;
        }
        self.dialog = Some(Dialog::Delete(ids));
        cx.notify();
    }

    pub fn confirm_delete(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Dialog::Delete(ids)) = self.dialog.clone() else {
            return;
        };
        let Some(date) = self.date_or_today() else {
            return;
        };
        self.close_dialog(window, cx);
        let msg = tf_n("aktivitet.slet.gemt", ids.len(), &[]);
        self.run(cx, Some(msg), move |b| b.delete_activity(date, &ids));
    }

    pub fn confirm_suggestion(&mut self, id: Id, cx: &mut Context<Self>) {
        self.run(cx, Some(t("aktivitet.bekraeftet").into()), move |b| {
            b.confirm_suggestion(&id, None)
        });
    }

    pub fn close_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.dialog = None;
        self.split_error = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    // ---------- Luk dagen ----------

    pub fn open_close_day(&mut self, cx: &mut Context<Self>) {
        self.close_day = Some(Loadable::Loading);
        self.load_close_day(cx);
        cx.notify();
    }

    fn load_close_day(&mut self, cx: &mut Context<Self>) {
        let date = self.date;
        self.ctx.fetch(
            cx,
            move |b| b.close_day(date.unwrap_or_else(|| b.today())),
            |this, res, _| {
                if this.close_day.is_none() {
                    return;
                }
                this.close_day = Some(match res {
                    Ok(c) => Loadable::Ready(c),
                    Err(e) => Loadable::Failed(e.to_string().into()),
                });
            },
        );
    }

    pub fn confirm_all(&mut self, cx: &mut Context<Self>) {
        let Some(date) = self.date_or_today() else {
            return;
        };
        let n = self
            .close_day
            .as_ref()
            .and_then(|c| c.ready())
            .map_or(0, |c| c.suggestions.len());
        let msg = tf("aktivitet.luk.bekraeftet", &[("n", &n.to_string())]);
        self.run(cx, Some(msg), move |b| b.confirm_day(date));
    }

    // ---------- tastatur ----------

    fn on_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.dialog.is_some() || !self.focus.is_focused(window) {
            return;
        }
        let m = &ev.keystroke.modifiers;
        let key = ev.keystroke.key.as_str();
        if (m.platform || m.control) && key == "a" {
            self.select_all(cx);
            cx.stop_propagation();
            return;
        }
        if m.platform || m.control || m.alt {
            return;
        }
        match key {
            "down" => self.move_cursor(1, m.shift, cx),
            "up" => self.move_cursor(-1, m.shift, cx),
            "space" => {
                if let Some(c) = self.cursor {
                    self.toggle(c, false, cx);
                } else {
                    self.move_cursor(1, false, cx);
                }
            }
            "escape" => self.clear_selection(cx),
            "left" => self.go_day(-1, cx),
            "right" => self.go_day(1, cx),
            "t" => self.open_assign(window, cx),
            "b" | "enter" => self.confirm_chosen(cx),
            "n" => self.not_work(cx),
            "m" => self.merge(cx),
            "d" => self.open_split(window, cx),
            "l" => self.open_close_day(cx),
            "delete" | "backspace" => self.open_delete(cx),
            _ => return,
        }
        cx.stop_propagation();
    }

    // ---------- tegning ----------

    fn render_toolbar(&self, d: &Data, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement {
        let date = d.day.date;
        let can_back = date > d.day.earliest;
        let can_fwd = date < d.today;
        h_flex()
            .id("aktivitet-vaerktoej")
            .gap_2()
            .items_center()
            .child(ui::a11y_button(
                "aktivitet-forrige",
                t("aktivitet.dag.forrige"),
                !can_back,
                |b| b.outline().small(),
                cx.listener(|this, _, _, cx| this.go_day(-1, cx)),
            ))
            .child(ui::a11y_button(
                "aktivitet-i-dag",
                t("aktivitet.dag.i_dag"),
                date == d.today,
                |b| b.outline().small(),
                cx.listener(|this, _, _, cx| this.go_today(cx)),
            ))
            .child(ui::a11y_button(
                "aktivitet-naeste",
                t("aktivitet.dag.naeste"),
                !can_fwd,
                |b| b.outline().small(),
                cx.listener(|this, _, _, cx| this.go_day(1, cx)),
            ))
            .child(ui::muted(
                b,
                "aktivitet-opbevaring",
                tf(
                    "aktivitet.dag.opbevaring",
                    &[("dato", &format::date_short(d.day.earliest))],
                ),
            ))
            .child(div().flex_1())
            .child(ui::a11y_button(
                "aktivitet-luk-dagen",
                t("aktivitet.luk.knap"),
                false,
                |b| b.primary().small(),
                cx.listener(|this, _, _, cx| this.open_close_day(cx)),
            ))
    }

    fn render_summary(&self, d: &Data, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex()
            .id("aktivitet-oversigt")
            .gap_2()
            .flex_wrap()
            .children(ActivityStatus::ALL.into_iter().filter_map(|s| {
                let (n, secs) = d.day.total(s);
                (n > 0).then(|| {
                    let label = tf(
                        "aktivitet.oversigt.punkt",
                        &[("status", status_label(s)), ("tid", &duration(secs))],
                    );
                    ui::badge(
                        b,
                        SharedString::from(format!("oversigt-{}", s.key())),
                        label,
                        tone(s),
                    )
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| this.select_status(s, cx)))
                })
            }))
    }

    fn render_timeline(&self, d: &Data, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement {
        let blocks = &d.day.blocks;
        let hour = |t: NaiveTime| t.hour() as f32 + t.minute() as f32 / 60.0;
        let first = blocks
            .first()
            .map_or(7.0, |x| hour(x.start).floor())
            .min(7.0);
        let last = blocks.last().map_or(19.0, |x| hour(x.end).ceil()).max(19.0);
        let span = (last - first).max(1.0);
        let pos = move |h: f32| ((h - first) / span).clamp(0.0, 1.0);
        let label = tf_n("aktivitet.tidslinje.label", blocks.len(), &[]);
        let bar = ui::el("aktivitet-tidslinje", Role::Image, label)
            .relative()
            .h(px(40.))
            .rounded(px(6.))
            .bg(b.surface)
            .border_1()
            .border_color(b.border)
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _, _, cx| this.drag_end(cx)))
            .on_mouse_up_out(MouseButton::Left, cx.listener(|this, _, _, cx| this.drag_end(cx)))
            .children(blocks.iter().enumerate().map(|(i, x)| {
                // Kundens farve (web's) på registrerede og foreslåede blokke.
                let color = d.color_of(x.customer_id.as_deref());
                let (bg, border) = match x.status {
                    ActivityStatus::Registered => (color, color),
                    ActivityStatus::Suggested => (color.opacity(0.3), color),
                    ActivityStatus::Unclear => (b.warning.opacity(0.35), b.warning),
                    ActivityStatus::NotWork => (b.border, b.grey),
                    ActivityStatus::Idle => (b.surface, b.border),
                };
                let selected = self.selected.contains(&x.id);
                div()
                    .absolute()
                    .top(px(6.))
                    .bottom(px(6.))
                    .left(relative(pos(hour(x.start))))
                    .w(relative((pos(hour(x.end)) - pos(hour(x.start))).max(0.002)))
                    .rounded(px(3.))
                    .bg(bg)
                    .border_1()
                    .border_color(if selected { b.ink } else { border })
                    .when(selected, |d| d.border_2())
                    .when(x.status == ActivityStatus::Suggested, |d| d.border_dashed())
                    .cursor_pointer()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, ev: &MouseDownEvent, w, cx| {
                            this.focus.focus(w, cx);
                            this.drag_start(i, ev.modifiers.shift, cx);
                        }),
                    )
                    .on_mouse_move(cx.listener(move |this, ev: &MouseMoveEvent, _, cx| {
                        if ev.pressed_button == Some(MouseButton::Left) {
                            this.drag_over(i, cx);
                        }
                    }))
            }));
        let ticks = ((first as u32)..=(last as u32)).step_by(2);
        v_flex()
            .gap_1()
            .child(bar)
            .child(
                h_flex()
                    .justify_between()
                    .text_xs()
                    .text_color(b.grey)
                    .children(ticks.map(|h| div().child(format!("{h:02}")))),
            )
            .child(ui::muted(b, "aktivitet-tidslinje-hjaelp", t("maal.tidslinje.hjaelp")).text_xs())
    }

    fn render_close_day(&self, b: &Brand, cx: &mut Context<Self>) -> Option<AnyElement> {
        let state = self.close_day.as_ref()?;
        let d = self.data.ready()?;
        let close = ui::a11y_button(
            "luk-dagen-luk",
            t("aktivitet.luk.skjul"),
            false,
            |b| b.ghost().small(),
            cx.listener(|this, _, _, cx| {
                this.close_day = None;
                cx.notify();
            }),
        );
        let card = ui::titled_card(b, "luk-dagen", t("aktivitet.luk.titel"), close);
        let body = match state {
            Loadable::Loading => {
                ui::loading_state(b, "luk-dagen-indlaeser", t("aktivitet.luk.titel"))
                    .into_any_element()
            }
            Loadable::Failed(e) => {
                ui::error_state(b, "luk-dagen-fejl", e.clone()).into_any_element()
            }
            Loadable::Ready(c) if c.is_done() => {
                ui::text("luk-dagen-faerdig", t("aktivitet.luk.faerdig"))
                    .text_sm()
                    .text_color(b.primary)
                    .into_any_element()
            }
            Loadable::Ready(c) => {
                let sug_minutes: u32 = c.suggestions.iter().map(|s| s.minutes()).sum();
                let sug = (!c.suggestions.is_empty()).then(|| {
                    v_flex()
                        .gap_1()
                        .child(
                            h_flex()
                                .gap_3()
                                .items_center()
                                .child(
                                    ui::text(
                                        "luk-dagen-forslag",
                                        tf(
                                            "aktivitet.luk.forslag",
                                            &[
                                                ("n", &c.suggestions.len().to_string()),
                                                ("tid", &format::hours(sug_minutes)),
                                            ],
                                        ),
                                    )
                                    .flex_1()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM),
                                )
                                .child(ui::a11y_button(
                                    "luk-dagen-bekraeft-alle",
                                    tf(
                                        "aktivitet.luk.bekraeft_alle",
                                        &[("n", &c.suggestions.len().to_string())],
                                    ),
                                    self.busy,
                                    |b| b.primary().small(),
                                    cx.listener(|this, _, _, cx| this.confirm_all(cx)),
                                )),
                        )
                        .child(
                            ui::list("luk-dagen-forslag-liste", t("aktivitet.luk.forslag_liste"))
                                .children(c.suggestions.iter().enumerate().map(|(i, s)| {
                                    let target = d
                                        .target_label(
                                            s.customer_id.as_deref(),
                                            s.project_id.as_deref(),
                                        )
                                        .unwrap_or_else(|| t("aktivitet.intern_tid").into());
                                    let line = format!(
                                        "{} {target} ({})",
                                        format::span(Some(s.start), Some(s.end)),
                                        format::hours(s.minutes())
                                    );
                                    ui::list_row(b, ("luk-dagen-forslag", i), line.clone())
                                        .py_0p5()
                                        .text_color(b.grey)
                                        .child(line)
                                })),
                        )
                });
                let unclear = (c.unclear_blocks > 0).then(|| {
                    h_flex()
                        .gap_3()
                        .items_center()
                        .child(
                            ui::text(
                                "luk-dagen-uklar",
                                tf_n(
                                    "aktivitet.luk.uklar",
                                    c.unclear_blocks,
                                    &[("tid", &duration(c.unclear_seconds))],
                                ),
                            )
                            .flex_1()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM),
                        )
                        .child(ui::a11y_button(
                            "luk-dagen-vis-uklare",
                            t("aktivitet.luk.vaelg_uklare"),
                            false,
                            |b| b.outline().small(),
                            cx.listener(|this, _, _, cx| {
                                this.select_status(ActivityStatus::Unclear, cx)
                            }),
                        ))
                });
                let without = (!c.without_project.is_empty()).then(|| {
                    v_flex()
                        .gap_1()
                        .child(
                            ui::text(
                                "luk-dagen-uden-projekt",
                                tf(
                                    "aktivitet.luk.uden_projekt",
                                    &[("n", &c.without_project.len().to_string())],
                                ),
                            )
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM),
                        )
                        .child(
                            ui::list(
                                "luk-dagen-uden-projekt-liste",
                                t("aktivitet.luk.uden_projekt_liste"),
                            )
                            .children(
                                c.without_project.iter().enumerate().map(|(i, e)| {
                                    let who = d.customer_name(&e.customer_id).unwrap_or_default();
                                    let line = format!(
                                        "{} {who} · {} ({})",
                                        format::span(e.start, e.end),
                                        e.description,
                                        format::hours(e.minutes)
                                    );
                                    let entry = e.clone();
                                    ui::list_row(b, ("luk-dagen-post", i), line.clone())
                                        .py_0p5()
                                        .text_color(b.grey)
                                        .child(div().flex_1().min_w_0().truncate().child(line))
                                        .child(ui::a11y_button(
                                            SharedString::from(format!("luk-dagen-post-{i}-projekt")),
                                            t("maal.luk.vaelg_projekt"),
                                            self.busy,
                                            |b| b.outline().small(),
                                            cx.listener(move |this, _, w, cx| this.open_entry_target(entry.clone(), w, cx)),
                                        ))
                                }),
                            ),
                        )
                        .child(ui::muted(
                            b,
                            "luk-dagen-uden-projekt-hjaelp",
                            t("aktivitet.luk.uden_projekt_hjaelp"),
                        ))
                });
                let question = c.question.as_ref().map(|q| self.render_close_day_question(d, b, q, cx));
                v_flex()
                    .gap_3()
                    .children(sug)
                    .children(unclear)
                    .children(question)
                    .children(without)
                    .into_any_element()
            }
        };
        Some(card.child(body).into_any_element())
    }

    /// Luk dagen: det ene spørgsmål, hvis svar løser mest. Samme svar som
    /// kortet "Lær TimeTrack at kende" (Ja / Spring over); resten af
    /// valgene står på kortet.
    fn render_close_day_question(
        &self,
        d: &Data,
        b: &Brand,
        q: &crate::backend::ObserverGroup,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use crate::backend::ObserverReply;
        let suggested = q
            .customer_id
            .as_deref()
            .and_then(|c| d.target_label(Some(c), q.project_id.as_deref()));
        let mut text = v_flex()
            .flex_1()
            .min_w_0()
            .gap_0p5()
            .child(
                ui::text("luk-dagen-spoergsmaal-titel", t("aktivitet.luk.spoergsmaal"))
                    .text_xs()
                    .text_color(b.grey),
            )
            .child(
                ui::text(
                    "luk-dagen-spoergsmaal",
                    crate::screens::hjem::laer::question_text(q),
                )
                .text_sm()
                .font_weight(FontWeight::MEDIUM),
            );
        if let Some(name) = &suggested {
            text = text.child(
                ui::text("luk-dagen-er-det", tf("observer.er_det", &[("maal", name)])).text_sm(),
            );
        }
        let mut row = h_flex().gap_3().items_center().child(text);
        if let (Some(name), Some(customer)) = (suggested, q.customer_id.clone()) {
            let id = q.id.clone();
            let project = q.project_id.clone();
            row = row.child(ui::a11y_button(
                "luk-dagen-ja",
                tf("observer.ja", &[("maal", &name)]),
                self.busy,
                |b| b.primary().small(),
                cx.listener(move |this, _, _, cx| {
                    let (id, reply) = (
                        id.clone(),
                        ObserverReply::Target {
                            customer_id: customer.clone(),
                            project_id: project.clone(),
                        },
                    );
                    this.run(cx, None, move |b| b.answer_observer(&id, reply));
                }),
            ));
        }
        let id = q.id.clone();
        row.child(ui::a11y_button(
            "luk-dagen-spring",
            t("observer.spring_over"),
            self.busy,
            |b| b.ghost().small(),
            cx.listener(move |this, _, _, cx| {
                let id = id.clone();
                this.run(cx, None, move |b| b.answer_observer(&id, ObserverReply::Skip));
            }),
        ))
        .into_any_element()
    }

    fn render_similar(
        &self,
        d: &Data,
        b: &Brand,
        cx: &mut Context<Self>,
    ) -> Option<impl IntoElement> {
        let s = self.similar.as_ref()?;
        let target = d
            .target_label(s.target.customer_id.as_deref(), s.target.project_id.as_deref())
            .unwrap_or_default();
        let msg = tf(
            "aktivitet.lignende.tekst",
            &[("n", &s.ids.len().to_string()), ("maal", &target)],
        );
        Some(
            ui::el("aktivitet-lignende", Role::Status, msg.clone())
                .flex()
                .items_center()
                .gap_3()
                .p_3()
                .rounded(px(8.))
                .bg(b.suggestion)
                .child(div().flex_1().min_w_0().text_sm().text_color(b.ink).child(msg))
                .child(ui::a11y_button(
                    "lignende-tildel",
                    tf("aktivitet.lignende.ja", &[("n", &s.ids.len().to_string())]),
                    false,
                    |b| b.primary().small(),
                    cx.listener(|this, _, _, cx| this.assign_similar(cx)),
                ))
                .child(ui::a11y_button(
                    "lignende-nej",
                    t("aktivitet.lignende.nej"),
                    false,
                    |b| b.ghost().small(),
                    cx.listener(|this, _, _, cx| {
                        this.similar = None;
                        cx.notify();
                    }),
                )),
        )
    }

    fn render_actions(&self, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement {
        let chosen = self.targets_of_action();
        let n = chosen.len();
        let secs: u32 = chosen.iter().map(|x| x.seconds).sum();
        let mergeable = n >= 2
            && !chosen
                .iter()
                .any(|x| matches!(x.status, ActivityStatus::Registered | ActivityStatus::Idle));
        let assignable = chosen
            .iter()
            .any(|x| !matches!(x.status, ActivityStatus::Registered | ActivityStatus::Idle));
        let confirmable = chosen.iter().any(|x| x.status == ActivityStatus::Suggested);
        let label = if self.selected.is_empty() {
            t("aktivitet.valg.ingen").to_string()
        } else {
            tf(
                "aktivitet.valg.n",
                &[("n", &n.to_string()), ("tid", &duration(secs))],
            )
        };
        let key = |k: &str| format!(" ({k})");
        h_flex()
            .id("aktivitet-handlinger")
            .gap_2()
            .items_center()
            .flex_wrap()
            .child(
                ui::text("aktivitet-valgt", label)
                    .text_sm()
                    .text_color(b.grey),
            )
            .child(div().flex_1())
            .child(ui::a11y_button(
                "aktivitet-tildel",
                format!("{}{}", t("aktivitet.handling.tildel"), key("T")),
                !assignable || self.busy,
                |b| b.primary().small(),
                cx.listener(|this, _, w, cx| this.open_assign(w, cx)),
            ))
            .child(ui::a11y_button(
                "aktivitet-bekraeft-valgte",
                format!("{}{}", t("maal.bekraeft.knap"), key("B")),
                !confirmable || self.busy,
                |b| b.outline().small().icon(Icon::Check),
                cx.listener(|this, _, _, cx| this.confirm_chosen(cx)),
            ))
            .child(ui::a11y_button(
                "aktivitet-ikke-arbejde",
                format!("{}{}", t("aktivitet.handling.ikke_arbejde"), key("N")),
                !assignable || self.busy,
                |b| b.outline().small(),
                cx.listener(|this, _, _, cx| this.not_work(cx)),
            ))
            .child(ui::a11y_button(
                "aktivitet-flet",
                format!("{}{}", t("aktivitet.handling.flet"), key("M")),
                !mergeable || self.busy,
                |b| b.outline().small(),
                cx.listener(|this, _, _, cx| this.merge(cx)),
            ))
            .child(ui::a11y_button(
                "aktivitet-del",
                format!("{}{}", t("aktivitet.handling.del"), key("D")),
                n != 1 || self.busy,
                |b| b.outline().small(),
                cx.listener(|this, _, w, cx| this.open_split(w, cx)),
            ))
            .child(ui::a11y_button(
                "aktivitet-slet",
                t("aktivitet.handling.slet"),
                n == 0 || self.busy,
                |b| b.ghost().small(),
                cx.listener(|this, _, _, cx| this.open_delete(cx)),
            ))
    }

    fn render_row(
        &self,
        d: &Data,
        b: &Brand,
        i: usize,
        x: &ActivityBlock,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let selected = self.selected.contains(&x.id);
        let at_cursor = self.cursor == Some(i);
        let span = format::span(Some(x.start), Some(x.end));
        let app = if x.app.is_empty() {
            status_label(x.status).to_string()
        } else {
            x.app.clone()
        };
        let target = d.target_label(x.customer_id.as_deref(), x.project_id.as_deref());
        let folded = (x.folded > 0 || !x.other_apps.is_empty()).then(|| {
            tf(
                "aktivitet.blok.foldet",
                &[
                    ("n", &x.folded.max(x.other_apps.len() as u32).to_string()),
                    ("apps", &x.other_apps.join(", ")),
                ],
            )
        });
        let sug = x.suggestion_id.clone();
        ui::list_row(b, ("blok", i), block_label(d, x))
            .aria_selected(selected)
            .cursor_pointer()
            .border_1()
            .border_color(if at_cursor {
                b.primary
            } else {
                b.card.opacity(0.)
            })
            .when(selected, |r| r.bg(b.primary_soft))
            .when(!selected, |r| r.hover(|r| r.bg(b.border.opacity(0.4))))
            .on_click(cx.listener(move |this, ev: &ClickEvent, w, cx| {
                this.focus.focus(w, cx);
                this.toggle(i, ev.modifiers().shift, cx);
            }))
            .child(
                Checkbox::new(("blok-valg", i))
                    .accessibility_label(tf(
                        "aktivitet.blok.vaelg",
                        &[("span", &format::span(Some(x.start), Some(x.end)))],
                    ))
                    .tab_stop(false)
                    .checked(selected)
                    .on_change(cx.listener(move |this, _: &bool, _, cx| this.toggle(i, false, cx))),
            )
            .child(
                v_flex()
                    .w(px(108.))
                    .flex_none()
                    .child(div().text_color(b.ink).child(span))
                    .child(
                        div()
                            .text_xs()
                            .text_color(b.grey)
                            .child(duration(x.seconds)),
                    ),
            )
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(div().font_weight(FontWeight::MEDIUM).child(app))
                            .children(target.map(|tl| {
                                let color = d.color_of(x.customer_id.as_deref());
                                h_flex()
                                    .gap_1()
                                    .items_center()
                                    .min_w_0()
                                    .child(div().size(px(8.)).flex_none().rounded_full().bg(color))
                                    .child(div().text_xs().text_color(b.ink).truncate().child(tl))
                            })),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(b.grey)
                            .truncate()
                            .child(detail(x)),
                    )
                    .children(folded.map(|f| div().text_xs().text_color(b.grey).child(f))),
            )
            .child(ui::badge(
                b,
                ("blok-status", i),
                status_label(x.status),
                tone(x.status),
            ))
            .children(
                sug.filter(|_| x.status == ActivityStatus::Suggested)
                    .map(|id| {
                        ui::a11y_button(
                            SharedString::from(format!("blok-bekraeft-{i}")),
                            t("aktivitet.bekraeft"),
                            false,
                            |b| b.primary().small(),
                            cx.listener(move |this, _, _, cx| {
                                cx.stop_propagation();
                                this.confirm_suggestion(id.clone(), cx)
                            }),
                        )
                    }),
            )
            .into_any_element()
    }

    /// "Altid sådan": vælg omfang med forhåndsvisning (Alt+1-5, Alt+0 ingen).
    fn render_scopes(&self, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement {
        let option = |id: SharedString, label: String, selected: bool, ix: Option<usize>, cx: &mut Context<Self>| {
            let a11y = if selected { format!("{label}, {}", t("maal.altid.valgt")) } else { label.clone() };
            ui::el(id, Role::RadioButton, a11y)
                .aria_selected(selected)
                .flex()
                .items_center()
                .gap_2()
                .px_2()
                .py_1()
                .rounded(px(6.))
                .cursor_pointer()
                .when(selected, |d| d.bg(b.primary_soft))
                .hover(|d| d.bg(b.card))
                .on_click(cx.listener(move |this, _, _, cx| this.choose_scope(ix, cx)))
                .child(
                    icon(if selected { Icon::CheckCircle2 } else { Icon::Circle })
                        .size(14.)
                        .color(if selected { b.primary } else { b.grey }),
                )
                .child(div().flex_1().min_w_0().truncate().text_sm().text_color(b.ink).child(label))
        };
        let body: AnyElement = match &self.scopes {
            Loadable::Loading => ui::muted(b, "altid-henter", tf("ui.states.loading", &[("what", t("maal.altid.henter"))]))
                .text_xs()
                .into_any_element(),
            Loadable::Failed(e) => ui::muted(b, "altid-fejl", e.clone()).text_xs().into_any_element(),
            Loadable::Ready(v) if v.is_empty() => ui::muted(b, "altid-tom", t("maal.altid.tom")).text_xs().into_any_element(),
            Loadable::Ready(v) => {
                let mut list = v_flex()
                    .gap_0p5()
                    .child(option("altid-ingen".into(), t("maal.altid.ingen").into(), self.scope.is_none(), None, cx));
                for (i, sc) in v.iter().enumerate() {
                    let label = tf(
                        "maal.altid.valg",
                        &[
                            ("slags", t(sc.kind.key())),
                            ("vaerdi", &sc.value),
                            ("idag", &sc.today.to_string()),
                            ("dage", &sc.recent.to_string()),
                        ],
                    );
                    list = list.child(option(
                        SharedString::from(format!("altid-{i}")),
                        label,
                        self.scope == Some(i),
                        Some(i),
                        cx,
                    ));
                }
                list.child(ui::muted(b, "altid-taster", t("maal.altid.taster")).text_xs()).into_any_element()
            }
        };
        ui::el("altid", Role::RadioGroup, t("maal.altid.titel"))
            .flex()
            .flex_col()
            .gap_1()
            .p_3()
            .rounded(px(10.))
            .bg(b.card)
            .border_1()
            .border_color(b.border)
            .child(ui::heading(b, "altid-titel", t("maal.altid.titel"), 3))
            .child(ui::muted(b, "altid-hjaelp", t("maal.altid.hjaelp")).text_xs())
            .child(body)
    }

    /// "Reglen gælder nu fremover … Registrér dem?"
    fn render_backward(&self, d: &Data, b: &Brand, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let (scope, target) = self.backward.as_ref()?;
        let n = scope.recent.saturating_sub(scope.today);
        let omfang = format!("{} {}", t(scope.kind.key()).to_lowercase(), scope.value);
        let msg = tf("maal.bagud.tekst", &[("omfang", &omfang), ("n", &n.to_string())]);
        let color = d.color_of(target.customer_id.as_deref());
        Some(
            ui::el("aktivitet-bagud", Role::Status, msg.clone())
                .flex()
                .items_center()
                .gap_3()
                .p_3()
                .rounded(px(8.))
                .bg(b.suggestion)
                .child(div().size(px(10.)).flex_none().rounded_full().bg(color))
                // min_w_0: teksten ombrydes, så knapperne bliver i vinduet.
                .child(div().flex_1().min_w_0().text_sm().text_color(b.ink).child(msg))
                .child(ui::a11y_button(
                    "bagud-ja",
                    t("maal.bagud.ja"),
                    self.busy,
                    |b| b.primary().small(),
                    cx.listener(|this, _, _, cx| this.apply_backward(cx)),
                ))
                .child(ui::a11y_button(
                    "bagud-nej",
                    t("maal.bagud.nej"),
                    false,
                    |b| b.ghost().small(),
                    cx.listener(|this, _, _, cx| {
                        this.backward = None;
                        cx.notify();
                    }),
                )),
        )
    }

    fn render_dialog(&self, b: &Brand, cx: &mut Context<Self>) -> Option<AnyElement> {
        let dialog = self.dialog.as_ref()?;
        let dismiss = cx.listener(|this, _: &MouseDownEvent, w, cx| this.close_dialog(w, cx));
        Some(match dialog {
            Dialog::Assign(_) => ui::modal(
                "aktivitet-tildel-dialog",
                self.picker.read(cx).title(),
                v_flex()
                    .w(px(580.))
                    .gap_2()
                    .child(self.picker.clone())
                    .child(
                        div()
                            .p_3()
                            .rounded(px(10.))
                            .bg(b.card)
                            .border_1()
                            .border_color(b.border)
                            .child(
                                Checkbox::new("tildel-husk")
                                    .label(t("aktivitet.tildel.husk"))
                                    .checked(self.remember)
                                    .on_change(cx.listener(|this, v: &bool, _, cx| {
                                        this.remember = *v;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                ui::muted(
                                    b,
                                    "tildel-husk-hjaelp",
                                    t("aktivitet.tildel.husk_hjaelp"),
                                )
                                .text_xs(),
                            ),
                    )
                    .child(self.render_scopes(b, cx)),
                dismiss,
            )
            .into_any_element(),
            Dialog::EntryTarget(_) => ui::modal(
                "aktivitet-post-dialog",
                self.picker.read(cx).title(),
                self.picker.clone(),
                dismiss,
            )
            .into_any_element(),
            Dialog::Split(id) => {
                let block = self.blocks().into_iter().find(|x| &x.id == id);
                let span = block
                    .map(|x| format::span(Some(x.start), Some(x.end)))
                    .unwrap_or_default();
                let (overlay, dialog) =
                    crate::ui::forms::modal(b, "aktivitet-del", t("aktivitet.del.titel"));
                overlay
                    .child(
                        dialog
                            .w(px(380.))
                            .child(ui::muted(
                                b,
                                "del-hjaelp",
                                tf("aktivitet.del.hjaelp", &[("span", &span)]),
                            ))
                            .child(
                                Input::new(&self.split_at)
                                    .id("del-tid")
                                    .aria_label(t("aktivitet.del.felt")),
                            )
                            .children(
                                self.split_error
                                    .clone()
                                    .map(|e| crate::ui::forms::form_error(b, "del-fejl", e)),
                            )
                            .child(
                                h_flex()
                                    .gap_2()
                                    .justify_end()
                                    .child(ui::a11y_button(
                                        "del-annuller",
                                        t("aktivitet.annuller"),
                                        false,
                                        |b| b.ghost(),
                                        cx.listener(|this, _, w, cx| this.close_dialog(w, cx)),
                                    ))
                                    .child(ui::a11y_button(
                                        "del-gem",
                                        t("aktivitet.del.knap"),
                                        false,
                                        |b| b.primary(),
                                        cx.listener(|this, _, w, cx| this.submit_split(w, cx)),
                                    )),
                            ),
                    )
                    .into_any_element()
            }
            Dialog::Delete(ids) => {
                let (overlay, dialog) =
                    crate::ui::forms::modal(b, "aktivitet-slet", t("aktivitet.slet.titel"));
                overlay
                    .child(
                        dialog
                            .w(px(420.))
                            .child(
                                ui::text(
                                    "slet-tekst",
                                    tf_n("aktivitet.slet.tekst", ids.len(), &[]),
                                )
                                .text_sm(),
                            )
                            .child(
                                h_flex()
                                    .gap_2()
                                    .justify_end()
                                    .child(ui::a11y_button(
                                        "slet-annuller",
                                        t("aktivitet.annuller"),
                                        false,
                                        |b| b.ghost(),
                                        cx.listener(|this, _, w, cx| this.close_dialog(w, cx)),
                                    ))
                                    .child(ui::a11y_button(
                                        "slet-ja",
                                        t("aktivitet.slet.knap"),
                                        false,
                                        |b| b.danger(),
                                        cx.listener(|this, _, w, cx| this.confirm_delete(w, cx)),
                                    )),
                            ),
                    )
                    .into_any_element()
            }
        })
    }
}

impl Render for AktivitetScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.data.ready().is_some()
            && let Some(demo) = self.demo.take()
        {
            self.run_demo(&demo, window, cx);
        }
        let b = brand(cx);
        let subtitle = self
            .data
            .ready()
            .map(|d| SharedString::from(format::date_long(d.day.date)));
        let mut page = ui::page(&b, "aktivitet", t("aktivitet.side.titel"), subtitle).child(
            ui::el("aktivitet-privat", Role::Note, t("aktivitet.side.privat"))
                .text_xs()
                .text_color(b.grey)
                .child(t("aktivitet.side.privat")),
        );
        page = match &self.data {
            Loadable::Loading => page.child(ui::loading_state(
                &b,
                "aktivitet-indlaeser",
                t("aktivitet.side.titel"),
            )),
            Loadable::Failed(e) => page.child(
                ui::error_state(&b, "aktivitet-fejl", e.clone()).child(ui::a11y_button(
                    "aktivitet-igen",
                    t("aktivitet.proev_igen"),
                    false,
                    |b| b.outline(),
                    cx.listener(|this, _, _, cx| this.reload(cx)),
                )),
            ),
            Loadable::Ready(d) => {
                let d = d.clone();
                let notice = self
                    .notice
                    .clone()
                    .map(|(m, err)| pickers::notice(&b, "aktivitet-besked", m, err));
                let list: AnyElement = if d.day.blocks.is_empty() {
                    ui::empty_state_icon(
                        &b,
                        "aktivitet-tom",
                        Icon::Activity,
                        t("aktivitet.tom.titel"),
                        t("aktivitet.tom.tekst"),
                    )
                    .into_any_element()
                } else {
                    ui::list("aktivitet-blokke", t("aktivitet.liste.label"))
                        .children(
                            d.day
                                .blocks
                                .iter()
                                .enumerate()
                                .map(|(i, x)| self.render_row(&d, &b, i, x, cx)),
                        )
                        .into_any_element()
                };
                page.child(self.render_toolbar(&d, &b, cx))
                    .children(notice)
                    .children(self.render_close_day(&b, cx))
                    .children(self.render_similar(&d, &b, cx))
                    .children(self.render_backward(&d, &b, cx))
                    .child(
                        ui::card(&b, "aktivitet-dag", t("aktivitet.dag.titel"))
                            .child(self.render_timeline(&d, &b, cx))
                            .child(self.render_summary(&d, &b, cx))
                            .child(self.render_actions(&b, cx))
                            .child(list)
                            .child(
                                ui::muted(&b, "aktivitet-taster", t("aktivitet.taster")).text_xs(),
                            ),
                    )
                    // kalender: dagens aftaler og møder, der venter på svar.
                    .children(crate::moedekort::day_card(&b, &d.calendar))
            }
        };
        div()
            .track_focus(&self.focus)
            .key_context("Aktivitet")
            .on_key_down(cx.listener(Self::on_key))
            .capture_key_down(cx.listener(|this, ev: &KeyDownEvent, w, cx| {
                let k = &ev.keystroke;
                if k.modifiers.alt
                    && matches!(this.dialog, Some(Dialog::Assign(_)))
                    && let Ok(n) = k.key.parse::<usize>()
                    && n <= 5
                {
                    this.choose_scope(n.checked_sub(1), cx);
                    cx.stop_propagation();
                    return;
                }
                if ev.keystroke.key == "escape" && this.dialog.is_some() {
                    this.close_dialog(w, cx);
                    cx.stop_propagation();
                } else if ev.keystroke.key == "enter"
                    && matches!(this.dialog, Some(Dialog::Delete(_)))
                {
                    this.confirm_delete(w, cx);
                    cx.stop_propagation();
                }
            }))
            .relative()
            .size_full()
            .child(page)
            .children(self.render_dialog(&b, cx))
    }
}

#[cfg(test)]
mod tests {
    use super::{Data, block_label, detail, duration};
    use crate::backend::{ActivityStatus, MockBackend};
    use chrono::NaiveDate;

    fn data() -> Data {
        let m = MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 27).unwrap());
        Data::load(&m, None).unwrap()
    }

    #[test]
    fn varighed_paa_dansk() {
        assert_eq!(duration(20), "under 1 min");
        assert_eq!(duration(35 * 60), "35 min");
        assert_eq!(duration(2 * 3600), "2 t");
        assert_eq!(duration(80 * 60 + 30), "1 t 20 min");
    }

    #[test]
    fn blokkens_label_og_detalje() {
        let d = data();
        let code = d.day.blocks.iter().find(|b| b.app == "Code").unwrap();
        assert_eq!(
            detail(code),
            "checkout.rs – bageriet-webshop · github.com/eksempel/bageriet-webshop · src/checkout.rs"
        );
        let l = block_label(&d, code);
        assert!(l.starts_with("09:00-11:00, Code, "), "{l}");
        assert!(
            l.ends_with("2 t, Foreslået, Bageriet på Hjørnet · Ny webshop"),
            "{l}"
        );
        let idle = d
            .day
            .blocks
            .iter()
            .find(|b| b.status == ActivityStatus::Idle)
            .unwrap();
        let l = block_label(&d, idle);
        assert_eq!(l.matches("Inaktiv").count(), 1, "statussen kun én gang: {l}");
    }

    #[test]
    fn kundefarver_fra_web_og_graa_intern_tid() {
        let d = data();
        assert_eq!(d.color_of(Some("kunde_bageriet")), gpui_kit::Hsla::from(gpui_kit::rgb(0xf59e0b)));
        assert_eq!(d.color_of(None), gpui_kit::Hsla::from(gpui_kit::rgb(0x9ca3af)));
        // Kunde uden farve i web: web's udledte farvetone.
        assert_eq!(d.color_of(Some("kunde_yoga")), crate::ui::farver::color_for("kunde_yoga", None));
    }
}

/// Headless tests af hele skærmen: `cargo test -p tt-app --features probe aktivitet`.
#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use std::sync::Arc;

    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AnyWindowHandle, AppContext as _, Entity, TestAppContext};

    use super::{AktivitetScreen, Dialog};
    use crate::app::AppView;
    use crate::backend::{ActivityStatus, Backend, DateRange, MockBackend};
    use crate::screens::Screen;
    use crate::testing;

    fn open(
        cx: &mut TestAppContext,
        m: Arc<MockBackend>,
    ) -> (AnyWindowHandle, Entity<AppView>, Entity<AktivitetScreen>) {
        let (handle, app) = testing::open_app(cx, m);
        testing::navigate(cx, handle, &app, Screen::Aktivitet);
        let s = app
            .read_with(cx, |a, _| a.view_for(Screen::Aktivitet))
            .unwrap()
            .downcast::<AktivitetScreen>()
            .ok()
            .unwrap();
        (handle, app, s)
    }

    fn settle(cx: &mut TestAppContext, handle: AnyWindowHandle) {
        cx.run_until_parked();
        testing::render(cx, handle);
        cx.run_until_parked();
        testing::render(cx, handle);
    }

    fn press(cx: &mut TestAppContext, handle: AnyWindowHandle, key: &str) {
        cx.update_window(handle, |_, w, cx| w.press(key, cx))
            .unwrap();
        settle(cx, handle);
    }

    fn click(cx: &mut TestAppContext, handle: AnyWindowHandle, id: impl Into<gpui_kit::ElementId>) {
        let id = id.into();
        cx.update_window(handle, |_, w, cx| w.click(id, cx))
            .unwrap();
        settle(cx, handle);
    }

    fn status_of(m: &MockBackend, title: &str) -> ActivityStatus {
        m.activity_day(testing::today())
            .unwrap()
            .blocks
            .into_iter()
            .find(|b| b.title == title)
            .map(|b| b.status)
            .expect("blokken findes")
    }

    #[gpui_kit::test]
    fn aktivitet_har_roller_genvej_og_alle_statusser(cx: &mut TestAppContext) {
        let (handle, _, _) = open(cx, testing::mock());
        let a = testing::a11y(cx, handle);
        assert!(a.has_label("Aktivitet"), "navigationen har skærmen");
        assert!(
            a.labels
                .iter()
                .any(|(r, l)| r == "Main" && l == "Aktivitet")
        );
        assert!(
            a.has_label_containing("bliver på denne computer"),
            "D3 står på skærmen"
        );
        assert!(a.has_label_containing("09:00-11:00, Code, checkout.rs"));
        for s in [
            "Registreret",
            "Foreslået",
            "Uden kunde",
            "Ikke arbejde",
            "Inaktiv",
        ] {
            assert!(a.has_label_containing(&format!(", {s}")), "mangler {s}");
        }
        assert!(a.has_label("Tidslinje med 9 blokke"));
        // Kun blokkene ("09:00-11:00, …"): kalenderens aftaler og møder deles
        // med andre probe-tests via den globale kalender og kan stå der.
        let blocks = a
            .labels
            .iter()
            .filter(|(r, l)| r == "ListItem" && l.get(11..13) == Some(", ") && l.get(5..6) == Some("-"))
            .count();
        assert_eq!(blocks, 9, "{:?}", a.labels);
    }

    #[gpui_kit::test]
    fn genvej_tre_aabner_aktivitet(cx: &mut TestAppContext) {
        let (handle, app) = testing::open_app(cx, testing::mock());
        let key = if cfg!(target_os = "macos") {
            "cmd-3"
        } else {
            "ctrl-3"
        };
        cx.update_window(handle, |_, w, cx| w.press(key, cx))
            .unwrap();
        settle(cx, handle);
        assert_eq!(app.read_with(cx, |a, _| a.screen), Screen::Aktivitet);
    }

    #[gpui_kit::test]
    fn tastatur_vaelger_og_markerer_ikke_arbejde(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, s) = open(cx, m.clone());
        click(cx, handle, ("blok", 0usize));
        assert_eq!(s.read_with(cx, |s, _| s.selected.len()), 1);
        press(cx, handle, "n");
        assert_eq!(
            status_of(&m, "Re: Tilbud på ny webshop"),
            ActivityStatus::NotWork
        );
        assert!(
            s.read_with(cx, |s, _| s.selected.is_empty()),
            "valget ryddes"
        );
        // Pil ned og Shift+pil udvider valget.
        press(cx, handle, "down");
        press(cx, handle, "shift-down");
        press(cx, handle, "shift-down");
        assert_eq!(s.read_with(cx, |s, _| s.selected.len()), 3);
        press(cx, handle, "escape");
        assert!(s.read_with(cx, |s, _| s.selected.is_empty()));
    }

    #[gpui_kit::test]
    fn tildel_med_vaelger_og_husk_tilbyder_lignende(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, s) = open(cx, m.clone());
        let before = m.entries(DateRange::day(testing::today())).unwrap().len();
        click(cx, handle, ("blok", 0usize));
        press(cx, handle, "t");
        assert!(matches!(
            s.read_with(cx, |s, _| s.dialog.clone()),
            Some(Dialog::Assign(_))
        ));
        assert_eq!(testing::a11y(cx, handle).count("Dialog"), 1);
        assert!(testing::a11y(cx, handle).has_label("Husk for lignende"));
        cx.update_window(handle, |_, w, cx| w.input("bagr web", cx))
            .unwrap();
        settle(cx, handle);
        press(cx, handle, "enter");
        assert!(s.read_with(cx, |s, _| s.dialog.is_none()));
        assert_eq!(
            m.entries(DateRange::day(testing::today())).unwrap().len(),
            before + 1
        );
        assert_eq!(
            status_of(&m, "Re: Tilbud på ny webshop"),
            ActivityStatus::Registered
        );
        assert!(testing::a11y(cx, handle).has_label_containing("1 registreringer gemt"));
    }

    /// ux-vaelger: Tildel med "Altid sådan" på domænet, og reglen gælder bagud.
    #[gpui_kit::test]
    fn tildel_med_altid_saadan_og_bagud(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, s) = open(cx, m.clone());
        // Blok 3: Safari på portal.example (uklar).
        click(cx, handle, ("blok", 3usize));
        press(cx, handle, "t");
        settle(cx, handle);
        let a = testing::a11y(cx, handle);
        assert!(a.has_label("Altid sådan"), "{:?}", a.labels);
        assert!(a.has_label_containing("Domæne portal.example · 1 i dag · 5 de sidste 14 dage"));
        // Alt+1: domænet (det første omfang).
        press(cx, handle, "alt-1");
        assert_eq!(s.read_with(cx, |s, _| s.scope), Some(0));
        assert!(testing::a11y(cx, handle).has_label_containing("portal.example · 1 i dag · 5 de sidste 14 dage, valgt"));
        cx.update_window(handle, |_, w, cx| w.input("bagr web", cx)).unwrap();
        settle(cx, handle);
        press(cx, handle, "enter");
        let rule = m
            .rule_rows()
            .unwrap()
            .into_iter()
            .find(|r| r.value == "portal.example")
            .expect("reglen er gemt");
        assert_eq!(rule.customer_id.as_deref(), Some("kunde_bageriet"));
        assert_eq!(rule.project_id.as_deref(), Some("proj_webshop"));
        assert!(testing::a11y(cx, handle).has_label_containing("4 blokke de sidste 14 dage matcher også"));
        click(cx, handle, "bagud-ja");
        assert!(testing::a11y(cx, handle).has_label_containing("4 poster registreret bagud"));
        assert!(s.read_with(cx, |s, _| s.backward.is_none()));
    }

    /// ux-vaelger: "Luk dagen" → Vælg projekt åbner vælgeren i kundens projekter.
    #[gpui_kit::test]
    fn luk_dagen_vaelg_projekt_til_post_uden_projekt(cx: &mut TestAppContext) {
        let m = testing::mock();
        m.create_entry(crate::backend::EntryInput {
            customer_id: "kunde_bageriet".into(),
            project_id: None,
            task_id: None,
            description: "Telefonmøde".into(),
            date: testing::today(),
            start: None,
            end: None,
            minutes: 30,
            billable: true,
        })
        .unwrap();
        let (handle, _, s) = open(cx, m.clone());
        press(cx, handle, "l");
        settle(cx, handle);
        let e = s
            .read_with(cx, |s, _| s.close_day.as_ref().and_then(|c| c.ready().cloned()))
            .expect("Luk dagen er hentet")
            .without_project
            .first()
            .cloned()
            .expect("demoen har en post uden projekt");
        let customer = e.customer_id.clone();
        cx.update_window(handle, |_, w, cx| s.update(cx, |s, cx| s.open_entry_target(e.clone(), w, cx))).unwrap();
        settle(cx, handle);
        // Vælgeren står i kundens projekter: Enter på det første projekt.
        let view = s.read_with(cx, |s, cx| s.picker.read(cx).view.clone());
        assert_eq!(view, crate::ui::maal::View::Customer(customer.clone()));
        press(cx, handle, "down");
        press(cx, handle, "enter");
        let after = m.entries(DateRange::day(e.date)).unwrap().into_iter().find(|x| x.id == e.id).unwrap();
        assert!(after.project_id.is_some(), "posten har fået et projekt");
        assert_eq!(after.customer_id, customer);
        assert_eq!(after.minutes, e.minutes);
        assert!(testing::a11y(cx, handle).has_label("Posten er gemt."));
    }

    /// Review (ux-vaelger): Tildel tilbyder ikke "Intern tid" uden projekt (backend afviser den).
    #[gpui_kit::test]
    fn tildel_har_ikke_ren_intern_tid(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, s) = open(cx, m.clone());
        click(cx, handle, ("blok", 0usize));
        press(cx, handle, "t");
        settle(cx, handle);
        let bare = s.read_with(cx, |s, cx| {
            s.picker
                .read(cx)
                .rows()
                .iter()
                .any(|r| r.pick_target() == Some(&crate::ui::maal::PickTarget::internal()))
        });
        assert!(!bare, "demoen har ingen interne projekter: rækken er væk");
    }

    /// ux-vaelger: ét tryk på B bekræfter forslaget i den valgte blok.
    #[gpui_kit::test]
    fn b_bekraefter_forslaget_i_valgte_blok(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, _) = open(cx, m.clone());
        let before = m.suggestions(testing::today()).unwrap().len();
        click(cx, handle, ("blok", 1usize));
        press(cx, handle, "b");
        assert_eq!(m.suggestions(testing::today()).unwrap().len(), before - 1);
        assert!(testing::a11y(cx, handle).has_label_containing("1 forslag bekræftet"));
        // En uklar blok har intet forslag at bekræfte.
        click(cx, handle, ("blok", 0usize));
        press(cx, handle, "b");
        assert!(testing::a11y(cx, handle).has_label("Ingen forslag i de valgte blokke."));
    }

    /// ux-vaelger: træk på tidslinjen markerer blokkene imellem (pauser springes over).
    #[gpui_kit::test]
    fn traek_paa_tidslinjen_markerer_flere(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, s) = open(cx, m.clone());
        s.update(cx, |s, cx| {
            s.drag_start(0, false, cx);
            s.drag_over(3, cx);
            s.drag_end(cx);
        });
        settle(cx, handle);
        assert_eq!(s.read_with(cx, |s, _| s.selected.len()), 3, "blok 0, 1 og 3; pausen (2) er ikke med");
        assert!(testing::a11y(cx, handle).has_label_containing("3 blokke markeret"));
        assert!(testing::a11y(cx, handle).has_label("Træk hen over tidslinjen for at markere flere blokke."));
    }

    #[gpui_kit::test]
    fn flet_del_og_slet(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, s) = open(cx, m.clone());
        let n = || m.activity_day(testing::today()).unwrap().blocks.len();
        let start = n();
        // Del Code-blokken (09:00-11:00) ved 10:00.
        click(cx, handle, ("blok", 1usize));
        press(cx, handle, "d");
        assert!(matches!(
            s.read_with(cx, |s, _| s.dialog.clone()),
            Some(Dialog::Split(_))
        ));
        // Feltet har et navn (før var det kun pladsholderen "tt:mm").
        assert!(
            testing::a11y(cx, handle)
                .labels
                .iter()
                .any(|(r, l)| r == "TextInput" && l == "Tidspunkt (tt:mm)")
        );
        cx.update_window(handle, |_, w, cx| {
            w.press("cmd-a", cx);
            w.input("12:00", cx);
        })
        .unwrap();
        settle(cx, handle);
        press(cx, handle, "enter");
        assert!(
            testing::a11y(cx, handle).has_label("Skriv et tidspunkt inde i blokken (09:00-11:00)."),
            "uden for blokken afvises"
        );
        cx.update_window(handle, |_, w, cx| {
            w.press("cmd-a", cx);
            w.input("10:00", cx);
        })
        .unwrap();
        settle(cx, handle);
        click(cx, handle, "del-gem");
        assert_eq!(n(), start + 1);
        // Flet de to halvdele igen.
        click(cx, handle, ("blok", 1usize));
        cx.update_window(handle, |_, w, cx| {
            w.click_with_modifiers(("blok", 2usize), gpui_kit::Modifiers::shift(), cx)
        })
        .unwrap();
        settle(cx, handle);
        assert_eq!(s.read_with(cx, |s, _| s.selected.len()), 2);
        press(cx, handle, "m");
        assert_eq!(n(), start);
        // Slet kræver bekræftelse.
        click(cx, handle, ("blok", 0usize));
        press(cx, handle, "backspace");
        assert!(testing::a11y(cx, handle).has_label_containing("slettes for altid"));
        press(cx, handle, "enter");
        assert_eq!(n(), start - 1);
    }

    #[gpui_kit::test]
    fn luk_dagen_bekraefter_alle_forslag(cx: &mut TestAppContext) {
        let m = testing::mock();
        let (handle, _, _) = open(cx, m.clone());
        press(cx, handle, "l");
        let a = testing::a11y(cx, handle);
        assert!(a.has_label_containing("3 ubekræftede forslag"));
        assert!(a.has_label_containing("blokke uden kunde"));
        click(cx, handle, "luk-dagen-bekraeft-alle");
        assert!(m.suggestions(testing::today()).unwrap().is_empty());
        let a = testing::a11y(cx, handle);
        assert!(!a.has_label_containing("ubekræftede forslag"));
        // Uklar tid kan vælges herfra.
        click(cx, handle, "luk-dagen-vis-uklare");
        assert!(testing::a11y(cx, handle).has_label_containing("3 valgt"));
    }

    #[gpui_kit::test]
    fn dag_tilbage_og_frem_inden_for_opbevaringen(cx: &mut TestAppContext) {
        let (handle, _, s) = open(cx, testing::mock());
        press(cx, handle, "left");
        assert_eq!(s.read_with(cx, |s, _| s.date), testing::today().pred_opt());
        assert!(testing::a11y(cx, handle).has_label_containing("Ingen aktivitet"));
        press(cx, handle, "right");
        assert_eq!(s.read_with(cx, |s, _| s.date), None);
        press(cx, handle, "right");
        assert_eq!(s.read_with(cx, |s, _| s.date), None, "ikke ind i fremtiden");
    }
}
