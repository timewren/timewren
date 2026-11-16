use crate::db::Database;
use crate::tracker::ActivityTracker;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    pub id: i64,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub url: Option<String>,
    pub git_branch: Option<String>,
    pub git_repo: Option<String>,
    pub context_path: Option<String>,
    pub file_path: Option<String>,
    pub category: Option<String>,
    pub project_id: Option<String>,
    /// The customer this activity is billed to. Set independently of the
    /// project, so work for a customer with no project still names its customer.
    pub client_id: Option<String>,
    pub confidence: Option<f64>,
    /// Which layer classified this activity: rule | pattern | ai | inherited.
    pub classification_source: Option<String>,
    /// Short human-readable detail of why (e.g. "git_repo timetrack-desktop").
    pub classification_reason: Option<String>,
    pub is_confirmed: bool,
    pub is_idle: bool,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration: i64,
}

fn row_to_activity(row: &rusqlite::Row) -> rusqlite::Result<Activity> {
    Ok(Activity {
        id: row.get(0)?,
        app_name: row.get(1)?,
        window_title: row.get(2)?,
        url: row.get(3)?,
        git_branch: row.get(4)?,
        git_repo: row.get(5)?,
        context_path: row.get(6)?,
        file_path: row.get(7)?,
        category: row.get(8)?,
        project_id: row.get(9)?,
        client_id: row.get(10)?,
        confidence: row.get(11)?,
        classification_source: row.get(12)?,
        classification_reason: row.get(13)?,
        is_confirmed: row.get::<_, i32>(14)? != 0,
        is_idle: row.get::<_, i32>(15)? != 0,
        started_at: row.get(16)?,
        ended_at: row.get(17)?,
        duration: row.get(18)?,
    })
}

/// Starts the auto-tracker. The tracker opens its own database connection.
#[tauri::command]
pub fn start_tracking(tracker: State<'_, ActivityTracker>) -> Result<(), String> {
    tracker.start();
    Ok(())
}

/// Stops the auto-tracker. Any in-progress activity is finalized.
#[tauri::command]
pub fn stop_tracking(tracker: State<'_, ActivityTracker>) -> Result<(), String> {
    tracker.stop();
    Ok(())
}

/// Returns whether the auto-tracker is currently running.
#[tauri::command]
pub fn get_tracking_status(tracker: State<'_, ActivityTracker>) -> Result<bool, String> {
    Ok(tracker.is_tracking())
}

/// Lists all activities for a given date (YYYY-MM-DD format).
#[tauri::command]
pub fn list_activities(db: State<'_, Database>, date: String) -> Result<Vec<Activity>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // date is expected as "YYYY-MM-DD"
    let from = format!("{}T00:00:00", date);
    let to = format!("{}T23:59:59", date);

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, app_name, window_title, url, git_branch, git_repo, context_path,
                    file_path, category, project_id, client_id, confidence,
                    classification_source, classification_reason, is_confirmed, is_idle,
                    started_at, ended_at, duration
             FROM activities
             WHERE started_at >= ?1 AND started_at <= ?2
             ORDER BY started_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![from, to], row_to_activity)
        .map_err(|e| e.to_string())?;

    let mut activities = Vec::new();
    for row in rows {
        activities.push(row.map_err(|e| e.to_string())?);
    }
    Ok(activities)
}

/// Lists all activities for a date range (YYYY-MM-DD format).
/// More efficient than calling list_activities 7 times for a week view.
#[tauri::command]
pub fn list_activities_range(
    db: State<'_, Database>,
    from: String,
    to: String,
) -> Result<Vec<Activity>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let from_dt = format!("{}T00:00:00", from);
    let to_dt = format!("{}T23:59:59", to);

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, app_name, window_title, url, git_branch, git_repo, context_path,
                    file_path, category, project_id, client_id, confidence,
                    classification_source, classification_reason, is_confirmed, is_idle,
                    started_at, ended_at, duration
             FROM activities
             WHERE started_at >= ?1 AND started_at <= ?2
             ORDER BY started_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![from_dt, to_dt], row_to_activity)
        .map_err(|e| e.to_string())?;

    let mut activities = Vec::new();
    for row in rows {
        activities.push(row.map_err(|e| e.to_string())?);
    }
    Ok(activities)
}

/// Permanently deletes all activities. This is a privacy feature.
#[tauri::command]
pub fn delete_all_activities(db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM activities", [])
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Deletes activities older than a given number of days.
/// Returns the number of deleted rows. Called at startup to keep the DB lean.
pub fn cleanup_old_activities(conn: &rusqlite::Connection, retention_days: i64) -> Result<usize, String> {
    let cutoff = chrono::Local::now()
        .checked_sub_signed(chrono::Duration::days(retention_days))
        .map(|dt| dt.format("%Y-%m-%dT00:00:00").to_string())
        .ok_or("Failed to compute cutoff date")?;

    let deleted = conn
        .execute(
            "DELETE FROM activities WHERE started_at < ?1 AND is_confirmed = 0",
            rusqlite::params![cutoff],
        )
        .map_err(|e| e.to_string())?;

    if deleted > 0 {
        // Plads-støvsningen er kosmetisk — den gamle databasefil er allerede
        // kortere, når den lukkes. Fejler den, må det ikke stoppe sletningen.
        if let Err(e) = conn.execute_batch("PRAGMA incremental_vacuum;") {
            crate::db::errors::record("kunne ikke frigive plads efter sletning", e);
        }
    }

    Ok(deleted)
}
