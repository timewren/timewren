//! Skrivninger til databasen må aldrig forsvinde lydløst.
//!
//! To ting lå sammen på denne side af refactoreringen:
//!
//! 1. `let _ = conn.execute(...)` — en SQLite-fejl (BUSY, LOCKED, constraint)
//!    blev smidt væk, så en aktivitet, en tidsregistrering eller en
//!    klippekort-fradragning bare forsvandt. Missionen siger, at tabt tid er
//!    den værste fejl produktet kan lave.
//! 2. SQLITE_BUSY/LOCKED kom ofte som et enkelt fejlsvar. Trackeren åbner sin
//!    egen connection til den samme databasefil, så en skrivning fra to steder
//!    på én gang kolliderer — og skrivningen blev tabt, selv om den bare
//!    skulle vente et par millisekunder.
//!
//! `execute_retry` løser (2), og `record` løser (1): en fejl, der ikke kan
//! håndteres, bliver skrevet i loggen med en dansk besked, der siger HVAD der
//! gik galt — så den kan findes frem igen i en bug-rapport.
//!
//! Loggen er ikke nok alene. `main.rs` sætter
//! `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` for at
//! undgå et konsolvindue i release — og det betyder samtidig, at `eprintln!`
//! skriver til et håndtag, ingen læser: i den udgivne app var hver
//! databaseskrivningsfejl usynlig, også for os. Derfor sendes fejlen også til
//! Sentry, som `before_send` i `sentry_setup` renser for persondata — og kun
//! når brugeren har fejlrapportering slået til.

use rusqlite::{Connection, Error, ErrorCode, Params};
use std::time::Duration;

/// Hvor mange gange en BUSY/LOCKED-skrivning prøves igen.
///
/// SQLite's egen `busy_timeout` dækker de fleste tilfælde, men den gælder kun
/// den connection, der venter. Fem korte forsøg med stigende pause dækker også
/// det værste tilfælde: to skrivninger, der starter præcis samtidig.
const BUSY_RETRIES: u32 = 5;

/// Hæver en skrivningsfejl, der ellers ville være forsvundet.
///
/// `hvad` skal være en kort, dansk beskrivelse af skrivningen — fx
/// "kunne ikke gemme aktivitet" — ikke en tabelnavne-liste. Fejlteksten fra
/// SQLite appenderes, så den tekniske årsag ikke tabes.
///
/// Skriver til stderr (synligt under udvikling) og sender beskeden til Sentry
/// (synligt i den udgivne app, hvor stderr er lukket).
pub fn record(hvad: &str, e: impl std::fmt::Display) {
    send(&sammensæt(hvad, &e.to_string()));
}

/// Rapporterer en hændelse, der ikke har en fejltekst vedhæftet.
///
/// Til de steder, der kender problemet uden at have en `rusqlite::Error` —
/// fx en forgiftet mutex, hvor selve fejlen *er* det, der genoprettes.
pub fn noter(besked: &str) {
    send(besked);
}

/// Logger fejlen og giver den videre til den, der kaldte.
///
/// Samme garanti som [`record`], men svaret er den danske fejltekst, så kaldet
/// tvinger den fejlslagte funktion til at stoppe og kalderen til at håndtere
/// det: `.map_err(|e| db::errors::propager("kunne ikke gemme profilen", e))?`.
/// Brug den der, hvor en fejl efterlader brugeren med forkerte data — en
/// delvist skrevet profil. Brug *ikke* den, hvor skridtet er rent kosmetisk
/// (f.eks. `PRAGMA incremental_vacuum`), eller hvor der allerede er skrevet
/// noget, kaldet ikke tør rulle tilbage.
pub fn propager(hvad: &str, e: impl std::fmt::Display) -> String {
    let besked = sammensæt(hvad, &e.to_string());
    send(&besked);
    besked
}

/// Skriver beskeden begge steder: stderr til udvikleren, Sentry til alle andre.
///
/// Sentry-delen springes over, når brugeren har slået fejlrapportering fra i
/// Privatliv — samme valg, som frontendens `initSentry` læser. Uden denne
/// tjek ville en bruger, der bevidst har slået den fra, alligevel få sine
/// databasefejl sendt, så snart DSN'en virker i den udgivne app.
fn send(besked: &str) {
    eprintln!("TimeTrack: {besked}");
    if crate::sentry_setup::må_sende() {
        sentry::capture_message(besked, sentry::Level::Error);
    }
}

/// Sætter den dansk besked sammen med den tekniske årsag.
///
/// Kaldere, der ikke har en fejltekst (fx "springer tabellen X over ved
/// import"), skal ikke få en tom `: ` til sidst.
fn sammensæt(hvad: &str, fejl: &str) -> String {
    if fejl.trim().is_empty() {
        hvad.to_string()
    } else {
        format!("{hvad}: {fejl}")
    }
}

/// Kører en skrivning og prøver igen hvis databasen er låst.
///
/// Retter SQLITE_BUSY og SQLITE_LOCKED (tidsdelte transaktioner og
/// skrive-låse) med en stigende pause imellem. Alle andre fejl — constraint,
/// manglende tabel, diskfejl — returneres med det samme, fordi de ikke bliver
/// bedre af at prøve igen.
///
/// `P: Copy` fordi parametrene bruges igen ved hvert forsøg. Det dækker alle
/// rusqlite-kald (`params![..]` og `[]` er `Copy`); har man en samlet `Vec`,
/// sender man den som `&vec[..]`.
pub fn execute_retry<P: Params + Copy>(
    conn: &Connection,
    sql: &str,
    params: P,
) -> Result<usize, Error> {
    let mut pause = Duration::from_millis(5);

    for attempt in 0..=BUSY_RETRIES {
        match conn.execute(sql, params) {
            Ok(n) => return Ok(n),
            Err(e) if is_busy(&e) && attempt < BUSY_RETRIES => {
                std::thread::sleep(pause);
                pause *= 2;
            }
            Err(e) => return Err(e),
        }
    }

    // Uden denne ville vi returnere unit; med loopen over er den sidste
    // iteration altid en Err, så den er kun her for at tilfredsstille typen.
    unreachable!("execute_retry returnerer altid via Ok/Err i loopen")
}

/// Sand hvis fejlen betyder "vent lidt", ikke "giv op".
fn is_busy(e: &Error) -> bool {
    matches!(
        e,
        Error::SqliteFailure(f, _) if f.code == ErrorCode::DatabaseBusy || f.code == ErrorCode::DatabaseLocked
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn
    }

    #[test]
    fn execute_retry_skriver_normalt() {
        let conn = setup();
        let n = execute_retry(
            &conn,
            "INSERT INTO clients (id, name) VALUES (?1, ?2)",
            rusqlite::params!["c1", "Test"],
        )
        .expect("insert skal lykkes");

        assert_eq!(n, 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn execute_retry_giver_constraint_fejl_tilbage_med_dansk_kontekst() {
        let conn = setup();
        execute_retry(
            &conn,
            "INSERT INTO clients (id, name) VALUES (?1, ?2)",
            rusqlite::params!["c1", "Test"],
        )
        .unwrap();

        // Samme primærnøgle igen -> UNIQUE-constraint. Må IKKE retries være
        // spildt tid på, og må IKKE svare "lykkedes".
        let fejl = execute_retry(
            &conn,
            "INSERT INTO clients (id, name) VALUES (?1, ?2)",
            rusqlite::params!["c1", "Dublet"],
        )
        .expect_err("dublet skal fejle");

        assert!(!is_busy(&fejl), "constraint-fejl må ikke regnes som BUSY");
        // Der ligger stadig kun én klient — den duplikerede blev skrevet forkert?
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn execute_retry_prøver_igen_når_databasen_er_låst() {
        // Filer på disk, fordi LOCKED kræver to rigtige connections.
        let dir = std::env::temp_dir().join(format!("tt_busy_{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("opret temp-dir");
        let path = dir.join("busy.db");

        let conn = Connection::open(&path).expect("open");
        conn.execute_batch(SCHEMA).expect("create schema");

        // En connection, der holder den eksklusive skrive-lås.
        let locker = Connection::open(&path).expect("open låse-connection");
        locker
            .execute_batch("BEGIN EXCLUSIVE;")
            .expect("lå db eksklusivt");

        // En anden connection, som bliver låst ude af den ovenstående.
        let conn = Connection::open(&path).expect("open anden connection");
        conn.busy_timeout(Duration::ZERO).expect("sæt busy_timeout");

        // Låsen slippes mens execute_retry venter — præcis det scenarie, hvor
        // den gamle kode tabte skrivningen i stedet for at prøve igen.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            let _ = locker.execute_batch("ROLLBACK;");
        });

        let res = execute_retry(
            &conn,
            "INSERT INTO clients (id, name) VALUES (?1, ?2)",
            rusqlite::params!["c1", "Test"],
        );

        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            res.is_ok(),
            "skrivning mod låst db skal lykkes efter retry: {res:?}"
        );
    }

    /// Slår fejlrapportering til og låser den globale, så de tre Sentry-tests
    /// nedenfor ikke kan se hinandens skrivninger. Se `sentry_setup`.
    fn med_rapportering_til<F: FnOnce()>(f: F) -> Vec<sentry::protocol::Event<'static>> {
        let _vagt = crate::sentry_setup::RAPPORTERINGSTEST
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        crate::sentry_setup::sæt_fejlrapportering(true);
        let hændelser = sentry::test::with_captured_events(f);
        crate::sentry_setup::sæt_fejlrapportering(false);
        hændelser
    }

    #[test]
    fn record_sender_databasefejl_til_sentry() {
        // Beviset på at fejlen er synlig i den UDGIVNE app: main.rs lukker
        // konsollen i release, så eprintln alene er hvid, og den gamle kode
        // sendte intet til Sentry. Testen ville være grøn mod den gamle kode
        // hvis den bare tællede eprintln.
        let hændelser = med_rapportering_til(|| {
            record("kunne ikke gemme tidsregistreringen", "database is locked");
        });

        assert_eq!(hændelser.len(), 1, "fejlen skal sendes videre, ikke ties");
        let besked = hændelser[0].message.as_deref().unwrap_or_default();
        assert_eq!(besked, "kunne ikke gemme tidsregistreringen: database is locked");
        assert_eq!(hændelser[0].level, sentry::Level::Error);
    }

    #[test]
    fn record_sender_ikke_naar_brugeren_har_slaaet_fejlrapportering_fra() {
        // Privatliv-siden læser valget og skriver det til både sider. Uden
        // denne tjek ville en bruger, der bevidst har slået fejlrapportering
        // fra, få sine databasefejl sendt, så snart DSN'en virker.
        let _vagt = crate::sentry_setup::RAPPORTERINGSTEST
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        crate::sentry_setup::sæt_fejlrapportering(false);

        let hændelser = sentry::test::with_captured_events(|| {
            record("kunne ikke gemme tidsregistreringen", "database is locked");
        });

        assert!(
            hændelser.is_empty(),
            "opt-ud skal gælde Rust-siden også, men {} hændelser slap ud",
            hændelser.len()
        );
    }

    #[test]
    fn record_udelader_tom_fejltekst() {
        let hændelser = med_rapportering_til(|| {
            record("springer tabellen sync_log over ved import", "")
        });

        assert_eq!(hændelser.len(), 1);
        assert_eq!(
            hændelser[0].message.as_deref(),
            Some("springer tabellen sync_log over ved import"),
            "et kald uden fejltekst må ikke få en tom ': ' til sidst"
        );
    }

    #[test]
    fn propager_giver_fejlen_videre_til_kalderen() {
        let mut svar: Option<String> = None;
        let hændelser = med_rapportering_til(|| {
            svar = Some(propager("kunne ikke gemme profilen fra skyen", "disk I/O error"));
        });

        // Uden propager ville kaldet fortsætte og skrive en halv profil, mens
        // appen tror den er opdateret.
        assert_eq!(
            svar.expect("propager skal svare med en fejltekst"),
            "kunne ikke gemme profilen fra skyen: disk I/O error"
        );
        assert_eq!(hændelser.len(), 1, "propager sender også til Sentry");
    }
}
