//! Konverteringer mellem UI-typerne, trackeren og matcheren.
//!
//! Ingen IO og ingen tilstand her, så alt kan testes uden OS.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone};
use tt_matcher as mm;
use tt_tracker as tr;

use crate::backend::services::WebCatalog;
use crate::backend::{Customer, Project, ProjectStatus, Suggestion, TrackingSettings};

/// Trackerens segment som matcherens. Idle er aldrig arbejde og udelades.
///
/// `path` falder tilbage til repoets rod, så et repo uden arbejdsmappe stadig
/// har en mappe-nøgle at lære af. `repo_remote` er allerede normaliseret af
/// trackeren (`github.com/acme/timetrack`).
pub fn to_matcher(s: &tr::ActivitySegment) -> Option<mm::ActivitySegment> {
    (!s.idle).then(|| mm::ActivitySegment {
        id: s.id.map(|i| i.to_string()),
        app: s.app.clone(),
        title: s.title.clone(),
        url: s.url.clone(),
        domain: s.domain.clone(),
        repo_remote: s.repo_remote.clone(),
        path: s.path.clone().or_else(|| s.repo_root.clone()),
        document: s.document.clone(),
        start: s.start.timestamp(),
        end: s.end.timestamp(),
    })
}

/// Kunder og projekter fra datalaget som matcherens katalog, med kundernes
/// egne domæner (web's `Client.domains`) og site-koblingerne fra `web`.
/// `Project.url_patterns` kommer fra `Project`. En site-kobling uden mål
/// springes over ("ikke arbejde" står ikke som kobling).
pub fn catalog(customers: &[Customer], projects: &[Project], web: &WebCatalog) -> mm::Catalog {
    mm::Catalog {
        clients: customers
            .iter()
            .map(|c| mm::Client {
                id: c.id.clone(),
                name: c.name.clone(),
                domains: web.client_domains.get(&c.id).cloned().unwrap_or_default(),
                archived: c.archived,
                cvr: c.cvr.clone(),
                // Kundens mail giver et maildomæne (gratis mailtjenester
                // sorteres fra i profilen).
                mail_domains: c
                    .email
                    .as_deref()
                    .and_then(|e| e.rsplit_once('@'))
                    .map(|(_, d)| vec![d.to_string()])
                    .unwrap_or_default(),
                ..Default::default()
            })
            .collect(),
        site_mappings: web
            .site_mappings
            .iter()
            .filter(|m| m.project_id.is_some() || m.client_id.is_some())
            .map(|m| mm::SiteMapping {
                domain: m.domain.clone(),
                project_id: m.project_id.clone(),
                client_id: m.client_id.clone(),
                usage_count: m.usage_count,
            })
            .collect(),
        projects: projects
            .iter()
            .map(|p| mm::Project {
                id: p.id.clone(),
                name: p.name.clone(),
                // Interne projekter har ingen kunde (tom streng i UI'et).
                client_id: Some(p.customer_id.clone()).filter(|c| !c.is_empty()),
                url_patterns: p.url_patterns.clone(),
                // Et afsluttet projekt får ikke nye forslag.
                archived: matches!(p.status, ProjectStatus::Archived | ProjectStatus::Completed),
            })
            .collect(),
        rules: web.rules.iter().flat_map(matcher_rules).collect(),
        ..Default::default()
    }
}

/// Datalagets regel (web's `kind` + `pattern`) som matcherens regler.
///
/// - "Ikke arbejde" (alle slags) bliver en regel uden mål: matcheren
///   ignorerer aktiviteten, og den foreslås aldrig. Den vinder over regler
///   med mål (højere prioritet).
/// - Domæne-regler med mål er site-koblinger og står allerede i kataloget
///   som sådan; de springes over her.
/// - domæne → domænet og dets underdomæner; url → glob med `*`/`?`, ellers
///   "indeholder"; repo → repo-remote, eller mappen, hvis mønsteret er en
///   sti; app → programmet; titel → "indeholder" i titlen.
pub fn matcher_rules(r: &crate::backend::services::WebRule) -> Vec<mm::Rule> {
    use tt_data::RuleKind;
    let target = (r.project_id.is_some() || r.client_id.is_some()).then(|| mm::Target {
        client_id: r.client_id.clone(),
        project_id: r.project_id.clone(),
    });
    let target = match (r.not_work, target) {
        (true, _) => None,
        (false, Some(t)) => Some(t),
        // Uden mål og uden "ikke arbejde" (web afviser den): intet at gøre.
        (false, None) => return Vec::new(),
    };
    if target.is_some() && r.kind == RuleKind::Domain {
        return Vec::new();
    }
    let pattern = r.pattern.trim();
    if pattern.is_empty() {
        return Vec::new();
    }
    let rule = |field, op, value: String| mm::Rule {
        id: r.id.clone(),
        field,
        op,
        value,
        target: target.clone(),
        priority: i32::from(r.not_work),
        active: true,
    };
    use mm::{RuleField as F, RuleOp as O};
    match r.kind {
        RuleKind::Domain => {
            let d = pattern.to_lowercase();
            let d = d.strip_prefix("www.").unwrap_or(&d).to_string();
            vec![rule(F::Domain, O::Equals, d.clone()), rule(F::Domain, O::Glob, format!("*.{d}"))]
        }
        RuleKind::UrlPattern if pattern.contains(['*', '?']) => {
            vec![rule(F::Url, O::Glob, pattern.into())]
        }
        RuleKind::UrlPattern => vec![rule(F::Url, O::Contains, pattern.into())],
        RuleKind::Repo
            if pattern.starts_with(['/', '~', '\\'])
                || pattern.as_bytes().get(1) == Some(&b':') =>
        {
            vec![rule(F::Path, O::StartsWith, pattern.into())]
        }
        RuleKind::Repo => vec![rule(F::Repo, O::Equals, pattern.into())],
        RuleKind::App => vec![rule(F::App, O::Equals, pattern.into())],
        RuleKind::AppKeyword | RuleKind::TitleTemplate => {
            vec![rule(F::Title, O::Contains, pattern.into())]
        }
    }
}

/// Unix-sekunder som lokal dato og tid.
pub fn local_datetime(ts: i64) -> (NaiveDate, NaiveTime) {
    let dt: DateTime<Local> = Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(|| DateTime::<chrono::Utc>::UNIX_EPOCH.with_timezone(&Local));
    (dt.date_naive(), dt.time())
}

/// Stabilt id for en blok: FNV-1a over start, slut og mål. Samme blok med
/// samme mål giver samme id på tværs af kald (og genstart).
pub fn suggestion_id(start: i64, end: i64, target: &mm::Target) -> String {
    let text = format!(
        "{start}|{end}|{}|{}",
        target.client_id.as_deref().unwrap_or(""),
        target.project_id.as_deref().unwrap_or("")
    );
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("fs_{h:016x}")
}

/// En matcher-blok som UI'ets forslag på `date` i lokal tid.
///
/// Interne projekter uden kunde bliver forslag uden kunde ("Intern tid").
/// Uklare blokke (uden mål) giver `None`: de går til AI-kæden og vises
/// først, når de har fået et mål.
pub fn to_ui_suggestion(date: NaiveDate, s: &mm::Suggestion) -> Option<Suggestion> {
    let target = s.target.as_ref()?;
    let customer_id = target.client_id.clone().filter(|c| !c.is_empty());
    let (d0, t0) = local_datetime(s.start);
    let (d1, t1) = local_datetime(s.end);
    let start = if d0 < date { NaiveTime::MIN } else { t0 };
    // Segmenter er klippet til dagen, så en slut efter midnat kan kun være
    // præcis 24:00.
    let end = if d1 > date {
        NaiveTime::from_hms_opt(23, 59, 0)?
    } else {
        t1
    };
    if end <= start {
        return None;
    }
    Some(Suggestion {
        id: suggestion_id(s.start, s.end, target),
        date,
        start,
        end,
        customer_id,
        project_id: target.project_id.clone(),
        reason: s.reason.clone(),
        confidence: s.confidence.clamp(0.0, 1.0),
        task_id: None,
        task_title: None,
    })
}

/// Fjerner de tidsrum, brugeren allerede har taget stilling til, fra
/// segmenterne. Det, der er tilbage, kan stadig give nye forslag.
pub fn subtract_spans(
    segments: Vec<mm::ActivitySegment>,
    spans: &[(i64, i64)],
) -> Vec<mm::ActivitySegment> {
    if spans.is_empty() {
        return segments;
    }
    let mut out = Vec::with_capacity(segments.len());
    for seg in segments {
        let mut pieces = vec![(seg.start, seg.end)];
        for &(cut_start, cut_end) in spans {
            pieces = pieces
                .into_iter()
                .flat_map(|(a, b)| {
                    if cut_end <= a || cut_start >= b {
                        return vec![(a, b)];
                    }
                    let mut left = Vec::new();
                    if cut_start > a {
                        left.push((a, cut_start));
                    }
                    if cut_end < b {
                        left.push((cut_end, b));
                    }
                    left
                })
                .collect();
        }
        for (a, b) in pieces {
            if b > a {
                out.push(mm::ActivitySegment {
                    start: a,
                    end: b,
                    ..seg.clone()
                });
            }
        }
    }
    out
}

/// `~` og `~/` i en sti, udvidet med hjemmemappen.
pub fn expand_home(raw: &str, home: Option<&Path>) -> PathBuf {
    let raw = raw.trim();
    if let Some(home) = home {
        if raw == "~" {
            return home.to_path_buf();
        }
        if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
            return home.join(rest);
        }
    }
    PathBuf::from(raw)
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Et domæne, som brugeren har skrevet det ("https://www.netbank.dk/login"),
/// som rent værtsnavn i små bogstaver ("netbank.dk"). `None` hvis tomt.
pub fn normalize_domain(raw: &str) -> Option<String> {
    let mut s = raw.trim().to_lowercase();
    if let Some((_, rest)) = s.split_once("://") {
        s = rest.to_string();
    }
    let end = s.find(['/', '?', '#']).unwrap_or(s.len());
    s.truncate(end);
    if let Some((_, host)) = s.rsplit_once('@') {
        s = host.to_string();
    }
    if let Some((host, port)) = s.rsplit_once(':')
        && port.chars().all(|c| c.is_ascii_digit())
    {
        s = host.to_string();
    }
    let s = s.strip_prefix("www.").unwrap_or(&s).trim_matches('.');
    (!s.is_empty()).then(|| s.to_string())
}

fn regex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for c in s.chars() {
        if "\\.+*?()|[]{}^$#&-~".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Udelukkelsesregel for et domæne og dets underdomæner. Regexen forankrer i
/// værtsnavnet, så `netbank.dk` ikke rammer `notnetbank.dk` eller en sti, der
/// nævner domænet.
pub fn domain_rule(domain: &str) -> tr::ExclusionRule {
    tr::ExclusionRule::new(
        "url",
        "regex",
        &format!("^(https?://)?([^/@]*\\.)?{}([:/]|$)", regex_escape(domain)),
    )
}

/// Indstillingernes sporingsdel som trackerens konfiguration.
pub fn tracker_config(t: &TrackingSettings, home: Option<&Path>) -> tr::TrackerConfig {
    let mut rules: Vec<tr::ExclusionRule> = Vec::new();
    for app in &t.excluded_apps {
        let app = app.trim();
        if !app.is_empty() {
            rules.push(tr::ExclusionRule::new("app_name", "equals", app));
        }
    }
    for domain in t
        .excluded_domains
        .iter()
        .filter_map(|d| normalize_domain(d))
    {
        rules.push(domain_rule(&domain));
    }
    for title in &t.excluded_titles {
        let title = title.trim();
        if !title.is_empty() {
            rules.push(tr::ExclusionRule::new("window_title", "contains", title));
        }
    }
    tr::TrackerConfig {
        idle_threshold_secs: u64::from(t.idle_minutes.max(1)) * 60,
        exclusion_rules: rules,
        repo_roots: t
            .repo_roots
            .iter()
            .filter(|r| !r.trim().is_empty())
            .map(|r| expand_home(r, home))
            .collect(),
        retention_days: t.retention_days.max(1),
        browser_url_capture: t.browser_urls,
        exclude_incognito: !t.track_private_windows,
        ..tr::TrackerConfig::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn tr_seg() -> tr::ActivitySegment {
        tr::ActivitySegment {
            id: Some(42),
            app: "Code".into(),
            app_id: "code".into(),
            title: "main.rs — webshop".into(),
            url: None,
            domain: None,
            repo_remote: Some("github.com/acme/webshop".into()),
            repo_root: Some("/users/m/dev/webshop".into()),
            branch: Some("main".into()),
            path: None,
            document: Some("main.rs".into()),
            start: Utc.timestamp_opt(1_000, 0).unwrap(),
            end: Utc.timestamp_opt(1_600, 0).unwrap(),
            idle: false,
        }
    }

    fn local_ts(h: u32, m: u32) -> i64 {
        Local
            .with_ymd_and_hms(2026, 10, 20, h, m, 0)
            .single()
            .unwrap()
            .timestamp()
    }

    #[test]
    fn segment_adapter_maps_fields_and_falls_back_to_repo_root() {
        let m = to_matcher(&tr_seg()).unwrap();
        assert_eq!(m.id.as_deref(), Some("42"));
        assert_eq!(m.repo_remote.as_deref(), Some("github.com/acme/webshop"));
        assert_eq!(m.path.as_deref(), Some("/users/m/dev/webshop"));
        assert_eq!((m.start, m.end), (1_000, 1_600));
        assert_eq!(m.document.as_deref(), Some("main.rs"));
        let mut with_path = tr_seg();
        with_path.path = Some("/users/m/dev/webshop/src".into());
        assert_eq!(
            to_matcher(&with_path).unwrap().path.as_deref(),
            Some("/users/m/dev/webshop/src")
        );
    }

    #[test]
    fn idle_segments_are_not_converted() {
        let mut s = tr_seg();
        s.idle = true;
        assert!(to_matcher(&s).is_none());
    }

    #[test]
    fn catalog_maps_customers_projects_and_url_patterns() {
        let customers = vec![
            Customer {
                id: "k1".into(),
                name: "Bageriet".into(),
                email: None,
                hourly_rate: None,
                archived: false,
                cvr: None,
                ..Default::default()
            },
            Customer {
                id: "k2".into(),
                name: "Gammel".into(),
                email: None,
                hourly_rate: None,
                archived: true,
                cvr: None,
                ..Default::default()
            },
        ];
        let project = |id: &str, status| Project {
            id: id.into(),
            customer_id: "k1".into(),
            name: format!("P {id}"),
            status,
            hourly_rate: None,
            budget_minutes: None,
            url_patterns: vec!["*bageriet.dk*".into()],
        };
        let projects = vec![
            project("p1", ProjectStatus::Active),
            project("p2", ProjectStatus::Paused),
            project("p3", ProjectStatus::Completed),
            project("p4", ProjectStatus::Archived),
        ];
        let c = catalog(&customers, &projects, &WebCatalog::default());
        assert_eq!(c.clients.len(), 2);
        assert!(!c.clients[0].archived && c.clients[1].archived);
        assert!(c.clients.iter().all(|c| c.domains.is_empty()));
        assert!(c.site_mappings.is_empty());
        let archived: Vec<bool> = c.projects.iter().map(|p| p.archived).collect();
        assert_eq!(archived, vec![false, false, true, true]);
        assert_eq!(c.projects[0].client_id.as_deref(), Some("k1"));
        assert_eq!(c.projects[0].url_patterns, vec!["*bageriet.dk*"]);
    }

    #[test]
    fn catalog_takes_client_domains_and_site_mappings_from_web() {
        use crate::backend::services::WebSiteMapping;
        let customers = vec![Customer {
            id: "k1".into(),
            name: "Bageriet".into(),
            email: None,
            hourly_rate: None,
            archived: false,
            cvr: None,
            ..Default::default()
        }];
        let web = WebCatalog {
            client_domains: [("k1".to_string(), vec!["bageriet.dk".to_string()])].into(),
            site_mappings: vec![
                WebSiteMapping { domain: "figma.com".into(), client_id: Some("k1".into()), usage_count: 3, ..Default::default() },
                WebSiteMapping { domain: "uden-maal.dk".into(), ..Default::default() },
            ],
            ..Default::default()
        };
        let c = catalog(&customers, &[], &web);
        assert_eq!(c.clients[0].domains, vec!["bageriet.dk"]);
        assert_eq!(c.site_mappings.len(), 1);
        assert_eq!((c.site_mappings[0].domain.as_str(), c.site_mappings[0].client_id.as_deref(), c.site_mappings[0].usage_count), ("figma.com", Some("k1"), 3));
    }

    #[test]
    fn regler_fra_datalaget_bliver_matcherregler_og_ikke_arbejde_ignoreres() {
        use crate::backend::services::WebRule;
        use tt_data::RuleKind;
        let rule = |kind, pattern: &str, client: Option<&str>, not_work| WebRule {
            id: format!("r-{pattern}"),
            kind,
            pattern: pattern.into(),
            project_id: None,
            client_id: client.map(str::to_string),
            not_work,
        };
        let web = WebCatalog {
            rules: vec![
                rule(RuleKind::Domain, "www.YouTube.com", None, true),
                rule(RuleKind::App, "Spotify", None, true),
                rule(RuleKind::Repo, "github.com/bageriet/web", Some("k1"), false),
                rule(RuleKind::Repo, "/Users/m/dev/bageriet", Some("k1"), false),
                rule(RuleKind::TitleTemplate, "Bageriet", Some("k1"), false),
                rule(RuleKind::UrlPattern, "*bageriet.dk/admin*", Some("k1"), false),
                // En domæne-kobling med mål er en site-kobling, ikke en regel.
                rule(RuleKind::Domain, "figma.com", Some("k1"), false),
                // Uden mål og uden "ikke arbejde": web afviser den, vi ignorerer den.
                rule(RuleKind::App, "Slack", None, false),
            ],
            ..Default::default()
        };
        let customers = vec![Customer {
            id: "k1".into(),
            name: "Bageriet".into(),
            email: None,
            hourly_rate: None,
            archived: false,
            cvr: None,
            ..Default::default()
        }];
        let c = catalog(&customers, &[], &web);
        let fields: Vec<(mm::RuleField, mm::RuleOp, &str, bool)> = c
            .rules
            .iter()
            .map(|r| (r.field, r.op, r.value.as_str(), r.target.is_none()))
            .collect();
        use mm::{RuleField as F, RuleOp as O};
        assert_eq!(
            fields,
            vec![
                (F::Domain, O::Equals, "youtube.com", true),
                (F::Domain, O::Glob, "*.youtube.com", true),
                (F::App, O::Equals, "Spotify", true),
                (F::Repo, O::Equals, "github.com/bageriet/web", false),
                (F::Path, O::StartsWith, "/Users/m/dev/bageriet", false),
                (F::Title, O::Contains, "Bageriet", false),
                (F::Url, O::Glob, "*bageriet.dk/admin*", false),
            ]
        );
        assert!(c.rules.iter().all(|r| r.priority == i32::from(r.target.is_none())));

        // Matcheren ignorerer aktiviteten på "ikke arbejde"-domænet og underdomæner.
        let m = mm::Matcher::new(c, mm::PatternStore::new());
        for url in ["https://www.youtube.com/watch?v=1", "https://m.youtube.com/"] {
            let seg = mm::ActivitySegment {
                app: "Google Chrome".into(),
                title: "Bageriet - YouTube".into(),
                url: Some(url.into()),
                start: 0,
                end: 600,
                ..Default::default()
            };
            assert!(matches!(m.match_segment(&seg), mm::SegmentMatch::Ignore { .. }), "{url}");
        }
    }

    #[test]
    fn interne_projekter_bliver_forslag_uden_kunde() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
        let block = |target: Option<mm::Target>| mm::Suggestion {
            start: local_ts(9, 0),
            end: local_ts(10, 0),
            target,
            confidence: 0.5,
            source: None,
            reason: "Intern".into(),
            segment_indices: vec![0],
            absorbed_interruptions: 0,
            held_back: None,
        };
        let internal = to_ui_suggestion(date, &block(Some(mm::Target::project(None, "p_intern")))).unwrap();
        assert_eq!((internal.customer_id.as_deref(), internal.project_id.as_deref()), (None, Some("p_intern")));
        assert_eq!(
            crate::timer::suggestion_prompt(&internal, &[]).as_deref(),
            Some("Det ligner intern tid. Start timer?")
        );
        // En uklar blok venter på AI-kæden og vises ikke.
        assert!(to_ui_suggestion(date, &block(None)).is_none());
    }

    #[test]
    fn ui_suggestion_uses_local_time_and_stable_id() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
        let block = mm::Suggestion {
            start: local_ts(9, 0),
            end: local_ts(10, 30),
            target: Some(mm::Target::project(Some("k1"), "p1")),
            confidence: 0.83,
            source: None,
            reason: "Repoet hører til projektet".into(),
            segment_indices: vec![0],
            absorbed_interruptions: 0,
            held_back: None,
        };
        let ui = to_ui_suggestion(date, &block).unwrap();
        assert_eq!(ui.start, NaiveTime::from_hms_opt(9, 0, 0).unwrap());
        assert_eq!(ui.end, NaiveTime::from_hms_opt(10, 30, 0).unwrap());
        assert_eq!(ui.date, date);
        assert_eq!(ui.customer_id.as_deref(), Some("k1"));
        assert_eq!(ui.project_id.as_deref(), Some("p1"));
        assert_eq!(ui.minutes(), 90);
        assert_eq!(ui.reason, "Repoet hører til projektet");
        assert_eq!(to_ui_suggestion(date, &block).unwrap().id, ui.id);

        let mut other = block.clone();
        other.target = Some(mm::Target::client("k1"));
        assert_ne!(to_ui_suggestion(date, &other).unwrap().id, ui.id);
    }

    #[test]
    fn unclear_blocks_are_not_shown() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
        let mut block = mm::Suggestion {
            start: local_ts(9, 0),
            end: local_ts(10, 0),
            target: None,
            confidence: 0.3,
            source: None,
            reason: String::new(),
            segment_indices: vec![],
            absorbed_interruptions: 0,
            held_back: None,
        };
        assert!(to_ui_suggestion(date, &block).is_none());
        block.target = Some(mm::Target::project(None, "intern"));
        assert!(to_ui_suggestion(date, &block).is_some(), "intern tid uden kunde vises");
    }

    #[test]
    fn block_ending_at_midnight_is_clamped() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
        let next_midnight = Local
            .with_ymd_and_hms(2026, 10, 21, 0, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let block = mm::Suggestion {
            start: local_ts(23, 0),
            end: next_midnight,
            target: Some(mm::Target::client("k1")),
            confidence: 0.9,
            source: None,
            reason: String::new(),
            segment_indices: vec![],
            absorbed_interruptions: 0,
            held_back: None,
        };
        let ui = to_ui_suggestion(date, &block).unwrap();
        assert_eq!(ui.end, NaiveTime::from_hms_opt(23, 59, 0).unwrap());
    }

    #[test]
    fn subtract_spans_cuts_and_splits_segments() {
        let seg = mm::ActivitySegment {
            app: "Code".into(),
            start: 0,
            end: 100,
            ..Default::default()
        };
        // Midt i: to stykker.
        let cut = subtract_spans(vec![seg.clone()], &[(40, 60)]);
        assert_eq!(
            cut.iter().map(|s| (s.start, s.end)).collect::<Vec<_>>(),
            [(0, 40), (60, 100)]
        );
        // Dækker alt: væk.
        assert!(subtract_spans(vec![seg.clone()], &[(-10, 200)]).is_empty());
        // Ved siden af: uændret.
        assert_eq!(subtract_spans(vec![seg.clone()], &[(100, 150)]).len(), 1);
        // Flere udsnit.
        let cut = subtract_spans(vec![seg], &[(0, 10), (90, 100), (40, 50)]);
        assert_eq!(
            cut.iter().map(|s| (s.start, s.end)).collect::<Vec<_>>(),
            [(10, 40), (50, 90)]
        );
    }

    #[test]
    fn home_expansion() {
        let home = Path::new("/Users/m");
        assert_eq!(expand_home("~/dev", Some(home)), Path::new("/Users/m/dev"));
        assert_eq!(expand_home("~", Some(home)), home);
        assert_eq!(expand_home("/opt/x", Some(home)), Path::new("/opt/x"));
        assert_eq!(expand_home("~/dev", None), Path::new("~/dev"));
    }

    #[test]
    fn domains_are_normalized() {
        assert_eq!(
            normalize_domain("https://www.NetBank.dk/login?x=1").as_deref(),
            Some("netbank.dk")
        );
        assert_eq!(
            normalize_domain("netbank.dk:8443").as_deref(),
            Some("netbank.dk")
        );
        assert_eq!(normalize_domain("  ").as_deref(), None);
        assert_eq!(
            normalize_domain("bruger@mail.dk").as_deref(),
            Some("mail.dk")
        );
    }

    #[test]
    fn private_windows_are_excluded_unless_the_user_opts_in() {
        let mut t = crate::backend::Settings::defaults().tracking;
        assert!(!t.track_private_windows, "standard: fra");
        assert!(tracker_config(&t, None).exclude_incognito);
        t.track_private_windows = true;
        assert!(!tracker_config(&t, None).exclude_incognito);
    }

    #[test]
    fn old_settings_without_the_field_do_not_track_private_windows() {
        // Gemt før 0.2.28: feltet findes ikke i JSON'en.
        let json = serde_json::json!({
            "enabled": true, "idleMinutes": 5, "excludedApps": [], "excludedDomains": [],
            "repoRoots": [], "retentionDays": 14
        });
        let t: TrackingSettings = serde_json::from_value(json).unwrap();
        assert!(!t.track_private_windows);
        assert!(tracker_config(&t, None).exclude_incognito);
    }

    #[test]
    fn tracking_settings_become_tracker_config() {
        let t = TrackingSettings {
            enabled: true,
            idle_minutes: 7,
            excluded_apps: vec!["1Password".into(), " ".into()],
            excluded_domains: vec!["netbank.dk".into(), "".into()],
            repo_roots: vec!["~/dev".into(), "".into(), "/opt/repos".into()],
            retention_days: 21,
            browser_urls: true,
            start_on_launch: false,
            excluded_titles: vec![],
            fold_short_secs: 30,
            track_private_windows: false,
        };
        let c = tracker_config(&t, Some(Path::new("/Users/m")));
        assert_eq!(c.idle_threshold_secs, 420);
        assert_eq!(c.retention_days, 21);
        assert_eq!(
            c.repo_roots,
            vec![PathBuf::from("/Users/m/dev"), PathBuf::from("/opt/repos")]
        );
        assert_eq!(c.exclusion_rules.len(), 2);
        // Resten er trackerens standard.
        assert!(c.exclude_incognito);
        assert!(c.browser_url_capture);
    }

    #[test]
    fn browser_urls_can_be_turned_off() {
        let mut t = crate::backend::Settings::defaults().tracking;
        assert!(t.browser_urls, "standard til");
        t.browser_urls = false;
        assert!(!tracker_config(&t, None).browser_url_capture);
        // En indstillingsfil fra før feltet fandtes læses som "til".
        let mut json = serde_json::to_value(t.clone()).unwrap();
        json.as_object_mut().unwrap().remove("browserUrls");
        let old: TrackingSettings = serde_json::from_value(json).unwrap();
        assert!(old.browser_urls);
    }

    #[test]
    fn excluded_titles_become_title_rules() {
        let mut t = crate::backend::Settings::defaults().tracking;
        t.excluded_titles = vec!["Privat".into(), "  ".into()];
        let rules = tracker_config(&t, None).exclusion_rules;
        let excluded =
            |title: &str| tr::exclusion::should_exclude("Safari", title, None, &rules, false);
        assert!(excluded("Mit PRIVAT budget"));
        assert!(!excluded("Bageriet – webshop"));
        // En indstillingsfil fra før felterne fandtes.
        let mut json = serde_json::to_value(t).unwrap();
        let o = json.as_object_mut().unwrap();
        o.remove("excludedTitles");
        o.remove("foldShortSecs");
        let old: TrackingSettings = serde_json::from_value(json).unwrap();
        assert!(old.excluded_titles.is_empty());
        assert_eq!(old.fold_short_secs, 30);
    }

    #[test]
    fn exclusion_rules_hit_the_right_things() {
        let t = TrackingSettings {
            enabled: true,
            idle_minutes: 5,
            excluded_apps: vec!["1Password".into()],
            excluded_domains: vec!["netbank.dk".into()],
            repo_roots: vec![],
            retention_days: 14,
            browser_urls: true,
            start_on_launch: false,
            excluded_titles: vec![],
            fold_short_secs: 30,
            track_private_windows: false,
        };
        let rules = tracker_config(&t, None).exclusion_rules;
        let excluded = |app: &str, url: Option<&str>| {
            tr::exclusion::should_exclude(app, "titel", url, &rules, false)
        };
        assert!(excluded("1password", None));
        assert!(!excluded("Code", None));
        for url in [
            "https://netbank.dk/",
            "https://www.netbank.dk/privat?x=1",
            "https://min.netbank.dk",
            "https://netbank.dk:8443/x",
            "netbank.dk/x",
        ] {
            assert!(excluded("Safari", Some(url)), "{url} skulle udelades");
        }
        for url in [
            "https://notnetbank.dk/",
            "https://example.com/netbank.dk",
            "https://netbank.dk.evil.com/",
            "https://example.com/?u=https://netbank.dk",
        ] {
            assert!(!excluded("Safari", Some(url)), "{url} skulle ikke udelades");
        }
    }
}
