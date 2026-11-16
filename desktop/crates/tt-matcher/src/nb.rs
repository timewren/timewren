//! Naive Bayes pr. bruger: et lag for de svage signaler.
//!
//! Kaskaden (regler → identitet → mønstre → navne) kender kun hele nøgler. Når
//! ingen nøgle er sikker, ligger der stadig information i mange svage
//! signaler tilsammen: ord i titlen, domænet, programmet, mappernes navne på
//! alle niveauer, repoets ejer, ugedag og tid på dagen. Naive Bayes lægger dem
//! sammen og lærer af hver bekræftelse og rettelse.
//!
//! - **Klasser** er kunder plus "anden" ([`OTHER`]): et signal, ingen kendt
//!   kunde har set, peger mod "anden" i stedet for at tvinge et gæt, og det,
//!   brugeren afviser som ikke arbejde, læres som "anden". Projektet vælges
//!   inden for kunden af en mindre model pr. kunde.
//! - **Gruppevægte** ([`group_weight`]): tolv titelord må ikke overdøve én
//!   mappe. Hver gruppes bidrag deles med kvadratroden af antallet af træk.
//! - **Faste titler:** et program, hvis titel næsten aldrig skifter (Orca,
//!   Spark), giver ingen titelord; dets mappe bærer signalet ([`AppTitles`]).
//! - **Kalibrering:** posterioren temperaturskaleres; temperaturen læres
//!   online af de seneste svar ([`NaiveBayes::fit_temperature`]).
//! - **Forklaring:** de tre features, der bidrager mest til log-odds mod
//!   nummer to ([`Prediction::because`]).
//! - **Privatliv:** ord fra titler og dokumenter gemmes kun som hash (FNV-1a),
//!   aldrig som tekst, og bruges først, når de er set på mindst
//!   [`MIN_TOKEN_DAYS`] dage. Modellen bliver på maskinen.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::learning::{PatternKey, SERVICE_NAMES, keys_for};
use crate::normalize::{
    Fold, clean_title, fold_danish, normalize_app, normalize_repo_remote, normalize_text,
    path_components, repo_owner_and_name, segment_host,
};
use crate::types::ActivitySegment;

/// Klassen for "en kunde, modellen ikke kender" (og ikke arbejde).
pub const OTHER: &str = "";
/// Lidstone-udglatning.
const ALPHA: f64 = 0.5;
/// Et titel- eller dokumentord bruges først, når det er set så mange dage.
pub const MIN_TOKEN_DAYS: u16 = 2;
/// Så mange titler pr. program huskes (som hash) til entropien.
const MAX_TITLES: usize = 24;
/// Et program med højst så mange forskellige titler har "fast titel".
const FIXED_TITLE_MAX: usize = 2;
/// … når det er set mindst så mange gange.
const FIXED_TITLE_MIN_SEEN: u32 = 12;
/// Så mange træningseksempler gemmes til temperaturen.
const MAX_SAMPLES: usize = 300;

/// Featuregruppe (bestemt af featurens forstavelse).
fn group_of(feature: &str) -> &str {
    feature.split_once(':').map_or("", |(g, _)| g)
}

/// Vægten pr. gruppe. Signalerne, der identificerer arbejdet (repo, mappe,
/// domæne), vejer mest; kontekst (tid, ugedag) mindst.
pub fn group_weight(group: &str) -> f64 {
    match group {
        "r" | "ro" => 1.5,
        "p" => 1.2,
        "pc" => 0.8,
        "d" | "d2" => 1.0,
        "t" => 0.6,
        "doc" => 0.7,
        "a" => 0.3,
        "wd" | "h" => 0.15,
        _ => 0.5,
    }
}

/// FNV-1a 64 bit: stabil på tværs af versioner og platforme (modellen gemmes).
fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Ord fra en tekst: normaliseret, foldet, mindst 3 tegn, uden tal og uden
/// tjenesters navne.
fn words(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in fold_danish(&normalize_text(text), Fold::Double).split(' ') {
        if w.chars().count() < 3
            || w.chars().any(|c| c.is_ascii_digit())
            || SERVICE_NAMES.contains(&w)
            || STOP.contains(&w)
        {
            continue;
        }
        if !out.iter().any(|o| o == w) {
            out.push(w.to_string());
        }
    }
    out
}

/// Ord uden indhold i titler.
const STOP: &[&str] = &[
    "the",
    "and",
    "for",
    "med",
    "til",
    "fra",
    "som",
    "der",
    "det",
    "den",
    "har",
    "kan",
    "new",
    "tab",
    "fane",
    "untitled",
    "google",
    "chrome",
    "microsoft",
    "edge",
    "vivaldi",
    "safari",
    "firefox",
    "opera",
    "brave",
    "arc",
    "mail",
    "inbox",
    "indbakke",
    "www",
    "http",
    "https",
];

/// Antal set og de forskellige titler (hash) pr. program.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AppTitles {
    pub seen: u32,
    pub titles: Vec<String>,
}

impl AppTitles {
    /// Titlen siger intet: programmet har næsten altid samme titel.
    pub fn fixed(&self) -> bool {
        self.seen >= FIXED_TITLE_MIN_SEEN && self.titles.len() <= FIXED_TITLE_MAX
    }
}

/// Støtte for en feature: hvor mange dage den er set, og senest hvornår.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Support {
    pub days: u16,
    pub last_day: i64,
}

/// Ét træningseksempel til temperaturen: rå scorer og den rigtige klasse.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    pub scores: Vec<f32>,
    pub truth: usize,
}

/// Modellen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NaiveBayes {
    /// feature → klasse → vægt.
    pub counts: BTreeMap<String, BTreeMap<String, f32>>,
    /// Klassens samlede featurevægt pr. gruppe.
    pub totals: BTreeMap<String, BTreeMap<String, f32>>,
    /// Klassens samlede træningsvægt (prior).
    pub prior: BTreeMap<String, f32>,
    #[serde(default)]
    pub support: BTreeMap<String, Support>,
    #[serde(default)]
    pub apps: BTreeMap<String, AppTitles>,
    #[serde(default)]
    pub samples: Vec<Sample>,
    pub temperature: f32,
    /// Antal forskellige træk pr. gruppe (føres løbende, så et opslag ikke
    /// skal tælle hele modellen).
    #[serde(default)]
    pub vocab: BTreeMap<String, f64>,
}

/// Over så mange træk beskæres modellen: træk set på én dag for over
/// [`PRUNE_AFTER_DAYS`] dage siden fjernes.
pub const MAX_FEATURES: usize = 40_000;
pub const PRUNE_AFTER_DAYS: i64 = 30;

impl Default for NaiveBayes {
    fn default() -> Self {
        Self {
            counts: BTreeMap::new(),
            totals: BTreeMap::new(),
            prior: BTreeMap::new(),
            support: BTreeMap::new(),
            apps: BTreeMap::new(),
            samples: Vec::new(),
            temperature: 1.0,
            vocab: BTreeMap::new(),
        }
    }
}

/// En forudsigelse: klasser med sandsynlighed (højeste først) og forklaring.
#[derive(Debug, Clone, PartialEq)]
pub struct Prediction {
    pub probs: Vec<(String, f32)>,
    /// De tre største bidrag til log-odds for nr. 1 mod nr. 2: (dansk etiket, bidrag).
    pub because: Vec<(String, f32)>,
}

impl Prediction {
    pub fn best(&self) -> Option<(&str, f32)> {
        self.probs.first().map(|(c, p)| (c.as_str(), *p))
    }

    pub fn prob(&self, class: &str) -> f32 {
        self.probs
            .iter()
            .find(|(c, _)| c == class)
            .map_or(0.0, |(_, p)| *p)
    }
}

/// Dansk etiket for en feature til "foreslået fordi …". Hashede ord kan ikke
/// vises, så de bliver "et ord i titlen".
pub fn feature_label(feature: &str) -> String {
    let (g, v) = feature.split_once(':').unwrap_or(("", feature));
    match g {
        "r" => format!("repoet {v}"),
        "ro" => format!("repo-ejeren {v}"),
        "p" => format!("mappen {v}"),
        "pc" => format!("mappenavnet {v}"),
        "d" | "d2" => format!("domænet {v}"),
        "t" => "et ord i titlen".to_string(),
        "doc" => "et ord i dokumentnavnet".to_string(),
        "a" => format!("programmet {v}"),
        "wd" => "ugedagen".to_string(),
        "h" => "tidspunktet".to_string(),
        _ => v.to_string(),
    }
}

impl NaiveBayes {
    pub fn new() -> Self {
        Self::default()
    }

    /// Klasserne, modellen har lært (uden "anden").
    pub fn classes(&self) -> Vec<&str> {
        self.prior
            .keys()
            .map(String::as_str)
            .filter(|c| !c.is_empty())
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.classes().is_empty()
    }

    fn app_key(seg: &ActivitySegment) -> String {
        normalize_app(&seg.app)
    }

    /// Segmentets features (med hash for ord fra titel og dokument).
    pub fn features(&self, seg: &ActivitySegment) -> Vec<String> {
        let mut f: Vec<String> = Vec::new();
        let app = Self::app_key(seg);
        f.push(format!("a:{app}"));
        let fixed = self.apps.get(&app).is_some_and(AppTitles::fixed);
        if !fixed {
            let title = clean_title(&seg.app, &seg.title);
            let app_words = words(&seg.app);
            for w in words(&title).into_iter().filter(|w| !app_words.contains(w)) {
                f.push(format!("t:{}", fnv(&w)));
            }
        }
        if let Some(doc) = seg.document.as_deref() {
            for w in words(doc) {
                f.push(format!("doc:{}", fnv(&w)));
            }
        }
        if let Some(host) = segment_host(seg.domain.as_deref(), seg.url.as_deref()) {
            let labels: Vec<&str> = host.split('.').collect();
            if labels.len() > 2 {
                f.push(format!("d2:{}", labels[labels.len() - 2..].join(".")));
            }
            f.push(format!("d:{host}"));
        }
        if let Some(remote) = seg.repo_remote.as_deref().filter(|r| !r.trim().is_empty()) {
            let norm = normalize_repo_remote(remote);
            if let (Some(owner), _) = repo_owner_and_name(&norm) {
                f.push(format!("ro:{owner}"));
            }
            f.push(format!("r:{norm}"));
        }
        for key in keys_for(seg) {
            match key {
                // Domænenøglen på kodeværter har ejer/repo (`github.com/acme/web`).
                PatternKey::Domain { domain } if domain.contains('/') => {
                    f.push(format!("d:{domain}"))
                }
                PatternKey::Path { path } => f.push(format!("p:{path}")),
                _ => {}
            }
        }
        if let Some(path) = seg.path.as_deref() {
            for c in path_components(path) {
                f.push(format!("pc:{c}"));
            }
        }
        // Kontekst: ugedag og tid på dagen (3-timers spande, UTC).
        let day = seg.start.div_euclid(86_400);
        f.push(format!("wd:{}", (day + 3).rem_euclid(7)));
        f.push(format!("h:{}", seg.start.rem_euclid(86_400) / 10_800));
        f.sort();
        f.dedup();
        f
    }

    /// Kan featuren bruges? Ord skal være set på flere dage.
    fn usable(&self, feature: &str) -> bool {
        match group_of(feature) {
            "t" | "doc" => self
                .support
                .get(feature)
                .is_some_and(|s| s.days >= MIN_TOKEN_DAYS),
            _ => true,
        }
    }

    /// Registrerer programmets titel (til "fast titel"). Kaldes for alle
    /// segmenter, også dem uden svar.
    pub fn observe_title(&mut self, seg: &ActivitySegment) {
        let app = Self::app_key(seg);
        let t = self.apps.entry(app).or_default();
        t.seen = t.seen.saturating_add(1);
        let h = fnv(&clean_title(&seg.app, &seg.title));
        if t.titles.len() < MAX_TITLES && !t.titles.contains(&h) {
            t.titles.push(h);
        }
    }

    /// Lærer ét segment med klassen `class` (kunde-id eller [`OTHER`]) og
    /// vægten `weight` (fx 1,0 for bekræft, 1,5 for ret).
    pub fn learn(&mut self, seg: &ActivitySegment, class: &str, weight: f32) {
        if weight <= 0.0 || seg.duration() <= 0 {
            return;
        }
        // Lange segmenter må ikke dominere: kvadratroden af minutterne (højst 10).
        let w = weight * ((seg.duration().min(600) as f32 / 60.0).sqrt());
        let day = seg.start.div_euclid(86_400);
        let feats = self.features(seg);
        // Til temperaturen: hvad sagde modellen, før den lærte?
        if self.classes().len() >= 2 {
            let (classes, scores, _) = self.scores(&feats);
            if let Some(truth) = classes.iter().position(|c| c == class) {
                self.samples.push(Sample {
                    scores: scores.iter().map(|s| *s as f32).collect(),
                    truth,
                });
                if self.samples.len() > MAX_SAMPLES {
                    let extra = self.samples.len() - MAX_SAMPLES;
                    self.samples.drain(..extra);
                }
            }
        }
        for f in &feats {
            if !self.counts.contains_key(f) {
                *self.vocab.entry(group_of(f).to_string()).or_default() += 1.0;
            }
            *self
                .counts
                .entry(f.clone())
                .or_default()
                .entry(class.to_string())
                .or_default() += w;
            *self
                .totals
                .entry(class.to_string())
                .or_default()
                .entry(group_of(f).to_string())
                .or_default() += w;
            let s = self.support.entry(f.clone()).or_default();
            if s.days == 0 || s.last_day != day {
                s.days = s.days.saturating_add(1);
                s.last_day = day;
            }
        }
        *self.prior.entry(class.to_string()).or_default() += w;
        if self.counts.len() > MAX_FEATURES {
            self.prune(day);
        }
    }

    /// Fjerner træk, der kun er set én dag, og som er gamle. Klassernes
    /// totaler trækkes tilsvarende ned.
    fn prune(&mut self, today: i64) {
        let old: Vec<String> = self
            .support
            .iter()
            .filter(|(_, s)| s.days <= 1 && today - s.last_day > PRUNE_AFTER_DAYS)
            .map(|(f, _)| f.clone())
            .collect();
        for f in old {
            if let Some(per_class) = self.counts.remove(&f) {
                let g = group_of(&f).to_string();
                for (c, w) in per_class {
                    if let Some(t) = self.totals.get_mut(&c).and_then(|m| m.get_mut(&g)) {
                        *t = (*t - w).max(0.0);
                    }
                }
                if let Some(v) = self.vocab.get_mut(&g) {
                    *v = (*v - 1.0).max(0.0);
                }
            }
            self.support.remove(&f);
        }
    }

    /// Antal forskellige features pr. gruppe (til udglatningen).
    fn vocabulary(&self) -> BTreeMap<&str, f64> {
        if !self.vocab.is_empty() || self.counts.is_empty() {
            return self.vocab.iter().map(|(g, n)| (g.as_str(), *n)).collect();
        }
        // En model gemt før `vocab` blev ført: tæl én gang.
        let mut v: BTreeMap<&str, f64> = BTreeMap::new();
        for f in self.counts.keys() {
            *v.entry(group_of(f)).or_default() += 1.0;
        }
        v
    }

    /// Rå log-scorer pr. klasse (klasserne + "anden" sidst) og de enkelte
    /// features' bidrag pr. klasse.
    #[allow(clippy::type_complexity)]
    fn scores(&self, feats: &[String]) -> (Vec<String>, Vec<f64>, Vec<Vec<(String, f64)>>) {
        let mut classes: Vec<String> = self.classes().iter().map(|c| c.to_string()).collect();
        classes.push(OTHER.to_string());
        let vocab = self.vocabulary();
        let total_prior: f64 = self
            .prior
            .values()
            .map(|v| f64::from(*v))
            .sum::<f64>()
            .max(1.0);
        // Hvor mange brugbare træk pr. gruppe (til √n-dæmpningen).
        // Kendte træk, og usete identificerende træk (domæne, repo-remote): et
        // domæne, ingen kunde har set, er bevis for noget nyt ("anden"). En uset
        // mappe er det ikke: en ny worktree eller gren har altid en ny sti, men
        // kundemappen over den kan være kendt.
        let usable: Vec<&String> = feats
            .iter()
            .filter(|f| {
                if self.counts.contains_key(*f) {
                    self.usable(f)
                } else {
                    matches!(group_of(f), "d" | "r")
                }
            })
            .collect();
        let mut per_group: BTreeMap<&str, f64> = BTreeMap::new();
        for f in &usable {
            *per_group.entry(group_of(f)).or_default() += 1.0;
        }
        let mut scores = Vec::with_capacity(classes.len());
        let mut parts = Vec::with_capacity(classes.len());
        for c in &classes {
            // "Anden" har en fast lille prior og ingen lært fordeling: hvert
            // træk er "uset" for den.
            // "Anden" har mindst en lille prior, også før den har lært noget.
            let learned = f64::from(*self.prior.get(c).unwrap_or(&0.0));
            let prior = if c.is_empty() {
                learned.max((0.1 * total_prior).max(1.0))
            } else {
                learned
            };
            let mut s = 0.5 * (prior / total_prior).ln();
            let mut contrib = Vec::new();
            for f in &usable {
                let g = group_of(f);
                let v = *vocab.get(g).unwrap_or(&0.0) + 1.0;
                let n_fc = self
                    .counts
                    .get(*f)
                    .and_then(|m| m.get(c))
                    .map_or(0.0, |x| f64::from(*x));
                let n_c = self
                    .totals
                    .get(c)
                    .and_then(|m| m.get(g))
                    .map_or(0.0, |x| f64::from(*x));
                // "Anden" (og ikke arbejde, lært af Afvis) er aldrig mindre
                // sandsynlig end et uset træk: et signal, ingen kunde kender,
                // trækker mod den.
                let lp = if c.is_empty() {
                    ((n_fc + ALPHA) / (n_c + ALPHA * v)).max(1.0 / v).ln()
                } else {
                    ((n_fc + ALPHA) / (n_c + ALPHA * v)).ln()
                };
                let w = group_weight(g) / per_group[g].sqrt();
                s += w * lp;
                contrib.push(((*f).clone(), w * lp));
            }
            scores.push(s);
            parts.push(contrib);
        }
        (classes, scores, parts)
    }

    /// Sandsynlighed pr. klasse for ét segment. `None`, før modellen kender
    /// mindst én kunde, eller når segmentet intet brugbart træk har.
    pub fn predict(&self, seg: &ActivitySegment) -> Option<Prediction> {
        if self.is_empty() {
            return None;
        }
        let feats = self.features(seg);
        let (classes, scores, parts) = self.scores(&feats);
        if parts.first().is_none_or(Vec::is_empty) {
            return None;
        }
        let probs = softmax(&scores, f64::from(self.temperature));
        let mut order: Vec<usize> = (0..classes.len()).collect();
        order.sort_by(|a, b| {
            probs[*b]
                .total_cmp(&probs[*a])
                .then(classes[*a].cmp(&classes[*b]))
        });
        let because = match (order.first(), order.get(1)) {
            (Some(&a), Some(&b)) => {
                let mut diff: Vec<(String, f32)> = parts[a]
                    .iter()
                    .zip(&parts[b])
                    .map(|((f, x), (_, y))| (f.clone(), (x - y) as f32))
                    .filter(|(_, d)| *d > 0.0)
                    .collect();
                diff.sort_by(|x, y| y.1.total_cmp(&x.1).then(x.0.cmp(&y.0)));
                let mut out: Vec<(String, f32)> = Vec::new();
                for (f, d) in diff {
                    let label = feature_label(&f);
                    if !out.iter().any(|(l, _)| *l == label) {
                        out.push((label, d));
                    }
                    if out.len() == 3 {
                        break;
                    }
                }
                out
            }
            _ => Vec::new(),
        };
        Some(Prediction {
            probs: order
                .iter()
                .map(|&i| (classes[i].clone(), probs[i] as f32))
                .collect(),
            because,
        })
    }

    /// Temperaturen, der giver de seneste svar størst sandsynlighed (gitter).
    /// Naive Bayes er overmodig, fordi trækkene ikke er uafhængige; en
    /// temperatur over 1 gør den ærlig.
    pub fn fit_temperature(&mut self) {
        if self.samples.len() < 30 {
            return;
        }
        const GRID: &[f64] = &[
            0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 16.0, 24.0,
        ];
        let nll = |t: f64| -> f64 {
            self.samples
                .iter()
                .map(|s| {
                    let scores: Vec<f64> = s.scores.iter().map(|x| f64::from(*x)).collect();
                    let p = softmax(&scores, t);
                    -(p.get(s.truth).copied().unwrap_or(1e-9).max(1e-9)).ln()
                })
                .sum()
        };
        let best = GRID
            .iter()
            .copied()
            .min_by(|a, b| nll(*a).total_cmp(&nll(*b)))
            .unwrap_or(1.0);
        self.temperature = best as f32;
    }
}

fn softmax(scores: &[f64], t: f64) -> Vec<f64> {
    let t = t.max(1e-3);
    let m = scores.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let e: Vec<f64> = scores.iter().map(|s| ((s - m) / t).exp()).collect();
    let z: f64 = e.iter().sum::<f64>().max(1e-300);
    e.into_iter().map(|x| x / z).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(
        app: &str,
        title: &str,
        url: Option<&str>,
        path: Option<&str>,
        day: i64,
    ) -> ActivitySegment {
        ActivitySegment {
            app: app.into(),
            title: title.into(),
            url: url.map(str::to_string),
            path: path.map(str::to_string),
            start: day * 86_400 + 9 * 3600,
            end: day * 86_400 + 9 * 3600 + 300,
            ..Default::default()
        }
    }

    #[test]
    fn words_are_hashed_never_stored_as_text() {
        let mut nb = NaiveBayes::new();
        let s = seg(
            "chrome",
            "Ansættelseskontrakt Jens Hansen – Google Docs",
            None,
            None,
            0,
        );
        nb.learn(&s, "c1", 1.0);
        let json = serde_json::to_string(&nb).unwrap();
        for w in [
            "jens",
            "hansen",
            "ansaettelseskontrakt",
            "Ansættelseskontrakt",
        ] {
            assert!(!json.to_lowercase().contains(w), "{w} i {json}");
        }
    }

    #[test]
    fn learns_folders_and_domains_and_explains() {
        let mut nb = NaiveBayes::new();
        for day in 0..3 {
            nb.learn(
                &seg(
                    "Orca",
                    "Orca",
                    None,
                    Some(r"C:\Projects\Freelance\hansen-vvs\web"),
                    day,
                ),
                "hvvs",
                1.0,
            );
            nb.learn(
                &seg(
                    "vivaldi",
                    "Sider",
                    Some("https://hansen-vvs.dk/wp-admin"),
                    None,
                    day,
                ),
                "hvvs",
                1.0,
            );
            nb.learn(
                &seg(
                    "vivaldi",
                    "Dashboard",
                    Some("https://kofoedvvs.dk/"),
                    None,
                    day,
                ),
                "kofoed",
                1.0,
            );
        }
        // Et nyt repo i Hansens kundemappe.
        let p = nb
            .predict(&seg(
                "Orca",
                "Orca",
                None,
                Some(r"C:\Projects\Freelance\hansen-vvs\booking"),
                5,
            ))
            .unwrap();
        assert_eq!(p.best().unwrap().0, "hvvs", "{p:?}");
        assert!(
            p.because.iter().any(|(l, _)| l.contains("hansen-vvs")),
            "{:?}",
            p.because
        );
        // Noget helt ukendt peger mod "anden".
        let p = nb
            .predict(&seg(
                "vivaldi",
                "x",
                Some("https://ukendt.example/"),
                None,
                5,
            ))
            .unwrap();
        assert_eq!(p.best().unwrap().0, OTHER, "{p:?}");
    }

    #[test]
    fn fixed_titles_are_ignored() {
        let mut nb = NaiveBayes::new();
        for i in 0..20 {
            nb.observe_title(&seg("Orca", "Orca", None, Some(&format!("/p/{i}")), 0));
        }
        let f = nb.features(&seg("Orca", "Orca hansen", None, None, 0));
        assert!(!f.iter().any(|x| x.starts_with("t:")), "{f:?}");
        // Et program med skiftende titler giver titelord.
        let f = nb.features(&seg("vivaldi", "Hansen VVS – Forside", None, None, 0));
        assert!(f.iter().any(|x| x.starts_with("t:")), "{f:?}");
    }

    #[test]
    fn title_words_need_two_days() {
        let mut nb = NaiveBayes::new();
        nb.learn(
            &seg("vivaldi", "Kofoed driftsstatus", None, None, 0),
            "kofoed",
            1.0,
        );
        nb.learn(
            &seg("vivaldi", "Bageriet ordrer", None, None, 0),
            "bph",
            1.0,
        );
        let one_day = nb
            .predict(&seg("vivaldi", "Kofoed driftsstatus", None, None, 3))
            .unwrap();
        nb.learn(
            &seg("vivaldi", "Kofoed driftsstatus", None, None, 1),
            "kofoed",
            1.0,
        );
        let two_days = nb
            .predict(&seg("vivaldi", "Kofoed driftsstatus", None, None, 3))
            .unwrap();
        assert!(two_days.prob("kofoed") > one_day.prob("kofoed"));
    }

    #[test]
    fn old_single_day_features_are_pruned() {
        let mut nb = NaiveBayes::new();
        nb.learn(
            &seg("vivaldi", "x", Some("https://gammel.example/"), None, 0),
            "a",
            1.0,
        );
        assert!(nb.counts.contains_key("d:gammel.example"));
        let total = nb.totals["a"]["d"];
        nb.prune(100);
        assert!(!nb.counts.contains_key("d:gammel.example"));
        assert!(nb.totals["a"]["d"] < total);
        assert_eq!(nb.vocab.get("d").copied().unwrap_or(0.0), 0.0);
    }

    #[test]
    fn temperature_is_learned_and_deterministic() {
        let mut nb = NaiveBayes::new();
        for day in 0..40 {
            // Støj: samme domæne er halvdelen af tiden en anden kunde.
            let c = if day % 2 == 0 { "a" } else { "b" };
            nb.learn(
                &seg("vivaldi", "x", Some("https://delt.example/"), None, day),
                c,
                1.0,
            );
            nb.learn(
                &seg("vivaldi", "y", Some("https://a.example/"), None, day),
                "a",
                1.0,
            );
        }
        nb.fit_temperature();
        let t = nb.temperature;
        let mut again = nb.clone();
        again.fit_temperature();
        assert_eq!(t, again.temperature);
        let p = nb
            .predict(&seg(
                "vivaldi",
                "x",
                Some("https://delt.example/"),
                None,
                50,
            ))
            .unwrap();
        assert!(p.best().unwrap().1 < 0.9, "{p:?}");
    }
}
