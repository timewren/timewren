//! Probe-tests for Indstillinger → Opdateringer: noterne som tekst, foldet
//! sammen som standard, og knapperne står øverst og kun én gang i a11y-træet.

use gpui_kit::TestAppContext;

use crate::i18n::t;
use crate::screens::Screen;
use crate::screens::opdatering::{DEMO_NOTER, State, UpdatePanel};
use crate::testing::{self, A11y};
use crate::testing_b as tb;
use crate::updater::Update;

fn med_opdatering(cx: &mut TestAppContext) -> tb::Probe {
    let p = tb::open(cx, testing::mock(), Screen::Indstillinger);
    // Roden installerer panelet; AppView alene gør ikke.
    let ctx = p.app.read_with(cx, |a, _| a.ctx.clone());
    cx.update(|cx| {
        UpdatePanel::install(ctx, cx);
        let panel = UpdatePanel::global(cx).expect("panelet er installeret");
        panel.update(cx, |p, cx| {
            p.state = State::Available(Update {
                version: "9.9.9".into(),
                notes: Some(DEMO_NOTER.into()),
                url: String::new(),
                signature: String::new(),
            });
            cx.notify();
        });
    });
    p.click(cx, "indstilling-opdateringer");
    p.settle(cx);
    p
}

fn labels_med_rolle(a: &A11y, rolle: &str) -> Vec<String> {
    a.labels
        .iter()
        .filter(|(r, _)| r == rolle)
        .map(|(_, l)| l.clone())
        .collect()
}

#[gpui_kit::test]
fn noter_er_foldet_som_standard_og_knapperne_staar_en_gang(cx: &mut TestAppContext) {
    let p = med_opdatering(cx);
    let a = p.a11y(cx);
    let knapper = labels_med_rolle(&a, "Button");
    for l in [t("opdatering.install"), t("opdatering.show_notes")] {
        let l = l.to_string();
        assert_eq!(
            knapper.iter().filter(|k| **k == l).count(),
            1,
            "knappen \"{l}\" skal stå præcis én gang: {knapper:?}"
        );
    }
    p.assert_no_label(cx, "titel-eksklusion");
    assert!(
        labels_med_rolle(&a, "Heading")
            .iter()
            .all(|h| h != "Tilføjet")
    );
}

#[gpui_kit::test]
fn vis_nyheder_folder_noterne_ud_og_ind(cx: &mut TestAppContext) {
    let p = med_opdatering(cx);
    p.click(cx, "opdatering-noter-knap");
    let a = p.a11y(cx);
    let h = labels_med_rolle(&a, "Heading");
    for navn in ["Tilføjet", "Rettet", "Kendte fejl"] {
        assert!(h.iter().any(|x| x == navn), "overskrift \"{navn}\": {h:?}");
    }
    // Ingen rå markdown-tegn i det, skærmlæseren får.
    let alle: String = a.labels.iter().map(|(_, l)| l.as_str()).collect();
    for raa in ["###", "**", "](", "`"] {
        assert!(!alle.contains(raa), "rå markdown \"{raa}\" i labels");
    }
    assert!(
        a.count("ListItem") >= 4,
        "listepunkter: {}",
        a.count("ListItem")
    );
    let hide = t("opdatering.hide_notes").to_string();
    assert!(labels_med_rolle(&a, "Button").contains(&hide));
    p.click(cx, "opdatering-noter-knap");
    p.assert_no_label(cx, "titel-eksklusion");
}
