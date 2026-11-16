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

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{
    Customer, Entry, Id, Invoice, InvoiceDetails, InvoiceLine, InvoiceProfile, InvoiceStatus, Mode,
    Project,
};
use crate::brand::{Brand, brand};
use crate::export;
use crate::i18n::{t, tf};
use crate::ui::{self, Loadable, Tone, format};

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

/// Fakturaens titel i listen: "Faktura 1042" eller "Kladde".
pub fn invoice_title(inv: &Invoice) -> String {
    match inv.number_label() {
        Some(n) => tf("fakturaer.title.invoice", &[("number", &n)]),
        None => t("fakturaer.title.draft").into(),
    }
}

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
            focus: cx.focus_handle(),
            _subs: subs,
        };
        this.reload(cx);
        this.demo_view(cx);
        this
    }

    /// `TT_FAKTURA_VIEW` til skærmbilleder: "ny", "kladde" (opretter en
    /// kladde og åbner den) eller et faktura-id.
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
        self.view = View::Detail(id);
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
        Editor { rows, details, _subs: subs }
    }

    /// Titel, forfald og noter fra felterne. Titlen kun i lokal tilstand.
    fn edited_details(&self, cx: &App) -> Result<Option<InvoiceDetails>, String> {
        let Some(ed) = &self.editor else { return Ok(None) };
        let today = self.ctx.backend.today();
        let due = ui::forms::parse_date(&ui::forms::value(&ed.details.due, cx), today)
            .ok_or_else(|| t("gendan.fakturaer.err_due").to_string())?;
        let opt = |s: String| (!s.is_empty()).then_some(s);
        let local = matches!(self.ctx.backend.mode(), Mode::Local);
        Ok(Some(InvoiceDetails {
            title: if local { opt(ui::forms::value(&ed.details.title, cx)) } else { None },
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

    fn save_lines(&mut self, id: Id, then_send: bool, cx: &mut Context<Self>) {
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
                if then_send {
                    b.send_invoice(&inv.id)
                } else {
                    Ok(inv)
                }
            },
            move |this, res, cx| {
                this.busy = false;
                this.notice = Some(match res {
                    Ok(inv) if then_send => {
                        this.editor = None;
                        (
                            tf("fakturaer.notice.sent", &[("title", &invoice_title(&inv))]).into(),
                            false,
                        )
                    }
                    Ok(_) => (t("fakturaer.notice.lines_saved").into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
                cx.notify();
            },
        );
    }

    fn mark_paid(&mut self, id: Id, cx: &mut Context<Self>) {
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| b.mark_invoice_paid(&id),
            |this, res, _| {
                this.busy = false;
                this.notice = Some(match res {
                    Ok(()) => (t("fakturaer.notice.paid").into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    fn save_pdf(&mut self, inv: Invoice, cx: &mut Context<Self>) {
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
                let sender = b.invoice_profile()?;
                let bytes = export::invoice_pdf(&inv, &buyer, sender.as_ref());
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
                                        .child(div().flex_1().min_w_0().truncate().child(customer))
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
                title: details.as_ref().map_or(inv.title.clone(), |d| d.title.clone()),
                due: details.as_ref().map_or(inv.due, |d| d.due),
                notes: details.as_ref().map_or(inv.notes.clone(), |d| d.notes.clone()),
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
        let totals = match &calc {
            Some(c) => v_flex()
                .gap_1()
                .items_end()
                .child(
                    ui::text(
                        "faktura-subtotal",
                        tf(
                            "fakturaer.totals.subtotal",
                            &[("amount", &export::kroner(c.subtotal()))],
                        ),
                    )
                    .text_sm(),
                )
                .child(
                    ui::text(
                        "faktura-moms",
                        tf(
                            "fakturaer.totals.vat",
                            &[
                                ("percent", &export::vat_percent(c.vat_permille).to_string()),
                                ("amount", &export::kroner(c.vat())),
                            ],
                        ),
                    )
                    .text_sm()
                    .text_color(b.grey),
                )
                .child(
                    ui::text(
                        "faktura-total",
                        tf(
                            "fakturaer.totals.total",
                            &[("amount", &export::kroner(c.total()))],
                        ),
                    )
                    .text_lg()
                    .font_weight(FontWeight::BOLD),
                ),
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
            let (i1, i2) = (id.clone(), id.clone());
            actions =
                actions
                    .child(
                        Button::new("faktura-gem")
                            .label(t("fakturaer.action.save_lines"))
                            .disabled(self.busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.save_lines(i1.clone(), false, cx)
                            })),
                    )
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
                                this.save_lines(i2.clone(), true, cx)
                            })),
                    );
        }
        if matches!(inv.status, InvoiceStatus::Sent | InvoiceStatus::Overdue) {
            let i = id.clone();
            actions = actions.child(
                Button::new("faktura-betalt")
                    .label(t("fakturaer.action.mark_paid"))
                    .primary()
                    .disabled(self.busy)
                    .on_click(cx.listener(move |this, _, _, cx| this.mark_paid(i.clone(), cx))),
            );
        }
        let pdf_inv = match &calc {
            Some(c) => c.clone(),
            None => inv.clone(),
        };
        // gendan: slet kladde (lokal), med bekræftelse.
        if inv.status == InvoiceStatus::Draft && !is_cloud {
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
                .on_click(cx.listener(move |this, _, _, cx| this.save_pdf(pdf_inv.clone(), cx))),
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
                        tf(
                            "fakturaer.detail.dates",
                            &[
                                ("issued", &format::date_medium(inv.issued, today_year)),
                                ("due", &format::date_medium(inv.due, today_year)),
                                ("vat", &export::vat_percent(inv.vat_permille)),
                            ],
                        ),
                    ))
                    .children(self.render_sender_warning(b, inv))
                    .child(self.render_details(b, inv, is_cloud))
                    .child(lines)
                    .child(totals)
                    .children(self.confirm_delete.then(|| {
                        ui::el("faktura-slet-advarsel", Role::Alert, t("gendan.fakturaer.delete_warning"))
                            .text_sm()
                            .text_color(b.danger)
                            .child(t("gendan.fakturaer.delete_warning"))
                    }))
                    .child(actions),
            )
            .into_any_element()
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
            top = top.child(
                div().w(px(160.)).child(ui::forms::text_field(
                    b,
                    "faktura-felt-forfald",
                    t("gendan.fakturaer.due"),
                    &d.due,
                    None,
                )),
            );
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
            .children(inv.title.clone().map(|tl| {
                ui::text("faktura-vis-titel", tl).font_weight(FontWeight::MEDIUM)
            }))
            .children(inv.notes.clone().map(|n| {
                ui::muted(b, "faktura-vis-noter", tf("gendan.fakturaer.notes_shown", &[("notes", &n)]))
                    .text_sm()
            }))
            .into_any_element()
    }
}

impl Render for FakturaerScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(id) = self.pending_open_id.clone()
            && self.invoice(&id).is_some()
        {
            self.pending_open_id = None;
            self.open(id, window, cx);
        }
        let b = brand(cx);
        let page = ui::page(
            &b,
            "fakturaer",
            t("fakturaer.page.title"),
            Some(t("fakturaer.page.subtitle").into()),
        )
        .track_focus(&self.focus)
        .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _, cx| {
            if ev.keystroke.key == "escape" && !matches!(this.view, View::List) {
                this.show_list(cx);
                cx.stop_propagation();
            }
        }));
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
        page.children(notice).child(body)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        Filter, InvoiceStatus, hours_input, in_period, kroner_input, parse_kroner, parse_quantity,
        per_entry_lines,
    };
    use crate::backend::{Entry, InvoiceLine};
    use chrono::NaiveDate;

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
            },
            InvoiceLine {
                description: "Diverse".into(),
                minutes: 30,
                rate: 85_000,
                entry_ids: vec!["e3".into()],
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
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use std::sync::Arc;

    use gpui_kit::{AppContext as _, TestAppContext};

    use super::FakturaerScreen;
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
        p.assert_label(cx, "er sendt");
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
                d.title.update(cx, |i, cx| i.set_value("Webshop, oktober", window, cx));
                d.due.update(cx, |i, cx| i.set_value("30.11.2026", window, cx));
                d.notes.update(cx, |i, cx| i.set_value("Tak for samarbejdet", window, cx));
            })
        })
        .unwrap();
        p.settle(cx);
        p.click(cx, "faktura-send");
        p.assert_label(cx, "er sendt");
        let inv = p
            .mock
            .invoices()
            .unwrap()
            .into_iter()
            .find(|i| i.title.as_deref() == Some("Webshop, oktober"))
            .expect("titlen er gemt");
        assert_eq!(inv.notes.as_deref(), Some("Tak for samarbejdet"));
        assert_eq!(inv.due, chrono::NaiveDate::from_ymd_opt(2026, 11, 30).unwrap());
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
        assert_eq!(p.mock.invoices().unwrap().len(), n, "første klik spørger kun");
        p.click(cx, "faktura-slet");
        p.assert_label(cx, "Kladden er slettet");
        assert_eq!(p.mock.invoices().unwrap().len(), n - 1);
    }

    #[gpui_kit::test]
    fn manglende_afsender_vises_og_stopper_udstedelse(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_local(true);
        mock.save_invoice_profile(crate::backend::InvoiceProfile::default()).unwrap();
        let p = open(cx, mock, Screen::Fakturaer);
        p.click(cx, "faktura-ny");
        p.click(cx, "ny-kladde-opret");
        p.assert_label(cx, "Udfyld firmanavn, CVR, adresse og bankkonto eller MobilePay");
        p.click(cx, "faktura-send");
        p.assert_label(cx, "før fakturaen udstedes");
        assert!(p.mock.invoices().unwrap().iter().all(|i| i.number != Some(1042)));
    }

    #[gpui_kit::test]
    fn cloud_har_ingen_titel_og_ingen_slet(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Fakturaer);
        p.click(cx, "faktura-ny");
        p.click(cx, "ny-kladde-opret");
        p.assert_label(cx, "Forfald");
        p.assert_no_label(cx, "Slet kladde");
        p.assert_no_label(cx, "Titel");
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
        p.click(cx, "faktura-betalt");
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
