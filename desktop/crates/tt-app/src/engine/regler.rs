//! ux-vaelger: "Altid sådan" og regeloversigten i motoren.
//!
//! - Omfang (repo, mappe, domæne, app, titelord) udledes af segmenterne i
//!   de valgte blokke.
//! - Forhåndsvisning og træffere tælles som matcheren gør: datalagets regel
//!   bliver til matcherens regler (`convert::matcher_rules`) og afprøves med
//!   `tt_matcher::matcher::rule_matches` på dagens segmenter. Matchende
//!   segmenter med under fem minutter imellem er én blok.
//! - "Slå fra" gælder kun denne enhed (`regler-fra.json`): reglen får
//!   `active: false` i matcherens katalog, og mønsteret holdes ude af
//!   matcheren. Datalaget og web kender ingen slået-fra-tilstand.
//! - Ret og slet af et mønster ændrer lageret; synkroniseringen sender
//!   forskellen til web som al anden læring (`pattern_sync`).

use std::collections::{BTreeMap, BTreeSet};

use chrono::NaiveDate;
use tt_data::RuleKind;
use tt_matcher as mm;
use tt_matcher::normalize::{
    clean_title, normalize_app, normalize_repo_remote, path_components, segment_host, title_segments,
};

use super::{Engine, convert, lock, state};
use crate::backend::services::WebRule;
use crate::backend::{BackendError, Id, Result, RuleOrigin, RuleRow, RuleRowKind, ScopeKind};

/// Matchende segmenter med højst så mange sekunder imellem er én blok
/// (tælling i forhåndsvisning og oversigt).
const JOIN_GAP: i64 = 300;
/// "Bagud" registrerer kun det, der matcher, med højst så meget imellem
/// (som Tildel): ellers kom andet arbejde imellem med i posten.
const REGISTER_GAP: i64 = 60;
const FILE: &str = "regler-fra.json";
fn utc(ts: i64) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::from_timestamp(ts, 0).unwrap_or_default()
}

/// Rækkernes id for mønstre: præfiks + nøglen som JSON.
const PATTERN_PREFIX: &str = "p:";

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Disabled {
    #[serde(default)]
    pub ids: BTreeSet<String>,
}

pub fn pattern_id(key: &mm::PatternKey) -> String {
    format!("{PATTERN_PREFIX}{}", serde_json::to_string(key).unwrap_or_default())
}

fn parse_pattern_id(id: &str) -> Option<mm::PatternKey> {
    serde_json::from_str(id.strip_prefix(PATTERN_PREFIX)?).ok()
}

/// Datalagets regel som matcherens regler, uden mål (kun til at afprøve
/// om noget matcher; domæne-regler bliver også til regler).
fn probe_rules(kind: RuleKind, pattern: &str) -> Vec<mm::Rule> {
    convert::matcher_rules(&WebRule {
        id: String::new(),
        kind,
        pattern: pattern.to_string(),
        project_id: None,
        client_id: None,
        not_work: true,
    })
}

/// Tidsrummene, hvor `hit` er sand, som blokke (sorteret).
pub fn runs(segs: &[mm::ActivitySegment], hit: impl Fn(&mm::ActivitySegment) -> bool) -> Vec<(i64, i64)> {
    join(segs.iter().filter(|s| hit(s)).map(|s| (s.start, s.end)).collect(), JOIN_GAP)
}

/// Tidsrum samlet, når der er højst `gap` sekunder imellem (sorteret).
fn join(mut spans: Vec<(i64, i64)>, gap: i64) -> Vec<(i64, i64)> {
    spans.sort();
    let mut out: Vec<(i64, i64)> = Vec::new();
    for (a, b) in spans {
        match out.last_mut() {
            Some(last) if a - last.1 <= gap => last.1 = last.1.max(b),
            _ => out.push((a, b)),
        }
    }
    out
}

/// Mappen for en sti: en fil erstattes af sin mappe. Mindst én mappe, der
/// ikke er generisk (som matcherens læring).
fn folder_of(path: &str) -> Option<String> {
    let p = path.trim_end_matches(['/', '\\']);
    let (dir, last) = p.rsplit_once(['/', '\\']).unwrap_or(("", p));
    let folder = if last.contains('.') && !last.starts_with('.') { dir } else { p };
    (folder.matches(['/', '\\']).count() >= 3 && !path_components(folder).is_empty()).then(|| folder.to_string())
}

/// Titlens del, der bedst beskriver arbejdet: den første del efter
/// emnet, når titlen har flere dele, ellers hele den rensede titel.
fn title_word(app: &str, title: &str) -> Option<String> {
    let cleaned = clean_title(app, title);
    let parts = title_segments(&cleaned);
    let pick = if parts.len() >= 2 { parts.get(1) } else { parts.first() }?.trim().to_string();
    let n = pick.chars().count();
    ((3..=40).contains(&n) && normalize_app(&pick) != normalize_app(app)).then_some(pick)
}

/// Omfangene for segmenterne: pr. slags den værdi, der dækker mest tid.
pub fn candidates(segs: &[mm::ActivitySegment]) -> Vec<(ScopeKind, String)> {
    let mut time: BTreeMap<(ScopeKind, String), i64> = BTreeMap::new();
    for s in segs {
        let d = s.duration().max(1);
        let mut add = |k: ScopeKind, v: Option<String>| {
            if let Some(v) = v.filter(|v| !v.trim().is_empty()) {
                *time.entry((k, v)).or_default() += d;
            }
        };
        add(ScopeKind::Repo, s.repo_remote.as_deref().map(normalize_repo_remote));
        add(ScopeKind::Folder, s.path.as_deref().and_then(folder_of));
        add(ScopeKind::Domain, segment_host(s.domain.as_deref(), s.url.as_deref()));
        add(ScopeKind::App, Some(s.app.clone()).filter(|a| !a.is_empty()));
        add(ScopeKind::TitleWord, title_word(&s.app, &s.title));
    }
    let mut best: BTreeMap<ScopeKind, (i64, String)> = BTreeMap::new();
    for ((k, v), t) in time {
        let e = best.entry(k).or_insert((0, String::new()));
        if t > e.0 {
            *e = (t, v);
        }
    }
    ScopeKind::ALL
        .iter()
        .filter_map(|k| best.get(k).map(|(_, v)| (*k, v.clone())))
        .collect()
}

/// Læg slåede-fra mønstre tilbage i lageret. Har matcheren imens lært den
/// samme nøgle forfra (AI-svar), er det et rent tillæg: det lægges oven i
/// originalen, så nøglen kun står én gang, og intet går tabt.
pub fn restore_held(store: &mut mm::PatternStore, held: &[mm::LearnedPattern]) {
    for h in held {
        match store.patterns.iter().position(|p| p.key == h.key) {
            Some(i) => {
                let fresh = store.patterns.remove(i);
                let mut merged = h.clone();
                for v in fresh.votes {
                    match merged.votes.iter_mut().find(|m| m.target == v.target) {
                        Some(m) => {
                            m.weight += v.weight;
                            m.confirmations += v.confirmations;
                            m.corrections += v.corrections;
                            m.ai_answers += v.ai_answers;
                        }
                        None => merged.votes.push(v),
                    }
                }
                store.patterns.insert(i, merged);
            }
            None => store.patterns.push(h.clone()),
        }
    }
}

impl Engine {
    fn disabled_path(&self) -> std::path::PathBuf {
        self.dir.join(FILE)
    }

    pub(super) fn disabled(&self) -> Disabled {
        state::read_json(&self.disabled_path(), &mut Vec::new()).unwrap_or_default()
    }

    /// Slåede-fra regler bliver inaktive i kataloget, og slåede-fra mønstre
    /// tages ud af lageret. De udtagne mønstre returneres, så de kan lægges
    /// tilbage, før lageret gemmes.
    pub(super) fn hold_back_disabled(
        &self,
        catalog: &mut mm::Catalog,
        store: &mut mm::PatternStore,
    ) -> Vec<mm::LearnedPattern> {
        let off = self.disabled().ids;
        if off.is_empty() {
            return Vec::new();
        }
        for r in catalog.rules.iter_mut().filter(|r| off.contains(&r.id)) {
            r.active = false;
        }
        // En domæneregel med mål er en site-kobling i kataloget (uden id).
        let domains: Vec<String> = lock(&self.web)
            .rules
            .iter()
            .filter(|r| off.contains(&r.id) && r.kind == RuleKind::Domain)
            .map(|r| r.pattern.trim().trim_start_matches("www.").to_lowercase())
            .collect();
        catalog
            .site_mappings
            .retain(|m| !domains.contains(&m.domain.trim().trim_start_matches("www.").to_lowercase()));
        let (held, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut store.patterns)
            .into_iter()
            .partition(|p| off.contains(&pattern_id(&p.key)));
        store.patterns = kept;
        held
    }

    /// Dagens segmenter (uden pauser) som matcherens.
    fn day_segments(&self, date: NaiveDate) -> Vec<mm::ActivitySegment> {
        self.with_store(|s| s.segments_for_day(date, false))
            .unwrap_or_default()
            .iter()
            .filter_map(convert::to_matcher)
            .collect()
    }

    pub(super) fn candidates_for(&self, spans: &[(i64, i64)]) -> Vec<(ScopeKind, String)> {
        let mut segs = Vec::new();
        for &(a, b) in spans {
            let raw = self
                .with_store(|s| s.segments_between(utc(a), utc(b), false))
                .unwrap_or_default();
            for r in raw {
                if let Some(mut m) = convert::to_matcher(&r) {
                    m.start = m.start.max(a);
                    m.end = m.end.min(b);
                    if m.end > m.start {
                        segs.push(m);
                    }
                }
            }
        }
        candidates(&segs)
    }

    pub(super) fn hit_counts(&self, rules: &[(RuleKind, String)], days: &[NaiveDate]) -> Vec<usize> {
        let probes: Vec<Vec<mm::Rule>> = rules.iter().map(|(k, p)| probe_rules(*k, p)).collect();
        let mut counts = vec![0; rules.len()];
        for &d in days {
            let segs = self.day_segments(d);
            if segs.is_empty() {
                continue;
            }
            for (i, rs) in probes.iter().enumerate() {
                counts[i] += runs(&segs, |s| rs.iter().any(|r| mm::matcher::rule_matches(r, s))).len();
            }
        }
        counts
    }

    pub(super) fn open_runs(
        &self,
        kind: RuleKind,
        pattern: &str,
        date: NaiveDate,
        target: &mm::Target,
        customers: &[crate::backend::Customer],
        projects: &[crate::backend::Project],
    ) -> Vec<(i64, i64)> {
        let rs = probe_rules(kind, pattern);
        // Kun det, der ikke er afgjort (som forslagene).
        let mut cuts = lock(&self.handled).spans();
        if let Some(logged) = lock(&self.observer).logged.get(&date) {
            cuts.extend(logged.iter().copied());
        }
        cuts.extend(self.not_work_spans());
        let segs = convert::subtract_spans(self.day_segments(date), &cuts);
        // Matcheren med alle regler og mønstre (også den nye): kun tid, hvor
        // målet vinder. Tid, som en anden regel eller et mønster giver en
        // anden kunde, tages ikke.
        let mut catalog = convert::catalog(customers, projects, &lock(&self.web));
        self.add_local_learning(&mut catalog);
        let mut patterns = lock(&self.patterns).store.clone();
        let _ = self.hold_back_disabled(&mut catalog, &mut patterns);
        let matcher = mm::Matcher::new(catalog, patterns);
        let mut spans = Vec::new();
        for block in matcher.suggest(&segs) {
            if !block.target.as_ref().is_some_and(|t| t.compatible(target)) {
                continue;
            }
            for &i in &block.segment_indices {
                if let Some(s) = segs.get(i)
                    && rs.iter().any(|r| mm::matcher::rule_matches(r, s))
                {
                    spans.push((s.start, s.end));
                }
            }
        }
        join(spans, REGISTER_GAP)
    }

    pub(super) fn patterns_as_rows(&self, days: &[NaiveDate]) -> Vec<RuleRow> {
        let store = lock(&self.patterns).store.clone();
        let off = self.disabled().ids;
        let mut hits: BTreeMap<String, usize> = BTreeMap::new();
        for &d in days {
            let segs = self.day_segments(d);
            for p in &store.patterns {
                let n = runs(&segs, |s| mm::learning::keys_for(s).contains(&p.key)).len();
                *hits.entry(pattern_id(&p.key)).or_default() += n;
            }
        }
        store
            .patterns
            .iter()
            .filter_map(|p| {
                let best = p.votes.iter().filter(|v| v.weight > 0.0).max_by(|a, b| a.weight.total_cmp(&b.weight))?;
                let id = pattern_id(&p.key);
                let (kind, value) = match &p.key {
                    mm::PatternKey::Repo { remote } => (RuleRowKind::Repo, remote.clone()),
                    mm::PatternKey::Path { path } => (RuleRowKind::Folder, path.clone()),
                    mm::PatternKey::Domain { domain } => (RuleRowKind::Domain, domain.clone()),
                    mm::PatternKey::AppKeyword { app, keyword } => (RuleRowKind::AppKeyword, format!("{keyword} · {app}")),
                    mm::PatternKey::TitleTemplate { app, template } => (RuleRowKind::Title, format!("{template} · {app}")),
                };
                Some(RuleRow {
                    hits: hits.get(&id).copied().unwrap_or(0),
                    active: !off.contains(&id),
                    id,
                    origin: RuleOrigin::Pattern,
                    kind,
                    value,
                    customer_id: best.target.client_id.clone(),
                    project_id: best.target.project_id.clone(),
                    not_work: false,
                    confirmations: best.confirmations + best.corrections,
                })
            })
            .collect()
    }

    pub(super) fn set_disabled(&self, id: &str, disabled: bool) -> Result<()> {
        let mut d = self.disabled();
        if disabled {
            d.ids.insert(id.to_string());
        } else {
            d.ids.remove(id);
        }
        state::write_json_atomic(&self.disabled_path(), &d)
            .map_err(|e| BackendError::Other(format!("Kunne ikke gemme: {e}")))?;
        lock(&self.cache).clear();
        self.signal_change();
        Ok(())
    }

    fn edit_pattern(&self, id: &str, f: impl FnOnce(&mut mm::PatternStore, &mm::PatternKey)) -> Result<()> {
        let key = parse_pattern_id(id).ok_or_else(|| BackendError::NotFound("Mønsteret".into()))?;
        let mut guard = lock(&self.patterns);
        if !guard.store.patterns.iter().any(|p| p.key == key) {
            return Err(BackendError::NotFound("Mønsteret".into()));
        }
        f(&mut guard.store, &key);
        guard.generation += 1;
        self.save_patterns(&guard);
        drop(guard);
        lock(&self.cache).clear();
        self.signal_change();
        Ok(())
    }

    /// Nyt mål: de andre stemmer fjernes, og målet står som to rettelser
    /// (som et svar i "Lær TimeTrack at kende").
    pub(super) fn retarget(&self, id: &str, customer: Option<Id>, project: Option<Id>) -> Result<()> {
        let target = mm::Target {
            client_id: customer.filter(|c| !c.is_empty()),
            project_id: project,
        };
        if target.client_id.is_none() && target.project_id.is_none() {
            return Err(BackendError::Validation("Vælg en kunde eller et projekt".into()));
        }
        self.edit_pattern(id, |store, key| {
            if let Some(p) = store.patterns.iter_mut().find(|p| &p.key == key) {
                p.votes.retain(|v| v.target == target);
            }
            store.teach(key, &target);
        })
    }

    pub(super) fn forget(&self, id: &str) -> Result<()> {
        self.edit_pattern(id, |store, key| store.patterns.retain(|p| &p.key != key))?;
        // Et slettet mønster skal ikke stå som slået fra.
        if self.disabled().ids.contains(id) {
            self.set_disabled(id, false)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(app: &str, title: &str, a: i64, b: i64) -> mm::ActivitySegment {
        mm::ActivitySegment {
            app: app.into(),
            title: title.into(),
            start: a,
            end: b,
            ..Default::default()
        }
    }

    #[test]
    fn blokke_samles_med_korte_huller() {
        let segs = vec![
            seg("Code", "x", 0, 600),
            seg("Code", "x", 700, 900),
            seg("Mail", "y", 900, 1000),
            seg("Code", "x", 2000, 2100),
        ];
        let r = runs(&segs, |s| s.app == "Code");
        assert_eq!(r, vec![(0, 900), (2000, 2100)]);
    }

    #[test]
    fn omfang_pr_slags_med_mest_tid() {
        let mut a = seg("Code", "main.rs — bageriet-webshop", 0, 3000);
        a.repo_remote = Some("git@github.com:acme/bageriet-webshop.git".into());
        a.path = Some("/Users/mads/kunder/bageriet/webshop/src/main.rs".into());
        let mut b = seg("Safari", "Kurv – Bageriet på Hjørnet", 3000, 3600);
        b.url = Some("https://www.bageriet.dk/kurv".into());
        let c = candidates(&[a, b]);
        let kinds: Vec<ScopeKind> = c.iter().map(|x| x.0).collect();
        assert_eq!(
            kinds,
            vec![ScopeKind::Repo, ScopeKind::Folder, ScopeKind::Domain, ScopeKind::App, ScopeKind::TitleWord]
        );
        assert_eq!(c[0].1, "github.com/acme/bageriet-webshop");
        assert_eq!(c[1].1, "/Users/mads/kunder/bageriet/webshop/src");
        assert!(c[2].1.ends_with("bageriet.dk"), "{}", c[2].1);
        assert_eq!(c[3].1, "Code", "programmet med mest tid");
        assert_eq!(c[4].1, "bageriet-webshop");
    }

    #[test]
    fn omfanget_rammer_som_matcheren() {
        let mut s = seg("Safari", "Forside", 0, 60);
        s.url = Some("https://shop.bageriet.dk/".into());
        let rs = probe_rules(RuleKind::Domain, "bageriet.dk");
        assert!(rs.iter().any(|r| mm::matcher::rule_matches(r, &s)), "underdomæner tæller med");
        let t = seg("Code", "Bageriet på Hjørnet – Code", 0, 60);
        let rs = probe_rules(RuleKind::TitleTemplate, "bageriet paa hjoernet");
        assert!(rs.iter().any(|r| mm::matcher::rule_matches(r, &t)), "æøå foldes");
        let rs = probe_rules(RuleKind::App, "code");
        assert!(rs.iter().any(|r| mm::matcher::rule_matches(r, &t)));
    }

    #[test]
    fn slaaet_fra_moenster_laegges_tilbage_uden_dublet() {
        let key = mm::PatternKey::Domain { domain: "bageriet.dk".into() };
        let vote = |c: &str, w: f32, ai: u32| mm::learning::Vote {
            target: mm::Target { client_id: Some(c.into()), project_id: None },
            weight: w,
            confirmations: 1,
            corrections: 0,
            ai_answers: ai,
        };
        let held = vec![mm::LearnedPattern { key: key.clone(), votes: vec![vote("a", 2.0, 0)] }];
        // Matcheren lærte nøglen forfra imens (et AI-svar).
        let mut store = mm::PatternStore {
            patterns: vec![mm::LearnedPattern { key: key.clone(), votes: vec![vote("a", 0.5, 1), vote("b", 0.5, 1)] }],
        };
        restore_held(&mut store, &held);
        assert_eq!(store.patterns.len(), 1, "nøglen står én gang");
        let p = &store.patterns[0];
        assert_eq!(p.votes.len(), 2);
        assert!((p.votes[0].weight - 2.5).abs() < 1e-6);
        assert_eq!(p.votes[0].ai_answers, 1);
        // Uden ny læring: bare tilbage.
        let mut empty = mm::PatternStore::default();
        restore_held(&mut empty, &held);
        assert_eq!(empty.patterns, held);
    }

    #[test]
    fn moensterets_id_kan_laeses_igen() {
        let k = mm::PatternKey::Domain { domain: "bageriet.dk".into() };
        assert_eq!(parse_pattern_id(&pattern_id(&k)), Some(k));
        assert_eq!(parse_pattern_id("regel-1"), None);
    }

    #[test]
    fn generiske_mapper_giver_intet_omfang() {
        assert_eq!(folder_of("/Users/mads"), None);
        assert_eq!(folder_of("/Users/mads/dev/kunde-x/README.md").as_deref(), Some("/Users/mads/dev/kunde-x"));
    }
}
