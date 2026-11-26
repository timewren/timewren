//! Probe-tests (feature `probe`) for kalenderdelen: idle-dialogens fire
//! valg, mødekortet og Indstillinger → Kalender. Klik, tastatur og
//! tilgængelighedstræet (roller og labels) mod `MockBackend`.

use std::sync::Arc;

use chrono::Local;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AppContext as _, TestAppContext};

use crate::backend::{Backend, DateRange, TimerStatus, TimerTarget};
use crate::idle::IdlePrompt;
use crate::kalenderkilder::{self, Kalender};
use crate::moedekort::MoedeKort;
use crate::screens::Screen;
use crate::testing;
use crate::testing_b::open;

fn target() -> TimerTarget {
    TimerTarget {
        customer_id: Some("kunde_bageriet".into()),
        project_id: Some("proj_webshop".into()),
        task_id: None,
        description: "Produktsider".into(),
    }
}

#[gpui_kit::test]
fn idle_dialogen_har_fire_valg_og_tildel_flytter_tiden(cx: &mut TestAppContext) {
    let mock = testing::mock();
    mock.demo_timer(target(), 3600 + 30);
    let p = open(cx, mock, Screen::Hjem);
    let hub = p.app.read_with(cx, |a, _| a.ctx.hub.clone());
    let away_since = testing::now() - chrono::Duration::minutes(25);
    let prompt = IdlePrompt {
        away_since,
        back_at: away_since + chrono::Duration::minutes(20),
        away_secs: 20 * 60,
        target: target(),
        timer_started: p.mock.timer().unwrap().started_at,
        periods: 1,
    };
    cx.update(|cx| {
        hub.update(cx, |h, cx| {
            h.idle.push(prompt);
            cx.notify();
        })
    });
    p.settle(cx);
    for label in [
        "Behold tiden",
        "Træk tiden fra, og stop timeren",
        "Træk tiden fra, og lad timeren køre videre",
        "Træk tiden fra, og registrér den på en anden kunde eller opgave",
    ] {
        p.assert_label(cx, label);
    }
    p.assert_all_labelled(cx);
    p.click(cx, "idle-tildel");
    p.assert_label(cx, "Hvem skal tiden tildeles?");
    // Den fælles mål-vælger: søg kunden, Enter vælger kunden uden projekt.
    p.assert_label(cx, "Alle kunder");
    cx.update_window(p.handle, |_, w, cx| w.input("bageriet", cx)).unwrap();
    p.settle(cx);
    p.press(cx, "enter");
    p.settle(cx);
    p.assert_no_label(cx, "Du har været væk");
    let first = "kunde_bageriet".to_string();
    let moved: Vec<_> = p
        .mock
        .entries(DateRange::day(away_since.date_naive()))
        .unwrap()
        .into_iter()
        .filter(|e| e.customer_id == first && e.minutes == 20 && e.description.is_empty())
        .collect();
    assert_eq!(moved.len(), 1, "20 min på den valgte kunde");
    assert_eq!(p.mock.timer().unwrap().status, TimerStatus::Running, "timeren kører videre");
    p.assert_label(cx, "20 min er flyttet til");
}

#[gpui_kit::test]
fn moedekortet_registrerer_og_forsvinder(cx: &mut TestAppContext) {
    kalenderkilder::install_global(Arc::new(Kalender::new(None, Box::new(|_| vec![]))));
    let k = kalenderkilder::global().unwrap();
    let mock = testing::mock();
    let p = open(cx, mock, Screen::Hjem);
    let ctx = p.app.read_with(cx, |a, _| a.ctx.clone());
    let mut m = kalenderkilder::demo_meeting();
    m.meeting.id = "probe-moede".into();
    k.put_back(m.clone());
    cx.update(|cx| MoedeKort::sync_hub(&ctx, cx));
    p.settle(cx);
    p.assert_label(cx, "Et møde er slut");
    p.assert_label(cx, "Mødet med Bageriet på Hjørnet varede 42 min. Registrér?");
    p.assert_label(cx, "Registrér mødet");
    p.assert_label(cx, "Vælg kunde og projekt til mødet");
    p.assert_label(cx, "Ignorér mødet");
    p.assert_all_labelled(cx);
    let day = m.meeting.start.with_timezone(&Local).date_naive();
    let before = p.mock.entries(DateRange::day(day)).unwrap().len();
    p.click(cx, "moede-registrer");
    p.settle(cx);
    p.assert_no_label(cx, "Et møde er slut");
    let entries = p.mock.entries(DateRange::day(day)).unwrap();
    assert_eq!(entries.len(), before + 1);
    assert!(entries.iter().any(|e| e.description == "Status på webshoppen" && e.minutes == 42));
    assert!(k.pending().iter().all(|x| x.meeting.id != "probe-moede"));

    // Ignorér
    let mut m2 = kalenderkilder::demo_meeting();
    m2.meeting.id = "probe-moede-2".into();
    k.put_back(m2);
    cx.update(|cx| MoedeKort::sync_hub(&ctx, cx));
    p.settle(cx);
    p.click(cx, "moede-ignorer");
    p.assert_no_label(cx, "Et møde er slut");
    assert!(k.pending().iter().all(|x| x.meeting.id != "probe-moede-2"));
}

#[gpui_kit::test]
fn indstillinger_kalender_viser_kilder_og_moeder(cx: &mut TestAppContext) {
    let mock = testing::mock();
    let p = open(cx, mock, Screen::Indstillinger);
    p.click(cx, "indstilling-kalender");
    p.settle(cx);
    p.assert_label(cx, "Kalender og møder");
    p.assert_label(cx, "Kalenderadresse (iCal/ICS)");
    p.assert_label(cx, "Gem kalenderadressen");
    p.assert_label(cx, "Spørg, når et møde slutter");
    p.assert_label(cx, "Mødet er slut efter");
    p.assert_all_labelled(cx);
    // Slut efter 5 min, og mødedetektionen slås fra
    p.click(cx, "kal-slut-300");
    p.settle(cx);
    assert_eq!(p.mock.settings().unwrap().calendar.meetings.end_after_secs, 300);
    p.click(cx, "kal-moeder-kontakt");
    p.settle(cx);
    assert!(!p.mock.settings().unwrap().calendar.meetings.enabled);
    p.assert_no_label(cx, "Mødet er slut efter");
}

#[gpui_kit::test]
fn aktivitet_viser_kalenderen_og_ventende_moeder(cx: &mut TestAppContext) {
    use chrono::TimeZone;
    kalenderkilder::install_global(Arc::new(Kalender::new(None, Box::new(|_| vec![]))));
    let k = kalenderkilder::global().unwrap();
    // En aftale (ikke et ventende møde): mødekort-testen deler den globale kalender.
    let start = Local
        .from_local_datetime(&testing::today().and_hms_opt(10, 0, 0).unwrap())
        .unwrap()
        .with_timezone(&chrono::Utc);
    k.set_events(
        "probe-aktivitet",
        vec![kalenderkilder::CalendarEvent {
            id: "probe-aktivitet:1".into(),
            title: "Status på webshoppen".into(),
            start,
            end: start + chrono::Duration::minutes(42),
            all_day: false,
            attendees: vec![],
            private: false,
            source: kalenderkilder::SourceKind::Ics,
        }],
    );
    let p = open(cx, testing::mock(), Screen::Aktivitet);
    p.settle(cx);
    p.assert_label(cx, "Kalender og møder");
    p.assert_label(cx, "10:00-10:42 · Status på webshoppen · uden kunde");
    k.set_events("probe-aktivitet", vec![]);
}

