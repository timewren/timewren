use crate::db::Database;
use crate::i18n;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceDraft {
    pub id: String,
    pub client_id: String,
    pub client_name: Option<String>,
    pub title: Option<String>,
    pub status: String,
    pub subtotal: Option<f64>,
    pub vat_rate: f64,
    pub total: Option<f64>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
    pub invoice_number: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub lines: Vec<InvoiceLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceLine {
    pub id: i64,
    pub invoice_id: String,
    pub description: Option<String>,
    pub quantity: Option<f64>,
    pub unit_price: Option<f64>,
    pub amount: Option<f64>,
    pub time_entry_id: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLineInput {
    pub description: Option<String>,
    pub quantity: Option<f64>,
    pub unit_price: Option<f64>,
    pub amount: Option<f64>,
    pub time_entry_id: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInvoiceInput {
    pub id: String,
    pub title: Option<String>,
    pub status: Option<String>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
    pub vat_rate: Option<f64>,
}

const INVOICE_SELECT: &str =
    "SELECT d.id, d.client_id, c.name, d.title, d.status, d.subtotal, d.vat_rate,
            d.total, d.due_date, d.notes, d.created_at, d.updated_at, d.invoice_number
     FROM invoice_drafts d
     LEFT JOIN clients c ON d.client_id = c.id";

fn row_to_invoice(row: &rusqlite::Row) -> rusqlite::Result<InvoiceDraft> {
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
        invoice_number: row.get(12)?,
        lines: Vec::new(), // populated separately
    })
}

fn load_lines(conn: &rusqlite::Connection, invoice_id: &str) -> Result<Vec<InvoiceLine>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order
             FROM invoice_lines
             WHERE invoice_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
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
        .map_err(|e| e.to_string())?;

    let mut lines = Vec::new();
    for row in rows {
        lines.push(row.map_err(|e| e.to_string())?);
    }
    Ok(lines)
}

/// Load all invoice lines in a single query, grouped by invoice_id.
/// Avoids N+1 when listing invoices.
fn load_all_lines(conn: &rusqlite::Connection) -> Result<std::collections::HashMap<String, Vec<InvoiceLine>>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order
             FROM invoice_lines
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
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
        .map_err(|e| e.to_string())?;

    let mut map: std::collections::HashMap<String, Vec<InvoiceLine>> = std::collections::HashMap::new();
    for row in rows {
        let line = row.map_err(|e| e.to_string())?;
        map.entry(line.invoice_id.clone()).or_default().push(line);
    }
    Ok(map)
}

/// Reads the global default hourly rate from settings (stored as a string).
/// Returns 0.0 if unset or unparseable. Used as the final fallback in the
/// project → client → global rate hierarchy.
pub(crate) fn global_default_rate(conn: &rusqlite::Connection) -> f64 {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'default_hourly_rate'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.trim().replace(',', ".").parse::<f64>().ok())
    .filter(|r| r.is_finite() && *r >= 0.0)
    .unwrap_or(0.0)
}

fn recalculate_totals(conn: &rusqlite::Connection, invoice_id: &str) -> Result<(), String> {
    let subtotal: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM invoice_lines WHERE invoice_id = ?1",
            rusqlite::params![invoice_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let vat_rate: f64 = conn
        .query_row(
            "SELECT vat_rate FROM invoice_drafts WHERE id = ?1",
            rusqlite::params![invoice_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let total = subtotal + subtotal * (vat_rate / 100.0);
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE invoice_drafts SET subtotal = ?1, total = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![subtotal, total, now, invoice_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_invoices(
    db: State<'_, Database>,
    status: Option<String>,
) -> Result<Vec<InvoiceDraft>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match &status {
        Some(s) => (
            format!(
                "{} WHERE d.status = ?1 ORDER BY d.updated_at DESC",
                INVOICE_SELECT
            ),
            vec![Box::new(s.clone())],
        ),
        None => (
            format!("{} ORDER BY d.updated_at DESC", INVOICE_SELECT),
            vec![],
        ),
    };

    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(params_refs.as_slice(), row_to_invoice)
        .map_err(|e| e.to_string())?;

    let mut invoices = Vec::new();
    for row in rows {
        invoices.push(row.map_err(|e| e.to_string())?);
    }

    // Batch-load all lines in a single query instead of N+1
    if !invoices.is_empty() {
        let all_lines = load_all_lines(&conn)?;
        for invoice in &mut invoices {
            if let Some(lines) = all_lines.get(&invoice.id) {
                invoice.lines = lines.clone();
            }
        }
    }

    Ok(invoices)
}

#[tauri::command]
pub fn get_invoice(db: State<'_, Database>, id: String) -> Result<InvoiceDraft, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut invoice = conn
        .query_row(
            &format!("{} WHERE d.id = ?1", INVOICE_SELECT),
            rusqlite::params![id],
            row_to_invoice,
        )
        .map_err(|e| i18n::t_fmt("export.invoiceNotFound", &[&e.to_string()]))?;

    invoice.lines = load_lines(&conn, &invoice.id)?;
    Ok(invoice)
}

#[tauri::command]
pub fn create_invoice_from_entries(
    db: State<'_, Database>,
    client_id: String,
    entry_ids: Vec<String>,
) -> Result<InvoiceDraft, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    if entry_ids.is_empty() {
        return Err("Vælg mindst en tidsregistrering".to_string());
    }

    // Fetch client name for the invoice title
    let client_name: String = conn
        .query_row(
            "SELECT name FROM clients WHERE id = ?1",
            rusqlite::params![client_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Klient ikke fundet: {}", e))?;

    // Global default rate: final fallback in project → client → global hierarchy.
    let default_rate = global_default_rate(&conn);

    // Load selected time entries with rate info
    let placeholders = entry_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT t.id, t.description, t.duration,
                COALESCE(p.hourly_rate, c.hourly_rate, ?1) as rate,
                p.name as project_name
         FROM time_entries t
         LEFT JOIN projects p ON t.project_id = p.id
         LEFT JOIN clients c ON t.client_id = c.id
         WHERE t.id IN ({})
         ORDER BY t.start_time ASC",
        placeholders
    );

    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let mut params: Vec<&dyn rusqlite::types::ToSql> = vec![&default_rate];
    params.extend(entry_ids.iter().map(|id| id as &dyn rusqlite::types::ToSql));

    #[allow(clippy::type_complexity)]
    let entries: Vec<(String, Option<String>, Option<i64>, f64, Option<String>)> = stmt
        .query_map(params.as_slice(), |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Group entries by description+rate to create invoice lines
    struct LineAccum {
        description: String,
        total_seconds: i64,
        rate: f64,
        entry_ids: Vec<String>,
    }

    let mut groups: Vec<LineAccum> = Vec::new();

    for (entry_id, desc, duration, rate, project_name) in &entries {
        let label = if let Some(d) = desc {
            if d.is_empty() {
                project_name.clone().unwrap_or("Konsulentarbejde".to_string())
            } else {
                d.clone()
            }
        } else {
            project_name.clone().unwrap_or("Konsulentarbejde".to_string())
        };

        let key = format!("{}|{}", label, rate);

        if let Some(group) = groups.iter_mut().find(|g| format!("{}|{}", g.description, g.rate) == key) {
            group.total_seconds += duration.unwrap_or(0);
            group.entry_ids.push(entry_id.clone());
        } else {
            groups.push(LineAccum {
                description: label,
                total_seconds: duration.unwrap_or(0),
                rate: *rate,
                entry_ids: vec![entry_id.clone()],
            });
        }
    }

    // Create the invoice draft
    let invoice_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let title = format!("{} - {}", i18n::t("export.invoice"), client_name);

    // Default due date: 14 days from now
    let due_date = (chrono::Utc::now() + chrono::Duration::days(14))
        .format("%Y-%m-%d")
        .to_string();

    // Wrap draft + lines + totals in one RAII transaction so a failure midway
    // can never leave a half-written invoice. Rolls back on any early return.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO invoice_drafts (id, client_id, title, status, subtotal, vat_rate, total, due_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'draft', 0, 25.0, 0, ?4, ?5, ?5)",
        rusqlite::params![invoice_id, client_id, title, due_date, now],
    )
    .map_err(|e| e.to_string())?;

    // Create invoice lines from grouped entries
    for (sort_order, group) in groups.iter().enumerate() {
        let hours = group.total_seconds as f64 / 3600.0;
        let amount = hours * group.rate;

        // Link to first entry in the group
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

    // Recalculate totals within the same transaction (sees uncommitted lines)
    recalculate_totals(&tx, &invoice_id)?;

    tx.commit().map_err(|e| e.to_string())?;

    // Return the full invoice
    let mut invoice = conn
        .query_row(
            &format!("{} WHERE d.id = ?1", INVOICE_SELECT),
            rusqlite::params![invoice_id],
            row_to_invoice,
        )
        .map_err(|e| e.to_string())?;

    invoice.lines = load_lines(&conn, &invoice_id)?;
    Ok(invoice)
}

#[tauri::command]
pub fn update_invoice(
    db: State<'_, Database>,
    input: UpdateInvoiceInput,
) -> Result<InvoiceDraft, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    // Build dynamic update query
    let mut sets = vec!["updated_at = ?1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    let mut idx = 2;

    if let Some(ref title) = input.title {
        sets.push(format!("title = ?{}", idx));
        params.push(Box::new(title.clone()));
        idx += 1;
    }
    if let Some(ref status) = input.status {
        sets.push(format!("status = ?{}", idx));
        params.push(Box::new(status.clone()));
        idx += 1;
    }
    if let Some(ref due_date) = input.due_date {
        sets.push(format!("due_date = ?{}", idx));
        params.push(Box::new(due_date.clone()));
        idx += 1;
    }
    if let Some(ref notes) = input.notes {
        sets.push(format!("notes = ?{}", idx));
        params.push(Box::new(notes.clone()));
        idx += 1;
    }
    if let Some(vat_rate) = input.vat_rate {
        sets.push(format!("vat_rate = ?{}", idx));
        params.push(Box::new(vat_rate));
        idx += 1;
    }

    let sql = format!(
        "UPDATE invoice_drafts SET {} WHERE id = ?{}",
        sets.join(", "),
        idx
    );
    params.push(Box::new(input.id.clone()));

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())
        .map_err(|e| e.to_string())?;

    // Recalculate if vat_rate changed
    if input.vat_rate.is_some() {
        recalculate_totals(&conn, &input.id)?;
    }

    // Return updated invoice
    let mut invoice = conn
        .query_row(
            &format!("{} WHERE d.id = ?1", INVOICE_SELECT),
            rusqlite::params![input.id],
            row_to_invoice,
        )
        .map_err(|e| e.to_string())?;

    invoice.lines = load_lines(&conn, &input.id)?;
    Ok(invoice)
}

#[tauri::command]
pub fn add_invoice_line(
    db: State<'_, Database>,
    invoice_id: String,
    line: CreateLineInput,
) -> Result<InvoiceLine, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let amount = line.amount.unwrap_or_else(|| {
        line.quantity.unwrap_or(0.0) * line.unit_price.unwrap_or(0.0)
    });

    conn.execute(
        "INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            invoice_id,
            line.description,
            line.quantity,
            line.unit_price,
            amount,
            line.time_entry_id,
            line.sort_order.unwrap_or(0),
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    // Recalculate totals
    recalculate_totals(&conn, &invoice_id)?;

    Ok(InvoiceLine {
        id,
        invoice_id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        amount: Some(amount),
        time_entry_id: line.time_entry_id,
        sort_order: line.sort_order.unwrap_or(0),
    })
}

/// Ændrer én fakturalinje **på plads**.
///
/// Findes fordi frontend før slettede linjen og oprettede den igen, fordi der
/// ikke var en opdateringskommando. Det er to skrivninger, så en fejl i den
/// anden efterlod fakturaen med linjen **fjernet**: brugeren rettede en
/// enhedspris, skærmen viste den nye pris, og beløbet og linjen var væk fra
/// fakturaen han er ved at sende til kunden. En `UPDATE` er én skrivning, så
/// den kan kun lykkes eller fejle som helhed.
///
/// `amount` følger samme regel som `add_invoice_line`: er den ikke sendt med,
/// er den antal × enhedspris. Ellers ville en redigeret beskrivelse alene
/// nulstille beløbet, fordi feltet ikke kan læses ændret.
#[tauri::command]
pub fn update_invoice_line(
    db: State<'_, Database>,
    line_id: i64,
    line: CreateLineInput,
) -> Result<InvoiceLine, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    update_line_kjerne(&mut conn, line_id, line)
}

/// Selve skrivningen, uden Tauri's `State`.
///
/// Udskilt fordi en `State<Database>` ikke kan konstrueres i en test, og en
/// funktion uden test er ikke en garanti: det er her, at «linjen må ikke
/// forsvinde ved en fejl» boede, og det er præcis den egenskab der skal
/// dømmes.
pub(crate) fn update_line_kjerne(
    conn: &mut Connection,
    line_id: i64,
    line: CreateLineInput,
) -> Result<InvoiceLine, String> {
    let amount = line.amount.unwrap_or_else(|| {
        line.quantity.unwrap_or(0.0) * line.unit_price.unwrap_or(0.0)
    });

    // Én transaktion om både linjen og totalerne, så en fejl i
    // `recalculate_totals` ikke efterlader beløbet på linjen uden en
    // tilsvarende linje — eller omvendt.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let (invoice_id, time_entry_id): (String, Option<String>) = tx
        .query_row(
            "SELECT invoice_id, time_entry_id FROM invoice_lines WHERE id = ?1",
            rusqlite::params![line_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| i18n::t_fmt("export.invoiceNotFound", &[&e.to_string()]))?;

    tx.execute(
        "UPDATE invoice_lines
         SET description = ?1, quantity = ?2, unit_price = ?3, amount = ?4, sort_order = ?5
         WHERE id = ?6",
        rusqlite::params![
            line.description,
            line.quantity,
            line.unit_price,
            amount,
            line.sort_order.unwrap_or(0),
            line_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    recalculate_totals(&tx, &invoice_id)?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(InvoiceLine {
        id: line_id,
        invoice_id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        amount: Some(amount),
        // Læst fra den eksisterende række, ikke fra input: `time_entry_id`
        // binder linjen til den registrerede tid, og den findes kun dér. Skrives
        // den ikke med i `UPDATE`, bevares den i databasen — men frontend
        // erstatter linjen med svaret her, så svaret skal have den med, ellers
        // mistede skærmen sporingen af hvilken tid der faktureres.
        time_entry_id,
        sort_order: line.sort_order.unwrap_or(0),
    })
}

#[tauri::command]
pub fn remove_invoice_line(
    db: State<'_, Database>,
    line_id: i64,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get invoice_id before deleting
    let invoice_id: String = conn
        .query_row(
            "SELECT invoice_id FROM invoice_lines WHERE id = ?1",
            rusqlite::params![line_id],
            |row| row.get(0),
        )
        .map_err(|e| i18n::t_fmt("export.invoiceNotFound", &[&e.to_string()]))?;

    conn.execute(
        "DELETE FROM invoice_lines WHERE id = ?1",
        rusqlite::params![line_id],
    )
    .map_err(|e| e.to_string())?;

    // Recalculate totals
    recalculate_totals(&conn, &invoice_id)?;

    Ok(())
}

#[tauri::command]
pub fn delete_invoice(db: State<'_, Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Delete lines first (foreign key)
    conn.execute(
        "DELETE FROM invoice_lines WHERE invoice_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM invoice_drafts WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reads a settings value as a trimmed string, or "" when unset.
fn setting_str(conn: &rusqlite::Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .map(|v| v.trim().to_string())
    .unwrap_or_default()
}

/// Verify the legally required sender fields are present before an invoice may be
/// finalised. Danish bookkeeping law (bogføringsloven) requires the issuer's own
/// CVR, address and a payment instruction on every invoice. Returns a clear Danish
/// error naming the missing fields so finalisation is blocked, not silently wrong.
fn validate_sender_fields(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut missing: Vec<&str> = Vec::new();

    if setting_str(conn, "user_name").is_empty() {
        missing.push("afsendernavn");
    }
    if setting_str(conn, "user_cvr").is_empty() {
        missing.push("CVR-nummer");
    }
    if setting_str(conn, "user_address").is_empty() {
        missing.push("adresse");
    }

    let has_bank =
        !setting_str(conn, "bank_reg").is_empty() && !setting_str(conn, "bank_konto").is_empty();
    let has_mobilepay = !setting_str(conn, "mobilepay_nr").is_empty();
    if !has_bank && !has_mobilepay {
        missing.push("betalingsoplysninger (bankkonto eller MobilePay)");
    }

    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Kan ikke færdiggøre faktura: udfyld {} under Indstillinger → Fakturaopsætning.",
            missing.join(", ")
        ))
    }
}

/// Highest numeric suffix already issued under `prefix` (0 if none). Invoice
/// numbers are stored as `{prefix}{n}`, so rows carrying the prefix have it
/// stripped and the remainder parsed as an integer; rows with a different
/// prefix (e.g. an earlier year's series) don't parse and are ignored. Used to
/// make numbering self-healing against a counter that was moved backward.
fn highest_issued_number(conn: &rusqlite::Connection, prefix: &str) -> Result<i64, String> {
    // Escape LIKE metacharacters in the prefix so a literal % or _ can't widen
    // the match.
    let escaped = prefix.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("{}%", escaped);
    let mut stmt = conn
        .prepare(
            "SELECT invoice_number FROM invoice_drafts
             WHERE invoice_number IS NOT NULL AND invoice_number != ''
               AND invoice_number LIKE ?1 ESCAPE '\\'",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![pattern], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut max = 0i64;
    for r in rows {
        let num = r.map_err(|e| e.to_string())?;
        if let Some(suffix) = num.strip_prefix(prefix) {
            if let Ok(n) = suffix.parse::<i64>() {
                max = max.max(n);
            }
        }
    }
    Ok(max)
}

/// Atomically assign the next invoice number to a draft, if it does not already
/// have one. Must be called inside a BEGIN IMMEDIATE transaction so that reading
/// `invoice_next_number`, stamping the draft and incrementing the counter happen
/// as one indivisible step — two sequential finalisations can therefore never
/// produce the same number or leave a gap. A draft that is already numbered keeps
/// its number (re-export must never renumber a sent invoice). The assigned number
/// always exceeds every number already issued under the prefix, so a manually
/// lowered counter can never cause a reuse.
pub(crate) fn assign_invoice_number(
    conn: &rusqlite::Connection,
    invoice_id: &str,
) -> Result<String, String> {
    // Keep an existing number untouched (idempotent re-finalisation).
    let existing: Option<String> = conn
        .query_row(
            "SELECT invoice_number FROM invoice_drafts WHERE id = ?1",
            rusqlite::params![invoice_id],
            |row| row.get(0),
        )
        .map_err(|_| "Faktura ikke fundet".to_string())?;
    if let Some(num) = existing {
        if !num.trim().is_empty() {
            return Ok(num);
        }
    }

    let prefix = setting_str(conn, "invoice_number_prefix");
    let stored_next: i64 = setting_str(conn, "invoice_next_number")
        .parse::<i64>()
        .ok()
        .filter(|n| *n >= 1)
        .unwrap_or(1);

    // Self-heal a mis-set counter: the number must ALWAYS exceed every number
    // already issued under this prefix. Otherwise lowering "Næste fakturanummer"
    // in settings would silently reuse a number — a bogføringslov-brud, since the
    // series must be unbroken and never reused. Advancing forward can never
    // create a reuse; it only skips the range the user already spent.
    let highest = highest_issued_number(conn, &prefix)?;
    let next = stored_next.max(highest + 1);

    let number = format!("{}{}", prefix, next);
    let now = chrono::Utc::now().to_rfc3339();

    // The `IS NULL OR = ''` guard makes the write a no-op if another path already
    // numbered this draft, so a lost update surfaces as an error rather than a
    // duplicate number.
    let updated = conn
        .execute(
            "UPDATE invoice_drafts SET invoice_number = ?1, updated_at = ?2
             WHERE id = ?3 AND (invoice_number IS NULL OR invoice_number = '')",
            rusqlite::params![number, now, invoice_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Faktura ikke fundet eller allerede nummereret".to_string());
    }

    // Advance the counter so the next finalisation gets the following number.
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('invoice_next_number', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![(next + 1).to_string()],
    )
    .map_err(|e| e.to_string())?;

    Ok(number)
}

/// Finalise a draft: validate the legally required sender fields, then assign the
/// next sequential invoice number in a single BEGIN IMMEDIATE transaction and mark
/// the draft as sent. Idempotent — a draft that already has a number keeps it.
#[tauri::command]
pub fn finalize_invoice(db: State<'_, Database>, invoice_id: String) -> Result<InvoiceDraft, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;

    validate_sender_fields(&conn)?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    assign_invoice_number(&tx, &invoice_id)?;
    // Promote a plain draft to "sent" once it carries a legal number. Leave any
    // other status (e.g. already "exported") as-is.
    tx.execute(
        "UPDATE invoice_drafts SET status = 'sent' WHERE id = ?1 AND status = 'draft'",
        rusqlite::params![invoice_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let mut invoice = conn
        .query_row(
            &format!("{} WHERE d.id = ?1", INVOICE_SELECT),
            rusqlite::params![invoice_id],
            row_to_invoice,
        )
        .map_err(|e| e.to_string())?;
    invoice.lines = load_lines(&conn, &invoice_id)?;
    Ok(invoice)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn
    }

    fn set_default_rate(conn: &Connection, value: &str) {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('default_hourly_rate', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![value],
        )
        .unwrap();
    }

    #[test]
    fn global_rate_zero_when_unset() {
        let conn = setup();
        assert_eq!(global_default_rate(&conn), 0.0);
    }

    #[test]
    fn global_rate_parses_setting() {
        let conn = setup();
        set_default_rate(&conn, "850");
        assert_eq!(global_default_rate(&conn), 850.0);
    }

    #[test]
    fn global_rate_accepts_danish_decimal_comma() {
        let conn = setup();
        set_default_rate(&conn, "850,50");
        assert_eq!(global_default_rate(&conn), 850.5);
    }

    #[test]
    fn global_rate_rejects_garbage_and_negatives() {
        let conn = setup();
        set_default_rate(&conn, "not-a-number");
        assert_eq!(global_default_rate(&conn), 0.0);
        set_default_rate(&conn, "-100");
        assert_eq!(global_default_rate(&conn), 0.0);
    }

    /// The project → client → global hierarchy: an entry with neither a project
    /// nor a client rate must invoice at the global default, not 0.
    #[test]
    fn rate_hierarchy_falls_back_to_global() {
        let conn = setup();
        set_default_rate(&conn, "900");

        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Acme')", [])
            .unwrap();
        // Project with no hourly_rate, client with no hourly_rate.
        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'Proj')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO time_entries (id, project_id, client_id, start_time, duration, source)
             VALUES ('e1', 'p1', 'c1', '2026-06-01T08:00:00Z', 3600, 'manual')",
            [],
        )
        .unwrap();

        let default_rate = global_default_rate(&conn);
        let rate: f64 = conn
            .query_row(
                "SELECT COALESCE(p.hourly_rate, c.hourly_rate, ?1)
                 FROM time_entries t
                 LEFT JOIN projects p ON t.project_id = p.id
                 LEFT JOIN clients c ON t.client_id = c.id
                 WHERE t.id = 'e1'",
                rusqlite::params![default_rate],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rate, 900.0, "should use global default, not 0");
    }

    /// A project rate must still win over the global default.
    #[test]
    fn rate_hierarchy_project_rate_wins() {
        let conn = setup();
        set_default_rate(&conn, "900");
        conn.execute("INSERT INTO clients (id, name, hourly_rate) VALUES ('c1', 'Acme', 700)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO projects (id, client_id, name, hourly_rate) VALUES ('p1', 'c1', 'Proj', 1200)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO time_entries (id, project_id, client_id, start_time, duration, source)
             VALUES ('e1', 'p1', 'c1', '2026-06-01T08:00:00Z', 3600, 'manual')",
            [],
        )
        .unwrap();

        let default_rate = global_default_rate(&conn);
        let rate: f64 = conn
            .query_row(
                "SELECT COALESCE(p.hourly_rate, c.hourly_rate, ?1)
                 FROM time_entries t
                 LEFT JOIN projects p ON t.project_id = p.id
                 LEFT JOIN clients c ON t.client_id = c.id
                 WHERE t.id = 'e1'",
                rusqlite::params![default_rate],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rate, 1200.0);
    }

    // --- Invoice numbering ---

    fn set_setting_raw(conn: &Connection, key: &str, value: &str) {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )
        .unwrap();
    }

    fn insert_draft(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO clients (id, name) VALUES (?1, 'Acme')",
            rusqlite::params![format!("client-{id}")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO invoice_drafts (id, client_id, status, created_at, updated_at)
             VALUES (?1, ?2, 'draft', '2026-06-01T08:00:00Z', '2026-06-01T08:00:00Z')",
            rusqlite::params![id, format!("client-{id}")],
        )
        .unwrap();
    }

    fn number_of(conn: &Connection, id: &str) -> Option<String> {
        conn.query_row(
            "SELECT invoice_number FROM invoice_drafts WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Two sequential finalisations must yield consecutive numbers — no gap, no
    /// reuse — and the counter must advance exactly once per assignment.
    #[test]
    fn sequential_finalisation_gives_gap_free_numbers() {
        let mut conn = setup();
        set_setting_raw(&conn, "invoice_number_prefix", "2026-");
        set_setting_raw(&conn, "invoice_next_number", "1");
        insert_draft(&conn, "inv-a");
        insert_draft(&conn, "inv-b");

        let n1 = {
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .unwrap();
            let n = assign_invoice_number(&tx, "inv-a").unwrap();
            tx.commit().unwrap();
            n
        };
        let n2 = {
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .unwrap();
            let n = assign_invoice_number(&tx, "inv-b").unwrap();
            tx.commit().unwrap();
            n
        };

        assert_eq!(n1, "2026-1");
        assert_eq!(n2, "2026-2");
        assert_ne!(n1, n2, "numbers must never be reused");
        assert_eq!(number_of(&conn, "inv-a").as_deref(), Some("2026-1"));
        assert_eq!(number_of(&conn, "inv-b").as_deref(), Some("2026-2"));
        assert_eq!(setting_str(&conn, "invoice_next_number"), "3");
    }

    /// Re-finalising an already-numbered draft must return the same number and must
    /// not touch the counter (a sent invoice is never renumbered on re-export).
    #[test]
    fn refinalisation_keeps_existing_number() {
        let mut conn = setup();
        set_setting_raw(&conn, "invoice_number_prefix", "");
        set_setting_raw(&conn, "invoice_next_number", "5");
        insert_draft(&conn, "inv-x");

        let first = {
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .unwrap();
            let n = assign_invoice_number(&tx, "inv-x").unwrap();
            tx.commit().unwrap();
            n
        };
        assert_eq!(first, "5");
        assert_eq!(setting_str(&conn, "invoice_next_number"), "6");

        let again = {
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .unwrap();
            let n = assign_invoice_number(&tx, "inv-x").unwrap();
            tx.commit().unwrap();
            n
        };
        assert_eq!(again, "5", "existing number must be preserved");
        assert_eq!(
            setting_str(&conn, "invoice_next_number"),
            "6",
            "counter must not advance on re-finalisation"
        );
    }

    /// A counter manually moved backward (via the settings UI) must NOT reuse an
    /// already-issued number: assignment self-heals forward past the highest
    /// existing number, upholding the legal "no reuse" guarantee.
    #[test]
    fn lowered_counter_never_reuses_a_number() {
        let mut conn = setup();
        set_setting_raw(&conn, "invoice_number_prefix", "2026-");
        set_setting_raw(&conn, "invoice_next_number", "1");
        insert_draft(&conn, "inv-a");
        insert_draft(&conn, "inv-b");
        insert_draft(&conn, "inv-c");

        let assign = |conn: &mut Connection, id: &str| -> String {
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .unwrap();
            let n = assign_invoice_number(&tx, id).unwrap();
            tx.commit().unwrap();
            n
        };

        assert_eq!(assign(&mut conn, "inv-a"), "2026-1");
        assert_eq!(assign(&mut conn, "inv-b"), "2026-2");

        // User mistakenly resets the counter backward.
        set_setting_raw(&conn, "invoice_next_number", "1");

        // The third invoice must still get 2026-3, never a reused 2026-1/2026-2.
        let third = assign(&mut conn, "inv-c");
        assert_eq!(third, "2026-3", "must skip past used numbers, not reuse");
        assert_ne!(third, "2026-1");
        assert_ne!(third, "2026-2");
        assert_eq!(setting_str(&conn, "invoice_next_number"), "4");
    }

    /// Missing legally required sender fields must block finalisation with an error
    /// that names the missing fields; a fully configured sender passes.
    #[test]
    fn validation_blocks_missing_sender_fields() {
        let conn = setup();
        let err = validate_sender_fields(&conn).unwrap_err();
        assert!(err.contains("afsendernavn"), "should name missing name: {err}");
        assert!(err.contains("CVR"), "should name missing CVR: {err}");
        assert!(err.contains("adresse"), "should name missing address: {err}");
        assert!(err.contains("betalingsoplysninger"), "should name payment: {err}");

        set_setting_raw(&conn, "user_name", "Jens Hansen");
        set_setting_raw(&conn, "user_cvr", "12345678");
        set_setting_raw(&conn, "user_address", "Vej 1, 1000 Kbh");
        set_setting_raw(&conn, "mobilepay_nr", "12345");
        assert!(validate_sender_fields(&conn).is_ok());
    }

    // --- Fakturalinjer: redigering må aldrig slette linjen ---

    /// En faktura med to linjer, hvor den første er bundet til registreret tid.
    fn insert_linje(conn: &Connection, invoice_id: &str, amount: f64, order: i32) -> i64 {
        // `time_entry_id` er en fremmednøgle, så tidsregistreringen skal findes
        // før linjen kan bindes til den — ellers afviser SQLite rækken.
        conn.execute(
            "INSERT OR IGNORE INTO time_entries (id, start_time) VALUES ('e1', '2026-06-01T08:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order)
             VALUES (?1, 'Arbejde', 1, ?2, ?3, 'e1', ?4)",
            rusqlite::params![invoice_id, amount, amount, order],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn linjer(conn: &Connection, invoice_id: &str) -> Vec<(i64, f64)> {
        let mut stmt = conn
            .prepare("SELECT id, amount FROM invoice_lines WHERE invoice_id = ?1 ORDER BY id")
            .unwrap();
        let rå = stmt
            .query_map(rusqlite::params![invoice_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        rå.map(|r| r.unwrap()).collect()
    }

    fn subtotal(conn: &Connection, invoice_id: &str) -> f64 {
        conn.query_row(
            "SELECT subtotal FROM invoice_drafts WHERE id = ?1",
            rusqlite::params![invoice_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// `total` er inkl. moms. `insert_draft` lader schemagens 25 % stå, så
    /// formlen er `subtotal × 1,25` — en hårdkodet 1700 ville være en test der
    /// lå om en anden sats.
    fn total(conn: &Connection, invoice_id: &str) -> f64 {
        conn.query_row(
            "SELECT total FROM invoice_drafts WHERE id = ?1",
            rusqlite::params![invoice_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Den egenskab hele opgaven handler om: en redigering **beholder linjen**.
    ///
    /// Den gamle frontend slettede linjen og oprettede den igen i to separate
    /// `invoke`-kald. Denne test kan ikke køre den kode, men den dømmer den
    /// egenskab, der gør den ulovlig: efter en vellykket redigering er der
    /// stadig præcis to linjer, og den redigerede har **samme id** — altså er
    /// den samme række, ikke en ny der så ud som den.
    #[test]
    fn redigering_beholder_antallet_af_linjer() {
        let mut conn = setup();
        insert_draft(&conn, "inv-x");
        let første = insert_linje(&conn, "inv-x", 1000.0, 0);
        insert_linje(&conn, "inv-x", 500.0, 1);

        update_line_kjerne(
            &mut conn,
            første,
            CreateLineInput {
                description: Some("Korrigeret".into()),
                quantity: Some(2.0),
                unit_price: Some(600.0),
                amount: Some(1200.0),
                time_entry_id: None,
                sort_order: Some(0),
            },
        )
        .unwrap();

        let efter = linjer(&conn, "inv-x");
        assert_eq!(efter.len(), 2, "linjer må ikke forsvinde ved redigering");
        assert_eq!(efter[0].0, første, "samme række, ikke en ny");
        assert_eq!(efter[0].1, 1200.0);
        assert_eq!(subtotal(&conn, "inv-x"), 1700.0);
        assert_eq!(total(&conn, "inv-x"), 1700.0 * 1.25);
    }

    /// Bindingen til den registrerede tid overlever en redigering.
    ///
    /// `time_entry_id` står ikke i `UPDATE` — den ligger i den række der bliver
    /// liggende. Men frontend erstatter linjen med svaret, så *svaret* skal have
    /// den med, ellers mistede skærmen sporingen af hvilken tid der faktureres,
    /// selv om databasen stadig havde den.
    #[test]
    fn redigering_bevarer_tidsbindingen() {
        let mut conn = setup();
        insert_draft(&conn, "inv-y");
        let id = insert_linje(&conn, "inv-y", 1000.0, 0);

        let gemt = update_line_kjerne(
            &mut conn,
            id,
            CreateLineInput {
                description: Some("Korrigeret".into()),
                quantity: Some(1.0),
                unit_price: Some(1000.0),
                amount: Some(1000.0),
                time_entry_id: None,
                sort_order: Some(0),
            },
        )
        .unwrap();
        assert_eq!(gemt.time_entry_id.as_deref(), Some("e1"));

        let i_db: Option<String> = conn
            .query_row(
                "SELECT time_entry_id FROM invoice_lines WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(i_db.as_deref(), Some("e1"));
    }

    /// Uden `amount` regnes beløbet som antal × enhedspris — ellers nulstillede
    /// en redigeret beskrivelse alene beløbet, fordi feltet ikke kan læses ændret.
    #[test]
    fn beløb_uden_amount_regnes_af_prisen() {
        let mut conn = setup();
        insert_draft(&conn, "inv-z");
        let id = insert_linje(&conn, "inv-z", 1000.0, 0);

        let gemt = update_line_kjerne(
            &mut conn,
            id,
            CreateLineInput {
                description: Some("Kun beskrivelsen".into()),
                quantity: Some(3.0),
                unit_price: Some(250.0),
                amount: None,
                time_entry_id: None,
                sort_order: Some(0),
            },
        )
        .unwrap();
        assert_eq!(gemt.amount, Some(750.0));
        assert_eq!(subtotal(&conn, "inv-z"), 750.0);
        assert_eq!(total(&conn, "inv-z"), 750.0 * 1.25);
    }

    /// En linje der ikke findes må give en fejl, ikke oprette en ny.
    #[test]
    fn ukendt_linje_fejler_og_opretter_ikke() {
        let mut conn = setup();
        insert_draft(&conn, "inv-q");
        let fejl = update_line_kjerne(
            &mut conn,
            9999,
            CreateLineInput {
                description: Some("Spøgelseslinje".into()),
                quantity: Some(1.0),
                unit_price: Some(1.0),
                amount: Some(1.0),
                time_entry_id: None,
                sort_order: Some(0),
            },
        )
        .unwrap_err();
        assert!(fejl.contains("ikke fundet"), "{fejl}");
        assert!(linjer(&conn, "inv-q").is_empty());
    }
}
