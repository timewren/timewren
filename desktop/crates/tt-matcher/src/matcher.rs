//! Matching af ét segment: regler → identitet → lærte mønstre → navne.

use crate::glob::glob_match;
use crate::learning::{Feedback, PatternHit, PatternStore};
use crate::names::{
    MatchType, NameMatch, find_potential_matches, match_identifiers, match_names_in_text,
};
use crate::normalize::{
    Fold, clean_title, domain_matches, fold_danish, normalize_app, normalize_domain,
    normalize_path, normalize_repo_remote, normalize_text, path_components, path_is_within,
    repo_owner_and_name, segment_host,
};
use crate::model::{BlockOutcome, UserModel};
use crate::rank::UsageStore;
use crate::types::{
    ActivitySegment, Candidate, Catalog, IdentityKind, Layer, Rule, RuleField, RuleOp,
    SegmentMatch, Signal, Source, Suggestion, Target,
};

/// Vægte for Naive Bayes: bekræft, ret og egne poster.
const WEIGHT_CONFIRM: f32 = 1.0;
const WEIGHT_CORRECT: f32 = 1.5;
const WEIGHT_LOGGED: f32 = 0.7;
/// Naive Bayes' fordeling blandes med så meget jævn fordeling i emissionen.
const NB_MIX: f64 = 0.2;
/// Projektmodellens klasse for "kunden uden projekt".
const NO_PROJECT: &str = "-";

/// Ejeren på en kodevært: `https://github.com/hansen-vvs/web` → `hansen-vvs`.
fn code_host_owner(url: &str) -> Option<String> {
    const HOSTS: &[&str] = &["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"];
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let mut parts = rest.split(['/', '?', '#']);
    let host = parts.next()?.trim_start_matches("www.").to_lowercase();
    if !HOSTS.contains(&host.as_str()) {
        return None;
    }
    let owner = parts.next().filter(|o| !o.is_empty())?.to_lowercase();
    // Kodeværtens egne sider er ikke en ejer.
    const OWN: &[&str] = &["notifications", "settings", "orgs", "pulls", "issues", "explore", "login", "marketplace"];
    (!OWN.contains(&owner.as_str())).then_some(owner)
}

/// Et bud, der er brugerens eget udsagn (regel, identitet) eller et stærkt
/// lært mønster: udglatningen må aldrig flytte det.
fn is_statement(c: &Candidate) -> bool {
    matches!(c.source.layer, Layer::Rule | Layer::Identity)
        || (c.source.layer == Layer::Pattern && c.confidence >= 0.9)
}

/// "a", "a og b", "a, b og c".
fn join_danish(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [a] => a.clone(),
        [rest @ .., last] => format!("{} og {last}", rest.join(", ")),
    }
}

/// Indstillinger for matching og blokke.
#[derive(Debug, Clone, PartialEq)]
pub struct MatchConfig {
    /// Korteste blok, der foreslås (sekunder).
    pub min_block_secs: i64,
    /// Længste afbrydelse, der lægges ind i en blok (A→B→A).
    pub max_interruption_secs: i64,
    /// Største hul mellem to segmenter i samme blok.
    pub max_gap_secs: i64,
    /// Under denne konfidens er et segment eller en blok uklar.
    pub unclear_below: f32,
    /// Konfidens pr. lag lært af brugerens svar (se [`crate::model`]). Bruges i
    /// modellens vej (Naive Bayes + udglatning) og til observatørens spørgsmål
    /// ([`Matcher::match_calibrated`]), ikke på kaskadens egne forslag: dér
    /// trækker den alle bud i et lag mod lagets gennemsnit og gør rigtige og
    /// forkerte bud i samme lag uklare ens (RAPPORT-ux-matcher2).
    pub calibrate: bool,
    /// Tærsklen for "foreslået" valgt fra brugerens risk-coverage; under den
    /// bliver blokken uklar.
    pub learned_threshold: bool,
    /// Naive Bayes over svage signaler (se [`crate::nb`]).
    pub naive_bayes: ModelMode,
    /// Udglatning over dagen i modellens vej (Viterbi/forward-backward, se
    /// [`crate::smooth`]). Fra = hvert segment for sig (til ablation).
    pub smoothing: bool,
}

/// Hvordan et nyt lag bruges.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelMode {
    /// Lærer ikke og bruges ikke.
    Off,
    /// Lærer og kan måles ([`Matcher::shadow_suggest`]), men ændrer ikke forslagene.
    Shadow,
    /// Skygge, indtil målingen på brugerens egne svar viser, at modellen rammer
    /// mere uden lavere præcision ([`crate::model::ShadowStats::promoted`]).
    Auto,
    /// Lærer og bruges i forslagene.
    On,
}

impl Default for MatchConfig {
    fn default() -> Self {
        Self {
            min_block_secs: 300,
            max_interruption_secs: 300,
            max_gap_secs: 300,
            unclear_below: 0.5,
            calibrate: true,
            learned_threshold: true,
            naive_bayes: ModelMode::Auto,
            smoothing: true,
        }
    }
}

/// Konfidens pr. kilde.
pub mod confidence {
    pub const RULE: f32 = 0.98;
    /// En app-regel på et program med mange projekter (editor, browser).
    pub const RULE_MULTI_PROJECT_APP: f32 = 0.80;
    pub const URL_PATTERN: f32 = 0.96;
    pub const SITE_MAPPING: f32 = 0.85;
    pub const SITE_MAPPING_MAX: f32 = 0.90;
    pub const IDENTITY_REPO: f32 = 0.97;
    pub const IDENTITY_PATH: f32 = 0.95;
    pub const IDENTITY_DOMAIN: f32 = 0.93;
    pub const IDENTITY_APP_KEYWORD: f32 = 0.85;
    pub const CLIENT_DOMAIN: f32 = 0.92;
    /// Navnematching skaleres og loftes, for det er et gæt.
    pub const NAME_SCALE: f32 = 0.85;
    pub const NAME_MAX: f32 = 0.75;
    pub const AI_MAX: f32 = 0.70;
}

/// Programmer, der rummer mange projekter i ét vindue. En regel eller
/// identitet på programnavnet alene er her kun et hint.
pub fn is_multi_project_app(app: &str) -> bool {
    const APPS: &[&str] = &[
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
        "sublime",
        "vim",
        "chrome",
        "edge",
        "firefox",
        "brave",
        "opera",
        "vivaldi",
        "safari",
        "arc",
        "terminal",
        "iterm",
        "warp",
        "ghostty",
        "wezterm",
        "alacritty",
        "kitty",
        "powershell",
        "pwsh",
        "cmd",
        "word",
        "excel",
        "powerpoint",
        "figma",
        "notion",
        "obsidian",
        "slack",
        "teams",
        "outlook",
        "mail",
    ];
    let app = normalize_app(app);
    APPS.iter()
        .any(|a| app == *a || app.split([' ', '-', '.']).any(|w| w == *a))
}

/// Signalerne fra et segment i den form, reglerne sammenligner på.
struct Signals {
    app: String,
    title: String,
    title_cmp: String,
    url: String,
    host: Option<String>,
    repo: Option<String>,
    path: Option<String>,
    document: Option<String>,
}

impl Signals {
    fn of(seg: &ActivitySegment) -> Self {
        let title = clean_title(&seg.app, &seg.title);
        let mut title_cmp = cmp_text(&title);
        if let Some(doc) = seg.document.as_deref() {
            title_cmp.push(' ');
            title_cmp.push_str(&cmp_text(doc));
        }
        Signals {
            app: normalize_app(&seg.app),
            title_cmp,
            title,
            url: seg.url.clone().unwrap_or_default(),
            host: segment_host(seg.domain.as_deref(), seg.url.as_deref()),
            repo: seg
                .repo_remote
                .as_deref()
                .filter(|r| !r.trim().is_empty())
                .map(normalize_repo_remote),
            path: seg
                .path
                .as_deref()
                .filter(|p| !p.trim().is_empty())
                .map(normalize_path),
            document: seg.document.clone().filter(|d| !d.trim().is_empty()),
        }
    }
}

/// Tekst til "indeholder"-sammenligning: normaliseret og foldet (ae/oe/aa).
fn cmp_text(s: &str) -> String {
    fold_danish(&normalize_text(s), Fold::Double)
}

/// Hele ord: `needle` findes i `haystack` med ordgrænse på begge sider.
fn contains_words(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let h = format!(" {haystack} ");
    h.contains(&format!(" {needle} "))
}

fn rule_value<'a>(rule: &Rule, sig: &'a Signals) -> Option<std::borrow::Cow<'a, str>> {
    use std::borrow::Cow;
    Some(match rule.field {
        RuleField::App => Cow::Borrowed(sig.app.as_str()),
        RuleField::Title => Cow::Owned(sig.title.to_lowercase()),
        RuleField::Url => Cow::Owned(sig.url.to_lowercase()),
        RuleField::Domain => Cow::Borrowed(sig.host.as_deref()?),
        RuleField::Repo => Cow::Borrowed(sig.repo.as_deref()?),
        RuleField::Path => Cow::Borrowed(sig.path.as_deref()?),
        RuleField::Document => Cow::Owned(sig.document.as_deref()?.to_lowercase()),
    })
}

/// Evaluerer en brugerregel. Alt uden forskel på store og små bogstaver;
/// "indeholder" accepterer også ae/oe/aa-stavemåden.
pub fn rule_matches(rule: &Rule, seg: &ActivitySegment) -> bool {
    rule_matches_signals(rule, &Signals::of(seg))
}

fn rule_matches_signals(rule: &Rule, sig: &Signals) -> bool {
    let Some(value) = rule_value(rule, sig) else {
        return false;
    };
    let wanted = match (rule.field, rule.op) {
        (RuleField::Repo, RuleOp::Equals) => normalize_repo_remote(&rule.value),
        (RuleField::Path, RuleOp::Equals | RuleOp::StartsWith) => normalize_path(&rule.value),
        (RuleField::Domain, RuleOp::Equals) => normalize_domain(&rule.value),
        (RuleField::Domain, _) => {
            let v = rule.value.trim().to_lowercase();
            v.strip_prefix("www.").map(str::to_string).unwrap_or(v)
        }
        (RuleField::App, _) if rule.op != RuleOp::Glob => normalize_app(&rule.value),
        _ => rule.value.trim().to_lowercase(),
    };
    if wanted.is_empty() {
        return false;
    }
    match rule.op {
        RuleOp::Equals => value == wanted,
        RuleOp::StartsWith => match rule.field {
            RuleField::Path => path_is_within(&value, &wanted),
            _ => value.starts_with(&wanted),
        },
        RuleOp::Glob => glob_match(&wanted, &value),
        RuleOp::Contains => {
            value.contains(&wanted)
                || fold_danish(&value, Fold::Double).contains(&fold_danish(&wanted, Fold::Double))
        }
    }
}

fn field_signal(field: RuleField) -> Signal {
    match field {
        RuleField::App => Signal::App,
        RuleField::Title => Signal::Title,
        RuleField::Url => Signal::Url,
        RuleField::Domain => Signal::Domain,
        RuleField::Repo => Signal::Repo,
        RuleField::Path => Signal::Path,
        RuleField::Document => Signal::Document,
    }
}

fn field_label(field: RuleField) -> &'static str {
    match field {
        RuleField::App => "programmet",
        RuleField::Title => "titlen",
        RuleField::Url => "URL'en",
        RuleField::Domain => "domænet",
        RuleField::Repo => "repoet",
        RuleField::Path => "mappen",
        RuleField::Document => "dokumentet",
    }
}

fn op_label(op: RuleOp) -> &'static str {
    match op {
        RuleOp::Contains => "indeholder",
        RuleOp::Equals => "er",
        RuleOp::StartsWith => "starter med",
        RuleOp::Glob => "matcher",
    }
}

/// Resultat af ét lag før opslag af navne.
enum LayerOutcome {
    Hit(Candidate),
    Ignore(String),
}

/// Matcheren. Ejer kataloget og mønstrene; ingen IO.
#[derive(Debug, Clone, Default)]
pub struct Matcher {
    pub catalog: Catalog,
    pub patterns: PatternStore,
    pub config: MatchConfig,
    /// Brugen pr. mål; bruges kun til at rangere AI'ens kandidater.
    pub usage: UsageStore,
    /// Det, matcheren har lært om sine egne lag (kalibrering, tærskel).
    pub model: UserModel,
}

impl Matcher {
    pub fn new(catalog: Catalog, patterns: PatternStore) -> Self {
        Self {
            catalog,
            patterns,
            config: MatchConfig::default(),
            usage: UsageStore::default(),
            model: UserModel::default(),
        }
    }

    /// Matcheren med brugerens model (`model.json`).
    pub fn with_model(mut self, model: UserModel) -> Self {
        self.model = model;
        self
    }

    pub fn with_config(mut self, config: MatchConfig) -> Self {
        self.config = config;
        self
    }

    fn candidate(
        &self,
        target: &Target,
        confidence: f32,
        layer: Layer,
        signal: Signal,
        reason: String,
    ) -> Option<Candidate> {
        let target = self.catalog.resolve(target)?;
        Some(Candidate {
            target,
            confidence,
            source: Source { layer, signal },
            reason,
        })
    }

    /// Matcher ét segment.
    pub fn match_segment(&self, seg: &ActivitySegment) -> SegmentMatch {
        let sig = Signals::of(seg);
        let pattern = self.patterns.lookup(seg);

        let winner = self
            .rules(&sig)
            .or_else(|| self.url_patterns(&sig))
            .or_else(|| {
                pattern
                    .as_ref()
                    .filter(|p| p.strong)
                    .and_then(|p| self.pattern_candidate(p))
                    .map(LayerOutcome::Hit)
            })
            .or_else(|| self.site_mappings(&sig))
            .or_else(|| self.identity(&sig))
            .or_else(|| {
                pattern
                    .as_ref()
                    .and_then(|p| self.pattern_candidate(p))
                    .map(LayerOutcome::Hit)
            });

        match winner {
            Some(LayerOutcome::Ignore(reason)) => SegmentMatch::Ignore { reason },
            Some(LayerOutcome::Hit(c)) => {
                SegmentMatch::Match(self.refine_project(c, seg, &sig, pattern.as_ref()))
            }
            None => match self.names(seg, &sig, None) {
                Some(c) => SegmentMatch::Match(c),
                None => SegmentMatch::Unknown,
            },
        }
    }

    /// En vinder uden projekt får projektet fra et lavere lag, hvis det
    /// peger på samme kunde. Konfidensen sænkes lidt, for projektet er
    /// svagere belagt end kunden.
    fn refine_project(
        &self,
        c: Candidate,
        seg: &ActivitySegment,
        sig: &Signals,
        pattern: Option<&PatternHit>,
    ) -> Candidate {
        if c.target.project_id.is_some() {
            return c;
        }
        let lower = pattern
            .and_then(|p| self.pattern_candidate(p))
            .filter(|p| p.source != c.source)
            .into_iter()
            .chain(self.names(seg, sig, c.target.client_id.as_deref()));
        for other in lower {
            if other.target.project_id.is_some() && other.target.compatible(&c.target) {
                return Candidate {
                    target: c.target.merge(&other.target),
                    confidence: c.confidence * 0.95,
                    reason: format!(
                        "{}; projektet: {}",
                        c.reason,
                        lowercase_first(&other.reason)
                    ),
                    source: c.source,
                };
            }
        }
        c
    }

    fn rules(&self, sig: &Signals) -> Option<LayerOutcome> {
        let mut rules: Vec<&Rule> = self.catalog.rules.iter().filter(|r| r.active).collect();
        rules.sort_by_key(|r| std::cmp::Reverse(r.priority));
        for rule in rules {
            if !rule_matches_signals(rule, sig) {
                continue;
            }
            let what = format!(
                "{} {} \"{}\"",
                field_label(rule.field),
                op_label(rule.op),
                rule.value
            );
            let Some(target) = &rule.target else {
                return Some(LayerOutcome::Ignore(format!(
                    "Reglen \"{what}\" siger, at det ikke er arbejde"
                )));
            };
            let confidence = if rule.field == RuleField::App && is_multi_project_app(&sig.app) {
                confidence::RULE_MULTI_PROJECT_APP
            } else {
                confidence::RULE
            };
            let reason = format!("Din regel: {what}");
            if let Some(c) = self.candidate(
                target,
                confidence,
                Layer::Rule,
                field_signal(rule.field),
                reason,
            ) {
                return Some(LayerOutcome::Hit(c));
            }
        }
        None
    }

    fn url_patterns(&self, sig: &Signals) -> Option<LayerOutcome> {
        if sig.url.is_empty() {
            return None;
        }
        for project in self.catalog.projects.iter().filter(|p| !p.archived) {
            for pattern in &project.url_patterns {
                if glob_match(pattern, &sig.url) {
                    let target = Target::project(project.client_id.as_deref(), &project.id);
                    let reason = format!("URL'en matcher projektets mønster \"{pattern}\"");
                    if let Some(c) = self.candidate(
                        &target,
                        confidence::URL_PATTERN,
                        Layer::Rule,
                        Signal::Url,
                        reason,
                    ) {
                        return Some(LayerOutcome::Hit(c));
                    }
                }
            }
        }
        None
    }

    /// Udvidelsens `getSuggestion`: eksakt domæne, ellers forældredomænet.
    fn site_mappings(&self, sig: &Signals) -> Option<LayerOutcome> {
        let host = sig.host.as_deref()?;
        let find = |d: &str| {
            self.catalog
                .site_mappings
                .iter()
                .find(|m| normalize_domain(&m.domain) == d)
        };
        let parts: Vec<&str> = host.split('.').collect();
        let parent = (parts.len() > 2).then(|| parts[parts.len() - 2..].join("."));
        let mapping = find(host).or_else(|| parent.as_deref().and_then(find))?;
        let target = Target {
            client_id: mapping.client_id.clone(),
            project_id: mapping.project_id.clone(),
        };
        let confidence = (confidence::SITE_MAPPING + 0.01 * mapping.usage_count.min(10) as f32)
            .min(confidence::SITE_MAPPING_MAX);
        let reason = format!(
            "Udvidelsen har koblet {} til {}",
            mapping.domain,
            self.catalog.describe(&target)
        );
        self.candidate(&target, confidence, Layer::Rule, Signal::Domain, reason)
            .map(LayerOutcome::Hit)
    }

    fn identity(&self, sig: &Signals) -> Option<LayerOutcome> {
        // (rang, specificitet) – lavest rang og længst værdi vinder.
        let mut best: Option<((IdentityKind, std::cmp::Reverse<usize>), LayerOutcome)> = None;
        for b in &self.catalog.identities {
            let value = b.value.trim();
            let hit = match b.kind {
                IdentityKind::RepoRemote => sig
                    .repo
                    .as_deref()
                    .is_some_and(|r| r == normalize_repo_remote(value)),
                IdentityKind::Path => sig
                    .path
                    .as_deref()
                    .is_some_and(|p| path_is_within(p, &normalize_path(value))),
                IdentityKind::Domain => sig
                    .host
                    .as_deref()
                    .is_some_and(|h| domain_matches(h, &normalize_domain(value))),
                IdentityKind::AppKeyword => {
                    let app_ok = b
                        .app
                        .as_deref()
                        .is_none_or(|a| a.trim().is_empty() || normalize_app(a) == sig.app);
                    app_ok && contains_words(&sig.title_cmp, &cmp_text(value))
                }
            };
            if !hit {
                continue;
            }
            let rank = (b.kind, std::cmp::Reverse(value.len()));
            if best.as_ref().is_some_and(|(r, _)| *r <= rank) {
                continue;
            }
            let (label, signal, conf) = match b.kind {
                IdentityKind::RepoRemote => ("Repoet", Signal::Repo, confidence::IDENTITY_REPO),
                IdentityKind::Path => ("Mappen", Signal::Path, confidence::IDENTITY_PATH),
                IdentityKind::Domain => ("Domænet", Signal::Domain, confidence::IDENTITY_DOMAIN),
                IdentityKind::AppKeyword => (
                    "Nøgleordet",
                    Signal::Title,
                    confidence::IDENTITY_APP_KEYWORD,
                ),
            };
            let outcome = match &b.target {
                None => Some(LayerOutcome::Ignore(format!(
                    "{label} {value} er markeret som ikke arbejde"
                ))),
                Some(t) => {
                    let reason = format!("{label} {value} hører til {}", self.catalog.describe(t));
                    self.candidate(t, conf, Layer::Identity, signal, reason)
                        .map(LayerOutcome::Hit)
                }
            };
            if let Some(o) = outcome {
                best = Some((rank, o));
            }
        }
        if let Some((_, o)) = best {
            return Some(o);
        }
        // Kundens repo-ejer (profilen) er også identitet: repoet eller en side
        // på en kodevært (`github.com/<ejer>/…`).
        let owner = sig
            .repo
            .as_deref()
            .and_then(|r| repo_owner_and_name(r).0.map(str::to_string))
            .or_else(|| code_host_owner(&sig.url));
        if let Some(owner) = owner {
            for client in self.catalog.clients.iter().filter(|c| !c.archived) {
                if client.repo_owners.iter().any(|o| o.trim().eq_ignore_ascii_case(&owner)) {
                    let reason = format!("Repo-ejeren {owner} er kundens");
                    if let Some(c) = self.candidate(
                        &Target::client(&client.id),
                        confidence::CLIENT_DOMAIN,
                        Layer::Identity,
                        Signal::Repo,
                        reason,
                    ) {
                        return Some(LayerOutcome::Hit(c));
                    }
                }
            }
        }
        // Kundens egne domæner er også identitet. (Mail-domæner og et domæne i
        // navnet er kun et navnegæt; se `names`.)
        let host = sig.host.as_deref()?;
        for client in self.catalog.clients.iter().filter(|c| !c.archived) {
            if let Some(d) = client
                .domains
                .iter()
                .find(|d| domain_matches(host, &normalize_domain(d)))
            {
                let reason = format!("Domænet {d} er kundens");
                if let Some(c) = self.candidate(
                    &Target::client(&client.id),
                    confidence::CLIENT_DOMAIN,
                    Layer::Identity,
                    Signal::Domain,
                    reason,
                ) {
                    return Some(LayerOutcome::Hit(c));
                }
            }
        }
        None
    }

    fn pattern_candidate(&self, hit: &PatternHit) -> Option<Candidate> {
        let mut how = Vec::new();
        if hit.confirmations > 0 {
            how.push(format!(
                "bekræftet {} gang{}",
                hit.confirmations,
                if hit.confirmations == 1 { "" } else { "e" }
            ));
        }
        if hit.corrections > 0 {
            how.push(format!(
                "rettet {} gang{}",
                hit.corrections,
                if hit.corrections == 1 { "" } else { "e" }
            ));
        }
        if hit.ai_answers > 0 && how.is_empty() {
            how.push("foreslået af AI".to_string());
        }
        let reason = format!(
            "Lært: {} er {} til {}",
            hit.key.describe(),
            how.join(" og "),
            self.catalog.describe(&hit.target)
        );
        self.candidate(
            &hit.target,
            hit.confidence,
            Layer::Pattern,
            hit.key.signal(),
            reason,
        )
    }

    /// Navnematching. Tvetydige navne (to kunder lige tæt) giver intet bud.
    /// `within` begrænser til én kundes projekter (når kunden allerede er kendt).
    fn names(
        &self,
        seg: &ActivitySegment,
        sig: &Signals,
        within: Option<&str>,
    ) -> Option<Candidate> {
        // Profilen: kerne-navn uden selskabsform og binavne som ekstra navne.
        let clients: Vec<_> = self
            .catalog
            .clients
            .iter()
            .filter(|c| !c.archived && within.is_none_or(|w| c.id == w))
            .flat_map(crate::profile::name_variants)
            .collect();
        let projects: Vec<_> = self
            .catalog
            .projects
            .iter()
            .filter(|p| !p.archived && within.is_none_or(|w| p.client_id.as_deref() == Some(w)))
            .cloned()
            .collect();
        let mut all: Vec<(NameMatch, Signal)> = Vec::new();

        // Profilens ekstra domæner (mail-domæne, domæne i navnet): et stærkt
        // navnegæt, men ikke identitet, så lærte mønstre stadig går foran.
        if let Some(host) = sig.host.as_deref() {
            for client in self.catalog.clients.iter().filter(|c| !c.archived && within.is_none_or(|w| c.id == w)) {
                let profile = crate::profile::ClientProfile::of(client);
                if let Some(d) = profile.domains.iter().find(|d| {
                    domain_matches(host, d) && !client.domains.iter().any(|o| normalize_domain(o) == **d)
                }) {
                    all.push((
                        NameMatch {
                            kind: MatchType::Client,
                            id: client.id.clone(),
                            name: client.name.clone(),
                            confidence: 1.0,
                            reason: format!("Domænet {d} står i kundens mail eller navn"),
                        },
                        Signal::Domain,
                    ));
                }
            }
        }

        let host = sig.host.clone().unwrap_or_default();
        let web = find_potential_matches(&host, &sig.url, &sig.title, &clients, &projects);
        for m in web {
            let signal = if m.reason.starts_with("Domænet") || m.reason.starts_with("Projekt hos")
            {
                Signal::Domain
            } else if m.reason.starts_with("URL") {
                Signal::Url
            } else {
                Signal::Title
            };
            all.push((m, signal));
        }
        let mut text = sig.title.clone();
        if let Some(doc) = &sig.document {
            text.push(' ');
            text.push_str(doc);
        }
        all.extend(
            match_names_in_text(&text, &clients, &projects)
                .into_iter()
                .map(|m| (m, Signal::Title)),
        );
        if let Some(repo) = &sig.repo {
            let (owner, name) = repo_owner_and_name(repo);
            let ids: Vec<String> = owner.into_iter().chain(name).map(str::to_string).collect();
            all.extend(
                match_identifiers(&ids, "Repoet", &clients, &projects)
                    .into_iter()
                    .map(|m| (m, Signal::Repo)),
            );
        }
        if let Some(path) = seg.path.as_deref() {
            let ids = path_components(path);
            all.extend(
                match_identifiers(&ids, "Mappen", &clients, &projects)
                    .into_iter()
                    .map(|m| (m, Signal::Path)),
            );
        }
        if let Some(doc) = &sig.document {
            all.extend(
                match_identifiers(std::slice::from_ref(doc), "Dokumentet", &clients, &projects)
                    .into_iter()
                    .map(|m| (m, Signal::Document)),
            );
        }
        let (target, conf, reason, signal) = pick_name_target(&all, &self.catalog)?;
        let confidence = (conf * confidence::NAME_SCALE).min(confidence::NAME_MAX);
        let found = self.candidate(&target, confidence, Layer::Name, signal, reason)?;
        // Kunden er kendt, projektet ikke (fx "Website" hos to kunder): søg
        // igen blandt kun denne kundes projekter.
        match (&found.target.client_id, &found.target.project_id, within) {
            (Some(client), None, None) => {
                Some(self.refine_project_by_name(found.clone(), seg, sig, client))
            }
            _ => Some(found),
        }
    }

    fn refine_project_by_name(
        &self,
        found: Candidate,
        seg: &ActivitySegment,
        sig: &Signals,
        client: &str,
    ) -> Candidate {
        match self.names(seg, sig, Some(client)) {
            Some(p) if p.target.project_id.is_some() && p.target.compatible(&found.target) => {
                Candidate {
                    target: found.target.merge(&p.target),
                    confidence: found.confidence * 0.95,
                    reason: format!(
                        "{}; projektet: {}",
                        found.reason,
                        lowercase_first(&p.reason)
                    ),
                    source: found.source,
                }
            }
            _ => found,
        }
    }

    /// Bygger forslagsblokke af en række segmenter. Se [`crate::blocks`].
    ///
    /// En blok under brugerens lærte tærskel bliver uklar. Budenes konfidens
    /// kalibreres ikke pr. lag her (se [`MatchConfig::calibrate`]).
    pub fn suggest(&self, segments: &[ActivitySegment]) -> Vec<Suggestion> {
        let matches: Vec<SegmentMatch> = if self.model_in_use() {
            self.model_matches(segments, true)
        } else {
            segments.iter().map(|s| self.match_segment(s)).collect()
        };
        self.blocks_with_threshold(segments, &matches)
    }

    /// Bruges modellen (Naive Bayes + udglatning) i forslagene nu?
    pub fn model_in_use(&self) -> bool {
        match self.config.naive_bayes {
            ModelMode::On => true,
            ModelMode::Auto => self.model.shadow.promoted(),
            ModelMode::Off | ModelMode::Shadow => false,
        }
    }

    /// Det, modellen (Naive Bayes + udglatning) ville foreslå. Ændrer intet;
    /// bruges til at måle skyggetilstanden.
    pub fn shadow_suggest(&self, segments: &[ActivitySegment]) -> Vec<Suggestion> {
        let matches = self.model_matches(segments, true);
        crate::blocks::build(segments, &matches, &self.config)
    }

    fn blocks_with_threshold(
        &self,
        segments: &[ActivitySegment],
        matches: &[SegmentMatch],
    ) -> Vec<Suggestion> {
        let mut blocks = crate::blocks::build(segments, matches, &self.config);
        if self.config.learned_threshold
            && let Some(threshold) = self.model.threshold()
        {
            for b in blocks.iter_mut().filter(|b| b.target.is_some() && b.confidence < threshold) {
                b.held_back = b.target.take();
                b.source = None;
                b.reason = format!("Usikkert: {}", b.reason);
            }
        }
        blocks
    }

    /// Som [`Self::match_segment`], med brugerens kalibrerede konfidens.
    pub fn match_calibrated(&self, seg: &ActivitySegment) -> SegmentMatch {
        self.calibrated(self.match_segment(seg))
    }

    fn calibrated(&self, m: SegmentMatch) -> SegmentMatch {
        match m {
            SegmentMatch::Match(mut c) if self.config.calibrate => {
                c.confidence = self.model.calibration.apply(&c);
                SegmentMatch::Match(c)
            }
            other => other,
        }
    }

    /// Segmenternes bud efter modellen: kaskadens (kalibrerede) bud ganget
    /// med Naive Bayes' fordeling og udglattet over dagen. Brugerens regler,
    /// identiteter (≥ 0,95) og "ikke arbejde" er ankre, som ikke flyttes.
    fn model_matches(&self, segments: &[ActivitySegment], use_nb: bool) -> Vec<SegmentMatch> {
        self.model_matches_raw(segments, use_nb).0
    }

    /// Som [`Self::model_matches`], plus den rå (ukalibrerede) marginal pr.
    /// segment, som Platt-skaleringen lærer af.
    fn model_matches_raw(
        &self,
        segments: &[ActivitySegment],
        use_nb: bool,
    ) -> (Vec<SegmentMatch>, Vec<Option<f32>>) {
        // I modellen er kaskadens bud ét bevis blandt flere, og lagets træfsikkerhed
        // for brugeren er det rigtige tal at gange med.
        let cascade: Vec<SegmentMatch> = segments
            .iter()
            .map(|s| self.calibrated(self.match_segment(s)))
            .collect();
        let nb = &self.model.nb;
        let preds: Vec<Option<crate::nb::Prediction>> = segments
            .iter()
            .map(|s| if use_nb { nb.predict(s) } else { None })
            .collect();
        // Tilstande: kunder, modellen eller kaskaden kender, og "anden" sidst.
        let mut states: Vec<String> = Vec::new();
        let mut add = |c: &str| {
            if !c.is_empty() && !states.iter().any(|s| s == c) {
                states.push(c.to_string());
            }
        };
        // Kun kunder i kataloget, der ikke er arkiveret (modellen kan have lært
        // en kunde, der siden er arkiveret).
        if use_nb {
            for c in nb.classes() {
                if self.catalog.client(c).is_some_and(|x| !x.archived) {
                    add(c);
                }
            }
        }
        for m in &cascade {
            if let SegmentMatch::Match(c) = m
                && let Some(client) = &c.target.client_id
            {
                add(client);
            }
        }
        states.sort();
        let other = states.len();
        let k = other + 1;
        let mut order: Vec<usize> = (0..segments.len()).collect();
        order.sort_by_key(|&i| (segments[i].start, segments[i].end));
        // Rækker til udglatning (ignorerede segmenter springes over og bryder kæden).
        let mut steps: Vec<crate::smooth::Step> = Vec::new();
        let mut rows: Vec<usize> = Vec::new();
        let mut anchors: Vec<bool> = Vec::new();
        let mut last_end: Option<i64> = None;
        let mut broken = true;
        for &i in &order {
            let seg = &segments[i];
            if seg.duration() == 0 {
                continue;
            }
            if matches!(cascade[i], SegmentMatch::Ignore { .. }) {
                broken = true;
                continue;
            }
            // Brugerens regler og identiteter (og stærke mønstre) er udsagn,
            // ikke gæt: de står, som kaskaden sagde. Uden kunde (et internt
            // projekt) kan de ikke være en tilstand og bryder kæden.
            let fixed = matches!(&cascade[i], SegmentMatch::Match(c) if is_statement(c));
            if fixed
                && matches!(&cascade[i], SegmentMatch::Match(c) if c.target.client_id.is_none())
            {
                broken = true;
                continue;
            }
            let mut e = vec![1.0f64; k];
            let mut is_anchor = false;
            // Naive Bayes blandes med en jævn fordeling, så den højst kan
            // trække med en faktor ~5 mod et kaskadebud: den er en svag-signal-
            // model, ikke en, der må overstemme en navnematch eller et mønster.
            if let Some(p) = &preds[i] {
                let flat = NB_MIX / k as f64;
                for (j, st) in states.iter().enumerate() {
                    e[j] = (1.0 - NB_MIX) * f64::from(p.prob(st)) + flat;
                }
                e[other] = (1.0 - NB_MIX) * f64::from(p.prob(crate::nb::OTHER)) + flat;
            }
            if let SegmentMatch::Match(c) = &cascade[i]
                && let Some(j) = c
                    .target
                    .client_id
                    .as_ref()
                    .and_then(|cl| states.iter().position(|s| s == cl))
            {
                if fixed {
                    is_anchor = true;
                    e = vec![1e-9; k];
                    e[j] = 1.0;
                } else {
                    let acc = f64::from(c.confidence).clamp(0.01, 0.99);
                    for (x, v) in e.iter_mut().enumerate() {
                        *v *= if x == j { acc } else { (1.0 - acc) / (k as f64 - 1.0).max(1.0) };
                    }
                }
            }
            // Varighed vejer: et segment på 30 minutter er mere bevis end et på
            // 5 sekunder (emissionen opløftes i minutterne, 0,25-3).
            if !is_anchor {
                let w = (seg.duration() as f64 / 60.0).clamp(0.25, 3.0);
                for v in e.iter_mut() {
                    *v = v.powf(w);
                }
            }
            let gap = last_end.is_some_and(|end| seg.start - end > self.config.max_gap_secs);
            steps.push(crate::smooth::Step {
                emission: e,
                break_before: broken || gap,
            });
            rows.push(i);
            anchors.push(is_anchor);
            broken = false;
            last_end = Some(seg.end);
        }
        let eps = if self.config.smoothing {
            self.model.switching.epsilon()
        } else {
            // Uden udglatning: hvert segment for sig.
            1.0 - 1.0 / k as f64
        };
        let smoothed = crate::smooth::smooth(&steps, k, eps);
        // Eget bevis: kaskaden eller Naive Bayes peger selv på udglatningens
        // kunde. Udglatningen må kun udfylde korte stræk uden eget bevis (som
        // A→B→A); et langt stræk uden bevis (en pause, en frokost på nettet)
        // forbliver uklart.
        let evidence: Vec<bool> = rows
            .iter()
            .enumerate()
            .map(|(r, &i)| {
                let state = smoothed.path[r];
                if state == other || anchors[r] {
                    return true;
                }
                let client = &states[state];
                let by_cascade = matches!(&cascade[i], SegmentMatch::Match(c)
                    if c.target.client_id.as_deref() == Some(client.as_str())
                        && c.confidence >= self.config.unclear_below);
                let by_nb = preds[i].as_ref().is_some_and(|p| p.prob(client) >= 0.5);
                by_cascade || by_nb
            })
            .collect();
        let mut unsupported = vec![false; rows.len()];
        let mut r = 0;
        while r < rows.len() {
            if evidence[r] {
                r += 1;
                continue;
            }
            let start = r;
            while r < rows.len() && !evidence[r] && (r == start || !steps[r].break_before) {
                r += 1;
            }
            let span = segments[rows[r - 1]].end - segments[rows[start]].start;
            if span > self.config.max_interruption_secs {
                for u in &mut unsupported[start..r] {
                    *u = true;
                }
            }
        }
        let mut out = cascade.clone();
        let mut raw = vec![None; segments.len()];
        for (r, &i) in rows.iter().enumerate() {
            let state = smoothed.path[r];
            let marginal = smoothed.marginal[r][state] as f32;
            if unsupported[r] {
                out[i] = SegmentMatch::Unknown;
                continue;
            }
            if anchors[r] {
                // Brugerens udsagn står uændret.
                continue;
            }
            raw[i] = Some(marginal);
            let conf = self.model.platt.apply(marginal);
            if state == other {
                // "Anden": kaskadens eget bud står, hvis det er sikkert nok.
                out[i] = match &cascade[i] {
                    SegmentMatch::Match(c) if c.confidence >= self.config.unclear_below => cascade[i].clone(),
                    _ => SegmentMatch::Unknown,
                };
                continue;
            }
            let client = &states[state];
            out[i] = SegmentMatch::Match(match &cascade[i] {
                // Enig med kaskaden: aldrig svagere end kaskadens egen
                // (kalibrerede) konfidens.
                SegmentMatch::Match(c) if c.target.client_id.as_deref() == Some(client) => Candidate {
                    confidence: conf.max(c.confidence),
                    ..c.clone()
                },
                _ => {
                    let reason = match &preds[i] {
                        Some(p) if !p.because.is_empty() => format!(
                            "Foreslået fordi {}",
                            join_danish(&p.because.iter().map(|(l, _)| l.clone()).collect::<Vec<_>>())
                        ),
                        _ => "Foreslået ud fra resten af tidsrummet".to_string(),
                    };
                    let project = self.model_project(&segments[i], client);
                    Candidate {
                        target: Target {
                            client_id: Some(client.clone()),
                            project_id: project,
                        },
                        confidence: conf,
                        source: Source {
                            layer: Layer::Model,
                            signal: Signal::Mixed,
                        },
                        reason,
                    }
                }
            });
        }
        (out, raw)
    }

    /// Projektet inden for kunden efter projektmodellen (kun et klart bud).
    fn model_project(&self, seg: &ActivitySegment, client: &str) -> Option<String> {
        let p = self.model.projects.get(client)?.predict(seg)?;
        let (best, prob) = p.best()?;
        (prob >= 0.6 && !best.is_empty() && best != NO_PROJECT)
            .then(|| best.to_string())
            .filter(|pid| self.catalog.project(pid).is_some_and(|p| !p.archived))
    }

    /// Lærer Naive Bayes og skiftene af segmenter med et kendt svar.
    fn learn_model(&mut self, segs: &[&ActivitySegment], truth: Option<&Target>, weight: f32) {
        if self.config.naive_bayes == ModelMode::Off {
            return;
        }
        let class = truth
            .and_then(|t| t.client_id.clone())
            .unwrap_or_default();
        for seg in segs {
            self.model.nb.observe_title(seg);
            self.model.nb.learn(seg, &class, weight);
            if let Some(t) = truth
                && let Some(client) = &t.client_id
            {
                let project = t.project_id.clone().unwrap_or_else(|| NO_PROJECT.to_string());
                self.model
                    .projects
                    .entry(client.clone())
                    .or_default()
                    .learn(seg, &project, weight);
            }
        }
        // En blok er ét stykke: n-1 naboer uden skifte og et skifte ud af den.
        if !segs.is_empty() {
            self.model.switching.pairs += segs.len() as f32;
            self.model.switching.switches += 1.0;
        }
    }

    /// Lærer af brugerens egne poster med tidspunkt (timer, manuelle poster):
    /// aktiviteten inden for en post hører til postens mål. Vejer mindre end
    /// en bekræftelse, for en timer kan køre, mens man laver andet.
    pub fn learn_logged(&mut self, segments: &[ActivitySegment], entries: &[(i64, i64, Target)]) {
        let mut sorted: Vec<&ActivitySegment> = segments.iter().collect();
        sorted.sort_by_key(|s| s.start);
        let mut labels: Vec<Option<&str>> = Vec::new();
        for seg in &sorted {
            let mid = (seg.start + seg.end) / 2;
            let entry = entries.iter().find(|(a, b, _)| (*a..*b).contains(&mid));
            labels.push(entry.and_then(|(_, _, t)| t.client_id.as_deref()));
            // Kun poster for kunder i kataloget (ikke arkiverede eller slettede).
            if let Some((_, _, t)) = entry
                && self.config.naive_bayes != ModelMode::Off
                && let Some(t) = self.catalog.resolve(t)
            {
                self.learn_model(&[*seg], Some(&t), WEIGHT_LOGGED);
                // `learn_model` tæller hvert segment som en blok; her kendes
                // rækkefølgen, så skiftene tælles nedenfor i stedet.
                self.model.switching.switches -= 1.0;
                self.model.switching.pairs -= 1.0;
            }
        }
        self.model.switching.observe(&labels);
        self.model.nb.fit_temperature();
    }

    /// Holder segmenternes bud og blokkens konfidens op mod brugerens svar
    /// (`truth` = det, brugeren valgte; `None` = ikke arbejde).
    fn observe_feedback(
        &mut self,
        segments: &[ActivitySegment],
        suggestion: &Suggestion,
        truth: Option<&Target>,
    ) {
        let segs = pick(segments, suggestion);
        let total: i64 = segs.iter().map(|s| s.duration()).sum::<i64>().max(1);
        // Pr. bud (lag, signal, mål): andelen af blokken.
        let mut shares: Vec<(Candidate, f32)> = Vec::new();
        for seg in &segs {
            if let SegmentMatch::Match(c) = self.match_segment(seg) {
                let w = seg.duration() as f32 / total as f32;
                match shares
                    .iter_mut()
                    .find(|(o, _)| o.source == c.source && o.target == c.target)
                {
                    Some((_, s)) => *s += w,
                    None => shares.push((c, w)),
                }
            }
        }
        for (c, w) in &shares {
            self.model.calibration.observe(c, truth, w.min(1.0));
        }
        // Modellens marginaler for blokken holdes op mod svaret (Platt), før
        // modellen lærer af det.
        if self.config.naive_bayes != ModelMode::Off {
            // Kun blokkens segmenter: det er dem, svaret siger noget om, og det
            // holder en bekræftelse billig på en lang dag.
            let block: Vec<ActivitySegment> = segs.iter().map(|s| (*s).clone()).collect();
            let (mm, raw) = self.model_matches_raw(&block, true);
            let segments = &block;
            let suggestion = &Suggestion {
                segment_indices: (0..block.len()).collect(),
                ..suggestion.clone()
            };
            // Skyggemålingen: kaskadens og modellens bud på hvert segment.
            if let Some(t) = truth.and_then(|t| t.client_id.as_deref()) {
                for &i in &suggestion.segment_indices {
                    let Some(seg) = segments.get(i) else { continue };
                    let d = seg.duration() as f64;
                    let says = |m: &SegmentMatch| match m {
                        SegmentMatch::Match(c) if c.confidence >= self.config.unclear_below => {
                            c.target.client_id.clone()
                        }
                        _ => None,
                    };
                    let st = &mut self.model.shadow;
                    st.secs += d;
                    match says(&self.match_segment(seg)).as_deref() {
                        Some(c) if c == t => self.model.shadow.cascade_right += d,
                        Some(_) => self.model.shadow.cascade_wrong += d,
                        None => {}
                    }
                    match mm.get(i).and_then(says).as_deref() {
                        Some(c) if c == t => self.model.shadow.model_right += d,
                        Some(_) => self.model.shadow.model_wrong += d,
                        None => {}
                    }
                }
            }
            for &i in &suggestion.segment_indices {
                let (Some(SegmentMatch::Match(c)), Some(Some(m)), Some(seg)) =
                    (mm.get(i), raw.get(i), segments.get(i))
                else {
                    continue;
                };
                let correct = truth.is_some_and(|t| t.client_id.is_some() && t.client_id == c.target.client_id);
                let w = seg.duration() as f32 / total as f32;
                self.model.platt.observe(*m, correct, w);
            }
            self.model.platt.fit();
        }
        let weight = match (&suggestion.target, truth) {
            (Some(t), Some(u)) if t == u => WEIGHT_CONFIRM,
            _ => WEIGHT_CORRECT,
        };
        self.learn_model(&segs, truth, weight);
        self.model.nb.fit_temperature();
        if let Some(t) = suggestion.target.as_ref().or(suggestion.held_back.as_ref()) {
            let correct = truth.is_some_and(|u| u.client_id == t.client_id && u.compatible(t));
            self.model.record_block(BlockOutcome {
                confidence: suggestion.confidence,
                secs: suggestion.duration(),
                correct,
            });
        }
    }

    /// Segmenterne i blokken, der må læres af. Indlagte afbrydelser, der selv
    /// pegede på en anden kunde end blokkens forslag (fem minutter hos B i en
    /// time hos A), er ikke en del af det, brugeren tog stilling til.
    fn learnable<'a>(
        &self,
        segments: &'a [ActivitySegment],
        suggestion: &Suggestion,
    ) -> Vec<&'a ActivitySegment> {
        let Some(block) = &suggestion.target else {
            return pick(segments, suggestion);
        };
        pick(segments, suggestion)
            .into_iter()
            .filter(|seg| match self.match_segment(seg) {
                SegmentMatch::Match(c) => {
                    c.confidence < self.config.unclear_below || c.target.compatible(block)
                }
                _ => true,
            })
            .collect()
    }

    /// Brugeren bekræftede forslaget.
    pub fn confirm(&mut self, segments: &[ActivitySegment], suggestion: &Suggestion) {
        if let Some(target) = suggestion.target.clone() {
            self.observe_feedback(segments, suggestion, Some(&target));
            let segs = self.learnable(segments, suggestion);
            self.patterns.learn(&segs, &target, &Feedback::Confirm);
        }
    }

    /// Brugeren rettede forslaget til `target`.
    pub fn correct(
        &mut self,
        segments: &[ActivitySegment],
        suggestion: &Suggestion,
        target: &Target,
    ) {
        let Some(target) = self.catalog.resolve(target) else {
            return;
        };
        self.observe_feedback(segments, suggestion, Some(&target));
        let segs = self.learnable(segments, suggestion);
        self.patterns.learn(
            &segs,
            &target,
            &Feedback::Correct {
                from: suggestion.target.clone(),
            },
        );
    }

    /// Brugeren afviste forslaget uden at angive noget andet.
    pub fn reject(&mut self, segments: &[ActivitySegment], suggestion: &Suggestion) {
        if let Some(target) = suggestion.target.clone() {
            self.observe_feedback(segments, suggestion, None);
            let segs = self.learnable(segments, suggestion);
            self.patterns.learn(&segs, &target, &Feedback::Reject);
        }
    }
}

fn pick<'a>(segments: &'a [ActivitySegment], suggestion: &Suggestion) -> Vec<&'a ActivitySegment> {
    suggestion
        .segment_indices
        .iter()
        .filter_map(|&i| segments.get(i))
        .collect()
}

fn lowercase_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Vælger kunde/projekt af navnematches. `None`, hvis intet når 0.5, eller
/// hvis to forskellige kunder (eller to projekter hos forskellige kunder) står
/// lige stærkt.
fn pick_name_target(
    all: &[(NameMatch, Signal)],
    catalog: &Catalog,
) -> Option<(Target, f32, String, Signal)> {
    const TIE: f32 = 0.05;
    let best_of = |kind: MatchType| {
        let mut v: Vec<&(NameMatch, Signal)> = all.iter().filter(|(m, _)| m.kind == kind).collect();
        v.sort_by(|a, b| b.0.confidence.total_cmp(&a.0.confidence));
        v
    };
    let clients = best_of(MatchType::Client);
    let projects = best_of(MatchType::Project);
    let client_of = |pid: &str| catalog.project(pid).and_then(|p| p.client_id.clone());

    let client = clients
        .first()
        .filter(|(m, _)| m.confidence >= 0.5)
        .filter(|(m, _)| {
            !clients
                .iter()
                .any(|(o, _)| o.id != m.id && m.confidence - o.confidence < TIE)
        });
    let project = projects
        .first()
        .filter(|(m, _)| m.confidence >= 0.5)
        .and_then(|best| {
            let rivals: Vec<_> = projects
                .iter()
                .filter(|(o, _)| o.id != best.0.id && best.0.confidence - o.confidence < TIE)
                .collect();
            if rivals.is_empty() {
                return Some(Ok(*best));
            }
            // Projekter hos samme kunde står lige: så ved vi kunden, ikke projektet.
            let c = client_of(&best.0.id);
            if c.is_some() && rivals.iter().all(|(o, _)| client_of(&o.id) == c) {
                Some(Err(c))
            } else {
                None
            }
        });

    match (client, project) {
        (_, Some(Ok((p, sig)))) => {
            let pc = client_of(&p.id);
            match client {
                // Et projekt hos en anden kunde end den stærkere kunde: stol på kunden.
                Some((c, csig))
                    if pc.as_deref() != Some(c.id.as_str()) && c.confidence > p.confidence =>
                {
                    Some((Target::client(&c.id), c.confidence, c.reason.clone(), *csig))
                }
                _ => Some((
                    Target {
                        client_id: pc,
                        project_id: Some(p.id.clone()),
                    },
                    p.confidence,
                    p.reason.clone(),
                    *sig,
                )),
            }
        }
        (Some((c, sig)), _) => Some((Target::client(&c.id), c.confidence, c.reason.clone(), *sig)),
        (None, Some(Err(Some(cid)))) => {
            let (p, sig) = projects[0];
            let name = catalog
                .client(&cid)
                .map(|c| c.name.clone())
                .unwrap_or_default();
            Some((
                Target::client(&cid),
                p.confidence,
                format!("Flere projekter hos {name} passer"),
                *sig,
            ))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Client, IdentityBinding, Project, SiteMapping};

    fn catalog() -> Catalog {
        Catalog {
            clients: vec![
                Client {
                    id: "c-bag".into(),
                    name: "Bageriet på hjørnet".into(),
                    ..Default::default()
                },
                Client {
                    id: "c-fri".into(),
                    name: "Frisør Hansen".into(),
                    ..Default::default()
                },
                Client {
                    id: "c-ark".into(),
                    name: "Ark".into(),
                    domains: vec!["ark-tegnestue.dk".into()],
                    ..Default::default()
                },
            ],
            projects: vec![
                Project {
                    id: "p-bag-web".into(),
                    name: "Website".into(),
                    client_id: Some("c-bag".into()),
                    url_patterns: vec!["https://bageriet.myshopify.com/admin*".into()],
                    ..Default::default()
                },
                Project {
                    id: "p-fri-web".into(),
                    name: "Website".into(),
                    client_id: Some("c-fri".into()),
                    ..Default::default()
                },
                Project {
                    id: "p-gammel".into(),
                    name: "Gammelt".into(),
                    client_id: Some("c-fri".into()),
                    archived: true,
                    ..Default::default()
                },
            ],
            rules: vec![
                Rule {
                    id: "r1".into(),
                    field: RuleField::Domain,
                    op: RuleOp::Contains,
                    value: "facebook.com".into(),
                    target: None,
                    priority: 10,
                    active: true,
                },
                Rule {
                    id: "r2".into(),
                    field: RuleField::Title,
                    op: RuleOp::Contains,
                    value: "Årsrapport".into(),
                    target: Some(Target::client("c-fri")),
                    priority: 0,
                    active: true,
                },
            ],
            identities: vec![
                IdentityBinding {
                    kind: IdentityKind::RepoRemote,
                    value: "git@github.com:acme/website.git".into(),
                    app: None,
                    target: Some(Target::project(None, "p-fri-web")),
                },
                IdentityBinding {
                    kind: IdentityKind::Path,
                    value: "/Users/mads/dev/kunder/bageriet".into(),
                    app: None,
                    target: Some(Target::client("c-bag")),
                },
            ],
            site_mappings: vec![SiteMapping {
                domain: "frisor-booking.dk".into(),
                client_id: Some("c-fri".into()),
                project_id: None,
                usage_count: 3,
            }],
        }
    }

    fn browser(title: &str, url: &str) -> ActivitySegment {
        ActivitySegment {
            app: "Google Chrome".into(),
            title: title.into(),
            url: Some(url.into()),
            start: 0,
            end: 600,
            ..Default::default()
        }
    }

    fn hit(m: SegmentMatch) -> Candidate {
        match m {
            SegmentMatch::Match(c) => c,
            other => panic!("forventede et træf, fik {other:?}"),
        }
    }

    #[test]
    fn rules_win_and_can_ignore() {
        let m = Matcher::new(catalog(), PatternStore::new());
        assert!(matches!(
            m.match_segment(&browser(
                "Bageriet på hjørnet",
                "https://www.facebook.com/bageriet"
            )),
            SegmentMatch::Ignore { .. }
        ));
        let c = hit(m.match_segment(&ActivitySegment {
            app: "Word".into(),
            title: "Aarsrapport 2026.docx - Word".into(),
            ..Default::default()
        }));
        assert_eq!(c.target, Target::client("c-fri"));
        assert_eq!(c.source.layer, Layer::Rule);
        assert!(c.reason.starts_with("Din regel"), "{}", c.reason);
    }

    #[test]
    fn url_patterns_like_web() {
        let m = Matcher::new(catalog(), PatternStore::new());
        let c = hit(m.match_segment(&browser(
            "Ordrer",
            "https://bageriet.myshopify.com/admin/orders/12",
        )));
        assert_eq!(c.target, Target::project(Some("c-bag"), "p-bag-web"));
        assert_eq!(
            c.source,
            Source {
                layer: Layer::Rule,
                signal: Signal::Url
            }
        );
    }

    #[test]
    fn identity_repo_beats_name_and_path() {
        let m = Matcher::new(catalog(), PatternStore::new());
        let seg = ActivitySegment {
            app: "Code".into(),
            title: "index.tsx - website - Visual Studio Code".into(),
            repo_remote: Some("https://github.com/acme/website".into()),
            path: Some("/Users/mads/dev/kunder/bageriet/website".into()),
            ..Default::default()
        };
        let c = hit(m.match_segment(&seg));
        assert_eq!(c.target, Target::project(Some("c-fri"), "p-fri-web"));
        assert_eq!(c.source.signal, Signal::Repo);
    }

    #[test]
    fn two_website_repos_without_identity_are_not_guessed() {
        let m = Matcher::new(catalog(), PatternStore::new());
        let seg = ActivitySegment {
            app: "Code".into(),
            title: "index.tsx - website".into(),
            repo_remote: Some("git@github.com:someone/website.git".into()),
            ..Default::default()
        };
        assert_eq!(m.match_segment(&seg), SegmentMatch::Unknown);
    }

    #[test]
    fn client_from_path_gets_project_from_repo_name_match() {
        let m = Matcher::new(catalog(), PatternStore::new());
        let seg = ActivitySegment {
            app: "Code".into(),
            title: "index.tsx - website".into(),
            repo_remote: Some("git@github.com:bageriet-paa-hjoernet/website.git".into()),
            path: Some("/Users/mads/dev/kunder/bageriet/website".into()),
            ..Default::default()
        };
        let c = hit(m.match_segment(&seg));
        assert_eq!(c.target, Target::project(Some("c-bag"), "p-bag-web"));
        assert_eq!(c.source.layer, Layer::Identity);
        assert!(c.reason.contains("projektet"), "{}", c.reason);
    }

    #[test]
    fn site_mappings_and_client_domains() {
        let m = Matcher::new(catalog(), PatternStore::new());
        let c = hit(m.match_segment(&browser("Book tid", "https://admin.frisor-booking.dk/x")));
        assert_eq!(c.target, Target::client("c-fri"));
        assert!(c.confidence > 0.85);
        let c = hit(m.match_segment(&browser("Forside", "https://www.ark-tegnestue.dk/")));
        assert_eq!(c.target, Target::client("c-ark"));
        assert_eq!(c.source.layer, Layer::Identity);
    }

    #[test]
    fn names_are_last_and_capped() {
        let m = Matcher::new(catalog(), PatternStore::new());
        let c = hit(m.match_segment(&browser(
            "Tilbud til Bageriet på hjørnet - Gmail",
            "https://mail.google.com/x",
        )));
        assert_eq!(c.target.client_id.as_deref(), Some("c-bag"));
        assert_eq!(c.source.layer, Layer::Name);
        assert!(c.confidence <= confidence::NAME_MAX);
        // Kort kundenavn inde i et længere ord matcher ikke.
        assert_eq!(
            m.match_segment(&browser(
                "Markdown arkitektur",
                "https://markdownguide.org/"
            )),
            SegmentMatch::Unknown
        );
    }

    #[test]
    fn archived_projects_are_never_suggested() {
        let m = Matcher::new(catalog(), PatternStore::new());
        let r = m.match_segment(&browser("Gammelt projekt", "https://x.dk/gammelt"));
        if let SegmentMatch::Match(c) = r {
            assert_ne!(c.target.project_id.as_deref(), Some("p-gammel"));
        }
    }

    #[test]
    fn strong_corrections_override_identity() {
        let mut m = Matcher::new(catalog(), PatternStore::new());
        let seg = browser("Forside", "https://www.ark-tegnestue.dk/");
        let segs = vec![seg.clone()];
        for _ in 0..2 {
            let s = m.suggest(&segs);
            let wrong = s[0].clone();
            m.correct(&segs, &wrong, &Target::client("c-bag"));
        }
        let c = hit(m.match_segment(&seg));
        assert_eq!(c.target, Target::client("c-bag"));
        assert_eq!(c.source.layer, Layer::Pattern);
        assert!(c.reason.contains("rettet 2 gange"), "{}", c.reason);
    }

    #[test]
    fn rule_values_are_normalized_like_signals() {
        let seg = browser("x", "https://www.bageriet.dk/");
        let code = ActivitySegment {
            app: "Code".into(),
            ..Default::default()
        };
        let r = |field, op, value: &str| Rule {
            id: String::new(),
            field,
            op,
            value: value.into(),
            target: None,
            priority: 0,
            active: true,
        };
        assert!(rule_matches(
            &r(RuleField::App, RuleOp::Contains, "Code.exe"),
            &code
        ));
        assert!(rule_matches(
            &r(RuleField::Domain, RuleOp::Contains, "www.bageriet.dk"),
            &seg
        ));
        assert!(rule_matches(
            &r(RuleField::Domain, RuleOp::StartsWith, "www.bageriet"),
            &seg
        ));
    }

    #[test]
    fn interruptions_of_another_client_are_not_learned() {
        let mut m = Matcher::new(catalog(), PatternStore::new());
        let segs = vec![
            ActivitySegment {
                start: 0,
                end: 600,
                ..browser("Forside", "https://www.ark-tegnestue.dk/")
            },
            // 5 min hos Frisøren (site-kobling) midt i 25 min hos Ark: 20 % af blokken.
            ActivitySegment {
                start: 600,
                end: 900,
                ..browser("Kalender", "https://frisor-booking.dk/")
            },
            ActivitySegment {
                start: 900,
                end: 1500,
                ..browser("Kontakt", "https://www.ark-tegnestue.dk/k")
            },
        ];
        let s = m.suggest(&segs);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].absorbed_interruptions, 1);
        m.confirm(&segs, &s[0]);
        let domains: Vec<_> = m
            .patterns
            .patterns
            .iter()
            .filter_map(|p| match &p.key {
                crate::PatternKey::Domain { domain } => Some(domain.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(domains, ["ark-tegnestue.dk"]);
    }

    #[test]
    fn multi_project_apps() {
        assert!(is_multi_project_app("Google Chrome"));
        assert!(is_multi_project_app("Code.exe"));
        assert!(!is_multi_project_app("Spotify"));
        assert!(!is_multi_project_app("Codex Helper"));
    }

    #[test]
    fn rule_ops() {
        let seg = ActivitySegment {
            app: "Code".into(),
            title: "Møde om gårdbutik".into(),
            url: Some("https://x.dk/a".into()),
            path: Some("C:\\Projects\\Kunde\\src".into()),
            ..Default::default()
        };
        let r = |field, op, value: &str| Rule {
            id: String::new(),
            field,
            op,
            value: value.into(),
            target: None,
            priority: 0,
            active: true,
        };
        assert!(rule_matches(
            &r(RuleField::Title, RuleOp::Contains, "gaardbutik"),
            &seg
        ));
        assert!(rule_matches(
            &r(RuleField::App, RuleOp::Equals, "CODE"),
            &seg
        ));
        assert!(rule_matches(
            &r(RuleField::Path, RuleOp::StartsWith, "c:/projects/kunde"),
            &seg
        ));
        assert!(!rule_matches(
            &r(RuleField::Path, RuleOp::StartsWith, "c:/projects/ku"),
            &seg
        ));
        assert!(rule_matches(
            &r(RuleField::Url, RuleOp::Glob, "https://x.dk/*"),
            &seg
        ));
        assert!(!rule_matches(
            &r(RuleField::Repo, RuleOp::Contains, "x"),
            &seg
        ));
        assert!(!rule_matches(
            &r(RuleField::Title, RuleOp::Contains, "  "),
            &seg
        ));
    }

    /// Brugerens regel står, også når modellen er slået til og trækker mod
    /// naboernes kunde, og også når reglens mål kun er et projekt.
    #[test]
    fn the_model_never_moves_a_rule() {
        let catalog = Catalog {
            clients: vec![
                Client { id: "a".into(), name: "Alfa".into(), ..Default::default() },
                Client { id: "b".into(), name: "Beta".into(), ..Default::default() },
            ],
            projects: vec![Project { id: "intern".into(), name: "Intern".into(), ..Default::default() }],
            rules: vec![
                Rule {
                    id: "r1".into(),
                    field: RuleField::Domain,
                    op: RuleOp::Equals,
                    value: "alfa-regel.example".into(),
                    target: Some(Target::client("a")),
                    priority: 1,
                    active: true,
                },
                Rule {
                    id: "r2".into(),
                    field: RuleField::Domain,
                    op: RuleOp::Equals,
                    value: "intern.example".into(),
                    target: Some(Target::project(None, "intern")),
                    priority: 1,
                    active: true,
                },
            ],
            ..Default::default()
        };
        let mut m = Matcher::new(catalog, PatternStore::new()).with_config(MatchConfig {
            naive_bayes: ModelMode::On,
            ..MatchConfig::default()
        });
        let web = |host: &str, from: i64, to: i64| ActivitySegment {
            app: "vivaldi".into(),
            title: "Side".into(),
            url: Some(format!("https://{host}/")),
            start: from,
            end: to,
            ..Default::default()
        };
        // Modellen har lært, at vivaldi om formiddagen er Beta.
        for day in 0..5 {
            let t = day * 86_400 + 9 * 3600;
            let segs = vec![web("beta.example", t, t + 3600)];
            m.learn_logged(&segs, &[(t, t + 3600, Target::client("b"))]);
        }
        let t = 10 * 86_400 + 9 * 3600;
        let day = vec![
            web("beta.example", t, t + 600),
            web("alfa-regel.example", t + 600, t + 1200),
            web("beta.example", t + 1200, t + 1800),
            web("intern.example", t + 1800, t + 2400),
            web("beta.example", t + 2400, t + 3000),
        ];
        let blocks = m.suggest(&day);
        let target_of = |i: usize| {
            blocks
                .iter()
                .find(|b| b.segment_indices.contains(&i))
                .and_then(|b| b.target.clone())
        };
        assert_eq!(target_of(1), Some(Target::client("a")), "{blocks:#?}");
        assert_eq!(target_of(3), Some(Target::project(None, "intern")), "{blocks:#?}");
    }
}
