//! Paritet med web: hvert fixture-sæt i `tests/parity/fixtures` er input og
//! output fra web-koden selv (se `tests/parity/generate.ts` for kilderne).
//! Fejler en test her, regner desktop anderledes end web.

use std::path::PathBuf;

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;

use tt_core::afrunding::{self, RoundingConfig, RoundingFields, RoundingMethod};
use tt_core::faktura::{
    self, MoneyInput, PreviewEntry, PreviewPeriod, VatInvoice, VatOverview, VatPeriodKind,
};
use tt_core::format;
use tt_core::huller::{self, KlippekortModel};
use tt_core::js;
use tt_core::klippekort::{
    self, BalanceLevel, EntryClientRef, Klippekort, ReconcileDecision, ReconcileInput,
    RequestedPackage, TimerPrepaidChoice,
};
use tt_core::tid;
use tt_core::timepris::{self, ScheduledRateChange};

fn load(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/parity/fixtures")
        .join(format!("{name}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn rows<'a>(v: &'a Value, key: &str) -> &'a Vec<Value> {
    v[key].as_array().unwrap_or_else(|| panic!("mangler {key}"))
}

fn t(v: &Value) -> DateTime<Utc> {
    v.as_str()
        .expect("tidspunkt")
        .parse()
        .expect("ISO-tidspunkt")
}

fn opt_t(v: &Value) -> Option<DateTime<Utc>> {
    v.as_str().map(|s| s.parse().expect("ISO-tidspunkt"))
}

fn d(v: &Value) -> NaiveDate {
    tid::parse_date_str(v.as_str().expect("dato")).expect("yyyy-MM-dd")
}

fn f(v: &Value) -> f64 {
    v.as_f64().expect("tal")
}

fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn de<T: serde::de::DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))
}

// ---------------------------------------------------------------------------
// Klippekort
// ---------------------------------------------------------------------------

#[test]
fn klippekort_auto_valg() {
    let fx = load("prepaid-auto-select");
    for case in rows(&fx, "pick") {
        let packages: Vec<Klippekort> = de(&case["packages"]);
        let got = klippekort::pick_auto_deduct(&packages, t(&case["now"])).map(|p| p.id.as_str());
        assert_eq!(got, case["expected"].as_str(), "{}", case["name"]);
        // Kundefilteret ændrer intet, når alle kort er kundens
        let for_client =
            klippekort::pick_auto_deduct_for_client(&packages, Some("c1"), t(&case["now"]))
                .map(|p| p.id.as_str());
        assert_eq!(
            for_client,
            case["expected"].as_str(),
            "{} (for kunde)",
            case["name"]
        );
    }
    for case in rows(&fx, "resolve") {
        let packages: Vec<Klippekort> = de(&case["packages"]);
        let choice: Option<TimerPrepaidChoice> = de(&case["choice"]);
        let got = klippekort::resolve_timer_selection(
            choice.as_ref(),
            case["clientId"].as_str(),
            &packages,
            t(&case["now"]),
        )
        .map(|p| p.id.as_str());
        assert_eq!(got, case["expected"].as_str(), "{}", case["name"]);
    }
}

#[test]
fn klippekort_udloeb() {
    let fx = load("prepaid-expiry");
    let grid = rows(&fx, "grid");
    assert!(grid.len() > 8000);
    for row in grid {
        let expiry = Some(t(&row[0]));
        let now = t(&row[1]);
        assert_eq!(
            klippekort::is_expired(expiry, now),
            row[2].as_bool().unwrap(),
            "udløbet? {row}"
        );
        assert_eq!(
            klippekort::days_until_expiry(expiry, now),
            row[3].as_i64(),
            "dage {row}"
        );
        assert_eq!(
            iso(klippekort::expired_before(now)),
            row[4].as_str().unwrap(),
            "grænse {row}"
        );
    }
    assert_eq!(
        klippekort::days_until_expiry(
            None,
            "2026-10-26T12:00:00Z".parse::<DateTime<Utc>>().unwrap()
        ),
        None
    );
    assert!(!klippekort::is_expired(
        None,
        "2026-10-26T12:00:00Z".parse::<DateTime<Utc>>().unwrap()
    ));
    for row in rows(&fx, "perExpiry") {
        let e = t(&row["expiry"]);
        assert_eq!(klippekort::expiry_date(e), d(&row["date"]), "{row}");
        assert_eq!(
            klippekort::valid_until(Some(e)).map(iso).as_deref(),
            row["validUntil"].as_str(),
            "{row}"
        );
    }
    for row in rows(&fx, "within") {
        let got = klippekort::expires_within_before(row[0].as_i64().unwrap(), t(&row[1]));
        assert_eq!(iso(got), row[2].as_str().unwrap(), "{row}");
    }
    for row in rows(&fx, "phrases") {
        let days = row[0].as_i64().unwrap();
        assert_eq!(klippekort::expiry_phrase(days), row[1].as_str().unwrap());
        assert_eq!(klippekort::expiry_label(days), row[2].as_str().unwrap());
    }
    for row in rows(&fx, "duplicated") {
        let got = klippekort::duplicated_expiry(opt_t(&row[0]), opt_t(&row[1]), t(&row[2]));
        assert_eq!(got.map(iso).as_deref(), row[3].as_str(), "{row}");
    }
}

#[test]
fn klippekort_timer_saldo_og_afstemning() {
    let fx = load("prepaid-hours");
    for row in rows(&fx, "roundGrid") {
        assert_eq!(
            klippekort::round_prepaid_hours(f(&row[0])),
            f(&row[1]),
            "round {row}"
        );
        assert_eq!(
            klippekort::ceil_prepaid_hours(f(&row[0])),
            f(&row[2]),
            "ceil {row}"
        );
    }
    for row in rows(&fx, "normGrid") {
        let clip = row[1].as_i64().map(|c| c as i32);
        assert_eq!(
            klippekort::normalize_deduction_hours(f(&row[0]), clip),
            f(&row[2]),
            "klip {row}"
        );
    }
    for row in rows(&fx, "totalChange") {
        assert_eq!(
            klippekort::remaining_after_total_change(f(&row[0]), f(&row[1])),
            row[2].as_f64(),
            "{row}"
        );
    }
    for row in rows(&fx, "levelGrid") {
        let expected: BalanceLevel = de(&row[2]);
        assert_eq!(
            klippekort::balance_level(f(&row[0]), f(&row[1])),
            expected,
            "{row}"
        );
        assert_eq!(
            klippekort::is_balance_low(f(&row[0]), f(&row[1])),
            expected != BalanceLevel::Ok
        );
    }
    let usable = &fx["usable"];
    let packages: Vec<Klippekort> = de(&usable["packages"]);
    assert_eq!(
        klippekort::sum_usable_hours(&packages, t(&usable["now"])),
        f(&usable["expected"])
    );

    for case in rows(&fx, "reconcile") {
        let i = &case["input"];
        let input = ReconcileInput {
            was_prepaid: i["wasPrepaid"].as_bool().unwrap(),
            old_package_id: i["oldPackageId"].as_str().map(str::to_string),
            old_client: de::<EntryClientRef>(&i["oldClient"]),
            new_client: de::<EntryClientRef>(&i["newClient"]),
            requested: match &i["requestedPackageId"] {
                Value::Null => RequestedPackage::Remove,
                Value::String(s) if s == "<udeladt>" => RequestedPackage::Unspecified,
                Value::String(s) => RequestedPackage::Package(s.clone()),
                other => panic!("{other}"),
            },
            old_hours: f(&i["oldHours"]),
            new_hours: f(&i["newHours"]),
        };
        let expected: ReconcileDecision = de(&case["expected"]);
        assert_eq!(klippekort::resolve_reconcile(&input), expected, "{i}");
    }
    for row in rows(&fx, "effective") {
        let r: EntryClientRef = de(&row[0]);
        assert_eq!(klippekort::effective_client_id(&r), row[1].as_str());
    }
}

// ---------------------------------------------------------------------------
// Huller og dansk tekst
// ---------------------------------------------------------------------------

#[test]
fn klippekort_huller() {
    let fx = load("huller-format");
    for case in rows(&fx, "models") {
        let expected: KlippekortModel = de(&case["expected"]);
        assert_eq!(
            huller::klippekort_model(f(&case["total"]), f(&case["remaining"])),
            expected,
            "{case}"
        );
    }
    let nan: KlippekortModel = de(&fx["nan_total_4"]);
    assert_eq!(huller::klippekort_model(f64::NAN, 4.0), nan);
    let both_nan = huller::klippekort_model(f64::NAN, f64::NAN);
    assert!(both_nan.holes.is_empty());
}

#[test]
fn dansk_tekst_for_timer_og_satser() {
    let fx = load("huller-format");
    for row in rows(&fx, "formatTimer") {
        assert_eq!(
            format::format_timer(f(&row[0])),
            row[1].as_str().unwrap(),
            "{row}"
        );
    }
    for row in rows(&fx, "formatHoursShort") {
        assert_eq!(
            format::format_hours_short(f(&row[0])),
            row[1].as_str().unwrap(),
            "{row}"
        );
    }
    assert_eq!(format::format_hours_short(f64::NAN), "0 t");
    for row in rows(&fx, "formatHourlyRate") {
        assert_eq!(
            format::format_hourly_rate(f(&row[0])),
            row[1].as_str().unwrap(),
            "{row}"
        );
    }
}

// ---------------------------------------------------------------------------
// Afrunding og timepris
// ---------------------------------------------------------------------------

#[test]
fn afrunding_af_tid() {
    let fx = load("rounding-rates");
    for row in rows(&fx, "roundGrid") {
        let cfg = RoundingConfig {
            enabled: true,
            minutes: row[1].as_i64().unwrap() as i32,
            method: RoundingMethod::parse(row[2].as_str().unwrap()),
        };
        assert_eq!(
            afrunding::round_hours(f(&row[0]), Some(&cfg)),
            f(&row[3]),
            "{row}"
        );
    }
    for row in rows(&fx, "disabled") {
        let cfg: Option<RoundingConfig> = de(&row[1]);
        assert_eq!(afrunding::round_hours(f(&row[0]), cfg.as_ref()), f(&row[2]));
    }
    for case in rows(&fx, "resolve") {
        let u: RoundingFields = de(&case["user"]);
        let c: RoundingFields = de(&case["client"]);
        let p: RoundingFields = de(&case["project"]);
        let expected: Option<RoundingConfig> = de(&case["expected"]);
        assert_eq!(
            afrunding::resolve_rounding_config(&u, &c, &p),
            expected,
            "{case}"
        );
    }
}

#[test]
fn planlagte_prisskift() {
    let fx = load("rounding-rates");
    for case in rows(&fx, "rates") {
        let changes: Vec<ScheduledRateChange> = de(&case["changes"]);
        let got = timepris::resolve_rate_at_date(
            &changes,
            case["current"].as_str(),
            case["date"].as_str(),
        );
        assert_eq!(
            got.as_deref(),
            case["expected"].as_str(),
            "{} {}",
            case["name"],
            case["date"]
        );
    }
    for row in rows(&fx, "rateDateKeys") {
        assert_eq!(
            timepris::rate_date_key(row[0].as_str().unwrap()).as_deref(),
            row[1].as_str(),
            "{row}"
        );
    }
    for row in rows(&fx, "today") {
        assert_eq!(
            timepris::rate_date_key_of(t(&row[0])),
            row[1].as_str().unwrap()
        );
    }
}

// ---------------------------------------------------------------------------
// Dansk tid
// ---------------------------------------------------------------------------

#[test]
fn danske_datoer_og_datogrænser() {
    let fx = load("copenhagen");
    for row in rows(&fx, "dates") {
        let instant = t(&row[0]);
        assert_eq!(tid::copenhagen_date(instant), d(&row[1]), "{row}");
        assert_eq!(
            i64::from(tid::copenhagen_hour(instant)),
            row[2].as_i64().unwrap(),
            "{row}"
        );
        let entry_day = tid::entry_date_for_start(instant);
        assert_eq!(
            iso(tid::entry_date_utc(entry_day)),
            row[3].as_str().unwrap(),
            "{row}"
        );
    }
    for row in rows(&fx, "dayBounds") {
        let day = d(&row[0]);
        assert_eq!(
            iso(tid::copenhagen_day_start(day)),
            row[1].as_str().unwrap(),
            "{row}"
        );
        assert_eq!(
            iso(tid::copenhagen_day_end_exclusive(day)),
            row[2].as_str().unwrap(),
            "{row}"
        );
        assert_eq!(i64::from(tid::iso_weekday(day)), row[3].as_i64().unwrap());
        assert_eq!(tid::week_start(day), d(&row[4]));
        assert_eq!(tid::month_start(day), d(&row[5]));
        assert_eq!(iso(tid::entry_date_utc(day)), row[6].as_str().unwrap());
    }
    for row in rows(&fx, "addDays") {
        assert_eq!(
            tid::add_days(d(&row[0]), row[1].as_i64().unwrap()),
            d(&row[2]),
            "{row}"
        );
    }
    for row in rows(&fx, "addMonths") {
        assert_eq!(
            tid::add_months(d(&row[0]), row[1].as_i64().unwrap() as i32),
            d(&row[2]),
            "{row}"
        );
    }
    for row in rows(&fx, "wall") {
        let a: Vec<u32> = de(&row[0]);
        let local = NaiveDate::from_ymd_opt(a[0] as i32, a[1], a[2])
            .unwrap()
            .and_hms_opt(a[3], a[4], a[5])
            .unwrap();
        assert_eq!(
            iso(tid::copenhagen_wall_time(local)),
            row[1].as_str().unwrap(),
            "{row}"
        );
    }
    for row in rows(&fx, "isDate") {
        assert_eq!(
            tid::parse_date_str(row[0].as_str().unwrap()).is_some(),
            row[1].as_bool().unwrap(),
            "{row}"
        );
    }
}

#[test]
fn klokkeslaet_tidsrum_over_midnat_og_sommertid() {
    let fx = load("copenhagen");
    for row in rows(&fx, "clockRange") {
        let (date, start, end) = (
            row[0].as_str().unwrap(),
            row[1].as_str().unwrap(),
            row[2].as_str().unwrap(),
        );
        let (s, e) = tid::clock_range_to_instants(date, start, end).expect("gyldig dato");
        assert_eq!(iso(s), row[3].as_str().unwrap(), "start {row}");
        assert_eq!(iso(e), row[4].as_str().unwrap(), "slut {row}");
        assert_eq!(
            tid::clock_range_hours(date, start, end),
            Some(f(&row[5])),
            "timer {row}"
        );
    }
    for row in rows(&fx, "hoursBetween") {
        assert_eq!(
            tid::hours_between(t(&row[0]), t(&row[1])),
            f(&row[2]),
            "{row}"
        );
    }
    // Forkert form og klokkeslæt, som JavaScript ikke kan repræsentere: ingen
    // panik, bare intet tidsrum
    assert_eq!(
        tid::clock_range_to_instants("2026-2-3", "09:00", "10:00"),
        None
    );
    assert_eq!(
        tid::clock_range_to_instants("2026-10-26", "99999999999:00", "10:00"),
        None
    );
    assert_eq!(
        tid::clock_range_to_instants("2026-10-26", "1e300", "10:00"),
        None
    );
}

// ---------------------------------------------------------------------------
// Faktura
// ---------------------------------------------------------------------------

fn num_or_str(v: &Value) -> Option<f64> {
    match v {
        Value::Null => None,
        Value::Number(n) => n.as_f64(),
        Value::String(s) => Some(js::parse_float(s)),
        other => panic!("{other}"),
    }
}

#[test]
fn faktura_forhaandsvisning_og_perioder() {
    let fx = load("invoice");
    for case in rows(&fx, "preview") {
        let entries: Vec<PreviewEntry> = case["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| PreviewEntry {
                id: e["id"].as_str().unwrap().into(),
                hours: num_or_str(&e["hours"]),
                billable_rate: num_or_str(&e["billableRate"]),
                project_id: e["projectId"].as_str().map(Into::into),
                project_name: e["projectName"].as_str().map(Into::into),
                date: e["date"].as_str().unwrap().into(),
            })
            .collect();
        let expected: faktura::InvoicePreview = de(&case["expected"]);
        assert_eq!(faktura::build_invoice_preview(&entries), expected, "{case}");
    }
    for row in rows(&fx, "periods") {
        let period: PreviewPeriod = de(&row[0]);
        let (from, to) = faktura::preview_period_range(period, d(&row[1]));
        assert_eq!(
            from.map(|x| x.to_string()).as_deref(),
            row[2]["from"].as_str(),
            "{row}"
        );
        assert_eq!(
            to.map(|x| x.to_string()).as_deref(),
            row[2]["to"].as_str(),
            "{row}"
        );
    }
}

#[test]
fn faktura_beloeb_i_oere() {
    let fx = load("invoice");
    for row in rows(&fx, "money") {
        let x = f(&row[0]);
        assert_eq!(faktura::round_money(x), f(&row[1]), "roundMoney {row}");
        assert_eq!(
            js::to_fixed(x, 2),
            row[2].as_str().unwrap(),
            "toFixed {row}"
        );
        // Gemt beløb i øre = toFixed(2) ("-0.00" er 0 øre)
        let fixed = row[2].as_str().unwrap().replace("-0.00", "0.00");
        assert_eq!(
            faktura::ore_to_decimal_string(faktura::kroner_to_ore(x)),
            fixed,
            "øre {row}"
        );
        // Vist beløb = toLocaleString("da-DK", 2 decimaler)
        let shown = row[3].as_str().unwrap();
        assert_eq!(js::format_da(x, 2, 2), shown, "vist {row}");
        let ore = faktura::kroner_to_ore_display(x);
        assert_eq!(
            js::format_da(ore as f64 / 100.0, 2, 2),
            shown.replace("-0,00", "0,00"),
            "vist øre {row}"
        );
    }
    for row in rows(&fx, "lines") {
        assert_eq!(
            faktura::line_amount(row[0].as_str().unwrap(), row[1].as_str().unwrap()),
            row[2].as_str().unwrap(),
            "{row}"
        );
    }
    for row in rows(&fx, "sums") {
        let items: Vec<MoneyInput> = row[0]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| match v {
                Value::Null => MoneyInput::Empty,
                Value::Number(n) => MoneyInput::Number(n.as_f64().unwrap()),
                Value::String(s) => MoneyInput::Text(s.as_str()),
                other => panic!("{other}"),
            })
            .collect();
        assert_eq!(faktura::sum_money(&items), f(&row[1]), "{row}");
    }
}

#[test]
fn kladdenumre() {
    let fx = load("invoice");
    for row in rows(&fx, "drafts") {
        let n = row[0].as_str();
        assert_eq!(
            faktura::is_draft_invoice_number(n),
            row[1].as_bool().unwrap(),
            "{row}"
        );
        assert_eq!(
            faktura::format_invoice_number(n),
            row[2].as_str().unwrap(),
            "{row}"
        );
    }
}

#[test]
fn momsoverblik() {
    let fx = load("invoice");
    for case in rows(&fx, "vatOverview") {
        let invoices: Vec<VatInvoice> = case["invoices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| VatInvoice {
                issue_date: d(&r[0]),
                amount_ex_vat: f(&r[1]),
            })
            .collect();
        let kind: Option<VatPeriodKind> = de(&case["vatPeriod"]);
        let expected: VatOverview = de(&case["expected"]);
        assert_eq!(
            faktura::compute_vat_overview(&invoices, d(&case["today"]), kind),
            expected,
            "{case}"
        );
    }
    for row in rows(&fx, "daysUntilDeadline") {
        assert_eq!(
            faktura::days_until_deadline(d(&row[0]), d(&row[1])),
            row[2].as_i64().unwrap()
        );
    }
}
