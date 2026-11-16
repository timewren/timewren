//! AI-krog for uklare blokke.
//!
//! `tt-ai` implementerer [`Classifier`] (lokal model, Ollama/LM Studio eller
//! cloud som opt-in). Matcheren spørger kun om uklare blokke, og hvert svar
//! gemmes som mønster med lav vægt, så samme spørgsmål ikke stilles igen.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::learning::{Feedback, keys_for};
use crate::matcher::{Matcher, confidence};
use crate::normalize::{clean_title, normalize_repo_remote, segment_host};
use crate::types::{ActivitySegment, Layer, Signal, Source, Suggestion, Target};

/// En mulig kunde/et muligt projekt, AI'en kan vælge imellem.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifierOption {
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    /// Domæner, repos og mapper brugeren har knyttet til målet.
    #[serde(default)]
    pub keywords: Vec<String>,
}

/// Et signal med den tid, det fyldte i blokken.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Weighted {
    pub value: String,
    pub seconds: i64,
}

/// Spørgsmålet om én uklar blok.
///
/// Rensede titler er med, fordi de er det stærkeste signal. Det er `tt-ai`'s
/// ansvar kun at sende dem til en cloud-udbyder, når brugeren har slået det
/// til (D3/D12). Alt er sorteret efter tid, højst 10 af hver.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyRequest {
    pub start: i64,
    pub end: i64,
    pub apps: Vec<Weighted>,
    pub titles: Vec<Weighted>,
    pub domains: Vec<Weighted>,
    pub repos: Vec<Weighted>,
    pub documents: Vec<Weighted>,
    pub options: Vec<ClassifierOption>,
}

/// AI'ens svar. `target` skal være et af `options` (ellers ignoreres det).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifierAnswer {
    pub target: Target,
    pub confidence: f32,
    /// Kort dansk begrundelse fra modellen.
    pub reason: String,
}

/// Fejl fra en klassifikator. Matcheren lader blokken forblive uklar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassifierError(pub String);

impl std::fmt::Display for ClassifierError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ClassifierError {}

/// Implementeres af `tt-ai`. Synkron: kaldes fra en baggrundstråd/-executor.
pub trait Classifier {
    /// `Ok(None)` = "ved ikke" (blokken forbliver uklar).
    fn classify(
        &self,
        request: &ClassifyRequest,
    ) -> Result<Option<ClassifierAnswer>, ClassifierError>;
}

/// Udfaldet af [`Matcher::resolve_unclear`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolveReport {
    /// Uklare blokke, der blev spurgt om.
    pub asked: usize,
    /// Blokke, der fik et mål.
    pub resolved: usize,
    /// Blokke, hvor allerede lærte mønstre gav svaret, så AI ikke blev spurgt.
    pub answered_from_patterns: usize,
    pub errors: Vec<String>,
}

fn top(map: BTreeMap<String, i64>) -> Vec<Weighted> {
    let mut v: Vec<Weighted> = map
        .into_iter()
        .map(|(value, seconds)| Weighted { value, seconds })
        .collect();
    v.sort_by(|a, b| {
        b.seconds
            .cmp(&a.seconds)
            .then_with(|| a.value.cmp(&b.value))
    });
    v.truncate(10);
    v
}

impl Matcher {
    /// Spørgsmålet for en blok.
    pub fn classify_request(
        &self,
        segments: &[ActivitySegment],
        suggestion: &Suggestion,
    ) -> ClassifyRequest {
        let mut apps = BTreeMap::new();
        let mut titles = BTreeMap::new();
        let mut domains = BTreeMap::new();
        let mut repos = BTreeMap::new();
        let mut documents = BTreeMap::new();
        for seg in suggestion
            .segment_indices
            .iter()
            .filter_map(|&i| segments.get(i))
        {
            let d = seg.duration();
            *apps.entry(seg.app.clone()).or_default() += d;
            let t = clean_title(&seg.app, &seg.title);
            if !t.is_empty() {
                *titles.entry(t).or_default() += d;
            }
            if let Some(h) = segment_host(seg.domain.as_deref(), seg.url.as_deref()) {
                *domains.entry(h).or_default() += d;
            }
            if let Some(r) = seg.repo_remote.as_deref().filter(|r| !r.is_empty()) {
                *repos.entry(normalize_repo_remote(r)).or_default() += d;
            }
            if let Some(doc) = seg.document.as_deref().filter(|d| !d.is_empty()) {
                *documents.entry(doc.to_string()).or_default() += d;
            }
        }
        let mut options = Vec::new();
        for client in self.catalog.clients.iter().filter(|c| !c.archived) {
            options.push(ClassifierOption {
                client_id: Some(client.id.clone()),
                client_name: Some(client.name.clone()),
                project_id: None,
                project_name: None,
                keywords: self.keywords_for(Some(&client.id), None),
            });
        }
        for project in self.catalog.projects.iter().filter(|p| !p.archived) {
            let client = project
                .client_id
                .as_deref()
                .and_then(|id| self.catalog.client(id));
            options.push(ClassifierOption {
                client_id: client.map(|c| c.id.clone()),
                client_name: client.map(|c| c.name.clone()),
                project_id: Some(project.id.clone()),
                project_name: Some(project.name.clone()),
                keywords: self.keywords_for(client.map(|c| c.id.as_str()), Some(&project.id)),
            });
        }
        // De bedste først, så AI'ens begrænsede pladser går til de mest sandsynlige.
        let segs: Vec<&ActivitySegment> = suggestion
            .segment_indices
            .iter()
            .filter_map(|&i| segments.get(i))
            .collect();
        let options = self
            .rank_options(&segs, options, suggestion.end)
            .into_iter()
            .map(|s| s.option)
            .collect();
        ClassifyRequest {
            start: suggestion.start,
            end: suggestion.end,
            apps: top(apps),
            titles: top(titles),
            domains: top(domains),
            repos: top(repos),
            documents: top(documents),
            options,
        }
    }

    /// Spørger `classifier` om hver uklar blok og gemmer svarene som mønstre.
    ///
    /// Før AI spørges, prøves de lærte mønstre igen: et tidligere svar på en
    /// blok med de samme nøgler giver svaret uden et nyt kald.
    pub fn resolve_unclear(
        &mut self,
        segments: &[ActivitySegment],
        suggestions: &mut [Suggestion],
        classifier: &dyn Classifier,
    ) -> ResolveReport {
        let mut report = ResolveReport::default();
        // En blok, brugerens tærskel holdt tilbage, er uklar med vilje: hverken
        // mønstre eller AI må foreslå den alligevel.
        for s in suggestions.iter_mut().filter(|s| s.is_unclear() && s.held_back.is_none()) {
            let segs: Vec<&ActivitySegment> = s
                .segment_indices
                .iter()
                .filter_map(|&i| segments.get(i))
                .collect();
            if segs.iter().all(|seg| keys_for(seg).is_empty())
                && segs.iter().all(|seg| seg.title.trim().is_empty())
            {
                continue; // Intet at spørge om.
            }
            if let Some((target, conf, reason)) = self.answer_from_patterns(&segs) {
                apply(s, target, conf, reason, Signal::Mixed, Layer::Pattern);
                report.answered_from_patterns += 1;
                continue;
            }
            report.asked += 1;
            let request = self.classify_request(segments, s);
            match classifier.classify(&request) {
                Ok(Some(answer)) => {
                    let allowed = request.options.iter().any(|o| {
                        o.client_id == answer.target.client_id
                            && o.project_id == answer.target.project_id
                    });
                    let Some(target) = self.catalog.resolve(&answer.target).filter(|_| allowed)
                    else {
                        report
                            .errors
                            .push(format!("AI svarede med et ukendt mål: {:?}", answer.target));
                        continue;
                    };
                    self.patterns.learn(&segs, &target, &Feedback::Ai);
                    let conf = answer.confidence.clamp(0.0, 1.0).min(confidence::AI_MAX);
                    apply(
                        s,
                        target,
                        conf,
                        format!("AI: {}", answer.reason),
                        Signal::Mixed,
                        Layer::Ai,
                    );
                    report.resolved += 1;
                }
                Ok(None) => {}
                Err(e) => report.errors.push(e.0),
            }
        }
        report
    }

    /// Flertallet af segmenternes mønstertræf, vægtet med tid.
    fn answer_from_patterns(&self, segs: &[&ActivitySegment]) -> Option<(Target, f32, String)> {
        let total: i64 = segs.iter().map(|s| s.duration()).sum::<i64>().max(1);
        let mut votes: BTreeMap<Target, (i64, f32)> = BTreeMap::new();
        for seg in segs {
            if let Some(hit) = self.patterns.lookup(seg) {
                let e = votes.entry(hit.target).or_default();
                e.0 += seg.duration();
                e.1 = e.1.max(hit.confidence);
            }
        }
        let (target, (secs, conf)) = votes.into_iter().max_by_key(|(_, (s, _))| *s)?;
        let target = self.catalog.resolve(&target)?;
        (secs * 2 >= total).then(|| {
            let reason = format!("Lært tidligere: ligner {}", self.catalog.describe(&target));
            (target, conf.min(confidence::AI_MAX), reason)
        })
    }
}

fn apply(
    s: &mut Suggestion,
    target: Target,
    confidence: f32,
    reason: String,
    signal: Signal,
    layer: Layer,
) {
    s.target = Some(target);
    s.confidence = confidence;
    s.source = Some(Source { layer, signal });
    s.reason = reason;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::learning::PatternStore;
    use crate::types::{Catalog, Client};
    use std::cell::Cell;

    struct Fake {
        calls: Cell<usize>,
        answer: Option<ClassifierAnswer>,
    }

    impl Classifier for Fake {
        fn classify(
            &self,
            request: &ClassifyRequest,
        ) -> Result<Option<ClassifierAnswer>, ClassifierError> {
            self.calls.set(self.calls.get() + 1);
            assert!(
                request.titles.iter().any(|t| t.value == "Opgave om kage"),
                "{request:?}"
            );
            assert!(request.titles.iter().all(|t| !t.value.contains("Chrome")));
            Ok(self.answer.clone())
        }
    }

    struct Failing;

    impl Classifier for Failing {
        fn classify(
            &self,
            _: &ClassifyRequest,
        ) -> Result<Option<ClassifierAnswer>, ClassifierError> {
            Err(ClassifierError("ingen forbindelse".into()))
        }
    }

    fn setup() -> (Matcher, Vec<ActivitySegment>) {
        let catalog = Catalog {
            clients: vec![Client {
                id: "c-a".into(),
                name: "Acme".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let segs = vec![ActivitySegment {
            app: "Google Chrome".into(),
            title: "Opgave om kage - Google Chrome".into(),
            url: Some("https://kageopskrifter.dk/x".into()),
            start: 0,
            end: 1800,
            ..Default::default()
        }];
        (Matcher::new(catalog, PatternStore::new()), segs)
    }

    #[test]
    fn answers_are_applied_and_remembered() {
        let (mut m, segs) = setup();
        let mut s = m.suggest(&segs);
        assert!(s[0].is_unclear());
        let ai = Fake {
            calls: Cell::new(0),
            answer: Some(ClassifierAnswer {
                target: Target::client("c-a"),
                confidence: 0.9,
                reason: "Kageopskrifter er Acmes".into(),
            }),
        };
        let r = m.resolve_unclear(&segs, &mut s, &ai);
        assert_eq!((r.asked, r.resolved), (1, 1));
        assert_eq!(s[0].target, Some(Target::client("c-a")));
        assert_eq!(s[0].confidence, confidence::AI_MAX);
        assert_eq!(s[0].source.unwrap().layer, Layer::Ai);
        assert!(s[0].reason.starts_with("AI: "));

        // Næste gang svarer mønstrene selv, uden et nyt AI-kald.
        let again = m.suggest(&segs);
        assert_eq!(again[0].target, Some(Target::client("c-a")));
        assert_eq!(again[0].source.unwrap().layer, Layer::Pattern);
        assert_eq!(ai.calls.get(), 1);
    }

    #[test]
    fn unknown_targets_and_errors_keep_blocks_unclear() {
        let (mut m, segs) = setup();
        let mut s = m.suggest(&segs);
        let ai = Fake {
            calls: Cell::new(0),
            answer: Some(ClassifierAnswer {
                target: Target::client("c-findes-ikke"),
                confidence: 0.9,
                reason: String::new(),
            }),
        };
        let r = m.resolve_unclear(&segs, &mut s, &ai);
        assert_eq!(r.resolved, 0);
        assert_eq!(r.errors.len(), 1);
        assert!(s[0].is_unclear());
        assert!(m.patterns.is_empty());

        let r = m.resolve_unclear(&segs, &mut s, &Failing);
        assert_eq!(r.errors, vec!["ingen forbindelse".to_string()]);
        assert!(s[0].is_unclear());
    }
}
