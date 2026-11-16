//! Lokal aktivitets-DB (SQLite). Rå aktivitet forlader aldrig maskinen.
//!
//! - Versionerede migrationer via `PRAGMA user_version`. En DB fra en nyere
//!   app-version åbnes ikke (ingen nedgradering af skema).
//! - Tider gemmes som UTC i millisekunder. Dagsforespørgsler bruger lokal dag.
//! - Retention: segmenter, der sluttede for mere end N dage siden, slettes.

use std::fmt;
use std::path::Path;

use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::day::{clip_to_day, day_bounds_in};
use crate::exclusion::{ExclusionRule, validate_rule};
use crate::types::ActivitySegment;

#[derive(Debug)]
pub enum StoreError {
    Sqlite(rusqlite::Error),
    /// Ugyldigt input (fx en udelukkelsesregel). Teksten er dansk til UI'et.
    Invalid(String),
    /// DB'en er lavet af en nyere version af app'en.
    FutureSchema {
        found: i64,
        supported: i64,
    },
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Sqlite(e) => write!(f, "aktivitets-DB: {e}"),
            StoreError::Invalid(m) => f.write_str(m),
            StoreError::FutureSchema { found, supported } => write!(
                f,
                "aktivitets-DB har skemaversion {found}, men denne version kender kun {supported}"
            ),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sqlite(e)
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// Migrationer i rækkefølge. Indeks + 1 = `user_version` efter kørsel.
/// Tilføj kun i enden; ret aldrig en udgivet migration.
const MIGRATIONS: &[&str] = &[
    // 1: segmenter og udelukkelsesregler
    "CREATE TABLE activity_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app TEXT NOT NULL,
        app_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        domain TEXT,
        repo_remote TEXT,
        repo_root TEXT,
        branch TEXT,
        path TEXT,
        document TEXT,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        idle INTEGER NOT NULL DEFAULT 0,
        CHECK (end_ms >= start_ms)
    );
    CREATE INDEX idx_activity_segments_start ON activity_segments(start_ms);
    CREATE INDEX idx_activity_segments_end ON activity_segments(end_ms);
    CREATE TABLE exclusion_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field TEXT NOT NULL,
        op TEXT NOT NULL,
        value TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );",
];

pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

/// En gemt udelukkelsesregel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredExclusionRule {
    pub id: i64,
    pub field: String,
    pub op: String,
    pub value: String,
    pub is_active: bool,
    pub created_at: String,
}

/// Overblik over aktivitets-DB'en (Indstillinger → Sporing). // aktivitet
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StoreStats {
    pub segments: u64,
    pub first: Option<DateTime<Utc>>,
    pub last: Option<DateTime<Utc>>,
}

pub struct ActivityStore {
    conn: Connection,
}

const SEGMENT_COLUMNS: &str = "id, app, app_id, title, url, domain, repo_remote, repo_root, branch, path, document, start_ms, end_ms, idle";

impl ActivityStore {
    /// Åbner (og migrerer) DB'en. Opretter filen, hvis den ikke findes.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;",
        )?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        Self::from_connection(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(mut conn: Connection) -> Result<Self> {
        migrate(&mut conn)?;
        Ok(Self { conn })
    }

    pub fn schema_version(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }

    /// Gemmer et segment og returnerer dets id.
    pub fn insert(&self, s: &ActivitySegment) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO activity_segments
             (app, app_id, title, url, domain, repo_remote, repo_root, branch, path, document, start_ms, end_ms, idle)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                s.app,
                s.app_id,
                s.title,
                s.url,
                s.domain,
                s.repo_remote,
                s.repo_root,
                s.branch,
                s.path,
                s.document,
                s.start.timestamp_millis(),
                s.end.max(s.start).timestamp_millis(),
                s.idle as i32,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Segmenter, der overlapper `[from, to)`, uklippede, sorteret efter start.
    pub fn segments_between(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        include_idle: bool,
    ) -> Result<Vec<ActivitySegment>> {
        let sql = format!(
            "SELECT {SEGMENT_COLUMNS} FROM activity_segments
             WHERE end_ms > ?1 AND start_ms < ?2 {}
             ORDER BY start_ms, id",
            if include_idle { "" } else { "AND idle = 0" }
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(
            params![from.timestamp_millis(), to.timestamp_millis()],
            row_to_segment,
        )?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// Segmenterne for den lokale dag `date` i zonen `tz`, klippet til dagen.
    /// Et segment over midnat optræder på begge dage med hver sin del.
    pub fn segments_for_day_in<Tz: TimeZone>(
        &self,
        date: NaiveDate,
        tz: &Tz,
        include_idle: bool,
    ) -> Result<Vec<ActivitySegment>> {
        let bounds = day_bounds_in(date, tz);
        let mut out = self.segments_between(bounds.0, bounds.1, include_idle)?;
        out.retain_mut(|s| match clip_to_day(s.start, s.end, bounds) {
            Some((a, b)) => {
                s.start = a;
                s.end = b;
                true
            }
            None => false,
        });
        Ok(out)
    }

    /// Som [`Self::segments_for_day_in`] i systemets lokale zone.
    pub fn segments_for_day(
        &self,
        date: NaiveDate,
        include_idle: bool,
    ) -> Result<Vec<ActivitySegment>> {
        self.segments_for_day_in(date, &chrono::Local, include_idle)
    }

    /// Summen af arbejdstid (ikke idle) for den lokale dag, i sekunder.
    pub fn worked_secs_for_day_in<Tz: TimeZone>(&self, date: NaiveDate, tz: &Tz) -> Result<i64> {
        Ok(self
            .segments_for_day_in(date, tz, false)?
            .iter()
            .map(ActivitySegment::duration_secs)
            .sum())
    }

    /// Sletter segmenter, der sluttede for mere end `days` dage siden.
    pub fn purge_older_than(&self, now: DateTime<Utc>, days: u32) -> Result<usize> {
        let cutoff = now - Duration::days(days as i64);
        Ok(self.conn.execute(
            "DELETE FROM activity_segments WHERE end_ms < ?1",
            [cutoff.timestamp_millis()],
        )?)
    }

    pub fn delete_segment(&self, id: i64) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM activity_segments WHERE id = ?1", [id])?
            > 0)
    }

    /// Sletter al aktivitet, der overlapper `[from, to)` (brugerens "glem det her").
    pub fn delete_between(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM activity_segments WHERE end_ms > ?1 AND start_ms < ?2",
            params![from.timestamp_millis(), to.timestamp_millis()],
        )?)
    }

    /// Fjerner præcis `[from, to)` fra aktiviteten: segmenter helt inde i
    /// tidsrummet slettes, og segmenter, der stikker ud, beholder kun delen
    /// udenfor (et segment hen over hele tidsrummet bliver til to). Returnerer
    /// antal berørte segmenter. // aktivitet
    pub fn cut_between(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<usize> {
        if to <= from {
            return Ok(0);
        }
        let (a, b) = (from.timestamp_millis(), to.timestamp_millis());
        let tx = self.conn.unchecked_transaction()?;
        let hit = self.segments_between(from, to, true)?;
        for s in &hit {
            let Some(id) = s.id else { continue };
            let (s0, s1) = (s.start.timestamp_millis(), s.end.timestamp_millis());
            match (s0 < a, s1 > b) {
                (false, false) => {
                    tx.execute("DELETE FROM activity_segments WHERE id = ?1", [id])?;
                }
                (true, false) => {
                    tx.execute(
                        "UPDATE activity_segments SET end_ms = ?1 WHERE id = ?2",
                        params![a, id],
                    )?;
                }
                (false, true) => {
                    tx.execute(
                        "UPDATE activity_segments SET start_ms = ?1 WHERE id = ?2",
                        params![b, id],
                    )?;
                }
                (true, true) => {
                    tx.execute(
                        "UPDATE activity_segments SET end_ms = ?1 WHERE id = ?2",
                        params![a, id],
                    )?;
                    let mut rest = s.clone();
                    rest.start = to;
                    tx.execute(
                        "INSERT INTO activity_segments
                         (app, app_id, title, url, domain, repo_remote, repo_root, branch, path, document, start_ms, end_ms, idle)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                        params![
                            rest.app,
                            rest.app_id,
                            rest.title,
                            rest.url,
                            rest.domain,
                            rest.repo_remote,
                            rest.repo_root,
                            rest.branch,
                            rest.path,
                            rest.document,
                            b,
                            s1,
                            rest.idle as i32,
                        ],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(hit.len())
    }

    /// Sletter al aktivitet (Indstillinger → Sporing → "Slet al aktivitet").
    /// Udelukkelsesreglerne bliver. // aktivitet
    pub fn delete_all(&self) -> Result<usize> {
        let n = self.conn.execute("DELETE FROM activity_segments", [])?;
        // Giv pladsen tilbage, så filen ikke beholder de slettede data.
        self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        Ok(n)
    }

    /// Antal segmenter og det tidligste og seneste tidspunkt. // aktivitet
    pub fn stats(&self) -> Result<StoreStats> {
        let (segments, first, last): (i64, Option<i64>, Option<i64>) = self.conn.query_row(
            "SELECT COUNT(*), MIN(start_ms), MAX(end_ms) FROM activity_segments",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        Ok(StoreStats {
            segments: segments.max(0) as u64,
            first: first.map(ms_to_utc),
            last: last.map(ms_to_utc),
        })
    }

    /// De lokale datoer (i `tz`), der har aktivitet. // aktivitet
    pub fn days_with_activity_in<Tz: TimeZone>(&self, tz: &Tz) -> Result<Vec<NaiveDate>> {
        let mut stmt = self
            .conn
            .prepare("SELECT start_ms, end_ms FROM activity_segments ORDER BY start_ms")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
        let mut days = std::collections::BTreeSet::new();
        for row in rows {
            let (a, b) = row?;
            let (a, b) = (ms_to_utc(a), ms_to_utc(b));
            let mut d = crate::day::local_date_in(a, tz);
            // Et segment, der slutter præcis ved midnat, hører ikke til næste dag.
            let last = crate::day::local_date_in((b - Duration::milliseconds(1)).max(a), tz);
            while d <= last {
                days.insert(d);
                match d.succ_opt() {
                    Some(n) => d = n,
                    None => break,
                }
            }
        }
        Ok(days.into_iter().collect())
    }

    pub fn segment(&self, id: i64) -> Result<Option<ActivitySegment>> {
        let sql = format!("SELECT {SEGMENT_COLUMNS} FROM activity_segments WHERE id = ?1");
        Ok(self.conn.query_row(&sql, [id], row_to_segment).optional()?)
    }

    // ---- udelukkelsesregler ----

    pub fn list_exclusion_rules(&self) -> Result<Vec<StoredExclusionRule>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, field, op, value, is_active, created_at FROM exclusion_rules ORDER BY id DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(StoredExclusionRule {
                id: r.get(0)?,
                field: r.get(1)?,
                op: r.get(2)?,
                value: r.get(3)?,
                is_active: r.get::<_, i64>(4)? != 0,
                created_at: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// De aktive regler i den form, trackeren bruger.
    pub fn active_exclusion_rules(&self) -> Result<Vec<ExclusionRule>> {
        let mut stmt = self.conn.prepare(
            "SELECT field, op, value FROM exclusion_rules WHERE is_active = 1 ORDER BY id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(ExclusionRule {
                field: r.get(0)?,
                op: r.get(1)?,
                value: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn add_exclusion_rule(&self, field: &str, op: &str, value: &str) -> Result<i64> {
        validate_rule(field, op, value).map_err(StoreError::Invalid)?;
        self.conn.execute(
            "INSERT INTO exclusion_rules (field, op, value) VALUES (?1, ?2, ?3)",
            params![field, op, value.trim()],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn set_exclusion_rule_active(&self, id: i64, active: bool) -> Result<bool> {
        Ok(self.conn.execute(
            "UPDATE exclusion_rules SET is_active = ?1 WHERE id = ?2",
            params![active as i32, id],
        )? > 0)
    }

    pub fn delete_exclusion_rule(&self, id: i64) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM exclusion_rules WHERE id = ?1", [id])?
            > 0)
    }
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current > SCHEMA_VERSION {
        return Err(StoreError::FutureSchema {
            found: current,
            supported: SCHEMA_VERSION,
        });
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

fn ms_to_utc(ms: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ms)
        .single()
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
}

fn row_to_segment(r: &rusqlite::Row) -> rusqlite::Result<ActivitySegment> {
    Ok(ActivitySegment {
        id: Some(r.get(0)?),
        app: r.get(1)?,
        app_id: r.get(2)?,
        title: r.get(3)?,
        url: r.get(4)?,
        domain: r.get(5)?,
        repo_remote: r.get(6)?,
        repo_root: r.get(7)?,
        branch: r.get(8)?,
        path: r.get(9)?,
        document: r.get(10)?,
        start: ms_to_utc(r.get(11)?),
        end: ms_to_utc(r.get(12)?),
        idle: r.get::<_, i64>(13)? != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::Europe::Copenhagen;

    fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    #[test]
    fn cut_between_removes_exactly_the_span() {
        let s = ActivityStore::open_in_memory().unwrap();
        // 9-10 (stikker ud til venstre), 10:10-10:20 (helt inde), 10:30-12 (hen over).
        s.insert(&seg(utc(2026, 3, 2, 9, 0), utc(2026, 3, 2, 10, 5), false)).unwrap();
        s.insert(&seg(utc(2026, 3, 2, 10, 10), utc(2026, 3, 2, 10, 20), false)).unwrap();
        s.insert(&seg(utc(2026, 3, 2, 10, 30), utc(2026, 3, 2, 12, 0), false)).unwrap();
        let n = s.cut_between(utc(2026, 3, 2, 10, 0), utc(2026, 3, 2, 11, 0)).unwrap();
        assert_eq!(n, 3);
        let left: Vec<_> = s
            .segments_between(utc(2026, 3, 2, 0, 0), utc(2026, 3, 3, 0, 0), true)
            .unwrap()
            .into_iter()
            .map(|x| (x.start, x.end, x.title))
            .collect();
        assert_eq!(
            left,
            vec![
                (utc(2026, 3, 2, 9, 0), utc(2026, 3, 2, 10, 0), "main.rs".to_string()),
                (utc(2026, 3, 2, 11, 0), utc(2026, 3, 2, 12, 0), "main.rs".to_string()),
            ]
        );
        // Et segment hen over hele tidsrummet bliver til to.
        s.insert(&seg(utc(2026, 3, 3, 8, 0), utc(2026, 3, 3, 9, 0), false)).unwrap();
        s.cut_between(utc(2026, 3, 3, 8, 20), utc(2026, 3, 3, 8, 40)).unwrap();
        let day: Vec<_> = s
            .segments_between(utc(2026, 3, 3, 0, 0), utc(2026, 3, 4, 0, 0), true)
            .unwrap()
            .into_iter()
            .map(|x| (x.start, x.end))
            .collect();
        assert_eq!(
            day,
            vec![
                (utc(2026, 3, 3, 8, 0), utc(2026, 3, 3, 8, 20)),
                (utc(2026, 3, 3, 8, 40), utc(2026, 3, 3, 9, 0)),
            ]
        );
        assert_eq!(s.cut_between(utc(2026, 3, 3, 9, 0), utc(2026, 3, 3, 9, 0)).unwrap(), 0);
    }

    #[test]
    fn delete_all_and_stats() {
        let s = ActivityStore::open_in_memory().unwrap();
        assert_eq!(s.stats().unwrap(), StoreStats::default());
        s.add_exclusion_rule("app_name", "equals", "Signal").unwrap();
        // 22:30-23:00 UTC = 23:30-00:00 i København: kun den 2. marts.
        s.insert(&seg(utc(2026, 3, 2, 22, 30), utc(2026, 3, 2, 23, 0), false)).unwrap();
        s.insert(&seg(utc(2026, 3, 4, 8, 0), utc(2026, 3, 4, 9, 0), true)).unwrap();
        let st = s.stats().unwrap();
        assert_eq!(st.segments, 2);
        assert_eq!(st.first, Some(utc(2026, 3, 2, 22, 30)));
        assert_eq!(st.last, Some(utc(2026, 3, 4, 9, 0)));
        assert_eq!(
            s.days_with_activity_in(&Copenhagen).unwrap(),
            vec![
                NaiveDate::from_ymd_opt(2026, 3, 2).unwrap(),
                NaiveDate::from_ymd_opt(2026, 3, 4).unwrap()
            ]
        );
        assert_eq!(s.delete_all().unwrap(), 2);
        assert_eq!(s.stats().unwrap().segments, 0);
        assert_eq!(s.list_exclusion_rules().unwrap().len(), 1, "reglerne bliver");
    }

    fn seg(start: DateTime<Utc>, end: DateTime<Utc>, idle: bool) -> ActivitySegment {
        ActivitySegment {
            id: None,
            app: "Code".into(),
            app_id: "code".into(),
            title: "main.rs".into(),
            url: Some("https://æble.dk/x".into()),
            domain: Some("æble.dk".into()),
            repo_remote: Some("github.com/acme/timetrack".into()),
            repo_root: Some("/users/m/dev/timetrack".into()),
            branch: Some("main".into()),
            path: Some("/users/m/dev/timetrack".into()),
            document: Some("main.rs".into()),
            start,
            end,
            idle,
        }
    }

    #[test]
    fn migrates_to_current_version_and_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a").join("activity.db");
        let s = ActivityStore::open(&p).unwrap();
        assert_eq!(s.schema_version().unwrap(), SCHEMA_VERSION);
        drop(s);
        let s = ActivityStore::open(&p).unwrap();
        assert_eq!(s.schema_version().unwrap(), SCHEMA_VERSION);
    }

    #[test]
    fn refuses_db_from_newer_version() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("activity.db");
        {
            let c = Connection::open(&p).unwrap();
            c.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
                .unwrap();
        }
        match ActivityStore::open(&p) {
            Err(StoreError::FutureSchema { found, .. }) => assert_eq!(found, SCHEMA_VERSION + 1),
            other => panic!("forventede FutureSchema, fik {:?}", other.err()),
        }
    }

    #[test]
    fn insert_and_read_roundtrip_all_fields() {
        let s = ActivityStore::open_in_memory().unwrap();
        let x = seg(utc(2026, 10, 26, 8, 0), utc(2026, 10, 26, 9, 0), false);
        let id = s.insert(&x).unwrap();
        let back = s.segment(id).unwrap().unwrap();
        assert_eq!(back, ActivitySegment { id: Some(id), ..x });
    }

    #[test]
    fn day_query_uses_local_day_and_clips_over_midnight() {
        let s = ActivityStore::open_in_memory().unwrap();
        // 23:30-00:30 lokal (vinter) = 22:30-23:30 UTC 15/1.
        s.insert(&seg(
            utc(2026, 1, 15, 22, 30),
            utc(2026, 1, 15, 23, 30),
            false,
        ))
        .unwrap();
        // 00:30-01:00 lokal 16/1 = 23:30-00:00 UTC; UTC-datoen er 15/1.
        s.insert(&seg(
            utc(2026, 1, 15, 23, 30),
            utc(2026, 1, 16, 0, 0),
            false,
        ))
        .unwrap();

        let d15 = s
            .segments_for_day_in(
                NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
                &Copenhagen,
                false,
            )
            .unwrap();
        let d16 = s
            .segments_for_day_in(
                NaiveDate::from_ymd_opt(2026, 1, 16).unwrap(),
                &Copenhagen,
                false,
            )
            .unwrap();
        assert_eq!(d15.len(), 1);
        assert_eq!(
            (d15[0].start, d15[0].end),
            (utc(2026, 1, 15, 22, 30), utc(2026, 1, 15, 23, 0))
        );
        assert_eq!(d16.len(), 2);
        assert_eq!(d16[0].start, utc(2026, 1, 15, 23, 0));
        let total: i64 = d15
            .iter()
            .chain(&d16)
            .map(ActivitySegment::duration_secs)
            .sum();
        assert_eq!(total, 90 * 60, "intet tabt eller dobbelttalt over midnat");
    }

    #[test]
    fn day_query_on_dst_days() {
        let s = ActivityStore::open_in_memory().unwrap();
        // Hele den lokale 25/10-2026 (25 timer) er ét segment.
        s.insert(&seg(
            utc(2026, 10, 24, 22, 0),
            utc(2026, 10, 25, 23, 0),
            false,
        ))
        .unwrap();
        let d = NaiveDate::from_ymd_opt(2026, 10, 25).unwrap();
        assert_eq!(s.worked_secs_for_day_in(d, &Copenhagen).unwrap(), 25 * 3600);
        let d = NaiveDate::from_ymd_opt(2026, 10, 24).unwrap();
        assert_eq!(s.worked_secs_for_day_in(d, &Copenhagen).unwrap(), 0);
        // Forår: 29/3-2026 er 23 timer.
        s.insert(&seg(
            utc(2026, 3, 28, 23, 0),
            utc(2026, 3, 29, 22, 0),
            false,
        ))
        .unwrap();
        let d = NaiveDate::from_ymd_opt(2026, 3, 29).unwrap();
        assert_eq!(s.worked_secs_for_day_in(d, &Copenhagen).unwrap(), 23 * 3600);
    }

    #[test]
    fn idle_is_excluded_unless_asked_for() {
        let s = ActivityStore::open_in_memory().unwrap();
        s.insert(&seg(
            utc(2026, 10, 26, 8, 0),
            utc(2026, 10, 26, 9, 0),
            false,
        ))
        .unwrap();
        s.insert(&seg(
            utc(2026, 10, 26, 9, 0),
            utc(2026, 10, 26, 10, 0),
            true,
        ))
        .unwrap();
        let d = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        assert_eq!(
            s.segments_for_day_in(d, &Copenhagen, false).unwrap().len(),
            1
        );
        assert_eq!(
            s.segments_for_day_in(d, &Copenhagen, true).unwrap().len(),
            2
        );
        assert_eq!(s.worked_secs_for_day_in(d, &Copenhagen).unwrap(), 3600);
    }

    #[test]
    fn retention_deletes_only_old_segments() {
        let s = ActivityStore::open_in_memory().unwrap();
        let now = utc(2026, 10, 26, 12, 0);
        s.insert(&seg(
            now - Duration::days(20),
            now - Duration::days(20) + Duration::hours(1),
            false,
        ))
        .unwrap();
        // Sluttede for 13 dage og 23 timer siden: beholdes.
        s.insert(&seg(
            now - Duration::days(14),
            now - Duration::days(14) + Duration::hours(1),
            false,
        ))
        .unwrap();
        s.insert(&seg(now - Duration::hours(1), now, false))
            .unwrap();
        assert_eq!(s.purge_older_than(now, 14).unwrap(), 1);
        assert_eq!(
            s.segments_between(now - Duration::days(30), now, true)
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn delete_between_and_single() {
        let s = ActivityStore::open_in_memory().unwrap();
        let a = s
            .insert(&seg(
                utc(2026, 10, 26, 8, 0),
                utc(2026, 10, 26, 9, 0),
                false,
            ))
            .unwrap();
        s.insert(&seg(
            utc(2026, 10, 26, 10, 0),
            utc(2026, 10, 26, 11, 0),
            false,
        ))
        .unwrap();
        assert!(s.delete_segment(a).unwrap());
        assert!(!s.delete_segment(a).unwrap());
        assert_eq!(
            s.delete_between(utc(2026, 10, 26, 10, 30), utc(2026, 10, 26, 10, 31))
                .unwrap(),
            1
        );
    }

    #[test]
    fn exclusion_rule_crud_and_validation() {
        let s = ActivityStore::open_in_memory().unwrap();
        let a = s
            .add_exclusion_rule("window_title", "contains", " secret ")
            .unwrap();
        let b = s
            .add_exclusion_rule("url", "starts_with", "https://netbank")
            .unwrap();
        assert!(matches!(
            s.add_exclusion_rule("foo", "contains", "x"),
            Err(StoreError::Invalid(_))
        ));
        assert_eq!(s.list_exclusion_rules().unwrap().len(), 2);
        assert!(s.set_exclusion_rule_active(b, false).unwrap());
        let active = s.active_exclusion_rules().unwrap();
        assert_eq!(
            active,
            vec![ExclusionRule::new("window_title", "contains", "secret")]
        );
        assert!(s.delete_exclusion_rule(a).unwrap());
        assert!(s.active_exclusion_rules().unwrap().is_empty());
    }

    #[test]
    fn negative_duration_is_clamped_on_insert() {
        let s = ActivityStore::open_in_memory().unwrap();
        let id = s
            .insert(&seg(
                utc(2026, 10, 26, 9, 0),
                utc(2026, 10, 26, 8, 0),
                false,
            ))
            .unwrap();
        let back = s.segment(id).unwrap().unwrap();
        assert_eq!(back.start, back.end);
    }
}
