//! Rapporter: momsoverblik pr. kvartal og CSV af rå poster og moms med
//! valgfri separator og datoformat (som 0.2's ReportView og Eksport).

use chrono::{Datelike as _, Months, NaiveDate};
use gpui_kit::component::button::Button;
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::*;

use super::RapporterScreen;
use crate::ui::Icon;
use crate::backend::{
    Customer, DateRange, Entry, ExportSettings, Invoice, InvoiceStatus, Project, Settings,
};
use crate::brand::Brand;
use crate::export;
use crate::i18n::{t, tf};
use crate::ui::{self, format};

/// Kvartalet, `d` ligger i.
pub fn quarter_of(d: NaiveDate) -> DateRange {
    let q0 = (d.month0() / 3) * 3 + 1;
    let from = NaiveDate::from_ymd_opt(d.year(), q0, 1).expect("gyldig dato");
    let to = from + Months::new(3) - chrono::Days::new(1);
    DateRange { from, to }
}

/// Én momssats i overblikket.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VatRow {
    pub permille: u32,
    /// Momsgrundlag i øre (beløb ekskl. moms).
    pub base: i64,
    pub vat: i64,
    pub invoices: u32,
}

/// Udstedte fakturaer (ikke kladder) med fakturadato i perioden, pr. sats.
/// Fakturaer uden kendt momssats (cloud, se `Invoice::vat_permille`) er ikke
/// med; dem tæller `vat_unknown`.
pub fn vat_summary(invoices: &[Invoice], range: DateRange) -> Vec<VatRow> {
    let mut rows: Vec<VatRow> = vec![];
    for i in issued_in(invoices, range) {
        let (Some(permille), Some(vat)) = (i.vat_permille, i.vat()) else {
            continue;
        };
        match rows.iter_mut().find(|r| r.permille == permille) {
            Some(r) => {
                r.base += i.subtotal();
                r.vat += vat;
                r.invoices += 1;
            }
            None => rows.push(VatRow { permille, base: i.subtotal(), vat, invoices: 1 }),
        }
    }
    rows.sort_by_key(|r| std::cmp::Reverse(r.permille));
    rows
}

/// Udstedte fakturaer i perioden, hvor web afgør momsen (cloud).
pub fn vat_unknown(invoices: &[Invoice], range: DateRange) -> usize {
    issued_in(invoices, range).filter(|i| i.vat_permille.is_none()).count()
}

fn issued_in(invoices: &[Invoice], range: DateRange) -> impl Iterator<Item = &Invoice> {
    invoices
        .iter()
        .filter(move |i| i.status != InvoiceStatus::Draft && range.contains(i.issued))
}

struct Csv {
    sep: char,
    iso: bool,
}

impl Csv {
    fn new(f: ExportSettings) -> Self {
        Csv { sep: if f.comma { ',' } else { ';' }, iso: f.iso_dates }
    }
    fn field(&self, s: &str) -> String {
        let s = &*export::no_formula(s);
        if s.contains([self.sep, '"', '\n', '\r']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    }
    fn date(&self, d: NaiveDate) -> String {
        if self.iso { d.format("%Y-%m-%d").to_string() } else { d.format("%d-%m-%Y").to_string() }
    }
    /// Komma som decimaltegn med semikolon, ellers punktum.
    fn num(&self, s: String) -> String {
        if self.sep == ',' { s.replace(',', ".") } else { s }
    }
    fn row(&self, out: &mut String, cells: &[String]) {
        out.push_str(&cells.join(&self.sep.to_string()));
        out.push_str("\r\n");
    }
}

/// Timepris for en post: projektets, ellers kundens, ellers 0 (øre/time).
fn rate_of(e: &Entry, customers: &[Customer], projects: &[Project]) -> i64 {
    e.project_id
        .as_deref()
        .and_then(|p| projects.iter().find(|x| x.id == p))
        .and_then(|p| p.hourly_rate)
        .or_else(|| customers.iter().find(|c| c.id == e.customer_id).and_then(|c| c.hourly_rate))
        .unwrap_or(0)
}

/// Periodens poster som CSV: Dato, Kunde, Projekt, Beskrivelse, Start, Slut,
/// Timer, Timepris og Beløb (0 for ikke-fakturerbare). BOM og CRLF til Excel.
pub fn entries_csv(entries: &[Entry], customers: &[Customer], projects: &[Project], f: ExportSettings) -> String {
    let c = Csv::new(f);
    let mut out = String::from("\u{feff}");
    let head: Vec<String> = [
        "gendan.rapporter.csv_date",
        "gendan.rapporter.csv_customer",
        "gendan.rapporter.csv_project",
        "gendan.rapporter.csv_description",
        "gendan.rapporter.csv_start",
        "gendan.rapporter.csv_end",
        "gendan.rapporter.csv_hours",
        "gendan.rapporter.csv_rate",
        "gendan.rapporter.csv_amount",
    ]
    .iter()
    .map(|k| t(k).to_string())
    .collect();
    c.row(&mut out, &head);
    let mut sorted: Vec<&Entry> = entries.iter().collect();
    sorted.sort_by_key(|e| (e.date, e.start));
    for e in sorted {
        let rate = rate_of(e, customers, projects);
        let amount = if e.billable { (rate * e.minutes as i64 + 30) / 60 } else { 0 };
        let customer = customers.iter().find(|x| x.id == e.customer_id).map_or("", |x| x.name.as_str());
        let project = e
            .project_id
            .as_deref()
            .and_then(|p| projects.iter().find(|x| x.id == p))
            .map_or("", |p| p.name.as_str());
        let time = |t: Option<chrono::NaiveTime>| t.map(|t| t.format("%H:%M").to_string()).unwrap_or_default();
        c.row(
            &mut out,
            &[
                c.date(e.date),
                c.field(customer),
                c.field(project),
                c.field(&e.description),
                time(e.start),
                time(e.end),
                c.num(export::hours_fixed(e.minutes)),
                c.num(export::kroner_plain(rate)),
                c.num(export::kroner_plain(amount)),
            ],
        );
    }
    out
}

/// Momsoverblikket som CSV (0.2's form): periode, en linje pr. sats, total
/// og salgsmomsen, der skal indberettes.
pub fn vat_csv(rows: &[VatRow], range: DateRange, f: ExportSettings) -> String {
    let c = Csv::new(f);
    let mut out = String::from("\u{feff}");
    c.row(&mut out, &[t("gendan.rapporter.vat_title").to_string()]);
    c.row(&mut out, &[t("gendan.rapporter.csv_period").to_string(), c.date(range.from), c.date(range.to)]);
    out.push_str("\r\n");
    c.row(
        &mut out,
        &[
            t("gendan.rapporter.csv_rate_pct").to_string(),
            t("gendan.rapporter.csv_base").to_string(),
            t("gendan.rapporter.csv_vat").to_string(),
            t("gendan.rapporter.csv_count").to_string(),
        ],
    );
    let (mut base, mut vat, mut n) = (0i64, 0i64, 0u32);
    for r in rows {
        c.row(
            &mut out,
            &[
                format!("{}%", c.num(export::vat_percent(r.permille))),
                c.num(export::kroner_plain(r.base)),
                c.num(export::kroner_plain(r.vat)),
                r.invoices.to_string(),
            ],
        );
        base += r.base;
        vat += r.vat;
        n += r.invoices;
    }
    out.push_str("\r\n");
    c.row(
        &mut out,
        &[
            t("gendan.rapporter.csv_total").to_string(),
            c.num(export::kroner_plain(base)),
            c.num(export::kroner_plain(vat)),
            n.to_string(),
        ],
    );
    c.row(&mut out, &[t("gendan.rapporter.csv_to_report").to_string(), c.num(export::kroner_plain(vat))]);
    out
}

/// "4. kvartal 2026".
pub fn quarter_label(q: DateRange) -> String {
    tf(
        "gendan.rapporter.quarter",
        &[("q", &(q.from.month0() / 3 + 1).to_string()), ("year", &q.from.year().to_string())],
    )
}

impl RapporterScreen {
    fn write(&mut self, name: String, csv: String, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            move |_| {
                export::write_unique(&export::export_dir(), &name, csv.as_bytes())
                    .map_err(|e| crate::backend::BackendError::Other(e.to_string()))
            },
            |this, res, cx| {
                match res {
                    Ok(p) => {
                        this.notice = Some((
                            tf("rapporter.notice.csv_saved", &[("path", &p.display().to_string())]).into(),
                            false,
                        ));
                        this.last_file = Some(p);
                    }
                    Err(e) => {
                        this.notice =
                            Some((tf("rapporter.notice.csv_failed", &[("error", &e.to_string())]).into(), true))
                    }
                }
                cx.notify();
            },
        );
    }

    pub(super) fn export_entries(&mut self, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else { return };
        let csv = entries_csv(&d.entries, &d.customers, &d.projects, d.export);
        let name = format!("{}-poster-{}-{}.csv", tt_core::edition::EDITION.id, self.range.from, self.range.to);
        self.write(name, csv, cx);
    }

    pub(super) fn export_vat(&mut self, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else { return };
        let q = quarter_of(self.vat_quarter);
        let csv = vat_csv(&vat_summary(&d.invoices, q), q, d.export);
        self.write(format!("moms-{}-{}.csv", q.from, q.to), csv, cx);
    }

    fn set_export(&mut self, f: impl FnOnce(&mut ExportSettings) + Send + 'static, cx: &mut Context<Self>) {
        if let crate::ui::Loadable::Ready(d) = &mut self.data {
            f(&mut d.export);
            let export = d.export;
            self.ctx.mutate(
                cx,
                move |b| {
                    let s = b.settings()?;
                    b.save_settings(Settings { export, ..s }).map(|_| ())
                },
                |_, _, _| {},
            );
        }
        cx.notify();
    }

    pub(super) fn render_gendan(&self, b: &Brand, d: &super::Data, cx: &mut Context<Self>) -> AnyElement {
        let q = quarter_of(self.vat_quarter);
        let rows = vat_summary(&d.invoices, q);
        let total_vat: i64 = rows.iter().map(|r| r.vat).sum();
        let weak = cx.entity().downgrade();
        let w2 = weak.clone();
        let sep = crate::ui::forms::segmented(
            b,
            "rapport-separator",
            t("gendan.rapporter.separator"),
            &[t("gendan.rapporter.semicolon"), t("gendan.rapporter.comma")],
            d.export.comma as usize,
            move |i, _, cx| {
                let _ = weak.update(cx, |this, cx| this.set_export(move |e| e.comma = i == 1, cx));
            },
        );
        let dates = crate::ui::forms::segmented(
            b,
            "rapport-datoformat",
            t("gendan.rapporter.date_format"),
            &["DD-MM-ÅÅÅÅ", "ÅÅÅÅ-MM-DD"],
            d.export.iso_dates as usize,
            move |i, _, cx| {
                let _ = w2.update(cx, |this, cx| this.set_export(move |e| e.iso_dates = i == 1, cx));
            },
        );
        let vat_rows = rows.iter().enumerate().map(|(i, r)| {
            let label = tf(
                "gendan.rapporter.vat_row",
                &[
                    ("pct", &export::vat_percent(r.permille)),
                    ("base", &export::kroner(r.base)),
                    ("vat", &export::kroner(r.vat)),
                    ("n", &r.invoices.to_string()),
                ],
            );
            ui::list_row(b, ("moms-sats", i), label.clone()).child(div().flex_1().child(label))
        });
        let unknown = vat_unknown(&d.invoices, q);
        let vat_body: AnyElement = if rows.is_empty() && unknown > 0 {
            // Cloud: momsen afgøres af firmaprofilen i web.
            ui::muted(
                b,
                "moms-web",
                tf("gendan.rapporter.vat_web", &[("n", &unknown.to_string())]),
            )
            .into_any_element()
        } else if rows.is_empty() {
            ui::muted(b, "moms-ingen", t("gendan.rapporter.vat_none")).into_any_element()
        } else {
            v_flex()
                .gap_1()
                .child(ui::list("moms-liste", t("gendan.rapporter.vat_title")).children(vat_rows))
                .child(
                    ui::text(
                        "moms-indberet",
                        tf("gendan.rapporter.vat_to_report", &[("vat", &export::kroner(total_vat))]),
                    )
                    .font_weight(FontWeight::SEMIBOLD),
                )
                .into_any_element()
        };
        v_flex()
            .gap_4()
            .child(
                ui::card(b, "moms", t("gendan.rapporter.vat_title"))
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(ui::heading(
                                b,
                                "moms-titel",
                                tf("gendan.rapporter.vat_heading", &[("quarter", &quarter_label(q))]),
                                2,
                            ))
                            .child(
                                h_flex()
                                    .gap_1()
                                    .child(
                                        Button::new("moms-forrige")
                                            .label("‹")
                                            .small()
                                            .outline()
                                            .accessibility_label(t("gendan.rapporter.prev_quarter"))
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.vat_quarter = this.vat_quarter - Months::new(3);
                                                cx.notify();
                                            })),
                                    )
                                    .child(
                                        Button::new("moms-naeste")
                                            .label("›")
                                            .small()
                                            .outline()
                                            .accessibility_label(t("gendan.rapporter.next_quarter"))
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.vat_quarter = this.vat_quarter + Months::new(3);
                                                cx.notify();
                                            })),
                                    ),
                            ),
                    )
                    .child(ui::muted(
                        b,
                        "moms-periode",
                        tf(
                            "gendan.rapporter.vat_period",
                            &[("from", &format::date_short(q.from)), ("to", &format::date_short(q.to))],
                        ),
                    ))
                    .child(vat_body)
                    .child(
                        h_flex().child(
                            Button::new("moms-csv")
                                .icon(Icon::Download)
                                .label(t("gendan.rapporter.export_vat"))
                                .small()
                                .on_click(cx.listener(|this, _, _, cx| this.export_vat(cx))),
                        ),
                    ),
            )
            .child(
                ui::card(b, "csv-poster", t("gendan.rapporter.raw_title"))
                    .child(ui::heading(b, "csv-poster-titel", t("gendan.rapporter.raw_title"), 2))
                    .child(ui::muted(b, "csv-poster-hjaelp", t("gendan.rapporter.raw_help")))
                    .child(
                        h_flex()
                            .gap_4()
                            .flex_wrap()
                            .items_center()
                            .child(sep)
                            .child(dates)
                            .child(
                                Button::new("rapport-csv-poster")
                                    .icon(Icon::Download)
                                    .label(t("gendan.rapporter.export_raw"))
                                    .small()
                                    .on_click(cx.listener(|this, _, _, cx| this.export_entries(cx))),
                            ),
                    ),
            )
            .into_any_element()
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use gpui_kit::TestAppContext;

    use super::super::RapporterScreen;
    use crate::backend::Backend as _;
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    #[gpui_kit::test]
    fn moms_og_raa_csv_med_valgt_format(cx: &mut TestAppContext) {
        let dir = std::env::temp_dir().join(format!("tt-export-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // SAFETY: alle tests, der eksporterer, sætter samme mappe.
        unsafe { std::env::set_var("TT_EXPORT_DIR", &dir) };
        let p = open(cx, testing::mock(), Screen::Rapporter);
        p.assert_label(cx, "Momsoverblik");
        p.assert_label(cx, "Alle poster som CSV");
        p.assert_all_labelled(cx);
        let screen = p.screen::<RapporterScreen>(cx, Screen::Rapporter);
        // Komma og ISO-datoer gemmes i indstillingerne.
        cx.update(|cx| screen.update(cx, |s, cx| s.set_export(|e| { e.comma = true; e.iso_dates = true }, cx)));
        p.settle(cx);
        assert!(p.mock.settings().unwrap().export.comma);
        cx.update(|cx| screen.update(cx, |s, cx| s.export_entries(cx)));
        p.settle(cx);
        p.assert_label(cx, "timetrack-poster-");
        let newest = |prefix: &str| {
            std::fs::read_dir(&dir)
                .unwrap()
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with(prefix))
                .max_by_key(|p| std::fs::metadata(p).unwrap().modified().unwrap())
                .expect(prefix)
        };
        let csv = std::fs::read_to_string(newest("timetrack-poster-")).unwrap();
        assert!(csv.contains("Dato,Kunde,Projekt"), "komma som separator");
        cx.update(|cx| screen.update(cx, |s, cx| s.export_vat(cx)));
        p.settle(cx);
        let moms = std::fs::read_to_string(newest("moms-")).unwrap();
        assert!(moms.contains("At indberette (salgsmoms)"));
    }
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, NaiveTime};

    use super::{entries_csv, quarter_of, vat_csv, vat_summary};
    use crate::backend::{
        Customer, DateRange, Entry, ExportSettings, Invoice, InvoiceLine, InvoiceStatus, Project,
        ProjectStatus,
    };

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    fn inv(status: InvoiceStatus, issued: NaiveDate, minutes: u32, permille: u32) -> Invoice {
        Invoice {
            id: format!("{issued}{minutes}"),
            number: Some(1),
            customer_id: "k".into(),
            status,
            issued,
            due: issued,
            lines: vec![InvoiceLine { description: "x".into(), minutes, rate: 100_000, entry_ids: vec![], stored: None }],
            lines_loaded: true,
            subtotal_hint: 0,
            vat_permille: Some(permille),
            number_text: None,
            title: None,
            delivery: None,
            notes: None,
        }
    }

    #[test]
    fn kvartaler() {
        assert_eq!(quarter_of(d(10, 27)), DateRange { from: d(10, 1), to: d(12, 31) });
        assert_eq!(quarter_of(d(2, 28)), DateRange { from: d(1, 1), to: d(3, 31) });
        assert_eq!(quarter_of(d(6, 30)).to, d(6, 30));
    }

    #[test]
    fn moms_kun_udstedte_i_perioden() {
        let q = quarter_of(d(10, 27));
        let invoices = vec![
            inv(InvoiceStatus::Sent, d(10, 5), 60, 250),   // 1.000 kr.
            inv(InvoiceStatus::Paid, d(11, 5), 120, 250),  // 2.000 kr.
            inv(InvoiceStatus::Draft, d(10, 6), 600, 250), // kladde tæller ikke
            inv(InvoiceStatus::Sent, d(9, 30), 600, 250),  // forrige kvartal
        ];
        let rows = vat_summary(&invoices, q);
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].base, rows[0].vat, rows[0].invoices), (300_000, 75_000, 2));
        let csv = vat_csv(&rows, q, ExportSettings::default());
        let lines: Vec<&str> = csv.trim_start_matches('\u{feff}').split("\r\n").collect();
        assert_eq!(lines[0], "Momsoverblik");
        assert_eq!(lines[1], "Periode;01-10-2026;31-12-2026");
        assert_eq!(lines[3], "Momssats;Momsgrundlag;Salgsmoms;Antal fakturaer");
        assert_eq!(lines[4], "25%;3000,00;750,00;2");
        assert_eq!(lines[6], "I alt;3000,00;750,00;2");
        assert_eq!(lines[7], "At indberette (salgsmoms);750,00");
        // Komma og ISO-datoer: decimalpunktum.
        let csv = vat_csv(&rows, q, ExportSettings { comma: true, iso_dates: true });
        assert!(csv.contains("Periode,2026-10-01,2026-12-31"));
        assert!(csv.contains("25%,3000.00,750.00,2"));
    }

    #[test]
    fn raa_poster_med_timepris_og_format() {
        let customers = vec![Customer {
            id: "k".into(),
            name: "Bageriet; ApS".into(),
            email: None,
            hourly_rate: Some(80_000),
            archived: false,
            cvr: None,
            ..Default::default()
        }];
        let projects = vec![Project {
            id: "p".into(),
            customer_id: "k".into(),
            name: "Webshop".into(),
            status: ProjectStatus::Active,
            hourly_rate: Some(90_000),
            budget_minutes: None,
            url_patterns: vec![],
        }];
        let e = |id: &str, project: Option<&str>, minutes: u32, billable: bool| Entry {
            id: id.into(),
            customer_id: "k".into(),
            project_id: project.map(Into::into),
            task_id: None,
            description: format!("Opgave {id}"),
            date: d(10, 27),
            start: NaiveTime::from_hms_opt(9, 0, 0),
            end: NaiveTime::from_hms_opt(10, 30, 0),
            minutes,
            billable,
            invoice_id: None,
        };
        let entries = vec![e("a", Some("p"), 90, true), e("b", None, 60, true), e("c", None, 60, false)];
        let csv = entries_csv(&entries, &customers, &projects, ExportSettings::default());
        let lines: Vec<&str> = csv.trim_start_matches('\u{feff}').split("\r\n").collect();
        assert_eq!(lines[0], "Dato;Kunde;Projekt;Beskrivelse;Start;Slut;Timer;Timepris;Beløb");
        assert_eq!(lines[1], "27-10-2026;\"Bageriet; ApS\";Webshop;Opgave a;09:00;10:30;1,50;900,00;1350,00");
        assert_eq!(lines[2], "27-10-2026;\"Bageriet; ApS\";;Opgave b;09:00;10:30;1,00;800,00;800,00");
        assert!(lines[3].ends_with(";1,00;800,00;0,00"), "ikke-fakturerbar har beløb 0");
        let csv = entries_csv(&entries, &customers, &projects, ExportSettings { comma: true, iso_dates: true });
        assert!(csv.contains("2026-10-27,Bageriet; ApS,Webshop,Opgave a,09:00,10:30,1.50,900.00,1350.00"));
    }
}
