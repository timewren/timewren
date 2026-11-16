//! Det, notifikationernes knapper og mødekortet gør mod datalaget.
//!
//! Funktionerne kører på en baggrundstråd og er testet mod `MockBackend`.
//! Knapper, der skal vise noget (Vælg, Gennemgå, Ret), håndteres af
//! `AppView` (`app.rs`), som bringer vinduet frem.

use crate::backend::{Backend, BackendError, DateRange, Id, Result, TimerTarget};
use crate::i18n::{t, tf};
use crate::kalenderkilder::{Kalender, PendingMeeting};

/// Målet på den seneste registrering (de sidste 30 dage).
pub fn last_target(b: &dyn Backend) -> Result<Option<TimerTarget>> {
    let today = b.today();
    let range = DateRange {
        from: today - chrono::Duration::days(30),
        to: today,
    };
    let latest = b
        .entries(range)?
        .into_iter()
        .max_by_key(|e| (e.date, e.end.or(e.start)));
    Ok(latest.map(|e| TimerTarget {
        customer_id: Some(e.customer_id),
        project_id: e.project_id,
        task_id: e.task_id,
        description: e.description,
    }))
}

/// "Start sidste": start en timer på den seneste registrerings mål.
pub fn start_last(b: &dyn Backend) -> Result<String> {
    let target = last_target(b)?
        .ok_or_else(|| BackendError::Validation(t("handling.err.no_last").into()))?;
    let name = target
        .customer_id
        .as_deref()
        .and_then(|id| b.customers(true).ok()?.into_iter().find(|c| c.id == id))
        .map(|c| c.name)
        .unwrap_or_default();
    crate::palette::start_on(b, target)?;
    Ok(tf("handling.started", &[("customer", &name)]))
}

/// "Bekræft" på et forslag.
pub fn confirm(b: &dyn Backend, id: &str) -> Result<String> {
    let e = b.confirm_suggestion(id, None)?;
    Ok(tf("handling.confirmed", &[("minutes", &e.minutes.to_string())]))
}

#[derive(Clone, Debug, PartialEq)]
pub enum MeetingOutcome {
    Registered(String),
    /// Mødet har ingen kunde: brugeren skal vælge (Ret).
    NeedsTarget(PendingMeeting),
}

/// "Registrér": gem mødet på den kunde, det er koblet til.
pub fn register_meeting(b: &dyn Backend, k: &Kalender, id: &str) -> Result<MeetingOutcome> {
    let m = k
        .take_pending(id)
        .ok_or_else(|| BackendError::NotFound(t("handling.err.meeting_gone").into()))?;
    let Some(customer) = m.customer_id.clone() else {
        k.put_back(m.clone());
        return Ok(MeetingOutcome::NeedsTarget(m));
    };
    let project = m.project_id.clone();
    register_on(b, k, m, customer, project).map(MeetingOutcome::Registered)
}

/// Gem mødet på det valgte mål ("Ret"). Fejler det, venter mødet igen.
pub fn register_on(
    b: &dyn Backend,
    k: &Kalender,
    m: PendingMeeting,
    customer_id: Id,
    project_id: Option<Id>,
) -> Result<String> {
    let entry = m.entry(customer_id, project_id);
    match b.create_entry(entry.clone()) {
        Ok(_) => {
            k.meeting_registered(&m, &entry);
            let name = b
                .customers(true)
                .ok()
                .and_then(|cs| cs.into_iter().find(|c| c.id == entry.customer_id))
                .map(|c| c.name)
                .unwrap_or_default();
            Ok(tf(
                "handling.meeting_registered",
                &[("minutes", &entry.minutes.to_string()), ("customer", &name)],
            ))
        }
        Err(e) => {
            k.put_back(m);
            Err(e)
        }
    }
}

/// "Ignorér": mødet glemmes.
pub fn ignore_meeting(k: &Kalender, id: &str) -> bool {
    k.take_pending(id).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::MockBackend;
    use crate::kalenderkilder::Kalender;
    use crate::moeder::{Foreground, MeetingKind};
    use chrono::{Duration, Local, NaiveDate, TimeZone, Utc};

    fn kal() -> Kalender {
        Kalender::new(None, Box::new(|_| vec![]))
    }

    /// Et Teams-møde fra 9:00 til 9:42 lokal tid på mockens dag.
    fn meeting(k: &Kalender, day: NaiveDate, hint: &str) -> PendingMeeting {
        let start = Local
            .from_local_datetime(&day.and_hms_opt(9, 0, 0).unwrap())
            .unwrap()
            .with_timezone(&Utc);
        let fg = Foreground::Meeting {
            kind: MeetingKind::Teams,
            hint: hint.into(),
        };
        let mut s = 0;
        while s <= 42 * 60 {
            assert!(k.observe(start + Duration::seconds(s), fg.clone()).is_none());
            s += 5;
        }
        let mut done = None;
        while done.is_none() {
            done = k.observe(start + Duration::seconds(s), Foreground::Other);
            s += 5;
        }
        done.unwrap()
    }

    fn mock() -> (MockBackend, NaiveDate) {
        let day = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        (MockBackend::with_today(day), day)
    }

    fn catalog(b: &MockBackend, k: &Kalender) {
        k.set_catalog(&b.customers(false).unwrap(), &b.projects(None, false).unwrap());
    }

    #[test]
    fn registrer_gemmer_moedet_paa_kunden_fra_titlen() {
        let (b, day) = mock();
        let k = kal();
        catalog(&b, &k);
        let name = b.customers(false).unwrap()[0].name.clone();
        let p = meeting(&k, day, &format!("Møde med {name} | Microsoft Teams"));
        assert!(p.customer_id.is_some(), "kunden er fundet i titlen");
        let before = b.entries(DateRange::day(day)).unwrap().len();
        let out = register_meeting(&b, &k, &p.meeting.id).unwrap();
        assert!(matches!(out, MeetingOutcome::Registered(ref m) if m.contains("42 min")), "{out:?}");
        let entries = b.entries(DateRange::day(day)).unwrap();
        assert_eq!(entries.len(), before + 1);
        let e = entries.iter().find(|e| e.description == "Teams-møde").expect("posten");
        assert_eq!((e.minutes, e.start.map(|t| t.to_string())), (42, Some("09:00:00".into())));
        assert!(k.pending().is_empty());
        // Anden gang: mødet er besvaret
        assert!(matches!(
            register_meeting(&b, &k, &p.meeting.id),
            Err(BackendError::NotFound(_))
        ));
    }

    #[test]
    fn registrer_uden_kunde_beder_om_at_vaelge_og_ret_gemmer() {
        let (b, day) = mock();
        let k = kal();
        catalog(&b, &k);
        let p = meeting(&k, day, "Microsoft Teams-møde");
        assert_eq!(p.customer_id, None);
        let MeetingOutcome::NeedsTarget(m) = register_meeting(&b, &k, &p.meeting.id).unwrap() else {
            panic!("skal vælge kunde")
        };
        assert_eq!(k.pending().len(), 1, "mødet venter stadig");
        let c = b.customers(false).unwrap()[0].id.clone();
        let m = k.take_pending(&m.meeting.id).unwrap();
        let msg = register_on(&b, &k, m, c, None).unwrap();
        assert!(msg.contains("42 min"), "{msg}");
        assert!(k.pending().is_empty());
    }

    #[test]
    fn ignorer_glemmer_moedet() {
        let (b, day) = mock();
        let k = kal();
        catalog(&b, &k);
        let p = meeting(&k, day, "Teams");
        assert!(ignore_meeting(&k, &p.meeting.id));
        assert!(!ignore_meeting(&k, &p.meeting.id));
        assert!(k.pending().is_empty());
    }

    #[test]
    fn fejl_ved_gem_lader_moedet_vente() {
        let (b, day) = mock();
        let k = kal();
        catalog(&b, &k);
        let p = meeting(&k, day, "Teams");
        let m = k.take_pending(&p.meeting.id).unwrap();
        // En kunde, der ikke findes, afvises af datalaget
        assert!(register_on(&b, &k, m, "findes_ikke".into(), None).is_err());
        assert_eq!(k.pending().len(), 1);
    }

    #[test]
    fn start_sidste_bruger_den_nyeste_registrering() {
        let (b, _) = mock();
        let last = last_target(&b).unwrap().expect("demodata har poster");
        let msg = start_last(&b).unwrap();
        let timer = b.timer().unwrap();
        assert_eq!(timer.customer_id, last.customer_id);
        assert_eq!(timer.project_id, last.project_id);
        assert!(!msg.is_empty());
        // Uden poster: en forståelig fejl
        let empty = MockBackend::empty(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
        assert!(matches!(start_last(&empty), Err(BackendError::Validation(_))));
    }

    #[test]
    fn bekraeft_gemmer_forslaget() {
        let (b, day) = mock();
        let Some(s) = b.suggestions(day).unwrap().into_iter().find(|s| s.customer_id.is_some()) else {
            return; // demodata uden forslag på dagen
        };
        let msg = confirm(&b, &s.id).unwrap();
        assert!(msg.contains(&s.minutes().to_string()), "{msg}");
        assert!(b.suggestions(day).unwrap().iter().all(|x| x.id != s.id));
    }
}
