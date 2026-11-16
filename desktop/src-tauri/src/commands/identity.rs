//! Project identity commands — binding captured signals to projects.
//!
//! Two jobs:
//!   1. CRUD over `project_matchers` (the repo/folder/domain → project bindings).
//!   2. **Discovery**: find the signals the tracker already captured that map to
//!      NOTHING, ranked by how much time they cost. This is what breaks the
//!      cold-start deadlock — instead of waiting for the user to confirm
//!      hundreds of activities one by one, we hand them the ~10 signals that
//!      account for most of their week and let them bind each in one click.
//!
//! Every write re-applies identity across history through the SAME matcher the
//! live tracker uses, so a retroactive classification can never disagree with
//! what the tracker would have done at capture time.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Database;
use crate::tracker::identity::{
    self, ALL_KINDS, KIND_APP, KIND_DOMAIN, KIND_GIT_REPO, KIND_PATH,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMatcher {
    pub id: i64,
    /// `None` is legitimate: the signal may name a customer without a project.
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    /// The billable party named by the signal itself. `project_id` AND
    /// `client_id` both `None` is the only "not work" marker.
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub kind: String,
    pub value: String,
}

/// A captured signal that currently resolves to no project — i.e. time the app
/// is recording but cannot attribute.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmappedSignal {
    pub kind: String,
    pub value: String,
    /// Total tracked minutes carrying this signal in the window scanned.
    pub minutes: i64,
    pub activity_count: i64,
    /// Which apps this signal showed up in — context for the user ("Orca",
    /// "vivaldi"), so they recognize what the signal actually is.
    pub sample_apps: Vec<String>,
    /// The window titles that cost the most time under this signal. Essential
    /// for an `app` signal: "javaw" is meaningless until you see that it was
    /// "Minecraft 1.21.11".
    pub sample_titles: Vec<String>,
    /// Best-guess project by name similarity, offered as a one-click accept.
    /// Deliberately conservative: no guess is better than a wrong guess.
    pub suggested_project_id: Option<String>,
    pub suggested_project_name: Option<String>,
    /// True when the signal is a well-known personal site. The UI pre-selects
    /// "Privat" so the user dismisses it with one click instead of reading it
    /// as a project decision — on real data these were half the list.
    /// A suggestion only; the user can still bind it to a project (a social
    /// media manager genuinely bills Facebook time).
    pub suggested_private: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMatcher {
    /// `None` is legitimate on its own — the signal may name a customer.
    pub project_id: Option<String>,
    /// Customer WITHOUT a project. Both `None` marks the signal as NOT work.
    pub client_id: Option<String>,
    pub kind: String,
    pub value: String,
}

/// Result of a write: how many past activities the change (re)classified, so
/// the UI can say "1.247 minutter blev tilknyttet" instead of going silent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub classified_activities: usize,
    pub classified_minutes: i64,
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_project_matchers(db: State<Database>) -> Result<Vec<ProjectMatcher>, String> {
    let conn = db.conn.lock().unwrap_or_else(|p| p.into_inner());
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.project_id, p.name, m.client_id, c.name, m.kind, m.value
             FROM project_matchers m
             LEFT JOIN projects p ON m.project_id = p.id
             LEFT JOIN clients c ON m.client_id = c.id
             ORDER BY m.kind, m.value",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectMatcher {
                id: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                client_id: row.get(3)?,
                client_name: row.get(4)?,
                kind: row.get(5)?,
                value: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Binds a signal to a project and/or a customer (or marks it as not-work when
/// it names neither), then re-applies identity across history.
#[tauri::command]
pub fn add_project_matcher(
    db: State<Database>,
    matcher: NewMatcher,
) -> Result<ApplyResult, String> {
    let kind = matcher.kind.trim().to_string();
    if !ALL_KINDS.contains(&kind.as_str()) {
        return Err(format!("Ukendt signaltype: {}", kind));
    }
    let value = normalize_value(&kind, &matcher.value);
    if value.is_empty() {
        return Err("Signalet er tomt".to_string());
    }

    // HARD SAFETY: an editor, browser or terminal hosts many clients' work in
    // one window. Binding such an app wholesale would attribute every customer's
    // time to a single one — or, with no target at all, silently discard all of
    // it. Those apps must be identified by repo/folder/domain instead.
    if kind == KIND_APP && crate::tracker::rules::is_multi_project_app(&value) {
        return Err(format!(
            "\"{}\" bruges til flere projekter på én gang. Bind i stedet et git-repo, en mappe eller et domæne — ellers ville al tid i appen havne på ét projekt.",
            matcher.value.trim()
        ));
    }

    let conn = db.conn.lock().unwrap_or_else(|p| p.into_inner());

    // A project binding resolves its own customer, so a customer column
    // alongside it could name a second, conflicting party. Keep the one the
    // project implies; store the column only for a signal with no project,
    // which is the case it exists for.
    let client_id = match matcher.project_id.as_deref() {
        Some(pid) => crate::tracker::rules::client_of_project(&conn, pid),
        None => matcher.client_id,
    };

    // Re-binding an existing signal is an update, not an error: the user is
    // correcting themselves, and a UNIQUE(kind, value) violation would just
    // read as a dead end.
    conn.execute(
        "INSERT INTO project_matchers (project_id, client_id, kind, value)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(kind, value) DO UPDATE SET
             project_id = excluded.project_id,
             client_id = excluded.client_id",
        rusqlite::params![matcher.project_id, client_id, kind, value],
    )
    .map_err(|e| e.to_string())?;

    reapply_identity(&conn)
}

#[tauri::command]
pub fn delete_project_matcher(db: State<Database>, id: i64) -> Result<ApplyResult, String> {
    let conn = db.conn.lock().unwrap_or_else(|p| p.into_inner());
    conn.execute("DELETE FROM project_matchers WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    reapply_identity(&conn)
}

/// Re-runs identity classification over all unconfirmed history. Exposed so the
/// UI can offer an explicit "anvend på historik" action.
#[tauri::command]
pub fn apply_identity_to_history(db: State<Database>) -> Result<ApplyResult, String> {
    let conn = db.conn.lock().unwrap_or_else(|p| p.into_inner());
    reapply_identity(&conn)
}

// ---------------------------------------------------------------------------
// Re-application
// ---------------------------------------------------------------------------

/// Clears previous identity classifications, then re-derives them for every
/// unconfirmed activity using the live matcher.
///
/// Full re-derivation (rather than applying only the new matcher) makes the
/// operation idempotent and self-healing: deleting or re-pointing a matcher
/// cannot leave stale attributions behind. `is_confirmed = 1` rows are never
/// touched — a human decision always outranks a derived one.
fn reapply_identity(conn: &Connection) -> Result<ApplyResult, String> {
    // Drop stale identity attributions. Rows classified by other layers (ai,
    // rule, pattern) are left alone here; identity may still overwrite them
    // below, because an explicitly bound signal is stronger evidence than a
    // model's guess. The customer is cleared with the project: a customer-only
    // matcher stores its customer on the activity, and a deleted matcher must
    // not leave it billing to someone the user unbound.
    conn.execute(
        "UPDATE activities
         SET project_id = NULL, client_id = NULL, confidence = NULL,
             classification_source = NULL, classification_reason = NULL
         WHERE is_confirmed = 0 AND classification_source = 'identity'",
        [],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, app_name, window_title, url, git_repo, context_path, duration
             FROM activities
             WHERE is_confirmed = 0 AND is_idle = 0",
        )
        .map_err(|e| e.to_string())?;

    type Candidate = (
        i64,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
    );
    let candidates: Vec<Candidate> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get::<_, Option<i64>>(6)?.unwrap_or(0),
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut count = 0usize;
    let mut seconds = 0i64;
    for (id, app, title, url, repo, path, duration) in candidates {
        let Some(m) = identity::classify_by_identity(
            conn,
            &app,
            &title,
            url.as_deref(),
            repo.as_deref(),
            path.as_deref(),
        ) else {
            continue;
        };
        conn.execute(
            "UPDATE activities
             SET project_id = ?1, client_id = ?2, confidence = ?3,
                 classification_source = ?4, classification_reason = ?5
             WHERE id = ?6 AND is_confirmed = 0",
            rusqlite::params![
                m.project_id,
                m.client_id,
                m.confidence,
                m.source,
                m.reason,
                id
            ],
        )
        .map_err(|e| e.to_string())?;
        count += 1;
        seconds += duration;
    }

    Ok(ApplyResult {
        classified_activities: count,
        classified_minutes: seconds / 60,
    })
}

/// Normalizes a raw user/discovery value into the canonical stored form, so a
/// matcher typed as `C:\Projects\Foo\` matches a captured `c:/projects/foo`.
fn normalize_value(kind: &str, raw: &str) -> String {
    match kind {
        KIND_GIT_REPO => identity::normalize_repo(raw),
        KIND_PATH => identity::normalize_path(raw),
        KIND_DOMAIN => identity::normalize_domain(raw),
        _ => raw.trim().to_lowercase(),
    }
}

// ---------------------------------------------------------------------------
// Discovery — the cold-start breaker
// ---------------------------------------------------------------------------

/// Finds captured signals that map to no project, ranked by tracked time.
///
/// Scans the last `days` days. Only unconfirmed, non-idle activities count —
/// time the user already sorted out is not a problem to solve.
#[tauri::command]
pub fn discover_unmapped_signals(
    db: State<Database>,
    days: Option<i64>,
) -> Result<Vec<UnmappedSignal>, String> {
    let days = days.unwrap_or(14).clamp(1, 365);
    let conn = db.conn.lock().unwrap_or_else(|p| p.into_inner());

    let known = load_known_signals(&conn)?;
    let projects = load_projects(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT app_name, window_title, url, git_repo, context_path, duration
             FROM activities
             WHERE is_idle = 0 AND is_confirmed = 0
               AND started_at >= DATE('now', ?1)",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![format!("-{} day", days)], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<i64>>(5)?.unwrap_or(0),
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut agg: std::collections::HashMap<(String, String), Agg> = std::collections::HashMap::new();

    for row in rows.flatten() {
        let (app, title, url, repo, path, duration) = row;

        // A git repo is the cleanest identifier we have — prefer it and do NOT
        // also offer the folder for the same activity, or the user would be
        // asked twice about one thing.
        let repo_norm = repo
            .as_deref()
            .map(identity::normalize_repo)
            .filter(|s| !s.is_empty());

        let host = url
            .as_deref()
            .map(identity::normalize_domain)
            .filter(|s| !s.is_empty() && s.contains('.'));

        let path_norm = path.as_deref().and_then(path_candidate);

        if let Some(r) = repo_norm.clone() {
            bump(&mut agg, KIND_GIT_REPO, r, &app, &title, duration);
        } else if let Some(p) = path_norm.clone() {
            bump(&mut agg, KIND_PATH, p, &app, &title, duration);
        }

        // A browser URL is an independent signal: the same activity can be both
        // "in repo X" (never, in practice) and "on domain Y".
        if let Some(h) = host.clone() {
            bump(&mut agg, KIND_DOMAIN, h, &app, &title, duration);
        }

        // Nothing above matched: no repo, no usable folder, no URL. On real
        // data this was a third of all tracked time — a game running under
        // `javaw`, a mail client whose title never changes. The APP itself is
        // then the only signal there is, so offer it — but never for an app that
        // hosts many projects at once (an editor, a browser, a terminal), where
        // a single binding would swallow every client's work.
        if repo_norm.is_none()
            && path_norm.is_none()
            && host.is_none()
            && !app.is_empty()
            && !crate::tracker::rules::is_multi_project_app(&app)
        {
            let app_key = app.trim().to_lowercase();
            bump(&mut agg, KIND_APP, app_key, &app, &title, duration);
        }
    }

    collapse_into_observed_ancestors(&mut agg);

    let mut out: Vec<UnmappedSignal> = agg
        .into_iter()
        .filter(|((kind, value), _)| !known.contains(&(kind.clone(), value.clone())))
        .map(|((kind, value), a)| {
            let (suggested_project_id, suggested_project_name) = suggest_project(&value, &projects);
            let suggested_private = looks_personal(&kind, &value)
                || title_looks_personal(&a.titles);
            let sample_titles = top_titles(&a.titles, 3);
            let mut sample_apps: Vec<String> = a.apps.into_iter().collect();
            sample_apps.sort();
            sample_apps.truncate(3);
            UnmappedSignal {
                kind,
                value,
                minutes: a.seconds / 60,
                activity_count: a.count,
                sample_apps,
                sample_titles,
                suggested_project_id,
                suggested_project_name,
                suggested_private,
            }
        })
        // Sub-minute noise is not worth a decision from the user.
        .filter(|s| s.minutes >= 1)
        .collect();

    // Real decisions first: obvious personal browsing sinks to the bottom so the
    // user meets the signals that are actually billable time, in the order they
    // cost the most.
    out.sort_by(|a, b| {
        a.suggested_private
            .cmp(&b.suggested_private)
            .then(b.minutes.cmp(&a.minutes))
    });
    out.truncate(40);
    Ok(out)
}

#[derive(Default)]
struct Agg {
    seconds: i64,
    count: i64,
    apps: std::collections::BTreeSet<String>,
    /// Longest-running window titles seen for this signal. For an `app` signal
    /// the title is the ONLY thing that tells the user what the app actually
    /// was — `javaw` means nothing; "Minecraft 1.21.11" means everything.
    titles: std::collections::BTreeMap<String, i64>,
}

fn bump(
    agg: &mut std::collections::HashMap<(String, String), Agg>,
    kind: &str,
    value: String,
    app: &str,
    title: &str,
    duration: i64,
) {
    let e = agg.entry((kind.to_string(), value)).or_default();
    e.seconds += duration;
    e.count += 1;
    if !app.is_empty() {
        e.apps.insert(app.to_string());
    }
    let title = title.trim();
    if !title.is_empty() {
        *e.titles.entry(title.to_string()).or_insert(0) += duration;
    }
}

/// The window titles that cost the most time under this signal, longest first.
fn top_titles(titles: &std::collections::BTreeMap<String, i64>, n: usize) -> Vec<String> {
    let mut v: Vec<(&String, &i64)> = titles.iter().collect();
    v.sort_by(|a, b| b.1.cmp(a.1));
    v.into_iter().take(n).map(|(t, _)| t.clone()).collect()
}

/// Project identity signals, grouped by project, for the AI prompt.
///
/// The prompt has always had a `Keywords` slot for each project — it was just
/// never filled, so the model saw nothing but project NAMES and had to guess
/// which one a repo or a domain belonged to. Feeding it the same bindings the
/// deterministic layer uses means that when the AI does get an ambiguous
/// activity, it at least knows what each project actually looks like.
///
/// Never fails the caller: identity is an enrichment, so a query error degrades
/// to "no hints" rather than blocking classification.
pub(crate) fn identity_hints(
    conn: &Connection,
) -> std::collections::HashMap<String, Vec<String>> {
    let mut out: std::collections::HashMap<String, Vec<String>> = Default::default();
    // A customer-only matcher is skipped here on purpose: this map is keyed by
    // PROJECT, and such a row has no project to hang a keyword off. It is not
    // "not work" — it simply has nowhere to go in a per-project prompt.
    let Ok(mut stmt) = conn.prepare(
        "SELECT project_id, kind, value FROM project_matchers
         WHERE project_id IS NOT NULL ORDER BY kind, value",
    ) else {
        return out;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    }) else {
        return out;
    };
    for (project_id, kind, value) in rows.flatten() {
        let label = match kind.as_str() {
            KIND_GIT_REPO => format!("git-repo {}", value),
            KIND_PATH => format!("mappe {}", value),
            KIND_DOMAIN => format!("domæne {}", value),
            _ => value,
        };
        out.entry(project_id).or_default().push(label);
    }
    out
}

fn load_known_signals(conn: &Connection) -> Result<std::collections::HashSet<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT kind, value FROM project_matchers")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

fn load_projects(conn: &Connection) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name FROM projects WHERE is_archived = 0")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

/// Decides whether a captured working directory is worth asking the user about.
///
/// Deliberately does NOT try to guess where "the project" starts in the path.
/// A heuristic like "cut at the `projects` folder" turns
/// `C:\Projects\Egne\timetrack-all\timetrack-desktop` into `C:\Projects\Egne` —
/// a CATEGORY folder — and binding that would attribute every one of the user's
/// own projects to a single one. Misattribution is the cardinal sin here, so we
/// never invent a folder boundary that is not present in the data. Roll-up is
/// instead done in [`collapse_into_observed_ancestors`], which only ever merges
/// into a folder the user actually worked in.
///
/// Returns `None` for machine noise (AppData, temp, node_modules) and for paths
/// too shallow to identify anything (a drive root, a bare home directory), so
/// the user is never asked to classify `C:\Users\mads_`.
pub(crate) fn path_candidate(path: &str) -> Option<String> {
    let norm = identity::normalize_path(path);
    if norm.is_empty() {
        return None;
    }
    let parts: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();

    const JUNK: &[&str] = &[
        "appdata", "temp", "tmp", "downloads", "windows", "program files",
        "$recycle.bin", "node_modules", ".git", ".cache", "target",
    ];
    if parts.iter().any(|p| JUNK.contains(p)) {
        return None;
    }

    // `c:/users/mads_` (3) identifies nothing; `c:/projects/freelance/kunde-a`
    // (4) is a real place someone works.
    if parts.len() < 4 {
        return None;
    }
    Some(parts.join("/"))
}

/// Merges a deeper folder's time into an ancestor the user ALSO worked in.
///
/// Path matching is "at or below", so binding the ancestor already covers the
/// descendant — surfacing both would ask the user twice about one thing. The
/// ancestor must itself be an observed candidate: we roll up along boundaries
/// the data proves exist, never along invented ones. A sibling project that
/// lives under a bound ancestor is still safe, because its git repo matches at
/// higher confidence than any path.
fn collapse_into_observed_ancestors(agg: &mut std::collections::HashMap<(String, String), Agg>) {
    let paths: Vec<String> = agg
        .keys()
        .filter(|(k, _)| k == KIND_PATH)
        .map(|(_, v)| v.clone())
        .collect();

    let mut moves: Vec<(String, String)> = Vec::new(); // (descendant, ancestor)
    for p in &paths {
        // Shallowest observed ancestor wins — the broadest place the user
        // actually worked.
        let ancestor = paths
            .iter()
            .filter(|a| *a != p && identity::path_is_within(p, a))
            .min_by_key(|a| a.len());
        if let Some(a) = ancestor {
            moves.push((p.clone(), a.clone()));
        }
    }

    for (desc, anc) in moves {
        let Some(d) = agg.remove(&(KIND_PATH.to_string(), desc)) else {
            continue;
        };
        let target = agg.entry((KIND_PATH.to_string(), anc)).or_default();
        target.seconds += d.seconds;
        target.count += d.count;
        target.apps.extend(d.apps);
        for (title, secs) in d.titles {
            *target.titles.entry(title).or_insert(0) += secs;
        }
    }
}

/// Well-known personal sites, offered pre-marked as "not work".
///
/// Kept deliberately short and uncontroversial — social, messaging, adult and
/// consumer shopping. Ambiguous professional sites (LinkedIn, YouTube Studio,
/// Google Meet) are NOT here: they are genuinely billable for many users, and a
/// wrong "private" default would silently delete their time.
fn looks_personal(kind: &str, value: &str) -> bool {
    if kind != KIND_DOMAIN {
        return false;
    }
    const PERSONAL: &[&str] = &[
        "facebook.com", "messenger.com", "instagram.com", "tiktok.com",
        "snapchat.com", "reddit.com", "pornhub.com", "xvideos.com",
        "netflix.com", "twitch.tv", "proshop.dk", "amazon.com", "ebay.com",
        "dba.dk", "zalando.dk",
    ];
    PERSONAL
        .iter()
        .any(|d| value == *d || value.ends_with(&format!(".{}", d)))
}

/// Recognizes leisure from the window TITLE, which is often the only place it
/// shows. On real data 43 minutes of Minecraft were tracked as work under the
/// process name `javaw` — meaningless on its own, unmistakable in the title.
fn title_looks_personal(titles: &std::collections::BTreeMap<String, i64>) -> bool {
    const LEISURE: &[&str] = &[
        "minecraft", "steam", "counter-strike", "fortnite", "roblox",
        "world of warcraft", "league of legends", "netflix", "spotify",
        "twitch", "pornhub",
    ];
    // Weigh by time so a single stray title cannot label a work app as leisure.
    let (mut leisure, mut total) = (0i64, 0i64);
    for (title, secs) in titles {
        let t = title.to_lowercase();
        total += *secs;
        if LEISURE.iter().any(|g| t.contains(g)) {
            leisure += *secs;
        }
    }
    total > 0 && leisure * 2 > total
}

/// Conservative name-similarity suggestion: only offers a project when the
/// signal and the project name clearly refer to the same thing after stripping
/// punctuation. A wrong suggestion that the user accepts on autopilot is worse
/// than no suggestion, so partial/fuzzy overlap is deliberately NOT enough.
fn suggest_project(value: &str, projects: &[(String, String)]) -> (Option<String>, Option<String>) {
    let needle = squash(value.rsplit('/').next().unwrap_or(value));
    if needle.len() < 3 {
        return (None, None);
    }
    for (id, name) in projects {
        let hay = squash(name);
        if hay.is_empty() {
            continue;
        }
        if hay == needle || hay.contains(&needle) || needle.contains(&hay) {
            return (Some(id.clone()), Some(name.clone()));
        }
    }
    (None, None)
}

/// Lowercase alphanumerics only — so `acme-dk`, `Acme.dk (firmaside)` and
/// `acme_dk` all squash to a comparable core.
fn squash(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_candidate_keeps_the_observed_folder_verbatim() {
        // Real paths from production data. We must NOT "helpfully" shorten
        // these — cutting at `Projects` would yield `c:/projects/egne`, a
        // category folder whose binding would swallow every one of the user's
        // own projects.
        assert_eq!(
            path_candidate(r"C:\Projects\Egne\timetrack-all\timetrack-desktop"),
            Some("c:/projects/egne/timetrack-all/timetrack-desktop".to_string())
        );
        assert_eq!(
            path_candidate(r"C:\Users\mads_\Local Sites\acme-site\"),
            Some("c:/users/mads_/local sites/acme-site".to_string())
        );
    }

    #[test]
    fn path_candidate_rejects_machine_noise_and_home() {
        // Asking the user to classify their home directory or a pip temp dir is
        // exactly the noise that made the old flow useless.
        assert_eq!(path_candidate(r"C:\Users\mads_"), None);
        assert_eq!(
            path_candidate(r"C:\Users\mads_\AppData\Local\Temp\pip-install-x\vllm"),
            None
        );
        assert_eq!(path_candidate(r"C:\"), None);
    }

    #[test]
    fn descendants_collapse_only_into_folders_actually_worked_in() {
        let mut agg: std::collections::HashMap<(String, String), Agg> = Default::default();
        // The user worked directly in `kunde-a` AND deeper in `kunde-a/notes`.
        bump(&mut agg, KIND_PATH, "c:/projects/freelance/kunde-a".into(), "Orca", "Orca", 600);
        bump(&mut agg, KIND_PATH, "c:/projects/freelance/kunde-a/notes".into(), "Orca", "Orca", 300);
        // A sibling that merely shares a prefix must NOT be absorbed.
        bump(&mut agg, KIND_PATH, "c:/projects/freelance/kunde-a-old".into(), "Orca", "Orca", 120);

        collapse_into_observed_ancestors(&mut agg);

        let kunde_a = agg
            .get(&(KIND_PATH.to_string(), "c:/projects/freelance/kunde-a".to_string()))
            .expect("ancestor survives");
        assert_eq!(kunde_a.seconds, 900, "the descendant's time folds into it");
        assert!(
            !agg.contains_key(&(KIND_PATH.to_string(), "c:/projects/freelance/kunde-a/notes".to_string())),
            "the descendant is not asked about separately"
        );
        assert!(
            agg.contains_key(&(KIND_PATH.to_string(), "c:/projects/freelance/kunde-a-old".to_string())),
            "a prefix-sharing sibling is a different project and must survive"
        );
    }

    #[test]
    fn suggestion_matches_across_punctuation_but_not_unrelated_names() {
        let projects = vec![
            ("p1".to_string(), "Acme.dk (firmaside)".to_string()),
            ("p2".to_string(), "KundeA".to_string()),
        ];
        // `acme-dk` → `acmedk`, contained in `acmedkfirmaside`.
        assert_eq!(suggest_project("acme-dk", &projects).0, Some("p1".to_string()));
        assert_eq!(suggest_project("kundea", &projects).0, Some("p2".to_string()));
        // `ruflo` resembles nothing — no guess is better than a wrong guess.
        assert_eq!(suggest_project("ruflo", &projects).0, None);
    }

    #[test]
    fn personal_hint_covers_social_but_never_ambiguous_professional_sites() {
        assert!(looks_personal(KIND_DOMAIN, "facebook.com"));
        assert!(looks_personal(KIND_DOMAIN, "m.facebook.com"));
        // Billable for plenty of users — defaulting these to "private" would
        // silently discard real work.
        assert!(!looks_personal(KIND_DOMAIN, "linkedin.com"));
        assert!(!looks_personal(KIND_DOMAIN, "meet.google.com"));
        assert!(!looks_personal(KIND_DOMAIN, "studio.youtube.com"));
        // A repo is never "personal browsing".
        assert!(!looks_personal(KIND_GIT_REPO, "facebook.com"));
    }

    #[test]
    fn document_hosting_apps_are_never_bindable_as_a_whole_app() {
        // Obsidian holds several vaults — `video-studio` and `Team Notes` are
        // different projects. Binding the APP would put both on one project.
        // Same for Figma files and Word documents.
        for app in ["obsidian", "figma", "microsoft word", "notion"] {
            assert!(
                crate::tracker::rules::is_multi_project_app(app),
                "{app} hosts distinct documents and must not be app-bindable"
            );
        }
        // A game or a mail client genuinely IS one thing.
        assert!(!crate::tracker::rules::is_multi_project_app("javaw"));
        assert!(!crate::tracker::rules::is_multi_project_app("spark desktop"));
    }

    #[test]
    fn leisure_is_recognized_from_the_title_not_the_process_name() {
        // `javaw` says nothing; the title says Minecraft. 43 real minutes were
        // being tracked as work this way.
        let mut titles = std::collections::BTreeMap::new();
        titles.insert("Minecraft* 1.21.11 - Multiplayer".to_string(), 2220i64);
        titles.insert("Minecraft* 1.21.11".to_string(), 300i64);
        assert!(title_looks_personal(&titles));

        // A work app must not be branded leisure by one stray window.
        let mut work = std::collections::BTreeMap::new();
        work.insert("Spark Desktop".to_string(), 1560i64);
        work.insert("Spotify".to_string(), 60i64);
        assert!(!title_looks_personal(&work), "weighted by time, not presence");
    }

    #[test]
    fn suggestion_uses_last_path_segment() {
        let projects = vec![("p1".to_string(), "ClipHis".to_string())];
        assert_eq!(
            suggest_project("c:/users/mads_/orca/projects/cliphis", &projects).0,
            Some("p1".to_string())
        );
    }
}
