//! Et ur, der kan skiftes ud i tests. Tidsgrænser (licens, påmindelser,
//! pomodoro) spørger uret i stedet for `Utc::now()`, så testene kan spole.

use std::sync::Mutex;

use chrono::{DateTime, Duration, Local, Utc};

pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;

    /// Lokal tid (til arbejdstid og dagsgrænser).
    fn local(&self) -> DateTime<Local> {
        self.now().with_timezone(&Local)
    }
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Et ur, testen selv stiller.
pub struct ManualClock(Mutex<DateTime<Utc>>);

impl ManualClock {
    pub fn new(at: DateTime<Utc>) -> Self {
        ManualClock(Mutex::new(at))
    }

    pub fn advance(&self, by: Duration) {
        let mut g = self.0.lock().unwrap_or_else(|p| p.into_inner());
        *g += by;
    }

    pub fn set(&self, at: DateTime<Utc>) {
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = at;
    }
}

impl Clock for ManualClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}
