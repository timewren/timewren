//! Forklaringen under kalenderen: hvad kundens farve og opgavemarkeringen
//! betyder, og hvilke kunder der er i visningen.

use gpui_kit::component::h_flex;
use gpui_kit::*;

use super::KalenderScreen;
use super::farver;
use crate::backend::TaskStatus;
use crate::brand::Brand;
use crate::i18n::t;
use crate::screens::opgaver::{logic, status_label};
use crate::ui::icons::{self, Icon};
use crate::ui::{self};

/// Opgavens statusikon (som i web og på Opgaver).
pub fn task_icon(s: TaskStatus) -> Icon {
    match s {
        TaskStatus::Backlog => Icon::Circle,
        TaskStatus::Todo => Icon::Clock,
        TaskStatus::InProgress => Icon::PlayCircle,
        TaskStatus::Done => Icon::CheckCircle2,
    }
}

/// Højst så mange kunder i forklaringen; resten tælles.
const MAX_CUSTOMERS: usize = 6;

impl KalenderScreen {
    pub(super) fn render_legend(&self, b: &Brand) -> Option<AnyElement> {
        self.entries.ready()?;
        let customers = farver::customers_in_view(self.all(), &self.refs.customers);
        let shown = customers.iter().take(MAX_CUSTOMERS);
        let more = customers.len().saturating_sub(MAX_CUSTOMERS);
        let any_task = self
            .all()
            .iter()
            .any(|e| farver::task_of(&self.refs.tasks, e).is_some());
        let fb = farver::Fallback::of(b.dark);
        let any_colour = customers.iter().any(|c| crate::ui::farve::customer_color(c).is_some());
        let sample = |c: &crate::backend::Customer| {
            let col = farve_of(c).unwrap_or(fb.primary);
            h_flex()
                .gap_1p5()
                .items_center()
                .child(
                    div()
                        .w(px(4.))
                        .h(px(14.))
                        .rounded_full()
                        .bg(farver::hsla(col)),
                )
                .child(c.name.clone())
        };
        Some(
            ui::el(
                "kalender-forklaring",
                Role::Group,
                if self.refs.customers.iter().any(|c| crate::ui::farve::customer_color(c).is_some()) {
                    format!(
                        "{}. {}. {}",
                        t("opx.kalender.legend_label"),
                        t("opx.kalender.legend_customer"),
                        t("opx.kalender.legend_task")
                    )
                } else {
                    format!("{}. {}", t("opx.kalender.legend_label"), t("opx.kalender.legend_task"))
                },
            )
                .flex()
                .flex_row()
                .flex_wrap()
                .items_center()
                .gap_x_4()
                .gap_y_1()
                .px_3()
                .py_2()
                .rounded(px(10.))
                .border_1()
                .border_color(b.border)
                .bg(b.card)
                .text_xs()
                .text_color(b.grey)
                .when(any_colour, |d| {
                    d.child(div().font_weight(FontWeight::MEDIUM).child(t("opx.kalender.legend_customer")))
                        .children(shown.map(|c| sample(c)))
                        .children((more > 0).then(|| div().child(format!("+{more}"))))
                        .child(div().w(px(1.)).h(px(14.)).bg(b.border))
                })
                .child(div().font_weight(FontWeight::MEDIUM).child(t("opx.kalender.legend_task")))
                .children(TaskStatus::ALL.into_iter().map(|s| {
                    let p = logic::status_palette(s, b.dark);
                    h_flex()
                        .gap_1()
                        .items_center()
                        .child(icons::icon(task_icon(s)).size(13.).color(farver::hsla(p.accent)))
                        .child(
                            div()
                                .w(px(3.))
                                .h(px(12.))
                                .rounded_full()
                                .bg(farver::hsla(p.accent)),
                        )
                        .child(status_label(s))
                }))
                .when(!any_task, |d| d.child(div().child(t("opx.kalender.legend_no_tasks"))))
                .into_any_element(),
        )
    }
}

fn farve_of(c: &crate::backend::Customer) -> Option<u32> {
    crate::ui::farve::customer_color(c)
}

use gpui_kit::prelude::FluentBuilder as _;

#[cfg(all(test, feature = "probe"))]
mod probe {
    use gpui_kit::TestAppContext;

    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    #[gpui_kit::test]
    fn poster_paa_en_opgave_faar_markering_og_forklaring(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Kalender);
        p.assert_all_labelled(cx);
        // Forklaringen står under kalenderen, med alle fire statusser.
        p.assert_label(cx, "Forklaring til farverne");
        p.assert_label(cx, "Ikon og højrekant: opgavens status");
        // Mandagens post på Booking-modulet hører til opgaven "Påmindelser på sms".
        p.assert_label(
            cx,
            "08:30-09:00, 0,5 t, Klinik Søndergade, Booking-modul, Møde om booking-flow, opgave Påmindelser på sms (Todo)",
        );
        // Måned: samme markering i gitteret, og forklaringen følger med.
        p.click(cx, "kalender-visning-2");
        p.assert_label(cx, "Forklaring til farverne");
        p.assert_all_labelled(cx);
    }
}
