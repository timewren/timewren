//! `tt-matcher`: motoren der gør aktivitet til forslag.
//!
//! Ren Rust uden IO. Ind: [`ActivitySegment`]er og et [`Catalog`] (kunder,
//! projekter, regler, identiteter, site-koblinger) plus lærte mønstre
//! ([`PatternStore`]). Ud: [`Suggestion`]er – sammenhængende blokke med
//! konfidens, dansk begrundelse og kilde, som brugeren bekræfter, retter eller
//! afviser.
//!
//! ```
//! use tt_matcher::{ActivitySegment, Catalog, Client, Matcher, PatternStore};
//!
//! let catalog = Catalog {
//!     clients: vec![Client { id: "c1".into(), name: "Bageriet på hjørnet".into(), ..Default::default() }],
//!     ..Default::default()
//! };
//! let matcher = Matcher::new(catalog, PatternStore::new());
//! let day = vec![ActivitySegment {
//!     app: "Google Chrome".into(),
//!     url: Some("https://xn--bagerietphjrnet-plb93a.dk/admin".into()),
//!     start: 9 * 3600,
//!     end: 11 * 3600,
//!     ..Default::default()
//! }];
//! let suggestions = matcher.suggest(&day);
//! assert_eq!(suggestions[0].target.as_ref().unwrap().client_id.as_deref(), Some("c1"));
//! ```

pub mod anonymize;
pub mod bench;
pub mod blocks;
pub mod classifier;
pub mod glob;
pub mod labelset;
pub mod learning;
pub mod matcher;
pub mod metrics;
pub mod model;
pub mod names;
pub mod nb;
pub mod normalize;
pub mod observe;
pub mod profile;
pub mod rank;
pub mod smooth;
pub mod synthetic;
pub mod synthetic2;
pub mod synthetic3;
pub mod tasks;
pub mod types;

pub use blocks::{format_span, label};
pub use classifier::{
    Classifier, ClassifierAnswer, ClassifierError, ClassifierOption, ClassifyRequest, ResolveReport,
};
pub use learning::{Feedback, LearnedPattern, PatternHit, PatternKey, PatternStore};
pub use matcher::{MatchConfig, Matcher, ModelMode};
pub use model::UserModel;
pub use observe::{ObservedGroup, ObservedSource, ObserverAnswer, ObserverState, ObserverStatus};
pub use tasks::{TaskRef, TaskSuggestion, suggest_task};
pub use rank::{Scored, TargetUsage, UsageStore};
pub use types::*;
