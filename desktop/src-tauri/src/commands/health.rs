use crate::db::{lås, Database};
use crate::i18n;
use serde::Serialize;
use tauri::State;

/// Verify that the database is readable and not corrupt.
/// Returns "ok" on success, or an error string describing the issue.
#[tauri::command]
pub fn health_check(db: State<'_, Database>) -> Result<String, String> {
    let conn = lås(&db.conn);

    // Run SQLite integrity check (quick version — checks a single page)
    let result: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| i18n::t_fmt("health.dbCorrupt", &[&e.to_string()]))?;

    if result != "ok" {
        return Err(i18n::t_fmt("health.dbCorrupt", &[&result]));
    }

    // Verify we can read from a core table
    conn.query_row(
        "SELECT COUNT(*) FROM settings",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| i18n::t_fmt("health.couldNotRead", &[&e.to_string()]))?;

    Ok("ok".to_string())
}

/// Hvor den beskadigede database blev omdøbt, hvis appen måtte starte på en ny.
///
/// `None` i det normale tilfælde — det er altså *kun* denne kommando der ved
/// det, så et kald der fejler efterlader brugeren uden besked om hvor hans data
/// ligger. Det er derfor `backup_sti` er en sti og ikke en besked: brugeren kan
/// åbne mappen og finde den.
#[derive(Serialize)]
pub struct DatabaseRecovery {
    backup_sti: String,
}

/// Fortæller frontend, om appen lige har måtte genopbygge databasen.
///
/// Svaret er altid `Ok` — også når intet er gendannet. En fejl her ville være
/// umulig at skelne fra "kalden virker ikke", og det er præcis den forveksling,
/// der gjorde de tre andre steder farlige i `db/mod.rs` (`lås`).
#[tauri::command]
pub fn get_database_recovery(db: State<'_, Database>) -> Result<Option<DatabaseRecovery>, String> {
    let recovery = crate::db::lås_helted(&db.recovery);
    Ok(recovery.as_ref().map(|r| DatabaseRecovery {
        backup_sti: r.backup_sti.display().to_string(),
    }))
}
