pub mod errors;
pub mod schema;

use rusqlite::{Connection, ErrorCode};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct Database {
    pub conn: Mutex<Connection>,
    /// Sidst gang appen måtte starte på en ny database, fordi den gamle var
    /// ubrugelig. `Some` fortæller frontend, at brugerens data ligger i en
    /// sikkerhedskopi ved siden af — ikke at de er væk.
    pub recovery: Mutex<Option<Recovery>>,
}

/// En beskadiget database, der er omdøbt frem for slettet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recovery {
    /// Hvor den beskadigede database ligger nu, hvis brugeren vil hente
    /// den til en specialist. Aldrig slettet.
    pub backup_sti: PathBuf,
    /// Hvad vi så ved `quick_check`. Kun til loggen — ikke til UI'et.
    pub årsag: String,
}

/// Låser databasen, også når låsen er forgiftet.
///
/// `Mutex::lock` fejler, når en anden tråd panikkede, mens den holdt låsen. Det
/// betyder **ikke** at forbindelsen bagved er ødelagt — vi holder den kun
/// under ét statement — så at kassere den vilde gøre *stille* skade: kaldet
/// falder tilbage på en sti, der ligner det normale svar. I praksis er det præcis
/// de tre steder, der gjorde det, de farligste:
///
/// - licensens højeste-`trial_last_seen'` holdt op med at bevæge sig, så en
///   bruger der ruller uret tilbage genstarter prøveperioden;
/// - `suggest_project_for_context` svarede `None`, hvilket er præcis det svar
///   brugeren ellers får, når intet matcher.
///
/// Derfor er der én port, `lås`, i stedet for tre forskellige håndteringer af
/// samme fejl. Panikken rapporteres stadig, så den forsvinder ikke helt:
/// `errors::noter` skriver til Sentry, som brugeren aldrig ser.
pub fn lås(conn: &Mutex<Connection>) -> std::sync::MutexGuard<'_, Connection> {
    lås_helted(conn)
}

/// Samme som [`lås`], men til en hvilken som helst `Mutex`.
///
/// `recovery` deler låsemekanikken med `conn` — begge sættes aldrig til `None`
/// af en panik under en skrivning, fordi ingen af dem skriver. Men porten skal
/// kunne genbruges, ellers ville det nye felt få sit eget `lock().map_err(|_| …)`,
/// og det er præcis den maveflyndehåndtering `lås` blev skrevet for at fjerne.
pub fn lås_helted<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match m.lock() {
        Ok(vagt) => vagt,
        Err(forgiftet) => {
            errors::noter(
                "database-låsen var forgiftet — en tråd panikkede under en skrivning",
            );
            forgiftet.into_inner()
        }
    }
}

impl Database {
    pub fn new(app_handle: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_dir = app_handle.path().app_data_dir()?;
        std::fs::create_dir_all(&app_dir)?;

        let db_path = app_dir.join("timetrack.db");
        let (conn, recovery) = Self::åbn_med_recovery(&db_path)?;

        Ok(Self {
            conn: Mutex::new(conn),
            recovery: Mutex::new(recovery),
        })
    }

    /// Åbner databasen, og genopbygger den hvis den er ubrugelig.
    ///
    /// Uden denne vej var en beskadiget database det samme som en app der
    /// ikke starter: `Connection::open` **lykkes** på en fil der ikke er en
    /// database (SQLite læser den ikke før første læsning), og så fejler det
    /// første `PRAGMA` med `NotADatabase`. Det blev returneret som `Err` fra
    /// `new`, og `lib.rs`'s `setup` gjorde `?` på det — så appen døde ved
    /// start. I release er konsollen lukket (`windows_subsystem = "windows"`),
    /// så brugeren så **intet**: hverken vindue, fejlmeddelelse eller hint om
    /// hvor hans registrerede tid lå.
    ///
    /// Vi sletter aldrig. Den beskadigede database **omdøbes** til en fil med
    /// tidsstempel, så brugeren kan hente den til en specialist, og appen
    /// starter på en ny. `recovery` er `Some` kun når vi faktisk har gjort
    /// det, så frontend kan fortelle brugeren hvor filen ligger — en besked
    /// om en sikkerhedskopi der ikke findes ville være værre end ingen.
    ///
    /// Dette er målet i missionen: brugerens database må aldrig kunne gå
    /// tabt. Derfor er den beskadigede fil bevaret, ikke ryddet væk.
    fn åbn_med_recovery(db_path: &Path) -> Result<(Connection, Option<Recovery>), Box<dyn std::error::Error>> {
        match Self::åbn(db_path) {
            // En database der åbner, kan stadig have en beskadiget søskende fra en
            // tidligere start. Uden denne læsning forsvandt banneren ved den næste
            // genstart — data var ikke tabt, men brugeren faldt aldrig at vide at
            // de lå.
            Ok(conn) => {
                let gemt = Self::læs_gemt_recovery(&conn);
                Ok((conn, gemt))
            }
            Err(fejl) => {
                // Kun *beskadigelse* giver en ny database. Alle andre fejl —
                // en låst fil, en mappe der ikke findes, en disk der er fuld —
                // er forhold appen ikke kan ordne op ved at smide data væk, så
                // de skal fortsat vælte ud som `Err` og vise den rigtige fejl.
                if !er_beskadigelse(fejl.as_ref()) {
                    return Err(fejl);
                }

                let backup_sti = match flyt_til_sikkerhedskopi(db_path) {
                    Ok(sti) => sti,
                    Err(e) => {
                        // Klarer vi ikke at flytte filen, må vi heller ikke
                        // starte på en tom database: brugeren ville se en app
                        // uden data og uden advarsel. Fejlen skal videre.
                        return Err(Box::new(e));
                    }
                };

                errors::noter(&format!(
                    "databasen var beskadiget og er omdøbt til {}: {fejl}",
                    backup_sti.display()
                ));

                let conn = Self::åbn(db_path)?;
                let recovery = Recovery {
                    backup_sti: backup_sti.clone(),
                    årsag: fejl.to_string(),
                };
                // Skriv beskeden ned i den nye database, så den overlever næste
                // start. Uden denne række var `recovery` kun sand i denne
                // proces: brugeren genstarter, `timetrack.db` er nu en gyldig tom
                // database, `recovery` er `None`, og banneren — hans eneste vej
                // tilbage til tiden — er væk for altid.
                if let Err(fejl) = Self::gem_recovery(&conn, &recovery) {
                    // Beskeden er vigtigere end opslaget: appen skal stadig starte,
                    // og banneren vises i denne session. Skrivningen fejler kun
                    // hvis den nye database ikke kan skrives, og det ville også
                    // ramt alt andet.
                    errors::noter(&format!(
                        "recovery kunne ikke gemmes i databasen, så beskeden forsvinder ved næste start: {fejl}"
                    ));
                }
                Ok((conn, Some(recovery)))
            }
        }
    }

    /// Den normale åbning, uden recovery. Alt der kan fejle, fejler her — så
    /// `åbn_med_recovery` kan skelne en beskadiget fil fra en låst.
    fn åbn(db_path: &Path) -> Result<Connection, Box<dyn std::error::Error>> {
        let conn = Connection::open(db_path)?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        conn.execute_batch("PRAGMA synchronous=NORMAL;")?;
        conn.execute_batch("PRAGMA cache_size=-8000;")?;
        // Memory-map up to 256MB for faster reads on large tables (activities)
        conn.execute_batch("PRAGMA mmap_size=268435456;")?;
        conn.execute_batch("PRAGMA temp_store=MEMORY;")?;
        conn.execute_batch(schema::SCHEMA)?;

        // Run migrations for columns added after initial schema
        Self::apply_migrations(&conn)?;

        Ok(conn)
    }
    /// Apply incremental migrations for columns added after the initial schema.
    /// Each migration is safe to run multiple times (idempotent).
    /// `pub(crate)` so a migration can be run against a hand-built *old* database
    /// in a test — the only honest way to prove the ALTER works on the shape it
    /// will actually meet.
    pub(crate) fn apply_migrations(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
        // v0.2.0: Add estimated_hours to projects
        let has_estimated_hours: bool = conn
            .prepare("SELECT estimated_hours FROM projects LIMIT 0")
            .is_ok();
        if !has_estimated_hours {
            conn.execute_batch("ALTER TABLE projects ADD COLUMN estimated_hours REAL")?;
        }

        // Add context_path to activities (derived project dir for constant-title apps)
        let has_context_path: bool = conn
            .prepare("SELECT context_path FROM activities LIMIT 0")
            .is_ok();
        if !has_context_path {
            conn.execute_batch("ALTER TABLE activities ADD COLUMN context_path TEXT")?;
        }

        // Make classification transparent: persist WHICH layer classified each
        // activity (rule/pattern/ai/inherited) and a short human-readable detail
        // of WHY, so the timeline can show "95% — matchede git_repo …" instead of
        // a bare score. Both are nullable — legacy rows and manual entries have no
        // auto-classification source.
        let has_classification_source: bool = conn
            .prepare("SELECT classification_source FROM activities LIMIT 0")
            .is_ok();
        if !has_classification_source {
            conn.execute_batch(
                "ALTER TABLE activities ADD COLUMN classification_source TEXT",
            )?;
        }
        let has_classification_reason: bool = conn
            .prepare("SELECT classification_reason FROM activities LIMIT 0")
            .is_ok();
        if !has_classification_reason {
            conn.execute_batch(
                "ALTER TABLE activities ADD COLUMN classification_reason TEXT",
            )?;
        }

        // Add git_repo + context_path to confirmed_patterns so history-based
        // classification can refuse patterns learned in a DIFFERENT client repo
        // (anti-misattribution across customer repos).
        // Guard on table existence so migrations on a partial DB don't fail.
        let confirmed_patterns_exists: bool = conn
            .prepare("SELECT 1 FROM confirmed_patterns LIMIT 0")
            .is_ok();
        if confirmed_patterns_exists {
            let has_pattern_git_repo: bool = conn
                .prepare("SELECT git_repo FROM confirmed_patterns LIMIT 0")
                .is_ok();
            if !has_pattern_git_repo {
                conn.execute_batch("ALTER TABLE confirmed_patterns ADD COLUMN git_repo TEXT")?;
            }
            let has_pattern_context_path: bool = conn
                .prepare("SELECT context_path FROM confirmed_patterns LIMIT 0")
                .is_ok();
            if !has_pattern_context_path {
                conn.execute_batch(
                    "ALTER TABLE confirmed_patterns ADD COLUMN context_path TEXT",
                )?;
            }
            // Customer without a project: a learned pattern must be able to name
            // the billable party on its own, not only through a project. Added
            // here (not only in SCHEMA) so an existing database learns the column
            // too — its patterns already carry the customer's work.
            let has_pattern_client_id: bool = conn
                .prepare("SELECT client_id FROM confirmed_patterns LIMIT 0")
                .is_ok();
            if !has_pattern_client_id {
                conn.execute_batch("ALTER TABLE confirmed_patterns ADD COLUMN client_id TEXT")?;
            }
        }

        // Track exactly how many klippekort hours were deducted for each time entry,
        // so deletes/edits can reverse the precise amount (idempotent deduction guard).
        // Guard on table existence so migrations on a partial DB don't fail.
        let time_entries_exists: bool = conn
            .prepare("SELECT 1 FROM time_entries LIMIT 0")
            .is_ok();
        if time_entries_exists {
            let has_klippekort_deducted: bool = conn
                .prepare("SELECT klippekort_deducted_hours FROM time_entries LIMIT 0")
                .is_ok();
            if !has_klippekort_deducted {
                conn.execute_batch(
                    "ALTER TABLE time_entries ADD COLUMN klippekort_deducted_hours REAL NOT NULL DEFAULT 0",
                )?;
            }

            // Which pomodoro phase a registration was written from, if any.
            // A phase the user registered as billable time stayed in the day's
            // timeline as an undifferentiated dashed row, so the same 25
            // minutes showed up twice with nothing saying they were the same
            // 25 minutes. Nullable and additive: every existing row keeps its
            // meaning, and no reader of `time_entries` breaks on a new column.
            let has_pomodoro_session: bool = conn
                .prepare("SELECT pomodoro_session_id FROM time_entries LIMIT 0")
                .is_ok();
            if !has_pomodoro_session {
                conn.execute_batch("ALTER TABLE time_entries ADD COLUMN pomodoro_session_id TEXT")?;
            }

            // Created HERE, after the column is guaranteed to exist — same
            // reason as `idx_invoice_number_unique` above. `list_pomodoro_sessions`
            // joins the day's phases against this column, so without the index
            // every timeline load scans the whole `time_entries` table.
            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_time_entries_pomodoro_session
                     ON time_entries(pomodoro_session_id)",
            )?;
        }

        // Add invoice_number to invoice_drafts. Danish bookkeeping law requires
        // sequential, gap-free invoice numbers; the number is assigned atomically
        // at finalisation and persisted here so re-export never renumbers.
        // Guard on table existence so migrations on a partial DB don't fail.
        let invoice_drafts_exists: bool = conn
            .prepare("SELECT 1 FROM invoice_drafts LIMIT 0")
            .is_ok();
        if invoice_drafts_exists {
            let has_invoice_number: bool = conn
                .prepare("SELECT invoice_number FROM invoice_drafts LIMIT 0")
                .is_ok();
            if !has_invoice_number {
                conn.execute_batch("ALTER TABLE invoice_drafts ADD COLUMN invoice_number TEXT")?;
            }

            // Hard backstop for the legal no-reuse guarantee: two finalised
            // invoices can never share a number. Partial index so un-numbered
            // drafts (NULL/empty) do not collide. Created HERE, after the column
            // is guaranteed to exist — creating it in SCHEMA runs before the
            // ALTER above on pre-existing databases and crashes startup.
            conn.execute_batch(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_number_unique
                     ON invoice_drafts(invoice_number)
                     WHERE invoice_number IS NOT NULL AND invoice_number != ''",
            )?;
        }

        // Add client_id to activities and classification_rules so an activity —
        // and the rule that classified it — can name a CUSTOMER without naming a
        // project. Before this, "kunde uden projekt" was inexpressible: a rule
        // without target_project_id never matched (rules.rs) and a confirmed
        // activity stored project_id NULL carried no client at all, so
        // registering it produced an entry billed to nobody.
        // Both are nullable and purely additive: existing rows keep working and
        // keep their project-derived client.
        let activities_exists: bool = conn.prepare("SELECT 1 FROM activities LIMIT 0").is_ok();
        if activities_exists {
            let has_activity_client_id: bool = conn
                .prepare("SELECT client_id FROM activities LIMIT 0")
                .is_ok();
            if !has_activity_client_id {
                conn.execute_batch("ALTER TABLE activities ADD COLUMN client_id TEXT")?;
            }
        }
        let rules_exists: bool = conn
            .prepare("SELECT 1 FROM classification_rules LIMIT 0")
            .is_ok();
        if rules_exists {
            let has_rule_client_id: bool = conn
                .prepare("SELECT target_client_id FROM classification_rules LIMIT 0")
                .is_ok();
            if !has_rule_client_id {
                conn.execute_batch(
                    "ALTER TABLE classification_rules ADD COLUMN target_client_id TEXT",
                )?;
            }
        }

        // The same for the identity layer: a bound signal (a git repo, a folder,
        // a domain, a title keyword) must be able to name a CUSTOMER without
        // naming a project. A customer with no projects is the case this closes —
        // their portal, their support inbox, their kickoff — and it is exactly the
        // signal that has no project to attach to. Nullable and additive, so the
        // `project_id IS NULL` rows keep meaning "not work".
        let matchers_exists: bool = conn
            .prepare("SELECT 1 FROM project_matchers LIMIT 0")
            .is_ok();
        if matchers_exists {
            let has_matcher_client_id: bool = conn
                .prepare("SELECT client_id FROM project_matchers LIMIT 0")
                .is_ok();
            if !has_matcher_client_id {
                conn.execute_batch("ALTER TABLE project_matchers ADD COLUMN client_id TEXT")?;
            }
        }

        // Klippekortets auto-træk-flag (serverens `autoDeduct`). Uden det valgte
        // desktop et kort, brugeren havde slået auto-træk fra på. Standard 1
        // = som serverens standard; næste pull skriver den rigtige værdi.
        let klippekort_exists: bool = conn
            .prepare("SELECT 1 FROM klippekort LIMIT 0")
            .is_ok();
        if klippekort_exists {
            let has_auto_deduct: bool = conn
                .prepare("SELECT auto_deduct FROM klippekort LIMIT 0")
                .is_ok();
            if !has_auto_deduct {
                conn.execute_batch(
                    "ALTER TABLE klippekort ADD COLUMN auto_deduct INTEGER NOT NULL DEFAULT 1",
                )?;
            }
        }

        // Hemmeligheder ud af databasen: sync-token og Billy-nøglen lå som
        // klartekst i `settings`, i en fil brugeren kan kopiere eller læse fra
        // en backup. De flyttes til OS' nøglering. Rækken slettes FØRST når
        // nøglen er skrevet, så en låst nøglering efterlader brugeren med sit
        // login i stedet for uden — migrationen er derfor tryg at køre igen.
        // Samme indgang kaldes af backup-importen, som lægger nøglerne fra en
        // gammel backup tilbage i tabellen.
        crate::secrets::ryd_klarteksthemmeligheder(conn);

        // Én tidsform for registreret tid. `time_entries.start_time` rumlede
        // både UTC-instanser (timeren) og naive lokale væg-tider (formularen),
        // og alt der læser kolonnen som tekst eller med `DATE()` regner den som
        // væg-tid — så en registrering mellem midnat og kl. 02:00 dansk blev
        // bogført på dagen før. Kører hver start og er idempotent; se `tid.rs`.
        crate::tid::normalisér_vægurtider(conn)
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

        Ok(())
    }

    /// Gemmer den seneste beskadigelse, så banneren også vises ved næste start.
    ///
    /// Én række (`id = 1`) og ikke én pr. beskadigelse: kun den seneste er
    /// relevant for brugeren, og flere beskadigelser på samme dag er det samme
    /// problem gentaget. Rækken skrives aldrig tilbage slettet af os — kun fordi
    /// filen den henviser til ikke findes længere (se `læs_gemt_recovery`).
    fn gem_recovery(conn: &Connection, recovery: &Recovery) -> Result<(), Box<dyn std::error::Error>> {
        conn.execute(
            "INSERT OR REPLACE INTO database_recovery (id, backup_sti, årsag)
             VALUES (1, ?1, ?2)",
            rusqlite::params![
                recovery.backup_sti.display().to_string(),
                recovery.årsag,
            ],
        )?;
        Ok(())
    }

    /// Den besked, der skal vises ved denne start — også hvis beskadigelsen skete
    /// ved en tidligere start.
    ///
    /// Rækken ryddes, hvis filen den peger på ikke findes: brugeren harImporteret
    /// sin backup eller slettet den, og en besked om en sikkerhedskopi der ikke
    /// er der, ville få ham til at lede efter en fil der ikke findes. Vi sletter
    /// aldrig filen selv — kun vores egen note om den.
    fn læs_gemt_recovery(conn: &Connection) -> Option<Recovery> {
        let række: Option<(String, String)> = conn
            .query_row(
                "SELECT backup_sti, årsag FROM database_recovery WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();

        let (backup_sti, årsag) = række?;
        let sti = PathBuf::from(&backup_sti);
        if !sti.exists() {
            let _ = conn.execute("DELETE FROM database_recovery WHERE id = 1", []);
            return None;
        }
        Some(Recovery {
            backup_sti: sti,
            årsag,
        })
    }
}

    /// Sand hvis fejlen betyder "filen er ikke en brugbar database".
///
/// Kun de to SQLite-koder der beskriver en beskadiget fil. Alt andet — `BUSY`,
/// `READONLY`, `CANTOPEN`, `FULL`, en disk der er fuld — er forhold appen kan
/// vente på eller rapportere, og **ikke** grund til at smide brugerens
/// database væk.
///
/// - `SQLITE_CORRUPT` er SQLITE_MALFORMED (11) i rusqlites navngivning: et
///   defekt disk-image, typisk en afkortet fil efter en afbrudt skrivning.
/// - `SQLITE_NOTADB` (26) betyder at headeren slet ikke er en SQLite-fil: en
///   fejlskrevet disk, en tekstfil med ret navn, en harddisk-fejl.
///
/// Bemærk at `Connection::open` **ikke** fejler på nogen af dem — SQLite læser
/// først filen ved den første læsning, så det er det første `PRAGMA` her der
/// opdager det.
fn er_beskadigelse(fejl: &(dyn std::error::Error + 'static)) -> bool {
    fn i_kæden(fejl: &(dyn std::error::Error + 'static)) -> bool {
        if let Some(rusqlite::Error::SqliteFailure(f, _)) = fejl.downcast_ref::<rusqlite::Error>() {
            return matches!(f.code, ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase);
        }
        fejl.source().is_some_and(i_kæden)
    }
    i_kæden(fejl)
}

/// Omdøber en beskadiget database, så intet går tabt.
///
/// SQLite skriver i tre filer: `timetrack.db`, `timetrack.db-wal` og
/// `timetrack.db-shm`. `-wal` er de seneste skrivninger, som endnu ikke er
/// flettet ind i hovedfilen — og den indeholder **de nyeste data**. Omdøber
/// vi kun hovedfilen og lader WAL'en ligge, åbner den nye database oveni den
/// gamle WAL og kan fejle igen, eller værre: vise *de gamle rækker* i en app der
/// tror den starter frisk. Derfor flyttes alle tre.
///
/// Navnet får et tidsstempel, så en bruger med to ødelagte starter ikke
/// overskriver sin første sikkerhedskopi med sin anden. Kollision kan slet ikke
/// ske (samme fil, samme sekund), men filen skal aldrig kunne overskrives.
fn flyt_til_sikkerhedskopi(db_path: &Path) -> std::io::Result<PathBuf> {
    let sti = db_path.with_extension(format!(
        "beskadiget-{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));

    // `fs::rename` på Windows overskriver eksisterende filer; på Unix gør den
    // også det. Uden denne tjek kunne to kørsler i samme sekund slette den
    // første sikkerhedskopi — altså slette præcis det vi ville bevare.
    if sti.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!(
                "sikkerhedskopien {} findes allerede — den beskadigede database er ikke blevet rørt",
                sti.display()
            ),
        ));
    }

    std::fs::rename(db_path, &sti)?;

    // WAL og SHM følger med. Fejl her er ikke fatale: hovedfilen er allerede
    // sikker, og en efterladt `-wal` uden sin database er værdiløs for en
    // specialist, men ikke skadelig.
    for endelse in ["-wal", "-shm"] {
        let sidefil = PathBuf::from(format!("{}{endelse}", db_path.display()));
        if sidefil.exists() {
            let _ = std::fs::rename(
                &sidefil,
                PathBuf::from(format!("{}{endelse}", sti.display())),
            );
        }
    }

    Ok(sti)
}

#[cfg(test)]
mod tests {
    use super::schema::SCHEMA;
    use rusqlite::Connection;
    use std::path::PathBuf;
    use std::sync::Arc;

    /// Creates an in-memory SQLite database with foreign keys enabled.
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        conn
    }

    // -----------------------------------------------------------------------
    // Schema creation
    // -----------------------------------------------------------------------

    #[test]
    fn schema_creates_without_error() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("SCHEMA should execute without errors");
    }

    #[test]
    fn schema_is_idempotent() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("first apply");
        conn.execute_batch(SCHEMA).expect("second apply should be idempotent (CREATE IF NOT EXISTS)");
    }

    #[test]
    fn migration_adds_context_path_to_activities() {
        let conn = setup_db();
        // Simulate an older DB whose activities table predates context_path.
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY);
             CREATE TABLE activities (id INTEGER PRIMARY KEY, app_name TEXT, file_path TEXT);",
        )
        .expect("create old tables");

        assert!(
            conn.prepare("SELECT context_path FROM activities LIMIT 0")
                .is_err(),
            "column should be absent before migration"
        );

        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        assert!(
            conn.prepare("SELECT context_path FROM activities LIMIT 0")
                .is_ok(),
            "context_path should exist after migration"
        );
    }

    #[test]
    fn migration_adds_classification_source_and_reason_to_activities() {
        let conn = setup_db();
        // Simulate an older DB whose activities table predates the classification
        // provenance columns. projects must exist because apply_migrations also
        // touches related tables.
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY);
             CREATE TABLE activities (id INTEGER PRIMARY KEY, app_name TEXT, file_path TEXT);",
        )
        .expect("create old tables");

        assert!(
            conn.prepare("SELECT classification_source FROM activities LIMIT 0")
                .is_err(),
            "classification_source should be absent before migration"
        );
        assert!(
            conn.prepare("SELECT classification_reason FROM activities LIMIT 0")
                .is_err(),
            "classification_reason should be absent before migration"
        );

        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        assert!(
            conn.prepare("SELECT classification_source FROM activities LIMIT 0")
                .is_ok(),
            "classification_source should exist after migration"
        );
        assert!(
            conn.prepare("SELECT classification_reason FROM activities LIMIT 0")
                .is_ok(),
            "classification_reason should exist after migration"
        );

        // Idempotent: running again must not fail.
        super::Database::apply_migrations(&conn).expect("second run should be idempotent");
    }

    #[test]
    fn migration_adds_git_repo_and_context_path_to_confirmed_patterns() {
        let conn = setup_db();
        // Simulate an older DB whose confirmed_patterns table predates the
        // git_repo/context_path columns. projects/activities must exist because
        // apply_migrations also touches them.
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY);
             CREATE TABLE activities (id INTEGER PRIMARY KEY, app_name TEXT, file_path TEXT);
             CREATE TABLE confirmed_patterns (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 app_name TEXT,
                 window_title_pattern TEXT,
                 url_pattern TEXT,
                 project_id TEXT,
                 category TEXT,
                 confirmation_count INTEGER NOT NULL DEFAULT 1,
                 last_confirmed TEXT NOT NULL DEFAULT (datetime('now'))
             );",
        )
        .expect("create old tables");

        assert!(
            conn.prepare("SELECT git_repo FROM confirmed_patterns LIMIT 0")
                .is_err(),
            "git_repo should be absent before migration"
        );
        assert!(
            conn.prepare("SELECT context_path FROM confirmed_patterns LIMIT 0")
                .is_err(),
            "context_path should be absent before migration"
        );

        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        assert!(
            conn.prepare("SELECT git_repo FROM confirmed_patterns LIMIT 0")
                .is_ok(),
            "git_repo should exist after migration"
        );
        assert!(
            conn.prepare("SELECT context_path FROM confirmed_patterns LIMIT 0")
                .is_ok(),
            "context_path should exist after migration"
        );

        // Idempotent: running again must not fail.
        super::Database::apply_migrations(&conn).expect("second run should be idempotent");
    }

    #[test]
    fn migration_adds_invoice_number_to_invoice_drafts() {
        let conn = setup_db();
        // Simulate an older DB whose invoice_drafts table predates invoice_number.
        // projects/activities must exist because apply_migrations also touches them.
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY);
             CREATE TABLE activities (id INTEGER PRIMARY KEY, app_name TEXT, file_path TEXT);
             CREATE TABLE invoice_drafts (
                 id TEXT PRIMARY KEY NOT NULL,
                 client_id TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'draft'
             );",
        )
        .expect("create old tables");

        assert!(
            conn.prepare("SELECT invoice_number FROM invoice_drafts LIMIT 0")
                .is_err(),
            "invoice_number should be absent before migration"
        );

        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        assert!(
            conn.prepare("SELECT invoice_number FROM invoice_drafts LIMIT 0")
                .is_ok(),
            "invoice_number should exist after migration"
        );

        // Idempotent: running again must not fail.
        super::Database::apply_migrations(&conn).expect("second run should be idempotent");
    }

    /// Regression: on a database that already had `invoice_drafts` from before
    /// the `invoice_number` column existed, the real init order (execute SCHEMA,
    /// THEN apply_migrations) must not crash. Previously SCHEMA contained a
    /// UNIQUE INDEX on invoice_drafts(invoice_number), which was evaluated before
    /// the ALTER TABLE added the column → "no such column: invoice_number" →
    /// Database::new returned Err → silent startup crash. This exercises the
    /// exact sequence Database::new runs.
    #[test]
    fn schema_then_migrations_succeeds_on_pre_invoice_number_db() {
        let conn = setup_db();
        // Old DB: invoice_drafts predates invoice_number. clients must exist for
        // the FK reference SCHEMA re-declares.
        conn.execute_batch(
            "CREATE TABLE clients (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
             CREATE TABLE invoice_drafts (
                 id TEXT PRIMARY KEY NOT NULL,
                 client_id TEXT NOT NULL REFERENCES clients(id),
                 status TEXT NOT NULL DEFAULT 'draft'
             );",
        )
        .expect("create old tables");

        // Real init order — this is the line that used to fail on the unique index.
        conn.execute_batch(SCHEMA)
            .expect("SCHEMA must not reference migration-added columns");
        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        // Column and its legal no-reuse index must both exist afterwards.
        assert!(
            conn.prepare("SELECT invoice_number FROM invoice_drafts LIMIT 0")
                .is_ok(),
            "invoice_number should exist after init"
        );
        let idx_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='index' AND name='idx_invoice_number_unique'",
                [],
                |row| row.get(0),
            )
            .expect("query sqlite_master for unique index");
        assert!(idx_exists, "idx_invoice_number_unique should exist after init");

        // Idempotent: a second full init pass must also succeed.
        conn.execute_batch(SCHEMA).expect("second SCHEMA pass");
        super::Database::apply_migrations(&conn).expect("second migration pass");
    }

    #[test]
    fn all_expected_tables_exist() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        let expected_tables = [
            "clients",
            "projects",
            "klippekort",
            "time_entries",
            "activities",
            "classification_rules",
            "confirmed_patterns",
            "invoice_drafts",
            "invoice_lines",
            "settings",
            "sync_log",
            "calendar_events",
            "pomodoro_sessions",
        ];

        for table in &expected_tables {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                    rusqlite::params![table],
                    |row| row.get(0),
                )
                .expect("query sqlite_master");
            assert!(exists, "Table '{}' should exist", table);
        }
    }

    // -----------------------------------------------------------------------
    // Client without a project (client_id on activities + classification_rules)
    // -----------------------------------------------------------------------

    /// A database as it existed BEFORE client_id was added, populated with the
    /// kind of rows a real install holds. Migrations must survive this: the
    /// whole point of the migration is that existing customers keep their
    /// tracked time and their rules.
    fn db_before_client_id(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE clients (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
             CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, client_id TEXT REFERENCES clients(id), name TEXT NOT NULL);
             CREATE TABLE activities (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 app_name TEXT, window_title TEXT, category TEXT,
                 project_id TEXT REFERENCES projects(id),
                 confidence REAL, classification_source TEXT,
                 classification_reason TEXT, is_confirmed INTEGER NOT NULL DEFAULT 0,
                 started_at TEXT NOT NULL, duration INTEGER NOT NULL
             );
             CREATE TABLE classification_rules (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
                 condition_type TEXT NOT NULL, condition_op TEXT NOT NULL,
                 condition_value TEXT NOT NULL,
                 target_project_id TEXT REFERENCES projects(id),
                  target_category TEXT, is_active INTEGER NOT NULL DEFAULT 1,
                  created_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              CREATE TABLE confirmed_patterns (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  app_name TEXT, window_title_pattern TEXT, url_pattern TEXT,
                  project_id TEXT REFERENCES projects(id), category TEXT,
                  confirmation_count INTEGER NOT NULL DEFAULT 1,
                  last_confirmed TEXT NOT NULL DEFAULT (datetime('now'))
              );

             INSERT INTO clients (id, name) VALUES ('c1', 'Kunde A');
             INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'Kunde A - website');
             INSERT INTO activities (app_name, window_title, category, project_id, confidence, classification_source, classification_reason, is_confirmed, started_at, duration)
             VALUES ('code', 'Kunde A - website', 'development', 'p1', 0.98, 'rule', 'git_repo website', 1, '2026-09-30T09:00:00', 3600);
             INSERT INTO classification_rules (name, priority, condition_type, condition_op, condition_value, target_project_id, target_category)
             VALUES ('Kunde A website', 10, 'git_repo', 'equals', 'website', 'p1', 'development');
              INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
              VALUES ('code', 'Kunde A - website', 'p1', 'development', 3);
              CREATE TABLE project_matchers (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  project_id TEXT REFERENCES projects(id),
                  kind TEXT NOT NULL, value TEXT NOT NULL,
                  created_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              CREATE UNIQUE INDEX idx_project_matchers_unique ON project_matchers(kind, value);
              CREATE INDEX idx_project_matchers_project ON project_matchers(project_id);
              -- A bound signal to a real project, and one deliberately marked
              -- NOT work. The second one is the row whose meaning the migration
              -- must NOT change: it names neither project nor customer.
              INSERT INTO project_matchers (project_id, kind, value)
              VALUES ('p1', 'git_repo', 'website');
              INSERT INTO project_matchers (project_id, kind, value)
              VALUES (NULL, 'domain', 'facebook.com');",
        )
        .expect("create a pre-client_id database with data");
    }

    #[test]
    fn migration_adds_client_id_to_activities_and_rules_keeping_data() {
        let conn = setup_db();
        db_before_client_id(&conn);

        assert!(
            conn.prepare("SELECT client_id FROM activities LIMIT 0").is_err(),
            "activities.client_id should be absent before migration"
        );
        assert!(
            conn.prepare("SELECT target_client_id FROM classification_rules LIMIT 0").is_err(),
            "classification_rules.target_client_id should be absent before migration"
        );

        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        // The tracked activity is still there, still on its project, and now
        // simply has no customer of its own until something assigns one. A
        // migration that dropped or shifted data would fail these.
        let row: (Option<String>, Option<String>, Option<String>, i64) = conn
            .query_row(
                "SELECT project_id, client_id, classification_reason, duration
                 FROM activities WHERE app_name = 'code'",
                [],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get(3)?,
                    ))
                },
            )
            .expect("the existing activity must survive the migration");

        assert_eq!(row.0.as_deref(), Some("p1"), "project_id must be untouched");
        assert_eq!(row.1, None, "an existing activity has no customer until assigned");
        assert_eq!(
            row.2.as_deref(),
            Some("git_repo website"),
            "classification_reason must be untouched"
        );
        assert_eq!(row.3, 3600, "duration must be untouched");

        let rule: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT target_project_id, target_client_id
                 FROM classification_rules WHERE name = 'Kunde A website'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("the existing rule must survive the migration");
        assert_eq!(rule.0.as_deref(), Some("p1"), "target_project_id must be untouched");
        assert_eq!(rule.1, None, "an existing rule has no customer target until set");
    }

    /// A learned pattern must survive the migration and be able to name a
    /// customer afterwards. Its project, category and confirmation count are
    /// what the user taught the app — losing any of them would silently lower
    /// the confidence of every future classification.
    #[test]
    fn migration_adds_client_id_to_confirmed_patterns_keeping_data() {
        let conn = setup_db();
        db_before_client_id(&conn);

        assert!(
            conn.prepare("SELECT client_id FROM confirmed_patterns LIMIT 0").is_err(),
            "confirmed_patterns.client_id should be absent before migration"
        );

        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        let (project_id, client_id, category, count): (Option<String>, Option<String>, Option<String>, i64) = conn
            .query_row(
                "SELECT project_id, client_id, category, confirmation_count FROM confirmed_patterns",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("the learned pattern must survive the migration");

        assert_eq!(project_id.as_deref(), Some("p1"), "project_id must be untouched");
        assert_eq!(client_id, None, "an existing pattern has no customer of its own until set");
        assert_eq!(category.as_deref(), Some("development"), "category must be untouched");
        assert_eq!(count, 3, "confirmation_count must be untouched");

        // A customer with no project can now be learned: this row could not
        // even be written before the column existed.
        conn.execute_batch("INSERT INTO clients (id, name) VALUES ('c2', 'Kunde uden projekter');")
            .expect("customer");
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, client_id, category)
             VALUES ('mail', 'Post fra kunde', 'c2', 'development')",
            [],
        )
        .expect("a pattern may name a customer without a project");
    }

    /// A bound signal must survive the migration, keep its project, and keep
    /// meaning "not work" when it named no project — the NULL customer it gains
    /// is not a new destination, it is the absence of one.
    #[test]
    fn migration_adds_client_id_to_project_matchers_keeping_data() {
        let conn = setup_db();
        db_before_client_id(&conn);

        assert!(
            conn.prepare("SELECT client_id FROM project_matchers LIMIT 0")
                .is_err(),
            "project_matchers.client_id should be absent before migration"
        );

        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        let rows: Vec<(Option<String>, Option<String>, String, String)> = conn
            .prepare(
                "SELECT project_id, client_id, kind, value
                 FROM project_matchers ORDER BY kind",
            )
            .expect("read the matchers back")
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .expect("query")
            .flatten()
            .collect();

        assert_eq!(rows.len(), 2, "no matcher may be lost or duplicated");
        // domain/facebook.com — sorted first.
        assert_eq!(rows[0].0, None, "its project must be untouched");
        assert_eq!(
            rows[0].1, None,
            "a not-work signal must stay not-work: NULL customer is not a target"
        );
        assert_eq!(rows[0].2, "domain");
        // git_repo/website.
        assert_eq!(rows[1].0.as_deref(), Some("p1"), "its project must be untouched");
        assert_eq!(
            rows[1].1, None,
            "an existing binding has no customer of its own; the project implies it"
        );
        assert_eq!(rows[1].3, "website");

        // A customer with no projects can now be bound to a signal — a row that
        // could not be written before the column existed.
        conn.execute(
            "INSERT INTO project_matchers (client_id, kind, value)
             VALUES ('c1', 'domain', 'kunde.dk')",
            [],
        )
        .expect("a signal may name a customer without a project");

        // Idempotent: the named index and the column must survive a second run.
        super::Database::apply_migrations(&conn).expect("second migration must be a no-op");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_matchers", [], |r| r.get(0))
            .expect("count matchers");
        assert_eq!(count, 3, "re-running the migration must not duplicate rows");
    }

    #[test]
    fn migration_is_idempotent_on_a_database_with_data() {        let conn = setup_db();
        db_before_client_id(&conn);

        super::Database::apply_migrations(&conn).expect("first migration");
        super::Database::apply_migrations(&conn).expect("second migration must be a no-op");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))
            .expect("count activities");
        assert_eq!(count, 1, "re-running the migration must not duplicate rows");
    }

    /// Den tidsmigration, der gør en database fra **før rettelsen** brugbar igen,
    /// skal køre som en del af `apply_migrations` — altså ved hver opstart, ikke
    /// kun når nogen huser at kalde porten.
    ///
    /// Denne test dømmer derfor kalderen og ikke porten: `tid.rs`' egne tests
    /// kalder `normalisér_vægurtider` direkte og ville være grønne, selv om
    /// opstarten aldrig kaldte den. Det er præcis den falske grøn, der lader en
    /// gammel database ligge med registreringer på den forkerte dag.
    #[test]
    fn opstart_gor_en_database_fraa_foer_rettelsen_brugbar_igen() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("SCHEMA");

        // Den gamle kode skrev timeren som et UTC-øjeblik, mens alt der læser
        // kolonnen regner klokkeslættet som lokal væg-tid. Dagen rykker derfor
        // nøjagtig så meget som maskinens egen offset er fra UTC — så testen
        // tager det klokkeslæt hvor rykket er **størst**: 00:30 når zonen er
        // foran UTC (dagen rykker tilbage), 23:30 når den er bagved (dagen
        // rykker frem). I UTC er forskydningen nul, og da er der ingen forkert
        // dag at finde — dømningen står så på formen i stedet, længere nede.
        let nu = chrono::Local::now();
        let offset = nu.offset().local_minus_utc();
        let (væg_dag, timepunkt) = if offset > 0 {
            (nu.date_naive() + chrono::Duration::days(1), (0, 30))
        } else if offset < 0 {
            (nu.date_naive(), (23, 30))
        } else {
            (nu.date_naive(), (12, 0))
        };
        let klokkeslæt = væg_dag
            .and_hms_opt(timepunkt.0, timepunkt.1, 0)
            .expect("00:30, 12:00 og 23:30 findes altid");
        let øjeblik = klokkeslæt
            .and_local_timezone(chrono::Local)
            .earliest()
            .expect("gyldigt tidspunkt");
        // Som den gamle kode skrev den: UTC med et explicit offset.
        let som_utc = øjeblik
            .with_timezone(&chrono::Utc)
            .format("%Y-%m-%dT%H:%M:%S%.3f+00:00")
            .to_string();
        conn.execute(
            "INSERT INTO time_entries (id, start_time, duration, is_running, source)
             VALUES ('gammel', ?1, 3600, 0, 'timer')",
            rusqlite::params![som_utc],
        )
        .expect("række fra før rettelsen");

        // Dagen den står på, før opstartens migrationer.
        let dag = |conn: &Connection| -> String {
            conn.query_row(
                "SELECT DATE(start_time) FROM time_entries WHERE id = 'gammel'",
                [],
                |r| r.get(0),
            )
            .expect("dagen")
        };
        let dag_før = dag(&conn);
        let forventet = øjeblik
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d")
            .to_string();

        if offset != 0 {
            assert_ne!(
                dag_før, forventet,
                "testen skal starte med en række på den FORKERTE dag, ellers dømmer \
                 den ingenting: {dag_før}"
            );
        } else {
            // I UTC er et UTC-øjeblik og en væg-tid det samme klokkeslæt, så der
            // findes ingen forkert dag at pege på. Dømningen af dagen er så
            // umulig her — formen og øjeblikket længere nede dømmer i stedet,
            // og de kan ikke være grønne hvis opstarten aldrig kaldte porten.
            assert_eq!(
                dag_før, forventet,
                "et UTC-øjeblik i UTC står på dagen det peger på"
            );
        }

        super::Database::apply_migrations(&conn).expect("opstartens migrationer");

        let (start_efter, dag_efter): (String, String) = conn
            .query_row(
                "SELECT start_time, DATE(start_time) FROM time_entries WHERE id = 'gammel'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("rækken efter opstarten");

        assert_eq!(
            dag_efter, forventet,
            "opstarten skal flytte en gammel timer-registrering til den dag den \
             faktisk blev taget"
        );
        assert!(
            !start_efter.contains('+') && !start_efter.ends_with('Z'),
            "opstarten skal skrive lokal væg-tid, ellers læser hver daggrænse \
             den som UTC: {start_efter}"
        );
        // Og den dømmer det, der ikke kan være sandt uden en kørsel: samme
        // øjeblik. Uden denne linje ville testen være grøn i UTC, selv om
        // opstarten slet ikke kaldte migrationen.
        assert_eq!(
            crate::tid::øjeblik(&start_efter),
            Some(øjeblik.timestamp()),
            "migrationen må omskrive formen, aldrig flytte registreringen i tid"
        );
    }

    #[test]
    fn activity_can_name_a_client_without_a_project() {        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("SCHEMA");
        super::Database::apply_migrations(&conn).expect("migrations");

        conn.execute_batch(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Kunde A');",
        )
        .expect("the customer must exist for the foreign key to hold");
        conn.execute(
            "INSERT INTO activities (app_name, started_at, duration, client_id)
             VALUES ('zoom', '2026-09-30T10:00:00', 1800, 'c1')",
            [],
        )
        .expect("an activity may carry a customer and no project");

        let (project_id, client_id): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT project_id, client_id FROM activities WHERE app_name = 'zoom'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("read back");
        assert_eq!(project_id, None, "no project is the whole point");
        assert_eq!(client_id.as_deref(), Some("c1"), "the customer is what gets billed");
    }

    #[test]
    fn fresh_schema_carries_client_id_on_activities_and_rules() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("SCHEMA");
        assert!(
            conn.prepare("SELECT client_id FROM activities LIMIT 0").is_ok(),
            "a fresh database must have activities.client_id without any migration"
        );
        assert!(
            conn.prepare("SELECT target_client_id FROM classification_rules LIMIT 0").is_ok(),
            "a fresh database must have classification_rules.target_client_id without any migration"
        );
    }

    // -----------------------------------------------------------------------
    // Foreign key enforcement
    // -----------------------------------------------------------------------

    #[test]
    fn foreign_key_project_to_client_enforced() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        // Inserting a project with a non-existent client_id should fail
        let result = conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES ('p1', 'nonexistent-client', 'Test')",
            [],
        );
        assert!(result.is_err(), "FK from projects.client_id to clients.id should be enforced");
    }

    #[test]
    fn foreign_key_time_entry_to_project_enforced() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        let result = conn.execute(
            "INSERT INTO time_entries (id, project_id, start_time, source) VALUES ('te1', 'nonexistent-proj', '2026-01-01T00:00:00Z', 'manual')",
            [],
        );
        assert!(result.is_err(), "FK from time_entries.project_id to projects.id should be enforced");
    }

    #[test]
    fn foreign_key_klippekort_to_client_enforced() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        let result = conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours) VALUES ('k1', 'nonexistent', 'Test', 10.0)",
            [],
        );
        assert!(result.is_err(), "FK from klippekort.client_id to clients.id should be enforced");
    }

    #[test]
    fn foreign_key_invoice_lines_to_invoice_enforced() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        let result = conn.execute(
            "INSERT INTO invoice_lines (invoice_id, description) VALUES ('nonexistent-inv', 'Test line')",
            [],
        );
        assert!(result.is_err(), "FK from invoice_lines.invoice_id to invoice_drafts.id should be enforced");
    }

    #[test]
    fn valid_foreign_key_chain_succeeds() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        // client -> project -> time_entry chain
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Test Client')",
            [],
        ).expect("insert client");

        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES ('p1', 'c1', 'Test Project')",
            [],
        ).expect("insert project with valid client FK");

        conn.execute(
            "INSERT INTO time_entries (id, project_id, client_id, start_time, source) VALUES ('te1', 'p1', 'c1', '2026-01-01T00:00:00Z', 'manual')",
            [],
        ).expect("insert time_entry with valid FKs");
    }

    // -----------------------------------------------------------------------
    // Indexes
    // -----------------------------------------------------------------------

    #[test]
    fn expected_indexes_exist() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        let expected_indexes = [
            "idx_projects_client_id",
            "idx_time_entries_project_id",
            "idx_time_entries_client_id",
            "idx_time_entries_start_time",
            "idx_time_entries_is_running",
            "idx_time_entries_klippekort_id",
            "idx_activities_started_at",
            "idx_activities_project_id",
            "idx_activities_unclassified",
            "idx_klippekort_client_id",
            "idx_klippekort_project_id",
            "idx_klippekort_status",
            "idx_sync_log_synced",
            "idx_sync_log_entity",
            "idx_calendar_events_start",
            "idx_calendar_events_source",
            "idx_confirmed_patterns_app",
        ];

        for idx in &expected_indexes {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='index' AND name=?1",
                    rusqlite::params![idx],
                    |row| row.get(0),
                )
                .expect("query sqlite_master for index");
            assert!(exists, "Index '{}' should exist", idx);
        }
    }

    // -----------------------------------------------------------------------
    // Basic CRUD smoke tests
    // -----------------------------------------------------------------------

    #[test]
    fn crud_client_insert_and_query() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        conn.execute(
            "INSERT INTO clients (id, name, email, company) VALUES ('c1', 'Acme Corp', 'info@acme.dk', 'Acme')",
            [],
        ).expect("insert client");

        let name: String = conn
            .query_row("SELECT name FROM clients WHERE id = 'c1'", [], |row| row.get(0))
            .expect("query client");
        assert_eq!(name, "Acme Corp");
    }

    #[test]
    fn settings_upsert_on_conflict() {
        let conn = setup_db();
        conn.execute_batch(SCHEMA).expect("create schema");

        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'dark')",
            [],
        ).expect("insert setting");

        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'light') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        ).expect("upsert setting");

        let value: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'theme'", [], |row| row.get(0))
            .expect("query setting");
        assert_eq!(value, "light");
    }

    /// Hemmelighederne skal ud af `settings` og ind i OS' nøglering, også når
    /// de ligger i en database fra den forrige version. Testen bygger en
    /// FØR-versionsdatabase med de to nøgler i klartekst og en helt almindelig
    /// indstilling ved siden af, kører hele `apply_migrations` og dømmer både
    /// at `settings` er ryddet og at indstillingen er urørt.
    ///
    /// `ai_config` er med, fordi nøglen dér lå *inde i* en JSON-klump: en
    /// database hvor kun de to rækker ryddes, ville have efterladt den
    /// tredje nøgle i klartekst — præcis den, der er værd mest.
    #[test]
    fn migration_flytter_klarteksthemmeligheder_til_noegleringen() {
        let conn = setup_db();
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY, estimated_hours REAL);
             CREATE TABLE activities (id INTEGER PRIMARY KEY, app_name TEXT, file_path TEXT);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )
        .expect("tabeller fra den forrige version");
        for (nøgle, værdi) in [
            ("sync_token", "gammelt-token"),
            ("billy_api_key", "gammel-billy-nøgle"),
            (
                "ai_config",
                r#"{"provider":"anthropic","api_key":"sk-klartekst","model":"claude-haiku-4-5-20251001","base_url":null}"#,
            ),
            ("sync_email", "mads@eksempel.dk"),
            ("theme", "dark"),
        ] {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![nøgle, værdi],
            )
            .expect("række fra den forrige version");
        }

        let butik: Arc<keyring_core::CredentialStore> =
            keyring_core::mock::Store::new().expect("mock-butik");
        crate::secrets::brug_testbutik(Arc::clone(&butik));

        super::Database::apply_migrations(&conn).expect("migrations should succeed");

        let tilbage: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT key FROM settings ORDER BY key")
                .expect("læs");
            stmt.query_map([], |r| r.get::<_, String>(0))
                .expect("rækker")
                .flatten()
                .collect()
        };
        assert_eq!(
            tilbage,
            vec![
                "ai_config".to_string(),
                "sync_email".to_string(),
                "theme".to_string()
            ],
            "kun hemmelighederne må forlade databasen"
        );
        assert_eq!(
            crate::secrets::hent("sync_token").unwrap().as_deref(),
            Some("gammelt-token")
        );
        assert_eq!(
            crate::secrets::hent("billy_api_key").unwrap().as_deref(),
            Some("gammel-billy-nøgle")
        );
        assert_eq!(
            crate::secrets::hent(crate::secrets::AI_NØGLE).unwrap().as_deref(),
            Some("sk-klartekst")
        );

        // Klumpen er stadig en brugbar config — kun nøglen er væk. Uden dette
        // ville migrationen have gjort brugerens AI-indstillinger umulige at
        // læse, hvilket er den anden måde at tabe en nøgle på.
        let klump: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'ai_config'",
                [],
                |r| r.get(0),
            )
            .expect("klump");
        assert!(!klump.contains("sk-klartekst"), "nøglen må ikke stå i klumpen");
        let json: serde_json::Value = serde_json::from_str(&klump).expect("gyldig JSON");
        assert_eq!(json["provider"], "anthropic");
        assert_eq!(json["model"], "claude-haiku-4-5-20251001");
    }

    // -----------------------------------------------------------------------
    // lås — en forgiftet mutex må ikke gøre databasen utilgængelig
    // -----------------------------------------------------------------------

    /// Panikker en tråd, mens den holder databaselåsen, står låsen *forgiftet*
    /// indtil alle følgende lås ser det. Forbindelsen bagved er stadig brugbar —
    /// vi holder den kun under ét statement — så porten genopbygger låsen og
    /// arbejder videre.
    ///
    /// Dette er selve beviset på, at `lås` ikke kan forsvinde: tre steder
    /// (`license.rs` ×2, `context.rs`) behandlede forgiftningen som et *svar*,
    /// ikke som en fejl, og de svar var «prøveperioden må ikke genbegynde efter
    /// en uretstilbagerulning» og «ingen projektforslag».
    #[test]
    fn laas_giver_adgang_til_en_forgiftet_database() {
        use std::sync::Mutex;

        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        let db = Mutex::new(conn);

        // En tråd der panikker under låsen. Det er den eneste måde en Mutex
        // bliver forgiftet på — intet i appen sætter flaget direkte. Panikken
        // fanges, fordi `thread::scope` ellers genudsender den i den tråd der
        // starter scopet, og testen så fejlede med panikkens tekst i stedet for
        // at dømme porten.
        let panik = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            std::thread::scope(|omfang| {
                omfang.spawn(|| {
                    let _vagt = db.lock().expect("låsen er ikke forgiftet endnu");
                    panic!("skrivning, der går galt under låsen");
                });
            });
        }));
        assert!(panik.is_err(), "tråden skal panikkere for at forgifte låsen");
        assert!(db.is_poisoned(), "testen skal starte med en forgiftet lås");

        // Læsning gennem porten.
        let rækker: i64 = crate::db::lås(&db)
            .query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))
            .expect("en forgiftet lås må ikke gøre tabeller ulæselige");

        // Og skrivning — det er den, de tre steder mistede.
        crate::db::lås(&db)
            .execute(
                "INSERT INTO clients (id, name, created_at, updated_at)
                 VALUES ('c1', 'Acme', '2026-01-01', '2026-01-01')",
                [],
            )
            .expect("skrivning gennem en forgiftet lås");

        let gemt: i64 = crate::db::lås(&db)
            .query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))
            .expect("optælling");
        assert_eq!(rækker, 0);
        assert_eq!(gemt, 1, "rækken skal være skrevet, ikke droppet i stilhed");
    }

    // -----------------------------------------------------------------------
    // Crash recovery: en beskadiget database må ikke slette brugerens tid
    //
    // Beviset på at porten virker ligger i `åbn_med_recovery` og dens to
    // kaldssteder — ikke i selve `er_beskadigelse`. En port der dømmer
    // klassifikationen alene ville være grøn, selv om ingen kaldte den.
    // -----------------------------------------------------------------------

    /// En midlertidig mappe med en database-sti i. Ryddes ved testens afslut,
    /// så en fejl i en test ikke efterlader filer i temp.
    struct TempDb {
        dir: std::path::PathBuf,
        sti: std::path::PathBuf,
    }

    impl TempDb {
        fn ny(tagnavn: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "tt_recovery_{tagnavn}_{}_{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("opret temp-dir");
            let sti = dir.join("timetrack.db");
            TempDb { dir, sti }
        }

        /// Skriver en database med rigtige data i den — så vi kan bevise at
        /// data fra *før* beskadigelsen stadig kan hentes ud af sikkerhedskopien.
        fn med_data(&self) {
            let conn = Connection::open(&self.sti).expect("åbn");
            conn.execute_batch(SCHEMA).expect("skema");
            conn.execute(
                "INSERT INTO clients (id, name, created_at, updated_at)
                 VALUES ('c1', 'Vigtig Kunde', '2026-01-01', '2026-01-01')",
                [],
            )
            .expect("skriv kunde");
            conn.execute_batch(
                "INSERT INTO time_entries (id, client_id, description, start_time, duration, created_at, updated_at)
                 VALUES ('t1', 'c1', 'Registrering der ikke må forsvinde',
                         '2026-01-02T09:00:00', 3600, '2026-01-01', '2026-01-01');",
            )
            .expect("skriv registrering");
            drop(conn);
        }

        /// Ødelægger filen bag om SQLite, som en afbrudt skrivning eller en
        /// fejlskrevet disk gør: headeren og de første sider overskrives, så
        /// filen ligner en database, men ikke er en.
        fn beskadig_fil(&self) {
            let mut bytes = std::fs::read(&self.sti).expect("læs");
            let ødelagt = b"SQLite format 3\0\0\0\0\x00\x00\x00\x01\x00\x00\x00\x01\x00\x00\x00";
            for (i, b) in ødelagt.iter().enumerate() {
                bytes[i] = *b;
            }
            // Ødelæg også midt i filen, så selv en sidevis tjek fanger det.
            for i in (bytes.len() / 2)..(bytes.len() / 2 + 64).min(bytes.len()) {
                bytes[i] = 0xA5;
            }
            std::fs::write(&self.sti, &bytes).expect("skriv ødelagt fil");
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// HOVEDTESTEN. Uden recovery døde appen her ved start: `open` lykkedes,
    /// det første `PRAGMA` fejlede, og `lib.rs` gjorde `?` på fejlen. I release
    /// så brugeren intet — hverken vindue eller besked.
    #[test]
    fn beskadiget_database_giver_en_startende_app_og_beholder_data() {
        let temp = TempDb::ny("hoved");
        temp.med_data();

        // Bevis på at filen faktisk er ubrugelig *inden* recovery — ellers
        // dømmer testen en fil, der aldrig var beskadiget.
        let rå = std::fs::read(&temp.sti).expect("læs");
        assert!(rå.starts_with(b"SQLite format 3\0"), "filen skal ligne en database");

        temp.beskadig_fil();
        assert!(
            super::Database::åbn(&temp.sti).is_err(),
            "beskadigelsen skal faktisk give en fejl, ellers tester vi ingenting"
        );

        let (conn, recovery) = super::Database::åbn_med_recovery(&temp.sti)
            .expect("appen skal starte på en ny database");
        drop(conn);

        let recovery = recovery.expect("recovery skal være Some, ellers får brugeren ingen besked");
        assert!(
            recovery.backup_sti.exists(),
            "den beskadigede database skal ligge ved {}, ikke være slettet",
            recovery.backup_sti.display()
        );
        // Navnet skal sige det til brugeren: filen er ikke `timetrack.db` mere.
        assert!(
            recovery.backup_sti.to_string_lossy().contains("beskadiget"),
            "filnavnet skal være genkendeligt for brugeren, lå {} nu",
            recovery.backup_sti.display()
        );

        // Den nye database skal virke — alle tabeller, og læsbar.
        let conn = Connection::open(&temp.sti).expect("åbn den nye");
        let tabeller: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='clients'",
                [],
                |r| r.get(0),
            )
            .expect("læs sqlite_master");
        assert_eq!(tabeller, 1, "den nye database skal have hele skemaet");
        let kunder: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))
            .expect("læs clients");
        assert_eq!(kunder, 0, "den nye database skal være tom, ikke fyldt med halvskrevne rækker");

        // Nøglen i missionen: ingenting går tabt. Sikkerhedskopien skal kunne
        // læses af en specialist, så de kan hente tiden tilbage.
        let gammel = Connection::open(&recovery.backup_sti).expect("sikkerhedskopien skal være en fil");
        // Den er bevaret præcis som den var — ikke slettet, ikke overskrevet.
        assert_eq!(
            std::fs::metadata(&recovery.backup_sti).expect("metadata").len(),
            rå.len() as u64,
            "sikkerhedskopien skal have præcis den ødelagte fils størrelse — intet slettet"
        );
        drop(gammel);
    }

    /// Data fra FØR beskadigelsen skal kunne hentes ud af sikkerhedskopien.
    ///
    /// Beviset på at vi ikke bare flytter en vilkårlig fil: tidsstemplet i navnet
    /// gør det ingen som helt at teste uden data.
    #[test]
    fn sikkerhedskopien_beholder_data_fra_for_beskadigelsen() {
        let temp = TempDb::ny("data");
        temp.med_data();

        // Bevis at data er der, før vi ødelægger.
        {
            let conn = Connection::open(&temp.sti).expect("åbn");
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM time_entries", [], |r| r.get(0))
                .expect("optælling");
            assert_eq!(n, 1, "testen skal starte med en registrering at miste");
        }

        temp.beskadig_fil();
        let (_, recovery) = super::Database::åbn_med_recovery(&temp.sti).expect("start");
        let recovery = recovery.expect("recovery");

        // Filerne er bevaret. SQLite kan ikke læse den ødelagte side (det er
        // pointen), så vi dømmer at BYTES er bevaret — det er det, en specialist
        // kan bruge (recovery-værktøjer, `sqlite3 .recover`).
        let bevaret = std::fs::metadata(&recovery.backup_sti).expect("metadata").len();
        let ødelagt = std::fs::metadata(&temp.sti).expect("den nye skal også findes");
        assert!(
            bevaret > 0,
            "sikkerhedskopien må ikke være en tom fil — så er tiden væk"
        );
        assert_ne!(
            bevaret, ødelagt.len(),
            "sikkerhedskopien skal ikke bare være den nye database"
        );
    }

    /// WAL'en følger med. Den indeholder de **nyeste** data, og hvis den bliver
    /// liggende ved siden af den nye database, åbner den nye oveni den gamle WAL
    /// — så appen kan starte "frisk" og vise de gamle rækker, eller fejle igen.
    ///
    /// Testen dømmer `flyt_til_sikkerhedskopi` direkte, ikke hele
    /// `åbn_med_recovery`. Det er ikke en lavere standard — det er målt: SQLite
    /// **sletter selv** en `-wal` der ikke passer til hovedfilen, så snart den
    /// åbner databasen (`probe` under denne test). Målt i Node og i Rust er det
    /// den normale adfærd, og derfor ville `åbn_med_recovery` slet ikke nå at se
    /// WAL'en. At dømme den dér ville være en grøn test om intet. Det `åbn`
    /// faktisk gør med WAL'en — at den fjerner den — er korrekt: en WAL der ikke
    /// passer til den nye database må ikke åbnes oveni den.
    ///
    /// WAL-filerne lægges ned som filer i stedet for at lade SQLite lave dem:
    /// SQLite sletter `-wal`/`-shm` når den sidste connection lukkes **rent**, så
    /// en test der bare skriver og lukker ville aldrig se en WAL. Det er også det
    /// forkerte at efterligne — et krasj giver *ikke* en ren lukning, og det er
    /// krasjet derfor de to filer ligger der ved næste start. Det er det scenarie
    /// recovery-vejen skal klare.
    #[test]
    fn wal_og_shm_følger_med_til_sikkerhedskopien() {
        let temp = TempDb::ny("wal");
        temp.med_data();

        let wal_sti = temp.sti.with_extension("db-wal");
        let shm_sti = temp.sti.with_extension("db-shm");
        std::fs::write(&wal_sti, [0x37u8; 4096]).expect("skriv WAL-fil");
        std::fs::write(&shm_sti, [0x11u8; 1024]).expect("skriv SHM-fil");

        temp.beskadig_fil();
        let backup_sti = super::flyt_til_sikkerhedskopi(&temp.sti).expect("flyt");

        assert!(
            !wal_sti.exists(),
            "WAL'en må ikke blive liggende ved siden af den nye database — \
             den ville blive åbnet oveni den og vise gamle rækker i en 'frisk' app"
        );
        assert!(
            !shm_sti.exists(),
            "SHM'en skal også flyttes, ellers peger den på en fil der ikke findes"
        );
        for endelse in ["-wal", "-shm"] {
            let flyttet = PathBuf::from(format!("{}{endelse}", backup_sti.display()));
            assert!(
                flyttet.exists(),
                "{endelse} skal følge med til {} — de nyeste data lå dér",
                backup_sti.display()
            );
        }
    }

    /// Beskeden om tabt tid skal overleve en genstart. Fundet 1/10 i review.
    ///
    /// Før dette var `recovery` et felt i processens hukommelse, sat
    /// udelukkende i den `åbn_med_recovery` der lige har omdøbt filen. Anden start
    /// på samme sti gav `recovery = None` — målt, ikke hypotetiseret — fordi
    /// `timetrack.db` nu er en gyldig tom database. Scenariet er det værste i
    /// hele klassen: brugeren ser banneret, genstarter for at geninstallere, og
    /// ved næste opstart er banneret væk for altid, mens filen med hans måned
    /// registrerede tid ligger ubemærket ved siden af. Data er ikke tabt, men
    /// brugeren får aldrig at vide at de findes.
    ///
    /// Testen kalder derfor `åbn_med_recovery` **to gange på samme sti** — præcis
    /// den rækkefølge de ni andre tests ikke dækker, fordi de dømmer tilstanden
    /// efter *første* start, som er den eneste de kan nå.
    #[test]
    fn beskeden_overlever_en_genstart() {
        let temp = TempDb::ny("genstart");
        temp.med_data();
        temp.beskadig_fil();

        let (_, første) = super::Database::åbn_med_recovery(&temp.sti).expect("første start");
        let backup_sti = første
            .as_ref()
            .expect("filen var beskadiget, så første start skal fortælle det")
            .backup_sti
            .clone();
        assert!(backup_sti.exists(), "sikkerhedskopien skal ligge på disk");

        // Anden start. `timetrack.db` er nu en gyldig database, så intet er
        // beskadiget og intet flyttes — heraf det gamle `None`.
        let (conn, anden) = super::Database::åbn_med_recovery(&temp.sti).expect("anden start");
        assert_eq!(
            anden.as_ref().map(|r| r.backup_sti.clone()),
            Some(backup_sti.clone()),
            "beskeden om brugerens tabte tid skal følge med hver start, indtil han \
             har hentet filen — ellers er der ingen vej tilbage til tiden"
        );
        assert!(
            backup_sti.exists(),
            "beskeden må ikke pege på en fil brugeren ikke kan hente"
        );

        // Bevis på at beskeden ligger i databasen, ikke i processen: den er
        // læst tilbage gennem den nye forbindelse, som intet kender ud over
        // databasefilen.
        let rækker: i64 = conn
            .query_row("SELECT COUNT(*) FROM database_recovery", [], |r| r.get(0))
            .expect("optælling");
        assert_eq!(rækker, 1, "beskeden skal være gemt i databasen");
    }

    /// En besked om en sikkerhedskopi der ikke findes, er værre end ingen.
    ///
    /// Brugeren har nu importeret sin backup eller slettet filen, og så er der
    /// intet at fortælle. Tilstanden skal ryddes, så den ikke bliver liggende og
    /// dukker op igen senere — men vi sletter aldrig filen selv.
    #[test]
    fn beskeden_ryddes_når_filen_er_væk() {
        let temp = TempDb::ny("fil_væk");
        temp.med_data();
        temp.beskadig_fil();

        let (_, _) = super::Database::åbn_med_recovery(&temp.sti).expect("første start");
        let (_, anden) = super::Database::åbn_med_recovery(&temp.sti).expect("anden start");
        let backup_sti = anden.expect("beskeden følger med").backup_sti;
        assert!(backup_sti.exists());

        std::fs::remove_file(&backup_sti).expect("brugeren hentede filen væk");
        let (conn, tredje) = super::Database::åbn_med_recovery(&temp.sti).expect("tredje start");
        assert!(
            tredje.is_none(),
            "filen findes ikke længere — en besked om den ville få brugeren til \
             at lede efter noget der ikke er der"
        );
        let rækker: i64 = conn
            .query_row("SELECT COUNT(*) FROM database_recovery", [], |r| r.get(0))
            .expect("optælling");
        assert_eq!(
            rækker, 0,
            "den døde besked skal ryddes, ellers dukker den op igen senere"
        );
    }

    /// Beviset for at de to foregående tests ikke er grønne ved et tilfælde:
    /// SQLite sletter en uvedkommende `-wal` ved åbning, så man kan ikke regne
    /// med at WAL'en stadig er der, når `åbn_med_recovery` har kørt. Skulle
    /// SQLite ændre den adfærd, holder `wal_og_shm_følger_med_til_sikkerhedskopien`
    /// stadig sit, og denne test fortæller hvorfor den ikke kan.
    #[test]
    fn sqlite_sletter_en_wal_der_ikke_passer_til_hovedfilen() {
        let temp = TempDb::ny("wal_slettes");
        temp.med_data();
        temp.beskadig_fil();

        let wal_sti = temp.sti.with_extension("db-wal");
        std::fs::write(&wal_sti, [0x37u8; 4096]).expect("skriv WAL-fil");
        assert!(wal_sti.exists());

        let (_, recovery) = super::Database::åbn_med_recovery(&temp.sti).expect("start");
        assert!(recovery.is_some(), "filen var beskadiget");
        assert!(
            !wal_sti.exists(),
            "målt 1/10: SQLite sletter selv en WAL der ikke passer til hovedfilen — \
             derfor dømmes flytningen direkte i stedet for gennem åbn_med_recovery"
        );
    }


    /// DET VIGTIGSTE: recovery må **kun** ske ved beskadigelse.
    ///
    /// En disk der er fuld, en låst fil, en mappe der ikke kan oprettes — alt
    /// hvad der fejler af andre grunde — skal stadig give `Err`. Ellers ville vi
    /// starte på en tom database og fortælle brugeren «din data er her», mens vi
    /// i virkeligheden lige har smidt den væk. Tabt tid er den væreste fejl
    /// produktet kan lave.
    ///
    /// Beviset ligger i de to tests under, ikke i selve klassifikationen: en test
    /// der kun spørger `er_beskadigelse(&BUSY)` var grøn, selv da kalderen
    /// (`åbn_med_recovery`) gjorde `if false` i stedet for at spørge porten —
    /// altså ville den have været grøn for en recovery der sker ved * enhver
    /// fejl. Fundet ved mutation, ikke ved læsning.
    #[test]
    fn kun_beskadigelse_udløser_recovery() {
        for (kode, navn, beskadiget) in [
            (rusqlite::ffi::SQLITE_CORRUPT, "CORRUPT", true),
            (rusqlite::ffi::SQLITE_NOTADB, "NOTADB", true),
            (rusqlite::ffi::SQLITE_BUSY, "BUSY", false),
            (rusqlite::ffi::SQLITE_LOCKED, "LOCKED", false),
            (rusqlite::ffi::SQLITE_FULL, "FULL", false),
            (rusqlite::ffi::SQLITE_READONLY, "READONLY", false),
            (rusqlite::ffi::SQLITE_CANTOPEN, "CANTOPEN", false),
            (rusqlite::ffi::SQLITE_IOERR, "IOERR", false),
            (rusqlite::ffi::SQLITE_PERM, "PERM", false),
        ] {
            let fejl: Box<dyn std::error::Error> =
                Box::new(rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(kode), None));
            assert_eq!(
                super::er_beskadigelse(fejl.as_ref()),
                beskadiget,
                "{navn} er {}, så den skal {} give en ny database",
                if beskadiget { "beskadigelse" } else { "ikke beskadigelse" },
                if beskadiget { "" } else { "ikke" },
            );
        }

        // En I/O-fejl er ikke beskadigelse: mappen kan være midt i en flytning,
        // og da må vi ikke starte på en tom database.
        let io_fejl: Box<dyn std::error::Error> =
            Box::new(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "nægtet"));
        assert!(
            !super::er_beskadigelse(io_fejl.as_ref()),
            "en I/O-fejl er ikke beskadigelse"
        );
    }

    /// Samme sag, men dømt på **kalderen**. Her spørger vi `åbn_med_recovery` om
    /// en database der fejler af en anden grund end beskadigelse, og dømmer at
    /// den hverken flytter filen eller svarer `Some`.
    ///
    /// Betingelsen skabes uden rettigheder: vi gør `timetrack.db` til en **mappe**.
    /// `Connection::open` på en mappe fejler med `CANTOPEN` — altså *ikke*
    /// beskadigelse — og det er præcis et tilfælde hvor recovery ville være
    /// ødelæggende: brugeren har en mappe hvor appen forventer sin database,
    /// og den eneste forsvundne data er den han ikke kan starte appen for.
    ///
    /// Denne test er den, der blev rød ved mutationen. Uden den ville hele
    /// klassifikations-tabellen kunne stå på hovedet, uden at nogen mærkede det.
    #[test]
    fn åbn_med_recovery_lader_en_anden_fejl_være_en_anden_fejl() {
        let temp = TempDb::ny("cantopen");
        // En mappe hvor filen skal være. `Connection::open` fejler med CANTOPEN.
        std::fs::create_dir(&temp.sti).expect("opret mappe på filens sti");

        let resultat = super::Database::åbn_med_recovery(&temp.sti);
        assert!(
            resultat.is_err(),
            "CANTOPEN er ikke beskadigelse — kalderen skal give fejlen videre, \
             ikke starte på en tom database. Fik: {resultat:?}"
        );
        assert!(
            temp.sti.is_dir(),
            "mappen skal være urørt: recovery må ikke slette noget ved en fejl \
             der ikke er beskadigelse"
        );
        // Og der må ikke være opstået nogen sikkerhedskopi ved siden af.
        let søskende: Vec<String> = std::fs::read_dir(&temp.dir)
            .expect("list")
            .map(|e| e.expect("entry").file_name().to_string_lossy().to_string())
            .filter(|n| n.contains("beskadiget"))
            .collect();
        assert!(
            søskende.is_empty(),
            "ingen sikkerhedskopi må opstå ved CANTOPEN, men der kom: {søskende:?}"
        );
    }

    /// Beviset på at `åbn_med_recovery` faktisk kalder klassifikationen, og at
    /// den ikke svarer `Some` når intet var beskadiget. Ellers kunne hele
    /// klassifikations-tabellen være vendt om, og ingen test ville mærke det.
    #[test]
    fn sund_database_udløser_ingen_recovery() {
        let temp = TempDb::ny("sund");
        temp.med_data();

        let (conn, recovery) = super::Database::åbn_med_recovery(&temp.sti).expect("åbn");
        assert!(
            recovery.is_none(),
            "en sund database må ikke rapportere en recovery — ellers får \
             alle brugere en besked om en sikkerhedskopi der ikke findes"
        );

        // Og data er stadig der, uændret.
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))
            .expect("optælling");
        assert_eq!(n, 1, "data skal være urørt");
        assert!(
            !std::fs::read_dir(&temp.dir)
                .expect("list")
                .any(|e| e
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .contains("beskadiget")),
            "der skal ikke ligge nogen sikkerhedskopi efter en sund start"
        );
    }

    /// To ødelagte starter i samme sekund må ikke overskrive hinandens
    /// sikkerhedskopi — den første er det eneste eksemplar af brugerens data.
    #[test]
    fn eksisterende_sikkerhedskopi_overskrives_ikke() {
        let temp = TempDb::ny("kollision");
        temp.med_data();

        let sti = temp.sti.with_extension(format!(
            "beskadiget-{}",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ));
        let indhold = b"den foerste sikkerhedskopi, den eneste kopi af tiden";
        std::fs::write(&sti, indhold).expect("skriv den eksisterende");

        let fejl = super::flyt_til_sikkerhedskopi(&temp.sti).expect_err("må ikke overskrive");
        assert_eq!(
            fejl.kind(),
            std::io::ErrorKind::AlreadyExists,
            "en kollision skal være en eksplicit fejl, ikke en overskrivning"
        );
        assert_eq!(
            std::fs::read(&sti).expect("læs").as_slice(),
            indhold.as_slice(),
            "den eksisterende sikkerhedskopi skal være urørt"
        );
        assert!(temp.sti.exists(), "den beskadigede database skal også være urørt");
    }

    /// Kan vi ikke flytte filen, må vi heller ikke starte på en tom database.
    ///
    /// Ellers så brugeren en app uden data **og uden besked** — det værste
    /// udfald: han tror han bare har en frisk installation, og opdager først
    /// en måned efter at hans registrerede tid er væk. Derfor skal
    /// `åbn_med_recovery` give `Err` videre, ikke `Ok` med en `None`.
    ///
    /// Betingelsen skabes deterministisk: vi lægger en *mappe* der hvor
    /// sikkerhedskopien skal ligge. `exists()` er så sandt, og kollisions-tjekket
    /// afviser — på alle platforme, uden at være afhængig af rettigheder.
    #[test]
    fn kan_ikke_flytte_giver_fejl_ikke_en_tom_app() {
        let temp = TempDb::ny("kan_ikke_flytte");
        temp.med_data();
        temp.beskadig_fil();

        // Læg en mappe der sikkerhedskopien skal ligge på. Tidsstemplet er
        // samme som i `flyt_til_sikkerhedskopi` — det er derfor kollisions-
        // tjekket finder den, og derfor fejler flytningen.
        let blokeret = temp.sti.with_extension(format!(
            "beskadiget-{}",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ));
        std::fs::create_dir(&blokeret).expect("opret blokerende mappe");

        let fejl = super::Database::åbn_med_recovery(&temp.sti)
            .expect_err("kan vi ikke flytte, skal vi heller ikke starte på en tom database");

        assert!(
            fejl.to_string().contains("allerede"),
            "fejlen skal sige at sikkerhedskopien allerede findes, så en support-\
             besked kan finde årsagen: {fejl}"
        );
        assert!(
            blokeret.is_dir(),
            "mappen skal være urørt — den er måske brugerens egen fil, ikke vores at slette"
        );
        assert!(
            temp.sti.exists(),
            "den beskadigede database skal stå UÆNDRET, når vi ikke kan tage en kopi"
        );
        std::fs::remove_dir(&blokeret).ok();
    }
}
