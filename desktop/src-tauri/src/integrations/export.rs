use crate::db::Database;
use crate::i18n;
use rusqlite::Connection;
use tauri::State;

/// Export time entries as CSV content.
/// Returns the CSV string — the frontend handles the file save dialog.
/// Supports Danish (;) and international (,) separator.
/// Uses UTF-8 with BOM for Excel compatibility.
#[tauri::command]
pub fn export_time_entries_csv(
    db: State<'_, Database>,
    from: String,
    to: String,
    separator: String,
    date_format: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sep = if separator == ";" { ";" } else { "," };

    // Global default rate: final fallback in project → client → global hierarchy.
    let default_rate = crate::commands::invoices::global_default_rate(&conn);

    let mut stmt = conn
        .prepare(
            "SELECT t.start_time, c.name, p.name, t.description,
                    t.start_time, t.end_time, t.duration,
                    COALESCE(p.hourly_rate, c.hourly_rate, ?3) as rate
             FROM time_entries t
             LEFT JOIN projects p ON t.project_id = p.id
             LEFT JOIN clients c ON t.client_id = c.id
             WHERE t.start_time >= ?1 AND t.start_time <= ?2
               AND t.is_running = 0
             ORDER BY t.start_time ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![from, to, default_rate], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, f64>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    // UTF-8 BOM for Danish Excel compatibility
    let mut csv = String::from("\u{FEFF}");

    // Header row
    csv.push_str(&format!(
        "{date}{sep}{client}{sep}{project}{sep}{desc}{sep}{start}{sep}{end}{sep}{hours}{sep}{rate}{sep}{amount}\n",
        date = i18n::t("export.date"),
        client = i18n::t("export.client"),
        project = i18n::t("export.project"),
        desc = i18n::t("export.description"),
        start = i18n::t("export.start"),
        end = i18n::t("export.end"),
        hours = i18n::t("export.hours"),
        rate = i18n::t("export.rate"),
        amount = i18n::t("export.amount"),
        sep = sep,
    ));

    for row in rows {
        let (date_str, client, project, description, start, end, duration, rate) =
            row.map_err(|e| e.to_string())?;

        let formatted_date = format_csv_date(&date_str, &date_format);
        let start_time = format_csv_time(&start);
        let end_time = end.as_deref().map(format_csv_time).unwrap_or_default();

        let hours = match duration {
            Some(d) => d as f64 / 3600.0,
            None => 0.0,
        };
        let amount = hours * rate;

        // Format numbers with comma for Danish locale when using ; separator
        let (hours_str, rate_str, amount_str) = if sep == ";" {
            (
                format!("{:.2}", hours).replace('.', ","),
                format!("{:.2}", rate).replace('.', ","),
                format!("{:.2}", amount).replace('.', ","),
            )
        } else {
            (
                format!("{:.2}", hours),
                format!("{:.2}", rate),
                format!("{:.2}", amount),
            )
        };

        let line = format!(
            "{}{sep}{}{sep}{}{sep}{}{sep}{}{sep}{}{sep}{}{sep}{}{sep}{}\n",
            csv_escape(&formatted_date, sep),
            csv_escape(client.as_deref().unwrap_or(""), sep),
            csv_escape(project.as_deref().unwrap_or(""), sep),
            csv_escape(description.as_deref().unwrap_or(""), sep),
            csv_escape(&start_time, sep),
            csv_escape(&end_time, sep),
            hours_str,
            rate_str,
            amount_str,
        );
        csv.push_str(&line);
    }

    Ok(csv)
}

/// Export the quarterly VAT overview (momsoverblik) as CSV content for the
/// accountant. One row per VAT rate — momsgrundlag, salgsmoms and invoice count —
/// followed by the period totals and the "at indberette" figure (= outgoing VAT).
///
/// Read-only aggregation of the user's own issued invoices; no activity data and
/// no input/purchase VAT. Reuses `compute_vat_summary` so the CSV and the on-screen
/// overview can never disagree. Supports Danish (;) and international (,) separator;
/// UTF-8 with BOM for Excel. `date_format` controls the period display.
#[tauri::command]
pub fn export_vat_summary_csv(
    db: State<'_, Database>,
    from: String,
    to: String,
    separator: String,
    date_format: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let summary = crate::commands::reports::compute_vat_summary(&conn, &from, &to)?;

    let sep = if separator == ";" { ";" } else { "," };

    // Danish comma decimals only make sense with the ; separator; the , separator
    // (international) keeps the dot so columns don't collide.
    let num = |value: f64| -> String {
        if sep == ";" {
            format!("{:.2}", value).replace('.', ",")
        } else {
            format!("{:.2}", value)
        }
    };
    // VAT rate as a whole-number percent (25, 0) with a trailing % sign.
    let rate_label = |rate: f64| -> String { format!("{}%", format_dk_number(rate, 0)) };

    // UTF-8 BOM for Danish Excel compatibility.
    let mut csv = String::from("\u{FEFF}");

    // Title + period.
    csv.push_str(&format!("{}\n", csv_escape(&i18n::t("export.vatOverview"), sep)));
    csv.push_str(&format!(
        "{}{sep}{}{sep}{}\n\n",
        csv_escape(&i18n::t("export.vatPeriod"), sep),
        csv_escape(&format_csv_date(&from, &date_format), sep),
        csv_escape(&format_csv_date(&to, &date_format), sep),
        sep = sep,
    ));

    // Header row.
    csv.push_str(&format!(
        "{}{sep}{}{sep}{}{sep}{}\n",
        csv_escape(&i18n::t("export.vatRate"), sep),
        csv_escape(&i18n::t("export.vatBase"), sep),
        csv_escape(&i18n::t("export.vatOutgoing"), sep),
        csv_escape(&i18n::t("export.vatInvoiceCount"), sep),
        sep = sep,
    ));

    for bucket in &summary.by_rate {
        csv.push_str(&format!(
            "{}{sep}{}{sep}{}{sep}{}\n",
            csv_escape(&rate_label(bucket.vat_rate), sep),
            num(bucket.grundlag),
            num(bucket.moms),
            bucket.faktura_antal,
            sep = sep,
        ));
    }

    // Totals + the figure to report to SKAT.
    csv.push('\n');
    csv.push_str(&format!(
        "{}{sep}{}{sep}{}{sep}{}\n",
        csv_escape(&i18n::t("export.totalLabel"), sep),
        num(summary.total_grundlag),
        num(summary.total_moms),
        summary.total_faktura_antal,
        sep = sep,
    ));
    csv.push_str(&format!(
        "{}{sep}{}\n",
        csv_escape(&i18n::t("export.vatToReport"), sep),
        num(summary.total_moms),
        sep = sep,
    ));

    Ok(csv)
}

/// Generate complete HTML for a printable Danish invoice.
/// The frontend can open this in a new window and use window.print() to save as PDF.
#[tauri::command]
pub fn generate_invoice_html(
    db: State<'_, Database>,
    invoice_id: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Load invoice
    let invoice = conn
        .query_row(
            "SELECT id.id, id.client_id, id.title, id.status, id.subtotal, id.vat_rate,
                    id.total, id.due_date, id.notes, c.name, c.company, c.cvr, c.email,
                    id.invoice_number, id.created_at
             FROM invoice_drafts id
             JOIN clients c ON id.client_id = c.id
             WHERE id.id = ?1",
            rusqlite::params![invoice_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, f64>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, String>(14)?,
                ))
            },
        )
        .map_err(|e| i18n::t_fmt("export.invoiceNotFound", &[&e.to_string()]))?;

    let (
        _id,
        _client_id,
        title,
        _status,
        subtotal,
        vat_rate,
        _total,
        due_date,
        notes,
        client_name,
        client_company,
        client_cvr,
        client_email,
        invoice_number,
        created_at,
    ) = invoice;

    // Load invoice lines
    let mut stmt = conn
        .prepare(
            "SELECT description, quantity, unit_price, amount
             FROM invoice_lines
             WHERE invoice_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    #[allow(clippy::type_complexity)]
    let lines: Vec<(Option<String>, Option<f64>, Option<f64>, Option<f64>)> = stmt
        .query_map(rusqlite::params![invoice_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Load user settings for invoice header
    let get_setting = |key: &str| -> String {
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .unwrap_or_default()
    };

    // Sender identity is shared with the profile (Indstillinger → Generelt),
    // stored under the `user_*` keys. The invoice-specific legal fields live under
    // their own keys, set in the "Fakturaopsætning" panel.
    let user_name = get_setting("user_name");
    let user_company = get_setting("invoice_company");
    let user_cvr = get_setting("user_cvr");
    let user_address = get_setting("user_address");
    let user_email = get_setting("user_email");
    let user_phone = get_setting("user_phone");
    let bank_reg = get_setting("bank_reg");
    let bank_konto = get_setting("bank_konto");
    let mobilepay_nr = get_setting("mobilepay_nr");

    // Invoice number (assigned at finalisation) and the legally required dates.
    // Faktura date = the day the draft was created; due date = created + terms.
    let invoice_number_display = invoice_number
        .as_deref()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or("-")
        .to_string();
    let payment_terms_days: i64 = get_setting("payment_terms_days")
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|d| *d >= 0)
        .unwrap_or(14);
    let created_local = chrono::DateTime::parse_from_rfc3339(&created_at)
        .map(|dt| dt.with_timezone(&chrono::Local));
    let invoice_date_display = created_local
        .as_ref()
        .map(|dt| dt.format("%d-%m-%Y").to_string())
        .unwrap_or_default();
    // Prefer terms-derived due date; fall back to any stored due_date.
    let due_date_computed = created_local
        .as_ref()
        .map(|dt| (*dt + chrono::Duration::days(payment_terms_days)).format("%d-%m-%Y").to_string())
        .ok();

    // Derive the subtotal from the actual invoice lines rather than trusting the
    // stored invoice_drafts.subtotal, which can be stale if lines changed since.
    let lines_subtotal: f64 = lines.iter().map(|(_, _, _, amt)| amt.unwrap_or(0.0)).sum();
    let subtotal_val = if lines_subtotal != 0.0 {
        lines_subtotal
    } else {
        subtotal.unwrap_or(0.0)
    };
    let vat_amount = subtotal_val * (vat_rate / 100.0);
    let total_val = subtotal_val + vat_amount;

    // Build lines HTML
    let mut lines_html = String::new();
    for (desc, qty, price, amt) in &lines {
        lines_html.push_str(&format!(
            "<tr>
                <td style=\"padding: 10px 12px; border-bottom: 1px solid #e5e7eb;\">{}</td>
                <td style=\"padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;\">{}</td>
                <td style=\"padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;\">{}</td>
                <td style=\"padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 500;\">{}</td>
            </tr>",
            html_escape(desc.as_deref().unwrap_or("")),
            format_dk_number(qty.unwrap_or(0.0), 2),
            format_dk_number(price.unwrap_or(0.0), 2),
            format_dk_number(amt.unwrap_or(0.0), 2),
        ));
    }

    let invoice_label = i18n::t("export.invoice");
    let invoice_title = html_escape(title.as_deref().unwrap_or(&invoice_label));
    let due_date_display = html_escape(
        due_date_computed
            .as_deref()
            .or(due_date.as_deref())
            .unwrap_or("-"),
    );
    let client_name = html_escape(&client_name);

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="da">
<head>
    <meta charset="UTF-8">
    <title>{title}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: #1f2937;
            font-size: 14px;
            line-height: 1.5;
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
        }}
        .header {{ display: flex; justify-content: space-between; margin-bottom: 48px; }}
        .from {{ text-align: left; }}
        .from h1 {{ font-size: 20px; margin-bottom: 4px; }}
        .from p {{ color: #6b7280; font-size: 13px; }}
        .invoice-meta {{ text-align: right; }}
        .invoice-meta h2 {{ font-size: 28px; color: #3b82f6; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }}
        .invoice-meta p {{ color: #6b7280; font-size: 13px; }}
        .to {{ margin-bottom: 32px; padding: 20px; background: #f9fafb; border-radius: 8px; }}
        .to h3 {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; margin-bottom: 8px; }}
        .to p {{ font-size: 14px; }}
        table {{ width: 100%; border-collapse: collapse; margin-bottom: 24px; }}
        thead th {{
            background: #f3f4f6;
            padding: 10px 12px;
            text-align: left;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6b7280;
            font-weight: 600;
        }}
        thead th:not(:first-child) {{ text-align: right; }}
        .totals {{ display: flex; justify-content: flex-end; margin-bottom: 32px; }}
        .totals-box {{ width: 280px; }}
        .totals-row {{ display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }}
        .totals-row.total {{ border-top: 2px solid #1f2937; padding-top: 10px; margin-top: 4px; font-size: 18px; font-weight: 700; }}
        .footer {{ margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e7eb; }}
        .footer p {{ color: #6b7280; font-size: 13px; }}
        .notes {{ margin-top: 24px; padding: 16px; background: #fffbeb; border-left: 3px solid #f59e0b; border-radius: 4px; font-size: 13px; }}
        @media print {{
            body {{ padding: 20px; }}
            .no-print {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="from">
            <h1>{user_company_or_name}</h1>
            {from_details}
        </div>
        <div class="invoice-meta">
            <h2>{invoice_label}</h2>
            <p><strong>{invoice_number_label}</strong> {invoice_number}</p>
            <p><strong>{invoice_date_label}</strong> {invoice_date}</p>
            <p><strong>{due_date_label}</strong> {due_date}</p>
        </div>
    </div>

    <div class="to">
        <h3>{bill_to_label}</h3>
        <p><strong>{client_name}</strong></p>
        {client_details}
    </div>

    <table>
        <thead>
            <tr>
                <th>{desc_header}</th>
                <th>{qty_header}</th>
                <th>{unit_price_header}</th>
                <th>{amount_header}</th>
            </tr>
        </thead>
        <tbody>
            {lines}
        </tbody>
    </table>

    <div class="totals">
        <div class="totals-box">
            <div class="totals-row">
                <span>{subtotal_label}</span>
                <span>{subtotal} kr.</span>
            </div>
            <div class="totals-row">
                <span>{vat_label}</span>
                <span>{vat} kr.</span>
            </div>
            <div class="totals-row total">
                <span>{total_label}</span>
                <span>{total} kr.</span>
            </div>
        </div>
    </div>

    {notes_section}

    <div class="footer">
        {payment_section}
    </div>

    <div class="no-print" style="margin-top: 32px; text-align: center;">
        <button onclick="window.print()" style="padding: 10px 24px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
            {print_label}
        </button>
    </div>
</body>
</html>"#,
        title = invoice_title,
        invoice_label = html_escape(&i18n::t("export.invoice")),
        invoice_number_label = html_escape(&i18n::t("export.invoiceNumber")),
        invoice_number = html_escape(&invoice_number_display),
        invoice_date_label = html_escape(&i18n::t("export.invoiceDate")),
        invoice_date = html_escape(&invoice_date_display),
        due_date_label = html_escape(&i18n::t("export.dueDate")),
        bill_to_label = html_escape(&i18n::t("export.billTo")),
        desc_header = html_escape(&i18n::t("export.descriptionHeader")),
        qty_header = html_escape(&i18n::t("export.quantity")),
        unit_price_header = html_escape(&i18n::t("export.unitPrice")),
        amount_header = html_escape(&i18n::t("export.amountHeader")),
        subtotal_label = html_escape(&i18n::t("export.subtotal")),
        vat_label = html_escape(&i18n::t_fmt("export.vat", &[&format_dk_number(vat_rate, 0)])),
        total_label = html_escape(&i18n::t("export.total")),
        print_label = html_escape(&i18n::t("export.printSavePdf")),
        user_company_or_name = html_escape(if user_company.is_empty() {
            &user_name
        } else {
            &user_company
        }),
        from_details = build_from_details(&user_name, &user_company, &user_cvr, &user_address, &user_email, &user_phone),
        due_date = due_date_display,
        client_name = client_name,
        client_details = build_client_details(&client_company, &client_cvr, &client_email),
        lines = lines_html,
        subtotal = format_dk_number(subtotal_val, 2),
        vat = format_dk_number(vat_amount, 2),
        total = format_dk_number(total_val, 2),
        notes_section = if let Some(ref n) = notes {
            if !n.is_empty() {
                format!("<div class=\"notes\"><strong>{}</strong> {}</div>", i18n::t("export.notes"), html_escape(n))
            } else {
                String::new()
            }
        } else {
            String::new()
        },
        payment_section = build_payment_section(
            &bank_reg,
            &bank_konto,
            &mobilepay_nr,
            payment_terms_days,
        ),
    );

    Ok(html)
}

/// Generate HTML status report for a klippekort.
/// Shows klippekort details, progress, and linked time entries.
/// The frontend can open this in a new window for print/PDF.
#[tauri::command]
pub fn export_klippekort_html(
    db: State<'_, Database>,
    klippekort_id: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Load klippekort with client + project names
    let kk = conn
        .query_row(
            "SELECT k.id, k.name, k.total_hours, k.used_hours, k.hourly_rate,
                    k.status, k.expires_at, k.created_at,
                    c.name, p.name
             FROM klippekort k
             LEFT JOIN clients c ON k.client_id = c.id
             LEFT JOIN projects p ON k.project_id = p.id
             WHERE k.id = ?1",
            rusqlite::params![klippekort_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, f64>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                ))
            },
        )
        .map_err(|e| i18n::t_fmt("export.klippekortNotFound", &[&e.to_string()]))?;

    let (
        _id,
        name,
        total_hours,
        used_hours,
        hourly_rate,
        status,
        expires_at,
        created_at,
        client_name,
        project_name,
    ) = kk;

    let rate = hourly_rate.unwrap_or(0.0);
    let remaining = (total_hours - used_hours).max(0.0);
    let remaining_value = remaining * rate;
    let pct = if total_hours > 0.0 {
        (used_hours / total_hours * 100.0).min(100.0)
    } else {
        0.0
    };

    let status_label_owned = match status.as_str() {
        "active" => i18n::t("export.statusActive"),
        "expired" => i18n::t("export.statusExpired"),
        "depleted" => i18n::t("export.statusDepleted"),
        _ => status.clone(),
    };
    let status_label = status_label_owned.as_str();
    let status_color = match status.as_str() {
        "active" => "#10b981",
        "expired" => "#f59e0b",
        "depleted" => "#ef4444",
        _ => "#6b7280",
    };
    let progress_color = if pct > 95.0 {
        "#ef4444"
    } else if pct > 80.0 {
        "#f59e0b"
    } else {
        "#10b981"
    };

    // Load linked time entries
    let mut stmt = conn
        .prepare(
            "SELECT t.start_time, t.description, t.duration
             FROM time_entries t
             WHERE t.klippekort_id = ?1
               AND t.is_running = 0
             ORDER BY t.start_time DESC",
        )
        .map_err(|e| e.to_string())?;

    let entries: Vec<(String, Option<String>, Option<i64>)> = stmt
        .query_map(rusqlite::params![klippekort_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Build time entries table rows
    let mut entries_html = String::new();
    let mut total_entry_hours = 0.0;
    for (start_time, description, duration) in &entries {
        let date = format_entry_date_from_ts(start_time);
        let hours = match duration {
            Some(d) => *d as f64 / 3600.0,
            None => 0.0,
        };
        total_entry_hours += hours;
        entries_html.push_str(&format!(
            "<tr>
                <td style=\"padding: 8px 12px; border-bottom: 1px solid #e5e7eb;\">{}</td>
                <td style=\"padding: 8px 12px; border-bottom: 1px solid #e5e7eb;\">{}</td>
                <td style=\"padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-variant-numeric: tabular-nums;\">{}</td>
            </tr>",
            html_escape(&date),
            html_escape(description.as_deref().unwrap_or("-")),
            format_dk_number(hours, 2),
        ));
    }

    // Summary footer row for entries
    if !entries.is_empty() {
        entries_html.push_str(&format!(
            "<tr style=\"font-weight: 600; background: #f9fafb;\">
                <td style=\"padding: 8px 12px;\" colspan=\"2\">{total_label}</td>
                <td style=\"padding: 8px 12px; text-align: right; font-variant-numeric: tabular-nums;\">{hours} t</td>
            </tr>",
            total_label = html_escape(&i18n::t("export.totalLabel")),
            hours = format_dk_number(total_entry_hours, 2),
        ));
    }

    let entries_section = if entries.is_empty() {
        format!("<p style=\"color: #6b7280; font-style: italic;\">{}</p>", html_escape(&i18n::t("export.noEntriesYet")))
    } else {
        format!(
            "<table style=\"width: 100%; border-collapse: collapse; margin-top: 8px;\">
                <thead>
                    <tr>
                        <th style=\"background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600;\">{date_header}</th>
                        <th style=\"background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600;\">{desc_header}</th>
                        <th style=\"background: #f3f4f6; padding: 8px 12px; text-align: right; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600;\">{hours_header}</th>
                    </tr>
                </thead>
                <tbody>
                    {}
                </tbody>
            </table>",
            entries_html,
            date_header = html_escape(&i18n::t("export.date")),
            desc_header = html_escape(&i18n::t("export.description")),
            hours_header = html_escape(&i18n::t("export.hours")),
        )
    };

    let expires_display = expires_at
        .as_deref()
        .map(format_entry_date_from_ts)
        .unwrap_or_else(|| i18n::t("export.noExpiry"));

    let created_display = format_entry_date_from_ts(&created_at);

    let today = chrono::Local::now().format("%d-%m-%Y").to_string();

    let pct_width = format!("{pct:.1}");

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="da">
<head>
    <meta charset="UTF-8">
    <title>Klippekort — {name}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: #1f2937;
            font-size: 14px;
            line-height: 1.5;
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
        }}
        .header {{ margin-bottom: 32px; }}
        .header h1 {{ font-size: 24px; margin-bottom: 4px; }}
        .header p {{ color: #6b7280; font-size: 14px; }}
        .status-badge {{
            display: inline-block;
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            color: white;
        }}
        .progress-section {{ margin: 24px 0; }}
        .progress-bar-bg {{
            height: 20px;
            background: #e5e7eb;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 8px;
        }}
        .progress-bar-fill {{
            height: 100%;
            border-radius: 10px;
            transition: width 0.3s;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
            margin: 24px 0;
        }}
        .stat-card {{
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 16px;
        }}
        .stat-card .label {{ font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }}
        .stat-card .value {{ font-size: 20px; font-weight: 700; margin-top: 4px; }}
        .entries-section {{ margin-top: 32px; }}
        .entries-section h2 {{ font-size: 18px; margin-bottom: 12px; }}
        .generated {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; text-align: center; }}
        @media print {{
            body {{ padding: 20px; }}
            .no-print {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="header">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <h1>{name}</h1>
            <span class="status-badge" style="background: {status_color};">{status_label}</span>
        </div>
        <p>{client_line}{project_line}</p>
        <p style="margin-top: 4px;">{created_label} {created} &nbsp;|&nbsp; {expiry_label} {expires}</p>
    </div>

    <div class="progress-section">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <span style="font-weight: 600;">{usage_label}</span>
            <span style="font-variant-numeric: tabular-nums;">{used} / {total} {hours_label} ({pct_display}%)</span>
        </div>
        <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: {pct_width}%; background: {progress_color};"></div>
        </div>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="label">{hours_remaining_label}</div>
            <div class="value">{remaining} t</div>
        </div>
        <div class="stat-card">
            <div class="label">{remaining_value_label}</div>
            <div class="value">{remaining_value} kr.</div>
        </div>
        <div class="stat-card">
            <div class="label">{hourly_rate_label}</div>
            <div class="value">{rate} kr/t</div>
        </div>
        <div class="stat-card">
            <div class="label">{registrations_label}</div>
            <div class="value">{entry_count}</div>
        </div>
    </div>

    <div class="entries-section">
        <h2>{time_entries_label}</h2>
        {entries_section}
    </div>

    <div class="generated">
        {generated_by_label} &mdash; {today}
    </div>

    <div class="no-print" style="margin-top: 24px; text-align: center;">
        <button onclick="window.print()" style="padding: 10px 24px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
            {kk_print_label}
        </button>
    </div>
</body>
</html>"#,
        name = html_escape(&name),
        status_color = status_color,
        status_label = html_escape(status_label),
        created_label = html_escape(&i18n::t("export.created")),
        expiry_label = html_escape(&i18n::t("export.expiryDate")),
        usage_label = html_escape(&i18n::t("export.usage")),
        hours_label = html_escape(&i18n::t("export.hours").to_lowercase()),
        hours_remaining_label = html_escape(&i18n::t("export.hoursRemaining")),
        remaining_value_label = html_escape(&i18n::t("export.remainingValue")),
        hourly_rate_label = html_escape(&i18n::t("export.hourlyRate")),
        registrations_label = html_escape(&i18n::t("export.registrations")),
        time_entries_label = html_escape(&i18n::t("export.timeEntries")),
        generated_by_label = html_escape(&i18n::t("export.generatedBy")),
        kk_print_label = html_escape(&i18n::t("export.printSavePdf")),
        client_line = html_escape(client_name.as_deref().unwrap_or(&i18n::t("export.unknownClient"))),
        project_line = project_name
            .as_ref()
            .map(|p| format!(" — {}", html_escape(p)))
            .unwrap_or_default(),
        created = html_escape(&created_display),
        expires = html_escape(&expires_display),
        used = format_dk_number(used_hours, 1),
        total = format_dk_number(total_hours, 1),
        pct_display = format_dk_number(pct, 1),
        pct_width = pct_width,
        progress_color = progress_color,
        remaining = format_dk_number(remaining, 1),
        remaining_value = format_dk_number(remaining_value, 2),
        rate = format_dk_number(rate, 2),
        entry_count = entries.len(),
        entries_section = entries_section,
        today = today,
    );

    Ok(html)
}

/// A single time entry line in a klippekort usage report.
struct UsageEntry {
    start_time: String,
    description: Option<String>,
    project_name: Option<String>,
    duration: Option<i64>,
}

/// Collect ONLY the time entries linked to this klippekort.
///
/// PRIVACY GUARANTEE: this query reads `time_entries` exclusively and MUST NEVER
/// touch the `activities` table. The usage report is client-facing, and raw
/// activity data (app names, window titles, URLs) never leaves the machine.
/// The `klippekort_id = ?1` filter also guarantees one card's entries can never
/// leak into another card's report.
fn klippekort_usage_entries(
    conn: &Connection,
    klippekort_id: &str,
) -> rusqlite::Result<Vec<UsageEntry>> {
    let mut stmt = conn.prepare(
        "SELECT t.start_time, t.description, p.name, t.duration
         FROM time_entries t
         LEFT JOIN projects p ON t.project_id = p.id
         WHERE t.klippekort_id = ?1
           AND t.is_running = 0
         ORDER BY t.start_time ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![klippekort_id], |row| {
        Ok(UsageEntry {
            start_time: row.get(0)?,
            description: row.get(1)?,
            project_name: row.get(2)?,
            duration: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// Generate a client-facing HTML usage report for a klippekort: the period,
/// hours used vs. the prepaid total, the remaining balance, and a per-entry
/// breakdown (date, title, project, hours). Danish-formatted numbers/dates.
///
/// This is the transparency document a freelancer can hand a client so the
/// prepaid balance is never a surprise. It shows time entries only — never
/// activity data (see `klippekort_usage_entries`).
#[tauri::command]
pub fn export_klippekort_usage(
    db: State<'_, Database>,
    klippekort_id: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Load klippekort header with client + project names.
    let (name, total_hours, used_hours, hourly_rate, status, client_name, project_name) = conn
        .query_row(
            "SELECT k.name, k.total_hours, k.used_hours, k.hourly_rate, k.status, c.name, p.name
             FROM klippekort k
             LEFT JOIN clients c ON k.client_id = c.id
             LEFT JOIN projects p ON k.project_id = p.id
             WHERE k.id = ?1",
            rusqlite::params![klippekort_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, Option<f64>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .map_err(|e| i18n::t_fmt("export.klippekortNotFound", &[&e.to_string()]))?;

    let rate = hourly_rate.unwrap_or(0.0);
    let remaining = (total_hours - used_hours).max(0.0);
    let remaining_value = remaining * rate;

    let entries = klippekort_usage_entries(&conn, &klippekort_id).map_err(|e| e.to_string())?;

    // Derive the reporting period from the first and last linked entry.
    let period_display = match (entries.first(), entries.last()) {
        (Some(first), Some(last)) => {
            let from = format_entry_date_from_ts(&first.start_time);
            let to = format_entry_date_from_ts(&last.start_time);
            if from == to {
                from
            } else {
                format!("{} \u{2013} {}", from, to)
            }
        }
        _ => i18n::t("export.noEntriesYet"),
    };

    // Build the per-entry table rows.
    let mut entries_html = String::new();
    let mut total_entry_hours = 0.0;
    for entry in &entries {
        let date = format_entry_date_from_ts(&entry.start_time);
        let hours = entry.duration.map(|d| d as f64 / 3600.0).unwrap_or(0.0);
        total_entry_hours += hours;
        entries_html.push_str(&format!(
            "<tr>
                <td style=\"padding: 8px 12px; border-bottom: 1px solid #e5e7eb;\">{}</td>
                <td style=\"padding: 8px 12px; border-bottom: 1px solid #e5e7eb;\">{}</td>
                <td style=\"padding: 8px 12px; border-bottom: 1px solid #e5e7eb;\">{}</td>
                <td style=\"padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-variant-numeric: tabular-nums;\">{}</td>
            </tr>",
            html_escape(&date),
            html_escape(entry.description.as_deref().unwrap_or("-")),
            html_escape(entry.project_name.as_deref().unwrap_or("-")),
            format_dk_number(hours, 2),
        ));
    }

    let entries_section = if entries.is_empty() {
        format!(
            "<p style=\"color: #6b7280; font-style: italic;\">{}</p>",
            html_escape(&i18n::t("export.noEntriesYet"))
        )
    } else {
        format!(
            "<table style=\"width: 100%; border-collapse: collapse; margin-top: 8px;\">
                <thead>
                    <tr>
                        <th style=\"background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600;\">{date_header}</th>
                        <th style=\"background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600;\">{desc_header}</th>
                        <th style=\"background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600;\">{project_header}</th>
                        <th style=\"background: #f3f4f6; padding: 8px 12px; text-align: right; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600;\">{hours_header}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows}
                    <tr style=\"font-weight: 600; background: #f9fafb;\">
                        <td style=\"padding: 8px 12px;\" colspan=\"3\">{total_label}</td>
                        <td style=\"padding: 8px 12px; text-align: right; font-variant-numeric: tabular-nums;\">{total_hours} t</td>
                    </tr>
                </tbody>
            </table>",
            rows = entries_html,
            date_header = html_escape(&i18n::t("export.date")),
            desc_header = html_escape(&i18n::t("export.description")),
            project_header = html_escape(&i18n::t("export.project")),
            hours_header = html_escape(&i18n::t("export.hours")),
            total_label = html_escape(&i18n::t("export.totalLabel")),
            total_hours = format_dk_number(total_entry_hours, 2),
        )
    };

    let status_label = match status.as_str() {
        "active" => i18n::t("export.statusActive"),
        "expired" => i18n::t("export.statusExpired"),
        "depleted" => i18n::t("export.statusDepleted"),
        _ => status.clone(),
    };

    let today = chrono::Local::now().format("%d-%m-%Y").to_string();

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="da">
<head>
    <meta charset="UTF-8">
    <title>{report_title}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: #1f2937;
            font-size: 14px;
            line-height: 1.5;
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
        }}
        .header {{ margin-bottom: 24px; }}
        .header h1 {{ font-size: 22px; margin-bottom: 4px; }}
        .header p {{ color: #6b7280; font-size: 14px; }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
            margin: 24px 0;
        }}
        .stat-card {{
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 16px;
        }}
        .stat-card .label {{ font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }}
        .stat-card .value {{ font-size: 20px; font-weight: 700; margin-top: 4px; }}
        .entries-section {{ margin-top: 32px; }}
        .entries-section h2 {{ font-size: 18px; margin-bottom: 12px; }}
        .generated {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; text-align: center; }}
        @media print {{
            body {{ padding: 20px; }}
            .no-print {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>{usage_report_label}</h1>
        <p>{name}{project_line}</p>
        <p style="margin-top: 4px;">{client_line} &nbsp;|&nbsp; {status_label}</p>
        <p style="margin-top: 4px;">{period_label} {period}</p>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="label">{total_label}</div>
            <div class="value">{total} t</div>
        </div>
        <div class="stat-card">
            <div class="label">{used_label}</div>
            <div class="value">{used} t</div>
        </div>
        <div class="stat-card">
            <div class="label">{remaining_label}</div>
            <div class="value">{remaining} t</div>
        </div>
        <div class="stat-card">
            <div class="label">{remaining_value_label}</div>
            <div class="value">{remaining_value} kr.</div>
        </div>
    </div>

    <div class="entries-section">
        <h2>{time_entries_label}</h2>
        {entries_section}
    </div>

    <div class="generated">
        {generated_by_label} &mdash; {today}
    </div>

    <div class="no-print" style="margin-top: 24px; text-align: center;">
        <button onclick="window.print()" style="padding: 10px 24px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
            {print_label}
        </button>
    </div>
</body>
</html>"#,
        report_title = html_escape(&i18n::t_fmt("export.usageReportTitle", &[&name])),
        usage_report_label = html_escape(&i18n::t("export.usageReport")),
        name = html_escape(&name),
        project_line = project_name
            .as_ref()
            .map(|p| format!(" \u{2014} {}", html_escape(p)))
            .unwrap_or_default(),
        client_line = html_escape(client_name.as_deref().unwrap_or(&i18n::t("export.unknownClient"))),
        status_label = html_escape(&status_label),
        period_label = html_escape(&i18n::t("export.period")),
        period = html_escape(&period_display),
        total_label = html_escape(&i18n::t("export.totalHoursLabel")),
        used_label = html_escape(&i18n::t("export.hoursUsed")),
        remaining_label = html_escape(&i18n::t("export.hoursRemaining")),
        remaining_value_label = html_escape(&i18n::t("export.remainingValue")),
        time_entries_label = html_escape(&i18n::t("export.timeEntries")),
        generated_by_label = html_escape(&i18n::t("export.generatedBy")),
        print_label = html_escape(&i18n::t("export.printSavePdf")),
        total = format_dk_number(total_hours, 1),
        used = format_dk_number(used_hours, 1),
        remaining = format_dk_number(remaining, 1),
        remaining_value = format_dk_number(remaining_value, 2),
        entries_section = entries_section,
        today = today,
    );

    Ok(html)
}

/// Format a stored timestamp (RFC3339 or a bare date) to DD-MM-YYYY.
///
/// Delegates to `format_csv_date`, which converts UTC timestamps to LOCAL time
/// before extracting the calendar day. A naive `ts[..10]` slice would bucket
/// CET evening work (stored as next-day UTC) onto the wrong day in the
/// client-facing report — the exact date-handling trap CLAUDE.md warns about.
fn format_entry_date_from_ts(ts: &str) -> String {
    format_csv_date(ts, "DD-MM-YYYY")
}

// --- Helpers ---

fn format_csv_date(iso: &str, format: &str) -> String {
    // `time_entries` gemmer sig i lokal væg-tid, men tabellen har historisk
    // rummet UTC-instanser fra timeren, så begge læses gennem `tid::øjeblik`.
    // Uden det ville en række i den gamle form blive håndteret som om den lå
    // på det døgn, dens UTC-cifre viser — altså dagen før for alt efter
    // kl. 00:00 dansk.
    if let Some(sekunder) = crate::tid::øjeblik(iso) {
        let local = chrono::DateTime::from_timestamp(sekunder, 0)
            .expect("epoch")
            .with_timezone(&chrono::Local);
        return match format {
            "DD-MM-YYYY" => local.format("%d-%m-%Y").to_string(),
            _ => local.format("%Y-%m-%d").to_string(),
        };
    }
    if iso.len() >= 10 {
        // Fallback: just use the date part
        let date_part = &iso[..10];
        if format == "DD-MM-YYYY" && date_part.contains('-') {
            let parts: Vec<&str> = date_part.split('-').collect();
            if parts.len() == 3 {
                return format!("{}-{}-{}", parts[2], parts[1], parts[0]);
            }
        }
        date_part.to_string()
    } else {
        iso.to_string()
    }
}

fn format_csv_time(iso: &str) -> String {
    // Samme læsning som `format_csv_date`, og derfor samme grund. Den gamle kode
    // returnerede en TOM streng for enhver streng uden offset — altså for alle
    // manuelt registrerede timer, som er præcis dem, der manglede i
    // tidskolonnen. En eksport til kunden med tom tid er ikke en brugbar
    // eksport, så det er ikke en kosmetisk detalje.
    crate::tid::øjeblik(iso)
        .map(|sekunder| {
            chrono::DateTime::from_timestamp(sekunder, 0)
                .expect("epoch")
                .with_timezone(&chrono::Local)
                .format("%H:%M")
                .to_string()
        })
        .unwrap_or_default()
}

fn csv_escape(value: &str, sep: &str) -> String {
    if value.contains(sep) || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn format_dk_number(value: f64, decimals: usize) -> String {
    let formatted = format!("{:.prec$}", value, prec = decimals);
    // Use Danish decimal separator
    let formatted = formatted.replace('.', ",");

    // Add thousand separators
    let parts: Vec<&str> = formatted.split(',').collect();
    let integer_part = parts[0];
    let decimal_part = if parts.len() > 1 { parts[1] } else { "" };

    let mut result = String::new();
    let chars: Vec<char> = integer_part.chars().collect();
    let start = if chars.first() == Some(&'-') { 1 } else { 0 };

    if start == 1 {
        result.push('-');
    }

    let digits = &chars[start..];
    for (i, ch) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            result.push('.');
        }
        result.push(*ch);
    }

    if !decimal_part.is_empty() {
        result.push(',');
        result.push_str(decimal_part);
    }

    result
}

/// Escapes HTML special characters to prevent XSS in generated invoice HTML.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

fn build_from_details(
    name: &str,
    company: &str,
    cvr: &str,
    address: &str,
    email: &str,
    phone: &str,
) -> String {
    let mut parts = Vec::new();
    if !company.is_empty() && !name.is_empty() {
        parts.push(format!("<p>{}</p>", html_escape(name)));
    }
    if !cvr.is_empty() {
        parts.push(format!("<p>CVR: {}</p>", html_escape(cvr)));
    }
    if !address.is_empty() {
        parts.push(format!("<p>{}</p>", html_escape(address).replace('\n', "<br>")));
    }
    if !email.is_empty() {
        parts.push(format!("<p>{}</p>", html_escape(email)));
    }
    if !phone.is_empty() {
        parts.push(format!("<p>{}</p>", html_escape(phone)));
    }
    parts.join("\n")
}

/// Build the invoice footer payment block from the structured legal fields:
/// bank reg./account, MobilePay and the payment terms. Returns an empty string
/// only when no payment method is configured (finalisation blocks that case).
fn build_payment_section(
    bank_reg: &str,
    bank_konto: &str,
    mobilepay_nr: &str,
    payment_terms_days: i64,
) -> String {
    let mut lines = Vec::new();

    if !bank_reg.is_empty() && !bank_konto.is_empty() {
        lines.push(format!(
            "<strong>{}</strong> {} {} · {} {}",
            html_escape(&i18n::t("export.bankPayment")),
            html_escape(&i18n::t("export.bankReg")),
            html_escape(bank_reg),
            html_escape(&i18n::t("export.bankAccount")),
            html_escape(bank_konto),
        ));
    }
    if !mobilepay_nr.is_empty() {
        lines.push(format!(
            "<strong>{}</strong> {}",
            html_escape(&i18n::t("export.mobilepay")),
            html_escape(mobilepay_nr),
        ));
    }
    lines.push(format!(
        "<strong>{}</strong> {}",
        html_escape(&i18n::t("export.paymentTerms")),
        html_escape(&i18n::t_fmt(
            "export.paymentTermsDays",
            &[&payment_terms_days.to_string()]
        )),
    ));

    if lines.is_empty() {
        String::new()
    } else {
        format!("<p>{}</p>", lines.join("<br>"))
    }
}

fn build_client_details(
    company: &Option<String>,
    cvr: &Option<String>,
    email: &Option<String>,
) -> String {
    let mut parts = Vec::new();
    if let Some(c) = company {
        if !c.is_empty() {
            parts.push(format!("<p>{}</p>", html_escape(c)));
        }
    }
    if let Some(c) = cvr {
        if !c.is_empty() {
            parts.push(format!("<p>CVR: {}</p>", html_escape(c)));
        }
    }
    if let Some(e) = email {
        if !e.is_empty() {
            parts.push(format!("<p>{}</p>", html_escape(e)));
        }
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Kim A/S')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, status, created_at, updated_at)
             VALUES ('kk1', 'c1', 'Support', 10, 2, 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                    ('kk2', 'c1', 'Design', 10, 1, 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn
    }

    fn insert_entry(conn: &Connection, id: &str, kk: Option<&str>, desc: &str) {
        conn.execute(
            "INSERT INTO time_entries (id, client_id, klippekort_id, description, start_time, duration, is_running, source)
             VALUES (?1, 'c1', ?2, ?3, '2026-06-01T08:00:00Z', 3600, 0, 'manual')",
            rusqlite::params![id, kk, desc],
        )
        .unwrap();
    }

    #[test]
    fn usage_entries_only_include_the_given_klippekort() {
        let conn = setup();
        insert_entry(&conn, "e1", Some("kk1"), "Entry for kk1");
        insert_entry(&conn, "e2", Some("kk2"), "Entry for kk2");
        insert_entry(&conn, "e3", None, "Unlinked entry");

        let entries = klippekort_usage_entries(&conn, "kk1").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description.as_deref(), Some("Entry for kk1"));

        // The other card's entry must never leak into this report.
        assert!(entries
            .iter()
            .all(|e| e.description.as_deref() != Some("Entry for kk2")));
    }

    #[test]
    fn usage_entries_skip_running_timers() {
        let conn = setup();
        insert_entry(&conn, "done", Some("kk1"), "Finished");
        conn.execute(
            "INSERT INTO time_entries (id, client_id, klippekort_id, description, start_time, is_running, source)
             VALUES ('run', 'c1', 'kk1', 'Still running', '2026-06-02T08:00:00Z', 1, 'manual')",
            [],
        )
        .unwrap();
        let entries = klippekort_usage_entries(&conn, "kk1").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description.as_deref(), Some("Finished"));
    }
}
