//! `MockBackend`: opdigtede danske data i hukommelsen, så hver skærm kan
//! bygges og testes uden server. Opfører sig som et rigtigt datalag
//! (klippekort-træk, fælles timer med version, forslag der forsvinder ved
//! bekræftelse), men uden persistens.

use std::sync::Mutex;

use chrono::{Days, Local, NaiveDate, NaiveTime, Timelike};

use super::*;

pub struct MockBackend {
    state: Mutex<State>,
    today: NaiveDate,
    /// Tests kan slå fejl til for at se fejltilstande.
    fail: Mutex<Option<BackendError>>,
    // screens-b
    b: MockB,
    // Afviste registreringer (dead-letter), se `afviste.rs`.
    pub(super) afviste: Mutex<MockRejected>,
    // gendan: lokal tilstand i demoen og fakturaopsætningen.
    gendan: Mutex<MockGendan>,
    // aktivitet: demodagens blokke.
    aktivitet: Mutex<aktivitet::MockActivity>,
    // Observatøren: "Lær TimeTrack at kende".
    observer: Mutex<super::observer::MockObserver>,
    // ux-vaelger: regler og mønstre.
    regler: Mutex<Vec<RuleRow>>,
}

// ux-vaelger: regler og omfang i demoen.
#[path = "mock_regler.rs"]
mod regler;

// Aktivitet i demoen (0.2.25).
#[path = "mock_aktivitet.rs"]
mod aktivitet;

#[derive(Default)]
struct MockGendan {
    local: bool,
    profile: InvoiceProfile,
    /// Arkiverede klippekort (flyttet ud af `State::punch_cards`).
    archived_cards: Vec<PunchCard>,
}

struct State {
    next_id: u64,
    customers: Vec<Customer>,
    projects: Vec<Project>,
    entries: Vec<Entry>,
    punch_cards: Vec<PunchCard>,
    tasks: Vec<Task>,
    invoices: Vec<Invoice>,
    suggestions: Vec<Suggestion>,
    timer: TimerState,
    next_invoice_number: u32,
    // screens-a: (kort-id, forbrug) i oprettelsesrækkefølge.
    card_usage: Vec<(Id, PunchUsage)>,
    /// Tavlens kolonner (web's egne statusser), i rækkefølge.
    lanes: Vec<TaskLane>,
}

/// Kunden på en ny eller rettet opgave: projektets, ellers den valgte (web
/// tillader en opgave med kunde uden projekt).
fn task_customer(s: &State, input: &TaskInput) -> Result<Option<Id>> {
    if input.project_id.is_empty() {
        return match &input.customer_id {
            Some(c) if !s.customers.iter().any(|x| &x.id == c) => {
                Err(BackendError::NotFound("Kunden".into()))
            }
            c => Ok(c.clone()),
        };
    }
    s.projects
        .iter()
        .find(|p| p.id == input.project_id)
        .map(|p| Some(p.customer_id.clone()))
        .ok_or(BackendError::NotFound("Projektet".into()))
}

/// Web's standardkolonner med id'er som fra serveren (ikke statusserne).
fn default_lanes() -> Vec<TaskLane> {
    [
        ("kol_backlog", "Backlog", 0x9CA3AF, LaneCategory::NotStarted),
        ("kol_todo", "Todo", 0x3B82F6, LaneCategory::NotStarted),
        ("kol_i_gang", "I gang", 0xF59E0B, LaneCategory::InProgress),
        ("kol_afsluttet", "Afsluttet", 0x10B981, LaneCategory::Done),
    ]
    .into_iter()
    .map(|(id, name, color, category)| TaskLane {
        id: id.into(),
        name: name.into(),
        color: Some(color),
        category,
    })
    .collect()
}

fn t(h: u32, m: u32) -> NaiveTime {
    NaiveTime::from_hms_opt(h, m, 0).expect("gyldigt tidspunkt")
}

const DEFAULT_RATE: i64 = 85_000; // 850 kr/t

/// Indholdet af en demo-backup (gendan).
const MOCK_BACKUP: &str = "TT-MOCK-BACKUP";

impl MockBackend {
    /// Data omkring dags dato.
    pub fn demo() -> Self {
        Self::with_today(Local::now().date_naive())
    }

    /// Deterministiske data omkring en fast dato (til tests og skærmbilleder).
    pub fn with_today(today: NaiveDate) -> Self {
        MockBackend {
            state: Mutex::new(State::seed(today)),
            today,
            fail: Mutex::new(None),
            b: MockB::new(true),
            afviste: Mutex::new(MockRejected::default()),
            gendan: Mutex::default(),
            aktivitet: Mutex::default(),
            observer: Mutex::default(),
            regler: Mutex::new(regler::demo_rows()),
        }
    }

    /// Tom database (til tomme tilstande).
    pub fn empty(today: NaiveDate) -> Self {
        let state = State {
            next_id: 1,
            customers: vec![],
            projects: vec![],
            entries: vec![],
            punch_cards: vec![],
            tasks: vec![],
            invoices: vec![],
            suggestions: vec![],
            timer: TimerState::idle(),
            next_invoice_number: 1001,
            card_usage: vec![],
            lanes: default_lanes(),
        };
        MockBackend {
            state: Mutex::new(state),
            today,
            fail: Mutex::new(None),
            b: MockB::new(true),
            afviste: Mutex::new(MockRejected::default()),
            gendan: Mutex::default(),
            aktivitet: Mutex::new(aktivitet::MockActivity {
                blocks: Some(vec![]),
                exclusions: Some(vec![]),
            }),
            observer: Mutex::default(),
            regler: Mutex::default(),
        }
    }

    /// Demo og tests: en kørende timer, der har kørt `elapsed_secs`.
    pub fn demo_timer(&self, target: TimerTarget, elapsed_secs: i64) {
        let mut s = self.state.lock().expect("mock-lås");
        let v = s.timer.version + 1;
        s.timer = TimerState {
            status: TimerStatus::Running,
            customer_id: target.customer_id,
            project_id: target.project_id,
            task_id: target.task_id,
            description: target.description,
            started_at: Some(Local::now() - chrono::Duration::seconds(elapsed_secs)),
            accumulated_secs: 0,
            version: v,
        };
    }

    /// Tavlens kolonner "fra web" (tests).
    pub fn set_task_lanes(&self, lanes: Vec<TaskLane>) {
        self.state.lock().expect("mock-lås").lanes = lanes;
    }

    /// Demo (`TT_DEMO=opg-kolonner…`): egne kolonner som Milles tavle, en
    /// opgave med kunde uden projekt og en helt uden.
    pub fn demo_custom_lanes(&self) {
        let lane = |id: &str, name: &str, color: u32, category| TaskLane {
            id: id.into(),
            name: name.into(),
            color: Some(color),
            category,
        };
        let mut s = self.state.lock().expect("mock-lås");
        s.lanes = vec![
            lane("kol_ideer", "Idéer", 0x9CA3AF, LaneCategory::NotStarted),
            lane("kol_todo", "Todo", 0x3B82F6, LaneCategory::NotStarted),
            lane("kol_i_gang", "I gang", 0xF59E0B, LaneCategory::InProgress),
            lane("kol_venter", "Venter på kunde", 0x8B5CF6, LaneCategory::InProgress),
            lane("kol_afsluttet", "Afsluttet", 0x10B981, LaneCategory::Done),
            lane("kol_annulleret", "Annulleret", 0xEF4444, LaneCategory::Cancelled),
        ];
        let today = self.today;
        if let Some(t) = s.tasks.iter_mut().find(|t| t.id == "opg_5") {
            t.status_id = Some("kol_venter".into());
        }
        s.tasks.push(Task {
            id: "opg_10".into(),
            project_id: String::new(),
            title: "Visitkort til nye ansatte".into(),
            status: TaskStatus::Todo,
            due: Some(today + Days::new(4)),
            logged_minutes: 30,
            estimate_minutes: Some(120),
            priority: Some(TaskPriority::High),
            description: Some("Tre nye navne, samme layout som sidst.".into()),
            customer_id: Some("kunde_klinik".into()),
            status_id: Some("kol_todo".into()),
        });
        s.tasks.push(Task {
            id: "opg_11".into(),
            project_id: String::new(),
            title: "Opdatér egne priser".into(),
            status: TaskStatus::Backlog,
            due: None,
            logged_minutes: 0,
            estimate_minutes: None,
            priority: None,
            description: None,
            customer_id: None,
            status_id: Some("kol_ideer".into()),
        });
    }

    /// Alle kald fejler med `err`, til `None` sættes igen.
    pub fn set_failure(&self, err: Option<BackendError>) {
        *self.fail.lock().expect("mock-lås") = err;
    }

    /// Demo i lokal tilstand (`TT_DEMO=lokal`) med en udfyldt fakturaopsætning.
    pub fn set_local(&self, local: bool) {
        let mut g = self.gendan.lock().expect("mock-lås");
        g.local = local;
        if local && g.profile == InvoiceProfile::default() {
            g.profile = InvoiceProfile {
                company_name: "Acme".into(),
                cvr: "39413892".into(),
                address: "Demovej 1\n8000 Aarhus C".into(),
                email: "faktura@example.dk".into(),
                bank_reg: "1234".into(),
                bank_account: "12345678".into(),
                mobilepay: "12345".into(),
                number_prefix: "2026-".into(),
                next_number: 42,
                ..InvoiceProfile::default()
            };
        }
    }

    fn is_local(&self) -> bool {
        self.gendan.lock().expect("mock-lås").local
    }

    fn with<T>(&self, f: impl FnOnce(&mut State) -> Result<T>) -> Result<T> {
        if let Some(e) = self.fail.lock().expect("mock-lås").clone() {
            return Err(e);
        }
        f(&mut self.state.lock().expect("mock-lås"))
    }
}

impl State {
    fn id(&mut self, prefix: &str) -> Id {
        self.next_id += 1;
        format!("{prefix}_{}", self.next_id)
    }

    fn seed(today: NaiveDate) -> State {
        let mut s = State {
            next_id: 100,
            customers: vec![],
            projects: vec![],
            entries: vec![],
            punch_cards: vec![],
            tasks: vec![],
            invoices: vec![],
            suggestions: vec![],
            timer: TimerState::idle(),
            next_invoice_number: 1042,
            card_usage: vec![],
            lanes: default_lanes(),
        };
        let customers: [(&str, &str, Option<i64>, bool); 8] = [
            ("kunde_bageriet", "Bageriet på Hjørnet", Some(75_000), false),
            ("kunde_klinik", "Klinik Søndergade", None, false),
            (
                "kunde_gartneriet",
                "Gartneriet Nørrebro",
                Some(90_000),
                false,
            ),
            ("kunde_toemrer", "Tømrer Østergaard ApS", None, false),
            ("kunde_cafe", "Café Åbrinken", Some(70_000), false),
            (
                "kunde_advokat",
                "Advokatfirmaet Holm & Bæk",
                Some(120_000),
                false,
            ),
            ("kunde_yoga", "Yogahuset Vesterbro", None, false),
            ("kunde_gammel", "Frisør Ærø (gammel kunde)", None, true),
        ];
        // Farver fra web på de fleste; resten får web's udledte farve.
        let extra = |id: &str| -> (Option<&str>, &[&str]) {
            match id {
                "kunde_bageriet" => (Some("#f59e0b"), &["bageriet.dk"]),
                "kunde_klinik" => (Some("#3b82f6"), &["kliniksondergade.dk"]),
                "kunde_gartneriet" => (Some("#10b981"), &["gartneriet-nb.dk"]),
                "kunde_cafe" => (Some("#ec4899"), &[]),
                "kunde_advokat" => (Some("#8b5cf6"), &["holm-baek.dk"]),
                _ => (None, &[]),
            }
        };
        for (id, name, rate, archived) in customers {
            let (color, domains) = extra(id);
            s.customers.push(Customer {
                id: id.into(),
                name: name.into(),
                email: None,
                hourly_rate: rate,
                archived,
                cvr: None,
                color: color.map(str::to_string),
                domains: domains.iter().map(|d| d.to_string()).collect(),
                ..Customer::default()
            });
        }
        type ProjectSeed<'a> = (
            &'a str,
            &'a str,
            &'a str,
            ProjectStatus,
            Option<u32>,
            &'a [&'a str],
        );
        let projects: [ProjectSeed; 12] = [
            (
                "proj_webshop",
                "kunde_bageriet",
                "Ny webshop",
                ProjectStatus::Active,
                Some(40 * 60),
                &["bageriet-webshop", "*.bageriet.dk"],
            ),
            (
                "proj_bageri_drift",
                "kunde_bageriet",
                "Drift og support",
                ProjectStatus::Active,
                None,
                &[],
            ),
            (
                "proj_booking",
                "kunde_klinik",
                "Booking-modul",
                ProjectStatus::Active,
                Some(25 * 60),
                &["klinik-booking"],
            ),
            (
                "proj_klinik_seo",
                "kunde_klinik",
                "SEO-løft",
                ProjectStatus::Paused,
                None,
                &[],
            ),
            (
                "proj_redesign",
                "kunde_gartneriet",
                "Redesign",
                ProjectStatus::Active,
                Some(60 * 60),
                &["gartneriet.dk"],
            ),
            (
                "proj_nyhedsbrev",
                "kunde_gartneriet",
                "Nyhedsbrev",
                ProjectStatus::Active,
                None,
                &[],
            ),
            (
                "proj_tilbud",
                "kunde_toemrer",
                "Tilbudsberegner",
                ProjectStatus::Active,
                Some(30 * 60),
                &[],
            ),
            (
                "proj_menukort",
                "kunde_cafe",
                "Digitalt menukort",
                ProjectStatus::Completed,
                None,
                &[],
            ),
            (
                "proj_cafe_drift",
                "kunde_cafe",
                "Drift og support",
                ProjectStatus::Active,
                None,
                &[],
            ),
            (
                "proj_intranet",
                "kunde_advokat",
                "Intranet",
                ProjectStatus::Active,
                Some(120 * 60),
                &["holm-baek-intranet"],
            ),
            (
                "proj_yoga_app",
                "kunde_yoga",
                "Holdbooking-app",
                ProjectStatus::Active,
                None,
                &[],
            ),
            (
                "proj_frisoer",
                "kunde_gammel",
                "Hjemmeside",
                ProjectStatus::Archived,
                None,
                &[],
            ),
        ];
        for (id, customer, name, status, budget, patterns) in projects {
            s.projects.push(Project {
                id: id.into(),
                customer_id: customer.into(),
                name: name.into(),
                status,
                hourly_rate: None,
                budget_minutes: budget,
                url_patterns: patterns.iter().map(|p| p.to_string()).collect(),
            });
        }

        let ago = |n: u64| today.checked_sub_days(Days::new(n)).expect("dato");
        s.punch_cards = vec![
            PunchCard {
                id: "kort_bageriet".into(),
                customer_id: "kunde_bageriet".into(),
                name: "20 timer, efterår".into(),
                total_minutes: 20 * 60,
                used_minutes: 13 * 60,
                purchased: ago(60),
                expires: Some(today + Days::new(120)),
                price: 1_400_000,
            },
            PunchCard {
                id: "kort_cafe".into(),
                customer_id: "kunde_cafe".into(),
                name: "10 timer".into(),
                total_minutes: 10 * 60,
                used_minutes: 10 * 60 + 90,
                purchased: ago(200),
                expires: None,
                price: 650_000,
            },
            PunchCard {
                id: "kort_yoga".into(),
                customer_id: "kunde_yoga".into(),
                name: "5 timer, opstart".into(),
                total_minutes: 5 * 60,
                used_minutes: 60,
                purchased: ago(10),
                expires: Some(today + Days::new(80)),
                price: 400_000,
            },
        ];

        // I dag: to poster med tidspunkt og én uden.
        let add = |s: &mut State,
                   date,
                   c: &str,
                   p: Option<&str>,
                   desc: &str,
                   span: Option<(NaiveTime, NaiveTime)>,
                   minutes: u32,
                   inv: Option<&str>| {
            let id = s.id("post");
            let minutes = span
                .map(|(a, b)| (b - a).num_minutes() as u32)
                .unwrap_or(minutes);
            s.entries.push(Entry {
                id,
                customer_id: c.into(),
                project_id: p.map(Into::into),
                task_id: None,
                description: desc.into(),
                date,
                start: span.map(|x| x.0),
                end: span.map(|x| x.1),
                minutes,
                billable: true,
                invoice_id: inv.map(Into::into),
            });
        };
        add(
            &mut s,
            today,
            "kunde_klinik",
            Some("proj_booking"),
            "Møde om booking-flow",
            Some((t(8, 30), t(9, 0))),
            0,
            None,
        );
        add(
            &mut s,
            today,
            "kunde_advokat",
            Some("proj_intranet"),
            "Rettigheder og roller",
            Some((t(11, 15), t(12, 30))),
            0,
            None,
        );
        add(
            &mut s,
            today,
            "kunde_gartneriet",
            Some("proj_nyhedsbrev"),
            "Telefonsupport",
            None,
            45,
            None,
        );
        // De seneste 30 dage: et par poster om dagen på hverdage.
        let rotation = [
            ("kunde_bageriet", "proj_webshop", "Produktsider og kurv"),
            ("kunde_klinik", "proj_booking", "Kalenderintegration"),
            ("kunde_gartneriet", "proj_redesign", "Forside og navigation"),
            ("kunde_toemrer", "proj_tilbud", "Prisformler"),
            ("kunde_advokat", "proj_intranet", "Dokumentarkiv"),
            (
                "kunde_cafe",
                "proj_cafe_drift",
                "Opdatering af åbningstider",
            ),
            ("kunde_yoga", "proj_yoga_app", "Holdoversigt"),
        ];
        for n in 1..=30u64 {
            let d = ago(n);
            use chrono::Datelike;
            if d.weekday().number_from_monday() > 5 {
                continue;
            }
            let a = rotation[(n as usize * 3) % rotation.len()];
            let b = rotation[(n as usize * 5 + 1) % rotation.len()];
            let invoiced = if n > 20 { Some("faktura_1041") } else { None };
            add(
                &mut s,
                d,
                a.0,
                Some(a.1),
                a.2,
                Some((t(9, 0), t(11, 30 - (n as u32 % 3) * 15))),
                0,
                invoiced,
            );
            add(
                &mut s,
                d,
                b.0,
                Some(b.1),
                b.2,
                Some((t(12, 30), t(15, (n as u32 % 4) * 15))),
                0,
                invoiced,
            );
        }

        // Poster på de projekter, der har en åben opgave, hører til opgaven
        // (kalenderens opgavemarkering).
        for e in s.entries.iter_mut() {
            e.task_id = match e.project_id.as_deref() {
                Some("proj_webshop") => Some("opg_1".into()),
                Some("proj_booking") => Some("opg_3".into()),
                Some("proj_intranet") => Some("opg_5".into()),
                Some("proj_redesign") => Some("opg_4".into()),
                Some("proj_tilbud") => Some("opg_8".into()),
                _ => None,
            };
        }

        s.tasks = vec![
            Task {
                id: "opg_1".into(),
                project_id: "proj_webshop".into(),
                title: "Kurv og betaling med MobilePay".into(),
                status: TaskStatus::InProgress,
                due: Some(today + Days::new(3)),
                logged_minutes: 340,
                estimate_minutes: Some(600),
                priority: Some(TaskPriority::High),
                description: Some("Kurven skal gemmes mellem besøg, og betalingen går via MobilePay Checkout.".into()),
                customer_id: None,
                status_id: None,
            },
            Task {
                id: "opg_2".into(),
                project_id: "proj_webshop".into(),
                title: "Produktbilleder i høj opløsning".into(),
                status: TaskStatus::Todo,
                due: Some(today + Days::new(10)),
                logged_minutes: 0,
                estimate_minutes: Some(120),
                priority: Some(TaskPriority::Medium),
                description: None,
                customer_id: None,
                status_id: None,
            },
            Task {
                id: "opg_3".into(),
                project_id: "proj_booking".into(),
                title: "Påmindelser på sms".into(),
                status: TaskStatus::Todo,
                due: Some(ago(1)),
                logged_minutes: 45,
                estimate_minutes: Some(240),
                priority: Some(TaskPriority::Urgent),
                description: Some("Klinikken vil have en sms 24 timer før tiden.".into()),
                customer_id: None,
                status_id: None,
            },
            Task {
                id: "opg_4".into(),
                project_id: "proj_redesign".into(),
                title: "Ny forside til sæsonen".into(),
                status: TaskStatus::Done,
                due: None,
                logged_minutes: 510,
                estimate_minutes: Some(480),
                priority: Some(TaskPriority::Low),
                description: None,
                customer_id: None,
                status_id: None,
            },
            Task {
                id: "opg_5".into(),
                project_id: "proj_intranet".into(),
                title: "Login med MitID Erhverv".into(),
                status: TaskStatus::InProgress,
                due: Some(today + Days::new(14)),
                logged_minutes: 900,
                estimate_minutes: None,
                priority: Some(TaskPriority::High),
                description: None,
                customer_id: None,
                status_id: None,
            },
            Task {
                id: "opg_6".into(),
                project_id: "proj_nyhedsbrev".into(),
                title: "Skabelon til forårsnyhedsbrev".into(),
                status: TaskStatus::Backlog,
                due: None,
                logged_minutes: 0,
                estimate_minutes: Some(180),
                priority: None,
                description: None,
                customer_id: None,
                status_id: None,
            },
            Task {
                id: "opg_7".into(),
                project_id: "proj_menukort".into(),
                title: "Allergenmærker på menukortet".into(),
                status: TaskStatus::Backlog,
                due: Some(today + Days::new(30)),
                logged_minutes: 0,
                estimate_minutes: Some(90),
                priority: Some(TaskPriority::Low),
                description: Some("Alle 14 allergener som ikoner, så menukortet kan printes.".into()),
                customer_id: None,
                status_id: None,
            },
            Task {
                id: "opg_8".into(),
                project_id: "proj_tilbud".into(),
                title: "Tilbudsformular med billedupload".into(),
                status: TaskStatus::Todo,
                due: Some(today + Days::new(6)),
                logged_minutes: 60,
                estimate_minutes: Some(300),
                priority: Some(TaskPriority::Medium),
                description: None,
                customer_id: None,
                status_id: None,
            },
            Task {
                id: "opg_9".into(),
                project_id: "proj_klinik_seo".into(),
                title: "Lokale søgeord for Søndergade".into(),
                status: TaskStatus::Done,
                due: Some(ago(5)),
                logged_minutes: 150,
                estimate_minutes: Some(120),
                priority: Some(TaskPriority::Medium),
                description: None,
                customer_id: None,
                status_id: None,
            },
        ];

        s.invoices = vec![
            Invoice {
                id: "faktura_1041".into(),
                number: Some(1041),
                customer_id: "kunde_advokat".into(),
                status: InvoiceStatus::Paid,
                issued: ago(9),
                due: ago(1),
                lines: vec![InvoiceLine {
                    description: "Intranet, september".into(),
                    minutes: 32 * 60 + 30,
                    rate: 120_000,
                    entry_ids: vec![],
                }],
                lines_loaded: true,
                subtotal_hint: 0,
                vat_permille: 250,
                number_text: None,
                title: None,
                notes: None,
            },
            Invoice {
                id: "faktura_1040".into(),
                number: Some(1040),
                customer_id: "kunde_gartneriet".into(),
                status: InvoiceStatus::Overdue,
                issued: ago(40),
                due: ago(10),
                lines: vec![
                    InvoiceLine {
                        description: "Redesign, fase 1".into(),
                        minutes: 18 * 60,
                        rate: 90_000,
                        entry_ids: vec![],
                    },
                    InvoiceLine {
                        description: "Nyhedsbrev, opsætning".into(),
                        minutes: 4 * 60 + 15,
                        rate: 90_000,
                        entry_ids: vec![],
                    },
                ],
                lines_loaded: true,
                subtotal_hint: 0,
                vat_permille: 250,
                number_text: None,
                title: None,
                notes: None,
            },
            Invoice {
                id: "faktura_1039".into(),
                number: Some(1039),
                customer_id: "kunde_toemrer".into(),
                status: InvoiceStatus::Sent,
                issued: ago(5),
                due: today + Days::new(9),
                lines: vec![InvoiceLine {
                    description: "Tilbudsberegner".into(),
                    minutes: 12 * 60,
                    rate: DEFAULT_RATE,
                    entry_ids: vec![],
                }],
                lines_loaded: true,
                subtotal_hint: 0,
                vat_permille: 250,
                number_text: None,
                title: None,
                notes: None,
            },
        ];

        s.suggestions = vec![
            Suggestion {
                id: "forslag_1".into(),
                date: today,
                start: t(9, 0),
                end: t(11, 0),
                customer_id: Some("kunde_bageriet".into()),
                project_id: Some("proj_webshop".into()),
                reason: "VS Code og Figma: bageriet-webshop".into(),
                confidence: 0.92,
                // observer: opgaven fra git-grenen (feat/kurv-mobilepay).
                task_id: Some("opg_1".into()),
                task_title: Some("Kurv og betaling med MobilePay".into()),
            },
            Suggestion {
                id: "forslag_2".into(),
                date: today,
                start: t(13, 30),
                end: t(14, 15),
                customer_id: Some("kunde_klinik".into()),
                project_id: Some("proj_booking".into()),
                reason: "Mail-tråd: Booking-modul, spørgsmål".into(),
                confidence: 0.71,
                task_id: None,
                task_title: None,
            },
            Suggestion {
                id: "forslag_3".into(),
                date: today,
                start: t(15, 0),
                end: t(16, 15),
                customer_id: Some("kunde_gartneriet".into()),
                project_id: Some("proj_redesign".into()),
                reason: "Google Docs: Redesign, feedback".into(),
                confidence: 0.58,
                task_id: None,
                task_title: None,
            },
        ];
        s
    }

    fn rate_for(&self, customer_id: &str, project_id: Option<&str>) -> i64 {
        let project = project_id.and_then(|p| self.projects.iter().find(|x| x.id == p));
        let customer = self.customers.iter().find(|c| c.id == customer_id);
        project
            .and_then(|p| p.hourly_rate)
            .or(customer.and_then(|c| c.hourly_rate))
            .unwrap_or(DEFAULT_RATE)
    }

    fn ensure_customer(&self, id: &str) -> Result<()> {
        if self.customers.iter().any(|c| c.id == id) {
            Ok(())
        } else {
            Err(BackendError::NotFound("Kunden".into()))
        }
    }

    fn insert_entry(&mut self, input: EntryInput, today: NaiveDate) -> Result<Entry> {
        self.insert_entry_with_card(input, today, CardChoice::Auto)
    }

    // screens-a: som `insert_entry`, men med valg af klippekort og forbrugslog.
    fn insert_entry_with_card(
        &mut self,
        input: EntryInput,
        today: NaiveDate,
        card: CardChoice,
    ) -> Result<Entry> {
        validate_entry(&input)?;
        if let CardChoice::Card(id) = &card {
            let ok = self
                .punch_cards
                .iter()
                .any(|c| &c.id == id && c.customer_id == input.customer_id);
            if !ok {
                return Err(BackendError::Validation(
                    "Klippekortet hører ikke til kunden".into(),
                ));
            }
        }
        self.ensure_customer(&input.customer_id)?;
        let id = self.id("post");
        let e = Entry {
            id,
            customer_id: input.customer_id,
            project_id: input.project_id,
            task_id: input.task_id,
            description: input.description,
            date: input.date,
            start: input.start,
            end: input.end,
            minutes: input.minutes,
            billable: input.billable,
            invoice_id: None,
        };
        if let Some(task) = e
            .task_id
            .as_ref()
            .and_then(|tid| self.tasks.iter_mut().find(|x| &x.id == tid))
        {
            task.logged_minutes += e.minutes;
        }
        let card_id = match card {
            CardChoice::Auto => self
                .punch_cards
                .iter()
                .filter(|c| c.customer_id == e.customer_id && c.is_active(today))
                .min_by_key(|c| c.purchased)
                .map(|c| c.id.clone()),
            CardChoice::None => None,
            CardChoice::Card(id) => Some(id),
        };
        if let Some(card) = card_id
            .as_ref()
            .and_then(|id| self.punch_cards.iter_mut().find(|c| &c.id == id))
        {
            card.used_minutes += e.minutes;
            self.card_usage.push((
                card.id.clone(),
                PunchUsage {
                    entry_id: Some(e.id.clone()),
                    date: e.date,
                    minutes: e.minutes,
                    description: e.description.clone(),
                },
            ));
        }
        self.entries.push(e.clone());
        Ok(e)
    }

    fn bump_timer(&mut self) {
        self.timer.version += 1;
    }
}

fn validate_entry(input: &EntryInput) -> Result<()> {
    if input.minutes == 0 {
        return Err(BackendError::Validation(
            "Tiden skal være mindst ét minut".into(),
        ));
    }
    if input.minutes > 24 * 60 {
        return Err(BackendError::Validation(
            "En post kan højst være 24 timer".into(),
        ));
    }
    if let (Some(a), Some(b)) = (input.start, input.end)
        && b <= a
    {
        return Err(BackendError::Validation(
            "Sluttid skal være efter starttid".into(),
        ));
    }
    Ok(())
}

fn not_blank(s: &str, what: &str) -> Result<()> {
    if s.trim().is_empty() {
        Err(BackendError::Validation(format!("{what} mangler")))
    } else {
        Ok(())
    }
}

impl Backend for MockBackend {
    fn mode(&self) -> Mode {
        if self.is_local() {
            return Mode::Local;
        }
        Mode::Cloud {
            organization: "Acme".into(),
        }
    }

    fn today(&self) -> NaiveDate {
        self.today
    }

    fn customers(&self, include_archived: bool) -> Result<Vec<Customer>> {
        self.with(|s| {
            Ok(s.customers
                .iter()
                .filter(|c| include_archived || !c.archived)
                .cloned()
                .collect())
        })
    }

    fn create_customer(&self, input: CustomerInput) -> Result<Customer> {
        self.with(|s| {
            not_blank(&input.name, "Kundens navn")?;
            let c = Customer {
                id: s.id("kunde"),
                name: input.name.trim().into(),
                email: input.email,
                hourly_rate: input.hourly_rate,
                archived: false,
                cvr: input.cvr,
                color: input.color.filter(|x| !x.trim().is_empty()),
                phone: input.phone,
                notes: input.notes,
                domains: input.domains.unwrap_or_default(),
            };
            s.customers.push(c.clone());
            Ok(c)
        })
    }

    fn update_customer(&self, id: &str, input: CustomerInput) -> Result<Customer> {
        self.with(|s| {
            not_blank(&input.name, "Kundens navn")?;
            let c = s
                .customers
                .iter_mut()
                .find(|c| c.id == id)
                .ok_or(BackendError::NotFound("Kunden".into()))?;
            c.name = input.name.trim().into();
            c.email = input.email;
            c.hourly_rate = input.hourly_rate;
            c.cvr = input.cvr;
            let blank = |v: Option<String>| v.filter(|x| !x.trim().is_empty());
            c.color = blank(input.color);
            c.phone = blank(input.phone);
            c.notes = blank(input.notes);
            if let Some(d) = input.domains {
                c.domains = tt_data::normalize_client_domains(&d).map_err(BackendError::Validation)?;
            }
            Ok(c.clone())
        })
    }

    fn set_customer_archived(&self, id: &str, archived: bool) -> Result<()> {
        self.with(|s| {
            let c = s
                .customers
                .iter_mut()
                .find(|c| c.id == id)
                .ok_or(BackendError::NotFound("Kunden".into()))?;
            c.archived = archived;
            Ok(())
        })
    }

    fn projects(&self, customer_id: Option<&str>, include_archived: bool) -> Result<Vec<Project>> {
        self.with(|s| {
            Ok(s.projects
                .iter()
                .filter(|p| customer_id.is_none_or(|c| p.customer_id == c))
                .filter(|p| include_archived || p.status != ProjectStatus::Archived)
                .cloned()
                .collect())
        })
    }

    fn create_project(&self, input: ProjectInput) -> Result<Project> {
        self.with(|s| {
            not_blank(&input.name, "Projektets navn")?;
            s.ensure_customer(&input.customer_id)?;
            let p = Project {
                id: s.id("proj"),
                customer_id: input.customer_id,
                name: input.name.trim().into(),
                status: ProjectStatus::Active,
                hourly_rate: input.hourly_rate,
                budget_minutes: input.budget_minutes,
                url_patterns: vec![],
            };
            s.projects.push(p.clone());
            Ok(p)
        })
    }

    fn update_project(&self, id: &str, input: ProjectInput) -> Result<Project> {
        self.with(|s| {
            not_blank(&input.name, "Projektets navn")?;
            s.ensure_customer(&input.customer_id)?;
            let p = s
                .projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or(BackendError::NotFound("Projektet".into()))?;
            p.customer_id = input.customer_id;
            p.name = input.name.trim().into();
            p.hourly_rate = input.hourly_rate;
            p.budget_minutes = input.budget_minutes;
            Ok(p.clone())
        })
    }

    fn set_project_status(&self, id: &str, status: ProjectStatus) -> Result<()> {
        self.with(|s| {
            let p = s
                .projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or(BackendError::NotFound("Projektet".into()))?;
            p.status = status;
            Ok(())
        })
    }

    fn entries(&self, range: DateRange) -> Result<Vec<Entry>> {
        self.with(|s| {
            let mut v: Vec<Entry> = s
                .entries
                .iter()
                .filter(|e| range.contains(e.date))
                .cloned()
                .collect();
            v.sort_by(|a, b| {
                (a.date, a.start.is_none(), a.start).cmp(&(b.date, b.start.is_none(), b.start))
            });
            Ok(v)
        })
    }

    fn create_entry(&self, input: EntryInput) -> Result<Entry> {
        let today = self.today;
        self.with(|s| s.insert_entry(input, today))
    }

    fn update_entry(&self, id: &str, input: EntryInput) -> Result<Entry> {
        self.with(|s| {
            validate_entry(&input)?;
            s.ensure_customer(&input.customer_id)?;
            let e = s
                .entries
                .iter_mut()
                .find(|e| e.id == id)
                .ok_or(BackendError::NotFound("Posten".into()))?;
            if e.invoice_id.is_some() {
                return Err(BackendError::Validation(
                    "Posten er faktureret og kan ikke ændres".into(),
                ));
            }
            e.customer_id = input.customer_id;
            e.project_id = input.project_id;
            e.task_id = input.task_id;
            e.description = input.description;
            e.date = input.date;
            e.start = input.start;
            e.end = input.end;
            e.minutes = input.minutes;
            e.billable = input.billable;
            Ok(e.clone())
        })
    }

    fn delete_entry(&self, id: &str) -> Result<()> {
        self.with(|s| {
            let ix = s
                .entries
                .iter()
                .position(|e| e.id == id)
                .ok_or(BackendError::NotFound("Posten".into()))?;
            if s.entries[ix].invoice_id.is_some() {
                return Err(BackendError::Validation(
                    "Posten er faktureret og kan ikke slettes".into(),
                ));
            }
            s.entries.remove(ix);
            Ok(())
        })
    }

    fn punch_cards(&self, customer_id: Option<&str>) -> Result<Vec<PunchCard>> {
        self.with(|s| {
            Ok(s.punch_cards
                .iter()
                .filter(|c| customer_id.is_none_or(|id| c.customer_id == id))
                .cloned()
                .collect())
        })
    }

    fn create_punch_card(&self, input: PunchCardInput) -> Result<PunchCard> {
        let today = self.today;
        self.with(|s| {
            not_blank(&input.name, "Kortets navn")?;
            s.ensure_customer(&input.customer_id)?;
            if input.total_minutes == 0 {
                return Err(BackendError::Validation(
                    "Kortet skal have mindst én time".into(),
                ));
            }
            let c = PunchCard {
                id: s.id("kort"),
                customer_id: input.customer_id,
                name: input.name.trim().into(),
                total_minutes: input.total_minutes,
                used_minutes: 0,
                purchased: today,
                expires: input.expires,
                price: input.price,
            };
            s.punch_cards.push(c.clone());
            Ok(c)
        })
    }

    fn update_punch_card(&self, id: &str, input: PunchCardInput) -> Result<PunchCard> {
        self.with(|s| {
            not_blank(&input.name, "Kortets navn")?;
            s.ensure_customer(&input.customer_id)?;
            let c = s
                .punch_cards
                .iter_mut()
                .find(|c| c.id == id)
                .ok_or(BackendError::NotFound("Klippekortet".into()))?;
            if input.total_minutes == 0 || input.total_minutes < c.used_minutes {
                return Err(BackendError::Validation(
                    "Kortet kan ikke have færre timer, end der er brugt".into(),
                ));
            }
            c.customer_id = input.customer_id;
            c.name = input.name.trim().into();
            c.total_minutes = input.total_minutes;
            c.price = input.price;
            c.expires = input.expires;
            Ok(c.clone())
        })
    }

    fn top_up_punch_card(&self, id: &str, minutes: u32) -> Result<PunchCard> {
        self.with(|s| {
            if minutes == 0 {
                return Err(BackendError::Validation("Fyld mindst ét minut på".into()));
            }
            let c = s
                .punch_cards
                .iter_mut()
                .find(|c| c.id == id)
                .ok_or(BackendError::NotFound("Klippekortet".into()))?;
            // Som web: prisen følger kortets timepris.
            let rate = if c.total_minutes == 0 { 0 } else { c.price * 60 / c.total_minutes as i64 };
            c.total_minutes += minutes;
            c.price += rate * minutes as i64 / 60;
            Ok(c.clone())
        })
    }

    fn tasks(&self, project_id: Option<&str>) -> Result<Vec<Task>> {
        self.with(|s| {
            Ok(s.tasks
                .iter()
                .filter(|x| project_id.is_none_or(|p| x.project_id == p))
                .cloned()
                .collect())
        })
    }

    fn create_task(&self, input: TaskInput) -> Result<Task> {
        self.with(|s| {
            not_blank(&input.title, "Opgavens titel")?;
            let customer_id = task_customer(s, &input)?;
            let x = Task {
                id: s.id("opg"),
                project_id: input.project_id,
                title: input.title.trim().into(),
                status: input.status.unwrap_or(TaskStatus::Todo),
                due: input.due,
                logged_minutes: 0,
                estimate_minutes: input.estimate_minutes,
                priority: input.priority,
                description: input.description.filter(|d| !d.trim().is_empty()),
                customer_id,
                status_id: None,
            };
            s.tasks.push(x.clone());
            Ok(x)
        })
    }

    fn update_task(&self, id: &str, input: TaskInput) -> Result<Task> {
        self.with(|s| {
            not_blank(&input.title, "Opgavens titel")?;
            let customer_id = task_customer(s, &input)?;
            let x = s
                .tasks
                .iter_mut()
                .find(|x| x.id == id)
                .ok_or(BackendError::NotFound("Opgaven".into()))?;
            x.project_id = input.project_id;
            x.customer_id = customer_id;
            x.title = input.title.trim().into();
            x.due = input.due;
            x.estimate_minutes = input.estimate_minutes;
            if let Some(st) = input.status {
                x.status = st;
            }
            if input.priority.is_some() {
                x.priority = input.priority;
            }
            if let Some(d) = input.description {
                x.description = Some(d).filter(|d| !d.trim().is_empty());
            }
            Ok(x.clone())
        })
    }

    fn set_task_status(&self, id: &str, status: TaskStatus) -> Result<()> {
        self.with(|s| {
            let x = s
                .tasks
                .iter_mut()
                .find(|x| x.id == id)
                .ok_or(BackendError::NotFound("Opgaven".into()))?;
            x.status = status;
            Ok(())
        })
    }

    fn task_lanes(&self) -> Result<Vec<TaskLane>> {
        self.with(|s| Ok(s.lanes.clone()))
    }

    fn move_task(&self, id: &str, lane_id: &str) -> Result<()> {
        self.with(|s| {
            let lane = s
                .lanes
                .iter()
                .find(|l| l.id == lane_id)
                .cloned()
                .ok_or(BackendError::NotFound("Kolonnen".into()))?;
            let x = s
                .tasks
                .iter_mut()
                .find(|x| x.id == id)
                .ok_or(BackendError::NotFound("Opgaven".into()))?;
            // Som web: kolonnens kategori sætter den gamle status.
            x.status = crate::screens::opgaver::logic::legacy_status_for_lane(&lane, x.status);
            x.status_id = Some(lane.id);
            Ok(())
        })
    }

    fn invoices(&self) -> Result<Vec<Invoice>> {
        self.with(|s| {
            let mut v = s.invoices.clone();
            v.sort_by_key(|i| std::cmp::Reverse(i.issued));
            Ok(v)
        })
    }

    fn uninvoiced_entries(&self, customer_id: &str) -> Result<Vec<Entry>> {
        self.with(|s| {
            Ok(s.entries
                .iter()
                .filter(|e| e.customer_id == customer_id && e.billable && e.invoice_id.is_none())
                .cloned()
                .collect())
        })
    }

    fn create_invoice_draft(&self, customer_id: &str, entry_ids: &[Id]) -> Result<Invoice> {
        let today = self.today;
        self.with(|s| {
            s.ensure_customer(customer_id)?;
            let picked: Vec<Entry> = s
                .entries
                .iter()
                .filter(|e| {
                    entry_ids.contains(&e.id)
                        && e.customer_id == customer_id
                        && e.invoice_id.is_none()
                })
                .cloned()
                .collect();
            if picked.is_empty() {
                return Err(BackendError::Validation(
                    "Vælg mindst én ufaktureret post".into(),
                ));
            }
            // Én linje pr. projekt.
            let mut lines: Vec<InvoiceLine> = vec![];
            for e in &picked {
                let pname = e
                    .project_id
                    .as_ref()
                    .and_then(|p| s.projects.iter().find(|x| &x.id == p))
                    .map(|p| p.name.clone())
                    .unwrap_or_else(|| "Diverse".into());
                let rate = s.rate_for(&e.customer_id, e.project_id.as_deref());
                match lines
                    .iter_mut()
                    .find(|l| l.description == pname && l.rate == rate)
                {
                    Some(l) => {
                        l.minutes += e.minutes;
                        l.entry_ids.push(e.id.clone());
                    }
                    None => lines.push(InvoiceLine {
                        description: pname,
                        minutes: e.minutes,
                        rate,
                        entry_ids: vec![e.id.clone()],
                    }),
                }
            }
            let id = s.id("faktura");
            for e in s
                .entries
                .iter_mut()
                .filter(|e| picked.iter().any(|p| p.id == e.id))
            {
                e.invoice_id = Some(id.clone());
            }
            let inv = Invoice {
                id,
                number: None,
                customer_id: customer_id.into(),
                status: InvoiceStatus::Draft,
                issued: today,
                due: today + Days::new(14),
                lines,
                lines_loaded: true,
                subtotal_hint: 0,
                vat_permille: 250,
                number_text: None,
                title: None,
                notes: None,
            };
            s.invoices.push(inv.clone());
            Ok(inv)
        })
    }

    fn update_invoice_lines(&self, id: &str, lines: Vec<InvoiceLine>) -> Result<Invoice> {
        self.with(|s| {
            let inv = s
                .invoices
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or(BackendError::NotFound("Fakturaen".into()))?;
            if inv.status != InvoiceStatus::Draft {
                return Err(BackendError::Validation("Kun kladder kan rettes".into()));
            }
            inv.lines = lines;
            Ok(inv.clone())
        })
    }

    fn send_invoice(&self, id: &str) -> Result<Invoice> {
        let prefix = if self.is_local() {
            let g = self.gendan.lock().expect("mock-lås");
            let missing = g.profile.missing();
            if !missing.is_empty() {
                return Err(BackendError::Validation(format!(
                    "Udfyld {} under Indstillinger → Faktura, før fakturaen udstedes",
                    missing.join(", ")
                )));
            }
            Some(g.profile.number_prefix.clone())
        } else {
            None
        };
        self.with(|s| {
            let number = s.next_invoice_number;
            let inv = s
                .invoices
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or(BackendError::NotFound("Fakturaen".into()))?;
            if inv.status != InvoiceStatus::Draft {
                return Err(BackendError::Validation(
                    "Fakturaen er allerede sendt".into(),
                ));
            }
            if inv.lines.is_empty() {
                return Err(BackendError::Validation(
                    "Fakturaen har ingen linjer".into(),
                ));
            }
            inv.number = Some(number);
            inv.number_text = prefix.map(|p| format!("{p}{number}"));
            inv.status = InvoiceStatus::Sent;
            let out = inv.clone();
            s.next_invoice_number += 1;
            Ok(out)
        })
    }

    fn mark_invoice_paid(&self, id: &str) -> Result<()> {
        self.with(|s| {
            let inv = s
                .invoices
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or(BackendError::NotFound("Fakturaen".into()))?;
            if inv.status == InvoiceStatus::Draft {
                return Err(BackendError::Validation(
                    "En kladde kan ikke være betalt".into(),
                ));
            }
            inv.status = InvoiceStatus::Paid;
            Ok(())
        })
    }

    // gendan

    fn invoice_profile(&self) -> Result<Option<InvoiceProfile>> {
        let g = self.gendan.lock().expect("mock-lås");
        Ok(g.local.then(|| g.profile.clone()))
    }

    fn save_invoice_profile(&self, profile: InvoiceProfile) -> Result<InvoiceProfile> {
        if !self.is_local() {
            return Err(BackendError::Validation("Fakturaopsætningen står i web".into()));
        }
        profile.validate().map_err(BackendError::Validation)?;
        self.gendan.lock().expect("mock-lås").profile = profile.clone();
        Ok(profile)
    }

    fn update_invoice_details(&self, id: &str, d: InvoiceDetails) -> Result<Invoice> {
        let local = self.is_local();
        self.with(|s| {
            let inv = s
                .invoices
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or(BackendError::NotFound("Fakturaen".into()))?;
            if inv.status == InvoiceStatus::Paid {
                return Err(BackendError::Validation("En betalt faktura kan ikke rettes".into()));
            }
            if d.due < inv.issued {
                return Err(BackendError::Validation(
                    "Forfald kan ikke ligge før fakturadatoen".into(),
                ));
            }
            if local {
                inv.title = d.title.filter(|t| !t.trim().is_empty());
            }
            inv.due = d.due;
            inv.notes = d.notes.filter(|n| !n.trim().is_empty());
            Ok(inv.clone())
        })
    }

    fn archived_punch_cards(&self) -> Result<Vec<PunchCard>> {
        Ok(self.gendan.lock().expect("mock-lås").archived_cards.clone())
    }

    fn set_punch_card_archived(&self, id: &str, archived: bool) -> Result<()> {
        let mut g = self.gendan.lock().expect("mock-lås");
        self.with(|s| {
            if archived {
                let i = s
                    .punch_cards
                    .iter()
                    .position(|k| k.id == id)
                    .ok_or(BackendError::NotFound("Klippekortet".into()))?;
                g.archived_cards.push(s.punch_cards.remove(i));
            } else {
                let i = g
                    .archived_cards
                    .iter()
                    .position(|k| k.id == id)
                    .ok_or(BackendError::NotFound("Klippekortet".into()))?;
                s.punch_cards.push(g.archived_cards.remove(i));
            }
            Ok(())
        })
    }

    fn delete_punch_card(&self, id: &str) -> Result<()> {
        if !self.is_local() {
            return Err(BackendError::Validation(
                "Klippekort slettes ikke, når du er logget ind. Arkivér det i stedet".into(),
            ));
        }
        let mut g = self.gendan.lock().expect("mock-lås");
        let i = g
            .archived_cards
            .iter()
            .position(|k| k.id == id)
            .ok_or(BackendError::NotFound("Klippekortet".into()))?;
        if g.archived_cards[i].used_minutes > 0 {
            return Err(BackendError::Validation("Kortet er brugt og kan ikke slettes. Arkivér det i stedet".into()));
        }
        g.archived_cards.remove(i);
        Ok(())
    }

    fn export_backup(&self, dir: &std::path::Path) -> Result<std::path::PathBuf> {
        if !self.is_local() {
            return Err(BackendError::Validation("Backup findes kun i lokal tilstand".into()));
        }
        std::fs::create_dir_all(dir).map_err(|e| BackendError::Other(e.to_string()))?;
        let path = super::repo::unique_path(dir, &format!("timetrack-backup-{}", self.today), "ttbackup");
        std::fs::write(&path, MOCK_BACKUP).map_err(|e| BackendError::Other(e.to_string()))?;
        Ok(path)
    }

    fn inspect_backup(&self, path: &std::path::Path) -> Result<BackupSummary> {
        let bytes = std::fs::read(path).map_err(|_| BackendError::Validation("Filen findes ikke".into()))?;
        if bytes != MOCK_BACKUP.as_bytes() {
            return Err(BackendError::Validation("Filen er ikke en TimeTrack-backup".into()));
        }
        self.with(|s| {
            Ok(BackupSummary {
                created: self.today.and_hms_opt(9, 30, 0).and_then(|d| d.and_local_timezone(Local).single()),
                customers: s.customers.len() as u32,
                projects: s.projects.len() as u32,
                entries: s.entries.len() as u32,
                invoices: s.invoices.len() as u32,
                punch_cards: s.punch_cards.len() as u32,
                has_settings: true,
            })
        })
    }

    fn restore_backup(&self, path: &std::path::Path) -> Result<RestoreResult> {
        if !self.is_local() {
            return Err(BackendError::Validation("Backup findes kun i lokal tilstand".into()));
        }
        let summary = self.inspect_backup(path)?;
        Ok(RestoreResult {
            summary,
            safety_copy: std::env::temp_dir().join("sikkerhedskopier/foer-gendannelse-demo.ttbackup"),
        })
    }

    fn delete_invoice_draft(&self, id: &str) -> Result<()> {
        if !self.is_local() {
            return Err(BackendError::Validation("Kladder slettes i web, når du er logget ind".into()));
        }
        self.with(|s| {
            let i = s
                .invoices
                .iter()
                .position(|i| i.id == id)
                .ok_or(BackendError::NotFound("Fakturaen".into()))?;
            if s.invoices[i].status != InvoiceStatus::Draft {
                return Err(BackendError::Validation("Kun kladder kan slettes".into()));
            }
            s.invoices.remove(i);
            for e in s.entries.iter_mut().filter(|e| e.invoice_id.as_deref() == Some(id)) {
                e.invoice_id = None;
            }
            Ok(())
        })
    }

    fn report(&self, range: DateRange, grouping: ReportGrouping) -> Result<Report> {
        self.with(|s| {
            let mut rows: Vec<ReportRow> = vec![];
            for e in s.entries.iter().filter(|e| range.contains(e.date)) {
                let (key, label) = match grouping {
                    ReportGrouping::Customer => {
                        let name = s
                            .customers
                            .iter()
                            .find(|c| c.id == e.customer_id)
                            .map(|c| c.name.clone())
                            .unwrap_or_default();
                        (e.customer_id.clone(), name)
                    }
                    ReportGrouping::Project => {
                        let p = e
                            .project_id
                            .as_ref()
                            .and_then(|p| s.projects.iter().find(|x| &x.id == p));
                        (
                            p.map(|p| p.id.clone()).unwrap_or_default(),
                            p.map(|p| p.name.clone())
                                .unwrap_or_else(|| "Uden projekt".into()),
                        )
                    }
                    ReportGrouping::Day => {
                        (e.date.to_string(), e.date.format("%d.%m.%Y").to_string())
                    }
                };
                let amount = if e.billable {
                    (s.rate_for(&e.customer_id, e.project_id.as_deref()) * e.minutes as i64 + 30)
                        / 60
                } else {
                    0
                };
                let billable = if e.billable { e.minutes } else { 0 };
                match rows.iter_mut().find(|r| r.key == key) {
                    Some(r) => {
                        r.minutes += e.minutes;
                        r.billable_minutes += billable;
                        r.amount += amount;
                    }
                    None => rows.push(ReportRow {
                        key,
                        label,
                        minutes: e.minutes,
                        billable_minutes: billable,
                        amount,
                    }),
                }
            }
            match grouping {
                ReportGrouping::Day => rows.sort_by(|a, b| a.key.cmp(&b.key)),
                _ => rows.sort_by(|a, b| b.minutes.cmp(&a.minutes).then(a.label.cmp(&b.label))),
            }
            Ok(Report {
                range,
                grouping,
                rows,
            })
        })
    }

    fn timer(&self) -> Result<TimerState> {
        self.with(|s| Ok(s.timer.clone()))
    }

    fn timer_start(&self, target: TimerTarget) -> Result<TimerState> {
        self.with(|s| {
            if s.timer.status != TimerStatus::Idle {
                return Err(BackendError::Conflict("timeren kører allerede".into()));
            }
            let v = s.timer.version;
            s.timer = TimerState {
                status: TimerStatus::Running,
                customer_id: target.customer_id,
                project_id: target.project_id,
                task_id: target.task_id,
                description: target.description,
                started_at: Some(Local::now()),
                accumulated_secs: 0,
                version: v,
            };
            s.bump_timer();
            Ok(s.timer.clone())
        })
    }

    fn timer_pause(&self) -> Result<TimerState> {
        self.with(|s| {
            if s.timer.status != TimerStatus::Running {
                return Err(BackendError::Conflict("timeren kører ikke".into()));
            }
            s.timer.accumulated_secs = s.timer.elapsed_secs(Local::now());
            s.timer.started_at = None;
            s.timer.status = TimerStatus::Paused;
            s.bump_timer();
            Ok(s.timer.clone())
        })
    }

    fn timer_resume(&self) -> Result<TimerState> {
        self.with(|s| {
            if s.timer.status != TimerStatus::Paused {
                return Err(BackendError::Conflict("timeren er ikke på pause".into()));
            }
            s.timer.started_at = Some(Local::now());
            s.timer.status = TimerStatus::Running;
            s.bump_timer();
            Ok(s.timer.clone())
        })
    }

    fn timer_set_target(&self, target: TimerTarget) -> Result<TimerState> {
        self.with(|s| {
            s.timer.customer_id = target.customer_id;
            s.timer.project_id = target.project_id;
            s.timer.task_id = target.task_id;
            s.timer.description = target.description;
            s.bump_timer();
            Ok(s.timer.clone())
        })
    }

    fn timer_stop(&self) -> Result<Option<Entry>> {
        self.stop_subtracting(0)
    }

    // ---- aktivitet

    fn activity_day(&self, date: NaiveDate) -> Result<ActivityDay> {
        self.akt_day(date)
    }

    fn assign_activity(&self, date: NaiveDate, input: AssignActivity) -> Result<AssignResult> {
        self.akt_assign(date, input)
    }

    fn activity_not_work(&self, _date: NaiveDate, block_ids: &[Id]) -> Result<()> {
        self.akt_set_status(block_ids, ActivityStatus::NotWork)
    }

    fn merge_activity(&self, _date: NaiveDate, block_ids: &[Id]) -> Result<()> {
        self.akt_merge(block_ids)
    }

    fn split_activity(&self, _date: NaiveDate, block_id: &str, at: NaiveTime) -> Result<()> {
        self.akt_split(block_id, at)
    }

    fn delete_activity(&self, _date: NaiveDate, block_ids: &[Id]) -> Result<()> {
        self.akt_delete(block_ids)
    }

    fn delete_all_activity(&self) -> Result<()> {
        self.akt_delete_all()
    }

    fn activity_storage(&self) -> Result<ActivityStorage> {
        self.akt_storage()
    }

    fn stored_exclusions(&self) -> Result<Vec<StoredExclusion>> {
        Ok(self.akt_exclusions())
    }

    fn remove_stored_exclusion(&self, id: i64) -> Result<()> {
        self.akt_remove_exclusion(id);
        Ok(())
    }

    // ux-vaelger: regler (mock_regler.rs).
    fn rule_scopes(&self, date: NaiveDate, block_ids: &[Id]) -> Result<Vec<RuleScope>> {
        self.mock_rule_scopes(date, block_ids)
    }

    fn create_rule(&self, scope: &RuleScope, customer_id: Option<Id>, project_id: Option<Id>) -> Result<Id> {
        self.mock_create_rule(scope, customer_id, project_id)
    }

    fn apply_rule_backward(&self, scope: &RuleScope, _c: Option<Id>, _p: Option<Id>) -> Result<BackwardResult> {
        self.mock_backward(scope)
    }

    fn rule_rows(&self) -> Result<Vec<RuleRow>> {
        self.mock_rule_rows()
    }

    fn set_rule_target(&self, row: &RuleRow, customer_id: Option<Id>, project_id: Option<Id>) -> Result<()> {
        if customer_id.as_deref().is_none_or(str::is_empty) && project_id.is_none() {
            return Err(BackendError::Validation("Vælg en kunde eller et projekt".into()));
        }
        self.mock_edit_rule(&row.id, |r| {
            r.customer_id = customer_id;
            r.project_id = project_id;
            r.not_work = false;
        })
    }

    fn set_rule_active(&self, row: &RuleRow, active: bool) -> Result<()> {
        self.mock_edit_rule(&row.id, |r| r.active = active)
    }

    fn delete_rule_row(&self, row: &RuleRow) -> Result<()> {
        self.mock_delete_rule(&row.id)
    }

    fn timer_subtract_idle(
        &self,
        subtract_minutes: u32,
        restart: Option<TimerTarget>,
    ) -> Result<IdleSubtraction> {
        let entry = self.stop_subtracting(subtract_minutes)?;
        let restart_error =
            restart.and_then(|target| self.timer_start(target).err().map(|e| e.to_string()));
        Ok(IdleSubtraction {
            entry,
            restart_error,
        })
    }

    fn timer_discard(&self) -> Result<()> {
        self.with(|s| {
            let v = s.timer.version;
            s.timer = TimerState::idle();
            s.timer.version = v + 1;
            Ok(())
        })
    }

    fn suggestions(&self, date: NaiveDate) -> Result<Vec<Suggestion>> {
        self.with(|s| {
            Ok(s.suggestions
                .iter()
                .filter(|x| x.date == date)
                .cloned()
                .collect())
        })
    }

    fn confirm_suggestion(
        &self,
        id: &str,
        correction: Option<SuggestionCorrection>,
    ) -> Result<Entry> {
        let today = self.today;
        self.with(|s| {
            let ix = s
                .suggestions
                .iter()
                .position(|x| x.id == id)
                .ok_or(BackendError::NotFound("Forslaget".into()))?;
            let sug = s.suggestions[ix].clone();
            let c = correction.unwrap_or_default();
            let start = c.start.unwrap_or(sug.start);
            let end = c.end.unwrap_or(sug.end);
            let minutes = (end - start).num_minutes().max(0) as u32;
            // Opgaven følger kun med, når projektet ikke er rettet.
            let task_id = sug
                .task_id
                .clone()
                .filter(|_| c.project_id.is_none() && !c.target_explicit);
            let project_id = if c.target_explicit { c.project_id.clone() } else { c.project_id.clone().or(sug.project_id.clone()) };
            let entry = s.insert_entry(
                EntryInput {
                    customer_id: c.customer_id.or(sug.customer_id).unwrap_or_default(),
                    project_id,
                    task_id,
                    description: c.description.unwrap_or(sug.reason),
                    date: sug.date,
                    start: Some(start),
                    end: Some(end),
                    minutes,
                    billable: true,
                },
                today,
            )?;
            s.suggestions.remove(ix);
            Ok(entry)
        })
    }

    fn reject_suggestion(&self, id: &str) -> Result<()> {
        self.with(|s| {
            let ix = s
                .suggestions
                .iter()
                .position(|x| x.id == id)
                .ok_or(BackendError::NotFound("Forslaget".into()))?;
            s.suggestions.remove(ix);
            Ok(())
        })
    }

    fn observer_card(&self) -> Result<ObserverCard> {
        self.with(|_| Ok(()))?;
        Ok(self.observer.lock().unwrap_or_else(|p| p.into_inner()).card())
    }

    fn observer_groups(&self) -> Result<Vec<ObserverGroup>> {
        self.with(|_| Ok(()))?;
        Ok(super::observer::demo_groups())
    }

    fn answer_observer(&self, group_id: &str, reply: ObserverReply) -> Result<()> {
        self.with(|_| Ok(()))?;
        if let ObserverReply::NewCustomer { name } = &reply {
            self.create_customer(CustomerInput {
                name: name.clone(),
                email: None,
                hourly_rate: None,
                cvr: None,
                ..Default::default()
            })?;
        }
        self.observer
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .answer(group_id, &reply)
    }

    fn confirm_day(&self, date: NaiveDate) -> Result<Vec<Entry>> {
        let ids: Vec<Id> = self.suggestions(date)?.into_iter().map(|x| x.id).collect();
        ids.iter()
            .map(|id| self.confirm_suggestion(id, None))
            .collect()
    }

    // screens-a

    fn create_entry_with_card(&self, input: EntryInput, card: CardChoice) -> Result<Entry> {
        let today = self.today;
        self.with(|s| s.insert_entry_with_card(input, today, card))
    }

    /// Logget forbrug, nyeste først. Det, kortet har brugt ud over loggen
    /// (seed-data), vises som én linje på købsdatoen.
    fn punch_card_usage(&self, card_id: &str) -> Result<Vec<PunchUsage>> {
        self.with(|s| {
            let card = s
                .punch_cards
                .iter()
                .find(|c| c.id == card_id)
                .ok_or(BackendError::NotFound("Klippekortet".into()))?;
            let mut v: Vec<PunchUsage> = s
                .card_usage
                .iter()
                .filter(|(id, _)| id == card_id)
                .map(|(_, u)| u.clone())
                .collect();
            let logged: u32 = v.iter().map(|u| u.minutes).sum();
            if card.used_minutes > logged {
                v.push(PunchUsage {
                    entry_id: None,
                    date: card.purchased,
                    minutes: card.used_minutes - logged,
                    description: "Forbrug før historikken".into(),
                });
            }
            v.sort_by_key(|u| std::cmp::Reverse(u.date));
            Ok(v)
        })
    }

    // screens-b
    fn account(&self) -> Result<Account> {
        self.fail_check()?;
        self.b.with(|b| Ok(b.account.clone()))
    }

    fn logout(&self) -> Result<()> {
        self.fail_check()?;
        self.b.with(|b| {
            b.account = mock_account(false);
            Ok(())
        })
    }

    fn settings(&self) -> Result<Settings> {
        self.fail_check()?;
        self.b.with(|b| Ok(b.settings.clone()))
    }

    fn save_settings(&self, settings: Settings) -> Result<Settings> {
        self.fail_check()?;
        validate_settings(&settings)?;
        self.b.with(|b| {
            b.settings = settings;
            Ok(b.settings.clone())
        })
    }

    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        self.fail_check()?;
        self.b.with(|b| Ok(b.models.clone()))
    }

    fn download_model(&self, id: &str) -> Result<()> {
        self.fail_check()?;
        self.b.with(|b| {
            let m = b
                .models
                .iter_mut()
                .find(|m| m.id == id)
                .ok_or(BackendError::NotFound("Modellen".into()))?;
            m.downloaded = true;
            Ok(())
        })
    }

    fn delete_model(&self, id: &str) -> Result<()> {
        self.fail_check()?;
        self.b.with(|b| {
            let m = b
                .models
                .iter_mut()
                .find(|m| m.id == id)
                .ok_or(BackendError::NotFound("Modellen".into()))?;
            m.downloaded = false;
            if b.settings.ai.builtin_model.as_deref() == Some(id) {
                b.settings.ai.builtin_model = None;
                if b.settings.ai.mode == AiMode::Builtin {
                    b.settings.ai.mode = AiMode::Off;
                }
            }
            Ok(())
        })
    }

    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        self.fail_check()?;
        self.b.with(|b| Ok(b.servers.clone()))
    }

    fn found_models(&self) -> Result<FoundModels> {
        self.fail_check()?;
        self.b.with(|b| Ok(b.found.clone()))
    }

    fn set_cloud_ai_key(&self, provider: CloudAiProvider, key: String) -> Result<()> {
        self.fail_check()?;
        if key.trim().len() < 10 {
            return Err(BackendError::Validation("Nøglen ser for kort ud".into()));
        }
        self.b.with(|b| {
            if !b.settings.ai.cloud_keys.contains(&provider) {
                b.settings.ai.cloud_keys.push(provider);
            }
            Ok(())
        })
    }

    fn remove_cloud_ai_key(&self, provider: CloudAiProvider) -> Result<()> {
        self.fail_check()?;
        self.b.with(|b| {
            b.settings.ai.cloud_keys.retain(|p| *p != provider);
            if b.settings.ai.cloud_provider == Some(provider) {
                b.settings.ai.cloud_provider = None;
                if b.settings.ai.mode == AiMode::Cloud {
                    b.settings.ai.mode = AiMode::Off;
                }
            }
            Ok(())
        })
    }

    fn begin_login(&self) -> Result<LoginStart> {
        self.fail_check()?;
        self.b.with(|b| {
            let state = "mock-state-7f3a9c".to_string();
            b.login_state = Some(state.clone());
            Ok(LoginStart {
                url: format!("https://app.timetrack.dk/desktop/login?state={state}"),
                state,
            })
        })
    }

    fn complete_login(&self, code: &str) -> Result<Account> {
        self.fail_check()?;
        if code.is_empty() {
            return Err(BackendError::Validation("Login-koden mangler".into()));
        }
        self.b.with(|b| {
            b.login_state = None;
            b.account = mock_account(true);
            Ok(b.account.clone())
        })
    }

    fn activate_license(&self, key: &str) -> Result<License> {
        self.fail_check()?;
        if !license_key_format_ok(key) {
            return Err(BackendError::Validation(
                "Licensnøglen har formen TT-XXXX-XXXX-XXXX-XXXX".into(),
            ));
        }
        self.b.with(|b| {
            let lic = License {
                kind: LicenseKind::Lifetime,
                key_hint: mask_key(key),
            };
            b.account.license = Some(lic.clone());
            Ok(lic)
        })
    }

    fn start_trial(&self) -> Result<License> {
        self.fail_check()?;
        self.b.with(|b| {
            let lic = License {
                kind: LicenseKind::Trial { days_left: 14 },
                key_hint: "Prøve".into(),
            };
            b.account.license = Some(lic.clone());
            b.account.trial_available = false;
            Ok(lic)
        })
    }

    fn permissions(&self) -> Result<Permissions> {
        self.fail_check()?;
        self.b.with(|b| Ok(b.permissions))
    }

    fn request_permission(&self, permission: Permission) -> Result<PermissionState> {
        self.fail_check()?;
        self.b.with(|b| {
            let slot = match permission {
                Permission::Accessibility => &mut b.permissions.accessibility,
                Permission::ScreenRecording => &mut b.permissions.screen_recording,
            };
            *slot = PermissionState::Granted;
            Ok(*slot)
        })
    }

    fn import_local_to_cloud(&self, dry_run: bool) -> Result<ImportReport> {
        self.fail_check()?;
        let (customers, projects, entries, punch_cards, tasks, invoices) = {
            let s = self.state.lock().expect("mock-lås");
            (
                s.customers.len() as u32,
                s.projects.len() as u32,
                s.entries.len() as u32,
                s.punch_cards.len() as u32,
                s.tasks.len() as u32,
                s.invoices.len() as u32,
            )
        };
        self.b.with(|b| {
            let mut r = ImportReport {
                dry_run,
                customers,
                projects,
                entries,
                punch_cards,
                tasks,
                invoices,
                skipped: 0,
                warnings: vec![],
                ..Default::default()
            };
            if b.imported {
                // Idempotent: alt findes allerede (samme clientEntryId).
                r.skipped = r.total();
                r.customers = 0;
                r.projects = 0;
                r.entries = 0;
                r.punch_cards = 0;
                r.tasks = 0;
                r.invoices = 0;
            } else if customers > 0 {
                r.warnings
                    .push("Kunder med samme navn i cloud flettes sammen".into());
            }
            if !dry_run {
                b.imported = true;
            }
            Ok(r)
        })
    }

    // ---- afviste registreringer (se `afviste.rs`)

    fn rejected_count(&self) -> usize {
        self.mock_rejected_count()
    }

    fn rejected(&self) -> Result<Vec<Rejected>> {
        self.with(|_| Ok(()))?;
        Ok(self.mock_rejected())
    }

    fn retry_rejected(&self, id: Option<&str>) -> Result<RetryResult> {
        self.with(|_| Ok(()))?;
        self.mock_retry_rejected(id)
    }

    fn discard_rejected(&self, id: &str) -> Result<()> {
        self.with(|_| Ok(()))?;
        self.mock_discard_rejected(id)
    }

    fn rejected_csv(&self) -> Result<String> {
        self.with(|_| Ok(()))?;
        Ok(self.mock_rejected_csv())
    }
}

#[cfg(test)]
mod screens_a_tests {
    use super::*;

    fn mock() -> MockBackend {
        MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap())
    }

    fn input(customer: &str, minutes: u32) -> EntryInput {
        EntryInput {
            customer_id: customer.into(),
            project_id: None,
            task_id: None,
            description: "Test".into(),
            date: NaiveDate::from_ymd_opt(2026, 10, 26).unwrap(),
            start: None,
            end: None,
            minutes,
            billable: true,
        }
    }

    fn used(m: &MockBackend, card: &str) -> u32 {
        m.punch_cards(None)
            .unwrap()
            .into_iter()
            .find(|c| c.id == card)
            .unwrap()
            .used_minutes
    }

    #[test]
    fn valgt_kort_traekkes_og_logges() {
        let m = mock();
        let before = used(&m, "kort_yoga");
        let e = m
            .create_entry_with_card(input("kunde_yoga", 90), CardChoice::Card("kort_yoga".into()))
            .unwrap();
        assert_eq!(used(&m, "kort_yoga"), before + 90);
        let log = m.punch_card_usage("kort_yoga").unwrap();
        assert_eq!(log[0].entry_id.as_deref(), Some(e.id.as_str()));
        assert_eq!(log[0].minutes, 90);
        // Resten af forbruget (seed) står som én linje.
        assert_eq!(log.iter().map(|u| u.minutes).sum::<u32>(), before + 90);
    }

    #[test]
    fn intet_kort_traekker_ikke() {
        let m = mock();
        let before = used(&m, "kort_yoga");
        m.create_entry_with_card(input("kunde_yoga", 60), CardChoice::None)
            .unwrap();
        assert_eq!(used(&m, "kort_yoga"), before);
    }

    #[test]
    fn kort_fra_anden_kunde_afvises() {
        let m = mock();
        let err = m
            .create_entry_with_card(input("kunde_klinik", 60), CardChoice::Card("kort_yoga".into()))
            .unwrap_err();
        assert!(matches!(err, BackendError::Validation(_)));
    }

    #[test]
    fn seneste_poster_for_kunden_nyeste_foerst() {
        let m = mock();
        let v = m.recent_entries("kunde_klinik", 5).unwrap();
        assert!(!v.is_empty() && v.len() <= 5);
        assert!(v.iter().all(|e| e.customer_id == "kunde_klinik"));
        assert!(v.windows(2).all(|w| w[0].date >= w[1].date));
    }

    #[test]
    fn cvr_gemmes() {
        let m = mock();
        let c = m
            .create_customer(CustomerInput {
                name: "Ny kunde".into(),
                cvr: Some("12345678".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(c.cvr.as_deref(), Some("12345678"));
    }
}

// screens-b
impl MockBackend {
    fn fail_check(&self) -> Result<()> {
        match self.fail.lock().expect("mock-lås").clone() {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    /// Mock i lokal tilstand (til onboarding og licens-tests).
    pub fn set_local_account(&self) {
        let _ = self.b.with(|b| {
            b.account = mock_account(false);
            Ok(())
        });
    }

    /// Sætter tilladelserne (til onboarding-tests).
    pub fn set_permissions(&self, p: Permissions) {
        let _ = self.b.with(|b| {
            b.permissions = p;
            Ok(())
        });
    }
}

// idle-fradrag (0.2.24)
impl MockBackend {
    /// Stop og gem, kortet med `subtract_minutes` (idle) i samme skridt.
    /// Posten beholder starten; er der intet tilbage, gemmes ingen post.
    fn stop_subtracting(&self, subtract_minutes: u32) -> Result<Option<Entry>> {
        let today = self.today;
        self.with(|s| {
            if s.timer.status == TimerStatus::Idle {
                return Err(BackendError::Conflict("timeren kører ikke".into()));
            }
            let now = Local::now();
            let secs = s.timer.elapsed_secs(now);
            let total = (secs / 60) as u32;
            let minutes = total.saturating_sub(subtract_minutes);
            let reset = |s: &mut State| {
                let v = s.timer.version;
                s.timer = TimerState::idle();
                s.timer.version = v + 1;
            };
            if minutes == 0 {
                reset(s);
                return Ok(None);
            }
            // Gem posten FØR timeren nulstilles: fejler det, kører timeren
            // videre, så tiden ikke går tabt.
            let Some(customer_id) = s.timer.customer_id.clone() else {
                return Err(BackendError::Validation(
                    "Vælg en kunde, før timeren gemmes".into(),
                ));
            };
            let stopped = now.time().with_second(0).and_then(|x| x.with_nanosecond(0));
            let start = stopped
                .map(|e| e - chrono::Duration::minutes(i64::from(total)))
                .filter(|st| Some(*st) < stopped);
            let end = start.map(|st| st + chrono::Duration::minutes(i64::from(minutes)));
            let entry = s.insert_entry(
                EntryInput {
                    customer_id,
                    project_id: s.timer.project_id.clone(),
                    task_id: s.timer.task_id.clone(),
                    description: s.timer.description.clone(),
                    date: today,
                    start,
                    end,
                    minutes,
                    billable: true,
                },
                today,
            )?;
            reset(s);
            Ok(Some(entry))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
    }

    fn mock() -> MockBackend {
        MockBackend::with_today(day())
    }

    #[test]
    fn seed_har_danske_data() {
        let m = mock();
        let c = m.customers(false).unwrap();
        assert_eq!(c.len(), 7, "arkiverede skjules");
        assert_eq!(m.customers(true).unwrap().len(), 8);
        assert!(c.iter().any(|c| c.name.contains('ø')));
        let today = m.entries(DateRange::day(day())).unwrap();
        assert_eq!(today.len(), 3);
        assert!(
            today.iter().any(|e| e.start.is_none()),
            "en post uden tidspunkt"
        );
        assert_eq!(
            today.last().unwrap().start,
            None,
            "poster uden tidspunkt sorteres sidst"
        );
        assert_eq!(m.suggestions(day()).unwrap().len(), 3);
    }

    #[test]
    fn post_traekker_fra_klippekort() {
        let m = mock();
        let before = m.punch_cards(Some("kunde_bageriet")).unwrap()[0].used_minutes;
        m.create_entry(EntryInput {
            customer_id: "kunde_bageriet".into(),
            project_id: Some("proj_webshop".into()),
            task_id: Some("opg_1".into()),
            description: "Test".into(),
            date: day(),
            start: None,
            end: None,
            minutes: 90,
            billable: true,
        })
        .unwrap();
        assert_eq!(
            m.punch_cards(Some("kunde_bageriet")).unwrap()[0].used_minutes,
            before + 90
        );
        assert_eq!(
            m.tasks(Some("proj_webshop")).unwrap()[0].logged_minutes,
            340 + 90
        );
    }

    #[test]
    fn validering_paa_dansk() {
        let m = mock();
        let err = m
            .create_entry(EntryInput {
                customer_id: "kunde_bageriet".into(),
                project_id: None,
                task_id: None,
                description: String::new(),
                date: day(),
                start: Some(t(10, 0)),
                end: Some(t(9, 0)),
                minutes: 30,
                billable: true,
            })
            .unwrap_err();
        assert_eq!(err.to_string(), "Sluttid skal være efter starttid");
        assert!(
            m.create_customer(CustomerInput {
                name: "  ".into(),
                ..Default::default()
            })
            .is_err()
        );
    }

    #[test]
    fn timer_livscyklus_og_version() {
        let m = mock();
        let v0 = m.timer().unwrap().version;
        let st = m
            .timer_start(TimerTarget {
                customer_id: Some("kunde_cafe".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(st.status, TimerStatus::Running);
        assert!(st.version > v0);
        assert!(matches!(
            m.timer_start(TimerTarget::default()),
            Err(BackendError::Conflict(_))
        ));
        let p = m.timer_pause().unwrap();
        assert_eq!(p.status, TimerStatus::Paused);
        assert_eq!(m.timer_resume().unwrap().status, TimerStatus::Running);
        // Under ét minut gemmes ikke.
        assert_eq!(m.timer_stop().unwrap(), None);
        assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
    }

    #[test]
    fn timer_elapsed_taeller_pause_med() {
        let now = Local::now();
        let mut st = TimerState::idle();
        st.status = TimerStatus::Running;
        st.accumulated_secs = 100;
        st.started_at = Some(now - chrono::Duration::seconds(50));
        assert_eq!(st.elapsed_secs(now), 150);
        st.status = TimerStatus::Paused;
        assert_eq!(st.elapsed_secs(now), 100);
    }

    #[test]
    fn forslag_bekraeft_ret_afvis() {
        let m = mock();
        let e = m.confirm_suggestion("forslag_1", None).unwrap();
        assert_eq!(e.minutes, 120);
        assert_eq!(e.customer_id, "kunde_bageriet");
        let e2 = m
            .confirm_suggestion(
                "forslag_2",
                Some(SuggestionCorrection {
                    customer_id: Some("kunde_toemrer".into()),
                    project_id: Some("proj_tilbud".into()),
                    ..Default::default()
                }),
            )
            .unwrap();
        assert_eq!(e2.customer_id, "kunde_toemrer");
        m.reject_suggestion("forslag_3").unwrap();
        assert!(m.suggestions(day()).unwrap().is_empty());
    }

    #[test]
    fn bekraeft_hele_dagen() {
        let m = mock();
        let n = m.entries(DateRange::day(day())).unwrap().len();
        assert_eq!(m.confirm_day(day()).unwrap().len(), 3);
        assert_eq!(m.entries(DateRange::day(day())).unwrap().len(), n + 3);
    }

    #[test]
    fn faktura_kladde_send_betal() {
        let m = mock();
        let ids: Vec<Id> = m
            .uninvoiced_entries("kunde_bageriet")
            .unwrap()
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert!(!ids.is_empty());
        let inv = m.create_invoice_draft("kunde_bageriet", &ids).unwrap();
        assert_eq!(inv.status, InvoiceStatus::Draft);
        assert_eq!(inv.number, None);
        assert!(m.uninvoiced_entries("kunde_bageriet").unwrap().is_empty());
        assert!(inv.total() > inv.subtotal());
        let sent = m.send_invoice(&inv.id).unwrap();
        assert_eq!(sent.number, Some(1042));
        m.mark_invoice_paid(&inv.id).unwrap();
    }

    #[test]
    fn fakturalinje_og_moms_afrundes() {
        let l = InvoiceLine {
            description: "x".into(),
            minutes: 90,
            rate: 85_000,
            entry_ids: vec![],
        };
        assert_eq!(l.amount(), 127_500);
        let inv = Invoice {
            id: "x".into(),
            number: None,
            customer_id: "c".into(),
            status: InvoiceStatus::Draft,
            issued: day(),
            due: day(),
            lines: vec![l],
            lines_loaded: true,
            subtotal_hint: 0,
            vat_permille: 250,
            number_text: None,
            title: None,
            notes: None,
        };
        assert_eq!(inv.vat(), 31_875);
        assert_eq!(inv.total(), 159_375);
    }

    #[test]
    fn rapport_grupperer() {
        let m = mock();
        let r = m
            .report(
                DateRange {
                    from: day() - Days::new(30),
                    to: day(),
                },
                ReportGrouping::Customer,
            )
            .unwrap();
        assert!(r.rows.len() >= 5);
        assert!(r.rows.windows(2).all(|w| w[0].minutes >= w[1].minutes));
        let total: u32 = m.entries(r.range).unwrap().iter().map(|e| e.minutes).sum();
        assert_eq!(r.total_minutes(), total);
    }

    #[test]
    fn fejltilstand_kan_simuleres() {
        let m = mock();
        m.set_failure(Some(BackendError::Offline));
        assert_eq!(m.customers(false), Err(BackendError::Offline));
        m.set_failure(None);
        assert!(m.customers(false).is_ok());
    }

    #[test]
    fn stop_uden_kunde_mister_ikke_tiden() {
        let m = mock();
        m.demo_timer(TimerTarget::default(), 2 * 3600);
        let err = m.timer_stop().unwrap_err();
        assert_eq!(err.to_string(), "Vælg en kunde, før timeren gemmes");
        let t = m.timer().unwrap();
        assert_eq!(t.status, TimerStatus::Running, "timeren kører videre");
        assert!(t.elapsed_secs(Local::now()) >= 2 * 3600);
        m.timer_set_target(TimerTarget {
            customer_id: Some("kunde_cafe".into()),
            ..Default::default()
        })
        .unwrap();
        let e = m.timer_stop().unwrap().unwrap();
        assert_eq!(e.minutes, 120);
        assert_eq!(m.timer().unwrap().status, TimerStatus::Idle);
    }

    #[test]
    fn klippekort_overloeb() {
        let m = mock();
        let cafe = &m.punch_cards(Some("kunde_cafe")).unwrap()[0];
        assert_eq!(cafe.overflow_minutes(), 90);
        assert!(!cafe.is_active(day()));
    }
}
