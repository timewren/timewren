//! Aktivitet oven på datalaget: dagens poster markerer blokke som
//! registreret, og "Tildel" opretter poster, før detektionen lærer.

use chrono::{NaiveDate, NaiveTime};

use super::RepoBackend;
use crate::backend::services::RegisteredSpan;
use crate::backend::*;

/// Nabo-blokke med højst så mange sekunder imellem bliver én post.
const JOIN_GAP_SECS: i64 = 60;

impl RepoBackend {
    pub(super) fn activity_day_impl(&self, date: NaiveDate) -> Result<ActivityDay> {
        let (customers, projects) = self.catalog()?;
        let registered = registered_spans(&self.entries(DateRange::day(date))?);
        let detection = &self.shared.opts.detection;
        detection.set_web_catalog(self.web_catalog());
        detection.activity_day(date, &customers, &projects, &registered)
    }

    /// Fletter blokkene og alt imellem dem. Registrerede blokke og pauser
    /// kan ikke flettes ind: så kunne Tildel registrere dem igen.
    pub(super) fn merge_activity_impl(&self, date: NaiveDate, block_ids: &[Id]) -> Result<()> {
        let spans = block_spans(block_ids)?;
        if spans.len() < 2 {
            return Err(BackendError::Validation("Vælg mindst to blokke".into()));
        }
        let span = (spans[0].0, spans.iter().map(|s| s.1).max().unwrap_or(spans[0].1));
        let day = self.activity_day_impl(date)?;
        let blocked = day.blocks.iter().any(|b| {
            block_span(&b.id).is_some_and(|(a, z)| a < span.1 && span.0 < z)
                && matches!(b.status, ActivityStatus::Registered | ActivityStatus::Idle)
        });
        if blocked {
            return Err(BackendError::Validation(
                "Registrerede blokke og pauser kan ikke flettes".into(),
            ));
        }
        self.shared.opts.detection.merge_activity(span)
    }

    pub(super) fn assign_activity_impl(
        &self,
        date: NaiveDate,
        input: AssignActivity,
    ) -> Result<AssignResult> {
        if input.customer_id.trim().is_empty() && input.project_id.is_none() {
            return Err(BackendError::Validation("Vælg en kunde".into()));
        }
        let spans = block_spans(&input.block_ids)?;
        let day = self.activity_day_impl(date)?;
        for id in &input.block_ids {
            let block = day
                .blocks
                .iter()
                .find(|b| &b.id == id)
                .ok_or_else(|| BackendError::NotFound("Blokken".into()))?;
            match block.status {
                ActivityStatus::Registered => {
                    return Err(BackendError::Conflict(
                        "Blokken er allerede registreret".into(),
                    ));
                }
                ActivityStatus::Idle => {
                    return Err(BackendError::Validation(
                        "En pause kan ikke registreres som arbejde".into(),
                    ));
                }
                _ => {}
            }
        }
        // En fletning kan dække en post, der er kommet til bagefter: den tid
        // er registreret og må ikke registreres igen.
        let registered: Vec<(i64, i64)> = registered_spans(&self.entries(DateRange::day(date))?)
            .iter()
            .map(|r| (r.start, r.end))
            .collect();
        let free = subtract_spans(&join_spans(&spans, JOIN_GAP_SECS), &registered);
        let mut entries = Vec::new();
        for (a, b) in free {
            let Some(input) = entry_input(date, a, b, &input) else {
                continue;
            };
            let mut input = input;
            if input.description.trim().is_empty() {
                input.description = "Uden beskrivelse".into();
            }
            entries.push(self.create_entry(input)?);
        }
        if entries.is_empty() {
            return Err(BackendError::Validation(
                "Blokkene er kortere end ét minut".into(),
            ));
        }
        let (customers, projects) = self.catalog()?;
        self.shared.opts.detection.activity_assigned(
            &spans,
            &input.customer_id,
            input.project_id.as_deref(),
            input.remember,
            &customers,
            &projects,
        );
        let mut similar = Vec::new();
        if input.remember {
            self.shared.trigger_pattern_sync();
            similar = similar_blocks(&self.activity_day_impl(date)?, &input);
        }
        Ok(AssignResult { entries, similar })
    }
}

/// Dagens poster med tidspunkt som tidsrum.
pub fn registered_spans(entries: &[Entry]) -> Vec<RegisteredSpan> {
    entries
        .iter()
        .filter_map(|e| {
            let start = local_ts(e.date, e.start?)?;
            let end = match e.end? {
                // Til midnat: slutningen er næste dags start.
                t if t == NaiveTime::MIN => local_ts(e.date.succ_opt()?, t)?,
                t => local_ts(e.date, t)?,
            };
            (end > start).then(|| RegisteredSpan {
                start,
                end,
                customer_id: Some(e.customer_id.clone()).filter(|c| !c.is_empty()),
                project_id: e.project_id.clone(),
            })
        })
        .collect()
}

/// Posten for tidsrummet `[a, b)` på `date`, eller `None`, hvis den er
/// under ét minut.
pub fn entry_input(date: NaiveDate, a: i64, b: i64, input: &AssignActivity) -> Option<EntryInput> {
    let (d0, t0) = local_minute(a)?;
    let (d1, mut t1) = local_minute(b)?;
    let start = if d0 < date { NaiveTime::MIN } else { t0 };
    if d1 > date {
        t1 = NaiveTime::from_hms_opt(23, 59, 0)?;
    }
    let minutes = (t1 - start).num_minutes();
    (minutes >= 1).then(|| EntryInput {
        customer_id: input.customer_id.clone(),
        project_id: input.project_id.clone(),
        task_id: input.task_id.clone(),
        description: input.description.clone(),
        date,
        start: Some(start),
        end: Some(t1),
        minutes: minutes as u32,
        billable: input.billable,
    })
}

/// Blokke, der efter læringen foreslås til samme mål.
pub fn similar_blocks(day: &ActivityDay, input: &AssignActivity) -> Vec<Id> {
    day.blocks
        .iter()
        .filter(|b| {
            b.status == ActivityStatus::Suggested
                && b.customer_id.as_deref().unwrap_or("") == input.customer_id
                && (input.project_id.is_none() || b.project_id == input.project_id)
        })
        .map(|b| b.id.clone())
        .collect()
}
