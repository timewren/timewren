//! `CloudRepo`: cloud-tilstand, hvor web er sandheden (spec D5, B6-B8).
//!
//! - tRPC mod `extension.*` (samme API som browserudvidelsen, D9).
//! - Token-auth med refresh; UNAUTHORIZED ⇒ `Event::LoggedOut`.
//! - Live-strøm (`/api/ext/stream`) med genforbindelse; en hændelse gør
//!   cachen stale og sendes videre som `Event`.
//! - SQLite-cache med offline-fallback og offline-kø med single-flight og
//!   idempotens (`clientEntryId`).

pub mod auth;
pub mod cache;
pub mod dead_letter;
pub mod http;
pub mod queue;
pub mod sse;
pub mod wire;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use parking_lot::Mutex;
use rust_decimal::Decimal;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::error::{DataError, Result};
use crate::events::{Entity, Event, Events, LogoutReason};
use crate::local::Clock;
use crate::model::*;
use crate::repo::Repository;
use crate::report::{Names, build_report};
use crate::core_rules::CoreRules;
use crate::rules::BusinessRules;

use auth::{Credentials, PendingLogin, SecretStore, TokenResponse};
use cache::Cache;
use http::{Api, Kind, REQUEST_TIMEOUT, SAVE_TIMEOUT};
use queue::{CreateKind, Op, QueuedOp, overlay_entries, overlay_tasks, provisional_entry};
use sse::{Opened, RealtimeConfig, RealtimeHost, StreamSignal};

/// Så længe et cachet svar bruges uden ny hentning, når strømmen er nede
/// (polling-fallback: ændringer ses inden for 60 s).
const CACHE_TTL: chrono::Duration = chrono::Duration::seconds(60);
/// Import af en hel lokal database kan tage tid på serveren.
const IMPORT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone)]
pub struct CloudConfig {
    /// Fx `https://timetrack.dk`.
    pub base_url: String,
    pub device: DeviceInfo,
    /// Cache-databasen. None = i hukommelsen (tests).
    pub cache_path: Option<PathBuf>,
    pub realtime: RealtimeConfig,
    /// Læg oprettelse af kunder, projekter, opgaver og klippekort i
    /// offline-køen med en gemt idempotensnøgle (standard: til). Web's
    /// create-procedurer tager `idempotencyKey` (samme nøgle inden for 24
    /// timer = samme række), så et nyt forsøg efter et tabt svar giver ingen
    /// dublet. En create i køen giver `Offline` til kalderen. Trykker brugeren
    /// "Opret" igen med samme indhold, lægges der ikke en ny i køen (se
    /// `CloudInner::create`). Ventende creates vises endnu ikke i listerne.
    /// `false` = oprettelse kræver forbindelse og sendes én gang.
    pub queue_creates: bool,
}

impl CloudConfig {
    pub fn new(base_url: impl Into<String>, device: DeviceInfo) -> Self {
        CloudConfig {
            base_url: base_url.into(),
            device,
            cache_path: None,
            realtime: RealtimeConfig::default(),
            queue_creates: true,
        }
    }
}

struct CloudInner {
    api: Api,
    cfg: CloudConfig,
    store: Arc<dyn SecretStore>,
    creds: Mutex<Option<Credentials>>,
    pending_login: Mutex<Option<PendingLogin>>,
    refresh_lock: Mutex<()>,
    flush_lock: Mutex<()>,
    cache: Cache,
    events: Events,
    online: AtomicBool,
    realtime_connected: AtomicBool,
    realtime_stop: Mutex<Option<Arc<AtomicBool>>>,
    rules: Arc<dyn BusinessRules>,
    clock: Clock,
    self_ref: Mutex<Weak<CloudInner>>,
}

#[derive(Clone)]
pub struct CloudRepo {
    inner: Arc<CloudInner>,
}

/// Token og org i input, som udvidelsen. `org` overstyrer den valgte org
/// (køede handlinger sendes til den org, de blev lavet i).
fn with_auth(mut input: Value, creds: &Credentials, org: Option<&Option<String>>) -> Value {
    if !input.is_object() {
        input = json!({});
    }
    input["token"] = json!(creds.access_token);
    if let Some(org) = org.unwrap_or(&creds.organization_id) {
        input["organizationId"] = json!(org);
    }
    input
}

fn decode<T: DeserializeOwned>(v: Value) -> Result<T> {
    serde_json::from_value(v).map_err(|e| DataError::InvalidResponse(e.to_string()))
}

impl CloudRepo {
    pub fn new(cfg: CloudConfig, store: Arc<dyn SecretStore>) -> Result<Self> {
        let cache = Cache::open(cfg.cache_path.as_deref())?;
        let creds = store.load();
        let inner = Arc::new(CloudInner {
            api: Api::new(&cfg.base_url, &cfg.device.app_version),
            cfg,
            store,
            creds: Mutex::new(creds),
            pending_login: Mutex::new(None),
            refresh_lock: Mutex::new(()),
            flush_lock: Mutex::new(()),
            cache,
            events: Events::new(),
            online: AtomicBool::new(true),
            realtime_connected: AtomicBool::new(false),
            realtime_stop: Mutex::new(None),
            rules: Arc::new(CoreRules),
            clock: Arc::new(Utc::now),
            self_ref: Mutex::new(Weak::new()),
        });
        *inner.self_ref.lock() = Arc::downgrade(&inner);
        Ok(CloudRepo { inner })
    }

    /// Forretningsregler (auto-valg af klippekort ved stop) og ur (tests).
    pub fn with_rules_and_clock(self, rules: Arc<dyn BusinessRules>, clock: Clock) -> Self {
        let inner = Arc::try_unwrap(self.inner)
            .unwrap_or_else(|_| panic!("with_rules_and_clock skal kaldes før repo'et deles"));
        let inner = Arc::new(CloudInner { rules, clock, self_ref: Mutex::new(Weak::new()), ..inner });
        *inner.self_ref.lock() = Arc::downgrade(&inner);
        CloudRepo { inner }
    }

    pub fn is_logged_in(&self) -> bool {
        self.inner.creds.lock().is_some()
    }

    pub fn is_online(&self) -> bool {
        self.inner.online.load(Ordering::SeqCst)
    }

    pub fn pending_count(&self) -> usize {
        self.inner.cache.pending_count()
    }

    // ------------------------------------------------- afviste (dead-letter)
    //
    // Gælder den indloggede bruger; logget ud den, der sidst brugte køen
    // (så de afviste kan ses og eksporteres efter logud). Se `dead_letter.rs`.

    /// Antal afviste registreringer.
    pub fn dead_letter_count(&self) -> usize {
        self.inner.dead_letter_user().map_or(0, |u| self.inner.cache.dead_letter_count(&u))
    }

    /// De afviste registreringer, ældste først.
    pub fn dead_letters(&self) -> Result<Vec<dead_letter::DeadLetter>> {
        self.inner.dead_letters()
    }

    /// Send én (`Some(op_id)`) eller alle afviste igen, med samme `op_id`,
    /// `clientEntryId` og idempotensnøgle. Kræver login.
    pub async fn retry_dead_letters(&self, op_id: Option<&str>) -> Result<dead_letter::RetryOutcome> {
        let op_id = op_id.map(str::to_owned);
        self.run(move |i| i.retry_dead_letters(op_id.as_deref())).await
    }

    /// Kassér én afvist registrering for altid. Det eneste, der sletter.
    pub fn discard_dead_letter(&self, op_id: &str) -> Result<()> {
        let user = self.inner.dead_letter_user().ok_or(DataError::Unauthorized)?;
        if !self.inner.cache.discard_dead_letter(&user, op_id)? {
            return Err(DataError::NotFound);
        }
        self.inner.dead_letters_changed();
        Ok(())
    }

    /// CSV i samme format som migreringens `ikke-synkroniseret-fra-0.2.csv`.
    /// Kun tidsposter (nye og rettede); andre handlinger udelades.
    pub fn dead_letters_csv(&self) -> Result<String> {
        Ok(dead_letter::csv(&self.inner.dead_letters()?))
    }

    /// Det cachede `entitlements.get`-svar og tidspunktet, det blev hentet.
    /// Bruges til at frø appens offline-respit, når den egen cache mangler.
    pub fn cached_entitlements(&self) -> Option<(Entitlements, chrono::DateTime<Utc>)> {
        let c = self.inner.cache.get("entitlements")?;
        Some((serde_json::from_value(c.value).ok()?, c.fetched_at))
    }

    /// Trin 1 af login: URL'en, appen åbner i browseren.
    pub fn begin_login(&self) -> String {
        let p = PendingLogin::new((self.inner.clock)());
        let url = p.authorize_url(&self.inner.cfg.base_url, &self.inner.cfg.device);
        *self.inner.pending_login.lock() = Some(p);
        url
    }

    /// Trin 2: deep linket `timetrack://auth/callback?code=…&state=…`.
    pub async fn complete_login(&self, callback_url: &str) -> Result<Session> {
        let url = callback_url.to_owned();
        self.run(move |i| i.complete_login(&url)).await
    }

    /// Log ind med et eksisterende extension-token (fra web's
    /// indstillinger). Tokenet valideres med `extension.validateToken`.
    pub async fn login_with_token(&self, token: &str) -> Result<Session> {
        let token = token.to_owned();
        self.run(move |i| i.login_with_token(&token)).await
    }

    #[cfg(feature = "mock")]
    #[doc(hidden)]
    pub fn debug_access_token(&self) -> Option<String> {
        self.inner.creds.lock().as_ref().map(|c| c.access_token.clone())
    }

    #[cfg(feature = "mock")]
    #[doc(hidden)]
    pub fn debug_sign_in(&self, creds: Credentials) {
        self.inner.signed_in(creds).expect("login");
    }

    /// Start live-strømmen i sin egen tråd (idempotent).
    pub fn start_realtime(&self) {
        self.inner.start_realtime();
    }

    pub fn stop_realtime(&self) {
        self.inner.stop_realtime();
    }

    /// Send køen nu (fx når appen vågner). Returnerer antal, der venter.
    pub async fn sync_now(&self) -> Result<usize> {
        self.run(|i| {
            i.flush(None)?;
            Ok(i.cache.pending_count())
        })
        .await
    }

    /// `extension.import.run` (se `import.rs`).
    pub(crate) async fn import_call(&self, body: Value) -> Result<crate::import::ServerImportResult> {
        self.run(move |i| {
            let dry = body["dryRun"].as_bool().unwrap_or(true);
            // Opgavers `deadline` er `z.date()` i web: superjson-Date.
            let n = body["tasks"].as_array().map_or(0, Vec::len);
            let paths: Vec<String> = (0..n).map(|k| format!("tasks.{k}.data.deadline")).collect();
            let dates: Vec<&str> = paths.iter().map(String::as_str).collect();
            let v = i.call(Kind::Mutation, "extension.import.run", body, &dates, IMPORT_TIMEOUT)?;
            if !dry {
                i.changed(&Entity::ALL);
            }
            decode(v)
        })
        .await
    }

    async fn run<T, F>(&self, f: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&CloudInner) -> Result<T> + Send + 'static,
    {
        let inner = self.inner.clone();
        blocking::unblock(move || f(&inner)).await
    }
}

// --------------------------------------------------------------- wire-typer

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateResponse {
    valid: bool,
    user: Option<User>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntriesPage {
    entries: Vec<TimeEntry>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatedWire {
    #[serde(flatten)]
    entry: TimeEntry,
    #[serde(default)]
    prepaid_deduction: Option<PrepaidDeduction>,
    #[serde(default)]
    deduplicated: bool,
}

/// `extension.getPrepaidPackages` (tal i stedet for decimal-strenge).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtPackage {
    id: String,
    client_id: String,
    name: String,
    total_hours: Decimal,
    used_hours: Decimal,
    remaining_hours: Decimal,
    #[serde(default)]
    expires_at: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    purchased_at: Option<chrono::DateTime<Utc>>,
    #[serde(default = "yes")]
    auto_deduct: bool,
    #[serde(default)]
    clip_size_minutes: Option<i32>,
}

fn yes() -> bool {
    true
}

impl From<ExtPackage> for PrepaidPackage {
    fn from(p: ExtPackage) -> Self {
        PrepaidPackage {
            id: p.id,
            client_id: p.client_id,
            name: p.name,
            total_hours: p.total_hours,
            used_hours: p.used_hours,
            remaining_hours: p.remaining_hours,
            expiry_date: p.expires_at,
            purchase_date: p.purchased_at,
            is_active: true,
            is_archived: Some(false),
            auto_deduct: p.auto_deduct,
            clip_size_minutes: p.clip_size_minutes,
            ..PrepaidPackage::default()
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UninvoicedWire {
    client: NamedRef,
    #[serde(default)]
    entry_count: i64,
    #[serde(default)]
    total_hours: Decimal,
    #[serde(default)]
    total_amount: Decimal,
}

/// `extension.invoices.createDraft` (web's generateFromTimeEntries):
/// `{ invoice, lineItems, totalAmount, lines }`. `lines` er kladdens
/// `invoice_lines` (én pr. post); ved et gentaget kald med samme nøgle er
/// `lineItems` tom, men `lines` frisk.
#[derive(Deserialize)]
struct DraftWire {
    invoice: Invoice,
    #[serde(default)]
    lines: Option<Vec<InvoiceLine>>,
}

/// Cache-nøglen for én fakturas linjer.
fn lines_key(invoice_id: &str) -> String {
    format!("invoice_lines:{invoice_id}")
}

/// Nye forsøg på `createDraft` med samme nøgle (efter et usikkert svar)
/// og ventetiden før det andet, der fordobles.
const DRAFT_RETRIES: u32 = 4;
const DRAFT_BACKOFF: Duration = Duration::from_millis(400);

/// Web's `invoices.linesByInvoice` tager højst 500 id'er pr. kald.
const LINES_BATCH: usize = 500;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ClaimSession {
    project_id: Option<String>,
    client_id: Option<String>,
    task_id: Option<String>,
    description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimResponse {
    success: bool,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    version: Option<i64>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    prepaid_choice: Option<PrepaidChoice>,
    #[serde(default)]
    session: Option<ClaimSession>,
}

// --------------------------------------------------------------- kernen

impl CloudInner {
    fn now(&self) -> chrono::DateTime<Utc> {
        (self.clock)()
    }

    fn creds(&self) -> Result<Credentials> {
        self.creds.lock().clone().ok_or(DataError::Unauthorized)
    }

    fn set_online(&self, online: bool) {
        let was = self.online.swap(online, Ordering::SeqCst);
        if was != online {
            self.events.emit(if online { Event::Online } else { Event::Offline });
            if online {
                self.trigger_flush();
            }
        }
    }

    fn note<T>(&self, r: &Result<T>) {
        match r {
            Ok(_) => self.set_online(true),
            Err(DataError::Offline) => self.set_online(false),
            Err(_) => {}
        }
    }

    /// Et autentificeret kald. Ved UNAUTHORIZED fornyes tokenet én gang;
    /// lykkes det ikke, logges der ud.
    fn call(&self, kind: Kind, procedure: &str, input: Value, dates: &[&str], timeout: Duration) -> Result<Value> {
        self.call_in(kind, procedure, input, dates, timeout, None)
    }

    fn call_in(
        &self,
        kind: Kind,
        procedure: &str,
        input: Value,
        dates: &[&str],
        timeout: Duration,
        org: Option<&Option<String>>,
    ) -> Result<Value> {
        let mut creds = self.creds()?;
        if creds.needs_refresh(self.now()) {
            match self.refresh_if_same(&creds.access_token) {
                Ok(c) => creds = c,
                Err(e) if e.is_transient() => {}
                Err(e) => return Err(e),
            }
        }
        let r = self.api.call(kind, procedure, with_auth(input.clone(), &creds, org), dates, timeout);
        self.note(&r);
        match r {
            Err(DataError::Unauthorized) if creds.refresh_token.is_some() => {
                let fresh = self.refresh_if_same(&creds.access_token)?;
                let r = self.api.call(kind, procedure, with_auth(input, &fresh, org), dates, timeout);
                self.note(&r);
                if matches!(r, Err(DataError::Unauthorized)) {
                    self.logged_out_if(&fresh.access_token, LogoutReason::Unauthorized);
                }
                r
            }
            Err(DataError::Unauthorized) => {
                self.logged_out_if(&creds.access_token, LogoutReason::Unauthorized);
                Err(DataError::Unauthorized)
            }
            other => other,
        }
    }

    fn query<T: DeserializeOwned>(&self, procedure: &str, input: Value) -> Result<T> {
        decode(self.call(Kind::Query, procedure, input, &[], REQUEST_TIMEOUT)?)
    }

    fn mutate<T: DeserializeOwned>(&self, procedure: &str, input: Value) -> Result<T> {
        decode(self.call(Kind::Mutation, procedure, input, &[], REQUEST_TIMEOUT)?)
    }

    /// Single-flight refresh: har en anden tråd allerede fornyet (tokenet er
    /// skiftet), bruges dens resultat.
    fn refresh_if_same(&self, old_access: &str) -> Result<Credentials> {
        let _g = self.refresh_lock.lock();
        let cur = self.creds()?;
        if cur.access_token != old_access {
            return Ok(cur);
        }
        let Some(refresh_token) = cur.refresh_token.clone() else {
            self.logged_out_if(old_access, LogoutReason::Unauthorized);
            return Err(DataError::Unauthorized);
        };
        let r = self.api.call(
            Kind::Mutation,
            "extension.device.refresh",
            json!({ "refreshToken": refresh_token, "deviceId": self.cfg.device.device_id }),
            &[],
            REQUEST_TIMEOUT,
        );
        self.note(&r);
        match r {
            Ok(v) => {
                let tokens = decode::<TokenResponse>(v)?;
                // Compare-and-swap: er der logget ud eller ind imens, må
                // svaret hverken genoplive kontoen eller overskrive den nye.
                let mut slot = self.creds.lock();
                match slot.as_ref() {
                    Some(c) if c.access_token == old_access => {
                        let fresh = tokens.into_credentials(c.organization_id.clone());
                        self.store.save(&fresh);
                        *slot = Some(fresh.clone());
                        Ok(fresh)
                    }
                    Some(c) => Ok(c.clone()),
                    None => Err(DataError::Unauthorized),
                }
            }
            // Et tabt svar efter rotation: credentials er uændrede, så næste
            // forsøg bruger det gamle refresh-token, som web genudsteder
            // inden for 60 s (web #908).
            Err(e) if e.is_transient() => Err(e),
            Err(_) => {
                self.logged_out_if(old_access, LogoutReason::Unauthorized);
                Err(DataError::Unauthorized)
            }
        }
    }

    /// Log kun ud, hvis det stadig er det token, der blev afvist (et nyt
    /// login imens må ikke smides ud).
    fn logged_out_if(&self, rejected_access: &str, reason: LogoutReason) {
        let same = self.creds.lock().as_ref().is_some_and(|c| c.access_token == rejected_access);
        if same {
            self.logged_out(reason);
        }
    }

    fn logged_out(&self, reason: LogoutReason) {
        let had = self.creds.lock().take().is_some();
        self.store.clear();
        let _ = self.cache.clear_data();
        self.stop_realtime();
        if had {
            self.events.emit(Event::LoggedOut { reason });
        }
    }

    /// En kø fra en anden bruger må aldrig sendes med denne konto. Den
    /// flyttes, før noget sendes, til de afviste registreringer under den
    /// bruger, der lavede den: den bruger ser den og kan sende den igen efter
    /// næste login. Denne bruger ser den ikke.
    fn guard_outbox_owner(&self, user_id: &str) -> Result<()> {
        let owner = self.cache.meta("outbox_user");
        if let Some(owner) = owner.as_deref().filter(|o| *o != user_id) {
            let now = self.now();
            for (seq, q) in self.cache.pending()? {
                let (client, project) = self.names_for(&q.op);
                self.cache.dead_letter(
                    seq,
                    &q,
                    owner,
                    &cache::Rejection {
                        code: Some(dead_letter::OTHER_USER),
                        message: "Gemt offline, mens en anden bruger var logget ind. Ikke sendt.",
                        status: None,
                        at: now,
                        client_name: client.as_deref(),
                        project_name: project.as_deref(),
                    },
                )?;
            }
        }
        self.cache.set_meta("outbox_user", Some(user_id))
    }

    // ------------------------------------------------------------ afviste

    /// Brugeren, hvis afviste registreringer gælder: den indloggede, ellers
    /// den, der sidst brugte køen.
    fn dead_letter_user(&self) -> Option<String> {
        self.creds.lock().as_ref().map(|c| c.user.id.clone()).or_else(|| self.cache.meta("outbox_user"))
    }

    fn dead_letters_changed(&self) {
        let count = self.dead_letter_user().map_or(0, |u| self.cache.dead_letter_count(&u));
        self.events.emit(Event::DeadLetterChanged { count });
    }

    /// Kundens og projektets navn for en handling på en tidspost (fra cachen).
    fn names_for(&self, op: &Op) -> (Option<String>, Option<String>) {
        let (client_id, project_id) = match op {
            Op::CreateEntry { input, .. } => (input.client_id.clone(), input.project_id.clone()),
            Op::UpdateEntry { patch, base, .. } => (
                patch.client_id.clone().unwrap_or_else(|| base.as_ref().and_then(|b| b.client_id.clone())),
                patch.project_id.clone().unwrap_or_else(|| base.as_ref().and_then(|b| b.project_id.clone())),
            ),
            _ => (None, None),
        };
        let project = project_id.and_then(|id| self.cache.find_in_kind(Entity::Projects, &id));
        let client_id = client_id.or_else(|| {
            project.as_ref().and_then(|p| p.get("clientId")).and_then(Value::as_str).map(str::to_owned)
        });
        let client = client_id.and_then(|id| self.cache.find_in_kind(Entity::Clients, &id));
        let name = |v: Option<Value>| v.and_then(|v| v.get("name").and_then(Value::as_str).map(str::to_owned));
        (name(client), name(project))
    }

    fn dead_letters(&self) -> Result<Vec<dead_letter::DeadLetter>> {
        let Some(user) = self.dead_letter_user() else { return Ok(Vec::new()) };
        Ok(self
            .cache
            .dead_letters(&user)?
            .into_iter()
            .map(|r| {
                // Navnene fra afvisningen; ellers fra cachen nu.
                let (client, project) = match (&r.client_name, &r.project_name) {
                    (None, None) => self.names_for(&r.op.op),
                    _ => (r.client_name.clone(), r.project_name.clone()),
                };
                dead_letter::DeadLetter {
                    op: r.op,
                    user_id: r.user_id,
                    error_code: r.error_code,
                    error_message: r.error_message,
                    status: r.status,
                    rejected_at: r.rejected_at,
                    attempts: r.attempts,
                    client_name: client,
                    project_name: project,
                }
            })
            .collect())
    }

    /// Læg de afviste i køen igen og send. Hver handling ender ét af tre
    /// steder: leveret (væk), afvist igen (tilbage blandt de afviste med den
    /// nye fejl) eller stadig i køen (offline; ikke længere blandt de afviste).
    fn retry_dead_letters(&self, op_id: Option<&str>) -> Result<dead_letter::RetryOutcome> {
        let user = self.creds()?.user.id;
        // En afvist rettelse lægges oven på posten, som den er på web nu, ikke
        // den udgave, den blev lavet mod: web's update erstatter hele posten,
        // så det gamle øjebliksbillede ville overskrive det, der er rettet på
        // web siden. Kan posten ikke hentes (offline), sendes intet.
        for r in self.cache.dead_letters(&user)? {
            if op_id.is_some_and(|id| id != r.op.op_id) {
                continue;
            }
            if let Op::UpdateEntry { id, patch, base: Some(_) } = &r.op.op {
                let org = Some(&r.op.organization_id);
                match self.call_in(Kind::Query, "extension.entries.get", json!({ "id": id }), &[], REQUEST_TIMEOUT, org) {
                    Ok(v) => {
                        let fresh: TimeEntry = decode(v)?;
                        let op = Op::UpdateEntry { id: id.clone(), patch: patch.clone(), base: Some(Box::new(fresh)) };
                        self.cache.set_dead_letter_op(&user, &r.op.op_id, &op)?;
                    }
                    Err(e) if e.is_transient() || matches!(e, DataError::Unauthorized) => return Err(e),
                    // Fx slettet på web: sendes som den er, og web's svar vises.
                    Err(_) => {}
                }
            }
        }
        let ids = {
            // Ingen afsendelse imens, så ingen sender halvt lagte handlinger.
            let _g = self.flush_lock.lock();
            self.guard_outbox_owner(&user)?;
            self.cache.requeue_dead_letters(&user, op_id)?
        };
        if ids.is_empty() {
            return match op_id {
                Some(_) => Err(DataError::NotFound),
                None => Ok(dead_letter::RetryOutcome::default()),
            };
        }
        let flushed = self.flush(None);
        let mut out = dead_letter::RetryOutcome::default();
        let still_dead: std::collections::HashSet<String> =
            self.cache.dead_letters(&user)?.into_iter().map(|r| r.op.op_id).collect();
        for id in &ids {
            if self.cache.in_outbox(id) {
                out.queued += 1;
            } else if still_dead.contains(id) {
                out.rejected += 1;
            } else {
                out.sent += 1;
            }
        }
        // Ikke sendt (offline): handlingen hører nu til den almindelige kø.
        self.cache.drop_requeued_dead_letters()?;
        self.dead_letters_changed();
        self.events.emit(Event::QueueChanged { pending: self.cache.pending_count() });
        match flushed {
            Err(DataError::Unauthorized) => Err(DataError::Unauthorized),
            _ => Ok(out),
        }
    }

    fn signed_in(&self, creds: Credentials) -> Result<Session> {
        // Vent på en igangværende afsendelse, så den ikke fortsætter med
        // den nye kontos token.
        let _flush = self.flush_lock.lock();
        self.guard_outbox_owner(&creds.user.id)?;
        self.cache.clear_data()?;
        self.store.save(&creds);
        *self.creds.lock() = Some(creds);
        self.events.data_changed(&Entity::ALL);
        self.session()
    }

    fn complete_login(&self, callback_url: &str) -> Result<Session> {
        // Kontrollér før loginnet forbruges: et forfalsket link må ikke
        // afbryde det rigtige.
        let code = {
            let guard = self.pending_login.lock();
            let pending = guard.as_ref().ok_or_else(|| DataError::Auth("Intet login i gang".into()))?;
            pending.verify_callback(callback_url, self.now())?
        };
        let pending = self
            .pending_login
            .lock()
            .take()
            .ok_or_else(|| DataError::Auth("Intet login i gang".into()))?;
        let v = self.api.call(
            Kind::Mutation,
            "extension.device.exchangeCode",
            json!({
                "code": code,
                "codeVerifier": pending.code_verifier,
                "state": pending.state,
                "deviceId": self.cfg.device.device_id,
            }),
            &[],
            REQUEST_TIMEOUT,
        )?;
        let creds = decode::<TokenResponse>(v)?.into_credentials(None);
        self.signed_in(creds)
    }

    fn login_with_token(&self, token: &str) -> Result<Session> {
        let v = self.api.call(Kind::Query, "extension.validateToken", json!({ "token": token }), &[], REQUEST_TIMEOUT)?;
        let r: ValidateResponse = decode(v)?;
        let user = match (r.valid, r.user) {
            (true, Some(u)) => u,
            _ => return Err(DataError::Unauthorized),
        };
        self.signed_in(Credentials {
            access_token: token.to_owned(),
            refresh_token: None,
            expires_at: None,
            user,
            organization_id: None,
        })
    }

    fn session(&self) -> Result<Session> {
        let creds = self.creds.lock().clone();
        Ok(Session {
            mode: Mode::Cloud,
            user: creds.as_ref().map(|c| c.user.clone()),
            organization_id: creds.and_then(|c| c.organization_id),
            device: self.cfg.device.clone(),
        })
    }

    // ------------------------------------------------------------ cache

    fn is_fresh(&self, c: &cache::CachedValue) -> bool {
        // En negativ alder (uret er stillet tilbage) er ikke frisk.
        let age = self.now() - c.fetched_at;
        !c.stale
            && (self.realtime_connected.load(Ordering::SeqCst)
                || (age >= chrono::Duration::zero() && age < CACHE_TTL))
    }

    /// Læs gennem cachen: frisk cache bruges direkte; ellers hentes der, og
    /// ved usikre fejl (offline) bruges det sidst kendte.
    fn cached<T: DeserializeOwned>(&self, key: &str, kind: Entity, fetch: impl FnOnce() -> Result<Value>) -> Result<T> {
        self.cached_if(key, kind, |c| self.is_fresh(c), fetch)
    }

    /// Som `cached`, men frisk højst `ttl`, også mens strømmen kører: til
    /// data, web ikke sender hændelser for (tavlens kolonner).
    fn cached_ttl<T: DeserializeOwned>(
        &self,
        key: &str,
        kind: Entity,
        ttl: chrono::Duration,
        fetch: impl FnOnce() -> Result<Value>,
    ) -> Result<T> {
        self.cached_if(
            key,
            kind,
            |c| {
                let age = self.now() - c.fetched_at;
                !c.stale && age >= chrono::Duration::zero() && age < ttl
            },
            fetch,
        )
    }

    fn cached_if<T: DeserializeOwned>(
        &self,
        key: &str,
        kind: Entity,
        fresh: impl Fn(&cache::CachedValue) -> bool,
        fetch: impl FnOnce() -> Result<Value>,
    ) -> Result<T> {
        self.creds()?;
        let cached = self.cache.get(key);
        if let Some(c) = &cached
            && fresh(c)
        {
            return decode(c.value.clone());
        }
        let generation = self.cache.generation(kind);
        match fetch() {
            Ok(v) => {
                let _ = self.cache.put(key, kind, &v, self.now(), generation);
                decode(v)
            }
            Err(e) if e.is_transient() => match cached {
                Some(c) => decode(c.value),
                None => Err(e),
            },
            Err(e) => Err(e),
        }
    }

    fn changed(&self, kinds: &[Entity]) {
        self.cache.invalidate(kinds);
        self.events.data_changed(kinds);
    }

    // ------------------------------------------------------------ kø

    fn trigger_flush(&self) {
        if self.cache.pending_count() == 0 {
            return;
        }
        let Some(me) = self.self_ref.lock().upgrade() else { return };
        std::thread::spawn(move || {
            // Single-flight: kører en afsendelse allerede, gør den arbejdet.
            if let Some(_g) = me.flush_lock.try_lock() {
                drop(_g);
                let _ = me.flush(None);
            }
        });
    }

    /// Send køen i rækkefølge. Med `target` stoppes efter den handling, og
    /// dens svar returneres (`Ok(None)` = stadig i køen).
    fn flush(&self, target: Option<i64>) -> Result<Option<Value>> {
        let _g = self.flush_lock.lock();
        let owner = self.creds()?.user.id;
        self.guard_outbox_owner(&owner)?;
        let mut result = Ok(None);
        let mut touched: Vec<Entity> = Vec::new();
        let mut dead_changed = false;
        for (seq, q) in self.cache.pending()? {
            // Logget ud (eller anden bruger) undervejs: stop, intet sendes
            // med en anden kontos token.
            if !self.creds().is_ok_and(|c| c.user.id == owner) {
                break;
            }
            let (procedure, input, dates) = q.op.request(&|id| self.cache.resolve_id(id));
            let timeout = if matches!(q.op, Op::CreateEntry { .. }) { SAVE_TIMEOUT } else { REQUEST_TIMEOUT };
            let mut r = self.call_in(Kind::Mutation, procedure, input, dates, timeout, Some(&q.organization_id));
            // Et automatisk valgt kort, web afviser (ikke nok timer, arkiveret
            // imens posten lå i køen): gem posten uden kort. Tiden må ikke gå
            // tabt, fordi desktop valgte et kort.
            let rejected = r.as_ref().is_err_and(DataError::is_definite_rejection);
            if let Some(fallback) = q.op.without_auto_card().filter(|_| rejected) {
                let (procedure, input, dates) = fallback.request(&|id| self.cache.resolve_id(id));
                r = self.call_in(Kind::Mutation, procedure, input, dates, timeout, Some(&q.organization_id));
            }
            let is_target = Some(seq) == target;
            match r {
                Ok(v) => {
                    if let Op::CreateEntry { temp_id, .. } = &q.op
                        && let Some(real) = v.get("id").and_then(Value::as_str)
                    {
                        self.cache.map_id(temp_id, real)?;
                    }
                    self.cache.remove(seq)?;
                    touched.extend_from_slice(q.op.entities());
                    if is_target {
                        result = Ok(Some(v));
                    }
                }
                // Web: oprettelsen med samme nøgle er stadig i gang (fx det
                // første forsøg, hvis svar gik tabt). Ikke en afvisning: prøv
                // igen senere, så får vi den oprettede række.
                Err(e) if q.op.is_create() && e.code() == Some("CONFLICT") => {
                    self.cache.mark_attempt(seq, &e.to_string());
                    break;
                }
                Err(DataError::NotFound) if q.op.not_found_is_success() => {
                    self.cache.remove(seq)?;
                    touched.extend_from_slice(q.op.entities());
                    if is_target {
                        result = Ok(Some(Value::Null));
                    }
                }
                // Brugeren venter på svaret (handlingen blev lavet nu, online):
                // fejlen går direkte tilbage, og formularen eller timeren
                // bevarer tiden. Ellers (sendt fra køen senere) flyttes den til
                // de afviste registreringer og blokerer ikke resten af køen.
                // Det gælder også CONFLICT på en ny post: web svarer kun det,
                // når nøglen er brugt af en post, brugeren ikke kan se, og samme
                // nøgle giver samme svar igen.
                Err(e) if e.is_definite_rejection() => {
                    touched.extend_from_slice(q.op.entities());
                    if is_target {
                        self.cache.remove(seq)?;
                        result = Err(e);
                    } else {
                        let (code, message, status) = dead_letter::error_parts(&e);
                        let (client, project) = self.names_for(&q.op);
                        self.cache.dead_letter(
                            seq,
                            &q,
                            &owner,
                            &cache::Rejection {
                                code: code.as_deref(),
                                message: &message,
                                status,
                                at: self.now(),
                                client_name: client.as_deref(),
                                project_name: project.as_deref(),
                            },
                        )?;
                        dead_changed = true;
                        self.events.emit(Event::QueueRejected { op_id: q.op_id.clone(), message: e.to_string() });
                    }
                }
                // Logget ud: handlingen bliver i køen til næste login (samme
                // bruger) og meldes som køet, så den ikke tastes igen.
                Err(DataError::Unauthorized) => break,
                Err(e) => {
                    // Usikkert: posten KAN være gemt. Prøv igen senere med
                    // samme nøgle; en ældre handling blokerer de nyere.
                    self.cache.mark_attempt(seq, &e.to_string());
                    break;
                }
            }
            if is_target {
                break;
            }
        }
        touched.sort();
        touched.dedup();
        if !touched.is_empty() {
            self.changed(&touched);
        }
        if dead_changed {
            self.dead_letters_changed();
        }
        self.events.emit(Event::QueueChanged { pending: self.cache.pending_count() });
        result
    }

    /// Læg handlingen i køen og send den (og ældre) nu, hvis muligt.
    fn queued(&self, op: Op) -> Result<Option<Value>> {
        let creds = self.creds()?;
        self.guard_outbox_owner(&creds.user.id)?;
        let q = QueuedOp {
            op_id: Uuid::new_v4().to_string(),
            op,
            created_at: self.now(),
            organization_id: creds.organization_id.clone(),
        };
        let seq = self.cache.enqueue(&q)?;
        self.flush(Some(seq))
    }

    /// Opret med idempotensnøgle (dannes én gang, se `Op::Create`). Med
    /// `queue_creates` går den via køen: leveres den ikke nu, ligger den der
    /// med samme nøgle, og kalderen får `Offline`.
    ///
    /// Ligger en create af samme slags med samme indhold allerede i køen
    /// (brugeren trykkede "Opret" igen, mens den ventede), sendes den i
    /// stedet for en ny: en ny nøgle ville give en dublet, når køen tømmes.
    fn create(&self, kind: CreateKind, data: Value) -> Result<Value> {
        if self.cfg.queue_creates {
            let org = self.creds()?.organization_id;
            let waiting = self.cache.pending()?.into_iter().find_map(|(seq, q)| match q.op {
                Op::Create { kind: k, data: d, .. } if k == kind && d == data && q.organization_id == org => Some(seq),
                _ => None,
            });
            if let Some(seq) = waiting {
                return self.flush(Some(seq))?.ok_or(DataError::Offline);
            }
        }
        let op = Op::Create { kind, idempotency_key: Uuid::new_v4().to_string(), data };
        if !self.cfg.queue_creates {
            let (procedure, input, dates) = op.request(&|id| id.to_owned());
            let v = self.call(Kind::Mutation, procedure, input, dates, REQUEST_TIMEOUT)?;
            self.changed(op.entities());
            return Ok(v);
        }
        self.queued(op)?.ok_or(DataError::Offline)
    }

    fn pending_ops(&self) -> Vec<QueuedOp> {
        self.cache.pending().map(|v| v.into_iter().map(|(_, q)| q).collect()).unwrap_or_default()
    }

    // ------------------------------------------------------------ poster

    fn create_entry(&self, mut input: NewTimeEntry) -> Result<CreatedEntry> {
        let key = input.client_entry_id.get_or_insert_with(|| Uuid::new_v4().to_string()).clone();
        let op = Op::CreateEntry { temp_id: key.clone(), input: input.clone() };
        match self.queued(op)? {
            Some(v) => {
                let w: CreatedWire = decode(v)?;
                // Web sender `prepaidDeduction: null`, når et valgt kort ikke
                // dækkede, og tiden gik til faktura i stedet.
                let overflowed = w.prepaid_deduction.is_none()
                    && !w.deduplicated
                    && input.prepaid_package_id.is_some()
                    && w.entry.prepaid_package_id.is_none();
                let prepaid_deduction = w.prepaid_deduction.or_else(|| {
                    overflowed.then(|| PrepaidDeduction { overflowed_to_invoice: true, ..PrepaidDeduction::default() })
                });
                Ok(CreatedEntry { entry: w.entry, prepaid_deduction, deduplicated: w.deduplicated, queued: false })
            }
            None => {
                // En baggrunds-afsendelse kan have sendt den imens.
                let still_queued = self
                    .pending_ops()
                    .iter()
                    .any(|q| matches!(&q.op, Op::CreateEntry { temp_id, .. } if *temp_id == key));
                let real = self.cache.resolve_id(&key);
                if !still_queued
                    && real != key
                    && let Ok(entry) = self.query::<TimeEntry>("extension.entries.get", json!({ "id": real }))
                {
                    return Ok(CreatedEntry { entry, prepaid_deduction: None, deduplicated: false, queued: false });
                }
                Ok(CreatedEntry {
                    entry: provisional_entry(&key, &input, self.now()),
                    prepaid_deduction: None,
                    deduplicated: false,
                    queued: true,
                })
            }
        }
    }

    /// Posten, som brugeren ser den nu (ventende oprettelse og rettelser i
    /// køen medregnet). Bruges som grundlag for web's fulde `time.update`.
    fn known_entry(&self, id: &str) -> Option<TimeEntry> {
        let pending = self.pending_ops();
        let real = self.cache.resolve_id(id);
        // Web erstatter hele posten: online hentes den friske udgave (en
        // anden enhed kan have rettet den), ellers bruges cachen.
        let mut e = pending
            .iter()
            .find_map(|q| match &q.op {
                Op::CreateEntry { temp_id, input } if temp_id == id => {
                    Some(provisional_entry(temp_id, input, q.created_at))
                }
                _ => None,
            })
            .or_else(|| {
                self.online.load(Ordering::SeqCst)
                    .then(|| self.query::<TimeEntry>("extension.entries.get", json!({ "id": real })).ok())
                    .flatten()
            })
            .or_else(|| self.cache.find_in_kind(Entity::Entries, &real).and_then(|v| serde_json::from_value(v).ok()))?;
        for q in &pending {
            if let Op::UpdateEntry { id: qid, patch, .. } = &q.op
                && (qid == id || self.cache.resolve_id(qid) == real)
            {
                queue::apply_patch(&mut e, patch);
            }
        }
        Some(e)
    }

    fn list_entries(&self, filter: &EntryFilter) -> Result<Vec<TimeEntry>> {
        let fmt = |d: Option<NaiveDate>| d.map(|d| d.format("%Y-%m-%d").to_string());
        let wire = json!({
            "startDate": fmt(filter.start_date),
            "endDate": fmt(filter.end_date),
            "clientId": filter.client_id,
            "projectId": filter.project_id,
            "taskId": filter.task_id,
            "isBilled": filter.is_billed,
            "onlyOwn": true,
            "limit": 1000,
        });
        let wire = strip_nulls(wire);
        let key = format!("entries:{wire}");
        let entries: Vec<TimeEntry> = self.cached(&key, Entity::Entries, || {
            let mut all: Vec<Value> = Vec::new();
            let mut cursor: Option<String> = None;
            loop {
                let mut f = wire.clone();
                if let Some(c) = &cursor {
                    f["cursor"] = json!(c);
                }
                let v = self.call(Kind::Query, "extension.entries.list", json!({ "filter": f }), &[], REQUEST_TIMEOUT)?;
                let page: EntriesPage = decode(v.clone())?;
                all.extend(v.get("entries").and_then(Value::as_array).cloned().unwrap_or_default());
                match (page.has_more, page.next_cursor) {
                    (true, Some(c)) if all.len() < 50_000 => cursor = Some(c),
                    _ => break,
                }
                let _ = page.entries;
            }
            Ok(Value::Array(all))
        })?;
        Ok(overlay_entries(entries, &self.pending_ops(), filter, self.now()))
    }

    // ------------------------------------------------------------ timer

    fn fetch_timer(&self) -> Result<TimerState> {
        let generation = self.cache.generation(Entity::Timer);
        let r = self.call(Kind::Query, "extension.getTimerStateWithVersion", json!({}), &[], REQUEST_TIMEOUT);
        // Web bærer opgaven på timeren (`taskId` i svaret), så den følger
        // brugeren mellem enheder; desktop husker den ikke selv.
        match r {
            Ok(v) => {
                let _ = self.cache.put("timer", Entity::Timer, &v, self.now(), generation);
                decode(v)
            }
            Err(e) if e.is_transient() => match self.cache.get("timer") {
                Some(c) => decode(c.value),
                None => Err(e),
            },
            Err(e) => Err(e),
        }
    }

    fn write_timer(&self, input: Value, cur: &TimerState) -> Result<TimerState> {
        let mut input = input;
        input["source"] = json!("extension");
        let guarded = input.get("expectedVersion").is_some();
        let generation = self.cache.generation(Entity::Timer);
        let v = match self.call(Kind::Mutation, "extension.updateTimerState", input, &[], REQUEST_TIMEOUT) {
            // Med expectedVersion betyder CONFLICT, at en anden klient har
            // skrevet imens; ved start, at en anden timer kører.
            Err(DataError::Rejected { code, .. }) if code == "CONFLICT" => {
                let reason = if guarded { "version_conflict" } else { "already_running" };
                return Err(DataError::Conflict { reason: reason.into() });
            }
            other => other?,
        };
        if let Some(reason) = v.get("startRejected").and_then(Value::as_str) {
            return Err(DataError::Conflict { reason: reason.to_owned() });
        }
        if v.get("sessionMismatch").and_then(Value::as_bool) == Some(true) {
            return Err(DataError::Conflict { reason: "session_mismatch".into() });
        }
        if v.get("stoppingInProgress").and_then(Value::as_bool) == Some(true) {
            return Err(DataError::Conflict { reason: "stopping".into() });
        }
        let mut t: TimerState = decode(v)?;
        // Svaret har ikke klippekort-valget: behold det fra samme session.
        if t.session_id.is_some() && t.session_id == cur.session_id {
            t.prepaid_choice = t.prepaid_choice.or(cur.prepaid_choice.clone());
        }
        let _ =self.cache.put("timer", Entity::Timer, &serde_json::to_value(&t)?, self.now(), generation);
        self.events.emit(Event::TimerChanged { version: t.version });
        Ok(t)
    }

    fn timer_start(&self, input: StartTimer) -> Result<TimerState> {
        let cur = self.fetch_timer()?;
        if cur.is_active() {
            return Err(DataError::Conflict { reason: "already_running".into() });
        }
        let mut body = json!({
            "isRunning": true,
            "startTime": self.now().to_rfc3339(),
            "elapsedSeconds": 0,
            "baseSeconds": 0,
            "projectId": input.project_id,
            "clientId": input.client_id,
            "description": input.description,
            "isFreshStart": true,
            "clientOpId": Uuid::new_v4().to_string(),
        });
        // En frisk start uden taskId starter uden opgave (web).
        if let Some(t) = &input.task_id {
            body["taskId"] = json!(t);
        }
        self.write_timer(body, &cur)
    }

    fn timer_pause(&self) -> Result<TimerState> {
        let cur = self.fetch_timer()?;
        if !cur.is_running {
            return Err(DataError::Conflict { reason: "not_running".into() });
        }
        let elapsed = cur.elapsed_at(self.now());
        let mut body = json!({
            "isRunning": false,
            "startTime": Value::Null,
            "baseSeconds": elapsed,
            "elapsedSeconds": elapsed,
            "expectedVersion": cur.version,
        });
        if let Some(s) = &cur.session_id {
            body["sessionId"] = json!(s);
        }
        self.write_timer(body, &cur)
    }

    /// Metadata-skrivning på samme session: web opdaterer kun de felter, der
    /// sendes, og rører hverken kørsel, tid eller ejer (`lastSyncedFrom`).
    ///
    /// Samme skrivning som web's `extension.timer.setTarget` (der kalder
    /// updateTimerState med sessionen som prædikat), men direkte, fordi
    /// `setTarget` ikke tager beskrivelsen, og målet og beskrivelsen skal
    /// skifte i én atomisk skrivning. Målet er hele trippelen: `taskId: null`
    /// rydder opgaven (udeladt ville betyde "uændret" i updateTimerState).
    fn timer_set_target(&self, target: StartTimer) -> Result<TimerState> {
        let cur = self.fetch_timer()?;
        if !cur.is_active() {
            return Err(DataError::Conflict { reason: "not_active".into() });
        }
        let mut body = json!({
            "projectId": target.project_id,
            "clientId": target.client_id,
            "taskId": target.task_id,
            "description": target.description,
            "expectedVersion": cur.version,
        });
        if let Some(s) = &cur.session_id {
            body["sessionId"] = json!(s);
        }
        self.write_timer(body, &cur)
    }

    fn timer_resume(&self) -> Result<TimerState> {
        let cur = self.fetch_timer()?;
        if cur.is_running || !cur.is_active() {
            return Err(DataError::Conflict { reason: "not_paused".into() });
        }
        let mut body = json!({
            "isRunning": true,
            "startTime": self.now().to_rfc3339(),
            "expectedVersion": cur.version,
        });
        if let Some(s) = &cur.session_id {
            body["sessionId"] = json!(s);
        }
        self.write_timer(body, &cur)
    }

    fn stop_call(&self, procedure: &str, version: i64, session_id: Option<&str>) -> Result<Value> {
        let mut body = json!({ "version": version, "source": "extension" });
        if let Some(s) = session_id {
            body["sessionId"] = json!(s);
        }
        self.call(Kind::Mutation, procedure, body, &[], REQUEST_TIMEOUT)
    }

    /// Fælles stop-protokol: claimForStop → gem post → confirmStop (eller
    /// cancelStop, hvis serveren afviser posten).
    fn timer_stop(&self, input: StopTimer) -> Result<StopOutcome> {
        let cur = self.fetch_timer()?;
        if !cur.is_active() {
            return Err(DataError::Conflict { reason: "not_active".into() });
        }
        let now = self.now();
        let mut claim_body = json!({ "expectedVersion": cur.version, "source": "extension" });
        if let Some(s) = &cur.session_id {
            claim_body["sessionId"] = json!(s);
        }
        let claim: ClaimResponse = self.mutate("extension.claimForStop", claim_body)?;
        if !claim.success {
            return Err(DataError::Conflict { reason: claim.reason.unwrap_or_else(|| "claim_failed".into()) });
        }
        let version = claim.version.unwrap_or(cur.version + 1);
        let session_id = claim.session_id.clone().or(cur.session_id.clone());
        let session = claim.session.unwrap_or(ClaimSession {
            project_id: cur.project_id.clone(),
            client_id: cur.client_id.clone(),
            task_id: cur.task_id.clone(),
            description: cur.description.clone(),
        });
        let seconds = cur.elapsed_at(now);
        // Idle-fradrag i samme post: starten bevares, slutningen rykkes frem.
        // Web får posten med den rigtige længde i ét kald (ingen rettelse
        // bagefter, der kan afvises, når timeren allerede er stoppet).
        let kept = input.kept_secs(seconds);
        let mut entry = None;
        if !input.discard && kept >= 60 {
            let started = now - chrono::Duration::seconds(seconds);
            let ended = started + chrono::Duration::seconds(kept);
            let date = started.with_timezone(&chrono::Local).date_naive();
            // Web's session har kun timerens egen kunde; et projekt-kun-
            // stop hører til projektets kunde (som web's klippekort-valg).
            let client_id = session.client_id.clone().or_else(|| cur.effective_client_id());
            let prepaid_package_id = match &claim.prepaid_choice {
                Some(PrepaidChoice::None) => None,
                Some(PrepaidChoice::Package { package_id }) => Some(package_id.clone()),
                None => client_id.as_ref().and_then(|cid| {
                    let pkgs = self.klippekort_active().ok()?;
                    self.rules.pick_auto_deduct_package(&pkgs, cid, date).map(|p| p.id.clone())
                }),
            };
            let description = input
                .description
                .filter(|d| !d.trim().is_empty())
                .or_else(|| Some(session.description.clone()).filter(|d| !d.trim().is_empty()))
                .unwrap_or_else(|| "Uden beskrivelse".into());
            let new = NewTimeEntry {
                project_id: session.project_id.clone(),
                client_id,
                // Sessionens øjebliksbillede fra claimForStop er sandheden
                // (opgaven kan være skiftet eller ryddet på en anden enhed).
                task_id: session.task_id.clone(),
                description,
                hours: (Decimal::from(kept) / Decimal::from(3600)).round_dp(2).max(Decimal::new(1, 2)),
                date,
                start_time: Some(started),
                end_time: Some(ended),
                prepaid_package_id,
                timer_session_id: session_id.clone(),
                // Samme nøgle ved gentagelse: sessions-id'et er unikt.
                client_entry_id: Some(session_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string())),
                from_timer: Some(true),
                ..NewTimeEntry::default()
            };
            // Et automatisk valgt kort uden saldo nok må ikke koste tiden:
            // køen gemmer posten uden kort, hvis web afviser kortet (også når
            // posten først sendes senere), se `Op::without_auto_card`.
            let new = NewTimeEntry {
                prepaid_auto: claim.prepaid_choice.is_none() && new.prepaid_package_id.is_some(),
                no_prepaid: matches!(claim.prepaid_choice, Some(PrepaidChoice::None)),
                ..new
            };
            match self.create_entry(new) {
                Ok(created) => entry = Some(created),
                Err(e) => {
                    let _ = self.stop_call("extension.cancelStop", version, session_id.as_deref());
                    return Err(e);
                }
            }
        }
        match self.stop_call("extension.confirmStop", version, session_id.as_deref()) {
            // En anden klient bumpede versionen imens (fx et heartbeat):
            // web svarer med den nye, så prøv én gang til med den.
            Ok(v) if v.get("reason").and_then(Value::as_str) == Some("version_mismatch") => {
                if let Some(newer) = v.get("version").and_then(Value::as_i64) {
                    let _ = self.stop_call("extension.confirmStop", newer, session_id.as_deref());
                }
            }
            Ok(_) => {}
            // Posten er gemt (eller i køen med sessions-nøglen); web rydder
            // et forladt stop selv efter 60 s.
            Err(e) => log::warn!("confirmStop fejlede: {e}"),
        }
        let timer = self.fetch_timer().unwrap_or_default();
        self.events.emit(Event::TimerChanged { version: timer.version });
        Ok(StopOutcome { entry, timer })
    }

    fn klippekort_active(&self) -> Result<Vec<PrepaidPackage>> {
        let pkgs: Vec<ExtPackage> =
            self.cached("klippekort:active", Entity::Klippekort, || {
                self.call(Kind::Query, "extension.getPrepaidPackages", json!({}), &[], REQUEST_TIMEOUT)
            })?;
        Ok(pkgs.into_iter().map(Into::into).collect())
    }

    fn start_realtime(&self) {
        let mut slot = self.realtime_stop.lock();
        if slot.is_some() {
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        *slot = Some(stop.clone());
        let Some(me) = self.self_ref.lock().upgrade() else { return };
        let host: Weak<dyn RealtimeHost> = {
            let arc: Arc<dyn RealtimeHost> = me;
            Arc::downgrade(&arc)
        };
        let cfg = self.cfg.realtime.clone();
        std::thread::Builder::new()
            .name("tt-data-sse".into())
            .spawn(move || sse::run(host, stop, cfg))
            .ok();
    }

    fn stop_realtime(&self) {
        if let Some(stop) = self.realtime_stop.lock().take() {
            stop.store(true, Ordering::SeqCst);
        }
        if self.realtime_connected.swap(false, Ordering::SeqCst) {
            self.events.emit(Event::Realtime { connected: false });
        }
    }
}

fn strip_nulls(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(m.into_iter().filter(|(_, v)| !v.is_null()).collect()),
        other => other,
    }
}

impl RealtimeHost for CloudInner {
    fn open(&self, idle: Duration) -> Option<Opened> {
        let creds = self.creds.lock().clone()?;
        match self.api.open_stream(&creds.access_token, creds.organization_id.as_deref(), idle) {
            Ok((200, reader)) => Some(Opened::Stream(reader)),
            Ok((401, _)) => Some(Opened::Unauthorized),
            Ok((503, _)) => Some(Opened::Disabled),
            Ok(_) => Some(Opened::Failed),
            Err(e) => {
                if e == DataError::Offline {
                    self.set_online(false);
                }
                Some(Opened::Failed)
            }
        }
    }

    fn connected(&self, connected: bool) {
        if self.realtime_connected.swap(connected, Ordering::SeqCst) != connected {
            self.events.emit(Event::Realtime { connected });
        }
        if connected {
            self.set_online(true);
            self.trigger_flush();
        }
    }

    fn signal(&self, signal: StreamSignal) {
        match signal {
            StreamSignal::Timer { version } => {
                self.cache.invalidate(&[Entity::Timer]);
                self.events.emit(Event::TimerChanged { version });
            }
            StreamSignal::Data(entities) => self.changed(&entities),
            StreamSignal::Revoked => self.logged_out(LogoutReason::Revoked),
            StreamSignal::Ping | StreamSignal::Other => {}
        }
    }

    fn unauthorized(&self) -> bool {
        let Ok(creds) = self.creds() else { return false };
        if creds.refresh_token.is_none() {
            self.logged_out_if(&creds.access_token, LogoutReason::Unauthorized);
            return false;
        }
        match self.refresh_if_same(&creds.access_token) {
            Ok(_) => true,
            Err(e) => e.is_transient(),
        }
    }

    fn poll_tick(&self) {
        if self.creds.lock().is_some() {
            self.changed(&Entity::ALL);
        }
    }
}

impl CloudRepo {
    /// Hent et arkiveret kort frem (web's `archive` skifter tilstanden, så
    /// den kaldes kun, når kortet er arkiveret).
    pub async fn unarchive_klippekort(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |i| {
            let cur: PrepaidPackage = i.query("extension.klippekort.get", json!({ "id": id }))?;
            if cur.is_archived.unwrap_or(false) {
                let v = i.call(Kind::Mutation, "extension.klippekort.archive", json!({ "id": id }), &[], REQUEST_TIMEOUT)?;
                if v.get("isArchived").and_then(Value::as_bool) == Some(true) {
                    // En anden klient hentede det frem imens: kaldet arkiverede igen.
                    i.call(Kind::Mutation, "extension.klippekort.archive", json!({ "id": id }), &[], REQUEST_TIMEOUT)?;
                }
            }
            i.changed(&[Entity::Klippekort]);
            Ok(())
        })
        .await
    }

    /// Ret forfaldsdato og noter (web: `extension.invoices.update`). Web har
    /// ingen titel på fakturaer, og sletning af kladder findes ikke i
    /// device-API'et endnu (`TODO(web)`: `extension.invoices.delete`).
    pub async fn update_invoice_details(
        &self,
        id: &str,
        due_date: NaiveDate,
        notes: Option<String>,
    ) -> Result<Invoice> {
        let id = id.to_owned();
        self.run(move |i| {
            let data = json!({
                "id": id,
                "dueDate": due_date.format("%Y-%m-%d").to_string(),
                "notes": notes.unwrap_or_default(),
            });
            i.call(Kind::Mutation, "extension.invoices.update", json!({ "data": data }), &[], REQUEST_TIMEOUT)?;
            i.changed(&[Entity::Invoices]);
            i.query("extension.invoices.get", json!({ "id": id }))
        })
        .await
    }
}

// --------------------------------------------------------------- trait

#[async_trait]
impl Repository for CloudRepo {
    fn mode(&self) -> Mode {
        Mode::Cloud
    }

    fn events(&self) -> Events {
        self.inner.events.clone()
    }

    async fn session(&self) -> Result<Session> {
        self.inner.session()
    }

    async fn organizations(&self) -> Result<Vec<Organization>> {
        self.run(|i| i.query("extension.listOrganizations", json!({}))).await
    }

    async fn select_organization(&self, organization_id: &str) -> Result<()> {
        let org = organization_id.to_owned();
        self.run(move |i| {
            let orgs: Vec<Organization> = i.query("extension.listOrganizations", json!({}))?;
            if !orgs.iter().any(|o| o.id == org) {
                return Err(DataError::Validation("Du er ikke medlem af den organisation".into()));
            }
            {
                // Under refresh-låsen, så en samtidig refresh ikke skriver
                // den gamle org tilbage.
                let _g = i.refresh_lock.lock();
                let mut slot = i.creds.lock();
                let creds = slot.as_mut().ok_or(DataError::Unauthorized)?;
                creds.organization_id = Some(org);
                i.store.save(creds);
            }
            i.cache.clear_data()?;
            // Strømmen følger org'en: genstart den, hvis den kører.
            let was_running = i.realtime_stop.lock().is_some();
            if was_running {
                i.stop_realtime();
                i.start_realtime();
            }
            i.events.data_changed(&Entity::ALL);
            Ok(())
        })
        .await
    }

    async fn entitlements(&self) -> Result<Entitlements> {
        self.run(|i| {
            i.cached("entitlements", Entity::Entitlements, || {
                i.call(Kind::Query, "extension.entitlements.get", json!({}), &[], REQUEST_TIMEOUT)
            })
        })
        .await
    }

    async fn logout(&self) -> Result<()> {
        self.run(|i| {
            // Tilbagekald enheden på serveren. Fejler det (offline, allerede
            // tilbagekaldt), logges der alligevel ud lokalt; brugeren kan
            // tilbagekalde enheden i web under Indstillinger → Integrationer.
            // Via `call`, så et udløbet adgangstoken fornyes først; ellers ville
            // refresh-tokenet blive ved med at virke på serveren.
            if i.creds().is_ok()
                && let Err(e) = i.call(Kind::Mutation, "extension.device.logout", json!({}), &[], REQUEST_TIMEOUT)
            {
                log::warn!("device.logout fejlede: {e}");
            }
            i.logged_out(LogoutReason::User);
            Ok(())
        })
        .await
    }

    // ---------------------------------------------------------------- kunder

    async fn list_clients(&self, include_archived: bool) -> Result<Vec<Client>> {
        self.run(move |i| {
            i.cached(&format!("clients:{include_archived}"), Entity::Clients, || {
                i.call(Kind::Query, "extension.clients.list", json!({ "includeArchived": include_archived }), &[], REQUEST_TIMEOUT)
            })
        })
        .await
    }

    async fn get_client(&self, id: &str) -> Result<Client> {
        let id = id.to_owned();
        self.run(move |i| i.query("extension.clients.get", json!({ "id": id }))).await
    }

    async fn create_client(&self, mut input: NewClient) -> Result<Client> {
        // Som web's normalizeClientDomains (web afviser fx en tom linje).
        input.domains = normalize_client_domains(&input.domains).map_err(DataError::Validation)?;
        self.run(move |i| {
            decode(i.create(CreateKind::Client, serde_json::to_value(&input)?)?)
        })
        .await
    }

    async fn update_client(&self, id: &str, mut patch: ClientPatch) -> Result<Client> {
        if let Some(d) = &patch.domains {
            patch.domains = Some(normalize_client_domains(d).map_err(DataError::Validation)?);
        }
        let id = id.to_owned();
        self.run(move |i| {
            // Web erstatter hele kunden: læg rettelsen oven på den nuværende.
            let cur: Client = i.query("extension.clients.get", json!({ "id": id }))?;
            let data = wire::client_update_data(&cur, &patch);
            let c: Client = i.mutate("extension.clients.update", json!({ "id": id, "data": data }))?;
            i.changed(&[Entity::Clients]);
            Ok(c)
        })
        .await
    }

    async fn archive_client(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |i| i.queued(Op::ArchiveClient { id }).map(|_| ())).await
    }

    async fn unarchive_client(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |i| i.queued(Op::UnarchiveClient { id }).map(|_| ())).await
    }

    // ---------------------------------------------------------------- projekter

    async fn list_projects(&self, include_archived: bool) -> Result<Vec<Project>> {
        self.run(move |i| {
            let all: Vec<Project> = i.cached("projects", Entity::Projects, || {
                i.call(Kind::Query, "extension.projects.list", json!({}), &[], REQUEST_TIMEOUT)
            })?;
            Ok(all.into_iter().filter(|p| include_archived || p.status != ProjectStatus::Archived).collect())
        })
        .await
    }

    async fn get_project(&self, id: &str) -> Result<Project> {
        let id = id.to_owned();
        self.run(move |i| i.query("extension.projects.get", json!({ "id": id }))).await
    }

    async fn create_project(&self, input: NewProject) -> Result<Project> {
        self.run(move |i| {
            decode(i.create(CreateKind::Project, serde_json::to_value(&input)?)?)
        })
        .await
    }

    async fn update_project(&self, id: &str, patch: ProjectPatch) -> Result<Project> {
        let id = id.to_owned();
        self.run(move |i| {
            // Web erstatter hele projektet (også status): læg rettelsen oven
            // på det nuværende.
            let cur: Project = i.query("extension.projects.get", json!({ "id": id }))?;
            let data = wire::project_update_data(&cur, &patch);
            let p: Project = i.mutate("extension.projects.update", json!({ "id": id, "data": data }))?;
            i.changed(&[Entity::Projects, Entity::Rules]);
            Ok(p)
        })
        .await
    }

    async fn set_project_status(&self, id: &str, status: ProjectStatus) -> Result<()> {
        let id = id.to_owned();
        self.run(move |i| i.queued(Op::SetProjectStatus { id, status }).map(|_| ())).await
    }

    // ---------------------------------------------------------------- klippekort

    async fn list_klippekort(&self, client_id: Option<&str>, include_inactive: bool) -> Result<Vec<PrepaidPackage>> {
        let client_id = client_id.map(str::to_owned);
        self.run(move |i| {
            let all = if include_inactive {
                // Alle kort inkl. inaktive og arkiverede (web's prepaid.list).
                i.cached("klippekort:all", Entity::Klippekort, || {
                    let input = json!({ "filter": { "includeArchived": true } });
                    i.call(Kind::Query, "extension.klippekort.list", input, &[], REQUEST_TIMEOUT)
                })?
            } else {
                i.klippekort_active()?
            };
            Ok(all
                .into_iter()
                .filter(|p: &PrepaidPackage| client_id.as_ref().is_none_or(|c| &p.client_id == c))
                .collect())
        })
        .await
    }

    async fn create_klippekort(&self, input: NewPrepaidPackage) -> Result<PrepaidPackage> {
        self.run(move |i| {
            decode(i.create(CreateKind::Klippekort, serde_json::to_value(&input)?)?)
        })
        .await
    }

    async fn update_klippekort(&self, id: &str, patch: PrepaidPackagePatch) -> Result<PrepaidPackage> {
        let id = id.to_owned();
        self.run(move |i| {
            // Web erstatter hele kortet: læg rettelsen oven på det nuværende.
            let cur: PrepaidPackage = i.query("extension.klippekort.get", json!({ "id": id }))?;
            if cur.purchase_date.is_none() && patch.purchase_date.is_none() {
                // Web kræver købsdatoen; den må ikke stille blive dags dato.
                return Err(DataError::Validation("Klippekortet mangler en købsdato".into()));
            }
            let data = wire::prepaid_update_data(&cur, &patch);
            let p: PrepaidPackage = i.mutate("extension.klippekort.update", json!({ "id": id, "data": data }))?;
            i.changed(&[Entity::Klippekort]);
            Ok(p)
        })
        .await
    }

    async fn top_up_klippekort(&self, id: &str, hours: Decimal, note: Option<String>) -> Result<PrepaidPackage> {
        if hours < Decimal::new(1, 2) {
            return Err(DataError::Validation("Timer skal være mindst 0.01".into()));
        }
        let id = id.to_owned();
        self.run(move |i| {
            let hours = hours.round_dp(2).to_string().parse::<f64>().unwrap_or(0.0);
            // Idempotensnøgle (web's feat/desktop-api-3): samme nøgle fylder
            // kun på én gang. Et usikkert svar (timeout, tabt forbindelse)
            // afgøres ved at læse kortet: steg timerne, er optankningen sket;
            // ellers sendes den én gang til med samme nøgle. Kortet læses
            // først, fordi en ældre web ignorerer nøglen, og et blindt nyt
            // forsøg dér ville fylde på to gange.
            let before: PrepaidPackage = i.query("extension.klippekort.get", json!({ "id": id }))?;
            let key = Uuid::new_v4().to_string();
            let input = strip_nulls(json!({ "id": id, "hours": hours, "note": note, "idempotencyKey": key }));
            let call = || i.call(Kind::Mutation, "extension.klippekort.topUp", input.clone(), &[], SAVE_TIMEOUT);
            let mut attempt = 0;
            let p: PrepaidPackage = loop {
                match call() {
                    // `CONFLICT` på et nyt forsøg: den første optankning kører
                    // stadig på serveren. Vent lidt, og læs kortet igen.
                    Err(e) if e.is_transient() || (attempt > 0 && e.code() == Some("CONFLICT")) => {}
                    other => break decode(other?)?,
                }
                if attempt == DRAFT_RETRIES {
                    // Uafgjort: sig det, så brugeren tjekker kortet i stedet
                    // for at fylde på igen med en ny nøgle.
                    return Err(DataError::Validation(
                        "Optankningen blev måske ikke gemt. Tjek klippekortet, før du prøver igen".into(),
                    ));
                }
                if attempt > 0 {
                    std::thread::sleep(DRAFT_BACKOFF * (1 << (attempt - 1)));
                }
                if let Ok(now) = i.query::<PrepaidPackage>("extension.klippekort.get", json!({ "id": id }))
                    && now.total_hours > before.total_hours
                {
                    break now;
                }
                attempt += 1;
            };
            i.changed(&[Entity::Klippekort]);
            Ok(p)
        })
        .await
    }

    async fn klippekort_usage(&self, id: &str) -> Result<Vec<PrepaidUsage>> {
        let id = id.to_owned();
        self.run(move |i| {
            // Web's prepaid.getById: kortet med `usageHistory` (nyeste først).
            let mut v: Value = i.query("extension.klippekort.get", json!({ "id": id }))?;
            decode(v.get_mut("usageHistory").map(Value::take).unwrap_or(Value::Null))
                .map(|u: Option<Vec<PrepaidUsage>>| u.unwrap_or_default())
        })
        .await
    }

    async fn archive_klippekort(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |i| {
            // Web's archive SKIFTER arkiveret/ikke arkiveret. Et kort, der
            // allerede er arkiveret, må ikke sendes igen (det ville hente det
            // frem), og kaldet gentages aldrig blindt.
            let cur: PrepaidPackage = i.query("extension.klippekort.get", json!({ "id": id }))?;
            if !cur.is_archived.unwrap_or(false) {
                let v = i.call(Kind::Mutation, "extension.klippekort.archive", json!({ "id": id }), &[], REQUEST_TIMEOUT)?;
                if v.get("isArchived").and_then(Value::as_bool) == Some(false) {
                    // En anden klient arkiverede imens: kaldet hentede det frem.
                    i.call(Kind::Mutation, "extension.klippekort.archive", json!({ "id": id }), &[], REQUEST_TIMEOUT)?;
                }
            }
            i.changed(&[Entity::Klippekort]);
            Ok(())
        })
        .await
    }

    // ---------------------------------------------------------------- poster

    async fn list_entries(&self, filter: EntryFilter) -> Result<Vec<TimeEntry>> {
        self.run(move |i| i.list_entries(&filter)).await
    }

    async fn get_entry(&self, id: &str) -> Result<TimeEntry> {
        let id = id.to_owned();
        self.run(move |i| {
            // En post, der stadig venter i køen, findes kun her.
            for q in i.pending_ops() {
                if let Op::CreateEntry { temp_id, input } = &q.op
                    && *temp_id == id
                {
                    return Ok(provisional_entry(temp_id, input, q.created_at));
                }
            }
            i.query("extension.entries.get", json!({ "id": i.cache.resolve_id(&id) }))
        })
        .await
    }

    async fn create_entry(&self, input: NewTimeEntry) -> Result<CreatedEntry> {
        self.run(move |i| i.create_entry(input)).await
    }

    async fn update_entry(&self, id: &str, patch: TimeEntryPatch) -> Result<TimeEntry> {
        let id = id.to_owned();
        self.run(move |i| {
            // Rydning af tidspunktet sendes som `startTime/endTime: null`
            // (web's time.update), se `wire::entry_update_data`.
            let base = i.known_entry(&id);
            match i.queued(Op::UpdateEntry { id: id.clone(), patch: patch.clone(), base: base.clone().map(Box::new) })? {
                Some(v) => decode(v),
                None => {
                    // I køen: vis den kendte post med rettelsen.
                    let mut e = base.unwrap_or(TimeEntry { id: id.clone(), ..TimeEntry::default() });
                    queue::apply_patch(&mut e, &patch);
                    e.pending = true;
                    Ok(e)
                }
            }
        })
        .await
    }

    async fn delete_entry(&self, id: &str) -> Result<()> {
        let id = id.to_owned();
        self.run(move |i| i.queued(Op::DeleteEntry { id }).map(|_| ())).await
    }

    // ---------------------------------------------------------------- timer

    async fn timer(&self) -> Result<TimerState> {
        self.run(|i| i.fetch_timer()).await
    }

    async fn timer_start(&self, input: StartTimer) -> Result<TimerState> {
        self.run(move |i| i.timer_start(input)).await
    }

    async fn timer_pause(&self) -> Result<TimerState> {
        self.run(|i| i.timer_pause()).await
    }

    async fn timer_resume(&self) -> Result<TimerState> {
        self.run(|i| i.timer_resume()).await
    }

    async fn timer_set_target(&self, target: StartTimer) -> Result<TimerState> {
        self.run(move |i| i.timer_set_target(target)).await
    }

    async fn timer_stop(&self, input: StopTimer) -> Result<StopOutcome> {
        self.run(move |i| i.timer_stop(input)).await
    }

    async fn set_prepaid_choice(&self, choice: Option<PrepaidChoice>) -> Result<()> {
        self.run(move |i| {
            let cur = i.fetch_timer()?;
            let Some(client_id) = cur.effective_client_id() else {
                return Err(DataError::Conflict { reason: "not_active".into() });
            };
            let wire = match choice {
                None => json!({ "mode": "auto" }),
                Some(c) => serde_json::to_value(c)?,
            };
            let v: Value = i.mutate("extension.setPrepaidChoice", json!({ "clientId": client_id, "choice": wire }))?;
            if v.get("success").and_then(Value::as_bool) == Some(false) {
                let reason = v.get("reason").and_then(Value::as_str).unwrap_or("rejected");
                return Err(DataError::Conflict { reason: reason.to_owned() });
            }
            // Valget bumper ikke versionen i web: læs timeren igen.
            i.cache.invalidate(&[Entity::Timer]);
            let version = i.fetch_timer().map(|t| t.version).unwrap_or(cur.version);
            i.events.emit(Event::TimerChanged { version });
            Ok(())
        })
        .await
    }

    // ---------------------------------------------------------------- opgaver

    async fn list_tasks(&self, filter: TaskFilter) -> Result<Vec<Task>> {
        self.run(move |i| {
            let f = strip_nulls(json!({
                "status": filter.status.map(|s| s.as_str()),
                "projectId": filter.project_id,
                "clientId": filter.client_id,
            }));
            let tasks = i.cached(&format!("tasks:{f}"), Entity::Tasks, || {
                i.call(Kind::Query, "extension.tasks.list", json!({ "filter": f }), &[], REQUEST_TIMEOUT)
            })?;
            let lanes: Vec<TaskLane> = i.cache.get("task_lanes").and_then(|c| decode(c.value).ok()).unwrap_or_default();
            Ok(overlay_tasks(tasks, &i.pending_ops(), &lanes, &filter))
        })
        .await
    }

    async fn create_task(&self, input: NewTask) -> Result<Task> {
        self.run(move |i| {
            decode(i.create(CreateKind::Task, serde_json::to_value(&input)?)?)
        })
        .await
    }

    async fn update_task(&self, id: &str, patch: TaskPatch) -> Result<Task> {
        let id = id.to_owned();
        self.run(move |i| {
            let mut data = serde_json::to_value(&patch)?;
            data["id"] = json!(id);
            let v = i.call(Kind::Mutation, "extension.tasks.update", json!({ "data": data }), &["data.deadline"], REQUEST_TIMEOUT)?;
            i.changed(&[Entity::Tasks]);
            decode(v)
        })
        .await
    }

    async fn set_task_status(&self, id: &str, status: TaskStatus) -> Result<()> {
        let id = id.to_owned();
        self.run(move |i| i.queued(Op::SetTaskStatus { id, status }).map(|_| ())).await
    }

    async fn list_task_lanes(&self) -> Result<Vec<TaskLane>> {
        // Den generelle tavle (som web's /dashboard/tasks). Gemmes i cachen,
        // så kolonnerne også vises offline.
        self.run(|i| {
            i.cached_ttl("task_lanes", Entity::Tasks, CACHE_TTL, || {
                i.call(Kind::Query, "extension.tasks.statuses", json!({ "projectId": null }), &[], REQUEST_TIMEOUT)
            })
        })
        .await
    }

    async fn move_task(&self, input: MoveTask) -> Result<()> {
        self.run(move |i| {
            i.queued(Op::MoveTask { id: input.task_id, status_id: input.status_id, ordered_task_ids: input.ordered_task_ids })
                .map(|_| ())
        })
        .await
    }

    async fn log_task_time(&self, task_id: &str, input: NewTimeEntry) -> Result<CreatedEntry> {
        // Samme som web's tasks.logTime (time.create med taskId), men via
        // køen, så den virker offline.
        let input = NewTimeEntry { task_id: Some(task_id.to_owned()), ..input };
        self.run(move |i| i.create_entry(input)).await
    }

    // ---------------------------------------------------------------- fakturaer

    async fn list_invoices(&self) -> Result<Vec<Invoice>> {
        self.run(|i| {
            let all: Vec<Invoice> = i.cached("invoices", Entity::Invoices, || {
                i.call(Kind::Query, "extension.invoices.list", json!({}), &[], REQUEST_TIMEOUT)
            })?;
            // Web's list har også slettede fakturaer med.
            Ok(all.into_iter().filter(|f| f.status != InvoiceStatus::Deleted).collect())
        })
        .await
    }

    async fn get_invoice(&self, id: &str) -> Result<Invoice> {
        let id = id.to_owned();
        self.run(move |i| i.query("extension.invoices.get", json!({ "id": id }))).await
    }

    async fn uninvoiced_summary(&self) -> Result<Vec<UninvoicedSummary>> {
        self.run(|i| {
            let rows: Vec<UninvoicedWire> = i.query("extension.invoices.uninvoicedSummary", json!({}))?;
            Ok(rows
                .into_iter()
                .map(|r| UninvoicedSummary {
                    client_id: r.client.id,
                    client_name: r.client.name,
                    hours: r.total_hours,
                    amount: r.total_amount,
                    entry_count: r.entry_count,
                })
                .collect())
        })
        .await
    }

    async fn uninvoiced_entries(&self, client_id: &str) -> Result<Vec<TimeEntry>> {
        let client_id = client_id.to_owned();
        self.run(move |i| i.query("extension.invoices.uninvoicedEntries", json!({ "clientId": client_id }))).await
    }

    async fn create_invoice_draft(&self, input: NewInvoiceDraft) -> Result<Invoice> {
        self.run(move |i| {
            let data = strip_nulls(json!({
                "clientId": input.client_id,
                "timeEntryIds": input.time_entry_ids,
                "notes": input.notes,
                "dueDate": input.due_date.map(|d| d.format("%Y-%m-%d").to_string()),
            }));
            // Idempotensnøgle: samme nøgle inden for 24 timer giver samme
            // kladde. Et usikkert svar (timeout, tabt forbindelse) prøves derfor
            // én gang til med samme nøgle i stedet for at give en fejl, der
            // kunne få brugeren til at lave kladden igen (posterne er låst).
            let body = json!({ "data": data, "idempotencyKey": Uuid::new_v4().to_string() });
            // Svarer web CONFLICT på et nyt forsøg, kører den første oprettelse
            // stadig på serveren: vent lidt og spørg igen (så kommer kladden).
            let call = || i.call(Kind::Mutation, "extension.invoices.createDraft", body.clone(), &[], SAVE_TIMEOUT);
            let mut attempt = 0;
            let v = loop {
                match call() {
                    Err(e) if attempt < DRAFT_RETRIES && (if attempt == 0 { e.is_transient() } else { e.code() == Some("CONFLICT") }) => {
                        if attempt > 0 {
                            std::thread::sleep(DRAFT_BACKOFF * (1 << (attempt - 1)));
                        }
                    }
                    other => break other?,
                }
                attempt += 1;
            };
            // Svaret er `{ invoice, lineItems, totalAmount, lines }`.
            let draft: DraftWire = decode(v)?;
            i.changed(&[Entity::Invoices, Entity::Entries]);
            if let Some(lines) = draft.lines {
                // Linjerne følger med: editoren behøver ikke hente dem igen.
                let generation = i.cache.generation(Entity::Invoices);
                let _ = i.cache.put(&lines_key(&draft.invoice.id), Entity::Invoices, &serde_json::to_value(lines)?, i.now(), generation);
            }
            Ok(draft.invoice)
        })
        .await
    }

    async fn invoice_lines(&self, invoice_id: &str) -> Result<Vec<InvoiceLine>> {
        let id = invoice_id.to_owned();
        self.run(move |i| {
            i.cached(&lines_key(&id), Entity::Invoices, || {
                i.call(Kind::Query, "extension.invoices.lines", json!({ "id": id }), &[], REQUEST_TIMEOUT)
            })
        })
        .await
    }

    async fn invoice_lines_many(&self, ids: Vec<Id>) -> Result<HashMap<Id, Vec<InvoiceLine>>> {
        self.run(move |i| {
            // Web's linesByInvoice: fakturaens id → linjer, højst 500 pr. kald.
            let mut out = HashMap::new();
            for chunk in ids.chunks(LINES_BATCH) {
                let key = format!("invoice_lines_many:{}", chunk.join(","));
                let part: HashMap<Id, Vec<InvoiceLine>> = i.cached(&key, Entity::Invoices, || {
                    i.call(Kind::Query, "extension.invoices.linesByInvoice", json!({ "ids": chunk }), &[], REQUEST_TIMEOUT)
                })?;
                out.extend(part);
            }
            Ok(out)
        })
        .await
    }

    async fn save_invoice_lines(&self, invoice_id: &str, lines: Vec<InvoiceLine>) -> Result<()> {
        let id = invoice_id.to_owned();
        self.run(move |i| {
            i.call(
                Kind::Mutation,
                "extension.invoices.saveLines",
                json!({ "data": { "invoiceId": id, "lines": lines } }),
                &[],
                REQUEST_TIMEOUT,
            )?;
            i.changed(&[Entity::Invoices]);
            Ok(())
        })
        .await
    }

    async fn send_invoice(&self, id: &str) -> Result<Invoice> {
        let id = id.to_owned();
        self.run(move |i| {
            i.call(Kind::Mutation, "extension.invoices.send", json!({ "id": id }), &[], SAVE_TIMEOUT)?;
            i.changed(&[Entity::Invoices]);
            i.query("extension.invoices.get", json!({ "id": id }))
        })
        .await
    }

    async fn mark_invoice_paid(&self, id: &str, paid_date: Option<NaiveDate>) -> Result<Invoice> {
        let id = id.to_owned();
        self.run(move |i| {
            let mut body = json!({ "id": id });
            if let Some(d) = paid_date {
                body["paidDate"] = json!(d.format("%Y-%m-%d").to_string());
            }
            i.call(Kind::Mutation, "extension.invoices.markPaid", body, &[], REQUEST_TIMEOUT)?;
            i.changed(&[Entity::Invoices]);
            i.query("extension.invoices.get", json!({ "id": id }))
        })
        .await
    }

    // ---------------------------------------------------------------- rapporter

    async fn report(&self, query: ReportQuery) -> Result<Report> {
        let this = self.clone();
        let entries = this
            .list_entries(EntryFilter {
                start_date: Some(query.start_date),
                end_date: Some(query.end_date),
                ..EntryFilter::default()
            })
            .await?;
        let clients = this.list_clients(true).await?;
        let projects = this.list_projects(true).await?;
        Ok(build_report(&query, &entries, &Names::new(&clients, &projects)))
    }

    // ---------------------------------------------------------------- regler

    async fn matching_rules(&self) -> Result<Vec<MatchingRule>> {
        self.run(move |i| {
            // Projekternes urlPatterns (kun aktive) og brugerens regler.
            let r: wire::MatchingRulesResponse = i.cached("rules", Entity::Rules, || {
                i.call(Kind::Query, "extension.rules.getMatchingRules", json!({}), &[], REQUEST_TIMEOUT)
            })?;
            Ok(r.into_rules())
        })
        .await
    }

    async fn upsert_rule(&self, rule: MatchingRule) -> Result<MatchingRule> {
        if rule.source == RuleSource::Project {
            return Err(DataError::Validation("Projekt-mønstre rettes på projektet".into()));
        }
        if !rule.not_work && rule.project_id.is_none() && rule.client_id.is_none() {
            // Som web's ruleInput: et mål eller "ikke arbejde".
            return Err(DataError::Validation("En regel skal pege på et projekt eller en kunde".into()));
        }
        self.run(move |i| {
            let input = json!({ "rules": [wire::rule_upsert_item(&rule)] });
            let v = i.call(Kind::Mutation, "extension.rules.upsert", input, &[], REQUEST_TIMEOUT)?;
            i.changed(&[Entity::Rules]);
            let id = v.pointer("/ids/0").and_then(Value::as_str).unwrap_or_default().to_owned();
            Ok(MatchingRule { id, updated_at: Some(i.now()), ..rule })
        })
        .await
    }

    async fn site_mappings(&self) -> Result<Vec<SiteMapping>> {
        self.run(|i| {
            i.cached("site_mappings", Entity::Rules, || {
                i.call(Kind::Query, "extension.siteMappings.list", json!({}), &[], REQUEST_TIMEOUT)
            })
        })
        .await
    }

    async fn learned_patterns(&self, since: Option<chrono::DateTime<Utc>>) -> Result<LearnedPatterns> {
        self.run(move |i| match since {
            // Hele listen caches (offline-læsning); et delta hentes altid.
            None => i.cached("patterns", Entity::Rules, || {
                i.call(Kind::Query, "extension.patterns.list", json!({}), &[], REQUEST_TIMEOUT)
            }),
            Some(t) => i.query("extension.patterns.list", json!({ "since": t.to_rfc3339() })),
        })
        .await
    }

    async fn upsert_learned_patterns(&self, patterns: Vec<LearnedPatternRecord>) -> Result<usize> {
        self.run(move |i| {
            // Web tager 1-500 pr. kald.
            let mut n = 0;
            for chunk in patterns.chunks(500) {
                let items: Vec<Value> = chunk.iter().map(|p| json!({ "key": p.key, "votes": p.votes })).collect();
                let v: Value = i.mutate("extension.patterns.upsert", json!({ "patterns": items }))?;
                n += v.get("upserted").and_then(Value::as_u64).unwrap_or(0) as usize;
            }
            if n > 0 {
                i.changed(&[Entity::Rules]);
            }
            Ok(n)
        })
        .await
    }

    async fn delete_rule(&self, id: &str) -> Result<()> {
        if id.starts_with("project:") {
            return Err(DataError::Validation("Projekt-mønstre rettes på projektet".into()));
        }
        let id = id.to_owned();
        self.run(move |i| {
            i.call(Kind::Mutation, "extension.rules.remove", json!({ "ids": [id] }), &[], REQUEST_TIMEOUT)?;
            i.changed(&[Entity::Rules]);
            Ok(())
        })
        .await
    }
}
