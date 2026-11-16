//! Offentlige typer, som andre crates (`tt-matcher`, app'en) bruger.
//!
//! Alle tider er UTC. Visning og dagsopdeling sker i lokal tid via
//! [`crate::day`].

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Et sammenhængende stykke aktivitet i ét vindue med samme identitet.
///
/// Rå aktivitet forlader aldrig maskinen (spec D3). Typen er serde, så
/// `tt-matcher` kan bruge den direkte eller via en triviel adapter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySegment {
    /// Rækkens id i aktivitets-DB'en. `None` før segmentet er gemt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    /// Programmets visningsnavn ("Code", "Safari", "Google Chrome").
    pub app: String,
    /// Stabilt program-id: exe-navn i små bogstaver uden `.exe`, eller
    /// `.app`-bundlens navn på macOS ("code", "google chrome").
    pub app_id: String,
    /// Normaliseret vinduestitel (ulæst-tællere og app-suffiks fjernet).
    pub title: String,
    /// Normaliseret URL (scheme + host + sti, aldrig query eller fragment).
    pub url: Option<String>,
    /// Domæne fra URL'en i små bogstaver, uden `www.` og port.
    pub domain: Option<String>,
    /// Normaliseret git-remote ("github.com/acme/timetrack").
    pub repo_remote: Option<String>,
    /// Repoets rodmappe (normaliseret sti). Identiteten, når der ikke er remote.
    pub repo_root: Option<String>,
    /// Aktiv git-gren.
    pub branch: Option<String>,
    /// Arbejdsmappe: editorens workspace eller terminalens cwd (normaliseret).
    pub path: Option<String>,
    /// Dokument: åben fil i editoren, dokumentsti (macOS `AXDocument`) eller
    /// artefaktnavn afledt af titlen (Figma-fil, Word-dokument, Notion-side).
    pub document: Option<String>,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    /// Sand for en idle-periode (fra sidste input til brugeren kom tilbage).
    /// Idle-segmenter er aldrig arbejde; matcheren skal springe dem over.
    pub idle: bool,
}

impl ActivitySegment {
    pub fn duration_secs(&self) -> i64 {
        (self.end - self.start).num_seconds().max(0)
    }
}

/// Et råt vindue, som platformlaget har set. Ingen normalisering endnu.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RawWindow {
    pub app_name: String,
    /// Fuld sti til programmets binær (tom hvis ukendt).
    pub exe_path: String,
    pub pid: Option<u32>,
    /// Vinduets id hos OS'et (macOS `kCGWindowNumber`, Windows HWND).
    /// Bruges til at probe og cache pr. vindue, ikke pr. proces.
    pub window_id: Option<u64>,
    pub title: String,
    /// Dokument eller mappe, som vinduet selv oplyser (macOS `AXDocument`,
    /// som `file://`-URL eller sti). Terminal.app sætter den til cwd.
    pub document: Option<String>,
    /// Vinduets egne tilgængelighedstekster ud over titlen (macOS: AXIdentifier,
    /// AXDescription, AXSubrole). Bruges kun til at genkende private vinduer.
    pub accessibility_hints: Vec<String>,
}

/// Svar fra en browser-probe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowserUrl {
    /// Ingen URL (ukendt browser, timeout, ingen tilladelse).
    Unknown,
    /// Adresselinjens rå værdi; normaliseres af kalderen.
    Url(String),
    /// Vinduet er privat/inkognito ifølge browseren selv. Udelades helt.
    Private,
}

/// De signaler, der identificerer et segment, efter berigelse.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Signals {
    pub app: String,
    pub app_id: String,
    pub title: String,
    pub url: Option<String>,
    pub domain: Option<String>,
    pub repo_remote: Option<String>,
    pub repo_root: Option<String>,
    pub branch: Option<String>,
    pub path: Option<String>,
    pub document: Option<String>,
}

impl Signals {
    /// Segment-identitet. URL indgår bevidst ikke: URL-skift inden for samme
    /// side (titlen er den samme) må ikke splitte segmentet. Domæne gør heller
    /// ikke; det følger URL'en.
    pub fn same_identity(&self, other: &Signals) -> bool {
        self.app_id == other.app_id
            && self.title == other.title
            && self.repo_remote == other.repo_remote
            && self.repo_root == other.repo_root
            && self.branch == other.branch
            && self.path == other.path
            && self.document == other.document
    }

    pub(crate) fn into_segment(
        self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        idle: bool,
    ) -> ActivitySegment {
        ActivitySegment {
            id: None,
            app: self.app,
            app_id: self.app_id,
            title: self.title,
            url: self.url,
            domain: self.domain,
            repo_remote: self.repo_remote,
            repo_root: self.repo_root,
            branch: self.branch,
            path: self.path,
            document: self.document,
            start,
            end,
            idle,
        }
    }
}

/// Hændelser fra trackeren til app'en.
// Hændelser kommer sekunder fra hinanden; en Box ville kun gøre mønstermatch
// besværligt for app og matcher.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TrackerEvent {
    /// Et segment er afsluttet (og gemt, hvis trackeren har en DB).
    Segment(ActivitySegment),
    /// Brugeren er tilbage efter en idle-periode, der er lang nok til
    /// "Hvad lavede du?"-spørgsmålet.
    IdleReturn {
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        duration_secs: i64,
    },
    /// En fejl, der ikke stopper trackeren (fx DB låst). Teksten er til log.
    Error(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn segment_json_is_camel_case_and_roundtrips() {
        let start = Utc.with_ymd_and_hms(2026, 10, 26, 8, 0, 0).unwrap();
        let s = ActivitySegment {
            id: Some(7),
            app: "Code".into(),
            app_id: "code".into(),
            title: "main.rs".into(),
            url: None,
            domain: Some("kunde.dk".into()),
            repo_remote: Some("github.com/acme/timetrack".into()),
            repo_root: None,
            branch: Some("main".into()),
            path: Some("/users/m/dev/timetrack".into()),
            document: None,
            start,
            end: start + chrono::Duration::minutes(5),
            idle: false,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["appId"], "code");
        assert_eq!(json["repoRemote"], "github.com/acme/timetrack");
        assert_eq!(json["start"], "2026-10-26T08:00:00Z");
        let back: ActivitySegment = serde_json::from_value(json).unwrap();
        assert_eq!(back, s);
        assert_eq!(s.duration_secs(), 300);
    }

    #[test]
    fn events_are_tagged() {
        let at = Utc.with_ymd_and_hms(2026, 10, 26, 8, 0, 0).unwrap();
        let e = TrackerEvent::IdleReturn {
            start: at,
            end: at,
            duration_secs: 0,
        };
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["type"], "idleReturn");
        assert_eq!(json["durationSecs"], 0);
    }
}
