//! "Altid sådan" og regeloversigten (UX-runden 0.2.28, vaelger).
//!
//! En regel er datalagets `MatchingRule` (lokalt i SQLite, i cloud web's
//! `rules.*`), som detektionen allerede bruger. Lærte mønstre er
//! tt-matchers `PatternStore`. Her er kun UI'ets syn på dem: omfang med
//! forhåndsvisning, og rækker, der kan rettes, slås fra og slettes.

use super::Id;

/// Hvad en "Altid sådan"-regel gælder for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ScopeKind {
    /// Git-repoets remote.
    Repo,
    /// Mappen og alt under den.
    Folder,
    /// Domænet og dets underdomæner.
    Domain,
    /// Hele programmet.
    App,
    /// Et ord eller en del af vinduestitlen.
    TitleWord,
}

impl ScopeKind {
    pub const ALL: [ScopeKind; 5] = [
        ScopeKind::Repo,
        ScopeKind::Folder,
        ScopeKind::Domain,
        ScopeKind::App,
        ScopeKind::TitleWord,
    ];

    /// Datalagets regelslags (`RuleKind::Repo` dækker både remote og sti).
    pub fn rule_kind(self) -> tt_data::RuleKind {
        match self {
            ScopeKind::Repo | ScopeKind::Folder => tt_data::RuleKind::Repo,
            ScopeKind::Domain => tt_data::RuleKind::Domain,
            ScopeKind::App => tt_data::RuleKind::App,
            ScopeKind::TitleWord => tt_data::RuleKind::TitleTemplate,
        }
    }

    /// Nøglen til UI-teksten ("repo", "mappe" …).
    pub fn key(self) -> &'static str {
        match self {
            ScopeKind::Repo => "maal.omfang.repo",
            ScopeKind::Folder => "maal.omfang.mappe",
            ScopeKind::Domain => "maal.omfang.domaene",
            ScopeKind::App => "maal.omfang.app",
            ScopeKind::TitleWord => "maal.omfang.titel",
        }
    }
}

/// Et muligt omfang for de valgte blokke med forhåndsvisning.
#[derive(Clone, Debug, PartialEq)]
pub struct RuleScope {
    pub kind: ScopeKind,
    pub value: String,
    /// Blokke i dag, der matcher.
    pub today: usize,
    /// Blokke de sidste 14 dage (inkl. i dag), der matcher.
    pub recent: usize,
}

/// Hvor en række i regeloversigten kommer fra.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuleOrigin {
    /// Brugerens regel (datalaget, synkroniseres med web).
    Rule,
    /// Lært mønster (detektionen, synkroniseres med web).
    Pattern,
}

/// Slags i oversigten (regler og mønstre har lidt forskellige).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuleRowKind {
    Repo,
    Folder,
    Domain,
    App,
    AppKeyword,
    Title,
    Url,
}

impl RuleRowKind {
    pub fn key(self) -> &'static str {
        match self {
            RuleRowKind::Repo => "maal.omfang.repo",
            RuleRowKind::Folder => "maal.omfang.mappe",
            RuleRowKind::Domain => "maal.omfang.domaene",
            RuleRowKind::App => "maal.omfang.app",
            RuleRowKind::AppKeyword => "maal.omfang.dokument",
            RuleRowKind::Title => "maal.omfang.titel",
            RuleRowKind::Url => "maal.omfang.url",
        }
    }

    /// Datalagets regel som rækkens slags.
    pub fn of_rule(kind: tt_data::RuleKind, pattern: &str) -> RuleRowKind {
        use tt_data::RuleKind as K;
        match kind {
            K::Repo if is_path(pattern) => RuleRowKind::Folder,
            K::Repo => RuleRowKind::Repo,
            K::Domain => RuleRowKind::Domain,
            K::App => RuleRowKind::App,
            K::AppKeyword => RuleRowKind::AppKeyword,
            K::TitleTemplate => RuleRowKind::Title,
            K::UrlPattern => RuleRowKind::Url,
        }
    }
}

/// Et repo-mønster, der er en sti (som `convert::matcher_rules`).
pub fn is_path(pattern: &str) -> bool {
    pattern.starts_with(['/', '~', '\\']) || pattern.as_bytes().get(1) == Some(&b':')
}

/// En regel eller et mønster i oversigten.
#[derive(Clone, Debug, PartialEq)]
pub struct RuleRow {
    /// Regler: datalagets id. Mønstre: "p:" + nøglen som JSON.
    pub id: Id,
    pub origin: RuleOrigin,
    pub kind: RuleRowKind,
    pub value: String,
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    /// "Ikke arbejde".
    pub not_work: bool,
    pub active: bool,
    /// Blokke de sidste 14 dage, der matcher.
    pub hits: usize,
    /// Bekræftelser og rettelser bag mønsteret (regler: web's brug).
    pub confirmations: u32,
}

/// Resultatet af "Gælder også bagud".
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BackwardResult {
    pub entries: usize,
    pub minutes: u32,
    pub days: usize,
}

/// Så mange dage tilbage (inkl. i dag) tæller forhåndsvisningen og
/// oversigten, og så langt gælder "bagud".
pub const RECENT_DAYS: u64 = 14;

/// I dag og de 13 dage før (nyeste først).
pub fn recent_days(today: chrono::NaiveDate) -> Vec<chrono::NaiveDate> {
    (0..RECENT_DAYS)
        .filter_map(|i| today.checked_sub_days(chrono::Days::new(i)))
        .collect()
}
