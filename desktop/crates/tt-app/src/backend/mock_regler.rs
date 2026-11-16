//! ux-vaelger: regler og omfang i demoen (TT_DEMO, tests og skærmbilleder).

use super::*;

/// Demoens regler og mønstre.
pub(super) fn demo_rows() -> Vec<RuleRow> {
    let row = |id: &str, origin, kind, value: &str, customer: Option<&str>, project: Option<&str>, hits, conf| RuleRow {
        id: id.into(),
        origin,
        kind,
        value: value.into(),
        customer_id: customer.map(str::to_string),
        project_id: project.map(str::to_string),
        not_work: customer.is_none() && project.is_none(),
        active: true,
        hits,
        confirmations: conf,
    };
    let mut rows = vec![
        row("regel-bageriet", RuleOrigin::Rule, RuleRowKind::Domain, "bageriet.dk", Some("kunde_bageriet"), Some("proj_webshop"), 6, 4),
        row("regel-spotify", RuleOrigin::Rule, RuleRowKind::App, "Spotify", None, None, 11, 0),
        row(
            "p:{\"kind\":\"repo\",\"remote\":\"github.com/acme/klinik-booking\"}",
            RuleOrigin::Pattern,
            RuleRowKind::Repo,
            "github.com/acme/klinik-booking",
            Some("kunde_klinik"),
            Some("proj_booking"),
            9,
            7,
        ),
        row(
            "p:{\"kind\":\"titleTemplate\",\"app\":\"figma\",\"template\":\"nyhedsbrev\"}",
            RuleOrigin::Pattern,
            RuleRowKind::Title,
            "nyhedsbrev · figma",
            Some("kunde_gartneriet"),
            None,
            2,
            2,
        ),
    ];
    rows[1].active = false;
    rows
}

impl MockBackend {
    fn regler<T>(&self, f: impl FnOnce(&mut Vec<RuleRow>) -> Result<T>) -> Result<T> {
        self.with(|_| Ok(()))?;
        f(&mut self.regler.lock().expect("mock-lås"))
    }

    pub(super) fn mock_rule_scopes(&self, date: NaiveDate, block_ids: &[Id]) -> Result<Vec<RuleScope>> {
        let day = self.activity_day(date)?;
        let chosen: Vec<&ActivityBlock> = day.blocks.iter().filter(|b| block_ids.contains(&b.id)).collect();
        let Some(first) = chosen.first() else {
            return Ok(vec![]);
        };
        let title_word = |b: &ActivityBlock| {
            b.title
                .split([' ', '–', '-', '·', '|'])
                .map(str::trim)
                .find(|w| w.chars().count() >= 4)
                .map(str::to_string)
        };
        let value_of = |kind: ScopeKind, b: &ActivityBlock| -> Option<String> {
            match kind {
                ScopeKind::Repo => b.repo.clone(),
                ScopeKind::Folder => b.repo.as_ref().map(|r| format!("/Users/mads/dev/{r}")),
                ScopeKind::Domain => b.domain.clone(),
                ScopeKind::App => Some(b.app.clone()).filter(|a| !a.is_empty()),
                ScopeKind::TitleWord => title_word(b),
            }
        };
        Ok(ScopeKind::ALL
            .iter()
            .filter_map(|&kind| {
                let value = value_of(kind, first)?;
                let today = day
                    .blocks
                    .iter()
                    .filter(|b| value_of(kind, b).as_deref() == Some(value.as_str()))
                    .count();
                // Demo: de sidste 14 dage som et fast tillæg pr. slags.
                let recent = today + [6, 6, 4, 23, 3][kind as usize];
                Some(RuleScope { kind, value, today, recent })
            })
            .collect())
    }

    pub(super) fn mock_create_rule(&self, scope: &RuleScope, customer_id: Option<Id>, project_id: Option<Id>) -> Result<Id> {
        if customer_id.is_none() && project_id.is_none() {
            return Err(BackendError::Validation("Vælg en kunde eller et projekt".into()));
        }
        self.regler(|rows| {
            let id = format!("regel-{}", rows.len() + 1);
            rows.push(RuleRow {
                id: id.clone(),
                origin: RuleOrigin::Rule,
                kind: match scope.kind {
                    ScopeKind::Repo => RuleRowKind::Repo,
                    ScopeKind::Folder => RuleRowKind::Folder,
                    ScopeKind::Domain => RuleRowKind::Domain,
                    ScopeKind::App => RuleRowKind::App,
                    ScopeKind::TitleWord => RuleRowKind::Title,
                },
                value: scope.value.clone(),
                customer_id,
                project_id,
                not_work: false,
                active: true,
                hits: scope.recent,
                confirmations: 0,
            });
            Ok(id)
        })
    }

    pub(super) fn mock_backward(&self, scope: &RuleScope) -> Result<BackwardResult> {
        self.with(|_| Ok(()))?;
        // Demo: de andre dages blokke registreres ikke rigtigt.
        let other_days = scope.recent.saturating_sub(scope.today);
        Ok(BackwardResult {
            entries: other_days,
            minutes: 45 * other_days as u32,
            days: other_days.min(5),
        })
    }

    pub(super) fn mock_rule_rows(&self) -> Result<Vec<RuleRow>> {
        self.regler(|rows| Ok(rows.clone()))
    }

    pub(super) fn mock_edit_rule(&self, id: &str, f: impl FnOnce(&mut RuleRow)) -> Result<()> {
        self.regler(|rows| {
            let r = rows
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or_else(|| BackendError::NotFound("Reglen".into()))?;
            f(r);
            Ok(())
        })
    }

    pub(super) fn mock_delete_rule(&self, id: &str) -> Result<()> {
        self.regler(|rows| {
            let n = rows.len();
            rows.retain(|r| r.id != id);
            if rows.len() == n {
                return Err(BackendError::NotFound("Reglen".into()));
            }
            Ok(())
        })
    }
}
