//! Lokal cache og offline-kø for cloud-tilstand (SQLite).
//!
//! - `cache`: svar pr. forespørgsel (nøgle), med område og "stale"-flag.
//!   En SSE-hændelse eller egen skrivning gør området stale.
//! - `outbox`: skrivninger, der venter på forbindelse (FIFO, `op_id` unik).
//! - `id_map`: midlertidigt id (en køet ny post) → serverens id.
//! - `dead_letter`: handlinger, web afviste endeligt (se `dead_letter.rs`).
//!   Ryddes aldrig af logud eller org-skift, kun ved eksplicit kassering.
//!
//! Rå aktivitet ligger aldrig her (D3), kun web's forretningsdata.

use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::error::Result;
use crate::events::Entity;

use super::queue::QueuedOp;

const MIGRATIONS: &[&str] = &[r#"
    CREATE TABLE cache (
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        json TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL
    );
    CREATE INDEX cache_kind_idx ON cache(kind);
    CREATE TABLE outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT NOT NULL UNIQUE,
        op TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
    );
    CREATE TABLE id_map (
        temp_id TEXT PRIMARY KEY,
        real_id TEXT NOT NULL
    );
    CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
"#,
    // 2: handlinger husker organisationen, de blev lavet i.
    "ALTER TABLE outbox ADD COLUMN organization_id TEXT;",
    // 3: afviste handlinger (dead-letter). Slettes kun ved eksplicit kassering.
    r#"
    CREATE TABLE dead_letter (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT NOT NULL UNIQUE,
        op TEXT NOT NULL,
        created_at TEXT NOT NULL,
        organization_id TEXT,
        user_id TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT NOT NULL,
        status INTEGER,
        rejected_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        client_name TEXT,
        project_name TEXT
    );
    CREATE INDEX dead_letter_user_idx ON dead_letter(user_id);
"#,
];

/// En række i `dead_letter`. Navnene er fra afvisningen og kan mangle.
pub struct DeadRow {
    pub op: QueuedOp,
    pub user_id: String,
    pub error_code: Option<String>,
    pub error_message: String,
    pub status: Option<u16>,
    pub rejected_at: DateTime<Utc>,
    pub attempts: u32,
    pub client_name: Option<String>,
    pub project_name: Option<String>,
}

/// Fejlen, en handling blev afvist med.
pub struct Rejection<'a> {
    /// Kundens og projektets navn, da den blev afvist (til visning og CSV
    /// efter logud, hvor cachen er ryddet).
    pub client_name: Option<&'a str>,
    pub project_name: Option<&'a str>,
    pub code: Option<&'a str>,
    pub message: &'a str,
    pub status: Option<u16>,
    pub at: DateTime<Utc>,
}

pub struct CachedValue {
    pub value: Value,
    pub stale: bool,
    pub fetched_at: DateTime<Utc>,
}

pub struct Cache {
    conn: Mutex<Connection>,
    /// Generation pr. område: bumpes ved hver ugyldiggørelse, så et svar,
    /// der lander bagefter, ikke gemmes som frisk.
    generations: Mutex<std::collections::HashMap<Entity, u64>>,
}

impl Cache {
    pub fn open(path: Option<&std::path::Path>) -> Result<Self> {
        let mut conn = match path {
            Some(p) => Connection::open(p)?,
            None => Connection::open_in_memory()?,
        };
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        let current: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", i as u32 + 1)?;
            tx.commit()?;
        }
        // Svar fra en tidligere kørsel kan være forældede: hent igen, når
        // der er forbindelse (de bruges stadig som offline-fallback).
        conn.execute("UPDATE cache SET stale = 1", [])?;
        Ok(Cache { conn: Mutex::new(conn), generations: Mutex::new(Default::default()) })
    }

    pub fn generation(&self, kind: Entity) -> u64 {
        self.generations.lock().get(&kind).copied().unwrap_or(0)
    }

    pub fn get(&self, key: &str) -> Option<CachedValue> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT json, stale, fetched_at FROM cache WHERE key = ?1",
            [key],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|(json, stale, at)| {
            Some(CachedValue {
                value: serde_json::from_str(&json).ok()?,
                stale,
                fetched_at: DateTime::parse_from_rfc3339(&at).ok()?.with_timezone(&Utc),
            })
        })
    }

    /// Gem et svar. `generation` er områdets generation, da hentningen
    /// startede; er området ugyldiggjort siden, gemmes svaret som stale.
    pub fn put(&self, key: &str, kind: Entity, value: &Value, now: DateTime<Utc>, generation: u64) -> Result<()> {
        let gens = self.generations.lock();
        let stale = gens.get(&kind).copied().unwrap_or(0) != generation;
        self.conn.lock().execute(
            "INSERT INTO cache (key, kind, json, stale, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(key) DO UPDATE SET json = excluded.json, stale = excluded.stale, fetched_at = excluded.fetched_at",
            params![key, kind.as_str(), value.to_string(), stale, now.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn invalidate(&self, kinds: &[Entity]) {
        let mut gens = self.generations.lock();
        let conn = self.conn.lock();
        for k in kinds {
            *gens.entry(*k).or_default() += 1;
            let _ = conn.execute("UPDATE cache SET stale = 1 WHERE kind = ?1", [k.as_str()]);
        }
    }

    /// Find et element med `id` i de cachede svar for et område (lister
    /// eller enkeltobjekter).
    pub fn find_in_kind(&self, kind: Entity, id: &str) -> Option<Value> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT json FROM cache WHERE kind = ?1").ok()?;
        let rows = stmt.query_map([kind.as_str()], |r| r.get::<_, String>(0)).ok()?;
        for json in rows.flatten() {
            let Ok(v) = serde_json::from_str::<Value>(&json) else { continue };
            let items = match v {
                Value::Array(a) => a,
                other => vec![other],
            };
            if let Some(hit) = items.into_iter().find(|x| x.get("id").and_then(Value::as_str) == Some(id)) {
                return Some(hit);
            }
        }
        None
    }

    /// Ryd forretningsdata (org-skift, logud). Køen bevares (se `outbox_user`).
    pub fn clear_data(&self) -> Result<()> {
        self.conn.lock().execute("DELETE FROM cache", [])?;
        Ok(())
    }

    pub fn meta(&self, key: &str) -> Option<String> {
        self.conn
            .lock()
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    }

    pub fn set_meta(&self, key: &str, value: Option<&str>) -> Result<()> {
        let conn = self.conn.lock();
        match value {
            Some(v) => conn.execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [key, v],
            )?,
            None => conn.execute("DELETE FROM meta WHERE key = ?1", [key])?,
        };
        Ok(())
    }

    // ------------------------------------------------------------ kø

    /// Læg en handling i køen. Samme `op_id` to gange er én handling.
    pub fn enqueue(&self, op: &QueuedOp) -> Result<i64> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO outbox (op_id, op, created_at, organization_id) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(op_id) DO NOTHING",
            params![op.op_id, serde_json::to_string(&op.op)?, op.created_at.to_rfc3339(), op.organization_id],
        )?;
        Ok(conn.query_row("SELECT seq FROM outbox WHERE op_id = ?1", [&op.op_id], |r| r.get(0))?)
    }

    pub fn pending(&self) -> Result<Vec<(i64, QueuedOp)>> {
        let conn = self.conn.lock();
        let mut stmt =
            conn.prepare("SELECT seq, op_id, op, created_at, organization_id FROM outbox ORDER BY seq")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (seq, op_id, op, at, organization_id) = row?;
            // En ulæselig række (nyere format) springes over, men slettes ikke.
            let Ok(op) = serde_json::from_str(&op) else { continue };
            let created_at = DateTime::parse_from_rfc3339(&at).map(|d| d.with_timezone(&Utc)).unwrap_or_default();
            out.push((seq, QueuedOp { op_id, op, created_at, organization_id }));
        }
        Ok(out)
    }

    pub fn pending_count(&self) -> usize {
        self.conn
            .lock()
            .query_row("SELECT COUNT(*) FROM outbox", [], |r| r.get::<_, i64>(0))
            .unwrap_or(0) as usize
    }

    /// Handlingen er leveret: ud af køen (og af de afviste, hvis den var et
    /// nyt forsøg på en afvist handling).
    pub fn remove(&self, seq: i64) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM dead_letter WHERE op_id IN (SELECT op_id FROM outbox WHERE seq = ?1)", [seq])?;
        tx.execute("DELETE FROM outbox WHERE seq = ?1", [seq])?;
        tx.commit()?;
        Ok(())
    }

    pub fn mark_attempt(&self, seq: i64, error: &str) {
        let _ = self.conn.lock().execute(
            "UPDATE outbox SET attempts = attempts + 1, last_error = ?1 WHERE seq = ?2",
            params![error, seq],
        );
    }

    // ------------------------------------------------------------ afviste

    /// Flyt handlingen fra køen til de afviste (i én transaktion). Er den
    /// der allerede (et nyt forsøg), opdateres fejlen, og forsøgene tælles op.
    pub fn dead_letter(&self, seq: i64, op: &QueuedOp, user_id: &str, r: &Rejection<'_>) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO dead_letter (op_id, op, created_at, organization_id, user_id, error_code, error_message, status, rejected_at, client_name, project_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(op_id) DO UPDATE SET error_code = excluded.error_code,
                 error_message = excluded.error_message, status = excluded.status,
                 rejected_at = excluded.rejected_at, attempts = dead_letter.attempts + 1,
                 client_name = COALESCE(excluded.client_name, dead_letter.client_name),
                 project_name = COALESCE(excluded.project_name, dead_letter.project_name)",
            params![
                op.op_id,
                serde_json::to_string(&op.op)?,
                op.created_at.to_rfc3339(),
                op.organization_id,
                user_id,
                r.code,
                r.message,
                r.status,
                r.at.to_rfc3339(),
                r.client_name,
                r.project_name,
            ],
        )?;
        tx.execute("DELETE FROM outbox WHERE seq = ?1", [seq])?;
        tx.commit()?;
        Ok(())
    }

    /// Brugerens afviste handlinger, ældste først. Handlinger, der er lagt i
    /// køen igen (et nyt forsøg i gang eller offline), er ikke med.
    pub fn dead_letters(&self, user_id: &str) -> Result<Vec<DeadRow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT op_id, op, created_at, organization_id, user_id, error_code, error_message, status, rejected_at, attempts,
                    client_name, project_name
             FROM dead_letter WHERE user_id = ?1 AND op_id NOT IN (SELECT op_id FROM outbox) ORDER BY seq",
        )?;
        let rows = stmt.query_map([user_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, Option<u16>>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, u32>(9)?,
                r.get::<_, Option<String>>(10)?,
                r.get::<_, Option<String>>(11)?,
            ))
        })?;
        let time = |s: &str| DateTime::parse_from_rfc3339(s).map(|d| d.with_timezone(&Utc)).unwrap_or_default();
        let mut out = Vec::new();
        for row in rows {
            let (op_id, op, created, organization_id, user_id, error_code, error_message, status, rejected, attempts, client_name, project_name) =
                row?;
            // En ulæselig række (nyere format) springes over, men slettes ikke.
            let Ok(op) = serde_json::from_str(&op) else { continue };
            out.push(DeadRow {
                op: QueuedOp { op_id, op, created_at: time(&created), organization_id },
                user_id,
                error_code,
                error_message,
                status,
                rejected_at: time(&rejected),
                attempts,
                client_name,
                project_name,
            });
        }
        Ok(out)
    }

    pub fn dead_letter_count(&self, user_id: &str) -> usize {
        self.conn
            .lock()
            .query_row(
                "SELECT COUNT(*) FROM dead_letter WHERE user_id = ?1 AND op_id NOT IN (SELECT op_id FROM outbox)",
                [user_id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize
    }

    /// Læg brugerens afviste handlinger (alle, eller kun `op_id`) i køen igen
    /// med samme `op_id` og indhold. Rækkerne bliver stående, til
    /// afsendelsen er afgjort (se `remove`, `dead_letter` og
    /// `drop_requeued_dead_letters`). Returnerer de `op_id`, der blev lagt i køen.
    pub fn requeue_dead_letters(&self, user_id: &str, op_id: Option<&str>) -> Result<Vec<String>> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let ids: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT op_id FROM dead_letter WHERE user_id = ?1 AND (?2 IS NULL OR op_id = ?2)
                 AND op_id NOT IN (SELECT op_id FROM outbox) ORDER BY seq",
            )?;
            stmt.query_map(params![user_id, op_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
        };
        for id in &ids {
            tx.execute(
                "INSERT INTO outbox (op_id, op, created_at, organization_id)
                 SELECT op_id, op, created_at, organization_id FROM dead_letter WHERE op_id = ?1
                 ON CONFLICT(op_id) DO NOTHING",
                [id],
            )?;
        }
        tx.commit()?;
        Ok(ids)
    }

    /// Erstat en afvist handling (fx en rettelse, der lægges oven på postens
    /// nuværende udgave før et nyt forsøg).
    pub fn set_dead_letter_op(&self, user_id: &str, op_id: &str, op: &super::queue::Op) -> Result<()> {
        self.conn.lock().execute(
            "UPDATE dead_letter SET op = ?3 WHERE user_id = ?1 AND op_id = ?2",
            params![user_id, op_id, serde_json::to_string(op)?],
        )?;
        Ok(())
    }

    /// Afviste handlinger, der ligger i køen igen (et nyt forsøg, der ikke
    /// kunne sendes): de hører nu til køen og fjernes fra de afviste.
    pub fn drop_requeued_dead_letters(&self) -> Result<()> {
        self.conn
            .lock()
            .execute("DELETE FROM dead_letter WHERE op_id IN (SELECT op_id FROM outbox)", [])?;
        Ok(())
    }

    pub fn in_outbox(&self, op_id: &str) -> bool {
        self.conn
            .lock()
            .query_row("SELECT 1 FROM outbox WHERE op_id = ?1", [op_id], |_| Ok(()))
            .optional()
            .ok()
            .flatten()
            .is_some()
    }

    /// Kassér én afvist handling (det eneste sted, de slettes).
    pub fn discard_dead_letter(&self, user_id: &str, op_id: &str) -> Result<bool> {
        let n = self.conn.lock().execute(
            "DELETE FROM dead_letter WHERE user_id = ?1 AND op_id = ?2 AND op_id NOT IN (SELECT op_id FROM outbox)",
            [user_id, op_id],
        )?;
        Ok(n > 0)
    }

    pub fn map_id(&self, temp_id: &str, real_id: &str) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO id_map (temp_id, real_id) VALUES (?1, ?2)
             ON CONFLICT(temp_id) DO UPDATE SET real_id = excluded.real_id",
            [temp_id, real_id],
        )?;
        Ok(())
    }

    /// Serverens id for et midlertidigt id (ellers id'et selv).
    pub fn resolve_id(&self, id: &str) -> String {
        self.conn
            .lock()
            .query_row("SELECT real_id FROM id_map WHERE temp_id = ?1", [id], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
            .unwrap_or_else(|| id.to_owned())
    }
}
