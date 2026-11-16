mod ai;
mod commands;
mod db;
pub mod i18n;
mod integrations;
mod license;
mod secrets;
mod sentry_setup;
mod sync;
mod tid;
mod tracker;
mod tray;
mod util;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

/// Guard to prevent overlapping auto-classify runs.
static AUTO_CLASSIFY_RUNNING: AtomicBool = AtomicBool::new(false);

/// Parse a `timetrack://auth/callback?token=...&org=...` URL and emit
/// a `deep-link-callback` event to the frontend with the extracted payload.
fn handle_deep_link_url(app: &tauri::AppHandle, url_str: &str) {
    // Only handle our auth callback path
    if !url_str.starts_with("timetrack://auth/callback") {
        return;
    }

    // Parse query params from the URL
    let query = url_str
        .split_once('?')
        .map(|(_, q)| q)
        .unwrap_or("");

    let mut token: Option<String> = None;
    let mut org_id: Option<String> = None;
    let mut email: Option<String> = None;
    let mut name: Option<String> = None;
    let mut tier: Option<String> = None;

    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            let decoded = urlencoding::decode(value)
                .unwrap_or_else(|_| value.into())
                .into_owned();
            match key {
                "token" => token = Some(decoded),
                "org" => org_id = Some(decoded),
                "email" => email = Some(decoded),
                "name" => name = Some(decoded),
                "tier" => tier = Some(decoded),
                _ => {}
            }
        }
    }

    if let Some(tok) = token {
        let payload = serde_json::json!({
            "token": tok,
            "orgId": org_id,
            "email": email,
            "name": name,
            "tier": tier,
        });
        let _ = app.emit("deep-link-callback", payload);

        // Bring the main window to the foreground
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[tauri::command]
fn set_app_language(lang: String) {
    i18n::set_language(&lang);
}

#[tauri::command]
fn get_platform() -> String {
    if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "linux") {
        "linux".to_string()
    } else {
        "unknown".to_string()
    }
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| i18n::t_fmt("update.checkFailed", &[&e.to_string()]))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version.clone(),
            body: update.body.clone(),
            date: update.date.as_ref().map(ToString::to_string),
        })),
        Ok(None) => Ok(None),
        Err(e) => {
            // Don't fail hard on update check errors — just return None
            eprintln!("Update check error: {}", e);
            Ok(None)
        }
    }
}

/// Downloads and installs the latest available update, then relaunches the app.
/// Returns an error string the frontend can surface; on success the process
/// restarts into the new version and this never returns normally.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| i18n::t_fmt("update.checkFailed", &[&e.to_string()]))?;

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => return Err(i18n::t("update.noUpdate")),
        Err(e) => return Err(i18n::t_fmt("update.checkFailed", &[&e.to_string()])),
    };

    update
        .download_and_install(|_chunk_len, _content_len| {}, || {})
        .await
        .map_err(|e| i18n::t_fmt("update.installFailed", &[&e.to_string()]))?;

    // Relaunch into the freshly installed version (never returns).
    app.restart();
}

/// Background task that runs every 15 minutes and auto-classifies unconfirmed
/// activities using the configured AI provider. Skips silently when AI is not
/// configured or when there are fewer than 5 unclassified activities.
///
/// Uses an `AtomicBool` guard to prevent overlapping runs (e.g. if an API
/// call takes longer than the 15-minute interval).
async fn auto_classify(
    db_path: &std::path::Path,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    // Mutual exclusion: skip if a previous run is still in progress
    if AUTO_CLASSIFY_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        println!("Auto-classify: spring over — forrige kørsel kører stadig");
        return Ok(());
    }

    let result = auto_classify_inner(db_path, app_handle).await;

    // Always clear the flag, even on error
    AUTO_CLASSIFY_RUNNING.store(false, Ordering::SeqCst);
    result
}

/// Inner implementation of auto_classify, separated so the caller can manage
/// the `AUTO_CLASSIFY_RUNNING` flag around this call.
async fn auto_classify_inner(
    db_path: &std::path::Path,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let conn =
        rusqlite::Connection::open(db_path).map_err(|e| format!("DB open fejl: {}", e))?;

    // 1. Load AI config from settings
    let config_json: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'ai_config'",
            [],
            |row| row.get(0),
        )
        .ok();

    let config: ai::AiConfig = match config_json {
        Some(json_str) => {
            serde_json::from_str(&json_str).map_err(|e| format!("AI config parse: {}", e))?
        }
        None => return Ok(()), // Not configured
    };

    // Skip if no API key (and not Ollama which doesn't need one)
    if config.api_key.is_none() && config.provider != "ollama" {
        return Ok(());
    }

    // 2. Count unclassified activities for today
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let from = format!("{}T00:00:00", today);
    let to = format!("{}T23:59:59", today);

    let unclassified_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM activities
             WHERE started_at >= ?1 AND started_at <= ?2
               AND is_confirmed = 0 AND project_id IS NULL AND is_idle = 0",
            rusqlite::params![from, to],
            |row| row.get(0),
        )
        .map_err(|e| format!("Count query fejl: {}", e))?;

    if unclassified_count < 2 {
        return Ok(());
    }

    // 3. Load unclassified activities (capped to prevent oversized API calls)
    let activities = {
        let mut stmt = conn
            .prepare(
                "SELECT id, app_name, window_title, url, git_branch, git_repo,
                        context_path, duration, started_at
                 FROM activities
                 WHERE started_at >= ?1 AND started_at <= ?2
                   AND is_confirmed = 0 AND project_id IS NULL AND is_idle = 0
                 ORDER BY started_at ASC
                 LIMIT 50",
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
                ai::ActivityForAi {
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
        return Ok(());
    }

    // 3b. Deterministic pre-filter — project identity, then user rules, then
    // confirmed patterns. Anything resolvable without a model never reaches the
    // AI: cheaper, faster, and exact.
    let mut remaining_activities = Vec::new();
    for (id, activity) in &activities {
        if let Some(m) = tracker::rules::RuleEngine::classify(
            &conn,
            &activity.app_name,
            &activity.window_title,
            activity.url.as_deref(),
            activity.git_repo.as_deref(),
            activity.context_path.as_deref(),
        ) {
            if let Err(e) = conn.execute(
                "UPDATE activities
                 SET project_id = ?1, client_id = ?2, category = ?3, confidence = ?4,
                     classification_source = ?5, classification_reason = ?6
                 WHERE id = ?7 AND is_confirmed = 0",
                rusqlite::params![
                    m.project_id,
                    m.client_id,
                    m.category,
                    m.confidence,
                    m.source,
                    m.reason,
                    id
                ],
            ) {
                crate::db::errors::record("kunne ikke gemme klassificeringen af en aktivitet", e);
            }
        } else {
            remaining_activities.push((*id, activity.clone()));
        }
    }

    if remaining_activities.is_empty() {
        return Ok(());
    }

    let activities = remaining_activities;

    // 4. Load projects, each carrying its identity signals (bound repos,
    //    folders and domains) so the model knows what a project actually LOOKS
    //    like instead of guessing from its name.
    let projects = {
        let hints = commands::identity::identity_hints(&conn);
        let mut stmt = conn
            .prepare(
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
                Ok(ai::ProjectForAi {
                    id,
                    name: row.get(1)?,
                    client_name: row.get(2)?,
                    keywords,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    // 5. Load classification rules
    let rules_context = {
        let mut stmt = conn
            .prepare(
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

    // 6. Load confirmed patterns
    let patterns_context = {
        let mut stmt = conn
            .prepare(
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

    // 7. Group similar activities to reduce token usage
    let groups = ai::group_activities(&activities);

    let grouped_activities: Vec<ai::ActivityForAi> =
        groups.iter().map(|g| g.activity.clone()).collect();

    let request = ai::ClassificationRequest {
        activities: grouped_activities,
        projects,
        rules_context,
        patterns_context,
    };

    let result = ai::classify_batch(&config, &request).await?;

    // 8. Update all member activities of each group with AI results
    let mut classified_count: usize = 0;
    for classification in &result.classifications {
        if classification.index >= groups.len() {
            continue;
        }
        let group = &groups[classification.index];
        classified_count += group.member_ids.len();

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

    // 9. Emit event to frontend
    if classified_count > 0 {
        let _ = app_handle.emit(
            "activities-classified",
            serde_json::json!({ "count": classified_count }),
        );
        println!(
            "Auto-classify: {} aktiviteter klassificeret ({} grupper)",
            classified_count,
            groups.len()
        );
    }

    Ok(())
}

/// Background loop that checks every 60 seconds whether the current time
/// matches the user's `review_reminder_time` setting. If there are unconfirmed
/// activities for today, sends a system notification and emits a
/// `navigate-to-timeline` event so the frontend can open the timeline.
/// Fires at most once per calendar day.
fn review_reminder_loop(db_path: std::path::PathBuf, app_handle: tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread;
    use std::time::Duration;

    // Track whether we already fired today to avoid repeated notifications
    static FIRED_TODAY: AtomicBool = AtomicBool::new(false);
    let mut last_date = String::new();

    loop {
        thread::sleep(Duration::from_secs(60));

        let now = chrono::Local::now();
        let today_str = now.format("%Y-%m-%d").to_string();

        // Reset the "fired" flag at midnight
        if today_str != last_date {
            FIRED_TODAY.store(false, Ordering::Relaxed);
            last_date = today_str.clone();
        }

        if FIRED_TODAY.load(Ordering::Relaxed) {
            continue;
        }

        // Read the review_reminder_time setting (default "17:00")
        let reminder_time = {
            let conn = match rusqlite::Connection::open(&db_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            conn.query_row(
                "SELECT value FROM settings WHERE key = 'review_reminder_time'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "17:00".to_string())
        };

        let current_time = now.format("%H:%M").to_string();
        if current_time != reminder_time {
            continue;
        }

        // Count unconfirmed activities for today
        let unconfirmed_count: i64 = {
            let conn = match rusqlite::Connection::open(&db_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let from = format!("{}T00:00:00", today_str);
            let to = format!("{}T23:59:59", today_str);
            conn.query_row(
                "SELECT COUNT(*) FROM activities WHERE started_at >= ?1 AND started_at <= ?2 AND is_confirmed = 0 AND is_idle = 0",
                rusqlite::params![from, to],
                |row| row.get(0),
            )
            .unwrap_or(0)
        };

        if unconfirmed_count == 0 {
            FIRED_TODAY.store(true, Ordering::Relaxed);
            continue;
        }

        // Send system notification
        {
            use tauri_plugin_notification::NotificationExt;
            if let Err(e) = app_handle
                .notification()
                .builder()
                .title(i18n::t("notification.reviewTitle"))
                .body(i18n::t_fmt(
                    "notification.reviewBody",
                    &[&unconfirmed_count.to_string()],
                ))
                .show()
            {
                eprintln!("Failed to send review notification: {}", e);
            }
        }

        // Emit event to navigate to timeline
        let _ = app_handle.emit("navigate-to-timeline", ());

        // Show and focus the main window
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }

        FIRED_TODAY.store(true, Ordering::Relaxed);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize Sentry for crash reporting (no PII, no performance tracing).
    // DSN is optional — the app works without it, and the user has to opt in
    // before anything is sent (see sentry_setup).
    let _sentry_guard = sentry_setup::initialiser();

    let mut builder = tauri::Builder::default();

    // Single-instance plugin must be registered first.
    // On Windows/Linux, deep links spawn a new process — the single-instance
    // plugin intercepts that and forwards the URL to the running instance.
    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_single_instance::init(|app, argv, _cwd| {
                // On Windows/Linux the deep link URL arrives as a CLI argument
                for arg in &argv {
                    if arg.starts_with("timetrack://") {
                        handle_deep_link_url(app, arg);
                    }
                }
            }),
        );

        // Launch-at-login toggle (Indstillinger → Tracking). LaunchAgent keeps
        // the mac app out of the Dock's "Open at Login" UI but works unsigned.
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Register AppUserModelId on Windows so notifications show "TimeTrack"
            // instead of inheriting the parent process name (e.g. "Windows PowerShell")
            #[cfg(target_os = "windows")]
            {
                use windows::core::HSTRING;
                use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
                let aumid = HSTRING::from("dk.timetrack.desktop");
                unsafe { let _ = SetCurrentProcessExplicitAppUserModelID(&aumid); }
            }

            let database = db::Database::new(app.handle())?;

            // Read language from settings and apply to i18n
            {
                let lang = {
                    let conn = database.conn.lock().unwrap_or_else(|p| p.into_inner());
                    conn.query_row(
                        "SELECT value FROM settings WHERE key = 'language'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap_or_else(|_| "da".to_string())
                };
                i18n::set_language(&lang);
            }

            // Cleanup old unconfirmed activities (0 = disabled)
            {
                let conn = database.conn.lock().unwrap_or_else(|p| p.into_inner());
                let retention_days: i64 = conn
                    .query_row(
                        "SELECT value FROM settings WHERE key = 'activity_retention_days'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(90);

                if retention_days > 0 {
                    match commands::tracker::cleanup_old_activities(&conn, retention_days) {
                        Ok(n) if n > 0 => println!("Startup cleanup: {} gamle aktiviteter slettet (retention: {} dage)", n, retention_days),
                        Ok(_) => {}
                        Err(e) => eprintln!("Startup cleanup fejl: {}", e),
                    }
                }
            }

            // Set up activity tracker (uses its own SQLite connection via WAL)
            let db_path = app.handle()
                .path()
                .app_data_dir()?
                .join("timetrack.db");
            let idle_notify = Arc::new(tokio::sync::Notify::new());
            let mut activity_tracker = tracker::ActivityTracker::new(db_path.clone());
            activity_tracker.set_idle_notify(Arc::clone(&idle_notify));
            // Emit `idle-return` to the frontend when the user comes back after a
            // long idle window (the "hvad lavede du?" prompt).
            activity_tracker.set_app_handle(app.handle().clone());
            activity_tracker.start();

            // Set up license manager
            let app_data_dir = app.handle()
                .path()
                .app_data_dir()?;
            let license_manager = license::LicenseManager::new(app_data_dir);

            app.manage(database);
            app.manage(activity_tracker);
            app.manage(license_manager);

            // Register deep link protocol (Windows/Linux runtime registration)
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Handle deep link on_open_url events (macOS sends events, not CLI args)
            #[cfg(target_os = "macos")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_deep_link_url(&app_handle, url.as_str());
                    }
                });
            }

            // Set up system tray
            tray::setup_tray(app.handle())?;

            // Emit app-ready event so the frontend splash screen can dismiss
            let ready_handle = app.handle().clone();
            std::thread::spawn(move || {
                // Small delay to ensure the webview has time to register its listener
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = ready_handle.emit("app-ready", ());
            });

            // Start end-of-day review reminder background task
            {
                let reminder_db_path = db_path.clone();
                let reminder_handle = app.handle().clone();
                std::thread::spawn(move || {
                    review_reminder_loop(reminder_db_path, reminder_handle);
                });
            }

            // Start auto-classification background task.
            // Triggers on: timer (every 5 min) OR when the user goes idle.
            // Uses exponential backoff on consecutive errors.
            {
                let classify_db_path = db_path.clone();
                let classify_handle = app.handle().clone();
                let classify_idle_notify = Arc::clone(&idle_notify);
                tauri::async_runtime::spawn(async move {
                    let base_interval_secs: u64 = 300; // 5 minutes
                    let max_interval_secs: u64 = 1800; // 30 minutes
                    let mut current_interval = base_interval_secs;

                    loop {
                        tokio::select! {
                            _ = tokio::time::sleep(std::time::Duration::from_secs(current_interval)) => {},
                            _ = classify_idle_notify.notified() => {},
                        }
                        match auto_classify(&classify_db_path, &classify_handle).await {
                            Ok(()) => {
                                current_interval = base_interval_secs;
                            }
                            Err(e) => {
                                eprintln!("Auto-classify fejl: {}", e);
                                current_interval =
                                    (current_interval * 2).min(max_interval_secs);
                                eprintln!(
                                    "Næste auto-classify forsøg om {} sekunder",
                                    current_interval
                                );
                            }
                        }
                    }
                });
            }

            // Register global shortcuts
            let global_shortcut = app.global_shortcut();

            // Ctrl+Shift+T → toggle timer
            let app_handle = app.handle().clone();
            global_shortcut.on_shortcut("CmdOrCtrl+Shift+T", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = app_handle.emit("toggle-timer", ());
                }
            })?;

            // Ctrl+Shift+Space → toggle tracking (pause/resume)
            let app_handle = app.handle().clone();
            global_shortcut.on_shortcut("CmdOrCtrl+Shift+Space", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = app_handle.emit("toggle-tracking", ());
                }
            })?;

            Ok(())
        })
        // Handle close-to-tray by hiding the window
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Clients
            commands::clients::list_clients,
            commands::clients::create_client,
            commands::clients::update_client,
            commands::clients::archive_client,
            // Projects
            commands::projects::list_projects,
            commands::projects::create_project,
            commands::projects::update_project,
            commands::projects::archive_project,
            commands::projects::get_over_budget_projects,
            // Time entries
            commands::time_entries::list_time_entries,
            commands::time_entries::create_time_entry,
            commands::time_entries::start_timer,
            commands::time_entries::stop_timer,
            commands::time_entries::get_running_timer,
            commands::time_entries::delete_time_entry,
            commands::time_entries::update_time_entry,
            commands::time_entries::get_recent_entries,
            // Settings
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::set_error_reporting,
            commands::settings::get_all_settings,
            // Systemnotifikation fra frontend (fx pomodoroskift)
            commands::notification::notify,
            // Tracker
            commands::tracker::start_tracking,
            commands::tracker::stop_tracking,
            commands::tracker::get_tracking_status,
            commands::tracker::list_activities,
            commands::tracker::list_activities_range,
            commands::tracker::delete_all_activities,
            // Classification rules
            commands::rules::list_rules,
            commands::rules::create_rule,
            commands::rules::update_rule,
            commands::rules::delete_rule,
            commands::rules::list_confirmed_patterns,
            commands::rules::confirm_classification,
            commands::rules::bulk_confirm_classifications,
            commands::rules::preview_rule_application,
            commands::rules::apply_rule_to_history,
            // Activity context derivation
            commands::context::derive_context_from_cmdline,
            commands::context::derive_context_from_processes,
            commands::context::get_active_context,
            commands::context::suggest_project_for_context,
            // Project identity (repo/folder/domain → project)
            commands::identity::list_project_matchers,
            commands::identity::add_project_matcher,
            commands::identity::delete_project_matcher,
            commands::identity::apply_identity_to_history,
            commands::identity::discover_unmapped_signals,
            // Privacy exclusion rules
            commands::exclusion::list_exclusion_rules,
            commands::exclusion::add_exclusion_rule,
            commands::exclusion::set_exclusion_rule_active,
            commands::exclusion::delete_exclusion_rule,
            // AI classification
            commands::ai::classify_activities,
            commands::ai::get_ai_config,
            commands::ai::set_ai_config,
            commands::ai::test_ai_connection,
            // Klippekort
            commands::klippekort::list_klippekort,
            commands::klippekort::create_klippekort,
            commands::klippekort::update_klippekort,
            commands::klippekort::get_klippekort_for_client,
            commands::klippekort::deduct_hours,
            commands::klippekort::get_low_klippekort,
            // Invoices
            commands::invoices::list_invoices,
            commands::invoices::get_invoice,
            commands::invoices::create_invoice_from_entries,
            commands::invoices::update_invoice,
            commands::invoices::add_invoice_line,
            commands::invoices::update_invoice_line,
            commands::invoices::remove_invoice_line,
            commands::invoices::delete_invoice,
            commands::invoices::finalize_invoice,
            // Auto-invoice from klippekort
            commands::auto_invoice::preview_klippekort_invoice,
            commands::auto_invoice::generate_invoice_from_klippekort,
            // Browser extension
            commands::browser::register_browser_extension,
            commands::browser::get_browser_extension_status,
            // Export
            integrations::export::export_time_entries_csv,
            integrations::export::generate_invoice_html,
            integrations::export::export_klippekort_html,
            integrations::export::export_klippekort_usage,
            integrations::export::export_vat_summary_csv,
            // Billy integration
            commands::integrations::test_billy_connection,
            commands::integrations::export_invoice_to_billy,
            // Calendar integration
            integrations::calendar::sync_calendar,
            integrations::calendar::list_calendar_events,
            integrations::calendar::list_uncovered_calendar_events,
            integrations::calendar::convert_calendar_event,
            // Return-from-idle prompt
            commands::idle::list_events_overlapping,
            commands::idle::log_idle_period,
            // Pomodoro
            commands::pomodoro::get_pomodoro_config,
            commands::pomodoro::set_pomodoro_config,
            commands::pomodoro::record_pomodoro_session,
            commands::pomodoro::get_pomodoro_stats,
            commands::pomodoro::list_pomodoro_sessions,
            // Backup
            commands::backup::export_database,
            commands::backup::import_database,
            commands::backup::get_database_info,
            // License
            commands::license::activate_license,
            commands::license::verify_license,
            commands::license::deactivate_license,
            commands::license::get_license_info,
            commands::license::check_trial_status,
            commands::license::start_trial,
            // Sync
            commands::sync::sync_login,
            commands::sync::sync_logout,
            commands::sync::sync_connect,
            commands::sync::sync_handle_callback,
            commands::sync::sync_now,
            commands::sync::sync_full,
            commands::sync::get_sync_status,
            // Reports
            commands::reports::get_report_data,
            commands::reports::get_coverage,
            commands::reports::get_vat_summary,
            commands::reports::count_unclassified_browser_activities,
            // Health
            commands::health::health_check,
            commands::health::get_database_recovery,
            // Update
            check_for_update,
            install_update,
            // Platform
            get_platform,
            // i18n
            set_app_language,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
