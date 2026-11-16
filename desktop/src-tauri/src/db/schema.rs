pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY NOT NULL,
    remote_id TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    cvr TEXT,
    hourly_rate REAL,
    notes TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    remote_id TEXT,
    client_id TEXT REFERENCES clients(id),
    name TEXT NOT NULL,
    hourly_rate REAL,
    color TEXT,
    estimated_hours REAL,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

CREATE TABLE IF NOT EXISTS klippekort (
    id TEXT PRIMARY KEY NOT NULL,
    remote_id TEXT,
    client_id TEXT REFERENCES clients(id),
    project_id TEXT REFERENCES projects(id),
    name TEXT NOT NULL,
    total_hours REAL NOT NULL,
    used_hours REAL NOT NULL DEFAULT 0,
    hourly_rate REAL,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    auto_deduct INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY NOT NULL,
    remote_id TEXT,
    project_id TEXT REFERENCES projects(id),
    client_id TEXT REFERENCES clients(id),
    klippekort_id TEXT REFERENCES klippekort(id),
    description TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration INTEGER,
    is_billable INTEGER NOT NULL DEFAULT 1,
    is_running INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    klippekort_deducted_hours REAL NOT NULL DEFAULT 0,
    -- Hvilken pomodoro-fase denne registrering er skrevet fra, hvis den er
    -- skrevet fra en. Uden den kunne tidslinjen ikke sige at en fase **også**
    -- er registreret, så brugeren så de samme 25 minutter to steder uden at kunne
    -- se hvor de stod fra. NULL på enhver manuel registrering.
    pomodoro_session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
);

CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT,
    window_title TEXT,
    url TEXT,
    git_branch TEXT,
    git_repo TEXT,
    file_path TEXT,
    context_path TEXT,
    category TEXT,
    project_id TEXT REFERENCES projects(id),
    -- The customer this activity is billed to. A freelancer's day mixes
    -- projects, but work for a customer with no project is real billable work
    -- (a meeting, a support mail, an invoice round) that has nothing to hang
    -- off. Without this column such an activity can only be stored as no
    -- project and no customer, and the registered entry loses the customer.
    client_id TEXT REFERENCES clients(id),
    confidence REAL,
    classification_source TEXT,
    classification_reason TEXT,
    is_confirmed INTEGER NOT NULL DEFAULT 0,
    is_idle INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS classification_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    condition_type TEXT NOT NULL,
    condition_op TEXT NOT NULL,
    condition_value TEXT NOT NULL,
    target_project_id TEXT REFERENCES projects(id),
    -- Target customer WITHOUT a project: at least one of target_project_id /
    -- target_client_id must be set for a rule to produce a match.
    target_client_id TEXT REFERENCES clients(id),
    target_category TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS confirmed_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT,
    window_title_pattern TEXT,
    url_pattern TEXT,
    git_repo TEXT,
    context_path TEXT,
    project_id TEXT REFERENCES projects(id),
    -- Customer WITHOUT a project, the same shape a classification rule may take:
    -- at least one of project_id / client_id is set, and the customer is what
    -- gets billed. Without this a learnable signal could only ever name a
    -- project, so a customer with no projects was unlearnable — and a NULL
    -- project_id made `classify_by_history` skip the row outright (rusqlite
    -- cannot read NULL into String), silencing the whole pattern layer.
    client_id TEXT REFERENCES clients(id),
    category TEXT,
    confirmation_count INTEGER NOT NULL DEFAULT 1,
    last_confirmed TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Project identity: the signals that IDENTIFY a project (git repo, working
-- directory, browser domain, title keyword). Without these, the classifier can
-- only guess from project NAMES — which is why captured context (a repo name, a
-- working directory, a domain like kunde-a.example.dk) mapped to nothing.
--
-- BOTH project_id and client_id NULL is meaningful: it marks a signal as
-- deliberately NOT work (facebook, a webshop), suppressing classification and
-- stopping the discovery flow from asking about it again. A row naming only a
-- client is a real, billable target — the same shape a classification rule and
-- a confirmed pattern may take — so NOT work is only true when BOTH are NULL.
-- Without client_id, a customer with no projects was inexpressible here: a
-- portal or a support inbox is exactly the signal that has no project.
--
-- Safe to declare here (rather than in apply_migrations) because this is a NEW
-- table: CREATE TABLE creates every column on both fresh and existing databases,
-- so the index below can never reference a column that does not exist yet.
CREATE TABLE IF NOT EXISTS project_matchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT REFERENCES projects(id),
    -- Customer WITHOUT a project. At least one of project_id / client_id is set;
    -- the customer is what gets billed when there is no project.
    client_id TEXT REFERENCES clients(id),
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- One signal resolves to exactly ONE target — a repo cannot belong to two
-- clients, and ambiguity here would silently misbill. The uniqueness is on the
-- signal, not on the target: a project and a client live in the same row, so a
-- single (kind, value) still has one destination and one not-work answer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_matchers_unique
    ON project_matchers(kind, value);
CREATE INDEX IF NOT EXISTS idx_project_matchers_project ON project_matchers(project_id);

-- Privacy: windows matching an active exclusion rule are never tracked.
CREATE TABLE IF NOT EXISTS exclusion_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field TEXT NOT NULL,
    op TEXT NOT NULL,
    value TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_drafts (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT NOT NULL REFERENCES clients(id),
    title TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    subtotal REAL,
    vat_rate REAL NOT NULL DEFAULT 25.0,
    total REAL,
    due_date TEXT,
    notes TEXT,
    invoice_number TEXT,
    ai_generated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id TEXT NOT NULL REFERENCES invoice_drafts(id),
    description TEXT,
    quantity REAL,
    unit_price REAL,
    amount REAL,
    time_entry_id TEXT REFERENCES time_entries(id),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT,
    synced INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Én række pr. gennemført arbejdsfase. Uden denne tabel lå tallet i
-- frontend-storen, så det døde med appen: en pomodoro-tæller der nulstilles
-- ved hver genstart kan ikke bruges til at se, om man har arbejdet i dag.
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    day TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    ended_at TEXT NOT NULL
);

-- En beskadiget database, der er omdøbt frem for slettet. Rækken overlever
-- appen, så banneren også vises ved de næste starter — ellers forsvandt
-- beskeden om brugerens tid lige så snart han genstartede, og han fik aldrig
-- at vide at sikkerhedskopien lå ved siden af. Én række (id = 1): kun den
-- seneste beskadigelse er relevant, og den slettes når filen er væk igen.
CREATE TABLE IF NOT EXISTS database_recovery (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    backup_sti TEXT NOT NULL,
    årsag TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL,
    uid TEXT NOT NULL,
    summary TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    imported_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_client_id ON time_entries(client_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_start_time ON time_entries(start_time);
CREATE INDEX IF NOT EXISTS idx_time_entries_is_running ON time_entries(is_running);
CREATE INDEX IF NOT EXISTS idx_time_entries_klippekort_id ON time_entries(klippekort_id);
CREATE INDEX IF NOT EXISTS idx_activities_started_at ON activities(started_at);
CREATE INDEX IF NOT EXISTS idx_activities_project_id ON activities(project_id);
CREATE INDEX IF NOT EXISTS idx_activities_unclassified ON activities(started_at, is_confirmed, project_id, is_idle);
CREATE INDEX IF NOT EXISTS idx_klippekort_client_id ON klippekort(client_id);
CREATE INDEX IF NOT EXISTS idx_klippekort_project_id ON klippekort(project_id);
CREATE INDEX IF NOT EXISTS idx_klippekort_status ON klippekort(status);
CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced);
CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source_url, uid);
CREATE INDEX IF NOT EXISTS idx_confirmed_patterns_app ON confirmed_patterns(app_name);
CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_day ON pomodoro_sessions(day);
-- NOTE: idx_invoice_number_unique (the legal no-reuse backstop on
-- invoice_drafts.invoice_number) is created in db::Database::apply_migrations,
-- NOT here. invoice_number is a migration-added column; creating an index on it
-- inside SCHEMA runs BEFORE the ALTER TABLE that adds the column on pre-existing
-- databases, which fails with a no-such-column error and crashes the app on
-- startup. The index must be created only after the column is guaranteed.
-- Covering index for report queries: avoids table lookups when aggregating by date/project
CREATE INDEX IF NOT EXISTS idx_time_entries_report ON time_entries(start_time, project_id, client_id, duration, is_billable);
-- Covering index for activities report (top apps)
CREATE INDEX IF NOT EXISTS idx_activities_app_duration ON activities(started_at, is_idle, app_name, duration);
";
