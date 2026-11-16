use chrono::{Local, NaiveTime, TimeZone, Utc};

use super::*;
use crate::backend::Settings;

fn seed(dir: &Path, today: NaiveDate) {
    let at = |d: NaiveDate, h: u32| {
        Local
            .from_local_datetime(&d.and_time(NaiveTime::from_hms_opt(h, 0, 0).unwrap()))
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    };
    let store = tt_tracker::ActivityStore::open(&dir.join("detektion").join("activity.db")).unwrap();
    // I dag to stykker, i går ét, for tre dage siden ét (uden for de 3 dage).
    for (back, h) in [(0, 8), (0, 13), (1, 9), (3, 9)] {
        let d = today - Duration::days(back);
        store
            .insert(&tt_tracker::ActivitySegment {
                id: None,
                app: "HemmeligApp".into(),
                app_id: "hemmeligapp".into(),
                title: "Hemmelig titel".into(),
                url: Some("https://hemmelig.example/sti".into()),
                domain: Some("hemmelig.example".into()),
                repo_remote: None,
                repo_root: None,
                branch: None,
                path: Some("/Users/navn/projekt".into()),
                document: None,
                start: at(d, h),
                end: at(d, h + 1),
                idle: false,
            })
            .unwrap();
    }
}

#[test]
fn rapporten_har_kun_tal_og_foelger_indstillingerne() {
    let dir = tempfile::tempdir().unwrap();
    let today = Local::now().date_naive();
    seed(dir.path(), today);
    let mut s = Settings::first_start();
    s.tracking.retention_days = 10;
    crate::backend::repo::files::store_settings(dir.path(), &s).unwrap();

    let out = activity_report(dir.path(), today);
    let text = out.join("\n");
    let has = |l: &str| out.iter().any(|x| x == l);
    assert!(has("retention_days (settings.json): 10"), "{text}");
    assert!(has(&format!("segmenter {today}: 2")), "{text}");
    assert!(has(&format!("segmenter {}: 1", today - Duration::days(1))), "{text}");
    assert!(has(&format!("segmenter {}: 0", today - Duration::days(2))), "{text}");
    assert!(has("segmenter i alt: 4"), "{text}");
    assert!(has("dage med aktivitet: 3"), "{text}");
    assert!(has(&format!("earliest: {}", today - Duration::days(9))), "{text}");
    assert!(has(&format!("blokke i dag ({today}): 2")), "{text}");
    for secret in ["Hemmelig", "hemmelig", "HemmeligApp", "/Users/navn"] {
        assert!(!text.contains(secret), "{secret} i rapporten:\n{text}");
    }
}

#[test]
fn uden_database_oprettes_intet() {
    let dir = tempfile::tempdir().unwrap();
    let out = activity_report(dir.path(), Local::now().date_naive());
    assert!(out.iter().any(|l| l == "activity.db: findes ikke"), "{out:?}");
    assert!(!dir.path().join("detektion").exists());
    assert!(!dir.path().join("settings.json").exists());
}

#[test]
fn datamappen_vises_uden_brugernavn() {
    let home = Path::new("/Users/fornavn");
    let dir = home.join("Library/Application Support/TimeTrack");
    let shown = without_home(&dir, Some(home));
    assert!(!shown.contains("fornavn"), "{shown}");
    assert_eq!(shown, Path::new("~").join("Library/Application Support/TimeTrack").display().to_string());
    // Uden for hjemmemappen (fx TT_DATA_DIR) vises stien, som den er.
    assert_eq!(without_home(Path::new("/tmp/tt"), Some(home)), "/tmp/tt");
    assert_eq!(without_home(Path::new("/tmp/tt"), None), "/tmp/tt");
}

#[test]
fn flaget_genkendes() {
    let args = |v: &[&str]| v.iter().map(std::ffi::OsString::from).collect::<Vec<_>>().into_iter();
    assert!(wanted(args(&["--diagnose-activity"])));
    assert!(wanted(args(&["--autostart", "--diagnose-activity"])));
    assert!(!wanted(args(&["--autostart"])));
    assert!(!wanted(args(&["timetrack://auth/callback?code=x"])));
}
