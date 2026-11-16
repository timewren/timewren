//! Klippekort: kort pr. kunde med huller, saldo, advarsler (lav saldo, brugt
//! op, overtræk, udløber, udløbet), forbrugshistorik pr. kort og "Nyt klippekort".
//!
//! Tastatur: N = nyt klippekort (når skærmen har fokus), Enter i et felt
//! gemmer, Esc lukker formularen.

use std::collections::HashMap;

use chrono::{Datelike as _, NaiveDate};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::InputState;
use gpui_kit::component::select::SelectEvent;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{Customer, Id, PunchCard, PunchCardInput, PunchUsage};
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf};
use crate::ui::forms::{self, Choice, ChoiceList, ChoiceState};
use crate::ui::pickers;
use crate::ui::punch::describe;
use crate::ui::{self, Loadable, Tone, format, punch_card_holes};

/// Alt skærmen viser, hentet samlet.
#[derive(Clone, Debug)]
pub struct Data {
    pub customers: Vec<Customer>,
    pub cards: Vec<PunchCard>,
    /// gendan: arkiverede kort.
    pub archived: Vec<PunchCard>,
}

/// Advarsel på et kort.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flag {
    /// Under 2 timer tilbage (som 0.2).
    LowBalance,
    /// Præcis brugt op.
    Depleted,
    /// Brugt mere end kortet rummer (minutter over).
    Overdraft(u32),
    /// Udløber inden for 30 dage.
    ExpiresSoon(NaiveDate),
    Expired,
}

impl Flag {
    pub fn label(self, today: NaiveDate) -> String {
        match self {
            Flag::LowBalance => t("klippekort.flag.low").into(),
            Flag::Depleted => t("klippekort.flag.depleted").into(),
            Flag::Overdraft(m) => tf("klippekort.flag.overdraft", &[("hours", &format::hours(m))]),
            Flag::ExpiresSoon(d) => tf(
                "klippekort.flag.expires",
                &[("date", &format::date_medium(d, today.year()))],
            ),
            Flag::Expired => t("klippekort.flag.expired").into(),
        }
    }

    pub fn tone(self) -> Tone {
        match self {
            Flag::LowBalance | Flag::ExpiresSoon(_) => Tone::Warning,
            Flag::Overdraft(_) | Flag::Expired => Tone::Danger,
            Flag::Depleted => Tone::Neutral,
        }
    }
}

/// Lav saldo: under 2 t tilbage, som 0.2's `klippekort_low_threshold_hours`.
pub const LOW_BALANCE_MINUTES: i64 = 120;

/// Saldoen er lav (men ikke brugt op).
pub fn is_low(remaining_minutes: i64) -> bool {
    remaining_minutes > 0 && remaining_minutes < LOW_BALANCE_MINUTES
}

/// Teksten ved bekræftelse af et forslag eller en timer på kortet: "Træk
/// 2 t, rest 6,5 t". `true` = resten er lav eller kortet går i minus.
pub fn deduction_text(card: &PunchCard, minutes: u32) -> (String, bool) {
    let rest = card.remaining_minutes() - minutes as i64;
    let hours = format::hours(minutes);
    if rest < 0 {
        let over = format::hours(rest.unsigned_abs() as u32);
        (tf("gendan.klippekort.deduct_over", &[("hours", &hours), ("over", &over)]), true)
    } else {
        let r = format::hours(rest as u32);
        (tf("gendan.klippekort.deduct", &[("hours", &hours), ("rest", &r)]), rest < LOW_BALANCE_MINUTES)
    }
}

/// Kortets forbrug som CSV til dansk Excel (semikolon, decimalkomma, BOM),
/// ældste først, med kortets tal nederst (som 0.2's forbrugsrapport).
pub fn usage_csv(card: &PunchCard, customer: &str, usage: &[PunchUsage]) -> String {
    use crate::export::{csv_field, hours_fixed};
    let mut rows: Vec<&PunchUsage> = usage.iter().collect();
    rows.sort_by_key(|u| u.date);
    let mut out = String::from("\u{feff}");
    let mut line = |s: String| {
        out.push_str(&s);
        out.push_str("\r\n");
    };
    line(format!("{};{}", t("gendan.klippekort.csv_customer"), csv_field(customer)));
    line(format!("{};{}", t("gendan.klippekort.csv_card"), csv_field(&card.name)));
    line(String::new());
    line(format!(
        "{};{};{}",
        t("gendan.klippekort.csv_date"),
        t("gendan.klippekort.csv_description"),
        t("gendan.klippekort.csv_hours")
    ));
    for u in rows {
        line(format!("{};{};{}", u.date, csv_field(&u.description), hours_fixed(u.minutes)));
    }
    line(String::new());
    let rest = card.remaining_minutes();
    line(format!("{};;{}", t("gendan.klippekort.csv_total"), hours_fixed(card.total_minutes)));
    line(format!("{};;{}", t("gendan.klippekort.csv_used"), hours_fixed(card.used_minutes)));
    line(format!(
        "{};;{}{}",
        t("gendan.klippekort.csv_left"),
        if rest < 0 { "-" } else { "" },
        hours_fixed(rest.unsigned_abs() as u32)
    ));
    out
}

/// "klippekort-forbrug-<id>-2026-10-27.csv".
pub fn usage_csv_name(card: &PunchCard, today: NaiveDate) -> String {
    format!("klippekort-forbrug-{}-{today}.csv", card.id)
}

/// Kortets advarsler på en given dag.
pub fn card_flags(card: &PunchCard, today: NaiveDate) -> Vec<Flag> {
    let mut v = Vec::new();
    let remaining = card.remaining_minutes();
    if is_low(remaining) {
        v.push(Flag::LowBalance);
    } else if remaining == 0 {
        v.push(Flag::Depleted);
    } else if remaining < 0 {
        v.push(Flag::Overdraft(card.overflow_minutes()));
    }
    if let Some(e) = card.expires {
        if e < today {
            v.push(Flag::Expired);
        } else if (e - today).num_days() <= 30 {
            v.push(Flag::ExpiresSoon(e));
        }
    }
    v
}

/// "7 t tilbage af 20 t" / "Brugt op, 1,5 t over".
pub fn balance_text(card: &PunchCard) -> String {
    let d = describe(card.total_minutes, card.used_minutes);
    // Fjerner "Klippekort: " (på det valgte sprog) foran teksten.
    let d = d.split_once(": ").map_or(d.as_str(), |(_, rest)| rest);
    let mut c = d.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Kortene grupperet pr. kunde (A-Å), nyeste køb først. `customer` indsnævrer til én kunde.
pub fn group_cards<'a>(
    customers: &'a [Customer],
    cards: &'a [PunchCard],
    customer: Option<&str>,
) -> Vec<(&'a Customer, Vec<&'a PunchCard>)> {
    let mut groups: Vec<(&Customer, Vec<&PunchCard>)> = customers
        .iter()
        .filter(|c| customer.is_none_or(|id| c.id == id))
        .filter_map(|c| {
            let mut cs: Vec<&PunchCard> = cards.iter().filter(|k| k.customer_id == c.id).collect();
            cs.sort_by_key(|k| std::cmp::Reverse(k.purchased));
            (!cs.is_empty()).then_some((c, cs))
        })
        .collect();
    groups.sort_by_key(|(c, _)| c.name.to_lowercase());
    groups
}

/// Fejl pr. felt i formularen "Nyt klippekort".
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CardErrors {
    pub customer: Option<&'static str>,
    pub name: Option<&'static str>,
    pub hours: Option<&'static str>,
    pub price: Option<&'static str>,
    pub expires: Option<&'static str>,
}

/// Validerer formularens felter. Ren funktion, så den kan testes.
pub fn validate_card(
    customer_id: Option<&str>,
    name: &str,
    hours: &str,
    price: &str,
    expires: &str,
    today: NaiveDate,
) -> Result<PunchCardInput, CardErrors> {
    let mut err = CardErrors::default();
    if customer_id.is_none() {
        err.customer = Some(t("klippekort.err.customer"));
    }
    if name.trim().is_empty() {
        err.name = Some(t("klippekort.err.name"));
    }
    let minutes = pickers::parse_total_hours(hours)
        .map_err(|e| err.hours = Some(e))
        .ok();
    let price = match forms::parse_kr(price) {
        Ok(Some(p)) => Some(p),
        Ok(None) => {
            err.price = Some(t("klippekort.err.price"));
            None
        }
        Err(e) => {
            err.price = Some(e);
            None
        }
    };
    let expires = if expires.trim().is_empty() {
        None
    } else {
        match forms::parse_date(expires, today) {
            Some(d) if d > today => Some(d),
            Some(_) => {
                err.expires = Some(t("klippekort.err.expires_after"));
                None
            }
            None => {
                err.expires = Some(t("klippekort.err.expires_date"));
                None
            }
        }
    };
    if err != CardErrors::default() {
        return Err(err);
    }
    Ok(PunchCardInput {
        customer_id: customer_id.unwrap_or_default().to_string(),
        name: name.trim().to_string(),
        total_minutes: minutes.unwrap_or_default(),
        price: price.unwrap_or_default(),
        expires,
    })
}

/// Rettelse af et kort: som `validate_card`, men et uændret udløb godtages,
/// også når det allerede er passeret (kortet kan stadig rettes).
pub fn validate_card_edit(
    customer_id: Option<&str>,
    name: &str,
    hours: &str,
    price: &str,
    expires: &str,
    current_expiry: Option<NaiveDate>,
    today: NaiveDate,
) -> Result<PunchCardInput, CardErrors> {
    let unchanged = current_expiry.is_some() && forms::parse_date(expires, today) == current_expiry;
    if !unchanged {
        return validate_card(customer_id, name, hours, price, expires, today);
    }
    validate_card(customer_id, name, hours, price, "", today).map(|i| PunchCardInput {
        expires: current_expiry,
        ..i
    })
}

struct CardForm {
    /// Kortet, der rettes, og dets nuværende udløb. `None` = nyt kort.
    editing: Option<(Id, Option<NaiveDate>)>,
    customer: Entity<ChoiceState>,
    name: Entity<InputState>,
    hours: Entity<InputState>,
    price: Entity<InputState>,
    expires: Entity<InputState>,
    errors: CardErrors,
    error: Option<SharedString>,
    busy: bool,
    _subs: Vec<Subscription>,
}

/// "Fyld op": timer, der lægges på et kort.
struct TopUpForm {
    card_id: Id,
    card_name: String,
    hours: Entity<InputState>,
    error: Option<SharedString>,
    busy: bool,
    _subs: Vec<Subscription>,
}

pub struct KlippekortScreen {
    ctx: AppCtx,
    focus: FocusHandle,
    window: AnyWindowHandle,
    data: Loadable<Data>,
    filter: Entity<ChoiceState>,
    /// Kort hvis forbrug er foldet ud.
    usage: HashMap<Id, Loadable<Vec<PunchUsage>>>,
    form: Option<CardForm>,
    top_up: Option<TopUpForm>,
    /// Kvittering eller fejl efter en handling (rolle `Status`/`Alert`).
    notice: Option<(SharedString, bool)>,
    /// gendan: vis arkiverede kort i stedet for de aktive.
    show_archived: bool,
    /// `TT_DEMO=ret`/`fyld`: åbn en dialog, når data er hentet (skærmbilleder).
    demo: Option<String>,
    _subs: Vec<Subscription>,
}

impl KlippekortScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter = forms::choice_state(
            vec![Choice::new("", t("klippekort.filter.all_customers"))],
            None,
            window,
            cx,
        );
        let subs = vec![
            cx.observe(&ctx.hub, |this, _, cx| this.reload(cx)),
            cx.subscribe(&filter, |_, _, _: &SelectEvent<ChoiceList>, cx| cx.notify()),
        ];
        let mut this = KlippekortScreen {
            ctx,
            focus: cx.focus_handle(),
            window: window.window_handle(),
            data: Loadable::Loading,
            filter,
            usage: HashMap::new(),
            form: None,
            top_up: None,
            notice: None,
            show_archived: false,
            demo: std::env::var("TT_DEMO")
                .ok()
                .filter(|d| d == "ret" || d == "fyld"),
            _subs: subs,
        };
        this.reload(cx);
        this
    }

    pub fn reload(&mut self, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            |b| {
                Ok(Data {
                    customers: b.customers(true)?,
                    cards: b.punch_cards(None)?,
                    archived: b.archived_punch_cards()?,
                })
            },
            |this, res, cx| {
                this.data = Loadable::from_result(res);
                this.refresh_filter(cx);
                let open: Vec<Id> = this.usage.keys().cloned().collect();
                for id in open {
                    this.fetch_usage(id, cx);
                }
            },
        );
    }

    fn refresh_filter(&mut self, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let mut items = vec![Choice::new("", t("klippekort.filter.all_customers"))];
        let mut cs: Vec<&Customer> = d
            .customers
            .iter()
            .filter(|c| !c.archived || d.cards.iter().any(|k| k.customer_id == c.id))
            .collect();
        cs.sort_by_key(|c| c.name.to_lowercase());
        items.extend(
            cs.into_iter()
                .map(|c| Choice::new(c.id.clone(), c.name.clone())),
        );
        let keep = forms::chosen(&self.filter, cx);
        pickers::refresh_choices(self.window, &self.filter, items, keep, cx);
    }

    /// Vælger kunde i filteret (bruges af tests og genveje).
    pub fn set_customer_filter(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        forms::select_value(&self.filter, id, window, cx);
        cx.notify();
    }

    fn fetch_usage(&mut self, card_id: Id, cx: &mut Context<Self>) {
        let q = card_id.clone();
        self.ctx.fetch(
            cx,
            move |b| b.punch_card_usage(&q),
            move |this, res, _| {
                // Kun hvis forbruget stadig er foldet ud.
                if let Some(slot) = this.usage.get_mut(&card_id) {
                    *slot = Loadable::from_result(res);
                }
            },
        );
    }

    /// gendan: arkivér eller hent et kort frem.
    pub fn set_archived(&mut self, card_id: &str, archived: bool, cx: &mut Context<Self>) {
        let id = card_id.to_string();
        let ok = if archived { t("gendan.klippekort.archived") } else { t("gendan.klippekort.unarchived") };
        self.ctx.mutate(
            cx,
            move |b| b.set_punch_card_archived(&id, archived),
            move |this, res, _| {
                this.notice = Some(match res {
                    Ok(()) => (ok.into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    /// gendan: slet et kort, der aldrig er brugt.
    pub fn delete_card(&mut self, card_id: &str, cx: &mut Context<Self>) {
        let id = card_id.to_string();
        self.ctx.mutate(
            cx,
            move |b| b.delete_punch_card(&id),
            |this, res, _| {
                this.notice = Some(match res {
                    Ok(()) => (t("gendan.klippekort.deleted").into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    /// gendan: kortets forbrug som CSV i eksportmappen.
    pub fn export_usage(&mut self, card: PunchCard, customer: String, cx: &mut Context<Self>) {
        let today = self.ctx.backend.today();
        self.ctx.fetch(
            cx,
            move |b| {
                let usage = b.punch_card_usage(&card.id)?;
                let csv = usage_csv(&card, &customer, &usage);
                crate::export::write_unique(&crate::export::export_dir(), &usage_csv_name(&card, today), csv.as_bytes())
                    .map_err(|e| crate::backend::BackendError::Other(e.to_string()))
            },
            |this, res, cx| {
                this.notice = Some(match res {
                    Ok(p) => (tf("gendan.klippekort.exported", &[("path", &p.display().to_string())]).into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
                cx.notify();
            },
        );
    }

    pub fn toggle_usage(&mut self, card_id: &str, cx: &mut Context<Self>) {
        if self.usage.remove(card_id).is_none() {
            self.usage.insert(card_id.to_string(), Loadable::Loading);
            self.fetch_usage(card_id.to_string(), cx);
        }
        cx.notify();
    }

    /// Åbner formularen. `edit` = id på kortet, der rettes (felterne
    /// udfyldes); `None` = nyt kort.
    pub fn open_form(&mut self, edit: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let existing = edit
            .and_then(|id| d.cards.iter().find(|k| k.id == id))
            .cloned();
        let current = existing.as_ref().map(|k| k.customer_id.clone());
        let mut cs: Vec<&Customer> = d
            .customers
            .iter()
            .filter(|c| !c.archived || current.as_ref() == Some(&c.id))
            .collect();
        cs.sort_by_key(|c| c.name.to_lowercase());
        let items: Vec<Choice> = cs
            .into_iter()
            .map(|c| Choice::new(c.id.clone(), c.name.clone()))
            .collect();
        let preselect = current.or_else(|| forms::chosen(&self.filter, cx));
        let customer = forms::choice_state(items, preselect.as_deref(), window, cx);
        let k = existing.as_ref();
        let name = forms::input(
            t("klippekort.form.placeholder_name"),
            k.map_or("", |k| &k.name),
            window,
            cx,
        );
        let hours = forms::input(
            t("klippekort.form.placeholder_hours"),
            &k.map(|k| forms::hours_field(k.total_minutes))
                .unwrap_or_default(),
            window,
            cx,
        );
        let price = forms::input(
            t("klippekort.form.placeholder_price"),
            &k.map(|k| forms::kr_field(k.price)).unwrap_or_default(),
            window,
            cx,
        );
        let expires = forms::input(
            t("klippekort.form.placeholder_expires"),
            &k.and_then(|k| k.expires)
                .map(|d| d.format("%d.%m.%Y").to_string())
                .unwrap_or_default(),
            window,
            cx,
        );
        let subs = [&name, &hours, &price, &expires]
            .into_iter()
            .map(|i| pickers::enter_to_save(i, window, cx, Self::save_form))
            .collect();
        name.update(cx, |s, cx| s.focus(window, cx));
        self.form = Some(CardForm {
            editing: existing.map(|k| (k.id, k.expires)),
            customer,
            name,
            hours,
            price,
            expires,
            errors: CardErrors::default(),
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
        let customer = forms::chosen(&form.customer, cx);
        let (name, hours, price, expires) = (
            forms::value(&form.name, cx),
            forms::value(&form.hours, cx),
            forms::value(&form.price, cx),
            forms::value(&form.expires, cx),
        );
        let res = match &form.editing {
            Some((_, current)) => validate_card_edit(
                customer.as_deref(),
                &name,
                &hours,
                &price,
                &expires,
                *current,
                today,
            ),
            None => validate_card(customer.as_deref(), &name, &hours, &price, &expires, today),
        };
        let input = match res {
            Ok(i) => i,
            Err(e) => {
                form.errors = e;
                cx.notify();
                return;
            }
        };
        form.errors = CardErrors::default();
        form.error = None;
        form.busy = true;
        let editing = form.editing.as_ref().map(|(id, _)| id.clone());
        self.ctx.mutate(
            cx,
            move |b| match &editing {
                Some(id) => b.update_punch_card(id, input).map(|k| (k, true)),
                None => b.create_punch_card(input).map(|k| (k, false)),
            },
            |this, res, cx| match res {
                Ok((card, updated)) => {
                    this.form = None;
                    let text = if updated {
                        tf("klippekort.notice.updated", &[("name", &card.name)])
                    } else {
                        tf("klippekort.notice.created", &[("name", &card.name)])
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

    pub fn open_top_up(&mut self, card_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(k) = self
            .data
            .ready()
            .and_then(|d| d.cards.iter().find(|k| k.id == card_id))
        else {
            return;
        };
        let hours = forms::input(t("klippekort.topup.placeholder_hours"), "", window, cx);
        let subs = vec![pickers::enter_to_save(
            &hours,
            window,
            cx,
            Self::save_top_up,
        )];
        hours.update(cx, |s, cx| s.focus(window, cx));
        self.top_up = Some(TopUpForm {
            card_id: k.id.clone(),
            card_name: k.name.clone(),
            hours,
            error: None,
            busy: false,
            _subs: subs,
        });
        cx.notify();
    }

    fn close_top_up(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.top_up = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn save_top_up(&mut self, cx: &mut Context<Self>) {
        let Some(f) = self.top_up.as_mut() else {
            return;
        };
        if f.busy {
            return;
        }
        let minutes = match pickers::parse_total_hours(&forms::value(&f.hours, cx)) {
            Ok(m) => m,
            Err(e) => {
                f.error = Some(e.into());
                cx.notify();
                return;
            }
        };
        f.error = None;
        f.busy = true;
        let id = f.card_id.clone();
        self.ctx.mutate(
            cx,
            move |b| b.top_up_punch_card(&id, minutes),
            move |this, res, cx| match res {
                Ok(card) => {
                    this.top_up = None;
                    this.notice = Some((
                        tf(
                            "klippekort.topup.notice",
                            &[("name", &card.name), ("hours", &format::hours(minutes))],
                        )
                        .into(),
                        false,
                    ));
                    cx.notify();
                }
                Err(e) => {
                    if let Some(f) = this.top_up.as_mut() {
                        f.busy = false;
                        f.error = Some(e.to_string().into());
                    }
                }
            },
        );
    }

    fn on_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.form.is_some() || self.top_up.is_some() || !self.focus.is_focused(window) {
            return;
        }
        let m = &ev.keystroke.modifiers;
        if m.platform || m.control || m.alt {
            return;
        }
        if ev.keystroke.key == "n" {
            self.open_form(None, window, cx);
            cx.stop_propagation();
        }
    }

    fn render_usage(&self, b: &Brand, card: &PunchCard, year: i32) -> AnyElement {
        let id = &card.id;
        let body = match self.usage.get(id) {
            None => return div().into_any_element(),
            Some(Loadable::Loading) => ui::loading_state(
                b,
                SharedString::from(format!("kort-{id}-forbrug-indlaeser")),
                t("klippekort.usage.loading_what"),
            )
            .into_any_element(),
            Some(Loadable::Failed(e)) => ui::error_state(
                b,
                SharedString::from(format!("kort-{id}-forbrug-fejl")),
                e.clone(),
            )
            .into_any_element(),
            Some(Loadable::Ready(rows)) if rows.is_empty() => ui::muted(
                b,
                SharedString::from(format!("kort-{id}-forbrug-tom")),
                t("klippekort.usage.empty"),
            )
            .into_any_element(),
            Some(Loadable::Ready(rows)) => ui::list(
                SharedString::from(format!("kort-{id}-forbrug")),
                tf("klippekort.usage.list_label", &[("name", &card.name)]),
            )
            .children(rows.iter().enumerate().map(|(i, u)| {
                let date = format::date_medium(u.date, year);
                ui::list_row(
                    b,
                    SharedString::from(format!("kort-{id}-forbrug-{i}")),
                    tf(
                        "klippekort.usage.row_label",
                        &[
                            ("date", &date),
                            ("hours", &format::hours(u.minutes)),
                            ("description", &u.description),
                        ],
                    ),
                )
                .px_0()
                .py_1()
                .child(div().w(px(90.)).text_color(b.grey).child(date))
                .child(div().flex_1().min_w_0().child(u.description.clone()))
                .child(div().text_color(b.grey).child(format::hours(u.minutes)))
            }))
            .into_any_element(),
        };
        v_flex()
            .gap_1()
            .pt_2()
            .border_t_1()
            .border_color(b.border)
            .child(body)
            .into_any_element()
    }

    fn render_card(
        &self,
        b: &Brand,
        customer: &Customer,
        k: &PunchCard,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let today = self.ctx.backend.today();
        let year = today.year();
        let id = k.id.clone();
        let edit_id = k.id.clone();
        let top_up_id = k.id.clone();
        let open = self.usage.contains_key(&k.id);
        let archived = self.show_archived;
        let flags = if archived { vec![] } else { card_flags(k, today) };
        let expiry = match k.expires {
            Some(e) => tf(
                "klippekort.card.expiry",
                &[("date", &format::date_medium(e, year))],
            ),
            None => t("klippekort.card.no_expiry").to_string(),
        };
        let (toggle_label, toggle_a11y) = if open {
            (
                t("klippekort.card.hide_usage"),
                tf("klippekort.card.hide_usage_for", &[("name", &k.name)]),
            )
        } else {
            (
                t("klippekort.card.show_usage"),
                tf("klippekort.card.show_usage_for", &[("name", &k.name)]),
            )
        };
        ui::card(
            b,
            SharedString::from(format!("kort-{}", k.id)),
            format!("{}: {}", customer.name, k.name),
        )
        .w(px(400.))
        .child(
            h_flex()
                .justify_between()
                .items_start()
                .gap_2()
                .child(
                    ui::text(
                        SharedString::from(format!("kort-{}-navn", k.id)),
                        k.name.clone(),
                    )
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(b.ink),
                )
                .child(h_flex().gap_1().flex_wrap().justify_end().children(
                    flags.into_iter().enumerate().map(|(i, f)| {
                        ui::badge(
                            b,
                            SharedString::from(format!("kort-{}-maerke-{i}", k.id)),
                            f.label(today),
                            f.tone(),
                        )
                    }),
                )),
        )
        .child(punch_card_holes(
            b,
            SharedString::from(format!("kort-{}-huller", k.id)),
            k.total_minutes,
            k.used_minutes,
        ))
        .child(
            ui::text(
                SharedString::from(format!("kort-{}-saldo", k.id)),
                balance_text(k),
            )
            .text_color(b.ink),
        )
        .child(
            h_flex()
                .gap_3()
                .flex_wrap()
                .text_sm()
                .text_color(b.grey)
                .child(ui::muted(
                    b,
                    SharedString::from(format!("kort-{}-koebt", k.id)),
                    tf(
                        "klippekort.card.bought",
                        &[("date", &format::date_medium(k.purchased, year))],
                    ),
                ))
                .child(ui::muted(
                    b,
                    SharedString::from(format!("kort-{}-udloeb", k.id)),
                    expiry,
                ))
                .child(ui::muted(
                    b,
                    SharedString::from(format!("kort-{}-pris", k.id)),
                    format::money(k.price),
                )),
        )
        .child(
            h_flex()
                .gap_1()
                .child(
                    forms::small_button(
                        SharedString::from(format!("kort-forbrug-{}", k.id)),
                        toggle_label,
                    )
                    .accessibility_label(toggle_a11y)
                    .on_click(cx.listener(move |this, _, _, cx| this.toggle_usage(&id, cx))),
                )
                .when(!archived, |h| h.child(
                    forms::small_button(
                        SharedString::from(format!("kort-ret-{}", k.id)),
                        t("klippekort.card.edit"),
                    )
                    .accessibility_label(tf("klippekort.card.edit_for", &[("name", &k.name)]))
                    .on_click(
                        cx.listener(move |this, _, w, cx| this.open_form(Some(&edit_id), w, cx)),
                    ),
                ))
                .when(!archived, |h| h.child(
                    forms::small_button(
                        SharedString::from(format!("kort-fyld-{}", k.id)),
                        t("klippekort.card.top_up"),
                    )
                    .accessibility_label(tf("klippekort.card.top_up_for", &[("name", &k.name)]))
                    .on_click(
                        cx.listener(move |this, _, w, cx| this.open_top_up(&top_up_id, w, cx)),
                    ),
                ))
                .children(self.gendan_actions(k, customer, cx)),
        )
        .when(open, |d| d.child(self.render_usage(b, k, year)))
        .into_any_element()
    }

    /// gendan: Eksportér forbrug, Arkivér / Genaktivér og Slet (kun tomme kort, lokalt).
    fn gendan_actions(&self, k: &PunchCard, customer: &Customer, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut v = vec![];
        let (card, name) = (k.clone(), customer.name.clone());
        v.push(
            forms::small_button(SharedString::from(format!("kort-eksport-{}", k.id)), t("gendan.klippekort.export"))
                .accessibility_label(tf("gendan.klippekort.export_for", &[("name", &k.name)]))
                .on_click(cx.listener(move |this, _, _, cx| this.export_usage(card.clone(), name.clone(), cx)))
                .into_any_element(),
        );
        let id = k.id.clone();
        if self.show_archived {
            v.push(
                forms::small_button(SharedString::from(format!("kort-genaktiver-{}", k.id)), t("gendan.klippekort.unarchive"))
                    .accessibility_label(tf("gendan.klippekort.unarchive_for", &[("name", &k.name)]))
                    .on_click(cx.listener(move |this, _, _, cx| this.set_archived(&id, false, cx)))
                    .into_any_element(),
            );
            let local = matches!(self.ctx.backend.mode(), crate::backend::Mode::Local);
            if local && k.used_minutes == 0 {
                let id = k.id.clone();
                v.push(
                    forms::small_button(SharedString::from(format!("kort-slet-{}", k.id)), t("gendan.klippekort.delete"))
                        .danger()
                        .accessibility_label(tf("gendan.klippekort.delete_for", &[("name", &k.name)]))
                        .on_click(cx.listener(move |this, _, _, cx| this.delete_card(&id, cx)))
                        .into_any_element(),
                );
            }
        } else {
            v.push(
                forms::small_button(SharedString::from(format!("kort-arkiver-{}", k.id)), t("gendan.klippekort.archive"))
                    .accessibility_label(tf("gendan.klippekort.archive_for", &[("name", &k.name)]))
                    .on_click(cx.listener(move |this, _, _, cx| this.set_archived(&id, true, cx)))
                    .into_any_element(),
            );
        }
        v
    }

    fn render_groups(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let view = cx.entity().downgrade();
        let toggle = forms::segmented(
            b,
            "klippekort-visning",
            t("gendan.klippekort.view_label"),
            &[t("gendan.klippekort.view_active"), t("gendan.klippekort.view_archived")],
            self.show_archived as usize,
            move |i, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    this.show_archived = i == 1;
                    cx.notify();
                });
            },
        );
        v_flex()
            .gap_3()
            .child(h_flex().child(toggle))
            .child(self.render_card_list(b, d, cx))
            .into_any_element()
    }

    fn render_card_list(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let filter = forms::chosen(&self.filter, cx);
        if self.show_archived {
            let groups = group_cards(&d.customers, &d.archived, filter.as_deref());
            if groups.is_empty() {
                return ui::empty_state_icon(
                    b,
                    "klippekort-arkiv-tom",
                    Icon::Archive,
                    t("gendan.klippekort.archive_empty_title"),
                    t("gendan.klippekort.archive_empty_body"),
                )
                .into_any_element();
            }
            return self.render_group_list(b, groups, cx);
        }
        let groups = group_cards(&d.customers, &d.cards, filter.as_deref());
        if groups.is_empty() {
            let (title, body) = if d.cards.is_empty() {
                (
                    t("klippekort.list.empty_title"),
                    t("klippekort.list.empty_body"),
                )
            } else {
                (
                    t("klippekort.list.none_title"),
                    t("klippekort.list.none_body"),
                )
            };
            return ui::empty_state_icon(b, "klippekort-tom", Icon::Ticket, title, body)
                .child(
                    Button::new("klippekort-tom-ny")
                        .icon(Icon::Plus)
                        .label(t("klippekort.action.new"))
                        .primary()
                        .on_click(cx.listener(|this, _, w, cx| this.open_form(None, w, cx))),
                )
                .into_any_element();
        }
        self.render_group_list(b, groups, cx)
    }

    fn render_group_list(
        &self,
        b: &Brand,
        groups: Vec<(&Customer, Vec<&PunchCard>)>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        v_flex()
            .gap_5()
            .children(groups.into_iter().map(|(c, ks)| {
                v_flex()
                    .gap_2()
                    .child(ui::heading(
                        b,
                        SharedString::from(format!("klippekort-gruppe-{}", c.id)),
                        c.name.clone(),
                        3,
                    ))
                    .child(
                        div()
                            .flex()
                            .flex_row()
                            .flex_wrap()
                            .items_start()
                            .gap_3()
                            .children(ks.into_iter().map(|k| self.render_card(b, c, k, cx))),
                    )
            }))
            .into_any_element()
    }

    fn render_form(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let f = self.form.as_ref()?;
        let (title, save) = if f.editing.is_some() {
            (
                t("klippekort.form.title_edit"),
                t("klippekort.form.save_edit"),
            )
        } else {
            (t("klippekort.action.new"), t("klippekort.form.save"))
        };
        let (overlay, dialog) = forms::modal(b, "kort-formular", title);
        let err = |e: Option<&'static str>| e.map(SharedString::from);
        Some(
            overlay.child(
                dialog
                    .child(forms::select_field(
                        b,
                        "kort-kunde",
                        t("klippekort.field.customer"),
                        &f.customer,
                    ))
                    .children(
                        f.errors
                            .customer
                            .map(|e| forms::form_error(b, "kort-kunde-fejl", e)),
                    )
                    .child(forms::text_field(
                        b,
                        "kort-navn",
                        t("klippekort.field.name"),
                        &f.name,
                        err(f.errors.name),
                    ))
                    .child(
                        h_flex()
                            .gap_3()
                            .items_start()
                            .child(forms::text_field(
                                b,
                                "kort-timer",
                                t("klippekort.field.hours"),
                                &f.hours,
                                err(f.errors.hours),
                            ))
                            .child(forms::text_field(
                                b,
                                "kort-pris",
                                t("klippekort.field.price"),
                                &f.price,
                                err(f.errors.price),
                            )),
                    )
                    .child(forms::text_field(
                        b,
                        "kort-udloeb",
                        t("klippekort.field.expires"),
                        &f.expires,
                        err(f.errors.expires),
                    ))
                    .children(
                        f.error
                            .clone()
                            .map(|e| forms::form_error(b, "kort-formular-fejl", e)),
                    )
                    .child(forms::form_buttons(
                        "kort-formular",
                        save,
                        f.busy,
                        cx.listener(|this, _, _, cx| this.save_form(cx)),
                        cx.listener(|this, _, w, cx| this.close_form(w, cx)),
                    )),
            ),
        )
    }
}

impl KlippekortScreen {
    fn render_top_up(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let f = self.top_up.as_ref()?;
        let (overlay, dialog) = forms::modal(
            b,
            "fyld-formular",
            tf("klippekort.topup.title", &[("name", &f.card_name)]),
        );
        Some(
            overlay.child(
                dialog
                    .child(forms::text_field(
                        b,
                        "fyld-timer",
                        t("klippekort.field.hours"),
                        &f.hours,
                        None,
                    ))
                    .children(
                        f.error
                            .clone()
                            .map(|e| forms::form_error(b, "fyld-formular-fejl", e)),
                    )
                    .child(forms::form_buttons(
                        "fyld-formular",
                        t("klippekort.card.top_up"),
                        f.busy,
                        cx.listener(|this, _, _, cx| this.save_top_up(cx)),
                        cx.listener(|this, _, w, cx| this.close_top_up(w, cx)),
                    )),
            ),
        )
    }
}

impl Render for KlippekortScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(id) = self
            .data
            .ready()
            .and_then(|d| d.cards.first())
            .map(|k| k.id.clone())
            && let Some(demo) = self.demo.take()
        {
            if demo == "fyld" {
                self.open_top_up(&id, window, cx);
            } else {
                self.open_form(Some(&id), window, cx);
            }
        }
        let b = brand(cx);
        let today = self.ctx.backend.today();
        let subtitle = self.data.ready().map(|d| {
            let n = d.cards.iter().filter(|k| k.is_active(today)).count();
            SharedString::from(if n == 1 {
                t("klippekort.subtitle.one").to_string()
            } else {
                tf("klippekort.subtitle.many", &[("count", &n.to_string())])
            })
        });
        let toolbar = h_flex()
            .gap_3()
            .items_end()
            .child(div().w(px(260.)).child(forms::select_field(
                &b,
                "klippekort-kunde",
                t("klippekort.field.customer"),
                &self.filter,
            )))
            .child(div().flex_1())
            .child(
                Button::new("kort-nyt")
                    .icon(Icon::Plus)
                    .label(t("klippekort.action.new"))
                    .primary()
                    .tooltip("N")
                    .on_click(cx.listener(|this, _, w, cx| this.open_form(None, w, cx))),
            );
        let content = match &self.data {
            Loadable::Loading => {
                ui::loading_state(&b, "klippekort-indlaeser", t("klippekort.loading.what"))
                    .into_any_element()
            }
            Loadable::Failed(e) => ui::error_state(&b, "klippekort-fejl", e.clone())
                .child(
                    Button::new("klippekort-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("klippekort.action.retry"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.data = Loadable::Loading;
                            this.reload(cx);
                        })),
                )
                .into_any_element(),
            Loadable::Ready(d) => {
                let d = d.clone();
                self.render_groups(&b, &d, cx)
            }
        };
        let notice = self
            .notice
            .clone()
            .map(|(msg, is_err)| pickers::notice(&b, "klippekort-besked", msg, is_err));
        div()
            .relative()
            .size_full()
            .track_focus(&self.focus)
            .key_context("Klippekort")
            .on_key_down(cx.listener(Self::on_key))
            .capture_key_down(cx.listener(|this, ev: &KeyDownEvent, w, cx| {
                if ev.keystroke.key == "escape" && this.form.is_some() {
                    this.close_form(w, cx);
                    cx.stop_propagation();
                } else if ev.keystroke.key == "escape" && this.top_up.is_some() {
                    this.close_top_up(w, cx);
                    cx.stop_propagation();
                }
            }))
            .child(
                ui::page(&b, "klippekort", t("klippekort.page.title"), subtitle)
                    .child(toolbar)
                    .children(notice)
                    .child(content),
            )
            .children(self.render_form(&b, cx))
            .children(self.render_top_up(&b, cx))
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Days, NaiveDate};

    use super::{
        Flag, balance_text, card_flags, deduction_text, group_cards, usage_csv, usage_csv_name,
        validate_card, validate_card_edit,
    };
    use crate::backend::{Customer, PunchCard, PunchUsage};

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
    }

    fn card(total_h: u32, used_min: u32, expires: Option<NaiveDate>) -> PunchCard {
        PunchCard {
            id: "k".into(),
            customer_id: "c".into(),
            name: "Kort".into(),
            total_minutes: total_h * 60,
            used_minutes: used_min,
            purchased: today(),
            expires,
            price: 100_000,
        }
    }

    fn cust(id: &str, name: &str) -> Customer {
        Customer {
            id: id.into(),
            name: name.into(),
            email: None,
            hourly_rate: None,
            archived: false,
            cvr: None,
            ..Default::default()
        }
    }

    #[test]
    fn lav_saldo_under_to_timer_som_i_0_2() {
        // 0.2's regel: under 2 t tilbage (klippekort_low_threshold_hours = 2).
        assert_eq!(card_flags(&card(20, 18 * 60 + 1, None), today()), [Flag::LowBalance]);
        assert!(card_flags(&card(20, 18 * 60, None), today()).is_empty(), "præcis 2 t er ikke lav");
        assert!(card_flags(&card(20, 16 * 60, None), today()).is_empty(), "4 t tilbage er ikke lav");
        assert_eq!(card_flags(&card(5, 3 * 60 + 1, None), today()), [Flag::LowBalance]);
    }

    #[test]
    fn traek_og_rest_i_bekraeftelsen() {
        let k = card(10, 90, None); // 8,5 t tilbage
        assert_eq!(deduction_text(&k, 120), ("Træk 2 t, rest 6,5 t".to_string(), false));
        let (txt, low) = deduction_text(&k, 7 * 60 + 30);
        assert_eq!(txt, "Træk 7,5 t, rest 1 t");
        assert!(low, "rest under 2 t");
        let (txt, low) = deduction_text(&k, 9 * 60);
        assert_eq!(txt, "Træk 9 t, 0,5 t over kortet");
        assert!(low);
    }

    #[test]
    fn forbrug_som_csv() {
        let k = card(10, 150, None);
        let usage = vec![
            PunchUsage { entry_id: Some("e1".into()), date: today(), minutes: 90, description: "Kurv; betaling".into() },
            PunchUsage { entry_id: None, date: today() - Days::new(3), minutes: 60, description: "Opstart".into() },
        ];
        let csv = usage_csv(&k, "Bageriet", &usage);
        assert!(csv.starts_with('\u{feff}'));
        let lines: Vec<&str> = csv.trim_start_matches('\u{feff}').split("\r\n").collect();
        assert_eq!(lines[0], "Kunde;Bageriet");
        assert_eq!(lines[3], "Dato;Beskrivelse;Timer");
        assert!(lines[4].ends_with(";Opstart;1,00"), "ældste først: {}", lines[4]);
        assert!(lines[5].contains("\"Kurv; betaling\";1,50"));
        assert!(lines.contains(&"Timer i alt;;10,00"));
        assert!(lines.contains(&"Brugt;;2,50"));
        assert!(lines.contains(&"Tilbage;;7,50"));
        assert_eq!(usage_csv_name(&k, today()), format!("klippekort-forbrug-{}-{}.csv", k.id, today()));
    }

    #[test]
    fn brugt_op_og_overtraek() {
        assert_eq!(card_flags(&card(10, 600, None), today()), [Flag::Depleted]);
        let f = card_flags(&card(10, 690, None), today());
        assert_eq!(f, [Flag::Overdraft(90)]);
        assert_eq!(f[0].label(today()), "Overtræk 1,5 t");
        assert_eq!(Flag::Depleted.label(today()), "Brugt op");
    }

    #[test]
    fn udloeb_inden_for_tredive_dage() {
        let t = today();
        let soon = t + Days::new(30);
        let f = card_flags(&card(20, 0, Some(soon)), t);
        assert_eq!(f, [Flag::ExpiresSoon(soon)]);
        assert_eq!(f[0].label(t), "Udløber 25. nov.");
        assert!(card_flags(&card(20, 0, Some(t + Days::new(31))), t).is_empty());
        assert_eq!(card_flags(&card(20, 0, Some(t)), t), [Flag::ExpiresSoon(t)]);
        let past = t - Days::new(1);
        assert_eq!(card_flags(&card(20, 0, Some(past)), t), [Flag::Expired]);
        // Næste år vises med årstal.
        let dec = NaiveDate::from_ymd_opt(2026, 12, 12).unwrap();
        assert_eq!(Flag::ExpiresSoon(dec).label(t), "Udløber 12. dec.");
        // Flere advarsler kan stå sammen.
        assert_eq!(
            card_flags(&card(10, 600, Some(past)), t),
            [Flag::Depleted, Flag::Expired]
        );
    }

    #[test]
    fn saldotekst() {
        assert_eq!(
            balance_text(&card(20, 13 * 60, None)),
            "7 t tilbage af 20 t"
        );
        assert_eq!(balance_text(&card(10, 690, None)), "Brugt op, 1,5 t over");
    }

    #[test]
    fn gruppering_pr_kunde_nyeste_foerst() {
        let customers = vec![
            cust("b", "Bageriet"),
            cust("a", "Advokat"),
            cust("t", "Tom"),
        ];
        let mut old = card(5, 0, None);
        old.id = "gammel".into();
        old.customer_id = "b".into();
        old.purchased = today() - Days::new(100);
        let mut new = card(5, 0, None);
        new.id = "ny".into();
        new.customer_id = "b".into();
        let mut other = card(5, 0, None);
        other.id = "x".into();
        other.customer_id = "a".into();
        let cards = vec![old, new, other];
        let g = group_cards(&customers, &cards, None);
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].0.name, "Advokat");
        let ids: Vec<&str> = g[1].1.iter().map(|k| k.id.as_str()).collect();
        assert_eq!(ids, ["ny", "gammel"]);
        assert_eq!(group_cards(&customers, &cards, Some("a")).len(), 1);
        assert!(group_cards(&customers, &cards, Some("t")).is_empty());
    }

    #[test]
    fn validering_samler_alle_fejl() {
        let t = today();
        let e = validate_card(None, " ", "x", "", "i går", t).unwrap_err();
        assert!(e.customer.is_some() && e.name.is_some() && e.hours.is_some());
        assert_eq!(e.price, Some("Skriv prisen i kroner, fx 14000"));
        assert_eq!(e.expires, Some("Udløbet skal ligge efter i dag"));
        let e = validate_card(Some("k"), "A", "10", "1o", "hej", t).unwrap_err();
        assert!(e.price.is_some());
        assert_eq!(e.expires, Some("Skriv en dato, fx 31.12.2026"));
        let e = validate_card(Some("k"), "A", "10", "100", "26.10.2026", t).unwrap_err();
        assert_eq!(e.expires, Some("Udløbet skal ligge efter i dag"));
        let ok = validate_card(Some("k"), " 40 timer ", "40", "26.000", "31.12.2026", t).unwrap();
        assert_eq!(ok.name, "40 timer");
        assert_eq!(ok.total_minutes, 2400);
        assert_eq!(ok.price, 2_600_000);
        assert_eq!(ok.expires, NaiveDate::from_ymd_opt(2026, 12, 31));
        let ok = validate_card(Some("k"), "A", "1,5", "0", "", t).unwrap();
        assert_eq!((ok.total_minutes, ok.price, ok.expires), (90, 0, None));
    }

    #[test]
    fn ret_godtager_uaendret_passeret_udloeb() {
        let t = today();
        let passed = t - chrono::Days::new(10);
        let text = passed.format("%d.%m.%Y").to_string();
        // Ny: et passeret udløb afvises. Ret: det uændrede udløb bevares.
        assert!(validate_card(Some("k"), "A", "10", "100", &text, t).is_err());
        let ok = validate_card_edit(Some("k"), "A", "10", "100", &text, Some(passed), t).unwrap();
        assert_eq!(ok.expires, Some(passed));
        // Et nyt passeret udløb afvises stadig, og andre fejl vises.
        let other = (t - chrono::Days::new(1)).format("%d.%m.%Y").to_string();
        let e =
            validate_card_edit(Some("k"), "A", "10", "100", &other, Some(passed), t).unwrap_err();
        assert_eq!(e.expires, Some("Udløbet skal ligge efter i dag"));
        let e = validate_card_edit(Some("k"), "", "10", "100", &text, Some(passed), t).unwrap_err();
        assert!(e.name.is_some() && e.expires.is_none());
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe {
    use std::sync::Arc;

    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AppContext as _, TestAppContext};

    use super::KlippekortScreen;
    use crate::backend::{Backend as _, BackendError, MockBackend};
    use crate::screens::Screen;
    use crate::testing;

    fn screen(
        cx: &mut TestAppContext,
        app: &gpui_kit::Entity<crate::app::AppView>,
    ) -> gpui_kit::Entity<KlippekortScreen> {
        app.read_with(cx, |a, _| a.view_for(Screen::Klippekort))
            .expect("view")
            .downcast::<KlippekortScreen>()
            .expect("klippekort")
    }

    #[gpui_kit::test]
    fn kort_vises_med_maerker_og_filter(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Klippekort);
        let a = testing::a11y(cx, h);
        println!("PROBE klippekort {:?}", a.roles);
        assert_eq!(a.with_label, a.with_role, "alle roller har label");
        assert_eq!(a.count("Tab"), 10);
        assert_eq!(a.count("Main"), 1);
        assert_eq!(a.count("Meter"), 3);
        assert!(a.has_label("Bageriet på Hjørnet: 20 timer, efterår"));
        assert!(a.has_label("Klippekort: 7 t tilbage af 20 t"));
        assert!(a.has_label("7 t tilbage af 20 t"));
        assert!(a.has_label("Brugt op, 1,5 t over"));
        assert!(a.has_label("Overtræk 1,5 t"));
        assert!(a.has_label("Udløber ikke"));
        assert!(a.has_label("14.000,00 kr"));
        assert!(a.has_label_containing("2 aktive klippekort"));
        // Yoga-kortet udløber om 80 dage: ingen udløbsmærkat. Ingen lav saldo.
        assert!(!a.has_label("Lav saldo"));

        let s = screen(cx, &app);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_customer_filter("kunde_yoga", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Meter"), 1);
        assert!(a.has_label("Klippekort: 4 t tilbage af 5 t"));
    }

    /// gendan: arkivér, se under Arkiverede, genaktivér og eksportér forbrug.
    #[gpui_kit::test]
    fn arkiver_genaktiver_og_eksporter(cx: &mut TestAppContext) {
        let dir = std::env::temp_dir().join(format!("tt-export-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // SAFETY: alle tests, der eksporterer, sætter samme mappe.
        unsafe { std::env::set_var("TT_EXPORT_DIR", &dir) };
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Klippekort);
        let click = |cx: &mut TestAppContext, id: &str| {
            let id = id.to_string();
            cx.update_window(h, |_, w, cx| w.click(gpui_kit::SharedString::from(id), cx)).unwrap();
            cx.run_until_parked();
        };
        click(cx, "kort-eksport-kort_bageriet");
        assert!(testing::a11y(cx, h).has_label_containing("Forbruget er gemt"));
        let csv = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .find(|p| p.to_string_lossy().contains("klippekort-forbrug-kort_bageriet"))
            .expect("csv");
        assert!(std::fs::read_to_string(csv).unwrap().contains("Timer i alt"));

        click(cx, "kort-arkiver-kort_bageriet");
        assert!(mock.archived_punch_cards().unwrap().iter().any(|k| k.id == "kort_bageriet"));
        assert!(testing::a11y(cx, h).has_label_containing("Kortet er arkiveret"));
        click(cx, "klippekort-visning-1");
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Genaktivér 20 timer, efterår"));
        assert!(!a.has_label_containing("Slet 20 timer"), "brugt kort kan ikke slettes");
        click(cx, "kort-genaktiver-kort_bageriet");
        assert!(mock.archived_punch_cards().unwrap().is_empty());
        assert!(testing::a11y(cx, h).has_label_containing("Ingen arkiverede kort"));
    }

    #[gpui_kit::test]
    fn vis_og_skjul_forbrug(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Klippekort);
        let s = screen(cx, &app);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_customer_filter("kunde_bageriet", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        assert!(!testing::a11y(cx, h).has_label("Forbrug på 20 timer, efterår"));
        cx.update_window(h, |_, w, cx| w.click("kort-forbrug-kort_bageriet", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Forbrug på 20 timer, efterår"));
        assert!(a.has_label_containing("13 t, Forbrug før historikken"));
        assert!(a.has_label("Skjul forbrug for 20 timer, efterår"));
        cx.update_window(h, |_, w, cx| w.click("kort-forbrug-kort_bageriet", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(!a.has_label("Forbrug på 20 timer, efterår"));
        assert!(a.has_label("Vis forbrug for 20 timer, efterår"));
    }

    #[gpui_kit::test]
    fn nyt_kort_med_validering(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Klippekort);
        cx.update_window(h, |_, w, cx| w.click("kort-nyt", cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 1);
        // Tomt: navn, timer og pris mangler. Udløb i fortiden.
        cx.update_window(h, |_, w, cx| {
            w.click("kort-udloeb", cx);
            w.input("1.1.2026", cx);
            w.click("kort-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 1);
        assert!(a.has_label("Skriv kortets navn, fx 10 timer"));
        assert!(a.has_label("Skriv prisen i kroner, fx 14000"));
        assert!(a.has_label("Udløbet skal ligge efter i dag"));
        assert!(a.has_label("Skriv et timetal, fx 1,5"));
        // Udfyld og gem.
        let s = screen(cx, &app);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let f = s.form.as_ref().expect("form");
                crate::ui::forms::select_value(&f.customer, "kunde_klinik", w, cx);
            });
            w.click("kort-navn", cx);
            w.input("40 timer", cx);
            w.click("kort-timer", cx);
            w.input("40", cx);
            w.click("kort-pris", cx);
            w.input("26.000", cx);
            w.click("kort-udloeb", cx);
            w.press("cmd-a", cx);
            w.input("31.12.2026", cx);
            w.click("kort-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 0, "formularen lukker");
        assert!(a.has_label("40 timer er oprettet"));
        let k = mock
            .punch_cards(Some("kunde_klinik"))
            .unwrap()
            .into_iter()
            .next()
            .expect("gemt");
        assert_eq!(k.total_minutes, 2400);
        assert_eq!(k.price, 2_600_000);
        assert_eq!(k.expires, chrono::NaiveDate::from_ymd_opt(2026, 12, 31));
        assert!(a.has_label("Klinik Søndergade: 40 timer"));
        assert!(a.has_label("Udløb 31. dec."), "{:?}", a.labels);
        assert!(
            !a.has_label_containing("Udløber 31."),
            "mere end 30 dage til"
        );
        // Nyt kort har intet forbrug.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_customer_filter("kunde_klinik", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        let id = k.id.clone();
        cx.update_window(h, |_, w, cx| w.click(format!("kort-forbrug-{id}"), cx))
            .unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Intet forbrug endnu"));
    }

    #[gpui_kit::test]
    fn ret_og_fyld_kort_op(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Klippekort);
        cx.update_window(h, |_, w, cx| w.click("kort-ret-kort_bageriet", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 1);
        assert!(a.has_label("Ret klippekort"));
        let s = screen(cx, &app);
        let (name, hours, price) = cx.update(|cx| {
            let f = s.read(cx).form.as_ref().expect("form");
            (
                crate::ui::forms::value(&f.name, cx),
                crate::ui::forms::value(&f.hours, cx),
                crate::ui::forms::value(&f.price, cx),
            )
        });
        assert_eq!((name.as_str(), hours.as_str()), ("20 timer, efterår", "20"));
        assert_eq!(crate::ui::forms::parse_kr(&price), Ok(Some(1_400_000)));

        // Færre timer end det brugte (13 t) afvises af datalaget.
        cx.update_window(h, |_, w, cx| {
            w.click("kort-timer", cx);
            w.press("cmd-a", cx);
            w.input("10", cx);
            w.click("kort-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 1, "formularen bliver åben");
        assert!(a.has_label_containing("færre timer"), "{:?}", a.labels);

        // 25 timer til 17.500 kr. og intet udløb.
        cx.update_window(h, |_, w, cx| {
            w.click("kort-timer", cx);
            w.press("cmd-a", cx);
            w.input("25", cx);
            w.click("kort-pris", cx);
            w.press("cmd-a", cx);
            w.input("17500", cx);
            w.click("kort-udloeb", cx);
            w.press("cmd-a", cx);
            w.press("backspace", cx);
            w.click("kort-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 0, "formularen lukker");
        assert!(a.has_label("20 timer, efterår er gemt"));
        let k = mock.punch_cards(Some("kunde_bageriet")).unwrap().remove(0);
        assert_eq!(
            (k.total_minutes, k.used_minutes, k.price, k.expires),
            (1500, 780, 1_750_000, None)
        );

        // Fyld op med 5 timer.
        cx.update_window(h, |_, w, cx| w.click("kort-fyld-kort_bageriet", cx))
            .unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Fyld 20 timer, efterår op"));
        cx.update_window(h, |_, w, cx| {
            w.click("fyld-timer", cx);
            w.input("5", cx);
            w.click("fyld-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 0);
        assert!(
            a.has_label_containing("20 timer, efterår: 5"),
            "{:?}",
            a.labels
        );
        let k = mock.punch_cards(Some("kunde_bageriet")).unwrap().remove(0);
        assert_eq!((k.total_minutes, k.price), (1800, 2_100_000));
    }

    #[gpui_kit::test]
    fn tom_og_fejl(cx: &mut TestAppContext) {
        let empty = Arc::new(MockBackend::empty(testing::today()));
        let (h, app) = testing::open_app(cx, empty);
        testing::navigate(cx, h, &app, Screen::Klippekort);
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Ingen klippekort endnu"));
        assert_eq!(a.with_label, a.with_role);

        let broken = testing::mock();
        broken.set_failure(Some(BackendError::Offline));
        let (h, app) = testing::open_app(cx, broken);
        testing::navigate(cx, h, &app, Screen::Klippekort);
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Fejl: Du er offline"));
        assert!(a.has_label("Prøv igen"));
    }
}
