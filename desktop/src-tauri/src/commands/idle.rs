use crate::commands::time_entries::{
    create_time_entry_inner, emit_klippekort_warning, CreateTimeEntryInput, KlippekortWarning,
    TimeEntry,
};
use crate::db::Database;
use crate::i18n;
use crate::integrations::calendar::{
    guess_for_title, local_ts_expr, not_covered_clause, project_of_match, CalendarEvent,
};
use serde::{Deserialize, Serialize};
use tauri::State;

/// A calendar event overlapping the idle window, plus a best-guess project from
/// the shared classification engine — used to pre-fill the return-from-idle
/// prompt's project + description.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlappingEvent {
    pub event: CalendarEvent,
    pub guess_project_id: Option<String>,
    pub guess_project_name: Option<String>,
    /// The customer a rule or a learned pattern names, for the meetings that
    /// belong to a customer but to no project. The guess used to go through
    /// `guess_project_for_title`, which `?`-returned on exactly those, so a
    /// customer with no projects of their own could never be pre-filled here —
    /// the prompt then logged billable time to nobody, which is the customer
    /// the user was away *for*.
    pub guess_client_id: Option<String>,
    pub guess_client_name: Option<String>,
}

/// List calendar events that overlap the `[from, to]` window, each with an
/// optional project guess, used to pre-fill the return-from-idle prompt.
///
/// `from`/`to` are the idle window bounds emitted as RFC3339 (UTC); calendar
/// events are stored either naive-local (from a `TZID` event) or with a `Z`/
/// offset. Both sides go through [`local_ts_expr`] so the comparison happens in
/// one local wall-clock frame (the same normalisation issue #14 fixed for the
/// calendar-conversion double-log guard). Overlap is the standard half-open
/// test: `event.start < to AND from < event.end`.
#[tauri::command]
pub fn list_events_overlapping(
    db: State<'_, Database>,
    from: String,
    to: String,
) -> Result<Vec<OverlappingEvent>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    list_events_overlapping_core(&conn, &from, &to)
}

/// Core of `list_events_overlapping`, testable without a `State`.
fn list_events_overlapping_core(
    conn: &rusqlite::Connection,
    from: &str,
    to: &str,
) -> Result<Vec<OverlappingEvent>, String> {
    let events = query_overlapping_events(conn, from, to).map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(events.len());
    for event in events {
        // One classification run feeds both halves of the guess, for the same
        // reason as the calendar conversion: running the engine twice could
        // disagree with itself if a rule changed between the two calls. The
        // customer comes out of the same match, so a customer-only hit is
        // carried instead of dropped with `project_of_match`'s `?`.
        let guess = guess_for_title(conn, event.summary.as_deref());
        let (guess_project_id, guess_project_name) =
            match guess.as_ref().and_then(|m| project_of_match(conn, m)) {
                Some((id, name, _conf)) => (Some(id), Some(name)),
                None => (None, None),
            };
        let guess_client_id = guess.as_ref().and_then(|m| m.client_id.clone());
        let guess_client_name = guess_client_id.as_deref().and_then(|cid| {
            conn.query_row(
                "SELECT name FROM clients WHERE id = ?1 AND is_archived = 0",
                rusqlite::params![cid],
                |row| row.get::<_, String>(0),
            )
            .ok()
        });
        result.push(OverlappingEvent {
            event,
            guess_project_id,
            guess_project_name,
            guess_client_id,
            guess_client_name,
        });
    }
    Ok(result)
}

/// Calendar events overlapping `[from, to]`, both sides normalised to the local
/// frame via [`local_ts_expr`]. Testable without an `AppHandle`/`State`.
fn query_overlapping_events(
    conn: &rusqlite::Connection,
    from: &str,
    to: &str,
) -> rusqlite::Result<Vec<CalendarEvent>> {
    let sql = format!(
        "SELECT id, source_url, uid, summary, start_time, end_time, location, imported_at
         FROM calendar_events e
         WHERE {ev_start} < {win_end}
           AND {win_start} < {ev_end}
         ORDER BY e.start_time ASC",
        ev_start = local_ts_expr("e.start_time"),
        ev_end = local_ts_expr("e.end_time"),
        win_start = local_ts_expr("?1"),
        win_end = local_ts_expr("?2"),
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params![from, to], |row| {
        Ok(CalendarEvent {
            id: row.get(0)?,
            source_url: row.get(1)?,
            uid: row.get(2)?,
            summary: row.get(3)?,
            start_time: row.get(4)?,
            end_time: row.get(5)?,
            location: row.get(6)?,
            imported_at: row.get(7)?,
        })
    })?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row?);
    }
    Ok(events)
}

/// Core of `log_idle_period`, testable without an `AppHandle`.
///
/// Creates a time entry covering an idle gap `[start, end]` through the shared
/// `create_time_entry_inner` (so klippekort auto-selection + deduction happen
/// exactly as for a manual entry).
///
/// `project_id` and `client_id` are the prompt's two independent choices: a
/// customer with no project is billable time, which is why both are accepted.
/// The customer still follows the project in ONE direction — the same rule as
/// the manual form and both confirm paths — so an entry can never name a
/// project of one customer and bill another.
///
/// Double-registration guard (billing-critical): before inserting, re-check that
/// no existing time entry already covers `[start, end]`. The prompt can be shown
/// again (e.g. a second return before the first choice is made), so without this
/// the same gap could be logged — and its klippekort deducted — twice. Reuses
/// #14's [`not_covered_clause`] / [`local_ts_expr`] so the check matches the
/// calendar-conversion guard exactly.
pub(crate) fn log_idle_period_core(
    conn: &rusqlite::Connection,
    start: &str,
    end: &str,
    project_id: Option<String>,
    client_id: Option<String>,
    description: Option<String>,
) -> Result<(TimeEntry, Option<KlippekortWarning>), String> {
    // Reject a window that is not a positive interval.
    let duration = idle_duration_seconds(start, end)
        .ok_or_else(|| i18n::t("idle.invalidWindow"))?;

    // Billing-critical: never log the same gap twice.
    let covered_sql = format!(
        "SELECT NOT ({})",
        not_covered_clause(&local_ts_expr("?1"), &local_ts_expr("?2"))
    );
    let already_covered: bool = conn
        .query_row(&covered_sql, rusqlite::params![start, end], |row| {
            row.get::<_, i64>(0)
        })
        .map(|v| v != 0)
        .unwrap_or(false);
    if already_covered {
        return Err(i18n::t("idle.alreadyLogged"));
    }

    // The customer is passed through as chosen: `create_time_entry_inner`
    // resolves it from the project when there is one (a project decides its own
    // customer, including deciding it has none) and honours this one only while
    // no project is picked. One rule, one place — a second copy here is how the
    // two drifted apart in the first place.
    //
    // The window is passed on as the tracker emitted it — a UTC instant — and
    // `create_time_entry_inner` stores it in the local wall clock the column
    // assumes. Converting it here as well was measured to change nothing: the
    // gate downstream already covers this caller, and a second copy of the rule
    // is how the two drifted apart the first time.
    let input = CreateTimeEntryInput {
        project_id,
        client_id,
        klippekort_id: None,
        description,
        start_time: start.to_string(),
        end_time: Some(end.to_string()),
        duration: Some(duration),
        is_billable: Some(true),
        pomodoro_session_id: None,
    };

    create_time_entry_inner(conn, &input)
}

/// Seconds between two RFC3339 timestamps; `None` for unparseable or
/// non-positive spans (so a zero/negative idle window is never logged).
fn idle_duration_seconds(start: &str, end: &str) -> Option<i64> {
    let s = chrono::DateTime::parse_from_rfc3339(start).ok()?;
    let e = chrono::DateTime::parse_from_rfc3339(end).ok()?;
    let secs = (e - s).num_seconds();
    if secs > 0 {
        Some(secs)
    } else {
        None
    }
}

/// Log an idle gap `[start, end]` as a time entry for the chosen project and/or
/// customer. Called when the user picks a project in the return-from-idle prompt.
#[tauri::command]
pub fn log_idle_period(
    db: State<'_, Database>,
    app_handle: tauri::AppHandle,
    start: String,
    end: String,
    project_id: Option<String>,
    client_id: Option<String>,
    description: Option<String>,
) -> Result<TimeEntry, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (entry, warning) =
        log_idle_period_core(&conn, &start, &end, project_id, client_id, description)?;

    // Drop the lock before emitting so no frontend listener can re-enter while held.
    drop(conn);

    if let Some(w) = warning {
        emit_klippekort_warning(&app_handle, &w);
    }

    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    /// In-memory DB with one client + one project, ready for idle-log tests.
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Acme')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'Moeder')",
            [],
        )
        .unwrap();
        conn
    }

    fn count_entries(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM time_entries", [], |r| r.get(0))
            .unwrap()
    }

    fn insert_event(conn: &Connection, summary: &str, start: &str, end: &str) {
        conn.execute(
            "INSERT INTO calendar_events (source_url, uid, summary, start_time, end_time, imported_at)
             VALUES ('http://cal', ?1, ?2, ?3, ?4, '2026-06-01T00:00:00Z')",
            rusqlite::params![format!("uid-{start}"), summary, start, end],
        )
        .unwrap();
    }

    // Overlap query uses naive-local timestamps on both sides (timezone-
    // independent, like calendar.rs's wall-time test): an overlapping event is
    // returned, an adjacent/later one is not.
    #[test]
    fn overlapping_events_are_returned_adjacent_are_not() {
        let conn = setup_db();
        insert_event(&conn, "Kundemøde", "2026-06-02T11:00:00", "2026-06-02T12:00:00");

        // Window 11:30–13:00 overlaps the 11:00–12:00 event.
        let hit =
            query_overlapping_events(&conn, "2026-06-02T11:30:00", "2026-06-02T13:00:00").unwrap();
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].summary.as_deref(), Some("Kundemøde"));

        // Window 12:00–13:00 is adjacent (half-open), not overlapping.
        let miss =
            query_overlapping_events(&conn, "2026-06-02T12:00:00", "2026-06-02T13:00:00").unwrap();
        assert!(miss.is_empty(), "adjacent window must not match");
    }

    // (b) Logging an idle period creates exactly one entry with the right
    // start/end/duration/project.
    #[test]
    fn log_idle_period_creates_single_entry_with_correct_bounds() {
        let conn = setup_db();
        let start = "2026-06-02T11:05:00+00:00";
        let end = "2026-06-02T11:52:00+00:00"; // 47 min

        let (entry, _) =
            log_idle_period_core(
                &conn,
                start,
                end,
                Some("p1".into()),
                None,
                Some("Kundemøde".into()),
            )
            .unwrap();

        assert_eq!(count_entries(&conn), 1, "exactly one entry for one gap");
        // The tracker hands the window over as a UTC instant, but the entry is
        // STORED as the local wall clock — the form every reader of
        // `time_entries.start_time` assumes. Storing the instant verbatim is
        // what put an idle gap logged after midnight on the previous calendar
        // day. Expectations are computed, never hardcoded, so this holds in
        // every timezone.
        assert_eq!(
            entry.start_time,
            crate::tid::lokal_naiv(start).expect("læselig start"),
            "starttidspunktet skal gemmes som lokal væg-tid"
        );
        assert_eq!(
            entry.end_time.as_deref(),
            crate::tid::lokal_naiv(end).as_deref(),
            "sluttidspunktet skal gemmes som lokal væg-tid"
        );
        // The values describe the SAME moment — the wall clock moved, the time
        // did not.
        assert_eq!(
            crate::tid::øjeblik(&entry.start_time),
            crate::tid::øjeblik(start),
            "konverteringen må ikke flytte registreringen i tid"
        );
        assert_eq!(entry.duration, Some(47 * 60));
        assert_eq!(entry.project_id.as_deref(), Some("p1"));
        assert_eq!(entry.description.as_deref(), Some("Kundemøde"));
    }

    // (c) A second log of an overlapping window is rejected — the double-log
    // guard. The same gap can never become two entries (two klippekort deductions).
    #[test]
    fn log_idle_period_rejects_overlapping_second_log() {
        let conn = setup_db();
        let start = "2026-06-02T11:05:00+00:00";
        let end = "2026-06-02T11:52:00+00:00";

        log_idle_period_core(&conn, start, end, Some("p1".into()), None, None).unwrap();
        assert_eq!(count_entries(&conn), 1);

        // Re-log the exact same window (prompt shown again) → rejected.
        let err = match log_idle_period_core(&conn, start, end, Some("p1".into()), None, None) {
            Err(e) => e,
            Ok(_) => panic!("second log of the same gap must be rejected"),
        };
        assert!(err.contains("allerede"), "clear already-logged error: {err}");
        assert_eq!(count_entries(&conn), 1, "still exactly one entry");

        // A partially overlapping window is also rejected.
        let overlap_err = log_idle_period_core(
            &conn,
            "2026-06-02T11:30:00+00:00",
            "2026-06-02T12:10:00+00:00",
            Some("p1".into()),
            None,
            None,
        );
        assert!(overlap_err.is_err(), "partial overlap must also be rejected");
        assert_eq!(count_entries(&conn), 1);
    }

    // Review regression: a RUNNING timer started before the idle window (start a
    // timer, then step away for a call) covers the window and must block a second
    // idle-log — otherwise the same time is billed twice (idle entry + the timer
    // when it stops). A running entry has end_time NULL and is treated as
    // covering [start, now].
    #[test]
    fn log_idle_period_rejects_when_running_timer_covers_window() {
        let conn = setup_db();
        // Timer started at 10:00 (before the 11:05 idle window), still running.
        conn.execute(
            "INSERT INTO time_entries (id, project_id, client_id, start_time, end_time, is_running, source)
             VALUES ('t-run', 'p1', 'c1', '2026-06-02T10:00:00+00:00', NULL, 1, 'manual')",
            [],
        )
        .unwrap();

        let err = log_idle_period_core(
            &conn,
            "2026-06-02T11:05:00+00:00",
            "2026-06-02T11:52:00+00:00",
            Some("p1".into()),
            None,
            None,
        );
        assert!(err.is_err(), "running timer covering the window must block the idle-log");
        // Only the running timer exists — no second overlapping entry was created.
        assert_eq!(count_entries(&conn), 1);
    }

    // A non-overlapping (adjacent/later) window is allowed.
    #[test]
    fn log_idle_period_allows_non_overlapping_window() {
        let conn = setup_db();
        log_idle_period_core(
            &conn,
            "2026-06-02T11:05:00+00:00",
            "2026-06-02T11:52:00+00:00",
            Some("p1".into()),
            None,
            None,
        )
        .unwrap();

        // A later, non-overlapping gap is a separate valid entry.
        log_idle_period_core(
            &conn,
            "2026-06-02T14:00:00+00:00",
            "2026-06-02T14:30:00+00:00",
            Some("p1".into()),
            None,
            None,
        )
        .unwrap();

        assert_eq!(count_entries(&conn), 2);
    }

    // A zero/negative window is rejected before any insert.
    #[test]
    fn log_idle_period_rejects_non_positive_window() {
        let conn = setup_db();
        let err = log_idle_period_core(
            &conn,
            "2026-06-02T11:05:00+00:00",
            "2026-06-02T11:05:00+00:00",
            None,
            None,
            None,
        );
        assert!(err.is_err(), "zero-length window is not loggable");
        assert_eq!(count_entries(&conn), 0);
    }

    /// A customer whose work is meetings, support calls and reviews has no
    /// project of their own — that is the whole of their billable time. The
    /// overlap guess must therefore name the CUSTOMER, not just the project:
    /// `guess_project_for_title` used to `?`-return on a customer-only match, so
    /// this prompt offered "no project" for a meeting the app knew the customer
    /// of, and the entry was logged to nobody.
    #[test]
    fn overlapping_event_guesses_the_customer_of_a_project_less_match() {
        let conn = setup_db();
        // A second customer who has no projects at all.
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c2', 'Kunde uden projekter')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO classification_rules (name, condition_type, condition_op, condition_value, target_client_id)
             VALUES ('Portal', 'app_name', 'equals', 'calendar', 'c2')",
            [],
        )
        .unwrap();
        insert_event(&conn, "Support", "2026-06-02T11:00:00", "2026-06-02T12:00:00");

        let events = list_events_overlapping_core(
            &conn,
            "2026-06-02T11:30:00",
            "2026-06-02T13:00:00",
        )
        .unwrap();

        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!(e.guess_client_id.as_deref(), Some("c2"));
        assert_eq!(e.guess_client_name.as_deref(), Some("Kunde uden projekter"));
        assert_eq!(e.guess_project_id, None, "the rule names no project");
    }

    // The customer-only guess above is the regression; a project guess must keep
    // working and must name the project's own customer alongside it, so the
    // prompt can show the customer even when a project is chosen.
    #[test]
    fn overlapping_event_guesses_both_halves_of_a_project_match() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO classification_rules (name, condition_type, condition_op, condition_value, target_project_id)
             VALUES ('Foeder', 'app_name', 'equals', 'calendar', 'p1')",
            [],
        )
        .unwrap();
        insert_event(&conn, "Fødselsforberedelse", "2026-06-02T11:00:00", "2026-06-02T12:00:00");

        let events = list_events_overlapping_core(
            &conn,
            "2026-06-02T11:30:00",
            "2026-06-02T13:00:00",
        )
        .unwrap();

        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!(e.guess_project_id.as_deref(), Some("p1"));
        assert_eq!(e.guess_project_name.as_deref(), Some("Moeder"));
        // The customer comes out of the same match, resolved from the project.
        assert_eq!(e.guess_client_id.as_deref(), Some("c1"));
        assert_eq!(e.guess_client_name.as_deref(), Some("Acme"));
    }

    // Logging the gap for a customer with no project: the entry is billable to
    // them, and a klippekort on that customer is auto-selected and deducted.
    #[test]
    fn log_idle_period_bills_a_customer_without_a_project() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c2', 'Kunde uden projekter')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, hourly_rate)
             VALUES ('k2', 'c2', 'Support', 10, 0, 0)",
            [],
        )
        .unwrap();

        let (entry, _) = log_idle_period_core(
            &conn,
            "2026-06-02T11:05:00+00:00",
            "2026-06-02T11:52:00+00:00",
            None,
            Some("c2".into()),
            Some("Support".into()),
        )
        .unwrap();

        assert_eq!(entry.client_id.as_deref(), Some("c2"));
        assert_eq!(entry.project_id, None, "no project was chosen");
        assert_eq!(
            entry.klippekort_id.as_deref(),
            Some("k2"),
            "a klippekort on the customer is auto-selected without a project"
        );
        assert_eq!(entry.duration, Some(47 * 60));
    }

    // The customer follows the project in ONE direction, exactly as in the
    // manual form: a project decides its own customer, so choosing a project of
    // another customer cannot bill the one the prompt had selected. Without the
    // project the chosen customer stands — that is the whole point of the
    // customer-only path.
    #[test]
    fn log_idle_period_lets_the_project_decide_the_customer() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c2', 'Anden kunde')",
            [],
        )
        .unwrap();

        // A project wins over a conflicting customer choice.
        let (entry, _) = log_idle_period_core(
            &conn,
            "2026-06-02T11:05:00+00:00",
            "2026-06-02T11:52:00+00:00",
            Some("p1".into()),
            Some("c2".into()),
            None,
        )
        .unwrap();
        assert_eq!(entry.project_id.as_deref(), Some("p1"));
        assert_eq!(
            entry.client_id.as_deref(),
            Some("c1"),
            "a project may not bill a customer other than its own"
        );

        // A project with no customer clears the choice, rather than leaving a
        // stale customer on a project that belongs to nobody.
        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES ('p2', NULL, 'Eget arbejde')",
            [],
        )
        .unwrap();
        let (own, _) = log_idle_period_core(
            &conn,
            "2026-06-02T14:00:00+00:00",
            "2026-06-02T14:30:00+00:00",
            Some("p2".into()),
            Some("c2".into()),
            None,
        )
        .unwrap();
        assert_eq!(own.client_id, None);
    }
}
