pub mod browser_bridge;
pub mod exclusion;
pub mod git;
pub mod identity;
pub mod process_context;
pub mod rules;
pub mod title;
pub mod window;

// Platform-specific window capture
#[cfg(target_os = "windows")]
mod window_windows;
#[cfg(target_os = "macos")]
mod window_macos;

// Browser address-bar URL capture (UI Automation). Windows-only for now.
#[cfg(target_os = "windows")]
mod url_windows;

// Platform-specific idle detection
#[cfg(target_os = "windows")]
mod idle_windows;
#[cfg(target_os = "macos")]
mod idle_macos;

// Re-export the platform-specific implementations under a unified API
pub use window::WindowInfo;

/// Returns information about the currently active foreground window.
#[cfg(target_os = "windows")]
pub use window_windows::get_foreground_window_info;
#[cfg(target_os = "macos")]
pub use window_macos::get_foreground_window_info;

/// Returns the foreground window's owning process ID.
#[cfg(target_os = "windows")]
pub use window_windows::get_foreground_pid;
#[cfg(target_os = "macos")]
pub use window_macos::get_foreground_pid;

/// Returns the number of seconds since the last user input (keyboard/mouse).
#[cfg(target_os = "windows")]
pub use idle_windows::get_idle_seconds;
#[cfg(target_os = "macos")]
pub use idle_macos::get_idle_seconds;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

/// Default minimum duration (in seconds) for an activity to be stored.
/// Can be overridden via the `min_activity_duration` setting.
const DEFAULT_MIN_ACTIVITY_DURATION_SECS: i64 = 5;

/// Default idle threshold in seconds (5 minutes).
const DEFAULT_IDLE_THRESHOLD_SECS: u64 = 300;

/// Default threshold (minutes) for the "return from idle" prompt. Only idle
/// windows AT LEAST this long trigger the "hvad lavede du?" prompt on return.
/// Deliberately SEPARATE from — and longer than — `idle_threshold_minutes`:
/// the idle threshold stops tracking after a short break, but we only bother
/// the user about the gap once it is long enough to be a meeting/phone call.
const DEFAULT_IDLE_PROMPT_THRESHOLD_MINUTES: u64 = 10;

/// Poll interval in seconds.
const POLL_INTERVAL_SECS: u64 = 2;

/// Editors for which we attempt Git branch detection.
const EDITOR_EXECUTABLES: &[&str] = &[
    "code",
    "code - insiders",
    "idea64",
    "idea",
    "webstorm64",
    "webstorm",
    "phpstorm64",
    "phpstorm",
    "pycharm64",
    "pycharm",
    "goland64",
    "goland",
    "rider64",
    "rider",
    "clion64",
    "clion",
    "rustrover64",
    "rustrover",
    "datagrip",
    "sublime_text",
    "notepad++",
    "vim",
    "nvim",
    "cursor",
    "zed",
    "windsurf",
];

/// Apps whose window title does not identify the project, but whose process
/// tree does (the active shell's CWD or an agent's cmdline). For these the
/// tracker derives `context_path` so one Orca/terminal window spanning many
/// projects no longer collapses into a single mis-attributed segment.
const CONTEXT_PROVIDER_APPS: &[&str] = &[
    "orca",
    "windowsterminal",
    "openconsole",
    "wt",
    "powershell",
    "pwsh",
    "cmd",
    "conhost",
    "alacritty",
    "wezterm",
    "kitty",
    "hyper",
    "warp",
    "ghostty",
    "tmux",
    "iterm",
    "terminal",
    // Agent/CLI runners that show a CONSTANT window title (confirmed against
    // real data: "claude" ran with a single fixed title over many activities).
    // Like Orca, their only reliable project signal is the process tree's CWD.
    "claude",
    "codex",
    "aider",
    "gemini",
];

/// True if the app's project context should be derived from its process tree.
fn is_context_provider_app(app_name: &str) -> bool {
    let app_lower = app_name.to_lowercase();
    CONTEXT_PROVIDER_APPS
        .iter()
        .any(|app| app_lower.contains(app))
}

/// Browsers whose address-bar URL may be captured when the opt-in
/// `browser_url_capture` setting is enabled.
pub(crate) const BROWSER_APPS: &[&str] =
    &["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"];

/// True if the app is a known browser (matched on executable name).
fn is_browser_app(app_name: &str) -> bool {
    let app_lower = app_name.to_lowercase();
    BROWSER_APPS.iter().any(|b| app_lower.contains(b))
}

/// Default meeting-app whitelist. When one of these is the foreground app we
/// suppress idle detection (see `decide_idle`) so a long video call where the
/// user is watching/listening — not typing — is not dropped as idle time.
/// Stored as a user-editable comma/newline text list under `meeting_apps`.
const DEFAULT_MEETING_APPS: &str = "teams, zoom, meet, webex, slack call, google meet, ms teams";

/// Default upper bound (minutes) on continuous input inactivity during which the
/// meeting-app idle exception applies. Beyond this we assume the user is away
/// from keyboard even with a meeting app focused (see `decide_idle`).
const DEFAULT_MEETING_MAX_IDLE_MINUTES: u64 = 120;

/// Splits a meeting-app text list (comma- or newline-separated, same shape as
/// the `excluded_apps` textarea) into trimmed, non-empty, lowercased tokens.
fn parse_meeting_apps(raw: &str) -> Vec<String> {
    raw.split(['\n', ','])
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// True if the foreground app matches an entry on the meeting-app whitelist.
/// Case-insensitive substring match, mirroring the exclusion matcher's
/// robustness; empty/whitespace entries are ignored.
fn is_meeting_app(app_name: &str, meeting_apps: &[String]) -> bool {
    let app_lower = app_name.to_lowercase();
    meeting_apps.iter().any(|m| {
        let needle = m.trim().to_lowercase();
        !needle.is_empty() && app_lower.contains(&needle)
    })
}

/// Decides whether the current poll counts as idle — the single idle-decision
/// point for the poll loop, kept pure so it is unit-testable.
///
/// Normal rule: input inactive for at least `idle_threshold` seconds is idle.
///
/// Meeting exception: if a whitelisted meeting app (Teams/Zoom/Meet, …) is in
/// the foreground the user is likely in a video call — watching and listening,
/// not touching the keyboard — so the period is NOT marked idle and the meeting
/// segment stays alive.
///
/// AFK safeguard (billing-relevant): the exception only holds while continuous
/// input inactivity stays at or below `meeting_max_idle_secs`. A meeting app
/// left focused must never keep the tracker awake indefinitely — e.g. Teams in
/// the foreground while the user is at lunch for 3 hours must not record 3h of
/// fake meeting time. Once inactivity exceeds the cap we assume AFK and fall
/// back to normal idle logic ("fall back to normal idle on any doubt").
fn decide_idle(
    idle_secs: u64,
    idle_threshold: u64,
    foreground_app: Option<&str>,
    meeting_apps: &[String],
    meeting_max_idle_secs: u64,
) -> bool {
    // Active input below the threshold is never idle.
    if idle_secs < idle_threshold {
        return false;
    }
    // Inactive past the threshold: idle, UNLESS a meeting app is focused and we
    // are still within the AFK safeguard window.
    if idle_secs <= meeting_max_idle_secs {
        if let Some(app) = foreground_app {
            if is_meeting_app(app, meeting_apps) {
                return false;
            }
        }
    }
    true
}

/// Decides whether returning from an idle window should raise the "hvad lavede
/// du?" prompt. Kept pure so the poll loop's emit decision is unit-testable.
///
/// The prompt fires only when it is enabled, tracking is NOT manually paused,
/// and the idle window lasted at least the (separate, longer) prompt threshold.
/// The tracker's poll loop only runs while tracking is active, so `paused` is
/// `false` there today — the parameter keeps the acceptance criterion "aldrig
/// når manuelt pauset" explicit and lets a future in-loop pause flag feed in.
fn should_prompt_return(
    idle_secs: u64,
    prompt_threshold_secs: u64,
    enabled: bool,
    paused: bool,
) -> bool {
    enabled && !paused && idle_secs >= prompt_threshold_secs
}

/// How often the process-tree context probe may re-derive, per foreground PID.
const CONTEXT_REFRESH_SECS: u64 = 12;

/// Cached result of the last process-tree context derivation. Walking the
/// process table costs a few ms, so the poll loop only re-derives when the
/// foreground PID changes or the cache is older than `CONTEXT_REFRESH_SECS`.
struct ContextProbe {
    at: std::time::Instant,
    pid: Option<u32>,
    value: Option<String>,
}

/// Returns the process-tree context for the current foreground app, refreshing
/// the cache when stale or when focus moved to another process.
fn probe_process_context(probe: &mut Option<ContextProbe>) -> Option<String> {
    let pid = get_foreground_pid();
    let needs_refresh = match probe {
        Some(p) => p.pid != pid || p.at.elapsed().as_secs() >= CONTEXT_REFRESH_SECS,
        None => true,
    };
    if needs_refresh {
        let value = pid.and_then(process_context::derive_active_context);
        *probe = Some(ContextProbe {
            at: std::time::Instant::now(),
            pid,
            value,
        });
    }
    probe.as_ref().and_then(|p| p.value.clone())
}

/// Cached git derivation for a context-provider app's working directory.
/// Spawning `git` in the derived CWD costs a subprocess, so — mirroring
/// `probe_process_context` — we only re-run when the directory changes or the
/// cache is older than `CONTEXT_REFRESH_SECS`. This keeps terminal git
/// detection off the per-poll hot path: no extra git call per poll, only when
/// the terminal's CWD actually changes.
struct GitDirProbe {
    at: std::time::Instant,
    dir: Option<String>,
    value: Option<git::GitInfo>,
}

/// Returns the git info for a context-provider app's working directory,
/// refreshing the cache when the directory changed or the cache is stale.
fn probe_context_git(
    probe: &mut Option<GitDirProbe>,
    dir: Option<&str>,
) -> Option<git::GitInfo> {
    let needs_refresh = match probe {
        Some(p) => p.dir.as_deref() != dir || p.at.elapsed().as_secs() >= CONTEXT_REFRESH_SECS,
        None => true,
    };
    if needs_refresh {
        let value = dir.and_then(git::detect_git_from_dir);
        *probe = Some(GitDirProbe {
            at: std::time::Instant::now(),
            dir: dir.map(str::to_string),
            value,
        });
    }
    probe.as_ref().and_then(|p| p.value.clone())
}

/// How long a probed browser URL may be reused before re-probing (seconds).
#[allow(dead_code)] // used only by the Windows browser-URL probe, unused on macOS
const URL_REFRESH_SECS: u64 = 10;

/// Cached result of the last address-bar probe. The UIA probe walks the
/// browser's UI tree cross-process, so the poll loop only re-probes when the
/// normalized window title changed (navigation) or the cache is older than
/// `URL_REFRESH_SECS`.
#[allow(dead_code)] // fields unused on macOS, where the probe is a no-op
struct UrlProbe {
    at: std::time::Instant,
    title: String,
    value: Option<String>,
}

/// Returns the browser URL for the current foreground window, refreshing the
/// cache when the title changed or the cache is stale.
#[cfg(target_os = "windows")]
fn probe_browser_url(probe: &mut Option<UrlProbe>, title: &str) -> Option<String> {
    let needs_refresh = match probe {
        Some(p) => p.title != title || p.at.elapsed().as_secs() >= URL_REFRESH_SECS,
        None => true,
    };
    if needs_refresh {
        let value = url_windows::probe_foreground_browser_url();
        *probe = Some(UrlProbe {
            at: std::time::Instant::now(),
            title: title.to_string(),
            value,
        });
    }
    probe.as_ref().and_then(|p| p.value.clone())
}

/// TODO(macos): URL capture requires the Accessibility (AX) permission and an
/// AXUIElement-based probe — not implemented yet, so this is a no-op.
#[cfg(target_os = "macos")]
fn probe_browser_url(_probe: &mut Option<UrlProbe>, _title: &str) -> Option<String> {
    None
}

/// Tracks the current in-progress activity being accumulated.
#[allow(dead_code)]
#[derive(Clone)]
struct CurrentActivity {
    app_name: String,
    window_title: String,
    exe_path: String,
    git_branch: Option<String>,
    git_repo: Option<String>,
    context_path: Option<String>,
    /// Normalized browser URL (scheme + host + path). NOT part of the segment
    /// identity — URL churn within a page must not split segments.
    url: Option<String>,
    is_idle: bool,
    started_at: String,
    last_seen_at: String,
}

/// Auto-tracking system that captures foreground window activity,
/// detects idle time, and optionally enriches with Git information.
///
/// Opens its own SQLite connection (WAL mode supports concurrent readers/writers)
/// so it does not need to share the main `Database` instance via Arc.
pub struct ActivityTracker {
    is_running: Arc<AtomicBool>,
    db_path: PathBuf,
    idle_notify: Option<Arc<tokio::sync::Notify>>,
    app_handle: Option<tauri::AppHandle>,
}

impl ActivityTracker {
    /// Creates a new `ActivityTracker` pointing at the given SQLite database file.
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            db_path,
            idle_notify: None,
            app_handle: None,
        }
    }

    /// Set a `Notify` that will be signalled when the user transitions to idle.
    pub fn set_idle_notify(&mut self, notify: Arc<tokio::sync::Notify>) {
        self.idle_notify = Some(notify);
    }

    /// Set the app handle used to emit `idle-return` events to the frontend when
    /// the user comes back after a long idle window (the "hvad lavede du?" prompt).
    pub fn set_app_handle(&mut self, app_handle: tauri::AppHandle) {
        self.app_handle = Some(app_handle);
    }

    /// Returns whether the tracker is currently running.
    pub fn is_tracking(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    /// Starts the tracking poll loop in a background tokio task.
    ///
    /// Opens a dedicated SQLite connection for the tracker thread.
    /// The loop polls every `POLL_INTERVAL_SECS` seconds, captures the
    /// foreground window, detects idle state, and aggregates consecutive
    /// activities with the same app+title into single records.
    pub fn start(&self) {
        if self.is_running.swap(true, Ordering::SeqCst) {
            // Already running
            return;
        }

        let is_running = Arc::clone(&self.is_running);
        let db_path = self.db_path.clone();
        let idle_notify = self.idle_notify.clone();
        let app_handle = self.app_handle.clone();

        tauri::async_runtime::spawn(async move {
            // Open a dedicated connection for the tracker
            let conn = match Connection::open(&db_path) {
                Ok(c) => {
                    // Uden WAL skriver trackerens egen connection oveni
                    // hovedappens og kan låse den ude. Skal derfor ikke tie.
                    if let Err(e) = c.execute_batch(
                        "PRAGMA journal_mode=WAL;
                         PRAGMA synchronous=NORMAL;
                         PRAGMA cache_size=-4000;
                         PRAGMA mmap_size=268435456;
                         PRAGMA temp_store=MEMORY;",
                    ) {
                        crate::db::errors::record("trackerens database-indstillinger fejlede", e);
                    }
                    Arc::new(Mutex::new(c))
                }
                Err(e) => {
                    eprintln!("ActivityTracker: failed to open database: {}", e);
                    is_running.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let mut current: Option<CurrentActivity> = None;
            let mut was_idle = false;
            // Start of the current idle window (the user's last input before going
            // idle), used to report [idle_start, now] to the return-from-idle
            // prompt. `None` whenever the user is active.
            let mut idle_start: Option<chrono::DateTime<chrono::Utc>> = None;
            let mut context_probe: Option<ContextProbe> = None;
            // Per-directory git cache for terminal/agent CWDs — git runs only
            // when the derived working directory changes, not every poll.
            let mut git_dir_probe: Option<GitDirProbe> = None;
            let mut url_probe: Option<UrlProbe> = None;
            // A just-ended sub-threshold segment, held for one transition: an
            // alt-tab bounce A→B(2s)→A must resume A as ONE contiguous segment
            // instead of dropping two short fragments (lost time + shredded day).
            let mut pending_short: Option<CurrentActivity> = None;

            // Settings (idle threshold, min duration, exclusion rules, incognito)
            // are re-read periodically so changes — especially newly added
            // privacy exclusion rules — take effect without restarting the app.
            let mut idle_threshold = read_idle_threshold(&conn);
            let mut min_duration = read_min_activity_duration(&conn);
            let mut exclude_incognito = read_exclude_incognito(&conn);
            let mut exclusion_rules = read_exclusion_rules(&conn);
            let mut browser_url_capture = read_browser_url_capture(&conn);
            let mut meeting_apps = read_meeting_apps(&conn);
            let mut meeting_max_idle_secs = read_meeting_max_idle_secs(&conn);
            let mut idle_prompt_enabled = read_idle_prompt_enabled(&conn);
            let mut idle_prompt_threshold_secs = read_idle_prompt_threshold_secs(&conn);

            // Refresh settings every N polls (~every 30s at a 2s interval).
            const SETTINGS_REFRESH_EVERY_POLLS: u32 = 15;
            let mut polls_since_settings_refresh: u32 = 0;

            while is_running.load(Ordering::Relaxed) {
                let now = chrono::Utc::now().to_rfc3339();

                polls_since_settings_refresh += 1;
                if polls_since_settings_refresh >= SETTINGS_REFRESH_EVERY_POLLS {
                    polls_since_settings_refresh = 0;
                    idle_threshold = read_idle_threshold(&conn);
                    min_duration = read_min_activity_duration(&conn);
                    exclude_incognito = read_exclude_incognito(&conn);
                    exclusion_rules = read_exclusion_rules(&conn);
                    browser_url_capture = read_browser_url_capture(&conn);
                    meeting_apps = read_meeting_apps(&conn);
                    meeting_max_idle_secs = read_meeting_max_idle_secs(&conn);
                    idle_prompt_enabled = read_idle_prompt_enabled(&conn);
                    idle_prompt_threshold_secs = read_idle_prompt_threshold_secs(&conn);
                }

                let idle_secs = get_idle_seconds();
                // Capture the raw foreground window once: its app name feeds the
                // meeting-aware idle decision below, and the same value is then
                // run through the privacy exclusion filter for storage.
                let raw_window_info = get_foreground_window_info();
                let is_idle = decide_idle(
                    idle_secs,
                    idle_threshold,
                    raw_window_info.as_ref().map(|i| i.app_name.as_str()),
                    &meeting_apps,
                    meeting_max_idle_secs,
                );

                let now_dt = chrono::Utc::now();

                // Signal auto-classify when transitioning to idle, and remember
                // when the idle window began (the last input was `idle_secs` ago,
                // so the true away-start is `now - idle_secs`).
                if is_idle && !was_idle {
                    if let Some(ref notify) = idle_notify {
                        notify.notify_one();
                    }
                    idle_start =
                        Some(now_dt - chrono::Duration::seconds(idle_secs as i64));
                }

                // On the transition back to active, offer the "hvad lavede du?"
                // prompt if the idle window was long enough. The window ends at
                // the moment input resumed (`now - idle_secs`, idle_secs is small
                // here), so a meeting/phone call away from the machine is captured
                // without over-reporting.
                if !is_idle && was_idle {
                    if let Some(start) = idle_start.take() {
                        let end = now_dt - chrono::Duration::seconds(idle_secs as i64);
                        let window_secs = (end - start).num_seconds().max(0) as u64;
                        if should_prompt_return(
                            window_secs,
                            idle_prompt_threshold_secs,
                            idle_prompt_enabled,
                            false,
                        ) {
                            if let Some(ref handle) = app_handle {
                                let _ = handle.emit(
                                    "idle-return",
                                    serde_json::json!({
                                        "start": start.to_rfc3339(),
                                        "end": end.to_rfc3339(),
                                        "durationSecs": window_secs,
                                    }),
                                );
                            }
                        }
                    }
                }
                was_idle = is_idle;

                let window_info = raw_window_info
                    .filter(|info| {
                        // Privacy: drop excluded windows (e.g. incognito) entirely —
                        // they are treated as "no foreground window" and never stored.
                        // Runs on the RAW title so incognito/private markers that
                        // normalization might touch are still seen by the rules.
                        !exclusion::should_exclude(
                            &info.app_name,
                            &info.window_title,
                            &exclusion_rules,
                            exclude_incognito,
                        )
                    })
                    .map(|mut info| {
                        // Stable segment identity: unsaved-markers, notification
                        // counters and app-name suffixes change without the work
                        // changing and would otherwise split + drop segments.
                        info.window_title =
                            title::normalize_title(&info.app_name, &info.window_title);
                        // Constant-title apps (Orca, terminaler): derive project
                        // context from the process tree, cached & throttled.
                        if info.context_path.is_none()
                            && is_context_provider_app(&info.app_name)
                        {
                            info.context_path = probe_process_context(&mut context_probe);
                        }
                        // Document/design/page apps (Figma, Word, Notion,
                        // Obsidian, Photoshop, Postman): the title names the
                        // artefact being worked on. Derive a normalized
                        // project-context fragment and feed it in via
                        // context_path — the same signal terminals use — so
                        // history matching and the AI prompt get a stronger cue
                        // than the raw title. Unknown titles yield None and fall
                        // back to app+title unchanged. Runs AFTER the exclusion
                        // filter, like title normalization.
                        if info.context_path.is_none() {
                            info.context_path =
                                title::derive_app_context(&info.app_name, &info.window_title);
                        }
                        // Browser URL capture (opt-in): read the address bar
                        // via UI Automation, cached & throttled. Runs AFTER
                        // the exclusion filter, so excluded (e.g. incognito)
                        // windows are never probed.
                        if browser_url_capture && is_browser_app(&info.app_name) {
                            info.url = probe_browser_url(&mut url_probe, &info.window_title);
                        }
                        info
                    });

                match (window_info, &mut current) {
                    (Some(info), Some(ref mut curr)) => {
                        // Detect git info up-front each poll so a hidden window
                        // switch (same app + title, different repo/branch) starts
                        // a new segment instead of silently extending the old one.
                        let (git_branch, git_repo) =
                            detect_git_signals(&info, &mut git_dir_probe);

                        if same_segment(
                            curr,
                            &info.app_name,
                            &info.window_title,
                            &git_repo,
                            &git_branch,
                            &info.context_path,
                            is_idle,
                        ) {
                            // Same activity — just extend it. A late-arriving
                            // probe result may backfill a missing URL (the
                            // first probe can time out), but an already
                            // captured URL is kept: the segment is attributed
                            // to where it started.
                            curr.last_seen_at = now.clone();
                            if curr.url.is_none() && info.url.is_some() {
                                curr.url = info.url;
                            }
                        } else {
                            // Activity changed. The old segment ended *now* (the
                            // poll that saw the change).
                            let old_is_flicker = !curr.is_idle
                                && segment_duration_secs(&curr.started_at, &now)
                                    .is_some_and(|d| d < min_duration);
                            let resumes_pending = pending_short.as_ref().is_some_and(|p| {
                                same_segment(
                                    p,
                                    &info.app_name,
                                    &info.window_title,
                                    &git_repo,
                                    &git_branch,
                                    &info.context_path,
                                    is_idle,
                                )
                            });

                            // A→B→A bounce: drop the flicker (B) and resume
                            // the held segment (A) with its original start,
                            // so A stays one contiguous segment.
                            let genvej = if old_is_flicker {
                                tag_genvej(&mut pending_short, resumes_pending)
                            } else {
                                None
                            };

                            if let Some(mut resumed) = genvej {
                                resumed.last_seen_at = now.clone();
                                *curr = resumed;
                            } else {
                                if old_is_flicker {
                                    // Hold the sub-threshold segment for one
                                    // transition — it may be the A in A→B→A.
                                    pending_short = Some(curr.clone());
                                } else {
                                    finalize_activity(curr, &conn, min_duration, &now);
                                    pending_short = None;
                                }

                                *curr = CurrentActivity {
                                    app_name: info.app_name,
                                    window_title: info.window_title,
                                    exe_path: info.exe_path,
                                    git_branch,
                                    git_repo,
                                    context_path: info.context_path,
                                    url: info.url,
                                    is_idle,
                                    started_at: now.clone(),
                                    last_seen_at: now.clone(),
                                };
                            }
                        }
                    }
                    (Some(info), None) => {
                        // First activity capture
                        let (git_branch, git_repo) =
                            detect_git_signals(&info, &mut git_dir_probe);

                        current = Some(CurrentActivity {
                            app_name: info.app_name,
                            window_title: info.window_title,
                            exe_path: info.exe_path,
                            git_branch,
                            git_repo,
                            context_path: info.context_path,
                            url: info.url,
                            is_idle,
                            started_at: now.clone(),
                            last_seen_at: now.clone(),
                        });
                    }
                    (None, Some(ref mut curr)) => {
                        // No foreground window (e.g., lock screen)
                        // Finalize current activity, ending it now.
                        finalize_activity(curr, &conn, min_duration, &now);
                        current = None;
                        pending_short = None;
                    }
                    (None, None) => {
                        // Nothing happening
                    }
                }

                tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;
            }

            // Tracker stopped — finalize any remaining activity, ending it now.
            if let Some(ref curr) = current {
                let now = chrono::Utc::now().to_rfc3339();
                finalize_activity(curr, &conn, min_duration, &now);
            }
        });
    }

    /// Stops the tracking poll loop. The current activity is finalized
    /// in the background task before it exits.
    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}

/// Reads the idle threshold from the database, in seconds.
///
/// The Settings UI writes `idle_threshold_minutes` (in MINUTES). This used to
/// read a `idle_threshold` key in seconds that nothing ever wrote, so the
/// user's setting had no effect and the tracker always used the 5-minute
/// default. Now it reads the key the UI actually writes and converts to
/// seconds. Falls back to `DEFAULT_IDLE_THRESHOLD_SECS` if unset or invalid.
fn read_idle_threshold(conn: &Arc<Mutex<Connection>>) -> u64 {
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return DEFAULT_IDLE_THRESHOLD_SECS,
    };

    conn.query_row(
        "SELECT value FROM settings WHERE key = 'idle_threshold_minutes'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.trim().parse::<u64>().ok())
    .filter(|m| *m >= 1)
    .map(|m| m.saturating_mul(60))
    .unwrap_or(DEFAULT_IDLE_THRESHOLD_SECS)
}

/// Reads the minimum activity duration from the database.
/// Falls back to `DEFAULT_MIN_ACTIVITY_DURATION_SECS` if not set.
fn read_min_activity_duration(conn: &Arc<Mutex<Connection>>) -> i64 {
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return DEFAULT_MIN_ACTIVITY_DURATION_SECS,
    };

    conn.query_row(
        "SELECT value FROM settings WHERE key = 'min_activity_duration'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse::<i64>().ok())
    .unwrap_or(DEFAULT_MIN_ACTIVITY_DURATION_SECS)
}

/// Reads whether incognito / private-browsing windows should be excluded from
/// tracking. Falls back to `false` (track everything) if unset or on error.
fn read_exclude_incognito(conn: &Arc<Mutex<Connection>>) -> bool {
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };

    conn.query_row(
        "SELECT value FROM settings WHERE key = 'exclude_incognito'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(|v| v == "true" || v == "1")
    .unwrap_or(false)
}

/// Reads whether browser address-bar URLs should be captured (opt-in).
/// Falls back to `false` (no URL capture) if unset or on error.
fn read_browser_url_capture(conn: &Arc<Mutex<Connection>>) -> bool {
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };

    conn.query_row(
        "SELECT value FROM settings WHERE key = 'browser_url_capture'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(|v| v == "true" || v == "1")
    .unwrap_or(false)
}

/// Reads the meeting-app whitelist from the database as match tokens.
/// Falls back to `DEFAULT_MEETING_APPS` when unset, empty, or on error, so
/// meeting detection works out of the box.
fn read_meeting_apps(conn: &Arc<Mutex<Connection>>) -> Vec<String> {
    let raw = conn.lock().ok().and_then(|c| {
        c.query_row(
            "SELECT value FROM settings WHERE key = 'meeting_apps'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
    });

    let parsed = raw.as_deref().map(parse_meeting_apps).unwrap_or_default();
    if parsed.is_empty() {
        parse_meeting_apps(DEFAULT_MEETING_APPS)
    } else {
        parsed
    }
}

/// Reads the max continuous input-inactivity (in seconds) during which the
/// meeting-app idle exception applies. Stored in minutes; falls back to
/// `DEFAULT_MEETING_MAX_IDLE_MINUTES` when unset or on error.
fn read_meeting_max_idle_secs(conn: &Arc<Mutex<Connection>>) -> u64 {
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return DEFAULT_MEETING_MAX_IDLE_MINUTES * 60,
    };

    conn.query_row(
        "SELECT value FROM settings WHERE key = 'meeting_max_idle_minutes'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse::<u64>().ok())
    .map(|m| m * 60)
    .unwrap_or(DEFAULT_MEETING_MAX_IDLE_MINUTES * 60)
}

/// Reads whether the return-from-idle prompt is enabled. Falls back to `true`
/// (prompt on) when unset or on error, so the feature works out of the box.
fn read_idle_prompt_enabled(conn: &Arc<Mutex<Connection>>) -> bool {
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return true,
    };

    conn.query_row(
        "SELECT value FROM settings WHERE key = 'idle_prompt_enabled'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    // Only an explicit "false"/"0" turns it off; anything else stays on.
    .map(|v| !(v == "false" || v == "0"))
    .unwrap_or(true)
}

/// Reads the return-from-idle prompt threshold in seconds. Stored in MINUTES
/// under `idle_prompt_threshold_minutes` (separate from `idle_threshold_minutes`).
/// Falls back to `DEFAULT_IDLE_PROMPT_THRESHOLD_MINUTES` when unset or invalid.
fn read_idle_prompt_threshold_secs(conn: &Arc<Mutex<Connection>>) -> u64 {
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return DEFAULT_IDLE_PROMPT_THRESHOLD_MINUTES * 60,
    };

    conn.query_row(
        "SELECT value FROM settings WHERE key = 'idle_prompt_threshold_minutes'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.trim().parse::<u64>().ok())
    .filter(|m| *m >= 1)
    .map(|m| m.saturating_mul(60))
    .unwrap_or(DEFAULT_IDLE_PROMPT_THRESHOLD_MINUTES * 60)
}

/// Loads active user exclusion rules (empty on error), merging BOTH the
/// `exclusion_rules` table (managed by the advanced rules UI) AND the simple
/// `excluded_apps` textarea from Tracking settings. The textarea used to be a
/// dead setting nothing read — each non-empty line is now applied as an
/// `app_name` "contains" exclusion, so what the user types there takes effect.
fn read_exclusion_rules(conn: &Arc<Mutex<Connection>>) -> Vec<exclusion::ExclusionRule> {
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut rules = exclusion::load_exclusion_rules(&conn);

    if let Ok(raw) = conn.query_row(
        "SELECT value FROM settings WHERE key = 'excluded_apps'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        for line in raw.split(['\n', ',']) {
            let app = line.trim();
            if !app.is_empty() {
                rules.push(exclusion::ExclusionRule {
                    field: "app_name".to_string(),
                    op: "contains".to_string(),
                    value: app.to_string(),
                });
            }
        }
    }

    rules
}

/// Seconds between two RFC3339 timestamps; `None` if either fails to parse.
fn segment_duration_secs(started_at: &str, ended_at: &str) -> Option<i64> {
    let started = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
    let ended = chrono::DateTime::parse_from_rfc3339(ended_at).ok()?;
    Some((ended - started).num_seconds())
}

/// Decides whether a freshly observed window belongs to the same tracking
/// segment as the in-progress activity.
///
/// Identity includes git repo/branch — not just app + title — so rapid
/// switches between two windows that share an app name and window title but
/// belong to DIFFERENT projects (e.g. two editor windows both titled
/// "main.rs") are split into separate segments instead of being merged into
/// one, which would mis-attribute time across projects.
fn same_segment(
    curr: &CurrentActivity,
    app_name: &str,
    window_title: &str,
    git_repo: &Option<String>,
    git_branch: &Option<String>,
    context_path: &Option<String>,
    is_idle: bool,
) -> bool {
    curr.app_name == app_name
        && curr.window_title == window_title
        && curr.is_idle == is_idle
        && curr.git_repo == *git_repo
        && curr.git_branch == *git_branch
        && curr.context_path == *context_path
}

/// Tager det bagholdte segment, når en A→B→A-genvej er berettiget.
///
/// `resumes_pending` er beregnet af kalderen lige før kalderen herhen. Koden
/// før denne funktion havde `pending_short.take().expect(...)`, altså et
/// `panic` i **trackens egen tråd** på en invariant, intet kunne håndhæve. En
/// panik der dræber poll-tråden ser ud som om appen bare holder op med at
/// registrere: ingen fejl, ingen log — og det er den værste fejl appen kan lave.
///
/// Derfor tages segmentet kun hvis det faktisk er der. Er det ikke, ender vi i
/// den normale «start et nyt segment»-gren, og det bagholdte segment bliver
/// liggende til næste skift — altså tabes der højst et par sekunders
/// segmentgrænse, aldrig trackeren selv.
fn tag_genvej(
    pending_short: &mut Option<CurrentActivity>,
    resumes_pending: bool,
) -> Option<CurrentActivity> {
    if !resumes_pending {
        // Ikke en genvej: det bagholdte segment skal *blive liggende*, så det kan
        // tages ved et senere A→B→A. Derfor tages det ikke her.
        return None;
    }
    pending_short.take()
}

/// Writes a finalized activity to the database, if it meets the minimum duration.
///
/// `ended_at` is the moment the segment ended (typically "now" at the poll that
/// observed the change), NOT the last time the window was seen. Using the last
/// observation would under-count every segment by ~one poll interval and drop
/// any window that was only seen on a single poll (duration 0). Stamping the
/// real end time means a window observed once still counts for the interval it
/// was actually in the foreground.
///
/// Idle segments are NEVER persisted: idle time must never inflate tracked
/// hours. When the user is idle but the same window stays in the foreground we
/// would otherwise write a growing idle segment that carries the previous
/// segment's app/project/category — billable-looking time the user never spent.
fn finalize_activity(
    activity: &CurrentActivity,
    conn: &Arc<Mutex<Connection>>,
    min_duration: i64,
    ended_at: &str,
) {
    // Privacy/correctness: idle time is never tracked.
    if activity.is_idle {
        return;
    }

    // Calculate duration
    let started = match chrono::DateTime::parse_from_rfc3339(&activity.started_at) {
        Ok(dt) => dt,
        Err(_) => return,
    };
    let ended = match chrono::DateTime::parse_from_rfc3339(ended_at) {
        Ok(dt) => dt,
        Err(_) => return,
    };

    let duration = (ended - started).num_seconds();

    if duration < min_duration {
        return;
    }

    // Recover the guard even if another thread panicked while holding the lock.
    // A poisoned mutex must not silently kill the tracker — the data behind it
    // is still consistent (we only ever hold it for a single statement).
    let conn = match conn.lock() {
        Ok(c) => c,
        Err(poisoned) => poisoned.into_inner(),
    };

    // Try to classify the activity before inserting (rules + confirmed patterns)
    let classification = rules::RuleEngine::classify(
        &conn,
        &activity.app_name,
        &activity.window_title,
        activity.url.as_deref(),
        activity.git_repo.as_deref(),
        activity.context_path.as_deref(),
    );

    let (project_id, client_id, category, confidence, source, reason, is_confirmed) =
        match &classification {
            Some(m) => (
                m.project_id.as_deref(),
                m.client_id.as_deref(),
                m.category.as_deref(),
                Some(m.confidence),
                Some(m.source.as_str()),
                Some(m.reason.as_str()),
                m.confidence >= 0.95,
            ),
            None => (None, None, None, None, None, None, false),
        };

    // Best-effort: the open file name from an editor's window title.
    let file_path = if is_editor_app(&activity.app_name) {
        process_context::extract_active_file(&activity.window_title)
    } else {
        None
    };

    // Retry briefly on a busy database. A dropped INSERT here means lost tracked
    // time, so a transient SQLITE_BUSY (another writer mid-commit) must not
    // silently discard the segment.
    let mut attempts = 0;
    loop {
        let result = conn.execute(
            "INSERT INTO activities (app_name, window_title, url, git_branch, git_repo, context_path, file_path, is_idle, started_at, ended_at, duration, project_id, client_id, category, confidence, classification_source, classification_reason, is_confirmed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            rusqlite::params![
                activity.app_name,
                activity.window_title,
                activity.url,
                activity.git_branch,
                activity.git_repo,
                activity.context_path,
                file_path,
                activity.is_idle as i32,
                activity.started_at,
                ended_at,
                duration,
                project_id,
                client_id,
                category,
                confidence,
                source,
                reason,
                is_confirmed as i32,
            ],
        );

        match result {
            Ok(_) => break,
            Err(e) if is_busy_error(&e) && attempts < 5 => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(50 * attempts));
            }
            Err(e) => {
                eprintln!("ActivityTracker: failed to persist activity: {}", e);
                break;
            }
        }
    }
}

/// True if a rusqlite error is a transient SQLITE_BUSY / SQLITE_LOCKED that is
/// worth retrying.
fn is_busy_error(err: &rusqlite::Error) -> bool {
    use rusqlite::ErrorCode;
    matches!(
        err,
        rusqlite::Error::SqliteFailure(e, _)
            if e.code == ErrorCode::DatabaseBusy || e.code == ErrorCode::DatabaseLocked
    )
}

/// Detects Git branch and repo name for editor applications.
/// True if the app name matches a known code editor / IDE executable.
fn is_editor_app(app_name: &str) -> bool {
    let app_lower = app_name.to_lowercase();
    EDITOR_EXECUTABLES
        .iter()
        .any(|editor| app_lower.contains(editor))
}

fn detect_git_for_editors(
    app_name: &str,
    window_title: &str,
    exe_path: &str,
) -> (Option<String>, Option<String>) {
    if !is_editor_app(app_name) {
        return (None, None);
    }

    match git::detect_git_info(window_title, exe_path) {
        Some(info) => (Some(info.branch), Some(info.repo_name)),
        None => (None, None),
    }
}

/// Derives the (branch, repo) git signal for a foreground window.
///
/// Editors keep their existing title-based detection (unchanged). For
/// context-provider apps (terminals, agent runners) whose title never names the
/// project — where `git_repo` was previously always `None` — this additionally
/// derives git from the already-derived working directory (`context_path`),
/// cached per-directory via `git_dir_probe` so no extra git call happens per
/// poll. Any failure falls silently back to `(None, None)`.
fn detect_git_signals(
    info: &WindowInfo,
    git_dir_probe: &mut Option<GitDirProbe>,
) -> (Option<String>, Option<String>) {
    // Editors: parse the window title, exactly as before.
    let (branch, repo) =
        detect_git_for_editors(&info.app_name, &info.window_title, &info.exe_path);
    if repo.is_some() {
        return (branch, repo);
    }

    // Terminals / agent runners: derive git from the terminal's CWD, the only
    // place their project identity lives. Cached per-directory (throttled like
    // the context probe) so this is not an extra git call on every poll.
    if is_context_provider_app(&info.app_name) {
        if let Some(dir) = info.context_path.as_deref() {
            if let Some(gi) = probe_context_git(git_dir_probe, Some(dir)) {
                let branch = if gi.branch.is_empty() {
                    None
                } else {
                    Some(gi.branch)
                };
                return (branch, Some(gi.repo_name));
            }
        }
    }

    (branch, repo)
}

/// The classification signals for the CURRENT foreground window, derived from a
/// single on-demand probe. Same shape the poll loop feeds into the classifier.
pub struct ClassificationContext {
    pub app_name: String,
    pub window_title: String,
    pub git_repo: Option<String>,
    pub context_path: Option<String>,
    pub url: Option<String>,
}

/// Runs ONE synchronous foreground probe and enriches it exactly like the poll
/// loop does — normalized title, editor git repo, terminal/agent process-tree
/// context, then app-title-derived context — so a manual project suggestion
/// sees the same signals as auto-classification. On-demand only: no polling,
/// no background load. Browser address-bar URL is deliberately not probed here
/// (opt-in + slow); rules keyed on URL simply won't fire for the suggestion.
pub fn probe_active_classification_context() -> Option<ClassificationContext> {
    let mut info = get_foreground_window_info()?;
    info.window_title = title::normalize_title(&info.app_name, &info.window_title);

    let (_branch, mut git_repo) =
        detect_git_for_editors(&info.app_name, &info.window_title, &info.exe_path);

    if info.context_path.is_none() && is_context_provider_app(&info.app_name) {
        info.context_path = get_foreground_pid().and_then(process_context::derive_active_context);
    }
    if info.context_path.is_none() {
        info.context_path = title::derive_app_context(&info.app_name, &info.window_title);
    }

    // Terminals: derive git_repo from the working directory when the editor
    // title path produced none — the same signal the poll loop now uses. This
    // is on-demand (one shot), so no cache is needed here.
    if git_repo.is_none() && is_context_provider_app(&info.app_name) {
        if let Some(dir) = info.context_path.as_deref() {
            if let Some(gi) = git::detect_git_from_dir(dir) {
                git_repo = Some(gi.repo_name);
            }
        }
    }

    Some(ClassificationContext {
        app_name: info.app_name,
        window_title: info.window_title,
        git_repo,
        context_path: info.context_path,
        url: info.url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn activity(
        app: &str,
        title: &str,
        repo: Option<&str>,
        branch: Option<&str>,
        idle: bool,
    ) -> CurrentActivity {
        CurrentActivity {
            app_name: app.to_string(),
            window_title: title.to_string(),
            exe_path: String::new(),
            git_branch: branch.map(str::to_string),
            git_repo: repo.map(str::to_string),
            context_path: None,
            url: None,
            is_idle: idle,
            started_at: String::new(),
            last_seen_at: String::new(),
        }
    }

    #[test]
    fn same_segment_identical_is_true() {
        let curr = activity("code", "main.rs", Some("repoA"), Some("main"), false);
        assert!(same_segment(
            &curr,
            "code",
            "main.rs",
            &Some("repoA".to_string()),
            &Some("main".to_string()),
            &None,
            false,
        ));
    }

    #[test]
    fn same_segment_different_repo_is_false() {
        // The core bug: same app + title but a different repo must NOT merge,
        // or time gets mis-attributed across projects.
        let curr = activity("code", "main.rs", Some("repoA"), Some("main"), false);
        assert!(!same_segment(
            &curr,
            "code",
            "main.rs",
            &Some("repoB".to_string()),
            &Some("main".to_string()),
            &None,
            false,
        ));
    }

    #[test]
    fn same_segment_different_branch_is_false() {
        let curr = activity("code", "main.rs", Some("repoA"), Some("main"), false);
        assert!(!same_segment(
            &curr,
            "code",
            "main.rs",
            &Some("repoA".to_string()),
            &Some("feature".to_string()),
            &None,
            false,
        ));
    }

    #[test]
    fn same_segment_different_title_is_false() {
        let curr = activity("code", "main.rs", None, None, false);
        assert!(!same_segment(&curr, "code", "lib.rs", &None, &None, &None, false));
    }

    #[test]
    fn same_segment_different_idle_is_false() {
        let curr = activity("code", "main.rs", None, None, false);
        assert!(!same_segment(&curr, "code", "main.rs", &None, &None, &None, true));
    }

    #[test]
    fn same_segment_non_editor_without_git_is_true() {
        // Non-editor apps carry no git; identical app+title+idle stays one segment.
        let curr = activity("chrome", "Gmail", None, None, false);
        assert!(same_segment(&curr, "chrome", "Gmail", &None, &None, &None, false));
    }

    // -----------------------------------------------------------------------
    // finalize_activity — idle skip + ended_at duration
    // -----------------------------------------------------------------------

    fn setup_tracker_db() -> Arc<Mutex<Connection>> {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(crate::db::schema::SCHEMA)
            .expect("create schema");
        Arc::new(Mutex::new(conn))
    }

    fn count_activities(conn: &Arc<Mutex<Connection>>) -> i64 {
        conn.lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))
            .unwrap()
    }

    fn timed_activity(start: &str, idle: bool) -> CurrentActivity {
        CurrentActivity {
            app_name: "code".to_string(),
            window_title: "main.rs".to_string(),
            exe_path: String::new(),
            git_branch: None,
            git_repo: None,
            context_path: None,
            url: None,
            is_idle: idle,
            started_at: start.to_string(),
            last_seen_at: start.to_string(),
        }
    }

    #[test]
    fn finalize_skips_idle_segments() {
        let conn = setup_tracker_db();
        // A long idle segment must NOT be persisted, even though its duration is
        // well above the minimum.
        let act = timed_activity("2026-06-23T10:00:00+00:00", true);
        finalize_activity(&act, &conn, 5, "2026-06-23T10:30:00+00:00");
        assert_eq!(count_activities(&conn), 0);
    }

    #[test]
    fn finalize_uses_ended_at_not_last_seen() {
        let conn = setup_tracker_db();
        // started_at == last_seen_at (window seen once), but ended_at is a full
        // poll interval later. Duration must come from ended_at so a
        // single-observation window still counts.
        let act = timed_activity("2026-06-23T10:00:00+00:00", false);
        finalize_activity(&act, &conn, 5, "2026-06-23T10:00:10+00:00");
        assert_eq!(count_activities(&conn), 1);
        let duration: i64 = conn
            .lock()
            .unwrap()
            .query_row("SELECT duration FROM activities", [], |r| r.get(0))
            .unwrap();
        assert_eq!(duration, 10);
    }

    #[test]
    fn segment_duration_parses_rfc3339() {
        assert_eq!(
            segment_duration_secs("2026-07-11T10:00:00+00:00", "2026-07-11T10:00:03+00:00"),
            Some(3)
        );
        assert_eq!(segment_duration_secs("ugyldig", "2026-07-11T10:00:03+00:00"), None);
    }

    #[test]
    fn finalize_drops_segments_under_min_duration() {
        let conn = setup_tracker_db();
        let act = timed_activity("2026-06-23T10:00:00+00:00", false);
        // Only 2s elapsed, below the 5s minimum.
        finalize_activity(&act, &conn, 5, "2026-06-23T10:00:02+00:00");
        assert_eq!(count_activities(&conn), 0);
    }

    #[test]
    fn same_segment_ignores_url_changes() {
        // URL is deliberately NOT part of the segment identity: URL churn
        // within one page (SPA routing, redirects) must not split segments —
        // the title covers real context switches.
        let mut curr = activity("chrome", "GitHub", None, None, false);
        curr.url = Some("https://github.com/a".to_string());
        assert!(same_segment(&curr, "chrome", "GitHub", &None, &None, &None, false));
    }

    #[test]
    fn finalize_persists_url() {
        let conn = setup_tracker_db();
        let mut act = timed_activity("2026-06-23T10:00:00+00:00", false);
        act.url = Some("https://example.com/docs".to_string());
        finalize_activity(&act, &conn, 5, "2026-06-23T10:00:30+00:00");
        assert_eq!(count_activities(&conn), 1);
        let url: Option<String> = conn
            .lock()
            .unwrap()
            .query_row("SELECT url FROM activities", [], |r| r.get(0))
            .unwrap();
        assert_eq!(url.as_deref(), Some("https://example.com/docs"));
    }

    #[test]
    fn finalize_persists_classification_source_and_reason() {
        let conn = setup_tracker_db();
        // A rule that will classify the activity, so finalize records WHY.
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO projects (id, name, created_at, updated_at)
                 VALUES ('p1', 'Kunde A', datetime('now'), datetime('now'))",
                [],
            )
            .unwrap();
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO classification_rules (name, priority, condition_type, condition_op, condition_value, target_project_id)
                 VALUES ('r', 10, 'window_title', 'contains', 'main.rs', 'p1')",
                [],
            )
            .unwrap();

        let act = timed_activity("2026-06-23T10:00:00+00:00", false);
        finalize_activity(&act, &conn, 5, "2026-06-23T10:00:30+00:00");

        let (source, reason): (Option<String>, Option<String>) = conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT classification_source, classification_reason FROM activities",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(source.as_deref(), Some("rule"));
        assert_eq!(reason.as_deref(), Some("window_title main.rs"));
    }

    #[test]
    fn is_browser_app_matches_known_browsers() {
        assert!(is_browser_app("chrome"));
        assert!(is_browser_app("msedge"));
        assert!(is_browser_app("Firefox"));
        assert!(is_browser_app("brave"));
        assert!(is_browser_app("opera"));
        assert!(is_browser_app("vivaldi"));
        assert!(!is_browser_app("code"));
        assert!(!is_browser_app("explorer"));
    }

    // -----------------------------------------------------------------------
    // decide_idle — meeting-aware idle with AFK safeguard
    // -----------------------------------------------------------------------

    #[test]
    fn decide_idle_whitelisted_app_over_threshold_not_idle() {
        // (a) Teams focused, input inactive past the threshold but within the
        // AFK cap → NOT idle, so the meeting segment is kept alive.
        let meeting = vec!["teams".to_string(), "zoom".to_string()];
        assert!(!decide_idle(600, 300, Some("Teams"), &meeting, 7200));
    }

    #[test]
    fn decide_idle_non_whitelisted_over_threshold_is_idle() {
        // (b) A normal app past the threshold → idle, exactly as before.
        let meeting = vec!["teams".to_string()];
        assert!(decide_idle(600, 300, Some("code"), &meeting, 7200));
    }

    #[test]
    fn decide_idle_whitelisted_app_over_afk_cap_is_idle() {
        // (c) AFK safeguard: Teams focused but inactive beyond the cap → idle
        // again, so lunch behind a focused meeting app is never billed.
        let meeting = vec!["teams".to_string()];
        assert!(decide_idle(8000, 300, Some("Teams"), &meeting, 7200));
    }

    #[test]
    fn decide_idle_whitelisted_app_under_threshold_not_idle() {
        // (d) Below the threshold is never idle, meeting app or not.
        let meeting = vec!["teams".to_string()];
        assert!(!decide_idle(120, 300, Some("Teams"), &meeting, 7200));
    }

    #[test]
    fn decide_idle_no_foreground_uses_normal_logic() {
        // No foreground app (e.g. lock screen) → plain threshold logic.
        assert!(decide_idle(600, 300, None, &[], 7200));
        assert!(!decide_idle(120, 300, None, &[], 7200));
    }

    // -----------------------------------------------------------------------
    // should_prompt_return — return-from-idle prompt eligibility (issue #11)
    // -----------------------------------------------------------------------

    #[test]
    fn should_prompt_return_below_threshold_is_false() {
        // (a) An idle window shorter than the prompt threshold must NOT prompt:
        // a 4-minute break is not a meeting worth asking about.
        assert!(!should_prompt_return(240, 600, true, false));
    }

    #[test]
    fn should_prompt_return_at_or_above_threshold_is_true() {
        // A window at/over the threshold, enabled and not paused, prompts.
        assert!(should_prompt_return(600, 600, true, false));
        assert!(should_prompt_return(2820, 600, true, false)); // 47 min
    }

    #[test]
    fn should_prompt_return_disabled_never_prompts() {
        // Turned off in settings → never prompt, however long the window.
        assert!(!should_prompt_return(3600, 600, false, false));
    }

    #[test]
    fn should_prompt_return_paused_never_prompts() {
        // Manually paused → never prompt, even over the threshold.
        assert!(!should_prompt_return(3600, 600, true, true));
    }

    #[test]
    fn read_idle_prompt_enabled_defaults_on_and_reads_false() {
        let conn = setup_tracker_db();
        // Unset → on by default.
        assert!(read_idle_prompt_enabled(&conn));
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('idle_prompt_enabled', 'false')",
                [],
            )
            .unwrap();
        assert!(!read_idle_prompt_enabled(&conn));
    }

    #[test]
    fn read_idle_prompt_threshold_defaults_and_converts_minutes() {
        let conn = setup_tracker_db();
        // Unset → the 10-minute default (600 s).
        assert_eq!(
            read_idle_prompt_threshold_secs(&conn),
            DEFAULT_IDLE_PROMPT_THRESHOLD_MINUTES * 60
        );
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('idle_prompt_threshold_minutes', '20')",
                [],
            )
            .unwrap();
        assert_eq!(read_idle_prompt_threshold_secs(&conn), 1200, "20 min → 1200 s");
    }

    #[test]
    fn idle_threshold_reads_minutes_key_and_converts_to_seconds() {
        let conn = setup_tracker_db();
        // Unset → the 5-minute default.
        assert_eq!(read_idle_threshold(&conn), DEFAULT_IDLE_THRESHOLD_SECS);
        // The Settings UI writes minutes under `idle_threshold_minutes`.
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('idle_threshold_minutes', '10')",
                [],
            )
            .unwrap();
        assert_eq!(read_idle_threshold(&conn), 600, "10 min → 600 s");
    }

    #[test]
    fn excluded_apps_setting_bridges_into_exclusion() {
        let conn = setup_tracker_db();
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('excluded_apps', 'Spotify\nSlack')",
                [],
            )
            .unwrap();
        let rules = read_exclusion_rules(&conn);
        // The textarea lines now take effect via should_exclude.
        assert!(exclusion::should_exclude("Spotify", "Now Playing", &rules, false));
        assert!(exclusion::should_exclude("Slack", "general", &rules, false));
        assert!(!exclusion::should_exclude("code", "main.rs", &rules, false));
    }

    #[test]
    fn is_meeting_app_matches_case_insensitively() {
        let meeting = parse_meeting_apps(DEFAULT_MEETING_APPS);
        assert!(is_meeting_app("Teams.exe", &meeting));
        assert!(is_meeting_app("ZOOM", &meeting));
        assert!(is_meeting_app("Webex", &meeting));
        assert!(!is_meeting_app("code", &meeting));
        assert!(!is_meeting_app("chrome", &meeting));
    }

    #[test]
    fn parse_meeting_apps_splits_and_trims() {
        assert_eq!(
            parse_meeting_apps("Teams, Zoom\n  Webex  \n\n"),
            vec!["teams", "zoom", "webex"]
        );
        assert!(parse_meeting_apps("  \n , ").is_empty());
    }

    #[test]
    fn read_meeting_apps_defaults_when_unset() {
        let conn = setup_tracker_db();
        let apps = read_meeting_apps(&conn);
        assert!(apps.contains(&"teams".to_string()));
        assert!(apps.contains(&"zoom".to_string()));
    }

    #[test]
    fn read_meeting_apps_reads_custom_list() {
        let conn = setup_tracker_db();
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('meeting_apps', 'discord, obs')",
                [],
            )
            .unwrap();
        assert_eq!(read_meeting_apps(&conn), vec!["discord", "obs"]);
    }

    #[test]
    fn read_meeting_max_idle_secs_defaults_and_converts_minutes() {
        let conn = setup_tracker_db();
        // Default when unset: 120 minutes → 7200 seconds.
        assert_eq!(read_meeting_max_idle_secs(&conn), 7200);
        conn.lock()
            .unwrap()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('meeting_max_idle_minutes', '30')",
                [],
            )
            .unwrap();
        assert_eq!(read_meeting_max_idle_secs(&conn), 1800);
    }

    fn window(app: &str, title: &str, context: Option<&str>) -> WindowInfo {
        WindowInfo {
            app_name: app.to_string(),
            window_title: title.to_string(),
            exe_path: String::new(),
            context_path: context.map(str::to_string),
            url: None,
        }
    }

    #[test]
    fn detect_git_signals_terminal_non_repo_dir_is_none() {
        // A terminal whose derived CWD is not a git repo must fall silently back
        // to (None, None) — no panic, git_repo stays unset.
        let bogus = std::env::temp_dir().join("ttd-no-repo-here-4b7e11a9");
        let info = window("warp", "warp", Some(&bogus.to_string_lossy()));
        let mut probe = None;
        assert_eq!(detect_git_signals(&info, &mut probe), (None, None));
        // The probe was populated (so a repeat poll reuses it, no re-run).
        assert!(probe.is_some());
    }

    #[test]
    fn detect_git_signals_non_terminal_without_context_is_none() {
        // A plain app with no context_path and no editor match: no git attempt.
        let info = window("chrome", "Gmail", None);
        let mut probe = None;
        assert_eq!(detect_git_signals(&info, &mut probe), (None, None));
    }

    #[test]
    fn same_segment_different_context_splits_constant_title_app() {
        // The Orca case: same app + title + idle, but a different derived
        // project path → must be a separate segment.
        let mut curr = activity("orca", "Orca", None, None, false);
        curr.context_path = Some(r"C:\work\projA".to_string());

        assert!(!same_segment(
            &curr,
            "orca",
            "Orca",
            &None,
            &None,
            &Some(r"C:\work\projB".to_string()),
            false,
        ));
        assert!(same_segment(
            &curr,
            "orca",
            "Orca",
            &None,
            &None,
            &Some(r"C:\work\projA".to_string()),
            false,
        ));
    }

    // -----------------------------------------------------------------------
    // tag_genvej — A→B→A-genvejen må ikke kunne dræbe trackeren
    // -----------------------------------------------------------------------

    /// Genvejen tager det bagholdte segment **og** tømmer pladsen, så det ikke kan
    /// tages to gange. Det er den egenskab, resten af koden stoler på.
    #[test]
    fn genvej_tager_det_bagholdte_segment() {
        let mut pending = Some(activity("code", "main.rs", Some("repoA"), Some("main"), false));

        let taget = tag_genvej(&mut pending, true);

        assert!(taget.is_some(), "en berettiget genvej skal give et segment");
        assert!(
            pending.is_none(),
            "segmentet må ikke ligge tilbage og kunne tages igen"
        );
    }

    /// **Findet her.** Kaldet videre om `resumes_pending`, men `pending_short` var
    /// `None` — så havde `take().expect(...)` panikkket i trackens egen tråd, og
    /// brugeren ville have set en app der bare holdt op med at registrere tid.
    #[test]
    fn genvej_uden_et_bagholdt_segment_draper_ikke() {
        let mut pending: Option<CurrentActivity> = None;

        let taget = tag_genvej(&mut pending, true);

        assert!(
            taget.is_none(),
            "er der intet at tage, skal vi blot fortsætte med et nyt segment"
        );
    }

    /// En *uberettiget* genvej tager intet — og det bagholdte segment bliver
    /// **liggende**, så en senere A→B→A stadig kan bruge det. Det er hele pointen
    /// med at holde det tilbage i én overgang.
    #[test]
    fn en_uberettiget_genvej_beholder_det_bagholdte_segment() {
        let mut pending = Some(activity("code", "main.rs", Some("repoA"), Some("main"), false));

        let taget = tag_genvej(&mut pending, false);

        assert!(taget.is_none(), "uden berettigelse tager vi intet");
        assert!(
            pending.is_some(),
            "det bagholdte segment skal ligge videre til næste skift"
        );
    }
}
