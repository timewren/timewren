//! Rapporter: tid pr. kunde, projekt eller dag i en uge, måned eller valgfri
//! periode. Fakturerbar mod ikke-fakturerbar, klippekort-forbrug, søjler med
//! en tilgængelig tabel ved siden af, og eksport til CSV.
//!
//! Tastatur: Alt+venstre/højre skifter periode, Tab når alle knapper og felter.

use chrono::{Datelike as _, Days, Months, NaiveDate};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{Customer, DateRange, Entry, PunchCard, Report, ReportGrouping};
use crate::brand::{Brand, brand};
use crate::export;
use crate::i18n::{t, tf};
use crate::ui::{self, Loadable, format};

// ---------- Ren logik ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeriodKind {
    Week,
    Month,
    Custom,
}

/// Mandag-søndag omkring `d`.
pub fn week_range(d: NaiveDate) -> DateRange {
    let from = d - Days::new(d.weekday().num_days_from_monday() as u64);
    DateRange {
        from,
        to: from + Days::new(6),
    }
}

/// Hele måneden omkring `d`.
pub fn month_range(d: NaiveDate) -> DateRange {
    let from = d.with_day(1).expect("dag 1 findes");
    let to = (from + Months::new(1)) - Days::new(1);
    DateRange { from, to }
}

/// Næste/forrige periode. Valgfri periode flyttes med sin egen længde.
pub fn shift(kind: PeriodKind, r: DateRange, delta: i32) -> DateRange {
    match kind {
        PeriodKind::Week => {
            let d = if delta >= 0 {
                r.from + Days::new(7 * delta as u64)
            } else {
                r.from - Days::new(7 * delta.unsigned_abs() as u64)
            };
            week_range(d)
        }
        PeriodKind::Month => {
            let d = if delta >= 0 {
                r.from + Months::new(delta as u32)
            } else {
                r.from - Months::new(delta.unsigned_abs())
            };
            month_range(d)
        }
        PeriodKind::Custom => {
            let len = (r.to - r.from).num_days() as u64 + 1;
            let n = len * delta.unsigned_abs() as u64;
            if delta >= 0 {
                DateRange {
                    from: r.from + Days::new(n),
                    to: r.to + Days::new(n),
                }
            } else {
                DateRange {
                    from: r.from - Days::new(n),
                    to: r.to - Days::new(n),
                }
            }
        }
    }
}

/// "Uge 44, 2026", "Oktober 2026" eller "1.10.2026-26.10.2026".
pub fn period_label(kind: PeriodKind, r: DateRange) -> String {
    match kind {
        PeriodKind::Week => {
            let w = r.from.iso_week();
            tf(
                "rapporter.period.week",
                &[
                    ("week", &w.week().to_string()),
                    ("year", &w.year().to_string()),
                ],
            )
        }
        PeriodKind::Month => {
            let m = format::month(r.from.month());
            let mut c = m.chars();
            let first = c.next().map(|f| f.to_uppercase().collect::<String>());
            format!(
                "{}{} {}",
                first.unwrap_or_default(),
                c.as_str(),
                r.from.year()
            )
        }
        PeriodKind::Custom => format!(
            "{}-{}",
            format::date_short(r.from),
            format::date_short(r.to)
        ),
    }
}

/// "26.10.2026", "26/10/2026", "26-10-2026", "2026-10-26" eller "26.10" (i år).
pub fn parse_date(s: &str, today: NaiveDate) -> Option<NaiveDate> {
    let s = s.trim();
    if s.len() == 10 && s.as_bytes()[4] == b'-' {
        return NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    }
    let parts: Vec<&str> = s.split(['.', '/', '-']).filter(|p| !p.is_empty()).collect();
    let (d, m, y) = match parts.as_slice() {
        [d, m] => (d.parse().ok()?, m.parse().ok()?, today.year()),
        [d, m, y] => {
            let y: i32 = y.parse().ok()?;
            let y = if y < 100 { 2000 + y } else { y };
            (d.parse().ok()?, m.parse().ok()?, y)
        }
        _ => return None,
    };
    NaiveDate::from_ymd_opt(y, m, d)
}

/// Søjlens længde 0-1 i forhold til den største række.
pub fn bar_fraction(minutes: u32, max: u32) -> f32 {
    if max == 0 {
        0.0
    } else {
        (minutes as f32 / max as f32).clamp(0.0, 1.0)
    }
}

/// Totaler: (timer, fakturerbare, beløb i øre).
pub fn totals(r: &Report) -> (u32, u32, i64) {
    r.rows.iter().fold((0, 0, 0), |a, row| {
        (
            a.0 + row.minutes,
            a.1 + row.billable_minutes,
            a.2 + row.amount,
        )
    })
}

/// Fakturerbar tid på kortets kunde i perioden (det, der trækkes fra kortet).
pub fn card_usage_in(card: &PunchCard, entries: &[Entry], r: DateRange) -> u32 {
    entries
        .iter()
        .filter(|e| e.customer_id == card.customer_id && e.billable && r.contains(e.date))
        .map(|e| e.minutes)
        .sum()
}

fn grouping_label(g: ReportGrouping) -> &'static str {
    match g {
        ReportGrouping::Customer => t("rapporter.group.customer"),
        ReportGrouping::Project => t("rapporter.group.project"),
        ReportGrouping::Day => t("rapporter.group.day"),
    }
}

const GROUPINGS: [ReportGrouping; 3] = [
    ReportGrouping::Customer,
    ReportGrouping::Project,
    ReportGrouping::Day,
];

// gendan: momsoverblik og rå CSV.
mod gendan;

// ---------- Skærmen ----------

struct Data {
    report: Report,
    cards: Vec<PunchCard>,
    customers: Vec<Customer>,
    entries: Vec<Entry>,
    // gendan: moms og rå CSV.
    invoices: Vec<crate::backend::Invoice>,
    projects: Vec<crate::backend::Project>,
    export: crate::backend::ExportSettings,
}

pub struct RapporterScreen {
    ctx: AppCtx,
    kind: PeriodKind,
    range: DateRange,
    grouping: ReportGrouping,
    data: Loadable<Data>,
    custom_from: Entity<InputState>,
    custom_to: Entity<InputState>,
    custom_error: Option<SharedString>,
    notice: Option<(SharedString, bool)>,
    last_file: Option<std::path::PathBuf>,
    /// gendan: en dag i det kvartal, momsoverblikket viser.
    vat_quarter: NaiveDate,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

impl RapporterScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let today = ctx.backend.today();
        let range = week_range(today);
        let custom_from = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(t("rapporter.period.placeholder"))
                .default_value(format::date_short(month_range(today).from))
        });
        let custom_to = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(t("rapporter.period.placeholder"))
                .default_value(format::date_short(today))
        });
        let mut subs = vec![cx.observe(&ctx.hub, |this: &mut Self, _, cx| this.reload(cx))];
        for i in [&custom_from, &custom_to] {
            subs.push(cx.subscribe(i, |this: &mut Self, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::PressEnter { .. }) {
                    this.apply_custom(cx);
                }
            }));
        }
        let mut this = RapporterScreen {
            ctx,
            kind: PeriodKind::Week,
            range,
            grouping: ReportGrouping::Customer,
            data: Loadable::Loading,
            custom_from,
            custom_to,
            custom_error: None,
            notice: None,
            last_file: None,
            vat_quarter: today,
            focus: cx.focus_handle(),
            _subs: subs,
        };
        this.reload(cx);
        this
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        let (range, grouping) = (self.range, self.grouping);
        self.ctx.fetch(
            cx,
            move |b| {
                Ok(Data {
                    report: b.report(range, grouping)?,
                    cards: b.punch_cards(None)?,
                    customers: b.customers(true)?,
                    entries: b.entries(range)?,
                    invoices: b.invoices()?,
                    projects: b.projects(None, true)?,
                    export: b.settings()?.export,
                })
            },
            |this, res, _| this.data = Loadable::from_result(res),
        );
    }

    fn set_kind(&mut self, kind: PeriodKind, cx: &mut Context<Self>) {
        self.kind = kind;
        let today = self.ctx.backend.today();
        match kind {
            PeriodKind::Week => self.range = week_range(today),
            PeriodKind::Month => self.range = month_range(today),
            PeriodKind::Custom => {
                self.apply_custom(cx);
                return;
            }
        }
        self.custom_error = None;
        self.data = Loadable::Loading;
        self.reload(cx);
        cx.notify();
    }

    fn step(&mut self, delta: i32, cx: &mut Context<Self>) {
        self.range = shift(self.kind, self.range, delta);
        self.data = Loadable::Loading;
        self.reload(cx);
        cx.notify();
    }

    fn apply_custom(&mut self, cx: &mut Context<Self>) {
        let today = self.ctx.backend.today();
        let from = parse_date(&self.custom_from.read(cx).value(), today);
        let to = parse_date(&self.custom_to.read(cx).value(), today);
        self.custom_error = match (from, to) {
            (None, _) => Some(t("rapporter.err.from").into()),
            (_, None) => Some(t("rapporter.err.to").into()),
            (Some(f), Some(end)) if end < f => Some(t("rapporter.err.order").into()),
            (Some(f), Some(end)) if (end - f).num_days() > 366 * 2 => {
                Some(t("rapporter.err.too_long").into())
            }
            (Some(f), Some(end)) => {
                self.range = DateRange { from: f, to: end };
                self.data = Loadable::Loading;
                self.reload(cx);
                None
            }
        };
        cx.notify();
    }

    fn export_csv(&mut self, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let report = d.report.clone();
        self.ctx.fetch(
            cx,
            move |_| {
                export::write_unique(
                    &export::export_dir(),
                    &export::report_file_name(&report),
                    export::report_csv(&report).as_bytes(),
                )
                .map_err(|e| crate::backend::BackendError::Other(e.to_string()))
            },
            |this, res, _| match res {
                Ok(p) => {
                    this.notice = Some((
                        tf(
                            "rapporter.notice.csv_saved",
                            &[("path", &p.display().to_string())],
                        )
                        .into(),
                        false,
                    ));
                    this.last_file = Some(p);
                }
                Err(e) => {
                    this.notice = Some((
                        tf("rapporter.notice.csv_failed", &[("error", &e.to_string())]).into(),
                        true,
                    ))
                }
            },
        );
    }
}

impl RapporterScreen {
    fn render_toolbar(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let weak = cx.entity().downgrade();
        let kinds = ui::segment(
            "rapport-periode",
            t("rapporter.period.label"),
            &[
                t("rapporter.period.week_kind"),
                t("rapporter.period.month_kind"),
                t("rapporter.period.custom_kind"),
            ],
            match self.kind {
                PeriodKind::Week => 0,
                PeriodKind::Month => 1,
                PeriodKind::Custom => 2,
            },
            move |i, _, cx| {
                let k = [PeriodKind::Week, PeriodKind::Month, PeriodKind::Custom][i];
                let _ = weak.update(cx, |s, cx| s.set_kind(k, cx));
            },
        );
        let weak = cx.entity().downgrade();
        let groups = ui::segment(
            "rapport-gruppering",
            t("rapporter.group.label"),
            &[
                t("rapporter.group.customer"),
                t("rapporter.group.project"),
                t("rapporter.group.day"),
            ],
            GROUPINGS
                .iter()
                .position(|g| *g == self.grouping)
                .unwrap_or(0),
            move |i, _, cx| {
                let _ = weak.update(cx, |s, cx| {
                    s.grouping = GROUPINGS[i];
                    s.data = Loadable::Loading;
                    s.reload(cx);
                    cx.notify();
                });
            },
        );
        let label = period_label(self.kind, self.range);
        let nav = h_flex()
            .gap_1()
            .items_center()
            .child(
                Button::new("rapport-forrige")
                    .label("‹")
                    .ghost()
                    .small()
                    .accessibility_label(t("rapporter.nav.previous"))
                    .tooltip(t("rapporter.nav.previous_tip"))
                    .on_click(cx.listener(|this, _, _, cx| this.step(-1, cx))),
            )
            .child(
                ui::text("rapport-periode-navn", label)
                    .min_w(px(170.))
                    .flex()
                    .justify_center()
                    .font_weight(FontWeight::SEMIBOLD),
            )
            .child(
                Button::new("rapport-naeste")
                    .label("›")
                    .ghost()
                    .small()
                    .accessibility_label(t("rapporter.nav.next"))
                    .tooltip(t("rapporter.nav.next_tip"))
                    .on_click(cx.listener(|this, _, _, cx| this.step(1, cx))),
            );
        let custom = (self.kind == PeriodKind::Custom).then(|| {
            v_flex()
                .gap_1()
                .child(
                    h_flex()
                        .gap_2()
                        .items_end()
                        .child(
                            v_flex()
                                .gap_1()
                                .w(px(160.))
                                .child(ui::muted(
                                    b,
                                    "rapport-fra-etiket",
                                    t("rapporter.period.from"),
                                ))
                                .child(
                                    Input::new(&self.custom_from)
                                        .id("rapport-fra")
                                        .aria_label(t("rapporter.period.from_date")),
                                ),
                        )
                        .child(
                            v_flex()
                                .gap_1()
                                .w(px(160.))
                                .child(ui::muted(b, "rapport-til-etiket", t("rapporter.period.to")))
                                .child(
                                    Input::new(&self.custom_to)
                                        .id("rapport-til")
                                        .aria_label(t("rapporter.period.to_date")),
                                ),
                        )
                        .child(
                            Button::new("rapport-vis")
                                .label(t("rapporter.action.show"))
                                .small()
                                .on_click(cx.listener(|this, _, _, cx| this.apply_custom(cx))),
                        ),
                )
                .children(self.custom_error.clone().map(|e| {
                    ui::el("rapport-periode-fejl", Role::Alert, e.clone())
                        .text_xs()
                        .text_color(b.danger)
                        .child(e)
                }))
        });
        v_flex()
            .gap_3()
            .child(
                h_flex()
                    .gap_4()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .child(kinds)
                    .child(nav),
            )
            .children(custom)
            .child(
                h_flex()
                    .gap_4()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(ui::muted(b, "rapport-tid-pr", t("rapporter.group.label")))
                            .child(groups),
                    )
                    .child(
                        Button::new("rapport-csv")
                            .icon(Icon::Download)
                            .label(t("rapporter.action.export_csv"))
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| this.export_csv(cx))),
                    ),
            )
            .into_any_element()
    }

    fn render_summary(&self, b: &Brand, r: &Report) -> AnyElement {
        let (total, billable, amount) = totals(r);
        let tile = |id: &'static str, label: &'static str, value: String| {
            ui::el(id, Role::Group, format!("{label}: {value}"))
                .flex()
                .flex_col()
                .gap_1()
                .flex_1()
                .p_4()
                .rounded(px(12.))
                .bg(b.card)
                .border_1()
                .border_color(b.border)
                .child(div().text_xs().text_color(b.grey).child(label))
                .child(
                    div()
                        .text_size(px(22.))
                        .font_weight(FontWeight::BOLD)
                        .child(value),
                )
        };
        h_flex()
            .gap_3()
            .child(tile(
                "rapport-total",
                t("rapporter.summary.total"),
                format::hours(total),
            ))
            .child(tile(
                "rapport-fakturerbar",
                t("rapporter.summary.billable"),
                format::hours(billable),
            ))
            .child(tile(
                "rapport-ikke-fakturerbar",
                t("rapporter.summary.non_billable"),
                format::hours(total.saturating_sub(billable)),
            ))
            .child(tile(
                "rapport-beloeb",
                t("rapporter.summary.value"),
                export::kroner(amount),
            ))
            .into_any_element()
    }

    fn render_chart_and_table(&self, b: &Brand, r: &Report) -> AnyElement {
        let max = r.rows.iter().map(|x| x.minutes).max().unwrap_or(0);
        let what = grouping_label(r.grouping).to_lowercase();
        // Diagrammet er grafik; tallene står i tabellen ved siden af.
        let chart = ui::el(
            "rapport-diagram",
            Role::Image,
            tf("rapporter.chart.alt", &[("what", &what)]),
        )
        .flex()
        .flex_col()
        .gap_2()
        .flex_1()
        .min_w(px(260.))
        .children(r.rows.iter().enumerate().map(|(i, row)| {
            let f_all = bar_fraction(row.minutes, max);
            let f_bill = bar_fraction(row.billable_minutes, max);
            v_flex()
                .id(("rapport-soejle", i))
                .gap_0p5()
                .child(
                    div()
                        .text_xs()
                        .text_color(b.ink)
                        .truncate()
                        .child(row.label.clone()),
                )
                .child(
                    div()
                        .relative()
                        .h(px(14.))
                        .w_full()
                        .rounded(px(4.))
                        .bg(b.border.opacity(0.5))
                        .child(
                            div()
                                .absolute()
                                .left_0()
                                .top_0()
                                .h_full()
                                .w(relative(f_all))
                                .rounded(px(4.))
                                .bg(b.grey.opacity(0.45)),
                        )
                        .child(
                            div()
                                .absolute()
                                .left_0()
                                .top_0()
                                .h_full()
                                .w(relative(f_bill))
                                .rounded(px(4.))
                                .bg(b.primary),
                        ),
                )
        }))
        .child(
            h_flex()
                .gap_3()
                .pt_1()
                .text_xs()
                .text_color(b.grey)
                .child(
                    h_flex()
                        .gap_1()
                        .items_center()
                        .child(div().size(px(10.)).rounded(px(2.)).bg(b.primary))
                        .child(t("rapporter.summary.billable")),
                )
                .child(
                    h_flex()
                        .gap_1()
                        .items_center()
                        .child(div().size(px(10.)).rounded(px(2.)).bg(b.grey.opacity(0.45)))
                        .child(t("rapporter.summary.non_billable")),
                ),
        );
        let head = |id: &'static str, s: &'static str, w: Option<f32>| {
            let d = ui::el(id, Role::ColumnHeader, s)
                .text_xs()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(b.grey)
                .child(s);
            match w {
                Some(w) => d.w(px(w)).flex().justify_end(),
                None => d.flex_1(),
            }
        };
        let table = ui::el(
            "rapport-tabel",
            Role::Table,
            tf("rapporter.table.title", &[("what", &what)]),
        )
        .flex()
        .flex_col()
        .gap_1()
        .flex_1()
        .min_w(px(380.))
        .child(
            ui::el(
                "rapport-tabel-hoved",
                Role::Row,
                t("rapporter.table.columns"),
            )
            .flex()
            .gap_2()
            .pb_1()
            .border_b_1()
            .border_color(b.border)
            .child(head("rapport-kol-navn", grouping_label(r.grouping), None))
            .child(head(
                "rapport-kol-timer",
                t("rapporter.table.hours"),
                Some(64.),
            ))
            .child(head(
                "rapport-kol-fakt",
                t("rapporter.summary.billable"),
                Some(84.),
            ))
            .child(head(
                "rapport-kol-beloeb",
                t("rapporter.summary.value"),
                Some(110.),
            )),
        )
        .children(r.rows.iter().enumerate().map(|(i, row)| {
            let cell = |id: (&'static str, usize), s: String, w: Option<f32>| {
                let d = ui::el(id, Role::Cell, s.clone()).text_sm().child(s);
                match w {
                    Some(w) => d.w(px(w)).flex().justify_end(),
                    None => d.flex_1().min_w_0().truncate(),
                }
            };
            ui::el(
                ("rapport-raekke", i),
                Role::Row,
                tf(
                    "rapporter.table.row",
                    &[
                        ("label", &row.label),
                        ("hours", &format::hours(row.minutes)),
                        ("billable", &format::hours(row.billable_minutes)),
                        ("amount", &export::kroner(row.amount)),
                    ],
                ),
            )
            .flex()
            .gap_2()
            .py_0p5()
            .child(cell(("rapport-celle-navn", i), row.label.clone(), None))
            .child(cell(
                ("rapport-celle-timer", i),
                format::hours(row.minutes),
                Some(64.),
            ))
            .child(cell(
                ("rapport-celle-fakt", i),
                format::hours(row.billable_minutes),
                Some(84.),
            ))
            .child(cell(
                ("rapport-celle-beloeb", i),
                export::kroner(row.amount),
                Some(110.),
            ))
        }));
        ui::card(
            b,
            "rapport-tid",
            tf("rapporter.table.title", &[("what", &what)]),
        )
        .child(ui::heading(
            b,
            "rapport-tid-titel",
            tf("rapporter.table.title", &[("what", &what)]),
            2,
        ))
        .child(h_flex().gap_6().items_start().child(chart).child(table))
        .into_any_element()
    }

    fn render_cards(&self, b: &Brand, d: &Data) -> Option<AnyElement> {
        let today = self.ctx.backend.today();
        let cards: Vec<&PunchCard> = d
            .cards
            .iter()
            .filter(|c| c.is_active(today) || card_usage_in(c, &d.entries, self.range) > 0)
            .collect();
        if cards.is_empty() {
            return None;
        }
        Some(
            ui::card(b, "rapport-klippekort", t("rapporter.cards.title"))
                .child(ui::heading(
                    b,
                    "rapport-klippekort-titel",
                    t("rapporter.cards.title"),
                    2,
                ))
                .child(
                    ui::list("rapport-klippekort-liste", t("rapporter.cards.list_label")).children(
                        cards.iter().enumerate().map(|(i, c)| {
                            let customer = d
                                .customers
                                .iter()
                                .find(|x| x.id == c.customer_id)
                                .map(|x| x.name.clone())
                                .unwrap_or_default();
                            let used_now = card_usage_in(c, &d.entries, self.range);
                            let remaining = c.remaining_minutes();
                            let rest = if remaining >= 0 {
                                tf(
                                    "rapporter.cards.left",
                                    &[("hours", &format::hours(remaining as u32))],
                                )
                            } else {
                                tf(
                                    "rapporter.cards.over",
                                    &[("hours", &format::hours(c.overflow_minutes()))],
                                )
                            };
                            let label = tf(
                                "rapporter.cards.label",
                                &[
                                    ("name", &c.name),
                                    ("customer", &customer),
                                    ("used_now", &format::hours(used_now)),
                                    ("used", &format::hours(c.used_minutes)),
                                    ("total", &format::hours(c.total_minutes)),
                                    ("rest", &rest),
                                ],
                            );
                            ui::list_row(b, ("rapport-kort", i), label)
                                .child(
                                    v_flex()
                                        .w(px(220.))
                                        .child(
                                            div()
                                                .font_weight(FontWeight::MEDIUM)
                                                .child(c.name.clone()),
                                        )
                                        .child(div().text_xs().text_color(b.grey).child(customer)),
                                )
                                .child(div().flex_1().child(ui::punch_card_holes(
                                    b,
                                    ("rapport-kort-huller", i),
                                    c.total_minutes,
                                    c.used_minutes,
                                )))
                                .child(
                                    v_flex()
                                        .w(px(150.))
                                        .items_end()
                                        .child(div().child(tf(
                                            "rapporter.cards.in_period",
                                            &[("hours", &format::hours(used_now))],
                                        )))
                                        .child(
                                            div()
                                                .text_xs()
                                                .text_color(if remaining < 0 {
                                                    b.danger
                                                } else {
                                                    b.grey
                                                })
                                                .child(rest),
                                        ),
                                )
                        }),
                    ),
                )
                .into_any_element(),
        )
    }
}

impl Render for RapporterScreen {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let toolbar = self.render_toolbar(&b, cx);
        let notice = self.notice.clone().map(|(msg, err)| {
            h_flex()
                .gap_3()
                .items_center()
                .child(
                    ui::el(
                        "rapport-besked",
                        if err { Role::Alert } else { Role::Status },
                        msg.clone(),
                    )
                    .text_sm()
                    .text_color(if err { b.danger } else { b.primary })
                    .child(msg),
                )
                .when(!err && self.last_file.is_some(), |d| {
                    d.child(
                        Button::new("rapport-vis-fil")
                            .icon(Icon::Folder)
                            .label(t("rapporter.action.reveal"))
                            .ghost()
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                if let Some(p) = &this.last_file {
                                    cx.reveal_path(p);
                                }
                            })),
                    )
                })
        });
        let body: AnyElement = match &self.data {
            Loadable::Loading => {
                ui::loading_state(&b, "rapport-indlaeser", t("rapporter.loading.what"))
                    .into_any_element()
            }
            Loadable::Failed(e) => ui::error_state(&b, "rapport-fejl", e.clone())
                .child(
                    Button::new("rapport-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("rapporter.action.retry"))
                        .small()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.data = Loadable::Loading;
                            this.reload(cx);
                        })),
                )
                .into_any_element(),
            Loadable::Ready(d) if d.report.rows.is_empty() => v_flex()
                .gap_4()
                .child(ui::empty_state_icon(
                    &b,
                    "rapport-tom",
                    Icon::BarChart3,
                    t("rapporter.empty.title"),
                    t("rapporter.empty.body"),
                ))
                .children(self.render_cards(&b, d))
                .child(self.render_gendan(&b, d, cx))
                .into_any_element(),
            Loadable::Ready(d) => v_flex()
                .gap_4()
                .child(self.render_summary(&b, &d.report))
                .child(self.render_chart_and_table(&b, &d.report))
                .children(self.render_cards(&b, d))
                .child(self.render_gendan(&b, d, cx))
                .into_any_element(),
        };
        ui::page(
            &b,
            "rapporter",
            t("rapporter.page.title"),
            Some(t("rapporter.page.subtitle").into()),
        )
        .track_focus(&self.focus)
        .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _, cx| {
            let k = &ev.keystroke;
            if k.modifiers.alt && (k.key == "left" || k.key == "right") {
                this.step(if k.key == "left" { -1 } else { 1 }, cx);
                cx.stop_propagation();
            }
        }))
        .child(toolbar)
        .children(notice)
        .child(body)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DateRange, Entry, NaiveDate, PeriodKind, PunchCard, Report, ReportGrouping, bar_fraction,
        card_usage_in, month_range, parse_date, period_label, shift, totals, week_range,
    };

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn uger_og_maaneder() {
        let w = week_range(d(2026, 10, 28));
        assert_eq!((w.from, w.to), (d(2026, 10, 26), d(2026, 11, 1)));
        assert_eq!(period_label(PeriodKind::Week, w), "Uge 44, 2026");
        let m = month_range(d(2026, 2, 14));
        assert_eq!((m.from, m.to), (d(2026, 2, 1), d(2026, 2, 28)));
        assert_eq!(period_label(PeriodKind::Month, m), "Februar 2026");
        let m = month_range(d(2028, 2, 14));
        assert_eq!(m.to, d(2028, 2, 29), "skudår");
    }

    #[test]
    fn skift_periode() {
        let w = week_range(d(2026, 1, 1));
        let prev = shift(PeriodKind::Week, w, -1);
        assert_eq!(prev.from, d(2025, 12, 22));
        assert_eq!(period_label(PeriodKind::Week, w), "Uge 1, 2026");
        let m = month_range(d(2026, 1, 31));
        assert_eq!(shift(PeriodKind::Month, m, 1).to, d(2026, 2, 28));
        assert_eq!(shift(PeriodKind::Month, m, -1).from, d(2025, 12, 1));
        let c = DateRange {
            from: d(2026, 10, 1),
            to: d(2026, 10, 10),
        };
        let n = shift(PeriodKind::Custom, c, 1);
        assert_eq!((n.from, n.to), (d(2026, 10, 11), d(2026, 10, 20)));
        assert_eq!(period_label(PeriodKind::Custom, c), "01.10.2026-10.10.2026");
    }

    #[test]
    fn datoer_tolkes() {
        let t = d(2026, 10, 26);
        assert_eq!(parse_date("26.10.2026", t), Some(t));
        assert_eq!(parse_date("26/10/2026", t), Some(t));
        assert_eq!(parse_date("2026-10-26", t), Some(t));
        assert_eq!(parse_date("26-10-26", t), Some(t));
        assert_eq!(parse_date("1.2", t), Some(d(2026, 2, 1)));
        assert_eq!(parse_date("31.2.2026", t), None);
        assert_eq!(parse_date("i går", t), None);
        assert_eq!(parse_date("", t), None);
    }

    #[test]
    fn soejler_og_totaler() {
        assert_eq!(bar_fraction(30, 60), 0.5);
        assert_eq!(bar_fraction(5, 0), 0.0);
        assert_eq!(bar_fraction(90, 60), 1.0);
        let r = Report {
            range: DateRange::day(d(2026, 10, 26)),
            grouping: ReportGrouping::Customer,
            rows: vec![
                crate::backend::ReportRow {
                    key: "a".into(),
                    label: "A".into(),
                    minutes: 120,
                    billable_minutes: 60,
                    amount: 85_000,
                },
                crate::backend::ReportRow {
                    key: "b".into(),
                    label: "B".into(),
                    minutes: 30,
                    billable_minutes: 30,
                    amount: 42_500,
                },
            ],
        };
        assert_eq!(totals(&r), (150, 90, 127_500));
    }

    #[test]
    fn klippekort_forbrug_i_perioden() {
        let card = PunchCard {
            id: "k".into(),
            customer_id: "c1".into(),
            name: "10 timer".into(),
            total_minutes: 600,
            used_minutes: 300,
            purchased: d(2026, 9, 1),
            expires: None,
            price: 0,
        };
        let e = |day, cust: &str, billable, minutes| Entry {
            id: format!("{cust}{day}"),
            customer_id: cust.into(),
            project_id: None,
            task_id: None,
            description: String::new(),
            date: d(2026, 10, day),
            start: None,
            end: None,
            minutes,
            billable,
            invoice_id: None,
        };
        let entries = vec![
            e(26, "c1", true, 60),
            e(27, "c1", false, 30),
            e(27, "c2", true, 45),
            e(10, "c1", true, 90),
        ];
        let r = week_range(d(2026, 10, 26));
        assert_eq!(card_usage_in(&card, &entries, r), 60);
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use std::sync::Arc;

    use gpui_kit::{AppContext as _, TestAppContext};

    use crate::backend::{BackendError, MockBackend};
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    #[gpui_kit::test]
    fn uge_maaned_gruppering_og_tabel(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Rapporter);
        p.assert_all_labelled(cx);
        p.assert_label(cx, "Uge 44, 2026");
        let a = p.a11y(cx);
        assert_eq!(a.count("Table"), 1);
        assert_eq!(a.count("ColumnHeader"), 4);
        assert!(a.count("Row") >= 2, "hoved + rækker");
        assert_eq!(a.count("Image"), 1, "diagrammet");
        p.click(cx, "rapport-forrige");
        p.assert_label(cx, "Uge 43, 2026");
        p.click(cx, "rapport-periode-1");
        p.assert_label(cx, "Oktober 2026");
        p.click(cx, "rapport-gruppering-2");
        p.assert_label(cx, "Tid pr. dag");
        p.assert_label(cx, "Klippekort-forbrug");
    }

    #[gpui_kit::test]
    fn valgfri_periode_valideres(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Rapporter);
        p.click(cx, "rapport-periode-2");
        p.assert_label(cx, "Fra dato");
        p.assert_label(cx, "01.10.2026-26.10.2026");
        let s = p.screen::<super::RapporterScreen>(cx, Screen::Rapporter);
        cx.update_window(p.handle, |_, window, cx| {
            s.update(cx, |s, cx| {
                s.custom_from
                    .update(cx, |i, cx| i.set_value("30.10.2026", window, cx))
            })
        })
        .unwrap();
        p.click(cx, "rapport-vis");
        p.assert_label(cx, "Til-datoen ligger før fra-datoen");
    }

    #[gpui_kit::test]
    fn csv_eksport(cx: &mut TestAppContext) {
        let dir = std::env::temp_dir().join(format!("tt-export-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = open(cx, testing::mock(), Screen::Rapporter);
        // SAFETY: alle tests, der eksporterer, sætter samme mappe.
        unsafe { std::env::set_var("TT_EXPORT_DIR", &dir) };
        p.click(cx, "rapport-csv");
        p.assert_label(cx, "CSV gemt");
        let f = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .find(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("timetrack-rapport")
            })
            .expect("csv skrevet");
        let text = std::fs::read_to_string(f.path()).unwrap();
        std::fs::remove_file(f.path()).ok();
        assert!(text.contains("Kunde;Timer"));
    }

    #[gpui_kit::test]
    fn tom_og_fejl(cx: &mut TestAppContext) {
        let p = open(
            cx,
            Arc::new(MockBackend::empty(testing::today())),
            Screen::Rapporter,
        );
        p.assert_label(cx, "Ingen tid i perioden");
        let mock = testing::mock();
        mock.set_failure(Some(BackendError::Offline));
        let p = open(cx, mock, Screen::Rapporter);
        p.assert_label(cx, "Fejl: Du er offline");
    }
}
