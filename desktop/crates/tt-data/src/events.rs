//! Hændelseskanalen, som UI'et lytter på. Runtime-uafhængig: hver lytter får
//! sin egen `async_channel::Receiver`, som kan afventes fra GPUI's executor
//! eller læses med `try_recv`.

use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

/// Områder, der kan ændres (samme som web's `DeviceEntity` + lokale).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Entity {
    Timer,
    Entries,
    Clients,
    Projects,
    Klippekort,
    Invoices,
    Tasks,
    Rules,
    Entitlements,
}

impl Entity {
    pub const ALL: [Entity; 9] = [
        Entity::Timer,
        Entity::Entries,
        Entity::Clients,
        Entity::Projects,
        Entity::Klippekort,
        Entity::Invoices,
        Entity::Tasks,
        Entity::Rules,
        Entity::Entitlements,
    ];

    /// Navnet på web's SSE-strøm (`realtime-device.ts`).
    pub fn from_wire(s: &str) -> Option<Entity> {
        Some(match s {
            "timer" => Entity::Timer,
            "entries" => Entity::Entries,
            "clients" => Entity::Clients,
            "projects" => Entity::Projects,
            "klippekort" => Entity::Klippekort,
            "invoices" => Entity::Invoices,
            "tasks" => Entity::Tasks,
            "rules" => Entity::Rules,
            "entitlements" => Entity::Entitlements,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Entity::Timer => "timer",
            Entity::Entries => "entries",
            Entity::Clients => "clients",
            Entity::Projects => "projects",
            Entity::Klippekort => "klippekort",
            Entity::Invoices => "invoices",
            Entity::Tasks => "tasks",
            Entity::Rules => "rules",
            Entity::Entitlements => "entitlements",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogoutReason {
    /// Brugeren loggede selv ud.
    User,
    /// Serveren svarede UNAUTHORIZED (tilbagekaldt i web eller udløbet).
    Unauthorized,
    /// SSE-strømmen sendte `revoked`.
    Revoked,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Event {
    /// Timeren er ændret (her eller i web/udvidelse/mobil). Hent tilstanden.
    TimerChanged { version: i64 },
    /// Data er ændret; cachen for områderne er ugyldig. Hent igen.
    DataChanged { entities: Vec<Entity> },
    LoggedOut { reason: LogoutReason },
    Online,
    Offline,
    /// Antal handlinger, der venter i offline-køen.
    QueueChanged { pending: usize },
    /// En køet handling blev afvist endeligt af serveren (fx validering). Den
    /// er flyttet til de afviste registreringer (dead-letter) og kan sendes
    /// igen, eksporteres eller kasseres.
    QueueRejected { op_id: String, message: String },
    /// Live-strømmen kører (true) eller er nede/slået fra (false: polling).
    Realtime { connected: bool },
    /// Antal afviste registreringer (dead-letter) for brugeren er ændret.
    DeadLetterChanged { count: usize },
}

#[derive(Clone, Default)]
pub struct Events {
    listeners: Arc<Mutex<Vec<async_channel::Sender<Event>>>>,
}

impl std::fmt::Debug for Events {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Events").field("listeners", &self.listeners.lock().len()).finish()
    }
}

impl Events {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self) -> async_channel::Receiver<Event> {
        let (tx, rx) = async_channel::unbounded();
        self.listeners.lock().push(tx);
        rx
    }

    pub fn emit(&self, event: Event) {
        log::debug!("hændelse: {event:?}");
        self.listeners.lock().retain(|tx| tx.try_send(event.clone()).is_ok());
    }

    pub fn data_changed(&self, entities: &[Entity]) {
        if !entities.is_empty() {
            self.emit(Event::DataChanged { entities: entities.to_vec() });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listener_gets_events_and_dropped_ones_are_pruned() {
        let events = Events::new();
        let a = events.subscribe();
        let b = events.subscribe();
        drop(b);
        events.emit(Event::Online);
        assert_eq!(a.try_recv().unwrap(), Event::Online);
        assert_eq!(events.listeners.lock().len(), 1);
    }

    #[test]
    fn wire_names_round_trip() {
        for e in Entity::ALL {
            assert_eq!(Entity::from_wire(e.as_str()), Some(e));
        }
        assert_eq!(Entity::from_wire("ukendt"), None);
    }
}
