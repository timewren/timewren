//! Afviste registreringer (offline-køens dead-letter) set fra UI'et.
//!
//! En ændring, web afviste endeligt, mens den blev sendt fra offline-køen,
//! slettes ikke: den ligger her, til brugeren sender den igen, eksporterer
//! den som CSV eller kasserer den (tt-data `cloud/dead_letter.rs`).

use chrono::{DateTime, Local, NaiveDate, NaiveTime};

use super::Id;

/// Én afvist registrering.
#[derive(Clone, Debug, PartialEq)]
pub struct Rejected {
    /// Køens `op_id` (bruges til "Send igen" og "Kassér").
    pub id: Id,
    /// Handlingens art: `create_entry`, `update_entry`, `delete_entry`,
    /// `archive_client`, `create_client` … (oversættes i UI'et).
    pub kind: String,
    /// Navnet på det, der oprettes (kunde, projekt, opgave, klippekort).
    pub subject: Option<String>,
    /// Postens dag og tid, hvis handlingen er en tidspost.
    pub date: Option<NaiveDate>,
    pub start: Option<NaiveTime>,
    pub end: Option<NaiveTime>,
    pub minutes: Option<u32>,
    pub description: Option<String>,
    /// Kundens og projektets navn, hvis kendt.
    pub customer: Option<String>,
    pub project: Option<String>,
    /// Web's fejltekst (dansk).
    pub error: String,
    pub rejected_at: DateTime<Local>,
}

/// Resultatet af "Send igen".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RetryResult {
    /// Gemt af web.
    pub sent: usize,
    /// Afvist igen (ligger stadig blandt de afviste med den nye fejltekst).
    pub rejected: usize,
    /// Offline: ligger i den almindelige kø og sendes, når forbindelsen er tilbage.
    pub queued: usize,
}

/// Filnavnet ved eksport (samme format som migreringens fil).
pub const REJECTED_CSV: &str = "afviste-registreringer.csv";

/// CSV-rækken for en afvist tidspost (andre handlinger udelades, som i tt-data).
pub fn csv_row(r: &Rejected) -> Option<tt_data::unsynced_csv::Row> {
    let date = r.date?;
    let time = |t: Option<NaiveTime>| t.map(|t| t.format("%H:%M").to_string()).unwrap_or_default();
    let description = r.description.clone().unwrap_or_default();
    Some(tt_data::unsynced_csv::Row {
        date: date.format("%Y-%m-%d").to_string(),
        start: time(r.start),
        end: time(r.end),
        hours: r
            .minutes
            .map(|m| tt_data::unsynced_csv::hours_from_secs(i64::from(m) * 60))
            .unwrap_or_default(),
        client: r.customer.clone().unwrap_or_default(),
        project: r.project.clone().unwrap_or_default(),
        description: if r.kind == "update_entry" {
            format!("Rettelse: {description}")
        } else {
            description
        },
    })
}

// ---------------------------------------------------------------- mock

/// `MockBackend`'s afviste registreringer (tom, til demo eller tests fylder dem).
#[derive(Default)]
pub struct MockRejected {
    pub items: Vec<Rejected>,
    /// Sat: "Send igen" afvises igen med denne tekst. Ellers lykkes den.
    pub retry_error: Option<String>,
}

impl MockRejected {
    /// Tre afviste omkring `today` (til skærmbilleder).
    pub fn demo(today: NaiveDate) -> Vec<Rejected> {
        let at = |d: NaiveDate, h: u32, m: u32| {
            d.and_hms_opt(h, m, 0)
                .and_then(|t| t.and_local_timezone(Local).single())
                .unwrap_or_else(Local::now)
        };
        let t = |h: u32, m: u32| NaiveTime::from_hms_opt(h, m, 0);
        let yesterday = today.pred_opt().unwrap_or(today);
        vec![
            Rejected {
                id: "afvist_1".into(),
                kind: "create_entry".into(),
                subject: None,
                date: Some(yesterday),
                start: t(9, 0),
                end: t(11, 30),
                minutes: Some(150),
                description: Some("Produktsider og kurv".into()),
                customer: Some("Bageriet på Hjørnet".into()),
                project: Some("Ny webshop".into()),
                error: "Din plan er låst. Opgradér for at registrere ny tid".into(),
                rejected_at: at(today, 8, 12),
            },
            Rejected {
                id: "afvist_2".into(),
                kind: "create_entry".into(),
                subject: None,
                date: Some(yesterday),
                start: t(13, 0),
                end: t(14, 15),
                minutes: Some(75),
                description: Some("Møde om booking".into()),
                customer: Some("Klinik Søndergade".into()),
                project: Some("Booking-modul".into()),
                error: "Perioden er låst for ændringer".into(),
                rejected_at: at(today, 8, 12),
            },
            Rejected {
                id: "afvist_3".into(),
                kind: "create_client".into(),
                subject: Some("Cykelsmeden".into()),
                date: None,
                start: None,
                end: None,
                minutes: None,
                description: None,
                customer: None,
                project: None,
                error: "Din plan tillader højst 5 aktive kunder".into(),
                rejected_at: at(today, 8, 13),
            },
        ]
    }
}

impl super::MockBackend {
    /// Demo og tests: læg afviste registreringer i mocken.
    pub fn set_rejected(&self, items: Vec<Rejected>) {
        self.afviste.lock().expect("mock-lås").items = items;
    }

    /// Tests: "Send igen" afvises igen med `error` (`None` = lykkes).
    pub fn set_retry_error(&self, error: Option<&str>) {
        self.afviste.lock().expect("mock-lås").retry_error = error.map(str::to_owned);
    }

    pub(super) fn mock_rejected_count(&self) -> usize {
        self.afviste.lock().expect("mock-lås").items.len()
    }

    pub(super) fn mock_rejected(&self) -> Vec<Rejected> {
        self.afviste.lock().expect("mock-lås").items.clone()
    }

    pub(super) fn mock_retry_rejected(&self, id: Option<&str>) -> super::Result<RetryResult> {
        let mut a = self.afviste.lock().expect("mock-lås");
        let mut out = RetryResult::default();
        let retry_error = a.retry_error.clone();
        let mut kept = Vec::new();
        for mut r in std::mem::take(&mut a.items) {
            if id.is_some_and(|id| id != r.id) {
                kept.push(r);
                continue;
            }
            match &retry_error {
                Some(e) => {
                    r.error = e.clone();
                    r.rejected_at = Local::now();
                    out.rejected += 1;
                    kept.push(r);
                }
                None => out.sent += 1,
            }
        }
        a.items = kept;
        if id.is_some() && out == RetryResult::default() {
            return Err(super::BackendError::NotFound("Registreringen".into()));
        }
        Ok(out)
    }

    pub(super) fn mock_discard_rejected(&self, id: &str) -> super::Result<()> {
        let mut a = self.afviste.lock().expect("mock-lås");
        let before = a.items.len();
        a.items.retain(|r| r.id != id);
        if a.items.len() == before {
            return Err(super::BackendError::NotFound("Registreringen".into()));
        }
        Ok(())
    }

    pub(super) fn mock_rejected_csv(&self) -> String {
        let a = self.afviste.lock().expect("mock-lås");
        let rows: Vec<_> = a.items.iter().filter_map(csv_row).collect();
        tt_data::unsynced_csv::write(&rows)
    }
}
