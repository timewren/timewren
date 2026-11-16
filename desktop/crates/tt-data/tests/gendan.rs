//! Genskabte 0.2-funktioner i lokal tilstand: fakturaopsætning, nummerering,
//! titel/forfald/noter, sletning af kladder.

mod common;

use common::*;
use futures_lite::future::block_on;
use tt_data::*;

fn profile() -> InvoiceProfile {
    InvoiceProfile {
        company_name: "Acme".into(),
        cvr: "39413892".into(),
        address: "Testvej 1\n8000 Aarhus C".into(),
        bank_reg: "1234".into(),
        bank_account: "12345678".into(),
        payment_terms_days: 8,
        number_prefix: "2026-".into(),
        next_number: 7,
        ..InvoiceProfile::default()
    }
}

async fn draft(repo: &LocalRepo, hours: &str) -> Invoice {
    let clients = repo.list_clients(true).await.unwrap();
    let client = match clients.into_iter().next() {
        Some(c) => c,
        None => repo
            .create_client(NewClient {
                name: "Bageriet".into(),
                default_hourly_rate: Some(d("850")),
                ..Default::default()
            })
            .await
            .unwrap(),
    };
    let e = repo
        .create_entry(NewTimeEntry {
            client_id: Some(client.id.clone()),
            description: "Webshop".into(),
            hours: d(hours),
            date: day(),
            ..Default::default()
        })
        .await
        .unwrap();
    repo.create_invoice_draft(NewInvoiceDraft {
        client_id: client.id,
        time_entry_ids: vec![e.entry.id],
        ..Default::default()
    })
    .await
    .unwrap()
}

#[test]
fn profil_gemmes_og_valideres() {
    let clock = FakeClock::new();
    let repo = local(&clock);
    assert!(!repo.has_invoice_profile().unwrap());
    assert_eq!(repo.invoice_profile().unwrap(), InvoiceProfile::default());
    let saved = repo.save_invoice_profile(profile()).unwrap();
    assert_eq!(repo.invoice_profile().unwrap(), saved);
    assert!(repo.has_invoice_profile().unwrap());

    let bad = InvoiceProfile { cvr: "1234".into(), ..profile() };
    assert!(matches!(repo.save_invoice_profile(bad), Err(DataError::Validation(m)) if m.contains("CVR")));
    let bad = InvoiceProfile { bank_reg: "12a4".into(), ..profile() };
    assert!(repo.save_invoice_profile(bad).is_err());
    // Det afviste er ikke gemt.
    assert_eq!(repo.invoice_profile().unwrap().cvr, "39413892");
}

#[test]
fn mangler_til_en_gyldig_faktura() {
    assert_eq!(profile().missing(), Vec::<&str>::new());
    let mp_only = InvoiceProfile { bank_reg: "".into(), bank_account: "".into(), mobilepay: "12345".into(), ..profile() };
    assert!(mp_only.missing().is_empty());
    let empty = InvoiceProfile::default();
    assert_eq!(empty.missing(), ["firmanavn", "CVR", "adresse", "bankkonto eller MobilePay"]);
}

#[test]
fn nummer_med_praefiks_og_taeller() {
    let p = InvoiceProfile { number_prefix: "2026-".into(), next_number: 1, ..InvoiceProfile::default() };
    assert_eq!(p.next_invoice_number([]), ("2026-1".into(), 1));
    // Fortsætter efter det højeste med samme præfiks og samme bredde.
    assert_eq!(p.next_invoice_number(["2026-009", "INV-120", "2026-x"]), ("2026-010".into(), 10));
    // Tælleren vinder, hvis den er højere.
    let p = InvoiceProfile { next_number: 40, ..p };
    assert_eq!(p.next_invoice_number(["2026-9"]), ("2026-40".into(), 40));
    // Tomt præfiks: kun rene tal tæller.
    let p = InvoiceProfile { number_prefix: "".into(), next_number: 1, ..p };
    assert_eq!(p.next_invoice_number(["INV-005", "12"]), ("13".into(), 13));
}

#[test]
fn udstedelse_bruger_opsaetningen_og_taeller_op() {
    let clock = FakeClock::new();
    let repo = local(&clock);
    // Uden opsætning: web's række.
    let a = sent(&repo, block_on(draft(&repo, "1")));
    assert_eq!(a.invoice_number, "INV-001");
    repo.save_invoice_profile(profile()).unwrap();
    let b = sent(&repo, block_on(draft(&repo, "1")));
    assert_eq!(b.invoice_number, "2026-7");
    let c = sent(&repo, block_on(draft(&repo, "2")));
    assert_eq!(c.invoice_number, "2026-8");
    assert_eq!(repo.invoice_profile().unwrap().next_number, 9);
}

#[test]
fn betalingsfrist_fra_opsaetningen() {
    let clock = FakeClock::new();
    let repo = local(&clock);
    repo.save_invoice_profile(profile()).unwrap();
    let inv = block_on(draft(&repo, "1"));
    let days = (inv.due_date.unwrap() - inv.issue_date.unwrap()).num_days();
    assert_eq!(days, 8);
}

#[test]
fn titel_forfald_og_noter_rettes() {
    let clock = FakeClock::new();
    let repo = local(&clock);
    let inv = block_on(draft(&repo, "1"));
    let due = day() + chrono::Days::new(30);
    let u = block_on(repo.update_invoice_details(&inv.id, Some(" Webshop, oktober ".into()), due, Some("Tak!".into())))
        .unwrap();
    assert_eq!(u.title.as_deref(), Some("Webshop, oktober"));
    assert_eq!(u.notes.as_deref(), Some("Tak!"));
    let back = block_on(repo.get_invoice(&inv.id)).unwrap();
    assert_eq!(back.title.as_deref(), Some("Webshop, oktober"));
    assert_eq!(back.due_date.unwrap().date_naive(), due);

    // Sendt: forfald må forlænges, titel ikke ændres.
    block_on(repo.send_invoice(&inv.id)).unwrap();
    let later = due + chrono::Days::new(7);
    block_on(repo.update_invoice_details(&inv.id, back.title.clone(), later, back.notes.clone())).unwrap();
    assert!(block_on(repo.update_invoice_details(&inv.id, Some("Ny".into()), later, back.notes.clone())).is_err());
    // Betalt: intet.
    block_on(repo.mark_invoice_paid(&inv.id, None)).unwrap();
    assert!(block_on(repo.update_invoice_details(&inv.id, back.title, later, back.notes)).is_err());
}

/// Review-fund: 0.2's fakturaer har ofte noter = "". Forfaldet skal kunne
/// forlænges på en sendt faktura uden at noterne regnes som ændret.
#[test]
fn forfald_forlaenges_paa_sendt_faktura_med_tomme_noter() {
    let clock = FakeClock::new();
    let repo = local(&clock);
    let c = block_on(repo.create_client(NewClient { name: "Bageriet".into(), ..Default::default() })).unwrap();
    let e = block_on(repo.create_entry(NewTimeEntry {
        client_id: Some(c.id.clone()),
        description: "Webshop".into(),
        hours: d("1"),
        date: day(),
        ..Default::default()
    }))
    .unwrap();
    let inv = block_on(repo.create_invoice_draft(NewInvoiceDraft {
        client_id: c.id,
        time_entry_ids: vec![e.entry.id],
        notes: Some(" ".into()),
        ..Default::default()
    }))
    .unwrap();
    let inv = sent(&repo, inv);
    let later = day() + chrono::Days::new(40);
    block_on(repo.update_invoice_details(&inv.id, None, later, None)).unwrap();
}

#[test]
fn kladde_slettes_og_posterne_frigives() {
    let clock = FakeClock::new();
    let repo = local(&clock);
    let inv = block_on(draft(&repo, "1.5"));
    assert!(block_on(repo.uninvoiced_entries(&inv.client_id)).unwrap().is_empty());
    block_on(repo.delete_invoice_draft(&inv.id)).unwrap();
    assert!(matches!(block_on(repo.get_invoice(&inv.id)), Err(DataError::NotFound)));
    assert_eq!(block_on(repo.uninvoiced_entries(&inv.client_id)).unwrap().len(), 1);
    // En udstedt faktura kan ikke slettes.
    let udstedt = sent(&repo, block_on(draft(&repo, "1")));
    assert!(matches!(block_on(repo.delete_invoice_draft(&udstedt.id)), Err(DataError::Validation(_))));
}

#[test]
fn cloud_retter_forfald_og_noter_via_web() {
    let clock = FakeClock::new();
    let (_mock, repo) = cloud(&clock);
    let c = block_on(repo.create_client(NewClient {
        name: "Bageriet".into(),
        default_hourly_rate: Some(d("850")),
        ..Default::default()
    }))
    .unwrap();
    let p = block_on(repo.create_project(NewProject {
        name: "Webshop".into(),
        client_id: Some(c.id.clone()),
        ..Default::default()
    }))
    .unwrap();
    let e = block_on(repo.create_entry(NewTimeEntry {
        project_id: Some(p.id.clone()),
        client_id: Some(c.id.clone()),
        description: "Webshop".into(),
        hours: d("1"),
        date: day(),
        ..Default::default()
    }))
    .unwrap();
    let inv = block_on(repo.create_invoice_draft(NewInvoiceDraft {
        client_id: c.id,
        time_entry_ids: vec![e.entry.id],
        ..Default::default()
    }))
    .unwrap();
    let due = day() + chrono::Days::new(21);
    let u = block_on(repo.update_invoice_details(&inv.id, due, Some("Betal venligst".into()))).unwrap();
    assert_eq!(u.notes.as_deref(), Some("Betal venligst"));
    assert_eq!(u.due_date.unwrap().date_naive(), due);
}

// ------------------------------------------------------------------ klippekort

async fn card(repo: &dyn Repository, client: &str, hours: &str) -> PrepaidPackage {
    repo.create_klippekort(NewPrepaidPackage {
        name: "10 timer".into(),
        client_id: client.into(),
        total_hours: d(hours),
        hourly_rate: d("700"),
        purchase_date: (day() - chrono::Days::new(30)).to_string(),
        ..Default::default()
    })
    .await
    .unwrap()
}

#[test]
fn klippekort_arkiveres_genaktiveres_og_kun_tomme_slettes() {
    let clock = FakeClock::new();
    let repo = local(&clock);
    let c = block_on(repo.create_client(NewClient { name: "Bageriet".into(), ..Default::default() })).unwrap();
    let brugt = block_on(card(&repo, &c.id, "10"));
    let tom = block_on(card(&repo, &c.id, "5"));
    block_on(repo.create_entry(NewTimeEntry {
        client_id: Some(c.id.clone()),
        description: "Kurv".into(),
        hours: d("1"),
        date: day(),
        prepaid_package_id: Some(brugt.id.clone()),
        ..Default::default()
    }))
    .unwrap();
    let all = block_on(repo.list_klippekort(None, true)).unwrap();
    assert!(all.iter().any(|k| k.id == brugt.id && k.used_hours > d("0")), "posten trak fra kortet");

    block_on(repo.archive_klippekort(&brugt.id)).unwrap();
    let k = block_on(repo.list_klippekort(None, true)).unwrap().into_iter().find(|k| k.id == brugt.id).unwrap();
    assert_eq!(k.is_archived, Some(true));
    block_on(repo.unarchive_klippekort(&brugt.id)).unwrap();
    let k = block_on(repo.list_klippekort(None, true)).unwrap().into_iter().find(|k| k.id == brugt.id).unwrap();
    assert_eq!((k.is_archived, k.is_active), (Some(false), true), "saldo tilbage = aktivt igen");

    assert!(matches!(block_on(repo.delete_klippekort(&brugt.id)), Err(DataError::Validation(_))));
    block_on(repo.delete_klippekort(&tom.id)).unwrap();
    assert!(block_on(repo.list_klippekort(None, true)).unwrap().iter().all(|k| k.id != tom.id));
    assert!(matches!(block_on(repo.delete_klippekort(&tom.id)), Err(DataError::NotFound)));
}

#[test]
fn udloebet_kort_hentes_frem_som_inaktivt() {
    let clock = FakeClock::new();
    let repo = local(&clock);
    let c = block_on(repo.create_client(NewClient { name: "Bageriet".into(), ..Default::default() })).unwrap();
    let k = block_on(repo.create_klippekort(NewPrepaidPackage {
        name: "Gammelt".into(),
        client_id: c.id.clone(),
        total_hours: d("10"),
        hourly_rate: d("700"),
        purchase_date: (day() - chrono::Days::new(400)).to_string(),
        expiry_date: Some((day() - chrono::Days::new(30)).to_string()),
        ..Default::default()
    }))
    .unwrap();
    block_on(repo.archive_klippekort(&k.id)).unwrap();
    block_on(repo.unarchive_klippekort(&k.id)).unwrap();
    let k = block_on(repo.list_klippekort(None, true)).unwrap().into_iter().find(|x| x.id == k.id).unwrap();
    assert_eq!((k.is_archived, k.is_active), (Some(false), false), "udløbet = ikke aktivt");
}

#[test]
fn backup_med_trigger_afvises() {
    let dir = tempfile::tempdir().unwrap();
    let clock = FakeClock::new();
    let repo = LocalRepo::open(dir.path().join("local.db"), device()).unwrap().with_clock(clock.clock());
    let f = dir.path().join("t.ttbackup");
    repo.export_backup(&f, &[]).unwrap();
    rusqlite::Connection::open(&f)
        .unwrap()
        .execute_batch("CREATE TRIGGER t AFTER INSERT ON clients BEGIN DELETE FROM clients; END;")
        .unwrap();
    assert!(matches!(inspect_backup(&f), Err(DataError::Validation(m)) if m.contains("ukendte")));
}

#[test]
fn cloud_genaktiverer_via_webs_archive() {
    let clock = FakeClock::new();
    let (_mock, repo) = cloud(&clock);
    let c = block_on(repo.create_client(NewClient { name: "Bageriet".into(), ..Default::default() })).unwrap();
    let k = block_on(card(&repo, &c.id, "10"));
    block_on(repo.archive_klippekort(&k.id)).unwrap();
    // To gange "hent frem" må ikke arkivere igen (web skifter tilstand).
    block_on(repo.unarchive_klippekort(&k.id)).unwrap();
    block_on(repo.unarchive_klippekort(&k.id)).unwrap();
    let k = block_on(repo.list_klippekort(None, true)).unwrap().into_iter().find(|x| x.id == k.id).unwrap();
    assert_eq!(k.is_archived, Some(false));
}

// ------------------------------------------------------------------ backup

use tt_data::local::backup::{BACKUP_FORMAT, inspect_backup};

#[test]
fn backup_og_gendan_rundtur() {
    let dir = tempfile::tempdir().unwrap();
    let clock = FakeClock::new();
    let repo = LocalRepo::open(dir.path().join("local.db"), device()).unwrap().with_clock(clock.clock());
    repo.save_invoice_profile(profile()).unwrap();
    let inv = block_on(draft(&repo, "2"));
    let file = dir.path().join("backup.ttbackup");
    let info = repo.export_backup(&file, &[("settings.json", "{\"a\":1}")]).unwrap();
    assert_eq!((info.clients, info.entries, info.invoices), (1, 1, 1));
    assert_eq!(info.files.get("settings.json").map(String::as_str), Some("{\"a\":1}"));
    assert!(info.created_at.is_some());
    assert!(!dir.path().join("backup.ttbackup.tmp").exists(), "ingen halv fil");
    assert!(repo.export_backup(&file, &[]).is_err(), "overskriver ikke");

    // Ændr data efter backuppen, og gendan.
    block_on(repo.delete_invoice_draft(&inv.id)).unwrap();
    block_on(draft(&repo, "3"));
    block_on(draft(&repo, "4"));
    let events = repo.events().subscribe();
    let restored = repo.restore_backup(&file).unwrap();
    assert_eq!(restored.invoices, 1);
    assert_eq!(block_on(repo.list_invoices()).unwrap().len(), 1);
    assert_eq!(block_on(repo.get_invoice(&inv.id)).unwrap().id, inv.id);
    assert_eq!(block_on(repo.list_entries(EntryFilter::default())).unwrap().len(), 1);
    assert_eq!(repo.invoice_profile().unwrap(), profile(), "opsætningen følger med");
    // Backup-tabellen hører ikke til i den levende database.
    let meta: i64 = repo
        .run_sync(|c| Ok(c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'tt_backup'", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(meta, 0);
    assert!(events.try_recv().is_ok(), "skærmene får besked");
    // Repo'et virker videre efter gendannelsen.
    block_on(draft(&repo, "1"));
}

#[test]
fn ugyldige_backups_afvises_uden_at_roere_data() {
    let dir = tempfile::tempdir().unwrap();
    let clock = FakeClock::new();
    let repo = LocalRepo::open(dir.path().join("local.db"), device()).unwrap().with_clock(clock.clock());
    block_on(draft(&repo, "1"));

    let tekst = dir.path().join("tekst.ttbackup");
    std::fs::write(&tekst, "ikke en database").unwrap();
    assert!(matches!(repo.restore_backup(&tekst), Err(DataError::Validation(m)) if m.contains("ikke en TimeTrack-backup")));

    // En anden SQLite-fil (fx 0.2's timetrack.db) er ikke en backup.
    let fremmed = dir.path().join("fremmed.db");
    rusqlite::Connection::open(&fremmed).unwrap().execute_batch("CREATE TABLE clients (id TEXT);").unwrap();
    assert!(matches!(inspect_backup(&fremmed), Err(DataError::Validation(m)) if m.contains("ikke en TimeTrack-backup")));

    // Fra en nyere version.
    let ny = dir.path().join("ny.ttbackup");
    repo.export_backup(&ny, &[]).unwrap();
    rusqlite::Connection::open(&ny).unwrap().pragma_update(None, "user_version", 999).unwrap();
    assert!(matches!(inspect_backup(&ny), Err(DataError::Validation(m)) if m.contains("nyere version")));

    // Ukendt format.
    let fmt = dir.path().join("fmt.ttbackup");
    repo.export_backup(&fmt, &[]).unwrap();
    rusqlite::Connection::open(&fmt)
        .unwrap()
        .execute("UPDATE tt_backup SET value = 'x' WHERE key = 'format'", [])
        .unwrap();
    assert_ne!(BACKUP_FORMAT, "x");
    assert!(inspect_backup(&fmt).is_err());

    assert!(inspect_backup(&dir.path().join("findes-ikke")).is_err());
    assert_eq!(block_on(repo.list_invoices()).unwrap().len(), 1, "data er urørt");
}

fn sent(repo: &LocalRepo, inv: Invoice) -> Invoice {
    block_on(repo.send_invoice(&inv.id)).unwrap()
}
