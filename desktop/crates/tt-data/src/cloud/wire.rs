//! Web's input-former, hvor de afviger fra desktop's model.
//!
//! `clients.update` og `projects.update` i web erstatter HELE rækken: felter,
//! der mangler i `data`, bliver sat til NULL (projektets `status` til
//! "active"), og `name` er påkrævet. Desktop's patches er delvise, så de
//! lægges oven på den nuværende række, og hele rækken sendes.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::model::*;
use crate::serde_util::money_string;

fn put(m: &mut Map<String, Value>, key: &str, v: Option<Value>) {
    if let Some(v) = v {
        m.insert(key.into(), v);
    }
}

fn s(v: &Option<String>) -> Option<Value> {
    v.as_ref().map(|x| json!(x))
}

/// "#RRGGBB" som web's zod-regex (`/^#[0-9a-fA-F]{6}$/`).
fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// `data` til `extension.clients.update` (web's fulde `clientInput`).
pub fn client_update_data(cur: &Client, p: &ClientPatch) -> Value {
    let pick = |patch: &Option<String>, cur: &Option<String>| s(if patch.is_some() { patch } else { cur });
    let mut m = Map::new();
    m.insert("name".into(), json!(p.name.as_ref().unwrap_or(&cur.name)));
    put(&mut m, "email", pick(&p.email, &cur.email));
    put(&mut m, "phone", pick(&p.phone, &cur.phone));
    put(&mut m, "company", pick(&p.company, &cur.company));
    put(&mut m, "address", s(&cur.address));
    put(&mut m, "city", s(&cur.city));
    put(&mut m, "postalCode", s(&cur.postal_code));
    put(&mut m, "country", s(&cur.country));
    put(&mut m, "cvrNumber", pick(&p.cvr_number, &cur.cvr_number));
    put(&mut m, "notes", pick(&p.notes, &cur.notes));
    // Udeladt = ryddet i web (`|| null`): så fjernes satsen.
    let rate = p.default_hourly_rate.unwrap_or(cur.default_hourly_rate);
    put(&mut m, "defaultHourlyRate", rate.map(|d| json!(money_string(d))));
    // Web's regex afviser alt andet end "#RRGGBB" (også ""), og `null` er
    // "uændret" i web's update. En tom farve kan derfor ikke sendes: den
    // udelades, og web beholder sin farve (TODO(web): `color: null` = fjern).
    let color = p.color.as_ref().or(cur.color.as_ref()).filter(|c| is_hex_color(c));
    put(&mut m, "color", color.map(|c| json!(c)));
    // Undtagelsen fra fuld erstatning: udeladte domæner er uændrede i web.
    put(&mut m, "domains", p.domains.as_ref().map(|d| json!(d)));
    Value::Object(m)
}

/// `data` til `extension.entries.update` (web's `time.update`, også fuld
/// erstatning): `description`, `hours` og `date` er påkrævede, og
/// `projectId`/`clientId`/`taskId`, der mangler, ryddes. Felterne er ikke
/// nullable, så en tom værdi sendes ved at udelade den (`notes` med "").
/// `startTime`/`endTime` er undtagelsen: udeladt = uændret, `null` = fjern
/// tidspunktet. Null sendes kun, når rettelsen selv fjerner det
/// (`clear_times`), så en post fra en forældet cache aldrig rydder et
/// tidspunkt, serveren har.
///
/// `keep_rate`: send postens egen timepris med. Uden den regner web prisen
/// om fra projekt/kunde, så en rettet beskrivelse ville ændre en særpris.
pub fn entry_update_data(e: &TimeEntry, keep_rate: bool, clear_times: bool) -> Value {
    let mut m = Map::new();
    let description = e.description.as_deref().map(str::trim).filter(|d| !d.is_empty()).unwrap_or("Uden beskrivelse");
    m.insert("description".into(), json!(description));
    m.insert("hours".into(), json!(e.hours.round_dp(2).to_string().parse::<f64>().unwrap_or(0.0)));
    m.insert("date".into(), json!(e.date.format("%Y-%m-%d").to_string()));
    put(&mut m, "projectId", s(&e.project_id));
    put(&mut m, "clientId", s(&e.client_id));
    put(&mut m, "taskId", s(&e.task_id));
    m.insert("notes".into(), json!(e.notes.as_deref().unwrap_or("")));
    for (key, t) in [("startTime", e.start_time), ("endTime", e.end_time)] {
        match t {
            Some(t) => {
                m.insert(key.into(), json!(t.to_rfc3339()));
            }
            None if clear_times => {
                m.insert(key.into(), Value::Null);
            }
            None => {}
        }
    }
    put(&mut m, "isBillable", e.is_billable.map(|b| json!(b)));
    if keep_rate {
        put(&mut m, "billableRate", e.billable_rate.map(|d| json!(money_string(d))));
    }
    Value::Object(m)
}

/// `data` til `extension.projects.update` (web's fulde `projectInput`).
pub fn project_update_data(cur: &Project, p: &ProjectPatch) -> Value {
    let money = |d: Option<rust_decimal::Decimal>| d.map(|d| json!(money_string(d)));
    let mut m = Map::new();
    m.insert("name".into(), json!(p.name.as_ref().unwrap_or(&cur.name)));
    let client_id = match &p.client_id {
        Some(c) => c.clone(),
        None => cur.client_id.clone(),
    };
    m.insert("clientId".into(), json!(client_id));
    put(&mut m, "description", s(if p.description.is_some() { &p.description } else { &cur.description }));
    put(&mut m, "hourlyRate", money(p.hourly_rate.unwrap_or(cur.hourly_rate)));
    put(&mut m, "fixedPrice", money(cur.fixed_price));
    put(&mut m, "monthlyBudgetHours", money(cur.monthly_budget_hours));
    put(&mut m, "budgetHours", money(p.budget_hours.unwrap_or(cur.budget_hours)));
    m.insert("status".into(), json!(cur.status.as_str()));
    put(&mut m, "startDate", cur.start_date.map(|d| json!(d.to_rfc3339())));
    put(&mut m, "endDate", cur.end_date.map(|d| json!(d.to_rfc3339())));
    m.insert("urlPatterns".into(), json!(p.url_patterns.as_ref().unwrap_or(&cur.url_patterns)));
    put(&mut m, "roundingEnabled", cur.rounding_enabled.map(|x| json!(x)));
    put(&mut m, "roundingMinutes", cur.rounding_minutes.map(|x| json!(x)));
    put(&mut m, "roundingMethod", s(&cur.rounding_method));
    Value::Object(m)
}

/// `data` til `extension.klippekort.update` (web's fulde
/// `prepaidPackageInput`). `name`, `clientId`, `totalHours`, `hourlyRate` og
/// `purchaseDate` er påkrævede; `expiryDate`, `description` og
/// `clipSizeMinutes`, der mangler, ryddes. `overdraftPolicy` og
/// `autoDeduct` er uændrede, når de udelades, og `overdraftRate` sendes aldrig
/// (desktop retter den ikke). Saldoen regner web selv om.
pub fn prepaid_update_data(cur: &PrepaidPackage, p: &PrepaidPackagePatch) -> Value {
    let num = |d: rust_decimal::Decimal| json!(d.round_dp(2).to_string().parse::<f64>().unwrap_or(0.0));
    let day = |d: DateTime<Utc>| d.format("%Y-%m-%d").to_string();
    let mut m = Map::new();
    m.insert("name".into(), json!(p.name.as_ref().unwrap_or(&cur.name)));
    m.insert("clientId".into(), json!(p.client_id.as_ref().unwrap_or(&cur.client_id)));
    m.insert("totalHours".into(), num(p.total_hours.unwrap_or(cur.total_hours)));
    m.insert("hourlyRate".into(), num(p.hourly_rate.unwrap_or(cur.hourly_rate)));
    // Påkrævet i web; kalderen afviser rettelsen, hvis den mangler begge steder.
    let purchase = p.purchase_date.clone().or_else(|| cur.purchase_date.map(day));
    put(&mut m, "purchaseDate", purchase.map(|d| json!(d)));
    let expiry = match &p.expiry_date {
        Some(v) => v.clone(),
        None => cur.expiry_date.map(day),
    };
    put(&mut m, "expiryDate", expiry.map(|d| json!(d)));
    let description = match &p.description {
        Some(v) => v.clone(),
        None => cur.description.clone(),
    };
    put(&mut m, "description", description.filter(|d| !d.trim().is_empty()).map(|d| json!(d)));
    let clip = p.clip_size_minutes.unwrap_or(cur.clip_size_minutes);
    put(&mut m, "clipSizeMinutes", clip.filter(|c| *c > 0).map(|c| json!(c)));
    put(&mut m, "overdraftPolicy", s(&p.overdraft_policy));
    put(&mut m, "autoDeduct", p.auto_deduct.map(|b| json!(b)));
    Value::Object(m)
}

// ---------------------------------------------------------------- regler

/// Svar fra `extension.rules.getMatchingRules({ since? })`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchingRulesResponse {
    pub server_time: Option<String>,
    pub project_patterns: Vec<ProjectPatterns>,
    pub rules: Vec<WebRule>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectPatterns {
    pub project_id: String,
    pub project_name: String,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    #[serde(deserialize_with = "crate::serde_util::null_as_default")]
    pub patterns: Vec<String>,
}

/// En række i web's `device_match_rules`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WebRule {
    pub id: String,
    /// domain | url | repo | app | title
    pub kind: String,
    pub pattern: String,
    pub project_id: Option<String>,
    pub client_id: Option<String>,
    /// "Ikke arbejde": aktiviteten foreslås aldrig (uden projekt og kunde).
    pub not_work: bool,
    /// extension | desktop | mobile
    pub source: Option<String>,
    pub usage_count: i64,
    pub last_used_at: Option<DateTime<Utc>>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Desktop's regeltype → web's `kind`. Web har kun én titel-type, så
/// "nøgleord i app" og titel-skabeloner gemmes begge som `title`.
pub fn rule_kind_to_web(k: RuleKind) -> &'static str {
    match k {
        RuleKind::UrlPattern => "url",
        RuleKind::Domain => "domain",
        RuleKind::Repo => "repo",
        RuleKind::App => "app",
        RuleKind::AppKeyword | RuleKind::TitleTemplate => "title",
    }
}

pub fn rule_kind_from_web(k: &str) -> Option<RuleKind> {
    Some(match k {
        "url" => RuleKind::UrlPattern,
        "domain" => RuleKind::Domain,
        "repo" => RuleKind::Repo,
        "app" => RuleKind::App,
        "title" => RuleKind::TitleTemplate,
        _ => return None,
    })
}

impl WebRule {
    /// None for ukendte typer og fjernede regler.
    pub fn into_rule(self) -> Option<MatchingRule> {
        if self.deleted_at.is_some() {
            return None;
        }
        Some(MatchingRule {
            id: self.id,
            kind: rule_kind_from_web(&self.kind)?,
            pattern: self.pattern,
            project_id: self.project_id,
            client_id: self.client_id,
            source: RuleSource::Learned,
            confirmations: self.usage_count,
            not_work: self.not_work,
            updated_at: self.updated_at,
        })
    }
}

impl MatchingRulesResponse {
    /// Projekternes `urlPatterns` og brugerens regler som én liste.
    pub fn into_rules(self) -> Vec<MatchingRule> {
        let mut rules = Vec::new();
        for p in self.project_patterns {
            for (n, pattern) in p.patterns.into_iter().enumerate() {
                rules.push(MatchingRule {
                    id: format!("project:{}:{n}", p.project_id),
                    kind: RuleKind::UrlPattern,
                    pattern,
                    project_id: Some(p.project_id.clone()),
                    client_id: p.client_id.clone(),
                    source: RuleSource::Project,
                    confirmations: 0,
                    not_work: false,
                    updated_at: None,
                });
            }
        }
        rules.extend(self.rules.into_iter().filter_map(WebRule::into_rule));
        rules
    }
}

/// Én regel i `extension.rules.upsert({ rules: [...] })`. En "ikke
/// arbejde"-regel sendes som `notWork: true` uden mål (web afviser begge).
pub fn rule_upsert_item(r: &MatchingRule) -> Value {
    let mut m = Map::new();
    m.insert("kind".into(), json!(rule_kind_to_web(r.kind)));
    m.insert("pattern".into(), json!(r.pattern));
    if r.not_work {
        m.insert("notWork".into(), json!(true));
    } else {
        put(&mut m, "projectId", s(&r.project_id));
        put(&mut m, "clientId", s(&r.client_id));
    }
    m.insert("source".into(), json!("desktop"));
    m.insert("usageCount".into(), json!(r.confirmations.max(0)));
    put(&mut m, "lastUsedAt", r.updated_at.map(|t| json!(t.to_rfc3339())));
    Value::Object(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kundens_farve_sendes_kun_som_gyldig_hex() {
        let cur = Client { name: "Bageriet".into(), color: Some("#10b981".into()), ..Client::default() };
        // Ny farve.
        let p = ClientPatch { color: Some("#3B82F6".into()), ..ClientPatch::default() };
        assert_eq!(client_update_data(&cur, &p)["color"], json!("#3B82F6"));
        // Uændret: den nuværende sendes med (web erstatter hele kunden).
        assert_eq!(client_update_data(&cur, &ClientPatch::default())["color"], json!("#10b981"));
        // Tom eller ugyldig: udelades, så web's regex ikke afviser hele rettelsen.
        let p = ClientPatch { color: Some(String::new()), ..ClientPatch::default() };
        assert!(client_update_data(&cur, &p).get("color").is_none());
        let p = ClientPatch { color: Some("blå".into()), ..ClientPatch::default() };
        assert!(client_update_data(&cur, &p).get("color").is_none());
    }

    #[test]
    fn domaener_telefon_og_noter_kommer_med() {
        let cur = Client { name: "Bageriet".into(), phone: Some("12345678".into()), ..Client::default() };
        let p = ClientPatch {
            notes: Some("Ring før kl. 10".into()),
            domains: Some(vec!["bageriet.dk".into()]),
            ..ClientPatch::default()
        };
        let d = client_update_data(&cur, &p);
        assert_eq!(d["phone"], json!("12345678"));
        assert_eq!(d["notes"], json!("Ring før kl. 10"));
        assert_eq!(d["domains"], json!(["bageriet.dk"]));
    }
}
