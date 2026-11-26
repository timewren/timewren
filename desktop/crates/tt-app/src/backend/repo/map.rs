//! Ren mapping mellem `tt-data`'s typer (kroner som `Decimal`, timer, UTC)
//! og `Backend`'s typer (øre, minutter, lokal tid). Ingen IO, så alt kan
//! testes uden database.

use chrono::{DateTime, Duration, Local, NaiveDate, NaiveTime, TimeZone, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};
use tt_data as td;

use crate::backend::{
    BackendError, Customer, CustomerInput, Entry, EntryInput, Invoice, InvoiceLine, InvoiceStatus,
    Project, ProjectInput, ProjectStatus, PunchCard, PunchCardInput, PunchUsage, Report, ReportGrouping, StoredLine,
    LaneCategory, ReportRow, Task, TaskInput, TaskLane, TaskPriority, TaskStatus, TimerState, TimerStatus,
    WebInvoiceTotals,
};

/// Moms i promille (25 %) på lokale fakturaer. Samme som
/// `tt_core::faktura::DEFAULT_VAT_RATE_PERCENT`. I cloud afgør web momsen.
pub const VAT_PERMILLE: u32 = 250;

// ---------------------------------------------------------------- beløb og tid

/// Kroner (`Decimal`) → hele øre. Rundes til nærmeste øre, midtpunkt væk fra
/// nul (1,005 → 101 og -1,005 → -101), som `toFixed(2)` på den eksakte
/// decimalværdi. Web gemmer beløb med to decimaler, så i praksis er der
/// aldrig et midtpunkt; kanten er kun til for fremmede data.
pub fn kroner_to_ore(kroner: Decimal) -> i64 {
    let scaled = kroner
        .checked_mul(Decimal::ONE_HUNDRED)
        .unwrap_or(if kroner.is_sign_negative() {
            Decimal::MIN
        } else {
            Decimal::MAX
        });
    scaled
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
        .to_i64()
        .unwrap_or(if kroner.is_sign_negative() {
            i64::MIN
        } else {
            i64::MAX
        })
}

/// Øre → kroner med to decimaler.
pub fn ore_to_kroner(ore: i64) -> Decimal {
    Decimal::new(ore, 2)
}

/// Timer → hele minutter (afrundet, aldrig negativ).
pub fn hours_to_minutes(hours: Decimal) -> u32 {
    (hours * Decimal::from(60))
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
        .to_u32()
        .unwrap_or(0)
}

/// Minutter → timer med to decimaler (som web gemmer dem). Fejlen er højst
/// 0,3 minut, så `hours_to_minutes(minutes_to_hours(m)) == m` for alle m.
pub fn minutes_to_hours(minutes: u32) -> Decimal {
    (Decimal::from(minutes) / Decimal::from(60)).round_dp(2)
}

/// Til klippekort og budget: fire decimaler, så store minuttal ikke driver.
pub fn minutes_to_hours_precise(minutes: u32) -> Decimal {
    (Decimal::from(minutes) / Decimal::from(60)).round_dp(4)
}

pub fn local_time(dt: DateTime<Utc>) -> NaiveTime {
    dt.with_timezone(&Local).time()
}

pub fn local_date(dt: DateTime<Utc>) -> NaiveDate {
    dt.with_timezone(&Local).date_naive()
}

/// Lokal dato + tid → UTC. Et tidspunkt i sommertidens hul rykkes en time frem.
pub fn local_to_utc(date: NaiveDate, time: NaiveTime) -> DateTime<Utc> {
    let naive = date.and_time(time);
    match Local.from_local_datetime(&naive).earliest() {
        Some(dt) => dt.with_timezone(&Utc),
        None => Local
            .from_local_datetime(&(naive + Duration::hours(1)))
            .earliest()
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|| naive.and_utc()),
    }
}

/// En kalenderdag gemt som middag UTC (samme danske dato i hele Europa).
pub fn date_to_noon_utc(date: NaiveDate) -> DateTime<Utc> {
    date.and_hms_opt(12, 0, 0).expect("12:00 findes").and_utc()
}

fn non_empty(s: &Option<String>) -> Option<String> {
    s.as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

// ---------------------------------------------------------------- kunder

pub fn customer(c: &td::Client) -> Customer {
    Customer {
        id: c.id.clone(),
        name: c.name.clone(),
        email: non_empty(&c.email),
        hourly_rate: c.default_hourly_rate.map(kroner_to_ore),
        archived: c.archived(),
        cvr: non_empty(&c.cvr_number),
        color: non_empty(&c.color).filter(|c| is_hex_color(c)),
        phone: non_empty(&c.phone),
        notes: non_empty(&c.notes),
        domains: c.domains.clone(),
        internal: !c.default_billable,
        payment_terms_days: c.payment_terms_days.and_then(|d| u32::try_from(d).ok()),
    }
}

/// "#RRGGBB" som web's zod-regex (`/^#[0-9a-fA-F]{6}$/`).
pub fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn new_client(input: &CustomerInput) -> td::NewClient {
    td::NewClient {
        name: input.name.trim().to_owned(),
        email: non_empty(&input.email),
        cvr_number: non_empty(&input.cvr),
        default_hourly_rate: input.hourly_rate.map(ore_to_kroner),
        color: non_empty(&input.color).filter(|c| is_hex_color(c)),
        phone: non_empty(&input.phone),
        notes: non_empty(&input.notes),
        domains: input.domains.clone().unwrap_or_default(),
        payment_terms_days: input.payment_terms_days.map(|d| d as i32),
        default_billable: input.internal.then_some(false),
        ..td::NewClient::default()
    }
}

/// Rettelse af en kunde. `ClientPatch` kender kun "uændret" og "ny værdi",
/// så en slettet mail eller et slettet CVR sendes som tom streng (læses
/// tilbage som `None`). En tom timepris fjerner kundens sats, så den
/// globale bruges.
pub fn client_patch(input: &CustomerInput, existing: &td::Client) -> td::ClientPatch {
    let text = |new: &Option<String>, old: &Option<String>| match non_empty(new) {
        Some(v) => Some(v),
        None if non_empty(old).is_some() => Some(String::new()),
        None => None,
    };
    td::ClientPatch {
        name: Some(input.name.trim().to_owned()),
        email: text(&input.email, &existing.email),
        cvr_number: text(&input.cvr, &existing.cvr_number),
        default_hourly_rate: Some(input.hourly_rate.map(ore_to_kroner)),
        phone: text(&input.phone, &existing.phone),
        notes: text(&input.notes, &existing.notes),
        color: text(&input.color, &existing.color),
        domains: input.domains.clone(),
        // Kun ændringer sendes: udeladt er uændret i web.
        payment_terms_days: (input.payment_terms_days.map(|d| d as i32) != existing.payment_terms_days)
            .then_some(input.payment_terms_days.map(|d| d as i32)),
        default_billable: (input.internal == existing.default_billable).then_some(!input.internal),
        ..td::ClientPatch::default()
    }
}

// ---------------------------------------------------------------- projekter

pub fn project_status(s: td::ProjectStatus) -> ProjectStatus {
    match s {
        td::ProjectStatus::Active => ProjectStatus::Active,
        td::ProjectStatus::OnHold => ProjectStatus::Paused,
        td::ProjectStatus::Completed => ProjectStatus::Completed,
        td::ProjectStatus::Archived => ProjectStatus::Archived,
    }
}

pub fn to_project_status(s: ProjectStatus) -> td::ProjectStatus {
    match s {
        ProjectStatus::Active => td::ProjectStatus::Active,
        ProjectStatus::Paused => td::ProjectStatus::OnHold,
        ProjectStatus::Completed => td::ProjectStatus::Completed,
        ProjectStatus::Archived => td::ProjectStatus::Archived,
    }
}

pub fn project(p: &td::Project) -> Project {
    Project {
        id: p.id.clone(),
        customer_id: p.client_id.clone().unwrap_or_default(),
        name: p.name.clone(),
        status: project_status(p.status),
        hourly_rate: p.hourly_rate.map(kroner_to_ore),
        budget_minutes: p.budget_hours.map(hours_to_minutes).filter(|m| *m > 0),
        url_patterns: p.url_patterns.clone(),
    }
}

pub fn new_project(input: &ProjectInput) -> td::NewProject {
    td::NewProject {
        name: input.name.trim().to_owned(),
        client_id: Some(input.customer_id.clone()).filter(|c| !c.is_empty()),
        hourly_rate: input.hourly_rate.map(ore_to_kroner),
        budget_hours: input.budget_minutes.map(minutes_to_hours_precise),
        ..td::NewProject::default()
    }
}

/// Formularen sender hele projektet: en tom sats eller et tomt budget
/// fjerner dem (projektet bruger så kundens sats).
pub fn project_patch(input: &ProjectInput) -> td::ProjectPatch {
    td::ProjectPatch {
        name: Some(input.name.trim().to_owned()),
        client_id: Some(Some(input.customer_id.clone()).filter(|c| !c.is_empty())),
        hourly_rate: Some(input.hourly_rate.map(ore_to_kroner)),
        budget_hours: Some(input.budget_minutes.map(minutes_to_hours_precise)),
        ..td::ProjectPatch::default()
    }
}

// ---------------------------------------------------------------- poster

pub fn entry(e: &td::TimeEntry) -> Entry {
    Entry {
        id: e.id.clone(),
        customer_id: e.client_id.clone().unwrap_or_default(),
        project_id: e.project_id.clone(),
        task_id: e.task_id.clone(),
        description: e.description.clone().unwrap_or_default(),
        date: e.date,
        start: e
            .start_time
            .filter(|_| e.end_time.is_some())
            .map(local_time),
        end: e
            .end_time
            .filter(|_| e.start_time.is_some())
            .map(local_time),
        minutes: hours_to_minutes(e.hours),
        billable: e.is_billable.unwrap_or(true),
        invoice_id: e.invoice_id.clone(),
    }
}

/// Start og slut som UTC. Ligger slutningen på eller før starten, regnes den
/// som næste dag (en post over midnat).
fn time_range(input: &EntryInput) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>) {
    match (input.start, input.end) {
        (Some(s), Some(e)) => {
            let end_date = if e <= s {
                input.date + Duration::days(1)
            } else {
                input.date
            };
            (
                Some(local_to_utc(input.date, s)),
                Some(local_to_utc(end_date, e)),
            )
        }
        _ => (None, None),
    }
}

fn empty_to_none(s: &str) -> Option<String> {
    Some(s.to_owned()).filter(|s| !s.is_empty())
}

pub fn new_entry(input: &EntryInput) -> td::NewTimeEntry {
    let (start_time, end_time) = time_range(input);
    td::NewTimeEntry {
        project_id: input.project_id.clone(),
        client_id: empty_to_none(&input.customer_id),
        description: input.description.trim().to_owned(),
        hours: minutes_to_hours(input.minutes),
        date: input.date,
        start_time,
        end_time,
        is_billable: Some(input.billable),
        task_id: input.task_id.clone(),
        ..td::NewTimeEntry::default()
    }
}

/// Fuld rettelse: alle felter sættes, så en post kan miste sit tidspunkt eller
/// sit projekt.
pub fn entry_patch(input: &EntryInput) -> td::TimeEntryPatch {
    let (start_time, end_time) = time_range(input);
    td::TimeEntryPatch {
        project_id: Some(input.project_id.clone()),
        client_id: Some(empty_to_none(&input.customer_id)),
        description: Some(input.description.trim().to_owned()),
        hours: Some(minutes_to_hours(input.minutes)),
        date: Some(input.date),
        start_time: Some(start_time),
        end_time: Some(end_time),
        is_billable: Some(input.billable),
        task_id: Some(input.task_id.clone()),
        ..td::TimeEntryPatch::default()
    }
}

// ---------------------------------------------------------------- klippekort

pub fn punch_card(p: &td::PrepaidPackage, today: NaiveDate) -> PunchCard {
    PunchCard {
        id: p.id.clone(),
        customer_id: p.client_id.clone(),
        name: p.name.clone(),
        total_minutes: hours_to_minutes(p.total_hours),
        used_minutes: hours_to_minutes(p.used_hours),
        purchased: p
            .purchase_date
            .map(tt_core::klippekort::expiry_date)
            .unwrap_or(today),
        expires: p.expiry_date.map(tt_core::klippekort::expiry_date),
        price: kroner_to_ore(p.total_value),
    }
}

pub fn new_punch_card(input: &PunchCardInput, today: NaiveDate) -> td::NewPrepaidPackage {
    let hours = minutes_to_hours_precise(input.total_minutes);
    // Prisen er for hele kortet; web gemmer en timepris.
    let rate = if hours.is_zero() {
        Decimal::ZERO
    } else {
        (ore_to_kroner(input.price) / hours).round_dp(4)
    };
    td::NewPrepaidPackage {
        name: input.name.trim().to_owned(),
        client_id: input.customer_id.clone(),
        total_hours: hours,
        hourly_rate: rate,
        purchase_date: today.format("%Y-%m-%d").to_string(),
        expiry_date: input.expires.map(|d| d.format("%Y-%m-%d").to_string()),
        ..td::NewPrepaidPackage::default()
    }
}

/// Rettelse af et klippekort fra formularen. Prisen er for hele kortet, så
/// timeprisen regnes om fra den nye pris og det nye timetal. Købsdatoen
/// røres ikke; et tomt udløb fjerner udløbet.
pub fn punch_card_patch(input: &PunchCardInput) -> td::PrepaidPackagePatch {
    let new = new_punch_card(input, NaiveDate::default());
    td::PrepaidPackagePatch {
        name: Some(new.name),
        client_id: Some(new.client_id).filter(|c| !c.is_empty()),
        total_hours: Some(new.total_hours),
        hourly_rate: Some(new.hourly_rate),
        expiry_date: Some(new.expiry_date),
        ..td::PrepaidPackagePatch::default()
    }
}

/// Én række i forbrugshistorikken fra web. Datoen er postens dag (eller
/// trækkets dag for et manuelt træk), og beskrivelsen postens.
pub fn punch_usage(u: &td::PrepaidUsage, today: NaiveDate) -> PunchUsage {
    let entry = u.time_entry.as_ref();
    PunchUsage {
        entry_id: u.time_entry_id.clone(),
        date: entry
            .map(|e| e.date)
            .or_else(|| u.created_at.map(tt_core::tid::copenhagen_date))
            .unwrap_or(today),
        minutes: hours_to_minutes(u.hours_used),
        description: entry
            .and_then(|e| e.description.clone())
            .or_else(|| u.description.clone())
            .unwrap_or_default(),
    }
}

// ---------------------------------------------------------------- opgaver

pub fn task_status(s: td::TaskStatus) -> TaskStatus {
    match s {
        td::TaskStatus::Backlog => TaskStatus::Backlog,
        td::TaskStatus::Todo => TaskStatus::Todo,
        td::TaskStatus::InProgress => TaskStatus::InProgress,
        td::TaskStatus::Done => TaskStatus::Done,
    }
}

pub fn to_task_status(s: TaskStatus) -> td::TaskStatus {
    match s {
        TaskStatus::Backlog => td::TaskStatus::Backlog,
        TaskStatus::Todo => td::TaskStatus::Todo,
        TaskStatus::InProgress => td::TaskStatus::InProgress,
        TaskStatus::Done => td::TaskStatus::Done,
    }
}

pub fn task(t: &td::Task) -> Task {
    Task {
        id: t.id.clone(),
        project_id: t.project_id.clone().unwrap_or_default(),
        title: t.title.clone(),
        status: task_status(t.status),
        due: t.deadline.map(tt_core::tid::copenhagen_date),
        logged_minutes: t.tracked_minutes.unwrap_or(0).max(0) as u32,
        estimate_minutes: t.estimated_minutes.filter(|m| *m > 0).map(|m| m as u32),
        priority: t.priority.as_deref().and_then(TaskPriority::parse),
        description: t.description.clone().filter(|d| !d.trim().is_empty()),
        customer_id: t.client_id.clone().filter(|c| !c.is_empty()),
        status_id: t.status_id.clone().filter(|s| !s.is_empty()),
        completed: t.completed_at.map(tt_core::tid::copenhagen_date),
    }
}

/// En kolonne fra web. Mangler kategorien (ældre server), afgøres den som
/// web's migrering: standardnavnene, ellers "arkiv" = afsluttet.
pub fn task_lane(l: &td::TaskLane) -> TaskLane {
    let category = l.category.as_deref().and_then(LaneCategory::parse).unwrap_or(
        match l.name.as_str() {
            "I gang" => LaneCategory::InProgress,
            "Afsluttet" => LaneCategory::Done,
            _ if l.is_archive => LaneCategory::Done,
            _ => LaneCategory::NotStarted,
        },
    );
    TaskLane {
        id: l.id.clone(),
        name: l.name.clone(),
        color: l
            .color
            .as_deref()
            .and_then(|c| c.strip_prefix('#'))
            .filter(|c| c.len() == 6)
            .and_then(|c| u32::from_str_radix(c, 16).ok()),
        category,
        is_archive: l.is_archive,
    }
}

pub fn new_task(input: &TaskInput) -> td::NewTask {
    td::NewTask {
        title: input.title.trim().to_owned(),
        project_id: Some(input.project_id.clone()).filter(|p| !p.is_empty()),
        // Med projekt sætter kalderen kunden ud fra projektet.
        client_id: input.customer_id.clone().filter(|_| input.project_id.is_empty()),
        status: input.status.map_or(td::TaskStatus::Todo, to_task_status),
        priority: input.priority.map(|p| p.as_str().to_owned()),
        description: input.description.clone().filter(|d| !d.trim().is_empty()),
        deadline: input.due.map(date_to_noon_utc),
        estimated_minutes: input.estimate_minutes.map(|m| m as i32),
    }
}

/// Rettelse af en opgave fra formularen (hele formularen): en tom frist
/// eller et tomt estimat fjerner dem. Med projekt sætter kalderen kunden ud
/// fra projektet, som ved oprettelse; uden projekt er det `customer_id`.
pub fn task_patch(input: &TaskInput) -> td::TaskPatch {
    let new = new_task(input);
    td::TaskPatch {
        title: Some(new.title),
        // Uden projekt er kunden opgavens egen (eller ingen).
        client_id: new.project_id.is_none().then_some(new.client_id),
        project_id: Some(new.project_id),
        deadline: Some(new.deadline),
        estimated_minutes: Some(new.estimated_minutes),
        priority: new.priority,
        // Tom beskrivelse fjerner den; `None` lader den stå.
        description: input
            .description
            .as_ref()
            .map(|d| Some(d.trim().to_owned()).filter(|d| !d.is_empty())),
    }
}

// ---------------------------------------------------------------- fakturaer

pub fn invoice_status(s: td::InvoiceStatus) -> InvoiceStatus {
    match s {
        td::InvoiceStatus::Draft => InvoiceStatus::Draft,
        td::InvoiceStatus::Sent | td::InvoiceStatus::Deleted | td::InvoiceStatus::Other => InvoiceStatus::Sent,
        td::InvoiceStatus::Paid => InvoiceStatus::Paid,
        td::InvoiceStatus::Overdue => InvoiceStatus::Overdue,
    }
}

/// Fakturanummeret som tal. Kladder ("Kladde") har ingen.
pub fn invoice_number(raw: &str) -> Option<u32> {
    if tt_core::faktura::is_draft_invoice_number(Some(raw)) {
        return None;
    }
    tt_core::faktura::trailing_number(raw).and_then(|n| u32::try_from(n).ok())
}

pub fn invoice_line(l: &td::InvoiceLine) -> InvoiceLine {
    let minutes = hours_to_minutes(l.quantity);
    let rate = kroner_to_ore(l.unit_price);
    InvoiceLine {
        description: l.description.clone(),
        minutes,
        rate,
        entry_ids: l.time_entry_id.iter().cloned().collect(),
        // Web's beløb er sandheden (timer med to decimaler × sats), ikke
        // hele minutter × sats.
        stored: Some(StoredLine {
            minutes,
            rate,
            hours: l.quantity,
            amount: kroner_to_ore(l.amount),
        }),
    }
}

/// `vat_permille`: momssatsen, når appen selv afgør momsen (lokal tilstand),
/// `None` i cloud (se `Invoice::vat_permille`).
pub fn invoice(
    i: &td::Invoice,
    lines: &[td::InvoiceLine],
    today: NaiveDate,
    vat_permille: Option<u32>,
) -> Invoice {
    let issued = i.issue_date.map(local_date).unwrap_or(today);
    Invoice {
        id: i.id.clone(),
        number: invoice_number(&i.invoice_number),
        customer_id: i.client_id.clone(),
        status: invoice_status(i.status),
        issued,
        due: i
            .due_date
            .map(local_date)
            .unwrap_or(issued + Duration::days(14)),
        lines: lines.iter().map(invoice_line).collect(),
        lines_loaded: true,
        subtotal_hint: kroner_to_ore(i.amount),
        vat_permille,
        // Kun rigtige numre (kladder hedder "Kladde" eller "UDKAST-…").
        number_text: invoice_number(&i.invoice_number).map(|_| i.invoice_number.clone()),
        title: i.title.clone(),
        notes: i.notes.clone(),
        delivery: None,
    }
}

/// Faktura fra listen uden linjer (de hentes, når fakturaen åbnes).
pub fn invoice_header(i: &td::Invoice, today: NaiveDate, vat_permille: Option<u32>) -> Invoice {
    Invoice { lines_loaded: false, ..invoice(i, &[], today, vat_permille) }
}

/// Web's fakturatal (`extension.invoices.totals`) i øre og promille.
pub fn web_invoice_totals(t: &td::InvoiceTotals) -> WebInvoiceTotals {
    WebInvoiceTotals {
        subtotal: kroner_to_ore(t.subtotal),
        vat: kroner_to_ore(t.vat_amount),
        total: kroner_to_ore(t.total),
        vat_permille: (t.vat_rate * Decimal::TEN)
            .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
            .to_u32()
            .unwrap_or(0),
        show_vat: t.show_vat,
        currency: t.currency.clone(),
    }
}

/// Hvad der hentes fra web på en faktura (til fejlteksten).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WebInvoicePart {
    Pdf,
    Totals,
}

/// Fejl fra `totals` og PDF'en som dansk tekst. Intet ligger i køen, så
/// "ingen forbindelse" må ikke sige, at noget sendes senere, og 403 betyder,
/// at fakturamodulet er slået fra i web (eller at rollen ikke må se
/// fakturaer).
pub fn web_invoice_error(e: td::DataError, part: WebInvoicePart) -> BackendError {
    use td::DataError as D;
    let name = tt_core::edition::EDITION.name;
    let what = match part {
        WebInvoicePart::Pdf => "PDF'en",
        WebInvoicePart::Totals => "Momsen og totalen",
    };
    match e {
        D::Offline | D::Timeout => BackendError::Validation(format!(
            "Ingen forbindelse til {name}. {what} hentes fra web, så prøv igen, når du er online"
        )),
        D::Rejected { ref code, status, .. } if code == "FORBIDDEN" || status == 403 => {
            BackendError::Validation(format!(
                "{what} kan ikke hentes: fakturaer er slået fra i web, eller din rolle har ikke adgang til dem"
            ))
        }
        D::Rejected { status: 429, .. } => BackendError::Validation(format!(
            "{name} har fået for mange forsøg fra denne forbindelse. Vent et par minutter, og prøv igen"
        )),
        D::InvalidResponse(_) if part == WebInvoicePart::Pdf => BackendError::Validation(format!(
            "{name} sendte ikke en PDF. Prøv igen om lidt"
        )),
        other => error(other, "Fakturaen"),
    }
}

/// Én `tt-data`-linje pr. post. Beløbet er antal timer × timepris, afrundet
/// til øre halvt væk fra nul som web's `roundMoney`. En linje, hvor tid og
/// sats ikke er rettet, gemmes med web's eget antal og beløb, så det ikke
/// ændrer sig, bare fordi en anden linje blev rettet.
pub fn to_data_line(
    l: &InvoiceLine,
    sort_order: i32,
    entry_id: Option<String>,
    minutes: u32,
) -> td::InvoiceLine {
    let unit_price = ore_to_kroner(l.rate);
    let (quantity, amount) = match l.unchanged_stored().filter(|s| s.minutes == minutes) {
        Some(s) => (s.hours, ore_to_kroner(s.amount)),
        None => {
            let quantity = minutes_to_hours_precise(minutes);
            let amount = (quantity * unit_price)
                .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
            (quantity, amount)
        }
    };
    td::InvoiceLine {
        id: None,
        description: l.description.clone(),
        quantity,
        unit_price,
        amount,
        time_entry_id: entry_id,
        sort_order,
    }
}

// ---------------------------------------------------------------- rapporter

pub fn to_report_grouping(g: ReportGrouping) -> td::ReportGrouping {
    match g {
        ReportGrouping::Customer => td::ReportGrouping::Client,
        ReportGrouping::Project => td::ReportGrouping::Project,
        ReportGrouping::Day => td::ReportGrouping::Day,
    }
}

pub fn report(
    r: &td::Report,
    range: crate::backend::DateRange,
    grouping: ReportGrouping,
) -> Report {
    Report {
        range,
        grouping,
        rows: r
            .rows
            .iter()
            .map(|row| ReportRow {
                key: row.key.clone(),
                label: row.label.clone(),
                minutes: hours_to_minutes(row.hours),
                billable_minutes: hours_to_minutes(row.billable_hours),
                amount: kroner_to_ore(row.amount),
            })
            .collect(),
    }
}

// ---------------------------------------------------------------- timer

pub fn timer(t: &td::TimerState) -> TimerState {
    let status = if t.is_running {
        TimerStatus::Running
    } else if t.is_active() {
        TimerStatus::Paused
    } else {
        TimerStatus::Idle
    };
    TimerState {
        status,
        customer_id: t.client_id.clone(),
        project_id: t.project_id.clone(),
        task_id: t.task_id.clone(),
        description: t.description.clone(),
        started_at: t
            .start_time
            .filter(|_| t.is_running)
            .map(|s| s.with_timezone(&Local)),
        accumulated_secs: t.base_seconds.max(0) as u64,
        version: t.version.max(0) as u64,
    }
}

// ---------------------------------------------------------------- fejl

/// Dansk tekst til timer-protokollens konfliktgrunde.
fn conflict_text(reason: &str) -> String {
    match reason {
        "not_active" | "not_running" => "timeren kører ikke".into(),
        "already_running" => "timeren kører allerede".into(),
        "not_paused" => "timeren er ikke sat på pause".into(),
        "version_mismatch" | "stale" => "timeren er ændret et andet sted".into(),
        other => other.replace('_', " "),
    }
}

/// `what` er det, der ikke blev fundet ("Kunden", "Posten" …).
pub fn error(e: td::DataError, what: &str) -> BackendError {
    use td::DataError as D;
    match e {
        D::Unauthorized => BackendError::Unauthorized,
        D::Offline => BackendError::Offline,
        D::NotFound => BackendError::NotFound(what.to_owned()),
        D::Validation(m) | D::Unsupported(m) => BackendError::Validation(m),
        D::Conflict { reason } => BackendError::Conflict(conflict_text(&reason)),
        D::Rejected { code, message, .. } => match code.as_str() {
            "FORBIDDEN" | "PAYMENT_REQUIRED" => BackendError::PlanLimit(message),
            "BAD_REQUEST" | "UNPROCESSABLE_CONTENT" => BackendError::Validation(message),
            "NOT_FOUND" => BackendError::NotFound(what.to_owned()),
            "CONFLICT" | "PRECONDITION_FAILED" => BackendError::Conflict(message),
            "UNAUTHORIZED" => BackendError::Unauthorized,
            _ => BackendError::Other(message),
        },
        D::Timeout => BackendError::Other("Forbindelsen tog for lang tid. Prøv igen".into()),
        D::Server { status } => BackendError::Other(format!(
            "{} svarede med fejl {status}. Prøv igen om lidt",
            tt_core::edition::EDITION.name
        )),
        D::InvalidResponse(_) => {
            BackendError::Other(format!(
                "{} svarede med noget uventet. Prøv igen om lidt",
                tt_core::edition::EDITION.name
            ))
        }
        D::MissingProcedure(p) => {
            BackendError::Other(format!(
                "Din {}-konto understøtter ikke {p} endnu",
                tt_core::edition::EDITION.name
            ))
        }
        D::Storage(m) => BackendError::Other(format!("Databasefejl: {m}")),
        D::Auth(m) => BackendError::Validation(format!("Login mislykkedes: {m}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use testutil::d;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn oere_og_kroner() {
        assert_eq!(kroner_to_ore(d("850")), 85_000);
        assert_eq!(kroner_to_ore(d("1234.50")), 123_450);
        assert_eq!(kroner_to_ore(d("0")), 0);
        assert_eq!(ore_to_kroner(123_450), d("1234.50"));
        assert_eq!(ore_to_kroner(-5), d("-0.05"));
    }

    #[test]
    fn midtpunkt_runder_vaek_fra_nul() {
        assert_eq!(kroner_to_ore(d("1.005")), 101);
        assert_eq!(kroner_to_ore(d("1.004")), 100);
        assert_eq!(kroner_to_ore(d("1.0049999")), 100);
        assert_eq!(kroner_to_ore(d("-1.005")), -101);
        assert_eq!(kroner_to_ore(d("-1.004")), -100);
        assert_eq!(kroner_to_ore(d("0.995")), 100);
        assert_eq!(kroner_to_ore(d("-0.001")), 0);
    }

    #[test]
    fn oere_runde_tur_og_enig_med_tt_core_paa_to_decimaler() {
        for ore in (-50_000..=50_000).chain([i64::from(i32::MAX), -i64::from(i32::MAX)]) {
            let kr = ore_to_kroner(ore);
            assert_eq!(kroner_to_ore(kr), ore, "runde tur for {ore}");
            // Web regner i f64; på beløb med to decimaler skal vi være enige.
            let f: f64 = kr.to_string().parse().unwrap();
            assert_eq!(tt_core::faktura::kroner_to_ore(f), ore, "tt-core for {ore}");
        }
    }

    #[test]
    fn enorme_beloeb_mætter_i_stedet_for_at_panikke() {
        assert_eq!(kroner_to_ore(Decimal::MAX), i64::MAX);
        assert_eq!(kroner_to_ore(Decimal::MIN), i64::MIN);
    }

    #[test]
    fn minutter_og_timer_runde_tur() {
        for m in 0..=3000u32 {
            assert_eq!(hours_to_minutes(minutes_to_hours(m)), m, "{m} min");
            assert_eq!(
                hours_to_minutes(minutes_to_hours_precise(m)),
                m,
                "{m} min (præcis)"
            );
        }
        assert_eq!(minutes_to_hours(90), d("1.5"));
        assert_eq!(minutes_to_hours(20), d("0.33"));
        assert_eq!(hours_to_minutes(d("1.25")), 75);
        assert_eq!(hours_to_minutes(d("-1")), 0, "aldrig negativ");
        assert_eq!(hours_to_minutes(d("0.008")), 0);
    }

    #[test]
    fn timerstatus() {
        let mut t = td::TimerState::default();
        assert_eq!(timer(&t).status, TimerStatus::Idle);
        t.base_seconds = 120;
        assert_eq!(timer(&t).status, TimerStatus::Paused);
        assert_eq!(timer(&t).accumulated_secs, 120);
        assert!(timer(&t).started_at.is_none());
        t.is_running = true;
        t.start_time = Some(utc("2026-10-26T08:00:00Z"));
        t.version = 7;
        let b = timer(&t);
        assert_eq!(b.status, TimerStatus::Running);
        assert_eq!(b.version, 7);
        assert_eq!(
            b.started_at.unwrap().with_timezone(&Utc),
            utc("2026-10-26T08:00:00Z")
        );
        // En stoppet timer med tid fra en gammel kørsel har ingen starttid.
        t.is_running = false;
        assert!(timer(&t).started_at.is_none());
        t.base_seconds = -5;
        assert_eq!(timer(&t).status, TimerStatus::Idle);
        assert_eq!(timer(&t).accumulated_secs, 0);
    }

    #[test]
    fn timer_pauset_i_foerste_sekund_er_pauset() {
        // Pauset inden for det første sekund: 0 sekunder, men sessionen
        // lever stadig. Må ikke vises som "Klar".
        let t = td::TimerState {
            session_id: Some("s1".into()),
            ..td::TimerState::default()
        };
        assert_eq!(timer(&t).status, TimerStatus::Paused);
    }

    #[test]
    fn projektstatus_runde_tur() {
        for s in [
            ProjectStatus::Active,
            ProjectStatus::Paused,
            ProjectStatus::Completed,
            ProjectStatus::Archived,
        ] {
            assert_eq!(project_status(to_project_status(s)), s);
        }
    }

    #[test]
    fn opgavestatus() {
        assert_eq!(task_status(td::TaskStatus::Backlog), TaskStatus::Backlog);
        for s in TaskStatus::ALL {
            assert_eq!(task_status(to_task_status(s)), s);
        }
    }

    #[test]
    fn kundens_farve_domaener_telefon_og_noter() {
        let web = td::Client {
            id: "c1".into(),
            name: "Bageriet".into(),
            color: Some("#F59E0B".into()),
            phone: Some(" 12 34 56 78 ".into()),
            notes: Some(String::new()),
            domains: vec!["bageriet.dk".into()],
            ..td::Client::default()
        };
        let c = customer(&web);
        assert_eq!(c.color.as_deref(), Some("#F59E0B"));
        assert_eq!(c.phone.as_deref(), Some("12 34 56 78"));
        assert_eq!(c.notes, None);
        assert_eq!(c.domains, vec!["bageriet.dk".to_string()]);
        // En ugyldig farve fra web bliver til den udledte.
        let bad = customer(&td::Client { color: Some("rød".into()), ..web.clone() });
        assert_eq!(bad.color, None);

        // Rettelse: ny farve og noter, fjernet telefon, uændrede domæner.
        let input = CustomerInput {
            name: "Bageriet".into(),
            color: Some("#10b981".into()),
            notes: Some("Ring før 10".into()),
            phone: None,
            domains: None,
            ..Default::default()
        };
        let p = client_patch(&input, &web);
        assert_eq!(p.color.as_deref(), Some("#10b981"));
        assert_eq!(p.notes.as_deref(), Some("Ring før 10"));
        assert_eq!(p.phone.as_deref(), Some(""));
        assert_eq!(p.domains, None);
        let p = client_patch(&CustomerInput { domains: Some(vec![]), ..input }, &web);
        assert_eq!(p.domains, Some(vec![]));
    }

    #[test]
    fn kunde_med_cvr_og_sats() {
        let input = CustomerInput {
            name: "  Café Åbrinken ".into(),
            email: Some("kontakt@abrinken.dk".into()),
            hourly_rate: Some(85_050),
            cvr: Some("12345678".into()),
            ..Default::default()
        };
        let nc = new_client(&input);
        assert_eq!(nc.name, "Café Åbrinken");
        assert_eq!(nc.cvr_number.as_deref(), Some("12345678"));
        assert_eq!(nc.default_hourly_rate, Some(d("850.50")));
        let back = customer(&td::Client {
            id: "k1".into(),
            name: nc.name.clone(),
            email: nc.email.clone(),
            cvr_number: nc.cvr_number.clone(),
            default_hourly_rate: nc.default_hourly_rate,
            ..td::Client::default()
        });
        assert_eq!(back.hourly_rate, Some(85_050));
        assert_eq!(back.cvr.as_deref(), Some("12345678"));
        assert!(!back.archived);
    }

    #[test]
    fn tom_mail_og_cvr_er_ingenting() {
        let c = customer(&td::Client {
            email: Some(" ".into()),
            cvr_number: Some(String::new()),
            is_archived: Some(true),
            ..td::Client::default()
        });
        assert_eq!(c.email, None);
        assert_eq!(c.cvr, None);
        assert!(c.archived);
    }

    #[test]
    fn kunderettelse_rydder_felter_med_tom_streng() {
        let existing = td::Client {
            email: Some("a@b.dk".into()),
            cvr_number: None,
            ..td::Client::default()
        };
        let p = client_patch(
            &CustomerInput {
                name: "X".into(),
                ..Default::default()
            },
            &existing,
        );
        assert_eq!(p.email.as_deref(), Some(""), "gammel mail ryddes");
        assert_eq!(p.cvr_number, None, "intet CVR før og nu: uændret");
        assert_eq!(p.name.as_deref(), Some("X"));
    }

    #[test]
    fn projekt_budget_i_minutter() {
        let p = project(&td::Project {
            id: "p".into(),
            client_id: Some("k".into()),
            budget_hours: Some(d("12.5")),
            hourly_rate: Some(d("700")),
            status: td::ProjectStatus::OnHold,
            ..td::Project::default()
        });
        assert_eq!(p.budget_minutes, Some(750));
        assert_eq!(p.hourly_rate, Some(70_000));
        assert_eq!(p.status, ProjectStatus::Paused);
        let np = new_project(&ProjectInput {
            customer_id: "k".into(),
            name: "Web".into(),
            hourly_rate: None,
            budget_minutes: Some(750),
        });
        assert_eq!(np.budget_hours, Some(d("12.5")));
        // Nul budget er intet budget.
        let none = project(&td::Project {
            budget_hours: Some(d("0")),
            ..td::Project::default()
        });
        assert_eq!(none.budget_minutes, None);
    }

    fn sample_input() -> EntryInput {
        EntryInput {
            customer_id: "k1".into(),
            project_id: Some("p1".into()),
            task_id: None,
            description: " Design ".into(),
            date: NaiveDate::from_ymd_opt(2026, 10, 26).unwrap(),
            start: NaiveTime::from_hms_opt(9, 0, 0),
            end: NaiveTime::from_hms_opt(10, 30, 0),
            minutes: 90,
            billable: true,
        }
    }

    #[test]
    fn post_ud_og_hjem() {
        let input = sample_input();
        let n = new_entry(&input);
        assert_eq!(n.description, "Design");
        assert_eq!(n.hours, d("1.5"));
        assert_eq!(n.client_id.as_deref(), Some("k1"));
        assert!(n.start_time.unwrap() < n.end_time.unwrap());
        let stored = td::TimeEntry {
            id: "e1".into(),
            client_id: n.client_id.clone(),
            project_id: n.project_id.clone(),
            description: Some(n.description.clone()),
            hours: n.hours,
            date: n.date,
            start_time: n.start_time,
            end_time: n.end_time,
            is_billable: n.is_billable,
            ..td::TimeEntry::default()
        };
        let back = entry(&stored);
        assert_eq!(back.minutes, 90);
        assert_eq!(back.start, input.start, "lokal tid overlever UTC-turen");
        assert_eq!(back.end, input.end);
        assert_eq!(back.date, input.date);
        assert!(back.billable);
    }

    #[test]
    fn post_uden_tidspunkt_og_over_midnat() {
        let mut input = sample_input();
        input.start = None;
        input.end = None;
        let n = new_entry(&input);
        assert!(n.start_time.is_none() && n.end_time.is_none());
        let p = entry_patch(&input);
        assert_eq!(p.start_time, Some(None), "tidspunktet fjernes ved rettelse");

        let mut over = sample_input();
        over.start = NaiveTime::from_hms_opt(23, 0, 0);
        over.end = NaiveTime::from_hms_opt(1, 0, 0);
        over.minutes = 120;
        let n = new_entry(&over);
        assert_eq!(
            n.end_time.unwrap() - n.start_time.unwrap(),
            Duration::hours(2)
        );

        // En halv post (kun start) bliver en post uden tidspunkt.
        let half = entry(&td::TimeEntry {
            start_time: Some(utc("2026-10-26T08:00:00Z")),
            end_time: None,
            hours: d("1"),
            ..td::TimeEntry::default()
        });
        assert_eq!((half.start, half.end), (None, None));
    }

    #[test]
    fn post_uden_kunde_og_ikke_fakturerbar() {
        let mut input = sample_input();
        input.customer_id = String::new();
        input.billable = false;
        let n = new_entry(&input);
        assert_eq!(n.client_id, None);
        assert_eq!(n.is_billable, Some(false));
        assert_eq!(entry_patch(&input).client_id, Some(None));
        let e = entry(&td::TimeEntry {
            is_billable: None,
            ..td::TimeEntry::default()
        });
        assert!(e.billable, "ukendt betyder fakturerbar, som web");
    }

    #[test]
    fn klippekort_ud_og_hjem() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        let input = PunchCardInput {
            customer_id: "k1".into(),
            name: "10 timer".into(),
            total_minutes: 600,
            price: 600_000,
            expires: NaiveDate::from_ymd_opt(2027, 1, 31),
        };
        let n = new_punch_card(&input, today);
        assert_eq!(n.total_hours, d("10"));
        assert_eq!(n.hourly_rate, d("600"));
        assert_eq!(n.purchase_date, "2026-10-26");
        assert_eq!(n.expiry_date.as_deref(), Some("2027-01-31"));
        let stored = td::PrepaidPackage {
            id: "c1".into(),
            name: n.name.clone(),
            client_id: "k1".into(),
            total_hours: n.total_hours,
            used_hours: d("2.5"),
            remaining_hours: d("7.5"),
            hourly_rate: n.hourly_rate,
            total_value: d("6000.00"),
            purchase_date: Some(utc("2026-10-26T00:00:00Z")),
            expiry_date: Some(utc("2027-01-31T00:00:00Z")),
            ..td::PrepaidPackage::default()
        };
        let c = punch_card(&stored, today);
        assert_eq!((c.total_minutes, c.used_minutes), (600, 150));
        assert_eq!(c.price, 600_000);
        assert_eq!(c.purchased, today, "dansk dato for købet");
        assert_eq!(c.expires, NaiveDate::from_ymd_opt(2027, 1, 31));
        assert_eq!(c.remaining_minutes(), 450);
    }

    #[test]
    fn klippekort_overtraek_giver_overloeb() {
        let c = punch_card(
            &td::PrepaidPackage {
                total_hours: d("2"),
                used_hours: d("2.5"),
                ..td::PrepaidPackage::default()
            },
            NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        );
        assert_eq!(c.overflow_minutes(), 30);
    }

    #[test]
    fn faktura_nummer_og_status() {
        assert_eq!(invoice_number("Kladde"), None);
        assert_eq!(invoice_number("2026-0042"), Some(42));
        assert_eq!(invoice_number("1007"), Some(1007));
        assert_eq!(invoice_number("uden tal"), None);
        assert_eq!(
            invoice_status(td::InvoiceStatus::Other),
            InvoiceStatus::Sent
        );
        assert_eq!(
            invoice_status(td::InvoiceStatus::Overdue),
            InvoiceStatus::Overdue
        );
    }

    #[test]
    fn fakturalinjer_ud_og_hjem() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        let line = InvoiceLine {
            description: "Design".into(),
            minutes: 90,
            rate: 85_000,
            entry_ids: vec!["e1".into()],
            stored: None,
        };
        let dl = to_data_line(&line, 0, Some("e1".into()), 90);
        assert_eq!(dl.quantity, d("1.5"));
        assert_eq!(dl.unit_price, d("850"));
        assert_eq!(dl.amount, d("1275.00"));
        let inv = invoice(
            &td::Invoice {
                id: "i1".into(),
                invoice_number: "Kladde".into(),
                client_id: "k1".into(),
                status: td::InvoiceStatus::Draft,
                issue_date: Some(utc("2026-10-26T10:00:00Z")),
                due_date: None,
                ..td::Invoice::default()
            },
            &[dl],
            today,
            Some(VAT_PERMILLE),
        );
        assert_eq!(inv.number, None);
        let back: Vec<InvoiceLine> =
            inv.lines.iter().map(|l| InvoiceLine { stored: None, ..l.clone() }).collect();
        assert_eq!(back, vec![line.clone()]);
        assert_eq!(inv.subtotal(), 127_500, "linjebeløb stemmer med tt-data");
        assert_eq!(inv.vat(), Some(31_875));
        assert_eq!(inv.due, inv.issued + Duration::days(14));
    }

    /// En linje, som web gemte den: 20 min er 0,33 t, og beløbet er
    /// `roundMoney(0,33 × 1.000)`.
    fn web_line(hours: &str, price: &str, amount: &str) -> td::InvoiceLine {
        td::InvoiceLine {
            id: Some("l1".into()),
            description: "Møde".into(),
            quantity: d(hours),
            unit_price: d(price),
            amount: d(amount),
            time_entry_id: Some("e1".into()),
            sort_order: 0,
        }
    }

    #[test]
    fn linje_fra_web_beholder_beloebet() {
        let l = invoice_line(&web_line("0.33", "1000", "330.00"));
        assert_eq!(l.minutes, 20);
        // Før: 20 min × 1.000 kr./t = 333,33 kr., ikke web's 330,00.
        assert_eq!(l.amount(), 33_000);
    }

    #[test]
    fn uaendret_linje_gemmes_med_webs_tal() {
        let mut l = invoice_line(&web_line("0.33", "1000", "330.00"));
        l.description = "Møde med kunden".into();
        let dl = to_data_line(&l, 0, Some("e1".into()), l.minutes);
        assert_eq!(dl.quantity, d("0.33"), "web's antal, ikke 0,3333");
        assert_eq!(dl.amount, d("330.00"));
        assert_eq!(dl.description, "Møde med kunden");

        // Rettes tiden, regnes beløbet forfra.
        l.minutes = 30;
        assert_eq!(l.amount(), 50_000);
        let dl = to_data_line(&l, 0, Some("e1".into()), l.minutes);
        assert_eq!(dl.quantity, d("0.5"));
        assert_eq!(dl.amount, d("500.00"));

        // Og satsen.
        let mut l = invoice_line(&web_line("0.33", "1000", "330.00"));
        l.rate = 120_000;
        assert_eq!(l.amount(), 40_000);
    }

    #[test]
    fn negativ_linje_runder_som_positiv() {
        let line = |rate| InvoiceLine {
            description: "Kreditnota".into(),
            minutes: 1,
            rate,
            entry_ids: vec![],
            stored: None,
        };
        // 100 kr./t i 1 min = 1,666… kr.
        assert_eq!(line(10_000).amount(), 167);
        assert_eq!(line(-10_000).amount(), -167, "før: -166 (heltalsdivision mod nul)");
        let dl = to_data_line(&line(-10_000), 0, None, 1);
        assert_eq!(dl.amount, -d("1.67"));
    }

    #[test]
    fn webs_fakturatal_i_oere() {
        let t = td::InvoiceTotals {
            subtotal: d("2380.00"),
            vat_rate: d("12.50"),
            vat_amount: d("297.50"),
            total: d("2677.50"),
            show_vat: true,
            currency: "DKK".into(),
        };
        let w = web_invoice_totals(&t);
        assert_eq!((w.subtotal, w.vat, w.total, w.vat_permille, w.show_vat), (238_000, 29_750, 267_750, 125, true));
    }

    /// Fejl fra web's PDF og tal: dansk tekst, der ikke lover, at noget sendes
    /// senere (intet er i køen), og 403 = fakturamodulet er slået fra.
    #[test]
    fn webs_pdf_og_tal_fejl_paa_dansk() {
        let txt = |e, part| web_invoice_error(e, part).to_string();
        let offline = txt(td::DataError::Offline, WebInvoicePart::Pdf);
        assert!(offline.starts_with("Ingen forbindelse til"), "{offline}");
        assert!(offline.contains("PDF'en hentes fra web"), "{offline}");
        assert!(!offline.contains("sendes"), "intet ligger i køen: {offline}");
        assert!(txt(td::DataError::Timeout, WebInvoicePart::Totals).contains("Momsen og totalen hentes fra web"));
        let forbidden = td::DataError::Rejected {
            code: "FORBIDDEN".into(),
            message: "Ingen adgang".into(),
            app_code: None,
            status: 403,
        };
        assert_eq!(
            txt(forbidden, WebInvoicePart::Pdf),
            "PDF'en kan ikke hentes: fakturaer er slået fra i web, eller din rolle har ikke adgang til dem"
        );
        assert!(
            txt(td::DataError::InvalidResponse("html".into()), WebInvoicePart::Pdf).contains("sendte ikke en PDF")
        );
        let too_many = td::DataError::Rejected {
            code: "TOO_MANY_REQUESTS".into(),
            message: "For mange forsøg".into(),
            app_code: None,
            status: 429,
        };
        let too_many = txt(too_many, WebInvoicePart::Pdf);
        assert!(too_many.contains("for mange forsøg"), "{too_many}");
        assert!(!too_many.contains("sendte ikke en PDF"), "{too_many}");
        assert_eq!(
            web_invoice_error(td::DataError::Unauthorized, WebInvoicePart::Pdf),
            BackendError::Unauthorized
        );
    }

    #[test]
    fn cloud_faktura_kender_ikke_momsen() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 22).unwrap();
        let raw = td::Invoice {
            id: "i1".into(),
            invoice_number: "INV-007".into(),
            client_id: "k1".into(),
            status: td::InvoiceStatus::Sent,
            amount: d("10000"),
            ..td::Invoice::default()
        };
        let line = web_line("10", "1000", "10000.00");
        let cloud = invoice(&raw, std::slice::from_ref(&line), today, None);
        assert_eq!(cloud.subtotal(), 1_000_000);
        assert_eq!(cloud.vat(), None);
        assert_eq!(cloud.total(), 1_000_000, "som web's liste: beløbet ekskl. moms");
        let header = invoice_header(&raw, today, None);
        assert_eq!(header.total(), 1_000_000);

        let local = invoice(&raw, &[line], today, Some(VAT_PERMILLE));
        assert_eq!(local.vat(), Some(250_000));
        assert_eq!(local.total(), 1_250_000);
    }

    #[test]
    fn opgave_med_frist_og_estimat() {
        let t = task(&td::Task {
            id: "t".into(),
            project_id: Some("p".into()),
            title: "Skriv".into(),
            status: td::TaskStatus::InProgress,
            deadline: Some(date_to_noon_utc(
                NaiveDate::from_ymd_opt(2026, 11, 3).unwrap(),
            )),
            tracked_minutes: Some(45),
            estimated_minutes: Some(120),
            ..td::Task::default()
        });
        assert_eq!(t.due, NaiveDate::from_ymd_opt(2026, 11, 3));
        assert_eq!((t.logged_minutes, t.estimate_minutes), (45, Some(120)));
        let n = new_task(&TaskInput {
            project_id: "p".into(),
            title: " Ny ".into(),
            due: NaiveDate::from_ymd_opt(2026, 11, 3),
            estimate_minutes: Some(30),
            ..TaskInput::default()
        });
        assert_eq!(n.title, "Ny");
        assert_eq!(n.estimated_minutes, Some(30));
        assert_eq!(n.status, td::TaskStatus::Todo);
    }

    #[test]
    fn rapport_raekker_i_oere_og_minutter() {
        let range = crate::backend::DateRange::day(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
        let r = report(
            &td::Report {
                rows: vec![td::ReportRow {
                    key: "k1".into(),
                    label: "Kunde".into(),
                    hours: d("2.5"),
                    billable_hours: d("2"),
                    amount: d("1700.00"),
                    entry_count: 3,
                }],
                ..td::Report::default()
            },
            range,
            ReportGrouping::Customer,
        );
        assert_eq!(r.total_minutes(), 150);
        assert_eq!(r.rows[0].billable_minutes, 120);
        assert_eq!(r.rows[0].amount, 170_000);
    }

    #[test]
    fn fejl_paa_dansk() {
        use td::DataError as D;
        assert_eq!(error(D::Offline, "x"), BackendError::Offline);
        assert_eq!(error(D::Unauthorized, "x"), BackendError::Unauthorized);
        assert_eq!(
            error(D::NotFound, "Kunden"),
            BackendError::NotFound("Kunden".into())
        );
        assert_eq!(
            error(D::Validation("Navn er påkrævet".into()), "x"),
            BackendError::Validation("Navn er påkrævet".into())
        );
        assert_eq!(
            error(D::Unsupported("Faktura kan ikke sendes lokalt".into()), "x"),
            BackendError::Validation("Faktura kan ikke sendes lokalt".into())
        );
        assert_eq!(
            error(
                D::Conflict {
                    reason: "already_running".into()
                },
                "x"
            ),
            BackendError::Conflict("timeren kører allerede".into())
        );
        let rejected = |code: &str| D::Rejected {
            code: code.into(),
            message: "Besked".into(),
            app_code: None,
            status: 403,
        };
        assert_eq!(
            error(rejected("FORBIDDEN"), "x"),
            BackendError::PlanLimit("Besked".into())
        );
        assert_eq!(
            error(rejected("BAD_REQUEST"), "x"),
            BackendError::Validation("Besked".into())
        );
        assert_eq!(
            error(rejected("CONFLICT"), "x"),
            BackendError::Conflict("Besked".into())
        );
        assert_eq!(
            error(rejected("NOT_FOUND"), "Posten"),
            BackendError::NotFound("Posten".into())
        );
        assert_eq!(
            error(rejected("INTERNAL_SERVER_ERROR"), "x"),
            BackendError::Other("Besked".into())
        );
        assert!(matches!(error(D::Timeout, "x"), BackendError::Other(m) if m.contains("lang tid")));
        assert!(
            matches!(error(D::Server { status: 502 }, "x"), BackendError::Other(m) if m.contains("502"))
        );
        assert!(matches!(
            error(D::MissingProcedure("klippekort".into()), "x"),
            BackendError::Other(m) if m.contains("klippekort")
        ));
        assert!(matches!(
            error(D::Auth("udløb".into()), "x"),
            BackendError::Validation(m) if m.contains("Login mislykkedes")
        ));
        assert!(
            matches!(error(D::Storage("låst".into()), "x"), BackendError::Other(m) if m.contains("låst"))
        );
    }
}

/// Lille hjælper til tests: `d("1.5")` er `Decimal` uden makro-crate.
#[cfg(test)]
mod testutil {
    use rust_decimal::Decimal;
    use std::str::FromStr;

    pub fn d(s: &str) -> Decimal {
        Decimal::from_str(s).expect("decimal")
    }
}
