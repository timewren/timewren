use crate::ai::{
    self, AiConfig, ActivityForAi, ClassificationRequest, ClassificationResult, ProjectForAi,
};
use crate::db::Database;
use crate::tracker::rules::RuleEngine;
use tauri::State;

/// Classify unconfirmed activities for a given date using AI.
///
/// 1. Loads unclassified activities (is_confirmed=0 and project_id IS NULL)
/// 2. Loads all active projects for context
/// 3. Loads classification rules as text
/// 4. Loads top confirmed patterns as few-shot examples
/// 5. Calls the configured AI provider
/// 6. Updates activities in DB with AI results
#[tauri::command]
pub async fn classify_activities(
    db: State<'_, Database>,
    date: String,
) -> Result<ClassificationResult, String> {
    // Single lock acquisition for all four read queries (steps 1-4).
    // Previously this locked/unlocked the mutex 4 times — now just once.
    let (activities, projects, rules_context, patterns_context) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        // Step 1: Load unclassified activities for the date
        let from = format!("{}T00:00:00", date);
        let to = format!("{}T23:59:59", date);

        let activities = {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT id, app_name, window_title, url, git_branch, git_repo,
                            context_path, duration, started_at
                     FROM activities
                     WHERE started_at >= ?1 AND started_at <= ?2
                       AND is_confirmed = 0
                       AND project_id IS NULL
                       AND is_idle = 0
                     ORDER BY started_at ASC",
                )
                .map_err(|e| e.to_string())?;

            let rows = stmt
                .query_map(rusqlite::params![from, to], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, String>(8)?,
                    ))
                })
                .map_err(|e| e.to_string())?;

            let mut activities = Vec::new();
            for (idx, row) in rows.enumerate() {
                let (
                    id,
                    app_name,
                    window_title,
                    url,
                    git_branch,
                    git_repo,
                    context_path,
                    duration,
                    started_at,
                ) = row.map_err(|e| e.to_string())?;
                activities.push((
                    id,
                    ActivityForAi {
                        index: idx,
                        app_name: app_name.unwrap_or_default(),
                        window_title: window_title.unwrap_or_default(),
                        url,
                        git_branch,
                        git_repo,
                        context_path,
                        duration,
                        started_at,
                        session_count: None,
                    },
                ));
            }
            activities
        };

        if activities.is_empty() {
            return Ok(ClassificationResult {
                classifications: Vec::new(),
            });
        }

        // Step 1b: Deterministic pre-filter — project identity, then user rules,
        // then confirmed patterns. Anything resolvable without a model is
        // removed from the batch: the AI should only see genuinely ambiguous
        // activities, never ones a bound repo/folder/domain already answers.
        let mut remaining_activities = Vec::new();
        for (id, activity) in &activities {
            if let Some(m) = RuleEngine::classify(
                &conn,
                &activity.app_name,
                &activity.window_title,
                activity.url.as_deref(),
                activity.git_repo.as_deref(),
                activity.context_path.as_deref(),
            ) {
                conn.execute(
                    "UPDATE activities
                     SET project_id = ?1, category = ?2, confidence = ?3,
                         classification_source = ?4, classification_reason = ?5
                     WHERE id = ?6 AND is_confirmed = 0",
                    rusqlite::params![m.project_id, m.category, m.confidence, m.source, m.reason, id],
                ).map_err(|e| e.to_string())?;
            } else {
                remaining_activities.push((*id, activity.clone()));
            }
        }

        if remaining_activities.is_empty() {
            return Ok(ClassificationResult {
                classifications: Vec::new(),
            });
        }

        let activities = remaining_activities;

        // Step 2: Load all active projects
        let projects = {
            // Each project carries its identity signals (bound repos, folders,
            // domains), so the model knows what a project LOOKS like rather
            // than guessing from its name.
            let hints = crate::commands::identity::identity_hints(&conn);
            let mut stmt = conn
                .prepare_cached(
                    "SELECT p.id, p.name, c.name
                     FROM projects p
                     LEFT JOIN clients c ON p.client_id = c.id
                     WHERE p.is_archived = 0
                     ORDER BY p.name ASC",
                )
                .map_err(|e| e.to_string())?;

            let rows = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let keywords = hints.get(&id).cloned().unwrap_or_default();
                    Ok(ProjectForAi {
                        id,
                        name: row.get(1)?,
                        client_name: row.get(2)?,
                        keywords,
                    })
                })
                .map_err(|e| e.to_string())?;

            let mut projects = Vec::new();
            for row in rows {
                projects.push(row.map_err(|e| e.to_string())?);
            }
            projects
        };

        // Step 3: Load classification rules as text
        let rules_context = {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT name, condition_type, condition_op, condition_value,
                            target_project_id, target_category
                     FROM classification_rules
                     WHERE is_active = 1
                     ORDER BY priority DESC",
                )
                .map_err(|e| e.to_string())?;

            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                })
                .map_err(|e| e.to_string())?;

            let mut rules = Vec::new();
            for row in rows {
                let (name, cond_type, cond_op, cond_value, target_project, target_cat) =
                    row.map_err(|e| e.to_string())?;
                let mut desc = format!(
                    "\"{}\" — Når {} {} \"{}\"",
                    name, cond_type, cond_op, cond_value
                );
                if let Some(proj) = target_project {
                    desc.push_str(&format!(", tildel projekt {}", proj));
                }
                if let Some(cat) = target_cat {
                    desc.push_str(&format!(", kategori: {}", cat));
                }
                rules.push(desc);
            }
            rules
        };

        // Step 4: Load top confirmed patterns as few-shot examples
        let patterns_context = {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT app_name, window_title_pattern, project_id, category, confirmation_count
                     FROM confirmed_patterns
                     ORDER BY confirmation_count DESC
                     LIMIT 20",
                )
                .map_err(|e| e.to_string())?;

            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;

            let mut patterns = Vec::new();
            for row in rows {
                let (app, title, project_id, category, count) = row.map_err(|e| e.to_string())?;
                let mut desc = format!(
                    "App: {} + Titel: \"{}\" → projekt {}",
                    app.as_deref().unwrap_or("?"),
                    title.as_deref().unwrap_or("*"),
                    project_id.as_deref().unwrap_or("?"),
                );
                if let Some(cat) = category {
                    desc.push_str(&format!(", kategori: {}", cat));
                }
                desc.push_str(&format!(" (bekræftet {} gange)", count));
                patterns.push(desc);
            }
            patterns
        };

        (activities, projects, rules_context, patterns_context)
    };

    // Step 5: Load AI config
    let config = load_ai_config(&db)?;

    // Step 6: Group similar activities to reduce token usage
    let groups = ai::group_activities(&activities);

    let grouped_activities: Vec<ActivityForAi> =
        groups.iter().map(|g| g.activity.clone()).collect();

    let request = ClassificationRequest {
        activities: grouped_activities,
        projects,
        rules_context,
        patterns_context,
    };

    let mut result = ai::classify_batch(&config, &request).await?;

    // Step 6b: Reconcile the AI's classifications against the groups we sent.
    //
    // The model may (a) emit the same group index more than once and (b) omit
    // some indices entirely. Without reconciliation, duplicates double-write
    // (last write wins, silently) and omitted indices stay unclassified with no
    // record of why. We de-duplicate deterministically (first occurrence wins)
    // and explicitly mark every uncovered group as an unclassified 'unknown'.
    reconcile_classifications(&mut result.classifications, groups.len());

    // Step 7: Update all member activities of each group with AI results.
    // Only persist genuinely-classified groups (a project_id was assigned);
    // 'unknown'/uncovered groups are left untouched so they can be retried.
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        for classification in &result.classifications {
            if classification.index >= groups.len() {
                continue;
            }
            if classification.project_id.is_none() {
                // Uncovered or unclassifiable group — leave the activities as-is.
                continue;
            }
            let group = &groups[classification.index];

            for &activity_id in &group.member_ids {
                conn.execute(
                    "UPDATE activities
                     SET project_id = ?1, category = ?2, confidence = ?3,
                         classification_source = 'ai', classification_reason = ?4
                     WHERE id = ?5 AND is_confirmed = 0",
                    rusqlite::params![
                        classification.project_id,
                        classification.category,
                        classification.confidence,
                        classification.reasoning,
                        activity_id,
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(result)
}

/// Reconcile a batch of classifications against the `group_count` groups that
/// were sent to the model.
///
/// - De-duplicates repeated indices deterministically (first occurrence wins;
///   later duplicates for the same index are dropped).
/// - Drops out-of-range indices the model may have hallucinated.
/// - Appends an explicit unclassified ('unknown', no project) entry for every
///   group index the model did not cover, so callers see complete coverage.
///
/// Mutates `classifications` in place and returns the set of indices the model
/// originally covered (before uncovered entries were appended).
fn reconcile_classifications(
    classifications: &mut Vec<ai::ClassifiedActivity>,
    group_count: usize,
) -> std::collections::HashSet<usize> {
    let mut seen: std::collections::HashSet<usize> = std::collections::HashSet::new();
    let mut deduped: Vec<ai::ClassifiedActivity> = Vec::with_capacity(classifications.len());

    for c in classifications.drain(..) {
        if c.index >= group_count {
            continue; // hallucinated / out-of-range index
        }
        if seen.insert(c.index) {
            deduped.push(c); // first occurrence wins
        }
        // else: duplicate index — drop it
    }

    let covered = seen.clone();

    // Mark every uncovered group explicitly as unclassified.
    for index in 0..group_count {
        if !covered.contains(&index) {
            deduped.push(ai::ClassifiedActivity {
                index,
                project_id: None,
                project_name: None,
                category: "unknown".to_string(),
                confidence: 0.0,
                billable: false,
                reasoning: "Ikke klassificeret af AI".to_string(),
            });
        }
    }

    deduped.sort_by_key(|c| c.index);
    *classifications = deduped;

    covered
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classified(index: usize, project: Option<&str>) -> ai::ClassifiedActivity {
        ai::ClassifiedActivity {
            index,
            project_id: project.map(str::to_string),
            project_name: None,
            category: "work".to_string(),
            confidence: 0.9,
            billable: true,
            reasoning: "r".to_string(),
        }
    }

    #[test]
    fn uncovered_indices_marked_unknown() {
        // Model only answered for group 0; groups 1 and 2 were omitted.
        let mut classifications = vec![classified(0, Some("p1"))];
        let covered = reconcile_classifications(&mut classifications, 3);

        assert_eq!(covered.len(), 1);
        assert!(covered.contains(&0));
        // Now all 3 indices are present, sorted.
        assert_eq!(classifications.len(), 3);
        assert_eq!(classifications[0].index, 0);
        assert_eq!(classifications[0].project_id.as_deref(), Some("p1"));
        for i in [1usize, 2] {
            assert_eq!(classifications[i].index, i);
            assert!(classifications[i].project_id.is_none());
            assert_eq!(classifications[i].category, "unknown");
        }
    }

    #[test]
    fn duplicate_indices_deduped_first_wins() {
        // Model emitted index 0 twice with different projects.
        let mut classifications =
            vec![classified(0, Some("first")), classified(0, Some("second"))];
        reconcile_classifications(&mut classifications, 1);

        assert_eq!(classifications.len(), 1);
        assert_eq!(classifications[0].project_id.as_deref(), Some("first"));
    }

    #[test]
    fn out_of_range_indices_dropped() {
        let mut classifications = vec![classified(5, Some("p"))];
        let covered = reconcile_classifications(&mut classifications, 2);

        assert!(covered.is_empty());
        // Index 5 dropped; groups 0 and 1 marked unknown.
        assert_eq!(classifications.len(), 2);
        assert!(classifications.iter().all(|c| c.project_id.is_none()));
    }

    #[test]
    fn full_coverage_unchanged() {
        let mut classifications = vec![classified(0, Some("a")), classified(1, Some("b"))];
        let covered = reconcile_classifications(&mut classifications, 2);

        assert_eq!(covered.len(), 2);
        assert_eq!(classifications.len(), 2);
        assert_eq!(classifications[0].project_id.as_deref(), Some("a"));
        assert_eq!(classifications[1].project_id.as_deref(), Some("b"));
    }

    // ---- Nøglen i nøgleringen, resten af configen i databasen ------------

    /// `Database` er to pub-felter, så en test kan selv bygge en — det er
    /// hele grunden til at `set_ai_config_core` tager `&Database` og ikke
    /// `&Connection`: rækkefølgen skal ligge i kode testen kan nå.
    fn db() -> Database {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .expect("settings-tabel");
        Database {
            conn: std::sync::Mutex::new(conn),
            recovery: std::sync::Mutex::new(None),
        }
    }

    /// Kører noget mod `db`s egen forbindelse. Samme database hele vejen —
    /// en test der skriver gennem `db` og læser gennem en anden forbindelse
    /// ville dømme en tom klump.
    fn med_conn<T>(db: &Database, f: impl FnOnce(&rusqlite::Connection) -> T) -> T {
        let conn = db.conn.lock().expect("lås");
        f(&conn)
    }

    fn gemt_klump(db: &Database) -> String {
        med_conn(db, |c| {
            c.query_row(
                "SELECT value FROM settings WHERE key = 'ai_config'",
                [],
                |r| r.get::<_, String>(0),
            )
            .expect("klump")
        })
    }

    fn læst_klump(db: &Database) -> serde_json::Value {
        serde_json::from_str(&gemt_klump(db)).expect("gyldig JSON")
    }

    fn læs(db: &Database) -> AiConfig {
        med_conn(db, load_ai_config_core).expect("læs")
    }

    fn config(nøgle: Option<&str>) -> AiConfig {
        AiConfig {
            provider: "anthropic".to_string(),
            api_key: nøgle.map(str::to_string),
            model: Some("claude-haiku-4-5-20251001".to_string()),
            base_url: None,
        }
    }

    /// En database fra den forrige version: nøglen i klartekst i klumpen.
    fn db_med_klartekst_noegle() -> Database {
        let db = db();
        med_conn(&db, |c| {
            c.execute(
                "INSERT INTO settings (key, value) VALUES ('ai_config', ?1)",
                rusqlite::params![r#"{"provider":"openai","api_key":"sk-klartekst"}"#],
            )
            .expect("klump");
        });
        db
    }

    /// Hele aftalen: nøglen i nøgleringen, resten i klumpen — og brugeren
    /// hæver ingen forskel, fordi `get_ai_config` sætter den tilbage.
    #[test]
    fn noeglen_gaar_i_noegleringen_og_kommer_tilbage() {
        let _butik = crate::secrets::brug_mock_butik();
        let db = db();

        set_ai_config_core(&db, config(Some("sk-antik"))).expect("gem");

        assert_eq!(
            crate::secrets::hent(crate::secrets::AI_NØGLE).unwrap().as_deref(),
            Some("sk-antik")
        );
        // Dømmer på den rå streng, ikke på felterne: det er FILEN, der skal
        // være fri for nøglen. Et `api_key: null` er ikke en nøgle.
        let rå = gemt_klump(&db);
        assert!(
            !rå.contains("sk-antik"),
            "nøglen må ikke ligge i klumpen: {}",
            rå
        );
        let klump = læst_klump(&db);
        assert!(klump["api_key"].is_null());
        assert_eq!(klump["provider"], "anthropic");
        assert_eq!(klump["model"], "claude-haiku-4-5-20251001");

        let læst = læs(&db);
        assert_eq!(læst.api_key.as_deref(), Some("sk-antik"));
        assert_eq!(læst.provider, "anthropic");
        assert_eq!(læst.model.as_deref(), Some("claude-haiku-4-5-20251001"));
    }

    /// Brugeren tømmer feltet. Nøglen skal så væk — ellers kommer den tilbage
    /// næste gang configen læses, fordi nøgleringen stadig har den.
    #[test]
    fn en_tom_noegle_sletter_noeglen_i_noegleringen() {
        let _butik = crate::secrets::brug_mock_butik();
        let db = db();
        set_ai_config_core(&db, config(Some("sk-antik"))).expect("gem");

        set_ai_config_core(&db, config(None)).expect("ryd");

        assert_eq!(crate::secrets::hent(crate::secrets::AI_NØGLE).unwrap(), None);
        assert_eq!(læs(&db).api_key, None);
    }

    /// Det samme med et felt der kun består af mellemrum — UI'et sender sådan
    /// et, hvis brugeren har indsat et mellemrum og slettet resten.
    #[test]
    fn en_noegle_af_mellemrum_er_ingen_noegle() {
        let _butik = crate::secrets::brug_mock_butik();
        let db = db();
        set_ai_config_core(&db, config(Some("sk-antik"))).expect("gem");

        set_ai_config_core(&db, config(Some("   "))).expect("ryd");

        assert_eq!(crate::secrets::hent(crate::secrets::AI_NØGLE).unwrap(), None);
        assert_eq!(læs(&db).api_key, None);
    }

    /// Uden nøgleringen (eller med en låst) må brugeren ikke miste nøglen: en
    /// afvisning returnerer en fejl, og klumpen røres IKKE — ellers lå den nye
    /// model i databasen sammen med den gamle nøgle i nøgleringen, og de to
    /// hang ikke sammen.
    ///
    /// Testen kalder `set_ai_config_core` og ikke de to halvdele: det er
    /// RÆKKEFØLGEN der skal dømmes, og den ligger i kernen. En test der kun
    /// dømmer `gem_nøgle_til_noeglering` er grøn også når kommandoen skriver
    /// klumpen alligevel — det blev målt som en falsk grøn.
    #[test]
    fn en_noeglering_der_siger_nej_rydder_ikke_configen_vande() {
        let butik = crate::secrets::brug_mock_butik();
        let db = db();
        set_ai_config_core(&db, config(Some("sk-antik"))).expect("gem");

        let post = butik
            .build("dk.timetrack.desktop", crate::secrets::AI_NØGLE, None)
            .expect("byg post");
        let cred: &keyring_core::mock::Cred = post.as_any().downcast_ref().expect("mock-cred");
        cred.set_error(keyring_core::Error::PlatformFailure(Box::new(
            std::io::Error::other("nøgleringen er låst"),
        )));

        // Rettelsen returnerer en fejl, så UI'et viser at gemningen mislykkedes.
        // Den nye config har en ANDEN model end den gamme: ellers kan testen
        // ikke se, om klumpen nu er blevet skrevet — den mutation hvor
        // rækkefølgen er omvendt, gav en grøn test.
        let mut ny = config(Some("sk-anden"));
        ny.model = Some("gpt-4o-mini".to_string());
        assert!(set_ai_config_core(&db, ny).is_err());

        // Klumpen er urørt: den nye nøgle står ingen steder, og den gamle
        // model står stadig, så brugeren kan fortsætte med det der virkede.
        let rå = gemt_klump(&db);
        assert!(
            !rå.contains("sk-anden"),
            "den nye nøgle må ikke være gemt: {}",
            rå
        );
        assert_eq!(læst_klump(&db)["model"], "claude-haiku-4-5-20251001");
        assert_eq!(læst_klump(&db)["provider"], "anthropic");
    }

    /// Læsning skal aldrig fejle, fordi nøgleringen er låst. En låst nøglering
    /// er ikke en grund til at stoppe klassificeringen — så længe nøglen står
    /// i klumpen (fra før migrationen, eller fra en gammel backup), bruges den.
    #[test]
    fn en_laast_noeglering_giver_ikke_en_fejl_til_brugeren() {
        let butik = crate::secrets::brug_mock_butik();
        let db = db_med_klartekst_noegle();

        let post = butik
            .build("dk.timetrack.desktop", crate::secrets::AI_NØGLE, None)
            .expect("byg post");
        let cred: &keyring_core::mock::Cred = post.as_any().downcast_ref().expect("mock-cred");
        cred.set_error(keyring_core::Error::PlatformFailure(Box::new(
            std::io::Error::other("nøgleringen er låst"),
        )));

        assert_eq!(læs(&db).api_key.as_deref(), Some("sk-klartekst"));
    }

    /// Nøgleringen slår klumpen. Den er skrevet med vilje; klumpen kan komme
    /// fra en backup der er lagt ind efter.
    #[test]
    fn noegleringen_slaar_klumpen_ved_laesning() {
        let _butik = crate::secrets::brug_mock_butik();
        let db = db_med_klartekst_noegle();
        crate::secrets::gem(crate::secrets::AI_NØGLE, "sk-nyeste").expect("gem");

        assert_eq!(læs(&db).api_key.as_deref(), Some("sk-nyeste"));
    }

    /// Skift af udbyder må ikke miste nøglen. Den ligger i nøgleringen uanset
    /// hvilken udbyder der er valgt, så brugeren kan komme tilbage.
    #[test]
    fn skift_af_udbyder_beholder_noeglen() {
        let _butik = crate::secrets::brug_mock_butik();
        let db = db();
        set_ai_config_core(&db, config(Some("sk-antik"))).expect("gem");

        let mut skiftet = config(Some("sk-antik"));
        skiftet.provider = "openai".to_string();
        skiftet.model = Some("gpt-4o-mini".to_string());
        set_ai_config_core(&db, skiftet).expect("gem");

        let læst = læs(&db);
        assert_eq!(læst.provider, "openai");
        assert_eq!(læst.api_key.as_deref(), Some("sk-antik"));
    }

    /// Uden nogen config overhovedet: standard-config, ingen nøgle. Det er
    /// den vej onboarding starter på, så den må ikke fejle.
    #[test]
    fn uden_config_og_uden_noegle_kommer_der_en_standard() {
        let _butik = crate::secrets::brug_mock_butik();
        let db = db();

        let læst = læs(&db);
        assert_eq!(læst.provider, "openai");
        assert_eq!(læst.api_key, None);
    }
}

/// Get the current AI configuration from the settings table.
#[tauri::command]
pub async fn get_ai_config(db: State<'_, Database>) -> Result<AiConfig, String> {
    load_ai_config(&db)
}

/// Save AI configuration.
///
/// Nøglen gemmes i OS' nøglering, resten af configen i `settings` — se
/// `set_ai_config_core`, som er hele logikken.
#[tauri::command]
pub async fn set_ai_config(db: State<'_, Database>, config: AiConfig) -> Result<(), String> {
    set_ai_config_core(&db, config)
}

/// Hele lagringen, i den rækkefølge der gælder. Delt uden om `State`, fordi
/// `State<'_, Database>` ikke kan konstrueres i en test — og fordi rækkefølgen
/// skal ligge i testet kode, ikke i en tauri-kommando ingen tester kan nå.
///
/// Nøgleringen skrives FØR databasen og UDEN låsen på den: en låst nøglering
/// kan få macOS til at vise en systemdialog, og den skal ikke holde alle andre
/// databasekommandoer ventende mens den. Samme rækkefølge som `set_setting`.
fn set_ai_config_core(db: &Database, config: AiConfig) -> Result<(), String> {
    gem_nøgle_til_noeglering(config.api_key.as_deref())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    gem_klump(&conn, &config)
}

/// Skriv API-nøglen i nøgleringen, eller fjern den hvis feltet er tomt.
///
/// Kaldes FØR `gem_klump`, aldrig efter: rækkefølgen er hele pointen, for en
/// nøglering der afviser skal efterlade brugeren med den config de havde, ikke
/// med en halv gemt. Derfor returneres fejlen her, og klumpen røres ikke.
fn gem_nøgle_til_noeglering(api_key: Option<&str>) -> Result<(), String> {
    match api_key.map(str::trim) {
        Some(nøgle) if !nøgle.is_empty() => {
            crate::secrets::gem(crate::secrets::AI_NØGLE, nøgle)?;
        }
        // Feltet er tomt. Nøglen skal så VÆK, ellers dukker den op igen
        // næste gang configen læses — brugeren troede den var slettet.
        _ => crate::secrets::slet(crate::secrets::AI_NØGLE)?,
    }
    Ok(())
}

/// Skriv resten af configen i `settings`-klumpen, **uden** nøglen.
///
/// `api_key` gemmes som `null`: feltet skal blive i JSON'en, så en fremtidig
/// version kan læse den, men værdien må ikke ligge i filen. Resten af klumpen
/// er ikke hemmeligt og bliver liggende, så udbyder, model og base-URL kan
/// læses og redigeres som alle andre indstillinger.
fn gem_klump(conn: &rusqlite::Connection, config: &AiConfig) -> Result<(), String> {
    let mut gemmes = config.clone();
    gemmes.api_key = None;

    let json = serde_json::to_string(&gemmes)
        .map_err(|e| format!("Failed to serialize AI config: {}", e))?;

    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('ai_config', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![json],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Test the AI connection with a simple prompt.
#[tauri::command]
pub async fn test_ai_connection(config: AiConfig) -> Result<String, String> {
    ai::test_connection(&config).await
}

/// Load AI config from the settings table. Returns a sensible default if not configured.
fn load_ai_config(db: &Database) -> Result<AiConfig, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    load_ai_config_core(&conn)
}

/// Selve læsningen, delt uden om `State` — se `set_ai_config_core`.
fn load_ai_config_core(conn: &rusqlite::Connection) -> Result<AiConfig, String> {
    let json: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'ai_config'",
            [],
            |row| row.get(0),
        )
        .ok();

    let mut config = match json {
        Some(json_str) => serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse AI config: {}", e))?,
        None => {
            // No config saved yet — return default (unconfigured)
            AiConfig {
                provider: "openai".to_string(),
                api_key: None,
                model: None,
                base_url: None,
            }
        }
    };

    // Nøglen kommer fra nøgleringen. `api_key` i klumpen er KUN et
    // tilbagefald: en låst nøglering, en opgradering der endnu ikke er
    // kørt, eller en gammel backup kan efterlade den gamle værdi liggende —
    // og så kan brugeren stadig klassificere i stedet for at få en fejl.
    if let Ok(nøgle) = crate::secrets::hent(crate::secrets::AI_NØGLE) {
        config.api_key = nøgle;
    }
    // En tom nøgle er ikke en nøgle. UI'et sender den, når feltet er
    // tømt, og så skal den ikke møde kravet om en nøgle.
    if config
        .api_key
        .as_deref()
        .is_some_and(|n| n.trim().is_empty())
    {
        config.api_key = None;
    }

    Ok(config)
}
