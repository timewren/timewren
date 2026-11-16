//! Git-identitet læst direkte fra `.git`, uden at starte `git`.
//!
//! Den gamle tracker brugte mappenavnet som repo-identitet. To kunder med
//! hver sit "website"-repo blev derfor til ét. Nu er identiteten den
//! normaliserede remote-URL (`github.com/acme/timetrack`) og ellers repoets
//! rodsti. Ingen subprocess betyder ingen hængende `git` i poll-løkken og
//! ingen konsolvinduer på Windows.

use std::path::{Path, PathBuf};

/// Et repo fundet ud fra en mappe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoInfo {
    /// Repoets rodmappe (mappen med `.git`).
    pub root: PathBuf,
    /// Sidste del af rodstien. Kun til visning, aldrig identitet.
    pub name: String,
    /// Normaliseret remote-URL, helst `origin`.
    pub remote: Option<String>,
    /// Aktiv gren. `None` ved detached HEAD.
    pub branch: Option<String>,
}

/// Maks. antal forældremapper, der gennemsøges for `.git`.
const MAX_DEPTH: usize = 40;

/// Finder repoet, som `dir` ligger i (eller er roden af).
pub fn find_repo(dir: &Path) -> Option<RepoInfo> {
    let mut cur = Some(dir);
    let mut depth = 0;
    while let Some(d) = cur {
        if depth > MAX_DEPTH {
            return None;
        }
        let dotgit = d.join(".git");
        if let Some(git_dir) = resolve_git_dir(&dotgit) {
            return Some(read_repo(d, &git_dir));
        }
        cur = d.parent();
        depth += 1;
    }
    None
}

/// `.git` er normalt en mappe. I worktrees og submoduler er det en fil med
/// `gitdir: <sti>`.
fn resolve_git_dir(dotgit: &Path) -> Option<PathBuf> {
    let meta = std::fs::metadata(dotgit).ok()?;
    if meta.is_dir() {
        return Some(dotgit.to_path_buf());
    }
    let content = std::fs::read_to_string(dotgit).ok()?;
    let target = content
        .lines()
        .find_map(|l| l.strip_prefix("gitdir:"))?
        .trim();
    let p = PathBuf::from(target);
    let p = if p.is_absolute() {
        p
    } else {
        dotgit.parent()?.join(p)
    };
    p.is_dir().then_some(p)
}

fn read_repo(root: &Path, git_dir: &Path) -> RepoInfo {
    // Worktrees deler config med hovedrepoet via `commondir`.
    let common = std::fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map(|c| {
            let p = PathBuf::from(c.trim());
            if p.is_absolute() { p } else { git_dir.join(p) }
        })
        .unwrap_or_else(|| git_dir.to_path_buf());

    let branch = std::fs::read_to_string(git_dir.join("HEAD"))
        .ok()
        .and_then(|h| branch_from_head(&h));
    let remote = std::fs::read_to_string(common.join("config"))
        .ok()
        .and_then(|c| remote_from_config(&c))
        .and_then(|u| normalize_remote_url(&u));

    RepoInfo {
        root: root.to_path_buf(),
        name: repo_name(&root.to_string_lossy()).unwrap_or_default(),
        remote,
        branch,
    }
}

/// `ref: refs/heads/main` → `main`. Detached HEAD (en SHA) → `None`.
pub fn branch_from_head(head: &str) -> Option<String> {
    head.trim()
        .strip_prefix("ref:")
        .map(str::trim)
        .and_then(|r| r.strip_prefix("refs/heads/"))
        .filter(|b| !b.is_empty())
        .map(str::to_string)
}

/// Remote-URL fra en git-config. `origin` foretrækkes, ellers den første.
pub fn remote_from_config(config: &str) -> Option<String> {
    let mut current: Option<String> = None;
    let mut first: Option<String> = None;
    let mut origin: Option<String> = None;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            current = line
                .strip_prefix("[remote \"")
                .and_then(|r| r.strip_suffix("\"]"))
                .map(str::to_string);
            continue;
        }
        let Some(name) = &current else { continue };
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("url") {
            continue;
        }
        let value = value.trim().trim_matches('"').to_string();
        if name == "origin" && origin.is_none() {
            origin = Some(value.clone());
        }
        if first.is_none() {
            first = Some(value);
        }
    }
    origin.or(first)
}

/// Normaliserer en git-remote til `host/sti` i små bogstaver uden `.git`.
///
/// Brugernavn, adgangskode og token fjernes altid (de må aldrig gemmes), og
/// SSH- og HTTPS-formen af samme repo bliver ens:
///
/// | input | output |
/// |---|---|
/// | `git@github.com:acme/TimeTrack.git` | `github.com/acme/timetrack` |
/// | `https://tok@github.com/acme/timetrack` | `github.com/acme/timetrack` |
/// | `ssh://git@git.example.com:2222/acme/x.git` | `git.example.com/acme/x` |
pub fn normalize_remote_url(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let (host, path) = if let Some((_, rest)) = s.split_once("://") {
        // ssh://, https://, git://, file://
        if s.to_ascii_lowercase().starts_with("file://") {
            return Some(normalize_path_like(rest));
        }
        let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
        let host = authority.rsplit('@').next().unwrap_or(authority);
        let host = host.split(':').next().unwrap_or(host);
        (host.to_string(), path.to_string())
    } else if let Some((left, path)) = scp_like(s) {
        let host = left.rsplit('@').next().unwrap_or(left);
        (host.to_string(), path.to_string())
    } else {
        // Lokal sti som remote.
        return Some(normalize_path_like(s));
    };
    let path = path
        .trim_matches('/')
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_lowercase();
    let host = host.to_lowercase();
    if host.is_empty() {
        return None;
    }
    if path.is_empty() {
        Some(host)
    } else {
        Some(format!("{host}/{path}"))
    }
}

/// `git@host:sti` (scp-syntaks). Ikke `C:\sti`, som også har et kolon.
fn scp_like(s: &str) -> Option<(&str, &str)> {
    let (left, right) = s.split_once(':')?;
    if left.len() == 1 || left.contains('/') || left.contains('\\') {
        return None;
    }
    Some((left, right))
}

fn normalize_path_like(s: &str) -> String {
    s.replace('\\', "/")
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .to_lowercase()
}

/// Sidste del af en sti (begge separatorer, afsluttende skråstreg tolereres).
pub fn repo_name(toplevel: &str) -> Option<String> {
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

/// Så meget af reflog'en læses højst (fra enden).
const REFLOG_TAIL_BYTES: u64 = 64 * 1024;

/// Commit-emner fra repoets reflog (`.git/logs/HEAD`), lavet mellem `from` og
/// `to` (unix-sekunder), ældste først, højst 10. Kun selve emnet: navn og
/// mail i reflog-linjen læses aldrig ud. Ingen `git`-proces, kun de sidste
/// 64 KB af én fil, så det er billigt at kalde pr. forslag.
pub fn commits_between(repo_root: &Path, from: i64, to: i64) -> Vec<String> {
    use std::io::{Read, Seek, SeekFrom};
    let Some(git_dir) = resolve_git_dir(&repo_root.join(".git")) else {
        return Vec::new();
    };
    let Ok(mut f) = std::fs::File::open(git_dir.join("logs").join("HEAD")) else {
        return Vec::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(REFLOG_TAIL_BYTES);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines = text.lines();
    if start > 0 {
        // Første linje er skåret over.
        lines.next();
    }
    let mut out: Vec<String> = lines
        .filter_map(parse_reflog_commit)
        .filter(|(ts, _)| (from..=to).contains(ts))
        .map(|(_, subject)| subject)
        .collect();
    if out.len() > 10 {
        out.drain(..out.len() - 10);
    }
    out
}

/// `<gammel> <ny> <navn> <mail> <tid> <zone>\tcommit: <emne>` → (tid, emne).
/// Andet end commits (checkout, reset, rebase) giver `None`.
fn parse_reflog_commit(line: &str) -> Option<(i64, String)> {
    let (meta, message) = line.split_once('\t')?;
    let mut parts = meta.rsplitn(3, ' ');
    let _zone = parts.next()?;
    let ts: i64 = parts.next()?.parse().ok()?;
    let (kind, subject) = message.split_once(": ")?;
    if !(kind == "commit" || kind.starts_with("commit (")) {
        return None;
    }
    let subject: String = subject.trim().chars().take(200).collect();
    (!subject.is_empty()).then_some((ts, subject))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reflog_commits_only_subjects_in_window() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join(".git").join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        let z = "0000000000000000000000000000000000000000";
        let a = "1111111111111111111111111111111111111111";
        let lines = [
            format!("{z} {a} Jens Hansen <jens@example.com> 1000 +0100\tcommit (initial): Første commit"),
            format!("{a} {a} Jens Hansen <jens@example.com> 2000 +0100\tcheckout: moving from main to feat/TT-1"),
            format!("{a} {a} Jens Hansen <jens@example.com> 2100 +0100\tcommit: TT-1 login med link"),
            format!("{a} {a} Jens Hansen <jens@example.com> 2200 +0100\tcommit (amend): TT-1 login med magisk link"),
            format!("{a} {a} Jens Hansen <jens@example.com> 9000 +0100\tcommit: senere"),
        ];
        std::fs::write(logs.join("HEAD"), lines.join("\n") + "\n").unwrap();
        let got = commits_between(dir.path(), 1500, 3000);
        assert_eq!(got, vec!["TT-1 login med link", "TT-1 login med magisk link"]);
        assert!(got.iter().all(|s| !s.contains("jens")));
        // Uden repo: intet.
        assert!(commits_between(&dir.path().join("findes-ikke"), 0, i64::MAX).is_empty());
    }

    #[test]
    fn reflog_tail_skips_cut_line() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join(".git").join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        let mut text = String::new();
        for i in 0..2000 {
            text.push_str(&format!(
                "{0} {0} N <m@x> {1} +0000\tcommit: emne {i} med en lidt længere tekst\n",
                "a".repeat(40),
                i
            ));
        }
        std::fs::write(logs.join("HEAD"), text).unwrap();
        let got = commits_between(dir.path(), 0, i64::MAX);
        assert_eq!(got.len(), 10);
        assert_eq!(got.last().unwrap(), "emne 1999 med en lidt længere tekst");
    }

    #[test]
    fn repo_name_extracts_last_component() {
        assert_eq!(
            repo_name("/home/mads/projects/timetrack").as_deref(),
            Some("timetrack")
        );
        assert_eq!(
            repo_name("C:/Projects/Egne/timetrack-desktop").as_deref(),
            Some("timetrack-desktop")
        );
        assert_eq!(
            repo_name(r"C:\Projects\Egne\my-repo").as_deref(),
            Some("my-repo")
        );
    }

    #[test]
    fn repo_name_handles_trailing_slash_and_empty() {
        assert_eq!(repo_name("/home/mads/repo/").as_deref(), Some("repo"));
        assert_eq!(repo_name("").as_deref(), None);
        assert_eq!(repo_name("   ").as_deref(), None);
        assert_eq!(repo_name("/").as_deref(), None);
    }

    #[test]
    fn remote_ssh_and_https_normalize_equal() {
        let a = normalize_remote_url("git@github.com:acme/TimeTrack.git");
        let b = normalize_remote_url("https://github.com/acme/timetrack");
        let c = normalize_remote_url("https://github.com/acme/timetrack.git/");
        assert_eq!(a.as_deref(), Some("github.com/acme/timetrack"));
        assert_eq!(a, b);
        assert_eq!(a, c);
    }

    #[test]
    fn remote_strips_credentials_and_port() {
        assert_eq!(
            normalize_remote_url("https://user:ghp_secret@github.com/acme/x.git").as_deref(),
            Some("github.com/acme/x")
        );
        assert_eq!(
            normalize_remote_url("ssh://git@git.example.com:2222/acme/timetrack-desktop.git")
                .as_deref(),
            Some("git.example.com/acme/timetrack-desktop")
        );
        assert_eq!(
            normalize_remote_url("git@git.example.com:acme/timetrack-desktop.git").as_deref(),
            Some("git.example.com/acme/timetrack-desktop")
        );
    }

    #[test]
    fn remote_local_paths() {
        assert_eq!(
            normalize_remote_url(r"C:\repos\bare\x.git").as_deref(),
            Some("c:/repos/bare/x")
        );
        assert_eq!(
            normalize_remote_url("/srv/git/x.git").as_deref(),
            Some("/srv/git/x")
        );
        assert_eq!(
            normalize_remote_url("file:///srv/git/x.git").as_deref(),
            Some("/srv/git/x")
        );
        assert_eq!(normalize_remote_url("  "), None);
    }

    #[test]
    fn two_website_repos_stay_distinct() {
        // Kendt fejl i 0.2: begge hed "website" og blev ét projekt.
        let a = normalize_remote_url("git@github.com:bageriet/website.git");
        let b = normalize_remote_url("git@github.com:frisoeren/website.git");
        assert_ne!(a, b);
    }

    #[test]
    fn branch_from_head_parses_ref_and_detached() {
        assert_eq!(
            branch_from_head("ref: refs/heads/main\n").as_deref(),
            Some("main")
        );
        assert_eq!(
            branch_from_head("ref: refs/heads/v1/tracker").as_deref(),
            Some("v1/tracker")
        );
        assert_eq!(
            branch_from_head("4b825dc642cb6eb9a060e54bf8d69288fbee4904"),
            None
        );
    }

    #[test]
    fn remote_from_config_prefers_origin() {
        let cfg = "[core]\n\tbare = false\n[remote \"upstream\"]\n\turl = git@github.com:a/b.git\n[remote \"origin\"]\n\turl = https://github.com/c/d.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n";
        assert_eq!(
            remote_from_config(cfg).as_deref(),
            Some("https://github.com/c/d.git")
        );
        let only = "[remote \"fork\"]\n url = git@x.dk:y/z.git\n";
        assert_eq!(
            remote_from_config(only).as_deref(),
            Some("git@x.dk:y/z.git")
        );
        assert_eq!(remote_from_config("[core]\n"), None);
    }

    #[test]
    fn find_repo_reads_handmade_git_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("website");
        let git = root.join(".git");
        std::fs::create_dir_all(git.join("refs")).unwrap();
        std::fs::write(git.join("HEAD"), "ref: refs/heads/feat/x\n").unwrap();
        std::fs::write(
            git.join("config"),
            "[remote \"origin\"]\n\turl = git@github.com:Bageriet/Website.git\n",
        )
        .unwrap();
        let deep = root.join("src").join("pages");
        std::fs::create_dir_all(&deep).unwrap();

        let info = find_repo(&deep).expect("repo");
        assert_eq!(info.root, root);
        assert_eq!(info.name, "website");
        assert_eq!(info.branch.as_deref(), Some("feat/x"));
        assert_eq!(info.remote.as_deref(), Some("github.com/bageriet/website"));
    }

    #[test]
    fn find_repo_follows_worktree_gitdir_file() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let main_git = main.join(".git");
        let wt_git = main_git.join("worktrees").join("wt");
        std::fs::create_dir_all(&wt_git).unwrap();
        std::fs::write(
            main_git.join("config"),
            "[remote \"origin\"]\n url = git@h.dk:o/r.git\n",
        )
        .unwrap();
        std::fs::write(wt_git.join("HEAD"), "ref: refs/heads/agent/x\n").unwrap();
        std::fs::write(wt_git.join("commondir"), "../..\n").unwrap();
        let wt = tmp.path().join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", wt_git.display())).unwrap();

        let info = find_repo(&wt).expect("worktree repo");
        assert_eq!(info.root, wt);
        assert_eq!(info.branch.as_deref(), Some("agent/x"));
        assert_eq!(info.remote.as_deref(), Some("h.dk/o/r"));
    }

    #[test]
    fn find_repo_none_outside_repo() {
        let tmp = tempfile::tempdir().unwrap();
        // tempdir ligger typisk ikke i et repo; er den det, er testen meningsløs.
        if find_repo(tmp.path()).is_some() {
            return;
        }
        assert!(find_repo(&tmp.path().join("findes-ikke")).is_none());
    }

    #[test]
    fn find_repo_matches_real_git_init_when_available() {
        let ok = std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !ok {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("ægte-repo");
        std::fs::create_dir_all(&root).unwrap();
        let inited = std::process::Command::new("git")
            .args(["init", "-q", "-b", "main"])
            .current_dir(&root)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !inited {
            return;
        }
        let _ = std::process::Command::new("git")
            .args(["remote", "add", "origin", "git@github.com:acme/Ægte.git"])
            .current_dir(&root)
            .status();
        let info = find_repo(&root).expect("repo");
        assert_eq!(info.name, "ægte-repo");
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(info.remote.as_deref(), Some("github.com/acme/ægte"));
    }
}
