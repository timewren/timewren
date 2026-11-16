//! iCal/ICS (RFC 5545), så meget som kalendere fra Google, Outlook og iCloud
//! bruger: foldede linjer, `TZID`, heldagsaftaler, `DURATION`, `CLASS`,
//! `STATUS:CANCELLED`, deltagere, og gentagelser (`RRULE` med `DAILY`,
//! `WEEKLY`/`BYDAY`, `MONTHLY` og `YEARLY`, `INTERVAL`, `COUNT`, `UNTIL`,
//! `EXDATE` og flyttede forekomster med `RECURRENCE-ID`).
//!
//! Der læses kun; appen skriver aldrig til en kalender.

use std::collections::{HashMap, HashSet};

use chrono::{
    DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc,
    Weekday,
};
use chrono_tz::Tz;

use super::{CalendarEvent, SourceKind};

/// Højst så mange forekomster pr. gentaget aftale (værn mod uendelige regler).
const MAX_OCCURRENCES: usize = 2000;
/// Højst så mange skridt gennem en regel (ca. 270 år dagligt).
const MAX_STEPS: usize = 100_000;

/// Hvor tidspunktet hører hjemme.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Zone {
    Utc,
    Tz(Tz),
    /// Uden zone: maskinens lokale tid.
    Floating,
}

#[derive(Clone, Debug, PartialEq)]
struct When {
    at: NaiveDateTime,
    zone: Zone,
    date_only: bool,
}

impl When {
    fn utc(&self) -> Option<DateTime<Utc>> {
        match self.zone {
            Zone::Utc => Some(Utc.from_utc_datetime(&self.at)),
            Zone::Tz(tz) => tz
                .from_local_datetime(&self.at)
                .earliest()
                .map(|d| d.with_timezone(&Utc)),
            Zone::Floating => Local
                .from_local_datetime(&self.at)
                .earliest()
                .map(|d| d.with_timezone(&Utc)),
        }
    }

    fn with_at(&self, at: NaiveDateTime) -> When {
        When { at, ..self.clone() }
    }
}

#[derive(Clone, Debug, Default)]
struct RawEvent {
    uid: String,
    summary: String,
    start: Option<When>,
    end: Option<When>,
    duration: Option<Duration>,
    private: bool,
    cancelled: bool,
    attendees: Vec<String>,
    rrule: Option<String>,
    exdates: Vec<When>,
    recurrence_id: Option<When>,
}

/// Linjer med fortsættelser (start med mellemrum eller tab) samlet.
fn unfold(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some(rest) = line.strip_prefix([' ', '\t'])
            && let Some(last) = out.last_mut()
        {
            last.push_str(rest);
        } else if !line.is_empty() {
            out.push(line.to_string());
        }
    }
    out
}

/// `NAVN;PARAM=x;PARAM="a:b":værdi` → (NAVN, parametre, værdi).
fn split_line(line: &str) -> Option<(String, HashMap<String, String>, String)> {
    let mut in_quote = false;
    let mut colon = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quote = !in_quote,
            ':' if !in_quote => {
                colon = Some(i);
                break;
            }
            _ => {}
        }
    }
    let colon = colon?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.trim().to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.trim().to_ascii_uppercase(), v.trim_matches('"').to_string()))
        .collect();
    Some((name, params, value.to_string()))
}

fn unescape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push(' '),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

/// Outlooks Windows-navne for de mest brugte zoner.
fn windows_zone(name: &str) -> Option<Tz> {
    Some(match name {
        "Romance Standard Time" => chrono_tz::Europe::Copenhagen,
        "W. Europe Standard Time" => chrono_tz::Europe::Berlin,
        "Central Europe Standard Time" | "Central European Standard Time" => {
            chrono_tz::Europe::Warsaw
        }
        "GMT Standard Time" => chrono_tz::Europe::London,
        "FLE Standard Time" => chrono_tz::Europe::Helsinki,
        "Eastern Standard Time" => chrono_tz::America::New_York,
        "Pacific Standard Time" => chrono_tz::America::Los_Angeles,
        "UTC" | "Coordinated Universal Time" => chrono_tz::UTC,
        _ => return None,
    })
}

fn zone_for(params: &HashMap<String, String>, value: &str) -> Zone {
    if value.ends_with('Z') {
        return Zone::Utc;
    }
    match params.get("TZID") {
        Some(id) => {
            // Nogle kalendere skriver "/mozilla.org/.../Europe/Copenhagen"
            let id = id.trim_start_matches('/');
            id.parse::<Tz>()
                .ok()
                .or_else(|| id.rsplit_once('/').and_then(|(_, _)| {
                    let parts: Vec<&str> = id.split('/').collect();
                    (parts.len() >= 2)
                        .then(|| parts[parts.len() - 2..].join("/"))
                        .and_then(|s| s.parse::<Tz>().ok())
                }))
                .or_else(|| windows_zone(id))
                .map(Zone::Tz)
                .unwrap_or(Zone::Floating)
        }
        None => Zone::Floating,
    }
}

fn parse_stamp(value: &str) -> Option<(NaiveDateTime, bool)> {
    let v = value.trim().trim_end_matches('Z');
    if v.len() == 8 {
        let d = NaiveDate::parse_from_str(v, "%Y%m%d").ok()?;
        return Some((d.and_time(NaiveTime::MIN), true));
    }
    NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S")
        .ok()
        .map(|d| (d, false))
}

fn parse_when(params: &HashMap<String, String>, value: &str) -> Option<When> {
    let (at, date_only) = parse_stamp(value)?;
    let date_only = date_only || params.get("VALUE").is_some_and(|v| v == "DATE");
    Some(When {
        at,
        // Heldagsaftaler følger maskinens dato.
        zone: if date_only {
            Zone::Floating
        } else {
            zone_for(params, value)
        },
        date_only,
    })
}

/// `P1D`, `PT1H30M`, `-PT15M`, `P1W`.
fn parse_duration(v: &str) -> Option<Duration> {
    let v = v.trim();
    let (neg, v) = match v.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, v.strip_prefix('+').unwrap_or(v)),
    };
    let v = v.strip_prefix('P')?;
    let mut total = Duration::zero();
    let mut num = String::new();
    let mut in_time = false;
    for c in v.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            unit => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += match (unit, in_time) {
                    ('W', _) => Duration::weeks(n),
                    ('D', _) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    Some(if neg { -total } else { total })
}

fn mailto(v: &str) -> Option<String> {
    let v = v.trim();
    let addr = v
        .strip_prefix("mailto:")
        .or_else(|| v.strip_prefix("MAILTO:"))
        .unwrap_or(v);
    addr.contains('@').then(|| addr.to_ascii_lowercase())
}

fn read_events(text: &str) -> Vec<RawEvent> {
    let mut out = Vec::new();
    let mut cur: Option<RawEvent> = None;
    // Indlejrede blokke (VALARM) i en VEVENT springes over.
    let mut nested = 0usize;
    for line in unfold(text) {
        let Some((name, params, value)) = split_line(&line) else {
            continue;
        };
        match (name.as_str(), value.trim().to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT") => {
                cur = Some(RawEvent::default());
                nested = 0;
                continue;
            }
            ("END", "VEVENT") => {
                if let Some(ev) = cur.take() {
                    out.push(ev);
                }
                continue;
            }
            ("BEGIN", _) if cur.is_some() => {
                nested += 1;
                continue;
            }
            ("END", _) if cur.is_some() => {
                nested = nested.saturating_sub(1);
                continue;
            }
            _ => {}
        }
        let Some(ev) = cur.as_mut() else { continue };
        if nested > 0 {
            continue;
        }
        match name.as_str() {
            "UID" => ev.uid = value.trim().to_string(),
            "SUMMARY" => ev.summary = unescape(&value),
            "DTSTART" => ev.start = parse_when(&params, &value),
            "DTEND" => ev.end = parse_when(&params, &value),
            "DURATION" => ev.duration = parse_duration(&value),
            "CLASS" => {
                let v = value.trim().to_ascii_uppercase();
                ev.private = v == "PRIVATE" || v == "CONFIDENTIAL";
            }
            "STATUS" => ev.cancelled = value.trim().eq_ignore_ascii_case("CANCELLED"),
            "ATTENDEE" | "ORGANIZER" => {
                if let Some(m) = mailto(&value).or_else(|| params.get("EMAIL").and_then(|e| mailto(e)))
                    && !ev.attendees.contains(&m)
                {
                    ev.attendees.push(m);
                }
            }
            "RRULE" => ev.rrule = Some(value.trim().to_string()),
            "EXDATE" => {
                for v in value.split(',') {
                    if let Some(w) = parse_when(&params, v) {
                        ev.exdates.push(w);
                    }
                }
            }
            "RECURRENCE-ID" => ev.recurrence_id = parse_when(&params, &value),
            _ => {}
        }
    }
    out
}

#[derive(Debug, Default)]
struct Rule {
    freq: String,
    interval: u32,
    count: Option<usize>,
    until: Option<When>,
    by_day: Vec<Weekday>,
}

fn weekday(s: &str) -> Option<Weekday> {
    // "MO", men også "1MO"/"-1FR" (n'te ugedag i måneden understøttes ikke;
    // ugedagen bruges i ugentlige regler).
    let s = s.trim_start_matches(|c: char| c == '-' || c == '+' || c.is_ascii_digit());
    Some(match s {
        "MO" => Weekday::Mon,
        "TU" => Weekday::Tue,
        "WE" => Weekday::Wed,
        "TH" => Weekday::Thu,
        "FR" => Weekday::Fri,
        "SA" => Weekday::Sat,
        "SU" => Weekday::Sun,
        _ => return None,
    })
}

fn parse_rule(s: &str, start: &When) -> Option<Rule> {
    let mut r = Rule {
        interval: 1,
        ..Rule::default()
    };
    for part in s.split(';') {
        let (k, v) = part.split_once('=')?;
        match k.to_ascii_uppercase().as_str() {
            "FREQ" => r.freq = v.to_ascii_uppercase(),
            "INTERVAL" => r.interval = v.parse().ok().filter(|n| *n > 0)?,
            "COUNT" => r.count = v.parse().ok(),
            "UNTIL" => {
                let (at, date_only) = parse_stamp(v)?;
                r.until = Some(When {
                    at: if date_only {
                        at.date().and_time(NaiveTime::from_hms_opt(23, 59, 59)?)
                    } else {
                        at
                    },
                    zone: if v.ends_with('Z') { Zone::Utc } else { start.zone },
                    date_only: false,
                });
            }
            "BYDAY" => {
                // "1MO" (første mandag) og lignende understøttes ikke: hellere
                // kun første forekomst end aftaler på forkerte dage.
                if v.split(',').any(|d| d.trim_start_matches(['+', '-']).starts_with(|c: char| c.is_ascii_digit())) {
                    return None;
                }
                r.by_day = v.split(',').filter_map(weekday).collect();
            }
            "WKST" => {}
            // BYMONTHDAY, BYSETPOS, BYMONTH … understøttes ikke (se BYDAY).
            k if k.starts_with("BY") => return None,
            _ => {}
        }
    }
    let by_day_ok = r.by_day.is_empty() || matches!(r.freq.as_str(), "DAILY" | "WEEKLY");
    (by_day_ok && matches!(r.freq.as_str(), "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY")).then_some(r)
}

fn add_months(d: NaiveDate, months: u32) -> Option<NaiveDate> {
    let total = d.year() * 12 + d.month0() as i32 + months as i32;
    NaiveDate::from_ymd_opt(total.div_euclid(12), total.rem_euclid(12) as u32 + 1, d.day())
}

/// Starttidspunkterne (i aftalens egen zone) for en gentaget aftale, til og
/// med `until_local`.
fn occurrences(
    start: &When,
    rule: &Rule,
    window_start: NaiveDateTime,
    horizon: NaiveDateTime,
) -> Vec<NaiveDateTime> {
    let mut out = Vec::new();
    let time = start.at.time();
    let first = start.at.date();
    let until = rule.until.as_ref().map(|u| {
        // UNTIL i UTC sammenlignes i aftalens zone.
        match (u.zone, start.zone) {
            (Zone::Utc, Zone::Tz(tz)) => tz.from_utc_datetime(&u.at).naive_local(),
            (Zone::Utc, Zone::Floating) => Local.from_utc_datetime(&u.at).naive_local(),
            _ => u.at,
        }
    });
    let limit = until.map_or(horizon, |u| u.min(horizon));
    // `COUNT` tæller alle forekomster fra DTSTART; kun dem fra `window_start`
    // gemmes, og loftet gælder dem (en daglig aftale siden 2020 skal stadig
    // nå vinduet). Gennemløbet har sit eget værn.
    let mut seen = 0usize;
    let mut steps = 0usize;
    let mut push = |at: NaiveDateTime, out: &mut Vec<NaiveDateTime>| -> bool {
        steps += 1;
        if at < start.at {
            return steps < MAX_STEPS;
        }
        if at > limit
            || rule.count.is_some_and(|c| seen >= c)
            || out.len() >= MAX_OCCURRENCES
            || steps >= MAX_STEPS
        {
            return false;
        }
        seen += 1;
        if at >= window_start {
            out.push(at);
        }
        true
    };
    let interval = rule.interval.max(1);
    match rule.freq.as_str() {
        "DAILY" => {
            // "Hver hverdag": DAILY med BYDAY som filter.
            let mut d = first;
            loop {
                if (rule.by_day.is_empty() || rule.by_day.contains(&d.weekday()))
                    && !push(d.and_time(time), &mut out)
                {
                    break;
                }
                if d.and_time(time) > limit {
                    break;
                }
                d += Duration::days(i64::from(interval));
            }
        }
        "WEEKLY" => {
            let days: Vec<Weekday> = if rule.by_day.is_empty() {
                vec![first.weekday()]
            } else {
                rule.by_day.clone()
            };
            // Ugen begynder mandag (RFC'ens standard WKST=MO).
            let mut week = first - Duration::days(i64::from(first.weekday().num_days_from_monday()));
            'weeks: loop {
                let mut dates: Vec<NaiveDate> = days
                    .iter()
                    .map(|w| week + Duration::days(i64::from(w.num_days_from_monday())))
                    .collect();
                dates.sort();
                for d in dates {
                    if !push(d.and_time(time), &mut out) {
                        break 'weeks;
                    }
                }
                week += Duration::weeks(i64::from(interval));
                if week.and_time(time) > limit {
                    break;
                }
            }
        }
        "MONTHLY" | "YEARLY" => {
            let step = if rule.freq == "YEARLY" { 12 * interval } else { interval };
            let mut n = 0u32;
            loop {
                let Some(d) = add_months(first, n * step) else {
                    // Fx d. 31 i en kort måned: den forekomst findes ikke.
                    n += 1;
                    if n > 1200 {
                        break;
                    }
                    continue;
                };
                if !push(d.and_time(time), &mut out) {
                    break;
                }
                n += 1;
            }
        }
        _ => {}
    }
    out
}

/// Aftalerne i `text`, der overlapper `[from, to)`. `source_key` gør id'et
/// unikt på tværs af kilder.
pub fn parse(text: &str, source_key: &str, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<CalendarEvent> {
    let raw = read_events(text);
    // Flyttede/aflyste enkeltforekomster: (uid, oprindelig start).
    let overridden: HashSet<(String, Option<DateTime<Utc>>)> = raw
        .iter()
        .filter_map(|e| e.recurrence_id.as_ref().map(|r| (e.uid.clone(), r.utc())))
        .collect();
    let mut out = Vec::new();
    for ev in &raw {
        let Some(start) = ev.start.as_ref() else { continue };
        if ev.cancelled {
            continue;
        }
        let length = match (&ev.end, ev.duration) {
            (Some(end), _) => end.at - start.at,
            (None, Some(d)) => d,
            (None, None) if start.date_only => Duration::days(1),
            (None, None) => Duration::zero(),
        };
        let starts: Vec<NaiveDateTime> = match (&ev.rrule, &ev.recurrence_id) {
            (Some(r), None) => match parse_rule(r, start) {
                Some(rule) => {
                    let horizon = match start.zone {
                        Zone::Tz(tz) => tz.from_utc_datetime(&to.naive_utc()).naive_local(),
                        Zone::Utc => to.naive_utc(),
                        Zone::Floating => Local.from_utc_datetime(&to.naive_utc()).naive_local(),
                    };
                    // Lidt før vinduet, så en lang aftale, der begyndte før, kommer med.
                    let window_start = match start.zone {
                        Zone::Tz(tz) => tz.from_utc_datetime(&from.naive_utc()).naive_local(),
                        Zone::Utc => from.naive_utc(),
                        Zone::Floating => Local.from_utc_datetime(&from.naive_utc()).naive_local(),
                    } - length
                        - Duration::days(1);
                    occurrences(start, &rule, window_start, horizon)
                }
                None => vec![start.at],
            },
            _ => vec![start.at],
        };
        let excluded: HashSet<Option<DateTime<Utc>>> = ev.exdates.iter().map(When::utc).collect();
        for at in starts {
            let s = start.with_at(at);
            let Some(s_utc) = s.utc() else { continue };
            if ev.recurrence_id.is_none()
                && ev.rrule.is_some()
                && (excluded.contains(&Some(s_utc))
                    || overridden.contains(&(ev.uid.clone(), Some(s_utc))))
            {
                continue;
            }
            let Some(e_utc) = s.with_at(at + length).utc() else { continue };
            if e_utc <= from || s_utc >= to {
                continue;
            }
            out.push(CalendarEvent {
                id: format!("{source_key}:{}:{}", ev.uid, s_utc.timestamp()),
                title: ev.summary.clone(),
                start: s_utc,
                end: e_utc.max(s_utc),
                all_day: start.date_only,
                attendees: ev.attendees.clone(),
                private: ev.private,
                source: SourceKind::Ics,
            });
        }
    }
    out.sort_by_key(|e| e.start);
    out
}

/// `webcal://` er `https://` (Apple og Google bruger det i delingslinks).
pub fn normalize_url(url: &str) -> String {
    let url = url.trim();
    match url.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    }
}

/// Hent en ICS-fil. Kun `https://` (og `webcal://`); `http://` afvises, da
/// en hemmelig kalenderadresse ellers sendes ukrypteret.
pub fn fetch(url: &str) -> Result<String, String> {
    let url = normalize_url(url);
    if !url.starts_with("https://") {
        return Err("Kalenderadressen skal begynde med https:// eller webcal://".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(15)))
        .build()
        .into();
    let mut resp = agent
        .get(&url)
        .header("User-Agent", concat!("TimeTrack-Desktop/", env!("CARGO_PKG_VERSION")))
        .call()
        .map_err(|e| format!("Kalenderen kunne ikke hentes: {e}"))?;
    resp.body_mut()
        .with_config()
        .limit(20 * 1024 * 1024)
        .read_to_string()
        .map_err(|e| format!("Kalenderen kunne ikke læses: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(y: i32, m: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, mi, 0).unwrap()
    }

    fn wrap(body: &str) -> String {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}END:VCALENDAR\r\n")
    }

    fn window() -> (DateTime<Utc>, DateTime<Utc>) {
        (utc(2026, 10, 1, 0, 0), utc(2026, 11, 30, 0, 0))
    }

    #[test]
    fn simpel_aftale_med_tidszone_foldet_linje_og_deltagere() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:a1\r\nSUMMARY:Statusmøde med\r\n  Bageriet\\, webshop\r\n\
             DTSTART;TZID=Europe/Copenhagen:20261027T100000\r\n\
             DTEND;TZID=Europe/Copenhagen:20261027T104500\r\n\
             ORGANIZER;CN=Mads:mailto:mads@example.com\r\n\
             ATTENDEE;CN=\"Bager: Jens\";ROLE=REQ-PARTICIPANT:mailto:Jens@Bageriet.DK\r\n\
             BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nSUMMARY:Alarm\r\nEND:VALARM\r\nEND:VEVENT\r\n",
        );
        let (f, t) = window();
        let ev = parse(&ics, "ics0", f, t);
        assert_eq!(ev.len(), 1);
        let e = &ev[0];
        assert_eq!(e.title, "Statusmøde med Bageriet, webshop");
        // 27/10-2026 er efter sommertid: CET = UTC+1
        assert_eq!(e.start, utc(2026, 10, 27, 9, 0));
        assert_eq!(e.end, utc(2026, 10, 27, 9, 45));
        assert_eq!(e.attendees, vec!["mads@example.com", "jens@bageriet.dk"]);
        assert!(!e.private && !e.all_day);
        assert!(e.id.starts_with("ics0:a1:"));
    }

    #[test]
    fn utc_varighed_heldag_privat_og_aflyst() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:Kort\r\nDTSTART:20261028T120000Z\r\nDURATION:PT1H30M\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:h\r\nSUMMARY:Ferie\r\nDTSTART;VALUE=DATE:20261029\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:p\r\nSUMMARY:Læge\r\nCLASS:PRIVATE\r\nDTSTART:20261028T080000Z\r\nDTEND:20261028T090000Z\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Aflyst\r\nSTATUS:CANCELLED\r\nDTSTART:20261028T080000Z\r\nDTEND:20261028T090000Z\r\nEND:VEVENT\r\n",
        );
        let (f, t) = window();
        let ev = parse(&ics, "k", f, t);
        let titles: Vec<&str> = ev.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, vec!["Læge", "Kort", "Ferie"]);
        assert_eq!(ev[1].end - ev[1].start, Duration::minutes(90));
        assert!(ev[0].private);
        assert!(ev[2].all_day);
        assert_eq!(ev[2].end - ev[2].start, Duration::days(1));
    }

    #[test]
    fn ugentlig_gentagelse_med_byday_exdate_og_flyttet_forekomst() {
        // Hver mandag og onsdag kl. 9 fra 5/10, 6 gange; 7/10 er undtaget, og
        // 12/10 er flyttet til kl. 13.
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:r\r\nSUMMARY:Standup\r\n\
             DTSTART;TZID=Europe/Copenhagen:20261005T090000\r\nDTEND;TZID=Europe/Copenhagen:20261005T091500\r\n\
             RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6\r\n\
             EXDATE;TZID=Europe/Copenhagen:20261007T090000\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:r\r\nSUMMARY:Standup (flyttet)\r\n\
             RECURRENCE-ID;TZID=Europe/Copenhagen:20261012T090000\r\n\
             DTSTART;TZID=Europe/Copenhagen:20261012T130000\r\nDTEND;TZID=Europe/Copenhagen:20261012T131500\r\nEND:VEVENT\r\n",
        );
        let (f, t) = window();
        let ev = parse(&ics, "k", f, t);
        let days: Vec<String> = ev
            .iter()
            .map(|e| e.start.with_timezone(&chrono_tz::Europe::Copenhagen).format("%d %H:%M").to_string())
            .collect();
        // COUNT tæller også den undtagne og den flyttede (RFC 5545).
        assert_eq!(days, vec!["05 09:00", "12 13:00", "14 09:00", "19 09:00", "21 09:00"]);
        // Sommertid slutter 25/10: kl. 9 lokal tid er stadig kl. 9
        let late = parse(
            &wrap(
                "BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:X\r\nDTSTART;TZID=Europe/Copenhagen:20261023T090000\r\n\
                 DTEND;TZID=Europe/Copenhagen:20261023T100000\r\nRRULE:FREQ=DAILY;UNTIL=20261027T235959Z\r\nEND:VEVENT\r\n",
            ),
            "k",
            f,
            t,
        );
        assert_eq!(late.len(), 5);
        assert_eq!(late[0].start, utc(2026, 10, 23, 7, 0));
        assert_eq!(late[4].start, utc(2026, 10, 27, 8, 0));
    }

    #[test]
    fn maanedlig_og_uendelig_regel_stopper_ved_vinduet() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:m\r\nSUMMARY:Måned\r\nDTSTART:20260131T100000Z\r\nDTEND:20260131T110000Z\r\n\
             RRULE:FREQ=MONTHLY\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:i\r\nSUMMARY:Hver dag\r\nDTSTART:20200101T100000Z\r\nDTEND:20200101T101000Z\r\n\
             RRULE:FREQ=DAILY;INTERVAL=2\r\nEND:VEVENT\r\n",
        );
        let ev = parse(&ics, "k", utc(2026, 10, 1, 0, 0), utc(2026, 11, 1, 0, 0));
        let months: Vec<_> = ev.iter().filter(|e| e.title == "Måned").map(|e| e.start).collect();
        // Kun måneder med en 31.: oktober
        assert_eq!(months, vec![utc(2026, 10, 31, 10, 0)]);
        let daily = ev.iter().filter(|e| e.title == "Hver dag").count();
        assert!((15..=16).contains(&daily), "{daily}");
    }

    #[test]
    fn windows_zone_og_ukendt_zone() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:w\r\nSUMMARY:Outlook\r\nDTSTART;TZID=Romance Standard Time:20260601T100000\r\n\
             DTEND;TZID=Romance Standard Time:20260601T110000\r\nEND:VEVENT\r\n",
        );
        let ev = parse(&ics, "k", utc(2026, 5, 1, 0, 0), utc(2026, 7, 1, 0, 0));
        assert_eq!(ev[0].start, utc(2026, 6, 1, 8, 0), "sommertid: UTC+2");
        assert_eq!(parse_duration("-PT15M"), Some(Duration::minutes(-15)));
        assert_eq!(parse_duration("P1W"), Some(Duration::weeks(1)));
        assert_eq!(parse_duration("1H"), None);
    }

    #[test]
    fn webcal_bliver_https_og_http_afvises() {
        assert_eq!(normalize_url(" webcal://p01.icloud.com/x.ics"), "https://p01.icloud.com/x.ics");
        assert!(fetch("http://example.com/x.ics").unwrap_err().contains("https://"));
    }

    #[test]
    fn ugyldig_tekst_giver_ingen_aftaler_og_ingen_panik() {
        let (f, t) = window();
        for s in ["", "BEGIN:VEVENT", "BEGIN:VEVENT\nDTSTART:xx\nEND:VEVENT", "END:VEVENT\nfoo"] {
            assert!(parse(s, "k", f, t).is_empty());
        }
        let ics = wrap("BEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261028T100000Z\r\nRRULE:FREQ=SECONDLY\r\nEND:VEVENT\r\n");
        assert_eq!(parse(&ics, "k", f, t).len(), 1, "ukendt regel: kun første forekomst");
    }

    #[test]
    fn gammel_daglig_aftale_naar_vinduet_og_count_taeller_fra_start() {
        // Daglig siden 2020: over 2000 forekomster før oktober 2026.
        let ics = wrap(concat!(
            "BEGIN:VEVENT\r\nUID:s\r\nSUMMARY:Standup\r\nDTSTART:20200101T080000Z\r\n",
            "DTEND:20200101T081500Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Kort\r\nDTSTART:20261020T080000Z\r\n",
            "DTEND:20261020T081500Z\r\nRRULE:FREQ=DAILY;COUNT=10\r\nEND:VEVENT\r\n",
        ));
        let ev = parse(&ics, "k", utc(2026, 10, 26, 0, 0), utc(2026, 10, 28, 0, 0));
        assert_eq!(ev.iter().filter(|e| e.title == "Standup").count(), 2);
        // COUNT=10 fra 20/10: 26/10 og 27/10 er nr. 7 og 8
        assert_eq!(ev.iter().filter(|e| e.title == "Kort").count(), 2);
        let ev = parse(&ics, "k", utc(2026, 10, 30, 0, 0), utc(2026, 11, 2, 0, 0));
        assert_eq!(ev.iter().filter(|e| e.title == "Kort").count(), 0, "COUNT er brugt op 29/10");
    }

    #[test]
    fn hverdage_og_ukendte_by_dele() {
        let ics = wrap(concat!(
            "BEGIN:VEVENT\r\nUID:h\r\nSUMMARY:Hverdag\r\nDTSTART:20261023T080000Z\r\n",
            "DTEND:20261023T081500Z\r\nRRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:m\r\nSUMMARY:Første mandag\r\nDTSTART:20261005T080000Z\r\n",
            "DTEND:20261005T090000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=1MO\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Den 15.\r\nDTSTART:20261005T080000Z\r\n",
            "DTEND:20261005T090000Z\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=15\r\nEND:VEVENT\r\n",
        ));
        let ev = parse(&ics, "k", utc(2026, 10, 1, 0, 0), utc(2026, 12, 1, 0, 0));
        let hverdag: Vec<u32> = ev
            .iter()
            .filter(|e| e.title == "Hverdag" && e.start < utc(2026, 10, 31, 0, 0))
            .map(|e| e.start.day())
            .collect();
        assert_eq!(hverdag, vec![23, 26, 27, 28, 29, 30], "weekenden springes over");
        // Ukendte regler: kun første forekomst, aldrig forkerte dage
        assert_eq!(ev.iter().filter(|e| e.title == "Første mandag").count(), 1);
        assert_eq!(ev.iter().filter(|e| e.title == "Den 15.").count(), 1);
    }
}
