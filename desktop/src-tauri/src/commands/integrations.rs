use crate::db::Database;
use crate::i18n;
use crate::integrations::billy::{BillyClient, BillyInvoiceInput, BillyInvoiceLineInput};
use tauri::State;

/// Test the Billy API connection by fetching the organization name.
#[tauri::command]
pub async fn test_billy_connection(api_key: String) -> Result<String, String> {
    let client = BillyClient::new(api_key);
    client.get_organization().await
}

/// Export an invoice draft to Billy.
/// 1. Load invoice with lines from DB
/// 2. Find or create Billy contact matching the client
/// 3. Create Billy invoice with lines
/// 4. Update local invoice status to "exported"
/// 5. Return Billy invoice ID
#[tauri::command]
pub async fn export_invoice_to_billy(
    db: State<'_, Database>,
    invoice_id: String,
    api_key: String,
) -> Result<String, String> {
    // Step 1: Load invoice with lines
    let (client_name, lines, client_id) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        let (client_id, client_name) = conn
            .query_row(
                "SELECT d.client_id, c.name
                 FROM invoice_drafts d
                 JOIN clients c ON d.client_id = c.id
                 WHERE d.id = ?1",
                rusqlite::params![invoice_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|e| i18n::t_fmt("billy.invoiceNotFound", &[&e.to_string()]))?;

        let mut stmt = conn
            .prepare_cached(
                "SELECT description, quantity, unit_price
                 FROM invoice_lines
                 WHERE invoice_id = ?1
                 ORDER BY sort_order ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;

        let lines: Vec<(Option<String>, Option<f64>, Option<f64>)> = stmt
            .query_map(rusqlite::params![invoice_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        if lines.is_empty() {
            return Err(i18n::t("billy.noInvoiceLines"));
        }

        (client_name, lines, client_id)
    };

    let billy = BillyClient::new(api_key);

    // Step 2: Find or create Billy contact
    let contacts = billy.list_contacts().await?;
    let contact_id = if let Some(existing) = contacts
        .iter()
        .find(|c| c.name.to_lowercase() == client_name.to_lowercase())
    {
        existing.id.clone()
    } else {
        // Create new contact with Danish country ID
        let new_contact = billy
            .create_contact(&client_name, "DK")
            .await?;
        new_contact.id
    };

    // Step 3: Create Billy invoice
    let billy_lines: Vec<BillyInvoiceLineInput> = lines
        .iter()
        .map(|(desc, qty, price)| BillyInvoiceLineInput {
            product_id: None,
            description: desc.clone(),
            quantity: qty.unwrap_or(1.0),
            unit_price: price.unwrap_or(0.0),
        })
        .collect();

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let billy_invoice = BillyInvoiceInput {
        contact_id,
        entry_date: today,
        payment_terms_days: 14,
        lines: billy_lines,
    };

    let billy_invoice_id = billy.create_invoice(&billy_invoice).await?;

    // Step 4: Update local invoice status to "exported"
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE invoice_drafts SET status = 'exported', updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, invoice_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // We intentionally ignore client_id here — it was needed to load the data but
    // the Billy contact is matched by name.
    let _ = client_id;

    Ok(billy_invoice_id)
}
