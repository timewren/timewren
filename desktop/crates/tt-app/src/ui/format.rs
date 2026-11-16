//! Danske formater: timer ("7,5 t"), ur ("1:05"), datoer og beløb.
//! Rene funktioner uden GPUI, så de kan testes direkte.

use chrono::{Datelike, NaiveDate, NaiveTime, Weekday};

use crate::i18n::{t, tf};

/// Minutter som timer med dansk komma og højst to decimaler: 450 → "7,5 t", 60 → "1 t", 20 → "0,33 t".
pub fn hours(minutes: u32) -> String {
    format!("{} {}", hours_number(minutes as i64), t("ui.unit.hour"))
}

/// Som `hours`, men uden enhed og med fortegn: -90 → "-1,5".
pub fn hours_number(minutes: i64) -> String {
    let neg = minutes < 0;
    let m = minutes.unsigned_abs();
    // Hundrededele af en time, afrundet.
    let hundredths = (m * 100 + 30) / 60;
    let (whole, frac) = (hundredths / 100, hundredths % 100);
    let mut s = whole.to_string();
    if frac != 0 {
        let f = format!("{frac:02}");
        s.push(',');
        s.push_str(f.trim_end_matches('0'));
    }
    if neg { format!("-{s}") } else { s }
}

/// Sekunder som "t:mm" (menulinjen): 3900 → "1:05".
pub fn clock_hm(secs: u64) -> String {
    format!("{}:{:02}", secs / 3600, (secs / 60) % 60)
}

/// Sekunder som "t:mm:ss" (timer-kortet): 3907 → "1:05:07".
pub fn clock_hms(secs: u64) -> String {
    format!("{}:{:02}:{:02}", secs / 3600, (secs / 60) % 60, secs % 60)
}

/// "09:30".
pub fn time(t: NaiveTime) -> String {
    t.format("%H:%M").to_string()
}

/// "09:00-11:00" eller "Uden tidspunkt".
pub fn span(start: Option<NaiveTime>, end: Option<NaiveTime>) -> String {
    match (start, end) {
        (Some(a), Some(b)) => format!("{}-{}", time(a), time(b)),
        (Some(a), None) => tf("ui.span.from", &[("time", &time(a))]),
        _ => t("ui.span.none").into(),
    }
}

pub fn weekday(d: Weekday) -> &'static str {
    match d {
        Weekday::Mon => t("ui.weekday.mon"),
        Weekday::Tue => t("ui.weekday.tue"),
        Weekday::Wed => t("ui.weekday.wed"),
        Weekday::Thu => t("ui.weekday.thu"),
        Weekday::Fri => t("ui.weekday.fri"),
        Weekday::Sat => t("ui.weekday.sat"),
        Weekday::Sun => t("ui.weekday.sun"),
    }
}

pub fn weekday_short(d: Weekday) -> &'static str {
    match d {
        Weekday::Mon => t("ui.weekday_short.mon"),
        Weekday::Tue => t("ui.weekday_short.tue"),
        Weekday::Wed => t("ui.weekday_short.wed"),
        Weekday::Thu => t("ui.weekday_short.thu"),
        Weekday::Fri => t("ui.weekday_short.fri"),
        Weekday::Sat => t("ui.weekday_short.sat"),
        Weekday::Sun => t("ui.weekday_short.sun"),
    }
}

pub fn month(m: u32) -> &'static str {
    const KEYS: [&str; 12] = [
        "ui.month.1",
        "ui.month.2",
        "ui.month.3",
        "ui.month.4",
        "ui.month.5",
        "ui.month.6",
        "ui.month.7",
        "ui.month.8",
        "ui.month.9",
        "ui.month.10",
        "ui.month.11",
        "ui.month.12",
    ];
    t(KEYS[(m.clamp(1, 12) - 1) as usize])
}

/// "mandag 26. oktober 2026".
pub fn date_long(d: NaiveDate) -> String {
    format!(
        "{} {}. {} {}",
        weekday(d.weekday()),
        d.day(),
        month(d.month()),
        d.year()
    )
}

/// "26. okt." eller "26. okt. 2025" når året ikke er `this_year`.
pub fn date_medium(d: NaiveDate, this_year: i32) -> String {
    // Tre tegn, ikke tre bytes: månedsnavne på andre sprog kan have æøå/ä.
    let m: String = month(d.month()).chars().take(3).collect();
    if d.year() == this_year {
        format!("{}. {m}.", d.day())
    } else {
        format!("{}. {m}. {}", d.day(), d.year())
    }
}

/// "26.10.2026".
pub fn date_short(d: NaiveDate) -> String {
    d.format("%d.%m.%Y").to_string()
}

/// "I dag", "I går", "I morgen" eller den lange dato.
pub fn date_relative(d: NaiveDate, today: NaiveDate) -> String {
    match (d - today).num_days() {
        0 => t("ui.date.today").into(),
        -1 => t("ui.date.yesterday").into(),
        1 => t("ui.date.tomorrow").into(),
        _ => date_long(d),
    }
}

/// Øre som kroner med tusindtalspunktum: 123456 → "1.234,56 kr".
pub fn money(oere: i64) -> String {
    let neg = oere < 0;
    let o = oere.unsigned_abs();
    let kr = (o / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in kr.chars().enumerate() {
        if i > 0 && (kr.len() - i).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    format!("{}{grouped},{:02} kr", if neg { "-" } else { "" }, o % 100)
}

/// "1,5" / "1.5" / "1:30" / "90m" → minutter. Fejl er danske og kan vises direkte.
pub fn parse_hours(s: &str) -> Result<u32, &'static str> {
    let s = s.trim().trim_end_matches(['t', 'h']).trim();
    if s.is_empty() {
        return Err(t("ui.hours.empty"));
    }
    let mins = if let Some(m) = s.strip_suffix('m') {
        m.trim().parse::<u32>().map_err(|_| t("ui.hours.invalid"))?
    } else if let Some((h, m)) = s.split_once(':') {
        let h: u32 = h.trim().parse().map_err(|_| t("ui.hours.invalid"))?;
        let m: u32 = m.trim().parse().map_err(|_| t("ui.hours.invalid"))?;
        if m >= 60 {
            return Err(t("ui.hours.minutes_under_60"));
        }
        h * 60 + m
    } else {
        let v: f64 = s
            .replace(',', ".")
            .parse()
            .map_err(|_| t("ui.hours.invalid_hint"))?;
        if !v.is_finite() || v < 0.0 {
            return Err(t("ui.hours.invalid"));
        }
        (v * 60.0).round() as u32
    };
    if mins == 0 {
        return Err(t("ui.hours.over_zero"));
    }
    if mins > 24 * 60 {
        return Err(t("ui.hours.max_24"));
    }
    Ok(mins)
}

/// "9", "9:30", "0930", "9.30" → tidspunkt.
pub fn parse_time(s: &str) -> Option<NaiveTime> {
    let s = s.trim().replace('.', ":");
    let (h, m) = if let Some((h, m)) = s.split_once(':') {
        (h.parse().ok()?, m.parse().ok()?)
    } else if s.len() == 4 {
        (s[..2].parse().ok()?, s[2..].parse().ok()?)
    } else {
        (s.parse().ok()?, 0)
    };
    NaiveTime::from_hms_opt(h, m, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timer_med_dansk_komma() {
        assert_eq!(hours(450), "7,5 t");
        assert_eq!(hours(60), "1 t");
        assert_eq!(hours(90), "1,5 t");
        assert_eq!(hours(45), "0,75 t");
        assert_eq!(hours(20), "0,33 t");
        assert_eq!(hours(0), "0 t");
        assert_eq!(hours(61), "1,02 t");
        assert_eq!(hours_number(-90), "-1,5");
    }

    #[test]
    fn ure() {
        assert_eq!(clock_hm(3900), "1:05");
        assert_eq!(clock_hm(59), "0:00");
        assert_eq!(clock_hms(3907), "1:05:07");
    }

    #[test]
    fn datoer_paa_dansk() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        assert_eq!(date_long(d), "mandag 26. oktober 2026");
        assert_eq!(date_short(d), "26.10.2026");
        assert_eq!(date_medium(d, 2026), "26. okt.");
        assert_eq!(date_medium(d, 2025), "26. okt. 2026");
        assert_eq!(date_relative(d, d), "I dag");
        assert_eq!(date_relative(d.pred_opt().unwrap(), d), "I går");
        let lørdag = NaiveDate::from_ymd_opt(2026, 10, 31).unwrap();
        assert_eq!(weekday(lørdag.weekday()), "lørdag");
    }

    #[test]
    fn korte_maaneder_paa_alle_sprog() {
        // Tre tegn af månedsnavnet; må ikke gå i panik på "März" o.l.
        use crate::backend::Language;
        for lang in Language::ALL {
            crate::i18n::set(lang);
            for m in 1..=12 {
                let d = NaiveDate::from_ymd_opt(2026, m, 1).unwrap();
                let s = date_medium(d, 2026);
                assert!(s.starts_with("1. ") && s.ends_with('.'), "{lang:?}: {s}");
            }
        }
        crate::i18n::set(Language::De);
        let marts = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(date_medium(marts, 2026), "1. Mär.");
        crate::i18n::set(Language::Da);
    }

    #[test]
    fn tidsrum() {
        let a = NaiveTime::from_hms_opt(9, 0, 0);
        let b = NaiveTime::from_hms_opt(11, 30, 0);
        assert_eq!(span(a, b), "09:00-11:30");
        assert_eq!(span(None, None), "Uden tidspunkt");
    }

    #[test]
    fn beloeb() {
        assert_eq!(money(123_456), "1.234,56 kr");
        assert_eq!(money(85_000), "850,00 kr");
        assert_eq!(money(100_000_000), "1.000.000,00 kr");
        assert_eq!(money(-5), "-0,05 kr");
    }

    #[test]
    fn parse_timetal() {
        assert_eq!(parse_hours("1,5"), Ok(90));
        assert_eq!(parse_hours("1.5"), Ok(90));
        assert_eq!(parse_hours("1:30"), Ok(90));
        assert_eq!(parse_hours("2 t"), Ok(120));
        assert_eq!(parse_hours("45m"), Ok(45));
        assert!(parse_hours("").is_err());
        assert!(parse_hours("1,5x").is_err());
        assert!(parse_hours("1:75").is_err());
        assert!(parse_hours("0").is_err());
        assert!(parse_hours("25").is_err());
    }

    #[test]
    fn parse_tidspunkt() {
        let t = |h, m| NaiveTime::from_hms_opt(h, m, 0);
        assert_eq!(parse_time("9"), t(9, 0));
        assert_eq!(parse_time("9:30"), t(9, 30));
        assert_eq!(parse_time("0930"), t(9, 30));
        assert_eq!(parse_time("9.30"), t(9, 30));
        assert_eq!(parse_time("25:00"), None);
        assert_eq!(parse_time("x"), None);
    }
}
