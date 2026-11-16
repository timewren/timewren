use crate::db::Database;
use crate::sync::engine::log_sync_change;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

/// A klippekort counts as "near expiry" once it will lapse within this many
/// days. 14 days gives the freelancer time to sell a renewal before the
/// prepaid package runs out and free hours start being given away.
pub(crate) const EXPIRY_WARNING_DAYS: i64 = 14;

/// Fallback low-balance threshold (hours remaining) when the user has not
/// configured one under `klippekort_low_threshold_hours`.
pub(crate) const DEFAULT_LOW_THRESHOLD_HOURS: f64 = 2.0;

/// Settings key holding the user-configured low-balance threshold in hours.
pub(crate) const LOW_THRESHOLD_SETTING_KEY: &str = "klippekort_low_threshold_hours";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Klippekort {
    pub id: String,
    pub remote_id: Option<String>,
    pub client_id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub total_hours: f64,
    pub used_hours: f64,
    pub hourly_rate: f64,
    pub status: String,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub client_name: Option<String>,
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKlippekortInput {
    pub client_id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub total_hours: f64,
    pub hourly_rate: f64,
    pub expires_at: Option<String>,
}

fn row_to_klippekort(row: &rusqlite::Row) -> rusqlite::Result<Klippekort> {
    Ok(Klippekort {
        id: row.get(0)?,
        remote_id: row.get(1)?,
        client_id: row.get(2)?,
        project_id: row.get(3)?,
        name: row.get(4)?,
        total_hours: row.get(5)?,
        used_hours: row.get(6)?,
        hourly_rate: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
        status: row.get(8)?,
        expires_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        client_name: row.get(12)?,
        project_name: row.get(13)?,
    })
}

const SELECT_FIELDS: &str =
    "k.id, k.remote_id, k.client_id, k.project_id, k.name, k.total_hours, k.used_hours, \
     k.hourly_rate, k.status, k.expires_at, k.created_at, k.updated_at, \
     c.name, p.name";

const FROM_JOINS: &str =
    "FROM klippekort k \
     LEFT JOIN clients c ON k.client_id = c.id \
     LEFT JOIN projects p ON k.project_id = p.id";

#[tauri::command]
pub fn list_klippekort(
    db: State<'_, Database>,
    include_inactive: bool,
) -> Result<Vec<Klippekort>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = if include_inactive {
        format!(
            "SELECT {} {} ORDER BY k.created_at DESC",
            SELECT_FIELDS, FROM_JOINS
        )
    } else {
        format!(
            "SELECT {} {} WHERE k.status = 'active' ORDER BY k.created_at DESC",
            SELECT_FIELDS, FROM_JOINS
        )
    };

    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_klippekort)
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn create_klippekort(
    db: State<'_, Database>,
    input: CreateKlippekortInput,
) -> Result<Klippekort, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO klippekort (id, client_id, project_id, name, total_hours, used_hours, hourly_rate, status, expires_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 'active', ?7, ?8, ?8)",
        rusqlite::params![
            id,
            input.client_id,
            input.project_id,
            input.name,
            input.total_hours,
            input.hourly_rate,
            input.expires_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Fetch client name
    let client_name: Option<String> = conn
        .query_row(
            "SELECT name FROM clients WHERE id = ?1",
            rusqlite::params![input.client_id],
            |row| row.get(0),
        )
        .ok();

    // Fetch project name if applicable
    let project_name: Option<String> = if let Some(ref pid) = input.project_id {
        conn.query_row(
            "SELECT name FROM projects WHERE id = ?1",
            rusqlite::params![pid],
            |row| row.get(0),
        )
        .ok()
    } else {
        None
    };

    log_sync_change(&conn, "klippekort", &id, "create");

    Ok(Klippekort {
        id,
        remote_id: None,
        client_id: input.client_id,
        project_id: input.project_id,
        name: input.name,
        total_hours: input.total_hours,
        used_hours: 0.0,
        hourly_rate: input.hourly_rate,
        status: "active".to_string(),
        expires_at: input.expires_at,
        created_at: now.clone(),
        updated_at: now,
        client_name,
        project_name,
    })
}

#[tauri::command]
pub fn update_klippekort(
    db: State<'_, Database>,
    klippekort: Klippekort,
) -> Result<Klippekort, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE klippekort SET client_id = ?1, project_id = ?2, name = ?3, total_hours = ?4, \
         used_hours = ?5, hourly_rate = ?6, status = ?7, expires_at = ?8, updated_at = ?9 \
         WHERE id = ?10",
        rusqlite::params![
            klippekort.client_id,
            klippekort.project_id,
            klippekort.name,
            klippekort.total_hours,
            klippekort.used_hours,
            klippekort.hourly_rate,
            klippekort.status,
            klippekort.expires_at,
            now,
            klippekort.id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Fetch client name
    let client_name: Option<String> = conn
        .query_row(
            "SELECT name FROM clients WHERE id = ?1",
            rusqlite::params![klippekort.client_id],
            |row| row.get(0),
        )
        .ok();

    // Fetch project name if applicable
    let project_name: Option<String> = if let Some(ref pid) = klippekort.project_id {
        conn.query_row(
            "SELECT name FROM projects WHERE id = ?1",
            rusqlite::params![pid],
            |row| row.get(0),
        )
        .ok()
    } else {
        None
    };

    log_sync_change(&conn, "klippekort", &klippekort.id, "update");

    Ok(Klippekort {
        client_name,
        project_name,
        updated_at: now,
        ..klippekort
    })
}

#[tauri::command]
pub fn get_klippekort_for_client(
    db: State<'_, Database>,
    client_id: String,
) -> Result<Vec<Klippekort>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} {} WHERE k.client_id = ?1 AND k.status = 'active' ORDER BY k.created_at DESC",
        SELECT_FIELDS, FROM_JOINS
    );

    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![client_id], row_to_klippekort)
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Validates an hours value before it mutates a klippekort balance. Rejects
/// NaN, infinities and negatives — any of which arriving over IPC would
/// silently corrupt the prepaid balance or flip the status. Zero is allowed
/// (it is a harmless no-op).
pub(crate) fn validate_deduct_hours(hours: f64) -> Result<(), String> {
    if !hours.is_finite() || hours < 0.0 {
        return Err("Ugyldigt timeantal".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn deduct_hours(
    db: State<'_, Database>,
    klippekort_id: String,
    hours: f64,
) -> Result<Klippekort, String> {
    validate_deduct_hours(hours)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    // Fetch current state
    let sql = format!("SELECT {} {} WHERE k.id = ?1", SELECT_FIELDS, FROM_JOINS);
    let mut kk = conn
        .query_row(&sql, rusqlite::params![klippekort_id], |row| {
            row_to_klippekort(row)
        })
        .map_err(|e| format!("Klippekort not found: {}", e))?;

    if kk.status != "active" {
        return Err(format!("Klippekort er ikke aktivt (status: {})", kk.status));
    }

    // Check expiry
    if let Some(ref expires) = kk.expires_at {
        if expires.as_str() < now.as_str() {
            // Mark as expired
            conn.execute(
                "UPDATE klippekort SET status = 'expired', updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, klippekort_id],
            )
            .map_err(|e| e.to_string())?;
            kk.status = "expired".to_string();
            kk.updated_at = now;
            return Err("Klippekort er udløbet".to_string());
        }
    }

    // Deduct hours
    let new_used = kk.used_hours + hours;
    let new_status = if new_used >= kk.total_hours {
        "depleted"
    } else {
        "active"
    };

    conn.execute(
        "UPDATE klippekort SET used_hours = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![new_used, new_status, now, klippekort_id],
    )
    .map_err(|e| e.to_string())?;

    kk.used_hours = new_used;
    kk.status = new_status.to_string();
    kk.updated_at = now;

    log_sync_change(&conn, "klippekort", &klippekort_id, "update");

    Ok(kk)
}

/// A klippekort that needs the freelancer's attention: either the remaining
/// balance has dropped below the threshold, or it is about to expire (or both).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LowKlippekort {
    pub id: String,
    pub client_id: String,
    pub name: String,
    pub client_name: Option<String>,
    pub project_name: Option<String>,
    pub total_hours: f64,
    pub used_hours: f64,
    /// total − used, floored at 0 so an over-drawn card never shows negative.
    pub remaining_hours: f64,
    pub hourly_rate: f64,
    pub expires_at: Option<String>,
    /// True when the remaining balance is below the configured threshold.
    pub is_low_balance: bool,
    /// True when `expires_at` is within `EXPIRY_WARNING_DAYS` of `today`
    /// (including already-past dates on a still-active card).
    pub is_expiring_soon: bool,
}

/// Whether a klippekort with the given `expires_at` counts as near expiry
/// relative to `today`. A missing or unparseable date is never "near expiry".
/// Dates already in the past (on a still-active card) count as near expiry
/// because they are the most urgent case.
pub(crate) fn is_expiring_soon(expires_at: Option<&str>, today: chrono::NaiveDate) -> bool {
    match expires_at {
        Some(s) if s.len() >= 10 => {
            match chrono::NaiveDate::parse_from_str(&s[..10], "%Y-%m-%d") {
                Ok(date) => date <= today + chrono::Duration::days(EXPIRY_WARNING_DAYS),
                Err(_) => false,
            }
        }
        _ => false,
    }
}

/// Read the configured low-balance threshold (hours), falling back to
/// `DEFAULT_LOW_THRESHOLD_HOURS`. Accepts the Danish decimal comma and rejects
/// non-finite/negative values so a garbage setting can never hide a real alert.
pub(crate) fn low_threshold_hours(conn: &Connection) -> f64 {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![LOW_THRESHOLD_SETTING_KEY],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.trim().replace(',', ".").parse::<f64>().ok())
    .filter(|v| v.is_finite() && *v >= 0.0)
    .unwrap_or(DEFAULT_LOW_THRESHOLD_HOURS)
}

/// Return the active klippekort that are low on balance (remaining < threshold)
/// or near expiry. Resttimer = total − used. Only `active` cards are considered;
/// already expired/depleted cards are done and need no proactive warning.
pub(crate) fn query_low_klippekort(
    conn: &Connection,
    threshold_hours: f64,
    today: chrono::NaiveDate,
) -> rusqlite::Result<Vec<LowKlippekort>> {
    let sql = format!(
        "SELECT {} {} WHERE k.status = 'active' \
         ORDER BY (k.total_hours - k.used_hours) ASC",
        SELECT_FIELDS, FROM_JOINS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_klippekort)?;

    let mut result = Vec::new();
    for row in rows {
        let kk = row?;
        let remaining = (kk.total_hours - kk.used_hours).max(0.0);
        let is_low_balance = remaining < threshold_hours;
        let is_expiring_soon = is_expiring_soon(kk.expires_at.as_deref(), today);
        if is_low_balance || is_expiring_soon {
            result.push(LowKlippekort {
                id: kk.id,
                client_id: kk.client_id,
                name: kk.name,
                client_name: kk.client_name,
                project_name: kk.project_name,
                total_hours: kk.total_hours,
                used_hours: kk.used_hours,
                remaining_hours: remaining,
                hourly_rate: kk.hourly_rate,
                expires_at: kk.expires_at,
                is_low_balance,
                is_expiring_soon,
            });
        }
    }
    Ok(result)
}

/// Proactive low-balance / near-expiry alert feed for the dashboard.
/// `threshold_hours` overrides the stored setting when provided; otherwise the
/// configured `klippekort_low_threshold_hours` (default 2) is used.
#[tauri::command]
pub fn get_low_klippekort(
    db: State<'_, Database>,
    threshold_hours: Option<f64>,
) -> Result<Vec<LowKlippekort>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let threshold = threshold_hours
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or_else(|| low_threshold_hours(&conn));
    let today = chrono::Local::now().date_naive();
    query_low_klippekort(&conn, threshold, today).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    #[test]
    fn accepts_positive_hours() {
        assert!(validate_deduct_hours(2.5).is_ok());
        assert!(validate_deduct_hours(0.25).is_ok());
    }

    #[test]
    fn accepts_zero_as_noop() {
        assert!(validate_deduct_hours(0.0).is_ok());
    }

    #[test]
    fn rejects_negative() {
        assert!(validate_deduct_hours(-1.0).is_err());
        assert!(validate_deduct_hours(-0.001).is_err());
    }

    #[test]
    fn rejects_nan_and_infinities() {
        assert!(validate_deduct_hours(f64::NAN).is_err());
        assert!(validate_deduct_hours(f64::INFINITY).is_err());
        assert!(validate_deduct_hours(f64::NEG_INFINITY).is_err());
    }

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Kim A/S')", [])
            .unwrap();
        conn
    }

    /// Insert an active klippekort. `expires_at` may be None or a YYYY-MM-DD date.
    fn insert_kk(conn: &Connection, id: &str, total: f64, used: f64, expires: Option<&str>) {
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, hourly_rate, status, expires_at, created_at, updated_at)
             VALUES (?1, 'c1', ?2, ?3, ?4, 850, 'active', ?5, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![id, format!("Pakke {id}"), total, used, expires],
        )
        .unwrap();
    }

    fn today() -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(2026, 7, 12).unwrap()
    }

    #[test]
    fn remaining_hours_is_total_minus_used() {
        let conn = setup();
        insert_kk(&conn, "k1", 10.0, 8.5, None);
        let low = query_low_klippekort(&conn, 2.0, today()).unwrap();
        assert_eq!(low.len(), 1);
        assert_eq!(low[0].remaining_hours, 1.5);
        assert!(low[0].is_low_balance);
        assert!(!low[0].is_expiring_soon);
    }

    #[test]
    fn threshold_is_respected_over_and_under() {
        let conn = setup();
        insert_kk(&conn, "under", 10.0, 8.5, None); // 1.5 remaining < 2 -> included
        insert_kk(&conn, "over", 10.0, 3.0, None); // 7.0 remaining >= 2 -> excluded
        let low = query_low_klippekort(&conn, 2.0, today()).unwrap();
        assert_eq!(low.len(), 1);
        assert_eq!(low[0].id, "under");
    }

    #[test]
    fn near_expiry_included_even_with_plenty_of_hours() {
        let conn = setup();
        // Full balance but expires in 10 days (within the 14-day window).
        insert_kk(&conn, "expiring", 100.0, 0.0, Some("2026-07-22"));
        // Full balance, expires far in the future -> excluded.
        insert_kk(&conn, "safe", 100.0, 0.0, Some("2026-12-31"));
        let low = query_low_klippekort(&conn, 2.0, today()).unwrap();
        assert_eq!(low.len(), 1);
        assert_eq!(low[0].id, "expiring");
        assert!(low[0].is_expiring_soon);
        assert!(!low[0].is_low_balance);
    }

    #[test]
    fn depleted_and_expired_cards_are_ignored() {
        let conn = setup();
        insert_kk(&conn, "active_low", 10.0, 9.5, None);
        // A depleted card should not surface as an actionable alert.
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, hourly_rate, status, created_at, updated_at)
             VALUES ('dep', 'c1', 'Opbrugt', 10.0, 10.0, 850, 'depleted', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let low = query_low_klippekort(&conn, 2.0, today()).unwrap();
        assert_eq!(low.len(), 1);
        assert_eq!(low[0].id, "active_low");
    }

    #[test]
    fn is_expiring_soon_boundaries() {
        let t = today();
        assert!(is_expiring_soon(Some("2026-07-12"), t)); // today
        assert!(is_expiring_soon(Some("2026-07-01"), t)); // already past
        assert!(is_expiring_soon(Some("2026-07-26"), t)); // exactly 14 days
        assert!(!is_expiring_soon(Some("2026-07-27"), t)); // 15 days
        assert!(!is_expiring_soon(None, t));
        assert!(!is_expiring_soon(Some("garbage"), t));
    }

    #[test]
    fn low_threshold_reads_setting_with_default() {
        let conn = setup();
        assert_eq!(low_threshold_hours(&conn), DEFAULT_LOW_THRESHOLD_HOURS);
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, '5')",
            rusqlite::params![LOW_THRESHOLD_SETTING_KEY],
        )
        .unwrap();
        assert_eq!(low_threshold_hours(&conn), 5.0);
        // Danish decimal comma is accepted.
        conn.execute(
            "UPDATE settings SET value = '1,5' WHERE key = ?1",
            rusqlite::params![LOW_THRESHOLD_SETTING_KEY],
        )
        .unwrap();
        assert_eq!(low_threshold_hours(&conn), 1.5);
    }

    #[test]
    fn configured_threshold_changes_which_cards_alert() {
        let conn = setup();
        insert_kk(&conn, "k1", 10.0, 6.0, None); // 4.0 remaining
        // Default threshold (2) -> not low.
        assert!(query_low_klippekort(&conn, low_threshold_hours(&conn), today())
            .unwrap()
            .is_empty());
        // Raise threshold to 5 -> now it qualifies.
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, '5')",
            rusqlite::params![LOW_THRESHOLD_SETTING_KEY],
        )
        .unwrap();
        let low = query_low_klippekort(&conn, low_threshold_hours(&conn), today()).unwrap();
        assert_eq!(low.len(), 1);
    }
}
