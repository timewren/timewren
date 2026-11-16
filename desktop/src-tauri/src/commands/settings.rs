use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub fn get_setting(db: State<'_, Database>, key: String) -> Result<Option<String>, String> {
    // Hemmeligheder ligger i OS' nøglering. Rækken i `settings` læses KUN som
    // et tilbagefald, fordi en køl, låst nøglering eller en opgradering der
    // endnu ikke er kørt, kan efterlade den gamle værdi liggende — og så er
    // brugeren stadig logget ind i stedet for uden.
    if crate::secrets::er_hemmelighed(&key) {
        if let Some(værdi) = crate::secrets::hent(&key)? {
            return Ok(Some(værdi));
        }
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let value = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok();

    Ok(value)
}

#[tauri::command]
pub fn set_setting(db: State<'_, Database>, key: String, value: String) -> Result<(), String> {
    // Porten: en hemmelighed må ikke skrives til databasen overhovedet. `gem`
    // skriver i nøgleringen og sletter en eventuel klartekstrække bagefter, så
    // en afvisning efterlader brugeren med den værdi de havde.
    if crate::secrets::er_hemmelighed(&key) {
        crate::secrets::gem(&key, &value)?;
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![key],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn set_error_reporting(enabled: bool) {
    crate::sentry_setup::sæt_fejlrapportering(enabled);
}

/// Keys that must never be sent to the frontend in bulk listings.
/// Individual access via `get_setting` is fine because the frontend
/// only requests what it needs, but `get_all_settings` could leak
/// secrets into dev-tools or Sentry breadcrumbs.
///
/// `secrets::HEMMELIGHEDER` (sync_token, billy_api_key) står ikke her, fordi
/// de slet ikke ligger i tabellen længere — de har intet at redigere væk. De
/// er med her for at `set_setting` ikke kan skrive dem i tabellen igen.
const SENSITIVE_KEYS: &[&str] = &["ai_config"];

#[tauri::command]
pub fn get_all_settings(db: State<'_, Database>) -> Result<Vec<Setting>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare_cached("SELECT key, value FROM settings ORDER BY key ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Setting {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut settings = Vec::new();
    for row in rows {
        let setting = row.map_err(|e| e.to_string())?;
        // Redact sensitive values so tokens/API keys are never sent in bulk
        if SENSITIVE_KEYS.contains(&setting.key.as_str()) {
            settings.push(Setting {
                key: setting.key,
                value: "[redacted]".to_string(),
            });
        } else {
            settings.push(setting);
        }
    }
    Ok(settings)
}
