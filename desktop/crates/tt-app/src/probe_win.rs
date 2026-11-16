//! Probe-tests for fundene fra testen på Windows 11 (`v1/ret-win`):
//! genveje uden fokus, stop under ét minut, vælgeren og vinduet, der skjules.

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AppContext as _, TestAppContext};

use crate::app::sek;
use crate::backend::{Backend as _, TimerStatus, TimerTarget};
use crate::screens::Screen;
use crate::testing;
use crate::testing_b::{self as tb};

fn screen_of(cx: &mut TestAppContext, p: &tb::Probe) -> Screen {
    p.app.read_with(cx, |a, _| a.screen)
}

/// Sætter en kørende timer på Café Åbrinken (kørt `secs`) og giver skærmene besked.
fn timer_running(cx: &mut TestAppContext, p: &tb::Probe, secs: i64) {
    p.mock.demo_timer(
        TimerTarget {
            customer_id: Some("kunde_cafe".into()),
            ..Default::default()
        },
        secs,
    );
    let ctx = p.app.read_with(cx, |a, _| a.ctx.clone());
    cx.update(|cx| ctx.changed(cx));
    p.settle(cx);
}

/// Fund 5: efter "Ny kunde" → Gem forsvinder det fokuserede felt, og intet
/// har fokus. Så må Ctrl/Cmd+tal stadig skifte skærm.
#[gpui_kit::test]
fn ctrl_tal_virker_efter_ny_kunde_er_gemt(cx: &mut TestAppContext) {
    let p = tb::open(cx, testing::mock(), Screen::Kunder);
    p.click(cx, "kunde-ny");
    cx.update_window(p.handle, |_, w, cx| w.input("Testkunde", cx))
        .unwrap();
    p.click(cx, "kunde-formular-gem");
    assert_eq!(p.a11y(cx).count("Dialog"), 0, "formularen er lukket");
    p.assert_label(cx, "Testkunde");
    p.press(cx, sek!("1"));
    assert_eq!(screen_of(cx, &p), Screen::Hjem, "Ctrl+1 efter gemt kunde");
}

/// Fund 5: fokus i kundelisten (søgefeltet og en række).
#[gpui_kit::test]
fn ctrl_tal_virker_fra_kundelisten(cx: &mut TestAppContext) {
    let p = tb::open(cx, testing::mock(), Screen::Kunder);
    p.click(cx, "kunder-soeg");
    cx.update_window(p.handle, |_, w, cx| w.input("Bag", cx))
        .unwrap();
    p.press(cx, sek!("1"));
    assert_eq!(screen_of(cx, &p), Screen::Hjem, "fra søgefeltet");
    testing::navigate(cx, p.handle, &p.app, Screen::Kunder);
    p.click(cx, "kunde-0");
    p.press(cx, sek!("2"));
    assert_eq!(screen_of(cx, &p), Screen::Kalender, "fra en række");
}

/// Fund 5: fokus helt væk (fx et felt, der forsvandt) på alle skærme.
#[gpui_kit::test]
fn ctrl_tal_virker_uden_fokus(cx: &mut TestAppContext) {
    let p = tb::open(cx, testing::mock(), Screen::Opgaver);
    cx.update_window(p.handle, |_, w, cx| w.blur(cx)).unwrap();
    p.settle(cx);
    p.press(cx, sek!("4"));
    assert_eq!(screen_of(cx, &p), Screen::Kunder);
    cx.update_window(p.handle, |_, w, cx| w.blur(cx)).unwrap();
    p.settle(cx);
    p.press(cx, sek!("1"));
    assert_eq!(screen_of(cx, &p), Screen::Hjem);
}

/// Fund 4: stop under ét minut gemmer intet, men siger det.
#[gpui_kit::test]
fn stop_under_et_minut_giver_besked(cx: &mut TestAppContext) {
    let m = testing::mock();
    let p = tb::open(cx, m.clone(), Screen::Hjem);
    timer_running(cx, &p, 20);
    p.click(cx, "timer-stop");
    assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
    p.assert_label(cx, "Under ét minut. Tiden er ikke gemt.");
}

/// Fund 4: også fra tray, genvej og palet (`timer::stop`).
#[gpui_kit::test]
fn stop_under_et_minut_fra_tray_giver_besked(cx: &mut TestAppContext) {
    let m = testing::mock();
    let p = tb::open(cx, m.clone(), Screen::Kunder);
    timer_running(cx, &p, 5);
    let ctx = p.app.read_with(cx, |a, _| a.ctx.clone());
    cx.update(|cx| crate::timer::stop(&ctx, cx));
    p.settle(cx);
    assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
    p.assert_label(cx, "Under ét minut. Tiden er ikke gemt.");
}

/// Et stop over ét minut gemmer posten og viser ingen besked.
#[gpui_kit::test]
fn stop_over_et_minut_giver_ingen_besked(cx: &mut TestAppContext) {
    let m = testing::mock();
    let p = tb::open(cx, m.clone(), Screen::Hjem);
    timer_running(cx, &p, 5 * 60);
    p.click(cx, "timer-stop");
    assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
    p.assert_no_label(cx, "Under ét minut");
}

fn empty_mock() -> std::sync::Arc<crate::backend::MockBackend> {
    std::sync::Arc::new(crate::backend::MockBackend::empty(testing::today()))
}

/// Fund 2: vælgeren følger samme mønster som "Ny kunde": rollen `Dialog`
/// sidder på kortet (ikke på laget over hele vinduet), labelen er den
/// synlige titel, og søgefelt og liste ligger i dialogen.
#[gpui_kit::test]
fn vaelgeren_er_en_dialog_med_titel_og_soegefelt(cx: &mut TestAppContext) {
    let p = tb::open(cx, empty_mock(), Screen::Hjem);
    p.click(cx, "timer-start");
    cx.update_window(p.handle, |_, w, _| {
        let dialog = w.find("vaelger-dialog");
        assert_eq!(dialog.role(), Some(gpui_kit::Role::Dialog));
        assert_eq!(
            dialog.label(),
            Some("Vælg kunde og projekt til timeren"),
            "labelen er den synlige titel"
        );
        let b = dialog.bounds();
        assert!(
            b.size.width < gpui_kit::px(700.) && b.origin.x > gpui_kit::px(0.),
            "rollen sidder på kortet, ikke på laget: {b:?}"
        );
        let scope = w.within("vaelger-dialog");
        for id in ["vaelger-soeg", "vaelger-liste", "vaelger-taster"] {
            assert!(scope.try_find(id).is_some(), "{id} ligger i dialogen");
        }
    })
    .unwrap();
}

/// Fund 3: ingen kunder. "Opret kunde 'X'" opretter kunden med søgeteksten,
/// og timeren starter straks på den. "Intern tid" kan vælges uden kunder.
#[gpui_kit::test]
fn opret_kunde_fra_tom_vaelger_starter_timeren(cx: &mut TestAppContext) {
    let m = empty_mock();
    let p = tb::open(cx, m.clone(), Screen::Hjem);
    p.click(cx, "timer-start");
    p.assert_label(cx, "Intern tid, uden kunde");
    p.assert_no_label(cx, "Opret kunde '");
    cx.update_window(p.handle, |_, w, cx| w.input("Bageriet", cx))
        .unwrap();
    p.settle(cx);
    p.assert_label(cx, "Opret kunde 'Bageriet'");
    p.click(cx, "vaelger-opret");
    let c = m.customers(false).unwrap();
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].name, "Bageriet");
    let t = m.timer().unwrap();
    assert_eq!(t.status, TimerStatus::Running);
    assert_eq!(t.customer_id.as_deref(), Some(c[0].id.as_str()));
    let hjem = p.screen::<crate::screens::hjem::HjemScreen>(cx, Screen::Hjem);
    assert!(hjem.read_with(cx, |h, _| h.pick_for.is_none()), "vælgeren lukker");
}

/// Fund 3: Enter i søgefeltet uden træffere opretter også kunden.
#[gpui_kit::test]
fn enter_uden_traeffere_opretter_kunden(cx: &mut TestAppContext) {
    let m = empty_mock();
    let p = tb::open(cx, m.clone(), Screen::Hjem);
    p.click(cx, "timer-start");
    cx.update_window(p.handle, |_, w, cx| w.input("Café", cx))
        .unwrap();
    p.press(cx, "enter");
    let c = m.customers(false).unwrap();
    assert_eq!(c.len(), 1);
    assert_eq!(m.timer().unwrap().customer_id.as_deref(), Some(c[0].id.as_str()));
}

/// Review: et dobbelttryk (eller en holdt Enter) på "Opret kunde", før
/// svaret er kommet, må kun oprette kunden én gang.
#[gpui_kit::test]
fn dobbelt_opret_giver_kun_en_kunde(cx: &mut TestAppContext) {
    let m = empty_mock();
    let p = tb::open(cx, m.clone(), Screen::Hjem);
    p.click(cx, "timer-start");
    cx.update_window(p.handle, |_, w, cx| w.input("Bageriet", cx))
        .unwrap();
    p.settle(cx);
    let hjem = p.screen::<crate::screens::hjem::HjemScreen>(cx, Screen::Hjem);
    let picker = hjem.read_with(cx, |h, _| h.picker.clone());
    cx.update_window(p.handle, |_, w, cx| {
        picker.update(cx, |p, cx| {
            let ix = p.selected;
            p.activate(ix, w, cx);
            p.activate(ix, w, cx);
        })
    })
    .unwrap();
    p.settle(cx);
    assert_eq!(m.customers(false).unwrap().len(), 1);
}

/// Intern tid (uden kunde) er et førsteklasses valg for timeren.
#[gpui_kit::test]
fn intern_tid_kan_vaelges_til_timeren(cx: &mut TestAppContext) {
    let m = empty_mock();
    let p = tb::open(cx, m.clone(), Screen::Hjem);
    p.click(cx, "timer-start");
    p.press(cx, "enter");
    let t = m.timer().unwrap();
    assert_eq!(t.status, TimerStatus::Running);
    assert_eq!(t.customer_id, None);
}

/// Kommandopaletten tilbyder ikke at oprette kunder.
#[gpui_kit::test]
fn paletten_tilbyder_ikke_opret(cx: &mut TestAppContext) {
    let p = tb::open(cx, testing::mock(), Screen::Hjem);
    p.press(cx, sek!("k"));
    cx.update_window(p.handle, |_, w, cx| w.input("zzzzqqq", cx))
        .unwrap();
    p.settle(cx);
    p.assert_label(cx, "Ingen træffere");
    p.assert_no_label(cx, "Opret kunde '");
}

/// Åbner appen med hovedvinduets opsætning fra `run()` (vindue::init/install).
fn open_main(cx: &mut TestAppContext) -> tb::Probe {
    cx.update(crate::vindue::init);
    let p = tb::open(cx, testing::mock(), Screen::Hjem);
    cx.update_window(p.handle, |_, w, cx| crate::vindue::install(w, cx))
        .unwrap();
    p
}

/// Fund 1: X lukker ikke appen; vinduet skjules og findes stadig, så
/// sporing, timer og tray kører videre. "Vis TimeTrack" viser det igen.
#[gpui_kit::test]
fn x_skjuler_vinduet_og_tray_viser_det_igen(cx: &mut TestAppContext) {
    let p = open_main(cx);
    let mut vcx = gpui_kit::VisualTestContext::from_window(p.handle, cx);
    assert!(!vcx.simulate_close(), "X må ikke lukke vinduet");
    p.settle(cx);
    assert!(cx.update(|cx| crate::vindue::is_hidden(cx)), "vinduet er skjult");
    assert_eq!(cx.update(|cx| cx.windows().len()), 1, "vinduet lever");
    // Timeren kan stadig styres (tray/genvej), mens vinduet er skjult.
    let ctx = p.app.read_with(cx, |a, _| a.ctx.clone());
    cx.update(|cx| crate::timer::toggle(&ctx, cx));
    p.settle(cx);
    assert_eq!(p.mock.timer().unwrap().status, TimerStatus::Running);
    // Tray: "Vis TimeTrack".
    cx.update(crate::vindue::show);
    p.settle(cx);
    assert!(!cx.update(|cx| crate::vindue::is_hidden(cx)));
    assert_eq!(screen_of(cx, &p), Screen::Hjem, "samme vindue og tilstand");
}

/// Fund 1, macOS: Cmd+W skjuler (Ctrl+W gør intet på Windows).
#[cfg(target_os = "macos")]
#[gpui_kit::test]
fn cmd_w_skjuler_vinduet(cx: &mut TestAppContext) {
    let p = open_main(cx);
    p.press(cx, "cmd-w");
    assert!(cx.update(|cx| crate::vindue::is_hidden(cx)));
    assert_eq!(cx.update(|cx| cx.windows().len()), 1);
    // Også uden fokus (fx efter et gemt felt).
    cx.update(crate::vindue::show);
    cx.update_window(p.handle, |_, w, cx| w.blur(cx)).unwrap();
    p.settle(cx);
    p.press(cx, "cmd-w");
    assert!(cx.update(|cx| crate::vindue::is_hidden(cx)));
}
