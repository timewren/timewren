//! Aktivitet mod en rigtig aktivitets-DB i en midlertidig mappe.

use super::*;
use crate::backend::{ActivityStatus, block_span};

fn blocks(e: &Engine, date: NaiveDate) -> Vec<crate::backend::ActivityBlock> {
    e.activity_day(date, &customers(), &projects(), &[])
        .unwrap()
        .blocks
}

fn unknown(date: NaiveDate, from: (u32, u32), to: (u32, u32)) -> tr::ActivitySegment {
    browser(date, from, to, "Ordre 41 – Gamma", "gamma-portal.example")
}

#[test]
fn unclear_activity_is_shown_and_assigning_it_teaches_the_rest_of_the_day() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[
            // Ukendt domæne: ingen regel, intet mønster → uklar.
            unknown(day(), (9, 0), (10, 0)),
            browser(day(), (10, 0), (11, 0), "Alfa shop", "alfa-shop.dk"),
            unknown(day(), (13, 0), (14, 0)),
        ],
    );
    let e = engine(dir.path());
    let b = blocks(&e, day());
    let status: Vec<_> = b.iter().map(|x| x.status).collect();
    assert_eq!(
        status,
        vec![
            ActivityStatus::Unclear,
            ActivityStatus::Suggested,
            ActivityStatus::Unclear
        ]
    );
    assert_eq!(b[0].domain.as_deref(), Some("gamma-portal.example"));
    assert_eq!(b[0].title, "Ordre 41 – Gamma");
    assert_eq!(b[1].customer_id.as_deref(), Some("k_alfa"));
    assert!(b[1].suggestion_id.is_some());

    // Tildel den første til Beta og husk det.
    let span = block_span(&b[0].id).unwrap();
    e.activity_assigned(&[span], "k_beta", None, true, &customers(), &projects());
    let after = blocks(&e, day());
    assert_eq!(after[0].status, ActivityStatus::Registered);
    // Med tilbagevirkende kraft: eftermiddagens blok foreslås nu til Beta.
    let last = after.last().unwrap();
    assert_eq!(last.status, ActivityStatus::Suggested, "{after:#?}");
    assert_eq!(last.customer_id.as_deref(), Some("k_beta"));
    // Og den lærte regel gælder også en anden dag.
    put(dir.path(), &[unknown(other_day(), (9, 0), (9, 30))]);
    let s = suggest(&e, other_day());
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].customer_id.as_deref(), Some("k_beta"));
}

#[test]
fn assigning_without_remember_learns_nothing() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[
            unknown(day(), (9, 0), (10, 0)),
            unknown(day(), (13, 0), (14, 0)),
        ],
    );
    let e = engine(dir.path());
    let b = blocks(&e, day());
    let span = block_span(&b[0].id).unwrap();
    e.activity_assigned(&[span], "k_beta", None, false, &customers(), &projects());
    let after = blocks(&e, day());
    assert_eq!(after[0].status, ActivityStatus::Registered);
    assert_eq!(after[1].status, ActivityStatus::Unclear);
}

#[test]
fn not_work_hides_the_suggestion_and_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[browser(
            day(),
            (10, 0),
            (11, 0),
            "Alfa shop",
            "alfa-shop.dk",
        )],
    );
    let e = engine(dir.path());
    let b = blocks(&e, day());
    assert_eq!(b[0].status, ActivityStatus::Suggested);
    e.activity_not_work(&[block_span(&b[0].id).unwrap()])
        .unwrap();
    assert!(suggest(&e, day()).is_empty());
    drop(e);
    let e = engine(dir.path());
    assert_eq!(blocks(&e, day())[0].status, ActivityStatus::NotWork);
    assert!(suggest(&e, day()).is_empty());
}

#[test]
fn split_merge_and_delete() {
    let dir = tempfile::tempdir().unwrap();
    put(
        dir.path(),
        &[
            unknown(day(), (9, 0), (10, 0)),
            browser(day(), (10, 0), (10, 30), "Nyheder", "nyheder.example"),
        ],
    );
    let e = engine(dir.path());
    let b = blocks(&e, day());
    assert_eq!(b.len(), 2);
    let first = block_span(&b[0].id).unwrap();
    let at = at(day(), 9, 20).timestamp();
    assert!(e.split_activity(first, first.0).is_err(), "ikke på kanten");
    e.split_activity(first, at).unwrap();
    let b = blocks(&e, day());
    assert_eq!(b.len(), 3);
    assert_eq!((b[0].start, b[0].end), (time(9, 0), time(9, 20)));

    // Flet de to sidste.
    let (a, _) = block_span(&b[1].id).unwrap();
    let (_, z) = block_span(&b[2].id).unwrap();
    e.merge_activity((a, z)).unwrap();
    let b = blocks(&e, day());
    assert_eq!(b.len(), 2);
    assert_eq!((b[1].start, b[1].end), (time(9, 20), time(10, 30)));
    assert_eq!(b[1].other_apps, Vec::<String>::new(), "samme program");

    // Slet den første: kun 9:00-9:20 forsvinder fra databasen.
    e.delete_activity(&[block_span(&b[0].id).unwrap()]).unwrap();
    let b = blocks(&e, day());
    assert_eq!(b.len(), 1);
    assert_eq!((b[0].start, b[0].end), (time(9, 20), time(10, 30)));
    let st = e.activity_storage().unwrap();
    assert_eq!(st.days, 1);
    assert_eq!(st.segments, 2);
    assert!(st.bytes > 0);

    e.delete_all_activity().unwrap();
    assert!(blocks(&e, day()).is_empty());
    assert_eq!(e.activity_storage().unwrap().segments, 0);
}

#[test]
fn entries_on_the_day_mark_blocks_as_registered() {
    let dir = tempfile::tempdir().unwrap();
    put(dir.path(), &[unknown(day(), (9, 0), (11, 0))]);
    let e = engine(dir.path());
    let reg = crate::backend::services::RegisteredSpan {
        start: at(day(), 9, 0).timestamp(),
        end: at(day(), 10, 0).timestamp(),
        customer_id: Some("k_alfa".into()),
        project_id: Some("p_webshop".into()),
    };
    let b = e
        .activity_day(day(), &customers(), &projects(), &[reg])
        .unwrap()
        .blocks;
    assert_eq!(b.len(), 2);
    assert_eq!(b[0].status, ActivityStatus::Registered);
    assert_eq!(b[0].project_id.as_deref(), Some("p_webshop"));
    assert_eq!(b[1].status, ActivityStatus::Unclear);
}

#[test]
fn rules_in_the_activity_db_can_be_listed_and_removed() {
    let dir = tempfile::tempdir().unwrap();
    {
        let store = tr::ActivityStore::open(&dir.path().join("activity.db")).unwrap();
        store
            .add_exclusion_rule("window_title", "contains", "Privat")
            .unwrap();
    }
    let e = engine(dir.path());
    let rules = e.stored_exclusions().unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(
        (rules[0].field.as_str(), rules[0].value.as_str()),
        ("window_title", "Privat")
    );
    e.remove_stored_exclusion(rules[0].id).unwrap();
    assert!(e.stored_exclusions().unwrap().is_empty());
}
