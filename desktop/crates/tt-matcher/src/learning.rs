//! Lærte mønstre.
//!
//! Bekræftelser og rettelser bliver til GENERALISEREDE nøgler, aldrig hele
//! titler: repo-remote, mappe, domæne, app+nøgleord (dokumentnavn som
//! skabelon) og titel-skabelon (titlens faste del med tal, id'er og
//! mailadresser fjernet). Hver nøgle samler stemmer pr. mål; konfidensen
//! vokser med støtten og falder, når stemmerne modsiger hinanden.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::normalize::{
    clean_title, domain_matches, is_generic_title, normalize_app, normalize_path,
    normalize_repo_remote, path_components, path_is_within, segment_host, template_of,
    title_segments,
};
use crate::types::{ActivitySegment, Signal, Target};

/// En generaliseret nøgle. Indeholder aldrig en rå titel.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PatternKey {
    /// Kanonisk repo-remote (`github.com/acme/timetrack`).
    Repo { remote: String },
    /// Kanonisk mappe. Matcher mappen og alt under den.
    Path { path: String },
    /// Domæne. På delte værter (github.com …) med de to første sti-dele.
    Domain { domain: String },
    /// Program + dokumentnavn som skabelon.
    AppKeyword { app: String, keyword: String },
    /// Programfamilie + titlens faste del som skabelon.
    TitleTemplate { app: String, template: String },
}

impl PatternKey {
    /// Signalet bag nøglen.
    pub fn signal(&self) -> Signal {
        match self {
            PatternKey::Repo { .. } => Signal::Repo,
            PatternKey::Path { .. } => Signal::Path,
            PatternKey::Domain { .. } => Signal::Domain,
            PatternKey::AppKeyword { .. } => Signal::Document,
            PatternKey::TitleTemplate { .. } => Signal::Title,
        }
    }

    /// Styrkeorden (lavest = stærkest), samme som identitet.
    fn rank(&self) -> u8 {
        match self {
            PatternKey::Repo { .. } => 0,
            PatternKey::Path { .. } => 1,
            PatternKey::Domain { .. } => 2,
            PatternKey::AppKeyword { .. } => 3,
            PatternKey::TitleTemplate { .. } => 4,
        }
    }

    /// Hvor specifik nøglen er inden for sin slags (mapper og domæner nedarves).
    /// Et repo-navn (`*/navn`) er kort og taber derfor til en lært sti eller
    /// kundemappe: to kunder kan begge have et repo, der hedder `website`.
    fn specificity(&self) -> usize {
        match self {
            PatternKey::Path { path } => path.len(),
            PatternKey::Domain { domain } => domain.len(),
            _ => 0,
        }
    }

    /// Loft over konfidensen for nøglens slags.
    fn ceiling(&self) -> f32 {
        match self {
            PatternKey::Repo { .. } | PatternKey::Path { .. } => 0.95,
            PatternKey::Domain { .. } => 0.94,
            PatternKey::AppKeyword { .. } => 0.93,
            PatternKey::TitleTemplate { .. } => 0.92,
        }
    }

    /// Dansk beskrivelse til begrundelser: `domænet bageriet.dk`.
    pub fn describe(&self) -> String {
        match self {
            PatternKey::Repo { remote } => format!("repoet {remote}"),
            PatternKey::Path { path } => format!("mappen {path}"),
            PatternKey::Domain { domain } => format!("domænet {domain}"),
            PatternKey::AppKeyword { app, keyword } => format!("\"{keyword}\" i {app}"),
            PatternKey::TitleTemplate { app, template } => {
                format!("titler som \"{template}\" i {app}")
            }
        }
    }

    /// Matcher nøglen et segments egne nøgler?
    fn hits(&self, own: &[PatternKey]) -> bool {
        own.iter().any(|k| match (self, k) {
            (PatternKey::Path { path: learned }, PatternKey::Path { path }) => {
                path_is_within(path, learned) || repo_name_hits(learned, path)
            }
            (PatternKey::Domain { domain: learned }, PatternKey::Domain { domain }) => {
                domain_matches(domain, learned)
            }
            _ => self == k,
        })
    }
}

/// Én stemme: et mål og dets vægt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vote {
    pub target: Target,
    pub weight: f32,
    #[serde(default)]
    pub confirmations: u32,
    #[serde(default)]
    pub corrections: u32,
    #[serde(default)]
    pub ai_answers: u32,
}

/// Et lært mønster: en nøgle og stemmerne på den.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnedPattern {
    pub key: PatternKey,
    pub votes: Vec<Vote>,
}

/// Hvad brugeren (eller AI'en) sagde om en blok.
#[derive(Debug, Clone, PartialEq)]
pub enum Feedback {
    /// Forslaget var rigtigt.
    Confirm,
    /// Forslaget var forkert; `from` er det, der blev foreslået.
    Correct { from: Option<Target> },
    /// Forslaget var forkert, og brugeren angav ikke noget andet (Afvis).
    Reject,
    /// Svar fra en [`crate::Classifier`]. Vejer mindre end et menneske.
    Ai,
}

const WEIGHT_CONFIRM: f32 = 1.0;
const WEIGHT_CORRECT: f32 = 1.5;
const WEIGHT_AI: f32 = 0.5;
/// En rettelse halverer det forkerte måls vægt på nøglen.
const PENALTY_FACTOR: f32 = 0.5;
/// En nøgle skal dække så stor en del af blokken for at få fuld vægt.
const FULL_SHARE: f32 = 0.25;
/// Nøgler under denne andel af blokken læres slet ikke (korte afstikkere:
/// 4 min nyheder i en blok på en time bliver ikke et mønster).
const MIN_SHARE: f32 = 0.15;
/// Mindste samlede vægt bag vinderen. Ét AI-svar (0,5) er lige nok.
const MIN_SUPPORT: f32 = 0.5;
/// Mindste renhed (andel af vægten bag vinderen) for at foreslå noget.
const MIN_PURITY: f32 = 0.6;
/// Mindste konfidens for at foreslå noget.
const MIN_CONFIDENCE: f32 = 0.55;

/// Et træf i mønstrene.
#[derive(Debug, Clone, PartialEq)]
pub struct PatternHit {
    pub key: PatternKey,
    pub target: Target,
    pub confidence: f32,
    pub confirmations: u32,
    pub corrections: u32,
    pub ai_answers: u32,
    /// Vinderen er rettet til mindst to gange og er næsten enstemmig. Et
    /// stærkt mønster må gå foran identitet og site-koblinger, for brugeren
    /// har gentagne gange sagt, at de tog fejl.
    pub strong: bool,
}

/// Alle lærte mønstre. Serialiseres som en liste, så den kan gemmes i
/// SQLite og synkroniseres til web.
///
/// Web gemmer mønstrene i `extension.patterns.list({ since? })` /
/// `extension.patterns.upsert({ patterns })` med `LearnedPattern` som JSON
/// præcis som denne type (tt-data: `Repository::learned_patterns`). Serveren
/// gemmer det sidst sendte pr. nøgle og fletter ikke.
///
/// Bemærk: [`PatternStore::merge`] lægger stemmer sammen, så at flette web's
/// liste ind igen og igen tæller dobbelt. Synkroniseringen i tt-app
/// (`engine/pattern_sync.rs`) bruger den derfor ikke: den fører web's værdi
/// og enhedens egne ændringer hver for sig og sender web's værdi + eget delta.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternStore {
    pub patterns: Vec<LearnedPattern>,
}

/// Værter, der rummer mange kunders arbejde. Deres domæne alene lærer ingenting.
const SHARED_HOSTS: &[&str] = &[
    "google.com",
    "google.dk",
    "bing.com",
    "duckduckgo.com",
    "localhost",
    "127.0.0.1",
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "youtube.com",
    "facebook.com",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "stackoverflow.com",
    "developer.mozilla.org",
    "docs.google.com",
    "drive.google.com",
    "mail.google.com",
    "calendar.google.com",
    "outlook.office.com",
    "outlook.live.com",
    "app.slack.com",
    "teams.microsoft.com",
    "figma.com",
    "notion.so",
    "dropbox.com",
    "web.whatsapp.com",
    "messenger.com",
    "wikipedia.org",
    "reddit.com",
];

/// Kodeværter, hvor ejer/repo i stien er det, der identificerer arbejdet.
const CODE_HOSTS: &[&str] = &[
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "codeberg.org",
    "dev.azure.com",
    // Shopify-admin for mange butikker: `admin.shopify.com/store/<butik>`.
    "admin.shopify.com",
];

fn is_shared_host(host: &str) -> bool {
    SHARED_HOSTS.iter().any(|h| domain_matches(host, h))
}

/// Browsere deler én nøglefamilie, så Chrome og Safari lærer af hinanden.
fn app_family(app: &str) -> String {
    const BROWSERS: &[&str] = &[
        "chrome", "safari", "firefox", "edge", "msedge", "brave", "arc", "opera", "vivaldi",
        "chromium",
    ];
    let app = normalize_app(app);
    if BROWSERS.iter().any(|b| app.contains(b)) {
        "browser".to_string()
    } else {
        app
    }
}

/// Domænenøgle for en URL eller et domæne.
fn domain_key(seg: &ActivitySegment) -> Option<String> {
    let host = segment_host(seg.domain.as_deref(), seg.url.as_deref())?;
    if CODE_HOSTS.contains(&host.as_str()) {
        let url = seg.url.as_deref()?;
        let after = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
        let path = after.split_once('/').map(|(_, p)| p).unwrap_or("");
        let parts: Vec<&str> = path
            .split(['?', '#'])
            .next()
            .unwrap_or("")
            .split('/')
            .filter(|p| !p.is_empty())
            .take(2)
            .collect();
        return (parts.len() == 2).then(|| format!("{host}/{}", parts.join("/").to_lowercase()));
    }
    (!is_shared_host(&host)).then_some(host)
}

/// Forstavelse for en repo-navn-nøgle: `*/hansen-vvs-web` matcher en mappe
/// med det navn, uanset hvor den ligger. Ældre versioner kender den ikke og
/// matcher den aldrig (ingen fejl ved synkronisering).
pub(crate) const REPO_NAME_PREFIX: &str = "*/";

/// Mapper, der samler mange kunders eller projekters mapper. Mappen lige
/// under er en kundemappe (`Freelance\hansen-vvs`) eller et repo
/// (`Egne\timetrack`).
const CONTAINERS: &[&str] = &[
    "freelance",
    "kunder",
    "clients",
    "customers",
    "egne",
    "projects",
    "projekter",
    "repos",
    "code",
    "dev",
    "work",
    "arbejde",
];

/// Mappen med worktrees: `worktrees\<repo>-<gren>`.
const WORKTREES: &[&str] = &["worktrees", "worktree", ".worktrees"];

/// Mappen (en fil erstattes af sin mappe) delt ved `/`. Første del er tom
/// for en absolut Unix-sti og drevet (`c:`) på Windows, så
/// `parts[..n].join("/")` er en forstavelse af den normaliserede mappe.
fn dir_parts(path: &str) -> Vec<String> {
    let norm = normalize_path(path);
    let (dir, last) = norm.rsplit_once('/').unwrap_or(("", &norm));
    let dir = if last.contains('.') && !last.starts_with('.') {
        dir.to_string()
    } else {
        norm.clone()
    };
    dir.split('/')
        .enumerate()
        .filter(|(i, p)| *i == 0 || !p.is_empty())
        .map(|(_, p)| p.to_string())
        .collect()
}

/// Ekstra mappenøgler ud over arbejdsmappen, så der læres på det niveau, der
/// går igen:
/// - **kundemappen** under en samlemappe (`…/freelance/hansen-vvs`), når
///   arbejdsmappen ligger dybere (et nyt repo i en kendt kundes mappe);
/// - **repoet** som `*/hansen-vvs/hansen-vvs-web` (kundemappe + repo, for to
///   kunder kan begge have et repo, der hedder `website`) eller `*/timetrack`
///   lige under en samlemappe (`…/egne/timetrack`);
/// - **worktrees** (`…/worktrees/hansen-vvs-web-fix-cache`): hver forstavelse
///   ved bindestreg (`*/hansen-vvs`, `*/hansen-vvs-web`, …), så grenen ikke
///   skal læres for sig. De matcher et lært repo med samme navn (se
///   [`PatternKey::hits`]); den længste forstavelse vinder.
fn path_extra_keys(path: &str) -> Vec<String> {
    let parts = dir_parts(path);
    let mut out = Vec::new();
    if let Some(w) = parts.iter().position(|p| WORKTREES.contains(&p.as_str()))
        && let Some(name) = parts.get(w + 1)
    {
        let pieces: Vec<&str> = name.split('-').collect();
        for n in 1..=pieces.len() {
            let prefix = pieces[..n].join("-");
            if is_distinct_repo_name(&prefix) {
                out.push(format!("{REPO_NAME_PREFIX}{prefix}"));
            }
        }
        return out;
    }
    // Den inderste samlemappe med mindst én mappe under sig.
    let Some(c) = parts
        .iter()
        .rposition(|p| CONTAINERS.contains(&p.as_str()))
        .filter(|&c| c + 1 < parts.len())
    else {
        return out;
    };
    let first = &parts[c + 1];
    if let Some(repo) = parts.get(c + 2) {
        // `…/freelance/<kunde>/<repo>…`: kundemappen og repoet.
        out.push(parts[..=c + 1].join("/"));
        out.push(format!("{REPO_NAME_PREFIX}{first}/{repo}"));
    } else if is_distinct_repo_name(first) {
        // `…/egne/<repo>`: repoet.
        out.push(format!("{REPO_NAME_PREFIX}{first}"));
    }
    out
}

/// Et repo-navn, der kan kendes igen på tværs af mapper: mindst 4 tegn og
/// ikke et generisk mappenavn (`web`, `api`, `scripts` …).
fn is_distinct_repo_name(name: &str) -> bool {
    const GENERIC: &[&str] = &[
        "main", "master", "develop", "web", "site", "website", "webshop", "shop", "app", "apps",
        "api", "backend", "frontend", "server", "client", "scripts", "script", "tools", "test",
        "tests", "docs", "temp", "tmp", "demo", "playground", "fix", "feat", "feature", "hotfix",
        "release", "wip", "dev", "src", "lib", "code",
    ];
    name.chars().count() >= 4 && !GENERIC.contains(&name)
}

/// En worktree-nøgle (`*/navn` uden kundemappe) matcher et lært repo med
/// samme navn, også `*/kunde/navn`.
fn repo_name_hits(learned: &str, own: &str) -> bool {
    let (Some(l), Some(o)) = (
        learned.strip_prefix(REPO_NAME_PREFIX),
        own.strip_prefix(REPO_NAME_PREFIX),
    ) else {
        return false;
    };
    l == o || (!o.contains('/') && l.rsplit_once('/').is_some_and(|(_, name)| name == o))
}

/// Mappenøgle: arbejdsmappen; en fil erstattes af sin mappe.
fn path_key(path: &str) -> Option<String> {
    let norm = normalize_path(path);
    let (dir, last) = norm.rsplit_once('/').unwrap_or(("", &norm));
    let is_file = last.contains('.') && !last.starts_with('.');
    let key = if is_file {
        dir.to_string()
    } else {
        norm.clone()
    };
    // En rodmappe, hjemmemappe eller ~/dev siger intet om arbejdet: der skal
    // være mindst én mappe, der ikke er generisk.
    (key.matches('/').count() >= 3 && !path_components(&key).is_empty()).then_some(key)
}

/// Tjenester, der skriver deres eget navn i titlen. Navnet siger intet om,
/// hvilken kunde arbejdet er for.
pub(crate) const SERVICE_NAMES: &[&str] = &[
    "gmail",
    "outlook",
    "slack",
    "canva",
    "google soegning",
    "google search",
    "google docs",
    "google sheets",
    "google drev",
    "google drive",
    "stack overflow",
    "youtube",
    "facebook",
    "linkedin",
    "github",
    "gitlab",
    "figma",
    "notion",
    "chatgpt",
    "claude",
    "trello",
    "asana",
    "jira",
    "confluence",
    "miro",
    "shopify",
    "wordpress",
    "messenger",
    "teams",
    "zoom",
    "dropbox",
    "excel",
    "word",
    "powerpoint",
    "cursor",
    "zed",
];

/// Titel-skabelon: titlens faste del. Titlen deles ved skilletegnene, og dele
/// der kun er variable (tal, mailadresser) eller generiske, droppes. Med flere
/// meningsfulde dele (`Side – Site`, `fil.rs – repo`, `Emne – Gmail`) er den
/// første den variable og droppes også, og tjenestenavne fjernes. Tilbage er
/// konteksten (`bageriet paa hjoernet`, `timetrack`) eller ingenting.
fn title_template(seg: &ActivitySegment) -> Option<String> {
    let cleaned = clean_title(&seg.app, &seg.title);
    let parts: Vec<String> = title_segments(&cleaned)
        .iter()
        .map(|p| template_of(p))
        .filter(|t| !is_generic_title(t))
        .collect();
    // En titel i ét stykke er selve emnet (en mail, et dokument): den er
    // variabel og kan rumme navne, så den læres ikke.
    if parts.len() < 2 {
        return None;
    }
    let stable: Vec<&String> = parts[1..].iter().collect();
    let stable: Vec<&str> = stable
        .into_iter()
        .map(String::as_str)
        .filter(|t| !SERVICE_NAMES.contains(t))
        .collect();
    let template = stable.join(" ");
    // En lang titel uden skilletegn er en emnelinje eller en sætning: den
    // gentager sig ikke og ville gemme for meget af titlen.
    if is_generic_title(&template) || template.split(' ').count() > 6 {
        return None;
    }
    Some(template)
}

/// Nøglerne for ét segment, stærkeste først.
pub fn keys_for(seg: &ActivitySegment) -> Vec<PatternKey> {
    let mut keys = Vec::new();
    if let Some(remote) = seg.repo_remote.as_deref().filter(|r| !r.trim().is_empty()) {
        keys.push(PatternKey::Repo {
            remote: normalize_repo_remote(remote),
        });
    }
    if let Some(raw) = seg.path.as_deref() {
        let main = path_key(raw);
        for path in main.iter().cloned().chain(path_extra_keys(raw)) {
            if !keys.iter().any(|k| matches!(k, PatternKey::Path { path: p } if *p == path)) {
                keys.push(PatternKey::Path { path });
            }
        }
    }
    if let Some(domain) = domain_key(seg) {
        keys.push(PatternKey::Domain { domain });
    }
    if let Some(doc) = seg.document.as_deref() {
        // Højst de tre første ord: "Prisliste Gårdbutik 2026" → "prisliste
        // gaardbutik #". Resten af et dokumentnavn er ofte person-specifikt.
        let keyword = template_of(doc)
            .split(' ')
            .take(3)
            .collect::<Vec<_>>()
            .join(" ");
        if !is_generic_title(&keyword) {
            keys.push(PatternKey::AppKeyword {
                app: normalize_app(&seg.app),
                keyword,
            });
        }
    }
    if let Some(template) = title_template(seg) {
        keys.push(PatternKey::TitleTemplate {
            app: app_family(&seg.app),
            template,
        });
    }
    keys
}

impl LearnedPattern {
    fn vote_mut(&mut self, target: &Target) -> &mut Vote {
        if let Some(i) = self.votes.iter().position(|v| &v.target == target) {
            return &mut self.votes[i];
        }
        self.votes.push(Vote {
            target: target.clone(),
            weight: 0.0,
            confirmations: 0,
            corrections: 0,
            ai_answers: 0,
        });
        self.votes.last_mut().expect("lige tilføjet")
    }

    /// Vinderen og dens konfidens, eller `None`, hvis stemmerne er for
    /// spredte eller for svage.
    fn best(&self) -> Option<PatternHit> {
        let total: f32 = self.votes.iter().map(|v| v.weight).sum();
        if total <= 0.0 {
            return None;
        }
        let winner = self
            .votes
            .iter()
            .filter(|v| v.weight > 0.0)
            .max_by(|a, b| {
                a.weight
                    .total_cmp(&b.weight)
                    .then_with(|| b.target.cmp(&a.target))
            })?;
        // Forenelige mål (kunde vs. kunde+projekt) støtter hinanden.
        let support: f32 = self
            .votes
            .iter()
            .filter(|v| v.target.compatible(&winner.target))
            .map(|v| v.weight)
            .sum();
        let purity = support / total;
        let strength = 1.0 - 0.55f32.powf(support);
        let confidence =
            ((0.5 + 0.45 * purity * strength) * self.key.ceiling() / 0.95).min(self.key.ceiling());
        if purity < MIN_PURITY || confidence < MIN_CONFIDENCE || support < MIN_SUPPORT {
            return None;
        }
        Some(PatternHit {
            key: self.key.clone(),
            target: winner.target.clone(),
            confidence,
            confirmations: winner.confirmations,
            corrections: winner.corrections,
            ai_answers: winner.ai_answers,
            strong: winner.corrections >= 2 && purity >= 0.75,
        })
    }
}

impl PatternStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.patterns.len()
    }

    pub fn is_empty(&self) -> bool {
        self.patterns.is_empty()
    }

    fn pattern_mut(&mut self, key: &PatternKey) -> &mut LearnedPattern {
        if let Some(i) = self.patterns.iter().position(|p| &p.key == key) {
            return &mut self.patterns[i];
        }
        self.patterns.push(LearnedPattern {
            key: key.clone(),
            votes: Vec::new(),
        });
        self.patterns.last_mut().expect("lige tilføjet")
    }

    /// Lærer af en blok. Hver nøgle tælles én gang pr. blok og vægtes efter,
    /// hvor stor en del af blokkens tid den dækker, så en kort afbrydelse i
    /// blokken ikke bliver et mønster. `target` ignoreres ved [`Feedback::Reject`].
    pub fn learn(&mut self, segments: &[&ActivitySegment], target: &Target, feedback: &Feedback) {
        let total: i64 = segments.iter().map(|s| s.duration()).sum::<i64>().max(1);
        let mut coverage: BTreeMap<PatternKey, i64> = BTreeMap::new();
        for seg in segments {
            for key in keys_for(seg) {
                *coverage.entry(key).or_default() += seg.duration().max(1);
            }
        }
        for (key, secs) in coverage {
            let share = secs as f32 / total as f32;
            if share < MIN_SHARE {
                continue;
            }
            let scale = (share / FULL_SHARE).min(1.0);
            let pattern = self.pattern_mut(&key);
            match feedback {
                Feedback::Confirm => {
                    let v = pattern.vote_mut(target);
                    v.weight += WEIGHT_CONFIRM * scale;
                    v.confirmations += 1;
                }
                Feedback::Ai => {
                    let v = pattern.vote_mut(target);
                    v.weight += WEIGHT_AI * scale;
                    v.ai_answers += 1;
                }
                Feedback::Correct { from } => {
                    if let Some(from) = from.as_ref().filter(|f| *f != target) {
                        penalize(pattern, from);
                    }
                    let v = pattern.vote_mut(target);
                    v.weight += WEIGHT_CORRECT * scale;
                    v.corrections += 1;
                }
                Feedback::Reject => {
                    penalize(pattern, target);
                }
            }
            pattern
                .votes
                .retain(|v| v.weight > 0.01 || v.confirmations + v.corrections > 0);
        }
        self.patterns.retain(|p| !p.votes.is_empty());
    }

    /// Brugeren har sagt direkte, at nøglen hører til `target` (svar på
    /// "Lær TimeTrack at kende"). Det vejer som to rettelser, så mønsteret er
    /// stærkt og går foran identitet og site-koblinger, men aldrig foran
    /// brugerens regler og `urlPatterns`. Andre mål på nøglen halveres.
    pub fn teach(&mut self, key: &PatternKey, target: &Target) {
        let pattern = self.pattern_mut(key);
        for v in pattern.votes.iter_mut().filter(|v| &v.target != target) {
            v.weight *= PENALTY_FACTOR;
        }
        let v = pattern.vote_mut(target);
        v.weight += 2.0 * WEIGHT_CORRECT;
        v.corrections += 2;
    }

    /// Bedste mønster for et segment, eller `None`.
    pub fn lookup(&self, seg: &ActivitySegment) -> Option<PatternHit> {
        let own = keys_for(seg);
        if own.is_empty() {
            return None;
        }
        // Et segment med repo eller mappe identificeres af dem. En titel-
        // skabelon som "website" er lært i et andet repo og må ikke vinde her.
        let has_code_identity = own
            .iter()
            .any(|k| matches!(k, PatternKey::Repo { .. } | PatternKey::Path { .. }));
        let mut hits: Vec<PatternHit> = self
            .patterns
            .iter()
            .filter(|p| !has_code_identity || p.key.rank() <= 1)
            .filter(|p| p.key.hits(&own))
            .filter_map(LearnedPattern::best)
            .collect();
        // En worktree kan ramme repoer med samme navn hos to kunder. Er de
        // uenige om kunden, siger repo-navnet intet.
        let by_name = |h: &PatternHit| {
            matches!(&h.key, PatternKey::Path { path } if path.starts_with(REPO_NAME_PREFIX))
        };
        let mut clients = hits.iter().filter(|h| by_name(h)).map(|h| &h.target.client_id);
        if let Some(first) = clients.next()
            && clients.any(|c| c != first)
        {
            hits.retain(|h| !by_name(h));
        }
        hits.into_iter()
            .fold(Vec::<PatternHit>::new(), |mut best, hit| {
                // Pr. slags vinder den mest specifikke nøgle (længste mappe eller
                // domæne), uanset konfidens: `…/kunder/bb/src` slår `…/dev`.
                match best.iter_mut().find(|b| b.key.rank() == hit.key.rank()) {
                    Some(b)
                        if hit.key.specificity() > b.key.specificity()
                            || (hit.key.specificity() == b.key.specificity()
                                && hit.confidence > b.confidence) =>
                    {
                        *b = hit
                    }
                    Some(_) => {}
                    None => best.push(hit),
                }
                best
            })
            .into_iter()
            .max_by(|a, b| {
                a.confidence
                    .total_cmp(&b.confidence)
                    .then_with(|| b.key.rank().cmp(&a.key.rank()))
            })
    }

    /// Flet mønstre fra en anden kilde (fx web) ind. Stemmer på samme nøgle og
    /// mål lægges sammen.
    pub fn merge(&mut self, other: &PatternStore) {
        for p in &other.patterns {
            let mine = self.pattern_mut(&p.key);
            for v in &p.votes {
                let m = mine.vote_mut(&v.target);
                m.weight += v.weight;
                m.confirmations += v.confirmations;
                m.corrections += v.corrections;
                m.ai_answers += v.ai_answers;
            }
        }
    }
}

fn penalize(pattern: &mut LearnedPattern, wrong: &Target) {
    for v in pattern.votes.iter_mut().filter(|v| &v.target == wrong) {
        v.weight *= PENALTY_FACTOR;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(app: &str, title: &str, url: Option<&str>) -> ActivitySegment {
        ActivitySegment {
            app: app.into(),
            title: title.into(),
            url: url.map(str::to_string),
            start: 0,
            end: 600,
            ..Default::default()
        }
    }

    fn a() -> Target {
        Target::project(Some("c-a"), "p-a")
    }

    fn b() -> Target {
        Target::project(Some("c-b"), "p-b")
    }

    #[test]
    fn keys_are_generalized_never_whole_titles() {
        let s = ActivitySegment {
            app: "Google Chrome".into(),
            title: "Ordre #1234 – Bageriet på hjørnet Admin - Google Chrome".into(),
            url: Some("https://admin.bageriet.dk/orders/1234".into()),
            repo_remote: Some("git@github.com:Bageriet/Website.git".into()),
            path: Some("/Users/mads/dev/kunder/bageriet/website/src/index.ts".into()),
            document: None,
            ..seg("", "", None)
        };
        let keys = keys_for(&s);
        assert_eq!(
            keys,
            vec![
                PatternKey::Repo {
                    remote: "github.com/bageriet/website".into()
                },
                PatternKey::Path {
                    path: "/users/mads/dev/kunder/bageriet/website/src".into()
                },
                PatternKey::Path {
                    path: "/users/mads/dev/kunder/bageriet".into()
                },
                PatternKey::Path {
                    path: "*/bageriet/website".into()
                },
                PatternKey::Domain {
                    domain: "admin.bageriet.dk".into()
                },
                PatternKey::TitleTemplate {
                    app: "browser".into(),
                    template: "bageriet paa hjoernet admin".into()
                },
            ]
        );
        for k in keys {
            if let PatternKey::TitleTemplate { template, .. } = k {
                assert!(!template.contains("1234") && !template.contains("ordre"));
            }
        }
    }

    fn path_seg(path: &str) -> ActivitySegment {
        ActivitySegment {
            app: "Orca".into(),
            title: "Orca".into(),
            path: Some(path.into()),
            start: 0,
            end: 600,
            ..Default::default()
        }
    }

    fn paths(path: &str) -> Vec<String> {
        keys_for(&path_seg(path))
            .into_iter()
            .filter_map(|k| match k {
                PatternKey::Path { path } => Some(path),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn folders_give_client_folder_repo_and_worktree_keys() {
        assert_eq!(
            paths(r"C:\Projects\Freelance\hansen-vvs\hansen-vvs-web"),
            [
                "c:/projects/freelance/hansen-vvs/hansen-vvs-web",
                "c:/projects/freelance/hansen-vvs",
                "*/hansen-vvs/hansen-vvs-web",
            ]
        );
        assert_eq!(
            paths(r"C:\Projects\Egne\timetrack"),
            ["c:/projects/egne/timetrack", "*/timetrack"]
        );
        assert_eq!(
            paths(r"C:\Projects\worktrees\hansen-vvs-web-fix-cache"),
            [
                "c:/projects/worktrees/hansen-vvs-web-fix-cache",
                "*/hansen",
                "*/hansen-vvs",
                "*/hansen-vvs-web",
                "*/hansen-vvs-web-fix",
                "*/hansen-vvs-web-fix-cache",
            ]
        );
        // En sti uden samlemappe giver kun arbejdsmappen.
        assert_eq!(paths("/opt/data/a/b"), ["/opt/data/a/b"]);
        // Generiske og korte navne generaliserer ikke på tværs af kunder.
        assert_eq!(paths("/u/dev/scripts"), ["/u/dev/scripts"]);
        assert!(!paths(r"C:\Projects\worktrees\api-fix").iter().any(|p| p == "*/api"));
    }

    #[test]
    fn a_new_repo_in_a_known_client_folder_and_a_worktree_are_recognized() {
        let mut store = PatternStore::new();
        let web = path_seg(r"C:\Projects\Freelance\hansen-vvs\hansen-vvs-web");
        store.learn(&[&web], &a(), &Feedback::Confirm);
        store.learn(&[&web], &a(), &Feedback::Confirm);
        // Nyt repo i kundemappen: kundemappen svarer.
        let hit = store
            .lookup(&path_seg(r"C:\Projects\Freelance\hansen-vvs\booking"))
            .expect("kundemappen");
        assert_eq!(hit.target, a());
        assert_eq!(hit.key, PatternKey::Path { path: "c:/projects/freelance/hansen-vvs".into() });
        // En worktree af repoet: den længste forstavelse, der er lært.
        let hit = store
            .lookup(&path_seg(r"C:\Projects\worktrees\hansen-vvs-web-fix-cache"))
            .expect("repoet");
        assert_eq!(hit.target, a());
    }

    #[test]
    fn same_repo_name_at_two_clients_does_not_guess() {
        let mut store = PatternStore::new();
        for _ in 0..2 {
            store.learn(&[&path_seg("/u/dev/kunder/bageriet/website")], &a(), &Feedback::Confirm);
            store.learn(&[&path_seg("/u/dev/kunder/frisor/website")], &b(), &Feedback::Confirm);
        }
        // Hver kundes egen mappe er entydig.
        assert_eq!(store.lookup(&path_seg("/u/dev/kunder/frisor/website")).unwrap().target, b());
        assert_eq!(store.lookup(&path_seg("/u/dev/kunder/bageriet/website")).unwrap().target, a());
        // En worktree "website-fix" kan være begge: intet gæt.
        assert_eq!(store.lookup(&path_seg("/u/dev/worktrees/website-fix")), None);
    }

    #[test]
    fn shared_hosts_need_more_than_the_domain() {
        assert_eq!(
            domain_key(&seg(
                "chrome",
                "",
                Some("https://www.google.com/search?q=x")
            )),
            None
        );
        assert_eq!(
            domain_key(&seg(
                "chrome",
                "",
                Some("https://github.com/acme/Website/pull/3")
            )),
            Some("github.com/acme/website".into())
        );
        assert_eq!(
            domain_key(&seg("chrome", "", Some("https://github.com/acme"))),
            None
        );
        assert_eq!(
            domain_key(&seg("chrome", "", Some("https://xn--hjrnet-cya.dk/"))),
            Some("hjørnet.dk".into())
        );
    }

    #[test]
    fn long_single_part_titles_are_not_learned() {
        let s = seg(
            "Mail",
            "Re: Kan vi flytte mødet om tilbuddet til torsdag i næste uge",
            None,
        );
        assert!(title_template(&s).is_none());
        assert_eq!(
            title_template(&seg("Code", "main.rs - timetrack", None)).as_deref(),
            Some("timetrack")
        );
        // Tjenestens navn og mailadressen er ikke kontekst.
        assert_eq!(
            title_template(&seg(
                "chrome",
                "Nyhedsbrev fra Netto - mads@x.dk - Gmail",
                None
            )),
            None
        );
        assert_eq!(
            title_template(&seg(
                "chrome",
                "Plakat – Julekampagne 2026 – Canva - Google Chrome",
                None
            ))
            .as_deref(),
            Some("julekampagne #")
        );
    }

    #[test]
    fn confidence_grows_with_confirmations() {
        let s = seg("chrome", "", Some("https://bageriet.dk/x"));
        let mut store = PatternStore::new();
        let mut last = 0.0;
        for _ in 0..5 {
            store.learn(&[&s], &a(), &Feedback::Confirm);
            let hit = store.lookup(&s).expect("træf");
            assert_eq!(hit.target, a());
            assert!(hit.confidence > last);
            last = hit.confidence;
        }
        assert!(last > 0.9 && last <= 0.94, "{last}");
        // Underdomæner rammes også.
        assert!(
            store
                .lookup(&seg("chrome", "", Some("https://shop.bageriet.dk/")))
                .is_some()
        );
    }

    #[test]
    fn contradicting_corrections_lower_confidence() {
        let s = seg("chrome", "", Some("https://bageriet.dk/x"));
        let mut store = PatternStore::new();
        for _ in 0..3 {
            store.learn(&[&s], &a(), &Feedback::Correct { from: None });
        }
        let before = store.lookup(&s).unwrap().confidence;
        store.learn(&[&s], &b(), &Feedback::Correct { from: Some(a()) });
        let after = store.lookup(&s).map(|h| h.confidence).unwrap_or(0.0);
        assert!(after < before, "{after} < {before}");
        // To ligeværdige modstridende rettelser giver ingen gæt.
        let mut split = PatternStore::new();
        split.learn(&[&s], &a(), &Feedback::Correct { from: None });
        split.learn(&[&s], &b(), &Feedback::Correct { from: None });
        assert!(split.lookup(&s).is_none());
    }

    #[test]
    fn short_interruptions_in_a_block_are_not_learned() {
        let work = ActivitySegment {
            end: 3600,
            ..seg("chrome", "", Some("https://bageriet.dk/"))
        };
        let news = ActivitySegment {
            end: 60,
            ..seg("chrome", "", Some("https://nyheder.dk/"))
        };
        let mut store = PatternStore::new();
        store.learn(&[&work, &news], &a(), &Feedback::Confirm);
        assert!(store.lookup(&work).is_some());
        assert!(store.lookup(&news).is_none());
    }

    #[test]
    fn title_templates_do_not_cross_repos() {
        let repo = |remote: &str| ActivitySegment {
            repo_remote: Some(remote.into()),
            ..seg("Code", "index.tsx - website - Visual Studio Code", None)
        };
        let mut store = PatternStore::new();
        store.learn(
            &[&repo("git@github.com:acme/website.git")],
            &a(),
            &Feedback::Confirm,
        );
        assert!(
            store
                .lookup(&repo("git@github.com:acme/website.git"))
                .is_some()
        );
        assert!(
            store
                .lookup(&repo("git@github.com:bageriet/website.git"))
                .is_none()
        );
        // Uden repo bruges skabelonen stadig.
        assert!(
            store
                .lookup(&seg("Code", "app.ts - website", None))
                .is_some()
        );
    }

    #[test]
    fn specific_paths_and_domains_beat_broad_ones() {
        let file = |p: &str| ActivitySegment {
            path: Some(p.into()),
            ..seg("Code", "", None)
        };
        let mut store = PatternStore::new();
        for _ in 0..5 {
            store.learn(
                &[&file("/Users/mads/dev/kunder/aa/notes.md")],
                &a(),
                &Feedback::Confirm,
            );
        }
        store.learn(
            &[&file("/Users/mads/dev/kunder/aa/bb/src/x.rs")],
            &b(),
            &Feedback::Confirm,
        );
        assert_eq!(
            store
                .lookup(&file("/Users/mads/dev/kunder/aa/bb/src/y.rs"))
                .unwrap()
                .target,
            b()
        );
        assert_eq!(
            store
                .lookup(&file("/Users/mads/dev/kunder/aa/z.rs"))
                .unwrap()
                .target,
            a()
        );
        // ~/dev alene læres ikke.
        assert_eq!(path_key("/home/mads/dev/notes.md"), None);
        assert_eq!(path_key("/Users/mads/dev"), None);

        let web = |u: &str| seg("chrome", "", Some(u));
        let mut store = PatternStore::new();
        for _ in 0..5 {
            store.learn(&[&web("https://bageriet.dk/")], &a(), &Feedback::Confirm);
        }
        store.learn(
            &[&web("https://shop.bageriet.dk/")],
            &b(),
            &Feedback::Confirm,
        );
        assert_eq!(
            store
                .lookup(&web("https://shop.bageriet.dk/kurv"))
                .unwrap()
                .target,
            b()
        );
        assert_eq!(
            store.lookup(&web("https://bageriet.dk/om")).unwrap().target,
            a()
        );
    }

    #[test]
    fn subjects_and_long_document_names_are_not_stored() {
        let mail = seg("Mail", "Sygemelding Jens Hansen", None);
        assert!(keys_for(&mail).is_empty());
        let doc = ActivitySegment {
            document: Some("Ansættelseskontrakt Jens Hansen Vestergade 12".into()),
            ..seg(
                "Microsoft Word",
                "Ansættelseskontrakt Jens Hansen Vestergade 12.docx - Word",
                None,
            )
        };
        assert_eq!(
            keys_for(&doc),
            vec![PatternKey::AppKeyword {
                app: "microsoft word".into(),
                keyword: "ansaettelseskontrakt jens hansen".into()
            }]
        );
    }

    #[test]
    fn reject_lowers_the_wrong_target() {
        let s = seg("chrome", "", Some("https://bageriet.dk/x"));
        let mut store = PatternStore::new();
        store.learn(&[&s], &a(), &Feedback::Confirm);
        store.learn(&[&s], &a(), &Feedback::Confirm);
        let before = store.lookup(&s).unwrap().confidence;
        store.learn(&[&s], &a(), &Feedback::Reject);
        assert!(store.lookup(&s).map(|h| h.confidence).unwrap_or(0.0) < before);
    }

    #[test]
    fn serde_roundtrip_and_merge() {
        let s = seg("chrome", "", Some("https://bageriet.dk/x"));
        let mut store = PatternStore::new();
        store.learn(&[&s], &a(), &Feedback::Confirm);
        let json = serde_json::to_string(&store).unwrap();
        assert!(json.contains("\"kind\":\"domain\""), "{json}");
        let back: PatternStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back, store);
        let mut merged = PatternStore::new();
        merged.merge(&back);
        merged.merge(&back);
        assert_eq!(merged.patterns[0].votes[0].confirmations, 2);
    }
}
