//! Ind- og uddata for matcheren.
//!
//! Alle typer er serde (camelCase), så de kan krydse IPC, gemmes i SQLite som
//! JSON og bruges direkte i labelset-filer. Tider er unix-sekunder (UTC);
//! visning i lokal tid er UI'ets opgave (se [`crate::format_span`]).

use serde::{Deserialize, Serialize};

/// Et stykke sammenhængende aktivitet fra capture (`tt-tracker`).
///
/// Felterne er de signaler, capture kan finde. Alt ud over `app`, `start` og
/// `end` er valgfrit, så en adapter fra trackerens egen type er triviel.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySegment {
    /// Trackerens id, hvis den har et. Bruges kun til at føre segmenter
    /// tilbage til forslaget.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Programnavn, fx `Google Chrome`, `Code`, `Microsoft Word`.
    pub app: String,
    /// Rå vinduestitel.
    #[serde(default)]
    pub title: String,
    /// Fuld URL fra browseren.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Domæne. Udledes af `url`, hvis det mangler.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Git-remote for repoet, fx `git@github.com:acme/timetrack.git`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_remote: Option<String>,
    /// Arbejdsmappe eller fil (editor, terminal).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Dokumentnavn fra dokumentapps (Word, Figma, Notion …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<String>,
    /// Start, unix-sekunder.
    pub start: i64,
    /// Slut, unix-sekunder (eksklusiv).
    pub end: i64,
}

impl ActivitySegment {
    /// Varighed i sekunder (aldrig negativ).
    pub fn duration(&self) -> i64 {
        (self.end - self.start).max(0)
    }
}

/// Hvem arbejdet er for: en kunde, et projekt eller begge.
///
/// Et projekt uden kunde er lovligt (interne projekter). Matcheren udfylder
/// `client_id` fra projektet, når det kendes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

impl Target {
    pub fn client(id: &str) -> Self {
        Self {
            client_id: Some(id.to_string()),
            project_id: None,
        }
    }

    pub fn project(client_id: Option<&str>, project_id: &str) -> Self {
        Self {
            client_id: client_id.map(str::to_string),
            project_id: Some(project_id.to_string()),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.client_id.is_none() && self.project_id.is_none()
    }

    /// To mål kan ligge i samme blok, når de ikke modsiger hinanden: samme
    /// kunde, og højst ét af dem nævner et projekt (eller samme projekt).
    pub fn compatible(&self, other: &Target) -> bool {
        // Et projekt uden kunde (internt) hører ikke til nogen kunde og kan
        // kun stå sammen med sig selv.
        let internal = |t: &Target| t.project_id.is_some() && t.client_id.is_none();
        if internal(self) || internal(other) {
            return self == other;
        }
        let clients_ok = match (&self.client_id, &other.client_id) {
            (Some(a), Some(b)) => a == b,
            _ => true,
        };
        let projects_ok = match (&self.project_id, &other.project_id) {
            (Some(a), Some(b)) => a == b,
            _ => true,
        };
        clients_ok
            && projects_ok
            && (self.client_id.is_some() || other.client_id.is_some() || self == other)
    }

    /// Det mest præcise af to forenelige mål.
    pub fn merge(&self, other: &Target) -> Target {
        Target {
            client_id: self.client_id.clone().or_else(|| other.client_id.clone()),
            project_id: self.project_id.clone().or_else(|| other.project_id.clone()),
        }
    }
}

/// En kunde, som web eller den lokale database kender den.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub id: String,
    pub name: String,
    /// Kundens egne domæner (fx `bageriet.dk`). Web har i dag kun
    /// portalens `customDomain`; feltet er klar til flere.
    #[serde(default)]
    pub domains: Vec<String>,
    #[serde(default)]
    pub archived: bool,
    /// Binavne (fx fra CVR, brugerudløst). Se [`crate::profile`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// CVR-nummer. Kun til søgning og visning; aktivitet slås aldrig op.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cvr: Option<String>,
    /// Domæner i kundens mailadresser (gratis mailtjenester tæller ikke).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mail_domains: Vec<String>,
    /// Repo-ejere (GitHub-organisation eller -bruger).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repo_owners: Vec<String>,
}

/// Et projekt med web's `urlPatterns`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub client_id: Option<String>,
    /// Mønstre med `*` og `?` matchet mod hele URL'en, præcis som web's
    /// `matchUrlPattern` i `extension.ts`.
    #[serde(default)]
    pub url_patterns: Vec<String>,
    #[serde(default)]
    pub archived: bool,
}

/// Udvidelsens site-kobling (`browser-extension/src/stores/siteStore.ts`).
///
/// Web: `extension.siteMappings.list` (domæne-reglerne i
/// `device_match_rules`) med felterne her og `lastUsed`. tt-data henter
/// dem (`Repository::site_mappings`), og tt-app lægger dem i kataloget.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteMapping {
    pub domain: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub usage_count: u32,
}

/// Felt en brugerregel ser på.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleField {
    App,
    Title,
    Url,
    Domain,
    Repo,
    Path,
    Document,
}

/// Sammenligning i en brugerregel. Alt er uden forskel på store og små bogstaver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleOp {
    Contains,
    Equals,
    StartsWith,
    /// `*` og `?` som i `urlPatterns`.
    Glob,
}

/// En regel brugeren selv har skrevet (lokalt eller hentet fra web).
///
/// TODO(web): web's `extension.rules.*` (tabellen `device_match_rules`)
/// gemmer stadig kun `kind` (domain, url, repo, app, title) + `pattern` →
/// projekt, kunde eller `notWork` ("ikke arbejde", feat/desktop-api-2), ikke
/// felt/operator/værdi som her. Forventet: `field`, `op` og `value` på
/// web's regel (eller en egen `extension.userRules.*`). Indtil da oversætter
/// tt-app slags + mønster til felt og operator (`engine/convert.rs`,
/// `matcher_rules`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    #[serde(default)]
    pub id: String,
    pub field: RuleField,
    pub op: RuleOp,
    pub value: String,
    /// `None` betyder "ikke arbejde": aktiviteten skal aldrig foreslås.
    #[serde(default)]
    pub target: Option<Target>,
    /// Højeste først.
    #[serde(default)]
    pub priority: i32,
    #[serde(default = "yes")]
    pub active: bool,
}

fn yes() -> bool {
    true
}

/// Slags identitet. Rækkefølgen er styrkeordenen: repo-remote > sti > domæne
/// > app+nøgleord.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityKind {
    RepoRemote,
    Path,
    Domain,
    AppKeyword,
}

/// En eksakt kobling mellem ét signal og en kunde/et projekt
/// ("dette repo ER projektet"). Sat af brugeren på projektet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityBinding {
    pub kind: IdentityKind,
    /// Repo-remote, sti, domæne eller nøgleord.
    pub value: String,
    /// Kun for `AppKeyword`: programmet nøgleordet gælder i. Tom = alle.
    #[serde(default)]
    pub app: Option<String>,
    /// `None` = "ikke arbejde".
    #[serde(default)]
    pub target: Option<Target>,
}

/// Alt matcheren ved om brugerens forretning. Hentes fra `Repository`
/// (web eller lokal DB); matcheren selv laver ingen IO.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    #[serde(default)]
    pub clients: Vec<Client>,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub identities: Vec<IdentityBinding>,
    #[serde(default)]
    pub site_mappings: Vec<SiteMapping>,
}

impl Catalog {
    pub fn client(&self, id: &str) -> Option<&Client> {
        self.clients.iter().find(|c| c.id == id)
    }

    pub fn project(&self, id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == id)
    }

    /// Udfylder kunden fra projektet og fjerner arkiverede/ukendte mål.
    /// `None`, hvis intet brugbart er tilbage.
    pub fn resolve(&self, target: &Target) -> Option<Target> {
        let project = target
            .project_id
            .as_deref()
            .and_then(|id| self.project(id))
            .filter(|p| !p.archived);
        let valid = |id: &String| self.client(id).is_some_and(|c| !c.archived);
        // Et projekt hos en anden kunde end målets kunde er en modsigelse:
        // stol på projektet, for det er det mest præcise. Er projektets kunde
        // arkiveret eller ukendt, står projektet alene.
        let client_id = match project {
            Some(p) if p.client_id.is_some() => p.client_id.clone().filter(valid),
            _ => target.client_id.clone().filter(valid),
        };
        let resolved = Target {
            client_id,
            project_id: project.map(|p| p.id.clone()),
        };
        (!resolved.is_empty()).then_some(resolved)
    }

    /// "Kunde / Projekt" til begrundelser og etiketter.
    pub fn describe(&self, target: &Target) -> String {
        let client = target
            .client_id
            .as_deref()
            .and_then(|id| self.client(id))
            .map(|c| c.name.as_str());
        let project = target
            .project_id
            .as_deref()
            .and_then(|id| self.project(id))
            .map(|p| p.name.as_str());
        match (client, project) {
            (Some(c), Some(p)) => format!("{c} / {p}"),
            (Some(c), None) => c.to_string(),
            (None, Some(p)) => p.to_string(),
            (None, None) => "ukendt".to_string(),
        }
    }
}

/// Lag i matchingen, i den rækkefølge de prøves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Layer {
    /// Brugerregler, projekters `urlPatterns` og udvidelsens site-koblinger.
    Rule,
    /// Eksakte identitetskoblinger og kunders egne domæner.
    Identity,
    /// Lærte mønstre fra bekræftelser og rettelser.
    Pattern,
    /// Navnematching (port af udvidelsens `smartMatching.ts`).
    Name,
    /// Svar fra en [`crate::Classifier`].
    Ai,
    /// Brugerens statistiske model: Naive Bayes over svage signaler og
    /// udglatning over dagen ([`crate::nb`], [`crate::smooth`]).
    Model,
}

/// Hvilket signal der afgjorde det.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Signal {
    Repo,
    Path,
    Domain,
    Url,
    App,
    Title,
    Document,
    /// Flere signaler (AI).
    Mixed,
}

/// Kilden til et forslag: lag + signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub layer: Layer,
    pub signal: Signal,
}

/// Matcherens bud for ét segment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub target: Target,
    /// 0..1.
    pub confidence: f32,
    pub source: Source,
    /// Kort dansk begrundelse, fx `Repoet github.com/acme/timetrack hører til projektet`.
    pub reason: String,
}

/// Udfaldet for ét segment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SegmentMatch {
    /// Et bud.
    Match(Candidate),
    /// En regel eller identitet siger, at det ikke er arbejde.
    Ignore { reason: String },
    /// Intet signal.
    Unknown,
}

/// Et forslag: en sammenhængende blok, som brugeren bekræfter, retter eller afviser.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub start: i64,
    pub end: i64,
    /// `None` = uklar blok (kandidat til [`crate::Classifier`]).
    pub target: Option<Target>,
    pub confidence: f32,
    pub source: Option<Source>,
    /// Dansk begrundelse.
    pub reason: String,
    /// Indeks i det segmentudsnit, blokken blev bygget af.
    pub segment_indices: Vec<usize>,
    /// Antal korte afbrydelser, der er lagt ind i blokken.
    pub absorbed_interruptions: u32,
    /// Det mål, matcheren holdt tilbage, fordi konfidensen var under
    /// brugerens tærskel (blokken er uklar). Bruges til at spørge "Var det X?"
    /// og til at måle tærsklen igen, når brugeren svarer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub held_back: Option<Target>,
}

impl Suggestion {
    pub fn duration(&self) -> i64 {
        (self.end - self.start).max(0)
    }

    pub fn is_unclear(&self) -> bool {
        self.target.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> Catalog {
        Catalog {
            clients: vec![
                Client {
                    id: "a".into(),
                    name: "A".into(),
                    ..Default::default()
                },
                Client {
                    id: "gammel".into(),
                    name: "G".into(),
                    archived: true,
                    ..Default::default()
                },
            ],
            projects: vec![
                Project {
                    id: "pa".into(),
                    name: "PA".into(),
                    client_id: Some("a".into()),
                    ..Default::default()
                },
                Project {
                    id: "pg".into(),
                    name: "PG".into(),
                    client_id: Some("gammel".into()),
                    ..Default::default()
                },
                Project {
                    id: "intern".into(),
                    name: "Intern".into(),
                    ..Default::default()
                },
                Project {
                    id: "arkiv".into(),
                    name: "Arkiv".into(),
                    archived: true,
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn resolve_fills_and_filters() {
        let c = catalog();
        assert_eq!(
            c.resolve(&Target::project(None, "pa")),
            Some(Target::project(Some("a"), "pa"))
        );
        // Projektets kunde vinder over en modstridende kunde.
        assert_eq!(
            c.resolve(&Target::project(Some("x"), "pa")),
            Some(Target::project(Some("a"), "pa"))
        );
        // Arkiveret kunde via projektet slipper ikke igennem.
        assert_eq!(
            c.resolve(&Target::project(None, "pg")),
            Some(Target::project(None, "pg"))
        );
        assert_eq!(c.resolve(&Target::client("gammel")), None);
        assert_eq!(c.resolve(&Target::project(None, "arkiv")), None);
        assert_eq!(c.resolve(&Target::client("findes-ikke")), None);
    }

    #[test]
    fn internal_projects_are_only_compatible_with_themselves() {
        let intern = Target::project(None, "intern");
        assert!(!Target::client("a").compatible(&intern));
        assert!(!intern.compatible(&Target::client("a")));
        assert!(intern.compatible(&intern.clone()));
        assert!(Target::client("a").compatible(&Target::project(Some("a"), "pa")));
        assert!(!Target::client("a").compatible(&Target::client("b")));
        assert!(Target::default().compatible(&Target::default()));
    }
}
