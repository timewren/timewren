//! Synkroniseringen mod en web i hukommelsen, der fletter præcis som web's
//! `extension.patterns.upsert` (erstatter pr. bruger, org og nøgle; sidste
//! vinder) og `list({ since })` (60 s overlap). Enhederne er rigtige
//! motorer i hver sin mappe; læringen er matcherens egen.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, TimeZone, Utc};
use serde_json::Value;
use tt_ai as tai;
use tt_data as td;
use tt_matcher as mm;
use tt_matcher::{Feedback, Target};

use super::super::Engine;
use super::super::lock;
use crate::backend::services::{PatternSyncReport, PatternWeb};

// ---------------------------------------------------------------- fake web

type Hook = Box<dyn FnOnce() + Send>;

#[derive(Default)]
struct WebState {
    /// (scope, nøgle) → (stemmer, updatedAt i sekunder).
    rows: BTreeMap<(String, String), (Value, i64)>,
    clock: i64,
    fail_list: usize,
    /// Afvis før lagring (fx offline).
    fail_upsert: usize,
    /// Gem, men svaret går tabt.
    lose_reply: usize,
    /// Mål, web kender (`None` = alle). Ukendte giver NOT_FOUND for hele kaldet.
    known: Option<BTreeSet<String>>,
    upserts: usize,
}

#[derive(Default)]
struct FakeWeb {
    state: Mutex<WebState>,
    /// Køres lige før næste upsert gemmes (til at flette en anden enhed ind).
    before_store: Mutex<Option<Hook>>,
}

fn time(secs: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 27, 8, 0, 0).unwrap() + Duration::seconds(secs)
}

/// Web's `patternKeyHash`: JSON med sorterede felter (serde_json's `Map`
/// er sorteret).
fn key_id(key: &Value) -> String {
    key.to_string()
}

impl FakeWeb {
    fn conn(self: &Arc<Self>, scope: &str) -> Conn {
        Conn {
            web: self.clone(),
            scope: scope.into(),
        }
    }

    fn votes(&self, scope: &str, key: &mm::PatternKey) -> Vec<mm::learning::Vote> {
        let id = key_id(&serde_json::to_value(key).unwrap());
        self.state
            .lock()
            .unwrap()
            .rows
            .get(&(scope.to_string(), id))
            .map(|(v, _)| serde_json::from_value(v.clone()).unwrap())
            .unwrap_or_default()
    }

    fn rows(&self, scope: &str) -> usize {
        self.state.lock().unwrap().rows.keys().filter(|(s, _)| s == scope).count()
    }
}

struct Conn {
    web: Arc<FakeWeb>,
    scope: String,
}

impl PatternWeb for Conn {
    fn list(&self, since: DateTime<Utc>) -> td::Result<td::LearnedPatterns> {
        let mut s = self.web.state.lock().unwrap();
        if s.fail_list > 0 {
            s.fail_list -= 1;
            return Err(td::DataError::Offline);
        }
        s.clock += 1;
        let from = since - Duration::seconds(60);
        let mut rows: Vec<_> = s
            .rows
            .iter()
            .filter(|((scope, _), (_, at))| scope == &self.scope && time(*at) >= from)
            .collect();
        rows.sort_by_key(|(_, (_, at))| *at);
        Ok(td::LearnedPatterns {
            server_time: Some(time(s.clock)),
            patterns: rows
                .into_iter()
                .map(|((_, key), (votes, at))| td::LearnedPatternRecord {
                    key: serde_json::from_str(key).unwrap(),
                    votes: votes.clone(),
                    updated_at: Some(time(*at)),
                })
                .collect(),
        })
    }

    fn upsert(&self, patterns: Vec<td::LearnedPatternRecord>) -> td::Result<usize> {
        {
            let mut s = self.web.state.lock().unwrap();
            if s.fail_upsert > 0 {
                s.fail_upsert -= 1;
                return Err(td::DataError::Offline);
            }
            if let Some(known) = &s.known {
                let unknown = patterns.iter().any(|p| {
                    p.votes.as_array().unwrap().iter().any(|v| {
                        ["clientId", "projectId"].iter().any(|f| {
                            v["target"][*f].as_str().is_some_and(|id| !known.contains(id))
                        })
                    })
                });
                if unknown {
                    return Err(td::DataError::NotFound);
                }
            }
        }
        let hook = self.web.before_store.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
        let mut s = self.web.state.lock().unwrap();
        s.clock += 1;
        s.upserts += 1;
        let now = s.clock;
        let mut keys = BTreeSet::new();
        for p in patterns {
            let id = key_id(&p.key);
            s.rows.insert((self.scope.clone(), id.clone()), (p.votes, now));
            keys.insert(id);
        }
        if s.lose_reply > 0 {
            s.lose_reply -= 1;
            return Err(td::DataError::Timeout);
        }
        Ok(keys.len())
    }
}

// ---------------------------------------------------------------- enheder

const SCOPE: &str = "u1@o1";

fn engine(dir: &Path) -> Engine {
    Engine::new(dir.to_path_buf(), None).with_secrets(Arc::new(tai::MemorySecrets::default()))
}

fn seg(domain: &str) -> mm::ActivitySegment {
    mm::ActivitySegment {
        app: "Google Chrome".into(),
        title: String::new(),
        url: Some(format!("https://{domain}/side")),
        start: 0,
        end: 600,
        ..Default::default()
    }
}

fn bageriet() -> mm::PatternKey {
    mm::PatternKey::Domain {
        domain: "bageriet.dk".into(),
    }
}

fn t_a() -> Target {
    Target::client("k-a")
}

fn t_b() -> Target {
    Target::client("k-b")
}

/// Lær som `Engine::learn` gør (lageret ændres og gemmes).
fn learn(e: &Engine, domain: &str, target: &Target, feedback: Feedback) {
    let mut p = lock(&e.patterns);
    p.store.learn(&[&seg(domain)], target, &feedback);
    p.generation += 1;
    e.save_patterns(&p);
}

fn confirm(e: &Engine, n: usize) {
    for _ in 0..n {
        learn(e, "bageriet.dk", &t_a(), Feedback::Confirm);
    }
}

fn sync(e: &Engine, web: &Arc<FakeWeb>) -> crate::backend::Result<PatternSyncReport> {
    e.run_pattern_sync(&web.conn(SCOPE), SCOPE)
}

fn local_votes(e: &Engine, key: &mm::PatternKey) -> Vec<mm::learning::Vote> {
    lock(&e.patterns)
        .store
        .patterns
        .iter()
        .find(|p| &p.key == key)
        .map(|p| p.votes.clone())
        .unwrap_or_default()
}

fn vote(votes: &[mm::learning::Vote], t: &Target) -> (u32, f32) {
    votes
        .iter()
        .find(|v| &v.target == t)
        .map_or((0, 0.0), |v| (v.confirmations, v.weight))
}

/// Web's stemme for bageriet.dk → A: (bekræftelser, vægt).
fn web_a(web: &FakeWeb) -> (u32, f32) {
    vote(&web.votes(SCOPE, &bageriet()), &t_a())
}

fn local_a(e: &Engine) -> (u32, f32) {
    vote(&local_votes(e, &bageriet()), &t_a())
}

fn approx(a: (u32, f32), b: (u32, f32)) -> bool {
    a.0 == b.0 && (a.1 - b.1).abs() < 1e-3
}

// ---------------------------------------------------------------- tests

#[test]
fn to_enheder_i_flere_runder_giver_summen_aldrig_dobbelt() {
    let web = Arc::new(FakeWeb::default());
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, b) = (engine(da.path()), engine(db.path()));
    confirm(&a, 2);
    confirm(&b, 3);
    let mut total = 5;
    for round in 0..4 {
        sync(&a, &web).unwrap();
        sync(&b, &web).unwrap();
        sync(&a, &web).unwrap();
        assert_eq!(web_a(&web), (total, total as f32), "runde {round}");
        // Begge enheder ser web's sum, ikke mere.
        assert_eq!(local_a(&a), (total, total as f32), "A, runde {round}");
        sync(&b, &web).unwrap();
        assert_eq!(local_a(&b), (total, total as f32), "B, runde {round}");
        // Ny læring på begge enheder mellem runderne.
        confirm(&a, 1);
        confirm(&b, 1);
        total += 2;
    }
    // Runder uden ny læring sender intet.
    sync(&a, &web).unwrap();
    sync(&b, &web).unwrap();
    let before = web.state.lock().unwrap().upserts;
    for _ in 0..3 {
        sync(&a, &web).unwrap();
        sync(&b, &web).unwrap();
    }
    assert_eq!(web.state.lock().unwrap().upserts, before);
    assert_eq!(web_a(&web), (total, total as f32));
}

#[test]
fn rettelser_og_afvisninger_synkroniseres_som_aendringer() {
    let web = Arc::new(FakeWeb::default());
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, b) = (engine(da.path()), engine(db.path()));
    confirm(&a, 2);
    sync(&a, &web).unwrap();
    sync(&b, &web).unwrap();
    // B retter fra A til B: A's vægt halveres, B får en stemme.
    learn(&b, "bageriet.dk", &t_b(), Feedback::Correct { from: Some(t_a()) });
    sync(&b, &web).unwrap();
    sync(&a, &web).unwrap();
    let w = web.votes(SCOPE, &bageriet());
    assert_eq!(vote(&w, &t_a()), (2, 1.0));
    assert_eq!(vote(&w, &t_b()).1, 1.5);
    assert_eq!(local_votes(&a, &bageriet()).len(), 2);
    assert!(approx(local_a(&a), (2, 1.0)));
}

#[test]
fn et_push_der_fejler_sendes_igen_uden_dobbelttaelling() {
    let web = Arc::new(FakeWeb::default());
    let d = tempfile::tempdir().unwrap();
    let a = engine(d.path());
    confirm(&a, 2);
    web.state.lock().unwrap().fail_upsert = 1;
    assert!(sync(&a, &web).is_err());
    assert_eq!(web.rows(SCOPE), 0);
    // Imens lærer enheden mere; begge dele sendes én gang.
    confirm(&a, 1);
    sync(&a, &web).unwrap();
    assert_eq!(web_a(&web), (3, 3.0));
    for _ in 0..3 {
        sync(&a, &web).unwrap();
    }
    assert_eq!(web_a(&web), (3, 3.0));
    assert_eq!(local_a(&a), (3, 3.0));
}

#[test]
fn offline_hentning_lader_aendringerne_vente() {
    let web = Arc::new(FakeWeb::default());
    let d = tempfile::tempdir().unwrap();
    let a = engine(d.path());
    confirm(&a, 1);
    web.state.lock().unwrap().fail_list = 2;
    assert!(sync(&a, &web).is_err());
    confirm(&a, 1);
    assert!(sync(&a, &web).is_err());
    assert_eq!(lock(&a.patterns).sync.pending_keys(), 1);
    sync(&a, &web).unwrap();
    assert_eq!(web_a(&web), (2, 2.0));
}

#[test]
fn et_tabt_svar_efter_web_har_gemt_taelles_ikke_dobbelt() {
    let web = Arc::new(FakeWeb::default());
    let d = tempfile::tempdir().unwrap();
    let a = engine(d.path());
    confirm(&a, 2);
    web.state.lock().unwrap().lose_reply = 1;
    assert!(sync(&a, &web).is_err());
    assert_eq!(web_a(&web), (2, 2.0), "web gemte trods det tabte svar");
    for _ in 0..3 {
        sync(&a, &web).unwrap();
    }
    assert_eq!(web_a(&web), (2, 2.0));
    assert_eq!(local_a(&a), (2, 2.0));
    confirm(&a, 1);
    sync(&a, &web).unwrap();
    assert_eq!(web_a(&web), (3, 3.0));
}

#[test]
fn et_tabt_svar_og_en_anden_enhed_der_byggede_videre_taelles_ikke_dobbelt() {
    let web = Arc::new(FakeWeb::default());
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, b) = (engine(da.path()), engine(db.path()));
    confirm(&a, 2);
    web.state.lock().unwrap().lose_reply = 1;
    assert!(sync(&a, &web).is_err());
    // B henter A's værdi og lægger sin egen læring oven på.
    confirm(&b, 1);
    sync(&b, &web).unwrap();
    assert_eq!(web_a(&web), (3, 3.0));
    // A afgør sit tabte svar: web har mindst A's tællere, så det er landet.
    sync(&a, &web).unwrap();
    sync(&b, &web).unwrap();
    assert_eq!(web_a(&web), (3, 3.0));
    assert_eq!(local_a(&a), (3, 3.0));
}

#[test]
fn et_mislykket_push_og_en_anden_enheds_push_giver_summen() {
    let web = Arc::new(FakeWeb::default());
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, b) = (engine(da.path()), engine(db.path()));
    confirm(&a, 2);
    web.state.lock().unwrap().fail_upsert = 1;
    assert!(sync(&a, &web).is_err());
    confirm(&b, 1);
    sync(&b, &web).unwrap();
    sync(&a, &web).unwrap();
    assert_eq!(web_a(&web), (3, 3.0));
}

#[test]
fn et_push_der_overskrives_af_en_anden_enhed_sendes_igen() {
    // Sidste vinder på web: B sender sin værdi (uden A's) lige efter A.
    let web = Arc::new(FakeWeb::default());
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let a = Arc::new(engine(da.path()));
    let b = engine(db.path());
    confirm(&a, 2);
    confirm(&b, 1);
    {
        let (a, web2) = (a.clone(), web.clone());
        // B har hentet (tom web) og er ved at gemme; imens når A at sende.
        *web.before_store.lock().unwrap() = Some(Box::new(move || {
            sync(&a, &web2).unwrap();
        }));
    }
    sync(&b, &web).unwrap();
    assert_eq!(web_a(&web), (1, 1.0), "B overskrev A");
    sync(&a, &web).unwrap();
    assert_eq!(web_a(&web), (3, 3.0), "A sendte sit delta igen");
    sync(&b, &web).unwrap();
    sync(&a, &web).unwrap();
    assert_eq!(web_a(&web), (3, 3.0));
    assert_eq!(local_a(&b), (3, 3.0));
}

#[test]
fn hentning_efter_genstart_og_ventende_aendringer_overlever() {
    let web = Arc::new(FakeWeb::default());
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let b = engine(db.path());
    {
        let a = engine(da.path());
        confirm(&a, 2);
        sync(&a, &web).unwrap();
        // Lært efter sidste runde, ikke sendt endnu.
        confirm(&a, 1);
    }
    confirm(&b, 4);
    sync(&b, &web).unwrap();
    let a = engine(da.path());
    assert_eq!(local_a(&a), (3, 3.0), "lageret efter genstart");
    sync(&a, &web).unwrap();
    assert_eq!(web_a(&web), (7, 7.0));
    assert_eq!(local_a(&a), (7, 7.0));
    // Kun det nye siden cursoren hentes.
    let r = sync(&a, &web).unwrap();
    assert_eq!((r.pushed, r.rejected), (0, 0));
}

#[test]
fn et_sendt_men_ubekraeftet_push_overlever_en_genstart() {
    let web = Arc::new(FakeWeb::default());
    let d = tempfile::tempdir().unwrap();
    {
        let a = engine(d.path());
        confirm(&a, 2);
        web.state.lock().unwrap().lose_reply = 1;
        assert!(sync(&a, &web).is_err());
    }
    let a = engine(d.path());
    sync(&a, &web).unwrap();
    sync(&a, &web).unwrap();
    assert_eq!(web_a(&web), (2, 2.0));
    assert_eq!(local_a(&a), (2, 2.0));
}

#[test]
fn skift_af_org_blander_ikke_moenstre_sammen() {
    let web = Arc::new(FakeWeb::default());
    let d = tempfile::tempdir().unwrap();
    let a = engine(d.path());
    confirm(&a, 2);
    sync(&a, &web).unwrap();
    // Anden org: lageret ryddes, cursoren nulstilles, intet sendes dertil.
    let other = "u1@o2";
    learn(&a, "andet.dk", &t_b(), Feedback::Confirm);
    a.run_pattern_sync(&web.conn(other), other).unwrap();
    assert_eq!(web.rows(other), 0);
    assert!(lock(&a.patterns).store.is_empty());
    // Org 2's egne mønstre hentes og sendes kun dertil.
    learn(&a, "org2.dk", &t_b(), Feedback::Confirm);
    a.run_pattern_sync(&web.conn(other), other).unwrap();
    assert_eq!(web.rows(other), 1);
    assert_eq!(web.rows(SCOPE), 1);
    assert_eq!(web_a(&web), (2, 2.0));
    // Tilbage til org 1: alt hentes forfra fra web, intet fra org 2 følger med.
    sync(&a, &web).unwrap();
    assert_eq!(local_a(&a), (2, 2.0));
    assert_eq!(lock(&a.patterns).store.len(), 1);
    assert_eq!(web.rows(SCOPE), 1);
}

#[test]
fn foerste_synkronisering_sender_det_lokalt_laerte_een_gang() {
    let web = Arc::new(FakeWeb::default());
    let d = tempfile::tempdir().unwrap();
    let a = engine(d.path());
    confirm(&a, 3);
    let r = sync(&a, &web).unwrap();
    assert_eq!(r.pushed, 1);
    let r = sync(&a, &web).unwrap();
    assert_eq!(r.pushed, 0);
    assert_eq!(web_a(&web), (3, 3.0));
}

#[test]
fn moenstre_med_ukendte_maal_glemmes_resten_sendes() {
    let web = Arc::new(FakeWeb::default());
    web.state.lock().unwrap().known = Some(["k-a".to_string()].into());
    let d = tempfile::tempdir().unwrap();
    let a = engine(d.path());
    confirm(&a, 1);
    learn(&a, "slettet.dk", &t_b(), Feedback::Confirm);
    let r = sync(&a, &web).unwrap();
    assert_eq!((r.pushed, r.rejected), (1, 1));
    assert_eq!(web_a(&web), (1, 1.0));
    // Det afviste sendes ikke igen og er væk lokalt.
    let r = sync(&a, &web).unwrap();
    assert_eq!((r.pushed, r.rejected), (0, 0));
    assert_eq!(lock(&a.patterns).store.len(), 1);
}

#[test]
fn tilstanden_gemmes_i_patterns_json_og_lokal_fil_er_uaendret() {
    let d = tempfile::tempdir().unwrap();
    let a = engine(d.path());
    confirm(&a, 1);
    let raw = std::fs::read_to_string(d.path().join("patterns.json")).unwrap();
    assert!(!raw.contains("\"sync\""), "lokal: ingen sync-tilstand: {raw}");
    // Ældre versioner læser filen som PatternStore.
    let web = Arc::new(FakeWeb::default());
    sync(&a, &web).unwrap();
    let raw = std::fs::read_to_string(d.path().join("patterns.json")).unwrap();
    assert!(raw.contains("\"sync\""));
    let old: mm::PatternStore = serde_json::from_str(&raw).unwrap();
    assert_eq!(old.len(), 1);
}
