//! Aktivitet: dagens rå aktivitet som blokke, og brugerens handlinger på
//! dem (tildel, ikke arbejde, flet, del, slet).
//!
//! Blokkene bygges af aktivitets-DB'ens segmenter hver gang (ingen cache):
//!
//! 1. Segmenterne skæres ved alle grænser, der betyder noget: poster,
//!    afgjorte tidsrum, "ikke arbejde", forslag og brugerens delinger.
//! 2. Hvert stykke får en status (registreret, foreslået, uklar, ikke arbejde,
//!    inaktiv) og en identitet (program + repo/mappe/domæne/dokument).
//! 3. Stykker med samme status og identitet lægges sammen, korte skift
//!    foldes ind i naboen, og brugerens fletninger lægges på.
//!
//! Brugerens fletninger, delinger og "ikke arbejde" gemmes i
//! `aktivitet.json` i detektionsmappen. Alt bliver på maskinen (D3).

use std::collections::{BTreeSet, HashMap};

use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use tt_matcher as mm;
use tt_tracker as tr;

use super::{Engine, convert, lock, other, state, unix_now};
use crate::backend::services::RegisteredSpan;
use crate::backend::{
    ActivityBlock, ActivityDay, ActivityStatus, ActivityStorage, BackendError, Customer, Id,
    Project, Result, block_id,
};

/// Stykker med samme identitet og højst så langt imellem hører til én blok.
const MAX_GAP_SECS: i64 = 5 * 60;
/// Brugerens redigeringer glemmes efter samme periode som de afgjorte tidsrum.
const RETAIN_SECS: i64 = 90 * 24 * 3600;

/// Brugerens redigeringer af tidslinjen (`aktivitet.json`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ActivityEdits {
    /// "Ikke arbejde": tidsrum, der aldrig foreslås.
    pub not_work: Vec<(i64, i64)>,
    /// "Flet": blokke helt inde i et tidsrum vises som én.
    pub merges: Vec<(i64, i64)>,
    /// "Del ved tidspunkt": en blok skæres her.
    pub splits: Vec<i64>,
}

impl ActivityEdits {
    pub fn prune(&mut self, now: i64) {
        let keep = now - RETAIN_SECS;
        self.not_work.retain(|s| s.1 >= keep);
        self.merges.retain(|s| s.1 >= keep);
        self.splits.retain(|s| *s >= keep);
    }
}

/// Det, der afgør stykkernes status (unix-sekunder).
#[derive(Clone, Debug, Default)]
pub struct Marks {
    pub registered: Vec<RegisteredSpan>,
    /// Bekræftede/tildelte tidsrum fra `handled.json` (uden mål).
    pub confirmed: Vec<(i64, i64)>,
    pub not_work: Vec<(i64, i64)>,
    pub suggestions: Vec<OpenSuggestion>,
}

/// Et åbent forslag: tidsrum, id, kunde, projekt.
pub type OpenSuggestion = (i64, i64, Id, Option<Id>, Option<Id>);

#[derive(Clone, Debug, PartialEq)]
struct Tag {
    status: ActivityStatus,
    customer_id: Option<Id>,
    project_id: Option<Id>,
    suggestion_id: Option<Id>,
}

impl Tag {
    fn same(&self, o: &Tag) -> bool {
        self == o
    }
}

/// En blok under opbygning.
#[derive(Clone, Debug)]
struct Draft {
    start: i64,
    end: i64,
    tag: Tag,
    identity: String,
    /// Sekunder pr. segment (indeks i dagens segmenter).
    secs: HashMap<usize, i64>,
    folded: u32,
}

impl Draft {
    fn seconds(&self) -> i64 {
        self.secs.values().sum()
    }

    fn absorb(&mut self, o: Draft, fold: bool) {
        self.start = self.start.min(o.start);
        self.end = self.end.max(o.end);
        for (k, v) in o.secs {
            *self.secs.entry(k).or_default() += v;
        }
        self.folded += o.folded + u32::from(fold);
    }
}

/// Identiteten, blokke deles efter: program + det stærkeste signal. Titlen
/// er ikke med, for faner og filer skifter hele tiden.
fn identity(s: &tr::ActivitySegment) -> String {
    if s.idle {
        return "idle".into();
    }
    let signal = s
        .repo_remote
        .as_deref()
        .or(s.repo_root.as_deref())
        .or(s.path.as_deref())
        .or(s.domain.as_deref())
        .or(s.document.as_deref())
        .unwrap_or("");
    format!("{}|{signal}", s.app_id)
}

fn inside(spans: &[(i64, i64)], t: i64) -> bool {
    spans.iter().any(|&(a, b)| a <= t && t < b)
}

fn tag_at(m: i64, idle: bool, marks: &Marks) -> Tag {
    let tag = |status, customer_id, project_id, suggestion_id| Tag {
        status,
        customer_id,
        project_id,
        suggestion_id,
    };
    if idle {
        return tag(ActivityStatus::Idle, None, None, None);
    }
    if let Some(r) = marks.registered.iter().find(|r| r.start <= m && m < r.end) {
        return tag(
            ActivityStatus::Registered,
            r.customer_id.clone(),
            r.project_id.clone(),
            None,
        );
    }
    if inside(&marks.confirmed, m) {
        return tag(ActivityStatus::Registered, None, None, None);
    }
    if inside(&marks.not_work, m) {
        return tag(ActivityStatus::NotWork, None, None, None);
    }
    if let Some(s) = marks.suggestions.iter().find(|s| s.0 <= m && m < s.1) {
        return tag(
            ActivityStatus::Suggested,
            s.3.clone(),
            s.4.clone(),
            Some(s.2.clone()),
        );
    }
    tag(ActivityStatus::Unclear, None, None, None)
}

/// Bygger dagens blokke. `segments` er dagens segmenter (inkl. inaktive),
/// klippet til dagen. Ren funktion: alt input kommer udefra.
pub fn build_blocks(
    segments: &[tr::ActivitySegment],
    marks: &Marks,
    edits: &ActivityEdits,
    fold_secs: i64,
) -> Vec<BlockSpan> {
    let mut cuts: BTreeSet<i64> = edits.splits.iter().copied().collect();
    for r in &marks.registered {
        cuts.extend([r.start, r.end]);
    }
    for s in marks.confirmed.iter().chain(&marks.not_work) {
        cuts.extend([s.0, s.1]);
    }
    for s in &marks.suggestions {
        cuts.extend([s.0, s.1]);
    }

    // 1-2: stykker med status og identitet.
    let mut order: Vec<usize> = (0..segments.len()).collect();
    order.sort_by_key(|&i| (segments[i].start, segments[i].end));
    let mut pieces: Vec<Draft> = Vec::new();
    for i in order {
        let s = &segments[i];
        let (a, b) = (s.start.timestamp(), s.end.timestamp());
        if b <= a {
            continue;
        }
        let mut edges = vec![a];
        edges.extend(cuts.range(a + 1..b).copied());
        edges.push(b);
        for w in edges.windows(2) {
            let (p, q) = (w[0], w[1]);
            pieces.push(Draft {
                start: p,
                end: q,
                tag: tag_at(p + (q - p) / 2, s.idle, marks),
                identity: identity(s),
                secs: HashMap::from([(i, q - p)]),
                folded: 0,
            });
        }
    }

    // 3a: saml naboer med samme status og identitet. Ingen blok krydser en
    // deling, en post eller et forslags kant (de giver hver sin status).
    let joinable = |a: &Draft, b: &Draft| {
        a.tag.same(&b.tag)
            && b.start - a.end <= MAX_GAP_SECS
            && !edits.splits.iter().any(|&t| a.end <= t && t <= b.start)
    };
    let group = |items: Vec<Draft>| {
        let mut out: Vec<Draft> = Vec::new();
        for p in items {
            match out.last_mut() {
                Some(last) if last.identity == p.identity && joinable(last, &p) => {
                    last.absorb(p, false)
                }
                _ => out.push(p),
            }
        }
        out
    };
    let mut blocks = group(pieces);

    // 3b: fold korte skift ind i naboen med samme status (helst den før).
    if fold_secs > 0 {
        let mut out: Vec<Draft> = Vec::new();
        let mut pending: Vec<Draft> = Vec::new();
        for b in blocks {
            let short = b.tag.status != ActivityStatus::Idle && b.seconds() < fold_secs;
            match out.last_mut() {
                Some(last) if short && joinable(last, &b) => last.absorb(b, true),
                _ if short => pending.push(b),
                _ => {
                    // Korte skift før en lang blok foldes ind i den.
                    let mut b = b;
                    let mut keep = Vec::new();
                    for p in pending.drain(..) {
                        if joinable(&p, &b) && !out.last().is_some_and(|l| l.end > p.start) {
                            b.absorb(p, true);
                        } else {
                            keep.push(p);
                        }
                    }
                    out.extend(keep);
                    out.push(b);
                }
            }
        }
        out.extend(pending);
        out.sort_by_key(|d| d.start);
        // Foldningen kan have gjort to blokke med samme identitet til naboer.
        blocks = group(out);
    }

    // 3c: brugerens fletninger.
    for &(a, b) in &edits.merges {
        let mut out: Vec<Draft> = Vec::new();
        for d in blocks {
            let within = a <= d.start && d.end <= b;
            match out.last_mut() {
                Some(last) if within && a <= last.start && last.end <= b => {
                    // Den længste dels status og identitet vinder.
                    if d.seconds() > last.seconds() {
                        last.tag = d.tag.clone();
                        last.identity = d.identity.clone();
                    }
                    last.absorb(d, false);
                }
                _ => out.push(d),
            }
        }
        blocks = out;
    }

    blocks
        .into_iter()
        .map(|d| {
            let mut by_secs: Vec<(usize, i64)> = d.secs.iter().map(|(k, v)| (*k, *v)).collect();
            by_secs.sort_by(|x, y| y.1.cmp(&x.1).then(x.0.cmp(&y.0)));
            let main = by_secs.first().map_or(0, |x| x.0);
            let mut other_apps: Vec<String> = Vec::new();
            for (ix, _) in &by_secs {
                let app = &segments[*ix].app;
                if *app != segments[main].app && !other_apps.contains(app) {
                    other_apps.push(app.clone());
                }
            }
            BlockSpan {
                start: d.start,
                end: d.end,
                seconds: d.seconds(),
                main,
                other_apps,
                folded: d.folded,
                status: d.tag.status,
                customer_id: d.tag.customer_id,
                project_id: d.tag.project_id,
                suggestion_id: d.tag.suggestion_id,
            }
        })
        .collect()
}

/// En færdig blok i unix-sekunder; `main` er segmentet, der fyldte mest.
#[derive(Clone, Debug, PartialEq)]
pub struct BlockSpan {
    pub start: i64,
    pub end: i64,
    pub seconds: i64,
    pub main: usize,
    pub other_apps: Vec<String>,
    pub folded: u32,
    pub status: ActivityStatus,
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    pub suggestion_id: Option<Id>,
}

/// En blok som UI'ets blok på `date` (lokal tid).
pub fn to_ui_block(
    date: NaiveDate,
    b: &BlockSpan,
    segments: &[tr::ActivitySegment],
) -> ActivityBlock {
    let s = &segments[b.main];
    let (d0, t0) = convert::local_datetime(b.start);
    let (d1, t1) = convert::local_datetime(b.end);
    let start = if d0 < date { NaiveTime::MIN } else { t0 };
    let end = if d1 > date {
        NaiveTime::from_hms_opt(23, 59, 59).unwrap_or(t1)
    } else {
        t1
    };
    ActivityBlock {
        id: block_id(b.start, b.end),
        date,
        start,
        end,
        seconds: b.seconds.max(0) as u32,
        // Trackerens idle-segmenter hedder "Idle"; UI'et viser statussen.
        app: if b.status == ActivityStatus::Idle { String::new() } else { s.app.clone() },
        title: s.title.clone(),
        url: s.url.clone(),
        domain: s.domain.clone(),
        repo: s.repo_remote.clone().or_else(|| s.repo_root.clone()),
        document: s.document.clone(),
        other_apps: b.other_apps.clone(),
        folded: b.folded,
        status: b.status,
        customer_id: b.customer_id.clone(),
        project_id: b.project_id.clone(),
        suggestion_id: b.suggestion_id.clone(),
    }
}

fn utc(ts: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(ts, 0)
        .single()
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
}

impl Engine {
    fn edits_path(&self) -> std::path::PathBuf {
        self.dir.join("aktivitet.json")
    }

    pub(super) fn load_edits(dir: &std::path::Path, warnings: &mut Vec<String>) -> ActivityEdits {
        let mut e: ActivityEdits =
            state::read_json(&dir.join("aktivitet.json"), warnings).unwrap_or_default();
        e.prune(unix_now());
        e
    }

    fn edit(&self, f: impl FnOnce(&mut ActivityEdits)) -> Result<()> {
        let mut edits = lock(&self.edits);
        f(&mut edits);
        state::write_json_atomic(&self.edits_path(), &*edits)
            .map_err(|e| other(format!("Ændringen kunne ikke gemmes: {e}")))?;
        drop(edits);
        self.signal_change();
        Ok(())
    }

    /// "Ikke arbejde"-tidsrummene, som forslagene også skal se bort fra.
    pub(super) fn not_work_spans(&self) -> Vec<(i64, i64)> {
        lock(&self.edits).not_work.clone()
    }

    fn fold_secs(&self) -> i64 {
        lock(&self.settings)
            .as_ref()
            .map_or(i64::from(crate::backend::FOLD_SHORT_SECS), |s| {
                i64::from(s.tracking.fold_short_secs)
            })
    }

    /// Kun indstillingerne, uden sporing, AI-kæde eller nøglering
    /// (`--diagnose-activity`). Appen bruger `apply_settings`.
    pub fn set_settings_only(&self, settings: crate::backend::Settings) {
        *lock(&self.settings) = Some(settings);
    }

    fn retention_days(&self) -> i64 {
        lock(&self.settings)
            .as_ref()
            .map_or(14, |s| i64::from(s.tracking.retention_days.max(1)))
    }

    pub(super) fn with_store<T>(
        &self,
        f: impl FnOnce(&tr::ActivityStore) -> std::result::Result<T, tr::StoreError>,
    ) -> Result<T> {
        let store = lock(&self.store);
        let store = store
            .as_ref()
            .ok_or_else(|| other("Aktivitetsdatabasen kunne ikke åbnes"))?;
        f(store).map_err(|e| other(format!("Aktiviteten kunne ikke læses: {e}")))
    }

    pub(super) fn build_activity_day(
        &self,
        date: NaiveDate,
        customers: &[Customer],
        projects: &[Project],
        registered: &[RegisteredSpan],
    ) -> Result<ActivityDay> {
        use crate::backend::services::Detection;
        let earliest = chrono::Local::now().date_naive()
            - Duration::days(self.retention_days().saturating_sub(1));
        // Forslagene først: de fylder cachen, som "Bekræft" bruger.
        let suggestions = self.suggestions(date, customers, projects)?;
        let segments = self.with_store(|s| s.segments_for_day(date, true))?;
        let mut marks = Marks {
            registered: registered.to_vec(),
            confirmed: lock(&self.handled).confirmed_spans(),
            not_work: self.not_work_spans(),
            suggestions: Vec::new(),
        };
        {
            let cache = lock(&self.cache);
            for s in &suggestions {
                if let Some(c) = cache.get(&s.id) {
                    marks.suggestions.push((
                        c.block.start,
                        c.block.end,
                        s.id.clone(),
                        s.customer_id.clone(),
                        s.project_id.clone(),
                    ));
                }
            }
        }
        let edits = lock(&self.edits).clone();
        let blocks = build_blocks(&segments, &marks, &edits, self.fold_secs())
            .iter()
            .map(|b| to_ui_block(date, b, &segments))
            .collect();
        Ok(ActivityDay {
            date,
            blocks,
            earliest,
        })
    }

    pub(super) fn assigned(
        &self,
        spans: &[(i64, i64)],
        customer_id: &str,
        project_id: Option<&str>,
        remember: bool,
        customers: &[Customer],
        projects: &[Project],
    ) {
        let target = mm::Target {
            client_id: Some(customer_id.to_string()).filter(|c| !c.is_empty()),
            project_id: project_id.map(str::to_string),
        };
        if let Some(&(_, end)) = spans.last() {
            self.record_usage(&target, end);
        }
        if remember {
            let mut segs: Vec<mm::ActivitySegment> = Vec::new();
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
            if !segs.is_empty() {
                let block = mm::Suggestion {
                    start: segs.iter().map(|s| s.start).min().unwrap_or(0),
                    end: segs.iter().map(|s| s.end).max().unwrap_or(0),
                    target: None,
                    confidence: 0.0,
                    source: None,
                    reason: String::new(),
                    segment_indices: (0..segs.len()).collect(),
                    absorbed_interruptions: 0,
                    held_back: None,
                };
                let catalog = convert::catalog(customers, projects, &lock(&self.web));
                let mut guard = lock(&self.patterns);
                let mut matcher = mm::Matcher::new(catalog, std::mem::take(&mut guard.store));
                matcher.correct(&segs, &block, &target);
                guard.store = matcher.patterns;
                guard.generation += 1;
                self.save_patterns(&guard);
            }
        }
        self.mark_handled(spans, state::Handling::Confirmed);
        // Forslag i de tidsrum er nu afgjort.
        lock(&self.cache).retain(|_, c| {
            !spans
                .iter()
                .any(|&(a, b)| c.block.start < b && a < c.block.end)
        });
        self.signal_change();
    }

    pub(super) fn not_work(&self, spans: &[(i64, i64)]) -> Result<()> {
        // Forslag, der lå her, er ikke længere åbne.
        lock(&self.cache).retain(|_, c| {
            !spans
                .iter()
                .any(|&(a, b)| c.block.start < b && a < c.block.end)
        });
        self.edit(|e| e.not_work.extend_from_slice(spans))
    }

    pub(super) fn merge(&self, span: (i64, i64)) -> Result<()> {
        self.edit(|e| {
            // Delinger inde i fletningen ophæves.
            e.splits.retain(|&t| !(span.0 < t && t < span.1));
            e.merges.push(span);
        })
    }

    pub(super) fn split(&self, span: (i64, i64), at: i64) -> Result<()> {
        if !(span.0 < at && at < span.1) {
            return Err(BackendError::Validation(
                "Tidspunktet skal ligge inde i blokken".into(),
            ));
        }
        self.edit(|e| {
            // En fletning hen over delingen ophæves, ellers samler den igen.
            e.merges.retain(|m| !(m.0 < at && at < m.1));
            if !e.splits.contains(&at) {
                e.splits.push(at);
            }
        })
    }

    pub(super) fn delete(&self, spans: &[(i64, i64)]) -> Result<()> {
        for &(a, b) in spans {
            self.with_store(|s| s.cut_between(utc(a), utc(b)))?;
        }
        lock(&self.cache).retain(|_, c| {
            !spans
                .iter()
                .any(|&(a, b)| c.block.start < b && a < c.block.end)
        });
        self.signal_change();
        Ok(())
    }

    pub(super) fn delete_all(&self) -> Result<()> {
        self.with_store(|s| s.delete_all())?;
        lock(&self.cache).clear();
        // Brugerens model er lært af aktiviteten (mapper, værter, hashede
        // titelord): den slettes med. Mønstrene (patterns.json) er generaliserede
        // nøgler og synkroniseres; dem rører "Slet al aktivitet" ikke, som før.
        {
            let mut p = lock(&self.patterns);
            p.model = tt_matcher::UserModel::default();
            let _ = std::fs::remove_file(self.dir.join("model.json"));
        }
        self.edit(|e| *e = ActivityEdits::default())
    }

    pub(super) fn exclusions(&self) -> Result<Vec<crate::backend::StoredExclusion>> {
        let rules = self.with_store(|s| s.list_exclusion_rules())?;
        Ok(rules
            .into_iter()
            .filter(|r| r.is_active)
            .map(|r| crate::backend::StoredExclusion {
                id: r.id,
                field: r.field,
                op: r.op,
                value: r.value,
            })
            .collect())
    }

    /// Trackeren læser tabellen igen inden for et minut.
    pub(super) fn remove_exclusion(&self, id: i64) -> Result<()> {
        self.with_store(|s| s.delete_exclusion_rule(id))?;
        Ok(())
    }

    pub(super) fn storage(&self) -> Result<ActivityStorage> {
        let (stats, days) =
            self.with_store(|s| Ok((s.stats()?, s.days_with_activity_in(&chrono::Local)?)))?;
        let db = self.dir.join("activity.db");
        let bytes = ["", "-wal", "-shm"]
            .iter()
            .filter_map(|ext| std::fs::metadata(format!("{}{ext}", db.display())).ok())
            .map(|m| m.len())
            .sum();
        Ok(ActivityStorage {
            days: days.len() as u32,
            segments: stats.segments,
            bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(app: &str, domain: Option<&str>, a: i64, b: i64) -> tr::ActivitySegment {
        tr::ActivitySegment {
            id: None,
            app: app.into(),
            app_id: app.to_lowercase(),
            title: format!("{app} vindue"),
            url: domain.map(|d| format!("https://{d}/")),
            domain: domain.map(str::to_string),
            repo_remote: None,
            repo_root: None,
            branch: None,
            path: None,
            document: None,
            start: utc(a),
            end: utc(b),
            idle: false,
        }
    }

    fn idle(a: i64, b: i64) -> tr::ActivitySegment {
        tr::ActivitySegment {
            idle: true,
            ..seg("Idle", None, a, b)
        }
    }

    fn spans(blocks: &[BlockSpan]) -> Vec<(i64, i64, ActivityStatus)> {
        blocks.iter().map(|b| (b.start, b.end, b.status)).collect()
    }

    const T: i64 = 1_800_000_000;

    #[test]
    fn same_identity_joins_and_idle_is_its_own_block() {
        let segs = vec![
            seg("Safari", Some("bageriet.dk"), T, T + 600),
            seg("Safari", Some("bageriet.dk"), T + 600, T + 1200),
            idle(T + 1200, T + 1800),
            seg("Code", None, T + 1800, T + 2400),
        ];
        let b = build_blocks(&segs, &Marks::default(), &ActivityEdits::default(), 30);
        assert_eq!(
            spans(&b),
            vec![
                (T, T + 1200, ActivityStatus::Unclear),
                (T + 1200, T + 1800, ActivityStatus::Idle),
                (T + 1800, T + 2400, ActivityStatus::Unclear),
            ]
        );
        assert_eq!(b[0].seconds, 1200);
    }

    #[test]
    fn en_inaktiv_blok_har_intet_programnavn() {
        // Set på en rigtig Mac: "22:49-23:00, Idle, 10 min, Inaktiv". Trackerens
        // interne navn "Idle" er engelsk; UI'et skriver selv "Inaktiv".
        let segs = vec![seg("Code", None, T, T + 600), idle(T + 600, T + 1200)];
        let b = build_blocks(&segs, &Marks::default(), &ActivityEdits::default(), 30);
        let date = convert::local_datetime(T + 600).0;
        let ui = to_ui_block(date, &b[1], &segs);
        assert_eq!(ui.status, ActivityStatus::Idle);
        assert_eq!(ui.app, "");
        assert_eq!(to_ui_block(date, &b[0], &segs).app, "Code");
    }

    #[test]
    fn short_switches_fold_into_the_neighbour() {
        let segs = vec![
            seg("Code", None, T, T + 600),
            seg("Slack", None, T + 600, T + 610),
            seg("Code", None, T + 610, T + 1200),
            // Kort skift først på dagen foldes ind i blokken efter.
            seg("Mail", None, T + 2000, T + 2005),
            seg("Figma", None, T + 2005, T + 3000),
        ];
        let b = build_blocks(&segs, &Marks::default(), &ActivityEdits::default(), 30);
        assert_eq!(
            spans(&b),
            vec![
                (T, T + 1200, ActivityStatus::Unclear),
                (T + 2000, T + 3000, ActivityStatus::Unclear),
            ]
        );
        assert_eq!(b[0].folded, 1);
        assert_eq!(b[0].other_apps, vec!["Slack".to_string()]);
        assert_eq!(segs[b[1].main].app, "Figma");
        // Uden foldning står skiftet for sig.
        let b = build_blocks(&segs, &Marks::default(), &ActivityEdits::default(), 0);
        assert_eq!(b.len(), 5);
    }

    #[test]
    fn status_follows_entries_suggestions_and_not_work() {
        let segs = vec![seg("Code", None, T, T + 4000)];
        let marks = Marks {
            registered: vec![RegisteredSpan {
                start: T,
                end: T + 1000,
                customer_id: Some("k1".into()),
                project_id: None,
            }],
            confirmed: vec![],
            not_work: vec![(T + 1000, T + 2000)],
            suggestions: vec![(T + 2000, T + 3000, "fs_1".into(), Some("k2".into()), None)],
        };
        let b = build_blocks(&segs, &marks, &ActivityEdits::default(), 30);
        assert_eq!(
            spans(&b),
            vec![
                (T, T + 1000, ActivityStatus::Registered),
                (T + 1000, T + 2000, ActivityStatus::NotWork),
                (T + 2000, T + 3000, ActivityStatus::Suggested),
                (T + 3000, T + 4000, ActivityStatus::Unclear),
            ]
        );
        assert_eq!(b[0].customer_id.as_deref(), Some("k1"));
        assert_eq!(b[2].suggestion_id.as_deref(), Some("fs_1"));
        assert_eq!(b[2].customer_id.as_deref(), Some("k2"));
    }

    #[test]
    fn split_and_merge() {
        let segs = vec![
            seg("Code", None, T, T + 3600),
            seg("Safari", Some("a.dk"), T + 3600, T + 4000),
        ];
        let mut edits = ActivityEdits {
            splits: vec![T + 1800],
            ..Default::default()
        };
        let b = build_blocks(&segs, &Marks::default(), &edits, 30);
        assert_eq!(
            spans(&b).iter().map(|x| (x.0, x.1)).collect::<Vec<_>>(),
            vec![(T, T + 1800), (T + 1800, T + 3600), (T + 3600, T + 4000)]
        );
        edits.merges.push((T + 1800, T + 4000));
        let b = build_blocks(&segs, &Marks::default(), &edits, 30);
        assert_eq!(
            spans(&b).iter().map(|x| (x.0, x.1)).collect::<Vec<_>>(),
            vec![(T, T + 1800), (T + 1800, T + 4000)]
        );
        assert_eq!(segs[b[1].main].app, "Code", "den længste del vinder");
        assert_eq!(b[1].other_apps, vec!["Safari".to_string()]);
    }

    #[test]
    fn edits_are_pruned() {
        let mut e = ActivityEdits {
            not_work: vec![(0, 10), (T, T + 1)],
            merges: vec![(0, 10)],
            splits: vec![5, T],
        };
        e.prune(T);
        assert_eq!(e.not_work, vec![(T, T + 1)]);
        assert!(e.merges.is_empty());
        assert_eq!(e.splits, vec![T]);
    }
}
