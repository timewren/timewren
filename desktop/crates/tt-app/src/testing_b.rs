//! Testhjælpere til screens-b's probe-tests (feature `probe`). Bygger oven på
//! `testing`: klik, aflæsning af labels og adgang til skærmens view.

use std::sync::Arc;

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AnyWindowHandle, AppContext as _, ElementId, Entity, TestAppContext};

use crate::app::AppView;
use crate::backend::MockBackend;
use crate::screens::Screen;
use crate::testing::{self, A11y};

pub struct Probe {
    pub handle: AnyWindowHandle,
    pub app: Entity<AppView>,
    pub mock: Arc<MockBackend>,
}

/// Åbner appen på `screen` mod `mock`.
pub fn open(cx: &mut TestAppContext, mock: Arc<MockBackend>, screen: Screen) -> Probe {
    let (handle, app) = testing::open_app(cx, mock.clone());
    testing::navigate(cx, handle, &app, screen);
    Probe { handle, app, mock }
}

impl Probe {
    pub fn click(&self, cx: &mut TestAppContext, id: impl Into<ElementId>) {
        let id = id.into();
        cx.update_window(self.handle, |_, window, cx| window.click(id, cx))
            .expect("klik");
        self.settle(cx);
    }

    pub fn press(&self, cx: &mut TestAppContext, key: &str) {
        cx.update_window(self.handle, |_, window, cx| window.press(key, cx))
            .expect("tast");
        self.settle(cx);
    }

    /// Venter på baggrundsarbejde og tegner, to gange (data → genindlæsning).
    pub fn settle(&self, cx: &mut TestAppContext) {
        for _ in 0..3 {
            cx.run_until_parked();
            testing::render(cx, self.handle);
        }
    }

    pub fn a11y(&self, cx: &mut TestAppContext) -> A11y {
        testing::a11y(cx, self.handle)
    }

    /// Fejler med alle labels, hvis `part` ikke findes.
    pub fn assert_label(&self, cx: &mut TestAppContext, part: &str) {
        let a = self.a11y(cx);
        assert!(
            a.has_label_containing(part),
            "mangler label med \"{part}\". Har: {:#?}",
            a.labels
        );
    }

    pub fn assert_no_label(&self, cx: &mut TestAppContext, part: &str) {
        let a = self.a11y(cx);
        assert!(!a.has_label_containing(part), "uventet label \"{part}\"");
    }

    /// Alle elementer med rolle har label (a11y-reglen).
    pub fn assert_all_labelled(&self, cx: &mut TestAppContext) {
        let a = self.a11y(cx);
        assert_eq!(a.with_label, a.with_role, "alle roller har label");
        assert!(a.with_role > 10);
    }

    /// Skærmens view som sin konkrete type.
    pub fn screen<V: 'static>(&self, cx: &mut TestAppContext, screen: Screen) -> Entity<V> {
        self.app
            .read_with(cx, |a, _| a.view_for(screen))
            .expect("skærmen er bygget")
            .downcast::<V>()
            .unwrap_or_else(|_| panic!("skærmen har ikke den ventede type"))
    }
}
