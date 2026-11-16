//! Kunder: liste med søgning (aktive og arkiverede), opret og ret, arkivér og
//! genaktivér, og et kundekort med projekter, klippekort, ufaktureret tid og
//! seneste poster.
//!
//! Tastatur: N = ny kunde, pil op/ned = forrige/næste kunde, Enter i
//! søgefeltet vælger første træffer, Esc lukker formularen.

use chrono::Datelike as _;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{BackendError, Customer, CustomerInput, Entry, Id, PunchCard, Project};
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf};
use crate::ui::forms::{self, matches_query};
use crate::ui::{self, Loadable, Tone, format};

/// Alt på kundekortet, hentet samlet.
#[derive(Clone, Debug)]
pub struct Detail {
    pub projects: Vec<Project>,
    pub cards: Vec<PunchCard>,
    pub uninvoiced: Vec<Entry>,
    pub recent: Vec<Entry>,
}

/// Fejl pr. felt i kundeformularen.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CustomerErrors {
    pub name: Option<&'static str>,
    pub cvr: Option<&'static str>,
    pub email: Option<&'static str>,
    pub rate: Option<&'static str>,
    pub color: Option<&'static str>,
    /// Datalagets tekst om domænerne (dansk, som web's).
    pub domains: Option<String>,
}

/// Validerer formularens felter. Ren funktion, så den kan testes.
pub fn validate_customer(
    name: &str,
    cvr: &str,
    email: &str,
    rate: &str,
) -> Result<CustomerInput, CustomerErrors> {
    let mut err = CustomerErrors::default();
    if name.trim().is_empty() {
        err.name = Some(t("kunder.fejl.navn"));
    }
    let cvr = forms::parse_cvr(cvr).map_err(|e| err.cvr = Some(e)).ok();
    let email = forms::parse_email(email)
        .map_err(|e| err.email = Some(e))
        .ok();
    let rate = forms::parse_kr(rate).map_err(|e| err.rate = Some(e)).ok();
    if err != CustomerErrors::default() {
        return Err(err);
    }
    Ok(CustomerInput {
        name: name.trim().to_string(),
        cvr: cvr.flatten(),
        email: email.flatten(),
        hourly_rate: rate.flatten(),
        ..Default::default()
    })
}

/// Farve, telefon, noter og domæner oven på de grundlæggende felter.
/// Domænerne skrives adskilt af komma, mellemrum eller linjeskift.
pub fn validate_extras(
    mut input: CustomerInput,
    color: &str,
    phone: &str,
    notes: &str,
    domains: &str,
) -> Result<CustomerInput, CustomerErrors> {
    let mut err = CustomerErrors::default();
    match crate::ui::farver::normalize_hex(color) {
        Ok(c) => input.color = Some(c.unwrap_or_default()),
        Err(_) => err.color = Some(t("maal.kunde.fejl_farve")),
    }
    let list: Vec<String> = domains
        .split([',', ' ', '\n', ';'])
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_string)
        .collect();
    match tt_data::normalize_client_domains(&list) {
        Ok(d) => input.domains = Some(d),
        Err(e) => err.domains = Some(e),
    }
    input.phone = Some(phone.trim().to_string());
    input.notes = Some(notes.trim().to_string());
    if err != CustomerErrors::default() {
        return Err(err);
    }
    Ok(input)
}

/// Kunderne på den valgte fane, filtreret på søgningen (navn, e-mail, CVR).
pub fn visible<'a>(all: &'a [Customer], archived: bool, query: &str) -> Vec<&'a Customer> {
    let mut v: Vec<&Customer> = all
        .iter()
        .filter(|c| c.archived == archived)
        .filter(|c| {
            let hay = format!(
                "{} {} {}",
                c.name,
                c.email.as_deref().unwrap_or(""),
                c.cvr.as_deref().unwrap_or("")
            );
            matches_query(&hay, query)
        })
        .collect();
    v.sort_by_key(|c| c.name.to_lowercase());
    v
}

struct CustomerForm {
    editing: Option<Id>,
    name: Entity<InputState>,
    cvr: Entity<InputState>,
    email: Entity<InputState>,
    rate: Entity<InputState>,
    /// ux-vaelger: farve (hex), telefon, noter og domæner.
    color: Entity<InputState>,
    phone: Entity<InputState>,
    notes: Entity<InputState>,
    domains: Entity<InputState>,
    archived: bool,
    errors: CustomerErrors,
    error: Option<SharedString>,
    busy: bool,
}

pub struct KunderScreen {
    ctx: AppCtx,
    focus: FocusHandle,
    customers: Loadable<Vec<Customer>>,
    search: Entity<InputState>,
    query: String,
    show_archived: bool,
    selected: Option<Id>,
    detail: Loadable<Detail>,
    form: Option<CustomerForm>,
    /// Kvittering eller fejl efter en handling (rolle `Status`/`Alert`).
    notice: Option<(SharedString, bool)>,
    /// `TT_DEMO=formular`: åbn formularen, når data er hentet (skærmbilleder).
    demo_form: bool,
    _subs: Vec<Subscription>,
}

impl KunderScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder(t("kunder.soeg")));
        let subs = vec![
            cx.observe(&ctx.hub, |this, _, cx| this.reload(cx)),
            cx.subscribe_in(&search, window, |this, state, ev: &InputEvent, _, cx| {
                match ev {
                    InputEvent::Change => {
                        this.query = state.read(cx).value().to_string();
                        cx.notify();
                    }
                    InputEvent::PressEnter { .. } => {
                        if let Some(first) = this.visible_ids().first().cloned() {
                            this.select(first, cx);
                        }
                    }
                    _ => {}
                }
            }),
        ];
        let mut this = KunderScreen {
            ctx,
            focus: cx.focus_handle(),
            customers: Loadable::Loading,
            search,
            query: String::new(),
            show_archived: false,
            selected: None,
            detail: Loadable::Loading,
            form: None,
            notice: None,
            demo_form: std::env::var("TT_DEMO").is_ok_and(|d| d == "formular" || d.contains("kunde-ret")),
            _subs: subs,
        };
        this.reload(cx);
        this
    }

    pub fn reload(&mut self, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            |b| b.customers(true),
            |this, res, cx| {
                this.customers = Loadable::from_result(res);
                let ids = this.visible_ids();
                let keep = this
                    .selected
                    .as_ref()
                    .is_some_and(|s| this.all().iter().any(|c| &c.id == s));
                if !keep {
                    this.selected = ids.first().cloned();
                }
                this.load_detail(cx);
            },
        );
    }

    fn all(&self) -> &[Customer] {
        self.customers.ready().map(Vec::as_slice).unwrap_or(&[])
    }

    fn visible_ids(&self) -> Vec<Id> {
        visible(self.all(), self.show_archived, &self.query)
            .into_iter()
            .map(|c| c.id.clone())
            .collect()
    }

    fn selected_customer(&self) -> Option<&Customer> {
        let id = self.selected.as_ref()?;
        self.all().iter().find(|c| &c.id == id)
    }

    fn select(&mut self, id: Id, cx: &mut Context<Self>) {
        if self.selected.as_ref() != Some(&id) {
            self.selected = Some(id);
            self.detail = Loadable::Loading;
            self.load_detail(cx);
        }
        cx.notify();
    }

    fn load_detail(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected.clone() else {
            return;
        };
        let q = id.clone();
        self.ctx.fetch(
            cx,
            move |b| {
                Ok(Detail {
                    projects: b.projects(Some(&q), true)?,
                    cards: b.punch_cards(Some(&q))?,
                    uninvoiced: b.uninvoiced_entries(&q)?,
                    recent: b.recent_entries(&q, 5)?,
                })
            },
            move |this, res, _| {
                if this.selected.as_ref() == Some(&id) {
                    this.detail = Loadable::from_result(res);
                }
            },
        );
    }

    fn move_selection(&mut self, delta: i32, cx: &mut Context<Self>) {
        let ids = self.visible_ids();
        if ids.is_empty() {
            return;
        }
        let cur = self
            .selected
            .as_ref()
            .and_then(|s| ids.iter().position(|i| i == s));
        let next = match cur {
            Some(i) => (i as i32 + delta).clamp(0, ids.len() as i32 - 1) as usize,
            None => 0,
        };
        self.select(ids[next].clone(), cx);
    }

    fn set_tab(&mut self, archived: bool, cx: &mut Context<Self>) {
        self.show_archived = archived;
        let ids = self.visible_ids();
        if !self.selected.as_ref().is_some_and(|s| ids.contains(s)) {
            self.selected = ids.first().cloned();
            self.detail = Loadable::Loading;
            self.load_detail(cx);
        }
        cx.notify();
    }

    pub fn open_form(&mut self, edit: bool, window: &mut Window, cx: &mut Context<Self>) {
        let existing = if edit {
            self.selected_customer().cloned()
        } else {
            None
        };
        let c = existing.as_ref();
        let form = CustomerForm {
            editing: c.map(|c| c.id.clone()),
            name: forms::input(
                t("kunder.formular.navn_placeholder"),
                c.map_or("", |c| &c.name),
                window,
                cx,
            ),
            cvr: forms::input(
                t("kunder.formular.cvr_placeholder"),
                c.and_then(|c| c.cvr.as_deref()).unwrap_or(""),
                window,
                cx,
            ),
            email: forms::input(
                t("kunder.formular.email_placeholder"),
                c.and_then(|c| c.email.as_deref()).unwrap_or(""),
                window,
                cx,
            ),
            rate: forms::input(
                t("kunder.formular.timepris_placeholder"),
                &c.and_then(|c| c.hourly_rate)
                    .map(forms::kr_field)
                    .unwrap_or_default(),
                window,
                cx,
            ),
            color: forms::input("#3b82f6", c.and_then(|c| c.color.as_deref()).unwrap_or(""), window, cx),
            phone: forms::input(
                t("maal.kunde.telefon_placeholder"),
                c.and_then(|c| c.phone.as_deref()).unwrap_or(""),
                window,
                cx,
            ),
            notes: forms::input(
                t("maal.kunde.noter_placeholder"),
                c.and_then(|c| c.notes.as_deref()).unwrap_or(""),
                window,
                cx,
            ),
            domains: forms::input(
                "bageriet.dk, bageriet.com",
                &c.map(|c| c.domains.join(", ")).unwrap_or_default(),
                window,
                cx,
            ),
            archived: c.is_some_and(|c| c.archived),
            errors: CustomerErrors::default(),
            error: None,
            busy: false,
        };
        form.name.update(cx, |s, cx| s.focus(window, cx));
        self.form = Some(form);
        cx.notify();
    }

    fn close_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.form = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn save_form(&mut self, cx: &mut Context<Self>) {
        let Some(form) = self.form.as_mut() else {
            return;
        };
        let base = validate_customer(
            &forms::value(&form.name, cx),
            &forms::value(&form.cvr, cx),
            &forms::value(&form.email, cx),
            &forms::value(&form.rate, cx),
        );
        let extras = validate_extras(
            CustomerInput::default(),
            &forms::value(&form.color, cx),
            &forms::value(&form.phone, cx),
            &forms::value(&form.notes, cx),
            &forms::value(&form.domains, cx),
        );
        // Alle fejl på én gang: de grundlæggende og de nye felters.
        let res = match (base, extras) {
            (Ok(b), Ok(x)) => Ok(CustomerInput {
                color: x.color,
                phone: x.phone,
                notes: x.notes,
                domains: x.domains,
                ..b
            }),
            (b, x) => {
                let mut e = b.err().unwrap_or_default();
                if let Err(xe) = x {
                    e.color = xe.color;
                    e.domains = xe.domains;
                }
                Err(e)
            }
        };
        let input = match res {
            Ok(i) => i,
            Err(e) => {
                form.errors = e;
                cx.notify();
                return;
            }
        };
        form.errors = CustomerErrors::default();
        form.error = None;
        form.busy = true;
        let editing = form.editing.clone();
        self.ctx.mutate(
            cx,
            move |b| match editing {
                Some(id) => b.update_customer(&id, input),
                None => b.create_customer(input),
            },
            |this, res, cx| match res {
                Ok(c) => {
                    this.form = None;
                    this.notice = Some((tf("kunder.besked.gemt", &[("navn", &c.name)]).into(), false));
                    this.selected = Some(c.id);
                    this.show_archived = c.archived;
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

    fn toggle_archived(&mut self, cx: &mut Context<Self>) {
        let Some(c) = self.selected_customer().cloned() else {
            return;
        };
        let archive = !c.archived;
        self.ctx.mutate(
            cx,
            move |b| b.set_customer_archived(&c.id, archive),
            move |this, res: Result<(), BackendError>, _| match res {
                Ok(()) => {
                    this.show_archived = archive;
                    let msg = if archive {
                        t("kunder.besked.arkiveret")
                    } else {
                        t("kunder.besked.aktiv_igen")
                    };
                    this.notice = Some((msg.into(), false));
                }
                Err(e) => this.notice = Some((e.to_string().into(), true)),
            },
        );
    }

    fn on_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.form.is_some() || !self.focus.is_focused(window) {
            return;
        }
        let m = &ev.keystroke.modifiers;
        if m.platform || m.control || m.alt {
            return;
        }
        match ev.keystroke.key.as_str() {
            "n" => self.open_form(false, window, cx),
            "down" | "j" => self.move_selection(1, cx),
            "up" | "k" => self.move_selection(-1, cx),
            "/" => self.search.update(cx, |s, cx| s.focus(window, cx)),
            _ => return,
        }
        cx.stop_propagation();
    }

    fn render_list(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let rows = visible(self.all(), self.show_archived, &self.query);
        if rows.is_empty() {
            let (title, body) = if !self.query.trim().is_empty() {
                (
                    t("kunder.tom.ingen_traeffere"),
                    t("kunder.tom.ingen_traeffere_tekst"),
                )
            } else if self.show_archived {
                (
                    t("kunder.tom.ingen_arkiverede"),
                    t("kunder.tom.ingen_arkiverede_tekst"),
                )
            } else {
                (
                    t("kunder.tom.ingen_kunder"),
                    t("kunder.tom.ingen_kunder_tekst"),
                )
            };
            return ui::empty_state_icon(b, "kunder-tom", Icon::Users, title, body)
                .child(
                    Button::new("kunder-tom-ny")
                        .icon(Icon::UserPlus)
                        .label(t("kunder.ny"))
                        .primary()
                        .on_click(cx.listener(|this, _, w, cx| this.open_form(false, w, cx))),
                )
                .into_any_element();
        }
        ui::list(
            "kunde-liste",
            tf("kunder.liste.label", &[("n", &rows.len().to_string())]),
        )
            .children(rows.into_iter().enumerate().map(|(i, c)| {
                let active = self.selected.as_ref() == Some(&c.id);
                let sub = match (c.email.as_deref(), c.hourly_rate) {
                    (Some(e), _) => e.to_string(),
                    (None, Some(r)) => tf("kunder.pris_pr_time", &[("pris", &format::money(r))]),
                    (None, None) => t("kunder.standardsats").to_string(),
                };
                let id = c.id.clone();
                ui::list_row(
                    b,
                    SharedString::from(format!("kunde-{i}")),
                    format!(
                        "{}, {sub}{}",
                        c.name,
                        if active { t("kunder.valgt_suffiks") } else { "" }
                    ),
                )
                .aria_selected(active)
                .cursor_pointer()
                .when(active, |d| d.bg(b.primary_soft))
                .when(!active, |d| d.hover(|d| d.bg(b.border.opacity(0.5))))
                .on_click(cx.listener(move |this, _, _, cx| this.select(id.clone(), cx)))
                // Kundens farve fra web (eller web's udledte).
                .child(div().size(px(10.)).flex_none().rounded_full().bg(crate::ui::farver::customer_color(c)))
                .child(
                    v_flex()
                        .min_w_0()
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(if active { b.primary } else { b.ink })
                                .child(c.name.clone()),
                        )
                        .child(div().text_xs().text_color(b.grey).child(sub)),
                )
            }))
            .into_any_element()
    }

    fn render_detail(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let Some(c) = self.selected_customer() else {
            return ui::empty_state_icon(
                b,
                "kundekort-tom",
                Icon::User,
                t("kunder.kort.vaelg"),
                t("kunder.kort.vaelg_tekst"),
            )
            .into_any_element();
        };
        let rate = c
            .hourly_rate
            .map(|r| tf("kunder.pris_pr_time", &[("pris", &format::money(r))]))
            .unwrap_or_else(|| t("kunder.standardsats").into());
        let facts = [
            (
                t("kunder.kort.cvr"),
                c.cvr
                    .clone()
                    .unwrap_or_else(|| t("kunder.kort.ikke_angivet").into()),
            ),
            (
                t("kunder.kort.email"),
                c.email
                    .clone()
                    .unwrap_or_else(|| t("kunder.kort.ikke_angivet").into()),
            ),
            (t("kunder.kort.timepris"), rate),
        ]
        .into_iter()
        // ux-vaelger: telefon og domæner, når de findes.
        .chain(c.phone.clone().map(|p| (t("maal.kunde.telefon"), p)))
        .chain((!c.domains.is_empty()).then(|| (t("maal.kunde.domaener"), c.domains.join(", "))))
        .collect::<Vec<_>>();
        let header = h_flex()
            .justify_between()
            .items_start()
            .gap_3()
            .child(
                v_flex()
                    .gap_1()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(div().size(px(12.)).flex_none().rounded_full().bg(crate::ui::farver::customer_color(c)))
                            .child(ui::heading(b, "kundekort-navn", c.name.clone(), 2).text_lg().text_color(b.ink))
                            .when(c.archived, |d| {
                                d.child(ui::badge(b, "kundekort-arkiveret", t("kunder.kort.arkiveret"), Tone::Neutral))
                            }),
                    )
                    .child(h_flex().gap_4().flex_wrap().children(facts.into_iter().enumerate().map(
                        |(i, (k, v))| {
                            ui::text(SharedString::from(format!("kundekort-fakta-{i}")), tf("kunder.kort.fakta", &[("navn", k), ("vaerdi", &v)]))
                                .text_sm()
                                .text_color(b.grey)
                        },
                    ))),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("kunde-ret")
                            .icon(Icon::Pencil)
                            .label(t("kunder.kort.ret"))
                            .small()
                            .outline()
                            .on_click(cx.listener(|this, _, w, cx| this.open_form(true, w, cx))),
                    )
                    .child(
                        Button::new("kunde-arkiver")
                            .icon(if c.archived { Icon::RefreshCw } else { Icon::Archive })
                            .label(if c.archived {
                                t("kunder.kort.genaktiver")
                            } else {
                                t("kunder.kort.arkiver")
                            })
                            .small()
                            .outline()
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_archived(cx))),
                    ),
            );
        let body = match &self.detail {
            Loadable::Loading => ui::loading_state(b, "kundekort-indlaeser", t("kunder.kort.indlaeser")).into_any_element(),
            Loadable::Failed(e) => ui::error_state(b, "kundekort-fejl", e.clone())
                .child(
                    Button::new("kundekort-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("kunder.proev_igen"))
                        .on_click(cx.listener(|this, _, _, cx| this.load_detail(cx))),
                )
                .into_any_element(),
            Loadable::Ready(d) => self.render_sections(b, d).into_any_element(),
        };
        ui::card(
            b,
            "kundekort",
            tf("kunder.kort.label", &[("navn", &c.name)]),
        )
            .flex_1()
            .min_w_0()
            .child(header)
            .child(body)
            .into_any_element()
    }

    fn render_sections(&self, b: &Brand, d: &Detail) -> impl IntoElement {
        let today = self.ctx.backend.today();
        let year = today.year();
        let section = |id: &'static str, title: &'static str| {
            v_flex()
                .gap_2()
                .pt_2()
                .border_t_1()
                .border_color(b.border)
                .child(ui::heading(b, SharedString::from(format!("{id}-titel")), title, 3))
        };
        let projects = section("kundekort-projekter", t("kunder.sektion.projekter")).child(if d.projects.is_empty() {
            ui::muted(b, "kundekort-projekter-tom", t("kunder.sektion.ingen_projekter")).into_any_element()
        } else {
            ui::list("kundekort-projektliste", t("kunder.sektion.projekter"))
                .children(d.projects.iter().enumerate().map(|(i, p)| {
                    let budget = p
                        .budget_minutes
                        .map(|m| tf("kunder.sektion.budget", &[("timer", &format::hours(m))]))
                        .unwrap_or_default();
                    ui::list_row(
                        b,
                        SharedString::from(format!("kundekort-projekt-{i}")),
                        tf(
                            "kunder.sektion.projekt_label",
                            &[
                                ("navn", &p.name),
                                ("status", super::projekter::status_label(p.status)),
                                ("budget", &budget),
                            ],
                        ),
                    )
                    .px_0()
                    .py_1()
                    .child(div().flex_1().child(p.name.clone()))
                    .child(div().text_xs().text_color(b.grey).child(budget))
                    .child(ui::badge(
                        b,
                        SharedString::from(format!("kundekort-projekt-{i}-status")),
                        super::projekter::status_label(p.status),
                        status_tone(p.status),
                    ))
                }))
                .into_any_element()
        });
        let cards = section("kundekort-klippekort", t("kunder.sektion.klippekort")).child(if d.cards.is_empty() {
            ui::muted(b, "kundekort-klippekort-tom", t("kunder.sektion.ingen_klippekort")).into_any_element()
        } else {
            v_flex()
                .gap_3()
                .children(d.cards.iter().enumerate().map(|(i, k)| {
                    v_flex()
                        .gap_1()
                        .child(ui::text(SharedString::from(format!("kundekort-kort-{i}")), k.name.clone()).text_sm())
                        .child(ui::punch_card_holes(
                            b,
                            SharedString::from(format!("kundekort-kort-{i}-huller")),
                            k.total_minutes,
                            k.used_minutes,
                        ))
                        .child(ui::muted(
                            b,
                            SharedString::from(format!("kundekort-kort-{i}-saldo")),
                            crate::ui::punch::describe(k.total_minutes, k.used_minutes),
                        ))
                }))
                .into_any_element()
        });
        let un_minutes: u32 = d.uninvoiced.iter().map(|e| e.minutes).sum();
        let un_text = if d.uninvoiced.is_empty() {
            t("kunder.sektion.ingen_ufaktureret").to_string()
        } else {
            tf(
                if d.uninvoiced.len() == 1 {
                    "kunder.sektion.ufaktureret_en_post"
                } else {
                    "kunder.sektion.ufaktureret_poster"
                },
                &[
                    ("timer", &format::hours(un_minutes)),
                    ("n", &d.uninvoiced.len().to_string()),
                ],
            )
        };
        let uninvoiced = section("kundekort-ufaktureret", t("kunder.sektion.ufaktureret"))
            .child(ui::text("kundekort-ufaktureret-sum", un_text).text_sm());
        let recent = section("kundekort-seneste", t("kunder.sektion.seneste")).child(if d.recent.is_empty() {
            ui::muted(b, "kundekort-seneste-tom", t("kunder.sektion.ingen_poster")).into_any_element()
        } else {
            ui::list("kundekort-postliste", t("kunder.sektion.seneste"))
                .children(d.recent.iter().enumerate().map(|(i, e)| {
                    let date = format::date_medium(e.date, year);
                    ui::list_row(
                        b,
                        SharedString::from(format!("kundekort-post-{i}")),
                        format!(
                            "{date}, {}, {}, {}",
                            format::span(e.start, e.end),
                            format::hours(e.minutes),
                            e.description
                        ),
                    )
                    .px_0()
                    .py_1()
                    .child(div().w(px(80.)).text_color(b.grey).child(date))
                    .child(div().flex_1().min_w_0().child(e.description.clone()))
                    .child(div().text_color(b.grey).child(format::hours(e.minutes)))
                }))
                .into_any_element()
        });
        v_flex()
            .gap_3()
            .child(projects)
            .child(cards)
            .child(uninvoiced)
            .child(recent)
    }

    /// Farve: web's palet som knapper, hex-felt og (lokalt) "ingen".
    fn render_color(&self, b: &Brand, f: &CustomerForm, cx: &mut Context<Self>) -> impl IntoElement {
        let current = crate::ui::farver::normalize_hex(&forms::value(&f.color, cx)).ok().flatten();
        let names = [
            t("maal.kunde.farve.blaa"),
            t("maal.kunde.farve.groen"),
            t("maal.kunde.farve.gul"),
            t("maal.kunde.farve.roed"),
            t("maal.kunde.farve.lilla"),
            t("maal.kunde.farve.pink"),
            t("maal.kunde.farve.cyan"),
            t("maal.kunde.farve.lime"),
        ];
        let cloud = matches!(self.ctx.backend.mode(), crate::backend::Mode::Cloud { .. });
        let swatch = |i: usize, hex: &'static str, name: &'static str, cx: &mut Context<Self>| {
            let selected = current.as_deref() == Some(hex);
            let label = if selected {
                format!("{name} {hex}, {}", t("maal.altid.valgt"))
            } else {
                format!("{name} {hex}")
            };
            let color = crate::ui::farver::color_for("", Some(hex));
            ui::el(SharedString::from(format!("kunde-farve-{i}")), Role::RadioButton, label)
                .aria_selected(selected)
                .size(px(26.))
                .rounded_full()
                .border_2()
                .border_color(if selected { b.ink } else { b.card.opacity(0.) })
                .p(px(2.))
                .cursor_pointer()
                .on_click(cx.listener(move |this, _, w, cx| this.set_color(hex, w, cx)))
                .child(div().size_full().rounded_full().bg(color))
        };
        let mut row = h_flex().gap_1p5().items_center();
        for (i, hex) in crate::ui::farver::PALETTE.iter().enumerate() {
            row = row.child(swatch(i, hex, names[i], cx));
        }
        v_flex()
            .gap_1()
            .child(
                ui::text("kunde-farve-etiket", t("maal.kunde.farve"))
                    .text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(b.grey),
            )
            .child(
                ui::el("kunde-farve", Role::RadioGroup, t("maal.kunde.farve"))
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(row)
                    .child(div().w(px(110.)).child(Input::new(&f.color).id("kunde-farve-hex").aria_label(t("maal.kunde.farve_hex"))))
                    .when(!cloud && current.is_some(), |d| {
                        d.child(ui::a11y_button(
                            "kunde-farve-ingen",
                            t("maal.kunde.farve_ingen"),
                            false,
                            |b| b.ghost().small(),
                            cx.listener(|this, _, w, cx| this.set_color("", w, cx)),
                        ))
                    }),
            )
            .children(f.errors.color.map(|e| forms::form_error(b, "kunde-farve-fejl", e)))
            .child(
                ui::muted(
                    b,
                    "kunde-farve-hjaelp",
                    if cloud { t("maal.kunde.farve_hjaelp_cloud") } else { t("maal.kunde.farve_hjaelp") },
                )
                .text_xs(),
            )
    }

    fn set_color(&mut self, hex: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(f) = self.form.as_mut() {
            let hex = hex.to_string();
            f.color.update(cx, |s, cx| s.set_value(hex, window, cx));
            f.errors.color = None;
        }
        cx.notify();
    }

    fn render_form(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let f = self.form.as_ref()?;
        let title = if f.editing.is_some() {
            t("kunder.formular.titel_ret")
        } else {
            t("kunder.ny")
        };
        let (overlay, dialog) = forms::modal(b, "kunde-formular", title);
        let err = |e: Option<&'static str>| e.map(SharedString::from);
        Some(
            overlay.child(
                dialog
                    .child(forms::text_field(b, "kunde-navn", t("kunder.formular.navn"), &f.name, err(f.errors.name)))
                    .child(
                        h_flex()
                            .gap_3()
                            .items_start()
                            .child(forms::text_field(b, "kunde-cvr", t("kunder.formular.cvr"), &f.cvr, err(f.errors.cvr)))
                            .child(forms::text_field(
                                b,
                                "kunde-timepris",
                                t("kunder.formular.timepris"),
                                &f.rate,
                                err(f.errors.rate),
                            )),
                    )
                    .child(
                        h_flex()
                            .gap_3()
                            .items_start()
                            .child(forms::text_field(b, "kunde-email", t("kunder.formular.email"), &f.email, err(f.errors.email)))
                            .child(forms::text_field(b, "kunde-telefon", t("maal.kunde.telefon"), &f.phone, None)),
                    )
                    .child(self.render_color(b, f, cx))
                    .child(
                        forms::text_field(
                            b,
                            "kunde-domaener",
                            t("maal.kunde.domaener"),
                            &f.domains,
                            f.errors.domains.clone().map(SharedString::from),
                        )
                        .child(ui::muted(b, "kunde-domaener-hjaelp", t("maal.kunde.domaener_hjaelp")).text_xs()),
                    )
                    .child(forms::text_field(b, "kunde-noter", t("maal.kunde.noter"), &f.notes, None))
                    .children(f.editing.is_some().then(|| {
                        ui::a11y_button(
                            "kunde-formular-arkiver",
                            if f.archived { t("maal.kunde.genaktiver") } else { t("maal.kunde.arkiver") },
                            f.busy,
                            |b| b.ghost().small().icon(Icon::Archive),
                            cx.listener(|this, _, w, cx| {
                                this.close_form(w, cx);
                                this.toggle_archived(cx);
                            }),
                        )
                    }))
                    .children(f.error.clone().map(|e| forms::form_error(b, "kunde-formular-fejl", e)))
                    .child(forms::form_buttons(
                        "kunde-formular",
                        t("kunder.formular.gem"),
                        f.busy,
                        cx.listener(|this, _, _, cx| this.save_form(cx)),
                        cx.listener(|this, _, w, cx| this.close_form(w, cx)),
                    )),
            ),
        )
    }
}

fn status_tone(s: crate::backend::ProjectStatus) -> Tone {
    use crate::backend::ProjectStatus::*;
    match s {
        Active => Tone::Primary,
        Paused => Tone::Warning,
        Completed | Archived => Tone::Neutral,
    }
}

impl Render for KunderScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.demo_form && self.customers.ready().is_some() {
            self.demo_form = false;
            self.open_form(true, window, cx);
        }
        let b = brand(cx);
        let n_active = self.all().iter().filter(|c| !c.archived).count();
        let toolbar = h_flex()
            .gap_3()
            .items_center()
            .child(
                div()
                    .w(px(280.))
                    .child(Input::new(&self.search).id("kunder-soeg").aria_label(t("kunder.soeg")).cleanable(true)),
            )
            .child(forms::segmented(
                &b,
                "kunder-fane",
                t("kunder.fane.label"),
                &[t("kunder.fane.aktive"), t("kunder.fane.arkiverede")],
                self.show_archived as usize,
                {
                    let view = cx.entity().downgrade();
                    move |ix, _, cx| {
                        let _ = view.update(cx, |this, cx| this.set_tab(ix == 1, cx));
                    }
                },
            ))
            .child(div().flex_1())
            .child(
                Button::new("kunde-ny")
                    .icon(Icon::UserPlus)
                    .label(t("kunder.ny"))
                    .primary()
                    .tooltip("N")
                    .on_click(cx.listener(|this, _, w, cx| this.open_form(false, w, cx))),
            );
        let content = match &self.customers {
            Loadable::Loading => ui::loading_state(&b, "kunder-indlaeser", t("kunder.side.indlaeser")).into_any_element(),
            Loadable::Failed(e) => ui::error_state(&b, "kunder-fejl", e.clone())
                .child(
                    Button::new("kunder-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("kunder.proev_igen"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.customers = Loadable::Loading;
                            this.reload(cx);
                        })),
                )
                .into_any_element(),
            Loadable::Ready(_) => h_flex()
                .gap_4()
                .items_start()
                .child(div().w(px(300.)).flex_none().child(self.render_list(&b, cx)))
                .child(self.render_detail(&b, cx))
                .into_any_element(),
        };
        let notice = self.notice.clone().map(|(msg, is_err)| {
            ui::el(
                "kunder-besked",
                if is_err { Role::Alert } else { Role::Status },
                msg.clone(),
            )
            .text_sm()
            .text_color(if is_err { b.danger } else { b.primary })
            .child(msg)
        });
        div()
            .relative()
            .size_full()
            .track_focus(&self.focus)
            .key_context("Kunder")
            .on_key_down(cx.listener(Self::on_key))
            .capture_key_down(cx.listener(|this, ev: &KeyDownEvent, w, cx| {
                if ev.keystroke.key == "escape" && this.form.is_some() {
                    this.close_form(w, cx);
                    cx.stop_propagation();
                }
            }))
            .child(
                ui::page(
                    &b,
                    "kunder",
                    t("kunder.side.titel"),
                    Some(tf("kunder.side.undertitel", &[("n", &n_active.to_string())]).into()),
                )
                .child(toolbar)
                .children(notice)
                .child(content),
            )
            .children(self.render_form(&b, cx))
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_customer, validate_extras, visible};
    use crate::backend::CustomerInput;
    use crate::backend::Customer;

    fn c(id: &str, name: &str, archived: bool) -> Customer {
        Customer {
            id: id.into(),
            name: name.into(),
            email: None,
            hourly_rate: None,
            archived,
            cvr: None,
            ..Default::default()
        }
    }

    #[test]
    fn validering_samler_alle_fejl() {
        let e = validate_customer(" ", "123", "x@", "abc").unwrap_err();
        assert_eq!(e.name, Some("Skriv kundens navn"));
        assert!(e.cvr.is_some() && e.email.is_some() && e.rate.is_some());
        let ok = validate_customer(" Bageriet ", "1234 5678", "", "850,5").unwrap();
        assert_eq!(ok.name, "Bageriet");
        assert_eq!(ok.cvr.as_deref(), Some("12345678"));
        assert_eq!(ok.email, None);
        assert_eq!(ok.hourly_rate, Some(85_050));
    }

    #[test]
    fn farve_domaener_telefon_og_noter_valideres() {
        let base = CustomerInput { name: "Bageriet".into(), ..Default::default() };
        let ok = validate_extras(base.clone(), "F59E0B", " 12 34 ", " Ring før 10 ", "https://www.Bageriet.dk/, bageriet.com").unwrap();
        assert_eq!(ok.color.as_deref(), Some("#f59e0b"));
        assert_eq!(ok.domains, Some(vec!["bageriet.dk".to_string(), "bageriet.com".to_string()]));
        assert_eq!(ok.phone.as_deref(), Some("12 34"));
        assert_eq!(ok.notes.as_deref(), Some("Ring før 10"));
        // Tom farve = ingen farve ("" fjerner den lokalt).
        assert_eq!(validate_extras(base.clone(), "", "", "", "").unwrap().color.as_deref(), Some(""));
        let e = validate_extras(base, "#12345", "", "", "ikke et domæne!").unwrap_err();
        assert!(e.color.is_some());
        assert!(e.domains.is_some());
    }

    #[test]
    fn synlige_kunder_pr_fane_og_soegning() {
        let all = vec![
            c("1", "Café Åbrinken", false),
            c("2", "Bageriet", false),
            c("3", "Frisør Ærø", true),
        ];
        let names = |v: Vec<&Customer>| v.into_iter().map(|c| c.name.clone()).collect::<Vec<_>>();
        assert_eq!(names(visible(&all, false, "")), ["Bageriet", "Café Åbrinken"]);
        assert_eq!(names(visible(&all, true, "")), ["Frisør Ærø"]);
        assert_eq!(names(visible(&all, false, "åbr")), ["Café Åbrinken"]);
        assert!(visible(&all, false, "ærø").is_empty());
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe {
    use std::sync::Arc;

    use gpui_kit::{AppContext as _, TestAppContext};
    use gpui_kit::test::TestWindowExt as _;

    use crate::backend::{Backend as _, BackendError, MockBackend};
    use crate::screens::Screen;
    use crate::testing;

    #[gpui_kit::test]
    fn kunder_liste_kort_og_soegning(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Kunder);
        let a = testing::a11y(cx, h);
        println!("PROBE kunder {:?}", a.roles);
        assert_eq!(a.with_label, a.with_role, "alle roller har label");
        assert!(a.has_label("Kundekort: Advokatfirmaet Holm & Bæk"));
        assert!(a.has_label_containing("Kunder, 7 i alt"));
        assert!(a.has_label("Projekter"));
        assert!(a.has_label_containing("Klippekort:") || a.has_label("Ingen klippekort"));
        assert!(a.count("Meter") == 0 || a.has_label_containing("tilbage af"));

        // Søg og vælg med Enter.
        cx.update_window(h, |_, w, cx| {
            w.click("kunder-soeg", cx);
            w.input("bager", cx);
            w.press("enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Kunder, 1 i alt"));
        assert!(a.has_label("Kundekort: Bageriet på Hjørnet"));
        assert!(a.has_label("Klippekort: 7 t tilbage af 20 t"));

        // Arkiverede.
        cx.update_window(h, |_, w, cx| w.click("kunder-fane-1", cx)).unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Ingen træffere. Prøv et andet søgeord."));
    }

    /// ux-vaelger: "Ret" retter farve (palet), domæner, telefon og noter.
    #[gpui_kit::test]
    fn ret_kunde_med_farve_domaener_telefon_og_noter(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Kunder);
        let first = mock.customers(false).unwrap().into_iter().min_by_key(|c| c.name.to_lowercase()).unwrap();
        cx.update_window(h, |_, w, cx| w.click("kunde-ret", cx)).unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Farve"), "{:?}", a.labels);
        assert_eq!(a.count("RadioButton"), 8, "web's palet");
        cx.update_window(h, |_, w, cx| {
            w.click("kunde-farve-3", cx);
            w.click("kunde-domaener", cx);
            w.press("cmd-a", cx);
            w.input("holm-baek.dk, holmbaek.com", cx);
            w.click("kunde-telefon", cx);
            w.input("70 20 30 40", cx);
            w.click("kunde-noter", cx);
            w.input("Faktura til bogholderiet", cx);
            w.click("kunde-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 0, "formularen lukker");
        let c = mock.customers(true).unwrap().into_iter().find(|c| c.id == first.id).unwrap();
        assert_eq!(c.color.as_deref(), Some("#ef4444"));
        assert_eq!(c.domains, vec!["holm-baek.dk".to_string(), "holmbaek.com".to_string()]);
        assert_eq!(c.phone.as_deref(), Some("70 20 30 40"));
        assert_eq!(c.notes.as_deref(), Some("Faktura til bogholderiet"));
        assert!(testing::a11y(cx, h).has_label_containing("holm-baek.dk, holmbaek.com"));
    }

    #[gpui_kit::test]
    fn opret_med_validering_og_arkiver(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Kunder);
        cx.update_window(h, |_, w, cx| w.click("kunde-ny", cx)).unwrap();
        cx.run_until_parked();
        // Tom formular: fejl under navnet.
        cx.update_window(h, |_, w, cx| {
            w.click("kunde-cvr", cx);
            w.input("123", cx);
            w.click("kunde-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 1);
        assert!(a.has_label("Skriv kundens navn"));
        assert!(a.has_label("CVR-nummeret skal være 8 cifre"));
        // Udfyld og gem.
        cx.update_window(h, |_, w, cx| {
            w.click("kunde-navn", cx);
            w.input("Øens Cykler", cx);
            w.click("kunde-cvr", cx);
            w.press("cmd-a", cx);
            w.input("12345678", cx);
            w.click("kunde-timepris", cx);
            w.input("650", cx);
            w.click("kunde-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 0, "formularen lukker");
        assert!(a.has_label("Kundekort: Øens Cykler"));
        assert!(a.has_label("CVR: 12345678"));
        let c = mock
            .customers(false)
            .unwrap()
            .into_iter()
            .find(|c| c.name == "Øens Cykler")
            .expect("gemt");
        assert_eq!(c.hourly_rate, Some(65_000));

        // Arkivér.
        cx.update_window(h, |_, w, cx| w.click("kunde-arkiver", cx)).unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Kunden er arkiveret"));
        assert!(a.has_label("Arkiveret"));
        assert!(mock.customers(true).unwrap().iter().any(|x| x.id == c.id && x.archived));
        // Esc lukker en åben formular.
        cx.update_window(h, |_, w, cx| {
            w.click("kunde-ret", cx);
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 1);
        cx.update_window(h, |_, w, cx| w.press("escape", cx)).unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 0);
    }

    #[gpui_kit::test]
    fn tom_og_fejl(cx: &mut TestAppContext) {
        let empty = Arc::new(MockBackend::empty(testing::today()));
        let (h, app) = testing::open_app(cx, empty);
        testing::navigate(cx, h, &app, Screen::Kunder);
        assert!(testing::a11y(cx, h).has_label_containing("Ingen kunder endnu"));

        let broken = testing::mock();
        broken.set_failure(Some(BackendError::Offline));
        let (h, app) = testing::open_app(cx, broken);
        testing::navigate(cx, h, &app, Screen::Kunder);
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Fejl: Du er offline"));
    }
}
