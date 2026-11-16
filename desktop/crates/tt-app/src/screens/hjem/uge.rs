//! Hjem → "Denne uge" og "Over budget" (som 0.2's WeekSummary og
//! OverBudgetProjects): ugens total med forskellen til sidste uge og en
//! søjle pr. dag, og projekter, der har brugt mere end budgettet.

use chrono::{Datelike as _, Days, NaiveDate};
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::*;

use super::{HjemScreen, Snapshot};
use crate::backend::{Backend, DateRange, Entry, Project, ProjectStatus, ReportGrouping};
use crate::brand::Brand;
use crate::i18n::{t, tf};
use crate::ui::{self, format};

/// Et projekt over budget.
#[derive(Clone, Debug, PartialEq)]
pub struct OverBudget {
    pub project_id: String,
    pub project: String,
    pub customer_id: String,
    pub used_minutes: u32,
    pub budget_minutes: u32,
}

impl OverBudget {
    pub fn percent(&self) -> u32 {
        (self.used_minutes as u64 * 100 / self.budget_minutes.max(1) as u64) as u32
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct WeekStats {
    /// Mandag først.
    pub days: [u32; 7],
    pub last_week_total: u32,
    pub over_budget: Vec<OverBudget>,
}

impl WeekStats {
    pub fn total(&self) -> u32 {
        self.days.iter().sum()
    }
}

pub fn monday(d: NaiveDate) -> NaiveDate {
    d - Days::new(d.weekday().num_days_from_monday() as u64)
}

/// Minutter pr. ugedag for posterne i ugen, der starter `monday`.
pub fn per_day(entries: &[Entry], monday: NaiveDate) -> [u32; 7] {
    let mut days = [0u32; 7];
    for e in entries {
        let i = (e.date - monday).num_days();
        if (0..7).contains(&i) {
            days[i as usize] += e.minutes;
        }
    }
    days
}

/// Projekter med budget, der har brugt mere end 100 % (som 0.2), mest over først.
pub fn over_budget(projects: &[Project], used: impl Fn(&str) -> u32) -> Vec<OverBudget> {
    let mut v: Vec<OverBudget> = projects
        .iter()
        .filter(|p| p.status != ProjectStatus::Archived)
        .filter_map(|p| {
            let budget = p.budget_minutes.filter(|b| *b > 0)?;
            let used = used(&p.id);
            (used > budget).then(|| OverBudget {
                project_id: p.id.clone(),
                project: p.name.clone(),
                customer_id: p.customer_id.clone(),
                used_minutes: used,
                budget_minutes: budget,
            })
        })
        .collect();
    v.sort_by_key(|o| std::cmp::Reverse(o.percent()));
    v
}

/// Hent ugens tal. Budgettet tjekkes kun, hvis et projekt har et budget
/// (det kræver alle projektets poster).
pub fn load(b: &dyn Backend, today: NaiveDate, projects: &[Project]) -> crate::backend::Result<WeekStats> {
    let mon = monday(today);
    let last_mon = mon - Days::new(7);
    let entries = b.entries(DateRange { from: last_mon, to: mon + Days::new(6) })?;
    let days = per_day(&entries, mon);
    let last_week_total = per_day(&entries, last_mon).iter().sum();
    let budgeted = projects
        .iter()
        .any(|p| p.budget_minutes.is_some_and(|m| m > 0) && p.status != ProjectStatus::Archived);
    let over = if budgeted {
        let from = NaiveDate::from_ymd_opt(2000, 1, 1).expect("gyldig dato");
        let r = b.report(DateRange { from, to: today }, ReportGrouping::Project)?;
        over_budget(projects, |id| r.rows.iter().find(|row| row.key == id).map_or(0, |row| row.minutes))
    } else {
        vec![]
    };
    Ok(WeekStats { days, last_week_total, over_budget: over })
}

impl HjemScreen {
    pub(super) fn render_week(&self, d: &Snapshot, b: &Brand) -> impl IntoElement {
        let w = &d.week;
        let total = w.total();
        let diff = total as i64 - w.last_week_total as i64;
        let max = w.days.iter().copied().max().unwrap_or(0).max(1);
        let mon = monday(d.today);
        let diff_text = if diff == 0 {
            t("gendan.hjem.same_as_last").to_string()
        } else {
            let sign = if diff > 0 { "+" } else { "−" };
            tf(
                "gendan.hjem.vs_last",
                &[("diff", &format!("{sign}{}", format::hours(diff.unsigned_abs() as u32)))],
            )
        };
        let bars = h_flex().gap_2().items_end().h(px(72.)).children((0..7).map(|i| {
            let day = mon + Days::new(i as u64);
            let m = w.days[i];
            let pct = if m == 0 { 0.03 } else { (m as f32 / max as f32).max(0.08) };
            let color = if day == d.today {
                b.primary
            } else if m > 0 {
                b.primary.opacity(0.4)
            } else {
                b.border
            };
            v_flex()
                .flex_1()
                .h_full()
                .justify_end()
                .items_center()
                .gap_1()
                .child(div().w_full().h(relative(pct * 0.8)).rounded(px(3.)).bg(color))
                .child(div().text_xs().text_color(b.grey).child(format::weekday_short(day.weekday())))
        }));
        let summary = tf(
            "gendan.hjem.week_label",
            &[("total", &format::hours(total)), ("diff", &diff_text)],
        );
        ui::card(b, "uge", summary)
            .child(
                h_flex()
                    .justify_between()
                    .items_center()
                    .child(ui::heading(b, "uge-titel", t("gendan.hjem.week"), 2))
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(
                                ui::text("uge-total", format::hours(total))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(b.ink),
                            )
                            .child(ui::muted(b, "uge-forskel", diff_text).text_xs()),
                    ),
            )
            .child(bars)
    }

    pub(super) fn render_over_budget(&self, d: &Snapshot, b: &Brand) -> Option<AnyElement> {
        if d.week.over_budget.is_empty() {
            return None;
        }
        let rows = d.week.over_budget.iter().enumerate().map(|(i, o)| {
            let label = tf(
                "gendan.hjem.over_row",
                &[
                    ("project", &o.project),
                    ("customer", &d.customer_name(&o.customer_id)),
                    ("used", &format::hours(o.used_minutes)),
                    ("budget", &format::hours(o.budget_minutes)),
                    ("percent", &o.percent().to_string()),
                ],
            );
            let tone = if o.percent() >= 150 { b.danger } else { b.warning };
            ui::list_row(b, ("over-budget", i), label)
                .child(div().flex_1().min_w_0().truncate().child(format!(
                    "{} · {}",
                    d.customer_name(&o.customer_id),
                    o.project
                )))
                .child(div().text_sm().text_color(b.grey).child(tf(
                    "gendan.hjem.over_hours",
                    &[("used", &format::hours(o.used_minutes)), ("budget", &format::hours(o.budget_minutes))],
                )))
                .child(
                    div()
                        .w(px(56.))
                        .text_right()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(tone)
                        .child(format!("{} %", o.percent())),
                )
        });
        Some(
            ui::titled_card(b, "over-budget", t("gendan.hjem.over_title"), div())
                .child(ui::list("over-budget-liste", t("gendan.hjem.over_title")).children(rows))
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::{monday, over_budget, per_day};
    use crate::backend::{Entry, Project, ProjectStatus};

    fn d(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, day).unwrap()
    }

    fn entry(day: u32, minutes: u32) -> Entry {
        Entry {
            id: format!("{day}-{minutes}"),
            customer_id: "k".into(),
            project_id: None,
            task_id: None,
            description: String::new(),
            date: d(day),
            start: None,
            end: None,
            minutes,
            billable: true,
            invoice_id: None,
        }
    }

    fn project(id: &str, budget: Option<u32>, status: ProjectStatus) -> Project {
        Project {
            id: id.into(),
            customer_id: "k".into(),
            name: id.into(),
            status,
            hourly_rate: None,
            budget_minutes: budget,
            url_patterns: vec![],
        }
    }

    #[test]
    fn uge_fra_mandag() {
        assert_eq!(monday(d(27)), d(26)); // tirsdag → mandag
        assert_eq!(monday(d(26)), d(26));
        assert_eq!(monday(NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()), d(26)); // søndag
        let days = per_day(&[entry(26, 60), entry(26, 30), entry(28, 45), entry(25, 600)], d(26));
        assert_eq!(days, [90, 0, 45, 0, 0, 0, 0], "søndagen før tæller ikke");
    }

    #[test]
    fn over_budget_er_strengt_over_hundrede_procent() {
        let projects = vec![
            project("praecis", Some(600), ProjectStatus::Active),
            project("over", Some(600), ProjectStatus::Active),
            project("langt", Some(60), ProjectStatus::Completed),
            project("arkiv", Some(60), ProjectStatus::Archived),
            project("uden", None, ProjectStatus::Active),
        ];
        let used = |id: &str| match id {
            "praecis" => 600,
            "over" => 660,
            _ => 6000,
        };
        let v = over_budget(&projects, used);
        let ids: Vec<&str> = v.iter().map(|o| o.project_id.as_str()).collect();
        assert_eq!(ids, ["langt", "over"], "mest over først, arkiverede og uden budget springes over");
        assert_eq!(v[1].percent(), 110);
    }
}
