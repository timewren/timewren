//! Den fælles mål-vælger (kunde → projekt → opgave), brugt overalt, hvor
//! noget skal høre til en kunde: timeren, Hurtig registrering, Ret forslag,
//! "Lær TimeTrack at kende", Aktivitet → Tildel, Luk dagen, kalenderens
//! editor og mødekortet. Modellen står i `ui::maal`.
//!
//! Ejeren viser vælgeren i en `ui::modal`, kalder `open` og lytter på
//! [`TargetPickerEvent`]. Vælgeren henter selv kunder, projekter, opgaver og
//! de seneste mål, og opretter selv kunder og projekter ("Opret kunde 'X'",
//! "Opret projekt 'X' under Kunde"); det nye mål kommer som `Picked`.
//!
//! Tastatur: ↑↓, Enter vælger, → åbner kundens projekter (og projektets
//! opgaver), ← tilbage, Tab til opgaverne, 1-9 de seneste (tomt søgefelt),
//! Esc lukker.

use gpui_kit::component::button::ButtonVariants as _;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::Sizable as _;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::{CustomerInput, ProjectInput};
use crate::brand::brand;
use crate::i18n::{t, tf};
use crate::ui::maal::{self, Catalog, Hint, PickTarget, Row, RowKind, View};
use crate::ui::icons::{Icon, icon};
use crate::ui::{self, farver, tokens};

#[derive(Clone, Debug, PartialEq)]
pub enum TargetPickerEvent {
    Picked(PickTarget),
    Dismissed,
}

pub struct TargetPicker {
    ctx: AppCtx,
    id: &'static str,
    title: SharedString,
    pub input: Entity<InputState>,
    catalog: Option<Catalog>,
    hints: Vec<Hint>,
    pub view: View,
    pub show_archived: bool,
    rows: Vec<Row>,
    /// Indeks i `rows` (altid en række, der kan vælges, hvis der er nogen).
    pub selected: usize,
    scroll: UniformListScrollHandle,
    busy: bool,
    error: Option<SharedString>,
    load_seq: u64,
    /// Højden i px (lavere, når dialogen har mere under vælgeren).
    height: f32,
    /// "Intern tid" uden projekt kan vælges (timeren og poster). Tildel og
    /// regler kræver et internt projekt: så åbner rækken projekterne.
    bare_internal: bool,
    _subs: Vec<Subscription>,
}

impl EventEmitter<TargetPickerEvent> for TargetPicker {}

const ROW_H: f32 = 34.;

impl TargetPicker {
    pub fn new(ctx: AppCtx, id: &'static str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(t("maal.soeg")));
        let subs = vec![
            cx.subscribe_in(&input, window, |this: &mut Self, _, ev: &InputEvent, _, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.rebuild(true, cx);
                }
            }),
            // Kataloget holdes frisk, så vælgeren er klar, når den åbnes.
            cx.observe(&ctx.hub, |this, _, cx| this.load(cx)),
        ];
        let mut this = TargetPicker {
            ctx,
            id,
            title: t("maal.knap_tom").into(),
            input,
            catalog: None,
            hints: vec![],
            view: View::Root,
            show_archived: false,
            rows: vec![],
            selected: 0,
            scroll: UniformListScrollHandle::new(),
            busy: false,
            error: None,
            load_seq: 0,
            height: 480.,
            bare_internal: true,
            _subs: subs,
        };
        this.load(cx);
        this
    }

    /// Lavere vælger (Aktivitet → Tildel har "Husk" og "Altid sådan" under).
    pub fn compact(mut self) -> Self {
        self.height = 330.;
        self
    }

    /// Uden "Intern tid" uden projekt (Tildel og regler).
    pub fn without_bare_internal(mut self) -> Self {
        self.bare_internal = false;
        self
    }

    pub fn title(&self) -> SharedString {
        self.title.clone()
    }

    pub fn rows(&self) -> &[Row] {
        &self.rows
    }

    pub fn catalog(&self) -> Option<&Catalog> {
        self.catalog.as_ref()
    }

    /// "Bageriet · Ny webshop", når kataloget er hentet.
    pub fn label(&self, t: &PickTarget) -> Option<String> {
        self.catalog.as_ref().map(|c| c.label(t))
    }

    /// Åbn i roden med søgefeltet tomt og i fokus. `hints` står øverst.
    pub fn open(
        &mut self,
        title: impl Into<SharedString>,
        hints: Vec<Hint>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_in(title, hints, View::Root, window, cx);
    }

    /// Som `open`, men direkte i en kunde- eller projektvisning.
    pub fn open_in(
        &mut self,
        title: impl Into<SharedString>,
        hints: Vec<Hint>,
        view: View,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.title = title.into();
        self.hints = hints;
        self.view = view;
        self.error = None;
        self.busy = false;
        self.input.update(cx, |s, cx| {
            s.set_value("", window, cx);
            s.focus(window, cx);
        });
        self.rebuild(true, cx);
        self.load(cx);
    }

    /// Hent kataloget igen (vises med det samme, hvis et ældre findes).
    pub fn load(&mut self, cx: &mut Context<Self>) {
        self.load_seq += 1;
        let seq = self.load_seq;
        self.ctx.fetch(cx, Catalog::load, move |this, res, cx| {
            if seq != this.load_seq {
                return;
            }
            match res {
                Ok(c) => {
                    this.catalog = Some(c);
                    this.rebuild(false, cx);
                }
                Err(e) => this.error = Some(e.to_string().into()),
            }
        });
    }

    /// Til tests og skærmbilleder: sæt kataloget uden at hente.
    pub fn set_catalog(&mut self, c: Catalog, cx: &mut Context<Self>) {
        self.load_seq += 1;
        self.catalog = Some(c);
        self.rebuild(true, cx);
    }

    /// Sæt søgeteksten (`set_value` giver ingen `Change`).
    pub fn set_query(&mut self, q: &str, window: &mut Window, cx: &mut Context<Self>) {
        let q = q.to_string();
        self.input.update(cx, |s, cx| s.set_value(q, window, cx));
        self.rebuild(true, cx);
    }

    pub fn query(&self, cx: &App) -> String {
        self.input.read(cx).value().trim().to_string()
    }

    /// Byg rækkerne igen. `reset`: markøren til første række, der kan vælges.
    fn rebuild(&mut self, reset: bool, cx: &mut Context<Self>) {
        let q = self.input.read(cx).value().to_string();
        let keep = (!reset).then(|| self.rows.get(self.selected).cloned()).flatten();
        self.rows = match &self.catalog {
            Some(c) => maal::rows(c, &self.hints, &self.view, &q, self.show_archived),
            None => vec![],
        };
        if !self.bare_internal {
            // Kun interne projekter: en ren "Intern tid" uden projekter at åbne er væk.
            self.rows.retain(|r| r.pick_target() != Some(&PickTarget::internal()) || r.expands.is_some());
        }
        self.selected = keep
            .and_then(|k| self.rows.iter().position(|r| r.kind == k.kind))
            .unwrap_or_else(|| maal::initial(&self.rows));
        self.scroll.scroll_to_item(self.selected, ScrollStrategy::Top);
        cx.notify();
    }

    fn go(&mut self, view: View, window: &mut Window, cx: &mut Context<Self>) {
        let back_to = match &self.view {
            View::Customer(c) => Some(c.clone()),
            View::Project(p) => Some(p.clone()),
            View::Root => None,
        };
        self.view = view;
        self.input.update(cx, |s, cx| s.set_value("", window, cx));
        self.rebuild(true, cx);
        // Tilbage: markøren på det, man kom fra.
        if let Some(id) = back_to
            && let Some(i) = self.rows.iter().position(|r| {
                r.expands == Some(View::Customer(id.clone())) || r.expands == Some(View::Project(id.clone()))
            })
        {
            self.selected = i;
            self.scroll.scroll_to_item(i, ScrollStrategy::Center);
        }
    }

    pub fn back(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let parent = match &self.view {
            View::Root => return,
            View::Customer(_) => View::Root,
            View::Project(p) => {
                let customer = self
                    .catalog
                    .as_ref()
                    .and_then(|c| c.project(p))
                    .map(|p| p.customer_id.clone())
                    .unwrap_or_default();
                View::Customer(customer)
            }
        };
        self.go(parent, window, cx);
    }

    /// → på den valgte række: åbn kunden eller projektet.
    pub fn expand(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        match self.rows.get(self.selected).and_then(|r| r.expands.clone()) {
            Some(v) => {
                self.go(v, window, cx);
                true
            }
            None => false,
        }
    }

    /// Tab: til opgaverne for rækkens projekt (eller kundens projekter).
    pub fn to_tasks(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let Some(row) = self.rows.get(self.selected) else {
            return false;
        };
        if let Some(p) = row.pick_target().and_then(|t| t.project_id.clone())
            && self
                .catalog
                .as_ref()
                .is_some_and(|c| c.tasks.iter().any(|x| x.project_id == p))
            && self.view != View::Project(p.clone())
        {
            self.go(View::Project(p), window, cx);
            return true;
        }
        self.expand(window, cx)
    }

    /// Aktivér rækken (klik eller Enter).
    pub fn activate(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(row) = self.rows.get(ix).cloned() else {
            return;
        };
        self.selected = ix;
        match row.kind {
            RowKind::Header => {}
            RowKind::Target(t) if !self.bare_internal && t == PickTarget::internal() => {
                if let Some(v) = row.expands {
                    self.go(v, window, cx);
                }
            }
            RowKind::Target(t) => cx.emit(TargetPickerEvent::Picked(t)),
            RowKind::ToggleArchived => {
                self.show_archived = !self.show_archived;
                self.rebuild(false, cx);
            }
            RowKind::CreateCustomer(name) => self.create_customer(name, window, cx),
            RowKind::CreateProject { customer_id, name } => self.create_project(customer_id, name, cx),
        }
    }

    /// Tal 1-9: vælg den seneste med tallet.
    pub fn pick_number(&mut self, n: u8, window: &mut Window, cx: &mut Context<Self>) -> bool {
        match maal::numbered(&self.rows, n) {
            Some(ix) => {
                self.activate(ix, window, cx);
                true
            }
            None => false,
        }
    }

    fn create_customer(&mut self, name: String, _window: &mut Window, cx: &mut Context<Self>) {
        if self.busy || name.trim().is_empty() {
            return;
        }
        self.busy = true;
        self.error = None;
        let input = CustomerInput {
            name,
            ..Default::default()
        };
        let ctx = self.ctx.clone();
        self.ctx.fetch(cx, move |b| b.create_customer(input), move |this, res, cx| {
            this.busy = false;
            match res {
                Ok(c) => {
                    ctx.changed(cx);
                    cx.emit(TargetPickerEvent::Picked(PickTarget::customer(c.id)));
                    this.load(cx);
                }
                Err(e) => this.error = Some(e.to_string().into()),
            }
        });
    }

    fn create_project(&mut self, customer_id: String, name: String, cx: &mut Context<Self>) {
        if self.busy || name.trim().is_empty() {
            return;
        }
        self.busy = true;
        self.error = None;
        let input = ProjectInput {
            customer_id: customer_id.clone(),
            name,
            hourly_rate: None,
            budget_minutes: None,
        };
        let ctx = self.ctx.clone();
        self.ctx.fetch(cx, move |b| b.create_project(input), move |this, res, cx| {
            this.busy = false;
            match res {
                Ok(p) => {
                    ctx.changed(cx);
                    cx.emit(TargetPickerEvent::Picked(PickTarget::project(Some(&customer_id), p.id)));
                    this.load(cx);
                }
                Err(e) => this.error = Some(e.to_string().into()),
            }
        });
    }

    fn on_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let m = &ev.keystroke.modifiers;
        if m.platform || m.control || m.alt {
            return;
        }
        let key = ev.keystroke.key.as_str();
        let handled = match key {
            "down" => {
                self.selected = maal::step(&self.rows, self.selected, 1);
                true
            }
            "up" => {
                self.selected = maal::step(&self.rows, self.selected, -1);
                true
            }
            "enter" => {
                self.activate(self.selected, window, cx);
                true
            }
            "escape" => {
                cx.emit(TargetPickerEvent::Dismissed);
                true
            }
            "right" => self.expand(window, cx),
            // ← tilbage, når søgefeltet er tomt (ellers flytter den markøren i feltet).
            "left" if self.view != View::Root && self.query(cx).is_empty() => {
                self.back(window, cx);
                true
            }
            // Tab åbner opgaverne; er der intet at åbne, går fokus videre som normalt.
            "tab" if !m.shift => self.to_tasks(window, cx),
            k if k.len() == 1 && self.view == View::Root && self.query(cx).is_empty() => k
                .parse::<u8>()
                .ok()
                .filter(|n| (1..=9).contains(n))
                .is_some_and(|n| self.pick_number(n, window, cx)),
            _ => false,
        };
        if handled {
            cx.stop_propagation();
            self.scroll.scroll_to_item(self.selected, ScrollStrategy::Center);
            cx.notify();
        }
    }
}

impl Render for TargetPicker {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let id = self.id;
        let count = self.rows.len();
        let crumb = (self.view != View::Root).then(|| {
            h_flex().child(ui::a11y_button(
                SharedString::from(format!("{id}-tilbage")),
                t("maal.tilbage"),
                false,
                |b| b.ghost().small().icon(Icon::ChevronLeft),
                cx.listener(|this, _, w, cx| this.back(w, cx)),
            ))
        });
        v_flex()
            .w(px(580.))
            .h(px(self.height))
            .gap_2()
            .p_3()
            .rounded(px(12.))
            .bg(b.surface)
            .border_1()
            .border_color(b.border)
            .shadow_lg()
            .capture_key_down(cx.listener(Self::on_key))
            .child(ui::heading(&b, SharedString::from(format!("{id}-titel")), self.title.clone(), 2))
            .child(
                Input::new(&self.input)
                    .id(SharedString::from(format!("{id}-soeg")))
                    .aria_label(t("maal.soeg")),
            )
            .child(ui::muted(&b, SharedString::from(format!("{id}-taster")), t("maal.taster")).text_xs())
            .children(crumb)
            .children(self.error.clone().map(|e| {
                ui::el(SharedString::from(format!("{id}-fejl")), Role::Alert, e.clone())
                    .text_sm()
                    .text_color(b.danger)
                    .child(e)
            }))
            .when(self.catalog.is_none(), |d| {
                d.child(ui::loading_state(&b, SharedString::from(format!("{id}-indlaeser")), t("maal.indlaeser")))
            })
            .when(self.catalog.is_some() && !self.rows.iter().any(Row::selectable), |d| {
                d.child(ui::muted(&b, SharedString::from(format!("{id}-ingen")), t("maal.ingen")))
            })
            .child(
                ui::el(SharedString::from(format!("{id}-liste")), Role::ListBox, t("maal.liste"))
                    .flex_1()
                    .min_h_0()
                    .child(
                        uniform_list(
                            SharedString::from(format!("{id}-rækker")),
                            count,
                            cx.processor(move |this, range: std::ops::Range<usize>, _, cx| {
                                let b = brand(cx);
                                let customers = this.catalog.as_ref().map(|c| c.customers.clone()).unwrap_or_default();
                                range
                                    .map(|i| {
                                        let row = &this.rows[i];
                                        render_row(&b, id, i, row, i == this.selected, &customers, cx)
                                    })
                                    .collect()
                            }),
                        )
                        .track_scroll(&self.scroll)
                        .size_full(),
                    ),
            )
    }
}

fn render_row(
    b: &crate::brand::Brand,
    id: &'static str,
    i: usize,
    row: &Row,
    selected: bool,
    customers: &[crate::backend::Customer],
    cx: &mut Context<TargetPicker>,
) -> AnyElement {
    let pad = px(8. + 18. * f32::from(row.indent));
    if row.kind == RowKind::Header {
        return ui::el((id, i), Role::Heading, row.title.clone())
            .aria_level(3)
            .h(px(ROW_H))
            .flex()
            .items_end()
            .pb_1()
            .pl(pad)
            .text_xs()
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(b.grey)
            .child(row.title.to_uppercase())
            .into_any_element();
    }
    let action = matches!(
        row.kind,
        RowKind::CreateCustomer(_) | RowKind::CreateProject { .. } | RowKind::ToggleArchived
    );
    let dot = row.color_of.as_deref().map(|c| {
        let color = farver::color_in(customers, Some(c));
        div().size(px(10.)).flex_none().rounded_full().bg(color)
    });
    // Faste id'er på opret-rækkerne, så de kan findes (tests, UIA).
    let eid: ElementId = match row.kind {
        RowKind::CreateCustomer(_) => SharedString::from(format!("{id}-opret")).into(),
        RowKind::CreateProject { .. } => SharedString::from(format!("{id}-opret-projekt")).into(),
        _ => (id, i).into(),
    };
    ui::el(eid, Role::ListBoxOption, row.label())
        .aria_selected(selected)
        .flex()
        .items_center()
        .gap_2()
        .w_full()
        .h(px(ROW_H))
        .pl(pad)
        .pr_2()
        .rounded(px(6.))
        .cursor_pointer()
        .when(selected, |d| d.bg(b.primary_soft))
        .when(!selected, |d| d.hover(|d| d.bg(b.card)))
        .on_click(cx.listener(move |this, _, w, cx| this.activate(i, w, cx)))
        .children(dot)
        .when(action, |d| {
            let ic = match row.kind {
                RowKind::ToggleArchived => Icon::Archive,
                RowKind::CreateProject { .. } => Icon::FolderPlus,
                _ => Icon::UserPlus,
            };
            d.child(icon(ic).size(tokens::ICON_SM).color(b.primary))
        })
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_sm()
                .font_weight(if row.indent == 0 && !action { FontWeight::MEDIUM } else { FontWeight::NORMAL })
                .text_color(if action { b.primary } else if row.archived { b.grey } else { b.ink })
                .child(row.title.clone()),
        )
        .when(row.archived, |d| {
            d.child(ui::badge(b, (SharedString::from(format!("{id}-ark")), i), t("maal.arkiveret"), ui::Tone::Neutral))
        })
        .when(!row.detail.is_empty(), |d| {
            d.child(
                div()
                    .max_w(px(220.))
                    .flex_none()
                    .truncate()
                    .text_xs()
                    .text_color(b.grey)
                    .child(row.detail.clone()),
            )
        })
        .children(row.number.map(|n| {
            div()
                .flex_none()
                .px_1p5()
                .rounded(px(4.))
                .border_1()
                .border_color(b.border)
                .text_xs()
                .text_color(b.grey)
                .child(n.to_string())
        }))
        .when(row.expands.is_some(), |d| d.child(icon(Icon::ChevronRight).size(tokens::ICON_SM).color(b.grey)))
        .into_any_element()
}

/// Knappen, der viser det valgte mål med kundens farve og åbner vælgeren.
pub fn target_button(
    b: &crate::brand::Brand,
    id: impl Into<SharedString>,
    label: Option<String>,
    color: Option<Hsla>,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> ui::El {
    let id: SharedString = id.into();
    let text: SharedString = label.clone().unwrap_or_else(|| t("maal.knap_tom").into()).into();
    let a11y = match &label {
        Some(l) => tf("maal.valgt", &[("maal", l)]),
        None => t("maal.knap_tom").to_string(),
    };
    let handler = std::rc::Rc::new(on_click);
    let click = handler.clone();
    ui::el(id, Role::Button, a11y)
        .flex()
        .items_center()
        .gap_2()
        .h(px(34.))
        .px_3()
        .rounded(px(8.))
        .border_1()
        .border_color(b.border)
        .bg(b.surface)
        .cursor_pointer()
        .hover(|d| d.bg(b.card))
        .on_click(move |ev, w, cx| click(ev, w, cx))
        .on_a11y_action(AccessibleAction::Click, move |_, w, cx| {
            let ev = ClickEvent::Keyboard(KeyboardClickEvent {
                button: KeyboardButton::Enter,
                bounds: Bounds::default(),
            });
            handler(&ev, w, cx);
        })
        .children(color.map(|c| div().size(px(10.)).flex_none().rounded_full().bg(c)))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_sm()
                .text_color(if label.is_some() { b.ink } else { b.grey })
                .child(text),
        )
        .child(icon(Icon::ChevronDown).size(tokens::ICON_SM).color(b.grey))
}
