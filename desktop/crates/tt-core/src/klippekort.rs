//! Klippekort (forudbetalte timer på en kunde): auto-valg, udløb, saldo,
//! træk med overtræks-politik, tilbageførsel og afstemning ved redigering.
//!
//! Web er sandheden:
//! - auto-valg: `src/lib/prepaid/auto-select.ts`
//! - udløb: `src/lib/prepaid/expiry.ts`
//! - timetal og klip: `src/lib/prepaid/hours.ts`
//! - saldo-niveau: `src/lib/prepaid/balance.ts`, `usable-balance.ts`
//! - træk/tilbageførsel: `deductHoursCore`/`reversePrepaidUsage` i
//!   `src/lib/trpc/routers/prepaid.ts:88-340`
//! - afstemning ved redigering: `src/lib/prepaid/reconcile.ts`
//!
//! Funktionerne her er rene: de tager kortets tilstand og "nu" som argumenter
//! og returnerer den nye tilstand. Lagring, låse og adgangstjek (hvem må
//! trække på hvilken kunde) ligger hos kalderen.

use std::cmp::Ordering;
use std::fmt;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::{js, tid};

/// Procent af totalen, hvorunder saldoen er "lav" (`PREPAID_LOW_BALANCE_THRESHOLD`,
/// standard 0,2 i `src/lib/config.ts`).
pub const LOW_BALANCE_THRESHOLD: f64 = 0.2;
/// Timer, hvorunder saldoen altid er "kritisk" (`PREPAID_CRITICAL_BALANCE_HOURS`, standard 1).
pub const CRITICAL_BALANCE_HOURS: f64 = 1.0;
/// Dage før udløb, hvor web varsler (`PREPAID_EXPIRY_WARNING_DAYS`, standard 30).
pub const EXPIRY_WARNING_DAYS: i64 = 30;

/// Hvad der sker, når kortet ikke kan dække en hel registrering (#93).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverdraftPolicy {
    /// Afvis trækket (standard).
    #[default]
    Block,
    /// Træk ikke; registreringen forbliver fakturerbar, evt. til overtræks-satsen.
    Invoice,
    /// Træk hele registreringen; resten føres som overtræk (gæld).
    Allow,
}

/// Et klippekort, som web's `prepaid_packages`-række.
///
/// Deserialiseres direkte fra web's JSON: timer og satser må være tal eller
/// decimalstrenge ("10.00", som `prepaid.list` leverer), og manglende eller
/// `null`-felter får web's standard.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Klippekort {
    pub id: String,
    pub client_id: Option<String>,
    #[serde(deserialize_with = "web::string_or_null")]
    pub name: String,
    #[serde(deserialize_with = "web::hours")]
    pub total_hours: f64,
    #[serde(deserialize_with = "web::hours")]
    pub used_hours: f64,
    #[serde(deserialize_with = "web::hours")]
    pub remaining_hours: f64,
    /// Akkumuleret overtræk (allow-politik).
    #[serde(deserialize_with = "web::hours")]
    pub overdraft_hours: f64,
    /// Timepris på kortet; bruges til `value_used` på trækket.
    #[serde(deserialize_with = "web::hours")]
    pub hourly_rate: f64,
    #[serde(deserialize_with = "web::bool_or_null")]
    pub auto_deduct: bool,
    /// Kolonnen er nullable (default true). Web behandler `null` forskelligt:
    /// auto-valg og saldo udelukker kun `false`, mens trækket kræver `true`.
    pub is_active: Option<bool>,
    #[serde(deserialize_with = "web::bool_or_null")]
    pub is_archived: bool,
    pub expiry_date: Option<DateTime<Utc>>,
    pub purchase_date: Option<DateTime<Utc>>,
    /// Klip-størrelse i minutter; et træk rundes OP til hele klip.
    pub clip_size_minutes: Option<i32>,
    #[serde(deserialize_with = "web::policy")]
    pub overdraft_policy: OverdraftPolicy,
    /// Sats for tid, der går til faktura under invoice-politikken.
    #[serde(deserialize_with = "web::opt_number")]
    pub overdraft_rate: Option<f64>,
}

/// Web's JSON-former: decimalkolonner som strenge, nullable flag.
mod web {
    use serde::{Deserialize, Deserializer};

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum NumOrStr {
        Num(f64),
        Str(String),
    }

    fn to_f64(v: NumOrStr) -> f64 {
        match v {
            NumOrStr::Num(n) => n,
            NumOrStr::Str(s) => crate::js::parse_float(&s),
        }
    }

    /// Tal eller decimalstreng; `null` = 0 (`parseFloat(x || "0")`).
    pub fn hours<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
        Ok(Option::<NumOrStr>::deserialize(d)?
            .map(to_f64)
            .unwrap_or(0.0))
    }

    pub fn opt_number<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
        Ok(Option::<NumOrStr>::deserialize(d)?.map(to_f64))
    }

    pub fn bool_or_null<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
        Ok(Option::<bool>::deserialize(d)?.unwrap_or(false))
    }

    pub fn string_or_null<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
        Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
    }

    /// `pkg.overdraftPolicy || "block"`
    pub fn policy<'de, D: Deserializer<'de>>(d: D) -> Result<super::OverdraftPolicy, D::Error> {
        Ok(match Option::<String>::deserialize(d)?.as_deref() {
            Some("invoice") => super::OverdraftPolicy::Invoice,
            Some("allow") => super::OverdraftPolicy::Allow,
            _ => super::OverdraftPolicy::Block,
        })
    }
}

// ---------------------------------------------------------------------------
// Timetal (hours.ts)
// ---------------------------------------------------------------------------

/// Timer afrundet til 2 decimaler som web gemmer dem (`roundPrepaidHours`).
pub fn round_prepaid_hours(hours: f64) -> f64 {
    js::round((hours + f64::EPSILON) * 100.0) / 100.0
}

/// Timer rundet OP til 2 decimaler (`ceilPrepaidHours`).
pub fn ceil_prepaid_hours(hours: f64) -> f64 {
    ((hours - f64::EPSILON) * 100.0).ceil() / 100.0
}

/// Timerne, et træk faktisk koster: rundet op til hele klip, hvis kortet har
/// en klip-størrelse, ellers afrundet til 2 decimaler
/// (`normalizePrepaidDeductionHours`).
pub fn normalize_deduction_hours(hours: f64, clip_size_minutes: Option<i32>) -> f64 {
    match clip_size_minutes {
        Some(clip) if clip > 0 => {
            let clip_hours = f64::from(clip) / 60.0;
            ceil_prepaid_hours((hours / clip_hours).ceil() * clip_hours)
        }
        _ => round_prepaid_hours(hours),
    }
}

/// Restsaldo, når kortets total rettes; `None` hvis den nye total ligger
/// under det allerede brugte (`remainingAfterTotalChange`).
pub fn remaining_after_total_change(total_hours: f64, used_hours: f64) -> Option<f64> {
    let total = round_prepaid_hours(total_hours);
    let used = round_prepaid_hours(used_hours);
    if total < used {
        return None;
    }
    Some(round_prepaid_hours(total - used))
}

// ---------------------------------------------------------------------------
// Udløb (expiry.ts)
// ---------------------------------------------------------------------------

/// Udløbsdatoen som dansk kalenderdato. Kortet gælder HELE den dag (#736).
pub fn expiry_date(expiry: DateTime<Utc>) -> NaiveDate {
    tid::copenhagen_date(expiry)
}

/// Første øjeblik kortet ER udløbet: dansk midnat efter udløbsdatoen.
pub fn valid_until(expiry: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    expiry.map(|e| tid::copenhagen_day_end_exclusive(expiry_date(e)))
}

/// Er kortet udløbet på tidspunktet `now`? Kort uden udløb udløber aldrig.
pub fn is_expired(expiry: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    valid_until(expiry).is_some_and(|v| now >= v)
}

/// Grænse til forespørgsler: et kort med udløb `<` grænsen er udløbet
/// (`prepaidExpiredBefore`).
pub fn expired_before(now: DateTime<Utc>) -> DateTime<Utc> {
    tid::copenhagen_day_start(tid::copenhagen_date(now))
}

/// Eksklusiv grænse for "udløber senest om `days` dage" (`prepaidExpiresWithinBefore`).
pub fn expires_within_before(days: i64, now: DateTime<Utc>) -> DateTime<Utc> {
    tid::copenhagen_day_start(tid::add_days(tid::copenhagen_date(now), days + 1))
}

/// Hele danske kalenderdage til udløbsdatoen: 0 = udløber i dag, negativ =
/// udløbet. `None` = intet udløb (`prepaidDaysUntilExpiry`).
pub fn days_until_expiry(expiry: Option<DateTime<Utc>>, now: DateTime<Utc>) -> Option<i64> {
    expiry.map(|e| (expiry_date(e) - tid::copenhagen_date(now)).num_days())
}

/// Udløber kortet i dag eller inden for `within_days` dage? (udvidelsens
/// `isPrepaidExpiringSoon`, standard 7 dage).
pub fn is_expiring_soon(
    expiry: Option<DateTime<Utc>>,
    within_days: i64,
    now: DateTime<Utc>,
) -> bool {
    days_until_expiry(expiry, now).is_some_and(|d| (0..=within_days).contains(&d))
}

/// "udløber i dag", "udløber i morgen", "udløber om N dage" eller "udløbet".
pub fn expiry_phrase(days: i64) -> String {
    match days {
        d if d < 0 => "udløbet".into(),
        0 => "udløber i dag".into(),
        1 => "udløber i morgen".into(),
        d => format!("udløber om {d} dage"),
    }
}

/// [`expiry_phrase`] med stort begyndelsesbogstav, til badges.
pub fn expiry_label(days: i64) -> String {
    let phrase = expiry_phrase(days);
    let mut chars = phrase.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => phrase,
    }
}

/// Udløbet for en kopi af et kort (#738): samme gyldighed i hele dage som
/// originalen, regnet fra dagens danske dato og gemt som UTC-midnat.
pub fn duplicated_expiry(
    purchase_date: Option<DateTime<Utc>>,
    expiry: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    let expiry_day = expiry_date(expiry?);
    let purchase_day = purchase_date.map(expiry_date).unwrap_or(expiry_day);
    let valid_days = (expiry_day - purchase_day).num_days().max(0);
    Some(tid::entry_date_utc(tid::add_days(
        tid::copenhagen_date(now),
        valid_days,
    )))
}

// ---------------------------------------------------------------------------
// Auto-valg (auto-select.ts)
// ---------------------------------------------------------------------------

fn cmp_optional_instant(a: Option<DateTime<Utc>>, b: Option<DateTime<Utc>>) -> Ordering {
    match (a, b) {
        (Some(x), Some(y)) => x.cmp(&y),
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
    }
}

/// Kortet en ny registrering foreslås trukket fra (`pickAutoDeductPackage`, #422).
///
/// Kun aktive kort med auto-træk, saldo og ikke udløbet. Det der udløber
/// først vinder; kort uden udløb kommer sidst. Ved samme udløb vinder det
/// ældste købte (FIFO); kort uden købsdato sidst; ellers listens orden.
///
/// Som i web filtreres der IKKE på kunde eller arkivering: kalderen giver
/// kundens kort (web's server-liste er allerede kundens ikke-arkiverede kort).
/// Brug [`pick_auto_deduct_for_client`] for at få kundefilteret med.
pub fn pick_auto_deduct(packages: &[Klippekort], now: DateTime<Utc>) -> Option<&Klippekort> {
    let mut candidates: Vec<&Klippekort> = packages
        .iter()
        .filter(|p| {
            p.auto_deduct
                && p.is_active != Some(false)
                && p.remaining_hours > 0.0
                && !is_expired(p.expiry_date, now)
        })
        .collect();
    // sort_by er stabil som Array.prototype.sort
    candidates.sort_by(|a, b| {
        cmp_optional_instant(a.expiry_date, b.expiry_date)
            .then_with(|| cmp_optional_instant(a.purchase_date, b.purchase_date))
    });
    candidates.into_iter().next()
}

/// [`pick_auto_deduct`] blandt kortene, der tilhører `client_id`.
pub fn pick_auto_deduct_for_client<'a>(
    packages: &'a [Klippekort],
    client_id: Option<&str>,
    now: DateTime<Utc>,
) -> Option<&'a Klippekort> {
    let client_id = client_id?;
    let own: Vec<Klippekort> = packages
        .iter()
        .filter(|p| p.client_id.as_deref() == Some(client_id))
        .cloned()
        .collect();
    let picked = pick_auto_deduct(&own, now)?.id.clone();
    packages.iter().find(|p| p.id == picked)
}

/// Timerens gemte klippekort-valg, som serveren leverer det
/// (`TimerPrepaidChoiceView`). Intet valg (`None` hos kalderen) = automatisk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum TimerPrepaidChoice {
    /// "Intet klippekort" for kunden.
    #[serde(rename_all = "camelCase")]
    None { client_id: String },
    /// Et bestemt kort, også uden auto-træk.
    #[serde(rename_all = "camelCase")]
    Package {
        package_id: String,
        client_id: String,
    },
}

impl TimerPrepaidChoice {
    fn client_id(&self) -> &str {
        match self {
            Self::None { client_id } | Self::Package { client_id, .. } => client_id,
        }
    }
}

/// Kortet en stop-dialog skal forvælge (`resolveTimerPrepaidSelection`):
/// "Intet klippekort" → intet kort; et valgt kort → det kort, hvis det stadig
/// findes, ellers INTET (et eksplicit valg erstattes aldrig stiltiende af et
/// andet kort); automatisk eller valg for en anden kunde → [`pick_auto_deduct`].
pub fn resolve_timer_selection<'a>(
    choice: Option<&TimerPrepaidChoice>,
    client_id: Option<&str>,
    packages: &'a [Klippekort],
    now: DateTime<Utc>,
) -> Option<&'a Klippekort> {
    if let (Some(choice), Some(client)) = (choice, client_id)
        && !client.is_empty()
        && choice.client_id() == client
    {
        return match choice {
            TimerPrepaidChoice::None { .. } => None,
            TimerPrepaidChoice::Package { package_id, .. } => {
                packages.iter().find(|p| &p.id == package_id)
            }
        };
    }
    pick_auto_deduct(packages, now)
}

// ---------------------------------------------------------------------------
// Saldo (balance.ts, usable-balance.ts)
// ---------------------------------------------------------------------------

/// Niveau for en klippekort-saldo (#881).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BalanceLevel {
    Ok,
    Low,
    Critical,
}

/// "ok", "low" eller "critical" for timer tilbage af kortets total
/// (`prepaidBalanceLevel`). Grænserne er inklusive.
pub fn balance_level(remaining_hours: f64, total_hours: f64) -> BalanceLevel {
    if remaining_hours <= 0.0 || remaining_hours <= CRITICAL_BALANCE_HOURS {
        return BalanceLevel::Critical;
    }
    if total_hours > 0.0 && remaining_hours <= total_hours * LOW_BALANCE_THRESHOLD {
        return BalanceLevel::Low;
    }
    BalanceLevel::Ok
}

/// Lav eller kritisk saldo (`isPrepaidBalanceLow`).
pub fn is_balance_low(remaining_hours: f64, total_hours: f64) -> bool {
    balance_level(remaining_hours, total_hours) != BalanceLevel::Ok
}

/// Skal lav-saldo-advarslen sendes efter et træk? Én gang pr. gang saldoen
/// krydser grænsen (`checkAndSendLowBalanceAlert`, prepaid.ts:346-358).
pub fn should_send_low_balance_alert(
    remaining_hours: f64,
    total_hours: f64,
    alert_already_sent: bool,
) -> bool {
    if total_hours <= 0.0 {
        return false;
    }
    let percentage_remaining = (remaining_hours / total_hours) * 100.0;
    percentage_remaining <= LOW_BALANCE_THRESHOLD * 100.0 && !alert_already_sent
}

/// Timer kunden faktisk kan trække på: aktive, ikke-arkiverede og ikke-udløbne
/// kort (`sumUsablePrepaidHours`).
pub fn sum_usable_hours(packages: &[Klippekort], now: DateTime<Utc>) -> f64 {
    packages
        .iter()
        .filter(|p| p.is_active != Some(false) && !p.is_archived && !is_expired(p.expiry_date, now))
        .map(|p| p.remaining_hours)
        .filter(|r| r.is_finite())
        .fold(0.0, |sum, r| sum + r)
}

// ---------------------------------------------------------------------------
// Træk og tilbageførsel (deductHoursCore / reversePrepaidUsage)
// ---------------------------------------------------------------------------

/// Et træk på et kort.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeductRequest {
    /// Registreringens timer (før klip-afrunding).
    pub hours: f64,
    /// Trækket hører til en registrering; så skal kunden matche kortets.
    pub for_time_entry: bool,
    /// Registreringens EFFEKTIVE kunde (se [`effective_client_id`]).
    pub client_id: Option<String>,
    /// Spring aktiv/udløbet-tjekket over. KUN ved afstemning, hvor trækket
    /// netop er tilbageført og nettoeffekten frigiver timer.
    pub allow_inactive: bool,
}

/// Hvorfor et træk blev afvist. `Display` giver web's danske besked.
#[derive(Debug, Clone, PartialEq)]
pub enum DeductError {
    InvalidHours,
    WrongClient,
    Inactive,
    Expired,
    InsufficientBalance {
        available: f64,
        required: f64,
        clip_size_minutes: Option<i32>,
    },
}

impl fmt::Display for DeductError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidHours => f.write_str("Ugyldigt timetal til klippekort-traek"),
            Self::WrongClient => {
                f.write_str("Klippekortet tilhører en anden kunde end tidspostens klient")
            }
            Self::Inactive => f.write_str("Klippekort er ikke aktivt"),
            Self::Expired => f.write_str("Klippekortet er udløbet"),
            Self::InsufficientBalance {
                available,
                required,
                clip_size_minutes,
            } => {
                write!(
                    f,
                    "Ikke nok timer tilbage på klippekortet. Tilgængelige timer: {}",
                    js::to_fixed(*available, 2)
                )?;
                match clip_size_minutes {
                    Some(clip) if *clip != 0 => write!(
                        f,
                        ", kræver {}t (oprundet til {clip} min klip)",
                        js::to_fixed(*required, 2)
                    ),
                    _ => Ok(()),
                }
            }
        }
    }
}

impl std::error::Error for DeductError {}

/// Rækken web skriver i `prepaid_usage` for et træk.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UsageRow {
    /// Klip-afrundede timer.
    pub hours_used: f64,
    /// Timer × kortets timepris.
    pub value_used: f64,
    /// Den del af trækket, der var overtræk (allow-politik).
    pub overdraft_hours: f64,
}

/// Udfaldet af et træk: kortets nye tal og hvad registreringen skal markeres som.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeductResult {
    /// Faktisk trukket (klip-afrundet); 0 når tiden gik til faktura.
    pub hours_deducted: f64,
    /// Timer trukket ud over saldoen (allow-politik).
    pub overdrafted_hours: f64,
    /// Invoice-politik og for lidt saldo: INTET blev trukket, registreringen
    /// forbliver fakturerbar.
    pub overflowed_to_invoice: bool,
    pub total_hours: f64,
    pub used_hours: f64,
    pub remaining_hours: f64,
    /// Kortets samlede overtræk efter trækket.
    pub overdraft_hours: f64,
    /// `prepaid_usage`-rækken; `None` når intet blev trukket.
    pub usage: Option<UsageRow>,
    /// Registreringens nye klippekort-felter.
    pub entry: EntryPrepaidPatch,
}

/// Felterne på registreringen, et træk sætter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPrepaidPatch {
    pub is_prepaid: bool,
    pub prepaid_package_id: Option<String>,
    /// `Some(true)` når tiden gik til faktura.
    pub is_billable: Option<bool>,
    /// Overtræks-satsen, når tiden gik til faktura og kortet har en.
    pub billable_rate: Option<f64>,
}

/// Træk `request.hours` på kortet (`deductHoursCore`, prepaid.ts:88-279).
///
/// Klip-afrunder, håndhæver aktiv/udløb (kortet gælder hele udløbsdagen) og
/// overtræks-politikken. Saldoen går aldrig under 0; under allow-politik
/// føres resten som overtræk. Et kort med `is_active: None` afvises, som
/// web's `!pkg.isActive`.
///
/// `usage.value_used`, `overdrafted_hours` og `overdraft_hours` returneres
/// uafrundede som i web, hvor decimalkolonnerne (2 decimaler) runder ved
/// lagring; afrund dem før de gemmes.
pub fn deduct(
    pkg: &Klippekort,
    request: &DeductRequest,
    now: DateTime<Utc>,
) -> Result<DeductResult, DeductError> {
    if !request.hours.is_finite() || request.hours <= 0.0 {
        return Err(DeductError::InvalidHours);
    }
    if request.for_time_entry && request.client_id != pkg.client_id {
        return Err(DeductError::WrongClient);
    }
    if !request.allow_inactive {
        if pkg.is_active != Some(true) {
            return Err(DeductError::Inactive);
        }
        if is_expired(pkg.expiry_date, now) {
            return Err(DeductError::Expired);
        }
    }

    let remaining = round_prepaid_hours(pkg.remaining_hours);
    let used = round_prepaid_hours(pkg.used_hours);
    let total = round_prepaid_hours(pkg.total_hours);
    let to_deduct = normalize_deduction_hours(request.hours, pkg.clip_size_minutes);
    if to_deduct.is_nan() || to_deduct <= 0.0 {
        return Err(DeductError::InvalidHours);
    }

    let mut overdrafted = 0.0;
    if remaining < to_deduct {
        match pkg.overdraft_policy {
            OverdraftPolicy::Block => {
                return Err(DeductError::InsufficientBalance {
                    available: remaining,
                    required: to_deduct,
                    clip_size_minutes: pkg.clip_size_minutes,
                });
            }
            OverdraftPolicy::Invoice => {
                // Kortet røres ikke; registreringen forbliver fakturerbar
                return Ok(DeductResult {
                    hours_deducted: 0.0,
                    overdrafted_hours: 0.0,
                    overflowed_to_invoice: true,
                    total_hours: total,
                    used_hours: used,
                    remaining_hours: remaining,
                    overdraft_hours: pkg.overdraft_hours,
                    usage: None,
                    entry: EntryPrepaidPatch {
                        is_prepaid: false,
                        prepaid_package_id: None,
                        is_billable: Some(true),
                        billable_rate: pkg.overdraft_rate,
                    },
                });
            }
            OverdraftPolicy::Allow => overdrafted = to_deduct - remaining,
        }
    }

    let from_balance = round_prepaid_hours(remaining.min(to_deduct));
    let new_used = round_prepaid_hours(total.min(used + from_balance));
    let new_remaining = round_prepaid_hours((total - new_used).max(0.0));
    let value_used = to_deduct * pkg.hourly_rate;

    Ok(DeductResult {
        hours_deducted: to_deduct,
        overdrafted_hours: overdrafted,
        overflowed_to_invoice: false,
        total_hours: total,
        used_hours: new_used,
        remaining_hours: new_remaining,
        overdraft_hours: pkg.overdraft_hours + overdrafted,
        usage: Some(UsageRow {
            hours_used: to_deduct,
            value_used,
            overdraft_hours: overdrafted,
        }),
        entry: EntryPrepaidPatch {
            is_prepaid: true,
            prepaid_package_id: Some(pkg.id.clone()),
            is_billable: None,
            billable_rate: None,
        },
    })
}

/// Kortets nye tal efter at ALLE træk for en registrering er tilbageført.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseResult {
    /// Timer der var trukket i alt (inkl. overtræk).
    pub restored_hours: f64,
    pub used_hours: f64,
    pub remaining_hours: f64,
    pub overdraft_hours: f64,
    /// Lav-saldo-advarslen må sendes igen.
    pub reset_low_balance_alert: bool,
}

/// Tilbagefør registreringens træk (`reversePrepaidUsage`, prepaid.ts:288-340).
///
/// Kun timer, der IKKE var overtræk, kommer tilbage på saldoen, og saldoen
/// kan aldrig komme over totalen. Overtrækket fjernes præcis med den andel,
/// rækkerne selv bar. Uden træk (summen er 0) er kortet uændret.
///
/// Web regner i PostgreSQL-decimaler; her afrundes resultatet til 2 decimaler
/// som kolonnerne.
pub fn reverse(pkg: &Klippekort, usages: &[UsageRow]) -> ReverseResult {
    let total_used: f64 = usages.iter().map(|u| u.hours_used).sum();
    let total_overdraft: f64 = usages.iter().map(|u| u.overdraft_hours).sum();
    if total_used.is_nan() || total_used <= 0.0 {
        return ReverseResult {
            restored_hours: total_used,
            used_hours: pkg.used_hours,
            remaining_hours: pkg.remaining_hours,
            overdraft_hours: pkg.overdraft_hours,
            reset_low_balance_alert: false,
        };
    }
    let restore = (total_used - total_overdraft).max(0.0);
    ReverseResult {
        restored_hours: total_used,
        remaining_hours: round_prepaid_hours(pkg.total_hours.min(pkg.remaining_hours + restore)),
        overdraft_hours: round_prepaid_hours((pkg.overdraft_hours - total_overdraft).max(0.0)),
        used_hours: round_prepaid_hours((pkg.used_hours - restore).max(0.0)),
        reset_low_balance_alert: true,
    }
}

// ---------------------------------------------------------------------------
// Afstemning ved redigering (reconcile.ts)
// ---------------------------------------------------------------------------

/// En registrerings kunde, som den er gemt: egen kunde og/eller projektets.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EntryClientRef {
    pub client_id: Option<String>,
    pub project_client_id: Option<String>,
}

/// Registreringens effektive kunde: egen, ellers projektets.
pub fn effective_client_id(r: &EntryClientRef) -> Option<&str> {
    r.client_id.as_deref().or(r.project_client_id.as_deref())
}

/// Redigeringens eksplicitte kortvalg.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum RequestedPackage {
    /// Ikke angivet: følg reglerne.
    #[default]
    Unspecified,
    /// Fjern trækket.
    Remove,
    /// Træk på dette kort.
    Package(String),
}

/// Input til [`resolve_reconcile`].
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ReconcileInput {
    pub was_prepaid: bool,
    pub old_package_id: Option<String>,
    pub old_client: EntryClientRef,
    pub new_client: EntryClientRef,
    pub requested: RequestedPackage,
    pub old_hours: f64,
    pub new_hours: f64,
}

/// Beslutningen: hvilket kort registreringen skal stå på efter redigeringen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileDecision {
    pub target_package_id: Option<String>,
    /// Skal der tilbageføres/trækkes overhovedet?
    pub needs_reconcile: bool,
    pub package_changed: bool,
    pub client_changed: bool,
    /// Gen-trækket må springe aktiv-tjekket over (samme kort, frigiver timer).
    pub allow_inactive: bool,
}

/// `resolvePrepaidReconcile` (#204): kundeskift uden eksplicit valg fjerner
/// trækket; samme kunde og samme kort beholder det; kun den EFFEKTIVE kunde
/// sammenlignes.
pub fn resolve_reconcile(input: &ReconcileInput) -> ReconcileDecision {
    let client_changed =
        effective_client_id(&input.old_client) != effective_client_id(&input.new_client);
    let target = match &input.requested {
        RequestedPackage::Remove => None,
        RequestedPackage::Package(id) => Some(id.clone()),
        RequestedPackage::Unspecified if input.was_prepaid && client_changed => None,
        RequestedPackage::Unspecified if input.was_prepaid => input.old_package_id.clone(),
        RequestedPackage::Unspecified => None,
    };
    let package_changed = input.old_package_id != target;
    let needs_reconcile = if input.was_prepaid {
        package_changed || input.old_hours != input.new_hours
    } else {
        target.is_some()
    };
    ReconcileDecision {
        target_package_id: target,
        needs_reconcile,
        package_changed,
        client_changed,
        allow_inactive: !package_changed && input.new_hours <= input.old_hours,
    }
}

// ---------------------------------------------------------------------------
// Klient-side valg og kvittering (udvidelsen, browser-extension/src/lib/prepaid.ts)
// ---------------------------------------------------------------------------

/// Hvad trækket faktisk blev, til kvitteringen (`classifyPrepaidDeduction`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReceiptKind {
    Deducted,
    DeductedOverflow,
    NothingDeducted,
}

/// Ved invoice-politik og tomt kort er INTET trukket, og kvitteringen må ikke
/// påstå det.
pub fn classify_deduction(hours_deducted: f64, overflowed_to_invoice: bool) -> ReceiptKind {
    if hours_deducted <= 0.0 {
        ReceiptKind::NothingDeducted
    } else if overflowed_to_invoice {
        ReceiptKind::DeductedOverflow
    } else {
        ReceiptKind::Deducted
    }
}

/// Er en fejl fra serveren klippekort-relateret? Så gemmes tiden uden træk i
/// stedet for at blive tabt (`isPrepaidDeductionError`).
pub fn is_prepaid_deduction_error(message: &str) -> bool {
    message.to_lowercase().contains("klippekort")
}
