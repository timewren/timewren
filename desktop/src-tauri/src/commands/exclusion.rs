use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExclusionRule {
    pub id: i64,
    pub field: String,
    pub op: String,
    pub value: String,
    pub is_active: bool,
    pub created_at: String,
}

const VALID_FIELDS: &[&str] = &["app_name", "window_title"];
const VALID_OPS: &[&str] = &["equals", "contains", "starts_with", "regex"];

/// Validates a user-supplied exclusion rule before it touches the database.
/// Pure so it can be unit-tested independently of Tauri/State.
fn validate_rule(field: &str, op: &str, value: &str) -> Result<(), String> {
    if !VALID_FIELDS.contains(&field) {
        return Err(format!("Ugyldigt felt: {field}"));
    }
    if !VALID_OPS.contains(&op) {
        return Err(format!("Ugyldig operator: {op}"));
    }
    if value.trim().is_empty() {
        return Err("Værdi må ikke være tom".to_string());
    }
    Ok(())
}

/// List all exclusion rules, newest first.
#[tauri::command]
pub fn list_exclusion_rules(db: State<'_, Database>) -> Result<Vec<ExclusionRule>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, field, op, value, is_active, created_at
             FROM exclusion_rules ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ExclusionRule {
                id: row.get(0)?,
                field: row.get(1)?,
                op: row.get(2)?,
                value: row.get(3)?,
                is_active: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Add an exclusion rule. Validates field and operator.
/// Note: the tracker reads exclusion rules at startup, so a new rule takes
/// effect on the next app/tracker restart.
#[tauri::command]
pub fn add_exclusion_rule(
    db: State<'_, Database>,
    field: String,
    op: String,
    value: String,
) -> Result<i64, String> {
    validate_rule(&field, &op, &value)?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO exclusion_rules (field, op, value) VALUES (?1, ?2, ?3)",
        rusqlite::params![field, op, value.trim()],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

/// Enable or disable an exclusion rule.
#[tauri::command]
pub fn set_exclusion_rule_active(
    db: State<'_, Database>,
    id: i64,
    is_active: bool,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE exclusion_rules SET is_active = ?1 WHERE id = ?2",
        rusqlite::params![is_active as i32, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete an exclusion rule.
#[tauri::command]
pub fn delete_exclusion_rule(db: State<'_, Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM exclusion_rules WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_rule;

    #[test]
    fn accepts_valid_rules() {
        assert!(validate_rule("app_name", "equals", "KeePass").is_ok());
        assert!(validate_rule("window_title", "contains", "secret").is_ok());
        assert!(validate_rule("window_title", "regex", "^Private").is_ok());
        assert!(validate_rule("app_name", "starts_with", "Sign").is_ok());
    }

    #[test]
    fn rejects_unknown_field() {
        assert!(validate_rule("url", "contains", "x").is_err());
    }

    #[test]
    fn rejects_unknown_op() {
        assert!(validate_rule("app_name", "matches", "x").is_err());
    }

    #[test]
    fn rejects_empty_value() {
        assert!(validate_rule("app_name", "equals", "   ").is_err());
        assert!(validate_rule("app_name", "equals", "").is_err());
    }
}
