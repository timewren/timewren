//! Kommandopaletten (Cmd/Ctrl+K): navigation, timer-handlinger og "start
//! timer på <kunde · projekt>" med fuzzy-søgning. Vises af `AppView`.

use crate::backend::{Backend, Customer, Project, ProjectStatus, Result, TimerStatus, TimerTarget};
use crate::hotkeys;
use crate::screens::Screen;
use crate::ui::{PickerItem, shortcut_label};

#[derive(Clone, Debug, PartialEq)]
pub enum PaletteCmd {
    Go(Screen),
    ToggleTimer,
    StopTimer,
    /// Åbner Hjem med bekræftelsen; kassér sker aldrig direkte fra paletten.
    DiscardTimer,
    ConfirmDay,
    /// "Luk dagen" på Aktivitet. // aktivitet
    CloseDay,
    /// Start timeren på målet, eller skift mål på en kørende timer.
    StartOn(TimerTarget),
}

/// Faste kommandoer (uden data).
pub fn base_commands() -> Vec<(PaletteCmd, PickerItem)> {
    let global = |c: hotkeys::HotkeyCmd| {
        hotkeys::bindings()
            .into_iter()
            .find(|b| b.cmd == c)
            .map(|b| b.display)
            .unwrap_or_default()
    };
    let mut out = vec![
        (
            PaletteCmd::ToggleTimer,
            PickerItem::new(
                crate::i18n::t("palette.cmd.toggle"),
                global(hotkeys::HotkeyCmd::ToggleTimer),
            ),
        ),
        (
            PaletteCmd::StopTimer,
            PickerItem::new(
                crate::i18n::t("palette.cmd.stop"),
                global(hotkeys::HotkeyCmd::StopTimer),
            ),
        ),
        (
            PaletteCmd::DiscardTimer,
            PickerItem::new(crate::i18n::t("palette.cmd.discard"), ""),
        ),
        (
            PaletteCmd::ConfirmDay,
            PickerItem::new(crate::i18n::t("palette.cmd.confirm_day"), ""),
        ),
        (
            PaletteCmd::CloseDay,
            PickerItem::new(crate::i18n::t("aktivitet.palette.luk_dagen"), ""),
        ),
    ];
    for (i, s) in Screen::ALL.into_iter().enumerate() {
        let key = if s == Screen::Indstillinger {
            shortcut_label(",")
        } else {
            shortcut_label(&(i + 1).to_string())
        };
        let mut item = PickerItem::new(
            crate::i18n::tf("palette.cmd.go", &[("screen", s.title())]),
            key,
        );
        item.keywords = crate::i18n::tf("palette.cmd.go_keywords", &[("key", s.key())]);
        out.push((PaletteCmd::Go(s), item));
    }
    out
}

/// "Start timer: Bageriet på Hjørnet · Ny webshop" for alle aktive kunder og projekter.
pub fn target_commands(
    customers: &[Customer],
    projects: &[Project],
) -> Vec<(PaletteCmd, PickerItem)> {
    let mut out = vec![];
    for c in customers.iter().filter(|c| !c.archived) {
        for p in projects.iter().filter(|p| {
            p.customer_id == c.id
                && matches!(p.status, ProjectStatus::Active | ProjectStatus::Paused)
        }) {
            let mut item = PickerItem::new(
                crate::i18n::tf("palette.cmd.start_on", &[("customer", &c.name)]),
                p.name.clone(),
            );
            item.keywords = crate::i18n::t("palette.cmd.start_on_keywords").into();
            out.push((
                PaletteCmd::StartOn(TimerTarget {
                    customer_id: Some(c.id.clone()),
                    project_id: Some(p.id.clone()),
                    ..Default::default()
                }),
                item,
            ));
        }
    }
    out
}

/// `StartOn` mod datalaget: start, eller skift mål hvis timeren allerede kører.
pub fn start_on(b: &dyn Backend, target: TimerTarget) -> Result<()> {
    if b.timer()?.status == TimerStatus::Idle {
        b.timer_start(target)?;
    } else {
        b.timer_set_target(target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{PaletteCmd, base_commands, start_on, target_commands};
    use crate::backend::{Backend, MockBackend, TimerStatus, TimerTarget};
    use crate::ui::fuzzy;
    use chrono::NaiveDate;

    fn mock() -> MockBackend {
        MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap())
    }

    #[test]
    fn kommandoer_kan_findes_med_fuzzy() {
        let m = mock();
        let mut all = base_commands();
        all.extend(target_commands(
            &m.customers(true).unwrap(),
            &m.projects(None, true).unwrap(),
        ));
        let hay: Vec<String> = all
            .iter()
            .map(|(_, i)| format!("{} {} {}", i.title, i.detail, i.keywords))
            .collect();
        let first = |q: &str| all[fuzzy::rank(&hay, q, 5)[0]].0.clone();
        assert_eq!(
            first("fakt"),
            PaletteCmd::Go(crate::screens::Screen::Fakturaer)
        );
        assert_eq!(first("stop"), PaletteCmd::StopTimer);
        assert!(
            matches!(first("start bageri webshop"), PaletteCmd::StartOn(t) if t.project_id.as_deref() == Some("proj_webshop"))
        );
        assert_eq!(base_commands().len(), 5 + 10);
    }

    #[test]
    fn start_paa_skifter_maal_naar_timeren_koerer() {
        let m = mock();
        let t = |p: &str| TimerTarget {
            customer_id: Some("kunde_bageriet".into()),
            project_id: Some(p.into()),
            ..Default::default()
        };
        start_on(&m, t("proj_webshop")).unwrap();
        assert_eq!(m.timer().unwrap().status, TimerStatus::Running);
        start_on(&m, t("proj_bageri_drift")).unwrap();
        let st = m.timer().unwrap();
        assert_eq!(st.status, TimerStatus::Running);
        assert_eq!(st.project_id.as_deref(), Some("proj_bageri_drift"));
    }
}
