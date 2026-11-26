//! `LocalRepo`: lokal tilstand uden konto (spec D5/D6). Egen SQLite med hele
//! forretningsmodellen og samme adfærd som web: idempotens på
//! `clientEntryId`, klippekort-træk ved oprettelse, faktureret-lås, én timer.
//! Forretningsregler går gennem [`BusinessRules`] (tt-core senere).

// gendan: backup og gendannelse.
pub mod backup;
pub(crate) mod migrations;
pub(crate) mod sql;

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Local, NaiveDate, Utc};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension};
use rusqlite::types::Value as SqlValue;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::{DataError, Result};
use crate::events::{Entity, Event, Events, LogoutReason};
use crate::model::*;
use crate::repo::Repository;
use crate::report::{Names, build_report};
use crate::core_rules::CoreRules;
use crate::rules::BusinessRules;
use sql::*;

pub type Clock = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;

struct Inner {
    conn: Mutex<Connection>,
    rules: Arc<dyn BusinessRules>,
    device: DeviceInfo,
    events: Events,
    clock: Clock,
}

#[derive(Clone)]
pub struct LocalRepo {
    inner: Arc<Inner>,
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

impl LocalRepo {
    /// Åbn (eller opret) databasen og kør manglende migrationer.
    pub fn open(path: impl AsRef<Path>, device: DeviceInfo) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::from_connection(conn, device, Arc::new(CoreRules))
    }

    pub fn in_memory(device: DeviceInfo) -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?, device, Arc::new(CoreRules))
    }

    pub fn from_connection(
        mut conn: Connection,
        device: DeviceInfo,
        rules: Arc<dyn BusinessRules>,
    ) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations::migrate(&mut conn)?;
        Ok(LocalRepo {
            inner: Arc::new(Inner {
                conn: Mutex::new(conn),
                rules,
                device,
                events: Events::new(),
                clock: Arc::new(Utc::now),
            }),
        })
    }

    /// Udskift forretningsreglerne (tt-core) eller uret (tests).
    pub fn with_rules(self, rules: Arc<dyn BusinessRules>) -> Self {
        self.rebuild(Some(rules), None)
    }

    pub fn with_clock(self, clock: Clock) -> Self {
        self.rebuild(None, Some(clock))
    }

    fn rebuild(self, rules: Option<Arc<dyn BusinessRules>>, clock: Option<Clock>) -> Self {
        let inner = Arc::try_unwrap(self.inner)
            .unwrap_or_else(|_| panic!("with_rules/with_clock skal kaldes før repo'et deles"));
        LocalRepo {
            inner: Arc::new(Inner {
                rules: rules.unwrap_or(inner.rules),
                clock: clock.unwrap_or(inner.clock),
                ..inner
            }),
        }
    }

    /// Kør et stykke databasearbejde på blocking-trådpuljen.
    async fn run<T, F>(&self, f: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&Inner, &mut Connection) -> Result<T> + Send + 'static,
    {
        let inner = self.inner.clone();
        blocking::unblock(move || {
            let mut conn = inner.conn.lock();
            f(&inner, &mut conn)
        })
        .await
    }

    /// Kør synkront (import, tests og mock-serveren).
    pub fn run_sync<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut conn = self.inner.conn.lock();
        f(&mut conn)
    }

    /// Kortets træk fra `prepaid_usage` i web's form, nyeste først. Bruges af
    /// mock-serveren til `klippekort.get` (`usageHistory`); `LocalRepo`'s egen
    /// `klippekort_usage` er bevidst ikke implementeret (UI'et udleder den).
    pub fn usage_history(&self, package_id: &str) -> Result<Vec<PrepaidUsage>> {
        self.run_sync(|c| {
            let mut stmt = c.prepare(
                "SELECT u.id, u.time_entry_id, u.hours_used, u.overdraft_hours, u.value_used, u.created_at,
                        e.description, e.date
                 FROM prepaid_usage u LEFT JOIN time_entries e ON e.id = u.time_entry_id
                 WHERE u.prepaid_package_id = ?1 ORDER BY u.created_at DESC, u.rowid DESC",
            )?;
            let dec = |s: String| s.parse::<Decimal>().unwrap_or_default();
            let rows = stmt
                .query_map([package_id], |r| {
                    let entry_id: Option<String> = r.get(1)?;
                    let date: Option<String> = r.get(7)?;
                    let created: Option<String> = r.get(5)?;
                    Ok(PrepaidUsage {
                        id: r.get(0)?,
                        time_entry: match (&entry_id, date.as_deref().and_then(crate::serde_util::parse_entry_date)) {
                            (Some(id), Some(date)) => Some(UsageEntry { id: id.clone(), description: r.get(6)?, date }),
                            _ => None,
                        },
                        time_entry_id: entry_id,
                        hours_used: dec(r.get(2)?),
                        overdraft_hours: dec(r.get(3)?),
                        value_used: dec(r.get(4)?),
                        description: None,
                        created_at: created
                            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                            .map(|d| d.with_timezone(&Utc)),
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.run_sync(|c| {
            c.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [key, value],
            )?;
            Ok(())
        })
    }

    /// Afsender og nummerering på fakturaer. Standard, hvis den aldrig er gemt.
    pub fn invoice_profile(&self) -> Result<InvoiceProfile> {
        self.run_sync(|c| Ok(invoice_profile_of(c)?.unwrap_or_default()))
    }

    /// `true`, når brugeren har gemt en fakturaopsætning.
    pub fn has_invoice_profile(&self) -> Result<bool> {
        self.run_sync(|c| Ok(invoice_profile_of(c)?.is_some()))
    }

    pub fn save_invoice_profile(&self, profile: InvoiceProfile) -> Result<InvoiceProfile> {
        profile.validate().map_err(DataError::Validation)?;
        let json = serde_json::to_string(&profile).map_err(|e| DataError::Storage(e.to_string()))?;
        self.set_setting(INVOICE_PROFILE_KEY, &json)?;
        self.changed(&[Entity::Invoices]);
        Ok(profile)
    }

    /// Ret titel, forfaldsdato og noter. Titel og noter kun på kladder;
    /// forfaldsdatoen også på sendte (fx en forlænget frist), ikke betalte.
    pub async fn update_invoice_details(
        &self,
        id: &str,
        title: Option<String>,
        due_date: NaiveDate,
        notes: Option<String>,
    ) -> Result<Invoice> {
        let id = id.to_owned();
        let clean = |s: Option<String>| s.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty());
        let (title, notes) = (clean(title), clean(notes));
        let out = self
            .run(move |inner, c| {
                let mut inv: Invoice = INVOICES.get(c, &id)?;
                if inv.status == InvoiceStatus::Paid {
                    return Err(DataError::Validation("En betalt faktura kan ikke rettes".into()));
                }
                // Gemte værdier kan være "" eller have mellemrum (0.2, web): sammenlign renset.
                let norm = |s: &Option<String>| s.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
                if inv.status != InvoiceStatus::Draft && (title != norm(&inv.title) || notes != norm(&inv.notes)) {
                    return Err(DataError::Validation(
                        "Titel og noter kan kun rettes på kladder".into(),
                    ));
                }
                let due = parse_day(&due_date.to_string())?;
                if let Some(issued) = inv.issue_date
                    && due.date_naive() < issued.with_timezone(&Local).date_naive()
                {
                    return Err(DataError::Validation("Forfald kan ikke ligge før fakturadatoen".into()));
                }
                inv.title = title;
                inv.notes = notes;
                inv.due_date = Some(due);
                inv.updated_at = Some((inner.clock)());
                INVOICES.update(c, &id, &inv)?;
                Ok(inv)
            })
            .await?;
        self.changed(&[Entity::Invoices]);
        Ok(out)
    }

    /// Slet en kladde. Posterne bliver ufaktureret igen. Udstedte fakturaer
    /// kan ikke slettes (nummerrækken skal være uden huller).
    pub async fn delete_invoice_draft(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |_, c| {
            let tx = c.transaction()?;
            let inv: Invoice = INVOICES.get(&tx, &id)?;
            if inv.status != InvoiceStatus::Draft {
                return Err(DataError::Validation(
                    "Kun kladder kan slettes. En udstedt faktura krediteres i stedet".into(),
                ));
            }
            tx.execute(
                "UPDATE time_entries SET is_billed = 0, invoice_id = NULL WHERE invoice_id = ?1",
                [&id],
            )?;
            tx.execute("DELETE FROM invoice_lines WHERE invoice_id = ?1", [&id])?;
            tx.execute("DELETE FROM invoices WHERE id = ?1", [&id])?;
            tx.commit()?;
            Ok(())
        })
        .await?;
        self.changed(&[Entity::Invoices, Entity::Entries]);
        Ok(())
    }

    /// Hent et arkiveret klippekort frem igen (aktivt, hvis der er saldo).
    pub async fn unarchive_klippekort(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |inner, c| {
            // Et udløbet kort hentes frem som inaktivt.
            let today = (inner.clock)().with_timezone(&Local).date_naive().to_string();
            let n = c.execute(
                "UPDATE prepaid_packages SET is_archived = 0,
                   is_active = CASE WHEN CAST(remaining_hours AS REAL) > 0
                     AND (expiry_date IS NULL OR substr(expiry_date, 1, 10) >= ?2) THEN 1 ELSE 0 END
                 WHERE id = ?1",
                rusqlite::params![id, today],
            )?;
            if n == 0 { Err(DataError::NotFound) } else { Ok(()) }
        })
        .await?;
        self.changed(&[Entity::Klippekort]);
        Ok(())
    }

    /// Slet et klippekort, der aldrig er brugt (ingen træk og ingen poster).
    /// Brugte kort arkiveres i stedet, så historikken bevares.
    pub async fn delete_klippekort(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |_, c| {
            let tx = c.transaction()?;
            let used: String = tx
                .query_row("SELECT used_hours FROM prepaid_packages WHERE id = ?1", [&id], |r| r.get(0))
                .optional()?
                .ok_or(DataError::NotFound)?;
            let refs: i64 = tx.query_row(
                "SELECT (SELECT COUNT(*) FROM prepaid_usage WHERE prepaid_package_id = ?1)
                      + (SELECT COUNT(*) FROM time_entries WHERE prepaid_package_id = ?1)",
                [&id],
                |r| r.get(0),
            )?;
            if refs > 0 || used.parse::<Decimal>().unwrap_or_default() != Decimal::ZERO {
                return Err(DataError::Validation(
                    "Kortet er brugt og kan ikke slettes. Arkivér det i stedet".into(),
                ));
            }
            tx.execute("DELETE FROM prepaid_packages WHERE id = ?1", [&id])?;
            tx.commit()?;
            Ok(())
        })
        .await?;
        self.changed(&[Entity::Klippekort]);
        Ok(())
    }

    fn changed(&self, entities: &[Entity]) {
        self.inner.events.data_changed(entities);
    }

    fn timer_changed(&self, t: &TimerState) {
        self.inner.events.emit(Event::TimerChanged { version: t.version });
    }
}

// ------------------------------------------------------------------ hjælpere

/// "yyyy-MM-dd" → UTC-midnat (som web's `new Date("2026-10-01")`).
fn parse_day(s: &str) -> Result<DateTime<Utc>> {
    crate::serde_util::parse_entry_date(s)
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|d| d.and_utc())
        .ok_or_else(|| DataError::Validation(format!("Ugyldig dato: {s}")))
}

fn now_str(inner: &Inner) -> String {
    (inner.clock)().to_rfc3339()
}

fn setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).ok()
}

/// Nøglen i `settings`, fakturaopsætningen gemmes under.
pub const INVOICE_PROFILE_KEY: &str = "invoice_profile";

/// Den gemte fakturaopsætning. En ulæselig værdi er en fejl (fejl lukket),
/// så en faktura aldrig udstedes med et forkert nummer.
fn invoice_profile_of(conn: &Connection) -> Result<Option<InvoiceProfile>> {
    match setting(conn, INVOICE_PROFILE_KEY) {
        None => Ok(None),
        Some(v) => serde_json::from_str(&v)
            .map(Some)
            .map_err(|e| DataError::Storage(format!("fakturaopsætningen kan ikke læses: {e}"))),
    }
}

fn validate_entry(e: &NewTimeEntry) -> Result<()> {
    if e.description.trim().is_empty() {
        return Err(DataError::Validation("Beskrivelse er påkrævet".into()));
    }
    if e.hours < Decimal::new(1, 2) {
        return Err(DataError::Validation("Timer skal være mindst 0.01".into()));
    }
    if let (Some(s), Some(t)) = (e.start_time, e.end_time)
        && t <= s
    {
        return Err(DataError::Validation("Sluttid skal være efter starttid".into()));
    }
    Ok(())
}

/// Opret en post i en åben transaktion (delt af create_entry, timer-stop og
/// mock-serveren). Returnerer den eksisterende post ved samme nøgle.
fn insert_entry(inner: &Inner, conn: &Connection, mut input: NewTimeEntry) -> Result<CreatedEntry> {
    validate_entry(&input)?;
    // Idempotens: samme clientEntryId eller timerSessionId ⇒ samme post.
    for (col, key) in [("client_entry_id", &input.client_entry_id), ("timer_session_id", &input.timer_session_id)] {
        if let Some(key) = key {
            let found: Vec<TimeEntry> =
                ENTRIES.query(conn, &format!("WHERE {col} = ?1"), vec![text(key.clone())])?;
            if let Some(entry) = found.into_iter().next() {
                return Ok(CreatedEntry { entry, prepaid_deduction: None, deduplicated: true, queued: false });
            }
        }
    }
    let project: Option<Project> = match &input.project_id {
        Some(p) => Some(PROJECTS.get(conn, p).map_err(|_| DataError::Validation("Projektet findes ikke".into()))?),
        None => None,
    };
    if input.client_id.is_none() {
        input.client_id = project.as_ref().and_then(|p| p.client_id.clone());
    }
    let client: Option<Client> = match &input.client_id {
        Some(c) => Some(CLIENTS.get(conn, c).map_err(|_| DataError::Validation("Kunden findes ikke".into()))?),
        None => None,
    };
    let global_rate = setting(conn, "defaultHourlyRate").and_then(|s| s.parse().ok());
    let rate = inner.rules.effective_rate(
        project.as_ref().and_then(|p| p.hourly_rate),
        client.as_ref().and_then(|c| c.default_hourly_rate),
        global_rate,
    );
    let now = now_str(inner);
    let id = new_id();
    let mut entry = TimeEntry {
        id: id.clone(),
        project_id: input.project_id.clone(),
        client_id: input.client_id.clone(),
        task_id: input.task_id.clone(),
        description: Some(input.description.clone()),
        notes: input.notes.clone(),
        hours: input.hours.round_dp(2),
        date: input.date,
        start_time: input.start_time,
        end_time: input.end_time,
        billable_rate: rate,
        is_billable: Some(
            input.is_billable.unwrap_or_else(|| client.as_ref().map(|c| c.default_billable).unwrap_or(true)),
        ),
        is_billed: Some(false),
        is_prepaid: Some(false),
        source: Some(if input.from_timer == Some(true) { "timer".into() } else { "manual".into() }),
        client_entry_id: input.client_entry_id.clone(),
        timer_session_id: input.timer_session_id.clone(),
        created_at: (inner.clock)().into(),
        updated_at: (inner.clock)().into(),
        ..TimeEntry::default()
    };
    let mut deduction = None;
    if let Some(pkg_id) = &input.prepaid_package_id {
        let pkg: PrepaidPackage = PREPAID
            .get(conn, pkg_id)
            .map_err(|_| DataError::Validation("Klippekortet findes ikke".into()))?;
        if Some(&pkg.client_id) != entry.client_id.as_ref() {
            return Err(DataError::Validation("Klippekortet hører til en anden kunde".into()));
        }
        // Beregn trækket FØR noget skrives: en afvisning (saldo, politik)
        // efterlader så intet halvt.
        let d = inner.rules.deduct(&pkg, entry.hours)?;
        let overflow = d.overflow_to_invoice;
        let overflow_rate = pkg.overdraft_rate.or(rate);
        if d.hours_from_package + d.overdraft_hours > Decimal::ZERO {
            entry.prepaid_package_id = Some(pkg.id.clone());
            entry.is_prepaid = Some(true);
            entry.hours -= overflow;
            ENTRIES.insert(conn, &entry)?;
            deduction = Some(apply_deduction(conn, &pkg, &id, &d, &now)?);
        } else {
            // Kortet er tomt: hele posten faktureres til overtræks-satsen.
            entry.billable_rate = overflow_rate;
            ENTRIES.insert(conn, &entry)?;
            deduction = Some(PrepaidDeduction {
                package_name: pkg.name.clone(),
                hours_deducted: Decimal::ZERO,
                remaining_hours: pkg.remaining_hours,
                total_hours: pkg.total_hours,
                overflowed_to_invoice: true,
            });
        }
        if overflow > Decimal::ZERO && entry.is_prepaid == Some(true) {
            // Politik "invoice": timerne ud over kortet bliver en almindelig,
            // fakturerbar post til overtræks-satsen (TODO(tt-core): samme
            // opdeling som web).
            let rest = TimeEntry {
                id: new_id(),
                hours: overflow,
                prepaid_package_id: None,
                is_prepaid: Some(false),
                is_billable: Some(true),
                billable_rate: overflow_rate,
                client_entry_id: None,
                timer_session_id: None,
                ..entry.clone()
            };
            ENTRIES.insert(conn, &rest)?;
        }
    } else {
        ENTRIES.insert(conn, &entry)?;
    }
    Ok(CreatedEntry { entry, prepaid_deduction: deduction, deduplicated: false, queued: false })
}

/// Skriv et beregnet klippekort-træk (saldo + usage-række).
fn apply_deduction(
    conn: &Connection,
    pkg: &PrepaidPackage,
    entry_id: &str,
    d: &crate::rules::Deduction,
    now: &str,
) -> Result<PrepaidDeduction> {
    // Som web: brugt stiger kun med det, saldoen dækker; overtræk føres for sig.
    let used = (pkg.used_hours + d.hours_from_package).min(pkg.total_hours);
    let remaining = (pkg.remaining_hours - d.hours_from_package).max(Decimal::ZERO);
    let overdraft = pkg.overdraft_hours.unwrap_or_default() + d.overdraft_hours;
    conn.execute(
        "UPDATE prepaid_packages SET used_hours = ?1, remaining_hours = ?2, overdraft_hours = ?3 WHERE id = ?4",
        rusqlite::params![used.to_string(), remaining.to_string(), overdraft.to_string(), pkg.id],
    )?;
    let value = (d.hours_from_package + d.overdraft_hours) * pkg.hourly_rate;
    conn.execute(
        "INSERT INTO prepaid_usage (id, prepaid_package_id, time_entry_id, hours_used, overdraft_hours, value_used, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            new_id(),
            pkg.id,
            entry_id,
            (d.hours_from_package + d.overdraft_hours).to_string(),
            d.overdraft_hours.to_string(),
            value.round_dp(2).to_string(),
            now
        ],
    )?;
    Ok(PrepaidDeduction {
        package_name: pkg.name.clone(),
        hours_deducted: d.hours_from_package + d.overdraft_hours,
        remaining_hours: remaining,
        total_hours: pkg.total_hours,
        overflowed_to_invoice: d.overflow_to_invoice > Decimal::ZERO,
    })
}

/// Læg en posts klippekort-træk tilbage (ved sletning eller ret).
fn refund(conn: &Connection, entry_id: &str) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT prepaid_package_id, hours_used, overdraft_hours FROM prepaid_usage WHERE time_entry_id = ?1",
    )?;
    let usages: Vec<(String, String, String)> = stmt
        .query_map([entry_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (pkg_id, used, over) in usages {
        let used: Decimal = used.parse().unwrap_or_default();
        let over: Decimal = over.parse().unwrap_or_default();
        let pkg: PrepaidPackage = PREPAID.get(conn, &pkg_id)?;
        let back = used - over;
        let remaining = (pkg.remaining_hours + back).min(pkg.total_hours);
        conn.execute(
            "UPDATE prepaid_packages SET used_hours = ?1, remaining_hours = ?2, overdraft_hours = ?3 WHERE id = ?4",
            rusqlite::params![
                (pkg.used_hours - used).max(Decimal::ZERO).to_string(),
                remaining.to_string(),
                (pkg.overdraft_hours.unwrap_or_default() - over).max(Decimal::ZERO).to_string(),
                pkg_id
            ],
        )?;
    }
    conn.execute("DELETE FROM prepaid_usage WHERE time_entry_id = ?1", [entry_id])?;
    Ok(())
}

fn entry_filter_sql(f: &EntryFilter) -> (String, Vec<SqlValue>) {
    let mut conds = Vec::new();
    let mut params = Vec::new();
    if let Some(d) = f.start_date {
        conds.push("date >= ?".to_owned());
        params.push(text(d.format("%Y-%m-%d").to_string()));
    }
    if let Some(d) = f.end_date {
        conds.push("date <= ?".to_owned());
        params.push(text(d.format("%Y-%m-%d").to_string()));
    }
    for (col, v) in [("client_id", &f.client_id), ("project_id", &f.project_id), ("task_id", &f.task_id)] {
        if let Some(v) = v {
            conds.push(format!("{col} = ?"));
            params.push(text(v.clone()));
        }
    }
    if let Some(b) = f.is_billed {
        conds.push(format!("is_billed = {}", b as i32));
    }
    match f.untimed {
        Some(true) => conds.push("(start_time IS NULL OR end_time IS NULL)".into()),
        Some(false) => conds.push("start_time IS NOT NULL AND end_time IS NOT NULL".into()),
        None => {}
    }
    let mut tail = String::new();
    if !conds.is_empty() {
        tail = format!("WHERE {}", conds.join(" AND "));
    }
    tail.push_str(" ORDER BY date DESC, start_time DESC, created_at DESC");
    (tail, params)
}

fn read_timer(conn: &Connection) -> Result<TimerState> {
    match conn.query_row("SELECT state FROM timer_state WHERE id = 1", [], |r| r.get::<_, String>(0)) {
        Ok(s) => Ok(serde_json::from_str(&s)?),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(TimerState::default()),
        Err(e) => Err(e.into()),
    }
}

/// Skriv timeren og bump versionen (som web: hver skrivning bumper).
fn write_timer(conn: &Connection, mut t: TimerState) -> Result<TimerState> {
    t.version += 1;
    conn.execute(
        "INSERT INTO timer_state (id, state) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state",
        [serde_json::to_string(&t)?],
    )?;
    Ok(t)
}

fn named(conn: &Connection, t: &mut TimerState) {
    t.project = t
        .project_id
        .as_ref()
        .and_then(|id| PROJECTS.get::<Project>(conn, id).ok())
        .map(|p| NamedRef { id: p.id, name: p.name, client_id: p.client_id });
    t.client = t
        .client_id
        .as_ref()
        .and_then(|id| CLIENTS.get::<Client>(conn, id).ok())
        .map(|c| NamedRef { id: c.id, name: c.name, client_id: None });
}

fn lines_total(lines: &[InvoiceLine]) -> Decimal {
    lines.iter().map(|l| l.amount).sum::<Decimal>().round_dp(2)
}

fn invoice_lines_of(conn: &Connection, invoice_id: &str) -> Result<Vec<InvoiceLine>> {
    INVOICE_LINES.query(conn, "WHERE invoice_id = ?1 ORDER BY sort_order", vec![text(invoice_id)])
}

fn uninvoiced(conn: &Connection, client_id: Option<&str>) -> Result<Vec<TimeEntry>> {
    let mut tail = String::from(
        "WHERE is_billed = 0 AND is_prepaid = 0 AND is_billable = 1 AND invoice_id IS NULL",
    );
    let mut params = Vec::new();
    if let Some(c) = client_id {
        tail.push_str(
            " AND (client_id = ?1 OR (client_id IS NULL AND project_id IN (SELECT id FROM projects WHERE client_id = ?1)))",
        );
        params.push(text(c));
    }
    tail.push_str(" ORDER BY date, start_time");
    ENTRIES.query(conn, &tail, params)
}

// ------------------------------------------------------------------ trait

#[async_trait]
impl Repository for LocalRepo {
    fn mode(&self) -> Mode {
        Mode::Local
    }

    fn events(&self) -> Events {
        self.inner.events.clone()
    }

    async fn session(&self) -> Result<Session> {
        Ok(Session { mode: Mode::Local, user: None, organization_id: None, device: self.inner.device.clone() })
    }

    async fn organizations(&self) -> Result<Vec<Organization>> {
        Ok(Vec::new())
    }

    async fn select_organization(&self, _organization_id: &str) -> Result<()> {
        Err(DataError::Unsupported(format!("Organisationer findes kun med en {}-konto", tt_core::edition::EDITION.name)))
    }

    async fn entitlements(&self) -> Result<Entitlements> {
        // Lokal tilstand kræver livstidslicensen (verificeres i licens-
        // modulet før LocalRepo åbnes); her er alt slået til.
        Ok(Entitlements {
            plan: Some(Plan { tier: Some("lifetime".into()), name: Some("Livstidslicens".into()), ..Plan::default() }),
            features: Features::all(),
            ..Entitlements::default()
        })
    }

    async fn logout(&self) -> Result<()> {
        self.inner.events.emit(Event::LoggedOut { reason: LogoutReason::User });
        Ok(())
    }

    // ---------------------------------------------------------------- kunder

    async fn list_clients(&self, include_archived: bool) -> Result<Vec<Client>> {
        self.run(move |_, c| {
            let tail = if include_archived { "ORDER BY name COLLATE NOCASE" } else { "WHERE is_archived = 0 ORDER BY name COLLATE NOCASE" };
            CLIENTS.query(c, tail, vec![])
        })
        .await
    }

    async fn get_client(&self, id: &str) -> Result<Client> {
        let id = id.to_owned();
        self.run(move |_, c| CLIENTS.get(c, &id)).await
    }

    async fn create_client(&self, input: NewClient) -> Result<Client> {
        if input.name.trim().is_empty() {
            return Err(DataError::Validation("Navn er påkrævet".into()));
        }
        let domains = normalize_client_domains(&input.domains).map_err(DataError::Validation)?;
        let out = self
            .run(move |inner, c| {
                let now = (inner.clock)();
                let client = Client {
                    id: new_id(),
                    name: input.name.trim().to_owned(),
                    email: input.email,
                    phone: input.phone,
                    company: input.company,
                    address: input.address,
                    city: input.city,
                    postal_code: input.postal_code,
                    country: input.country.or_else(|| Some("Danmark".into())),
                    cvr_number: input.cvr_number,
                    notes: input.notes,
                    default_hourly_rate: input.default_hourly_rate,
                    payment_terms_days: input.payment_terms_days,
                    default_billable: input.default_billable.unwrap_or(true),
                    color: input.color,
                    domains,
                    is_active: Some(true),
                    is_archived: Some(false),
                    created_at: Some(now),
                    updated_at: Some(now),
                    ..Client::default()
                };
                CLIENTS.insert(c, &client)?;
                Ok(client)
            })
            .await?;
        self.changed(&[Entity::Clients]);
        Ok(out)
    }

    async fn update_client(&self, id: &str, patch: ClientPatch) -> Result<Client> {
        let id = id.to_owned();
        let out = self
            .run(move |inner, c| {
                let mut client: Client = CLIENTS.get(c, &id)?;
                if let Some(v) = patch.name {
                    if v.trim().is_empty() {
                        return Err(DataError::Validation("Navn er påkrævet".into()));
                    }
                    client.name = v.trim().to_owned();
                }
                macro_rules! set { ($($f:ident),*) => { $( if patch.$f.is_some() { client.$f = patch.$f; } )* } }
                set!(email, phone, company, cvr_number, notes, color);
                if let Some(v) = patch.default_hourly_rate {
                    client.default_hourly_rate = v;
                }
                if let Some(v) = patch.payment_terms_days {
                    client.payment_terms_days = v;
                }
                if let Some(v) = patch.default_billable {
                    client.default_billable = v;
                }
                if let Some(v) = &patch.domains {
                    client.domains = normalize_client_domains(v).map_err(DataError::Validation)?;
                }
                client.updated_at = Some((inner.clock)());
                CLIENTS.update(c, &id, &client)?;
                Ok(client)
            })
            .await?;
        self.changed(&[Entity::Clients]);
        Ok(out)
    }

    async fn archive_client(&self, id: &str) -> Result<()> {
        self.set_client_archived(id, true).await
    }

    async fn unarchive_client(&self, id: &str) -> Result<()> {
        self.set_client_archived(id, false).await
    }

    // ---------------------------------------------------------------- projekter

    async fn list_projects(&self, include_archived: bool) -> Result<Vec<Project>> {
        self.run(move |_, c| {
            let tail = if include_archived {
                "ORDER BY name COLLATE NOCASE"
            } else {
                "WHERE status <> 'archived' ORDER BY name COLLATE NOCASE"
            };
            PROJECTS.query(c, tail, vec![])
        })
        .await
    }

    async fn get_project(&self, id: &str) -> Result<Project> {
        let id = id.to_owned();
        self.run(move |_, c| PROJECTS.get(c, &id)).await
    }

    async fn create_project(&self, input: NewProject) -> Result<Project> {
        if input.name.trim().is_empty() {
            return Err(DataError::Validation("Navn er påkrævet".into()));
        }
        let out = self
            .run(move |inner, c| {
                if let Some(cid) = &input.client_id {
                    CLIENTS.get::<Client>(c, cid).map_err(|_| DataError::Validation("Kunden findes ikke".into()))?;
                }
                let now = (inner.clock)();
                let p = Project {
                    id: new_id(),
                    name: input.name.trim().to_owned(),
                    client_id: input.client_id,
                    description: input.description,
                    hourly_rate: input.hourly_rate,
                    budget_hours: input.budget_hours,
                    url_patterns: input.url_patterns,
                    status: ProjectStatus::Active,
                    created_at: Some(now),
                    updated_at: Some(now),
                    ..Project::default()
                };
                PROJECTS.insert(c, &p)?;
                Ok(p)
            })
            .await?;
        self.changed(&[Entity::Projects, Entity::Rules]);
        Ok(out)
    }

    async fn update_project(&self, id: &str, patch: ProjectPatch) -> Result<Project> {
        let id = id.to_owned();
        let out = self
            .run(move |inner, c| {
                let mut p: Project = PROJECTS.get(c, &id)?;
                if let Some(v) = patch.name {
                    p.name = v;
                }
                if let Some(v) = patch.client_id {
                    p.client_id = v;
                }
                if patch.description.is_some() {
                    p.description = patch.description;
                }
                if let Some(v) = patch.hourly_rate {
                    p.hourly_rate = v;
                }
                if let Some(v) = patch.budget_hours {
                    p.budget_hours = v;
                }
                if let Some(v) = patch.url_patterns {
                    p.url_patterns = v;
                }
                p.updated_at = Some((inner.clock)());
                PROJECTS.update(c, &id, &p)?;
                Ok(p)
            })
            .await?;
        self.changed(&[Entity::Projects, Entity::Rules]);
        Ok(out)
    }

    async fn set_project_status(&self, id: &str, status: ProjectStatus) -> Result<()> {
        let id = id.to_owned();
        self.run(move |inner, c| {
            let n = c.execute(
                "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![status.as_str(), now_str(inner), id],
            )?;
            if n == 0 { Err(DataError::NotFound) } else { Ok(()) }
        })
        .await?;
        self.changed(&[Entity::Projects, Entity::Rules]);
        Ok(())
    }

    // ---------------------------------------------------------------- klippekort

    async fn list_klippekort(&self, client_id: Option<&str>, include_inactive: bool) -> Result<Vec<PrepaidPackage>> {
        let client_id = client_id.map(str::to_owned);
        self.run(move |_, c| {
            let mut conds = vec![];
            let mut params = vec![];
            if let Some(cid) = client_id {
                conds.push("client_id = ?");
                params.push(text(cid));
            }
            if !include_inactive {
                conds.push("is_active = 1 AND is_archived = 0");
            }
            let mut tail = if conds.is_empty() { String::new() } else { format!("WHERE {}", conds.join(" AND ")) };
            tail.push_str(" ORDER BY purchase_date DESC");
            PREPAID.query(c, &tail, params)
        })
        .await
    }

    async fn create_klippekort(&self, input: NewPrepaidPackage) -> Result<PrepaidPackage> {
        if input.name.trim().chars().count() < 2 {
            return Err(DataError::Validation("Navn skal være mindst 2 tegn".into()));
        }
        if input.total_hours < Decimal::new(1, 2) {
            return Err(DataError::Validation("Timer skal være mindst 0.01".into()));
        }
        let out = self
            .run(move |_, c| {
                CLIENTS.get::<Client>(c, &input.client_id).map_err(|_| DataError::Validation("Vælg en kunde".into()))?;
                let date = |s: &str| {
                    crate::serde_util::parse_entry_date(s)
                        .and_then(|d| d.and_hms_opt(0, 0, 0))
                        .map(|d| d.and_utc())
                        .ok_or_else(|| DataError::Validation(format!("Ugyldig dato: {s}")))
                };
                let p = PrepaidPackage {
                    id: new_id(),
                    name: input.name.trim().to_owned(),
                    client_id: input.client_id,
                    total_hours: input.total_hours,
                    used_hours: Decimal::ZERO,
                    remaining_hours: input.total_hours,
                    hourly_rate: input.hourly_rate,
                    total_value: (input.total_hours * input.hourly_rate).round_dp(2),
                    purchase_date: Some(date(&input.purchase_date)?),
                    expiry_date: input.expiry_date.as_deref().map(date).transpose()?,
                    is_active: true,
                    is_archived: Some(false),
                    description: input.description,
                    clip_size_minutes: input.clip_size_minutes,
                    auto_deduct: input.auto_deduct.unwrap_or(true),
                    overdraft_policy: Some(input.overdraft_policy.unwrap_or_else(|| "block".into())),
                    overdraft_rate: None,
                    overdraft_hours: Some(Decimal::ZERO),
                };
                PREPAID.insert(c, &p)?;
                Ok(p)
            })
            .await?;
        self.changed(&[Entity::Klippekort]);
        Ok(out)
    }

    async fn update_klippekort(&self, id: &str, patch: PrepaidPackagePatch) -> Result<PrepaidPackage> {
        let id = id.to_owned();
        let out = self
            .run(move |_, c| {
                let mut p: PrepaidPackage = PREPAID.get(c, &id)?;
                if let Some(v) = patch.name {
                    if v.trim().chars().count() < 2 {
                        return Err(DataError::Validation("Navn skal være mindst 2 tegn".into()));
                    }
                    p.name = v.trim().to_owned();
                }
                if let Some(v) = patch.client_id {
                    CLIENTS.get::<Client>(c, &v).map_err(|_| DataError::Validation("Vælg en kunde".into()))?;
                    p.client_id = v;
                }
                if let Some(total) = patch.total_hours {
                    if total < Decimal::new(1, 2) {
                        return Err(DataError::Validation("Timer skal være mindst 0.01".into()));
                    }
                    // Som web (remainingAfterTotalChange): begge afrundes til
                    // to decimaler, tilbage = total - brugt, og en total under
                    // det brugte afvises.
                    let (total, used) = (total.round_dp(2), p.used_hours.round_dp(2));
                    if total < used {
                        return Err(DataError::Validation(format!(
                            "Det samlede antal timer kan ikke være lavere end de allerede brugte timer ({} t)",
                            p.used_hours.round_dp(2).normalize().to_string().replace('.', ",")
                        )));
                    }
                    p.total_hours = total;
                    p.remaining_hours = total - used;
                }
                if let Some(v) = patch.hourly_rate {
                    p.hourly_rate = v;
                }
                if let Some(v) = patch.purchase_date {
                    p.purchase_date = Some(parse_day(&v)?);
                }
                if let Some(v) = patch.expiry_date {
                    p.expiry_date = v.as_deref().map(parse_day).transpose()?;
                }
                if let Some(v) = patch.description {
                    p.description = v.filter(|d| !d.trim().is_empty());
                }
                if let Some(v) = patch.clip_size_minutes {
                    p.clip_size_minutes = v.filter(|m| *m > 0);
                }
                if let Some(v) = patch.overdraft_policy {
                    p.overdraft_policy = Some(v);
                }
                if let Some(v) = patch.auto_deduct {
                    p.auto_deduct = v;
                }
                p.total_value = (p.total_hours * p.hourly_rate).round_dp(2);
                PREPAID.update(c, &id, &p)?;
                Ok(p)
            })
            .await?;
        self.changed(&[Entity::Klippekort]);
        Ok(out)
    }

    async fn top_up_klippekort(&self, id: &str, hours: Decimal, note: Option<String>) -> Result<PrepaidPackage> {
        let _ = note; // Web gemmer heller ikke noten på kortet.
        if hours < Decimal::new(1, 2) {
            return Err(DataError::Validation("Timer skal være mindst 0.01".into()));
        }
        let id = id.to_owned();
        let out = self
            .run(move |_, c| {
                let mut p: PrepaidPackage = PREPAID.get(c, &id)?;
                p.total_hours += hours;
                p.remaining_hours += hours;
                p.total_value = (p.total_hours * p.hourly_rate).round_dp(2);
                p.is_active = true;
                PREPAID.update(c, &id, &p)?;
                Ok(p)
            })
            .await?;
        self.changed(&[Entity::Klippekort]);
        Ok(out)
    }

    async fn archive_klippekort(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |_, c| {
            let n = c.execute("UPDATE prepaid_packages SET is_archived = 1, is_active = 0 WHERE id = ?1", [&id])?;
            if n == 0 { Err(DataError::NotFound) } else { Ok(()) }
        })
        .await?;
        self.changed(&[Entity::Klippekort]);
        Ok(())
    }

    // ---------------------------------------------------------------- poster

    async fn list_entries(&self, filter: EntryFilter) -> Result<Vec<TimeEntry>> {
        self.run(move |_, c| {
            let (tail, params) = entry_filter_sql(&filter);
            ENTRIES.query(c, &tail, params)
        })
        .await
    }

    async fn get_entry(&self, id: &str) -> Result<TimeEntry> {
        let id = id.to_owned();
        self.run(move |_, c| ENTRIES.get(c, &id)).await
    }

    async fn create_entry(&self, mut input: NewTimeEntry) -> Result<CreatedEntry> {
        input.client_entry_id.get_or_insert_with(new_id);
        let out = self
            .run(move |inner, c| {
                let tx = c.transaction()?;
                let out = insert_entry(inner, &tx, input)?;
                tx.commit()?;
                Ok(out)
            })
            .await?;
        if !out.deduplicated {
            self.changed(&[Entity::Entries, Entity::Klippekort]);
        }
        Ok(out)
    }

    async fn update_entry(&self, id: &str, patch: TimeEntryPatch) -> Result<TimeEntry> {
        let id = id.to_owned();
        let out = self
            .run(move |inner, c| {
                let tx = c.transaction()?;
                let mut e: TimeEntry = ENTRIES.get(&tx, &id)?;
                if e.is_billed.unwrap_or(false) {
                    return Err(DataError::Validation("Posten er faktureret og kan ikke rettes".into()));
                }
                let old_hours = e.hours;
                let old_client = e.client_id.clone();
                if let Some(v) = patch.project_id {
                    e.project_id = v;
                    if patch.client_id.is_none() {
                        e.client_id = e.project_id.as_ref().and_then(|p| PROJECTS.get::<Project>(&tx, p).ok()).and_then(|p| p.client_id);
                    }
                }
                if let Some(v) = patch.client_id {
                    e.client_id = v;
                }
                if let Some(v) = patch.description {
                    if v.trim().is_empty() {
                        return Err(DataError::Validation("Beskrivelse er påkrævet".into()));
                    }
                    e.description = Some(v);
                }
                if patch.notes.is_some() {
                    e.notes = patch.notes;
                }
                if let Some(h) = patch.hours {
                    if h < Decimal::new(1, 2) {
                        return Err(DataError::Validation("Timer skal være mindst 0.01".into()));
                    }
                    e.hours = h.round_dp(2);
                }
                if let Some(d) = patch.date {
                    e.date = d;
                }
                if let Some(v) = patch.start_time {
                    e.start_time = v;
                }
                if let Some(v) = patch.end_time {
                    e.end_time = v;
                }
                if let (Some(s), Some(t)) = (e.start_time, e.end_time)
                    && t <= s
                {
                    return Err(DataError::Validation("Sluttid skal være efter starttid".into()));
                }
                if patch.is_billable.is_some() {
                    e.is_billable = patch.is_billable;
                }
                if let Some(v) = patch.task_id {
                    e.task_id = v;
                }
                if e.is_prepaid.unwrap_or(false)
                    && let Some(pkg_id) = e.prepaid_package_id.clone()
                {
                    if e.client_id != old_client {
                        // Ny kunde: kortet hører til den gamle, så trækket
                        // lægges tilbage, og posten bliver almindelig.
                        refund(&tx, &id)?;
                        e.prepaid_package_id = None;
                        e.is_prepaid = Some(false);
                    } else if e.hours != old_hours {
                        // Læg det gamle træk tilbage og træk igen.
                        refund(&tx, &id)?;
                        let pkg: PrepaidPackage = PREPAID.get(&tx, &pkg_id)?;
                        let d = inner.rules.deduct(&pkg, e.hours)?;
                        apply_deduction(&tx, &pkg, &id, &d, &now_str(inner))?;
                    }
                }
                e.updated_at = Some((inner.clock)());
                ENTRIES.update(&tx, &id, &e)?;
                tx.commit()?;
                Ok(e)
            })
            .await?;
        self.changed(&[Entity::Entries, Entity::Klippekort]);
        Ok(out)
    }

    async fn delete_entry(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |_, c| {
            let tx = c.transaction()?;
            let e: TimeEntry = ENTRIES.get(&tx, &id)?;
            if e.is_billed.unwrap_or(false) {
                return Err(DataError::Validation("Posten er faktureret og kan ikke slettes".into()));
            }
            refund(&tx, &id)?;
            tx.execute("DELETE FROM time_entries WHERE id = ?1", [&id])?;
            tx.commit()?;
            Ok(())
        })
        .await?;
        self.changed(&[Entity::Entries, Entity::Klippekort]);
        Ok(())
    }

    // ---------------------------------------------------------------- timer

    async fn timer(&self) -> Result<TimerState> {
        self.run(|_, c| {
            let mut t = read_timer(c)?;
            named(c, &mut t);
            Ok(t)
        })
        .await
    }

    async fn timer_start(&self, input: StartTimer) -> Result<TimerState> {
        let t = self
            .run(move |inner, c| {
                let cur = read_timer(c)?;
                if cur.is_active() {
                    return Err(DataError::Conflict { reason: "already_running".into() });
                }
                let mut client_id = input.client_id;
                if client_id.is_none()
                    && let Some(p) = &input.project_id
                {
                    client_id = PROJECTS.get::<Project>(c, p)?.client_id;
                }
                let mut t = write_timer(c, TimerState {
                    is_running: true,
                    start_time: Some((inner.clock)()),
                    project_id: input.project_id,
                    client_id,
                    task_id: input.task_id,
                    description: input.description,
                    session_id: Some(new_id()),
                    version: cur.version,
                    ..TimerState::default()
                })?;
                named(c, &mut t);
                Ok(t)
            })
            .await?;
        self.timer_changed(&t);
        Ok(t)
    }

    async fn timer_pause(&self) -> Result<TimerState> {
        let t = self
            .run(|inner, c| {
                let mut t = read_timer(c)?;
                if !t.is_running {
                    return Err(DataError::Conflict { reason: "not_running".into() });
                }
                let now = (inner.clock)();
                t.base_seconds = t.elapsed_at(now);
                t.elapsed_seconds = t.base_seconds;
                t.start_time = None;
                t.is_running = false;
                let mut t = write_timer(c, t)?;
                named(c, &mut t);
                Ok(t)
            })
            .await?;
        self.timer_changed(&t);
        Ok(t)
    }

    async fn timer_resume(&self) -> Result<TimerState> {
        let t = self
            .run(|inner, c| {
                let mut t = read_timer(c)?;
                if t.is_running || !t.is_active() {
                    return Err(DataError::Conflict { reason: "not_paused".into() });
                }
                t.is_running = true;
                t.start_time = Some((inner.clock)());
                let mut t = write_timer(c, t)?;
                named(c, &mut t);
                Ok(t)
            })
            .await?;
        self.timer_changed(&t);
        Ok(t)
    }

    async fn timer_set_target(&self, target: StartTimer) -> Result<TimerState> {
        let t = self
            .run(move |_, c| {
                let mut t = read_timer(c)?;
                if !t.is_active() {
                    return Err(DataError::Conflict { reason: "not_active".into() });
                }
                t.project_id = target.project_id;
                t.client_id = target.client_id;
                t.task_id = target.task_id;
                t.description = target.description;
                let mut t = write_timer(c, t)?;
                named(c, &mut t);
                Ok(t)
            })
            .await?;
        self.timer_changed(&t);
        Ok(t)
    }

    async fn timer_stop(&self, input: StopTimer) -> Result<StopOutcome> {
        let out = self
            .run(move |inner, c| {
                let tx = c.transaction()?;
                let t = read_timer(&tx)?;
                if !t.is_active() {
                    return Err(DataError::Conflict { reason: "not_active".into() });
                }
                let now = (inner.clock)();
                let seconds = t.elapsed_at(now);
                // Idle-fradrag: posten beholder starten og slutter tidligere.
                let kept = input.kept_secs(seconds);
                let mut entry = None;
                // Under ét minut gemmes ikke (som web's stop-flow).
                if !input.discard && kept >= 60 {
                    let hours = (Decimal::from(kept) / Decimal::from(3600)).round_dp(2);
                    let started = now - chrono::Duration::seconds(seconds);
                    let end = started + chrono::Duration::seconds(kept);
                    let date = started.with_timezone(&Local).date_naive();
                    let description = input
                        .description
                        .filter(|d| !d.trim().is_empty())
                        .or_else(|| Some(t.description.clone()).filter(|d| !d.trim().is_empty()))
                        .unwrap_or_else(|| "Uden beskrivelse".into());
                    let prepaid_package_id = match &t.prepaid_choice {
                        Some(PrepaidChoice::None) => None,
                        Some(PrepaidChoice::Package { package_id }) => Some(package_id.clone()),
                        None => t.client_id.as_ref().and_then(|cid| {
                            let pkgs: Vec<PrepaidPackage> = PREPAID
                                .query(&tx, "WHERE client_id = ?1", vec![text(cid.clone())])
                                .unwrap_or_default();
                            inner.rules.pick_auto_deduct_package(&pkgs, cid, date).map(|p| p.id.clone())
                        }),
                    };
                    let auto_card = t.prepaid_choice.is_none() && prepaid_package_id.is_some();
                    let new = NewTimeEntry {
                        project_id: t.project_id.clone(),
                        client_id: t.client_id.clone(),
                        task_id: t.task_id.clone(),
                        description,
                        hours: hours.max(Decimal::new(1, 2)),
                        date,
                        start_time: Some(started),
                        end_time: Some(end),
                        prepaid_package_id,
                        timer_session_id: t.session_id.clone(),
                        client_entry_id: Some(new_id()),
                        from_timer: Some(true),
                        ..NewTimeEntry::default()
                    };
                    // Et automatisk valgt kort uden saldo nok må ikke koste
                    // tiden: gem posten uden kort.
                    entry = Some(match insert_entry(inner, &tx, new.clone()) {
                        Err(DataError::Validation(_)) if auto_card => {
                            insert_entry(inner, &tx, NewTimeEntry { prepaid_package_id: None, ..new })?
                        }
                        other => other?,
                    });
                }
                let timer = write_timer(&tx, TimerState { version: t.version, ..TimerState::default() })?;
                tx.commit()?;
                Ok(StopOutcome { entry, timer })
            })
            .await?;
        self.timer_changed(&out.timer);
        if out.entry.is_some() {
            self.changed(&[Entity::Entries, Entity::Klippekort]);
        }
        Ok(out)
    }

    async fn set_prepaid_choice(&self, choice: Option<PrepaidChoice>) -> Result<()> {
        let t = self
            .run(move |_, c| {
                let mut t = read_timer(c)?;
                if !t.is_active() {
                    return Err(DataError::Conflict { reason: "not_active".into() });
                }
                if let Some(PrepaidChoice::Package { package_id }) = &choice {
                    let pkg: PrepaidPackage = PREPAID.get(c, package_id)?;
                    if Some(&pkg.client_id) != t.client_id.as_ref() {
                        return Err(DataError::Validation("Klippekortet hører til en anden kunde".into()));
                    }
                }
                t.prepaid_choice = choice;
                write_timer(c, t)
            })
            .await?;
        self.timer_changed(&t);
        Ok(())
    }

    // ---------------------------------------------------------------- opgaver

    async fn list_tasks(&self, filter: TaskFilter) -> Result<Vec<Task>> {
        self.run(move |_, c| {
            let mut conds = vec![];
            let mut params = vec![];
            if let Some(s) = filter.status {
                conds.push("status = ?");
                params.push(text(s.as_str()));
            }
            if let Some(p) = filter.project_id {
                conds.push("project_id = ?");
                params.push(text(p));
            }
            if let Some(cl) = filter.client_id {
                conds.push("client_id = ?");
                params.push(text(cl));
            }
            let mut tail = if conds.is_empty() { String::new() } else { format!("WHERE {}", conds.join(" AND ")) };
            tail.push_str(" ORDER BY position, created_at");
            let mut tasks: Vec<Task> = TASKS.query(c, &tail, params)?;
            for t in &mut tasks {
                let hours: Vec<String> = c
                    .prepare("SELECT hours FROM time_entries WHERE task_id = ?1")?
                    .query_map([&t.id], |r| r.get(0))?
                    .collect::<rusqlite::Result<_>>()?;
                let total: Decimal = hours.iter().filter_map(|h| h.parse::<Decimal>().ok()).sum();
                t.tracked_minutes = Some((total * Decimal::from(60)).round().try_into().unwrap_or(0));
            }
            Ok(tasks)
        })
        .await
    }

    async fn create_task(&self, input: NewTask) -> Result<Task> {
        if input.title.trim().is_empty() {
            return Err(DataError::Validation("Titel er påkrævet".into()));
        }
        let out = self
            .run(move |inner, c| {
                let now = (inner.clock)();
                let t = Task {
                    id: new_id(),
                    title: input.title.trim().to_owned(),
                    description: input.description,
                    project_id: input.project_id,
                    client_id: input.client_id,
                    status: input.status,
                    priority: Some(input.priority.unwrap_or_else(|| "medium".into())),
                    deadline: input.deadline,
                    estimated_minutes: input.estimated_minutes,
                    position: Some(0),
                    completed_at: (input.status == TaskStatus::Done).then_some(now),
                    created_at: Some(now),
                    updated_at: Some(now),
                    ..Task::default()
                };
                TASKS.insert(c, &t)?;
                Ok(Task { tracked_minutes: Some(0), ..t })
            })
            .await?;
        self.changed(&[Entity::Tasks]);
        Ok(out)
    }

    async fn update_task(&self, id: &str, patch: TaskPatch) -> Result<Task> {
        let id = id.to_owned();
        let out = self
            .run(move |inner, c| {
                let mut t: Task = TASKS.get(c, &id)?;
                if let Some(v) = patch.title {
                    if v.trim().is_empty() {
                        return Err(DataError::Validation("Titel er påkrævet".into()));
                    }
                    t.title = v;
                }
                if let Some(v) = patch.description {
                    t.description = v;
                }
                if let Some(v) = patch.project_id {
                    t.project_id = v;
                }
                if let Some(v) = patch.client_id {
                    t.client_id = v;
                }
                if patch.priority.is_some() {
                    t.priority = patch.priority;
                }
                if let Some(v) = patch.deadline {
                    t.deadline = v;
                }
                if let Some(v) = patch.estimated_minutes {
                    t.estimated_minutes = v;
                }
                t.updated_at = Some((inner.clock)());
                TASKS.update(c, &id, &t)?;
                Ok(t)
            })
            .await?;
        self.changed(&[Entity::Tasks]);
        Ok(out)
    }

    async fn set_task_status(&self, id: &str, status: TaskStatus) -> Result<()> {
        let id = id.to_owned();
        self.run(move |inner, c| {
            let now = now_str(inner);
            let completed = (status == TaskStatus::Done).then(|| now.clone());
            let n = c.execute(
                "UPDATE tasks SET status = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![status.as_str(), completed, now, id],
            )?;
            if n == 0 { Err(DataError::NotFound) } else { Ok(()) }
        })
        .await?;
        self.changed(&[Entity::Tasks]);
        Ok(())
    }

    // ---------------------------------------------------------------- fakturaer

    async fn list_invoices(&self) -> Result<Vec<Invoice>> {
        self.run(|_, c| INVOICES.query(c, "ORDER BY issue_date DESC, created_at DESC", vec![])).await
    }

    async fn get_invoice(&self, id: &str) -> Result<Invoice> {
        let id = id.to_owned();
        self.run(move |_, c| INVOICES.get(c, &id)).await
    }

    async fn uninvoiced_summary(&self) -> Result<Vec<UninvoicedSummary>> {
        self.run(|_, c| {
            let entries = uninvoiced(c, None)?;
            let clients: Vec<Client> = CLIENTS.query(c, "", vec![])?;
            let projects: Vec<Project> = PROJECTS.query(c, "", vec![])?;
            let names = Names::new(&clients, &projects);
            let mut by: std::collections::BTreeMap<String, UninvoicedSummary> = Default::default();
            for e in entries {
                let Some(cid) = e.client_id.clone().or_else(|| {
                    e.project_id.as_ref().and_then(|p| names.projects.get(p)).and_then(|(_, c)| c.clone())
                }) else {
                    continue;
                };
                let s = by.entry(cid.clone()).or_insert_with(|| UninvoicedSummary {
                    client_name: names.clients.get(&cid).cloned().unwrap_or_default(),
                    client_id: cid,
                    ..UninvoicedSummary::default()
                });
                s.hours += e.hours;
                s.amount += e.hours * e.billable_rate.unwrap_or_default();
                s.entry_count += 1;
            }
            Ok(by.into_values().collect())
        })
        .await
    }

    async fn uninvoiced_entries(&self, client_id: &str) -> Result<Vec<TimeEntry>> {
        let client_id = client_id.to_owned();
        self.run(move |_, c| uninvoiced(c, Some(&client_id))).await
    }

    async fn create_invoice_draft(&self, input: NewInvoiceDraft) -> Result<Invoice> {
        if input.time_entry_ids.is_empty() {
            return Err(DataError::Validation("Vælg mindst én post".into()));
        }
        let out = self
            .run(move |inner, c| {
                let tx = c.transaction()?;
                let client: Client = CLIENTS.get(&tx, &input.client_id)?;
                let eligible = uninvoiced(&tx, Some(&client.id))?;
                let picked: Vec<&TimeEntry> =
                    eligible.iter().filter(|e| input.time_entry_ids.contains(&e.id)).collect();
                if picked.len() != input.time_entry_ids.len() {
                    return Err(DataError::Validation(
                        "Nogle poster er allerede faktureret eller hører til en anden kunde".into(),
                    ));
                }
                let now = (inner.clock)();
                let invoice_id = new_id();
                let lines: Vec<InvoiceLine> = picked
                    .iter()
                    .enumerate()
                    .map(|(i, e)| {
                        let price = e.billable_rate.unwrap_or_default();
                        InvoiceLine {
                            id: Some(new_id()),
                            description: e.description.clone().unwrap_or_default(),
                            quantity: e.hours,
                            unit_price: price,
                            amount: (e.hours * price).round_dp(2),
                            time_entry_id: Some(e.id.clone()),
                            sort_order: i as i32,
                        }
                    })
                    .collect();
                // Kundens frist, ellers fakturaopsætningens, ellers 14 dage.
                let terms = client
                    .payment_terms_days
                    .map(i64::from)
                    .or(invoice_profile_of(&tx)?.map(|p| p.payment_terms_days as i64))
                    .unwrap_or(14);
                let invoice = Invoice {
                    id: invoice_id.clone(),
                    invoice_number: "Kladde".into(),
                    client_id: client.id.clone(),
                    amount: lines_total(&lines),
                    status: InvoiceStatus::Draft,
                    kind: Some("invoice".into()),
                    issue_date: Some(now),
                    due_date: Some(
                        input
                            .due_date
                            .and_then(|d| d.and_hms_opt(0, 0, 0))
                            .map(|d| d.and_utc())
                            .unwrap_or(now + chrono::Duration::days(terms)),
                    ),
                    notes: input.notes.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty()),
                    created_at: Some(now),
                    updated_at: Some(now),
                    ..Invoice::default()
                };
                INVOICES.insert(&tx, &invoice)?;
                for l in &lines {
                    insert_line(&tx, &invoice_id, l)?;
                }
                for e in picked {
                    tx.execute(
                        "UPDATE time_entries SET is_billed = 1, invoice_id = ?1 WHERE id = ?2",
                        [&invoice_id, &e.id],
                    )?;
                }
                tx.commit()?;
                Ok(invoice)
            })
            .await?;
        self.changed(&[Entity::Invoices, Entity::Entries]);
        Ok(out)
    }

    async fn invoice_lines(&self, invoice_id: &str) -> Result<Vec<InvoiceLine>> {
        let invoice_id = invoice_id.to_owned();
        self.run(move |_, c| {
            INVOICES.get::<Invoice>(c, &invoice_id)?;
            invoice_lines_of(c, &invoice_id)
        })
        .await
    }

    async fn save_invoice_lines(&self, invoice_id: &str, lines: Vec<InvoiceLine>) -> Result<()> {
        let invoice_id = invoice_id.to_owned();
        self.run(move |inner, c| {
            let tx = c.transaction()?;
            let inv: Invoice = INVOICES.get(&tx, &invoice_id)?;
            if inv.status != InvoiceStatus::Draft {
                return Err(DataError::Validation("Kan kun redigere linjer på kladde-fakturaer".into()));
            }
            if lines.iter().any(|l| l.description.trim().is_empty()) {
                return Err(DataError::Validation("Linjen mangler en beskrivelse".into()));
            }
            tx.execute("DELETE FROM invoice_lines WHERE invoice_id = ?1", [&invoice_id])?;
            for l in &lines {
                insert_line(&tx, &invoice_id, l)?;
            }
            // Poster, hvis linje er fjernet, er ikke længere faktureret.
            tx.execute(
                "UPDATE time_entries SET is_billed = 0, invoice_id = NULL
                 WHERE invoice_id = ?1 AND id NOT IN
                   (SELECT time_entry_id FROM invoice_lines WHERE invoice_id = ?1 AND time_entry_id IS NOT NULL)",
                [&invoice_id],
            )?;
            tx.execute(
                "UPDATE invoices SET amount = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![lines_total(&lines).to_string(), now_str(inner), invoice_id],
            )?;
            tx.commit()?;
            Ok(())
        })
        .await?;
        self.changed(&[Entity::Invoices, Entity::Entries]);
        Ok(())
    }

    async fn send_invoice(&self, id: &str) -> Result<Invoice> {
        let id = id.to_owned();
        let out = self
            .run(move |inner, c| {
                let tx = c.transaction()?;
                let mut inv: Invoice = INVOICES.get(&tx, &id)?;
                if inv.status == InvoiceStatus::Draft {
                    let issued: Vec<String> = tx
                        .prepare("SELECT invoice_number FROM invoices WHERE status <> 'draft'")?
                        .query_map([], |r| r.get(0))?
                        .collect::<rusqlite::Result<_>>()?;
                    // Med en fakturaopsætning: brugerens præfiks og tæller
                    // (som 0.2). Ellers web's "INV-001"-række.
                    inv.invoice_number = match invoice_profile_of(&tx)? {
                        Some(mut p) => {
                            let (number, n) = p.next_invoice_number(issued.iter().map(String::as_str));
                            p.next_number = n.saturating_add(1);
                            let json = serde_json::to_string(&p)
                                .map_err(|e| DataError::Storage(e.to_string()))?;
                            tx.execute(
                                "UPDATE settings SET value = ?1 WHERE key = ?2",
                                [json.as_str(), INVOICE_PROFILE_KEY],
                            )?;
                            number
                        }
                        None => inner.rules.next_invoice_number(&issued),
                    };
                    inv.issue_date = Some((inner.clock)());
                }
                // Lokal tilstand: udsted uden mail (PDF og eksport i appen).
                inv.status = InvoiceStatus::Sent;
                inv.updated_at = Some((inner.clock)());
                INVOICES.update(&tx, &id, &inv)?;
                tx.commit()?;
                Ok(inv)
            })
            .await?;
        self.changed(&[Entity::Invoices]);
        Ok(out)
    }

    async fn mark_invoice_paid(&self, id: &str, paid_date: Option<NaiveDate>) -> Result<Invoice> {
        let id = id.to_owned();
        let out = self
            .run(move |inner, c| {
                let mut inv: Invoice = INVOICES.get(c, &id)?;
                if inv.status == InvoiceStatus::Draft {
                    return Err(DataError::Validation("En kladde kan ikke markeres betalt".into()));
                }
                inv.status = InvoiceStatus::Paid;
                inv.paid_date = Some(
                    paid_date
                        .and_then(|d| d.and_hms_opt(0, 0, 0))
                        .map(|d| d.and_utc())
                        .unwrap_or_else(|| (inner.clock)()),
                );
                inv.updated_at = Some((inner.clock)());
                INVOICES.update(c, &id, &inv)?;
                Ok(inv)
            })
            .await?;
        self.changed(&[Entity::Invoices]);
        Ok(out)
    }

    // ---------------------------------------------------------------- rapporter

    async fn report(&self, query: ReportQuery) -> Result<Report> {
        self.run(move |_, c| {
            let (tail, params) = entry_filter_sql(&EntryFilter {
                start_date: Some(query.start_date),
                end_date: Some(query.end_date),
                ..EntryFilter::default()
            });
            let entries: Vec<TimeEntry> = ENTRIES.query(c, &tail, params)?;
            let clients: Vec<Client> = CLIENTS.query(c, "", vec![])?;
            let projects: Vec<Project> = PROJECTS.query(c, "", vec![])?;
            Ok(build_report(&query, &entries, &Names::new(&clients, &projects)))
        })
        .await
    }

    // ---------------------------------------------------------------- regler

    async fn matching_rules(&self) -> Result<Vec<MatchingRule>> {
        self.run(|_, c| {
            let mut rules: Vec<MatchingRule> = RULES.query(c, "ORDER BY updated_at", vec![])?;
            let projects: Vec<Project> = PROJECTS.query(c, "WHERE status = 'active'", vec![])?;
            rules.extend(project_rules(&projects));
            Ok(rules)
        })
        .await
    }

    async fn upsert_rule(&self, mut rule: MatchingRule) -> Result<MatchingRule> {
        if rule.source == RuleSource::Project {
            return Err(DataError::Validation("Projekt-mønstre rettes på projektet".into()));
        }
        if rule.pattern.trim().is_empty() {
            return Err(DataError::Validation("Mønsteret er tomt".into()));
        }
        let out = self
            .run(move |inner, c| {
                if rule.id.is_empty() {
                    rule.id = new_id();
                }
                rule.updated_at = Some((inner.clock)());
                c.execute("DELETE FROM matching_rules WHERE id = ?1", [&rule.id])?;
                RULES.insert(c, &rule)?;
                Ok(rule)
            })
            .await?;
        self.changed(&[Entity::Rules]);
        Ok(out)
    }

    async fn delete_rule(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |_, c| {
            let n = c.execute("DELETE FROM matching_rules WHERE id = ?1", [&id])?;
            if n == 0 { Err(DataError::NotFound) } else { Ok(()) }
        })
        .await?;
        self.changed(&[Entity::Rules]);
        Ok(())
    }
}

impl LocalRepo {
    async fn set_client_archived(&self, id: &str, archived: bool) -> Result<()> {
        let id = id.to_owned();
        self.run(move |inner, c| {
            let n = c.execute(
                "UPDATE clients SET is_archived = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![archived as i32, now_str(inner), id],
            )?;
            if n == 0 { Err(DataError::NotFound) } else { Ok(()) }
        })
        .await?;
        self.changed(&[Entity::Clients]);
        Ok(())
    }
}

fn insert_line(conn: &Connection, invoice_id: &str, l: &InvoiceLine) -> Result<()> {
    conn.execute(
        "INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            l.id.clone().unwrap_or_else(new_id),
            invoice_id,
            l.description,
            l.quantity.to_string(),
            l.unit_price.to_string(),
            l.amount.to_string(),
            l.time_entry_id,
            l.sort_order
        ],
    )?;
    Ok(())
}

/// Projekters `urlPatterns` som regler (samme form som `getUrlPatterns`).
pub fn project_rules(projects: &[Project]) -> Vec<MatchingRule> {
    projects
        .iter()
        .flat_map(|p| {
            p.url_patterns.iter().enumerate().map(move |(i, pattern)| MatchingRule {
                id: format!("project:{}:{i}", p.id),
                kind: RuleKind::UrlPattern,
                pattern: pattern.clone(),
                project_id: Some(p.id.clone()),
                client_id: p.client_id.clone(),
                source: RuleSource::Project,
                confirmations: 0,
                not_work: false,
                updated_at: p.updated_at,
            })
        })
        .collect()
}
