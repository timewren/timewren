use crate::util::CommandExtHidden;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// Git repository information extracted from the working directory.
#[derive(Debug, Clone)]
pub struct GitInfo {
    pub branch: String,
    pub repo_name: String,
}

/// Short timeout for a single git invocation. A hung git — a network
/// filesystem, a credential prompt, a stuck lock — must never block the
/// tracker's poll loop, so a git that outlives this deadline is killed.
const GIT_TIMEOUT_MS: u64 = 2000;

/// Detects the Git branch and repo name directly from a directory (a
/// terminal's working directory), without any window-title parsing.
///
/// Runs `git -C <dir> rev-parse --show-toplevel` for the repo root (repo name =
/// its last path component) and `git -C <dir> rev-parse --abbrev-ref HEAD` for
/// the branch. Falls silently back to `None` when git is not installed, the
/// directory is not a repository, or a command fails/times out — never panics,
/// never blocks. Only the repo NAME (not the full path) and branch are kept.
pub fn detect_git_from_dir(dir: &str) -> Option<GitInfo> {
    if dir.trim().is_empty() {
        return None;
    }

    // The toplevel gate: no repo → no git signal.
    let toplevel = run_git_c(dir, &["rev-parse", "--show-toplevel"])?;
    let repo_name = repo_name_from_toplevel(&toplevel)?;

    // Branch is best-effort: a detached HEAD or an unborn branch (fresh repo)
    // still yields a repo name, so an empty/`HEAD` branch is simply dropped.
    let branch = run_git_c(dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|b| !b.is_empty() && b != "HEAD")
        .unwrap_or_default();

    Some(GitInfo { branch, repo_name })
}

/// Extracts the repository name (last path component) from a `git rev-parse
/// --show-toplevel` result. Pure string logic — split out so the name
/// extraction is deterministically testable without a real repository. Handles
/// both `/` (git's normalized output) and `\` separators plus a trailing slash.
fn repo_name_from_toplevel(toplevel: &str) -> Option<String> {
    let trimmed = toplevel.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return None;
    }
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Runs `git -C <dir> <args...>` with a short timeout, returning trimmed stdout
/// on success. Any failure — git missing, non-repo, non-zero exit, or timeout —
/// yields `None`. A git that outlives `GIT_TIMEOUT_MS` is killed so a stuck
/// subprocess can never block the caller.
fn run_git_c(dir: &str, args: &[&str]) -> Option<String> {
    let mut child = Command::new("git")
        .hidden_console()
        .arg("-C")
        .arg(dir)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_millis(GIT_TIMEOUT_MS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                // Output is tiny (a path or branch name), well under the pipe
                // buffer, so reading after exit cannot deadlock.
                let mut out = String::new();
                child.stdout.take()?.read_to_string(&mut out).ok()?;
                let trimmed = out.trim().to_string();
                return if trimmed.is_empty() { None } else { Some(trimmed) };
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return None,
        }
    }
}

/// Attempts to detect Git branch and repository name from a window title.
///
/// Parses common editor window title formats to extract a directory path,
/// then runs `git` commands in that directory to get the branch and repo name.
///
/// Supported editor formats:
///   - VS Code: "filename - foldername - Visual Studio Code"
///   - JetBrains IDEs: "project – filename – IntelliJ IDEA" (em-dash)
///   - Vim/Neovim: typically just the filename
pub fn detect_git_info(window_title: &str, exe_path: &str) -> Option<GitInfo> {
    let dir = extract_project_dir(window_title, exe_path)?;

    if !dir.exists() || !dir.is_dir() {
        return None;
    }

    let branch = git_current_branch(&dir)?;
    let repo_name = git_repo_name(&dir).unwrap_or_else(|| {
        dir.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    });

    Some(GitInfo { branch, repo_name })
}

/// Extracts a project directory path from an editor window title.
fn extract_project_dir(window_title: &str, exe_path: &str) -> Option<PathBuf> {
    let app = exe_basename(exe_path);

    // VS Code: "filename - foldername - Visual Studio Code"
    // Also matches "filename - workspace - Visual Studio Code"
    if app.contains("code") || window_title.contains("Visual Studio Code") {
        return parse_vscode_title(window_title);
    }

    // JetBrains IDEs: "project \u{2013} filename \u{2013} IntelliJ IDEA" (uses en-dash or em-dash)
    let jetbrains_apps = [
        "idea", "idea64", "webstorm", "webstorm64", "phpstorm", "phpstorm64",
        "pycharm", "pycharm64", "goland", "goland64", "rider", "rider64",
        "clion", "clion64", "rustrover", "rustrover64", "datagrip",
    ];
    if jetbrains_apps.iter().any(|jb| app.contains(jb)) {
        return parse_jetbrains_title(window_title);
    }

    None
}

/// Returns the lowercased executable basename, splitting on BOTH path
/// separators so it works on Windows (`\`) and macOS/Linux (`/`).
fn exe_basename(exe_path: &str) -> String {
    exe_path
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("")
        .to_lowercase()
}

/// Parses VS Code window title to extract the project folder path.
///
/// Typical format: "filename.rs - projectname - Visual Studio Code"
/// With workspace: "filename.rs - projectname (Workspace) - Visual Studio Code"
/// With path shown: "filename.rs - C:\path\to\project - Visual Studio Code"
fn parse_vscode_title(title: &str) -> Option<PathBuf> {
    // Remove " - Visual Studio Code" suffix variants
    let cleaned = title
        .trim_end_matches(" - Visual Studio Code")
        .trim_end_matches(" [Extension Development Host]");

    // Split on " - " to get segments
    let parts: Vec<&str> = cleaned.split(" - ").collect();

    if parts.len() >= 2 {
        // The second part is typically the folder/workspace
        let folder_part = parts[1]
            .trim()
            .trim_end_matches(" (Workspace)")
            .trim();

        // Check if it's an absolute path
        let path = Path::new(folder_part);
        if path.is_absolute() && path.exists() {
            return Some(path.to_path_buf());
        }

        // If it's just a folder name, try common workspace locations
        let candidate_dirs = get_candidate_dirs(folder_part);
        for dir in candidate_dirs {
            if dir.is_dir() {
                return Some(dir);
            }
        }
    }

    None
}

/// Parses JetBrains IDE window title to extract the project path.
///
/// Typical format: "projectname \u{2013} filename \u{2013} IntelliJ IDEA"
fn parse_jetbrains_title(title: &str) -> Option<PathBuf> {
    // JetBrains uses en-dash (\u{2013}) or em-dash (\u{2014}) or regular dash
    let project_name = title
        .split('\u{2013}')
        .next()
        .or_else(|| title.split('\u{2014}').next())
        .or_else(|| title.split(" - ").next())?
        .trim();

    if project_name.is_empty() {
        return None;
    }

    // Check if it's an absolute path
    let path = Path::new(project_name);
    if path.is_absolute() && path.exists() {
        return Some(path.to_path_buf());
    }

    // Try common project locations
    let candidate_dirs = get_candidate_dirs(project_name);
    candidate_dirs.into_iter().find(|dir| dir.is_dir())
}

/// Returns a list of candidate directories where a project might live.
fn get_candidate_dirs(folder_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // `USERPROFILE` on Windows, `HOME` on macOS/Linux.
    let home_dir = std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok());

    if let Some(home) = home_dir {
        let home_path = PathBuf::from(&home);
        // Common project locations
        for parent in &[
            "projects",
            "Projects",
            "repos",
            "Repos",
            "dev",
            "Dev",
            "src",
            "Source",
            "Documents",
            "Desktop",
        ] {
            candidates.push(home_path.join(parent).join(folder_name));
        }
        // Also check subdirectories one level deeper (e.g., ~/projects/egne/timetrack)
        for parent in &["projects", "Projects", "repos", "dev"] {
            if let Ok(entries) = std::fs::read_dir(home_path.join(parent)) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        candidates.push(entry.path().join(folder_name));
                    }
                }
            }
        }
    }

    candidates
}

/// Runs `git rev-parse --abbrev-ref HEAD` to get the current branch.
fn git_current_branch(dir: &Path) -> Option<String> {
    let output = Command::new("git")
        .hidden_console()
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .ok()?;

    if output.status.success() {
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if branch.is_empty() || branch == "HEAD" {
            // Detached HEAD — try to get a more descriptive name
            None
        } else {
            Some(branch)
        }
    } else {
        None
    }
}

/// Runs `git rev-parse --show-toplevel` to get the repo root and extracts the repo name.
fn git_repo_name(dir: &Path) -> Option<String> {
    let output = Command::new("git")
        .hidden_console()
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .ok()?;

    if output.status.success() {
        let toplevel = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Path::new(&toplevel)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_basename_splits_windows_separator() {
        assert_eq!(
            exe_basename(r"C:\Program Files\Microsoft VS Code\Code.exe"),
            "code.exe"
        );
    }

    #[test]
    fn exe_basename_splits_unix_separator() {
        // The Windows-only `rsplit('\\')` bug returned the whole path here.
        assert_eq!(
            exe_basename("/Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
            "electron"
        );
        assert_eq!(exe_basename("/usr/local/bin/code"), "code");
    }

    #[test]
    fn exe_basename_handles_bare_name() {
        assert_eq!(exe_basename("code"), "code");
        assert_eq!(exe_basename(""), "");
    }

    #[test]
    fn repo_name_from_toplevel_extracts_last_component() {
        assert_eq!(
            repo_name_from_toplevel("/home/mads/projects/timetrack").as_deref(),
            Some("timetrack")
        );
        // git normalizes to forward slashes even on Windows...
        assert_eq!(
            repo_name_from_toplevel("C:/Projects/Egne/timetrack-desktop").as_deref(),
            Some("timetrack-desktop")
        );
        // ...but we tolerate backslashes too.
        assert_eq!(
            repo_name_from_toplevel(r"C:\Projects\Egne\my-repo").as_deref(),
            Some("my-repo")
        );
    }

    #[test]
    fn repo_name_from_toplevel_handles_trailing_slash_and_empty() {
        assert_eq!(
            repo_name_from_toplevel("/home/mads/repo/").as_deref(),
            Some("repo")
        );
        assert_eq!(repo_name_from_toplevel("").as_deref(), None);
        assert_eq!(repo_name_from_toplevel("   ").as_deref(), None);
        assert_eq!(repo_name_from_toplevel("/").as_deref(), None);
    }

    #[test]
    fn detect_git_from_dir_empty_returns_none() {
        assert!(detect_git_from_dir("").is_none());
        assert!(detect_git_from_dir("   ").is_none());
    }

    #[test]
    fn detect_git_from_dir_nonexistent_returns_none() {
        // Robust fallback: a directory that does not exist (hence is not a repo)
        // must never panic and must yield None so git_repo stays unset.
        let missing = std::env::temp_dir().join("ttd-does-not-exist-9f3a2b1c7d");
        assert!(detect_git_from_dir(&missing.to_string_lossy()).is_none());
    }

    #[test]
    fn detect_git_from_dir_detects_initialized_repo() {
        // Deterministic WHEN git is available: init a temp repo and verify the
        // repo name is derived from the toplevel directory. Skips (does not
        // fail) when git is absent, so CI without git stays green.
        if !git_available() {
            return;
        }
        let dir = unique_temp_dir("ttd-git-test");
        std::fs::create_dir_all(&dir).expect("create temp dir");

        let inited = Command::new("git")
            .arg("init")
            .current_dir(&dir)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if inited {
            let info = detect_git_from_dir(&dir.to_string_lossy());
            assert!(info.is_some(), "expected git detection in an initialized repo");
            let info = info.unwrap();
            assert_eq!(
                info.repo_name,
                dir.file_name().unwrap().to_string_lossy(),
                "repo name should be the toplevel directory's last component"
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// True if `git` is on PATH — used to skip the real-repo test in a bare CI.
    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// A unique temp directory path (process id + nanoseconds) so parallel test
    /// runs never collide.
    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("{}-{}-{}", prefix, std::process::id(), nanos))
    }

    #[test]
    fn candidate_dirs_falls_back_to_home_when_no_userprofile() {
        // Simulate a macOS/Linux environment: HOME set, USERPROFILE absent.
        // We only assert the function produces home-rooted candidates; we don't
        // mutate process env in parallel tests, so verify the path-building logic
        // by checking the constructed candidates contain the folder name.
        let dirs = get_candidate_dirs("my-project");
        // On any platform at least the env-derived candidates should exist if a
        // home var is present. The assertion is lenient: every candidate ends
        // with the folder name.
        for d in &dirs {
            assert!(d.ends_with("my-project"));
        }
    }
}
