//! Læringen fra 0.2.x: bindinger, regler, mønstre, eksklusioner og den rå
//! aktivitet fra de sidste dage.
//!
//! Den første migrering (`migrate::run_once`) flyttede kun regler, og kun når
//! 0.2 ikke var logget ind. Dette trin kører derfor for alle, også dem der
//! allerede har `migrering-0.2.json`, og har sin egen markør
//! (`migrering-laering-0.2.json`). Det kører ved opstart, før motoren åbner
//! sine filer i `<datamappe>/detektion/`:
//!
//! - `project_matchers` → `laering-0.2.json` (identiteter; et repo-navn uden
//!   remote og en hel app bliver regler, se `binding`).
//! - `classification_rules` → `laering-0.2.json` (regler; regex springes over).
//! - `confirmed_patterns` → stemmer i `patterns.json` med matcherens egne
//!   nøgler (`tt_matcher::learning::keys_for`).
//! - `exclusion_rules` → `activity.db`'s egen tabel, som trackeren læser.
//! - `activities` fra de sidste `retention_days` dage → `activity.db`;
//!   bekræftede tidsrum → `handled.json`.
//!
//! Projekt- og kunde-id'er oversættes: logget ind via 0.2's `remote_id` (web's
//! id'er), lokalt via navnene i `local.db` (importen gav nye id'er). Kan et mål
//! ikke oversættes, springes posten over og tælles.
//!
//! Alt er idempotent, også uden markøren: indhold, der allerede findes,
//! lægges ikke til igen, mønstrenes stemmer sættes til mindst 0.2's værdi
//! (lægges ikke oven i), og aktivitet, der overlapper noget i `activity.db`,
//! springes over. Den gamle mappe røres ikke (kopi som i `migrate`).

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use chrono::{DateTime, Duration, Utc};
use futures_lite::future::block_on;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tt_data::{LocalRepo, Repository};
use tt_matcher as mm;
use tt_tracker as tr;

use super::{TempCopy, has_column, old_instant, old_settings, rows};
use crate::engine::state::{self, Handling, LocalLearning};

pub const MARKER: &str = "migrering-laering-0.2.json";
/// Motorens mappe i datamappen (se `startup.rs`).
pub const DETECTION_DIR: &str = "detektion";
/// En 0.2-bekræftelse vejer som en bekræftelse i den nye app, men højst så
/// meget, at en senere rettelse stadig kan vende mønsteret.
const MAX_PATTERN_WEIGHT: f32 = 5.0;

/// Antal pr. slags.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Counts {
    /// `project_matchers`.
    pub identities: u32,
    /// `classification_rules`.
    pub rules: u32,
    /// `confirmed_patterns`.
    pub patterns: u32,
    /// `exclusion_rules`.
    pub exclusions: u32,
    /// `activities` (segmenter).
    pub segments: u32,
}

/// Det, der ikke blev flyttet, med grund.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Skipped {
    /// Projektet/kunden findes ikke i den nye app (eller har intet web-id).
    pub unmapped_target: u32,
    /// Regex kan ikke udtrykkes i matcheren.
    pub regex_rules: u32,
    /// Slået fra i 0.2 (regler og eksklusioner).
    pub inactive: u32,
    /// En regel uden mål gjorde intet i 0.2.
    pub rules_without_target: u32,
    /// Ukendt slags/felt/operator.
    pub unknown_kind: u32,
    /// Et mønster, der ikke giver nogen nøgle (fx kun et programnavn).
    pub patterns_without_key: u32,
    /// En eksklusion, trackeren afviser.
    pub invalid_exclusions: u32,
    /// Aktivitet ældre end `retention_days`.
    pub old_activity: u32,
    /// Aktivitet, der overlapper det, den nye app selv har sporet.
    pub overlapping_activity: u32,
    /// Aktivitet, som den nye apps undtagelser (Sporing eller tabellen)
    /// udelukker: den må ikke komme ind ad bagdøren.
    #[serde(default)]
    pub excluded_activity: u32,
    /// Aktivitet uden brugbar tid.
    pub bad_activity_time: u32,
    /// Lokal tilstand: bindingen/reglen kom allerede ind i `local.db` med den
    /// første migrering (og kan ses og rettes dér).
    pub already_in_app: u32,
}

/// Resultatet, gemt i `MARKER`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaeringReport {
    /// Fandtes der en gammel database?
    pub found: bool,
    pub source: Option<String>,
    pub imported_at: Option<DateTime<Utc>>,
    pub was_logged_in: bool,
    /// Rækker i 0.2.
    pub in_old: Counts,
    /// Flyttet (eller fandtes allerede i den nye app).
    pub moved: Counts,
    /// Bekræftede tidsrum lagt i `handled.json`.
    pub handled_spans: u32,
    pub skipped: Skipped,
    /// Fejl, der stoppede trinnet. Markøren skrives ikke, og næste start
    /// prøver igen (alt er idempotent).
    pub error: Option<String>,
}

/// Kør trinnet én gang. `old_dir` er 0.2's mappe (`migrate::old_data_dir`).
pub fn run_once(old_dir: &Path, new_dir: &Path, device: tt_data::DeviceInfo) -> LaeringReport {
    run_at(old_dir, new_dir, device, Utc::now())
}

fn run_at(
    old_dir: &Path,
    new_dir: &Path,
    device: tt_data::DeviceInfo,
    now: DateTime<Utc>,
) -> LaeringReport {
    let marker = new_dir.join(MARKER);
    if let Ok(s) = std::fs::read_to_string(&marker)
        && let Ok(r) = serde_json::from_str::<LaeringReport>(&s)
    {
        return r;
    }
    let mut report = LaeringReport::default();
    if old_dir.join("timetrack.db").is_file() {
        report.found = true;
        report.source = Some(old_dir.display().to_string());
        report.imported_at = Some(now);
        if let Err(e) = import(old_dir, new_dir, device, now, &mut report) {
            report.error = Some(e);
            return report;
        }
    }
    let _ = std::fs::create_dir_all(new_dir);
    if let Ok(json) = serde_json::to_string_pretty(&report)
        && let Err(e) = std::fs::write(&marker, json)
    {
        eprintln!("TT kunne ikke gemme {MARKER}: {e}");
    }
    report
}

fn import(
    old_dir: &Path,
    new_dir: &Path,
    device: tt_data::DeviceInfo,
    now: DateTime<Utc>,
    report: &mut LaeringReport,
) -> Result<(), String> {
    let copy = TempCopy::new()?;
    for name in ["timetrack.db", "timetrack.db-wal"] {
        let from = old_dir.join(name);
        if from.is_file() {
            std::fs::copy(&from, copy.0.join(name))
                .map_err(|e| format!("kan ikke læse {name}: {e}"))?;
        }
    }
    let old = Connection::open_with_flags(
        copy.0.join("timetrack.db"),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("den gamle database kan ikke åbnes: {e}"))?;
    let kv = old_settings(&old);
    report.was_logged_in = kv.get("sync_email").is_some_and(|v| !v.trim().is_empty());
    let ids = if report.was_logged_in {
        Ids::from_remote(&old)?
    } else {
        Ids::from_local(&old, &new_dir.join("local.db"), device)?
    };
    let det = new_dir.join(DETECTION_DIR);
    std::fs::create_dir_all(&det).map_err(|e| e.to_string())?;

    // Lokalt har den første migrering allerede lagt bindinger og regler i
    // `local.db` (synlige under Regler). Kun repo-navnene kunne den ikke
    // udtrykke (den nye app ser en remote, ikke et navn); dem tager vi her.
    let only_repo_names = !report.was_logged_in && super::imported_into(&new_dir.join("local.db"));
    let mut learning = LocalLearning::default();
    bindings(&old, &ids, only_repo_names, &mut learning, report)?;
    classification_rules(&old, &ids, only_repo_names, &mut learning, report)?;
    save_learning(&det.join(state::LOCAL_LEARNING), learning)?;
    patterns(&old, &ids, &det.join("patterns.json"), report)?;

    let store = tr::ActivityStore::open(&det.join("activity.db"))
        .map_err(|e| format!("aktivitetsdatabasen kan ikke åbnes: {e}"))?;
    exclusions(&old, &store, report)?;
    let settings = crate::backend::repo::files::load_settings(new_dir);
    let retention = settings
        .as_ref()
        .map(|s| s.tracking.retention_days)
        .unwrap_or(14)
        .clamp(1, 90);
    // Det, brugeren har undtaget i den nye app, og reglerne i tabellen.
    let mut rules = settings
        .as_ref()
        .map(|s| crate::engine::exclusion_rules(&s.tracking))
        .unwrap_or_default();
    rules.extend(store.active_exclusion_rules().map_err(|e| e.to_string())?);
    let confirmed = activities(
        &old,
        &store,
        now - Duration::days(i64::from(retention)),
        &rules,
        report,
    )?;
    drop(store);
    report.handled_spans =
        state::add_handled_spans(&det.join("handled.json"), &confirmed, Handling::Confirmed)
            .map_err(|e| format!("handled.json: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------- id'er

/// 0.2's projekt- og kunde-id'er → den nye apps.
#[derive(Default)]
struct Ids {
    clients: HashMap<String, String>,
    /// Gammelt projekt → (nyt id, ny kunde).
    projects: HashMap<String, (String, Option<String>)>,
    /// Gammelt projekt → gammel kunde, så et projekt, der ikke kan oversættes,
    /// stadig kan give kunden.
    project_client: HashMap<String, String>,
}

impl Ids {
    /// Logget ind: web's id'er står i `remote_id`.
    fn from_remote(old: &Connection) -> Result<Self, String> {
        let mut ids = Ids::default();
        for (id, remote) in rows(old, "SELECT id, remote_id FROM clients", |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })? {
            if let Some(remote) = remote.filter(|r| !r.trim().is_empty()) {
                ids.clients.insert(id, remote.trim().to_string());
            }
        }
        for (id, remote, client) in
            rows(old, "SELECT id, remote_id, client_id FROM projects", |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })?
        {
            if let Some(c) = &client {
                ids.project_client.insert(id.clone(), c.clone());
            }
            if let Some(remote) = remote.filter(|r| !r.trim().is_empty()) {
                let new_client = client.and_then(|c| ids.clients.get(&c).cloned());
                ids.projects
                    .insert(id, (remote.trim().to_string(), new_client));
            }
        }
        Ok(ids)
    }

    /// Lokalt: importen i `migrate` gav nye id'er, så de findes igen på navnet
    /// (kunde) og navn + kunde (projekt). Et navn, der findes flere gange, er
    /// tvetydigt og oversættes ikke.
    fn from_local(
        old: &Connection,
        local_db: &Path,
        device: tt_data::DeviceInfo,
    ) -> Result<Self, String> {
        let mut ids = Ids::default();
        let old_projects = rows(old, "SELECT id, name, client_id FROM projects", |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })?;
        for (id, _, client) in &old_projects {
            if let Some(c) = client {
                ids.project_client.insert(id.clone(), c.clone());
            }
        }
        if !local_db.is_file() {
            return Ok(ids);
        }
        let repo = LocalRepo::open(local_db, device)
            .map_err(|e| format!("den nye database kan ikke åbnes: {e}"))?;
        let new_clients = block_on(repo.list_clients(true)).map_err(|e| e.to_string())?;
        let new_projects = block_on(repo.list_projects(true)).map_err(|e| e.to_string())?;
        let key = |s: &str| s.trim().to_lowercase();
        let mut clients_by_name: HashMap<String, Vec<String>> = HashMap::new();
        for c in new_clients {
            clients_by_name.entry(key(&c.name)).or_default().push(c.id);
        }
        for (id, name) in rows(old, "SELECT id, name FROM clients", |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            if let Some([new]) = clients_by_name.get(&key(&name)).map(Vec::as_slice) {
                ids.clients.insert(id, new.clone());
            }
        }
        let mut projects_by_name: HashMap<(String, Option<String>), Vec<String>> = HashMap::new();
        for p in new_projects {
            projects_by_name
                .entry((key(&p.name), p.client_id))
                .or_default()
                .push(p.id);
        }
        for (id, name, client) in old_projects {
            let new_client = match &client {
                Some(c) => match ids.clients.get(c) {
                    Some(n) => Some(n.clone()),
                    None => continue,
                },
                None => None,
            };
            if let Some([new]) = projects_by_name
                .get(&(key(&name), new_client.clone()))
                .map(Vec::as_slice)
            {
                ids.projects.insert(id, (new.clone(), new_client));
            }
        }
        Ok(ids)
    }

    /// `Ok(None)`: intet mål ("ikke arbejde"). `Err(())`: målet findes ikke i
    /// den nye app. Kan projektet ikke oversættes, men kunden kan, bliver det
    /// kunden alene (stadig den rigtige kunde).
    fn target(
        &self,
        project: Option<&str>,
        client: Option<&str>,
    ) -> Result<Option<mm::Target>, ()> {
        let project = project.map(str::trim).filter(|s| !s.is_empty());
        let client = client.map(str::trim).filter(|s| !s.is_empty());
        if project.is_none() && client.is_none() {
            return Ok(None);
        }
        let new_client = |c: Option<&str>| c.and_then(|c| self.clients.get(c)).cloned();
        if let Some((id, c)) = project.and_then(|p| self.projects.get(p)) {
            return Ok(Some(mm::Target {
                client_id: c.clone().or_else(|| new_client(client)),
                project_id: Some(id.clone()),
            }));
        }
        let old_client = client.or_else(|| {
            project
                .and_then(|p| self.project_client.get(p))
                .map(String::as_str)
        });
        new_client(old_client)
            .map(|c| Some(mm::Target::client(&c)))
            .ok_or(())
    }
}

// ---------------------------------------------------------------- bindinger og regler

/// Et 0.2-repo er et navn ("webshop"), ikke en remote. Ligner værdien en
/// remote (`github.com/eksempel/webshop`), er den det.
fn is_remote(v: &str) -> bool {
    v.contains('/') || v.contains(':')
}

/// Regler, der rammer et repo med navnet `name`: remote'n ender på navnet,
/// eller mappen (uden remote) hedder det.
fn repo_name_rules(id: &str, name: &str, target: Option<mm::Target>) -> Vec<mm::Rule> {
    let name = name.trim().to_lowercase();
    [
        (mm::RuleField::Repo, format!("*/{name}")),
        (mm::RuleField::Path, format!("*/{name}")),
        (mm::RuleField::Path, format!("*/{name}/*")),
    ]
    .into_iter()
    .map(|(field, value)| rule(id, field, mm::RuleOp::Glob, value, target.clone()))
    .collect()
}

/// Regel med samme prioritet som datalagets (`convert::matcher_rules`):
/// "ikke arbejde" (1) før regler med mål (0). 0.2's egen rækkefølge holdes af
/// indsættelsesrækkefølgen (sorteringen er stabil).
fn rule(
    id: &str,
    field: mm::RuleField,
    op: mm::RuleOp,
    value: String,
    target: Option<mm::Target>,
) -> mm::Rule {
    mm::Rule {
        id: id.to_string(),
        field,
        op,
        value,
        priority: i32::from(target.is_none()),
        target,
        active: true,
    }
}

/// `project_matchers`: kind + value → mål. Begge mål NULL = ikke arbejde.
fn bindings(
    old: &Connection,
    ids: &Ids,
    only_repo_names: bool,
    out: &mut LocalLearning,
    report: &mut LaeringReport,
) -> Result<(), String> {
    if !has_column(old, "project_matchers", "kind") {
        return Ok(());
    }
    let mc = if has_column(old, "project_matchers", "client_id") {
        "client_id"
    } else {
        "NULL"
    };
    for (id, kind, value, project, client) in rows(
        old,
        &format!("SELECT id, kind, value, project_id, {mc} FROM project_matchers ORDER BY id"),
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        },
    )? {
        report.in_old.identities += 1;
        let value = value.trim().to_string();
        if value.is_empty() {
            report.skipped.unknown_kind += 1;
            continue;
        }
        if only_repo_names && !(kind == "git_repo" && !is_remote(&value)) {
            report.skipped.already_in_app += 1;
            continue;
        }
        let Ok(target) = ids.target(project.as_deref(), client.as_deref()) else {
            report.skipped.unmapped_target += 1;
            continue;
        };
        let rid = format!("0.2-binding-{id}");
        let identity = |kind, app: Option<String>| mm::IdentityBinding {
            kind,
            value: value.clone(),
            app,
            target: target.clone(),
        };
        match kind.as_str() {
            "git_repo" if is_remote(&value) => out
                .identities
                .push(identity(mm::IdentityKind::RepoRemote, None)),
            "git_repo" => out
                .rules
                .extend(repo_name_rules(&rid, &value, target.clone())),
            "path" => out.identities.push(identity(mm::IdentityKind::Path, None)),
            "domain" => out
                .identities
                .push(identity(mm::IdentityKind::Domain, None)),
            "keyword" => out
                .identities
                .push(identity(mm::IdentityKind::AppKeyword, None)),
            // Matcheren har ingen identitet på et helt program: en regel.
            "app" => out.rules.push(rule(
                &rid,
                mm::RuleField::App,
                mm::RuleOp::Equals,
                value.clone(),
                target.clone(),
            )),
            _ => {
                report.skipped.unknown_kind += 1;
                continue;
            }
        }
        report.moved.identities += 1;
    }
    Ok(())
}

/// `classification_rules` (felt/operator/værdi → mål).
fn classification_rules(
    old: &Connection,
    ids: &Ids,
    only_repo_names: bool,
    out: &mut LocalLearning,
    report: &mut LaeringReport,
) -> Result<(), String> {
    if !has_column(old, "classification_rules", "condition_type") {
        return Ok(());
    }
    let tc = if has_column(old, "classification_rules", "target_client_id") {
        "target_client_id"
    } else {
        "NULL"
    };
    for (id, kind, op, value, project, client, active) in rows(
        old,
        &format!(
            "SELECT id, condition_type, condition_op, condition_value, target_project_id, {tc}, is_active
             FROM classification_rules ORDER BY priority DESC, id"
        ),
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)? != 0,
            ))
        },
    )? {
        report.in_old.rules += 1;
        if !active {
            report.skipped.inactive += 1;
            continue;
        }
        let value = value.trim().to_string();
        let op = match op.as_str() {
            "regex" => {
                report.skipped.regex_rules += 1;
                continue;
            }
            "equals" => mm::RuleOp::Equals,
            "contains" => mm::RuleOp::Contains,
            "starts_with" => mm::RuleOp::StartsWith,
            _ => {
                report.skipped.unknown_kind += 1;
                continue;
            }
        };
        if value.is_empty() {
            report.skipped.unknown_kind += 1;
            continue;
        }
        if only_repo_names && !(kind == "git_repo" && !is_remote(&value)) {
            report.skipped.already_in_app += 1;
            continue;
        }
        // 0.2: en regel uden mål giver intet træf.
        let target = match ids.target(project.as_deref(), client.as_deref()) {
            Ok(Some(t)) => t,
            Ok(None) => {
                report.skipped.rules_without_target += 1;
                continue;
            }
            Err(()) => {
                report.skipped.unmapped_target += 1;
                continue;
            }
        };
        let rid = format!("0.2-regel-{id}");
        let one = |field| vec![rule(&rid, field, op, value.clone(), Some(target.clone()))];
        let rules = match kind.as_str() {
            "app_name" => one(mm::RuleField::App),
            "window_title" => one(mm::RuleField::Title),
            "url" => one(mm::RuleField::Url),
            "git_repo" if is_remote(&value) => one(mm::RuleField::Repo),
            "git_repo" => match op {
                mm::RuleOp::Equals => repo_name_rules(&rid, &value, Some(target.clone())),
                mm::RuleOp::StartsWith => vec![rule(
                    &rid,
                    mm::RuleField::Repo,
                    mm::RuleOp::Glob,
                    format!("*/{}*", value.to_lowercase()),
                    Some(target.clone()),
                )],
                _ => one(mm::RuleField::Repo),
            },
            _ => {
                report.skipped.unknown_kind += 1;
                continue;
            }
        };
        out.rules.extend(rules);
        report.moved.rules += 1;
    }
    Ok(())
}

/// Ens regel uanset id.
fn same_rule(a: &mm::Rule, b: &mm::Rule) -> bool {
    a.field == b.field
        && a.op == b.op
        && a.value == b.value
        && a.target == b.target
        && a.active == b.active
}

/// Lægger `new` til `laering-0.2.json` uden dubletter og skriver atomisk.
fn save_learning(path: &Path, new: LocalLearning) -> Result<(), String> {
    let mut file: LocalLearning = match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b)
            .map_err(|e| format!("{} er ødelagt: {e}", state::LOCAL_LEARNING))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => LocalLearning::default(),
        Err(e) => return Err(e.to_string()),
    };
    let before = file.clone();
    for b in new.identities {
        if !file.identities.contains(&b) {
            file.identities.push(b);
        }
    }
    for r in new.rules {
        if !file.rules.iter().any(|x| same_rule(x, &r)) {
            file.rules.push(r);
        }
    }
    if file == before && path.exists() {
        return Ok(());
    }
    state::write_json_atomic(path, &file).map_err(|e| format!("{}: {e}", state::LOCAL_LEARNING))
}

// ---------------------------------------------------------------- mønstre

/// `confirmed_patterns` → stemmer i `patterns.json`. 0.2's række (app, titel,
/// repo, mappe) bliver et segment, og matcherens egne nøgler for det får
/// stemmen, så de er de samme, som motoren selv lærer.
fn patterns(
    old: &Connection,
    ids: &Ids,
    path: &Path,
    report: &mut LaeringReport,
) -> Result<(), String> {
    if !has_column(old, "confirmed_patterns", "confirmation_count") {
        return Ok(());
    }
    let col = |c: &str| {
        if has_column(old, "confirmed_patterns", c) {
            c.to_string()
        } else {
            "NULL".into()
        }
    };
    let sql = format!(
        "SELECT app_name, window_title_pattern, {}, {}, {}, project_id, {}, confirmation_count
         FROM confirmed_patterns ORDER BY id",
        col("url_pattern"),
        col("git_repo"),
        col("context_path"),
        col("client_id"),
    );
    let mut votes: BTreeMap<(mm::PatternKey, mm::Target), u32> = BTreeMap::new();
    for (app, title, url, repo, path_, project, client, count) in rows(old, &sql, |r| {
        Ok((
            r.get::<_, Option<String>>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, i64>(7)?,
        ))
    })? {
        report.in_old.patterns += 1;
        // 0.2 springer et mønster uden mål over.
        let target = match ids.target(project.as_deref(), client.as_deref()) {
            Ok(Some(t)) => t,
            Ok(None) => {
                report.skipped.rules_without_target += 1;
                continue;
            }
            Err(()) => {
                report.skipped.unmapped_target += 1;
                continue;
            }
        };
        let url = url
            .map(|u| u.replace('%', ""))
            .filter(|u| !u.trim().is_empty());
        let seg = mm::ActivitySegment {
            app: app.unwrap_or_default(),
            // 0.2 gemte titlen (eller et LIKE-mønster med %).
            title: title
                .unwrap_or_default()
                .replace('%', " ")
                .trim()
                .to_string(),
            domain: url.as_deref().and_then(tr::url::domain_of),
            url,
            repo_remote: repo.filter(|r| is_remote(r)),
            path: path_.filter(|p| !p.trim().is_empty()),
            start: 0,
            end: 60,
            ..Default::default()
        };
        let keys = mm::learning::keys_for(&seg);
        if keys.is_empty() {
            report.skipped.patterns_without_key += 1;
            continue;
        }
        let n = u32::try_from(count.max(1)).unwrap_or(u32::MAX);
        for key in keys {
            *votes.entry((key, target.clone())).or_default() += n;
        }
        report.moved.patterns += 1;
    }
    if votes.is_empty() {
        return Ok(());
    }
    merge_votes(path, &votes)
}

/// Lægger stemmerne i `patterns.json` uden at røre resten af filen (fx
/// `sync`). Stemmen sættes til mindst 0.2's værdi, så en ny kørsel ikke
/// tæller dobbelt.
fn merge_votes(
    path: &Path,
    votes: &BTreeMap<(mm::PatternKey, mm::Target), u32>,
) -> Result<(), String> {
    let mut file: serde_json::Value = match std::fs::read(path) {
        Ok(b) => {
            serde_json::from_slice(&b).map_err(|e| format!("patterns.json er ødelagt: {e}"))?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(e.to_string()),
    };
    let obj = file.as_object_mut().ok_or("patterns.json er ødelagt")?;
    let mut list: Vec<mm::LearnedPattern> = match obj.get("patterns") {
        Some(v) => serde_json::from_value(v.clone())
            .map_err(|e| format!("patterns.json er ødelagt: {e}"))?,
        None => Vec::new(),
    };
    for ((key, target), n) in votes {
        let i = match list.iter().position(|p| &p.key == key) {
            Some(i) => i,
            None => {
                list.push(mm::LearnedPattern {
                    key: key.clone(),
                    votes: Vec::new(),
                });
                list.len() - 1
            }
        };
        let pattern = &mut list[i];
        let j = match pattern.votes.iter().position(|v| &v.target == target) {
            Some(j) => j,
            None => {
                pattern.votes.push(mm::learning::Vote {
                    target: target.clone(),
                    weight: 0.0,
                    confirmations: 0,
                    corrections: 0,
                    ai_answers: 0,
                });
                pattern.votes.len() - 1
            }
        };
        let vote = &mut pattern.votes[j];
        vote.weight = vote.weight.max((*n as f32).min(MAX_PATTERN_WEIGHT));
        vote.confirmations = vote.confirmations.max(*n);
    }
    obj.insert(
        "patterns".into(),
        serde_json::to_value(&list).map_err(|e| e.to_string())?,
    );
    state::write_json_atomic(path, &file).map_err(|e| format!("patterns.json: {e}"))
}

// ---------------------------------------------------------------- eksklusioner og aktivitet

/// `exclusion_rules` → `activity.db`'s tabel med samme felter, som trackeren
/// læser (`ActivityStore::active_exclusion_rules`). Intet går tabt (også
/// regex og "starter med").
fn exclusions(
    old: &Connection,
    store: &tr::ActivityStore,
    report: &mut LaeringReport,
) -> Result<(), String> {
    if !has_column(old, "exclusion_rules", "field") {
        return Ok(());
    }
    let existing = store.list_exclusion_rules().map_err(|e| e.to_string())?;
    let mut have: Vec<(String, String, String)> = existing
        .into_iter()
        .map(|r| (r.field, r.op, r.value.trim().to_string()))
        .collect();
    for (field, op, value, active) in rows(
        old,
        "SELECT field, op, value, is_active FROM exclusion_rules ORDER BY id",
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)? != 0,
            ))
        },
    )? {
        report.in_old.exclusions += 1;
        if !active {
            report.skipped.inactive += 1;
            continue;
        }
        let value = value.trim().to_string();
        if tr::exclusion::validate_rule(&field, &op, &value).is_err() {
            report.skipped.invalid_exclusions += 1;
            continue;
        }
        let key = (field, op, value);
        if !have.contains(&key) {
            store
                .add_exclusion_rule(&key.0, &key.1, &key.2)
                .map_err(|e| e.to_string())?;
            have.push(key);
        }
        report.moved.exclusions += 1;
    }
    Ok(())
}

/// `activities` siden `cutoff` → `activity.db`. Returnerer de bekræftede
/// tidsrum (unix-sekunder) til `handled.json`.
fn activities(
    old: &Connection,
    store: &tr::ActivityStore,
    cutoff: DateTime<Utc>,
    rules: &[tr::ExclusionRule],
    report: &mut LaeringReport,
) -> Result<Vec<(i64, i64)>, String> {
    if !has_column(old, "activities", "started_at") {
        return Ok(Vec::new());
    }
    let col = |c: &str| {
        if has_column(old, "activities", c) {
            c.to_string()
        } else {
            "NULL".into()
        }
    };
    let sql = format!(
        "SELECT app_name, window_title, url, git_repo, git_branch, {}, file_path, started_at, ended_at,
                duration, is_idle, is_confirmed, project_id, {}
         FROM activities ORDER BY started_at, id",
        col("context_path"),
        col("client_id"),
    );
    let mut confirmed = Vec::new();
    #[allow(clippy::type_complexity)]
    let all: Vec<(
        (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ),
        (String, Option<String>, i64, bool, bool, bool),
    )> = rows(old, &sql, |r| {
        Ok((
            (
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ),
            (
                r.get::<_, String>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, Option<i64>>(9)?.unwrap_or(0),
                r.get::<_, i64>(10)? != 0,
                r.get::<_, i64>(11)? != 0,
                r.get::<_, Option<String>>(12)?.is_some()
                    || r.get::<_, Option<String>>(13)?.is_some(),
            ),
        ))
    })?;
    for (
        (app, title, url, repo, branch, context, file),
        (started, ended, secs, idle, is_confirmed, has_target),
    ) in all
    {
        report.in_old.segments += 1;
        let Some(start) = old_instant(&started) else {
            report.skipped.bad_activity_time += 1;
            continue;
        };
        let end = ended
            .as_deref()
            .and_then(old_instant)
            .filter(|e| *e > start)
            .unwrap_or(start + Duration::seconds(secs));
        if end <= start {
            report.skipped.bad_activity_time += 1;
            continue;
        }
        if end < cutoff {
            report.skipped.old_activity += 1;
            continue;
        }
        let overlapping = store
            .segments_between(start, end, true)
            .map_err(|e| e.to_string())?;
        if !overlapping.is_empty() {
            report.skipped.overlapping_activity += 1;
            continue;
        }
        if tr::exclusion::should_exclude(
            app.as_deref().unwrap_or(""),
            title.as_deref().unwrap_or(""),
            url.as_deref(),
            rules,
            true,
        ) {
            report.skipped.excluded_activity += 1;
            continue;
        }
        let url = url.as_deref().and_then(tr::url::normalize_url);
        let context = context.filter(|p| !p.trim().is_empty());
        let repo = repo.filter(|r| !r.trim().is_empty());
        // Et repo-navn er kun en rod, når arbejdsmappen hedder det.
        let repo_root = match (&repo, &context) {
            (Some(name), Some(dir))
                if !is_remote(name) && dir_name(dir).eq_ignore_ascii_case(name) =>
            {
                Some(mm::normalize::normalize_path(dir))
            }
            _ => None,
        };
        let app = app.unwrap_or_default();
        let seg = tr::ActivitySegment {
            id: None,
            app_id: mm::normalize::normalize_app(&app),
            app,
            title: title.unwrap_or_default(),
            domain: url.as_deref().and_then(tr::url::domain_of),
            url,
            repo_remote: repo
                .filter(|r| is_remote(r))
                .map(|r| mm::normalize::normalize_repo_remote(&r)),
            repo_root,
            branch: branch.filter(|b| !b.trim().is_empty()),
            path: context.map(|p| mm::normalize::normalize_path(&p)),
            document: file.filter(|f| !f.trim().is_empty()),
            start,
            end,
            idle,
        };
        store.insert(&seg).map_err(|e| e.to_string())?;
        report.moved.segments += 1;
        if is_confirmed && has_target && !idle {
            confirmed.push((start.timestamp(), end.timestamp()));
        }
    }
    Ok(confirmed)
}

fn dir_name(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
}

#[cfg(test)]
mod tests;
