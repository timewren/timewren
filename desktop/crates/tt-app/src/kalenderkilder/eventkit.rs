//! macOS: systemets kalender via EventKit (kun læsning).
//!
//! Tilladelsen spørges der om første gang fra Indstillinger → Kalender
//! ([`request_access`]); teksten i dialogen står i `Info.plist`
//! (`NSCalendarsFullAccessUsageDescription`). EventKit har ingen
//! "privat"-markering, så private aftaler fra en ICS-kilde skjules, men
//! systemkalenderens aftaler skjules kun, hvis de er aflyst.

use chrono::{DateTime, TimeZone, Utc};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
use objc2::{msg_send, sel};
use objc2_foundation::{NSArray, NSDate, NSError, NSString, NSURL};

use super::{CalendarEvent, CalendarSource, SourceKind};

#[link(name = "EventKit", kind = "framework")]
unsafe extern "C" {}

/// EKEntityTypeEvent
const ENTITY_EVENT: isize = 0;
/// EKEventStatusCanceled
const STATUS_CANCELED: isize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    NotDetermined,
    Restricted,
    Denied,
    Granted,
    /// Kun skriveadgang (macOS 14+): appen kan ikke læse aftaler.
    WriteOnly,
}

fn store_class() -> Option<&'static AnyClass> {
    AnyClass::get(c"EKEventStore")
}

pub fn access() -> Access {
    let Some(cls) = store_class() else {
        return Access::Restricted;
    };
    let status: isize = unsafe { msg_send![cls, authorizationStatusForEntityType: ENTITY_EVENT] };
    match status {
        0 => Access::NotDetermined,
        1 => Access::Restricted,
        2 => Access::Denied,
        3 => Access::Granted,
        _ => Access::WriteOnly,
    }
}

fn new_store() -> Option<Retained<AnyObject>> {
    let cls = store_class()?;
    unsafe { msg_send![cls, new] }
}

/// Spørg om adgang (macOS viser dialogen én gang). `done` kaldes med svaret
/// på en tråd, EventKit vælger.
pub fn request_access(done: impl Fn(bool) + Send + 'static) {
    let Some(store) = new_store() else {
        done(false);
        return;
    };
    // Butikken skal leve, til svaret er kommet: blokken holder den.
    let keep = store.clone();
    let block = block2::RcBlock::new(move |granted: Bool, _err: *mut NSError| {
        let _ = &keep;
        done(granted.as_bool())
    });
    let full: Sel = sel!(requestFullAccessToEventsWithCompletion:);
    let responds: bool = unsafe { msg_send![&*store, respondsToSelector: full] };
    unsafe {
        if responds {
            // macOS 14+
            let _: () = msg_send![&*store, requestFullAccessToEventsWithCompletion: &*block];
        } else {
            let _: () = msg_send![&*store, requestAccessToEntityType: ENTITY_EVENT, completion: &*block];
        }
    }
}

fn utc(d: &NSDate) -> Option<DateTime<Utc>> {
    let secs = d.timeIntervalSince1970();
    Utc.timestamp_opt(secs.floor() as i64, 0).single()
}

fn email(participant: &AnyObject) -> Option<String> {
    let url: Option<Retained<NSURL>> = unsafe { msg_send![participant, URL] };
    let s = url?.absoluteString()?.to_string();
    let addr = s.strip_prefix("mailto:").unwrap_or(&s);
    addr.contains('@').then(|| addr.to_ascii_lowercase())
}

pub struct EventKitSource;

impl CalendarSource for EventKitSource {
    fn key(&self) -> String {
        "ek".into()
    }

    fn events(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<CalendarEvent>, String> {
        if access() != Access::Granted {
            return Err(crate::i18n::t("kalenderkilder.err.no_access").into());
        }
        let store = new_store().ok_or("EventKit findes ikke")?;
        let start = NSDate::dateWithTimeIntervalSince1970(from.timestamp() as f64);
        let end = NSDate::dateWithTimeIntervalSince1970(to.timestamp() as f64);
        let none: Option<&AnyObject> = None;
        let pred: Option<Retained<AnyObject>> = unsafe {
            msg_send![&*store, predicateForEventsWithStartDate: &*start, endDate: &*end, calendars: none]
        };
        let pred = pred.ok_or("EventKit kunne ikke søge")?;
        let list: Option<Retained<NSArray<AnyObject>>> =
            unsafe { msg_send![&*store, eventsMatchingPredicate: &*pred] };
        let Some(list) = list else { return Ok(vec![]) };
        let mut out = Vec::new();
        for i in 0..list.count() {
            let ev = list.objectAtIndex(i);
            let status: isize = unsafe { msg_send![&*ev, status] };
            if status == STATUS_CANCELED {
                continue;
            }
            let title: Option<Retained<NSString>> = unsafe { msg_send![&*ev, title] };
            let id: Option<Retained<NSString>> = unsafe { msg_send![&*ev, eventIdentifier] };
            let s: Option<Retained<NSDate>> = unsafe { msg_send![&*ev, startDate] };
            let e: Option<Retained<NSDate>> = unsafe { msg_send![&*ev, endDate] };
            let all_day: Bool = unsafe { msg_send![&*ev, isAllDay] };
            let (Some(s), Some(e)) = (s.as_deref().and_then(utc), e.as_deref().and_then(utc)) else {
                continue;
            };
            let mut attendees = Vec::new();
            let list: Option<Retained<NSArray<AnyObject>>> = unsafe { msg_send![&*ev, attendees] };
            if let Some(a) = list {
                for j in 0..a.count() {
                    if let Some(m) = email(&a.objectAtIndex(j)) {
                        attendees.push(m);
                    }
                }
            }
            let organizer: Option<Retained<AnyObject>> = unsafe { msg_send![&*ev, organizer] };
            if let Some(m) = organizer.as_deref().and_then(email)
                && !attendees.contains(&m)
            {
                attendees.push(m);
            }
            out.push(CalendarEvent {
                id: format!(
                    "ek:{}:{}",
                    id.map(|i| i.to_string()).unwrap_or_default(),
                    s.timestamp()
                ),
                title: title.map(|t| t.to_string()).unwrap_or_default(),
                start: s,
                end: e.max(s),
                all_day: all_day.as_bool(),
                attendees,
                private: false,
                source: SourceKind::EventKit,
            });
        }
        out.sort_by_key(|e| e.start);
        Ok(out)
    }
}
