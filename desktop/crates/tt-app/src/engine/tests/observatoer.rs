//! Observér først, spørg bagefter: observatøren i motoren, manuelle valg
//! vinder, git-gren → opgave og den anonymiserede eksport.

use super::*;
use crate::backend::{Entry, ObserverReply, Task, TaskStatus};

/// I går: observatøren tæller de seneste 14 dage fra uret.
fn yesterday() -> NaiveDate {
    Local::now().date_naive() - chrono::Duration::days(1)
}

/// Kode i repoet bph-webshop med en gren.
fn code(date: NaiveDate, from: (u32, u32), to: (u32, u32), root: &Path, branch: &str) -> tr::ActivitySegment {
    tr::ActivitySegment {
        id: None,
        app: "Code".into(),
        app_id: "code".into(),
        title: "cart.ts — bph-webshop".into(),
        url: None,
        domain: None,
        repo_remote: Some("github.com/acme/bph-webshop".into()),
        repo_root: Some(root.to_string_lossy().into_owned()),
        branch: Some(branch.into()),
        path: Some(root.to_string_lossy().into_owned()),
        document: None,
        start: at(date, from.0, from.1),
        end: at(date, to.0, to.1),
        idle: false,
    }
}

/// En formiddag: 3 timer med repoet og butikkens side skiftevis.
fn morning(date: NaiveDate, root: &Path) -> Vec<tr::ActivitySegment> {
    let mut v = Vec::new();
    let hm = |min: u32| (8 + min / 60, min % 60);
    for i in 0..9u32 {
        let start = i * 20;
        v.push(code(date, hm(start), hm(start + 14), root, "feat/BPH-12-kurv"));
        v.push(browser(date, hm(start + 14), hm(start + 20), "Kurv – BPH", "bph-shop.dk"));
    }
    v
}

fn bph_customers() -> Vec<Customer> {
    vec![customer("k_bph", "Bageriet på Hjørnet"), customer("k_beta", "Beta")]
}

fn bph_projects() -> Vec<Project> {
    vec![project("p_shop", "k_bph", "Butik", &[])]
}

fn entry(date: NaiveDate, from: (u32, u32), to: (u32, u32), customer: &str) -> Entry {
    Entry {
        id: format!("e{}{}", from.0, from.1),
        customer_id: customer.into(),
        project_id: None,
        task_id: None,
        description: String::new(),
        date,
        start: Some(time(from.0, from.1)),
        end: Some(time(to.0, to.1)),
        minutes: 0,
        billable: true,
        invoice_id: None,
    }
}

#[test]
fn observer_asks_after_two_hours_and_the_answer_applies_backwards() {
    let dir = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let date = yesterday();
    let e = engine(dir.path());
    let (cs, ps) = (bph_customers(), bph_projects());

    // Under to timer: ingen spørgsmål endnu, men fremskridt.
    put(dir.path(), &morning(date, repo.path())[..4]);
    let card = e.observer_card(&cs, &ps).unwrap();
    assert!(card.observed_minutes > 0 && card.observed_minutes < card.ready_after_minutes);
    assert!(card.question.is_none());

    // Resten af formiddagen: nu er der et spørgsmål om repo og butik sammen.
    put(dir.path(), &morning(date, repo.path())[4..]);
    let card = e.observer_card(&cs, &ps).unwrap();
    let q = card.question.expect("et spørgsmål");
    let labels: Vec<&str> = q.sources.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"acme/bph-webshop"), "{labels:?}");
    assert!(labels.contains(&"bph-shop.dk"), "{labels:?}");
    // "bph" er Bageriet på Hjørnets forbogstaver.
    assert_eq!(q.customer_id.as_deref(), Some("k_bph"));

    // Før svaret: gårsdagens blokke er uklare (og vises ikke).
    assert!(e.suggestions(date, &cs, &ps).unwrap().is_empty());
    e.observer_answer(
        &q.id,
        &ObserverReply::Target {
            customer_id: "k_bph".into(),
            project_id: Some("p_shop".into()),
        },
        &cs,
        &ps,
    )
    .unwrap();
    // Bagud: de samme ubekræftede blokke foreslås nu på kunden.
    let after = e.suggestions(date, &cs, &ps).unwrap();
    assert!(!after.is_empty());
    assert!(after.iter().all(|s| s.customer_id.as_deref() == Some("k_bph")));
    assert!(e.observer_card(&cs, &ps).unwrap().question.is_none());

    // Svaret overlever en genstart.
    let e2 = engine(dir.path());
    assert!(!e2.suggestions(date, &cs, &ps).unwrap().is_empty());
    assert_eq!(e2.observer_card(&cs, &ps).unwrap().answered, 1);
}

#[test]
fn never_and_skip() {
    let dir = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    put(dir.path(), &morning(yesterday(), repo.path()));
    let (cs, ps) = (customers(), projects());
    let q = e.observer_card(&cs, &ps).unwrap().question.unwrap();
    e.observer_answer(&q.id, &ObserverReply::Skip, &cs, &ps).unwrap();
    assert!(e.observer_card(&cs, &ps).unwrap().question.is_none());
    e.observer_answer(&q.id, &ObserverReply::Never, &cs, &ps).unwrap();
    let e2 = engine(dir.path());
    assert!(e2.observer_card(&cs, &ps).unwrap().question.is_none());
    // "Aldrig" lærer ingen mønstre.
    assert!(lock(&e2.patterns).store.is_empty());
}

/// Timings klage: en automatisk regel må aldrig overskrive et manuelt valg.
#[test]
fn manual_choices_always_win() {
    let dir = tempfile::tempdir().unwrap();
    let date = day();
    let e = engine(dir.path());
    put(
        dir.path(),
        &[
            browser(date, (9, 0), (10, 0), "Ordrer", "alfa-shop.dk"),
            browser(date, (10, 0), (11, 0), "Ordrer", "alfa-shop.dk"),
            browser(date, (13, 0), (14, 0), "Ordrer", "alfa-shop.dk"),
        ],
    );
    // Brugeren har selv ført 13-14 på Beta (timer eller manuel post).
    e.set_logged_spans(date, vec![(time(13, 0), time(14, 0))]);
    let s = suggest(&e, date);
    assert_eq!(s.len(), 1, "{s:?}");
    assert_eq!((s[0].start, s[0].end), (time(9, 0), time(11, 0)));

    // Bekræft 9-11 på Alfa. Et senere stærkt mønster mod Beta (fx et svar
    // til observatøren) må ikke flytte den bekræftede blok.
    let entry_input = e.entry_for(&s[0].id, None).unwrap();
    assert_eq!(entry_input.customer_id, "k_alfa");
    e.confirmed(&s[0].id, None, "post1");
    {
        let mut p = lock(&e.patterns);
        p.store.teach(
            &mm::PatternKey::Domain {
                domain: "alfa-shop.dk".into(),
            },
            &mm::Target::client("k_beta"),
        );
    }
    assert!(suggest(&e, date).is_empty());
}

#[test]
fn branch_and_commit_give_a_task() {
    let dir = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let date = day();
    // Reflog med et commit midt i blokken.
    let logs = repo.path().join(".git").join("logs");
    std::fs::create_dir_all(&logs).unwrap();
    let ts = at(date, 9, 30).timestamp();
    std::fs::write(
        logs.join("HEAD"),
        format!("{0} {0} Navn <m@x> {ts} +0100\tcommit: Gem kurven\n", "a".repeat(40)),
    )
    .unwrap();
    let e = engine(dir.path());
    let mut seg = code(date, (9, 0), (10, 0), repo.path(), "feat/BPH-12-kurv");
    seg.repo_remote = Some("github.com/acme/alfa-webshop".into());
    seg.title = "cart.ts — alfa-webshop".into();
    put(dir.path(), &[seg]);
    // Repoet er kendt (navnematch alene er under tærsklen).
    lock(&e.patterns).store.teach(
        &mm::PatternKey::Repo {
            remote: "github.com/acme/alfa-webshop".into(),
        },
        &mm::Target::project(Some("k_alfa"), "p_webshop"),
    );
    let task = |id: &str, title: &str, project: &str| Task {
        id: id.into(),
        project_id: project.into(),
        title: title.into(),
        status: TaskStatus::Todo,
        due: None,
        logged_minutes: 0,
        estimate_minutes: None,
        priority: None,
        description: None,
        customer_id: None,
        status_id: None,
        completed: None,
    };
    e.set_tasks(vec![
        task("t1", "BPH-12 Kurven husker ikke varer", "p_webshop"),
        task("t2", "Moms i kurven", "p_webshop"),
        task("t3", "BPH-12 andet projekt", "p_drift"),
    ]);
    let s = suggest(&e, date);
    assert_eq!(s.len(), 1, "{s:?}");
    assert_eq!(s[0].project_id.as_deref(), Some("p_webshop"));
    assert_eq!(s[0].task_id.as_deref(), Some("t1"));
    assert_eq!(s[0].task_title.as_deref(), Some("BPH-12 Kurven husker ikke varer"));
    // Bekræft: posten får opgaven. Retter brugeren projektet, følger den ikke med.
    assert_eq!(e.entry_for(&s[0].id, None).unwrap().task_id.as_deref(), Some("t1"));
    let other = SuggestionCorrection {
        project_id: Some("p_drift".into()),
        customer_id: Some("k_beta".into()),
        ..Default::default()
    };
    assert_eq!(e.entry_for(&s[0].id, Some(&other)).unwrap().task_id, None);
}

#[test]
fn exported_test_set_has_no_names() {
    let dir = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let date = yesterday();
    let e = engine(dir.path());
    put(dir.path(), &morning(date, repo.path()));
    let (cs, ps) = (bph_customers(), bph_projects());
    let entries = vec![entry(date, (8, 0), (9, 0), "k_bph")];
    let json = e.export_test_set(&entries, &cs, &ps, 30).unwrap();
    let set: mm::labelset::Labelset = serde_json::from_str(&json).unwrap();
    assert!(!set.segments.is_empty());
    assert!(set.segments.iter().all(|s| s.expected == Some(mm::Target::client("c1"))));
    let lower = json.to_lowercase();
    for word in ["bageriet", "hjørnet", "bph", "webshop", "kurv", "k_bph", repo.path().to_str().unwrap()] {
        assert!(!lower.contains(&word.to_lowercase()), "{word}");
    }
}

/// Review P2: et svar på en gruppe, der er ændret siden (nyt id), lærer intet.
#[test]
fn stale_answer_teaches_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    put(dir.path(), &morning(yesterday(), repo.path()));
    let (cs, ps) = (bph_customers(), bph_projects());
    let reply = ObserverReply::Target {
        customer_id: "k_bph".into(),
        project_id: None,
    };
    assert!(e.observer_answer("og_0000000000000000", &reply, &cs, &ps).is_err());
    assert!(lock(&e.patterns).store.is_empty());
    assert!(e.observer_card(&cs, &ps).unwrap().question.is_some());
}
