//! Opgaveskærmens rene logik: filtre, søgning, gruppering, boardets kolonner,
//! web's farver og det gemte valg af visning. Ingen GPUI, så alt kan testes.

use std::path::{Path, PathBuf};

use chrono::{Days, NaiveDate};

use crate::backend::{Customer, Id, LaneCategory, Project, Task, TaskLane, TaskPriority, TaskStatus};
use crate::ui::farve;

// ------------------------------------------------------------------ visning

/// Liste eller board. Valget huskes mellem sessioner.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum View {
    #[default]
    List,
    Board,
}

impl View {
    pub fn as_str(self) -> &'static str {
        match self {
            View::List => "list",
            View::Board => "board",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "list" => Some(View::List),
            "board" => Some(View::Board),
            _ => None,
        }
    }
}

/// Gruppering i listen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Grouping {
    #[default]
    None,
    Customer,
    Project,
}

impl Grouping {
    pub const ALL: [Grouping; 3] = [Grouping::None, Grouping::Customer, Grouping::Project];

    pub fn as_str(self) -> &'static str {
        match self {
            Grouping::None => "none",
            Grouping::Customer => "customer",
            Grouping::Project => "project",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Grouping::ALL.into_iter().find(|g| g.as_str() == s)
    }
}

/// Det, skærmen husker: visning, gruppering og "skjul afsluttede".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Prefs {
    pub view: View,
    pub grouping: Grouping,
    pub hide_done: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            view: View::List,
            grouping: Grouping::None,
            hide_done: false,
        }
    }
}

const PREFS_FILE: &str = "opgaver-visning.json";

impl Prefs {
    fn path(dir: &Path) -> PathBuf {
        dir.join(PREFS_FILE)
    }

    /// Læser det gemte valg. Mangler filen eller er den ødelagt, bruges
    /// standarden; en visning bliver aldrig tom af den grund.
    pub fn load(dir: &Path) -> Self {
        let Ok(text) = std::fs::read_to_string(Self::path(dir)) else {
            return Prefs::default();
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
            return Prefs::default();
        };
        let d = Prefs::default();
        Prefs {
            view: v["view"]
                .as_str()
                .and_then(View::parse)
                .unwrap_or(d.view),
            grouping: v["grouping"]
                .as_str()
                .and_then(Grouping::parse)
                .unwrap_or(d.grouping),
            hide_done: v["hideDone"].as_bool().unwrap_or(d.hide_done),
        }
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let json = serde_json::json!({
            "view": self.view.as_str(),
            "grouping": self.grouping.as_str(),
            "hideDone": self.hide_done,
        });
        let tmp = dir.join(format!("{PREFS_FILE}.tmp"));
        std::fs::write(&tmp, json.to_string())?;
        std::fs::rename(tmp, Self::path(dir))
    }
}

// ------------------------------------------------------------------ filtre

/// Antal dage frem, en opgave "forfalder snart".
pub const SOON_DAYS: u64 = 7;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Filters {
    pub customer: Option<Id>,
    pub project: Option<Id>,
    pub priority: Option<TaskPriority>,
    /// Kun denne status (listens statusfilter). Boardet viser alle fire.
    pub status: Option<TaskStatus>,
    /// Kun opgaver, jeg har registreret tid på (skrivebordsappen kender ikke
    /// web's ansvarlig-felt, så "mine" er de opgaver, der har min tid).
    pub mine: bool,
    pub due_soon: bool,
    pub hide_done: bool,
    pub query: String,
}

impl Filters {
    /// Er andet end "skjul afsluttede" slået til? Bruges til at skelne
    /// "ingen opgaver" fra "ingen opgaver matcher".
    pub fn narrows(&self) -> bool {
        self.customer.is_some()
            || self.project.is_some()
            || self.priority.is_some()
            || self.mine
            || self.due_soon
            || !self.query.trim().is_empty()
    }
}

pub fn project_of<'a>(projects: &'a [Project], task: &Task) -> Option<&'a Project> {
    projects.iter().find(|p| p.id == task.project_id)
}

/// Opgavens kunde: projektets, ellers kunden direkte på opgaven (web
/// tillader en opgave med kunde uden projekt).
pub fn customer_of<'a>(
    customers: &'a [Customer],
    projects: &[Project],
    task: &Task,
) -> Option<&'a Customer> {
    let id = match project_of(projects, task) {
        Some(p) => p.customer_id.as_str(),
        None => task.customer_id.as_deref()?,
    };
    customers.iter().find(|c| c.id == id)
}

/// Kortets og rækkens sted: "Kunde · Projekt", kun "Kunde" uden projekt, og
/// `None`, når opgaven har ingen af dem (så linjen udelades).
pub fn place_label(
    customers: &[Customer],
    projects: &[Project],
    task: &Task,
    unknown: &str,
) -> Option<String> {
    match project_of(projects, task) {
        Some(p) => Some(project_label(customers, p, unknown)),
        None => customer_of(customers, projects, task).map(|c| c.name.clone()),
    }
}

/// Frist overskredet og opgaven ikke færdig.
pub fn is_overdue(task: &Task, today: NaiveDate) -> bool {
    task.status != TaskStatus::Done && task.due.is_some_and(|d| d < today)
}

/// Frist inden for en uge (eller overskredet) og opgaven ikke færdig.
pub fn is_due_soon(task: &Task, today: NaiveDate) -> bool {
    task.status != TaskStatus::Done
        && task
            .due
            .is_some_and(|d| d <= today + Days::new(SOON_DAYS))
}

fn contains_ci(hay: &str, needle: &str) -> bool {
    hay.to_lowercase().contains(needle)
}

/// Passer opgaven til alle filtre?
pub fn matches(
    task: &Task,
    customers: &[Customer],
    projects: &[Project],
    f: &Filters,
    today: NaiveDate,
) -> bool {
    let project = project_of(projects, task);
    let customer = customer_of(customers, projects, task);
    if f.project.as_deref().is_some_and(|p| task.project_id != p) {
        return false;
    }
    if f.customer
        .as_deref()
        .is_some_and(|c| customer.is_none_or(|x| x.id != c))
    {
        return false;
    }
    if f.priority.is_some_and(|p| task.priority != Some(p)) {
        return false;
    }
    if f.status.is_some_and(|s| task.status != s) {
        return false;
    }
    if f.mine && task.logged_minutes == 0 {
        return false;
    }
    if f.due_soon && !is_due_soon(task, today) {
        return false;
    }
    if f.hide_done && task.status == TaskStatus::Done {
        return false;
    }
    let q = f.query.trim().to_lowercase();
    if !q.is_empty() {
        let hit = contains_ci(&task.title, &q)
            || task.description.as_deref().is_some_and(|d| contains_ci(d, &q))
            || project.is_some_and(|p| contains_ci(&p.name, &q))
            || customer.is_some_and(|c| contains_ci(&c.name, &q));
        if !hit {
            return false;
        }
    }
    true
}

/// Listens rækkefølge: ikke færdige først, så frist (uden frist sidst), så
/// titel.
fn list_key(t: &Task) -> (bool, bool, Option<NaiveDate>, String) {
    (
        t.status == TaskStatus::Done,
        t.due.is_none(),
        t.due,
        t.title.to_lowercase(),
    )
}

/// Boardets rækkefølge i en kolonne: højeste prioritet først, så frist, så
/// titel.
fn board_key(t: &Task) -> (std::cmp::Reverse<Option<TaskPriority>>, bool, Option<NaiveDate>, String) {
    (
        std::cmp::Reverse(t.priority),
        t.due.is_none(),
        t.due,
        t.title.to_lowercase(),
    )
}

/// Opgaverne efter filtrene i listens rækkefølge.
pub fn visible<'a>(
    tasks: &'a [Task],
    customers: &[Customer],
    projects: &[Project],
    f: &Filters,
    today: NaiveDate,
) -> Vec<&'a Task> {
    let mut v: Vec<&Task> = tasks
        .iter()
        .filter(|t| matches(t, customers, projects, f, today))
        .collect();
    v.sort_by_key(|t| list_key(t));
    v
}

/// Boardets kolonner, én pr. kolonne i `lanes` (web's egne statusser, i
/// tavlens rækkefølge). Kortene placeres som i web (`resolve_lane`). Skjulte
/// afsluttede giver tomme afsluttede kolonner, så boardet har samme form.
pub fn board_columns<'a>(
    tasks: &'a [Task],
    customers: &[Customer],
    projects: &[Project],
    f: &Filters,
    today: NaiveDate,
    lanes: &[TaskLane],
) -> Vec<Vec<&'a Task>> {
    let mut cols: Vec<Vec<&Task>> = vec![Vec::new(); lanes.len()];
    for t in tasks
        .iter()
        .filter(|t| matches(t, customers, projects, f, today))
    {
        if let Some(ix) = resolve_lane(t, lanes) {
            cols[ix].push(t);
        }
    }
    for c in &mut cols {
        c.sort_by_key(|t| board_key(t));
    }
    cols
}

// --------------------------------------------------------------- gruppering

#[derive(Clone, Debug, PartialEq)]
pub struct Group<'a> {
    /// Stabil nøgle til id'er ("kunde_x", "proj_y" eller "").
    pub key: String,
    pub label: String,
    /// Kundens id, når gruppen har én kunde (til farveprikken).
    pub customer_id: Option<Id>,
    pub tasks: Vec<&'a Task>,
}

/// "Kunde · Projekt".
pub fn project_label(customers: &[Customer], p: &Project, unknown: &str) -> String {
    let c = customers
        .iter()
        .find(|c| c.id == p.customer_id)
        .map_or(unknown, |c| c.name.as_str());
    format!("{c} · {}", p.name)
}

/// Deler de synlige opgaver i grupper efter kunde eller projekt. Rækkefølgen
/// i en gruppe bevares; grupperne står alfabetisk. Opgaver uden kendt
/// projekt eller kunde samles til sidst i en gruppe uden navn (`key` tom).
pub fn group<'a>(
    rows: Vec<&'a Task>,
    customers: &[Customer],
    projects: &[Project],
    by: Grouping,
    unknown: &str,
) -> Vec<Group<'a>> {
    if by == Grouping::None {
        return vec![Group {
            key: String::new(),
            label: String::new(),
            customer_id: None,
            tasks: rows,
        }];
    }
    let mut groups: Vec<Group<'a>> = Vec::new();
    let mut loose: Vec<&'a Task> = Vec::new();
    for t in rows {
        let (key, label, customer_id) = match (by, project_of(projects, t)) {
            (Grouping::Customer, _) => {
                let Some(c) = customer_of(customers, projects, t) else {
                    loose.push(t);
                    continue;
                };
                (c.id.clone(), c.name.clone(), c.id.clone())
            }
            (_, Some(p)) => (
                p.id.clone(),
                project_label(customers, p, unknown),
                p.customer_id.clone(),
            ),
            (_, None) => {
                loose.push(t);
                continue;
            }
        };
        match groups.iter_mut().find(|g| g.key == key) {
            Some(g) => g.tasks.push(t),
            None => groups.push(Group {
                key,
                label,
                customer_id: Some(customer_id),
                tasks: vec![t],
            }),
        }
    }
    groups.sort_by_key(|g| g.label.to_lowercase());
    if !loose.is_empty() {
        groups.push(Group {
            key: String::new(),
            label: unknown.to_owned(),
            customer_id: None,
            tasks: loose,
        });
    }
    groups
}

// ------------------------------------------------- kolonner (egne statusser)
//
// Porteret 1:1 fra web's `src/lib/kanban/lane-category.ts`: hver kolonne har
// en af fire faste kategorier, og kategorien styrer den gamle status, som
// filtre, rapporter og `setStatus` stadig bruger.

/// De fire faste kolonner, når tavlens egne ikke kan hentes. Id'et er den
/// gamle status; de flyttes med `set_task_status`.
pub fn fixed_lanes(name: impl Fn(TaskStatus) -> String) -> Vec<TaskLane> {
    TaskStatus::ALL
        .into_iter()
        .map(|s| TaskLane {
            id: status_key(s).into(),
            name: name(s),
            color: None,
            category: category_for_status(s),
        })
        .collect()
}

/// Web's værdi for den gamle status.
pub fn status_key(s: TaskStatus) -> &'static str {
    match s {
        TaskStatus::Backlog => "backlog",
        TaskStatus::Todo => "todo",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Done => "done",
    }
}

/// Web's `categoryForLegacyStatus`.
pub fn category_for_status(s: TaskStatus) -> LaneCategory {
    match s {
        TaskStatus::InProgress => LaneCategory::InProgress,
        TaskStatus::Done => LaneCategory::Done,
        TaskStatus::Backlog | TaskStatus::Todo => LaneCategory::NotStarted,
    }
}

/// Standardkolonnernes navne bevarer deres egen gamle status.
fn status_by_lane_name(name: &str) -> Option<TaskStatus> {
    match name {
        "Backlog" => Some(TaskStatus::Backlog),
        "Todo" => Some(TaskStatus::Todo),
        "I gang" => Some(TaskStatus::InProgress),
        "Afsluttet" => Some(TaskStatus::Done),
        _ => None,
    }
}

/// Passer den gamle status med kolonnens kategori? (`laneMatchesLegacyStatus`)
pub fn lane_matches_status(category: LaneCategory, s: TaskStatus) -> bool {
    match category_for_status(s) {
        LaneCategory::Done => matches!(category, LaneCategory::Done | LaneCategory::Cancelled),
        wanted => category == wanted,
    }
}

/// Den gamle status, en opgave får i kolonnen (`legacyStatusForLane`):
/// standardkolonnerne beholder deres egen, "ikke startet" bevarer backlog
/// eller todo, og annulleret skrives som done. De faste kolonner
/// (`fixed_lanes`) har et oversat navn; deres id er statussen.
pub fn legacy_status_for_lane(lane: &TaskLane, current: TaskStatus) -> TaskStatus {
    let own = status_by_lane_name(&lane.name)
        .or_else(|| TaskStatus::ALL.into_iter().find(|s| status_key(*s) == lane.id));
    if let Some(s) = own
        && category_for_status(s) == lane.category
    {
        return s;
    }
    match lane.category {
        LaneCategory::InProgress => TaskStatus::InProgress,
        LaneCategory::Done | LaneCategory::Cancelled => TaskStatus::Done,
        LaneCategory::NotStarted => match current {
            TaskStatus::Backlog | TaskStatus::Todo => current,
            _ => TaskStatus::Todo,
        },
    }
}

/// Kolonnen (indeks i `lanes`), opgaven står i (`resolveTaskLaneId`).
/// `statusId` vinder, når kolonnen findes og passer med status; ellers
/// standardkolonnen med samme navn, så den første i samme kategori. Findes
/// ingen, bliver den i sin egen kolonne eller lander i den første, så den
/// aldrig forsvinder fra tavlen. `lanes` er i tavlens rækkefølge.
pub fn resolve_lane(task: &Task, lanes: &[TaskLane]) -> Option<usize> {
    if lanes.is_empty() {
        return None;
    }
    let current = task
        .status_id
        .as_deref()
        .and_then(|id| lanes.iter().position(|l| l.id == id));
    if let Some(ix) = current
        && lane_matches_status(lanes[ix].category, task.status)
    {
        return Some(ix);
    }
    // De faste kolonner (`fixed_lanes`, lokal tilstand) har statussen som id
    // og et oversat navn; id'et tæller som navnet.
    let by_name = lanes.iter().position(|l| {
        (status_by_lane_name(&l.name) == Some(task.status) || l.id == status_key(task.status))
            && lane_matches_status(l.category, task.status)
    });
    if by_name.is_some() {
        return by_name;
    }
    let wanted = category_for_status(task.status);
    lanes
        .iter()
        .position(|l| l.category == wanted)
        .or_else(|| {
            lanes
                .iter()
                .position(|l| lane_matches_status(l.category, task.status))
        })
        .or(current)
        .or(Some(0))
}

/// Nabokolonnen; `None` ved kanten.
pub fn step_lane(ix: usize, len: usize, forward: bool) -> Option<usize> {
    if forward {
        (ix + 1 < len).then_some(ix + 1)
    } else {
        ix.checked_sub(1)
    }
}

/// Kolonnens farver: kategoriens (Backlog grå, Todo blå, I gang rav,
/// Afsluttet grøn, Annulleret rød), med kolonnens egen farve som ikon.
pub fn lane_palette(lane: &TaskLane, dark: bool) -> Palette {
    let base = match lane.category {
        LaneCategory::Cancelled => pick(&RED, dark),
        _ => status_palette(legacy_status_for_lane(lane, TaskStatus::Todo), dark),
    };
    Palette {
        accent: lane.color.unwrap_or(base.accent),
        ..base
    }
}

// --------------------------------------------------------------- tid som i web

/// Web's `formatTaskMinutes`: "45m" under en time, ellers timer med én
/// decimal ("1,5t", "10t").
#[cfg(test)]
pub fn format_minutes(minutes: u32) -> String {
    format_minutes_with(minutes, "m", "t")
}

/// Som `format_minutes`, med enhederne fra oversættelserne.
pub fn format_minutes_with(minutes: u32, min_unit: &str, hour_unit: &str) -> String {
    if minutes < 60 {
        return format!("{minutes}{min_unit}");
    }
    let hours = (f64::from(minutes) / 60.0 * 10.0).round() / 10.0;
    let s = if hours.fract() == 0.0 {
        format!("{hours:.0}")
    } else {
        format!("{hours:.1}").replace('.', ",")
    };
    format!("{s}{hour_unit}")
}

/// "1,5t af 10t" med estimat, ellers "1,5t". `of` er ordet imellem.
pub fn time_text(task: &Task, of: &str, min_unit: &str, hour_unit: &str) -> String {
    let f = |m| format_minutes_with(m, min_unit, hour_unit);
    match task.estimate_minutes {
        Some(e) => format!("{} {of} {}", f(task.logged_minutes), f(e)),
        None => f(task.logged_minutes),
    }
}

/// Andel af estimatet brugt, 0.0-1.0 (kan ikke overstige 1 til visning).
pub fn progress_fraction(task: &Task) -> Option<f32> {
    let e = task.estimate_minutes.filter(|e| *e > 0)?;
    Some((task.logged_minutes as f32 / e as f32).clamp(0.0, 1.0))
}

// ------------------------------------------------------------------- farver

/// Farver til en status eller prioritet i ét tema. `accent` er web's
/// -600 (lyst) eller -400 (mørkt) til ikon og kant; `fg` på `bg` er tekst på
/// mærket og holder AA.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Palette {
    pub accent: u32,
    pub fg: u32,
    pub bg: u32,
}

const fn pal(accent: u32, fg: u32, bg: u32) -> Palette {
    Palette { accent, fg, bg }
}

// Tailwind (web): gray/blue/amber/green/orange/red. Lyst: ikon -600, tekst
// -700 (web bruger -600 på -100, der kun giver 2,9-4,0:1 for amber, green og
// orange), flade -100. Mørkt: ikon -400, tekst -300 på -950.
const GRAY: [Palette; 2] = [pal(0x4B5563, 0x374151, 0xF3F4F6), pal(0x9CA3AF, 0xD1D5DB, 0x1F2937)];
const BLUE: [Palette; 2] = [pal(0x2563EB, 0x1D4ED8, 0xDBEAFE), pal(0x60A5FA, 0x93C5FD, 0x172554)];
const AMBER: [Palette; 2] = [pal(0xD97706, 0x92400E, 0xFEF3C7), pal(0xFBBF24, 0xFCD34D, 0x451A03)];
const GREEN: [Palette; 2] = [pal(0x16A34A, 0x166534, 0xDCFCE7), pal(0x4ADE80, 0x86EFAC, 0x052E16)];
const ORANGE: [Palette; 2] = [pal(0xEA580C, 0x9A3412, 0xFFEDD5), pal(0xFB923C, 0xFDBA74, 0x431407)];
const RED: [Palette; 2] = [pal(0xDC2626, 0xB91C1C, 0xFEE2E2), pal(0xF87171, 0xFCA5A5, 0x450A0A)];

fn pick(p: &[Palette; 2], dark: bool) -> Palette {
    p[usize::from(dark)]
}

/// Backlog grå, Todo blå, I gang rav, Afsluttet grøn (web).
pub fn status_palette(s: TaskStatus, dark: bool) -> Palette {
    pick(
        match s {
            TaskStatus::Backlog => &GRAY,
            TaskStatus::Todo => &BLUE,
            TaskStatus::InProgress => &AMBER,
            TaskStatus::Done => &GREEN,
        },
        dark,
    )
}

/// Lav grå, Mellem blå, Høj orange, Urgent rød (web).
pub fn priority_palette(p: TaskPriority, dark: bool) -> Palette {
    pick(
        match p {
            TaskPriority::Low => &GRAY,
            TaskPriority::Medium => &BLUE,
            TaskPriority::High => &ORANGE,
            TaskPriority::Urgent => &RED,
        },
        dark,
    )
}

pub use crate::ui::farve::customer_color;

pub fn customer_color_of(c: Option<&Customer>) -> Option<u32> {
    c.and_then(customer_color)
}

/// Kundens kant, optoning og tekstfarve, eller `None` uden farve.
pub fn customer_accent(c: Option<&Customer>, dark: bool) -> Option<farve::Accent> {
    farve::customer_accent(c, dark)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::ProjectStatus;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 28).unwrap()
    }

    fn cust(id: &str, name: &str) -> Customer {
        Customer {
            id: id.into(),
            name: name.into(),
            email: None,
            hourly_rate: None,
            archived: false,
            cvr: None,
            ..Default::default()
        }
    }

    fn proj(id: &str, customer: &str, name: &str) -> Project {
        Project {
            id: id.into(),
            customer_id: customer.into(),
            name: name.into(),
            hourly_rate: None,
            budget_minutes: None,
            status: ProjectStatus::Active,
            url_patterns: vec![],
        }
    }

    fn task(id: &str, project: &str, status: TaskStatus) -> Task {
        Task {
            id: id.into(),
            project_id: project.into(),
            title: id.into(),
            status,
            due: None,
            logged_minutes: 0,
            estimate_minutes: None,
            priority: None,
            description: None,
            customer_id: None,
            status_id: None,
        }
    }

    fn world() -> (Vec<Customer>, Vec<Project>, Vec<Task>) {
        let customers = vec![cust("ka", "Alfa Bageri"), cust("kb", "Beta Klinik")];
        let projects = vec![
            proj("pa", "ka", "Webshop"),
            proj("pb", "kb", "Booking"),
            proj("pb2", "kb", "SEO"),
        ];
        let mut a = task("a", "pa", TaskStatus::Todo);
        a.due = Some(today() + Days::new(3));
        a.priority = Some(TaskPriority::High);
        a.description = Some("MobilePay checkout".into());
        let mut b = task("b", "pb", TaskStatus::InProgress);
        b.logged_minutes = 90;
        b.priority = Some(TaskPriority::Urgent);
        let mut c = task("c", "pb2", TaskStatus::Done);
        c.due = Some(today() - Days::new(2));
        let d = task("d", "pa", TaskStatus::Backlog);
        let mut e = task("e", "pb", TaskStatus::Todo);
        e.due = Some(today() - Days::new(1));
        (customers, projects, vec![a, b, c, d, e])
    }

    fn ids(v: &[&Task]) -> Vec<String> {
        v.iter().map(|t| t.id.clone()).collect()
    }

    #[test]
    fn filters_combine() {
        let (c, p, t) = world();
        let all = Filters::default();
        assert_eq!(visible(&t, &c, &p, &all, today()).len(), 5);
        let f = Filters {
            customer: Some("kb".into()),
            ..Default::default()
        };
        assert_eq!(ids(&visible(&t, &c, &p, &f, today())), ["e", "b", "c"]);
        let f = Filters {
            customer: Some("kb".into()),
            project: Some("pb".into()),
            hide_done: true,
            ..Default::default()
        };
        assert_eq!(ids(&visible(&t, &c, &p, &f, today())), ["e", "b"]);
        let f = Filters {
            priority: Some(TaskPriority::Urgent),
            ..Default::default()
        };
        assert_eq!(ids(&visible(&t, &c, &p, &f, today())), ["b"]);
        let f = Filters {
            mine: true,
            ..Default::default()
        };
        assert_eq!(ids(&visible(&t, &c, &p, &f, today())), ["b"]);
    }

    #[test]
    fn due_soon_includes_overdue_but_not_done_or_far_off() {
        let (c, p, mut t) = world();
        t[3].due = Some(today() + Days::new(SOON_DAYS + 1));
        let f = Filters {
            due_soon: true,
            ..Default::default()
        };
        // a (om 3 dage) og e (overskredet); c er færdig, d ligger for langt ude.
        assert_eq!(ids(&visible(&t, &c, &p, &f, today())), ["e", "a"]);
        assert!(is_due_soon(&t[0], today()));
        assert!(!is_due_soon(&t[2], today()));
        assert!(!is_due_soon(&t[3], today()));
    }

    #[test]
    fn search_covers_title_description_project_and_customer() {
        let (c, p, t) = world();
        let q = |s: &str| Filters {
            query: s.into(),
            ..Default::default()
        };
        assert_eq!(ids(&visible(&t, &c, &p, &q("mobilepay"), today())), ["a"]);
        assert_eq!(ids(&visible(&t, &c, &p, &q("  BOOKING "), today())), ["e", "b"]);
        assert_eq!(ids(&visible(&t, &c, &p, &q("beta"), today())), ["e", "b", "c"]);
        assert_eq!(ids(&visible(&t, &c, &p, &q("webshop"), today())), ["a", "d"]);
        assert!(visible(&t, &c, &p, &q("findes ikke"), today()).is_empty());
    }

    #[test]
    fn narrows_ignores_hide_done() {
        assert!(!Filters::default().narrows());
        assert!(
            !Filters {
                hide_done: true,
                ..Default::default()
            }
            .narrows()
        );
        assert!(
            Filters {
                query: " x ".into(),
                ..Default::default()
            }
            .narrows()
        );
    }

    #[test]
    fn board_has_four_columns_sorted_by_priority_then_due() {
        let (c, p, mut t) = world();
        // De faste kolonner med oversatte navne: id'et placerer kortene.
        let lanes = fixed_lanes(|s| format!("{s:?}"));
        // To i Todo: e (ingen prioritet, overskredet) og a (høj, om 3 dage).
        let cols = board_columns(&t, &c, &p, &Filters::default(), today(), &lanes);
        assert_eq!(ids(&cols[0]), ["d"]);
        assert_eq!(ids(&cols[1]), ["a", "e"]);
        assert_eq!(ids(&cols[2]), ["b"]);
        assert_eq!(ids(&cols[3]), ["c"]);
        // Samme prioritet: frist afgør.
        t[4].priority = Some(TaskPriority::High);
        let cols = board_columns(&t, &c, &p, &Filters::default(), today(), &lanes);
        assert_eq!(ids(&cols[1]), ["e", "a"]);
        // Skjul afsluttede tømmer kun den sidste kolonne.
        let f = Filters {
            hide_done: true,
            ..Default::default()
        };
        let cols = board_columns(&t, &c, &p, &f, today(), &lanes);
        assert!(cols[3].is_empty());
        assert_eq!(cols[1].len(), 2);
    }

    #[test]
    fn list_sorts_open_first_then_due() {
        let (c, p, t) = world();
        let v = visible(&t, &c, &p, &Filters::default(), today());
        // e (i går), a (om 3), så uden frist (b, d), og færdige sidst (c).
        assert_eq!(ids(&v), ["e", "a", "b", "d", "c"]);
    }

    #[test]
    fn grouping_by_customer_and_project() {
        let (c, p, t) = world();
        let rows = visible(&t, &c, &p, &Filters::default(), today());
        let g = group(rows.clone(), &c, &p, Grouping::Customer, "Ukendt");
        assert_eq!(
            g.iter().map(|g| g.label.as_str()).collect::<Vec<_>>(),
            ["Alfa Bageri", "Beta Klinik"]
        );
        assert_eq!(ids(&g[0].tasks), ["a", "d"]);
        assert_eq!(ids(&g[1].tasks), ["e", "b", "c"]);
        let g = group(rows.clone(), &c, &p, Grouping::Project, "Ukendt");
        assert_eq!(
            g.iter().map(|g| g.label.as_str()).collect::<Vec<_>>(),
            ["Alfa Bageri · Webshop", "Beta Klinik · Booking", "Beta Klinik · SEO"]
        );
        let g = group(rows, &c, &p, Grouping::None, "Ukendt");
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].tasks.len(), 5);
    }

    #[test]
    fn tasks_without_known_project_land_in_an_unnamed_last_group() {
        let (c, p, mut t) = world();
        t.push(task("x", "findes_ikke", TaskStatus::Todo));
        let rows = visible(&t, &c, &p, &Filters::default(), today());
        let g = group(rows, &c, &p, Grouping::Customer, "Ukendt");
        let last = g.last().unwrap();
        assert_eq!((last.key.as_str(), last.label.as_str()), ("", "Ukendt"));
        assert_eq!(ids(&last.tasks), ["x"]);
    }

    #[test]
    fn lane_steps_stop_at_the_edges() {
        assert_eq!(step_lane(0, 6, true), Some(1));
        assert_eq!(step_lane(0, 6, false), None);
        assert_eq!(step_lane(5, 6, true), None);
        assert_eq!(step_lane(5, 6, false), Some(4));
    }

    #[test]
    fn minutes_are_formatted_like_web() {
        assert_eq!(format_minutes(0), "0m");
        assert_eq!(format_minutes(45), "45m");
        assert_eq!(format_minutes(60), "1t");
        assert_eq!(format_minutes(90), "1,5t");
        assert_eq!(format_minutes(340), "5,7t");
        assert_eq!(format_minutes(600), "10t");
        let (_, _, t) = world();
        let mut x = t[0].clone();
        x.logged_minutes = 90;
        assert_eq!(time_text(&x, "af", "m", "t"), "1,5t");
        x.estimate_minutes = Some(600);
        assert_eq!(time_text(&x, "af", "m", "t"), "1,5t af 10t");
        assert_eq!(progress_fraction(&x), Some(0.15));
        x.logged_minutes = 900;
        assert_eq!(progress_fraction(&x), Some(1.0));
        x.estimate_minutes = None;
        assert_eq!(progress_fraction(&x), None);
    }

    #[test]
    fn web_accent_colours_are_the_tailwind_values() {
        // Ikonfarverne er web's text-*-600 (lyst) og -400 (mørkt).
        assert_eq!(status_palette(TaskStatus::Backlog, false).accent, 0x4B5563);
        assert_eq!(status_palette(TaskStatus::Todo, false).accent, 0x2563EB);
        assert_eq!(status_palette(TaskStatus::InProgress, false).accent, 0xD97706);
        assert_eq!(status_palette(TaskStatus::Done, false).accent, 0x16A34A);
        assert_eq!(priority_palette(TaskPriority::High, false).accent, 0xEA580C);
        assert_eq!(priority_palette(TaskPriority::Urgent, false).accent, 0xDC2626);
        assert_eq!(status_palette(TaskStatus::Done, true).accent, 0x4ADE80);
        // Fladerne er -100.
        assert_eq!(status_palette(TaskStatus::Todo, false).bg, 0xDBEAFE);
        assert_eq!(priority_palette(TaskPriority::Low, false).bg, 0xF3F4F6);
    }

    #[test]
    fn every_status_and_priority_label_has_aa_contrast_in_both_themes() {
        for dark in [false, true] {
            for s in TaskStatus::ALL {
                let p = status_palette(s, dark);
                assert!(
                    farve::contrast(p.fg, p.bg) >= farve::AA,
                    "{s:?} dark={dark}: {:.2}",
                    farve::contrast(p.fg, p.bg)
                );
            }
            for s in TaskPriority::ALL {
                let p = priority_palette(s, dark);
                assert!(
                    farve::contrast(p.fg, p.bg) >= farve::AA,
                    "{s:?} dark={dark}: {:.2}",
                    farve::contrast(p.fg, p.bg)
                );
            }
        }
    }

    #[test]
    fn prefs_round_trip_and_survive_garbage() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Prefs::load(dir.path()), Prefs::default());
        let p = Prefs {
            view: View::Board,
            grouping: Grouping::Project,
            hide_done: true,
        };
        p.save(dir.path()).unwrap();
        assert_eq!(Prefs::load(dir.path()), p);
        std::fs::write(dir.path().join(PREFS_FILE), "{ikke json").unwrap();
        assert_eq!(Prefs::load(dir.path()), Prefs::default());
        std::fs::write(
            dir.path().join(PREFS_FILE),
            r#"{"view":"galakse","grouping":"customer"}"#,
        )
        .unwrap();
        assert_eq!(
            Prefs::load(dir.path()),
            Prefs {
                grouping: Grouping::Customer,
                ..Prefs::default()
            }
        );
    }
}
