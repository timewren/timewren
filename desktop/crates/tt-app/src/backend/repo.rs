//! `RepoBackend`: `Backend` oven på `tt-data`.
//!
//! Appen kører i én af to tilstande (spec D5/D6):
//!
//! - **Lokal**: `tt_data::LocalRepo` (SQLite i `data_dir()/local.db`), licens
//!   fra `license.json`.
//! - **Cloud**: `tt_data::CloudRepo` mod web (login via PKCE og deep link,
//!   token i OS-nøgleringen, cache i `cache.db`, offline-kø).
//!
//! Tilstanden gemmes i `state.json` og kan skifte under kørsel: login fra
//! onboarding går fra lokal til cloud, logud (også et tilbagekaldt token)
//! tilbage til lokal. Den lokale database bliver liggende og kan importeres
//! til cloud (`import_local_to_cloud`).
//!
//! `Backend` er synkront og kaldes kun fra GPUI's background executor, så alle
//! async-kald afventes med `futures_lite::future::block_on` (tt-data bruger
//! sin egen trådpulje og kræver ingen runtime).
//!
//! Hændelser: [`RepoBackend::changes`] giver et signal, hver gang noget er
//! ændret (egne skrivninger, web, timer, kø, online/offline), så app-roden kan
//! kalde `ctx.changed(cx)`. Danske beskeder (logget ud, afvist ændring,
//! offline) kommer på [`RepoBackend::notices`].

pub(crate) mod files;
// gendan: fakturaopsætning, backup og andre tabte 0.2-funktioner.
// Aktivitet: blokke og "Tildel" (0.2.25).
mod aktivitet;
mod gendan;
pub(crate) use gendan::{join_danish, unique_path};
mod map;
mod moenstre;
// ux-vaelger: "Altid sådan" og regeloversigten.
mod regler;
mod secrets;

use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

use chrono::{DateTime, Local, NaiveDate, Utc};
use futures_lite::future::block_on;
use tt_data as td;
use tt_data::{
    BusinessRules, CloudConfig, CloudRepo, CoreRules, DeviceInfo, EntryFilter, Event, LocalRepo,
    LogoutReason, Repository, SecretStore,
};

use super::licens::{self, Access, Action, EntitlementCache, LockReason};
use super::services::Detection;
use super::*;

pub use secrets::KeyringSecretStore;

/// Standard-adressen til web (TimeWren: TimeWren Cloud). `TT_WEB_URL`
/// overstyrer; en egen server vælges ved login (`Backend::set_server_url`).
pub const DEFAULT_WEB_URL: &str = tt_core::edition::EDITION.web_url;
/// Licensserveren (TimeTrack: samme som den gamle app). `TT_LICENSE_URL` overstyrer.
pub const DEFAULT_LICENSE_URL: &str = tt_core::edition::EDITION.license_url;

/// Forretningsreglerne, som begge repos bruger (klippekort-træk, timepris,
/// afrunding, moms, fakturanumre): tt-core, i paritet med web.
fn business_rules() -> Arc<dyn BusinessRules> {
    Arc::new(CoreRules)
}

/// Alt, der skal til at åbne en `RepoBackend`. `Options::new` læser
/// miljøvariablerne; tests bygger dem selv.
#[derive(Clone)]
pub struct Options {
    pub data_dir: PathBuf,
    pub detection: Arc<dyn Detection>,
    /// Fx `https://timetrack.dk`.
    pub web_url: String,
    pub license_url: String,
    /// Hvor login-tokenet ligger (nøgleringen i appen).
    pub secrets: Arc<dyn SecretStore>,
    /// Uret (tests). `None` = systemuret.
    pub clock: Option<td::Clock>,
    /// Håndhæv licensen (lokal) og planen (cloud). Kun tests slår det fra.
    pub enforce_license: bool,
    /// Synkroniser lærte mønstre i baggrunden (cloud). Tests kalder
    /// `sync_patterns_now` selv.
    pub pattern_sync: bool,
}

impl Options {
    pub fn new(data_dir: PathBuf, detection: Arc<dyn Detection>) -> Self {
        Options {
            data_dir,
            detection,
            web_url: env_or("TT_WEB_URL", DEFAULT_WEB_URL),
            license_url: env_or("TT_LICENSE_URL", DEFAULT_LICENSE_URL),
            secrets: secrets::default_store(),
            clock: None,
            enforce_license: true,
            pattern_sync: true,
        }
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| default.into())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoticeKind {
    /// Loginet er væk (tilbagekaldt, udløbet). Appen er gået tilbage til lokal.
    LoggedOut,
    /// En køet ændring blev afvist af web. Den er gemt blandt de afviste
    /// registreringer og kan sendes igen.
    QueueRejected,
    Offline,
    Online,
}

/// En besked til brugeren med dansk tekst, som UI'et kan vise som toast.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
    pub kind: NoticeKind,
    pub text: String,
}

enum Active {
    Local(LocalRepo),
    Cloud(CloudRepo),
}

impl Active {
    fn repo(&self) -> Arc<dyn Repository> {
        match self {
            Active::Local(r) => Arc::new(r.clone()),
            Active::Cloud(r) => Arc::new(r.clone()),
        }
    }
}

/// Et browser-login i gang (trin 1 er gjort, deep linket mangler).
struct PendingLogin {
    repo: CloudRepo,
    state: String,
}

struct Shared {
    opts: Options,
    device: DeviceInfo,
    active: RwLock<Active>,
    /// Stiger ved hvert skift af repo; hændelser fra et gammelt repo ignoreres.
    generation: AtomicU64,
    pending_login: Mutex<Option<PendingLogin>>,
    org_name: Mutex<String>,
    /// Serialiserer læs-og-skriv af filerne i datamappen.
    files: Mutex<()>,
    changes_tx: async_channel::Sender<()>,
    changes_rx: async_channel::Receiver<()>,
    notices_tx: async_channel::Sender<Notice>,
    notices_rx: async_channel::Receiver<Notice>,
    /// Antal gange indstillinger er sendt til detektionen efter opstart.
    /// Låsen serialiserer `apply_settings`, så opstartens (baggrund) aldrig
    /// overskriver en nyere ændring fra brugeren.
    settings_applied: Mutex<u64>,
    /// Det sidst kendte svar fra web (cloud), gemt i
    /// `entitlements.json` så offline-respiten overlever en genstart.
    access_cache: Mutex<Option<EntitlementCache>>,
    /// Udløser til mønstersynkroniseringens tråd (`moenstre.rs`).
    pattern_sync: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

/// Poisonede låse er ikke et problem her (ingen invarianter midt i en
/// opdatering), så vi tager data med.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn read<T>(l: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    l.read().unwrap_or_else(|p| p.into_inner())
}

fn write<T>(l: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    l.write().unwrap_or_else(|p| p.into_inner())
}

fn other(what: &str, e: impl std::fmt::Display) -> BackendError {
    BackendError::Other(format!("{what}: {e}"))
}

pub(crate) fn device_name() -> String {
    for var in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(v) = std::env::var(var)
            && !v.trim().is_empty()
        {
            return v.trim().to_owned();
        }
    }
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Min computer".into())
}

/// `state=…` fra login-URL'en (hex/UUID, så ingen afkodning er nødvendig).
fn state_from_url(url: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    query
        .split('&')
        .find_map(|kv| kv.strip_prefix("state="))
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Deep linket, `complete_login` får: hele linket eller kun koden (så bygges
/// linket med den `state`, vi selv har gemt).
fn callback_url(code_or_url: &str, state: &str) -> String {
    let c = code_or_url.trim();
    if c.contains("://") {
        c.to_owned()
    } else {
        format!(
            "{}?code={}&state={}",
            td::cloud::auth::redirect_uri(),
            percent_encode(c),
            state
        )
    }
}

pub struct RepoBackend {
    shared: Arc<Shared>,
}

impl RepoBackend {
    /// Åbn datalaget i `data_dir`: læser `state.json` og åbner lokal eller
    /// cloud. Kræver ingen forbindelse. Appens indstillinger sendes til
    /// detektionen (`apply_settings`), så sporingen starter som sidst.
    pub fn open(data_dir: PathBuf, detection: Arc<dyn Detection>) -> Result<Self> {
        Self::open_with(Options::new(data_dir, detection))
    }

    pub fn open_with(opts: Options) -> Result<Self> {
        std::fs::create_dir_all(&opts.data_dir)
            .map_err(|e| other("Kan ikke oprette datamappen", e))?;
        let device_id = DeviceInfo::load_or_create_id(&opts.data_dir.join("device-id"))
            .map_err(|e| other("Kan ikke gemme enhedens id", e))?;
        let device = DeviceInfo {
            device_id,
            device_name: device_name(),
            os: std::env::consts::OS.to_owned(),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
        };
        let state = files::load_state(&opts.data_dir)?;
        let (changes_tx, changes_rx) = async_channel::bounded(1);
        let (notices_tx, notices_rx) = async_channel::bounded(32);

        // Midlertidig tom aktiv tilstand, så `Shared` kan bygges; erstattes
        // straks nedenfor.
        let local = open_local(&opts.data_dir, &device, &opts.clock)?;
        let access_cache = Mutex::new(match files::load_entitlement_cache(&opts.data_dir) {
            Ok(c) => c,
            // En beskadiget cache må ikke stoppe appen eller give adgang: uden
            // cache kræves der en bekræftelse fra web.
            Err(e) => {
                eprintln!("TT: planens cache kunne ikke læses: {e}");
                None
            }
        });
        let shared = Arc::new(Shared {
            opts,
            device,
            active: RwLock::new(Active::Local(local)),
            generation: AtomicU64::new(0),
            pending_login: Mutex::new(None),
            org_name: Mutex::new(String::new()),
            files: Mutex::new(()),
            changes_tx,
            changes_rx,
            notices_tx,
            notices_rx,
            settings_applied: Mutex::new(0),
            access_cache,
            pattern_sync: Mutex::new(None),
        });
        shared.start_pattern_sync();

        let mut started_cloud = false;
        if state.mode == files::StoredMode::Cloud {
            match shared.cloud_repo() {
                Ok(cloud) if cloud.is_logged_in() => {
                    shared.activate_cloud(cloud, false)?;
                    started_cloud = true;
                }
                // Loginet er væk (nøgleringen er ryddet): tilbage til lokal.
                _ => {
                    shared.notice(
                        NoticeKind::LoggedOut,
                        &format!(
                            "Du er logget ud af {}. Log ind igen for at hente dine data",
                            tt_core::edition::EDITION.name
                        ),
                    );
                    shared.switch_to_local()?;
                }
            }
        }
        if !started_cloud && state.mode == files::StoredMode::Local {
            shared.watch_active();
        }

        // I baggrunden: med AI-tilstanden "lokal server" leder detektionen
        // efter servere (op til ca. 0,6 s), og vinduet må ikke vente på det.
        let bg = shared.clone();
        std::thread::Builder::new()
            .name("tt-apply-settings".into())
            .spawn(move || {
                let applied = lock(&bg.settings_applied);
                if *applied > 0 {
                    return; // brugeren har allerede gemt nyere indstillinger
                }
                match files::load_settings(&bg.opts.data_dir) {
                    Ok(s) => bg.opts.detection.apply_settings(&s),
                    Err(e) => eprintln!("TT: indstillingerne blev ikke sendt til detektionen: {e}"),
                }
            })
            .map_err(|e| BackendError::Other(format!("Kunne ikke starte detektionen: {e}")))?;
        Ok(RepoBackend { shared })
    }

    /// Lokal tilstand i en given mappe uden detektion, nøglering og netværk.
    /// Til tests og demo.
    pub fn local_for_tests(dir: impl Into<PathBuf>) -> Self {
        Self::open_with(Options::for_tests(
            dir.into(),
            Arc::new(super::services::NoDetection),
        ))
        .expect("lokal backend til tests")
    }

    /// Signal ved enhver ændring (egne skrivninger, web, timer, offline-kø,
    /// online/offline, logud). Kald `ctx.changed(cx)` for hvert. Signaler
    /// slås sammen, hvis ingen har hentet det forrige endnu. Alle klonede
    /// modtagere deler samme kø: kald den én gang og del modtageren.
    pub fn changes(&self) -> async_channel::Receiver<()> {
        self.shared.changes_rx.clone()
    }

    /// Trackerens idle-signal (se `Detection::idle_returns`).
    pub fn idle_returns(&self) -> Option<super::services::IdleRx> {
        self.shared.opts.detection.idle_returns()
    }

    /// Beskeder på dansk til brugeren (se [`Notice`]).
    pub fn notices(&self) -> async_channel::Receiver<Notice> {
        self.shared.notices_rx.clone()
    }

    /// Log ind med et eksisterende token (web → indstillinger). Skifter til
    /// cloud-tilstand og returnerer kontoen.
    pub fn login_with_token(&self, token: &str) -> Result<Account> {
        let repo = self.shared.cloud_repo()?;
        block_on(repo.login_with_token(token)).map_err(|e| map::error(e, "Kontoen"))?;
        self.shared.activate_cloud(repo, true)?;
        self.account()
    }

    /// Antal ændringer i offline-køen (0 i lokal tilstand).
    pub fn pending_count(&self) -> usize {
        match &*read(&self.shared.active) {
            Active::Cloud(c) => c.pending_count(),
            Active::Local(_) => 0,
        }
    }

    /// Er cloud online? Lokal tilstand er altid "online".
    pub fn is_online(&self) -> bool {
        match &*read(&self.shared.active) {
            Active::Cloud(c) => c.is_online(),
            Active::Local(_) => true,
        }
    }

    /// Send offline-køen nu (fx når maskinen vågner). Antal tilbage.
    pub fn sync_now(&self) -> Result<usize> {
        let cloud = match &*read(&self.shared.active) {
            Active::Cloud(c) => Some(c.clone()),
            Active::Local(_) => None,
        };
        match cloud {
            Some(c) => block_on(c.sync_now()).map_err(|e| map::error(e, "Køen")),
            None => Ok(0),
        }
    }

    /// Hvornår den lokale database sidst blev importeret til cloud.
    pub fn imported_at(&self) -> Option<DateTime<Utc>> {
        files::load_state(&self.shared.opts.data_dir)
            .ok()
            .and_then(|s| s.imported_at)
    }

    fn repo(&self) -> Arc<dyn Repository> {
        read(&self.shared.active).repo()
    }

    fn now(&self) -> DateTime<Utc> {
        self.shared
            .opts
            .clock
            .as_ref()
            .map_or_else(Utc::now, |c| c())
    }

    fn local(&self) -> Option<LocalRepo> {
        match &*read(&self.shared.active) {
            Active::Local(l) => Some(l.clone()),
            Active::Cloud(_) => None,
        }
    }

    fn cloud(&self) -> Option<CloudRepo> {
        match &*read(&self.shared.active) {
            Active::Cloud(c) => Some(c.clone()),
            Active::Local(_) => None,
        }
    }

    /// Adgang ud fra det, vi ved lokalt. `online = None` bruger datalagets
    /// egen online-tilstand.
    fn compute_access(&self, online: Option<bool>) -> Access {
        if !self.shared.opts.enforce_license {
            return Access::Full;
        }
        let now = self.now();
        match self.cloud() {
            // App Store-udgaven: gratis til personlig brug, så intet låses.
            // Erhvervslicensen (in-app-køb) er kun en status (`store.rs`).
            None if crate::mas::ENABLED => Access::Full,
            None => match files::load_license(self.dir()) {
                Ok(f) => licens::local_access(
                    &f.as_local(),
                    now.with_timezone(&Local).date_naive(),
                    files::TRIAL_DAYS,
                ),
                // Fejl lukket: en ulæselig licensfil giver ikke adgang. Data røres ikke.
                Err(_) => Access::Locked(LockReason::NoLicense),
            },
            Some(c) => {
                let online = online.unwrap_or_else(|| c.is_online());
                let cache = lock(&self.shared.access_cache);
                licens::cloud_access(cache.as_ref(), online, now)
            }
        }
    }

    /// Husk det nyeste svar fra web (med tidsstempel) i hukommelsen og på disken.
    fn store_entitlements(&self, e: td::Entitlements) {
        let now = self.now();
        let mut cache = lock(&self.shared.access_cache);
        // Serveren har netop bekræftet planen, så et tidligere `last_seen` (fx
        // fra et ur, der var stillet frem) gælder ikke længere.
        let next = EntitlementCache::new(e, now);
        if let Err(err) = files::store_entitlement_cache(self.dir(), &next) {
            eprintln!("TT: planen kunne ikke gemmes til offline-brug: {err}");
        }
        *cache = Some(next);
    }

    /// Tillad eller afvis en handling ud fra licensen. En timer, der er i
    /// gang, bliver aldrig ramt af en låsning.
    fn gate(&self, action: Action) -> Result<()> {
        let access = self.compute_access(None);
        if !access.is_locked() {
            return Ok(());
        }
        let timer_active =
            block_on(self.repo().timer()).is_ok_and(|t| t.is_running || t.is_active());
        access.check(action, timer_active)
    }

    fn is_cloud(&self) -> bool {
        matches!(&*read(&self.shared.active), Active::Cloud(_))
    }

    /// Momssatsen på fakturaer: lokalt 25 %, i cloud afgør web (se
    /// `Invoice::vat_permille`).
    fn vat_permille(&self) -> Option<u32> {
        (!self.is_cloud()).then_some(map::VAT_PERMILLE)
    }

    fn dir(&self) -> &std::path::Path {
        &self.shared.opts.data_dir
    }

    /// Afvent et async datalagskald. `what` bruges, hvis noget ikke findes.
    fn run<T>(&self, what: &str, fut: impl Future<Output = td::Result<T>>) -> Result<T> {
        block_on(fut).map_err(|e| map::error(e, what))
    }

    fn invoice_with_lines(&self, repo: &dyn Repository, inv: &td::Invoice) -> Result<Invoice> {
        let lines = self.run("Fakturaen", repo.invoice_lines(&inv.id))?;
        let mut out = map::invoice(inv, &lines, self.today(), self.vat_permille());
        self.attach_deliveries(std::slice::from_mut(&mut out));
        Ok(out)
    }

    /// Læg afsendelsen (tidspunkt og modtager) på de fakturaer, der er sendt
    /// herfra. Kosmetik: en ulæselig fil må ikke stoppe fakturalisten.
    fn attach_deliveries(&self, invoices: &mut [Invoice]) {
        let sends = match files::load_invoice_sends(self.dir()) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("TT: fakturaernes afsendelser kunne ikke læses: {e}");
                return;
            }
        };
        for inv in invoices
            .iter_mut()
            .filter(|i| i.status != InvoiceStatus::Draft)
        {
            inv.delivery = sends.0.get(&inv.id).map(|s| InvoiceDelivery {
                at: s.at,
                to: s.to.clone(),
            });
        }
    }

    /// Husk, at fakturaen blev sendt nu. Fakturaen ER sendt, så en fejl her
    /// meldes kun i loggen.
    fn record_delivery(&self, id: &str, to: Option<String>) -> Option<InvoiceDelivery> {
        let at = self.now().with_timezone(&Local).naive_local();
        let _g = lock(&self.shared.files);
        let mut sends = match files::load_invoice_sends(self.dir()) {
            Ok(s) => s,
            Err(e) => {
                // Overskriv ikke en ulæselig fil: de tidligere tidspunkter
                // ligger måske stadig i den.
                eprintln!("TT: afsendelsen af fakturaen kunne ikke gemmes: {e}");
                return Some(InvoiceDelivery { at, to });
            }
        };
        sends
            .0
            .insert(id.to_owned(), files::StoredSend { at, to: to.clone() });
        if let Err(e) = files::store_invoice_sends(self.dir(), &sends) {
            eprintln!("TT: afsendelsen af fakturaen kunne ikke gemmes: {e}");
        }
        Some(InvoiceDelivery { at, to })
    }

    /// Kunder og projekter, detektionen kan foreslå (kun aktive).
    fn catalog(&self) -> Result<(Vec<Customer>, Vec<Project>)> {
        let customers = self.customers(false)?;
        let projects = self
            .projects(None, false)?
            .into_iter()
            .filter(|p| p.status == ProjectStatus::Active)
            .collect();
        Ok((customers, projects))
    }

    /// Kundedomæner og site-koblinger til detektionen (cloud: web's
    /// `Client.domains` og `siteMappings.list`; lokalt: kunderne og
    /// domæne-reglerne). Fejler en af dem, foreslås der uden.
    fn web_catalog(&self) -> services::WebCatalog {
        let repo = self.repo();
        let client_domains = match block_on(repo.list_clients(false)) {
            Ok(clients) => clients
                .into_iter()
                .filter(|c| !c.domains.is_empty())
                .map(|c| (c.id, c.domains))
                .collect(),
            Err(e) => {
                eprintln!("TT: kundernes domæner kunne ikke hentes: {e}");
                Default::default()
            }
        };
        let site_mappings = match block_on(repo.site_mappings()) {
            Ok(maps) => maps
                .into_iter()
                .map(|m| services::WebSiteMapping {
                    domain: m.domain,
                    project_id: m.project_id,
                    client_id: m.client_id,
                    usage_count: u32::try_from(m.usage_count.max(0)).unwrap_or(u32::MAX),
                })
                .collect(),
            Err(e) => {
                eprintln!("TT: site-koblingerne kunne ikke hentes: {e}");
                Vec::new()
            }
        };
        // Brugerens regler inkl. "ikke arbejde" (cloud: `rules.getMatchingRules`,
        // cachet og ryddet ved web's hændelser). Projekternes URL-mønstre står
        // allerede på projekterne.
        let rules = match block_on(repo.matching_rules()) {
            Ok(rules) => rules
                .into_iter()
                .filter(|r| r.source != td::RuleSource::Project)
                .map(|r| services::WebRule {
                    id: r.id,
                    kind: r.kind,
                    pattern: r.pattern,
                    project_id: r.project_id,
                    client_id: r.client_id,
                    not_work: r.not_work,
                })
                .collect(),
            Err(e) => {
                eprintln!("TT: reglerne kunne ikke hentes: {e}");
                Vec::new()
            }
        };
        services::WebCatalog {
            client_domains,
            site_mappings,
            rules,
        }
    }

    /// Det klippekort, en ny post skal trække fra (automatisk valg). Også i
    /// cloud: web's `time.create` trækker kun på det kort, der sendes med
    /// (`prepaidPackageId`), og vælger aldrig selv.
    fn auto_card(&self, repo: &dyn Repository, client: &str, date: NaiveDate) -> Option<String> {
        if client.is_empty() {
            return None;
        }
        let packages = block_on(repo.list_klippekort(Some(client), false)).ok()?;
        business_rules()
            .pick_auto_deduct_package(&packages, client, date)
            .map(|p| p.id.clone())
    }
}

fn open_local(
    dir: &std::path::Path,
    device: &DeviceInfo,
    clock: &Option<td::Clock>,
) -> Result<LocalRepo> {
    let repo = LocalRepo::open(dir.join("local.db"), device.clone())
        .map_err(|e| map::error(e, "Databasen"))?
        .with_rules(business_rules());
    Ok(match clock {
        Some(c) => repo.with_clock(c.clone()),
        None => repo,
    })
}

impl Options {
    /// Til tests: nøglering i hukommelsen og en web-adresse, ingen lytter på.
    pub fn for_tests(data_dir: PathBuf, detection: Arc<dyn Detection>) -> Self {
        Options {
            data_dir,
            detection,
            web_url: "http://127.0.0.1:1".into(),
            license_url: "http://127.0.0.1:1".into(),
            secrets: Arc::new(td::MemorySecretStore::new()),
            clock: None,
            enforce_license: false,
            pattern_sync: false,
        }
    }
}

impl Shared {
    fn signal(&self) {
        let _ = self.changes_tx.try_send(());
    }

    fn notice(&self, kind: NoticeKind, text: &str) {
        let _ = self.notices_tx.try_send(Notice {
            kind,
            text: text.to_owned(),
        });
    }

    /// Serveren: den, brugeren valgte ved login (en egen server), ellers
    /// standarden (`Options::web_url`).
    fn web_url(&self) -> String {
        // Uden `files`-låsen: filen skrives atomisk (tmp + rename), og flere
        // kaldere holder låsen, mens de åbner datalaget.
        files::load_state(&self.opts.data_dir)
            .ok()
            .and_then(|s| s.server_url)
            .unwrap_or_else(|| self.opts.web_url.clone())
    }

    fn cloud_repo(&self) -> Result<CloudRepo> {
        let mut cfg = CloudConfig::new(self.web_url(), self.device.clone());
        cfg.cache_path = Some(self.opts.data_dir.join("cache.db"));
        let repo =
            CloudRepo::new(cfg, self.opts.secrets.clone()).map_err(|e| map::error(e, "Cachen"))?;
        let clock: td::Clock = self
            .opts
            .clock
            .clone()
            .unwrap_or_else(|| Arc::new(Utc::now));
        Ok(repo.with_rules_and_clock(business_rules(), clock))
    }

    fn persist_mode(&self, mode: files::StoredMode) -> Result<()> {
        let _g = lock(&self.files);
        let mut state = files::load_state(&self.opts.data_dir).unwrap_or_default();
        state.mode = mode;
        files::save_state(&self.opts.data_dir, &state)
    }

    /// Cloud bliver den aktive tilstand: gem, start live-strømmen og lyt på
    /// hændelser. `persist` er falsk ved opstart, hvor tilstanden allerede er
    /// gemt.
    fn activate_cloud(self: &Arc<Self>, repo: CloudRepo, persist: bool) -> Result<()> {
        if persist {
            self.persist_mode(files::StoredMode::Cloud)?;
        }
        self.seed_access_cache(&repo);
        repo.start_realtime();
        let old = {
            let mut active = write(&self.active);
            self.generation.fetch_add(1, Ordering::SeqCst);
            std::mem::replace(&mut *active, Active::Cloud(repo))
        };
        if let Active::Cloud(old) = old {
            old.stop_realtime();
        }
        *lock(&self.pending_login) = None;
        self.watch_active();
        self.refresh_org_name();
        self.trigger_pattern_sync();
        self.signal();
        Ok(())
    }

    /// Mangler `entitlements.json` (fx efter en opdatering fra en version, der
    /// ikke gemte den), frøs den fra tt-data's cachede svar, regnet fra det
    /// tidspunkt, svaret blev hentet. Ellers er en cloud-bruger låst
    /// (`NeverVerified`), hvis appen starter offline.
    fn seed_access_cache(&self, repo: &CloudRepo) {
        let now = self.opts.clock.as_ref().map_or_else(Utc::now, |c| c());
        let mut cache = lock(&self.access_cache);
        let Some(seed) = licens::seed_cache(cache.as_ref(), repo.cached_entitlements(), now) else {
            return;
        };
        if let Err(err) = files::store_entitlement_cache(&self.opts.data_dir, &seed) {
            eprintln!("TT: planen kunne ikke gemmes til offline-brug: {err}");
        }
        *cache = Some(seed);
    }

    /// Tilbage til lokal (logud). Cloud-cachen og login ryddes af tt-data.
    fn switch_to_local(self: &Arc<Self>) -> Result<()> {
        let local = open_local(&self.opts.data_dir, &self.device, &self.opts.clock)?;
        self.persist_mode(files::StoredMode::Local)?;
        let old = {
            let mut active = write(&self.active);
            self.generation.fetch_add(1, Ordering::SeqCst);
            std::mem::replace(&mut *active, Active::Local(local))
        };
        if let Active::Cloud(old) = old {
            old.stop_realtime();
        }
        lock(&self.org_name).clear();
        self.watch_active();
        self.signal();
        Ok(())
    }

    /// Lyt på den aktive repo's hændelser i en egen tråd.
    fn watch_active(self: &Arc<Self>) {
        let gen_now = self.generation.load(Ordering::SeqCst);
        let rx = read(&self.active).repo().events().subscribe();
        let weak = Arc::downgrade(self);
        let spawned = std::thread::Builder::new()
            .name("tt-repo-events".into())
            .spawn(move || {
                while let Ok(event) = block_on(rx.recv()) {
                    let Some(shared) = weak.upgrade() else { break };
                    shared.on_event(gen_now, event);
                }
            });
        if let Err(e) = spawned {
            eprintln!("TT: kan ikke lytte på datalagets hændelser: {e}");
        }
    }

    fn on_event(self: &Arc<Self>, gen_of_event: u64, event: Event) {
        if self.generation.load(Ordering::SeqCst) != gen_of_event {
            return;
        }
        match event {
            Event::LoggedOut { reason } if reason != LogoutReason::User => {
                let name = tt_core::edition::EDITION.name;
                let text = if reason == LogoutReason::Revoked {
                    format!("Denne enhed er fjernet fra din konto i {name}. Du bruger nu den lokale version")
                } else {
                    format!("Du er logget ud af {name}. Log ind igen for at hente dine data")
                };
                self.notice(NoticeKind::LoggedOut, &text);
                if let Err(e) = self.switch_to_local() {
                    eprintln!("TT: kunne ikke skifte til lokal tilstand: {e}");
                }
                self.signal();
            }
            Event::DataChanged { ref entities } if entities.contains(&td::Entity::Rules) => {
                // Regler eller mønstre ændret på web: hent dem.
                self.trigger_pattern_sync();
                self.signal();
            }
            Event::LoggedOut { .. }
            | Event::TimerChanged { .. }
            | Event::DataChanged { .. }
            | Event::QueueChanged { .. } => {
                self.signal();
            }
            Event::QueueRejected { message, .. } => {
                self.notice(
                    NoticeKind::QueueRejected,
                    &format!(
                        "{} afviste en ændring: {}. Den er gemt under afviste registreringer, så du kan sende den igen",
                        tt_core::edition::EDITION.name,
                        message.trim_end_matches('.')
                    ),
                );
                self.signal();
            }
            Event::DeadLetterChanged { .. } => self.signal(),
            Event::Offline => {
                self.notice(
                    NoticeKind::Offline,
                    "Du er offline. Ændringer sendes, når forbindelsen er tilbage",
                );
                self.signal();
            }
            Event::Online => {
                self.trigger_pattern_sync();
                self.notice(NoticeKind::Online, "Du er online igen");
                self.signal();
            }
            Event::Realtime { .. } => {}
        }
    }

    /// Henter organisationens navn i baggrunden (kræver forbindelse, men
    /// blokerer aldrig opstart eller login).
    fn refresh_org_name(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        let _ = std::thread::Builder::new()
            .name("tt-org-name".into())
            .spawn(move || {
                let Some(shared) = weak.upgrade() else { return };
                let repo = read(&shared.active).repo();
                if !matches!(&*read(&shared.active), Active::Cloud(_)) {
                    return;
                }
                let found = block_on(async {
                    let session = repo.session().await.ok()?;
                    let orgs = repo.organizations().await.ok()?;
                    let id = session.organization_id?;
                    orgs.into_iter().find(|o| o.id == id).map(|o| o.name)
                });
                if let Some(name) = found {
                    *lock(&shared.org_name) = name;
                    shared.signal();
                }
            });
    }
}

// ---------------------------------------------------------------- Backend

impl Backend for RepoBackend {
    fn mode(&self) -> Mode {
        match &*read(&self.shared.active) {
            Active::Local(_) => Mode::Local,
            Active::Cloud(_) => Mode::Cloud {
                organization: lock(&self.shared.org_name).clone(),
            },
        }
    }

    fn today(&self) -> NaiveDate {
        Local::now().date_naive()
    }

    fn local_now(&self) -> DateTime<Local> {
        self.now().with_timezone(&Local)
    }

    // ---- kunder

    fn customers(&self, include_archived: bool) -> Result<Vec<Customer>> {
        let list = self.run("Kunderne", self.repo().list_clients(include_archived))?;
        Ok(list.iter().map(map::customer).collect())
    }

    fn create_customer(&self, input: CustomerInput) -> Result<Customer> {
        self.gate(Action::Write)?;
        let c = self.run("Kunden", self.repo().create_client(map::new_client(&input)))?;
        Ok(map::customer(&c))
    }

    fn update_customer(&self, id: &str, input: CustomerInput) -> Result<Customer> {
        self.gate(Action::Write)?;
        let repo = self.repo();
        let existing = self.run("Kunden", repo.get_client(id))?;
        let c = self.run(
            "Kunden",
            repo.update_client(id, map::client_patch(&input, &existing)),
        )?;
        Ok(map::customer(&c))
    }

    fn set_customer_archived(&self, id: &str, archived: bool) -> Result<()> {
        self.gate(Action::Write)?;
        let repo = self.repo();
        if archived {
            self.run("Kunden", repo.archive_client(id))
        } else {
            self.run("Kunden", repo.unarchive_client(id))
        }
    }

    // ---- projekter

    fn projects(&self, customer_id: Option<&str>, include_archived: bool) -> Result<Vec<Project>> {
        let list = self.run("Projekterne", self.repo().list_projects(include_archived))?;
        Ok(list
            .iter()
            .filter(|p| include_archived || p.status != td::ProjectStatus::Archived)
            .filter(|p| customer_id.is_none_or(|c| p.client_id.as_deref() == Some(c)))
            .map(map::project)
            .collect())
    }

    fn create_project(&self, input: ProjectInput) -> Result<Project> {
        self.gate(Action::Write)?;
        let p = self.run(
            "Projektet",
            self.repo().create_project(map::new_project(&input)),
        )?;
        Ok(map::project(&p))
    }

    fn update_project(&self, id: &str, input: ProjectInput) -> Result<Project> {
        self.gate(Action::Write)?;
        let p = self.run(
            "Projektet",
            self.repo().update_project(id, map::project_patch(&input)),
        )?;
        Ok(map::project(&p))
    }

    fn set_project_status(&self, id: &str, status: ProjectStatus) -> Result<()> {
        self.gate(Action::Write)?;
        self.run(
            "Projektet",
            self.repo()
                .set_project_status(id, map::to_project_status(status)),
        )
    }

    // ---- poster

    fn entries(&self, range: DateRange) -> Result<Vec<Entry>> {
        let filter = EntryFilter {
            start_date: Some(range.from),
            end_date: Some(range.to),
            ..EntryFilter::default()
        };
        let list = self.run("Posterne", self.repo().list_entries(filter))?;
        let mut v: Vec<Entry> = list.iter().map(map::entry).collect();
        v.sort_by_key(|e| (e.date, e.start));
        Ok(v)
    }

    fn create_entry(&self, input: EntryInput) -> Result<Entry> {
        self.gate(Action::Write)?;
        self.create_entry_with_card(input, CardChoice::Auto)
    }

    fn update_entry(&self, id: &str, input: EntryInput) -> Result<Entry> {
        // Eksisterende tid kan altid rettes, også i en låst app (#10). Men mere
        // tid på en post er ny tid, og den gælder låsen.
        if let Err(locked) = self.gate(Action::Write) {
            self.gate(Action::EditEntry)?;
            let cur = self.run("Posten", self.repo().get_entry(id))?;
            if input.minutes > map::entry(&cur).minutes {
                return Err(locked);
            }
        }
        let e = self.run(
            "Posten",
            self.repo().update_entry(id, map::entry_patch(&input)),
        )?;
        Ok(map::entry(&e))
    }

    fn delete_entry(&self, id: &str) -> Result<()> {
        self.run("Posten", self.repo().delete_entry(id))
    }

    // ---- klippekort

    fn punch_cards(&self, customer_id: Option<&str>) -> Result<Vec<PunchCard>> {
        let today = self.today();
        let list = self.run(
            "Klippekortene",
            self.repo().list_klippekort(customer_id, true),
        )?;
        let mut v: Vec<PunchCard> = list
            .iter()
            .filter(|p| !p.is_archived.unwrap_or(false))
            .map(|p| map::punch_card(p, today))
            .collect();
        v.sort_by_key(|c| (c.purchased, c.id.clone()));
        Ok(v)
    }

    fn create_punch_card(&self, input: PunchCardInput) -> Result<PunchCard> {
        self.gate(Action::Write)?;
        let today = self.today();
        let p = self.run(
            "Klippekortet",
            self.repo()
                .create_klippekort(map::new_punch_card(&input, today)),
        )?;
        Ok(map::punch_card(&p, today))
    }

    fn update_punch_card(&self, id: &str, input: PunchCardInput) -> Result<PunchCard> {
        self.gate(Action::Write)?;
        let today = self.today();
        let p = self.run(
            "Klippekortet",
            self.repo()
                .update_klippekort(id, map::punch_card_patch(&input)),
        )?;
        Ok(map::punch_card(&p, today))
    }

    fn top_up_punch_card(&self, id: &str, minutes: u32) -> Result<PunchCard> {
        self.gate(Action::Write)?;
        let today = self.today();
        let hours = map::minutes_to_hours_precise(minutes);
        let p = self.run(
            "Klippekortet",
            self.repo().top_up_klippekort(id, hours, None),
        )?;
        Ok(map::punch_card(&p, today))
    }

    // ---- opgaver

    fn tasks(&self, project_id: Option<&str>) -> Result<Vec<Task>> {
        let filter = td::TaskFilter {
            project_id: project_id.map(str::to_owned),
            ..Default::default()
        };
        let list = self.run("Opgaverne", self.repo().list_tasks(filter))?;
        Ok(list.iter().map(map::task).collect())
    }

    fn create_task(&self, input: TaskInput) -> Result<Task> {
        self.gate(Action::Write)?;
        let repo = self.repo();
        let mut new = map::new_task(&input);
        if let Some(p) = &new.project_id {
            new.client_id = self.run("Projektet", repo.get_project(p))?.client_id;
        }
        let t = self.run("Opgaven", repo.create_task(new))?;
        Ok(map::task(&t))
    }

    fn update_task(&self, id: &str, input: TaskInput) -> Result<Task> {
        self.gate(Action::Write)?;
        let repo = self.repo();
        let mut patch = map::task_patch(&input);
        // Uændret dato: send ikke fristen, så et klokkeslæt sat i web bevares.
        let tasks = self.run("Opgaven", repo.list_tasks(td::TaskFilter::default()))?;
        if tasks
            .iter()
            .find(|t| t.id == id)
            .is_some_and(|t| map::task(t).due == input.due)
        {
            patch.deadline = None;
        }
        // Kunden følger projektet, som ved oprettelse.
        if let Some(Some(p)) = &patch.project_id {
            patch.client_id = Some(self.run("Projektet", repo.get_project(p))?.client_id);
        }
        let mut t = self.run("Opgaven", repo.update_task(id, patch))?;
        if let Some(status) = input.status
            && map::task(&t).status != status
        {
            self.run(
                "Opgaven",
                repo.set_task_status(id, map::to_task_status(status)),
            )?;
            t.status = map::to_task_status(status);
        }
        Ok(map::task(&t))
    }

    fn set_task_status(&self, id: &str, status: TaskStatus) -> Result<()> {
        self.gate(Action::Write)?;
        self.run(
            "Opgaven",
            self.repo().set_task_status(id, map::to_task_status(status)),
        )
    }

    fn task_lanes(&self) -> Result<Vec<TaskLane>> {
        let lanes = self.run("Tavlens kolonner", self.repo().list_task_lanes())?;
        Ok(lanes.iter().map(map::task_lane).collect())
    }

    fn move_task(&self, id: &str, lane_id: &str) -> Result<()> {
        self.gate(Action::Write)?;
        let input = td::MoveTask {
            task_id: id.to_owned(),
            status_id: lane_id.to_owned(),
            ordered_task_ids: None,
        };
        self.run("Opgaven", self.repo().move_task(input))
    }

    // ---- fakturaer

    fn invoices(&self) -> Result<Vec<Invoice>> {
        let repo = self.repo();
        let list = self.run("Fakturaerne", repo.list_invoices())?;
        if self.is_cloud() {
            // Alle linjer i ét kald (web's linesByInvoice), ikke ét pr.
            // faktura. Fejler det (fx en ældre server), vises listen med web's
            // beløb, og linjerne hentes, når en faktura åbnes (`invoice`).
            let today = self.today();
            let ids = list.iter().map(|i| i.id.clone()).collect();
            let mut out: Vec<Invoice> = match block_on(repo.invoice_lines_many(ids)) {
                Ok(mut by_id) => list
                    .iter()
                    .map(|i| match by_id.remove(&i.id) {
                        Some(lines) => map::invoice(i, &lines, today, None),
                        None => map::invoice_header(i, today, None),
                    })
                    .collect(),
                Err(e) => {
                    eprintln!("TT: fakturalinjer til listen kunne ikke hentes: {e}");
                    list.iter().map(|i| map::invoice_header(i, today, None)).collect()
                }
            };
            self.attach_deliveries(&mut out);
            return Ok(out);
        }
        list.iter()
            .map(|i| self.invoice_with_lines(&*repo, i))
            .collect()
    }

    fn invoice(&self, id: &str) -> Result<Invoice> {
        let repo = self.repo();
        let inv = self.run("Fakturaen", repo.get_invoice(id))?;
        self.invoice_with_lines(&*repo, &inv)
    }

    fn uninvoiced_entries(&self, customer_id: &str) -> Result<Vec<Entry>> {
        let list = self.run("Kunden", self.repo().uninvoiced_entries(customer_id))?;
        let mut v: Vec<Entry> = list.iter().map(map::entry).collect();
        v.sort_by_key(|e| (e.date, e.start));
        Ok(v)
    }

    fn invoice_entries(&self, invoice_id: &str) -> Result<Vec<Entry>> {
        let repo = self.repo();
        let lines = self.run("Fakturaen", repo.invoice_lines(invoice_id))?;
        let mut ids: Vec<&String> = lines
            .iter()
            .filter_map(|l| l.time_entry_id.as_ref())
            .collect();
        ids.sort();
        ids.dedup();
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            // En post, der er slettet i web, må ikke skjule de øvrige.
            if let Ok(e) = self.run("Posten", repo.get_entry(id)) {
                out.push(map::entry(&e));
            }
        }
        out.sort_by_key(|e| (e.date, e.start));
        Ok(out)
    }

    fn create_invoice_draft(&self, customer_id: &str, entry_ids: &[Id]) -> Result<Invoice> {
        self.gate(Action::Write)?;
        let repo = self.repo();
        let input = td::NewInvoiceDraft {
            client_id: customer_id.to_owned(),
            time_entry_ids: entry_ids.to_vec(),
            ..Default::default()
        };
        let inv = self.run("Kunden", repo.create_invoice_draft(input))?;
        self.invoice_with_lines(&*repo, &inv)
    }

    fn update_invoice_lines(&self, id: &str, lines: Vec<InvoiceLine>) -> Result<Invoice> {
        self.gate(Action::Write)?;
        let repo = self.repo();
        let mut data: Vec<td::InvoiceLine> = Vec::new();
        for line in &lines {
            let sort = |data: &Vec<td::InvoiceLine>| data.len() as i32;
            match line.entry_ids.as_slice() {
                [] => data.push(map::to_data_line(line, sort(&data), None, line.minutes)),
                [one] => data.push(map::to_data_line(
                    line,
                    sort(&data),
                    Some(one.clone()),
                    line.minutes,
                )),
                many => {
                    // tt-data har én post pr. linje. En linje med flere poster
                    // deles i én pr. post, hvis minutterne stadig går op.
                    let mut parts = Vec::new();
                    for e in many {
                        let entry = self.run("Posten", repo.get_entry(e))?;
                        parts.push((e.clone(), map::hours_to_minutes(entry.hours)));
                    }
                    let sum: u32 = parts.iter().map(|(_, m)| m).sum();
                    if sum != line.minutes {
                        return Err(BackendError::Validation(format!(
                            "Linjen \"{}\" samler flere poster, og tiden er ændret. Ret tiden på de enkelte poster",
                            line.description
                        )));
                    }
                    for (entry_id, minutes) in parts {
                        data.push(map::to_data_line(
                            line,
                            sort(&data),
                            Some(entry_id),
                            minutes,
                        ));
                    }
                }
            }
        }
        self.run("Fakturaen", repo.save_invoice_lines(id, data))?;
        let inv = self.run("Fakturaen", repo.get_invoice(id))?;
        self.invoice_with_lines(&*repo, &inv)
    }

    fn send_invoice(&self, id: &str, confirmed_to: Option<&str>) -> Result<Invoice> {
        self.gate(Action::Write)?;
        // Porten ligger her og ikke kun i skærmen: uden en bekræftet
        // modtager sender ingen kodesti en mail til kunden.
        let preview = self.invoice_send_preview(id)?;
        // En allerede sendt faktura sendes aldrig igen herfra: efter en
        // usikker fejl kan mailen være gået, og et nyt klik må ikke give
        // kunden en mail nummer to.
        if self.invoice(id)?.status != InvoiceStatus::Draft {
            return Err(BackendError::Validation(
                "Fakturaen er allerede sendt".into(),
            ));
        }
        check_send_confirmation(&preview, confirmed_to)?;
        self.require_sender()?;
        let repo = self.repo();
        let inv = self.run("Fakturaen", repo.send_invoice(id))?;
        let to = preview.sends_mail.then_some(preview.recipient).flatten();
        let mut out = self.invoice_with_lines(&*repo, &inv)?;
        out.delivery = self.record_delivery(&out.id, to);
        Ok(out)
    }

    fn issue_invoice(&self, id: &str) -> Result<Invoice> {
        self.gate(Action::Write)?;
        self.require_sender()?;
        let repo = self.repo();
        // Cloud: kun statusskiftet (ingen mail). Lokalt udstedes altid uden mail.
        let inv = match self.cloud() {
            Some(c) => self.run("Fakturaen", c.mark_invoice_sent(id))?,
            None => self.run("Fakturaen", repo.send_invoice(id))?,
        };
        let mut out = self.invoice_with_lines(&*repo, &inv)?;
        out.delivery = self.record_delivery(&out.id, None);
        Ok(out)
    }

    fn send_reminder(&self, id: &str, confirmed_to: Option<&str>) -> Result<Invoice> {
        self.gate(Action::Write)?;
        let inv = self.invoice(id)?;
        if !can_remind(&inv, &self.mode()) {
            return Err(BackendError::Validation(if self.is_cloud() {
                "Kun sendte og forfaldne fakturaer kan få en påmindelse".into()
            } else {
                "Påmindelser sendes kun, når du er logget ind. Lokalt sendes ingen mail".into()
            }));
        }
        // Samme port som afsendelsen: uden en bekræftet modtager ingen mail.
        let preview = self.invoice_send_preview(id)?;
        check_send_confirmation(&preview, confirmed_to)?;
        let repo = self.repo();
        // Web's `sendEmail` mailer en udstedt faktura igen uden at ændre den.
        let sent = self.run("Fakturaen", repo.send_invoice(id))?;
        let mut out = self.invoice_with_lines(&*repo, &sent)?;
        out.delivery = self.record_delivery(&out.id, preview.recipient);
        Ok(out)
    }

    fn mark_invoice_paid(&self, id: &str, paid: NaiveDate) -> Result<()> {
        self.gate(Action::Write)?;
        self.run("Fakturaen", self.repo().mark_invoice_paid(id, Some(paid)))
            .map(|_| ())
    }

    // ---- rapporter

    fn report(&self, range: DateRange, grouping: ReportGrouping) -> Result<Report> {
        let query = td::ReportQuery {
            start_date: range.from,
            end_date: range.to,
            grouping: map::to_report_grouping(grouping),
            ..Default::default()
        };
        let r = self.run("Rapporten", self.repo().report(query))?;
        Ok(map::report(&r, range, grouping))
    }

    // ---- timer

    fn timer(&self) -> Result<TimerState> {
        let t = self.run("Timeren", self.repo().timer())?;
        Ok(map::timer(&t))
    }

    fn timer_start(&self, target: TimerTarget) -> Result<TimerState> {
        self.gate(Action::StartTimer)?;
        let input = td::StartTimer {
            project_id: target.project_id,
            client_id: target.customer_id,
            task_id: target.task_id,
            description: target.description,
        };
        let t = self.run("Timeren", self.repo().timer_start(input))?;
        Ok(map::timer(&t))
    }

    fn timer_pause(&self) -> Result<TimerState> {
        let t = self.run("Timeren", self.repo().timer_pause())?;
        Ok(map::timer(&t))
    }

    fn timer_resume(&self) -> Result<TimerState> {
        self.gate(Action::Write)?;
        let t = self.run("Timeren", self.repo().timer_resume())?;
        Ok(map::timer(&t))
    }

    /// Skifter mål på den aktive timer uden at stoppe den (tiden bevares).
    /// Et uændret mål skrives ikke.
    fn timer_set_target(&self, target: TimerTarget) -> Result<TimerState> {
        let cur = self.timer()?;
        if cur.status == TimerStatus::Idle {
            return Err(BackendError::Conflict("timeren kører ikke".into()));
        }
        let same = cur.customer_id == target.customer_id
            && cur.project_id == target.project_id
            && cur.task_id == target.task_id
            && cur.description == target.description;
        if same {
            return Ok(cur);
        }
        let input = td::StartTimer {
            project_id: target.project_id,
            client_id: target.customer_id,
            task_id: target.task_id,
            description: target.description,
        };
        let t = self.run("Timeren", self.repo().timer_set_target(input))?;
        Ok(map::timer(&t))
    }

    fn timer_stop(&self) -> Result<Option<Entry>> {
        let out = self.run("Timeren", self.repo().timer_stop(td::StopTimer::default()))?;
        Ok(out.entry.map(|c| map::entry(&c.entry)))
    }

    fn timer_discard(&self) -> Result<()> {
        let input = td::StopTimer {
            discard: true,
            ..Default::default()
        };
        self.run("Timeren", self.repo().timer_stop(input))
            .map(|_| ())
    }

    fn timer_subtract_idle(
        &self,
        subtract_minutes: u32,
        restart: Option<TimerTarget>,
    ) -> Result<IdleSubtraction> {
        // Et stop (Action::EndTimer) er altid tilladt; kortningen sker i
        // samme kald som stoppet, så den kan ikke afvises bagefter.
        self.gate(Action::EndTimer)?;
        let was = block_on(self.repo().timer()).ok();
        let input = td::StopTimer {
            subtract_secs: u64::from(subtract_minutes) * 60,
            ..Default::default()
        };
        let out = self.run("Timeren", self.repo().timer_stop(input))?;
        let entry = out.entry.map(|c| map::entry(&c.entry));
        // Timeren, der netop var i gang, kører videre: ikke en ny
        // registrering, så `Action::StartTimer` gælder ikke. Et andet mål er
        // derimod en ny timer, og den gælder låsen.
        let restart_error = restart.and_then(|target| {
            let same = was.as_ref().is_some_and(|t| {
                (&t.client_id, &t.project_id, &t.task_id)
                    == (&target.customer_id, &target.project_id, &target.task_id)
            });
            if !same && let Err(e) = self.gate(Action::StartTimer) {
                return Some(e.to_string());
            }
            let input = td::StartTimer {
                project_id: target.project_id,
                client_id: target.customer_id,
                task_id: target.task_id,
                description: target.description,
            };
            self.run("Timeren", self.repo().timer_start(input))
                .err()
                .map(|e| e.to_string())
        });
        Ok(IdleSubtraction {
            entry,
            restart_error,
        })
    }

    // ---- forslag

    fn suggestions(&self, date: NaiveDate) -> Result<Vec<Suggestion>> {
        let (customers, projects) = self.catalog()?;
        let detection = &self.shared.opts.detection;
        detection.set_web_catalog(self.web_catalog());
        // Manuelle valg vinder: dagens poster med tidspunkt foreslås ikke igen.
        let entries = self.entries(DateRange {
            from: date,
            to: date,
        })?;
        let logged = entries
            .iter()
            .filter_map(|e| Some((e.start?, e.end?)))
            .collect();
        detection.set_logged_spans(date, logged);
        // Detektionen lærer af aktiviteten inden for brugerens egne poster.
        detection.learn_from_entries(date, &entries);
        // Opgaver til git-gren → opgave. Fejler det, foreslås der uden.
        match self.tasks(None) {
            Ok(tasks) => detection.set_tasks(tasks),
            Err(e) => eprintln!("TT: opgaverne kunne ikke hentes til forslagene: {e}"),
        }
        detection.suggestions(date, &customers, &projects)
    }

    fn observer_card(&self) -> Result<ObserverCard> {
        let (customers, projects) = self.catalog()?;
        let detection = &self.shared.opts.detection;
        detection.set_web_catalog(self.web_catalog());
        detection.observer_card(&customers, &projects)
    }

    fn observer_groups(&self) -> Result<Vec<ObserverGroup>> {
        let (customers, projects) = self.catalog()?;
        let detection = &self.shared.opts.detection;
        detection.set_web_catalog(self.web_catalog());
        detection.observer_groups(&customers, &projects)
    }

    fn answer_observer(&self, group_id: &str, reply: ObserverReply) -> Result<()> {
        let reply = match reply {
            ObserverReply::NewCustomer { name } => {
                let name = name.trim().to_string();
                if name.is_empty() {
                    return Err(BackendError::Validation("Kunden skal have et navn".into()));
                }
                // Findes spørgsmålet ikke længere, oprettes kunden ikke.
                if !self.observer_groups()?.iter().any(|g| g.id == group_id) {
                    return Err(BackendError::Other(
                        "Spørgsmålet er ændret, mens du svarede. Se det nye.".into(),
                    ));
                }
                let customer = self.create_customer(CustomerInput {
                    name,
                    email: None,
                    hourly_rate: None,
                    cvr: None,
                    ..Default::default()
                })?;
                ObserverReply::Target {
                    customer_id: customer.id,
                    project_id: None,
                }
            }
            other => other,
        };
        if matches!(reply, ObserverReply::Target { .. }) {
            self.gate(Action::Write)?;
        }
        let (customers, projects) = self.catalog()?;
        let detection = &self.shared.opts.detection;
        detection.set_web_catalog(self.web_catalog());
        detection.observer_answer(group_id, &reply, &customers, &projects)?;
        self.shared.trigger_pattern_sync();
        Ok(())
    }

    fn export_test_set(&self, dir: &std::path::Path) -> Result<std::path::PathBuf> {
        const DAYS: u32 = 30;
        let (customers, projects) = self.catalog()?;
        let to = self.today();
        let from = to - chrono::Duration::days(i64::from(DAYS));
        let entries = self.entries(DateRange { from, to })?;
        let detection = &self.shared.opts.detection;
        detection.set_web_catalog(self.web_catalog());
        let json = detection.export_test_set(&entries, &customers, &projects, DAYS)?;
        let path = dir.join(format!("timetrack-testsaet-{}.json", to.format("%Y-%m-%d")));
        std::fs::write(&path, json + "\n")
            .map_err(|e| BackendError::Other(format!("Filen kunne ikke gemmes: {e}")))?;
        Ok(path)
    }

    fn confirm_suggestion(
        &self,
        id: &str,
        correction: Option<SuggestionCorrection>,
    ) -> Result<Entry> {
        self.gate(Action::Write)?;
        let detection = &self.shared.opts.detection;
        let mut input = detection.entry_for(id, correction.as_ref())?;
        // Forslaget har ingen beskrivelse, og både web's time.create og den
        // lokale database kræver en (som timer-stop og update i tt-data).
        if input.description.trim().is_empty() {
            input.description = "Uden beskrivelse".into();
        }
        let entry = self.create_entry(input)?;
        detection.confirmed(id, correction.as_ref(), &entry.id);
        self.shared.trigger_pattern_sync();
        Ok(entry)
    }

    fn reject_suggestion(&self, id: &str) -> Result<()> {
        self.shared.opts.detection.reject(id)?;
        self.shared.trigger_pattern_sync();
        Ok(())
    }

    fn confirm_day(&self, date: NaiveDate) -> Result<Vec<Entry>> {
        self.gate(Action::Write)?;
        let mut created = Vec::new();
        for s in self.suggestions(date)? {
            created.push(self.confirm_suggestion(&s.id, None)?);
        }
        Ok(created)
    }

    // ---- aktivitet

    fn activity_day(&self, date: NaiveDate) -> Result<ActivityDay> {
        self.activity_day_impl(date)
    }

    fn assign_activity(&self, date: NaiveDate, input: AssignActivity) -> Result<AssignResult> {
        self.gate(Action::Write)?;
        self.assign_activity_impl(date, input)
    }

    fn activity_not_work(&self, _date: NaiveDate, block_ids: &[Id]) -> Result<()> {
        self.shared
            .opts
            .detection
            .activity_not_work(&block_spans(block_ids)?)
    }

    fn merge_activity(&self, date: NaiveDate, block_ids: &[Id]) -> Result<()> {
        self.merge_activity_impl(date, block_ids)
    }

    fn split_activity(&self, date: NaiveDate, block_id: &str, at: chrono::NaiveTime) -> Result<()> {
        let span = block_span(block_id).ok_or_else(|| BackendError::NotFound("Blokken".into()))?;
        let at = local_ts(date, at)
            .ok_or_else(|| BackendError::Validation("Ugyldigt tidspunkt".into()))?;
        self.shared.opts.detection.split_activity(span, at)
    }

    fn delete_activity(&self, _date: NaiveDate, block_ids: &[Id]) -> Result<()> {
        self.shared
            .opts
            .detection
            .delete_activity(&block_spans(block_ids)?)
    }

    fn delete_all_activity(&self) -> Result<()> {
        self.shared.opts.detection.delete_all_activity()
    }

    fn activity_storage(&self) -> Result<ActivityStorage> {
        self.shared.opts.detection.activity_storage()
    }

    fn stored_exclusions(&self) -> Result<Vec<StoredExclusion>> {
        self.shared.opts.detection.stored_exclusions()
    }

    fn remove_stored_exclusion(&self, id: i64) -> Result<()> {
        self.shared.opts.detection.remove_stored_exclusion(id)
    }

    // ---- ux-vaelger: regler (repo/regler.rs)

    fn rule_scopes(&self, date: NaiveDate, block_ids: &[Id]) -> Result<Vec<RuleScope>> {
        self.rule_scopes_impl(date, block_ids)
    }

    fn create_rule(
        &self,
        scope: &RuleScope,
        customer_id: Option<Id>,
        project_id: Option<Id>,
    ) -> Result<Id> {
        self.create_rule_impl(scope, customer_id, project_id)
    }

    fn apply_rule_backward(
        &self,
        scope: &RuleScope,
        customer_id: Option<Id>,
        project_id: Option<Id>,
    ) -> Result<BackwardResult> {
        self.apply_rule_backward_impl(scope, customer_id, project_id)
    }

    fn rule_rows(&self) -> Result<Vec<RuleRow>> {
        self.rule_rows_impl()
    }

    fn set_rule_target(
        &self,
        row: &RuleRow,
        customer_id: Option<Id>,
        project_id: Option<Id>,
    ) -> Result<()> {
        self.set_rule_target_impl(row, customer_id, project_id)
    }

    fn set_rule_active(&self, row: &RuleRow, active: bool) -> Result<()> {
        self.gate(licens::Action::Write)?;
        self.shared
            .opts
            .detection
            .set_rule_disabled(&row.id, !active)
    }

    fn delete_rule_row(&self, row: &RuleRow) -> Result<()> {
        self.delete_rule_row_impl(row)
    }

    // ---- screens-a

    fn create_entry_with_card(&self, input: EntryInput, card: CardChoice) -> Result<Entry> {
        self.gate(Action::Write)?;
        let repo = self.repo();
        let mut new = map::new_entry(&input);
        let mut auto = false;
        match card {
            CardChoice::Card(id) => new.prepaid_package_id = Some(id),
            // Intet kort: sagt udtrykkeligt til web (`noPrepaid`), så serveren
            // heller ikke selv vælger et.
            CardChoice::None => new.no_prepaid = true,
            CardChoice::Auto => {
                // Som web's auto-select: udløb vurderes mod i dag, ikke mod postens
                // dato. Ellers valgte en bagudrettet post et kort, der siden er
                // udløbet, og web afviste trækket.
                new.prepaid_package_id = self.auto_card(&*repo, &input.customer_id, self.today());
                auto = new.prepaid_package_id.is_some();
                // Også når posten ligger i køen: afviser web kortet, gemmes den uden.
                new.prepaid_auto = auto;
            }
        }
        let created = match block_on(repo.create_entry(new.clone())) {
            // Et automatisk valgt kort uden saldo nok må ikke koste posten.
            Err(td::DataError::Validation(_)) if auto => {
                new.prepaid_package_id = None;
                self.run("Posten", repo.create_entry(new))?
            }
            other => other.map_err(|e| map::error(e, "Posten"))?,
        };
        Ok(map::entry(&created.entry))
    }

    /// Cloud: web's historik (`klippekort.get` → `usageHistory`). Lokalt
    /// udledt af posterne: de poster på kundens klippekort, der trak fra
    /// kortet. Brugt tid, der ikke kan forklares af poster (importeret
    /// saldo), vises som én linje uden post.
    fn punch_card_usage(&self, card_id: &str) -> Result<Vec<PunchUsage>> {
        let repo = self.repo();
        let today = self.today();
        match block_on(repo.klippekort_usage(card_id)) {
            Ok(rows) => return Ok(rows.iter().map(|u| map::punch_usage(u, today)).collect()),
            // Lokalt, og offline i cloud (udledningen læser fra cachen).
            Err(td::DataError::Unsupported(_)) => {}
            Err(e) if e.is_transient() => {}
            Err(e) => return Err(map::error(e, "Klippekortet")),
        }
        let cards = self.run("Klippekortet", repo.list_klippekort(None, true))?;
        let card = cards
            .iter()
            .find(|c| c.id == card_id)
            .ok_or_else(|| BackendError::NotFound("Klippekortet".into()))?;
        let filter = EntryFilter {
            client_id: Some(card.client_id.clone()),
            ..EntryFilter::default()
        };
        let entries = self.run("Posterne", repo.list_entries(filter))?;
        let mut usage: Vec<PunchUsage> = entries
            .iter()
            .filter(|e| e.prepaid_package_id.as_deref() == Some(card_id))
            .map(|e| PunchUsage {
                entry_id: Some(e.id.clone()),
                date: e.date,
                minutes: map::hours_to_minutes(e.hours),
                description: e.description.clone().unwrap_or_default(),
            })
            .collect();
        let explained: u32 = usage.iter().map(|u| u.minutes).sum();
        let used = map::hours_to_minutes(card.used_hours);
        if used > explained {
            usage.push(PunchUsage {
                entry_id: None,
                date: card
                    .purchase_date
                    .map(tt_core::klippekort::expiry_date)
                    .unwrap_or(today),
                minutes: used - explained,
                description: "Brugt før historikken".into(),
            });
        }
        usage.sort_by_key(|u| std::cmp::Reverse((u.date, u.entry_id.clone())));
        Ok(usage)
    }

    // ---- licens og adgang

    fn access(&self) -> Access {
        self.compute_access(None)
    }

    fn refresh_access(&self) -> Access {
        let now = self.now();
        let Some(cloud) = self.cloud() else {
            let _g = lock(&self.shared.files);
            let today = now.with_timezone(&Local).date_naive();
            if let Err(e) = files::touch_last_seen(self.dir(), today) {
                eprintln!("TT: licensens dato kunne ikke gemmes: {e}");
            }
            drop(_g);
            return self.compute_access(None);
        };
        // tt-data svarer med det sidst kendte, når web ikke kan nås. Det svar er
        // ikke en bekræftelse, så tidsstemplet må kun flyttes, når kaldet gik
        // igennem (datalaget markerer sig selv offline, når det fejler).
        let online = match block_on(cloud.entitlements()) {
            Ok(e) if cloud.is_online() => {
                self.store_entitlements(e);
                true
            }
            _ => false,
        };
        {
            // Husk, at vi har set nu: et ur, der stilles tilbage, forlænger ikke respiten.
            let mut cache = lock(&self.shared.access_cache);
            if let Some(c) = cache.as_mut() {
                let before = c.last_seen;
                c.observe(now);
                if c.last_seen != before {
                    let _ = files::store_entitlement_cache(self.dir(), c);
                }
            }
        }
        self.compute_access(Some(online))
    }

    // ---- screens-b: konto, indstillinger, login, licens

    fn account(&self) -> Result<Account> {
        let cloud = match &*read(&self.shared.active) {
            Active::Cloud(c) => Some(c.clone()),
            Active::Local(_) => None,
        };
        let Some(cloud) = cloud else {
            let file = files::load_license(self.dir())?;
            let license = file.current(self.today());
            return Ok(Account {
                mode: Mode::Local,
                email: None,
                plan: None,
                entitlements: vec![],
                license,
                trial_available: file.trial_started.is_none() && file.lifetime.is_none(),
            });
        };
        let session = self.run("Kontoen", cloud.session())?;
        // Planen er kun til visning: er web utilgængelig, vises kontoen uden.
        let ent = match block_on(cloud.entitlements()) {
            Ok(e) => {
                // Et svar fra datalagets cache (offline) er ingen bekræftelse.
                if cloud.is_online() {
                    self.store_entitlements(e.clone());
                }
                e
            }
            Err(td::DataError::Unauthorized) => return Err(BackendError::Unauthorized),
            Err(_) => td::Entitlements::default(),
        };
        if let Ok(orgs) = block_on(cloud.organizations())
            && let Some(id) = &session.organization_id
            && let Some(o) = orgs.iter().find(|o| &o.id == id)
        {
            *lock(&self.shared.org_name) = o.name.clone();
        }
        Ok(Account {
            mode: self.mode(),
            email: session.user.map(|u| u.email),
            plan: ent
                .plan
                .as_ref()
                .and_then(|p| p.name.clone().or_else(|| p.tier.clone())),
            entitlements: entitlement_rows(ent.limits.as_ref(), ent.usage.as_ref()),
            license: None,
            trial_available: false,
        })
    }

    fn logout(&self) -> Result<()> {
        let cloud = match &*read(&self.shared.active) {
            Active::Cloud(c) => Some(c.clone()),
            Active::Local(_) => None,
        };
        let Some(cloud) = cloud else { return Ok(()) };
        self.run("Kontoen", cloud.logout())?;
        self.shared.switch_to_local()
    }

    fn settings(&self) -> Result<Settings> {
        let _g = lock(&self.shared.files);
        files::load_settings(self.dir())
    }

    fn save_settings(&self, settings: Settings) -> Result<Settings> {
        validate_settings(&settings)?;
        {
            let _g = lock(&self.shared.files);
            files::store_settings(self.dir(), &settings)?;
        }
        self.apply_settings(&settings);
        Ok(settings)
    }

    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        self.shared.opts.detection.ai_models()
    }

    fn ai_problem(&self) -> Option<String> {
        self.shared.opts.detection.ai_problem()
    }

    fn download_model(&self, id: &str) -> Result<()> {
        self.shared.opts.detection.download_model(id)
    }

    fn model_progress(&self, id: &str) -> Option<ModelProgress> {
        self.shared.opts.detection.model_progress(id)
    }

    fn cancel_model_download(&self, id: &str) {
        self.shared.opts.detection.cancel_model_download(id)
    }

    fn delete_model(&self, id: &str) -> Result<()> {
        self.shared.opts.detection.delete_model(id)
    }

    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        self.shared.opts.detection.discover_ai_servers()
    }

    fn found_models(&self) -> Result<FoundModels> {
        self.shared.opts.detection.found_models()
    }

    fn rescan_models(&self) -> Result<FoundModels> {
        self.shared.opts.detection.rescan_models()
    }

    fn start_ollama(&self) -> Result<()> {
        self.shared.opts.detection.start_ollama()
    }

    fn set_cloud_ai_key(&self, provider: CloudAiProvider, key: String) -> Result<()> {
        self.shared.opts.detection.set_cloud_ai_key(provider, key)?;
        self.update_cloud_keys(|keys| {
            if !keys.contains(&provider) {
                keys.push(provider);
            }
        })
    }

    fn remove_cloud_ai_key(&self, provider: CloudAiProvider) -> Result<()> {
        self.shared.opts.detection.remove_cloud_ai_key(provider)?;
        self.update_cloud_keys(|keys| keys.retain(|k| *k != provider))
    }

    fn server_url(&self) -> Result<String> {
        Ok(self.shared.web_url())
    }

    /// Vælger server til næste login. Tom eller standardadressen: udgavens
    /// standard. Kun mens man er lokal: en cloud-session hører til sin server.
    fn set_server_url(&self, url: Option<&str>) -> Result<String> {
        let chosen = match url.map(str::trim).filter(|u| !u.is_empty()) {
            None => None,
            Some(u) => Some(
                tt_core::edition::normalize_server_url(u)
                    .map_err(|e| BackendError::Validation(crate::screens::login::server_url_error(e).into()))?,
            ),
        };
        let _g = lock(&self.shared.files);
        let mut state = files::load_state(self.dir()).unwrap_or_default();
        if state.mode == files::StoredMode::Cloud {
            return Err(BackendError::Validation(crate::i18n::t("login.server.err.logged_in").into()));
        }
        let default = self.shared.opts.web_url.trim_end_matches('/');
        state.server_url = chosen.filter(|u| u != default);
        files::save_state(self.dir(), &state)?;
        Ok(state.server_url.unwrap_or_else(|| self.shared.opts.web_url.clone()))
    }

    fn begin_login(&self) -> Result<LoginStart> {
        let repo = self.shared.cloud_repo()?;
        let url = repo.begin_login();
        let state = state_from_url(&url)
            .ok_or_else(|| BackendError::Other("Login-adressen mangler state".into()))?;
        *lock(&self.shared.pending_login) = Some(PendingLogin {
            repo,
            state: state.clone(),
        });
        Ok(LoginStart { url, state })
    }

    /// `code` er koden fra deep linket (UI'et har tjekket `state`), eller hele
    /// linket `timetrack://auth/callback?code=…&state=…`. tt-data tjekker
    /// `state` igen og vil have hele linket.
    fn complete_login(&self, code: &str) -> Result<Account> {
        let (repo, state) = {
            let pending = lock(&self.shared.pending_login);
            let p = pending.as_ref().ok_or_else(|| {
                BackendError::Validation("Login er ikke startet. Prøv at logge ind igen".into())
            })?;
            (p.repo.clone(), p.state.clone())
        };
        // Et forkert link afbryder ikke loginet: `pending_login` bliver stående.
        block_on(repo.complete_login(&callback_url(code, &state)))
            .map_err(|e| map::error(e, "Kontoen"))?;
        self.shared.activate_cloud(repo, true)?;
        self.account()
    }

    fn activate_license(&self, key: &str) -> Result<License> {
        if !license_key_format_ok(key) {
            return Err(BackendError::Validation(
                "Nøglen skal se ud som TT-XXXX-XXXX-XXXX-XXXX".into(),
            ));
        }
        files::activate_online(&files::ActivationRequest {
            base_url: &self.shared.opts.license_url,
            key,
            machine_id: &self.shared.device.device_id,
            device_name: &self.shared.device.device_name,
        })?;
        let _g = lock(&self.shared.files);
        files::save_lifetime(self.dir(), key, Utc::now(), self.today())
    }

    fn start_trial(&self) -> Result<License> {
        let _g = lock(&self.shared.files);
        files::start_trial(self.dir(), self.now().with_timezone(&Local).date_naive())
    }

    fn permissions(&self) -> Result<Permissions> {
        self.shared.opts.detection.permissions()
    }

    fn request_permission(&self, permission: Permission) -> Result<PermissionState> {
        self.shared.opts.detection.request_permission(permission)
    }

    fn import_local_to_cloud(&self, dry_run: bool) -> Result<ImportReport> {
        let (local, cloud) = match &*read(&self.shared.active) {
            Active::Local(l) => (l.clone(), None),
            Active::Cloud(c) => (
                open_local(self.dir(), &self.shared.device, &self.shared.opts.clock)?,
                Some(c.clone()),
            ),
        };
        let bundle = td::import::export_local(&local, &self.shared.device.device_id, Utc::now())
            .map_err(|e| map::error(e, "Den lokale database"))?;
        let local_report = td::import::dry_run(&bundle);
        if !local_report.can_import() {
            return Err(BackendError::Validation(format!(
                "Den lokale database kan ikke importeres: {}",
                local_report.errors.join("; ")
            )));
        }
        let from_counts =
            |c: &td::import::ImportCounts, skipped: usize, warnings: Vec<String>| ImportReport {
                dry_run,
                customers: c.clients as u32,
                projects: c.projects as u32,
                entries: c.time_entries as u32,
                punch_cards: c.klippekort as u32,
                tasks: c.tasks as u32,
                invoices: c.invoices as u32,
                skipped: skipped as u32,
                warnings,
                ..Default::default()
            };
        let Some(cloud) = cloud else {
            if !dry_run {
                return Err(BackendError::Validation(
                    "Log ind for at importere til din konto".into(),
                ));
            }
            return Ok(from_counts(&local_report.counts, 0, local_report.warnings));
        };
        let result = self.run("Importen", cloud.import_bundle(&bundle, dry_run))?;
        let mut warnings = local_report.warnings;
        warnings.extend(result.warnings.iter().cloned());
        // Afviste elementer er ikke flyttet: importen er først færdig, når
        // alt er kommet med (et nyt forsøg opretter intet to gange).
        let failed = result.failed.total();
        if !dry_run && failed == 0 {
            let _g = lock(&self.shared.files);
            let mut state = files::load_state(self.dir())?;
            state.imported_at = Some(Utc::now());
            files::save_state(self.dir(), &state)?;
        }
        Ok(ImportReport {
            failed: failed as u32,
            errors: result.errors.clone(),
            ..from_counts(&result.created, result.skipped.total(), warnings)
        })
    }

    // ---- gendan (backend/repo/gendan.rs)

    fn invoice_profile(&self) -> Result<Option<InvoiceProfile>> {
        self.gendan_invoice_profile()
    }

    fn save_invoice_profile(&self, profile: InvoiceProfile) -> Result<InvoiceProfile> {
        self.gendan_save_invoice_profile(profile)
    }

    fn update_invoice_details(&self, id: &str, details: InvoiceDetails) -> Result<Invoice> {
        self.gendan_update_invoice_details(id, details)
    }

    fn delete_invoice_draft(&self, id: &str) -> Result<()> {
        self.gendan_delete_invoice_draft(id)
    }

    fn web_invoice_totals(&self, id: &str) -> Result<Option<WebInvoiceTotals>> {
        let Some(c) = self.cloud() else { return Ok(None) };
        let t = block_on(c.invoice_totals(id))
            .map_err(|e| map::web_invoice_error(e, map::WebInvoicePart::Totals))?;
        Ok(Some(map::web_invoice_totals(&t)))
    }

    fn web_invoice_pdf(&self, id: &str) -> Result<Option<Vec<u8>>> {
        let Some(c) = self.cloud() else { return Ok(None) };
        let bytes =
            block_on(c.invoice_pdf(id)).map_err(|e| map::web_invoice_error(e, map::WebInvoicePart::Pdf))?;
        // En proxy eller login-side kan svare 200 med HTML: gem kun en PDF.
        if !bytes.starts_with(b"%PDF-") {
            return Err(map::web_invoice_error(
                tt_data::DataError::InvalidResponse("ikke en PDF".into()),
                map::WebInvoicePart::Pdf,
            ));
        }
        Ok(Some(bytes))
    }

    fn archived_punch_cards(&self) -> Result<Vec<PunchCard>> {
        let today = self.today();
        let list = self.run("Klippekortene", self.repo().list_klippekort(None, true))?;
        Ok(list
            .iter()
            .filter(|p| p.is_archived.unwrap_or(false))
            .map(|p| map::punch_card(p, today))
            .collect())
    }

    fn set_punch_card_archived(&self, id: &str, archived: bool) -> Result<()> {
        self.gendan_set_punch_card_archived(id, archived)
    }

    fn delete_punch_card(&self, id: &str) -> Result<()> {
        self.gendan_delete_punch_card(id)
    }

    fn export_backup(&self, dir: &std::path::Path) -> Result<PathBuf> {
        self.gendan_export_backup(dir)
    }

    fn inspect_backup(&self, path: &std::path::Path) -> Result<BackupSummary> {
        gendan::inspect_backup(path)
    }

    fn restore_backup(&self, path: &std::path::Path) -> Result<RestoreResult> {
        self.gendan_restore_backup(path)
    }

    // ---- afviste registreringer (dead-letter)

    fn rejected_count(&self) -> usize {
        self.rejected_source().map_or(0, |c| c.dead_letter_count())
    }

    fn rejected(&self) -> Result<Vec<Rejected>> {
        let Some(c) = self.rejected_source() else {
            return Ok(Vec::new());
        };
        let list = c
            .dead_letters()
            .map_err(|e| map::error(e, "De afviste registreringer"))?;
        Ok(list.iter().map(map_rejected).collect())
    }

    fn retry_rejected(&self, id: Option<&str>) -> Result<RetryResult> {
        // Kræver login: logget ud kan de ses og eksporteres, men ikke sendes.
        let Some(c) = self.cloud() else {
            return Err(BackendError::Unauthorized);
        };
        let r = self.run("Registreringen", c.retry_dead_letters(id))?;
        Ok(RetryResult {
            sent: r.sent,
            rejected: r.rejected,
            queued: r.queued,
        })
    }

    fn discard_rejected(&self, id: &str) -> Result<()> {
        let Some(c) = self.rejected_source() else {
            return Err(BackendError::NotFound("Registreringen".into()));
        };
        c.discard_dead_letter(id)
            .map_err(|e| map::error(e, "Registreringen"))
    }

    fn rejected_csv(&self) -> Result<String> {
        match self.rejected_source() {
            Some(c) => c
                .dead_letters_csv()
                .map_err(|e| map::error(e, "De afviste registreringer")),
            None => Ok(tt_data::unsynced_csv::write(&[])),
        }
    }
}

/// En afvist registrering fra tt-data som UI-type.
fn map_rejected(d: &tt_data::DeadLetter) -> Rejected {
    let entry = d.entry().map(|e| map::entry(&e));
    Rejected {
        id: d.op_id().to_owned(),
        kind: d.kind().to_owned(),
        subject: d.subject(),
        date: entry.as_ref().map(|e| e.date),
        start: entry.as_ref().and_then(|e| e.start),
        end: entry.as_ref().and_then(|e| e.end),
        minutes: entry.as_ref().map(|e| e.minutes),
        description: entry
            .as_ref()
            .map(|e| e.description.clone())
            .filter(|s| !s.is_empty()),
        customer: d.client_name.clone(),
        project: d.project_name.clone(),
        error: d.error_message.clone(),
        rejected_at: d.rejected_at.with_timezone(&Local),
    }
}

impl RepoBackend {
    /// Hvor de afviste ligger: cloud-repo'et, eller (logget ud) cachen på
    /// disken, læst uden login, så de kan ses, eksporteres og kasseres.
    fn rejected_source(&self) -> Option<CloudRepo> {
        if let Some(c) = self.cloud() {
            return Some(c);
        }
        let path = self.dir().join("cache.db");
        if !path.exists() {
            return None;
        }
        let mut cfg = CloudConfig::new(self.shared.web_url(), self.shared.device.clone());
        cfg.cache_path = Some(path);
        CloudRepo::new(cfg, Arc::new(td::MemorySecretStore::new())).ok()
    }

    fn apply_settings(&self, settings: &Settings) {
        let mut applied = lock(&self.shared.settings_applied);
        self.shared.opts.detection.apply_settings(settings);
        *applied += 1;
    }

    fn update_cloud_keys(&self, f: impl FnOnce(&mut Vec<CloudAiProvider>)) -> Result<()> {
        let settings = {
            let _g = lock(&self.shared.files);
            let mut s = files::load_settings(self.dir())?;
            f(&mut s.ai.cloud_keys);
            files::store_settings(self.dir(), &s)?;
            s
        };
        self.apply_settings(&settings);
        Ok(())
    }
}

// ---------------------------------------------------------------- plan og grænser

/// Dansk navn på kendte grænser; resten gøres læseligt ud fra nøglen.
fn limit_label(base: &str) -> String {
    match base {
        "activeClients" => "Aktive kunder".into(),
        "clients" => "Kunder".into(),
        "projects" => "Projekter".into(),
        "devices" => "Enheder".into(),
        "users" | "members" | "seats" => "Brugere".into(),
        "invoicesPerMonth" | "invoicesMonth" => "Fakturaer pr. måned".into(),
        "klippekort" => "Klippekort".into(),
        other => {
            let mut words = String::new();
            for (i, c) in other.chars().enumerate() {
                if c.is_uppercase() && i > 0 {
                    words.push(' ');
                }
                words.extend(c.to_lowercase());
            }
            let mut chars = words.chars();
            match chars.next() {
                Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        }
    }
}

/// Planens grænser fra web (`limits.maxActiveClients`, `usage.activeClients` …)
/// som rækker til kontosiden. Kun tal-grænser med `max`-præfiks tages med.
/// Web's `entitlements.get` sender `limits: { maxActiveClients, maxSeats }`
/// og `usage: { activeClients }` (fra `subscription.getDetails`). Brugte
/// pladser sendes ikke, så de vises som 0.
fn entitlement_rows(
    limits: Option<&serde_json::Value>,
    usage: Option<&serde_json::Value>,
) -> Vec<Entitlement> {
    let Some(limits) = limits.and_then(|l| l.as_object()) else {
        return vec![];
    };
    let number = |v: Option<&serde_json::Value>| v.and_then(|v| v.as_f64());
    limits
        .iter()
        .filter_map(|(key, value)| {
            let rest = key
                .strip_prefix("max")
                .filter(|r| r.chars().next().is_some_and(char::is_uppercase))?;
            let mut chars = rest.chars();
            let base = chars.next()?.to_lowercase().collect::<String>() + chars.as_str();
            let used = number(
                usage
                    .and_then(|u| u.get(&base))
                    .or_else(|| usage.and_then(|u| u.get(key))),
            )
            .unwrap_or(0.0)
            .max(0.0) as u32;
            // null, manglende og negative tal betyder ubegrænset.
            let limit = match value {
                serde_json::Value::Number(n) => n.as_f64().filter(|l| *l >= 0.0).map(|l| l as u32),
                _ => None,
            };
            Some(Entitlement {
                key: base.clone(),
                label: limit_label(&base),
                used,
                limit,
            })
        })
        .collect()
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests;
