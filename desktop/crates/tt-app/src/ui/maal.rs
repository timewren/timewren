//! Den fælles mål-vælgers model (kunde → projekt → opgave), uden GPUI, så
//! den kan testes direkte. Selve vælgeren står i `ui::maalvaelger`.
//!
//! Visningerne:
//! - **Rod** uden søgning: foreslåede (med begrundelse), seneste (1-9) og
//!   alle kunder med deres projekter indrykket under. "Intern tid" (uden
//!   kunde) og "Uden projekt" er almindelige valg.
//! - **Rod** med søgning: fuzzy på kunde, domæner, projekt og opgave,
//!   grupperet pr. kunde (kunden først, træfferne indrykket).
//! - **Kunde** (→): "Uden projekt" og kundens projekter, plus "Opret
//!   projekt 'X' under Kunde".
//! - **Projekt** (Tab/→): "Uden opgave" og projektets åbne opgaver.

use chrono::Days;

use crate::backend::{Backend, Customer, DateRange, Entry, Id, Project, ProjectStatus, Task, TaskStatus};
use crate::i18n::{t, tf, tf_n};
use crate::ui::fuzzy;

/// Det, brugeren vælger. `customer_id: None` = intern tid.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct PickTarget {
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    pub task_id: Option<Id>,
}

impl PickTarget {
    pub fn internal() -> Self {
        PickTarget::default()
    }

    pub fn customer(id: impl Into<Id>) -> Self {
        PickTarget {
            customer_id: Some(id.into()).filter(|c: &Id| !c.is_empty()),
            ..Default::default()
        }
    }

    pub fn project(customer: Option<&str>, project: impl Into<Id>) -> Self {
        PickTarget {
            customer_id: customer.filter(|c| !c.is_empty()).map(str::to_string),
            project_id: Some(project.into()),
            task_id: None,
        }
    }

    /// Kunde, projekt og opgave fra datalagets felter, hvor "" er ingen.
    pub fn from_parts(customer: Option<&str>, project: Option<&str>, task: Option<&str>) -> Self {
        let some = |v: Option<&str>| v.filter(|x| !x.is_empty()).map(str::to_string);
        PickTarget {
            customer_id: some(customer),
            project_id: some(project),
            task_id: some(task),
        }
    }

    /// Kunde-id til datalaget: "" = intern tid.
    pub fn customer_or_empty(&self) -> Id {
        self.customer_id.clone().unwrap_or_default()
    }

    pub fn is_internal(&self) -> bool {
        self.customer_id.is_none()
    }
}

/// Et forslag øverst i vælgeren, med begrundelse ("repo bageriet-webshop").
#[derive(Clone, Debug, PartialEq)]
pub struct Hint {
    pub target: PickTarget,
    pub reason: String,
}

/// Kunder, projekter, opgaver og de seneste mål, hentet samlet.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Catalog {
    pub customers: Vec<Customer>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub recent: Vec<PickTarget>,
}

/// Så mange dage tilbage hentes de seneste mål fra posterne.
const RECENT_DAYS: u64 = 30;
/// Højst så mange seneste (tasterne 1-9).
pub const RECENT_MAX: usize = 9;

impl Catalog {
    pub fn load(b: &dyn Backend) -> crate::backend::Result<Catalog> {
        let today = b.today();
        let from = today.checked_sub_days(Days::new(RECENT_DAYS)).unwrap_or(today);
        let mut entries = b.entries(DateRange { from, to: today }).unwrap_or_default();
        // Timerens mål er det allerseneste.
        if let Ok(timer) = b.timer()
            && timer.status != crate::backend::TimerStatus::Idle
            && (timer.customer_id.is_some() || timer.project_id.is_some())
        {
            entries.push(Entry {
                id: String::new(),
                customer_id: timer.customer_id.unwrap_or_default(),
                project_id: timer.project_id,
                task_id: timer.task_id,
                description: String::new(),
                date: today,
                start: Some(chrono::NaiveTime::from_hms_opt(23, 59, 59).expect("gyldig")),
                end: None,
                minutes: 0,
                billable: true,
                invoice_id: None,
            });
        }
        Ok(Catalog {
            customers: b.customers(true)?,
            projects: b.projects(None, true)?,
            // Opgaverne er en ekstra: uden dem kan man stadig vælge kunde og projekt.
            tasks: b.tasks(None).unwrap_or_default(),
            recent: recent_targets(&entries, RECENT_MAX),
        })
    }

    pub fn customer(&self, id: &str) -> Option<&Customer> {
        self.customers.iter().find(|c| c.id == id)
    }

    pub fn project(&self, id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == id)
    }

    pub fn task(&self, id: &str) -> Option<&Task> {
        self.tasks.iter().find(|x| x.id == id)
    }

    /// Findes målet stadig (kunde, projekt og opgave)?
    pub fn resolves(&self, t: &PickTarget) -> bool {
        t.customer_id.as_deref().is_none_or(|c| self.customer(c).is_some())
            && t.project_id.as_deref().is_none_or(|p| self.project(p).is_some())
            && t.task_id.as_deref().is_none_or(|x| self.task(x).is_some())
    }

    /// "Bageriet på Hjørnet · Ny webshop · Kurv", "Intern tid · Admin" eller
    /// "Bageriet på Hjørnet · Uden projekt".
    pub fn label(&self, t: &PickTarget) -> String {
        let mut parts: Vec<String> = Vec::new();
        match t.customer_id.as_deref().and_then(|c| self.customer(c)) {
            Some(c) => parts.push(c.name.clone()),
            None if t.customer_id.is_some() => parts.push(crate::i18n::t("maal.ukendt_kunde").into()),
            None => parts.push(crate::i18n::t("maal.intern").into()),
        }
        match t.project_id.as_deref().and_then(|p| self.project(p)) {
            Some(p) => parts.push(p.name.clone()),
            None if t.customer_id.is_some() => parts.push(crate::i18n::t("maal.uden_projekt").into()),
            None => {}
        }
        if let Some(task) = t.task_id.as_deref().and_then(|x| self.task(x)) {
            parts.push(task.title.clone());
        }
        parts.join(" · ")
    }

    fn open_projects<'a>(
        &'a self,
        customer: &'a str,
        show_archived: bool,
    ) -> impl Iterator<Item = &'a Project> + 'a {
        let mut v: Vec<&Project> = self
            .projects
            .iter()
            .filter(move |p| p.customer_id == customer)
            .filter(move |p| show_archived || is_open(p))
            .collect();
        v.sort_by_key(|p| (!is_open(p), p.name.to_lowercase()));
        v.into_iter()
    }

    fn open_tasks<'a>(&'a self, project: &'a str) -> impl Iterator<Item = &'a Task> + 'a {
        self.tasks
            .iter()
            .filter(move |x| x.project_id == project && x.status != TaskStatus::Done)
    }

    fn customers_sorted(&self, show_archived: bool) -> Vec<&Customer> {
        let mut v: Vec<&Customer> = self
            .customers
            .iter()
            .filter(|c| show_archived || !c.archived)
            .collect();
        v.sort_by_key(|c| (c.archived, c.name.to_lowercase()));
        v
    }

    /// Antal skjulte arkiverede kunder og projekter.
    fn hidden_archived(&self) -> usize {
        self.customers.iter().filter(|c| c.archived).count()
            + self.projects.iter().filter(|p| !is_open(p)).count()
    }
}

fn is_open(p: &Project) -> bool {
    matches!(p.status, ProjectStatus::Active | ProjectStatus::Paused)
}

/// De seneste forskellige mål, nyeste først (dato, så starttid).
pub fn recent_targets(entries: &[Entry], limit: usize) -> Vec<PickTarget> {
    let mut sorted: Vec<&Entry> = entries.iter().collect();
    sorted.sort_by_key(|e| std::cmp::Reverse((e.date, e.start)));
    let mut out: Vec<PickTarget> = Vec::new();
    for e in sorted {
        let t = PickTarget::from_parts(
            Some(&e.customer_id),
            e.project_id.as_deref(),
            e.task_id.as_deref(),
        );
        if !out.contains(&t) {
            out.push(t);
        }
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// Hvor i vælgeren man er.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum View {
    #[default]
    Root,
    /// Kundens projekter. "" = intern tid (projekter uden kunde).
    Customer(Id),
    /// Projektets opgaver.
    Project(Id),
}

#[derive(Clone, Debug, PartialEq)]
pub enum RowKind {
    /// Overskrift (kan ikke vælges).
    Header,
    Target(PickTarget),
    CreateCustomer(String),
    CreateProject { customer_id: Id, name: String },
    ToggleArchived,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub kind: RowKind,
    pub title: String,
    /// Dæmpet tekst til højre: begrundelse, antal projekter, projektets navn.
    pub detail: String,
    /// Kunden, hvis farve prikken får. `Some("")` = intern tid (grå).
    pub color_of: Option<Id>,
    pub indent: u8,
    /// 1-9 på de seneste.
    pub number: Option<u8>,
    pub archived: bool,
    /// → åbner kunden/projektet.
    pub expands: Option<View>,
    /// Søgningens point. Markøren starter på den bedste træffer.
    pub hit: Option<i32>,
}

impl Row {
    fn header(title: impl Into<String>) -> Row {
        Row {
            kind: RowKind::Header,
            title: title.into(),
            detail: String::new(),
            color_of: None,
            indent: 0,
            number: None,
            archived: false,
            expands: None,
            hit: None,
        }
    }

    fn target(t: PickTarget, title: impl Into<String>, detail: impl Into<String>) -> Row {
        Row {
            color_of: Some(t.customer_or_empty()),
            kind: RowKind::Target(t),
            title: title.into(),
            detail: detail.into(),
            indent: 0,
            number: None,
            archived: false,
            expands: None,
            hit: None,
        }
    }

    fn hit(mut self, h: Option<i32>) -> Row {
        self.hit = h;
        self
    }

    fn indent(mut self, n: u8) -> Row {
        self.indent = n;
        self
    }

    fn expands(mut self, v: Option<View>) -> Row {
        self.expands = v;
        self
    }

    fn archived(mut self, a: bool) -> Row {
        self.archived = a;
        self
    }

    pub fn selectable(&self) -> bool {
        self.kind != RowKind::Header
    }

    pub fn pick_target(&self) -> Option<&PickTarget> {
        match &self.kind {
            RowKind::Target(t) => Some(t),
            _ => None,
        }
    }

    /// Skærmlæserens tekst.
    pub fn label(&self) -> String {
        let mut s = self.title.clone();
        if !self.detail.is_empty() {
            s.push_str(", ");
            s.push_str(&self.detail);
        }
        if self.archived {
            s.push_str(", ");
            s.push_str(t("maal.arkiveret"));
        }
        if let Some(n) = self.number {
            s.push_str(", ");
            s.push_str(&tf("maal.tast", &[("n", &n.to_string())]));
        }
        s
    }
}

fn customer_detail(cat: &Catalog, c: &Customer, show_archived: bool) -> String {
    let n = cat.open_projects(&c.id, show_archived).count();
    if n == 0 {
        t("maal.ingen_projekter").into()
    } else {
        tf_n("maal.n_projekter", n, &[])
    }
}

fn customer_row(cat: &Catalog, c: &Customer, show_archived: bool) -> Row {
    let has_projects = cat.open_projects(&c.id, show_archived).next().is_some();
    Row::target(
        PickTarget::customer(c.id.clone()),
        c.name.clone(),
        customer_detail(cat, c, show_archived),
    )
    .archived(c.archived)
    .expands(has_projects.then(|| View::Customer(c.id.clone())))
}

fn project_row(cat: &Catalog, p: &Project, indent: u8) -> Row {
    let has_tasks = cat.open_tasks(&p.id).next().is_some();
    let detail = if has_tasks {
        tf_n("maal.n_opgaver", cat.open_tasks(&p.id).count(), &[])
    } else {
        String::new()
    };
    Row::target(PickTarget::project(Some(&p.customer_id), p.id.clone()), p.name.clone(), detail)
        .indent(indent)
        .archived(!is_open(p))
        .expands(has_tasks.then(|| View::Project(p.id.clone())))
}

fn task_row(p: &Project, task: &Task, indent: u8, detail: String) -> Row {
    let mut t = PickTarget::project(Some(&p.customer_id), p.id.clone());
    t.task_id = Some(task.id.clone());
    Row::target(t, task.title.clone(), detail).indent(indent)
}

fn internal_row(cat: &Catalog, show_archived: bool) -> Row {
    let has = cat.open_projects("", show_archived).next().is_some();
    Row::target(PickTarget::internal(), t("maal.intern"), t("maal.intern_hjaelp"))
        .expands(has.then(|| View::Customer(String::new())))
}

/// Rækkerne for visningen og søgningen.
pub fn rows(cat: &Catalog, hints: &[Hint], view: &View, query: &str, show_archived: bool) -> Vec<Row> {
    let q = query.trim();
    match view {
        View::Root if q.is_empty() => root_rows(cat, hints, show_archived),
        View::Root => search_rows(cat, q, show_archived),
        View::Customer(id) => customer_rows(cat, id, q, show_archived),
        View::Project(id) => project_rows(cat, id, q),
    }
}

fn root_rows(cat: &Catalog, hints: &[Hint], show_archived: bool) -> Vec<Row> {
    let mut out = Vec::new();
    let hints: Vec<&Hint> = hints.iter().filter(|h| cat.resolves(&h.target)).collect();
    if !hints.is_empty() {
        out.push(Row::header(t("maal.foreslaaet")));
        for h in hints {
            out.push(Row::target(h.target.clone(), cat.label(&h.target), h.reason.clone()));
        }
    }
    let recent: Vec<&PickTarget> = cat.recent.iter().filter(|r| cat.resolves(r)).take(RECENT_MAX).collect();
    if !recent.is_empty() {
        out.push(Row::header(t("maal.seneste")));
        for (i, r) in recent.into_iter().enumerate() {
            let mut row = Row::target(r.clone(), cat.label(r), String::new());
            row.number = Some(i as u8 + 1);
            out.push(row);
        }
    }
    out.push(Row::header(t("maal.alle")));
    out.push(internal_row(cat, show_archived));
    for c in cat.customers_sorted(show_archived) {
        out.push(customer_row(cat, c, show_archived));
        for p in cat.open_projects(&c.id, show_archived) {
            out.push(project_row(cat, p, 1));
        }
    }
    push_archived_toggle(cat, show_archived, &mut out);
    out
}

fn push_archived_toggle(cat: &Catalog, show_archived: bool, out: &mut Vec<Row>) {
    let hidden = cat.hidden_archived();
    if hidden == 0 {
        return;
    }
    let mut row = Row::header(if show_archived {
        t("maal.skjul_arkiverede").to_string()
    } else {
        tf("maal.vis_arkiverede", &[("n", &hidden.to_string())])
    });
    row.kind = RowKind::ToggleArchived;
    out.push(row);
}

/// Søgetermerne fra kundens profil (`tt_matcher::profile`).
fn profile_terms(c: &Customer) -> Vec<String> {
    let client = tt_matcher::Client {
        id: c.id.clone(),
        name: c.name.clone(),
        domains: c.domains.clone(),
        cvr: c.cvr.clone(),
        mail_domains: c
            .email
            .as_deref()
            .and_then(|e| e.rsplit_once('@'))
            .map(|(_, d)| vec![d.to_string()])
            .unwrap_or_default(),
        ..Default::default()
    };
    tt_matcher::profile::ClientProfile::of(&client).search_terms()
}

fn score(q: &str, hay: &str) -> Option<i32> {
    fuzzy::score(&q.to_lowercase(), &hay.to_lowercase())
}

/// Én kundes træffere: (bedste point, rækker).
fn search_rows(cat: &Catalog, q: &str, show_archived: bool) -> Vec<Row> {
    let mut groups: Vec<(i32, Vec<Row>)> = Vec::new();

    // Intern tid og projekter uden kunde.
    {
        let mut best = score(q, t("maal.intern")).map(|s| s + 5);
        let mut children = Vec::new();
        for p in cat.open_projects("", show_archived) {
            if let Some(s) = score(q, &format!("{} {}", t("maal.intern"), p.name)) {
                best = best.max(Some(s));
                children.push(project_row(cat, p, 1).hit(Some(s)));
            }
        }
        if let Some(b) = best {
            let mut rows = vec![internal_row(cat, show_archived).hit(score(q, t("maal.intern")).map(|s| s + 5))];
            rows.extend(children);
            groups.push((b, rows));
        }
    }

    for c in cat.customers_sorted(show_archived) {
        // Navn og domæner, og kundens profil: kerne-navn uden selskabsform,
        // æøå skrevet som ae/oe/aa eller a/o/a, mail-domæne og CVR.
        let own = score(q, &format!("{} {}", c.name, c.domains.join(" ")))
            .max(profile_terms(c).iter().filter_map(|term| score(q, term)).max());
        // Kundens egne træf vejer lidt mere end et projekt med samme point.
        let mut best = own.map(|s| s + 5);
        let mut children = Vec::new();
        for p in cat.open_projects(&c.id, show_archived) {
            let ps = score(q, &format!("{} {}", c.name, p.name));
            if let Some(s) = ps {
                best = best.max(Some(s));
            }
            let mut tasks = Vec::new();
            for task in cat.open_tasks(&p.id) {
                if let Some(s) = score(q, &format!("{} {} {}", c.name, p.name, task.title)) {
                    // En opgave tæller kun, når søgningen rammer mere end kunden.
                    if own.is_none_or(|o| s > o) || ps.is_none() {
                        best = best.max(Some(s - 2));
                        tasks.push(task_row(p, task, 2, String::new()).hit(Some(s - 2)));
                    }
                }
            }
            if ps.is_some() || !tasks.is_empty() {
                children.push(project_row(cat, p, 1).hit(ps));
                children.extend(tasks);
            }
        }
        if let Some(b) = best {
            let mut rows = vec![customer_row(cat, c, show_archived).hit(own.map(|s| s + 5))];
            // Et domæne, der matcher, står som begrundelse.
            if let Some(d) = c.domains.iter().find(|d| score(q, d).is_some() && score(q, &c.name).is_none()) {
                rows[0].detail = tf("maal.domaene", &[("domaene", d)]);
            }
            rows.extend(children);
            groups.push((b, rows));
        }
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.0));
    let mut out: Vec<Row> = groups.into_iter().flat_map(|(_, r)| r).collect();
    let exact = cat
        .customers
        .iter()
        .any(|c| c.name.trim().eq_ignore_ascii_case(q));
    if !exact {
        let mut row = Row::header(tf("maal.opret_kunde", &[("navn", q)]));
        row.kind = RowKind::CreateCustomer(q.to_string());
        out.push(row);
    }
    if !show_archived && cat.hidden_archived() > 0 {
        push_archived_toggle(cat, show_archived, &mut out);
    }
    out
}

fn customer_rows(cat: &Catalog, id: &str, q: &str, show_archived: bool) -> Vec<Row> {
    let mut out = Vec::new();
    let (name, base) = match cat.customer(id) {
        Some(c) => (c.name.clone(), PickTarget::customer(c.id.clone())),
        None => (t("maal.intern").to_string(), PickTarget::internal()),
    };
    out.push(Row::header(name.clone()));
    let without = if base.is_internal() { t("maal.intern") } else { t("maal.uden_projekt") };
    if q.is_empty() || score(q, without).is_some() {
        let mut row = Row::target(base, without, t("maal.uden_projekt_hjaelp")).indent(1);
        if row.title == t("maal.intern") {
            row.detail = t("maal.intern_hjaelp").into();
        }
        out.push(row);
    }
    let mut ranked: Vec<(i32, &Project)> = cat
        .open_projects(id, show_archived)
        .filter_map(|p| if q.is_empty() { Some((0, p)) } else { score(q, &p.name).map(|s| (s, p)) })
        .collect();
    ranked.sort_by_key(|r| std::cmp::Reverse(r.0));
    for (_, p) in ranked {
        out.push(project_row(cat, p, 1));
    }
    if !q.is_empty()
        && !cat
            .projects
            .iter()
            .any(|p| p.customer_id == id && p.name.trim().eq_ignore_ascii_case(q))
    {
        let mut row = Row::header(tf("maal.opret_projekt", &[("navn", q), ("kunde", &name)]));
        row.kind = RowKind::CreateProject {
            customer_id: id.to_string(),
            name: q.to_string(),
        };
        out.push(row);
    }
    if cat.projects.iter().any(|p| p.customer_id == id && !is_open(p)) {
        push_archived_toggle(cat, show_archived, &mut out);
    }
    out
}

fn project_rows(cat: &Catalog, id: &str, q: &str) -> Vec<Row> {
    let Some(p) = cat.project(id) else {
        return vec![];
    };
    let mut out = vec![Row::header(cat.label(&PickTarget::project(Some(&p.customer_id), p.id.clone())))];
    let base = PickTarget::project(Some(&p.customer_id), p.id.clone());
    if q.is_empty() || score(q, t("maal.uden_opgave")).is_some() {
        out.push(Row::target(base, t("maal.uden_opgave"), String::new()).indent(1));
    }
    let mut ranked: Vec<(i32, &Task)> = cat
        .open_tasks(id)
        .filter_map(|x| if q.is_empty() { Some((0, x)) } else { score(q, &x.title).map(|s| (s, x)) })
        .collect();
    ranked.sort_by_key(|r| std::cmp::Reverse(r.0));
    for (_, x) in ranked {
        out.push(task_row(p, x, 1, x.status.label().into()));
    }
    out
}

/// Næste række, der kan vælges, fra `from` i retningen `dir` (+1/-1).
pub fn step(rows: &[Row], from: usize, dir: i32) -> usize {
    let n = rows.len() as i32;
    let mut i = from as i32 + dir;
    while i >= 0 && i < n {
        if rows[i as usize].selectable() {
            return i as usize;
        }
        i += dir;
    }
    from
}

/// Første række, der kan vælges (eller 0).
pub fn first_selectable(rows: &[Row]) -> usize {
    rows.iter().position(Row::selectable).unwrap_or(0)
}

/// Hvor markøren starter: den bedste træffer ved søgning, ellers den første.
pub fn initial(rows: &[Row]) -> usize {
    let mut best: Option<(i32, usize)> = None;
    for (i, r) in rows.iter().enumerate() {
        if let Some(h) = r.hit
            && best.is_none_or(|(b, _)| h > b)
        {
            best = Some((h, i));
        }
    }
    best.map_or_else(|| first_selectable(rows), |(_, i)| i)
}

/// Rækken med tallet `n` (seneste).
pub fn numbered(rows: &[Row], n: u8) -> Option<usize> {
    rows.iter().position(|r| r.number == Some(n))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, NaiveTime};

    fn cust(id: &str, name: &str, archived: bool, domains: &[&str]) -> Customer {
        Customer {
            id: id.into(),
            name: name.into(),
            archived,
            domains: domains.iter().map(|d| d.to_string()).collect(),
            ..Customer::default()
        }
    }

    fn proj(id: &str, customer: &str, name: &str, status: ProjectStatus) -> Project {
        Project {
            id: id.into(),
            customer_id: customer.into(),
            name: name.into(),
            status,
            hourly_rate: None,
            budget_minutes: None,
            url_patterns: vec![],
        }
    }

    fn task(id: &str, project: &str, title: &str) -> Task {
        Task {
            id: id.into(),
            project_id: project.into(),
            title: title.into(),
            status: TaskStatus::Todo,
            due: None,
            logged_minutes: 0,
            estimate_minutes: None,
            priority: None,
            description: None,
            customer_id: None,
            status_id: None,
        }
    }

    fn cat() -> Catalog {
        Catalog {
            customers: vec![
                cust("c-bag", "Bageriet på Hjørnet", false, &["bageriet.dk"]),
                // Kunde helt uden projekter.
                cust("c-yoga", "Yogahuset Vesterbro", false, &[]),
                cust("c-klinik", "Klinik Søndergade", false, &["kliniksondergade.dk"]),
                cust("c-gl", "Frisør Ærø", true, &[]),
            ],
            projects: vec![
                proj("p-web", "c-bag", "Ny webshop", ProjectStatus::Active),
                proj("p-drift", "c-bag", "Drift og support", ProjectStatus::Paused),
                proj("p-gl", "c-bag", "Gammel kampagne", ProjectStatus::Archived),
                proj("p-book", "c-klinik", "Booking-modul", ProjectStatus::Active),
                proj("p-admin", "", "Administration", ProjectStatus::Active),
            ],
            tasks: vec![
                task("t-kurv", "p-web", "Kurv og betaling med MobilePay"),
                task("t-sms", "p-book", "SMS-påmindelser"),
            ],
            recent: vec![
                PickTarget::project(Some("c-klinik"), "p-book"),
                PickTarget::customer("c-yoga"),
                PickTarget::internal(),
            ],
        }
    }

    fn titles(rows: &[Row]) -> Vec<(u8, &str)> {
        rows.iter().map(|r| (r.indent, r.title.as_str())).collect()
    }

    #[test]
    fn profilen_finder_kunden_paa_stavemaade_kerne_navn_og_cvr() {
        let mut c = cat();
        let mut toemrer = cust("c-tom", "Hansen Tømrer ApS", false, &[]);
        toemrer.cvr = Some("12345678".into());
        c.customers.push(toemrer);
        let hit = |q: &str| {
            rows(&c, &[], &View::Root, q, false)
                .iter()
                .any(|r| r.title == "Hansen Tømrer ApS")
        };
        // æøå skrevet som ae/oe/aa eller a/o/a.
        assert!(hit("toemrer"));
        assert!(hit("tomrer"));
        assert!(hit("12345678"));
        // Søgningen finder ikke alt: et ord, der ikke er der, giver ingen træf.
        assert!(!hit("bageri"));
    }

    #[test]
    fn roden_har_seneste_med_tal_og_kunder_med_projekter_indrykket() {
        let rows = rows(&cat(), &[], &View::Root, "", false);
        let seneste = rows.iter().position(|r| r.title == t("maal.seneste")).unwrap();
        assert_eq!(rows[seneste + 1].number, Some(1));
        assert_eq!(rows[seneste + 1].title, "Klinik Søndergade · Booking-modul");
        assert_eq!(rows[seneste + 2].title, "Yogahuset Vesterbro · Uden projekt");
        assert_eq!(rows[seneste + 3].title, t("maal.intern"));
        let tl = titles(&rows);
        let bag = tl.iter().position(|r| r.1 == "Bageriet på Hjørnet").unwrap();
        assert_eq!(tl[bag + 1], (1, "Drift og support"));
        assert_eq!(tl[bag + 2], (1, "Ny webshop"));
        // Kunden uden projekter kan vælges direkte.
        let yoga = rows.iter().find(|r| r.title == "Yogahuset Vesterbro").unwrap();
        assert_eq!(yoga.pick_target(), Some(&PickTarget::customer("c-yoga")));
        assert_eq!(yoga.expands, None);
        // Arkiverede er skjult, men kan vises.
        assert!(!tl.iter().any(|r| r.1 == "Frisør Ærø" || r.1 == "Gammel kampagne"));
        assert!(rows.iter().any(|r| r.kind == RowKind::ToggleArchived));
        let all = super::rows(&cat(), &[], &View::Root, "", true);
        assert!(all.iter().any(|r| r.title == "Frisør Ærø" && r.archived));
        assert!(all.iter().any(|r| r.title == "Gammel kampagne" && r.archived));
    }

    #[test]
    fn foreslaaede_staar_oeverst_med_begrundelse() {
        let hint = Hint {
            target: PickTarget::project(Some("c-bag"), "p-web"),
            reason: "repo bageriet-webshop".into(),
        };
        let gone = Hint {
            target: PickTarget::customer("c-findes-ikke"),
            reason: "x".into(),
        };
        let rows = rows(&cat(), &[hint.clone(), gone], &View::Root, "", false);
        assert_eq!(rows[0].title, t("maal.foreslaaet"));
        assert_eq!(rows[1].title, "Bageriet på Hjørnet · Ny webshop");
        assert_eq!(rows[1].detail, "repo bageriet-webshop");
        assert_eq!(rows[2].title, t("maal.seneste"));
        assert_eq!(first_selectable(&rows), 1);
    }

    #[test]
    fn soegning_paa_tvaers_grupperet_pr_kunde() {
        // Projektnavn: kunden står over træfferen.
        let r = rows(&cat(), &[], &View::Root, "webshop", false);
        assert_eq!(titles(&r)[..2], [(0, "Bageriet på Hjørnet"), (1, "Ny webshop")]);
        // Opgavetitel: opgaven under sit projekt.
        let r = rows(&cat(), &[], &View::Root, "mobilepay", false);
        assert_eq!(
            titles(&r)[..3],
            [(0, "Bageriet på Hjørnet"), (1, "Ny webshop"), (2, "Kurv og betaling med MobilePay")]
        );
        let t_row = &r[2];
        assert_eq!(
            t_row.pick_target().unwrap().task_id.as_deref(),
            Some("t-kurv")
        );
        // Domæne: kunden findes, og domænet står som begrundelse.
        let r = rows(&cat(), &[], &View::Root, "kliniksond", false);
        assert_eq!(r[0].title, "Klinik Søndergade");
        assert!(r[0].detail.contains("kliniksondergade.dk"));
        // Intern tid og projekter uden kunde.
        let r = rows(&cat(), &[], &View::Root, "admin", false);
        assert_eq!(titles(&r)[..2], [(0, t("maal.intern")), (1, "Administration")]);
        assert_eq!(r[1].pick_target(), Some(&PickTarget::project(None, "p-admin")));
        // Æøå og fuzzy.
        let r = rows(&cat(), &[], &View::Root, "søndrg", false);
        assert_eq!(r[0].title, "Klinik Søndergade");
        // Altid "Opret kunde 'X'" sidst, når navnet ikke findes.
        let r = rows(&cat(), &[], &View::Root, "Tømrer Hansen", false);
        assert_eq!(r.last().unwrap().kind, RowKind::ToggleArchived);
        assert!(r.iter().any(|x| x.kind == RowKind::CreateCustomer("Tømrer Hansen".into())));
        let r = rows(&cat(), &[], &View::Root, "yogahuset vesterbro", false);
        assert!(!r.iter().any(|x| matches!(x.kind, RowKind::CreateCustomer(_))));
    }

    #[test]
    fn kundevisning_med_uden_projekt_og_opret_projekt() {
        let v = View::Customer("c-bag".into());
        let r = rows(&cat(), &[], &v, "", false);
        assert_eq!(r[0].title, "Bageriet på Hjørnet");
        assert_eq!(r[1].title, t("maal.uden_projekt"));
        assert_eq!(r[1].pick_target(), Some(&PickTarget::customer("c-bag")));
        assert_eq!(r[2].title, "Drift og support");
        assert_eq!(r[3].expands, Some(View::Project("p-web".into())));
        let r = rows(&cat(), &[], &v, "Logo", false);
        assert_eq!(
            r.iter().find(|x| matches!(x.kind, RowKind::CreateProject { .. })).unwrap().kind,
            RowKind::CreateProject { customer_id: "c-bag".into(), name: "Logo".into() }
        );
        // Intern tid: projekter uden kunde.
        let r = rows(&cat(), &[], &View::Customer(String::new()), "", false);
        assert_eq!(r[1].pick_target(), Some(&PickTarget::internal()));
        assert_eq!(r[2].title, "Administration");
    }

    #[test]
    fn projektvisning_med_uden_opgave_og_opgaver() {
        let r = rows(&cat(), &[], &View::Project("p-web".into()), "", false);
        assert_eq!(r[0].title, "Bageriet på Hjørnet · Ny webshop");
        assert_eq!(r[1].pick_target(), Some(&PickTarget::project(Some("c-bag"), "p-web")));
        assert_eq!(r[2].title, "Kurv og betaling med MobilePay");
    }

    #[test]
    fn piletaster_springer_overskrifter_over_og_tal_finder_seneste() {
        let r = rows(&cat(), &[], &View::Root, "", false);
        let first = first_selectable(&r);
        assert!(r[first].selectable());
        assert_eq!(r[first].number, Some(1));
        let next = step(&r, first, 1);
        assert_eq!(r[next].number, Some(2));
        assert_eq!(step(&r, first, -1), first);
        let three = numbered(&r, 3).unwrap();
        assert_eq!(r[three].pick_target(), Some(&PickTarget::internal()));
        // "Alle"-overskriften springes over.
        let after_recent = step(&r, three, 1);
        assert_eq!(r[after_recent].title, t("maal.intern"));
    }

    #[test]
    fn seneste_fra_posterne_nyeste_foerst_uden_dubletter() {
        let d = |day: u32| NaiveDate::from_ymd_opt(2026, 10, day).unwrap();
        let tm = |h: u32| Some(NaiveTime::from_hms_opt(h, 0, 0).unwrap());
        let e = |date, start, c: &str, p: Option<&str>| Entry {
            id: "e".into(),
            customer_id: c.into(),
            project_id: p.map(str::to_string),
            task_id: None,
            description: String::new(),
            date,
            start,
            end: None,
            minutes: 60,
            billable: true,
            invoice_id: None,
        };
        let entries = vec![
            e(d(26), tm(9), "c-bag", Some("p-web")),
            e(d(27), tm(8), "c-klinik", None),
            e(d(27), tm(13), "", Some("p-admin")),
            e(d(25), tm(9), "c-bag", Some("p-web")),
        ];
        let r = recent_targets(&entries, 9);
        assert_eq!(
            r,
            vec![
                PickTarget::project(None, "p-admin"),
                PickTarget::customer("c-klinik"),
                PickTarget::project(Some("c-bag"), "p-web"),
            ]
        );
        assert_eq!(recent_targets(&entries, 1).len(), 1);
    }

    #[test]
    fn markoeren_starter_paa_bedste_traeffer() {
        let r = rows(&cat(), &[], &View::Root, "bagr web", false);
        assert_eq!(r[initial(&r)].title, "Ny webshop");
        let r = rows(&cat(), &[], &View::Root, "bageriet drift", false);
        assert_eq!(r[initial(&r)].title, "Drift og support");
        let r = rows(&cat(), &[], &View::Root, "bageriet", false);
        assert_eq!(r[initial(&r)].title, "Bageriet på Hjørnet");
        let r = rows(&cat(), &[], &View::Root, "", false);
        assert_eq!(initial(&r), first_selectable(&r));
    }

    #[test]
    fn etiketter() {
        let c = cat();
        assert_eq!(c.label(&PickTarget::customer("c-yoga")), "Yogahuset Vesterbro · Uden projekt");
        assert_eq!(c.label(&PickTarget::internal()), t("maal.intern"));
        assert_eq!(
            c.label(&PickTarget::project(None, "p-admin")),
            format!("{} · Administration", t("maal.intern"))
        );
        let mut tk = PickTarget::project(Some("c-bag"), "p-web");
        tk.task_id = Some("t-kurv".into());
        assert_eq!(c.label(&tk), "Bageriet på Hjørnet · Ny webshop · Kurv og betaling med MobilePay");
    }
}
