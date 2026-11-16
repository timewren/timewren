//! Headless probe-test af hele appen (feature `probe`):
//! `cargo test --features probe -- --nocapture`
//!
//! Tæller roller pr. skærm, så en skærm uden a11y fanges.

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AppContext as _, TestAppContext};

use crate::app::sek;
use crate::backend::{Backend as _, TimerStatus, TimerTarget};
use crate::screens::Screen;
use crate::testing;

#[gpui_kit::test]
fn alle_skaerme_har_navigation_og_roller(cx: &mut TestAppContext) {
    let (handle, app) = testing::open_app(cx, testing::mock());
    for screen in Screen::ALL {
        testing::navigate(cx, handle, &app, screen);
        let a = testing::a11y(cx, handle);
        println!(
            "PROBE {:<14} total={} roller={} labels={} {:?}",
            screen.key(),
            a.total,
            a.with_role,
            a.with_label,
            a.roles
        );
        assert_eq!(
            a.count("Tab"),
            10,
            "{}: navigationen har ti faner",
            screen.key()
        );
        assert_eq!(a.count("Main"), 1, "{}: én Main pr. skærm", screen.key());
        assert!(
            a.has_label(screen.title()),
            "{}: skærmens titel kan læses",
            screen.key()
        );
        assert_eq!(
            a.with_label,
            a.with_role,
            "{}: alle elementer med rolle har en label",
            screen.key()
        );
    }
}

#[gpui_kit::test]
fn genveje_skifter_skaerm(cx: &mut TestAppContext) {
    let (handle, app) = testing::open_app(cx, testing::mock());
    for (key, screen) in [
        (sek!("3"), Screen::Aktivitet),
        (sek!("4"), Screen::Kunder),
        (sek!("8"), Screen::Fakturaer),
        (sek!("9"), Screen::Rapporter),
        (sek!(","), Screen::Indstillinger),
        (sek!("1"), Screen::Hjem),
    ] {
        cx.update_window(handle, |_, window, cx| window.press(key, cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(app.read_with(cx, |a, _| a.screen), screen, "{key}");
    }
}

#[gpui_kit::test]
fn klik_i_navigationen(cx: &mut TestAppContext) {
    let (handle, app) = testing::open_app(cx, testing::mock());
    cx.update_window(handle, |_, window, cx| window.click("nav-klippekort", cx))
        .unwrap();
    cx.run_until_parked();
    assert_eq!(app.read_with(cx, |a, _| a.screen), Screen::Klippekort);
}

fn step(
    cx: &mut TestAppContext,
    handle: gpui_kit::AnyWindowHandle,
    f: impl FnOnce(&mut gpui_kit::Window, &mut gpui_kit::App),
) {
    cx.update_window(handle, |_, w, cx| f(w, cx)).unwrap();
    cx.run_until_parked();
    testing::render(cx, handle);
    cx.run_until_parked();
}

#[gpui_kit::test]
fn palet_navigerer(cx: &mut TestAppContext) {
    let (handle, app) = testing::open_app(cx, testing::mock());
    step(cx, handle, |w, cx| w.press(sek!("k"), cx));
    assert!(app.read_with(cx, |a, _| a.palette_open));
    assert!(
        testing::a11y(cx, handle).has_label("Kommandopalet"),
        "paletten er en navngivet dialog"
    );
    step(cx, handle, |w, cx| w.input("fakt", cx));
    step(cx, handle, |w, cx| w.press("enter", cx));
    assert!(!app.read_with(cx, |a, _| a.palette_open));
    assert_eq!(app.read_with(cx, |a, _| a.screen), Screen::Fakturaer);
}

#[gpui_kit::test]
fn palet_starter_timer_paa_kunde(cx: &mut TestAppContext) {
    let m = testing::mock();
    let (handle, _) = testing::open_app(cx, m.clone());
    step(cx, handle, |w, cx| w.press(sek!("k"), cx));
    step(cx, handle, |w, cx| w.input("start bageri webshop", cx));
    step(cx, handle, |w, cx| w.press("enter", cx));
    let t = m.timer().unwrap();
    assert_eq!(t.status, TimerStatus::Running);
    assert_eq!(t.project_id.as_deref(), Some("proj_webshop"));
}

#[gpui_kit::test]
fn palet_kasser_kraever_bekraeftelse(cx: &mut TestAppContext) {
    let m = testing::mock();
    m.demo_timer(
        TimerTarget {
            customer_id: Some("kunde_cafe".into()),
            ..Default::default()
        },
        600,
    );
    let (handle, app) = testing::open_app(cx, m.clone());
    testing::navigate(cx, handle, &app, Screen::Kunder);
    step(cx, handle, |w, cx| w.press(sek!("k"), cx));
    step(cx, handle, |w, cx| w.input("kassér", cx));
    step(cx, handle, |w, cx| w.press("enter", cx));
    assert_eq!(app.read_with(cx, |a, _| a.screen), Screen::Hjem);
    assert_eq!(
        m.timer().unwrap().status,
        TimerStatus::Running,
        "kun bekræftelsen vises"
    );
    assert!(testing::a11y(cx, handle).has_label("Kassér 0:10? Tiden gemmes ikke."));
}

#[gpui_kit::test]
fn palet_kasser_uden_timer_goer_intet(cx: &mut TestAppContext) {
    let (handle, app) = testing::open_app(cx, testing::mock());
    step(cx, handle, |w, cx| w.press(sek!("k"), cx));
    step(cx, handle, |w, cx| w.input("kassér", cx));
    step(cx, handle, |w, cx| w.press("enter", cx));
    let hjem = app
        .read_with(cx, |a, _| a.view_for(Screen::Hjem))
        .unwrap()
        .downcast::<crate::screens::hjem::HjemScreen>()
        .ok()
        .unwrap();
    assert!(
        !hjem.read_with(cx, |h, _| h.confirm_discard),
        "ingen bekræftelse, der kan dukke op senere"
    );
}

#[gpui_kit::test]
fn genvej_starter_og_pauser_timer(cx: &mut TestAppContext) {
    let m = testing::mock();
    let (handle, _) = testing::open_app(cx, m.clone());
    step(cx, handle, |w, cx| w.press(sek!("shift-t"), cx));
    assert_eq!(m.timer().unwrap().status, TimerStatus::Running);
    step(cx, handle, |w, cx| w.press(sek!("shift-t"), cx));
    assert_eq!(m.timer().unwrap().status, TimerStatus::Paused);
}

#[gpui_kit::test]
fn fejl_fra_tray_vises_som_besked(cx: &mut TestAppContext) {
    let m = testing::mock();
    let (handle, app) = testing::open_app(cx, m.clone());
    // Stop uden kørende timer fejler i datalaget, ligesom et klik i trayen ville.
    let ctx = app.read_with(cx, |a, _| a.ctx.clone());
    cx.update(|cx| crate::timer::stop(&ctx, cx));
    cx.run_until_parked();
    let a = testing::a11y(cx, handle);
    assert!(
        a.has_label("Ændret et andet sted: timeren kører ikke"),
        "{:?}",
        a.labels
            .iter()
            .filter(|l| l.0 == "Alert")
            .collect::<Vec<_>>()
    );
    step(cx, handle, |w, cx| w.click("besked-luk", cx));
    assert!(!testing::a11y(cx, handle).has_label_containing("Ændret et andet sted"));
}
