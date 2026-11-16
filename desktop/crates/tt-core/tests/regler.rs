//! Regler, hvis web-kode ikke kan køres uden database eller npm-pakker, og
//! som derfor er portet som håndskrevne tests med samme input og forventning
//! som web. Kilden står ved hver blok.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use tt_core::faktura::{self, UnbilledEntryLike};
use tt_core::klippekort::{
    self, DeductError, DeductRequest, Klippekort, OverdraftPolicy, ReceiptKind, UsageRow,
};
use tt_core::timepris::{
    self, MemberRate, ProjectRate, RateLookup, ScheduledChangeIndex, ScheduledRateChange,
};

fn t(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
}

const NOW: &str = "2026-09-05T10:00:00Z";

fn kort(total: f64, used: f64) -> Klippekort {
    Klippekort {
        id: "kort".into(),
        client_id: Some("kunde".into()),
        name: "Kort".into(),
        total_hours: total,
        used_hours: used,
        remaining_hours: total - used,
        hourly_rate: 800.0,
        auto_deduct: true,
        is_active: Some(true),
        ..Default::default()
    }
}

fn træk(hours: f64) -> DeductRequest {
    DeductRequest {
        hours,
        for_time_entry: true,
        client_id: Some("kunde".into()),
        allow_inactive: false,
    }
}

// ---------------------------------------------------------------------------
// deductHoursCore (src/lib/trpc/routers/prepaid.ts:88-279)
// ---------------------------------------------------------------------------

#[test]
fn traek_traekker_afrundet_tid_og_noterer_vaerdien() {
    let r = klippekort::deduct(&kort(10.0, 2.0), &træk(1.333), t(NOW)).unwrap();
    assert_eq!(r.hours_deducted, 1.33);
    assert_eq!(r.used_hours, 3.33);
    assert_eq!(r.remaining_hours, 6.67);
    assert!(!r.overflowed_to_invoice);
    assert_eq!(
        r.usage,
        Some(UsageRow {
            hours_used: 1.33,
            value_used: 1.33 * 800.0,
            overdraft_hours: 0.0
        })
    );
    assert!(r.entry.is_prepaid);
    assert_eq!(r.entry.prepaid_package_id.as_deref(), Some("kort"));
}

#[test]
fn traek_runder_op_til_hele_klip() {
    let mut k = kort(10.0, 0.0);
    k.clip_size_minutes = Some(15);
    // 20 min → 30 min (2 klip à 15)
    let r = klippekort::deduct(&k, &træk(20.0 / 60.0), t(NOW)).unwrap();
    assert_eq!(r.hours_deducted, 0.5);
    assert_eq!(r.remaining_hours, 9.5);
}

#[test]
fn traek_afviser_ugyldige_timer_forkert_kunde_inaktivt_og_udloebet_kort() {
    let k = kort(10.0, 0.0);
    for h in [0.0, -1.0, f64::NAN, f64::INFINITY, 0.004] {
        assert_eq!(
            klippekort::deduct(&k, &træk(h), t(NOW)),
            Err(DeductError::InvalidHours),
            "{h}"
        );
    }
    let mut anden = træk(1.0);
    anden.client_id = Some("anden".into());
    assert_eq!(
        klippekort::deduct(&k, &anden, t(NOW)),
        Err(DeductError::WrongClient)
    );
    let mut uden_kunde = træk(1.0);
    uden_kunde.client_id = None;
    assert_eq!(
        klippekort::deduct(&k, &uden_kunde, t(NOW)),
        Err(DeductError::WrongClient)
    );
    // Direkte træk uden registrering tjekker ikke kunden (manualDeduct)
    let manuelt = DeductRequest {
        hours: 1.0,
        for_time_entry: false,
        client_id: None,
        allow_inactive: false,
    };
    assert!(klippekort::deduct(&k, &manuelt, t(NOW)).is_ok());

    let mut inaktivt = k.clone();
    inaktivt.is_active = Some(false);
    assert_eq!(
        klippekort::deduct(&inaktivt, &træk(1.0), t(NOW)),
        Err(DeductError::Inactive)
    );

    // Udløbsdagen gælder hele dagen i dansk tid (#736)
    let mut udløber = k.clone();
    udløber.expiry_date = Some(t("2026-09-05T00:00:00Z"));
    assert!(klippekort::deduct(&udløber, &træk(1.0), t("2026-09-05T21:30:00Z")).is_ok());
    assert_eq!(
        klippekort::deduct(&udløber, &træk(1.0), t("2026-09-05T22:01:00Z")),
        Err(DeductError::Expired)
    );

    // Afstemning der frigiver timer må gå igennem på et inaktivt/udløbet kort
    let mut ved_afstemning = træk(1.0);
    ved_afstemning.allow_inactive = true;
    assert!(klippekort::deduct(&inaktivt, &ved_afstemning, t(NOW)).is_ok());
}

#[test]
fn block_politik_afviser_med_web_beskeden() {
    let mut k = kort(10.0, 9.5);
    let err = klippekort::deduct(&k, &træk(1.0), t(NOW)).unwrap_err();
    assert_eq!(
        err.to_string(),
        "Ikke nok timer tilbage på klippekortet. Tilgængelige timer: 0.50"
    );
    k.clip_size_minutes = Some(30);
    let err = klippekort::deduct(&k, &træk(0.75), t(NOW)).unwrap_err();
    assert_eq!(
        err.to_string(),
        "Ikke nok timer tilbage på klippekortet. Tilgængelige timer: 0.50, kræver 1.00t (oprundet til 30 min klip)"
    );
}

#[test]
fn invoice_politik_lader_tiden_gaa_til_faktura_uden_at_roere_kortet() {
    let mut k = kort(10.0, 9.5);
    k.overdraft_policy = OverdraftPolicy::Invoice;
    k.overdraft_rate = Some(950.0);
    let r = klippekort::deduct(&k, &træk(2.0), t(NOW)).unwrap();
    assert!(r.overflowed_to_invoice);
    assert_eq!(r.hours_deducted, 0.0);
    assert_eq!((r.used_hours, r.remaining_hours), (9.5, 0.5));
    assert_eq!(r.usage, None);
    assert!(!r.entry.is_prepaid);
    assert_eq!(r.entry.prepaid_package_id, None);
    assert_eq!(r.entry.is_billable, Some(true));
    assert_eq!(r.entry.billable_rate, Some(950.0));
    assert_eq!(
        klippekort::classify_deduction(r.hours_deducted, r.overflowed_to_invoice),
        ReceiptKind::NothingDeducted
    );
}

#[test]
fn allow_politik_traekker_alt_og_foerer_resten_som_overtraek() {
    let mut k = kort(10.0, 9.0);
    k.overdraft_policy = OverdraftPolicy::Allow;
    k.overdraft_hours = 0.5;
    let r = klippekort::deduct(&k, &træk(3.0), t(NOW)).unwrap();
    assert_eq!(r.hours_deducted, 3.0);
    assert_eq!(r.overdrafted_hours, 2.0);
    assert_eq!((r.used_hours, r.remaining_hours), (10.0, 0.0));
    assert_eq!(r.overdraft_hours, 2.5);
    assert_eq!(r.usage.as_ref().unwrap().overdraft_hours, 2.0);
    assert_eq!(
        klippekort::classify_deduction(r.hours_deducted, false),
        ReceiptKind::Deducted
    );
}

#[test]
fn klippekort_laeses_fra_webs_json_med_decimalstrenge_og_null() {
    // prepaid.list leverer decimalkolonner som strenge; isActive er nullable
    let k: Klippekort = serde_json::from_str(
        r#"{"id":"k","clientId":"kunde","name":null,"totalHours":"20.00","usedHours":"12.50",
            "remainingHours":"7.50","overdraftHours":null,"hourlyRate":"850.00","autoDeduct":true,
            "isActive":null,"isArchived":null,"expiryDate":null,"purchaseDate":"2026-07-01T00:00:00.000Z",
            "clipSizeMinutes":null,"overdraftPolicy":null,"overdraftRate":"0.00"}"#,
    )
    .unwrap();
    assert_eq!(
        (
            k.total_hours,
            k.used_hours,
            k.remaining_hours,
            k.hourly_rate
        ),
        (20.0, 12.5, 7.5, 850.0)
    );
    assert_eq!(
        (k.is_active, k.is_archived, k.overdraft_hours),
        (None, false, 0.0)
    );
    assert_eq!(k.overdraft_policy, OverdraftPolicy::Block);
    // "0.00" er sand i JavaScript, så satsen er sat
    assert_eq!(k.overdraft_rate, Some(0.0));

    // isActive = null: auto-valg og saldo tager kortet med, trækket afviser det
    let now = t(NOW);
    assert_eq!(
        klippekort::pick_auto_deduct(std::slice::from_ref(&k), now).map(|p| p.id.as_str()),
        Some("k")
    );
    assert_eq!(
        klippekort::sum_usable_hours(std::slice::from_ref(&k), now),
        7.5
    );
    assert_eq!(
        klippekort::deduct(&k, &træk(1.0), now),
        Err(DeductError::Inactive)
    );

    // Manglende felt = null
    let uden: Klippekort =
        serde_json::from_str(r#"{"id":"u","remainingHours":3,"autoDeduct":true}"#).unwrap();
    assert_eq!(
        klippekort::pick_auto_deduct(std::slice::from_ref(&uden), now).map(|p| p.id.as_str()),
        Some("u")
    );
}

// ---------------------------------------------------------------------------
// reversePrepaidUsage (prepaid.ts:288-340)
// ---------------------------------------------------------------------------

#[test]
fn tilbagefoersel_giver_kun_ikke_overtrukne_timer_tilbage() {
    // A skabte 3 t overtræk, B 2 t; tilbageførsel af A må kun fjerne A's 3 t
    let mut k = kort(10.0, 10.0);
    k.remaining_hours = 0.0;
    k.overdraft_hours = 5.0;
    let a = [UsageRow {
        hours_used: 4.0,
        value_used: 0.0,
        overdraft_hours: 3.0,
    }];
    let r = klippekort::reverse(&k, &a);
    assert_eq!(r.restored_hours, 4.0);
    assert_eq!(
        (r.used_hours, r.remaining_hours, r.overdraft_hours),
        (9.0, 1.0, 2.0)
    );
    assert!(r.reset_low_balance_alert);
}

#[test]
fn tilbagefoersel_hæver_aldrig_saldoen_over_totalen() {
    let k = kort(10.0, 1.0);
    let rows = [UsageRow {
        hours_used: 5.0,
        value_used: 0.0,
        overdraft_hours: 0.0,
    }];
    let r = klippekort::reverse(&k, &rows);
    assert_eq!(r.remaining_hours, 10.0);
    assert_eq!(r.used_hours, 0.0);
}

#[test]
fn tilbagefoersel_uden_traek_er_uaendret() {
    let k = kort(10.0, 4.0);
    let r = klippekort::reverse(&k, &[]);
    assert_eq!((r.used_hours, r.remaining_hours), (4.0, 6.0));
    assert!(!r.reset_low_balance_alert);
}

#[test]
fn traek_og_tilbagefoersel_gaar_i_nul() {
    let k = kort(20.0, 7.25);
    let r = klippekort::deduct(&k, &træk(2.5), t(NOW)).unwrap();
    let mut efter = k.clone();
    efter.used_hours = r.used_hours;
    efter.remaining_hours = r.remaining_hours;
    let tilbage = klippekort::reverse(&efter, &[r.usage.unwrap()]);
    assert_eq!((tilbage.used_hours, tilbage.remaining_hours), (7.25, 12.75));
}

// ---------------------------------------------------------------------------
// Lav saldo og udløbsvarsel
// ---------------------------------------------------------------------------

#[test]
fn lav_saldo_advarsel_en_gang_ved_20_procent() {
    // checkAndSendLowBalanceAlert (prepaid.ts:346-358): inklusiv grænse
    assert!(klippekort::should_send_low_balance_alert(2.0, 10.0, false));
    assert!(!klippekort::should_send_low_balance_alert(2.0, 10.0, true));
    assert!(!klippekort::should_send_low_balance_alert(
        2.01, 10.0, false
    ));
    assert!(!klippekort::should_send_low_balance_alert(0.0, 0.0, false));
}

#[test]
fn udloeber_snart_som_udvidelsen() {
    // browser-extension/src/lib/prepaid.ts:253-260 (standard 7 dage)
    let udløb = Some(t("2026-09-12T00:00:00Z"));
    assert!(klippekort::is_expiring_soon(udløb, 7, t(NOW)));
    assert!(!klippekort::is_expiring_soon(udløb, 6, t(NOW)));
    assert!(!klippekort::is_expiring_soon(
        Some(t("2026-09-01T00:00:00Z")),
        7,
        t(NOW)
    ));
    assert!(!klippekort::is_expiring_soon(None, 7, t(NOW)));
}

#[test]
fn klippekort_fejl_genkendes() {
    // browser-extension/src/lib/prepaid.ts:156-158
    assert!(klippekort::is_prepaid_deduction_error(
        "Klippekortet er udløbet"
    ));
    assert!(klippekort::is_prepaid_deduction_error("klippekort-traek"));
    assert!(!klippekort::is_prepaid_deduction_error(
        "Projektet findes ikke"
    ));
}

// ---------------------------------------------------------------------------
// getRateFromCache (src/lib/rates/scheduled-hierarchy.test.ts)
// ---------------------------------------------------------------------------

const KUNDE_A: &str = "11111111-1111-1111-1111-111111111111";
const OTHER: &str = "33333333-3333-3333-3333-333333333333";
const PROJECT: &str = "22222222-2222-2222-2222-222222222222";

fn change(
    client: Option<&str>,
    project: Option<&str>,
    new_rate: &str,
    old_rate: Option<&str>,
    applied: Option<&str>,
) -> ScheduledRateChange {
    ScheduledRateChange {
        id: format!("{new_rate}-{project:?}"),
        client_id: client.map(Into::into),
        project_id: project.map(Into::into),
        new_rate: new_rate.into(),
        old_rate: old_rate.map(Into::into),
        effective_date: "2026-11-01".into(),
        applied_at: applied.map(t),
        cancelled_at: None,
        created_at: t("2026-09-01T10:00:00Z"),
    }
}

fn lookup(changes: &[ScheduledRateChange], project_rate: Option<&str>) -> RateLookup {
    RateLookup {
        projects: HashMap::from([(
            PROJECT.into(),
            ProjectRate {
                hourly_rate: project_rate.map(Into::into),
                client_id: Some(KUNDE_A.into()),
            },
        )]),
        clients: HashMap::from([
            (KUNDE_A.into(), Some("600.00".into())),
            (OTHER.into(), Some("500.00".into())),
        ]),
        user_default_rate: Some("400.00".into()),
        member_rates: Vec::new(),
        scheduled: Some(ScheduledChangeIndex::new(changes)),
    }
}

#[test]
fn timepris_stemples_efter_registreringens_dato() {
    let l = lookup(&[change(Some(KUNDE_A), None, "800.00", None, None)], None);
    let rate = |p, c, d| timepris::rate_for_entry(&l, p, c, d);
    assert_eq!(
        rate(None, Some(KUNDE_A), Some("2026-10-31")).as_deref(),
        Some("600.00")
    );
    assert_eq!(
        rate(None, Some(KUNDE_A), Some("2026-11-01")).as_deref(),
        Some("800.00")
    );
    assert_eq!(
        rate(None, Some(KUNDE_A), Some("2026-11-01T00:00:00Z")).as_deref(),
        Some("800.00")
    );
    // Projekt uden egen sats arver kundens
    assert_eq!(
        rate(Some(PROJECT), None, Some("2026-10-31")).as_deref(),
        Some("600.00")
    );
    assert_eq!(
        rate(Some(PROJECT), None, Some("2026-11-01")).as_deref(),
        Some("800.00")
    );
    // Andre kunder påvirkes ikke; uden dato som før
    assert_eq!(
        rate(None, Some(OTHER), Some("2026-11-15")).as_deref(),
        Some("500.00")
    );
    assert_eq!(rate(None, Some(KUNDE_A), None).as_deref(), Some("600.00"));
    // Ukendt kunde og intet projekt: brugerens sats
    assert_eq!(rate(None, Some("ukendt"), None).as_deref(), Some("400.00"));
}

#[test]
fn projektsats_vinder_over_kundens_prisskift() {
    let l = lookup(
        &[change(Some(KUNDE_A), None, "800.00", None, None)],
        Some("950.00"),
    );
    assert_eq!(
        timepris::rate_for_entry(&l, Some(PROJECT), Some(KUNDE_A), Some("2026-11-15")).as_deref(),
        Some("950.00")
    );

    let l = lookup(
        &[
            change(Some(KUNDE_A), None, "800.00", None, None),
            change(None, Some(PROJECT), "1000.00", None, None),
        ],
        Some("900.00"),
    );
    assert_eq!(
        timepris::rate_for_entry(&l, Some(PROJECT), Some(KUNDE_A), Some("2026-10-31")).as_deref(),
        Some("900.00")
    );
    assert_eq!(
        timepris::rate_for_entry(&l, Some(PROJECT), Some(KUNDE_A), Some("2026-11-01")).as_deref(),
        Some("1000.00")
    );
}

#[test]
fn foer_en_anvendt_foerste_projektsats_falder_projektet_tilbage_til_kunden() {
    let l = lookup(
        &[change(
            None,
            Some(PROJECT),
            "1000.00",
            None,
            Some("2026-10-31T23:05:00Z"),
        )],
        Some("1000.00"),
    );
    assert_eq!(
        timepris::rate_for_entry(&l, Some(PROJECT), None, Some("2026-10-15")).as_deref(),
        Some("600.00")
    );
    assert_eq!(
        timepris::rate_for_entry(&l, Some(PROJECT), None, Some("2026-11-15")).as_deref(),
        Some("1000.00")
    );
}

#[test]
fn medlemssatser_gaar_forud_for_alt() {
    let mut l = lookup(
        &[change(Some(KUNDE_A), None, "800.00", None, None)],
        Some("950.00"),
    );
    l.member_rates = vec![MemberRate {
        project_id: None,
        client_id: Some(KUNDE_A.into()),
        hourly_rate: "650.00".into(),
    }];
    assert_eq!(
        timepris::rate_for_entry(&l, None, Some(KUNDE_A), Some("2026-11-15")).as_deref(),
        Some("650.00")
    );
    l.member_rates.push(MemberRate {
        project_id: Some(PROJECT.into()),
        client_id: None,
        hourly_rate: "700.00".into(),
    });
    l.member_rates.push(MemberRate {
        project_id: None,
        client_id: None,
        hourly_rate: "450.00".into(),
    });
    assert_eq!(
        timepris::rate_for_entry(&l, Some(PROJECT), Some(KUNDE_A), None).as_deref(),
        Some("700.00")
    );
    assert_eq!(
        timepris::rate_for_entry(&l, None, Some(OTHER), None).as_deref(),
        Some("450.00")
    );
}

#[test]
fn annullerede_prisskift_ignoreres_og_tom_sats_falder_videre() {
    let mut c = change(Some(KUNDE_A), None, "800.00", None, None);
    c.cancelled_at = Some(t("2026-10-01T00:00:00Z"));
    let mut l = lookup(&[c], Some(""));
    assert_eq!(
        timepris::rate_for_entry(&l, None, Some(KUNDE_A), Some("2026-11-15")).as_deref(),
        Some("600.00")
    );
    // "" er falsk i JavaScript: projektets tomme sats falder til kunden
    assert_eq!(
        timepris::rate_for_entry(&l, Some(PROJECT), None, None).as_deref(),
        Some("600.00")
    );
    l.clients.insert(KUNDE_A.into(), None);
    assert_eq!(
        timepris::rate_for_entry(&l, Some(PROJECT), Some(KUNDE_A), None).as_deref(),
        Some("400.00")
    );
    assert_eq!(timepris::rate_value(Some("712.50")), 712.5);
    assert_eq!(timepris::rate_value(None), 0.0);
}

// ---------------------------------------------------------------------------
// Ufaktureret tid (src/lib/invoicing/unbilled.test.ts)
// ---------------------------------------------------------------------------

fn post() -> UnbilledEntryLike {
    UnbilledEntryLike {
        is_billed: Some(false),
        is_billable: Some(true),
        is_prepaid: Some(false),
        client_default_billable: Some(true),
        approval_status: None,
    }
}

#[test]
fn ufaktureret_tid_foelger_null_kontrakten() {
    let er = |e: UnbilledEntryLike| faktura::is_unbilled_entry(&e, false);
    assert!(er(post()));
    assert!(!er(UnbilledEntryLike {
        is_billed: Some(true),
        ..post()
    }));
    assert!(!er(UnbilledEntryLike {
        is_billable: Some(false),
        ..post()
    }));
    assert!(er(UnbilledEntryLike {
        is_billable: None,
        ..post()
    }));
    assert!(er(UnbilledEntryLike {
        is_billed: None,
        ..post()
    }));
    assert!(!er(UnbilledEntryLike {
        client_default_billable: Some(false),
        ..post()
    }));
    assert!(!er(UnbilledEntryLike {
        client_default_billable: None,
        ..post()
    }));
    assert!(!er(UnbilledEntryLike {
        is_prepaid: Some(true),
        ..post()
    }));
    assert!(faktura::is_unbilled_entry(
        &UnbilledEntryLike {
            is_prepaid: Some(true),
            ..post()
        },
        true
    ));
    assert!(er(UnbilledEntryLike {
        is_prepaid: None,
        ..post()
    }));
    for (status, med) in [
        ("pending", false),
        ("rejected", false),
        ("approved", true),
        ("not_required", true),
        ("noget_nyt", true),
    ] {
        assert_eq!(
            er(UnbilledEntryLike {
                approval_status: Some(status.into()),
                ..post()
            }),
            med,
            "{status}"
        );
    }
}

#[test]
fn vaerdien_af_tid_er_timer_gange_sats() {
    assert_eq!(faktura::entry_value(Some(2.5), Some(800.0)), 2000.0);
    assert_eq!(faktura::entry_value(Some(2.5), None), 0.0);
    assert_eq!(faktura::entry_value(Some(f64::NAN), Some(800.0)), 0.0);
    // invoices.test.ts: 2,5×900 + 1×900 + 0,5×750 = 3525
    let total: f64 = [(2.5, 900.0), (1.0, 900.0), (0.5, 750.0)]
        .iter()
        .map(|(h, r)| faktura::entry_value(Some(*h), Some(*r)))
        .sum();
    assert_eq!(total, 3525.0);
    assert_eq!(
        faktura::ore_to_decimal_string(faktura::kroner_to_ore(total)),
        "3525.00"
    );
}

// ---------------------------------------------------------------------------
// Moms på fakturaen (InvoicePDF.tsx:134-145; invoices.test.ts "VAT Calculation")
// ---------------------------------------------------------------------------

#[test]
fn moms_25_procent_paa_fakturaen() {
    let r = faktura::totals_from_subtotal(1000.0, None, true);
    assert_eq!(
        (r.subtotal_ore, r.vat_ore, r.total_ore),
        (100_000, 25_000, 125_000)
    );
    let r = faktura::totals_from_subtotal(4999.99, Some("25.00"), true);
    assert_eq!((r.vat_ore, r.total_ore), (125_000, 624_999));
    let r = faktura::totals_from_subtotal(0.0, Some(""), true);
    assert_eq!((r.vat_ore, r.total_ore), (0, 0));
}

#[test]
fn ingen_moms_uden_momsregistrering_og_skabelonens_sats_bruges() {
    let r = faktura::invoice_totals(&["800.00", "375.50"], Some("25.00"), false);
    assert!(!r.show_vat);
    assert_eq!(
        (r.subtotal_ore, r.vat_ore, r.total_ore),
        (117_550, 0, 117_550)
    );
    let r = faktura::invoice_totals(&["1000.00"], Some("12.5"), true);
    assert_eq!(
        (r.vat_rate_percent, r.vat_ore, r.total_ore),
        (12.5, 12_500, 112_500)
    );
}

// ---------------------------------------------------------------------------
// Fakturanumre (invoices.ts:54-95, draft-number.ts)
// ---------------------------------------------------------------------------

#[test]
fn naeste_fakturanummer_er_stoerste_afsluttende_tal_plus_en() {
    assert_eq!(faktura::next_invoice_number([]), "INV-001");
    assert_eq!(
        faktura::next_invoice_number(["INV-042", "2025-117", "0042"]),
        "INV-118"
    );
    // Kladder og numre uden afsluttende tal tæller ikke
    assert_eq!(
        faktura::next_invoice_number(["INV-007", "UDKAST-LX9Z0A12", "Kreditnota"]),
        "INV-008"
    );
    // NOT LIKE er versalfølsomt: "udkast-…" med tal tæller med som i web
    assert_eq!(
        faktura::next_invoice_number(["INV-007", "udkast-99"]),
        "INV-100"
    );
    assert_eq!(faktura::next_invoice_number(["INV-999"]), "INV-1000");
    assert_eq!(faktura::trailing_number("INV-042"), Some(42));
    assert_eq!(faktura::trailing_number("INV-"), None);
}

#[test]
fn kladdenummer_bygges_som_web() {
    let n = faktura::draft_invoice_number(1_790_000_000_000, 1, 35);
    assert!(n.starts_with("UDKAST-"));
    assert!(faktura::is_draft_invoice_number(Some(&n)));
    // (1790000000000).toString(36).toUpperCase() === "MUBBS7I8" i Node
    assert_eq!(n, "UDKAST-MUBBS7I8010Z");
    assert_eq!(faktura::format_invoice_number(Some(&n)), "Kladde");
}
