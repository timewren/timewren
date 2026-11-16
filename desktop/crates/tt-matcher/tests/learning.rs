//! "Efter 5 ens rettelser skal samme mønster ramme mindst 95 %."
//!
//! Hvert scenarie starter med et forkert eller uklart forslag, retter det 5
//! gange (med nye titler/tal hver gang) og måler så på 40 nye blokke.

use tt_matcher::synthetic::catalog;
use tt_matcher::{ActivitySegment, Layer, Matcher, PatternStore, Target};

const BLOCK: i64 = 20 * 60;

/// Én blok (2 segmenter) for variant `n` af et mønster.
type Gen = fn(n: i64) -> Vec<ActivitySegment>;

fn at(n: i64, mut segs: Vec<ActivitySegment>) -> Vec<ActivitySegment> {
    let mut t = 1_793_602_800 + n * 3600;
    for s in &mut segs {
        s.start = t;
        s.end = t + BLOCK / 2;
        t = s.end;
    }
    segs
}

fn chrome(title: String, url: String) -> ActivitySegment {
    ActivitySegment {
        app: "Google Chrome".into(),
        title,
        url: Some(url),
        ..Default::default()
    }
}

fn github_prs(n: i64) -> Vec<ActivitySegment> {
    at(
        n,
        (0..2)
            .map(|i| {
                let pr = n * 7 + i;
                chrome(
                    format!("Ændring {pr} by mads · Pull Request #{pr} · kunde-org/website - Google Chrome"),
                    format!("https://github.com/kunde-org/website/pull/{pr}"),
                )
            })
            .collect(),
    )
}

fn canva_against_names(n: i64) -> Vec<ActivitySegment> {
    at(
        n,
        (0..2)
            .map(|i| {
                chrome(
                    format!(
                        "Udkast {} – Julekampagne {} – Canva - Google Chrome",
                        n + i,
                        2020 + n
                    ),
                    format!("https://www.canva.com/design/D{n}{i}/edit"),
                )
            })
            .collect(),
    )
}

fn word_document(n: i64) -> Vec<ActivitySegment> {
    at(
        n,
        (0..2)
            .map(|i| {
                let doc = format!("Prisliste Gårdbutik {}", 2000 + n * 2 + i);
                ActivitySegment {
                    app: "Microsoft Word".into(),
                    title: format!("{doc}.docx - Word"),
                    document: Some(doc),
                    ..Default::default()
                }
            })
            .collect(),
    )
}

fn unknown_repo(n: i64) -> Vec<ActivitySegment> {
    at(
        n,
        (0..2)
            .map(|i| ActivitySegment {
                app: "Code".into(),
                title: format!("fil{}.ts - website - Visual Studio Code", n + i),
                repo_remote: Some(if i == 0 {
                    "git@github.com:someone/website.git".into()
                } else {
                    "https://github.com/someone/website".into()
                }),
                ..Default::default()
            })
            .collect(),
    )
}

fn wrong_identity(n: i64) -> Vec<ActivitySegment> {
    at(
        n,
        (0..2)
            .map(|i| {
                chrome(
                    format!("Side {} - Google Chrome", n + i),
                    format!("https://www.ark-tegnestue.dk/side/{}", n + i),
                )
            })
            .collect(),
    )
}

fn unknown_path(n: i64) -> Vec<ActivitySegment> {
    at(
        n,
        (0..2)
            .map(|i| ActivitySegment {
                app: "Ghostty".into(),
                title: format!("make build-{} — projektx", n + i),
                path: Some(format!(
                    "/Users/mads/dev/projektx/{}",
                    ["src", "test"][i as usize]
                )),
                ..Default::default()
            })
            .collect(),
    )
}

fn hit_rate(m: &Matcher, make: Gen, truth: &Target) -> f64 {
    let (mut right, mut total) = (0i64, 0i64);
    for n in 100..140 {
        let segs = make(n);
        let s = m.suggest(&segs);
        total += BLOCK;
        right += s
            .iter()
            .filter(|x| x.target.as_ref() == Some(truth))
            .map(|x| x.duration())
            .sum::<i64>();
    }
    right as f64 / total as f64
}

fn scenario(name: &str, make: Gen, truth: Target) -> Matcher {
    let mut m = Matcher::new(catalog(), PatternStore::new());
    let start = hit_rate(&m, make, &truth);
    assert!(start < 0.5, "{name}: skal starte forkert");
    for n in 0..5 {
        let segs = make(n);
        let s = m.suggest(&segs);
        assert_eq!(s.len(), 1, "{name}: én blok");
        m.correct(&segs, &s[0], &truth);
    }
    let rate = hit_rate(&m, make, &truth);
    println!("{name}: {start:.2} før, {rate:.2} efter 5 rettelser");
    assert!(rate >= 0.95, "{name}: {rate:.3} efter 5 rettelser");
    m
}

fn p(c: &str, p: &str) -> Target {
    Target::project(Some(c), p)
}

#[test]
fn domain_on_shared_code_host() {
    scenario("github-PR'er", github_prs, p("c-bageriet", "p-bag-web"));
}

#[test]
fn title_template_beats_name_matching() {
    scenario(
        "Canva-titel",
        canva_against_names,
        p("c-frisor", "p-fri-book"),
    );
}

#[test]
fn document_keyword_beats_name_matching() {
    scenario("Word-dokument", word_document, p("c-sonder", "p-son-aars"));
}

#[test]
fn unknown_repo_is_learned_across_remote_forms() {
    scenario("ukendt repo", unknown_repo, p("c-bageriet", "p-bag-web"));
}

#[test]
fn corrections_override_a_wrong_identity() {
    let m = scenario(
        "forkert identitet",
        wrong_identity,
        p("c-bageriet", "p-bag-jul"),
    );
    let s = m.suggest(&wrong_identity(200));
    assert_eq!(s[0].source.unwrap().layer, Layer::Pattern);
    assert!(s[0].reason.contains("rettet 5 gange"), "{}", s[0].reason);
}

#[test]
fn unknown_path_is_learned() {
    scenario("ukendt mappe", unknown_path, p("c-acme", "p-acme-drift"));
}

#[test]
fn contradicting_corrections_lower_confidence() {
    let truth = p("c-bageriet", "p-bag-web");
    let other = p("c-frisor", "p-fri-web");
    let mut m = Matcher::new(catalog(), PatternStore::new());
    for n in 0..5 {
        let segs = github_prs(n);
        let s = m.suggest(&segs);
        m.correct(&segs, &s[0], &truth);
    }
    let before = m.suggest(&github_prs(50))[0].confidence;
    let segs = github_prs(6);
    let s = m.suggest(&segs);
    m.correct(&segs, &s[0], &other);
    let after = m.suggest(&github_prs(50));
    assert!(
        after[0].confidence < before,
        "{} < {before}",
        after[0].confidence
    );
    // Flere modstridende rettelser: matcheren holder op med at gætte.
    for n in 7..12 {
        let segs = github_prs(n);
        let s = m.suggest(&segs);
        m.correct(&segs, &s[0], &other);
    }
    let last = m.suggest(&github_prs(50));
    assert_eq!(
        last[0].target.as_ref(),
        Some(&other),
        "den nyeste vilje vinder til sidst"
    );
}

#[test]
fn patterns_never_store_whole_titles() {
    let mut m = Matcher::new(catalog(), PatternStore::new());
    for make in [
        github_prs as Gen,
        canva_against_names,
        word_document,
        wrong_identity,
    ] {
        for n in 0..5 {
            let segs = make(n);
            let s = m.suggest(&segs);
            m.correct(&segs, &s[0], &p("c-bageriet", "p-bag-web"));
        }
    }
    let json = serde_json::to_string(&m.patterns).unwrap();
    for leak in [
        "Pull Request",
        "Udkast",
        "Prisliste Gårdbutik 20",
        "Side 1",
        "#3",
    ] {
        assert!(!json.contains(leak), "{leak} i {json}");
    }
}
