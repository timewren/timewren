use crate::commands::invoices::{InvoiceDraft, InvoiceLine};
use crate::db::Database;
use crate::i18n;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Preview of entries that will be included in the auto-generated invoice.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoInvoicePreview {
    pub entry_count: usize,
    pub total_hours: f64,
    pub total_amount: f64,
    pub lines: Vec<PreviewLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewLine {
    pub description: String,
    pub hours: f64,
    pub rate: f64,
    pub amount: f64,
    pub entry_count: usize,
}

/// Preview what entries would be included in the auto-generated invoice.
#[tauri::command]
pub fn preview_klippekort_invoice(
    db: State<'_, Database>,
    klippekort_id: String,
    from: String,
    to: String,
) -> Result<AutoInvoicePreview, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Fetch klippekort to get client_id and rate. Fall back to the global default
    // rate (project → client → global hierarchy) when the klippekort has no rate.
    let default_rate = crate::commands::invoices::global_default_rate(&conn);
    let (client_id, hourly_rate): (String, f64) = conn
        .query_row(
            "SELECT client_id, COALESCE(hourly_rate, ?2) FROM klippekort WHERE id = ?1",
            rusqlite::params![klippekort_id, default_rate],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| i18n::t_fmt("autoInvoice.klippekortNotFound", &[&e.to_string()]))?;

    // Only uncovered work: legacy links and recorded deductions independently
    // exclude prepaid time. A partially covered entry is not automatic overage.
    let from_dt = format!("{}T00:00:00", from);
    let to_dt = format!("{}T23:59:59", to);

    let mut stmt = conn
        .prepare_cached(
            "SELECT t.id, t.description, t.duration,
                    COALESCE(p.hourly_rate, c.hourly_rate, ?1) as rate,
                    p.name as project_name
             FROM time_entries t
             LEFT JOIN projects p ON t.project_id = p.id
             LEFT JOIN clients c ON t.client_id = c.id
             WHERE t.client_id = ?2
               AND t.start_time >= ?3 AND t.start_time <= ?4
               AND t.is_running = 0
               AND t.is_billable = 1
               AND t.klippekort_id IS NULL
               AND t.klippekort_deducted_hours = 0
             ORDER BY t.start_time ASC",
        )
        .map_err(|e| e.to_string())?;

    let entries: Vec<BillableEntry> = stmt
        .query_map(
            rusqlite::params![hourly_rate, client_id, from_dt, to_dt],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if entries.is_empty() {
        return Ok(AutoInvoicePreview {
            entry_count: 0,
            total_hours: 0.0,
            total_amount: 0.0,
            lines: Vec::new(),
        });
    }

    // Group entries by description+rate
    let groups = group_entries(&entries);

    let mut preview_lines = Vec::new();
    let mut total_hours = 0.0;
    let mut total_amount = 0.0;

    for group in &groups {
        let hours = group.total_seconds as f64 / 3600.0;
        let amount = hours * group.rate;
        total_hours += hours;
        total_amount += amount;

        preview_lines.push(PreviewLine {
            description: group.description.clone(),
            hours,
            rate: group.rate,
            amount,
            entry_count: group.entry_ids.len(),
        });
    }

    Ok(AutoInvoicePreview {
        entry_count: entries.len(),
        total_hours,
        total_amount,
        lines: preview_lines,
    })
}

/// Invoice uncovered billable work for the client within the given date range.
/// This does not sell or activate a renewed prepaid package.
#[tauri::command]
pub fn generate_invoice_from_klippekort(
    db: State<'_, Database>,
    klippekort_id: String,
    from: String,
    to: String,
) -> Result<InvoiceDraft, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 1. Fetch klippekort with client info. Fall back to the global default rate
    // (project → client → global hierarchy) when the klippekort has no rate.
    let default_rate = crate::commands::invoices::global_default_rate(&conn);
    let (client_id, klippekort_name, hourly_rate): (String, String, f64) = conn
        .query_row(
            "SELECT client_id, name, COALESCE(hourly_rate, ?2) FROM klippekort WHERE id = ?1",
            rusqlite::params![klippekort_id, default_rate],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| i18n::t_fmt("autoInvoice.klippekortNotFound", &[&e.to_string()]))?;

    let client_name: String = conn
        .query_row(
            "SELECT name FROM clients WHERE id = ?1",
            rusqlite::params![client_id],
            |row| row.get(0),
        )
        .map_err(|e| i18n::t_fmt("autoInvoice.clientNotFound", &[&e.to_string()]))?;

    // 2. Fetch only uncovered billable time, matching the preview's safety guard.
    let from_dt = format!("{}T00:00:00", from);
    let to_dt = format!("{}T23:59:59", to);

    let mut stmt = conn
        .prepare_cached(
            "SELECT t.id, t.description, t.duration,
                    COALESCE(p.hourly_rate, c.hourly_rate, ?1) as rate,
                    p.name as project_name
             FROM time_entries t
             LEFT JOIN projects p ON t.project_id = p.id
             LEFT JOIN clients c ON t.client_id = c.id
             WHERE t.client_id = ?2
               AND t.start_time >= ?3 AND t.start_time <= ?4
               AND t.is_running = 0
               AND t.is_billable = 1
               AND t.klippekort_id IS NULL
               AND t.klippekort_deducted_hours = 0
             ORDER BY t.start_time ASC",
        )
        .map_err(|e| e.to_string())?;

    let entries: Vec<BillableEntry> = stmt
        .query_map(
            rusqlite::params![hourly_rate, client_id, from_dt, to_dt],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if entries.is_empty() {
        return Err(i18n::t("autoInvoice.noEntries"));
    }

    // 3. Group entries by project and description
    let groups = group_entries(&entries);

    // 4. Create invoice draft
    let invoice_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let title = format!("{} - {} ({})", i18n::t("export.invoice"), client_name, klippekort_name);

    let due_date = (chrono::Utc::now() + chrono::Duration::days(14))
        .format("%Y-%m-%d")
        .to_string();

    // Wrap draft + lines + totals in one RAII transaction so a failure midway
    // can never leave a half-written invoice (draft with no/partial lines or
    // stale totals). Rolls back automatically on any early return.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO invoice_drafts (id, client_id, title, status, subtotal, vat_rate, total, due_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'draft', 0, 25.0, 0, ?4, ?5, ?5)",
        rusqlite::params![invoice_id, client_id, title, due_date, now],
    )
    .map_err(|e| e.to_string())?;

    // 5. Create invoice lines from grouped entries
    for (sort_order, group) in groups.iter().enumerate() {
        let hours = group.total_seconds as f64 / 3600.0;
        let amount = hours * group.rate;
        let first_entry_id = group.entry_ids.first();

        tx.execute(
            "INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                invoice_id,
                group.description,
                hours,
                group.rate,
                amount,
                first_entry_id,
                sort_order as i32,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // 6. Calculate subtotal, VAT (25%), total
    let subtotal: f64 = tx
        .query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM invoice_lines WHERE invoice_id = ?1",
            rusqlite::params![invoice_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let total = subtotal + subtotal * 0.25;

    tx.execute(
        "UPDATE invoice_drafts SET subtotal = ?1, total = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![subtotal, total, now, invoice_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    // 7. Return the created invoice
    let mut invoice = conn
        .query_row(
            "SELECT d.id, d.client_id, c.name, d.title, d.status, d.subtotal, d.vat_rate,
                    d.total, d.due_date, d.notes, d.created_at, d.updated_at
             FROM invoice_drafts d
             LEFT JOIN clients c ON d.client_id = c.id
             WHERE d.id = ?1",
            rusqlite::params![invoice_id],
            |row| {
                Ok(InvoiceDraft {
                    id: row.get(0)?,
                    client_id: row.get(1)?,
                    client_name: row.get(2)?,
                    title: row.get(3)?,
                    status: row.get(4)?,
                    subtotal: row.get(5)?,
                    vat_rate: row.get(6)?,
                    total: row.get(7)?,
                    due_date: row.get(8)?,
                    notes: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    invoice_number: None,
                    lines: Vec::new(),
                })
            },
        )
        .map_err(|e| e.to_string())?;

    // Load lines
    let mut line_stmt = conn
        .prepare_cached(
            "SELECT id, invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order
             FROM invoice_lines
             WHERE invoice_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    invoice.lines = line_stmt
        .query_map(rusqlite::params![invoice_id], |row| {
            Ok(InvoiceLine {
                id: row.get(0)?,
                invoice_id: row.get(1)?,
                description: row.get(2)?,
                quantity: row.get(3)?,
                unit_price: row.get(4)?,
                amount: row.get(5)?,
                time_entry_id: row.get(6)?,
                sort_order: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(invoice)
}

/// En fakturerbar registrering, hentet rå: id, beskrivelse, varighed i
/// sekunder, sats og projektnavn.
///
/// Navngiven, fordi fem felter i en tupel ikke kan holdes i hovedet på tre
/// steder — de to forespørgsler og den funktion der grupperer dem.
type BillableEntry = (String, Option<String>, Option<i64>, f64, Option<String>);

/// Internal helper to group entries by description+rate.
struct EntryGroup {
    description: String,
    total_seconds: i64,
    rate: f64,
    entry_ids: Vec<String>,
}

fn group_entries(entries: &[BillableEntry]) -> Vec<EntryGroup> {
    let mut groups: Vec<EntryGroup> = Vec::new();

    for (entry_id, desc, duration, rate, project_name) in entries {
        let label = if let Some(d) = desc {
            if d.is_empty() {
                project_name
                    .clone()
                    .unwrap_or_else(|| i18n::t("autoInvoice.defaultLineLabel"))
            } else {
                d.clone()
            }
        } else {
            project_name
                .clone()
                .unwrap_or_else(|| i18n::t("autoInvoice.defaultLineLabel"))
        };

        let key = format!("{}|{}", label, rate);

        if let Some(group) = groups
            .iter_mut()
            .find(|g| format!("{}|{}", g.description, g.rate) == key)
        {
            group.total_seconds += duration.unwrap_or(0);
            group.entry_ids.push(entry_id.clone());
        } else {
            groups.push(EntryGroup {
                description: label,
                total_seconds: duration.unwrap_or(0),
                rate: *rate,
                entry_ids: vec![entry_id.clone()],
            });
        }
    }

    groups
}
