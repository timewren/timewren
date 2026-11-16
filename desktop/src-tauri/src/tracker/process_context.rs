//! Pure parsing of a process command line into a likely project directory.
//!
//! Constant-title apps (terminals, tmux, agent runners like Orca, editors)
//! don't identify the active project via the window title. Their process
//! command line often does — e.g. `code "C:\work\timetrack-desktop"` or
//! `claude --cwd C:\work\api`. This module is the PURE, fully-tested parsing
//! layer; the OS-specific code that GATHERS command lines (Win32/macOS FFI)
//! feeds it and is added separately.

/// Flags whose immediately-following argument is a working/project directory.
const DIR_FLAGS: &[&str] = &[
    "--project",
    "--cwd",
    "--dir",
    "--directory",
    "--add-dir",
    "--workdir",
    "-C",
];

/// Extract the most likely project directory/path from a command line.
/// Returns `None` if no plausible absolute path is present.
pub fn extract_project_path_from_cmdline(cmdline: &str) -> Option<String> {
    let tokens = tokenize(cmdline);

    // 1) Argument that belongs to a known directory flag (highest confidence).
    for (i, tok) in tokens.iter().enumerate() {
        // `--flag=value`
        if let Some((flag, val)) = tok.split_once('=') {
            if DIR_FLAGS.contains(&flag) && looks_like_path(val) {
                return Some(val.to_string());
            }
        }
        // `--flag value`
        if DIR_FLAGS.contains(&tok.as_str()) {
            if let Some(next) = tokens.get(i + 1) {
                if looks_like_path(next) {
                    return Some(next.to_string());
                }
            }
        }
    }

    // 2) Fallback: the last absolute-path-looking argument (skip the exe at [0]).
    tokens
        .iter()
        .skip(1)
        .rev()
        .find(|t| looks_like_path(t))
        .map(|t| t.to_string())
}

/// Minimal process info used to derive activity context. The OS-specific
/// gathering (sysinfo / Win32 / macOS) builds a snapshot of these and feeds
/// `select_context_from_processes`; that gathering is added/verified on-device.
#[derive(Debug, Clone)]
pub struct ProcInfo {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    /// Full command line (joined), may be empty.
    pub cmd: String,
    /// Working directory, if the OS exposed it.
    pub cwd: Option<String>,
}

/// Given the foreground process PID and a snapshot of running processes, derive
/// the most likely project directory for the work happening inside a
/// constant-title app (terminal, agent runner like Orca). Walks descendants of
/// the foreground process and prefers a real working directory (the active
/// shell's CWD); falls back to a path parsed from a command line.
pub fn select_context_from_processes(foreground_pid: u32, procs: &[ProcInfo]) -> Option<String> {
    use std::collections::HashMap;
    let by_pid: HashMap<u32, &ProcInfo> = procs.iter().map(|p| (p.pid, p)).collect();

    // Relevant = the foreground process and everything descended from it.
    let relevant: Vec<&ProcInfo> = procs
        .iter()
        .filter(|p| depth_to(p.pid, foreground_pid, &by_pid).is_some())
        .collect();

    // 1) Prefer a meaningful working directory. Among candidates, the deepest
    //    descendant (furthest from the foreground app) is usually the active
    //    shell/agent, so its CWD is the most specific project context.
    let mut best: Option<(&ProcInfo, usize)> = None;
    for p in &relevant {
        if let Some(cwd) = &p.cwd {
            if !cwd.trim().is_empty() && !is_system_dir(cwd) {
                let d = depth_to(p.pid, foreground_pid, &by_pid).unwrap_or(0);
                best = match best {
                    Some((_, bd)) if d <= bd => best,
                    _ => Some((p, d)),
                };
            }
        }
    }
    if let Some((p, _)) = best {
        return p.cwd.clone();
    }

    // 2) Fall back to a path parsed from a command line (deepest first).
    let mut by_depth: Vec<&&ProcInfo> = relevant.iter().collect();
    by_depth.sort_by_key(|p| {
        std::cmp::Reverse(depth_to(p.pid, foreground_pid, &by_pid).unwrap_or(0))
    });
    for p in by_depth {
        if let Some(path) = extract_project_path_from_cmdline(&p.cmd) {
            return Some(path);
        }
    }

    None
}

/// Builds a snapshot of running processes (pid, parent, cmd, cwd) via sysinfo.
/// Refreshes ONLY process cmd/cwd — not CPU, memory, disks — to keep the
/// tracker hot-path cheap. Defensive: fields the OS doesn't expose are absent.
pub fn gather_process_snapshot() -> Vec<ProcInfo> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_cwd(UpdateKind::Always),
    );
    sys.processes()
        .iter()
        .map(|(pid, p)| ProcInfo {
            pid: pid.as_u32(),
            parent_pid: p.parent().map(|pp| pp.as_u32()),
            cmd: p
                .cmd()
                .iter()
                .map(|s| s.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" "),
            cwd: p.cwd().map(|c| c.to_string_lossy().to_string()),
        })
        .collect()
}

/// Derives the most likely project directory for the process tree under the
/// given foreground PID (live snapshot + selector). Used by both the tracker
/// poll loop and the Settings diagnostics command.
pub fn derive_active_context(foreground_pid: u32) -> Option<String> {
    let procs = gather_process_snapshot();
    select_context_from_processes(foreground_pid, &procs)
}

/// Number of parent hops from `pid` up to `ancestor` (0 if equal). `None` if
/// `ancestor` is not reached (cycle-guarded).
fn depth_to(
    pid: u32,
    ancestor: u32,
    by_pid: &std::collections::HashMap<u32, &ProcInfo>,
) -> Option<usize> {
    let mut cur = pid;
    let mut hops = 0;
    let mut seen = std::collections::HashSet::new();
    loop {
        if cur == ancestor {
            return Some(hops);
        }
        if !seen.insert(cur) || hops > 64 {
            return None;
        }
        let parent = by_pid.get(&cur).and_then(|p| p.parent_pid)?;
        cur = parent;
        hops += 1;
    }
}

/// Directories that identify no project, and must therefore never be chosen as
/// context.
///
/// The HOME directory belongs here, and its absence was a real precision bug:
/// selection prefers the DEEPEST descendant with an acceptable cwd, so a helper
/// process that an agent runner spawned at `C:\Users\me` (a language server, a
/// background node) would out-rank the shell that was actually sitting in the
/// project folder — and the activity got the home directory as its "context".
/// On production data that produced 47 minutes of `C:\Users\mads_\` context,
/// which identifies nothing, while the real project folder was right there in
/// the same process tree.
///
/// Only the home directory ITSELF is rejected — never anything below it, since
/// plenty of people keep their projects under it.
fn is_system_dir(path: &str) -> bool {
    let lower = path.trim().to_lowercase().replace('/', "\\");
    let trimmed = lower.trim_end_matches('\\');
    if trimmed.is_empty()
        || trimmed.len() <= 3 // drive root like "c:"
        || trimmed.contains("\\windows")
        || trimmed.contains("\\program files")
        || trimmed.ends_with("\\system32")
    {
        return true;
    }
    is_home_dir(trimmed)
}

/// True when `normalized` (lowercased, backslash-separated, no trailing slash)
/// is the user's home directory itself.
fn is_home_dir(normalized: &str) -> bool {
    let Some(home) = std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
    else {
        return false;
    };
    let home = home.trim().to_lowercase().replace('/', "\\");
    let home = home.trim_end_matches('\\');
    !home.is_empty() && normalized == home
}

/// Recognised source/text file extensions (lowercase). Used to extract the
/// active file from an editor window title without false-positiving on dotted
/// project/folder names.
const FILE_EXTS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "json", "md",
    "toml", "yaml", "yml", "html", "htm", "css", "scss", "less", "txt", "c", "cc", "cpp",
    "h", "hpp", "rb", "php", "sql", "sh", "bash", "ps1", "vue", "svelte", "xml", "cs",
    "swift", "dart", "lua", "ipynb", "csv", "tsv", "cfg", "ini", "lock", "gradle", "rs.bk",
];

/// Extracts the active file name from an editor window title, if present.
/// Editors place the open file in the title (VS Code "main.rs — project",
/// JetBrains "project – Main.java"). The caller gates this to editor apps.
/// Best-effort: returns the first segment that looks like a known file.
pub fn extract_active_file(window_title: &str) -> Option<String> {
    for chunk in window_title.split(['\u{2014}', '\u{2013}', '|']) {
        for part in chunk.split(" - ") {
            let cand = part.trim().trim_start_matches(['●', '*', '•', ' ']).trim();
            if looks_like_filename(cand) {
                return Some(cand.to_string());
            }
        }
    }
    None
}

/// True if `s` is a bare file name with a recognised extension (no path).
fn looks_like_filename(s: &str) -> bool {
    if s.is_empty() || s.contains('\\') || s.contains('/') {
        return false;
    }
    match s.rsplit_once('.') {
        Some((name, ext)) => !name.is_empty() && FILE_EXTS.contains(&ext.to_lowercase().as_str()),
        None => false,
    }
}

/// Derive a short, human-readable label (the last path component) from a path.
pub fn derive_project_label(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches(['/', '\\']);
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Splits a command line into tokens, honoring double-quoted spans so that
/// paths containing spaces stay intact. Quote characters are not retained.
fn tokenize(cmdline: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;

    for ch in cmdline.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

/// Heuristic: does this token look like an absolute filesystem path?
/// Accepts Windows drive paths (`C:\` / `C:/`), UNC paths (`\\host\share`),
/// and Unix absolute paths (`/usr/...`).
fn looks_like_path(token: &str) -> bool {
    let bytes = token.as_bytes();

    // Windows drive: `X:\` or `X:/`
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }

    // UNC: `\\server\share`
    if token.starts_with("\\\\") {
        return true;
    }

    // Unix absolute: `/a/b` (require at least one more separator so a bare `/x`
    // flag-ish token isn't misread).
    if let Some(rest) = token.strip_prefix('/') {
        return rest.contains('/');
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_path_after_dir_flag() {
        assert_eq!(
            extract_project_path_from_cmdline(r"claude --cwd C:\work\api"),
            Some(r"C:\work\api".to_string())
        );
        assert_eq!(
            extract_project_path_from_cmdline("claude --project=/home/me/proj"),
            Some("/home/me/proj".to_string())
        );
        assert_eq!(
            extract_project_path_from_cmdline(r"app -C C:/repos/site"),
            Some("C:/repos/site".to_string())
        );
    }

    #[test]
    fn handles_quoted_path_with_spaces() {
        assert_eq!(
            extract_project_path_from_cmdline(r#"Code.exe "C:\my project\src""#),
            Some(r"C:\my project\src".to_string())
        );
    }

    #[test]
    fn falls_back_to_last_absolute_path() {
        assert_eq!(
            extract_project_path_from_cmdline(r"node C:\proj\script.js"),
            Some(r"C:\proj\script.js".to_string())
        );
        // UNC path
        assert_eq!(
            extract_project_path_from_cmdline(r"app \\nas\share\proj"),
            Some(r"\\nas\share\proj".to_string())
        );
    }

    #[test]
    fn exe_path_alone_is_not_a_project() {
        // Only the executable (index 0) is an absolute path → no project arg.
        assert_eq!(
            extract_project_path_from_cmdline(r"C:\Program Files\Orca\orca.exe"),
            None
        );
    }

    #[test]
    fn no_path_returns_none() {
        assert_eq!(extract_project_path_from_cmdline("claude"), None);
        assert_eq!(extract_project_path_from_cmdline("bash -c ls"), None);
        assert_eq!(extract_project_path_from_cmdline(""), None);
    }

    #[test]
    fn label_is_last_component() {
        assert_eq!(
            derive_project_label(r"C:\work\timetrack-desktop").as_deref(),
            Some("timetrack-desktop")
        );
        assert_eq!(
            derive_project_label("/home/me/api/").as_deref(),
            Some("api")
        );
        assert_eq!(derive_project_label("").as_deref(), None);
    }

    #[test]
    fn unix_single_segment_not_treated_as_path() {
        // `/n` (e.g. a flag-ish token) should not be a path.
        assert!(!looks_like_path("/n"));
        assert!(looks_like_path("/home/x"));
    }

    fn proc(pid: u32, parent: Option<u32>, cmd: &str, cwd: Option<&str>) -> ProcInfo {
        ProcInfo {
            pid,
            parent_pid: parent,
            cmd: cmd.to_string(),
            cwd: cwd.map(str::to_string),
        }
    }

    #[test]
    fn selects_active_shell_cwd_under_constant_title_app() {
        // Orca (10) -> pwsh (20, cwd projA) -> claude (30, cwd projA)
        let procs = vec![
            proc(10, None, r"C:\Apps\orca.exe", Some(r"C:\Apps")),
            proc(20, Some(10), "pwsh.exe", Some(r"C:\work\projA")),
            proc(30, Some(20), "node cli.js", Some(r"C:\work\projA")),
        ];
        assert_eq!(
            select_context_from_processes(10, &procs),
            Some(r"C:\work\projA".to_string())
        );
    }

    #[test]
    fn deepest_descendant_cwd_wins() {
        // Two shells; the deeper one's project is the active context.
        let procs = vec![
            proc(10, None, "wt.exe", None),
            proc(20, Some(10), "pwsh", Some(r"C:\work\projA")),
            proc(30, Some(20), "pwsh", Some(r"C:\work\projB")),
        ];
        assert_eq!(
            select_context_from_processes(10, &procs),
            Some(r"C:\work\projB".to_string())
        );
    }

    /// Regression: an agent runner spawns a helper at the HOME directory, deeper
    /// in the tree than the shell that is actually in the project. Because
    /// selection prefers the deepest cwd, home used to win — and the activity
    /// was recorded with `C:\Users\me` as its "context", which identifies no
    /// project at all. On real data this cost 47 minutes of usable context.
    #[test]
    fn home_directory_never_outranks_a_real_project_dir() {
        let Some(home) = std::env::var("USERPROFILE")
            .ok()
            .or_else(|| std::env::var("HOME").ok())
        else {
            return; // no home in this environment — nothing to assert
        };

        // Orca (10) -> pwsh (20, cwd projA) -> helper (30, cwd HOME)
        let procs = vec![
            proc(10, None, r"C:\Apps\orca.exe", None),
            proc(20, Some(10), "pwsh", Some(r"C:\work\projA")),
            proc(30, Some(20), "node helper.js", Some(&home)),
        ];
        assert_eq!(
            select_context_from_processes(10, &procs),
            Some(r"C:\work\projA".to_string()),
            "the shell's project must win over a helper sitting at home"
        );
    }

    /// Home alone yields no context at all — better an honest blank than a
    /// directory that means nothing.
    #[test]
    fn home_directory_alone_is_not_a_context() {
        let Some(home) = std::env::var("USERPROFILE")
            .ok()
            .or_else(|| std::env::var("HOME").ok())
        else {
            return;
        };
        let procs = vec![
            proc(10, None, r"C:\Apps\orca.exe", None),
            proc(20, Some(10), "pwsh", Some(&home)),
        ];
        assert_eq!(select_context_from_processes(10, &procs), None);
    }

    #[test]
    fn ignores_system_dirs_and_falls_back_to_cmdline() {
        let procs = vec![
            proc(10, None, "orca.exe", Some(r"C:\Windows\System32")),
            proc(20, Some(10), r"claude --cwd C:\repos\api", Some(r"C:\Windows")),
        ];
        assert_eq!(
            select_context_from_processes(10, &procs),
            Some(r"C:\repos\api".to_string())
        );
    }

    #[test]
    fn unrelated_processes_are_ignored() {
        // pid 99 is not a descendant of foreground 10 → its cwd must be ignored.
        let procs = vec![
            proc(10, None, "orca.exe", None),
            proc(99, Some(1), "code", Some(r"C:\other\proj")),
        ];
        assert_eq!(select_context_from_processes(10, &procs), None);
    }

    #[test]
    fn no_context_returns_none() {
        let procs = vec![proc(10, None, "orca.exe", None)];
        assert_eq!(select_context_from_processes(10, &procs), None);
    }

    #[test]
    fn active_file_from_vscode_title() {
        assert_eq!(
            extract_active_file("main.rs \u{2014} timetrack-desktop").as_deref(),
            Some("main.rs")
        );
        // Unsaved indicator is stripped.
        assert_eq!(
            extract_active_file("\u{25cf} lib.rs \u{2014} project").as_deref(),
            Some("lib.rs")
        );
    }

    #[test]
    fn active_file_from_jetbrains_title() {
        assert_eq!(
            extract_active_file("timetrack \u{2013} Main.java").as_deref(),
            Some("Main.java")
        );
    }

    #[test]
    fn dotted_project_name_is_not_a_file() {
        // "my.app" has an unrecognised extension → not treated as the active file;
        // the real file (first segment in VS Code order) is returned.
        assert_eq!(
            extract_active_file("App.tsx \u{2014} my.app").as_deref(),
            Some("App.tsx")
        );
        assert_eq!(extract_active_file("my.app \u{2014} workspace"), None);
    }

    #[test]
    fn paths_and_non_files_are_ignored() {
        // Browser-style title with a path segment must not match.
        assert_eq!(extract_active_file("GitHub - org/repo/main.rs at main"), None);
        assert_eq!(extract_active_file("Slack | general"), None);
        assert_eq!(extract_active_file(""), None);
    }
}
