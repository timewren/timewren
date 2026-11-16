use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectHours {
    pub project_id: Option<String>,
    pub project_name: String,
    pub project_color: String,
    pub hours: f64,
    pub billable_hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientHours {
    pub client_id: Option<String>,
    pub client_name: String,
    pub hours: f64,
    pub billable_hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayHours {
    pub date: String,
    pub hours: f64,
    pub billable_hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUsage {
    pub app_name: String,
    pub total_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportData {
    pub total_hours: f64,
    pub billable_hours: f64,
    pub non_billable_hours: f64,
    pub by_project: Vec<ProjectHours>,
    pub by_client: Vec<ClientHours>,
    pub by_day: Vec<DayHours>,
    pub top_apps: Vec<AppUsage>,
}

/// Aggregate report data from time_entries and activities for a date range.
#[tauri::command]
pub fn get_report_data(
    db: State<'_, Database>,
    from: String,
    to: String,
) -> Result<ReportData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Add time component to make the range inclusive of the entire day
    let from_dt = format!("{}T00:00:00", from);
    let to_dt = format!("{}T23:59:59", to);

    // --- By project ---
    let mut stmt = conn
        .prepare_cached(
            "SELECT t.project_id, COALESCE(p.name, 'Uden projekt'), COALESCE(p.color, '#6b7280'),
                    SUM(t.duration), SUM(CASE WHEN t.is_billable = 1 THEN t.duration ELSE 0 END)
             FROM time_entries t
             LEFT JOIN projects p ON t.project_id = p.id
             WHERE t.start_time >= ?1 AND t.start_time <= ?2
               AND t.duration IS NOT NULL
             GROUP BY t.project_id
             ORDER BY SUM(t.duration) DESC",
        )
        .map_err(|e| e.to_string())?;

    let by_project: Vec<ProjectHours> = stmt
        .query_map(rusqlite::params![from_dt, to_dt], |row| {
            Ok(ProjectHours {
                project_id: row.get(0)?,
                project_name: row.get(1)?,
                project_color: row.get(2)?,
                hours: row.get::<_, i64>(3).unwrap_or(0) as f64 / 3600.0,
                billable_hours: row.get::<_, i64>(4).unwrap_or(0) as f64 / 3600.0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // --- By client ---
    let mut stmt = conn
        .prepare_cached(
            "SELECT t.client_id, COALESCE(c.name, 'Uden klient'),
                    SUM(t.duration), SUM(CASE WHEN t.is_billable = 1 THEN t.duration ELSE 0 END)
             FROM time_entries t
             LEFT JOIN clients c ON t.client_id = c.id
             WHERE t.start_time >= ?1 AND t.start_time <= ?2
               AND t.duration IS NOT NULL
             GROUP BY t.client_id
             ORDER BY SUM(t.duration) DESC",
        )
        .map_err(|e| e.to_string())?;

    let by_client: Vec<ClientHours> = stmt
        .query_map(rusqlite::params![from_dt, to_dt], |row| {
            Ok(ClientHours {
                client_id: row.get(0)?,
                client_name: row.get(1)?,
                hours: row.get::<_, i64>(2).unwrap_or(0) as f64 / 3600.0,
                billable_hours: row.get::<_, i64>(3).unwrap_or(0) as f64 / 3600.0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // --- By day ---
    let mut stmt = conn
        .prepare_cached(
            "SELECT DATE(t.start_time) as day,
                    SUM(t.duration), SUM(CASE WHEN t.is_billable = 1 THEN t.duration ELSE 0 END)
             FROM time_entries t
             WHERE t.start_time >= ?1 AND t.start_time <= ?2
               AND t.duration IS NOT NULL
             GROUP BY day
             ORDER BY day ASC",
        )
        .map_err(|e| e.to_string())?;

    let by_day: Vec<DayHours> = stmt
        .query_map(rusqlite::params![from_dt, to_dt], |row| {
            Ok(DayHours {
                date: row.get(0)?,
                hours: row.get::<_, i64>(1).unwrap_or(0) as f64 / 3600.0,
                billable_hours: row.get::<_, i64>(2).unwrap_or(0) as f64 / 3600.0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // --- Top apps from activities ---
    //
    // time_entries.start_time is a local naive timestamp (see `toLocalDateStr`),
    // so the queries above compare/bucket correctly with the local `from`/`to`
    // bounds. Activities, however, are stored as UTC rfc3339 (privacy
    // convention agreed with billing — activities never change storage format).
    // Comparing a UTC timestamp directly against a local day boundary
    // mis-buckets activities recorded near midnight (e.g. work at 23:30 CET is
    // 21:30 UTC and would leak into the wrong calendar day). Convert the stored
    // UTC value to local time before comparing against the local bounds.
    let mut stmt = conn
        .prepare_cached(
            "SELECT app_name, SUM(duration)
             FROM activities
             WHERE DATETIME(started_at, 'localtime') >= ?1
               AND DATETIME(started_at, 'localtime') <= ?2
               AND is_idle = 0
               AND app_name IS NOT NULL
             GROUP BY app_name
             ORDER BY SUM(duration) DESC
             LIMIT 5",
        )
        .map_err(|e| e.to_string())?;

    let top_apps: Vec<AppUsage> = stmt
        .query_map(rusqlite::params![from_dt, to_dt], |row| {
            Ok(AppUsage {
                app_name: row.get(0)?,
                total_seconds: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // --- Totals ---
    let total_hours: f64 = by_project.iter().map(|p| p.hours).sum();
    let billable_hours: f64 = by_project.iter().map(|p| p.billable_hours).sum();
    let non_billable_hours = total_hours - billable_hours;

    Ok(ReportData {
        total_hours,
        billable_hours,
        non_billable_hours,
        by_project,
        by_client,
        by_day,
        top_apps,
    })
}

/// Outgoing VAT (salgsmoms) for a single VAT rate within a period. All invoices
/// in one bucket share the same `vat_rate`, so `moms = grundlag * vat_rate/100`
/// is exact (identical to summing the VAT per invoice).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VatRateBucket {
    /// The VAT rate in percent (25.0 standard, 0.0 for exempt/momsfri).
    pub vat_rate: f64,
    /// Momsgrundlag: sum of the issued invoices' ex-VAT amount (subtotal).
    pub grundlag: f64,
    /// Salgsmoms (udgående moms): grundlag * vat_rate / 100.
    pub moms: f64,
    /// Number of issued invoices in this bucket.
    pub faktura_antal: i64,
}

/// Quarterly VAT overview for a period: outgoing VAT split per rate plus totals.
/// "At indberette" (the number to report to SKAT) equals `total_moms` — this is
/// outgoing VAT only, no input/purchase VAT and no SKAT integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VatSummary {
    pub by_rate: Vec<VatRateBucket>,
    pub total_grundlag: f64,
    pub total_moms: f64,
    pub total_faktura_antal: i64,
}

/// Aggregate outgoing VAT (salgsmoms) from issued invoices in a date range,
/// split per VAT rate. Read-only aggregation of the user's own invoices — nothing
/// leaves the machine and no activity data is touched.
///
/// An invoice counts as *issued* once it carries a legal `invoice_number` (from
/// `finalize_invoice`) or its status is `sent`/`exported`. Plain drafts are
/// excluded. The period filters on the invoice date (`created_at`), which is the
/// legal faktura date shown on the printed invoice.
#[tauri::command]
pub fn get_vat_summary(
    db: State<'_, Database>,
    from: String,
    to: String,
) -> Result<VatSummary, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    compute_vat_summary(&conn, &from, &to)
}

/// Testable core of [`get_vat_summary`], operating on a plain connection.
pub(crate) fn compute_vat_summary(
    conn: &rusqlite::Connection,
    from: &str,
    to: &str,
) -> Result<VatSummary, String> {
    // Inclusive local-day bounds, same convention as get_report_data / get_coverage.
    let from_dt = format!("{}T00:00:00", from);
    let to_dt = format!("{}T23:59:59", to);

    // invoice_drafts.created_at is stored as a UTC timestamp (rfc3339 from
    // `finalize`/`create`, or `datetime('now')` from the schema default). Convert
    // it to local time before day-bucketing so a late-evening CET invoice (stored
    // as next-day UTC) is not counted in the wrong quarter — the same trap the
    // rest of reports guards against. The bounds are wrapped in DATETIME() too so
    // both sides share the space-separated format for a correct string compare.
    let mut stmt = conn
        .prepare_cached(
            "SELECT vat_rate,
                    COALESCE(SUM(subtotal), 0) AS grundlag,
                    COUNT(*) AS antal
             FROM invoice_drafts
             WHERE DATETIME(created_at, 'localtime') >= DATETIME(?1)
               AND DATETIME(created_at, 'localtime') <= DATETIME(?2)
               AND (
                     (invoice_number IS NOT NULL AND invoice_number != '')
                     OR status IN ('sent', 'exported')
                   )
             GROUP BY vat_rate
             ORDER BY vat_rate DESC",
        )
        .map_err(|e| e.to_string())?;

    let by_rate: Vec<VatRateBucket> = stmt
        .query_map(rusqlite::params![from_dt, to_dt], |row| {
            let vat_rate: f64 = row.get(0)?;
            let grundlag: f64 = row.get(1)?;
            Ok(VatRateBucket {
                vat_rate,
                grundlag,
                moms: grundlag * vat_rate / 100.0,
                faktura_antal: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let total_grundlag: f64 = by_rate.iter().map(|b| b.grundlag).sum();
    let total_moms: f64 = by_rate.iter().map(|b| b.moms).sum();
    let total_faktura_antal: i64 = by_rate.iter().map(|b| b.faktura_antal).sum();

    Ok(VatSummary {
        by_rate,
        total_grundlag,
        total_moms,
        total_faktura_antal,
    })
}

/// Registration coverage for a single local calendar day: how much active screen
/// time (activities, is_idle=0) was actually captured as registered time
/// (time_entries) that day.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageDay {
    pub date: String,
    pub active_seconds: i64,
    pub tracked_seconds: i64,
    /// tracked / active * 100. Can exceed 100 (e.g. an offline meeting registered
    /// while the machine was idle); the frontend clamps the bar, not the value.
    pub coverage_pct: f64,
}

/// A contiguous block of active-but-unregistered screen time for one
/// (app, project), with an estimated billable amount via the project → client →
/// global rate hierarchy. `start_time`/`end_time` span exactly the block's member
/// activities (end − start ≈ Σ duration), so a time entry created from it renders
/// correctly in the calendar and covers every member (persistent dedup).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnregisteredBlock {
    pub app_name: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub client_id: Option<String>,
    /// The customer's name, so a block billed to a customer with no project can
    /// still say who it is for. The user confirms the amount by clicking, and an
    /// amount with no visible owner is an amount they cannot judge.
    pub client_name: Option<String>,
    pub date: String,
    /// Local-naive timestamps (`YYYY-MM-DDTHH:MM:SS`), matching how the manual
    /// entry form stores time so create_time_entry, calendar rendering and the
    /// coverage dedup guard all share one timezone frame.
    pub start_time: String,
    pub end_time: String,
    pub seconds: i64,
    pub hours: f64,
    pub rate: f64,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageData {
    pub by_day: Vec<CoverageDay>,
    pub unregistered_blocks: Vec<UnregisteredBlock>,
    pub total_active_hours: f64,
    pub total_tracked_hours: f64,
    pub total_unregistered_hours: f64,
    pub total_unregistered_amount: f64,
}

/// Max pause (seconds) between adjacent activities that still merge into one
/// contiguous block. Mirrors the frontend `activity_merge_gap_seconds` setting
/// (and its 180s default) so coverage blocks match the timeline/calendar view.
fn merge_gap_seconds(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'activity_merge_gap_seconds'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.trim().parse::<i64>().ok())
    .filter(|n| *n >= 0)
    .unwrap_or(180)
}

/// Parse a stored activity timestamp (UTC rfc3339) to unix seconds, for gap math.
/// Returns None on unparseable input so the caller treats the gap as infinite
/// (start a fresh block) rather than silently merging unrelated runs.
fn parse_ts(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp())
}

/// Convert a stored activity timestamp (UTC rfc3339) to a local-naive string,
/// matching the manual entry form's `YYYY-MM-DDTHH:MM:SS` format. Falls back to
/// the raw value if it cannot be parsed.
fn to_local_naive(s: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| {
            dt.with_timezone(&chrono::Local)
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|_| s.to_string())
}

/// Detect the gap between active screen time and registered time.
///
/// Everything here is pure local SQL — no AI, no network. Activity data never
/// leaves the machine; only the aggregated coverage numbers are returned for
/// local display.
///
/// Timezone handling mirrors `get_report_data` exactly: `time_entries.start_time`
/// is a local-naive timestamp and is bucketed with `DATE(start_time)`, while
/// `activities.started_at` is stored as UTC rfc3339 and must be converted with
/// `DATETIME(started_at, 'localtime')` before day-bucketing so CET evening work
/// (e.g. 23:30 CET = 21:30 UTC) is not counted on the wrong calendar day.
#[tauri::command]
pub fn get_coverage(
    db: State<'_, Database>,
    from: String,
    to: String,
    min_block_minutes: Option<i64>,
) -> Result<CoverageData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    compute_coverage(&conn, &from, &to, min_block_minutes)
}

/// Testable core of [`get_coverage`], operating on a plain connection.
pub(crate) fn compute_coverage(
    conn: &rusqlite::Connection,
    from: &str,
    to: &str,
    min_block_minutes: Option<i64>,
) -> Result<CoverageData, String> {
    // Inclusive local-day bounds, same convention as get_report_data.
    let from_dt = format!("{}T00:00:00", from);
    let to_dt = format!("{}T23:59:59", to);

    // Threshold in seconds; default 15 min, never negative.
    let threshold_seconds = min_block_minutes.unwrap_or(15).max(0) * 60;

    // Final fallback in the project → client → global rate hierarchy.
    let default_rate = crate::commands::invoices::global_default_rate(conn);
    let gap_limit = merge_gap_seconds(conn);

    // --- Active screen time per local day (activities, is_idle=0, UTC→local) ---
    let mut active_by_day: std::collections::BTreeMap<String, (i64, i64)> =
        std::collections::BTreeMap::new();
    {
        let mut stmt = conn
            .prepare_cached(
                // Bounds are wrapped in DATETIME() too, so both sides share the
                // space-separated format — a bare `T`-separated bound would sort
                // before same-date local timestamps and drop the from-day.
                "SELECT DATE(DATETIME(started_at, 'localtime')) AS day, SUM(duration)
                 FROM activities
                 WHERE DATETIME(started_at, 'localtime') >= DATETIME(?1)
                   AND DATETIME(started_at, 'localtime') <= DATETIME(?2)
                   AND is_idle = 0
                 GROUP BY day",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![from_dt, to_dt], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1).unwrap_or(0)))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (day, secs) = r.map_err(|e| e.to_string())?;
            active_by_day.entry(day).or_insert((0, 0)).0 = secs;
        }
    }

    // --- Registered time per local day (time_entries, local-naive start_time) ---
    {
        let mut stmt = conn
            .prepare_cached(
                "SELECT DATE(start_time) AS day, SUM(duration)
                 FROM time_entries
                 WHERE start_time >= ?1 AND start_time <= ?2
                   AND duration IS NOT NULL
                 GROUP BY day",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![from_dt, to_dt], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1).unwrap_or(0)))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (day, secs) = r.map_err(|e| e.to_string())?;
            // Only track coverage for days that have active screen time — a day
            // with registrations but no activity has no gap to detect and would
            // divide by zero.
            if let Some(entry) = active_by_day.get_mut(&day) {
                entry.1 = secs;
            }
        }
    }

    let by_day: Vec<CoverageDay> = active_by_day
        .into_iter()
        .filter(|(_, (active, _))| *active > 0)
        .map(|(date, (active, tracked))| CoverageDay {
            date,
            active_seconds: active,
            tracked_seconds: tracked,
            coverage_pct: tracked as f64 / active as f64 * 100.0,
        })
        .collect();

    // --- Unregistered blocks ---
    //
    // Fetch unconfirmed, active activities in range, sorted by start, EXCLUDING
    // any activity that already overlaps an existing time entry. The dedup guard
    // compares both sides in local wall-clock: activities are converted with
    // `'localtime'`, and time_entries are wrapped in DATETIME() to normalise
    // their local-naive value (strip the `T`) so a bare string compare is exact.
    // Because a block registered from here spans all its members, every member
    // then overlaps that entry and the whole block disappears on the next fetch —
    // it can never be registered twice.
    //
    // The customer comes from the activity, not only from its project: a
    // customer's own portal, their support inbox and their kickoff calls are
    // billable work that has no project, and it is exactly the work a customer
    // with no projects at all has. The project still wins when it names one
    // (one way only) so a block can never name two customers.
    struct Row {
        app_name: String,
        project_id: Option<String>,
        project_name: Option<String>,
        client_id: Option<String>,
        client_name: Option<String>,
        started_at: String,
        ended_at: String,
        start_ts: Option<i64>,
        end_ts: Option<i64>,
        duration: i64,
        rate: f64,
    }

    let mut stmt = conn
        .prepare_cached(
            "SELECT a.app_name, a.project_id, p.name,
                    COALESCE(p.client_id, a.client_id), c.name,
                    a.started_at,
                    COALESCE(a.ended_at, a.started_at) AS ended_at,
                    a.duration,
                    COALESCE(p.hourly_rate, c.hourly_rate, ?3) AS rate
             FROM activities a
             LEFT JOIN projects p ON a.project_id = p.id
             LEFT JOIN clients c ON COALESCE(p.client_id, a.client_id) = c.id
             WHERE DATETIME(a.started_at, 'localtime') >= DATETIME(?1)
               AND DATETIME(a.started_at, 'localtime') <= DATETIME(?2)
               AND a.is_idle = 0
               AND a.is_confirmed = 0
               AND a.app_name IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM time_entries te
                   WHERE te.end_time IS NOT NULL
                     AND DATETIME(te.start_time) < DATETIME(COALESCE(a.ended_at, a.started_at), 'localtime')
                     AND DATETIME(te.end_time)   > DATETIME(a.started_at, 'localtime')
               )
             ORDER BY a.started_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<Row> = stmt
        .query_map(rusqlite::params![from_dt, to_dt, default_rate], |row| {
            let started_at: String = row.get(5)?;
            let ended_at: String = row.get(6)?;
            Ok(Row {
                app_name: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                client_id: row.get(3)?,
                client_name: row.get(4)?,
                start_ts: parse_ts(&started_at),
                end_ts: parse_ts(&ended_at),
                started_at,
                ended_at,
                duration: row.get::<_, i64>(7).unwrap_or(0),
                rate: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Fold neighbouring rows for the same (app, project) into contiguous blocks
    // when the pause between them is within the merge gap.
    struct Seg {
        app_name: String,
        project_id: Option<String>,
        project_name: Option<String>,
        client_id: Option<String>,
        client_name: Option<String>,
        start: String,
        end: String,
        end_ts: Option<i64>,
        seconds: i64,
        rate: f64,
    }
    let mut segs: Vec<Seg> = Vec::new();
    for r in rows {
        if let Some(cur) = segs.last_mut() {
            // The customer is part of the identity of a block: two activities in
            // the same app with no project but a different customer are two
            // billable truths, and merging them would hand the second one's
            // time to the first one's customer.
            let same =
                cur.app_name == r.app_name && cur.project_id == r.project_id && cur.client_id == r.client_id;
            let gap_ok = match (cur.end_ts, r.start_ts) {
                (Some(e), Some(s)) => s - e <= gap_limit,
                _ => false,
            };
            if same && gap_ok {
                cur.seconds += r.duration;
                // Extend the block end if this member runs later.
                let extend = match (cur.end_ts, r.end_ts) {
                    (Some(e), Some(ne)) => ne > e,
                    _ => true,
                };
                if extend {
                    cur.end = r.ended_at;
                    cur.end_ts = r.end_ts;
                }
                continue;
            }
        }
        segs.push(Seg {
            app_name: r.app_name,
            project_id: r.project_id,
            project_name: r.project_name,
            client_id: r.client_id,
            client_name: r.client_name,
            start: r.started_at,
            end: r.ended_at,
            end_ts: r.end_ts,
            seconds: r.duration,
            rate: r.rate,
        });
    }

    // Keep only blocks over the threshold; emit local-naive boundaries.
    let mut unregistered_blocks: Vec<UnregisteredBlock> = segs
        .into_iter()
        .filter(|s| s.seconds >= threshold_seconds)
        .map(|s| {
            let hours = s.seconds as f64 / 3600.0;
            let start_time = to_local_naive(&s.start);
            let date = start_time.get(0..10).unwrap_or("").to_string();
            UnregisteredBlock {
                app_name: s.app_name,
                project_id: s.project_id,
                project_name: s.project_name,
                client_id: s.client_id,
                client_name: s.client_name,
                date,
                start_time,
                end_time: to_local_naive(&s.end),
                seconds: s.seconds,
                hours,
                rate: s.rate,
                amount: hours * s.rate,
            }
        })
        .collect();

    // Largest blocks first, capped.
    unregistered_blocks.sort_by_key(|b| std::cmp::Reverse(b.seconds));
    unregistered_blocks.truncate(20);

    let total_active_hours: f64 =
        by_day.iter().map(|d| d.active_seconds as f64).sum::<f64>() / 3600.0;
    let total_tracked_hours: f64 =
        by_day.iter().map(|d| d.tracked_seconds as f64).sum::<f64>() / 3600.0;
    let total_unregistered_hours: f64 = unregistered_blocks.iter().map(|b| b.hours).sum();
    let total_unregistered_amount: f64 = unregistered_blocks.iter().map(|b| b.amount).sum();

    Ok(CoverageData {
        by_day,
        unregistered_blocks,
        total_active_hours,
        total_tracked_hours,
        total_unregistered_hours,
        total_unregistered_amount,
    })
}

/// Counts unclassified browser activities in the last `days` local days: active
/// (`is_idle = 0`), still unassigned (`project_id IS NULL`) and unconfirmed
/// (`is_confirmed = 0`) activities whose foreground app is a known browser.
///
/// Powers the timeline "precision tip" that nudges the user to enable the opt-in
/// `browser_url_capture` setting for better project recognition. Read-only and
/// privacy-safe: it only counts rows, never reads or returns any URL.
#[tauri::command]
pub fn count_unclassified_browser_activities(
    db: State<'_, Database>,
    days: i64,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    compute_unclassified_browser_count(&conn, days)
}

/// Testable core of [`count_unclassified_browser_activities`], on a plain conn.
pub(crate) fn compute_unclassified_browser_count(
    conn: &rusqlite::Connection,
    days: i64,
) -> Result<i64, String> {
    // A non-positive window is meaningless; fall back to the 7-day default.
    let days = if days <= 0 { 7 } else { days };
    let modifier = format!("-{days} days");

    // Single source of truth for browser executables (tracker::BROWSER_APPS).
    // The list is a fixed set of hard-coded literals — no user input — so
    // interpolating it into the LIKE clause carries no injection risk.
    let browser_clause = crate::tracker::BROWSER_APPS
        .iter()
        .map(|b| format!("LOWER(app_name) LIKE '%{b}%'"))
        .collect::<Vec<_>>()
        .join(" OR ");

    // started_at is stored UTC rfc3339; convert to localtime before comparing
    // against the local-day window, matching the rest of reports.rs.
    let sql = format!(
        "SELECT COUNT(*) FROM activities
         WHERE is_idle = 0
           AND is_confirmed = 0
           AND project_id IS NULL
           AND app_name IS NOT NULL
           AND DATETIME(started_at, 'localtime') >= DATETIME('now', 'localtime', ?1)
           AND ({browser_clause})"
    );

    let count: i64 = conn
        .query_row(&sql, rusqlite::params![modifier], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        // Client with a rate, a project that overrides it, and a project without
        // a rate (falls back to the client rate).
        conn.execute(
            "INSERT INTO clients (id, name, hourly_rate) VALUES ('c1', 'Acme', 800)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projects (id, client_id, name, hourly_rate) VALUES ('p1', 'c1', 'Rated', 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES ('p2', 'c1', 'Unrated')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('default_hourly_rate', '500')",
            [],
        )
        .unwrap();
        conn
    }

    /// Inserts an activity, deriving `ended_at = started_at + duration` so blocks
    /// span exactly their members (as the real tracker records them).
    fn insert_activity(
        conn: &Connection,
        app: &str,
        project_id: Option<&str>,
        started_at: &str,
        duration: i64,
        is_idle: i64,
        is_confirmed: i64,
    ) {
        let ended_at = chrono::DateTime::parse_from_rfc3339(started_at)
            .map(|dt| (dt + chrono::Duration::seconds(duration)).to_rfc3339())
            .unwrap_or_else(|_| started_at.to_string());
        conn.execute(
            "INSERT INTO activities (app_name, project_id, started_at, ended_at, duration, is_idle, is_confirmed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![app, project_id, started_at, ended_at, duration, is_idle, is_confirmed],
        )
        .unwrap();
    }

    /// The same activity, but carrying a customer of its own — the shape the
    /// tracker now stores for a customer's portal, their inbox or their
    /// kickoff call, none of which has a project.
    fn insert_activity_with_client(
        conn: &Connection,
        app: &str,
        client_id: Option<&str>,
        started_at: &str,
        duration: i64,
    ) {
        let ended_at = chrono::DateTime::parse_from_rfc3339(started_at)
            .map(|dt| (dt + chrono::Duration::seconds(duration)).to_rfc3339())
            .unwrap_or_else(|_| started_at.to_string());
        conn.execute(
            "INSERT INTO activities (app_name, project_id, client_id, started_at, ended_at, duration, is_idle, is_confirmed)
             VALUES (?1, NULL, ?2, ?3, ?4, ?5, 0, 0)",
            rusqlite::params![app, client_id, started_at, ended_at, duration],
        )
        .unwrap();
    }

    fn insert_time_entry(conn: &Connection, start_time: &str, duration: i64) {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO time_entries (id, start_time, duration, source) VALUES (?1, ?2, ?3, 'manual')",
            rusqlite::params![id, start_time, duration],
        )
        .unwrap();
    }

    /// A completed time entry with an explicit [start,end] span (local-naive),
    /// as produced by the manual form and the coverage "Opret registrering" button.
    fn insert_time_entry_range(conn: &Connection, start_time: &str, end_time: &str, duration: i64) {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO time_entries (id, start_time, end_time, duration, source)
             VALUES (?1, ?2, ?3, ?4, 'manual')",
            rusqlite::params![id, start_time, end_time, duration],
        )
        .unwrap();
    }

    fn span_seconds(block: &UnregisteredBlock) -> i64 {
        let start =
            chrono::NaiveDateTime::parse_from_str(&block.start_time, "%Y-%m-%dT%H:%M:%S").unwrap();
        let end =
            chrono::NaiveDateTime::parse_from_str(&block.end_time, "%Y-%m-%dT%H:%M:%S").unwrap();
        (end - start).num_seconds()
    }

    /// Builds a fixed dataset on a single local day. Activities are stored UTC
    /// (with Z) at 09:00 so localtime-bucketing lands on the same date across any
    /// realistic test-machine timezone; time_entries are local-naive per the
    /// storage convention. Distinct app names → each is its own contiguous block.
    fn seed_known_day(conn: &Connection) {
        // Active, unregistered work (is_idle=0, is_confirmed=0):
        insert_activity(conn, "Code", Some("p1"), "2026-06-02T09:00:00Z", 5400, 0, 0); // 1.5h, project rate 1000
        insert_activity(conn, "Chrome", None, "2026-06-02T09:10:00Z", 3600, 0, 0); // 1.0h, global rate 500
        insert_activity(
            conn,
            "Terminal",
            Some("p2"),
            "2026-06-02T09:20:00Z",
            1800,
            0,
            0,
        ); // 0.5h, client rate 800
        insert_activity(conn, "Slack", None, "2026-06-02T09:30:00Z", 600, 0, 0); // 10 min — below 15-min threshold
                                                                                 // Active but already confirmed → counts as active time, not an unregistered block.
        insert_activity(conn, "Figma", None, "2026-06-02T09:40:00Z", 3600, 0, 1);
        // Idle → excluded from active time entirely.
        insert_activity(conn, "Idle", None, "2026-06-02T09:50:00Z", 3600, 1, 0);
        // Registered time that day: 2h (no explicit span → does not cover activities).
        insert_time_entry(conn, "2026-06-02T09:00:00", 7200);
    }

    fn run(seed: impl Fn(&Connection), min_block: Option<i64>) -> CoverageData {
        let conn = setup();
        seed(&conn);
        compute_coverage(&conn, "2026-06-01", "2026-06-03", min_block).unwrap()
    }

    /// The core acceptance criterion: active time, registered time and coverage %
    /// per day, plus the unregistered blocks with correct hours and kr amounts via
    /// the project → client → global rate hierarchy.
    #[test]
    fn coverage_computes_active_tracked_and_percent() {
        let data = run(seed_known_day, None);

        // One local day with active screen time.
        assert_eq!(data.by_day.len(), 1, "single day with activity");
        let day = &data.by_day[0];
        // Active = Code 5400 + Chrome 3600 + Terminal 1800 + Slack 600 + Figma 3600
        //        = 15000s (idle 3600 excluded).
        assert_eq!(day.active_seconds, 15000);
        assert_eq!(day.tracked_seconds, 7200);
        assert!(
            (day.coverage_pct - 48.0).abs() < 1e-9,
            "7200/15000 = 48%, got {}",
            day.coverage_pct
        );

        // Blocks over the default 15-min threshold, largest first. Slack (10 min)
        // and the confirmed Figma / idle activities are excluded.
        assert_eq!(data.unregistered_blocks.len(), 3);

        let code = &data.unregistered_blocks[0];
        assert_eq!(code.app_name, "Code");
        assert_eq!(code.seconds, 5400);
        assert!((code.hours - 1.5).abs() < 1e-9);
        assert!((code.rate - 1000.0).abs() < 1e-9, "project rate wins");
        assert!((code.amount - 1500.0).abs() < 1e-9);
        assert_eq!(code.project_id.as_deref(), Some("p1"));

        let chrome = &data.unregistered_blocks[1];
        assert_eq!(chrome.app_name, "Chrome");
        assert_eq!(chrome.seconds, 3600);
        assert!(
            (chrome.rate - 500.0).abs() < 1e-9,
            "falls back to global rate"
        );
        assert!((chrome.amount - 500.0).abs() < 1e-9);
        assert_eq!(chrome.project_id, None);

        let terminal = &data.unregistered_blocks[2];
        assert_eq!(terminal.app_name, "Terminal");
        assert_eq!(terminal.seconds, 1800);
        assert!(
            (terminal.rate - 800.0).abs() < 1e-9,
            "falls back to client rate"
        );
        assert!((terminal.amount - 400.0).abs() < 1e-9);

        // Totals over the three blocks.
        assert!((data.total_unregistered_hours - 3.0).abs() < 1e-9);
        assert!((data.total_unregistered_amount - 2400.0).abs() < 1e-9);
    }

    /// The threshold is configurable: lowering it below Slack's 10 minutes must
    /// surface Slack as a fourth block.
    #[test]
    fn lower_threshold_includes_smaller_blocks() {
        let data = run(seed_known_day, Some(5));
        assert_eq!(data.unregistered_blocks.len(), 4);
        assert!(
            data.unregistered_blocks
                .iter()
                .any(|b| b.app_name == "Slack"),
            "Slack (10 min) is included at a 5-min threshold"
        );
    }

    /// A day with registrations but zero active screen time is omitted (no gap to
    /// detect, and it must never divide by zero).
    #[test]
    fn day_without_active_time_is_omitted() {
        let data = run(
            |conn| {
                // Only a registration, no activities at all.
                insert_time_entry(conn, "2026-06-02T09:00:00", 3600);
            },
            None,
        );
        assert!(data.by_day.is_empty());
        assert!(data.unregistered_blocks.is_empty());
    }

    /// Regression against double-registration: an activity that temporally
    /// overlaps an existing time entry must NOT be reported as unregistered, so a
    /// block created here can never be registered a second time. A same-app
    /// activity on another day (uncovered) still appears — the guard is selective.
    #[test]
    fn activity_overlapping_time_entry_is_excluded() {
        let data = run(
            |conn| {
                insert_activity(conn, "Code", None, "2026-06-01T09:00:00Z", 3600, 0, 0);
                insert_activity(conn, "Code", None, "2026-06-02T09:00:00Z", 3600, 0, 0);
                // A registration covering all of 2026-06-02 (local) overlaps only
                // the 06-02 activity.
                insert_time_entry_range(conn, "2026-06-02T00:00:00", "2026-06-02T23:59:59", 3600);
            },
            None,
        );

        let dates: Vec<&str> = data
            .unregistered_blocks
            .iter()
            .map(|b| b.date.as_str())
            .collect();
        assert!(
            data.unregistered_blocks
                .iter()
                .any(|b| b.date == "2026-06-01"),
            "uncovered activity still appears, got {dates:?}"
        );
        assert!(
            !data
                .unregistered_blocks
                .iter()
                .any(|b| b.date == "2026-06-02"),
            "activity overlapping a time entry must be excluded, got {dates:?}"
        );
    }

    /// Non-contiguous activity for the same app on the same day yields SEPARATE
    /// blocks (not one inflated full-day span), and each block's end − start
    /// equals its summed duration.
    #[test]
    fn noncontiguous_same_app_yields_separate_blocks() {
        let data = run(
            |conn| {
                // Two runs 4.5h apart — well over the merge gap.
                insert_activity(conn, "Code", None, "2026-06-02T09:00:00Z", 1800, 0, 0);
                insert_activity(conn, "Code", None, "2026-06-02T14:00:00Z", 1200, 0, 0);
            },
            None,
        );

        assert_eq!(
            data.unregistered_blocks.len(),
            2,
            "two separate runs, not one full-day block"
        );
        for b in &data.unregistered_blocks {
            assert_eq!(
                span_seconds(b),
                b.seconds,
                "block span equals its duration (no full-day inflation)"
            );
        }
    }

    /// Insert an invoice with an explicit VAT rate, subtotal and issued-state.
    /// `issued` controls whether it counts: an issued invoice either carries an
    /// invoice_number or has status sent/exported.
    fn insert_invoice(
        conn: &Connection,
        id: &str,
        vat_rate: f64,
        subtotal: f64,
        created_at: &str,
        status: &str,
        invoice_number: Option<&str>,
    ) {
        let total = subtotal * (1.0 + vat_rate / 100.0);
        conn.execute(
            "INSERT INTO invoice_drafts (id, client_id, status, subtotal, vat_rate, total, invoice_number, created_at, updated_at)
             VALUES (?1, 'c1', ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            rusqlite::params![id, status, subtotal, vat_rate, total, invoice_number, created_at],
        )
        .unwrap();
    }

    /// The core acceptance criterion: outgoing VAT (salgsmoms) and momsgrundlag
    /// split per rate over a mixed-rate quarter, with correct totals — and drafts
    /// (no number, not sent/exported) excluded.
    #[test]
    fn vat_summary_splits_per_rate_and_excludes_drafts() {
        let conn = setup();

        // Two issued 25% invoices in Q2 (one finalised with a number, one exported).
        insert_invoice(&conn, "i1", 25.0, 100000.0, "2026-04-15T10:00:00Z", "sent", Some("2026-001"));
        insert_invoice(&conn, "i2", 25.0, 40000.0, "2026-05-20T10:00:00Z", "exported", None);
        // One issued 0% (momsfri) invoice in Q2.
        insert_invoice(&conn, "i3", 0.0, 5000.0, "2026-06-01T10:00:00Z", "sent", Some("2026-002"));
        // A plain draft in Q2 — must NOT count (no number, status draft).
        insert_invoice(&conn, "i4", 25.0, 999999.0, "2026-06-10T10:00:00Z", "draft", None);
        // An issued invoice OUTSIDE the quarter (Q3) — must NOT count.
        insert_invoice(&conn, "i5", 25.0, 12345.0, "2026-07-02T10:00:00Z", "sent", Some("2026-003"));

        let s = compute_vat_summary(&conn, "2026-04-01", "2026-06-30").unwrap();

        // Two buckets: 25% and 0%, ordered by rate desc.
        assert_eq!(s.by_rate.len(), 2, "one bucket per distinct rate");

        let b25 = &s.by_rate[0];
        assert!((b25.vat_rate - 25.0).abs() < 1e-9);
        assert!((b25.grundlag - 140000.0).abs() < 1e-6, "100000 + 40000");
        assert!((b25.moms - 35000.0).abs() < 1e-6, "140000 * 25% = 35000");
        assert_eq!(b25.faktura_antal, 2);

        let b0 = &s.by_rate[1];
        assert!((b0.vat_rate - 0.0).abs() < 1e-9);
        assert!((b0.grundlag - 5000.0).abs() < 1e-6);
        assert!((b0.moms - 0.0).abs() < 1e-9, "momsfri = 0 salgsmoms");
        assert_eq!(b0.faktura_antal, 1);

        // Totals span both rates; the draft (999999) and Q3 invoice are excluded.
        assert!((s.total_grundlag - 145000.0).abs() < 1e-6);
        assert!((s.total_moms - 35000.0).abs() < 1e-6, "at indberette");
        assert_eq!(s.total_faktura_antal, 3);
    }

    /// Adjacent activities for the same app within the merge gap fold into one
    /// block whose span covers its members plus only the small inter-run gap.
    #[test]
    fn contiguous_activities_merge_into_one_block() {
        let data = run(
            |conn| {
                // Two 10-min runs, 2-min pause between them (< 180s default gap).
                insert_activity(conn, "Code", None, "2026-06-02T09:00:00Z", 600, 0, 0);
                insert_activity(conn, "Code", None, "2026-06-02T09:12:00Z", 600, 0, 0);
            },
            None,
        );

        assert_eq!(data.unregistered_blocks.len(), 1, "adjacent runs merge");
        let b = &data.unregistered_blocks[0];
        assert_eq!(b.seconds, 1200, "sum of member durations");
        // 09:00 → 09:22 = 1320s; excess over duration is just the 120s pause.
        assert_eq!(span_seconds(b), 1320);
        assert!(
            span_seconds(b) - b.seconds <= 180,
            "excess over duration is within the merge gap"
        );
    }

    /// A customer without a project is the whole reason `activities.client_id`
    /// exists, and an unregistered block is a real billable offer: if the block
    /// loses the customer, the user registers the block and the entry lands on
    /// nobody — the exact work a project-less customer is paying for.
    #[test]
    fn unregistered_block_takes_customer_from_the_activity() {
        let data = run(
            |conn| {
                // A second customer, with its own rate, so the amount proves
                // which customer the block followed.
                conn.execute(
                    "INSERT INTO clients (id, name, hourly_rate) VALUES ('c2', 'Kunde uden projekter', 1200)",
                    [],
                )
                .unwrap();
                insert_activity_with_client(
                    conn,
                    "Portal",
                    Some("c2"),
                    "2026-06-02T09:00:00Z",
                    3600,
                );
            },
            None,
        );

        assert_eq!(data.unregistered_blocks.len(), 1);
        let b = &data.unregistered_blocks[0];
        assert_eq!(b.project_id, None, "there is no project to take it from");
        assert_eq!(
            b.client_id.as_deref(),
            Some("c2"),
            "the customer comes from the activity, not only from a project"
        );
        assert!(
            (b.rate - 1200.0).abs() < 1e-9,
            "the customer's own rate applies, got {}",
            b.rate
        );
        assert!((b.amount - 1200.0).abs() < 1e-9);
        assert_eq!(
            b.client_name.as_deref(),
            Some("Kunde uden projekter"),
            "the block has to name its customer — the user confirms the amount by clicking"
        );
    }

    /// The project still wins when it names a customer of its own, so a block can
    /// never name two customers and bill the wrong one.
    #[test]
    fn a_projects_customer_outranks_the_activities_own() {
        let data = run(
            |conn| {
                conn.execute(
                    "INSERT INTO clients (id, name, hourly_rate) VALUES ('c2', 'Anden kunde', 1200)",
                    [],
                )
                .unwrap();
                // Activity on p1 (→ c1, rate 800) but tagged c2 — the project is
                // the stronger claim, exactly as everywhere else in the app.
                conn.execute(
                    "INSERT INTO activities (app_name, project_id, client_id, started_at, duration, is_idle, is_confirmed)
                     VALUES ('Code', 'p1', 'c2', '2026-06-02T09:00:00Z', 3600, 0, 0)",
                    [],
                )
                .unwrap();
            },
            None,
        );

        let b = &data.unregistered_blocks[0];
        assert_eq!(b.client_id.as_deref(), Some("c1"));
    }

    /// Two customers working in the same app, back to back, are two billable
    /// truths. Merging them would hand the second one's time to the first one's
    /// customer, so the customer is part of a block's identity.
    #[test]
    fn blocks_of_two_customers_do_not_merge() {
        let data = run(
            |conn| {
                conn.execute(
                    "INSERT INTO clients (id, name, hourly_rate) VALUES ('c2', 'Anden kunde', 1200)",
                    [],
                )
                .unwrap();
                // 30 minutes for c1, a 2-minute pause, 30 minutes for c2 — the
                // pause is well inside the 3-minute merge gap and both clear the
                // 15-minute block threshold, so the only thing keeping them
                // apart is the customer.
                insert_activity_with_client(
                    conn,
                    "Portal",
                    Some("c1"),
                    "2026-06-02T09:00:00Z",
                    1800,
                );
                insert_activity_with_client(
                    conn,
                    "Portal",
                    Some("c2"),
                    "2026-06-02T09:32:00Z",
                    1800,
                );
            },
            None,
        );

        assert_eq!(
            data.unregistered_blocks.len(),
            2,
            "two customers must not become one block"
        );
        let customers: Vec<&str> = data
            .unregistered_blocks
            .iter()
            .map(|b| b.client_id.as_deref().expect("each block names a customer"))
            .collect();
        assert!(customers.contains(&"c1") && customers.contains(&"c2"));
    }

    /// The precision-tip gate: count only active, unassigned, unconfirmed browser
    /// activities inside the window. Editors, classified/confirmed/idle browser
    /// rows and browser rows older than the window are all excluded.
    #[test]
    fn counts_only_unclassified_browser_activities_in_window() {
        let conn = setup();
        let now = chrono::Utc::now();
        let recent = (now - chrono::Duration::hours(2)).to_rfc3339();
        let old = (now - chrono::Duration::days(30)).to_rfc3339();

        // Counted: active, unassigned, unconfirmed browsers within the window.
        insert_activity(&conn, "vivaldi.exe", None, &recent, 600, 0, 0);
        insert_activity(&conn, "chrome", None, &recent, 600, 0, 0);
        insert_activity(&conn, "msedge.exe", None, &recent, 600, 0, 0);

        // Excluded: not a browser (editor).
        insert_activity(&conn, "Code.exe", None, &recent, 600, 0, 0);
        // Excluded: already classified (has a project).
        insert_activity(&conn, "firefox", Some("p1"), &recent, 600, 0, 0);
        // Excluded: already confirmed.
        insert_activity(&conn, "brave", None, &recent, 600, 0, 1);
        // Excluded: idle.
        insert_activity(&conn, "opera", None, &recent, 600, 1, 0);
        // Excluded: browser but older than the 7-day window.
        insert_activity(&conn, "vivaldi", None, &old, 600, 0, 0);

        let count = compute_unclassified_browser_count(&conn, 7).unwrap();
        assert_eq!(
            count, 3,
            "only active, unassigned, unconfirmed in-window browsers count"
        );
    }
}
