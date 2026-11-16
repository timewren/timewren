//! Brugerens model: det, matcheren lærer om sine egne lag ud over mønstrene.
//!
//! - **Kalibrering** ([`Calibration`]): hvor ofte hvert lag og signal (og
//!   navnematch pr. kunde) faktisk har ret for denne bruger, lært af Bekræft og
//!   Ret. De håndsatte konfidenser i [`crate::matcher::confidence`] er prior
//!   (Beta med [`PRIOR_STRENGTH`] pseudo-observationer), så adfærden på dag 0
//!   er som før, og tallet glider mod det målte, efterhånden som brugeren
//!   svarer. Brugerens egne regler og identiteter kalibreres ikke: de er
//!   brugerens udsagn, ikke et gæt. Kalibreringen bruges af observatøren
//!   (hvilke kilder er kendte) og i modellens vej, ikke på kaskadens egne
//!   forslag.
//! - **Tærskel** ([`UserModel::threshold`]): blokkenes udfald gemmes (højst
//!   [`MAX_HISTORY`]). Når de sikreste forslag når [`TARGET_PRECISION`] på
//!   brugerens egne data (risk-coverage), holdes et konfidensbånd under højst
//!   [`MAX_THRESHOLD`] tilbage, hvis det var rigtigt i under
//!   [`HOLD_BACK_BELOW`] af tiden. Under tærsklen bliver blokken uklar
//!   ("Hvad var det?").
//!
//! Modellen gemmes lokalt (`model.json` i appen) og synkroniseres ikke.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::metrics::{Outcome, coverage_at, rc_curve};
use crate::nb::NaiveBayes;
use crate::smooth::Switching;
use crate::types::{Candidate, Layer, Signal, Target};

/// Så mange pseudo-observationer vejer de håndsatte tal.
pub const PRIOR_STRENGTH: f32 = 30.0;
/// Præcisionen, tærsklen vælges efter.
pub const TARGET_PRECISION: f64 = 0.9;
/// Så mange blokudfald huskes.
pub const MAX_HISTORY: usize = 400;
/// Så mange blokudfald skal der være, før tærsklen læres.
pub const MIN_HISTORY: usize = 20;
/// Under denne præcision på de seneste forslag slår sikkerhedsnettet til.
pub const SAFETY_PRECISION: f64 = 0.8;
/// Sikkerhedsnettet holder aldrig en blok over denne konfidens tilbage.
pub const MAX_THRESHOLD: f32 = 0.75;
/// Nettet slår kun til, når de sikreste forslag, der når [`TARGET_PRECISION`],
/// dækker mindst så stor en del af den foreslåede tid.
pub const MIN_TARGET_COVERAGE: f64 = 0.1;
/// Sikkerhedsnettet holder kun et konfidensbånd tilbage, der på de seneste
/// forslag var rigtigt i under så stor en del af tiden.
pub const HOLD_BACK_BELOW: f64 = 0.25;
/// Tærsklen ser kun på de seneste så mange udfald.
pub const RECENT_HISTORY: usize = 100;

/// Træf og fejl for én nøgle (tidsandele af blokke, ikke antal).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Tally {
    pub right: f32,
    pub wrong: f32,
}

impl Tally {
    fn n(&self) -> f32 {
        self.right + self.wrong
    }
}

/// Kalibrering pr. lag og signal, og for navnematch også pr. kunde.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Calibration {
    pub tallies: BTreeMap<String, Tally>,
}

/// Lag, der kalibreres. Regler og identiteter er brugerens egne udsagn.
fn calibrated_layer(layer: Layer) -> bool {
    matches!(
        layer,
        Layer::Pattern | Layer::Name | Layer::Ai | Layer::Model
    )
}

fn layer_key(layer: Layer, signal: Signal) -> String {
    format!("{layer:?}/{signal:?}").to_lowercase()
}

/// Nøglerne for et bud, mest specifik først.
fn keys_of(c: &Candidate) -> Vec<String> {
    let base = layer_key(c.source.layer, c.source.signal);
    let mut keys = Vec::new();
    // Et navn kan være brugerens eget eller et ord, der står overalt: lær
    // det pr. kunde.
    if c.source.layer == Layer::Name
        && let Some(client) = &c.target.client_id
    {
        keys.push(format!("name/{client}"));
    }
    keys.push(base);
    keys
}

impl Calibration {
    /// Konfidensen efter kalibrering: `(p·k + rigtige) / (k + n)` for den
    /// mest specifikke nøgle med data, ellers prior `p` (bud'ets egen).
    pub fn apply(&self, c: &Candidate) -> f32 {
        if !calibrated_layer(c.source.layer) {
            return c.confidence;
        }
        // Den mest specifikke nøgle med data (pr. kunde før pr. lag). De
        // specifikke tal er en del af de generelle, så de må ikke lægges sammen.
        let p = keys_of(c)
            .iter()
            .find_map(|key| self.tallies.get(key).filter(|t| t.n() > 0.0))
            .map_or(c.confidence, |t| {
                (c.confidence * PRIOR_STRENGTH + t.right) / (PRIOR_STRENGTH + t.n())
            });
        p.clamp(0.0, 0.99)
    }

    /// Ét bud blev holdt op mod brugerens svar. `weight` er buddets andel af
    /// blokken (0..1).
    pub fn observe(&mut self, c: &Candidate, truth: Option<&Target>, weight: f32) {
        if !calibrated_layer(c.source.layer) || weight <= 0.0 {
            return;
        }
        let right = truth.is_some_and(|t| {
            t.client_id.is_some() && t.client_id == c.target.client_id
                || (t.client_id.is_none() && t.compatible(&c.target))
        });
        for key in keys_of(c) {
            let t = self.tallies.entry(key).or_default();
            if right {
                t.right += weight;
            } else {
                t.wrong += weight;
            }
        }
    }
}

/// Platt-skalering af modellens marginaler: `σ(a·logit(m) + b)`.
///
/// Udglatningen giver marginaler tæt på 1 i lange blokke, også når kunden er
/// forkert. Temperatur alene kan ikke trække en konfidens under 0,5, og hos
/// en bruger, hvis aktivitet sjældent siger noget om kunden, skal den kunne
/// det. Parametrene vælges i et gitter efter mindst tab på de seneste svar;
/// før [`MIN_PLATT_SAMPLES`] er `a = 1, b = 0` (uændret).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Platt {
    pub a: f32,
    pub b: f32,
    /// (rå marginal, rigtig, vægt).
    #[serde(default)]
    pub samples: Vec<(f32, bool, f32)>,
}

impl Default for Platt {
    fn default() -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            samples: Vec::new(),
        }
    }
}

/// Så mange eksempler før Platt-skaleringen læres.
pub const MIN_PLATT_SAMPLES: usize = 50;
const MAX_PLATT_SAMPLES: usize = 600;

fn logit(p: f64) -> f64 {
    let p = p.clamp(1e-4, 1.0 - 1e-4);
    (p / (1.0 - p)).ln()
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

impl Platt {
    pub fn apply(&self, m: f32) -> f32 {
        sigmoid(f64::from(self.a) * logit(f64::from(m)) + f64::from(self.b)) as f32
    }

    pub fn observe(&mut self, m: f32, correct: bool, weight: f32) {
        if weight <= 0.0 {
            return;
        }
        self.samples.push((m, correct, weight));
        if self.samples.len() > MAX_PLATT_SAMPLES {
            let extra = self.samples.len() - MAX_PLATT_SAMPLES;
            self.samples.drain(..extra);
        }
    }

    /// Vælger `a` og `b` med mindst vægtet log-tab (gitter, deterministisk).
    pub fn fit(&mut self) {
        if self.samples.len() < MIN_PLATT_SAMPLES {
            return;
        }
        let loss = |a: f64, b: f64| -> f64 {
            self.samples
                .iter()
                .map(|(m, y, w)| {
                    let p = sigmoid(a * logit(f64::from(*m)) + b).clamp(1e-6, 1.0 - 1e-6);
                    let l = if *y { -p.ln() } else { -(1.0 - p).ln() };
                    l * f64::from(*w)
                })
                .sum()
        };
        let mut best = (1.0, 0.0, f64::INFINITY);
        for ai in 0..=16 {
            let a = 0.05 + ai as f64 * 0.1;
            for bi in 0..=24 {
                let b = -4.0 + bi as f64 * 0.25;
                let l = loss(a, b);
                if l < best.2 - 1e-12 {
                    best = (a, b, l);
                }
            }
        }
        self.a = best.0 as f32;
        self.b = best.1 as f32;
    }
}

/// Skyggemålingen: kaskadens og modellens bud på hvert segment, brugeren
/// har svaret på (sekunder).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowStats {
    /// Al besvaret tid.
    pub secs: f64,
    pub cascade_right: f64,
    pub cascade_wrong: f64,
    pub model_right: f64,
    pub model_wrong: f64,
}

/// Modellen slår sig aldrig til med en præcision under denne: en model, der
/// rammer som en mønt, er ikke bedre end at lade kaskaden svare.
pub const MIN_MODEL_PRECISION: f64 = 0.6;

/// Så meget besvaret tid før modellen kan slå sig selv til: 2 timer.
pub const PROMOTE_AFTER_SECS: f64 = 2.0 * 3600.0;

impl ShadowStats {
    fn precision(right: f64, wrong: f64) -> f64 {
        if right + wrong <= 0.0 {
            1.0
        } else {
            right / (right + wrong)
        }
    }

    pub fn cascade_precision(&self) -> f64 {
        Self::precision(self.cascade_right, self.cascade_wrong)
    }

    pub fn model_precision(&self) -> f64 {
        Self::precision(self.model_right, self.model_wrong)
    }

    /// Modellen slår sig selv til, når den på brugerens egne svar rammer
    /// rigtigt i mindst 5 % mere tid end kaskaden (og mindst 10 minutter
    /// mere), uden lavere præcision: højst 1 point under kaskadens, men aldrig
    /// under [`MIN_MODEL_PRECISION`], og der kræves aldrig mere end 90 %. Det
    /// vurderes igen ved hvert svar, så den også kan slå sig fra.
    pub fn promoted(&self) -> bool {
        self.secs >= PROMOTE_AFTER_SECS
            && self.model_right >= self.cascade_right * 1.05 + 600.0
            // En upræcis model slår sig aldrig til, heller ikke hos en bruger,
            // hvis kaskade kun rammer hver femte.
            && self.model_precision()
                >= (self.cascade_precision() - 0.01).clamp(MIN_MODEL_PRECISION, TARGET_PRECISION)
    }
}

/// Et forslags udfald: konfidens, varighed, og om kunden var rigtig.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BlockOutcome {
    pub confidence: f32,
    pub secs: i64,
    pub correct: bool,
}

/// Alt det, matcheren lærer om sig selv for denne bruger.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserModel {
    #[serde(default)]
    pub calibration: Calibration,
    /// De seneste forslags udfald (til tærsklen).
    #[serde(default)]
    pub history: Vec<BlockOutcome>,
    /// Naive Bayes over kunder.
    #[serde(default)]
    pub nb: NaiveBayes,
    /// Naive Bayes over projekter pr. kunde (klassen `-` = uden projekt).
    #[serde(default)]
    pub projects: BTreeMap<String, NaiveBayes>,
    /// Den lærte skifte-sandsynlighed til udglatningen.
    #[serde(default)]
    pub switching: Switching,
    /// Kalibrering af modellens marginaler.
    #[serde(default)]
    pub platt: Platt,
    /// Skyggemålingen (kaskade mod model).
    #[serde(default)]
    pub shadow: ShadowStats,
    /// Nøgler for poster, modellen allerede har lært af (højst [`MAX_ENTRIES`]).
    #[serde(default)]
    pub learned_entries: Vec<String>,
}

/// Så mange lærte poster huskes (de ældste glemmes; de er uden for vinduet).
pub const MAX_ENTRIES: usize = 2000;

impl UserModel {
    pub fn new() -> Self {
        Self::default()
    }

    /// Har modellen lært af posten med denne nøgle?
    pub fn entry_learned(&self, key: &str) -> bool {
        self.learned_entries.iter().any(|k| k == key)
    }

    /// Husker, at modellen har lært af posten.
    pub fn mark_entry(&mut self, key: String) {
        self.learned_entries.push(key);
        if self.learned_entries.len() > MAX_ENTRIES {
            let extra = self.learned_entries.len() - MAX_ENTRIES;
            self.learned_entries.drain(..extra);
        }
    }

    /// Et forslag blev bekræftet eller rettet.
    pub fn record_block(&mut self, outcome: BlockOutcome) {
        self.history.push(outcome);
        if self.history.len() > MAX_HISTORY {
            let extra = self.history.len() - MAX_HISTORY;
            self.history.drain(..extra);
        }
    }

    /// Tærsklen for "foreslået", valgt fra brugerens risk-coverage-kurve:
    /// højst den laveste konfidens, hvor præcisionen over den er mindst
    /// [`TARGET_PRECISION`] (og dækker mindst [`MIN_TARGET_COVERAGE`]), og højst
    /// [`MAX_THRESHOLD`], og kun så højt, at
    /// det tilbageholdte bånd var rigtigt i under [`HOLD_BACK_BELOW`] af tiden.
    /// `None` med for få udfald, når de seneste forslag rammer
    /// [`SAFETY_PRECISION`] (så bruges standardtærsklen), når intet niveau når
    /// målet, eller når intet bånd er så dårligt.
    pub fn threshold(&self) -> Option<f32> {
        if self.history.len() < MIN_HISTORY {
            return None;
        }
        // Kun de seneste: modellen bliver bedre, og en dårlig første uge må
        // ikke holde forslagene tilbage for altid.
        let recent = &self.history[self.history.len().saturating_sub(RECENT_HISTORY)..];
        // Et sikkerhedsnet: rammer forslagene allerede målet, bruges
        // standardtærsklen.
        let (right, all) = recent.iter().fold((0i64, 0i64), |(r, a), b| {
            (r + if b.correct { b.secs } else { 0 }, a + b.secs)
        });
        if all > 0 && right as f64 / all as f64 >= SAFETY_PRECISION {
            return None;
        }
        let outcomes: Vec<Outcome> = recent
            .iter()
            .map(|b| Outcome {
                secs: b.secs,
                confidence: b.confidence,
                correct: b.correct,
            })
            .collect();
        let total: i64 = outcomes.iter().map(|o| o.secs).sum();
        let curve = rc_curve(&outcomes, total);
        let (coverage, threshold) = coverage_at(&curve, TARGET_PRECISION);
        // Intet niveau når målet (eller kun en sliver, fx én regel): konfidensen
        // skiller ikke rigtige forslag fra forkerte, og at holde alt under
        // loftet tilbage koster kun rigtige forslag (de stærke, forkerte
        // mønstre ligger over loftet).
        if coverage < MIN_TARGET_COVERAGE {
            return None;
        }
        // Hold kun det bånd tilbage, der tog fejl mindst 3 af 4 gange. Et bånd,
        // der rammer hver anden, er stadig rigtige forslag, brugeren mister.
        let top = threshold.min(MAX_THRESHOLD);
        let mut levels: Vec<f32> = outcomes
            .iter()
            .map(|o| o.confidence)
            .filter(|&c| c < top)
            .collect();
        levels.push(top);
        levels.sort_by(|a, b| b.total_cmp(a));
        levels.dedup();
        levels.into_iter().find(|&t| {
            let (right, all) = outcomes
                .iter()
                .filter(|o| o.confidence < t)
                .fold((0i64, 0i64), |(r, a), o| {
                    (r + if o.correct { o.secs } else { 0 }, a + o.secs)
                });
            all > 0 && (right as f64) < HOLD_BACK_BELOW * all as f64
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Source;

    fn name(client: &str, conf: f32) -> Candidate {
        Candidate {
            target: Target::client(client),
            confidence: conf,
            source: Source {
                layer: Layer::Name,
                signal: Signal::Title,
            },
            reason: String::new(),
        }
    }

    #[test]
    fn day_zero_is_unchanged_and_errors_pull_down() {
        let mut cal = Calibration::default();
        let c = name("mads", 0.7);
        assert_eq!(cal.apply(&c), 0.7);
        // Brugerens eget navn i titlen: rettet væk 40 gange.
        for _ in 0..40 {
            cal.observe(&c, Some(&Target::client("kunde")), 1.0);
        }
        let after = cal.apply(&c);
        assert!(after < 0.4, "{after}");
        // En anden kunde uden egne svar følger lagets tal; med egne rigtige
        // svar skilles den fra brugerens eget navn.
        let other = name("bageriet", 0.7);
        assert!(cal.apply(&other) < 0.7);
        for _ in 0..30 {
            cal.observe(&other, Some(&Target::client("bageriet")), 1.0);
        }
        assert!(cal.apply(&other) > 0.8, "{}", cal.apply(&other));
        assert_eq!(cal.apply(&c), after);
        // Brugerens regler kalibreres aldrig.
        let mut rule = name("mads", 0.98);
        rule.source.layer = Layer::Rule;
        cal.observe(&rule, Some(&Target::client("kunde")), 1.0);
        assert_eq!(cal.apply(&rule), 0.98);
    }

    #[test]
    fn right_answers_raise_confidence() {
        let mut cal = Calibration::default();
        let c = name("bageriet", 0.6);
        for _ in 0..60 {
            cal.observe(&c, Some(&Target::project(Some("bageriet"), "web")), 1.0);
        }
        assert!(cal.apply(&c) > 0.85);
    }

    #[test]
    fn threshold_from_risk_coverage() {
        let m = UserModel::new();
        assert_eq!(m.threshold(), None);
        let record = |share_right: usize| {
            let mut m = UserModel::new();
            for i in 0..30 {
                let conf = 0.5 + i as f32 / 60.0;
                m.record_block(BlockOutcome {
                    confidence: conf,
                    secs: 600,
                    correct: conf >= 0.8 || i % share_right == 0,
                });
            }
            m
        };
        // Over 0,8 er alt rigtigt; under rammer kun hver femte: båndet holdes
        // tilbage op til loftet.
        assert_eq!(record(5).threshold(), Some(MAX_THRESHOLD));
        // Under 0,8 rammer hver anden: det er stadig rigtige forslag, så intet
        // holdes tilbage.
        assert_eq!(record(2).threshold(), None);
        // Intet niveau når målet, fordi konfidensen ikke skiller rigtigt fra
        // forkert (som hos en bruger med timeren på én kunde og arbejde for
        // mange): at holde forslag tilbage ville kun koste de rigtige.
        let mut noisy = UserModel::new();
        for i in 0..30 {
            noisy.record_block(BlockOutcome {
                confidence: 0.55 + (i % 10) as f32 / 30.0,
                secs: 600,
                correct: i % 5 == 0,
            });
        }
        assert_eq!(noisy.threshold(), None);
        // Én sikker, rigtig blok (en regel) gør ikke støjen til et skel.
        noisy.record_block(BlockOutcome {
            confidence: 0.98,
            secs: 600,
            correct: true,
        });
        assert_eq!(noisy.threshold(), None);
    }

    #[test]
    fn the_model_never_switches_on_with_low_precision() {
        let stats = |cascade: (f64, f64), model: (f64, f64)| ShadowStats {
            secs: 8.0 * 3600.0,
            cascade_right: cascade.0,
            cascade_wrong: cascade.1,
            model_right: model.0,
            model_wrong: model.1,
        };
        // Kaskaden rammer hver femte; modellen rammer dobbelt så meget, men
        // lige så upræcist (som på Mads' sæt), eller som en mønt.
        assert!(!stats((1200.0, 4800.0), (2400.0, 9600.0)).promoted());
        assert!(!stats((1200.0, 2400.0), (2400.0, 2200.0)).promoted());
        // En bruger med 80 % præcision: modellen må slå sig til uden at nå 90 %.
        assert!(stats((4000.0, 1000.0), (6000.0, 1400.0)).promoted());
        // Højst 1 point under kaskaden.
        assert!(!stats((4000.0, 1000.0), (6000.0, 1700.0)).promoted());
        // Kræver aldrig mere end 90 %, selv når kaskaden rammer alt.
        assert!(stats((1200.0, 0.0), (2400.0, 200.0)).promoted());
    }

    #[test]
    fn platt_pulls_an_overconfident_model_down() {
        let mut p = Platt::default();
        assert_eq!(p.apply(0.99), 0.99_f32.clamp(0.0, 1.0).min(p.apply(0.99)));
        // Siger 0,99, rammer hver tiende.
        for i in 0..100 {
            p.observe(0.99, i % 10 == 0, 1.0);
        }
        p.fit();
        let after = p.apply(0.99);
        assert!(after < 0.3, "{after}");
        // En velkalibreret model forbliver omtrent uændret.
        let mut q = Platt::default();
        for i in 0..100 {
            q.observe(0.8, i % 5 != 0, 1.0);
        }
        q.fit();
        assert!((q.apply(0.8) - 0.8).abs() < 0.05, "{}", q.apply(0.8));
    }

    #[test]
    fn history_is_bounded() {
        let mut m = UserModel::new();
        for _ in 0..MAX_HISTORY + 10 {
            m.record_block(BlockOutcome {
                confidence: 0.6,
                secs: 60,
                correct: true,
            });
        }
        assert_eq!(m.history.len(), MAX_HISTORY);
    }
}
