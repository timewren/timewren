//! `Repository`: den ene grænseflade, UI'et kender (spec A1). `CloudRepo`
//! og `LocalRepo` implementerer den. Async via `async-trait`, så den kan
//! bruges som `Arc<dyn Repository>` og afventes fra GPUI's executor; intet
//! kræver tokio.

use async_trait::async_trait;
use chrono::NaiveDate;

use crate::error::Result;
use crate::events::Events;
use crate::model::*;

#[async_trait]
pub trait Repository: Send + Sync {
    // ------------------------------------------------------------ auth/enhed
    fn mode(&self) -> Mode;
    /// Hændelseskanalen (timer ændret, data ændret, logget ud, offline/online).
    fn events(&self) -> Events;
    async fn session(&self) -> Result<Session>;
    async fn organizations(&self) -> Result<Vec<Organization>>;
    /// Skift org. Cachen ryddes, og alt hentes igen.
    async fn select_organization(&self, organization_id: &str) -> Result<()>;
    /// Hvad brugeren må (plan og grænser). Lokal tilstand: alt.
    async fn entitlements(&self) -> Result<Entitlements>;
    async fn logout(&self) -> Result<()>;

    // ------------------------------------------------------------ kunder
    async fn list_clients(&self, include_archived: bool) -> Result<Vec<Client>>;
    async fn get_client(&self, id: &str) -> Result<Client>;
    async fn create_client(&self, input: NewClient) -> Result<Client>;
    async fn update_client(&self, id: &str, patch: ClientPatch) -> Result<Client>;
    async fn archive_client(&self, id: &str) -> Result<()>;
    async fn unarchive_client(&self, id: &str) -> Result<()>;

    // ------------------------------------------------------------ projekter
    /// Inkl. arkiverede, hvis `include_archived` (filtrér på `status`).
    async fn list_projects(&self, include_archived: bool) -> Result<Vec<Project>>;
    async fn get_project(&self, id: &str) -> Result<Project>;
    async fn create_project(&self, input: NewProject) -> Result<Project>;
    async fn update_project(&self, id: &str, patch: ProjectPatch) -> Result<Project>;
    async fn set_project_status(&self, id: &str, status: ProjectStatus) -> Result<()>;
    async fn archive_project(&self, id: &str) -> Result<()> {
        self.set_project_status(id, ProjectStatus::Archived).await
    }

    // ------------------------------------------------------------ klippekort
    /// Klippekort; `client_id` filtrerer, `include_inactive` tager brugte og
    /// arkiverede med.
    async fn list_klippekort(
        &self,
        client_id: Option<&str>,
        include_inactive: bool,
    ) -> Result<Vec<PrepaidPackage>>;
    async fn create_klippekort(&self, input: NewPrepaidPackage) -> Result<PrepaidPackage>;
    /// Ret kortet. Saldoen beregnes af datalaget (web: `klippekort.update`).
    async fn update_klippekort(&self, id: &str, patch: PrepaidPackagePatch) -> Result<PrepaidPackage>;
    /// Fyld timer på kortet (web: `klippekort.topUp`). Et inaktivt kort
    /// bliver aktivt igen.
    async fn top_up_klippekort(&self, id: &str, hours: rust_decimal::Decimal, note: Option<String>) -> Result<PrepaidPackage>;
    async fn archive_klippekort(&self, id: &str) -> Result<()>;
    /// Kortets forbrugshistorik fra serveren, nyeste først. Lokal tilstand
    /// har ingen (`Unsupported`): UI'et udleder den af posterne.
    async fn klippekort_usage(&self, id: &str) -> Result<Vec<PrepaidUsage>> {
        let _ = id;
        Err(crate::error::DataError::Unsupported("forbrugshistorik fra serveren".into()))
    }

    // ------------------------------------------------------------ tidsposter
    async fn list_entries(&self, filter: EntryFilter) -> Result<Vec<TimeEntry>>;
    async fn entries_for_day(&self, date: NaiveDate) -> Result<Vec<TimeEntry>> {
        self.list_entries(EntryFilter::day(date)).await
    }
    /// Mandag-søndag for ugen, `date` ligger i.
    async fn entries_for_week(&self, date: NaiveDate) -> Result<Vec<TimeEntry>> {
        self.list_entries(EntryFilter::week_of(date)).await
    }
    /// Poster uden tidspunkt på dagen (vises over kalenderen).
    async fn untimed_entries(&self, date: NaiveDate) -> Result<Vec<TimeEntry>> {
        self.list_entries(EntryFilter { untimed: Some(true), ..EntryFilter::day(date) }).await
    }
    async fn get_entry(&self, id: &str) -> Result<TimeEntry>;
    /// Idempotent med `client_entry_id` (sættes, hvis den mangler).
    async fn create_entry(&self, input: NewTimeEntry) -> Result<CreatedEntry>;
    async fn update_entry(&self, id: &str, patch: TimeEntryPatch) -> Result<TimeEntry>;
    async fn delete_entry(&self, id: &str) -> Result<()>;

    // ------------------------------------------------------------ timer
    async fn timer(&self) -> Result<TimerState>;
    /// Start en frisk timer. Afvises, hvis en timer allerede kører.
    async fn timer_start(&self, input: StartTimer) -> Result<TimerState>;
    async fn timer_pause(&self) -> Result<TimerState>;
    async fn timer_resume(&self) -> Result<TimerState>;
    /// Skift kunde, projekt, opgave og beskrivelse på den aktive timer
    /// (kørende eller pauset). Tiden røres ikke. Web: metadata-skrivning med
    /// `updateTimerState` (uden `isRunning`) på samme session.
    async fn timer_set_target(&self, target: StartTimer) -> Result<TimerState>;
    /// Stop (claimForStop → gem post → confirmStop).
    async fn timer_stop(&self, input: StopTimer) -> Result<StopOutcome>;
    /// Stop den aktive og start en ny med det samme.
    async fn timer_switch(&self, input: StartTimer) -> Result<StopOutcome> {
        let stopped = self.timer_stop(StopTimer::default()).await?;
        let timer = self.timer_start(input).await?;
        Ok(StopOutcome { entry: stopped.entry, timer })
    }
    /// Klippekort-valg for den kørende timer; `None` = automatisk.
    async fn set_prepaid_choice(&self, choice: Option<PrepaidChoice>) -> Result<()>;

    // ------------------------------------------------------------ opgaver
    async fn list_tasks(&self, filter: TaskFilter) -> Result<Vec<Task>>;
    async fn create_task(&self, input: NewTask) -> Result<Task>;
    async fn update_task(&self, id: &str, patch: TaskPatch) -> Result<Task>;
    async fn set_task_status(&self, id: &str, status: TaskStatus) -> Result<()>;
    /// Tavlens kolonner i rækkefølge (web's egne statusser). Lokal tilstand
    /// har de fire faste.
    async fn list_task_lanes(&self) -> Result<Vec<TaskLane>> {
        Ok(TaskLane::defaults())
    }
    /// Flyt en opgave til en kolonne. Lokalt er kolonnens id den gamle
    /// status (`TaskLane::defaults`).
    async fn move_task(&self, input: MoveTask) -> Result<()> {
        self.set_task_status(&input.task_id, TaskStatus::parse(&input.status_id)).await
    }
    /// Registrér tid på en opgave (idempotent med `client_entry_id`).
    async fn log_task_time(&self, task_id: &str, input: NewTimeEntry) -> Result<CreatedEntry> {
        self.create_entry(NewTimeEntry { task_id: Some(task_id.to_owned()), ..input }).await
    }

    // ------------------------------------------------------------ fakturaer
    async fn list_invoices(&self) -> Result<Vec<Invoice>>;
    async fn get_invoice(&self, id: &str) -> Result<Invoice>;
    async fn uninvoiced_summary(&self) -> Result<Vec<UninvoicedSummary>>;
    async fn uninvoiced_entries(&self, client_id: &str) -> Result<Vec<TimeEntry>>;
    /// Kladde fra ufaktureret tid. Posterne markeres som faktureret.
    async fn create_invoice_draft(&self, input: NewInvoiceDraft) -> Result<Invoice>;
    async fn invoice_lines(&self, invoice_id: &str) -> Result<Vec<InvoiceLine>>;
    /// Linjer for mange fakturaer (web: `invoices.linesByInvoice`, ét kald pr.
    /// 500). Fakturaer, der ikke findes, er ikke med i svaret.
    async fn invoice_lines_many(&self, ids: Vec<Id>) -> Result<std::collections::HashMap<Id, Vec<InvoiceLine>>> {
        let mut out = std::collections::HashMap::new();
        for id in ids {
            match self.invoice_lines(&id).await {
                Ok(lines) => {
                    out.insert(id, lines);
                }
                Err(crate::error::DataError::NotFound) => {}
                Err(e) => return Err(e),
            }
        }
        Ok(out)
    }
    /// Gem alle linjer på én gang (kun kladder).
    async fn save_invoice_lines(&self, invoice_id: &str, lines: Vec<InvoiceLine>) -> Result<()>;
    /// Udsted og send. Lokalt: udsted (nummer, status "sent") uden mail.
    async fn send_invoice(&self, id: &str) -> Result<Invoice>;
    async fn mark_invoice_paid(&self, id: &str, paid_date: Option<NaiveDate>) -> Result<Invoice>;

    // ------------------------------------------------------------ rapporter
    async fn report(&self, query: ReportQuery) -> Result<Report>;

    // ------------------------------------------------------------ regler
    /// Matching-regler: projekters URL-mønstre + brugerens og lærte regler.
    async fn matching_rules(&self) -> Result<Vec<MatchingRule>>;
    /// Opret eller ret en regel (bruger/lært). Projekt-mønstre rettes via
    /// `update_project(url_patterns)`.
    async fn upsert_rule(&self, rule: MatchingRule) -> Result<MatchingRule>;
    async fn delete_rule(&self, id: &str) -> Result<()>;

    /// Site-koblinger (domæne → projekt/kunde). Web: `siteMappings.list`.
    /// Lokalt: domæne-reglerne med et mål.
    async fn site_mappings(&self) -> Result<Vec<SiteMapping>> {
        Ok(self
            .matching_rules()
            .await?
            .into_iter()
            .filter(|r| {
                r.kind == RuleKind::Domain
                    && r.source != RuleSource::Project
                    && !r.not_work
                    && (r.project_id.is_some() || r.client_id.is_some())
            })
            .map(|r| SiteMapping {
                domain: r.pattern,
                project_id: r.project_id,
                client_id: r.client_id,
                usage_count: r.confirmations,
                last_used: r.updated_at,
            })
            .collect())
    }

    /// Lærte mønstre fra serveren; med `since` kun de ændrede. Lokal
    /// tilstand har dem i detektionens egen fil (`Unsupported`).
    async fn learned_patterns(&self, since: Option<chrono::DateTime<chrono::Utc>>) -> Result<LearnedPatterns> {
        let _ = since;
        Err(crate::error::DataError::Unsupported("lærte mønstre på serveren".into()))
    }

    /// Gem mønstre på serveren (erstatter pr. nøgle; flet før, se
    /// tt-matchers `PatternStore::merge`). Returnerer antal gemte.
    async fn upsert_learned_patterns(&self, patterns: Vec<LearnedPatternRecord>) -> Result<usize> {
        let _ = patterns;
        Err(crate::error::DataError::Unsupported("lærte mønstre på serveren".into()))
    }
}
