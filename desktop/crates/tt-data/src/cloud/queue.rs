//! Handlinger, der kan ligge i offline-køen. Kun idempotente skrivninger:
//!
//! - Ny post: `clientEntryId` gør et gentaget kald til samme post.
//! - Ret, arkivér, status: sætter felter; at sende dem igen er harmløst.
//! - Slet: `NOT_FOUND` ved gentagelse betyder "allerede slettet" = succes.
//!
//! - Ny kunde, projekt, opgave eller klippekort (`Op::Create`): en
//!   `idempotencyKey` dannes én gang og gemmes med handlingen, så hvert
//!   forsøg (også efter genstart) sender samme nøgle. Web giver samme række
//!   for samme nøgle inden for 24 timer og `CONFLICT`, mens den første
//!   oprettelse kører (så bliver handlingen i køen).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::events::Entity;
use crate::model::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Op {
    #[serde(rename_all = "camelCase")]
    CreateEntry { temp_id: String, input: NewTimeEntry },
    /// `base` er posten, som den så ud, da rettelsen blev lavet. Web's
    /// `time.update` erstatter hele posten, så rettelsen lægges oven på den.
    UpdateEntry {
        id: String,
        patch: TimeEntryPatch,
        #[serde(default)]
        base: Option<Box<TimeEntry>>,
    },
    DeleteEntry { id: String },
    ArchiveClient { id: String },
    UnarchiveClient { id: String },
    SetProjectStatus { id: String, status: ProjectStatus },
    UpdateTask { id: String, patch: TaskPatch },
    SetTaskStatus { id: String, status: TaskStatus },
    /// Flyt til en kolonne (egne statusser). Sætter felter, så en gentagelse
    /// er harmløs.
    #[serde(rename_all = "camelCase")]
    MoveTask {
        id: String,
        status_id: String,
        #[serde(default)]
        ordered_task_ids: Option<Vec<String>>,
    },
    /// Oprettelse med idempotensnøgle. `data` er procedurens `data`.
    #[serde(rename_all = "camelCase")]
    Create { kind: CreateKind, idempotency_key: String, data: Value },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CreateKind {
    Client,
    Project,
    Task,
    Klippekort,
}

impl CreateKind {
    pub fn procedure(self) -> &'static str {
        match self {
            CreateKind::Client => "extension.clients.create",
            CreateKind::Project => "extension.projects.create",
            CreateKind::Task => "extension.tasks.create",
            CreateKind::Klippekort => "extension.klippekort.create",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueuedOp {
    pub op_id: String,
    pub op: Op,
    pub created_at: DateTime<Utc>,
    /// Organisationen, handlingen blev lavet i; den sendes altid dertil,
    /// også hvis brugeren har skiftet org siden.
    pub organization_id: Option<String>,
}

impl Op {
    /// Procedure og input (uden token/org) med id'er oversat via `resolve`.
    pub fn request(&self, resolve: &dyn Fn(&str) -> String) -> (&'static str, Value, &'static [&'static str]) {
        match self {
            Op::CreateEntry { input, .. } => {
                let mut input = input.clone();
                input.task_id = input.task_id.map(|t| resolve(&t));
                input.prepaid_auto = false;
                // Web afviser `noPrepaid` sammen med et kort.
                input.no_prepaid &= input.prepaid_package_id.is_none();
                ("extension.entries.create", json!({ "data": input }), &[])
            }
            Op::UpdateEntry { id, patch, base } => {
                let data = match base {
                    Some(base) => {
                        let mut e = (**base).clone();
                        apply_patch(&mut e, patch);
                        e.task_id = e.task_id.map(|t| resolve(&t));
                        // Skifter projekt, kunde eller dato, må web regne
                        // timeprisen om; ellers beholdes postens egen.
                        let keep_rate = patch.project_id.is_none() && patch.client_id.is_none() && patch.date.is_none();
                        let clear_times = matches!(patch.start_time, Some(None)) || matches!(patch.end_time, Some(None));
                        super::wire::entry_update_data(&e, keep_rate, clear_times)
                    }
                    // Ukendt post: web afviser en delvis rettelse (BAD_REQUEST),
                    // og afvisningen meldes til brugeren.
                    None => serde_json::to_value(patch).unwrap_or_default(),
                };
                ("extension.entries.update", json!({ "id": resolve(id), "data": data }), &[])
            }
            Op::DeleteEntry { id } => ("extension.entries.delete", json!({ "id": resolve(id) }), &[]),
            Op::ArchiveClient { id } => ("extension.clients.archive", json!({ "id": id }), &[]),
            Op::UnarchiveClient { id } => ("extension.clients.unarchive", json!({ "id": id }), &[]),
            Op::SetProjectStatus { id, status } => {
                ("extension.projects.setStatus", json!({ "id": id, "status": status.as_str() }), &[])
            }
            Op::UpdateTask { id, patch } => {
                let mut data = serde_json::to_value(patch).unwrap_or_default();
                data["id"] = json!(resolve(id));
                ("extension.tasks.update", json!({ "data": data }), &["data.deadline"])
            }
            Op::SetTaskStatus { id, status } => {
                ("extension.tasks.setStatus", json!({ "id": resolve(id), "status": status.as_str() }), &[])
            }
            Op::MoveTask { id, status_id, ordered_task_ids } => {
                let data = MoveTask {
                    task_id: resolve(id),
                    status_id: status_id.clone(),
                    ordered_task_ids: ordered_task_ids.as_ref().map(|v| v.iter().map(|t| resolve(t)).collect()),
                };
                ("extension.tasks.move", json!({ "data": data }), &[])
            }
            Op::Create { kind, idempotency_key, data } => {
                let dates: &'static [&'static str] = if *kind == CreateKind::Task { &["data.deadline"] } else { &[] };
                (kind.procedure(), json!({ "data": data, "idempotencyKey": idempotency_key }), dates)
            }
        }
    }

    pub fn entities(&self) -> &'static [Entity] {
        match self {
            Op::CreateEntry { .. } | Op::UpdateEntry { .. } | Op::DeleteEntry { .. } => {
                &[Entity::Entries, Entity::Klippekort, Entity::Tasks]
            }
            Op::ArchiveClient { .. } | Op::UnarchiveClient { .. } => &[Entity::Clients],
            Op::SetProjectStatus { .. } => &[Entity::Projects, Entity::Rules],
            Op::UpdateTask { .. } | Op::SetTaskStatus { .. } | Op::MoveTask { .. } => &[Entity::Tasks],
            Op::Create { kind: CreateKind::Client, .. } => &[Entity::Clients, Entity::Entitlements],
            Op::Create { kind: CreateKind::Project, .. } => &[Entity::Projects, Entity::Rules],
            Op::Create { kind: CreateKind::Task, .. } => &[Entity::Tasks],
            Op::Create { kind: CreateKind::Klippekort, .. } => &[Entity::Klippekort],
        }
    }

    pub fn is_create(&self) -> bool {
        matches!(self, Op::Create { .. })
    }

    /// En ny post med et automatisk valgt klippekort: samme post uden kort
    /// (samme `clientEntryId`), til når web afviser kortet.
    pub fn without_auto_card(&self) -> Option<Op> {
        match self {
            Op::CreateEntry { temp_id, input } if input.prepaid_auto && input.prepaid_package_id.is_some() => {
                Some(Op::CreateEntry {
                    temp_id: temp_id.clone(),
                    input: NewTimeEntry { prepaid_package_id: None, prepaid_auto: false, ..input.clone() },
                })
            }
            _ => None,
        }
    }

    /// Gentaget sletning af noget, der allerede er væk, er en succes.
    pub fn not_found_is_success(&self) -> bool {
        matches!(self, Op::DeleteEntry { .. })
    }
}

pub fn apply_patch(e: &mut TimeEntry, p: &TimeEntryPatch) {
    if let Some(v) = &p.project_id {
        e.project_id = v.clone();
    }
    if let Some(v) = &p.client_id {
        e.client_id = v.clone();
    }
    if let Some(v) = &p.description {
        e.description = Some(v.clone());
    }
    if let Some(v) = &p.notes {
        e.notes = Some(v.clone());
    }
    if let Some(v) = p.hours {
        e.hours = v;
    }
    if let Some(v) = p.date {
        e.date = v;
    }
    if let Some(v) = p.start_time {
        e.start_time = v;
    }
    if let Some(v) = p.end_time {
        e.end_time = v;
    }
    if let Some(v) = p.is_billable {
        e.is_billable = Some(v);
    }
    if let Some(v) = &p.task_id {
        e.task_id = v.clone();
    }
}

/// Den foreløbige post, UI'et viser, mens en ny post venter i køen.
pub fn provisional_entry(temp_id: &str, input: &NewTimeEntry, now: DateTime<Utc>) -> TimeEntry {
    TimeEntry {
        id: temp_id.to_owned(),
        project_id: input.project_id.clone(),
        client_id: input.client_id.clone(),
        task_id: input.task_id.clone(),
        prepaid_package_id: input.prepaid_package_id.clone(),
        description: Some(input.description.clone()),
        notes: input.notes.clone(),
        hours: input.hours,
        date: input.date,
        start_time: input.start_time,
        end_time: input.end_time,
        is_billable: input.is_billable,
        is_billed: Some(false),
        is_prepaid: Some(input.prepaid_package_id.is_some()),
        source: Some(if input.from_timer == Some(true) { "timer".into() } else { "manual".into() }),
        client_entry_id: input.client_entry_id.clone(),
        timer_session_id: input.timer_session_id.clone(),
        created_at: Some(now),
        updated_at: Some(now),
        pending: true,
        ..TimeEntry::default()
    }
}

/// Læg køens ventende ændringer oven på en liste fra serveren/cachen, så
/// UI'et ser sine egne offline-handlinger.
pub fn overlay_entries(
    mut entries: Vec<TimeEntry>,
    pending: &[QueuedOp],
    filter: &EntryFilter,
    now: DateTime<Utc>,
) -> Vec<TimeEntry> {
    for q in pending {
        match &q.op {
            Op::CreateEntry { temp_id, input } => {
                let already = entries.iter().any(|e| {
                    e.id == *temp_id || (e.client_entry_id.is_some() && e.client_entry_id == input.client_entry_id)
                });
                if !already {
                    entries.push(provisional_entry(temp_id, input, now));
                }
            }
            Op::UpdateEntry { id, patch, .. } => {
                if let Some(e) = entries.iter_mut().find(|e| e.id == *id) {
                    apply_patch(e, patch);
                    e.pending = true;
                }
            }
            Op::DeleteEntry { id } => entries.retain(|e| e.id != *id),
            _ => {}
        }
    }
    entries.retain(|e| filter.matches(e));
    entries
}

/// Læg køens ventende statusskift og flyt oven på opgavelisten, så en
/// genindlæsning offline viser kortet, hvor brugeren lagde det. `lanes` er
/// de sidst kendte kolonner (kategorien giver den gamle status).
pub fn overlay_tasks(mut tasks: Vec<Task>, pending: &[QueuedOp], lanes: &[TaskLane], filter: &TaskFilter) -> Vec<Task> {
    for q in pending {
        match &q.op {
            Op::SetTaskStatus { id, status } => {
                if let Some(t) = tasks.iter_mut().find(|t| t.id == *id) {
                    t.status = *status;
                }
            }
            Op::MoveTask { id, status_id, .. } => {
                if let Some(t) = tasks.iter_mut().find(|t| t.id == *id) {
                    if let Some(lane) = lanes.iter().find(|l| l.id == *status_id) {
                        t.status = lane.legacy_status(t.status);
                    }
                    t.status_id = Some(status_id.clone());
                }
            }
            _ => {}
        }
    }
    if let Some(s) = filter.status {
        tasks.retain(|t| t.status == s);
    }
    tasks
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn input(desc: &str, day: u32) -> NewTimeEntry {
        NewTimeEntry {
            description: desc.into(),
            hours: "1".parse().unwrap(),
            date: NaiveDate::from_ymd_opt(2026, 10, day).unwrap(),
            client_entry_id: Some(format!("k-{desc}")),
            ..Default::default()
        }
    }

    #[test]
    fn overlay_applies_pending_ops_in_order() {
        let now = Utc::now();
        let server = vec![TimeEntry {
            id: "e1".into(),
            description: Some("Gammel".into()),
            date: NaiveDate::from_ymd_opt(2026, 10, 26).unwrap(),
            ..Default::default()
        }];
        let pending = vec![
            QueuedOp { op_id: "1".into(), op: Op::CreateEntry { temp_id: "t1".into(), input: input("Ny", 26) }, created_at: now, organization_id: None },
            QueuedOp { op_id: "2".into(), op: Op::CreateEntry { temp_id: "t2".into(), input: input("Anden dag", 20) }, created_at: now, organization_id: None },
            QueuedOp {
                op_id: "3".into(),
                op: Op::UpdateEntry {
                    id: "t1".into(),
                    patch: TimeEntryPatch { description: Some("Rettet".into()), ..Default::default() },
                    base: None,
                },
                created_at: now,
                organization_id: None,
            },
            QueuedOp { op_id: "4".into(), op: Op::DeleteEntry { id: "e1".into() }, created_at: now, organization_id: None },
        ];
        let day = EntryFilter::day(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
        let out = overlay_entries(server, &pending, &day, now);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "t1");
        assert_eq!(out[0].description.as_deref(), Some("Rettet"));
        assert!(out[0].pending);
    }

    #[test]
    fn overlay_skips_create_already_on_server() {
        let now = Utc::now();
        let i = input("Ny", 26);
        let server = vec![TimeEntry {
            id: "real".into(),
            client_entry_id: i.client_entry_id.clone(),
            date: i.date,
            ..Default::default()
        }];
        let pending = vec![QueuedOp { op_id: "1".into(), op: Op::CreateEntry { temp_id: "t".into(), input: i }, created_at: now, organization_id: None }];
        assert_eq!(overlay_entries(server, &pending, &EntryFilter::default(), now).len(), 1);
    }

    #[test]
    fn ops_round_trip_as_json() {
        let op = Op::SetTaskStatus { id: "x".into(), status: TaskStatus::InProgress };
        let s = serde_json::to_string(&op).unwrap();
        assert_eq!(serde_json::from_str::<Op>(&s).unwrap(), op);
        let (proc_, input, _) = op.request(&|id| format!("{id}!"));
        assert_eq!(proc_, "extension.tasks.setStatus");
        assert_eq!(input["id"], "x!");
        assert_eq!(input["status"], "in_progress");
    }

    #[test]
    fn move_task_sends_web_move_with_resolved_ids() {
        let op = Op::MoveTask {
            id: "t".into(),
            status_id: "lane".into(),
            ordered_task_ids: Some(vec!["a".into(), "t".into()]),
        };
        let s = serde_json::to_string(&op).unwrap();
        assert_eq!(serde_json::from_str::<Op>(&s).unwrap(), op);
        let (proc_, input, _) = op.request(&|id| format!("{id}!"));
        assert_eq!(proc_, "extension.tasks.move");
        assert_eq!(input, json!({ "data": { "taskId": "t!", "statusId": "lane", "orderedTaskIds": ["a!", "t!"] } }));
        let op = Op::MoveTask { id: "t".into(), status_id: "lane".into(), ordered_task_ids: None };
        let (_, input, _) = op.request(&|id| id.to_owned());
        assert_eq!(input, json!({ "data": { "taskId": "t", "statusId": "lane" } }));
        assert_eq!(op.entities(), &[Entity::Tasks]);
    }
}
