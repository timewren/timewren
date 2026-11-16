//! Søgbar vælger med tastatur (↑↓, Enter, Esc): kunde/projekt-vælgeren og
//! kommandopaletten. Ejeren lytter på `PickerEvent` og viser vælgeren i en
//! `ui::modal`.

use crate::i18n::{t, tf};
use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::brand::brand;
use crate::ui::{self, fuzzy};

#[derive(Clone, Debug, PartialEq)]
pub struct PickerItem {
    pub title: SharedString,
    /// Vises dæmpet til højre (projekt, genvej …).
    pub detail: SharedString,
    /// Ekstra søgeord, der ikke vises.
    pub keywords: String,
}

impl PickerItem {
    pub fn new(title: impl Into<SharedString>, detail: impl Into<SharedString>) -> Self {
        PickerItem {
            title: title.into(),
            detail: detail.into(),
            keywords: String::new(),
        }
    }

    fn haystack(&self) -> String {
        format!("{} {} {}", self.title, self.detail, self.keywords)
    }

    /// Label til skærmlæseren.
    pub fn label(&self) -> String {
        if self.detail.is_empty() {
            self.title.to_string()
        } else {
            format!("{}, {}", self.title, self.detail)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PickerEvent {
    /// Indeks i `items`.
    Picked(usize),
    Dismissed,
    /// "Opret kunde 'X'": opret straks en kunde med søgeteksten.
    /// Kun når `allow_create` er slået til (også de to næste).
    Create(String),
    /// "Ny kunde": åbn formularen med søgeteksten som navn.
    NewCustomer(String),
}

pub struct Picker {
    id: &'static str,
    title: SharedString,
    items: Rc<Vec<PickerItem>>,
    haystacks: Vec<String>,
    pub input: Entity<InputState>,
    /// Indekser i `items`, bedste først.
    pub matches: Vec<usize>,
    /// Position i `matches`.
    pub selected: usize,
    scroll: UniformListScrollHandle,
    /// Tilbyd "Opret kunde" og "Ny kunde", når intet matcher.
    create: bool,
    _subs: Vec<Subscription>,
}

impl EventEmitter<PickerEvent> for Picker {}

const LIMIT: usize = 200;

impl Picker {
    pub fn new(
        id: &'static str,
        title: impl Into<SharedString>,
        placeholder: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
        let subs = vec![cx.subscribe_in(
            &input,
            window,
            |this: &mut Self, _, ev: &InputEvent, _, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.refilter(cx);
                }
            },
        )];
        Picker {
            id,
            title: title.into(),
            items: Rc::new(vec![]),
            haystacks: vec![],
            input,
            matches: vec![],
            selected: 0,
            scroll: UniformListScrollHandle::new(),
            create: false,
            _subs: subs,
        }
    }

    pub fn set_items(&mut self, items: Vec<PickerItem>, cx: &mut Context<Self>) {
        self.haystacks = items.iter().map(PickerItem::haystack).collect();
        self.items = Rc::new(items);
        self.refilter(cx);
    }

    pub fn items(&self) -> &[PickerItem] {
        &self.items
    }

    pub fn set_title(&mut self, title: impl Into<SharedString>) {
        self.title = title.into();
    }

    pub fn title(&self) -> SharedString {
        self.title.clone()
    }

    /// Kunde-vælgeren: tilbyd at oprette en kunde, når intet matcher.
    pub fn allow_create(&mut self, on: bool) {
        self.create = on;
    }

    /// Sæt søgeteksten og filtrér (`set_value` giver ingen `Change`).
    pub fn set_query(&mut self, q: &str, window: &mut Window, cx: &mut Context<Self>) {
        let q = q.to_string();
        self.input.update(cx, |s, cx| s.set_value(q, window, cx));
        self.refilter(cx);
    }

    /// Søgeteksten uden mellemrum i enderne.
    pub fn query(&self, cx: &App) -> String {
        self.input.read(cx).value().trim().to_string()
    }

    fn create(&mut self, cx: &mut Context<Self>) {
        let name = self.query(cx);
        cx.emit(PickerEvent::Create(name));
    }

    /// Tøm søgningen og giv feltet fokus. Kaldes, når vælgeren åbnes.
    pub fn open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.input.update(cx, |s, cx| {
            s.set_value("", window, cx);
            s.focus(window, cx);
        });
        self.refilter(cx);
    }

    fn refilter(&mut self, cx: &mut Context<Self>) {
        let q = self.input.read(cx).value();
        self.matches = fuzzy::rank(&self.haystacks, &q, LIMIT);
        self.selected = 0;
        self.scroll.scroll_to_item(0, ScrollStrategy::Top);
        cx.notify();
    }

    pub fn pick(&mut self, pos: usize, cx: &mut Context<Self>) {
        if let Some(&ix) = self.matches.get(pos) {
            cx.emit(PickerEvent::Picked(ix));
        }
    }

    fn on_key(&mut self, ev: &KeyDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        let n = self.matches.len();
        match ev.keystroke.key.as_str() {
            "down" if n > 0 => self.selected = (self.selected + 1).min(n - 1),
            "up" => self.selected = self.selected.saturating_sub(1),
            "enter" => {
                cx.stop_propagation();
                // Ingen træffere: Enter opretter kunden med søgeteksten.
                if n == 0 && self.create && !self.query(cx).is_empty() {
                    return self.create(cx);
                }
                return self.pick(self.selected, cx);
            }
            "escape" => {
                cx.stop_propagation();
                return cx.emit(PickerEvent::Dismissed);
            }
            _ => return,
        }
        cx.stop_propagation();
        self.scroll
            .scroll_to_item(self.selected, ScrollStrategy::Center);
        cx.notify();
    }
}

impl Picker {
    /// "Opret kunde 'X'" (med søgeteksten) og "Ny kunde" i den tomme tilstand.
    fn render_create(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let id = self.id;
        let name = self.query(cx);
        h_flex()
            .gap_2()
            .pt_2()
            .when(!name.is_empty(), |d| {
                d.child(
                    Button::new(SharedString::from(format!("{id}-opret")))
                        .primary()
                        .label(tf("ui.picker.create_customer", &[("name", &name)]))
                        .on_click(cx.listener(|this, _, _, cx| this.create(cx))),
                )
            })
            .child(
                Button::new(SharedString::from(format!("{id}-ny-kunde")))
                    .when(name.is_empty(), |b| b.primary())
                    .label(t("ui.picker.new_customer"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        let name = this.query(cx);
                        cx.emit(PickerEvent::NewCustomer(name))
                    })),
            )
    }
}

impl Render for Picker {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let id = self.id;
        let count = self.matches.len();
        v_flex()
            .w(px(560.))
            .h(px(440.))
            .gap_2()
            .p_3()
            .rounded(px(12.))
            .bg(b.surface)
            .border_1()
            .border_color(b.border)
            .shadow_lg()
            .capture_key_down(cx.listener(Self::on_key))
            .child(ui::heading(
                &b,
                SharedString::from(format!("{id}-titel")),
                self.title.clone(),
                2,
            ))
            .child(
                Input::new(&self.input)
                    .id(SharedString::from(format!("{id}-soeg")))
                    .aria_label(t("ui.picker.search")),
            )
            .child(
                ui::muted(
                    &b,
                    SharedString::from(format!("{id}-antal")),
                    tf("ui.picker.count", &[("count", &count.to_string())]),
                )
                .text_xs(),
            )
            .child(
                ui::el(
                    SharedString::from(format!("{id}-liste")),
                    Role::ListBox,
                    self.title.clone(),
                )
                .flex_1()
                .min_h_0()
                .child(
                    uniform_list(
                        SharedString::from(format!("{id}-rækker")),
                        count,
                        cx.processor(move |this, range: std::ops::Range<usize>, _, cx| {
                            let b = brand(cx);
                            range
                                .map(|pos| {
                                    let item = &this.items[this.matches[pos]];
                                    let sel = pos == this.selected;
                                    h_flex()
                                        .child(
                                            ui::el((id, pos), Role::ListBoxOption, item.label())
                                                .aria_selected(sel)
                                                .flex()
                                                .items_center()
                                                .justify_between()
                                                .w_full()
                                                .h(px(36.))
                                                .px_2()
                                                .gap_2()
                                                .rounded(px(6.))
                                                .cursor_pointer()
                                                .when(sel, |d| d.bg(b.primary_soft))
                                                .hover(|d| d.bg(b.card))
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.pick(pos, cx)
                                                }))
                                                .child(
                                                    div()
                                                        .text_sm()
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .text_color(b.ink)
                                                        .truncate()
                                                        .child(item.title.clone()),
                                                )
                                                .child(
                                                    div()
                                                        .text_sm()
                                                        .text_color(b.grey)
                                                        .truncate()
                                                        .child(item.detail.clone()),
                                                ),
                                        )
                                        .w_full()
                                })
                                .collect()
                        }),
                    )
                    .track_scroll(&self.scroll)
                    .size_full(),
                ),
            )
            .when(count == 0, |d| {
                let empty = ui::empty_state(
                    &b,
                    SharedString::from(format!("{id}-tom")),
                    t("ui.picker.none"),
                    if self.create {
                        t("ui.picker.none_hint_create")
                    } else {
                        t("ui.picker.none_hint")
                    },
                );
                d.child(if self.create {
                    empty.child(self.render_create(cx))
                } else {
                    empty
                })
            })
    }
}
