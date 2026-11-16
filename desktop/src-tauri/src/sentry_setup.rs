//! Rust-siden af fejlrapporteringen skal kun sende, når det er tilladt —
//! og den skal vide, hvorhen den sender.
//!
//! To ting lå sammen, og begge var tavse:
//!
//! 1. **DSN'en kom fra `std::env::var("SENTRY_DSN")`** — altså brugerens
//!    procesmiljø *ved launch*. En bruger der dobbeltklikker på TimeTrack.app
//!    har ingen sådan variabel, og udgivelses-workflowet satte den heller
//!    ikke. `sentry::init` med `dsn: None` vælger NoopTransport, så hver
//!    databaseskrivningsfejl blev sendt lige i ingen. Løsningen er at bagge
//!    DSN'en ind i binaryen ved build (`option_env!`), præcis som frontendens
//!    `VITE_SENTRY_DSN` allerede gør, og bruge kørende-miljøet som fallback
//!    til lokal udvikling.
//! 2. **Opt-uden blev ikke læst.** Frontendens `initSentry` holder op, når
//!    brugeren har slået fejlrapportering fra i Privatliv, men Rust sendte
//!    uafhængigt af det. Den slår skriver nu begge veje fra.
//!
//! Opt-uden er et `Mutex` og ikke et `if` i `sentry::init`, fordi den skal
//! kunne slås fra og til *mens appen kører* — en bruger der slår den fra i
//! Privatliv skal have det til at gælde med det samme, også for de fejl der
//! kommer bagefter. Mutex'en låses kun når en fejl skal sendes, som sker
//! sjældent nok til at det betyder noget.

use std::sync::{Arc, Mutex};

/// Hvad brugeren har valgt — så vidt vi ved.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Tilstand {
    /// Frontenden har ikke fortalt os endnu. Standarden, og den skal sende
    /// **intet**: det dækker selve opstarten, hvor migreringerne kører, og
    /// hvor en databasefejl er mest værd at se. Det er også den retning, der
    /// ikke sender data ud uden tilladelse.
    Ukendt,
    Til,
    Fra,
}

/// Må en fejl sendes videre i denne tilstand?
///
/// Ren funktion, så opt-ud-logikken kan testes uden global tilstand — de
/// tests der skriver i `TILSTAND` løber ellers i parallelt og ville slå
/// hinandens forventninger i stykker.
fn må_sendes(tilstand: Tilstand) -> bool {
    tilstand == Tilstand::Til
}

static TILSTAND: Mutex<Tilstand> = Mutex::new(Tilstand::Ukendt);

/// Serialiserer de tests, der skriver i `TILSTAND`.
///
/// `cargo test` kører unit tests i parallelle tråde i én proces, så to tests
/// der hver skriver i den globale og hver forventer at have skrevet den
/// senest, ville slå hinandens forventning i stykker. Alle, der rører
/// `TILSTAND`, tager denne låg først.
#[cfg(test)]
pub(crate) static RAPPORTERINGSTEST: Mutex<()> = Mutex::new(());

/// Sætter, om Rust må sende fejl videre. Kaldt fra frontendens Privatliv-side
/// ved opstart og ved hvert skift i indstillingen.
///
/// Går aldrig i panik: kun låsen kan stå fast, hvis en tråd døde med den
/// låst, og så sender vi hellere endnu en fejl end at tage appen ned.
pub fn sæt_fejlrapportering(værdi: bool) {
    let ny = if værdi { Tilstand::Til } else { Tilstand::Fra };
    if let Ok(mut t) = TILSTAND.lock() {
        *t = ny;
    }
}

/// Om Rust lige nu må sende en databasefejl videre.
pub fn må_sende() -> bool {
    TILSTAND
        .lock()
        .map(|t| må_sendes(*t))
        .unwrap_or(false)
}

/// Vælger den DSN, appen sender med.
///
/// Byggetiden vinder over kørende-miljøet: i den udgivne app findes kun den
/// indbagte, fordi en bruger ikke kan sætte en miljøvariabel på sin egen
/// maskine. Lokalt er det omvendt — `.env` giver `SENTRY_DSN`, og intet er
/// indbagt, medmindre nogen bygger med variablen sat.
///
/// Tom streng og en DSN, der ikke kan parses, giver `None` — det skal slå
/// rapporteringen fra, ikke sende et ubrugeligt svar.
fn vælg_dsn(indbagt: Option<&str>, kørende: Option<&str>) -> Option<String> {
    let rå = indbagt.or(kørende)?.trim();
    // `SENTRY_DSN=` i en .env-fil er den almindeligste fejl. Den må ikke
    // parse-fejle og tage appen med i en panik, men skal slå rapporteringen fra.
    rå.parse::<sentry::types::Dsn>().ok()?;
    Some(rå.to_string())
}

/// DSN'en for denne build.
fn dsn() -> Option<sentry::types::Dsn> {
    let kørende = std::env::var("SENTRY_DSN").ok();
    vælg_dsn(option_env!("SENTRY_DSN"), kørende.as_deref())?.parse().ok()
}

/// Starter Sentry. Uden DSN gør den ingenting, så appen kører lige så godt.
///
/// Hold guarden i live: `sentry::init` returnerer en nedluknings-handle, uden
/// den flusher klienten ikke sin kø, og de sidste fejl i en session kan
/// aldrig nå Sentry.
pub fn initialiser() -> sentry::ClientInitGuard {
    sentry::init(sentry::ClientOptions {
        dsn: dsn(),
        release: sentry::release_name!(),
        environment: Some("production".into()),
        send_default_pii: false,
        traces_sample_rate: 0.0,
        before_send: Some(Arc::new(|mut event| {
            // Strip any user data
            event.user = None;
            // Strip any potentially sensitive breadcrumbs
            event.breadcrumbs.values.retain(|b| {
                !b.message.as_ref().is_some_and(|m: &String| {
                    m.contains("api_key")
                        || m.contains("token")
                        || m.contains("password")
                })
            });
            Some(event)
        })),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indbagt_dsn_vinder_over_kørende_miljø() {
        // En bruger kan ikke sætte SENTRY_DSN på sin egen maskine, så i den
        // udgivne app er den indbagte værdi den eneste. Den må derfor aldrig
        // overskrives af et kørende miljø, der f.eks. er arvet fra en CI-runner.
        let dsn = "https://abc123@o0.ingest.sentry.io/1";
        assert_eq!(
            vælg_dsn(Some(dsn), Some("https://forkert@o0.ingest.sentry.io/2")).as_deref(),
            Some(dsn)
        );
    }

    #[test]
    fn kørende_miljø_bruges_når_intet_er_indbagt() {
        // Lokal udvikling: `.env` sætter SENTRY_DSN, og `option_env!` er None.
        let dsn = "https://abc123@o0.ingest.sentry.io/1";
        assert_eq!(vælg_dsn(None, Some(dsn)).as_deref(), Some(dsn));
    }

    #[test]
    fn mangler_dsn_begge_steder_slår_rapporteringen_fra() {
        assert!(vælg_dsn(None, None).is_none());
    }

    #[test]
    fn tom_eller_ugyldig_dsn_slår_rapporteringen_fra() {
        assert!(vælg_dsn(Some(""), None).is_none());
        assert!(vælg_dsn(Some("   "), None).is_none());
        assert!(vælg_dsn(Some("ikke-en-dsn"), None).is_none());
    }

    /// Står `nøgle: …` på en linje i blokken?
    ///
    /// Skal ligne for linje, ikke på substring: `VITE_SENTRY_DSN:` indeholder
    /// bogstaverne `SENTRY_DSN:`, så et simelt `contains("SENTRY_DSN:")` er
    /// grønt, selv om Rust-siden mangler helt — præcis det, testen skal fange.
    fn har_env_nøgle(blok: &str, nøgle: &str) -> bool {
        blok.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with(nøgle) && t[nøgle.len()..].starts_with(':')
        })
    }

    /// Beviset på at `option_env!("SENTRY_DSN")` overhovedet er sat i en
    /// udgivne build.
    ///
    /// `dsn()` kan ikke testes direkte: i en `cargo test` er hverken den
    /// indbagte værdi eller `SENTRY_DSN` i miljøet sat, så den ville være
    /// grøn uden at sige noget om den udgivne app — præcis den fejl, denne
    /// test er skrevet for at fange. Det, der mangler i release-buildet, er
    /// derimod en *konfiguration*, og den kan læses: finder workflowet ikke
    /// SENTRY_DSN ved `tauri build`, bliver `option_env!` `None` i den
    /// udgivne binary, og `sentry::init` falder tilbage på NoopTransport.
    /// Så det er workflowet, denne test slår på.
    #[test]
    fn release_buildet_indbagt_dsn_til_front_end_og_rust() {
        let sti = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.github/workflows/release.yml");
        let workflow = std::fs::read_to_string(&sti)
            .unwrap_or_else(|e| panic!("kan ikke læse {}: {e}", sti.display()));

        let linjer: Vec<&str> = workflow.lines().collect();
        let byggetrin = linjer
            .iter()
            .position(|l| l.contains("npx tauri build"))
            .expect("release.yml skal bygge med `npx tauri build`");

        // byggetrinets `env:`-blok ligger lige under kommandoen
        let blok: String = linjer[byggetrin..].iter().take(12).copied().collect::<Vec<_>>().join("\n");

        assert!(
            har_env_nøgle(&blok, "SENTRY_DSN"),
            "`npx tauri build` skal få SENTRY_DSN — ellers er option_env!(\"SENTRY_DSN\") \
             None i den udgivne app, og hver databasefejl sender ingenting. \
             Env-blokken var:\n{blok}"
        );
        assert!(
            har_env_nøgle(&blok, "VITE_SENTRY_DSN"),
            "frontendens DSN skal sættes i samme trin, ellers fanger kun \
             browserfejl, mens databasefejlene fra Rust forsvinder. \
             Env-blokken var:\n{blok}"
        );
        assert!(
            !blok.contains("https://"),
            "DSN'en skal komme fra secrets, ikke stå i klartekst i repoet. \
             Env-blokken var:\n{blok}"
        );
    }

    #[test]
    fn indtil_brugeren_siger_kan_send_ingenting() {
        // Standardtilstanden er `Ukendt`, og kun `Til` sender. Uden dette
        // sendte appen databasefejl fra opstarten — migreringerne — også for
        // en bruger, der har slået fejlrapportering fra.
        assert!(!må_sendes(Tilstand::Ukendt));
        assert!(!må_sendes(Tilstand::Fra));
        assert!(må_sendes(Tilstand::Til));
    }

    #[test]
    fn indstillingen_slår_begge_veje() {
        let _vagt = RAPPORTERINGSTEST.lock().unwrap_or_else(|e| e.into_inner());
        sæt_fejlrapportering(true);
        assert!(må_sende(), "slår brugeren den til, sender vi igen");
        sæt_fejlrapportering(false);
        assert!(!må_sende(), "slår brugeren den fra, sender vi ikke mere");
    }
}
