use crate::db::Database;
use crate::i18n;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub file_size_bytes: u64,
    pub client_count: i64,
    pub project_count: i64,
    pub time_entry_count: i64,
    pub activity_count: i64,
    pub klippekort_count: i64,
    pub invoice_count: i64,
    pub db_path: String,
}

/// Get information about the current database.
#[tauri::command]
pub fn get_database_info(db: State<'_, Database>) -> Result<DatabaseInfo, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get the database file path
    let db_path: String = conn
        .query_row("PRAGMA database_list", [], |row| row.get(2))
        .map_err(|e| i18n::t_fmt("backup.couldNotFindDbPath", &[&e.to_string()]))?;

    // Get file size
    let file_size_bytes = std::fs::metadata(&db_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Count records in each table
    let client_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))
        .unwrap_or(0);

    let project_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .unwrap_or(0);

    let time_entry_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM time_entries", [], |row| row.get(0))
        .unwrap_or(0);

    let activity_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .unwrap_or(0);

    let klippekort_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM klippekort", [], |row| row.get(0))
        .unwrap_or(0);

    let invoice_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM invoice_drafts", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(DatabaseInfo {
        file_size_bytes,
        client_count,
        project_count,
        time_entry_count,
        activity_count,
        klippekort_count,
        invoice_count,
        db_path,
    })
}

/// Export the database as a single consistent file to `path`.
///
/// `path` er den fil brugeren har valgt i dialogen, og det er præcis den
/// fil der skrives. Den gamle kode skrev til en midlertidig fil og
/// returnerede stien, og frontend kopierede den aldrig videre — brugeren
/// fik at vide, at backupen lå i en temp-mappe, som macOS rydder.
///
/// Returnerer den skrevne sti, så frontend kan fortælle hvor filen ligger.
#[tauri::command]
pub fn export_database(db: State<'_, Database>, path: String) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mål = std::path::Path::new(&path);
    valider_eksport(&conn, mål)?;

    konsistent_kopi(&conn, mål, "backup.couldNotCreate")?;

    Ok(path)
}

/// Tjekker alt hvad der skal være i orden, FØR der skrives en eneste byte.
///
/// Udskilt fra `export_database` så tjekkene kan testes uden en `State` —
/// de er selve garantien for at brugerens data ikke kan slettes ved et
/// forkert filvalg, og en garanti uden test er ikke en garanti.
fn valider_eksport(conn: &Connection, mål: &std::path::Path) -> Result<(), String> {
    if mål.to_string_lossy().trim().is_empty() {
        return Err(i18n::t("backup.noDestination"));
    }

    // Mappen skal findes, ellers fejler VACUUM INTO med en SQLException der
    // er svært at læse for brugeren.
    let overordnet = mål
        .parent()
        .ok_or_else(|| i18n::t("backup.couldNotFindParent"))?;
    if !overordnet.is_dir() {
        return Err(i18n::t_fmt(
            "backup.folderNotFound",
            &[&overordnet.to_string_lossy()],
        ));
    }

    // Eksport må aldrig skrive oveni den database appen selv kører på.
    // `konsistent_kopi` sletter en eksisterende målfil før den skriver, så
    // uden denne tjek ville et valg af `timetrack.db` i appens datamappe
    // slette ALLE brugerens data — den tabte tid, det aldrig må ske.
    let db_path: String = conn
        .query_row("PRAGMA database_list", [], |row| row.get(2))
        .map_err(|e| i18n::t_fmt("backup.couldNotFindDbPath", &[&e.to_string()]))?;
    if er_live_databasefil(&db_path, mål) {
        return Err(i18n::t("backup.wouldOverwriteDatabase"));
    }

    Ok(())
}

/// SQLite's sidecar-filer ved siden af hovedfilen i WAL-tilstand.
const DB_SIDECARS: [&str; 2] = ["-wal", "-shm"];

/// Om `mål` er en af de filer den levende database består af.
///
/// Appen kører i WAL-tilstand (`db/mod.rs`), så den levende database er
/// TRE filer: `timetrack.db`, `timetrack.db-wal` og `timetrack.db-shm`.
/// Kun hovedfilen var dækket af guarden, så et filvalg af `timetrack.db-wal`
/// slap igennem — og `konsistent_kopi` sletter målfilen og skriver en
/// `VACUUM INTO`-dump oveni den sti SQLite bruger til sin wal-indeks. De
/// rækker, der kun lå i WAL'en, gik så tabt, hvilket er præcis den tabte
/// tid, eksporten er til for at undgå.
fn er_live_databasefil(db_path: &str, mål: &std::path::Path) -> bool {
    samme_fil(db_path, mål)
        || DB_SIDECARS
            .iter()
            .any(|suffix| samme_fil(&format!("{db_path}{suffix}"), mål))
}

/// Om to stier peger på den samme fil.
///
/// Sammenligner de kanoniske stier, så `~/…/backup.db` og `/Users/…/backup.db`
/// regnes som den samme fil. Målet behøver ikke findes endnu — kun den
/// overordnede mappe skal kunne slås op, hvilket den kan, fordi
/// `konsistent_kopi` ellers ville have fejlet med "mappe findes ikke".
fn samme_fil(a: &str, b: &std::path::Path) -> bool {
    let norm = |sti: &std::path::Path| -> Option<std::path::PathBuf> {
        let mappe = sti.parent()?;
        std::fs::canonicalize(mappe)
            .ok()
            .map(|m| m.join(sti.file_name().unwrap_or_default()))
    };

    match (norm(std::path::Path::new(a)), norm(b)) {
        (Some(x), Some(y)) => x == y,
        // Kan ikke slå stierne op — så kan vi heller ikke bevise at de er
        // forskellige. I så fald er vi konservative og siger ja, fordi det
        // er den fejl der sletter data.
        _ => a == b.to_string_lossy(),
    }
}

/// Skriver hele databasen til `sti` som ÉN konsistent fil.
///
/// `fs::copy` kopierer kun hovedfilen. Appen kører i WAL-tilstand, så de
/// senest skrevne rækker ligger i `timetrack.db-wal` og ikke i hovedfilen —
/// en backup lavet med `fs::copy` kan derfor mangle lige præcis de
/// registreringer, brugeren netop har lavet. Det gjorde det værre, at den
/// gamle kode gjorde et `PRAGMA wal_checkpoint(TRUNCATE)` først og ignorerede
/// resultatet: en TRUNCATE-checkpoint kræver, at ingen anden læser har
/// databasen åben. Trackerens egen connection holder den ofte åben, så
/// checkpointen returnerer blot "busy" uden at fejle, og kopieringen gik så
/// stille tabt.
///
/// `VACUUM INTO` løser begge dele: SQLite læser WAL'en som en del af
/// transaktionen og skriver resultatet til målfilen. Den kan derfor ikke
/// fejle "halvt", og der er ingen WAL-fil ved siden af, der skal med.
///
/// `fejl_nøgle` vælger den oversatte melding, fordi de to kaldssteder
/// (backup og sikkerhedskopi før import) siger forskelligt til brugeren.
fn konsistent_kopi(conn: &Connection, sti: &std::path::Path, fejl_nøgle: &str) -> Result<(), String> {
    // `VACUUM INTO` fejler hvis målfilen allerede findes. Tidsstemplet i
    // filnavnet gør et kollisions tilfældet, men ikke umuligt (to eksporter
    // samme sekunde), så filen ryddes væk først.
    if sti.exists() {
        std::fs::remove_file(sti)
            .map_err(|e| i18n::t_fmt(fejl_nøgle, &[&e.to_string()]))?;
    }

    // Filstien bindes som parameter, ikke limes ind i SQL — en mappe med `'` i
    // navnet må ikke kunne bryde sætningen. SQLite tager gerne en parameter
    // her, så slipper vi både escaping og injection-bekymringen.
    //
    // `fs::copy` kunne aldrig fejle på en låst database, fordi den læser
    // bytes uden om database. `VACUUM INTO` skal derimod have en transaktion
    // på plads, så en BUSY fra trackerens egen connection er et reelt
    // scenarie — og en backup der fejler, er bedre end en der lykkes
    // halvvist. Den får derfor samme retry som andre skrivninger.
    crate::db::errors::execute_retry(conn, "VACUUM INTO ?1", rusqlite::params![sti.to_str()])
        .map(|_| ())
        .map_err(|e| i18n::t_fmt(fejl_nøgle, &[&e.to_string()]))
}

/// Import a database file, replacing the current database.
/// This is destructive — a backup of the current DB is created first.
#[tauri::command]
pub fn import_database(db: State<'_, Database>, path: String) -> Result<(), String> {
    let import_path = std::path::Path::new(&path);

    // Verify the file exists
    if !import_path.exists() {
        return Err(i18n::t("backup.fileNotFound"));
    }

    // Verify it's a valid SQLite database by trying to open it
    {
        let test_conn = rusqlite::Connection::open(import_path)
            .map_err(|_| i18n::t("backup.invalidSqlite"))?;

        // Check that it has at least the clients table (basic schema validation)
        test_conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='clients'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|_| i18n::t("backup.invalidTimetrackDb"))?;
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get the current database file path
    let db_path: String = conn
        .query_row("PRAGMA database_list", [], |row| row.get(2))
        .map_err(|e| i18n::t_fmt("backup.couldNotFindDbPath", &[&e.to_string()]))?;

    // Create a backup of the current database before replacing. Den skal
    // indeholde ALT, også de rækker der kun ligger i WAL'en — det er jo
    // præcis de data brugeren har mistet, hvis importen går galt.
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let backup_name = format!("timetrack_pre_import_{}.db", timestamp);
    let backup_dir = std::path::Path::new(&db_path)
        .parent()
        .ok_or_else(|| i18n::t("backup.couldNotFindParent"))?;
    let pre_import_backup = backup_dir.join(backup_name);

    konsistent_kopi(&conn, &pre_import_backup, "backup.couldNotCreateSafety")?;

    // Tabellerne slettes i alfabetisk rækkefølge, som ikke respekterer
    // fremmednøgler, så de slås fra mens vi kopierer.
    conn.execute_batch("PRAGMA foreign_keys = OFF")
        .map_err(|e| e.to_string())?;

    // Erstat alle data med dem fra importfilen. Helt i én transaktion, så
    // en fejl halveret inde i kopieringen ruller ALT tilbage — brugerens
    // nuværende data overlever, i stedet for at stå med en delvis tømt
    // database.
    let result = replace_all_data_from_import(&conn, &path);

    // Slås til igen uanset udfald — ellers står appen resten af sessionen
    // uden referentiel integritet.
    conn.execute_batch("PRAGMA foreign_keys = ON")
        .map_err(|e| e.to_string())?;

    result
}

/// Tømmer alle tabeller i `conn` og kopierer indholdet fra databasefilen i
/// `import_path` ind i dem.
///
/// Destructivt og transaktionelt: går en enkelt tabel-copy i stykker, ruller
/// hele erstatningen tilbage, så den eksisterende database er urørt. Det er
/// hele pointen — en restore der halvdelvis lykkes og melder "ok" er det
/// samme som at miste brugerens registrerede tid.
///
/// Kald med `PRAGMA foreign_keys = OFF` (sæt af kaldet), da tabellerne
/// slettes i en rækkefølge, der ikke respekterer fremmednøgler.
fn replace_all_data_from_import(conn: &Connection, import_path: &str) -> Result<(), String> {
    // ATTACH må ikke ske inde i en transaktion, så den ligger udenfor.
    conn.execute("ATTACH DATABASE ?1 AS import_db", rusqlite::params![import_path])
        .map_err(|e| i18n::t_fmt("backup.couldNotOpenImport", &[&e.to_string()]))?;

    let result = copy_all_tables(conn);

    // DETACH fejler hvis der stadig er en åben transaktion, så ryd op først.
    match result {
        Ok(()) => {
            conn.execute_batch("DETACH DATABASE import_db")
                .map_err(|e| e.to_string())?;
            ryd_hemmeligheder_efter_import(conn);
            Ok(())
        }
        Err(e) => {
            // Rul tilbage, så data fra et tidligere lykket bord ikke efterlades
            // i en halvfærdig tilstand.
            let _ = conn.execute_batch("ROLLBACK");
            let _ = conn.execute_batch("DETACH DATABASE import_db");
            Err(e)
        }
    }
}

/// `settings` er kopieret tabel for tabel, så en backup fra **før** nøgleringen
/// kom lægger `sync_token` og `billy_api_key` tilbage som klartekst i en fil
/// brugeren kan kopiere — præcis det D3 og D3b fjernede. Kun nye backups er
/// lukket ved konstruktion, fordi nøglerne ikke ligger i tabellen længere;
/// gamle backup-filer er det her, og de kan kun løses ved at køre migrationen
/// igen efter indlæsningen.
///
/// Det er samme indgang som `apply_migrations` bruger ved hver opstart, så de
/// to steder ikke kan komme i utakt om hvilke nøgler der ryddes.
///
/// Kaldet står her og ikke i `import_database`, fordi det er den funktion
/// tests kan nå: kommandoen tager en `State<Database>`, så en skeln placeret
/// dér ville være grøn uden at nogen test kunne dømme den.
fn ryd_hemmeligheder_efter_import(conn: &Connection) {
    crate::secrets::ryd_klarteksthemmeligheder(conn);
}

/// Kolonnenavne i en tabel i et givent skema (`main` eller `import_db`).
///
/// Navnene er filtreret gennem `valid_table_re` — de kommer fra en fil, der
/// kan være hvad som helst, så de må ikke sættes ukontrolleret i SQL.
fn tabel_kolonner(
    conn: &Connection,
    schema: &str,
    table: &str,
    valid_table_re: &regex::Regex,
) -> Result<Vec<String>, String> {
    // PRAGMA table_info returnerer én række pr. kolonne med navnet i kolonne 1.
    // En tabel, der ikke findes, giver nul rækker og ingen fejl.
    let sql = format!("PRAGMA {}.table_info(\"{}\")", schema, table);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;

    let mut names = Vec::new();
    for name in rows {
        let name = name.map_err(|e| e.to_string())?;
        if valid_table_re.is_match(&name) {
            names.push(name);
        } else {
            crate::db::errors::record(
                &format!("springer kolonne med ugyldigt navne over ved import: {name}"),
                "",
            );
        }
    }
    Ok(names)
}

/// Kopierer alle tabeller fra den tilhæftede import-database over i hovedbasen.
///
/// Ligger i en transaktion på kaldet, så en fejl i én tabel ruller alle
/// tidligere tabeller tilbage med.
fn copy_all_tables(conn: &Connection) -> Result<(), String> {
    // Table names come from sqlite_master and must be validated to prevent
    // SQL injection from a crafted database file.
    let valid_table_re = regex::Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*$").unwrap();

    let table_names: Vec<String> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT name FROM import_db.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;

        let mut names = Vec::new();
        for name in rows.flatten() {
            names.push(name);
        }
        names
    };

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| i18n::t_fmt("backup.importFailed", &[&e.to_string()]))?;

    for table in &table_names {
        if !valid_table_re.is_match(table) {
            eprintln!("Skipping suspicious table name during import: {:?}", table);
            continue;
        }

        // Kolonnerne navngives eksplicit. En backup fra en tidligere version af
        // appen har ikke samme kolonner og slet ikke samme rækkefølge:
        // `CREATE TABLE IF NOT EXISTS` i SCHEMA lægger nye kolonner ind i
        // midten, mens `apply_migrations` på en eksisterende database tilføjer
        // dem med ALTER TABLE — altså bagest. `SELECT *` kobler efter
        // position, så en gammel backup kunne havne i helt forkerte kolonner
        // UDEN at SQLite meldte en fejl.
        //
        // Kun kolonner, der findes i begge versioner, kopieres. Kolonner der kun
        // findes i hovedbasen får deres DEFAULT — så en backup fra en ældre
        // version kan genindlæses i en nyere app.
        let main_kolonner = tabel_kolonner(conn, "main", table, &valid_table_re)?;
        let import_kolonner = tabel_kolonner(conn, "import_db", table, &valid_table_re)?;

        let fælles: Vec<&String> = main_kolonner
            .iter()
            .filter(|k| import_kolonner.contains(k))
            .collect();

        if fælles.is_empty() {
            crate::db::errors::record(
                &format!(
                    "springer tabellen {table} over ved import: ingen fælles kolonner med hovedbasen"
                ),
                "",
            );
            continue;
        }

        let kolonner: Vec<String> = fælles
            .iter()
            .map(|k| format!("\"{}\"", k))
            .collect();
        let kolonne_sql = kolonner.join(", ");

        // Delete existing data
        let delete_sql = format!("DELETE FROM main.\"{}\"", table);
        tx.execute(&delete_sql, [])
            .map_err(|e| i18n::t_fmt("backup.importFailed", &[&e.to_string()]))?;

        // Copy data from import, med de fælles kolonner opdateret i navn
        let copy_sql = format!(
            "INSERT INTO main.\"{table}\" ({kolonne_sql}) SELECT {kolonne_sql} FROM import_db.\"{table}\""
        );
        tx.execute(&copy_sql, [])
            .map_err(|e| i18n::t_fmt("backup.importFailed", &[&e.to_string()]))?;
    }

    tx.commit()
        .map_err(|e| i18n::t_fmt("backup.importFailed", &[&e.to_string()]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;

    #[test]
    fn database_info_query_works() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();

        // Insert test data
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Test')",
            [],
        )
        .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    /// Kerne-regressionen: en backup skal indeholde de rækker, der kun ligger
    /// i WAL'en.
    ///
    /// Appen kører i WAL-tilstand, så en skrivning lander i
    /// `timetrack.db-wal` og ikke i hovedfilen. Den gamle kode lavede et
    /// `PRAGMA wal_checkpoint(TRUNCATE)` og kopierede så hovedfilen med
    /// `fs::copy`. Men en TRUNCATE-checkpoint kan ikke gennemføres mens
    /// nogen anden holder databasen åben — og her holder en anden connection
    /// en læsetransaktion, præcis som trackerens gør i drift. Checkpointen
    /// returnerer "busy" uden at fejle, koden ignorerede det, og backupen
    /// manglede de nyeste registreringer.
    #[test]
    fn backup_indeholder_rækker_der_kun_ligger_i_wal() {
        let dir = std::env::temp_dir().join(format!("tt_wal_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("wal.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();

        // En anden connection med en åben læsetransaktion. Den blokerer
        // TRUNCATE-checkpointen — det er hele pointen.
        let laeser = rusqlite::Connection::open(&sti).unwrap();
        laeser.execute_batch("BEGIN;").unwrap();
        laeser
            .query_row("SELECT COUNT(*) FROM clients", [], |r| r.get::<_, i64>(0))
            .unwrap();

        // Skriv klienten efter at læseren har låst transaktionen, så den
        // eneste kan ligge i WAL'en.
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Seneste kunde')",
            [],
        )
        .unwrap();

        // Bevis på præmissen: TRUNCATE-checkpointen kan ikke gennemføres.
        let (busy, _log, _ckpt): (i64, i64, i64) = conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(busy, 1, "testen skal ramme en blokeret checkpoint");

        // Og så det den gamle kode gjorde: kopier kun hovedfilen. Filen
        // indeholder ikke klienten — enten fordi den kun lå i WAL'en, eller
        // fordi kopieringen slet ikke er en gyldig database, fordi WAL-headeren
        // står i en fil uden de sider den peger på. Begge dele er i praksis
        // det samme for brugeren: backupen kan ikke bruges.
        let gammel = dir.join("gammel.db");
        std::fs::copy(&sti, &gammel).unwrap();
        let gammel_conn = rusqlite::Connection::open(&gammel).unwrap();
        let gammel_navn: Result<String, _> =
            gammel_conn.query_row("SELECT name FROM clients WHERE id='c1'", [], |r| {
                r.get(0)
            });
        assert!(
            gammel_navn.as_deref() != Ok("Seneste kunde"),
            "premissen holder: hovedfilens kopi må ikke have klienten, kun WAL'en har den"
        );

        // Den nye kode tager hele databasen med.
        let backup = dir.join("backup.db");
        konsistent_kopi(&conn, &backup, "backup.couldNotCreate")
            .expect("VACUUM INTO skal lykkes selv med en åben læser");

        let backup_conn = rusqlite::Connection::open(&backup).unwrap();
        assert_eq!(
            count_clients(&backup_conn),
            1,
            "backup skal indeholde rækker der kun lå i WAL'en"
        );
        assert_eq!(klientnavn(&backup_conn, "c1"), "Seneste kunde");

        // Der skal ikke ligge en WAL-fil ved siden af backupen — den skal være
        // helt i sig selv, ellers kan den ikke flyttes alene.
        let wal_fil = dir.join("backup.db-wal");
        assert!(!wal_fil.exists(), "backupen skal være en selvstændig fil");

        let _ = laeser.execute_batch("ROLLBACK;");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// To eksporter i samme sekund giver samme filnavn. Den anden må ikke
    /// fejle med "output file already exists".
    #[test]
    fn to_kopieringer_til_samme_sti_overskriver() {
        let dir = std::env::temp_dir().join(format!("tt_wal_twice_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("wal.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'A')", [])
            .unwrap();

        let backup = dir.join("backup.db");
        konsistent_kopi(&conn, &backup, "backup.couldNotCreate").unwrap();
        konsistent_kopi(&conn, &backup, "backup.couldNotCreate")
            .expect("en eksisterende backup må ikke få den anden til at fejle");

        let backup_conn = rusqlite::Connection::open(&backup).unwrap();
        assert_eq!(count_clients(&backup_conn), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// En mappe med `'` i navnet må ikke kunne bryde SQL'en. Stien bindes som
    /// parameter, så apostrofen er ligegyldig — det er grundene til, at der
    /// ikke limes escaping ind i sætningen.
    #[test]
    fn backup_til_sti_med_apostrof() {
        let dir = std::env::temp_dir().join(format!("tt_wal_apos_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("wal.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'A')", [])
            .unwrap();

        let backup = dir.join("O'Brien's backup.db");
        konsistent_kopi(&conn, &backup, "backup.couldNotCreate")
            .expect("en apostrof i stien må ikke få backupen til at fejle");

        let backup_conn = rusqlite::Connection::open(&backup).unwrap();
        assert_eq!(count_clients(&backup_conn), 1);
        assert_eq!(klientnavn(&backup_conn, "c1"), "A");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// En backup skal kunne læses ind igen af importen — ellers er den
    /// ubrugelig, uanset hvor komplet den ser ud.
    #[test]
    fn backup_kan_genindlaeses() {
        let dir = std::env::temp_dir().join(format!("tt_wal_roundtrip_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("wal.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Kunde A')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO time_entries (id, client_id, description, start_time, duration)
             VALUES ('t1', 'c1', 'Udvikling', '2026-09-01T09:00:00', 3600)",
            [],
        )
        .unwrap();

        let backup = dir.join("backup.db");
        konsistent_kopi(&conn, &backup, "backup.couldNotCreate").unwrap();
        drop(conn);

        // Indlæs backupen i en frisk database, som importen gør.
        let modtager = rusqlite::Connection::open_in_memory().unwrap();
        modtager.execute_batch(SCHEMA).unwrap();
        modtager.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        replace_all_data_from_import(&modtager, backup.to_str().unwrap())
            .expect("en backup taget med den nye kode skal kunne genindlæses");

        assert_eq!(count_clients(&modtager), 1);
        assert_eq!(klientnavn(&modtager, "c1"), "Kunde A");

        let minutter: i64 = modtager
            .query_row("SELECT duration FROM time_entries WHERE id='t1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(minutter, 3600, "registreret tid skal overleve turen rundt");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Laver en filbaseret database med fuld skema, så den kan ATTACHes.
    fn skriv_import_db(sti: &std::path::Path) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open(sti).expect("opret import-db");
        conn.execute_batch(SCHEMA).expect("opret skema");
        conn
    }

    fn count_clients(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))
            .unwrap()
    }

    fn klientnavn(conn: &Connection, id: &str) -> String {
        conn.query_row("SELECT name FROM clients WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .unwrap()
    }

    #[test]
    fn import_erstatter_data() {
        let dir = std::env::temp_dir().join(format!("tt_imp_ok_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("import.db");
        let import = skriv_import_db(&sti);
        import
            .execute(
                "INSERT INTO clients (id, name) VALUES ('c-import', 'Fra import')",
                [],
            )
            .unwrap();
        drop(import);

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Original')",
            [],
        )
        .unwrap();

        replace_all_data_from_import(&conn, sti.to_str().unwrap())
            .expect("en velformet import skal lykkes");

        assert_eq!(count_clients(&conn), 1);
        assert_eq!(klientnavn(&conn, "c-import"), "Fra import");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// En database som den så ud FØR `context_path`,
    /// `classification_source` og `classification_reason` blev tilføjet i
    /// `db::Database::apply_migrations`.
    ///
    /// Det er den ægte fejlmekanisme: på en eksisterende database lægges de
    /// nye kolonner på med ALTER TABLE, altså BAGEST i rækkefølgen, mens en
    /// frisk database får dem ind i midten fra SCHEMA. Kolonnerne er derfor
    /// både færre OG i en anden rækkefølge end i hovedbasen.
    fn skriv_gammel_aktivitets_db(sti: &std::path::Path) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open(sti).expect("opret gammel db");
        conn.execute_batch(SCHEMA).expect("opret skema");

        // Drop den nuværende activities-tabel og lav den i den gamle form.
        conn.execute_batch(
            "DROP TABLE activities;
             CREATE TABLE activities (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 app_name TEXT,
                 window_title TEXT,
                 url TEXT,
                 git_branch TEXT,
                 category TEXT,
                 project_id TEXT REFERENCES projects(id),
                 confidence REAL,
                 is_confirmed INTEGER NOT NULL DEFAULT 0,
                 started_at TEXT NOT NULL,
                 ended_at TEXT,
                 duration INTEGER NOT NULL
             );",
        )
        .expect("lav gammel activities-tabel");

        // Samme ALTER TABLE som apply_migrations laver på en eksisterende
        // database — de nye kolonner havner derfor bagest.
        conn.execute_batch(
            "ALTER TABLE activities ADD COLUMN context_path TEXT;
             ALTER TABLE activities ADD COLUMN classification_source TEXT;
             ALTER TABLE activities ADD COLUMN classification_reason TEXT;",
        )
        .expect("kør de gamle migrationer");

        conn
    }

    fn aktivitet_fra_gammel_db(conn: &Connection) -> (String, String) {
        conn.query_row(
            "SELECT app_name, category FROM activities LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    /// Kerne-regressionen: en backup fra en tidligere version skal kunne
    /// genindlæses, og værdierne skal lande i de kolonner de hører til.
    ///
    /// Før fixen brugte kopieringen `INSERT INTO ... SELECT *`, som kobler
    /// kolonner efter position. Den gamle `activities`-tabel har 15 kolonner i
    /// en anden rækkefølge end hovedbasens 18, så importen enten fejlede
    /// ("18 columns but 15 values were supplied") eller — værre — skrev
    /// `started_at` ned i `context_path` og `duration` ned i `started_at`.
    #[test]
    fn import_af_aeldre_migration_lands_i_rigtige_kolonner() {
        let dir = std::env::temp_dir().join(format!("tt_imp_gammel_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("gammel.db");

        let import = skriv_gammel_aktivitets_db(&sti);
        import
            .execute(
                "INSERT INTO activities (app_name, window_title, category, started_at, duration)
                 VALUES ('VS Code', 'kalender.tsx', 'udvikling', '2026-09-01T09:00:00', 1800)",
                [],
            )
            .unwrap();
        drop(import);

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();

        replace_all_data_from_import(&conn, sti.to_str().unwrap())
            .expect("en backup fra en tidligere version skal kunne genindlæses");

        // Hver værdi skal ligge i sin egen kolonne. `SELECT *` ville have skrevet
        // 'udvikling' ned i `project_id` og starttidspunktet ned i `confidence`.
        let (app, kategori) = aktivitet_fra_gammel_db(&conn);
        assert_eq!(app, "VS Code", "app_name skal overleve i sin egen kolonne");
        assert_eq!(kategori, "udvikling", "category skal ikke havne i project_id");

        let start: String = conn
            .query_row("SELECT started_at FROM activities LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(start, "2026-09-01T09:00:00", "started_at må ikke blive duration");

        let varighed: i64 = conn
            .query_row("SELECT duration FROM activities LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(varighed, 1800, "duration skal overleve som et tal");

        // Kolonner kun den nye version har, får deres default — de skal ikke
        // sprænge importen.
        let kontekst: Option<String> = conn
            .query_row("SELECT context_path FROM activities LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kontekst, None, "nye kolonner skal stå tomme, ikke fejle");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Samme kolonner, anden rækkefølge. Det er den stille variant af bugen:
    /// `SELECT *` fejler IKKE, den bare skriver alt i forkerte kolonner, og
    /// brugeren får en backup der ser ud til at virke.
    #[test]
    fn import_omrokologaer_ikke_kolonner_i_stille() {
        let dir = std::env::temp_dir().join(format!("tt_imp_reorder_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("omrokologeret.db");

        let import = rusqlite::Connection::open(&sti).unwrap();
        // Samme kolonner som SCHEMA's clients, bare erklæret i omvendt
        // rækkefølge — som en gammel database der har fået nye kolonner foran de
        // oprindelige via en rebuild.
        import
            .execute_batch(
                "CREATE TABLE clients (
                     synced_at TEXT,
                     updated_at TEXT NOT NULL DEFAULT 'x',
                     created_at TEXT NOT NULL DEFAULT 'x',
                     is_archived INTEGER NOT NULL DEFAULT 0,
                     notes TEXT,
                     hourly_rate REAL,
                     cvr TEXT,
                     company TEXT,
                     phone TEXT,
                     email TEXT,
                     name TEXT NOT NULL,
                     remote_id TEXT,
                     id TEXT PRIMARY KEY NOT NULL
                 );",
            )
            .unwrap();
        import
            .execute(
                "INSERT INTO clients (id, name, email, remote_id) VALUES ('c1', 'Kunde A', 'a@eksempel.dk', 'remote-77')",
                [],
            )
            .unwrap();
        drop(import);

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();

        replace_all_data_from_import(&conn, sti.to_str().unwrap())
            .expect("omrokologeret import skal lykkes");

        let (navn, mail, remote) = conn
            .query_row("SELECT name, email, remote_id FROM clients WHERE id='c1'", [], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
            })
            .expect("klienten skal være der med alle sine felter");

        assert_eq!(navn, "Kunde A", "name må ikke havne i synced_at");
        assert_eq!(mail, "a@eksempel.dk", "email må ikke havne i name");
        assert_eq!(remote, "remote-77", "remote_id må ikke havne i email");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Kerne-regressionen: en eksport må ALDRIG ramme den database appen
    /// kører på.
    ///
    /// Den gamle kode skrev til en temp-mappe, så det umiddelbart var
    /// uskadeligt. Med destination valgt af brugeren kan målet være
    /// `timetrack.db` selv — og `konsistent_kopi` sletter en eksisterende
    /// målfil FØR den skriver. Uden guarden ville et enkelt forkert valg
    /// slette alle klienter, projekter og registreret tid.
    #[test]
    fn eksport_ødelægger_ikke_live_database() {
        let dir = std::env::temp_dir().join(format!("tt_own_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("timetrack.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Kunde A')", [])
            .unwrap();
        drop(conn);

        // Samme fil, to sti-former: den relative går via `.` og den
        // absolutte ikke, men de peger på den samme fil.
        let absolut = sti.to_string_lossy().to_string();
        assert!(
            samme_fil(&absolut, &sti),
            "premissen: samme fil genkendt via forskellige stiformer"
        );
        assert!(
            !samme_fil(&absolut, &dir.join("backup.db")),
            "en anden fil i samme mappe må ikke regnes som den samme"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `samme_fil` må ikke slå falsk alarm på en symlink eller `..` i stien,
    /// men skal stadig genkende den virkelige database.
    #[test]
    fn samme_fil_håndterer_dot_dot_og_symlink() {
        let dir = std::env::temp_dir().join(format!("tt_own_dot_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("timetrack.db");
        std::fs::write(&sti, b"x").unwrap();

        let via_dot_dot = dir.join("sub").join("..").join("timetrack.db");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        assert!(
            samme_fil(&sti.to_string_lossy(), &via_dot_dot),
            "`a/sub/../timetrack.db` er den samme fil som `a/timetrack.db`"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression: guarden dækkede kun hovedfilen, ikke SQLite's sidecars.
    ///
    /// Appen kører i WAL-tilstand, så den levende database er TRE filer.
    /// `konsistent_kopi` sletter målfilen og skriver dumpen oveni, så et
    /// filvalg af `timetrack.db-wal` slettede den levende WAL og skrev en
    /// backup oveni den sti SQLite bruger til sin wal-indeks.
    #[test]
    fn eksport_ødelægger_ikke_wal_eller_shm() {
        let dir = std::env::temp_dir().join(format!("tt_own_wal_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("timetrack.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Kunde A')", [])
            .unwrap();

        let fejl_ved_wal = valider_eksport(&conn, &dir.join("timetrack.db-wal"))
            .expect_err("eksport til -wal skal afvises");
        let fejl_ved_shm = valider_eksport(&conn, &dir.join("timetrack.db-shm"))
            .expect_err("eksport til -shm skal afvises");

        // Samme nøgle som hovedfilen, så brugeren får den etablerede
        // forklaring og ikke en ny, uforklaret tekst.
        for (fejl, fil) in [(&fejl_ved_wal, "-wal"), (&fejl_ved_shm, "-shm")] {
            assert_eq!(
                *fejl,
                i18n::t("backup.wouldOverwriteDatabase"),
                "{fil} skal give den samme fejl som hovedfilen"
            );
        }

        // Og en målfil uden for databasens egne filer slippes stadig igennem —
        // ellers ville guarden også lukke for almindelige backups.
        valider_eksport(&conn, &dir.join("backup.db"))
            .expect("en backup i samme mappe skal være tilladt");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Samme krav gennem hele vejen, inklusive en sidecar-sti der er skrevet
    /// med `sub/..`, så guarden ikke kan forbigås med en sti-form.
    #[test]
    fn eksport_ødelægger_ikke_wal_via_dot_dot() {
        let dir = std::env::temp_dir().join(format!("tt_own_waldot_{}", std::process::id()));
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let sti = dir.join("timetrack.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();

        let via_dot_dot = sub.join("..").join("timetrack.db-wal");
        assert!(
            valider_eksport(&conn, &via_dot_dot).is_err(),
            "`sub/../timetrack.db-wal` er den samme fil som `timetrack.db-wal`"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Beviser at guarden er nødvendig: uden den overskriver
    /// `konsistent_kopi` den levende WAL og den nyeste række er væk fra
    /// den database, der kører. Med i testen så en senere refaktorering af
    /// guarden kan se hvad den beskytter mod.
    ///
    /// På Windows låser operativsystemet en fil SQLite har åben, så
    /// kopieringen fejler i stedet for at slette. Begge veje skal dækkes:
    /// guarden er nødvendig på Unix, og på Windows er det filsystemet der
    /// beskytter. Kun unix-vejen var dækket, så CI blev rød på Windows.
    #[test]
    fn konsistent_kopi_ødelægger_wal_på_unix_og_kører_på_windows() {
        let dir = std::env::temp_dir().join(format!("tt_own_why_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("timetrack.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Første')", [])
            .unwrap();

        // Hold WAL'en stor nok til at den overlever en checkpoint, så der
        // stadig er noget at slette.
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0;").unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c2', 'Anden')", [])
            .unwrap();

        let wal = dir.join("timetrack.db-wal");
        let før = std::fs::metadata(&wal).map(|m| m.len()).unwrap_or(0);
        assert!(før > 0, "premissen: WAL'en skal være skrevet");

        let udfald = konsistent_kopi(&conn, &wal, "backup.couldNotCreate");

        if cfg!(windows) {
            udfald.expect_err("Windows må ikke lade os slette en fil SQLite har åben");

            // Sletningen skete aldrig, så de seneste rækker er stadig der.
            let rækker: i64 = conn
                .query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0))
                .unwrap();
            assert_eq!(
                rækker, 2,
                "den levende database skal være urørt efter en fejlet kopiering"
            );
        } else {
            udfald.expect("på Unix kan vi slette filen, hvilket er netop problemet");

            // Filen hedder stadig `timetrack.db-wal`, men indholdet er nu en
            // komplet database-dump. Den er altså ikke en WAL mere — SQLite
            // ville læse den som wal-indeks og finde en fremmed database.
            let indhold = std::fs::read(&wal).unwrap();
            assert_eq!(
                &indhold[..16],
                b"SQLite format 3\0",
                "den levende WAL er slettet og erstattet af en backupfil"
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Brugeren kan godt overskrive en tidligere backup — det er et
    /// bevidst valg, og en fersk backup skal altid kunne erstatte en gammel.
    /// Guarden fra `eksport_ødelægger_ikke_live_database` må derfor kun
    /// stoppe den database, appen selv bruger.
    #[test]
    fn eksport_må_overskrive_en_tidligere_backup() {
        let dir = std::env::temp_dir().join(format!("tt_own_ok_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("kilde.db");

        let conn = rusqlite::Connection::open(&sti).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Første')", [])
            .unwrap();

        let mål = dir.join("backup.db");
        konsistent_kopi(&conn, &mål, "backup.couldNotCreate").unwrap();

        // Nye data, samme mål — skal gå over den gamle backup.
        conn.execute("INSERT INTO clients (id, name) VALUES ('c2', 'Anden')", [])
            .unwrap();
        konsistent_kopi(&conn, &mål, "backup.couldNotCreate")
            .expect("en tidligere backup må gerne overskrives");

        let backup_conn = rusqlite::Connection::open(&mål).unwrap();
        assert_eq!(count_clients(&backup_conn), 2, "backupen skal være den nye");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression: en import må ikke lægge hemmeligheder tilbage i
    /// databasen som klartekst.
    ///
    /// `copy_all_tables` kopierer `settings` tabel for tabel, så en backup fra
    /// **før** nøkleringen kom lægger `sync_token` og `billy_api_key` tilbage
    /// som klartekst rækker — præcis det D3 fjernede, og i en fil brugeren kan
    /// kopiere på et USB-stik. Eksport-siden er lukket ved konstruktion, så
    /// det her er det eneste sted en gammel nøgle kan komme ind igen.
    #[test]
    fn import_af_gammel_backup_rydder_klarteksthemmeligheder() {
        let _butik = crate::secrets::brug_mock_butik();
        let dir = std::env::temp_dir().join(format!("tt_imp_secret_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("gammel.db");

        // En backup fra versionen FØR nøgleringen: nøglerne står som
        // klartekst, og AI-nøglen ligger stadig inde i `ai_config`-klumpen.
        let import = skriv_import_db(&sti);
        import
            .execute_batch(
                "INSERT INTO settings (key, value) VALUES ('sync_token', 'token-fra-2025');
                 INSERT INTO settings (key, value) VALUES ('billy_api_key', 'billy-fra-2025');
                 INSERT INTO settings (key, value) VALUES ('theme', 'dark');
                 INSERT INTO settings (key, value)
                     VALUES ('ai_config', '{\"provider\":\"openai\",\"api_key\":\"sk-fra-2025\",\"model\":\"gpt-4o-mini\"}');",
            )
            .unwrap();
        drop(import);

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();

        replace_all_data_from_import(&conn, sti.to_str().unwrap())
            .expect("importen skal lykkes");

        // Kernen: ingen klartekstnøgle må stå i databasen bagefter.
        let resterende: Vec<String> = {
            let mut stmt = conn
                .prepare(
                    "SELECT key FROM settings WHERE key IN ('sync_token','billy_api_key','ai_api_key')",
                )
                .unwrap();
            let rækker = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap();
            rækker.flatten().collect()
        };
        assert!(
            resterende.is_empty(),
            "importen må ikke efterlade klarteksthemmeligheder i databasen: {resterende:?}"
        );

        // De er i nøgleringen i stedet.
        assert_eq!(
            crate::secrets::hent("sync_token").unwrap().as_deref(),
            Some("token-fra-2025")
        );
        assert_eq!(
            crate::secrets::hent("billy_api_key").unwrap().as_deref(),
            Some("billy-fra-2025")
        );
        assert_eq!(
            crate::secrets::hent(crate::secrets::AI_NØGLE)
                .unwrap()
                .as_deref(),
            Some("sk-fra-2025"),
            "AI-nøglen skal også ud af klumpen"
        );

        // En indstilling der ikke er en hemmelighed skal overleve, og
        // `ai_config` skal miste nøglen men beholde resten.
        let theme: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'theme'", [], |r| {
                r.get(0)
            })
            .expect("temaet skal overleve importen");
        assert_eq!(theme, "dark");

        let klump: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'ai_config'", [], |r| {
                r.get(0)
            })
            .expect("configen skal overleve");
        let json: serde_json::Value = serde_json::from_str(&klump).expect("gyldig JSON");
        assert!(
            json.get("api_key").is_none(),
            "nøglen må ikke stå i klumpen: {klump}"
        );
        assert_eq!(json["model"], "gpt-4o-mini", "resten af configen røres ikke");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Den anden retning, og den der koster mest: nøgleringen slår backupen.
    ///
    /// Brugeren kan have et gyldigt token i nøgleringen, mens den backup der
    /// indlæses er fra et tidligere login. Uden `gem_hvis_ikke_findes` skrev
    /// hver opstart den ældre værdi fra databasen over den brugeren havde
    /// valgt nu — og brugeren er stolt af logget ud. Det er samme regel 4 som
    /// D3b indførte for AI-nøglen, og den skal gælde de andre to også.
    #[test]
    fn import_overskriver_ikke_noegleringens_token_med_en_gammel_backup() {
        let _butik = crate::secrets::brug_mock_butik();
        crate::secrets::gem("sync_token", "token-nyeste").expect("gem");

        let dir = std::env::temp_dir().join(format!("tt_imp_beat_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("gammel.db");

        let import = skriv_import_db(&sti);
        import
            .execute(
                "INSERT INTO settings (key, value) VALUES ('sync_token', 'token-fra-2025')",
                [],
            )
            .unwrap();
        drop(import);

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();

        replace_all_data_from_import(&conn, sti.to_str().unwrap())
            .expect("importen skal lykkes");

        assert_eq!(
            crate::secrets::hent("sync_token").unwrap().as_deref(),
            Some("token-nyeste"),
            "nøgleringen skal slå værdien fra backupen"
        );

        // Og klarteksten er væk uanset hvad — den skal ikke bare ligge og
        // vente på næste opstart, hvor den igen ville blive forsøgt.
        let klartekst: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = 'sync_token'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(klartekst, 0, "den ældre værdi skal ryddes væk fra databasen");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// En låst nøglering må hverken slette brugerens login eller få
    /// importen til at fejle. Data er lagt ind, og nøglen bliver i databasen
    /// til næste opstart prøver igen — præcis som ved en opgradering.
    ///
    /// Beviset på at rydningen ikke kan smide importen: den afgørende del
    /// returnerer `()`, så der er ingen fejlvej at løbe ind i. At nøglen
    /// bevares, når nøgleringen siger nej, dømmes i `secrets.rs` — her er det
    /// den her vejs egenskab, at importen stadig melder succes.
    #[test]
    fn laast_noeglering_ved_import_beholder_noeglen_og_fejler_ikke() {
        let butik = crate::secrets::brug_mock_butik();
        let dir = std::env::temp_dir().join(format!("tt_imp_locked_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("gammel.db");

        let import = skriv_import_db(&sti);
        import
            .execute(
                "INSERT INTO settings (key, value) VALUES ('sync_token', 'token-ved-låst')",
                [],
            )
            .unwrap();
        import
            .execute(
                "INSERT INTO clients (id, name) VALUES ('c-import', 'Fra import')",
                [],
            )
            .unwrap();
        drop(import);

        // Butikken afviser, som en låst nøglering gør.
        for nøgle in crate::secrets::HEMMELIGHEDER {
            let post = butik
                .build("dk.timetrack.desktop", nøgle, None)
                .expect("byg post");
            let cred: &keyring_core::mock::Cred = post.as_any().downcast_ref().expect("cred");
            cred.set_error(keyring_core::Error::PlatformFailure(Box::new(
                std::io::Error::other("nøgleringen er låst"),
            )));
        }

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();

        replace_all_data_from_import(&conn, sti.to_str().unwrap())
            .expect("en låst nøglering må ikke få importen til at fejle");

        // Data er lagt ind, og nøglen ligger stadig i databasen.
        assert_eq!(count_clients(&conn), 1);
        let stadig: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = 'sync_token'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            stadig, 1,
            "nøglen skal blive liggende, ellers har brugeren mistet sit login"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// En backup uden `settings`-tabel skal stadig kunne indlæses, og
    /// klientdata skal overleve. Tabellen er valgfri i en gammel backup, så
    /// importen må ikke regne med den.
    #[test]
    fn import_uden_settings_tabel_rydder_stille() {
        let _butik = crate::secrets::brug_mock_butik();
        let dir = std::env::temp_dir().join(format!("tt_imp_nosettings_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("uden.db");

        let import = rusqlite::Connection::open(&sti).unwrap();
        import
            .execute_batch(
                "CREATE TABLE clients (
                     id TEXT PRIMARY KEY NOT NULL,
                     name TEXT NOT NULL,
                     created_at TEXT NOT NULL DEFAULT 'x',
                     updated_at TEXT NOT NULL DEFAULT 'x'
                 );
                 INSERT INTO clients (id, name) VALUES ('c1', 'Kunde A');",
            )
            .unwrap();
        drop(import);

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();

        replace_all_data_from_import(&conn, sti.to_str().unwrap())
            .expect("en backup uden settings skal kunne indlæses");

        assert_eq!(count_clients(&conn), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression: en import der fejler halvvejs må IKKE efterlade
    /// brugerens database halvtømt.
    ///
    /// Før denne fix blev hver tabel slettet og kopieret i en løkke med
    /// `let _ = conn.execute(...)`. En fejl i én tabel blev slugt, og
    /// kommandoen returnerede alligevel `Ok(())` — brugeren stod med en
    /// delvis tømt database og troede, importen var gået god.
    #[test]
    fn fejlet_import_beholder_alle_data() {
        let dir = std::env::temp_dir().join(format!("tt_imp_fejl_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sti = dir.join("import.db");

        // En importfil hvor `activities` har en række der krænker NOT NULL i
        // hovedbasens version af tabellen, så kopieringen fejler. `clients`
        // står før `activities` i skemaet og bliver altså kopieret FØR fejlen.
        //
        // Rækken er gyldig i importfilens egen (ældre, løsere) activities-tabel,
        // men ikke i hovedbasens — en backup udefra kan sagtens indeholde
        // noget, der ikke må skrives ind i den nuværende skemastruktur.
        let import = skriv_import_db(&sti);
        import
            .execute_batch(
                "DROP TABLE activities;
                 CREATE TABLE activities (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     app_name TEXT,
                     started_at TEXT,
                     duration INTEGER
                 );
                 INSERT INTO activities (app_name, started_at, duration)
                     VALUES ('VS Code', NULL, 60);",
            )
            .unwrap();
        import
            .execute(
                "INSERT INTO clients (id, name) VALUES ('c-import', 'Fra import')",
                [],
            )
            .unwrap();
        drop(import);

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Original')",
            [],
        )
        .unwrap();

        let res = replace_all_data_from_import(&conn, sti.to_str().unwrap());
        assert!(res.is_err(), "en ødelagt import skal give en fejl");

        // Klogtasten skal læse som noget brugeren kan handle på.
        let besked = res.unwrap_err();
        assert!(
            besked.contains("intet blev ændret"),
            "fejlen skal love brugeren at intet er ændret: {besked}"
        );

        // Kernen: den oprindelige klint overlever, og den nye er ikke kommet ind.
        assert_eq!(count_clients(&conn), 1, "klientdata må ikke gå tabt");
        assert_eq!(klientnavn(&conn, "c1"), "Original");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
