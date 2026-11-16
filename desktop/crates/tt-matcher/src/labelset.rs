//! Labelset og præcisionsmåling.
//!
//! Et labelset er JSON: et katalog, eventuelt lærte mønstre, og segmenter
//! med det rigtige svar (`expected`). `expected: null` betyder "ikke arbejde"
//! (må ikke foreslås). Se `testdata/syntetisk.json` for et eksempel.
//!
//! Målingen er tidsvægtet ("rigtig kunde X % af tiden"):
//! - **kundetræf** = tid hvor forslagets kunde er den rigtige / al tid med en rigtig kunde;
//! - **projekttræf** = det samme for projekter (kun segmenter med et rigtigt projekt);
//! - pr. kunde og projekt: **præcision** (rigtigt foreslået tid / foreslået tid)
//!   og **dækning** (rigtigt foreslået tid / rigtig tid);
//! - **falske forslag**: tid, der ikke er arbejde, men blev foreslået.
//!
//! Uklare blokke tæller som ikke-foreslået.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

use crate::learning::PatternStore;
use crate::matcher::{MatchConfig, Matcher};
use crate::metrics::{self, Outcome, RcPoint};
use crate::types::{ActivitySegment, Catalog, Suggestion, Target};

/// Et segment med det rigtige svar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabeledSegment {
    #[serde(flatten)]
    pub segment: ActivitySegment,
    /// `None` = ikke arbejde.
    pub expected: Option<Target>,
    /// Hvilket svært tilfælde segmentet tester (til rapporten).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub case: Option<String>,
}

/// Hele labelsettet.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Labelset {
    #[serde(default)]
    pub name: String,
    pub catalog: Catalog,
    #[serde(default)]
    pub patterns: PatternStore,
    pub segments: Vec<LabeledSegment>,
}

/// Træf for én kunde eller ét projekt (sekunder).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    pub name: String,
    /// Rigtig tid (labelset).
    pub expected_secs: i64,
    /// Foreslået tid.
    pub predicted_secs: i64,
    /// Foreslået og rigtig.
    pub correct_secs: i64,
}

impl Score {
    pub fn precision(&self) -> Option<f64> {
        (self.predicted_secs > 0).then(|| self.correct_secs as f64 / self.predicted_secs as f64)
    }

    pub fn recall(&self) -> Option<f64> {
        (self.expected_secs > 0).then(|| self.correct_secs as f64 / self.expected_secs as f64)
    }
}

/// Resultatet af en måling.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub segments: usize,
    pub suggestions: usize,
    pub unclear_suggestions: usize,
    /// Tid med en rigtig kunde.
    pub client_secs: i64,
    pub client_correct_secs: i64,
    /// Tid med et rigtigt projekt.
    pub project_secs: i64,
    pub project_correct_secs: i64,
    /// Tid med en rigtig kunde, der fik et forslag (ikke uklart).
    pub client_suggested_secs: i64,
    /// Tid, der ikke er arbejde, men blev foreslået.
    pub false_suggestion_secs: i64,
    pub not_work_secs: i64,
    pub per_client: BTreeMap<String, Score>,
    pub per_project: BTreeMap<String, Score>,
    /// Kundetræf pr. svært tilfælde (`case`).
    pub per_case: BTreeMap<String, Score>,
    /// Hvert foreslået segment med en rigtig kunde (til risk-coverage og ECE).
    #[serde(skip)]
    pub outcomes: Vec<Outcome>,
}

impl Report {
    /// Andel af kundetiden med rigtig kunde.
    pub fn client_accuracy(&self) -> f64 {
        ratio(self.client_correct_secs, self.client_secs)
    }

    /// Andel af projekttiden med rigtigt projekt.
    pub fn project_accuracy(&self) -> f64 {
        ratio(self.project_correct_secs, self.project_secs)
    }

    /// Andel af foreslået kundetid, der var rigtig.
    pub fn client_precision(&self) -> f64 {
        ratio(self.client_correct_secs, self.client_suggested_secs)
    }

    /// Lægger en anden rapport til (fx flere dage).
    pub fn add(&mut self, other: &Report) {
        self.segments += other.segments;
        self.suggestions += other.suggestions;
        self.unclear_suggestions += other.unclear_suggestions;
        self.client_secs += other.client_secs;
        self.client_correct_secs += other.client_correct_secs;
        self.project_secs += other.project_secs;
        self.project_correct_secs += other.project_correct_secs;
        self.client_suggested_secs += other.client_suggested_secs;
        self.false_suggestion_secs += other.false_suggestion_secs;
        self.not_work_secs += other.not_work_secs;
        self.outcomes.extend_from_slice(&other.outcomes);
        for (mine, theirs) in [
            (&mut self.per_client, &other.per_client),
            (&mut self.per_project, &other.per_project),
            (&mut self.per_case, &other.per_case),
        ] {
            for (k, v) in theirs {
                let e = mine.entry(k.clone()).or_insert_with(|| Score {
                    name: v.name.clone(),
                    ..Default::default()
                });
                e.expected_secs += v.expected_secs;
                e.predicted_secs += v.predicted_secs;
                e.correct_secs += v.correct_secs;
            }
        }
    }

    /// Risk-coverage-kurven for kunden.
    pub fn rc_curve(&self) -> Vec<RcPoint> {
        metrics::rc_curve(&self.outcomes, self.client_secs)
    }

    /// Største kundedækning med præcision ≥ `goal` og tærsklen, der giver den.
    pub fn coverage_at(&self, goal: f64) -> (f64, f32) {
        metrics::coverage_at(&self.rc_curve(), goal)
    }

    /// Kalibreringen i tal: (AURC, ECE med 10 spande, Brier).
    pub fn calibration(&self) -> (f64, f64, f64) {
        (
            metrics::aurc(&self.rc_curve()),
            metrics::ece(&self.outcomes, 10),
            metrics::brier(&self.outcomes),
        )
    }

    /// Risk-coverage-kurven og kalibreringskurven som tekst.
    pub fn render_curves(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "Risk-coverage (kunde, tidsvægtet):");
        let _ = writeln!(out, "{:>8} {:>9} {:>10}", "tærskel", "dækning", "præcision");
        let curve = self.rc_curve();
        // Højst ét punkt pr. 0,05 i tærskel, så tabellen kan læses.
        let mut last = f32::INFINITY;
        for (i, p) in curve.iter().enumerate() {
            if last - p.threshold >= 0.05 || i + 1 == curve.len() {
                let _ = writeln!(
                    out,
                    "{:>8.2} {:>7.1} % {:>8.1} %",
                    p.threshold,
                    p.coverage * 100.0,
                    p.precision * 100.0
                );
                last = p.threshold;
            }
        }
        let _ = writeln!(out, "\nKalibrering (10 spande med lige meget tid):");
        let _ = writeln!(out, "{:>8} {:>10} {:>8}", "tid", "konfidens", "træf");
        for b in metrics::reliability(&self.outcomes, 10) {
            let _ = writeln!(
                out,
                "{:>6.1} % {:>8.1} % {:>6.1} %",
                b.weight * 100.0,
                b.confidence * 100.0,
                b.accuracy * 100.0
            );
        }
        out
    }

    /// Tekstrapport på dansk.
    pub fn render(&self) -> String {
        let pct = |x: Option<f64>| {
            x.map(|v| format!("{:5.1} %", v * 100.0))
                .unwrap_or_else(|| "    - ".into())
        };
        let mut out = String::new();
        let _ = writeln!(
            out,
            "Segmenter: {}  Forslag: {} (uklare: {})",
            self.segments, self.suggestions, self.unclear_suggestions
        );
        let _ = writeln!(
            out,
            "Kundetræf:    {} af tiden",
            pct(Some(self.client_accuracy()))
        );
        let _ = writeln!(
            out,
            "Projekttræf:  {} af tiden",
            pct(Some(self.project_accuracy()))
        );
        let _ = writeln!(
            out,
            "Kundepræcision (af foreslået tid): {}",
            pct(Some(self.client_precision()))
        );
        let _ = writeln!(
            out,
            "Ikke arbejde foreslået: {} min af {} min",
            self.false_suggestion_secs / 60,
            self.not_work_secs / 60
        );
        let (c90, t90) = self.coverage_at(0.9);
        let (c80, t80) = self.coverage_at(0.8);
        let (aurc, ece, brier) = self.calibration();
        let _ = writeln!(
            out,
            "Dækning ved præcision ≥ 90 %: {:5.1} % (tærskel {t90:.2}); ≥ 80 %: {:5.1} % (tærskel {t80:.2})",
            c90 * 100.0,
            c80 * 100.0
        );
        let _ = writeln!(
            out,
            "AURC: {aurc:.3}  ECE: {ece:.3}  Brier: {brier:.3}"
        );
        for (title, map) in [("Kunde", &self.per_client), ("Projekt", &self.per_project)] {
            let _ = writeln!(
                out,
                "\n{title:<34} {:>8} {:>8} {:>9} {:>9}",
                "rigtig", "foresl.", "præcision", "dækning"
            );
            for s in map.values() {
                let _ = writeln!(
                    out,
                    "{:<34} {:>6} m {:>6} m {:>9} {:>9}",
                    truncate(&s.name, 34),
                    s.expected_secs / 60,
                    s.predicted_secs / 60,
                    pct(s.precision()),
                    pct(s.recall())
                );
            }
        }
        let _ = writeln!(out, "\n{:<34} {:>8} {:>9}", "Svært tilfælde", "tid", "træf");
        for s in self.per_case.values() {
            let _ = writeln!(
                out,
                "{:<34} {:>6} m {:>9}",
                truncate(&s.name, 34),
                s.expected_secs / 60,
                pct(s.recall())
            );
        }
        out
    }
}

fn ratio(a: i64, b: i64) -> f64 {
    if b == 0 { 1.0 } else { a as f64 / b as f64 }
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n - 1).chain(['…']).collect()
    }
}

/// Forslaget og dets konfidens for hvert segment (eller `None`).
fn predictions(segments: usize, suggestions: &[Suggestion]) -> Vec<(Option<Target>, f32)> {
    let mut out = vec![(None, 0.0); segments];
    for s in suggestions {
        for &i in &s.segment_indices {
            if i < segments {
                out[i] = (s.target.clone(), s.confidence);
            }
        }
    }
    out
}

/// Scorer forslag mod labels.
pub fn score(catalog: &Catalog, labeled: &[LabeledSegment], suggestions: &[Suggestion]) -> Report {
    let with_conf = predictions(labeled.len(), suggestions);
    let predicted: Vec<Option<Target>> = with_conf.iter().map(|(t, _)| t.clone()).collect();
    let client_name = |id: &str| {
        catalog
            .client(id)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| id.to_string())
    };
    // "Kunde / Projekt", for to kunder kan have hvert sit "Website".
    let project_name = |id: &str| match catalog.project(id) {
        Some(p) => catalog.describe(&Target::project(p.client_id.as_deref(), &p.id)),
        None => id.to_string(),
    };
    let mut r = Report {
        segments: labeled.len(),
        suggestions: suggestions.len(),
        unclear_suggestions: suggestions.iter().filter(|s| s.is_unclear()).count(),
        ..Default::default()
    };
    for ((l, p), (_, conf)) in labeled.iter().zip(&predicted).zip(&with_conf) {
        let d = l.segment.duration();
        let exp = l.expected.as_ref().and_then(|t| catalog.resolve(t));
        let pc = p.as_ref().and_then(|t| t.client_id.clone());
        let pp = p.as_ref().and_then(|t| t.project_id.clone());
        let ec = exp.as_ref().and_then(|t| t.client_id.clone());
        let ep = exp.as_ref().and_then(|t| t.project_id.clone());

        if exp.is_none() {
            r.not_work_secs += d;
            if p.is_some() {
                r.false_suggestion_secs += d;
            }
        }
        if let Some(c) = &ec {
            r.client_secs += d;
            if pc.is_some() {
                r.client_suggested_secs += d;
                r.outcomes.push(Outcome {
                    secs: d,
                    confidence: *conf,
                    correct: pc.as_ref() == Some(c),
                });
            }
            if pc.as_ref() == Some(c) {
                r.client_correct_secs += d;
            }
            let e = r.per_client.entry(c.clone()).or_insert_with(|| Score {
                name: client_name(c),
                ..Default::default()
            });
            e.expected_secs += d;
            if pc.as_ref() == Some(c) {
                e.correct_secs += d;
            }
        }
        if let Some(c) = &pc {
            let e = r.per_client.entry(c.clone()).or_insert_with(|| Score {
                name: client_name(c),
                ..Default::default()
            });
            e.predicted_secs += d;
        }
        if let Some(pid) = &ep {
            r.project_secs += d;
            if pp.as_ref() == Some(pid) {
                r.project_correct_secs += d;
            }
            let e = r.per_project.entry(pid.clone()).or_insert_with(|| Score {
                name: project_name(pid),
                ..Default::default()
            });
            e.expected_secs += d;
            if pp.as_ref() == Some(pid) {
                e.correct_secs += d;
            }
        }
        if let Some(pid) = &pp {
            let e = r.per_project.entry(pid.clone()).or_insert_with(|| Score {
                name: project_name(pid),
                ..Default::default()
            });
            e.predicted_secs += d;
        }
        if let Some(case) = &l.case {
            let e = r.per_case.entry(case.clone()).or_insert_with(|| Score {
                name: case.clone(),
                ..Default::default()
            });
            // Pr. tilfælde er kun træf meningsfuldt: rigtig kunde, eller intet
            // forslag når det ikke er arbejde. `predicted_secs` = al tid.
            e.expected_secs += d;
            e.predicted_secs += d;
            let right = match &ec {
                Some(c) => pc.as_ref() == Some(c),
                None => p.is_none(),
            };
            if right {
                e.correct_secs += d;
            }
        }
    }
    r
}

/// Segmenterne delt i dage (lokal midnat ud fra `utc_offset_secs`).
pub fn days(labeled: &[LabeledSegment], utc_offset_secs: i64) -> Vec<Vec<LabeledSegment>> {
    let mut by_day: BTreeMap<i64, Vec<LabeledSegment>> = BTreeMap::new();
    for l in labeled {
        by_day
            .entry((l.segment.start + utc_offset_secs).div_euclid(86_400))
            .or_default()
            .push(l.clone());
    }
    by_day.into_values().collect()
}

/// Måling uden læring: matcheren ser hele labelsettet dag for dag med
/// labelsettets egne mønstre.
pub fn evaluate(set: &Labelset, config: &MatchConfig) -> Report {
    let matcher =
        Matcher::new(set.catalog.clone(), set.patterns.clone()).with_config(config.clone());
    let mut total = Report::default();
    for day in days(&set.segments, 0) {
        let segs: Vec<ActivitySegment> = day.iter().map(|l| l.segment.clone()).collect();
        total.add(&score(&set.catalog, &day, &matcher.suggest(&segs)));
    }
    total
}

/// Måling med læring: dag for dag foreslår matcheren, scores, og brugeren
/// simuleres – rigtige forslag bekræftes, forkerte rettes til flertallet af
/// labels i blokken, og forslag på ikke-arbejde afvises. Returnerer
/// rapporten pr. dag.
pub fn evaluate_online(set: &Labelset, config: &MatchConfig) -> Vec<Report> {
    run_online(set, config, false, |_, _, _| {}).0
}

/// Som [`evaluate_online`], men giver også modellens skyggeforslag dag for
/// dag (hvad Naive Bayes + udglatning ville have foreslået, mens kaskaden
/// driver forslagene og dermed læringen). Med `logged` lærer modellen
/// desuden af hele dagens facit, som om det var brugerens egne poster.
pub fn evaluate_online_with_shadow(
    set: &Labelset,
    config: &MatchConfig,
    logged: bool,
) -> (Vec<Report>, Vec<Report>) {
    run_online(set, config, logged, |_, _, _| {})
}

fn run_online(
    set: &Labelset,
    config: &MatchConfig,
    logged: bool,
    mut each: impl FnMut(&[LabeledSegment], &Suggestion, &Matcher),
) -> (Vec<Report>, Vec<Report>) {
    let mut matcher =
        Matcher::new(set.catalog.clone(), set.patterns.clone()).with_config(config.clone());
    let mut reports = Vec::new();
    let mut shadow = Vec::new();
    for day in days(&set.segments, 0) {
        let segs: Vec<ActivitySegment> = day.iter().map(|l| l.segment.clone()).collect();
        let suggestions = matcher.suggest(&segs);
        reports.push(score(&set.catalog, &day, &suggestions));
        if matches!(
            config.naive_bayes,
            crate::matcher::ModelMode::Shadow | crate::matcher::ModelMode::Auto
        ) {
            shadow.push(score(&set.catalog, &day, &matcher.shadow_suggest(&segs)));
        }
        for s in &suggestions {
            each(&day, s, &matcher);
            let Some(truth) = majority(&day, s) else {
                continue;
            };
            let truth = truth.and_then(|t| set.catalog.resolve(&t));
            match (&s.target, truth) {
                (Some(t), Some(truth)) if *t == truth => matcher.confirm(&segs, s),
                (_, Some(truth)) => matcher.correct(&segs, s, &truth),
                (Some(_), None) => matcher.reject(&segs, s),
                (None, None) => {}
            }
        }
        if logged {
            let entries: Vec<(i64, i64, Target)> = day
                .iter()
                .filter_map(|l| Some((l.segment.start, l.segment.end, l.expected.clone()?)))
                .collect();
            matcher.learn_logged(&segs, &entries);
        }
    }
    (reports, shadow)
}

/// Én linje pr. forslag: tid, forslag, rigtigt svar (flertal) og begrundelse.
/// Med `learn` køres samme simulerede læring som [`evaluate_online`].
/// Kun til fejlfinding; indeholder titler og bliver på maskinen.
pub fn explain(set: &Labelset, config: &MatchConfig, learn: bool) -> String {
    let mut out = String::new();
    let mut line = |day: &[LabeledSegment], s: &Suggestion| {
        let truth = majority(day, s).flatten();
        let ok = match (&s.target, &truth) {
            (Some(t), Some(u)) if t == u => "ok ",
            (Some(t), Some(u)) if t.client_id == u.client_id => "~  ",
            (None, None) => "ok ",
            _ => "FEJL",
        };
        let want = truth
            .as_ref()
            .map(|t| set.catalog.describe(t))
            .unwrap_or_else(|| "ikke arbejde".into());
        let _ = writeln!(
            out,
            "{ok} {}  (rigtigt: {want})  {:.2}  {}",
            crate::blocks::label(s, &set.catalog, 0),
            s.confidence,
            s.reason
        );
    };
    if learn {
        run_online(set, config, false, |day, s, _| line(day, s));
    } else {
        let matcher =
            Matcher::new(set.catalog.clone(), set.patterns.clone()).with_config(config.clone());
        for day in days(&set.segments, 0) {
            let segs: Vec<ActivitySegment> = day.iter().map(|l| l.segment.clone()).collect();
            for s in matcher.suggest(&segs) {
                line(&day, &s);
            }
        }
    }
    out
}

/// Det tidsvægtede flertal af labels i en blok (`Some(None)` = ikke arbejde).
fn majority(day: &[LabeledSegment], s: &Suggestion) -> Option<Option<Target>> {
    let mut votes: BTreeMap<Option<Target>, i64> = BTreeMap::new();
    for &i in &s.segment_indices {
        let l = day.get(i)?;
        *votes.entry(l.expected.clone()).or_default() += l.segment.duration();
    }
    votes.into_iter().max_by_key(|(_, d)| *d).map(|(t, _)| t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Client;

    fn labeled(start: i64, end: i64, url: &str, expected: Option<Target>) -> LabeledSegment {
        LabeledSegment {
            segment: ActivitySegment {
                app: "chrome".into(),
                url: Some(url.into()),
                start,
                end,
                ..Default::default()
            },
            expected,
            case: Some("test".into()),
        }
    }

    fn set() -> Labelset {
        Labelset {
            name: "mini".into(),
            catalog: Catalog {
                clients: vec![
                    Client {
                        id: "a".into(),
                        name: "Acme".into(),
                        domains: vec!["acme.dk".into()],
                        ..Default::default()
                    },
                    Client {
                        id: "b".into(),
                        name: "Beta".into(),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            patterns: PatternStore::new(),
            segments: vec![
                labeled(0, 1800, "https://acme.dk/", Some(Target::client("a"))),
                labeled(
                    1800,
                    3600,
                    "https://betaside.example/",
                    Some(Target::client("b")),
                ),
                labeled(4000, 5000, "https://nyheder.dk/", None),
                labeled(
                    86_400,
                    86_400 + 1800,
                    "https://betaside.example/",
                    Some(Target::client("b")),
                ),
            ],
        }
    }

    #[test]
    fn json_format_is_flat() {
        let json = serde_json::to_string(&set()).unwrap();
        assert!(json.contains("\"app\":\"chrome\",\"title\":\"\",\"url\":\"https://acme.dk/\",\"start\":0,\"end\":1800,\"expected\":{\"clientId\":\"a\",\"projectId\":null}"), "{json}");
        let back: Labelset = serde_json::from_str(&json).unwrap();
        assert_eq!(back, set());
    }

    #[test]
    fn static_scores() {
        let r = evaluate(&set(), &MatchConfig::default());
        assert_eq!(r.client_secs, 5400);
        assert_eq!(r.client_correct_secs, 1800);
        assert!((r.client_accuracy() - 1.0 / 3.0).abs() < 1e-9);
        assert_eq!(r.per_client["a"].precision(), Some(1.0));
        assert_eq!(r.per_client["b"].recall(), Some(0.0));
        assert_eq!(r.false_suggestion_secs, 0);
        assert_eq!(r.not_work_secs, 1000);
        assert!(r.render().contains("Kundetræf"));
    }

    #[test]
    fn online_learning_improves_the_next_day() {
        let reports = evaluate_online(&set(), &MatchConfig::default());
        assert_eq!(reports.len(), 2);
        assert_eq!(reports[0].per_client["b"].correct_secs, 0);
        assert_eq!(reports[1].client_accuracy(), 1.0);
    }
}
