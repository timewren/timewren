use crate::db::Database;
use crate::sync::engine::log_sync_change;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeEntry {
    pub id: String,
    pub remote_id: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub klippekort_id: Option<String>,
    pub description: Option<String>,
    pub start_time: String,
    pub end_time: Option<String>,
    pub duration: Option<i64>,
    pub is_billable: bool,
    pub is_running: bool,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
    pub synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTimeEntryInput {
    pub project_id: Option<String>,
    pub client_id: Option<String>,
    pub klippekort_id: Option<String>,
    pub description: Option<String>,
    pub start_time: String,
    pub end_time: Option<String>,
    pub duration: Option<i64>,
    pub is_billable: Option<bool>,
    /// Sættes **kun** af pomodoro-registreringen. Det er den eneste vej til at
    /// vide, at en fasens minutter allerede er bogført, så tidslinjens række kan
    /// sige det. `None` på enhver anden registrering — og på en gammel bygge der
    /// ikke kender feltet, derfor `Option` og ikke et krav om feltet.
    #[serde(default)]
    pub pomodoro_session_id: Option<String>,
}

const TIME_ENTRY_SELECT: &str =
    "SELECT t.id, t.remote_id, t.project_id, p.name, p.color, t.client_id, c.name, t.klippekort_id, t.description, t.start_time, t.end_time, t.duration, t.is_billable, t.is_running, t.source, t.created_at, t.updated_at, t.synced_at
     FROM time_entries t
     LEFT JOIN projects p ON t.project_id = p.id
     LEFT JOIN clients c ON t.client_id = c.id";

fn row_to_time_entry(row: &rusqlite::Row) -> rusqlite::Result<TimeEntry> {
    Ok(TimeEntry {
        id: row.get(0)?,
        remote_id: row.get(1)?,
        project_id: row.get(2)?,
        project_name: row.get(3)?,
        project_color: row.get(4)?,
        client_id: row.get(5)?,
        client_name: row.get(6)?,
        klippekort_id: row.get(7)?,
        description: row.get(8)?,
        start_time: row.get(9)?,
        end_time: row.get(10)?,
        duration: row.get(11)?,
        is_billable: row.get::<_, i32>(12)? != 0,
        is_running: row.get::<_, i32>(13)? != 0,
        source: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        synced_at: row.get(17)?,
    })
}

/// The customer a time entry is stored with, resolved so the entry, the
/// klippekort it spends and the report row that bills it cannot disagree.
///
/// The customer follows the project, in ONE direction: a chosen project owns the
/// customer, clearing it when it has none. Every write of the pair goes through
/// here, because these are published commands — the `(project_id, client_id)`
/// they receive is unverified input from the frontend, and
/// `find_active_klippekort` looks the card up by that customer. A client sending
/// `project_id = "Eget arbejde"` (no customer) together with a customer from an
/// earlier choice would otherwise spend that customer's prepaid hours on an
/// internal project, because the lookup falls back to the customer's own card.
///
/// With no project the caller's customer is the only thing that says WHO the
/// work is for, so it is kept — "Acme, no project" is legitimate billable work
/// (`resolveClientId` in `src/lib/timeEntryActions.ts` is the same rule, and the
/// three forms apply it before sending).
///
/// A `project_id` that matches no project resolves to no customer rather than
/// keeping the one that was sent: under-billing can still be corrected by the
/// user, billing the wrong customer cannot.
pub(crate) fn resolve_entry_client(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
    client_id: Option<&str>,
) -> Option<String> {
    match project_id {
        Some(pid) => crate::tracker::rules::client_of_project(conn, pid),
        None => client_id.map(str::to_string),
    }
}

/// Finds the klippekort a new entry should auto-deduct from, by the same rule
/// as the web app and the extension (`pickAutoDeductPackage` in
/// `src/lib/prepaid/auto-select.ts` on the server):
///
/// - only cards that are active, have auto-deduct switched on, have hours
///   left, and have not expired (the card is valid through its whole expiry
///   day, in local — Danish — time);
/// - the one that expires first wins, cards without expiry come last;
/// - same expiry: the OLDEST card first (FIFO — the customer's first card is
///   used up before the next).
///
/// A project-specific card is preferred to the customer's own card.
///
/// Picking the newest card regardless of these let an expired or used-up card
/// be chosen, and the server then refused the whole entry on every sync.
fn find_active_klippekort(
    conn: &rusqlite::Connection,
    client_id: &str,
    project_id: Option<&str>,
) -> Option<(String, f64, f64)> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    find_active_klippekort_on(conn, client_id, project_id, &today)
}

/// `find_active_klippekort` with "today" (`YYYY-MM-DD`) passed in, for tests.
fn find_active_klippekort_on(
    conn: &rusqlite::Connection,
    client_id: &str,
    project_id: Option<&str>,
    today: &str,
) -> Option<(String, f64, f64)> {
    // (klippekort_id, total_hours, used_hours)
    const GYLDIG: &str = "status = 'active' AND auto_deduct = 1
             AND total_hours - used_hours > 0
             AND (expires_at IS NULL OR expires_at = '' OR substr(expires_at, 1, 10) >= ?2)";
    const RÆKKEFØLGE: &str = "ORDER BY (expires_at IS NULL OR expires_at = ''),
             substr(expires_at, 1, 10) ASC, created_at ASC, rowid ASC LIMIT 1";
    let række = |row: &rusqlite::Row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?))
    };

    // First, try project-specific klippekort
    if let Some(pid) = project_id {
        if let Ok(row) = conn.query_row(
            &format!(
                "SELECT id, total_hours, used_hours FROM klippekort
                 WHERE client_id = ?1 AND project_id = ?3 AND {GYLDIG} {RÆKKEFØLGE}"
            ),
            rusqlite::params![client_id, today, pid],
            række,
        ) {
            return Some(row);
        }
    }

    // Fallback: client-level klippekort (project_id IS NULL)
    conn.query_row(
        &format!(
            "SELECT id, total_hours, used_hours FROM klippekort
             WHERE client_id = ?1 AND (project_id IS NULL) AND {GYLDIG} {RÆKKEFØLGE}"
        ),
        rusqlite::params![client_id, today],
        række,
    )
    .ok()
}

/// Takes the klippekort off an entry the server refused to deduct for (expired,
/// inactive, unknown, or too few hours left on the server), and gives the
/// local deduction back.
///
/// The server rolls the whole entry back when the deduction fails, so without
/// this the entry was refused again on every sync and the time never reached
/// timetrack.dk. The entry's pending sync row is still in the queue, so the next
/// push sends it as ordinary time. Returns whether a card was removed.
pub(crate) fn fjern_afvist_klippekort(
    conn: &rusqlite::Connection,
    entry_id: &str,
) -> Result<bool, String> {
    let har_kort: bool = conn
        .query_row(
            "SELECT klippekort_id IS NOT NULL FROM time_entries WHERE id = ?1",
            rusqlite::params![entry_id],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !har_kort {
        return Ok(false);
    }
    let now = chrono::Utc::now().to_rfc3339();
    i_en_transaktion(conn, |conn| {
        reverse_klippekort_deduction(conn, entry_id)?;
        conn.execute(
            "UPDATE time_entries SET klippekort_id = NULL, klippekort_deducted_hours = 0,
             updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, entry_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

/// Recomputes a klippekort's status from its current used/total hours.
/// A klippekort that still has hours left (or was previously depleted/expired
/// but now has hours restored) becomes 'active'; once fully used it is 'depleted'.
/// 'expired' status is preserved (time-based, not usage-based).
fn klippekort_status_for(used_hours: f64, total_hours: f64, current_status: &str) -> &'static str {
    if used_hours >= total_hours {
        "depleted"
    } else {
        // Restored below the cap → active again, unless it expired on a date basis.
        if current_status == "expired" {
            "expired"
        } else {
            "active"
        }
    }
}

/// Læser et `time_entries`-tidsstempel til en sorteringsnøgle.
///
/// Tabellen rumler to formater: naive lokale væg-tid fra den manuelle formular og
/// den tidsmigration i `tid` (`2026-09-30T22:00:00`, jf.
/// `calendar::local_ts_expr`), og UTC-instanser fra timeren og auto-trackeren
/// (`…+00:00`) på rækker, porten endnu ikke har været forbi — en backup eller
/// en database, der ikke er startet siden opdateringen. Nøglen er derfor parret
/// af værdien og et flag, der siger hvilken af de to vi har — de må kun
/// sammenlignes med hinanden, for en UTC-instant og en væg-tid uden offset er
/// ikke det samme slags tal. At springe over sammenligningen i stedet er det
/// forkerte valg: en afvist dagsregistrering trækker **minus** timer fra
/// klippekortet. Et format vi ikke genkender giver `None`, så er vi ikke klogere
/// end det indskrevne tal, og kalderen lader data stå som de er.
fn tidsstempel(rå: &str) -> Option<(i64, bool)> {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(rå) {
        return Some((t.timestamp(), true));
    }
    chrono::NaiveDateTime::parse_from_str(rå, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .map(|naive| (naive.and_utc().timestamp(), false))
}

/// Stopper en tidsregistrering, hvis sluttidspunktet ligger FØR starttidspunktet.
///
/// Uden denne tjek skrev `create_time_entry` og `update_time_entry` hvad som helst
/// i tabellen. En omvendt registrering er ikke kosmetisk: `auto_deduct_klippekort`
/// trækker `duration / 3600` **minus** timer fra brugerens betalte klippekort, så
/// en enkelt dårlig værdi både fylder timer på klippekortet og viser negativ tid i
/// kalender, rapporter og eksport. Formularen ruller et tidligere sluttidspunkt
/// frem til næste dag (nattskift), så gyldige data kan ikke nå her — kalder som
/// ikke bruger formularen (import, bulk, en fremtidig skærm) kan, og det er
/// præcis dem dette låser.
///
/// Ligelige tidspunkter er tilladt: hele dages kalenderbegivenheder konverteres
/// med varighed `None`, og de skal stadig kunne registreres.
fn tjek_ved_start(start_time: &str, end_time: Option<&str>) -> Result<(), String> {
    let Some(end) = end_time else {
        return Ok(());
    };
    let (Some((start, start_er_instant)), Some((slut, slut_er_instant))) =
        (tidsstempel(start_time), tidsstempel(end))
    else {
        // Et format vi ikke læser: afvis ikke data på et gæt.
        return Ok(());
    };
    if start_er_instant == slut_er_instant && slut < start {
        return Err(crate::i18n::t("timeEntry.endBeforeStart"));
    }
    Ok(())
}

/// Kører `f` som én atomisk skrivning: enten gemmer alle dens ændringer, eller
/// ingen af dem.
///
/// Bruges til de klippekort-skrivninger, der består af TO rækker — en i
/// `klippekort` og en i `time_entries`. De to skal aldrig kunne komme i
/// modstridende tilstande: hvis klippekortet er fratrukket, men
/// tidsregistreringen ikke har noteret hvor meget, kan fradraget aldrig gives
/// tilbage igen, og brugerens betalte timer er væk.
///
/// SAVEPOINT bruges frem for BEGIN, fordi kaldene også kan ske inde i en
/// transaktion, en kalder har åbnet. En indlejret BEGIN ville fejle, og så
/// ville fradraget aldrig ske. Navnet er bevidst fast: SQLite lader et nyt
/// savepoint med samme navn skygge for det ældre, så `ROLLBACK TO` og
/// `RELEASE` altid rammer den inderste — også hvilende kaldene bliver nødt til
/// at kalde ind i hinanden.
fn i_en_transaktion<T>(
    conn: &rusqlite::Connection,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    conn.execute_batch("SAVEPOINT klippekort_skrivning")
        .map_err(|e| e.to_string())?;

    match f(conn) {
        Ok(værdi) => {
            conn.execute_batch("RELEASE SAVEPOINT klippekort_skrivning")
                .map_err(|e| e.to_string())?;
            Ok(værdi)
        }
        Err(fejl) => {
            // Hvert kald står for sig. Hvis ROLLBACK TO fejler, må RELEASE
            // stadig køre, ellers hænger et savepoint i transaktionen og
            // holder den åben. Ingen af delene må stå i vejen for den
            // oprindelige fejl.
            let _ = conn.execute_batch("ROLLBACK TO SAVEPOINT klippekort_skrivning");
            let _ = conn.execute_batch("RELEASE SAVEPOINT klippekort_skrivning");
            Err(fejl)
        }
    }
}

/// Deducts hours from a klippekort AND records the exact amount on the owning
/// time entry, so the deduction can be reversed precisely on delete/edit.
///
/// Records the deducted amount in `time_entries.klippekort_deducted_hours` for
/// `entry_id`. This is the idempotency anchor: each entry's contribution to a
/// klippekort balance is stored exactly once. The two writes happen in one
/// transaction, so a klippekort can never be debited for an entry that does
/// not know about the deduction.
fn auto_deduct_klippekort(
    conn: &rusqlite::Connection,
    entry_id: &str,
    klippekort_id: &str,
    hours: f64,
) -> Result<(), String> {
    crate::commands::klippekort::validate_deduct_hours(hours)?;

    let now = chrono::Utc::now().to_rfc3339();

    // Fetch current state
    let (used_hours, total_hours, status): (f64, f64, String) = conn
        .query_row(
            "SELECT used_hours, total_hours, status FROM klippekort WHERE id = ?1",
            rusqlite::params![klippekort_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("Klippekort not found: {}", e))?;

    let new_used = used_hours + hours;
    let new_status = klippekort_status_for(new_used, total_hours, &status);

    i_en_transaktion(conn, |conn| {
        conn.execute(
            "UPDATE klippekort SET used_hours = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![new_used, new_status, now, klippekort_id],
        )
        .map_err(|e| e.to_string())?;

        // Record the precise amount deducted for this entry so it can be reversed.
        conn.execute(
            "UPDATE time_entries SET klippekort_deducted_hours = ?1 WHERE id = ?2",
            rusqlite::params![hours, entry_id],
        )
        .map_err(|e| e.to_string())?;

        log_sync_change(conn, "klippekort", klippekort_id, "update");

        Ok(())
    })
}

/// Reverses the klippekort deduction previously recorded for a time entry, if any.
///
/// Reads `klippekort_deducted_hours` for `entry_id`, adds that amount back to the
/// entry's klippekort (`used_hours`), recomputes status, and resets the entry's
/// recorded deduction to 0. Safe to call on entries with no deduction (no-op) and
/// idempotent (the column is zeroed afterwards, so a second call does nothing).
///
/// Giver timerne tilbage OG nulstiller registreringen i én transaktion. Ellers
/// kunne den ene lykkes: enten får brugeren timerne tilbage uden at
/// registreringen glemmer det (næste redigering ville give dem til igen), eller
/// registreringen glemmer fradraget uden at timerne komme tilbage.
fn reverse_klippekort_deduction(
    conn: &rusqlite::Connection,
    entry_id: &str,
) -> Result<(), String> {
    let row: Option<(Option<String>, f64)> = conn
        .query_row(
            "SELECT klippekort_id, klippekort_deducted_hours FROM time_entries WHERE id = ?1",
            rusqlite::params![entry_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    let Some((Some(klippekort_id), deducted)) = row else {
        return Ok(());
    };

    // `!(x > 0.0)` dækker også NaN, som aldrig tæller som et fradrag.
    if deducted.is_nan() || deducted <= 0.0 {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();

    let restored = conn
        .query_row(
            "SELECT used_hours, total_hours, status FROM klippekort WHERE id = ?1",
            rusqlite::params![klippekort_id],
            |row| {
                Ok((
                    row.get::<_, f64>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .ok();

    i_en_transaktion(conn, |conn| {
        if let Some((used_hours, total_hours, status)) = restored {
            let new_used = (used_hours - deducted).max(0.0);
            let new_status = klippekort_status_for(new_used, total_hours, &status);

            conn.execute(
                "UPDATE klippekort SET used_hours = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![new_used, new_status, now, klippekort_id],
            )
            .map_err(|e| e.to_string())?;

            log_sync_change(conn, "klippekort", &klippekort_id, "update");
        }

        // Clear the recorded deduction so a repeat call is a no-op.
        conn.execute(
            "UPDATE time_entries SET klippekort_deducted_hours = 0 WHERE id = ?1",
            rusqlite::params![entry_id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// Gør et daggrænse-brugbart interval ud af det, kalderen sender.
///
/// `time_entries.start_time` er en **lokal naiv** streng (`2026-10-01T09:00:00`,
/// se `create_time_entry`), og grænsen sammenlignes som tekst. Et rent
/// kalenderdato (`2026-10-01`) er derfor *ikke* et interval: `"2026-10-01T09:00:00"
/// <= "2026-10-01"` er falsk, fordi strengen er længere. Uden denne
/// normalisering fik dagsvisningen nul poster og uge-/måned-visningen mistede
/// den sidste dag, fordi de sender rå datoer (`DayView.tsx:60`, `WeekView.tsx:55`,
/// `MonthView.tsx:36`).
///
/// Kaldes med `seneste=true` for `to`, så dagen lukkes på `23:59:59` i stedet
/// for at blive en eksklusiv midnat.
fn dagsgrev(dato: &str, seneste: bool) -> String {
    let ren = dato.trim().trim_end_matches('Z');
    if ren.len() == 10 && ren.as_bytes()[4] == b'-' && ren.as_bytes()[7] == b'-' {
        format!("{}T{}", ren, if seneste { "23:59:59" } else { "00:00:00" })
    } else {
        ren.to_string()
    }
}

pub(crate) fn list_time_entries_core(
    conn: &rusqlite::Connection,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<TimeEntry>, String> {
    let from = from.as_deref().map(|f| dagsgrev(f, false));
    let to = to.as_deref().map(|t| dagsgrev(t, true));

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match (&from, &to) {
        (Some(f), Some(t)) => (
            format!(
                "{} WHERE t.start_time >= ?1 AND t.start_time <= ?2 ORDER BY t.start_time DESC",
                TIME_ENTRY_SELECT
            ),
            vec![Box::new(f.clone()), Box::new(t.clone())],
        ),
        (Some(f), None) => (
            format!(
                "{} WHERE t.start_time >= ?1 ORDER BY t.start_time DESC",
                TIME_ENTRY_SELECT
            ),
            vec![Box::new(f.clone())],
        ),
        (None, Some(t)) => (
            format!(
                "{} WHERE t.start_time <= ?1 ORDER BY t.start_time DESC",
                TIME_ENTRY_SELECT
            ),
            vec![Box::new(t.clone())],
        ),
        (None, None) => (
            format!("{} ORDER BY t.start_time DESC LIMIT 500", TIME_ENTRY_SELECT),
            vec![],
        ),
    };

    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(params_refs.as_slice(), row_to_time_entry)
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    Ok(entries)
}

#[tauri::command]
pub fn list_time_entries(
    db: State<'_, Database>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<TimeEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    list_time_entries_core(&conn, from, to)
}

/// Klippekort balance state captured at the moment a time entry auto-selected
/// its klippekort. Used to emit the same near-depletion warning regardless of
/// which command created the entry (manual create or calendar conversion).
pub(crate) struct KlippekortWarning {
    pub used: f64,
    pub total: f64,
}

/// The `klippekort-warning` payload, or `None` when the card is not close enough
/// to empty to be worth interrupting the user for.
///
/// **Tal, ikke en sætning.** Den gamle kode skrev den danske besked her med
/// `format!`, så en svensk, norsk, tysk eller engelsk bruger fik «Klippekort er
/// 95% brugt» midt i en app der ellers er oversat — og `{:.1}` skrev
/// decimalkommaet som et **punkt** i alle sprog, så selv dansk læste «29.5t / 30t».
/// Sætningen bygges nu i frontend'en, som kender både sprogvalget og talformater,
/// lige som `KlippekortCard` og `ReportView` gjorde det i K25f.
///
/// Udskilt fra `emit_klippekort_warning` så porten kan dømme *payloaden* uden en
/// `tauri::AppHandle` — en `AppHandle` kan ikke konstrueres i en test, så en
/// besked i selve emitteren ville være usynlig for porten.
pub(crate) fn klippekort_warning_payload(
    w: &KlippekortWarning,
) -> Option<serde_json::Value> {
    let (used, total) = (w.used, w.total);
    // `total <= 0` er ikke et udløbt klippekort, det er et datakort uden
    // kapacitet. Det gamle `used >= total` sagde «opbrugt» om begge, fordi
    // `0.0 >= 0.0` er sandt — så en bruger der lige havde oprettet et kort uden
    // timer fik en rød toast om sin egen forudbetaling. Værnet står *før*
    // tærsklen, ikke bagefter, så det er den beslutning der afgør.
    if total <= 0.0 || total.is_nan() {
        return None;
    }
    let pct = (used / total) * 100.0;
    let type_ = if used >= total {
        "depleted"
    } else if pct >= 90.0 {
        "warning"
    } else {
        return None;
    };
    Some(serde_json::json!({
        "type": type_,
        "used": used,
        "total": total,
    }))
}

/// Emits a `klippekort-warning` event to the frontend when a klippekort is
/// depleted (>= 100%) or nearly depleted (>= 90%). Shared by every entry-
/// creation command so the warning UX is identical across entry points.
pub(crate) fn emit_klippekort_warning(app_handle: &tauri::AppHandle, w: &KlippekortWarning) {
    if let Some(payload) = klippekort_warning_payload(w) {
        let _ = app_handle.emit("klippekort-warning", payload);
    }
}

/// The single time-entry creation path: inserts the entry, auto-selects and
/// auto-deducts a klippekort, and logs the sync change. Returns the fully
/// JOINed entry plus any klippekort warning to surface.
///
/// This is the ONE creation core — both `create_time_entry` (manual) and
/// `convert_calendar_event` go through it, so klippekort deduction can never
/// diverge between entry points. It takes `&Connection` (no `AppHandle`) so it
/// is unit-testable; the caller emits the returned warning.
pub(crate) fn create_time_entry_inner(
    conn: &rusqlite::Connection,
    input: &CreateTimeEntryInput,
) -> Result<(TimeEntry, Option<KlippekortWarning>), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let is_billable = input.is_billable.unwrap_or(true);

    tjek_ved_start(&input.start_time, input.end_time.as_deref())?;

    // The ONE write, so the ONE place the stored form is enforced. Every
    // reader of `start_time` — the day bounds in `list_time_entries_core`,
    // `DATE(start_time)` in the report, `auto_invoice`, the exports — treats
    // the column as a local wall clock, so a caller handing in a UTC instant
    // would book the work on the previous calendar day whenever it happened
    // between midnight and 02:00. The tracker, the calendar conversion and the
    // idle prompt all did exactly that. Normalising here means the next caller
    // cannot reintroduce it.
    //
    // A value we cannot read is passed through untouched: rejecting it would
    // lose a registration the user typed, and storing it unchanged keeps it
    // visible and repairable.
    let start_time = crate::tid::lokal_naiv(&input.start_time)
        .unwrap_or_else(|| input.start_time.clone());
    let end_time = input
        .end_time
        .as_deref()
        .and_then(crate::tid::lokal_naiv)
        .or_else(|| input.end_time.clone());

    // The project decides the customer (see `resolve_entry_client`), so the
    // klippekort lookup and the stored row must both use the resolved one.
    let client_id = resolve_entry_client(conn, input.project_id.as_deref(), input.client_id.as_deref());

    // Auto-select klippekort if not provided and client has one
    let mut warning: Option<KlippekortWarning> = None;
    let klippekort_id = if input.klippekort_id.is_some() {
        input.klippekort_id.clone()
    } else if let Some(ref cid) = client_id {
        find_active_klippekort(conn, cid, input.project_id.as_deref()).map(|(kid, total, used)| {
            warning = Some(KlippekortWarning { used, total });
            kid
        })
    } else {
        None
    };

    conn.execute(
        "INSERT INTO time_entries (id, project_id, client_id, klippekort_id, description, start_time, end_time, duration, is_billable, is_running, source, pomodoro_session_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 'manual', ?10, ?11, ?11)",
        rusqlite::params![
            id,
            input.project_id,
            client_id,
            klippekort_id,
            input.description,
            start_time,
            end_time,
            input.duration,
            is_billable as i32,
            input.pomodoro_session_id,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Auto-deduct hours from klippekort if entry has duration
    if let (Some(ref kid), Some(duration)) = (&klippekort_id, input.duration) {
        if duration > 0 {
            let hours = duration as f64 / 3600.0;
            // Fradraget lykkes, men tidsregistreringen står gemt. Tænk ikke
            // på det som en fejl: uden fradrag bliver brugeren overfaktureret,
            // så den skal siges højt.
            if let Err(e) = auto_deduct_klippekort(conn, &id, kid, hours) {
                crate::db::errors::record("kunne ikke trække timer fra klippekortet", e);
            }
        }
    }

    log_sync_change(conn, "time_entry", &id, "create");

    // Fetch the full entry with JOINed names
    let entry = conn
        .query_row(
            &format!("{} WHERE t.id = ?1", TIME_ENTRY_SELECT),
            rusqlite::params![id],
            row_to_time_entry,
        )
        .map_err(|e| e.to_string())?;

    Ok((entry, warning))
}

#[tauri::command]
pub fn create_time_entry(
    db: State<'_, Database>,
    app_handle: tauri::AppHandle,
    input: CreateTimeEntryInput,
) -> Result<TimeEntry, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (entry, warning) = create_time_entry_inner(&conn, &input)?;

    if let Some(w) = warning {
        emit_klippekort_warning(&app_handle, &w);
    }

    Ok(entry)
}

/// Starts a timer: stops (and bills) a running one, then inserts the new running
/// entry. Takes `&Connection` and returns the klippekort warning instead of
/// emitting it, so it is unit-testable and shares `resolve_entry_client` with
/// every other write of the (project, customer) pair.
pub(crate) fn start_timer_core(
    conn: &rusqlite::Connection,
    project_id: Option<String>,
    client_id: Option<String>,
    description: Option<String>,
) -> Result<(TimeEntry, Option<KlippekortWarning>), String> {
    // To forskellige klokker, med to forskellige formater. `stempel` er
    // `created_at`/`updated_at`, som synken sammenligner som UTC-instanser, så
    // den er UTC. `vaegurtid` er `start_time`, som alt, der læser kolonnen som
    // tekst eller med `DATE()`, regner som lokal væg-tid — samme form som den
    // manuelle formular skriver. Skrev timeren UTC her, landede en registrering
    // mellem midnat og kl. 02:00 dansk på den foregående kalenderdag.
    let stempel = chrono::Utc::now().to_rfc3339();
    let vaegurtid = crate::tid::nu_lokal_naiv();

    // Stop any currently running timer and deduct its klippekort
    {
        // Find running entry's klippekort before stopping
        let prev_running: Option<(String, Option<String>, String)> = conn
            .query_row(
                "SELECT id, klippekort_id, start_time FROM time_entries WHERE is_running = 1 LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();

        stop_running_timer(conn, &vaegurtid)?;

        // Deduct from klippekort of the previously running entry
        if let Some((prev_id, Some(prev_kid), prev_start)) = prev_running {
            // Both sides go through the same reader, so a start left in the
            // older UTC form (a backup, a database from before the migration)
            // still yields the right number of seconds instead of no deduction
            // at all.
            if let (Some(s), Some(e)) = (
                crate::tid::øjeblik(&prev_start),
                crate::tid::øjeblik(&vaegurtid),
            ) {
                let duration_secs = (e - s).max(0);
                if duration_secs > 0 {
                    let hours = duration_secs as f64 / 3600.0;
                    if let Err(e) = auto_deduct_klippekort(conn, &prev_id, &prev_kid, hours) {
                        crate::db::errors::record(
                            "kunne ikke trække timer fra klippekortet ved stop",
                            e,
                        );
                    }
                }
            }
            log_sync_change(conn, "time_entry", &prev_id, "update");
        }
    }

    // The project decides the customer — the timer is a create like any other,
    // so its klippekort lookup must not trust the pair it was handed.
    let client_id = resolve_entry_client(conn, project_id.as_deref(), client_id.as_deref());

    // Auto-select klippekort if client has one
    let mut warning: Option<KlippekortWarning> = None;
    let klippekort_id = if let Some(ref cid) = client_id {
        find_active_klippekort(conn, cid, project_id.as_deref()).map(|(kid, total, used)| {
            warning = Some(KlippekortWarning { used, total });
            kid
        })
    } else {
        None
    };

    // Create new running entry
    let id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO time_entries (id, project_id, client_id, klippekort_id, description, start_time, is_billable, is_running, source, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, 'timer', ?7, ?7)",
        rusqlite::params![id, project_id, client_id, klippekort_id, description, vaegurtid, stempel],
    )
    .map_err(|e| e.to_string())?;

    log_sync_change(conn, "time_entry", &id, "create");

    let entry = conn
        .query_row(
            &format!("{} WHERE t.id = ?1", TIME_ENTRY_SELECT),
            rusqlite::params![id],
            row_to_time_entry,
        )
        .map_err(|e| e.to_string())?;

    Ok((entry, warning))
}

#[tauri::command]
pub fn start_timer(
    db: State<'_, Database>,
    app_handle: tauri::AppHandle,
    project_id: Option<String>,
    client_id: Option<String>,
    description: Option<String>,
) -> Result<TimeEntry, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (entry, warning) = start_timer_core(&conn, project_id, client_id, description)?;

    if let Some(w) = warning {
        emit_klippekort_warning(&app_handle, &w);
    }

    Ok(entry)
}

#[tauri::command]
pub fn stop_timer(db: State<'_, Database>, app_handle: tauri::AppHandle) -> Result<Option<TimeEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // `end_time` gets the local wall clock, like `start_time` did — the same
    // reason as in `start_timer_core`.
    let now = crate::tid::nu_lokal_naiv();

    // Find the running entry ID and klippekort_id before stopping
    let running_info: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT id, klippekort_id FROM time_entries WHERE is_running = 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    if let Some((ref id, ref maybe_klippekort_id)) = running_info {
        stop_running_timer(&conn, &now)?;
        log_sync_change(&conn, "time_entry", id, "update");

        // Auto-deduct from klippekort based on actual duration
        let entry = conn
            .query_row(
                &format!("{} WHERE t.id = ?1", TIME_ENTRY_SELECT),
                rusqlite::params![id],
                row_to_time_entry,
            )
            .map_err(|e| e.to_string())?;

        // Deduct from klippekort if linked
        if let Some(ref kid) = maybe_klippekort_id {
            if let Some(duration) = entry.duration {
                if duration > 0 {
                    let hours = duration as f64 / 3600.0;
                    if let Err(e) = auto_deduct_klippekort(&conn, id, kid, hours) {
                        eprintln!("Failed to deduct klippekort hours: {}", e);
                    }

                    // Stod en gang for sig selv med sin egen tærskel og sin egen
                    // danske `format!`. To steder kunne så give forskellige
                    // advarsler, og en oversættelse af det ene ville have ladet
                    // det andet stå dansk. Nu er der én beslutning at rette.
                    if let Ok((used, total)) = conn.query_row(
                        "SELECT used_hours, total_hours FROM klippekort WHERE id = ?1",
                        rusqlite::params![kid],
                        |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
                    ) {
                        emit_klippekort_warning(
                            &app_handle,
                            &KlippekortWarning { used, total },
                        );
                    }
                }
            }
        }

        Ok(Some(entry))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn get_running_timer(db: State<'_, Database>) -> Result<Option<TimeEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let entry = conn
        .query_row(
            &format!("{} WHERE t.is_running = 1 LIMIT 1", TIME_ENTRY_SELECT),
            [],
            row_to_time_entry,
        )
        .ok();

    Ok(entry)
}

#[tauri::command]
pub fn delete_time_entry(db: State<'_, Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Restore any klippekort hours this entry had deducted before removing it,
    // otherwise the prepaid balance stays permanently corrupted.
    reverse_klippekort_deduction(&conn, &id)?;

    log_sync_change(&conn, "time_entry", &id, "delete");

    conn.execute(
        "DELETE FROM time_entries WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Rewrites a time entry. `&Connection` so the (project, customer) pair can be
/// resolved by `resolve_entry_client` and the whole edit be unit-tested, the
/// same split as `create_time_entry_inner`.
pub(crate) fn update_time_entry_core(
    conn: &rusqlite::Connection,
    entry: &TimeEntry,
) -> Result<TimeEntry, String> {
    let now = chrono::Utc::now().to_rfc3339();

    // Før den gamle fradragstilskrivning røres: en omvendt registrering skal
    // afvises, ikke give timer tilbage på klippekortet.
    tjek_ved_start(&entry.start_time, entry.end_time.as_deref())?;

    // The project decides the customer here too: an edit is the one place where
    // a user deliberately moves work between a customer's project and their own
    // projects, and the klippekort that follows must not be the one they just
    // left.
    let client_id = resolve_entry_client(conn, entry.project_id.as_deref(), entry.client_id.as_deref());

    // Same single gate as `create_time_entry_inner`: the edit form round-trips
    // the stored value, so without this an entry that was pulled from the
    // server in UTC form would be re-saved in UTC form and re-book itself on
    // the previous day on every edit. Unreadable values pass through untouched.
    let start_time =
        crate::tid::lokal_naiv(&entry.start_time).unwrap_or_else(|| entry.start_time.clone());
    let end_time = entry
        .end_time
        .as_deref()
        .and_then(crate::tid::lokal_naiv)
        .or_else(|| entry.end_time.clone());

    // Reverse whatever this entry previously deducted from its (old) klippekort
    // before we overwrite klippekort_id/duration. This also zeroes the entry's
    // recorded deduction, so the re-deduction below starts from a clean slate.
    reverse_klippekort_deduction(conn, &entry.id)?;

    conn.execute(
        "UPDATE time_entries SET project_id = ?1, client_id = ?2, klippekort_id = ?3, description = ?4, start_time = ?5, end_time = ?6, duration = ?7, is_billable = ?8, is_running = ?9, updated_at = ?10 WHERE id = ?11",
        rusqlite::params![
            entry.project_id,
            client_id,
            entry.klippekort_id,
            entry.description,
            start_time,
            end_time,
            entry.duration,
            entry.is_billable as i32,
            entry.is_running as i32,
            now,
            entry.id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Re-apply the deduction for the new klippekort/duration (only for completed
    // entries; a running entry is deducted when it stops).
    if let Some(ref kid) = entry.klippekort_id {
        if !entry.is_running {
            if let Some(duration) = entry.duration {
                if duration > 0 {
                    let hours = duration as f64 / 3600.0;
                    let _ = auto_deduct_klippekort(conn, &entry.id, kid, hours);
                }
            }
        }
    }

    log_sync_change(conn, "time_entry", &entry.id, "update");

    // Return the updated entry with JOINed names
    let updated = conn
        .query_row(
            &format!("{} WHERE t.id = ?1", TIME_ENTRY_SELECT),
            rusqlite::params![entry.id],
            row_to_time_entry,
        )
        .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub fn update_time_entry(
    db: State<'_, Database>,
    entry: TimeEntry,
) -> Result<TimeEntry, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    update_time_entry_core(&conn, &entry)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentEntry {
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub description: Option<String>,
}

/// Returns the most recent unique project/client/description combinations
/// for quick "continue from recent" functionality.
#[tauri::command]
pub fn get_recent_entries(
    db: State<'_, Database>,
    limit: i32,
) -> Result<Vec<RecentEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT t.project_id, p.name, p.color, t.client_id, c.name, t.description
             FROM time_entries t
             LEFT JOIN projects p ON t.project_id = p.id
             LEFT JOIN clients c ON t.client_id = c.id
             WHERE t.is_running = 0
             GROUP BY COALESCE(t.project_id, ''), COALESCE(t.client_id, ''), COALESCE(t.description, '')
             ORDER BY MAX(t.start_time) DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![limit], |row| {
            Ok(RecentEntry {
                project_id: row.get(0)?,
                project_name: row.get(1)?,
                project_color: row.get(2)?,
                client_id: row.get(3)?,
                client_name: row.get(4)?,
                description: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Internal helper: stops any running timer by calculating duration and setting is_running=0.
/// Must be called with the connection already locked.
/// Stops a running entry by writing its end time and duration.
///
/// `end` is the LOCAL WALL CLOCK, the form `time_entries` stores and every
/// reader of the column assumes (see `tid.rs`). `updated_at` gets its own UTC
/// instant, because the sync engine compares that column lexicographically
/// against the server's UTC `updatedAt` (`should_apply_remote`): a local clock
/// there would always read as older in Denmark, and the server would overwrite
/// every local edit on the next pull.
fn stop_running_timer(
    conn: &rusqlite::Connection,
    end: &str,
) -> Result<(), String> {
    // Find running entries
    let mut stmt = conn
        .prepare_cached("SELECT id, start_time FROM time_entries WHERE is_running = 1")
        .map_err(|e| e.to_string())?;

    let running: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for (id, start_time) in running {
        // Both sides go through the same reader, so a timer started before the
        // migration — whose start is still a UTC instant — yields the same
        // number of seconds as one started now. Parsing only RFC3339 here would
        // fail on the new local form and lose the whole duration.
        let start = crate::tid::øjeblik(&start_time)
            .ok_or_else(|| format!("Failed to parse start_time '{}'", start_time))?;
        let slut = crate::tid::øjeblik(end).ok_or_else(|| format!("Failed to parse end '{}'", end))?;
        let duration = (slut - start).max(0);

        conn.execute(
            "UPDATE time_entries SET end_time = ?1, duration = ?2, is_running = 0, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![end, duration, chrono::Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn.execute(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Acme')",
            [],
        )
        .unwrap();
        conn
    }

    /// `setup()` plus the shapes the one-way customer rule has to tell apart:
    /// a second customer with its own project, and an internal project with no
    /// customer at all ("Eget arbejde" is a real project in this product).
    fn setup_med_kunder() -> Connection {
        let conn = setup();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c2', 'Beta')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES ('p-beta', 'c2', 'Beta-site')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES ('p-eget', NULL, 'Eget arbejde')",
            [],
        )
        .unwrap();
        conn
    }

    /// Inserts a klippekort and returns its id.
    fn insert_klippekort(conn: &Connection, total: f64, used: f64) -> String {
        insert_klippekort_for(conn, "c1", total, used)
    }

    fn insert_klippekort_for(conn: &Connection, client_id: &str, total: f64, used: f64) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, status)
             VALUES (?1, ?2, 'KK', ?3, ?4, 'active')",
            rusqlite::params![id, client_id, total, used],
        )
        .unwrap();
        id
    }

    /// Inserts a client-level klippekort with the fields the auto-selection
    /// looks at.
    fn insert_kort(
        conn: &Connection,
        id: &str,
        total: f64,
        used: f64,
        expires_at: Option<&str>,
        auto_deduct: bool,
        created_at: &str,
    ) {
        conn.execute(
            "INSERT INTO klippekort (id, client_id, name, total_hours, used_hours, status,
             expires_at, auto_deduct, created_at)
             VALUES (?1, 'c1', 'KK', ?2, ?3, 'active', ?4, ?5, ?6)",
            rusqlite::params![id, total, used, expires_at, auto_deduct as i32, created_at],
        )
        .unwrap();
    }

    #[test]
    fn autovalg_springer_udloebet_opbrugt_og_slaaet_fra_over() {
        let conn = setup();
        // Det gyldige kort er det ÆLDSTE — de nyere må alle ikke vælges.
        insert_kort(&conn, "gyldigt", 10.0, 2.0, None, true, "2026-01-01 00:00:00");
        insert_kort(&conn, "udloebet", 10.0, 0.0, Some("2026-10-01"), true, "2026-09-01 00:00:00");
        insert_kort(&conn, "opbrugt", 10.0, 10.0, None, true, "2026-09-02 00:00:00");
        insert_kort(&conn, "uden-auto", 10.0, 0.0, None, false, "2026-09-03 00:00:00");

        let valgt = find_active_klippekort_on(&conn, "c1", None, "2026-10-02").map(|k| k.0);
        assert_eq!(valgt.as_deref(), Some("gyldigt"));
    }

    #[test]
    fn autovalg_tager_det_der_udloeber_foerst_og_ellers_det_aeldste() {
        let conn = setup();
        insert_kort(&conn, "uden-udloeb", 10.0, 0.0, None, true, "2026-01-01 00:00:00");
        insert_kort(&conn, "senere", 10.0, 0.0, Some("2026-12-31"), true, "2026-02-01 00:00:00");
        insert_kort(&conn, "foerst-ny", 10.0, 0.0, Some("2026-11-30"), true, "2026-03-01 00:00:00");
        insert_kort(&conn, "foerst-gl", 10.0, 0.0, Some("2026-11-30"), true, "2026-02-15 00:00:00");

        let valgt = find_active_klippekort_on(&conn, "c1", None, "2026-10-02").map(|k| k.0);
        assert_eq!(valgt.as_deref(), Some("foerst-gl"), "udløber først, ved samme udløb FIFO");

        // Et kort gælder hele sin udløbsdag.
        let valgt = find_active_klippekort_on(&conn, "c1", None, "2026-11-30").map(|k| k.0);
        assert_eq!(valgt.as_deref(), Some("foerst-gl"));
        let valgt = find_active_klippekort_on(&conn, "c1", None, "2026-12-01").map(|k| k.0);
        assert_eq!(valgt.as_deref(), Some("senere"));
    }

    #[test]
    fn autovalg_uden_gyldige_kort_giver_intet_kort() {
        let conn = setup();
        insert_kort(&conn, "udloebet", 10.0, 0.0, Some("2026-01-01"), true, "2026-01-01 00:00:00");
        assert!(find_active_klippekort_on(&conn, "c1", None, "2026-10-02").is_none());
    }

    #[test]
    fn afvist_klippekort_tages_af_posten_og_timerne_gives_tilbage() {
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);
        insert_entry(&conn, "e1", &kid, 7200);
        auto_deduct_klippekort(&conn, "e1", &kid, 2.0).unwrap();

        assert!(fjern_afvist_klippekort(&conn, "e1").unwrap());

        let (link, fratrukket): (Option<String>, f64) = conn
            .query_row(
                "SELECT klippekort_id, klippekort_deducted_hours FROM time_entries WHERE id = 'e1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(link, None);
        assert_eq!(fratrukket, 0.0);
        let brugt: f64 = conn
            .query_row("SELECT used_hours FROM klippekort WHERE id = ?1", [&kid], |r| r.get(0))
            .unwrap();
        assert_eq!(brugt, 0.0, "de lokalt trukne timer skal tilbage på kortet");

        // Igen: intet kort at tage af.
        assert!(!fjern_afvist_klippekort(&conn, "e1").unwrap());
    }

    fn insert_entry(conn: &Connection, id: &str, kid: &str, duration: i64) {
        conn.execute(
            "INSERT INTO time_entries (id, client_id, klippekort_id, start_time, duration, source)
             VALUES (?1, 'c1', ?2, '2026-06-01T08:00:00Z', ?3, 'manual')",
            rusqlite::params![id, kid, duration],
        )
        .unwrap();
    }

    fn used_status(conn: &Connection, kid: &str) -> (f64, String) {
        conn.query_row(
            "SELECT used_hours, status FROM klippekort WHERE id = ?1",
            rusqlite::params![kid],
            |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?)),
        )
        .unwrap()
    }

    fn recorded_deduction(conn: &Connection, entry_id: &str) -> f64 {
        conn.query_row(
            "SELECT klippekort_deducted_hours FROM time_entries WHERE id = ?1",
            rusqlite::params![entry_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Gør den følgende skrivning til `time_entries.klippekort_deducted_hours`
    /// fejle, som en låst database eller en NOT NULL ville gøre det. Bruges til
    /// at bevise, at fradraget og registreringen af det ruller tilbage sammen.
    fn blokér_deduktions_note(conn: &Connection) {
        conn.execute_batch(
            "CREATE TRIGGER no_deduction_note BEFORE UPDATE OF klippekort_deducted_hours
             ON time_entries BEGIN SELECT RAISE(ABORT, 'test: skrivningen blokeret'); END;",
        )
        .unwrap();
    }

    // --- Fix #1 / #2: deduction records exact amount, reversal restores it ---

    #[test]
    fn deduct_records_exact_amount_and_updates_used() {
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);
        insert_entry(&conn, "e1", &kid, 7200); // 2h

        auto_deduct_klippekort(&conn, "e1", &kid, 2.0).unwrap();

        let (used, status) = used_status(&conn, &kid);
        assert_eq!(used, 2.0);
        assert_eq!(status, "active");

        let recorded: f64 = conn
            .query_row(
                "SELECT klippekort_deducted_hours FROM time_entries WHERE id = 'e1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(recorded, 2.0, "entry should record exactly what was deducted");
    }

    #[test]
    fn reverse_restores_hours_and_reactivates_depleted() {
        let conn = setup();
        // Klippekort with 5h total, fully used by an 5h entry → depleted.
        let kid = insert_klippekort(&conn, 5.0, 0.0);
        insert_entry(&conn, "e1", &kid, 18000); // 5h
        auto_deduct_klippekort(&conn, "e1", &kid, 5.0).unwrap();
        assert_eq!(used_status(&conn, &kid), (5.0, "depleted".to_string()));

        // Reversing must add the hours back and flip status to active.
        reverse_klippekort_deduction(&conn, "e1").unwrap();
        assert_eq!(used_status(&conn, &kid), (0.0, "active".to_string()));

        // Recorded deduction must be cleared so a second reversal is a no-op.
        let recorded: f64 = conn
            .query_row(
                "SELECT klippekort_deducted_hours FROM time_entries WHERE id = 'e1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(recorded, 0.0);
    }

    #[test]
    fn reverse_is_idempotent() {
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 3.0);
        insert_entry(&conn, "e1", &kid, 7200);
        auto_deduct_klippekort(&conn, "e1", &kid, 2.0).unwrap();
        assert_eq!(used_status(&conn, &kid).0, 5.0);

        reverse_klippekort_deduction(&conn, "e1").unwrap();
        reverse_klippekort_deduction(&conn, "e1").unwrap(); // second call must not double-restore
        assert_eq!(used_status(&conn, &kid).0, 3.0);
    }

    #[test]
    fn reverse_on_entry_without_deduction_is_noop() {
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 4.0);
        insert_entry(&conn, "e1", &kid, 7200); // never deducted
        reverse_klippekort_deduction(&conn, "e1").unwrap();
        assert_eq!(used_status(&conn, &kid).0, 4.0);
    }

    #[test]
    fn delete_restores_klippekort_balance() {
        // Simulates the delete_time_entry flow: reverse, then delete.
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);
        insert_entry(&conn, "e1", &kid, 10800); // 3h
        auto_deduct_klippekort(&conn, "e1", &kid, 3.0).unwrap();
        assert_eq!(used_status(&conn, &kid).0, 3.0);

        reverse_klippekort_deduction(&conn, "e1").unwrap();
        conn.execute("DELETE FROM time_entries WHERE id = 'e1'", []).unwrap();

        assert_eq!(used_status(&conn, &kid).0, 0.0, "balance fully restored after delete");
    }

    #[test]
    fn edit_reverses_old_then_applies_new_deduction() {
        // Simulates update_time_entry: reverse old, re-deduct new amount.
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);
        insert_entry(&conn, "e1", &kid, 7200); // 2h
        auto_deduct_klippekort(&conn, "e1", &kid, 2.0).unwrap();
        assert_eq!(used_status(&conn, &kid).0, 2.0);

        // User edits duration to 5h.
        reverse_klippekort_deduction(&conn, "e1").unwrap();
        auto_deduct_klippekort(&conn, "e1", &kid, 5.0).unwrap();

        assert_eq!(used_status(&conn, &kid).0, 5.0, "net deduction reflects edited amount, not 2+5");
    }

    #[test]
    fn status_helper_preserves_expired() {
        assert_eq!(klippekort_status_for(1.0, 10.0, "expired"), "expired");
        assert_eq!(klippekort_status_for(1.0, 10.0, "active"), "active");
        assert_eq!(klippekort_status_for(10.0, 10.0, "active"), "depleted");
    }

    // --- Fradrag og tilbageførsel er atomiske: de rækker, der hører sammen,
    // kan ikke overleve hinanden ---

    #[test]
    fn fradrag_der_ikke_kan_noteres_paa_registreringen_ruller_tilbage() {
        // Uden transaktionen ville klippekortet stå fratrukket, mens
        // tidsregistreringen vidste intet om fradraget. Den kan så aldrig gives
        // tilbage igen, og brugerens betalte timer er væk for altid.
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);
        insert_entry(&conn, "e1", &kid, 7200);
        blokér_deduktions_note(&conn);

        auto_deduct_klippekort(&conn, "e1", &kid, 2.0)
            .expect_err("registreringen kan ikke opdateres, så fradraget må ikke stå alene");

        assert_eq!(
            used_status(&conn, &kid).0,
            0.0,
            "klippekortet må ikke være fratrukket, når registreringen ikke fik fradraget noteret"
        );
    }

    #[test]
    fn tilbageførsel_der_ikke_kan_noteres_på_registreringen_ruller_tilbage() {
        // Modsat fejl: timerne var givet tilbage, men registreringen mente
        // stadig at have fratrukket dem. Den næste redigering ville så give
        // brugeren de samme timer til igen.
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);
        insert_entry(&conn, "e1", &kid, 7200);
        auto_deduct_klippekort(&conn, "e1", &kid, 2.0).unwrap();
        assert_eq!(used_status(&conn, &kid).0, 2.0);
        blokér_deduktions_note(&conn);

        reverse_klippekort_deduction(&conn, "e1")
            .expect_err("nulstillingen af registreringen fejler");

        assert_eq!(
            used_status(&conn, &kid).0,
            2.0,
            "timerne må ikke gives tilbage, hvis registreringen stadig står med fradraget"
        );
        assert_eq!(
            recorded_deduction(&conn, "e1"),
            2.0,
            "registreringen skal stadig kunne huske, hvad der blev fratrukket"
        );
    }

    #[test]
    fn et_fejlet_tilbageførsel_forlader_ingen_synkloglinje() {
        // Synk-køen er den eneste vej til skyen. En klippekort-ændring, der
        // rullede tilbage, må ikke efterlade en linje, der ser ud som om
        // klippekortet faktisk blev ændret — ellers sender skyen en ændring,
        // der aldrig skete.
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);
        insert_entry(&conn, "e1", &kid, 7200);
        auto_deduct_klippekort(&conn, "e1", &kid, 2.0).unwrap();

        let linjer_før: i64 = conn
            .query_row("SELECT COUNT(*) FROM sync_log", [], |r| r.get(0))
            .unwrap();
        blokér_deduktions_note(&conn);

        let _ = reverse_klippekort_deduction(&conn, "e1");

        let linjer_efter: i64 = conn
            .query_row("SELECT COUNT(*) FROM sync_log", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            linjer_efter, linjer_før,
            "en tilbageførsel, der rullede tilbage, må ikke efterlade en linje i synk-køen"
        );
    }

    #[test]
    fn fradrag_kan_køre_indeni_en_allerede_åbnet_transaktion() {
        // Kalderne (kalender, inaktivitet, timer) kan en dag åbne en transaktion
        // omkring hele handlingen. En indlejret BEGIN ville fejle dér, og så
        // ville fradraget aldrig ske — uden at nogen mærkede det.
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);
        insert_entry(&conn, "e1", &kid, 7200);

        let tx = conn.unchecked_transaction().expect("ydre transaktion");
        auto_deduct_klippekort(&tx, "e1", &kid, 2.0).expect("fradrag i ydre transaktion");
        assert_eq!(used_status(&tx, &kid).0, 2.0);
        tx.commit().expect("commit");

        assert_eq!(used_status(&conn, &kid).0, 2.0);
        assert_eq!(recorded_deduction(&conn, "e1"), 2.0);
    }

    // --- Omvendt registrering: end før start ---

    #[test]
    fn omvendt_naiv_tid_afvises() {
        // Den manuelle formular bygger naive lokale væg-tid.
        assert!(tjek_ved_start("2026-09-30T22:00:00", Some("2026-09-30T02:00:00")).is_err());
    }

    #[test]
    fn omvendt_utc_instans_afvises() {
        // Timeren og auto-trackeren skriver rigtige UTC-instanser.
        assert!(tjek_ved_start("2026-09-30T20:00:00+00:00", Some("2026-09-30T01:00:00+00:00")).is_err());
    }

    #[test]
    fn nattskift_pa_naiv_tid_er_gyldigt() {
        // Det er denne formularen nu skriver: slutningen er rullet til næste
        // dag, så den ligger AFTER starttidspunktet og skal gemmes.
        tjek_ved_start("2026-09-30T22:00:00", Some("2026-10-01T02:00:00"))
            .expect("et nattskift er en gyldig registrering");
    }

    #[test]
    fn ligelige_tidspunkter_er_gyldige() {
        // Hele dages kalenderbegivenheder konverteres med varighed None og
        // start = slut. De skal stadig kunne registreres.
        tjek_ved_start("2026-09-30T00:00:00", Some("2026-09-30T00:00:00"))
            .expect("en hel dags begivenhed har ingen varighed, men er gyldig");
    }

    #[test]
    fn en_løbende_registrering_har_ingen_slut_endnu() {
        // `end_time` er NULL, mens timeren kører. Ingen sammenligning, ingen fejl.
        tjek_ved_start("2026-09-30T22:00:00", None).expect("en løbende registrering er gyldig");
    }

    #[test]
    fn et_ulæseligt_format_afvises_ikke_på_et_gæt() {
        // Et format vi ikke genkender (fx en rå tidsstempel-streng fra en
        // gammel import) må ikke blive til en afvisning: brugerens data skal
        // kunne reddes, ikke låses.
        tjek_ved_start("2026-09-30 22:00", Some("2026-09-30 02:00"))
            .expect("et ukendt format må ikke låse data");
        tjek_ved_start("2026-09-30T22:00:00", Some("senere")).expect("et ukendt slutformat");
    }

    #[test]
    fn blandede_formater_sammenlignes_ikke() {
        // En UTC-instant og en væg-tid uden offset er ikke det samme slags
        // tal. 01:00 UTC er 03:00 lokal (CEST) — efter 22:00 lokal, altså
        // gyldigt. At afvise det ville låse en gyldig registrering.
        tjek_ved_start("2026-09-30T22:00:00", Some("2026-09-30T01:00:00+00:00"))
            .expect("blandede formater må ikke sammenlignes som om de var ens");
    }

    #[test]
    fn opret_afviser_omvendt_registrering_uden_at_røre_klippekortet() {
        // Beviser, at tjekket sidder i den fælles creationskerne — og at det
        // fanger en klippekort, der ellers ville have fået timer tilbage.
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 4.0);

        let input = CreateTimeEntryInput {
            project_id: None,
            client_id: Some("c1".to_string()),
            klippekort_id: None,
            description: None,
            start_time: "2026-09-30T22:00:00".to_string(),
            end_time: Some("2026-09-30T02:00:00".to_string()),
            duration: Some(-72000),
            is_billable: Some(true),
            pomodoro_session_id: None,
        };

        let fejl = match create_time_entry_inner(&conn, &input) {
            Ok(_) => panic!("omvendt registrering skal afvises"),
            Err(e) => e,
        };
        assert_eq!(fejl, crate::i18n::t("timeEntry.endBeforeStart"));

        assert_eq!(
            used_status(&conn, &kid).0,
            4.0,
            "klippekortet må ikke have fået timer tilbage af en afvist registrering"
        );
        let antal: i64 = conn
            .query_row("SELECT COUNT(*) FROM time_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(antal, 0, "der må ikke skrives en halv registrering");
    }

    #[test]
    fn opret_gemmer_nattskift_med_rigtig_varighed() {
        // Den positive side af sammevej: det formularen nu sender skal
        // gemmes, og klippekortet skal trækkes de rigtige fire timer.
        let conn = setup();
        let kid = insert_klippekort(&conn, 10.0, 0.0);

        let input = CreateTimeEntryInput {
            project_id: None,
            client_id: Some("c1".to_string()),
            klippekort_id: None,
            description: None,
            start_time: "2026-09-30T22:00:00".to_string(),
            end_time: Some("2026-10-01T02:00:00".to_string()),
            duration: Some(14400),
            is_billable: Some(true),
            pomodoro_session_id: None,
        };

        let (entry, _) = create_time_entry_inner(&conn, &input).expect("nattskift gemmes");
        assert_eq!(entry.end_time.as_deref(), Some("2026-10-01T02:00:00"));
        assert_eq!(entry.duration, Some(14400));
        assert_eq!(entry.klippekort_id.as_deref(), Some(kid.as_str()));
        assert_eq!(used_status(&conn, &kid).0, 4.0, "fire timer skal fratrækkes");
    }

    // --- Kunden følger projektet én vej, i hver skrivevej af en registrering ---
    //
    // `create_time_entry`, `start_timer` og `update_time_entry` er publicerede
    // kommandoer: parret (projekt, kunde) de får er uverificeret input, og
    // klippekort-opslaget følger den kunde. Uden opløsningen i backenden kan et
    // kald sende «Eget arbejde» (intet kunde) sammen med en kunde fra en tidligere
    // valg, og så bruger det kundens eget klippekort på et internt projekt.

    fn input_for(project_id: Option<&str>, client_id: Option<&str>) -> CreateTimeEntryInput {
        CreateTimeEntryInput {
            project_id: project_id.map(str::to_string),
            client_id: client_id.map(str::to_string),
            klippekort_id: None,
            description: None,
            start_time: "2026-09-30T09:00:00".to_string(),
            end_time: Some("2026-09-30T11:00:00".to_string()),
            duration: Some(7200),
            is_billable: Some(true),
            pomodoro_session_id: None,
        }
    }

    #[test]
    fn opret_tørrer_kunden_på_eget_arbejde_og_trækker_intet_klippekort() {
        // Dette er pengescenariet: en kunde der brugte klippekort på «Eget
        // arbejde». Registreringen skal hverken navngive hende eller trække på
        // hendes kort — `find_active_klippekort`s fallback er præcis det, der
        // ellers gjorde det.
        let conn = setup_med_kunder();
        let kid = insert_klippekort(&conn, 10.0, 4.0);

        let input = input_for(Some("p-eget"), Some("c1"));
        let (entry, _) = create_time_entry_inner(&conn, &input).expect("registreringen gemmes");

        assert_eq!(
            entry.client_id, None,
            "«Eget arbejde» har ingen kunde, så arver den ikke en fra kaldet"
        );
        assert_eq!(entry.klippekort_id, None, "intet klippekort at trække på");
        assert_eq!(
            used_status(&conn, &kid).0,
            4.0,
            "Kunde Acmes forudbetalte timer må ikke bruges på et internt projekt"
        );
    }

    #[test]
    fn opret_lader_projektets_egen_kunde_vinde_over_den_sendte() {
        let conn = setup_med_kunder();
        let c1_kort = insert_klippekort(&conn, 10.0, 4.0);
        let c2_kort = insert_klippekort_for(&conn, "c2", 10.0, 1.0);

        let input = input_for(Some("p-beta"), Some("c1"));
        let (entry, _) = create_time_entry_inner(&conn, &input).expect("registreringen gemmes");

        assert_eq!(entry.client_id.as_deref(), Some("c2"), "projektet ejer sin kunde");
        assert_eq!(
            entry.klippekort_id.as_deref(),
            Some(c2_kort.as_str()),
            "fradraget skal følge det projekt, der blev valgt"
        );
        assert_eq!(used_status(&conn, &c1_kort).0, 4.0, "Acmes klippekort er urørt");
        assert_eq!(used_status(&conn, &c2_kort).0, 3.0, "Betas klippekort er brugt");
    }

    #[test]
    fn opret_beholder_kunden_når_intet_projekt_er_valgt() {
        // Den anden side af den én-vejs regel: «Acme, intet projekt» er
        // rigtig, fakturerbar tid, så opløsningen må ikke rydde den.
        let conn = setup_med_kunder();
        let kid = insert_klippekort(&conn, 10.0, 0.0);

        let input = input_for(None, Some("c1"));
        let (entry, _) = create_time_entry_inner(&conn, &input).expect("registreringen gemmes");

        assert_eq!(entry.client_id.as_deref(), Some("c1"));
        assert_eq!(entry.klippekort_id.as_deref(), Some(kid.as_str()));
        assert_eq!(used_status(&conn, &kid).0, 2.0);
    }

    #[test]
    fn opret_giver_ingen_kunde_for_et_projekt_der_ikke_findes() {
        // Et `project_id` på et slettet projekt kan ikke gemmes (foreign key),
        // så kunden kan ikke nå at blive faktureret for det. Bevises her, fordi
        // opløsningen sker FØR indsættelsen: den dag FK'en forsvinder, må
        // kunden stadig ikke arves med — hellere underfakturere.
        let conn = setup_med_kunder();
        let kid = insert_klippekort(&conn, 10.0, 4.0);

        let input = input_for(Some("p-væk"), Some("c1"));
        if create_time_entry_inner(&conn, &input).is_ok() {
            panic!("et slettet projekt må ikke gemmes som en registrering");
        }

        assert_eq!(
            resolve_entry_client(&conn, Some("p-væk"), Some("c1")),
            None,
            "et projekt der ikke findes må ikke arve den kunde der blev sendt med"
        );
        assert_eq!(used_status(&conn, &kid).0, 4.0);
    }

    #[test]
    fn timeren_følger_projektet_og_trækker_det_klippekort_projektet_ejer() {
        let conn = setup_med_kunder();
        let c1_kort = insert_klippekort(&conn, 10.0, 4.0);
        let c2_kort = insert_klippekort_for(&conn, "c2", 10.0, 1.0);

        let (entry, _) = start_timer_core(
            &conn,
            Some("p-beta".to_string()),
            Some("c1".to_string()),
            None,
        )
        .expect("timeren starter");

        assert!(entry.is_running);
        assert_eq!(entry.client_id.as_deref(), Some("c2"));
        assert_eq!(entry.klippekort_id.as_deref(), Some(c2_kort.as_str()));
        assert_eq!(used_status(&conn, &c1_kort).0, 4.0, "Acmes klippekort er urørt");
    }

    #[test]
    fn timeren_på_eget_arbejde_tar_ikke_kundens_klippekort() {
        let conn = setup_med_kunder();
        let kid = insert_klippekort(&conn, 10.0, 4.0);

        let (entry, _) =
            start_timer_core(&conn, Some("p-eget".to_string()), Some("c1".to_string()), None)
                .expect("timeren starter");

        assert_eq!(entry.client_id, None);
        assert_eq!(entry.klippekort_id, None);
        assert_eq!(used_status(&conn, &kid).0, 4.0);
    }

    #[test]
    fn timeren_på_en_kunde_uden_projekt_beholder_kunden() {
        let conn = setup_med_kunder();
        let kid = insert_klippekort(&conn, 10.0, 0.0);

        let (entry, _) = start_timer_core(&conn, None, Some("c1".to_string()), None)
            .expect("timeren starter");

        assert_eq!(entry.client_id.as_deref(), Some("c1"));
        assert_eq!(entry.klippekort_id.as_deref(), Some(kid.as_str()));
    }

    #[test]
    fn redigering_følger_det_nye_projekt() {
        // En redigering er det sted, hvor brugeren bevidst flytter arbejde mellem
        // to projekter, så det er her parket ofte er ældst.
        let conn = setup_med_kunder();
        let (entry, _) =
            create_time_entry_inner(&conn, &input_for(None, Some("c1"))).expect("registreringen gemmes");

        let mut redigeret = entry.clone();
        redigeret.project_id = Some("p-beta".to_string());
        redigeret.client_id = Some("c1".to_string());

        let opdateret = update_time_entry_core(&conn, &redigeret).expect("redigeringen gemmes");
        assert_eq!(opdateret.client_id.as_deref(), Some("c2"), "projektet ejer sin kunde");
        assert_eq!(opdateret.project_id.as_deref(), Some("p-beta"));
    }

    #[test]
    fn redigering_til_eget_arbejde_tørrer_kunden() {
        let conn = setup_med_kunder();
        let (entry, _) =
            create_time_entry_inner(&conn, &input_for(None, Some("c1"))).expect("registreringen gemmes");

        let mut redigeret = entry.clone();
        redigeret.project_id = Some("p-eget".to_string());

        let opdateret = update_time_entry_core(&conn, &redigeret).expect("redigeringen gemmes");
        assert_eq!(
            opdateret.client_id, None,
            "et projekt uden kunde rydder kunden i stedet for at arve den"
        );
    }

    // --- list_time_entries: dagsgrænser må ikke spise dagens sidste time ---

    /// En registrering med et lokalt naivt `start_time`, som er den form
    /// `create_time_entry` skriver.
    fn insert_på_tidspunkt(conn: &Connection, id: &str, start_time: &str) {
        conn.execute(
            "INSERT INTO time_entries (id, start_time, duration, source)
             VALUES (?1, ?2, 3600, 'manual')",
            rusqlite::params![id, start_time],
        )
        .unwrap();
    }

    fn hent(conn: &Connection, from: &str, to: &str) -> Vec<String> {
        list_time_entries_core(conn, Some(from.to_string()), Some(to.to_string()))
            .expect("opslaget lykkes")
            .into_iter()
            .map(|e| e.id)
            .collect()
    }

    #[test]
    fn dagsvisningen_finder_en_dags_registreringer() {
        // Målt fejl i hele kalenderen: `DayView` sender rå datoer
        // (`from: dateStr, to: dateStr`), og grænsen sammenlignes som tekst mod
        // et lokalt naivt `start_time`. `"2026-10-01T09:00:00" <= "2026-10-01"` er
        // falsk, så dagsvisningen viste **nul** registrerede poster — den mest
        // synlige tid i appen.
        let conn = setup();
        insert_på_tidspunkt(&conn, "e1", "2026-10-01T09:00:00");
        assert_eq!(
            hent(&conn, "2026-10-01", "2026-10-01"),
            vec!["e1".to_string()],
            "en dagsvisning skal finde dagens egne registreringer"
        );
    }

    #[test]
    fn uges_visning_beholder_den_sidste_dag() {
        // Samme årsag i `WeekView`/`MonthView`: de sender første og sidste dag
        // som rå datoer, så `"2026-10-04T09:00:00" <= "2026-10-04"` er falsk og
        // dagen tabes. Den tabte dage er typisk netop den, brugeren lige har
        // registreret tid på.
        let conn = setup();
        insert_på_tidspunkt(&conn, "foerste", "2026-09-28T09:00:00");
        insert_på_tidspunkt(&conn, "sidste", "2026-10-04T23:30:00");
        assert_eq!(
            hent(&conn, "2026-09-28", "2026-10-04"),
            vec!["sidste".to_string(), "foerste".to_string()],
            "ugevisningen skal finde poster på begge yderdage"
        );
    }

    #[test]
    fn soegningen_rammer_kun_det_anmodede_interval() {
        let conn = setup();
        insert_på_tidspunkt(&conn, "inden", "2026-10-02T12:00:00");
        insert_på_tidspunkt(&conn, "dagfoer", "2026-10-01T23:59:59");
        insert_på_tidspunkt(&conn, "dagefter", "2026-10-03T00:00:00");
        assert_eq!(
            hent(&conn, "2026-10-02", "2026-10-02"),
            vec!["inden".to_string()],
            "grænserne skal være inklusive på dagen og udelade naboerne"
        );
    }

    #[test]
    fn soegningen_accepterer_allerede_udvidede_tidspunkter() {
        // `TimeEntryList` og `WeekSummary` sender `T00:00:00`/`T23:59:59`, og
        // `EntrySelector` sender med `Z`. De skal ikke brydes af normaliseringen.
        let conn = setup();
        insert_på_tidspunkt(&conn, "e1", "2026-10-01T00:00:00");
        insert_på_tidspunkt(&conn, "e2", "2026-10-01T23:59:59");
        assert_eq!(
            hent(&conn, "2026-10-01T00:00:00", "2026-10-01T23:59:59").len(),
            2
        );
        assert_eq!(hent(&conn, "2026-10-01T00:00:00Z", "2026-10-01T23:59:59Z").len(), 2);
    }

    #[test]
    fn en_kalenderdag_ved_midnat_hoerer_til_den_dag() {
        // Registreringer kl. 00:00 og 23:59 skal begås til deres egen dag —
        // punkt 4 i kvalitetslisten: kalenderdage udledes i lokal tid, aldrig
        // via UTC på en lokal midnat.
        let conn = setup();
        insert_på_tidspunkt(&conn, "midnat", "2026-10-01T00:00:00");
        insert_på_tidspunkt(&conn, "sidste_sekund", "2026-10-01T23:59:59");
        assert_eq!(
            hent(&conn, "2026-10-01", "2026-10-01"),
            vec!["sidste_sekund".to_string(), "midnat".to_string()],
            "dagens yderste sekunder skal høre til dagen"
        );
        assert!(hent(&conn, "2026-09-30", "2026-09-30").is_empty());
    }

    #[test]
    fn redigering_uden_projekt_beholder_kunden() {
        let conn = setup_med_kunder();
        let (entry, _) =
            create_time_entry_inner(&conn, &input_for(None, Some("c1"))).expect("registreringen gemmes");

        let mut redigeret = entry.clone();
        redigeret.description = Some("Kundemøde".to_string());

        let opdateret = update_time_entry_core(&conn, &redigeret).expect("redigeringen gemmes");
        assert_eq!(opdateret.client_id.as_deref(), Some("c1"));
        assert_eq!(opdateret.description.as_deref(), Some("Kundemøde"));
    }

    // -----------------------------------------------------------------------
    // K42 — timeren bogførte registreringer på den foregående kalenderdag
    //
    // `start_timer_core` skrev `Utc::now().to_rfc3339()`, mens den manuelle
    // formular skrev (og skriver) lokal væg-tid. Alt, der læser kolonnen som
    // tekst eller med `DATE()`, regner den som væg-tid — så en registrering
    // mellem midnat og kl. 02:00 dansk havnede på dagen før. Det er en time, der
    // vises i dagsvisningen for i går, i rapporten for i går og på en faktura for
    // i går.
    //
    // Testene dømmer **kalenderdagen** og ikke klokkeslættet, for det er dagen
    // brugeren mister, og fordi et hardkodet klokkeslæt kun ville være sand på
    // én maskine.
    // -----------------------------------------------------------------------

    /// Det øjeblik, hvor en UTC-stempel-streng peger på **dagen før** her:
    /// 00:30 dansk er 22:30 UTC dagen før. Regnes frem af maskinens egen
    /// tidszone, så testen er sand overalt.
    fn i_utc_som_er_0030_i_morgen() -> (String, String) {
        let i_morgen = chrono::Local::now().date_naive() + chrono::Duration::days(1);
        let kl_0030 = i_morgen.and_hms_opt(0, 30, 0).expect("00:30 findes altid");
        let som_utc = kl_0030
            .and_local_timezone(chrono::Local)
            .earliest()
            .expect("00:00 er et gyldigt tidspunkt")
            .with_timezone(&chrono::Utc);
        (
            som_utc.format("%Y-%m-%dT%H:%M:%S%.3f+00:00").to_string(),
            i_morgen.format("%Y-%m-%d").to_string(),
        )
    }

    /// Indsætter en række i den gamle UTC-form, som timeren skrev den, og lader
    /// porten omforme den — det er præcis hvad en opdateret app gør ved en
    /// database fra før rettelsen.
    fn insert_utc_raekke(conn: &Connection, id: &str, utc_stempel: &str) {
        conn.execute(
            "INSERT INTO time_entries (id, start_time, duration, is_running, source)
             VALUES (?1, ?2, 3600, 0, 'timer')",
            rusqlite::params![id, utc_stempel],
        )
        .expect("rækken indsat");
        crate::tid::normalisér_vægurtider(conn).expect("porten kører");
    }

    #[test]
    fn timeren_skriver_lokal_vaegurtid_uden_offset() {
        let conn = setup();

        let (entry, _) = start_timer_core(&conn, None, None, Some("Næt".to_string()))
            .expect("timeren starter");

        assert!(
            !entry.start_time.contains('+') && !entry.start_time.ends_with('Z'),
            "timeren skal skrive lokal væg-tid som den manuelle formular, ikke et \
             UTC-øjeblik: {}",
            entry.start_time
        );
        // Og den skal ligge på dagens kalender, hvilket er hele pointen.
        let i_dag: String = conn
            .query_row("SELECT DATE(start_time) FROM time_entries WHERE id = ?1",
                       rusqlite::params![entry.id], |r| r.get(0))
            .expect("dagen");
        assert_eq!(
            i_dag,
            chrono::Local::now().format("%Y-%m-%d").to_string(),
            "en løbende timer skal stå på den dag den startede"
        );
    }

    /// En timer-registrering fra klokken 00:30 skal ligge i **dagsvisningen for
    /// den dag den blev startet**, ikke dagen før. Dette er den fejl brugeren
    /// faktisk så, og den er målt, ikke gættet.
    #[test]
    fn en_timeregistrering_ved_midnat_ligger_i_deres_egen_dagsvisning() {
        let conn = setup();
        let (utc_stempel, morgendagens_dato) = i_utc_som_er_0030_i_morgen();

        insert_utc_raekke(&conn, "nattetimer", &utc_stempel);

        assert_eq!(
            hent(&conn, &morgendagens_dato, &morgendagens_dato).len(),
            1,
            "timeren skal være synlig i dagsvisningen for den dag den startede \
             ({morgendagens_dato}), ikke dagen før"
        );
        assert!(
            hent(&conn, &morgendagens_dato, &morgendagens_dato)
                .iter()
                .any(|id| id == "nattetimer"),
            "det skal være nattetimeren, ikke en anden post"
        );
    }

    /// Samme registrering set gennem rapportens egen spredning. Denne SQL er den
    /// anden læser, og den fejlede med præcis samme symptom — to læsere, én
    /// skrivevej, så porten dømmer begge.
    #[test]
    fn en_timeregistrering_ved_midnat_taelles_paa_deres_egen_rapportdag() {
        let conn = setup();
        let (utc_stempel, morgendagens_dato) = i_utc_som_er_0030_i_morgen();

        insert_utc_raekke(&conn, "nattetimer", &utc_stempel);

        let dage: Vec<(String, i64)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT DATE(start_time) AS day, SUM(duration) FROM time_entries
                     WHERE duration IS NOT NULL GROUP BY day",
                )
                .expect("forberedt");
            let r = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .expect("rækker")
                .filter_map(|r| r.ok())
                .collect();
            r
        };

        assert_eq!(
            dage,
            vec![(morgendagens_dato, 3600)],
            "rapportens dagssum skal tælle timen på den dag den blev taget"
        );
    }

    /// En kalenderkonvertering må heller ikke skrive UTC ind. Den kom fra
    /// `parse_event_datetime`, som gav naive **UTC**-væg-tider for et event med
    /// offset — samme destination, anden vej.
    #[test]
    fn en_kalenderbegivenhed_med_offset_boer_paa_begivenhedens_dag() {
        let conn = setup();
        // 09:00 i morgen lokalt, leveret som UTC-instant af en kalender med offset.
        let i_morgen = chrono::Local::now().date_naive() + chrono::Duration::days(1);
        let ni_lokalt = i_morgen.and_hms_opt(9, 0, 0).expect("09:00 findes altid");
        let som_utc = ni_lokalt
            .and_local_timezone(chrono::Local)
            .earliest()
            .expect("09:00 er gyldigt")
            .with_timezone(&chrono::Utc)
            .format("%Y-%m-%dT%H:%M:%S%.3f+00:00")
            .to_string();

        let (entry, _) = create_time_entry_inner(
            &conn,
            &CreateTimeEntryInput {
                project_id: None,
                client_id: None,
                klippekort_id: None,
                description: Some("Møde".to_string()),
                start_time: som_utc,
                end_time: None,
                duration: Some(3600),
                is_billable: Some(true),
                pomodoro_session_id: None,
            },
        )
        .expect("konverteringen gemmes");

        assert_eq!(
            entry.start_time,
            ni_lokalt.format("%Y-%m-%dT%H:%M:%S").to_string(),
            "et kalenderevent skal gemmes på den dag det stod i kalenderen"
        );
    }

    /// `updated_at` er den ENE kolonne der stadig er UTC, og det er ikke et
    /// tilfælde: synken sammenligner den leksikografisk mod serverens UTC
    /// (`should_apply_remote`). Skrev den lokal væg-tid, læst den ældre end
    /// serverens i Danmark, og serveren ville overskrive **hver** lokal
    /// redigering ved næste sync.
    #[test]
    fn stop_vaeregter_at_updated_at_forbliver_utc() {
        let conn = setup();
        conn.execute(
            "INSERT INTO time_entries (id, start_time, is_running, source)
             VALUES ('t1', ?1, 1, 'timer')",
            rusqlite::params![crate::tid::nu_lokal_naiv()],
        )
        .expect("løbende registrering");

        stop_running_timer(&conn, &crate::tid::nu_lokal_naiv()).expect("stop");

        let (end, updated_at): (String, String) = conn
            .query_row(
                "SELECT end_time, updated_at FROM time_entries WHERE id = 't1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("den stoppede registrering");

        assert!(
            !end.contains('+') && !end.ends_with('Z'),
            "end_time er lokal væg-tid: {end}"
        );
        assert!(
            chrono::DateTime::parse_from_rfc3339(&updated_at).is_ok(),
            "updated_at skal være en UTC-instant, ellers taber enhver lokal \
             redigering i synken: {updated_at}"
        );
    }

    /// Varigheden ved stop er et interval i tid. Stopper man en timer hen over et
    /// skiftet mellem sommertid og vintertid, skal den stadig måle den virkelige
    /// længde — det er præcis de 23 eller 25 timer, man har arbejdet.
    #[test]
    fn en_stop_tidsskifte_giver_den_virkelige_varighed() {
        let conn = setup();
        // En løbende registrering, startet 26 timer før "nu" på tværs af et
        // muligt skifte. Vi skriver starten i den nye form, som timeren gør.
        let start = chrono::Local::now() - chrono::Duration::hours(26);
        conn.execute(
            "INSERT INTO time_entries (id, start_time, is_running, source)
             VALUES ('t1', ?1, 1, 'timer')",
            rusqlite::params![start.format("%Y-%m-%dT%H:%M:%S").to_string()],
        )
        .expect("løbende registrering");

        // Start af en ny timer stopper den gamle — det er vejen, hvor varigheden
        // beregnes.
        start_timer_core(&conn, None, None, None).expect("stop og start ny");

        let duration: Option<i64> = conn
            .query_row("SELECT duration FROM time_entries WHERE id = 't1'", [], |r| {
                r.get(0)
            })
            .expect("den stoppede registrering");

        let duration = duration.expect("den stoppede registrering har en varighed");
        assert!(
            (25 * 3600..=27 * 3600).contains(&duration),
            "26 timer er 26 timer, skifte eller ej — fick {duration} sekunder"
        );
    }

    /// Advarslen sendes som **tal**, aldrig som en sætning. Det er den hele
    /// rettelsen: den gamle kode skrev «Klippekort er 95% brugt (28.5t / 30t)»
    /// her i Rust, så en tysk bruger fik dansk med decimapunkt i en app der
    /// ellers er oversat. Porten dømmer derfor at nøglen `message` ikke er der,
    /// og at tallene er.
    ///
    /// Den dømmer *payloaden* og ikke `emit_klippekort_warning`, fordi en
    /// `tauri::AppHandle` ikke kan konstrueres i en test — en besked skrevet
    /// *uden om* payloaden ville være usynlig for porten, præcis som den
    /// `db/mod.rs`-tidstest var skrevet imod.
    #[test]
    fn advarslen_sender_tal_og_ikke_en_dansk_saetning() {
        let p = klippekort_warning_payload(&KlippekortWarning {
            used: 28.5,
            total: 30.0,
        })
        .expect("95 % er tæt nok på at advarse");

        assert_eq!(p["type"], "warning");
        assert_eq!(p["used"], 28.5);
        assert_eq!(p["total"], 30.0);
        assert!(
            p.get("message").is_none(),
            "beskeden skal bygges i frontend, der kender sproget: {p}"
        );
        // De to tal må ikke være strenge — en frontends `formatHours` ville læse
        // «28.5» i stedet for 28.5, hvilket er det samme decimapunkt-fejl bare
        // flyttet. `type` er derimod en *diskriminator* («depleted»/«warning»), så
        // den er en streng med vilje; porten ovenfor dømmer dens to værdier.
        for felt in ["used", "total"] {
            assert!(
                p[felt].is_number(),
                "{felt} er et tal, ikke en streng: {}",
                p[felt]
            );
        }
    }

    /// Tærsklen er beslutningen: et klippekort med 89 % brugt skal **ikke** afbryde,
    /// 90 % skal, og 100 % skal sige *opbrugt* og ikke *næsten opbrugt* — en
    /// bruger der læser «95 % brugt» på et kort der er helt tømt, får et forkert
    /// billede af sin egen forudbetaling.
    #[test]
    fn advarslen_taerskler_ved_90_procent_og_ved_tomt() {
        let tærskel = |brugt: f64, total: f64| {
            klippekort_warning_payload(&KlippekortWarning {
                used: brugt,
                total,
            })
        };

        assert!(
            tærskel(26.9, 30.0).is_none(),
            "89,7 % må ikke afbryde brugeren"
        );
        assert_eq!(tærskel(27.0, 30.0).expect("90 % tæller")["type"], "warning");
        assert_eq!(
            tærskel(30.0, 30.0).expect("tomt tæller")["type"],
            "depleted",
            "et helt tømt klippekort er opbrugt, ikke næsten opbrugt"
        );
        assert_eq!(
            tærskel(45.0, 30.0).expect("over brugt")["type"],
            "depleted",
            "et klippekort der er brugt ud over sin kapacitet er også opbrugt"
        );
    }

    /// Et klippekort med **nul** timer er ikke en advarsel om at det er brugt op,
    /// det er et datakort uden kapacitet. Den gamle kode delte `used >= total`
    /// uden at skelne, så den sagde «opbrugt» om et kort brugeren lige havde lavet
    /// — og procenten ville være `0/0`.
    #[test]
    fn et_klippekort_uden_kapacitet_er_ikke_et_forbrugt_klippekort() {
        let p = klippekort_warning_payload(&KlippekortWarning {
            used: 0.0,
            total: 0.0,
        });
        assert!(
            p.is_none(),
            "0 af 0 timer er ikke en udløbet forudbetaling: {p:?}"
        );
    }
}
