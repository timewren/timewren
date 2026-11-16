use crate::db::Database;
use crate::tracker::process_context;
use crate::tracker::rules::{self, ProjectSuggestion};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Project context derived from a process command line.
#[derive(Debug, Clone, Serialize)]
pub struct DerivedContext {
    /// The most likely project directory/path, if one was found.
    pub path: Option<String>,
    /// A short label (last path component) for display.
    pub label: Option<String>,
}

/// Derives project context from a command line. Exposes the pure
/// `process_context` parser so it can be previewed/diagnosed from the UI and
/// reused by the OS-specific capture path once it gathers command lines.
#[tauri::command]
pub fn derive_context_from_cmdline(cmdline: String) -> DerivedContext {
    let path = process_context::extract_project_path_from_cmdline(&cmdline);
    let label = path
        .as_deref()
        .and_then(process_context::derive_project_label);
    DerivedContext { path, label }
}

/// A process snapshot entry supplied by the caller.
#[derive(Debug, Clone, Deserialize)]
pub struct ProcInfoInput {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub cmd: String,
    pub cwd: Option<String>,
}

/// Derives project context from a process snapshot (foreground app + its
/// descendants). Lets the context selection be verified on-device before it is
/// wired into the live capture loop.
#[tauri::command]
pub fn derive_context_from_processes(
    foreground_pid: u32,
    processes: Vec<ProcInfoInput>,
) -> DerivedContext {
    let procs: Vec<process_context::ProcInfo> = processes
        .into_iter()
        .map(|p| process_context::ProcInfo {
            pid: p.pid,
            parent_pid: p.parent_pid,
            cmd: p.cmd,
            cwd: p.cwd,
        })
        .collect();
    let path = process_context::select_context_from_processes(foreground_pid, &procs);
    let label = path
        .as_deref()
        .and_then(process_context::derive_project_label);
    DerivedContext { path, label }
}

/// Derives the project context for the CURRENT foreground app by gathering a
/// live process snapshot and running the selector. Same chain as the tracker
/// poll loop uses — lets it be verified on-device from Settings.
#[tauri::command]
pub fn get_active_context() -> DerivedContext {
    let Some(foreground_pid) = crate::tracker::get_foreground_pid() else {
        return DerivedContext {
            path: None,
            label: None,
        };
    };
    let path = process_context::derive_active_context(foreground_pid);
    let label = path
        .as_deref()
        .and_then(process_context::derive_project_label);
    DerivedContext { path, label }
}

/// Suggests a project for the CURRENT foreground context at manual timer start.
///
/// Performs ONE synchronous foreground probe (reusing the tracker's own capture
/// + enrichment building blocks) and runs the SAME rules + confirmed-pattern
/// memory as auto-classification. Returns a suggestion only on a confident
/// match to a live project; otherwise `None`, so the project field stays empty.
/// This is read-only and never affects auto-tracking.
#[tauri::command]
pub fn suggest_project_for_context(db: State<'_, Database>) -> Option<ProjectSuggestion> {
    let ctx = crate::tracker::probe_active_classification_context()?;
    let conn = crate::db::lås(&db.conn);
    rules::suggest_from_context(
        &conn,
        &ctx.app_name,
        &ctx.window_title,
        ctx.url.as_deref(),
        ctx.git_repo.as_deref(),
        ctx.context_path.as_deref(),
    )
}
