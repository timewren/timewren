use chrono::NaiveDate;

use super::logic::{self, legacy_status_for_lane, resolve_lane};
use super::{
    edit_task_choices, new_task_choices, panel_input, place_choices, place_value,
    progress_text, project_filter_choices, project_label, validate_task,
};
use crate::backend::{Customer, LaneCategory, Project, ProjectStatus, Task, TaskLane, TaskStatus};

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
}

fn cust(id: &str, name: &str, archived: bool) -> Customer {
    Customer {
        id: id.into(),
        name: name.into(),
        email: None,
        hourly_rate: None,
        archived,
        cvr: None,
        ..Default::default()
    }
}

fn proj(id: &str, customer: &str, name: &str, status: ProjectStatus) -> Project {
    Project {
        id: id.into(),
        customer_id: customer.into(),
        name: name.into(),
        status,
        hourly_rate: None,
        budget_minutes: None,
        url_patterns: vec![],
    }
}

fn task(id: &str, status: TaskStatus, status_id: Option<&str>) -> Task {
    Task {
        id: id.into(),
        project_id: String::new(),
        title: id.into(),
        status,
        due: None,
        logged_minutes: 0,
        estimate_minutes: None,
        priority: None,
        description: None,
        customer_id: None,
        status_id: status_id.map(Into::into),
        completed: None,
    }
}

fn lane(id: &str, name: &str, category: LaneCategory) -> TaskLane {
    TaskLane {
        id: id.into(),
        name: name.into(),
        color: None,
        category,
        is_archive: category == LaneCategory::Done,
    }
}

/// En tavle som Milles: egne navne, to "i gang"-kolonner og annulleret.
fn milles_tavle() -> Vec<TaskLane> {
    vec![
        lane("ideer", "Idéer", LaneCategory::NotStarted),
        lane("todo", "Todo", LaneCategory::NotStarted),
        lane("i_gang", "I gang", LaneCategory::InProgress),
        lane("venter", "Venter på kunde", LaneCategory::InProgress),
        lane("afsluttet", "Afsluttet", LaneCategory::Done),
        lane("annulleret", "Annulleret", LaneCategory::Cancelled),
    ]
}

#[test]
fn placering_foelger_web_statusid_vinder_naar_det_passer() {
    let lanes = milles_tavle();
    let at = |t: &Task| resolve_lane(t, &lanes).map(|ix| lanes[ix].id.as_str());
    // statusId passer med status: kolonnen vinder (også en egen).
    assert_eq!(at(&task("a", TaskStatus::InProgress, Some("venter"))), Some("venter"));
    assert_eq!(at(&task("a", TaskStatus::Done, Some("annulleret"))), Some("annulleret"));
    assert_eq!(at(&task("a", TaskStatus::Backlog, Some("ideer"))), Some("ideer"));
    // Status ændret andetsteds (desktop-listen, API): kolonnen passer ikke
    // længere, så standardnavnet og derefter kategorien afgør.
    assert_eq!(at(&task("a", TaskStatus::Done, Some("venter"))), Some("afsluttet"));
    assert_eq!(at(&task("a", TaskStatus::Todo, Some("venter"))), Some("todo"));
    assert_eq!(at(&task("a", TaskStatus::InProgress, None)), Some("i_gang"));
    // Backlog findes ikke som navn: første "ikke startet"-kolonne.
    assert_eq!(at(&task("a", TaskStatus::Backlog, None)), Some("ideer"));
    // Ukendt kolonne (et andet board): som uden statusId.
    assert_eq!(at(&task("a", TaskStatus::Done, Some("findes-ikke"))), Some("afsluttet"));
    // Ingen kolonne i kategorien: bliver i sin egen, ellers den første.
    let only = vec![
        lane("x", "Inbox", LaneCategory::NotStarted),
        lane("y", "Lukket", LaneCategory::Cancelled),
    ];
    assert_eq!(resolve_lane(&task("a", TaskStatus::InProgress, Some("y")), &only), Some(1));
    assert_eq!(resolve_lane(&task("a", TaskStatus::InProgress, None), &only), Some(0));
    // Afsluttet uden en "done"-kolonne lander i annulleret (lukket).
    assert_eq!(resolve_lane(&task("a", TaskStatus::Done, None), &only), Some(1));
    assert_eq!(resolve_lane(&task("a", TaskStatus::Todo, None), &[]), None);
}

#[test]
fn flyt_giver_kolonnens_gamle_status() {
    let lanes = milles_tavle();
    let to = |name: &str, cur| {
        legacy_status_for_lane(lanes.iter().find(|l| l.name == name).unwrap(), cur)
    };
    // Standardnavnene beholder deres egen status.
    assert_eq!(to("Todo", TaskStatus::Backlog), TaskStatus::Todo);
    assert_eq!(to("I gang", TaskStatus::Todo), TaskStatus::InProgress);
    // Egne kolonner: kategorien afgør; "ikke startet" bevarer backlog/todo.
    assert_eq!(to("Venter på kunde", TaskStatus::Todo), TaskStatus::InProgress);
    assert_eq!(to("Idéer", TaskStatus::Backlog), TaskStatus::Backlog);
    assert_eq!(to("Idéer", TaskStatus::Done), TaskStatus::Todo);
    assert_eq!(to("Annulleret", TaskStatus::Todo), TaskStatus::Done);
    // Et standardnavn med en anden kategori end standarden: kategorien vinder.
    let odd = lane("x", "Afsluttet", LaneCategory::InProgress);
    assert_eq!(legacy_status_for_lane(&odd, TaskStatus::Todo), TaskStatus::InProgress);
    // Flyttet kort står bagefter i den kolonne, det blev sluppet i.
    for (ix, l) in lanes.iter().enumerate() {
        let moved = task("a", legacy_status_for_lane(l, TaskStatus::Todo), Some(&l.id));
        assert_eq!(resolve_lane(&moved, &lanes), Some(ix), "{}", l.name);
    }
}

#[test]
fn faste_kolonner_placerer_efter_id_paa_alle_sprog() {
    let lanes = logic::fixed_lanes(|s| format!("{s:?} på et andet sprog"));
    for (ix, s) in TaskStatus::ALL.into_iter().enumerate() {
        assert_eq!(resolve_lane(&task("a", s, None), &lanes), Some(ix));
    }
    // Flyt: id'et er statussen, også når navnet er oversat (Backlogg, To do).
    for (ix, l) in lanes.iter().enumerate() {
        for cur in TaskStatus::ALL {
            let to = legacy_status_for_lane(l, cur);
            assert_eq!(to, TaskStatus::ALL[ix], "{} fra {cur:?}", l.name);
            assert_eq!(resolve_lane(&task("a", to, None), &lanes), Some(ix));
        }
    }
}

#[test]
fn kortets_sted_er_kunde_og_projekt_og_udelades_uden() {
    let customers = vec![cust("k1", "Bageriet", false)];
    let projects = vec![proj("p1", "k1", "Webshop", ProjectStatus::Active)];
    let mut t = task("a", TaskStatus::Todo, None);
    let place = |t: &Task| logic::place_label(&customers, &projects, t, "Ukendt kunde");
    assert_eq!(place(&t), None, "hverken kunde eller projekt: ingen linje");
    t.customer_id = Some("k1".into());
    assert_eq!(place(&t).as_deref(), Some("Bageriet"));
    t.project_id = "p1".into();
    assert_eq!(place(&t).as_deref(), Some("Bageriet · Webshop"));
    // Kunden uden projekt tæller med i kundefilteret.
    t.project_id = String::new();
    let f = logic::Filters {
        customer: Some("k1".into()),
        ..Default::default()
    };
    assert!(logic::matches(&t, &customers, &projects, &f, today()));
}

#[test]
fn panelets_kunde_projekt_valg() {
    let customers = vec![cust("k1", "Bageriet", false), cust("k2", "Gammel", true)];
    let projects = vec![
        proj("p1", "k1", "Webshop", ProjectStatus::Active),
        proj("p2", "k1", "Pause", ProjectStatus::Paused),
    ];
    let mut t = task("a", TaskStatus::Todo, None);
    let labels = |t: &Task| {
        place_choices(&customers, &projects, t)
            .into_iter()
            .map(|c| (c.value.to_string(), c.label.to_string()))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        labels(&t),
        [
            ("".into(), "Ingen kunde eller projekt".into()),
            ("c:k1".into(), "Bageriet".into()),
            ("p:p1".into(), "Bageriet · Webshop".into()),
        ]
    );
    assert_eq!(place_value(&t), "");
    // Opgavens nuværende (arkiverede kunde, pauset projekt) er altid med.
    t.customer_id = Some("k2".into());
    assert_eq!(place_value(&t), "c:k2");
    assert!(labels(&t).contains(&("c:k2".into(), "Gammel".into())));
    t.project_id = "p2".into();
    assert_eq!(place_value(&t), "p:p2");
    assert!(labels(&t).contains(&("p:p2".into(), "Bageriet · Pause".into())));
}

#[test]
fn panelets_rettelse_bliver_til_en_opgave_rettelse() {
    let mut t = task("a", TaskStatus::InProgress, None);
    t.estimate_minutes = Some(120);
    let i = panel_input(&t, "p:p1", " Ny titel ", "3.11", " Tekst ", today()).unwrap();
    assert_eq!(
        (i.project_id.as_str(), i.customer_id.as_deref(), i.title.as_str()),
        ("p1", None, "Ny titel")
    );
    assert_eq!(i.due, NaiveDate::from_ymd_opt(2026, 11, 3));
    assert_eq!(i.description.as_deref(), Some("Tekst"));
    // Estimat bevares; status og prioritet røres ikke.
    assert_eq!((i.estimate_minutes, i.status, i.priority), (Some(120), None, None));
    let i = panel_input(&t, "c:k1", "A", "", "", today()).unwrap();
    assert_eq!((i.project_id.as_str(), i.customer_id.as_deref(), i.due), ("", Some("k1"), None));
    assert_eq!(i.description.as_deref(), Some(""), "tom beskrivelse fjerner den");
    let i = panel_input(&t, "", "A", "", "", today()).unwrap();
    assert_eq!((i.project_id.as_str(), i.customer_id), ("", None));
    let e = panel_input(&t, "", " ", "32.13", "", today()).unwrap_err();
    assert_eq!(e.title, Some("Skriv opgavens titel"));
    assert_eq!(e.due, Some("Skriv en dato, fx 31.12.2026"));
}

#[test]
fn fremdrift_som_tekst() {
    let mut t = Task {
        id: "a".into(),
        project_id: "p".into(),
        title: "a".into(),
        status: TaskStatus::Todo,
        due: None,
        logged_minutes: 340,
        estimate_minutes: None,
        priority: None,
        description: None,
        customer_id: None,
        status_id: None,
        completed: None,
    };
    assert_eq!(progress_text(&t), "5,67 t");
    t.estimate_minutes = Some(600);
    assert_eq!(progress_text(&t), "5,67 t af 10 t");
}

#[test]
fn projektvalg_foelger_kunden() {
    let customers = vec![cust("k1", "Bageriet", false), cust("k2", "Klinik", false)];
    let projects = vec![
        proj("p1", "k1", "Webshop", ProjectStatus::Active),
        proj("p2", "k2", "Booking", ProjectStatus::Active),
    ];
    let labels = |v: Vec<super::Choice>| {
        v.into_iter()
            .map(|c| c.label.to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        labels(project_filter_choices(&customers, &projects, None)),
        ["Alle projekter", "Bageriet · Webshop", "Klinik · Booking"]
    );
    assert_eq!(
        labels(project_filter_choices(&customers, &projects, Some("k2"))),
        ["Alle projekter", "Booking"]
    );
    assert_eq!(
        project_label(&customers, &projects[0]),
        "Bageriet · Webshop"
    );
}

#[test]
fn nye_opgaver_kun_paa_aktive_projekter_hos_aktive_kunder() {
    let customers = vec![cust("k1", "Bageriet", false), cust("k2", "Gammel", true)];
    let projects = vec![
        proj("p1", "k1", "Webshop", ProjectStatus::Active),
        proj("p2", "k1", "Pause", ProjectStatus::Paused),
        proj("p3", "k2", "Arkiv", ProjectStatus::Active),
    ];
    let c = new_task_choices(&customers, &projects);
    let got: Vec<(&str, &str)> = c.iter().map(|c| (c.value.as_ref(), c.label.as_ref())).collect();
    assert_eq!(
        got,
        vec![
            ("", "Ingen kunde eller projekt"),
            ("c:k1", "Bageriet"),
            ("p1", "Bageriet · Webshop"),
        ]
    );
}

/// En opgave hos en arkiveret kunde (uden projekt) skal beholde kunden,
/// når den rettes: valget skal stå i listen, ellers gemmes `clientId: null`.
#[test]
fn ret_opgave_beholder_arkiveret_kunde_og_inaktivt_projekt() {
    let customers = vec![cust("k1", "Bageriet", false), cust("k2", "Gammel", true)];
    let projects = vec![
        proj("p1", "k1", "Webshop", ProjectStatus::Active),
        proj("p2", "k1", "Pause", ProjectStatus::Paused),
    ];
    let has = |c: &[crate::ui::forms::Choice], v: &str| c.iter().any(|c| c.value.as_ref() == v);

    let mut on_customer = task("t1", TaskStatus::Todo, None);
    on_customer.customer_id = Some("k2".into());
    let c = edit_task_choices(&customers, &projects, Some(&on_customer));
    assert!(has(&c, "c:k2"));

    let mut on_project = task("t2", TaskStatus::Todo, None);
    on_project.project_id = "p2".into();
    assert!(has(&edit_task_choices(&customers, &projects, Some(&on_project)), "p2"));

    // Ny opgave: kun de aktive valg.
    assert_eq!(
        edit_task_choices(&customers, &projects, None).len(),
        new_task_choices(&customers, &projects).len()
    );
}

/// Web: projekt og kunde er valgfri på en ny opgave (`tasks.ts`
/// createTaskSchema). Før krævede desktop et projekt.
#[test]
fn opgave_uden_projekt_er_gyldig() {
    let t = today();
    let none = validate_task(None, "Ring til revisor", "", "", t).unwrap();
    assert_eq!((none.project_id.as_str(), none.customer_id), ("", None));
    let blank = validate_task(Some(""), "Ring", "", "", t).unwrap();
    assert_eq!((blank.project_id.as_str(), blank.customer_id), ("", None));
    let customer = validate_task(Some("c:k1"), "Ring", "", "", t).unwrap();
    assert_eq!(customer.project_id, "");
    assert_eq!(customer.customer_id.as_deref(), Some("k1"));
    let project = validate_task(Some("p1"), "Ring", "", "", t).unwrap();
    assert_eq!((project.project_id.as_str(), project.customer_id), ("p1", None));
}

/// Web's "Registrér tid" i opgavens sidepanel. Før fandtes den ikke i
/// desktop (kun timeren).
#[test]
fn tid_paa_opgave_valideres() {
    let t = today();
    let customers = vec![cust("k1", "Bageriet", false), Customer { internal: true, ..cust("k2", "Kontoret", false) }];
    let projects = vec![proj("p1", "k1", "Webshop", ProjectStatus::Active)];
    let mut task = task("t1", TaskStatus::Todo, None);
    task.title = "Ny forside".into();
    task.project_id = "p1".into();
    let ok = super::log_time_input(&task, &customers, &projects, "", "1,5", " ", t).unwrap();
    assert_eq!((ok.date, ok.minutes), (t, 90), "tom dato = i dag");
    assert_eq!(ok.description, "Ny forside", "uden tekst: opgavens titel");
    assert_eq!((ok.customer_id.as_str(), ok.project_id.as_deref(), ok.task_id.as_deref()), ("k1", Some("p1"), Some("t1")));
    assert!(ok.billable);
    // Intern kunde uden projekt: ikke fakturerbar.
    task.project_id = String::new();
    task.customer_id = Some("k2".into());
    let intern = super::log_time_input(&task, &customers, &projects, "1.11", "45m", "Møde", t).unwrap();
    assert_eq!((intern.customer_id.as_str(), intern.project_id), ("k2", None));
    assert_eq!((intern.date, intern.minutes, intern.description.as_str()), (NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(), 45, "Møde"));
    assert!(!intern.billable);
    let e = super::log_time_input(&task, &customers, &projects, "31.02", "", "", t).unwrap_err();
    assert!(e.date.is_some() && e.hours.is_some());
}

#[test]
fn timer_fra_opgave_uden_projekt() {
    let projects = vec![proj("p1", "k1", "Webshop", ProjectStatus::Active)];
    let mut t = task("t1", TaskStatus::Todo, None);
    let target = logic::timer_target(&projects, &t);
    assert_eq!(target.project_id, None, "før: Some(\"\"), som web afviste");
    assert_eq!(target.customer_id, None);
    t.customer_id = Some("k2".into());
    assert_eq!(logic::timer_target(&projects, &t).customer_id.as_deref(), Some("k2"));
    t.project_id = "p1".into();
    let target = logic::timer_target(&projects, &t);
    assert_eq!(target.project_id.as_deref(), Some("p1"));
    assert_eq!(target.customer_id.as_deref(), Some("k1"), "projektets kunde");
    assert_eq!(target.task_id.as_deref(), Some("t1"));
}

/// Web fjerner afsluttede opgaver ældre end 14 dage fra arkiv-kolonnerne
/// (`tasks.listByStatus`). Listen viser dem stadig.
#[test]
fn gamle_afsluttede_skjules_paa_tavlen() {
    let lanes = logic::fixed_lanes(|s| format!("{s:?}"));
    let done = lanes.iter().position(|l| l.is_archive).unwrap();
    let mk = |id: &str, days_ago: Option<u64>| {
        let mut t = task(id, TaskStatus::Done, None);
        t.completed = days_ago.map(|d| today() - chrono::Days::new(d));
        t
    };
    let tasks = vec![mk("ny", Some(13)), mk("graense", Some(14)), mk("gammel", Some(30)), mk("uden_dato", None)];
    let f = logic::Filters::default();
    let cols = logic::board_columns(&tasks, &[], &[], &f, today(), &lanes);
    let ids: Vec<&str> = cols[done].iter().map(|t| t.id.as_str()).collect();
    assert!(ids.contains(&"ny") && ids.contains(&"uden_dato"), "{ids:?}");
    assert!(!ids.contains(&"gammel") && !ids.contains(&"graense"), "{ids:?}");
    assert_eq!(logic::visible(&tasks, &[], &[], &f, today()).len(), 4, "listen viser alle");
}

#[test]
fn validering_samler_alle_fejl() {
    let t = today();
    let e = validate_task(None, " ", "31.02.2026", "x", t).unwrap_err();
    assert_eq!(e.title, Some("Skriv opgavens titel"));
    assert_eq!(e.due, Some("Skriv en dato, fx 31.12.2026"));
    assert!(e.estimate.is_some());
    let ok = validate_task(Some("p1"), " Kurv ", "1.11", "3,5", t).unwrap();
    assert_eq!(ok.title, "Kurv");
    assert_eq!(ok.due, NaiveDate::from_ymd_opt(2026, 11, 1));
    assert_eq!(ok.estimate_minutes, Some(210));
    let ok = validate_task(Some("p1"), "A", "", "", t).unwrap();
    assert_eq!((ok.due, ok.estimate_minutes), (None, None));
    // Estimat over 24 timer er tilladt.
    assert_eq!(
        validate_task(Some("p"), "A", "", "80", t)
            .unwrap()
            .estimate_minutes,
        Some(4800)
    );
}

#[test]
fn alle_nye_noegler_findes_paa_alle_sprog() {
    // Hver `opx.`-nøgle i koden skal findes i alle fem filer.
    let files = [
        include_str!("../../../locales/da/opgaver_ux.json"),
        include_str!("../../../locales/en/opgaver_ux.json"),
        include_str!("../../../locales/de/opgaver_ux.json"),
        include_str!("../../../locales/sv/opgaver_ux.json"),
        include_str!("../../../locales/nb/opgaver_ux.json"),
    ];
    let keys: Vec<std::collections::BTreeSet<String>> = files
        .iter()
        .map(|f| {
            serde_json::from_str::<std::collections::BTreeMap<String, String>>(f)
                .expect("json")
                .into_keys()
                .collect()
        })
        .collect();
    for (i, k) in keys.iter().enumerate() {
        assert_eq!(k, &keys[0], "sprog {i} har andre nøgler end dansk");
    }
    let src = [
        include_str!("../opgaver.rs"),
        include_str!("board.rs"),
        include_str!("panel.rs"),
        include_str!("../kalender.rs"),
        include_str!("../kalender/legend.rs"),
    ]
    .concat();
    for k in &keys[0] {
        assert!(src.contains(&format!("\"{k}\"")), "ubrugt nøgle {k}");
    }
    // Pladsholdere er ens på alle sprog.
    for key in &keys[0] {
        let ph = |s: &str| {
            let mut v: Vec<String> = s
                .split('{')
                .skip(1)
                .filter_map(|r| r.split('}').next().map(str::to_owned))
                .collect();
            v.sort();
            v
        };
        let maps: Vec<std::collections::BTreeMap<String, String>> = files
            .iter()
            .map(|f| serde_json::from_str(f).unwrap())
            .collect();
        for m in &maps[1..] {
            assert_eq!(ph(&m[key]), ph(&maps[0][key]), "pladsholdere i {key}");
        }
    }
}

#[cfg(feature = "probe")]
mod probe {
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AppContext as _, TestAppContext};

    use super::super::OpgaverScreen;
    use super::super::logic::View;
    use crate::backend::{Backend as _, BackendError, MockBackend, TaskStatus, TimerStatus};
    use crate::screens::Screen;
    use crate::testing;
    use std::sync::Arc;

    fn screen(
        cx: &mut TestAppContext,
        app: &gpui_kit::Entity<crate::app::AppView>,
    ) -> gpui_kit::Entity<OpgaverScreen> {
        app.read_with(cx, |a, _| a.view_for(Screen::Opgaver))
            .expect("view")
            .downcast::<OpgaverScreen>()
            .expect("opgaver")
    }

    fn status_of(m: &MockBackend, id: &str) -> TaskStatus {
        m.tasks(None)
            .unwrap()
            .into_iter()
            .find(|t| t.id == id)
            .unwrap()
            .status
    }

    fn board(
        cx: &mut TestAppContext,
        h: gpui_kit::AnyWindowHandle,
        app: &gpui_kit::Entity<crate::app::AppView>,
    ) -> gpui_kit::Entity<OpgaverScreen> {
        let s = screen(cx, app);
        cx.update_window(h, |_, _, cx| {
            s.update(cx, |s, cx| s.set_view(View::Board, cx))
        })
        .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        s
    }

    #[gpui_kit::test]
    fn listen_viser_opgaver_med_ikoner_prioritet_og_frist(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let a = testing::a11y(cx, h);
        println!("PROBE opgaver {:?}", a.roles);
        assert_eq!(a.with_label, a.with_role, "alle roller har label");
        assert_eq!(a.count("Main"), 1);
        assert!(a.has_label("Opgaver, 9 i alt"));
        assert!(a.has_label_containing("7 åbne opgaver"));
        assert!(a.has_label_containing(
            "Kurv og betaling med MobilePay, Bageriet på Hjørnet · Ny webshop, I gang, Frist 29. okt., 5,67 t af 10 t, prioritet Høj"
        ));
        // Kun "Påmindelser på sms" er overskredet.
        assert_eq!(
            a.labels.iter().filter(|(_, l)| l == "Overskredet").count(),
            1
        );
        assert!(a.has_label_containing("Påmindelser på sms, Klinik Søndergade · Booking-modul, Todo, Frist 25. okt., overskredet"));
        // Statusknapperne har fire valg pr. række.
        assert!(a.has_label("Kurv og betaling med MobilePay: I gang, valgt"));
        assert!(a.has_label("Kurv og betaling med MobilePay: sæt til Backlog"));
    }

    #[gpui_kit::test]
    fn filtre_soegning_og_skjul_afsluttede(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = screen(cx, &app);

        // Statusfilter: Afsluttet.
        cx.update_window(h, |_, w, cx| w.click("opgaver-status-4", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Opgaver, 2 i alt"));
        assert!(a.has_label_containing("Ny forside til sæsonen"));
        assert!(!a.has_label_containing("Påmindelser på sms"));
        cx.update_window(h, |_, w, cx| w.click("opgaver-status-0", cx))
            .unwrap();

        // Skjul afsluttede huskes og fjerner de to færdige.
        cx.update_window(h, |_, w, cx| w.click("opgaver-skjul-afsluttede", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Opgaver, 7 i alt"));
        assert!(!a.has_label_containing("Ny forside til sæsonen"));
        cx.update_window(h, |_, w, cx| w.click("opgaver-skjul-afsluttede", cx))
            .unwrap();

        // Søgning på beskrivelse.
        cx.update_window(h, |_, w, cx| {
            w.click("opgaver-soeg", cx);
            w.input("mobilepay", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Opgaver, 1 i alt"));
        assert!(a.has_label_containing("Kurv og betaling med MobilePay"));
        // Ryd filtre.
        cx.update_window(h, |_, w, cx| w.click("opgaver-ryd", cx))
            .unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Opgaver, 9 i alt"));

        // Forfalder snart: overskredet og inden for en uge (ikke færdige).
        cx.update_window(h, |_, w, cx| w.click("opgaver-snart", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Opgaver, 3 i alt"));
        assert!(a.has_label_containing("Påmindelser på sms"));
        assert!(a.has_label_containing("Tilbudsformular med billedupload"));
        cx.update_window(h, |_, w, cx| w.click("opgaver-snart", cx))
            .unwrap();

        // Kunde- og projektfilter.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_customer_filter("kunde_bageriet", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Opgaver, 2 i alt"));
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_project_filter("proj_bageri_drift", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label_containing("Ingen opgaver matcher filtrene"));
        // Skifter kunden, nulstilles projektet, som ikke hører til den nye kunde.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_customer_filter("kunde_klinik", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Opgaver, 2 i alt"));
        assert!(a.has_label_containing("Påmindelser på sms"));
    }

    #[gpui_kit::test]
    fn gruppering_efter_kunde(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        cx.update_window(h, |_, w, cx| w.click("opgaver-gruppering-1", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Bageriet på Hjørnet, 2 opgaver"));
        assert!(a.has_label_containing("Klinik Søndergade, 2 opgaver"));
        assert!(a.has_label("Bageriet på Hjørnet"));
        assert_eq!(a.with_label, a.with_role);
    }

    #[gpui_kit::test]
    fn skift_status_og_start_timer(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = screen(cx, &app);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_customer_filter("kunde_bageriet", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(status_of(&mock, "opg_2"), TaskStatus::Todo);
        // Todo -> I gang (ikon nr. 3).
        cx.update_window(h, |_, w, cx| w.click("opgave-opg_2-status-2", cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(status_of(&mock, "opg_2"), TaskStatus::InProgress);
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Produktbilleder i høj opløsning er sat til I gang"));
        assert!(a.has_label("Produktbilleder i høj opløsning: I gang, valgt"));

        // Start timer: først fint, så konflikt.
        cx.update_window(h, |_, w, cx| w.click("opgave-opg_2-timer", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Timeren kører på Produktbilleder i høj opløsning"));
        assert_eq!(a.count("Alert"), 0);
        let t = mock.timer().unwrap();
        assert_eq!(t.status, TimerStatus::Running);
        assert_eq!(t.task_id.as_deref(), Some("opg_2"));
        assert_eq!(t.project_id.as_deref(), Some("proj_webshop"));
        assert_eq!(t.customer_id.as_deref(), Some("kunde_bageriet"));
        cx.update_window(h, |_, w, cx| w.click("opgave-opg_1-timer", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("timeren kører allerede"));
        assert_eq!(a.count("Alert"), 1);
        assert_eq!(mock.timer().unwrap().task_id.as_deref(), Some("opg_2"));
    }

    #[gpui_kit::test]
    fn board_har_fire_kolonner_med_kort_og_valget_huskes_i_skaermen(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let _s = board(cx, h, &app);
        let a = testing::a11y(cx, h);
        println!("PROBE board {:?}", a.roles);
        assert_eq!(a.with_label, a.with_role, "alle roller har label");
        assert!(a.has_label("Backlog, 2 opgaver"));
        assert!(a.has_label("Todo, 3 opgaver"));
        assert!(a.has_label("I gang, 2 opgaver"));
        assert!(a.has_label("Afsluttet, 2 opgaver"));
        // Kortet har titel, sted, status, prioritet, frist og tid.
        assert!(a.has_label_containing(
            "Kurv og betaling med MobilePay, Bageriet på Hjørnet · Ny webshop, I gang, prioritet Høj, Frist 29. okt., 5,7t af 10t"
        ));
        assert!(a.has_label_containing("Påmindelser på sms, Klinik Søndergade · Booking-modul, Todo, prioritet Urgent, Frist 25. okt., overskredet, 45m af 4t"));
        // Hver kolonne har en tilføj-knap.
        assert!(a.has_label("Tilføj opgave i Backlog"));
        // Listens kontroller er skjult i board.
        assert!(!a.has_label("Gruppér listen efter"));
    }

    #[gpui_kit::test]
    fn flyt_kort_med_tastatur_og_drop(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = board(cx, h, &app);
        // Vælg kortet (åbner panelet) og flyt med ] og [.
        cx.update_window(h, |_, w, cx| w.click("kort-opg_2", cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(status_of(&mock, "opg_2"), TaskStatus::Todo);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.focus.focus(w, cx));
            w.press("]", cx)
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(status_of(&mock, "opg_2"), TaskStatus::InProgress);
        cx.update_window(h, |_, w, cx| w.press("[", cx)).unwrap();
        cx.update_window(h, |_, w, cx| w.press("[", cx)).unwrap();
        cx.run_until_parked();
        assert_eq!(status_of(&mock, "opg_2"), TaskStatus::Backlog);
        // Ved kanten sker der ingenting.
        cx.update_window(h, |_, w, cx| w.press("[", cx)).unwrap();
        cx.run_until_parked();
        assert_eq!(status_of(&mock, "opg_2"), TaskStatus::Backlog);
        // Drop-handlingen er samme vej som statusknapperne: sæt status.
        cx.update_window(h, |_, _, cx| {
            s.update(cx, |s, cx| s.set_status("opg_2", TaskStatus::Done, cx))
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(status_of(&mock, "opg_2"), TaskStatus::Done);
        assert!(testing::a11y(cx, h).has_label("Afsluttet, 3 opgaver"));
    }

    #[gpui_kit::test]
    fn en_hentning_midt_i_et_skift_ruller_ikke_kortet_tilbage(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = board(cx, h, &app);
        // Skift status og start straks en hentning, før skiftet er skrevet.
        cx.update_window(h, |_, _, cx| {
            s.update(cx, |s, cx| {
                s.set_status("opg_2", TaskStatus::Done, cx);
                s.reload(cx);
                s.reload(cx);
            })
        })
        .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        assert_eq!(status_of(&mock, "opg_2"), TaskStatus::Done);
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Afsluttet, 3 opgaver"), "{:?}", a.labels);
        assert!(a.has_label("Todo, 2 opgaver"));
        // Intet ligger og venter på bekræftelse bagefter.
        assert!(cx.update(|cx| s.read(cx).pending.is_empty()));
    }

    #[gpui_kit::test]
    fn prioritet_kan_kun_vaelges_bort_paa_opgaver_uden(cx: &mut TestAppContext) {
        // Web kan ikke fjerne en prioritet, så "Ingen" findes kun for nye
        // opgaver og opgaver uden prioritet.
        assert_eq!(super::super::form_priority_choices(true).len(), 5);
        assert_eq!(super::super::form_priority_choices(false).len(), 4);
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = screen(cx, &app);
        let selected = |cx: &mut TestAppContext, edit: Option<&'static str>| {
            cx.update_window(h, |_, w, cx| {
                s.update(cx, |s, cx| {
                    s.open_form(edit, w, cx);
                    let f = s.form.as_ref().unwrap();
                    f.priority.read(cx).selected_value().map(|v| v.to_string())
                })
            })
            .unwrap()
        };
        assert_eq!(selected(cx, None).as_deref(), Some(""));
        assert_eq!(selected(cx, Some("opg_1")).as_deref(), Some("high"));
    }

    #[gpui_kit::test]
    fn panelet_viser_detaljer_og_tidsposter(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let _s = board(cx, h, &app);
        cx.update_window(h, |_, w, cx| w.click("kort-opg_1", cx))
            .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        let a = testing::a11y(cx, h);
        println!("PROBE panel {:?}", a.labels);
        assert_eq!(a.with_label, a.with_role);
        assert!(a.has_label("Detaljer for Kurv og betaling med MobilePay"));
        assert!(a.has_label("Beskrivelse"));
        assert!(a.has_label("Kunde / projekt"));
        assert!(a.has_label("Kurv og betaling med MobilePay: I gang, valgt"));
        assert!(a.has_label("Prioritet Høj, valgt"));
        assert!(a.has_label("Tidsposter"));
        // Posterne på opgaven er hentet (demodata: poster på Ny webshop).
        assert!(a.has_label_containing("Produktsider og kurv"), "{:?}", a.labels);
        assert!(!a.has_label("Henter tidsposter"));
        // Prioriteten kan ændres fra panelet.
        cx.update_window(h, |_, w, cx| w.click("panel-prioritet-3", cx))
            .unwrap();
        cx.run_until_parked();
        let t = mock
            .tasks(None)
            .unwrap()
            .into_iter()
            .find(|t| t.id == "opg_1")
            .unwrap();
        assert_eq!(t.priority, Some(crate::backend::TaskPriority::Urgent));
        // Esc lukker panelet.
        cx.update_window(h, |_, w, cx| w.press("escape", cx))
            .unwrap();
        cx.run_until_parked();
        assert!(!testing::a11y(cx, h).has_label("Luk detaljer"));
    }

    #[gpui_kit::test]
    fn hurtig_oprettelse_i_en_kolonne(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let _s = board(cx, h, &app);
        cx.update_window(h, |_, w, cx| w.click("kolonne-0-tilfoej", cx))
            .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Ny opgave i Backlog"));
        // Uden titel: fejl, ingen oprettelse.
        let before = mock.tasks(None).unwrap().len();
        cx.update_window(h, |_, w, cx| w.click("opgaver-inline-gem", cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(mock.tasks(None).unwrap().len(), before);
        assert!(testing::a11y(cx, h).has_label("Skriv opgavens titel"));
        // Med titel: oprettes i Backlog.
        cx.update_window(h, |_, w, cx| {
            w.click("opgaver-inline-titel", cx);
            w.input("Hurtig ide", cx);
            w.press("enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let t = mock
            .tasks(None)
            .unwrap()
            .into_iter()
            .find(|t| t.title == "Hurtig ide")
            .expect("oprettet");
        assert_eq!(t.status, TaskStatus::Backlog);
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Hurtig ide er oprettet"));
        assert!(a.has_label("Backlog, 3 opgaver"));
        assert!(!a.has_label("Ny opgave i Backlog"), "feltet lukker");
    }

    #[gpui_kit::test]
    fn ny_opgave_med_validering(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        cx.update_window(h, |_, w, cx| w.click("opgave-ny", cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 1);
        cx.update_window(h, |_, w, cx| {
            w.click("opgave-frist", cx);
            w.input("lørdag", cx);
            w.click("opgave-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 1);
        assert!(a.has_label("Skriv opgavens titel"));
        assert!(a.has_label("Skriv en dato, fx 31.12.2026"));

        let s = screen(cx, &app);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let f = s.form.as_ref().expect("form");
                crate::ui::forms::select_value(&f.project, "proj_booking", w, cx);
                crate::ui::forms::select_value(&f.priority, "high", w, cx);
                crate::ui::forms::select_value(&f.status, "backlog", w, cx);
            });
            w.click("opgave-titel", cx);
            w.input("Betaling med kort", cx);
            w.click("opgave-beskrivelse", cx);
            w.input("Kort og Apple Pay", cx);
            w.click("opgave-frist", cx);
            w.press("cmd-a", cx);
            w.input("1.11.2026", cx);
            w.click("opgave-estimat", cx);
            w.input("3", cx);
            w.click("opgave-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 0, "formularen lukker");
        assert!(a.has_label("Betaling med kort er oprettet"));
        let t = mock
            .tasks(Some("proj_booking"))
            .unwrap()
            .into_iter()
            .find(|t| t.title == "Betaling med kort")
            .expect("gemt");
        assert_eq!(t.due, chrono::NaiveDate::from_ymd_opt(2026, 11, 1));
        assert_eq!(t.estimate_minutes, Some(180));
        assert_eq!(t.status, TaskStatus::Backlog);
        assert_eq!(t.priority, Some(crate::backend::TaskPriority::High));
        assert_eq!(t.description.as_deref(), Some("Kort og Apple Pay"));
        // Esc lukker en åben formular.
        cx.update_window(h, |_, w, cx| w.click("opgave-ny", cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 1);
        cx.update_window(h, |_, w, cx| w.press("escape", cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 0);
    }

    #[gpui_kit::test]
    fn ret_opgave_udfylder_og_gemmer(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        cx.update_window(h, |_, w, cx| w.click("opgave-opg_1-ret", cx))
            .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 1);
        assert!(a.has_label("Ret opgave"));
        let s = screen(cx, &app);
        let today = mock.today();
        let (title, due, estimate, desc) = cx.update(|cx| {
            let f = s.read(cx).form.as_ref().expect("form");
            (
                crate::ui::forms::value(&f.title, cx),
                crate::ui::forms::value(&f.due, cx),
                crate::ui::forms::value(&f.estimate, cx),
                crate::ui::forms::value(&f.description, cx),
            )
        });
        assert_eq!(title, "Kurv og betaling med MobilePay");
        assert_eq!(
            due,
            (today + chrono::Days::new(3))
                .format("%d.%m.%Y")
                .to_string()
        );
        assert_eq!(estimate, "10");
        assert!(desc.starts_with("Kurven skal gemmes"));

        // Ny titel, fristen fjernes, og opgaven flyttes til et andet projekt.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let f = s.form.as_ref().expect("form");
                crate::ui::forms::select_value(&f.project, "proj_booking", w, cx);
            });
            w.click("opgave-titel", cx);
            w.press("cmd-a", cx);
            w.input("Betaling med MobilePay", cx);
            w.click("opgave-frist", cx);
            w.press("cmd-a", cx);
            w.press("backspace", cx);
            w.click("opgave-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 0, "formularen lukker");
        assert!(a.has_label("Betaling med MobilePay er gemt"));
        let t = mock
            .tasks(None)
            .unwrap()
            .into_iter()
            .find(|t| t.id == "opg_1")
            .expect("opgaven");
        assert_eq!(
            (
                t.title.as_str(),
                t.project_id.as_str(),
                t.due,
                t.estimate_minutes,
                t.logged_minutes,
                t.status,
                t.priority
            ),
            (
                "Betaling med MobilePay",
                "proj_booking",
                None,
                Some(600),
                340,
                TaskStatus::InProgress,
                Some(crate::backend::TaskPriority::High)
            )
        );
    }

    #[gpui_kit::test]
    fn tom_og_fejl(cx: &mut TestAppContext) {
        let empty = Arc::new(MockBackend::empty(testing::today()));
        let (h, app) = testing::open_app(cx, empty);
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Ingen opgaver endnu"));
        assert_eq!(a.with_label, a.with_role);
        // Samme tomme tilstand på boardet.
        let _s = board(cx, h, &app);
        assert!(testing::a11y(cx, h).has_label_containing("Ingen opgaver endnu"));

        let broken = testing::mock();
        broken.set_failure(Some(BackendError::Offline));
        let (h, app) = testing::open_app(cx, broken);
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Fejl: Du er offline"));
        assert!(a.has_label("Prøv igen"));
    }

    fn task_of(m: &MockBackend, id: &str) -> crate::backend::Task {
        m.tasks(None)
            .unwrap()
            .into_iter()
            .find(|t| t.id == id)
            .unwrap()
    }

    #[gpui_kit::test]
    fn egne_kolonner_fra_web_med_kunde_paa_kortet(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_custom_lanes();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let _s = board(cx, h, &app);
        let a = testing::a11y(cx, h);
        assert_eq!(a.with_label, a.with_role, "alle roller har label");
        // Kolonnerne er webs, i webs rækkefølge.
        for (ix, label) in [
            "Idéer, 3 opgaver",
            "Todo, 4 opgaver",
            "I gang, 1 opgave",
            "Venter på kunde, 1 opgave",
            "Afsluttet, 2 opgaver",
            "Annulleret, 0 opgaver",
        ]
        .into_iter()
        .enumerate()
        {
            assert!(a.has_label(label), "kolonne {ix}: {label} i {:?}", a.labels);
        }
        // Login med MitID står i sin egen kolonne (statusId), ikke i "I gang".
        assert!(a.has_label_containing("Login med MitID Erhverv, Advokatfirmaet"));
        assert!(a.has_label_containing("Venter på kunde, prioritet Høj"));
        // Kunde uden projekt: kunden står på kortet. Uden begge: ingen linje.
        assert!(a.has_label_containing("Visitkort til nye ansatte, Klinik Søndergade, Todo"));
        assert!(a.has_label_containing("Opdatér egne priser, Idéer, 0m"));
    }

    #[gpui_kit::test]
    fn flyt_til_egen_kolonne_med_drop_tastatur_og_panel(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_custom_lanes();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = board(cx, h, &app);
        // Drop i "Venter på kunde" (kolonne 3): tasks.move med kolonnens id.
        cx.update_window(h, |_, _, cx| s.update(cx, |s, cx| s.move_to_lane("opg_2", 3, cx)))
            .unwrap();
        cx.run_until_parked();
        let t = task_of(&mock, "opg_2");
        assert_eq!((t.status, t.status_id.as_deref()), (TaskStatus::InProgress, Some("kol_venter")));
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Produktbilleder i høj opløsning er sat til Venter på kunde"));
        assert!(a.has_label("Venter på kunde, 2 opgaver"));
        // ] og [ går en kolonne ad gangen, også gennem de egne.
        cx.update_window(h, |_, w, cx| w.click("kort-opg_2", cx)).unwrap();
        cx.run_until_parked();
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.focus.focus(w, cx));
            w.press("]", cx)
        })
        .unwrap();
        cx.run_until_parked();
        let t = task_of(&mock, "opg_2");
        assert_eq!((t.status, t.status_id.as_deref()), (TaskStatus::Done, Some("kol_afsluttet")));
        cx.update_window(h, |_, w, cx| w.press("]", cx)).unwrap();
        cx.run_until_parked();
        assert_eq!(task_of(&mock, "opg_2").status_id.as_deref(), Some("kol_annulleret"));
        // Ved kanten sker der ingenting.
        cx.update_window(h, |_, w, cx| w.press("]", cx)).unwrap();
        cx.run_until_parked();
        assert_eq!(task_of(&mock, "opg_2").status_id.as_deref(), Some("kol_annulleret"));
        // Panelets status-række viser de egne kolonner og flytter.
        testing::render(cx, h);
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Produktbilleder i høj opløsning: Annulleret, valgt"));
        assert!(a.has_label("Produktbilleder i høj opløsning: sæt til Idéer"));
        cx.update_window(h, |_, w, cx| w.click("panel-status-0", cx)).unwrap();
        cx.run_until_parked();
        let t = task_of(&mock, "opg_2");
        // Fra annulleret (done) til en "ikke startet"-kolonne: todo.
        assert_eq!((t.status, t.status_id.as_deref()), (TaskStatus::Todo, Some("kol_ideer")));
        assert!(cx.update(|cx| s.read(cx).pending.is_empty()));
    }

    #[gpui_kit::test]
    fn hurtig_oprettelse_i_egen_kolonne(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_custom_lanes();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = board(cx, h, &app);
        // Kolonne 4 af 6 ligger uden for testvinduet: samme vej som "+".
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.open_inline(TaskStatus::InProgress, Some(3), w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        assert!(testing::a11y(cx, h).has_label("Ny opgave i Venter på kunde"));
        cx.update_window(h, |_, w, cx| {
            w.click("opgaver-inline-titel", cx);
            w.input("Afventer logo", cx);
            w.press("enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let t = mock
            .tasks(None)
            .unwrap()
            .into_iter()
            .find(|t| t.title == "Afventer logo")
            .expect("oprettet");
        assert_eq!((t.status, t.status_id.as_deref()), (TaskStatus::InProgress, Some("kol_venter")));
    }

    #[gpui_kit::test]
    fn registrer_tid_paa_opgave_i_panelet(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_custom_lanes();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = board(cx, h, &app);
        cx.update_window(h, |_, w, cx| w.click("kort-opg_10", cx)).unwrap();
        cx.run_until_parked();
        cx.update_window(h, |_, w, cx| w.click("opgave-panel-tid", cx)).unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Registrér tid på opgaven"));
        cx.update_window(h, |_, w, cx| {
            w.click("opgave-tid-timer", cx);
            w.input("1,5", cx);
            w.click("opgave-tid-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        assert!(cx.update(|cx| s.read(cx).log.is_none()), "formularen lukker");
        let task = task_of(&mock, "opg_10");
        assert!(testing::a11y(cx, h).has_label_containing(&format!("er registreret på {}", task.title)));
        let today = mock.today();
        let e = mock
            .entries(crate::backend::DateRange::day(today))
            .unwrap()
            .into_iter()
            .find(|e| e.task_id.as_deref() == Some("opg_10"))
            .expect("posten er gemt på opgaven");
        assert_eq!((e.minutes, e.description.as_str()), (90, task.title.as_str()));
        assert_eq!(e.customer_id, "kunde_klinik", "opgavens kunde uden projekt");
        assert_eq!(e.project_id, None);
    }

    #[gpui_kit::test]
    fn ret_titel_kunde_frist_og_beskrivelse_i_panelet(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_custom_lanes();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = board(cx, h, &app);
        cx.update_window(h, |_, w, cx| w.click("kort-opg_10", cx)).unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Titel"));
        assert!(a.has_label("Kunde / projekt"));
        assert!(!a.has_label("Gem ændringer"), "intet ændret endnu");
        // Felterne viser opgaven: kunde uden projekt.
        let place = cx.update(|cx| {
            let e = s.read(cx).edit.as_ref().expect("felter");
            e.place.read(cx).selected_value().map(|v| v.to_string())
        });
        assert_eq!(place.as_deref(), Some("c:kunde_klinik"));
        // Skriv i titlen: genvejene (n, [, ]) må ikke reagere imens.
        cx.update_window(h, |_, w, cx| {
            w.click("panel-titel", cx);
            w.press("n", cx);
            w.press("]", cx);
        })
        .unwrap();
        cx.run_until_parked();
        assert!(cx.update(|cx| s.read(cx).form.is_none()), "n åbner ikke formularen");
        assert_eq!(task_of(&mock, "opg_10").status_id.as_deref(), Some("kol_todo"));
        testing::render(cx, h);
        assert!(testing::a11y(cx, h).has_label("Gem ændringer"));
        // Titel, projekt, frist og beskrivelse; Enter i fristen gemmer alt.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let e = s.edit.as_ref().expect("felter");
                e.title.update(cx, |i, cx| i.set_value("Visitkort til nye ansatte [n]", w, cx));
                e.description.update(cx, |i, cx| {
                    i.set_value("Tre nye navne. Bestilt hos trykkeriet.", w, cx)
                });
                e.due.update(cx, |i, cx| i.set_value("20.11.2026", w, cx));
                crate::ui::forms::select_value(&e.place, "p:proj_booking", w, cx);
            });
            w.click("panel-frist", cx);
            w.press("enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let t = task_of(&mock, "opg_10");
        assert_eq!(t.title, "Visitkort til nye ansatte [n]");
        assert_eq!(t.project_id, "proj_booking");
        assert_eq!(t.customer_id.as_deref(), Some("kunde_klinik"), "kunden følger projektet");
        assert_eq!(t.due, chrono::NaiveDate::from_ymd_opt(2026, 11, 20));
        assert_eq!(
            t.description.as_deref(),
            Some("Tre nye navne. Bestilt hos trykkeriet.")
        );
        // Estimat, status og kolonne er uændrede.
        assert_eq!((t.estimate_minutes, t.status), (Some(120), TaskStatus::Todo));
        testing::render(cx, h);
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Visitkort til nye ansatte [n] er gemt"));
        assert!(!a.has_label("Gem ændringer"));
        assert!(a.has_label_containing("Visitkort til nye ansatte [n], Klinik Søndergade · Booking-modul"));

        // Tom titel og ugyldig frist: fejl, intet gemmes. Fortryd nulstiller.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let e = s.edit.as_ref().expect("felter");
                e.due.update(cx, |i, cx| i.set_value("32.13", w, cx));
            });
            w.click("panel-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Skriv en dato, fx 31.12.2026"));
        assert_eq!(task_of(&mock, "opg_10").due, chrono::NaiveDate::from_ymd_opt(2026, 11, 20));
        cx.update_window(h, |_, w, cx| w.click("panel-fortryd", cx)).unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        let due = cx.update(|cx| crate::ui::forms::value(&s.read(cx).edit.as_ref().unwrap().due, cx));
        assert_eq!(due, "20.11.2026");

        // Fjern kunden helt: kortet mister stedlinjen.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let e = s.edit.as_ref().expect("felter");
                crate::ui::forms::select_value(&e.place, "", w, cx);
                s.save_edit(cx);
            })
        })
        .unwrap();
        cx.run_until_parked();
        let t = task_of(&mock, "opg_10");
        assert_eq!((t.project_id.as_str(), t.customer_id.as_deref()), ("", None));
        testing::render(cx, h);
        assert!(testing::a11y(cx, h).has_label_containing("Visitkort til nye ansatte [n], Todo"));
    }

    #[gpui_kit::test]
    fn et_sent_gemmesvar_rydder_ikke_en_anden_opgaves_felter(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.demo_custom_lanes();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Opgaver);
        let s = board(cx, h, &app);
        cx.update_window(h, |_, w, cx| w.click("kort-opg_10", cx)).unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        let title = |cx: &mut TestAppContext| {
            cx.update(|cx| crate::ui::forms::value(&s.read(cx).edit.as_ref().unwrap().title, cx))
        };
        // Gem A, vælg B og skriv i B, før A's svar er kommet.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let e = s.edit.as_ref().expect("felter");
                e.title.update(cx, |i, cx| i.set_value("A rettet", w, cx));
                s.save_edit(cx);
                s.select("opg_11", cx);
            })
        })
        .unwrap();
        testing::render(cx, h);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let e = s.edit.as_ref().expect("felter");
                assert_eq!(e.task_id, "opg_11");
                e.title.update(cx, |i, cx| i.set_value("B ugemt", w, cx));
            })
        })
        .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        assert_eq!(task_of(&mock, "opg_10").title, "A rettet");
        assert_eq!(title(cx), "B ugemt", "B's tekst bliver stående");

        // Skrevet videre i samme opgave, mens den gemmes: teksten bliver.
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let e = s.edit.as_ref().expect("felter");
                e.title.update(cx, |i, cx| i.set_value("B gemt", w, cx));
                s.save_edit(cx);
                let e = s.edit.as_ref().expect("felter");
                e.title.update(cx, |i, cx| i.set_value("B gemt og mere", w, cx));
            })
        })
        .unwrap();
        cx.run_until_parked();
        testing::render(cx, h);
        assert_eq!(task_of(&mock, "opg_11").title, "B gemt");
        assert_eq!(title(cx), "B gemt og mere");
        assert!(cx.update(|cx| !s.read(cx).edit.as_ref().unwrap().busy));
    }
}
