//! Indstillinger til idle-spørgsmål, påmindelser, pomodoro og notifikationer
//! (spec D21). Standardværdierne er de samme som i den gamle app
//! (`pomodoroStore`, `TrackingSettings`): pomodoro 25/5/15 efter 4, idle-
//! spørgsmål efter 10 minutter og dagens gennemgang kl. 17:00.
//!
//! Alle felter har `serde(default)`, så en `settings.json` fra før D21 stadig
//! kan læses.

use chrono::{NaiveTime, Weekday};
use serde::{Deserialize, Serialize};

use super::{BackendError, Result};

/// Idle-spørgsmålet: brugeren har været væk, mens en timer kørte.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IdlePromptSettings {
    pub enabled: bool,
    /// Minutter væk, før spørgsmålet stilles (gamle app: 10).
    pub minutes: u32,
}

impl Default for IdlePromptSettings {
    fn default() -> Self {
        IdlePromptSettings {
            enabled: true,
            minutes: 10,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReminderSettings {
    /// Påmindelse om at starte en timer i arbejdstiden.
    pub start_timer: bool,
    /// Påmindelse om en timer, der har kørt usædvanligt længe.
    pub long_running: bool,
    /// Dagens gennemgang af uafklarede forslag (gamle app: kl. 17:00).
    pub review: bool,
    /// Arbejdstid. Påmindelsen om at starte en timer kommer kun her.
    pub work_start: NaiveTime,
    pub work_end: NaiveTime,
    /// Arbejdsdage (mandag = 1 … søndag = 7).
    pub work_days: Vec<u8>,
    /// Minutter uden timer og uden nye registreringer, før der påmindes.
    pub idle_before_start_minutes: u32,
    /// Timer, der har kørt så længe, regnes for usædvanligt lang (timer).
    pub long_running_hours: u32,
    pub review_time: NaiveTime,
}

impl Default for ReminderSettings {
    fn default() -> Self {
        ReminderSettings {
            start_timer: true,
            long_running: true,
            review: true,
            work_start: NaiveTime::from_hms_opt(9, 0, 0).expect("kl. 9"),
            work_end: NaiveTime::from_hms_opt(17, 0, 0).expect("kl. 17"),
            work_days: vec![1, 2, 3, 4, 5],
            idle_before_start_minutes: 30,
            long_running_hours: 4,
            review_time: NaiveTime::from_hms_opt(17, 0, 0).expect("kl. 17"),
        }
    }
}

impl ReminderSettings {
    /// Er det arbejdstid (arbejdsdag og mellem start og slut)? Møde- og
    /// forslagsnotifikationer kommer kun her (kalender).
    pub fn in_work_hours(&self, now: chrono::DateTime<chrono::Local>) -> bool {
        use chrono::Datelike;
        let t = now.time();
        self.is_work_day(now.weekday()) && t >= self.work_start && t < self.work_end
    }

    pub fn is_work_day(&self, d: Weekday) -> bool {
        self.work_days
            .contains(&(d.number_from_monday().min(7) as u8))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PomodoroSettings {
    pub enabled: bool,
    pub work_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub sessions_before_long: u32,
    /// Pausen sætter timeren på pause, og et nyt arbejdsrunde starter, når
    /// timeren køres igen. Slået fra tæller pomodoro kun ned og siger til.
    pub pause_timer_on_break: bool,
}

impl Default for PomodoroSettings {
    fn default() -> Self {
        PomodoroSettings {
            enabled: false,
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            sessions_before_long: 4,
            pause_timer_on_break: true,
        }
    }
}

/// OS-notifikationer. `enabled` er hovedafbryderen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub idle_return: bool,
    pub reminders: bool,
    pub pomodoro: bool,
    /// Et møde eller opkald er slut (`moeder`).
    pub meetings: bool,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        NotificationSettings {
            enabled: true,
            idle_return: true,
            reminders: true,
            pomodoro: true,
            meetings: true,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct D21Settings {
    pub idle_prompt: IdlePromptSettings,
    pub reminders: ReminderSettings,
    pub pomodoro: PomodoroSettings,
    pub notifications: NotificationSettings,
}

fn range(name: &str, v: u32, min: u32, max: u32, unit: &str) -> Result<()> {
    if (min..=max).contains(&v) {
        Ok(())
    } else {
        Err(BackendError::Validation(format!(
            "{name} skal være mellem {min} og {max} {unit}"
        )))
    }
}

pub fn validate(s: &D21Settings) -> Result<()> {
    range(
        "Tid væk før spørgsmålet",
        s.idle_prompt.minutes,
        1,
        240,
        "minutter",
    )?;
    let p = &s.pomodoro;
    range("Arbejdsintervallet", p.work_minutes, 1, 120, "minutter")?;
    range("Den korte pause", p.short_break_minutes, 1, 60, "minutter")?;
    range("Den lange pause", p.long_break_minutes, 1, 60, "minutter")?;
    range(
        "Runder før lang pause",
        p.sessions_before_long,
        1,
        10,
        "runder",
    )?;
    let r = &s.reminders;
    range(
        "Tid uden timer før påmindelsen",
        r.idle_before_start_minutes,
        5,
        480,
        "minutter",
    )?;
    range("Lang timer", r.long_running_hours, 1, 24, "timer")?;
    if r.work_end <= r.work_start {
        return Err(BackendError::Validation(
            "Arbejdstiden skal slutte efter den begynder".into(),
        ));
    }
    if r.work_days.is_empty() || r.work_days.iter().any(|d| !(1..=7).contains(d)) {
        return Err(BackendError::Validation("Vælg mindst én arbejdsdag".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standarder_er_de_gamle_apps() {
        let d = D21Settings::default();
        assert_eq!(d.pomodoro.work_minutes, 25);
        assert_eq!(d.pomodoro.short_break_minutes, 5);
        assert_eq!(d.pomodoro.long_break_minutes, 15);
        assert_eq!(d.pomodoro.sessions_before_long, 4);
        assert_eq!(d.idle_prompt.minutes, 10);
        assert_eq!(
            d.reminders.review_time,
            NaiveTime::from_hms_opt(17, 0, 0).unwrap()
        );
        assert!(validate(&d).is_ok());
    }

    #[test]
    fn gamle_indstillinger_uden_felterne_kan_laeses() {
        let d: D21Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(d, D21Settings::default());
        let d: D21Settings =
            serde_json::from_str(r#"{"pomodoro":{"enabled":true,"workMinutes":50}}"#).unwrap();
        assert!(d.pomodoro.enabled);
        assert_eq!(d.pomodoro.work_minutes, 50);
        assert_eq!(d.pomodoro.short_break_minutes, 5);
    }

    #[test]
    fn ugyldige_vaerdier_afvises_paa_dansk() {
        let mut d = D21Settings::default();
        d.pomodoro.work_minutes = 0;
        assert!(
            matches!(validate(&d), Err(BackendError::Validation(m)) if m.contains("Arbejdsintervallet"))
        );
        let mut d = D21Settings::default();
        d.reminders.work_end = d.reminders.work_start;
        assert!(validate(&d).is_err());
        let mut d = D21Settings::default();
        d.reminders.work_days = vec![];
        assert!(validate(&d).is_err());
        d.reminders.work_days = vec![8];
        assert!(validate(&d).is_err());
    }

    #[test]
    fn arbejdstid_til_moedenotifikationer() {
        use chrono::TimeZone;
        let r = ReminderSettings::default(); // 9-17, man-fre
        let at = |d, h, m| chrono::Local.with_ymd_and_hms(2026, 10, d, h, m, 0).unwrap();
        assert!(r.in_work_hours(at(26, 9, 0)), "mandag kl. 9");
        assert!(r.in_work_hours(at(26, 16, 59)));
        assert!(!r.in_work_hours(at(26, 17, 0)), "slut kl. 17");
        assert!(!r.in_work_hours(at(26, 8, 59)));
        assert!(!r.in_work_hours(at(25, 12, 0)), "søndag");
    }

    #[test]
    fn arbejdsdage() {
        let r = ReminderSettings::default();
        assert!(r.is_work_day(Weekday::Mon));
        assert!(r.is_work_day(Weekday::Fri));
        assert!(!r.is_work_day(Weekday::Sat));
        assert!(!r.is_work_day(Weekday::Sun));
    }
}
