//! Eksport uden GPUI: faktura som PDF, rapport som CSV, og kroner med "kr.".
//!
//! PDF'en skrives i hånden (PDF 1.4, Helvetica med WinAnsiEncoding, så æøå
//! virker uden indlejrede skrifter). Det dækker lokal tilstand; i cloud kan
//! web's PDF bruges i stedet, når `extension.invoicePdf` findes.

use crate::backend::{Invoice, InvoiceProfile, Report, ReportGrouping};
use crate::i18n::t;
use crate::ui::format;

/// Øre som "1.234,50 kr." (dansk retskrivning med punktum efter kr).
pub fn kroner(oere: i64) -> String {
    format!("{}.", format::money(oere))
}

/// Øre som tal med komma og uden tusindtalsskilletegn (til CSV): "1234,50".
pub fn kroner_plain(oere: i64) -> String {
    let neg = oere < 0;
    let o = oere.unsigned_abs();
    format!("{}{},{:02}", if neg { "-" } else { "" }, o / 100, o % 100)
}

/// Minutter som timer med komma og to decimaler (til CSV og PDF): 90 → "1,50".
pub fn hours_fixed(minutes: u32) -> String {
    let h = (minutes as u64 * 100 + 30) / 60;
    format!("{},{:02}", h / 100, h % 100)
}

// ---------- CSV ----------

/// Tekst, Excel ville køre som en formel (=, +, -, @), får et ' foran.
pub(crate) fn no_formula(s: &str) -> std::borrow::Cow<'_, str> {
    if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}").into()
    } else {
        s.into()
    }
}

pub(crate) fn csv_field(s: &str) -> String {
    let s = &*no_formula(s);
    if s.contains([';', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Rapport som CSV til dansk Excel: semikolon, decimalkomma, CRLF og BOM,
/// så æøå vises rigtigt.
pub fn report_csv(report: &Report) -> String {
    let group = match report.grouping {
        ReportGrouping::Customer => t("export.csv.customer"),
        ReportGrouping::Project => t("export.csv.project"),
        ReportGrouping::Day => t("export.csv.date"),
    };
    let mut out = String::from("\u{feff}");
    out.push_str(&format!(
        "{group};{};{};{};{}\r\n",
        t("export.csv.hours"),
        t("export.csv.billable_hours"),
        t("export.csv.non_billable_hours"),
        t("export.csv.amount"),
    ));
    let mut total = (0u32, 0u32, 0i64);
    for r in &report.rows {
        out.push_str(&format!(
            "{};{};{};{};{}\r\n",
            csv_field(&r.label),
            hours_fixed(r.minutes),
            hours_fixed(r.billable_minutes),
            hours_fixed(r.minutes.saturating_sub(r.billable_minutes)),
            kroner_plain(r.amount)
        ));
        total.0 += r.minutes;
        total.1 += r.billable_minutes;
        total.2 += r.amount;
    }
    out.push_str(&format!(
        "{};{};{};{};{}\r\n",
        t("export.csv.total"),
        hours_fixed(total.0),
        hours_fixed(total.1),
        hours_fixed(total.0.saturating_sub(total.1)),
        kroner_plain(total.2)
    ));
    out
}

/// Filnavn til rapporten: "timetrack-rapport-2026-10-19-2026-10-25.csv".
pub fn report_file_name(report: &Report) -> String {
    format!(
        "timetrack-rapport-{}-{}.csv",
        report.range.from, report.range.to
    )
}

// ---------- PDF ----------

/// Tegn → WinAnsi (cp1252). Ukendte tegn bliver "?".
fn win_ansi(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| match c as u32 {
            0x20..=0x7e => c as u8,
            0xa0..=0xff => c as u32 as u8,
            _ => match c {
                '€' => 0x80,
                '…' => 0x85,
                '‘' => 0x91,
                '’' => 0x92,
                '“' => 0x93,
                '”' => 0x94,
                '–' => 0x96,
                '—' => 0x97,
                _ => b'?',
            },
        })
        .collect()
}

/// PDF-streng: `(…)` med escapede parenteser og backslash.
fn pdf_string(s: &str) -> Vec<u8> {
    let mut out = vec![b'('];
    for b in win_ansi(s) {
        if matches!(b, b'(' | b')' | b'\\') {
            out.push(b'\\');
        }
        out.push(b);
    }
    out.push(b')');
    out
}

/// Bredde i 1/1000 em for Helvetica (kun de tegn, der højrestilles: tal og beløb).
fn helvetica_width(s: &str) -> u32 {
    s.chars()
        .map(|c| match c {
            '0'..='9' => 556,
            '.' | ',' | ' ' => 278,
            '-' => 333,
            'k' => 500,
            'r' => 333,
            't' => 278,
            '%' => 889,
            _ => 556,
        })
        .sum()
}

/// En side med tekst. Koordinater i punkter fra nederste venstre hjørne (A4).
struct Page {
    ops: Vec<u8>,
}

impl Page {
    fn new() -> Self {
        Page { ops: vec![] }
    }

    fn text(&mut self, x: f32, y: f32, size: f32, bold: bool, s: &str) {
        let font = if bold { "F2" } else { "F1" };
        self.ops
            .extend_from_slice(format!("BT /{font} {size} Tf {x:.1} {y:.1} Td ").as_bytes());
        self.ops.extend(pdf_string(s));
        self.ops.extend_from_slice(b" Tj ET\n");
    }

    /// Højrestillet tekst, der slutter ved `right`.
    fn text_right(&mut self, right: f32, y: f32, size: f32, bold: bool, s: &str) {
        let w = helvetica_width(s) as f32 * size / 1000.0;
        self.text(right - w, y, size, bold, s);
    }

    fn line(&mut self, x1: f32, y: f32, x2: f32) {
        self.ops
            .extend_from_slice(format!("0.5 w {x1:.1} {y:.1} m {x2:.1} {y:.1} l S\n").as_bytes());
    }
}

fn write_pdf(pages: Vec<Page>) -> Vec<u8> {
    // Objekter: 1 katalog, 2 sider, 3 F1, 4 F2, derefter (side, indhold) pr. side.
    let n = pages.len();
    let mut objs: Vec<Vec<u8>> = vec![];
    objs.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    let kids: Vec<String> = (0..n).map(|i| format!("{} 0 R", 5 + i * 2)).collect();
    objs.push(format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" ")).into_bytes());
    objs.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    );
    objs.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    );
    for (i, p) in pages.into_iter().enumerate() {
        let content = 6 + i * 2;
        objs.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] \
                 /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content} 0 R >>"
            )
            .into_bytes(),
        );
        let mut stream = format!("<< /Length {} >>\nstream\n", p.ops.len()).into_bytes();
        stream.extend(p.ops);
        stream.extend_from_slice(b"\nendstream");
        objs.push(stream);
    }

    let mut out: Vec<u8> = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n".to_vec();
    let mut offsets = vec![];
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for off in offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objs.len() + 1
        )
        .as_bytes(),
    );
    out
}

/// Linjer pr. side, før tabellen fortsætter på næste side.
const LINES_PER_PAGE: usize = 20;

/// Køberen på fakturaen.
#[derive(Clone, Debug, Default)]
pub struct Buyer {
    pub name: String,
    pub cvr: Option<String>,
    pub email: Option<String>,
}

impl Buyer {
    pub fn named(name: &str) -> Self {
        Buyer { name: name.to_string(), ..Buyer::default() }
    }
}

/// Adressen i linjer: linjeskift, ellers komma ("Vej 1, 8000 By").
fn address_lines(a: &str) -> Vec<String> {
    let sep = if a.contains('\n') { '\n' } else { ',' };
    a.split(sep).map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

/// Tekst delt i linjer på højst `width` tegn (ved mellemrum).
fn wrap(s: &str, width: usize) -> Vec<String> {
    let mut out = vec![];
    for para in s.lines() {
        let mut line = String::new();
        for word in para.split_whitespace() {
            if !line.is_empty() && line.chars().count() + 1 + word.chars().count() > width {
                out.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        }
        out.push(line);
    }
    out
}

/// Fakturaen som PDF (A4) med afsender, køber, linjer, moms og betaling.
/// Uden `sender` (cloud) udelades afsender- og betalingsblokken.
pub fn invoice_pdf(inv: &Invoice, buyer: &Buyer, sender: Option<&InvoiceProfile>) -> Vec<u8> {
    let title = match inv.number_label() {
        Some(n) => format!("Faktura {n}"),
        None => "Fakturakladde".to_string(),
    };
    let (left, right) = (56.0, 539.0);
    let chunks: Vec<_> = if inv.lines.is_empty() {
        vec![&inv.lines[..]]
    } else {
        inv.lines.chunks(LINES_PER_PAGE).collect()
    };
    let count = chunks.len();
    let mut pages = vec![];
    for (pi, chunk) in chunks.into_iter().enumerate() {
        let mut p = Page::new();
        p.text(left, 780.0, 22.0, true, &title);
        p.text(left, 752.0, 10.0, false, &format!("Fakturadato: {}", format::date_short(inv.issued)));
        p.text(left, 738.0, 10.0, false, &format!("Forfaldsdato: {}", format::date_short(inv.due)));
        if count > 1 {
            p.text_right(right, 806.0, 9.0, false, &format!("Side {} af {count}", pi + 1));
        }
        // Afsender (øverst til højre).
        if let Some(s) = sender {
            let x = 340.0;
            let mut y = 784.0;
            if !s.company_name.trim().is_empty() {
                p.text(x, y, 11.0, true, s.company_name.trim());
                y -= 14.0;
            }
            let mut lines = address_lines(&s.address);
            if !s.cvr.trim().is_empty() {
                lines.push(format!("CVR: {}", s.cvr.trim()));
            }
            for l in [&s.email, &s.phone] {
                if !l.trim().is_empty() {
                    lines.push(l.trim().to_string());
                }
            }
            for l in lines {
                p.text(x, y, 9.0, false, &l);
                y -= 12.0;
            }
        }
        // Køber.
        let mut y = 700.0;
        p.text(left, y, 10.0, true, "Faktureres til");
        y -= 14.0;
        p.text(left, y, 10.0, false, &buyer.name);
        for l in [buyer.cvr.as_ref().map(|c| format!("CVR: {c}")), buyer.email.clone()].into_iter().flatten() {
            y -= 13.0;
            p.text(left, y, 10.0, false, &l);
        }
        let mut y = 622.0;
        if let Some(t) = inv.title.as_deref().filter(|t| !t.trim().is_empty()) {
            let t: String = t.chars().take(70).collect();
            p.text(left, y, 12.0, true, &t);
        }
        y -= 26.0;
        p.text(left, y, 10.0, true, "Beskrivelse");
        p.text_right(330.0, y, 10.0, true, "Timer");
        p.text_right(430.0, y, 10.0, true, "Pris pr. time");
        p.text_right(right, y, 10.0, true, "Beløb");
        y -= 8.0;
        p.line(left, y, right);
        y -= 16.0;
        for l in chunk {
            let desc: String = l.description.chars().take(48).collect();
            p.text(left, y, 10.0, false, &desc);
            p.text_right(330.0, y, 10.0, false, &hours_fixed(l.minutes));
            p.text_right(430.0, y, 10.0, false, &kroner(l.rate));
            p.text_right(right, y, 10.0, false, &kroner(l.amount()));
            y -= 18.0;
        }
        if pi + 1 == count {
            y -= 4.0;
            p.line(330.0, y + 10.0, right);
            y -= 8.0;
            p.text(330.0, y, 10.0, false, "Subtotal");
            p.text_right(right, y, 10.0, false, &kroner(inv.subtotal()));
            y -= 16.0;
            p.text(330.0, y, 10.0, false, &format!("Moms {} %", vat_percent(inv.vat_permille)));
            p.text_right(right, y, 10.0, false, &kroner(inv.vat()));
            y -= 20.0;
            p.text(330.0, y, 12.0, true, "I alt");
            p.text_right(right, y, 12.0, true, &kroner(inv.total()));
            y -= 30.0;
            if let Some(n) = inv.notes.as_deref().filter(|n| !n.trim().is_empty()) {
                p.text(left, y, 10.0, true, "Noter");
                for l in wrap(n, 95).into_iter().take(6) {
                    y -= 13.0;
                    p.text(left, y, 9.0, false, &l);
                }
                y -= 22.0;
            }
            if let Some(s) = sender {
                p.text(left, y, 10.0, true, "Betaling");
                let mut lines = vec![];
                if !s.bank_reg.trim().is_empty() && !s.bank_account.trim().is_empty() {
                    lines.push(format!(
                        "Bankoverførsel: Reg.nr. {} · Kontonr. {}",
                        s.bank_reg.trim(),
                        s.bank_account.trim()
                    ));
                }
                if !s.mobilepay.trim().is_empty() {
                    lines.push(format!("MobilePay: {}", s.mobilepay.trim()));
                }
                lines.push(format!("Betalingsbetingelser: Netto {} dage", s.payment_terms_days));
                if let Some(n) = inv.number_label() {
                    lines.push(format!("Angiv fakturanr. {n} ved betaling"));
                }
                for l in lines {
                    y -= 13.0;
                    p.text(left, y, 9.0, false, &l);
                }
            }
        }
        p.text(left, 40.0, 8.0, false, "Udstedt med TimeTrack");
        pages.push(p);
    }
    write_pdf(pages)
}

/// 250 → "25", 125 → "12,5".
pub fn vat_percent(permille: u32) -> String {
    if permille.is_multiple_of(10) {
        (permille / 10).to_string()
    } else {
        format!("{},{}", permille / 10, permille % 10)
    }
}

/// Filnavn til fakturaen: "Faktura-1042.pdf" eller "Fakturakladde-2026-10-26.pdf".
pub fn invoice_file_name(inv: &Invoice) -> String {
    match inv.number_label() {
        Some(n) => format!("Faktura-{n}.pdf"),
        None => format!("Fakturakladde-{}.pdf", inv.issued),
    }
}

/// Mappen, eksport gemmes i: Overførsler/Downloads, ellers hjemmemappen.
/// `TT_EXPORT_DIR` tvinger en mappe (tests og skærmbilleder).
pub fn export_dir() -> std::path::PathBuf {
    if let Some(dir) = std::env::var_os("TT_EXPORT_DIR") {
        return dir.into();
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dl = home.join("Downloads");
    if dl.is_dir() { dl } else { home }
}

/// Skriver filen uden at overskrive en eksisterende ("navn (2).pdf").
pub fn write_unique(
    dir: &std::path::Path,
    name: &str,
    bytes: &[u8],
) -> std::io::Result<std::path::PathBuf> {
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let mut path = dir.join(name);
    let mut i = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({i}).{ext}"));
        i += 1;
    }
    std::fs::write(&path, bytes)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{DateRange, InvoiceLine, InvoiceStatus, ReportRow};
    use chrono::NaiveDate;

    fn d(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, day).unwrap()
    }

    fn invoice(lines: usize) -> Invoice {
        Invoice {
            id: "f1".into(),
            number: Some(1042),
            customer_id: "k".into(),
            status: InvoiceStatus::Sent,
            issued: d(26),
            due: NaiveDate::from_ymd_opt(2026, 11, 9).unwrap(),
            lines: (0..lines)
                .map(|i| InvoiceLine {
                    description: format!("Webshop (æøå) linje {i}"),
                    minutes: 90,
                    rate: 85_000,
                    entry_ids: vec![],
                })
                .collect(),
            lines_loaded: true,
            subtotal_hint: 0,
            vat_permille: 250,
            number_text: None,
            title: None,
            notes: None,
        }
    }

    #[test]
    fn kroner_med_punktum() {
        assert_eq!(kroner(123_450), "1.234,50 kr.");
        assert_eq!(kroner(0), "0,00 kr.");
        assert_eq!(kroner_plain(123_450), "1234,50");
        assert_eq!(kroner_plain(-5), "-0,05");
        assert_eq!(hours_fixed(90), "1,50");
        assert_eq!(hours_fixed(20), "0,33");
        assert_eq!(vat_percent(250), "25");
        assert_eq!(vat_percent(125), "12,5");
    }

    #[test]
    fn csv_til_dansk_excel() {
        let r = Report {
            range: DateRange {
                from: d(19),
                to: d(25),
            },
            grouping: ReportGrouping::Customer,
            rows: vec![
                ReportRow {
                    key: "a".into(),
                    label: "Bageriet; på \"Hjørnet\"".into(),
                    minutes: 150,
                    billable_minutes: 120,
                    amount: 150_000,
                },
                ReportRow {
                    key: "b".into(),
                    label: "Café Åbrinken".into(),
                    minutes: 60,
                    billable_minutes: 0,
                    amount: 0,
                },
            ],
        };
        let csv = report_csv(&r);
        assert!(csv.starts_with('\u{feff}'), "BOM for æøå i Excel");
        let lines: Vec<&str> = csv.trim_start_matches('\u{feff}').split("\r\n").collect();
        assert_eq!(
            lines[0],
            "Kunde;Timer;Fakturerbare timer;Ikke-fakturerbare timer;Beløb (kr.)"
        );
        assert_eq!(
            lines[1],
            "\"Bageriet; på \"\"Hjørnet\"\"\";2,50;2,00;0,50;1500,00"
        );
        assert_eq!(lines[2], "Café Åbrinken;1,00;0,00;1,00;0,00");
        assert_eq!(lines[3], "I alt;3,50;2,00;1,50;1500,00");
        assert_eq!(
            report_file_name(&r),
            "timetrack-rapport-2026-10-19-2026-10-25.csv"
        );
    }

    #[test]
    fn pdf_er_gyldig_og_har_aeoeaa() {
        let pdf = invoice_pdf(&invoice(3), &Buyer::named("Bageriet på Hjørnet"), None);
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf.ends_with(b"%%EOF\n"));
        // æ/ø/å som WinAnsi-bytes.
        assert!(pdf.windows(3).any(|w| w == [0xe6, 0xf8, 0xe5]));
        // Parenteser i teksten er escapet.
        assert!(pdf.windows(2).any(|w| w == b"\\("));
        // Total: 3 × 1,5 t × 850 = 3.825 + 25 % = 4.781,25 kr.
        let s = String::from_utf8_lossy(&pdf);
        assert!(s.contains("(4.781,25 kr.)"), "total i PDF");
        assert!(s.contains("(Faktura 1042)"));
        // xref-offsets peger på objekterne.
        let xref_pos: usize = s
            .rsplit("startxref\n")
            .next()
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        assert!(pdf[xref_pos..].starts_with(b"xref"));
        let first_obj = pdf.windows(7).position(|w| w == b"1 0 obj").unwrap();
        assert!(s.contains(&format!("{first_obj:010} 00000 n")));
    }

    #[test]
    fn pdf_har_afsender_koeber_og_betaling() {
        let mut inv = invoice(2);
        inv.number_text = Some("2026-7".into());
        inv.title = Some("Webshop, oktober".into());
        inv.notes = Some("Tak for samarbejdet".into());
        let sender = InvoiceProfile {
            company_name: "Acme".into(),
            cvr: "39413892".into(),
            address: "Testvej 1\n8000 Aarhus C".into(),
            bank_reg: "1234".into(),
            bank_account: "12345678".into(),
            mobilepay: "12345".into(),
            ..InvoiceProfile::default()
        };
        let buyer = Buyer {
            name: "Bageriet".into(),
            cvr: Some("12345678".into()),
            email: None,
        };
        let s = String::from_utf8_lossy(&invoice_pdf(&inv, &buyer, Some(&sender))).to_string();
        for want in [
            "(Faktura 2026-7)",
            "(Acme)",
            "(Testvej 1)",
            "(8000 Aarhus C)",
            "(CVR: 39413892)",
            "(Faktureres til)",
            "(CVR: 12345678)",
            "(Webshop, oktober)",
            "(Tak for samarbejdet)",
            "(MobilePay: 12345)",
            "(Betalingsbetingelser: Netto 14 dage)",
            "(Angiv fakturanr. 2026-7 ved betaling)",
        ] {
            assert!(s.contains(want), "mangler {want}");
        }
        assert!(s.contains("Reg.nr. 1234 \u{fffd} Kontonr. 12345678") || s.contains("Kontonr. 12345678"));
        assert_eq!(invoice_file_name(&inv), "Faktura-2026-7.pdf");
        // Uden afsender (cloud): ingen betalingsblok.
        let s = String::from_utf8_lossy(&invoice_pdf(&inv, &buyer, None)).to_string();
        assert!(!s.contains("(Betaling)"));
    }

    #[test]
    fn formler_koeres_ikke_i_excel() {
        assert_eq!(csv_field("=HYPERLINK(1)"), "'=HYPERLINK(1)");
        assert_eq!(csv_field("-rm"), "'-rm");
        assert_eq!(csv_field("@x;y"), "\"'@x;y\"");
        assert_eq!(csv_field("Kurv"), "Kurv");
    }

    #[test]
    fn adresse_og_ombrydning() {
        assert_eq!(address_lines("Vej 1, 8000 By"), ["Vej 1", "8000 By"]);
        assert_eq!(address_lines("Vej 1, st.\n8000 By"), ["Vej 1, st.", "8000 By"]);
        assert_eq!(wrap("a bb ccc dddd", 6), ["a bb", "ccc", "dddd"]);
    }

    #[test]
    fn pdf_deler_lange_fakturaer_paa_sider() {
        let pdf = invoice_pdf(&invoice(60), &Buyer::named("Kunde"), None);
        let s = String::from_utf8_lossy(&pdf);
        assert!(s.contains("/Count 3"), "60 linjer = 3 sider");
        assert!(s.contains("(Side 3 af 3)"));
        assert_eq!(
            s.matches("(I alt)").count(),
            1,
            "totaler kun på sidste side"
        );
        let tom = invoice_pdf(&invoice(0), &Buyer::named("Kunde"), None);
        assert!(String::from_utf8_lossy(&tom).contains("/Count 1"));
    }

    #[test]
    fn filnavne_og_unik_skrivning() {
        let mut inv = invoice(1);
        assert_eq!(invoice_file_name(&inv), "Faktura-1042.pdf");
        inv.number = None;
        assert_eq!(invoice_file_name(&inv), "Fakturakladde-2026-10-26.pdf");
        let dir = std::env::temp_dir().join(format!("tt-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = write_unique(&dir, "x.csv", b"1").unwrap();
        let b = write_unique(&dir, "x.csv", b"2").unwrap();
        assert_eq!(a.file_name().unwrap(), "x.csv");
        assert_eq!(b.file_name().unwrap(), "x (2).csv");
        assert_eq!(std::fs::read(&a).unwrap(), b"1");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
