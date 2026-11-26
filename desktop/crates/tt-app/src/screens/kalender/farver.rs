//! Farver på kalenderens poster: kundens farve (fra web) til kant og flade,
//! og en opgavemarkering (ikon og statusfarvet kant) på poster, der hører til
//! en opgave. Ren logik uden GPUI, så kontrasten kan testes.

use crate::backend::{Customer, Entry, Task, TaskStatus};
use crate::screens::opgaver::logic::{self, Palette};
use crate::ui::farve;
pub use crate::ui::farve::hsla;

/// Det, en post tegnes med (rå `0xRRGGBB`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BlockColors {
    /// Venstrekanten: kundens farve, ellers appens grønne.
    pub edge: u32,
    pub fill: u32,
    /// Tekst på `fill`, mindst AA.
    pub text: u32,
    /// Dæmpet tekst (tidsrum) på `fill`, mindst AA.
    pub muted: u32,
    /// Har kunden en egen farve?
    pub custom: bool,
}

/// Opgavemarkeringen: ikon og kant i opgavens statusfarve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaskMark {
    pub status: TaskStatus,
    /// Højrekanten (web's -600 lyst, -400 mørkt).
    pub edge: u32,
    /// Mærket bag ikonet og ikonets farve (AA mod hinanden).
    pub badge_bg: u32,
    pub badge_fg: u32,
}

/// Standardfarver uden kundefarve: appens primære på dens bløde flade.
pub struct Fallback {
    pub primary: u32,
    pub soft: u32,
    pub ink: u32,
    pub grey: u32,
}

impl Fallback {
    pub fn of(dark: bool) -> Fallback {
        let p = if dark {
            crate::brand::DARK
        } else {
            crate::brand::LIGHT
        };
        Fallback {
            primary: p.primary,
            soft: p.primary_soft,
            ink: p.ink,
            grey: p.grey,
        }
    }
}

pub fn block_colors(customer: Option<&Customer>, fb: &Fallback, dark: bool) -> BlockColors {
    match farve::customer_accent(customer, dark) {
        Some(a) => BlockColors {
            edge: a.edge,
            fill: a.tint,
            text: a.text,
            muted: farve::accessible_text(a.text, a.tint, farve::AA),
            custom: true,
        },
        None => BlockColors {
            edge: fb.primary,
            fill: fb.soft,
            text: fb.ink,
            muted: fb.grey,
            custom: false,
        },
    }
}

pub fn task_mark(task: &Task, dark: bool) -> TaskMark {
    let p: Palette = logic::status_palette(task.status, dark);
    TaskMark {
        status: task.status,
        edge: p.accent,
        badge_bg: p.bg,
        badge_fg: p.fg,
    }
}

/// Opgaven, en post hører til (hvis posten har en og den findes).
pub fn task_of<'a>(tasks: &'a [Task], e: &Entry) -> Option<&'a Task> {
    let id = e.task_id.as_deref()?;
    tasks.iter().find(|t| t.id == id)
}

/// Kunderne på posterne i visningen med deres farve, i rækkefølge efter
/// første forekomst. Til forklaringen under kalenderen.
pub fn customers_in_view<'a>(
    entries: &[Entry],
    customers: &'a [Customer],
) -> Vec<&'a Customer> {
    let mut out: Vec<&Customer> = Vec::new();
    for e in entries {
        if let Some(c) = customers.iter().find(|c| c.id == e.customer_id)
            && !out.iter().any(|x| x.id == c.id)
        {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::TaskPriority;

    fn fb(dark: bool) -> Fallback {
        Fallback::of(dark)
    }

    fn task(status: TaskStatus) -> Task {
        Task {
            id: "t".into(),
            project_id: "p".into(),
            title: "T".into(),
            status,
            due: None,
            logged_minutes: 0,
            estimate_minutes: None,
            priority: Some(TaskPriority::Low),
            description: None,
            customer_id: None,
            status_id: None,
            completed: None,
        }
    }

    #[test]
    fn without_customer_colour_the_app_colours_are_used_and_have_aa() {
        for dark in [false, true] {
            let c = block_colors(None, &fb(dark), dark);
            assert!(!c.custom);
            assert!(farve::contrast(c.text, c.fill) >= farve::AA);
            assert!(farve::contrast(c.muted, c.fill) >= farve::AA);
        }
    }

    #[test]
    fn every_task_mark_has_readable_icon_in_both_themes() {
        for dark in [false, true] {
            for s in TaskStatus::ALL {
                let m = task_mark(&task(s), dark);
                assert_eq!(m.status, s);
                assert!(farve::contrast(m.badge_fg, m.badge_bg) >= farve::AA);
            }
        }
        // Statuskanten er web's farve.
        assert_eq!(task_mark(&task(TaskStatus::InProgress), false).edge, 0xD97706);
        assert_eq!(task_mark(&task(TaskStatus::Done), true).edge, 0x4ADE80);
    }

    #[test]
    fn entry_finds_its_task_only_when_linked() {
        let t = task(TaskStatus::Todo);
        let mut e = Entry {
            id: "e".into(),
            customer_id: "k".into(),
            project_id: None,
            task_id: None,
            description: String::new(),
            date: chrono::NaiveDate::from_ymd_opt(2026, 10, 26).unwrap(),
            start: None,
            end: None,
            minutes: 60,
            billable: true,
            invoice_id: None,
        };
        assert!(task_of(std::slice::from_ref(&t), &e).is_none());
        e.task_id = Some("t".into());
        assert_eq!(task_of(std::slice::from_ref(&t), &e).map(|x| x.id.as_str()), Some("t"));
        e.task_id = Some("findes-ikke".into());
        assert!(task_of(std::slice::from_ref(&t), &e).is_none());
    }
}
