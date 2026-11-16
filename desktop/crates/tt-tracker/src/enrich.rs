//! Berigelse: rå vindue → [`Signals`] (titel, URL, domæne, arbejdsmappe,
//! repo, dokument). Udelukkede vinduer giver `None` og gemmes aldrig.
//!
//! Dyre opslag (AppleScript/UIA, editor-state, procestræ, `.git`) caches og
//! genberegnes kun, når nøglen skifter eller værdien er forældet.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::config::TrackerConfig;
use crate::editors::{self, EditorKind, Workspace};
use crate::exclusion::{ExclusionRule, hints_say_private, is_incognito_window, should_exclude};
use crate::git::{self, RepoInfo};
use crate::paths::{expand_home, looks_absolute, normalize_path, path_from_file_uri};
use crate::platform::{Platform, app_id};
use crate::process_context;
use crate::title;
use crate::types::{BrowserUrl, RawWindow, Signals};
use crate::url::{domain_of, normalize_url};
use crate::util::TtlCache;

/// Browsere, hvis adresselinje læses (app-id, små bogstaver).
const BROWSERS: &[&str] = &[
    "safari",
    "safari technology preview",
    "google chrome",
    "google chrome beta",
    "chrome",
    "chromium",
    "arc",
    "microsoft edge",
    "msedge",
    "brave browser",
    "brave",
    "firefox",
    "vivaldi",
    "opera",
    "zen",
    "zen browser",
];

/// Programmer, hvis titel ikke siger hvilket projekt; arbejdsmappen findes
/// via terminalen selv eller procestræet (terminaler og agent-CLI'er).
const TERMINALS: &[&str] = &[
    "terminal",
    "iterm",
    "iterm2",
    "windowsterminal",
    "openconsole",
    "wt",
    "powershell",
    "pwsh",
    "cmd",
    "conhost",
    "alacritty",
    "wezterm",
    "wezterm-gui",
    "kitty",
    "hyper",
    "warp",
    "ghostty",
    "tmux",
    "tabby",
    "rio",
    "orca",
    "claude",
    "codex",
    "aider",
    "gemini",
];

/// Andre editorer uden state-fil, hvor titlen kan nævne fil og mappe.
const PLAIN_EDITORS: &[&str] = &[
    "sublime_text",
    "sublime text",
    "notepad++",
    "vim",
    "nvim",
    "neovide",
    "xcode",
    "nova",
    "bbedit",
];

pub fn is_browser(app_id: &str) -> bool {
    BROWSERS.contains(&app_id)
}

pub fn is_terminal(app_id: &str) -> bool {
    TERMINALS.contains(&app_id)
}

pub struct Enricher {
    url: TtlCache<(Option<u32>, Option<u64>, String), BrowserUrl>,
    workspaces: TtlCache<Option<EditorKind>, Vec<Workspace>>,
    proc_tree: TtlCache<Option<u32>, Option<String>>,
    terminal: TtlCache<(Option<u32>, String), Option<String>>,
    repo: TtlCache<String, Option<RepoInfo>>,
    roots_found: TtlCache<String, Option<PathBuf>>,
}

impl Default for Enricher {
    fn default() -> Self {
        Self::new()
    }
}

impl Enricher {
    pub fn new() -> Self {
        Self::with_ttls(
            Duration::from_secs(5),
            Duration::from_secs(15),
            Duration::from_secs(12),
        )
    }

    /// Til tests: alle caches med samme (fx nul) levetid.
    pub fn with_ttls(url: Duration, state: Duration, probe: Duration) -> Self {
        Self {
            url: TtlCache::new(url),
            workspaces: TtlCache::new(state),
            proc_tree: TtlCache::new(probe),
            terminal: TtlCache::new(probe),
            repo: TtlCache::new(probe),
            roots_found: TtlCache::new(state),
        }
    }

    /// Beriger et råt vindue. `rules` er konfigurationens regler plus de
    /// gemte i aktivitets-DB'en.
    pub fn enrich(
        &mut self,
        raw: RawWindow,
        cfg: &TrackerConfig,
        rules: &[ExclusionRule],
        platform: &mut dyn Platform,
    ) -> Option<Signals> {
        // Privatliv først, på den RÅ titel og vinduets øvrige AX-tekster.
        let private = is_incognito_window(&raw.title) || hints_say_private(&raw.accessibility_hints);
        if private && cfg.exclude_incognito {
            return None;
        }
        if should_exclude(
            &raw.app_name,
            &raw.title,
            None,
            rules,
            cfg.exclude_incognito,
        ) {
            return None;
        }
        let id = app_id(&raw.exe_path, &raw.app_name);
        let normalized_title = title::normalize_title(&raw.app_name, &raw.title);

        let mut sig = Signals {
            app: raw.app_name.clone(),
            app_id: id.clone(),
            title: normalized_title.clone(),
            ..Signals::default()
        };

        // URL (kun browsere, standard til). Køres efter udelukkelsen, så
        // vinduer, titlen afslører som private, aldrig spørges. Uden titel
        // (ingen Skærmoptagelse/Tilgængelighed) kan privat ikke udelukkes på
        // titlen, så der probes slet ikke.
        // Et privat vindue, brugeren selv har valgt at spore, får aldrig sin URL læst.
        if cfg.browser_url_capture && is_browser(&id) && !raw.title.trim().is_empty() && !private {
            let key = (raw.pid, raw.window_id, raw.title.clone());
            let probe = self
                .url
                .get_or_insert_with(&key, || match platform.browser_url(&raw) {
                    BrowserUrl::Url(u) => {
                        normalize_url(&u).map_or(BrowserUrl::Unknown, BrowserUrl::Url)
                    }
                    other => other,
                });
            let url = match probe {
                BrowserUrl::Url(u) => Some(u),
                // Browseren siger selv, vinduet er privat.
                BrowserUrl::Private if cfg.exclude_incognito => return None,
                BrowserUrl::Private | BrowserUrl::Unknown => None,
            };
            if let Some(u) = &url
                && should_exclude(
                    &raw.app_name,
                    &raw.title,
                    Some(u),
                    rules,
                    cfg.exclude_incognito,
                )
            {
                return None;
            }
            sig.domain = url.as_deref().and_then(domain_of);
            sig.url = url;
        }

        // Dokument fra vinduet selv (macOS AXDocument).
        let ax_doc = raw.document.as_deref().and_then(path_from_file_uri);
        let (ax_dir, ax_file) = match &ax_doc {
            Some(p) if p.ends_with('/') || Path::new(p).is_dir() => (Some(p.clone()), None),
            Some(p) => (None, Some(p.clone())),
            None => (None, None),
        };

        let roots = if cfg.repo_roots.is_empty() {
            editors::default_roots()
        } else {
            cfg.repo_roots.clone()
        };

        let mut path: Option<String>;
        let mut document: Option<String> = ax_file.clone();

        if let Some(kind) = editors::editor_kind(&id) {
            let ws = self
                .workspaces
                .get_or_insert_with(&Some(kind), || editors::workspaces_for(kind));
            path = editors::pick_workspace(&raw.title, &ws)
                .or_else(|| self.find_title_folder_in_roots(&raw.title, &roots));
            document = document.or_else(|| process_context::extract_active_file(&raw.title));
        } else if is_terminal(&id) {
            let key = (raw.pid, raw.title.clone());
            path = self
                .terminal
                .get_or_insert_with(&key, || platform.terminal_cwd(&raw))
                .or(ax_dir.clone())
                .or_else(|| path_from_title(&raw.title));
            if path.is_none() && platform.process_tree_allowed() {
                let pid = raw.pid;
                path = self.proc_tree.get_or_insert_with(&pid, || {
                    pid.and_then(process_context::derive_active_context)
                });
            }
        } else if PLAIN_EDITORS.contains(&id.as_str()) {
            path = ax_dir.clone().or_else(|| path_from_title(&raw.title));
            document = document.or_else(|| process_context::extract_active_file(&raw.title));
        } else {
            path = ax_dir.clone();
        }

        // Dokumentapps (Figma, Word, Notion, Obsidian ...): artefaktnavnet.
        if document.is_none() {
            document = title::derive_app_context(&raw.app_name, &normalized_title);
        }

        // Repo ud fra mappen (eller dokumentets mappe).
        let repo_probe_dir = path.clone().or_else(|| {
            ax_file
                .as_deref()
                .and_then(|f| Path::new(f).parent())
                .map(|p| p.to_string_lossy().to_string())
        });
        if let Some(dir) = repo_probe_dir {
            let dir = expand_home(&dir);
            if let Some(info) = self
                .repo
                .get_or_insert_with(&dir, || git::find_repo(Path::new(&dir)))
            {
                sig.repo_remote = info.remote.clone();
                sig.repo_root = Some(normalize_path(&info.root.to_string_lossy()));
                sig.branch = info.branch.clone();
            }
        }

        sig.path = path.map(|p| normalize_path(&expand_home(&p)));
        sig.document = document;
        Some(sig)
    }

    /// Editoren kendte ikke stien: prøv titlens mappenavne i rødderne.
    fn find_title_folder_in_roots(&mut self, title: &str, roots: &[PathBuf]) -> Option<String> {
        for seg in editors::title_segments(title) {
            if seg.contains('.')
                && !seg.contains(' ')
                && seg.rsplit('.').next().is_some_and(|e| e.len() <= 5)
            {
                // Ligner et filnavn (main.rs), ikke en mappe.
                continue;
            }
            let key = seg.clone();
            let roots = roots.to_vec();
            if let Some(p) = self
                .roots_found
                .get_or_insert_with(&key, || editors::find_in_roots(&seg, &roots))
            {
                return Some(p.to_string_lossy().to_string());
            }
        }
        None
    }
}

/// En absolut sti eller `~/...` i en terminaltitel ("mads@mac: ~/dev/x",
/// "~/dev/x — -zsh — 80×24", "C:\Projects\x").
pub fn path_from_title(title: &str) -> Option<String> {
    for seg in editors::title_segments(title) {
        let seg = seg.rsplit(": ").next().unwrap_or(&seg).trim();
        let seg = seg.trim_start_matches("PS ").trim_end_matches('>').trim();
        if seg.starts_with("~/") || seg == "~" {
            return Some(expand_home(seg));
        }
        if looks_absolute(seg) && !seg.contains(" -") {
            return Some(seg.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::ScriptedPlatform;

    fn raw(app: &str, exe: &str, title: &str) -> RawWindow {
        RawWindow {
            app_name: app.into(),
            exe_path: exe.into(),
            pid: Some(42),
            window_id: Some(1),
            title: title.into(),
            document: None,
            accessibility_hints: Vec::new(),
        }
    }

    #[test]
    fn browser_reporting_private_drops_window() {
        // Chrome på macOS skriver ikke "Incognito" i titlen; browseren selv siger det.
        let mut p = ScriptedPlatform {
            url: Some("https://sygehus.dk/journal".into()),
            private: true,
            ..Default::default()
        };
        let cfg = TrackerConfig::default();
        assert!(
            enricher()
                .enrich(raw("Google Chrome", "", "Journal"), &cfg, &[], &mut p)
                .is_none()
        );
        // Er inkognito-udelukkelse slået fra, spores vinduet, men aldrig URL'en.
        let cfg = TrackerConfig {
            exclude_incognito: false,
            ..TrackerConfig::default()
        };
        let s = enricher()
            .enrich(raw("Google Chrome", "", "Journal"), &cfg, &[], &mut p)
            .unwrap();
        assert_eq!((s.url, s.domain), (None, None));
    }

    #[test]
    fn no_title_means_no_url_probe() {
        let mut p = ScriptedPlatform {
            url: Some("https://kunde.dk/".into()),
            ..Default::default()
        };
        let cfg = TrackerConfig::default();
        let s = enricher()
            .enrich(raw("Google Chrome", "", "  "), &cfg, &[], &mut p)
            .unwrap();
        assert_eq!(s.url, None);
        assert_eq!(p.url_calls, 0);
    }

    #[test]
    fn url_cache_is_per_window_not_per_process() {
        let mut e = Enricher::with_ttls(Duration::from_secs(60), Duration::ZERO, Duration::ZERO);
        let cfg = TrackerConfig::default();
        let mut p = ScriptedPlatform {
            url: Some("https://kunde-a.dk/".into()),
            ..Default::default()
        };
        let a = e
            .enrich(raw("Google Chrome", "", "Log ind"), &cfg, &[], &mut p)
            .unwrap();
        assert_eq!(a.domain.as_deref(), Some("kunde-a.dk"));
        // Samme proces og titel, men et andet vindue: ny probe, og reglen rammer.
        p.url = Some("https://netbank.dk/".into());
        let mut other = raw("Google Chrome", "", "Log ind");
        other.window_id = Some(2);
        let rules = vec![ExclusionRule::new("url", "contains", "netbank")];
        assert!(e.enrich(other, &cfg, &rules, &mut p).is_none());
        assert_eq!(p.url_calls, 2);
    }

    fn enricher() -> Enricher {
        Enricher::with_ttls(Duration::ZERO, Duration::ZERO, Duration::ZERO)
    }

    #[test]
    fn browser_url_is_normalized_and_domain_set() {
        let mut p = ScriptedPlatform {
            url: Some("https://www.Kunde.dk/admin?token=hemmelig#x".into()),
            ..Default::default()
        };
        let cfg = TrackerConfig::default();
        let s = enricher()
            .enrich(
                raw("Google Chrome", "", "Admin - Google Chrome"),
                &cfg,
                &[],
                &mut p,
            )
            .unwrap();
        assert_eq!(s.url.as_deref(), Some("https://www.Kunde.dk/admin"));
        assert_eq!(s.domain.as_deref(), Some("kunde.dk"));
    }

    #[test]
    fn url_capture_can_be_turned_off() {
        let mut p = ScriptedPlatform {
            url: Some("https://kunde.dk/".into()),
            ..Default::default()
        };
        let cfg = TrackerConfig {
            browser_url_capture: false,
            ..TrackerConfig::default()
        };
        let s = enricher()
            .enrich(raw("Safari", "", "Kunde"), &cfg, &[], &mut p)
            .unwrap();
        assert_eq!(s.url, None);
    }

    #[test]
    fn url_exclusion_drops_window() {
        let mut p = ScriptedPlatform {
            url: Some("https://netbank.dk/konto".into()),
            ..Default::default()
        };
        let rules = vec![ExclusionRule::new("url", "contains", "netbank")];
        let cfg = TrackerConfig::default();
        assert!(
            enricher()
                .enrich(raw("Safari", "", "Konto"), &cfg, &rules, &mut p)
                .is_none()
        );
    }

    #[test]
    fn incognito_is_excluded_before_url_probe() {
        let mut p = ScriptedPlatform {
            url: Some("https://hemmelig.dk/".into()),
            ..Default::default()
        };
        let cfg = TrackerConfig::default();
        assert!(
            enricher()
                .enrich(
                    raw("Google Chrome", "", "x - Google Chrome (Incognito)"),
                    &cfg,
                    &[],
                    &mut p
                )
                .is_none()
        );
        assert_eq!(p.url_calls, 0, "private vinduer må aldrig spørges om URL");
    }

    #[test]
    fn private_vindue_via_ax_tekst_udelades_eller_spores_uden_url() {
        let mut p = ScriptedPlatform {
            url: Some("https://hemmelig.dk/side".into()),
            ..Default::default()
        };
        let mut w = raw("Safari", "", "Journal");
        w.accessibility_hints = vec!["AXStandardWindow".into(), "Private Window".into()];
        assert!(
            enricher()
                .enrich(w.clone(), &TrackerConfig::default(), &[], &mut p)
                .is_none()
        );
        assert_eq!(p.url_calls, 0);
        // Slået til: vinduet spores, men URL'en læses aldrig.
        let cfg = TrackerConfig {
            exclude_incognito: false,
            ..TrackerConfig::default()
        };
        let s = enricher().enrich(w, &cfg, &[], &mut p).unwrap();
        assert_eq!((s.url, s.domain), (None, None));
        assert_eq!(p.url_calls, 0, "private vinduer spørges aldrig om URL");
    }

    #[test]
    fn private_titel_spores_uden_url_naar_brugeren_vil_det() {
        let mut p = ScriptedPlatform {
            url: Some("https://hemmelig.dk/".into()),
            ..Default::default()
        };
        let cfg = TrackerConfig {
            exclude_incognito: false,
            ..TrackerConfig::default()
        };
        let s = enricher()
            .enrich(raw("Safari", "", "Journal, privat browser"), &cfg, &[], &mut p)
            .unwrap();
        assert_eq!(s.url, None);
        assert_eq!(p.url_calls, 0);
    }

    #[test]
    fn terminal_uses_platform_cwd_and_finds_repo_remote() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("Website");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::write(repo.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(
            repo.join(".git/config"),
            "[remote \"origin\"]\n url = git@github.com:bageriet/website.git\n",
        )
        .unwrap();

        let mut p = ScriptedPlatform {
            cwd: Some(repo.join("src").to_string_lossy().to_string()),
            ..Default::default()
        };
        let cfg = TrackerConfig::default();
        let s = enricher()
            .enrich(raw("Terminal", "", "zsh"), &cfg, &[], &mut p)
            .unwrap();
        assert_eq!(
            s.repo_remote.as_deref(),
            Some("github.com/bageriet/website")
        );
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.repo_root, Some(normalize_path(&repo.to_string_lossy())));
        assert_eq!(
            s.path,
            Some(normalize_path(&repo.join("src").to_string_lossy()))
        );
    }

    #[test]
    fn terminal_falls_back_to_ax_document_then_title() {
        let mut p = ScriptedPlatform::default();
        let cfg = TrackerConfig::default();
        let mut w = raw("Terminal", "", "zsh");
        w.document = Some("file:///Users/m/dev/x/".into());
        let s = enricher().enrich(w, &cfg, &[], &mut p).unwrap();
        assert_eq!(s.path.as_deref(), Some("/users/m/dev/x"));

        let s = enricher()
            .enrich(raw("iTerm2", "", "mads@mac: /opt/kunde"), &cfg, &[], &mut p)
            .unwrap();
        assert_eq!(s.path.as_deref(), Some("/opt/kunde"));
    }

    #[test]
    fn document_apps_get_artifact_name() {
        let mut p = ScriptedPlatform::default();
        let cfg = TrackerConfig::default();
        let s = enricher()
            .enrich(
                raw("Figma", "", "Bageriet webshop – Figma"),
                &cfg,
                &[],
                &mut p,
            )
            .unwrap();
        assert!(s.document.is_some(), "{s:?}");
        let mut w = raw("Pages", "", "Tilbud");
        w.document = Some("file:///Users/m/Documents/Tilbud%20Bageriet.pages".into());
        let s = enricher().enrich(w, &cfg, &[], &mut p).unwrap();
        assert_eq!(
            s.document.as_deref(),
            Some("/Users/m/Documents/Tilbud Bageriet.pages")
        );
    }

    #[test]
    fn editor_title_folder_found_in_configured_roots() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("Freelance/bageriet-shop")).unwrap();
        let mut p = ScriptedPlatform::default();
        let cfg = TrackerConfig {
            repo_roots: vec![tmp.path().to_path_buf()],
            ..TrackerConfig::default()
        };
        // Ingen editor-state på testmaskinen for "windsurf": falder til rødderne.
        let s = enricher()
            .enrich(
                raw("Windsurf", "", "index.ts - bageriet-shop - Windsurf"),
                &cfg,
                &[],
                &mut p,
            )
            .unwrap();
        assert_eq!(
            s.path,
            Some(normalize_path(
                &tmp.path().join("Freelance/bageriet-shop").to_string_lossy()
            ))
        );
        assert_eq!(s.document.as_deref(), Some("index.ts"));
    }

    #[test]
    fn path_from_title_variants() {
        assert_eq!(
            path_from_title("mads@mac: /opt/x").as_deref(),
            Some("/opt/x")
        );
        assert_eq!(
            path_from_title(r"PS C:\Projects\kunde>").as_deref(),
            Some(r"C:\Projects\kunde")
        );
        assert!(
            path_from_title("~/dev/x — -zsh — 80×24")
                .unwrap()
                .ends_with("/dev/x")
        );
        assert_eq!(path_from_title("zsh"), None);
    }

    #[test]
    fn app_classes() {
        assert!(is_browser("safari") && is_browser("arc") && is_browser("msedge"));
        // Adresselinjen læses for alle de udbredte browsere (Windows: UIA på
        // exe-navnet; macOS: AppleScript på appnavnet).
        for id in ["vivaldi", "brave", "brave browser", "opera", "arc", "msedge", "microsoft edge", "chrome", "firefox"] {
            assert!(is_browser(id), "{id}");
        }
        assert!(!is_browser("code"));
        assert!(is_terminal("windowsterminal") && is_terminal("iterm2") && is_terminal("ghostty"));
        assert!(!is_terminal("windsurf"));
    }
}
