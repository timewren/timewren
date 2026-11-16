//! Fakturalinjer, beløb, moms og fakturanumre.
//!
//! Web:
//! - beløb: `roundMoney`/`sumMoney` i `src/lib/format.ts:143-161`; linjebeløb
//!   `(antal × pris).toFixed(2)` i `src/components/invoices/InvoiceLineEditor.tsx:66-70`;
//!   faktura fra tid `hours × billableRate` i `src/lib/trpc/routers/invoices.ts:1168-1193`
//! - moms på fakturaen: `src/components/pdf/InvoicePDF.tsx:134-145` (25 % som
//!   standard, kun når virksomheden er momsregistreret)
//! - forhåndsvisning: `src/lib/invoicing/invoice-preview.ts`
//! - ufaktureret tid: `isUnbilledEntry`/`unbilledEntryValue` i `src/lib/invoicing/unbilled.ts:184-239`
//! - numre: `computeNextInvoiceNumber` (`invoices.ts:54-95`) og `src/lib/invoices/draft-number.ts`
//! - momsoverblik: `src/lib/vat/compute.ts`
//!
//! Web regner kroner som `f64` og runder først ved visning/lagring. Det gør
//! funktionerne her også, så tallene bliver de samme; `*_ore`-felterne giver
//! de afrundede beløb i hele øre til lagring og visning.

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::js;

/// Standardmoms i procent (`invoice_templates.vat_rate` default "25.00").
pub const DEFAULT_VAT_RATE_PERCENT: f64 = 25.0;

// ---------------------------------------------------------------------------
// Beløb
// ---------------------------------------------------------------------------

/// Rund et kronebeløb til nærmeste øre (`roundMoney`: `Math.round(x*100)/100`).
pub fn round_money(amount: f64) -> f64 {
    js::round(amount * 100.0) / 100.0
}

/// Kronebeløb → hele øre, afrundet som `toFixed(2)` (den eksakte værdi,
/// midtpunkt væk fra nul) — sådan GEMMER web beløb (`amount.toFixed(2)`).
pub fn kroner_to_ore(amount: f64) -> i64 {
    js::to_hundredths(amount)
}

/// Kronebeløb → hele øre, afrundet som web VISER det (`toLocaleString("da-DK")`
/// med 2 decimaler, den korteste decimalform). Kan afvige 1 øre fra
/// [`kroner_to_ore`] på et midtpunkt: 1,005 vises som 1,01 men gemmes som 1,00.
pub fn kroner_to_ore_display(amount: f64) -> i64 {
    js::to_hundredths_intl(amount)
}

/// Øre → "1234.50" som web's decimalkolonner.
pub fn ore_to_decimal_string(ore: i64) -> String {
    let sign = if ore < 0 { "-" } else { "" };
    let abs = ore.unsigned_abs();
    format!("{sign}{}.{:02}", abs / 100, abs % 100)
}

/// Et beløb i en liste, som web tager det: tal, decimalstreng eller tomt.
#[derive(Debug, Clone, PartialEq)]
pub enum MoneyInput<'a> {
    Number(f64),
    Text(&'a str),
    Empty,
}

/// Summen af beløb, afrundet til øre (`sumMoney`). Tomme og ulæselige
/// værdier springes over.
pub fn sum_money(amounts: &[MoneyInput<'_>]) -> f64 {
    let mut total = 0.0;
    for a in amounts {
        let n = match a {
            MoneyInput::Empty | MoneyInput::Text("") => continue,
            MoneyInput::Text(s) => js::parse_float(s),
            MoneyInput::Number(n) => *n,
        };
        if !n.is_nan() {
            total += n;
        }
    }
    round_money(total)
}

/// En fakturalinjes beløb som web's linjeeditor: `(antal × pris).toFixed(2)`,
/// hvor ulæselige felter tæller som 0.
pub fn line_amount(quantity: &str, unit_price: &str) -> String {
    let or_zero = |v: f64| if v.is_nan() || v == 0.0 { 0.0 } else { v };
    let qty = or_zero(js::parse_float(quantity));
    let price = or_zero(js::parse_float(unit_price));
    js::to_fixed(qty * price, 2)
}

/// En registrerings værdi: timer × sats, 0 når satsen mangler eller et tal
/// ikke kan læses (`unbilledEntryValue`; samme regnestykke som fakturalinjen
/// fra tid).
pub fn entry_value(hours: Option<f64>, rate: Option<f64>) -> f64 {
    let hours = hours.unwrap_or(0.0);
    let rate = rate.unwrap_or(0.0);
    if !hours.is_finite() || !rate.is_finite() {
        return 0.0;
    }
    hours * rate
}

/// Fakturaens totaler.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceTotals {
    /// Momssats i procent (fra skabelonen).
    pub vat_rate_percent: f64,
    /// Moms vises og lægges til (virksomheden er momsregistreret).
    pub show_vat: bool,
    pub subtotal: f64,
    pub vat: f64,
    pub total: f64,
    pub subtotal_ore: i64,
    pub vat_ore: i64,
    pub total_ore: i64,
}

/// Totaler som på web's faktura-PDF: subtotal = summen af linjebeløbene,
/// moms = subtotal × sats/100 (0 uden momsregistrering), total = subtotal +
/// moms. Hver afrundes for sig til øre ved visning, præcis som PDF'en
/// (`toLocaleString`), så `*_ore` er de tal, kunden ser.
///
/// `vat_rate` er skabelonens decimalstreng; `None`/"" giver 25 %.
pub fn invoice_totals(
    line_amounts: &[&str],
    vat_rate: Option<&str>,
    vat_registered: bool,
) -> InvoiceTotals {
    let subtotal = line_amounts
        .iter()
        .fold(0.0, |sum, a| sum + js::parse_float(a));
    totals_from_subtotal(subtotal, vat_rate, vat_registered)
}

/// [`invoice_totals`] for en faktura uden linjer, kun med `invoices.amount`.
pub fn totals_from_subtotal(
    subtotal: f64,
    vat_rate: Option<&str>,
    vat_registered: bool,
) -> InvoiceTotals {
    let vat_rate_percent = js::parse_float(vat_rate.filter(|s| !s.is_empty()).unwrap_or("25.00"));
    let vat = if vat_registered {
        subtotal * (vat_rate_percent / 100.0)
    } else {
        0.0
    };
    let total = subtotal + vat;
    InvoiceTotals {
        vat_rate_percent,
        show_vat: vat_registered,
        subtotal,
        vat,
        total,
        subtotal_ore: kroner_to_ore_display(subtotal),
        vat_ore: kroner_to_ore_display(vat),
        total_ore: kroner_to_ore_display(total),
    }
}

// ---------------------------------------------------------------------------
// Ufaktureret tid (unbilled.ts)
// ---------------------------------------------------------------------------

/// Godkendelsesstatusser, der gør tid umulig at fakturere.
pub const UNINVOICEABLE_APPROVAL_STATUSES: [&str; 2] = ["pending", "rejected"];

/// Felterne, der afgør om en registrering er ufaktureret.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UnbilledEntryLike {
    pub is_billed: Option<bool>,
    pub is_billable: Option<bool>,
    pub is_prepaid: Option<bool>,
    /// Den RESOLVEREDE kundes `defaultBillable`; `None` = ingen kunde.
    pub client_default_billable: Option<bool>,
    pub approval_status: Option<String>,
}

/// "Ikke faktureret, fakturerbar, ikke klippekort, godkendt, på en ekstern
/// kunde" (`isUnbilledEntry`). `None` tæller MED for de fire flag, men UDE
/// for kunden.
pub fn is_unbilled_entry(entry: &UnbilledEntryLike, include_prepaid: bool) -> bool {
    if entry.is_billed == Some(true) || entry.is_billable == Some(false) {
        return false;
    }
    if !include_prepaid && entry.is_prepaid == Some(true) {
        return false;
    }
    if entry
        .approval_status
        .as_deref()
        .is_some_and(|s| UNINVOICEABLE_APPROVAL_STATUSES.contains(&s))
    {
        return false;
    }
    entry.client_default_billable == Some(true)
}

// ---------------------------------------------------------------------------
// Forhåndsvisning af en kladde fra ufaktureret tid (invoice-preview.ts)
// ---------------------------------------------------------------------------

/// Etiketten for poster uden projekt.
pub const DIRECT_TIME_LABEL: &str = "Direkte tid";

/// En registrering til forhåndsvisningen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEntry {
    pub id: String,
    /// Timer; `None`/ulæseligt tæller som 0.
    pub hours: Option<f64>,
    /// Sats; `None`/ulæseligt tæller som 0.
    pub billable_rate: Option<f64>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    /// Dansk dato "yyyy-MM-dd".
    pub date: String,
}

/// En projektgruppe i forhåndsvisningen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGroup {
    /// Projekt-id eller "direct".
    pub key: String,
    pub label: String,
    pub entry_count: usize,
    pub hours: f64,
    pub amount: f64,
    /// Timer uden sats (giver 0 kr på fakturaen).
    pub hours_without_rate: f64,
}

/// Forhåndsvisningen af en fakturakladde.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoicePreview {
    pub entry_ids: Vec<String>,
    pub entry_count: usize,
    pub total_hours: f64,
    pub total_amount: f64,
    pub hours_without_rate: f64,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    pub groups: Vec<PreviewGroup>,
}

fn finite_or_zero(v: Option<f64>) -> f64 {
    v.filter(|x| x.is_finite()).unwrap_or(0.0)
}

/// Gruppér posterne pr. projekt (uden projekt i "Direkte tid"); beløb =
/// timer × sats; grupper sorteret efter beløb, så timer (`buildInvoicePreview`).
pub fn build_invoice_preview(entries: &[PreviewEntry]) -> InvoicePreview {
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, PreviewGroup> = HashMap::new();
    let (mut total_hours, mut total_amount, mut without_rate) = (0.0, 0.0, 0.0);
    let mut first: Option<String> = None;
    let mut last: Option<String> = None;

    for entry in entries {
        let hours = finite_or_zero(entry.hours);
        let rate = finite_or_zero(entry.billable_rate);
        let amount = hours * rate;
        let key = entry.project_id.clone().unwrap_or_else(|| "direct".into());
        let group = groups.entry(key.clone()).or_insert_with(|| {
            order.push(key.clone());
            PreviewGroup {
                key: key.clone(),
                label: match &entry.project_id {
                    Some(_) => entry
                        .project_name
                        .clone()
                        .unwrap_or_else(|| "Projekt".into()),
                    None => DIRECT_TIME_LABEL.into(),
                },
                entry_count: 0,
                hours: 0.0,
                amount: 0.0,
                hours_without_rate: 0.0,
            }
        });
        group.entry_count += 1;
        group.hours += hours;
        group.amount += amount;
        if rate <= 0.0 {
            group.hours_without_rate += hours;
            without_rate += hours;
        }
        total_hours += hours;
        total_amount += amount;
        if first.as_ref().is_none_or(|f| entry.date < *f) {
            first = Some(entry.date.clone());
        }
        if last.as_ref().is_none_or(|l| entry.date > *l) {
            last = Some(entry.date.clone());
        }
    }

    let mut out: Vec<PreviewGroup> = order
        .into_iter()
        .filter_map(|k| groups.remove(&k))
        .map(|g| PreviewGroup {
            hours: round_money(g.hours),
            amount: round_money(g.amount),
            hours_without_rate: round_money(g.hours_without_rate),
            ..g
        })
        .collect();
    out.sort_by(|a, b| {
        b.amount
            .partial_cmp(&a.amount)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                b.hours
                    .partial_cmp(&a.hours)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });

    InvoicePreview {
        entry_ids: entries.iter().map(|e| e.id.clone()).collect(),
        entry_count: entries.len(),
        total_hours: round_money(total_hours),
        total_amount: round_money(total_amount),
        hours_without_rate: round_money(without_rate),
        first_date: first,
        last_date: last,
        groups: out,
    }
}

/// Periodevalget i "Fakturér nu".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreviewPeriod {
    All,
    ThisMonth,
    LastMonth,
}

/// Periodens grænser som danske datoer, begge inklusive; `(None, None)` for
/// "all" (`previewPeriodRange`). `today` er dagens danske dato.
pub fn preview_period_range(
    period: PreviewPeriod,
    today: NaiveDate,
) -> (Option<NaiveDate>, Option<NaiveDate>) {
    match period {
        PreviewPeriod::All => (None, None),
        PreviewPeriod::ThisMonth => (Some(crate::tid::month_start(today)), Some(today)),
        PreviewPeriod::LastMonth => {
            let this_month = crate::tid::month_start(today);
            let end = crate::tid::add_days(this_month, -1);
            (Some(crate::tid::month_start(end)), Some(end))
        }
    }
}

// ---------------------------------------------------------------------------
// Fakturanumre
// ---------------------------------------------------------------------------

/// Kladder bærer et placeholder-nummer med dette præfiks; det rigtige nummer
/// tildeles først ved udstedelse, så serien forbliver ubrudt (#196).
pub const DRAFT_NUMBER_PREFIX: &str = "UDKAST-";

/// Er nummeret en kladdes placeholder? (versal-ufølsomt, `isDraftInvoiceNumber`)
pub fn is_draft_invoice_number(number: Option<&str>) -> bool {
    number.is_some_and(|n| n.to_uppercase().starts_with(DRAFT_NUMBER_PREFIX))
}

/// UI-visning: kladder og manglende numre vises som "Kladde".
pub fn format_invoice_number(number: Option<&str>) -> String {
    match number {
        Some(n) if !n.is_empty() && !is_draft_invoice_number(Some(n)) => n.to_string(),
        _ => "Kladde".into(),
    }
}

fn to_base36(mut n: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Placeholder-nummer til en kladde (`draftInvoiceNumber`): præfiks +
/// millisekunder, en løbende tæller og et tilfældigt tal, alle i base 36.
/// Tid, tæller og tilfældighed gives udefra, så funktionen forbliver ren.
pub fn draft_invoice_number(now_ms: u64, seq: u32, random: u32) -> String {
    let two = |n: u32| format!("{:0>2}", to_base36(u64::from(n % 1296)));
    format!(
        "{DRAFT_NUMBER_PREFIX}{}{}{}",
        to_base36(now_ms),
        two(seq),
        two(random)
    )
    .to_uppercase()
}

/// Det afsluttende heltal i et nummer ("INV-042" → 42, "2025-117" → 117),
/// som web's `SUBSTRING(invoice_number FROM '(\d+)$')`.
pub fn trailing_number(number: &str) -> Option<u64> {
    let digits: String = number
        .chars()
        .rev()
        .take_while(char::is_ascii_digit)
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits
        .chars()
        .rev()
        .collect::<String>()
        .parse()
        .ok()
        .or(Some(u64::MAX))
}

/// Næste fortløbende fakturanummer (`computeNextInvoiceNumber`): største
/// afsluttende heltal blandt de udstedte numre i samme organisation (eller
/// hos brugeren) + 1, som "INV-" og mindst tre cifre. Kladdernes
/// "UDKAST-"-numre tæller ikke (versalfølsomt, som SQL'ens `NOT LIKE`).
pub fn next_invoice_number<'a>(existing: impl IntoIterator<Item = &'a str>) -> String {
    let max = existing
        .into_iter()
        .filter(|n| !n.starts_with(DRAFT_NUMBER_PREFIX))
        .filter_map(trailing_number)
        .max()
        .unwrap_or(0);
    format!("INV-{:03}", max.saturating_add(1))
}

// ---------------------------------------------------------------------------
// Momsoverblik (vat/compute.ts)
// ---------------------------------------------------------------------------

/// Moms som andel (25 %), brugt i momsoverblikket.
pub const VAT_RATE: f64 = 0.25;

/// Momsperiode (`users.vatPeriod`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VatPeriodKind {
    Monthly,
    Quarterly,
    SemiAnnual,
}

/// En momsperiode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VatPeriod {
    pub kind: VatPeriodKind,
    /// "April 2026", "Q2 2026", "H1 2026"
    pub label: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub year: i32,
    /// 1-12, 1-4 eller 1-2
    pub ordinal: u32,
}

const DANISH_MONTHS: [&str; 12] = [
    "januar",
    "februar",
    "marts",
    "april",
    "maj",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "december",
];

fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).expect("gyldig dato")
}

fn last_day_of_month(y: i32, m: u32) -> NaiveDate {
    crate::tid::add_days(crate::tid::add_months(ymd(y, m, 1), 1), -1)
}

/// "20. juli 2026"
pub fn format_danish_date(date: NaiveDate) -> String {
    format!(
        "{}. {} {}",
        date.day(),
        DANISH_MONTHS[date.month0() as usize],
        date.year()
    )
}

/// Perioden, som datoen ligger i.
pub fn vat_period_for_date(date: NaiveDate, kind: VatPeriodKind) -> VatPeriod {
    let year = date.year();
    let month = date.month();
    match kind {
        VatPeriodKind::Monthly => {
            let name = DANISH_MONTHS[month as usize - 1];
            let mut label: String = name[..1].to_uppercase();
            label.push_str(&name[1..]);
            VatPeriod {
                kind,
                label: format!("{label} {year}"),
                from: ymd(year, month, 1),
                to: last_day_of_month(year, month),
                year,
                ordinal: month,
            }
        }
        VatPeriodKind::Quarterly => {
            let q = (month - 1) / 3 + 1;
            VatPeriod {
                kind,
                label: format!("Q{q} {year}"),
                from: ymd(year, (q - 1) * 3 + 1, 1),
                to: last_day_of_month(year, q * 3),
                year,
                ordinal: q,
            }
        }
        VatPeriodKind::SemiAnnual => {
            let half = if month <= 6 { 1 } else { 2 };
            VatPeriod {
                kind,
                label: format!("H{half} {year}"),
                from: ymd(year, if half == 1 { 1 } else { 7 }, 1),
                to: if half == 1 {
                    ymd(year, 6, 30)
                } else {
                    ymd(year, 12, 31)
                },
                year,
                ordinal: half,
            }
        }
    }
}

/// Fristen for perioden: måned → den 25. i måneden efter; kvartal → den 20.
/// to måneder efter kvartalets slutning (Q4 → 20. januar); halvår → 1.
/// september / 1. marts året efter (`getNextDeadlineForPeriod`).
pub fn vat_deadline(period: &VatPeriod) -> NaiveDate {
    match period.kind {
        VatPeriodKind::Monthly => {
            if period.ordinal == 12 {
                ymd(period.year + 1, 1, 25)
            } else {
                ymd(period.year, period.ordinal + 1, 25)
            }
        }
        VatPeriodKind::Quarterly => {
            if period.ordinal == 4 {
                ymd(period.year + 1, 1, 20)
            } else {
                ymd(period.year, period.ordinal * 3 + 1, 20)
            }
        }
        VatPeriodKind::SemiAnnual => {
            if period.ordinal == 1 {
                ymd(period.year, 9, 1)
            } else {
                ymd(period.year + 1, 3, 1)
            }
        }
    }
}

/// Dage fra i dag til fristen (0 samme dag, negativ når den er passeret).
pub fn days_until_deadline(today: NaiveDate, deadline: NaiveDate) -> i64 {
    (deadline - today).num_days()
}

/// En udstedt faktura i overblikket.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VatInvoice {
    /// Fakturadatoen (dansk dato).
    pub issue_date: NaiveDate,
    /// Beløb ekskl. moms.
    pub amount_ex_vat: f64,
}

/// Den aktuelle periodes tal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VatCurrentPeriod {
    pub label: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub invoiced_ex_vat: f64,
    pub vat: f64,
}

/// Næste frist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VatDeadline {
    /// "20. juli 2026"
    pub label: String,
    pub days_until: i64,
    pub period_label: String,
}

/// Momsoverblikket (`computeVatOverview`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VatOverview {
    pub period_kind: VatPeriodKind,
    pub ytd_invoiced_ex_vat: f64,
    pub ytd_vat: f64,
    pub current_period: VatCurrentPeriod,
    pub next_deadline: VatDeadline,
    /// Beløbet at lægge til side = periodens moms.
    pub recommended_savings: f64,
}

/// Årets og periodens fakturerede beløb og moms (afrundet til øre) samt næste
/// frist. Uden periode: kvartalsvis.
pub fn compute_vat_overview(
    invoices: &[VatInvoice],
    today: NaiveDate,
    kind: Option<VatPeriodKind>,
) -> VatOverview {
    let kind = kind.unwrap_or(VatPeriodKind::Quarterly);
    let year = today.year();
    let current = vat_period_for_date(today, kind);
    let deadline = vat_deadline(&current);

    let (mut ytd, mut period) = (0.0, 0.0);
    for inv in invoices {
        if inv.issue_date.year() == year {
            ytd += inv.amount_ex_vat;
        }
        if inv.issue_date >= current.from && inv.issue_date <= current.to {
            period += inv.amount_ex_vat;
        }
    }
    let period_vat = round_money(period * VAT_RATE);

    VatOverview {
        period_kind: kind,
        ytd_invoiced_ex_vat: round_money(ytd),
        ytd_vat: round_money(ytd * VAT_RATE),
        current_period: VatCurrentPeriod {
            label: current.label.clone(),
            from: current.from,
            to: current.to,
            invoiced_ex_vat: round_money(period),
            vat: period_vat,
        },
        next_deadline: VatDeadline {
            label: format_danish_date(deadline),
            days_until: days_until_deadline(today, deadline),
            period_label: current.label,
        },
        recommended_savings: period_vat,
    }
}
