//! Datalaget set fra UI'et.
//!
//! `Backend` er appens lokale kopi af `Repository`-traitet fra `tt-data`
//! (`crates/tt-data` på `v1/data`). Indtil den findes, er metoderne udledt af
//! specen (docs/specs/2026-10-26-desktop-1.0.md, afsnit A-D) og udvidelsens
//! tRPC-API (`extension.*`). Integrationsagenten erstatter typerne her med
//! `tt-data`'s og implementerer `Backend` for `CloudRepo`/`LocalRepo` med en
//! tynd adapter, så skærmene ikke skal ændres.
//!
//! Traitet er synkront og `Send + Sync`: skærmene kalder det på GPUI's
//! background executor via `AppCtx::fetch`, aldrig på UI-tråden.
//!
//! Beløb er i øre (`i64`), varigheder i minutter eller sekunder (`u32`/`u64`).

// Idle-spørgsmål, påmindelser og pomodoro: indstillinger.
pub mod d21;
// Licens og adgang (offline-respit, udløbet prøve).
pub mod licens;
pub mod mock;
// Integration: Backend oven på tt-data (LocalRepo/CloudRepo).
pub mod repo;
// Integration: grænsefladen mellem datalag og detektion.
pub mod services;

use std::fmt;

use chrono::{DateTime, Local, NaiveDate, NaiveTime};

pub use mock::MockBackend;
pub use repo::RepoBackend;
// Observatøren: "Lær TimeTrack at kende".
pub mod observer;
pub use observer::*;

pub type Id = String;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Logget ind: web er sandheden.
    Cloud { organization: String },
    /// Uden konto: egen database og livstidslicens.
    Local,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackendError {
    NotFound(String),
    /// Brugerens input er ugyldigt. Teksten er dansk og kan vises direkte.
    Validation(String),
    /// Ingen forbindelse. Handlingen ligger i offline-køen.
    Offline,
    /// Ændret et andet sted (fx timeren stoppet i web). Hent igen.
    Conflict(String),
    /// Planens grænse er nået (håndhæves på serveren).
    PlanLimit(String),
    /// Loginet er udløbet eller tilbagekaldt. Log ind igen.
    Unauthorized,
    Other(String),
}

impl fmt::Display for BackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BackendError::NotFound(what) => write!(f, "{what} findes ikke længere"),
            BackendError::Validation(msg) => write!(f, "{msg}"),
            BackendError::Offline => {
                write!(f, "Du er offline. Ændringen sendes, når du er online igen")
            }
            BackendError::Conflict(msg) => write!(f, "Ændret et andet sted: {msg}"),
            BackendError::PlanLimit(msg) => write!(f, "Din plan tillader det ikke: {msg}"),
            BackendError::Unauthorized => write!(f, "Du er logget ud. Log ind igen"),
            BackendError::Other(msg) => write!(f, "Noget gik galt: {msg}"),
        }
    }
}

impl std::error::Error for BackendError {}

pub type Result<T> = std::result::Result<T, BackendError>;

// ---------- Kunder og projekter ----------

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Customer {
    pub id: Id,
    pub name: String,
    pub email: Option<String>,
    /// Timepris i øre. `None` = brug global sats.
    pub hourly_rate: Option<i64>,
    pub archived: bool,
    /// CVR-nummer (8 cifre). // screens-a
    pub cvr: Option<String>,
    /// Web's `clients.color` ("#RRGGBB"). `None` = farven udledes af id'et
    /// (`ui::farver::customer_color`). // ux-vaelger
    pub color: Option<String>,
    pub phone: Option<String>,
    pub notes: Option<String>,
    /// Kundens egne domæner (web's `clients.domains`), normaliseret.
    pub domains: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CustomerInput {
    pub name: String,
    pub email: Option<String>,
    pub hourly_rate: Option<i64>,
    /// CVR-nummer (8 cifre). // screens-a
    pub cvr: Option<String>,
    /// "#RRGGBB". Tom = ingen farve. // ux-vaelger
    pub color: Option<String>,
    pub phone: Option<String>,
    pub notes: Option<String>,
    /// `None` = uændrede domæner ved rettelse (ingen ved oprettelse).
    pub domains: Option<Vec<String>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectStatus {
    Active,
    Paused,
    Completed,
    Archived,
}

impl ProjectStatus {
    pub fn label(self) -> &'static str {
        match self {
            ProjectStatus::Active => "Aktiv",
            ProjectStatus::Paused => "På pause",
            ProjectStatus::Completed => "Afsluttet",
            ProjectStatus::Archived => "Arkiveret",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Project {
    pub id: Id,
    pub customer_id: Id,
    pub name: String,
    pub status: ProjectStatus,
    /// Timepris i øre. `None` = kundens sats.
    pub hourly_rate: Option<i64>,
    /// Budget i minutter.
    pub budget_minutes: Option<u32>,
    /// Regler fra web (`urlPatterns`), som detektionen matcher på.
    pub url_patterns: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProjectInput {
    pub customer_id: Id,
    pub name: String,
    pub hourly_rate: Option<i64>,
    pub budget_minutes: Option<u32>,
}

// ---------- Tidsregistreringer ----------

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub id: Id,
    pub customer_id: Id,
    pub project_id: Option<Id>,
    pub task_id: Option<Id>,
    pub description: String,
    pub date: NaiveDate,
    /// Poster uden tidspunkt har `None` (registreret som "1,5 t").
    pub start: Option<NaiveTime>,
    pub end: Option<NaiveTime>,
    pub minutes: u32,
    pub billable: bool,
    /// Fakturanummer, hvis posten er faktureret.
    pub invoice_id: Option<Id>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EntryInput {
    pub customer_id: Id,
    pub project_id: Option<Id>,
    pub task_id: Option<Id>,
    pub description: String,
    pub date: NaiveDate,
    pub start: Option<NaiveTime>,
    pub end: Option<NaiveTime>,
    pub minutes: u32,
    pub billable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DateRange {
    pub from: NaiveDate,
    /// Inklusiv.
    pub to: NaiveDate,
}

impl DateRange {
    pub fn day(d: NaiveDate) -> Self {
        DateRange { from: d, to: d }
    }

    pub fn contains(&self, d: NaiveDate) -> bool {
        d >= self.from && d <= self.to
    }
}

// ---------- Klippekort ----------

#[derive(Clone, Debug, PartialEq)]
pub struct PunchCard {
    pub id: Id,
    pub customer_id: Id,
    pub name: String,
    pub total_minutes: u32,
    pub used_minutes: u32,
    pub purchased: NaiveDate,
    pub expires: Option<NaiveDate>,
    /// Pris i øre for hele kortet.
    pub price: i64,
}

impl PunchCard {
    pub fn remaining_minutes(&self) -> i64 {
        self.total_minutes as i64 - self.used_minutes as i64
    }

    /// Overløb = brugt mere end kortet rummer.
    pub fn overflow_minutes(&self) -> u32 {
        self.used_minutes.saturating_sub(self.total_minutes)
    }

    pub fn is_active(&self, today: NaiveDate) -> bool {
        self.remaining_minutes() > 0 && self.expires.is_none_or(|e| e >= today)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PunchCardInput {
    pub customer_id: Id,
    pub name: String,
    pub total_minutes: u32,
    pub price: i64,
    pub expires: Option<NaiveDate>,
}

// ---------- Opgaver ----------

/// Opgavens status. Rækkefølgen er boardets kolonner (web: Backlog, Todo,
/// I gang, Afsluttet).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TaskStatus {
    Backlog,
    Todo,
    InProgress,
    Done,
}

impl TaskStatus {
    pub const ALL: [TaskStatus; 4] = [
        TaskStatus::Backlog,
        TaskStatus::Todo,
        TaskStatus::InProgress,
        TaskStatus::Done,
    ];

    pub fn label(self) -> &'static str {
        match self {
            TaskStatus::Backlog => "Backlog",
            TaskStatus::Todo => "Ikke startet",
            TaskStatus::InProgress => "I gang",
            TaskStatus::Done => "Færdig",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Task {
    pub id: Id,
    pub project_id: Id,
    pub title: String,
    pub status: TaskStatus,
    pub due: Option<NaiveDate>,
    /// Registreret tid på opgaven i minutter.
    pub logged_minutes: u32,
    pub estimate_minutes: Option<u32>,
    pub priority: Option<TaskPriority>,
    pub description: Option<String>,
    /// Kunden direkte på opgaven (web: `clientId`), også uden projekt.
    pub customer_id: Option<Id>,
    /// Kolonnen på tavlen (web: `statusId`). Kan pege på en kolonne, der
    /// ikke længere passer med `status` (se `opgaver::logic::resolve_lane`).
    pub status_id: Option<Id>,
}

/// Den faste kategori bag en kolonne på tavlen (web's `LaneCategory`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum LaneCategory {
    NotStarted,
    InProgress,
    Done,
    Cancelled,
}

impl LaneCategory {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "not_started" => Some(LaneCategory::NotStarted),
            "in_progress" => Some(LaneCategory::InProgress),
            "done" => Some(LaneCategory::Done),
            "cancelled" => Some(LaneCategory::Cancelled),
            _ => None,
        }
    }
}

/// En kolonne på tavlen (web's egne statusser) i tavlens rækkefølge.
#[derive(Clone, Debug, PartialEq)]
pub struct TaskLane {
    pub id: Id,
    pub name: String,
    /// `0xRRGGBB`, eller `None` uden gyldig farve.
    pub color: Option<u32>,
    pub category: LaneCategory,
}

/// Prioritet som i web (`low`, `medium`, `high`, `urgent`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TaskPriority {
    Low,
    Medium,
    High,
    Urgent,
}

impl TaskPriority {
    pub const ALL: [TaskPriority; 4] = [
        TaskPriority::Low,
        TaskPriority::Medium,
        TaskPriority::High,
        TaskPriority::Urgent,
    ];

    /// Web's værdi.
    pub fn as_str(self) -> &'static str {
        match self {
            TaskPriority::Low => "low",
            TaskPriority::Medium => "medium",
            TaskPriority::High => "high",
            TaskPriority::Urgent => "urgent",
        }
    }

    /// Ukendt eller manglende værdi = ingen prioritet.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "low" => Some(TaskPriority::Low),
            "medium" => Some(TaskPriority::Medium),
            "high" => Some(TaskPriority::High),
            "urgent" => Some(TaskPriority::Urgent),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TaskInput {
    pub project_id: Id,
    pub title: String,
    pub due: Option<NaiveDate>,
    pub estimate_minutes: Option<u32>,
    /// `None` = ny opgave får Todo; en rettelse beholder status.
    pub status: Option<TaskStatus>,
    /// `None` = ingen prioritet ved oprettelse, uændret ved rettelse.
    pub priority: Option<TaskPriority>,
    /// `None` = uændret ved rettelse.
    pub description: Option<String>,
    /// Kunden, når opgaven ikke har et projekt (ellers følger kunden
    /// projektet).
    pub customer_id: Option<Id>,
}

// ---------- Fakturaer ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InvoiceStatus {
    Draft,
    Sent,
    Paid,
    Overdue,
}

impl InvoiceStatus {
    pub fn label(self) -> &'static str {
        match self {
            InvoiceStatus::Draft => "Kladde",
            InvoiceStatus::Sent => "Sendt",
            InvoiceStatus::Paid => "Betalt",
            InvoiceStatus::Overdue => "Forfalden",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct InvoiceLine {
    pub description: String,
    pub minutes: u32,
    /// Pris pr. time i øre.
    pub rate: i64,
    pub entry_ids: Vec<Id>,
}

impl InvoiceLine {
    /// Linjebeløb i øre, afrundet til nærmeste øre.
    pub fn amount(&self) -> i64 {
        (self.rate * self.minutes as i64 + 30) / 60
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Invoice {
    pub id: Id,
    /// `None` for kladder; nummer tildeles ved afsendelse.
    pub number: Option<u32>,
    pub customer_id: Id,
    pub status: InvoiceStatus,
    pub issued: NaiveDate,
    pub due: NaiveDate,
    pub lines: Vec<InvoiceLine>,
    /// `false`, når listen er hentet uden linjer (cloud: kun hvis web's
    /// `linesByInvoice` fejlede). Linjerne hentes med `Backend::invoice`,
    /// når fakturaen åbnes, og indtil da bruges `subtotal_hint`.
    pub lines_loaded: bool,
    /// Beløb ekskl. moms i øre fra listen (web's `amount`).
    pub subtotal_hint: i64,
    /// Momssats i promille (250 = 25 %).
    pub vat_permille: u32,
    /// Nummeret som tekst ("2026-7", "INV-001"), når det har et præfiks.
    /// `number` er kun det afsluttende tal. // gendan
    pub number_text: Option<String>,
    /// Overskrift (kun lokal tilstand; web har ingen titel). // gendan
    pub title: Option<String>,
    pub notes: Option<String>,
}

impl Invoice {
    pub fn subtotal(&self) -> i64 {
        // Uden linjer (listen fra en server uden linesByInvoice, eller en
        // ældre cloud-kladde fra før web lavede linjer) er web's beløb det
        // rigtige.
        if !self.lines_loaded || self.lines.is_empty() {
            return self.subtotal_hint;
        }
        self.lines.iter().map(InvoiceLine::amount).sum()
    }

    pub fn vat(&self) -> i64 {
        (self.subtotal() * self.vat_permille as i64 + 500) / 1000
    }

    pub fn total(&self) -> i64 {
        self.subtotal() + self.vat()
    }

    /// Nummeret, som kunden ser det: med præfiks, hvis der er et.
    pub fn number_label(&self) -> Option<String> {
        self.number_text
            .clone()
            .or_else(|| self.number.map(|n| n.to_string()))
    }
}

/// Det, der kan rettes på en faktura ud over linjerne. // gendan
#[derive(Clone, Debug, PartialEq)]
pub struct InvoiceDetails {
    pub title: Option<String>,
    pub due: NaiveDate,
    pub notes: Option<String>,
}

/// Afsender, betaling og nummerering på lokale fakturaer (tt-data). // gendan
pub use tt_data::InvoiceProfile;

// ---------- Rapporter ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReportGrouping {
    Customer,
    Project,
    Day,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReportRow {
    pub key: Id,
    pub label: String,
    pub minutes: u32,
    pub billable_minutes: u32,
    /// Beløb i øre efter timepris-hierarkiet.
    pub amount: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub range: DateRange,
    pub grouping: ReportGrouping,
    pub rows: Vec<ReportRow>,
}

impl Report {
    pub fn total_minutes(&self) -> u32 {
        self.rows.iter().map(|r| r.minutes).sum()
    }
}

// ---------- Fælles timer ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimerStatus {
    Idle,
    Running,
    Paused,
}

/// Den fælles timer (web `timerStates`). `version` stiger ved hver ændring,
/// så en ændring fra web kan genkendes og konflikter opdages.
#[derive(Clone, Debug, PartialEq)]
pub struct TimerState {
    pub status: TimerStatus,
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    pub task_id: Option<Id>,
    pub description: String,
    /// Sidste start/genoptagelse.
    pub started_at: Option<DateTime<Local>>,
    /// Sekunder fra tidligere kørsler før seneste pause.
    pub accumulated_secs: u64,
    pub version: u64,
}

impl TimerState {
    pub fn idle() -> Self {
        TimerState {
            status: TimerStatus::Idle,
            customer_id: None,
            project_id: None,
            task_id: None,
            description: String::new(),
            started_at: None,
            accumulated_secs: 0,
            version: 0,
        }
    }

    pub fn elapsed_secs(&self, now: DateTime<Local>) -> u64 {
        let running = match (self.status, self.started_at) {
            (TimerStatus::Running, Some(s)) => (now - s).num_seconds().max(0) as u64,
            _ => 0,
        };
        self.accumulated_secs + running
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TimerTarget {
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    pub task_id: Option<Id>,
    pub description: String,
}

// ---------- Forslag ----------

/// En blok af aktivitet, som detektionen mener hører til en kunde/projekt.
/// Kun forslaget når UI'et; rå aktivitet bliver i detektionslaget (D3).
#[derive(Clone, Debug, PartialEq)]
pub struct Suggestion {
    pub id: Id,
    pub date: NaiveDate,
    pub start: NaiveTime,
    pub end: NaiveTime,
    /// None = intern tid (projekt uden kunde) eller en uklar blok. Web
    /// tillader tid uden kunde.
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    /// Kort, menneskelig begrundelse ("VS Code: bageriet-webshop").
    pub reason: String,
    /// 0.0-1.0.
    pub confidence: f32,
    /// Opgave fundet i git-grenen eller et commit (`feat/TT-123-login`).
    pub task_id: Option<Id>,
    /// Opgavens titel, til visning.
    pub task_title: Option<String>,
}

impl Suggestion {
    pub fn minutes(&self) -> u32 {
        ((self.end - self.start).num_minutes()).max(0) as u32
    }
}

/// Rettelse ved "Ret": det brugeren valgte i stedet. Detektionen lærer af den.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SuggestionCorrection {
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    /// Målet er valgt i den fælles mål-vælger: projektet gælder, som det er,
    /// også "Uden projekt" på samme kunde (ellers beholdes forslagets). // ux-vaelger
    pub target_explicit: bool,
    pub description: Option<String>,
    pub start: Option<NaiveTime>,
    pub end: Option<NaiveTime>,
}

// ---------- Traitet ----------

pub trait Backend: Send + Sync {
    fn mode(&self) -> Mode;
    /// Dags dato set fra datalaget (mock kan fastlåse den i tests).
    fn today(&self) -> NaiveDate;

    // Kunder
    fn customers(&self, include_archived: bool) -> Result<Vec<Customer>>;
    fn create_customer(&self, input: CustomerInput) -> Result<Customer>;
    fn update_customer(&self, id: &str, input: CustomerInput) -> Result<Customer>;
    fn set_customer_archived(&self, id: &str, archived: bool) -> Result<()>;

    // Projekter
    fn projects(&self, customer_id: Option<&str>, include_archived: bool) -> Result<Vec<Project>>;
    fn create_project(&self, input: ProjectInput) -> Result<Project>;
    fn update_project(&self, id: &str, input: ProjectInput) -> Result<Project>;
    fn set_project_status(&self, id: &str, status: ProjectStatus) -> Result<()>;

    // Poster
    fn entries(&self, range: DateRange) -> Result<Vec<Entry>>;
    /// Gemmer en ny post. Klippekort-træk sker i datalaget (tt-core).
    fn create_entry(&self, input: EntryInput) -> Result<Entry>;
    fn update_entry(&self, id: &str, input: EntryInput) -> Result<Entry>;
    fn delete_entry(&self, id: &str) -> Result<()>;

    // Klippekort
    fn punch_cards(&self, customer_id: Option<&str>) -> Result<Vec<PunchCard>>;
    fn create_punch_card(&self, input: PunchCardInput) -> Result<PunchCard>;
    /// Retter navn, kunde, timer, pris og udløb. Brugt tid røres ikke; færre
    /// timer end det brugte afvises.
    fn update_punch_card(&self, id: &str, input: PunchCardInput) -> Result<PunchCard>;
    /// Fylder minutter på kortet (prisen stiger med kortets timepris).
    fn top_up_punch_card(&self, id: &str, minutes: u32) -> Result<PunchCard>;

    // Opgaver
    fn tasks(&self, project_id: Option<&str>) -> Result<Vec<Task>>;
    fn create_task(&self, input: TaskInput) -> Result<Task>;
    /// Retter titel, projekt, frist og estimat (hele formularen).
    fn update_task(&self, id: &str, input: TaskInput) -> Result<Task>;
    fn set_task_status(&self, id: &str, status: TaskStatus) -> Result<()>;
    /// Tavlens kolonner i rækkefølge (egne statusser fra web; lokalt de fire
    /// faste). Huskes offline.
    fn task_lanes(&self) -> Result<Vec<TaskLane>>;
    /// Flytter opgaven til kolonnen (web's `tasks.move`; venter i køen
    /// offline).
    fn move_task(&self, id: &str, lane_id: &str) -> Result<()>;

    // Fakturaer
    fn invoices(&self) -> Result<Vec<Invoice>>;
    /// Én faktura med linjer.
    fn invoice(&self, id: &str) -> Result<Invoice> {
        self.invoices()?
            .into_iter()
            .find(|i| i.id == id)
            .ok_or_else(|| BackendError::NotFound("Fakturaen".into()))
    }
    /// Ufakturerede, fakturerbare poster for en kunde.
    fn uninvoiced_entries(&self, customer_id: &str) -> Result<Vec<Entry>>;
    fn create_invoice_draft(&self, customer_id: &str, entry_ids: &[Id]) -> Result<Invoice>;
    fn update_invoice_lines(&self, id: &str, lines: Vec<InvoiceLine>) -> Result<Invoice>;
    /// Tildeler nummer og sender (i cloud via web's integrationer).
    fn send_invoice(&self, id: &str) -> Result<Invoice>;
    fn mark_invoice_paid(&self, id: &str) -> Result<()>;

    // Rapporter
    fn report(&self, range: DateRange, grouping: ReportGrouping) -> Result<Report>;

    // Fælles timer
    fn timer(&self) -> Result<TimerState>;
    fn timer_start(&self, target: TimerTarget) -> Result<TimerState>;
    fn timer_pause(&self) -> Result<TimerState>;
    fn timer_resume(&self) -> Result<TimerState>;
    /// Ændrer kunde/projekt/beskrivelse på en kørende timer.
    fn timer_set_target(&self, target: TimerTarget) -> Result<TimerState>;
    /// Stopper og gemmer som post. `None` hvis tiden var under ét minut.
    fn timer_stop(&self) -> Result<Option<Entry>>;
    /// Kasserer uden at gemme.
    fn timer_discard(&self) -> Result<()>;

    // Forslag
    fn suggestions(&self, date: NaiveDate) -> Result<Vec<Suggestion>>;
    fn confirm_suggestion(
        &self,
        id: &str,
        correction: Option<SuggestionCorrection>,
    ) -> Result<Entry>;
    fn reject_suggestion(&self, id: &str) -> Result<()>;
    /// Bekræfter alle åbne forslag for dagen.
    fn confirm_day(&self, date: NaiveDate) -> Result<Vec<Entry>>;

    // Observatøren: "Lær TimeTrack at kende" (se `observer.rs`).

    /// Kortet på I dag: hvor meget der er observeret og det næste spørgsmål.
    fn observer_card(&self) -> Result<ObserverCard> {
        Ok(ObserverCard::default())
    }
    /// Alle grupper (også dem, detektionen allerede kender), største først.
    /// Til Aktivitet-skærmen.
    fn observer_groups(&self) -> Result<Vec<ObserverGroup>> {
        Ok(vec![])
    }
    /// Svar på et spørgsmål. Mønstrene gælder straks, også bagud.
    fn answer_observer(&self, group_id: &str, reply: ObserverReply) -> Result<()> {
        let _ = (group_id, reply);
        Ok(())
    }
    /// Indstillinger → Sporing → "Eksportér anonymiseret testsæt": de
    /// seneste 30 dages aktivitet med posterne som facit, anonymiseret
    /// (tt-matcher `anonymize`), som JSON-fil i `dir`. Returnerer filen.
    fn export_test_set(&self, dir: &std::path::Path) -> Result<std::path::PathBuf> {
        let _ = dir;
        Err(BackendError::Validation("Sporing er ikke tilgængelig".into()))
    }

    // screens-a: klippekort ved oprettelse, forbrugshistorik og kundekort.

    /// Opretter en post og trækker fra det valgte klippekort. Standarden
    /// ignorerer valget og lader datalaget vælge (tt-core trækker selv).
    fn create_entry_with_card(&self, input: EntryInput, card: CardChoice) -> Result<Entry> {
        let _ = card;
        self.create_entry(input)
    }

    /// Klippekortets forbrug, nyeste først.
    fn punch_card_usage(&self, card_id: &str) -> Result<Vec<PunchUsage>> {
        let _ = card_id;
        Ok(vec![])
    }

    /// Kundens seneste poster (højst `limit`), nyeste først. Standarden
    /// læser det seneste år via `entries`.
    fn recent_entries(&self, customer_id: &str, limit: usize) -> Result<Vec<Entry>> {
        let to = self.today();
        let from = to - chrono::Days::new(365);
        let mut v: Vec<Entry> = self
            .entries(DateRange { from, to })?
            .into_iter()
            .filter(|e| e.customer_id == customer_id)
            .collect();
        v.sort_by_key(|e| std::cmp::Reverse((e.date, e.start)));
        v.truncate(limit);
        Ok(v)
    }

    // screens-b: konto, indstillinger, AI, login, tilladelser og import.
    // Typerne ligger i `screens_b.rs`.
    fn account(&self) -> Result<Account>;
    fn logout(&self) -> Result<()>;
    fn settings(&self) -> Result<Settings>;
    /// Validerer (`validate_settings`) og gemmer. Returnerer det gemte.
    fn save_settings(&self, settings: Settings) -> Result<Settings>;
    fn ai_models(&self) -> Result<Vec<LocalModel>>;
    /// Hvorfor den valgte AI ikke virker lige nu (dansk), ellers `None`.
    fn ai_problem(&self) -> Option<String> {
        None
    }
    /// Henter modellen (fra Hugging Face). Blokerer, til den er hentet.
    fn download_model(&self, id: &str) -> Result<()>;
    /// Fremskridt for en igangværende hentning, ellers `None`.
    fn model_progress(&self, _id: &str) -> Option<ModelProgress> {
        None
    }
    /// Annullerer en igangværende hentning. `download_model` slutter inden for
    /// få sekunder og efterlader ingen halv fil.
    fn cancel_model_download(&self, _id: &str) {}
    fn delete_model(&self, id: &str) -> Result<()>;
    /// Spørger localhost på standardportene (Ollama, LM Studio, Jan, llamafile).
    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>>;
    /// Modeller, andre programmer har hentet, fra den gemte søgning. Hurtig:
    /// læser kun en fil. Er søgningen over en uge gammel, startes en ny i baggrunden.
    fn found_models(&self) -> Result<FoundModels> {
        Ok(FoundModels::default())
    }
    /// Søger efter modeller på disken igen ("Søg igen"). Blokerer, til søgningen
    /// er færdig (højst ca. ti sekunder); kør den på en baggrundstråd.
    fn rescan_models(&self) -> Result<FoundModels> {
        self.found_models()
    }
    /// Starter Ollama-serveren, hvis programmet er installeret. Kun på brugerens eget valg.
    fn start_ollama(&self) -> Result<()> {
        Err(BackendError::Validation("Ollama kan ikke startes her".into()))
    }
    /// Gemmer nøglen i systemets nøglering. Den kan ikke læses tilbage.
    fn set_cloud_ai_key(&self, provider: CloudAiProvider, key: String) -> Result<()>;
    fn remove_cloud_ai_key(&self, provider: CloudAiProvider) -> Result<()>;
    /// Starter browser-login. UI'et åbner `url` og venter på deep linket.
    fn begin_login(&self) -> Result<LoginStart>;
    /// Bytter `code` fra deep linket til token. UI'et har tjekket `state`.
    fn complete_login(&self, code: &str) -> Result<Account>;
    /// Aktiverer en livstidslicens. Signaturen tjekkes i datalaget.
    fn activate_license(&self, key: &str) -> Result<License>;
    fn start_trial(&self) -> Result<License>;
    fn permissions(&self) -> Result<Permissions>;
    /// Beder OS'et om tilladelsen (åbner Systemindstillinger på macOS).
    fn request_permission(&self, permission: Permission) -> Result<PermissionState>;
    /// Lokal → cloud. `dry_run` ændrer intet og giver kun rapporten.
    fn import_local_to_cloud(&self, dry_run: bool) -> Result<ImportReport>;

    // ---- licens og adgang
    /// Hvad appen må lige nu (licens eller plan). Læser kun lokale filer.
    fn access(&self) -> licens::Access {
        licens::Access::Full
    }
    /// Som `access`, men spørger først web om planen (cloud) og husker svaret
    /// med tidsstempel. Kaldes jævnligt af baggrundsopgaven, aldrig fra UI-tråden.
    fn refresh_access(&self) -> licens::Access {
        self.access()
    }

    // ---- gendan: tabte 0.2-funktioner

    /// Fakturaopsætningen (lokal tilstand). `None` i cloud, hvor den står i web.
    fn invoice_profile(&self) -> Result<Option<InvoiceProfile>> {
        Ok(None)
    }
    fn save_invoice_profile(&self, profile: InvoiceProfile) -> Result<InvoiceProfile> {
        let _ = profile;
        Err(BackendError::Validation("Fakturaopsætningen står i web".into()))
    }
    /// Ret titel, forfald og noter. Cloud: forfald og noter (web har ingen titel).
    fn update_invoice_details(&self, id: &str, details: InvoiceDetails) -> Result<Invoice> {
        let _ = (id, details);
        Err(BackendError::Validation("Kan ikke rettes her".into()))
    }
    /// Slet en kladde; posterne bliver ufaktureret igen.
    fn delete_invoice_draft(&self, id: &str) -> Result<()> {
        let _ = id;
        Err(BackendError::Validation("Kladden kan slettes i web".into()))
    }

    /// Arkiverede klippekort (vises under "Arkiverede").
    fn archived_punch_cards(&self) -> Result<Vec<PunchCard>> {
        Ok(vec![])
    }
    /// Arkivér eller hent et klippekort frem (archive over delete).
    fn set_punch_card_archived(&self, id: &str, archived: bool) -> Result<()> {
        let _ = (id, archived);
        Err(BackendError::Validation("Kan ikke arkiveres her".into()))
    }
    /// Slet et klippekort, der aldrig er brugt. Brugte kort arkiveres.
    fn delete_punch_card(&self, id: &str) -> Result<()> {
        let _ = id;
        Err(BackendError::Validation("Kortet kan ikke slettes her".into()))
    }

    /// Backup af lokale data og indstillinger til én fil i `dir` (lokal tilstand).
    fn export_backup(&self, dir: &std::path::Path) -> Result<std::path::PathBuf> {
        let _ = dir;
        Err(BackendError::Validation("Backup findes kun i lokal tilstand".into()))
    }
    /// Læs og valider en backup uden at ændre noget.
    fn inspect_backup(&self, path: &std::path::Path) -> Result<BackupSummary> {
        let _ = path;
        Err(BackendError::Validation("Backup findes kun i lokal tilstand".into()))
    }
    /// Erstat alle lokale data med backuppen. Tager først en sikkerhedskopi.
    fn restore_backup(&self, path: &std::path::Path) -> Result<RestoreResult> {
        let _ = path;
        Err(BackendError::Validation("Backup findes kun i lokal tilstand".into()))
    }
    // ---- afviste registreringer (offline-køens dead-letter; lokal: ingen)
    /// Antal ændringer, web afviste fra offline-køen. Læser kun lokalt.
    fn rejected_count(&self) -> usize {
        0
    }
    /// De afviste, ældste først.
    fn rejected(&self) -> Result<Vec<Rejected>> {
        Ok(Vec::new())
    }
    /// Send én (`Some(id)`) eller alle igen med samme nøgler (ingen dubletter).
    fn retry_rejected(&self, _id: Option<&str>) -> Result<RetryResult> {
        Ok(RetryResult::default())
    }
    /// Kassér én for altid (det eneste, der sletter en afvist).
    fn discard_rejected(&self, id: &str) -> Result<()> {
        Err(BackendError::NotFound(format!("Registreringen {id}")))
    }
    /// CSV i samme format som `ikke-synkroniseret-fra-0.2.csv`.
    fn rejected_csv(&self) -> Result<String> {
        Ok(tt_data::unsynced_csv::write(&[]))
    }
    // ---- idle-fradrag (0.2.24)
    /// "Træk fra" på idle-spørgsmålet: stopper timeren og gemmer posten
    /// kortet med `subtract_minutes` i ét skridt. Gælder som et stop, så det
    /// virker også, når appen er låst, og der er intet vindue, hvor stoppet
    /// er sket, men kortningen fejler. Med `restart` startes timeren igen på
    /// det mål bagefter; det er den samme timer, der kører videre, så låsen
    /// gælder heller ikke den.
    fn timer_subtract_idle(
        &self,
        subtract_minutes: u32,
        restart: Option<TimerTarget>,
    ) -> Result<IdleSubtraction>;

    // ---- aktivitet (0.2.25)
    /// Dagens rå aktivitet som blokke med status. Bliver på maskinen (D3).
    fn activity_day(&self, date: NaiveDate) -> Result<ActivityDay> {
        Ok(ActivityDay::empty(date, date))
    }
    /// Opretter registreringer for blokkene og lærer (med `remember`).
    fn assign_activity(&self, _date: NaiveDate, _input: AssignActivity) -> Result<AssignResult> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    fn activity_not_work(&self, _date: NaiveDate, _block_ids: &[Id]) -> Result<()> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    /// Fletter blokkene (og det imellem dem) til én.
    fn merge_activity(&self, _date: NaiveDate, _block_ids: &[Id]) -> Result<()> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    /// Deler blokken i to ved `at`.
    fn split_activity(&self, _date: NaiveDate, _block_id: &str, _at: NaiveTime) -> Result<()> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    /// Sletter aktiviteten i blokkene for altid.
    fn delete_activity(&self, _date: NaiveDate, _block_ids: &[Id]) -> Result<()> {
        Err(BackendError::Validation("Aktivitet er ikke tilgængelig".into()))
    }
    /// Indstillinger → Sporing → "Slet al aktivitet".
    fn delete_all_activity(&self) -> Result<()> {
        Ok(())
    }
    fn activity_storage(&self) -> Result<ActivityStorage> {
        Ok(ActivityStorage::default())
    }
    /// Udelukkelsesregler i aktivitets-DB'en (flyttet fra 0.2), så de kan ses
    /// og fjernes under Sporing.
    fn stored_exclusions(&self) -> Result<Vec<StoredExclusion>> {
        Ok(vec![])
    }
    fn remove_stored_exclusion(&self, _id: i64) -> Result<()> {
        Ok(())
    }
    /// "Luk dagen": ubekræftede forslag, uklar tid og poster uden projekt.
    fn close_day(&self, date: NaiveDate) -> Result<CloseDay> {
        let suggestions = self.suggestions(date)?;
        let day = self.activity_day(date)?;
        let (unclear_blocks, unclear_seconds) = day.total(ActivityStatus::Unclear);
        let without_project = self
            .entries(DateRange::day(date))?
            .into_iter()
            .filter(|e| e.project_id.is_none())
            .collect();
        // Spørgsmålet er en hjælp; fejler kortet, lukkes dagen uden.
        let question = self.observer_card().ok().and_then(|c| c.question);
        Ok(CloseDay {
            suggestions,
            unclear_blocks,
            unclear_seconds,
            without_project,
            question,
        })
    }

    // ---- ux-vaelger: "Altid sådan" og regeloversigten (backend/regler.rs)

    /// Mulige omfang for en regel ud fra de valgte blokke, med antal blokke
    /// i dag og de sidste 14 dage, der matcher.
    fn rule_scopes(&self, _date: NaiveDate, _block_ids: &[Id]) -> Result<Vec<RuleScope>> {
        Ok(vec![])
    }

    /// Opret reglen "omfang → mål". `customer_id: None` = intern tid.
    fn create_rule(&self, _scope: &RuleScope, _customer_id: Option<Id>, _project_id: Option<Id>) -> Result<Id> {
        Err(BackendError::Validation("Regler kræver sporingen".into()))
    }

    /// Registrér de blokke de sidste 14 dage, der matcher omfanget, og som
    /// ikke allerede er registreret eller afgjort.
    fn apply_rule_backward(
        &self,
        _scope: &RuleScope,
        _customer_id: Option<Id>,
        _project_id: Option<Id>,
    ) -> Result<BackwardResult> {
        Ok(BackwardResult::default())
    }

    /// Regler og lærte mønstre med antal træffere.
    fn rule_rows(&self) -> Result<Vec<RuleRow>> {
        Ok(vec![])
    }

    fn set_rule_target(&self, _row: &RuleRow, _customer_id: Option<Id>, _project_id: Option<Id>) -> Result<()> {
        Err(BackendError::Validation("Regler kræver sporingen".into()))
    }

    fn set_rule_active(&self, _row: &RuleRow, _active: bool) -> Result<()> {
        Err(BackendError::Validation("Regler kræver sporingen".into()))
    }

    fn delete_rule_row(&self, _row: &RuleRow) -> Result<()> {
        Err(BackendError::Validation("Regler kræver sporingen".into()))
    }
}

// ux-vaelger: regler og omfang.
pub mod regler;
pub use regler::{BackwardResult, RuleOrigin, RuleRow, RuleRowKind, RuleScope, ScopeKind};

/// Resultatet af [`Backend::timer_subtract_idle`].
#[derive(Clone, Debug, PartialEq)]
pub struct IdleSubtraction {
    /// Posten, stoppet gemte (kortet). `None`, hvis fradraget åd hele tiden.
    pub entry: Option<Entry>,
    /// Timeren kunne ikke startes igen (stop og kortning er sket).
    pub restart_error: Option<String>,
}


/// Indholdet af en backup (vises før gendannelse). // gendan
#[derive(Clone, Debug, PartialEq)]
pub struct BackupSummary {
    pub created: Option<DateTime<Local>>,
    pub customers: u32,
    pub projects: u32,
    pub entries: u32,
    pub invoices: u32,
    pub punch_cards: u32,
    /// Indstillingerne er med.
    pub has_settings: bool,
}

/// Resultatet af en gendannelse. // gendan
#[derive(Clone, Debug, PartialEq)]
pub struct RestoreResult {
    pub summary: BackupSummary,
    /// Sikkerhedskopien af data fra før gendannelsen.
    pub safety_copy: std::path::PathBuf,
}

// ---------- screens-a ----------

/// Hvilket klippekort en ny post trækker fra.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum CardChoice {
    /// Datalaget vælger (det ældste aktive kort på kunden).
    #[default]
    Auto,
    /// Træk ikke fra noget kort.
    None,
    Card(Id),
}

/// Én linje i et klippekorts forbrugshistorik.
#[derive(Clone, Debug, PartialEq)]
pub struct PunchUsage {
    /// `None` for forbrug fra før historikken (fx importeret saldo).
    pub entry_id: Option<Id>,
    pub date: NaiveDate,
    pub minutes: u32,
    pub description: String,
}

// screens-b
pub mod screens_b;
pub use screens_b::*;

// Afviste registreringer (offline-køens dead-letter).
pub mod afviste;
pub use afviste::*;

// Aktivitet: rå aktivitet som blokke (0.2.25).
pub mod aktivitet;
pub use aktivitet::*;
