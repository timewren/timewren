//! Indstillinger → Sporing → "Eksportér anonymiseret testsæt": de seneste 30
//! dages aktivitet med posterne som facit, uden navne (tt-matcher
//! `anonymize`). Filen lægges i Overførsler, så brugeren selv kan sende den.

use gpui_kit::component::button::Button;
use gpui_kit::component::Sizable as _;
use gpui_kit::*;

use super::{IndstillingerScreen, row};
use crate::ui::Icon;
use crate::brand::Brand;
use crate::export;
use crate::i18n::{t, tf};

impl IndstillingerScreen {
    fn export_test_set(&mut self, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            |b| b.export_test_set(&export::export_dir()),
            |this, res, cx| {
                this.notice = Some(match res {
                    Ok(path) => (
                        tf("observer.eksport.gemt", &[("sti", &path.display().to_string())]).into(),
                        false,
                    ),
                    Err(e) => (e.to_string().into(), true),
                });
                cx.notify();
            },
        );
    }

    pub(super) fn render_testsaet(&self, b: &Brand, cx: &mut Context<Self>) -> Div {
        row(
            b,
            "sporing-testsaet",
            t("observer.eksport.titel"),
            t("observer.eksport.tekst"),
        )
        .child(
            Button::new("sporing-testsaet-knap")
                .outline()
                .small()
                .icon(Icon::Download)
                .label(t("observer.eksport.knap"))
                .on_click(cx.listener(|this, _, _, cx| this.export_test_set(cx))),
        )
    }
}
