//! Indstillinger der rejser mellem desktop og web — bag et feature-flag.
//!
//! D4 i CEO-køen: når webben får `GET/PUT /api/desktop/settings`, skal Billy-nøglen og
//! kalenderens iCal-URL hentes derfra ved login og ved synk, og ændringer skrives
//! tilbage. **Webben har routen ikke (30/9)**, så alt her ligger bag et flag, der
//! er **fra som standard**. Uden flaget sker der præcis intet — hverken læsning
//! eller skrivning udad — så desktop ikke sender en hemmelighed til en route der
//! ikke findes, og ikke fejler en synk for en indstilling.
//!
//! Fire regler, alle testet i `tests` nederst:
//!
//! 1. **Hvidliste, aldrig sortliste.** `DELTE` er den eneste måde en indstilling
//!    kan komme ud af huset *eller* ind i huset. Serveren kan sende hvad som helst;
//!    `gæld` dropper alt uden for listen, så en ny nøgle i `settings` ikke bliver
//!    sendt ud ved en forglemmelse.
//! 2. **Login-tokenet og AI-nøglen må aldrig rejse.** De er hemmeligheder for
//!    hele kontoen, ikke integrationsindstillinger. `hemmeligheder_må_ikke_rejse`
//!    er porten.
//! 3. **Nøgleringen er målet, også på den vej ind.** `billy_api_key` er en
//!    hemmelighed (se `secrets::HEMMELIGHEDER`), så en hentet værdi skrives til
//!    nøgleringen og aldrig til `settings`-tabellen — ellers ville D3's arbejde
//!    blive lukket op igen, hver gang brugeren logger ind.
//! 4. **En nøgle brugeren ikke har, sender vi ikke.** `læs_lokale` springer
//!    nøgler over der mangler, så en tom streng ikke kan tømme serverens værdi.
//!
//! Mocken er trådens: `api.rs` laver HTTP-kaldene, og alt hvad der *gør* med et
//! svar — `tol_svar`, `byg_ud`, `gæld` — er rene funktioner, som tester dømmer mod
//! håndlavede JSON. Der er ingen netværkskald i nogen test.

use super::api::SettingPair;
use rusqlite::Connection;

/// Flaget. Alt andet end «true»/«1» er **fra** — også en tom eller ukendt
/// værdi. Et flag der læses som sandt ved en skrivefejl (`"false"`, `"0"`,
/// `"nej"`) ville stille os op mod en server der ikke findes endnu.
pub const FLAG: &str = "sync_web_indstillinger";

/// De indstillinger der må rejse mellem maskinerne.
///
/// Kun integrationer: de er den ene ting, der betyder noget på to computere
/// samtidig (en Billy-nøgle og en kalender skal ikke indstilles to steder).
/// Personlige valg — sprog, tema, timeenhed — er *ikke* her: de følger
/// brugeren, de skal ikke overskrives af den anden maskine.
pub const DELTE: &[&str] = &[
    // Hemmelighed — se regel 3.
    "billy_api_key",
    // Kalenderens iCal-URL. En streng, der i sig selv er adgang til kalenderen.
    "ical_url",
];

/// Må denne nøgle rejse?
pub fn tilladt(nøgle: &str) -> bool {
    DELTE.contains(&nøgle)
}

/// Hemmeligheder der aldrig må forlade maskinen, uanset hvad `DELTE` siger.
/// `billy_api_key` er ikke her: den er en *integration*, og den er udtrykkeligt
/// med i `DELTE`.
const ALDRIG_UD: &[&str] = &["sync_token", crate::secrets::AI_NØGLE];

/// Er deling slået til? Standard er **fra**.
pub fn aktiv(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![FLAG],
        |r| r.get::<_, String>(0),
    )
    .map(|v| v == "true" || v == "1")
    .unwrap_or(false)
}

/// Hvad et svar gjorde ved os. Tællere, så kalderen kan logge uden at røbe
/// nøgler: `billy_api_key`s værdi må aldrig i en loglinje.
#[derive(Debug, Default, PartialEq, Clone, Copy)]
pub struct Bevirkning {
    /// Indstillinger serveren sendte os.
    pub modtaget: usize,
    /// Værdier der blev skrevet lokalt (tabel eller nøglering).
    pub gemt: usize,
    /// Værdier der blev ryddet lokalt (`value: null`).
    pub ryddet: usize,
    /// Nøgler der blev droppet, fordi de ikke er på hvidlisten.
    pub sprunget_over: usize,
}

/// Filtrér serverens svar ned til de nøgler, der må skrives lokalt.
///
/// `None` hvis serveren svarede `null`, altså ikke. Det er hverken en fejl
/// eller «alt er ryddet» — det er *intet*, og en eksisterende lokal værdi skal
/// overleve. Derfor er resultatet `Option`, ikke en tom vektor: de to er
/// forskellige og må ikke blandes sammen.
pub fn tol_svar(svar: Option<&[SettingPair]>) -> Option<Vec<SettingPair>> {
    let rækker = svar?;
    Some(
        rækker
            .iter()
            .filter(|r| tilladt(&r.key))
            .cloned()
            .collect(),
    )
}

/// Byg den payload vi *vil* sende: kun hvidlistede nøgler, og uden nøgler vi
/// ikke har en værdi for (regel 4).
pub fn byg_ud(indstillinger: &[SettingPair]) -> Vec<SettingPair> {
    indstillinger
        .iter()
        .filter(|i| tilladt(&i.key) && !ALDRIG_UD.contains(&i.key.as_str()))
        .cloned()
        .collect()
}

/// Læs de delte indstillinger lokalt, klar til at sende.
///
/// Hemmeligheder læses fra nøgleringen først og fra tabellen bagefter — samme
/// rækkefølge som `commands::sync::hent_secret`, så en låst nøglering ikke får
/// os til at sende en gammel værdi fra en backup.
pub fn læs_lokale(conn: &Connection) -> Vec<SettingPair> {
    let mut ud = Vec::new();
    for nøgle in DELTE {
        let værdi = if crate::secrets::er_hemmelighed(nøgle) {
            crate::secrets::hent(nøgle).ok().flatten().or_else(|| {
                conn.query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    rusqlite::params![nøgle],
                    |r| r.get::<_, String>(0),
                )
                .ok()
            })
        } else {
            conn.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                rusqlite::params![nøgle],
                |r| r.get::<_, String>(0),
            )
            .ok()
        };
        // Ingen værdi → springes over. En tom streng ville tømme serverens.
        if let Some(værdi) = værdi.filter(|v| !v.is_empty()) {
            ud.push(SettingPair {
                key: (*nøgle).to_string(),
                value: Some(værdi),
            });
        }
    }
    ud
}

/// Skriv serverens indstillinger lokalt.
///
/// En nøgle uden for `DELTE` røres ikke, uanset hvad serveren sender: en synk må
/// ikke kunne skrive `sync_token` eller temaet fra en anden maskine ind over
/// brugerens egne valg. Hemmeligheder går i nøgleringen (regel 3), alt andet i
/// tabellen med samme `ON CONFLICT`-mønster som `set_setting`.
///
/// `value: null` (eller en tom streng) rydder: sletter fra nøgleringen hvis det
/// er en hemmelighed, ellers sletter rækken i tabellen. Det er, så brugeren kan
/// fjerne en nøgle i webappen og få den væk her.
pub fn gæld(conn: &Connection, svar: &[SettingPair]) -> Result<Bevirkning, String> {
    let mut b = Bevirkning::default();

    for række in svar {
        b.modtaget += 1;
        if !tilladt(&række.key) {
            b.sprunget_over += 1;
            continue;
        }

        match række.value.as_deref().filter(|v| !v.trim().is_empty()) {
            Some(værdi) => {
                if crate::secrets::er_hemmelighed(&række.key) {
                    // Samme port som `set_setting`: `gem` skriver i nøgleringen
                    // og sletter en eventuel klartekstrække bagefter.
                    crate::secrets::gem(&række.key, værdi)?;
                    conn.execute(
                        "DELETE FROM settings WHERE key = ?1",
                        rusqlite::params![række.key],
                    )
                    .map_err(|e| e.to_string())?;
                } else {
                    conn.execute(
                        "INSERT INTO settings (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        rusqlite::params![række.key, værdi],
                    )
                    .map_err(|e| e.to_string())?;
                }
                b.gemt += 1;
            }
            None => {
                if crate::secrets::er_hemmelighed(&række.key) {
                    crate::secrets::slet(&række.key)?;
                }
                conn.execute(
                    "DELETE FROM settings WHERE key = ?1",
                    rusqlite::params![række.key],
                )
                .map_err(|e| e.to_string())?;
                b.ryddet += 1;
            }
        }
    }

    Ok(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().expect("db");
        conn.execute_batch(SCHEMA).expect("skema");
        conn
    }

    fn par(key: &str, value: Option<&str>) -> SettingPair {
        SettingPair {
            key: key.to_string(),
            value: value.map(|v| v.to_string()),
        }
    }

    fn sæt(conn: &Connection, nøgle: &str, værdi: &str) {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![nøgle, værdi],
        )
        .expect("sæt");
    }

    fn hent(conn: &Connection, nøgle: &str) -> Option<String> {
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![nøgle],
            |r| r.get::<_, String>(0),
        )
        .ok()
    }

    // ── Regel 1: hvidlisten er porten ──────────────────────────────────────

    #[test]
    fn kun_hvidlistede_noegler_gaar_lokalt() {
        let conn = db();
        sæt(&conn, "ical_url", "https://kalender.dk/abc.ics");
        sæt(&conn, "theme", "mørk");
        sæt(&conn, "default_hourly_rate", "950");

        gæld(
            &conn,
            &[
                par("ical_url", Some("https://kalender.dk/ny.ics")),
                par("theme", Some("lys")),
                par("default_hourly_rate", Some("1200")),
            ],
        )
        .expect("gæld");

        assert_eq!(
            hent(&conn, "ical_url").as_deref(),
            Some("https://kalender.dk/ny.ics"),
            "hvidlistet nøgle skal skrives"
        );
        assert_eq!(hent(&conn, "theme").as_deref(), Some("mørk"), "tema er ikke med");
        assert_eq!(
            hent(&conn, "default_hourly_rate").as_deref(),
            Some("950"),
            "sats er ikke med"
        );
    }

    #[test]
    fn et_server_svar_kan_ikke_skreve_temaet_om() {
        let conn = db();
        sæt(&conn, "theme", "mørk");

        let b = gæld(&conn, &[par("theme", Some("lys"))]).expect("gæld");

        assert_eq!(b.sprunget_over, 1);
        assert_eq!(b.gemt, 0);
        assert_eq!(hent(&conn, "theme").as_deref(), Some("mørk"));
    }

    // ── Regel 2: login-tokenet og AI-nøglen må aldrig rejse ────────────────

    #[test]
    fn login_token_og_ai_noegle_er_aldrig_med_i_hvidlisten() {
        for nøgle in ALDRIG_UD {
            assert!(
                !tilladt(nøgle),
                "{} må aldrig stå i DELTE — det er en hemmelighed for hele kontoen",
                nøgle
            );
        }
    }

    #[test]
    fn byg_ud_fjerner_alle_noegler_uden_for_hvidlisten() {
        let ud = byg_ud(&[
            par("sync_token", Some("hemmeligt")),
            par("ai_api_key", Some("hemmeligt")),
            par("ical_url", Some("https://kalender.dk/abc.ics")),
            par("theme", Some("lys")),
        ]);

        let nøgler: Vec<&str> = ud.iter().map(|i| i.key.as_str()).collect();
        assert_eq!(nøgler, vec!["ical_url"], "kun ical_url er tilladt");
    }

    // ── Regel 3: nøkleringen er målet også indad ───────────────────────────

    #[test]
    fn hentet_billy_noegle_ender_i_noegleringen_ikke_i_tabellen() {
        let butik = crate::secrets::brug_mock_butik();
        let conn = db();

        gæld(&conn, &[par("billy_api_key", Some("billy-hemmelighed"))]).expect("gæld");

        assert_eq!(
            crate::secrets::hent("billy_api_key").ok().flatten().as_deref(),
            Some("billy-hemmelighed"),
            "nøglen skal kunne læses tilbage fra nøgleringen"
        );
        assert_eq!(
            hent(&conn, "billy_api_key"),
            None,
            "D3's arbejde må ikke lukkes op igen ved en hentet nøgle"
        );
        drop(butik);
    }

    #[test]
    fn hentet_noegle_rydder_en_gammel_klartekstraekke() {
        let butik = crate::secrets::brug_mock_butik();
        let conn = db();
        sæt(&conn, "billy_api_key", "gammel-klartekst");

        gæld(&conn, &[par("billy_api_key", Some("ny"))]).expect("gæld");

        assert_eq!(hent(&conn, "billy_api_key"), None);
        assert_eq!(
            crate::secrets::hent("billy_api_key").ok().flatten().as_deref(),
            Some("ny")
        );
        drop(butik);
    }

    #[test]
    fn en_noegle_slettet_i_webappen_rydder_noegleringen() {
        let butik = crate::secrets::brug_mock_butik();
        let conn = db();
        crate::secrets::gem("billy_api_key", "billy-hemmelighed").expect("gem");

        let b = gæld(&conn, &[par("billy_api_key", None)]).expect("gæld");

        assert_eq!(b.ryddet, 1);
        assert_eq!(crate::secrets::hent("billy_api_key").ok().flatten(), None);
        drop(butik);
    }

    // ── Regel 4: en nøgle brugeren ikke har, sender vi ikke ────────────────

    #[test]
    fn en_manglende_noegle_sendes_ikke_som_tom_streg() {
        let conn = db();

        assert!(læs_lokale(&conn).is_empty(), "en tom streng ville tømme serveren");

        sæt(&conn, "ical_url", "https://kalender.dk/abc.ics");
        let ude = læs_lokale(&conn);
        assert_eq!(ude.len(), 1);
        assert_eq!(ude[0].key, "ical_url");
    }

    #[test]
    fn laes_lokale_finder_billy_noeglen_i_noegleringen() {
        let butik = crate::secrets::brug_mock_butik();
        let conn = db();
        crate::secrets::gem("billy_api_key", "billy-hemmelighed").expect("gem");

        let ude = læs_lokale(&conn);

        let billy = ude.iter().find(|i| i.key == "billy_api_key").expect("billy");
        assert_eq!(billy.value.as_deref(), Some("billy-hemmelighed"));
        drop(butik);
    }

    #[test]
    fn laes_lokale_gaar_klartekst_rækken_naar_noegleringen_er_uaadgaengelig() {
        let butik = crate::secrets::brug_mock_butik();
        let conn = db();
        // En nøglering uden nøglen — det er, hvad en opgradering eller en
        // nøgle fra en lagt-ind backup ser ud.
        sæt(&conn, "billy_api_key", "gammel-klartekst");

        let ude = læs_lokale(&conn);

        let billy = ude.iter().find(|i| i.key == "billy_api_key").expect("billy");
        assert_eq!(
            billy.value.as_deref(),
            Some("gammel-klartekst"),
            "en låst nøglering må ikke få os til at glemme nøglen helt"
        );
        drop(butik);
    }

    // ── Flaget: standard fra, og kun «true»/«1» er til ────────────────────

    #[test]
    fn deling_er_slippet_fra_uden_flag() {
        let conn = db();
        assert!(!aktiv(&conn), "uden indstillingen må intet sendes ud");
    }

    #[test]
    fn kun_sand_noegle_tiender_flaget() {
        let conn = db();
        for (værdi, forventet) in [
            ("true", true),
            ("1", true),
            ("false", false),
            ("0", false),
            ("nej", false),
            ("", false),
        ] {
            sæt(&conn, FLAG, værdi);
            assert_eq!(aktiv(&conn), forventet, "værdien {:?}", værdi);
        }
    }

    // ── Et manglende endpoint ødelægger intet lokalt ───────────────────────

    #[test]
    fn et_svar_uden_settings_roerer_ikke_det_lokale() {
        let conn = db();
        sæt(&conn, "ical_url", "https://kalender.dk/abc.ics");

        let b = gæld(&conn, &[]).expect("gæld");

        assert_eq!(b.modtaget, 0);
        assert_eq!(hent(&conn, "ical_url").as_deref(), Some("https://kalender.dk/abc.ics"));
    }

    #[test]
    fn tol_svar_droeper_ukendte_noegler() {
        let filtret = tol_svar(Some(&[
            par("ical_url", Some("x")),
            par("sync_token", Some("hemmeligt")),
            par("theme", Some("lys")),
        ]))
        .expect("svar");

        let nøgler: Vec<&str> = filtret.iter().map(|i| i.key.as_str()).collect();
        assert_eq!(nøgler, vec!["ical_url"]);
    }

    #[test]
    fn tol_svar_er_none_naar_serveren_ikke_kan_svare() {
        assert!(
            tol_svar(None).is_none(),
            "«ikke svar» må ikke blive til en tom liste — den rydder brugerens nøgler"
        );
    }

    #[test]
    fn serialiseringen_taaler_null_som_rydning() {
        // Tråd-formatet er reglen om, hvad «slettet» ser ud. `value: null` skal
        // kunne læses, ellers kan webben aldrig fortælle at noget er væk.
        let json = serde_json::json!({
            "settings": [
                { "key": "ical_url", "value": "https://kalender.dk/abc.ics" },
                { "key": "billy_api_key", "value": null }
            ]
        });
        let svar: super::super::api::SettingsResponse =
            serde_json::from_value(json).expect("læs svar");

        let rækker = svar.settings.expect("settings");
        assert_eq!(rækker[0].value.as_deref(), Some("https://kalender.dk/abc.ics"));
        assert_eq!(rækker[1].value, None);
    }

    #[test]
    fn et_svar_uden_nogen_settings_nøgle_er_ikke_et_svar() {
        // `{}` betyder «jeg ved ikke noget», ikke «der er ingen». Uden denne
        // skelnelse ville en server uden felt rydde brugerens indstillinger.
        let svar: super::super::api::SettingsResponse =
            serde_json::from_value(serde_json::json!({})).expect("læs svar");
        assert!(svar.settings.is_none());
    }
}