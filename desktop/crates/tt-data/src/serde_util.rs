//! Serde-hjælpere til web's wire-format.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Deserializer, Serializer};

use crate::model::ProjectStatus;

/// Dato for en tidspost: web sender "yyyy-MM-dd" eller (superjson-Date)
/// UTC-midnat som ISO-tidspunkt. Begge giver den danske kalenderdag.
pub fn parse_entry_date(s: &str) -> Option<NaiveDate> {
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d);
    }
    DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.with_timezone(&Utc).date_naive())
}

pub mod entry_date {
    use super::*;

    pub fn serialize<S: Serializer>(d: &NaiveDate, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&d.format("%Y-%m-%d").to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<NaiveDate, D::Error> {
        let s = String::deserialize(d)?;
        parse_entry_date(&s).ok_or_else(|| serde::de::Error::custom(format!("ugyldig dato: {s}")))
    }
}

pub mod entry_date_option {
    use super::*;

    pub fn serialize<S: Serializer>(d: &Option<NaiveDate>, s: S) -> Result<S::Ok, S::Error> {
        match d {
            Some(d) => s.serialize_str(&d.format("%Y-%m-%d").to_string()),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<NaiveDate>, D::Error> {
        match Option::<String>::deserialize(d)? {
            None => Ok(None),
            Some(s) => parse_entry_date(&s)
                .map(Some)
                .ok_or_else(|| serde::de::Error::custom(format!("ugyldig dato: {s}"))),
        }
    }
}

/// Decimal som streng begge veje (web's saveLines kræver strenge).
pub mod decimal_string {
    use super::*;

    pub fn serialize<S: Serializer>(d: &Decimal, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&d.normalize().to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Decimal, D::Error> {
        <Decimal as Deserialize>::deserialize(d)
    }
}

/// Beløb og timetal som streng med to decimaler ("850.00"), som web's
/// `clients`/`projects`-input kræver (`z.string()`, numeric-kolonner).
/// Læser både streng og tal.
/// Se [`money_string_option`].
pub fn money_string(d: Decimal) -> String {
    let mut d = d.round_dp(2);
    d.rescale(2);
    d.to_string()
}

pub mod money_string_option {
    use super::*;

    pub fn serialize<S: Serializer>(d: &Option<Decimal>, s: S) -> Result<S::Ok, S::Error> {
        match d {
            Some(d) => s.serialize_str(&money_string(*d)),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Decimal>, D::Error> {
        Option::<Decimal>::deserialize(d)
    }
}

/// `null` → `true` (web's nullable `isActive`, standard true).
pub fn null_as_true<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(d)?.unwrap_or(true))
}

/// `null` → typens default (web sender fx `urlPatterns: null`).
pub fn null_as_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

pub fn project_status<'de, D: Deserializer<'de>>(d: D) -> Result<ProjectStatus, D::Error> {
    Ok(Option::<String>::deserialize(d)?
        .map(|s| ProjectStatus::parse(&s))
        .unwrap_or_default())
}

pub fn task_status<'de, D: Deserializer<'de>>(d: D) -> Result<crate::model::TaskStatus, D::Error> {
    Ok(Option::<String>::deserialize(d)?
        .map(|s| crate::model::TaskStatus::parse(&s))
        .unwrap_or_default())
}

/// Skelner felt-mangler (`None`) fra eksplicit `null` (`Some(None)`).
pub fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{TimeEntry, TimeEntryPatch};

    #[test]
    fn entry_date_accepts_both_forms() {
        assert_eq!(parse_entry_date("2026-10-26"), NaiveDate::from_ymd_opt(2026, 10, 26));
        assert_eq!(
            parse_entry_date("2026-10-26T00:00:00.000Z"),
            NaiveDate::from_ymd_opt(2026, 10, 26)
        );
        assert_eq!(parse_entry_date("26/10"), None);
    }

    #[test]
    fn time_entry_parses_web_row() {
        let json = serde_json::json!({
            "id": "e1", "hours": "1.50", "date": "2026-10-26T00:00:00.000Z",
            "startTime": null, "description": "Møde om æblekage",
            "billableRate": "850.00", "isBilled": false, "unknownNewColumn": 1
        });
        let e: TimeEntry = serde_json::from_value(json).unwrap();
        assert_eq!(e.hours, Decimal::new(150, 2));
        assert_eq!(e.billable_rate, Some(Decimal::new(85000, 2)));
        assert!(!e.has_time_range());
    }

    #[test]
    fn device_id_is_stable() {
        let dir = std::env::temp_dir().join(format!("tt-device-{}", uuid::Uuid::new_v4()));
        let path = dir.join("device-id");
        let a = crate::model::DeviceInfo::load_or_create_id(&path).unwrap();
        let b = crate::model::DeviceInfo::load_or_create_id(&path).unwrap();
        assert_eq!(a, b);
        std::fs::write(&path, "ødelagt").unwrap();
        let c = crate::model::DeviceInfo::load_or_create_id(&path).unwrap();
        assert_ne!(c, a);
        assert!(uuid::Uuid::parse_str(&c).is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn paused_timer_with_zero_seconds_is_active() {
        let mut t = crate::model::TimerState::default();
        assert!(!t.is_active());
        t.session_id = Some("s1".into());
        assert!(t.is_active(), "pauset i første sekund er stadig aktiv");
    }

    #[test]
    fn patch_distinguishes_null_from_missing() {
        let p: TimeEntryPatch =
            serde_json::from_value(serde_json::json!({"projectId": null})).unwrap();
        assert_eq!(p.project_id, Some(None));
        assert_eq!(p.client_id, None);
        let back = serde_json::to_value(&p).unwrap();
        assert_eq!(back, serde_json::json!({"projectId": null}));
    }
}
