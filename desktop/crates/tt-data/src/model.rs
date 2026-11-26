//! Domænetyper med web-appens navne (`src/lib/db/schema.ts`), serialiseret
//! i camelCase som tRPC-svarene. Decimaler (timer, beløb, satser) er
//! `rust_decimal::Decimal`: web sender dem som strenge ("12.50"), og
//! deserialiseringen tager både streng og tal. Ukendte felter ignoreres, så
//! nye kolonner i web ikke vælter klienten.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

pub type Id = String;

/// Tilstanden appen kører i (spec D5/D6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Logget ind: web er sandheden.
    Cloud,
    /// Uden konto: egen SQLite med livstidslicens.
    Local,
}

// ---------------------------------------------------------------- auth/enhed

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: Id,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
    pub id: Id,
    pub name: String,
    /// owner, admin, member …
    #[serde(default)]
    pub role: String,
}

/// Denne maskine. `device_id` er stabil (gemmes første gang) og sendes ved
/// login, så enheden kan ses og tilbagekaldes i web.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    /// "macos" eller "windows".
    pub os: String,
    pub app_version: String,
}

impl DeviceInfo {
    /// Stabil enheds-id: læses fra `path`, eller oprettes (UUID v4) og
    /// gemmes første gang. Filen ligger i appens datamappe, så id'et
    /// overlever opdateringer, men ikke en ny maskine.
    pub fn load_or_create_id(path: &std::path::Path) -> std::io::Result<String> {
        if let Ok(id) = std::fs::read_to_string(path) {
            let id = id.trim();
            if uuid::Uuid::parse_str(id).is_ok() {
                return Ok(id.to_owned());
            }
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::write(path, &id)?;
        Ok(id)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub mode: Mode,
    /// None i lokal tilstand og når man er logget ud.
    pub user: Option<User>,
    pub organization_id: Option<Id>,
    pub device: DeviceInfo,
}

// ---------------------------------------------------------------- kunder

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Client {
    pub id: Id,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub company: Option<String>,
    pub address: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub cvr_number: Option<String>,
    pub notes: Option<String>,
    pub default_hourly_rate: Option<Decimal>,
    pub payment_terms_days: Option<i32>,
    pub rounding_enabled: Option<bool>,
    pub rounding_minutes: Option<i32>,
    pub rounding_method: Option<String>,
    #[serde(default = "yes")]
    pub default_billable: bool,
    pub color: Option<String>,
    /// Kundens egne domæner (web's `clients.domains`): detektionen genkender
    /// kunden på dem. Normaliseret med [`normalize_client_domains`].
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub domains: Vec<String>,
    pub is_active: Option<bool>,
    pub is_archived: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

impl Client {
    pub fn archived(&self) -> bool {
        self.is_archived.unwrap_or(false)
    }
}

fn yes() -> bool {
    true
}

/// Input til `clients.create` (samme felter som web's schema).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NewClient {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub postal_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cvr_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "crate::serde_util::money_string_option"
    )]
    pub default_hourly_rate: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub domains: Vec<String>,
    /// Dage til forfald. `None` = standarden (fakturaopsætning, ellers 14).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_terms_days: Option<i32>,
    /// `Some(false)` = intern kunde: nye poster er ikke fakturerbare som
    /// standard (web's `defaultBillable`). `None` = fakturerbar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_billable: Option<bool>,
}

/// Delvis rettelse. `None` = uændret.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClientPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cvr_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// `Some(None)` fjerner kundens timepris (den globale bruges så).
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub default_hourly_rate: Option<Option<Decimal>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// `Some(vec![])` fjerner alle domæner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domains: Option<Vec<String>>,
    /// `Some(None)` fjerner kundens betalingsfrist (standarden bruges så).
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub payment_terms_days: Option<Option<i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_billable: Option<bool>,
}

/// Kundens domæner som web's `normalizeClientDomains`: små bogstaver, uden
/// "https://", "@", sti, punktum til sidst og "www.", uden dubletter.
/// Samme regex som web (labels a-z0-9 og bindestreg, TLD kun bogstaver). Et
/// ugyldigt domæne giver en dansk fejl (web afviser hele kunden). Tomme
/// linjer springes over.
pub fn normalize_client_domains(input: &[String]) -> Result<Vec<String>, String> {
    if input.len() > 50 {
        return Err("Højst 50 domæner pr. kunde".into());
    }
    let label_ok = |l: &str| {
        !l.is_empty()
            && l.len() <= 63
            && !l.starts_with('-')
            && !l.ends_with('-')
            && l.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    let mut out: Vec<String> = Vec::new();
    for raw in input {
        let mut d = raw.trim().to_lowercase();
        if d.is_empty() {
            continue;
        }
        for prefix in ["https://", "http://"] {
            if let Some(rest) = d.strip_prefix(prefix) {
                d = rest.to_owned();
                break;
            }
        }
        let d = d.strip_prefix('@').unwrap_or(&d);
        let d = d.split('/').next().unwrap_or("").trim_end_matches('.');
        let labels: Vec<&str> = d.split('.').collect();
        let tld = labels.last().copied().unwrap_or("");
        let valid = d.len() <= 253
            && labels.len() >= 2
            && labels.iter().all(|l| label_ok(l))
            && (2..=63).contains(&tld.len())
            && tld.chars().all(|c| c.is_ascii_lowercase());
        if !valid {
            return Err(format!("Ugyldigt domæne: {}", raw.trim()));
        }
        let host = d.strip_prefix("www.").unwrap_or(d);
        if !out.iter().any(|x| x == host) {
            out.push(host.to_owned());
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- projekter

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    #[default]
    Active,
    Completed,
    OnHold,
    Archived,
}

impl ProjectStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ProjectStatus::Active => "active",
            ProjectStatus::Completed => "completed",
            ProjectStatus::OnHold => "on_hold",
            ProjectStatus::Archived => "archived",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "completed" => ProjectStatus::Completed,
            "on_hold" => ProjectStatus::OnHold,
            "archived" => ProjectStatus::Archived,
            _ => ProjectStatus::Active,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub id: Id,
    pub name: String,
    pub description: Option<String>,
    pub client_id: Option<Id>,
    pub hourly_rate: Option<Decimal>,
    pub rounding_enabled: Option<bool>,
    pub rounding_minutes: Option<i32>,
    pub rounding_method: Option<String>,
    pub fixed_price: Option<Decimal>,
    pub monthly_budget_hours: Option<Decimal>,
    pub budget_hours: Option<Decimal>,
    #[serde(deserialize_with = "crate::serde_util::project_status")]
    pub status: ProjectStatus,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    /// Udvidelsens URL-mønstre ("github.com/firma/*").
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub url_patterns: Vec<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NewProject {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "crate::serde_util::money_string_option"
    )]
    pub hourly_rate: Option<Decimal>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "crate::serde_util::money_string_option"
    )]
    pub budget_hours: Option<Decimal>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub url_patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `Some(None)` fjerner kunden.
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub client_id: Option<Option<Id>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `Some(None)` fjerner projektets timepris (kundens bruges så).
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub hourly_rate: Option<Option<Decimal>>,
    /// Budget i timer. `Some(None)` fjerner budgettet.
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub budget_hours: Option<Option<Decimal>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url_patterns: Option<Vec<String>>,
}

// ---------------------------------------------------------------- klippekort

/// Klippekort (web: `prepaid_packages`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PrepaidPackage {
    pub id: Id,
    pub name: String,
    pub client_id: Id,
    pub total_hours: Decimal,
    /// Nullable i web (standard "0").
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub used_hours: Decimal,
    pub remaining_hours: Decimal,
    pub hourly_rate: Decimal,
    pub total_value: Decimal,
    pub purchase_date: Option<DateTime<Utc>>,
    pub expiry_date: Option<DateTime<Utc>>,
    /// Nullable i web (standard true).
    #[serde(default = "yes", deserialize_with = "crate::serde_util::null_as_true")]
    pub is_active: bool,
    pub is_archived: Option<bool>,
    pub description: Option<String>,
    pub clip_size_minutes: Option<i32>,
    #[serde(default = "yes")]
    pub auto_deduct: bool,
    /// block | allow | invoice
    pub overdraft_policy: Option<String>,
    pub overdraft_rate: Option<Decimal>,
    pub overdraft_hours: Option<Decimal>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NewPrepaidPackage {
    pub name: String,
    pub client_id: Id,
    #[serde(with = "rust_decimal::serde::float")]
    pub total_hours: Decimal,
    #[serde(with = "rust_decimal::serde::float")]
    pub hourly_rate: Decimal,
    /// "yyyy-MM-dd"
    pub purchase_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiry_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip_size_minutes: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overdraft_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_deduct: Option<bool>,
}

/// Rettelse af et klippekort. `None` = uændret; `Some(None)` rydder feltet.
/// Web's `klippekort.update` erstatter hele kortet, så cloud lægger
/// rettelsen oven på det nuværende kort. Saldoen (brugt/tilbage) beregnes
/// altid af datalaget: en ny `total_hours` under det brugte afvises.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PrepaidPackagePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_hours: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hourly_rate: Option<Decimal>,
    /// "yyyy-MM-dd"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purchase_date: Option<String>,
    /// "yyyy-MM-dd"; `Some(None)` = intet udløb.
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub expiry_date: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub description: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub clip_size_minutes: Option<Option<i32>>,
    /// block | allow | invoice
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overdraft_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_deduct: Option<bool>,
}

/// Én række i et klippekorts forbrugshistorik (web: `prepaid_usage` fra
/// `klippekort.get` → `usageHistory`, nyeste først).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PrepaidUsage {
    pub id: Id,
    /// `None` for manuelle træk uden post.
    pub time_entry_id: Option<Id>,
    /// Hele trækket inkl. overtræk.
    pub hours_used: Decimal,
    /// Den del af `hours_used`, der var overtræk.
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub overdraft_hours: Decimal,
    pub value_used: Decimal,
    /// Beskrivelse af et manuelt træk.
    pub description: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    /// Posten bag trækket (web: `timeEntry`), hvis den findes.
    pub time_entry: Option<UsageEntry>,
}

/// Det, forbrugshistorikken skal vide om posten bag et træk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UsageEntry {
    pub id: Id,
    pub description: Option<String>,
    #[serde(with = "crate::serde_util::entry_date")]
    pub date: NaiveDate,
}

/// Træk fra et klippekort ved oprettelse af en post (samme form som web).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PrepaidDeduction {
    pub package_name: String,
    pub hours_deducted: Decimal,
    pub remaining_hours: Decimal,
    /// Kortets samlede timer (web sender den; lokal tilstand udfylder den).
    pub total_hours: Decimal,
    /// Kun lokal tilstand. Web sender `prepaidDeduction: null`, når
    /// posten gik til faktura i stedet.
    pub overflowed_to_invoice: bool,
}

// ---------------------------------------------------------------- tidsposter

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TimeEntry {
    pub id: Id,
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
    pub prepaid_package_id: Option<Id>,
    pub invoice_id: Option<Id>,
    pub task_id: Option<Id>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub hours: Decimal,
    /// Dansk kalenderdag. Web gemmer den som UTC-midnat.
    #[serde(with = "crate::serde_util::entry_date")]
    pub date: NaiveDate,
    /// None = post uden tidspunkt.
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub billable_rate: Option<Decimal>,
    pub is_billable: Option<bool>,
    pub is_billed: Option<bool>,
    pub is_prepaid: Option<bool>,
    /// manual, timer, auto_track, import, api
    pub source: Option<String>,
    pub client_entry_id: Option<String>,
    pub timer_session_id: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    /// Kun i lokal cache: posten venter i offline-køen.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pending: bool,
}

impl TimeEntry {
    pub fn has_time_range(&self) -> bool {
        self.start_time.is_some() && self.end_time.is_some()
    }
}

/// Input til `time.create` (web's `createTimeEntryInput`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NewTimeEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<Id>,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(with = "rust_decimal::serde::float")]
    pub hours: Decimal,
    /// "yyyy-MM-dd" (dansk dag).
    #[serde(with = "crate::serde_util::entry_date")]
    pub date: NaiveDate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_billable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prepaid_package_id: Option<Id>,
    /// Idempotensnøgle. Sættes automatisk, hvis den mangler.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_entry_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timer_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_timer: Option<bool>,
    /// Klippekortet er valgt automatisk af desktop. Afviser web det (fx ikke
    /// nok timer, eller kortet er arkiveret, før en køet post blev sendt),
    /// gemmes posten uden kort i stedet for at gå tabt. Gemmes i køen, men
    /// sendes aldrig til web.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub prepaid_auto: bool,
    /// Brugeren har valgt "intet klippekort". Web's `noPrepaid: true`
    /// (feat/desktop-api-3): posten trækkes aldrig fra et kort, heller ikke
    /// et serveren ville vælge. Sendes kun uden `prepaidPackageId`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub no_prepaid: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TimeEntryPatch {
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub project_id: Option<Option<Id>>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub client_id: Option<Option<Id>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "rust_decimal::serde::float_option"
    )]
    pub hours: Option<Decimal>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "crate::serde_util::entry_date_option"
    )]
    pub date: Option<NaiveDate>,
    /// `Some(None)` gør posten til en post uden tidspunkt.
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub start_time: Option<Option<DateTime<Utc>>>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub end_time: Option<Option<DateTime<Utc>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_billable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub task_id: Option<Option<Id>>,
}

/// Svar fra oprettelse (web: `{...entry, prepaidDeduction, deduplicated}`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedEntry {
    pub entry: TimeEntry,
    pub prepaid_deduction: Option<PrepaidDeduction>,
    /// Samme `clientEntryId` var allerede gemt: ingen dublet.
    pub deduplicated: bool,
    /// Ligger i offline-køen og sendes, når der er forbindelse.
    pub queued: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct EntryFilter {
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub client_id: Option<Id>,
    pub project_id: Option<Id>,
    pub task_id: Option<Id>,
    pub is_billed: Option<bool>,
    /// Kun poster uden tidspunkt (`Some(true)`) eller kun med (`Some(false)`).
    pub untimed: Option<bool>,
}

impl EntryFilter {
    pub fn day(date: NaiveDate) -> Self {
        Self { start_date: Some(date), end_date: Some(date), ..Self::default() }
    }

    /// Mandag-søndag for ugen, `date` ligger i.
    pub fn week_of(date: NaiveDate) -> Self {
        use chrono::Datelike;
        let monday = date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
        Self {
            start_date: Some(monday),
            end_date: Some(monday + chrono::Duration::days(6)),
            ..Self::default()
        }
    }

    pub fn matches(&self, e: &TimeEntry) -> bool {
        self.start_date.is_none_or(|d| e.date >= d)
            && self.end_date.is_none_or(|d| e.date <= d)
            && self.client_id.as_ref().is_none_or(|c| e.client_id.as_ref() == Some(c))
            && self.project_id.as_ref().is_none_or(|p| e.project_id.as_ref() == Some(p))
            && self.task_id.as_ref().is_none_or(|t| e.task_id.as_ref() == Some(t))
            && self.is_billed.is_none_or(|b| e.is_billed.unwrap_or(false) == b)
            && self.untimed.is_none_or(|u| u != e.has_time_range())
    }
}

// ---------------------------------------------------------------- timer

/// Fælles timer (web: `timer_states`, én række pr. bruger). `version` bumpes
/// ved hver skrivning; klienten SKAL opdatere sin version fra hvert svar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TimerState {
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub is_running: bool,
    pub start_time: Option<DateTime<Utc>>,
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub elapsed_seconds: i64,
    /// Tid optjent før den nuværende kørsel (pauser).
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub base_seconds: i64,
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
    pub task_id: Option<Id>,
    pub description: String,
    pub project: Option<NamedRef>,
    pub client: Option<NamedRef>,
    pub version: i64,
    /// "stopping" midt i et stop.
    pub intent: Option<String>,
    pub session_id: Option<String>,
    pub prepaid_choice: Option<PrepaidChoice>,
}

impl TimerState {
    /// Er der noget at stoppe (kørende eller pauset)? En timer, der blev
    /// pauset inden for det første sekund, har 0 sekunder, men en levende
    /// session; den er stadig aktiv.
    pub fn is_active(&self) -> bool {
        self.is_running || self.base_seconds > 0 || self.session_id.is_some()
    }

    /// Kunden, tiden hører til: timerens egen eller projektets (web afgør
    /// klippekort mod `COALESCE(clientId, project.clientId)`).
    pub fn effective_client_id(&self) -> Option<Id> {
        self.client_id.clone().or_else(|| self.project.as_ref().and_then(|p| p.client_id.clone()))
    }

    pub fn elapsed_at(&self, now: DateTime<Utc>) -> i64 {
        let running = match (self.is_running, self.start_time) {
            (true, Some(start)) => (now - start).num_seconds().max(0),
            _ => 0,
        };
        self.base_seconds + running
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NamedRef {
    pub id: Id,
    pub name: String,
    /// Kun på timerens `project`: projektets kunde.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<Id>,
}

/// Klippekort-valg for den kørende timer (#422). `None` = automatisk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum PrepaidChoice {
    /// Intet klippekort.
    None,
    #[serde(rename_all = "camelCase")]
    Package { package_id: Id },
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct StartTimer {
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
    pub task_id: Option<Id>,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct StopTimer {
    /// Overskriv beskrivelsen på posten.
    pub description: Option<String>,
    /// Gem ikke en post (kassér tiden).
    pub discard: bool,
    /// Sekunder, der trækkes fra posten (idle-tid, brugeren ikke arbejdede).
    /// Posten beholder sin start og slutter tilsvarende tidligere; er der
    /// under ét minut tilbage, gemmes ingen post. Stop og kortning sker i
    /// ét skridt, så en kortning aldrig kan fejle efter et stop.
    pub subtract_secs: u64,
}

impl StopTimer {
    /// Sekunder, posten får, når timeren har kørt `elapsed` sekunder.
    pub fn kept_secs(&self, elapsed: i64) -> i64 {
        elapsed.saturating_sub(i64::try_from(self.subtract_secs).unwrap_or(i64::MAX))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StopOutcome {
    /// Posten, stoppet gemte (None ved kassering eller < 1 minut).
    pub entry: Option<CreatedEntry>,
    pub timer: TimerState,
}

// ---------------------------------------------------------------- opgaver

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    #[default]
    Backlog,
    Todo,
    InProgress,
    Done,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Backlog => "backlog",
            TaskStatus::Todo => "todo",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Done => "done",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "todo" => TaskStatus::Todo,
            "in_progress" => TaskStatus::InProgress,
            "done" => TaskStatus::Done,
            _ => TaskStatus::Backlog,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Task {
    pub id: Id,
    pub title: String,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
    /// Ukendte statusser (web: varchar) læses som backlog i stedet for at
    /// vælte hele listen.
    #[serde(deserialize_with = "crate::serde_util::task_status")]
    pub status: TaskStatus,
    pub status_id: Option<Id>,
    /// low, medium, high, urgent
    pub priority: Option<String>,
    pub deadline: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub parent_task_id: Option<Id>,
    pub position: Option<i32>,
    pub estimated_minutes: Option<i32>,
    /// Registreret tid på opgaven (web's `trackedMinutes`).
    pub tracked_minutes: Option<i64>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NewTask {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<Id>,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    /// Sendes som superjson-Date (web's `z.date()`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_minutes: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub description: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub project_id: Option<Option<Id>>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub client_id: Option<Option<Id>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub deadline: Option<Option<DateTime<Utc>>>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "crate::serde_util::double_option")]
    pub estimated_minutes: Option<Option<i32>>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct TaskFilter {
    pub status: Option<TaskStatus>,
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
}

/// En kolonne på tavlen (web's `task_statuses`, egne statusser). `category`
/// er `not_started`, `in_progress`, `done` eller `cancelled`; den mangler hos
/// en ældre server og er en streng, så en ny kategori ikke vælter listen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskLane {
    pub id: Id,
    pub name: String,
    /// `#RRGGBB`
    pub color: Option<String>,
    pub order: i32,
    pub is_archive: bool,
    pub category: Option<String>,
}

impl TaskLane {
    /// De fire faste kolonner, når der ikke er egne (lokal tilstand). Id'et
    /// er den gamle status, så `move_task` kan sætte den direkte.
    pub fn defaults() -> Vec<TaskLane> {
        [
            ("backlog", "Backlog", "#9ca3af", "not_started"),
            ("todo", "Todo", "#3b82f6", "not_started"),
            ("in_progress", "I gang", "#f59e0b", "in_progress"),
            ("done", "Afsluttet", "#10b981", "done"),
        ]
        .into_iter()
        .zip(0..)
        .map(|((id, name, color, category), order)| TaskLane {
            id: id.into(),
            name: name.into(),
            color: Some(color.into()),
            order,
            is_archive: category == "done",
            category: Some(category.into()),
        })
        .collect()
    }

    /// Den gamle status, en opgave får i kolonnen (web's
    /// `legacyStatusForLane`): standardkolonnerne beholder deres egen,
    /// "ikke startet" bevarer backlog eller todo, og annulleret er done.
    pub fn legacy_status(&self, current: TaskStatus) -> TaskStatus {
        let category = self.category.as_deref().unwrap_or("not_started");
        let by_name = match self.name.as_str() {
            "Backlog" => Some((TaskStatus::Backlog, "not_started")),
            "Todo" => Some((TaskStatus::Todo, "not_started")),
            "I gang" => Some((TaskStatus::InProgress, "in_progress")),
            "Afsluttet" => Some((TaskStatus::Done, "done")),
            _ => None,
        };
        if let Some((s, c)) = by_name
            && c == category
        {
            return s;
        }
        match category {
            "in_progress" => TaskStatus::InProgress,
            "done" | "cancelled" => TaskStatus::Done,
            _ if matches!(current, TaskStatus::Backlog | TaskStatus::Todo) => current,
            _ => TaskStatus::Todo,
        }
    }
}

/// Flyt en opgave til en kolonne (web's `tasks.move`). Kolonnens kategori
/// sætter `status` på serveren; `ordered_task_ids` er kolonnens kort i ny
/// rækkefølge (udeladt = positionerne bevares).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MoveTask {
    pub task_id: Id,
    pub status_id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ordered_task_ids: Option<Vec<Id>>,
}

// ---------------------------------------------------------------- fakturaer

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceStatus {
    #[default]
    Draft,
    Sent,
    Paid,
    Overdue,
    /// Slettet i web (vises ikke).
    Deleted,
    /// Ukendt status fra en nyere server.
    #[serde(other)]
    Other,
}

impl InvoiceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            InvoiceStatus::Draft => "draft",
            InvoiceStatus::Sent => "sent",
            InvoiceStatus::Paid => "paid",
            InvoiceStatus::Overdue => "overdue",
            InvoiceStatus::Deleted => "deleted",
            InvoiceStatus::Other => "other",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "draft" => InvoiceStatus::Draft,
            "sent" => InvoiceStatus::Sent,
            "paid" => InvoiceStatus::Paid,
            "overdue" => InvoiceStatus::Overdue,
            "deleted" => InvoiceStatus::Deleted,
            _ => InvoiceStatus::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Invoice {
    pub id: Id,
    pub invoice_number: String,
    pub client_id: Id,
    /// Beløb ekskl. moms.
    pub amount: Decimal,
    /// Nullable i web (standard "draft").
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub status: InvoiceStatus,
    /// invoice | credit_note
    pub kind: Option<String>,
    pub issue_date: Option<DateTime<Utc>>,
    pub due_date: Option<DateTime<Utc>>,
    pub paid_date: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    /// Fakturaens overskrift ("Webshop, oktober"). Kun lokal tilstand; web
    /// har ingen titel på fakturaer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// Subtotal, moms og total, som web's PDF viser dem
/// (`extension.invoices.totals`, web's `invoicePdfTotals`). Kun cloud. Web
/// sender strenge med to decimaler. Moms kun, når virksomheden er
/// momsregistreret (`show_vat`); ellers er `vat_amount` 0 og `total` =
/// `subtotal`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceTotals {
    pub subtotal: Decimal,
    /// Procent ("25.00"), også når der ingen moms er.
    pub vat_rate: Decimal,
    pub vat_amount: Decimal,
    pub total: Decimal,
    pub show_vat: bool,
    pub currency: String,
}

/// Afsender, betaling og nummerering på lokale fakturaer (lokal tilstand; i
/// cloud står det i web). Gemmes som JSON i `settings`-tabellen, så det
/// følger med en backup af `local.db`. Felterne svarer til 0.2's
/// Indstillinger → Fakturaopsætning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InvoiceProfile {
    pub company_name: String,
    pub cvr: String,
    /// Fri tekst; linjeskift deler adressen på PDF'en.
    pub address: String,
    pub email: String,
    pub phone: String,
    pub bank_reg: String,
    pub bank_account: String,
    pub mobilepay: String,
    pub payment_terms_days: u32,
    /// Foran nummeret ("2026-", "INV-"). Tom = kun tal.
    pub number_prefix: String,
    /// Mindste næste nummer. Ligger der et højere med samme præfiks, bruges det.
    pub next_number: u64,
}

impl Default for InvoiceProfile {
    fn default() -> Self {
        InvoiceProfile {
            company_name: String::new(),
            cvr: String::new(),
            address: String::new(),
            email: String::new(),
            phone: String::new(),
            bank_reg: String::new(),
            bank_account: String::new(),
            mobilepay: String::new(),
            payment_terms_days: 14,
            number_prefix: String::new(),
            next_number: 1,
        }
    }
}

impl InvoiceProfile {
    /// Felter, der mangler, før en faktura er gyldig efter momsloven:
    /// sælgers navn, CVR og adresse, og en måde at betale på.
    pub fn missing(&self) -> Vec<&'static str> {
        let mut out = vec![];
        if self.company_name.trim().is_empty() {
            out.push("firmanavn");
        }
        if self.cvr.trim().is_empty() {
            out.push("CVR");
        }
        if self.address.trim().is_empty() {
            out.push("adresse");
        }
        let bank = !self.bank_reg.trim().is_empty() && !self.bank_account.trim().is_empty();
        if !bank && self.mobilepay.trim().is_empty() {
            out.push("bankkonto eller MobilePay");
        }
        out
    }

    /// Formatkontrol af det udfyldte (tomme felter er tilladt). Teksten er dansk.
    pub fn validate(&self) -> std::result::Result<(), String> {
        let digits = |s: &str| s.chars().filter(|c| !c.is_whitespace()).all(|c| c.is_ascii_digit());
        let count = |s: &str| s.chars().filter(char::is_ascii_digit).count();
        let cvr = self.cvr.trim();
        if !cvr.is_empty() && !(digits(cvr) && count(cvr) == 8) {
            return Err("CVR skal være 8 cifre".into());
        }
        let reg = self.bank_reg.trim();
        if !reg.is_empty() && !(digits(reg) && count(reg) == 4) {
            return Err("Reg.nr. skal være 4 cifre".into());
        }
        let konto = self.bank_account.trim();
        if !konto.is_empty() && !(digits(konto) && (6..=10).contains(&count(konto))) {
            return Err("Kontonummeret skal være 6-10 cifre".into());
        }
        let mp = self.mobilepay.trim();
        if !mp.is_empty() && !(digits(mp) && (4..=8).contains(&count(mp))) {
            return Err("MobilePay-nummeret skal være 4-8 cifre".into());
        }
        if self.payment_terms_days > 365 {
            return Err("Betalingsfristen kan højst være 365 dage".into());
        }
        if self.next_number == 0 {
            return Err("Næste fakturanummer skal være mindst 1".into());
        }
        if self.number_prefix.chars().count() > 20 || self.number_prefix.chars().any(char::is_control) {
            return Err("Præfikset må højst være 20 tegn".into());
        }
        Ok(())
    }

    /// Næste nummer ud fra de udstedte numre: det største afsluttende tal
    /// med samme præfiks + 1, dog mindst `next_number`. Tallet får samme
    /// antal cifre som det seneste ("INV-009" → "INV-010", "2026-9" →
    /// "2026-10"). Returnerer nummeret og tallet.
    pub fn next_invoice_number<'a>(&self, issued: impl IntoIterator<Item = &'a str>) -> (String, u64) {
        let prefix = self.number_prefix.as_str();
        let mut best: Option<(u64, usize)> = None;
        for n in issued {
            let Some(rest) = n.strip_prefix(prefix) else { continue };
            if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            if let Ok(v) = rest.parse::<u64>()
                && best.is_none_or(|(b, _)| v > b)
            {
                best = Some((v, rest.len()));
            }
        }
        let (n, width) = match best {
            Some((v, w)) => (self.next_number.max(v.saturating_add(1)), w),
            None => (self.next_number, 0),
        };
        (format!("{prefix}{n:0width$}"), n)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct InvoiceLine {
    /// None = ny linje (saveLines).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Id>,
    pub description: String,
    #[serde(with = "crate::serde_util::decimal_string")]
    pub quantity: Decimal,
    #[serde(with = "crate::serde_util::decimal_string")]
    pub unit_price: Decimal,
    #[serde(with = "crate::serde_util::decimal_string")]
    pub amount: Decimal,
    pub time_entry_id: Option<Id>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct NewInvoiceDraft {
    pub client_id: Id,
    /// Ufakturerede poster, der skal på kladden.
    pub time_entry_ids: Vec<Id>,
    pub notes: Option<String>,
    pub due_date: Option<NaiveDate>,
}

/// Ufaktureret tid for én kunde.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UninvoicedSummary {
    pub client_id: Id,
    pub client_name: String,
    pub hours: Decimal,
    pub amount: Decimal,
    pub entry_count: i64,
}

// ---------------------------------------------------------------- rapporter

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ReportGrouping {
    #[default]
    Client,
    Project,
    Day,
    Week,
    Month,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ReportQuery {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub grouping: ReportGrouping,
    pub client_id: Option<Id>,
    pub project_id: Option<Id>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReportRow {
    pub key: String,
    pub label: String,
    pub hours: Decimal,
    pub billable_hours: Decimal,
    pub amount: Decimal,
    pub entry_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub grouping: ReportGrouping,
    pub rows: Vec<ReportRow>,
    pub total_hours: Decimal,
    pub billable_hours: Decimal,
    pub total_amount: Decimal,
}

// ---------------------------------------------------------------- regler

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "camelCase")]
pub enum RuleKind {
    /// Projektets `urlPatterns` (wildcard som udvidelsen).
    UrlPattern,
    Domain,
    /// Git-remote-URL eller sti.
    Repo,
    App,
    /// App + nøgleord i titlen.
    AppKeyword,
    TitleTemplate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleSource {
    /// Afledt af et projekts `urlPatterns` i web (kun læsning her).
    Project,
    /// Oprettet af brugeren.
    User,
    /// Lært af bekræftelser og rettelser.
    Learned,
}

/// Matching-regel. Indeholder kun bekræftede mønstre, aldrig rå aktivitet
/// (D3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchingRule {
    pub id: Id,
    pub kind: RuleKind,
    pub pattern: String,
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
    pub source: RuleSource,
    /// Antal bekræftelser (lærte mønstre).
    #[serde(default)]
    pub confirmations: i64,
    /// `true` = mønsteret er bevidst "ikke arbejde".
    #[serde(default)]
    pub not_work: bool,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Udvidelsens site-kobling (domæne → projekt/kunde), som web giver den i
/// `extension.siteMappings.list` (domæne-reglerne uden "ikke arbejde").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SiteMapping {
    pub domain: String,
    pub project_id: Option<Id>,
    pub client_id: Option<Id>,
    pub usage_count: i64,
    pub last_used: Option<DateTime<Utc>>,
}

/// Et lært mønster, som web gemmer det (`extension.patterns.*`). `key` og
/// `votes` er tt-matchers `LearnedPattern` som JSON, uændret: tt-data
/// kender ikke tt-matcher, og web gemmer det, klienten sender. Tomme
/// `votes` rydder mønsteret.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LearnedPatternRecord {
    pub key: serde_json::Value,
    pub votes: serde_json::Value,
    /// Kun i svar fra web.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

/// Svar fra `extension.patterns.list`. `server_time` sendes som `since`
/// næste gang (kun ændrede mønstre).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LearnedPatterns {
    pub server_time: Option<DateTime<Utc>>,
    pub patterns: Vec<LearnedPatternRecord>,
}

// ---------------------------------------------------------------- entitlements

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Plan {
    /// free, solo, business … (web's `planTier`)
    pub tier: Option<String>,
    pub name: Option<String>,
    pub status: Option<String>,
    pub is_free: bool,
    pub is_trial: bool,
    pub trial_ends_at: Option<DateTime<Utc>>,
    pub is_trial_expired: bool,
    pub member_locked: bool,
}

/// Kan brugeren skrive i området lige nu (plan + modul + rolle)?
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Features {
    pub time_tracking: bool,
    pub clients: bool,
    pub can_add_active_client: bool,
    pub projects: bool,
    pub tasks: bool,
    pub invoices: bool,
    pub klippekort: bool,
    pub reports: bool,
}

impl Features {
    pub fn all() -> Self {
        Features {
            time_tracking: true,
            clients: true,
            can_add_active_client: true,
            projects: true,
            tasks: true,
            invoices: true,
            klippekort: true,
            reports: true,
        }
    }
}

/// Svar fra `extension.entitlements.get`. Kun visning: serveren håndhæver.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Entitlements {
    pub organization_id: Option<Id>,
    pub role: Option<String>,
    pub plan: Option<Plan>,
    /// Planens grænser (fx `maxActiveClients`), uændret fra web.
    pub limits: Option<serde_json::Value>,
    pub usage: Option<serde_json::Value>,
    pub features: Features,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_domains_are_normalized_like_web() {
        let v = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(
            normalize_client_domains(&v(&["https://www.Bageriet.DK/kontakt", "@bageriet.dk", "bageriet.dk.", " ", "shop.bageriet.dk"])),
            Ok(v(&["bageriet.dk", "shop.bageriet.dk"]))
        );
        for bad in ["localhost", "bageriet", "-x.dk", "x.d1", "bøger.dk", "ftp://x.dk", "x.dk:8080"] {
            assert!(normalize_client_domains(&v(&[bad])).is_err(), "{bad}");
        }
        assert!(normalize_client_domains(&vec!["a.dk".to_string(); 51]).is_err());
    }
}
