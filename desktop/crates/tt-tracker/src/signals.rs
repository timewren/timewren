//! Opsummering af de signaler, trackeren har set, rangeret efter tid.
//!
//! Porteret fra 0.2's "discovery" (`commands/identity.rs`): i stedet for at
//! lade brugeren bekræfte hundredvis af aktiviteter én ad gangen, vises de ca.
//! 10 signaler (repo, mappe, domæne, app), der står for det meste af ugen, så
//! hver kan bindes til et projekt med ét klik. Hvilke signaler der allerede
//! er bundet, og hvilket projekt der foreslås, afgør `tt-matcher`; her ligger
//! kun aggregeringen, som kræver de rå segmenter.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::paths::{normalize_path, path_is_within};
use crate::types::ActivitySegment;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SignalKind {
    /// Normaliseret git-remote ("github.com/acme/timetrack").
    Repo,
    /// Repo uden remote: repoets rodsti.
    RepoRoot,
    /// Arbejdsmappe uden repo.
    Path,
    Domain,
    /// Kun når intet andet signal findes, og appen ikke rummer flere projekter.
    App,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalSummary {
    pub kind: SignalKind,
    pub value: String,
    pub seconds: i64,
    pub segment_count: i64,
    /// Op til tre apps, alfabetisk.
    pub sample_apps: Vec<String>,
    /// De tre titler med mest tid. Kun til visning lokalt.
    pub sample_titles: Vec<String>,
    /// Ligner privat brug (sociale medier, spil). Vises nederst og foreslås
    /// som "ikke arbejde".
    pub suggested_private: bool,
}

#[derive(Default)]
struct Agg {
    seconds: i64,
    count: i64,
    apps: BTreeSet<String>,
    titles: BTreeMap<String, i64>,
}

/// Opsummerer segmenterne. `is_known(kind, value)` filtrerer signaler fra,
/// som allerede er bundet. Idle-segmenter og signaler under ét minut tælles
/// ikke. Højst `limit` resultater; arbejde før privat, mest tid først.
pub fn summarize(
    segments: &[ActivitySegment],
    is_known: impl Fn(SignalKind, &str) -> bool,
    limit: usize,
) -> Vec<SignalSummary> {
    let mut agg: HashMap<(SignalKind, String), Agg> = HashMap::new();
    for s in segments.iter().filter(|s| !s.idle) {
        let secs = s.duration_secs();
        let repo = s
            .repo_remote
            .clone()
            .map(|r| (SignalKind::Repo, r))
            .or_else(|| s.repo_root.clone().map(|r| (SignalKind::RepoRoot, r)));
        let path = s.path.as_deref().and_then(path_candidate);
        // Repoet er det reneste signal; samme aktivitet spørges ikke også om mappen.
        if let Some((k, v)) = repo.clone() {
            bump(&mut agg, k, v, s, secs);
        } else if let Some(p) = path.clone() {
            bump(&mut agg, SignalKind::Path, p, s, secs);
        }
        let domain = s.domain.clone().filter(|d| d.contains('.'));
        if let Some(d) = domain.clone() {
            bump(&mut agg, SignalKind::Domain, d, s, secs);
        }
        if repo.is_none()
            && path.is_none()
            && domain.is_none()
            && !s.app_id.is_empty()
            && !is_multi_project_app(&s.app_id)
        {
            bump(&mut agg, SignalKind::App, s.app_id.clone(), s, secs);
        }
    }
    collapse_into_observed_ancestors(&mut agg);

    let mut out: Vec<SignalSummary> = agg
        .into_iter()
        .filter(|((k, v), a)| a.seconds >= 60 && !is_known(*k, v))
        .map(|((kind, value), a)| SignalSummary {
            suggested_private: looks_personal(kind, &value) || title_looks_personal(&a.titles),
            sample_titles: top_titles(&a.titles, 3),
            sample_apps: a.apps.into_iter().take(3).collect(),
            kind,
            value,
            seconds: a.seconds,
            segment_count: a.count,
        })
        .collect();
    out.sort_by(|a, b| {
        a.suggested_private
            .cmp(&b.suggested_private)
            .then(b.seconds.cmp(&a.seconds))
            .then(a.value.cmp(&b.value))
    });
    out.truncate(limit);
    out
}

fn bump(
    agg: &mut HashMap<(SignalKind, String), Agg>,
    kind: SignalKind,
    value: String,
    s: &ActivitySegment,
    secs: i64,
) {
    let e = agg.entry((kind, value)).or_default();
    e.seconds += secs;
    e.count += 1;
    if !s.app.is_empty() {
        e.apps.insert(s.app.clone());
    }
    let t = s.title.trim();
    if !t.is_empty() {
        *e.titles.entry(t.to_string()).or_insert(0) += secs;
    }
}

fn top_titles(titles: &BTreeMap<String, i64>, n: usize) -> Vec<String> {
    let mut v: Vec<(&String, &i64)> = titles.iter().collect();
    v.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    v.into_iter().take(n).map(|(t, _)| t.clone()).collect()
}

/// Er arbejdsmappen værd at spørge om? Gætter aldrig, hvor "projektet"
/// starter: at skære ved `Projects` ville give `c:/projects/egne`, en
/// kategorimappe, hvis binding ville sluge alle egne projekter. Maskinstøj
/// (AppData, temp, node_modules) og for korte stier (drevrod, hjemmemappe)
/// afvises.
pub fn path_candidate(path: &str) -> Option<String> {
    let norm = normalize_path(path);
    if norm.is_empty() {
        return None;
    }
    let parts: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    const JUNK: &[&str] = &[
        "appdata",
        "temp",
        "tmp",
        "downloads",
        "windows",
        "program files",
        "$recycle.bin",
        "node_modules",
        ".git",
        ".cache",
        "target",
        "library",
    ];
    if parts.iter().any(|p| JUNK.contains(p)) {
        return None;
    }
    // `c:/users/mads_` og `/users/mads/dev` identificerer intet;
    // `c:/projects/freelance/kunde-a` gør.
    if parts.len() < 4 {
        return None;
    }
    let joined = parts.join("/");
    Some(if norm.starts_with('/') {
        format!("/{joined}")
    } else {
        joined
    })
}

/// Lægger en dybere mappes tid ind i en forfader, som brugeren OGSÅ har
/// arbejdet i. Der rulles kun op langs grænser, data beviser findes.
fn collapse_into_observed_ancestors(agg: &mut HashMap<(SignalKind, String), Agg>) {
    let paths: Vec<String> = agg
        .keys()
        .filter(|(k, _)| *k == SignalKind::Path)
        .map(|(_, v)| v.clone())
        .collect();
    let mut moves = Vec::new();
    for p in &paths {
        if let Some(a) = paths
            .iter()
            .filter(|a| *a != p && path_is_within(p, a))
            .min_by_key(|a| a.len())
        {
            moves.push((p.clone(), a.clone()));
        }
    }
    for (desc, anc) in moves {
        let Some(d) = agg.remove(&(SignalKind::Path, desc)) else {
            continue;
        };
        let t = agg.entry((SignalKind::Path, anc)).or_default();
        t.seconds += d.seconds;
        t.count += d.count;
        t.apps.extend(d.apps);
        for (title, secs) in d.titles {
            *t.titles.entry(title).or_insert(0) += secs;
        }
    }
}

/// Apps, der rummer mange projekter på én gang. At binde selve appen ville
/// sluge alle kunders arbejde.
pub fn is_multi_project_app(app_id: &str) -> bool {
    let app = app_id.to_lowercase();
    if crate::title::app_family(&app).is_some() {
        return true;
    }
    const MULTI: &[&str] = &[
        "code",
        "cursor",
        "zed",
        "windsurf",
        "idea",
        "webstorm",
        "phpstorm",
        "pycharm",
        "goland",
        "rider",
        "clion",
        "rustrover",
        "datagrip",
        "sublime",
        "vim",
        "nvim",
        "notepad++",
        "xcode",
        "chrome",
        "msedge",
        "edge",
        "firefox",
        "brave",
        "opera",
        "vivaldi",
        "safari",
        "arc",
        "orca",
        "windowsterminal",
        "powershell",
        "pwsh",
        "cmd",
        "alacritty",
        "wezterm",
        "kitty",
        "warp",
        "ghostty",
        "tmux",
        "iterm",
        "terminal",
        "finder",
        "explorer",
    ];
    MULTI.iter().any(|m| app.contains(m)) || app == "wt"
}

/// Kendte private sider. Bevidst kort: tvetydige faglige sider (LinkedIn,
/// YouTube Studio, Google Meet) er IKKE med, for en forkert "privat" ville
/// slette rigtigt arbejde.
fn looks_personal(kind: SignalKind, value: &str) -> bool {
    if kind != SignalKind::Domain {
        return false;
    }
    const PERSONAL: &[&str] = &[
        "facebook.com",
        "messenger.com",
        "instagram.com",
        "tiktok.com",
        "snapchat.com",
        "reddit.com",
        "pornhub.com",
        "xvideos.com",
        "netflix.com",
        "twitch.tv",
        "proshop.dk",
        "amazon.com",
        "ebay.com",
        "dba.dk",
        "zalando.dk",
    ];
    PERSONAL
        .iter()
        .any(|d| value == *d || value.ends_with(&format!(".{d}")))
}

/// Fritid ses ofte kun i titlen (`javaw` siger intet, "Minecraft" alt).
/// Vægtet efter tid, så én tilfældig titel ikke stempler en arbejdsapp.
fn title_looks_personal(titles: &BTreeMap<String, i64>) -> bool {
    const LEISURE: &[&str] = &[
        "minecraft",
        "steam",
        "counter-strike",
        "fortnite",
        "roblox",
        "world of warcraft",
        "league of legends",
        "netflix",
        "spotify",
        "twitch",
        "pornhub",
    ];
    let (mut leisure, mut total) = (0i64, 0i64);
    for (title, secs) in titles {
        let t = title.to_lowercase();
        total += *secs;
        if LEISURE.iter().any(|g| t.contains(g)) {
            leisure += *secs;
        }
    }
    total > 0 && leisure * 2 > total
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone, Utc};

    fn seg(app: &str, title: &str, secs: i64) -> ActivitySegment {
        let start = Utc.with_ymd_and_hms(2026, 10, 26, 8, 0, 0).unwrap();
        ActivitySegment {
            id: None,
            app: app.into(),
            app_id: app.to_lowercase(),
            title: title.into(),
            url: None,
            domain: None,
            repo_remote: None,
            repo_root: None,
            branch: None,
            path: None,
            document: None,
            start,
            end: start + Duration::seconds(secs),
            idle: false,
        }
    }

    #[test]
    fn path_candidate_keeps_the_observed_folder_verbatim() {
        assert_eq!(
            path_candidate(r"C:\Projects\Egne\timetrack-all\timetrack-desktop"),
            Some("c:/projects/egne/timetrack-all/timetrack-desktop".to_string())
        );
        assert_eq!(
            path_candidate(r"C:\Users\mads_\Local Sites\acme-site\"),
            Some("c:/users/mads_/local sites/acme-site".to_string())
        );
        assert_eq!(
            path_candidate("/Users/m/dev/kunde"),
            Some("/users/m/dev/kunde".to_string())
        );
    }

    #[test]
    fn path_candidate_rejects_machine_noise_and_home() {
        assert_eq!(path_candidate(r"C:\Users\mads_"), None);
        assert_eq!(
            path_candidate(r"C:\Users\mads_\AppData\Local\Temp\pip-install-x\vllm"),
            None
        );
        assert_eq!(path_candidate(r"C:\"), None);
        assert_eq!(path_candidate("/Users/m/dev"), None);
        assert_eq!(path_candidate("/Users/m/Library/Caches/x/y"), None);
    }

    #[test]
    fn descendants_collapse_only_into_folders_actually_worked_in() {
        let mut a = seg("Orca", "Orca", 600);
        a.path = Some("c:/projects/freelance/kunde-a".into());
        let mut b = seg("Orca", "Orca", 300);
        b.path = Some("c:/projects/freelance/kunde-a/notes".into());
        let mut c = seg("Orca", "Orca", 120);
        c.path = Some("c:/projects/freelance/kunde-a-old".into());
        let out = summarize(&[a, b, c], |_, _| false, 40);
        let kunde_a = out
            .iter()
            .find(|s| s.value == "c:/projects/freelance/kunde-a")
            .unwrap();
        assert_eq!(kunde_a.seconds, 900);
        assert!(!out.iter().any(|s| s.value.ends_with("/notes")));
        assert!(out.iter().any(|s| s.value.ends_with("kunde-a-old")));
    }

    #[test]
    fn repo_wins_over_path_and_two_websites_stay_apart() {
        let mut a = seg("Code", "index.html", 600);
        a.repo_remote = Some("github.com/bageriet/website".into());
        a.path = Some("/users/m/dev/kunder/bageriet/website".into());
        let mut b = seg("Code", "index.html", 300);
        b.repo_remote = Some("github.com/frisoeren/website".into());
        let out = summarize(&[a, b], |_, _| false, 40);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|s| s.kind == SignalKind::Repo));
        assert_eq!(out[0].value, "github.com/bageriet/website");
    }

    #[test]
    fn known_signals_idle_and_noise_are_skipped() {
        let mut a = seg("Safari", "Kunde", 600);
        a.domain = Some("kunde.dk".into());
        let mut idle = seg("Idle", "", 6000);
        idle.idle = true;
        let mut short = seg("Safari", "Kort", 30);
        short.domain = Some("kort.dk".into());
        let out = summarize(&[a.clone(), idle, short], |_, _| false, 40);
        assert_eq!(
            out.iter().map(|s| s.value.as_str()).collect::<Vec<_>>(),
            vec!["kunde.dk"]
        );
        let out = summarize(&[a], |k, v| k == SignalKind::Domain && v == "kunde.dk", 40);
        assert!(out.is_empty());
    }

    #[test]
    fn app_signal_only_for_single_purpose_apps_and_leisure_sinks() {
        let game = seg("javaw", "Minecraft* 1.21.11 - Multiplayer", 2220);
        let mail = seg("Spark Desktop", "Spark", 600);
        let editor = seg("Code", "main.rs", 3000);
        let mut fb = seg("Safari", "Facebook", 4000);
        fb.domain = Some("m.facebook.com".into());
        let out = summarize(&[game, mail, editor, fb], |_, _| false, 40);
        assert!(
            !out.iter().any(|s| s.value == "code"),
            "editoren må ikke kunne bindes som app"
        );
        assert_eq!(out[0].value, "spark desktop", "arbejde før privat");
        assert!(
            out.iter()
                .find(|s| s.value == "javaw")
                .unwrap()
                .suggested_private
        );
        assert!(
            out.iter()
                .find(|s| s.value == "m.facebook.com")
                .unwrap()
                .suggested_private
        );
    }

    #[test]
    fn personal_hint_never_hits_ambiguous_professional_sites() {
        assert!(looks_personal(SignalKind::Domain, "facebook.com"));
        assert!(!looks_personal(SignalKind::Domain, "linkedin.com"));
        assert!(!looks_personal(SignalKind::Domain, "meet.google.com"));
        assert!(!looks_personal(SignalKind::Repo, "facebook.com"));
    }

    #[test]
    fn document_hosting_apps_are_never_bindable_as_a_whole_app() {
        for app in [
            "obsidian",
            "figma",
            "microsoft word",
            "notion",
            "visual studio code",
        ] {
            assert!(is_multi_project_app(app), "{app}");
        }
        assert!(!is_multi_project_app("javaw"));
        assert!(!is_multi_project_app("spark desktop"));
    }

    #[test]
    fn leisure_weighted_by_time() {
        let mut work = BTreeMap::new();
        work.insert("Spark Desktop".to_string(), 1560i64);
        work.insert("Spotify".to_string(), 60i64);
        assert!(!title_looks_personal(&work));
    }
}
