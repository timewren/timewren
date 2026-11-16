//! Rapporter: tid pr. kunde, projekt og periode, samt CSV-eksport. Regnes
//! på klienten ud fra posterne i perioden, så samme kode bruges i begge
//! tilstande.
//
// Web har `extension.reports.get({ config })` (web's rapportskabelon), men
// CloudRepo regner selv ud fra posterne, så tallene er de samme i begge
// tilstande. Skiftes der til web's aggregater, skal svaret mappes til
// `Report`.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;

use crate::model::*;

/// Navne til rækkerne (id → navn).
#[derive(Debug, Default)]
pub struct Names {
    pub clients: BTreeMap<Id, String>,
    pub projects: BTreeMap<Id, (String, Option<Id>)>,
}

impl Names {
    pub fn new(clients: &[Client], projects: &[Project]) -> Self {
        Names {
            clients: clients.iter().map(|c| (c.id.clone(), c.name.clone())).collect(),
            projects: projects
                .iter()
                .map(|p| (p.id.clone(), (p.name.clone(), p.client_id.clone())))
                .collect(),
        }
    }

    fn client_of(&self, e: &TimeEntry) -> Option<Id> {
        e.client_id.clone().or_else(|| {
            e.project_id.as_ref().and_then(|p| self.projects.get(p)).and_then(|(_, c)| c.clone())
        })
    }
}

pub fn build_report(query: &ReportQuery, entries: &[TimeEntry], names: &Names) -> Report {
    let mut rows: BTreeMap<String, ReportRow> = BTreeMap::new();
    let mut report = Report {
        start_date: query.start_date,
        end_date: query.end_date,
        grouping: query.grouping,
        ..Report::default()
    };
    for e in entries {
        if e.date < query.start_date || e.date > query.end_date {
            continue;
        }
        let client = names.client_of(e);
        if query.client_id.is_some() && client != query.client_id {
            continue;
        }
        if query.project_id.is_some() && e.project_id != query.project_id {
            continue;
        }
        let (key, label) = group_key(query.grouping, e, client.as_ref(), names);
        let billable = e.is_billable.unwrap_or(true);
        let amount = if billable { e.hours * e.billable_rate.unwrap_or_default() } else { Decimal::ZERO };
        let row = rows.entry(key.clone()).or_insert_with(|| ReportRow {
            key,
            label,
            ..ReportRow::default()
        });
        row.hours += e.hours;
        row.entry_count += 1;
        if billable {
            row.billable_hours += e.hours;
        }
        row.amount += amount;
        report.total_hours += e.hours;
        if billable {
            report.billable_hours += e.hours;
        }
        report.total_amount += amount;
    }
    report.rows = rows
        .into_values()
        .map(|mut r| {
            r.amount = r.amount.round_dp(2);
            r
        })
        .collect();
    if matches!(query.grouping, ReportGrouping::Client | ReportGrouping::Project) {
        report.rows.sort_by(|a, b| b.hours.cmp(&a.hours).then_with(|| a.label.cmp(&b.label)));
    }
    report.total_amount = report.total_amount.round_dp(2);
    report
}

fn group_key(
    grouping: ReportGrouping,
    e: &TimeEntry,
    client: Option<&Id>,
    names: &Names,
) -> (String, String) {
    match grouping {
        ReportGrouping::Client => match client {
            Some(c) => (c.clone(), names.clients.get(c).cloned().unwrap_or_else(|| "Ukendt kunde".into())),
            None => ("-".into(), "Uden kunde".into()),
        },
        ReportGrouping::Project => match &e.project_id {
            Some(p) => (
                p.clone(),
                names.projects.get(p).map(|(n, _)| n.clone()).unwrap_or_else(|| "Ukendt projekt".into()),
            ),
            None => ("-".into(), "Uden projekt".into()),
        },
        ReportGrouping::Day => {
            let k = e.date.format("%Y-%m-%d").to_string();
            (k.clone(), e.date.format("%d-%m-%Y").to_string())
        }
        ReportGrouping::Week => {
            let w = e.date.iso_week();
            (format!("{}-W{:02}", w.year(), w.week()), format!("Uge {} {}", w.week(), w.year()))
        }
        ReportGrouping::Month => {
            let k = format!("{}-{:02}", e.date.year(), e.date.month());
            (k, format!("{} {}", MONTHS[e.date.month0() as usize], e.date.year()))
        }
    }
}

const MONTHS: [&str; 12] = [
    "januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september",
    "oktober", "november", "december",
];

/// Dansk tal med komma ("1,50").
fn da(d: Decimal) -> String {
    format!("{:.2}", d.round_dp(2)).replace('.', ",")
}

fn csv_field(s: &str) -> String {
    if s.contains([';', '"', '\n']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_owned()
    }
}

/// CSV med semikolon og decimal-komma (dansk Excel), UTF-8 med BOM.
pub fn report_csv(report: &Report) -> String {
    let mut out = String::from("\u{feff}Gruppe;Timer;Fakturerbare timer;Beløb;Poster\n");
    for r in &report.rows {
        out.push_str(&format!(
            "{};{};{};{};{}\n",
            csv_field(&r.label),
            da(r.hours),
            da(r.billable_hours),
            da(r.amount),
            r.entry_count
        ));
    }
    out.push_str(&format!(
        "I alt;{};{};{};{}\n",
        da(report.total_hours),
        da(report.billable_hours),
        da(report.total_amount),
        report.rows.iter().map(|r| r.entry_count).sum::<i64>()
    ));
    out
}

pub fn period_label(start: NaiveDate, end: NaiveDate) -> String {
    format!("{} - {}", start.format("%d-%m-%Y"), end.format("%d-%m-%Y"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(date: (i32, u32, u32), hours: &str, project: &str, rate: &str, billable: bool) -> TimeEntry {
        TimeEntry {
            id: uuid::Uuid::new_v4().to_string(),
            date: NaiveDate::from_ymd_opt(date.0, date.1, date.2).unwrap(),
            hours: hours.parse().unwrap(),
            project_id: Some(project.into()),
            billable_rate: Some(rate.parse().unwrap()),
            is_billable: Some(billable),
            ..Default::default()
        }
    }

    #[test]
    fn groups_by_client_via_project() {
        let clients = vec![Client { id: "c1".into(), name: "Bageriet på hjørnet".into(), ..Default::default() }];
        let projects = vec![
            Project { id: "p1".into(), name: "Webshop".into(), client_id: Some("c1".into()), ..Default::default() },
            Project { id: "p2".into(), name: "Intern".into(), ..Default::default() },
        ];
        let names = Names::new(&clients, &projects);
        let entries = vec![
            entry((2026, 10, 26), "1.5", "p1", "800", true),
            entry((2026, 10, 27), "2", "p1", "800", false),
            entry((2026, 10, 27), "1", "p2", "0", true),
            entry((2026, 11, 1), "9", "p1", "800", true),
        ];
        let q = ReportQuery {
            start_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 10, 31).unwrap(),
            grouping: ReportGrouping::Client,
            ..Default::default()
        };
        let r = build_report(&q, &entries, &names);
        assert_eq!(r.rows.len(), 2);
        assert_eq!(r.rows[0].label, "Bageriet på hjørnet");
        assert_eq!(r.rows[0].hours, "3.5".parse().unwrap());
        assert_eq!(r.rows[0].billable_hours, "1.5".parse().unwrap());
        assert_eq!(r.rows[0].amount, "1200".parse().unwrap());
        assert_eq!(r.total_hours, "4.5".parse().unwrap());
        let csv = report_csv(&r);
        assert!(csv.contains("Bageriet på hjørnet;3,50;1,50;1200,00;2"));
        assert!(csv.contains("I alt;4,50;2,50;1200,00;3"));
    }

    #[test]
    fn groups_by_week_and_month() {
        let names = Names::default();
        let entries = vec![entry((2026, 10, 26), "1", "p", "0", true), entry((2026, 11, 2), "1", "p", "0", true)];
        let mut q = ReportQuery {
            start_date: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 11, 30).unwrap(),
            grouping: ReportGrouping::Week,
            ..Default::default()
        };
        let r = build_report(&q, &entries, &names);
        assert_eq!(r.rows.iter().map(|r| r.key.as_str()).collect::<Vec<_>>(), ["2026-W44", "2026-W45"]);
        q.grouping = ReportGrouping::Month;
        let r = build_report(&q, &entries, &names);
        assert_eq!(r.rows[0].label, "oktober 2026");
    }
}
