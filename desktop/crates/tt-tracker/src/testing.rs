//! En scriptet platform til tests og demoer (fx UI-skærmbilleder uden
//! rigtige vinduer). Uret går frem med hver `sleep`, så en hel arbejdsdag kan
//! afspilles på millisekunder.

use std::time::Duration;

use chrono::{DateTime, Utc};

use crate::platform::{Platform, StopSignal};
use crate::types::{BrowserUrl, RawWindow};

#[derive(Debug, Clone, Default)]
pub struct Frame {
    pub window: Option<RawWindow>,
    pub idle_secs: u64,
}

#[derive(Debug, Clone, Default)]
pub struct ScriptedPlatform {
    pub frames: Vec<Frame>,
    pub index: usize,
    pub clock: DateTime<Utc>,
    /// Svar på `browser_url`.
    pub url: Option<String>,
    pub url_calls: usize,
    /// Browseren melder vinduet privat.
    pub private: bool,
    /// Svar på `terminal_cwd`.
    pub cwd: Option<String>,
    /// Stop trackeren, når scriptet er spillet færdigt.
    pub stop_when_done: bool,
}

impl ScriptedPlatform {
    pub fn new(start: DateTime<Utc>, frames: Vec<Frame>) -> Self {
        Self {
            frames,
            clock: start,
            stop_when_done: true,
            ..Self::default()
        }
    }

    fn frame(&self) -> Option<&Frame> {
        self.frames.get(self.index)
    }
}

impl Platform for ScriptedPlatform {
    fn foreground(&mut self) -> Option<RawWindow> {
        self.frame().and_then(|f| f.window.clone())
    }

    fn idle_seconds(&mut self) -> u64 {
        self.frame().map_or(0, |f| f.idle_secs)
    }

    fn browser_url(&mut self, _w: &RawWindow) -> BrowserUrl {
        self.url_calls += 1;
        if self.private {
            return BrowserUrl::Private;
        }
        self.url
            .clone()
            .map_or(BrowserUrl::Unknown, BrowserUrl::Url)
    }

    fn terminal_cwd(&mut self, _w: &RawWindow) -> Option<String> {
        self.cwd.clone()
    }

    fn process_tree_allowed(&self) -> bool {
        false
    }

    fn now(&mut self) -> DateTime<Utc> {
        self.clock
    }

    fn sleep(&mut self, d: Duration, stop: &StopSignal) {
        self.clock += chrono::Duration::from_std(d).unwrap_or_default();
        self.index += 1;
        if self.stop_when_done && self.index >= self.frames.len() {
            stop.stop();
        }
    }
}
