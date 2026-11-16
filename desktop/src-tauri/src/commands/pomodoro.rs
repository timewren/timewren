use crate::db::Database;
use crate::i18n;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Én kalenderdags pomodoro-tal.
///
/// `day` er den **lokale** dato (`Europe/Copenhagen` på brugerens maskine) i
/// `YYYY-MM-DD`, ikke en UTC-dato. Det er den samme regel som resten af appen
/// bruger på registreret tid, og den er ikke tilfældig: en pomodoro der slutter
/// kl. 00:15 skal tælle på den dag brugeren afsluttede den, ikke på den forrige.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroDag {
    pub day: String,
    pub sessions: u32,
    pub minutes: u32,
}

/// Dagens tal plus de foregående dage, så UI'et kan vise en uge uden at
/// skulle læse tabellen selv og regne dage ud i browserens tidszone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroStats {
    /// Dagens egen linje — altid med, også når den er nul.
    pub i_dag: PomodoroDag,
    /// De `dage` seneste dage med data, nyeste først. Kan være tom.
    pub dage: Vec<PomodoroDag>,
    /// Sum af minutter i dag. Udledt af `i_dag`, så den ikke kan komme i drift.
    pub minutter_i_dag: u32,
}

/// Én gennemført arbejdsfase med sit **interval**.
///
/// `pomodoro_sessions` gemmer kun `minutes` og `ended_at`, fordi det var nok til
/// en tæller. En tidslinje skal vide *hvornår* en fase lå — «4 pomodoros mandag
/// morgen» og «4 pomodoros fordelt over hele dagen» er to forskellige dage, og
/// uden klokkeslæt kan brugeren ikke se det. Derfor udledes `started_at` her af
/// `ended_at` minus varigheden, så tidslinjen ikke skal regne den om selv.
///
/// Begge tidsstempler er **lokal væg-tid** i samme form som `time_entries`
/// bruger (`crate::tid::lokal_naiv`). Trækker man i en UTC-instant i stedet,
/// flyder en fase hen over midnat en time, og en fase der startede 23.45
/// slutter 00.10 ville få start **00.45** — et interval der går baglæns, som
/// tidslinjen ville tegne som om den lå Negative.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroSession {
    pub id: String,
    pub day: String,
    pub minutes: u32,
    /// Lokal væg-tid, som `crate::tid` skriver den.
    pub ended_at: String,
    /// `ended_at` minus `minutes`, i samme form.
    pub started_at: String,
    /// Er fasens minutter **allerede bogført** som tid?
    ///
    /// Det afgør, hvad rækken i tidslinjen siger. Uden det stod en registreret
    /// fase og den tidsregistrering den blev til som to rækker for de samme 25
    /// minutter, og intet på nogen af dem sagde at det var det samme arbejde.
    /// Det følger `time_entries` med en LEFT JOIN, så en registrering brugeren
    /// senere sletter gør faserne **igen** ubogførte — de skal kunne registreres
    /// igen, og en markering der overlever sletningen ville være en løgn.
    pub registreret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroConfig {
    pub work_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub sessions_before_long: u32,
}

impl Default for PomodoroConfig {
    fn default() -> Self {
        Self {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            sessions_before_long: 4,
        }
    }
}

/// Get the pomodoro configuration from settings.
#[tauri::command]
pub fn get_pomodoro_config(db: State<'_, Database>) -> Result<PomodoroConfig, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let config_json: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'pomodoro_config'",
            [],
            |row| row.get(0),
        )
        .ok();

    match config_json {
        Some(json_str) => {
            serde_json::from_str(&json_str).map_err(|e| format!("Pomodoro config parse fejl: {}", e))
        }
        None => Ok(PomodoroConfig::default()),
    }
}

/// Save pomodoro configuration to settings.
#[tauri::command]
pub fn set_pomodoro_config(
    db: State<'_, Database>,
    config: PomodoroConfig,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let json_str =
        serde_json::to_string(&config).map_err(|e| format!("Serialization fejl: {}", e))?;

    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('pomodoro_config', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![json_str],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Den skrivende del af `record_pomodoro_session`, så porten kan kalde den
/// rigtige sætning.
///
/// Den lå tidligere kun inde i kommandoen, og testen skrev så sin egen kopi af
/// `INSERT OR IGNORE`. Det er præcis den falske grøn `db/mod.rs`'s
/// tidstest blev skrevet imod: porten ville være grøn, selv hvis kommandoen
/// havde brugt `INSERT` og så kastet på dubletten — altså ville den have
/// dømt en sætning, ingen kaldte.
pub(crate) fn skriv_session_core(
    conn: &rusqlite::Connection,
    id: &str,
    day: &str,
    minutes: u32,
    ended_at: &str,
) -> Result<(), String> {
    if !(1..=1440).contains(&minutes) {
        return Err(i18n::t_fmt(
            "pomodoro.invalidMinutes",
            &[&minutes.to_string()],
        ));
    }

    conn.execute(
        "INSERT OR IGNORE INTO pomodoro_sessions (id, day, minutes, ended_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, day, minutes as i64, ended_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Skriver én gennemført arbejdsfase.
///
/// `id` kommer fra klienten og er den **eneste** grund til, at kaldet er
/// idempotent: to kald med samme id skriver én række, ikke to. Uden det kunne
/// et dobbeltklik, en retry eller to mounts af timeren tælle den samme pomodoro
/// to gange, og en tæller der kan tælle den samme session to gange er værre
/// end ingen tæller — brugeren stoler på den.
///
/// Minutter afvises uden for 1..=1440. Konfigurationen er begrænset til 120
/// minutter i UI'et, men Rust stoler ikke på at klienten har talt rigtigt: en
/// nokketal-timeregning i et 25-minutters felt ville skrive 1500 minutter ind i
/// dagens sum, og den sum er det brugeren ser.
#[tauri::command]
pub fn record_pomodoro_session(
    db: State<'_, Database>,
    id: String,
    minutes: u32,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Dagen er maskinens **lokale** dato. En pomodoro der slutter kl. 00:15
    // skal tælle på den dag brugeren afsluttede den, og en UTC-dato ville
    // flytte den tilbage til i går for alt vest for Greenwich.
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let ended_at = crate::tid::nu_lokal_naiv();

    skriv_session_core(&conn, &id, &day, minutes, &ended_at)
}

/// Den læsende del af `get_pomodoro_stats`.
pub(crate) fn stats_core(
    conn: &rusqlite::Connection,
    idag: &str,
    dage: u32,
) -> Result<PomodoroStats, String> {
    // En vildt stor værde må ikke gøre kaldet til en fuld tabelscanning. 366
    // dage er over et år, hvilket er mere end nogen udsigt.
    let dage = dage.clamp(1, 366);

    let mut stmt = conn
        .prepare(
            "SELECT day, COUNT(*) as sessions, SUM(minutes) as minutes
             FROM pomodoro_sessions
             WHERE day <= ?1
             GROUP BY day
             ORDER BY day DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rækker = stmt
        .query_map(rusqlite::params![idag, dage as i64], |row| {
            Ok(PomodoroDag {
                day: row.get(0)?,
                sessions: row.get::<_, i64>(1)? as u32,
                minutes: row.get::<_, i64>(2)? as u32,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut ud: Vec<PomodoroDag> = Vec::new();
    for række in rækker.flatten() {
        ud.push(række);
    }

    // Dagen skal være med, også når den er nul — ellers må UI'et gætte, og en
    // gæt er enten «0 pomodoros» (sandt) eller ingenting (også sandt, men
    // brugeren kan ikke se om der er en fejl). Nul-rækken er derfor ægte data,
    // ikke en pladsholder.
    let i_dag = ud
        .iter()
        .find(|d| d.day == idag)
        .cloned()
        .unwrap_or_else(|| PomodoroDag {
            day: idag.to_string(),
            sessions: 0,
            minutes: 0,
        });

    Ok(PomodoroStats {
        minutter_i_dag: i_dag.minutes,
        i_dag,
        dage: ud,
    })
}

/// Læser alle gennemførte arbejdsfaser på **én** kalenderdag.
///
/// Tidslinjen skal vise en pomodoro som et interval i dagens række, ikke som et
/// tal i en oversigt, så den skal have hver fase med sit starttidspunkt — og
/// det afleder den her, fordi tabellen kun gemmer varighed og sluttidspunkt.
///
/// `day` er den **lokale** dato i `YYYY-MM-DD`, samme form `record_pomodoro_session`
/// skriver, så et filter på den kan ikke træffe en fase på den forkerte dag.
/// Rækkkerne kommer i starttidspunktet rækkefølge, fordi tidslinjen tegner dem
/// oven på hinanden i den rækkefølge — en usorteret liste ville få en fase fra
/// kl. 09.00 til at stå under en fra kl. 14.00.
///
/// Hver fase medbringer desuden, om dens minutter allerede er bogført
/// (`registreret`) — spurgt i `time_entries`, aldrig i `pomodoro_sessions`, så
/// den sande kilde til «er denne tid betalt» er den registrering brugeren lavede,
/// ikke en markering i fasedata.
pub(crate) fn sessioner_for_dag_core(
    conn: &rusqlite::Connection,
    day: &str,
) -> Result<Vec<PomodoroSession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.minutes, s.ended_at,
                    EXISTS (SELECT 1 FROM time_entries t
                            WHERE t.pomodoro_session_id = s.id) AS registreret
             FROM pomodoro_sessions s
             WHERE s.day = ?1 ORDER BY s.ended_at",
        )
        .map_err(|e| e.to_string())?;

    let rækker = stmt
        .query_map(rusqlite::params![day], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)? as u32,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut ud: Vec<PomodoroSession> = Vec::new();
    for række in rækker.flatten() {
        let (id, minutes, rå_ended, registreret) = række;

        // En form vi ikke genkender giver `None`, og så er vi ikke klogere end
        // det indskrevne tal: springes over i stedet for at gætte et starttidspunkt
        // op. En tidslinje der tegner en fase med oplyst længde men ukendt
        // klokkeslæt ville være værre end ingen fase.
        let Some(ended_at) = crate::tid::lokal_naiv(&rå_ended) else {
            crate::db::errors::record(
                &format!("springer pomodoro {id} over: uforståeligt sluttidspunkt"),
                &rå_ended,
            );
            continue;
        };

        let started_at = crate::tid::lokal_naiv(&ended_at)
            .and_then(|end| {
                chrono::NaiveDateTime::parse_from_str(&end, "%Y-%m-%dT%H:%M:%S")
                    .ok()
                    .map(|naive| {
                        naive
                            .checked_sub_signed(chrono::Duration::minutes(i64::from(minutes)))
                            .unwrap_or(naive)
                            .format("%Y-%m-%dT%H:%M:%S")
                            .to_string()
                    })
            })
            .unwrap_or_else(|| ended_at.clone());

        ud.push(PomodoroSession {
            id,
            day: day.to_string(),
            minutes,
            ended_at,
            started_at,
            registreret,
        });
    }

    // `ORDER BY ended_at` sorterede på *rå*formen. En backup kan have skrevet
    // en UTC-instant med offset, som tekstsortérer efter den lokale streng — så
    // den endelige rækkefølge regnes på de normaliserede væg-tider. Uden denne
    // sortering kunne en fase med `…+00:00` lande forkerte i tidslinjen.
    ud.sort_by(|a, b| a.started_at.cmp(&b.started_at).then(a.id.cmp(&b.id)));

    Ok(ud)
}

/// Læser dagens gennemførte pomodoro-faser med deres intervaller.
#[tauri::command]
pub fn list_pomodoro_sessions(
    db: State<'_, Database>,
    day: String,
) -> Result<Vec<PomodoroSession>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    sessioner_for_dag_core(&conn, &day)
}

/// Læser dagens pomodoro-tal og de seneste dages.
///
/// `dage` er hvor mange dage bagud der læses med. Det er ikke en grænse på
/// hvor mange der *findes*, så appen kan vise en uge uden at spørge om den.
#[tauri::command]
pub fn get_pomodoro_stats(db: State<'_, Database>, dage: u32) -> Result<PomodoroStats, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let idag = chrono::Local::now().format("%Y-%m-%d").to_string();

    stats_core(&conn, &idag, dage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn
    }

    /// Kalder den samme kode `record_pomodoro_session` kalder. Havde denne
    /// skrevet sin egen `INSERT`, ville porten være grøn selv om kommandoen
    /// havde brugt `INSERT` og kastet på dubletten — altså dømt en sætning,
    /// ingen kaldte. Det er den falske grøn `db/mod.rs`'s tidstest blev skrevet
    /// imod, og den skal ikke opstå to steder.
    fn skriv(conn: &Connection, id: &str, day: &str, minutes: u32) {
        skriv_session_core(conn, id, day, minutes, "2026-10-01T09:00:00")
            .expect("skriv_session_core should succeed");
    }

    #[test]
    fn default_config_values() {
        let config = PomodoroConfig::default();
        assert_eq!(config.work_minutes, 25);
        assert_eq!(config.short_break_minutes, 5);
        assert_eq!(config.long_break_minutes, 15);
        assert_eq!(config.sessions_before_long, 4);
    }

    #[test]
    fn config_serialization_roundtrip() {
        let config = PomodoroConfig {
            work_minutes: 30,
            short_break_minutes: 10,
            long_break_minutes: 20,
            sessions_before_long: 3,
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: PomodoroConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.work_minutes, 30);
        assert_eq!(parsed.short_break_minutes, 10);
        assert_eq!(parsed.long_break_minutes, 20);
        assert_eq!(parsed.sessions_before_long, 3);
    }

    #[test]
    fn samme_id_tæller_en_gang() {
        let conn = setup();
        // Dobbeltklik, en retry og to mounts — alle tre lander i samme række,
        // fordi id'et er det samme. Uden `INSERT OR IGNORE` ville dagens sum
        // her være 75 minutter for én pomodoro.
        skriv(&conn, "s1", "2026-10-01", 25);
        skriv(&conn, "s1", "2026-10-01", 25);
        skriv(&conn, "s1", "2026-10-01", 25);

        let stats = stats_core(&conn, "2026-10-01", 7).expect("stats");
        assert_eq!(stats.i_dag.sessions, 1);
        assert_eq!(stats.minutter_i_dag, 25);
    }

    #[test]
    fn en_dag_tæller_sessioner_og_minutter() {
        let conn = setup();
        skriv(&conn, "a", "2026-10-01", 25);
        skriv(&conn, "b", "2026-10-01", 25);
        skriv(&conn, "c", "2026-10-01", 50);

        let stats = stats_core(&conn, "2026-10-01", 7).expect("stats");
        assert_eq!(stats.i_dag.sessions, 3);
        assert_eq!(stats.minutter_i_dag, 100);
    }

    #[test]
    fn en_dag_uden_pomodoros_er_null_og_ikke_ukendt() {
        let conn = setup();
        skriv(&conn, "a", "2026-09-30", 25);

        let stats = stats_core(&conn, "2026-10-01", 7).expect("stats");
        // Dagen er med og siger nul. Uden den ville UI'et skulle gætte, og en
        // fejl i indlæsningen ville se ud som en dag uden pomodoros.
        assert_eq!(stats.i_dag.day, "2026-10-01");
        assert_eq!(stats.i_dag.sessions, 0);
        assert_eq!(stats.minutter_i_dag, 0);
    }

    #[test]
    fn dage_med_data_kommer_nyeste_først() {
        let conn = setup();
        skriv(&conn, "a", "2026-09-28", 25);
        skriv(&conn, "b", "2026-09-30", 25);
        skriv(&conn, "c", "2026-10-01", 25);

        let stats = stats_core(&conn, "2026-10-01", 7).expect("stats");
        let dage: Vec<&str> = stats.dage.iter().map(|d| d.day.as_str()).collect();
        assert_eq!(dage, vec!["2026-10-01", "2026-09-30", "2026-09-28"]);
    }

    #[test]
    fn en_uge_der_ikke_er_slut_kan_ikke_tælle_med() {
        let conn = setup();
        // Timeren står kørende over et skift: en fase der begynder i dag og
        // slutter i morgen må ikke tælle med i morgens dag, for den er ikke
        // gennemført endnu, og en der begynder i morgen kan umuligt være
        // gennemført i dag.
        skriv(&conn, "i_morgen", "2026-10-02", 25);
        skriv(&conn, "i_dag", "2026-10-01", 25);

        let stats = stats_core(&conn, "2026-10-01", 7).expect("stats");
        let dage: Vec<&str> = stats.dage.iter().map(|d| d.day.as_str()).collect();
        assert_eq!(dage, vec!["2026-10-01"]);
        assert_eq!(stats.i_dag.sessions, 1);
    }

    #[test]
    fn en_gammel_database_laerer_tabellen_uden_at_miste_data() {
        // En database fra FØR denne ændring: masser af brugerdata, ingen
        // pomodoro-tabel. Den skal køre den rigtige startrækkefølge og have både
        // sin egen data og den nye tabel bagefter — missionen siger, at
        // brugerens database aldrig må kunne gå tabt.
        let conn = setup();
        conn.execute_batch(
            "DROP TABLE pomodoro_sessions;
             INSERT INTO clients (id, name) VALUES ('c1', 'Acme');
             INSERT INTO time_entries (id, start_time, duration)
                 VALUES ('t1', '2026-09-30T09:00:00', 2.5);",
        )
        .expect("gammel database");
        assert!(
            conn.prepare("SELECT 1 FROM pomodoro_sessions LIMIT 0")
                .is_err(),
            "tabellen skal mangle før starten, ellers dømmer testen ingenting"
        );

        conn.execute_batch(SCHEMA).expect("SCHEMA på gammel database");

        assert!(
            conn.prepare("SELECT 1 FROM pomodoro_sessions LIMIT 0")
                .is_ok(),
            "pomodoro_sessions should exist after init"
        );

        // Brugerens egne rækker er der stadig, uændrede.
        let navn: String = conn
            .query_row("SELECT name FROM clients WHERE id = 'c1'", [], |r| r.get(0))
            .expect("client kept");
        assert_eq!(navn, "Acme");
        let varighed: f64 = conn
            .query_row(
                "SELECT duration FROM time_entries WHERE id = 't1'",
                [],
                |r| r.get(0),
            )
            .expect("time entry kept");
        assert_eq!(varighed, 2.5);
    }

    // --- Faser til tidslinjen -------------------------------------------------

    /// Skriver en fase med et **valgt** sluttidspunkt. `skriv` bruges, når
    /// sluttidspunktet er ligegyldigt.
    fn skriv_slut(conn: &Connection, id: &str, day: &str, minutes: u32, ended: &str) {
        skriv_session_core(conn, id, day, minutes, ended).expect("skriv_session_core should succeed");
    }

    #[test]
    fn en_fase_far_sit_starttidspunkt_ud_af_varigheden() {
        let conn = setup();
        skriv_slut(&conn, "a", "2026-10-01", 25, "2026-10-01T09:30:00");

        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        assert_eq!(faser.len(), 1);
        assert_eq!(faser[0].started_at, "2026-10-01T09:05:00");
        assert_eq!(faser[0].ended_at, "2026-10-01T09:30:00");
        assert_eq!(faser[0].minutes, 25);
        assert_eq!(faser[0].day, "2026-10-01");
    }

    #[test]
    fn en_fase_saa_ved_midnat_har_et_interval_der_ikke_loeber_baglaens() {
        let conn = setup();
        // 00:10 minus 25 minutter er 23:45 **dagen før** — det interval er
        // stadig gyldigt, og det skal skrives som det. Trækker man i stedet i
        // UTC, eller lader `checked_sub_signed` fejle, ender start på 00:45
        // samme dag, og tidslinjen ville tegne en fase der begynder efter den
        // selv sluttede.
        skriv_slut(&conn, "nat", "2026-10-01", 25, "2026-10-01T00:10:00");

        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        assert_eq!(faser[0].started_at, "2026-09-30T23:45:00");
        assert!(faser[0].started_at < faser[0].ended_at);
    }

    #[test]
    fn kun_den_spoergte_dags_faser_kommer_med() {
        let conn = setup();
        skriv_slut(&conn, "igår", "2026-09-30", 25, "2026-09-30T09:30:00");
        skriv_slut(&conn, "idag", "2026-10-01", 25, "2026-10-01T09:30:00");
        skriv_slut(&conn, "i_morgen", "2026-10-02", 25, "2026-10-02T09:30:00");

        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        assert_eq!(faser.len(), 1);
        assert_eq!(faser[0].id, "idag");
    }

    #[test]
    fn faser_kommer_i_starttidspunktet_raekkefoelge() {
        let conn = setup();
        // Skrevet i omvendt rækkefølge, for `ORDER BY ended_at` alene ville
        // sortere på sluttidspunktet — og en backup med en blanding af
        // UTC-instanser og lokale væg-tider tekstsorterer forkert.
        skriv_slut(&conn, "sen", "2026-10-01", 25, "2026-10-01T14:00:00");
        skriv_slut(&conn, "før", "2026-10-01", 25, "2026-10-01T09:00:00");
        skriv_slut(&conn, "midt", "2026-10-01", 50, "2026-10-01T11:00:00");

        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        let ids: Vec<&str> = faser.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["før", "midt", "sen"]);
    }

    #[test]
    fn en_fase_med_et_offset_sluttidspunkt_omformes_til_vagtid() {
        let conn = setup();
        // Formen en backup eller en gammel synk kan have bragt med. Uden
        // normalisering ville `ended_at` stå med `+00:00` og `started_at`
        // regnet på den, så tidslinjen ville placere en dansk eftermiddagsfase
        // to timer for tidligt.
        skriv_slut(
            &conn,
            "backup",
            "2026-10-01",
            25,
            "2026-10-01T13:30:00+02:00",
        );

        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        // Forventningen regnes fra **maskinens egen** tidszone og ikke fra et
        // fast `+02:00`: CI kører `cargo test` på en maskin i UTC, hvor
        // `13:30+02:00` korrekt er 11:30 væg-tid. En test med et fast
        // klokkeslæt ville være grøn lokalt og rød i CI — eller omvendt.
        assert!(
            !faser[0].ended_at.contains('+') && !faser[0].ended_at.ends_with('Z'),
            "sluttidspunktet skal være lokal væg-tid, ikke en offset-instans: {}",
            faser[0].ended_at
        );
        // Det vigtigste er, at det er det **samme øjeblik** — det er tidslinjens
        // eneste sandhed, uanset hvilken tidszone maskinen står i.
        assert_eq!(
            crate::tid::øjeblik(&faser[0].ended_at),
            crate::tid::øjeblik("2026-10-01T13:30:00+02:00"),
            "normaliseringen må ikke flytte øjeblikket"
        );
        assert_eq!(
            crate::tid::øjeblik(&faser[0].started_at),
            crate::tid::øjeblik(&faser[0].ended_at).map(|e| e - 25 * 60),
            "start skal være præcis 25 minutter før slut"
        );
    }

    #[test]
    fn et_uforstaaeligt_sluttidspunkt_springes_over_og_rapporteres() {
        let conn = setup();
        skriv_slut(&conn, "mørk", "2026-10-01", 25, "ikke et tidspunkt");
        skriv_slut(&conn, "god", "2026-10-01", 25, "2026-10-01T09:30:00");

        // Springes over i stedet for at gætte: en tidslinje der tegner en fase
        // med længden men uden klokkeslæt ville være værre end ingen fase.
        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        assert_eq!(faser.len(), 1);
        assert_eq!(faser[0].id, "god");
    }

    #[test]
    fn en_dag_uden_faser_er_tom_og_ikke_ukendt() {
        let conn = setup();
        skriv_slut(&conn, "igår", "2026-09-30", 25, "2026-09-30T09:30:00");

        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        assert!(faser.is_empty(), "en tom dag skal svare med nul faser");
    }

#[test]
    fn en_synlig_fase_serialiserer_med_de_felter_tidslinjen_laeser() {
        // Frontend'en læser `started_at` og `ended_at` — samme form som
        // `Activity` og `TimeEntry` bruger i hele appen, og derfor **ikke**
        // camelCase som de yngre kommandoer. En tavs navnefejl ville give
        // `undefined` i tidslinjen og intet synligt interval uden at nogen
        // kastede, så porten dømmer navnene.
        let conn = setup();
        skriv_slut(&conn, "a", "2026-10-01", 25, "2026-10-01T09:30:00");

        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        let json = serde_json::to_value(&faser[0]).expect("json");
        assert_eq!(json["started_at"], "2026-10-01T09:05:00");
        assert_eq!(json["ended_at"], "2026-10-01T09:30:00");
        assert_eq!(json["minutes"], 25);
        assert_eq!(json["day"], "2026-10-01");
        assert_eq!(json["id"], "a");
        // Navnet på markeringen er lige så hårdt som de andre: `registreret`
        // er `undefined` i frontend'en hvis Rust kalder den noget andet, og så
        // ligner hver fase sig en ubogført — altså præcis den stilhed
        // kolonnen blev lagt ind for at fjerne.
        assert_eq!(json["registreret"], false);
    }

    // --- Er fasen bogført? --------------------------------------------------

    /// Bogfører en fase gennem den **samme** kode `create_time_entry` bruger, så
    /// porten ikke kan være grøn ved at skrive kolonnen med sin egen INSERT.
    fn bogfor(conn: &Connection, fase_id: &str) -> String {
        conn.execute(
            "INSERT OR IGNORE INTO clients (id, name) VALUES ('c1', 'Acme')",
            [],
        )
        .expect("kunde");
        let input = crate::commands::time_entries::CreateTimeEntryInput {
            project_id: None,
            client_id: Some("c1".to_string()),
            klippekort_id: None,
            description: Some("Pomodoro".to_string()),
            start_time: "2026-10-01T09:05:00".to_string(),
            end_time: Some("2026-10-01T09:30:00".to_string()),
            duration: Some(25 * 60),
            is_billable: Some(true),
            pomodoro_session_id: Some(fase_id.to_string()),
        };
        let (entry, _) = crate::commands::time_entries::create_time_entry_inner(conn, &input)
            .expect("create_time_entry_inner");
        entry.id
    }

    #[test]
    fn en_bogfort_fase_siger_det_og_en_ubogfort_gor_ikke() {
        let conn = setup();
        skriv_slut(&conn, "b", "2026-10-01", 25, "2026-10-01T09:30:00");
        skriv_slut(&conn, "u", "2026-10-01", 25, "2026-10-01T11:30:00");
        bogfor(&conn, "b");

        let faser = sessioner_for_dag_core(&conn, "2026-10-01").expect("faser");
        let bogfort: Vec<&str> = faser
            .iter()
            .filter(|f| f.registreret)
            .map(|f| f.id.as_str())
            .collect();
        assert_eq!(bogfort, vec!["b"], "kun den bogførte fase skal være markeret");
        // En ubogført fase skal ikke arve markeringen af en andens
        // registrering. Matchede spørgningen for brede — fx på klienten i stedet
        // for på fase-id'et — ville alle dagens faser se registrerede ud.
        assert!(!faser.iter().find(|f| f.id == "u").expect("u").registreret);
    }

    #[test]
    fn en_slettet_registrering_gor_fasen_ubogfort_igen() {
        let conn = setup();
        skriv_slut(&conn, "b", "2026-10-01", 25, "2026-10-01T09:30:00");
        let id = bogfor(&conn, "b");
        assert!(
            sessioner_for_dag_core(&conn, "2026-10-01").expect("faser")[0].registreret,
            "fasen skal være markeret lige efter registreringen"
        );

        conn.execute("DELETE FROM time_entries WHERE id = ?1", [&id])
            .expect("slet registreringen");

        // Markeringen skal følge registreringen, ikke fasen: brugeren har
        // slettet tiden og kan bogføre den igen. En markering der bliver stående
        // ville sige «allerede registreret» om noget der ikke findes.
        assert!(
            !sessioner_for_dag_core(&conn, "2026-10-01").expect("faser")[0].registreret,
            "en slettet registrering må ikke efterlade faserne markeret"
        );
    }

    #[test]
    fn en_gammel_database_laerer_pomodorokolonnen_uden_at_miste_tid() {
        // `time_entries` fra **før** kolonnen fandtes, med brugerens egne data i
        // den. Missionen siger, at brugerens database aldrig må kunne gå tabt, så
        // migrationen skal køre mod en gammel form og begge dele skal være der
        // bagefter: den nye kolonne, og den tid brugeren havde bogført.
        let conn = setup();
        conn.execute_batch(
            "DROP TABLE time_entries;
             CREATE TABLE time_entries (
                 id TEXT PRIMARY KEY NOT NULL,
                 project_id TEXT,
                 client_id TEXT,
                 klippekort_id TEXT,
                 description TEXT,
                 start_time TEXT NOT NULL,
                 end_time TEXT,
                 duration INTEGER,
                 is_billable INTEGER NOT NULL DEFAULT 1,
                 is_running INTEGER NOT NULL DEFAULT 0,
                 source TEXT NOT NULL DEFAULT 'manual',
                 klippekort_deducted_hours REAL NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                 synced_at TEXT
             );
             INSERT INTO time_entries (id, start_time, duration, description)
                 VALUES ('gammel', '2026-09-30T09:00:00', 7200, 'Kundearbejde');",
        )
        .expect("gammel database");
        assert!(
            conn.prepare("SELECT pomodoro_session_id FROM time_entries LIMIT 0")
                .is_err(),
            "kolonnen skal mangle før migrationen, ellers dømmer testen ingenting"
        );

        crate::db::Database::apply_migrations(&conn).expect("apply_migrations");

        assert!(
            conn.prepare("SELECT pomodoro_session_id FROM time_entries LIMIT 0")
                .is_ok(),
            "kolonnen skal findes efter migrationen"
        );
        let (varighed, beskrivelse): (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT duration, description FROM time_entries WHERE id = 'gammel'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("den gamle registrering skal være der stadig");
        assert_eq!(varighed, Some(7200), "registreret tid må ikke gå tabt");
        assert_eq!(beskrivelse.as_deref(), Some("Kundearbejde"));
        // NULL betyder «ikke fra en pomodoro», altså præcis hvad alle gamle
        // rækker skal sige. Ikke en tom streng, der matcher ingen fase.
        let fase: Option<String> = conn
            .query_row(
                "SELECT pomodoro_session_id FROM time_entries WHERE id = 'gammel'",
                [],
                |r| r.get::<_, Option<String>>(0),
            )
            .expect("kolonne");
        assert_eq!(fase, None);
    }

    #[test]
    fn migrationen_kan_kore_to_gange() {
        // Idempotens er et krav, ikke en vane: `apply_migrations` kører ved
        // **hver** start, så en ALTER der kun kan køre én gang ville gøre appen
        // til at starfe én gang og så fejle ved hver senere.
        let conn = setup();
        crate::db::Database::apply_migrations(&conn).expect("første kørsel");
        crate::db::Database::apply_migrations(&conn).expect("anden kørsel");
        assert!(
            conn.prepare("SELECT pomodoro_session_id FROM time_entries LIMIT 0")
                .is_ok()
        );
    }
}
