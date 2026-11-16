use rusqlite::{params, Connection};

use crate::tid::lokal_naiv;

use super::api::{AcceptedEntity, ConflictEntity, PushError, SyncEntity};

/// Result of collecting pending changes: the entities to push plus the exact
/// set of sync_log row ids they came from. The log ids are needed so that, after
/// the network round-trip, we mark ONLY these rows synced — never rows that were
/// inserted into sync_log while the push was in flight (which would silently lose
/// those edits).
pub struct PendingChanges {
    pub entities: Vec<SyncEntity>,
    /// sync_log.id for each collected row, parallel-keyed by (entity_type, entity_id).
    /// Stored as a flat list of (log_id, entity_type, entity_id).
    pub log_rows: Vec<(i64, String, String)>,
}

/// Collects all entities changed since last sync (from sync_log where synced=0).
/// Reads the actual entity data from the corresponding table and builds SyncEntity payloads.
///
/// Notes on correctness:
/// - `local_updated_at` is the entity's real `updated_at` (last-write-wins watermark),
///   NOT the sync_log insertion time. For deletes (no surviving row) we fall back to
///   the log's `created_at`.
/// - Running timers (`is_running = 1`) are excluded from the push payload: a running
///   entry has no meaningful end and would create duplicate "running" rows on other devices.
pub fn collect_pending_changes(conn: &Connection) -> PendingChanges {
    let mut stmt = match conn.prepare(
        "SELECT id, entity_type, entity_id, action, payload, created_at
         FROM sync_log WHERE synced = 0 ORDER BY id ASC",
    ) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to query sync_log: {}", e);
            return PendingChanges {
                entities: vec![],
                log_rows: vec![],
            };
        }
    };

    let rows: Vec<(i64, String, String, String, Option<String>, String)> = match stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        }) {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(e) => {
            eprintln!("Failed to query sync_log rows: {}", e);
            return PendingChanges {
                entities: vec![],
                log_rows: vec![],
            };
        }
    };

    let mut entities = Vec::with_capacity(rows.len());
    let mut log_rows = Vec::with_capacity(rows.len());

    for (log_id, entity_type, entity_id, action, _payload, created_at) in rows {
        // For delete actions, we don't need to read the entity data. There is no
        // surviving row to read `updated_at` from, so the log's created_at is the
        // best available watermark.
        if action == "delete" {
            // The server deletes by primary key, so a local UUID here archives
            // nothing and is then echoed back as the entity's `remoteId` — which
            // commit_push_result would write onto the local row, aiming every
            // later push at an id the server has never heard of. Send the id the
            // server gave the row; fall back to the local id for a row that was
            // never pushed (nothing to archive, and nothing to get wrong either).
            let server_id = remote_id_of(conn, &entity_type, &entity_id).unwrap_or(entity_id.clone());
            log_rows.push((log_id, entity_type.clone(), entity_id.clone()));
            entities.push(SyncEntity {
                entity_type,
                action,
                data: serde_json::json!({ "id": server_id }),
                local_id: Some(entity_id),
                local_updated_at: Some(created_at),
            });
            continue;
        }

        // Read the current entity data from its table
        let data = match entity_type.as_str() {
            "client" => read_client_data(conn, &entity_id),
            "project" => read_project_data(conn, &entity_id),
            "time_entry" => read_time_entry_data(conn, &entity_id),
            "klippekort" => read_klippekort_data(conn, &entity_id),
            _ => {
                eprintln!("Unknown entity type in sync_log: {}", entity_type);
                continue;
            }
        };

        if let Some(data) = data {
            // Do not push running timers — they have no end and would create
            // duplicate running entries on other devices.
            if entity_type == "time_entry" && data["isRunning"].as_bool().unwrap_or(false) {
                continue;
            }

            // Forward the entity's real updated_at as the last-write-wins watermark.
            // Fall back to the log's created_at only if the row has no updated_at.
            let local_updated_at = data["updatedAt"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or(created_at);

            log_rows.push((log_id, entity_type.clone(), entity_id.clone()));
            entities.push(SyncEntity {
                entity_type,
                action,
                data,
                local_id: Some(entity_id),
                local_updated_at: Some(local_updated_at),
            });
        }
    }

    PendingChanges { entities, log_rows }
}

/// Outcome of applying pulled entities.
pub struct ApplyOutcome {
    /// Number of entities successfully applied.
    #[allow(dead_code)] // asserted by the sync-engine tests; reserved for surfacing apply counts
    pub applied: usize,
    /// Number of entities that failed to apply (errors were logged). When > 0 the
    /// caller MUST NOT advance the since-watermark, so the failed records are
    /// re-fetched on the next pull instead of being lost.
    pub failed: usize,
}

/// Applies pulled entities to local database (upsert by remote_id).
/// Server-wins strategy for genuinely newer remote data; local edits that are newer
/// and not yet pushed are preserved (see the per-entity apply fns).
/// All changes are wrapped in a single transaction for atomicity and performance.
pub fn apply_remote_changes(conn: &Connection, entities: &[SyncEntity]) -> Result<ApplyOutcome, String> {
    if entities.is_empty() {
        return Ok(ApplyOutcome {
            applied: 0,
            failed: 0,
        });
    }

    // RAII transaction: rolls back automatically if we return early before commit.
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut applied = 0;
    let mut failed = 0;

    for entity in entities {
        let result = match entity.entity_type.as_str() {
            "client" => apply_client(&tx, &entity.data, &entity.action),
            "project" => apply_project(&tx, &entity.data, &entity.action),
            "time_entry" => apply_time_entry(&tx, &entity.data, &entity.action),
            "klippekort" => apply_klippekort(&tx, &entity.data, &entity.action),
            _ => {
                eprintln!(
                    "Skipping unknown entity type from server: {}",
                    entity.entity_type
                );
                continue;
            }
        };

        match result {
            Ok(()) => applied += 1,
            Err(e) => {
                eprintln!(
                    "Failed to apply {} {}: {}",
                    entity.entity_type, entity.action, e
                );
                failed += 1;
            }
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(ApplyOutcome { applied, failed })
}

/// Returns the local `updated_at` for an entity identified by its remote_id, if it
/// exists locally. Used for last-write-wins comparison on pull.
fn local_updated_at(conn: &Connection, entity_type: &str, remote_id: &str) -> Option<String> {
    // Hvidlisten er porten: intet kald styres tabellenavn ind i SQL'en. Se
    // `remote_id_of` for den samme løsning på den anden vej.
    let table = match entity_type {
        "client" => "clients",
        "project" => "projects",
        "time_entry" => "time_entries",
        "klippekort" => "klippekort",
        _ => return None,
    };
    conn.query_row(
        &format!("SELECT updated_at FROM {} WHERE remote_id = ?1", table),
        params![remote_id],
        |row| row.get(0),
    )
    .ok()
}

/// Returns true if the incoming server `updatedAt` should overwrite the local row.
/// Server-wins on ties and when timestamps are missing/unparseable (the safe default
/// for first-class server data); local-wins only when the local row is strictly newer,
/// which preserves un-pushed local edits.
fn should_apply_remote(local: Option<&str>, incoming: Option<&str>) -> bool {
    match (local, incoming) {
        (Some(l), Some(i)) => {
            // Lexicographic compare works for RFC3339/ISO-8601 timestamps in UTC.
            // Apply unless the local copy is strictly newer.
            !(l > i)
        }
        // No local row, or unknown timestamps: apply the server's version.
        _ => true,
    }
}

/// Hvad serverens afviste rækker betyder for os.
///
/// Serveren svarer 200 med én `try` omkring hver entitet, så **hele svaret er
/// ikke en fejl** — de afviste rækker ligger i `errors`. Uden at læse dem skel
/// vi ikke en afvisning fra en kørsel der *lykkedes* på serveren, og det er her
/// synk-køen bliver hængende.
#[derive(Debug, Default)]
pub struct PushUdfald {
    /// Afvisninger der betyder «rækken ligger allerede på serveren under præcis
    /// det id vi sendte». De er talt med i `pushed` og skrevet ned som `remote_id`.
    pub accepteret: Vec<AcceptedEntity>,
    /// Rigtige afvisninger: rækkerne bliver i køen og tælles her, så brugeren
    /// kan se at køen ikke er tom.
    pub afvist: usize,
    /// Serverens egen tekst fra den første rigtige afvisning.
    pub foerste_fejl: Option<String>,
}

/// Postgres' fejl for en primær-nøgle-kollision. Den kommer fra `handleCreate`,
/// der indsætter under det id vi sendte (`remote_id ?? id`) — altså betyder den
/// *ikke* at vi har lavet noget forkert, men at et tidligere push af præcis
/// denne række nåede serveren, mens svaret gik tabt.
///
/// Uden den her skeln lå den `sync_log`-række `synced = 0` tilbage og blev
/// afvist igen ved hver synk: en kø der aldrig tørrer, en `remote_id` der aldrig
/// skrives, og en bruger der intet kan se forklare på.
///
/// **Tabellen er en del af beviset.** Postgres skriver
/// `duplicate key value violates unique constraint "klippekort_pkey"`, og det
/// navn skal være den tabel vores entitetstype skriver til. Ellers ville en
/// kollision i en helt anden tabel (et id der tilfældigvis genbruges) tælles
/// som «den her række er allerede på serveren» — og så rydder vi en log-række
/// for en ændring, der aldrig kom ud.
fn er_dublet_paa_serveren(entity_type: &str, fejl: &str) -> bool {
    let lavere = fejl.to_lowercase();
    if !(lavere.contains("duplicate key") || lavere.contains("unique constraint")) {
        return false;
    }
    match (serverens_tabel(entity_type), begraensningsnavn(fejl)) {
        (Some(tabel), Some(navn)) => navn == format!("{}_pkey", tabel),
        // Kan vi ikke læse beviset, tør vi ikke gætte: serverens schema er ikke
        // vores, og en fejl vi ikke kan læse sletter vi aldrig på.
        _ => false,
    }
}

/// Serverens tabelnavn pr. entitetstype — ikke altid vores egne navne. Et
/// klippekort hedder `prepaid_packages` der, og det er den der står i
/// kollisionsfejlen.
fn serverens_tabel(entity_type: &str) -> Option<&'static str> {
    match entity_type {
        "client" => Some("clients"),
        "project" => Some("projects"),
        "time_entry" => Some("time_entries"),
        "klippekort" => Some("prepaid_packages"),
        _ => None,
    }
}

/// Navnet i `"..."` i Postgres' fejltekst. Postgres sætter det i gåseøjne,
/// og der står ingen andre i en kollisionsfejl.
fn begraensningsnavn(fejl: &str) -> Option<String> {
    let foran = fejl.find('"')? + 1;
    let rest = &fejl[foran..];
    let slut = rest.find('"')?;
    Some(rest[..slut].to_lowercase())
}

/// Læser de afviste rækker og deler dem i de to slags: dem der allerede er på
/// serveren, og dem der stadig skal prøves igen.
///
/// En dublet regnes kun som accepteret når vi kan finde den lokale række — vi
/// skal kende det id serveren kender den under, ellers ville vi skrive en
/// `remote_id` vi ikke har belæg for. Alt andet bliver liggende i køen: en
/// afvisning må aldrig slettes, for det er den eneste kopi af en lokal ændring.
pub fn klassificer_push_fejl(conn: &Connection, fejl: &[PushError]) -> PushUdfald {
    let mut udfald = PushUdfald::default();

    for e in fejl {
        let Some(local_id) = e.local_id.as_deref().filter(|id| !id.is_empty()) else {
            // Serveren afviste en entitetstype den ikke kender. Der er ingen
            // lokal række at prøve igen, men det skal stadig kunne ses.
            udfald.afvist += 1;
            if udfald.foerste_fejl.is_none() {
                udfald.foerste_fejl = Some(e.error.clone());
            }
            continue;
        };

        let Some(remote_id) = remote_id_of(conn, &e.entity_type, local_id) else {
            // Rækken er væk lokalt (slettet imens pushen var i vej). Vi rører
            // intet og lader den tælle som afvist — synk-loggen hører til den.
            udfald.afvist += 1;
            if udfald.foerste_fejl.is_none() {
                udfald.foerste_fejl = Some(e.error.clone());
            }
            continue;
        };

        if er_dublet_paa_serveren(&e.entity_type, &e.error) {
            udfald.accepteret.push(AcceptedEntity {
                local_id: local_id.to_string(),
                remote_id,
                entity_type: e.entity_type.clone(),
            });
        } else {
            udfald.afvist += 1;
            if udfald.foerste_fejl.is_none() {
                udfald.foerste_fejl = Some(e.error.clone());
            }
        }
    }

    udfald
}

/// Did the server refuse this row because of its klippekort? `deductHoursCore`
/// throws for an unknown, inactive or expired card and for too few hours left,
/// and every one of those messages names the card ("klippekort…"); the push
/// route's own zero-hours guard says "prepaid".
pub fn er_klippekort_afvisning(entity_type: &str, fejl: &str) -> bool {
    if entity_type != "time_entry" {
        return false;
    }
    let lavere = fejl.to_lowercase();
    lavere.contains("klippekort") || lavere.contains("prepaid")
}

/// Commits the result of a push in ONE atomic transaction:
///   1. Maps each accepted entity's `remote_id` (+ `synced_at`) onto its local row.
///   2. Marks as `synced = 1` ONLY the sync_log rows that were (a) part of this push
///      (`collected_log_ids`) AND (b) for an entity the server accepted.
///
/// This fixes two data-loss classes at once:
///   - Rows inserted into sync_log during the network round-trip are NOT in
///     `collected_log_ids`, so they stay unsynced and get re-pushed next time
///     (no silent loss).
///   - Server-rejected / conflicting rows are NOT in `accepted`, so they are never
///     cleared and will be retried.
///
/// Both writes share a single transaction: if remote_id mapping fails, nothing is
/// marked synced, so a later push won't create duplicate inserts on the server.
pub fn commit_push_result(
    conn: &Connection,
    accepted: &[AcceptedEntity],
    collected_log_ids: &[i64],
) -> Result<(), String> {
    if accepted.is_empty() {
        return Ok(());
    }

    // RAII transaction: any `?` early-return drops `tx` and rolls back automatically.
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let now = chrono::Utc::now().to_rfc3339();

    use std::collections::HashSet;
    let collected: HashSet<i64> = collected_log_ids.iter().copied().collect();

    for item in accepted {
        let table = match item.entity_type.as_str() {
            "client" => "clients",
            "project" => "projects",
            "time_entry" => "time_entries",
            "klippekort" => "klippekort",
            _ => continue,
        };

        // 1. Map the remote_id onto the local row.
        tx.execute(
            &format!(
                "UPDATE {} SET remote_id = ?1, synced_at = ?2 WHERE id = ?3",
                table
            ),
            params![item.remote_id, now, item.local_id],
        )
        .map_err(|e| {
            format!(
                "Failed to update remote_id for {} {}: {}",
                item.entity_type, item.local_id, e
            )
        })?;

        // 2. Mark synced ONLY the collected sync_log rows for this accepted entity.
        //    We bound by collected ids so newer (in-flight) edits to the same entity
        //    remain unsynced and get re-pushed.
        let mut stmt = tx
            .prepare(
                "SELECT id FROM sync_log
                 WHERE synced = 0 AND entity_type = ?1 AND entity_id = ?2",
            )
            .map_err(|e| format!("Failed to prepare sync_log lookup: {}", e))?;

        let ids: Vec<i64> = stmt
            .query_map(params![item.entity_type, item.local_id], |row| row.get(0))
            .map_err(|e| format!("Failed to query sync_log: {}", e))?
            .filter_map(|r| r.ok())
            .filter(|id| collected.contains(id))
            .collect();
        drop(stmt);

        for id in ids {
            tx.execute(
                "UPDATE sync_log SET synced = 1 WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("Failed to mark sync_log row synced: {}", e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(())
}

/// Applies server-wins conflict resolution: for each conflicting entity the server
/// returns its authoritative `server_data`, which we apply locally (overwriting the
/// local edit). The conflicting sync_log rows are then marked synced so they are not
/// re-pushed (the server already has the winning version). Runs in one transaction.
///
/// Conflicts are NEVER cleared by the accepted-path marking, so this is the only place
/// they get resolved — they can't be silently dropped.
pub fn resolve_conflicts(
    conn: &Connection,
    conflicts: &[ConflictEntity],
    collected_log_ids: &[i64],
) -> Result<(), String> {
    if conflicts.is_empty() {
        return Ok(());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    use std::collections::HashSet;
    let collected: HashSet<i64> = collected_log_ids.iter().copied().collect();

    for conflict in conflicts {
        // Apply server's authoritative data (server-wins).
        let result = match conflict.entity_type.as_str() {
            "client" => apply_client(&tx, &conflict.server_data, "update"),
            "project" => apply_project(&tx, &conflict.server_data, "update"),
            "time_entry" => apply_time_entry(&tx, &conflict.server_data, "update"),
            "klippekort" => apply_klippekort(&tx, &conflict.server_data, "update"),
            _ => {
                eprintln!(
                    "Skipping unknown conflict entity type: {}",
                    conflict.entity_type
                );
                continue;
            }
        };
        if let Err(e) = result {
            eprintln!(
                "Failed to apply server_data for conflicted {} {}: {}",
                conflict.entity_type, conflict.local_id, e
            );
            continue;
        }

        // Mark the conflicting (collected) sync_log rows synced: the local edit lost,
        // so re-pushing it would just conflict again.
        let mut stmt = tx
            .prepare(
                "SELECT id FROM sync_log
                 WHERE synced = 0 AND entity_type = ?1 AND entity_id = ?2",
            )
            .map_err(|e| format!("Failed to prepare sync_log lookup: {}", e))?;
        let ids: Vec<i64> = stmt
            .query_map(params![conflict.entity_type, conflict.local_id], |row| {
                row.get(0)
            })
            .map_err(|e| format!("Failed to query sync_log: {}", e))?
            .filter_map(|r| r.ok())
            .filter(|id| collected.contains(id))
            .collect();
        drop(stmt);

        for id in ids {
            tx.execute(
                "UPDATE sync_log SET synced = 1 WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("Failed to mark conflicted sync_log row synced: {}", e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(())
}

/// Saves last sync timestamp to settings table.
pub fn save_last_sync(conn: &Connection, timestamp: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('sync_last_sync', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![timestamp],
    )
    .map_err(|e| format!("Failed to save last sync timestamp: {}", e))?;
    Ok(())
}

/// Gets last sync timestamp from settings table.
pub fn get_last_sync(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'sync_last_sync'",
        [],
        |row| row.get(0),
    )
    .ok()
}

/// Saves user profile data received from Cloud sync into the settings table.
/// Only overwrites settings that have a non-null value in the profile, so
/// user-local overrides are preserved unless the cloud provides a value.
/// Wrapped in a transaction to batch the writes.
///
/// Fejler den, ruller transaktionen hele profil-syncen tilbage og fejlen gives
/// videre til kalderen. Det er ikke pænhed: et kald, der bare logger, efterlod
/// brugeren med en halv gemt profil og `profile_synced_from_cloud = true`, så
/// appen troede den var opdateret, mens den aldrig blev prøvet igen.
pub fn save_user_profile(
    conn: &Connection,
    profile: &serde_json::Value,
) -> Result<(), String> {
    // RAII transaction: if we return early it rolls back; otherwise committed below.
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| crate::db::errors::propager("kunne ikke starte profil-sync", e))?;

    let pairs: Vec<(&str, Option<&str>)> = vec![
        ("user_name", profile["name"].as_str()),
        ("user_email", profile["email"].as_str()),
        (
            "default_hourly_rate",
            profile["defaultHourlyRate"].as_str(),
        ),
        ("organization_name", profile["organizationName"].as_str()),
    ];

    for (key, value) in pairs {
        if let Some(val) = value {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, val],
            )
            .map_err(|e| {
                crate::db::errors::propager(
                    &format!("kunne ikke gemme profil-feltet '{key}' fra skyen"),
                    e,
                )
            })?;
        }
    }

    // Mark that profile data was synced from cloud
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('profile_synced_from_cloud', 'true')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )
    .map_err(|e| crate::db::errors::propager("kunne ikke markere profilen som synkroniseret", e))?;

    // En commit, der fejler, ruller hele profil-syncen tilbage. Skal ikke tie,
    // ellers tror appen at profilen er opdateret, mens indstillingerne er det
    // gamle.
    tx.commit()
        .map_err(|e| crate::db::errors::propager("kunne ikke gemme profilen fra skyen", e))
}

/// Gets the count of pending (unsynced) changes.
pub fn pending_change_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM sync_log WHERE synced = 0",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

// --------------------------------------------------------------------------
// Sync log helper — called from CRUD commands
// --------------------------------------------------------------------------

/// Logs a change to sync_log so it can be pushed on next sync.
pub fn log_sync_change(conn: &Connection, entity_type: &str, entity_id: &str, action: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(e) = crate::db::errors::execute_retry(
        conn,
        "INSERT INTO sync_log (entity_type, entity_id, action, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![entity_type, entity_id, action, now],
    ) {
        // Kloggen er den eneste vej til skyen, så en tabt linje betyder at
        // ændringen aldrig når ud. Den skal derfor aldrig forsvinde lydløst.
        crate::db::errors::record(
            &format!("kunne ikke logge ændring af {entity_type} til synk-køen"),
            e,
        );
    }
}

// --------------------------------------------------------------------------
// Read entity data helpers (for building push payloads)
// --------------------------------------------------------------------------

/// The id the SERVER knows a row by.
///
/// Every id we push — an entity's own `id` and every `clientId`/`projectId`/
/// `klippekortId` pointing at another row — has to be the server's id. The server
/// looks rows up by primary key (`eq(clients.id, remoteId)`) and Postgres
/// enforces its foreign keys against the same column, so a local UUID matches
/// no row and is rejected as an unknown key: an edit of a client that came from
/// the web app never lands ("Entity not found"), and a project whose customer
/// was pulled from the cloud fails to insert at all.
///
/// The local id stands in only while the row has never been pushed. Then the
/// create in this same batch is inserted under exactly that UUID — the server
/// only strips ids prefixed `local_` — so the reference is already right. A
/// parent that is genuinely unknown to the server therefore fails loudly and is
/// retried, instead of writing a dangling reference.
///
/// An empty `remote_id` counts as unknown: it can only come from a server that
/// answered without an id, and trusting it would aim every later push at the
/// row whose id is the empty string.
fn remote_of(local_id: Option<String>, remote_id: Option<String>) -> Option<String> {
    match remote_id.filter(|r| !r.is_empty()) {
        Some(remote) => Some(remote),
        None => local_id,
    }
}

/// The server id of a logged entity, by entity type — for rows that are gone or
/// no longer readable as a full payload (deletes). The table name is picked from
/// a whitelist rather than formatted in, so nothing caller-controlled reaches
/// the SQL string.
fn remote_id_of(conn: &Connection, entity_type: &str, local_id: &str) -> Option<String> {
    let sql = match entity_type {
        "client" => "SELECT COALESCE(NULLIF(remote_id, ''), id) FROM clients WHERE id = ?1",
        "project" => "SELECT COALESCE(NULLIF(remote_id, ''), id) FROM projects WHERE id = ?1",
        "time_entry" => {
            "SELECT COALESCE(NULLIF(remote_id, ''), id) FROM time_entries WHERE id = ?1"
        }
        "klippekort" => {
            "SELECT COALESCE(NULLIF(remote_id, ''), id) FROM klippekort WHERE id = ?1"
        }
        _ => return None,
    };
    conn.query_row(sql, params![local_id], |row| row.get(0)).ok()
}

fn read_client_data(conn: &Connection, id: &str) -> Option<serde_json::Value> {
    conn.query_row(
        "SELECT id, remote_id, name, email, phone, company, cvr, hourly_rate, notes, is_archived, created_at, updated_at
         FROM clients WHERE id = ?1",
        params![id],
        |row| {
            Ok(serde_json::json!({
                "id": remote_of(Some(row.get::<_, String>(0)?), row.get::<_, Option<String>>(1)?),
                "remoteId": row.get::<_, Option<String>>(1)?,
                "name": row.get::<_, String>(2)?,
                "email": row.get::<_, Option<String>>(3)?,
                "phone": row.get::<_, Option<String>>(4)?,
                "company": row.get::<_, Option<String>>(5)?,
                // Serverens kolonne hedder `cvr_number` — `cvr` er et ukendt
                // felt, og serverens insert læser kun kolonner den kender, så
                // det blev kastet stille væk og læst tilbage som NULL.
                "cvrNumber": row.get::<_, Option<String>>(6)?,
                // Samme historie: kundens sats hedder `default_hourly_rate`.
                "defaultHourlyRate": row.get::<_, Option<f64>>(7)?,
                "notes": row.get::<_, Option<String>>(8)?,
                "isArchived": row.get::<_, i32>(9)? != 0,
                "createdAt": row.get::<_, String>(10)?,
                "updatedAt": row.get::<_, String>(11)?,
            }))
        },
    )
    .ok()
}

fn read_project_data(conn: &Connection, id: &str) -> Option<serde_json::Value> {
    conn.query_row(
        "SELECT p.id, p.remote_id, c.id, c.remote_id, p.name, p.hourly_rate, p.estimated_hours, p.is_archived, p.created_at, p.updated_at
         FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?1",
        params![id],
        |row| {
            Ok(serde_json::json!({
                "id": remote_of(Some(row.get::<_, String>(0)?), row.get::<_, Option<String>>(1)?),
                "remoteId": row.get::<_, Option<String>>(1)?,
                "clientId": remote_of(row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?),
                "name": row.get::<_, String>(4)?,
                "hourlyRate": row.get::<_, Option<f64>>(5)?,
                // Webens projekttabel kalder timebudgettet `budget_hours`
                // (decimal(7,2)) — `estimated_hours` er vores lokale navn, og
                // serveren læser kun kolonner den kender, så et estimat sendt
                // under vores navn blev kastet stille væk. Rundes til to
                // decimaler, ellers afviser kolonnen værdien.
                "budgetHours": row.get::<_, Option<f64>>(6)?.map(|h| (h * 100.0).round() / 100.0),
                "isArchived": row.get::<_, i32>(7)? != 0,
                "createdAt": row.get::<_, String>(8)?,
                "updatedAt": row.get::<_, String>(9)?,
            }))
        },
    )
    .ok()
}

/// The instant a stored timestamp names, in seconds since the epoch.
///
/// `time_entries.start_time` holds two shapes, because two layers write it:
/// Rust's `Utc::now().to_rfc3339()` carries an offset (`…T09:00:00+00:00`),
/// while the frontend builds `` `${date}T${time}:00` `` with no offset at
/// all. The bare form is the wall clock the user typed, so it is read in this
/// machine's timezone — a 09:00 entry in Danish summer time names 07:00Z.
/// `tidsstempel` in `time_entries.rs` makes the same distinction.
fn sekunder(rå: &str) -> Option<i64> {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(rå) {
        return Some(t.timestamp());
    }
    chrono::NaiveDateTime::parse_from_str(rå, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .and_then(|naive| {
            naive
                .and_local_timezone(chrono::Local)
                // Et tvist timepunkt (skiftet mellem sommertid og vintertid)
                // har to svar; det tidligste er det gængse valg, og det er
                // deterministisk — `single()` ville give None og tabe tiden.
                .earliest()
                .map(|t| t.timestamp())
        })
}

/// The same instant as an unambiguous UTC timestamp (`2026-01-01T08:00:00Z`).
fn utc_iso(sekunder: i64) -> String {
    chrono::DateTime::from_timestamp(sekunder, 0)
        .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).expect("epoch"))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// A SQLite `created_at` (`datetime('now')`, i.e. **UTC** in "YYYY-MM-DD HH:MM:SS")
/// as the unambiguous instant the server stores correctly.
///
/// `sekunder` cannot read it: that form is a *local* wall clock for a timestamp
/// the user typed, and this one is UTC with a space where the others have a T.
fn sql_utc_iso(rå: &str) -> Option<String> {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(rå) {
        return Some(utc_iso(t.timestamp()));
    }
    chrono::NaiveDateTime::parse_from_str(rå, "%Y-%m-%d %H:%M:%S%.f")
        .ok()
        .map(|naive| utc_iso(naive.and_utc().timestamp()))
}

/// The server's `is_active` as our local `status`. A card the server has made
/// inactive is one the user closed in the web app — we mark it `inactive`, and a
/// payload that says nothing keeps whatever we already knew.
fn aktivt_status(is_active: &serde_json::Value) -> &'static str {
    match is_active.as_bool() {
        Some(false) => "inactive",
        _ => "active",
    }
}

/// The server's `autoDeduct` as the desktop's `auto_deduct` (0/1). Missing
/// (an older server) means on, as on the server.
fn auto_deduct_flag(v: &serde_json::Value) -> i32 {
    match v.as_bool() {
        Some(false) => 0,
        _ => 1,
    }
}

/// The server's `expiryDate` back to the desktop's `YYYY-MM-DD` (`expires_at`).
/// The date part is taken as written, so a round trip does not shift a day.
fn expiry_date(d: &serde_json::Value) -> Option<String> {
    d.as_str()
        .and_then(|s| s.get(0..10))
        .map(|s| s.to_string())
}

/// The server's `expiryDate` on its way up. The desktop stores a plain date, the
/// server a timestamp read back as UTC, so a bare "2026-12-31" would be midnight
/// Danish time and arrive as the day before.
fn expiry_date_up(dato: &str) -> String {
    format!("{dato}T00:00:00Z")
}

/// `hours` and `date` — the two fields a pushed registration cannot do without.
///
/// Both are `NOT NULL` on the server, and the server has no `duration` column
/// at all, so the web app derives every hour total from `hours`. Without them
/// the insert fails and no registration ever reaches timetrack.dk.
///
/// Both are read off the row that already carries the time, so nothing new is
/// asked of the user. `date` goes as UTC because the server stores a
/// `timestamp` as the digits it parses and reads them back as UTC: a bare
/// local `14:00:00` would be stored as 14:00Z and arrive two hours out in
/// Denmark.
fn hours_and_date(
    start_time: &str,
    end_time: Option<&str>,
    duration: Option<i64>,
) -> (f64, Option<String>) {
    let start = sekunder(start_time);
    let hours = duration
        .filter(|d| *d > 0)
        .map(|d| d as f64 / 3600.0)
        .or_else(|| match (start, end_time.and_then(sekunder)) {
            (Some(s), Some(e)) if e > s => Some((e - s) as f64 / 3600.0),
            _ => None,
        })
        .unwrap_or(0.0);
    // The server keeps two decimals. Sending more would mean a later pull
    // rewrites the local duration to a slightly different number for no
    // reason — the same registration, counted differently on the way back.
    let hours = (hours * 100.0).round() / 100.0;
    (hours, start.map(utc_iso))
}

fn read_time_entry_data(conn: &Connection, id: &str) -> Option<serde_json::Value> {
    conn.query_row(
        "SELECT t.id, t.remote_id, p.id, p.remote_id, c.id, c.remote_id, k.id, k.remote_id,
                t.description, t.start_time, t.end_time, t.duration, t.is_billable, t.is_running,
                t.source, t.created_at, t.updated_at, k.expires_at
         FROM time_entries t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN clients c ON c.id = t.client_id
         LEFT JOIN klippekort k ON k.id = t.klippekort_id
         WHERE t.id = ?1",
        params![id],
        |row| {
            let start_time = row.get::<_, String>(9)?;
            let end_time = row.get::<_, Option<String>>(10)?;
            let duration = row.get::<_, Option<i64>>(11)?;
            let (hours, date) = hours_and_date(&start_time, end_time.as_deref(), duration);
            let klippekort_id =
                remote_of(row.get::<_, Option<String>>(6)?, row.get::<_, Option<String>>(7)?);
            // `prepaidPackageId` is the field the server's push route hands to
            // `deductHoursCore` — it is the ONLY way a pushed entry makes the
            // server move the package's balance. Without it the entry syncs as
            // an ordinary row, and the next pull overwrites the local
            // `used_hours` with the server's untouched number (`apply_klippekort`
            // writes it), so the deduction silently disappears again.
            //
            // Only sent when there are hours to deduct: the server refuses a
            // prepaid push with zero hours ("Ugyldigt timetal"), rolls the whole
            // create back, and the entry would then be re-pushed — and refused —
            // on every future sync.
            //
            // Nor for a card that has expired since: the server refuses to
            // deduct from it (it checks "now", not the entry's date), and the
            // whole entry would bounce on every sync. The entry then goes up as
            // ordinary time — the user can still pick a card on timetrack.dk.
            let udloebet = klippekort_udloebet(
                row.get::<_, Option<String>>(17)?.as_deref(),
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
            );
            let prepaid_package_id =
                if hours > 0.0 && !udloebet { klippekort_id.clone() } else { None };
            let local_id = row.get::<_, String>(0)?;
            Ok(serde_json::json!({
                "id": remote_of(Some(local_id.clone()), row.get::<_, Option<String>>(1)?),
                // Idempotency key: the local id is a stable uuid v4. A push
                // whose response was lost (30 s timeout, a redeploy mid-batch)
                // is sent again — with this key the server finds the row it
                // already created instead of inserting a duplicate (and
                // deducting the klippekort twice).
                "clientEntryId": local_id,
                "remoteId": row.get::<_, Option<String>>(1)?,
                "projectId": remote_of(row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?),
                "clientId": remote_of(row.get::<_, Option<String>>(4)?, row.get::<_, Option<String>>(5)?),
                "klippekortId": klippekort_id,
                "prepaidPackageId": prepaid_package_id,
                "description": row.get::<_, Option<String>>(8)?,
                "startTime": sekunder(&start_time).map(utc_iso).unwrap_or(start_time),
                "endTime": end_time.as_deref().and_then(sekunder).map(utc_iso).or(end_time),
                "duration": duration,
                "hours": hours,
                "date": date,
                "isBillable": row.get::<_, i32>(12)? != 0,
                "isRunning": row.get::<_, i32>(13)? != 0,
                "source": row.get::<_, String>(14)?,
                "createdAt": row.get::<_, String>(15)?,
                "updatedAt": row.get::<_, String>(16)?,
            }))
        },
    )
    .ok()
}

/// Has a klippekort with this `expires_at` (`YYYY-MM-DD`) expired on `today`?
/// The card is valid through its whole expiry day, as on the server.
fn klippekort_udloebet(expires_at: Option<&str>, today: &str) -> bool {
    match expires_at.and_then(|d| d.trim().get(..10)) {
        Some(dato) => dato < today,
        None => false,
    }
}

fn read_klippekort_data(conn: &Connection, id: &str) -> Option<serde_json::Value> {
    conn.query_row(
        "SELECT k.id, k.remote_id, c.id, c.remote_id, p.id, p.remote_id,
                k.name, k.total_hours, k.used_hours, k.hourly_rate, k.status, k.expires_at,
                k.created_at, k.updated_at
         FROM klippekort k
         LEFT JOIN clients c ON c.id = k.client_id
         LEFT JOIN projects p ON p.id = k.project_id
         WHERE k.id = ?1",
        params![id],
        |row| {
            let created_at: String = row.get(12)?;
            let expires_at: Option<String> = row.get(11)?;
            Ok(serde_json::json!({
                "id": remote_of(Some(row.get::<_, String>(0)?), row.get::<_, Option<String>>(1)?),
                "remoteId": row.get::<_, Option<String>>(1)?,
                "clientId": remote_of(row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?),
                "projectId": remote_of(row.get::<_, Option<String>>(4)?, row.get::<_, Option<String>>(5)?),
                "name": row.get::<_, String>(6)?,
                "totalHours": row.get::<_, f64>(7)?,
                "usedHours": row.get::<_, f64>(8)?,
                "hourlyRate": row.get::<_, Option<f64>>(9)?,
                // Webens klippekorttabel har ingen `status`/`expires_at`, men
                // `is_active` og `expiry_date`. Vores `status` er et lokalt
                // udtryk for kortets tilstand (udløbet, brugt op) og afgøres på
                // webappen af datoer og saldo, så den sendes ikke.
                "expiryDate": expires_at.as_deref().map(expiry_date_up),
                // `purchase_date` er NOT NULL uden default på serveren: uden den
                // blev HVERT klippekort-push afvist, og afvisningen blev slugt af
                // push-svaret, så kortet aldrig nåede timetrack.dk igen, mens
                // kø-loggen stod og prøvede for evigt. Det er nærmeste vi har på
                // en købsdato.
                "purchaseDate": sql_utc_iso(&created_at)
                    .unwrap_or_else(|| utc_iso(chrono::Utc::now().timestamp())),
                "createdAt": created_at,
                "updatedAt": row.get::<_, String>(13)?,
            }))
        },
    )
    .ok()
}

// --------------------------------------------------------------------------
// Apply remote entities to local DB (upsert)
// --------------------------------------------------------------------------

fn apply_client(conn: &Connection, data: &serde_json::Value, action: &str) -> Result<(), String> {
    let remote_id = data["id"].as_str().unwrap_or_default();

    if action == "delete" {
        conn.execute(
            "UPDATE clients SET is_archived = 1, updated_at = ?1 WHERE remote_id = ?2",
            params![chrono::Utc::now().to_rfc3339(), remote_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    // Preserve the server's authoritative timestamp instead of stamping now(),
    // so a synced row doesn't look newer than it is on the next push.
    let remote_updated = data["updatedAt"].as_str();
    let updated_at = remote_updated.unwrap_or(&now);

    // Check if we already have this entity by remote_id
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM clients WHERE remote_id = ?1",
            params![remote_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(local_id) = existing_id {
        // Last-write-wins: skip if the local copy is strictly newer (un-pushed edit).
        let local_ts = local_updated_at(conn, "client", remote_id);
        if !should_apply_remote(local_ts.as_deref(), remote_updated) {
            return Ok(());
        }
        // Update existing
        // `cvr_number` og `default_hourly_rate` er serverens navne. Læser vi
        // `cvr`/`hourlyRate` i stedet, er de fraværende i svaret, og hver eneste
        // pull nulstiller CVR-nummeret og kundens sats — de to felter der afgør,
        // hvad der faktureres.
        conn.execute(
            "UPDATE clients SET name = ?1, email = ?2, phone = ?3, company = ?4,
             cvr = COALESCE(?5, cvr),
             hourly_rate = COALESCE(?6, hourly_rate),
             notes = ?7, is_archived = ?8, updated_at = ?9, synced_at = ?10
             WHERE id = ?11",
            params![
                data["name"].as_str().unwrap_or(""),
                data["email"].as_str(),
                data["phone"].as_str(),
                data["company"].as_str(),
                data["cvrNumber"].as_str(),
                json_decimal(&data["defaultHourlyRate"]),
                data["notes"].as_str(),
                if data["isArchived"].as_bool().unwrap_or(false) { 1 } else { 0 },
                updated_at,
                now,
                local_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        // Insert new
        let local_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO clients (id, remote_id, name, email, phone, company, cvr, hourly_rate, notes, is_archived, created_at, updated_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                local_id,
                remote_id,
                data["name"].as_str().unwrap_or(""),
                data["email"].as_str(),
                data["phone"].as_str(),
                data["company"].as_str(),
                data["cvrNumber"].as_str(),
                json_decimal(&data["defaultHourlyRate"]),
                data["notes"].as_str(),
                if data["isArchived"].as_bool().unwrap_or(false) { 1 } else { 0 },
                data["createdAt"].as_str().unwrap_or(&now),
                updated_at,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn apply_project(conn: &Connection, data: &serde_json::Value, action: &str) -> Result<(), String> {
    let remote_id = data["id"].as_str().unwrap_or_default();

    if action == "delete" {
        conn.execute(
            "UPDATE projects SET is_archived = 1, updated_at = ?1 WHERE remote_id = ?2",
            params![chrono::Utc::now().to_rfc3339(), remote_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let remote_updated = data["updatedAt"].as_str();
    let updated_at = remote_updated.unwrap_or(&now);

    // Resolve client_id: the server sends remote client ID, look up the local ID.
    // If the parent client hasn't arrived yet (out-of-order pull), this stays NULL
    // rather than writing the raw remote id into a local-id column. A later pull of
    // the same project (or relink_orphans) re-resolves it once the parent exists.
    let client_id: Option<String> = data["clientId"].as_str().and_then(|remote_cid| {
        conn.query_row(
            "SELECT id FROM clients WHERE remote_id = ?1",
            params![remote_cid],
            |row| row.get(0),
        )
        .ok()
    });

    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM projects WHERE remote_id = ?1",
            params![remote_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(local_id) = existing_id {
        let local_ts = local_updated_at(conn, "project", remote_id);
        if !should_apply_remote(local_ts.as_deref(), remote_updated) {
            return Ok(());
        }
        // Serverens projekttabel har hverken `color` eller `estimated_hours`
        // under vores navne: farven findes slet ikke i webens schema, og
        // timebudgettet hedder `budget_hours`. En ligelig skrivning nulstiller
        // derfor den lokale farve ved hvert pull, og et estimat, der er sat i
        // webappen, kommer aldrig ned. COALESCE lader en værdi, serveren faktisk
        // kender, vinde, og lader ellers den lokale stå.
        conn.execute(
            "UPDATE projects SET client_id = ?1, name = ?2,
             hourly_rate = COALESCE(?3, hourly_rate),
             estimated_hours = COALESCE(?4, estimated_hours),
             color = COALESCE(?5, color),
             is_archived = ?6, updated_at = ?7, synced_at = ?8 WHERE id = ?9",
            params![
                client_id,
                data["name"].as_str().unwrap_or(""),
                json_decimal(&data["hourlyRate"]),
                json_decimal(&data["budgetHours"]),
                data["color"].as_str(),
                if data["isArchived"].as_bool().unwrap_or(false) { 1 } else { 0 },
                updated_at,
                now,
                local_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let local_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO projects (id, remote_id, client_id, name, hourly_rate, estimated_hours, color, is_archived, created_at, updated_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                local_id,
                remote_id,
                client_id,
                data["name"].as_str().unwrap_or(""),
                json_decimal(&data["hourlyRate"]),
                json_decimal(&data["budgetHours"]),
                data["color"].as_str(),
                if data["isArchived"].as_bool().unwrap_or(false) { 1 } else { 0 },
                data["createdAt"].as_str().unwrap_or(&now),
                updated_at,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Et `decimal`-felt som serveren sender: en decimal-kolonne ankommer som en
/// JSON-**streng** (`"10.00"`), ikke som et tal, så `as_f64` alene læser den som
/// ingenting. `as_f64` uden den her læsning har gjort `total_hours` og
/// `used_hours` 0 på hvert pullet klippekort — altså en forudbetalt saldo, der
/// så ud brugt.
fn json_decimal(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// `hours` as the server sends it: a decimal column arrives as a JSON string
/// (`"1.50"`), not a number, so `as_f64` alone would read every pulled
/// registration as having no length at all.
fn json_hours(data: &serde_json::Value) -> Option<f64> {
    json_decimal(&data["hours"])
}

/// Start, end and duration for a registration on its way down from the server.
///
/// The server keeps a registration as `date` + `hours` and only writes
/// `startTime`/`endTime` when the client sent them — a registration made in the
/// web app has neither. The old code stored `start_time = ""` and no duration,
/// and a row with an empty start time matches no report period, no calendar day
/// and no day total, so hours booked in the browser were simply gone. Rebuild
/// the clock times from what the server does have.
///
/// `lokal_varighed` is what the row already holds. A length the server sends
/// always wins; anything else — including a zero, which is all the server has
/// for a registration it has no length of its own for — leaves the local value
/// alone, because overwriting a real duration with nothing is precisely how a
/// registration loses its hours.
fn pulled_times(
    data: &serde_json::Value,
    lokal_varighed: Option<i64>,
) -> (String, Option<String>, Option<i64>) {
    let start = data["startTime"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .and_then(sekunder)
        // `date` is the server's own answer to "when was this", so it is the
        // next best thing; `createdAt` at least puts the row on a real day
        // instead of nowhere.
        .or_else(|| data["date"].as_str().and_then(sekunder))
        .or_else(|| data["createdAt"].as_str().and_then(sekunder));

    let duration = data["duration"]
        .as_i64()
        .filter(|d| *d > 0)
        .or_else(|| {
            json_hours(data)
                .filter(|h| *h > 0.0)
                .map(|h| (h * 3600.0).round() as i64)
        })
        .or(lokal_varighed);

    let end = data["endTime"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .and_then(sekunder)
        .or_else(|| match (start, duration.filter(|d| *d > 0)) {
            (Some(s), Some(d)) => Some(s + d),
            _ => None,
        })
        .and_then(|s| lokal_naiv(&utc_iso(s)));

    // `time_entries` gemmer sig i LOKAL VÆG-TID, og alt, der læser kolonnen
    // som tekst eller med `DATE()` (dagsgrænser, rapportens dagssum,
    // `auto_invoice`), regner den som væg-tid. Skrev pullen UTC-instanser ind,
    // ville en registrering fra serveren mellem midnat og kl. 02:00 dansk
    // havne på den foregående kalenderdag her — præcis den fejl `tid.rs`
    // indførte porten for. (`date` **opad** i `hours_and_date` er en anden
    // sag: serverens egen kolonne læses som UTC, og det er målt rigtigt.)
    let start_time = match start {
        Some(s) => lokal_naiv(&utc_iso(s)).unwrap_or_else(|| utc_iso(s)),
        // Unparseable rather than empty: better a row the user can find and
        // repair than one that silently matches nothing.
        None => data["startTime"]
            .as_str()
            .or_else(|| data["date"].as_str())
            .unwrap_or_default()
            .to_string(),
    };

    (start_time, end, duration)
}

fn apply_time_entry(
    conn: &Connection,
    data: &serde_json::Value,
    action: &str,
) -> Result<(), String> {
    let remote_id = data["id"].as_str().unwrap_or_default();

    if action == "delete" {
        conn.execute(
            "DELETE FROM time_entries WHERE remote_id = ?1",
            params![remote_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Resolve foreign keys from remote IDs to local IDs
    let project_id: Option<String> = data["projectId"].as_str().and_then(|rid| {
        conn.query_row(
            "SELECT id FROM projects WHERE remote_id = ?1",
            params![rid],
            |row| row.get(0),
        )
        .ok()
    });

    let client_id: Option<String> = data["clientId"].as_str().and_then(|rid| {
        conn.query_row(
            "SELECT id FROM clients WHERE remote_id = ?1",
            params![rid],
            |row| row.get(0),
        )
        .ok()
    });

    // The server's column is `prepaidPackageId` (`prepaid_package_id`); there is
    // no `klippekortId` column, so a pulled row only ever carries the former.
    // `klippekortId` stays as the fallback so a payload from an older server —
    // and our own, which sends both — still resolves.
    let klippekort_remote = data["prepaidPackageId"]
        .as_str()
        .or_else(|| data["klippekortId"].as_str());
    let klippekort_id: Option<String> = klippekort_remote.and_then(|rid| {
        conn.query_row(
            "SELECT id FROM klippekort WHERE remote_id = ?1",
            params![rid],
            |row| row.get(0),
        )
        .ok()
    });

    let remote_updated = data["updatedAt"].as_str();
    let updated_at = remote_updated.unwrap_or(&now);

    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM time_entries WHERE remote_id = ?1",
            params![remote_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(local_id) = existing_id {
        let local_ts = local_updated_at(conn, "time_entry", remote_id);
        if !should_apply_remote(local_ts.as_deref(), remote_updated) {
            return Ok(());
        }
        let lokal_varighed: Option<i64> = conn
            .query_row(
                "SELECT duration FROM time_entries WHERE id = ?1",
                params![local_id],
                |row| row.get(0),
            )
            .ok();
        let (start_time, end_time, duration) = pulled_times(data, lokal_varighed);
        conn.execute(
            "UPDATE time_entries SET project_id = ?1, client_id = ?2, klippekort_id = ?3,
             description = ?4, start_time = ?5, end_time = ?6, duration = ?7,
             is_billable = ?8, is_running = ?9, source = ?10, updated_at = ?11, synced_at = ?12
             WHERE id = ?13",
            params![
                project_id,
                client_id,
                klippekort_id,
                data["description"].as_str(),
                start_time,
                end_time,
                duration,
                if data["isBillable"].as_bool().unwrap_or(true) { 1 } else { 0 },
                if data["isRunning"].as_bool().unwrap_or(false) { 1 } else { 0 },
                data["source"].as_str().unwrap_or("manual"),
                updated_at,
                now,
                local_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let local_id = uuid::Uuid::new_v4().to_string();
        let (start_time, end_time, duration) = pulled_times(data, None);
        conn.execute(
            "INSERT INTO time_entries (id, remote_id, project_id, client_id, klippekort_id,
             description, start_time, end_time, duration, is_billable, is_running, source,
             created_at, updated_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                local_id,
                remote_id,
                project_id,
                client_id,
                klippekort_id,
                data["description"].as_str(),
                start_time,
                end_time,
                duration,
                if data["isBillable"].as_bool().unwrap_or(true) { 1 } else { 0 },
                if data["isRunning"].as_bool().unwrap_or(false) { 1 } else { 0 },
                data["source"].as_str().unwrap_or("manual"),
                data["createdAt"].as_str().unwrap_or(&now),
                updated_at,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn apply_klippekort(
    conn: &Connection,
    data: &serde_json::Value,
    action: &str,
) -> Result<(), String> {
    let remote_id = data["id"].as_str().unwrap_or_default();

    if action == "delete" {
        conn.execute(
            "DELETE FROM klippekort WHERE remote_id = ?1",
            params![remote_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Resolve foreign keys
    let client_id: Option<String> = data["clientId"].as_str().and_then(|rid| {
        conn.query_row(
            "SELECT id FROM clients WHERE remote_id = ?1",
            params![rid],
            |row| row.get(0),
        )
        .ok()
    });

    let project_id: Option<String> = data["projectId"].as_str().and_then(|rid| {
        conn.query_row(
            "SELECT id FROM projects WHERE remote_id = ?1",
            params![rid],
            |row| row.get(0),
        )
        .ok()
    });

    let remote_updated = data["updatedAt"].as_str();
    let updated_at = remote_updated.unwrap_or(&now);

    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM klippekort WHERE remote_id = ?1",
            params![remote_id],
            |row| row.get(0),
        )
        .ok();

    // FK resolution: if the parent client hasn't arrived yet (out-of-order pull),
    // write NULL rather than stuffing the raw REMOTE id into the local-id column
    // (which would never relink and corrupt the FK). `client_id` is nullable in the
    // schema; a later pull / relink re-resolves it once the parent client exists.
    let resolved_client_id: Option<String> = client_id;

    if let Some(local_id) = existing_id {
        let local_ts = local_updated_at(conn, "klippekort", remote_id);
        if !should_apply_remote(local_ts.as_deref(), remote_updated) {
            return Ok(());
        }
        // `total_hours`, `used_hours` og `hourly_rate` er `decimal` på serveren
        // og ankommer som **strenge** ("10.00"). Læst med `as_f64` var de NULL, så
        // hvert pull skrev 0 og 0 — en forudbetalt saldo, der så ud brugt op.
        conn.execute(
            "UPDATE klippekort SET client_id = ?1, project_id = ?2, name = ?3,
             total_hours = COALESCE(?4, total_hours),
             used_hours = COALESCE(?5, used_hours),
             hourly_rate = COALESCE(?6, hourly_rate),
             status = ?7, expires_at = COALESCE(?8, expires_at),
             updated_at = ?9, synced_at = ?10, auto_deduct = ?12 WHERE id = ?11",
            params![
                resolved_client_id,
                project_id,
                data["name"].as_str().unwrap_or(""),
                json_decimal(&data["totalHours"]),
                json_decimal(&data["usedHours"]),
                json_decimal(&data["hourlyRate"]),
                aktivt_status(&data["isActive"]),
                expiry_date(&data["expiryDate"]),
                updated_at,
                now,
                local_id,
                auto_deduct_flag(&data["autoDeduct"]),
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let local_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO klippekort (id, remote_id, client_id, project_id, name, total_hours,
             used_hours, hourly_rate, status, expires_at, created_at, updated_at, synced_at,
             auto_deduct)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                local_id,
                remote_id,
                resolved_client_id,
                project_id,
                data["name"].as_str().unwrap_or(""),
                json_decimal(&data["totalHours"]).unwrap_or(0.0),
                json_decimal(&data["usedHours"]).unwrap_or(0.0),
                json_decimal(&data["hourlyRate"]),
                aktivt_status(&data["isActive"]),
                expiry_date(&data["expiryDate"]),
                data["createdAt"].as_str().unwrap_or(&now),
                updated_at,
                now,
                auto_deduct_flag(&data["autoDeduct"]),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use crate::sync::api::{AcceptedEntity, ConflictEntity, PushResponse};
    use rusqlite::Connection;

    /// Test helper: mark all currently-collected unsynced rows synced, mirroring the
    /// old blanket behavior but expressed via the new scoped API for tests that only
    /// care about the count going to zero.
    fn mark_all_synced(conn: &Connection) {
        conn.execute("UPDATE sync_log SET synced = 1 WHERE synced = 0", [])
            .expect("mark synced");
    }

    /// Creates an in-memory SQLite database with the full schema and foreign keys enabled.
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn
    }

    /// Insert a client.
    fn insert_client(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO clients (id, name, created_at, updated_at) VALUES (?1, ?2, datetime('now'), datetime('now'))",
            params![id, name],
        )
        .expect("insert client");
    }

    /// Insert a project (with optional client_id).
    fn insert_project(conn: &Connection, id: &str, name: &str, client_id: Option<&str>) {
        conn.execute(
            "INSERT INTO projects (id, client_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now'))",
            params![id, client_id, name],
        )
        .expect("insert project");
    }

    // -----------------------------------------------------------------------
    // collect_pending_changes
    // -----------------------------------------------------------------------

    #[test]
    fn collect_pending_changes_empty_returns_empty() {
        let conn = setup_db();
        let changes = collect_pending_changes(&conn);
        assert!(changes.entities.is_empty());
        assert!(changes.log_rows.is_empty());
    }

    #[test]
    fn collect_pending_changes_returns_create_entity() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme Corp");
        log_sync_change(&conn, "client", "c1", "create");

        let changes = collect_pending_changes(&conn);
        assert_eq!(changes.entities.len(), 1);
        assert_eq!(changes.entities[0].entity_type, "client");
        assert_eq!(changes.entities[0].action, "create");
        assert_eq!(changes.entities[0].data["name"].as_str(), Some("Acme Corp"));
        assert_eq!(changes.entities[0].local_id.as_deref(), Some("c1"));
        assert_eq!(changes.log_rows.len(), 1);
    }

    #[test]
    fn collect_pending_changes_returns_delete_entity() {
        let conn = setup_db();
        log_sync_change(&conn, "client", "c1", "delete");

        let changes = collect_pending_changes(&conn);
        assert_eq!(changes.entities.len(), 1);
        assert_eq!(changes.entities[0].entity_type, "client");
        assert_eq!(changes.entities[0].action, "delete");
        assert_eq!(changes.entities[0].data["id"].as_str(), Some("c1"));
    }

    #[test]
    fn collect_pending_changes_returns_multiple_entity_types() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "p1", "Project A", Some("c1"));

        log_sync_change(&conn, "client", "c1", "create");
        log_sync_change(&conn, "project", "p1", "create");

        let changes = collect_pending_changes(&conn);
        assert_eq!(changes.entities.len(), 2);

        let types: Vec<&str> = changes
            .entities
            .iter()
            .map(|c| c.entity_type.as_str())
            .collect();
        assert!(types.contains(&"client"));
        assert!(types.contains(&"project"));
    }

    #[test]
    fn collect_pending_changes_skips_already_synced() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        log_sync_change(&conn, "client", "c1", "create");
        mark_all_synced(&conn);

        let changes = collect_pending_changes(&conn);
        assert!(
            changes.entities.is_empty(),
            "synced entries should not be collected"
        );
    }

    #[test]
    fn collect_pending_changes_skips_unknown_entity_type() {
        let conn = setup_db();
        log_sync_change(&conn, "unknown_table", "x1", "create");

        let changes = collect_pending_changes(&conn);
        assert!(
            changes.entities.is_empty(),
            "unknown entity types should be skipped"
        );
    }

    /// #4 — watermark uses the entity's real updated_at, not the log insert time.
    #[test]
    fn collect_pending_changes_uses_entity_updated_at_as_watermark() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO clients (id, name, created_at, updated_at) VALUES ('c1', 'Acme', '2026-01-01T00:00:00Z', '2026-02-02T00:00:00Z')",
            [],
        )
        .expect("insert client");
        log_sync_change(&conn, "client", "c1", "create");

        let changes = collect_pending_changes(&conn);
        assert_eq!(changes.entities.len(), 1);
        assert_eq!(
            changes.entities[0].local_updated_at.as_deref(),
            Some("2026-02-02T00:00:00Z"),
            "watermark must be the entity's updated_at, not sync_log.created_at"
        );
    }

    /// #8 — running timers are excluded from the push payload.
    #[test]
    fn collect_pending_changes_excludes_running_timers() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO time_entries (id, start_time, is_running, created_at, updated_at)
             VALUES ('t-run', '2026-01-01T00:00:00Z', 1, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert running");
        conn.execute(
            "INSERT INTO time_entries (id, start_time, is_running, created_at, updated_at)
             VALUES ('t-done', '2026-01-01T00:00:00Z', 0, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert finished");
        log_sync_change(&conn, "time_entry", "t-run", "create");
        log_sync_change(&conn, "time_entry", "t-done", "create");

        let changes = collect_pending_changes(&conn);
        let ids: Vec<&str> = changes
            .entities
            .iter()
            .filter_map(|e| e.local_id.as_deref())
            .collect();
        assert!(ids.contains(&"t-done"));
        assert!(
            !ids.contains(&"t-run"),
            "running timers must not be pushed"
        );
    }

    // -----------------------------------------------------------------------
    // Push payload speaks the server's ids (D2a)
    //
    // The server resolves an update/delete by primary key and Postgres enforces
    // its foreign keys against the same column, so a local UUID in the payload
    // matches no row: an edit of something pulled from the cloud never lands, and
    // a child pointing at a pulled parent is refused outright. These tests pin
    // every id and every reference the payload carries.
    // -----------------------------------------------------------------------

    /// Sets a row's server id, standing in for a completed push.
    fn set_remote_id(conn: &Connection, table: &str, local_id: &str, remote_id: &str) {
        let sql = match table {
            "clients" => "UPDATE clients SET remote_id = ?1 WHERE id = ?2",
            "projects" => "UPDATE projects SET remote_id = ?1 WHERE id = ?2",
            "time_entries" => "UPDATE time_entries SET remote_id = ?1 WHERE id = ?2",
            "klippekort" => "UPDATE klippekort SET remote_id = ?1 WHERE id = ?2",
            other => panic!("ukendt tabel: {other}"),
        };
        conn.execute(sql, params![remote_id, local_id])
            .expect("sæt remote_id");
    }

    fn payload_for(conn: &Connection, entity_type: &str, entity_id: &str) -> serde_json::Value {
        let changes = collect_pending_changes(conn);
        let entity = changes
            .entities
            .iter()
            .find(|e| e.entity_type == entity_type && e.local_id.as_deref() == Some(entity_id))
            .unwrap_or_else(|| panic!("ingen payload for {entity_type}/{entity_id}"));
        entity.data.clone()
    }

    #[test]
    fn push_sends_the_servers_id_for_a_pulled_row() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        set_remote_id(&conn, "clients", "c1", "srv-uuid-1");
        log_sync_change(&conn, "client", "c1", "update");

        let data = payload_for(&conn, "client", "c1");
        assert_eq!(
            data["id"].as_str(),
            Some("srv-uuid-1"),
            "opdateringen skal ramme den række, serveren faktisk kender — \
             det lokale UUID finder ingen række og fejler med 'Entity not found'"
        );
    }

    #[test]
    fn push_sends_the_servers_client_id_on_a_project() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "p1", "Nyt website", Some("c1"));
        set_remote_id(&conn, "clients", "c1", "srv-uuid-1");
        log_sync_change(&conn, "project", "p1", "update");

        let data = payload_for(&conn, "project", "p1");
        assert_eq!(
            data["clientId"].as_str(),
            Some("srv-uuid-1"),
            "projektets kunde skal være serverens kunde-id; et lokalt UUID er et \
             nøgle der ikke findes, så indsættelsen afvises"
        );
        assert_eq!(
            data["id"].as_str(),
            Some("p1"),
            "et projekt der aldrig er pushet beholder sit lokale id"
        );
    }

    #[test]
    fn push_sends_server_ids_for_all_three_references_on_a_time_entry() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "p1", "Nyt website", Some("c1"));
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, status, created_at, updated_at)
             VALUES ('k1', 'c1', 'Paket', 10.0, 0.0, 'active', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert klippekort");
        conn.execute(
            "INSERT INTO time_entries (id, project_id, client_id, klippekort_id, start_time, duration, created_at, updated_at)
             VALUES ('t1', 'p1', 'c1', 'k1', '2026-01-01T09:00:00Z', 3600, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert time entry");
        set_remote_id(&conn, "clients", "c1", "srv-c1");
        set_remote_id(&conn, "projects", "p1", "srv-p1");
        set_remote_id(&conn, "klippekort", "k1", "srv-k1");
        set_remote_id(&conn, "time_entries", "t1", "srv-t1");
        log_sync_change(&conn, "time_entry", "t1", "update");

        let data = payload_for(&conn, "time_entry", "t1");
        assert_eq!(data["id"].as_str(), Some("srv-t1"));
        assert_eq!(data["projectId"].as_str(), Some("srv-p1"));
        assert_eq!(data["clientId"].as_str(), Some("srv-c1"));
        assert_eq!(
            data["klippekortId"].as_str(),
            Some("srv-k1"),
            "klippekortet skal være serverens id, ellers trækkes den forkerte saldo"
        );
    }

    #[test]
    fn push_asks_the_server_to_deduct_the_klippekort() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, status, created_at, updated_at)
             VALUES ('k1', 'c1', 'Paket', 10.0, 2.0, 'active', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert klippekort");
        conn.execute(
            "INSERT INTO time_entries (id, client_id, klippekort_id, start_time, duration, created_at, updated_at)
             VALUES ('t1', 'c1', 'k1', '2026-01-01T09:00:00Z', 3600, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert time entry");
        set_remote_id(&conn, "klippekort", "k1", "srv-k1");
        log_sync_change(&conn, "time_entry", "t1", "create");

        let data = payload_for(&conn, "time_entry", "t1");
        assert_eq!(
            data["prepaidPackageId"].as_str(),
            Some("srv-k1"),
            "serveren trækker kun saldoen, hvis feltet hedder dens eget id — \
             ellers synker posten som en helt almindelig række, og næste pull \
             skriver det uændrede used_hours tilbage og trækket forsvinder"
        );
    }

    #[test]
    fn push_sender_det_lokale_id_som_idempotensnoegle() {
        // Et push hvis svar gik tabt (30 s timeout, redeploy midt i batchen)
        // sendes igen. Serveren slår så posten op på `clientEntryId` i stedet
        // for at oprette en dublet og trække klippekortet to gange.
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        let local_id = "3f2c1b7a-9d4e-4c2a-8b1f-0e6d5a4c3b21";
        conn.execute(
            "INSERT INTO time_entries (id, client_id, start_time, duration, created_at, updated_at)
             VALUES (?1, 'c1', '2026-01-01T09:00:00Z', 3600, datetime('now'), datetime('now'))",
            params![local_id],
        )
        .expect("insert time entry");
        log_sync_change(&conn, "time_entry", local_id, "create");

        let foerste = payload_for(&conn, "time_entry", local_id);
        assert_eq!(foerste["clientEntryId"].as_str(), Some(local_id));

        // Også efter serveren har givet posten et id: nøglen er den samme.
        set_remote_id(&conn, "time_entries", local_id, "srv-t1");
        let anden = payload_for(&conn, "time_entry", local_id);
        assert_eq!(anden["clientEntryId"].as_str(), Some(local_id));
        assert_eq!(anden["id"].as_str(), Some("srv-t1"));
    }

    #[test]
    fn push_beder_ikke_om_traek_fra_et_udloebet_klippekort() {
        // Serveren kaster ved et udløbet kort og ruller HELE posten tilbage —
        // så sad den fast i køen og blev afvist ved hver synk.
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, status, expires_at, created_at, updated_at)
             VALUES ('k1', 'c1', 'Paket', 10.0, 2.0, 'active', '2020-01-31', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert klippekort");
        conn.execute(
            "INSERT INTO time_entries (id, client_id, klippekort_id, start_time, duration, created_at, updated_at)
             VALUES ('t1', 'c1', 'k1', '2020-01-01T09:00:00Z', 3600, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert time entry");
        set_remote_id(&conn, "klippekort", "k1", "srv-k1");
        log_sync_change(&conn, "time_entry", "t1", "create");

        let data = payload_for(&conn, "time_entry", "t1");
        assert_eq!(data["prepaidPackageId"], serde_json::Value::Null);
    }

    #[test]
    fn klippekort_gaelder_hele_udloebsdagen() {
        assert!(!klippekort_udloebet(None, "2026-10-02"));
        assert!(!klippekort_udloebet(Some(""), "2026-10-02"));
        assert!(!klippekort_udloebet(Some("2026-10-02"), "2026-10-02"));
        assert!(!klippekort_udloebet(Some("2026-10-03"), "2026-10-02"));
        assert!(klippekort_udloebet(Some("2026-10-01"), "2026-10-02"));
    }

    #[test]
    fn klippekort_afvisninger_genkendes_kun_paa_tidsposter() {
        for fejl in [
            "Klippekort ikke fundet",
            "Klippekort er ikke aktivt",
            "Klippekortet er udløbet",
            "Ikke nok timer tilbage på klippekortet. Tilgængelige timer: 0.50",
            "Ugyldigt timetal på prepaid-tidspost",
        ] {
            assert!(er_klippekort_afvisning("time_entry", fejl), "{fejl}");
        }
        assert!(!er_klippekort_afvisning("time_entry", "Perioden er låst"));
        assert!(!er_klippekort_afvisning("klippekort", "Klippekort ikke fundet"));
    }

    #[test]
    fn pull_gemmer_klippekortets_auto_traek_flag() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        set_remote_id(&conn, "clients", "c1", "srv-c1");
        let kort = |auto: serde_json::Value| SyncEntity {
            entity_type: "klippekort".to_string(),
            action: "create".to_string(),
            data: serde_json::json!({
                "id": "srv-k1",
                "clientId": "srv-c1",
                "name": "Prepaid",
                "totalHours": "10.00",
                "usedHours": "0.00",
                "isActive": true,
                "autoDeduct": auto,
                "updatedAt": "2026-01-01T00:00:00Z",
            }),
            local_id: None,
            local_updated_at: None,
        };
        apply_remote_changes(&conn, &[kort(serde_json::json!(false))]).expect("apply");
        let flag: i32 = conn
            .query_row("SELECT auto_deduct FROM klippekort WHERE remote_id = 'srv-k1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(flag, 0, "auto-træk slået fra på serveren skal følge med ned");

        let mut slaaet_til = kort(serde_json::json!(true));
        slaaet_til.action = "update".to_string();
        slaaet_til.data["updatedAt"] = serde_json::json!("2026-02-01T00:00:00Z");
        apply_remote_changes(&conn, &[slaaet_til]).expect("apply");
        let flag: i32 = conn
            .query_row("SELECT auto_deduct FROM klippekort WHERE remote_id = 'srv-k1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(flag, 1);
    }

    #[test]
    fn push_sends_no_package_when_the_entry_has_none() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "INSERT INTO time_entries (id, client_id, start_time, duration, created_at, updated_at)
             VALUES ('t1', 'c1', '2026-01-01T09:00:00Z', 3600, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert time entry");
        log_sync_change(&conn, "time_entry", "t1", "create");

        let data = payload_for(&conn, "time_entry", "t1");
        assert_eq!(
            data["prepaidPackageId"],
            serde_json::Value::Null,
            "en post uden klippekort må ikke bede serveren trække på nogen"
        );
    }

    #[test]
    fn push_sends_no_package_when_there_are_no_hours_to_deduct() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, status, created_at, updated_at)
             VALUES ('k1', 'c1', 'Paket', 10.0, 0.0, 'active', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert klippekort");
        // Start == end: nul timer. Serveren afviser en prepaid-push uden timer
        // ("Ugyldigt timetal"), ruller hele create tilbage og sender posten i
        // uvisningen — så den afvises igen ved hver næste synk, for evigt.
        conn.execute(
            "INSERT INTO time_entries (id, client_id, klippekort_id, start_time, end_time, duration, created_at, updated_at)
             VALUES ('t1', 'c1', 'k1', '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z', 0, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert time entry");
        set_remote_id(&conn, "klippekort", "k1", "srv-k1");
        log_sync_change(&conn, "time_entry", "t1", "create");

        let data = payload_for(&conn, "time_entry", "t1");
        assert_eq!(
            data["prepaidPackageId"],
            serde_json::Value::Null,
            "nul timer kan ikke trækkes — feltet skal blive væk, ellers sidder \
             posten fast i synk-køen"
        );
    }

    #[test]
    fn a_pull_replaces_the_local_balance_with_the_servers() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "INSERT INTO klippekort (id, remote_id, client_id, name, total_hours, used_hours, status, created_at, updated_at)
             VALUES ('k1', 'srv-k1', 'c1', 'Paket', 10.0, 4.0, 'active', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert klippekort");

        // Serveren har ikke modtaget trækket, så den har fortsat 2 brugte timer
        // efter at desktop har trukket to mere. Den sande klippekort-score for
        // D2c: dette er præcis den kodevej, der gjorde et lokalt træk forsvinde.
        apply_klippekort(
            &conn,
            &serde_json::json!({
                "id": "srv-k1",
                "name": "Paket",
                "totalHours": 10.0,
                "usedHours": 2.0,
                "status": "active",
            }),
            "update",
        )
        .expect("apply klippekort");

        let used: f64 = conn
            .query_row("SELECT used_hours FROM klippekort WHERE id = 'k1'", [], |row| {
                row.get(0)
            })
            .expect("query used_hours");
        assert_eq!(used, 2.0);
    }

    #[test]
    fn push_sends_server_ids_on_a_klippekort() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "p1", "Nyt website", Some("c1"));
        conn.execute(
            "INSERT INTO klippekort (id, client_id, project_id, name, total_hours, used_hours, status, created_at, updated_at)
             VALUES ('k1', 'c1', 'p1', 'Paket', 10.0, 0.0, 'active', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert klippekort");
        set_remote_id(&conn, "clients", "c1", "srv-c1");
        set_remote_id(&conn, "projects", "p1", "srv-p1");
        set_remote_id(&conn, "klippekort", "k1", "srv-k1");
        log_sync_change(&conn, "klippekort", "k1", "update");

        let data = payload_for(&conn, "klippekort", "k1");
        assert_eq!(data["id"].as_str(), Some("srv-k1"));
        assert_eq!(data["clientId"].as_str(), Some("srv-c1"));
        assert_eq!(data["projectId"].as_str(), Some("srv-p1"));
    }

    #[test]
    fn delete_payload_sends_the_servers_id() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        set_remote_id(&conn, "clients", "c1", "srv-uuid-1");
        log_sync_change(&conn, "client", "c1", "delete");

        let changes = collect_pending_changes(&conn);
        assert_eq!(changes.entities[0].data["id"].as_str(), Some("srv-uuid-1"));
        assert_eq!(
            changes.entities[0].local_id.as_deref(),
            Some("c1"),
            "localId skal stadig være det lokale id — serveren bruger det til at \
             finde den række, der skal have den nye remote_id"
        );
    }

    #[test]
    fn push_keeps_the_local_id_until_the_row_has_been_pushed() {
        // Første push: serveren indsætter rækken under præcis det UUID vi sender
        // (den fjerner kun id'er med 'local_'-præfiks), så referencer mellem
        // rækker i samme kø er korrekte uden at kende serverens id'er endnu.
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "p1", "Nyt website", Some("c1"));
        log_sync_change(&conn, "project", "p1", "create");

        let data = payload_for(&conn, "project", "p1");
        assert_eq!(data["id"].as_str(), Some("p1"));
        assert_eq!(data["clientId"].as_str(), Some("c1"));
    }

    #[test]
    fn an_empty_remote_id_counts_as_unknown() {
        // En server der svarede uden id kan have gemt en tom streng. Stoler vi på
        // den, rammer hver senere push rækken med det tomme id.
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        set_remote_id(&conn, "clients", "c1", "");
        log_sync_change(&conn, "client", "c1", "update");

        assert_eq!(payload_for(&conn, "client", "c1")["id"].as_str(), Some("c1"));
    }

    #[test]
    fn a_row_without_a_parent_sends_no_client_at_all() {
        // Et projekt uden kunde (og en tidspost uden projekt) er et gyldigt
        // mål i denne app — de må ikke få en UUID fra en tilfældig række med.
        let conn = setup_db();
        insert_project(&conn, "p1", "Eget arbejde", None);
        log_sync_change(&conn, "project", "p1", "create");

        let data = payload_for(&conn, "project", "p1");
        assert!(
            data["clientId"].is_null(),
            "intet kunde lokalt skal sendes som null, ikke som et UUID"
        );
    }

    // -----------------------------------------------------------------------
    // pending_change_count
    // -----------------------------------------------------------------------

    #[test]
    fn pending_change_count_zero_initially() {
        let conn = setup_db();
        assert_eq!(pending_change_count(&conn), 0);
    }

    #[test]
    fn pending_change_count_increments() {
        let conn = setup_db();
        log_sync_change(&conn, "client", "c1", "create");
        log_sync_change(&conn, "project", "p1", "update");
        assert_eq!(pending_change_count(&conn), 2);
    }

    #[test]
    fn pending_change_count_decreases_after_mark_synced() {
        let conn = setup_db();
        log_sync_change(&conn, "client", "c1", "create");
        assert_eq!(pending_change_count(&conn), 1);

        mark_all_synced(&conn);
        assert_eq!(pending_change_count(&conn), 0);
    }

    // -----------------------------------------------------------------------
    // apply_remote_changes — upsert
    // -----------------------------------------------------------------------

    #[test]
    fn apply_remote_changes_inserts_new_client() {
        let conn = setup_db();

        let entities = vec![SyncEntity {
            entity_type: "client".to_string(),
            action: "create".to_string(),
            data: serde_json::json!({
                "id": "remote-c1",
                "name": "Remote Client",
                "email": "hello@example.com",
                "isArchived": false,
            }),
            local_id: None,
            local_updated_at: None,
        }];

        let outcome = apply_remote_changes(&conn, &entities).expect("apply");
        assert_eq!(outcome.applied, 1);

        let name: String = conn
            .query_row(
                "SELECT name FROM clients WHERE remote_id = 'remote-c1'",
                [],
                |row| row.get(0),
            )
            .expect("query client");
        assert_eq!(name, "Remote Client");
    }

    #[test]
    fn apply_remote_changes_updates_existing_client() {
        let conn = setup_db();

        conn.execute(
            "INSERT INTO clients (id, remote_id, name, created_at, updated_at) VALUES ('local-c1', 'remote-c1', 'Old Name', datetime('now'), datetime('now'))",
            [],
        ).expect("insert client");

        let entities = vec![SyncEntity {
            entity_type: "client".to_string(),
            action: "update".to_string(),
            data: serde_json::json!({
                "id": "remote-c1",
                "name": "Updated Name",
                "isArchived": false,
            }),
            local_id: None,
            local_updated_at: None,
        }];

        let outcome = apply_remote_changes(&conn, &entities).expect("apply");
        assert_eq!(outcome.applied, 1);

        let name: String = conn
            .query_row(
                "SELECT name FROM clients WHERE id = 'local-c1'",
                [],
                |row| row.get(0),
            )
            .expect("query updated client");
        assert_eq!(name, "Updated Name");
    }

    #[test]
    fn apply_remote_changes_delete_client_archives() {
        let conn = setup_db();

        conn.execute(
            "INSERT INTO clients (id, remote_id, name, created_at, updated_at) VALUES ('local-c1', 'remote-c1', 'Acme', datetime('now'), datetime('now'))",
            [],
        ).expect("insert client");

        let entities = vec![SyncEntity {
            entity_type: "client".to_string(),
            action: "delete".to_string(),
            data: serde_json::json!({ "id": "remote-c1" }),
            local_id: None,
            local_updated_at: None,
        }];

        let outcome = apply_remote_changes(&conn, &entities).expect("apply");
        assert_eq!(outcome.applied, 1);

        let archived: i32 = conn
            .query_row(
                "SELECT is_archived FROM clients WHERE id = 'local-c1'",
                [],
                |row| row.get(0),
            )
            .expect("query client");
        assert_eq!(archived, 1);
    }

    #[test]
    fn apply_remote_changes_skips_unknown_entity_type() {
        let conn = setup_db();

        let entities = vec![SyncEntity {
            entity_type: "unknown_type".to_string(),
            action: "create".to_string(),
            data: serde_json::json!({"id": "x1"}),
            local_id: None,
            local_updated_at: None,
        }];

        let outcome = apply_remote_changes(&conn, &entities).expect("apply");
        assert_eq!(outcome.applied, 0);
    }

    #[test]
    fn apply_remote_changes_handles_multiple_entities() {
        let conn = setup_db();

        let entities = vec![
            SyncEntity {
                entity_type: "client".to_string(),
                action: "create".to_string(),
                data: serde_json::json!({
                    "id": "rc1",
                    "name": "Client A",
                    "isArchived": false,
                }),
                local_id: None,
                local_updated_at: None,
            },
            SyncEntity {
                entity_type: "client".to_string(),
                action: "create".to_string(),
                data: serde_json::json!({
                    "id": "rc2",
                    "name": "Client B",
                    "isArchived": false,
                }),
                local_id: None,
                local_updated_at: None,
            },
        ];

        let outcome = apply_remote_changes(&conn, &entities).expect("apply");
        assert_eq!(outcome.applied, 2);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))
            .expect("count clients");
        assert_eq!(count, 2);
    }

    // -----------------------------------------------------------------------
    // commit_push_result — remote_id mapping
    // -----------------------------------------------------------------------

    /// Collect the sync_log ids currently unsynced (helper for push-result tests).
    fn collected_ids(conn: &Connection) -> Vec<i64> {
        let mut stmt = conn
            .prepare("SELECT id FROM sync_log WHERE synced = 0 ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    #[test]
    fn commit_push_result_sets_remote_id_and_synced_at() {
        let conn = setup_db();
        insert_client(&conn, "local-c1", "Acme");
        log_sync_change(&conn, "client", "local-c1", "create");
        let ids = collected_ids(&conn);

        let accepted = vec![AcceptedEntity {
            local_id: "local-c1".to_string(),
            remote_id: "remote-c1".to_string(),
            entity_type: "client".to_string(),
        }];

        commit_push_result(&conn, &accepted, &ids).expect("commit push result");

        let (remote_id, synced_at): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT remote_id, synced_at FROM clients WHERE id = 'local-c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query remote_id");

        assert_eq!(remote_id.as_deref(), Some("remote-c1"));
        assert!(synced_at.is_some(), "synced_at should be set");
    }

    /// D2e. En dublet er en afvisning, der betyder «rækken ligger allerede». Den
    /// skal tælles som accepteret og skrive serverens id ned, ellers står
    /// `sync_log`-rækken `synced = 0` for evigt.
    #[test]
    fn dublet_paa_serveren_tommer_koen_og_skriver_remote_id() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        log_sync_change(&conn, "client", "c1", "create");
        let ids = collected_ids(&conn);

        // Serveren afviste create med «findes allerede»: et push-svar der gik tabt.
        let fejl = vec![PushError {
            local_id: Some("c1".to_string()),
            entity_type: "client".to_string(),
            error: "duplicate key value violates unique constraint \"clients_pkey\""
                .to_string(),
        }];

        let udfald = klassificer_push_fejl(&conn, &fejl);
        assert_eq!(udfald.afvist, 0, "en dublet er ikke en afvisning");
        assert_eq!(
            udfald.foerste_fejl, None,
            "brugeren skal ikke se en besked om en dublet"
        );
        assert_eq!(udfald.accepteret.len(), 1);

        commit_push_result(&conn, &udfald.accepteret, &ids).expect("commit");

        let remote_id: Option<String> = conn
            .query_row("SELECT remote_id FROM clients WHERE id = 'c1'", [], |r| r.get(0))
            .expect("query");
        assert_eq!(
            remote_id.as_deref(),
            Some("c1"),
            "serveren kender rækken under præcis det id vi sendte"
        );
        assert_eq!(
            collected_ids(&conn).len(),
            0,
            "køen skal tømmes — ellers afvises den samme række for evigt"
        );
    }

    /// En rigtig afvisning må ALDRIG slettes: den er den eneste kopi af en lokal
    /// ændring. Den skal blive liggende og kunne forklares.
    #[test]
    fn en_rigtig_afvisning_bliver_i_koen_med_fejltekst() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        log_sync_change(&conn, "client", "c1", "create");
        let ids = collected_ids(&conn);

        let fejl = vec![PushError {
            local_id: Some("c1".to_string()),
            entity_type: "client".to_string(),
            error: "Entity not found: client/r-c1".to_string(),
        }];

        let udfald = klassificer_push_fejl(&conn, &fejl);
        assert_eq!(udfald.afvist, 1);
        assert!(udfald.accepteret.is_empty());
        assert_eq!(
            udfald.foerste_fejl.as_deref(),
            Some("Entity not found: client/r-c1")
        );

        commit_push_result(&conn, &udfald.accepteret, &ids).expect("commit");
        assert_eq!(
            collected_ids(&conn).len(),
            1,
            "en afvisning må ikke tømme køen — ændringen skal prøves igen"
        );
        let remote_id: Option<String> = conn
            .query_row("SELECT remote_id FROM clients WHERE id = 'c1'", [], |r| r.get(0))
            .expect("query");
        assert_eq!(remote_id, None, "vi må ikke påstå et server-id vi ikke har");
    }

    /// En række der er væk lokalt, mens pushen var i vej, kan vi ikke skrive et
    /// `remote_id` på. Den tælles som afvist, så køen ikke ser tom ud.
    #[test]
    fn dublet_uden_lokal_raekke_taelles_som_avvist() {
        let conn = setup_db();
        let fejl = vec![PushError {
            local_id: Some("slet-og-glemt".to_string()),
            entity_type: "client".to_string(),
            error: "duplicate key value violates unique constraint \"clients_pkey\""
                .to_string(),
        }];

        let udfald = klassificer_push_fejl(&conn, &fejl);
        assert!(udfald.accepteret.is_empty());
        assert_eq!(udfald.afvist, 1);
    }

    /// Serveren afviser en hel entitetstype den ikke kender, uden at pege på en
    /// række. Den skal kunne ses.
    #[test]
    fn afvisning_uden_raekke_taelles_som_avvist() {
        let conn = setup_db();
        let fejl = vec![PushError {
            local_id: None,
            entity_type: "opskrift".to_string(),
            error: "Unknown entity type: opskrift".to_string(),
        }];

        let udfald = klassificer_push_fejl(&conn, &fejl);
        assert!(udfald.accepteret.is_empty());
        assert_eq!(udfald.afvist, 1);
        assert_eq!(
            udfald.foerste_fejl.as_deref(),
            Some("Unknown entity type: opskrift")
        );
    }

    /// En række der allerede er trukket fra serveren må ikke få sit eget lokale
    /// id skrevet som `remote_id` — serverens id er det eneste rigtige.
    #[test]
    fn dublet_paa_en_puljet_raekke_beholder_serverens_id() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute("UPDATE clients SET remote_id = 'r-1' WHERE id = 'c1'", [])
            .expect("set remote id");
        log_sync_change(&conn, "client", "c1", "create");

        let fejl = vec![PushError {
            local_id: Some("c1".to_string()),
            entity_type: "client".to_string(),
            error: "duplicate key value violates unique constraint \"clients_pkey\""
                .to_string(),
        }];

        let udfald = klassificer_push_fejl(&conn, &fejl);
        assert_eq!(
            udfald.accepteret[0].remote_id, "r-1",
            "vi skal sende det id serveren kender rækken under"
        );
    }

    /// Skellene skal laves på Postgres' *egen* tekst, ikke på en forfærdiget
    /// kodefejl: en fejl der ligner en dublet, men ikke er en, ville tømme køen
    /// med en ændring, der aldrig nåede serveren.
    #[test]
    fn kun_postgres_dublet_taelles_som_dublet() {
        // Postgres' kode for en primær-nøgle-kollision, som den kommer ud af
        // push-rutens `handleCreate`.
        assert!(er_dublet_paa_serveren(
            "client",
            "duplicate key value violates unique constraint \"clients_pkey\""
        ));
        assert!(er_dublet_paa_serveren(
            "time_entry",
            "duplicate key value violates unique constraint \"time_entries_pkey\""
        ));
        // Et klippekort hedder `prepaid_packages` på serveren, ikke `klippekort`.
        assert!(er_dublet_paa_serveren(
            "klippekort",
            "duplicate key value violates unique constraint \"prepaid_packages_pkey\""
        ));

        // Alt andet er en rigtig afvisning.
        assert!(!er_dublet_paa_serveren(
            "client",
            "Entity not found: project/r-1"
        ));
        assert!(!er_dublet_paa_serveren(
            "time_entry",
            "Ugyldigt timetal på prepaid-tidspost"
        ));
        assert!(!er_dublet_paa_serveren(
            "time_entry",
            "insert or update on table \"time_entries\" violates foreign key constraint"
        ));
        assert!(!er_dublet_paa_serveren(
            "project",
            "Period is locked (faktura låst): 2026-09-01"
        ));
        assert!(!er_dublet_paa_serveren("client", ""));
        // Ingen entitetstype vi kender → ingen bevis, ingen sletning.
        assert!(!er_dublet_paa_serveren(
            "opskrift",
            "duplicate key value violates unique constraint \"clients_pkey\""
        ));
    }

    /// Hele vejen fra serverens svar: de afviste rækker skal overhovedet nå os.
    /// Det er her D2e startede — `PushResponse` havde ikke feltet, så serverens
    /// arbejde med at samle dem blev kastet væk med resten af svaret.
    #[test]
    fn et_push_svar_uden_errors_felter_er_stadig_et_gyldigt_svar() {
        let json = r#"{
            "accepted": [],
            "conflicts": [],
            "serverTime": "2026-09-30T20:00:00.000Z",
            "errors": [{
                "localId": "c1",
                "type": "client",
                "error": "duplicate key value violates unique constraint \"clients_pkey\""
            }]
        }"#;

        let resp: PushResponse =
            serde_json::from_str(json).expect("svaret med errors skal kunne læses");
        assert_eq!(resp.errors.len(), 1);
        assert_eq!(resp.errors[0].local_id.as_deref(), Some("c1"));
        assert_eq!(resp.errors[0].entity_type, "client");

        // En ældre server uden feltet må ikke gøre svaret ulæseligt — så går
        // `afvist` bare til 0, som før.
        let gammel = r#"{"accepted":[],"conflicts":[],"serverTime":"2026-09-30T20:00:00.000Z"}"#;
        let resp: PushResponse = serde_json::from_str(gammel).expect("svar uden errors");
        assert!(resp.errors.is_empty());
    }

    /// En kollision i en *anden* tabel er ikke vores række, uanset hvor lig
    /// teksten ligner vores egen. Tælles den med, rydder vi en `sync_log`-række
    /// for en ændring, der aldrig kom ud — det er tabt tid, den værste fejl
    /// appen kan lave.
    #[test]
    fn kollision_i_en_anden_tabel_taelles_som_rigtig_afvisning() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        log_sync_change(&conn, "client", "c1", "create");
        let ids = collected_ids(&conn);

        // En klippekort-id der kolliderer med en kunde-id: en fejl fra en helt
        // anden tabel, der ligner vores egen.
        let fejl = vec![PushError {
            local_id: Some("c1".to_string()),
            entity_type: "client".to_string(),
            error: "duplicate key value violates unique constraint \"prepaid_packages_pkey\""
                .to_string(),
        }];

        let udfald = klassificer_push_fejl(&conn, &fejl);
        assert!(udfald.accepteret.is_empty(), "kollisionen er ikke vores række");
        assert_eq!(udfald.afvist, 1);

        commit_push_result(&conn, &udfald.accepteret, &ids).expect("commit");
        assert_eq!(
            collected_ids(&conn).len(),
            1,
            "rækken skal stadig stå i køen, for den kom aldrig ud"
        );
    }

    /// #1 — only the accepted entity's sync_log row is marked synced; an unrelated
    /// pending row (server did NOT accept) stays unsynced and is not lost.
    #[test]
    fn commit_push_result_marks_only_accepted_rows() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Accepted");
        insert_client(&conn, "c2", "Rejected");
        log_sync_change(&conn, "client", "c1", "create");
        log_sync_change(&conn, "client", "c2", "create");
        let ids = collected_ids(&conn);

        // Server accepted only c1.
        let accepted = vec![AcceptedEntity {
            local_id: "c1".to_string(),
            remote_id: "r1".to_string(),
            entity_type: "client".to_string(),
        }];
        commit_push_result(&conn, &accepted, &ids).expect("commit");

        let c1_synced: i32 = conn
            .query_row(
                "SELECT synced FROM sync_log WHERE entity_id = 'c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let c2_synced: i32 = conn
            .query_row(
                "SELECT synced FROM sync_log WHERE entity_id = 'c2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(c1_synced, 1, "accepted row marked synced");
        assert_eq!(c2_synced, 0, "non-accepted row must NOT be marked synced");
    }

    /// #1 — a sync_log row created during the round-trip (not in collected ids) is
    /// never cleared, even if it's for the same accepted entity.
    #[test]
    fn commit_push_result_does_not_clear_inflight_rows() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        log_sync_change(&conn, "client", "c1", "create");
        let ids = collected_ids(&conn); // captures only the first log row

        // A new edit lands while the push is "in flight".
        log_sync_change(&conn, "client", "c1", "update");

        let accepted = vec![AcceptedEntity {
            local_id: "c1".to_string(),
            remote_id: "r1".to_string(),
            entity_type: "client".to_string(),
        }];
        commit_push_result(&conn, &accepted, &ids).expect("commit");

        // The original row is synced; the in-flight update row remains pending.
        let pending: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_log WHERE synced = 0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            pending, 1,
            "in-flight edit must survive and stay pending for re-push"
        );
    }

    /// #2 — remote_id mapping and synced-marking happen atomically. If mapping fails
    /// (bad entity_type routes to no table → skipped, so we simulate atomicity by
    /// asserting both effects land together for a valid accept).
    #[test]
    fn commit_push_result_maps_and_marks_together() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        log_sync_change(&conn, "client", "c1", "create");
        let ids = collected_ids(&conn);

        let accepted = vec![AcceptedEntity {
            local_id: "c1".to_string(),
            remote_id: "r1".to_string(),
            entity_type: "client".to_string(),
        }];
        commit_push_result(&conn, &accepted, &ids).expect("commit");

        let remote: Option<String> = conn
            .query_row("SELECT remote_id FROM clients WHERE id = 'c1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let synced: i32 = conn
            .query_row("SELECT synced FROM sync_log WHERE entity_id = 'c1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(remote.as_deref(), Some("r1"));
        assert_eq!(synced, 1);
    }

    // -----------------------------------------------------------------------
    // resolve_conflicts (#3) — server-wins, never silently dropped
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_conflicts_applies_server_data_and_clears_row() {
        let conn = setup_db();
        // Local edited a client that the server says conflicts.
        conn.execute(
            "INSERT INTO clients (id, remote_id, name, created_at, updated_at) VALUES ('c1', 'r1', 'Local Name', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        log_sync_change(&conn, "client", "c1", "update");
        let ids = collected_ids(&conn);

        let conflicts = vec![ConflictEntity {
            local_id: "c1".to_string(),
            entity_type: "client".to_string(),
            server_data: serde_json::json!({
                "id": "r1",
                "name": "Server Name",
                "isArchived": false,
                "updatedAt": "2026-05-05T00:00:00Z",
            }),
        }];

        resolve_conflicts(&conn, &conflicts, &ids).expect("resolve");

        // Server-wins: local name overwritten.
        let name: String = conn
            .query_row("SELECT name FROM clients WHERE id = 'c1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Server Name");

        // Conflicting sync_log row cleared so it's not re-pushed.
        let synced: i32 = conn
            .query_row("SELECT synced FROM sync_log WHERE entity_id = 'c1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(synced, 1, "conflicted row resolved & cleared");
    }

    /// #3 — conflicted rows are NOT touched by the accepted path: the accepted path
    /// leaves a conflicting pending row alone (only resolve_conflicts clears it).
    #[test]
    fn commit_push_result_leaves_conflicted_rows_alone() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        log_sync_change(&conn, "client", "c1", "update");
        let ids = collected_ids(&conn);

        // c1 was NOT accepted (it conflicted), so accepted list is empty.
        commit_push_result(&conn, &[], &ids).expect("commit");

        let synced: i32 = conn
            .query_row("SELECT synced FROM sync_log WHERE entity_id = 'c1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(synced, 0, "conflicted/unaccepted row stays pending");
    }

    // -----------------------------------------------------------------------
    // #5 — apply error reporting
    // -----------------------------------------------------------------------

    #[test]
    fn apply_remote_changes_reports_no_failures_on_success() {
        let conn = setup_db();
        let entities = vec![SyncEntity {
            entity_type: "client".to_string(),
            action: "create".to_string(),
            data: serde_json::json!({"id": "r1", "name": "A", "isArchived": false}),
            local_id: None,
            local_updated_at: None,
        }];
        let outcome = apply_remote_changes(&conn, &entities).expect("apply");
        assert_eq!(outcome.applied, 1);
        assert_eq!(outcome.failed, 0);
    }

    // -----------------------------------------------------------------------
    // #6 — last-write-wins preserves newer un-pushed local edits
    // -----------------------------------------------------------------------

    #[test]
    fn apply_remote_changes_skips_when_local_is_newer() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO clients (id, remote_id, name, created_at, updated_at) VALUES ('c1', 'r1', 'Local Newer', '2026-01-01T00:00:00Z', '2026-09-09T00:00:00Z')",
            [],
        )
        .unwrap();

        let entities = vec![SyncEntity {
            entity_type: "client".to_string(),
            action: "update".to_string(),
            data: serde_json::json!({
                "id": "r1",
                "name": "Server Older",
                "isArchived": false,
                "updatedAt": "2026-02-02T00:00:00Z",
            }),
            local_id: None,
            local_updated_at: None,
        }];
        apply_remote_changes(&conn, &entities).expect("apply");

        let name: String = conn
            .query_row("SELECT name FROM clients WHERE id = 'c1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            name, "Local Newer",
            "newer un-pushed local edit must be preserved"
        );
    }

    #[test]
    fn apply_remote_changes_applies_when_remote_is_newer_and_preserves_timestamp() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO clients (id, remote_id, name, created_at, updated_at) VALUES ('c1', 'r1', 'Local Older', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        let entities = vec![SyncEntity {
            entity_type: "client".to_string(),
            action: "update".to_string(),
            data: serde_json::json!({
                "id": "r1",
                "name": "Server Newer",
                "isArchived": false,
                "updatedAt": "2026-08-08T00:00:00Z",
            }),
            local_id: None,
            local_updated_at: None,
        }];
        apply_remote_changes(&conn, &entities).expect("apply");

        let (name, updated): (String, String) = conn
            .query_row(
                "SELECT name, updated_at FROM clients WHERE id = 'c1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "Server Newer");
        assert_eq!(
            updated, "2026-08-08T00:00:00Z",
            "server's updated_at must be preserved, not now()"
        );
    }

    // -----------------------------------------------------------------------
    // #7 — FK resolution writes NULL (not remote id) when parent missing,
    //      and re-resolves on a second pass once the parent arrives.
    // -----------------------------------------------------------------------

    #[test]
    fn apply_klippekort_writes_null_client_when_parent_missing() {
        let conn = setup_db();
        // klippekort references a client remote id that does NOT exist locally yet.
        let entities = vec![SyncEntity {
            entity_type: "klippekort".to_string(),
            action: "create".to_string(),
            data: serde_json::json!({
                "id": "kr1",
                "clientId": "missing-remote-client",
                "name": "Prepaid",
                "totalHours": 10.0,
                "usedHours": 0.0,
                "status": "active",
                "updatedAt": "2026-01-01T00:00:00Z",
            }),
            local_id: None,
            local_updated_at: None,
        }];
        apply_remote_changes(&conn, &entities).expect("apply");

        let client_id: Option<String> = conn
            .query_row(
                "SELECT client_id FROM klippekort WHERE remote_id = 'kr1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            client_id, None,
            "unresolved FK must be NULL, never the raw remote id"
        );
    }

    #[test]
    fn apply_klippekort_relinks_client_on_second_pass() {
        let conn = setup_db();

        // First pass: child before parent → NULL FK.
        let kk = SyncEntity {
            entity_type: "klippekort".to_string(),
            action: "create".to_string(),
            data: serde_json::json!({
                "id": "kr1",
                "clientId": "rc1",
                "name": "Prepaid",
                "totalHours": 10.0,
                "usedHours": 0.0,
                "status": "active",
                "updatedAt": "2026-01-01T00:00:00Z",
            }),
            local_id: None,
            local_updated_at: None,
        };
        apply_remote_changes(&conn, std::slice::from_ref(&kk)).expect("apply child");

        // Parent client arrives.
        let client = SyncEntity {
            entity_type: "client".to_string(),
            action: "create".to_string(),
            data: serde_json::json!({"id": "rc1", "name": "Acme", "isArchived": false}),
            local_id: None,
            local_updated_at: None,
        };
        apply_remote_changes(&conn, &[client]).expect("apply parent");

        // Second pass of the (unchanged) child re-resolves the FK (tie → applies).
        apply_remote_changes(&conn, &[kk]).expect("re-apply child");

        let client_id: Option<String> = conn
            .query_row(
                "SELECT client_id FROM klippekort WHERE remote_id = 'kr1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let local_client: String = conn
            .query_row("SELECT id FROM clients WHERE remote_id = 'rc1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            client_id.as_deref(),
            Some(local_client.as_str()),
            "FK relinked to local client id on second pass"
        );
    }

    // -----------------------------------------------------------------------
    // save_last_sync / get_last_sync
    // -----------------------------------------------------------------------

    #[test]
    fn save_and_get_last_sync() {
        let conn = setup_db();

        assert!(get_last_sync(&conn).is_none(), "no sync yet");

        save_last_sync(&conn, "2026-01-15T10:00:00Z").expect("save");
        assert_eq!(get_last_sync(&conn).as_deref(), Some("2026-01-15T10:00:00Z"));

        save_last_sync(&conn, "2026-01-16T12:00:00Z").expect("save update");
        assert_eq!(get_last_sync(&conn).as_deref(), Some("2026-01-16T12:00:00Z"));
    }

    // -----------------------------------------------------------------------
    // log_sync_change
    // -----------------------------------------------------------------------

    #[test]
    fn log_sync_change_creates_entry() {
        let conn = setup_db();
        log_sync_change(&conn, "client", "c1", "create");

        let (entity_type, entity_id, action, synced): (String, String, String, i32) = conn
            .query_row(
                "SELECT entity_type, entity_id, action, synced FROM sync_log WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("query sync_log");

        assert_eq!(entity_type, "client");
        assert_eq!(entity_id, "c1");
        assert_eq!(action, "create");
        assert_eq!(synced, 0);
    }

    #[test]
    fn commit_push_result_empty_is_ok() {
        let conn = setup_db();
        assert!(commit_push_result(&conn, &[], &[]).is_ok());
    }

    #[test]
    fn commit_push_result_commits_all_accepted() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_client(&conn, "c2", "Globex");
        log_sync_change(&conn, "client", "c1", "create");
        log_sync_change(&conn, "client", "c2", "create");
        let ids = collected_ids(&conn);

        let accepted = vec![
            AcceptedEntity {
                local_id: "c1".to_string(),
                remote_id: "r-1".to_string(),
                entity_type: "client".to_string(),
            },
            AcceptedEntity {
                local_id: "c2".to_string(),
                remote_id: "r-2".to_string(),
                entity_type: "client".to_string(),
            },
        ];
        commit_push_result(&conn, &accepted, &ids).expect("commit");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clients WHERE remote_id IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(count, 2);
    }

    /// En database hvor skrivningen af e-mail F.EJLER, mens navnet kan gemmes,
    /// saa transaktionen fejler MIDT i profil-syncen. Det er det eneste sted,
    /// hvor den gamle kode efterlod en halv gemt profil: den slog fejlen til,
    /// skrev `profile_synced_from_cloud = true` og lod appen tro den var
    /// opdateret.
    ///
    /// CHECK'en afviser værdier paa 10 tegn eller mere. "Mads" (4) kan gemmes,
    /// "ny@mail.dk" (10) kan ikke.
    fn db_der_fejler_midt_i_profilen() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE TABLE settings (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL CHECK (length(value) < 10)
             );
             INSERT INTO settings (key, value) VALUES ('user_email', 'gammel');",
        )
        .expect("opret settings med CHECK");
        conn
    }

    fn profil(navn: &str) -> serde_json::Value {
        serde_json::json!({ "name": navn, "email": "ny@mail.dk" })
    }

    fn setting(conn: &Connection, key: &str) -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .ok()
    }

    #[test]
    fn profil_sync_gemmer_navn_email_og_markering() {
        let conn = setup_db();

        save_user_profile(&conn, &profil("Mads")).expect("profilen skal gemmes");

        assert_eq!(setting(&conn, "user_name").as_deref(), Some("Mads"));
        assert_eq!(setting(&conn, "user_email").as_deref(), Some("ny@mail.dk"));
        assert_eq!(
            setting(&conn, "profile_synced_from_cloud").as_deref(),
            Some("true"),
            "uden markeringen prøver synken aldrig igen"
        );
    }

    #[test]
    fn profil_sync_der_fejler_ruller_alle_felter_tilbage() {
        // "Mads" gemmes, "ny@mail.dk" fejler. Den gamle kode slog fejlen til og
        // skrev alligevel markeringen, saa profilen hang med et nyt navn, en
        // gammel e-mail og en markering der sagde "alt er godt".
        let conn = db_der_fejler_midt_i_profilen();

        let fejl = save_user_profile(&conn, &profil("Mads"))
            .expect_err("en fejlet skrivning må ikke svare Ok");

        assert!(
            fejl.contains("user_email"),
            "fejlen skal sige HVAD der gik galt: {fejl}"
        );
        assert_eq!(
            setting(&conn, "user_name"),
            None,
            "navnet blev skrevet i den gamle kode — transaktionen skal rulle det tilbage"
        );
        assert_eq!(
            setting(&conn, "user_email").as_deref(),
            Some("gammel"),
            "brugerens gamle e-mail må ikke være overskrevet"
        );
        assert_eq!(
            setting(&conn, "profile_synced_from_cloud"),
            None,
            "en halv gemt profil må ikke markeres som synkroniseret"
        );
    }

    // -----------------------------------------------------------------------
    // hours + date: the two fields the server cannot store a registration
    // without. Without them every push is rejected (both are NOT NULL), so no
    // time ever reaches timetrack.dk.
    // -----------------------------------------------------------------------

    fn insert_entry(conn: &Connection, id: &str, start_time: &str, duration: Option<i64>) {
        conn.execute(
            "INSERT INTO time_entries (id, start_time, duration, created_at, updated_at)
             VALUES (?1, ?2, ?3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![id, start_time, duration],
        )
        .expect("insert time entry");
        log_sync_change(conn, "time_entry", id, "create");
    }

    fn entry_of(conn: &Connection, id: &str) -> (String, Option<String>, Option<i64>) {
        conn.query_row(
            "SELECT start_time, end_time, duration FROM time_entries WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("læs time entry")
    }

    #[test]
    fn push_sender_timetal_og_dato_til_serveren() {
        let conn = setup_db();
        // Med eksplicit offset: 09:00 dansk tid er 08:00Z.
        insert_entry(&conn, "t1", "2026-01-01T09:00:00+01:00", Some(5400));

        let data = payload_for(&conn, "time_entry", "t1");
        assert_eq!(
            data["hours"].as_f64(),
            Some(1.5),
            "serveren har ingen duration-kolonne og kræver hours"
        );
        assert_eq!(
            data["date"].as_str(),
            Some("2026-01-01T08:00:00Z"),
            "date er NOT NULL og skal være det øjeblik registreringen startede"
        );
        assert_eq!(data["startTime"].as_str(), Some("2026-01-01T08:00:00Z"));
    }

    #[test]
    fn push_runder_timetalet_til_serverens_to_decimaler() {
        let conn = setup_db();
        // 3661 sekunder er 1,0172 time; serveren gemmer to decimaler (5,2).
        insert_entry(&conn, "t1", "2026-01-01T09:00:00Z", Some(3661));

        let data = payload_for(&conn, "time_entry", "t1");
        assert_eq!(data["hours"].as_f64(), Some(1.02));
    }

    #[test]
    fn push_udleder_timetal_af_start_og_slut_naar_varigheden_mangler() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO time_entries (id, start_time, end_time, created_at, updated_at)
             VALUES ('t1', '2026-01-01T09:00:00Z', '2026-01-01T11:30:00Z',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("insert time entry");
        log_sync_change(&conn, "time_entry", "t1", "create");

        let data = payload_for(&conn, "time_entry", "t1");
        assert_eq!(data["hours"].as_f64(), Some(2.5));
        assert_eq!(data["endTime"].as_str(), Some("2026-01-01T11:30:00Z"));
    }

    #[test]
    fn push_laser_en_start_uden_offset_som_den_lokale_vaerdi_brugeren_tastede() {
        // Formularen bygger `${date}T${time}:00` — et lokalt ur, ingen offset.
        let conn = setup_db();
        insert_entry(&conn, "t1", "2026-06-01T09:00:00", Some(3600));

        let data = payload_for(&conn, "time_entry", "t1");
        let forventet = chrono::NaiveDate::from_ymd_opt(2026, 6, 1)
            .and_then(|d| d.and_hms_opt(9, 0, 0))
            .and_then(|naive| naive.and_local_timezone(chrono::Local).earliest())
            .expect("lokal tid")
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        assert_eq!(
            data["date"].as_str(),
            Some(forventet.as_str()),
            "serveren læser et timestamp-tal som UTC, så et lokalt ur skal sendes som øjeblik"
        );
        assert_eq!(data["startTime"].as_str(), Some(forventet.as_str()));
        assert_eq!(data["hours"].as_f64(), Some(1.0));
    }

    // -----------------------------------------------------------------------
    // Pull: en registrering lavet i webappen har ingen startTime/endTime,
    // kun date + hours.
    // -----------------------------------------------------------------------

    /// Et svar fra serveren for en registrering lavet i webappen.
    fn web_entry() -> serde_json::Value {
        serde_json::json!({
            "id": "srv-t1",
            "projectId": serde_json::Value::Null,
            "clientId": serde_json::Value::Null,
            "description": "Kundemøde",
            "hours": "1.50",
            "date": "2026-01-01T08:00:00.000Z",
            "createdAt": "2026-01-01T07:00:00.000Z",
            "updatedAt": "2026-01-01T07:00:00.000Z",
        })
    }

    #[test]
    fn pull_giver_en_webregistrering_kloketid_og_varighed() {
        let conn = setup_db();
        apply_time_entry(&conn, &web_entry(), "create").expect("apply");

        let (start, end, duration) = entry_of(&conn, &entry_id(&conn, "srv-t1"));
        // Lokal væg-tid, ikke et UTC-øjeblik: `time_entries` læses som tekst og
        // med `DATE()`, så et UTC-øjeblik ville bogføre en registrering fra
        // serveren på dagen før, hvis den lå mellem midnat og kl. 02:00 dansk.
        // Forventningen regnes fra serverens egen værdi, så testen holder i
        // enhver tidszone.
        assert_eq!(
            start,
            lokal_naiv("2026-01-01T08:00:00Z").expect("læselig"),
            "en tom start_time rammer ingen rapportperiode og ingen kalenderdag"
        );
        assert_eq!(duration, Some(5400), "hours er en decimal-streng, ikke et tal");
        assert_eq!(
            end.as_deref(),
            lokal_naiv("2026-01-01T09:30:00Z").as_deref()
        );
    }

    #[test]
    fn pull_gaar_tabt_hvis_serveren_kender_ingen_varighed() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO time_entries (id, remote_id, start_time, duration, created_at, updated_at)
             VALUES ('l1', 'srv-t1', '2026-01-01T08:00:00Z', 5400,
                     '2026-01-01T06:00:00Z', '2026-01-01T06:00:00Z')",
            [],
        )
        .expect("insert time entry");
        apply_time_entry(&conn, &web_entry(), "update").expect("apply");

        let (_, _, duration) = entry_of(&conn, "l1");
        assert_eq!(
            duration,
            Some(5400),
            "en kørsel der siger intet om varighed må ikke nulstille den"
        );
    }

    #[test]
    fn pull_beholder_serverens_varighed_naar_den_kender_den() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO time_entries (id, remote_id, start_time, duration, created_at, updated_at)
             VALUES ('l1', 'srv-t1', '2026-01-01T08:00:00Z', 5400,
                     '2026-01-01T06:00:00Z', '2026-01-01T06:00:00Z')",
            [],
        )
        .expect("insert time entry");
        let mut data = web_entry();
        data["hours"] = serde_json::json!("3.00");
        apply_time_entry(&conn, &data, "update").expect("apply");

        let (_, _, duration) = entry_of(&conn, "l1");
        assert_eq!(duration, Some(10800));
    }

    #[test]
    fn pull_tager_serverens_kloketid_naar_den_findes() {
        let conn = setup_db();
        let mut data = web_entry();
        data["startTime"] = serde_json::json!("2026-01-01T10:15:00.000Z");
        data["endTime"] = serde_json::json!("2026-01-01T11:45:00.000Z");
        apply_time_entry(&conn, &data, "create").expect("apply");

        let (start, end, _) = entry_of(&conn, &entry_id(&conn, "srv-t1"));
        assert_eq!(start, lokal_naiv("2026-01-01T10:15:00Z").expect("læselig"));
        assert_eq!(
            end.as_deref(),
            lokal_naiv("2026-01-01T11:45:00Z").as_deref()
        );
    }

    #[test]
    fn pull_foerer_klippekortet_med_paa_en_webregistrering() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "INSERT INTO klippekort (id, remote_id, client_id, name, total_hours, used_hours, status, created_at, updated_at)
             VALUES ('k1', 'srv-k1', 'c1', 'Paket', 10.0, 1.5, 'active', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert klippekort");
        let mut data = web_entry();
        // Serverens kolonne hedder `prepaidPackageId` — en payload fra serveren
        // kan aldrig have `klippekortId`.
        data["prepaidPackageId"] = serde_json::json!("srv-k1");
        apply_time_entry(&conn, &data, "create").expect("apply");

        let klippekort_id: Option<String> = conn
            .query_row(
                "SELECT klippekort_id FROM time_entries WHERE remote_id = 'srv-t1'",
                [],
                |row| row.get(0),
            )
            .expect("query klippekort_id");
        assert_eq!(
            klippekort_id.as_deref(),
            Some("k1"),
            "en post der er trukket på et klippekort skal beholde pakken lokalt, ellers \
             ser saldoen brugt ud mens posten ikke ved, hvad den er trukket på"
        );
    }

    #[test]
    fn pull_goder_det_gamle_klippekort_id_naa_det_kommer() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "INSERT INTO klippekort (id, remote_id, client_id, name, total_hours, used_hours, status, created_at, updated_at)
             VALUES ('k1', 'srv-k1', 'c1', 'Paket', 10.0, 1.5, 'active', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert klippekort");
        let mut data = web_entry();
        data["klippekortId"] = serde_json::json!("srv-k1");
        apply_time_entry(&conn, &data, "create").expect("apply");

        let klippekort_id: Option<String> = conn
            .query_row(
                "SELECT klippekort_id FROM time_entries WHERE remote_id = 'srv-t1'",
                [],
                |row| row.get(0),
            )
            .expect("query klippekort_id");
        assert_eq!(klippekort_id.as_deref(), Some("k1"));
    }

    #[test]
    fn push_og_pull_beholder_den_samme_registrering() {
        // Hele vejen rundt: en lokal registrering sendes op og kommer tilbage.
        // Dobbelt så meget tid i synk må ikke ændre den på vej.
        let conn = setup_db();
        insert_entry(&conn, "t1", "2026-01-01T09:00:00Z", Some(5400));
        let data = payload_for(&conn, "time_entry", "t1");

        let server_svar = serde_json::json!({
            "id": data["id"],
            "projectId": data["projectId"],
            "clientId": data["clientId"],
            "description": data["description"],
            // Serveren kender kun det den fik sendt, og den fik startTime med.
            "startTime": data["startTime"],
            "hours": "1.50",
            "date": data["date"],
            "updatedAt": data["updatedAt"],
        });
        apply_time_entry(&conn, &server_svar, "create").expect("apply");

        let (start, _, duration) = entry_of(&conn, &entry_id(&conn, "t1"));
        // Runden rundt må ikke ændre registreringen — men den SKAL ændre formen:
        // op ad sendes der et UTC-øjeblik (serverens `timestamp`-kolonne læses
        // som UTC, målt i D2b), og ned gemmes den som lokal væg-tid, fordi det er
        // den form alle læsere i `time_entries` regner med. Døm derfor på
        // ØJEBLIKKET, ikke på strengen: det er det, der ikke må flytte sig.
        assert_eq!(
            crate::tid::øjeblik(&start),
            crate::tid::øjeblik("2026-01-01T09:00:00Z"),
            "en runde gennem synken må ikke flytte registreringen i tid"
        );
        assert!(
            !start.contains('+') && !start.ends_with('Z'),
            "ned i databasen skal den stå som lokal væg-tid, ellers bogføres den \
             på dagen før, når den ligger mellem midnat og kl. 02:00: {start}"
        );
        assert_eq!(duration, Some(5400));
    }

    // -----------------------------------------------------------------------
    // D2d — kontrakt mod webens faktiske schema
    //
    // Serverens insert læser kun de kolonner, tabellen selv har (drizzle går
    // kolonnerne igennem og slår payloadens nøgler op i dem), så et felt
    // serveren ikke kender forsvinder i stilhed — ingen fejl, ingen effekt.
    // Omvendt kommer en `decimal`-kolonne tilbage som en **streng** ("10.00"),
    // så den skal læses som streng. De to fejl er samme familie, og de rammer
    // præcis de felter der afgør hvad der faktureres: kundens sats, CVR,
    // klippekortets saldo og timebudgettet på et projekt.
    //
    // Kolonnerne er læst i timetrack-web/src/lib/db/schema.ts:
    // clients :279-333 · projects :362-407 · prepaid_packages :410-482 ·
    // time_entries :635-700. Endrer weben et navn, skal denne liste følge med.
    // -----------------------------------------------------------------------

    /// Serverens egne kolonner for de felter vi sender pr. entitet.
    const SERVER_KENDER: &[(&str, &[&str])] = &[
        ("client", &[
            "id", "name", "email", "phone", "company", "cvrNumber", "defaultHourlyRate",
            "notes", "isArchived", "createdAt", "updatedAt",
        ]),
        ("project", &[
            "id", "clientId", "name", "hourlyRate", "budgetHours", "isArchived",
            "createdAt", "updatedAt",
        ]),
        ("time_entry", &[
            "id", "projectId", "clientId", "prepaidPackageId", "description",
            "startTime", "endTime", "hours", "date", "isBillable", "source",
            "createdAt", "updatedAt", "clientEntryId",
        ]),
        ("klippekort", &[
            "id", "clientId", "name", "totalHours", "usedHours", "hourlyRate",
            "expiryDate", "purchaseDate", "createdAt", "updatedAt",
        ]),
    ];

    /// Felter der er bevidst lokale: serveren kender dem ikke og tager dem heller
    /// ikke imod. Uden denne liste så de bare ud som fejl.
    const LOKALE_FELTER: &[(&str, &str, &str)] = &[
        ("client", "remoteId", "vores eget id-lag; serveren svarer på 'id'"),
        ("project", "remoteId", "som for klienten"),
        ("time_entry", "remoteId", "som for klienten"),
        ("time_entry", "duration", "serveren har ingen duration-kolonne — den bruger hours"),
        ("time_entry", "isRunning", "løbende timere springes over i collect_pending_changes"),
        ("time_entry", "klippekortId", "vores navn; serverens er prepaidPackageId"),
        ("klippekort", "remoteId", "som for klienten"),
        ("klippekort", "projectId", "prepaid_packages har ingen projektkolonne"),
    ];

    #[test]
    fn push_sender_kun_felter_serverens_schema_kender() {
        // Porten fra D2d: et felt, der ikke står i serverens tabel, bliver
        // kastet væk uden en eneste fejl. Den her test er det sted, hvor det
        // opdages — og hvor den næste synkfejl skulle være fundet.
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "UPDATE clients SET cvr = '12345678', hourly_rate = 950.0 WHERE id = 'c1'",
            [],
        )
        .expect("sæt felter");
        insert_project(&conn, "p1", "Nyt website", Some("c1"));
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, hourly_rate, expires_at, created_at, updated_at)
             VALUES ('k1', 'c1', 'Paket', 10.0, 1.5, 900.0, '2026-12-31', '2026-01-02 09:30:00', '2026-01-02 09:30:00')",
            [],
        )
        .expect("insert klippekort");
        insert_entry(&conn, "t1", "2026-01-01T09:00:00Z", Some(3600));
        log_sync_change(&conn, "client", "c1", "create");
        log_sync_change(&conn, "project", "p1", "create");
        log_sync_change(&conn, "klippekort", "k1", "create");

        let changes = collect_pending_changes(&conn);
        let mut set = std::collections::HashSet::new();
        for entity in &changes.entities {
            assert!(
                set.insert(entity.entity_type.clone()),
                "alle fire entitetstyper skal sendes én gang hver — `{}` kommer to gange",
                entity.entity_type
            );
            let kendte = SERVER_KENDER
                .iter()
                .find(|(t, _)| *t == entity.entity_type)
                .map(|(_, felter)| *felter)
                .unwrap_or_else(|| panic!("ukendt entitet {}", entity.entity_type));
            let data = entity.data.as_object().expect("payload er et objekt");
            for felt in data.keys() {
                let kendt = kendte.contains(&felt.as_str())
                    || LOKALE_FELTER
                        .iter()
                        .any(|(t, f, _)| *t == entity.entity_type && *f == felt.as_str());
                assert!(
                    kendt,
                    "{}: serveren kender ikke feltet `{}` — det bliver kastet væk i \
                     stilhed, så rettelsen hører hjemme i entiteten eller i listen",
                    entity.entity_type, felt
                );
            }
        }
    }

    #[test]
    fn push_sender_kundens_sats_og_cvr_under_serverens_navne() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "UPDATE clients SET cvr = '12345678', hourly_rate = 950.0 WHERE id = 'c1'",
            [],
        )
        .expect("sæt felter");
        log_sync_change(&conn, "client", "c1", "update");

        let data = payload_for(&conn, "client", "c1");
        assert_eq!(
            data["defaultHourlyRate"].as_f64(),
            Some(950.0),
            "serverens kolonne hedder default_hourly_rate; `hourlyRate` er ukendt \
             og blev kastet væk, så kundens sats nåede aldrig timetrack.dk"
        );
        assert_eq!(data["cvrNumber"].as_str(), Some("12345678"));
    }

    #[test]
    fn push_sender_projektets_estimate_som_budget_hours() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "p1", "Nyt website", Some("c1"));
        conn.execute("UPDATE projects SET estimated_hours = 12.5 WHERE id = 'p1'", [])
            .expect("sæt estimat");
        log_sync_change(&conn, "project", "p1", "update");

        let data = payload_for(&conn, "project", "p1");
        assert_eq!(
            data["budgetHours"].as_f64(),
            Some(12.5),
            "webens projekttabel kalder timebudgettet budget_hours — uden det \
             bliver advarslen ved timeoverskridelse sat i webappen, og ikke her"
        );
    }

    #[test]
    fn push_sender_koebsdato_til_klippekortet() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, hourly_rate, expires_at, created_at, updated_at)
             VALUES ('k1', 'c1', 'Paket', 10.0, 0.0, 900.0, '2026-12-31', '2026-01-02 09:30:00', '2026-01-02 09:30:00')",
            [],
        )
        .expect("insert klippekort");
        log_sync_change(&conn, "klippekort", "k1", "create");

        let data = payload_for(&conn, "klippekort", "k1");
        assert_eq!(
            data["purchaseDate"].as_str(),
            Some("2026-01-02T09:30:00Z"),
            "purchase_date er NOT NULL uden default: uden feltet afvises HVERT \
             klippekort-push, og afvisningen forsvinder i push-svaret, så kortet \
             aldrig når timetrack.dk mens køen prøver igen for evigt"
        );
        assert_eq!(
            data["expiryDate"].as_str(),
            Some("2026-12-31T00:00:00Z"),
            "et nøgent dato-timestamp ville blive læst som UTC og lande dagen før"
        );
    }

    /// Et svar fra serveren for en kunde — samme form som webens pull giver.
    fn server_client() -> serde_json::Value {
        serde_json::json!({
            "id": "srv-c1",
            "name": "Acme",
            "cvrNumber": "12345678",
            // Serverens decimals kommer som strenge, ikke som tal.
            "defaultHourlyRate": "950.00",
            "notes": serde_json::Value::Null,
            "email": serde_json::Value::Null,
            "phone": serde_json::Value::Null,
            "company": serde_json::Value::Null,
            "isArchived": false,
            "createdAt": "2026-01-01T07:00:00.000Z",
            "updatedAt": "2026-01-01T07:00:00.000Z",
        })
    }

    #[test]
    fn pull_beholder_kundens_sats_og_cvr_nummer() {
        let conn = setup_db();
        insert_client(&conn, "l1", "Acme");
        conn.execute(
            "UPDATE clients SET remote_id = 'srv-c1', cvr = NULL, hourly_rate = NULL,
                    updated_at = '2026-01-01T06:00:00Z' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal række klar");
        apply_client(&conn, &server_client(), "update").expect("apply");

        let (cvr, sats): (Option<String>, Option<f64>) = conn
            .query_row(
                "SELECT cvr, hourly_rate FROM clients WHERE remote_id = 'srv-c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("læs kunde");
        assert_eq!(cvr.as_deref(), Some("12345678"));
        assert_eq!(
            sats,
            Some(950.0),
            "decimal-kolonner kommer som strenge (\"950.00\"); læst som tal bliver \
             den None, og kundens sats nulstilles ved hvert sync"
        );
    }

    #[test]
    fn pull_beholder_kunden_sats_naar_serveren_ikke_kender_den() {
        let conn = setup_db();
        insert_client(&conn, "l1", "Acme");
        conn.execute(
            "UPDATE clients SET remote_id = 'srv-c1', hourly_rate = 1200.0,
                    updated_at = '2026-01-01T06:00:00Z' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal række klar");
        let mut data = server_client();
        data.as_object_mut().unwrap().remove("defaultHourlyRate");
        apply_client(&conn, &data, "update").expect("apply");

        let sats: Option<f64> = conn
            .query_row(
                "SELECT hourly_rate FROM clients WHERE remote_id = 'srv-c1'",
                [],
                |row| row.get(0),
            )
            .expect("læs kunde");
        assert_eq!(sats, Some(1200.0));
    }

    /// Et svar fra serveren for et projekt — samme form som webens pull giver.
    fn server_project(ekstra: serde_json::Value) -> serde_json::Value {
        let mut data = serde_json::json!({
            "id": "srv-p1",
            "clientId": serde_json::Value::Null,
            "name": "Nyt website",
            "hourlyRate": "850.00",
            "isArchived": false,
            "createdAt": "2026-01-01T07:00:00.000Z",
            "updatedAt": "2026-01-01T07:00:00.000Z",
        });
        for (felt, værdi) in ekstra.as_object().unwrap() {
            data[felt] = værdi.clone();
        }
        data
    }

    #[test]
    fn pull_tager_projektets_timebudget_fra_webappen() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "l1", "Nyt website", Some("c1"));
        conn.execute(
            "UPDATE projects SET remote_id = 'srv-p1', updated_at = '2026-01-01T06:00:00Z' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal række klar");
        apply_project(
            &conn,
            &server_project(serde_json::json!({ "budgetHours": "12.50" })),
            "update",
        )
        .expect("apply");

        let (estimat, sats): (Option<f64>, Option<f64>) = conn
            .query_row(
                "SELECT estimated_hours, hourly_rate FROM projects WHERE remote_id = 'srv-p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("læs projekt");
        assert_eq!(estimat, Some(12.5), "budget_hours er vores estimated_hours");
        assert_eq!(sats, Some(850.0), "også projektets egen sats er en decimal-streng");
    }

    #[test]
    fn pull_slaetter_ikke_projektets_farve() {
        // Webens projekttabel har ingen farvekolonne, så svaret har ikke feltet.
        // Før var skrivningen ligelig, og hvert sync nulstillede den farve
        // brugeren selv havde sat — projektets chip i tidslinjen forsvandt.
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "l1", "Nyt website", Some("c1"));
        conn.execute(
            "UPDATE projects SET remote_id = 'srv-p1', color = '#ff8800',
                    updated_at = '2026-01-01T06:00:00Z' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal række klar");
        apply_project(&conn, &server_project(serde_json::json!({})), "update").expect("apply");

        let farve: Option<String> = conn
            .query_row(
                "SELECT color FROM projects WHERE remote_id = 'srv-p1'",
                [],
                |row| row.get(0),
            )
            .expect("læs projekt");
        assert_eq!(farve.as_deref(), Some("#ff8800"));
    }

    /// Et svar fra serveren for et klippekort — alle tal kommer som strenge.
    fn server_klippekort() -> serde_json::Value {
        serde_json::json!({
            "id": "srv-k1",
            "clientId": "srv-c1",
            "name": "Paket",
            "totalHours": "10.00",
            "usedHours": "1.50",
            "hourlyRate": "900.00",
            "remainingHours": "8.50",
            "purchaseDate": "2026-01-02T09:30:00.000Z",
            "expiryDate": "2026-12-31T22:59:59.000Z",
            "isActive": true,
            "isArchived": false,
            "createdAt": "2026-01-02T09:30:00.000Z",
            "updatedAt": "2026-01-03T09:30:00.000Z",
        })
    }

    type Klippekort = (f64, f64, Option<f64>, Option<String>, String);

    fn klippekort_of(conn: &Connection) -> Klippekort {
        conn.query_row(
            "SELECT total_hours, used_hours, hourly_rate, expires_at, status
             FROM klippekort WHERE remote_id = 'srv-k1'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .expect("læs klippekort")
    }

    fn fjern(data: &mut serde_json::Value, felter: &[&str]) {
        let obj = data.as_object_mut().expect("objekt");
        for felt in felter {
            obj.remove(*felt);
        }
    }

    #[test]
    fn pull_beholder_klippekortets_saldo_og_pris() {
        let conn = setup_db();
        insert_client(&conn, "l1", "Acme");
        conn.execute(
            "UPDATE clients SET remote_id = 'srv-c1', updated_at = '2026-01-01T06:00:00Z' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal kunde klar");
        apply_klippekort(&conn, &server_klippekort(), "create").expect("apply");

        let (total, brugt, sats, udloeb, status) = klippekort_of(&conn);
        assert_eq!(
            (total, brugt),
            (10.0, 1.5),
            "total_hours og used_hours er decimals og kommer som strenge — læst \
             som tal blev de 0, så en forudbetalt saldo så ud brugt op"
        );
        assert_eq!(sats, Some(900.0));
        assert_eq!(udloeb.as_deref(), Some("2026-12-31"));
        assert_eq!(status, "active");
    }

    #[test]
    fn pull_beholder_den_lokale_saldo_naar_serveren_siger_intet() {
        let conn = setup_db();
        insert_client(&conn, "l1", "Acme");
        conn.execute(
            "UPDATE clients SET remote_id = 'srv-c1', updated_at = '2026-01-01T06:00:00Z' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal kunde klar");
        conn.execute(
            "INSERT INTO klippekort (id, remote_id, client_id, name, total_hours, used_hours, updated_at)
             VALUES ('l1', 'srv-k1', 'l1', 'Paket', 20.0, 4.0, '2026-01-01T06:00:00Z')",
            [],
        )
        .expect("insert klippekort");
        let mut data = server_klippekort();
        fjern(&mut data, &["totalHours", "usedHours", "hourlyRate"]);
        apply_klippekort(&conn, &data, "update").expect("apply");

        let (total, brugt, _, _, _) = klippekort_of(&conn);
        assert_eq!(
            (total, brugt),
            (20.0, 4.0),
            "en kørsel der tier om saldoen må ikke nulstille den"
        );
    }

    #[test]
    fn pull_goer_kortet_inaktivt_naar_serveren_har_det() {
        let conn = setup_db();
        insert_client(&conn, "l1", "Acme");
        conn.execute(
            "UPDATE clients SET remote_id = 'srv-c1', updated_at = '2026-01-01T06:00:00Z' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal kunde klar");
        let mut data = server_klippekort();
        data["isActive"] = serde_json::json!(false);
        apply_klippekort(&conn, &data, "create").expect("apply");

        let (_, _, _, _, status) = klippekort_of(&conn);
        assert_eq!(status, "inactive", "webens is_active hedder status hos os");
    }

    // -----------------------------------------------------------------------
    // Kontrakten for de fire veje en ændring kan tage: update, delete,
    // konflikt og en kunde uden projekt.
    // -----------------------------------------------------------------------

    #[test]
    fn opdatering_rammer_serverens_raekke() {
        // Serverens handleUpdate slår rækken op på primær nøglen, så en update
        // uden serverens id ender som 'Entity not found'.
        let conn = setup_db();
        insert_client(&conn, "l1", "Acme");
        conn.execute(
            "UPDATE clients SET remote_id = 'srv-c1', updated_at = '2026-01-01 09:00:00' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal række klar");
        log_sync_change(&conn, "client", "l1", "update");

        let changes = collect_pending_changes(&conn);
        let entity = &changes.entities[0];
        assert_eq!(entity.action, "update");
        assert_eq!(entity.data["id"].as_str(), Some("srv-c1"));
        assert_eq!(
            entity.local_updated_at.as_deref(),
            Some("2026-01-01 09:00:00"),
            "serveren sammenligner updatedAt for at finde fremtidig konflikt — \
             serverens egen parsing af strengen skal give samme tidspunkt som \
             den vi sender"
        );
    }

    #[test]
    fn konflikt_paar_en_kunde_giver_serverens_sats_vinste() {
        // Serveren svarer 'Server version is newer' med sin egen række; vi
        // anvender den og rydder loggen, så den tabende rettelse ikke genforsøges.
        let conn = setup_db();
        insert_client(&conn, "l1", "Acme");
        conn.execute(
            "UPDATE clients SET remote_id = 'srv-c1', updated_at = '2026-01-01T06:00:00Z' WHERE id = 'l1'",
            [],
        )
        .expect("gør lokal række klar");
        conn.execute("UPDATE clients SET hourly_rate = 999.0 WHERE id = 'l1'", [])
            .expect("sæt lokal sats");
        log_sync_change(&conn, "client", "l1", "update");

        let changes = collect_pending_changes(&conn);
        let ids: Vec<i64> = changes.log_rows.iter().map(|(id, _, _)| *id).collect();
        let mut server_data = server_client();
        server_data["updatedAt"] = serde_json::json!("2026-06-01T07:00:00.000Z");
        let conflicts = vec![ConflictEntity {
            local_id: "l1".to_string(),
            entity_type: "client".to_string(),
            server_data,
        }];
        resolve_conflicts(&conn, &conflicts, &ids).expect("resolve");

        let (sats, ukørt): (Option<f64>, i64) = conn
            .query_row(
                "SELECT hourly_rate, (SELECT synced FROM sync_log WHERE entity_id = 'l1')
                 FROM clients WHERE remote_id = 'srv-c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("læs kunde");
        assert_eq!(sats, Some(950.0), "serveren vinder konflikt på pris");
        assert_eq!(ukørt, 1, "den tabende rettelse må ikke genforsøges for evigt");
    }

    #[test]
    fn sletning_af_en_kunde_arkiverer_lokalt_og_tager_serverens_id() {
        let conn = setup_db();
        insert_client(&conn, "l1", "Acme");
        conn.execute("UPDATE clients SET remote_id = 'srv-c1' WHERE id = 'l1'", [])
            .expect("gør lokal række klar");
        log_sync_change(&conn, "client", "l1", "delete");

        let changes = collect_pending_changes(&conn);
        assert_eq!(changes.entities[0].data["id"].as_str(), Some("srv-c1"));

        apply_client(&conn, &changes.entities[0].data, "delete").expect("arkiver");
        let arkiveret: i32 = conn
            .query_row(
                "SELECT is_archived FROM clients WHERE remote_id = 'srv-c1'",
                [],
                |row| row.get(0),
            )
            .expect("læs kunde");
        assert_eq!(arkiveret, 1, "archive over delete — serveren arkiverer også");
    }

    #[test]
    fn kunde_uden_projekt_gaar_igennem_synken_hele_vejen() {
        // D1 gjorde kunden til et mål i sig selv; her er kontrakten: en post med
        // kunde og intet projekt skal beholde kunden på begge veje, ellers
        // fakturerer den ingen kunde i webappen, og taber den her.
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        set_remote_id(&conn, "clients", "c1", "srv-c1");
        conn.execute(
            "INSERT INTO time_entries (id, client_id, start_time, duration, created_at, updated_at)
             VALUES ('t1', 'c1', '2026-01-01T09:00:00Z', 3600,
                     '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z')",
            [],
        )
        .expect("insert post");
        log_sync_change(&conn, "time_entry", "t1", "create");

        let data = payload_for(&conn, "time_entry", "t1");
        assert!(
            data["projectId"].is_null(),
            "serverens project_id er nullable, så kunden sendes uden et projekt"
        );

        let svar = serde_json::json!({
            "id": data["id"],
            "projectId": serde_json::Value::Null,
            // Serveren svarer med klientens UUID; den skal løses til den lokale.
            "clientId": "srv-c1",
            "description": data["description"],
            "hours": "1.00",
            "date": data["date"],
            "createdAt": "2026-01-01T08:00:00.000Z",
            "updatedAt": "2026-01-01T08:00:00.000Z",
        });
        apply_time_entry(&conn, &svar, "create").expect("apply");

        let kunde: Option<String> = conn
            .query_row(
                "SELECT client_id FROM time_entries WHERE remote_id = ?1",
                params![data["id"].as_str().unwrap_or_default()],
                |row| row.get(0),
            )
            .expect("læs post");
        assert_eq!(
            kunde.as_deref(),
            Some("c1"),
            "en kunde uden projekt skal stadig stå på posten — det er den, der \
             faktureres"
        );
    }

    fn entry_id(conn: &Connection, remote_id: &str) -> String {
        conn.query_row(
            "SELECT id FROM time_entries WHERE remote_id = ?1",
            params![remote_id],
            |row| row.get(0),
        )
        .expect("find entry by remote_id")
    }

    // -----------------------------------------------------------------------
    // local_updated_at — SQL'en må aldrig bygges af kalderens streng
    // -----------------------------------------------------------------------

    /// Finder det lokale tidsstempel for hver af de fire entitetstyper vi
    /// faktisk synker. Dømmer *hvidlisten*, ikke blot at query'en virker: en
    /// tabel der ikke står i listen skal give `None` og ikke en fejl, fordi det
    /// er netop det, der holder et fremtidigt tabelnavn ude af SQL'en.
    #[test]
    fn lokalt_tidspunkt_leser_de_fire_synkede_entitetstyper() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        insert_project(&conn, "p1", "Portal", Some("c1"));
        conn.execute(
            "INSERT INTO time_entries (id, description, start_time, duration, remote_id, updated_at)
             VALUES ('t1', 'Arbejde', '2026-01-01T09:00:00Z', 1800, 'srv-t1', '2026-01-01T09:00:00Z')",
            [],
        )
        .expect("insert time entry");
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, remote_id, updated_at)
             VALUES ('k1', 'c1', '10 timer', 10.0, 0.0, 'srv-k1', '2026-01-01T09:00:00Z')",
            [],
        )
        .expect("insert klippekort");
        conn.execute_batch(
            "UPDATE clients SET remote_id = 'srv-c1', updated_at = '2026-01-01T09:00:00Z' WHERE id = 'c1';
             UPDATE projects SET remote_id = 'srv-p1', updated_at = '2026-01-01T09:00:00Z' WHERE id = 'p1';",
        )
        .expect("sæt remote_id og tidsstempel");

        for (entitet, fjern_id) in [
            ("client", "srv-c1"),
            ("project", "srv-p1"),
            ("time_entry", "srv-t1"),
            ("klippekort", "srv-k1"),
        ] {
            assert_eq!(
                local_updated_at(&conn, entitet, fjern_id).as_deref(),
                Some("2026-01-01T09:00:00Z"),
                "{entitet} skal finde sit lokale tidsstempel"
            );
        }
    }

    /// Selve porten: et **tabelnavn** er ikke en entitetstype. Den gamle kode lagde
    /// kalderens streng direkte i `FROM {}`, så `"clients"` gav et tidsstempel,
    /// og alt hvad der kom indefra slap med i sætningen. Nu er hvidlisten det
    /// eneste vejen ind.
    #[test]
    fn lokalt_tidspunkt_afviser_et_tabelnavn_og_en_ukendt_type() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute(
            "UPDATE clients SET remote_id = 'srv-c1', updated_at = '2026-01-01T09:00:00Z' WHERE id = 'c1'",
            [],
        )
        .expect("sæt remote_id");

        assert_eq!(
            local_updated_at(&conn, "clients", "srv-c1"),
            None,
            "et tabelnavn er ikke en entitetstype — det skal ikke slå en query"
        );
        assert_eq!(local_updated_at(&conn, "opskrift", "srv-c1"), None);
    }

    /// Bevis for porten: en streng med SQL i den slipper ikke igennem, og
    /// tabellen er stadig der bagefter. SQLite ville kun have kørt første
    /// sætning i et flerstærks-kald, så «den fejlede» er ikke nok — derfor dømmes
    /// der på, at rækken stadig kan læses.
    #[test]
    fn en_injiceret_streng_i_entitetstypen_rorer_ikke_databasen() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Acme");
        conn.execute("UPDATE clients SET remote_id = 'srv-c1' WHERE id = 'c1'", [])
            .expect("sæt remote_id");

        assert_eq!(
            local_updated_at(&conn, "client'; DROP TABLE clients; --", "srv-c1"),
            None
        );
        let navn: String = conn
            .query_row("SELECT name FROM clients WHERE id = 'c1'", [], |r| {
                r.get(0)
            })
            .expect("kunden skal stadig være der");
        assert_eq!(navn, "Acme");
    }
}
