//! Lokal → cloud: alle entiteter uden tab (fixture med 1.200 poster),
//! dry-run uden skrivninger, og idempotens ved gentagelse.

mod common;

use common::*;
use futures_lite::future::block_on;
use tt_data::import::{dry_run, export_local};
use tt_data::*;

struct Fixture {
    entries: usize,
    total_hours: rust_decimal::Decimal,
    klippekort_remaining: rust_decimal::Decimal,
}

fn build(repo: &LocalRepo) -> Fixture {
    block_on(async {
        let mut clients = Vec::new();
        for (i, name) in ["Bageriet på hjørnet", "Ærø Cykler", "Østerbro Tandlæger"].iter().enumerate() {
            clients.push(
                repo.create_client(NewClient {
                    name: (*name).into(),
                    default_hourly_rate: Some(d(&format!("{}", 600 + i * 100))),
                    domains: if i == 0 { vec!["https://www.Bageriet.dk/kontakt".into()] } else { vec![] },
                    ..Default::default()
                })
                .await
                .unwrap(),
            );
        }
        let mut projects = Vec::new();
        for i in 0..6 {
            projects.push(
                repo.create_project(NewProject {
                    name: format!("Projekt {i}"),
                    client_id: Some(clients[i % 3].id.clone()),
                    url_patterns: vec![format!("github.com/kunde{i}/*")],
                    ..Default::default()
                })
                .await
                .unwrap(),
            );
        }
        repo.set_project_status(&projects[5].id, ProjectStatus::Completed).await.unwrap();
        let k = repo
            .create_klippekort(NewPrepaidPackage {
                name: "Supportkort".into(),
                client_id: clients[0].id.clone(),
                total_hours: d("40"),
                hourly_rate: d("650"),
                purchase_date: "2026-08-01".into(),
                ..Default::default()
            })
            .await
            .unwrap();
        let task = repo
            .create_task(NewTask { title: "Ny forside".into(), project_id: Some(projects[0].id.clone()), ..Default::default() })
            .await
            .unwrap();
        // Et brugt og arkiveret kort (ingen poster trækker på det).
        let old = repo
            .create_klippekort(NewPrepaidPackage {
                name: "Gammelt kort".into(),
                client_id: clients[1].id.clone(),
                total_hours: d("10"),
                hourly_rate: d("600"),
                purchase_date: "2025-01-01".into(),
                ..Default::default()
            })
            .await
            .unwrap();
        repo.archive_klippekort(&old.id).await.unwrap();
        let mut total = d("0");
        let mut invoice_entries = Vec::new();
        let n = 1200;
        for i in 0..n {
            let date = day() - chrono::Duration::days((i % 60) as i64);
            let hours = d(["0.25", "0.5", "1", "1.75", "2.5"][i % 5]);
            let start = date.and_hms_opt(8 + (i % 8) as u32, 0, 0).unwrap().and_utc();
            let timed = i % 3 != 0;
            let prepaid = i % 100 == 0 && i < 1000;
            let input = NewTimeEntry {
                project_id: if prepaid { None } else { Some(projects[i % 6].id.clone()) },
                client_id: prepaid.then(|| clients[0].id.clone()),
                prepaid_package_id: prepaid.then(|| k.id.clone()),
                task_id: (i % 50 == 0 && !prepaid).then(|| task.id.clone()),
                description: format!("Arbejde nr. {i}: æøå"),
                hours,
                date,
                start_time: timed.then_some(start),
                end_time: timed.then(|| start + chrono::Duration::minutes(15)),
                ..Default::default()
            };
            let e = repo.create_entry(input).await.unwrap();
            if i % 6 == 1 && invoice_entries.len() < 3 {
                invoice_entries.push(e.entry.id.clone());
            }
            total += hours;
        }
        let inv = repo
            .create_invoice_draft(NewInvoiceDraft {
                client_id: clients[1].id.clone(),
                time_entry_ids: invoice_entries,
                ..Default::default()
            })
            .await
            .unwrap();
        // En rettet linje: fakturaen følger linjerne, ikke timer × sats.
        let mut lines = repo.invoice_lines(&inv.id).await.unwrap();
        lines[0].description = "Rabat på første post".into();
        lines[0].unit_price = d("100");
        lines[0].amount = (lines[0].quantity * d("100")).round_dp(2);
        repo.save_invoice_lines(&inv.id, lines).await.unwrap();
        repo.send_invoice(&inv.id).await.unwrap();
        repo.archive_client(&clients[2].id).await.unwrap();
        repo.upsert_rule(MatchingRule {
            id: String::new(),
            kind: RuleKind::Repo,
            pattern: "git@github.com:bageriet/webshop.git".into(),
            project_id: Some(projects[0].id.clone()),
            client_id: None,
            source: RuleSource::Learned,
            confirmations: 5,
            not_work: false,
            updated_at: None,
        })
        .await
        .unwrap();
        // "Ikke arbejde" uden mål.
        repo.upsert_rule(MatchingRule {
            id: String::new(),
            kind: RuleKind::Domain,
            pattern: "netbank.dk".into(),
            project_id: None,
            client_id: None,
            source: RuleSource::User,
            confirmations: 0,
            not_work: true,
            updated_at: None,
        })
        .await
        .unwrap();
        let remaining = repo.list_klippekort(None, true).await.unwrap().iter().find(|p| p.id == k.id).unwrap().remaining_hours;
        Fixture { entries: n, total_hours: total, klippekort_remaining: remaining }
    })
}

#[test]
fn imports_everything_once_without_loss() {
    let clock = FakeClock::new();
    let local = local(&clock);
    let fx = build(&local);
    let bundle = export_local(&local, "dev-test", clock.now()).unwrap();
    assert_eq!(bundle.time_entries.len(), fx.entries);

    // Lokal dry-run: hvad der flyttes, uden netværk.
    let report = dry_run(&bundle);
    assert!(report.can_import(), "{:?}", report.errors);
    assert_eq!(report.counts.clients, 3);
    assert_eq!(report.counts.projects, 6);
    assert_eq!(report.counts.klippekort, 2);
    assert_eq!(report.counts.tasks, 1);
    assert_eq!(report.counts.time_entries, 1200);
    assert_eq!(report.counts.invoices, 1);
    assert_eq!(report.counts.rules, 2, "projekt-mønstre følger projekterne");
    assert_eq!(report.total_hours, fx.total_hours);
    assert!(report.warnings.iter().any(|w| w.contains("Fakturanumre")));

    // Serverens dry-run skriver intet.
    let (mock, cloud) = common::cloud(&clock);
    // Alt kommer med: også opgaver, regler (også "ikke arbejde"),
    // fakturalinjer og arkiverede klippekort.
    let expected = report.counts;
    let dry = block_on(cloud.import_bundle(&bundle, true)).unwrap();
    assert!(dry.dry_run);
    assert_eq!(dry.created, expected, "{:?}", dry.errors);
    assert!(dry.errors.is_empty(), "{:?}", dry.errors);
    assert!(dry.warnings.iter().all(|w| !w.contains("opgaver") && !w.contains("klippekort")), "{:?}", dry.warnings);
    // Web's form: top-level lister med localId (højst 64 tegn) og data.
    // Fakturaen sendes med sine 3 poster (ved dry-run kender et kald kun
    // sine egne id'er), resten i bidder á 500: 1 + 3 kald.
    assert_eq!(mock.calls("extension.import.run"), 4);
    let sent = mock.last_input("extension.import.run").unwrap();
    assert!(sent.get("bundle").is_none());
    assert_eq!(sent["clients"].as_array().unwrap().len(), 3);
    assert_eq!(sent["entries"].as_array().unwrap().len(), 197);
    assert!(sent["invoices"].as_array().unwrap().is_empty());
    let e0 = &sent["entries"][0];
    assert!(e0["localId"].as_str().unwrap().len() <= 64);
    assert!(e0["data"]["hours"].is_number());
    assert!(e0["data"].get("clientEntryId").is_none(), "web afleder nøglen selv");
    assert_eq!(sent["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(sent["rules"].as_array().unwrap().len(), 2);
    // Arkiveringen sendes kun i sidste kald (efter alle poster).
    let calls = mock.inputs("extension.import.run");
    let archived_in = |c: &serde_json::Value| c["prepaidPackages"].as_array().unwrap().iter().any(|p| p["isArchived"] == true);
    assert!(!archived_in(&calls[0]) && archived_in(calls.last().unwrap()));
    // Fakturaen har sine linjer med, med lokale post-referencer.
    let inv_call = calls.iter().find(|c| !c["invoices"].as_array().unwrap().is_empty()).unwrap();
    let lines = inv_call["invoices"][0]["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 3);
    assert!(lines.iter().all(|l| l["entryLocalId"].is_string() && l["amount"].is_string()));
    assert!(block_on(mock.repo().list_entries(EntryFilter::default())).unwrap().is_empty());

    // Rigtig import.
    let done = block_on(cloud.import_bundle(&bundle, false)).unwrap();
    assert_eq!(done.created, expected, "{:?}", done.errors);
    assert_eq!(done.skipped.total(), 0);

    // Alt er på serveren, læst gennem CloudRepo.
    let server_entries = block_on(cloud.list_entries(EntryFilter::default())).unwrap();
    assert_eq!(server_entries.len(), 1200);
    let hours: rust_decimal::Decimal = server_entries.iter().map(|e| e.hours).sum();
    assert_eq!(hours, fx.total_hours);
    let mut descs: Vec<_> = server_entries.iter().filter_map(|e| e.description.clone()).collect();
    descs.sort();
    descs.dedup();
    assert_eq!(descs.len(), 1200, "hver post præcis én gang");
    assert_eq!(server_entries.iter().filter(|e| e.has_time_range()).count(), 800);
    assert_eq!(block_on(cloud.list_clients(true)).unwrap().len(), 3);
    assert_eq!(block_on(cloud.list_clients(false)).unwrap().len(), 2, "arkiveret kunde forbliver arkiveret");
    let projects = block_on(cloud.list_projects(true)).unwrap();
    assert_eq!(projects.len(), 6);
    assert_eq!(projects.iter().filter(|p| p.status == ProjectStatus::Completed).count(), 1);
    let k = block_on(cloud.list_klippekort(None, true)).unwrap();
    let support = k.iter().find(|p| p.name == "Supportkort").unwrap();
    assert_eq!(support.remaining_hours, fx.klippekort_remaining, "saldoen er den samme efter træk");
    let old = k.iter().find(|p| p.name == "Gammelt kort").unwrap();
    assert_eq!(old.is_archived, Some(true), "arkiveret kort forbliver arkiveret");
    let invoices = block_on(cloud.list_invoices()).unwrap();
    assert_eq!(invoices.len(), 1);
    assert_eq!(invoices[0].status, InvoiceStatus::Sent);
    let local_lines = block_on(local.invoice_lines(&bundle.invoices[0].item.invoice.id)).unwrap();
    let server_lines = block_on(cloud.invoice_lines(&invoices[0].id)).unwrap();
    let shape = |ls: &[InvoiceLine]| ls.iter().map(|l| (l.description.clone(), l.amount)).collect::<Vec<_>>();
    assert_eq!(shape(&server_lines), shape(&local_lines), "linjerne er de samme");
    assert_eq!(invoices[0].amount, local_lines.iter().map(|l| l.amount).sum::<rust_decimal::Decimal>());
    let tasks = block_on(cloud.list_tasks(TaskFilter::default())).unwrap();
    assert_eq!(tasks.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["Ny forside"]);
    assert_eq!(server_entries.iter().filter(|e| e.task_id.as_deref() == Some(tasks[0].id.as_str())).count(), bundle.time_entries.iter().filter(|k| k.item.task_id.is_some()).count(), "posterne har opgaven");
    let rules = block_on(cloud.matching_rules()).unwrap();
    assert_eq!(rules.iter().filter(|r| r.source != RuleSource::Project).count(), 2);
    assert!(rules.iter().any(|r| r.not_work && r.pattern == "netbank.dk" && r.project_id.is_none()));
    assert_eq!(rules.iter().filter(|r| r.source == RuleSource::Project).count(), 5, "aktive projekters mønstre");
    let bageriet = block_on(cloud.list_clients(true)).unwrap().into_iter().find(|c| c.name == "Bageriet på hjørnet").unwrap();
    assert_eq!(bageriet.domains, ["bageriet.dk"], "kundens domæner følger med");

    // Et gentaget (fx afbrudt) import opretter intet nyt.
    let again = block_on(cloud.import_bundle(&bundle, false)).unwrap();
    assert_eq!(again.created.total(), 0);
    assert_eq!(again.skipped, expected);
    assert_eq!(block_on(mock.repo().list_entries(EntryFilter::default())).unwrap().len(), 1200);
}

#[test]
fn billed_entries_without_an_imported_invoice_stay_billed() {
    let clock = FakeClock::new();
    let local = local(&clock);
    let c = block_on(local.create_client(NewClient { name: "Kunde".into(), ..Default::default() })).unwrap();
    for desc in ["Faktureret andetsteds", "Åben"] {
        block_on(local.create_entry(NewTimeEntry {
            client_id: Some(c.id.clone()),
            description: desc.into(),
            hours: d("1"),
            date: day(),
            ..Default::default()
        }))
        .unwrap();
    }
    let mut bundle = export_local(&local, "dev-test", clock.now()).unwrap();
    // Fx på en kreditnota, der ikke importeres, eller markeret manuelt.
    let billed = bundle.time_entries.iter_mut().find(|k| k.item.description.as_deref() == Some("Faktureret andetsteds")).unwrap();
    billed.item.is_billed = Some(true);
    let (mock, cloud) = common::cloud(&clock);
    block_on(cloud.import_bundle(&bundle, false)).unwrap();
    let sent = mock.last_input("extension.import.run").unwrap();
    let flags: Vec<Option<bool>> = sent["entries"].as_array().unwrap().iter().map(|e| e["data"]["isBilled"].as_bool()).collect();
    assert_eq!(flags.iter().filter(|f| **f == Some(true)).count(), 1);
    let open = block_on(cloud.uninvoiced_entries(&block_on(cloud.list_clients(false)).unwrap()[0].id)).unwrap();
    assert_eq!(open.iter().map(|e| e.description.as_deref().unwrap_or("")).collect::<Vec<_>>(), ["Åben"], "den fakturerede er ikke åben i web");
}

#[test]
fn broken_references_stop_the_import() {
    let clock = FakeClock::new();
    let local = local(&clock);
    let c = block_on(local.create_client(NewClient { name: "A".into(), ..Default::default() })).unwrap();
    block_on(local.create_entry(NewTimeEntry {
        client_id: Some(c.id.clone()),
        description: "x".into(),
        hours: d("1"),
        date: day(),
        ..Default::default()
    }))
    .unwrap();
    let mut bundle = export_local(&local, "dev-test", clock.now()).unwrap();
    bundle.clients.clear();
    let report = dry_run(&bundle);
    assert!(!report.can_import());
    let (mock, cloud) = common::cloud(&clock);
    assert!(matches!(block_on(cloud.import_bundle(&bundle, false)), Err(DataError::Validation(_))));
    assert_eq!(mock.calls("extension.import.run"), 0);
}
