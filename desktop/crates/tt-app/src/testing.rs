//! Headless test-opsætning (feature `probe`), som i spiken. Åbner hele appen
//! mod en `MockBackend` med fast dato, uden skærm.
//!
//! ```ignore
//! #[gpui_kit::test]
//! fn min_test(cx: &mut TestAppContext) {
//!     let (handle, app) = testing::open_app(cx, testing::mock());
//!     testing::navigate(cx, handle, &app, Screen::Kunder);
//!     let roles = testing::a11y(cx, handle);
//!     assert!(roles.count("Button") > 0);
//! }
//! ```
//!
//! Hændelser leveres efter effekt-cyklussen, så kald `cx.run_until_parked()`
//! mellem input og aflæsning.

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;

use crate::app::{self, AppView};
use crate::backend::MockBackend;
use crate::brand;
use crate::screens::Screen;
use crate::ur::ManualClock;

/// Den faste dato, testdata ligger omkring (en mandag).
pub fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 26).expect("dato")
}

/// Det faste tidspunkt, mockens timer går efter: kl. 12 på `today()`.
pub fn now() -> DateTime<Local> {
    Local
        .from_local_datetime(&today().and_hms_opt(12, 0, 0).expect("tidspunkt"))
        .single()
        .expect("entydigt tidspunkt")
}

/// Mock med fastfrosset ur: en timer, der har kørt 1:00:30, er stadig 1:00:30,
/// når en langsom CI-maskine kommer til at stoppe den. `MockBackend::with_today`
/// alene går efter systemuret; brug `with_clock`, hvis testen tjekker minutter.
pub fn mock() -> Arc<MockBackend> {
    let clock = ManualClock::new(now().with_timezone(&Utc));
    Arc::new(MockBackend::with_today(today()).with_clock(Arc::new(clock)))
}

/// Åbner appen i et 1200x800-vindue og venter, til første data er hentet.
pub fn open_app(
    cx: &mut TestAppContext,
    backend: Arc<MockBackend>,
) -> (AnyWindowHandle, Entity<AppView>) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        brand::register_fonts(cx);
        app::bind_keys(cx);
    });
    let (handle, view) = cx.update(|cx| {
        let bounds = Bounds {
            origin: Point::default(),
            // Højere end appens 800 px: testvinduet scroller ikke, så alt skal
            // kunne ses uden at scrolle (timeren på I dag, AI- og Sporing-listerne).
            size: size(px(1200.), px(1600.)),
        };
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| AppView::new(backend, window, cx)),
        )
        .expect("vindue")
    });
    cx.run_until_parked();
    render(cx, handle);
    (handle, view)
}

pub fn render(cx: &mut TestAppContext, handle: AnyWindowHandle) {
    cx.update_window(handle, |_, window, cx| window.render_frame(cx))
        .expect("render");
}

/// Skifter skærm, venter på data og tegner.
pub fn navigate(
    cx: &mut TestAppContext,
    handle: AnyWindowHandle,
    app: &Entity<AppView>,
    screen: Screen,
) {
    cx.update_window(handle, |_, window, cx| {
        app.update(cx, |a, cx| a.navigate(screen, window, cx))
    })
    .expect("navigér");
    cx.run_until_parked();
    render(cx, handle);
    cx.run_until_parked();
    render(cx, handle);
}

/// Optælling af a11y-elementer i den seneste frame.
#[derive(Debug, Default)]
pub struct A11y {
    pub total: usize,
    pub with_role: usize,
    pub with_label: usize,
    pub roles: BTreeMap<String, usize>,
    /// (rolle, label) for alle elementer med label.
    pub labels: Vec<(String, String)>,
}

impl A11y {
    pub fn count(&self, role: &str) -> usize {
        self.roles.get(role).copied().unwrap_or(0)
    }

    pub fn has_label(&self, label: &str) -> bool {
        self.labels.iter().any(|(_, l)| l == label)
    }

    pub fn has_label_containing(&self, part: &str) -> bool {
        self.labels.iter().any(|(_, l)| l.contains(part))
    }
}

pub fn a11y(cx: &mut TestAppContext, handle: AnyWindowHandle) -> A11y {
    use gpui_kit::test::TestQueryExt as _;
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let els = window.elements();
        let mut out = A11y {
            total: els.len(),
            ..Default::default()
        };
        for e in &els {
            if let Some(role) = e.role() {
                out.with_role += 1;
                *out.roles.entry(format!("{role:?}")).or_insert(0) += 1;
                if let Some(label) = e.label() {
                    out.with_label += 1;
                    out.labels.push((format!("{role:?}"), label.to_string()));
                }
            }
        }
        out
    })
    .expect("a11y")
}
