//! Regressionsvagt for auto-tildelingen (RAPPORT-ux-matcher2).
//!
//! 0.2.28 → v1/integration halverede de rigtige forslag på Mads' rigtige
//! eksport, mens de syntetiske sæt så fine ud. Vagten holder derfor tre ting
//! fast med simuleret Bekræft/Ret dag for dag:
//!
//! 1. mindstetal på v1, v2 og v3 (det Mads-lignende sæt), som ikke må falde;
//! 2. at de nye lag (kalibrering, tærskel, Naive Bayes, udglatning) aldrig gør
//!    en bruger med lav præcision dårligere end den rene kaskade: ikke færre
//!    rigtige minutter, ikke flere forkerte og ikke lavere præcision. Det
//!    måles på den svære variant af v3, der efterligner Mads' eksport (timeren
//!    på én kunde, agenterne for mange, ca. 50 % præcision);
//! 3. at modellen ikke slår sig til på den svære variant.
//!
//! Mads' rigtige fil er aldrig i repoet; den svære variant er opdigtet.

use tt_matcher::labelset::{Labelset, Report, evaluate_online};
use tt_matcher::{MatchConfig, ModelMode};

fn total(reports: Vec<Report>) -> Report {
    let mut t = Report::default();
    for r in &reports {
        t.add(r);
    }
    t
}

fn online(set: &Labelset, config: &MatchConfig) -> Report {
    total(evaluate_online(set, config))
}

/// Den rene kaskade: 0.2.28's lag plus mapper og kundeprofil.
fn cascade() -> MatchConfig {
    MatchConfig {
        calibrate: false,
        learned_threshold: false,
        naive_bayes: ModelMode::Off,
        ..MatchConfig::default()
    }
}

fn wrong_secs(r: &Report) -> i64 {
    r.client_suggested_secs - r.client_correct_secs + r.false_suggestion_secs
}

fn load(json: &str) -> Labelset {
    serde_json::from_str(json).expect("gyldigt labelset")
}

/// Mindstetal (kundetræf, præcision), sat lige under det, der blev målt, da
/// vagten kom til. Hæv dem, når matcheren bliver bedre; sænk dem aldrig uden
/// en måling på en rigtig eksport, der viser, at det er det rigtige.
#[test]
fn floors_on_the_synthetic_sets() {
    let sets = [
        (
            "v1",
            load(include_str!("../testdata/syntetisk.json")),
            0.97,
            0.995,
        ),
        (
            "v2",
            load(include_str!("../testdata/syntetisk-v2.json")),
            0.80,
            0.93,
        ),
        (
            "v3",
            load(include_str!("../testdata/syntetisk-v3.json")),
            0.29,
            0.785,
        ),
    ];
    for (name, set, hits, precision) in sets {
        let r = online(&set, &MatchConfig::default());
        println!(
            "{name}: kunde {:.3}, præcision {:.3}",
            r.client_accuracy(),
            r.client_precision()
        );
        assert!(
            r.client_accuracy() >= hits,
            "{name}: kundetræf {:.3} < {hits}",
            r.client_accuracy()
        );
        assert!(
            r.client_precision() >= precision,
            "{name}: præcision {:.3} < {precision}",
            r.client_precision()
        );
    }
}

#[test]
fn the_committed_v3_matches_the_generator() {
    assert_eq!(
        load(include_str!("../testdata/syntetisk-v3.json")),
        tt_matcher::synthetic3::generate(7),
        "kør: tt-matcher-eval --generer3 testdata/syntetisk-v3.json"
    );
}

/// Kernen i regressionen: hos en bruger, hvis aktivitet sjældent siger noget
/// om timerens kunde, må de nye lag ikke koste rigtige forslag.
#[test]
fn new_layers_never_make_a_low_precision_user_worse() {
    for days in [7, 14] {
        let set = tt_matcher::synthetic3::generate_hard(days);
        let before = online(&set, &cascade());
        let after = online(&set, &MatchConfig::default());
        println!(
            "svær {days} dage: kunde {:.3} → {:.3}, præcision {:.3} → {:.3}, forkert {} → {} min",
            before.client_accuracy(),
            after.client_accuracy(),
            before.client_precision(),
            after.client_precision(),
            wrong_secs(&before) / 60,
            wrong_secs(&after) / 60,
        );
        assert!(
            before.client_precision() < 0.6,
            "sættet skal være svært: {:.3}",
            before.client_precision()
        );
        assert!(
            after.client_correct_secs >= before.client_correct_secs,
            "{days} dage: rigtige minutter {} < {}",
            after.client_correct_secs / 60,
            before.client_correct_secs / 60
        );
        assert!(
            wrong_secs(&after) <= wrong_secs(&before),
            "{days} dage: flere forkerte minutter"
        );
        assert!(
            after.client_precision() >= before.client_precision(),
            "{days} dage: lavere præcision"
        );
    }
}

/// Modellen slår sig ikke til hos en bruger, hvor den tager fejl lige så
/// ofte, som den rammer (det skete på Mads' eksport ved ca. 20 % præcision).
#[test]
fn the_model_stays_off_for_a_low_precision_user() {
    let set = tt_matcher::synthetic3::generate_hard(14);
    let on = MatchConfig {
        naive_bayes: ModelMode::Shadow,
        ..MatchConfig::default()
    };
    let shadow = online(&set, &on);
    let auto = online(&set, &MatchConfig::default());
    assert_eq!(shadow.client_correct_secs, auto.client_correct_secs);
    assert_eq!(wrong_secs(&shadow), wrong_secs(&auto));
}
