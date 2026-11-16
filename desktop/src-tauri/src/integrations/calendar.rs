use crate::commands::time_entries::{
    create_time_entry_inner, emit_klippekort_warning, CreateTimeEntryInput, KlippekortWarning,
    TimeEntry,
};
use crate::db::Database;
use crate::i18n;
use crate::tracker::rules::{client_of_project, RuleEngine, RuleMatch};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Synthetic `app_name` used when running calendar event titles through the
/// classification engine. Calendar events have no real application, so they get
/// their own namespace in `classification_rules` / `confirmed_patterns`: a
/// pattern learned from converting an event only ever matches other events.
pub(crate) const CALENDAR_APP: &str = "calendar";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: i64,
    pub source_url: String,
    pub uid: String,
    pub summary: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub location: Option<String>,
    pub imported_at: String,
}

/// Parsed VEVENT from iCal data (before DB insertion).
#[derive(Debug, Clone)]
struct ParsedEvent {
    uid: String,
    summary: Option<String>,
    dtstart: String,
    dtend: String,
    location: Option<String>,
}

/// Parse iCal (.ics) text into a list of events.
/// Handles basic VEVENT blocks with DTSTART, DTEND, SUMMARY, LOCATION, UID.
fn parse_ical(ical_text: &str) -> Vec<ParsedEvent> {
    let mut events = Vec::new();
    let mut in_vevent = false;
    let mut uid = String::new();
    let mut summary: Option<String> = None;
    let mut dtstart = String::new();
    let mut dtend = String::new();
    let mut location: Option<String> = None;

    for line in ical_text.lines() {
        let line = line.trim_end_matches('\r');

        if line == "BEGIN:VEVENT" {
            in_vevent = true;
            uid.clear();
            summary = None;
            dtstart.clear();
            dtend.clear();
            location = None;
            continue;
        }

        if line == "END:VEVENT" {
            if in_vevent && !uid.is_empty() && !dtstart.is_empty() {
                // If no DTEND, use DTSTART
                if dtend.is_empty() {
                    dtend = dtstart.clone();
                }
                events.push(ParsedEvent {
                    uid: uid.clone(),
                    summary: summary.clone(),
                    dtstart: normalize_datetime(&dtstart),
                    dtend: normalize_datetime(&dtend),
                    location: location.clone(),
                });
            }
            in_vevent = false;
            continue;
        }

        if !in_vevent {
            continue;
        }

        // Extract property value — handles properties with params like DTSTART;TZID=...:value
        if let Some(value) = extract_ical_value(line, "UID") {
            uid = value;
        } else if let Some(value) = extract_ical_value(line, "SUMMARY") {
            summary = Some(value);
        } else if let Some(value) = extract_ical_value(line, "DTSTART") {
            dtstart = value;
        } else if let Some(value) = extract_ical_value(line, "DTEND") {
            dtend = value;
        } else if let Some(value) = extract_ical_value(line, "LOCATION") {
            location = Some(value);
        }
    }

    events
}

/// Extract value from an iCal property line.
/// Handles both `PROP:value` and `PROP;PARAM=x:value` formats.
fn extract_ical_value(line: &str, property: &str) -> Option<String> {
    // Check for "PROP:" or "PROP;"
    if let Some(rest) = line.strip_prefix(property) {
        if let Some(stripped) = rest.strip_prefix(':') {
            return Some(stripped.to_string());
        }
        if rest.starts_with(';') {
            // Has parameters — find the colon after params
            if let Some(colon_pos) = rest.find(':') {
                return Some(rest[colon_pos + 1..].to_string());
            }
        }
    }
    None
}

/// Normalize iCal datetime formats to ISO 8601.
/// Converts "20260523T140000Z" → "2026-05-23T14:00:00Z"
/// Converts "20260523T140000" → "2026-05-23T14:00:00"
/// Converts "20260523" → "2026-05-23T00:00:00"
/// Already formatted ISO strings are returned as-is.
fn normalize_datetime(dt: &str) -> String {
    let dt = dt.trim();

    // If it already contains dashes, it's likely already ISO-formatted
    if dt.contains('-') {
        return dt.to_string();
    }

    let len = dt.len();

    if len >= 15 {
        // Full compact datetime: 20260523T140000 or 20260523T140000Z
        let date_part = &dt[..8];
        let time_part = &dt[9..15];
        let suffix = if dt.ends_with('Z') { "Z" } else { "" };
        format!(
            "{}-{}-{}T{}:{}:{}{}",
            &date_part[..4],
            &date_part[4..6],
            &date_part[6..8],
            &time_part[..2],
            &time_part[2..4],
            &time_part[4..6],
            suffix,
        )
    } else if len >= 8 {
        // Date only: 20260523
        format!(
            "{}-{}-{}T00:00:00",
            &dt[..4],
            &dt[4..6],
            &dt[6..8],
        )
    } else {
        // Unknown format — return as-is
        dt.to_string()
    }
}

/// Sync calendar events from an iCal URL. Returns the number of new events imported.
#[tauri::command]
pub async fn sync_calendar(db: State<'_, Database>, url: String) -> Result<i32, String> {
    // Fetch the iCal data
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "TimeTrack-Desktop/0.1")
        .send()
        .await
        .map_err(|e| i18n::t_fmt("calendar.couldNotFetch", &[&e.to_string()]))?;

    if !response.status().is_success() {
        return Err(i18n::t_fmt(
            "calendar.urlError",
            &[&response.status().to_string()],
        ));
    }

    let ical_text = response
        .text()
        .await
        .map_err(|e| i18n::t_fmt("calendar.couldNotRead", &[&e.to_string()]))?;

    let parsed_events = parse_ical(&ical_text);

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();

    let mut new_count = 0i32;

    for event in &parsed_events {
        // Check if this UID from this source already exists
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM calendar_events WHERE source_url = ?1 AND uid = ?2",
                rusqlite::params![url, event.uid],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if exists {
            // Update existing event
            conn.execute(
                "UPDATE calendar_events SET summary = ?1, start_time = ?2, end_time = ?3, location = ?4, imported_at = ?5
                 WHERE source_url = ?6 AND uid = ?7",
                rusqlite::params![
                    event.summary,
                    event.dtstart,
                    event.dtend,
                    event.location,
                    now,
                    url,
                    event.uid,
                ],
            )
            .map_err(|e| e.to_string())?;
        } else {
            // Insert new event
            conn.execute(
                "INSERT INTO calendar_events (source_url, uid, summary, start_time, end_time, location, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    url,
                    event.uid,
                    event.summary,
                    event.dtstart,
                    event.dtend,
                    event.location,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
            new_count += 1;
        }
    }

    Ok(new_count)
}

/// List calendar events within a date range.
#[tauri::command]
pub fn list_calendar_events(
    db: State<'_, Database>,
    from: String,
    to: String,
) -> Result<Vec<CalendarEvent>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, source_url, uid, summary, start_time, end_time, location, imported_at
             FROM calendar_events
             WHERE start_time >= ?1 AND start_time <= ?2
             ORDER BY start_time ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![from, to], |row| {
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
        })
        .map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| e.to_string())?);
    }

    Ok(events)
}

/// A calendar event that has NOT yet been logged as time, together with a
/// best-guess project from the classification engine (may be `None`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UncoveredCalendarEvent {
    pub event: CalendarEvent,
    pub guess_project_id: Option<String>,
    pub guess_project_name: Option<String>,
    pub guess_confidence: Option<f64>,
    /// The customer a rule or a learned pattern names, for the events that belong
    /// to a customer but to no project. The log dialog shows this: it would
    /// otherwise offer "no project" and quietly bill a customer the user was
    /// never shown.
    pub guess_client_id: Option<String>,
    pub guess_client_name: Option<String>,
}

/// Parse an event datetime that may be RFC3339 (`...Z` / `...+02:00`) or a
/// timezone-naive local wall-clock string (`2026-06-01T09:00:00`, from a
/// `TZID` event). Returns a `NaiveDateTime` in a single frame so two values
/// from the *same* event can be subtracted for a duration.
fn parse_event_datetime(s: &str) -> Option<chrono::NaiveDateTime> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.naive_utc());
    }
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok()
}

/// Duration in seconds between an event's start and end. Returns `None` for
/// unparseable, zero, or negative spans (e.g. all-day `VALUE=DATE` events with
/// equal start/end) so no bogus klippekort deduction is triggered.
fn event_duration_seconds(start: &str, end: &str) -> Option<i64> {
    match (parse_event_datetime(start), parse_event_datetime(end)) {
        (Some(s), Some(e)) => {
            let secs = (e - s).num_seconds();
            if secs > 0 {
                Some(secs)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// SQL expression that normalises a `time_entries` timestamp column to the local
/// wall-clock frame that calendar events use.
///
/// `time_entries` mixes two conventions: timer/auto-tracker rows are true UTC
/// instants (`chrono::Utc::now().to_rfc3339()` → `…+00:00`), while manual-form
/// rows are naive local wall-clock (no offset). Calendar events are naive local
/// (the `TZID` wall-clock digits). A plain `DATETIME()` leaves a naive string
/// untouched but does NOT lift a UTC instant into local time, so a UTC-stamped
/// entry never lined up with the local-naive calendar event it actually covers
/// — letting an already-tracked meeting be logged a second time. This converts
/// offset/`Z` values with `'localtime'` and passes naive values through, so both
/// sides compare in one local frame. (`col` is a hardcoded column, not user
/// input — no injection surface.)
pub(crate) fn local_ts_expr(col: &str) -> String {
    format!(
        "(CASE WHEN {col} LIKE '%+%' OR {col} LIKE '%Z' \
         THEN DATETIME({col}, 'localtime') ELSE DATETIME({col}) END)"
    )
}

/// SQL `NOT EXISTS (…)` body: true when NO time entry covers the event whose
/// start/end are `event_start_expr`/`event_end_expr` (either overlapping it or
/// sharing its exact start instant). Both sides are compared in the local frame
/// via [`local_ts_expr`]. Clause (b) (exact start) keeps conversion idempotent:
/// `convert_calendar_event` copies the event's start verbatim, so the created
/// entry re-matches even for zero-length (all-day) events overlap alone misses.
///
/// A RUNNING entry (`end_time IS NULL`) is treated as covering `[start, now]`,
/// not a zero-width point at its start. Otherwise a timer started before the
/// window (start a timer, then step away for a call, or before a meeting) would
/// not be seen as covering the window, and the idle-return / calendar-convert
/// flows would log a SECOND overlapping entry — double-billing the same time
/// the running timer already accounts for.
pub(crate) fn not_covered_clause(event_start_expr: &str, event_end_expr: &str) -> String {
    let te_start = local_ts_expr("t.start_time");
    let te_end = format!(
        "COALESCE({}, DATETIME('now', 'localtime'))",
        local_ts_expr("t.end_time")
    );
    format!(
        "NOT EXISTS (
             SELECT 1 FROM time_entries t
             WHERE (
               {te_start} < {event_end_expr}
               AND {event_start_expr} < {te_end}
             )
             OR {te_start} = {event_start_expr}
           )"
    )
}

/// Core query: calendar events in `[from, to]` (by start date) that are NOT
/// covered by an existing time entry. Double-registration guard is
/// billing-critical — see [`not_covered_clause`] / [`local_ts_expr`].
fn query_uncovered_events(
    conn: &rusqlite::Connection,
    from: &str,
    to: &str,
) -> rusqlite::Result<Vec<CalendarEvent>> {
    let sql = format!(
        "SELECT id, source_url, uid, summary, start_time, end_time, location, imported_at
         FROM calendar_events e
         WHERE e.start_time >= ?1 AND e.start_time <= ?2
           AND {}
         ORDER BY e.start_time ASC",
        not_covered_clause("DATETIME(e.start_time)", "DATETIME(e.end_time)"),
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

/// The project half of the guess as `(id, name, confidence)`, for a caller that
/// already holds the [`guess_for_title`] match and must not classify twice.
///
/// Returns `None` for a customer-only match: such a match names no project, so
/// there is nothing to attach the event to — a caller that also wants the
/// customer reads it off the [`RuleMatch`] instead. This replaces the older
/// `guess_project_for_title`, which had to run the engine itself and so could
/// only ever hand back a project; callers that need the customer ran it twice
/// and risked disagreeing with themselves.
pub(crate) fn project_of_match(
    conn: &rusqlite::Connection,
    m: &RuleMatch,
) -> Option<(String, String, f64)> {
    let project_id = m.project_id.as_deref()?;
    let name: String = conn
        .query_row(
            "SELECT name FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .ok()?;
    Some((project_id.to_string(), name, m.confidence))
}

/// The classification match for an event title, with a project that has since
/// been archived or deleted dropped from `project_id`.
///
/// This is what the *write* path needs, and it deliberately keeps a customer
/// the match named in its own right even when the project is gone: a rule that
/// says "everything with this title is billed to this customer" is still the
/// user's decision, and the customer is the part that actually gets billed.
/// Dropping it would turn a working rule into a silent loss of attribution the
/// first time a project is archived.
pub(crate) fn guess_for_title(
    conn: &rusqlite::Connection,
    summary: Option<&str>,
) -> Option<RuleMatch> {
    let title = summary.map(str::trim).filter(|s| !s.is_empty())?;
    let mut m = RuleEngine::classify(conn, CALENDAR_APP, title, None, None, None)?;
    if let Some(pid) = m.project_id.clone() {
        let alive: bool = conn
            .query_row(
                "SELECT 1 FROM projects WHERE id = ?1 AND is_archived = 0",
                rusqlite::params![pid],
                |row| row.get::<_, i64>(0),
            )
            .map(|v| v == 1)
            .unwrap_or(false);
        if !alive {
            m.project_id = None;
            // A customer that merely came FROM the project is not evidence on
            // its own, so it goes with it. One named by the rule or a pattern
            // stays: that was the user's own decision, made without a project.
            if m.client_id.as_deref() == client_of_project(conn, &pid).as_deref() {
                m.client_id = None;
            }
        }
    }
    Some(m)
}

/// List calendar events in `[from, to]` not yet covered by a time entry, each
/// with an optional project guess from the classification rules/patterns.
#[tauri::command]
pub fn list_uncovered_calendar_events(
    db: State<'_, Database>,
    from: String,
    to: String,
) -> Result<Vec<UncoveredCalendarEvent>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let events = query_uncovered_events(&conn, &from, &to).map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(events.len());
    for event in events {
        // One classification run feeds both halves of the guess: the project the
        // dialog pre-fills and the customer the conversion would bill. Running
        // the engine twice could disagree with itself if a rule changed between
        // the two calls.
        let guess = guess_for_title(&conn, event.summary.as_deref());
        let (guess_project_id, guess_project_name, guess_confidence) =
            match guess.as_ref().and_then(|m| project_of_match(&conn, m)) {
                Some((id, name, conf)) => (Some(id), Some(name), Some(conf)),
                None => (None, None, None),
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
        result.push(UncoveredCalendarEvent {
            event,
            guess_project_id,
            guess_project_name,
            guess_confidence,
            guess_client_id,
            guess_client_name,
        });
    }

    Ok(result)
}

/// Core of `convert_calendar_event`, testable without an `AppHandle`.
///
/// Reads the event, resolves the project (explicit override wins over the
/// classification guess), derives the client from the project (so klippekort
/// auto-selection works), then creates the time entry through the shared
/// `create_time_entry_inner` — the SAME path as manual creation, so klippekort
/// deduction happens automatically. Finally remembers the event-title →
/// project mapping as a `confirmed_pattern` for future guesses. Returns the new
/// entry plus any klippekort warning for the caller to emit.
pub(crate) fn convert_calendar_event_core(
    conn: &rusqlite::Connection,
    event_id: i64,
    project_id: Option<String>,
) -> Result<(TimeEntry, Option<KlippekortWarning>), String> {
    let (summary, start_time, end_time): (Option<String>, String, String) = conn
        .query_row(
            "SELECT summary, start_time, end_time FROM calendar_events WHERE id = ?1",
            rusqlite::params![event_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| i18n::t("calendar.eventNotFound"))?;

    // Write-time idempotency guard (billing-critical): the read-time suggestion
    // list can be stale — e.g. "Log alle møder" runs while an individual "Log
    // som tid" is clicked for the same event. Re-check coverage here so the same
    // meeting can never become two time entries (and two klippekort deductions).
    let already_covered: bool = conn
        .query_row(
            &format!(
                "SELECT NOT ({})",
                not_covered_clause("DATETIME(?1)", "DATETIME(?2)")
            ),
            rusqlite::params![start_time, end_time],
            |row| row.get::<_, i64>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(false);
    if already_covered {
        return Err(i18n::t("calendar.eventAlreadyLogged"));
    }

    // Explicit selection wins; otherwise the classification engine decides — and
    // it decides the customer as well as the project. A customer's kickoff call
    // or support round has no project, so a title that matches a customer rule
    // must bill that customer: this is the same pipeline the tracker runs on a
    // live activity, so an event cannot be less attributed than the work around
    // it.
    let guess = match project_id {
        Some(_) => None,
        None => guess_for_title(conn, summary.as_deref()),
    };
    let resolved_project_id = match &project_id {
        Some(pid) => Some(pid.clone()),
        None => guess.as_ref().and_then(|m| m.project_id.clone()),
    };

    // The customer comes from the guess only where the guess knows one and no
    // project was chosen — `create_time_entry_inner` resolves the project case,
    // so a project can never be billed to a customer the rule named for a
    // different (or missing) project.
    let client_id = guess.and_then(|m| m.client_id);

    let duration = event_duration_seconds(&start_time, &end_time);

    let input = CreateTimeEntryInput {
        project_id: resolved_project_id.clone(),
        client_id,
        klippekort_id: None,
        description: summary.clone(),
        start_time,
        end_time: Some(end_time),
        duration,
        is_billable: Some(true),
        pomodoro_session_id: None,
    };

    let (entry, warning) = create_time_entry_inner(conn, &input)?;

    // Remember event-title → project so the next identical event is pre-filled.
    if let (Some(pid), Some(title)) = (
        resolved_project_id.as_deref(),
        summary.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    ) {
        if let Err(e) = RuleEngine::confirm_pattern(
            conn,
            &crate::tracker::rules::ActivitySignals::titled(CALENDAR_APP, title),
            Some(pid),
            None,
            None,
        ) {
            crate::db::errors::record("kunne ikke huske kalenderbegivenhedens titel", e);
        }
    }

    Ok((entry, warning))
}

/// Convert an imported calendar event into a time entry with one click.
/// `project_id` overrides the classification guess when provided.
#[tauri::command]
pub fn convert_calendar_event(
    db: State<'_, Database>,
    app_handle: tauri::AppHandle,
    event_id: i64,
    project_id: Option<String>,
) -> Result<TimeEntry, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (entry, warning) = convert_calendar_event_core(&conn, event_id, project_id)?;

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

    #[test]
    fn parse_basic_ical() {
        let ical = "\
BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:abc123@google.com\r
DTSTART:20260523T140000Z\r
DTEND:20260523T150000Z\r
SUMMARY:Team meeting\r
LOCATION:Kontor\r
END:VEVENT\r
END:VCALENDAR";

        let events = parse_ical(ical);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].uid, "abc123@google.com");
        assert_eq!(events[0].summary.as_deref(), Some("Team meeting"));
        assert_eq!(events[0].dtstart, "2026-05-23T14:00:00Z");
        assert_eq!(events[0].dtend, "2026-05-23T15:00:00Z");
        assert_eq!(events[0].location.as_deref(), Some("Kontor"));
    }

    #[test]
    fn parse_ical_with_tzid() {
        let ical = "\
BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
UID:tz-event@example\r
DTSTART;TZID=Europe/Copenhagen:20260601T090000\r
DTEND;TZID=Europe/Copenhagen:20260601T100000\r
SUMMARY:Morgenmøde\r
END:VEVENT\r
END:VCALENDAR";

        let events = parse_ical(ical);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].dtstart, "2026-06-01T09:00:00");
        assert_eq!(events[0].dtend, "2026-06-01T10:00:00");
    }

    #[test]
    fn parse_ical_date_only() {
        let ical = "\
BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
UID:allday@example\r
DTSTART;VALUE=DATE:20260601\r
DTEND;VALUE=DATE:20260602\r
SUMMARY:Ferie\r
END:VEVENT\r
END:VCALENDAR";

        let events = parse_ical(ical);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].dtstart, "2026-06-01T00:00:00");
    }

    #[test]
    fn parse_multiple_events() {
        let ical = "\
BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
UID:ev1@test\r
DTSTART:20260101T100000Z\r
DTEND:20260101T110000Z\r
SUMMARY:Event 1\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:ev2@test\r
DTSTART:20260101T120000Z\r
DTEND:20260101T130000Z\r
SUMMARY:Event 2\r
END:VEVENT\r
END:VCALENDAR";

        let events = parse_ical(ical);
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn normalize_datetime_formats() {
        assert_eq!(normalize_datetime("20260523T140000Z"), "2026-05-23T14:00:00Z");
        assert_eq!(normalize_datetime("20260523T140000"), "2026-05-23T14:00:00");
        assert_eq!(normalize_datetime("20260523"), "2026-05-23T00:00:00");
        assert_eq!(normalize_datetime("2026-05-23T14:00:00"), "2026-05-23T14:00:00");
    }

    // -----------------------------------------------------------------------
    // Calendar event → time_entry conversion (issue #14)
    // -----------------------------------------------------------------------

    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    /// In-memory DB with one client + one project, ready for conversion tests.
    fn setup_conv_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
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

    /// Insert a calendar event and return its id.
    fn insert_event(conn: &Connection, summary: &str, start: &str, end: &str) -> i64 {
        conn.execute(
            "INSERT INTO calendar_events (source_url, uid, summary, start_time, end_time, imported_at)
             VALUES ('http://cal', ?1, ?2, ?3, ?4, '2026-06-01T00:00:00Z')",
            rusqlite::params![format!("uid-{}-{}", summary, start), summary, start, end],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn insert_klippekort(conn: &Connection, total: f64) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO klippekort (id, client_id, project_id, name, total_hours, used_hours, status)
             VALUES (?1, 'c1', 'p1', 'KK', ?2, 0, 'active')",
            rusqlite::params![id, total],
        )
        .unwrap();
        id
    }

    // (a) An event overlapping an existing time_entry is NOT uncovered.
    #[test]
    fn overlapping_event_is_not_uncovered() {
        let conn = setup_conv_db();
        insert_event(&conn, "Kundemoede", "2026-06-02T10:00:00", "2026-06-02T11:00:00");
        // Existing entry 10:30–11:30 overlaps the event.
        conn.execute(
            "INSERT INTO time_entries (id, start_time, end_time, duration, source)
             VALUES ('t1', '2026-06-02T10:30:00', '2026-06-02T11:30:00', 3600, 'manual')",
            [],
        )
        .unwrap();

        let events =
            query_uncovered_events(&conn, "2026-06-02T00:00:00", "2026-06-02T23:59:59").unwrap();
        assert!(events.is_empty(), "overlapping event must be hidden");
    }

    // A non-overlapping event on the same day IS uncovered (adjacency is fine).
    #[test]
    fn adjacent_event_is_still_uncovered() {
        let conn = setup_conv_db();
        insert_event(&conn, "Kundemoede", "2026-06-02T11:00:00", "2026-06-02T12:00:00");
        // Entry ends exactly when the event starts — adjacent, not overlapping.
        conn.execute(
            "INSERT INTO time_entries (id, start_time, end_time, duration, source)
             VALUES ('t1', '2026-06-02T10:00:00', '2026-06-02T11:00:00', 3600, 'manual')",
            [],
        )
        .unwrap();

        let events =
            query_uncovered_events(&conn, "2026-06-02T00:00:00", "2026-06-02T23:59:59").unwrap();
        assert_eq!(events.len(), 1, "adjacent (non-overlapping) event stays uncovered");
    }

    // A naive manual entry covers a calendar event at the same LOCAL wall time.
    // This is timezone-independent (both sides go through `DATETIME()` with no
    // 'localtime' modifier) and is the mechanism the conversion idempotency
    // relies on — the created entry copies the event's naive start verbatim.
    //
    // NOTE: the UTC→local branch of `local_ts_expr` (an offset/`Z` entry lifted
    // into the local frame) is deliberately NOT asserted here: its result
    // depends on the test machine's timezone, so it can't be checked portably in
    // CI. It is exercised on real (Danish/CET) machines — where a `09:00Z` entry
    // is 11:00 local and therefore correctly does NOT cover a 09:00 local event,
    // the very mis-frame the previous version of this test wrongly asserted away.
    #[test]
    fn naive_entry_covers_event_at_same_wall_time() {
        let conn = setup_conv_db();
        insert_event(&conn, "Standup", "2026-06-02T09:00:00", "2026-06-02T09:30:00");
        conn.execute(
            "INSERT INTO time_entries (id, start_time, end_time, duration, source)
             VALUES ('t1', '2026-06-02T09:00:00', '2026-06-02T09:30:00', 1800, 'manual')",
            [],
        )
        .unwrap();

        let events =
            query_uncovered_events(&conn, "2026-06-02T00:00:00", "2026-06-02T23:59:59").unwrap();
        assert!(events.is_empty(), "naive entry at same wall time covers the event");
    }

    // (b) Conversion creates a time_entry with correct start/end/title/project.
    #[test]
    fn convert_creates_entry_with_correct_fields() {
        let conn = setup_conv_db();
        let id = insert_event(&conn, "Kundemoede", "2026-06-02T10:00:00", "2026-06-02T11:00:00");

        let (entry, _) = convert_calendar_event_core(&conn, id, Some("p1".into())).unwrap();

        assert_eq!(entry.start_time, "2026-06-02T10:00:00");
        assert_eq!(entry.end_time.as_deref(), Some("2026-06-02T11:00:00"));
        assert_eq!(entry.description.as_deref(), Some("Kundemoede"));
        assert_eq!(entry.project_id.as_deref(), Some("p1"));
        assert_eq!(entry.duration, Some(3600));
    }

    // (c) After conversion the same event is no longer uncovered — the core
    // double-registration guard: it can never be converted twice.
    #[test]
    fn converted_event_is_no_longer_uncovered() {
        let conn = setup_conv_db();
        let id = insert_event(&conn, "Kundemoede", "2026-06-02T10:00:00", "2026-06-02T11:00:00");

        let before =
            query_uncovered_events(&conn, "2026-06-02T00:00:00", "2026-06-02T23:59:59").unwrap();
        assert_eq!(before.len(), 1, "event is uncovered before conversion");

        convert_calendar_event_core(&conn, id, Some("p1".into())).unwrap();

        let after =
            query_uncovered_events(&conn, "2026-06-02T00:00:00", "2026-06-02T23:59:59").unwrap();
        assert!(after.is_empty(), "event must disappear after conversion (no double-registration)");
    }

    // Write-time idempotency: a second conversion of the same event (e.g. a
    // bulk run racing an individual click) must be rejected, not silently create
    // a second time entry + second klippekort deduction.
    #[test]
    fn second_conversion_of_same_event_is_rejected() {
        let conn = setup_conv_db();
        let id = insert_event(&conn, "Kundemoede", "2026-06-02T10:00:00", "2026-06-02T11:00:00");

        convert_calendar_event_core(&conn, id, Some("p1".into())).unwrap();
        let err = match convert_calendar_event_core(&conn, id, Some("p1".into())) {
            Err(e) => e,
            Ok(_) => panic!("second conversion must be rejected"),
        };
        assert!(err.contains("allerede"), "clear already-logged error: {err}");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM time_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "exactly one time entry for one meeting");
    }

    // An all-day / zero-length event (end == start) is still covered after
    // conversion via the exact-start clause, not the interval-overlap clause.
    #[test]
    fn zero_length_event_is_covered_after_conversion() {
        let conn = setup_conv_db();
        let id = insert_event(&conn, "Heldags", "2026-06-03T00:00:00", "2026-06-03T00:00:00");

        convert_calendar_event_core(&conn, id, Some("p1".into())).unwrap();

        let after =
            query_uncovered_events(&conn, "2026-06-03T00:00:00", "2026-06-03T23:59:59").unwrap();
        assert!(after.is_empty(), "zero-length event covered by exact-start match");
    }

    // (d) Klippekort deduction triggers when the matched project is covered.
    #[test]
    fn convert_deducts_klippekort_when_project_covered() {
        let conn = setup_conv_db();
        let kid = insert_klippekort(&conn, 10.0);
        let id = insert_event(&conn, "Kundemoede", "2026-06-02T10:00:00", "2026-06-02T11:00:00");

        let (entry, _) = convert_calendar_event_core(&conn, id, Some("p1".into())).unwrap();

        // 1 hour was deducted from the project's klippekort.
        let (used, deducted): (f64, f64) = conn
            .query_row(
                "SELECT k.used_hours, t.klippekort_deducted_hours
                 FROM klippekort k JOIN time_entries t ON t.klippekort_id = k.id
                 WHERE k.id = ?1",
                rusqlite::params![kid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(used, 1.0, "klippekort used_hours reflects the 1h meeting");
        assert_eq!(deducted, 1.0, "entry records its exact deduction");
        assert_eq!(entry.klippekort_id.as_deref(), Some(kid.as_str()));
    }

    // Project-guess flow: converting an event remembers title → project, so a
    // later identical event is pre-filled with the same guess.
    #[test]
    fn conversion_remembers_title_to_project_guess() {
        let conn = setup_conv_db();
        let first = insert_event(&conn, "Ugentligt sync", "2026-06-02T10:00:00", "2026-06-02T11:00:00");
        convert_calendar_event_core(&conn, first, Some("p1".into())).unwrap();

        // A second, later event with the same title is uncovered but now guessed.
        insert_event(&conn, "Ugentligt sync", "2026-06-09T10:00:00", "2026-06-09T11:00:00");
        let guess = guess_for_title(&conn, Some("Ugentligt sync")).expect("title should now map to a project");
        let (pid, name, _conf) =
            project_of_match(&conn, &guess).expect("the remembered match still names a live project");
        assert_eq!(pid, "p1");
        assert_eq!(name, "Moeder");
    }

    /// A customer's kickoff, their support round and their monthly review have
    /// no project — that is the whole of a project-less customer's work. A rule
    /// that names the customer must therefore survive the conversion, or the
    /// meeting is registered to nobody even though the app knows who it is with.
    #[test]
    fn conversion_bills_the_customer_a_rule_names() {
        let conn = setup_conv_db();
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
        let id = insert_event(&conn, "Support", "2026-06-02T10:00:00", "2026-06-02T11:00:00");

        let (entry, _) = convert_calendar_event_core(&conn, id, None).unwrap();

        assert_eq!(entry.project_id, None, "the rule names no project");
        assert_eq!(
            entry.client_id.as_deref(),
            Some("c2"),
            "the customer must survive the conversion, or the hour is billed to nobody"
        );
    }

    /// A klippekort is what a project-less customer actually pays with, so the
    /// conversion has to reach it: the deduction is chosen from the customer when
    /// there is no project.
    #[test]
    fn conversion_deducts_a_customer_klippekort_without_a_project() {
        let conn = setup_conv_db();
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
        // A klippekort on the customer, with no project.
        let kid = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO klippekort (id, client_id, project_id, name, total_hours, used_hours, status)
             VALUES (?1, 'c2', NULL, 'Pakke', 10.0, 0, 'active')",
            rusqlite::params![kid],
        )
        .unwrap();
        let id = insert_event(&conn, "Support", "2026-06-02T10:00:00", "2026-06-02T11:00:00");

        let (entry, _) = convert_calendar_event_core(&conn, id, None).unwrap();

        assert_eq!(entry.klippekort_id.as_deref(), Some(kid.as_str()));
        let used: f64 = conn
            .query_row("SELECT used_hours FROM klippekort WHERE id = ?1", rusqlite::params![kid], |r| r.get(0))
            .unwrap();
        assert!((used - 1.0).abs() < 1e-9, "klippekort used_hours reflects the hour, got {used}");
    }

    /// An archived project's customer is not evidence on its own: archiving a
    /// project must not leave a live customer's name on every future entry, but
    /// a customer the rule named in its own right is the user's decision and
    /// stays.
    #[test]
    fn an_archived_project_does_not_leak_its_customer() {
        let conn = setup_conv_db();
        conn.execute("UPDATE projects SET is_archived = 1 WHERE id = 'p1'", [])
            .unwrap();
        // A learned pattern pointing at the archived project.
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id)
             VALUES ('calendar', '%Sync%', 'p1')",
            [],
        )
        .unwrap();

        let m = guess_for_title(&conn, Some("Ugentligt sync")).expect("the pattern still matches");
        assert_eq!(m.project_id, None, "an archived project is not a live attribution");
        assert_eq!(m.client_id, None, "its customer is not a claim of its own");
    }

    /// The flip side: a pattern that names a customer directly is exactly the
    /// "customer without a project" the CEO asked for, and archiving an unrelated
    /// project must not touch it.
    #[test]
    fn a_customer_named_by_a_pattern_survives_archiving() {
        let conn = setup_conv_db();
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c2', 'Kunde uden projekter')",
            [],
        )
        .unwrap();
        conn.execute("UPDATE projects SET is_archived = 1 WHERE id = 'p1'", [])
            .unwrap();
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, client_id)
             VALUES ('calendar', 'Support%', 'c2')",
            [],
        )
        .unwrap();

        let m = guess_for_title(&conn, Some("Support")).expect("the pattern matches");
        assert_eq!(m.project_id, None);
        assert_eq!(m.client_id.as_deref(), Some("c2"));
    }
}
