//! Probe-test af sidemenuen (UX-runden 0.2.28): genvej, knap, tastatur og a11y
//! i både fuld og smal tilstand.

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AppContext as _, TestAppContext, px};

use crate::app::sek;
use crate::screens::Screen;
use crate::testing;

fn collapsed(
    cx: &mut TestAppContext,
    handle: gpui_kit::AnyWindowHandle,
    app: &gpui_kit::Entity<crate::app::AppView>,
) -> bool {
    let width = cx
        .update_window(handle, |_, window, _| window.viewport_size().width / px(1.))
        .unwrap();
    app.read_with(cx, |a, _| a.nav.collapsed(width))
}

#[gpui_kit::test]
fn menuen_kan_minimeres_med_genvej_og_knap(cx: &mut TestAppContext) {
    let (handle, app) = testing::open_app(cx, testing::mock());
    let start = collapsed(cx, handle, &app);

    // ⌘\ / Ctrl+\ skifter.
    cx.update_window(handle, |_, window, cx| window.press(sek!("\\"), cx))
        .unwrap();
    cx.run_until_parked();
    assert_ne!(
        collapsed(cx, handle, &app),
        start,
        "genvejen skifter menuen"
    );

    // I begge tilstande: ti faner med navn, og knappen kan læses.
    let a = testing::a11y(cx, handle);
    assert_eq!(a.count("Tab"), 10, "smal menu har stadig ti faner");
    for s in Screen::ALL {
        assert!(a.has_label(s.title()), "{} har navn i ikonmenuen", s.key());
    }
    assert!(a.has_label(crate::i18n::t("design.nav.toggle_label")));
    assert_eq!(a.with_label, a.with_role, "alle roller har en label");

    // Knappen skifter tilbage.
    cx.update_window(handle, |_, window, cx| window.click("nav-skift", cx))
        .unwrap();
    cx.run_until_parked();
    assert_eq!(
        collapsed(cx, handle, &app),
        start,
        "knappen skifter tilbage"
    );

    // ⌘B / Ctrl+B virker også (⌘\ er svær at nå på danske tastaturer).
    cx.update_window(handle, |_, window, cx| window.press(sek!("b"), cx))
        .unwrap();
    cx.run_until_parked();
    assert_ne!(collapsed(cx, handle, &app), start, "⌘B skifter menuen");
    cx.update_window(handle, |_, window, cx| window.press(sek!("b"), cx))
        .unwrap();
    cx.run_until_parked();

    // Klik på et ikon i den smalle menu navigerer.
    cx.update_window(handle, |_, window, cx| window.press(sek!("\\"), cx))
        .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| window.click("nav-kunder", cx))
        .unwrap();
    cx.run_until_parked();
    assert_eq!(app.read_with(cx, |a, _| a.screen), Screen::Kunder);
}

#[gpui_kit::test]
fn menuen_kan_styres_med_tastaturet(cx: &mut TestAppContext) {
    let (handle, app) = testing::open_app(cx, testing::mock());
    cx.update_window(handle, |_, window, cx| {
        let f = app.read(cx).nav_focus[0].clone();
        f.focus(window, cx);
    })
    .unwrap();
    cx.run_until_parked();
    // Pil ned to gange og Enter: Aktivitet.
    for key in ["down", "down", "enter"] {
        cx.update_window(handle, |_, window, cx| window.press(key, cx))
            .unwrap();
        cx.run_until_parked();
    }
    assert_eq!(app.read_with(cx, |a, _| a.screen), Screen::Aktivitet);
}
