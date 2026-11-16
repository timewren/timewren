//! Observér først, spørg bagefter.
//!
//! Appen samler aktivitet fra første start uden opsætning. Når der er nok
//! data, grupperer den deterministisk de hyppigste kilder, som matcheren
//! endnu ikke kan placere (repos, mapper, domæner, dokumenter og
//! titel-skabeloner), og stiller ét spørgsmål ad gangen: "Det ligner, at
//! `bageriet-shop` og `bageriet.dk` hører sammen. Er det Bageriet på
//! Hjørnet?" Svaret bliver til stærke mønstre ([`PatternStore::teach`]), så
//! det gælder for alle ubekræftede blokke, også bagud.
//!
//! - **Kilder** er de samme generaliserede nøgler som læringen
//!   ([`keys_for`]), så der aldrig gemmes hele titler. Ord fra titler (mail-
//!   emner, faner, mødetitler) tælles kun som *hint*: de binder kilder
//!   sammen og navngiver en gruppe, men bliver aldrig selv til mønstre.
//! - **Inkrementelt:** [`ObserverState::ingest`] tager kun nye segmenter og
//!   fører minutter og samtidighed pr. dag i 10-minutters spande. Dage ældre
//!   end [`WINDOW_DAYS`] glemmes.
//! - **Gruppering:** stjerne-klynger. Den største ukendte kilde er anker, og
//!   dens direkte naboer (fælles kendetegn som `bageriet`, eller de samme
//!   spande) kommer med. Ingen tilfældighed, ingen AI.
//! - **Forslag:** kundens/projektets navn i kildernes ord (æøå foldet),
//!   matcherens svage bud, kundens domæner og projekternes URL-mønstre.
//!   Ellers et navn til en ny kunde ud fra det fælles ord.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::glob::glob_match;
use crate::learning::{PatternKey, PatternStore, SERVICE_NAMES, keys_for};
use crate::matcher::Matcher;
use crate::normalize::{
    Fold, clean_title, decode_domain, fold_danish, normalize_text, path_components,
    repo_owner_and_name, title_segments,
};
use crate::types::{ActivitySegment, Catalog, SegmentMatch, Target};

/// Spandenes længde (sekunder). Kilder i samme spand "hører sammen".
pub const BUCKET_SECS: i64 = 600;
/// Så mange dage huskes.
pub const WINDOW_DAYS: i64 = 14;
/// Så meget aktivitet (sekunder) før det første spørgsmål: 2 timer.
pub const READY_AFTER_SECS: i64 = 2 * 3600;
/// En kilde skal fylde mindst så meget for at komme med i en gruppe.
const MIN_KEY_SECS: i64 = 5 * 60;
/// En gruppe skal fylde mindst så meget, før der spørges.
const MIN_GROUP_SECS: i64 = 20 * 60;
/// En kilde tæller i en spand, når den fylder mindst så meget i den.
const MIN_BUCKET_SECS: i64 = 60;
/// Højst så mange kilder i én gruppe.
const MAX_MEMBERS: usize = 5;
/// Højst så mange titelord pr. dag (de hyppigste).
const MAX_TOKENS_PER_DAY: usize = 200;
/// "Spring over" skjuler gruppen så længe.
pub const SKIP_SECS: i64 = 20 * 3600;
/// Højst så mange svar pr. dag; derefter venter kortet til i morgen.
pub const MAX_QUESTIONS_PER_DAY: u32 = 5;
/// En kilde er kendt, når matcherens kalibrerede konfidens er mindst så høj.
/// Et svagt navnegæt (≤ 0,75) spørges der stadig om: det er dér, et svar
/// løser mest.
pub const KNOWN_AT: f32 = 0.75;

/// Hvad brugeren svarede på et spørgsmål.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ObserverAnswer {
    /// Kilderne hører til målet. Bliver til mønstre.
    Target { target: Target },
    /// Spørg igen senere ([`SKIP_SECS`]).
    Skip,
    /// Spørg aldrig om disse kilder igen.
    Never,
}

/// En kilde i en gruppe, til visning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedSource {
    pub key: PatternKey,
    /// Kort visningsform: `bageriet-shop`, `bageriet.dk`, `"tilbud" i Word`.
    pub label: String,
    pub secs: i64,
}

/// En gruppe kilder, der ser ud til at høre sammen, og hvad den nok er.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedGroup {
    /// Stabil id: ankerets nøgle.
    pub id: String,
    /// Største kilde først.
    pub sources: Vec<ObservedSource>,
    /// Ord fra titler, der bandt kilderne sammen (højst 3).
    pub hints: Vec<String>,
    pub secs: i64,
    /// Kendt kunde/projekt, gruppen nok hører til.
    pub suggested: Option<Target>,
    /// Hvorfor (dansk, kort): `navnet "Bageriet" i bageriet.dk`.
    pub reason: Option<String>,
    /// Navn til en ny kunde, når intet kendt passer: `Bageriet`.
    pub new_name: Option<String>,
    /// Matcheren kan allerede placere gruppen (vises kun i Aktivitet).
    pub known: bool,
    /// Værdien af et svar: minutter × usikkerhed × dage, kilderne er set.
    /// Spørgsmålene stilles i den rækkefølge.
    #[serde(default)]
    pub value: f64,
}

/// Status til kortet "Lær TimeTrack at kende".
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverStatus {
    /// Observeret aktivitet i vinduet (sekunder).
    pub observed_secs: i64,
    /// Nok data til at spørge.
    pub ready: bool,
    /// Det næste spørgsmål (ét ad gangen).
    pub question: Option<ObservedGroup>,
    /// Spørgsmål tilbage efter dette.
    pub remaining: usize,
    /// Dagens loft ([`MAX_QUESTIONS_PER_DAY`]) er nået; der spørges igen i morgen.
    #[serde(default)]
    pub capped: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DayStats {
    /// Kilde-id → sekunder.
    #[serde(default)]
    secs: BTreeMap<u32, i64>,
    /// Kilde-id → antal spande, kilden var med i.
    #[serde(default)]
    buckets: BTreeMap<u32, u32>,
    /// (a << 32 | b), a < b → spande, de to var med i sammen.
    #[serde(default)]
    pairs: BTreeMap<u64, u32>,
    /// Titelord → sekunder.
    #[serde(default)]
    tokens: BTreeMap<String, i64>,
    /// Aktivitet i alt (sekunder).
    #[serde(default)]
    total: i64,
}

/// Det, observatøren husker. Gemmes som JSON (`observer.json`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverState {
    /// Kildetabellen; id = indeks.
    #[serde(default)]
    keys: Vec<PatternKey>,
    /// Nøgle → id. Bygges igen efter indlæsning og omnummerering.
    #[serde(skip)]
    index: HashMap<PatternKey, u32>,
    /// Dag (unix-dag, UTC) → tal.
    #[serde(default)]
    days: BTreeMap<i64, DayStats>,
    /// Spande, der stadig kan få flere segmenter: spand → kilde-id → sekunder.
    #[serde(default)]
    open: BTreeMap<i64, BTreeMap<u32, i64>>,
    /// Højeste segment-id, der er talt med (kalderens markør).
    #[serde(default)]
    pub cursor: i64,
    /// Slut på det seneste segment, der er talt med.
    #[serde(default)]
    pub last_end: i64,
    /// Kilder, der aldrig skal spørges om.
    #[serde(default)]
    never: BTreeSet<PatternKey>,
    /// Gruppe-id → skjult til (unix-sek.).
    #[serde(default)]
    skipped: BTreeMap<String, i64>,
    /// Antal besvarede spørgsmål (til målinger).
    #[serde(default)]
    pub answered: u32,
    /// Dag → svar den dag (til det daglige loft).
    #[serde(default)]
    asked: BTreeMap<i64, u32>,
}

/// Summer over vinduet: sekunder, spande og par pr. kilde, og titelord.
type Totals = (HashMap<u32, i64>, HashMap<u32, u32>, HashMap<u64, u32>, HashMap<String, i64>);

fn pair_key(a: u32, b: u32) -> u64 {
    let (a, b) = if a < b { (a, b) } else { (b, a) };
    (u64::from(a) << 32) | u64::from(b)
}

fn day_of(ts: i64) -> i64 {
    ts.div_euclid(86_400)
}

/// Ord, der ikke kendetegner noget arbejde: tjenester, generiske mapper og
/// almindelige ord på dansk og engelsk.
const GENERIC_WORDS: &[&str] = &[
    "main", "master", "develop", "website", "webshop", "shop", "site", "sites", "web", "www",
    "app", "apps", "kode", "code", "projekt", "projekter", "project", "projects", "mail",
    "test", "tests", "docs", "admin", "dashboard", "login", "home", "forside", "index",
    "frontend", "backend", "server", "client", "klient", "api", "data", "assets", "public",
    "local", "nyt", "nye", "ny", "new", "draft", "kladde", "udkast", "fwd", "svar", "reply",
    "tilbud", "faktura", "invoice", "mode", "moede", "meeting", "status", "statusmoede",
    "opfoelgning", "aftale", "re", "aw", "vedr", "angaaende", "om", "til", "fra", "med", "og",
    "for", "the", "and", "with", "from", "your", "dit", "din", "jeres", "vores", "update",
    "opdatering", "rettelse", "rettelser", "fix", "feat", "chore", "review", "pull", "request",
    "issue", "issues", "branch", "commit", "commits", "merge", "readme", "src", "lib", "dist",
    "build", "config", "settings", "indstillinger", "edit", "rediger", "view", "vis", "page",
    "side", "sider", "pages", "post", "posts", "indlaeg", "kunde", "kunder", "customer",
    "customers", "users", "user", "bruger", "brugere", "team", "teams", "general", "generelt",
    "dk", "com", "net", "org", "io", "se", "no", "de", "uk", "eu", "online", "cloud",
    "localhost", "inbox", "indbakke", "kalender", "calendar", "week", "uge", "today", "idag",
    "notes", "noter", "note", "liste", "list", "plan", "planer", "oversigt", "overview",
    "store", "butik", "document", "dokument", "presentation", "praesentation", "spreadsheet", "regneark",
    "kopi", "copy", "final", "endelig", "version", "files", "filer", "folder", "mappe",
];

/// Ord på tre bogstaver, der er almindelige ord og ikke forkortelser for en
/// kunde (`bph`, `hkk` er kendetegn; `dev`, `src` er ikke).
const GENERIC_SHORT: &[&str] = &[
    "paa", "hos", "ved", "dev", "src", "lib", "bin", "app", "web", "api", "www", "com", "net", "org", "the", "and",
    "for", "you", "med", "til", "fra", "som", "der", "det", "den", "ikke", "har", "kan", "vil",
    "new", "nyt", "old", "tmp", "var", "doc", "pdf", "img", "css", "php", "cdn", "ssl", "dns",
    "ftp", "ssh", "git", "pro", "abc", "via", "per", "and", "all", "alt", "get", "set", "add",
    "fix", "run", "log", "mit", "min", "sin", "dit", "din", "vores", "hvem", "hvad", "hej",
    "tak", "god", "dag", "uge", "tid", "nye", "fwd", "ugens", "out", "our", "not", "has",
    "was", "are", "can", "use", "how", "why", "who", "one", "two", "top", "end", "max",
    "pre", "rev", "wip", "ord", "sms", "faq", "kpi", "seo", "ads", "crm", "erp", "cms", "ui",
    "ux", "pdf", "csv", "xml", "json", "yml", "sql", "zip", "png", "jpg", "svg", "mov",
];

fn is_generic_word(w: &str) -> bool {
    GENERIC_WORDS.contains(&w)
        || SERVICE_NAMES.contains(&w)
        || (w.chars().count() == 3 && GENERIC_SHORT.contains(&w))
}

/// Kendetegnende ord i en tekst: foldet (ae/oe/aa), mindst 3 tegn, ingen tal
/// og ingen generiske ord. Tre bogstaver er tit en kundes forkortelse (`bph`).
pub fn distinctive_words(text: &str) -> Vec<String> {
    let norm = fold_danish(&normalize_text(&text.replace(['-', '_', '.', '/'], " ")), Fold::Double);
    let mut out: Vec<String> = Vec::new();
    for w in norm.split_whitespace() {
        if w.chars().count() < 3 || w.chars().any(|c| c.is_ascii_digit()) || is_generic_word(w) {
            continue;
        }
        if !out.iter().any(|o| o == w) {
            out.push(w.to_string());
        }
    }
    out
}

/// Kendetegnende ord for en kilde.
fn key_words(key: &PatternKey) -> Vec<String> {
    match key {
        PatternKey::Repo { remote } => {
            let (owner, name) = repo_owner_and_name(remote);
            let mut w = distinctive_words(name.unwrap_or(""));
            // Ejeren er ofte en kunde-organisation (github.com/bageriet/…),
            // men tit også brugeren selv; den tæller, men efter navnet.
            for o in distinctive_words(owner.unwrap_or("")) {
                if !w.contains(&o) {
                    w.push(o);
                }
            }
            w
        }
        PatternKey::Path { path } => {
            let comps = path_components(path);
            let tail: Vec<&String> = comps.iter().rev().take(2).collect();
            let mut w = Vec::new();
            for c in tail {
                for x in distinctive_words(c) {
                    if !w.contains(&x) {
                        w.push(x);
                    }
                }
            }
            w
        }
        PatternKey::Domain { domain } => {
            let (host, rest) = domain.split_once('/').unwrap_or((domain, ""));
            if !rest.is_empty() {
                // github.com/ejer/repo: repoets navn kendetegner.
                return distinctive_words(rest);
            }
            let decoded = decode_domain(host);
            let labels: Vec<&str> = decoded.split('.').collect();
            let body = if labels.len() > 1 {
                labels[..labels.len() - 1].join(" ")
            } else {
                decoded.clone()
            };
            distinctive_words(&body)
        }
        PatternKey::AppKeyword { keyword, .. } => distinctive_words(keyword),
        PatternKey::TitleTemplate { template, .. } => distinctive_words(template),
    }
}

/// Kort visningsform for en kilde.
pub fn source_label(key: &PatternKey) -> String {
    match key {
        PatternKey::Repo { remote } => {
            let (owner, name) = repo_owner_and_name(remote);
            match (owner, name) {
                (Some(o), Some(n)) => format!("{o}/{n}"),
                (None, Some(n)) => n.to_string(),
                _ => remote.clone(),
            }
        }
        PatternKey::Path { path } => {
            let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
            let tail = parts.len().saturating_sub(2);
            format!("…/{}", parts[tail..].join("/"))
        }
        PatternKey::Domain { domain } => domain.clone(),
        PatternKey::AppKeyword { keyword, .. } => keyword.clone(),
        PatternKey::TitleTemplate { template, .. } => template.clone(),
    }
}

/// Et kunstigt segment, der kun bærer nøglen. Bruges til at spørge
/// matcheren, om den allerede kan placere kilden.
pub fn probe_segment(key: &PatternKey) -> ActivitySegment {
    let mut s = ActivitySegment {
        app: "Code".into(),
        start: 0,
        end: 600,
        ..Default::default()
    };
    match key {
        PatternKey::Repo { remote } => s.repo_remote = Some(remote.clone()),
        // En undermappe, så en mappe med punktum ikke læses som en fil.
        PatternKey::Path { path } => s.path = Some(format!("{path}/probe")),
        PatternKey::Domain { domain } => {
            s.app = "Safari".into();
            let host = domain.split('/').next().unwrap_or(domain);
            s.domain = Some(host.to_string());
            s.url = Some(format!("https://{domain}"));
        }
        PatternKey::AppKeyword { app, keyword } => {
            s.app = app.clone();
            // `#` står for et tal i skabelonen; et tal giver den igen.
            let doc = keyword.replace('#', "1");
            s.title = doc.clone();
            s.document = Some(doc);
        }
        PatternKey::TitleTemplate { app, template } => {
            s.app = if app == "browser" { "Safari".into() } else { app.clone() };
            // Skabelonen er titlens faste del efter den variable første del.
            s.title = format!("probe – {}", template.replace('#', "1"));
        }
    }
    s
}

/// Kilder for ét segment: læringens nøgler. Et segment med repo eller mappe
/// identificeres af dem; dets titel-skabelon er ikke en egen kilde.
pub fn sources_of(seg: &ActivitySegment) -> Vec<PatternKey> {
    let keys = keys_for(seg);
    let code = keys
        .iter()
        .any(|k| matches!(k, PatternKey::Repo { .. } | PatternKey::Path { .. }));
    keys.into_iter()
        .filter(|k| !(code && matches!(k, PatternKey::TitleTemplate { .. })))
        .collect()
}

/// Titelord fra et segment: emner, faner og mødetitler, tokeniseret.
fn title_words(seg: &ActivitySegment) -> Vec<String> {
    let cleaned = clean_title(&seg.app, &seg.title);
    let mut out = Vec::new();
    for part in title_segments(&cleaned) {
        for w in distinctive_words(&part) {
            if !out.contains(&w) {
                out.push(w);
            }
        }
    }
    out
}

impl ObserverState {
    pub fn new() -> Self {
        Self::default()
    }

    fn key_id(&mut self, key: PatternKey) -> u32 {
        if self.index.len() != self.keys.len() {
            self.index = self.keys.iter().enumerate().map(|(i, k)| (k.clone(), i as u32)).collect();
        }
        if let Some(i) = self.index.get(&key) {
            return *i;
        }
        let id = self.keys.len() as u32;
        self.index.insert(key.clone(), id);
        self.keys.push(key);
        id
    }

    /// Tæller segmenterne med. Kalderen giver kun nye segmenter og fører
    /// [`ObserverState::cursor`] for segment-id'er; et segment, der gives to
    /// gange, tælles to gange.
    pub fn ingest(&mut self, segments: &[ActivitySegment]) {
        let mut segs: Vec<&ActivitySegment> = segments.iter().filter(|s| s.duration() > 0).collect();
        segs.sort_by_key(|s| (s.start, s.end));
        for seg in segs {
            let keys: Vec<u32> = sources_of(seg).into_iter().map(|k| self.key_id(k)).collect();
            let words = title_words(seg);
            let day = self.days.entry(day_of(seg.start)).or_default();
            day.total += seg.duration();
            for w in words {
                *day.tokens.entry(w).or_default() += seg.duration();
            }
            // Fordel tiden på spandene. Sekunderne bogføres på spandens dag,
            // ligesom spande og par, så en dag altid rummer alle sine kilder.
            let mut t = seg.start;
            while t < seg.end {
                let bucket = t.div_euclid(BUCKET_SECS);
                let bucket_end = (bucket + 1) * BUCKET_SECS;
                let piece = bucket_end.min(seg.end) - t;
                let secs = &mut self.days.entry(day_of(bucket * BUCKET_SECS)).or_default().secs;
                for &k in &keys {
                    *secs.entry(k).or_default() += piece;
                }
                let open = self.open.entry(bucket).or_default();
                for &k in &keys {
                    *open.entry(k).or_default() += piece;
                }
                t = bucket_end;
            }
            self.last_end = self.last_end.max(seg.end);
        }
        self.close_buckets(self.last_end.div_euclid(BUCKET_SECS));
        self.prune();
    }

    /// Lukker spande før `before`: kilderne i dem tæller som samtidige.
    fn close_buckets(&mut self, before: i64) {
        let closing: Vec<i64> = self.open.range(..before).map(|(b, _)| *b).collect();
        for b in closing {
            let Some(keys) = self.open.remove(&b) else {
                continue;
            };
            let present: Vec<u32> = keys
                .into_iter()
                .filter(|(_, s)| *s >= MIN_BUCKET_SECS)
                .map(|(k, _)| k)
                .collect();
            let day = self.days.entry(day_of(b * BUCKET_SECS)).or_default();
            for &k in &present {
                *day.buckets.entry(k).or_default() += 1;
            }
            for (i, &a) in present.iter().enumerate() {
                for &c in &present[i + 1..] {
                    *day.pairs.entry(pair_key(a, c)).or_default() += 1;
                }
            }
        }
    }

    /// Glemmer dage uden for vinduet, kilder ingen dage bruger, og titelord ud
    /// over de hyppigste.
    fn prune(&mut self) {
        let newest = day_of(self.last_end);
        self.days.retain(|d, _| *d > newest - WINDOW_DAYS);
        for day in self.days.values_mut() {
            if day.tokens.len() > MAX_TOKENS_PER_DAY {
                let mut v: Vec<(String, i64)> = std::mem::take(&mut day.tokens).into_iter().collect();
                v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                v.truncate(MAX_TOKENS_PER_DAY);
                day.tokens = v.into_iter().collect();
            }
        }
        let now = self.last_end;
        self.skipped.retain(|_, until| *until > now);
        // Kildetabellen ryddes, når den er vokset meget: omnummerér.
        if self.keys.len() > 4_000 {
            self.compact_keys();
        }
    }

    fn compact_keys(&mut self) {
        let mut used: BTreeSet<u32> = BTreeSet::new();
        for d in self.days.values() {
            used.extend(d.secs.keys().copied());
            used.extend(d.buckets.keys().copied());
            for p in d.pairs.keys() {
                used.insert((p >> 32) as u32);
                used.insert((p & 0xffff_ffff) as u32);
            }
        }
        for o in self.open.values() {
            used.extend(o.keys().copied());
        }
        let map: HashMap<u32, u32> = used.iter().enumerate().map(|(n, &o)| (o, n as u32)).collect();
        let keys: Vec<PatternKey> = used.iter().map(|&o| self.keys[o as usize].clone()).collect();
        for d in self.days.values_mut() {
            d.secs = std::mem::take(&mut d.secs).into_iter().map(|(k, v)| (map[&k], v)).collect();
            d.buckets =
                std::mem::take(&mut d.buckets).into_iter().map(|(k, v)| (map[&k], v)).collect();
            d.pairs = std::mem::take(&mut d.pairs)
                .into_iter()
                .map(|(p, v)| {
                    let (a, b) = ((p >> 32) as u32, (p & 0xffff_ffff) as u32);
                    (pair_key(map[&a], map[&b]), v)
                })
                .collect();
        }
        for o in self.open.values_mut() {
            *o = std::mem::take(o).into_iter().map(|(k, v)| (map[&k], v)).collect();
        }
        self.keys = keys;
        self.index.clear();
    }

    /// Aktivitet i vinduet (sekunder).
    pub fn observed_secs(&self) -> i64 {
        self.days.values().map(|d| d.total).sum()
    }

    /// Antal kilder i tabellen (til målinger).
    pub fn key_count(&self) -> usize {
        self.keys.len()
    }

    fn totals(&self) -> Totals {
        let mut secs = HashMap::new();
        let mut buckets = HashMap::new();
        let mut pairs = HashMap::new();
        let mut tokens = HashMap::new();
        for d in self.days.values() {
            for (k, v) in &d.secs {
                *secs.entry(*k).or_default() += v;
            }
            for (k, v) in &d.buckets {
                *buckets.entry(*k).or_default() += v;
            }
            for (k, v) in &d.pairs {
                *pairs.entry(*k).or_default() += v;
            }
            for (k, v) in &d.tokens {
                *tokens.entry(k.clone()).or_default() += v;
            }
        }
        (secs, buckets, pairs, tokens)
    }

    /// Alle grupper, største først. `include_known` tager også kilder med,
    /// som matcheren allerede kan placere (Aktivitet-skærmen); spørgsmålene
    /// bruger kun de ukendte.
    pub fn groups(&self, matcher: &Matcher, include_known: bool) -> Vec<ObservedGroup> {
        let (secs, buckets, pairs, tokens) = self.totals();
        // Kilder, der er store nok, og om matcheren kender dem.
        let mut cands: Vec<(u32, i64, bool)> = secs
            .iter()
            .filter(|(k, s)| **s >= MIN_KEY_SECS && !self.never.contains(&self.keys[**k as usize]))
            .map(|(k, s)| {
                let known = match matcher.match_calibrated(&probe_segment(&self.keys[*k as usize])) {
                    SegmentMatch::Match(c) => c.confidence >= KNOWN_AT,
                    SegmentMatch::Ignore { .. } => true,
                    SegmentMatch::Unknown => false,
                };
                (*k, *s, known)
            })
            .filter(|(_, _, known)| include_known || !known)
            .collect();
        // Største først; lige store efter nøglen, så rækkefølgen er stabil.
        cands.sort_by(|a, b| {
            b.1.cmp(&a.1)
                .then_with(|| self.keys[a.0 as usize].cmp(&self.keys[b.0 as usize]))
        });
        let words: HashMap<u32, Vec<String>> =
            cands.iter().map(|(k, _, _)| (*k, key_words(&self.keys[*k as usize]))).collect();

        let linked = |a: u32, b: u32| -> Option<String> {
            // Fælles kendetegnende ord.
            if let Some(w) = words[&a].iter().find(|w| words[&b].contains(w)) {
                return Some(w.clone());
            }
            // Samme spande.
            let together = *pairs.get(&pair_key(a, b)).unwrap_or(&0) as f64;
            let (ba, bb) = (
                *buckets.get(&a).unwrap_or(&0) as f64,
                *buckets.get(&b).unwrap_or(&0) as f64,
            );
            let (lo, hi) = (ba.min(bb), ba.max(bb));
            (together >= 2.0 && lo > 0.0 && together / lo >= 0.5 && together / hi >= 0.2)
                .then(String::new)
        };

        let mut used: BTreeSet<u32> = BTreeSet::new();
        let mut out = Vec::new();
        for &(anchor, _, anchor_known) in &cands {
            if used.contains(&anchor) {
                continue;
            }
            used.insert(anchor);
            let mut members = vec![anchor];
            let mut shared: Vec<String> = Vec::new();
            for &(other, _, known) in &cands {
                if members.len() >= MAX_MEMBERS {
                    break;
                }
                // Kendte og ukendte kilder blandes ikke: svaret skal kun lære det ukendte.
                if used.contains(&other) || known != anchor_known {
                    continue;
                }
                if let Some(w) = linked(anchor, other) {
                    used.insert(other);
                    members.push(other);
                    if !w.is_empty() && !shared.contains(&w) {
                        shared.push(w);
                    }
                }
            }
            let total: i64 = members.iter().map(|m| secs[m]).sum();
            if total < MIN_GROUP_SECS {
                continue;
            }
            // Titelord, der deler ord med kilderne (mails om "bageriet").
            let member_words: BTreeSet<&String> =
                members.iter().flat_map(|m| words[m].iter()).collect();
            let mut hints: Vec<(&String, i64)> = tokens
                .iter()
                .filter(|(t, s)| **s >= MIN_KEY_SECS && member_words.contains(t))
                .map(|(t, s)| (t, *s))
                .collect();
            hints.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
            let hints: Vec<String> = hints.into_iter().take(3).map(|(t, _)| t.clone()).collect();

            let sources: Vec<ObservedSource> = members
                .iter()
                .map(|m| ObservedSource {
                    key: self.keys[*m as usize].clone(),
                    label: source_label(&self.keys[*m as usize]),
                    secs: secs[m],
                })
                .collect();
            let mut group = ObservedGroup {
                id: group_id(&sources.iter().map(|s| s.key.clone()).collect::<Vec<_>>()),
                sources,
                hints,
                secs: total,
                suggested: None,
                reason: None,
                new_name: None,
                known: anchor_known,
                value: 0.0,
            };
            group.value = self.value_of(&members, total, matcher);
            propose(&mut group, matcher, &words_of(&members, &words), &shared);
            out.push(group);
        }
        out
    }

    /// Status til kortet: nok data, og det næste spørgsmål.
    pub fn status(&self, matcher: &Matcher, now: i64) -> ObserverStatus {
        let observed = self.observed_secs();
        let ready = observed >= READY_AFTER_SECS;
        let capped = self.asked.get(&day_of(now)).copied().unwrap_or(0) >= MAX_QUESTIONS_PER_DAY;
        let mut questions: Vec<ObservedGroup> = if ready && !capped {
            self.groups(matcher, false)
                .into_iter()
                .filter(|g| {
                    self.skipped
                        .get(&anchor_id(&g.sources[0].key))
                        .is_none_or(|until| *until <= now)
                })
                .collect()
        } else {
            Vec::new()
        };
        // Mest værd først; lige værdi efter størrelse (som grupperingen).
        questions.sort_by(|a, b| b.value.total_cmp(&a.value));
        let remaining = questions.len().saturating_sub(1);
        ObserverStatus {
            observed_secs: observed,
            ready,
            question: (!questions.is_empty()).then(|| questions.remove(0)),
            remaining,
            capped,
        }
    }

    /// Værdien af et svar om gruppen: minutter, den dækker, gange
    /// usikkerheden (1 − matcherens kalibrerede konfidens, mindst 0,5 når
    /// Naive Bayes er uenig med kaskaden) gange antal dage, kilderne er set
    /// (et svar om noget, der går igen, løser mere fremover).
    fn value_of(&self, members: &[u32], secs: i64, matcher: &Matcher) -> f64 {
        let mut sure: f64 = 0.0;
        let mut disagree = false;
        for m in members {
            let probe = probe_segment(&self.keys[*m as usize]);
            if let SegmentMatch::Match(c) = matcher.match_calibrated(&probe) {
                sure = sure.max(f64::from(c.confidence));
                if let Some((best, p)) = matcher.model.nb.predict(&probe).as_ref().and_then(|p| {
                    p.best().map(|(b, q)| (b.to_string(), q))
                }) && p >= 0.5
                    && !best.is_empty()
                    && c.target.client_id.as_deref() != Some(best.as_str())
                {
                    disagree = true;
                }
            }
        }
        let mut uncertainty = 1.0 - sure;
        if disagree {
            uncertainty = uncertainty.max(0.5);
        }
        let days = self
            .days
            .values()
            .filter(|d| members.iter().any(|m| d.secs.get(m).is_some_and(|s| *s > 0)))
            .count()
            .max(1) as f64;
        (secs as f64 / 60.0) * uncertainty * days
    }

    /// Lægger svaret på en gruppe ind. `Target` lærer stærke mønstre i
    /// `patterns` (de gælder også bagud); `Skip` skjuler gruppen i
    /// [`SKIP_SECS`]; `Never` glemmer kilderne for altid.
    pub fn answer(
        &mut self,
        group: &ObservedGroup,
        answer: &ObserverAnswer,
        patterns: &mut PatternStore,
        now: i64,
    ) {
        // Loftet tæller svar; "Spring over" er ikke et svar.
        if !matches!(answer, ObserverAnswer::Skip) {
            *self.asked.entry(day_of(now)).or_default() += 1;
        }
        // Kun de seneste dage huskes.
        let keep_from = day_of(now) - WINDOW_DAYS;
        self.asked.retain(|d, _| *d >= keep_from);
        match answer {
            ObserverAnswer::Target { target } => {
                for s in &group.sources {
                    patterns.teach(&s.key, target);
                }
                self.answered += 1;
            }
            ObserverAnswer::Skip => {
                self.skipped.insert(anchor_id(&group.sources[0].key), now + SKIP_SECS);
            }
            ObserverAnswer::Never => {
                for s in &group.sources {
                    self.never.insert(s.key.clone());
                }
            }
        }
    }
}

fn words_of(members: &[u32], words: &HashMap<u32, Vec<String>>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for m in members {
        for w in &words[m] {
            if !out.contains(w) {
                out.push(w.clone());
            }
        }
    }
    out
}

/// Id for en gruppe: en hash af alle dens kilder. Ændres gruppen (en ny kilde
/// er kommet med), ændres id'et, så et svar aldrig lærer kilder, brugeren
/// ikke så.
pub fn group_id(keys: &[PatternKey]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for k in keys {
        for b in serde_json::to_string(k).unwrap_or_default().bytes().chain([0]) {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    format!("og_{h:016x}")
}

/// Ankerets nøgle som tekst ("Spring over" gælder ankeret, også hvis
/// gruppen får flere kilder).
fn anchor_id(anchor: &PatternKey) -> String {
    serde_json::to_string(anchor).unwrap_or_default()
}

/// Kompakt form af et navn til sammenligning: foldet, uden mellemrum.
fn compact(text: &str) -> String {
    fold_danish(&normalize_text(text), Fold::Double)
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}

/// Finder et kendt mål til gruppen, ellers et navn til en ny kunde.
fn propose(group: &mut ObservedGroup, matcher: &Matcher, words: &[String], shared: &[String]) {
    let catalog: &Catalog = &matcher.catalog;
    // (score, mål, begrundelse)
    let mut best: Vec<(u32, Target, String)> = Vec::new();
    let mut consider = |score: u32, target: Target, reason: String| {
        if let Some(resolved) = catalog.resolve(&target) {
            best.push((score, resolved, reason));
        }
    };

    for s in &group.sources {
        let probe = probe_segment(&s.key);
        // Matcherens svage bud (fx et navn i titlen under tærsklen).
        if let SegmentMatch::Match(c) = matcher.match_segment(&probe) {
            consider(60, c.target, c.reason);
        }
        // Projekternes URL-mønstre og kundernes domæner.
        if let PatternKey::Domain { domain } = &s.key {
            let host = domain.split('/').next().unwrap_or(domain);
            for p in catalog.projects.iter().filter(|p| !p.archived) {
                if p.url_patterns.iter().any(|pat| {
                    glob_match(pat, &format!("https://{domain}"))
                        || glob_match(pat, &format!("https://{domain}/"))
                }) {
                    consider(
                        95,
                        Target::project(p.client_id.as_deref(), &p.id),
                        format!("{} passer med projektets URL-mønster", s.label),
                    );
                }
            }
            for c in catalog.clients.iter().filter(|c| !c.archived) {
                if c.domains.iter().any(|d| crate::normalize::domain_matches(host, d)) {
                    consider(90, Target::client(&c.id), format!("{} er kundens domæne", s.label));
                }
            }
        }
    }

    // Kunde- og projektnavne i kildernes ord (æøå foldet): et helt ord,
    // navnet i ét stykke, et langt navneord først i ordet (`kofoedvvs`) eller
    // forbogstaverne (`bph` for Bageriet på Hjørnet).
    let name_hit = |name: &str| -> Option<String> {
        let c = compact(name);
        let name_words = distinctive_words(name);
        let all_words: Vec<String> = fold_danish(&normalize_text(name), Fold::Double)
            .split_whitespace()
            .map(str::to_string)
            .collect();
        let initials: String = all_words.iter().filter_map(|w| w.chars().next()).collect();
        words.iter().find_map(|w| {
            let hit = name_words.contains(w)
                || (w.len() >= 5 && c.contains(w.as_str()))
                || (c.len() >= 5 && w.contains(c.as_str()))
                || name_words
                    .iter()
                    .any(|n| n.len() >= 5 && w.len() > n.len() && w.starts_with(n.as_str()))
                || (initials.len() >= 3 && *w == initials);
            hit.then(|| w.clone())
        })
    };
    for c in catalog.clients.iter().filter(|c| !c.archived) {
        if let Some(w) = name_hit(&c.name) {
            consider(70, Target::client(&c.id), format!("\"{w}\" ligner kunden {}", c.name));
        }
    }
    for p in catalog.projects.iter().filter(|p| !p.archived) {
        if let Some(w) = name_hit(&p.name) {
            consider(
                65,
                Target::project(p.client_id.as_deref(), &p.id),
                format!("\"{w}\" ligner projektet {}", p.name),
            );
        }
    }

    // Saml pr. mål: højeste score, og et projekt løfter sin kunde.
    best.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    if let Some((score, target, reason)) = best.first().cloned() {
        // To forskellige kunder med samme bedste score: intet gæt.
        let rival = best.iter().any(|(s, t, _)| {
            *s == score && t.client_id != target.client_id && !t.compatible(&target)
        });
        if !rival {
            // Kundens projekt fra et lavere bud, hvis det passer.
            let target = if target.project_id.is_none() {
                best.iter()
                    .find(|(_, t, _)| t.project_id.is_some() && t.client_id == target.client_id)
                    .map(|(_, t, _)| t.clone())
                    .unwrap_or(target)
            } else {
                target
            };
            group.suggested = Some(target);
            group.reason = Some(reason);
            return;
        }
    }

    // Intet kendt: et navn til en ny kunde. Det fælles ord, ellers ankerets.
    let name = shared
        .first()
        .cloned()
        .or_else(|| group.sources.iter().find_map(|s| key_words(&s.key).into_iter().next()));
    group.new_name = name.map(|n| {
        let shown = display_form(&n, &group.sources);
        // En forkortelse (`bph`) skrives med store bogstaver.
        if shown.chars().count() <= 3 {
            shown.to_uppercase()
        } else {
            title_case(&shown)
        }
    });
}

/// "bageriet" → "Bageriet".
fn title_case(word: &str) -> String {
    let mut c = word.chars();
    match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => String::new(),
    }
}

/// Ordet, som det står i kilderne (med æøå), hvis det findes: foldningen
/// (`hjoernet`) kan ikke vendes sikkert.
fn display_form(word: &str, sources: &[ObservedSource]) -> String {
    for s in sources {
        let text = normalize_text(&s.label.replace(['-', '_', '.', '/'], " "));
        if let Some(w) = text
            .split_whitespace()
            .find(|w| fold_danish(w, Fold::Double) == word)
        {
            return w.to_string();
        }
    }
    word.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Client, Project};

    fn seg(start: i64, mins: i64, f: impl FnOnce(&mut ActivitySegment)) -> ActivitySegment {
        let mut s = ActivitySegment {
            app: "Code".into(),
            start,
            end: start + mins * 60,
            ..Default::default()
        };
        f(&mut s);
        s
    }

    const T0: i64 = 1_793_602_800; // en mandag kl. 08 UTC

    /// En formiddag: repoet bageriet-shop og domænet bageriet.dk skiftevis,
    /// og nyheder på dr.dk.
    fn morning(day: i64) -> Vec<ActivitySegment> {
        let base = T0 + day * 86_400;
        let mut v = Vec::new();
        for i in 0..12 {
            let t = base + i * 900;
            v.push(seg(t, 10, |s| {
                s.repo_remote = Some("git@github.com:acme/bageriet-shop.git".into());
                s.title = "cart.rs - bageriet-shop".into();
            }));
            v.push(seg(t + 600, 5, |s| {
                s.app = "Safari".into();
                s.url = Some("https://bageriet.dk/kurv".into());
                s.title = "Kurv – Bageriet".into();
            }));
        }
        v.push(seg(base + 4 * 3600, 10, |s| {
            s.app = "Safari".into();
            s.url = Some("https://www.dr.dk/nyheder".into());
            s.title = "Nyheder – DR".into();
        }));
        v
    }

    fn catalog() -> Catalog {
        Catalog {
            clients: vec![
                Client {
                    id: "c1".into(),
                    name: "Bageriet på Hjørnet".into(),
                    ..Default::default()
                },
                Client {
                    id: "c2".into(),
                    name: "Nordlys Arkitekter".into(),
                    ..Default::default()
                },
            ],
            projects: vec![Project {
                id: "p1".into(),
                name: "Webshop".into(),
                client_id: Some("c1".into()),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn not_ready_before_two_hours() {
        let mut st = ObserverState::new();
        st.ingest(&morning(0)[..6]);
        let m = Matcher::new(Catalog::default(), PatternStore::new());
        let status = st.status(&m, T0);
        assert!(!status.ready);
        assert!(status.question.is_none());
        assert!(status.observed_secs > 0);
    }

    #[test]
    fn groups_repo_and_domain_and_proposes_new_client() {
        let mut st = ObserverState::new();
        st.ingest(&morning(0));
        let m = Matcher::new(Catalog::default(), PatternStore::new());
        let status = st.status(&m, T0);
        assert!(status.ready);
        let q = status.question.expect("et spørgsmål");
        let labels: Vec<&str> = q.sources.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, vec!["acme/bageriet-shop", "bageriet.dk", "bageriet"]);
        assert_eq!(q.suggested, None);
        assert_eq!(q.new_name.as_deref(), Some("Bageriet"));
    }

    #[test]
    fn proposes_known_client_by_fuzzy_name() {
        let mut st = ObserverState::new();
        st.ingest(&morning(0));
        let m = Matcher::new(catalog(), PatternStore::new());
        let q = st.status(&m, T0).question.expect("spørgsmål");
        assert_eq!(q.suggested.as_ref().and_then(|t| t.client_id.as_deref()), Some("c1"));
        assert!(q.reason.unwrap().contains("Bageriet på Hjørnet"));
    }

    #[test]
    fn answer_teaches_patterns_that_apply_to_old_blocks() {
        let mut st = ObserverState::new();
        let segs = morning(0);
        st.ingest(&segs);
        let mut m = Matcher::new(Catalog::default(), PatternStore::new());
        let q = st.status(&m, T0).question.unwrap();
        let mut cat = Catalog::default();
        cat.clients.push(Client {
            id: "ny".into(),
            name: "Bageriet".into(),
            ..Default::default()
        });
        m.catalog = cat;
        // Før svaret: ingen blokke med mål (navnet står ikke i repoet).
        let before = m.suggest(&segs);
        assert!(before.iter().all(|b| b.target.as_ref().and_then(|t| t.client_id.as_deref()) != Some("ny") || b.confidence < 0.9));
        st.answer(
            &q,
            &ObserverAnswer::Target {
                target: Target::client("ny"),
            },
            &mut m.patterns,
            T0,
        );
        // Bagud: de samme gamle segmenter får nu målet med høj konfidens.
        let after = m.suggest(&segs);
        let work: Vec<_> = after.iter().filter(|b| b.target.is_some()).collect();
        assert!(!work.is_empty());
        assert!(work.iter().all(|b| b.target == Some(Target::client("ny"))));
        // Og der spørges ikke igen.
        assert!(st.status(&m, T0).question.is_none());
        assert_eq!(st.answered, 1);
    }

    #[test]
    fn skip_hides_for_a_while_and_never_forever() {
        let mut st = ObserverState::new();
        st.ingest(&morning(0));
        let mut m = Matcher::new(Catalog::default(), PatternStore::new());
        let q = st.status(&m, T0).question.unwrap();
        st.answer(&q, &ObserverAnswer::Skip, &mut m.patterns, T0);
        assert!(st.status(&m, T0 + 60).question.is_none());
        assert!(st.status(&m, T0 + SKIP_SECS + 1).question.is_some());
        st.answer(&q, &ObserverAnswer::Never, &mut m.patterns, T0);
        assert!(st.status(&m, T0 + 10 * SKIP_SECS).question.is_none());
        assert!(m.patterns.is_empty());
    }

    #[test]
    fn incremental_equals_batch() {
        let segs: Vec<ActivitySegment> = (0..3).flat_map(morning).collect();
        let mut batch = ObserverState::new();
        batch.ingest(&segs);
        let mut inc = ObserverState::new();
        for chunk in segs.chunks(7) {
            inc.ingest(chunk);
        }
        // Åbne spande lukkes ved næste segment; lige efter sidste segment er
        // de ens.
        assert_eq!(batch, inc);
    }

    #[test]
    fn known_sources_are_not_asked_but_shown_in_groups() {
        let mut st = ObserverState::new();
        st.ingest(&morning(0));
        let mut cat = catalog();
        cat.clients[0].domains = vec!["bageriet.dk".into()];
        let m = Matcher::new(cat, PatternStore::new());
        let all = st.groups(&m, true);
        assert!(all.iter().any(|g| g.known && g.sources.iter().any(|s| s.label == "bageriet.dk")));
        // Repoet er stadig ukendt (navnet står ikke som helt ord), så det spørges om alene.
        let q = st.status(&m, T0).question;
        assert!(q.is_none_or(|q| q.sources.iter().all(|s| s.label != "bageriet.dk")));
    }

    #[test]
    fn titles_are_never_stored_whole() {
        let mut st = ObserverState::new();
        st.ingest(&[seg(T0, 30, |s| {
            s.app = "Mail".into();
            s.title = "Tilbud på ny hjemmeside til Jens Hansen fra Bageriet".into();
        })]);
        let json = serde_json::to_string(&st).unwrap();
        assert!(!json.contains("Tilbud på ny"));
        assert!(!json.contains("hjemmeside til"));
    }

    /// Prøve-segmentet skal give nøglen selv igen, ellers bliver en lært
    /// kilde aldrig "kendt", og samme spørgsmål stilles igen og igen.
    #[test]
    fn probe_reproduces_every_kind_of_key() {
        let segs = [
            seg(T0, 10, |s| s.repo_remote = Some("git@github.com:a/b.git".into())),
            seg(T0, 10, |s| s.path = Some("/Users/m/kode/kunde.dk/src/main.rs".into())),
            seg(T0, 10, |s| {
                s.app = "Safari".into();
                s.url = Some("https://admin.shopify.com/store/bph-shop/orders".into());
            }),
            seg(T0, 10, |s| {
                s.app = "Safari".into();
                s.url = Some("https://nlark.dk/wp-admin".into());
            }),
            seg(T0, 10, |s| {
                s.app = "Figma".into();
                s.document = Some("NA forside v3".into());
            }),
            seg(T0, 10, |s| {
                s.app = "zoom.us".into();
                s.title = "Designreview – Nordlys".into();
            }),
            seg(T0, 10, |s| {
                s.app = "Google Chrome".into();
                s.title = "Ordrer · bph-shop 2 · Shopify".into();
            }),
        ];
        for s in &segs {
            for key in keys_for(s) {
                let probe = probe_segment(&key);
                assert!(
                    keys_for(&probe).iter().any(|k| {
                        let mut p = PatternStore::new();
                        p.teach(&key, &Target::client("c"));
                        p.lookup(&probe).is_some_and(|h| h.key == key) || *k == key
                    }),
                    "{key:?} → {:?}",
                    keys_for(&probe)
                );
                let mut p = PatternStore::new();
                p.teach(&key, &Target::client("c"));
                let hit = p.lookup(&probe).expect("lært nøgle findes igen");
                assert_eq!(hit.key, key);
                assert!(hit.strong);
            }
        }
    }

    /// Review P1: et segment over midnat bogførte sekunderne på dag D og
    /// spandene på D+1. Når D blev glemt, fik omnummereringen ikke kilden med
    /// og gik i panik halvvejs.
    #[test]
    fn compaction_survives_segments_over_midnight() {
        let mut st = ObserverState::new();
        let midnight = (T0 / 86_400 + 1) * 86_400;
        st.ingest(&[seg(midnight - 300, 15, |s| {
            s.app = "Safari".into();
            s.url = Some("https://kun-en-gang.dk/".into());
        })]);
        // 14 dage senere: dag D er glemt, D+1 er stadig med.
        st.ingest(&morning(14));
        assert!(!st.days.contains_key(&day_of(midnight - 300)));
        assert!(st.days.contains_key(&day_of(midnight)));
        st.compact_keys();
        // Kildetabellen og tallene passer sammen bagefter.
        let m = Matcher::new(Catalog::default(), PatternStore::new());
        let groups = st.groups(&m, true);
        assert!(groups.iter().any(|g| g.sources.iter().any(|s| s.label == "acme/bageriet-shop")));
        let n = st.key_count() as u32;
        for d in st.days.values() {
            assert!(d.secs.keys().chain(d.buckets.keys()).all(|k| *k < n));
        }
        // Og der tælles videre på de nye id'er.
        st.ingest(&morning(15));
        assert!(st.status(&m, T0 + 16 * 86_400).question.is_some());
    }

    /// Review P2: får gruppen en ny kilde, skifter id'et, så et svar på den
    /// gamle gruppe ikke lærer den nye kilde.
    #[test]
    fn group_id_changes_with_members() {
        let mut st = ObserverState::new();
        st.ingest(&morning(0));
        let m = Matcher::new(Catalog::default(), PatternStore::new());
        let before = st.status(&m, T0).question.unwrap();
        // Et nyt domæne med samme ord kommer med i gruppen.
        let base = T0 + 86_400;
        st.ingest(&[seg(base, 30, |s| {
            s.app = "Safari".into();
            s.url = Some("https://bageriet-admin.dk/".into());
        })]);
        let after = st.status(&m, base + 3600).question.unwrap();
        assert_eq!(after.sources[0].key, before.sources[0].key);
        assert!(after.sources.len() > before.sources.len());
        assert_ne!(after.id, before.id);
    }

    #[test]
    fn distinctive_words_fold_and_filter() {
        assert_eq!(distinctive_words("Bageriet-på-Hjørnet shop 2026"), vec!["bageriet", "hjoernet"]);
        assert!(distinctive_words("main src website").is_empty());
    }
}
