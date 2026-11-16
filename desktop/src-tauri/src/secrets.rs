//! Hemmeligheder i OS' egen nøglering — ikke i SQLite.
//!
//! Sync-token, Billy-nøglen og AI-nøglen lå alle som klartekst i
//! `settings`-tabellen, som er en fil brugeren kan kopiere, tage med på en
//! USB-stik eller læse fra en backup. Det er præcis de ting, der skal lå i
//! nøgleringen: macOS Keychain, Windows Credential Manager, kernel-keyutils på
//! Linux.
//!
//! Fire regler, der alle er testet i `tests` nederst:
//!
//! 1. **Klartekstrækken slettes først når nøglen er skrevet.** Rækkefølgen er
//!    hele pointen: skriver vi rækken væk først og nøgleringen så afviser,
//!    har brugeren mistet sit login. Derfor skriver `gem` til nøgleringen
//!    først og sletter bagefter — og hvis nøgleringen afviser, står den gamle
//!    værdi stadig i databasen og brugeren kan fortsætte som før.
//! 2. **En afvisning er en synlig fejl, ikke en stille nedskrivning.** `gem`
//!    returnerer `Err`, så UI'et viser at noget gik galt, i stedet for at
//!    lade brugeren tro at nøglen er gemt sikkert.
//! 3. **Migrationen må aldrig slette noget den ikke kan erstatte.** Se
//!    `flyt_klartekst_til_noeglering`.
//! 4. **Nøgleringen slår altid databasen.** Både ved læsning og ved
//!    migration: en nøgle i nøgleringen er skrevet med vilje, en række i
//!    `settings` kan være en gammel backup, der lige er blevet lagt ind.
//!
//! Hver platform får kun SIN butik (`cfg` i Cargo.toml), så der trækkes ingen
//! fremmed afhængighed ind på tværs af mål — især ikke dbus/zbus på Linux.

use keyring_core::{CredentialStore, Entry, Error};
use std::cell::RefCell;
use std::sync::Arc;

/// Butikken i nøgleringen. Egen type, fordi det fulde navn er langt nok til at
/// clippy kalder det "meget komplekst" på hver eneste brug.
type Butik = Arc<CredentialStore>;

/// Tjenesten alle poster hænger under i nøgleringen. Skal matche appens
/// bundle-id, så brugeren kan genkende og slette posten selv.
const SERVICE: &str = "dk.timetrack.desktop";

/// Nøglen i `ai_config`. Eget navn og ikke `ai_config` selv, fordi resten af
/// AI-configen (udbyder, model, base-URL) ikke er en hemmelighed og skal kunne
/// læses og redigeres som enhver anden indstilling. Det er kun `api_key`, der
/// forsvinder fra JSON-klumpen.
pub const AI_NØGLE: &str = "ai_api_key";

/// De settings-nøgler der ALDRIG må ligge i databasen.
///
/// Denne liste er porten: `er_hemmelighed` er det eneste spørgsmål, der
/// stilles, før en værdi skrives til `settings`, så den næste nøgle der
/// tilføjes med en værdi fra en bruger kan ikke ved et uheld blive en
/// klartekst-hemmelighed uden at den kommer her.
///
/// `ai_api_key` står her fordi nøglen overhovedet ikke skal kunne lægge sig i
/// tabellen: den skrives gennem `gem_nøgle_til_noeglering` i `commands::ai`, og
/// `flyt_ai_nøgle_til_noeglering` fjerner den igen hvis en gammel database
/// stadig har den liggende. Den læses aldrig af `get_setting`, men porten skal
/// kende den, så hverken `set_setting` fra frontend eller en ny kommando kan
/// lægge den i tabellen.
pub const HEMMELIGHEDER: &[&str] = &["sync_token", "billy_api_key", AI_NØGLE];

/// True hvis `nøgle` er en hemmelighed, der skal i nøgleringen.
pub fn er_hemmelighed(nøgle: &str) -> bool {
    HEMMELIGHEDER.contains(&nøgle)
}

/// Butikken for denne platform.
///
/// Bygges én gang per proces: både macOS' Keychain-opslag og Windows'
/// Credential Manager er målbar-hændelser (de kan endda vise et systemdialog),
/// så de kaldes ikke pr. læsning.
#[cfg(target_os = "macos")]
fn os_butik() -> Option<Butik> {
    Some(apple_native_keyring_store::keychain::Store::new().ok()?)
}

#[cfg(target_os = "windows")]
fn os_butik() -> Option<Butik> {
    Some(windows_native_keyring_store::Store::new().ok()?)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn os_butik() -> Option<Butik> {
    Some(linux_keyutils_keyring_store::Store::new().ok()?)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
fn os_butik() -> Option<Butik> {
    None
}

/// `OnceLock` så `os_butik` kun kaldes én gang — også fordi `Store::new()`
/// på Windows kan åbne Credential Manager-håndtaget.
fn delt_butik() -> Option<Butik> {
    static BUTIK: std::sync::OnceLock<Option<Butik>> = std::sync::OnceLock::new();
    BUTIK.get_or_init(os_butik).clone()
}

thread_local! {
    /// Test-butik. Thread-lokal og ikke global: Rust kører hver `#[test]` på
    /// sin egen tråd, så to tests der hver sætter en mock-butik aldrig kan
    /// forstyrre hinanden — hvilket en `set_default_store` i global tilstand
    /// ville kunne.
    static TESTBUTIK: RefCell<Option<Butik>> = const { RefCell::new(None) };
}

/// Sætter en erstatnings-butik for denne tråd. Kun tests.
#[cfg(test)]
pub fn brug_testbutik(butik: Butik) {
    TESTBUTIK.with(|t| *t.borrow_mut() = Some(butik));
}

/// Sætter en mock-butik for denne tråd og giver den tilbage, så testen kan
/// nå den og få den til at sige nej. Kun tests.
///
/// `Butik` holdes privat, fordi casting en `Arc` ind i et trait-objekt er
/// noget der kun skal ske ét sted — testsne får butikken herfra i stedet for
/// selv at lave castingen. Den skal holdes i en variabel i testen: er den kun
/// et midlertidigt udtryk, dør butikken med det.
#[cfg(test)]
pub fn brug_mock_butik() -> Butik {
    let butik: Butik = keyring_core::mock::Store::new().expect("mock-butik");
    brug_testbutik(Arc::clone(&butik));
    butik
}

fn butik() -> Option<Butik> {
    if let Some(b) = TESTBUTIK.with(|t| t.borrow().clone()) {
        return Some(b);
    }
    delt_butik()
}

/// Erstatnings-test: kræver at nøgleringen kan *læses*, ellers ville en test
/// der forventer en værdi gå grøn fordi læsningen fejlede stille.
fn kræver_butik() -> Result<Butik, String> {
    butik().ok_or_else(|| "nøgleringen er ikke tilgængelig på denne maskine".to_string())
}

fn post(nøgle: &str) -> Result<Entry, String> {
    kræver_butik()?
        .build(SERVICE, nøgle, None)
        .map_err(|e| nøglefejl(nøgle, e))
}

fn nøglefejl(nøgle: &str, e: Error) -> String {
    format!("nøgleringen afviste '{}': {}", nøgle, e)
}

/// `Error::NoEntry` betyder «ikke gemt», ikke «fejl». Alt andet er en fejl.
fn er_ikke_gemt(e: &Error) -> bool {
    matches!(e, Error::NoEntry)
}

/// Læs en hemmelighed fra nøgleringen. `Ok(None)` betyder «ikke gemt» — ikke
/// «nøgleringen er lukket».
pub fn hent(nøgle: &str) -> Result<Option<String>, String> {
    match post(nøgle)?.get_password() {
        Ok(værdi) => Ok(Some(værdi)),
        Err(e) if er_ikke_gemt(&e) => Ok(None),
        Err(e) => Err(nøglefejl(nøgle, e)),
    }
}

/// Gem en hemmelighed i nøgleringen.
///
/// Klartekstrækken i `settings` slettes **efter** at nøglen er skrevet, så en
/// afvisning efterlader brugeren med den værdi de havde, ikke med ingen.
pub fn gem(nøgle: &str, værdi: &str) -> Result<(), String> {
    post(nøgle)?.set_password(værdi).map_err(|e| nøglefejl(nøgle, e))
}

/// Gem `værdi` — men kun hvis nøglen **ikke allerede** står i nøgleringen.
///
/// `Ok(false)` betyder «nøgleringen havde en nøgle, og den blev bevaret».
/// Det er den retning der skal gælde ved en migration: en nøgle i nøgleringen
/// er skrevet med vilje, mens værdien i databasen kan komme fra en backup der
/// lige er lagt ind. Uden denne skeln overskriver hver opstart nøglen med en
/// ældre fra en backup.
///
/// Begge fejl — i læsningen og i skrivningen — er ét `Err`, fordi de er det
/// samme for kaldet: nøgleringen skal ikke røres ved databasen. Skelnene
/// mellem dem kan ikke testes med en mock-butik, der kun kan fejle alt for én
/// nøgle ad gangen, så de er slået sammen her i stedet for at være to
/// enslydende, halvt udækkede grene.
pub fn gem_hvis_ikke_findes(nøgle: &str, værdi: &str) -> Result<bool, String> {
    if hent(nøgle)?.is_some() {
        return Ok(false);
    }
    gem(nøgle, værdi)?;
    Ok(true)
}

/// Slet en hemmelighed. «Den var der ikke» er ikke en fejl — logout skal kunne
/// køre igen uden at fejle på en maskine hvor den aldrig blev gemt.
pub fn slet(nøgle: &str) -> Result<(), String> {
    match post(nøgle)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(e) if er_ikke_gemt(&e) => Ok(()),
        Err(e) => Err(nøglefejl(nøgle, e)),
    }
}

/// Flyt en hemmelighed der står i klartekst i `settings` over i nøgleringen.
///
/// Nøgleringen sættes først; rækken slettes kun hvis nøkleringen står med en
/// værdi bagefter. En fejl **sletter intet** — brugeren beholder sit login, og
/// næste start prøver igen. Det er derfor migrationen kan køre igen uden at
/// være destruktiv.
///
/// Rækken slettes også når nøkleringen *allerede* havde en nøgle: regel 4 siger,
/// at nøkleringen slår databasen, så den ældre værdi fra en backup er den der
/// skal væk — ellers bliver den liggende i en fil brugeren kan kopiere, præcis
/// som den var før migrationen.
///
/// Samme to stop som `flyt_ai_nøgle_til_noeglering`, og af samme grund: en
/// klartekstnøgle i `settings` er næsten altid fra en backup, ikke fra
/// brugeren. Uden `gem_hvis_ikke_findes` skrev hver opstart den ældre værdi fra
/// en lagt-ind backup over den brugeren havde valgt nu — og efter en import er
/// det præcis det der sker.
pub fn flyt_klartekst_til_noeglering(conn: &rusqlite::Connection, nøgle: &str) -> bool {
    let værdi: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![nøgle],
            |r| r.get(0),
        )
        .ok();

    let Some(værdi) = værdi else {
        return false;
    };

    match gem_hvis_ikke_findes(nøgle, &værdi) {
        // Nøkleringen har nu en værdi: enten den vi netop skrev, eller en der lå
        // der i forvejen og er den ældre — se regel 4.
        Ok(_) => {
            if let Err(e) = conn.execute(
                "DELETE FROM settings WHERE key = ?1",
                rusqlite::params![nøgle],
            ) {
                crate::db::errors::record(
                    &format!("kunne ikke fjerne '{}' fra databasen", nøgle),
                    e,
                );
            }
            true
        }
        Err(e) => {
            // Bevidst ikke en `record`: nøgleringen kan være lukket, og så er
            // dette forventet og ikke noget at sende hver start op.
            eprintln!(
                "[secrets] '{}' bliver i databasen: nøgleringen ville ikke tage den ({})",
                nøgle, e
            );
            false
        }
    }
}

/// Flyt API-nøglen ud af `ai_config`-klumpen og ind i nøgleringen.
///
/// Egen funktion, fordi nøglen her ligger *inde i* en JSON-klump: den kan ikke
/// flyttes med `flyt_klartekst_til_noeglering`, som læser en hel række. Klumpen
/// er desuden ikke en hemmelighed i sig selv — udbyder, model og base-URL skal
/// blive liggende i `settings`, så brugeren kan redigere dem.
///
/// Samme rækkefølge og samme to stop: nøglen skal være i nøgleringen FØR
/// `api_key` fjernes fra klumpen, og klumpen røres overhovedet ikke hvis den
/// er noget vi ikke forstår (ugyldig JSON, en tekst der ikke er et objekt).
/// Derfor er den tryg at køre igen ved hver start.
///
/// Regel 4 gælder her på en måde den ikke gælder for de to andre: nøgleringen
/// slår klumpen. Har nøgleringen allerede en nøgle, er den skrevet med vilje,
/// mens klumpens kan komme fra en gammel backup — så det er **klumpens** der
/// ryddes væk, og nøgleringens bevares.
pub fn flyt_ai_nøgle_til_noeglering(conn: &rusqlite::Connection) -> bool {
    let klump: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'ai_config'",
            [],
            |r| r.get(0),
        )
        .ok();

    let Some(klump) = klump else {
        return false;
    };

    // En klump vi ikke kan læse, rører vi ikke. At slette et felt vi ikke
    // forstod ville være at slette brugerens nøgle uden at have gemt den.
    let mut json: serde_json::Value = match serde_json::from_str(&klump) {
        Ok(json) => json,
        Err(e) => {
            eprintln!("[secrets] 'ai_config' er ikke gyldig JSON og røres ikke: {}", e);
            return false;
        }
    };
    let Some(objekt) = json.as_object_mut() else {
        eprintln!("[secrets] 'ai_config' er ikke et JSON-objekt og røres ikke");
        return false;
    };

    let nøgle = match objekt.get("api_key").and_then(|v| v.as_str()) {
        // En tom nøgle er ikke en nøgle. `api_key: ""` er det, UI'et sender
        // når brugeren tømmer feltet, og så er der intet at flytte.
        Some(nøgle) if !nøgle.trim().is_empty() => nøgle.to_string(),
        _ => return false,
    };
    objekt.remove("api_key");

    match gem_hvis_ikke_findes(AI_NØGLE, &nøgle) {
        // Nøglen er i nøgleringen nu. Enten skrev vi den, eller den lå der
        // i forvejen og klumpens værdi er den ældre — se regel 4.
        Ok(_) => {}
        Err(e) => {
            eprintln!(
                "[secrets] 'ai_config'-nøglen bliver i databasen: nøgleringen ville ikke tage den ({})",
                e
            );
            return false;
        }
    }

    // Serialisering af en `serde_json::Value` kan ikke fejle: den er allerede
    // parset én gang, så der er ingen ny fejlkilde at håndtere.
    let ryddet = serde_json::to_string(&json).unwrap_or(klump.clone());
    if let Err(e) = conn.execute(
        "UPDATE settings SET value = ?1 WHERE key = 'ai_config'",
        rusqlite::params![ryddet],
    ) {
        crate::db::errors::record("kunne fjerne API-nøglen fra 'ai_config'", e);
        return false;
    }
    true
}

/// Flyt **alle** klartekst-hemmeligheder i `settings` over i nøgleringen.
///
/// Én indgang til hele migrationen, kaldt fra to steder:
///
/// 1. `Database::apply_migrations` ved hver opstart.
/// 2. `import_database` efter at en backup er kopieret ind.
///
/// Det er ikke en bekvemmelighed, det er pointen. `copy_all_tables` kopierer
/// `settings` tabel for tabel, så en backup fra **før** nøgleringen kom
/// lægger `sync_token` og `billy_api_key` tilbage som klartekst i en fil
/// brugeren kan kopiere — præcis det D3/D3b fjernede. Kun nye backups er lukket
/// ved konstruktion, fordi nøglerne ikke ligger i tabellen længere; gamle
/// backup-filer er problemet, og de kan kun løses ved at køre migrationen igen
/// efter indlæsningen.
///
/// To kaldssteder med hver sin løkke over nøglerne var en fejl i
/// klædeafdelingen: den næste hemmelighed der kommer til ville blive ryddet i
/// den ene og ikke i den anden, og ingen port ville se det.
///
/// Tallet er antallet af nøgler der faktisk blev ryddet. Brugere med en låst
/// nøglering får 0, og det er ikke en fejl: deres nøgle bliver i databasen,
/// hvorfra næste start prøver igen.
///
/// En database uden `settings`-tabel giver også 0: hver af funktionerne
/// læser rækken med `.ok()`, så en delvis database fra en gammel backup er
/// ikke en fejl — den har bare ingen hemmeligheder at rydde.
pub fn ryd_klarteksthemmeligheder(conn: &rusqlite::Connection) -> usize {
    let mut ryddet = 0;
    for nøgle in HEMMELIGHEDER {
        if flyt_klartekst_til_noeglering(conn, nøgle) {
            ryddet += 1;
        }
    }
    // AI-nøglen lå inde i `ai_config`-klumpen, så den kan ikke flyttes med
    // række-adgangen ovenfor. Egen funktion, samme to stop: nøglen skal være i
    // nøgleringen før `api_key` fjernes fra JSON'en, og en klump vi ikke kan
    // læse røres ikke.
    if flyt_ai_nøgle_til_noeglering(conn) {
        ryddet += 1;
    }
    ryddet
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;

    /// En mock-butik der bruges af alle tests i denne tråd. Rusts test-harness
    /// giver hver `#[test]` sin egen tråd, så butikkerne deler ingen state.
    fn mock_butik() -> Butik {
        let butik: Butik = mock::Store::new().expect("mock-butik");
        brug_testbutik(Arc::clone(&butik));
        butik
    }

    fn db_med_klartekst(nøgle: &str, værdi: &str) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )
        .expect("settings-tabel");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![nøgle, værdi],
        )
        .expect("klartekstrække");
        conn
    }

    fn klartekst_rækker(conn: &rusqlite::Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT key FROM settings ORDER BY key")
            .expect("læs");
        let nøgler = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .expect("rækker");
        nøgler.flatten().collect()
    }

    #[test]
    fn gem_læser_og_sletter_i_noegleringen() {
        let _butik = mock_butik();

        gem("sync_token", "hemmeligt-token").expect("gem");
        assert_eq!(hent("sync_token").unwrap().as_deref(), Some("hemmeligt-token"));

        slet("sync_token").expect("slet");
        assert_eq!(hent("sync_token").unwrap(), None);
    }

    #[test]
    fn slet_paa_en_noegle_der_aldrig_var_gemt_er_ikke_en_fejl() {
        let _butik = mock_butik();
        slet("billy_api_key").expect("slet skal være idempotent");
        slet("billy_api_key").expect("igen");
    }

    #[test]
    fn en_noegle_der_ikke_findes_er_none_og_ikke_en_fejl() {
        let _butik = mock_butik();
        assert_eq!(hent("sync_token").unwrap(), None);
    }

    /// Klartekstrækken skal være væk, så snart nøglen er skrevet — det er hele
    /// pointen med opgaven.
    #[test]
    fn migration_slaetter_klartekstraekken_naar_noegleringen_tager_den() {
        let _butik = mock_butik();
        let conn = db_med_klartekst("sync_token", "gammelt-token");

        assert!(flyt_klartekst_til_noeglering(&conn, "sync_token"));

        assert_eq!(hent("sync_token").unwrap().as_deref(), Some("gammelt-token"));
        assert!(klartekst_rækker(&conn).is_empty(), "klartekstrækken skal være væk");
    }

    /// Den anden retning er den farlige: hvis nøgleringen afviser, må vi IKKE
    /// have slettet rækken. Ellers har brugeren mistet sit login uden at have
    /// fået en ny nøgle.
    #[test]
    fn migration_beholder_klartekstraekken_naar_noegleringen_siger_nej() {
        let butik: Butik = mock::Store::new().expect("mock-butik");
        brug_testbutik(Arc::clone(&butik));
        let conn = db_med_klartekst("sync_token", "gammelt-token");

        // Butikken afviser den næste skrivning, som en låst nøglering gør.
        let post = butik
            .build(SERVICE, "sync_token", None)
            .expect("byg post");
        let cred: &mock::Cred = post.as_any().downcast_ref().expect("mock-cred");
        cred.set_error(Error::PlatformFailure(Box::new(std::io::Error::other(
            "nøgleringen er låst",
        ))));

        assert!(!flyt_klartekst_til_noeglering(&conn, "sync_token"));
        assert_eq!(klartekst_rækker(&conn), vec!["sync_token".to_string()]);
        assert_eq!(hent("sync_token").unwrap(), None);
    }

    #[test]
    fn migration_er_idempotent_paa_en_database_med_data() {
        let _butik = mock_butik();
        let conn = db_med_klartekst("sync_token", "gammelt-token");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'dark')",
            [],
        )
        .expect("ikke-hemmelig indstilling");

        assert!(flyt_klartekst_til_noeglering(&conn, "sync_token"));
        assert!(!flyt_klartekst_til_noeglering(&conn, "sync_token"), "intet at flytte");
        flyt_klartekst_til_noeglering(&conn, "sync_token");

        assert_eq!(klartekst_rækker(&conn), vec!["theme".to_string()]);
        assert_eq!(hent("sync_token").unwrap().as_deref(), Some("gammelt-token"));
    }

    #[test]
    fn alle_hemmeligheder_flyttes_og_anden_data_ror_ikke() {
        let _butik = mock_butik();
        let conn = db_med_klartekst("sync_token", "token-abc");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('billy_api_key', 'billy-xyz')",
            [],
        )
        .expect("billy");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('ai_api_key', 'sk-gammel')",
            [],
        )
        .expect("ai");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('sync_email', 'a@b.dk')",
            [],
        )
        .expect("email");

        for nøgle in HEMMELIGHEDER {
            assert!(flyt_klartekst_til_noeglering(&conn, nøgle), "{}", nøgle);
        }

        assert_eq!(hent("sync_token").unwrap().as_deref(), Some("token-abc"));
        assert_eq!(hent("billy_api_key").unwrap().as_deref(), Some("billy-xyz"));
        assert_eq!(hent(AI_NØGLE).unwrap().as_deref(), Some("sk-gammel"));
        assert_eq!(klartekst_rækker(&conn), vec!["sync_email".to_string()]);
    }

    #[test]
    fn porten_kender_alle_hemmeligheder() {
        assert!(er_hemmelighed("sync_token"));
        assert!(er_hemmelighed("billy_api_key"));
        assert!(er_hemmelighed(AI_NØGLE));
        assert!(!er_hemmelighed("sync_email"));
        assert!(!er_hemmelighed("theme"));
        // `ai_config` er IKKE en hemmelighed: klumpen skal kunne læses og
        // redigeres i settings. Det er `api_key` inde i den, der er det.
        assert!(!er_hemmelighed("ai_config"));
    }

    // ---- AI-nøglen, der ligger inde i `ai_config`-klumpen -----------------

    /// En database fra den forrige version: JSON-klump med alle fire felter,
    /// som de stod på disk inden nøglen flyttede.
    fn db_med_ai_klump(klump: &str) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .expect("settings-tabel");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('ai_config', ?1)",
            rusqlite::params![klump],
        )
        .expect("klump");
        conn
    }

    fn læs_klump(conn: &rusqlite::Connection) -> serde_json::Value {
        let rå: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'ai_config'",
                [],
                |r| r.get(0),
            )
            .expect("klump");
        serde_json::from_str(&rå).expect("klump er stadig gyldig JSON")
    }

    /// Hele pointen: nøglen er ude af databasen, resten af configen er der.
    #[test]
    fn ai_noeglen_flyttes_ud_af_klumpen() {
        let _butik = mock_butik();
        let conn = db_med_ai_klump(
            r#"{"provider":"anthropic","api_key":"sk-antik-hemmelig","model":"claude-haiku-4-5-20251001","base_url":null}"#,
        );

        assert!(flyt_ai_nøgle_til_noeglering(&conn));

        assert_eq!(hent(AI_NØGLE).unwrap().as_deref(), Some("sk-antik-hemmelig"));
        let klump = læs_klump(&conn);
        assert!(klump.get("api_key").is_none(), "nøglen må ikke stå i klumpen");
        // Resten er ikke en hemmelighed og skal overleve præcis som den var.
        assert_eq!(klump["provider"], "anthropic");
        assert_eq!(klump["model"], "claude-haiku-4-5-20251001");
        assert!(klump.get("base_url").is_some(), "feltet skal ikke forsvinde");
    }

    /// Den farlige retning: afviser nøgleringen, må vi ikke have slettet
    /// nøglen fra klumpen — ellers har brugeren mistet den uden at få en ny.
    /// Både en fejl i læsningen og en i skrivningen ender her, se
    /// `gem_hvis_ikke_findes`.
    #[test]
    fn ai_noeglen_bliver_i_klumpen_naar_noegleringen_siger_nej() {
        let butik: Butik = mock::Store::new().expect("mock-butik");
        brug_testbutik(Arc::clone(&butik));
        let conn = db_med_ai_klump(r#"{"provider":"openai","api_key":"sk-lys"}"#);

        let post = butik.build(SERVICE, AI_NØGLE, None).expect("byg post");
        let cred: &mock::Cred = post.as_any().downcast_ref().expect("mock-cred");
        cred.set_error(Error::PlatformFailure(Box::new(std::io::Error::other(
            "nøgleringen er låst",
        ))));

        assert!(!flyt_ai_nøgle_til_noeglering(&conn));
        assert_eq!(læs_klump(&conn)["api_key"], "sk-lys");
    }

    /// Nøgleringen er den ægte: en backup fra i dag kan komme med en gammel
    /// nøgle i klumpen, og den må ikke skrive over den brugeren har valgt nu.
    #[test]
    fn noegleringen_slaar_klumpen_naar_begde_steder_har_en_noegle() {
        let _butik = mock_butik();
        gem(AI_NØGLE, "sk-nyeste").expect("gem");
        let conn = db_med_ai_klump(r#"{"provider":"openai","api_key":"sk-gammel-fra-backup"}"#);

        assert!(flyt_ai_nøgle_til_noeglering(&conn));

        assert_eq!(hent(AI_NØGLE).unwrap().as_deref(), Some("sk-nyeste"));
        assert!(læs_klump(&conn).get("api_key").is_none());
    }

    /// `api_key: ""` er det UI'et sender, når brugeren tømmer feltet. Det er
    /// ikke en nøgle, så der skal ikke skrives en tom nøgle til nøgleringen.
    #[test]
    fn en_tom_noegle_er_ikke_en_noegle() {
        let _butik = mock_butik();
        let conn = db_med_ai_klump(r#"{"provider":"ollama","api_key":""}"#);

        assert!(!flyt_ai_nøgle_til_noeglering(&conn));
        assert_eq!(hent(AI_NØGLE).unwrap(), None);
        assert_eq!(læs_klump(&conn)["api_key"], "");
    }

    /// Kører hver start, så to gange er det normale — ikke en fejl.
    #[test]
    fn ai_noeglen_er_idempotent_paa_en_database_med_data() {
        let _butik = mock_butik();
        let conn = db_med_ai_klump(r#"{"provider":"openai","api_key":"sk-abc","model":"gpt-4o-mini"}"#);
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'dark')",
            [],
        )
        .expect("ikke-hemmelig indstilling");

        assert!(flyt_ai_nøgle_til_noeglering(&conn));
        assert!(!flyt_ai_nøgle_til_noeglering(&conn), "intet at flytte");
        flyt_ai_nøgle_til_noeglering(&conn);

        assert_eq!(hent(AI_NØGLE).unwrap().as_deref(), Some("sk-abc"));
        assert_eq!(læs_klump(&conn)["model"], "gpt-4o-mini");
        assert_eq!(klartekst_rækker(&conn), vec!["ai_config".to_string(), "theme".to_string()]);
    }

    /// En klump vi ikke forstår, rører vi ikke. Den kan komme fra en fremtidig
    /// version af appen, og det værste vi kan gøme er at slette nøglen uden at
    /// have gemt den.
    #[test]
    fn en_klump_vi_ikke_forstaar_ror_ikke_og_sletter_ikke_noeglen() {
        let _butik = mock_butik();
        for klump in [
            "ikke json overhovedet",
            "[1, 2, 3]",
            r#"{"api_key": 42}"#,
        ] {
            let conn = db_med_ai_klump(klump);
            assert!(
                !flyt_ai_nøgle_til_noeglering(&conn),
                "skulle ikke have rørt: {}",
                klump
            );
            let rå: String = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'ai_config'",
                    [],
                    |r| r.get(0),
                )
                .expect("klump");
            assert_eq!(rå, klump, "klumpen skal stå uændret: {}", klump);
        }
        assert_eq!(hent(AI_NØGLE).unwrap(), None);
    }

    // ---- `gem_hvis_ikke_findes` -------------------------------------------

    /// Nøgleringen slår også de to **række**-nøgler, ikke kun AI-nøglen.
    ///
    /// D3b indførte `gem_hvis_ikke_findes` for `ai_config`-klumpen, men
    /// `flyt_klartekst_til_noeglering` kaldte stadig `gem`, som overskriver.
    /// Det er den samme fejl i to halvdele: en værdi fra en backup skrev over
    /// den brugeren havde valgt nu, og da var det *sync-tokenet* — altså den
    /// nøgle der afgør hvem brugeren er logget ind som.
    #[test]
    fn noegleringen_slaar_en_gammel_klartekstraekke() {
        let _butik = mock_butik();
        for nøgle in ["sync_token", "billy_api_key"] {
            gem(nøgle, "nyeste").expect("gem");
            let conn = db_med_klartekst(nøgle, "gammel-fra-backup");

            assert!(
                flyt_klartekst_til_noeglering(&conn, nøgle),
                "{nøgle}: rækken skal ryddes væk"
            );
            assert_eq!(
                hent(nøgle).unwrap().as_deref(),
                Some("nyeste"),
                "{nøgle}: nøgleringen skal bevares"
            );
            assert!(
                klartekst_rækker(&conn).is_empty(),
                "{nøgle}: den ældre værdi må ikke blive liggende i databasen"
            );
        }
    }

    /// Den ene indgang, begge kaldssteder bruger: en opstart og en
    /// backup-import. Den skal rydde alle tre og lade alt andet stå.
    #[test]
    fn ryd_indgangen_tømmer_alle_hemmeligheder_og_andet_ror_ikke() {
        let _butik = mock_butik();
        let conn = db_med_klartekst("sync_token", "token-abc");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('billy_api_key', 'billy-xyz')",
            [],
        )
        .expect("billy");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('sync_email', 'a@b.dk')",
            [],
        )
        .expect("email");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'dark')",
            [],
        )
        .expect("tema");
        conn.execute(
            "INSERT INTO settings (key, value)
             VALUES ('ai_config', '{\"provider\":\"openai\",\"api_key\":\"sk-abc\"}')",
            [],
        )
        .expect("klump");

        // Alle tre hemmeligheder er til stede: to rækker og klumpen.
        assert_eq!(ryd_klarteksthemmeligheder(&conn), 3);

        assert_eq!(hent("sync_token").unwrap().as_deref(), Some("token-abc"));
        assert_eq!(hent("billy_api_key").unwrap().as_deref(), Some("billy-xyz"));
        assert_eq!(hent(AI_NØGLE).unwrap().as_deref(), Some("sk-abc"));

        // Ikke-hemmelighederne er urørt, og klumpen har mistet nøglen men
        // beholdt resten.
        assert_eq!(
            klartekst_rækker(&conn),
            vec!["ai_config".to_string(), "sync_email".to_string(), "theme".to_string()]
        );
        let klump = læs_klump(&conn);
        assert!(klump.get("api_key").is_none());
        assert_eq!(klump["provider"], "openai");

        // Kører igen hver opstart, så nul er det normale svar.
        assert_eq!(ryd_klarteksthemmeligheder(&conn), 0);
    }

    /// En låst nøglering rydder intet og sletter intet. Tallet bruges af
    /// kalderne til at se, at der skete noget, så det skal være nul — ikke
    /// tre, fordi hvert forsøg «lykkedes».
    #[test]
    fn ryd_indgangen_rydder_intet_naar_noegleringen_siger_nej() {
        let butik: Butik = mock::Store::new().expect("mock-butik");
        brug_testbutik(Arc::clone(&butik));
        let conn = db_med_klartekst("sync_token", "token-abc");
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('billy_api_key', 'billy-xyz')",
            [],
        )
        .expect("billy");
        conn.execute(
            "INSERT INTO settings (key, value)
             VALUES ('ai_config', '{\"provider\":\"openai\",\"api_key\":\"sk-abc\"}')",
            [],
        )
        .expect("klump");

        for nøgle in HEMMELIGHEDER {
            let post = butik.build(SERVICE, nøgle, None).expect("byg post");
            let cred: &mock::Cred = post.as_any().downcast_ref().expect("mock-cred");
            cred.set_error(Error::PlatformFailure(Box::new(std::io::Error::other(
                "nøgleringen er låst",
            ))));
        }

        assert_eq!(ryd_klarteksthemmeligheder(&conn), 0);

        // Alt ligger stadig, så næste opstart prøver igen.
        assert_eq!(klartekst_rækker(&conn).len(), 3);
        assert_eq!(læs_klump(&conn)["api_key"], "sk-abc");
    }

    #[test]
    fn gem_hvis_ikke_findes_skriver_naar_nøglen_er_ukendt() {
        let _butik = mock_butik();

        assert!(gem_hvis_ikke_findes(AI_NØGLE, "sk-første").expect("skal skrive"));
        assert_eq!(hent(AI_NØGLE).unwrap().as_deref(), Some("sk-første"));
    }

    /// Skelnen, hele pointen: en ældre værdi fra en backup må ikke overskrive
    /// den nøgle brugeren har valgt nu.
    #[test]
    fn gem_hvis_ikke_findes_rorer_ikke_en_noegle_der_er_skrivet() {
        let _butik = mock_butik();
        gem(AI_NØGLE, "sk-nyeste").expect("gem");

        assert!(!gem_hvis_ikke_findes(AI_NØGLE, "sk-gammel-backup").expect("ingen fejl"));
        assert_eq!(hent(AI_NØGLE).unwrap().as_deref(), Some("sk-nyeste"));
    }

    /// Selv en tom værdi tæller som «der er en nøgle»: ellers ville en
    /// efterfølgende fejl slette den og skrive en gammel nøgle over den.
    #[test]
    fn gem_hvis_ikke_findes_tager_en_tom_noegle_som_en_noegle() {
        let _butik = mock_butik();
        gem(AI_NØGLE, "").expect("gem");

        assert!(!gem_hvis_ikke_findes(AI_NØGLE, "sk-anden").expect("ingen fejl"));
        assert_eq!(hent(AI_NØGLE).unwrap().as_deref(), Some(""));
    }
}
