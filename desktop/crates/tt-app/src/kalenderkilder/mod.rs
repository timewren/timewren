//! Kalenderkilder som forslag (spec: kalender og møder).
//!
//! Aftaler læses fra en iCal/ICS-adresse (som i 0.2.22) og på macOS fra
//! systemets kalender (EventKit). Der skrives aldrig til en kalender.
//! Aftalerne bliver til forslag på Hjem ved siden af detektionens forslag
//! ([`CalendarDetection`]) og kobles til kunde/projekt via lærte mønstre,
//! deltagernes e-maildomæne mod kundens domæner og navne i titlen
//! ([`kobling`]). Private og fortrolige aftaler skjules helt.
//!
//! [`Kalender`] er det fælles objekt: aftalerne i hukommelsen, de lærte
//! koblinger, hvilke forslag der er klaret, og mødedetektionen ([`crate::moeder`]).
//! Det ligger i detektionslaget: kun forslag og færdige møder når UI'et.

pub mod ics;
pub mod kobling;
#[cfg(target_os = "macos")]
pub mod eventkit;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use chrono::{DateTime, Duration, Local, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};

use crate::backend::services::{Detection, IdleRx, ChangeRx, PatternSyncReport, PatternWeb, WebCatalog};
use crate::backend::{
    CloudAiProvider, Customer, EntryInput, FoundModels, Id, LocalAiServer, LocalModel, ModelProgress,
    Permission, PermissionState, Permissions, Project, Result, Settings, Suggestion,
    SuggestionCorrection, BackendError,
};
use crate::moeder::{FinishedMeeting, Foreground, MeetingDetector, MeetingSettings};

pub use kobling::{Catalog, Learned, Match, MatchReason};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Hvor ofte kilderne hentes igen.
pub const REFRESH: Duration = Duration::minutes(15);
/// Aftaler hentes for dagene fra `PAST_DAYS` tilbage til i morgen.
const PAST_DAYS: i64 = 14;
/// Prefiks på forslagenes id, så `CalendarDetection` kender sine egne.
pub const ID_PREFIX: &str = "kal:";
/// Et detektionsforslag skjules, når så stor en del af det er dækket af en
/// kalenderaftale eller et registreret møde (ellers ses samme tid to gange).
const COVERED: f64 = 0.8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SourceKind {
    Ics,
    EventKit,
    Web,
}

/// Én forekomst af en aftale.
#[derive(Clone, Debug, PartialEq)]
pub struct CalendarEvent {
    /// Kilde, UID og start: unikt også for gentagne aftaler.
    pub id: String,
    pub title: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub all_day: bool,
    /// Deltagernes og arrangørens e-mails (små bogstaver).
    pub attendees: Vec<String>,
    /// `CLASS:PRIVATE`/`CONFIDENTIAL`: vises aldrig og bruges ikke.
    pub private: bool,
    pub source: SourceKind,
}

impl CalendarEvent {
    fn minutes(&self) -> i64 {
        (self.end - self.start).num_minutes()
    }

    /// Kan aftalen blive til et forslag eller kobles til et møde?
    fn usable(&self) -> bool {
        !self.private && !self.all_day && (5..=12 * 60).contains(&self.minutes())
    }
}

/// Indstillinger → Kalender.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CalendarSettings {
    /// iCal/ICS-adresse (`https://` eller `webcal://`). Fra 0.2's `ical_url`.
    pub ics_url: Option<String>,
    /// macOS: systemets kalender (EventKit). Kræver tilladelse.
    pub system_calendar: bool,
    /// Aftaler som forslag på Hjem.
    pub suggestions: bool,
    pub meetings: MeetingSettings,
}

impl Default for CalendarSettings {
    fn default() -> Self {
        CalendarSettings {
            ics_url: None,
            system_calendar: false,
            suggestions: true,
            meetings: MeetingSettings::default(),
        }
    }
}

impl CalendarSettings {
    pub fn validate(&self) -> Result<()> {
        if let Some(u) = self.ics_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
            let u = ics::normalize_url(u);
            if !u.starts_with("https://") {
                return Err(BackendError::Validation(
                    crate::i18n::t("kalenderkilder.err.url").into(),
                ));
            }
        }
        self.meetings.validate()
    }
}

/// En kilde til aftaler.
pub trait CalendarSource: Send + Sync {
    /// Stabil nøgle (indgår i aftalernes id).
    fn key(&self) -> String;
    fn events(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> std::result::Result<Vec<CalendarEvent>, String>;
}

/// FNV-1a: stabil på tværs af versioner (id'erne gemmes i `klaret.json`).
fn short_hash(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{:08x}", h as u32)
}

pub type Fetch = Arc<dyn Fn(&str) -> std::result::Result<String, String> + Send + Sync>;

pub struct IcsSource {
    url: String,
    fetch: Fetch,
}

impl IcsSource {
    pub fn new(url: &str) -> Self {
        Self::with_fetch(url, Arc::new(ics::fetch))
    }

    pub fn with_fetch(url: &str, fetch: Fetch) -> Self {
        IcsSource {
            url: ics::normalize_url(url),
            fetch,
        }
    }
}

impl CalendarSource for IcsSource {
    fn key(&self) -> String {
        format!("ics{}", short_hash(&self.url))
    }

    fn events(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> std::result::Result<Vec<CalendarEvent>, String> {
        let text = (self.fetch)(&self.url)?;
        Ok(ics::parse(&text, &self.key(), from, to))
    }
}

pub type SourceFactory = Box<dyn Fn(&CalendarSettings) -> Vec<Arc<dyn CalendarSource>> + Send + Sync>;

/// De rigtige kilder efter indstillingerne.
pub fn native_sources(s: &CalendarSettings) -> Vec<Arc<dyn CalendarSource>> {
    let mut v: Vec<Arc<dyn CalendarSource>> = Vec::new();
    if let Some(u) = s.ics_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        v.push(Arc::new(IcsSource::new(u)));
    }
    #[cfg(target_os = "macos")]
    if s.system_calendar {
        v.push(Arc::new(eventkit::EventKitSource));
    }
    v
}

/// Det, der er gemt om forslagene: klaret (bekræftet, afvist, registreret)
/// og de tidsrum, der er registreret fra kalenderen eller et møde.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
struct Handled {
    /// Id → registreret tidsrum (unix-sekunder), `None` ved "Afvis".
    ids: HashMap<String, Option<(i64, i64)>>,
}

/// Et færdigt møde, som venter på svar (Registrér, Ret, Ignorér).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PendingMeeting {
    pub meeting: FinishedMeeting,
    /// Kalenderaftalens titel, hvis mødet passer til en aftale.
    pub title: Option<String>,
    pub calendar_id: Option<String>,
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    pub customer_name: Option<String>,
}

impl PendingMeeting {
    pub fn minutes(&self) -> u32 {
        self.meeting.minutes()
    }

    /// Beskrivelsen på posten: aftalens titel, ellers "Teams-møde".
    pub fn description(&self) -> String {
        self.title
            .clone()
            .unwrap_or_else(|| self.meeting.kind.label().to_string())
    }

    pub fn entry(&self, customer_id: Id, project_id: Option<Id>) -> EntryInput {
        let s = self.meeting.start.with_timezone(&Local);
        let e = self.meeting.end.with_timezone(&Local);
        let end = if e.date_naive() == s.date_naive() {
            e.time()
        } else {
            NaiveTime::from_hms_opt(23, 59, 0).expect("23:59")
        };
        EntryInput {
            customer_id,
            project_id,
            task_id: None,
            description: self.description(),
            date: s.date_naive(),
            start: Some(s.time()),
            end: Some(end),
            minutes: self.minutes(),
            billable: true,
        }
    }
}

/// En linje i Aktivitets kalenderkort.
#[derive(Clone, Debug, PartialEq)]
pub struct DayItem {
    pub start: NaiveTime,
    pub end: NaiveTime,
    pub title: String,
    pub customer: Option<String>,
    /// Et møde, der venter på svar (mødekortet).
    pub waiting: bool,
}

/// Kalenderen og møderne. Se modulets dokumentation.
pub struct Kalender {
    dir: Option<PathBuf>,
    factory: SourceFactory,
    settings: Mutex<CalendarSettings>,
    sources: Mutex<Vec<Arc<dyn CalendarSource>>>,
    /// Kildens nøgle → dens aftaler. En kilde, der fejler, beholder de sidste.
    events: Mutex<HashMap<String, Vec<CalendarEvent>>>,
    last_refresh: Mutex<Option<DateTime<Utc>>>,
    last_error: Mutex<Option<String>>,
    learned: Mutex<Learned>,
    handled: Mutex<Handled>,
    domains: Mutex<HashMap<Id, Vec<String>>>,
    /// Kunder og projekter fra det seneste `suggestions`-kald.
    catalog: Mutex<(Vec<Customer>, Vec<Project>)>,
    detector: Mutex<MeetingDetector>,
    pending: Mutex<Vec<PendingMeeting>>,
    /// Dagens egne registreringer (`set_logged_spans`): de vinder over kalenderen.
    logged: Mutex<(NaiveDate, Vec<(NaiveTime, NaiveTime)>)>,
    /// Hvad er i forgrunden nu (trackeren). Uden: intet møde findes.
    foreground: Mutex<Option<ForegroundFn>>,
    /// Kun én hentning ad gangen.
    fetching: Mutex<()>,
}

pub type ForegroundFn = Box<dyn Fn() -> Foreground + Send + Sync>;

static GLOBAL: OnceLock<Arc<Kalender>> = OnceLock::new();

/// Sættes én gang ved opstart (`startup`), så baggrundstjenesterne og
/// notifikationernes knapper kan nå møderne.
pub fn install_global(k: Arc<Kalender>) {
    let _ = GLOBAL.set(k);
}

pub fn global() -> Option<Arc<Kalender>> {
    GLOBAL.get().cloned()
}

impl Kalender {
    /// `dir` = `<datamappe>/kalender` (`None`: intet gemmes, til demo/tests).
    pub fn new(dir: Option<PathBuf>, factory: SourceFactory) -> Self {
        let read = |name: &str| dir.as_ref().and_then(|d| std::fs::read_to_string(d.join(name)).ok());
        let learned = read("moenstre.json")
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let handled = read("klaret.json")
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // Ubesvarede møder overlever en genstart; ældre end en uge glemmes.
        let week_ago = Utc::now() - Duration::days(7);
        let pending: Vec<PendingMeeting> = read("ventende.json")
            .and_then(|s| serde_json::from_str::<Vec<PendingMeeting>>(&s).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|m| m.meeting.end >= week_ago)
            .collect();
        Kalender {
            dir,
            factory,
            settings: Mutex::new(CalendarSettings::default()),
            sources: Mutex::new(Vec::new()),
            events: Mutex::new(HashMap::new()),
            last_refresh: Mutex::new(None),
            last_error: Mutex::new(None),
            learned: Mutex::new(learned),
            handled: Mutex::new(handled),
            domains: Mutex::new(HashMap::new()),
            catalog: Mutex::new((Vec::new(), Vec::new())),
            detector: Mutex::new(MeetingDetector::default()),
            pending: Mutex::new(pending),
            logged: Mutex::new((NaiveDate::MIN, Vec::new())),
            foreground: Mutex::new(None),
            fetching: Mutex::new(()),
        }
    }

    pub fn native(dir: PathBuf) -> Self {
        Self::new(Some(dir), Box::new(native_sources))
    }

    fn save<T: Serialize>(&self, name: &str, value: &T) {
        let Some(dir) = &self.dir else { return };
        let _ = std::fs::create_dir_all(dir);
        let Ok(json) = serde_json::to_string_pretty(value) else { return };
        let tmp = dir.join(format!("{name}.tmp"));
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, dir.join(name));
        }
    }

    pub fn settings(&self) -> CalendarSettings {
        lock(&self.settings).clone()
    }

    /// Nye indstillinger: kilderne bygges om og hentes ved næste `refresh`.
    pub fn apply(&self, s: &CalendarSettings) {
        let mut cur = lock(&self.settings);
        let changed_sources = cur.ics_url != s.ics_url || cur.system_calendar != s.system_calendar;
        *cur = s.clone();
        drop(cur);
        lock(&self.detector).set_settings(s.meetings.clone());
        if changed_sources || lock(&self.sources).is_empty() {
            let sources = (self.factory)(s);
            let keys: HashSet<String> = sources.iter().map(|s| s.key()).collect();
            lock(&self.events).retain(|k, _| keys.contains(k));
            *lock(&self.sources) = sources;
            *lock(&self.last_refresh) = None;
            *lock(&self.last_error) = None;
        }
    }

    /// Hent kilderne, hvis det er mere end [`REFRESH`] siden (eller `force`).
    /// Kører på en baggrundstråd. `true`, hvis aftalerne er ændret.
    pub fn refresh(&self, now: DateTime<Utc>, force: bool) -> bool {
        let Ok(_one) = self.fetching.try_lock() else {
            return false;
        };
        let due = force || lock(&self.last_refresh).is_none_or(|l| now - l >= REFRESH);
        if !due {
            return false;
        }
        *lock(&self.last_refresh) = Some(now);
        let sources = lock(&self.sources).clone();
        let from = now - Duration::days(PAST_DAYS);
        let to = now + Duration::days(2);
        let mut errors = Vec::new();
        let mut changed = false;
        for s in sources {
            match s.events(from, to) {
                Ok(ev) => {
                    // Er kilden fjernet imens (apply), kommer dens aftaler ikke tilbage.
                    if !lock(&self.sources).iter().any(|x| x.key() == s.key()) {
                        continue;
                    }
                    let mut all = lock(&self.events);
                    if all.get(&s.key()) != Some(&ev) {
                        all.insert(s.key(), ev);
                        changed = true;
                    }
                }
                Err(e) => errors.push(e),
            }
        }
        *lock(&self.last_error) = (!errors.is_empty()).then(|| errors.join("; "));
        changed
    }

    /// Seneste fejl fra en kilde (til Indstillinger → Kalender).
    pub fn last_error(&self) -> Option<String> {
        lock(&self.last_error).clone()
    }

    pub fn last_refresh(&self) -> Option<DateTime<Utc>> {
        *lock(&self.last_refresh)
    }

    /// Antal aftaler i hukommelsen (til Indstillinger → Kalender).
    pub fn event_count(&self) -> usize {
        lock(&self.events).values().map(Vec::len).sum()
    }

    fn all_events(&self) -> Vec<CalendarEvent> {
        let mut v: Vec<CalendarEvent> = lock(&self.events).values().flatten().cloned().collect();
        v.sort_by_key(|e| e.start);
        v
    }

    /// Dagens aftaler, uden private (til Aktivitet og tidslinjen).
    pub fn day_events(&self, date: NaiveDate) -> Vec<CalendarEvent> {
        self.all_events()
            .into_iter()
            .filter(|e| !e.private && e.start.with_timezone(&Local).date_naive() == date)
            .collect()
    }

    /// Dagens aftaler (uden private og heldags) og ventende møder til
    /// Aktivitet, med den kunde, de kobles til.
    pub fn day_items(&self, date: NaiveDate) -> Vec<DayItem> {
        let mut out: Vec<DayItem> = self
            .day_events(date)
            .into_iter()
            .filter(|e| !e.all_day)
            .map(|e| {
                let customer = self
                    .map(&e.title, &e.attendees)
                    .and_then(|m| self.customer_name(&m.customer_id));
                let (start, end) = local_span(&e);
                DayItem {
                    start,
                    end,
                    title: e.title,
                    customer,
                    waiting: false,
                }
            })
            .collect();
        for m in self.pending() {
            let s = m.meeting.start.with_timezone(&Local);
            if s.date_naive() != date {
                continue;
            }
            let e = m.meeting.end.with_timezone(&Local);
            out.push(DayItem {
                start: s.time(),
                end: if e.date_naive() == date { e.time() } else { NaiveTime::from_hms_opt(23, 59, 0).expect("23:59") },
                title: m.description(),
                customer: m.customer_name.clone(),
                waiting: true,
            });
        }
        out.sort_by_key(|i| i.start);
        out
    }

    /// Kunder og projekter til koblingen (sættes ved hvert `suggestions`).
    pub fn set_catalog(&self, customers: &[Customer], projects: &[Project]) {
        *lock(&self.catalog) = (customers.to_vec(), projects.to_vec());
    }

    fn map(&self, title: &str, attendees: &[String]) -> Option<Match> {
        let cat = lock(&self.catalog);
        let domains = lock(&self.domains);
        let learned = lock(&self.learned);
        Catalog {
            customers: &cat.0,
            projects: &cat.1,
            client_domains: &domains,
            learned: &learned,
        }
        .map(title, attendees)
    }

    fn customer_name(&self, id: &str) -> Option<String> {
        lock(&self.catalog)
            .0
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.name.clone())
    }

    fn is_handled(&self, id: &str) -> bool {
        lock(&self.handled).ids.contains_key(id)
    }

    fn mark(&self, id: &str, span: Option<(i64, i64)>) {
        let mut h = lock(&self.handled);
        h.ids.insert(id.to_string(), span);
        // Glem klarede forslag, der er ældre end 60 dage.
        let cutoff = Utc::now().timestamp() - 60 * 86_400;
        h.ids.retain(|k, span| {
            let ts = span.map(|s| s.1).or_else(|| k.rsplit(':').next()?.parse().ok());
            ts.is_none_or(|t| t >= cutoff)
        });
        let snapshot = h.clone();
        drop(h);
        self.save("klaret.json", &snapshot);
    }

    fn learn(&self, title: &str, customer_id: &str, project_id: Option<&str>) {
        let mut l = lock(&self.learned);
        l.learn(title, customer_id, project_id);
        let snapshot = l.clone();
        drop(l);
        self.save("moenstre.json", &snapshot);
    }

    fn covered_spans(&self) -> Vec<(i64, i64)> {
        lock(&self.handled).ids.values().flatten().copied().collect()
    }

    /// Kalenderforslagene for `date`: overståede, koblede aftaler, der ikke er klaret.
    pub fn suggestions_for(&self, date: NaiveDate, now: DateTime<Utc>) -> Vec<Suggestion> {
        if !lock(&self.settings).suggestions {
            return Vec::new();
        }
        let mut out = Vec::new();
        for ev in self.day_events(date) {
            if !ev.usable() || ev.end > now {
                continue;
            }
            let id = format!("{ID_PREFIX}{}", ev.id);
            if self.is_handled(&id) {
                continue;
            }
            let Some(m) = self.map(&ev.title, &ev.attendees) else { continue };
            let (s, e) = local_span(&ev);
            // Brugeren har selv ført tid her: ingen forslag oveni.
            let logged: Vec<(i64, i64)> = {
                let l = lock(&self.logged);
                if l.0 == date {
                    l.1.iter().filter_map(|(a, b)| span_of(date, *a, *b)).collect()
                } else {
                    Vec::new()
                }
            };
            if let Some((a, b)) = span_of(date, s, e)
                && covered_fraction(&logged, a, b) >= COVERED
            {
                continue;
            }
            out.push(Suggestion {
                id,
                date,
                start: s,
                end: e,
                customer_id: Some(m.customer_id),
                project_id: m.project_id,
                reason: crate::i18n::tf("kalenderkilder.reason", &[("title", &ev.title)]),
                confidence: m.reason.confidence(),
                task_id: None,
                task_title: None,
            });
        }
        out
    }

    fn event(&self, id: &str) -> Option<CalendarEvent> {
        let raw = id.strip_prefix(ID_PREFIX)?;
        self.all_events().into_iter().find(|e| e.id == raw)
    }

    fn entry_for(&self, id: &str, c: Option<&SuggestionCorrection>) -> Result<EntryInput> {
        let ev = self
            .event(id)
            .ok_or_else(|| BackendError::NotFound(crate::i18n::t("kalenderkilder.err.gone").into()))?;
        let m = self.map(&ev.title, &ev.attendees);
        let customer_id = c
            .and_then(|c| c.customer_id.clone())
            .or_else(|| m.as_ref().map(|m| m.customer_id.clone()))
            .ok_or_else(|| BackendError::Validation(crate::i18n::t("kalenderkilder.err.customer").into()))?;
        let project_id = match c {
            Some(c) if c.customer_id.is_some() || c.project_id.is_some() => c.project_id.clone(),
            _ => m.and_then(|m| m.project_id),
        };
        let (s, e) = local_span(&ev);
        let start = c.and_then(|c| c.start).unwrap_or(s);
        let end = c.and_then(|c| c.end).unwrap_or(e);
        Ok(EntryInput {
            customer_id,
            project_id,
            task_id: None,
            description: c
                .and_then(|c| c.description.clone())
                .unwrap_or_else(|| ev.title.clone()),
            date: ev.start.with_timezone(&Local).date_naive(),
            start: Some(start),
            end: Some(end),
            minutes: (end - start).num_minutes().max(0) as u32,
            billable: true,
        })
    }

    fn confirmed(&self, id: &str, c: Option<&SuggestionCorrection>, entry: Option<&EntryInput>) {
        let Some(ev) = self.event(id) else {
            self.mark(id, None);
            return;
        };
        // En rettelse lærer koblingen; et bekræftet forslag bekræfter den.
        if let Some(e) = entry {
            let explicit = c.is_some_and(|c| c.customer_id.is_some() || c.project_id.is_some());
            if explicit || self.map(&ev.title, &ev.attendees).is_some_and(|m| m.reason == MatchReason::Learned) {
                self.learn(&ev.title, &e.customer_id, e.project_id.as_deref());
            }
        }
        self.mark(id, Some((ev.start.timestamp(), ev.end.timestamp())));
    }

    /// Fjern detektionsforslag, som en kalenderaftale eller et registreret møde dækker.
    fn without_covered(&self, engine: Vec<Suggestion>, calendar: &[Suggestion]) -> Vec<Suggestion> {
        let mut spans = self.covered_spans();
        spans.extend(calendar.iter().filter_map(|s| span_of(s.date, s.start, s.end)));
        engine
            .into_iter()
            .filter(|s| {
                let Some((a, b)) = span_of(s.date, s.start, s.end) else { return true };
                covered_fraction(&spans, a, b) < COVERED
            })
            .collect()
    }

    /// Er tidsrummet allerede registreret fra kalenderen eller et møde?
    pub fn is_covered(&self, start: DateTime<Utc>, end: DateTime<Utc>) -> bool {
        covered_fraction(&self.covered_spans(), start.timestamp(), end.timestamp()) >= COVERED
    }

    fn save_pending(&self, p: &[PendingMeeting]) {
        self.save("ventende.json", &p.to_vec());
    }

    // ---------- møder ----------

    pub fn set_foreground(&self, f: ForegroundFn) {
        *lock(&self.foreground) = Some(f);
    }

    /// Ét skridt med det, trackeren ser nu (`tjenester`, hvert 5. sekund).
    pub fn poll(&self, at: DateTime<Utc>) -> Option<PendingMeeting> {
        let fg = lock(&self.foreground).as_ref().map(|f| f())?;
        self.observe(at, fg)
    }

    /// Mødedetektionens skridt: hvad er i forgrunden nu? Giver et færdigt
    /// møde, når det er slut, koblet til en kalenderaftale og en kunde.
    pub fn observe(&self, at: DateTime<Utc>, fg: Foreground) -> Option<PendingMeeting> {
        if !lock(&self.settings).meetings.enabled {
            return None;
        }
        let hint = fg.hint().map(str::to_string);
        let done = lock(&self.detector).observe(at, fg, hint)?;
        let pending = self.resolve_meeting(done);
        // Tiden er allerede registreret (kalenderforslaget er bekræftet): spørg ikke.
        if self.is_covered(pending.meeting.start, pending.meeting.end) {
            return None;
        }
        let mut p = lock(&self.pending);
        p.push(pending.clone());
        // Højst 20 ubesvarede; de ældste glemmes.
        let n = p.len();
        if n > 20 {
            p.drain(..n - 20);
        }
        self.save_pending(&p);
        Some(pending)
    }

    fn resolve_meeting(&self, m: FinishedMeeting) -> PendingMeeting {
        // Den aftale, der overlapper mødet mest (mindst halvdelen af mødet).
        let best = self
            .all_events()
            .into_iter()
            .filter(CalendarEvent::usable)
            .map(|e| {
                let overlap = (m.end.min(e.end) - m.start.max(e.start)).num_seconds();
                (overlap, e)
            })
            .filter(|(o, _)| *o * 2 >= (m.end - m.start).num_seconds().max(1))
            .max_by_key(|(o, _)| *o)
            .map(|(_, e)| e);
        let mapped = match &best {
            Some(e) => self.map(&e.title, &e.attendees),
            None => None,
        }
        .or_else(|| m.hint.as_deref().and_then(|h| self.map(h, &[])));
        let customer_name = mapped.as_ref().and_then(|x| self.customer_name(&x.customer_id));
        PendingMeeting {
            title: best.as_ref().map(|e| e.title.clone()),
            calendar_id: best.as_ref().map(|e| format!("{ID_PREFIX}{}", e.id)),
            customer_id: mapped.as_ref().map(|x| x.customer_id.clone()),
            project_id: mapped.and_then(|x| x.project_id),
            customer_name,
            meeting: FinishedMeeting { hint: None, ..m },
        }
    }

    pub fn pending(&self) -> Vec<PendingMeeting> {
        lock(&self.pending).clone()
    }

    /// Læg et møde tilbage (gem fejlede, eller kunden mangler).
    pub fn put_back(&self, m: PendingMeeting) {
        let mut p = lock(&self.pending);
        if !p.iter().any(|x| x.meeting.id == m.meeting.id) {
            p.push(m);
            self.save_pending(&p);
        }
    }

    pub fn take_pending(&self, id: &str) -> Option<PendingMeeting> {
        let mut p = lock(&self.pending);
        let i = p.iter().position(|m| m.meeting.id == id)?;
        let m = p.remove(i);
        self.save_pending(&p);
        Some(m)
    }

    /// Mødet er registreret: tidsrummet skjuler overlappende forslag, og
    /// aftalen er klaret. En valgt kunde læres for aftalens titel.
    pub fn meeting_registered(&self, m: &PendingMeeting, entry: &EntryInput) {
        let span = Some((m.meeting.start.timestamp(), m.meeting.end.timestamp()));
        self.mark(&format!("moede:{}", m.meeting.id), span);
        if let Some(cal) = &m.calendar_id {
            self.mark(cal, span);
            if let Some(t) = &m.title
                && m.customer_id.as_deref() != Some(entry.customer_id.as_str())
            {
                self.learn(t, &entry.customer_id, entry.project_id.as_deref());
            }
        }
    }

    /// Demo og tests: læg aftaler direkte ind.
    pub fn set_events(&self, key: &str, events: Vec<CalendarEvent>) {
        lock(&self.events).insert(key.to_string(), events);
    }
}

/// Et færdigt Teams-møde med Bageriet (demo og skærmbilleder).
pub fn demo_meeting() -> PendingMeeting {
    let end = Utc::now() - Duration::minutes(2);
    PendingMeeting {
        meeting: FinishedMeeting {
            id: "demo-moede".into(),
            kind: crate::moeder::MeetingKind::Teams,
            start: end - Duration::minutes(42),
            end,
            hint: None,
        },
        title: Some("Status på webshoppen".into()),
        calendar_id: None,
        customer_id: Some("kunde_bageriet".into()),
        project_id: Some("proj_webshop".into()),
        customer_name: Some("Bageriet på Hjørnet".into()),
    }
}

fn local_span(ev: &CalendarEvent) -> (NaiveTime, NaiveTime) {
    let s = ev.start.with_timezone(&Local);
    let e = ev.end.with_timezone(&Local);
    let end = if e.date_naive() == s.date_naive() {
        e.time()
    } else {
        NaiveTime::from_hms_opt(23, 59, 0).expect("23:59")
    };
    (s.time(), end)
}

/// Hvor stor en del af `[a, b)` dækker tidsrummene? De lægges sammen først,
/// så det samme tidsrum gemt to gange (møde og aftale) ikke tæller dobbelt.
fn covered_fraction(spans: &[(i64, i64)], a: i64, b: i64) -> f64 {
    let mut parts: Vec<(i64, i64)> = spans
        .iter()
        .map(|(x, y)| ((*x).max(a), (*y).min(b)))
        .filter(|(x, y)| x < y)
        .collect();
    parts.sort();
    let (mut covered, mut reach) = (0i64, a);
    for (x, y) in parts {
        let x = x.max(reach);
        if y > x {
            covered += y - x;
            reach = y;
        }
    }
    covered as f64 / (b - a).max(1) as f64
}

fn span_of(date: NaiveDate, start: NaiveTime, end: NaiveTime) -> Option<(i64, i64)> {
    use chrono::TimeZone;
    let a = Local.from_local_datetime(&date.and_time(start)).earliest()?.timestamp();
    let b = Local.from_local_datetime(&date.and_time(end)).earliest()?.timestamp();
    Some((a, b))
}

/// Detektionen med kalenderen ovenpå: kalenderforslag lægges til
/// detektionens, og Bekræft/Ret/Afvis på dem håndteres her. Alt andet går
/// videre til den indre detektion (`Engine`).
pub struct CalendarDetection {
    inner: Arc<dyn Detection>,
    kalender: Arc<Kalender>,
}

impl CalendarDetection {
    pub fn new(inner: Arc<dyn Detection>, kalender: Arc<Kalender>) -> Self {
        CalendarDetection { inner, kalender }
    }

    fn ours(id: &str) -> bool {
        id.starts_with(ID_PREFIX)
    }
}

impl Detection for CalendarDetection {
    fn suggestions(&self, date: NaiveDate, customers: &[Customer], projects: &[Project]) -> Result<Vec<Suggestion>> {
        self.kalender.set_catalog(customers, projects);
        let engine = self.inner.suggestions(date, customers, projects)?;
        let calendar = self.kalender.suggestions_for(date, Utc::now());
        let mut out = self.kalender.without_covered(engine, &calendar);
        out.extend(calendar);
        out.sort_by_key(|s| s.start);
        Ok(out)
    }

    fn set_web_catalog(&self, catalog: WebCatalog) {
        *lock(&self.kalender.domains) = catalog.client_domains.clone();
        self.inner.set_web_catalog(catalog);
    }

    fn entry_for(&self, id: &str, correction: Option<&SuggestionCorrection>) -> Result<EntryInput> {
        if Self::ours(id) {
            self.kalender.entry_for(id, correction)
        } else {
            self.inner.entry_for(id, correction)
        }
    }

    fn confirmed(&self, id: &str, correction: Option<&SuggestionCorrection>, entry_id: &str) {
        if Self::ours(id) {
            let entry = self.kalender.entry_for(id, correction).ok();
            self.kalender.confirmed(id, correction, entry.as_ref());
        } else {
            self.inner.confirmed(id, correction, entry_id)
        }
    }

    fn reject(&self, id: &str) -> Result<()> {
        if Self::ours(id) {
            self.kalender.mark(id, None);
            Ok(())
        } else {
            self.inner.reject(id)
        }
    }

    fn apply_settings(&self, settings: &Settings) {
        self.kalender.apply(&settings.calendar);
        self.inner.apply_settings(settings)
    }

    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        self.inner.ai_models()
    }
    fn ai_problem(&self) -> Option<String> {
        self.inner.ai_problem()
    }
    fn download_model(&self, id: &str) -> Result<()> {
        self.inner.download_model(id)
    }
    fn model_progress(&self, id: &str) -> Option<ModelProgress> {
        self.inner.model_progress(id)
    }
    fn cancel_model_download(&self, id: &str) {
        self.inner.cancel_model_download(id)
    }
    fn delete_model(&self, id: &str) -> Result<()> {
        self.inner.delete_model(id)
    }
    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        self.inner.discover_ai_servers()
    }
    fn found_models(&self) -> Result<FoundModels> {
        self.inner.found_models()
    }
    fn rescan_models(&self) -> Result<FoundModels> {
        self.inner.rescan_models()
    }
    fn start_ollama(&self) -> Result<()> {
        self.inner.start_ollama()
    }
    fn set_cloud_ai_key(&self, provider: CloudAiProvider, key: String) -> Result<()> {
        self.inner.set_cloud_ai_key(provider, key)
    }
    fn remove_cloud_ai_key(&self, provider: CloudAiProvider) -> Result<()> {
        self.inner.remove_cloud_ai_key(provider)
    }
    fn permissions(&self) -> Result<Permissions> {
        self.inner.permissions()
    }
    fn request_permission(&self, permission: Permission) -> Result<PermissionState> {
        self.inner.request_permission(permission)
    }
    fn changes(&self) -> Option<ChangeRx> {
        self.inner.changes()
    }
    fn idle_returns(&self) -> Option<IdleRx> {
        self.inner.idle_returns()
    }
    fn sync_patterns(&self, web: &dyn PatternWeb, scope: &str) -> Result<PatternSyncReport> {
        self.inner.sync_patterns(web, scope)
    }

    // ---- observatøren (v1/observer). Nye metoder på `Detection` skal
    // sendes videre her, ellers slår indpakningen dem tavst fra.

    fn set_logged_spans(&self, date: NaiveDate, spans: Vec<(NaiveTime, NaiveTime)>) {
        // Egne registreringer vinder også over kalenderforslag.
        *lock(&self.kalender.logged) = (date, spans.clone());
        self.inner.set_logged_spans(date, spans)
    }
    fn learn_from_entries(&self, date: NaiveDate, entries: &[crate::backend::Entry]) {
        self.inner.learn_from_entries(date, entries)
    }
    fn set_tasks(&self, tasks: Vec<crate::backend::Task>) {
        self.inner.set_tasks(tasks)
    }
    fn observer_card(&self, c: &[Customer], p: &[Project]) -> Result<crate::backend::ObserverCard> {
        self.inner.observer_card(c, p)
    }
    fn observer_groups(&self, c: &[Customer], p: &[Project]) -> Result<Vec<crate::backend::ObserverGroup>> {
        self.inner.observer_groups(c, p)
    }
    fn observer_answer(
        &self,
        group_id: &str,
        reply: &crate::backend::ObserverReply,
        c: &[Customer],
        p: &[Project],
    ) -> Result<()> {
        self.inner.observer_answer(group_id, reply, c, p)
    }
    fn export_test_set(
        &self,
        entries: &[crate::backend::Entry],
        c: &[Customer],
        p: &[Project],
        days: u32,
    ) -> Result<String> {
        self.inner.export_test_set(entries, c, p, days)
    }

    // ---- Aktivitet (0.2.25)

    fn activity_day(
        &self,
        date: NaiveDate,
        c: &[Customer],
        p: &[Project],
        registered: &[crate::backend::services::RegisteredSpan],
    ) -> Result<crate::backend::ActivityDay> {
        self.inner.activity_day(date, c, p, registered)
    }
    fn activity_assigned(
        &self,
        spans: &[(i64, i64)],
        customer_id: &str,
        project_id: Option<&str>,
        remember: bool,
        c: &[Customer],
        p: &[Project],
    ) {
        self.inner
            .activity_assigned(spans, customer_id, project_id, remember, c, p)
    }
    fn activity_not_work(&self, spans: &[(i64, i64)]) -> Result<()> {
        self.inner.activity_not_work(spans)
    }
    fn merge_activity(&self, span: (i64, i64)) -> Result<()> {
        self.inner.merge_activity(span)
    }
    fn split_activity(&self, span: (i64, i64), at: i64) -> Result<()> {
        self.inner.split_activity(span, at)
    }
    fn delete_activity(&self, spans: &[(i64, i64)]) -> Result<()> {
        self.inner.delete_activity(spans)
    }
    fn delete_all_activity(&self) -> Result<()> {
        self.inner.delete_all_activity()
    }
    fn activity_storage(&self) -> Result<crate::backend::ActivityStorage> {
        self.inner.activity_storage()
    }
    fn stored_exclusions(&self) -> Result<Vec<crate::backend::StoredExclusion>> {
        self.inner.stored_exclusions()
    }
    fn remove_stored_exclusion(&self, id: i64) -> Result<()> {
        self.inner.remove_stored_exclusion(id)
    }
    // ux-vaelger: regler.
    fn rule_candidates(&self, spans: &[(i64, i64)]) -> Vec<(crate::backend::ScopeKind, String)> {
        self.inner.rule_candidates(spans)
    }
    fn rule_hit_counts(&self, rules: &[(tt_data::RuleKind, String)], days: &[NaiveDate]) -> Vec<usize> {
        self.inner.rule_hit_counts(rules, days)
    }
    fn rule_open_runs(
        &self,
        kind: tt_data::RuleKind,
        pattern: &str,
        date: NaiveDate,
        customer: &str,
        project: Option<&str>,
        customers: &[Customer],
        projects: &[Project],
    ) -> Result<Vec<(i64, i64)>> {
        self.inner.rule_open_runs(kind, pattern, date, customer, project, customers, projects)
    }
    fn pattern_rows(&self, days: &[NaiveDate]) -> Vec<crate::backend::RuleRow> {
        self.inner.pattern_rows(days)
    }
    fn disabled_rules(&self) -> std::collections::BTreeSet<Id> {
        self.inner.disabled_rules()
    }
    fn set_rule_disabled(&self, id: &str, disabled: bool) -> Result<()> {
        self.inner.set_rule_disabled(id, disabled)
    }
    fn retarget_pattern(&self, id: &str, customer_id: Option<Id>, project_id: Option<Id>) -> Result<()> {
        self.inner.retarget_pattern(id, customer_id, project_id)
    }
    fn forget_pattern(&self, id: &str) -> Result<()> {
        self.inner.forget_pattern(id)
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod daekning_tests {
    use super::covered_fraction;

    #[test]
    fn samme_tidsrum_to_gange_taeller_en_gang() {
        // 25 min registreret to gange (møde og aftale) i et forslag på 60 min
        let spans = [(0, 25 * 60), (0, 25 * 60)];
        let f = covered_fraction(&spans, 0, 60 * 60);
        assert!((f - 25.0 / 60.0).abs() < 1e-9, "{f}");
        assert_eq!(covered_fraction(&[(0, 30), (20, 50), (40, 100)], 0, 100), 1.0);
        assert_eq!(covered_fraction(&[], 0, 100), 0.0);
        assert_eq!(covered_fraction(&[(200, 300)], 0, 100), 0.0);
    }

    #[test]
    fn ubesvarede_moeder_overlever_en_genstart() {
        use super::{Kalender, demo_meeting};
        let dir = tempfile::tempdir().unwrap();
        let k = Kalender::new(Some(dir.path().to_path_buf()), Box::new(|_| vec![]));
        k.put_back(demo_meeting());
        let k2 = Kalender::new(Some(dir.path().to_path_buf()), Box::new(|_| vec![]));
        assert_eq!(k2.pending(), k.pending());
        assert!(k2.take_pending("demo-moede").is_some());
        let k3 = Kalender::new(Some(dir.path().to_path_buf()), Box::new(|_| vec![]));
        assert!(k3.pending().is_empty(), "besvaret er væk efter genstart");
    }
}
