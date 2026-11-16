//! Synkronisering af de lærte mønstre med web (`extension.patterns.*`).
//!
//! Web gemmer det sidst sendte pr. nøgle og fletter ikke (`patterns.ts`:
//! `onConflictDoUpdate … votes = excluded.votes`). Desktop må derfor aldrig
//! sende "web + alt lokalt" igen og igen: så tælles stemmerne dobbelt.
//! Modellen her:
//!
//! - `base`: web's seneste kendte værdi pr. nøgle.
//! - `pending`: enhedens EGNE ændringer siden sidste push, pr. nøgle og mål
//!   (vægt og tællere som forskelle). Overlever genstart (gemmes i
//!   `patterns.json` sammen med mønstrene, i én atomisk skrivning).
//! - `inflight`: det, der er sendt (eller er ved at blive sendt), med
//!   deltaet bag. Afgøres ved næste hentning.
//! - Invariant: matcherens lager = `base` ⊕ (usendt `inflight`) ⊕ `pending`.
//!   Alt, lageret ellers afviger med, er ny egen læring og bliver til
//!   `pending` (`observe`).
//!
//! En runde: (A) observer, (B) hent web's ændringer siden cursoren,
//! (C) læg dem i `base`, afgør `inflight`, byg lageret om og lav et nyt
//! `inflight` af `pending` (sendt værdi = web's værdi ⊕ eget delta),
//! (D) send. Først når web har svaret, regnes det sendte som web's værdi.
//!
//! Web har ingen idempotens eller versionsnøgle på `patterns.upsert`, så et
//! tabt svar afgøres ved næste hentning: er web's værdi den sendte, eller
//! har web mindst de tællere, vi sendte (en anden enhed har bygget videre på
//! vores), er det landet. Ellers lægges deltaet tilbage i `pending` og
//! sendes igen oven på web's aktuelle værdi. Samme tjek fanger, at en anden
//! enhed har overskrevet vores push (sidste vinder): så sendes vores delta
//! igen. Tvivl afgøres altid mod for få stemmer, aldrig dobbelte.
//!
//! TODO(web): et rent delta kræver, at web lægger til i stedet for at
//! erstatte, fx `extension.patterns.applyDeltas({ deltas: [{ key, votes:
//! [{ target, weight, confirmations, corrections, aiAnswers }] }],
//! idempotencyKey })`, hvor web lægger vægt og tællere til (gulv 0) og
//! husker `idempotencyKey` som `time.create`. Så kan desktop sende sit
//! `pending` direkte og gentage et tabt kald uden risiko.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tt_data as td;
use tt_matcher::learning::Vote;
use tt_matcher::{LearnedPattern, PatternKey, PatternStore, Target};

use super::{Engine, lock, other};
use crate::backend::Result;
use crate::backend::services::{PatternSyncReport, PatternWeb};

/// Web: højst 50 stemmer pr. mønster.
const MAX_VOTES: usize = 50;
/// Web: vægt og tællere højst 1.000.000.
const MAX_VALUE: f64 = 1_000_000.0;
/// Mindre vægtforskelle end dette er afrunding, ikke læring.
const EPS: f64 = 1e-4;

/// Ændringen af én stemme: forskelle, kan være negative (en afvisning
/// halverer vægten).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoteDelta {
    pub target: Target,
    #[serde(default)]
    pub weight: f64,
    #[serde(default)]
    pub confirmations: i64,
    #[serde(default)]
    pub corrections: i64,
    #[serde(default)]
    pub ai_answers: i64,
}

impl VoteDelta {
    fn is_zero(&self) -> bool {
        self.weight.abs() <= EPS
            && self.confirmations == 0
            && self.corrections == 0
            && self.ai_answers == 0
    }

    fn has_positive_counts(&self) -> bool {
        self.confirmations > 0 || self.corrections > 0 || self.ai_answers > 0
    }
}

type Deltas = BTreeMap<Target, VoteDelta>;

/// Et sendt mønster, der venter på at blive afgjort ved næste hentning.
#[derive(Debug, Clone, Default, PartialEq)]
struct Inflight {
    sent: Vec<Vote>,
    delta: Deltas,
    /// Web svarede ja. `base` er da allerede den sendte værdi.
    confirmed: bool,
}

/// Synkroniseringens tilstand. Gemmes i `patterns.json` ved siden af
/// mønstrene (feltet `sync`), så de to altid skrives sammen.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(from = "SyncFile", into = "SyncFile")]
pub struct SyncState {
    /// "bruger@org". `None` = aldrig synkroniseret.
    scope: Option<String>,
    /// `serverTime` fra web's sidste svar.
    cursor: Option<DateTime<Utc>>,
    base: BTreeMap<PatternKey, Vec<Vote>>,
    pending: BTreeMap<PatternKey, Deltas>,
    inflight: BTreeMap<PatternKey, Inflight>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor: Option<DateTime<Utc>>,
    #[serde(default)]
    base: Vec<LearnedPattern>,
    #[serde(default)]
    pending: Vec<KeyDelta>,
    #[serde(default)]
    inflight: Vec<InflightFile>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyDelta {
    key: PatternKey,
    votes: Vec<VoteDelta>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InflightFile {
    key: PatternKey,
    sent: Vec<Vote>,
    delta: Vec<VoteDelta>,
    #[serde(default)]
    confirmed: bool,
}

fn deltas_of(v: Vec<VoteDelta>) -> Deltas {
    v.into_iter().map(|d| (d.target.clone(), d)).collect()
}

impl From<SyncFile> for SyncState {
    fn from(f: SyncFile) -> Self {
        SyncState {
            scope: f.scope,
            cursor: f.cursor,
            base: f.base.into_iter().map(|p| (p.key, p.votes)).collect(),
            pending: f
                .pending
                .into_iter()
                .map(|k| (k.key, deltas_of(k.votes)))
                .collect(),
            inflight: f
                .inflight
                .into_iter()
                .map(|i| {
                    (
                        i.key,
                        Inflight {
                            sent: i.sent,
                            delta: deltas_of(i.delta),
                            confirmed: i.confirmed,
                        },
                    )
                })
                .collect(),
        }
    }
}

impl From<SyncState> for SyncFile {
    fn from(s: SyncState) -> Self {
        SyncFile {
            scope: s.scope,
            cursor: s.cursor,
            base: s
                .base
                .into_iter()
                .map(|(key, votes)| LearnedPattern { key, votes })
                .collect(),
            pending: s
                .pending
                .into_iter()
                .map(|(key, d)| KeyDelta {
                    key,
                    votes: d.into_values().collect(),
                })
                .collect(),
            inflight: s
                .inflight
                .into_iter()
                .map(|(key, i)| InflightFile {
                    key,
                    sent: i.sent,
                    delta: i.delta.into_values().collect(),
                    confirmed: i.confirmed,
                })
                .collect(),
        }
    }
}

/// Samme regel som `PatternStore::learn`: en stemme uden vægt og uden
/// menneskelige tællere forsvinder.
fn keep(v: &Vote) -> bool {
    v.weight > 0.01 || v.confirmations + v.corrections > 0
}

fn clamp_count(base: u32, delta: i64) -> u32 {
    (i64::from(base) + delta).clamp(0, MAX_VALUE as i64) as u32
}

/// `base` ⊕ `delta`: vægt og tællere lagt sammen, gulv 0 og loft som web.
fn apply(base: &[Vote], delta: &Deltas) -> Vec<Vote> {
    let mut m: BTreeMap<Target, Vote> = base.iter().map(|v| (v.target.clone(), v.clone())).collect();
    for (t, d) in delta {
        let v = m.entry(t.clone()).or_insert_with(|| Vote {
            target: t.clone(),
            weight: 0.0,
            confirmations: 0,
            corrections: 0,
            ai_answers: 0,
        });
        v.weight = (f64::from(v.weight) + d.weight).clamp(0.0, MAX_VALUE) as f32;
        v.confirmations = clamp_count(v.confirmations, d.confirmations);
        v.corrections = clamp_count(v.corrections, d.corrections);
        v.ai_answers = clamp_count(v.ai_answers, d.ai_answers);
    }
    m.into_values().filter(keep).collect()
}

/// `local` − `from` pr. mål; nul-forskelle udelades.
fn diff(local: &[Vote], from: &[Vote]) -> Deltas {
    let l: BTreeMap<&Target, &Vote> = local.iter().map(|v| (&v.target, v)).collect();
    let f: BTreeMap<&Target, &Vote> = from.iter().map(|v| (&v.target, v)).collect();
    let targets: BTreeSet<&Target> = l.keys().chain(f.keys()).copied().collect();
    let zero = |t: &Target| Vote {
        target: t.clone(),
        weight: 0.0,
        confirmations: 0,
        corrections: 0,
        ai_answers: 0,
    };
    let mut out = Deltas::new();
    for t in targets {
        let a = l.get(t).map_or_else(|| zero(t), |v| (*v).clone());
        let b = f.get(t).map_or_else(|| zero(t), |v| (*v).clone());
        let d = VoteDelta {
            target: t.clone(),
            weight: f64::from(a.weight) - f64::from(b.weight),
            confirmations: i64::from(a.confirmations) - i64::from(b.confirmations),
            corrections: i64::from(a.corrections) - i64::from(b.corrections),
            ai_answers: i64::from(a.ai_answers) - i64::from(b.ai_answers),
        };
        if !d.is_zero() {
            out.insert(t.clone(), d);
        }
    }
    out
}

fn add(into: &mut Deltas, d: &Deltas) {
    for (t, v) in d {
        let e = into.entry(t.clone()).or_insert_with(|| VoteDelta {
            target: t.clone(),
            ..Default::default()
        });
        e.weight += v.weight;
        e.confirmations += v.confirmations;
        e.corrections += v.corrections;
        e.ai_answers += v.ai_answers;
    }
    into.retain(|_, v| !v.is_zero());
}

/// Samme stemmer (rækkefølge er ligegyldig, vægt med afrunding).
fn votes_eq(a: &[Vote], b: &[Vote]) -> bool {
    a.len() == b.len()
        && a.iter().all(|x| {
            b.iter().any(|y| {
                x.target == y.target
                    && (f64::from(x.weight) - f64::from(y.weight)).abs()
                        <= 1e-3 * f64::from(x.weight.abs().max(1.0))
                    && x.confirmations == y.confirmations
                    && x.corrections == y.corrections
                    && x.ai_answers == y.ai_answers
            })
        })
}

/// Har web mindst de tællere, vi sendte, på de mål, vores delta talte op?
/// Så har web (eller en enhed, der byggede videre) vores ændring.
fn dominates(web: &[Vote], inf: &Inflight) -> bool {
    let positive: Vec<&VoteDelta> = inf.delta.values().filter(|d| d.has_positive_counts()).collect();
    !positive.is_empty()
        && positive.iter().all(|d| {
            let Some(s) = inf.sent.iter().find(|v| v.target == d.target) else {
                return true; // skåret fra ved loftet på 50 stemmer
            };
            web.iter().find(|v| v.target == d.target).is_some_and(|w| {
                w.confirmations >= s.confirmations
                    && w.corrections >= s.corrections
                    && w.ai_answers >= s.ai_answers
            })
        })
}

/// Højst 50 stemmer (de tungeste), som web tager.
fn cap(mut votes: Vec<Vote>) -> Vec<Vote> {
    if votes.len() > MAX_VOTES {
        votes.sort_by(|a, b| b.weight.total_cmp(&a.weight).then_with(|| a.target.cmp(&b.target)));
        votes.truncate(MAX_VOTES);
        votes.sort_by(|a, b| a.target.cmp(&b.target));
    }
    votes
}

fn record(key: &PatternKey, votes: &[Vote]) -> td::LearnedPatternRecord {
    td::LearnedPatternRecord {
        key: serde_json::to_value(key).unwrap_or_default(),
        votes: serde_json::to_value(votes).unwrap_or_default(),
        updated_at: None,
    }
}

/// Web's række som matcherens type. Ukendte nøgler (en nyere web) springes over.
fn parse(r: &td::LearnedPatternRecord) -> Option<(PatternKey, Vec<Vote>)> {
    let key = serde_json::from_value(r.key.clone()).ok()?;
    let votes = serde_json::from_value(r.votes.clone()).ok()?;
    Some((key, votes))
}

impl SyncState {
    /// Ventende egne ændringer (nøgler).
    #[cfg(test)]
    pub fn pending_keys(&self) -> usize {
        self.pending.len() + self.inflight.values().filter(|i| !i.confirmed).count()
    }

    /// Web's værdi ⊕ det sendte, men ubekræftede delta: det, `pending` er
    /// en forskel fra.
    fn before_pending(&self, key: &PatternKey) -> Vec<Vote> {
        let base = self.base.get(key).cloned().unwrap_or_default();
        match self.inflight.get(key) {
            Some(i) if !i.confirmed => apply(&base, &i.delta),
            _ => base,
        }
    }

    fn shadow(&self, key: &PatternKey) -> Vec<Vote> {
        let before = self.before_pending(key);
        match self.pending.get(key) {
            Some(d) => apply(&before, d),
            None => before,
        }
    }

    fn keys(&self) -> BTreeSet<PatternKey> {
        self.base
            .keys()
            .chain(self.pending.keys())
            .chain(self.inflight.keys())
            .cloned()
            .collect()
    }

    /// Start en runde for `scope`. En anden bruger/org end sidst: tilstanden
    /// og lageret ryddes (cursoren nulstilles), så intet blandes ind eller
    /// sendes til den forkerte konto. Første gang nogensinde bliver hele det
    /// lokale lager egne ændringer, der sendes én gang.
    pub fn begin(&mut self, scope: &str, store: &mut PatternStore) {
        match self.scope.as_deref() {
            Some(s) if s == scope => {}
            Some(_) => {
                *self = SyncState::default();
                *store = PatternStore::new();
            }
            None => *self = SyncState::default(),
        }
        self.scope = Some(scope.to_owned());
        self.observe(store);
    }

    /// Det, lageret afviger fra web's værdi ⊕ det sendte, er egne ændringer.
    pub fn observe(&mut self, store: &PatternStore) {
        let local: BTreeMap<&PatternKey, &Vec<Vote>> =
            store.patterns.iter().map(|p| (&p.key, &p.votes)).collect();
        let mut keys = self.keys();
        keys.extend(local.keys().map(|k| (*k).clone()));
        for key in keys {
            let mine = local.get(&key).map_or(&[][..], |v| v.as_slice());
            let d = diff(mine, &self.before_pending(&key));
            if d.is_empty() {
                self.pending.remove(&key);
            } else {
                self.pending.insert(key, d);
            }
        }
    }

    /// Lageret som `base` ⊕ `inflight` ⊕ `pending`, i `prev`'s rækkefølge.
    pub fn local_store(&self, prev: &PatternStore) -> PatternStore {
        let mut keys: Vec<PatternKey> = prev.patterns.iter().map(|p| p.key.clone()).collect();
        let seen: BTreeSet<PatternKey> = keys.iter().cloned().collect();
        keys.extend(self.keys().into_iter().filter(|k| !seen.contains(k)));
        PatternStore {
            patterns: keys
                .into_iter()
                .filter_map(|key| {
                    let votes = self.shadow(&key);
                    (!votes.is_empty()).then_some(LearnedPattern { key, votes })
                })
                .collect(),
        }
    }

    /// Web's ændringer ind i `base`; det sendte afgøres (se modulet).
    fn apply_pull(&mut self, pulled: Vec<(PatternKey, Vec<Vote>)>, server_time: Option<DateTime<Utc>>) {
        for (key, votes) in pulled {
            if votes.is_empty() {
                self.base.remove(&key);
            } else {
                self.base.insert(key, votes);
            }
        }
        for (key, inf) in std::mem::take(&mut self.inflight) {
            let web = self.base.get(&key).map_or(&[][..], |v| v.as_slice());
            let ok = if inf.confirmed {
                // Landet; er det overskrevet siden af en, der ikke havde det?
                inf.delta.values().all(|d| !d.has_positive_counts())
                    || votes_eq(web, &inf.sent)
                    || dominates(web, &inf)
            } else {
                votes_eq(web, &inf.sent) || dominates(web, &inf)
            };
            if !ok {
                add(self.pending.entry(key).or_default(), &inf.delta);
            }
        }
        self.pending.retain(|_, d| !d.is_empty());
        if server_time.is_some() {
            self.cursor = server_time;
        }
    }

    /// `pending` bliver til det, der sendes nu: web's værdi ⊕ eget delta.
    fn make_outbox(&mut self) -> Vec<td::LearnedPatternRecord> {
        for (key, delta) in std::mem::take(&mut self.pending) {
            let base = self.base.get(&key).cloned().unwrap_or_default();
            let sent = cap(apply(&base, &delta));
            self.inflight.insert(
                key,
                Inflight {
                    sent,
                    delta,
                    confirmed: false,
                },
            );
        }
        self.inflight
            .iter()
            .filter(|(_, i)| !i.confirmed)
            .map(|(k, i)| record(k, &i.sent))
            .collect()
    }

    /// Web har gemt `keys`: det sendte er nu web's værdi.
    fn confirm(&mut self, keys: &[PatternKey]) {
        for key in keys {
            if let Some(i) = self.inflight.get_mut(key) {
                i.confirmed = true;
                if i.sent.is_empty() {
                    self.base.remove(key);
                } else {
                    self.base.insert(key.clone(), i.sent.clone());
                }
            }
        }
    }

    /// Web afviste nøglen for altid (fx et mål, der ikke findes): glem den
    /// egne ændring, så den ikke sendes igen og igen.
    fn reject(&mut self, key: &PatternKey) {
        self.inflight.remove(key);
    }

    fn unconfirmed(&self) -> Vec<(PatternKey, Vec<Vote>)> {
        self.inflight
            .iter()
            .filter(|(_, i)| !i.confirmed)
            .map(|(k, i)| (k.clone(), i.sent.clone()))
            .collect()
    }
}

fn data_err(e: &td::DataError) -> crate::backend::BackendError {
    other(format!("Mønstrene kunne ikke synkroniseres: {e}"))
}

impl Engine {
    /// Én synkroniseringsrunde (se modulet). Fejler hentningen eller
    /// afsendelsen (offline), venter de egne ændringer til næste runde.
    pub(super) fn run_pattern_sync(&self, web: &dyn PatternWeb, scope: &str) -> Result<PatternSyncReport> {
        let _single = lock(&self.pattern_sync);
        let mut report = PatternSyncReport::default();

        // A: scope og egne ændringer siden sidst.
        let since = {
            let mut p = lock(&self.patterns);
            let p = &mut *p;
            let before = p.store.clone();
            p.sync.begin(scope, &mut p.store);
            if p.store != before {
                p.generation += 1;
            }
            self.save_patterns(p);
            p.sync.cursor.unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
        };

        // B: web's ændringer. Altid med `since` (uden cache).
        let listed = web.list(since).map_err(|e| data_err(&e))?;
        let pulled: Vec<(PatternKey, Vec<Vote>)> = listed.patterns.iter().filter_map(parse).collect();
        report.pulled = pulled.len();

        // C: ind i lageret, og det næste, der skal sendes.
        let outbox = {
            let mut p = lock(&self.patterns);
            let p = &mut *p;
            p.sync.observe(&p.store);
            p.sync.apply_pull(pulled, listed.server_time);
            let rebuilt = p.sync.local_store(&p.store);
            if rebuilt != p.store {
                p.store = rebuilt;
                p.generation += 1;
            }
            let out = p.sync.make_outbox();
            self.save_patterns(p);
            out
        };
        if outbox.is_empty() {
            return Ok(report);
        }

        // D: send. Et svar, der ikke kommer, afgøres ved næste hentning.
        match web.upsert(outbox) {
            Ok(_) => {
                let keys: Vec<PatternKey> = {
                    let p = lock(&self.patterns);
                    p.sync.unconfirmed().into_iter().map(|(k, _)| k).collect()
                };
                report.pushed = keys.len();
                self.finish(|s| s.confirm(&keys));
            }
            Err(e) if e.is_definite_rejection() => {
                // Ét mønster med et ukendt mål afviser hele kaldet: send dem
                // enkeltvis, og glem kun dem, web afviser.
                let unconfirmed = lock(&self.patterns).sync.unconfirmed();
                for (key, votes) in unconfirmed {
                    match web.upsert(vec![record(&key, &votes)]) {
                        Ok(_) => {
                            report.pushed += 1;
                            self.finish(|s| s.confirm(std::slice::from_ref(&key)));
                        }
                        Err(e) if e.is_definite_rejection() => {
                            report.rejected += 1;
                            eprintln!("TimeTrack: web afviste et lært mønster; det glemmes");
                            self.finish(|s| s.reject(&key));
                        }
                        Err(e) => return Err(data_err(&e)),
                    }
                }
            }
            Err(e) => return Err(data_err(&e)),
        }
        Ok(report)
    }

    /// Ændr tilstanden efter et svar fra web og byg lageret om.
    fn finish(&self, f: impl FnOnce(&mut SyncState)) {
        let mut p = lock(&self.patterns);
        let p = &mut *p;
        p.sync.observe(&p.store);
        f(&mut p.sync);
        let rebuilt = p.sync.local_store(&p.store);
        if rebuilt != p.store {
            p.store = rebuilt;
            p.generation += 1;
        }
        self.save_patterns(p);
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod web_tests;
