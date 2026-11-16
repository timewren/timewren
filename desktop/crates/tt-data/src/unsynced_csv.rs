//! CSV over tid, der ikke nåede kontoen: migreringens
//! `ikke-synkroniseret-fra-0.2.csv` og eksporten af afviste registreringer
//! (offline-køens dead-letter) skrives med samme kode og samme kolonner.
//!
//! Semikolon, decimalkomma, CRLF og BOM, så Excel på dansk åbner filen
//! rigtigt. Tekstfelter (kunde, projekt, beskrivelse) står altid i
//! anførselstegn.

use rust_decimal::Decimal;

/// Kolonnerne (uden BOM og linjeskift).
pub const HEADER: &str = "Dato;Start;Slut;Timer;Kunde;Projekt;Beskrivelse";

/// Én række. Dato `ÅÅÅÅ-MM-DD`, tider `TT:MM`, timer med decimalkomma.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Row {
    pub date: String,
    pub start: String,
    pub end: String,
    pub hours: String,
    pub client: String,
    pub project: String,
    pub description: String,
}

/// Et tekstfelt i anførselstegn. Starter teksten med et tegn, Excel læser
/// som en formel (`= + - @`, tab eller CR), sættes `'` foran, så et
/// kundenavn som `=HYPERLINK(…)` vises som tekst (CSV-injektion).
fn field(s: &str) -> String {
    let guard = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) { "'" } else { "" };
    format!("\"{guard}{}\"", s.replace('"', "\"\""))
}

/// Hele filen: BOM, overskrift og rækkerne.
pub fn write<'a>(rows: impl IntoIterator<Item = &'a Row>) -> String {
    let mut csv = format!("\u{feff}{HEADER}\r\n");
    for r in rows {
        csv.push_str(&format!(
            "{};{};{};{};{};{};{}\r\n",
            r.date,
            r.start,
            r.end,
            r.hours,
            field(&r.client),
            field(&r.project),
            field(&r.description),
        ));
    }
    csv
}

/// Sekunder som timer med to decimaler og komma ("1,50").
pub fn hours_from_secs(secs: i64) -> String {
    format!("{:.2}", secs as f64 / 3600.0).replace('.', ",")
}

/// Timer som decimaltal med to decimaler og komma ("1,50").
pub fn hours(h: Decimal) -> String {
    format!("{:.2}", h.round_dp(2)).replace('.', ",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_bom_header_and_quoted_text() {
        let rows = vec![Row {
            date: "2026-10-26".into(),
            start: "09:00".into(),
            end: "10:30".into(),
            hours: hours_from_secs(5400),
            client: "Bageriet".into(),
            project: String::new(),
            description: "Møde om \"kurv\"; næste skridt".into(),
        }];
        let csv = write(&rows);
        assert_eq!(
            csv,
            "\u{feff}Dato;Start;Slut;Timer;Kunde;Projekt;Beskrivelse\r\n\
             2026-10-26;09:00;10:30;1,50;\"Bageriet\";\"\";\"Møde om \"\"kurv\"\"; næste skridt\"\r\n"
        );
        assert_eq!(hours("1.5".parse().unwrap()), "1,50");
        assert_eq!(hours("0.333".parse().unwrap()), "0,33");
    }

    #[test]
    fn formulas_are_written_as_text() {
        let row = |client: &str| Row { client: client.into(), ..Row::default() };
        let csv = write(&[row("=HYPERLINK(\"http://x\")"), row("+45 kunde"), row("-1"), row("@sum"), row("Bager=")]);
        let clients: Vec<&str> = csv.lines().skip(1).map(|l| l.split(';').nth(4).unwrap()).collect();
        assert_eq!(
            clients,
            ["\"'=HYPERLINK(\"\"http://x\"\")\"", "\"'+45 kunde\"", "\"'-1\"", "\"'@sum\"", "\"Bager=\""]
        );
    }
}
