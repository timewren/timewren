//! Brugerens rækkefølge af udbydere, samtykke til cloud og svar-cache.
//!
//! Samme spørgsmål stilles aldrig to gange: svaret (også "ingen passer")
//! gemmes under en nøgle, der er en hash af blokken og kandidaterne. Kører to
//! tråde det samme spørgsmål samtidig, venter den anden på den første.

use crate::sanitize;
use crate::types::{AiError, BlockSummary, Candidate, Classification, Classifier, ProviderInfo};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};

/// Højeste antal svar i cachen. Ældste smides ud først.
pub const CACHE_CAPACITY: usize = 5_000;

/// Hash af et spørgsmål. Indeholder ingen rå tekst og kan gemmes trygt.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct QuestionKey(pub String);

impl QuestionKey {
    /// Nøglen bygges af de rensede felter, som prompten bruger, og de sorterede
    /// kandidat-id'er. Varigheden indgår ikke: samme titel er samme spørgsmål.
    pub fn new(block: &BlockSummary, candidates: &[Candidate]) -> Self {
        let mut h = Sha256::new();
        let field = |h: &mut Sha256, tag: &str, v: &str| {
            h.update(tag.as_bytes());
            h.update((v.len() as u64).to_le_bytes());
            h.update(v.as_bytes());
        };
        field(
            &mut h,
            "app",
            &sanitize::for_prompt(&block.app).to_lowercase(),
        );
        field(
            &mut h,
            "title",
            &sanitize::for_prompt(&block.title).to_lowercase(),
        );
        field(
            &mut h,
            "domain",
            &block
                .domain
                .as_deref()
                .map(sanitize::for_prompt)
                .unwrap_or_default(),
        );
        field(
            &mut h,
            "path",
            &block
                .path
                .as_deref()
                .map(sanitize::for_prompt)
                .unwrap_or_default(),
        );
        field(
            &mut h,
            "branch",
            &block
                .git_branch
                .as_deref()
                .map(sanitize::for_prompt)
                .unwrap_or_default(),
        );
        // Navne og nøgleord indgår også: ændrer brugeren dem, kan svaret ændre sig.
        let mut ids: Vec<String> = candidates
            .iter()
            .map(|c| {
                let mut kw: Vec<String> =
                    c.keywords.iter().map(|k| sanitize::for_prompt(k)).collect();
                kw.sort();
                serde_json::json!([
                    c.client_id,
                    c.project_id,
                    sanitize::for_prompt(&c.client_name),
                    c.project_name.as_deref().map(sanitize::for_prompt),
                    kw
                ])
                .to_string()
            })
            .collect();
        ids.sort();
        ids.dedup();
        for id in ids {
            field(&mut h, "cand", &id);
        }
        Self(hex::encode(h.finalize()))
    }
}

/// Et gemt svar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CachedAnswer {
    /// `None` = AI'en mente, at ingen kandidat passer.
    pub classification: Option<Classification>,
    pub provider_id: String,
}

/// Hvor svaret kom fra.
#[derive(Debug, Clone, PartialEq)]
pub enum AnswerSource {
    Cache,
    Provider(ProviderInfo),
    /// Ingen udbyder gav et svar (ingen konfigureret, alle sprunget over eller fejlede).
    None,
}

/// Hvad der skete med hver udbyder i kæden.
#[derive(Debug)]
pub enum AttemptOutcome {
    Answered,
    /// Udbyderen sender data væk fra maskinen, og brugeren har ikke sagt ja.
    SkippedNoConsent,
    Failed(AiError),
}

#[derive(Debug)]
pub struct Attempt {
    pub provider: ProviderInfo,
    pub outcome: AttemptOutcome,
}

/// Resultatet af ét spørgsmål til kæden.
#[derive(Debug)]
pub struct ChainResult {
    pub key: QuestionKey,
    pub answer: Option<Classification>,
    pub source: AnswerSource,
    pub attempts: Vec<Attempt>,
}

impl ChainResult {
    /// Sandt, hvis der findes et svar, `tt-matcher` kan gemme som mønster.
    pub fn is_new_answer(&self) -> bool {
        matches!(self.source, AnswerSource::Provider(_)) && self.answer.is_some()
    }
}

#[derive(Default, Serialize, Deserialize)]
struct CacheData {
    entries: HashMap<QuestionKey, CachedAnswer>,
    order: VecDeque<QuestionKey>,
}

/// Rækkefølgen af udbydere + cache. Deles mellem tråde via `Arc`.
pub struct ProviderChain {
    providers: Vec<Arc<dyn Classifier>>,
    cloud_opt_in: Mutex<bool>,
    cache: Mutex<CacheData>,
    inflight: Mutex<HashSet<QuestionKey>>,
    inflight_done: Condvar,
}

impl ProviderChain {
    /// Udbyderne prøves i den givne rækkefølge. Cloud er slået fra fra start.
    pub fn new(providers: Vec<Arc<dyn Classifier>>) -> Self {
        Self {
            providers,
            cloud_opt_in: Mutex::new(false),
            cache: Mutex::new(CacheData::default()),
            inflight: Mutex::new(HashSet::new()),
            inflight_done: Condvar::new(),
        }
    }

    /// Kæde uden udbydere: alt virker, der kommer bare aldrig AI-svar.
    pub fn disabled() -> Self {
        Self::new(Vec::new())
    }

    /// Brugerens samtykke til, at titler må forlade maskinen.
    pub fn set_cloud_opt_in(&self, on: bool) {
        *self.cloud_opt_in.lock().unwrap_or_else(|p| p.into_inner()) = on;
    }

    pub fn cloud_opt_in(&self) -> bool {
        *self.cloud_opt_in.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn providers(&self) -> Vec<ProviderInfo> {
        self.providers.iter().map(|p| p.info()).collect()
    }

    /// Stiller spørgsmålet, medmindre det er stillet før.
    pub fn classify(&self, block: &BlockSummary, candidates: &[Candidate]) -> ChainResult {
        let key = QuestionKey::new(block, candidates);

        if let Some(hit) = self.cached(&key) {
            return cached_result(key, hit);
        }
        // Single-flight: vent, hvis en anden tråd allerede spørger.
        {
            let mut inflight = self.inflight.lock().unwrap_or_else(|p| p.into_inner());
            let mut waited = false;
            while inflight.contains(&key) {
                waited = true;
                inflight = self
                    .inflight_done
                    .wait(inflight)
                    .unwrap_or_else(|p| p.into_inner());
            }
            if let Some(hit) = self.cached(&key) {
                return cached_result(key, hit);
            }
            // Den anden tråds runde gav intet svar (fejl). Gentag den ikke nu;
            // spørgsmålet stilles igen ved næste kald.
            if waited {
                return ChainResult {
                    key,
                    answer: None,
                    source: AnswerSource::None,
                    attempts: Vec::new(),
                };
            }
            inflight.insert(key.clone());
        }
        // Guard, så ventende tråde frigives, selv hvis en udbyder går i panik.
        let _guard = InflightGuard {
            chain: self,
            key: key.clone(),
        };
        self.ask_providers(key.clone(), block, candidates)
    }

    fn ask_providers(
        &self,
        key: QuestionKey,
        block: &BlockSummary,
        candidates: &[Candidate],
    ) -> ChainResult {
        let mut attempts = Vec::new();
        for p in &self.providers {
            let info = p.info();
            // Læses lige før hver udbyder, så et nej midt i en runde virker straks.
            if info.sends_data_off_device && !self.cloud_opt_in() {
                attempts.push(Attempt {
                    provider: info,
                    outcome: AttemptOutcome::SkippedNoConsent,
                });
                continue;
            }
            match p.classify(block, candidates) {
                Ok(answer) => {
                    self.store(
                        key.clone(),
                        CachedAnswer {
                            classification: answer.clone(),
                            provider_id: info.id.clone(),
                        },
                    );
                    attempts.push(Attempt {
                        provider: info.clone(),
                        outcome: AttemptOutcome::Answered,
                    });
                    return ChainResult {
                        key,
                        answer,
                        source: AnswerSource::Provider(info),
                        attempts,
                    };
                }
                // Fejl caches ikke; næste udbyder prøves, og spørgsmålet kan stilles igen senere.
                Err(e) => attempts.push(Attempt {
                    provider: info,
                    outcome: AttemptOutcome::Failed(e),
                }),
            }
        }
        ChainResult {
            key,
            answer: None,
            source: AnswerSource::None,
            attempts,
        }
    }

    pub fn cached(&self, key: &QuestionKey) -> Option<CachedAnswer> {
        self.cache
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .entries
            .get(key)
            .cloned()
    }

    fn store(&self, key: QuestionKey, answer: CachedAnswer) {
        let mut c = self.cache.lock().unwrap_or_else(|p| p.into_inner());
        if c.entries.insert(key.clone(), answer).is_none() {
            c.order.push_back(key);
        }
        while c.order.len() > CACHE_CAPACITY {
            if let Some(old) = c.order.pop_front() {
                c.entries.remove(&old);
            }
        }
    }

    /// Glemmer et svar, fx når brugeren har rettet det (matcheren har så et mønster).
    pub fn forget(&self, key: &QuestionKey) {
        let mut c = self.cache.lock().unwrap_or_else(|p| p.into_inner());
        if c.entries.remove(key).is_some() {
            c.order.retain(|k| k != key);
        }
    }

    pub fn cache_len(&self) -> usize {
        self.cache
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .entries
            .len()
    }

    /// Gemmer cachen som JSON: hashes, id'er og konfidens. Begrundelsen gemmes
    /// ikke, fordi den ofte citerer titlen.
    pub fn save_cache(&self, path: &Path) -> Result<(), AiError> {
        static SAVE_SEQ: AtomicU64 = AtomicU64::new(0);
        let json = {
            let c = self.cache.lock().unwrap_or_else(|p| p.into_inner());
            let mut entries = c.entries.clone();
            for a in entries.values_mut() {
                if let Some(cl) = a.classification.as_mut() {
                    cl.reasoning.clear();
                }
            }
            let data = CacheData {
                entries,
                order: c.order.clone(),
            };
            serde_json::to_vec(&data).map_err(|e| AiError::Io(std::io::Error::other(e)))?
        };
        // Unikt midlertidigt navn, så to samtidige gem ikke skriver i samme fil.
        let seq = SAVE_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp = path.with_extension(format!("tmp-{}-{seq}", std::process::id()));
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Indlæser en gemt cache. En manglende fil er en tom cache; en ødelagt fil er en fejl.
    pub fn load_cache(&self, path: &Path) -> Result<(), AiError> {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        let mut data: CacheData = serde_json::from_slice(&bytes)
            .map_err(|e| AiError::InvalidResponse(format!("cache-filen: {e}")))?;
        data.order.retain(|k| data.entries.contains_key(k));
        *self.cache.lock().unwrap_or_else(|p| p.into_inner()) = data;
        Ok(())
    }
}

struct InflightGuard<'a> {
    chain: &'a ProviderChain,
    key: QuestionKey,
}

impl Drop for InflightGuard<'_> {
    fn drop(&mut self) {
        let mut inflight = self
            .chain
            .inflight
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        inflight.remove(&self.key);
        self.chain.inflight_done.notify_all();
    }
}

fn cached_result(key: QuestionKey, hit: CachedAnswer) -> ChainResult {
    ChainResult {
        key,
        answer: hit.classification,
        source: AnswerSource::Cache,
        attempts: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ProviderKind;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    /// Falsk udbyder, der tæller kald.
    struct Fake {
        id: &'static str,
        off_device: bool,
        reply: Result<Option<usize>, ()>,
        calls: AtomicUsize,
        delay: Duration,
    }

    impl Fake {
        fn new(id: &'static str, off_device: bool, reply: Result<Option<usize>, ()>) -> Arc<Self> {
            Arc::new(Self {
                id,
                off_device,
                reply,
                calls: AtomicUsize::new(0),
                delay: Duration::ZERO,
            })
        }
    }

    impl Classifier for Fake {
        fn info(&self) -> ProviderInfo {
            ProviderInfo {
                id: self.id.into(),
                kind: if self.off_device {
                    ProviderKind::OpenAi
                } else {
                    ProviderKind::Ollama
                },
                model: "m".into(),
                sends_data_off_device: self.off_device,
            }
        }
        fn classify(
            &self,
            _: &BlockSummary,
            c: &[Candidate],
        ) -> Result<Option<Classification>, AiError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(self.delay);
            match self.reply {
                Ok(Some(i)) => Ok(Some(Classification {
                    client_id: c[i].client_id.clone(),
                    project_id: c[i].project_id.clone(),
                    confidence: 0.9,
                    reasoning: "Titlen siger Hemmelig".into(),
                })),
                Ok(None) => Ok(None),
                Err(()) => Err(AiError::Connect("nede".into())),
            }
        }
    }

    fn blok(title: &str) -> BlockSummary {
        BlockSummary {
            app: "Code".into(),
            title: title.into(),
            duration_secs: 60,
            ..Default::default()
        }
    }

    fn kandidater() -> Vec<Candidate> {
        vec![
            Candidate {
                client_id: "k1".into(),
                client_name: "A".into(),
                ..Default::default()
            },
            Candidate {
                client_id: "k2".into(),
                client_name: "B".into(),
                ..Default::default()
            },
        ]
    }

    fn as_dyn(v: Vec<Arc<Fake>>) -> Vec<Arc<dyn Classifier>> {
        v.into_iter().map(|f| f as Arc<dyn Classifier>).collect()
    }

    #[test]
    fn uden_udbydere_kommer_intet_svar() {
        let r = ProviderChain::disabled().classify(&blok("x"), &kandidater());
        assert!(r.answer.is_none());
        assert_eq!(r.source, AnswerSource::None);
    }

    #[test]
    fn rækkefølgen_følges_og_fejl_falder_igennem() {
        let a = Fake::new("a", false, Err(()));
        let b = Fake::new("b", false, Ok(Some(1)));
        let c = Fake::new("c", false, Ok(Some(0)));
        let chain = ProviderChain::new(as_dyn(vec![a.clone(), b.clone(), c.clone()]));
        let r = chain.classify(&blok("x"), &kandidater());
        assert_eq!(r.answer.as_ref().unwrap().client_id, "k2");
        assert!(matches!(r.attempts[0].outcome, AttemptOutcome::Failed(_)));
        assert_eq!(c.calls.load(Ordering::SeqCst), 0);
        assert!(r.is_new_answer());
    }

    #[test]
    fn samme_spørgsmål_stilles_aldrig_to_gange() {
        let a = Fake::new("a", false, Ok(Some(0)));
        let chain = ProviderChain::new(as_dyn(vec![a.clone()]));
        let mut b = blok("Faktura");
        chain.classify(&b, &kandidater());
        b.duration_secs = 999; // varighed ændrer ikke spørgsmålet
        let r = chain.classify(&b, &kandidater());
        assert_eq!(r.source, AnswerSource::Cache);
        assert!(!r.is_new_answer());
        assert_eq!(a.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn ingen_passer_caches_også() {
        let a = Fake::new("a", false, Ok(None));
        let chain = ProviderChain::new(as_dyn(vec![a.clone()]));
        chain.classify(&blok("Netflix"), &kandidater());
        let r = chain.classify(&blok("Netflix"), &kandidater());
        assert!(r.answer.is_none());
        assert_eq!(r.source, AnswerSource::Cache);
        assert_eq!(a.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn fejl_caches_ikke() {
        let a = Fake::new("a", false, Err(()));
        let chain = ProviderChain::new(as_dyn(vec![a.clone()]));
        chain.classify(&blok("x"), &kandidater());
        chain.classify(&blok("x"), &kandidater());
        assert_eq!(a.calls.load(Ordering::SeqCst), 2);
        assert_eq!(chain.cache_len(), 0);
    }

    #[test]
    fn nye_kandidater_er_et_nyt_spørgsmål() {
        let a = Fake::new("a", false, Ok(Some(0)));
        let chain = ProviderChain::new(as_dyn(vec![a.clone()]));
        chain.classify(&blok("x"), &kandidater());
        let mut flere = kandidater();
        flere.push(Candidate {
            client_id: "k3".into(),
            client_name: "C".into(),
            ..Default::default()
        });
        chain.classify(&blok("x"), &flere);
        assert_eq!(a.calls.load(Ordering::SeqCst), 2);
        // Rækkefølgen af kandidater betyder ikke noget.
        let mut omvendt = kandidater();
        omvendt.reverse();
        assert_eq!(
            QuestionKey::new(&blok("x"), &kandidater()),
            QuestionKey::new(&blok("x"), &omvendt)
        );
    }

    #[test]
    fn cloud_springes_over_uden_samtykke() {
        let cloud = Fake::new("cloud", true, Ok(Some(0)));
        let chain = ProviderChain::new(as_dyn(vec![cloud.clone()]));
        assert!(
            !chain.cloud_opt_in(),
            "cloud skal være slået fra som standard"
        );
        let r = chain.classify(&blok("x"), &kandidater());
        assert!(r.answer.is_none());
        assert!(matches!(
            r.attempts[0].outcome,
            AttemptOutcome::SkippedNoConsent
        ));
        assert_eq!(cloud.calls.load(Ordering::SeqCst), 0);

        chain.set_cloud_opt_in(true);
        let r = chain.classify(&blok("x"), &kandidater());
        assert_eq!(r.answer.unwrap().client_id, "k1");
        assert_eq!(cloud.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn samtidige_ens_spørgsmål_giver_ét_kald() {
        let a = Arc::new(Fake {
            id: "a",
            off_device: false,
            reply: Ok(Some(0)),
            calls: AtomicUsize::new(0),
            delay: Duration::from_millis(100),
        });
        let chain = Arc::new(ProviderChain::new(as_dyn(vec![a.clone()])));
        std::thread::scope(|s| {
            for _ in 0..8 {
                let chain = chain.clone();
                s.spawn(move || chain.classify(&blok("samme"), &kandidater()));
            }
        });
        assert_eq!(a.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn cachen_gemmes_og_indlæses_uden_rå_titler() {
        let dir = std::env::temp_dir().join(format!("tt-ai-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ai-cache.json");
        let a = Fake::new("a", false, Ok(Some(1)));
        let chain = ProviderChain::new(as_dyn(vec![a.clone()]));
        chain.classify(&blok("Hemmelig titel 123"), &kandidater());
        chain.save_cache(&path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("Hemmelig"));

        let b = Fake::new("b", false, Ok(Some(0)));
        let fresh = ProviderChain::new(as_dyn(vec![b.clone()]));
        fresh.load_cache(&path).unwrap();
        let r = fresh.classify(&blok("Hemmelig titel 123"), &kandidater());
        assert_eq!(r.answer.unwrap().client_id, "k2");
        assert_eq!(b.calls.load(Ordering::SeqCst), 0);

        fresh.load_cache(&dir.join("findes-ikke.json")).unwrap();
        std::fs::write(&path, "{ødelagt").unwrap();
        assert!(fresh.load_cache(&path).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn forget_gør_at_spørgsmålet_stilles_igen() {
        let a = Fake::new("a", false, Ok(Some(0)));
        let chain = ProviderChain::new(as_dyn(vec![a.clone()]));
        let r = chain.classify(&blok("x"), &kandidater());
        chain.forget(&r.key);
        chain.classify(&blok("x"), &kandidater());
        assert_eq!(a.calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn ændrede_nøgleord_eller_navne_er_et_nyt_spørgsmål() {
        let b = blok("x");
        let før = QuestionKey::new(&b, &kandidater());
        let mut k = kandidater();
        k[0].keywords.push("bageriet.dk".into());
        assert_ne!(før, QuestionKey::new(&b, &k));
        let mut k = kandidater();
        k[1].client_name = "Nyt navn".into();
        assert_ne!(før, QuestionKey::new(&b, &k));
        // Nøgleordenes rækkefølge betyder ikke noget.
        let mut k1 = kandidater();
        k1[0].keywords = vec!["a".into(), "b".into()];
        let mut k2 = kandidater();
        k2[0].keywords = vec!["b".into(), "a".into()];
        assert_eq!(QuestionKey::new(&b, &k1), QuestionKey::new(&b, &k2));
    }

    #[test]
    fn ventende_tråde_gentager_ikke_en_fejlet_runde() {
        let a = Arc::new(Fake {
            id: "a",
            off_device: false,
            reply: Err(()),
            calls: AtomicUsize::new(0),
            delay: Duration::from_millis(150),
        });
        let chain = Arc::new(ProviderChain::new(as_dyn(vec![a.clone()])));
        std::thread::scope(|s| {
            for _ in 0..6 {
                let chain = chain.clone();
                s.spawn(move || chain.classify(&blok("samme"), &kandidater()));
            }
        });
        assert_eq!(a.calls.load(Ordering::SeqCst), 1);
        // Næste kald efter runden spørger igen.
        chain.classify(&blok("samme"), &kandidater());
        assert_eq!(a.calls.load(Ordering::SeqCst), 2);
    }

    /// Lokal udbyder, der slår cloud fra, mens den arbejder.
    struct SlårCloudFra(Arc<ProviderChain>);

    impl Classifier for SlårCloudFra {
        fn info(&self) -> ProviderInfo {
            ProviderInfo {
                id: "lokal".into(),
                kind: ProviderKind::Ollama,
                model: "m".into(),
                sends_data_off_device: false,
            }
        }
        fn classify(
            &self,
            _: &BlockSummary,
            _: &[Candidate],
        ) -> Result<Option<Classification>, AiError> {
            self.0.set_cloud_opt_in(false);
            Err(AiError::Connect("fejlede".into()))
        }
    }

    #[test]
    fn samtykke_trukket_tilbage_midt_i_en_runde_respekteres() {
        let cloud = Fake::new("cloud", true, Ok(Some(0)));
        // Kæden skal kende sig selv via udbyderen; byg den i to trin.
        let holder: Arc<Mutex<Option<Arc<ProviderChain>>>> = Arc::new(Mutex::new(None));
        struct Proxy(Arc<Mutex<Option<Arc<ProviderChain>>>>);
        impl Classifier for Proxy {
            fn info(&self) -> ProviderInfo {
                SlårCloudFra(Arc::new(ProviderChain::disabled())).info()
            }
            fn classify(
                &self,
                b: &BlockSummary,
                c: &[Candidate],
            ) -> Result<Option<Classification>, AiError> {
                let chain = self.0.lock().unwrap().clone().unwrap();
                SlårCloudFra(chain).classify(b, c)
            }
        }
        let chain = Arc::new(ProviderChain::new(vec![
            Arc::new(Proxy(holder.clone())) as Arc<dyn Classifier>,
            cloud.clone() as Arc<dyn Classifier>,
        ]));
        *holder.lock().unwrap() = Some(chain.clone());
        chain.set_cloud_opt_in(true);
        let r = chain.classify(&blok("x"), &kandidater());
        assert!(r.answer.is_none());
        assert!(matches!(
            r.attempts[1].outcome,
            AttemptOutcome::SkippedNoConsent
        ));
        assert_eq!(cloud.calls.load(Ordering::SeqCst), 0);
        *holder.lock().unwrap() = None; // bryd ringen af Arc'er
    }
}
