use std::path::Path;

use rust_decimal::Decimal;
use tt_data::{EntryFilter, InvoiceStatus, Repository};

use super::*;

const SCHEMA: &str = include_str!("schema-0.2.sql");
const FIXTURE: &str = include_str!("fixture-0.2.sql");

fn device() -> tt_data::DeviceInfo {
    tt_data::DeviceInfo {
        device_id: "test".into(),
        device_name: "test".into(),
        os: "macos".into(),
        app_version: "0.2.23".into(),
    }
}

/// En gammel `dk.timetrack.desktop`-mappe som 0.2.22 efterlader den.
fn old_dir(extra_sql: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let c = Connection::open(dir.path().join("timetrack.db")).unwrap();
    c.pragma_update(None, "journal_mode", "WAL").unwrap();
    c.execute_batch(SCHEMA).unwrap();
    c.execute_batch(FIXTURE).unwrap();
    c.execute_batch(extra_sql).unwrap();
    // Lad WAL-filen ligge, som når den gamle app ikke er lukket pænt.
    std::mem::forget(c);
    std::fs::write(
        dir.path().join("license.json"),
        r#"{"license_key":"TT-TEST-0000","tier":"lifetime"}"#,
    )
    .unwrap();
    dir
}

/// Filnavne og indhold, så vi kan bevise, at den gamle mappe er urørt.
fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| {
            (
                e.file_name().to_string_lossy().into_owned(),
                std::fs::read(e.path()).unwrap(),
            )
        })
        .collect();
    out.sort();
    out
}

fn open_new(dir: &Path) -> LocalRepo {
    LocalRepo::open(dir.join("local.db"), device()).unwrap()
}

#[test]
fn lokal_0_2_mappe_flyttes_ind() {
    let old = old_dir("");
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());

    assert!(r.found && r.error.is_none(), "{r:?}");
    assert!(!r.was_logged_in);
    assert!(r.had_license);
    assert_eq!(
        (r.customers, r.projects, r.punch_cards, r.entries, r.invoices, r.rules),
        (2, 3, 2, 4, 2, 4),
        "kort uden kunde, kørende timer, regex- og slukkede regler springes over"
    );
    assert!(r.skipped.iter().any(|s| s.contains("En timer kørte")), "{:?}", r.skipped);
    assert!(r.skipped.iter().any(|s| s.contains("Kort uden kunde")));
    assert!(r.skipped.iter().any(|s| s.contains("regex")));

    let repo = open_new(new.path());
    let clients = block_on(repo.list_clients(true)).unwrap();
    let bager = clients.iter().find(|c| c.name == "Bageriet").unwrap();
    assert_eq!(bager.cvr_number.as_deref(), Some("12345678"));
    assert_eq!(bager.default_hourly_rate, Some(Decimal::from(750)));
    assert!(clients.iter().find(|c| c.name == "Gammel kunde").unwrap().archived());

    let entries = block_on(repo.list_entries(EntryFilter::default())).unwrap();
    assert_eq!(entries.len(), 4);
    let kurv = entries.iter().find(|e| e.description.as_deref() == Some("Kurv")).unwrap();
    assert_eq!(kurv.hours, Decimal::new(15, 1));
    assert_eq!(kurv.client_id.as_deref(), Some(bager.id.as_str()), "kunde udledt af projektet");
    assert!(kurv.prepaid_package_id.is_some(), "posten trækkes fra klippekortet");
    let bog = entries.iter().find(|e| e.description.as_deref() == Some("Bogføring")).unwrap();
    assert_eq!(bog.is_billable, Some(false));
    assert_eq!(bog.hours, Decimal::new(5, 1));

    let cards = block_on(repo.list_klippekort(None, true)).unwrap();
    assert_eq!(cards.len(), 2, "kortet på projektet får projektets kunde");
    let ti = cards.iter().find(|k| k.name == "10 timer").unwrap();
    assert_eq!(ti.used_hours, Decimal::new(15, 1));
    assert_eq!(
        cards.iter().find(|k| k.name == "Kort på projektet").unwrap().client_id,
        bager.id
    );

    let invoices = block_on(repo.list_invoices()).unwrap();
    assert_eq!(invoices.len(), 2);
    let marts = invoices.iter().find(|i| i.invoice_number == "F-7").expect("nummeret fra 0.2 bevares");
    assert_eq!(marts.status, InvoiceStatus::Sent);
    assert_eq!(
        marts.issue_date.unwrap().with_timezone(&Local).format("%Y-%m-%d").to_string(),
        "2026-03-31",
        "udstedelsesdatoen fra 0.2"
    );
    let billy = invoices.iter().find(|i| i.invoice_number == "F-8").expect("exported bevares");
    assert_eq!(billy.status, InvoiceStatus::Sent, "sendt til Billy = sendt, ikke kladde");
    assert!(
        block_on(repo.uninvoiced_summary()).unwrap().iter().all(|u| u.client_id != billy.client_id),
        "posterne på en eksporteret faktura kan ikke faktureres igen"
    );

    let rules = block_on(repo.matching_rules()).unwrap();
    assert!(rules.iter().any(|r| r.kind == RuleKind::App && r.pattern == "Figma"));
    assert!(rules.iter().any(|r| r.kind == RuleKind::TitleTemplate && r.pattern == "*bageriet*"));
    assert!(rules.iter().any(|r| r.pattern == "facebook.com" && r.not_work));

    let s: Settings =
        serde_json::from_str(&std::fs::read_to_string(new.path().join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(s.tracking.idle_minutes, 9);
    assert!(!s.tracking.enabled);
    assert!(s.tracking.excluded_apps.iter().any(|a| a == "Signal"));
    assert_eq!(
        s.tracking.excluded_apps.iter().filter(|a| a.eq_ignore_ascii_case("1password")).count(),
        1,
        "ingen dubletter af standardlisten"
    );
    assert_eq!(s.appearance, Appearance::Dark);
    assert_eq!(s.language, Language::En);
    assert_eq!(s.ai.mode, AiMode::LocalServer);
    assert_eq!(s.ai.local_server.as_deref(), Some("http://localhost:11500"));
    // kalender: 0.2's iCal-adresse flytter med
    assert_eq!(
        s.calendar.ics_url.as_deref(),
        Some("webcal://p01-caldav.icloud.com/published/2/test.ics")
    );

    let notice = r.notice().unwrap();
    assert!(notice.contains("2 kunder"), "{notice}");
    assert!(notice.contains("licens"), "{notice}");
}

#[test]
fn fakturaopsaetningen_og_titlerne_fra_0_2_foelger_med() {
    let old = old_dir(
        "INSERT INTO settings (key, value) VALUES
           ('user_name', 'Mads Test'), ('user_cvr', '39 41 38 92'),
           ('user_address', 'Testvej 1, 8000 Aarhus C'), ('bank_reg', '1234'),
           ('bank_konto', '12345678'), ('mobilepay_nr', 'ikke et nummer'),
           ('payment_terms_days', '8'), ('invoice_number_prefix', 'F-'),
           ('invoice_next_number', '9');",
    );
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(r.error.is_none() && r.invoice_profile, "{r:?}");
    assert!(r.skipped.iter().any(|s| s.contains("MobilePay")), "{:?}", r.skipped);
    let repo = open_new(new.path());
    let p = repo.invoice_profile().unwrap();
    assert_eq!(p.company_name, "Mads Test");
    assert_eq!(p.cvr, "39 41 38 92");
    assert_eq!((p.bank_reg.as_str(), p.bank_account.as_str()), ("1234", "12345678"));
    assert_eq!(p.mobilepay, "", "ugyldigt felt springes over");
    assert_eq!(p.payment_terms_days, 8);
    // Tælleren står, hvor 0.2 slap: de importerede udstedelser tæller den ikke op.
    assert_eq!((p.number_prefix.as_str(), p.next_number), ("F-", 9));
    let invoices = block_on(repo.list_invoices()).unwrap();
    let marts = invoices.iter().find(|i| i.invoice_number == "F-7").unwrap();
    assert_eq!(marts.title.as_deref(), Some("Marts"), "titlen fra 0.2");
}

#[test]
fn uden_fakturaopsaetning_og_fakturaer_ingen_profil() {
    let mut skipped = vec![];
    let kv: HashMap<String, String> = [("user_name".to_string(), "Mads".to_string())].into();
    assert!(invoice_profile_from_0_2(&kv, false, &mut skipped).is_none());
    // Med fakturaer fortsætter nummereringen som i 0.2 ({præfiks}{nummer}).
    let p = invoice_profile_from_0_2(&kv, true, &mut skipped).unwrap();
    assert_eq!((p.number_prefix.as_str(), p.next_number), ("", 1));
}

#[test]
fn den_gamle_mappe_roeres_ikke() {
    let old = old_dir("");
    let before = snapshot(old.path());
    assert!(before.iter().any(|(n, _)| n == "timetrack.db-wal"));
    let new = tempfile::tempdir().unwrap();
    run_once(old.path(), new.path(), device());
    assert_eq!(snapshot(old.path()), before);
}

#[test]
fn importen_koerer_kun_en_gang() {
    let old = old_dir("");
    let new = tempfile::tempdir().unwrap();
    let first = run_once(old.path(), new.path(), device());
    assert!(first.error.is_none(), "{first:?}");
    let second = run_once(old.path(), new.path(), device());
    assert_eq!(first, second, "markøren giver samme rapport tilbage");
    assert_eq!(block_on(open_new(new.path()).list_clients(true)).unwrap().len(), 2);

    // Selv uden markør bliver data ikke dobbelt.
    std::fs::remove_file(new.path().join(MARKER)).unwrap();
    let third = run_once(old.path(), new.path(), device());
    assert_eq!(third.customers, 0);
    assert!(third.skipped.iter().any(|s| s.contains("allerede")));
    assert_eq!(block_on(open_new(new.path()).list_clients(true)).unwrap().len(), 2);
}

#[test]
fn logget_ind_betyder_nyt_login_og_ingen_dubletter() {
    let old = old_dir("INSERT INTO settings (key, value) VALUES ('sync_email', 'test@example.invalid');");
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(r.error.is_none(), "{r:?}");
    assert!(r.was_logged_in && r.settings);
    assert_eq!(r.customers + r.entries, 0, "data ligger allerede på kontoen");
    assert!(block_on(open_new(new.path()).list_clients(true)).unwrap().is_empty());
    let notice = r.notice().unwrap();
    assert!(notice.contains("logge ind igen"), "{notice}");
    // Poster uden remote_id nåede aldrig kontoen: de gemmes som CSV.
    assert_eq!(r.unsynced_entries, 4);
    let csv = std::fs::read_to_string(new.path().join(UNSYNCED_CSV)).unwrap();
    assert!(
        csv.contains(r#"2026-03-02;09:00;11:00;2,00;"Bageriet";"Webshop";"Produktsider""#),
        "{csv}"
    );
    assert!(!csv.contains("Kører stadig"));
    assert!(notice.contains("4 registreringer"), "{notice}");
    assert_eq!((r.local_only_invoices, r.local_only_rules), (2, 5));
    assert!(notice.contains("Fakturaer (2) og regler (5)"), "{notice}");
}

#[test]
fn synkroniserede_poster_kommer_ikke_i_csv() {
    let old = old_dir(
        "INSERT INTO settings (key, value) VALUES ('sync_email', 'test@example.invalid');
         UPDATE time_entries SET remote_id = 'r-' || id, synced_at = '2026-03-06 10:00:00';",
    );
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert_eq!(r.unsynced_entries, 0);
    assert!(!new.path().join(UNSYNCED_CSV).exists());
}

#[test]
fn logget_ud_tidligere_er_ikke_logget_ind() {
    // remote_id fra en tidligere konto, men ingen aktiv synk (sync_email ryddet).
    let old = old_dir("UPDATE clients SET remote_id = 'r-' || id;");
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(!r.was_logged_in);
    assert_eq!(r.customers, 2, "de lokale data flyttes");
}

#[test]
fn fejl_efterlader_intet_og_proeves_igen() {
    let old = tempfile::tempdir().unwrap();
    std::fs::write(old.path().join("timetrack.db"), b"ikke en database").unwrap();
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(r.error.is_some());
    assert!(!new.path().join(MARKER).exists(), "prøves igen ved næste start");
    assert!(!new.path().join("local.db").exists());
    assert!(!new.path().join("local.db.migrering").exists());
}

#[test]
fn eksisterende_indstillinger_overskrives_ikke() {
    let old = old_dir("");
    let new = tempfile::tempdir().unwrap();
    std::fs::write(new.path().join("settings.json"), "{\"mine\":true}").unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(!r.settings);
    assert_eq!(
        std::fs::read_to_string(new.path().join("settings.json")).unwrap(),
        "{\"mine\":true}"
    );
}

#[test]
fn ingen_gammel_app() {
    let old = tempfile::tempdir().unwrap();
    let new = tempfile::tempdir().unwrap();
    let r = run_once(&old.path().join("findes-ikke"), new.path(), device());
    assert!(!r.found);
    assert_eq!(r.notice(), None);
    assert!(new.path().join(MARKER).exists(), "tjekkes ikke igen ved næste start");
}

#[test]
fn tidsformer_fra_0_2() {
    let utc = old_instant("2026-03-03T08:00:00.000+00:00").unwrap();
    assert_eq!(utc.to_rfc3339(), "2026-03-03T08:00:00+00:00");
    let local = old_instant("2026-03-02T09:00:00").unwrap();
    assert_eq!(local.with_timezone(&Local).format("%H:%M").to_string(), "09:00");
    assert!(old_instant("i går").is_none());
    // Forårets sommertidshul (02:30 findes ikke 29/3-2026 i Danmark, når
    // maskinen kører dansk tid): posten tabes ikke.
    assert!(old_instant("2026-03-29T02:30:00").is_some());
}

#[test]
fn regler_oversaettes() {
    assert_eq!(rule_from_condition("app_name", "equals", "Figma"), Some((RuleKind::App, "Figma".into())));
    assert_eq!(
        rule_from_condition("url", "starts_with", "https://github.com/x"),
        Some((RuleKind::UrlPattern, "https://github.com/x*".into()))
    );
    assert_eq!(rule_from_condition("url", "regex", "x+"), None);
    assert_eq!(rule_from_condition("ukendt", "equals", "x"), None);
}

#[test]
fn den_gamle_apps_genveje_foelger_med_paa_mac() {
    use crate::genveje::Os;
    use crate::hotkeys::{HotkeyCmd, from_settings};
    let mut s = Settings::defaults();
    keep_old_shortcuts(&mut s, Os::Mac);
    let keys = |a: &str| s.shortcuts.iter().find(|x| x.action == a).unwrap().keys.clone();
    assert_eq!(keys("timer.toggle"), "cmd-shift-t");
    assert_eq!(keys("tracking.toggle"), "cmd-shift-space");
    let (b, notes) = from_settings(&s.shortcuts, Os::Mac);
    assert!(notes.is_empty(), "{notes:?}");
    assert_eq!(b.iter().find(|b| b.cmd == HotkeyCmd::ToggleTimer).unwrap().display, "⌘⇧T");
    // Windows: standarderne er allerede de gamle, intet ændres.
    let mut w = Settings::defaults();
    let before = w.shortcuts.clone();
    keep_old_shortcuts(&mut w, Os::Windows);
    assert_eq!(w.shortcuts, before);
}

#[test]
fn beskeden_om_overgangen_foelger_sproget() {
    let r = MigrationReport {
        found: true,
        customers: 2,
        had_license: true,
        ..Default::default()
    };
    crate::i18n::set(Language::En);
    let en = r.notice().unwrap();
    crate::i18n::set(Language::Da);
    assert!(en.contains("We moved 2 clients"), "{en}");
    assert!(en.contains("license key"), "{en}");
    let da = r.notice().unwrap();
    assert!(da.contains("Vi har flyttet 2 kunder"), "{da}");
    // Updaterens fejl følger også sproget.
    crate::i18n::set(Language::En);
    let e = crate::updater::UpdateError::Network("404".into()).to_string();
    crate::i18n::set(Language::Da);
    assert_eq!(e, "Could not download the update: 404");
}

#[test]
fn en_koerende_timer_naevnes_i_beskeden_med_starttidspunktet() {
    // Lokal: tiden flyttes ikke, så brugeren skal se, hvad der skal registreres igen.
    let old = old_dir("");
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    let notice = r.notice().unwrap();
    assert!(notice.contains("En timer kørte") && notice.contains("2026-03-05 10:00"), "{notice}");
    // Logget ind: den kørende timer er heller ikke i CSV'en eller på kontoen.
    let old = old_dir("INSERT INTO settings (key, value) VALUES ('sync_email', 'test@example.invalid');");
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    let notice = r.notice().unwrap();
    assert!(notice.contains("En timer kørte") && notice.contains("2026-03-05 10:00"), "{notice}");
    // Uden kørende timer: ingen besked om den.
    let old = old_dir("DELETE FROM time_entries WHERE is_running = 1;");
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(!r.notice().unwrap_or_default().contains("En timer kørte"));
}

#[test]
fn livstidslicensen_fra_0_2_foelger_med() {
    let old = old_dir("");
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(r.had_license && r.license_moved, "{r:?}");
    let file = crate::backend::repo::files::load_license(new.path()).unwrap();
    assert_eq!(file.lifetime.as_ref().map(|l| l.key.as_str()), Some("TT-TEST-0000"));
    assert!(file.as_local().lifetime, "ikke låst efter opgraderingen");
    let notice = r.notice().unwrap();
    assert!(!notice.contains("licensnøglen") && notice.contains("livstidslicens"), "{notice}");
    // Også når den gamle app var logget ind.
    let old = old_dir("INSERT INTO settings (key, value) VALUES ('sync_email', 'test@example.invalid');");
    let new = tempfile::tempdir().unwrap();
    assert!(run_once(old.path(), new.path(), device()).license_moved);
}

#[test]
fn et_abonnement_fra_0_2_flyttes_ikke_som_livstid() {
    let old = old_dir("");
    std::fs::write(
        old.path().join("license.json"),
        r#"{"license_key":"TT-SOLO-0000","tier":"solo","valid_until":"2027-01-01T00:00:00Z","devices_allowed":2,"issued_at":"x","verified_at":"y"}"#,
    )
    .unwrap();
    let new = tempfile::tempdir().unwrap();
    let r = run_once(old.path(), new.path(), device());
    assert!(r.had_license && !r.license_moved);
    assert!(crate::backend::repo::files::load_license(new.path()).unwrap().lifetime.is_none());
    assert!(r.notice().unwrap().contains("licensnøglen"));
}

// ---- fund #18: en fejlet migrering må ikke efterlade en halv local.db

/// Gør den gamle database ubrugelig midt i importen (efter kunder og projekter,
/// før fakturaerne), og gendan den bagefter.
const BRYD: &str = "ALTER TABLE invoice_drafts RENAME TO invoice_drafts_x;";
const REPARER: &str = "ALTER TABLE invoice_drafts_x RENAME TO invoice_drafts;";

fn kunder(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = block_on(open_new(dir).list_clients(true))
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    v.sort();
    v
}

fn ny_kunde(dir: &Path, name: &str) {
    block_on(open_new(dir).create_client(NewClient {
        name: name.into(),
        ..Default::default()
    }))
    .unwrap();
}

/// Som opstarten: `RepoBackend::open` opretter en tom `local.db`.
fn start_uden_import(dir: &Path) {
    drop(open_new(dir));
}

fn reparer_gammel(old: &Path) {
    Connection::open(old.join("timetrack.db"))
        .unwrap()
        .execute_batch(REPARER)
        .unwrap();
}

#[test]
fn fejl_midt_i_importen_efterlader_ingen_halv_db() {
    let old = old_dir(BRYD);
    let new = tempfile::tempdir().unwrap();
    start_uden_import(new.path());
    let r = run_once(old.path(), new.path(), device());
    assert!(r.error.is_some(), "{r:?}");
    assert!(kunder(new.path()).is_empty(), "ingen halvt importerede kunder");
    assert!(!new.path().join("local.db.migrering").exists());
    assert!(!new.path().join(MARKER).exists());
}

#[test]
fn naeste_start_proever_igen_og_lykkes() {
    let old = old_dir(BRYD);
    let new = tempfile::tempdir().unwrap();
    start_uden_import(new.path());
    assert!(run_once(old.path(), new.path(), device()).error.is_some());

    reparer_gammel(old.path());
    let r = run_once(old.path(), new.path(), device());
    assert!(r.error.is_none(), "{r:?}");
    assert_eq!((r.customers, r.invoices), (2, 2));
    assert_eq!(kunder(new.path()), ["Bageriet", "Gammel kunde"]);
    assert!(new.path().join(MARKER).exists());
}

#[test]
fn brugerens_data_efter_en_fejlet_migrering_bevares() {
    let old = old_dir(BRYD);
    let new = tempfile::tempdir().unwrap();
    start_uden_import(new.path());
    assert!(run_once(old.path(), new.path(), device()).error.is_some());

    // Brugeren når at oprette en kunde i den tomme database.
    ny_kunde(new.path(), "Min egen kunde");

    reparer_gammel(old.path());
    let r = run_once(old.path(), new.path(), device());
    assert!(r.error.is_none(), "{r:?}");
    assert_eq!(r.customers, 2, "importen springes ikke over");
    assert_eq!(
        kunder(new.path()),
        ["Bageriet", "Gammel kunde", "Min egen kunde"],
        "gamle og nye data er der begge"
    );
}

#[test]
fn en_fejl_roerer_ikke_brugerens_database() {
    let old = old_dir(BRYD);
    let new = tempfile::tempdir().unwrap();
    start_uden_import(new.path());
    assert!(run_once(old.path(), new.path(), device()).error.is_some());
    ny_kunde(new.path(), "Min egen kunde");
    // Anden fejl: brugerens database er uændret, og der ligger intet rod.
    assert!(run_once(old.path(), new.path(), device()).error.is_some());
    assert_eq!(kunder(new.path()), ["Min egen kunde"]);
    assert!(!new.path().join("local.db.migrering").exists());
}

/// Importen lykkedes, men markøren blev ikke skrevet (fuld disk, antivirus,
/// appen dræbt lige efter flytningen), så `PENDING` ligger stadig. Næste
/// start må ikke importere en gang til (review 0.2.24, fund 1).
#[test]
fn en_lykket_import_uden_markoer_giver_ingen_dubletter() {
    let old = old_dir("");
    let new = tempfile::tempdir().unwrap();
    assert!(run_once(old.path(), new.path(), device()).error.is_none());
    std::fs::remove_file(new.path().join(MARKER)).unwrap();
    std::fs::write(new.path().join(PENDING), "").unwrap();

    let again = run_once(old.path(), new.path(), device());
    assert!(again.error.is_none(), "{again:?}");
    assert_eq!(again.customers, 0);
    assert!(again.skipped.iter().any(|s| s.contains("allerede")), "{again:?}");
    assert_eq!(kunder(new.path()), ["Bageriet", "Gammel kunde"]);
    assert!(!new.path().join(PENDING).exists());
}
