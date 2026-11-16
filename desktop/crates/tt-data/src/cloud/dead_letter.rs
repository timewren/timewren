//! Afviste registreringer (offline-køens dead-letter).
//!
//! En køet handling, som web afviser endeligt (4xx), mens brugeren ikke
//! venter på svaret, slettes ikke. Den flyttes hertil med web's fejlkode og
//! tekst, tidspunktet, org, bruger og den oprindelige `QueuedOp` (inkl.
//! `op_id`, `clientEntryId` og idempotensnøgle), så tiden kan sendes igen,
//! eksporteres eller kasseres. Køen bag den sendes videre.
//!
//! - Gemmes i cachens SQLite (`dead_letter`), som overlever genstart, logud
//!   og et tilbagekaldt token. Kun `discard` sletter.
//! - Hver post hører til en bruger og vises og sendes kun for den bruger.
//! - Et nyt forsøg lægger handlingen i den almindelige kø med samme `op_id`
//!   og samme nøgler. Lykkes det, er den væk her. Afvises den igen, ligger
//!   den her med den nye fejltekst. Er appen offline, bliver den i køen.

use chrono::{DateTime, Local, Utc};
use serde_json::Value;

use crate::error::DataError;
use crate::model::TimeEntry;
use crate::unsynced_csv;

use super::queue::{CreateKind, Op, QueuedOp, apply_patch, provisional_entry};

/// Fejlkoden for en kø, der blev gemt offline af en anden bruger (ikke en
/// afvisning fra web: den er aldrig sendt).
pub const OTHER_USER: &str = "OTHER_USER";

/// En afvist registrering.
#[derive(Debug, Clone, PartialEq)]
pub struct DeadLetter {
    pub op: QueuedOp,
    /// Brugeren, handlingen blev lavet af. Kun den bruger ser og sender den.
    pub user_id: String,
    /// Web's tRPC-kode (fx `FORBIDDEN`, `BAD_REQUEST`, `CONFLICT`).
    pub error_code: Option<String>,
    /// Web's danske fejltekst.
    pub error_message: String,
    /// HTTP-status fra web, hvis kendt.
    pub status: Option<u16>,
    /// Seneste afvisning.
    pub rejected_at: DateTime<Utc>,
    /// Antal afvisninger (første + nye forsøg).
    pub attempts: u32,
    /// Kundens og projektets navn fra cachen, hvis kendt.
    pub client_name: Option<String>,
    pub project_name: Option<String>,
}

/// Resultatet af et nyt forsøg.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RetryOutcome {
    /// Accepteret af web (væk fra de afviste).
    pub sent: usize,
    /// Afvist igen (ligger der stadig med den nye fejltekst).
    pub rejected: usize,
    /// Ikke sendt endnu (offline): ligger i den almindelige kø.
    pub queued: usize,
}

/// (kode, tekst, status) fra en endelig afvisning.
pub fn error_parts(e: &DataError) -> (Option<String>, String, Option<u16>) {
    match e {
        DataError::Rejected { code, message, status, .. } => (Some(code.clone()), message.clone(), Some(*status)),
        DataError::NotFound => (Some("NOT_FOUND".into()), e.to_string(), Some(404)),
        DataError::Validation(m) => (Some("BAD_REQUEST".into()), m.clone(), Some(400)),
        other => (None, other.to_string(), None),
    }
}

impl DeadLetter {
    pub fn op_id(&self) -> &str {
        &self.op.op_id
    }

    /// Posten, som den ville se ud på serveren: en ny post eller en rettelse
    /// med kendt grundlag. Andre handlinger er ikke tidsposter (`None`).
    pub fn entry(&self) -> Option<TimeEntry> {
        match &self.op.op {
            Op::CreateEntry { temp_id, input } => Some(provisional_entry(temp_id, input, self.op.created_at)),
            Op::UpdateEntry { patch, base: Some(base), .. } => {
                let mut e = (**base).clone();
                apply_patch(&mut e, patch);
                Some(e)
            }
            _ => None,
        }
    }

    /// Stabil nøgle for handlingens art (til oversættelse i UI'et).
    pub fn kind(&self) -> &'static str {
        match &self.op.op {
            Op::CreateEntry { .. } => "create_entry",
            Op::UpdateEntry { .. } => "update_entry",
            Op::DeleteEntry { .. } => "delete_entry",
            Op::ArchiveClient { .. } => "archive_client",
            Op::UnarchiveClient { .. } => "unarchive_client",
            Op::SetProjectStatus { .. } => "project_status",
            Op::UpdateTask { .. } => "update_task",
            Op::SetTaskStatus { .. } | Op::MoveTask { .. } => "task_status",
            Op::Create { kind: CreateKind::Client, .. } => "create_client",
            Op::Create { kind: CreateKind::Project, .. } => "create_project",
            Op::Create { kind: CreateKind::Task, .. } => "create_task",
            Op::Create { kind: CreateKind::Klippekort, .. } => "create_klippekort",
        }
    }

    /// Navnet på det, der oprettes (kunde, projekt, opgave, klippekort).
    pub fn subject(&self) -> Option<String> {
        match &self.op.op {
            Op::Create { data, .. } => ["name", "title"]
                .iter()
                .find_map(|k| data.get(*k).and_then(Value::as_str))
                .map(str::to_owned),
            _ => None,
        }
    }

    /// Dansk beskrivelse af handlingen (fx "Ny tidspost").
    pub fn describe(&self) -> String {
        let what = match self.kind() {
            "create_entry" => "Ny tidspost",
            "update_entry" => "Rettelse af tidspost",
            "delete_entry" => "Sletning af tidspost",
            "archive_client" => "Arkivering af kunde",
            "unarchive_client" => "Genåbning af kunde",
            "project_status" => "Ny status på projekt",
            "update_task" => "Rettelse af opgave",
            "task_status" => "Ny status på opgave",
            "create_client" => "Ny kunde",
            "create_project" => "Nyt projekt",
            "create_task" => "Ny opgave",
            _ => "Nyt klippekort",
        };
        match self.subject() {
            Some(s) => format!("{what}: {s}"),
            None => what.to_owned(),
        }
    }

    /// Rækken i CSV'en. Kun tidsposter (ny post og rettelse med kendt
    /// grundlag); andre handlinger har ingen tid at redde og udelades.
    pub fn csv_row(&self) -> Option<unsynced_csv::Row> {
        let e = self.entry()?;
        let local = |t: Option<DateTime<Utc>>| {
            t.map(|t| t.with_timezone(&Local).format("%H:%M").to_string()).unwrap_or_default()
        };
        let description = e.description.clone().unwrap_or_default();
        Some(unsynced_csv::Row {
            date: e.date.format("%Y-%m-%d").to_string(),
            start: local(e.start_time),
            end: local(e.end_time),
            hours: unsynced_csv::hours(e.hours),
            client: self.client_name.clone().unwrap_or_default(),
            project: self.project_name.clone().unwrap_or_default(),
            description: if matches!(self.op.op, Op::UpdateEntry { .. }) {
                format!("Rettelse: {description}")
            } else {
                description
            },
        })
    }
}

/// CSV i samme format som migreringens `ikke-synkroniseret-fra-0.2.csv`.
pub fn csv(items: &[DeadLetter]) -> String {
    let rows: Vec<_> = items.iter().filter_map(DeadLetter::csv_row).collect();
    unsynced_csv::write(&rows)
}
