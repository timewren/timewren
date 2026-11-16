use std::sync::{Arc, Mutex};

use chrono::{Duration, Local, NaiveDate, TimeZone, Utc};

use super::*;
use crate::backend::services::NoDetection;
use crate::backend::{Backend, MockBackend, ProjectStatus};
use crate::moeder::{Foreground, MeetingKind};

fn customer(id: &str, name: &str) -> Customer {
    Customer {
        id: id.into(),
        name: name.into(),
        email: None,
        hourly_rate: None,
        archived: false,
        cvr: None,
        ..Default::default()
    }
}

fn project(id: &str, c: &str, name: &str) -> Project {
    Project {
        id: id.into(),
        customer_id: c.into(),
        name: name.into(),
        status: ProjectStatus::Active,
        hourly_rate: None,
        budget_minutes: None,
        url_patterns: vec![],
    }
}

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
}

fn local(h: u32, m: u32) -> DateTime<Utc> {
    Local
        .from_local_datetime(&day().and_hms_opt(h, m, 0).unwrap())
        .unwrap()
        .with_timezone(&Utc)
}

fn event(uid: &str, title: &str, h: u32, m: u32, minutes: i64) -> CalendarEvent {
    let start = local(h, m);
    CalendarEvent {
        id: format!("t:{uid}:{}", start.timestamp()),
        title: title.into(),
        start,
        end: start + Duration::minutes(minutes),
        all_day: false,
        attendees: vec![],
        private: false,
        source: SourceKind::Ics,
    }
}

/// En falsk detektion med ét forslag 10:00-10:40 (samme tid som standupmødet).
struct OneSuggestion;

impl Detection for OneSuggestion {
    fn suggestions(&self, date: NaiveDate, _: &[Customer], _: &[Project]) -> Result<Vec<Suggestion>> {
        Ok(vec![Suggestion {
            id: "engine-1".into(),
            date,
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(10, 40, 0).unwrap(),
            customer_id: Some("k_bager".into()),
            project_id: None,
            reason: "Zoom".into(),
            confidence: 0.5,
            task_id: None,
            task_title: None,
        }])
    }
    fn entry_for(&self, id: &str, c: Option<&SuggestionCorrection>) -> Result<EntryInput> {
        NoDetection.entry_for(id, c)
    }
    fn confirmed(&self, _: &str, _: Option<&SuggestionCorrection>, _: &str) {}
    fn reject(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn apply_settings(&self, _: &Settings) {}
    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        Ok(vec![])
    }
    fn download_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn delete_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        Ok(vec![])
    }
    fn set_cloud_ai_key(&self, _: CloudAiProvider, _: String) -> Result<()> {
        Ok(())
    }
    fn remove_cloud_ai_key(&self, _: CloudAiProvider) -> Result<()> {
        Ok(())
    }
    fn permissions(&self) -> Result<Permissions> {
        NoDetection.permissions()
    }
    fn request_permission(&self, p: Permission) -> Result<PermissionState> {
        NoDetection.request_permission(p)
    }
}

struct Rig {
    k: Arc<Kalender>,
    det: CalendarDetection,
    customers: Vec<Customer>,
    projects: Vec<Project>,
    _dir: tempfile::TempDir,
}

impl Rig {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        Self::in_dir(dir)
    }

    fn in_dir(dir: tempfile::TempDir) -> Self {
        let k = Arc::new(Kalender::new(Some(dir.path().join("kalender")), Box::new(|_| vec![])));
        k.set_events(
            "t",
            vec![
                event("standup", "Standup Bageriet", 10, 0, 40),
                event("privat", "Læge", 12, 0, 30),
                event("ukendt", "Frokost", 12, 30, 30),
                event("webshop", "Gennemgang af webshop", 14, 0, 60),
            ],
        );
        k.lock_events_mut_for_test(|evs| evs[1].private = true);
        let det = CalendarDetection::new(Arc::new(OneSuggestion), k.clone());
        let mut domains = HashMap::new();
        domains.insert("k_cafe".to_string(), vec!["cafe.dk".to_string()]);
        det.set_web_catalog(WebCatalog {
            client_domains: domains,
            ..WebCatalog::default()
        });
        Rig {
            k,
            det,
            customers: vec![customer("k_bager", "Bageriet"), customer("k_cafe", "Café")],
            projects: vec![project("p_shop", "k_bager", "Webshop")],
            _dir: dir,
        }
    }

    fn suggestions(&self) -> Vec<Suggestion> {
        self.det.suggestions(day(), &self.customers, &self.projects).unwrap()
    }
}

impl Kalender {
    fn lock_events_mut_for_test(&self, f: impl FnOnce(&mut Vec<CalendarEvent>)) {
        let mut all = lock(&self.events);
        f(all.get_mut("t").unwrap());
    }
}

#[test]
fn aftaler_bliver_forslag_og_private_og_ukoblede_skjules() {
    let r = Rig::new();
    let s = r.suggestions();
    let ids: Vec<&str> = s.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(s.len(), 2, "{ids:?}");
    let standup = &s[0];
    assert!(standup.id.starts_with("kal:t:standup"));
    assert_eq!(standup.customer_id.as_deref(), Some("k_bager"));
    assert_eq!(standup.reason, "Kalender: Standup Bageriet");
    assert_eq!(standup.minutes(), 40);
    let shop = &s[1];
    assert_eq!(shop.project_id.as_deref(), Some("p_shop"));
    // Detektionens forslag 10:00-10:40 er dækket af standupmødet og skjules
    assert!(!ids.contains(&"engine-1"));
    // Ingen privat aftale nogen steder, heller ikke i dagens liste
    assert!(r.k.day_events(day()).iter().all(|e| e.title != "Læge"));
}

#[test]
fn fremtidige_aftaler_foreslaas_ikke() {
    let r = Rig::new();
    r.k.set_catalog(&r.customers, &r.projects);
    let early = local(10, 20);
    assert!(r.k.suggestions_for(day(), early).is_empty(), "standup er ikke slut kl. 10:20");
    assert_eq!(r.k.suggestions_for(day(), local(10, 40)).len(), 1);
}

#[test]
fn bekraeft_gemmer_aftalen_og_den_vises_ikke_igen_men_daekker_stadig() {
    let r = Rig::new();
    let id = r.suggestions()[0].id.clone();
    let e = r.det.entry_for(&id, None).unwrap();
    assert_eq!((e.customer_id.as_str(), e.minutes), ("k_bager", 40));
    assert_eq!(e.description, "Standup Bageriet");
    r.det.confirmed(&id, None, "post-1");
    let s = r.suggestions();
    assert!(s.iter().all(|x| x.id != id));
    assert!(s.iter().all(|x| x.id != "engine-1"), "det registrerede tidsrum dækker stadig");
}

#[test]
fn afvis_skjuler_aftalen_og_giver_detektionens_forslag_tilbage() {
    let r = Rig::new();
    let id = r.suggestions()[0].id.clone();
    r.det.reject(&id).unwrap();
    let ids: Vec<String> = r.suggestions().into_iter().map(|s| s.id).collect();
    assert!(!ids.contains(&id));
    assert!(ids.contains(&"engine-1".to_string()));
}

#[test]
fn ret_laerer_koblingen_og_overlever_genstart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    let r = Rig::in_dir(dir);
    let id = r.suggestions()[0].id.clone();
    let c = SuggestionCorrection {
        customer_id: Some("k_cafe".into()),
        ..Default::default()
    };
    let e = r.det.entry_for(&id, Some(&c)).unwrap();
    assert_eq!(e.customer_id, "k_cafe");
    r.det.confirmed(&id, Some(&c), "post-1");
    // Ny instans på samme mappe: mønsteret og "klaret" er gemt
    let k2 = Kalender::new(Some(path.join("kalender")), Box::new(|_| vec![]));
    k2.set_catalog(&r.customers, &r.projects);
    let m = k2.map("Standup Bageriet", &[]).unwrap();
    assert_eq!((m.customer_id.as_str(), m.reason), ("k_cafe", MatchReason::Learned));
    assert!(k2.is_handled(&id));
}

#[test]
fn forslag_kan_slaas_fra() {
    let r = Rig::new();
    let s = CalendarSettings {
        suggestions: false,
        ..CalendarSettings::default()
    };
    r.k.apply(&s);
    let ids: Vec<String> = r.suggestions().into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["engine-1"]);
}

#[test]
fn ics_kilde_hentes_med_interval_og_fejl_beholder_de_gamle() {
    let calls = Arc::new(Mutex::new(0));
    let fail = Arc::new(Mutex::new(false));
    let (c2, f2) = (calls.clone(), fail.clone());
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Bageriet\r\n\
               DTSTART:20261026T090000Z\r\nDTEND:20261026T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let fetch: Fetch = Arc::new(move |_url: &str| {
        *c2.lock().unwrap() += 1;
        if *f2.lock().unwrap() {
            Err("netværk nede".into())
        } else {
            Ok(ics.to_string())
        }
    });
    let k = Kalender::new(
        None,
        Box::new(move |s: &CalendarSettings| {
            s.ics_url
                .iter()
                .map(|u| Arc::new(IcsSource::with_fetch(u, fetch.clone())) as Arc<dyn CalendarSource>)
                .collect()
        }),
    );
    k.apply(&CalendarSettings {
        ics_url: Some("webcal://example.com/k.ics".into()),
        ..CalendarSettings::default()
    });
    let now = Utc.with_ymd_and_hms(2026, 10, 26, 12, 0, 0).unwrap();
    assert!(k.refresh(now, false));
    assert_eq!(k.event_count(), 1);
    assert!(!k.refresh(now + Duration::minutes(5), false), "ikke før der er gået 15 min");
    assert_eq!(*calls.lock().unwrap(), 1);
    *fail.lock().unwrap() = true;
    k.refresh(now + Duration::minutes(16), false);
    assert_eq!(k.event_count(), 1, "aftalerne fra sidst bevares");
    assert_eq!(k.last_error().as_deref(), Some("netværk nede"));
    // Adressen fjernes: aftalerne forsvinder
    k.apply(&CalendarSettings::default());
    assert_eq!(k.event_count(), 0);
}

#[test]
fn moede_kobles_til_aftalen_der_overlapper() {
    let r = Rig::new();
    r.k.set_catalog(&r.customers, &r.projects);
    let fg = Foreground::Meeting {
        kind: MeetingKind::Zoom,
        hint: "Zoom Meeting".into(),
    };
    // Zoom 9:58-10:38, standup står 10:00-10:40
    let mut t = local(9, 58);
    while t <= local(10, 38) {
        assert!(r.k.observe(t, fg.clone()).is_none());
        t += Duration::seconds(5);
    }
    let mut done = None;
    while done.is_none() {
        done = r.k.observe(t, Foreground::Other);
        t += Duration::seconds(5);
    }
    let p = done.unwrap();
    assert_eq!(p.title.as_deref(), Some("Standup Bageriet"));
    assert_eq!(p.customer_id.as_deref(), Some("k_bager"));
    assert_eq!(p.customer_name.as_deref(), Some("Bageriet"));
    assert_eq!(p.minutes(), 40);
    assert_eq!(p.meeting.hint, None, "vinduestitlen gemmes ikke");
    // Registreret: aftalen er klaret og dækker detektionens forslag
    let entry = p.entry("k_bager".into(), None);
    r.k.meeting_registered(&p, &entry);
    let s = r.suggestions();
    assert!(s.iter().all(|x| !x.id.contains("standup") && x.id != "engine-1"));
}

#[test]
fn private_aftaler_kobles_ikke_til_moeder() {
    let r = Rig::new();
    r.k.set_catalog(&r.customers, &r.projects);
    let fg = Foreground::Meeting {
        kind: MeetingKind::FaceTime,
        hint: "Jens".into(),
    };
    let mut t = local(12, 0);
    while t <= local(12, 25) {
        r.k.observe(t, fg.clone());
        t += Duration::seconds(5);
    }
    let mut done = None;
    while done.is_none() {
        done = r.k.observe(t, Foreground::Other);
        t += Duration::seconds(5);
    }
    let p = done.unwrap();
    assert_eq!(p.title, None, "den private aftale (Læge) bruges ikke");
}

#[test]
fn indstillinger_valideres_og_gamle_filer_kan_laeses() {
    let bad = CalendarSettings {
        ics_url: Some("http://usikker.dk/x.ics".into()),
        ..CalendarSettings::default()
    };
    assert!(bad.validate().is_err());
    let s: Settings = serde_json::from_str(
        &serde_json::to_string(&Settings::defaults())
            .unwrap()
            .replace(",\"calendar\":", ",\"ignoreret\":"),
    )
    .unwrap();
    assert_eq!(s.calendar, CalendarSettings::default());
    // MockBackend afviser en usikker adresse
    let b = MockBackend::with_today(day());
    let mut s = b.settings().unwrap();
    s.calendar = bad;
    assert!(b.save_settings(s).is_err());
}

#[test]
fn egne_registreringer_vinder_over_kalenderforslag() {
    let r = Rig::new();
    r.det.set_logged_spans(
        day(),
        vec![(NaiveTime::from_hms_opt(10, 0, 0).unwrap(), NaiveTime::from_hms_opt(10, 40, 0).unwrap())],
    );
    let ids: Vec<String> = r.suggestions().into_iter().map(|s| s.id).collect();
    assert!(ids.iter().all(|i| !i.contains("standup")), "{ids:?}");
    assert!(ids.iter().any(|i| i.contains("webshop")));
}

#[test]
fn aktivitet_faar_dagens_aftaler_og_ventende_moeder_uden_private() {
    let r = Rig::new();
    r.k.set_catalog(&r.customers, &r.projects);
    let mut m = demo_meeting();
    m.meeting.start = local(16, 0);
    m.meeting.end = local(16, 42);
    r.k.put_back(m);
    let items = r.k.day_items(day());
    let titles: Vec<&str> = items.iter().map(|i| i.title.as_str()).collect();
    assert_eq!(
        titles,
        vec!["Standup Bageriet", "Frokost", "Gennemgang af webshop", "Status på webshoppen"]
    );
    assert_eq!(items[0].customer.as_deref(), Some("Bageriet"));
    assert_eq!(items[1].customer, None);
    assert!(items[3].waiting && !items[0].waiting);
    assert!(r.k.day_items(day() + Duration::days(1)).is_empty());
}


/// Husker, hvilke af Aktivitets metoder der nåede den indpakkede detektion.
#[derive(Default)]
struct Recorder(Mutex<Vec<&'static str>>);

impl Recorder {
    fn hit(&self, name: &'static str) {
        self.0.lock().unwrap().push(name);
    }
}

impl Detection for Recorder {
    fn suggestions(&self, _: NaiveDate, _: &[Customer], _: &[Project]) -> Result<Vec<Suggestion>> {
        Ok(vec![])
    }
    fn entry_for(&self, id: &str, c: Option<&SuggestionCorrection>) -> Result<EntryInput> {
        NoDetection.entry_for(id, c)
    }
    fn confirmed(&self, _: &str, _: Option<&SuggestionCorrection>, _: &str) {}
    fn reject(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn apply_settings(&self, _: &Settings) {}
    fn ai_models(&self) -> Result<Vec<LocalModel>> {
        Ok(vec![])
    }
    fn download_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn delete_model(&self, _: &str) -> Result<()> {
        Ok(())
    }
    fn discover_ai_servers(&self) -> Result<Vec<LocalAiServer>> {
        Ok(vec![])
    }
    fn set_cloud_ai_key(&self, _: CloudAiProvider, _: String) -> Result<()> {
        Ok(())
    }
    fn remove_cloud_ai_key(&self, _: CloudAiProvider) -> Result<()> {
        Ok(())
    }
    fn permissions(&self) -> Result<Permissions> {
        NoDetection.permissions()
    }
    fn request_permission(&self, p: Permission) -> Result<PermissionState> {
        NoDetection.request_permission(p)
    }
    fn activity_day(
        &self,
        date: NaiveDate,
        _: &[Customer],
        _: &[Project],
        _: &[crate::backend::services::RegisteredSpan],
    ) -> Result<crate::backend::ActivityDay> {
        self.hit("activity_day");
        Ok(crate::backend::ActivityDay::empty(date, date))
    }
    fn activity_assigned(&self, _: &[(i64, i64)], _: &str, _: Option<&str>, _: bool, _: &[Customer], _: &[Project]) {
        self.hit("activity_assigned");
    }
    fn activity_not_work(&self, _: &[(i64, i64)]) -> Result<()> {
        self.hit("activity_not_work");
        Ok(())
    }
    fn merge_activity(&self, _: (i64, i64)) -> Result<()> {
        self.hit("merge_activity");
        Ok(())
    }
    fn split_activity(&self, _: (i64, i64), _: i64) -> Result<()> {
        self.hit("split_activity");
        Ok(())
    }
    fn delete_activity(&self, _: &[(i64, i64)]) -> Result<()> {
        self.hit("delete_activity");
        Ok(())
    }
    fn delete_all_activity(&self) -> Result<()> {
        self.hit("delete_all_activity");
        Ok(())
    }
    fn activity_storage(&self) -> Result<crate::backend::ActivityStorage> {
        self.hit("activity_storage");
        Ok(Default::default())
    }
    fn stored_exclusions(&self) -> Result<Vec<crate::backend::StoredExclusion>> {
        self.hit("stored_exclusions");
        Ok(vec![])
    }
    fn remove_stored_exclusion(&self, _: i64) -> Result<()> {
        self.hit("remove_stored_exclusion");
        Ok(())
    }
}

#[test]
fn aktivitetens_kald_sendes_videre_til_motoren() {
    // Set på en rigtig Mac: Aktivitet var tom, fordi indpakningen svarede
    // med trækkets tomme standard i stedet for at spørge motoren.
    let inner = Arc::new(Recorder::default());
    let k = Arc::new(Kalender::new(None, Box::new(|_| vec![])));
    let det = CalendarDetection::new(inner.clone(), k);
    let day = NaiveDate::from_ymd_opt(2026, 10, 27).unwrap();
    det.activity_day(day, &[], &[], &[]).unwrap();
    det.activity_assigned(&[(1, 2)], "k", None, true, &[], &[]);
    det.activity_not_work(&[(1, 2)]).unwrap();
    det.merge_activity((1, 2)).unwrap();
    det.split_activity((1, 3), 2).unwrap();
    det.delete_activity(&[(1, 2)]).unwrap();
    det.delete_all_activity().unwrap();
    det.activity_storage().unwrap();
    det.stored_exclusions().unwrap();
    det.remove_stored_exclusion(1).unwrap();
    assert_eq!(
        *inner.0.lock().unwrap(),
        vec![
            "activity_day",
            "activity_assigned",
            "activity_not_work",
            "merge_activity",
            "split_activity",
            "delete_activity",
            "delete_all_activity",
            "activity_storage",
            "stored_exclusions",
            "remove_stored_exclusion",
        ]
    );
}

/// Navnene på `fn`-linjerne i blokken, der starter med `header` (til `}`).
fn fn_names(src: &str, header: &str) -> std::collections::BTreeSet<String> {
    let start = src.find(header).unwrap_or_else(|| panic!("{header} findes ikke"));
    let body = &src[start..];
    let end = body.find("\n}").expect("blokkens slutning");
    body[..end]
        .lines()
        .filter_map(|l| {
            let l = l.trim_start();
            let l = l.strip_prefix("async ").unwrap_or(l);
            let l = l.strip_prefix("unsafe ").unwrap_or(l);
            l.strip_prefix("fn ")
        })
        .map(|l| l.split(['(', '<']).next().unwrap_or("").to_string())
        .collect()
}

/// Indpakningen skal sende alle `Detection`-metoder videre. En glemt metode
/// falder tavst tilbage til traitens standard (sådan forsvandt Aktivitet i
/// 0.2.25: tomme dage og "Gemmes fra i dag").
#[test]
fn indpakningen_sender_alle_detektionens_metoder_videre() {
    let traits = fn_names(include_str!("../backend/services.rs"), "pub trait Detection");
    let ours = fn_names(include_str!("mod.rs"), "impl Detection for CalendarDetection");
    assert!(traits.len() > 30, "fandt traitens metoder: {traits:?}");
    let missing: Vec<_> = traits.difference(&ours).collect();
    assert!(missing.is_empty(), "CalendarDetection sender ikke videre: {missing:?}");
}
