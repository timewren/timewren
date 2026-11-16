//! Kalender → Måned (som 0.2's MonthView): et gitter med mandag først og
//! højst seks uger. Hver dag viser dagens total og antal poster; dage uden
//! for måneden er dæmpede. Dagens nummer er en knap (Tab og Enter), der
//! åbner dagen i dagsvisningen.

use chrono::{Datelike, Days, Months, NaiveDate};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::KalenderScreen;
use super::geo::week_start;
use crate::backend::Entry;
use crate::brand::Brand;
use crate::i18n::tf;
use crate::ui::icons;
use crate::ui::{self, format};

/// Dagene i månedsgitteret: fra mandagen før den 1. til søndagen efter den
/// sidste, altså 4-6 hele uger.
pub fn month_grid(anchor: NaiveDate) -> Vec<NaiveDate> {
    let first = anchor.with_day(1).expect("den 1. findes");
    let last = first + Months::new(1) - Days::new(1);
    let start = week_start(first);
    let end = week_start(last) + Days::new(6);
    start.iter_days().take_while(|d| *d <= end).collect()
}

/// Samme dag i måneden før eller efter (sidste dag, hvis den ikke findes).
pub fn shift_month(anchor: NaiveDate, dir: i64) -> NaiveDate {
    if dir < 0 {
        anchor - Months::new(1)
    } else {
        anchor + Months::new(1)
    }
}

/// "oktober 2026" på det valgte sprog.
pub fn month_label(anchor: NaiveDate) -> String {
    tf(
        "gendan.kalender.month_label",
        &[
            ("month", format::month(anchor.month())),
            ("year", &anchor.year().to_string()),
        ],
    )
}

/// Dagens minutter og antal poster.
pub fn day_summary(entries: &[Entry], day: NaiveDate) -> (u32, usize) {
    entries
        .iter()
        .filter(|e| e.date == day)
        .fold((0, 0), |(m, n), e| (m + e.minutes, n + 1))
}

/// Højst så mange farvede poster pr. dag i månedsgitteret.
const MAX_CHIPS: usize = 3;

impl KalenderScreen {
    /// En post i månedsgitteret: kundens farve som kant og flade, og
    /// opgavens statusikon og -kant, hvis posten hører til en opgave.
    /// Dekorativ (dagens knap bærer navnet), så den har ingen rolle.
    fn month_chip(&self, b: &Brand, e: &Entry) -> Div {
        let (colors, mark) = self.post_style(b, e);
        h_flex()
            .gap_1()
            .items_center()
            .overflow_hidden()
            .rounded(px(4.))
            .pl(px(6.))
            .pr_1()
            .py_0p5()
            .text_xs()
            .whitespace_nowrap()
            .relative()
            .bg(super::farver::hsla(colors.fill))
            .text_color(super::farver::hsla(colors.text))
            .child(
                div()
                    .absolute()
                    .left_0()
                    .top_0()
                    .bottom_0()
                    .w(px(3.))
                    .bg(super::farver::hsla(colors.edge)),
            )
            .children(mark.map(|m| {
                div()
                    .absolute()
                    .right_0()
                    .top_0()
                    .bottom_0()
                    .w(px(3.))
                    .bg(super::farver::hsla(m.edge))
            }))
            .children(mark.map(|m| {
                icons::icon(super::legend::task_icon(m.status))
                    .size(10.)
                    .color(super::farver::hsla(m.badge_fg))
            }))
            .child(self.refs.customer_name(&e.customer_id).to_string())
    }

    pub fn set_month(&mut self, cx: &mut Context<Self>) {
        self.month = true;
        self.week = true;
        self.entries = crate::ui::Loadable::Loading;
        self.reload(cx);
        cx.notify();
    }

    /// Åbn en dag fra månedsgitteret i dagsvisningen.
    pub fn open_day(&mut self, day: NaiveDate, cx: &mut Context<Self>) {
        self.anchor = day;
        self.month = false;
        self.set_week(false, cx);
    }

    pub(super) fn render_month(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let days = self.days();
        let today = self.ctx.backend.today();
        let month = self.anchor.month();
        let entries = self.all();
        let headers = h_flex().children((0..7).map(|i| {
            div()
                .flex_1()
                .px_2()
                .text_xs()
                .text_color(b.grey)
                .child(format::weekday_short(days[i].weekday()))
        }));
        let weeks = days.chunks(7).enumerate().map(|(w, week)| {
            h_flex().gap_1().children(week.iter().map(|&day| {
                let (minutes, count) = day_summary(entries, day);
                let outside = day.month() != month;
                let label = if count == 0 {
                    tf("gendan.kalender.day_empty", &[("date", &format::date_long(day))])
                } else {
                    tf(
                        "gendan.kalender.day_label",
                        &[
                            ("date", &format::date_long(day)),
                            ("hours", &format::hours(minutes)),
                            ("count", &count.to_string()),
                        ],
                    )
                };
                let mut number = Button::new(SharedString::from(format!("maaned-dag-{day}")))
                    .label(day.day().to_string())
                    .xsmall()
                    .accessibility_label(label)
                    .on_click(cx.listener(move |this, _, _, cx| this.open_day(day, cx)));
                number = if day == today { number.primary() } else { number.ghost() };
                v_flex()
                    .flex_1()
                    .min_h(px(124.))
                    .p_1()
                    .gap_1()
                    .rounded(px(8.))
                    .border_1()
                    .border_color(b.border)
                    .bg(b.card)
                    .when(outside, |d| d.opacity(0.4))
                    .child(h_flex().child(number))
                    .when(count > 0, |d| {
                        d.child(
                            div()
                                .px_2()
                                .text_sm()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(b.ink)
                                .child(format::hours(minutes)),
                        )
                        .child(div().px_2().text_xs().text_color(b.grey).child(tf(
                            "gendan.kalender.entries",
                            &[("count", &count.to_string())],
                        )))
                        .children(
                            entries
                                .iter()
                                .filter(|e| e.date == day)
                                .take(MAX_CHIPS)
                                .map(|e| self.month_chip(b, e)),
                        )
                    })
                    .into_any_element()
            }))
            .id(("maaned-uge", w))
        });
        ui::el("kalender-maaned", Role::Grid, month_label(self.anchor))
            .flex()
            .flex_col()
            .gap_1()
            .child(headers)
            .children(weeks)
            .into_any_element()
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use gpui_kit::TestAppContext;

    use crate::backend::Backend as _;
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;
    use crate::ui::format;

    #[gpui_kit::test]
    fn maaned_viser_dagene_og_aabner_en_dag(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Kalender);
        p.click(cx, "kalender-visning-2");
        let today = p.mock.today();
        p.assert_label(cx, &super::month_label(today));
        p.assert_label(cx, "poster. Åbn dagen");
        p.assert_all_labelled(cx);
        // Næste måned og tilbage.
        p.click(cx, "kalender-naeste");
        p.assert_label(cx, &super::month_label(super::shift_month(today, 1)));
        p.click(cx, "kalender-forrige");
        // En dag åbnes i dagsvisningen.
        p.click(cx, gpui_kit::SharedString::from(format!("maaned-dag-{today}")));
        p.assert_label(cx, &format::date_long(today));
        p.assert_no_label(cx, "poster. Åbn dagen");
    }
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::{day_summary, month_grid, shift_month};
    use crate::backend::Entry;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn gitteret_starter_mandag_og_dækker_hele_uger() {
        // Oktober 2026: 1. er en torsdag, 31. en lørdag.
        let g = month_grid(d(2026, 10, 27));
        assert_eq!(g.first(), Some(&d(2026, 9, 28)));
        assert_eq!(g.last(), Some(&d(2026, 11, 1)));
        assert_eq!(g.len(), 35);
        // Februar 2027 starter mandag og har 28 dage: præcis fire uger.
        assert_eq!(month_grid(d(2027, 2, 10)).len(), 28);
        // Marts 2026: søndag den 1. giver seks uger.
        assert_eq!(month_grid(d(2026, 3, 1)).len(), 42);
    }

    #[test]
    fn maaned_frem_og_tilbage() {
        assert_eq!(shift_month(d(2026, 1, 31), 1), d(2026, 2, 28));
        assert_eq!(shift_month(d(2026, 3, 15), -1), d(2026, 2, 15));
    }

    #[test]
    fn dagens_total_og_antal() {
        let e = |day: u32, minutes: u32| Entry {
            id: format!("e{day}{minutes}"),
            customer_id: "k".into(),
            project_id: None,
            task_id: None,
            description: String::new(),
            date: d(2026, 10, day),
            start: None,
            end: None,
            minutes,
            billable: true,
            invoice_id: None,
        };
        let entries = vec![e(5, 90), e(5, 30), e(6, 60)];
        assert_eq!(day_summary(&entries, d(2026, 10, 5)), (120, 2));
        assert_eq!(day_summary(&entries, d(2026, 10, 7)), (0, 0));
    }
}
