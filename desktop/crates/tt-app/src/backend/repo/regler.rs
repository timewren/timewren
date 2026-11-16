//! ux-vaelger: "Altid sådan" og regeloversigten oven på datalaget.
//!
//! En regel er datalagets `MatchingRule` (lokalt SQLite, i cloud web's
//! `rules.upsert/remove`), så den også gælder i web og på andre enheder.
//! Tællingen og "bagud" kommer fra detektionen (rå aktivitet forlader aldrig
//! maskinen).

use tt_data as td;

use super::RepoBackend;
use super::aktivitet::{entry_input, registered_spans};
use super::licens::Action;
use crate::backend::regler::{RECENT_DAYS, recent_days};
use crate::backend::*;

impl RepoBackend {
    pub(super) fn rule_scopes_impl(&self, date: NaiveDate, block_ids: &[Id]) -> Result<Vec<RuleScope>> {
        let spans = block_spans(block_ids)?;
        let detection = &self.shared.opts.detection;
        let found = detection.rule_candidates(&spans);
        let rules: Vec<(td::RuleKind, String)> =
            found.iter().map(|(k, v)| (k.rule_kind(), v.clone())).collect();
        let today = detection.rule_hit_counts(&rules, &[date]);
        let recent = detection.rule_hit_counts(&rules, &recent_days(date));
        Ok(found
            .into_iter()
            .enumerate()
            .map(|(i, (kind, value))| RuleScope {
                kind,
                value,
                today: today[i],
                recent: recent[i],
            })
            .collect())
    }

    pub(super) fn create_rule_impl(
        &self,
        scope: &RuleScope,
        customer_id: Option<Id>,
        project_id: Option<Id>,
    ) -> Result<Id> {
        self.gate(Action::Write)?;
        if customer_id.as_deref().is_none_or(str::is_empty) && project_id.is_none() {
            return Err(BackendError::Validation("Vælg en kunde eller et projekt".into()));
        }
        let rule = td::MatchingRule {
            id: String::new(),
            kind: scope.kind.rule_kind(),
            pattern: scope.value.trim().to_string(),
            project_id,
            client_id: customer_id.filter(|c| !c.is_empty()),
            source: td::RuleSource::User,
            confirmations: 0,
            not_work: false,
            updated_at: None,
        };
        let saved = self.run("Reglen", self.repo().upsert_rule(rule))?;
        // Detektionen får reglen med det samme (også site-koblingerne).
        self.shared.opts.detection.set_web_catalog(self.web_catalog());
        Ok(saved.id)
    }

    pub(super) fn apply_rule_backward_impl(
        &self,
        scope: &RuleScope,
        customer_id: Option<Id>,
        project_id: Option<Id>,
    ) -> Result<BackwardResult> {
        self.gate(Action::Write)?;
        let detection = &self.shared.opts.detection;
        let (customers, projects) = self.catalog()?;
        let customer = customer_id.unwrap_or_default();
        let template = AssignActivity {
            block_ids: vec![],
            customer_id: customer.clone(),
            project_id: project_id.clone(),
            task_id: None,
            description: "Uden beskrivelse".into(),
            billable: true,
            remember: false,
        };
        let mut out = BackwardResult::default();
        for date in recent_days(self.today()) {
            let runs = detection.rule_open_runs(
                scope.kind.rule_kind(),
                &scope.value,
                date,
                &customer,
                project_id.as_deref(),
                &customers,
                &projects,
            )?;
            if runs.is_empty() {
                continue;
            }
            let registered: Vec<(i64, i64)> = registered_spans(&self.entries(DateRange::day(date))?)
                .iter()
                .map(|r| (r.start, r.end))
                .collect();
            let free = subtract_spans(&runs, &registered);
            let mut done = Vec::new();
            for &(a, b) in &free {
                let Some(input) = entry_input(date, a, b, &template) else {
                    continue;
                };
                let e = self.create_entry(input)?;
                out.entries += 1;
                out.minutes += e.minutes;
                done.push((a, b));
            }
            if !done.is_empty() {
                out.days += 1;
                detection.activity_assigned(&done, &customer, project_id.as_deref(), false, &customers, &projects);
            }
        }
        Ok(out)
    }

    pub(super) fn rule_rows_impl(&self) -> Result<Vec<RuleRow>> {
        let detection = &self.shared.opts.detection;
        let days = recent_days(self.today());
        debug_assert_eq!(days.len() as u64, RECENT_DAYS);
        let rules: Vec<td::MatchingRule> = self
            .run("Reglerne", self.repo().matching_rules())?
            .into_iter()
            .filter(|r| r.source != td::RuleSource::Project)
            .collect();
        let keys: Vec<(td::RuleKind, String)> = rules.iter().map(|r| (r.kind, r.pattern.clone())).collect();
        let hits = detection.rule_hit_counts(&keys, &days);
        let off = detection.disabled_rules();
        let mut rows: Vec<RuleRow> = rules
            .into_iter()
            .zip(hits)
            .map(|(r, hits)| RuleRow {
                active: !off.contains(&r.id),
                kind: RuleRowKind::of_rule(r.kind, &r.pattern),
                id: r.id,
                origin: RuleOrigin::Rule,
                value: r.pattern,
                customer_id: r.client_id,
                project_id: r.project_id,
                not_work: r.not_work,
                hits,
                confirmations: u32::try_from(r.confirmations.max(0)).unwrap_or(u32::MAX),
            })
            .collect();
        rows.extend(detection.pattern_rows(&days));
        Ok(rows)
    }

    pub(super) fn set_rule_target_impl(
        &self,
        row: &RuleRow,
        customer_id: Option<Id>,
        project_id: Option<Id>,
    ) -> Result<()> {
        self.gate(Action::Write)?;
        // Et mål uden kunde og projekt bliver ingen regel (web afviser den).
        if customer_id.as_deref().is_none_or(str::is_empty) && project_id.is_none() {
            return Err(BackendError::Validation("Vælg en kunde eller et projekt".into()));
        }
        match row.origin {
            RuleOrigin::Pattern => self.shared.opts.detection.retarget_pattern(&row.id, customer_id, project_id),
            RuleOrigin::Rule => {
                let mut rule = self
                    .run("Reglerne", self.repo().matching_rules())?
                    .into_iter()
                    .find(|r| r.id == row.id)
                    .ok_or_else(|| BackendError::NotFound("Reglen".into()))?;
                rule.client_id = customer_id.filter(|c| !c.is_empty());
                rule.project_id = project_id;
                rule.not_work = false;
                self.run("Reglen", self.repo().upsert_rule(rule))?;
                self.shared.opts.detection.set_web_catalog(self.web_catalog());
                Ok(())
            }
        }
    }

    pub(super) fn delete_rule_row_impl(&self, row: &RuleRow) -> Result<()> {
        self.gate(Action::Write)?;
        match row.origin {
            RuleOrigin::Pattern => self.shared.opts.detection.forget_pattern(&row.id),
            RuleOrigin::Rule => {
                self.run("Reglen", self.repo().delete_rule(&row.id))?;
                let detection = &self.shared.opts.detection;
                if detection.disabled_rules().contains(&row.id) {
                    detection.set_rule_disabled(&row.id, false)?;
                }
                detection.set_web_catalog(self.web_catalog());
                Ok(())
            }
        }
    }
}
