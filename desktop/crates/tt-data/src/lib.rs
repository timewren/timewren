//! # tt-data
//!
//! TimeTrack Desktop 1.0's datalag bag én grænseflade (spec A1):
//!
//! - [`Repository`]: async trait, som UI'et kender.
//! - [`CloudRepo`]: web-appens tRPC-API (samme som browserudvidelsen) med
//!   token-auth og refresh, SSE-live-strøm, SQLite-cache og offline-kø.
//! - [`LocalRepo`]: egen SQLite med hele modellen og versionerede migrationer.
//! - [`Events`]: hændelser, UI'et lytter på.
//! - [`import`]: lokal → cloud med dry-run-rapport.
//!
//! Rå aktivitet (apps, titler, URL'er) findes ikke i dette lag og sendes
//! aldrig (D3). Kun bekræftede poster og regler.

pub mod cloud;
pub mod core_rules;
pub mod error;
pub mod events;
pub mod import;
pub mod local;
#[cfg(feature = "mock")]
pub mod mock;
pub mod model;
pub mod repo;
pub mod report;
pub mod rules;
pub mod serde_util;
pub mod trpc;
pub mod unsynced_csv;

pub use error::{DataError, Result};
pub use events::{Entity, Event, Events, LogoutReason};
pub use cloud::auth::{Credentials, MemorySecretStore, SecretStore};
pub use cloud::{CloudConfig, CloudRepo};
pub use cloud::dead_letter::{DeadLetter, RetryOutcome};
pub use local::{Clock, LocalRepo};
pub use model::*;
pub use repo::Repository;
pub use core_rules::CoreRules;
pub use rules::{BusinessRules, DefaultRules};
