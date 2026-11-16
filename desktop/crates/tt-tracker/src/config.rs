//! Trackerens indstillinger. App'en ejer dem (i sin settings-tabel eller
//! via web) og giver dem til trackeren; trackeren læser ikke selv settings.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::exclusion::ExclusionRule;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TrackerConfig {
    /// Sekunder uden input, før brugeren regnes som idle. Selve tærsklen
    /// tælles ikke som arbejde: segmentet lukkes ved sidste input.
    pub idle_threshold_secs: u64,
    /// Kortere ikke-idle segmenter gemmes ikke (de er alt-tab-flimmer).
    pub min_segment_secs: i64,
    /// Idle-perioder mindst så lange giver en [`crate::TrackerEvent::IdleReturn`].
    pub idle_prompt_threshold_secs: u64,
    pub idle_prompt_enabled: bool,
    /// Mødeprogrammer (understreng af app-navn, små bogstaver). Mens et af
    /// dem er i forgrunden, regnes stilhed op til `meeting_max_idle_secs`
    /// ikke som idle.
    pub meeting_apps: Vec<String>,
    pub meeting_max_idle_secs: u64,
    /// Udelad private/inkognito-vinduer helt.
    pub exclude_incognito: bool,
    /// Brugerens udelukkelsesregler (app, titel eller URL).
    pub exclusion_rules: Vec<ExclusionRule>,
    /// Læs browserens adresselinje. Standard til (spec C9), kan fravælges.
    pub browser_url_capture: bool,
    /// Rødder, hvor et repo kan søges ud fra mappenavnet, når editorens
    /// state ikke kender stien. Tom = [`crate::editors::default_roots`].
    pub repo_roots: Vec<PathBuf>,
    pub poll_interval_ms: u64,
    /// Antal dage aktivitet gemmes lokalt.
    pub retention_days: u32,
}

pub const DEFAULT_MEETING_APPS: &[&str] = &[
    "teams",
    "zoom",
    "meet",
    "webex",
    "slack call",
    "facetime",
    "whereby",
];

impl Default for TrackerConfig {
    fn default() -> Self {
        Self {
            idle_threshold_secs: 300,
            min_segment_secs: 5,
            idle_prompt_threshold_secs: 600,
            idle_prompt_enabled: true,
            meeting_apps: DEFAULT_MEETING_APPS.iter().map(|s| s.to_string()).collect(),
            meeting_max_idle_secs: 120 * 60,
            exclude_incognito: true,
            exclusion_rules: Vec::new(),
            browser_url_capture: true,
            repo_roots: Vec::new(),
            poll_interval_ms: 2000,
            retention_days: 14,
        }
    }
}

impl TrackerConfig {
    pub fn poll_interval(&self) -> Duration {
        Duration::from_millis(self.poll_interval_ms.max(200))
    }

    /// Et hul mellem to polls, der er længere end dette, betyder at maskinen
    /// sov eller processen var frosset. Segmentet lukkes ved sidste poll.
    pub fn max_poll_gap_secs(&self) -> i64 {
        ((self.poll_interval_ms.max(200) * 5) / 1000).max(15) as i64
    }

    /// Splitter en komma- eller linjesepareret liste (som den gamle
    /// `meeting_apps`-indstilling) til trimmede tokens i små bogstaver.
    pub fn parse_list(raw: &str) -> Vec<String> {
        raw.split(['\n', ','])
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_list_splits_and_trims() {
        assert_eq!(
            TrackerConfig::parse_list(" Teams,\nZoom , ,\n\nGoogle Meet "),
            vec!["teams", "zoom", "google meet"]
        );
    }

    #[test]
    fn defaults_match_old_app_and_spec() {
        let c = TrackerConfig::default();
        assert_eq!(c.idle_threshold_secs, 300);
        assert_eq!(c.idle_prompt_threshold_secs, 600);
        assert_eq!(c.meeting_max_idle_secs, 7200);
        assert!(
            c.browser_url_capture,
            "URL-capture er standard til (spec C9)"
        );
        assert_eq!(c.retention_days, 14);
        assert!(c.max_poll_gap_secs() >= 10);
    }

    #[test]
    fn config_roundtrips_and_fills_defaults() {
        let c: TrackerConfig = serde_json::from_str(r#"{"idleThresholdSecs": 60}"#).unwrap();
        assert_eq!(c.idle_threshold_secs, 60);
        assert_eq!(c.min_segment_secs, 5);
        let back: TrackerConfig =
            serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }
}
