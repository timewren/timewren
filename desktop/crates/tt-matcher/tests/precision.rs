//! Præcision på det syntetiske labelset (spec'ens færdig-kriterier).

use tt_matcher::MatchConfig;
use tt_matcher::labelset::{Labelset, evaluate, evaluate_online};
use tt_matcher::synthetic::generate;

fn load() -> Labelset {
    serde_json::from_str(include_str!("../testdata/syntetisk.json")).expect("gyldigt labelset")
}

#[test]
fn committed_labelset_matches_generator() {
    let committed = load();
    assert_eq!(
        committed,
        generate(5),
        "kør: tt-matcher-eval --generer testdata/syntetisk.json"
    );
    assert!(committed.segments.len() >= 300);
}

#[test]
fn committed_v2_matches_generator() {
    let committed: Labelset =
        serde_json::from_str(include_str!("../testdata/syntetisk-v2.json")).expect("gyldigt sæt");
    assert_eq!(
        committed,
        tt_matcher::synthetic2::generate(10),
        "kør: tt-matcher-eval --generer2 testdata/syntetisk-v2.json"
    );
}

#[test]
fn static_precision_meets_the_goal() {
    let r = evaluate(&load(), &MatchConfig::default());
    println!("{}", r.render());
    assert!(
        r.client_accuracy() >= 0.85,
        "kundetræf {:.3}",
        r.client_accuracy()
    );
    assert!(
        r.project_accuracy() >= 0.75,
        "projekttræf {:.3}",
        r.project_accuracy()
    );
    // Det, der foreslås, er rigtigt; resten er uklart.
    assert!(
        r.client_precision() >= 0.97,
        "kundepræcision {:.3}",
        r.client_precision()
    );
    assert_eq!(r.false_suggestion_secs, 0, "ikke-arbejde må ikke foreslås");
    for case in ["korte ord", "æøå", "skiftende browsertitler"] {
        let s = &r.per_case[case];
        assert!(s.recall().unwrap() >= 0.95, "{case}: {:?}", s.recall());
    }
}

#[test]
fn learning_reaches_95_percent_after_the_first_day() {
    let days = evaluate_online(&load(), &MatchConfig::default());
    assert_eq!(days.len(), 5);
    for (i, d) in days.iter().enumerate().skip(1) {
        assert!(
            d.client_accuracy() >= 0.95,
            "dag {}: kunde {:.3}",
            i + 1,
            d.client_accuracy()
        );
        assert!(
            d.project_accuracy() >= 0.90,
            "dag {}: projekt {:.3}",
            i + 1,
            d.project_accuracy()
        );
        assert_eq!(d.false_suggestion_secs, 0, "dag {}", i + 1);
    }
}

/// Trin 2-5: modellen (Naive Bayes + udglatning, slået til af skyggemålingen)
/// løfter det sværere sæt v2 uden at tabe præcision, og det gamle sæt er uændret.
#[test]
fn auto_model_lifts_v2_and_keeps_v1() {
    use tt_matcher::ModelMode;
    let v2: Labelset =
        serde_json::from_str(include_str!("../testdata/syntetisk-v2.json")).expect("gyldigt sæt");
    let total = |reports: Vec<tt_matcher::labelset::Report>| {
        let mut t = tt_matcher::labelset::Report::default();
        for r in &reports {
            t.add(r);
        }
        t
    };
    let cascade = MatchConfig {
        calibrate: false,
        learned_threshold: false,
        naive_bayes: ModelMode::Off,
        ..MatchConfig::default()
    };
    let before = total(evaluate_online(&v2, &cascade));
    let after = total(evaluate_online(&v2, &MatchConfig::default()));
    println!(
        "v2: kunde {:.3} → {:.3}, præcision {:.3} → {:.3}",
        before.client_accuracy(),
        after.client_accuracy(),
        before.client_precision(),
        after.client_precision()
    );
    assert!(after.client_accuracy() >= before.client_accuracy() + 0.03);
    assert!(after.client_precision() >= 0.9);
    let v1 = total(evaluate_online(&load(), &MatchConfig::default()));
    assert!(v1.client_accuracy() >= 0.97, "{}", v1.client_accuracy());
    assert!(v1.client_precision() >= 0.99, "{}", v1.client_precision());
}
