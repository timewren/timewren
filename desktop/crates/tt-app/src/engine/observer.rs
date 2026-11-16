//! Observatøren i motoren: tæller aktiviteten inkrementelt med i
//! `observer.json` (tt-matcher `observe`), stiller spørgsmålene og lærer
//! svarene som mønstre. Plus de to andre dele af "observér først":
//! git-gren/commit → opgave på forslagene og den anonymiserede eksport.
//!
//! Optællingen tager kun segmenter med et id over markøren, så et kald koster
//! næsten intet, når intet er nyt. Første gang tælles de seneste 14 dage.

use std::collections::HashMap;
use std::path::Path;

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use tt_matcher as mm;
use tt_tracker as tr;

use super::{Engine, convert, local_ts, lock, other, state, unix_now};
use crate::backend::{
    Customer, Entry, ObserverCard, ObserverGroup, ObserverReply, ObserverSource,
    ObserverSourceKind, Project, Result, Suggestion, Task, TaskStatus,
};

/// Hvad motoren husker om observatøren.
#[derive(Default)]
pub(super) struct ObserverRuntime {
    pub state: mm::ObserverState,
    /// Manuelle tidsrum pr. dag (poster med start og slut), fra `set_logged_spans`.
    pub logged: HashMap<NaiveDate, Vec<(i64, i64)>>,
    /// Åbne opgaver til gren → opgave.
    pub tasks: Vec<Task>,
}

pub(super) fn load(dir: &Path, warnings: &mut Vec<String>) -> ObserverRuntime {
    ObserverRuntime {
        state: state::read_json(&dir.join("observer.json"), warnings).unwrap_or_default(),
        ..Default::default()
    }
}

fn to_utc(ts: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(ts, 0).unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
}

fn kind(key: &mm::PatternKey) -> ObserverSourceKind {
    match key {
        mm::PatternKey::Repo { .. } => ObserverSourceKind::Repo,
        mm::PatternKey::Path { .. } => ObserverSourceKind::Folder,
        mm::PatternKey::Domain { .. } => ObserverSourceKind::Domain,
        mm::PatternKey::AppKeyword { .. } => ObserverSourceKind::Document,
        mm::PatternKey::TitleTemplate { .. } => ObserverSourceKind::Title,
    }
}

fn minutes(secs: i64) -> u32 {
    u32::try_from(secs.max(0) / 60).unwrap_or(u32::MAX)
}

fn to_ui(g: &mm::ObservedGroup) -> ObserverGroup {
    ObserverGroup {
        id: g.id.clone(),
        sources: g
            .sources
            .iter()
            .map(|s| ObserverSource {
                kind: kind(&s.key),
                label: s.label.clone(),
                minutes: minutes(s.secs),
            })
            .collect(),
        hints: g.hints.clone(),
        minutes: minutes(g.secs),
        customer_id: g.suggested.as_ref().and_then(|t| t.client_id.clone()),
        project_id: g.suggested.as_ref().and_then(|t| t.project_id.clone()),
        reason: g.reason.clone(),
        new_name: g.new_name.clone(),
        known: g.known,
    }
}

impl Engine {
    fn save_observer(&self, st: &mm::ObserverState) {
        if let Err(e) = state::write_json_atomic(&self.dir.join("observer.json"), st) {
            eprintln!("TimeTrack: observatøren kunne ikke gemmes: {e}");
        }
    }

    /// Tæller nye segmenter med (inkrementelt). Første gang de seneste 14 dage.
    pub(super) fn observer_refresh(&self) -> Result<()> {
        let now = unix_now();
        let (cursor, last_end) = {
            let o = lock(&self.observer);
            (o.state.cursor, o.state.last_end)
        };
        let from = if last_end == 0 {
            now - mm::observe::WINDOW_DAYS * 86_400
        } else {
            // Et segment, der sluttede lige før, kan være gemt efter markøren.
            last_end - 3600
        };
        let raw = {
            let store = lock(&self.store);
            let Some(store) = store.as_ref() else {
                return Ok(());
            };
            store
                .segments_between(to_utc(from), to_utc(now + 60), false)
                .map_err(|e| other(format!("Aktiviteten kunne ikke læses: {e}")))?
        };
        let fresh: Vec<&tr::ActivitySegment> =
            raw.iter().filter(|s| s.id.is_some_and(|id| id > cursor)).collect();
        if fresh.is_empty() {
            return Ok(());
        }
        let max_id = fresh.iter().filter_map(|s| s.id).max().unwrap_or(cursor);
        let segs: Vec<mm::ActivitySegment> =
            fresh.into_iter().filter_map(convert::to_matcher).collect();
        let mut o = lock(&self.observer);
        // Et andet kald kan have talt de samme segmenter, mens låsen var fri.
        let cursor = o.state.cursor;
        let segs: Vec<mm::ActivitySegment> = segs
            .into_iter()
            .filter(|s| s.id.as_deref().and_then(|i| i.parse::<i64>().ok()).is_some_and(|i| i > cursor))
            .collect();
        if segs.is_empty() {
            return Ok(());
        }
        o.state.ingest(&segs);
        o.state.cursor = o.state.cursor.max(max_id);
        self.save_observer(&o.state);
        Ok(())
    }

    fn observer_matcher(&self, customers: &[Customer], projects: &[Project]) -> mm::Matcher {
        let catalog = convert::catalog(customers, projects, &lock(&self.web));
        let (patterns, model) = {
            let p = lock(&self.patterns);
            (p.store.clone(), p.model.clone())
        };
        // Med brugerens model: kalibreringen afgør, hvad der er "kendt", og
        // Naive Bayes' uenighed med kaskaden gør et spørgsmål mere værd.
        mm::Matcher::new(catalog, patterns).with_model(model)
    }

    pub(super) fn card(&self, customers: &[Customer], projects: &[Project]) -> Result<ObserverCard> {
        self.observer_refresh()?;
        let matcher = self.observer_matcher(customers, projects);
        let o = lock(&self.observer);
        let status = o.state.status(&matcher, unix_now());
        Ok(ObserverCard {
            active: self.tracking_state() != super::TrackingState::NotStarted
                || status.observed_secs > 0,
            observed_minutes: minutes(status.observed_secs),
            ready_after_minutes: minutes(mm::observe::READY_AFTER_SECS),
            question: status.question.as_ref().map(to_ui),
            remaining: status.remaining,
            answered: o.state.answered,
        })
    }

    pub(super) fn groups(&self, customers: &[Customer], projects: &[Project]) -> Result<Vec<ObserverGroup>> {
        self.observer_refresh()?;
        let matcher = self.observer_matcher(customers, projects);
        let o = lock(&self.observer);
        Ok(o.state.groups(&matcher, true).iter().map(to_ui).collect())
    }

    pub(super) fn answer(
        &self,
        group_id: &str,
        reply: &ObserverReply,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<()> {
        let answer = match reply {
            ObserverReply::Target {
                customer_id,
                project_id,
            } => mm::ObserverAnswer::Target {
                target: mm::Target {
                    client_id: Some(customer_id.clone()).filter(|c| !c.is_empty()),
                    project_id: project_id.clone(),
                },
            },
            ObserverReply::Skip => mm::ObserverAnswer::Skip,
            ObserverReply::Never => mm::ObserverAnswer::Never,
            ObserverReply::NewCustomer { .. } => {
                return Err(other("Kunden skal oprettes før svaret"));
            }
        };
        let matcher = self.observer_matcher(customers, projects);
        if let mm::ObserverAnswer::Target { target } = &answer
            && matcher.catalog.resolve(target).is_none()
        {
            return Err(crate::backend::BackendError::NotFound("Kunden".into()));
        }
        let mut o = lock(&self.observer);
        let group = o
            .state
            .groups(&matcher, true)
            .into_iter()
            .find(|g| g.id == group_id)
            .ok_or_else(|| {
                crate::backend::BackendError::Other(
                    "Spørgsmålet er ændret, mens du svarede. Se det nye.".into(),
                )
            })?;
        {
            let mut p = lock(&self.patterns);
            let mut store = std::mem::take(&mut p.store);
            o.state.answer(&group, &answer, &mut store, unix_now());
            p.store = store;
            if matches!(answer, mm::ObserverAnswer::Target { .. }) {
                p.generation += 1;
                self.save_patterns(&p);
            }
        }
        self.save_observer(&o.state);
        drop(o);
        // Mønstrene gælder nu også bagud: forslagene skal regnes igen.
        self.signal_change();
        Ok(())
    }

    /// Opgaven for et forslag ud fra git-grenen og commit-emnerne i blokken.
    /// Kun opgaver på forslagets projekt (eller, uden projekt, kundens).
    pub(super) fn attach_task(
        &self,
        ui: &mut Suggestion,
        block: &mm::Suggestion,
        raw: &[tr::ActivitySegment],
        projects: &[Project],
    ) {
        let tasks = lock(&self.observer).tasks.clone();
        if tasks.is_empty() {
            return;
        }
        // Grenen og repoet, der fylder mest i blokken.
        let mut by_branch: HashMap<(&str, &str), i64> = HashMap::new();
        for s in raw {
            let (Some(branch), Some(root)) = (s.branch.as_deref(), s.repo_root.as_deref()) else {
                continue;
            };
            let overlap = s.end.timestamp().min(block.end) - s.start.timestamp().max(block.start);
            if overlap > 0 {
                *by_branch.entry((branch, root)).or_default() += overlap;
            }
        }
        let best = by_branch
            .into_iter()
            .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
            .map(|(k, _)| k);
        let roots: Vec<&str> = raw
            .iter()
            .filter(|s| s.end.timestamp() > block.start && s.start.timestamp() < block.end)
            .filter_map(|s| s.repo_root.as_deref())
            .collect();
        let root = best.map(|(_, r)| r).or_else(|| roots.first().copied());
        let Some(root) = root else {
            return;
        };
        let commits = tr::git::commits_between(Path::new(root), block.start, block.end + 600);
        let client_projects: Vec<&str> = projects
            .iter()
            .filter(|p| ui.customer_id.as_deref().is_some_and(|c| p.customer_id == c))
            .map(|p| p.id.as_str())
            .collect();
        let candidates: Vec<mm::TaskRef> = tasks
            .iter()
            .filter(|t| t.status != TaskStatus::Done)
            .filter(|t| match &ui.project_id {
                Some(p) => &t.project_id == p,
                None => client_projects.contains(&t.project_id.as_str()),
            })
            .map(|t| mm::TaskRef {
                id: t.id.clone(),
                title: t.title.clone(),
                project_id: Some(t.project_id.clone()),
            })
            .collect();
        let Some(found) = mm::suggest_task(best.map(|(b, _)| b), &commits, &candidates) else {
            return;
        };
        let Some(task) = tasks.iter().find(|t| t.id == found.task_id) else {
            return;
        };
        if ui.project_id.is_none() {
            ui.project_id = Some(task.project_id.clone());
        }
        ui.task_id = Some(task.id.clone());
        ui.task_title = Some(task.title.clone());
    }

    /// Anonymiseret testsæt: aktiviteten i de seneste `days` dage, hvor
    /// posterne (med start og slut) er facit, og afviste tidsrum er "ikke
    /// arbejde". Segmenter uden facit kommer ikke med.
    pub(super) fn test_set(
        &self,
        entries: &[Entry],
        customers: &[Customer],
        projects: &[Project],
        days: u32,
    ) -> Result<String> {
        let now = unix_now();
        let raw = {
            let store = lock(&self.store);
            let store = store
                .as_ref()
                .ok_or_else(|| other("Aktivitetsdatabasen kunne ikke åbnes"))?;
            store
                .segments_between(to_utc(now - i64::from(days) * 86_400), to_utc(now), false)
                .map_err(|e| other(format!("Aktiviteten kunne ikke læses: {e}")))?
        };
        let truth: Vec<(i64, i64, mm::Target)> = entries
            .iter()
            .filter_map(|e| {
                let (start, end) = (e.start?, e.end?);
                let a = local_ts(e.date, start)?;
                let b = if end <= start {
                    local_ts(e.date, NaiveTime::MIN)? + 86_400
                } else {
                    local_ts(e.date, end)?
                };
                Some((
                    a,
                    b,
                    mm::Target {
                        client_id: Some(e.customer_id.clone()).filter(|c| !c.is_empty()),
                        project_id: e.project_id.clone(),
                    },
                ))
            })
            .collect();
        let rejected: Vec<(i64, i64)> = lock(&self.handled)
            .all()
            .iter()
            .filter(|s| s.kind == state::Handling::Rejected)
            .map(|s| (s.start, s.end))
            .collect();
        let mut segments = Vec::new();
        for s in raw.iter().filter_map(convert::to_matcher) {
            let mid = (s.start + s.end) / 2;
            let expected = if let Some((_, _, t)) = truth.iter().find(|(a, b, _)| (*a..*b).contains(&mid)) {
                Some(t.clone())
            } else if rejected.iter().any(|(a, b)| (*a..*b).contains(&mid)) {
                None
            } else {
                continue;
            };
            segments.push(mm::labelset::LabeledSegment {
                segment: s,
                expected,
                case: None,
            });
        }
        let set = mm::labelset::Labelset {
            name: String::new(),
            catalog: convert::catalog(customers, projects, &lock(&self.web)),
            patterns: mm::PatternStore::new(),
            segments,
        };
        let hash = mm::anonymize::secret_hash();
        let anon = mm::anonymize::anonymize(&set, &hash);
        serde_json::to_string_pretty(&anon).map_err(|e| other(e.to_string()))
    }
}
