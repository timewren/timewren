//! Møder og opkald: Teams, Zoom, Google Meet (browserfane), Slack huddle,
//! FaceTime og Telefon/Telefonlink.
//!
//! Detektionen ser kun forgrundsvinduet (det samme som trackeren). Et møde
//! begynder, når et mødevindue er i forgrunden, og slutter, når et andet
//! vindue har været i forgrunden i mere end `end_after_secs` (vinduet er
//! lukket, eller fanen er skiftet væk). Uden input (idle) eller med sporing
//! på pause vides intet, og mødet regnes for at fortsætte: man sidder ofte
//! stille og lytter. Er der gået mere end et minut mellem to observationer
//! (dvale), forlænges mødet ikke over hullet.
//!
//! Alt er en ren funktion af observationerne, så det kan testes uden ur.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::backend::{BackendError, Result};
use crate::i18n::{t, tf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MeetingKind {
    Teams,
    Zoom,
    Meet,
    SlackHuddle,
    FaceTime,
    Phone,
}

impl MeetingKind {
    /// "Teams-møde", "Zoom-møde", "Opkald" …
    pub fn label(self) -> &'static str {
        t(&format!("moeder.kind.{}", self.key()))
    }

    /// Bestemt form til notifikationen: "Teams-mødet", "Opkaldet".
    pub fn label_definite(self) -> &'static str {
        t(&format!("moeder.kind_def.{}", self.key()))
    }

    fn key(self) -> &'static str {
        match self {
            MeetingKind::Teams => "teams",
            MeetingKind::Zoom => "zoom",
            MeetingKind::Meet => "meet",
            MeetingKind::SlackHuddle => "slack",
            MeetingKind::FaceTime => "facetime",
            MeetingKind::Phone => "phone",
        }
    }
}

/// Ord i vinduestitlen, der betyder møde eller opkald (alle fem sprog).
const MEETING_WORDS: &[&str] = &[
    "meeting", "møde", "møte", "möte", "besprechung", "call", "opkald", "samtale", "anruf",
    "samtal", "webinar", "huddle",
];

fn has_meeting_word(title: &str) -> bool {
    let t = title.to_lowercase();
    MEETING_WORDS.iter().any(|w| t.contains(w))
}

/// Er stien en Meet-kode som `/abc-defg-hij`?
fn is_meet_code(url: &str) -> bool {
    let path = url
        .split_once("meet.google.com")
        .map(|(_, p)| p)
        .unwrap_or("")
        .trim_start_matches('/');
    let code = path.split(['/', '?', '#']).next().unwrap_or("");
    let parts: Vec<&str> = code.split('-').collect();
    parts.len() == 3
        && [3, 4, 3]
            .iter()
            .zip(&parts)
            .all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_lowercase()))
}

/// Hvilket slags møde viser vinduet? `None` = intet møde.
pub fn classify(app_id: &str, title: &str, url: Option<&str>, domain: Option<&str>) -> Option<MeetingKind> {
    let app = app_id.to_lowercase();
    let title_l = title.to_lowercase();
    if domain == Some("meet.google.com") {
        return url.is_some_and(is_meet_code).then_some(MeetingKind::Meet);
    }
    if domain == Some("teams.microsoft.com") || domain == Some("teams.live.com") {
        return (url.is_some_and(|u| u.contains("meetup-join")) || has_meeting_word(title))
            .then_some(MeetingKind::Teams);
    }
    if app.contains("zoom") {
        // Zooms hovedvindue hedder "Zoom"/"Zoom Workplace"; mødet "Zoom Meeting".
        return has_meeting_word(title).then_some(MeetingKind::Zoom);
    }
    if app.contains("teams") {
        // Teams' chat- og kalendervinduer er ikke møder.
        let chrome = ["chat |", "activity |", "aktivitet |", "calendar |", "kalender |"];
        return (has_meeting_word(title) && !chrome.iter().any(|c| title_l.starts_with(c)))
            .then_some(MeetingKind::Teams);
    }
    if app.contains("slack") {
        return title_l.contains("huddle").then_some(MeetingKind::SlackHuddle);
    }
    if app == "facetime" {
        return Some(MeetingKind::FaceTime);
    }
    // macOS 26's Telefon-app og Windows' Telefonlink (Phone Link)
    if app == "phone" || app == "telefon" {
        return Some(MeetingKind::Phone);
    }
    if app == "phoneexperiencehost" || app.contains("phone link") || app.contains("telefonlink") {
        return has_meeting_word(title).then_some(MeetingKind::Phone);
    }
    None
}

/// Hvad er i forgrunden?
#[derive(Clone, Debug, PartialEq)]
pub enum Foreground {
    /// Et mødevindue. `hint` er vinduestitlen, der kun bruges til at koble
    /// mødet til en kunde ("Møde med Bageriet | Microsoft Teams"); den
    /// gemmes og vises aldrig.
    Meeting { kind: MeetingKind, hint: String },
    /// Noget andet end et møde.
    Other,
    /// Intet vides (idle, sporing på pause, låst skærm).
    Unknown,
}

impl Foreground {
    pub fn hint(&self) -> Option<&str> {
        match self {
            Foreground::Meeting { hint, .. } => Some(hint),
            _ => None,
        }
    }

    /// Fra trackerens aktuelle segment.
    pub fn from_segment(seg: Option<&tt_tracker::ActivitySegment>) -> Foreground {
        match seg {
            None => Foreground::Unknown,
            Some(s) => match classify(&s.app_id, &s.title, s.url.as_deref(), s.domain.as_deref()) {
                Some(kind) => Foreground::Meeting {
                    kind,
                    hint: s.title.clone(),
                },
                None => Foreground::Other,
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MeetingSettings {
    pub enabled: bool,
    /// Sekunder væk fra mødet, før det regnes for slut.
    pub end_after_secs: u32,
    /// Kortere møder spørges der ikke om.
    pub min_minutes: u32,
}

impl Default for MeetingSettings {
    fn default() -> Self {
        MeetingSettings {
            enabled: true,
            end_after_secs: 120,
            min_minutes: 5,
        }
    }
}

impl MeetingSettings {
    pub fn validate(&self) -> Result<()> {
        if !(15..=1800).contains(&self.end_after_secs) {
            return Err(BackendError::Validation(t("moeder.err.end_after").into()));
        }
        if !(1..=120).contains(&self.min_minutes) {
            return Err(BackendError::Validation(t("moeder.err.min_minutes").into()));
        }
        Ok(())
    }
}

/// Et møde, der er slut.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FinishedMeeting {
    pub id: String,
    pub kind: MeetingKind,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    /// Første vinduestitel (kun til koblingen; se [`Foreground::Meeting`]).
    #[serde(skip)]
    pub hint: Option<String>,
}

impl FinishedMeeting {
    /// Hele minutter (rundet).
    pub fn minutes(&self) -> u32 {
        (((self.end - self.start).num_seconds() + 30) / 60).max(0) as u32
    }
}

#[derive(Clone, Debug)]
struct Active {
    kind: MeetingKind,
    start: DateTime<Utc>,
    /// Sidst set i forgrunden (eller antaget fortsat under idle).
    last_seen: DateTime<Utc>,
    /// Et andet vindue kom frem på dette tidspunkt.
    away_since: Option<DateTime<Utc>>,
    hint: String,
}

/// Hul mellem to observationer, der betyder dvale.
const MAX_GAP: i64 = 60;
/// Så længe kan et møde højst vare (så et glemt vindue ikke bliver ved).
const MAX_HOURS: i64 = 8;

#[derive(Debug)]
pub struct MeetingDetector {
    cfg: MeetingSettings,
    active: Option<Active>,
    last_obs: Option<DateTime<Utc>>,
}

impl Default for MeetingDetector {
    fn default() -> Self {
        Self::new(MeetingSettings::default())
    }
}

impl MeetingDetector {
    pub fn new(cfg: MeetingSettings) -> Self {
        MeetingDetector {
            cfg,
            active: None,
            last_obs: None,
        }
    }

    pub fn set_settings(&mut self, cfg: MeetingSettings) {
        if !cfg.enabled {
            self.active = None;
        }
        self.cfg = cfg;
    }

    pub fn in_meeting(&self) -> Option<MeetingKind> {
        self.active.as_ref().map(|a| a.kind)
    }

    /// Ét skridt. `hint` følger med til [`FinishedMeeting::hint`].
    pub fn observe(&mut self, at: DateTime<Utc>, fg: Foreground, _hint: Option<String>) -> Option<FinishedMeeting> {
        if !self.cfg.enabled {
            self.active = None;
            return None;
        }
        let gap_ok = self.last_obs.is_none_or(|l| (at - l).num_seconds() <= MAX_GAP);
        self.last_obs = Some(at);
        let end_after = Duration::seconds(i64::from(self.cfg.end_after_secs));
        match fg {
            Foreground::Meeting { kind, hint } => match self.active.as_mut() {
                // Dvale med mødet fremme: mødet sluttede, da maskinen sov.
                // Er vinduet stadig fremme bagefter, begynder et nyt møde.
                Some(_) if !gap_ok => {
                    let done = self.finish();
                    self.active = Some(Active {
                        kind,
                        start: at,
                        last_seen: at,
                        away_since: None,
                        hint,
                    });
                    done
                }
                Some(a) => {
                    a.last_seen = at;
                    a.away_since = None;
                    self.cap(at)
                }
                None => {
                    self.active = Some(Active {
                        kind,
                        start: at,
                        last_seen: at,
                        away_since: None,
                        hint,
                    });
                    None
                }
            },
            Foreground::Other => {
                let a = self.active.as_mut()?;
                if a.away_since.is_none() {
                    a.away_since = Some(at);
                    if gap_ok {
                        // Mødet var i forgrunden til nu.
                        a.last_seen = at;
                    }
                }
                let away = a.away_since.unwrap_or(at);
                if at - away > end_after {
                    return self.finish();
                }
                self.cap(at)
            }
            Foreground::Unknown => {
                let a = self.active.as_mut()?;
                if a.away_since.is_none() && gap_ok {
                    a.last_seen = at;
                }
                // Var vi allerede væk fra mødet, tæller tiden videre.
                if let Some(away) = a.away_since
                    && at - away > end_after
                {
                    return self.finish();
                }
                self.cap(at)
            }
        }
    }

    fn cap(&mut self, at: DateTime<Utc>) -> Option<FinishedMeeting> {
        let a = self.active.as_ref()?;
        (at - a.start > Duration::hours(MAX_HOURS)).then(|| self.finish()).flatten()
    }

    fn finish(&mut self) -> Option<FinishedMeeting> {
        let a = self.active.take()?;
        let m = FinishedMeeting {
            id: format!("{}-{}", a.start.timestamp(), a.last_seen.timestamp()),
            kind: a.kind,
            start: a.start,
            end: a.last_seen,
            hint: Some(a.hint),
        };
        (m.minutes() >= self.cfg.min_minutes).then_some(m)
    }
}

/// Notifikationens tekst: "Mødet med Bageriet varede 42 min. Registrér?"
pub fn notification_body(kind: MeetingKind, title: Option<&str>, customer: Option<&str>, minutes: u32) -> String {
    let min = minutes.to_string();
    match (customer, title) {
        (Some(c), _) => tf("moeder.notify.with_customer", &[("customer", c), ("minutes", &min)]),
        (None, Some(tl)) => tf("moeder.notify.with_title", &[("title", tl), ("minutes", &min)]),
        (None, None) => tf("moeder.notify.kind", &[("kind", kind.label_definite()), ("minutes", &min)]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(min: i64, sec: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 27, 9, 0, 0).unwrap() + Duration::minutes(min) + Duration::seconds(sec)
    }

    fn zoom() -> Foreground {
        Foreground::Meeting {
            kind: MeetingKind::Zoom,
            hint: "Zoom Meeting".into(),
        }
    }

    /// Kør detektoren hvert 5. sekund fra `from` til `to` minutter med `fg`.
    fn run(d: &mut MeetingDetector, from: i64, to: i64, fg: Foreground) -> Vec<FinishedMeeting> {
        let mut out = vec![];
        let mut s = from * 60;
        while s < to * 60 {
            if let Some(m) = d.observe(at(0, s), fg.clone(), None) {
                out.push(m);
            }
            s += 5;
        }
        out
    }

    #[test]
    fn genkender_moeder_og_ikke_hovedvinduer() {
        assert_eq!(classify("zoom.us", "Zoom Meeting", None, None), Some(MeetingKind::Zoom));
        assert_eq!(classify("zoom.us", "Zoom Workplace", None, None), None);
        assert_eq!(
            classify("ms-teams", "Møde med Bageriet | Microsoft Teams", None, None),
            Some(MeetingKind::Teams)
        );
        assert_eq!(classify("ms-teams", "Chat | Jens | Microsoft Teams", None, None), None);
        assert_eq!(
            classify("google chrome", "Meet - abc-defg-hij", Some("https://meet.google.com/abc-defg-hij"), Some("meet.google.com")),
            Some(MeetingKind::Meet)
        );
        assert_eq!(
            classify("google chrome", "Google Meet", Some("https://meet.google.com/landing"), Some("meet.google.com")),
            None,
            "Meets forside er ikke et møde"
        );
        assert_eq!(classify("slack", "Huddle: #design", None, None), Some(MeetingKind::SlackHuddle));
        assert_eq!(classify("slack", "#design - Acme", None, None), None);
        assert_eq!(classify("facetime", "Jens", None, None), Some(MeetingKind::FaceTime));
        assert_eq!(classify("phoneexperiencehost", "Telefonlink - Opkald", None, None), Some(MeetingKind::Phone));
        assert_eq!(classify("phoneexperiencehost", "Telefonlink", None, None), None);
        assert_eq!(classify("code", "meeting-notes.md", None, None), None);
    }

    #[test]
    fn moedet_slutter_naar_et_andet_vindue_har_vaeret_fremme_i_n_sekunder() {
        let mut d = MeetingDetector::new(MeetingSettings::default());
        assert!(run(&mut d, 0, 42, zoom()).is_empty());
        assert_eq!(d.in_meeting(), Some(MeetingKind::Zoom));
        // 1 minut i en anden app er ikke nok (standard 120 s)
        assert!(run(&mut d, 42, 43, Foreground::Other).is_empty());
        // Tilbage i mødet, og så væk for godt
        assert!(run(&mut d, 43, 50, zoom()).is_empty());
        let got = run(&mut d, 50, 55, Foreground::Other);
        assert_eq!(got.len(), 1);
        let m = &got[0];
        assert_eq!(m.start, at(0, 0));
        assert_eq!(m.end, at(50, 0), "slut er da mødet forlod forgrunden, ikke da det blev opdaget");
        assert_eq!(m.minutes(), 50);
        assert_eq!(m.hint.as_deref(), Some("Zoom Meeting"));
        assert_eq!(d.in_meeting(), None);
    }

    #[test]
    fn idle_under_moedet_forlaenger_det_men_ikke_efter_det() {
        let mut d = MeetingDetector::new(MeetingSettings::default());
        run(&mut d, 0, 10, zoom());
        // 20 min uden input midt i mødet: mødet fortsætter
        assert!(run(&mut d, 10, 30, Foreground::Unknown).is_empty());
        assert!(run(&mut d, 30, 31, zoom()).is_empty());
        // Ud af mødet og så idle (gået hjem): slutter efter N sekunder
        let mut got = run(&mut d, 31, 32, Foreground::Other);
        got.extend(run(&mut d, 32, 60, Foreground::Unknown));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].end, at(31, 0));
    }

    #[test]
    fn dvale_forlaenger_ikke_moedet() {
        let mut d = MeetingDetector::new(MeetingSettings::default());
        run(&mut d, 0, 20, zoom());
        // Låget lukkes kl. 9:20 og åbnes kl. 11:00 i en anden app
        assert!(d.observe(at(120, 0), Foreground::Other, None).is_none());
        let got = run(&mut d, 120, 125, Foreground::Other);
        assert_eq!(got.len(), 1);
        assert!(got[0].end <= at(20, 0), "{:?}", got[0].end);
    }

    #[test]
    fn dvale_med_moedet_fremme_slutter_det_og_loftet_gaelder_ogsaa_fremme() {
        let mut d = MeetingDetector::new(MeetingSettings::default());
        run(&mut d, 0, 20, zoom());
        // Låget lukkes kl. 9:20 og åbnes kl. 11:30 med Zoom stadig fremme
        let done = d.observe(at(150, 0), zoom(), None).expect("mødet sluttede ved dvalen");
        assert!(done.end <= at(20, 0), "{:?}", done.end);
        assert_eq!(d.in_meeting(), Some(MeetingKind::Zoom), "et nyt møde begynder");
        // Et vindue, der står fremme i over 8 timer, afsluttes
        let mut d = MeetingDetector::new(MeetingSettings::default());
        let got = run(&mut d, 0, 8 * 60 + 2, zoom());
        assert_eq!(got.len(), 1);
        assert!(got[0].minutes() <= 8 * 60 + 1);
    }

    #[test]
    fn korte_moeder_og_slaaet_fra_giver_intet() {
        let mut d = MeetingDetector::new(MeetingSettings::default());
        run(&mut d, 0, 3, zoom());
        assert!(run(&mut d, 3, 10, Foreground::Other).is_empty(), "3 min er under grænsen på 5");
        let mut d = MeetingDetector::new(MeetingSettings {
            enabled: false,
            ..MeetingSettings::default()
        });
        run(&mut d, 0, 30, zoom());
        assert!(run(&mut d, 30, 40, Foreground::Other).is_empty());
        // N kan ændres
        let mut d = MeetingDetector::new(MeetingSettings {
            end_after_secs: 30,
            ..MeetingSettings::default()
        });
        run(&mut d, 0, 10, zoom());
        let mut s = 0;
        while d.observe(at(10, s), Foreground::Other, None).is_none() && s < 120 {
            s += 5;
        }
        assert_eq!(s, 35, "slut lidt over 30 s efter");
    }

    #[test]
    fn standard_detektor_bruger_standardindstillinger() {
        let mut d = MeetingDetector::default();
        run(&mut d, 0, 10, zoom());
        assert_eq!(run(&mut d, 10, 15, Foreground::Other).len(), 1);
    }

    #[test]
    fn indstillinger_valideres() {
        assert!(MeetingSettings::default().validate().is_ok());
        let bad = MeetingSettings {
            end_after_secs: 5,
            ..MeetingSettings::default()
        };
        assert!(bad.validate().is_err());
    }

    #[test]
    fn notifikationstekst() {
        assert_eq!(
            notification_body(MeetingKind::Teams, Some("Status"), Some("Bageriet"), 42),
            "Mødet med Bageriet varede 42 min. Registrér?"
        );
        assert_eq!(
            notification_body(MeetingKind::Teams, None, None, 42),
            "Teams-mødet varede 42 min. Registrér?"
        );
    }
}
