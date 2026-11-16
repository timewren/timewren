//! Én tidsform for `time_entries.start_time` og `time_entries.end_time`.
//!
//! Kolonnen har historisk rummet to former: rigtige UTC-instanser fra timeren
//! og auto-trackeren (`2026-09-30T22:30:00.123+00:00`) og naive lokale
//! væg-tider fra den manuelle formular (`2026-10-01T00:30:00`). Alt, der
//! **læser** kolonnen som tekst eller med `DATE()` — dagsgrænserne i
//! `list_time_entries_core`, `DATE(t.start_time)` i rapporten, `auto_invoice`
//! og CSV-eksporten — regner den som lokale væg-tider, så en UTC-instant mellem
//! midnat og kl. 02:00 dansk havnede på den **foregående kalenderdag**: en time
//! bogført kl. 00:30 den 1/10 blev vist i dagsvisningen for 30/9 og i
//! rapporten for 30/9, selv om klokkeslættet i formularen sagde 00:30.
//!
//! Den eneste form, der er rigtig for alle disse læsere, er **lokal naiv
//! væg-tid** — samme streng den manuelle formular allerede skriver. Det er denne
//! form der skrives fra nu af, og [`normalisér_vægurtider`] omformer de rækker, der
//! blev skrevet før.
//!
//! Formsættet er ikke ensidigt: en række kan stadig komme med en offset fra en
//! backup, en gammel database eller en synk, der løb under en tidligere
//! version. Derfor læser [`øjeblik`] og [`lokal_naiv`] **begge** former, så
//! rettelsen ikke kan gøre en varighed eller en daggrænse værre.

use rusqlite::Connection;

/// Nåtid som lokal væg-tid i den form kolonnen gemmer sig i.
///
/// Bruges af timeren og ved stop, så en løbende registrering får præcis samme
/// form som en manuel. Uden den skrev timeren et UTC-øjeblik, og enhver
/// registrering mellem midnat og kl. 02:00 dansk landede på dagen før.
pub(crate) fn nu_lokal_naiv() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Et tidsstempel fra kolonnen som et øjeblik på tidslinjen (sekunder siden
/// 1970), uanset hvilken af de to former den har.
///
/// En UTC-instant læses som det øjeblik den er. En lokal væg-tid læses som det
/// øjeblik den peger på **på denne maskine** — samme valg som synkens `sekunder`
/// og samme tviste-regel: et tidspunkt der falder to gange (skiftet mellem
/// sommertid og vintertid) tager det tidligste, for `single()` ville give `None`
/// og tabe varigheden.
///
/// Det er her varigheder beregnes. Trækker man to naive strenge fra hinanden, får
/// man en time for meget eller for lidt på den dag hvor uret stilles — en
/// varighed er et interval i tid, ikke en difference mellem to tal i et
/// talsystem.
pub(crate) fn øjeblik(rå: &str) -> Option<i64> {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(rå) {
        return Some(t.timestamp());
    }
    chrono::NaiveDateTime::parse_from_str(rå.trim(), "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .and_then(|naive| {
            naive
                .and_local_timezone(chrono::Local)
                .earliest()
                .map(|t| t.timestamp())
        })
}

/// Samme øjeblik som den lokale væg-tid, kolonnen gemmer sig i.
///
/// Det er denne form `time_entries` skal indeholde, så de tekstbaserede
/// dagsgrænser og `DATE()`-spredningen i rapporten dømmer den rigtige dag.
/// Formateringen er sekundnøjagtig, for kolonnen før har haft både
/// `00:00:00` og `00:00:00.123` — og fordi strengene sammenlignes som tekst må
/// den ikke miste præcision på vejen.
pub(crate) fn lokal_naiv(rå: &str) -> Option<String> {
    øjeblik(rå).map(|sekunder| {
        chrono::DateTime::from_timestamp(sekunder, 0)
            .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).expect("epoch"))
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    })
}

/// Omformer de rækker i `time_entries`, der stadig står med en offset eller et
/// `Z`, til lokal væg-tid. Kører hver start, som de andre migrationer i
/// `apply_migrations`.
///
/// Tre ting holder denne migration harmløs, for den rører tidsregistreringer:
///
/// 1. **Den springer rækker over, den ikke kan læse.** En streng der hverken er
///    en UTC-instant eller en væg-tid er ukendt for os; den bliver stående, så
///    vi gør aldrig en registrerings klokkeslæt ukendt for at få den til at se
///    ens ud.
/// 2. **Den rører kun de to tidskolonner.** `created_at` og `updated_at` er
///    UTC-instanser, og synkens konfliktløsning sammenligner dem præcis som de
///    er (`should_apply_remote`) — ændrede man dem, ville hver maskine tro den
///    havde ændret en post, den kun har læst.
/// 3. **Den er idempotent.** Den vælger rækker med `LIKE '%+%' OR LIKE '%Z'`, og
///    den skriver en form, der ikke matcher mønstret igen, så en anden kørsel
///    finder intet.
pub(crate) fn normalisér_vægurtider(conn: &Connection) -> Result<usize, String> {
    // A partial database — one built column by column, as the migration tests
    // in `db::tests` do — has no `time_entries` at this point. The table simply
    // does not exist yet, so there is nothing to normalise; that is not a
    // failure, and the next start will run this again against the real schema.
    let findes: bool = conn.prepare("SELECT 1 FROM time_entries LIMIT 0").is_ok();
    if !findes {
        return Ok(0);
    }

    let rækker: Vec<(String, String, Option<String>, Option<i64>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, start_time, end_time, is_running FROM time_entries
                 WHERE start_time LIKE '%+%' OR start_time LIKE '%Z'
                    OR end_time LIKE '%+%' OR end_time LIKE '%Z'",
            )
            .map_err(|e| e.to_string())?;
        // Errors are propagated, never filtered away. A dropped row is silent
        // and indistinguishable from "nothing to do", so a migration that
        // reports success while having changed nothing is worse than one that
        // fails loudly on the next start.
        let rækker = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    // `INTEGER`, not a string — reading it as `String` errors on
                    // EVERY row.
                    row.get::<_, Option<i64>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rækker
    };

    let mut ændret = 0;
    for (id, start, end, is_running) in rækker {
        let ny_start = match lokal_naiv(&start) {
            Some(s) => s,
            // Ukendt form: vi ved ikke hvad klokkeslættet er, så vi lader
            // rækken være i stedet for at gætte.
            None => continue,
        };
        // En løbende registrering har intet sluttidspunkt. Giver vi den et, ville
        // den se ud til at være stoppet — og den ville miste den klippekort-fratræk,
        // der sker ved stop.
        let ny_end = if is_running == Some(1) {
            None
        } else {
            end.as_deref().map(|e| match lokal_naiv(e) {
                Some(v) => v,
                // Sluttidspunktet er ulæseligt, mens starttidspunktet ikke er.
                // Vi skriver så starten og lader sluttiden stå: en registrerings
                // varighed ligger i `duration` (beregnet ved stop), så en
                // daggrænse rammer den stadig, og vi har ikke gjort dens
                // varighed værre.
                None => e.to_string(),
            })
        };

        if ny_start == start && ny_end == end {
            continue;
        }
        conn.execute(
            "UPDATE time_entries SET start_time = ?1, end_time = ?2 WHERE id = ?3",
            rusqlite::params![ny_start, ny_end, id],
        )
        .map_err(|e| e.to_string())?;
        ændret += 1;
    }

    Ok(ændret)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Formerne
    // -----------------------------------------------------------------------

    /// En registrering kl. 00:30 dansk 1/10 hedder `2026-09-30T22:30:00Z` i UTC.
    /// Uden denne test dømmer de andre intet — de ville også være grønne mod den
    /// gamle kode, fordi ingen af dem læser formen.
    ///
    /// Dømningen regnes **ikke** mod et fast klokkeslæt: testen skal være sand på
    /// alle maskiner, også uden for Danmark, så den tager klokkeslættet fra den
    /// maskines egen tidszone frem for at hænge ved `+02:00`.
    #[test]
    fn en_registrering_mellem_midnat_og_to_er_det_forgaaende_dag_i_utc() {
        let rå = "2026-09-30T22:30:00.123+00:00";

        let forventet = chrono::DateTime::parse_from_rfc3339(rå)
            .expect("UTC-instant")
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();

        assert_eq!(
            lokal_naiv(rå).as_deref(),
            Some(forventet.as_str()),
            "lokal_naiv skal give præcis den samme streng igen"
        );
    }

    /// `lokal_naiv` skal kunne læse **begge** former. Uden den anden halvdel
    /// (naiv ind) ville en rettelse, der kun læser UTC, gøre alle de manuelt
    /// registrerede timer usynlige — præcis det tab af tid, opgaven er om.
    #[test]
    fn lokal_naiv_læser_begge_former_til_det_samme_øjeblik() {
        let utc = "2026-09-30T22:30:00.123+00:00";
        // Samme øjeblik, skrevet som lokal væg-tid (beregnet, så testen ikke
        // antager en bestemt tidszone).
        let forventet = øjeblik(utc).expect("UTC-instant");
        let lokal_streng = chrono::DateTime::from_timestamp(forventet, 0)
            .expect("epoch")
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();

        assert_eq!(
            øjeblik(&lokal_streng),
            Some(forventet),
            "en lokal væg-tid skal læses som det øjeblik den peger på"
        );
        assert_eq!(lokal_naiv(&lokal_streng).as_deref(), Some(lokal_streng.as_str()));
    }

    /// Præcisionen må ikke tabes på vejen: kolonnen har haft både `00:00:00` og
    /// `00:00:00.123`, og strengene sammenlignes som tekst.
    #[test]
    fn lokal_naiv_beholder_sekundpræcisionen() {
        let utc = "2026-09-30T22:30:00.123+00:00";
        let naiv = lokal_naiv(utc).expect("læselig");
        assert!(
            !naiv.contains('.'),
            "den gemte form har ingen subsekunder: {naiv}"
        );
        // Samme øjeblik, så formateringen har ikke flyttet tiden.
        assert_eq!(øjeblik(&naiv), øjeblik(utc));
    }

    /// En streng vi ikke genkender giver `None`, aldrig et gæt. En forkert
    /// aflæsning ville skrive et tidspunkt, brugeren aldrig har registreret.
    #[test]
    fn en_ukendt_form_giver_ingenting_isteden_for_et_gæt() {
        assert_eq!(lokal_naiv(""), None);
        assert_eq!(lokal_naiv("2026-10-01"), None, "en dato er ikke et tidspunkt");
        assert_eq!(lokal_naiv("i går kl. 9"), None);
    }

    // -----------------------------------------------------------------------
    // Varighed
    // -----------------------------------------------------------------------

    /// En varighed er et interval i tid. Trækker man to naive strenge fra
    /// hinanden, får man den forkerte længde på den dag hvor uret stilles
    /// (sommertid starter: 02:00 findes ikke, vintertid: 02:00 findes to
    /// gange). Her kontrolleres den farlige halvdel — at varigheden over et
    /// skifte er **23 eller 25 timer**, ikke 24.
    #[test]
    fn en_varighed_over_et_tidsskifte_er_et_interval_ikke_en_difference() {
        // Byg et interval på præcis 24 timer hen over uanset hvilken dag
        // skiftet falder på, og døm at `øjeblik` giver 24 timer — altså at
        // læsningen følger uret og ikke en tekstdifference.
        let start = chrono::Local::now() - chrono::Duration::hours(24);
        let start_streng = start.format("%Y-%m-%dT%H:%M:%S").to_string();
        let slut = start + chrono::Duration::hours(24);

        let a = øjeblik(&start_streng).expect("læselig start");
        let b = øjeblik(
            &slut
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string(),
        )
        .expect("læselig slut");

        // Begge strenge er lokale, så forskellen er den sande varighed.
        assert_eq!(b - a, 24 * 3600, "24 timer er 24 timer, skifte eller ej");
    }

    /// Samme sluttidspunkt som lokal væg-tid: forskellen skal være nul, ikke
    /// springet rundt i døgnet.
    #[test]
    fn samme_øjeblik_skrivet_paa_begge_former_giver_ingen_varighed() {
        let utc = "2026-09-30T22:30:00.123+00:00";
        let naiv = lokal_naiv(utc).expect("læselig");

        assert_eq!(øjeblik(&naiv), øjeblik(utc));
        assert_eq!(
            øjeblik(&naiv).unwrap() - øjeblik(utc).unwrap(),
            0,
            "samme øjeblik er null sekunders forskel"
        );
    }

    // -----------------------------------------------------------------------
    // Migrationen
    // -----------------------------------------------------------------------

    fn db_med_tabel() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE time_entries (
                 id TEXT PRIMARY KEY,
                 start_time TEXT NOT NULL,
                 end_time TEXT,
                 is_running INTEGER,
                 duration INTEGER
             );
             INSERT INTO time_entries VALUES
                 ('løbende', '2026-09-30T22:30:00.123+00:00', NULL, 1, NULL),
                 ('færdig',  '2026-09-30T09:00:00+00:00', '2026-09-30T10:30:00+00:00', 0, 5400),
                 ('manuel',  '2026-10-01T00:30:00', '2026-10-01T01:30:00', 0, 3600);",
        )
        .expect("tabel med rækker fra før rettelsen");
        conn
    }

    fn hent(conn: &Connection, id: &str) -> (String, Option<String>, Option<i64>) {
        conn.query_row(
            "SELECT start_time, end_time, is_running FROM time_entries WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("rækken")
    }

    /// En database fra **før rettelsen** — blandet naive og UTC — skal efter
    /// migrationen kun have lokal væg-tid i `start_time`.
    #[test]
    fn migration_gør_alle_tidspunkter_til_lokale_vægurtider() {
        let conn = db_med_tabel();

        let ændret = normalisér_vægurtider(&conn).expect("migrationen kører");
        assert_eq!(ændret, 2, "kun de to UTC-rækker ændres");

        for id in ["løbende", "færdig", "manuel"] {
            let (start, _, _) = hent(&conn, id);
            assert!(
                !start.contains('+') && !start.ends_with('Z'),
                "{id}: klokkeslættet står stadig med en offset: {start}"
            );
        }
    }

    /// En løbende registrering må **ikke** få et sluttidspunkt af migrationen —
    /// den ville se ud til at være stoppet, og den ville miste fratrækket på sit
    /// klippekort.
    #[test]
    fn migrationen_lader_en_loebende_registrering_loebe() {
        let conn = db_med_tabel();
        normalisér_vægurtider(&conn).expect("migrationen kører");

        let (_, end, is_running) = hent(&conn, "løbende");
        assert_eq!(end, None, "en løbende registrering får intet sluttidspunkt");
        assert_eq!(is_running, Some(1), "den er stadig løbende");
    }

    /// Den rører ikke varigheden. `duration` er den sande længde, og den er
    /// uden for migrationens rækkevidde — en dagsgrænse og en faktura skal
    /// stadig ramme præcis de timer, brugeren tog.
    #[test]
    fn migrationen_rer_ikke_varigheden() {
        let conn = db_med_tabel();
        normalisér_vægurtider(&conn).expect("migrationen kører");

        let duration: Option<i64> = conn
            .query_row(
                "SELECT duration FROM time_entries WHERE id = 'færdig'",
                [],
                |row| row.get(0),
            )
            .expect("rækken");
        assert_eq!(duration, Some(5400), "90 minutter er stadig 90 minutter");
    }

    /// Den må ikke ændre `created_at`/`updated_at`. Synsen sammenligner dem som
    /// UTC-instanser (`should_apply_remote`), så en ændret tidsstempel ville få
    /// hver maskine til at tro den havde ændret en post, den kun har læst.
    #[test]
    fn migrationen_rer_ikke_created_at_eller_updated_at() {
        let conn = db_med_tabel();
        conn.execute_batch(
            "ALTER TABLE time_entries ADD COLUMN created_at TEXT;
             ALTER TABLE time_entries ADD COLUMN updated_at TEXT;
             UPDATE time_entries SET created_at = '2026-09-30T22:30:00.123+00:00',
                                     updated_at = '2026-09-30T23:00:00.000+00:00'
             WHERE id = 'færdig';",
        )
        .expect("stempler fra før rettelsen");

        normalisér_vægurtider(&conn).expect("migrationen kører");

        let (created, updated): (String, String) = conn
            .query_row(
                "SELECT created_at, updated_at FROM time_entries WHERE id = 'færdig'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("rækken");
        assert_eq!(created, "2026-09-30T22:30:00.123+00:00");
        assert_eq!(updated, "2026-09-30T23:00:00.000+00:00");
    }

    /// En række med en streng vi ikke genkender bliver **urørt**. At skrive en
    /// gættet værdi ind i en tidsregistrering er værre end at have den stående,
    /// for brugeren kan ikke læse den tilbage og vide, hvad den skulle have været.
    #[test]
    fn migrationen_rer_ikke_en_raekke_den_ikke_kan_laese() {
        let conn = db_med_tabel();
        conn.execute(
            "INSERT INTO time_entries (id, start_time, end_time, is_running, duration)
             VALUES ('ukendt', '2026-10-01T00:30:00+00:00', 'ikke et tidspunkt', 0, 3600)",
            [],
        )
        .expect("række med et ulæseligt sluttidspunkt");

        let ændret = normalisér_vægurtider(&conn).expect("migrationen kører");
        assert_eq!(ændret, 3, "de to kendte UTC-rækker plus denne ene start");

        let (start, end, _) = hent(&conn, "ukendt");
        // Forventningen regnes fra inputtet, ikke hardkodet: hvilken kalenderdag
        // et UTC-øjeblik lander på afhænger af maskinens tidszone, og testen
        // skal være sand overalt.
        assert_eq!(
            start,
            lokal_naiv("2026-10-01T00:30:00+00:00").expect("læselig"),
            "starttidspunktet må skrives om"
        );
        assert_eq!(
            end.as_deref(),
            Some("ikke et tidspunkt"),
            "et ulæseligt sluttidspunkt lades stå — vi ved ikke hvad det er"
        );
    }

    /// Idempotens: en anden kørsel (hver appstart) skal ikke finde noget og
    /// ikke ændre en eneste række.
    #[test]
    fn migrationen_er_idempotent() {
        let conn = db_med_tabel();

        let første = normalisér_vægurtider(&conn).expect("første kørsel");
        assert_eq!(første, 2);

        let anden = normalisér_vægurtider(&conn).expect("anden kørsel");
        assert_eq!(anden, 0, "den anden kørsel finder intet at ændre");

        // Og en tredje kørsel på en database hvor *alt* er væg-tid.
        let tredje = normalisér_vægurtider(&conn).expect("tredje kørsel");
        assert_eq!(tredje, 0);
    }
}
