//! Risk-coverage og kalibrering (tidsvægtet).
//!
//! Træfprocenten alene skjuler, hvad dækningen koster: en matcher kan løfte
//! træf ved at gætte mere og samtidig sænke præcisionen. Her måles:
//! - **risk-coverage-kurven**: forslagene sorteret efter konfidens, og for hver
//!   tærskel dækningen (rigtigt + forkert foreslået tid / al tid med en kunde)
//!   og risikoen (andel forkert af den foreslåede tid);
//! - **dækning ved en præcision** (fx ≥ 90 %): den største dækning, en tærskel
//!   kan give, uden at præcisionen over tærsklen falder under målet;
//! - **AURC**: arealet under risk-coverage-kurven (lavere er bedre);
//! - **ECE**: forventet kalibreringsfejl med lige store spande efter tid;
//! - **Brier**: middel af (konfidens − rigtig)².
//!
//! Et udfald er ét segment med en rigtig kunde, der fik et forslag (ikke
//! uklart). Uklare blokke er afståelser og tæller kun i nævneren.

use serde::{Deserialize, Serialize};

/// Ét foreslået segment: varighed, konfidens og om kunden var rigtig.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Outcome {
    pub secs: i64,
    pub confidence: f32,
    pub correct: bool,
}

/// Et punkt på risk-coverage-kurven.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RcPoint {
    /// Forslag med konfidens ≥ tærsklen er med.
    pub threshold: f32,
    /// Foreslået tid / al tid med en kunde.
    pub coverage: f64,
    /// Rigtigt foreslået tid / foreslået tid.
    pub precision: f64,
}

/// Kurven fra den højeste tærskel og nedad. Ens konfidenser samles i ét punkt,
/// for en tærskel kan ikke skille dem ad.
pub fn rc_curve(outcomes: &[Outcome], total_secs: i64) -> Vec<RcPoint> {
    let mut sorted: Vec<&Outcome> = outcomes.iter().filter(|o| o.secs > 0).collect();
    sorted.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    let total = total_secs.max(1) as f64;
    let (mut covered, mut right) = (0i64, 0i64);
    let mut out: Vec<RcPoint> = Vec::new();
    for (i, o) in sorted.iter().enumerate() {
        covered += o.secs;
        if o.correct {
            right += o.secs;
        }
        let last_of_level = sorted
            .get(i + 1)
            .is_none_or(|n| n.confidence != o.confidence);
        if last_of_level {
            out.push(RcPoint {
                threshold: o.confidence,
                coverage: covered as f64 / total,
                precision: right as f64 / covered.max(1) as f64,
            });
        }
    }
    out
}

/// Den største dækning, hvor præcisionen over tærsklen er mindst `goal`, og
/// tærsklen, der giver den. `(0.0, 1.0)`, hvis ingen tærskel når målet.
pub fn coverage_at(curve: &[RcPoint], goal: f64) -> (f64, f32) {
    curve
        .iter()
        .filter(|p| p.precision + 1e-12 >= goal)
        .map(|p| (p.coverage, p.threshold))
        .fold((0.0, 1.0), |best, p| if p.0 > best.0 { p } else { best })
}

/// Arealet under risk-coverage-kurven (risiko integreret over dækningen,
/// trappeform fra 0 til kurvens største dækning). Lavere er bedre.
pub fn aurc(curve: &[RcPoint]) -> f64 {
    let mut prev = 0.0;
    let mut area = 0.0;
    for p in curve {
        area += (1.0 - p.precision) * (p.coverage - prev);
        prev = p.coverage;
    }
    area
}

/// Forventet kalibreringsfejl: udfaldene sorteres efter konfidens og deles i
/// `bins` spande med lige meget tid. Fejlen er den tidsvægtede middel af
/// |træf − middelkonfidens| pr. spand.
pub fn ece(outcomes: &[Outcome], bins: usize) -> f64 {
    reliability(outcomes, bins)
        .iter()
        .map(|b| b.weight * (b.accuracy - b.confidence).abs())
        .sum()
}

/// Én spand i kalibreringskurven (reliability diagram).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bin {
    /// Andel af den foreslåede tid i spanden.
    pub weight: f64,
    pub confidence: f64,
    pub accuracy: f64,
}

/// Kalibreringskurven: spande med (næsten) lige meget tid, laveste konfidens
/// først.
pub fn reliability(outcomes: &[Outcome], bins: usize) -> Vec<Bin> {
    let mut sorted: Vec<&Outcome> = outcomes.iter().filter(|o| o.secs > 0).collect();
    sorted.sort_by(|a, b| a.confidence.total_cmp(&b.confidence));
    let total: i64 = sorted.iter().map(|o| o.secs).sum();
    if total == 0 || bins == 0 {
        return Vec::new();
    }
    let per_bin = total as f64 / bins as f64;
    let mut out = Vec::new();
    let (mut secs, mut conf, mut right) = (0i64, 0f64, 0i64);
    let mut filled = 0f64;
    for (i, o) in sorted.iter().enumerate() {
        secs += o.secs;
        conf += f64::from(o.confidence) * o.secs as f64;
        if o.correct {
            right += o.secs;
        }
        // Ens konfidenser bliver i samme spand: en tærskel kan ikke skille dem ad.
        let tie = sorted
            .get(i + 1)
            .is_some_and(|n| n.confidence == o.confidence);
        if !tie && (filled + secs as f64) >= per_bin * (out.len() + 1) as f64 - 1e-9 {
            out.push(Bin {
                weight: secs as f64 / total as f64,
                confidence: conf / secs as f64,
                accuracy: right as f64 / secs as f64,
            });
            filled += secs as f64;
            (secs, conf, right) = (0, 0.0, 0);
        }
    }
    if secs > 0 {
        out.push(Bin {
            weight: secs as f64 / total as f64,
            confidence: conf / secs as f64,
            accuracy: right as f64 / secs as f64,
        });
    }
    out
}

/// Tidsvægtet Brier-score: middel af (konfidens − rigtig)².
pub fn brier(outcomes: &[Outcome]) -> f64 {
    let total: i64 = outcomes.iter().map(|o| o.secs.max(0)).sum();
    if total == 0 {
        return 0.0;
    }
    outcomes
        .iter()
        .map(|o| {
            let y = if o.correct { 1.0 } else { 0.0 };
            (f64::from(o.confidence) - y).powi(2) * o.secs.max(0) as f64
        })
        .sum::<f64>()
        / total as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn o(secs: i64, confidence: f32, correct: bool) -> Outcome {
        Outcome {
            secs,
            confidence,
            correct,
        }
    }

    #[test]
    fn curve_goes_from_sure_to_unsure() {
        let outs = [
            o(60, 0.9, true),
            o(60, 0.8, true),
            o(60, 0.6, false),
            o(60, 0.6, true),
        ];
        let c = rc_curve(&outs, 600);
        assert_eq!(c.len(), 3, "ens konfidens er ét punkt: {c:?}");
        assert_eq!(c[0].coverage, 0.1);
        assert_eq!(c[0].precision, 1.0);
        assert!((c[2].coverage - 0.4).abs() < 1e-9);
        assert!((c[2].precision - 0.75).abs() < 1e-9);
        assert_eq!(coverage_at(&c, 0.9), (0.2, 0.8));
        assert_eq!(coverage_at(&c, 0.7), (0.4, 0.6));
        assert_eq!(coverage_at(&[], 0.9), (0.0, 1.0));
        // Risiko 0 indtil 0,2, derefter 0,25 over 0,2 dækning.
        assert!((aurc(&c) - 0.05).abs() < 1e-9);
    }

    #[test]
    fn perfect_calibration_has_zero_ece() {
        // 80 % sikker og 80 % rigtig; 50 % sikker og 50 % rigtig.
        let mut outs = Vec::new();
        for i in 0..10 {
            outs.push(o(10, 0.8, i < 8));
            outs.push(o(10, 0.5, i < 5));
        }
        assert!(ece(&outs, 2) < 1e-6, "{}", ece(&outs, 2));
        // Overmodig: siger 0,9, rammer halvdelen.
        let over: Vec<_> = (0..10).map(|i| o(10, 0.9, i < 5)).collect();
        assert!((ece(&over, 5) - 0.4).abs() < 1e-6);
        assert!((brier(&over) - 0.41).abs() < 1e-6);
    }

    #[test]
    fn bins_hold_equal_time() {
        let outs: Vec<_> = (0..100)
            .map(|i| o(1, i as f32 / 100.0, i % 2 == 0))
            .collect();
        let bins = reliability(&outs, 10);
        assert_eq!(bins.len(), 10);
        assert!(bins.iter().all(|b| (b.weight - 0.1).abs() < 1e-9));
        assert!(bins[0].confidence < bins[9].confidence);
    }
}
