use crate::db::Database;
use crate::tracker::rules::{
    activity_matches_condition, rule_match_confidence, rule_match_reason, ActivitySignals,
    RuleEngine,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationRule {
    pub id: i64,
    pub name: String,
    pub priority: i32,
    pub condition_type: String,
    pub condition_op: String,
    pub condition_value: String,
    pub target_project_id: Option<String>,
    pub target_category: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRuleInput {
    pub name: String,
    pub priority: Option<i32>,
    pub condition_type: String,
    pub condition_op: String,
    pub condition_value: String,
    pub target_project_id: Option<String>,
    pub target_category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmedPattern {
    pub id: i64,
    pub app_name: Option<String>,
    pub window_title_pattern: Option<String>,
    pub url_pattern: Option<String>,
    pub project_id: Option<String>,
    /// Set when the pattern was learned for a customer WITHOUT a project —
    /// `project_id` is then NULL and this is the billable party.
    pub client_id: Option<String>,
    pub category: Option<String>,
    pub confirmation_count: i64,
    pub last_confirmed: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn row_to_rule(row: &rusqlite::Row) -> rusqlite::Result<ClassificationRule> {
    Ok(ClassificationRule {
        id: row.get(0)?,
        name: row.get(1)?,
        priority: row.get(2)?,
        condition_type: row.get(3)?,
        condition_op: row.get(4)?,
        condition_value: row.get(5)?,
        target_project_id: row.get(6)?,
        target_category: row.get(7)?,
        is_active: row.get::<_, i32>(8)? != 0,
        created_at: row.get(9)?,
    })
}

fn row_to_pattern(row: &rusqlite::Row) -> rusqlite::Result<ConfirmedPattern> {
    Ok(ConfirmedPattern {
        id: row.get(0)?,
        app_name: row.get(1)?,
        window_title_pattern: row.get(2)?,
        url_pattern: row.get(3)?,
        project_id: row.get(4)?,
        client_id: row.get(5)?,
        category: row.get(6)?,
        confirmation_count: row.get(7)?,
        last_confirmed: row.get(8)?,
    })
}

// ---------------------------------------------------------------------------
// Commands — Classification Rules CRUD
// ---------------------------------------------------------------------------

/// List all classification rules, ordered by priority descending.
#[tauri::command]
pub fn list_rules(db: State<'_, Database>) -> Result<Vec<ClassificationRule>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, name, priority, condition_type, condition_op, condition_value,
                    target_project_id, target_category, is_active, created_at
             FROM classification_rules
             ORDER BY priority DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_rule)
        .map_err(|e| e.to_string())?;

    let mut rules = Vec::new();
    for row in rows {
        rules.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rules)
}

/// Create a new classification rule.
#[tauri::command]
pub fn create_rule(
    db: State<'_, Database>,
    input: CreateRuleInput,
) -> Result<ClassificationRule, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let priority = input.priority.unwrap_or(0);

    conn.execute(
        "INSERT INTO classification_rules (name, priority, condition_type, condition_op, condition_value, target_project_id, target_category)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            input.name,
            priority,
            input.condition_type,
            input.condition_op,
            input.condition_value,
            input.target_project_id,
            input.target_category,
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    // Fetch the newly created rule
    conn.query_row(
        "SELECT id, name, priority, condition_type, condition_op, condition_value,
                target_project_id, target_category, is_active, created_at
         FROM classification_rules WHERE id = ?1",
        rusqlite::params![id],
        row_to_rule,
    )
    .map_err(|e| e.to_string())
}

/// Update an existing classification rule.
#[tauri::command]
pub fn update_rule(
    db: State<'_, Database>,
    rule: ClassificationRule,
) -> Result<ClassificationRule, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE classification_rules
         SET name = ?1, priority = ?2, condition_type = ?3, condition_op = ?4,
             condition_value = ?5, target_project_id = ?6, target_category = ?7,
             is_active = ?8
         WHERE id = ?9",
        rusqlite::params![
            rule.name,
            rule.priority,
            rule.condition_type,
            rule.condition_op,
            rule.condition_value,
            rule.target_project_id,
            rule.target_category,
            rule.is_active as i32,
            rule.id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Return the updated rule
    conn.query_row(
        "SELECT id, name, priority, condition_type, condition_op, condition_value,
                target_project_id, target_category, is_active, created_at
         FROM classification_rules WHERE id = ?1",
        rusqlite::params![rule.id],
        row_to_rule,
    )
    .map_err(|e| e.to_string())
}

/// Delete a classification rule by ID.
#[tauri::command]
pub fn delete_rule(db: State<'_, Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM classification_rules WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Commands — Confirmed Patterns
// ---------------------------------------------------------------------------

/// List all confirmed patterns, ordered by confirmation count descending.
#[tauri::command]
pub fn list_confirmed_patterns(
    db: State<'_, Database>,
) -> Result<Vec<ConfirmedPattern>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, app_name, window_title_pattern, url_pattern, project_id,
                    client_id, category, confirmation_count, last_confirmed
             FROM confirmed_patterns
             ORDER BY confirmation_count DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_pattern)
        .map_err(|e| e.to_string())?;

    let mut patterns = Vec::new();
    for row in rows {
        patterns.push(row.map_err(|e| e.to_string())?);
    }
    Ok(patterns)
}

/// Confirm that an activity belongs to a specific project — or, for a customer
/// with no project, to that customer alone.
///
/// Updates the activity row with the project/client, category, and is_confirmed
/// flag, then records the pattern for future automatic classification.
#[tauri::command]
pub fn confirm_classification(
    db: State<'_, Database>,
    activity_id: i64,
    project_id: Option<String>,
    client_id: Option<String>,
    category: Option<String>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    confirm_classification_core(&conn, activity_id, project_id, client_id, category)
}

/// The write itself, without the `State` wrapper, so the rule can be tested
/// against a real connection.
pub fn confirm_classification_core(
    conn: &Connection,
    activity_id: i64,
    project_id: Option<String>,
    client_id: Option<String>,
    category: Option<String>,
) -> Result<(), String> {
    // Read the activity's identity signals for pattern recording. En aktivitet
    // der ikke findes er en fejl her — den kalder bekræfter præcis denne række.
    let signaler = ActivitySignals::read(conn, activity_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows.to_string())?;

    // Update the activity with the confirmed classification.
    // The customer follows the project in the SAME statement, in ONE direction:
    // a chosen project owns the customer, clearing it when it has none. Writing
    // that as a COALESCE chain instead (project, caller, existing) makes a
    // project WITHOUT a customer inherit whatever customer the activity carried
    // — so "Eget arbejde" would bill a customer the project does not belong to,
    // and create_time_entry's klippekort fallback would spend that customer's
    // prepaid hours on it. Only "no project chosen" consults the caller, which
    // is what makes a customer without a project confirmable at all.
    conn.execute(
        "UPDATE activities
         SET project_id = ?1,
             client_id = CASE WHEN ?1 IS NOT NULL
                              THEN (SELECT client_id FROM projects WHERE id = ?1)
                              ELSE COALESCE(?4, client_id)
                         END,
             category = ?2, confidence = 1.0, is_confirmed = 1
         WHERE id = ?3",
        rusqlite::params![project_id, category, activity_id, client_id],
    )
    .map_err(|e| e.to_string())?;

    // Learn from what the activity now says, not from what the caller asked
    // for. classify_by_history gives a pattern's own customer priority over its
    // project's, so a stale customer stored here would keep being handed out for
    // every later activity that app and title matches.
    let learned_client_id: Option<String> = conn
        .query_row(
            "SELECT client_id FROM activities WHERE id = ?1",
            rusqlite::params![activity_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Record the pattern for future auto-classification. Uden et appnavn er der
    // intet signal at lære — `confirm_pattern` ville skrive en række, der
    // aldrig kan genkendes igen.
    if signaler.app_name.is_some() {
        RuleEngine::confirm_pattern(
            conn,
            &signaler,
            project_id.as_deref(),
            learned_client_id.as_deref(),
            category.as_deref(),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct BulkConfirmItem {
    pub activity_id: i64,
    pub project_id: Option<String>,
    pub client_id: Option<String>,
    pub category: Option<String>,
}

/// Confirm multiple activities in a single IPC call.
#[tauri::command]
pub fn bulk_confirm_classifications(
    db: State<'_, Database>,
    items: Vec<BulkConfirmItem>,
) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    bulk_confirm_classifications_core(&conn, &items)
}

/// The write itself, without the `State` wrapper. See
/// `confirm_classification_core` for the one-way customer rule; it is the same
/// statement here, because a bulk confirm reaches the same money.
pub fn bulk_confirm_classifications_core(
    conn: &Connection,
    items: &[BulkConfirmItem],
) -> Result<usize, String> {
    let mut count = 0;

    for item in items {
        // En aktivitet, der ikke findes (eller ikke kan læses), springes over —
        // ellers ville én død række stoppe hele bulk-kørslen.
        let Ok(Some(signaler)) = ActivitySignals::read(conn, item.activity_id) else {
            continue;
        };

        // As in confirm_classification: the customer follows the project, so a
        // bulk confirm can never leave an activity naming one customer through
        // its project and another through its own column — and a project
        // without a customer clears it rather than inheriting one.
        conn.execute(
            "UPDATE activities
             SET project_id = ?1,
                 client_id = CASE WHEN ?1 IS NOT NULL
                                  THEN (SELECT client_id FROM projects WHERE id = ?1)
                                  ELSE COALESCE(?4, client_id)
                             END,
                 category = ?2, confidence = 1.0, is_confirmed = 1
             WHERE id = ?3",
            rusqlite::params![item.project_id, item.category, item.activity_id, item.client_id],
        ).map_err(|e| e.to_string())?;

        // Learn what the activity now says, for the same reason as in
        // confirm_classification: classify_by_history trusts the pattern's own
        // customer over its project's.
        let learned_client_id: Option<String> = conn
            .query_row(
                "SELECT client_id FROM activities WHERE id = ?1",
                rusqlite::params![item.activity_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if signaler.app_name.is_some() {
            // Aktiviteten er gemt, så kun mønsterlæringen kan fejle. Den er
            // ikke akut, men uden den genkender appen næste gang.
            if let Err(e) = RuleEngine::confirm_pattern(
                conn,
                &signaler,
                item.project_id.as_deref(),
                learned_client_id.as_deref(),
                item.category.as_deref(),
            ) {
                crate::db::errors::record("kunne ikke lære mønsteret fra bekræftelsen", e);
            }
        }
        count += 1;
    }

    Ok(count)
}

// ---------------------------------------------------------------------------
// Commands — Retroactive rule application
// ---------------------------------------------------------------------------

/// Count the UNCONFIRMED, non-idle activities whose fields match a rule
/// condition. Shares [`activity_matches_condition`] with the forward classifier
/// and with [`apply_rule_to_unconfirmed`], so the previewed number is exactly
/// what a subsequent apply would change.
pub(crate) fn count_matching_unconfirmed(
    conn: &rusqlite::Connection,
    condition_type: &str,
    condition_op: &str,
    condition_value: &str,
) -> rusqlite::Result<i64> {
    let mut stmt = conn.prepare(
        "SELECT app_name, window_title, url, git_repo
         FROM activities
         WHERE is_confirmed = 0 AND is_idle = 0",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;

    let mut count = 0i64;
    for row in rows {
        let (app, title, url, repo) = row?;
        if activity_matches_condition(
            condition_type,
            condition_op,
            condition_value,
            app.as_deref(),
            title.as_deref(),
            url.as_deref(),
            repo.as_deref(),
        ) {
            count += 1;
        }
    }
    Ok(count)
}

/// Apply a rule's target to every UNCONFIRMED, non-idle activity it matches.
///
/// PRIVACY/CORRECTNESS INVARIANT: only `is_confirmed = 0` rows are ever touched
/// — a manual confirmation is never overwritten by a retroactive rule. The
/// `WHERE ... AND is_confirmed = 0` on the UPDATE makes that guarantee
/// self-defending even if the SELECT filter is ever changed. `project_id` and
/// `category` are written with COALESCE so a rule that targets only one of them
/// leaves the other field untouched. Returns the number of activities changed,
/// which equals the preview count for the same condition.
pub(crate) fn apply_rule_to_unconfirmed(
    conn: &mut rusqlite::Connection,
    condition_type: &str,
    condition_op: &str,
    condition_value: &str,
    project_id: Option<&str>,
    category: Option<&str>,
) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;

    // Collect matching ids (and each row's rule confidence) first so the read
    // statement is finished before any write begins.
    let matches: Vec<(i64, f64)> = {
        let mut stmt = tx.prepare(
            "SELECT id, app_name, window_title, url, git_repo
             FROM activities
             WHERE is_confirmed = 0 AND is_idle = 0",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;

        let mut v = Vec::new();
        for row in rows {
            let (id, app, title, url, repo) = row?;
            if activity_matches_condition(
                condition_type,
                condition_op,
                condition_value,
                app.as_deref(),
                title.as_deref(),
                url.as_deref(),
                repo.as_deref(),
            ) {
                v.push((id, rule_match_confidence(condition_type, app.as_deref())));
            }
        }
        v
    };

    // The reason is the same for every matched row: it describes the rule's
    // condition, not the individual activity. Source is always "rule" here.
    let reason = rule_match_reason(condition_type, condition_value);

    let mut changed = 0i64;
    for (id, confidence) in &matches {
        changed += tx.execute(
            "UPDATE activities
             SET project_id = COALESCE(?1, project_id),
                 category = COALESCE(?2, category),
                 confidence = ?3,
                 classification_source = 'rule',
                 classification_reason = ?4
             WHERE id = ?5 AND is_confirmed = 0",
            rusqlite::params![project_id, category, confidence, reason, id],
        )? as i64;
    }

    tx.commit()?;
    Ok(changed)
}

/// Preview how many unconfirmed activities a rule condition would reclassify.
#[tauri::command]
pub fn preview_rule_application(
    db: State<'_, Database>,
    condition_type: String,
    condition_op: String,
    condition_value: String,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    count_matching_unconfirmed(&conn, &condition_type, &condition_op, &condition_value)
        .map_err(|e| e.to_string())
}

/// Retroactively apply a rule to all matching unconfirmed activities. Confirmed
/// activities are never touched. Returns the number of activities changed.
#[tauri::command]
pub fn apply_rule_to_history(
    db: State<'_, Database>,
    condition_type: String,
    condition_op: String,
    condition_value: String,
    project_id: Option<String>,
    category: Option<String>,
) -> Result<i64, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    apply_rule_to_unconfirmed(
        &mut conn,
        &condition_type,
        &condition_op,
        &condition_value,
        project_id.as_deref(),
        category.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn
    }

    fn insert_project(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, datetime('now'), datetime('now'))",
            rusqlite::params![id, name],
        )
        .expect("insert project");
    }

    /// Insert an activity and return its id.
    fn insert_activity(
        conn: &Connection,
        app_name: &str,
        window_title: &str,
        is_confirmed: bool,
        is_idle: bool,
        project_id: Option<&str>,
        category: Option<&str>,
    ) -> i64 {
        conn.execute(
            "INSERT INTO activities
                (app_name, window_title, is_confirmed, is_idle, project_id, category, started_at, duration)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), 60)",
            rusqlite::params![
                app_name,
                window_title,
                is_confirmed as i32,
                is_idle as i32,
                project_id,
                category
            ],
        )
        .expect("insert activity");
        conn.last_insert_rowid()
    }

    fn read_activity(conn: &Connection, id: i64) -> (Option<String>, Option<String>, bool) {
        conn.query_row(
            "SELECT project_id, category, is_confirmed FROM activities WHERE id = ?1",
            rusqlite::params![id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i32>(2)? != 0,
                ))
            },
        )
        .expect("read activity")
    }

    /// Regression test for the core privacy/correctness guarantee: applying a
    /// rule retroactively must NEVER change a confirmed activity, even when it
    /// matches the rule perfectly.
    #[test]
    fn apply_rule_to_history_never_touches_confirmed_rows() {
        let mut conn = setup_db();
        insert_project(&conn, "p_rule", "Rule target");
        insert_project(&conn, "p_manual", "Manuelt rettet");

        // Confirmed activity that ALSO matches the rule — must stay as the user
        // left it (project p_manual, category meeting, still confirmed).
        let confirmed = insert_activity(
            &conn,
            "code",
            "faktura.ts",
            true,
            false,
            Some("p_manual"),
            Some("meeting"),
        );
        // Unconfirmed activity that matches — should be reclassified.
        let unconfirmed =
            insert_activity(&conn, "code", "faktura.rs", false, false, None, None);

        let changed = apply_rule_to_unconfirmed(
            &mut conn,
            "window_title",
            "contains",
            "faktura",
            Some("p_rule"),
            Some("development"),
        )
        .expect("apply");
        assert_eq!(changed, 1, "only the unconfirmed activity may change");

        // Confirmed row is byte-for-byte unchanged.
        let (pid, cat, conf) = read_activity(&conn, confirmed);
        assert_eq!(pid.as_deref(), Some("p_manual"));
        assert_eq!(cat.as_deref(), Some("meeting"));
        assert!(conf, "confirmed row must stay confirmed");

        // Unconfirmed row is reclassified but STAYS unconfirmed (for review).
        let (pid, cat, conf) = read_activity(&conn, unconfirmed);
        assert_eq!(pid.as_deref(), Some("p_rule"));
        assert_eq!(cat.as_deref(), Some("development"));
        assert!(!conf, "reclassified row must remain unconfirmed");
    }

    /// The preview count must equal the number of rows apply actually changes.
    #[test]
    fn preview_count_equals_applied_count() {
        let mut conn = setup_db();
        insert_project(&conn, "p_rule", "Rule target");

        // 3 matching unconfirmed, 1 matching-but-confirmed, 1 non-matching,
        // 1 matching-but-idle. Only the 3 unconfirmed non-idle rows count.
        insert_activity(&conn, "code", "faktura 1", false, false, None, None);
        insert_activity(&conn, "code", "faktura 2", false, false, None, None);
        insert_activity(&conn, "code", "faktura 3", false, false, None, None);
        insert_activity(&conn, "code", "faktura bekræftet", true, false, None, None);
        insert_activity(&conn, "code", "noget andet", false, false, None, None);
        insert_activity(&conn, "code", "faktura idle", false, true, None, None);

        let preview =
            count_matching_unconfirmed(&conn, "window_title", "contains", "faktura")
                .expect("preview");
        assert_eq!(preview, 3);

        let changed = apply_rule_to_unconfirmed(
            &mut conn,
            "window_title",
            "contains",
            "faktura",
            Some("p_rule"),
            None,
        )
        .expect("apply");
        assert_eq!(changed, preview, "apply must change exactly the previewed count");

        // Re-previewing still returns 3: reclassified rows remain unconfirmed,
        // so a second apply is idempotent rather than expanding the set.
        let preview2 =
            count_matching_unconfirmed(&conn, "window_title", "contains", "faktura")
                .expect("preview2");
        assert_eq!(preview2, 3);
    }

    // -----------------------------------------------------------------------
    // The customer follows the project, in ONE direction
    //
    // "Eget arbejde" is a real project shape: a project with no customer. When
    // an activity carries a customer of its own — a signal bound to a customer
    // alone, or a pattern learned that way — a fallback chain in the write made
    // that project inherit it. Both consumers then paid for the wrong customer:
    // create_time_entry's klippekort lookup falls back to the customer's own
    // prepaid card, and compute_coverage takes COALESCE(p.client_id,
    // a.client_id), so the block could be confirmed as hers. A project that has
    // no customer must therefore CLEAR the customer, not inherit one.
    // -----------------------------------------------------------------------

    fn insert_client(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO clients (id, name) VALUES (?1, ?2)",
            rusqlite::params![id, name],
        )
        .expect("insert client");
    }

    /// An activity the classifier billed to a customer it found on its own.
    fn insert_client_activity(conn: &Connection, app_name: &str, client_id: &str) -> i64 {
        conn.execute(
            "INSERT INTO activities
                (app_name, window_title, client_id, started_at, duration)
             VALUES (?1, 'acme.dk — indbakke', ?2, datetime('now'), 60)",
            rusqlite::params![app_name, client_id],
        )
        .expect("insert activity");
        conn.last_insert_rowid()
    }

    fn read_activity_client(conn: &Connection, id: i64) -> Option<String> {
        conn.query_row(
            "SELECT client_id FROM activities WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get::<_, Option<String>>(0),
        )
        .expect("read activity customer")
    }

    fn read_pattern_client(conn: &Connection, app_name: &str) -> Option<String> {
        conn.query_row(
            "SELECT client_id FROM confirmed_patterns WHERE app_name = ?1",
            rusqlite::params![app_name],
            |r| r.get::<_, Option<String>>(0),
        )
        .expect("read pattern customer")
    }

    /// Det mønster, en bekræftelse lærer, skal kende det aktiviteten selv vidste.
    ///
    /// `git_repo` og `context_path` er de to felter, der gør et mønster til
    /// mere end «denne app, dette vindue» — de binder det til ét projekt, så
    /// samme signal i et andet repo ikke bogføres på det. De læses fra
    /// aktiviteten og gives videre som et par, så et sted, hvor de tabes, er
    /// usynligt: mønsteret lærer stadig, bare uden ophæftningen.
    #[test]
    fn det_laerde_monster_kender_aktivitetens_repo_og_sti() {
        let conn = setup_db();
        insert_client(&conn, "c-acme", "Kunde Acme");
        conn.execute(
            "INSERT INTO activities
                (app_name, window_title, url, git_repo, context_path, client_id, started_at, duration)
             VALUES ('code', 'acme.dk — indbakke', 'https://acme.dk', 'acme/indbakke',
                     'C:/work/acme', 'c-acme', datetime('now'), 60)",
            [],
        )
        .expect("insert activity");
        let activity = conn.last_insert_rowid();

        confirm_classification_core(&conn, activity, None, None, Some("consulting".to_string()))
            .expect("confirm");

        let (git_repo, context_path, title): (Option<String>, Option<String>, Option<String>) =
            conn.query_row(
                "SELECT git_repo, context_path, window_title_pattern FROM confirmed_patterns
                 WHERE app_name = 'code'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("read pattern");

        assert_eq!(git_repo.as_deref(), Some("acme/indbakke"));
        assert_eq!(context_path.as_deref(), Some("C:/work/acme"));
        assert_eq!(title.as_deref(), Some("acme.dk — indbakke"));
    }

    #[test]
    fn a_project_without_a_customer_clears_the_activities_customer() {
        let conn = setup_db();
        insert_client(&conn, "c-acme", "Kunde Acme");
        insert_project(&conn, "p-eget", "Eget arbejde");
        let activity = insert_client_activity(&conn, "chrome", "c-acme");

        confirm_classification_core(
            &conn,
            activity,
            Some("p-eget".to_string()),
            // The caller still offers the stale customer — the dialog sends the
            // activity's own. The project must win regardless.
            Some("c-acme".to_string()),
            Some("consulting".to_string()),
        )
        .expect("confirm");

        assert_eq!(read_activity_client(&conn, activity), None);
    }

    #[test]
    fn a_projects_customer_replaces_the_activities_own() {
        let conn = setup_db();
        insert_client(&conn, "c-acme", "Kunde Acme");
        insert_client(&conn, "c-runa", "Kunde Runa");
        conn.execute(
            "INSERT INTO projects (id, name, client_id) VALUES ('p-runa', 'Runa.dk', 'c-runa')",
            [],
        )
        .expect("insert project");
        let activity = insert_client_activity(&conn, "chrome", "c-acme");

        confirm_classification_core(
            &conn,
            activity,
            Some("p-runa".to_string()),
            Some("c-acme".to_string()),
            Some("consulting".to_string()),
        )
        .expect("confirm");

        assert_eq!(read_activity_client(&conn, activity).as_deref(), Some("c-runa"));
    }

    #[test]
    fn confirming_to_a_customer_alone_keeps_that_customer() {
        let conn = setup_db();
        insert_client(&conn, "c-acme", "Kunde Acme");
        let activity = insert_client_activity(&conn, "chrome", "c-acme");

        confirm_classification_core(
            &conn,
            activity,
            None,
            Some("c-acme".to_string()),
            Some("consulting".to_string()),
        )
        .expect("confirm");

        assert_eq!(read_activity_client(&conn, activity).as_deref(), Some("c-acme"));
        // A customer without a project must still be learnable, or the next
        // activity from the same window is classified to nobody.
        assert_eq!(read_pattern_client(&conn, "chrome").as_deref(), Some("c-acme"));
    }

    /// classify_by_history gives a pattern's OWN customer priority over the
    /// customer's its project holds, so a stale customer stored in the pattern
    /// keeps being handed out for every later activity this app matches.
    #[test]
    fn the_learned_pattern_follows_the_activity_not_the_caller() {
        let conn = setup_db();
        insert_client(&conn, "c-acme", "Kunde Acme");
        insert_client(&conn, "c-runa", "Kunde Runa");
        conn.execute(
            "INSERT INTO projects (id, name, client_id) VALUES ('p-runa', 'Runa.dk', 'c-runa')",
            [],
        )
        .expect("insert project");
        let activity = insert_client_activity(&conn, "chrome", "c-acme");

        confirm_classification_core(
            &conn,
            activity,
            Some("p-runa".to_string()),
            Some("c-acme".to_string()),
            Some("consulting".to_string()),
        )
        .expect("confirm");

        assert_eq!(read_pattern_client(&conn, "chrome").as_deref(), Some("c-runa"));
    }

    #[test]
    fn a_bulk_confirm_clears_the_customer_for_a_project_without_one() {
        let conn = setup_db();
        insert_client(&conn, "c-acme", "Kunde Acme");
        insert_project(&conn, "p-eget", "Eget arbejde");
        let first = insert_client_activity(&conn, "chrome", "c-acme");
        let second = insert_client_activity(&conn, "safari", "c-acme");

        let confirmed = bulk_confirm_classifications_core(
            &conn,
            &[
                BulkConfirmItem {
                    activity_id: first,
                    project_id: Some("p-eget".to_string()),
                    client_id: Some("c-acme".to_string()),
                    category: Some("consulting".to_string()),
                },
                BulkConfirmItem {
                    activity_id: second,
                    project_id: Some("p-eget".to_string()),
                    client_id: Some("c-acme".to_string()),
                    category: Some("consulting".to_string()),
                },
            ],
        )
        .expect("bulk confirm");

        assert_eq!(confirmed, 2);
        assert_eq!(read_activity_client(&conn, first), None);
        assert_eq!(read_activity_client(&conn, second), None);
        assert_eq!(read_pattern_client(&conn, "chrome"), None);
        assert_eq!(read_pattern_client(&conn, "safari"), None);
    }
}
