//! Timepris for en registrering: medlemssats → projekt → kunde → bruger, og
//! planlagte prisskift, der gælder fra en dato.
//!
//! Web: `getRateFromCache` i `src/lib/trpc/routers/time.ts:413-511` og
//! `src/lib/rates/scheduled.ts`. Satser er decimalstrenge ("800.00") som i
//! web, så en tom eller manglende sats falder videre i hierarkiet præcis som
//! der; brug [`rate_value`] for tallet.
//!
//! Prisskift: en registrering stemples efter SIN dato (dansk tid), ikke efter
//! hvornår den oprettes.
//! a. Den seneste ikke-anvendte ændring med ikrafttræden ≤ dato giver dens nye sats.
//! b. Ellers giver den tidligste ANVENDTE ændring efter datoen sin gamle sats.
//! c. Ellers den nuværende sats.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{js, tid};

/// En planlagt eller anvendt satsændring for en kunde eller et projekt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledRateChange {
    pub id: String,
    pub client_id: Option<String>,
    pub project_id: Option<String>,
    pub new_rate: String,
    pub old_rate: Option<String>,
    /// "yyyy-MM-dd"
    pub effective_date: String,
    pub applied_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// En registrerings dato som "yyyy-MM-dd" i dansk tid (`toRateDateKey`): en
/// ren dato bruges som den er; et tidspunkt læses i dansk tid.
pub fn rate_date_key(value: &str) -> Option<String> {
    let b = value.as_bytes();
    if b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return Some(value.to_string());
    }
    // Som `new Date(value)`: "T" eller mellemrum (SQLite) mellem dato og tid,
    // sekunder og brøkdele valgfri, zone som "Z", "+01:00" eller "+0100"
    let normalized = match value.as_bytes().get(10) {
        Some(b' ') => format!("{}T{}", &value[..10], &value[11..]),
        _ => value.to_string(),
    };
    let zoned = match normalized.strip_suffix('Z') {
        Some(rest) => format!("{rest}+00:00"),
        None => normalized.clone(),
    };
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f%#z", "%Y-%m-%dT%H:%M%#z"] {
        if let Ok(t) = DateTime::parse_from_str(&zoned, fmt) {
            return Some(tid::copenhagen_date(t.with_timezone(&Utc)).to_string());
        }
    }
    // Tidspunkt uden zone er lokal (dansk) tid i JavaScript
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(local) = NaiveDateTime::parse_from_str(&normalized, fmt) {
            return Some(tid::copenhagen_date(tid::browser_local_time(local)).to_string());
        }
    }
    None
}

/// [`rate_date_key`] for et tidspunkt.
pub fn rate_date_key_of(instant: DateTime<Utc>) -> String {
    tid::copenhagen_date(instant).to_string()
}

fn by_effective_then_created(
    a: &&ScheduledRateChange,
    b: &&ScheduledRateChange,
) -> std::cmp::Ordering {
    a.effective_date.cmp(&b.effective_date).then_with(|| {
        a.applied_at
            .unwrap_or(a.created_at)
            .cmp(&b.applied_at.unwrap_or(b.created_at))
    })
}

/// Satsen for én kunde/ét projekt på en dato (`resolveRateAtDate`). Uden dato
/// eller ændringer: den nuværende sats.
pub fn resolve_rate_at_date(
    changes: &[ScheduledRateChange],
    current_rate: Option<&str>,
    date: Option<&str>,
) -> Option<String> {
    let current = current_rate.map(str::to_string);
    let Some(date) = date.filter(|d| !d.is_empty()) else {
        return current;
    };
    if changes.is_empty() {
        return current;
    }
    let active: Vec<&ScheduledRateChange> = changes
        .iter()
        .filter(|c| c.cancelled_at.is_none())
        .collect();

    let mut pending: Vec<&ScheduledRateChange> = active
        .iter()
        .copied()
        .filter(|c| c.applied_at.is_none() && c.effective_date.as_str() <= date)
        .collect();
    pending.sort_by(by_effective_then_created);
    if let Some(last) = pending.last() {
        return Some(last.new_rate.clone());
    }

    let mut applied_after: Vec<&ScheduledRateChange> = active
        .iter()
        .copied()
        .filter(|c| c.applied_at.is_some() && c.effective_date.as_str() > date)
        .collect();
    applied_after.sort_by(by_effective_then_created);
    if let Some(first) = applied_after.first() {
        return first.old_rate.clone();
    }

    current
}

/// Ændringerne grupperet pr. kunde og projekt; annullerede udelades
/// (`indexScheduledChanges`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ScheduledChangeIndex {
    pub by_client: HashMap<String, Vec<ScheduledRateChange>>,
    pub by_project: HashMap<String, Vec<ScheduledRateChange>>,
}

impl ScheduledChangeIndex {
    pub fn new(changes: &[ScheduledRateChange]) -> Self {
        let mut index = Self::default();
        for change in changes.iter().filter(|c| c.cancelled_at.is_none()) {
            if let Some(project) = &change.project_id {
                index
                    .by_project
                    .entry(project.clone())
                    .or_default()
                    .push(change.clone());
            } else if let Some(client) = &change.client_id {
                index
                    .by_client
                    .entry(client.clone())
                    .or_default()
                    .push(change.clone());
            }
        }
        index
    }
}

/// Et projekts egen sats og kunde.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectRate {
    pub hourly_rate: Option<String>,
    pub client_id: Option<String>,
}

/// En medlemssats i en organisation (projekt, kunde eller hele org'en).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MemberRate {
    pub project_id: Option<String>,
    pub client_id: Option<String>,
    pub hourly_rate: String,
}

/// Alt, opslaget skal bruge (`RateLookupCache`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RateLookup {
    pub projects: HashMap<String, ProjectRate>,
    /// kunde-id → kundens standardsats
    pub clients: HashMap<String, Option<String>>,
    pub user_default_rate: Option<String>,
    pub member_rates: Vec<MemberRate>,
    /// Planlagte/anvendte satsændringer; `None` = slå dem ikke op.
    pub scheduled: Option<ScheduledChangeIndex>,
}

/// JavaScript-sandhed for en sats: `null` og "" falder videre.
fn truthy(rate: Option<String>) -> Option<String> {
    rate.filter(|r| !r.is_empty())
}

/// Timeprisen for en registrering (`getRateFromCache`):
///
/// 0. medlemssats for projektet, kunden eller org'en (i den rækkefølge)
/// 1. projektets sats
/// 2. projektets kundes sats
/// 3. den direkte kundes sats
/// 4. brugerens standardsats
///
/// Med en dato bruges planlagte prisskift på projekt- og kundeniveau.
pub fn rate_for_entry(
    lookup: &RateLookup,
    project_id: Option<&str>,
    client_id: Option<&str>,
    date: Option<&str>,
) -> Option<String> {
    let project_id = project_id.filter(|s| !s.is_empty());
    let client_id = client_id.filter(|s| !s.is_empty());

    if !lookup.member_rates.is_empty() {
        if let Some(pid) = project_id
            && let Some(r) = lookup
                .member_rates
                .iter()
                .find(|r| r.project_id.as_deref() == Some(pid))
        {
            return Some(r.hourly_rate.clone());
        }
        if let Some(cid) = client_id
            && let Some(r) = lookup
                .member_rates
                .iter()
                .find(|r| r.client_id.as_deref() == Some(cid) && r.project_id.is_none())
        {
            return Some(r.hourly_rate.clone());
        }
        if let Some(r) = lookup
            .member_rates
            .iter()
            .find(|r| r.project_id.is_none() && r.client_id.is_none())
        {
            return Some(r.hourly_rate.clone());
        }
    }

    let date_key = lookup.scheduled.as_ref().and(date).and_then(rate_date_key);
    let date_key = date_key.as_deref();
    let changes_for = |map: Option<&HashMap<String, Vec<ScheduledRateChange>>>,
                       id: &str|
     -> Vec<ScheduledRateChange> {
        match (date_key, map) {
            (Some(_), Some(m)) => m.get(id).cloned().unwrap_or_default(),
            _ => Vec::new(),
        }
    };
    let by_client = lookup.scheduled.as_ref().map(|s| &s.by_client);
    let by_project = lookup.scheduled.as_ref().map(|s| &s.by_project);
    let client_rate_at = |id: &str| {
        let current = lookup.clients.get(id).cloned().flatten();
        resolve_rate_at_date(&changes_for(by_client, id), current.as_deref(), date_key)
    };

    if let Some(pid) = project_id {
        let project = lookup.projects.get(pid);
        if let Some(project) = project {
            let rate = resolve_rate_at_date(
                &changes_for(by_project, pid),
                project.hourly_rate.as_deref(),
                date_key,
            );
            if let Some(rate) = truthy(rate) {
                return Some(rate);
            }
        }
        if let Some(pcid) = project
            .and_then(|p| p.client_id.as_deref())
            .filter(|c| !c.is_empty())
            && lookup.clients.contains_key(pcid)
            && let Some(rate) = truthy(client_rate_at(pcid))
        {
            return Some(rate);
        }
    }

    if let Some(cid) = client_id
        && lookup.clients.contains_key(cid)
        && let Some(rate) = truthy(client_rate_at(cid))
    {
        return Some(rate);
    }

    lookup.user_default_rate.clone()
}

/// Satsen som tal (`parseFloat`); 0 når den mangler eller ikke kan læses.
pub fn rate_value(rate: Option<&str>) -> f64 {
    let v = js::parse_float(rate.unwrap_or(""));
    if v.is_finite() { v } else { 0.0 }
}
