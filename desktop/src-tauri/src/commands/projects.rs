use crate::db::Database;
use crate::sync::engine::log_sync_change;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub remote_id: Option<String>,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub name: String,
    pub hourly_rate: Option<f64>,
    pub color: Option<String>,
    pub estimated_hours: Option<f64>,
    pub is_archived: bool,
    pub created_at: String,
    pub updated_at: String,
    pub synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub client_id: Option<String>,
    pub name: String,
    pub hourly_rate: Option<f64>,
    pub color: Option<String>,
    pub estimated_hours: Option<f64>,
}

#[tauri::command]
pub fn list_projects(
    db: State<'_, Database>,
    include_archived: bool,
) -> Result<Vec<Project>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = if include_archived {
        "SELECT p.id, p.remote_id, p.client_id, c.name, p.name, p.hourly_rate, p.color, p.estimated_hours, p.is_archived, p.created_at, p.updated_at, p.synced_at
         FROM projects p
         LEFT JOIN clients c ON p.client_id = c.id
         ORDER BY p.name ASC"
    } else {
        "SELECT p.id, p.remote_id, p.client_id, c.name, p.name, p.hourly_rate, p.color, p.estimated_hours, p.is_archived, p.created_at, p.updated_at, p.synced_at
         FROM projects p
         LEFT JOIN clients c ON p.client_id = c.id
         WHERE p.is_archived = 0
         ORDER BY p.name ASC"
    };

    let mut stmt = conn.prepare_cached(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                remote_id: row.get(1)?,
                client_id: row.get(2)?,
                client_name: row.get(3)?,
                name: row.get(4)?,
                hourly_rate: row.get(5)?,
                color: row.get(6)?,
                estimated_hours: row.get(7)?,
                is_archived: row.get::<_, i32>(8)? != 0,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                synced_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| e.to_string())?);
    }
    Ok(projects)
}

#[tauri::command]
pub fn create_project(
    db: State<'_, Database>,
    input: CreateProjectInput,
) -> Result<Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO projects (id, client_id, name, hourly_rate, color, estimated_hours, is_archived, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)",
        rusqlite::params![
            id,
            input.client_id,
            input.name,
            input.hourly_rate,
            input.color,
            input.estimated_hours,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Fetch client_name if client_id was provided
    let client_name: Option<String> = if let Some(ref cid) = input.client_id {
        conn.query_row(
            "SELECT name FROM clients WHERE id = ?1",
            rusqlite::params![cid],
            |row| row.get(0),
        )
        .ok()
    } else {
        None
    };

    log_sync_change(&conn, "project", &id, "create");

    Ok(Project {
        id,
        remote_id: None,
        client_id: input.client_id,
        client_name,
        name: input.name,
        hourly_rate: input.hourly_rate,
        color: input.color,
        estimated_hours: input.estimated_hours,
        is_archived: false,
        created_at: now.clone(),
        updated_at: now,
        synced_at: None,
    })
}

#[tauri::command]
pub fn update_project(
    db: State<'_, Database>,
    project: Project,
) -> Result<Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE projects SET client_id = ?1, name = ?2, hourly_rate = ?3, color = ?4, estimated_hours = ?5, updated_at = ?6 WHERE id = ?7",
        rusqlite::params![
            project.client_id,
            project.name,
            project.hourly_rate,
            project.color,
            project.estimated_hours,
            now,
            project.id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Fetch client_name if client_id was provided
    let client_name: Option<String> = if let Some(ref cid) = project.client_id {
        conn.query_row(
            "SELECT name FROM clients WHERE id = ?1",
            rusqlite::params![cid],
            |row| row.get(0),
        )
        .ok()
    } else {
        None
    };

    log_sync_change(&conn, "project", &project.id, "update");

    Ok(Project {
        client_name,
        updated_at: now,
        ..project
    })
}

#[tauri::command]
pub fn archive_project(
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE projects SET is_archived = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;

    log_sync_change(&conn, "project", &id, "update");

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverBudgetProject {
    pub id: String,
    pub name: String,
    pub estimated_hours: f64,
    pub used_hours: f64,
    pub percentage: f64,
}

#[tauri::command]
pub fn get_over_budget_projects(
    db: State<'_, Database>,
) -> Result<Vec<OverBudgetProject>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT p.id, p.name, p.estimated_hours,
                    COALESCE(SUM(t.duration), 0) / 3600.0 AS used_hours
             FROM projects p
             LEFT JOIN time_entries t ON t.project_id = p.id
             WHERE p.estimated_hours IS NOT NULL
               AND p.estimated_hours > 0
               AND p.is_archived = 0
             GROUP BY p.id
             HAVING used_hours > p.estimated_hours",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let estimated: f64 = row.get(2)?;
            let used: f64 = row.get(3)?;
            let percentage = if estimated > 0.0 {
                (used / estimated) * 100.0
            } else {
                0.0
            };
            Ok(OverBudgetProject {
                id: row.get(0)?,
                name: row.get(1)?,
                estimated_hours: estimated,
                used_hours: used,
                percentage,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
