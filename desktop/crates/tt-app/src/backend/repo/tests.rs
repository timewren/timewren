//! Kontrakt-tests for `RepoBackend`: samme sekvens mod lokal tilstand (SQLite i
//! en temp-mappe) og cloud-tilstand (`tt_data::mock::MockWeb`).

use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, NaiveTime, TimeZone};
use serde_json::json;
use tt_data::mock::MockWeb;

use super::*;
use crate::backend::services::NoDetection;

// ---------------------------------------------------------------- hjælpere

/// Detektion med faste forslag, der husker, hvad den fik at vide.
#[derive(Default)]
struct FakeDetection {
    suggestions: StdMutex<Vec<Suggestion>>,
    confirmed: StdMutex<Vec<(String, Option<SuggestionCorrection>, String)>>,
    rejected: StdMutex<Vec<String>>,
    applied: StdMutex<Vec<Settings>>,
    keys: StdMutex<Vec<CloudAiProvider>>,
    web: StdMutex<Option<services::WebCatalog>>,
}

impl Detection for FakeDetection {
    fn set_web_catalog(&self, catalog: services::WebCatalog) {
        *self.web.lock().unwrap() = Some(catalog);
    }

    fn suggestions(
        &self,
        _: NaiveDate,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<Vec<Suggestion>> {
        // Kun forslag til kunder og projekter, backend'en har givet videre.
        let known = |s: &Suggestion| {
            s.customer_id
                .as_ref()
                .is_none_or(|id| customers.iter().any(|c| &c.id == id))
                && s.project_id
                    .as_ref()
                    .is_none_or(|p| projects.iter().any(|x| &x.id == p))
        };
        Ok(self
            .suggestions
            .lock()
            .unwrap()
            .iter()
            .filter(|s| known(s))
            .cloned()
            .collect())
    }

    fn entry_for(&self, id: &str, correction: Option<&SuggestionCorrection>) -> Result<EntryInput> {
        let list = self.suggestions.lock().unwrap();
        let s = list
            .iter()
            .find(|s| s.id == id)
            .ok_or(BackendError::NotFound("Forslaget".into()))?;
        let c = correction.cloned().unwrap_or_default();
        Ok(EntryInput {
            customer_id: c
                .customer_id
                .or_else(|| s.customer_id.clone())
                .unwrap_or_default(),
            project_id: c.project_id.or_else(|| s.project_id.clone()),
            task_id: None,
            description: c.description.unwrap_or_else(|| s.reason.clone()),
            date: s.date,
            start: Some(c.start.unwrap_or(s.start)),
            end: Some(c.end.unwrap_or(s.end)),
            minutes: s.minutes(),
            billable: true,
        })
    }

    fn confirmed(&self, id: &str, correction: Option<&SuggestionCorrection>, entry_id: &str) {
        self.confirmed
            .lock()
            .unwrap()
            .push((id.into(), correction.cloned(), entry_id.into()));
        self.suggestions.lock().unwrap().retain(|s| s.id != id);
    }

    fn reject(&self, id: &str) -> Result<()> {
        self.rejected.lock().unwrap().push(id.into());
        self.suggestions.lock().unwrap().retain(|s| s.id != id);
        Ok(())
    }

    fn apply_settings(&self, settings: &Settings) {
        self.applied.lock().unwrap().push(settings.clone());
    }

    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        Ok(vec![LocalModel {
            id: "m1".into(),
            name: "Modellen".into(),
            size_mb: 10,
            note: "Test".into(),
            downloaded: false,
        }])
    }

    fn download_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn delete_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        Ok(vec![])
    }
    fn set_cloud_ai_key(&self, p: CloudAiProvider, _: String) -> Result<()> {
        self.keys.lock().unwrap().push(p);
        Ok(())
    }
    fn remove_cloud_ai_key(&self, p: CloudAiProvider) -> Result<()> {
        self.keys.lock().unwrap().retain(|k| *k != p);
        Ok(())
    }
    fn permissions(&self) -> Result<Permissions> {
        Ok(Permissions {
            accessibility: PermissionState::Granted,
            screen_recording: PermissionState::Denied,
        })
    }
    fn request_permission(&self, _: Permission) -> Result<PermissionState> {
        Ok(PermissionState::Granted)
    }
}

/// Et ur, tests kan stille frem.
#[derive(Clone)]
struct FakeClock(Arc<StdMutex<DateTime<Utc>>>);

impl FakeClock {
    /// I dag kl. 10, så testene ikke når over midnat, når de stiller uret frem
    /// (før: nu, og efter kl. 22 fik posterne morgendagens dato).
    fn now() -> Self {
        let ten = Local
            .from_local_datetime(&day().and_time(t(10, 0)))
            .earliest()
            .unwrap();
        FakeClock(Arc::new(StdMutex::new(ten.with_timezone(&Utc))))
    }
    fn advance(&self, secs: i64) {
        *self.0.lock().unwrap() += chrono::Duration::seconds(secs);
    }
    fn clock(&self) -> td::Clock {
        let inner = self.0.clone();
        Arc::new(move || *inner.lock().unwrap())
    }
}

fn day() -> NaiveDate {
    Local::now().date_naive()
}

fn t(h: u32, m: u32) -> NaiveTime {
    NaiveTime::from_hms_opt(h, m, 0).unwrap()
}

fn entry_input(customer: &str, project: Option<&str>, minutes: u32, desc: &str) -> EntryInput {
    EntryInput {
        customer_id: customer.into(),
        project_id: project.map(str::to_owned),
        task_id: None,
        description: desc.into(),
        date: day(),
        start: None,
        end: None,
        minutes,
        billable: true,
    }
}

fn customer_input(name: &str) -> CustomerInput {
    CustomerInput {
        name: name.into(),
        email: Some("kontakt@example.dk".into()),
        hourly_rate: Some(85_000),
        cvr: Some("12345678".into()),
        ..Default::default()
    }
}

fn wait_until(what: &str, mut f: impl FnMut() -> bool) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("timeout: {what}");
}

fn drain<T>(rx: &async_channel::Receiver<T>) -> Vec<T> {
    let mut v = vec![];
    while let Ok(x) = rx.try_recv() {
        v.push(x);
    }
    v
}

fn local(
    dir: &std::path::Path,
    detection: Arc<dyn Detection>,
    clock: Option<td::Clock>,
) -> RepoBackend {
    let mut o = Options::for_tests(dir.to_path_buf(), detection);
    o.clock = clock;
    RepoBackend::open_with(o).unwrap()
}

// ---------------------------------------------------------------- små hjælpefunktioner

#[test]
fn state_og_deep_link() {
    assert_eq!(
        state_from_url("https://timetrack.dk/desktop/authorize?state=abc123&code_challenge=x")
            .as_deref(),
        Some("abc123")
    );
    assert_eq!(
        state_from_url("https://timetrack.dk/x?a=1&state=zz").as_deref(),
        Some("zz")
    );
    assert_eq!(state_from_url("https://timetrack.dk/x?state="), None);
    assert_eq!(state_from_url("https://timetrack.dk/x"), None);

    assert_eq!(
        callback_url("kode 1/æ", "st"),
        format!(
            "{}?code=kode%201%2F%C3%A6&state=st",
            td::cloud::auth::redirect_uri()
        )
    );
    let full = "timetrack://auth/callback?code=a&state=b";
    assert_eq!(
        callback_url(&format!("  {full} "), "andet"),
        full,
        "hele linket bruges uændret"
    );
}

#[test]
fn plangraenser_fra_web() {
    let limits = json!({
        "maxActiveClients": 5, "maxProjects": null, "maxInvoicesPerMonth": 50,
        "maxDevices": -1, "maxSomethingNew": 3, "tier": "pro", "maxlower": 9
    });
    let usage = json!({ "activeClients": 3, "invoicesPerMonth": 12, "somethingNew": 1 });
    let rows = entitlement_rows(Some(&limits), Some(&usage));
    let find = |k: &str| {
        rows.iter()
            .find(|r| r.key == k)
            .unwrap_or_else(|| panic!("mangler {k}: {rows:?}"))
    };
    let a = find("activeClients");
    assert_eq!(
        (a.label.as_str(), a.used, a.limit),
        ("Aktive kunder", 3, Some(5))
    );
    assert_eq!(a.usage(), "3 af 5");
    assert_eq!(find("projects").limit, None, "null er ubegrænset");
    assert_eq!(find("devices").limit, None, "negativ er ubegrænset");
    assert_eq!(find("invoicesPerMonth").used, 12);
    let n = find("somethingNew");
    assert_eq!(
        (n.label.as_str(), n.used, n.limit),
        ("Something new", 1, Some(3))
    );
    assert_eq!(rows.len(), 5, "kun max-grænser: {rows:?}");
    assert!(entitlement_rows(None, None).is_empty());
    assert!(entitlement_rows(Some(&json!("x")), None).is_empty());
}

// ---------------------------------------------------------------- lokal kontrakt

/// Web's auto-select (`lib/prepaid/auto-select.ts`) vurderer udløb mod nu.
/// Før vurderede desktop mod postens dato, så en post fra sidste måned valgte
/// et kort, der udløb i går, og trækket blev afvist.
#[test]
fn udloebet_kort_vaelges_ikke_til_gammel_post() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Café Åbrinken")).unwrap();
    let card = b
        .create_punch_card(PunchCardInput {
            customer_id: c.id.clone(),
            name: "Udløbet".into(),
            total_minutes: 300,
            price: 250_000,
            expires: Some(day() - chrono::Days::new(1)),
        })
        .unwrap();
    let old = EntryInput { date: day() - chrono::Days::new(30), ..entry_input(&c.id, None, 60, "Gammel post") };
    let e = b.create_entry_with_card(old, CardChoice::Auto).unwrap();
    assert_eq!(e.minutes, 60, "posten gemmes");
    // Heller ikke i et første forsøg, som web afviser (før: kortet blev
    // sendt, afvist, og posten sendt igen uden).
    let sent = w.mock.inputs("extension.entries.create");
    assert_eq!(sent.len(), 1, "ét kald: {sent:?}");
    assert!(
        sent[0]["data"].get("prepaidPackageId").is_none(),
        "det udløbne kort ({}) sendes ikke med: {sent:?}",
        card.id
    );
}

#[test]
fn lokal_kontrakt_kunder_projekter_poster_klippekort() {
    let dir = tempfile::tempdir().unwrap();
    let b = RepoBackend::local_for_tests(dir.path());
    assert_eq!(b.mode(), Mode::Local);

    // Kunder
    let c = b.create_customer(customer_input("Café Åbrinken")).unwrap();
    assert_eq!(c.name, "Café Åbrinken");
    assert_eq!(c.hourly_rate, Some(85_000));
    assert_eq!(c.cvr.as_deref(), Some("12345678"), "CVR gemmes på kunden");
    assert_eq!(c.email.as_deref(), Some("kontakt@example.dk"));
    let upd = b
        .update_customer(
            &c.id,
            CustomerInput {
                name: "Åbrinken ApS".into(),
                email: None,
                hourly_rate: Some(90_000),
                cvr: Some("12345678".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        (upd.name.as_str(), upd.email.clone(), upd.hourly_rate),
        ("Åbrinken ApS", None, Some(90_000))
    );
    assert_eq!(upd.cvr.as_deref(), Some("12345678"));
    b.set_customer_archived(&c.id, true).unwrap();
    assert!(b.customers(false).unwrap().is_empty());
    assert_eq!(b.customers(true).unwrap().len(), 1);
    assert!(b.customers(true).unwrap()[0].archived);
    b.set_customer_archived(&c.id, false).unwrap();
    assert_eq!(b.customers(false).unwrap().len(), 1);
    assert!(matches!(
        b.update_customer("findes-ikke", customer_input("X")),
        Err(BackendError::NotFound(_))
    ));
    assert!(matches!(
        b.create_customer(CustomerInput {
            name: " ".into(),
            ..Default::default()
        }),
        Err(BackendError::Validation(_))
    ));

    // Projekter
    let p = b
        .create_project(ProjectInput {
            customer_id: c.id.clone(),
            name: "Webshop".into(),
            hourly_rate: Some(95_000),
            budget_minutes: Some(1200),
        })
        .unwrap();
    assert_eq!(
        (p.customer_id.as_str(), p.budget_minutes, p.hourly_rate),
        (c.id.as_str(), Some(1200), Some(95_000))
    );
    assert_eq!(p.status, ProjectStatus::Active);
    assert_eq!(b.projects(Some(&c.id), false).unwrap().len(), 1);
    assert!(b.projects(Some("anden"), false).unwrap().is_empty());
    b.set_project_status(&p.id, ProjectStatus::Paused).unwrap();
    assert_eq!(
        b.projects(None, false).unwrap()[0].status,
        ProjectStatus::Paused
    );
    b.set_project_status(&p.id, ProjectStatus::Archived)
        .unwrap();
    assert!(b.projects(None, false).unwrap().is_empty());
    assert_eq!(b.projects(None, true).unwrap().len(), 1);
    b.set_project_status(&p.id, ProjectStatus::Active).unwrap();
    let renamed = b
        .update_project(
            &p.id,
            ProjectInput {
                customer_id: c.id.clone(),
                name: "Webshop 2".into(),
                hourly_rate: Some(95_000),
                budget_minutes: Some(1200),
            },
        )
        .unwrap();
    assert_eq!(renamed.name, "Webshop 2");

    // Klippekort
    let card = b
        .create_punch_card(PunchCardInput {
            customer_id: c.id.clone(),
            name: "10 timer".into(),
            total_minutes: 600,
            price: 600_000,
            expires: None,
        })
        .unwrap();
    assert_eq!(
        (card.total_minutes, card.used_minutes, card.price),
        (600, 0, 600_000)
    );
    assert_eq!(card.purchased, day());

    // Poster: auto-valg af kort, "intet kort" og et bestemt kort
    let e1 = b
        .create_entry(entry_input(&c.id, Some(&p.id), 90, "Design"))
        .unwrap();
    assert_eq!(
        (e1.minutes, e1.customer_id.as_str(), e1.date),
        (90, c.id.as_str(), day())
    );
    assert_eq!(
        b.punch_cards(Some(&c.id)).unwrap()[0].used_minutes,
        90,
        "auto trak fra kortet"
    );
    let e2 = b
        .create_entry_with_card(entry_input(&c.id, None, 30, "Uden kort"), CardChoice::None)
        .unwrap();
    assert_eq!(b.punch_cards(Some(&c.id)).unwrap()[0].used_minutes, 90);
    let e3 = b
        .create_entry_with_card(
            entry_input(&c.id, None, 15, "Valgt kort"),
            CardChoice::Card(card.id.clone()),
        )
        .unwrap();
    assert_eq!(b.punch_cards(None).unwrap()[0].used_minutes, 105);

    let usage = b.punch_card_usage(&card.id).unwrap();
    assert_eq!(usage.len(), 2, "{usage:?}");
    assert_eq!(usage.iter().map(|u| u.minutes).sum::<u32>(), 105);
    assert!(
        usage
            .iter()
            .any(|u| u.entry_id.as_deref() == Some(e1.id.as_str()) && u.minutes == 90)
    );
    assert!(usage.iter().any(|u| u.entry_id.as_deref() == Some(e3.id.as_str()) && u.description == "Valgt kort"));
    assert!(matches!(
        b.punch_card_usage("findes-ikke"),
        Err(BackendError::NotFound(_))
    ));

    // Poster med tidspunkt
    let timed = b
        .create_entry(EntryInput {
            start: Some(t(9, 0)),
            end: Some(t(10, 15)),
            minutes: 75,
            ..entry_input(&c.id, None, 75, "Møde")
        })
        .unwrap();
    assert_eq!(
        (timed.start, timed.end, timed.minutes),
        (Some(t(9, 0)), Some(t(10, 15)), 75)
    );
    let day_entries = b.entries(DateRange::day(day())).unwrap();
    assert_eq!(day_entries.len(), 4);
    assert!(
        day_entries
            .windows(2)
            .all(|w| (w[0].date, w[0].start) <= (w[1].date, w[1].start)),
        "sorteret efter dato og start"
    );
    assert_eq!(
        day_entries.last().unwrap().start,
        Some(t(9, 0)),
        "poster uden tidspunkt kommer først"
    );
    assert!(
        b.entries(DateRange::day(day() - chrono::Days::new(1)))
            .unwrap()
            .is_empty()
    );

    let edited = b
        .update_entry(
            &e2.id,
            EntryInput {
                minutes: 45,
                billable: false,
                ..entry_input(&c.id, None, 45, "Rettet")
            },
        )
        .unwrap();
    assert_eq!(
        (edited.minutes, edited.billable, edited.description.as_str()),
        (45, false, "Rettet")
    );
    b.delete_entry(&e2.id).unwrap();
    assert_eq!(b.entries(DateRange::day(day())).unwrap().len(), 3);
    assert!(matches!(
        b.delete_entry(&e2.id),
        Err(BackendError::NotFound(_))
    ));
    assert!(matches!(
        b.create_entry(entry_input(&c.id, None, 30, "  ")),
        Err(BackendError::Validation(m)) if m.contains("Beskrivelse")
    ));
    assert_eq!(b.recent_entries(&c.id, 2).unwrap().len(), 2);

    // Opgaver
    let task = b
        .create_task(TaskInput {
            project_id: p.id.clone(),
            title: "Skriv tekster".into(),
            due: Some(day() + chrono::Days::new(3)),
            estimate_minutes: Some(120),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        (task.status, task.estimate_minutes),
        (TaskStatus::Todo, Some(120))
    );
    assert_eq!(task.due, Some(day() + chrono::Days::new(3)));
    b.set_task_status(&task.id, TaskStatus::Done).unwrap();
    assert_eq!(b.tasks(Some(&p.id)).unwrap()[0].status, TaskStatus::Done);
    assert!(b.tasks(Some("anden")).unwrap().is_empty());
    let on_task = b
        .create_entry(EntryInput {
            task_id: Some(task.id.clone()),
            ..entry_input(&c.id, Some(&p.id), 60, "På opgaven")
        })
        .unwrap();
    assert_eq!(on_task.task_id.as_deref(), Some(task.id.as_str()));
    assert_eq!(b.tasks(None).unwrap()[0].logged_minutes, 60);
}

#[test]
fn lokal_kontrakt_timer_faktura_rapport() {
    let dir = tempfile::tempdir().unwrap();
    let clock = FakeClock::now();
    let b = local(dir.path(), Arc::new(NoDetection), Some(clock.clock()));
    let c = b.create_customer(customer_input("Timerkunden")).unwrap();
    let p = b
        .create_project(ProjectInput {
            customer_id: c.id.clone(),
            name: "Sag".into(),
            hourly_rate: None,
            budget_minutes: None,
        })
        .unwrap();
    let target = TimerTarget {
        customer_id: Some(c.id.clone()),
        project_id: Some(p.id.clone()),
        task_id: None,
        description: "Retter fejl".into(),
    };

    // Start, pause, genoptag
    assert_eq!(b.timer().unwrap().status, TimerStatus::Idle);
    assert!(matches!(b.timer_stop(), Err(BackendError::Conflict(m)) if m.contains("kører ikke")));
    assert!(matches!(b.timer_pause(), Err(BackendError::Conflict(_))));
    let started = b.timer_start(target.clone()).unwrap();
    assert_eq!(started.status, TimerStatus::Running);
    assert_eq!(started.customer_id.as_deref(), Some(c.id.as_str()));
    assert!(started.started_at.is_some());
    assert!(
        matches!(b.timer_start(target.clone()), Err(BackendError::Conflict(m)) if m.contains("kører allerede"))
    );
    clock.advance(1800);
    let paused = b.timer_pause().unwrap();
    assert_eq!(paused.status, TimerStatus::Paused);
    assert_eq!(paused.accumulated_secs, 1800);
    assert!(paused.version > started.version);
    clock.advance(600);
    let resumed = b.timer_resume().unwrap();
    assert_eq!(resumed.status, TimerStatus::Running);
    assert_eq!(resumed.accumulated_secs, 1800);

    // Mål: kan skiftes på den kørende timer, og tiden bevares
    assert_eq!(
        b.timer_set_target(target.clone()).unwrap().status,
        TimerStatus::Running
    );
    let moved = b
        .timer_set_target(TimerTarget {
            description: "Andet".into(),
            ..target.clone()
        })
        .unwrap();
    assert_eq!(moved.description, "Andet");
    let after = b.timer().unwrap();
    assert_eq!(
        (
            after.status,
            after.accumulated_secs,
            after.description.as_str()
        ),
        (TimerStatus::Running, 1800, "Andet")
    );
    b.timer_set_target(target.clone()).unwrap();

    // Stop gemmer en post: 30 min før pausen + 60 min efter
    clock.advance(3600);
    let saved = b.timer_stop().unwrap().expect("posten gemmes");
    assert_eq!(
        (saved.minutes, saved.customer_id.as_str()),
        (90, c.id.as_str())
    );
    assert_eq!(saved.description, "Retter fejl");
    assert_eq!(b.timer().unwrap().status, TimerStatus::Idle);

    // Kassér gemmer ingenting
    b.timer_start(target.clone()).unwrap();
    clock.advance(1200);
    b.timer_discard().unwrap();
    assert_eq!(b.timer().unwrap().status, TimerStatus::Idle);
    assert_eq!(b.entries(DateRange::day(day())).unwrap().len(), 1);
    // Under et minut gemmes ikke
    b.timer_start(target).unwrap();
    clock.advance(20);
    assert!(b.timer_stop().unwrap().is_none());

    // Faktura: kladde → rettet → udstedt → betalt
    let extra = b
        .create_entry(entry_input(&c.id, Some(&p.id), 30, "Ekstra"))
        .unwrap();
    let open = b.uninvoiced_entries(&c.id).unwrap();
    assert_eq!(open.len(), 2);
    let ids: Vec<Id> = open.iter().map(|e| e.id.clone()).collect();
    let draft = b.create_invoice_draft(&c.id, &ids).unwrap();
    assert_eq!(
        (draft.status, draft.number, draft.customer_id.as_str()),
        (InvoiceStatus::Draft, None, c.id.as_str())
    );
    assert_eq!(draft.lines.len(), 2);
    assert_eq!(draft.lines.iter().map(|l| l.minutes).sum::<u32>(), 120);
    assert!(
        draft
            .lines
            .iter()
            .all(|l| l.rate == 85_000 && l.entry_ids.len() == 1),
        "{:?}",
        draft.lines
    );
    // 120 minutter à 850 kr. = 1.700 kr. + 25 % moms
    assert_eq!(draft.subtotal(), 170_000);
    assert_eq!(draft.total(), 212_500);
    assert!(b.uninvoiced_entries(&c.id).unwrap().is_empty());
    assert!(
        matches!(
            b.create_invoice_draft(&c.id, &ids),
            Err(BackendError::Validation(_))
        ),
        "allerede faktureret"
    );

    let mut lines = draft.lines.clone();
    lines[0].description = "Rettet linje".into();
    let saved = b.update_invoice_lines(&draft.id, lines.clone()).unwrap();
    assert!(saved.lines.iter().any(|l| l.description == "Rettet linje"));
    // En linje med flere poster deles, hvis tiden går op; ellers afvises den.
    let merged = InvoiceLine {
        description: "Samlet".into(),
        minutes: 120,
        rate: 85_000,
        entry_ids: ids.clone(),
        stored: None,
    };
    let split = b
        .update_invoice_lines(&draft.id, vec![merged.clone()])
        .unwrap();
    assert_eq!(split.lines.len(), 2);
    assert_eq!(split.subtotal(), 170_000);
    let wrong = b
        .update_invoice_lines(
            &draft.id,
            vec![InvoiceLine {
                minutes: 100,
                ..merged
            }],
        )
        .unwrap_err();
    assert!(
        matches!(&wrong, BackendError::Validation(m) if m.contains("Samlet")),
        "{wrong:?}"
    );
    assert_eq!(
        b.invoices().unwrap()[0].lines.len(),
        2,
        "afvist rettelse ændrer intet"
    );

    // gendan: en lokal faktura kræver afsender, før den udstedes.
    let missing = b.send_invoice(&draft.id, None).unwrap_err();
    assert!(
        matches!(&missing, BackendError::Validation(m) if m.contains("CVR") && m.contains("Indstillinger → Faktura")),
        "{missing:?}"
    );
    assert_eq!(b.invoice_profile().unwrap().unwrap().next_number, 1);
    b.save_invoice_profile(InvoiceProfile {
        company_name: "Acme".into(),
        cvr: "39413892".into(),
        address: "Testvej 1, 8000 Aarhus C".into(),
        mobilepay: "12345".into(),
        number_prefix: "2026-".into(),
        next_number: 5,
        ..InvoiceProfile::default()
    })
    .unwrap();
    b.update_invoice_details(
        &draft.id,
        InvoiceDetails {
            title: Some("Webshop".into()),
            due: day() + chrono::Days::new(10),
            notes: Some("Tak".into()),
        },
    )
    .unwrap();

    let sent = b.send_invoice(&draft.id, None).unwrap();
    assert_eq!(sent.status, InvoiceStatus::Sent);
    assert!(sent.number.is_some(), "nummer tildeles ved udstedelse");
    assert_eq!(sent.number_label().as_deref(), Some("2026-5"));
    assert_eq!(sent.title.as_deref(), Some("Webshop"));
    assert_eq!(sent.notes.as_deref(), Some("Tak"));
    assert!(
        b.delete_invoice_draft(&draft.id).is_err(),
        "udstedt kan ikke slettes"
    );
    b.mark_invoice_paid(&draft.id, day()).unwrap();
    let all = b.invoices().unwrap();
    assert_eq!((all.len(), all[0].status), (1, InvoiceStatus::Paid));
    let _ = extra;

    // Rapport
    let r = b
        .report(DateRange::day(day()), ReportGrouping::Customer)
        .unwrap();
    assert_eq!(r.rows.len(), 1);
    assert_eq!((r.rows[0].minutes, r.rows[0].billable_minutes), (120, 120));
    assert_eq!(r.rows[0].amount, 170_000);
    let by_project = b
        .report(DateRange::day(day()), ReportGrouping::Project)
        .unwrap();
    assert_eq!(by_project.total_minutes(), 120);
}

/// Detektion, hvor `apply_settings` er langsom (AI-tilstanden "lokal
/// server" leder efter servere i op til ca. 0,6 s).
#[derive(Default)]
struct SlowApply {
    applied: StdMutex<u32>,
}

impl Detection for SlowApply {
    fn suggestions(&self, _: NaiveDate, _: &[Customer], _: &[Project]) -> Result<Vec<Suggestion>> {
        Ok(vec![])
    }
    fn entry_for(&self, _: &str, _: Option<&SuggestionCorrection>) -> Result<EntryInput> {
        Err(BackendError::NotFound("Forslaget".into()))
    }
    fn confirmed(&self, _: &str, _: Option<&SuggestionCorrection>, _: &str) {}
    fn reject(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn apply_settings(&self, _: &Settings) {
        std::thread::sleep(Duration::from_millis(3000));
        *self.applied.lock().unwrap() += 1;
    }
    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        Ok(vec![])
    }
    fn download_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn delete_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        Ok(vec![])
    }
    fn set_cloud_ai_key(&self, _: CloudAiProvider, _: String) -> Result<()> {
        Ok(())
    }
    fn remove_cloud_ai_key(&self, _: CloudAiProvider) -> Result<()> {
        Ok(())
    }
    fn permissions(&self) -> Result<Permissions> {
        Err(BackendError::NotFound("Tilladelser".into()))
    }
    fn request_permission(&self, _: Permission) -> Result<PermissionState> {
        Err(BackendError::NotFound("Tilladelser".into()))
    }
}

#[test]
fn opstart_venter_ikke_paa_detektionens_indstillinger() {
    let dir = tempfile::tempdir().unwrap();
    let det = Arc::new(SlowApply::default());
    let t0 = Instant::now();
    let _b = local(dir.path(), det.clone(), None);
    assert!(
        t0.elapsed() < Duration::from_millis(1500),
        "open ventede {:?} på apply_settings",
        t0.elapsed()
    );
    wait_until("indstillingerne sendes i baggrunden", || {
        *det.applied.lock().unwrap() == 1
    });
}

#[test]
fn lokal_kontrakt_indstillinger_licens_og_tilstand() {
    let dir = tempfile::tempdir().unwrap();
    let det = Arc::new(FakeDetection::default());
    let b = local(dir.path(), det.clone(), None);
    wait_until("indstillinger sendes til detektionen ved opstart", || {
        det.applied.lock().unwrap().len() == 1
    });

    // Indstillinger gemmes og læses igen, også efter genstart
    assert_eq!(b.settings().unwrap(), Settings::first_start());
    let mut s = Settings::defaults();
    s.tracking.idle_minutes = 12;
    s.tracking.repo_roots = vec!["~/kode æøå".into()];
    s.appearance = Appearance::Dark;
    s.language = Language::Nb;
    let saved = b.save_settings(s.clone()).unwrap();
    assert_eq!(saved, s);
    assert_eq!(det.applied.lock().unwrap().last().unwrap(), &s);
    let mut bad = s.clone();
    bad.tracking.idle_minutes = 0;
    assert!(matches!(
        b.save_settings(bad),
        Err(BackendError::Validation(_))
    ));
    assert_eq!(
        b.settings().unwrap(),
        s,
        "ugyldige indstillinger gemmes ikke"
    );
    assert_eq!(
        det.applied.lock().unwrap().len(),
        2,
        "og sendes ikke videre"
    );

    // Nøgler: gemmes i detektionen og huskes i indstillingerne
    b.set_cloud_ai_key(CloudAiProvider::Gemini, "hemmelig".into())
        .unwrap();
    assert_eq!(
        b.settings().unwrap().ai.cloud_keys,
        vec![CloudAiProvider::Gemini]
    );
    assert!(
        !std::fs::read_to_string(settings_file(dir.path()))
            .unwrap()
            .contains("hemmelig")
    );
    b.remove_cloud_ai_key(CloudAiProvider::Gemini).unwrap();
    assert!(b.settings().unwrap().ai.cloud_keys.is_empty());

    // Delegerede kald
    assert_eq!(b.ai_models().unwrap()[0].id, "m1");
    assert!(b.download_model("m1").is_ok());
    assert_eq!(
        b.permissions().unwrap().screen_recording,
        PermissionState::Denied
    );
    assert_eq!(
        b.request_permission(Permission::Accessibility).unwrap(),
        PermissionState::Granted
    );
    assert!(b.discover_ai_servers().unwrap().is_empty());

    // Licens: ingen → prøve → (aktivering mod licensserver)
    let acc = b.account().unwrap();
    assert_eq!(
        (acc.mode.clone(), acc.email.clone(), acc.plan.clone()),
        (Mode::Local, None, None)
    );
    assert_eq!(acc.license, None);
    assert!(
        acc.trial_available,
        "ingen prøve endnu: knappen i Konto vises"
    );
    let trial = b.start_trial().unwrap();
    assert_eq!(trial.kind, LicenseKind::Trial { days_left: 14 });
    assert!(b.start_trial().is_err());
    assert_eq!(b.account().unwrap().license, Some(trial));
    // En startet (eller udløbet) prøve kan ikke startes igen.
    assert!(!b.account().unwrap().trial_available);
    assert!(matches!(
        b.activate_license("nej"),
        Err(BackendError::Validation(_))
    ));

    let (url, server) = serve_license(
        200,
        r#"{"proof":{"license_key":"TT-AB12-CD34-EF56-9F2A","tier":"lifetime","devices_allowed":3,"issued_at":"2026-10-26T10:00:00Z"}}"#,
    );
    drop(b);
    let mut o = Options::for_tests(dir.path().to_path_buf(), Arc::new(NoDetection));
    o.license_url = url;
    let b = RepoBackend::open_with(o).unwrap();
    let lic = b.activate_license(" tt-ab12-cd34-ef56-9f2a ").unwrap();
    assert_eq!(
        (lic.kind, lic.key_hint.as_str()),
        (LicenseKind::Lifetime, "TT-…-9F2A")
    );
    assert!(
        server
            .join()
            .unwrap()
            .contains("\"licenseKey\":\"TT-AB12-CD34-EF56-9F2A\"")
    );
    assert_eq!(
        b.account().unwrap().license.unwrap().kind,
        LicenseKind::Lifetime
    );

    // Uden licensserver er intet aktiveret
    let dir2 = tempfile::tempdir().unwrap();
    let b2 = RepoBackend::local_for_tests(dir2.path());
    assert!(
        matches!(b2.activate_license("TT-AB12-CD34-EF56-9F2A"), Err(BackendError::Other(m)) if m.contains("licensserveren"))
    );
    assert_eq!(b2.account().unwrap().license, None);

    // Log ud i lokal tilstand er uden virkning; import kræver login
    assert!(b2.logout().is_ok());
    assert_eq!(b2.mode(), Mode::Local);
    assert!(
        matches!(b2.import_local_to_cloud(false), Err(BackendError::Validation(m)) if m.contains("Log ind"))
    );
    assert!(b2.begin_login().unwrap().url.contains("state="));
    assert!(matches!(
        RepoBackend::local_for_tests(tempfile::tempdir().unwrap().path()).complete_login("kode"),
        Err(BackendError::Validation(m)) if m.contains("ikke startet")
    ));
    assert_eq!(b2.pending_count(), 0);
    assert!(b2.is_online());
    assert_eq!(b2.sync_now().unwrap(), 0);

    // En ødelagt tilstandsfil stopper opstart i stedet for at gætte
    std::fs::write(dir2.path().join("state.json"), "{").unwrap();
    drop(b2);
    let e = RepoBackend::open_with(Options::for_tests(
        dir2.path().to_path_buf(),
        Arc::new(NoDetection),
    ))
    .err()
    .expect("fejler lukket");
    assert!(e.to_string().contains("beskadiget"), "{e}");
}

fn settings_file(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("settings.json")
}

fn serve_license(status: u16, body: &'static str) -> (String, std::thread::JoinHandle<String>) {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.server_addr().to_ip().unwrap());
    let h = std::thread::spawn(move || {
        let mut req = server.recv().unwrap();
        let mut got = String::new();
        std::io::Read::read_to_string(req.as_reader(), &mut got).unwrap();
        req.respond(tiny_http::Response::from_string(body).with_status_code(status))
            .unwrap();
        got
    });
    (url, h)
}

#[test]
fn detektionen_faar_kundedomaener_og_site_koblinger_fra_web() {
    let w = Cloud::new();
    let det = Arc::new(FakeDetection::default());
    let mut o = w.options();
    o.detection = det.clone();
    let b = RepoBackend::open_with(o).unwrap();
    b.login_with_token("tok-test").unwrap();
    // Web: en kunde med domæner og en bekræftet domæne-regel.
    let c = futures_lite::future::block_on(w.mock.repo().create_client(td::NewClient {
        name: "Bageriet".into(),
        domains: vec!["www.bageriet.dk".into()],
        ..Default::default()
    }))
    .unwrap();
    futures_lite::future::block_on(w.mock.repo().upsert_rule(td::MatchingRule {
        id: String::new(),
        kind: td::RuleKind::Domain,
        pattern: "figma.com".into(),
        project_id: None,
        client_id: Some(c.id.clone()),
        source: td::RuleSource::Learned,
        confirmations: 3,
        not_work: false,
        updated_at: None,
    }))
    .unwrap();
    b.suggestions(day()).unwrap();
    let web = det.web.lock().unwrap().clone().expect("kataloget er sat");
    assert_eq!(
        web.client_domains.get(&c.id),
        Some(&vec!["bageriet.dk".to_string()])
    );
    assert_eq!(web.site_mappings.len(), 1);
    assert_eq!(
        (
            web.site_mappings[0].domain.as_str(),
            web.site_mappings[0].usage_count
        ),
        ("figma.com", 3)
    );
}

#[test]
fn lokal_kontrakt_forslag_via_detektion() {
    let dir = tempfile::tempdir().unwrap();
    let det = Arc::new(FakeDetection::default());
    let b = local(dir.path(), det.clone(), None);
    let c = b.create_customer(customer_input("Forslagskunden")).unwrap();
    let archived = b.create_customer(customer_input("Gammel")).unwrap();
    b.set_customer_archived(&archived.id, true).unwrap();
    let p = b
        .create_project(ProjectInput {
            customer_id: c.id.clone(),
            name: "Sag".into(),
            hourly_rate: None,
            budget_minutes: None,
        })
        .unwrap();
    let suggestion = |id: &str, customer: &str, from: u32, to: u32| Suggestion {
        id: id.into(),
        date: day(),
        start: t(from, 0),
        end: t(to, 0),
        customer_id: Some(customer.into()),
        project_id: None,
        reason: format!("VS Code: {id}"),
        confidence: 0.9,
        task_id: None,
        task_title: None,
    };
    *det.suggestions.lock().unwrap() = vec![
        suggestion("s1", &c.id, 8, 9),
        suggestion("s2", &c.id, 10, 12),
        suggestion("s3", &c.id, 13, 14),
        suggestion("s4", &archived.id, 15, 16),
    ];

    let list = b.suggestions(day()).unwrap();
    assert_eq!(
        list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        ["s1", "s2", "s3"],
        "kun aktive kunder gives videre"
    );

    // Bekræft: post oprettet, derefter lært
    let e = b.confirm_suggestion("s1", None).unwrap();
    assert_eq!(
        (e.minutes, e.start, e.end),
        (60, Some(t(8, 0)), Some(t(9, 0)))
    );
    assert_eq!(e.description, "VS Code: s1");
    assert_eq!(det.confirmed.lock().unwrap()[0].0, "s1");
    assert_eq!(
        det.confirmed.lock().unwrap()[0].2,
        e.id,
        "detektionen får postens id"
    );

    // Ret: rettelsen lægges på posten og gives videre
    let corr = SuggestionCorrection {
        project_id: Some(p.id.clone()),
        description: Some("Rettet".into()),
        ..Default::default()
    };
    let e2 = b.confirm_suggestion("s2", Some(corr.clone())).unwrap();
    assert_eq!(
        (
            e2.project_id.as_deref(),
            e2.description.as_str(),
            e2.minutes
        ),
        (Some(p.id.as_str()), "Rettet", 120)
    );
    assert_eq!(det.confirmed.lock().unwrap()[1].1, Some(corr));

    // Afvis og bekræft dagen
    b.reject_suggestion("s3").unwrap();
    assert_eq!(det.rejected.lock().unwrap().as_slice(), ["s3"]);
    assert!(b.suggestions(day()).unwrap().is_empty());
    assert!(b.confirm_day(day()).unwrap().is_empty());
    *det.suggestions.lock().unwrap() = vec![
        suggestion("s5", &c.id, 16, 17),
        suggestion("s6", &c.id, 17, 18),
    ];
    let all = b.confirm_day(day()).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(b.entries(DateRange::day(day())).unwrap().len(), 4);
    assert!(matches!(
        b.confirm_suggestion("findes-ikke", None),
        Err(BackendError::NotFound(_))
    ));
    // Intet er oprettet af det forkerte kald
    assert_eq!(b.entries(DateRange::day(day())).unwrap().len(), 4);
}

#[test]
fn lokal_aendringer_giver_signal_og_tilstand_overlever_genstart() {
    let dir = tempfile::tempdir().unwrap();
    let b = RepoBackend::local_for_tests(dir.path());
    let changes = b.changes();
    drain(&changes);
    let c = b.create_customer(customer_input("Signal")).unwrap();
    wait_until("signal efter oprettelse", || !drain(&changes).is_empty());
    // Mange ændringer i træk slås sammen til højst ét ventende signal.
    for i in 0..5 {
        b.create_entry(entry_input(&c.id, None, 10 + i, "x"))
            .unwrap();
    }
    wait_until("signal efter poster", || changes.len() == 1);
    // Højst ét ventende signal (kanalen har plads til ét). `drain` tælles
    // ikke: repo'ets hændelsestråd kan nå at sende et sent signal imens.
    assert!(changes.len() <= 1);
    drain(&changes);
    drop(b);

    let again = RepoBackend::local_for_tests(dir.path());
    assert_eq!(again.mode(), Mode::Local);
    assert_eq!(
        again.customers(false).unwrap().len(),
        1,
        "databasen overlever genstart"
    );
    assert_eq!(again.entries(DateRange::day(day())).unwrap().len(), 5);
}

// ---------------------------------------------------------------- cloud-kontrakt

struct Cloud {
    mock: MockWeb,
    dir: tempfile::TempDir,
    secrets: Arc<td::MemorySecretStore>,
}

impl Cloud {
    fn new() -> Self {
        Cloud {
            mock: MockWeb::start("tok-test"),
            dir: tempfile::tempdir().unwrap(),
            secrets: Arc::new(td::MemorySecretStore::new()),
        }
    }

    fn options(&self) -> Options {
        let mut o = Options::for_tests(self.dir.path().to_path_buf(), Arc::new(NoDetection));
        o.web_url = self.mock.base_url().to_owned();
        o.secrets = self.secrets.clone();
        o
    }

    fn open(&self) -> RepoBackend {
        RepoBackend::open_with(self.options()).unwrap()
    }

    /// Fuldt browser-login: begin → godkend i "browseren" → deep link → kode.
    fn login_pkce(&self, b: &RepoBackend) -> Account {
        let start = b.begin_login().unwrap();
        let link = self.mock.approve_login(&start.url);
        let code = link
            .split("code=")
            .nth(1)
            .unwrap()
            .split('&')
            .next()
            .unwrap()
            .to_owned();
        assert!(link.contains(&format!("state={}", start.state)));
        b.complete_login(&code).unwrap()
    }
}

/// Loginet med kun koden (deep linket er pakket ud af `parse_auth_callback`)
/// skal bygge et link med udgavens eget skema; ellers afviser `verify_callback`
/// det i TimeWren. Kører for begge udgaver, og for TimeWren i CI (`brand_`).
#[test]
fn brand_login_med_kun_koden_bruger_udgavens_skema() {
    let w = Cloud::new();
    let b = w.open();
    w.login_pkce(&b);
    assert!(
        super::callback_url("kode", "st").starts_with(&format!(
            "{}://",
            tt_core::edition::EDITION.url_scheme
        ))
    );
}

#[test]
fn egen_server_vaelges_ved_login_og_huskes() {
    let w = Cloud::new();
    let b = w.open();
    // Standarden er udgavens server (her mock-serveren).
    assert_eq!(b.server_url().unwrap(), w.mock.base_url());
    // Klartekst-http til en fremmed vært afvises; adressen normaliseres.
    assert!(matches!(
        b.set_server_url(Some("http://time.example.com")),
        Err(BackendError::Validation(_))
    ));
    assert_eq!(
        b.set_server_url(Some(" Time.Example.com/ ")).unwrap(),
        "https://time.example.com"
    );
    assert!(
        b.begin_login()
            .unwrap()
            .url
            .starts_with("https://time.example.com/auth/device?")
    );
    // Valget ligger i state.json og overlever en genstart.
    let state = super::files::load_state(w.dir.path()).unwrap();
    assert_eq!(state.server_url.as_deref(), Some("https://time.example.com"));
    // Tomt felt eller standardadressen: tilbage til standarden.
    assert_eq!(b.set_server_url(Some("  ")).unwrap(), w.mock.base_url());
    assert_eq!(b.set_server_url(None).unwrap(), w.mock.base_url());
    assert!(b.begin_login().unwrap().url.starts_with(w.mock.base_url()));
    assert_eq!(super::files::load_state(w.dir.path()).unwrap().server_url, None);
}

#[test]
fn server_kan_ikke_skiftes_mens_man_er_logget_ind() {
    let w = Cloud::new();
    let b = w.open();
    w.login_pkce(&b);
    assert!(matches!(
        b.set_server_url(Some("https://time.example.com")),
        Err(BackendError::Validation(_))
    ));
    assert_eq!(b.server_url().unwrap(), w.mock.base_url());
}

#[test]
fn cloud_login_med_pkce_og_forkert_link() {
    let w = Cloud::new();
    let b = w.open();
    assert_eq!(b.mode(), Mode::Local);

    let start = b.begin_login().unwrap();
    assert!(start.url.starts_with(w.mock.base_url()), "{}", start.url);
    assert!(
        start.url.contains("/auth/device?"),
        "web's godkendelsesside: {}",
        start.url
    );
    assert!(start.url.contains("&challenge="), "PKCE");
    assert!(start.url.contains("kind=desktop"));
    assert!(start.url.contains(&format!("state={}", start.state)));

    // Et forfalsket link (forkert state) afvises og afbryder ikke loginet
    let forged = format!("{}?code=falsk&state=forkert", td::cloud::auth::redirect_uri());
    let err = b.complete_login(&forged).unwrap_err();
    assert!(
        matches!(&err, BackendError::Validation(m) if m.contains("Login")),
        "{err:?}"
    );
    assert_eq!(b.mode(), Mode::Local);
    assert!(w.secrets.load().is_none());

    // Det rigtige link virker bagefter
    let link = w.mock.approve_login(&start.url);
    let acc = b.complete_login(&link).unwrap();
    assert!(matches!(acc.mode, Mode::Cloud { .. }));
    assert!(acc.email.is_some(), "{acc:?}");
    assert!(acc.license.is_none());
    assert!(matches!(b.mode(), Mode::Cloud { .. }));
    assert!(w.secrets.load().is_some(), "token i nøgleringen");
    let state = std::fs::read_to_string(w.dir.path().join("state.json")).unwrap();
    assert!(state.contains("\"cloud\""), "{state}");
    assert!(!state.contains("tok"), "ingen hemmeligheder i state.json");
    assert!(!std::fs::read_dir(w.dir.path()).unwrap().any(|f| {
        let p = f.unwrap().path();
        p.extension().is_some_and(|e| e == "json")
            && std::fs::read_to_string(&p)
                .unwrap_or_default()
                .contains("accessToken")
    }));

    // Loginet er brugt: samme link kan ikke bruges igen
    assert!(b.complete_login(&link).is_err());
    assert!(b.is_online());
}

#[test]
fn cloud_fakturaliste_henter_alle_linjer_i_et_kald() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Fakturakunde")).unwrap();
    let mut ids = vec![];
    for n in 0..3 {
        let e = b
            .create_entry(entry_input(&c.id, None, 60, &format!("Arbejde {n}")))
            .unwrap();
        let inv = b
            .create_invoice_draft(&c.id, std::slice::from_ref(&e.id))
            .unwrap();
        // Kladden fra web har én linje pr. post med det samme.
        assert_eq!((inv.lines_loaded, inv.lines.len()), (true, 1));
        ids.push(inv.id);
    }
    // Listen: linjerne for alle fakturaer i ét kald (linesByInvoice), ingen
    // linjekald pr. faktura (N+1).
    let (before, batch) = (
        w.mock.calls("extension.invoices.lines"),
        w.mock.calls("extension.invoices.linesByInvoice"),
    );
    let list = b.invoices().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(
        w.mock.calls("extension.invoices.lines"),
        before,
        "ingen linjekald pr. faktura"
    );
    assert_eq!(w.mock.calls("extension.invoices.linesByInvoice"), batch + 1);
    assert!(
        list.iter()
            .all(|i| i.lines_loaded && i.lines.len() == 1 && i.subtotal() > 0)
    );
    let full = b.invoice(&ids[0]).unwrap();
    assert_eq!(
        full.subtotal(),
        list.iter().find(|i| i.id == ids[0]).unwrap().subtotal()
    );
}

#[test]
fn cloud_fakturaliste_uden_linesbyinvoice_viser_webs_beloeb() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    // En server uden linesByInvoice: listen vises med web's beløb, og
    // linjerne hentes ved åbning.
    w.mock.hide_procedure("extension.invoices.linesByInvoice");
    let c = b.create_customer(customer_input("Fakturakunde")).unwrap();
    let e = b
        .create_entry(entry_input(&c.id, None, 60, "Arbejde"))
        .unwrap();
    let inv = b
        .create_invoice_draft(&c.id, std::slice::from_ref(&e.id))
        .unwrap();
    let list = b.invoices().unwrap();
    assert!(list.iter().all(|i| !i.lines_loaded && i.subtotal() > 0));
    assert!(b.invoice(&inv.id).unwrap().lines_loaded);
}

/// Cloud's "Gem PDF" og moms: web's PDF-bytes og web's tal hele vejen fra
/// `RepoBackend` til mock-web. Lokalt `None`, så appen regner og tegner selv.
#[test]
fn cloud_pdf_og_moms_fra_web() {
    let w = Cloud::new();
    let b = w.open();
    assert_eq!(b.web_invoice_totals("x").unwrap(), None, "lokalt regner appen selv");
    assert_eq!(b.web_invoice_pdf("x").unwrap(), None);
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Fakturakunde")).unwrap();
    let e = b.create_entry(entry_input(&c.id, None, 60, "Arbejde")).unwrap();
    let inv = b.create_invoice_draft(&c.id, std::slice::from_ref(&e.id)).unwrap();

    w.mock.set_vat_registered(true);
    let t = b.web_invoice_totals(&inv.id).unwrap().expect("web's tal");
    assert!(t.show_vat && t.subtotal > 0);
    assert_eq!((t.vat, t.total, t.vat_permille), (t.subtotal / 4, t.subtotal + t.subtotal / 4, 250));
    assert_eq!(b.web_invoice_pdf(&inv.id).unwrap(), Some(MockWeb::invoice_pdf(&inv.id)));

    w.mock.set_pdf_status(Some(403));
    let err = b.web_invoice_pdf(&inv.id).unwrap_err().to_string();
    assert!(err.contains("fakturaer er slået fra i web"), "{err}");
    w.mock.set_pdf_status(None);

    w.mock.set_offline(true);
    let err = b.web_invoice_pdf(&inv.id).unwrap_err().to_string();
    assert!(err.starts_with("Ingen forbindelse til"), "{err}");
    let err = b.web_invoice_totals(&inv.id).unwrap_err().to_string();
    assert!(err.contains("Momsen og totalen hentes fra web"), "{err}");
}

/// Sagen fra 17/11: en faktura gik som mail til kunden uden en tydelig
/// bekræftelse. Fra oprettelse til afsendelse: kladden sender intet, og
/// afsendelsen kræver den modtager, brugeren bekræftede. (Kun mock-web:
/// der sendes aldrig noget til en rigtig kunde.)
/// Web's "Send påmindelse" (samme `sendEmail`) og `markPaid` med dato.
#[test]
fn cloud_paamindelse_og_betalingsdato() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Fakturakunde")).unwrap();
    let e = b.create_entry(entry_input(&c.id, None, 90, "Arbejde")).unwrap();
    let draft = b.create_invoice_draft(&c.id, std::slice::from_ref(&e.id)).unwrap();
    // En kladde får ingen påmindelse.
    assert!(b.send_reminder(&draft.id, Some("kontakt@example.dk")).is_err());
    b.send_invoice(&draft.id, Some("kontakt@example.dk")).unwrap();
    assert_eq!(w.mock.calls("extension.invoices.send"), 1);

    // Uden bekræftet modtager: ingen mail.
    let none = b.send_reminder(&draft.id, None).unwrap_err();
    assert!(matches!(&none, BackendError::Validation(m) if m.contains("bekræftet")), "{none:?}");
    assert_eq!(w.mock.calls("extension.invoices.send"), 1);
    let again = b.send_reminder(&draft.id, Some("kontakt@example.dk")).unwrap();
    assert_eq!(w.mock.calls("extension.invoices.send"), 2, "påmindelsen er en mail mere");
    assert_eq!(again.status, InvoiceStatus::Sent, "status ændres ikke");
    assert_eq!(again.delivery.and_then(|d| d.to).as_deref(), Some("kontakt@example.dk"));

    // Betalingsdatoen sendes til web (før: aldrig nogen dato).
    let paid = day() - chrono::Days::new(3);
    b.mark_invoice_paid(&draft.id, paid).unwrap();
    let sent = w.mock.last_input("extension.invoices.markPaid").unwrap();
    assert_eq!(sent["paidDate"], json!(paid.format("%Y-%m-%d").to_string()));
    assert_eq!(b.invoice(&draft.id).unwrap().status, InvoiceStatus::Paid);
    // En betalt faktura får ingen påmindelse.
    assert!(b.send_reminder(&draft.id, Some("kontakt@example.dk")).is_err());
}

#[test]
fn cloud_faktura_sendes_kun_efter_bekraeftet_modtager() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Fakturakunde")).unwrap();
    let e = b
        .create_entry(entry_input(&c.id, None, 90, "Arbejde"))
        .unwrap();

    // Kladde først: oprettelsen sender ingen mail.
    let draft = b
        .create_invoice_draft(&c.id, std::slice::from_ref(&e.id))
        .unwrap();
    assert_eq!(draft.status, InvoiceStatus::Draft);
    assert_eq!(draft.delivery, None);
    assert_eq!(w.mock.calls("extension.invoices.send"), 0);

    // Det, dialogen viser: modtager, kunde, poster, timer og beløb inkl. moms.
    let p = b.invoice_send_preview(&draft.id).unwrap();
    assert!(p.sends_mail);
    assert_eq!(p.recipient.as_deref(), Some("kontakt@example.dk"));
    assert_eq!(p.customer_name, "Fakturakunde");
    assert_eq!((p.entry_count, p.minutes), (1, 90));
    assert_eq!(p.total, draft.total());

    // Uden bekræftelse, eller med en anden modtager, sker der intet.
    let none = b.send_invoice(&draft.id, None).unwrap_err();
    assert!(
        matches!(&none, BackendError::Validation(m) if m.contains("bekræftet")),
        "{none:?}"
    );
    let wrong = b
        .send_invoice(&draft.id, Some("anden@example.dk"))
        .unwrap_err();
    assert!(
        matches!(&wrong, BackendError::Validation(m) if m.contains("ændret")),
        "{wrong:?}"
    );
    assert_eq!(
        w.mock.calls("extension.invoices.send"),
        0,
        "ingen mail uden bekræftelse"
    );
    assert_eq!(b.invoice(&draft.id).unwrap().status, InvoiceStatus::Draft);

    // Bekræftet: mailen går, status følger, og tidspunkt og modtager huskes.
    let sent = b
        .send_invoice(&draft.id, Some("Kontakt@Example.dk "))
        .unwrap();
    assert_eq!(w.mock.calls("extension.invoices.send"), 1);
    assert_eq!(sent.status, InvoiceStatus::Sent);
    let delivery = sent.delivery.clone().expect("afsendelsen er husket");
    assert_eq!(delivery.to.as_deref(), Some("kontakt@example.dk"));
    let listed = b
        .invoices()
        .unwrap()
        .into_iter()
        .find(|i| i.id == draft.id)
        .unwrap();
    assert_eq!(listed.delivery, Some(delivery.clone()));
    // Overlever en genstart af appen.
    drop(b);
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    assert_eq!(b.invoice(&draft.id).unwrap().delivery, Some(delivery));

    // En faktura, der allerede er sendt, sendes ikke en gang til.
    let again = b
        .send_invoice(&draft.id, Some("kontakt@example.dk"))
        .unwrap_err();
    assert!(
        matches!(&again, BackendError::Validation(m) if m.contains("allerede")),
        "{again:?}"
    );
    assert_eq!(w.mock.calls("extension.invoices.send"), 1);
}

#[test]
fn cloud_kunde_uden_mail_kan_ikke_faa_fakturaen_sendt() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b
        .create_customer(CustomerInput {
            email: None,
            ..customer_input("Uden mail")
        })
        .unwrap();
    let e = b
        .create_entry(entry_input(&c.id, None, 60, "Arbejde"))
        .unwrap();
    let draft = b
        .create_invoice_draft(&c.id, std::slice::from_ref(&e.id))
        .unwrap();
    assert_eq!(b.invoice_send_preview(&draft.id).unwrap().recipient, None);
    for confirmed in [None, Some("noget@example.dk")] {
        let err = b.send_invoice(&draft.id, confirmed).unwrap_err();
        assert!(
            matches!(&err, BackendError::Validation(m) if m.contains("mailadresse")),
            "{err:?}"
        );
    }
    assert_eq!(w.mock.calls("extension.invoices.send"), 0);
}

#[test]
fn cloud_kladde_kan_udstedes_uden_mail_og_slettes() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Fakturakunde")).unwrap();
    let mk = |desc: &str| {
        let e = b.create_entry(entry_input(&c.id, None, 60, desc)).unwrap();
        b.create_invoice_draft(&c.id, std::slice::from_ref(&e.id))
            .unwrap()
    };

    // "Markér som sendt": nummer og status, men ingen mail.
    let a = mk("Design");
    let issued = b.issue_invoice(&a.id).unwrap();
    assert_eq!(issued.status, InvoiceStatus::Sent);
    assert!(issued.number.is_some());
    assert_eq!(issued.delivery.as_ref().map(|d| d.to.clone()), Some(None));
    assert_eq!(w.mock.calls("extension.invoices.send"), 0);

    // Fortryd: kladden slettes, og posten kan faktureres igen.
    let d = mk("Kode");
    assert!(b.uninvoiced_entries(&c.id).unwrap().is_empty());
    b.delete_invoice_draft(&d.id).unwrap();
    assert_eq!(b.uninvoiced_entries(&c.id).unwrap().len(), 1);
    assert!(b.invoices().unwrap().iter().all(|i| i.id != d.id));
    // En udstedt faktura kan ikke slettes.
    assert!(b.delete_invoice_draft(&a.id).is_err());
}

/// Web uden `invoices.delete` i device-API'et: en klar besked, og intet ændres.
#[test]
fn cloud_sletning_af_kladde_uden_server_support_giver_besked() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    w.mock.hide_procedure("extension.invoices.delete");
    let c = b.create_customer(customer_input("Fakturakunde")).unwrap();
    let e = b
        .create_entry(entry_input(&c.id, None, 60, "Arbejde"))
        .unwrap();
    let draft = b
        .create_invoice_draft(&c.id, std::slice::from_ref(&e.id))
        .unwrap();
    let err = b.delete_invoice_draft(&draft.id).unwrap_err();
    assert!(err.to_string().contains("understøtter ikke"), "{err}");
    assert_eq!(b.invoice(&draft.id).unwrap().status, InvoiceStatus::Draft);
}

#[test]
fn cloud_kontrakt_poster_kunder_og_web_aendringer() {
    let w = Cloud::new();
    let b = w.open();
    let acc = b.login_with_token("tok-test").unwrap();
    assert!(matches!(acc.mode, Mode::Cloud { .. }));
    let changes = b.changes();
    drain(&changes);

    let c = b.create_customer(customer_input("Skykunden")).unwrap();
    assert_eq!(
        (c.cvr.as_deref(), c.hourly_rate),
        (Some("12345678"), Some(85_000))
    );
    let p = b
        .create_project(ProjectInput {
            customer_id: c.id.clone(),
            name: "Sky".into(),
            hourly_rate: None,
            budget_minutes: Some(600),
        })
        .unwrap();
    assert_eq!(p.budget_minutes, Some(600));
    let e = b
        .create_entry(EntryInput {
            start: Some(t(9, 0)),
            end: Some(t(10, 30)),
            minutes: 90,
            ..entry_input(&c.id, Some(&p.id), 90, "Sky-arbejde")
        })
        .unwrap();
    assert_eq!(
        (e.minutes, e.start, e.end, e.customer_id.as_str()),
        (90, Some(t(9, 0)), Some(t(10, 30)), c.id.as_str())
    );
    let read = b.entries(DateRange::day(day())).unwrap();
    assert_eq!(read.len(), 1);
    assert_eq!(read[0].description, "Sky-arbejde");
    // Serveren har posten
    let on_server =
        futures_lite::future::block_on(w.mock.repo().list_entries(EntryFilter::default())).unwrap();
    assert_eq!(on_server.len(), 1);
    assert_eq!(on_server[0].description.as_deref(), Some("Sky-arbejde"));

    // Tidspunktet kan fjernes (web's time.update med startTime/endTime: null).
    let untimed = b
        .update_entry(&e.id, entry_input(&c.id, Some(&p.id), 60, "Rettet"))
        .unwrap();
    assert_eq!(
        (untimed.start, untimed.end, untimed.minutes),
        (None, None, 60)
    );
    let on_server = futures_lite::future::block_on(w.mock.repo().get_entry(&e.id)).unwrap();
    assert_eq!(
        (on_server.start_time, on_server.end_time),
        (None, None),
        "ryddet på serveren"
    );
    let edited = b
        .update_entry(
            &e.id,
            EntryInput {
                start: Some(t(9, 0)),
                end: Some(t(10, 0)),
                ..entry_input(&c.id, Some(&p.id), 60, "Rettet")
            },
        )
        .unwrap();
    assert_eq!(
        (edited.minutes, edited.start, edited.description.as_str()),
        (60, Some(t(9, 0)), "Rettet")
    );
    assert_eq!(
        edited.project_id.as_deref(),
        Some(p.id.as_str()),
        "web's PUT må ikke tabe projektet"
    );
    b.delete_entry(&e.id).unwrap();
    assert!(b.entries(DateRange::day(day())).unwrap().is_empty());

    // Klippekort og auto-træk sker på serveren
    let card = b
        .create_punch_card(PunchCardInput {
            customer_id: c.id.clone(),
            name: "5 timer".into(),
            total_minutes: 300,
            price: 250_000,
            expires: None,
        })
        .unwrap();
    assert_eq!(card.total_minutes, 300);
    b.create_entry_with_card(
        entry_input(&c.id, None, 60, "Med kort"),
        CardChoice::Card(card.id.clone()),
    )
    .unwrap();
    assert_eq!(b.punch_cards(Some(&c.id)).unwrap()[0].used_minutes, 60);
    // Automatisk valg: web vælger ikke selv, så desktop sender kortet med.
    b.create_entry_with_card(entry_input(&c.id, None, 30, "Auto"), CardChoice::Auto)
        .unwrap();
    assert_eq!(
        w.mock.last_input("extension.entries.create").unwrap()["data"]["prepaidPackageId"],
        json!(card.id)
    );
    assert_eq!(b.punch_cards(Some(&c.id)).unwrap()[0].used_minutes, 90);
    b.create_entry_with_card(entry_input(&c.id, None, 15, "Uden kort"), CardChoice::None)
        .unwrap();
    let sent = w.mock.last_input("extension.entries.create").unwrap();
    assert!(sent["data"].get("prepaidPackageId").is_none());
    assert_eq!(
        sent["data"]["noPrepaid"],
        json!(true),
        "intet kort siges udtrykkeligt til web"
    );
    assert_eq!(b.punch_cards(Some(&c.id)).unwrap()[0].used_minutes, 90);

    // Timer i cloud
    let t0 = b
        .timer_start(TimerTarget {
            customer_id: Some(c.id.clone()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(t0.status, TimerStatus::Running);
    assert_eq!(
        b.timer().unwrap().customer_id.as_deref(),
        Some(c.id.as_str())
    );
    b.timer_discard().unwrap();
    assert_eq!(b.timer().unwrap().status, TimerStatus::Idle);

    // En ændring fra web giver et signal og er synlig
    drain(&changes);
    w.mock.web_create_client("Webkunden");
    wait_until("signal fra web", || !drain(&changes).is_empty());
    wait_until("kunden fra web", || {
        b.customers(false)
            .unwrap()
            .iter()
            .any(|c| c.name == "Webkunden")
    });

    // Offline: fejlen er dansk og kassen går ikke i stykker
    w.mock.set_offline(true);
    let err = b.create_customer(customer_input("Offline")).unwrap_err();
    assert_eq!(err, BackendError::Offline);
    w.mock.set_offline(false);
}

#[test]
fn cloud_import_dry_run_og_rigtig_import() {
    let w = Cloud::new();
    let b = w.open();
    // Data lavet lokalt, før man logger ind
    let c = b.create_customer(customer_input("Lokal kunde")).unwrap();
    let p = b
        .create_project(ProjectInput {
            customer_id: c.id.clone(),
            name: "Lokalt projekt".into(),
            hourly_rate: None,
            budget_minutes: None,
        })
        .unwrap();
    b.create_entry(entry_input(&c.id, Some(&p.id), 45, "Lokalt arbejde"))
        .unwrap();
    b.create_entry(entry_input(&c.id, None, 30, "Mere lokalt"))
        .unwrap();

    // Dry-run uden login: kun lokal rapport
    let local_only = b.import_local_to_cloud(true).unwrap();
    assert!(local_only.dry_run);
    assert_eq!(
        (
            local_only.customers,
            local_only.projects,
            local_only.entries
        ),
        (1, 1, 2)
    );
    assert!(b.imported_at().is_none());

    w.login_pkce(&b);
    assert!(
        b.customers(false).unwrap().is_empty(),
        "cloud er en anden konto-database end den lokale"
    );

    let dry = b.import_local_to_cloud(true).unwrap();
    assert!(dry.dry_run);
    assert_eq!(
        (dry.customers, dry.projects, dry.entries, dry.skipped),
        (1, 1, 2, 0),
        "{dry:?}"
    );
    assert!(
        futures_lite::future::block_on(w.mock.repo().list_clients(true))
            .unwrap()
            .is_empty(),
        "dry-run ændrer intet"
    );
    assert!(b.imported_at().is_none());

    let done = b.import_local_to_cloud(false).unwrap();
    assert!(!done.dry_run);
    assert_eq!(
        (done.customers, done.projects, done.entries),
        (1, 1, 2),
        "{done:?}"
    );
    let clients = futures_lite::future::block_on(w.mock.repo().list_clients(true)).unwrap();
    assert_eq!(clients.len(), 1);
    assert_eq!(clients[0].name, "Lokal kunde");
    assert!(b.imported_at().is_some());
    wait_until("cloud viser importerede kunder", || {
        b.customers(false).unwrap().len() == 1
    });
    assert_eq!(b.entries(DateRange::day(day())).unwrap().len(), 2);

    // Samme import igen er idempotent
    let again = b.import_local_to_cloud(false).unwrap();
    assert_eq!((again.customers, again.entries), (0, 0), "{again:?}");
    assert!(again.skipped >= 4, "{again:?}");
    assert_eq!(
        futures_lite::future::block_on(w.mock.repo().list_clients(true))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn cloud_logud_tilbage_til_lokal_og_genstart() {
    let w = Cloud::new();
    let b = w.open();
    let local_customer = b.create_customer(customer_input("Bliver lokal")).unwrap();
    w.login_pkce(&b);
    let cloud_customer = b.create_customer(customer_input("Kun i cloud")).unwrap();
    assert!(
        b.customers(false)
            .unwrap()
            .iter()
            .all(|c| c.id != local_customer.id)
    );
    drop(b);

    // Genstart: tilstanden og loginet huskes
    let b = w.open();
    assert!(matches!(b.mode(), Mode::Cloud { .. }));
    assert_eq!(b.account().unwrap().mode, b.mode());
    assert!(
        b.customers(false)
            .unwrap()
            .iter()
            .any(|c| c.id == cloud_customer.id)
    );
    let changes = b.changes();
    drain(&changes);

    // Logud: tilbage til den lokale database, og loginet er væk
    b.logout().unwrap();
    assert_eq!(b.mode(), Mode::Local);
    assert!(w.secrets.load().is_none(), "token slettet fra nøgleringen");
    assert!(!changes.is_empty(), "signal ved logud");
    let names: Vec<String> = b
        .customers(false)
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(names, ["Bliver lokal"]);
    assert!(
        std::fs::read_to_string(w.dir.path().join("state.json"))
            .unwrap()
            .contains("\"local\"")
    );
    drop(b);
    assert_eq!(
        w.open().mode(),
        Mode::Local,
        "efter genstart er den stadig lokal"
    );
}

#[test]
fn cloud_tilbagekaldt_enhed_giver_besked_og_lokal_tilstand() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let notices = b.notices();
    drain(&notices);
    wait_until("strømmen er oppe", || w.mock.open_streams() > 0);

    w.mock.publish_revoked();
    wait_until("lokal efter tilbagekaldelse", || b.mode() == Mode::Local);
    let got = drain(&notices);
    assert!(
        got.iter()
            .any(|n| n.kind == NoticeKind::LoggedOut && n.text.contains("fjernet fra din konto")),
        "{got:?}"
    );
    assert!(w.secrets.load().is_none());
    // Appen virker videre lokalt
    assert!(b.create_customer(customer_input("Efter logud")).is_ok());

    // Et udløbet token ved opstart giver også lokal tilstand med besked
    let w2 = Cloud::new();
    let b2 = w2.open();
    b2.login_with_token("tok-test").unwrap();
    drop(b2);
    w2.secrets.clear();
    let b3 = w2.open();
    assert_eq!(b3.mode(), Mode::Local);
    assert!(
        drain(&b3.notices())
            .iter()
            .any(|n| n.kind == NoticeKind::LoggedOut)
    );
    assert!(matches!(
        b3.import_local_to_cloud(false),
        Err(BackendError::Validation(_))
    ));
}

#[test]
fn cloud_forkert_token_giver_dansk_fejl() {
    let w = Cloud::new();
    let b = w.open();
    let err = b.login_with_token("forkert").unwrap_err();
    assert!(
        matches!(
            err,
            BackendError::Unauthorized | BackendError::Validation(_)
        ),
        "{err:?}"
    );
    assert_eq!(b.mode(), Mode::Local);
    assert!(!err.to_string().is_empty());
    // jf. tt-data: web afviser et ukendt token som "ikke logget ind"
    let _ = Local.timestamp_opt(0, 0);
}

// ---------------------------------------------------------------- licens og adgang

fn manual_clock(at: DateTime<Utc>) -> (Arc<crate::ur::ManualClock>, td::Clock) {
    let m = Arc::new(crate::ur::ManualClock::new(at));
    let m2 = m.clone();
    let c: td::Clock = Arc::new(move || crate::ur::Clock::now(&*m2));
    (m, c)
}

#[cfg(not(feature = "mas"))]
fn enforcing_local(dir: &std::path::Path, clock: td::Clock) -> RepoBackend {
    let mut o = Options::for_tests(dir.to_path_buf(), Arc::new(NoDetection));
    o.clock = Some(clock);
    o.enforce_license = true;
    RepoBackend::open_with(o).unwrap()
}

/// App Store-udgaven: gratis til personlig brug. Uden licensfil, og med en
/// udløbet prøve fra før, er intet låst; erhvervslicensen er et in-app-køb,
/// der kun vises (`store.rs`).
#[cfg(feature = "mas")]
#[test]
fn mas_lokal_er_aldrig_laast() {
    let dir = tempfile::tempdir().unwrap();
    let (m, clock) = manual_clock(Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap());
    let mut o = Options::for_tests(dir.path().to_path_buf(), Arc::new(NoDetection));
    o.clock = Some(clock);
    o.enforce_license = true;
    let b = RepoBackend::open_with(o).unwrap();
    assert_eq!(b.access(), Access::Full);
    b.create_customer(customer_input("Ny kunde")).unwrap();
    b.start_trial().unwrap();
    m.advance(chrono::Duration::days(30));
    assert_eq!(b.access(), Access::Full, "en udløbet prøve låser heller ikke");
    assert_eq!(b.refresh_access(), Access::Full);
    b.timer_start(TimerTarget::default()).unwrap();
}

#[cfg(not(feature = "mas"))]
#[test]
fn lokal_uden_licens_er_laast_men_data_kan_ses_og_eksporteres() {
    let dir = tempfile::tempdir().unwrap();
    let (_m, clock) = manual_clock(Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap());
    let b = enforcing_local(dir.path(), clock);
    assert_eq!(b.access(), Access::Locked(LockReason::NoLicense));

    let err = b.create_customer(customer_input("Ny kunde")).unwrap_err();
    assert!(
        matches!(&err, BackendError::PlanLimit(m) if m.contains("bevaret")),
        "{err:?}"
    );
    assert!(matches!(
        b.timer_start(TimerTarget::default()),
        Err(BackendError::PlanLimit(_))
    ));
    // Læsning virker
    assert!(b.customers(true).unwrap().is_empty());
    assert!(b.entries(DateRange::day(b.today())).unwrap().is_empty());
    // En prøve låser op
    b.start_trial().unwrap();
    assert!(matches!(b.access(), Access::Trial { days_left: 14 }));
    b.create_customer(customer_input("Ny kunde")).unwrap();
}

#[cfg(not(feature = "mas"))]
#[test]
fn udloebet_proeve_laaser_ikke_midt_i_en_koerende_timer() {
    let dir = tempfile::tempdir().unwrap();
    let (m, clock) = manual_clock(Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap());
    let b = enforcing_local(dir.path(), clock);
    b.start_trial().unwrap();
    let c = b.create_customer(customer_input("Bageriet")).unwrap();
    let before = b
        .create_entry(entry_input(&c.id, None, 60, "Før udløb"))
        .unwrap();
    let p = b
        .create_project(ProjectInput {
            customer_id: c.id.clone(),
            name: "Webshop".into(),
            hourly_rate: None,
            budget_minutes: None,
        })
        .unwrap();
    let task_input = TaskInput {
        project_id: p.id.clone(),
        title: "Forside".into(),
        due: None,
        estimate_minutes: None,
        ..Default::default()
    };
    let task = b.create_task(task_input.clone()).unwrap();
    let card_input = PunchCardInput {
        customer_id: c.id.clone(),
        name: "Kort".into(),
        total_minutes: 600,
        price: 600_000,
        expires: None,
    };
    let card = b.create_punch_card(card_input.clone()).unwrap();
    b.timer_start(TimerTarget {
        customer_id: Some(c.id.clone()),
        ..Default::default()
    })
    .unwrap();

    // Prøven udløber, mens timeren kører
    m.advance(chrono::Duration::days(15));
    assert_eq!(b.access(), Access::Locked(LockReason::TrialExpired));
    assert_eq!(
        b.timer().unwrap().status,
        TimerStatus::Running,
        "timeren røres ikke"
    );
    // Den kan pauses, genoptages og stoppes
    b.timer_pause().unwrap();
    b.timer_resume().unwrap();
    b.timer_stop().unwrap();
    // ... men ingen ny timer og ingen nye poster
    assert!(matches!(
        b.timer_start(TimerTarget::default()),
        Err(BackendError::PlanLimit(_))
    ));
    assert!(matches!(
        b.create_entry(entry_input(&c.id, None, 30, "Efter udløb")),
        Err(BackendError::PlanLimit(_))
    ));
    // ... og ingen rettelser af klippekort og opgaver
    assert!(matches!(
        b.update_punch_card(&card.id, card_input),
        Err(BackendError::PlanLimit(_))
    ));
    assert!(matches!(
        b.top_up_punch_card(&card.id, 600),
        Err(BackendError::PlanLimit(_))
    ));
    assert!(matches!(
        b.update_task(&task.id, task_input),
        Err(BackendError::PlanLimit(_))
    ));
    // Tid, der allerede er registreret, kan altid ses
    let all = b.entries(DateRange::day(day())).unwrap();
    assert!(all.iter().any(|e| e.id == before.id));
    // Licensen aktiveres → låst op igen (data uændrede)
    let mut file = files::load_license(dir.path()).unwrap();
    file.lifetime = Some(files::Lifetime {
        key: "TT-AB12-CD34-EF56-9F2A".into(),
        activated_at: crate::ur::Clock::now(&*m),
    });
    files::write_json(&files::license_path(dir.path()), &file).unwrap();
    assert_eq!(b.access(), Access::Full);
    b.create_entry(entry_input(&c.id, None, 30, "Efter licens"))
        .unwrap();
}

#[test]
fn cloud_offline_respit_overlever_genstart_og_udloeber_efter_14_dage() {
    let w = Cloud::new();
    let (m, clock) = manual_clock(Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap());
    let mut o = w.options();
    o.clock = Some(clock.clone());
    o.enforce_license = true;
    let b = RepoBackend::open_with(o).unwrap();
    b.login_with_token("tok-test").unwrap();
    assert_eq!(b.refresh_access(), Access::Full);
    let c = b.create_customer(customer_input("Cloud-kunde")).unwrap();

    // Web forsvinder
    w.mock.set_offline(true);
    m.advance(chrono::Duration::days(3));
    assert!(matches!(
        b.refresh_access(),
        Access::OfflineGrace { days_left: 11, .. }
    ));
    b.create_entry(entry_input(&c.id, None, 15, "Offline"))
        .unwrap();
    drop(b);

    // Genstart i respiten: cachen på disken bruges
    let mut o = w.options();
    o.clock = Some(clock.clone());
    o.enforce_license = true;
    let b = RepoBackend::open_with(o).unwrap();
    m.advance(chrono::Duration::days(12));
    assert!(matches!(
        b.refresh_access(),
        Access::Locked(LockReason::OfflineGraceExpired { .. })
    ));
    // Lokale data bevares (cachen og køen slettes ikke), men der kan ikke oprettes nyt
    assert!(w.dir.path().join("cache.db").exists());
    assert!(matches!(
        b.create_entry(entry_input(&c.id, None, 15, "Efter respit")),
        Err(BackendError::PlanLimit(_))
    ));
    // Online igen → låst op
    w.mock.set_offline(false);
    assert_eq!(b.refresh_access(), Access::Full);
}

/// Har appen set en dato langt fremme (uret var forkert), må "Start prøve"
/// give en fejl, ikke få appen til at gå ned.
#[test]
fn proeve_efter_et_ur_der_var_foran_giver_fejl_ikke_panik() {
    let dir = tempfile::tempdir().unwrap();
    let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 27).unwrap();
    files::touch_last_seen(dir.path(), today + chrono::Duration::days(20)).unwrap();
    assert!(matches!(
        files::start_trial(dir.path(), today),
        Err(BackendError::Validation(_))
    ));
}

/// Et ur, der én gang gik en måned for langt frem, må ikke låse en betalende
/// bruger, næste gang den er offline, når serveren siden har bekræftet planen.
#[test]
fn cloud_ur_der_sprang_frem_laaser_ikke_efter_ny_bekraeftelse() {
    let w = Cloud::new();
    let (m, clock) = manual_clock(Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap());
    let mut o = w.options();
    o.clock = Some(clock.clone());
    o.enforce_license = true;
    let b = RepoBackend::open_with(o).unwrap();
    b.login_with_token("tok-test").unwrap();
    m.advance(chrono::Duration::days(30));
    assert_eq!(b.refresh_access(), Access::Full);
    // Uret rettes; serveren bekræfter planen igen.
    m.advance(chrono::Duration::days(-29));
    assert_eq!(b.refresh_access(), Access::Full);
    let now = Utc.with_ymd_and_hms(2026, 10, 2, 9, 0, 0).unwrap();
    let cache = files::load_entitlement_cache(w.dir.path())
        .unwrap()
        .unwrap();
    assert_eq!(
        (cache.fetched_at, cache.last_seen),
        (now, now),
        "bekræftelsen nulstiller uret"
    );
    // En dag offline er godt inden for respiten.
    let a = licens::cloud_access(Some(&cache), false, now + chrono::Duration::days(1));
    assert!(
        matches!(a, Access::OfflineGrace { days_left: 13, .. }),
        "{a:?}"
    );
}

// ---------------------------------------------------------------- rettelser

/// Samme scenarie lokalt og i cloud: kundens sats fjernes, projektets
/// budget og sats rettes og fjernes, en opgave og et klippekort rettes, og
/// kortet fyldes op.
fn rettelser(b: &RepoBackend) {
    let c = b.create_customer(customer_input("Rettekunden")).unwrap();
    assert_eq!(c.hourly_rate, Some(85_000));
    let uden = b
        .update_customer(
            &c.id,
            CustomerInput {
                hourly_rate: None,
                ..customer_input("Rettekunden")
            },
        )
        .unwrap();
    assert_eq!(uden.hourly_rate, None, "tom sats = den globale");
    assert_eq!(b.customers(false).unwrap()[0].hourly_rate, None);

    let input = |rate: Option<i64>, budget: Option<u32>| ProjectInput {
        customer_id: c.id.clone(),
        name: "Budgetprojekt".into(),
        hourly_rate: rate,
        budget_minutes: budget,
    };
    let p = b.create_project(input(Some(95_000), None)).unwrap();
    let med = b
        .update_project(&p.id, input(Some(95_000), Some(2400)))
        .unwrap();
    assert_eq!(
        (med.budget_minutes, med.hourly_rate),
        (Some(2400), Some(95_000))
    );
    let uden = b.update_project(&p.id, input(None, None)).unwrap();
    assert_eq!((uden.budget_minutes, uden.hourly_rate), (None, None));
    assert_eq!(b.projects(None, false).unwrap()[0].budget_minutes, None);

    let p2 = b.create_project(input(None, None)).unwrap();
    let task = b
        .create_task(TaskInput {
            project_id: p.id.clone(),
            title: "Forside".into(),
            due: Some(day()),
            estimate_minutes: Some(120),
            ..Default::default()
        })
        .unwrap();
    let ret = b
        .update_task(
            &task.id,
            TaskInput {
                project_id: p2.id.clone(),
                title: "Forside på mobil".into(),
                due: None,
                estimate_minutes: Some(90),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        (
            ret.title.as_str(),
            ret.project_id.as_str(),
            ret.due,
            ret.estimate_minutes
        ),
        ("Forside på mobil", p2.id.as_str(), None, Some(90))
    );
    assert_eq!(b.tasks(Some(&p2.id)).unwrap().len(), 1);
    assert!(matches!(
        b.update_task(
            &task.id,
            TaskInput {
                title: " ".into(),
                ..TaskInput {
                    project_id: p2.id.clone(),
                    title: String::new(),
                    due: None,
                    estimate_minutes: None,
                    ..Default::default()
                }
            }
        ),
        Err(BackendError::Validation(_))
    ));

    let kort = |minutes: u32, price: i64, expires: Option<NaiveDate>| PunchCardInput {
        customer_id: c.id.clone(),
        name: "Kort".into(),
        total_minutes: minutes,
        price,
        expires,
    };
    let card = b
        .create_punch_card(kort(600, 600_000, Some(day() + chrono::Days::new(365))))
        .unwrap();
    b.create_entry_with_card(
        entry_input(&c.id, None, 120, "Support"),
        CardChoice::Card(card.id.clone()),
    )
    .unwrap();
    let ret = b
        .update_punch_card(&card.id, kort(900, 900_000, None))
        .unwrap();
    assert_eq!(
        (ret.total_minutes, ret.used_minutes, ret.price, ret.expires),
        (900, 120, 900_000, None)
    );
    assert_eq!(ret.purchased, card.purchased, "købsdatoen røres ikke");
    assert!(
        matches!(
            b.update_punch_card(&card.id, kort(60, 60_000, None)),
            Err(BackendError::Validation(_))
        ),
        "færre timer end det brugte afvises"
    );
    let fyldt = b.top_up_punch_card(&card.id, 300).unwrap();
    assert_eq!(
        (fyldt.total_minutes, fyldt.used_minutes, fyldt.price),
        (1200, 120, 1_200_000)
    );
    assert_eq!(b.punch_cards(Some(&c.id)).unwrap()[0].total_minutes, 1200);
}

#[test]
fn lokal_rettelser_af_sats_budget_opgave_og_klippekort() {
    let dir = tempfile::tempdir().unwrap();
    rettelser(&RepoBackend::local_for_tests(dir.path()));
}

#[test]
fn cloud_rettelser_af_sats_budget_opgave_og_klippekort() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    rettelser(&b);
}

#[test]
fn ret_opgave_bevarer_fristens_klokkeslaet_naar_datoen_er_uaendret() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Fristkunde")).unwrap();
    let p = b
        .create_project(ProjectInput {
            customer_id: c.id.clone(),
            name: "P".into(),
            hourly_rate: None,
            budget_minutes: None,
        })
        .unwrap();
    // Sat i web med et klokkeslæt (kl. 08:00 UTC).
    let deadline = day().and_hms_opt(8, 0, 0).unwrap().and_utc();
    let t = block_on(w.mock.repo().create_task(td::NewTask {
        title: "Fra web".into(),
        project_id: Some(p.id.clone()),
        deadline: Some(deadline),
        ..Default::default()
    }))
    .unwrap();
    b.update_task(
        &t.id,
        TaskInput {
            project_id: p.id.clone(),
            title: "Omdøbt".into(),
            due: Some(day()),
            estimate_minutes: None,
            ..Default::default()
        },
    )
    .unwrap();
    let after = block_on(w.mock.repo().list_tasks(td::TaskFilter::default())).unwrap();
    let after = after.iter().find(|x| x.id == t.id).unwrap();
    assert_eq!(
        (after.title.as_str(), after.deadline),
        ("Omdøbt", Some(deadline))
    );
}

#[test]
fn cloud_klippekortets_forbrug_kommer_fra_web() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Forbrugskunde")).unwrap();
    let card = b
        .create_punch_card(PunchCardInput {
            customer_id: c.id.clone(),
            name: "Kort".into(),
            total_minutes: 600,
            price: 600_000,
            expires: None,
        })
        .unwrap();
    let e1 = b
        .create_entry_with_card(
            entry_input(&c.id, None, 90, "Design"),
            CardChoice::Card(card.id.clone()),
        )
        .unwrap();
    b.create_entry_with_card(entry_input(&c.id, None, 30, "Uden kort"), CardChoice::None)
        .unwrap();

    let gets = w.mock.calls("extension.klippekort.get");
    let lists = w.mock.calls("extension.entries.list");
    let usage = b.punch_card_usage(&card.id).unwrap();
    assert_eq!(
        w.mock.calls("extension.klippekort.get"),
        gets + 1,
        "web's usageHistory"
    );
    assert_eq!(
        w.mock.calls("extension.entries.list"),
        lists,
        "ikke udledt af posterne"
    );
    assert_eq!(
        usage,
        vec![PunchUsage {
            entry_id: Some(e1.id.clone()),
            date: day(),
            minutes: 90,
            description: "Design".into()
        }]
    );
    assert!(matches!(
        b.punch_card_usage("00000000-0000-4000-8000-000000000000"),
        Err(BackendError::NotFound(_))
    ));

    // Offline: udledningen fra cachen i stedet for en fejl.
    b.punch_cards(None).unwrap();
    let filter = EntryFilter {
        client_id: Some(c.id.clone()),
        ..EntryFilter::default()
    };
    block_on(b.repo().list_entries(filter)).unwrap();
    w.mock.set_offline(true);
    let offline = b.punch_card_usage(&card.id).unwrap();
    assert_eq!(
        offline.iter().map(|u| u.minutes).sum::<u32>(),
        90,
        "{offline:?}"
    );
}

// ---------- gendan: backup og gendannelse ----------

#[test]
fn backup_gendannes_med_sikkerhedskopi_og_indstillinger() {
    let dir = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let b = RepoBackend::local_for_tests(dir.path());
    b.create_customer(customer_input("Før backup")).unwrap();
    let mut s = b.settings().unwrap();
    s.tracking.idle_minutes = 7;
    b.save_settings(s).unwrap();

    let file = b.export_backup(out.path()).unwrap();
    assert!(
        file.file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("timetrack-backup-")
    );
    assert!(file.extension().is_some_and(|e| e == "ttbackup"));
    let second = b.export_backup(out.path()).unwrap();
    assert_ne!(file, second, "overskriver ikke en tidligere backup");
    let sum = b.inspect_backup(&file).unwrap();
    assert_eq!((sum.customers, sum.has_settings), (1, true));

    // Ændringer efter backuppen forsvinder ved gendannelse.
    b.create_customer(customer_input("Efter backup")).unwrap();
    let mut s = b.settings().unwrap();
    s.tracking.idle_minutes = 30;
    b.save_settings(s).unwrap();

    let r = b.restore_backup(&file).unwrap();
    let names: Vec<String> = b
        .customers(true)
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(names, ["Før backup"]);
    assert_eq!(
        b.settings().unwrap().tracking.idle_minutes,
        7,
        "indstillingerne følger med"
    );
    // Sikkerhedskopien har data fra før gendannelsen.
    assert!(
        r.safety_copy
            .starts_with(dir.path().join("sikkerhedskopier"))
    );
    assert_eq!(b.inspect_backup(&r.safety_copy).unwrap().customers, 2);
}

#[test]
fn ugyldig_backup_roerer_intet() {
    let dir = tempfile::tempdir().unwrap();
    let b = RepoBackend::local_for_tests(dir.path());
    b.create_customer(customer_input("Kunde")).unwrap();
    let bad = dir.path().join("x.ttbackup");
    std::fs::write(&bad, "nej").unwrap();
    let err = b.restore_backup(&bad).unwrap_err();
    assert!(
        matches!(&err, BackendError::Validation(m) if m.contains("TimeTrack-backup")),
        "{err:?}"
    );
    assert_eq!(b.customers(true).unwrap().len(), 1);
    assert!(
        !dir.path().join("sikkerhedskopier").exists(),
        "ingen kopi før filen er godkendt"
    );
}

// ---------------------------------------------------------------- afviste (dead-letter)

#[test]
fn cloud_afviste_registreringer_gemmes_og_overlever_logud() {
    let w = Cloud::new();
    let b = w.open();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Bageriet")).unwrap();
    b.customers(false).unwrap();
    let notices = b.notices();
    drain(&notices);

    // Gemt offline; web afviser den, da køen sendes (fx låst plan).
    w.mock.set_offline(true);
    let _ = b.create_entry_with_card(
        entry_input(&c.id, None, 90, "Afvist post"),
        CardChoice::None,
    );
    w.mock.set_offline(false);
    w.mock.reject_when(
        "extension.entries.create",
        "Afvist post",
        "FORBIDDEN",
        "Planen er låst.",
    );
    assert_eq!(b.sync_now().unwrap(), 0);
    assert_eq!(b.rejected_count(), 1);
    let r = b.rejected().unwrap().remove(0);
    assert_eq!(
        (
            r.kind.as_str(),
            r.minutes,
            r.customer.as_deref(),
            r.error.as_str()
        ),
        (
            "create_entry",
            Some(90),
            Some("Bageriet"),
            "Planen er låst."
        )
    );
    assert_eq!(r.description.as_deref(), Some("Afvist post"));
    // Hændelser når frem til beskederne via en baggrundstråd; vent på afvisningen.
    let mut got = Vec::new();
    wait_until("beskeden om den afviste post", || {
        got.extend(drain(&notices));
        got.iter().any(|n| n.kind == NoticeKind::QueueRejected)
    });
    assert!(
        got.iter().any(|n| n.kind == NoticeKind::QueueRejected
            && n.text == "TimeTrack afviste en ændring: Planen er låst. Den er gemt under afviste registreringer, så du kan sende den igen"),
        "beskeden siger, at posten er gemt: {got:?}"
    );
    assert!(
        b.rejected_csv()
            .unwrap()
            .contains("\"Bageriet\";\"\";\"Afvist post\"")
    );

    // Logud: stadig synlig og kan eksporteres, men sendes ikke uden login.
    b.logout().unwrap();
    assert_eq!(b.mode(), Mode::Local);
    assert_eq!(b.rejected_count(), 1);
    assert!(b.rejected_csv().unwrap().contains("Afvist post"));
    assert_eq!(b.retry_rejected(None), Err(BackendError::Unauthorized));

    // Logget ind igen og planen låst op: sendes én gang og er væk.
    w.mock.clear_rejections();
    let token = w.mock.issue_token();
    b.login_with_token(&token).unwrap();
    assert_eq!(b.rejected_count(), 1);
    assert_eq!(
        b.retry_rejected(Some(&r.id)).unwrap(),
        RetryResult {
            sent: 1,
            rejected: 0,
            queued: 0
        }
    );
    assert_eq!(b.rejected_count(), 0);
    let saved = block_on(w.mock.repo().list_entries(EntryFilter::default())).unwrap();
    assert_eq!(
        saved
            .iter()
            .filter(|e| e.description.as_deref() == Some("Afvist post"))
            .count(),
        1
    );
}

#[test]
fn lokal_har_ingen_afviste() {
    let dir = tempfile::tempdir().unwrap();
    let b = RepoBackend::local_for_tests(dir.path());
    assert_eq!(b.rejected_count(), 0);
    assert!(b.rejected().unwrap().is_empty());
    assert_eq!(
        b.rejected_csv().unwrap(),
        "\u{feff}Dato;Start;Slut;Timer;Kunde;Projekt;Beskrivelse\r\n"
    );
    assert_eq!(b.retry_rejected(None), Err(BackendError::Unauthorized));
}

// ---------------------------------------------------------------- 0.2.24: træk fra, mens appen er låst (#10)

/// Idle-spørgsmålet for den timer, der kører nu, med `away_min` minutter væk.
fn idle_prompt_for(b: &RepoBackend, away_min: u64) -> crate::idle::IdlePrompt {
    let t = b.timer().unwrap();
    assert_eq!(t.status, TimerStatus::Running);
    crate::idle::IdlePrompt {
        away_since: Local::now(),
        back_at: Local::now(),
        away_secs: away_min * 60,
        target: TimerTarget {
            customer_id: t.customer_id.clone(),
            project_id: t.project_id.clone(),
            task_id: t.task_id.clone(),
            description: t.description.clone(),
        },
        timer_started: t.started_at,
        periods: 1,
    }
}

/// Lokal prøve, der er udløbet (startede for 30 dage siden).
#[cfg(not(feature = "mas"))]
fn expire_local_trial(dir: &std::path::Path, today: NaiveDate) {
    let mut file = files::load_license(dir).unwrap();
    file.trial_started = Some(today - chrono::Duration::days(30));
    files::write_json(&files::license_path(dir), &file).unwrap();
}

/// Web's svar for en prøve, der er udløbet (`entitlements.get`).
fn expired_trial_entitlements(now: DateTime<Utc>) -> serde_json::Value {
    json!({
        "organizationId": tt_data::mock::MOCK_ORG_ID,
        "role": "owner",
        "plan": {
            "tier": "solo", "name": "Prøve", "status": "trialing", "isFree": false,
            "isTrial": true, "isTrialExpired": true,
            "trialEndsAt": (now - chrono::Duration::days(1)).to_rfc3339(),
            "memberLocked": false
        },
        "limits": { "maxActiveClients": null },
        "features": {
            "timeTracking": false, "clients": false, "canAddActiveClient": false, "projects": false,
            "tasks": false, "invoices": false, "klippekort": false, "reports": true
        }
    })
}

fn minutes_of(b: &RepoBackend, date: NaiveDate, desc: &str) -> Vec<u32> {
    let mut v: Vec<u32> = b
        .entries(DateRange::day(date))
        .unwrap()
        .into_iter()
        .filter(|e| e.description == desc)
        .map(|e| e.minutes)
        .collect();
    v.sort();
    v
}

/// Prøven er udløbet, og en timer kører: "Træk fra" stopper og korter i ét
/// skridt, og posten har den rigtige længde. Før 0.2.24 lykkedes stoppet,
/// men kortningen blev afvist (`PlanLimit`), så posten fik hele tiden.
#[cfg(not(feature = "mas"))]
#[test]
fn laast_lokal_traek_fra_stopper_og_korter_i_et() {
    use crate::idle::{IdleChoice, IdleOutcome, resolve};
    let dir = tempfile::tempdir().unwrap();
    let start = Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap();
    let date = start.with_timezone(&Local).date_naive();
    let (m, clock) = manual_clock(start);
    let b = enforcing_local(dir.path(), clock);
    b.start_trial().unwrap();
    let c = b.create_customer(customer_input("Bageriet")).unwrap();
    let target = TimerTarget {
        customer_id: Some(c.id.clone()),
        description: "Idle".into(),
        ..Default::default()
    };

    for (choice, expected, running_after) in [
        (
            IdleChoice::SubtractAndStop,
            IdleOutcome::SubtractedAndStopped { minutes: 12 },
            false,
        ),
        (
            IdleChoice::Subtract,
            IdleOutcome::Subtracted { minutes: 12 },
            true,
        ),
    ] {
        // Prøven udløber, mens timeren kører (den startes i en gyldig prøve).
        let mut file = files::load_license(dir.path()).unwrap();
        file.trial_started = Some(date);
        files::write_json(&files::license_path(dir.path()), &file).unwrap();
        if b.timer().unwrap().status != TimerStatus::Idle {
            b.timer_discard().unwrap();
        }
        b.timer_start(target.clone()).unwrap();
        m.advance(chrono::Duration::minutes(60));
        expire_local_trial(dir.path(), date);
        assert_eq!(b.access(), Access::Locked(LockReason::TrialExpired));

        let before = minutes_of(&b, date, "Idle");
        let p = idle_prompt_for(&b, 12);
        assert_eq!(resolve(&b, &p, choice).unwrap(), expected, "{choice:?}");
        let mut want = before.clone();
        want.push(48);
        want.sort();
        assert_eq!(
            minutes_of(&b, date, "Idle"),
            want,
            "60 minutter minus 12 ({choice:?})"
        );
        let t = b.timer().unwrap();
        assert_eq!(
            t.status == TimerStatus::Running,
            running_after,
            "{choice:?}"
        );
        if running_after {
            assert_eq!(t.customer_id.as_deref(), Some(c.id.as_str()), "samme mål");
            assert_eq!(t.description, "Idle");
        }
    }
}

/// Låst lokal tilstand: tid, der allerede er registreret, kan rettes, men en
/// ny post kan ikke oprettes.
#[cfg(not(feature = "mas"))]
#[test]
fn laast_lokal_ret_eksisterende_post_virker_ny_post_afvises() {
    let dir = tempfile::tempdir().unwrap();
    let start = Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap();
    let date = start.with_timezone(&Local).date_naive();
    let (_m, clock) = manual_clock(start);
    let b = enforcing_local(dir.path(), clock);
    b.start_trial().unwrap();
    let c = b.create_customer(customer_input("Bageriet")).unwrap();
    let e = b
        .create_entry(EntryInput {
            date,
            ..entry_input(&c.id, None, 60, "Før")
        })
        .unwrap();
    expire_local_trial(dir.path(), date);
    assert!(b.access().is_locked());

    let fixed = b
        .update_entry(
            &e.id,
            EntryInput {
                date,
                ..entry_input(&c.id, None, 45, "Rettet")
            },
        )
        .unwrap();
    assert_eq!((fixed.minutes, fixed.description.as_str()), (45, "Rettet"));
    assert_eq!(minutes_of(&b, date, "Rettet"), vec![45]);
    // Mere tid på en gammel post er ny tid: det afvises (review 0.2.24, fund 4).
    assert!(matches!(
        b.update_entry(
            &e.id,
            EntryInput {
                date,
                ..entry_input(&c.id, None, 480, "Rettet")
            }
        ),
        Err(BackendError::PlanLimit(_))
    ));
    assert_eq!(minutes_of(&b, date, "Rettet"), vec![45]);
    assert!(matches!(
        b.create_entry(EntryInput {
            date,
            ..entry_input(&c.id, None, 30, "Ny")
        }),
        Err(BackendError::PlanLimit(_))
    ));
    assert!(matches!(
        b.timer_start(TimerTarget::default()),
        Err(BackendError::PlanLimit(_))
    ));
}

/// Cloud: appen er låst (planen siger udløbet prøve), men web tager imod
/// posten (fx når web's natlige kørsel har flyttet prøven til Gratis, før
/// appen har spurgt igen). "Træk fra" stopper og korter i ét kald, og web
/// får posten med den rigtige længde. En eksisterende post kan rettes, en ny
/// afvises af appen.
#[test]
fn laast_cloud_traek_fra_stopper_og_korter_i_et() {
    use crate::idle::{IdleChoice, IdleOutcome, resolve};
    let w = Cloud::new();
    let start = Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap();
    let date = start.with_timezone(&Local).date_naive();
    let (m, clock) = manual_clock(start);
    let mut o = w.options();
    o.clock = Some(clock);
    o.enforce_license = true;
    let b = RepoBackend::open_with(o).unwrap();
    b.login_with_token("tok-test").unwrap();
    assert_eq!(b.refresh_access(), Access::Full);
    let c = b.create_customer(customer_input("Cloud-kunde")).unwrap();
    let old = b
        .create_entry(EntryInput {
            date,
            ..entry_input(&c.id, None, 60, "Før")
        })
        .unwrap();
    b.timer_start(TimerTarget {
        customer_id: Some(c.id.clone()),
        description: "Idle".into(),
        ..Default::default()
    })
    .unwrap();
    m.advance(chrono::Duration::minutes(60));
    w.mock
        .set_entitlements(Some(expired_trial_entitlements(start)));
    assert_eq!(b.refresh_access(), Access::Locked(LockReason::TrialExpired));

    let p = idle_prompt_for(&b, 12);
    assert_eq!(
        resolve(&b, &p, IdleChoice::SubtractAndStop).unwrap(),
        IdleOutcome::SubtractedAndStopped { minutes: 12 }
    );
    assert_eq!(
        minutes_of(&b, date, "Idle"),
        vec![48],
        "60 minutter minus 12"
    );
    assert!(!w.mock.timer_state().is_running);
    assert_eq!(
        w.mock.calls("extension.entries.update"),
        0,
        "ét kald: ingen rettelse bagefter"
    );

    // Rettelse af en eksisterende post går igennem appens lås.
    let fixed = b
        .update_entry(
            &old.id,
            EntryInput {
                date,
                ..entry_input(&c.id, None, 45, "Rettet")
            },
        )
        .unwrap();
    assert_eq!(fixed.minutes, 45);
    assert!(matches!(
        b.create_entry(EntryInput {
            date,
            ..entry_input(&c.id, None, 30, "Ny")
        }),
        Err(BackendError::PlanLimit(_))
    ));
}

/// Cloud mod web, der afviser tidsskrivninger for en låst plan (web's
/// `subscribedProcedure`: FORBIDDEN på `time.create`/`time.update`). Stop og
/// kort sker i ét: afviser web posten, er intet ændret, og timeren kører
/// videre på web, så tiden ikke er tabt. Rettelsen når frem til web (appens
/// lås afviser den ikke) og får web's svar.
#[test]
fn laast_cloud_web_afviser_posten_og_intet_er_aendret() {
    use crate::idle::{IdleChoice, resolve};
    let w = Cloud::new();
    let start = Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap();
    let date = start.with_timezone(&Local).date_naive();
    let (m, clock) = manual_clock(start);
    let mut o = w.options();
    o.clock = Some(clock);
    o.enforce_license = true;
    let b = RepoBackend::open_with(o).unwrap();
    b.login_with_token("tok-test").unwrap();
    let c = b.create_customer(customer_input("Cloud-kunde")).unwrap();
    let old = b
        .create_entry(EntryInput {
            date,
            ..entry_input(&c.id, None, 60, "Før")
        })
        .unwrap();
    b.timer_start(TimerTarget {
        customer_id: Some(c.id.clone()),
        description: "Idle".into(),
        ..Default::default()
    })
    .unwrap();
    m.advance(chrono::Duration::minutes(60));
    w.mock
        .set_entitlements(Some(expired_trial_entitlements(start)));
    assert!(b.refresh_access().is_locked());
    w.mock
        .fail_next("extension.entries.create", "FORBIDDEN", 10);

    let p = idle_prompt_for(&b, 12);
    for choice in [IdleChoice::SubtractAndStop, IdleChoice::Subtract] {
        let err = resolve(&b, &p, choice).unwrap_err();
        assert!(
            err.to_string().contains("Injiceret"),
            "web's svar, ikke appens lås: {err:?}"
        );
        assert!(
            w.mock.timer_state().is_running,
            "timeren kører videre på web"
        );
        assert_eq!(
            b.timer().unwrap().started_at,
            p.timer_started,
            "samme timer"
        );
        assert!(minutes_of(&b, date, "Idle").is_empty(), "ingen halv post");
    }
    assert!(w.mock.calls("extension.cancelStop") >= 1);

    w.mock.fail_next("extension.entries.update", "FORBIDDEN", 1);
    let before = w.mock.calls("extension.entries.update");
    let err = b
        .update_entry(
            &old.id,
            EntryInput {
                date,
                ..entry_input(&c.id, None, 45, "Rettet")
            },
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("Injiceret"),
        "web's svar, ikke appens lås: {err:?}"
    );
    assert_eq!(
        w.mock.calls("extension.entries.update"),
        before + 1,
        "rettelsen blev sendt til web"
    );
}

/// I en låst app genstarter "Træk fra" kun timeren på dens eget mål. Et
/// andet mål ville være en ny timer, og den gælder låsen (review 0.2.24,
/// fund 7).
#[cfg(not(feature = "mas"))]
#[test]
fn laast_traek_fra_genstarter_ikke_et_andet_maal() {
    let dir = tempfile::tempdir().unwrap();
    let start = Utc.with_ymd_and_hms(2026, 10, 26, 9, 0, 0).unwrap();
    let date = start.with_timezone(&Local).date_naive();
    let (m, clock) = manual_clock(start);
    let b = enforcing_local(dir.path(), clock);
    b.start_trial().unwrap();
    let c = b.create_customer(customer_input("Bageriet")).unwrap();
    let other = b.create_customer(customer_input("Andet")).unwrap();
    let target = TimerTarget {
        customer_id: Some(c.id.clone()),
        description: "Idle".into(),
        ..Default::default()
    };
    b.timer_start(target.clone()).unwrap();
    m.advance(chrono::Duration::minutes(60));
    expire_local_trial(dir.path(), date);
    assert!(b.access().is_locked());

    let elsewhere = TimerTarget {
        customer_id: Some(other.id.clone()),
        ..target.clone()
    };
    let out = b.timer_subtract_idle(10, Some(elsewhere)).unwrap();
    assert_eq!(
        out.entry.map(|e| e.minutes),
        Some(50),
        "stop og fradrag er sket"
    );
    assert!(
        out.restart_error.is_some(),
        "et andet mål startes ikke i en låst app"
    );
    assert_eq!(b.timer().unwrap().status, TimerStatus::Idle);
}

// ---------------------------------------------------------------- aktivitet (0.2.25)

#[test]
fn aktivitet_tildel_opretter_poster_laerer_og_finder_lignende() {
    let dir = tempfile::tempdir().unwrap();
    let det_dir = dir.path().join("detektion");
    let at = |h: u32, m: u32| {
        Local
            .from_local_datetime(&day().and_time(t(h, m)))
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    };
    let seg = |from: (u32, u32), to: (u32, u32)| tt_tracker::ActivitySegment {
        id: None,
        app: "Safari".into(),
        app_id: "safari".into(),
        title: "Ordre – Gamma".into(),
        url: Some("https://gamma-portal.example/ordre".into()),
        domain: Some("gamma-portal.example".into()),
        repo_remote: None,
        repo_root: None,
        branch: None,
        path: None,
        document: None,
        start: at(from.0, from.1),
        end: at(to.0, to.1),
        idle: false,
    };
    {
        let store = tt_tracker::ActivityStore::open(&det_dir.join("activity.db")).unwrap();
        for s in [
            seg((8, 0), (9, 0)),
            seg((9, 0), (9, 30)),
            seg((13, 0), (14, 0)),
        ] {
            store.insert(&s).unwrap();
        }
    }
    let engine = Arc::new(crate::engine::Engine::new(det_dir, None));
    let b = local(dir.path(), engine, None);
    let c = b
        .create_customer(customer_input("Delta Rådgivning"))
        .unwrap();

    let d = b.activity_day(day()).unwrap();
    assert_eq!(d.blocks.len(), 2, "{:#?}", d.blocks);
    assert!(d.blocks.iter().all(|x| x.status == ActivityStatus::Unclear));
    let close = b.close_day(day()).unwrap();
    assert_eq!(close.unclear_blocks, 2);
    assert_eq!(close.unclear_seconds, 150 * 60);

    let out = b
        .assign_activity(
            day(),
            AssignActivity {
                block_ids: vec![d.blocks[0].id.clone()],
                customer_id: c.id.clone(),
                remember: true,
                billable: true,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(out.entries.len(), 1);
    assert_eq!(
        (
            out.entries[0].start,
            out.entries[0].end,
            out.entries[0].minutes
        ),
        (Some(t(8, 0)), Some(t(9, 30)), 90)
    );
    assert_eq!(
        out.similar,
        vec![d.blocks[1].id.clone()],
        "eftermiddagen ligner"
    );

    let d = b.activity_day(day()).unwrap();
    assert_eq!(d.blocks[0].status, ActivityStatus::Registered);
    assert_eq!(d.blocks[0].customer_id.as_deref(), Some(c.id.as_str()));
    assert_eq!(d.blocks[1].status, ActivityStatus::Suggested);
    // Samme blok kan ikke registreres to gange.
    let again = b.assign_activity(
        day(),
        AssignActivity {
            block_ids: vec![d.blocks[0].id.clone()],
            customer_id: c.id.clone(),
            ..Default::default()
        },
    );
    assert!(matches!(again, Err(BackendError::Conflict(_))), "{again:?}");
    // En manuel post dækker også en blok.
    assert_eq!(b.entries(DateRange::day(day())).unwrap().len(), 1);
    // Luk dagen: forslaget fra læringen og ingen uklar tid tilbage.
    let close = b.close_day(day()).unwrap();
    assert_eq!(close.suggestions.len(), 1);
    assert_eq!(close.unclear_blocks, 0);
    assert_eq!(close.without_project.len(), 1, "posten har ingen projekt");
    b.confirm_day(day()).unwrap();
    assert!(b.close_day(day()).unwrap().suggestions.is_empty());

    assert!(b.activity_storage().unwrap().segments >= 3);
    b.delete_all_activity().unwrap();
    assert!(b.activity_day(day()).unwrap().blocks.is_empty());
}

#[test]
fn aktivitet_flet_og_tildel_registrerer_aldrig_samme_tid_to_gange() {
    let dir = tempfile::tempdir().unwrap();
    let det_dir = dir.path().join("detektion");
    let at = |h: u32, m: u32| {
        Local
            .from_local_datetime(&day().and_time(t(h, m)))
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    };
    let seg = |from: (u32, u32), to: (u32, u32), idle: bool| tt_tracker::ActivitySegment {
        id: None,
        app: "Safari".into(),
        app_id: "safari".into(),
        title: "Ordre – portal".into(),
        url: Some("https://portal.example/ordre".into()),
        domain: Some("portal.example".into()),
        repo_remote: None,
        repo_root: None,
        branch: None,
        path: None,
        document: None,
        start: at(from.0, from.1),
        end: at(to.0, to.1),
        idle,
    };
    {
        let store = tt_tracker::ActivityStore::open(&det_dir.join("activity.db")).unwrap();
        for s in [
            seg((8, 0), (9, 0), false),
            seg((9, 0), (9, 10), true),
            seg((9, 10), (10, 0), false),
        ] {
            store.insert(&s).unwrap();
        }
    }
    let engine = Arc::new(crate::engine::Engine::new(det_dir, None));
    let b = local(dir.path(), engine, None);
    let c = b
        .create_customer(customer_input("Delta Rådgivning"))
        .unwrap();
    let ids = |b: &RepoBackend| -> Vec<Id> {
        b.activity_day(day())
            .unwrap()
            .blocks
            .into_iter()
            .map(|x| x.id)
            .collect()
    };

    // En pause kan ikke flettes ind.
    let all = ids(&b);
    assert_eq!(all.len(), 3);
    let err = b.merge_activity(day(), &[all[0].clone(), all[2].clone()]);
    assert!(matches!(err, Err(BackendError::Validation(_))), "{err:?}");

    // To uklare blokke uden pause imellem kan flettes; kommer der bagefter en
    // post ind i det flettede tidsrum, registreres den tid ikke igen.
    b.split_activity(day(), &all[0], t(8, 30)).unwrap();
    let all = ids(&b);
    b.merge_activity(day(), &[all[0].clone(), all[1].clone()])
        .unwrap();
    let mut manual = entry_input(&c.id, None, 15, "Møde");
    manual.date = day();
    manual.start = Some(t(8, 20));
    manual.end = Some(t(8, 35));
    b.create_entry(manual).unwrap();
    let d = b.activity_day(day()).unwrap();
    let merged = d
        .blocks
        .iter()
        .find(|x| x.start == t(8, 0))
        .expect("den flettede blok");
    assert_eq!(merged.status, ActivityStatus::Unclear, "{:#?}", d.blocks);
    let out = b
        .assign_activity(
            day(),
            AssignActivity {
                block_ids: vec![merged.id.clone()],
                customer_id: c.id.clone(),
                billable: true,
                ..Default::default()
            },
        )
        .unwrap();
    let spans: Vec<_> = out.entries.iter().map(|e| (e.start, e.end)).collect();
    assert_eq!(
        spans,
        vec![
            (Some(t(8, 0)), Some(t(8, 20))),
            (Some(t(8, 35)), Some(t(9, 0)))
        ]
    );
}

#[test]
fn forslag_under_en_post_foreslaas_ikke_igen() {
    let dir = tempfile::tempdir().unwrap();
    let det_dir = dir.path().join("detektion");
    let at = |h: u32, m: u32| {
        Local
            .from_local_datetime(&day().and_time(t(h, m)))
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    };
    {
        let store = tt_tracker::ActivityStore::open(&det_dir.join("activity.db")).unwrap();
        store
            .insert(&tt_tracker::ActivitySegment {
                id: None,
                app: "Safari".into(),
                app_id: "safari".into(),
                title: "Ordre 7 – Gamma".into(),
                url: Some("https://portal.example/ordre".into()),
                domain: Some("portal.example".into()),
                repo_remote: None,
                repo_root: None,
                branch: None,
                path: None,
                document: None,
                start: at(9, 0),
                end: at(10, 0),
                idle: false,
            })
            .unwrap();
    }
    let engine = Arc::new(crate::engine::Engine::new(det_dir, None));
    let b = local(dir.path(), engine, None);
    let c = b.create_customer(customer_input("Gamma")).unwrap();
    assert_eq!(
        b.suggestions(day()).unwrap().len(),
        1,
        "navnet giver et forslag"
    );
    // Timeren (eller en manuel post) dækkede allerede tiden.
    let mut e = entry_input(&c.id, None, 60, "Timer");
    e.date = day();
    e.start = Some(t(9, 0));
    e.end = Some(t(10, 0));
    b.create_entry(e).unwrap();
    assert!(b.suggestions(day()).unwrap().is_empty());
    assert!(b.close_day(day()).unwrap().suggestions.is_empty());
    assert!(b.confirm_day(day()).unwrap().is_empty());
    assert_eq!(b.entries(DateRange::day(day())).unwrap().len(), 1);
}

// ---------------------------------------------------------------- aktivitet gennem den rigtige opstart (aktfix)

/// Detektionen, som `startup::real()` bygger den: motoren på `detektion/`
/// pakket ind i kalenderen. Tests direkte mod `Engine` så ikke, at
/// indpakningen slugte Aktivitet (0.2.25).
fn real_detection(dir: &std::path::Path) -> Arc<dyn Detection> {
    let engine = Arc::new(crate::engine::Engine::new(dir.join("detektion"), None));
    let kalender = Arc::new(crate::kalenderkilder::Kalender::new(
        Some(dir.join("kalender")),
        Box::new(|_| vec![]),
    ));
    Arc::new(crate::kalenderkilder::CalendarDetection::new(
        engine, kalender,
    ))
}

/// Segmenter i `detektion/activity.db` for i dag, i går og for fem dage
/// siden (som 0.2-migreringen lægger dem). Returnerer antallet.
fn seed_activity(dir: &std::path::Path) -> u64 {
    let at = |d: NaiveDate, h: u32, m: u32| {
        Local
            .from_local_datetime(&d.and_time(t(h, m)))
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    };
    let store =
        tt_tracker::ActivityStore::open(&dir.join("detektion").join("activity.db")).unwrap();
    let mut n = 0;
    for back in [0, 1, 5] {
        let d = day() - chrono::Duration::days(back);
        for (from, to) in [((8, 0), (9, 0)), ((13, 0), (14, 0))] {
            store
                .insert(&tt_tracker::ActivitySegment {
                    id: None,
                    app: "Code".into(),
                    app_id: "code".into(),
                    title: "main.rs".into(),
                    url: None,
                    domain: None,
                    repo_remote: None,
                    repo_root: None,
                    branch: None,
                    path: None,
                    document: None,
                    start: at(d, from.0, from.1),
                    end: at(d, to.0, to.1),
                    idle: false,
                })
                .unwrap();
            n += 1;
        }
    }
    n
}

/// Aktivitet skal vise de gemte dage og blokke, og "Gemmes fra" skal følge
/// `tracking.retentionDays` fra indstillingerne.
fn assert_activity_shows_stored_days(b: &RepoBackend, segments: u64) {
    let today = b.activity_day(day()).unwrap();
    assert_eq!(today.blocks.len(), 2, "dagens blokke: {:#?}", today.blocks);
    assert_eq!(
        today.earliest,
        day() - chrono::Duration::days(13),
        "14 dage som standard"
    );
    let yesterday = day() - chrono::Duration::days(1);
    assert_eq!(
        b.activity_day(yesterday).unwrap().blocks.len(),
        2,
        "gårsdagen"
    );
    assert_eq!(b.activity_storage().unwrap().segments, segments);

    let mut s = b.settings().unwrap();
    s.tracking.retention_days = 10;
    b.save_settings(s).unwrap();
    assert_eq!(
        b.activity_day(day()).unwrap().earliest,
        day() - chrono::Duration::days(9),
        "retentionDays fra indstillingerne"
    );
}

#[test]
fn lokal_aktivitet_gennem_den_rigtige_detektion_viser_blokke_og_dage() {
    let dir = tempfile::tempdir().unwrap();
    let n = seed_activity(dir.path());
    let b = local(dir.path(), real_detection(dir.path()), None);
    assert_activity_shows_stored_days(&b, n);
}

#[test]
fn cloud_aktivitet_gennem_den_rigtige_detektion_viser_blokke_og_dage() {
    let cloud = Cloud::new();
    let n = seed_activity(cloud.dir.path());
    let mut o = cloud.options();
    o.detection = real_detection(cloud.dir.path());
    let b = RepoBackend::open_with(o).unwrap();
    cloud.login_pkce(&b);
    assert!(matches!(b.mode(), Mode::Cloud { .. }), "cloud-tilstand");
    assert_activity_shows_stored_days(&b, n);
}

// ---------------------------------------------------------------- ux-vaelger: "Altid sådan" og regeloversigten

/// I dag 09-10 og 13-13:30 og for tre dage siden 10-11 på bageriet.dk, i dag
/// 11-12 på et andet domæne.
fn seed_rule_activity(dir: &std::path::Path) {
    let at = |d: NaiveDate, h: u32, m: u32| {
        Local
            .from_local_datetime(&d.and_time(t(h, m)))
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    };
    let seg =
        |d: NaiveDate, from: (u32, u32), to: (u32, u32), host: &str| tt_tracker::ActivitySegment {
            id: None,
            app: "Safari".into(),
            app_id: "safari".into(),
            title: format!("Side – {host}"),
            url: Some(format!("https://{host}/side")),
            domain: Some(host.into()),
            repo_remote: None,
            repo_root: None,
            branch: None,
            path: None,
            document: None,
            start: at(d, from.0, from.1),
            end: at(d, to.0, to.1),
            idle: false,
        };
    let store =
        tt_tracker::ActivityStore::open(&dir.join("detektion").join("activity.db")).unwrap();
    let earlier = day() - chrono::Duration::days(3);
    for s in [
        seg(day(), (9, 0), (10, 0), "bageriet.dk"),
        seg(day(), (11, 0), (12, 0), "nyheder.example"),
        seg(day(), (13, 0), (13, 30), "shop.bageriet.dk"),
        seg(earlier, (10, 0), (11, 0), "bageriet.dk"),
    ] {
        store.insert(&s).unwrap();
    }
}

fn assert_altid_saadan(b: &RepoBackend) {
    let bageriet = b
        .create_customer(CustomerInput {
            name: "Kunde A".into(),
            ..Default::default()
        })
        .unwrap();
    let anden = b
        .create_customer(CustomerInput {
            name: "Kunde B".into(),
            ..Default::default()
        })
        .unwrap();
    let blocks = b.activity_day(day()).unwrap().blocks;
    let first = blocks
        .iter()
        .find(|x| x.start == t(9, 0))
        .expect("blokken 09-10")
        .id
        .clone();

    // Omfang med forhåndsvisning: domænet matcher 2 blokke i dag og 3 i alt.
    let scopes = b.rule_scopes(day(), std::slice::from_ref(&first)).unwrap();
    let domain = scopes
        .iter()
        .find(|s| s.kind == ScopeKind::Domain)
        .expect("domæne-omfang")
        .clone();
    assert_eq!(domain.value, "bageriet.dk");
    assert_eq!((domain.today, domain.recent), (2, 3), "{scopes:?}");
    assert!(
        scopes
            .iter()
            .any(|s| s.kind == ScopeKind::App && s.value == "Safari")
    );

    // Tildel, opret reglen og lad den gælde bagud.
    b.assign_activity(
        day(),
        AssignActivity {
            block_ids: vec![first],
            customer_id: bageriet.id.clone(),
            project_id: None,
            task_id: None,
            description: String::new(),
            billable: true,
            remember: false,
        },
    )
    .unwrap();
    b.create_rule(&domain, Some(bageriet.id.clone()), None)
        .unwrap();
    let back = b
        .apply_rule_backward(&domain, Some(bageriet.id.clone()), None)
        .unwrap();
    assert_eq!(
        (back.entries, back.minutes, back.days),
        (2, 90, 2),
        "13-13:30 i dag og 10-11 for tre dage siden"
    );
    // Kun bageriet.dk-tiden er registreret, og intet to gange.
    assert_eq!(b.entries(DateRange::day(day())).unwrap().len(), 2);
    let again = b
        .apply_rule_backward(&domain, Some(bageriet.id.clone()), None)
        .unwrap();
    assert_eq!(again.entries, 0, "allerede registreret tid tages ikke igen");

    // Oversigten: reglen med træffere, kan slås fra, rettes og slettes.
    let row = |b: &RepoBackend| {
        b.rule_rows()
            .unwrap()
            .into_iter()
            .find(|r| r.origin == RuleOrigin::Rule && r.value == "bageriet.dk")
    };
    let r = row(b).expect("reglen står i oversigten");
    assert_eq!((r.kind, r.hits, r.active), (RuleRowKind::Domain, 3, true));
    assert_eq!(r.customer_id.as_deref(), Some(bageriet.id.as_str()));
    b.set_rule_active(&r, false).unwrap();
    assert!(!row(b).unwrap().active);
    b.set_rule_active(&r, true).unwrap();
    b.set_rule_target(&r, Some(anden.id.clone()), None).unwrap();
    assert_eq!(
        row(b).unwrap().customer_id.as_deref(),
        Some(anden.id.as_str())
    );
    b.delete_rule_row(&row(b).unwrap()).unwrap();
    assert!(row(b).is_none());
}

#[test]
fn altid_saadan_lokalt_med_omfang_bagud_og_oversigt() {
    let dir = tempfile::tempdir().unwrap();
    seed_rule_activity(dir.path());
    let b = local(dir.path(), real_detection(dir.path()), None);
    assert_altid_saadan(&b);
}

#[test]
fn altid_saadan_i_cloud_med_omfang_bagud_og_oversigt() {
    let cloud = Cloud::new();
    seed_rule_activity(cloud.dir.path());
    let mut o = cloud.options();
    o.detection = real_detection(cloud.dir.path());
    let b = RepoBackend::open_with(o).unwrap();
    cloud.login_pkce(&b);
    assert_altid_saadan(&b);
}

#[test]
fn laerte_moenstre_kan_slaas_fra_rettes_og_glemmes() {
    let dir = tempfile::tempdir().unwrap();
    seed_rule_activity(dir.path());
    let b = local(dir.path(), real_detection(dir.path()), None);
    let a = b
        .create_customer(CustomerInput {
            name: "Kunde A".into(),
            ..Default::default()
        })
        .unwrap();
    let other = b
        .create_customer(CustomerInput {
            name: "Kunde B".into(),
            ..Default::default()
        })
        .unwrap();
    let blocks = b.activity_day(day()).unwrap().blocks;
    let news = blocks
        .iter()
        .find(|x| x.start == t(11, 0))
        .unwrap()
        .id
        .clone();
    b.assign_activity(
        day(),
        AssignActivity {
            block_ids: vec![news],
            customer_id: a.id.clone(),
            project_id: None,
            task_id: None,
            description: String::new(),
            billable: true,
            remember: true,
        },
    )
    .unwrap();
    let pattern = |b: &RepoBackend| {
        b.rule_rows()
            .unwrap()
            .into_iter()
            .find(|r| r.origin == RuleOrigin::Pattern && r.kind == RuleRowKind::Domain)
    };
    let p = pattern(&b).expect("domænet er lært");
    assert_eq!(p.value, "nyheder.example");
    assert_eq!(p.customer_id.as_deref(), Some(a.id.as_str()));
    assert_eq!(p.hits, 1);
    b.set_rule_active(&p, false).unwrap();
    assert!(!pattern(&b).unwrap().active, "slået fra på enheden");
    b.set_rule_active(&p, true).unwrap();
    b.set_rule_target(&p, Some(other.id.clone()), None).unwrap();
    assert_eq!(
        pattern(&b).unwrap().customer_id.as_deref(),
        Some(other.id.as_str())
    );
    b.delete_rule_row(&p).unwrap();
    assert!(pattern(&b).is_none(), "glemt");
}

#[test]
fn en_slaaet_fra_regel_giver_ingen_forslag() {
    let dir = tempfile::tempdir().unwrap();
    seed_rule_activity(dir.path());
    let b = local(dir.path(), real_detection(dir.path()), None);
    let a = b
        .create_customer(CustomerInput {
            name: "Kunde A".into(),
            ..Default::default()
        })
        .unwrap();
    let scope = RuleScope {
        kind: ScopeKind::Domain,
        value: "bageriet.dk".into(),
        today: 0,
        recent: 0,
    };
    b.create_rule(&scope, Some(a.id.clone()), None).unwrap();
    let on_a = |b: &RepoBackend| {
        b.suggestions(day())
            .unwrap()
            .iter()
            .filter(|s| s.customer_id.as_deref() == Some(a.id.as_str()))
            .count()
    };
    assert_eq!(on_a(&b), 2, "reglen giver forslag på 09-10 og 13-13:30");
    let row = b
        .rule_rows()
        .unwrap()
        .into_iter()
        .find(|r| r.origin == RuleOrigin::Rule)
        .unwrap();
    b.set_rule_active(&row, false).unwrap();
    assert_eq!(on_a(&b), 0, "slået fra");
    b.set_rule_active(&row, true).unwrap();
    assert_eq!(on_a(&b), 2, "slået til igen");
}

// ---------------------------------------------------------------- ux-vaelger: ret kunde

fn assert_ret_kunde(b: &RepoBackend) {
    let c = b
        .create_customer(CustomerInput {
            name: "Farvekunden".into(),
            ..Default::default()
        })
        .unwrap();
    let input = CustomerInput {
        name: "Farvekunden".into(),
        color: Some("#8b5cf6".into()),
        phone: Some("70 20 30 40".into()),
        notes: Some("Faktura til bogholderiet".into()),
        domains: Some(vec!["https://www.farvekunden.dk/".into()]),
        ..Default::default()
    };
    b.update_customer(&c.id, input.clone()).unwrap();
    let got = b
        .customers(true)
        .unwrap()
        .into_iter()
        .find(|x| x.id == c.id)
        .unwrap();
    assert_eq!(got.color.as_deref(), Some("#8b5cf6"));
    assert_eq!(got.phone.as_deref(), Some("70 20 30 40"));
    assert_eq!(got.notes.as_deref(), Some("Faktura til bogholderiet"));
    assert_eq!(got.domains, vec!["farvekunden.dk".to_string()]);
    // Uændrede domæner (None) rører ikke dem, der er der.
    b.update_customer(
        &c.id,
        CustomerInput {
            domains: None,
            notes: None,
            ..input
        },
    )
    .unwrap();
    let got = b
        .customers(true)
        .unwrap()
        .into_iter()
        .find(|x| x.id == c.id)
        .unwrap();
    assert_eq!(got.domains, vec!["farvekunden.dk".to_string()]);
    assert_eq!(got.notes, None, "tomme noter fjernes");
}

#[test]
fn ret_kunde_med_farve_og_domaener_lokalt() {
    let dir = tempfile::tempdir().unwrap();
    let b = local(dir.path(), Arc::new(NoDetection), None);
    assert_ret_kunde(&b);
}

#[test]
fn ret_kunde_med_farve_og_domaener_i_cloud() {
    let cloud = Cloud::new();
    let b = RepoBackend::open_with(cloud.options()).unwrap();
    cloud.login_pkce(&b);
    assert_ret_kunde(&b);
}

/// Review (ux-vaelger): "bagud" registrerer ikke andet arbejde imellem.
#[test]
fn bagud_tager_ikke_andet_arbejde_imellem() {
    let dir = tempfile::tempdir().unwrap();
    let d = day() - chrono::Duration::days(3);
    let at = |h: u32, m: u32| {
        Local
            .from_local_datetime(&d.and_time(t(h, m)))
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    };
    let seg = |a: (u32, u32), b: (u32, u32), host: &str| tt_tracker::ActivitySegment {
        id: None,
        app: "Safari".into(),
        app_id: "safari".into(),
        title: format!("Side – {host}"),
        url: Some(format!("https://{host}/")),
        domain: Some(host.into()),
        repo_remote: None,
        repo_root: None,
        branch: None,
        path: None,
        document: None,
        start: at(a.0, a.1),
        end: at(b.0, b.1),
        idle: false,
    };
    {
        let store =
            tt_tracker::ActivityStore::open(&dir.path().join("detektion").join("activity.db"))
                .unwrap();
        for s in [
            seg((10, 0), (10, 10), "bageriet.dk"),
            seg((10, 10), (10, 13), "nyheder.example"),
            seg((10, 13), (10, 20), "bageriet.dk"),
        ] {
            store.insert(&s).unwrap();
        }
    }
    let b = local(dir.path(), real_detection(dir.path()), None);
    let a = b
        .create_customer(CustomerInput {
            name: "Kunde A".into(),
            ..Default::default()
        })
        .unwrap();
    let scope = RuleScope {
        kind: ScopeKind::Domain,
        value: "bageriet.dk".into(),
        today: 0,
        recent: 0,
    };
    b.create_rule(&scope, Some(a.id.clone()), None).unwrap();
    let back = b
        .apply_rule_backward(&scope, Some(a.id.clone()), None)
        .unwrap();
    assert_eq!(
        back.minutes, 17,
        "de 3 minutter på nyheder.example er ikke med: {back:?}"
    );
}
