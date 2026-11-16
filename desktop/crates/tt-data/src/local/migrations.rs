//! Versionerede migrationer (`PRAGMA user_version`). Tilføj altid en NY
//! migration nederst; ret aldrig en, der er udgivet.

use rusqlite::Connection;

use crate::error::Result;

pub const MIGRATIONS: &[&str] = &[
    // 1: hele forretningsmodellen (navne som web's schema.ts)
    r#"
    CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT, phone TEXT, company TEXT, address TEXT, city TEXT,
        postal_code TEXT, country TEXT, cvr_number TEXT, notes TEXT,
        default_hourly_rate TEXT,
        payment_terms_days INTEGER,
        rounding_enabled INTEGER, rounding_minutes INTEGER, rounding_method TEXT,
        default_billable INTEGER NOT NULL DEFAULT 1,
        color TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT, updated_at TEXT
    );
    CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        client_id TEXT REFERENCES clients(id),
        hourly_rate TEXT,
        rounding_enabled INTEGER, rounding_minutes INTEGER, rounding_method TEXT,
        fixed_price TEXT, monthly_budget_hours TEXT, budget_hours TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        start_date TEXT, end_date TEXT,
        url_patterns TEXT NOT NULL DEFAULT '[]',
        created_at TEXT, updated_at TEXT
    );
    CREATE INDEX projects_client_id_idx ON projects(client_id);
    CREATE TABLE prepaid_packages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES clients(id),
        total_hours TEXT NOT NULL,
        used_hours TEXT NOT NULL DEFAULT '0',
        remaining_hours TEXT NOT NULL,
        hourly_rate TEXT NOT NULL,
        total_value TEXT NOT NULL,
        purchase_date TEXT,
        expiry_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_archived INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        clip_size_minutes INTEGER,
        auto_deduct INTEGER NOT NULL DEFAULT 1,
        overdraft_policy TEXT NOT NULL DEFAULT 'block',
        overdraft_rate TEXT,
        overdraft_hours TEXT NOT NULL DEFAULT '0'
    );
    CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT, notes TEXT,
        project_id TEXT REFERENCES projects(id),
        client_id TEXT REFERENCES clients(id),
        status TEXT NOT NULL DEFAULT 'backlog',
        status_id TEXT,
        priority TEXT DEFAULT 'medium',
        deadline TEXT, completed_at TEXT,
        parent_task_id TEXT,
        position INTEGER DEFAULT 0,
        estimated_minutes INTEGER,
        created_at TEXT, updated_at TEXT
    );
    CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES clients(id),
        amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        kind TEXT NOT NULL DEFAULT 'invoice',
        issue_date TEXT, due_date TEXT, paid_date TEXT,
        notes TEXT,
        created_at TEXT, updated_at TEXT
    );
    CREATE TABLE time_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        client_id TEXT REFERENCES clients(id),
        prepaid_package_id TEXT REFERENCES prepaid_packages(id),
        invoice_id TEXT REFERENCES invoices(id),
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        description TEXT, notes TEXT,
        hours TEXT NOT NULL,
        date TEXT NOT NULL,
        start_time TEXT, end_time TEXT,
        billable_rate TEXT,
        is_billable INTEGER NOT NULL DEFAULT 1,
        is_billed INTEGER NOT NULL DEFAULT 0,
        is_prepaid INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual',
        client_entry_id TEXT UNIQUE,
        timer_session_id TEXT UNIQUE,
        created_at TEXT, updated_at TEXT
    );
    CREATE INDEX time_entries_date_idx ON time_entries(date);
    CREATE INDEX time_entries_client_id_idx ON time_entries(client_id);
    CREATE INDEX time_entries_project_id_idx ON time_entries(project_id);
    CREATE TABLE prepaid_usage (
        id TEXT PRIMARY KEY,
        prepaid_package_id TEXT NOT NULL REFERENCES prepaid_packages(id),
        time_entry_id TEXT REFERENCES time_entries(id),
        hours_used TEXT NOT NULL,
        overdraft_hours TEXT NOT NULL DEFAULT '0',
        value_used TEXT NOT NULL,
        created_at TEXT
    );
    CREATE INDEX prepaid_usage_entry_idx ON prepaid_usage(time_entry_id);
    CREATE TABLE invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity TEXT NOT NULL DEFAULT '1',
        unit_price TEXT NOT NULL,
        amount TEXT NOT NULL,
        time_entry_id TEXT REFERENCES time_entries(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE timer_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL
    );
    CREATE TABLE matching_rules (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        pattern TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id),
        client_id TEXT REFERENCES clients(id),
        source TEXT NOT NULL,
        confirmations INTEGER NOT NULL DEFAULT 0,
        not_work INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT
    );
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // 2: kundens domæner (web's clients.domains), JSON-liste
    r#"
    ALTER TABLE clients ADD COLUMN domains TEXT;
    "#,
    // 3: fakturaens titel (lokal tilstand, som 0.2's invoice_drafts.title)
    r#"
    ALTER TABLE invoices ADD COLUMN title TEXT;
    "#,
];

/// Kør manglende migrationer, hver i sin egen transaktion.
pub fn migrate(conn: &mut Connection) -> Result<u32> {
    let current: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = i as u32 + 1;
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
        log::info!("lokal database migreret til version {version}");
    }
    Ok(MIGRATIONS.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_once_and_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        assert_eq!(migrate(&mut conn).unwrap(), MIGRATIONS.len() as u32);
        assert_eq!(migrate(&mut conn).unwrap(), MIGRATIONS.len() as u32);
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, MIGRATIONS.len() as u32);
    }
}
