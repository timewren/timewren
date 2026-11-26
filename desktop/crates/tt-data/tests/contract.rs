//! Kontrakt-testsuiten (spec "Test-seams"): samme scenarier mod `LocalRepo`
//! og mod `CloudRepo` over HTTP mod mock-serveren. Begge skal opføre sig ens
//! gennem `Repository`-traitet.

mod common;

use common::*;
use futures_lite::future::block_on;
use tt_data::*;

async fn new_client(repo: &dyn Repository, name: &str, rate: Option<&str>) -> Client {
    repo.create_client(NewClient { name: name.into(), default_hourly_rate: rate.map(d), ..Default::default() })
        .await
        .unwrap()
}

fn entry(desc: &str, hours: &str) -> NewTimeEntry {
    NewTimeEntry { description: desc.into(), hours: d(hours), date: day(), ..Default::default() }
}

// ------------------------------------------------------------------ scenarier

async fn clients(repo: &dyn Repository, _: &FakeClock) {
    let c = new_client(repo, "Bageriet på hjørnet", Some("850")).await;
    assert_eq!(c.default_hourly_rate, Some(d("850")));
    let list = repo.list_clients(false).await.unwrap();
    assert_eq!(list.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Bageriet på hjørnet"]);

    let u = repo
        .update_client(&c.id, ClientPatch { name: Some("Bageriet på Østerbro".into()), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(u.name, "Bageriet på Østerbro");
    assert_eq!(repo.get_client(&c.id).await.unwrap().name, "Bageriet på Østerbro");

    repo.archive_client(&c.id).await.unwrap();
    assert!(repo.list_clients(false).await.unwrap().is_empty());
    let all = repo.list_clients(true).await.unwrap();
    assert!(all[0].archived());
    repo.unarchive_client(&c.id).await.unwrap();
    assert_eq!(repo.list_clients(false).await.unwrap().len(), 1);

    let missing = repo.get_client("00000000-0000-4000-8000-000000000000").await.unwrap_err();
    assert_eq!(missing, DataError::NotFound);
    let invalid = repo.create_client(NewClient { name: " ".into(), ..Default::default() }).await.unwrap_err();
    assert!(invalid.is_definite_rejection(), "{invalid:?}");
}

async fn projects(repo: &dyn Repository, _: &FakeClock) {
    let c = new_client(repo, "Kunde A", None).await;
    let p = repo
        .create_project(NewProject {
            name: "Ny webshop".into(),
            client_id: Some(c.id.clone()),
            url_patterns: vec!["github.com/bageriet/*".into()],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(p.status, ProjectStatus::Active);
    assert_eq!(p.client_id.as_deref(), Some(c.id.as_str()));

    let u = repo
        .update_project(&p.id, ProjectPatch { hourly_rate: Some(Some(d("950"))), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(u.hourly_rate, Some(d("950")));

    let rules = repo.matching_rules().await.unwrap();
    let r = rules.iter().find(|r| r.source == RuleSource::Project).expect("projektets mønster");
    assert_eq!(r.pattern, "github.com/bageriet/*");
    assert_eq!(r.project_id.as_deref(), Some(p.id.as_str()));
    assert_eq!(r.client_id.as_deref(), Some(c.id.as_str()));

    repo.set_project_status(&p.id, ProjectStatus::OnHold).await.unwrap();
    assert_eq!(repo.get_project(&p.id).await.unwrap().status, ProjectStatus::OnHold);
    repo.archive_project(&p.id).await.unwrap();
    assert!(repo.list_projects(false).await.unwrap().is_empty());
    assert_eq!(repo.list_projects(true).await.unwrap()[0].status, ProjectStatus::Archived);
}

async fn entries(repo: &dyn Repository, clock: &FakeClock) {
    let c = new_client(repo, "Kunde B", Some("850")).await;
    let p = repo
        .create_project(NewProject { name: "Drift".into(), client_id: Some(c.id.clone()), ..Default::default() })
        .await
        .unwrap();
    let start = clock.now();
    let key = uuid::Uuid::new_v4().to_string();
    let timed = NewTimeEntry {
        project_id: Some(p.id.clone()),
        start_time: Some(start),
        end_time: Some(start + chrono::Duration::minutes(90)),
        client_entry_id: Some(key.clone()),
        ..entry("Møde om æblekage", "1.5")
    };
    let first = repo.create_entry(timed.clone()).await.unwrap();
    assert!(!first.deduplicated && !first.queued);
    // Kunden arves fra projektet; timepris følger hierarkiet (kunde 850).
    assert_eq!(first.entry.client_id.as_deref(), Some(c.id.as_str()));
    assert_eq!(first.entry.billable_rate, Some(d("850")));
    assert_eq!(first.entry.description.as_deref(), Some("Møde om æblekage"));

    // Samme idempotensnøgle ⇒ samme post, ingen dublet.
    let again = repo.create_entry(timed).await.unwrap();
    assert!(again.deduplicated);
    assert_eq!(again.entry.id, first.entry.id);

    let untimed = repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("Mails", "0.25") }).await.unwrap();
    let today = repo.entries_for_day(day()).await.unwrap();
    assert_eq!(today.len(), 2);
    let week = repo.entries_for_week(day() + chrono::Duration::days(3)).await.unwrap();
    assert_eq!(week.len(), 2);
    let next_week = repo.entries_for_week(day() + chrono::Duration::days(7)).await.unwrap();
    assert!(next_week.is_empty());
    let only_untimed = repo.untimed_entries(day()).await.unwrap();
    assert_eq!(only_untimed.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), [untimed.entry.id.as_str()]);

    let updated = repo
        .update_entry(&untimed.entry.id, TimeEntryPatch { hours: Some(d("0.5")), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(updated.hours, d("0.5"));
    assert_eq!(repo.get_entry(&untimed.entry.id).await.unwrap().hours, d("0.5"));

    repo.delete_entry(&untimed.entry.id).await.unwrap();
    assert_eq!(repo.entries_for_day(day()).await.unwrap().len(), 1);

    let invalid = repo.create_entry(entry("", "1")).await.unwrap_err();
    assert!(invalid.is_definite_rejection(), "{invalid:?}");
    let backwards = NewTimeEntry {
        start_time: Some(start),
        end_time: Some(start - chrono::Duration::minutes(5)),
        ..entry("Baglæns", "1")
    };
    assert!(repo.create_entry(backwards).await.unwrap_err().is_definite_rejection());
}

async fn entry_times_can_be_cleared(repo: &dyn Repository, clock: &FakeClock) {
    let c = new_client(repo, "Tidskunde", None).await;
    let start = clock.now();
    let e = repo
        .create_entry(NewTimeEntry {
            client_id: Some(c.id.clone()),
            start_time: Some(start),
            end_time: Some(start + chrono::Duration::hours(1)),
            ..entry("Med tidspunkt", "1")
        })
        .await
        .unwrap();
    // En rettelse, der ikke rører tidspunktet, bevarer det.
    let renamed = repo
        .update_entry(&e.entry.id, TimeEntryPatch { description: Some("Omdøbt".into()), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(renamed.start_time, Some(start));
    // Some(None) gør den til en post uden tidspunkt.
    let cleared = repo
        .update_entry(&e.entry.id, TimeEntryPatch { start_time: Some(None), end_time: Some(None), ..Default::default() })
        .await
        .unwrap();
    assert_eq!((cleared.start_time, cleared.end_time, cleared.hours), (None, None, d("1")));
    let read = repo.get_entry(&e.entry.id).await.unwrap();
    assert_eq!((read.start_time, read.end_time, read.description.as_deref()), (None, None, Some("Omdøbt")));
    assert_eq!(repo.untimed_entries(day()).await.unwrap().len(), 1);
}

async fn klippekort(repo: &dyn Repository, _: &FakeClock) {
    let c = new_client(repo, "Klippekunde", Some("700")).await;
    let k = repo
        .create_klippekort(NewPrepaidPackage {
            name: "10 timer".into(),
            client_id: c.id.clone(),
            total_hours: d("10"),
            hourly_rate: d("700"),
            purchase_date: "2026-10-01".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(k.remaining_hours, d("10"));

    let e = repo
        .create_entry(NewTimeEntry {
            client_id: Some(c.id.clone()),
            prepaid_package_id: Some(k.id.clone()),
            ..entry("Support", "2")
        })
        .await
        .unwrap();
    let ded = e.prepaid_deduction.expect("klippekort-træk");
    assert_eq!(ded.hours_deducted, d("2"));
    assert_eq!(ded.remaining_hours, d("8"));
    let active = repo.list_klippekort(Some(&c.id), false).await.unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].remaining_hours, d("8"));

    // For meget på et kort med "block" afvises.
    let over = repo
        .create_entry(NewTimeEntry {
            client_id: Some(c.id.clone()),
            prepaid_package_id: Some(k.id.clone()),
            ..entry("For meget", "9")
        })
        .await
        .unwrap_err();
    assert!(over.is_definite_rejection(), "{over:?}");

    repo.delete_entry(&e.entry.id).await.unwrap();
    assert_eq!(repo.list_klippekort(Some(&c.id), false).await.unwrap()[0].remaining_hours, d("10"));

    repo.archive_klippekort(&k.id).await.unwrap();
    assert!(repo.list_klippekort(Some(&c.id), false).await.unwrap().is_empty());
    assert_eq!(repo.list_klippekort(Some(&c.id), true).await.unwrap().len(), 1);
}

async fn klippekort_edit(repo: &dyn Repository, _: &FakeClock) {
    let c = new_client(repo, "Klippekunde", Some("700")).await;
    let k = repo
        .create_klippekort(NewPrepaidPackage {
            name: "10 timer".into(),
            client_id: c.id.clone(),
            total_hours: d("10"),
            hourly_rate: d("700"),
            purchase_date: "2026-10-01".into(),
            expiry_date: Some("2027-10-01".into()),
            description: Some("Support".into()),
            clip_size_minutes: Some(15),
            ..Default::default()
        })
        .await
        .unwrap();
    repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), prepaid_package_id: Some(k.id.clone()), ..entry("Support", "4") })
        .await
        .unwrap();

    // Ny total: tilbage regnes om ud fra det brugte. Udløb ryddes; resten
    // (beskrivelse, klipstørrelse, købsdato) bevares.
    let u = repo
        .update_klippekort(
            &k.id,
            PrepaidPackagePatch {
                name: Some("12 timer".into()),
                total_hours: Some(d("12")),
                expiry_date: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!((u.name.as_str(), u.total_hours, u.used_hours, u.remaining_hours), ("12 timer", d("12"), d("4"), d("8")));
    let got = repo.list_klippekort(Some(&c.id), true).await.unwrap().remove(0);
    assert_eq!(got.expiry_date, None);
    assert_eq!(got.description.as_deref(), Some("Support"));
    assert_eq!(got.clip_size_minutes, Some(15));
    assert_eq!(got.purchase_date.map(|p| p.date_naive().to_string()).as_deref(), Some("2026-10-01"));
    assert_eq!(got.total_value, d("8400"));

    // En total under det brugte afvises, og kortet er uændret.
    let err = repo
        .update_klippekort(&k.id, PrepaidPackagePatch { total_hours: Some(d("3")), ..Default::default() })
        .await
        .unwrap_err();
    assert!(err.is_definite_rejection(), "{err:?}");
    assert_eq!(repo.list_klippekort(Some(&c.id), true).await.unwrap()[0].total_hours, d("12"));

    // Fyld op: total og tilbage stiger, brugt er uændret.
    let t = repo.top_up_klippekort(&k.id, d("5"), Some("Genkøb".into())).await.unwrap();
    assert_eq!((t.total_hours, t.used_hours, t.remaining_hours), (d("17"), d("4"), d("13")));
    assert!(repo.top_up_klippekort(&k.id, d("0"), None).await.is_err());
}

async fn rates_and_budget_can_be_removed(repo: &dyn Repository, _: &FakeClock) {
    let c = new_client(repo, "Satskunde", Some("850")).await;
    let cleared = repo
        .update_client(&c.id, ClientPatch { default_hourly_rate: Some(None), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(cleared.default_hourly_rate, None, "kunden falder tilbage til den globale sats");
    assert_eq!(repo.get_client(&c.id).await.unwrap().default_hourly_rate, None);
    // En anden rettelse rører ikke satsen.
    let c2 = new_client(repo, "Anden kunde", Some("600")).await;
    let renamed = repo
        .update_client(&c2.id, ClientPatch { name: Some("Anden kunde ApS".into()), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(renamed.default_hourly_rate, Some(d("600")));

    let p = repo
        .create_project(NewProject { name: "Budgetprojekt".into(), client_id: Some(c.id.clone()), hourly_rate: Some(d("900")), ..Default::default() })
        .await
        .unwrap();
    let with_budget = repo
        .update_project(&p.id, ProjectPatch { budget_hours: Some(Some(d("40"))), ..Default::default() })
        .await
        .unwrap();
    assert_eq!((with_budget.budget_hours, with_budget.hourly_rate), (Some(d("40")), Some(d("900"))));
    let without = repo
        .update_project(&p.id, ProjectPatch { budget_hours: Some(None), hourly_rate: Some(None), ..Default::default() })
        .await
        .unwrap();
    assert_eq!((without.budget_hours, without.hourly_rate), (None, None));
    assert_eq!(repo.get_project(&p.id).await.unwrap().budget_hours, None);
}

async fn timer_target(repo: &dyn Repository, clock: &FakeClock) {
    let a = new_client(repo, "Kunde A", Some("600")).await;
    let b = new_client(repo, "Kunde B", Some("800")).await;
    let p = repo
        .create_project(NewProject { name: "Projekt B".into(), client_id: Some(b.id.clone()), ..Default::default() })
        .await
        .unwrap();
    let task = repo
        .create_task(NewTask { title: "Opgave B".into(), project_id: Some(p.id.clone()), client_id: Some(b.id.clone()), ..Default::default() })
        .await
        .unwrap();
    let idle = repo.timer_set_target(StartTimer { description: "x".into(), ..Default::default() }).await.unwrap_err();
    assert!(matches!(idle, DataError::Conflict { .. }), "{idle:?}");

    let started = repo
        .timer_start(StartTimer { client_id: Some(a.id.clone()), description: "Forkert kunde".into(), ..Default::default() })
        .await
        .unwrap();
    clock.advance_minutes(30);
    let moved = repo
        .timer_set_target(StartTimer {
            project_id: Some(p.id.clone()),
            client_id: Some(b.id.clone()),
            task_id: Some(task.id.clone()),
            description: "Rigtig kunde".into(),
        })
        .await
        .unwrap();
    assert!(moved.is_running, "timeren kører videre");
    assert_eq!(moved.session_id, started.session_id, "samme session");
    assert_eq!((moved.project_id.as_deref(), moved.client_id.as_deref()), (Some(p.id.as_str()), Some(b.id.as_str())));
    assert_eq!(moved.task_id.as_deref(), Some(task.id.as_str()));
    assert_eq!(moved.elapsed_at(clock.now()), 1800, "tiden er bevaret");
    let read = repo.timer().await.unwrap();
    assert_eq!((read.description.as_str(), read.task_id.as_deref()), ("Rigtig kunde", Some(task.id.as_str())));

    // Også på en pauset timer, og intet mål (intern tid uden kunde) er lovligt.
    repo.timer_pause().await.unwrap();
    let cleared = repo.timer_set_target(StartTimer { description: "Intern".into(), ..Default::default() }).await.unwrap();
    assert!(!cleared.is_running && cleared.project_id.is_none() && cleared.client_id.is_none() && cleared.task_id.is_none());
    repo.timer_set_target(StartTimer {
        project_id: Some(p.id.clone()),
        client_id: Some(b.id.clone()),
        task_id: Some(task.id.clone()),
        description: "Rigtig kunde".into(),
    })
    .await
    .unwrap();
    repo.timer_resume().await.unwrap();
    clock.advance_minutes(30);
    let e = repo.timer_stop(StopTimer::default()).await.unwrap().entry.expect("post").entry;
    assert_eq!(e.hours, d("1"));
    assert_eq!((e.project_id.as_deref(), e.client_id.as_deref()), (Some(p.id.as_str()), Some(b.id.as_str())));
    assert_eq!(e.task_id.as_deref(), Some(task.id.as_str()));
    assert_eq!(e.description.as_deref(), Some("Rigtig kunde"));
}

async fn timer(repo: &dyn Repository, clock: &FakeClock) {
    let c = new_client(repo, "Timerkunde", Some("600")).await;
    let idle = repo.timer().await.unwrap();
    assert!(!idle.is_active());

    let t = repo
        .timer_start(StartTimer { client_id: Some(c.id.clone()), description: "Kodning".into(), ..Default::default() })
        .await
        .unwrap();
    assert!(t.is_running);
    assert!(t.version > idle.version);
    assert!(t.session_id.is_some());
    let busy = repo.timer_start(StartTimer { description: "Anden".into(), ..Default::default() }).await.unwrap_err();
    assert!(matches!(busy, DataError::Conflict { .. }), "{busy:?}");

    clock.advance_minutes(10);
    let paused = repo.timer_pause().await.unwrap();
    assert!(!paused.is_running);
    assert_eq!(paused.base_seconds, 600);
    assert!(paused.version > t.version);
    clock.advance_minutes(60); // pausen tæller ikke
    let resumed = repo.timer_resume().await.unwrap();
    assert!(resumed.is_running);
    clock.advance_minutes(20);

    let stopped = repo.timer_stop(StopTimer::default()).await.unwrap();
    assert!(!stopped.timer.is_active());
    let e = stopped.entry.expect("posten fra stoppet").entry;
    assert_eq!(e.hours, d("0.5"));
    assert_eq!(e.description.as_deref(), Some("Kodning"));
    assert_eq!(e.client_id.as_deref(), Some(c.id.as_str()));
    assert!(e.timer_session_id.is_some());
    assert!(matches!(repo.timer_stop(StopTimer::default()).await.unwrap_err(), DataError::Conflict { .. }));

    // Skift: stop den aktive og start en ny med det samme.
    repo.timer_start(StartTimer { description: "Opgave A".into(), client_id: Some(c.id.clone()), ..Default::default() })
        .await
        .unwrap();
    clock.advance_minutes(30);
    let switched = repo
        .timer_switch(StartTimer { description: "Opgave B".into(), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(switched.entry.unwrap().entry.description.as_deref(), Some("Opgave A"));
    assert!(switched.timer.is_running);
    assert_eq!(repo.timer().await.unwrap().description, "Opgave B");

    // Under ét minut gemmes ikke; kassering gemmer aldrig.
    let short = repo.timer_stop(StopTimer::default()).await.unwrap();
    assert!(short.entry.is_none());
    repo.timer_start(StartTimer { description: "Kasseres".into(), ..Default::default() }).await.unwrap();
    clock.advance_minutes(15);
    let discarded = repo.timer_stop(StopTimer { discard: true, ..Default::default() }).await.unwrap();
    assert!(discarded.entry.is_none());
    assert_eq!(repo.entries_for_day(day()).await.unwrap().len(), 2);
}

async fn timer_klippekort(repo: &dyn Repository, clock: &FakeClock) {
    let c = new_client(repo, "Kortkunde", Some("700")).await;
    let k = repo
        .create_klippekort(NewPrepaidPackage {
            name: "5 timer".into(),
            client_id: c.id.clone(),
            total_hours: d("5"),
            hourly_rate: d("700"),
            purchase_date: "2026-10-01".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    // Automatisk: kortet med autoDeduct trækkes.
    repo.timer_start(StartTimer { client_id: Some(c.id.clone()), description: "Auto".into(), ..Default::default() })
        .await
        .unwrap();
    clock.advance_minutes(60);
    let out = repo.timer_stop(StopTimer::default()).await.unwrap().entry.unwrap();
    assert_eq!(out.entry.prepaid_package_id.as_deref(), Some(k.id.as_str()));
    assert_eq!(out.prepaid_deduction.unwrap().remaining_hours, d("4"));

    // "Intet klippekort" valgt for timeren.
    repo.timer_start(StartTimer { client_id: Some(c.id.clone()), description: "Uden kort".into(), ..Default::default() })
        .await
        .unwrap();
    repo.set_prepaid_choice(Some(PrepaidChoice::None)).await.unwrap();
    clock.advance_minutes(30);
    let out = repo.timer_stop(StopTimer::default()).await.unwrap().entry.unwrap();
    assert_eq!(out.entry.prepaid_package_id, None);
    assert!(out.prepaid_deduction.is_none());
}

async fn klippekort_edge_cases(repo: &dyn Repository, clock: &FakeClock) {
    let c = new_client(repo, "Kantkunde", Some("700")).await;
    let small = repo
        .create_klippekort(NewPrepaidPackage {
            name: "Lille kort".into(),
            client_id: c.id.clone(),
            total_hours: d("0.5"),
            hourly_rate: d("700"),
            purchase_date: "2026-10-01".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    // Automatisk valgt kort med for lidt saldo må ikke blokere stoppet:
    // posten gemmes uden kort i stedet for at tiden går tabt.
    repo.timer_start(StartTimer { client_id: Some(c.id.clone()), description: "Lang".into(), ..Default::default() })
        .await
        .unwrap();
    clock.advance_minutes(120);
    let out = repo.timer_stop(StopTimer::default()).await.unwrap().entry.expect("posten gemmes");
    assert_eq!(out.entry.hours, d("2"));
    assert_eq!(out.entry.prepaid_package_id, None);
    assert!(!repo.timer().await.unwrap().is_active());
    assert_eq!(repo.list_klippekort(Some(&c.id), false).await.unwrap()[0].remaining_hours, d("0.5"));
    repo.archive_klippekort(&small.id).await.unwrap();

    // Politik "invoice": overløbet bliver fakturerbart, ikke tabt.
    let k = repo
        .create_klippekort(NewPrepaidPackage {
            name: "Fakturér overløb".into(),
            client_id: c.id.clone(),
            total_hours: d("2"),
            hourly_rate: d("700"),
            purchase_date: "2026-10-01".into(),
            overdraft_policy: Some("invoice".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    let before: rust_decimal::Decimal =
        repo.uninvoiced_entries(&c.id).await.unwrap().iter().map(|e| e.hours).sum();
    let e = repo
        .create_entry(NewTimeEntry { client_id: Some(c.id.clone()), prepaid_package_id: Some(k.id.clone()), ..entry("Over", "3") })
        .await
        .unwrap();
    assert!(e.prepaid_deduction.unwrap().overflowed_to_invoice);
    let after: rust_decimal::Decimal =
        repo.uninvoiced_entries(&c.id).await.unwrap().iter().map(|e| e.hours).sum();
    // Som web (tt-core): kortet røres ikke, og hele posten faktureres.
    assert_eq!(after - before, d("3"), "tiden ud over kortet skal kunne faktureres");
    assert_eq!(repo.list_klippekort(Some(&c.id), false).await.unwrap().iter().find(|p| p.id == k.id).unwrap().remaining_hours, d("2"));
}

async fn invoice_line_removed_releases_entry(repo: &dyn Repository, _: &FakeClock) {
    let c = new_client(repo, "Linjekunde", Some("500")).await;
    let a = repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("A", "1") }).await.unwrap();
    let b = repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("B", "2") }).await.unwrap();
    let inv = repo
        .create_invoice_draft(NewInvoiceDraft {
            client_id: c.id.clone(),
            time_entry_ids: vec![a.entry.id.clone(), b.entry.id.clone()],
            ..Default::default()
        })
        .await
        .unwrap();
    let lines: Vec<InvoiceLine> = repo
        .invoice_lines(&inv.id)
        .await
        .unwrap()
        .into_iter()
        .filter(|l| l.time_entry_id.as_deref() != Some(b.entry.id.as_str()))
        .collect();
    repo.save_invoice_lines(&inv.id, lines).await.unwrap();
    // B er ikke længere på fakturaen: den kan rettes og faktureres igen.
    let open = repo.uninvoiced_entries(&c.id).await.unwrap();
    assert_eq!(open.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), [b.entry.id.as_str()]);
    repo.update_entry(&b.entry.id, TimeEntryPatch { hours: Some(d("2.5")), ..Default::default() }).await.unwrap();
    assert!(repo.delete_entry(&a.entry.id).await.unwrap_err().is_definite_rejection());
}

async fn tasks(repo: &dyn Repository, _: &FakeClock) {
    let t = repo.create_task(NewTask { title: "Ret forsiden".into(), ..Default::default() }).await.unwrap();
    assert_eq!(t.status, TaskStatus::Backlog);
    repo.set_task_status(&t.id, TaskStatus::InProgress).await.unwrap();
    let doing = repo.list_tasks(TaskFilter { status: Some(TaskStatus::InProgress), ..Default::default() }).await.unwrap();
    assert_eq!(doing.len(), 1);
    let u = repo
        .update_task(&t.id, TaskPatch { title: Some("Ret forsiden på mobil".into()), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(u.title, "Ret forsiden på mobil");
    let logged = repo.log_task_time(&t.id, entry("Forside", "1.5")).await.unwrap();
    assert_eq!(logged.entry.task_id.as_deref(), Some(t.id.as_str()));
    let all = repo.list_tasks(TaskFilter::default()).await.unwrap();
    assert_eq!(all[0].tracked_minutes, Some(90));
    repo.set_task_status(&t.id, TaskStatus::Done).await.unwrap();
    assert!(repo.list_tasks(TaskFilter { status: Some(TaskStatus::InProgress), ..Default::default() }).await.unwrap().is_empty());
    assert!(repo.create_task(NewTask::default()).await.unwrap_err().is_definite_rejection());
}

async fn invoices(repo: &dyn Repository, _: &FakeClock) {
    let c = new_client(repo, "Fakturakunde", Some("850")).await;
    let a = repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("Design", "2") }).await.unwrap();
    let b = repo.create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("Kode", "1") }).await.unwrap();
    let open = repo.uninvoiced_entries(&c.id).await.unwrap();
    assert_eq!(open.len(), 2);
    let summary = repo.uninvoiced_summary().await.unwrap();
    let s = summary.iter().find(|s| s.client_id == c.id).unwrap();
    assert_eq!((s.hours, s.amount, s.entry_count), (d("3"), d("2550"), 2));

    let inv = repo
        .create_invoice_draft(NewInvoiceDraft {
            client_id: c.id.clone(),
            time_entry_ids: vec![a.entry.id.clone(), b.entry.id.clone()],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(inv.status, InvoiceStatus::Draft);
    assert_eq!(inv.amount, d("2550"));
    assert!(repo.uninvoiced_entries(&c.id).await.unwrap().is_empty());
    // Fakturerede poster er låst.
    let locked = repo.delete_entry(&a.entry.id).await.unwrap_err();
    assert!(locked.is_definite_rejection(), "{locked:?}");

    let mut lines = repo.invoice_lines(&inv.id).await.unwrap();
    assert_eq!(lines.len(), 2);
    lines[0].quantity = d("3");
    lines[0].amount = d("2550");
    repo.save_invoice_lines(&inv.id, lines).await.unwrap();
    assert_eq!(repo.get_invoice(&inv.id).await.unwrap().amount, d("3400"));

    let sent = repo.send_invoice(&inv.id).await.unwrap();
    assert_eq!(sent.status, InvoiceStatus::Sent);
    assert_eq!(sent.invoice_number, "INV-001");
    let paid = repo.mark_invoice_paid(&inv.id, Some(day())).await.unwrap();
    assert_eq!(paid.status, InvoiceStatus::Paid);
    assert_eq!(paid.paid_date.unwrap().date_naive(), day());
    assert_eq!(repo.list_invoices().await.unwrap().len(), 1);
    // Linjer på en afsendt faktura kan ikke rettes.
    assert!(repo.save_invoice_lines(&inv.id, vec![]).await.unwrap_err().is_definite_rejection());
}

async fn reports(repo: &dyn Repository, _: &FakeClock) {
    let a = new_client(repo, "Alfa", Some("1000")).await;
    let b = new_client(repo, "Beta", Some("500")).await;
    repo.create_entry(NewTimeEntry { client_id: Some(a.id.clone()), ..entry("x", "2") }).await.unwrap();
    repo.create_entry(NewTimeEntry { client_id: Some(b.id.clone()), ..entry("y", "3") }).await.unwrap();
    repo.create_entry(NewTimeEntry {
        client_id: Some(b.id.clone()),
        date: day() - chrono::Duration::days(40),
        ..entry("gammel", "9")
    })
    .await
    .unwrap();
    let r = repo
        .report(ReportQuery {
            start_date: day() - chrono::Duration::days(7),
            end_date: day(),
            grouping: ReportGrouping::Client,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(r.total_hours, d("5"));
    assert_eq!(r.total_amount, d("3500"));
    assert_eq!(r.rows[0].label, "Beta");
    assert!(tt_data::report::report_csv(&r).contains("Alfa;2,00;2,00;2000,00;1"));
}

async fn rules(repo: &dyn Repository, _: &FakeClock) {
    let c = new_client(repo, "Regelkunde", None).await;
    let rule = repo
        .upsert_rule(MatchingRule {
            id: String::new(),
            kind: RuleKind::Domain,
            pattern: "bageriet.dk".into(),
            project_id: None,
            client_id: Some(c.id.clone()),
            source: RuleSource::Learned,
            confirmations: 3,
            not_work: false,
            updated_at: None,
        })
        .await
        .unwrap();
    assert!(!rule.id.is_empty());
    let all = repo.matching_rules().await.unwrap();
    assert!(all.iter().any(|r| r.id == rule.id && r.pattern == "bageriet.dk"));
    repo.delete_rule(&rule.id).await.unwrap();
    assert!(!repo.matching_rules().await.unwrap().iter().any(|r| r.id == rule.id));
}

async fn client_domains_and_site_mappings(repo: &dyn Repository, _: &FakeClock) {
    // Kundens domæner normaliseres som i web.
    let c = repo
        .create_client(NewClient {
            name: "Domænekunde".into(),
            domains: vec!["https://www.Kunde.dk/om".into(), "kunde.dk".into(), "shop.kunde.dk".into()],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(c.domains, ["kunde.dk", "shop.kunde.dk"]);
    // En rettelse uden domæner rører dem ikke; Some(...) erstatter dem.
    repo.update_client(&c.id, ClientPatch { phone: Some("12345678".into()), ..Default::default() }).await.unwrap();
    assert_eq!(repo.get_client(&c.id).await.unwrap().domains, ["kunde.dk", "shop.kunde.dk"]);
    repo.update_client(&c.id, ClientPatch { domains: Some(vec!["andet.dk".into()]), ..Default::default() }).await.unwrap();
    assert_eq!(repo.get_client(&c.id).await.unwrap().domains, ["andet.dk"]);
    let bad = repo.update_client(&c.id, ClientPatch { domains: Some(vec!["ikke et domæne".into()]), ..Default::default() }).await;
    assert!(bad.unwrap_err().is_definite_rejection());

    // Site-koblinger: domæne-reglerne med mål, ikke "ikke arbejde".
    let rule = |pattern: &str, client: Option<&str>, not_work: bool| MatchingRule {
        id: String::new(),
        kind: RuleKind::Domain,
        pattern: pattern.into(),
        project_id: None,
        client_id: client.map(str::to_owned),
        source: RuleSource::Learned,
        confirmations: 2,
        not_work,
        updated_at: None,
    };
    repo.upsert_rule(rule("figma.com", Some(&c.id), false)).await.unwrap();
    repo.upsert_rule(rule("netbank.dk", None, true)).await.unwrap();
    let maps = repo.site_mappings().await.unwrap();
    assert_eq!(maps.len(), 1, "{maps:?}");
    assert_eq!((maps[0].domain.as_str(), maps[0].client_id.as_deref(), maps[0].usage_count), ("figma.com", Some(c.id.as_str()), 2));
    let rules = repo.matching_rules().await.unwrap();
    assert!(rules.iter().any(|r| r.not_work && r.pattern == "netbank.dk"));
}

async fn account(repo: &dyn Repository, _: &FakeClock) {
    let e = repo.entitlements().await.unwrap();
    assert!(e.features.time_tracking && e.features.invoices);
    let s = repo.session().await.unwrap();
    assert_eq!(s.mode, repo.mode());
    assert_eq!(s.device.device_id, "dev-test");
    assert_eq!(s.user.is_some(), repo.mode() == Mode::Cloud);
}

/// Idle-fradrag i stoppet (0.2.24, #10): posten gemmes kortet i samme kald,
/// med samme start og en tidligere slutning. Æder fradraget næsten hele
/// tiden (under ét minut tilbage), gemmes ingen post.
async fn timer_stop_subtracts_idle(repo: &dyn Repository, clock: &FakeClock) {
    let c = new_client(repo, "Idlekunde", None).await;
    repo.timer_start(StartTimer { description: "Idle".into(), client_id: Some(c.id.clone()), ..Default::default() })
        .await
        .unwrap();
    clock.advance_minutes(60);
    let stopped = repo.timer_stop(StopTimer { subtract_secs: 12 * 60, ..Default::default() }).await.unwrap();
    assert!(!stopped.timer.is_active());
    let e = stopped.entry.expect("posten fra stoppet").entry;
    assert_eq!(e.hours, d("0.8"), "60 minutter minus 12");
    let (start, end) = (e.start_time.unwrap(), e.end_time.unwrap());
    assert_eq!((end - start).num_minutes(), 48);
    let saved = repo.entries_for_day(day()).await.unwrap();
    let saved = saved.iter().find(|x| x.id == e.id).expect("gemt");
    assert_eq!(saved.hours, d("0.8"));

    repo.timer_start(StartTimer { description: "Væk".into(), client_id: Some(c.id.clone()), ..Default::default() })
        .await
        .unwrap();
    clock.advance_minutes(10);
    let all = repo.timer_stop(StopTimer { subtract_secs: 10 * 60, ..Default::default() }).await.unwrap();
    assert!(all.entry.is_none(), "intet tilbage at gemme");
    assert!(!all.timer.is_active());
}

/// Betalingsfrist og intern kunde (web's `paymentTermsDays` og
/// `defaultBillable`): sat ved oprettelse, uændret, når en rettelse ikke
/// nævner dem, og `Some(None)` fjerner fristen. Tid på en intern kunde er
/// ikke fakturerbar, når kalderen ikke siger andet.
async fn client_payment_terms_and_internal(repo: &dyn Repository, _: &FakeClock) {
    let c = repo
        .create_client(NewClient {
            name: "Kontoret".into(),
            payment_terms_days: Some(30),
            default_billable: Some(false),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!((c.payment_terms_days, c.default_billable), (Some(30), false));
    repo.update_client(&c.id, ClientPatch { phone: Some("12345678".into()), ..Default::default() }).await.unwrap();
    let got = repo.get_client(&c.id).await.unwrap();
    assert_eq!((got.payment_terms_days, got.default_billable), (Some(30), false), "uændret");
    let e = repo
        .create_entry(NewTimeEntry { client_id: Some(c.id.clone()), ..entry("Admin", "1") })
        .await
        .unwrap();
    assert_eq!(e.entry.is_billable, Some(false), "intern kunde: ikke fakturerbar");
    repo.update_client(
        &c.id,
        ClientPatch { payment_terms_days: Some(None), default_billable: Some(true), ..Default::default() },
    )
    .await
    .unwrap();
    let got = repo.get_client(&c.id).await.unwrap();
    assert_eq!((got.payment_terms_days, got.default_billable), (None, true));
    let plain = new_client(repo, "Almindelig", None).await;
    assert_eq!((plain.payment_terms_days, plain.default_billable), (None, true));
}

// ------------------------------------------------------------------ kørsel

macro_rules! contract {
    ($($name:ident),* $(,)?) => {
        $(
            mod $name {
                use super::*;

                #[test]
                fn local() {
                    let clock = FakeClock::new();
                    let repo = common::local(&clock);
                    block_on(super::$name(&repo, &clock));
                }

                #[test]
                fn cloud() {
                    let clock = FakeClock::new();
                    let (_mock, repo) = common::cloud(&clock);
                    block_on(super::$name(&repo, &clock));
                }
            }
        )*
    };
}

contract!(
    clients,
    projects,
    entries,
    entry_times_can_be_cleared,
    klippekort,
    klippekort_edge_cases,
    klippekort_edit,
    rates_and_budget_can_be_removed,
    timer,
    timer_target,
    timer_klippekort,
    tasks,
    invoices,
    invoice_line_removed_releases_entry,
    reports,
    rules,
    client_domains_and_site_mappings,
    account,
    timer_stop_subtracts_idle,
    client_payment_terms_and_internal,
);
