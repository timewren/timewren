//! Rangering af AI'ens kandidater.
//!
//! AI'en kan kun se et begrænset antal valgmuligheder (tt-ai sender højst 40).
//! Har brugeren flere kunder og projekter, skal pladserne gå til dem, der er
//! mest sandsynlige for netop denne blok. Rangeringen er ren og deterministisk:
//! samme blok, katalog, mønstre og brug giver altid samme rækkefølge.
//!
//! Score = signal · [`W_SIGNAL`] + nylighed · [`W_RECENCY`] + frekvens · [`W_FREQUENCY`]
//! - **signal** (0..1): matcherens eget bud pr. segment (regler, URL-mønstre,
//!   identitet, kundens domæner, site-koblinger, lærte mønstre og navne i
//!   titel, domæne, repo og mappe), vægtet med den tid hvert segment fylder.
//!   Et projekts træf tæller også for dets kunde.
//! - **nylighed** (0..1): halveres for hver [`HALF_LIFE_SECS`] siden målet sidst
//!   blev brugt (målt fra blokkens slut, ikke fra uret).
//! - **frekvens** (0..1): antal gange målet er brugt, logaritmisk i forhold til
//!   det mest brugte mål.
//!
//! Ved lige score vinder den oprindelige rækkefølge (kunder før projekter, som
//! kataloget har dem).

use serde::{Deserialize, Serialize};

use crate::classifier::ClassifierOption;
use crate::matcher::Matcher;
use crate::types::{ActivitySegment, SegmentMatch, Target};

pub const W_SIGNAL: f32 = 10.0;
pub const W_RECENCY: f32 = 2.0;
pub const W_FREQUENCY: f32 = 1.0;
/// Nylighedens halveringstid: to uger.
pub const HALF_LIFE_SECS: i64 = 14 * 24 * 3600;
/// Højst så mange nøgleord pr. kandidat.
const MAX_KEYWORDS: usize = 5;

/// Hvor ofte og hvornår et mål er brugt (bekræftet eller rettet til).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetUsage {
    pub client_id: Option<String>,
    pub project_id: Option<String>,
    /// Unix-sekunder.
    pub last_used: i64,
    pub uses: u32,
}

/// Brugen pr. mål. Gemmes af appen ved siden af mønstrene.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStore {
    pub entries: Vec<TargetUsage>,
}

/// Højst så mange mål gemmes; de mindst brugte og ældste smides ud.
const MAX_USAGE_ENTRIES: usize = 2_000;

impl UsageStore {
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Noterer, at `target` blev brugt på tidspunktet `at`.
    pub fn record(&mut self, target: &Target, at: i64) {
        if target.is_empty() {
            return;
        }
        match self
            .entries
            .iter_mut()
            .find(|e| e.client_id == target.client_id && e.project_id == target.project_id)
        {
            Some(e) => {
                e.uses = e.uses.saturating_add(1);
                e.last_used = e.last_used.max(at);
            }
            None => self.entries.push(TargetUsage {
                client_id: target.client_id.clone(),
                project_id: target.project_id.clone(),
                last_used: at,
                uses: 1,
            }),
        }
        if self.entries.len() > MAX_USAGE_ENTRIES {
            self.entries.sort_by(|a, b| {
                b.last_used
                    .cmp(&a.last_used)
                    .then_with(|| b.uses.cmp(&a.uses))
            });
            self.entries.truncate(MAX_USAGE_ENTRIES);
        }
    }

    /// Brugen for en kandidat. Et projekts brug tæller også for dets kunde.
    fn of(&self, client: Option<&str>, project: Option<&str>) -> (i64, u32) {
        self.entries
            .iter()
            .filter(|e| match project {
                Some(p) => e.project_id.as_deref() == Some(p),
                None => client.is_some() && e.client_id.as_deref() == client,
            })
            .fold((i64::MIN, 0u32), |(last, uses), e| {
                (last.max(e.last_used), uses.saturating_add(e.uses))
            })
    }
}

/// Nylighed 0..1: 1 lige nu, 0,5 efter en halveringstid.
fn recency(last_used: i64, now: i64) -> f32 {
    if last_used == i64::MIN {
        return 0.0;
    }
    let age = (now - last_used).max(0) as f64;
    0.5f64.powf(age / HALF_LIFE_SECS as f64) as f32
}

/// En kandidats score med dens enkelte led, til test og fejlsøgning.
#[derive(Debug, Clone, PartialEq)]
pub struct Scored {
    pub option: ClassifierOption,
    pub signal: f32,
    pub recency: f32,
    pub frequency: f32,
    pub score: f32,
}

impl Matcher {
    /// Kandidaterne i rækkefølge efter sandsynlighed, med score.
    ///
    /// `now` er det tidspunkt, nylighed måles fra (blokkens slut).
    pub fn rank_options(
        &self,
        segs: &[&ActivitySegment],
        options: Vec<ClassifierOption>,
        now: i64,
    ) -> Vec<Scored> {
        // Signal pr. mål: tid · konfidens, delt med blokkens samlede tid.
        let total: i64 = segs.iter().map(|s| s.duration()).sum::<i64>().max(1);
        let mut hits: Vec<(Target, f32)> = Vec::new();
        for seg in segs {
            if let SegmentMatch::Match(c) = self.match_segment(seg) {
                let w = c.confidence * seg.duration() as f32 / total as f32;
                hits.push((c.target, w));
            }
        }
        let signal_of = |o: &ClassifierOption| -> f32 {
            let s: f32 = hits
                .iter()
                .filter(|(t, _)| match &o.project_id {
                    Some(p) => t.project_id.as_deref() == Some(p),
                    None => o.client_id.is_some() && t.client_id == o.client_id,
                })
                .map(|(_, w)| w)
                .sum();
            s.min(1.0)
        };

        let max_uses = options
            .iter()
            .map(|o| {
                self.usage
                    .of(o.client_id.as_deref(), o.project_id.as_deref())
                    .1
            })
            .max()
            .unwrap_or(0);
        let mut scored: Vec<Scored> = options
            .into_iter()
            .map(|option| {
                let signal = signal_of(&option);
                let (last, uses) = self
                    .usage
                    .of(option.client_id.as_deref(), option.project_id.as_deref());
                let recency = recency(last, now);
                let frequency = if max_uses == 0 {
                    0.0
                } else {
                    (1.0 + uses as f32).ln() / (1.0 + max_uses as f32).ln()
                };
                let score = signal * W_SIGNAL + recency * W_RECENCY + frequency * W_FREQUENCY;
                Scored {
                    option,
                    signal,
                    recency,
                    frequency,
                    score,
                }
            })
            .collect();
        // Stabil sortering: lige score beholder kataloget rækkefølge.
        scored.sort_by(|a, b| b.score.total_cmp(&a.score));
        scored
    }

    /// Nøgleord, der hjælper AI'en med at kende en kunde eller et projekt:
    /// kundens egne domæner og de repos, mapper og domæner, brugeren har bundet til målet.
    pub fn keywords_for(&self, client: Option<&str>, project: Option<&str>) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut push = |v: &str| {
            let v = v.trim();
            if !v.is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(v)) {
                out.push(v.to_string());
            }
        };
        if project.is_none()
            && let Some(c) = client.and_then(|id| self.catalog.client(id))
        {
            for d in &c.domains {
                push(d);
            }
        }
        for b in &self.catalog.identities {
            let Some(t) = &b.target else { continue };
            let hit = match project {
                Some(p) => t.project_id.as_deref() == Some(p),
                None => t.project_id.is_none() && t.client_id.as_deref() == client,
            };
            if hit {
                push(&b.value);
            }
        }
        out.truncate(MAX_KEYWORDS);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::learning::PatternStore;
    use crate::types::{Catalog, Client, IdentityBinding, IdentityKind, Project};

    const DAY: i64 = 24 * 3600;

    fn seg(app: &str, title: &str, url: Option<&str>) -> ActivitySegment {
        ActivitySegment {
            app: app.into(),
            title: title.into(),
            url: url.map(Into::into),
            start: 0,
            end: 1800,
            ..Default::default()
        }
    }

    fn catalog(n: usize) -> Catalog {
        let mut clients = vec![
            Client {
                id: "c-bag".into(),
                name: "Bageriet".into(),
                domains: vec!["bageriet.example".into()],
                archived: false,
                ..Default::default()
            },
            Client {
                id: "c-fri".into(),
                name: "Frisør Nord".into(),
                ..Default::default()
            },
        ];
        for i in 0..n {
            clients.push(Client {
                id: format!("c-fyld-{i}"),
                name: format!("Fyld {i}"),
                ..Default::default()
            });
        }
        Catalog {
            clients,
            projects: vec![Project {
                id: "p-bag-web".into(),
                name: "Webshop".into(),
                client_id: Some("c-bag".into()),
                ..Default::default()
            }],
            identities: vec![IdentityBinding {
                kind: IdentityKind::RepoRemote,
                value: "github.com/example/bageriet-web".into(),
                app: None,
                target: Some(Target::project(Some("c-bag"), "p-bag-web")),
            }],
            ..Default::default()
        }
    }

    fn options(m: &Matcher) -> Vec<ClassifierOption> {
        let mut v = Vec::new();
        for c in &m.catalog.clients {
            v.push(ClassifierOption {
                client_id: Some(c.id.clone()),
                client_name: Some(c.name.clone()),
                ..Default::default()
            });
        }
        for p in &m.catalog.projects {
            v.push(ClassifierOption {
                client_id: p.client_id.clone(),
                client_name: None,
                project_id: Some(p.id.clone()),
                project_name: Some(p.name.clone()),
                ..Default::default()
            });
        }
        v
    }

    fn ids(r: &[Scored]) -> Vec<(String, Option<String>)> {
        r.iter()
            .map(|s| {
                (
                    s.option.client_id.clone().unwrap(),
                    s.option.project_id.clone(),
                )
            })
            .collect()
    }

    #[test]
    fn domain_and_name_signals_put_the_right_client_first() {
        let m = Matcher::new(catalog(60), PatternStore::new());
        let s = seg(
            "Google Chrome",
            "Ordrer - bageriet.example",
            Some("https://admin.bageriet.example/ordrer"),
        );
        let r = m.rank_options(&[&s], options(&m), 1_000);
        assert_eq!(r[0].option.client_id.as_deref(), Some("c-bag"));
        assert!(r[0].signal > 0.5, "{}", r[0].signal);
        // Fyld-kunderne uden signal ligger bagest.
        assert_eq!(r.last().unwrap().signal, 0.0);
    }

    #[test]
    fn a_matching_project_also_lifts_its_client() {
        let m = Matcher::new(catalog(0), PatternStore::new());
        let mut s = seg("Code", "index.tsx", None);
        s.repo_remote = Some("git@github.com:example/bageriet-web.git".into());
        let r = m.rank_options(&[&s], options(&m), 1_000);
        let pos = |client: &str, project: Option<&str>| {
            ids(&r)
                .iter()
                .position(|(c, p)| c == client && p.as_deref() == project)
                .unwrap()
        };
        assert!(pos("c-bag", Some("p-bag-web")) < pos("c-fri", None));
        assert!(pos("c-bag", None) < pos("c-fri", None));
    }

    #[test]
    fn recency_and_frequency_break_ties_without_signals() {
        let mut m = Matcher::new(catalog(0), PatternStore::new());
        let now = 100 * DAY;
        // Frisøren er brugt oftere, men for længe siden; bageriet i går.
        for _ in 0..5 {
            m.usage.record(&Target::client("c-fri"), now - 60 * DAY);
        }
        m.usage.record(&Target::client("c-bag"), now - DAY);
        let s = seg("Notes", "Uden spor", None);
        let r = m.rank_options(&[&s], options(&m), now);
        assert!(r.iter().all(|x| x.signal == 0.0));
        assert_eq!(r[0].option.client_id.as_deref(), Some("c-bag"));
        assert!(r[0].recency > 0.9);
        let fri = r
            .iter()
            .find(|x| x.option.client_id.as_deref() == Some("c-fri"))
            .unwrap();
        assert!(fri.recency < 0.1);
        assert!(fri.frequency > r[0].frequency);
    }

    #[test]
    fn a_strong_signal_beats_heavy_use() {
        let mut m = Matcher::new(catalog(0), PatternStore::new());
        for _ in 0..50 {
            m.usage.record(&Target::client("c-fri"), 99 * DAY);
        }
        let s = seg(
            "Google Chrome",
            "Ordrer",
            Some("https://admin.bageriet.example/ordrer"),
        );
        let r = m.rank_options(&[&s], options(&m), 100 * DAY);
        assert_eq!(r[0].option.client_id.as_deref(), Some("c-bag"));
    }

    #[test]
    fn ranking_is_deterministic_and_keeps_catalog_order_on_ties() {
        let m = Matcher::new(catalog(5), PatternStore::new());
        let s = seg("Notes", "Uden spor", None);
        let a = m.rank_options(&[&s], options(&m), 5);
        let b = m.rank_options(&[&s], options(&m), 5);
        assert_eq!(a, b);
        assert_eq!(ids(&a), ids(&b));
        let original: Vec<_> = options(&m)
            .iter()
            .map(|o| (o.client_id.clone().unwrap(), o.project_id.clone()))
            .collect();
        assert_eq!(ids(&a), original);
    }

    #[test]
    fn learned_patterns_count_as_signal() {
        use crate::learning::Feedback;
        let mut m = Matcher::new(catalog(0), PatternStore::new());
        let known = seg("Figma", "Kampagne – Frisør Nord", None);
        for _ in 0..3 {
            m.patterns
                .learn(&[&known], &Target::client("c-fri"), &Feedback::Confirm);
        }
        let r = m.rank_options(&[&known], options(&m), 1_000);
        assert_eq!(r[0].option.client_id.as_deref(), Some("c-fri"));
        assert!(r[0].signal > 0.0);
    }

    #[test]
    fn keywords_come_from_domains_and_identities() {
        let m = Matcher::new(catalog(0), PatternStore::new());
        assert_eq!(
            m.keywords_for(Some("c-bag"), None),
            vec!["bageriet.example"]
        );
        assert_eq!(
            m.keywords_for(Some("c-bag"), Some("p-bag-web")),
            vec!["github.com/example/bageriet-web"]
        );
        assert!(m.keywords_for(Some("c-fri"), None).is_empty());
    }

    #[test]
    fn usage_store_counts_and_is_bounded() {
        let mut u = UsageStore::default();
        u.record(&Target::project(Some("c"), "p"), 10);
        u.record(&Target::project(Some("c"), "p"), 5);
        assert_eq!(u.entries.len(), 1);
        assert_eq!((u.entries[0].uses, u.entries[0].last_used), (2, 10));
        u.record(&Target::default(), 99);
        assert_eq!(u.entries.len(), 1);
        for i in 0..(MAX_USAGE_ENTRIES + 10) {
            u.record(&Target::client(&format!("c{i}")), i as i64);
        }
        assert_eq!(u.entries.len(), MAX_USAGE_ENTRIES);
        // De ældste røg ud.
        assert!(u.entries.iter().all(|e| e.last_used >= 10));
    }
}
