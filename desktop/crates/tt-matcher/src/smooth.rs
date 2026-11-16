//! Udglatning over dagen: Viterbi og forward-backward.
//!
//! Arbejde kommer i blokke, men de enkelte vinduer siger tit intet (en fast
//! titel, en ny fane, en mail). En skjult Markov-model med én tilstand pr.
//! kunde (og "anden") lader et usikkert segment låne fra naboerne:
//!
//! - **emission** pr. segment er en fordeling over tilstandene (fra
//!   kaskaden og Naive Bayes);
//! - **overgang**: bliv med sandsynlighed `1 − ε`, skift med `ε` fordelt ligeligt.
//!   `ε` læres af brugerens egne svar ([`Switching`]): hvor ofte to
//!   naboer i en bekræftet dag har forskellig kunde;
//! - et **hul** over `max_gap` (pause) nulstiller: før og efter hænger ikke
//!   sammen;
//! - **ankre** (brugerens regler, identiteter og stærke mønstre) har en
//!   emission med al vægt på én tilstand, så udglatningen aldrig kan flytte
//!   dem.
//!
//! Det generaliserer A→B→A-reglen i [`crate::blocks`]: en kort afbrydelse uden
//! eget stærkt signal går til omgivelserne, men en sikker blok midt i en anden
//! kundes tid bliver stående. Viterbi giver den mest sandsynlige sti,
//! forward-backward giver marginalen (konfidensen) pr. segment.

use serde::{Deserialize, Serialize};

/// Den lærte skifte-sandsynlighed: tal fra brugerens svar med en prior.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Switching {
    /// Naboer (uden pause imellem) med forskellig kunde.
    pub switches: f32,
    /// Alle nabopar.
    pub pairs: f32,
}

impl Default for Switching {
    fn default() -> Self {
        Self {
            switches: 0.0,
            pairs: 0.0,
        }
    }
}

impl Switching {
    /// Prior: et skifte for hver 25 segmenter (ca. hvert 15.-25. minut).
    const PRIOR_SWITCHES: f32 = 2.0;
    const PRIOR_PAIRS: f32 = 50.0;

    /// ε, holdt mellem 0,2 % og 30 %.
    pub fn epsilon(&self) -> f64 {
        f64::from((self.switches + Self::PRIOR_SWITCHES) / (self.pairs + Self::PRIOR_PAIRS))
            .clamp(0.002, 0.3)
    }

    /// Tæller nabopar i en række kunder (efter tid, `None` = pause/ukendt).
    pub fn observe(&mut self, labels: &[Option<&str>]) {
        for w in labels.windows(2) {
            if let (Some(a), Some(b)) = (w[0], w[1]) {
                self.pairs += 1.0;
                if a != b {
                    self.switches += 1.0;
                }
            }
        }
    }
}

/// Én række til udglatning: emission pr. tilstand, og om der er en pause før
/// segmentet (så hænger det ikke sammen med det forrige).
#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub emission: Vec<f64>,
    pub break_before: bool,
}

/// Resultatet: tilstand pr. segment (Viterbi) og marginalen for den.
#[derive(Debug, Clone, PartialEq)]
pub struct Smoothed {
    pub path: Vec<usize>,
    pub marginal: Vec<Vec<f64>>,
}

fn normalize(v: &mut [f64]) {
    let z: f64 = v.iter().sum();
    if z > 0.0 && z.is_finite() {
        for x in v.iter_mut() {
            *x /= z;
        }
    } else {
        let n = v.len().max(1) as f64;
        for x in v.iter_mut() {
            *x = 1.0 / n;
        }
    }
}

/// Udglatter en dag. `states` er antallet af tilstande; alle emissioner har
/// den længde.
pub fn smooth(steps: &[Step], states: usize, epsilon: f64) -> Smoothed {
    let n = steps.len();
    if n == 0 || states == 0 {
        return Smoothed {
            path: Vec::new(),
            marginal: Vec::new(),
        };
    }
    let k = states as f64;
    let stay = 1.0 - epsilon;
    let spread = epsilon / k;
    // Forward.
    let mut fwd: Vec<Vec<f64>> = Vec::with_capacity(n);
    for (i, s) in steps.iter().enumerate() {
        let mut a: Vec<f64> = if i == 0 || s.break_before {
            s.emission.iter().map(|e| e / k).collect()
        } else {
            let prev = &fwd[i - 1];
            let total: f64 = prev.iter().sum();
            (0..states)
                .map(|j| s.emission[j] * (prev[j] * stay + total * spread))
                .collect()
        };
        normalize(&mut a);
        fwd.push(a);
    }
    // Backward.
    let mut bwd: Vec<Vec<f64>> = vec![vec![1.0; states]; n];
    for i in (0..n.saturating_sub(1)).rev() {
        let next = &steps[i + 1];
        let t: Vec<f64> = (0..states)
            .map(|j| next.emission[j] * bwd[i + 1][j])
            .collect();
        let total: f64 = t.iter().sum();
        let mut b: Vec<f64> = if next.break_before {
            vec![total / k; states]
        } else {
            (0..states).map(|j| t[j] * stay + total * spread).collect()
        };
        normalize(&mut b);
        bwd[i] = b;
    }
    let marginal: Vec<Vec<f64>> = (0..n)
        .map(|i| {
            let mut m: Vec<f64> = (0..states).map(|j| fwd[i][j] * bwd[i][j]).collect();
            normalize(&mut m);
            m
        })
        .collect();
    // Viterbi i log.
    let ln = |x: f64| x.max(1e-300).ln();
    let (l_stay, l_switch) = (ln(stay + spread), ln(spread));
    let mut delta: Vec<f64> = steps[0].emission.iter().map(|e| ln(*e)).collect();
    let mut back: Vec<Vec<usize>> = vec![vec![0; states]; n];
    for i in 1..n {
        let s = &steps[i];
        let best_prev = (0..states)
            .max_by(|a, b| delta[*a].total_cmp(&delta[*b]).then(b.cmp(a)))
            .unwrap_or(0);
        let mut next = vec![0.0; states];
        for j in 0..states {
            let (from, score) = if s.break_before {
                (best_prev, delta[best_prev])
            } else {
                let keep = delta[j] + l_stay;
                let jump = delta[best_prev] + l_switch;
                if best_prev == j || keep >= jump {
                    (j, keep)
                } else {
                    (best_prev, jump)
                }
            };
            back[i][j] = from;
            next[j] = score + ln(s.emission[j]);
        }
        // Hold tallene små.
        let m = next.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        delta = next.into_iter().map(|x| x - m).collect();
    }
    let mut path = vec![0; n];
    path[n - 1] = (0..states)
        .max_by(|a, b| delta[*a].total_cmp(&delta[*b]).then(b.cmp(a)))
        .unwrap_or(0);
    for i in (1..n).rev() {
        path[i - 1] = back[i][path[i]];
    }
    Smoothed { path, marginal }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(e: &[f64]) -> Step {
        Step {
            emission: e.to_vec(),
            break_before: false,
        }
    }

    #[test]
    fn a_weak_segment_borrows_from_its_neighbours() {
        // A, A, (uklart), A, A: midten bliver A.
        let a = [0.9, 0.1];
        let unsure = [0.45, 0.55];
        let s = smooth(
            &[step(&a), step(&a), step(&unsure), step(&a), step(&a)],
            2,
            0.05,
        );
        assert_eq!(s.path, [0, 0, 0, 0, 0]);
        assert!(s.marginal[2][0] > 0.8, "{:?}", s.marginal[2]);
    }

    #[test]
    fn an_anchor_is_never_moved() {
        // A, A, B (anker), A, A: ankeret bliver B.
        let a = [0.9, 0.1];
        let anchor = [0.0, 1.0];
        let s = smooth(
            &[step(&a), step(&a), step(&anchor), step(&a), step(&a)],
            2,
            0.05,
        );
        assert_eq!(s.path[2], 1);
        assert!(s.marginal[2][1] > 0.999);
        assert_eq!(s.path[0], 0);
    }

    #[test]
    fn a_pause_breaks_the_chain() {
        // A, A | (uklart): efter en pause låner det ikke fra A.
        let a = [0.95, 0.05];
        let unsure = [0.4, 0.6];
        let mut after = step(&unsure);
        after.break_before = true;
        let s = smooth(&[step(&a), step(&a), after], 2, 0.05);
        assert_eq!(s.path[2], 1);
    }

    #[test]
    fn a_real_switch_survives() {
        // Fem tydelige A'er og fem tydelige B'er: skiftet bevares.
        let a = [0.9, 0.1];
        let b = [0.1, 0.9];
        let steps: Vec<Step> = (0..10).map(|i| step(if i < 5 { &a } else { &b })).collect();
        let s = smooth(&steps, 2, 0.05);
        assert_eq!(s.path, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
    }

    #[test]
    fn switching_is_learned() {
        let mut sw = Switching::default();
        let prior = sw.epsilon();
        sw.observe(&[Some("a"), Some("a"), Some("a"), Some("a"), None, Some("b")]);
        assert!(sw.epsilon() < prior);
        for _ in 0..50 {
            sw.observe(&[Some("a"), Some("b")]);
        }
        assert!(sw.epsilon() > prior);
    }
}
