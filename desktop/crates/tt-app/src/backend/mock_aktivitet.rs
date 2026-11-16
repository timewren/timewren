//! Aktivitet i demoen: en fast dag med alle fem slags blokke, og
//! handlinger, der ændrer den i hukommelsen. // aktivitet

use chrono::{Days, NaiveDate, NaiveTime};

use super::*;

/// Demoens blokke (kun i dag).
#[derive(Default)]
pub(super) struct MockActivity {
    /// `None`, til dagen er bygget første gang.
    pub(super) blocks: Option<Vec<ActivityBlock>>,
    /// Udelukkelser fra 0.2 (`None` = demoens ene regel).
    pub(super) exclusions: Option<Vec<StoredExclusion>>,
}

fn t(h: u32, m: u32) -> NaiveTime {
    NaiveTime::from_hms_opt(h, m, 0).expect("gyldigt tidspunkt")
}

#[allow(clippy::too_many_arguments)]
fn block(
    date: NaiveDate,
    from: (u32, u32),
    to: (u32, u32),
    app: &str,
    title: &str,
    domain: Option<&str>,
    repo: Option<&str>,
    document: Option<&str>,
    status: ActivityStatus,
) -> ActivityBlock {
    let (start, end) = (t(from.0, from.1), t(to.0, to.1));
    let a = local_ts(date, start).unwrap_or(0);
    let b = local_ts(date, end).unwrap_or(a + 60);
    ActivityBlock {
        id: block_id(a, b),
        date,
        start,
        end,
        seconds: (b - a).max(0) as u32,
        app: app.into(),
        title: title.into(),
        url: domain.map(|d| format!("https://{d}/")),
        domain: domain.map(str::to_string),
        repo: repo.map(str::to_string),
        document: document.map(str::to_string),
        other_apps: vec![],
        folded: 0,
        status,
        customer_id: None,
        project_id: None,
        suggestion_id: None,
    }
}

/// Demodagen. Forslagene matcher demoens forslag (`forslag_1-3`).
pub(super) fn demo_day(date: NaiveDate) -> Vec<ActivityBlock> {
    use ActivityStatus::*;
    let target = |mut b: ActivityBlock, c: &str, p: Option<&str>, s: Option<&str>| {
        b.customer_id = Some(c.into());
        b.project_id = p.map(str::to_string);
        b.suggestion_id = s.map(str::to_string);
        b
    };
    let mut gamma = block(
        date,
        (11, 20),
        (12, 5),
        "Safari",
        "Ordre 41 – leverandørportal",
        Some("portal.example"),
        None,
        None,
        Unclear,
    );
    gamma.other_apps = vec!["Slack".into()];
    gamma.folded = 2;
    vec![
        block(
            date,
            (8, 5),
            (8, 40),
            "Mail",
            "Re: Tilbud på ny webshop",
            None,
            None,
            None,
            Unclear,
        ),
        target(
            block(
                date,
                (9, 0),
                (11, 0),
                "Code",
                "checkout.rs – bageriet-webshop",
                None,
                Some("github.com/eksempel/bageriet-webshop"),
                Some("src/checkout.rs"),
                Suggested,
            ),
            "kunde_bageriet",
            Some("proj_webshop"),
            Some("forslag_1"),
        ),
        block(date, (11, 0), (11, 20), "", "", None, None, None, Idle),
        gamma,
        block(
            date,
            (12, 5),
            (12, 30),
            "Safari",
            "Forsiden",
            Some("nyheder.example"),
            None,
            None,
            NotWork,
        ),
        target(
            block(
                date,
                (13, 30),
                (14, 15),
                "Mail",
                "Booking-modul, spørgsmål",
                None,
                None,
                None,
                Suggested,
            ),
            "kunde_klinik",
            Some("proj_booking"),
            Some("forslag_2"),
        ),
        block(
            date,
            (14, 20),
            (14, 50),
            "Figma",
            "Logo-skitser",
            None,
            None,
            Some("Logo v3"),
            Unclear,
        ),
        target(
            block(
                date,
                (15, 0),
                (16, 15),
                "Google Chrome",
                "Redesign, feedback – Google Docs",
                Some("docs.google.com"),
                None,
                Some("Redesign, feedback"),
                Suggested,
            ),
            "kunde_gartneriet",
            Some("proj_redesign"),
            Some("forslag_3"),
        ),
        target(
            block(
                date,
                (16, 30),
                (17, 10),
                "Code",
                "README.md – bageriet-webshop",
                None,
                Some("github.com/eksempel/bageriet-webshop"),
                Some("README.md"),
                Registered,
            ),
            "kunde_bageriet",
            Some("proj_webshop"),
            None,
        ),
    ]
}

/// Samme identitet som i motoren: program + det stærkeste signal.
fn identity(b: &ActivityBlock) -> (String, Option<String>) {
    (
        b.app.clone(),
        b.repo
            .clone()
            .or_else(|| b.domain.clone())
            .or_else(|| b.document.clone()),
    )
}

impl MockBackend {
    fn akt<T>(&self, f: impl FnOnce(&mut Vec<ActivityBlock>) -> Result<T>) -> Result<T> {
        if let Some(e) = self.fail.lock().expect("mock-lås").clone() {
            return Err(e);
        }
        let today = self.today;
        let mut a = self.aktivitet.lock().expect("mock-lås");
        let blocks = a.blocks.get_or_insert_with(|| demo_day(today));
        f(blocks)
    }

    pub(super) fn akt_day(&self, date: NaiveDate) -> Result<ActivityDay> {
        let earliest = self.today - Days::new(13);
        if date != self.today {
            return Ok(ActivityDay::empty(date, earliest));
        }
        // Forslag, der er bekræftet eller afvist siden, er afgjort.
        let open: Vec<Id> = self.suggestions(date)?.into_iter().map(|s| s.id).collect();
        self.akt(|blocks| {
            for b in blocks.iter_mut() {
                if b.status == ActivityStatus::Suggested
                    && b.suggestion_id.as_ref().is_some_and(|s| !open.contains(s))
                {
                    b.status = ActivityStatus::Registered;
                    b.suggestion_id = None;
                }
            }
            Ok(ActivityDay {
                date,
                blocks: blocks.clone(),
                earliest,
            })
        })
    }

    fn akt_find(blocks: &[ActivityBlock], ids: &[Id]) -> Result<Vec<usize>> {
        if ids.is_empty() {
            return Err(BackendError::Validation("Vælg mindst én blok".into()));
        }
        ids.iter()
            .map(|id| {
                blocks
                    .iter()
                    .position(|b| &b.id == id)
                    .ok_or_else(|| BackendError::NotFound("Blokken".into()))
            })
            .collect()
    }

    pub(super) fn akt_assign(
        &self,
        date: NaiveDate,
        input: AssignActivity,
    ) -> Result<AssignResult> {
        // Intern tid: et projekt uden kunde er nok (som RepoBackend).
        if input.customer_id.trim().is_empty() && input.project_id.is_none() {
            return Err(BackendError::Validation("Vælg en kunde".into()));
        }
        self.akt_day(date)?;
        let picked = self.akt(|blocks| {
            let ix = Self::akt_find(blocks, &input.block_ids)?;
            if ix.iter().any(|&i| {
                matches!(
                    blocks[i].status,
                    ActivityStatus::Registered | ActivityStatus::Idle
                )
            }) {
                return Err(BackendError::Conflict(
                    "Blokken er allerede registreret".into(),
                ));
            }
            Ok(ix.iter().map(|&i| blocks[i].clone()).collect::<Vec<_>>())
        })?;
        let mut entries = Vec::new();
        for b in &picked {
            entries.push(self.create_entry(EntryInput {
                customer_id: input.customer_id.clone(),
                project_id: input.project_id.clone(),
                task_id: input.task_id.clone(),
                description: if input.description.trim().is_empty() {
                    b.title.clone()
                } else {
                    input.description.clone()
                },
                date,
                start: Some(b.start),
                end: Some(b.end),
                minutes: b.minutes().max(1),
                billable: input.billable,
            })?);
        }
        let similar = self.akt(|blocks| {
            let ids: Vec<Id> = picked.iter().map(|b| b.id.clone()).collect();
            let keys: Vec<_> = picked.iter().map(identity).collect();
            let mut similar = Vec::new();
            for b in blocks.iter_mut() {
                if ids.contains(&b.id) {
                    b.status = ActivityStatus::Registered;
                    b.customer_id = Some(input.customer_id.clone());
                    b.project_id = input.project_id.clone();
                    b.suggestion_id = None;
                } else if input.remember
                    && b.status == ActivityStatus::Unclear
                    && keys.contains(&identity(b))
                {
                    b.status = ActivityStatus::Suggested;
                    b.customer_id = Some(input.customer_id.clone());
                    b.project_id = input.project_id.clone();
                    similar.push(b.id.clone());
                }
            }
            Ok(similar)
        })?;
        Ok(AssignResult { entries, similar })
    }

    pub(super) fn akt_set_status(&self, ids: &[Id], status: ActivityStatus) -> Result<()> {
        self.akt(|blocks| {
            for i in Self::akt_find(blocks, ids)? {
                blocks[i].status = status;
                blocks[i].suggestion_id = None;
            }
            Ok(())
        })
    }

    pub(super) fn akt_merge(&self, ids: &[Id]) -> Result<()> {
        self.akt(|blocks| {
            let mut ix = Self::akt_find(blocks, ids)?;
            if ix.len() < 2 {
                return Err(BackendError::Validation("Vælg mindst to blokke".into()));
            }
            ix.sort_unstable();
            let (first, last) = (ix[0], ix[ix.len() - 1]);
            if blocks[first..=last]
                .iter()
                .any(|b| matches!(b.status, ActivityStatus::Registered | ActivityStatus::Idle))
            {
                return Err(BackendError::Validation(
                    "Registrerede blokke og pauser kan ikke flettes".into(),
                ));
            }
            let mut merged = blocks[first].clone();
            for b in &blocks[first + 1..=last] {
                merged.seconds += b.seconds;
                merged.end = b.end;
                if b.app != merged.app && !merged.other_apps.contains(&b.app) && !b.app.is_empty() {
                    merged.other_apps.push(b.app.clone());
                }
            }
            let a = local_ts(merged.date, merged.start).unwrap_or(0);
            let z = local_ts(merged.date, merged.end).unwrap_or(a + 60);
            merged.id = block_id(a, z);
            blocks.splice(first..=last, [merged]);
            Ok(())
        })
    }

    pub(super) fn akt_split(&self, id: &str, at: NaiveTime) -> Result<()> {
        self.akt(|blocks| {
            let i = Self::akt_find(blocks, &[id.to_string()])?[0];
            let b = blocks[i].clone();
            if !(b.start < at && at < b.end) {
                return Err(BackendError::Validation(
                    "Tidspunktet skal ligge inde i blokken".into(),
                ));
            }
            let mid = local_ts(b.date, at).unwrap_or(0);
            let a = local_ts(b.date, b.start).unwrap_or(0);
            let z = local_ts(b.date, b.end).unwrap_or(0);
            let mut left = b.clone();
            left.end = at;
            left.seconds = (mid - a).max(0) as u32;
            left.id = block_id(a, mid);
            let mut right = b;
            right.start = at;
            right.seconds = (z - mid).max(0) as u32;
            right.id = block_id(mid, z);
            blocks.splice(i..=i, [left, right]);
            Ok(())
        })
    }

    pub(super) fn akt_delete(&self, ids: &[Id]) -> Result<()> {
        self.akt(|blocks| {
            let ix = Self::akt_find(blocks, ids)?;
            let mut i = 0;
            blocks.retain(|_| {
                i += 1;
                !ix.contains(&(i - 1))
            });
            Ok(())
        })
    }

    pub(super) fn akt_delete_all(&self) -> Result<()> {
        self.akt(|blocks| {
            blocks.clear();
            Ok(())
        })
    }

    pub(super) fn akt_exclusions(&self) -> Vec<StoredExclusion> {
        let mut a = self.aktivitet.lock().expect("mock-lås");
        a.exclusions
            .get_or_insert_with(|| {
                vec![StoredExclusion {
                    id: 1,
                    field: "window_title".into(),
                    op: "contains".into(),
                    value: "Privat".into(),
                }]
            })
            .clone()
    }

    pub(super) fn akt_remove_exclusion(&self, id: i64) {
        self.akt_exclusions();
        let mut a = self.aktivitet.lock().expect("mock-lås");
        if let Some(list) = a.exclusions.as_mut() {
            list.retain(|r| r.id != id);
        }
    }

    pub(super) fn akt_storage(&self) -> Result<ActivityStorage> {
        self.akt(|blocks| {
            Ok(ActivityStorage {
                days: if blocks.is_empty() { 0 } else { 9 },
                segments: if blocks.is_empty() { 0 } else { 1_248 },
                bytes: if blocks.is_empty() { 4_096 } else { 1_843_200 },
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 27).unwrap()
    }

    #[test]
    fn demodagen_har_alle_fem_slags_blokke() {
        let m = MockBackend::with_today(today());
        let d = m.activity_day(today()).unwrap();
        for s in ActivityStatus::ALL {
            assert!(d.blocks.iter().any(|b| b.status == s), "mangler {s:?}");
        }
        assert!(
            m.activity_day(today() - Days::new(1))
                .unwrap()
                .blocks
                .is_empty()
        );
    }

    #[test]
    fn tildel_med_husk_foreslaar_lignende_og_bekraeft_registrerer() {
        let m = MockBackend::with_today(today());
        let d = m.activity_day(today()).unwrap();
        let mail = d
            .blocks
            .iter()
            .find(|b| b.title.starts_with("Re:"))
            .unwrap();
        let out = m
            .assign_activity(
                today(),
                AssignActivity {
                    block_ids: vec![mail.id.clone()],
                    customer_id: "kunde_bageriet".into(),
                    remember: true,
                    billable: true,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(out.entries.len(), 1);
        assert_eq!(out.entries[0].minutes, 35);
        let after = m.activity_day(today()).unwrap();
        let mail = after.blocks.iter().find(|b| b.id == mail.id).unwrap();
        assert_eq!(mail.status, ActivityStatus::Registered);
        // Afgjorte forslag vises som registreret.
        m.confirm_suggestion("forslag_1", None).unwrap();
        let after = m.activity_day(today()).unwrap();
        assert_eq!(after.total(ActivityStatus::Suggested).0, 2);
    }

    #[test]
    fn del_flet_og_slet() {
        let m = MockBackend::with_today(today());
        let d = m.activity_day(today()).unwrap();
        let n = d.blocks.len();
        let code = d.blocks.iter().find(|b| b.app == "Code").unwrap().clone();
        m.split_activity(today(), &code.id, t(10, 0)).unwrap();
        let d = m.activity_day(today()).unwrap();
        assert_eq!(d.blocks.len(), n + 1);
        let ids: Vec<Id> = d.blocks[1..3].iter().map(|b| b.id.clone()).collect();
        m.merge_activity(today(), &ids).unwrap();
        let d = m.activity_day(today()).unwrap();
        assert_eq!(d.blocks.len(), n);
        assert_eq!(d.blocks[1].seconds, 2 * 3600);
        m.delete_activity(today(), &[d.blocks[0].id.clone()])
            .unwrap();
        assert_eq!(m.activity_day(today()).unwrap().blocks.len(), n - 1);
        m.delete_all_activity().unwrap();
        assert!(m.activity_day(today()).unwrap().blocks.is_empty());
        assert_eq!(m.activity_storage().unwrap().segments, 0);
    }
}
