//! Danske kalenderdage og klokkeslæt, uafhængigt af maskinens tidszone.
//!
//! Web: `src/lib/time/copenhagen.ts`, `src/lib/timer/entry-date.ts` og
//! `src/lib/time/clock-range.ts`. Reglen er den samme som i web: et tidspunkt
//! oversættes til en dansk dato i Europe/Copenhagen, al dato-aritmetik sker på
//! kalenderdatoer, og en registrering dateres efter sit START-tidspunkt (en
//! timer 23:30-00:30 hører til den dag, arbejdet begyndte).
//!
//! Lagringskonventionen for `time_entries.date` i web er UTC-midnat på den
//! danske dato ([`entry_date_utc`]).

use chrono::{
    DateTime, Datelike, Days, LocalResult, Months, NaiveDate, NaiveDateTime, Offset, TimeZone,
    Timelike, Utc,
};
use chrono_tz::Europe::Copenhagen;

use crate::js;

/// Københavns UTC-offset i sekunder på et tidspunkt (3600 eller 7200).
fn offset_seconds_at(instant: DateTime<Utc>) -> i64 {
    i64::from(
        Copenhagen
            .offset_from_utc_datetime(&instant.naive_utc())
            .fix()
            .local_minus_utc(),
    )
}

/// Vægur-tid i København for et tidspunkt.
pub fn copenhagen_local(instant: DateTime<Utc>) -> NaiveDateTime {
    instant.with_timezone(&Copenhagen).naive_local()
}

/// Den danske kalenderdato for et tidspunkt (`toCopenhagenDateStr`).
pub fn copenhagen_date(instant: DateTime<Utc>) -> NaiveDate {
    copenhagen_local(instant).date()
}

/// Klokketimen 0-23 i København (`copenhagenHour`).
pub fn copenhagen_hour(instant: DateTime<Utc>) -> u32 {
    copenhagen_local(instant).hour()
}

/// Øjeblikket hvor den danske dag begynder: 22:00Z dagen før i sommertid,
/// 23:00Z i vintertid (`copenhagenDayStart`). Midnat ligger aldrig i et
/// sommertidshul, så resultatet er entydigt.
pub fn copenhagen_day_start(date: NaiveDate) -> DateTime<Utc> {
    copenhagen_wall_time(date.and_hms_opt(0, 0, 0).expect("midnat findes"))
}

/// Eksklusiv øvre grænse: starten af den følgende danske dag.
pub fn copenhagen_day_end_exclusive(date: NaiveDate) -> DateTime<Utc> {
    copenhagen_day_start(add_days(date, 1))
}

/// Øjeblikket for et vægur-tidspunkt i København (`copenhagenWallTime`). I
/// sommertidshullet rykkes en time frem (02:30 → 03:30); den dobbelte time i
/// oktober giver den anden (vintertids-)forekomst. Samme to-trins-opslag som
/// web, så skiftedagene giver præcis det samme.
pub fn copenhagen_wall_time(local: NaiveDateTime) -> DateTime<Utc> {
    let as_utc = local.and_utc();
    let first = as_utc - chrono::Duration::seconds(offset_seconds_at(as_utc));
    as_utc - chrono::Duration::seconds(offset_seconds_at(first))
}

/// Læg `days` dage til (kan være negativ).
pub fn add_days(date: NaiveDate, days: i64) -> NaiveDate {
    if days >= 0 {
        date.checked_add_days(Days::new(days.unsigned_abs()))
            .unwrap_or(date)
    } else {
        date.checked_sub_days(Days::new(days.unsigned_abs()))
            .unwrap_or(date)
    }
}

/// Læg `months` måneder til; dagen klemmes til månedens sidste dag
/// (`addMonthsToDateStr`: 31/1 + 1 = 28/2).
pub fn add_months(date: NaiveDate, months: i32) -> NaiveDate {
    let shifted = if months >= 0 {
        date.checked_add_months(Months::new(months.unsigned_abs()))
    } else {
        date.checked_sub_months(Months::new(months.unsigned_abs()))
    };
    shifted.unwrap_or(date)
}

/// ISO-ugedag: 1 = mandag … 7 = søndag.
pub fn iso_weekday(date: NaiveDate) -> u32 {
    date.weekday().number_from_monday()
}

/// Mandagen i samme uge.
pub fn week_start(date: NaiveDate) -> NaiveDate {
    add_days(date, 1 - i64::from(iso_weekday(date)))
}

/// Den 1. i samme måned.
pub fn month_start(date: NaiveDate) -> NaiveDate {
    date.with_day(1).expect("den 1. findes")
}

/// Lagringsværdien for en dansk dato i web's `time_entries.date`: UTC-midnat
/// på datoen (`entryDateFromStr`).
pub fn entry_date_utc(date: NaiveDate) -> DateTime<Utc> {
    date.and_hms_opt(0, 0, 0).expect("midnat findes").and_utc()
}

/// Datoen en registrering med et starttidspunkt hører til
/// (`entryDateForStart`, #650): START-tidspunktets danske dato. Registreringen
/// splittes ikke ved midnat.
pub fn entry_date_for_start(started_at: DateTime<Utc>) -> NaiveDate {
    copenhagen_date(started_at)
}

/// Parse "yyyy-MM-dd" som web's `isDateStr`: præcis det format og en gyldig
/// kalenderdato.
pub fn parse_date_str(s: &str) -> Option<NaiveDate> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    if !b
        .iter()
        .enumerate()
        .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return None;
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

/// Et lokalt vægur-tidspunkt fortolket som JavaScripts `new Date(y, m, d, h, min)`
/// i en browser med dansk tid: i sommertidshullet bruges offsettet fra før
/// skiftet (02:30 → 03:30 sommertid), og den dobbelte time i oktober giver
/// den FØRSTE (sommertids-)forekomst.
///
/// Bemærk: det er det modsatte af [`copenhagen_wall_time`] i den dobbelte
/// time. Begge dele er web's adfærd (formularerne bruger browserens
/// `new Date`, serveren `copenhagenWallTime`).
pub fn browser_local_time(local: NaiveDateTime) -> DateTime<Utc> {
    match Copenhagen.from_local_datetime(&local) {
        LocalResult::Single(t) => t.with_timezone(&Utc),
        LocalResult::Ambiguous(earliest, _) => earliest.with_timezone(&Utc),
        LocalResult::None => {
            // Offset fra før hullet (vintertid)
            let before = local.and_utc() - chrono::Duration::hours(3);
            local.and_utc() - chrono::Duration::seconds(offset_seconds_at(before))
        }
    }
}

/// Et tidsrum indtastet som klokkeslæt ("HH:mm") på en dato
/// (`clockRangeToInstants`). En sluttid FØR starttiden betyder næste dag; ens
/// tider giver et tomt tidsrum. Varigheden regnes på de reelle tidspunkter,
/// så natten til sidste søndag i oktober er 01:00-04:00 fire timer.
///
/// Datoen skal have formen "yyyy-MM-dd"; en umulig dag løber over som i
/// `new Date` (30/2 → 2/3). Web falder tilbage til "i dag", hvis formen er
/// forkert; her er det `None`, fordi "i dag" ikke er en ren funktion. `None`
/// også for klokkeslæt så store, at JavaScript giver Invalid Date.
pub fn clock_range_to_instants(
    date: &str,
    start_clock: &str,
    end_clock: &str,
) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let day = parse_date_rolling(date)?;
    let (sh, sm) = parse_clock(start_clock);
    let (eh, em) = parse_clock(end_clock);
    let at = |d: NaiveDate, h: f64, m: f64| -> Option<DateTime<Utc>> {
        // new Date(y, mo, d, h, m) afkorter til heltal og lader minutter/timer
        // løbe over i næste time/dag
        let minutes = h.trunc() * 60.0 + m.trunc();
        // Ud over ±100 mio. dage giver JavaScript Invalid Date
        if minutes.abs() > 1.0e11 {
            return None;
        }
        let local = d
            .and_hms_opt(0, 0, 0)?
            .checked_add_signed(chrono::Duration::try_minutes(minutes as i64)?)?;
        Some(browser_local_time(local))
    };
    let start = at(day, sh, sm)?;
    let end = if eh * 60.0 + em < sh * 60.0 + sm {
        at(add_days(day, 1), eh, em)?
    } else {
        at(day, eh, em)?
    };
    Some((start, end))
}

/// "yyyy-MM-dd" hvor dag og måned må løbe over som i `new Date(y, m - 1, d)`.
fn parse_date_rolling(s: &str) -> Option<NaiveDate> {
    let b = s.as_bytes();
    let digits_ok = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if !digits_ok {
        return None;
    }
    let y: i32 = s[0..4].parse().ok()?;
    let m: i32 = s[5..7].parse().ok()?;
    let d: i64 = s[8..10].parse().ok()?;
    let months = y * 12 + (m - 1);
    let first =
        NaiveDate::from_ymd_opt(months.div_euclid(12), months.rem_euclid(12) as u32 + 1, 1)?;
    Some(add_days(first, d - 1))
}

fn parse_clock(value: &str) -> (f64, f64) {
    let mut parts = value.split(':').map(js::number);
    let zero_if_nan = |v: Option<f64>| match v {
        Some(x) if x.is_finite() && x != 0.0 => x,
        _ => 0.0,
    };
    let h = zero_if_nan(parts.next());
    let m = zero_if_nan(parts.next());
    (h, m)
}

/// Timer (2 decimaler) mellem to tidspunkter; aldrig negativ (`hoursBetween`).
pub fn hours_between(start: DateTime<Utc>, end: DateTime<Utc>) -> f64 {
    let ms = (end - start).num_milliseconds() as f64;
    if ms > 0.0 {
        js::round((ms / 3_600_000.0) * 100.0) / 100.0
    } else {
        0.0
    }
}

/// Timer for et klokkeslæt-tidsrum på en dato (`clockRangeHours`).
pub fn clock_range_hours(date: &str, start_clock: &str, end_clock: &str) -> Option<f64> {
    clock_range_to_instants(date, start_clock, end_clock).map(|(s, e)| hours_between(s, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }
    fn d(s: &str) -> NaiveDate {
        parse_date_str(s).unwrap()
    }

    #[test]
    fn timer_over_midnat_dateres_paa_startdagen() {
        // start 30/9 23:30 CEST, stop 1/10 00:30 CEST
        assert_eq!(
            entry_date_for_start(t("2026-09-30T21:30:00Z")),
            d("2026-09-30")
        );
        assert_eq!(
            entry_date_for_start(t("2026-09-30T22:30:00Z")),
            d("2026-10-01")
        );
    }

    #[test]
    fn skiftedagene_er_23_og_25_timer() {
        let span =
            |s: &str| (copenhagen_day_end_exclusive(d(s)) - copenhagen_day_start(d(s))).num_hours();
        assert_eq!(span("2026-03-29"), 23);
        assert_eq!(span("2026-10-25"), 25);
    }
}
