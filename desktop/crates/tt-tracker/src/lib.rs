//! # tt-tracker
//!
//! Aktivitetssporing for TimeTrack Desktop 1.0, uden Tauri.
//!
//! ```text
//! Platform (macOS/Windows FFI)
//!   → Enricher (udelukkelse, titel, URL, editor/terminal-mappe, git-remote)
//!     → Segmenter (idle-fratræk, søvn, A→B→A, minimumsvarighed)
//!       → ActivityStore (SQLite, UTC, 14 dages retention)
//!       → TrackerEvent via callback eller kanal
//! ```
//!
//! Rå aktivitet forlader aldrig maskinen (spec D3). Klassificering (kunde,
//! projekt) hører til `tt-matcher`; denne crate leverer kun signalerne.
//!
//! ```no_run
//! use tt_tracker::{Tracker, TrackerConfig, TrackerEvent, platform};
//!
//! let (tracker, rx) = Tracker::start_with_channel(
//!     TrackerConfig::default(),
//!     Some("activity.db".into()),
//!     platform::native(),
//! )?;
//! for ev in rx {
//!     if let TrackerEvent::Segment(seg) = ev {
//!         println!("{} {} {}s", seg.app, seg.title, seg.duration_secs());
//!     }
//! }
//! # Ok::<(), tt_tracker::StoreError>(())
//! ```

pub mod config;
pub mod day;
pub mod editors;
pub mod enrich;
pub mod exclusion;
pub mod git;
pub mod paths;
pub mod platform;
pub mod process_context;
pub mod segmenter;
pub mod signals;
pub mod store;
pub mod testing;
pub mod title;
pub mod tracker;
pub mod types;
pub mod url;
mod util;

pub use config::TrackerConfig;
pub use exclusion::ExclusionRule;
pub use platform::permissions::{Permission, PermissionState, PermissionStatus};
pub use platform::{CAPTURE_SUPPORTED, Platform, native};
pub use store::{ActivityStore, StoreError, StoreStats, StoredExclusionRule};
pub use tracker::{EventSink, Tracker};
pub use types::{ActivitySegment, BrowserUrl, RawWindow, Signals, TrackerEvent};
