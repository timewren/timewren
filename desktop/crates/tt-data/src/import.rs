//! Lokal → cloud (spec A5, D7): ét klik flytter alle lokale data op i web,
//! når man opretter en konto.
//!
//! 1. [`export_local`] læser hele den lokale model til et [`ExportBundle`].
//! 2. [`dry_run`] laver rapporten (antal, timer, advarsler) uden netværk.
//! 3. [`CloudRepo::import_bundle`] sender bundtet til web, først med
//!    `dryRun: true` (serverens rapport), så rigtigt.
//!
//! Idempotens: hver række har en `importKey` (enheds-id + lokalt id), og
//! poster har desuden `clientEntryId`. Et afbrudt eller gentaget import
//! opretter aldrig dubletter. Rå aktivitet er ikke med (D3).
//
//
// Web's `extension.import.run` tager ikke bundtet direkte, men
// `{ dryRun, clients, projects, prepaidPackages, tasks, entries, rules,
// invoices }`, hvor hvert element har `localId` (det lokale id), web's
// create-input i `data` og lokale referencer (`clientLocalId` …).
// Fakturaer har deres linjer med (`lines`), og arkiverede klippekort
// `isArchived` (kun i sidste kald). Se [`server_batches`].

use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::cloud::CloudRepo;
use crate::error::{DataError, Result};
use crate::local::LocalRepo;
use crate::local::sql::{CLIENTS, ENTRIES, INVOICE_LINES, INVOICES, PREPAID, PROJECTS, RULES, TASKS};
use crate::model::*;

pub const EXPORT_FORMAT: &str = "timetrack-desktop-export";
pub const EXPORT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyed<T> {
    /// Stabil nøgle på tværs af gentagne importer: `<enhed>:<type>:<id>`.
    pub import_key: String,
    #[serde(flatten)]
    pub item: T,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedInvoice {
    #[serde(flatten)]
    pub invoice: Invoice,
    pub lines: Vec<InvoiceLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle {
    pub format: String,
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub device_id: String,
    pub clients: Vec<Keyed<Client>>,
    pub projects: Vec<Keyed<Project>>,
    pub klippekort: Vec<Keyed<PrepaidPackage>>,
    pub tasks: Vec<Keyed<Task>>,
    pub time_entries: Vec<Keyed<TimeEntry>>,
    pub invoices: Vec<Keyed<ExportedInvoice>>,
    /// Kun brugerens og lærte regler; projekt-mønstre følger projekterne.
    pub rules: Vec<Keyed<MatchingRule>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportCounts {
    pub clients: usize,
    pub projects: usize,
    pub klippekort: usize,
    pub tasks: usize,
    pub time_entries: usize,
    pub invoices: usize,
    pub rules: usize,
}

impl ImportCounts {
    pub fn total(&self) -> usize {
        self.clients + self.projects + self.klippekort + self.tasks + self.time_entries + self.invoices + self.rules
    }
}

/// Lokal dry-run-rapport.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DryRunReport {
    pub counts: ImportCounts,
    pub total_hours: Decimal,
    pub billed_hours: Decimal,
    pub first_date: Option<chrono::NaiveDate>,
    pub last_date: Option<chrono::NaiveDate>,
    /// Ting, brugeren skal vide (fx at fakturanumre tildeles af web).
    pub warnings: Vec<String>,
    /// Fejl, der stopper importen (fx en post, der peger på et projekt, der
    /// ikke findes).
    pub errors: Vec<String>,
}

impl DryRunReport {
    pub fn can_import(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Resultatet af en import (samme form ved dry-run og rigtig import),
/// samlet fra web's rapport over alle kald.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportResult {
    pub dry_run: bool,
    pub created: ImportCounts,
    /// Allerede importeret i et tidligere kald.
    pub skipped: ImportCounts,
    /// Afvist af web (fx planens grænser); se `errors`.
    pub failed: ImportCounts,
    pub warnings: Vec<String>,
    /// Web's fejl pr. element (de første 200 pr. kald).
    pub errors: Vec<String>,
}

/// Web's svar fra `extension.import.run`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerImportResult {
    pub dry_run: bool,
    pub organization_id: Option<String>,
    pub plan: Option<String>,
    pub report: ServerImportReport,
    pub error_count: usize,
    pub errors: Vec<ServerImportError>,
    pub ids: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerImportReport {
    pub clients: EntityReport,
    pub projects: EntityReport,
    pub prepaid_packages: EntityReport,
    pub tasks: EntityReport,
    pub entries: EntityReport,
    pub rules: EntityReport,
    pub invoices: EntityReport,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EntityReport {
    pub total: usize,
    pub created: usize,
    pub existing: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerImportError {
    /// client | project | prepaid | task | entry | rule | invoice
    pub entity: String,
    pub local_id: String,
    pub message: String,
}

fn keyed<T>(device: &str, kind: &str, id: &str, item: T) -> Keyed<T> {
    Keyed { import_key: format!("{device}:{kind}:{id}"), item }
}

/// Læs hele den lokale model.
pub fn export_local(repo: &LocalRepo, device_id: &str, now: DateTime<Utc>) -> Result<ExportBundle> {
    repo.run_sync(|c| {
        let clients: Vec<Client> = CLIENTS.query(c, "ORDER BY created_at, id", vec![])?;
        let projects: Vec<Project> = PROJECTS.query(c, "ORDER BY created_at, id", vec![])?;
        let klippekort: Vec<PrepaidPackage> = PREPAID.query(c, "ORDER BY purchase_date, id", vec![])?;
        let tasks: Vec<Task> = TASKS.query(c, "ORDER BY created_at, id", vec![])?;
        let entries: Vec<TimeEntry> = ENTRIES.query(c, "ORDER BY date, start_time, created_at, id", vec![])?;
        let invoices: Vec<Invoice> = INVOICES.query(c, "ORDER BY created_at, id", vec![])?;
        let rules: Vec<MatchingRule> = RULES.query(c, "ORDER BY updated_at, id", vec![])?;
        let mut exported_invoices = Vec::with_capacity(invoices.len());
        for inv in invoices {
            let lines: Vec<InvoiceLine> = INVOICE_LINES.query(
                c,
                "WHERE invoice_id = ?1 ORDER BY sort_order",
                vec![crate::local::sql::text(inv.id.clone())],
            )?;
            let id = inv.id.clone();
            exported_invoices.push(keyed(device_id, "invoice", &id, ExportedInvoice { invoice: inv, lines }));
        }
        Ok(ExportBundle {
            format: EXPORT_FORMAT.into(),
            version: EXPORT_VERSION,
            exported_at: now,
            device_id: device_id.into(),
            clients: clients.into_iter().map(|x| keyed(device_id, "client", &x.id.clone(), x)).collect(),
            projects: projects.into_iter().map(|x| keyed(device_id, "project", &x.id.clone(), x)).collect(),
            klippekort: klippekort.into_iter().map(|x| keyed(device_id, "klippekort", &x.id.clone(), x)).collect(),
            tasks: tasks.into_iter().map(|x| keyed(device_id, "task", &x.id.clone(), x)).collect(),
            time_entries: entries
                .into_iter()
                .map(|mut e| {
                    // Posten har altid en idempotensnøgle på serveren.
                    e.client_entry_id.get_or_insert_with(|| e.id.clone());
                    keyed(device_id, "entry", &e.id.clone(), e)
                })
                .collect(),
            invoices: exported_invoices,
            rules: rules
                .into_iter()
                .filter(|r| r.source != RuleSource::Project)
                .map(|x| keyed(device_id, "rule", &x.id.clone(), x))
                .collect(),
        })
    })
}

/// Rapport over, hvad importen vil gøre, uden at sende noget.
pub fn dry_run(bundle: &ExportBundle) -> DryRunReport {
    let mut r = DryRunReport {
        counts: ImportCounts {
            clients: bundle.clients.len(),
            projects: bundle.projects.len(),
            klippekort: bundle.klippekort.len(),
            tasks: bundle.tasks.len(),
            time_entries: bundle.time_entries.len(),
            invoices: bundle.invoices.len(),
            rules: bundle.rules.len(),
        },
        ..DryRunReport::default()
    };
    if bundle.format != EXPORT_FORMAT || bundle.version > EXPORT_VERSION {
        r.errors.push(format!("Ukendt eksportformat {} v{}", bundle.format, bundle.version));
    }
    let ids = |v: Vec<&str>| v.into_iter().map(str::to_owned).collect::<HashSet<String>>();
    let clients = ids(bundle.clients.iter().map(|c| c.item.id.as_str()).collect());
    let projects = ids(bundle.projects.iter().map(|p| p.item.id.as_str()).collect());
    let packages = ids(bundle.klippekort.iter().map(|p| p.item.id.as_str()).collect());
    let tasks = ids(bundle.tasks.iter().map(|t| t.item.id.as_str()).collect());
    let entries = ids(bundle.time_entries.iter().map(|e| e.item.id.as_str()).collect());

    let mut names: BTreeMap<String, usize> = BTreeMap::new();
    for c in &bundle.clients {
        *names.entry(c.item.name.trim().to_lowercase()).or_default() += 1;
    }
    for (name, n) in names.into_iter().filter(|(_, n)| *n > 1) {
        r.warnings.push(format!("{n} kunder hedder \"{name}\". De importeres hver for sig"));
    }
    for p in &bundle.projects {
        if let Some(c) = &p.item.client_id
            && !clients.contains(c)
        {
            r.errors.push(format!("Projektet \"{}\" peger på en kunde, der ikke findes", p.item.name));
        }
    }
    for k in &bundle.klippekort {
        if !clients.contains(&k.item.client_id) {
            r.errors.push(format!("Klippekortet \"{}\" peger på en kunde, der ikke findes", k.item.name));
        }
    }
    for t in &bundle.tasks {
        let x = &t.item;
        if x.project_id.as_ref().is_some_and(|p| !projects.contains(p))
            || x.client_id.as_ref().is_some_and(|c| !clients.contains(c))
        {
            r.errors.push(format!("Opgaven \"{}\" peger på noget, der ikke findes", x.title));
        }
    }
    for rule in &bundle.rules {
        let x = &rule.item;
        if x.project_id.as_ref().is_some_and(|p| !projects.contains(p))
            || x.client_id.as_ref().is_some_and(|c| !clients.contains(c))
        {
            r.errors.push(format!("Reglen \"{}\" peger på noget, der ikke findes", x.pattern));
        }
    }
    let mut no_target = 0;
    let mut long = 0;
    for e in &bundle.time_entries {
        let x = &e.item;
        r.total_hours += x.hours;
        if x.is_billed.unwrap_or(false) {
            r.billed_hours += x.hours;
        }
        r.first_date = Some(r.first_date.map_or(x.date, |d| d.min(x.date)));
        r.last_date = Some(r.last_date.map_or(x.date, |d| d.max(x.date)));
        let dangling = x.client_id.as_ref().is_some_and(|c| !clients.contains(c))
            || x.project_id.as_ref().is_some_and(|p| !projects.contains(p))
            || x.prepaid_package_id.as_ref().is_some_and(|p| !packages.contains(p))
            || x.task_id.as_ref().is_some_and(|t| !tasks.contains(t));
        if dangling {
            r.errors.push(format!(
                "Posten \"{}\" ({}) peger på noget, der ikke findes",
                x.description.as_deref().unwrap_or(""),
                x.date
            ));
        }
        if x.client_id.is_none() && x.project_id.is_none() {
            no_target += 1;
        }
        if x.hours > Decimal::from(24) {
            long += 1;
        }
        if x.description.as_deref().is_none_or(|d| d.trim().is_empty()) {
            r.errors.push(format!("En post fra {} mangler beskrivelse", x.date));
        }
    }
    if no_target > 0 {
        r.warnings.push(format!("{no_target} poster har hverken kunde eller projekt"));
    }
    if long > 0 {
        r.warnings.push(format!("{long} poster er længere end 24 timer"));
    }
    for i in &bundle.invoices {
        for l in &i.item.lines {
            if let Some(e) = &l.time_entry_id
                && !entries.contains(e)
            {
                r.errors.push(format!("En linje på faktura {} peger på en post, der ikke findes", i.item.invoice.invoice_number));
            }
        }
    }
    if bundle.invoices.iter().any(|i| i.item.invoice.status != InvoiceStatus::Draft) {
        r.warnings.push("Fakturanumre tildeles af web, så udstedte fakturaer kan få nye numre".into());
    }
    r
}

/// Poster pr. kald (web tager højst 2.000; 1.200 poster tager ca. 45 s).
/// En faktura med flere poster end dette sendes alligevel samlet.
pub const ENTRIES_PER_CALL: usize = 500;

fn put(m: &mut Map<String, Value>, key: &str, v: Option<Value>) {
    if let Some(v) = v {
        m.insert(key.into(), v);
    }
}

fn opt_str(v: &Option<String>) -> Option<Value> {
    v.as_deref().map(str::trim).filter(|x| !x.is_empty()).map(|x| json!(x))
}

fn money(d: Option<Decimal>) -> Option<Value> {
    d.map(|d| json!(crate::serde_util::money_string(d)))
}

fn number(d: Decimal) -> Value {
    json!(d.round_dp(2).to_string().parse::<f64>().unwrap_or(0.0))
}

fn day(d: Option<DateTime<Utc>>) -> Option<Value> {
    d.map(|d| json!(d.with_timezone(&chrono::Local).date_naive().format("%Y-%m-%d").to_string()))
}

fn client_item(c: &Client) -> Value {
    let mut d = Map::new();
    d.insert("name".into(), json!(c.name));
    put(&mut d, "email", opt_str(&c.email));
    put(&mut d, "phone", opt_str(&c.phone));
    put(&mut d, "company", opt_str(&c.company));
    put(&mut d, "address", opt_str(&c.address));
    put(&mut d, "city", opt_str(&c.city));
    put(&mut d, "postalCode", opt_str(&c.postal_code));
    put(&mut d, "country", opt_str(&c.country));
    put(&mut d, "cvrNumber", opt_str(&c.cvr_number));
    put(&mut d, "notes", opt_str(&c.notes));
    put(&mut d, "defaultHourlyRate", money(c.default_hourly_rate));
    put(&mut d, "paymentTermsDays", c.payment_terms_days.map(|x| json!(x)));
    put(&mut d, "color", opt_str(&c.color));
    if !c.domains.is_empty() {
        d.insert("domains".into(), json!(c.domains));
    }
    if c.rounding_enabled == Some(true) && c.rounding_minutes.is_some() && c.rounding_method.is_some() {
        d.insert("roundingEnabled".into(), json!(true));
        d.insert("roundingMinutes".into(), json!(c.rounding_minutes));
        d.insert("roundingMethod".into(), json!(c.rounding_method));
    }
    d.insert("defaultBillable".into(), json!(c.default_billable));
    json!({ "localId": c.id, "isArchived": c.archived(), "data": d })
}

fn project_item(p: &Project) -> Value {
    let mut d = Map::new();
    d.insert("name".into(), json!(p.name));
    put(&mut d, "description", opt_str(&p.description));
    put(&mut d, "hourlyRate", money(p.hourly_rate));
    put(&mut d, "fixedPrice", money(p.fixed_price));
    put(&mut d, "monthlyBudgetHours", money(p.monthly_budget_hours));
    put(&mut d, "budgetHours", money(p.budget_hours));
    d.insert("status".into(), json!(p.status.as_str()));
    put(&mut d, "startDate", p.start_date.map(|t| json!(t.to_rfc3339())));
    put(&mut d, "endDate", p.end_date.map(|t| json!(t.to_rfc3339())));
    if !p.url_patterns.is_empty() {
        d.insert("urlPatterns".into(), json!(p.url_patterns));
    }
    json!({ "localId": p.id, "clientLocalId": p.client_id, "data": d })
}

fn prepaid_item(k: &PrepaidPackage) -> Value {
    let mut d = Map::new();
    d.insert("name".into(), json!(k.name));
    d.insert("totalHours".into(), number(k.total_hours));
    d.insert("hourlyRate".into(), number(k.hourly_rate));
    d.insert("purchaseDate".into(), day(k.purchase_date).unwrap_or_else(|| json!("2026-01-01")));
    put(&mut d, "expiryDate", day(k.expiry_date));
    put(&mut d, "description", opt_str(&k.description));
    put(&mut d, "clipSizeMinutes", k.clip_size_minutes.map(|x| json!(x)));
    put(&mut d, "overdraftPolicy", opt_str(&k.overdraft_policy));
    put(&mut d, "overdraftRate", k.overdraft_rate.map(number));
    d.insert("autoDeduct".into(), json!(k.auto_deduct));
    json!({ "localId": k.id, "clientLocalId": k.client_id, "data": d })
}

fn entry_item(e: &TimeEntry) -> Value {
    let mut d = Map::new();
    d.insert("description".into(), json!(e.description.as_deref().unwrap_or("").trim()));
    put(&mut d, "notes", opt_str(&e.notes));
    d.insert("hours".into(), number(e.hours));
    d.insert("date".into(), json!(e.date.format("%Y-%m-%d").to_string()));
    put(&mut d, "startTime", e.start_time.map(|t| json!(t.to_rfc3339())));
    put(&mut d, "endTime", e.end_time.map(|t| json!(t.to_rfc3339())));
    put(&mut d, "isBillable", e.is_billable.map(|x| json!(x)));
    put(&mut d, "billableRate", money(e.billable_rate));
    if e.start_time.is_some() && e.source.as_deref() == Some("timer") {
        d.insert("fromTimer".into(), json!(true));
    }
    json!({
        "localId": e.id,
        "projectLocalId": e.project_id,
        "clientLocalId": e.client_id,
        "prepaidLocalId": e.prepaid_package_id,
        "taskLocalId": e.task_id,
        "data": d,
    })
}

const TASK_PRIORITIES: [&str; 4] = ["low", "medium", "high", "urgent"];

/// Web's `tasks.create` uden projekt og kunde (de er lokale referencer).
/// Underopgaver importeres som almindelige opgaver (web's `parentTaskId` er
/// et server-id, importen har ingen lokal reference til den).
fn task_item(t: &Task) -> Value {
    let mut d = Map::new();
    let title: String = t.title.trim().chars().take(255).collect();
    d.insert("title".into(), json!(if title.is_empty() { "Uden titel".to_owned() } else { title }));
    put(&mut d, "description", opt_str(&t.description));
    d.insert("status".into(), json!(t.status.as_str()));
    if let Some(p) = t.priority.as_deref().filter(|p| TASK_PRIORITIES.contains(p)) {
        d.insert("priority".into(), json!(p));
    }
    // Sendes som superjson-Date (`z.date()`), se `CloudRepo::import_call`.
    put(&mut d, "deadline", t.deadline.map(|x| json!(x.to_rfc3339())));
    put(&mut d, "estimatedMinutes", t.estimated_minutes.filter(|m| *m > 0).map(|m| json!(m)));
    json!({ "localId": t.id, "projectLocalId": t.project_id, "clientLocalId": t.client_id, "data": d })
}

/// En regel uden mål kan kun importeres som "ikke arbejde".
fn rule_importable(r: &MatchingRule) -> bool {
    r.not_work || r.project_id.is_some() || r.client_id.is_some()
}

/// Web's regel (`kind`, `pattern`, lokale mål eller `notWork`). "Ikke
/// arbejde" vinder over et mål (web afviser begge på én gang).
fn rule_item(r: &MatchingRule) -> Value {
    let mut m = Map::new();
    m.insert("localId".into(), json!(r.id));
    m.insert("kind".into(), json!(crate::cloud::wire::rule_kind_to_web(r.kind)));
    m.insert("pattern".into(), json!(r.pattern.trim().chars().take(500).collect::<String>()));
    if r.not_work {
        m.insert("notWork".into(), json!(true));
    } else {
        put(&mut m, "projectLocalId", opt_str(&r.project_id));
        put(&mut m, "clientLocalId", opt_str(&r.client_id));
    }
    m.insert("usageCount".into(), json!(r.confirmations.max(0)));
    put(&mut m, "lastUsedAt", r.updated_at.map(|t| json!(t.to_rfc3339())));
    Value::Object(m)
}

/// Fakturalinjer i web's form (beløb som strenge). Linjens post er en lokal
/// reference (`entryLocalId`).
fn line_item(l: &InvoiceLine) -> Value {
    let description = l.description.trim();
    let mut m = Map::new();
    m.insert("description".into(), json!(if description.is_empty() { "Linje" } else { description }));
    m.insert("quantity".into(), json!(crate::serde_util::money_string(l.quantity)));
    m.insert("unitPrice".into(), json!(crate::serde_util::money_string(l.unit_price)));
    m.insert("amount".into(), json!(crate::serde_util::money_string(l.amount)));
    put(&mut m, "entryLocalId", opt_str(&l.time_entry_id));
    Value::Object(m)
}

fn invoice_item(i: &ExportedInvoice) -> Value {
    let inv = &i.invoice;
    let mut entry_ids: Vec<&str> = i.lines.iter().filter_map(|l| l.time_entry_id.as_deref()).collect();
    entry_ids.dedup();
    let mut d = Map::new();
    // Med linjer skal beløbet være linjernes sum (web tjekker det).
    let amount = if i.lines.is_empty() { inv.amount } else { i.lines.iter().map(|l| l.amount.round_dp(2)).sum() };
    d.insert("amount".into(), json!(crate::serde_util::money_string(amount)));
    d.insert("issueDate".into(), day(inv.issue_date.or(inv.created_at)).unwrap_or_else(|| json!("2026-01-01")));
    let status = match inv.status {
        InvoiceStatus::Draft | InvoiceStatus::Sent | InvoiceStatus::Paid | InvoiceStatus::Overdue => inv.status.as_str(),
        InvoiceStatus::Deleted | InvoiceStatus::Other => "sent",
    };
    d.insert("status".into(), json!(status));
    put(&mut d, "dueDate", day(inv.due_date));
    put(&mut d, "notes", opt_str(&inv.notes));
    let mut m = Map::new();
    m.insert("localId".into(), json!(inv.id));
    m.insert("clientLocalId".into(), json!(inv.client_id));
    m.insert("entryLocalIds".into(), json!(entry_ids));
    put(&mut m, "invoiceNumber", opt_str(&Some(inv.invoice_number.clone())));
    put(&mut m, "paidDate", day(inv.paid_date));
    if !i.lines.is_empty() {
        m.insert("lines".into(), Value::Array(i.lines.iter().map(line_item).collect()));
    }
    m.insert("data".into(), Value::Object(d));
    Value::Object(m)
}

/// Web's grænser pr. kald (`ext/import.ts`).
pub const MAX_CLIENTS: usize = 1000;
pub const MAX_PROJECTS: usize = 2000;
pub const MAX_PREPAID: usize = 1000;
pub const MAX_TASKS: usize = 2000;
pub const MAX_RULES: usize = 2000;
pub const MAX_INVOICES_PER_CALL: usize = 500;

/// Bundtet i web's form, delt i kald. Kunder, projekter, klippekort,
/// opgaver og regler sendes i hvert kald (web genkender dem, og ved dry-run
/// kender et kald kun sine egne id'er). En faktura sendes i samme kald som
/// sine poster; resten af posterne i bidder á [`ENTRIES_PER_CALL`].
/// Arkiverede klippekort får `isArchived` i sidste kald (web arkiverer efter
/// kaldets poster, og et arkiveret kort kan ikke trækkes på).
pub fn server_batches(bundle: &ExportBundle, dry_run: bool) -> Result<Vec<Value>> {
    if bundle.clients.len() > MAX_CLIENTS
        || bundle.projects.len() > MAX_PROJECTS
        || bundle.klippekort.len() > MAX_PREPAID
        || bundle.tasks.len() > MAX_TASKS
        || bundle.rules.len() > MAX_RULES
    {
        return Err(DataError::Validation(format!(
            "Web kan højst tage {MAX_CLIENTS} kunder, {MAX_PROJECTS} projekter, {MAX_PREPAID} klippekort, {MAX_TASKS} opgaver og {MAX_RULES} regler i én import"
        )));
    }
    let clients: Vec<Value> = bundle.clients.iter().map(|k| client_item(&k.item)).collect();
    let projects: Vec<Value> = bundle.projects.iter().map(|k| project_item(&k.item)).collect();
    let prepaid: Vec<Value> = bundle.klippekort.iter().map(|k| prepaid_item(&k.item)).collect();
    let prepaid_last: Vec<Value> = bundle
        .klippekort
        .iter()
        .map(|k| {
            let mut v = prepaid_item(&k.item);
            if k.item.is_archived.unwrap_or(false) {
                v["isArchived"] = json!(true);
            }
            v
        })
        .collect();
    let tasks: Vec<Value> = bundle.tasks.iter().map(|k| task_item(&k.item)).collect();
    let rules: Vec<Value> =
        bundle.rules.iter().filter(|k| rule_importable(&k.item)).map(|k| rule_item(&k.item)).collect();
    let entry_by_id: BTreeMap<&str, &TimeEntry> =
        bundle.time_entries.iter().map(|k| (k.item.id.as_str(), &k.item)).collect();

    // (poster, fakturaer) pr. kald
    let mut chunks: Vec<(Vec<Value>, Vec<Value>)> = Vec::new();
    let mut placed: HashSet<&str> = HashSet::new();
    let mut cur: (Vec<Value>, Vec<Value>) = (Vec::new(), Vec::new());
    for k in bundle.invoices.iter().filter(|k| k.item.invoice.amount > Decimal::ZERO) {
        let mine: Vec<&TimeEntry> = k
            .item
            .lines
            .iter()
            .filter_map(|l| l.time_entry_id.as_deref())
            .filter(|id| placed.insert(id))
            .filter_map(|id| entry_by_id.get(id).copied())
            .collect();
        if !cur.1.is_empty()
            && (cur.0.len() + mine.len() > ENTRIES_PER_CALL || cur.1.len() >= MAX_INVOICES_PER_CALL)
        {
            chunks.push(std::mem::take(&mut cur));
        }
        cur.0.extend(mine.into_iter().map(entry_item));
        cur.1.push(invoice_item(&k.item));
    }
    if !cur.1.is_empty() {
        chunks.push(std::mem::take(&mut cur));
    }
    let rest: Vec<Value> =
        bundle
            .time_entries
            .iter()
            .filter(|k| !placed.contains(k.item.id.as_str()))
            .map(|k| {
                let mut v = entry_item(&k.item);
                // Faktureret, men ikke på en faktura, der importeres (fx en
                // kreditnota eller markeret manuelt): ellers ville web vise
                // posten som ufaktureret, og den kunne faktureres igen.
                if k.item.is_billed == Some(true) {
                    v["data"]["isBilled"] = json!(true);
                }
                v
            })
            .collect();
    chunks.extend(rest.chunks(ENTRIES_PER_CALL).map(|c| (c.to_vec(), Vec::new())));
    if chunks.is_empty() {
        chunks.push((Vec::new(), Vec::new()));
    }
    let last = chunks.len() - 1;
    Ok(chunks
        .into_iter()
        .enumerate()
        .map(|(n, (entries, invoices))| {
            json!({
                "dryRun": dry_run,
                "clients": clients,
                "projects": projects,
                "prepaidPackages": if n == last { &prepaid_last } else { &prepaid },
                "tasks": tasks,
                "entries": entries,
                "rules": rules,
                "invoices": invoices,
            })
        })
        .collect())
}

/// Web's rapporter fra alle kald → én samlet. Kunder, projekter,
/// klippekort, opgaver og regler tælles fra første kald (de næste ser dem
/// som "findes"), poster og fakturaer fra alle kald.
pub fn merge_results(bundle: &ExportBundle, dry_run: bool, results: &[ServerImportResult]) -> ImportResult {
    let mut out = ImportResult { dry_run, ..ImportResult::default() };
    let Some(first) = results.first() else { return out };
    let set = |c: &mut ImportCounts, f: &dyn Fn(&EntityReport) -> usize| {
        c.clients = f(&first.report.clients);
        c.projects = f(&first.report.projects);
        c.klippekort = f(&first.report.prepaid_packages);
        c.tasks = f(&first.report.tasks);
        c.rules = f(&first.report.rules);
        c.time_entries = results.iter().map(|r| f(&r.report.entries)).sum();
        c.invoices = results.iter().map(|r| f(&r.report.invoices)).sum();
    };
    set(&mut out.created, &|r| r.created);
    set(&mut out.skipped, &|r| r.existing);
    set(&mut out.failed, &|r| r.failed);
    let mut seen = HashSet::new();
    for r in results {
        for e in &r.errors {
            let msg = format!("{} {}: {}", e.entity, e.local_id, e.message);
            if seen.insert(msg.clone()) {
                out.errors.push(msg);
            }
        }
    }
    let skipped_invoices = bundle.invoices.iter().filter(|k| k.item.invoice.amount <= Decimal::ZERO).count();
    if skipped_invoices > 0 {
        out.warnings.push(format!(
            "{skipped_invoices} fakturaer uden positivt beløb (fx kreditnotaer) kan ikke importeres til web"
        ));
    }
    let subtasks = bundle.tasks.iter().filter(|k| k.item.parent_task_id.is_some()).count();
    if subtasks > 0 {
        out.warnings.push(format!("{subtasks} underopgaver importeres som almindelige opgaver"));
    }
    let untargeted = bundle.rules.iter().filter(|k| !rule_importable(&k.item)).count();
    if untargeted > 0 {
        out.warnings.push(format!("{untargeted} regler uden kunde eller projekt kommer ikke med"));
    }
    out
}

impl CloudRepo {
    /// Send bundtet til web. Kør altid først med `dry_run: true`.
    pub async fn import_bundle(&self, bundle: &ExportBundle, dry_run: bool) -> Result<ImportResult> {
        let local = self::dry_run(bundle);
        if !local.can_import() {
            return Err(DataError::Validation(local.errors.join("; ")));
        }
        let mut results = Vec::new();
        for body in server_batches(bundle, dry_run)? {
            results.push(self.import_call(body).await?);
        }
        Ok(merge_results(bundle, dry_run, &results))
    }
}
