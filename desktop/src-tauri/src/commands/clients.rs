use crate::db::Database;
use crate::sync::engine::log_sync_change;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Client {
    pub id: String,
    pub remote_id: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub company: Option<String>,
    pub cvr: Option<String>,
    pub hourly_rate: Option<f64>,
    pub notes: Option<String>,
    pub is_archived: bool,
    pub created_at: String,
    pub updated_at: String,
    pub synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateClientInput {
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub company: Option<String>,
    pub cvr: Option<String>,
    pub hourly_rate: Option<f64>,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn list_clients(
    db: State<'_, Database>,
    include_archived: bool,
) -> Result<Vec<Client>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = if include_archived {
        "SELECT id, remote_id, name, email, phone, company, cvr, hourly_rate, notes, is_archived, created_at, updated_at, synced_at FROM clients ORDER BY name ASC"
    } else {
        "SELECT id, remote_id, name, email, phone, company, cvr, hourly_rate, notes, is_archived, created_at, updated_at, synced_at FROM clients WHERE is_archived = 0 ORDER BY name ASC"
    };

    let mut stmt = conn.prepare_cached(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Client {
                id: row.get(0)?,
                remote_id: row.get(1)?,
                name: row.get(2)?,
                email: row.get(3)?,
                phone: row.get(4)?,
                company: row.get(5)?,
                cvr: row.get(6)?,
                hourly_rate: row.get(7)?,
                notes: row.get(8)?,
                is_archived: row.get::<_, i32>(9)? != 0,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                synced_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut clients = Vec::new();
    for row in rows {
        clients.push(row.map_err(|e| e.to_string())?);
    }
    Ok(clients)
}

#[tauri::command]
pub fn create_client(
    db: State<'_, Database>,
    input: CreateClientInput,
) -> Result<Client, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO clients (id, name, email, phone, company, cvr, hourly_rate, notes, is_archived, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9)",
        rusqlite::params![
            id,
            input.name,
            input.email,
            input.phone,
            input.company,
            input.cvr,
            input.hourly_rate,
            input.notes,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    log_sync_change(&conn, "client", &id, "create");

    Ok(Client {
        id,
        remote_id: None,
        name: input.name,
        email: input.email,
        phone: input.phone,
        company: input.company,
        cvr: input.cvr,
        hourly_rate: input.hourly_rate,
        notes: input.notes,
        is_archived: false,
        created_at: now.clone(),
        updated_at: now,
        synced_at: None,
    })
}

#[tauri::command]
pub fn update_client(
    db: State<'_, Database>,
    client: Client,
) -> Result<Client, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE clients SET name = ?1, email = ?2, phone = ?3, company = ?4, cvr = ?5, hourly_rate = ?6, notes = ?7, updated_at = ?8 WHERE id = ?9",
        rusqlite::params![
            client.name,
            client.email,
            client.phone,
            client.company,
            client.cvr,
            client.hourly_rate,
            client.notes,
            now,
            client.id,
        ],
    )
    .map_err(|e| e.to_string())?;

    log_sync_change(&conn, "client", &client.id, "update");

    Ok(Client {
        updated_at: now,
        ..client
    })
}

#[tauri::command]
pub fn archive_client(
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE clients SET is_archived = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;

    log_sync_change(&conn, "client", &id, "update");

    Ok(())
}
