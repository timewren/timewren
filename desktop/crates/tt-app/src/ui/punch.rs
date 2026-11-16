//! Klippekort med huller: ét hul pr. time. Brugte timer er udstanset (fyldt),
//! overløb vises med fejlfarve efter kortets sidste hul.

use crate::i18n::tf;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::brand::Brand;
use crate::ui::El;
use crate::ui::format;

/// Højst så mange huller tegnes; større kort vises skaleret (ét hul = flere timer).
pub const MAX_HOLES: u32 = 40;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HoleLayout {
    /// Antal huller i alt (uden overløb).
    pub holes: u32,
    /// Fyldte huller.
    pub used: u32,
    /// Ekstra huller for overløb (højst 10).
    pub overflow: u32,
    /// Minutter pr. hul.
    pub minutes_per_hole: u32,
}

/// Regner huller ud. Delvist brugte timer runder op (en påbegyndt time er klippet).
pub fn layout(total_minutes: u32, used_minutes: u32) -> HoleLayout {
    let hours = total_minutes.div_ceil(60).max(1);
    let per_hole_hours = hours.div_ceil(MAX_HOLES);
    let minutes_per_hole = per_hole_hours * 60;
    let holes = hours.div_ceil(per_hole_hours);
    let used_total = used_minutes.div_ceil(minutes_per_hole);
    HoleLayout {
        holes,
        used: used_total.min(holes),
        overflow: used_total.saturating_sub(holes).min(10),
        minutes_per_hole,
    }
}

/// Skærmlæser-tekst: "Klippekort: 7 t tilbage af 20 t" / "… 1,5 t over".
pub fn describe(total_minutes: u32, used_minutes: u32) -> String {
    if used_minutes > total_minutes {
        tf(
            "ui.punch.over",
            &[("over", &format::hours(used_minutes - total_minutes))],
        )
    } else {
        tf(
            "ui.punch.left",
            &[
                ("left", &format::hours(total_minutes - used_minutes)),
                ("total", &format::hours(total_minutes)),
            ],
        )
    }
}

/// Hullerne som element (rolle `Meter` med værdi). Hullerne selv er dekoration.
pub fn punch_card_holes(
    b: &Brand,
    id: impl Into<ElementId>,
    total_minutes: u32,
    used_minutes: u32,
) -> El {
    let l = layout(total_minutes, used_minutes);
    let hole = |filled: bool, color: Hsla| {
        div()
            .size(px(16.))
            .rounded_full()
            .border_2()
            .border_color(color)
            .when(filled, |d| d.bg(color))
    };
    div()
        .id(id)
        .test_support()
        .role(Role::Meter)
        .aria_label(describe(total_minutes, used_minutes))
        .aria_min_numeric_value(0.0)
        .aria_max_numeric_value(total_minutes as f64 / 60.0)
        .aria_numeric_value(used_minutes.min(total_minutes) as f64 / 60.0)
        .flex()
        .flex_wrap()
        .gap_1p5()
        .children((0..l.holes).map(|i| hole(i < l.used, b.primary)))
        .children((0..l.overflow).map(|_| hole(true, b.danger)))
}

#[cfg(test)]
mod tests {
    use super::{MAX_HOLES, describe, layout};

    #[test]
    fn et_hul_pr_time() {
        let l = layout(20 * 60, 13 * 60);
        assert_eq!(
            (l.holes, l.used, l.overflow, l.minutes_per_hole),
            (20, 13, 0, 60)
        );
    }

    #[test]
    fn paabegyndt_time_er_klippet() {
        assert_eq!(layout(10 * 60, 61).used, 2);
        assert_eq!(layout(10 * 60, 0).used, 0);
    }

    #[test]
    fn overloeb_vises() {
        let l = layout(10 * 60, 10 * 60 + 90);
        assert_eq!((l.holes, l.used, l.overflow), (10, 10, 2));
    }

    #[test]
    fn store_kort_skaleres() {
        let l = layout(100 * 60, 50 * 60);
        assert!(l.holes <= MAX_HOLES);
        assert_eq!(l.minutes_per_hole, 180);
        assert_eq!(l.holes, 34);
        assert_eq!(l.used, 17);
    }

    #[test]
    fn beskrivelse_paa_dansk() {
        assert_eq!(
            describe(20 * 60, 13 * 60),
            "Klippekort: 7 t tilbage af 20 t"
        );
        assert_eq!(describe(600, 690), "Klippekort: brugt op, 1,5 t over");
    }
}
