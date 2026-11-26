//! TimeTracks forretningsregler som ren Rust: ingen UI, ingen IO, ingen async.
//!
//! Desktop-appen (GPUI eller Tauri) regner med disse funktioner, så lokal
//! tilstand giver præcis de samme tal som web (`mahope/timetrack`), der er
//! sandheden. Hver funktion nævner sin web-kilde; `tests/parity.rs` kører
//! fixtures genereret af web-koden selv (`tests/parity/generate.ts`).
//!
//! - [`klippekort`]: auto-valg, udløb, saldo, træk med overløb, tilbageførsel
//! - [`huller`]: klippekortet som fyldte og tomme huller
//! - [`afrunding`]: afrunding af tid (interval og retning)
//! - [`timepris`]: timepris-hierarkiet og planlagte prisskift
//! - [`faktura`]: linjebeløb, moms, forhåndsvisning, fakturanumre, momsoverblik
//! - [`format`]: "7,5 t", "45 min", "850 kr./t"
//! - [`tid`]: danske kalenderdage og datogrænser
//! - [`edition`]: brandet (TimeTrack eller TimeWren) som byggekonfiguration
//! - [`js`]: JavaScript-kompatibel afrunding og talformat, som reglerne hviler på

pub mod afrunding;
pub mod edition;
pub mod faktura;
pub mod format;
pub mod huller;
pub mod js;
pub mod klippekort;
pub mod tid;
pub mod timepris;
