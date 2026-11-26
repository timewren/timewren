//! Fakturaer: liste (kladde, sendt, betalt, forfalden), ny kladde fra
//! ufaktureret tid, redigering af linjer, afsendelse, PDF og betaling.
//!
//! Tastatur: Tab mellem felter og knapper, Enter/Mellemrum på en faktura
//! åbner den, Esc går tilbage til listen.

use std::collections::HashMap;

use chrono::{Datelike as _, NaiveDate};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Disableable as _, Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::{
    BackendError, Customer, Entry, Id, Invoice, InvoiceDelivery, InvoiceDetails, InvoiceLine,
    InvoiceProfile, InvoiceSendPreview, InvoiceStatus, Mode, Project, StoredLine, WebInvoiceTotals,
    can_remind,
};
use crate::brand::{Brand, brand};
use crate::export;
use crate::i18n::{t, tf};
use crate::ui::Icon;
use crate::ui::{self, Loadable, Tone, format, forms};

// ---------- Ren logik ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    All,
    Draft,
    Sent,
    Paid,
    Overdue,
}

impl Filter {
    pub const ALL: [Filter; 5] = [
        Filter::All,
        Filter::Draft,
        Filter::Sent,
        Filter::Paid,
        Filter::Overdue,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Filter::All => t("fakturaer.filter.all"),
            Filter::Draft => t("fakturaer.filter.draft"),
            Filter::Sent => t("fakturaer.status.sent"),
            Filter::Paid => t("fakturaer.status.paid"),
            Filter::Overdue => t("fakturaer.status.overdue"),
        }
    }

    pub fn matches(self, s: InvoiceStatus) -> bool {
        match self {
            Filter::All => true,
            Filter::Draft => s == InvoiceStatus::Draft,
            Filter::Sent => s == InvoiceStatus::Sent,
            Filter::Paid => s == InvoiceStatus::Paid,
            Filter::Overdue => s == InvoiceStatus::Overdue,
        }
    }
}

/// Linjer i en ny kladde: samlet pr. projekt eller én pr. post.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DraftGrouping {
    PerProject,
    PerEntry,
}

/// Deler kladdens projektlinjer op i én linje pr. post. Prisen følger den
/// projektlinje, posten lå i (datalaget har allerede brugt timepris-hierarkiet).
pub fn per_entry_lines(
    draft: &[InvoiceLine],
    entries: &[Entry],
    projects: &HashMap<Id, String>,
) -> Vec<InvoiceLine> {
    let mut out: Vec<(NaiveDate, InvoiceLine)> = vec![];
    for line in draft {
        for id in &line.entry_ids {
            let Some(e) = entries.iter().find(|e| &e.id == id) else {
                continue;
            };
            let project = e
                .project_id
                .as_ref()
                .and_then(|p| projects.get(p))
                .cloned()
                .unwrap_or_else(|| line.description.clone());
            let what = if e.description.trim().is_empty() {
                project
            } else {
                format!("{project}: {}", e.description.trim())
            };
            out.push((
                e.date,
                InvoiceLine {
                    description: format!("{}, {what}", format::date_short(e.date)),
                    minutes: e.minutes,
                    rate: line.rate,
                    entry_ids: vec![e.id.clone()],
                    stored: None,
                },
            ));
        }
    }
    out.sort_by_key(|a| a.0);
    out.into_iter().map(|(_, l)| l).collect()
}

/// Ufakturerede poster i perioden (inklusiv begge datoer).
pub fn in_period(entries: &[Entry], from: NaiveDate, to: NaiveDate) -> Vec<Entry> {
    entries
        .iter()
        .filter(|e| e.date >= from && e.date <= to)
        .cloned()
        .collect()
}

/// Antal timer på en fakturalinje: "1,5", "1:30", "90m", "32,5". Højst 9.999 t.
pub fn parse_quantity(s: &str) -> Result<u32, &'static str> {
    let s = s.trim().trim_end_matches('t').trim();
    if s.is_empty() {
        return Err(t("fakturaer.qty.empty"));
    }
    let mins = if let Some(m) = s.strip_suffix('m') {
        m.trim()
            .parse::<u32>()
            .map_err(|_| t("fakturaer.qty.invalid"))?
    } else if let Some((h, m)) = s.split_once(':') {
        let h: u32 = h.trim().parse().map_err(|_| t("fakturaer.qty.invalid"))?;
        let m: u32 = m.trim().parse().map_err(|_| t("fakturaer.qty.invalid"))?;
        if m >= 60 {
            return Err(t("fakturaer.qty.minutes"));
        }
        h * 60 + m
    } else {
        let v: f64 = s
            .replace(',', ".")
            .parse()
            .map_err(|_| t("fakturaer.qty.invalid_example"))?;
        if !v.is_finite() || v < 0.0 {
            return Err(t("fakturaer.qty.invalid"));
        }
        (v * 60.0).round() as u32
    };
    if mins == 0 {
        return Err(t("fakturaer.qty.zero"));
    }
    if mins > 9_999 * 60 {
        return Err(t("fakturaer.qty.max"));
    }
    Ok(mins)
}

/// Kroner → øre: "850", "850,50", "1.234,50", "1234.5", "850 kr.".
/// Punktum efterfulgt af præcis tre cifre er tusindtalsskilletegn.
pub fn parse_kroner(s: &str) -> Result<i64, &'static str> {
    let s = s
        .trim()
        .trim_end_matches('.')
        .trim_end_matches("kr")
        .trim()
        .replace(' ', "");
    if s.is_empty() {
        return Err(t("fakturaer.price.empty"));
    }
    let (int, frac) = if let Some((i, f)) = s.rsplit_once(',') {
        (i.replace('.', ""), f.to_string())
    } else if s.contains('.') {
        let parts: Vec<&str> = s.split('.').collect();
        if parts[1..].iter().all(|p| p.len() == 3) {
            (parts.concat(), String::new())
        } else if parts.len() == 2 {
            (parts[0].to_string(), parts[1].to_string())
        } else {
            return Err(t("fakturaer.price.invalid"));
        }
    } else {
        (s.clone(), String::new())
    };
    if int.is_empty() || !int.chars().all(|c| c.is_ascii_digit()) {
        return Err(t("fakturaer.price.invalid"));
    }
    if frac.len() > 2 || !frac.chars().all(|c| c.is_ascii_digit()) {
        return Err(t("fakturaer.price.decimals"));
    }
    let kr: i64 = int.parse().map_err(|_| t("fakturaer.price.invalid"))?;
    let oere: i64 = match frac.len() {
        0 => 0,
        1 => {
            frac.parse::<i64>()
                .map_err(|_| t("fakturaer.price.invalid"))?
                * 10
        }
        _ => frac.parse().map_err(|_| t("fakturaer.price.invalid"))?,
    };
    if kr > 1_000_000 {
        return Err(t("fakturaer.price.too_high"));
    }
    Ok(kr * 100 + oere)
}

/// Kroner til et redigerbart felt: 85000 → "850", 85050 → "850,50".
pub fn kroner_input(oere: i64) -> String {
    if oere % 100 == 0 {
        (oere / 100).to_string()
    } else {
        export::kroner_plain(oere)
    }
}

/// Timer til et redigerbart felt: 90 → "1,5".
pub fn hours_input(minutes: u32) -> String {
    format::hours_number(minutes as i64)
}

/// Er kladdens linjer rettet i editoren (tekst, tid, sats eller antal
/// linjer) uden at være gemt?
pub fn lines_unsaved(edited: &[InvoiceLine], saved: &[InvoiceLine]) -> bool {
    edited.len() != saved.len()
        || edited.iter().zip(saved).any(|(a, b)| {
            a.description.trim() != b.description.trim() || a.minutes != b.minutes || a.rate != b.rate
        })
}

/// Er kladdens forfaldsdato eller noter rettet uden at være gemt? Felterne
/// gemmes med samme knap som linjerne (`save_lines`), og web's PDF viser de
/// gemte. Titlen kan kun rettes lokalt, hvor PDF'en tegnes fra felterne.
pub fn details_unsaved(edited: &InvoiceDetails, saved: &Invoice) -> bool {
    fn norm(n: Option<&str>) -> Option<&str> {
        n.map(str::trim).filter(|n| !n.is_empty())
    }
    edited.due != saved.due || norm(edited.notes.as_deref()) != norm(saved.notes.as_deref())
}

/// Teksterne under linjerne. `total` er `None`, mens web's tal hentes, eller
/// når de ikke kunne hentes (`vat_failed`).
#[derive(Debug, PartialEq, Eq)]
pub struct TotalsText {
    pub subtotal: String,
    pub vat: String,
    pub vat_failed: bool,
    pub total: Option<String>,
}

/// Subtotal, moms og i alt. Cloud: web's tal (`extension.invoices.totals`),
/// de samme som på web's PDF, så længe linjerne er gemt. Uden web's tal
/// (lokal tilstand) regner appen selv med fakturaens sats.
pub fn totals_text(
    c: &Invoice,
    unsaved: bool,
    web: Option<&Loadable<Option<WebInvoiceTotals>>>,
) -> TotalsText {
    let subtotal = tf("fakturaer.totals.subtotal", &[("amount", &export::kroner(c.subtotal()))]);
    let pending = |vat: String, vat_failed: bool| TotalsText {
        subtotal: subtotal.clone(),
        vat,
        vat_failed,
        total: None,
    };
    match web {
        None | Some(Loadable::Ready(None)) => TotalsText {
            subtotal: subtotal.clone(),
            vat: match (c.vat_permille, c.vat()) {
                (Some(permille), Some(vat)) => tf(
                    "fakturaer.totals.vat",
                    &[("percent", &export::vat_percent(permille)), ("amount", &export::kroner(vat))],
                ),
                _ => t("fakturaer.totals.vat_web").to_string(),
            },
            vat_failed: false,
            total: Some(tf(
                if c.vat_permille.is_some() { "fakturaer.totals.total" } else { "fakturaer.totals.total_ex_vat" },
                &[("amount", &export::kroner(c.total()))],
            )),
        },
        Some(Loadable::Loading) => pending(t("fakturaer.totals.loading").to_string(), false),
        Some(Loadable::Failed(e)) => pending(e.to_string(), true),
        Some(Loadable::Ready(Some(_))) if unsaved => TotalsText {
            total: Some(tf("fakturaer.totals.total_ex_vat", &[("amount", &export::kroner(c.subtotal()))])),
            ..pending(t("fakturaer.totals.unsaved").to_string(), false)
        },
        Some(Loadable::Ready(Some(w))) => TotalsText {
            subtotal: tf("fakturaer.totals.subtotal", &[("amount", &w.money(w.subtotal))]),
            vat: if w.show_vat {
                tf(
                    "fakturaer.totals.vat",
                    &[("percent", &export::vat_percent(w.vat_permille)), ("amount", &w.money(w.vat))],
                )
            } else {
                t("fakturaer.totals.no_vat").to_string()
            },
            vat_failed: false,
            total: Some(tf("fakturaer.totals.total", &[("amount", &w.money(w.total))])),
        },
    }
}

/// Fakturaens titel i listen: "Faktura 1042" eller "Kladde".
pub fn invoice_title(inv: &Invoice) -> String {
    match inv.number_label() {
        Some(n) => tf("fakturaer.title.invoice", &[("number", &n)]),
        None => t("fakturaer.title.draft").into(),
    }
}

/// Hvad en afsendelse gør: sender en mail til kunden, udsteder kun
/// fakturaen (nummer og status "Sendt", ingen mail), eller sender en udstedt
/// faktura igen som påmindelse (web's "Send påmindelse").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SendKind {
    Mail,
    NoMail,
    Reminder,
}

impl SendKind {
    /// Går der en mail til kunden?
    pub fn mails(self) -> bool {
        matches!(self, SendKind::Mail | SendKind::Reminder)
    }
}

/// "Sendt 20.11.2026 kl. 10:12 til kunde@…": hvornår og til hvem fakturaen
/// gik, som den blev sendt herfra. `None` for en kladde og for en faktura,
/// der er sendt et andet sted (web, en anden enhed).
pub fn delivery_text(inv: &Invoice, today: NaiveDate) -> Option<String> {
    if inv.status == InvoiceStatus::Draft {
        return None;
    }
    Some(match &inv.delivery {
        Some(InvoiceDelivery { at, to: Some(to) }) => tf(
            "fakturaer.delivery.mail",
            &[
                ("date", &format::date_medium(at.date(), today.year())),
                ("time", &format::time(at.time())),
                ("to", to),
            ],
        ),
        Some(InvoiceDelivery { at, to: None }) => tf(
            "fakturaer.delivery.issued",
            &[
                ("date", &format::date_medium(at.date(), today.year())),
                ("time", &format::time(at.time())),
            ],
        ),
        None => return None,
    })
}

/// Teksten på fejlen, når en afsendelse mislykkes. En mail kan være gået, selv
/// om svaret udeblev (timeout, tabt forbindelse), så "prøv igen" må ikke stå
/// alene: brugeren skal først se fakturaens status.
pub fn send_error_text(e: &BackendError, kind: SendKind) -> String {
    match (e, kind) {
        (BackendError::Offline, _) => t("fakturaer.send.offline").into(),
        (
            BackendError::Validation(_) | BackendError::NotFound(_) | BackendError::PlanLimit(_),
            _,
        )
        | (_, SendKind::NoMail) => e.to_string(),
        _ => tf("fakturaer.send.uncertain", &[("error", &e.to_string())]),
    }
}

/// `true`, når en mail kan være gået, selv om afsendelsen fejlede.
pub fn send_outcome_uncertain(e: &BackendError, kind: SendKind) -> bool {
    kind.mails()
        && !matches!(
            e,
            BackendError::Offline
                | BackendError::Validation(_)
                | BackendError::NotFound(_)
                | BackendError::PlanLimit(_)
        )
}

/// Betalingsdatoen fra "Markér betalt": en dato som i resten af appen
/// ("20.11", "20.11.2026"). Tom = i dag.
pub fn parse_paid_date(s: &str, today: NaiveDate) -> Option<NaiveDate> {
    if s.trim().is_empty() {
        return Some(today);
    }
    forms::parse_date(s, today)
}

/// "Markér betalt" venter på betalingsdatoen.
struct PaidForm {
    id: Id,
    date: Entity<InputState>,
    error: Option<SharedString>,
}

/// Bekræftelsen, før en faktura sendes (eller udstedes).
struct SendDialog {
    kind: SendKind,
    preview: InvoiceSendPreview,
    busy: bool,
    error: Option<SharedString>,
}

/// Hvor fokus skal hen ved næste tegning (kun `render` har vinduet).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Refocus {
    /// "Annuller" i bekræftelsen: Enter må ikke sende uden et bevidst valg.
    Cancel,
    Page,
}

/// Faktura, der skal åbnes, næste gang Fakturaer vises (link fra en post i
/// kalenderen).
pub struct OpenInvoice(pub Id);

impl Global for OpenInvoice {}

fn status_label(s: InvoiceStatus) -> &'static str {
    match s {
        InvoiceStatus::Draft => t("fakturaer.status.draft"),
        InvoiceStatus::Sent => t("fakturaer.status.sent"),
        InvoiceStatus::Paid => t("fakturaer.status.paid"),
        InvoiceStatus::Overdue => t("fakturaer.status.overdue"),
    }
}

fn status_icon(s: InvoiceStatus) -> Icon {
    match s {
        InvoiceStatus::Draft => Icon::FileText,
        InvoiceStatus::Sent => Icon::Send,
        InvoiceStatus::Paid => Icon::CheckCircle2,
        InvoiceStatus::Overdue => Icon::AlertTriangle,
    }
}

fn status_tone(s: InvoiceStatus) -> Tone {
    match s {
        InvoiceStatus::Draft => Tone::Neutral,
        InvoiceStatus::Sent => Tone::Primary,
        InvoiceStatus::Paid => Tone::Primary,
        InvoiceStatus::Overdue => Tone::Danger,
    }
}

// ---------- Skærmen ----------

enum View {
    List,
    New,
    Detail(Id),
}

struct LineInputs {
    desc: Entity<InputState>,
    hours: Entity<InputState>,
    rate: Entity<InputState>,
    entry_ids: Vec<Id>,
    /// Linjen, som den var gemt (se `InvoiceLine::stored`).
    stored: Option<StoredLine>,
}

struct Editor {
    rows: Vec<LineInputs>,
    /// gendan: titel (kun lokal), forfald og noter.
    details: DetailInputs,
    _subs: Vec<Subscription>,
}

struct DetailInputs {
    title: Entity<InputState>,
    due: Entity<InputState>,
    notes: Entity<InputState>,
}

type Data = (Vec<Invoice>, Vec<Customer>, Vec<Project>);

pub struct FakturaerScreen {
    ctx: AppCtx,
    data: Loadable<Data>,
    filter: Filter,
    view: View,
    // Ny kladde
    uninvoiced: Loadable<Vec<(Customer, Vec<Entry>)>>,
    new_customer: Option<Id>,
    period_from: Entity<InputState>,
    period_to: Entity<InputState>,
    grouping: DraftGrouping,
    // Detalje
    editor: Option<Editor>,
    /// Besked efter en handling (fx "PDF gemt …"). `true` = fejl.
    notice: Option<(SharedString, bool)>,
    last_file: Option<std::path::PathBuf>,
    busy: bool,
    /// Faktura-id, der skal åbnes, når den findes i data.
    pending_open_id: Option<Id>,
    /// gendan: fakturaopsætningen (lokal; `None` i cloud).
    profile: Option<InvoiceProfile>,
    /// gendan: "Slet kladde" er trykket én gang og venter på bekræftelse.
    confirm_delete: bool,
    /// Bekræftelsen før en afsendelse (modal).
    send_dialog: Option<SendDialog>,
    /// "Markér betalt" med betalingsdatoen.
    paid_form: Option<PaidForm>,
    /// "Annuller" i bekræftelsen, som får fokus, når den åbnes.
    cancel_focus: FocusHandle,
    refocus: Option<Refocus>,
    /// Posterne på den åbne faktura (til "Vis i kalenderen").
    invoice_entries: Option<(Id, Vec<Entry>)>,
    /// Web's subtotal, moms og total for den åbne faktura (cloud). `None`
    /// i svaret: appen regner selv (lokal tilstand).
    web_totals: Option<(Id, Loadable<Option<WebInvoiceTotals>>)>,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

impl FakturaerScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let today = ctx.backend.today();
        let first = today.with_day0(0).unwrap_or(today);
        let period_from = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(t("fakturaer.period.placeholder"))
                .default_value(format::date_short(first))
        });
        let period_to = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(t("fakturaer.period.placeholder"))
                .default_value(format::date_short(today))
        });
        let mut subs = vec![cx.observe(&ctx.hub, |this: &mut Self, _, cx| this.reload(cx))];
        for i in [&period_from, &period_to] {
            subs.push(cx.subscribe(i, |_, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::Change) {
                    cx.notify();
                }
            }));
        }
        let mut this = FakturaerScreen {
            ctx,
            data: Loadable::Loading,
            filter: Filter::All,
            view: View::List,
            uninvoiced: Loadable::Loading,
            new_customer: None,
            period_from,
            period_to,
            grouping: DraftGrouping::PerProject,
            editor: None,
            notice: None,
            last_file: None,
            busy: false,
            pending_open_id: None,
            profile: None,
            confirm_delete: false,
            send_dialog: None,
            paid_form: None,
            cancel_focus: cx.focus_handle(),
            refocus: None,
            invoice_entries: None,
            web_totals: None,
            focus: cx.focus_handle(),
            _subs: subs,
        };
        this.reload(cx);
        this.demo_view(cx);
        this
    }

    /// `TT_FAKTURA_VIEW` til skærmbilleder: "ny", "kladde" (opretter en
    /// kladde og åbner den), "send" (som "kladde", med bekræftelsen før
    /// afsendelsen åben) eller et faktura-id.
    fn demo_view(&mut self, cx: &mut Context<Self>) {
        let Ok(v) = std::env::var("TT_FAKTURA_VIEW") else {
            return;
        };
        match v.as_str() {
            "ny" => self.show_new(cx),
            "kladde" => self.ctx.mutate(
                cx,
                |b| {
                    for c in b.customers(false)? {
                        let e = b.uninvoiced_entries(&c.id)?;
                        if !e.is_empty() {
                            let ids: Vec<Id> = e.iter().map(|e| e.id.clone()).collect();
                            return b.create_invoice_draft(&c.id, &ids);
                        }
                    }
                    Err(crate::backend::BackendError::Validation(
                        "Ingen ufaktureret tid".into(),
                    ))
                },
                |this, res, _| {
                    if let Ok(inv) = res {
                        this.open_new(inv);
                    }
                },
            ),
            // Kladden åbnet med bekræftelsen før afsendelsen.
            "send" => self.ctx.mutate(
                cx,
                |b| {
                    for c in b.customers(false)? {
                        let e = b.uninvoiced_entries(&c.id)?;
                        if !e.is_empty() {
                            let ids: Vec<Id> = e.iter().map(|e| e.id.clone()).collect();
                            let inv = b.create_invoice_draft(&c.id, &ids)?;
                            let preview = b.invoice_send_preview(&inv.id)?;
                            return Ok((inv, preview));
                        }
                    }
                    Err(crate::backend::BackendError::Validation(
                        "Ingen ufaktureret tid".into(),
                    ))
                },
                |this, res, _| {
                    if let Ok((inv, preview)) = res {
                        let kind = if preview.sends_mail {
                            SendKind::Mail
                        } else {
                            SendKind::NoMail
                        };
                        this.open_new(inv);
                        this.send_dialog = Some(SendDialog {
                            kind,
                            preview,
                            busy: false,
                            error: None,
                        });
                        this.refocus = Some(Refocus::Cancel);
                    }
                },
            ),
            id => self.pending_open_id = Some(id.to_string()),
        }
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            |b| Ok((b.invoices()?, b.customers(true)?, b.projects(None, true)?)),
            |this, res, _| this.data = Loadable::from_result(res),
        );
        self.ctx.fetch(
            cx,
            |b| b.invoice_profile(),
            |this, res, _| this.profile = res.ok().flatten(),
        );
        if matches!(self.view, View::New) {
            self.load_uninvoiced(cx);
        }
        // Linjerne kan være gemt, eller momsen ændret i web.
        if let View::Detail(id) = &self.view {
            self.load_web_totals(id.clone(), cx);
        }
    }

    /// Web's tal for fakturaen (cloud). Et tidligere svar for samme faktura
    /// bliver stående, mens der hentes igen, så tallene ikke blinker.
    fn load_web_totals(&mut self, id: Id, cx: &mut Context<Self>) {
        if !matches!(self.ctx.backend.mode(), Mode::Cloud { .. }) {
            self.web_totals = None;
            return;
        }
        if self.web_totals.as_ref().is_none_or(|(open, _)| *open != id) {
            self.web_totals = Some((id.clone(), Loadable::Loading));
        }
        self.ctx.fetch(
            cx,
            move |b| Ok((id.clone(), b.web_invoice_totals(&id))),
            |this, res, _| {
                if let Ok((id, r)) = res
                    && matches!(&this.view, View::Detail(open) if *open == id)
                {
                    this.web_totals = Some((id, Loadable::from_result(r)));
                }
            },
        );
    }

    fn load_uninvoiced(&mut self, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            |b| {
                let mut out = vec![];
                for c in b.customers(false)? {
                    let e = b.uninvoiced_entries(&c.id)?;
                    if !e.is_empty() {
                        out.push((c, e));
                    }
                }
                Ok(out)
            },
            |this, res, _| {
                this.uninvoiced = Loadable::from_result(res);
                if let Loadable::Ready(list) = &this.uninvoiced
                    && this.new_customer.is_none()
                {
                    this.new_customer = list.first().map(|(c, _)| c.id.clone());
                }
            },
        );
    }

    /// En netop oprettet kladde: læg den i listen med det samme, og åbn den.
    fn open_new(&mut self, inv: Invoice) {
        if let Loadable::Ready(d) = &mut self.data
            && !d.0.iter().any(|i| i.id == inv.id)
        {
            d.0.insert(0, inv.clone());
        }
        self.pending_open_id = Some(inv.id);
    }

    fn customer_name(&self, id: &str) -> String {
        self.data
            .ready()
            .and_then(|(_, cs, _)| cs.iter().find(|c| c.id == id))
            .map(|c| c.name.clone())
            .unwrap_or_else(|| t("fakturaer.label.unknown_customer").into())
    }

    fn invoice(&self, id: &str) -> Option<&Invoice> {
        self.data.ready()?.0.iter().find(|i| i.id == id)
    }

    fn show_list(&mut self, cx: &mut Context<Self>) {
        self.view = View::List;
        self.editor = None;
        self.confirm_delete = false;
        self.send_dialog = None;
        self.paid_form = None;
        self.invoice_entries = None;
        self.web_totals = None;
        self.notice = None;
        cx.notify();
    }

    fn show_new(&mut self, cx: &mut Context<Self>) {
        self.view = View::New;
        self.notice = None;
        self.uninvoiced = Loadable::Loading;
        self.load_uninvoiced(cx);
        cx.notify();
    }

    fn open(&mut self, id: Id, window: &mut Window, cx: &mut Context<Self>) {
        self.notice = None;
        if self.invoice(&id).is_some_and(|i| !i.lines_loaded) {
            // Listen kom uden linjer (cloud): ingen editor, før linjerne er
            // hentet (en gemning ville ellers slette kladdens linjer). Hent
            // fakturaen, og åbn den igen.
            self.editor = None;
            self.view = View::Detail(id.clone());
            let wanted = id.clone();
            self.ctx.fetch(
                cx,
                move |b| b.invoice(&wanted),
                |this, res, _| {
                    if let Ok(inv) = res
                        && let Loadable::Ready(d) = &mut this.data
                        && let Some(slot) = d.0.iter_mut().find(|i| i.id == inv.id)
                    {
                        let id = inv.id.clone();
                        *slot = inv;
                        this.pending_open_id = Some(id);
                    }
                },
            );
            cx.notify();
            return;
        }
        self.editor = self
            .invoice(&id)
            .filter(|i| i.status == InvoiceStatus::Draft)
            .cloned()
            .map(|inv| Self::make_editor(&inv, window, cx));
        self.confirm_delete = false;
        self.send_dialog = None;
        self.paid_form = None;
        self.view = View::Detail(id.clone());
        self.load_web_totals(id.clone(), cx);
        // Posterne på fakturaen, til linket "Vis i kalenderen".
        self.invoice_entries = None;
        self.ctx.fetch(
            cx,
            move |b| Ok((id.clone(), b.invoice_entries(&id)?)),
            |this, res, cx| {
                if let Ok(found) = res
                    && matches!(&this.view, View::Detail(open) if *open == found.0)
                {
                    this.invoice_entries = Some(found);
                    cx.notify();
                }
            },
        );
        cx.notify();
    }

    fn make_editor(inv: &Invoice, window: &mut Window, cx: &mut Context<Self>) -> Editor {
        let mut subs = vec![];
        let rows = inv
            .lines
            .iter()
            .map(|l| Self::make_row(l, &mut subs, window, cx))
            .collect();
        let details = DetailInputs {
            title: ui::forms::input(
                t("gendan.fakturaer.title_placeholder"),
                inv.title.as_deref().unwrap_or_default(),
                window,
                cx,
            ),
            due: ui::forms::input(
                t("fakturaer.period.placeholder"),
                &format::date_short(inv.due),
                window,
                cx,
            ),
            notes: ui::forms::input(
                t("gendan.fakturaer.notes_placeholder"),
                inv.notes.as_deref().unwrap_or_default(),
                window,
                cx,
            ),
        };
        Editor {
            rows,
            details,
            _subs: subs,
        }
    }

    /// Titel, forfald og noter fra felterne. Titlen kun i lokal tilstand.
    fn edited_details(&self, cx: &App) -> Result<Option<InvoiceDetails>, String> {
        let Some(ed) = &self.editor else {
            return Ok(None);
        };
        let today = self.ctx.backend.today();
        let due = ui::forms::parse_date(&ui::forms::value(&ed.details.due, cx), today)
            .ok_or_else(|| t("gendan.fakturaer.err_due").to_string())?;
        let opt = |s: String| (!s.is_empty()).then_some(s);
        let local = matches!(self.ctx.backend.mode(), Mode::Local);
        Ok(Some(InvoiceDetails {
            title: if local {
                opt(ui::forms::value(&ed.details.title, cx))
            } else {
                None
            },
            due,
            notes: opt(ui::forms::value(&ed.details.notes, cx)),
        }))
    }

    fn delete_draft(&mut self, id: Id, cx: &mut Context<Self>) {
        if !self.confirm_delete {
            self.confirm_delete = true;
            cx.notify();
            return;
        }
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| b.delete_invoice_draft(&id),
            |this, res, cx| {
                this.busy = false;
                this.confirm_delete = false;
                match res {
                    Ok(()) => {
                        this.view = View::List;
                        this.editor = None;
                        this.notice = Some((t("gendan.fakturaer.deleted").into(), false));
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
                cx.notify();
            },
        );
    }

    fn make_row(
        l: &InvoiceLine,
        subs: &mut Vec<Subscription>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> LineInputs {
        let mk = |v: String, ph: &'static str, window: &mut Window, cx: &mut Context<Self>| {
            cx.new(|cx| InputState::new(window, cx).placeholder(ph).default_value(v))
        };
        let row = LineInputs {
            desc: mk(
                l.description.clone(),
                t("fakturaer.line.placeholder_text"),
                window,
                cx,
            ),
            hours: mk(
                hours_input(l.minutes),
                t("fakturaer.line.placeholder_hours"),
                window,
                cx,
            ),
            rate: mk(
                kroner_input(l.rate),
                t("fakturaer.line.placeholder_rate"),
                window,
                cx,
            ),
            entry_ids: l.entry_ids.clone(),
            stored: l.stored.clone(),
        };
        for i in [&row.desc, &row.hours, &row.rate] {
            subs.push(cx.subscribe(i, |_, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::Change) {
                    cx.notify();
                }
            }));
        }
        row
    }

    /// Linjerne fra felterne, eller første fejl.
    fn edited_lines(&self, cx: &App) -> Result<Vec<InvoiceLine>, String> {
        let Some(ed) = &self.editor else {
            return Ok(vec![]);
        };
        ed.rows
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let desc = r.desc.read(cx).value().trim().to_string();
                if desc.is_empty() {
                    return Err(tf(
                        "fakturaer.line.err_text",
                        &[("n", &(i + 1).to_string())],
                    ));
                }
                let minutes = parse_quantity(&r.hours.read(cx).value()).map_err(|e| {
                    tf(
                        "fakturaer.line.err",
                        &[("n", &(i + 1).to_string()), ("error", e)],
                    )
                })?;
                let rate = parse_kroner(&r.rate.read(cx).value()).map_err(|e| {
                    tf(
                        "fakturaer.line.err",
                        &[("n", &(i + 1).to_string()), ("error", e)],
                    )
                })?;
                Ok(InvoiceLine {
                    description: desc,
                    minutes,
                    rate,
                    entry_ids: r.entry_ids.clone(),
                    stored: r.stored.clone(),
                })
            })
            .collect()
    }

    fn add_line(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(mut ed) = self.editor.take() {
            let l = InvoiceLine {
                description: String::new(),
                minutes: 60,
                rate: ed
                    .rows
                    .last()
                    .and_then(|r| parse_kroner(&r.rate.read(cx).value()).ok())
                    .unwrap_or(85_000),
                entry_ids: vec![],
                stored: None,
            };
            let row = Self::make_row(&l, &mut ed._subs, window, cx);
            row.desc.update(cx, |s, cx| s.focus(window, cx));
            ed.rows.push(row);
            self.editor = Some(ed);
            cx.notify();
        }
    }

    fn remove_line(&mut self, i: usize, cx: &mut Context<Self>) {
        if let Some(ed) = &mut self.editor
            && i < ed.rows.len()
        {
            ed.rows.remove(i);
            cx.notify();
        }
    }

    /// Gem linjer og detaljer. Med `confirm` åbnes bekræftelsen bagefter,
    /// så den viser de gemte tal. Intet sendes herfra: det sker først, når
    /// brugeren trykker "Send til kunden" i bekræftelsen (`confirm_send`).
    fn save_lines(&mut self, id: Id, confirm: Option<SendKind>, cx: &mut Context<Self>) {
        let lines = match self.edited_lines(cx) {
            Ok(l) => l,
            Err(e) => {
                self.notice = Some((e.into(), true));
                cx.notify();
                return;
            }
        };
        let details = match self.edited_details(cx) {
            Ok(d) => d,
            Err(e) => {
                self.notice = Some((e.into(), true));
                cx.notify();
                return;
            }
        };
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| {
                if let Some(d) = details {
                    b.update_invoice_details(&id, d)?;
                }
                let inv = b.update_invoice_lines(&id, lines)?;
                let preview = match confirm {
                    Some(_) => Some(b.invoice_send_preview(&inv.id)?),
                    None => None,
                };
                Ok((inv, preview))
            },
            move |this, res, cx| {
                this.busy = false;
                match (res, confirm) {
                    (Ok((_, Some(preview))), Some(kind)) => {
                        // En mail kræver en modtager; uden mail er "Udsted" nok.
                        let kind = if preview.sends_mail {
                            kind
                        } else {
                            SendKind::NoMail
                        };
                        this.notice = None;
                        this.send_dialog = Some(SendDialog {
                            kind,
                            preview,
                            busy: false,
                            error: None,
                        });
                        this.refocus = Some(Refocus::Cancel);
                    }
                    (Ok(_), _) => {
                        this.notice = Some((t("fakturaer.notice.lines_saved").into(), false));
                    }
                    (Err(e), _) => this.notice = Some((e.to_string().into(), true)),
                }
                cx.notify();
            },
        );
    }

    /// "Annuller" i bekræftelsen: intet er sendt, og fakturaen er en kladde.
    fn cancel_send(&mut self, cx: &mut Context<Self>) {
        if self.send_dialog.as_ref().is_some_and(|d| d.busy) {
            return;
        }
        if let Some(d) = self.send_dialog.take() {
            self.refocus = Some(Refocus::Page);
            let msg = if d.kind == SendKind::Reminder {
                t("fakturaer.notice.reminder_not_sent")
            } else {
                t("fakturaer.notice.not_sent")
            };
            self.notice = Some((msg.into(), false));
        }
        cx.notify();
    }

    /// "Send påmindelse": åbner samme bekræftelse som afsendelsen, med
    /// modtager og beløb. Intet sendes før "Send påmindelse" i dialogen.
    fn open_reminder(&mut self, id: Id, cx: &mut Context<Self>) {
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| b.invoice_send_preview(&id),
            |this, res, cx| {
                this.busy = false;
                match res {
                    Ok(preview) => {
                        this.notice = None;
                        this.send_dialog = Some(SendDialog {
                            kind: SendKind::Reminder,
                            preview,
                            busy: false,
                            error: None,
                        });
                        this.refocus = Some(Refocus::Cancel);
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
                cx.notify();
            },
        );
    }

    /// "Send til kunden": det bevidste valg, der sender mailen (eller
    /// udsteder fakturaen uden mail). Modtageren, brugeren så, følger med, og
    /// datalaget sender kun, hvis den stadig er kundens mailadresse.
    fn confirm_send(&mut self, cx: &mut Context<Self>) {
        let Some(d) = self.send_dialog.as_mut() else {
            return;
        };
        if d.busy {
            return;
        }
        d.busy = true;
        d.error = None;
        let (id, kind, to) = (
            d.preview.invoice_id.clone(),
            d.kind,
            d.preview.recipient.clone(),
        );
        self.ctx.mutate(
            cx,
            move |b| match kind {
                SendKind::Mail => b.send_invoice(&id, to.as_deref()),
                SendKind::NoMail => b.issue_invoice(&id),
                SendKind::Reminder => b.send_reminder(&id, to.as_deref()),
            },
            move |this, res, cx| {
                match res {
                    Ok(inv) => {
                        this.send_dialog = None;
                        this.editor = None;
                        this.refocus = Some(Refocus::Page);
                        let title = invoice_title(&inv);
                        let msg = match (kind, inv.delivery.as_ref().and_then(|d| d.to.clone())) {
                            (SendKind::Reminder, Some(to)) => tf(
                                "fakturaer.notice.reminder_sent",
                                &[("title", &title), ("to", &to)],
                            ),
                            (SendKind::Mail, Some(to)) => tf(
                                "fakturaer.notice.sent_to",
                                &[("title", &title), ("to", &to)],
                            ),
                            _ => tf("fakturaer.notice.issued", &[("title", &title)]),
                        };
                        this.notice = Some((msg.into(), false));
                    }
                    Err(e) => {
                        let text: SharedString = send_error_text(&e, kind).into();
                        if send_outcome_uncertain(&e, kind) {
                            // Mailen kan være gået: luk bekræftelsen, så
                            // "Send til kunden" ikke står klar til en mail nummer to.
                            this.send_dialog = None;
                            this.refocus = Some(Refocus::Page);
                            this.notice = Some((text, true));
                        } else if let Some(d) = this.send_dialog.as_mut() {
                            d.busy = false;
                            d.error = Some(text);
                        }
                        // Mailen kan være gået: vis fakturaens rigtige status.
                        this.reload(cx);
                    }
                }
                cx.notify();
            },
        );
    }

    /// "Markér betalt": spørger om betalingsdatoen (i dag som standard), som
    /// web's `markPaid` med `paidDate`.
    fn open_paid(&mut self, id: Id, window: &mut Window, cx: &mut Context<Self>) {
        let today = self.ctx.backend.today();
        let date = forms::input("20.11.2026", &format::date_short(today), window, cx);
        date.update(cx, |s, cx| s.focus(window, cx));
        self.paid_form = Some(PaidForm { id, date, error: None });
        cx.notify();
    }

    fn save_paid(&mut self, cx: &mut Context<Self>) {
        let today = self.ctx.backend.today();
        let Some(f) = self.paid_form.as_mut() else {
            return;
        };
        let Some(paid) = parse_paid_date(&forms::value(&f.date, cx), today) else {
            f.error = Some(t("fakturaer.paid.err_date").into());
            cx.notify();
            return;
        };
        let id = f.id.clone();
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| b.mark_invoice_paid(&id, paid),
            |this, res, _| {
                this.busy = false;
                match res {
                    Ok(()) => {
                        this.paid_form = None;
                        this.notice = Some((t("fakturaer.notice.paid").into(), false));
                    }
                    Err(e) => {
                        if let Some(f) = this.paid_form.as_mut() {
                            f.error = Some(e.to_string().into());
                        }
                    }
                }
            },
        );
    }

    /// "Gem som PDF". Cloud: web's egen PDF (`Backend::web_invoice_pdf`), med
    /// web's moms og skabelon. Den viser fakturaen, som den er gemt i web,
    /// så rettede linjer skal gemmes først. Lokalt tegner appen selv PDF'en.
    fn save_pdf(&mut self, inv: Invoice, unsaved: bool, cx: &mut Context<Self>) {
        if unsaved && matches!(self.ctx.backend.mode(), Mode::Cloud { .. }) {
            self.notice = Some((t("fakturaer.notice.pdf_unsaved").into(), true));
            cx.notify();
            return;
        }
        let buyer = self
            .data
            .ready()
            .and_then(|(_, cs, _)| cs.iter().find(|c| c.id == inv.customer_id))
            .map(|c| export::Buyer {
                name: c.name.clone(),
                cvr: c.cvr.clone(),
                email: c.email.clone(),
            })
            .unwrap_or_else(|| export::Buyer::named(&self.customer_name(&inv.customer_id)));
        self.ctx.fetch(
            cx,
            move |b| {
                let bytes = match b.web_invoice_pdf(&inv.id)? {
                    Some(web) => web,
                    None => {
                        let sender = b.invoice_profile()?;
                        export::invoice_pdf(&inv, &buyer, sender.as_ref())
                    }
                };
                export::write_unique(
                    &export::export_dir(),
                    &export::invoice_file_name(&inv),
                    &bytes,
                )
                .map_err(|e| crate::backend::BackendError::Other(e.to_string()))
            },
            |this, res, _| match res {
                Ok(path) => {
                    this.notice = Some((
                        tf(
                            "fakturaer.notice.pdf_saved",
                            &[("path", &path.display().to_string())],
                        )
                        .into(),
                        false,
                    ));
                    this.last_file = Some(path);
                }
                Err(e) => {
                    this.notice = Some((
                        tf("fakturaer.notice.pdf_failed", &[("error", &e.to_string())]).into(),
                        true,
                    ))
                }
            },
        );
    }

    fn create_draft(&mut self, cx: &mut Context<Self>) {
        let Some(cid) = self.new_customer.clone() else {
            self.notice = Some((t("fakturaer.notice.choose_customer").into(), true));
            cx.notify();
            return;
        };
        let (from, to) = match self.period(cx) {
            Ok(p) => p,
            Err(e) => {
                self.notice = Some((e.into(), true));
                cx.notify();
                return;
            }
        };
        let entries = self
            .uninvoiced
            .ready()
            .and_then(|l| l.iter().find(|(c, _)| c.id == cid))
            .map(|(_, e)| in_period(e, from, to))
            .unwrap_or_default();
        if entries.is_empty() {
            self.notice = Some((t("fakturaer.notice.none_in_period").into(), true));
            cx.notify();
            return;
        }
        let projects: HashMap<Id, String> = self
            .data
            .ready()
            .map(|(_, _, ps)| ps.iter().map(|p| (p.id.clone(), p.name.clone())).collect())
            .unwrap_or_default();
        let grouping = self.grouping;
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| {
                let ids: Vec<Id> = entries.iter().map(|e| e.id.clone()).collect();
                let draft = b.create_invoice_draft(&cid, &ids)?;
                match grouping {
                    DraftGrouping::PerProject => Ok(draft),
                    DraftGrouping::PerEntry => b.update_invoice_lines(
                        &draft.id,
                        per_entry_lines(&draft.lines, &entries, &projects),
                    ),
                }
            },
            |this, res, cx| {
                this.busy = false;
                match res {
                    Ok(inv) => {
                        this.notice = Some((t("fakturaer.notice.draft_created").into(), false));
                        this.open_new(inv);
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
                cx.notify();
            },
        );
    }

    fn period(&self, cx: &App) -> Result<(NaiveDate, NaiveDate), &'static str> {
        let from = crate::screens::rapporter::parse_date(
            &self.period_from.read(cx).value(),
            self.ctx.backend.today(),
        )
        .ok_or(t("fakturaer.period.err_from"))?;
        let to = crate::screens::rapporter::parse_date(
            &self.period_to.read(cx).value(),
            self.ctx.backend.today(),
        )
        .ok_or(t("fakturaer.period.err_to"))?;
        if to < from {
            return Err(t("fakturaer.period.err_order"));
        }
        Ok((from, to))
    }
}

impl FakturaerScreen {
    fn render_notice(&self, b: &Brand, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (msg, is_err) = self.notice.clone()?;
        let el = if is_err {
            ui::el("faktura-besked", Role::Alert, msg.clone()).text_color(b.danger)
        } else {
            ui::el("faktura-besked", Role::Status, msg.clone()).text_color(b.primary)
        };
        Some(
            h_flex()
                .gap_3()
                .items_center()
                .child(el.text_sm().child(msg))
                .when(!is_err && self.last_file.is_some(), |d| {
                    d.child(
                        Button::new("faktura-vis-fil")
                            .label(t("fakturaer.action.reveal"))
                            .small()
                            .ghost()
                            .on_click(cx.listener(|this, _, _, cx| {
                                if let Some(p) = &this.last_file {
                                    cx.reveal_path(p);
                                }
                            })),
                    )
                })
                .into_any_element(),
        )
    }

    fn render_list(&self, b: &Brand, data: &Data, cx: &mut Context<Self>) -> AnyElement {
        let (invoices, _, _) = data;
        let shown: Vec<&Invoice> = invoices
            .iter()
            .filter(|i| self.filter.matches(i.status))
            .collect();
        let selected = Filter::ALL
            .iter()
            .position(|f| *f == self.filter)
            .unwrap_or(0);
        let labels: Vec<String> = Filter::ALL
            .iter()
            .map(|f| {
                let n = invoices.iter().filter(|i| f.matches(i.status)).count();
                format!("{} ({n})", f.label())
            })
            .collect();
        let label_refs: Vec<&str> = labels.iter().map(String::as_str).collect();
        let this = cx.entity().downgrade();
        let filter = ui::segment(
            "faktura-filter",
            t("fakturaer.filter.label"),
            &label_refs,
            selected,
            move |i, _, cx| {
                let _ = this.update(cx, |s, cx| {
                    s.filter = Filter::ALL[i];
                    cx.notify();
                });
            },
        );
        let today = self.ctx.backend.today();
        let body: AnyElement = if invoices.is_empty() {
            ui::empty_state_icon(
                b,
                "fakturaer-tom",
                Icon::FileText,
                t("fakturaer.list.empty_title"),
                t("fakturaer.list.empty_body"),
            )
            .into_any_element()
        } else if shown.is_empty() {
            ui::empty_state_icon(
                b,
                "fakturaer-tom-filter",
                Icon::Search,
                t("fakturaer.list.none_title"),
                t("fakturaer.list.none_body"),
            )
            .into_any_element()
        } else {
            ui::list("faktura-liste", t("fakturaer.list.label"))
                .children(shown.iter().enumerate().map(|(i, inv)| {
                    let title = invoice_title(inv);
                    let customer = self.customer_name(&inv.customer_id);
                    let total = export::kroner(inv.total());
                    let due = tf(
                        "fakturaer.row.due",
                        &[("date", &format::date_medium(inv.due, today.year()))],
                    );
                    let label = tf(
                        "fakturaer.row.label",
                        &[
                            ("title", &title),
                            ("customer", &customer),
                            ("total", &total),
                            ("status", status_label(inv.status)),
                            ("due", &due),
                        ],
                    );
                    let id = inv.id.clone();
                    ui::list_row(b, ("faktura-raekke", i), label.clone())
                        .p_0()
                        .child(
                        Button::new(("faktura-aabn", i))
                            .ghost()
                            .w_full()
                            .accessibility_label(tf("fakturaer.row.open", &[("label", &label)]))
                            .on_click(
                                cx.listener(move |this, _, w, cx| this.open(id.clone(), w, cx)),
                            )
                            .child(
                                h_flex()
                                    .w_full()
                                    .gap_3()
                                    .items_center()
                                    .child(
                                        div()
                                            .w(px(110.))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(title),
                                    )
                                    .child(
                                        v_flex()
                                            .flex_1()
                                            .min_w_0()
                                            .child(div().truncate().child(customer))
                                            .child(
                                                div()
                                                    .truncate()
                                                    .text_xs()
                                                    .text_color(b.grey)
                                                    .child(
                                                    delivery_text(inv, today).unwrap_or_else(
                                                        || {
                                                            if inv.status == InvoiceStatus::Draft {
                                                                t("fakturaer.delivery.draft_short")
                                                                    .into()
                                                            } else {
                                                                String::new()
                                                            }
                                                        },
                                                    ),
                                                ),
                                            ),
                                    )
                                    .child(div().w(px(130.)).text_color(b.grey).child(due))
                                    .child(div().w(px(130.)).flex().justify_end().child(total))
                                    .child(div().w(px(110.)).flex().justify_end().child(
                                        ui::badge_icon(
                                            b,
                                            ("faktura-status", i),
                                            status_label(inv.status),
                                            status_tone(inv.status),
                                            status_icon(inv.status),
                                        ),
                                    )),
                            ),
                    )
                }))
                .into_any_element()
        };
        v_flex()
            .gap_3()
            .child(
                h_flex()
                    .justify_between()
                    .items_center()
                    .gap_2()
                    .child(filter)
                    .child(
                        Button::new("faktura-ny")
                            .icon(Icon::Plus)
                            .label(t("fakturaer.action.new_draft"))
                            .primary()
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| this.show_new(cx))),
                    ),
            )
            .child(body)
            .into_any_element()
    }

    fn render_new(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let back = Button::new("faktura-tilbage")
            .icon(Icon::ChevronLeft)
            .label(t("fakturaer.action.back"))
            .ghost()
            .small()
            .on_click(cx.listener(|this, _, _, cx| this.show_list(cx)));
        let content: AnyElement = match &self.uninvoiced {
            Loadable::Loading => {
                ui::loading_state(b, "ny-kladde-indlaeser", t("fakturaer.loading.uninvoiced"))
                    .into_any_element()
            }
            Loadable::Failed(e) => ui::error_state(b, "ny-kladde-fejl", e.clone())
                .child(
                    Button::new("ny-kladde-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("fakturaer.action.retry"))
                        .small()
                        .on_click(cx.listener(|this, _, _, cx| this.show_new(cx))),
                )
                .into_any_element(),
            Loadable::Ready(list) if list.is_empty() => ui::empty_state_icon(
                b,
                "ny-kladde-tom",
                Icon::Clock,
                t("fakturaer.new.empty_title"),
                t("fakturaer.new.empty_body"),
            )
            .into_any_element(),
            Loadable::Ready(list) => {
                let names: Vec<String> = list
                    .iter()
                    .map(|(c, e)| {
                        let m: u32 = e.iter().map(|e| e.minutes).sum();
                        format!("{} ({})", c.name, format::hours(m))
                    })
                    .collect();
                let refs: Vec<&str> = names.iter().map(String::as_str).collect();
                let sel = self
                    .new_customer
                    .as_ref()
                    .and_then(|id| list.iter().position(|(c, _)| &c.id == id))
                    .unwrap_or(0);
                let ids: Vec<Id> = list.iter().map(|(c, _)| c.id.clone()).collect();
                let weak = cx.entity().downgrade();
                let customer_pick = ui::segment(
                    "ny-kladde-kunde",
                    t("fakturaer.field.customer"),
                    &refs,
                    sel,
                    move |i, _, cx| {
                        let id = ids[i].clone();
                        let _ = weak.update(cx, |s, cx| {
                            s.new_customer = Some(id);
                            cx.notify();
                        });
                    },
                );
                let weak = cx.entity().downgrade();
                let grouping = ui::segment(
                    "ny-kladde-gruppering",
                    t("fakturaer.field.lines"),
                    &[t("fakturaer.new.per_project"), t("fakturaer.new.per_entry")],
                    match self.grouping {
                        DraftGrouping::PerProject => 0,
                        DraftGrouping::PerEntry => 1,
                    },
                    move |i, _, cx| {
                        let _ = weak.update(cx, |s, cx| {
                            s.grouping = if i == 0 {
                                DraftGrouping::PerProject
                            } else {
                                DraftGrouping::PerEntry
                            };
                            cx.notify();
                        });
                    },
                );
                let preview: SharedString = match (self.period(cx), list.get(sel)) {
                    (Ok((from, to)), Some((_, entries))) => {
                        let e = in_period(entries, from, to);
                        let m: u32 = e.iter().map(|e| e.minutes).sum();
                        tf(
                            "fakturaer.new.summary",
                            &[
                                ("count", &e.len().to_string()),
                                ("hours", &format::hours(m)),
                                ("from", &format::date_short(from)),
                                ("to", &format::date_short(to)),
                            ],
                        )
                        .into()
                    }
                    (Err(e), _) => e.into(),
                    _ => "".into(),
                };
                v_flex()
                    .gap_4()
                    .child(
                        v_flex()
                            .gap_1()
                            .child(ui::heading(
                                b,
                                "ny-kladde-kunde-titel",
                                t("fakturaer.field.customer"),
                                3,
                            ))
                            .child(customer_pick),
                    )
                    .child(
                        h_flex()
                            .gap_3()
                            .child(
                                v_flex()
                                    .gap_1()
                                    .w(px(180.))
                                    .child(ui::heading(
                                        b,
                                        "ny-kladde-fra-titel",
                                        t("fakturaer.field.from"),
                                        3,
                                    ))
                                    .child(
                                        Input::new(&self.period_from)
                                            .id("ny-kladde-fra")
                                            .aria_label(t("fakturaer.field.from_date")),
                                    ),
                            )
                            .child(
                                v_flex()
                                    .gap_1()
                                    .w(px(180.))
                                    .child(ui::heading(
                                        b,
                                        "ny-kladde-til-titel",
                                        t("fakturaer.field.to"),
                                        3,
                                    ))
                                    .child(
                                        Input::new(&self.period_to)
                                            .id("ny-kladde-til")
                                            .aria_label(t("fakturaer.field.to_date")),
                                    ),
                            ),
                    )
                    .child(
                        v_flex()
                            .gap_1()
                            .child(ui::heading(
                                b,
                                "ny-kladde-linjer-titel",
                                t("fakturaer.field.lines"),
                                3,
                            ))
                            .child(grouping),
                    )
                    .child(ui::muted(b, "ny-kladde-opsummering", preview))
                    .child(
                        h_flex().child(
                            Button::new("ny-kladde-opret")
                                .label(t("fakturaer.action.create_draft"))
                                .primary()
                                .loading(self.busy)
                                .disabled(self.busy)
                                .on_click(cx.listener(|this, _, _, cx| this.create_draft(cx))),
                        ),
                    )
                    .into_any_element()
            }
        };
        v_flex()
            .gap_3()
            .child(h_flex().child(back))
            .child(
                ui::card(b, "ny-kladde", t("fakturaer.new.title"))
                    .child(ui::heading(
                        b,
                        "ny-kladde-titel",
                        t("fakturaer.new.title"),
                        2,
                    ))
                    .child(content),
            )
            .into_any_element()
    }

    fn render_detail(&self, b: &Brand, inv: &Invoice, cx: &mut Context<Self>) -> AnyElement {
        let back = Button::new("faktura-tilbage")
            .icon(Icon::ChevronLeft)
            .label(t("fakturaer.action.back"))
            .ghost()
            .small()
            .on_click(cx.listener(|this, _, _, cx| this.show_list(cx)));
        let customer = self.customer_name(&inv.customer_id);
        let title = tf(
            "fakturaer.detail.title",
            &[("invoice", &invoice_title(inv)), ("customer", &customer)],
        );
        // Totaler: fra felterne, hvis kladden redigeres.
        let edited = self.edited_lines(cx);
        let details = self.edited_details(cx).ok().flatten();
        let calc = match (&self.editor, &edited) {
            (Some(_), Ok(lines)) => Some(Invoice {
                lines: lines.clone(),
                title: details
                    .as_ref()
                    .map_or(inv.title.clone(), |d| d.title.clone()),
                due: details.as_ref().map_or(inv.due, |d| d.due),
                notes: details
                    .as_ref()
                    .map_or(inv.notes.clone(), |d| d.notes.clone()),
                ..inv.clone()
            }),
            (Some(_), Err(_)) => None,
            (None, _) => Some(inv.clone()),
        };
        let lines: AnyElement = if let Some(ed) = &self.editor {
            v_flex()
                .gap_2()
                .child(
                    h_flex()
                        .gap_2()
                        .text_xs()
                        .text_color(b.grey)
                        .child(div().flex_1().child(t("fakturaer.line.col_text")))
                        .child(div().w(px(90.)).child(t("fakturaer.line.col_hours")))
                        .child(div().w(px(110.)).child(t("fakturaer.line.col_rate")))
                        .child(
                            div()
                                .w(px(120.))
                                .flex()
                                .justify_end()
                                .child(t("fakturaer.line.col_amount")),
                        )
                        .child(div().w(px(70.))),
                )
                .child(
                    ui::list("faktura-linjer", t("fakturaer.line.list_label")).children(
                        ed.rows.iter().enumerate().map(|(i, r)| {
                            let amount = parse_quantity(&r.hours.read(cx).value())
                                .ok()
                                .zip(parse_kroner(&r.rate.read(cx).value()).ok())
                                .map(|(m, rate)| {
                                    InvoiceLine {
                                        description: String::new(),
                                        minutes: m,
                                        rate,
                                        entry_ids: vec![],
                                        stored: r.stored.clone(),
                                    }
                                    .amount()
                                });
                            let n = i + 1;
                            ui::list_row(
                                b,
                                ("faktura-linje", i),
                                tf("fakturaer.line.row", &[("n", &n.to_string())]),
                            )
                            .px_0()
                            .gap_2()
                            .child(div().flex_1().child(
                                Input::new(&r.desc).id(("linje-tekst", i)).aria_label(tf(
                                    "fakturaer.line.aria_text",
                                    &[("n", &n.to_string())],
                                )),
                            ))
                            .child(div().w(px(90.)).child(
                                Input::new(&r.hours).id(("linje-timer", i)).aria_label(tf(
                                    "fakturaer.line.aria_hours",
                                    &[("n", &n.to_string())],
                                )),
                            ))
                            .child(div().w(px(110.)).child(
                                Input::new(&r.rate).id(("linje-pris", i)).aria_label(tf(
                                    "fakturaer.line.aria_rate",
                                    &[("n", &n.to_string())],
                                )),
                            ))
                            .child(
                                ui::text(
                                    ("linje-beloeb", i),
                                    amount.map(export::kroner).unwrap_or_else(|| "–".into()),
                                )
                                .w(px(120.))
                                .flex()
                                .justify_end(),
                            )
                            .child(
                                Button::new(("linje-fjern", i))
                                    .label(t("fakturaer.line.remove"))
                                    .ghost()
                                    .xsmall()
                                    .accessibility_label(tf(
                                        "fakturaer.line.remove_n",
                                        &[("n", &n.to_string())],
                                    ))
                                    .on_click(
                                        cx.listener(move |this, _, _, cx| this.remove_line(i, cx)),
                                    ),
                            )
                        }),
                    ),
                )
                .child(
                    h_flex().child(
                        Button::new("linje-tilfoej")
                            .label(t("fakturaer.line.add"))
                            .ghost()
                            .small()
                            .on_click(cx.listener(|this, _, w, cx| this.add_line(w, cx))),
                    ),
                )
                .into_any_element()
        } else {
            ui::list("faktura-linjer", t("fakturaer.line.list_label"))
                .children(inv.lines.iter().enumerate().map(|(i, l)| {
                    let label = tf(
                        "fakturaer.line.label",
                        &[
                            ("description", &l.description),
                            ("hours", &format::hours(l.minutes)),
                            ("rate", &export::kroner(l.rate)),
                            ("amount", &export::kroner(l.amount())),
                        ],
                    );
                    ui::list_row(b, ("faktura-linje", i), label)
                        .child(div().flex_1().child(l.description.clone()))
                        .child(div().w(px(90.)).child(format::hours(l.minutes)))
                        .child(div().w(px(130.)).text_color(b.grey).child(tf(
                            "fakturaer.line.rate_per_hour",
                            &[("rate", &export::kroner(l.rate))],
                        )))
                        .child(
                            div()
                                .w(px(130.))
                                .flex()
                                .justify_end()
                                .child(export::kroner(l.amount())),
                        )
                }))
                .into_any_element()
        };
        // Rettede, ikke gemte linjer: web's tal og PDF gælder den gemte faktura.
        let unsaved = calc
            .as_ref()
            .is_none_or(|c| lines_unsaved(&c.lines, &inv.lines));
        // Web's PDF viser også den gemte forfaldsdato og noter. En ugyldig
        // dato i feltet tæller som ikke gemt.
        let pdf_unsaved = unsaved
            || match self.edited_details(cx) {
                Ok(Some(d)) => details_unsaved(&d, inv),
                Ok(None) => false,
                Err(_) => true,
            };
        let web = self
            .web_totals
            .as_ref()
            .filter(|(open, _)| *open == inv.id)
            .map(|(_, w)| w);
        let totals = match &calc {
            Some(c) => {
                let texts = totals_text(c, unsaved, web);
                v_flex()
                    .gap_1()
                    .items_end()
                    .child(ui::text("faktura-subtotal", texts.subtotal).text_sm())
                    .child(
                        ui::text("faktura-moms", texts.vat)
                            .text_sm()
                            .text_color(if texts.vat_failed { b.danger } else { b.grey }),
                    )
                    .children(texts.total.map(|total| {
                        ui::text("faktura-total", total)
                            .text_lg()
                            .font_weight(FontWeight::BOLD)
                    }))
            }
            None => v_flex().items_end().child(
                ui::el(
                    "faktura-total-fejl",
                    Role::Alert,
                    edited.clone().err().unwrap_or_default(),
                )
                .text_sm()
                .text_color(b.danger)
                .child(edited.err().unwrap_or_default()),
            ),
        };
        let id = inv.id.clone();
        let is_cloud = matches!(self.ctx.backend.mode(), Mode::Cloud { .. });
        let mut actions = h_flex().gap_2().flex_wrap();
        if inv.status == InvoiceStatus::Draft {
            let (i1, i2, i3) = (id.clone(), id.clone(), id.clone());
            actions =
                actions
                    .child(
                        Button::new("faktura-gem")
                            .label(t("fakturaer.action.save_lines"))
                            .disabled(self.busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.save_lines(i1.clone(), None, cx)
                            })),
                    )
                    // Sender intet: åbner bekræftelsen med modtager og beløb.
                    .child(
                        Button::new("faktura-send")
                            .label(if is_cloud {
                                t("fakturaer.action.send_cloud")
                            } else {
                                t("fakturaer.action.send_local")
                            })
                            .primary()
                            .loading(self.busy)
                            .disabled(self.busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.save_lines(i2.clone(), Some(SendKind::Mail), cx)
                            })),
                    )
                    .when(is_cloud, |a| {
                        a.child(
                            Button::new("faktura-udsted")
                                .label(t("fakturaer.action.issue"))
                                .disabled(self.busy)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.save_lines(i3.clone(), Some(SendKind::NoMail), cx)
                                })),
                        )
                    });
        }
        if matches!(inv.status, InvoiceStatus::Sent | InvoiceStatus::Overdue) {
            let i = id.clone();
            actions = actions.child(
                Button::new("faktura-betalt")
                    .label(t("fakturaer.action.mark_paid"))
                    .primary()
                    .disabled(self.busy || self.paid_form.is_some())
                    .on_click(cx.listener(move |this, _, w, cx| this.open_paid(i.clone(), w, cx))),
            );
        }
        // Som web: "Send påmindelse" på en sendt eller forfalden faktura (kun
        // med konto; lokalt sendes ingen mail).
        if can_remind(inv, &self.ctx.backend.mode()) {
            let i = id.clone();
            actions = actions.child(
                Button::new("faktura-paamind")
                    .label(t("fakturaer.action.remind"))
                    .disabled(self.busy)
                    .on_click(cx.listener(move |this, _, _, cx| this.open_reminder(i.clone(), cx))),
            );
        }
        let pdf_inv = match &calc {
            Some(c) => c.clone(),
            None => inv.clone(),
        };
        // gendan: slet kladde (lokal), med bekræftelse.
        if inv.status == InvoiceStatus::Draft {
            let i = id.clone();
            actions = actions.child(
                Button::new("faktura-slet")
                    .label(if self.confirm_delete {
                        t("gendan.fakturaer.delete_confirm")
                    } else {
                        t("gendan.fakturaer.delete")
                    })
                    .danger()
                    .disabled(self.busy)
                    .on_click(cx.listener(move |this, _, _, cx| this.delete_draft(i.clone(), cx))),
            );
            if self.confirm_delete {
                actions = actions.child(
                    Button::new("faktura-slet-fortryd")
                        .label(t("gendan.fakturaer.delete_cancel"))
                        .ghost()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.confirm_delete = false;
                            cx.notify();
                        })),
                );
            }
        }
        actions = actions.child(
            Button::new("faktura-pdf")
                .label(t("fakturaer.action.save_pdf"))
                .on_click(cx.listener(move |this, _, _, cx| this.save_pdf(pdf_inv.clone(), pdf_unsaved, cx))),
        );
        let today_year = self.ctx.backend.today().year();
        v_flex()
            .gap_3()
            .child(h_flex().child(back))
            .child(
                ui::card(b, "faktura-detalje", title.clone())
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(ui::heading(b, "faktura-titel", title, 2))
                            .child(ui::badge_icon(
                                b,
                                "faktura-detalje-status",
                                status_label(inv.status),
                                status_tone(inv.status),
                                status_icon(inv.status),
                            )),
                    )
                    .child(ui::muted(
                        b,
                        "faktura-datoer",
                        match inv.vat_permille {
                            Some(permille) => tf(
                                "fakturaer.detail.dates",
                                &[
                                    ("issued", &format::date_medium(inv.issued, today_year)),
                                    ("due", &format::date_medium(inv.due, today_year)),
                                    ("vat", &export::vat_percent(permille)),
                                ],
                            ),
                            None => tf(
                                "fakturaer.detail.dates_no_vat",
                                &[
                                    ("issued", &format::date_medium(inv.issued, today_year)),
                                    ("due", &format::date_medium(inv.due, today_year)),
                                ],
                            ),
                        },
                    ))
                    .child(self.render_delivery(b, inv))
                    .children(self.render_sender_warning(b, inv))
                    .child(self.render_details(b, inv, is_cloud))
                    .child(lines)
                    .child(totals)
                    .children(self.render_entries_link(b, inv, cx))
                    .children(self.confirm_delete.then(|| {
                        ui::el(
                            "faktura-slet-advarsel",
                            Role::Alert,
                            t("gendan.fakturaer.delete_warning"),
                        )
                        .text_sm()
                        .text_color(b.danger)
                        .child(t("gendan.fakturaer.delete_warning"))
                    }))
                    .child(actions)
                    .children(self.render_paid_form(b, cx)),
            )
            .into_any_element()
    }

    /// Betalingsdatoen under "Markér betalt".
    fn render_paid_form(&self, b: &Brand, cx: &mut Context<Self>) -> Option<AnyElement> {
        let f = self.paid_form.as_ref()?;
        Some(
            v_flex()
                .gap_2()
                .max_w(px(360.))
                .child(forms::text_field(
                    b,
                    "faktura-betalt-dato",
                    t("fakturaer.paid.date"),
                    &f.date,
                    f.error.clone(),
                ))
                .child(
                    h_flex()
                        .gap_2()
                        .child(
                            Button::new("faktura-betalt-gem")
                                .label(t("fakturaer.paid.save"))
                                .primary()
                                .loading(self.busy)
                                .disabled(self.busy)
                                .on_click(cx.listener(|this, _, _, cx| this.save_paid(cx))),
                        )
                        .child(
                            Button::new("faktura-betalt-fortryd")
                                .label(t("fakturaer.paid.cancel"))
                                .ghost()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.paid_form = None;
                                    cx.notify();
                                })),
                        ),
                )
                .into_any_element(),
        )
    }
}

impl FakturaerScreen {
    /// Hvor fakturaen står: kladde (ikke sendt), eller hvornår og til hvem
    /// den blev sendt. Samme tre tilstande som web: Kladde, Sendt, Betalt.
    fn render_delivery(&self, b: &Brand, inv: &Invoice) -> AnyElement {
        let text = match (delivery_text(inv, self.ctx.backend.today()), inv.status) {
            (Some(s), _) => s,
            (None, InvoiceStatus::Draft) => t("fakturaer.delivery.draft").into(),
            (None, _) => t("fakturaer.delivery.unknown").into(),
        };
        ui::el("faktura-afsendelse", Role::Status, text.clone())
            .text_sm()
            .text_color(if inv.status == InvoiceStatus::Draft {
                b.grey
            } else {
                b.ink
            })
            .child(text)
            .into_any_element()
    }

    /// "N poster, X timer" og et link til dem i kalenderen (filtreret til
    /// fakturerede poster).
    fn render_entries_link(
        &self,
        b: &Brand,
        inv: &Invoice,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let (id, entries) = self.invoice_entries.as_ref()?;
        if *id != inv.id || entries.is_empty() {
            return None;
        }
        let first = entries.iter().map(|e| e.date).min()?;
        let minutes: u32 = entries.iter().map(|e| e.minutes).sum();
        let summary = tf(
            "fakturaer.entries.summary",
            &[
                ("count", &entries.len().to_string()),
                ("hours", &format::hours(minutes)),
            ],
        );
        Some(
            h_flex()
                .gap_3()
                .items_center()
                .child(ui::muted(b, "faktura-poster", summary))
                .child(
                    Button::new("faktura-vis-poster")
                        .icon(Icon::Calendar)
                        .label(t("fakturaer.entries.show"))
                        .ghost()
                        .small()
                        .on_click(cx.listener(move |_, _, w, cx| {
                            cx.set_global(crate::screens::kalender::ShowInvoiced(first));
                            w.dispatch_action(Box::new(crate::app::GaTilKalender), cx);
                        })),
                )
                .into_any_element(),
        )
    }

    /// Bekræftelsen før en faktura sendes: hvem den går til, og hvad den
    /// omfatter. "Annuller" har fokus; Enter sender ikke.
    fn render_send_dialog(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let d = self.send_dialog.as_ref()?;
        let p = &d.preview;
        let mail = d.kind.mails();
        let reminder = d.kind == SendKind::Reminder;
        let (overlay, dialog) = forms::modal(
            b,
            "send-dialog",
            match d.kind {
                SendKind::Mail => t("fakturaer.send.title"),
                SendKind::NoMail => t("fakturaer.send.title_issue"),
                SendKind::Reminder => t("fakturaer.send.title_reminder"),
            },
        );
        let no_recipient = mail && p.recipient.is_none();
        let statement: SharedString = match (&p.recipient, mail) {
            (Some(to), true) if reminder => tf("fakturaer.send.reminder_to", &[("to", to)]).into(),
            (Some(to), true) => tf("fakturaer.send.mail_to", &[("to", to)]).into(),
            (None, true) => t("fakturaer.send.no_recipient").into(),
            (_, false) => t("fakturaer.send.no_mail").into(),
        };
        let number = p
            .number
            .clone()
            .unwrap_or_else(|| t("fakturaer.send.number_on_send").into());
        let row = |id: &'static str, label: &'static str, value: String| {
            h_flex()
                .gap_3()
                .justify_between()
                .child(ui::muted(
                    b,
                    SharedString::from(format!("{id}-etiket")),
                    t(label),
                ))
                .child(
                    ui::text(id, value)
                        .text_sm()
                        .font_weight(FontWeight::MEDIUM),
                )
        };
        let confirm_label = match d.kind {
            SendKind::Mail => t("fakturaer.send.confirm"),
            SendKind::NoMail => t("fakturaer.send.confirm_issue"),
            SendKind::Reminder => t("fakturaer.send.confirm_reminder"),
        };
        Some(
            overlay.child(
                dialog
                    .child(
                        ui::el("send-modtager", Role::Alert, statement.clone())
                            .text_color(if no_recipient { b.danger } else { b.ink })
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(statement),
                    )
                    .child(
                        v_flex()
                            .gap_1()
                            .child(row(
                                "send-kunde",
                                "fakturaer.send.customer",
                                p.customer_name.clone(),
                            ))
                            .child(row("send-nummer", "fakturaer.send.number", number))
                            .child(row(
                                "send-poster",
                                "fakturaer.send.entries",
                                p.entry_count.to_string(),
                            ))
                            .child(row(
                                "send-timer",
                                "fakturaer.send.hours",
                                format::hours(p.minutes),
                            ))
                            .child(row(
                                "send-beloeb",
                                if p.vat_included {
                                    "fakturaer.send.total"
                                } else {
                                    "fakturaer.send.total_ex_vat"
                                },
                                export::kroner(p.total),
                            )),
                    )
                    .when(mail && !no_recipient, |d| {
                        d.child(ui::muted(b, "send-advarsel", t("fakturaer.send.warning")))
                    })
                    .children(
                        d.error
                            .clone()
                            .map(|e| forms::form_error(b, "send-fejl", e)),
                    )
                    .child(
                        h_flex()
                            .justify_end()
                            .gap_2()
                            .pt_2()
                            .child(
                                Button::new("send-annuller")
                                    .label(t("fakturaer.send.cancel"))
                                    .track_focus(&self.cancel_focus)
                                    .on_click(cx.listener(|this, _, _, cx| this.cancel_send(cx))),
                            )
                            .child(
                                Button::new("send-bekraeft")
                                    .label(confirm_label)
                                    .primary()
                                    .loading(d.busy)
                                    .disabled(d.busy || no_recipient)
                                    .on_click(cx.listener(|this, _, _, cx| this.confirm_send(cx))),
                            ),
                    ),
            ),
        )
    }
}

impl FakturaerScreen {
    /// Lokal kladde uden fuld afsender: hvad mangler, og hvor det udfyldes.
    fn render_sender_warning(&self, b: &Brand, inv: &Invoice) -> Option<AnyElement> {
        let p = self.profile.as_ref()?;
        let missing = p.missing();
        if inv.status != InvoiceStatus::Draft || missing.is_empty() {
            return None;
        }
        let text = tf(
            "gendan.fakturaer.missing_sender",
            &[("fields", &crate::backend::repo::join_danish(&missing))],
        );
        Some(
            h_flex()
                .gap_3()
                .items_center()
                .child(
                    ui::el("faktura-afsender-mangler", Role::Status, text.clone())
                        .text_sm()
                        .text_color(b.danger)
                        .child(text),
                )
                .child(
                    Button::new("faktura-aabn-opsaetning")
                        .label(t("gendan.fakturaer.open_setup"))
                        .small()
                        .on_click(|_, window, cx| {
                            window.dispatch_action(Box::new(crate::app::GaTilIndstillinger), cx)
                        }),
                )
                .into_any_element(),
        )
    }

    /// Titel, forfald og noter: felter på kladder, tekst på resten.
    fn render_details(&self, b: &Brand, inv: &Invoice, is_cloud: bool) -> AnyElement {
        if let Some(ed) = &self.editor {
            let d = &ed.details;
            let mut top = h_flex().gap_3();
            if !is_cloud {
                top = top.child(ui::forms::text_field(
                    b,
                    "faktura-felt-titel",
                    t("gendan.fakturaer.title"),
                    &d.title,
                    None,
                ));
            }
            top = top.child(div().w(px(160.)).child(ui::forms::text_field(
                b,
                "faktura-felt-forfald",
                t("gendan.fakturaer.due"),
                &d.due,
                None,
            )));
            return v_flex()
                .gap_2()
                .child(top)
                .child(ui::forms::text_field(
                    b,
                    "faktura-felt-noter",
                    t("gendan.fakturaer.notes"),
                    &d.notes,
                    None,
                ))
                .into_any_element();
        }
        v_flex()
            .gap_1()
            .children(
                inv.title
                    .clone()
                    .map(|tl| ui::text("faktura-vis-titel", tl).font_weight(FontWeight::MEDIUM)),
            )
            .children(inv.notes.clone().map(|n| {
                ui::muted(
                    b,
                    "faktura-vis-noter",
                    tf("gendan.fakturaer.notes_shown", &[("notes", &n)]),
                )
                .text_sm()
            }))
            .into_any_element()
    }
}

impl Render for FakturaerScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Link fra en post i kalenderen.
        if let Some(OpenInvoice(id)) = cx
            .try_global::<OpenInvoice>()
            .map(|o| OpenInvoice(o.0.clone()))
        {
            cx.remove_global::<OpenInvoice>();
            self.pending_open_id = Some(id);
        }
        if let Some(id) = self.pending_open_id.clone()
            && self.invoice(&id).is_some()
        {
            self.pending_open_id = None;
            self.open(id, window, cx);
        }
        match self.refocus.take() {
            Some(Refocus::Cancel) if self.send_dialog.is_some() => {
                self.cancel_focus.focus(window, cx)
            }
            Some(Refocus::Page) => self.focus.focus(window, cx),
            _ => {}
        }
        let b = brand(cx);
        let page = ui::page(
            &b,
            "fakturaer",
            t("fakturaer.page.title"),
            Some(t("fakturaer.page.subtitle").into()),
        );
        let notice = self.render_notice(&b, cx);
        let body: AnyElement = match &self.data {
            Loadable::Loading => {
                ui::loading_state(&b, "fakturaer-indlaeser", t("fakturaer.loading.what"))
                    .into_any_element()
            }
            Loadable::Failed(e) => ui::error_state(&b, "fakturaer-fejl", e.clone())
                .child(
                    Button::new("fakturaer-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("fakturaer.action.retry"))
                        .small()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.data = Loadable::Loading;
                            this.reload(cx);
                        })),
                )
                .into_any_element(),
            Loadable::Ready(data) => {
                let data = data.clone();
                match &self.view {
                    View::List => self.render_list(&b, &data, cx),
                    View::New => self.render_new(&b, cx),
                    View::Detail(id) => match data.0.iter().find(|i| &i.id == id) {
                        Some(inv) => self.render_detail(&b, inv, cx),
                        None => ui::empty_state_icon(
                            &b,
                            "faktura-findes-ikke",
                            Icon::FileText,
                            t("fakturaer.detail.gone_title"),
                            t("fakturaer.detail.gone_body"),
                        )
                        .into_any_element(),
                    },
                }
            }
        };
        let dialog = self.render_send_dialog(&b, cx);
        div()
            .relative()
            .size_full()
            .track_focus(&self.focus)
            .capture_key_down(cx.listener(|this, ev: &KeyDownEvent, _, cx| {
                if ev.keystroke.key == "escape" && this.send_dialog.is_some() {
                    this.cancel_send(cx);
                    cx.stop_propagation();
                }
            }))
            .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _, cx| {
                if ev.keystroke.key == "escape" && !matches!(this.view, View::List) {
                    this.show_list(cx);
                    cx.stop_propagation();
                }
            }))
            .child(page.children(notice).child(body))
            .children(dialog)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        Filter, InvoiceStatus, hours_input, in_period, kroner_input, parse_kroner, parse_paid_date,
        parse_quantity, per_entry_lines,
    };
    use crate::backend::{BackendError, Entry, Invoice, InvoiceLine, Mode, can_remind};
    use chrono::NaiveDate;

    #[test]
    fn usikkert_svar_lukker_bekraeftelsen_kun_for_mail() {
        use super::{SendKind, send_outcome_uncertain};
        let timeout = BackendError::Other("timeout".into());
        assert!(send_outcome_uncertain(&timeout, SendKind::Mail));
        assert!(!send_outcome_uncertain(&timeout, SendKind::NoMail));
        assert!(!send_outcome_uncertain(
            &BackendError::Offline,
            SendKind::Mail
        ));
        assert!(!send_outcome_uncertain(
            &BackendError::Validation("x".into()),
            SendKind::Mail
        ));
    }

    fn d(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, day).unwrap()
    }

    fn entry(id: &str, day: u32, project: Option<&str>, desc: &str, minutes: u32) -> Entry {
        Entry {
            id: id.into(),
            customer_id: "k".into(),
            project_id: project.map(Into::into),
            task_id: None,
            description: desc.into(),
            date: d(day),
            start: None,
            end: None,
            minutes,
            billable: true,
            invoice_id: None,
        }
    }

    #[test]
    fn antal_timer() {
        assert_eq!(parse_quantity("1,5"), Ok(90));
        assert_eq!(parse_quantity("32,5 t"), Ok(1950), "over 24 t er tilladt");
        assert_eq!(parse_quantity("1:30"), Ok(90));
        assert_eq!(parse_quantity("45m"), Ok(45));
        assert!(parse_quantity("").is_err());
        assert!(parse_quantity("0").is_err());
        assert!(parse_quantity("abc").is_err());
        assert!(parse_quantity("10000").is_err());
        assert_eq!(hours_input(90), "1,5");
    }

    /// En linje, der åbnes i editoren og gemmes uden rettelser, skal have
    /// samme minutter bagefter, ellers mister den web's gemte beløb.
    #[test]
    fn uaendret_tid_i_editoren_giver_samme_minutter() {
        for m in 1..=24 * 60 {
            assert_eq!(parse_quantity(&hours_input(m)), Ok(m), "{m} min");
        }
    }

    #[test]
    fn betalingsdato_tolkes() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 22).unwrap();
        assert_eq!(parse_paid_date("", today), Some(today), "tom = i dag");
        assert_eq!(parse_paid_date("20.11.2026", today), NaiveDate::from_ymd_opt(2026, 11, 20));
        assert_eq!(parse_paid_date("20.11", today), NaiveDate::from_ymd_opt(2026, 11, 20));
        assert_eq!(parse_paid_date("31.02.2026", today), None);
    }

    /// Web viser "Send påmindelse" på sendt og forfalden faktura, og kun
    /// cloud sender mail.
    #[test]
    fn paamindelse_kun_paa_udstedt() {
        let cloud = Mode::Cloud { organization: "Acme".into() };
        let inv = |status| Invoice {
            id: "i".into(),
            number: Some(1),
            customer_id: "k".into(),
            status,
            issued: NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(),
            due: NaiveDate::from_ymd_opt(2026, 11, 15).unwrap(),
            lines: vec![],
            lines_loaded: true,
            subtotal_hint: 0,
            vat_permille: None,
            number_text: None,
            title: None,
            notes: None,
            delivery: None,
        };
        assert!(can_remind(&inv(InvoiceStatus::Sent), &cloud));
        assert!(can_remind(&inv(InvoiceStatus::Overdue), &cloud));
        assert!(!can_remind(&inv(InvoiceStatus::Draft), &cloud));
        assert!(!can_remind(&inv(InvoiceStatus::Paid), &cloud));
        assert!(!can_remind(&inv(InvoiceStatus::Sent), &Mode::Local), "lokalt sendes ingen mail");
    }

    #[test]
    fn kroner_tolkes() {
        assert_eq!(parse_kroner("850"), Ok(85_000));
        assert_eq!(parse_kroner("850,5"), Ok(85_050));
        assert_eq!(parse_kroner("1.234,50"), Ok(123_450));
        assert_eq!(
            parse_kroner("1.234"),
            Ok(123_400),
            "punktum + 3 cifre = tusinder"
        );
        assert_eq!(parse_kroner("1234.5"), Ok(123_450));
        assert_eq!(parse_kroner("850 kr."), Ok(85_000));
        assert!(parse_kroner("").is_err());
        assert!(parse_kroner("8,505").is_err());
        assert!(parse_kroner("-5").is_err());
        assert_eq!(kroner_input(85_000), "850");
        assert_eq!(kroner_input(85_050), "850,50");
    }

    #[test]
    fn en_linje_pr_post() {
        let entries = vec![
            entry("e1", 22, Some("p1"), "Produktsider", 90),
            entry("e2", 20, Some("p1"), "", 60),
            entry("e3", 21, None, "Møde", 30),
        ];
        let draft = vec![
            InvoiceLine {
                description: "Webshop".into(),
                minutes: 150,
                rate: 75_000,
                entry_ids: vec!["e1".into(), "e2".into()],
                stored: None,
            },
            InvoiceLine {
                description: "Diverse".into(),
                minutes: 30,
                rate: 85_000,
                entry_ids: vec!["e3".into()],
                stored: None,
            },
        ];
        let projects = HashMap::from([("p1".to_string(), "Ny webshop".to_string())]);
        let lines = per_entry_lines(&draft, &entries, &projects);
        let descs: Vec<&str> = lines.iter().map(|l| l.description.as_str()).collect();
        assert_eq!(
            descs,
            [
                "20.10.2026, Ny webshop",
                "21.10.2026, Diverse: Møde",
                "22.10.2026, Ny webshop: Produktsider"
            ]
        );
        assert_eq!(lines[1].rate, 85_000, "prisen følger projektlinjen");
        assert_eq!(lines[2].rate, 75_000);
        let sum: u32 = lines.iter().map(|l| l.minutes).sum();
        assert_eq!(sum, 180, "ingen tid tabt");
        assert_eq!(in_period(&entries, d(21), d(22)).len(), 2);
    }

    #[test]
    fn filtre() {
        assert!(Filter::All.matches(InvoiceStatus::Paid));
        assert!(Filter::Overdue.matches(InvoiceStatus::Overdue));
        assert!(!Filter::Sent.matches(InvoiceStatus::Overdue));
    }

    fn faktura(subtotal: i64, vat_permille: Option<u32>) -> Invoice {
        Invoice {
            id: "f1".into(),
            number: Some(7),
            customer_id: "c1".into(),
            status: InvoiceStatus::Sent,
            issued: NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(),
            due: NaiveDate::from_ymd_opt(2026, 11, 15).unwrap(),
            lines: vec![],
            lines_loaded: false,
            subtotal_hint: subtotal,
            vat_permille,
            number_text: None,
            title: None,
            notes: None,
            delivery: None,
        }
    }

    fn web(subtotal: i64, show_vat: bool) -> crate::backend::WebInvoiceTotals {
        let vat = if show_vat { subtotal / 4 } else { 0 };
        crate::backend::WebInvoiceTotals {
            subtotal,
            vat,
            total: subtotal + vat,
            vat_permille: 250,
            show_vat,
            currency: "DKK".into(),
        }
    }

    /// Cloud: momsen og totalen er web's (som på web's PDF), ikke 25 % regnet
    /// lokalt. Lokalt: fakturaens egen sats.
    #[test]
    fn totaler_fra_web_i_cloud_og_lokalt_ellers() {
        use super::{TotalsText, totals_text};
        use crate::ui::Loadable;
        let cloud = faktura(100_000, None);

        let moms = Loadable::Ready(Some(web(100_000, true)));
        assert_eq!(
            totals_text(&cloud, false, Some(&moms)),
            TotalsText {
                subtotal: "Subtotal 1.000,00 kr.".into(),
                vat: "Moms 25 % 250,00 kr.".into(),
                vat_failed: false,
                total: Some("I alt 1.250,00 kr.".into()),
            }
        );

        // Ikke momsregistreret i web: ingen moms, i alt = subtotal.
        let uden = Loadable::Ready(Some(web(100_000, false)));
        let t = totals_text(&cloud, false, Some(&uden));
        assert_eq!(t.vat, "Ingen moms: virksomheden er ikke momsregistreret i web");
        assert_eq!(t.total.as_deref(), Some("I alt 1.000,00 kr."));

        // Rettede linjer: web's tal gælder den gemte faktura.
        let t = totals_text(&faktura(120_000, None), true, Some(&moms));
        assert_eq!(t.subtotal, "Subtotal 1.200,00 kr.");
        assert!(t.vat.contains("når linjerne er gemt"), "{}", t.vat);
        assert_eq!(t.total.as_deref(), Some("I alt ekskl. moms 1.200,00 kr."));

        // Henter og fejl: ingen total, der kunne være forkert.
        let t = totals_text(&cloud, false, Some(&Loadable::Loading));
        assert_eq!((t.total, t.vat_failed), (None, false));
        let fejl = Loadable::Failed("Ingen forbindelse".into());
        let t = totals_text(&cloud, false, Some(&fejl));
        assert_eq!((t.vat.as_str(), t.vat_failed, t.total), ("Ingen forbindelse", true, None));

        // Lokalt (ingen web-tal): fakturaens sats.
        let lokal = faktura(100_000, Some(250));
        for w in [None, Some(&Loadable::Ready(None))] {
            let t = totals_text(&lokal, false, w);
            assert_eq!(t.vat, "Moms 25 % 250,00 kr.");
            assert_eq!(t.total.as_deref(), Some("I alt 1.250,00 kr."));
        }
    }

    #[test]
    fn web_beloeb_i_anden_valuta_har_valutakoden() {
        let mut w = web(123_450, false);
        assert_eq!(w.money(123_450), "1.234,50 kr.");
        w.currency = "EUR".into();
        assert_eq!(w.money(123_450), "1.234,50 EUR");
    }

    #[test]
    fn rettede_linjer_er_ikke_gemt() {
        use super::lines_unsaved;
        let line = |d: &str, minutes: u32, rate: i64| InvoiceLine {
            description: d.into(),
            minutes,
            rate,
            entry_ids: vec![],
            stored: None,
        };
        let saved = vec![line("Design", 60, 85_000), line("Kode", 30, 85_000)];
        assert!(!lines_unsaved(&saved.clone(), &saved));
        assert!(!lines_unsaved(&[line("Design ", 60, 85_000), line("Kode", 30, 85_000)], &saved));
        assert!(lines_unsaved(&[line("Design", 90, 85_000), line("Kode", 30, 85_000)], &saved));
        assert!(lines_unsaved(&[line("Design", 60, 90_000), line("Kode", 30, 85_000)], &saved));
        assert!(lines_unsaved(&[line("Logo", 60, 85_000), line("Kode", 30, 85_000)], &saved));
        assert!(lines_unsaved(&saved[..1], &saved));
    }

    #[test]
    fn rettet_forfald_eller_note_er_ikke_gemt() {
        use super::details_unsaved;
        use crate::backend::InvoiceDetails;
        let mut saved = faktura(0, None);
        saved.notes = Some("Tak for samarbejdet".into());
        let d = |due: NaiveDate, notes: Option<&str>| InvoiceDetails {
            title: None,
            due,
            notes: notes.map(Into::into),
        };
        let later = NaiveDate::from_ymd_opt(2026, 11, 22).unwrap();
        assert!(!details_unsaved(&d(saved.due, Some("Tak for samarbejdet")), &saved));
        assert!(details_unsaved(&d(later, Some("Tak for samarbejdet")), &saved));
        assert!(details_unsaved(&d(saved.due, Some("Betal venligst")), &saved));
        assert!(details_unsaved(&d(saved.due, None), &saved));
        saved.notes = Some("  ".into());
        assert!(!details_unsaved(&d(saved.due, None), &saved));
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use std::sync::Arc;

    use gpui_kit::{AppContext as _, TestAppContext};

    use super::{FakturaerScreen, invoice_title};
    use crate::backend::{Backend as _, BackendError, InvoiceStatus, MockBackend};
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    #[gpui_kit::test]
    fn liste_filter_og_a11y(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        p.assert_all_labelled(cx);
        p.assert_label(
            cx,
            "Faktura 1040, Gartneriet Nørrebro, 25.031,25 kr., Forfalden",
        );
        assert_eq!(p.a11y(cx).count("ListItem"), 3);
        // Filter "Forfalden" (indeks 4) viser kun én.
        p.click(cx, "faktura-filter-4");
        assert_eq!(p.a11y(cx).count("ListItem"), 1);
        p.assert_no_label(cx, "Faktura 1039");
        // Kladder: ingen endnu → tom tilstand.
        p.click(cx, "faktura-filter-1");
        p.assert_label(cx, "Ingen fakturaer her");
    }

    #[gpui_kit::test]
    fn ny_kladde_ret_og_send(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        p.click(cx, "faktura-ny");
        p.assert_label(cx, "Ny kladde fra ufaktureret tid");
        p.click(cx, "ny-kladde-gruppering-1"); // én linje pr. post
        p.click(cx, "ny-kladde-opret");
        p.assert_label(cx, "Kladde til");
        p.assert_label(cx, "Linje 1, tekst");
        let n_before = p.mock.invoices().unwrap().len();
        p.click(cx, ("linje-fjern", 0usize));
        p.click(cx, "faktura-send");
        // Først bekræftelsen: intet er sendt endnu.
        p.assert_label(cx, "sendes på mail til");
        assert!(
            p.mock
                .invoices()
                .unwrap()
                .iter()
                .all(|i| i.number != Some(1042))
        );
        p.click(cx, "send-bekraeft");
        p.assert_label(cx, "er sendt til");
        let invs = p.mock.invoices().unwrap();
        assert_eq!(invs.len(), n_before);
        let sent = invs
            .iter()
            .find(|i| i.number == Some(1042))
            .expect("nummer 1042");
        assert_eq!(sent.status, InvoiceStatus::Sent);
        assert!(
            sent.lines.iter().all(|l| l.entry_ids.len() == 1),
            "én linje pr. post"
        );
        // Esc går tilbage til listen, hvor den sendte faktura står.
        p.press(cx, "escape");
        p.assert_label(cx, "Faktura 1042");
    }

    /// gendan: titel, forfald og noter rettes og gemmes; kladden udstedes
    /// med fakturaopsætningens præfiks.
    #[gpui_kit::test]
    fn lokal_kladde_titel_forfald_noter_og_praefiks(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_local(true);
        let p = open(cx, mock, Screen::Fakturaer);
        p.click(cx, "faktura-ny");
        p.click(cx, "ny-kladde-opret");
        p.assert_label(cx, "Titel");
        p.assert_label(cx, "Forfald");
        p.assert_label(cx, "Noter");
        p.assert_label(cx, "Slet kladde");
        let screen = p.screen::<FakturaerScreen>(cx, Screen::Fakturaer);
        cx.update_window(p.handle, |_, window, cx| {
            screen.update(cx, |s, cx| {
                let d = &s.editor.as_ref().expect("editor").details;
                d.title
                    .update(cx, |i, cx| i.set_value("Webshop, oktober", window, cx));
                d.due
                    .update(cx, |i, cx| i.set_value("30.11.2026", window, cx));
                d.notes
                    .update(cx, |i, cx| i.set_value("Tak for samarbejdet", window, cx));
            })
        })
        .unwrap();
        p.settle(cx);
        p.click(cx, "faktura-send");
        // Lokalt sendes der ingen mail: bekræftelsen siger det.
        p.assert_label(cx, "Der sendes ingen mail");
        p.click(cx, "send-bekraeft");
        p.assert_label(cx, "er markeret som sendt");
        let inv = p
            .mock
            .invoices()
            .unwrap()
            .into_iter()
            .find(|i| i.title.as_deref() == Some("Webshop, oktober"))
            .expect("titlen er gemt");
        assert_eq!(inv.notes.as_deref(), Some("Tak for samarbejdet"));
        assert_eq!(
            inv.due,
            chrono::NaiveDate::from_ymd_opt(2026, 11, 30).unwrap()
        );
        assert_eq!(inv.number_label().as_deref(), Some("2026-1042"));
        p.assert_label(cx, "Faktura 2026-1042");
    }

    #[gpui_kit::test]
    fn lokal_kladde_slettes_efter_bekraeftelse(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_local(true);
        let p = open(cx, mock, Screen::Fakturaer);
        p.click(cx, "faktura-ny");
        p.click(cx, "ny-kladde-opret");
        let n = p.mock.invoices().unwrap().len();
        p.click(cx, "faktura-slet");
        p.assert_label(cx, "Det kan ikke fortrydes");
        assert_eq!(
            p.mock.invoices().unwrap().len(),
            n,
            "første klik spørger kun"
        );
        p.click(cx, "faktura-slet");
        p.assert_label(cx, "Kladden er slettet");
        assert_eq!(p.mock.invoices().unwrap().len(), n - 1);
    }

    #[gpui_kit::test]
    fn manglende_afsender_vises_og_stopper_udstedelse(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_local(true);
        mock.save_invoice_profile(crate::backend::InvoiceProfile::default())
            .unwrap();
        let p = open(cx, mock, Screen::Fakturaer);
        p.click(cx, "faktura-ny");
        p.click(cx, "ny-kladde-opret");
        p.assert_label(
            cx,
            "Udfyld firmanavn, CVR, adresse og bankkonto eller MobilePay",
        );
        p.click(cx, "faktura-send");
        p.click(cx, "send-bekraeft");
        p.assert_label(cx, "før fakturaen udstedes");
        assert!(
            p.mock
                .invoices()
                .unwrap()
                .iter()
                .all(|i| i.number != Some(1042))
        );
    }

    #[gpui_kit::test]
    fn cloud_har_ingen_titel_men_kladden_kan_slettes(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        p.click(cx, "faktura-ny");
        p.click(cx, "ny-kladde-opret");
        p.assert_label(cx, "Forfald");
        p.assert_label(cx, "Slet kladde");
        p.assert_no_label(cx, "Titel");
    }

    /// Opretter en kladde for første kunde med ufaktureret tid og åbner den.
    fn open_ny_kladde(p: &crate::testing_b::Probe, cx: &mut TestAppContext) {
        p.click(cx, "faktura-ny");
        p.click(cx, "ny-kladde-opret");
        p.assert_label(cx, "Kladde til");
    }

    fn drafts(p: &crate::testing_b::Probe) -> Vec<crate::backend::Invoice> {
        p.mock
            .invoices()
            .unwrap()
            .into_iter()
            .filter(|i| i.status == InvoiceStatus::Draft)
            .collect()
    }

    /// Web's "Send påmindelse" på en sendt eller forfalden faktura, med samme
    /// bekræftelse som afsendelsen (før: blokeret med "allerede sendt").
    #[gpui_kit::test]
    fn paamindelse_kraever_bekraeftelse(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        // Kun udstedte fakturaer kan få en påmindelse.
        for paid in p.mock.invoices().unwrap().iter().filter(|i| i.status == InvoiceStatus::Paid) {
            assert!(p.mock.send_reminder(&paid.id, None).is_err());
        }
        let sent = p
            .mock
            .invoices()
            .unwrap()
            .into_iter()
            .find(|i| matches!(i.status, InvoiceStatus::Sent | InvoiceStatus::Overdue))
            .expect("en sendt faktura i demoen");
        // Kunden skal have en mail, ellers kan intet sendes.
        let c = p.mock.customers(true).unwrap().into_iter().find(|c| c.id == sent.customer_id).unwrap();
        if c.email.is_none() {
            let input = crate::backend::CustomerInput {
                name: c.name.clone(),
                email: Some("bogholderi@example.dk".into()),
                ..Default::default()
            };
            p.mock.update_customer(&c.id, input).unwrap();
        }
        let ix = p.mock.invoices().unwrap().iter().position(|i| i.id == sent.id).unwrap();
        p.click(cx, ("faktura-aabn", ix));
        p.click(cx, "faktura-paamind");
        assert_eq!(p.a11y(cx).count("Dialog"), 1, "påmindelsen åbner bekræftelsen");
        let to = p.mock.invoice_send_preview(&sent.id).unwrap().recipient.expect("kunden har en mail");
        p.assert_label(cx, &format!("Fakturaen sendes igen på mail til {to}"));
        assert_eq!(p.mock.invoice(&sent.id).unwrap().delivery, sent.delivery, "intet sendt endnu");
        // Enter rammer "Annuller".
        p.press(cx, "enter");
        assert_eq!(p.a11y(cx).count("Dialog"), 0);
        p.assert_label(cx, "Påmindelsen er ikke sendt");
        p.click(cx, "faktura-paamind");
        p.click(cx, "send-bekraeft");
        p.assert_label(cx, &format!("Påmindelse om {} er sendt til {to}", invoice_title(&sent)));
        let after = p.mock.invoice(&sent.id).unwrap();
        assert_eq!(after.status, sent.status, "status ændres ikke");
        assert_eq!(after.delivery.expect("afsendelsen").to.as_deref(), Some(to.as_str()));
    }

    /// Sagen fra 17/11: en faktura gik som mail til kunden uden en tydelig
    /// bekræftelse. Oprettelsen giver kun en kladde, og "Send til kunden"
    /// åbner en dialog med modtager og beløb. "Annuller" har fokus, så Enter
    /// ikke sender; kun et bevidst klik på "Send til kunden" gør.
    #[gpui_kit::test]
    fn send_kraever_bekraeftelse_og_enter_sender_ikke(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        let before = p.mock.invoices().unwrap().len();
        open_ny_kladde(&p, cx);
        // Kladde først: ingen afsendelse ved oprettelsen.
        let draft = drafts(&p).pop().expect("kladden");
        assert_eq!(draft.delivery, None);
        assert_eq!(p.mock.invoices().unwrap().len(), before + 1);
        p.assert_label(cx, "Kladde. Ikke sendt endnu");

        // Dialogen: modtager, kunde, nummer, poster, timer og beløb inkl. moms.
        p.click(cx, "faktura-send");
        assert_eq!(p.a11y(cx).count("Dialog"), 1);
        let preview = p.mock.invoice_send_preview(&draft.id).unwrap();
        let to = preview.recipient.clone().expect("kunden har en mail");
        p.assert_label(cx, &format!("Fakturaen sendes på mail til {to}"));
        p.assert_label(cx, &preview.customer_name);
        p.assert_label(cx, &crate::export::kroner(preview.total));
        p.assert_label(cx, "Tildeles ved afsendelse");
        assert_eq!(drafts(&p).len(), 1, "åbning af dialogen sender intet");

        // Enter rammer "Annuller" (har fokus): dialogen lukkes, intet sendt.
        p.press(cx, "enter");
        assert_eq!(p.a11y(cx).count("Dialog"), 0);
        p.assert_label(cx, "Fakturaen er ikke sendt");
        let still = p.mock.invoice(&draft.id).unwrap();
        assert_eq!((still.status, still.delivery), (InvoiceStatus::Draft, None));

        // Esc lukker også uden at sende.
        p.click(cx, "faktura-send");
        assert_eq!(p.a11y(cx).count("Dialog"), 1);
        p.press(cx, "escape");
        assert_eq!(p.a11y(cx).count("Dialog"), 0);
        assert_eq!(
            p.mock.invoice(&draft.id).unwrap().status,
            InvoiceStatus::Draft
        );

        // Det bevidste valg: "Send til kunden". Status og modtager huskes.
        p.click(cx, "faktura-send");
        p.click(cx, "send-bekraeft");
        p.assert_label(cx, &format!("er sendt til {to}"));
        let sent = p.mock.invoice(&draft.id).unwrap();
        assert_eq!(sent.status, InvoiceStatus::Sent);
        assert_eq!(
            sent.delivery.expect("afsendelsen").to.as_deref(),
            Some(to.as_str())
        );
        // Detaljevisningen viser, hvornår og til hvem.
        p.assert_label(cx, &format!("til {to}"));
    }

    /// En kunde uden mailadresse: dialogen siger det, og "Send til kunden"
    /// er slukket. Intet sendes.
    #[gpui_kit::test]
    fn kunde_uden_mail_kan_ikke_faa_fakturaen_sendt(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let ids: Vec<_> = mock
            .uninvoiced_entries("kunde_klinik")
            .unwrap()
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert!(!ids.is_empty(), "demodata: Klinikken har ufaktureret tid");
        let draft = mock.create_invoice_draft("kunde_klinik", &ids).unwrap();
        let p = open(cx, mock, Screen::Fakturaer);
        p.click(cx, "faktura-filter-1"); // Kladder
        p.click(cx, ("faktura-aabn", 0usize));
        p.click(cx, "faktura-send");
        p.assert_label(cx, "Kunden har ingen mailadresse");
        p.click(cx, "send-bekraeft");
        assert_eq!(
            p.mock.invoice(&draft.id).unwrap().status,
            InvoiceStatus::Draft
        );
        p.assert_no_label(cx, "er sendt");
    }

    /// "Markér som sendt (uden mail)": som web's "Send Faktura" på en kladde.
    #[gpui_kit::test]
    fn kladde_kan_udstedes_uden_mail(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        open_ny_kladde(&p, cx);
        let draft = drafts(&p).pop().expect("kladden");
        p.click(cx, "faktura-udsted");
        p.assert_label(cx, "Der sendes ingen mail");
        p.click(cx, "send-bekraeft");
        p.assert_label(cx, "er markeret som sendt");
        let issued = p.mock.invoice(&draft.id).unwrap();
        assert_eq!(issued.status, InvoiceStatus::Sent);
        assert_eq!(issued.delivery.expect("afsendelsen").to, None);
        p.assert_label(cx, "Ingen mail er sendt herfra");
    }

    /// Fortryd: en kladde slettes (også i cloud), og posterne er ufaktureret
    /// igen. Første klik spørger kun.
    #[gpui_kit::test]
    fn kladde_slettes_i_cloud_og_posterne_frigives(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        open_ny_kladde(&p, cx);
        let draft = drafts(&p).pop().expect("kladden");
        assert!(!p.mock.invoice_entries(&draft.id).unwrap().is_empty());
        p.click(cx, "faktura-slet");
        p.assert_label(cx, "Det kan ikke fortrydes");
        assert_eq!(drafts(&p).len(), 1, "første klik spørger kun");
        p.click(cx, "faktura-slet");
        p.assert_label(cx, "Kladden er slettet");
        assert!(drafts(&p).is_empty());
        assert!(p.mock.invoice_entries(&draft.id).unwrap().is_empty());
        assert!(
            !p.mock
                .uninvoiced_entries(&draft.customer_id)
                .unwrap()
                .is_empty()
        );
    }

    /// Status i listen og i detaljen: Kladde / Sendt (dato, tid og modtager) / Betalt.
    #[gpui_kit::test]
    fn status_viser_afsendelse_med_dato_tid_og_modtager(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        // 1039 er sendt herfra (mock): modtager og tidspunkt.
        p.click(cx, ("faktura-aabn", 0usize));
        p.assert_label(cx, "Faktura 1039");
        p.assert_label(cx, "kl. 10:12 til bogholderi@toemrer.example.dk");
        // 1040 er sendt et andet sted: siger det i stedet for at gætte.
        p.click(cx, "faktura-tilbage");
        p.click(cx, ("faktura-aabn", 2usize));
        p.assert_label(cx, "Faktura 1040");
        p.assert_label(cx, "Tidspunkt og modtager kendes ikke her");
    }

    /// Fra en faktura til kalenderen (kun de fakturerede poster) og tilbage
    /// fra en faktureret post til fakturaen.
    #[gpui_kit::test]
    fn link_mellem_faktura_og_poster(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        open_ny_kladde(&p, cx);
        let draft = drafts(&p).pop().expect("kladden");
        let entries = p.mock.invoice_entries(&draft.id).unwrap();
        assert!(!entries.is_empty());
        p.assert_label(cx, &format!("{} poster", entries.len()));
        p.click(cx, "faktura-vis-poster");
        // Kalenderen viser nu kun fakturerede poster på den dag.
        p.assert_label(cx, "Faktureret");
        let cal = p.screen::<crate::screens::kalender::KalenderScreen>(cx, Screen::Kalender);
        let shown = cal.read_with(cx, |k, _| k.shown_ids());
        let first_day = entries.iter().map(|e| e.date).min().unwrap();
        let first = entries
            .iter()
            .find(|e| e.date == first_day)
            .unwrap()
            .id
            .clone();
        assert!(shown.contains(&first), "fakturaens post vises");
        let wide = crate::backend::DateRange {
            from: testing::today() - chrono::Days::new(90),
            to: testing::today() + chrono::Days::new(90),
        };
        let all = p.mock.entries(wide).unwrap();
        assert!(
            shown
                .iter()
                .all(|id| all.iter().any(|e| &e.id == id && e.invoice_id.is_some())),
            "kun fakturerede poster"
        );
        // Tilbage: åbn posten, og følg linket til fakturaen.
        cx.update_window(p.handle, |_, window, cx| {
            cal.update(cx, |k, cx| k.open_edit(&first, window, cx))
        })
        .unwrap();
        p.settle(cx);
        p.click(cx, "post-aabn-faktura");
        p.assert_label(cx, "Kladde til");
    }

    #[gpui_kit::test]
    fn ugyldig_linje_viser_fejl_og_gemmer_ikke(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        p.click(cx, "faktura-ny");
        p.click(cx, "ny-kladde-opret");
        let screen = p.screen::<FakturaerScreen>(cx, Screen::Fakturaer);
        cx.update_window(p.handle, |_, window, cx| {
            screen.update(cx, |s, cx| {
                let ed = s.editor.as_ref().expect("editor");
                ed.rows[0]
                    .rate
                    .update(cx, |i, cx| i.set_value("abc", window, cx));
            })
        })
        .unwrap();
        p.settle(cx);
        p.assert_label(cx, "Linje 1: Ugyldig pris");
        p.click(cx, "faktura-send");
        p.assert_label(cx, "Linje 1: Ugyldig pris");
        assert!(
            p.mock
                .invoices()
                .unwrap()
                .iter()
                .all(|i| i.number != Some(1042)),
            "intet sendt"
        );
    }

    /// Cloud: totalen og momsen er web's, og "Gem som PDF" gemmer præcis web's
    /// PDF. Fejl fra web vises på dansk, og der gemmes ingen PDF uden moms.
    #[gpui_kit::test]
    fn cloud_pdf_og_moms_kommer_fra_web(cx: &mut TestAppContext) {
        let dir = std::env::temp_dir().join(format!("tt-export-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // SAFETY: alle tests, der eksporterer, sætter samme mappe.
        unsafe { std::env::set_var("TT_EXPORT_DIR", &dir) };
        // 1041, ikke 1040: `forfalden_markeres_betalt_og_pdf` gemmer
        // Faktura-1040.pdf i samme mappe samtidig.
        const AABN_1041: usize = 1;
        let mock = testing::mock();
        mock.set_web_invoices(false, None);
        let p = open(cx, mock, Screen::Fakturaer);
        p.click(cx, ("faktura-aabn", AABN_1041));
        p.assert_label(cx, "Faktura 1041 til");
        p.assert_label(cx, "Ingen moms: virksomheden er ikke momsregistreret i web");
        p.assert_label(cx, "I alt 39.000,00 kr.");
        p.click(cx, "faktura-pdf");
        p.assert_label(cx, "PDF gemt");
        let file = dir.join("Faktura-1041.pdf");
        let pdf = std::fs::read(&file).expect("pdf skrevet");
        std::fs::remove_file(&file).ok();
        assert_eq!(pdf, MockBackend::web_pdf("faktura_1041"), "web's bytes, uændret");

        // Momsregistreret i web: web's moms og total.
        p.mock.set_web_invoices(true, None);
        p.click(cx, "faktura-tilbage");
        p.click(cx, ("faktura-aabn", AABN_1041));
        p.assert_label(cx, "Moms 25 % 9.750,00 kr.");
        p.assert_label(cx, "I alt 48.750,00 kr.");

        // Fakturamodulet slået fra (403): dansk fejl, ingen fil.
        let off = "PDF'en kan ikke hentes: fakturaer er slået fra i web, eller din rolle har ikke adgang til dem";
        p.mock.set_web_invoices(true, Some(BackendError::Validation(off.into())));
        p.click(cx, "faktura-pdf");
        p.assert_label(cx, off);
        assert!(!file.exists(), "ingen lokal PDF uden web's moms");
    }

    #[gpui_kit::test]
    fn forfalden_markeres_betalt_og_pdf(cx: &mut TestAppContext) {
        let dir = std::env::temp_dir().join(format!("tt-export-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // SAFETY: alle tests, der eksporterer, sætter samme mappe.
        unsafe { std::env::set_var("TT_EXPORT_DIR", &dir) };
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        p.click(cx, ("faktura-aabn", 2usize));
        p.assert_label(cx, "Faktura 1040 til Gartneriet Nørrebro");
        // Satsen kommer fra fakturaen, ikke fra teksten
        p.assert_label(cx, "moms 25 %");
        p.click(cx, "faktura-pdf");
        p.assert_label(cx, "PDF gemt");
        let pdf = std::fs::read(dir.join("Faktura-1040.pdf")).expect("pdf skrevet");
        std::fs::remove_file(dir.join("Faktura-1040.pdf")).ok();
        assert!(pdf.starts_with(b"%PDF"));
        // Som web: betalingsdatoen kan vælges (i dag som standard).
        p.click(cx, "faktura-betalt");
        p.assert_label(cx, "Betalingsdato");
        assert_ne!(
            p.mock.invoices().unwrap().into_iter().find(|i| i.id == "faktura_1040").unwrap().status,
            InvoiceStatus::Paid,
            "første tryk spørger om datoen"
        );
        p.click(cx, "faktura-betalt-gem");
        p.assert_label(cx, "markeret som betalt");
        let inv = p
            .mock
            .invoices()
            .unwrap()
            .into_iter()
            .find(|i| i.id == "faktura_1040")
            .unwrap();
        assert_eq!(inv.status, InvoiceStatus::Paid);
    }

    #[gpui_kit::test]
    fn fejl_og_tom_tilstand(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_failure(Some(BackendError::Offline));
        let p = open(cx, mock.clone(), Screen::Fakturaer);
        p.assert_label(cx, "Fejl: Du er offline");
        mock.set_failure(None);
        p.click(cx, "fakturaer-igen");
        p.assert_label(cx, "Faktura 1040");

        let p = open(
            cx,
            Arc::new(MockBackend::empty(testing::today())),
            Screen::Fakturaer,
        );
        p.assert_label(cx, "Ingen fakturaer endnu");
        p.click(cx, "faktura-ny");
        p.assert_label(cx, "Ingen ufaktureret tid");
    }
}
