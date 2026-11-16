//! "Lær TimeTrack at kende": observér først, spørg bagefter.
//!
//! Detektionen grupperer de hyppigste kilder, den endnu ikke kan placere
//! (tt-matcher `observe`), og UI'et stiller ét spørgsmål ad gangen. Svaret
//! bliver til mønstre, der også gælder for de ubekræftede blokke bagud.
//! Kun kildernes korte form (repo, mappe, domæne, dokument- eller
//! titelskabelon) når UI'et, aldrig hele titler.

use super::Id;

/// Hvilken slags kilde.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObserverSourceKind {
    Repo,
    Folder,
    Domain,
    Document,
    Title,
}

/// En kilde i en gruppe.
#[derive(Clone, Debug, PartialEq)]
pub struct ObserverSource {
    pub kind: ObserverSourceKind,
    /// Kort form: `acme/bageriet-shop`, `bageriet.dk`, `…/kunder/bb`.
    pub label: String,
    pub minutes: u32,
}

/// En gruppe kilder, der ser ud til at høre sammen.
#[derive(Clone, Debug, PartialEq)]
pub struct ObserverGroup {
    /// Stabil id (til svar og "Aldrig").
    pub id: Id,
    /// Største først.
    pub sources: Vec<ObserverSource>,
    /// Ord fra titler (mails, faner, møder), der bandt kilderne sammen.
    pub hints: Vec<String>,
    pub minutes: u32,
    /// Kendt kunde/projekt, gruppen nok hører til.
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    /// Hvorfor (dansk, fra matcheren).
    pub reason: Option<String>,
    /// Navn til en ny kunde, når intet kendt passer.
    pub new_name: Option<String>,
    /// Detektionen kan allerede placere gruppen (vises kun i Aktivitet).
    pub known: bool,
}

/// Kortet "Lær TimeTrack at kende" på I dag.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ObserverCard {
    /// Sporingen kører eller har kørt (ellers vises kortet ikke).
    pub active: bool,
    /// Observeret aktivitet de seneste 14 dage.
    pub observed_minutes: u32,
    /// Så meget skal der til, før der spørges.
    pub ready_after_minutes: u32,
    /// Det næste spørgsmål.
    pub question: Option<ObserverGroup>,
    /// Spørgsmål tilbage efter dette.
    pub remaining: usize,
    /// Besvarede spørgsmål i alt.
    pub answered: u32,
}

/// Brugerens svar.
#[derive(Clone, Debug, PartialEq)]
pub enum ObserverReply {
    /// Kilderne hører til kunden (og evt. projektet).
    Target {
        customer_id: Id,
        project_id: Option<Id>,
    },
    /// Opret kunden og lær kilderne på den (ét klik).
    NewCustomer { name: String },
    /// Spørg igen senere.
    Skip,
    /// Spørg aldrig om disse kilder igen.
    Never,
}

// ---------- Demo (MockBackend) ----------

/// Hvad demoen husker om svarene.
#[derive(Default)]
pub(super) struct MockObserver {
    /// Besvarede eller "aldrig"-markerede grupper.
    pub done: Vec<Id>,
    /// Sprunget over (spørges sidst).
    pub skipped: Vec<Id>,
}

fn src(kind: ObserverSourceKind, label: &str, minutes: u32) -> ObserverSource {
    ObserverSource {
        kind,
        label: label.into(),
        minutes,
    }
}

/// Demoens grupper: to ukendte og én, detektionen allerede kender.
pub(super) fn demo_groups() -> Vec<ObserverGroup> {
    vec![
        ObserverGroup {
            id: "demo-bageriet".into(),
            sources: vec![
                src(ObserverSourceKind::Repo, "acme/bageriet-shop", 95),
                src(ObserverSourceKind::Domain, "bageriet.dk", 40),
            ],
            hints: vec!["bageriet".into()],
            minutes: 135,
            customer_id: Some("kunde_bageriet".into()),
            project_id: None,
            reason: Some("\"bageriet\" ligner kunden Bageriet på Hjørnet".into()),
            new_name: None,
            known: false,
        },
        ObserverGroup {
            id: "demo-nordlys".into(),
            sources: vec![
                src(ObserverSourceKind::Document, "na forside #", 50),
                src(ObserverSourceKind::Domain, "nordlys-ark.dk", 30),
                src(ObserverSourceKind::Title, "nordlys", 25),
            ],
            hints: vec!["nordlys".into()],
            minutes: 105,
            customer_id: None,
            project_id: None,
            reason: None,
            new_name: Some("Nordlys".into()),
            known: false,
        },
        ObserverGroup {
            id: "demo-klinik".into(),
            sources: vec![src(ObserverSourceKind::Folder, "…/kunder/klinik", 70)],
            hints: vec![],
            minutes: 70,
            customer_id: Some("kunde_klinik".into()),
            project_id: None,
            reason: Some("mappen …/kunder/klinik er lært".into()),
            new_name: None,
            known: true,
        },
    ]
}

impl MockObserver {
    /// Kortet. `TT_DEMO=laer-tidligt` viser tilstanden før nok data.
    pub(super) fn card(&self) -> ObserverCard {
        let early = std::env::var("TT_DEMO").is_ok_and(|d| d.contains("laer-tidligt"));
        let mut open: Vec<ObserverGroup> = demo_groups()
            .into_iter()
            .filter(|g| !g.known && !self.done.contains(&g.id))
            .collect();
        open.sort_by_key(|g| self.skipped.contains(&g.id));
        ObserverCard {
            active: true,
            observed_minutes: if early { 45 } else { 312 },
            ready_after_minutes: 120,
            remaining: open.len().saturating_sub(1),
            question: if early { None } else { open.into_iter().next() },
            answered: self.done.len() as u32,
        }
    }

    pub(super) fn answer(&mut self, id: &str, reply: &ObserverReply) -> super::Result<()> {
        if !demo_groups().iter().any(|g| g.id == id) {
            return Err(super::BackendError::NotFound("Spørgsmålet".into()));
        }
        match reply {
            ObserverReply::Skip => {
                if !self.skipped.iter().any(|s| s == id) {
                    self.skipped.push(id.into());
                }
            }
            _ => self.done.push(id.into()),
        }
        Ok(())
    }
}
