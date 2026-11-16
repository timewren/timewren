use crate::db::Database;
use crate::i18n;
use crate::license::machine_id;
use crate::sync::api::{AuthResponse, SyncClient};
use crate::sync::engine;
use crate::sync::web_settings;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub pushed: usize,
    pub pulled: usize,
    pub conflicts: usize,
    pub server_time: Option<String>,
    /// Rækker serveren afviste, som stadig ligger i køen og prøves igen.
    pub afvist: usize,
    /// Samme antal som en oversat sætning, klar til at vise. `None` når intet
    /// blev afvist — så er der ingenting at sige.
    pub afvisning: Option<String>,
    /// Hvor mange `sync_log`-rækker der stadig venter efter synken. Bruges
    /// i stedet for et hårdkodt 0: en afvisning efterlader rækker i køen, og en
    /// tæller der sig til 0 hver gang skjuler præcis det.
    pub i_koen: usize,
    /// Serveren afviste pushen, fordi denne version er under minimummet (HTTP
    /// 426 `CLIENT_TOO_OLD`). Rækkerne ligger stadig i køen; frontenden viser
    /// opdateringsprompten og starter updater-tjekket.
    #[serde(default)]
    pub klient_for_gammel: bool,
}

/// Den sætning synkpanelet viser, eller `None` når der intet er at sige.
///
/// En afvisning pr. række er én ting; en push der **fejler helt** (netværk, 401,
/// 500) er en anden. Den efterlader *alle* rækker i køen, men kallet svarer
/// stadig `Ok` — fordi pullen skal køre. Uden den her ville brugeren se en grøn
/// synk med `pushed: 0` og tro at tiden står på timetrack.dk.
///
/// Rækkefølgen er vilje: en helt fejlet push siger mere end «N rækker blev
/// afvist», fordi ingen af dem kom ud overhovedet.
fn afvisning_tekst(
    push_fejl: Option<String>,
    afvist: usize,
    foerste_fejl: Option<String>,
) -> Option<String> {
    if let Some(fejl) = push_fejl {
        return Some(crate::sync::api::uden_klient_markoer(&fejl));
    }
    if afvist == 0 {
        return None;
    }
    let antal = afvist.to_string();
    let tekst = foerste_fejl.unwrap_or_default();
    let nøgle = if afvist == 1 {
        "sync.pushRejectedOne"
    } else {
        "sync.pushRejectedMany"
    };
    Some(i18n::t_fmt(nøgle, &[&antal, &tekst]))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub is_logged_in: bool,
    pub user_email: Option<String>,
    pub user_name: Option<String>,
    pub tier: Option<String>,
    pub last_sync: Option<String>,
    pub pending_changes: i64,
}

/// Læs et gemt secret: først nøgleringen, og kun hvis den intet har, den
/// klartekstrække en opgradering (eller en låst nøglering) kan have ladt ligge.
fn hent_secret(conn: &std::sync::MutexGuard<'_, rusqlite::Connection>, key: &str) -> Option<String> {
    if let Some(værdi) = crate::secrets::hent(key).unwrap_or_else(|e| {
        // Nøgleringen kan være låst. Det er ikke en fejl i sig selv — så
        // læser vi videre i databasen, hvor en opgradering kan have ladt den
        // gamle værdi liggende. Uden dette ville en låst nøglering logge
        // brugeren ud i stedet for at lade dem blive logget ind.
        eprintln!("[sync] nøgleringen kunne ikke læses: {}", e);
        None
    }) {
        return Some(værdi);
    }
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

/// Build a SyncClient with the saved token (if any)
fn build_client(conn: &std::sync::MutexGuard<'_, rusqlite::Connection>) -> SyncClient {
    let mut client = SyncClient::new();

    // Load custom base URL if configured
    if let Ok(url) = conn.query_row(
        "SELECT value FROM settings WHERE key = 'sync_base_url'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        client = client.with_base_url(&url);
    }

    // Load saved token — i OS' nøglering, ikke i databasen
    if let Some(token) = hent_secret(conn, "sync_token") {
        client.set_token(token);
    }

    client
}

/// Save auth info to settings table
fn save_auth(
    conn: &std::sync::MutexGuard<'_, rusqlite::Connection>,
    token: &str,
    email: &str,
    name: &str,
    tier: &str,
) -> Result<(), String> {
    // Token først i nøgleringen. Den skrives FØR den ikke-hemmelige del, så en
    // nøglering der afviser efterlader brugeren logget ud med sit gamle token
    // intakt — og ikke med en halv gemt login.
    crate::secrets::gem("sync_token", token)?;
    conn.execute(
        "DELETE FROM settings WHERE key = 'sync_token'",
        [],
    )
    .map_err(|e| format!("Failed to clear sync_token: {}", e))?;

    let pairs = [
        ("sync_email", email),
        ("sync_name", name),
        ("sync_tier", tier),
    ];

    for (key, value) in &pairs {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )
        .map_err(|e| format!("Failed to save {}: {}", key, e))?;
    }

    Ok(())
}

/// Clear auth info from settings table
fn clear_auth(conn: &std::sync::MutexGuard<'_, rusqlite::Connection>) -> Result<(), String> {
    // Tokenet skal væk fra nøgleringen, ellers ligger det bare stadig der
    // efter logout og en fejlet nøgle-læsning ville finde det igen. En nøgle
    // der ikke findes er ikke en fejl, så en allerede logget ud bruger kan
    // logge ud igen uden at få en fejl.
    crate::secrets::slet("sync_token")?;

    let keys = [
        "sync_token",
        "sync_email",
        "sync_name",
        "sync_tier",
        "sync_last_sync",
    ];

    for key in &keys {
        conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![key],
        )
        .map_err(|e| format!("Failed to clear {}: {}", key, e))?;
    }

    Ok(())
}

/// D4: del integrationsindstillinger (Billy-nøglen, kalenderens iCal-URL) med
/// webben ved login og ved synk.
///
/// **Bevidst ikke fatalt.** Alt i denne funktion er en *indstilling*, og en
/// fejl her må aldrig stoppe en synk af tidsregistreringer eller få et login til
/// at se ud som om det mislykkedes. Derfor logger vi og går videre — brugeren
/// skal kunne se, at appen ikke gik i stykker, og det skal stå i loggen hvorfor
/// indstillingerne ikke delte.
///
/// **Ingen trafik uden flaget.** `web_settings::aktiv` er kun sand hvis
/// brugeren har slået `sync_web_indstillinger` til, og den er fra som standard.
async fn del_indstillinger(db: &Database) {
    let client = {
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[sync] kunne ikke låse databasen for indstillinger: {}", e);
                return;
            }
        };
        if !web_settings::aktiv(&conn) || !conn_is_logged_in(&conn) {
            return;
        }
        build_client(&conn)
    };

    // `None` = routen findes ikke endnu (30/9). Så sker der hverken læsning
    // eller skrivning udad: serveren har ingen sted at lægge dem.
    let svar = match client.hent_indstillinger().await {
        Ok(Some(s)) => s,
        Ok(None) => return,
        Err(e) => {
            eprintln!("[sync] kunne ikke hente indstillinger: {}", e);
            return;
        }
    };

    let ændrede = {
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[sync] kunne ikke låse databasen for indstillinger: {}", e);
                return;
            }
        };

        let filtret = match web_settings::tol_svar(Some(&svar)) {
            Some(r) => r,
            None => return,
        };

        match web_settings::gæld(&conn, &filtret) {
            Ok(b) if b.gemt + b.ryddet > 0 => eprintln!(
                "[sync] indstillinger fra web: {} gemt, {} ryddet",
                b.gemt, b.ryddet
            ),
            Ok(_) => {}
            Err(e) => {
                eprintln!("[sync] kunne ikke gemme hentede indstillinger: {}", e);
                return;
            }
        }

        // Kun en lokal værdi der *adskiller sig* fra serverens skrives
        // tilbage. Elles ville hver synk skrive vores egen gamle værdi over en
        // nyere ændring i webappen — to maskiner, der ping-pong'er. En nøgle
        // serveren eksplicit har ryddet (`value: null`) skrives aldrig
        // tilbage: den sletting skal stå.
        let ændrede: Vec<_> = web_settings::læs_lokale(&conn)
            .into_iter()
            .filter(|lokal| {
                let server = svar.iter().find(|s| s.key == lokal.key);
                match server {
                    // Ingen nøgle i svaret: serveren kender den ikke, så den
                    // lokale værdi er ny og skal op.
                    None => true,
                    // Serveren har ryddet den — slettingen skal stå.
                    Some(s) if s.value.is_none() => false,
                    Some(s) => s.value.as_deref() != lokal.value.as_deref(),
                }
            })
            .collect();

        ændrede
    };

    let ud = web_settings::byg_ud(&ændrede);
    if ud.is_empty() {
        return;
    }

    match client.gem_indstillinger(&ud).await {
        // Kun nøglenavne i loggen — `billy_api_key`s værdi er en hemmelighed.
        Ok(()) => eprintln!(
            "[sync] sendte {} indstilling{} til webben",
            ud.len(),
            if ud.len() == 1 { "" } else { "er" }
        ),
        Err(e) => eprintln!("[sync] kunne ikke sende indstillinger: {}", e),
    }
}

fn conn_is_logged_in(conn: &std::sync::MutexGuard<'_, rusqlite::Connection>) -> bool {
    hent_secret(conn, "sync_token").is_some()
}

#[tauri::command]
pub async fn sync_login(
    db: State<'_, Database>,
    email: String,
    password: String,
) -> Result<AuthResponse, String> {
    let mid = machine_id();
    let device_name = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Build client (need base_url from settings)
    let mut client = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        build_client(&conn)
    };

    let auth = client
        .login(&email, &password, &device_name, &mid)
        .await?;

    // Save credentials
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        save_auth(&conn, &auth.token, &auth.user.email, &auth.user.name, &auth.tier)?;
    }

    // D4: hent integrationsindstillingerne her, så en ny maskine ikke skal
    // have Billy-nøglen og kalenderen indstillet forfra.
    del_indstillinger(&db).await;

    Ok(auth)
}

#[tauri::command]
pub async fn sync_logout(db: State<'_, Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    clear_auth(&conn)?;
    Ok(())
}

#[tauri::command]
pub async fn sync_now(db: State<'_, Database>) -> Result<SyncResult, String> {
    // 1. Build client with saved token
    let (client, pending, last_sync) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let c = build_client(&conn);
        if !c.has_token() {
            return Err(i18n::t("sync.notLoggedIn"));
        }
        let pending = engine::collect_pending_changes(&conn);
        let last = engine::get_last_sync(&conn);
        (c, pending, last)
    };

    // The sync_log ids that fed this push. Only these may be marked synced afterwards,
    // never rows inserted into sync_log during the push round-trip.
    let collected_log_ids: Vec<i64> = pending.log_rows.iter().map(|(id, _, _)| *id).collect();

    let mut pushed = 0;
    let mut conflicts = 0;
    // Rækker serveren afviste, og som stadig mangler at komme ud. Ikke en fejl
    // der stopper synken, men noget brugeren skal kunne se — ellers vokser køen
    // i det stille, og ingen ved hvorfor.
    let mut afvist = 0usize;
    let mut afvisnings_fejl: Option<String> = None;
    // Sat når pushen fejler helt. Rækkerne bliver i køen, så uden den her
    // står brugeren med en grøn synk og `pushed: 0`.
    let mut push_fejl: Option<String> = None;

    // 2. Push pending changes
    if !pending.entities.is_empty() {
        let push_count = pending.entities.len();
        match client.push(pending.entities).await {
            Ok(push_resp) => {
                conflicts = push_resp.conflicts.len();

                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                // De afviste rækker er ikke nødvendigvis fejl: en create der
                // findes allerede under det id vi sendte er et push-svar der
                // gik tabt, ikke noget brugeren har lavet forkert (D2e).
                let udfald = engine::klassificer_push_fejl(&conn, &push_resp.errors);
                afvist = udfald.afvist;
                afvisnings_fejl = udfald.foerste_fejl;

                let mut accepteret = push_resp.accepted;
                accepteret.extend(udfald.accepteret);
                pushed = accepteret.len();

                // Atomic: map remote_ids AND mark only the accepted, collected
                // sync_log rows synced — in a single transaction.
                engine::commit_push_result(&conn, &accepteret, &collected_log_ids)?;
                // Server-wins conflict resolution: apply server_data locally and
                // clear those (collected) sync_log rows. Conflicts are NEVER touched
                // by the accepted path, so they can't be silently dropped.
                engine::resolve_conflicts(&conn, &push_resp.conflicts, &collected_log_ids)?;

                // Et klippekort serveren ikke vil trække fra (udløbet, inaktivt,
                // for få timer) må aldrig holde posten ude: kortet tages af, og
                // posten går op som almindelig tid ved næste synk.
                let mut kort_fjernet = 0usize;
                for e in &push_resp.errors {
                    let Some(local_id) = e.local_id.as_deref() else { continue };
                    if !engine::er_klippekort_afvisning(&e.entity_type, &e.error) {
                        continue;
                    }
                    match crate::commands::time_entries::fjern_afvist_klippekort(&conn, local_id) {
                        Ok(true) => kort_fjernet += 1,
                        Ok(false) => {}
                        Err(fejl) => crate::db::errors::record(
                            "kunne ikke tage et afvist klippekort af posten",
                            fejl,
                        ),
                    }
                }
                // Til Sentry (kun med samtykke, uden indhold): en afvisning
                // betyder tid der ikke når timetrack.dk. Faste beskeder, så
                // gentagelser ved hver synk samles i ét issue.
                if kort_fjernet > 0 {
                    crate::db::errors::noter(
                        "synk: klippekort taget af en post serveren afviste",
                    );
                }
                if afvist > 0 {
                    crate::db::errors::noter("synk: serveren afviste poster i push");
                }
            }
            Err(e) => {
                // Rækkerne bliver i køen — intet tømmes, intet går tabt. Men
                // kalderen skal høre om det: ellers ligner en kø der aldrig
                // tørrer en synk der bare ikke havde noget at sende.
                push_fejl = Some(e.clone());
                eprintln!(
                    "Push failed for {} entities: {}. Continuing with pull...",
                    push_count, e
                );
                // Don't abort — still try to pull
            }
        }
    }

    // 3. Pull changes since last sync
    let pull_resp = client.pull(last_sync.as_deref()).await?;
    let pulled = pull_resp.entities.len();

    // 4. Apply pulled changes. If any entity fails to apply, do NOT advance the
    //    watermark, so the failed records are re-fetched on the next pull.
    let mut apply_failed = 0;
    if !pull_resp.entities.is_empty() {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let outcome = engine::apply_remote_changes(&conn, &pull_resp.entities)?;
        apply_failed = outcome.failed;
    }

    // 5. Save last sync timestamp ONLY when every pulled entity applied cleanly.
    if apply_failed == 0 {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        engine::save_last_sync(&conn, &pull_resp.server_time)?;
    } else {
        eprintln!(
            "{} pulled entit{} failed to apply; keeping previous sync watermark so they are re-pulled next time.",
            apply_failed,
            if apply_failed == 1 { "y" } else { "ies" }
        );
    }

    // 6. D4: del integrationsindstillingerne. Sidst, og uden at kunne fejle
    // synken — tidsregistreringerne er gemt på dette tidspunkt.
    del_indstillinger(&db).await;

// Rækker der stadig ligger i køen efter synken. Synken lykkedes, så det er
    // ikke et `Err` — men brugeren skal kunne se at ikke alt kom ud, ellers står
    // `pendingChanges` på 0 mens køen i virkeligheden vokser.
    let klient_for_gammel = push_fejl
        .as_deref()
        .is_some_and(crate::sync::api::er_klient_for_gammel_fejl);
    let afvisning = afvisning_tekst(push_fejl, afvist, afvisnings_fejl);

    // Hvad der stadig ligger i køen efter alle de skrivninger ovenfor. Tælles
    // her og ikke antaget at være nul: en afvisning efterlader rækker, og det er
    // dem brugeren skal se.
    let i_koen = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        engine::pending_change_count(&conn).max(0) as usize
    };

    Ok(SyncResult {
        pushed,
        pulled,
        conflicts,
        server_time: Some(pull_resp.server_time),
        afvist,
        afvisning,
        i_koen,
        klient_for_gammel,
    })
}

#[tauri::command]
pub async fn sync_full(db: State<'_, Database>) -> Result<SyncResult, String> {
    // Build client with saved token
    let client = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let c = build_client(&conn);
        if !c.has_token() {
            return Err(i18n::t("sync.notLoggedInShort"));
        }
        c
    };

    // Full sync — pull everything
    let resp = client.full_sync().await?;
    let pulled = resp.entities.len();

    // Apply all entities and save user profile if present
    let i_koen = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let outcome = engine::apply_remote_changes(&conn, &resp.entities)?;
        // Only advance the watermark if everything applied; otherwise a later
        // incremental pull re-fetches the failed records.
        if outcome.failed == 0 {
            engine::save_last_sync(&conn, &resp.server_time)?;
        } else {
            eprintln!(
                "{} entit{} failed to apply during full sync; not advancing watermark.",
                outcome.failed,
                if outcome.failed == 1 { "y" } else { "ies" }
            );
        }

        // Save user profile data from Cloud (name, email, hourly rate, org).
        // Fejler det, ruller profil-syncen sig selv tilbage, så kalderen SKAL
        // høre om det: ellers står appen med en gammel profil og intet spor af
        // hvorfor.
        if let Some(ref profile) = resp.user_profile {
            engine::save_user_profile(&conn, profile)?;
        }

        // Fuld sync sender intet, så køen er uændret — den tælles, så tælleren
        // ikke hænger på et 0 der aldrig bliver kontrolleret igen.
        engine::pending_change_count(&conn).max(0) as usize
    };

    Ok(SyncResult {
        pushed: 0,
        pulled,
        conflicts: 0,
        server_time: Some(resp.server_time),
        afvist: 0,
        afvisning: None,
        i_koen,
        klient_for_gammel: false,
    })
}

#[tauri::command]
pub async fn get_sync_status(db: State<'_, Database>) -> Result<SyncStatus, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let token: Option<String> = hent_secret(&conn, "sync_token");

    let email: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'sync_email'",
            [],
            |row| row.get(0),
        )
        .ok();

    let name: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'sync_name'",
            [],
            |row| row.get(0),
        )
        .ok();

    let tier: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'sync_tier'",
            [],
            |row| row.get(0),
        )
        .ok();

    let last_sync = engine::get_last_sync(&conn);
    let pending_changes = engine::pending_change_count(&conn);

    Ok(SyncStatus {
        is_logged_in: token.is_some(),
        user_email: email,
        user_name: name,
        tier,
        last_sync,
        pending_changes,
    })
}

/// Open the user's default browser to the TimeTrack desktop auth page.
/// Returns the generated device code so the frontend can correlate the callback.
#[tauri::command]
pub async fn sync_connect(app: tauri::AppHandle, db: State<'_, Database>) -> Result<String, String> {
    let code = uuid::Uuid::new_v4().to_string();
    let device_name = hostname::get()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Determine base URL from settings (or default)
    let base_url = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'sync_base_url'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "https://app.timetrack.dk".to_string())
    };

    let url = format!(
        "{}/auth/desktop?code={}&deviceName={}",
        base_url.trim_end_matches('/'),
        urlencoding::encode(&code),
        urlencoding::encode(&device_name),
    );

    // Open URL in default browser via tauri-plugin-opener. Shell-pluginet
    // blev byttet ud med opener fordi `Shell::open` er deprecated — og fordi
    // shell-pluginet ellers gav appen tilladelse til at køre kommandoer, den
    // aldrig har brugt til andet end at åbne ét link.
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| i18n::t_fmt("sync.couldNotOpenBrowser", &[&e.to_string()]))?;

    Ok(code)
}

/// Handle the auth callback from the deep link.
/// Saves the token and user info, returns the sync status.
#[tauri::command]
pub async fn sync_handle_callback(
    db: State<'_, Database>,
    token: String,
    org_id: Option<String>,
    email: Option<String>,
    name: Option<String>,
    tier: Option<String>,
) -> Result<SyncStatus, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Save the token and user info
    let user_email = email.as_deref().unwrap_or("unknown");
    let user_name = name.as_deref().unwrap_or("");
    let user_tier = tier.as_deref().unwrap_or("free");

    save_auth(&conn, &token, user_email, user_name, user_tier)?;

    // Also save to user profile settings so they show up in GeneralSettings
    if !user_name.is_empty() {
        if let Err(e) = conn.execute(
            "INSERT INTO settings (key, value) VALUES ('user_name', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![user_name],
        ) {
            crate::db::errors::record("kunne ikke gemme brugerens navn", e);
        }
    }
    if user_email != "unknown" {
        if let Err(e) = conn.execute(
            "INSERT INTO settings (key, value) VALUES ('user_email', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![user_email],
        ) {
            crate::db::errors::record("kunne ikke gemme brugerens e-mail", e);
        }
    }

    // Save org ID if provided
    if let Some(ref oid) = org_id {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('sync_org_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![oid],
        )
        .map_err(|e| format!("Failed to save org_id: {}", e))?;
    }

    let last_sync = engine::get_last_sync(&conn);
    let pending_changes = engine::pending_change_count(&conn);

    Ok(SyncStatus {
        is_logged_in: true,
        user_email: Some(user_email.to_string()),
        user_name: Some(user_name.to_string()),
        tier: Some(user_tier.to_string()),
        last_sync,
        pending_changes,
    })
}

#[cfg(test)]
mod tests {
    use super::afvisning_tekst;

    #[test]
    fn en_push_der_fejler_helt_er_noeglen_til_at_tid_reaches_serveren() {
        // Kallet svarer Ok (pullen skal køre), så uden denne sætning står
        // brugeren med en grøn synk og pushed: 0 og tror tiden er sendt.
        let tekst = afvisning_tekst(Some("Push fejlede (500): Sync push failed".into()), 0, None);
        assert_eq!(
            tekst.as_deref(),
            Some("Push fejlede (500): Sync push failed"),
            "en push der fejler helt skal stå i synkpanelet, ikke i loggen"
        );
    }

    #[test]
    fn en_afvisning_pr_raekke_staar_stadig_som_sin_egen_saetning() {
        let tekst = afvisning_tekst(None, 1, Some("Ugyldigt timetal".into()));
        let sætning = tekst.expect("én afvisning skal give en sætning");
        assert!(
            sætning.contains('1') && sætning.contains("Ugyldigt timetal"),
            "afvisningen skal tælles og serverens egen tekst med: {sætning}"
        );
    }

    #[test]
    fn en_for_gammel_version_vises_uden_markoeren() {
        let fejl = crate::sync::api::klient_for_gammel_fejl();
        let tekst = afvisning_tekst(Some(fejl), 0, None).expect("afvisningen skal vises");
        assert!(
            !tekst.starts_with(crate::sync::api::KLIENT_FOR_GAMMEL),
            "markøren er til frontenden, ikke til brugeren: {tekst}"
        );
    }

    #[test]
    fn en_synk_der_lykkedes_siger_intet() {
        assert_eq!(
            afvisning_tekst(None, 0, None),
            None,
            "en grøn synk skal ikke opfinde en fejl at vise"
        );
    }

    #[test]
    fn en_helt_fejlet_push_dokumenterer_stadig_hvor_mange_raekker_der_ligger_i_koen() {
        // Køen tælles uafhængigt af sætningen — en fejl må ikke nulstille den.
        let tekst = afvisning_tekst(Some("Push fejlede (503)".into()), 3, Some("x".into()));
        assert_eq!(tekst.as_deref(), Some("Push fejlede (503)"));
    }
}
