//! Dagsgrænser. Aktivitet gemmes i UTC; "en dag" er altid brugerens lokale
//! døgn (systemets zone, typisk Europe/Copenhagen). Et døgn kan være 23 eller
//! 25 timer langt ved sommertid.

use chrono::{DateTime, Days, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};

/// Start og slut (eksklusiv) i UTC for den lokale dag `date` i zonen `tz`.
pub fn day_bounds_in<Tz: TimeZone>(date: NaiveDate, tz: &Tz) -> (DateTime<Utc>, DateTime<Utc>) {
    let next = date.checked_add_days(Days::new(1)).unwrap_or(date);
    (local_midnight(date, tz), local_midnight(next, tz))
}

/// Som [`day_bounds_in`] i systemets lokale zone.
pub fn day_bounds(date: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
    day_bounds_in(date, &chrono::Local)
}

/// Lokal midnat som UTC. Findes midnat ikke (en zone, der skifter tid ved
/// midnat), bruges første gyldige tidspunkt efter.
fn local_midnight<Tz: TimeZone>(date: NaiveDate, tz: &Tz) -> DateTime<Utc> {
    let naive = date.and_time(NaiveTime::MIN);
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(t) => t.with_timezone(&Utc),
        LocalResult::Ambiguous(first, _) => first.with_timezone(&Utc),
        LocalResult::None => {
            // Spring frem til første eksisterende minut.
            let mut probe = naive;
            for _ in 0..180 {
                probe += chrono::Duration::minutes(1);
                if let LocalResult::Single(t) | LocalResult::Ambiguous(t, _) =
                    tz.from_local_datetime(&probe)
                {
                    return t.with_timezone(&Utc);
                }
            }
            Utc.from_utc_datetime(&naive)
        }
    }
}

/// Den lokale dato for et UTC-tidspunkt.
pub fn local_date_in<Tz: TimeZone>(at: DateTime<Utc>, tz: &Tz) -> NaiveDate {
    at.with_timezone(tz).date_naive()
}

pub fn local_date(at: DateTime<Utc>) -> NaiveDate {
    local_date_in(at, &chrono::Local)
}

/// Klipper et interval til dagen. `None` hvis det ikke overlapper.
pub fn clip_to_day(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    bounds: (DateTime<Utc>, DateTime<Utc>),
) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let s = start.max(bounds.0);
    let e = end.min(bounds.1);
    (e > s).then_some((s, e))
}

/// Deler et interval ved hver lokal midnat. Bruges når et segment over
/// midnat skal vises eller summeres pr. dag.
pub fn split_at_local_midnight<Tz: TimeZone>(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    tz: &Tz,
) -> Vec<(NaiveDate, DateTime<Utc>, DateTime<Utc>)> {
    let mut out = Vec::new();
    if end <= start {
        return out;
    }
    let mut day = local_date_in(start, tz);
    loop {
        let b = day_bounds_in(day, tz);
        if let Some((s, e)) = clip_to_day(start, end, b) {
            out.push((day, s, e));
        }
        if b.1 >= end {
            break;
        }
        match day.checked_add_days(Days::new(1)) {
            Some(d) => day = d,
            None => break,
        }
        if out.len() > 3660 {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::Europe::Copenhagen;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn utc(y: i32, m: u32, day: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, day, h, min, 0).unwrap()
    }

    #[test]
    fn normal_winter_day_is_24h_starting_23_utc() {
        let (s, e) = day_bounds_in(d(2026, 1, 15), &Copenhagen);
        assert_eq!(s, utc(2026, 1, 14, 23, 0));
        assert_eq!(e, utc(2026, 1, 15, 23, 0));
    }

    #[test]
    fn summer_day_starts_22_utc() {
        let (s, e) = day_bounds_in(d(2026, 7, 1), &Copenhagen);
        assert_eq!(s, utc(2026, 6, 30, 22, 0));
        assert_eq!((e - s).num_hours(), 24);
    }

    #[test]
    fn spring_forward_day_is_23h() {
        // 29/3-2026: 02:00 → 03:00 lokal tid.
        let (s, e) = day_bounds_in(d(2026, 3, 29), &Copenhagen);
        assert_eq!(s, utc(2026, 3, 28, 23, 0));
        assert_eq!(e, utc(2026, 3, 29, 22, 0));
        assert_eq!((e - s).num_hours(), 23);
    }

    #[test]
    fn fall_back_day_is_25h() {
        // 25/10-2026: 03:00 → 02:00 lokal tid.
        let (s, e) = day_bounds_in(d(2026, 10, 25), &Copenhagen);
        assert_eq!(s, utc(2026, 10, 24, 22, 0));
        assert_eq!(e, utc(2026, 10, 25, 23, 0));
        assert_eq!((e - s).num_hours(), 25);
    }

    #[test]
    fn local_date_after_midnight_belongs_to_next_day() {
        // 23:30 UTC 26/10 = 00:30 lokal 27/10 (vintertid).
        assert_eq!(
            local_date_in(utc(2026, 10, 26, 23, 30), &Copenhagen),
            d(2026, 10, 27)
        );
        // 22:30 UTC 1/7 = 00:30 lokal 2/7 (sommertid).
        assert_eq!(
            local_date_in(utc(2026, 7, 1, 22, 30), &Copenhagen),
            d(2026, 7, 2)
        );
        // UTC-dato ville have sagt 1/7; det var 0.2's fejl.
    }

    #[test]
    fn segment_over_midnight_splits_into_two_days() {
        // 23:00-01:00 lokal (vinter) = 22:00-00:00 UTC.
        let parts =
            split_at_local_midnight(utc(2026, 1, 15, 22, 0), utc(2026, 1, 16, 0, 0), &Copenhagen);
        assert_eq!(parts.len(), 2);
        assert_eq!(
            parts[0],
            (
                d(2026, 1, 15),
                utc(2026, 1, 15, 22, 0),
                utc(2026, 1, 15, 23, 0)
            )
        );
        assert_eq!(
            parts[1],
            (
                d(2026, 1, 16),
                utc(2026, 1, 15, 23, 0),
                utc(2026, 1, 16, 0, 0)
            )
        );
    }

    #[test]
    fn split_over_dst_night_keeps_total_duration() {
        let start = utc(2026, 10, 24, 20, 0);
        let end = utc(2026, 10, 26, 2, 0);
        let parts = split_at_local_midnight(start, end, &Copenhagen);
        let total: i64 = parts.iter().map(|(_, s, e)| (*e - *s).num_seconds()).sum();
        assert_eq!(total, (end - start).num_seconds());
        assert_eq!(
            parts.iter().map(|p| p.0).collect::<Vec<_>>(),
            vec![d(2026, 10, 24), d(2026, 10, 25), d(2026, 10, 26)]
        );
        // 25/10 er 25 timer.
        assert_eq!((parts[1].2 - parts[1].1).num_hours(), 25);
    }

    #[test]
    fn clip_outside_is_none() {
        let b = day_bounds_in(d(2026, 1, 15), &Copenhagen);
        assert!(clip_to_day(utc(2026, 1, 10, 0, 0), utc(2026, 1, 11, 0, 0), b).is_none());
        assert!(
            split_at_local_midnight(utc(2026, 1, 1, 0, 0), utc(2026, 1, 1, 0, 0), &Copenhagen)
                .is_empty()
        );
    }
}
