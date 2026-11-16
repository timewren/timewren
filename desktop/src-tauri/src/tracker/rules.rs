use regex::Regex;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/// Result of a classification attempt.
pub struct RuleMatch {
    /// The project this belongs to, if any. `None` is a legitimate outcome: a
    /// rule may target a CUSTOMER without a project ("kunde uden projekt"), and
    /// `client_id` then carries the billable party on its own.
    pub project_id: Option<String>,
    /// The customer to bill. Resolved from the rule's own `target_client_id`,
    /// or looked up from the matched project's customer so a project match
    /// carries its customer too — the caller does not have to re-join projects.
    pub client_id: Option<String>,
    pub category: Option<String>,
    pub confidence: f64,
    /// Which layer produced the match: `"rule"` for user-defined rules,
    /// `"pattern"` for historical patterns. Persisted on the activity so the
    /// timeline can explain HOW it was classified.
    pub source: String,
    /// Short, human-readable detail of WHY the match fired — the signal/field
    /// that decided it, e.g. `"git_repo timetrack-desktop"` or
    /// `"window_title faktura"`. Field tokens are kept language-neutral; the UI
    /// prepends a localized source label.
    pub reason: String,
}

/// A project suggestion offered at manual timer start, derived from the current
/// window/context via the SAME classifier the auto-tracker uses.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectSuggestion {
    pub project_id: String,
    pub project_name: String,
    /// Machine-readable reason so the frontend can localize the "foreslået
    /// fordi"-label: `"git_repo"`, `"context_path"` or `"app_title"`.
    pub reason_kind: String,
    /// The concrete signal behind the reason (repo name, folder label, or app
    /// name) — interpolated into the localized label.
    pub reason_detail: String,
    pub confidence: f64,
}

/// Minimum confidence before a match pre-fills the project field at manual
/// timer start. Deliberately BELOW the tracker's 0.95 auto-confirm threshold:
/// a suggestion only pre-fills an editable field the user reviews, so a lower
/// bar is safe. At 0.70 a historical pattern must have been confirmed ~4+ times
/// (base `0.5 + 4*0.05 = 0.70`) before it pre-fills — established memory, not a
/// first-time guess. Rule matches (0.85/0.98) always qualify.
pub(crate) const SUGGESTION_MIN_CONFIDENCE: f64 = 0.70;

/// Suggests a project for an ALREADY-DERIVED window/context, using the same
/// rules + confirmed-pattern memory as the auto-tracker. Pure and testable: it
/// takes the derived signals + a connection, never touches the foreground.
///
/// Returns `Some` only on a confident match (>= [`SUGGESTION_MIN_CONFIDENCE`])
/// to a live (non-archived) project. Anything weaker or unknown returns `None`
/// so the field stays empty — no guessing.
pub(crate) fn suggest_from_context(
    conn: &Connection,
    app_name: &str,
    window_title: &str,
    url: Option<&str>,
    git_repo: Option<&str>,
    context_path: Option<&str>,
) -> Option<ProjectSuggestion> {
    let m = RuleEngine::classify(conn, app_name, window_title, url, git_repo, context_path)?;
    if m.confidence < SUGGESTION_MIN_CONFIDENCE {
        return None;
    }

    // A client-only match names no project, and this suggestion's whole job is
    // to pre-fill the PROJECT field. There is nothing to suggest, so drop it
    // rather than guess a project from the customer.
    let project_id = m.project_id?;

    // Resolve a display name; a match to a deleted/archived project is dropped
    // rather than shown as a bare id.
    let project_name: String = conn
        .query_row(
            "SELECT name FROM projects WHERE id = ?1 AND is_archived = 0",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .ok()?;

    // Reason = the strongest context signal present, in the same priority the
    // classifier trusts them: an exact git repo is the hardest evidence, then a
    // derived folder/context path, else the app itself. This describes the
    // CURRENT context honestly ("repo kunde-web", "mappe kunde-a", "app Figma").
    let (reason_kind, reason_detail) = match (git_repo, context_path) {
        (Some(repo), _) if !repo.is_empty() => ("git_repo".to_string(), repo.to_string()),
        (_, Some(path)) if !path.is_empty() => (
            "context_path".to_string(),
            crate::tracker::process_context::derive_project_label(path)
                .unwrap_or_else(|| path.to_string()),
        ),
        _ => ("app_title".to_string(), app_name.to_string()),
    };

    Some(ProjectSuggestion {
        project_id,
        project_name,
        reason_kind,
        reason_detail,
        confidence: m.confidence,
    })
}

/// Apps that routinely host MANY different projects in one window — editors,
/// browsers, terminals and agent-runners. An `app_name`-only rule on these
/// cannot safely identify a single project: it would match every window of
/// the app and silently auto-confirm all of a user's work to one project.
pub(crate) fn is_multi_project_app(app_name: &str) -> bool {
    let app = app_name.to_lowercase();

    // Any app we know hosts distinct DOCUMENTS — an Obsidian vault, a Figma
    // file, a Word document — is multi-project by definition: one Obsidian
    // binding would put the `Team Notes` vault and the `video-studio` vault
    // on the same project. Those apps must be identified by a title keyword
    // (the vault/document name), not by the app.
    if super::title::app_family(&app).is_some() {
        return true;
    }

    const MULTI_PROJECT_APPS: &[&str] = &[
        // Editorer / IDE'er
        "code", "cursor", "zed", "windsurf", "idea", "webstorm", "phpstorm", "pycharm",
        "goland", "rider", "clion", "rustrover", "datagrip", "sublime", "vim", "nvim",
        "notepad++",
        // Browsere
        "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "safari",
        // Terminaler & agent-runners
        "orca", "windowsterminal", "wt", "powershell", "pwsh", "cmd", "alacritty",
        "wezterm", "kitty", "warp", "ghostty", "tmux", "iterm", "terminal",
    ];
    MULTI_PROJECT_APPS.iter().any(|m| app.contains(m))
}

pub struct RuleEngine;

/// De felter en bekræftet aktivitet lærer sit mønster af.
///
/// De læses samlet og gives samlet videre, fordi de fire hører sammen: et mønster
/// uden dem genkendes ikke igen næste gang, og de er derfor netop den slags
/// argumenter man mister på den ene af de to veje, der bekræfter. `url` er
/// bevidst ikke her — mønsteret matcher på app og vinduestitel aldrig på URL,
/// så at argument lå overalt og blev aldrig læst.
#[derive(Debug, Clone, Default)]
pub struct ActivitySignals {
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub git_repo: Option<String>,
    pub context_path: Option<String>,
}

impl ActivitySignals {
    /// Signaler for et mønster, der kun kender app og vinduestitel.
    ///
    /// Den almindelige form — `git_repo` og `context_path` er netop de felter,
    /// der læses fra en aktivitet og derfor ofte mangler i en test eller et
    /// kalenderevent, hvor de slet ikke findes.
    pub fn titled(app_name: &str, window_title: &str) -> Self {
        Self {
            app_name: Some(app_name.to_string()),
            window_title: Some(window_title.to_string()),
            ..Default::default()
        }
    }

    /// Læser signalerne for én aktivitet, eller `Ok(None)` hvis den ikke findes.
    ///
    /// `url` læses ikke med — det er ikke en del af et mønsters identitet.
    pub fn read(conn: &Connection, activity_id: i64) -> Result<Option<Self>, rusqlite::Error> {
        conn.query_row(
            "SELECT app_name, window_title, git_repo, context_path FROM activities WHERE id = ?1",
            rusqlite::params![activity_id],
            |row| {
                Ok(Self {
                    app_name: row.get(0)?,
                    window_title: row.get(1)?,
                    git_repo: row.get(2)?,
                    context_path: row.get(3)?,
                })
            },
        )
        .optional()
    }
}

/// The customer a project belongs to, or `None` for a project that has no
/// customer yet (or one whose row has since been deleted). A missing lookup is
/// never an error here: classification must keep working on a half-configured
/// database, it just cannot bill anyone.
pub(crate) fn client_of_project(conn: &Connection, project_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT client_id FROM projects WHERE id = ?1",
        rusqlite::params![project_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

impl RuleEngine {
    /// Try to classify an activity using user-defined rules (highest priority first).
    ///
    /// Queries `classification_rules` where `is_active = 1`, ordered by `priority DESC`.
    /// For each rule the condition is evaluated against the relevant field and
    /// the first match wins with confidence 0.98.
    pub fn classify_by_rules(
        conn: &Connection,
        app_name: &str,
        window_title: &str,
        url: Option<&str>,
        git_repo: Option<&str>,
    ) -> Option<RuleMatch> {
        let mut stmt = conn
            .prepare(
                "SELECT condition_type, condition_op, condition_value,
                        target_project_id, target_client_id, target_category
                 FROM classification_rules
                 WHERE is_active = 1
                 ORDER BY priority DESC",
            )
            .ok()?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            })
            .ok()?;

        for row in rows {
            let (
                cond_type,
                cond_op,
                cond_value,
                target_project_id,
                target_client_id,
                target_category,
            ) = match row {
                Ok(r) => r,
                Err(_) => continue,
            };

            // Evaluate the condition against the activity's fields. This is the
            // SAME matcher used by the retroactive preview/apply commands, so a
            // rule can never classify differently forwards vs. retroactively.
            let matched = activity_matches_condition(
                &cond_type,
                &cond_op,
                &cond_value,
                Some(app_name),
                Some(window_title),
                url,
                git_repo,
            );

            if matched {
                // A rule must name WHO the work is for: a project, a customer, or
                // both. A rule with neither is unconfigured and is skipped
                // rather than classified to nobody.
                if target_project_id.is_none() && target_client_id.is_none() {
                    continue;
                }

                // An app_name-only match on a multi-project app stays below
                // the 0.95 auto-confirm threshold: the same editor/browser/
                // terminal hosts many clients' work, so the user must review
                // the suggestion instead of it silently becoming billable
                // time on one project. Title/url/git rules keep full trust.
                let confidence = rule_match_confidence(&cond_type, Some(app_name));

                // Carry the customer along: from the rule's own target, or
                // looked up from the matched project. Resolving it here means
                // the stored activity already names its customer, so billing
                // never depends on the caller knowing the project→customer map.
                let client_id = match &target_client_id {
                    Some(c) => Some(c.clone()),
                    None => target_project_id.as_deref().and_then(|p| client_of_project(conn, p)),
                };

                return Some(RuleMatch {
                    project_id: target_project_id,
                    client_id,
                    category: target_category,
                    confidence,
                    source: "rule".to_string(),
                    reason: rule_match_reason(&cond_type, &cond_value),
                });
            }
        }

        None
    }

    /// Try to classify using historically confirmed patterns.
    ///
    /// Looks up `confirmed_patterns` by exact `app_name` match and fuzzy
    /// `window_title_pattern` match (LIKE). Confidence scales with the number
    /// of confirmations: `min(0.5 + count * 0.05, 0.90)`.
    ///
    /// `git_repo`/`context_path` guard against cross-repo misattribution:
    /// a pattern whose stored repo/path CONTRADICTS the activity's is skipped
    /// entirely, while an exact match adds a +0.07 bonus (capped at 0.97 —
    /// deliberately above the 0.95 auto-confirm threshold, because an exact
    /// repo match is strong evidence).
    pub fn classify_by_history(
        conn: &Connection,
        app_name: &str,
        window_title: &str,
        _url: Option<&str>,
        git_repo: Option<&str>,
        context_path: Option<&str>,
    ) -> Option<RuleMatch> {
        // Query patterns that match the app_name. We use LIKE on
        // window_title_pattern so partial patterns (e.g., "%vscode%") work.
        let mut stmt = conn
            .prepare(
                "SELECT project_id, client_id, category, confirmation_count, window_title_pattern,
                        git_repo, context_path
                 FROM confirmed_patterns
                 WHERE app_name = ?1
                 ORDER BY confirmation_count DESC, project_id ASC",
            )
            .ok()?;

        let rows = stmt
            .query_map(rusqlite::params![app_name], |row| {
                Ok((
                    // Both are optional: a pattern may have been learned against a
                    // customer without a project. Reading project_id as String
                    // would make rusqlite error on that row, and the loop below
                    // skips errored rows — the whole pattern layer would go quiet
                    // for that app instead of classifying to the customer.
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .ok()?;

        let mut best: Option<RuleMatch> = None;
        let mut best_confidence: f64 = 0.0;
        let mut best_overlap: usize = 0;

        for row in rows {
            let (
                project_id,
                pattern_client_id,
                category,
                count,
                title_pattern,
                pat_git_repo,
                pat_context_path,
            ) = match row {
                Ok(r) => r,
                Err(_) => continue,
            };

            // A pattern must name WHO the work is for. One that names neither is
            // unconfigured (and, on a migrated database, could be a leftover from
            // a customer that was deleted) — skip it rather than classify to
            // nobody, which is the same rule classification_rules follows.
            if project_id.is_none() && pattern_client_id.is_none() {
                continue;
            }

            // Contradiction guard: a pattern learned in a DIFFERENT git repo
            // (or context path) must never classify this activity, no matter
            // how well the title matches — that is exactly how work on one
            // customer's repo gets billed to another. Both sides must be known
            // for a contradiction; NULL on either side stays permissive.
            if let (Some(pg), Some(ag)) = (pat_git_repo.as_deref(), git_repo) {
                if pg != ag {
                    continue;
                }
            }
            if let (Some(pc), Some(ac)) = (pat_context_path.as_deref(), context_path) {
                if pc != ac {
                    continue;
                }
            }

            // Check if the window_title matches the pattern
            let title_matches = match &title_pattern {
                Some(pattern) if !pattern.is_empty() => {
                    like_match(window_title, pattern)
                }
                // No pattern stored — match by app_name alone (already filtered)
                _ => true,
            };

            if !title_matches {
                continue;
            }

            let base = (0.5 + count as f64 * 0.05).min(0.90);
            // Bonus for an exact repo/path match (contradictions were skipped
            // above, so both-Some here means equal). Applied at most once.
            let repo_match =
                pat_git_repo.is_some() && git_repo.is_some();
            let path_match =
                pat_context_path.is_some() && context_path.is_some();
            let confidence = if repo_match || path_match {
                (base + 0.07).min(0.97)
            } else {
                base
            };
            // Tie-breaker for equal-confidence patterns of the same app: prefer
            // the one sharing more title tokens, so two projects opened in the
            // same app (same confirmation count) are disambiguated.
            let overlap = title_pattern
                .as_deref()
                .map(|p| title_token_overlap(window_title, p))
                .unwrap_or(0);

            let better = confidence > best_confidence
                || (confidence == best_confidence && overlap > best_overlap);

            if better {
                best_confidence = confidence;
                best_overlap = overlap;
                // Cite the strongest signal that decided this match, in the same
                // priority the scorer trusts: an exact repo/path match is the
                // hardest evidence, then the title pattern, else the app alone.
                let reason = if repo_match {
                    format!("git_repo {}", git_repo.unwrap_or(""))
                } else if path_match {
                    format!("context_path {}", context_path.unwrap_or(""))
                } else if let Some(p) = title_pattern.as_deref().filter(|p| !p.is_empty()) {
                    format!("window_title {}", p)
                } else {
                    format!("app_name {}", app_name)
                };
                best = Some(RuleMatch {
                    project_id: project_id.clone(),
                    // The customer follows the same one-way rule a project rule
                    // follows: the pattern's own customer wins, and only a
                    // project match looks its customer up. Resolved here so every
                    // layer of `classify` stores an activity identically.
                    client_id: pattern_client_id
                        .clone()
                        .or_else(|| project_id.as_deref().and_then(|p| client_of_project(conn, p))),
                    category,
                    confidence,
                    source: "pattern".to_string(),
                    reason,
                });
            }
        }

        best
    }

    /// Combined classification: user-defined rules first, then historical patterns.
    pub fn classify(
        conn: &Connection,
        app_name: &str,
        window_title: &str,
        url: Option<&str>,
        git_repo: Option<&str>,
        context_path: Option<&str>,
    ) -> Option<RuleMatch> {
        // Layer 0 — project identity. Exact, deterministic, and available from
        // the very first activity (no confirmations needed), so it runs BEFORE
        // user rules: a repo/folder/domain the user explicitly bound to a
        // project is the strongest statement of intent in the system.
        if let Some(m) = super::identity::classify_by_identity(
            conn,
            app_name,
            window_title,
            url,
            git_repo,
            context_path,
        ) {
            return Some(m);
        }
        if let Some(m) = Self::classify_by_rules(conn, app_name, window_title, url, git_repo) {
            return Some(m);
        }
        Self::classify_by_history(conn, app_name, window_title, url, git_repo, context_path)
    }

    /// Record a confirmed classification for future pattern matching.
    ///
    /// A pattern is identified by `app_name` + `window_title_pattern` + the pair
    /// (`project_id`, `client_id`): if such a pattern already exists the
    /// `confirmation_count` is incremented; otherwise a new row is inserted.
    /// Both halves of that pair are matched NULL-safely, so a customer without a
    /// project is found again instead of being inserted a second time —
    /// otherwise the same signal would be learned twice and, at equal
    /// confirmation counts, the winner between the two would be arbitrary.
    ///
    /// `git_repo`/`context_path` are stored on insert and backfilled
    /// on increment when the existing row has NULL (never overwritten).
    pub fn confirm_pattern(
        conn: &Connection,
        signals: &ActivitySignals,
        project_id: Option<&str>,
        client_id: Option<&str>,
        category: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let app_name = signals.app_name.as_deref().unwrap_or_default();
        let window_title = signals.window_title.as_deref().unwrap_or_default();
        let git_repo = signals.git_repo.as_deref();
        let context_path = signals.context_path.as_deref();

        // COALESCE both sides rather than `= ?n`: `project_id = NULL` is never
        // true in SQL, so a plain comparison would miss the row and duplicate it.
        let existing_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM confirmed_patterns
                 WHERE app_name = ?1
                   AND (window_title_pattern = ?2 OR (window_title_pattern IS NULL AND ?2 IS NULL))
                   AND COALESCE(project_id, '') = COALESCE(?3, '')
                   AND COALESCE(client_id, '') = COALESCE(?4, '')",
                rusqlite::params![app_name, window_title, project_id, client_id],
                |row| row.get(0),
            )
            .ok();

        match existing_id {
            Some(id) => {
                conn.execute(
                    "UPDATE confirmed_patterns
                     SET confirmation_count = confirmation_count + 1,
                         last_confirmed = datetime('now'),
                         category = COALESCE(?1, category),
                         git_repo = COALESCE(git_repo, ?2),
                         context_path = COALESCE(context_path, ?3)
                     WHERE id = ?4",
                    rusqlite::params![category, git_repo, context_path, id],
                )?;
            }
            None => {
                conn.execute(
                    "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, client_id, category, git_repo, context_path)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![app_name, window_title, project_id, client_id, category, git_repo, context_path],
                )?;
            }
        }

        Ok(())
    }
}

/// Whether an activity's fields satisfy a rule condition.
///
/// This is the single matcher shared by [`RuleEngine::classify_by_rules`] (the
/// forward classifier), `preview_rule_application` (the retroactive count) and
/// `apply_rule_to_history` (the retroactive write). Keeping all three on this
/// one function guarantees a preview count can never diverge from what apply
/// actually changes, and that a rule behaves identically forwards and back.
pub(crate) fn activity_matches_condition(
    condition_type: &str,
    condition_op: &str,
    condition_value: &str,
    app_name: Option<&str>,
    window_title: Option<&str>,
    url: Option<&str>,
    git_repo: Option<&str>,
) -> bool {
    let field_value = match condition_type {
        "app_name" => app_name,
        "window_title" => window_title,
        "url" => url,
        "git_repo" => git_repo,
        _ => None,
    };
    match field_value {
        Some(v) => match_condition(v, condition_op, condition_value),
        None => false,
    }
}

/// Human-readable "why" for a rule match: the field + value that fired. Shared
/// by the forward classifier and the retroactive apply so both describe a rule
/// match identically. Field tokens (`git_repo`, `window_title`, …) are kept
/// language-neutral; the UI prepends a localized "Regel"/"Rule" label.
pub(crate) fn rule_match_reason(condition_type: &str, condition_value: &str) -> String {
    format!("{} {}", condition_type, condition_value)
}

/// Confidence a rule match assigns, mirroring the forward classifier: an
/// `app_name`-only rule on a multi-project app (editor/browser/terminal) stays
/// below the 0.95 auto-confirm threshold, everything else is fully trusted.
pub(crate) fn rule_match_confidence(condition_type: &str, app_name: Option<&str>) -> f64 {
    if condition_type == "app_name" && app_name.map(is_multi_project_app).unwrap_or(false) {
        0.85
    } else {
        0.98
    }
}

/// Evaluates a single condition against a field value.
fn match_condition(field: &str, op: &str, pattern: &str) -> bool {
    match op {
        "equals" => field.eq_ignore_ascii_case(pattern),
        "contains" => field.to_lowercase().contains(&pattern.to_lowercase()),
        "starts_with" => field
            .to_lowercase()
            .starts_with(&pattern.to_lowercase()),
        "regex" => {
            // Limit pattern length to prevent ReDoS from user-supplied regexes
            if pattern.len() > 500 {
                return false;
            }
            Regex::new(pattern)
                .map(|re| re.is_match(field))
                .unwrap_or(false)
        }
        _ => false,
    }
}

/// Simple SQL-LIKE style matching (case-insensitive).
/// Supports `%` as a wildcard for zero-or-more characters.
/// Rejects patterns longer than 500 characters (consistent with `match_condition`).
fn like_match(value: &str, pattern: &str) -> bool {
    if pattern.len() > 500 {
        return false;
    }
    let lower_val = value.to_lowercase();
    let lower_pat = pattern.to_lowercase();

    // Convert SQL LIKE pattern to a regex:
    //   % → .*
    //   _ → .  (standard SQL LIKE)
    //   Escape other regex metacharacters
    let mut regex_str = String::from("^");
    for ch in lower_pat.chars() {
        match ch {
            '%' => regex_str.push_str(".*"),
            '_' => regex_str.push('.'),
            // Escape regex metacharacters
            '.' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '\\' | '^' | '$'
            | '|' => {
                regex_str.push('\\');
                regex_str.push(ch);
            }
            _ => regex_str.push(ch),
        }
    }
    regex_str.push('$');

    Regex::new(&regex_str)
        .map(|re| re.is_match(&lower_val))
        .unwrap_or(false)
}

/// Tokenize a title for fuzzy matching: lowercase, split on non-alphanumeric
/// boundaries, keep tokens of length >= 2 (drops separators and noise).
fn title_tokens(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 2)
        .map(|t| t.to_string())
        .collect()
}

/// Number of tokens shared between a window title and a stored (LIKE) pattern.
/// `%` wildcards in the pattern are treated as separators.
fn title_token_overlap(title: &str, pattern: &str) -> usize {
    let pat_tokens: std::collections::HashSet<String> =
        title_tokens(&pattern.replace('%', " ")).into_iter().collect();
    if pat_tokens.is_empty() {
        return 0;
    }
    title_tokens(title)
        .into_iter()
        .filter(|t| pat_tokens.contains(t))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    /// Creates an in-memory SQLite database with the full schema and foreign keys enabled.
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn
    }

    /// Insert a project and return its id.
    fn insert_project(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, datetime('now'), datetime('now'))",
            rusqlite::params![id, name],
        )
        .expect("insert project");
    }

    /// Insert a classification rule.
    fn insert_rule(
        conn: &Connection,
        priority: i32,
        cond_type: &str,
        cond_op: &str,
        cond_value: &str,
        project_id: &str,
        category: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO classification_rules (name, priority, condition_type, condition_op, condition_value, target_project_id, target_category)
             VALUES ('test-rule', ?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![priority, cond_type, cond_op, cond_value, project_id, category],
        )
        .expect("insert rule");
    }

    // -----------------------------------------------------------------------
    // match_condition — four operators
    // -----------------------------------------------------------------------

    #[test]
    fn match_condition_contains_case_insensitive() {
        assert!(match_condition("VS Code - my_project", "contains", "my_project"));
        assert!(match_condition("VS Code - MY_PROJECT", "contains", "my_project"));
        assert!(!match_condition("VS Code - other", "contains", "my_project"));
    }

    #[test]
    fn match_condition_equals_case_insensitive() {
        assert!(match_condition("Chrome", "equals", "chrome"));
        assert!(match_condition("chrome", "equals", "Chrome"));
        assert!(!match_condition("Google Chrome", "equals", "Chrome"));
    }

    #[test]
    fn match_condition_starts_with_case_insensitive() {
        assert!(match_condition("Visual Studio Code", "starts_with", "visual"));
        assert!(match_condition("VISUAL Studio Code", "starts_with", "visual"));
        assert!(!match_condition("Code Runner", "starts_with", "visual"));
    }

    #[test]
    fn match_condition_regex_basic() {
        assert!(match_condition("ticket-1234", "regex", r"ticket-\d+"));
        assert!(!match_condition("no-match-here", "regex", r"ticket-\d+"));
    }

    #[test]
    fn match_condition_regex_rejects_long_patterns() {
        // Patterns over 500 chars are rejected to prevent ReDoS
        let long_pattern = "a".repeat(501);
        assert!(!match_condition("aaa", "regex", &long_pattern));
    }

    #[test]
    fn match_condition_regex_invalid_returns_false() {
        assert!(!match_condition("test", "regex", "[invalid"));
    }

    #[test]
    fn match_condition_unknown_op_returns_false() {
        assert!(!match_condition("test", "unknown_op", "test"));
    }

    // -----------------------------------------------------------------------
    // like_match
    // -----------------------------------------------------------------------

    #[test]
    fn like_match_exact() {
        assert!(like_match("hello", "hello"));
        assert!(!like_match("hello", "world"));
    }

    #[test]
    fn like_match_wildcard_percent() {
        assert!(like_match("VS Code - project", "%project%"));
        assert!(like_match("VS Code - project", "VS Code%"));
        assert!(like_match("VS Code - project", "%project"));
    }

    #[test]
    fn like_match_underscore() {
        assert!(like_match("abc", "a_c"));
        assert!(!like_match("abbc", "a_c"));
    }

    #[test]
    fn like_match_case_insensitive() {
        assert!(like_match("Hello World", "%hello%"));
        assert!(like_match("HELLO WORLD", "%hello%"));
    }

    // -----------------------------------------------------------------------
    // classify_by_rules — integration tests with DB
    // -----------------------------------------------------------------------

    #[test]
    fn classify_by_rules_contains_op() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "window_title", "contains", "my_project", "p1", Some("development"));

        let result = RuleEngine::classify_by_rules(&conn, "vscode", "VS Code - my_project", None, None);
        assert!(result.is_some());
        let m = result.unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p1"));
        assert_eq!(m.category.as_deref(), Some("development"));
        assert!((m.confidence - 0.98).abs() < f64::EPSILON);
        assert_eq!(m.source, "rule");
        // Reason cites the field + value that fired, so the timeline can explain
        // the match ("Regel — window_title my_project").
        assert_eq!(m.reason, "window_title my_project");
    }

    #[test]
    fn classify_by_rules_equals_op() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "app_name", "equals", "Figma", "p1", Some("design"));

        let result = RuleEngine::classify_by_rules(&conn, "Figma", "Some Title", None, None);
        assert!(result.is_some());
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p1"));
    }

    #[test]
    fn classify_by_rules_starts_with_op() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "url", "starts_with", "https://github.com/myorg", "p1", None);

        let result = RuleEngine::classify_by_rules(
            &conn,
            "Chrome",
            "GitHub",
            Some("https://github.com/myorg/repo"),
            None,
        );
        assert!(result.is_some());
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p1"));
    }

    #[test]
    fn classify_by_rules_regex_op() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "git_repo", "regex", r"^myorg/.*", "p1", None);

        let result = RuleEngine::classify_by_rules(
            &conn,
            "vscode",
            "index.ts",
            None,
            Some("myorg/my-repo"),
        );
        assert!(result.is_some());
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p1"));
    }

    #[test]
    fn classify_by_rules_priority_ordering() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Low Priority Project");
        insert_project(&conn, "p2", "High Priority Project");
        // Lower priority rule matches the same field
        insert_rule(&conn, 1, "app_name", "equals", "vscode", "p1", None);
        // Higher priority rule also matches
        insert_rule(&conn, 100, "app_name", "equals", "vscode", "p2", None);

        let result = RuleEngine::classify_by_rules(&conn, "vscode", "title", None, None);
        assert!(result.is_some());
        // Highest priority rule should win
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p2"));
    }

    #[test]
    fn app_name_rule_on_multi_project_app_stays_below_auto_confirm() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "app_name", "equals", "vscode", "p1", None);

        let m = RuleEngine::classify_by_rules(&conn, "vscode", "title", None, None).unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p1"));
        // Under 0.95 — må ikke auto-bekræftes
        assert!((m.confidence - 0.85).abs() < f64::EPSILON);
    }

    #[test]
    fn app_name_rule_on_single_purpose_app_keeps_full_confidence() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        // A genuinely single-purpose app: its window is always the same work.
        insert_rule(&conn, 10, "app_name", "equals", "Spark Desktop", "p1", Some("mail"));

        let m = RuleEngine::classify_by_rules(&conn, "Spark Desktop", "Spark Desktop", None, None)
            .unwrap();
        assert!((m.confidence - 0.98).abs() < f64::EPSILON);
    }

    /// BEHAVIOUR CHANGE (v0.2.18): apps that host distinct DOCUMENTS — Figma
    /// files, Obsidian vaults, Word documents — are multi-project too. A
    /// freelancer's Figma holds several clients' designs, so an app_name-only
    /// rule there must NOT auto-confirm (0.95+) and silently bill every client's
    /// design work to one project. It now caps at 0.85 and the user reviews it.
    /// Previously Figma was treated as single-purpose and kept full confidence.
    #[test]
    fn app_name_rule_on_document_hosting_app_requires_review() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "app_name", "equals", "Figma", "p1", Some("design"));

        let m = RuleEngine::classify_by_rules(&conn, "Figma", "Kunde A — Landingpage", None, None)
            .unwrap();
        assert!(
            m.confidence < 0.95,
            "Figma hosts many clients' files — an app rule must not auto-confirm"
        );
        assert!((m.confidence - 0.85).abs() < f64::EPSILON);
    }

    #[test]
    fn title_rule_on_multi_project_app_keeps_full_confidence() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "git_repo", "regex", r"^myorg/.*", "p1", None);

        let m = RuleEngine::classify_by_rules(&conn, "vscode", "index.ts", None, Some("myorg/x"))
            .unwrap();
        assert!((m.confidence - 0.98).abs() < f64::EPSILON);
    }

    #[test]
    fn classify_by_rules_no_rules_returns_none() {
        let conn = setup_db();
        let result = RuleEngine::classify_by_rules(&conn, "vscode", "title", None, None);
        assert!(result.is_none());
    }

    #[test]
    fn classify_by_rules_no_matching_rule_returns_none() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "app_name", "equals", "Figma", "p1", None);

        let result = RuleEngine::classify_by_rules(&conn, "Chrome", "Google", None, None);
        assert!(result.is_none());
    }

    #[test]
    fn classify_by_rules_skips_inactive_rules() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        // Insert active rule
        insert_rule(&conn, 10, "app_name", "equals", "vscode", "p1", None);
        // Deactivate it
        conn.execute("UPDATE classification_rules SET is_active = 0", [])
            .expect("deactivate rule");

        let result = RuleEngine::classify_by_rules(&conn, "vscode", "title", None, None);
        assert!(result.is_none());
    }

    #[test]
    fn classify_by_rules_url_none_skips_url_condition() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");
        insert_rule(&conn, 10, "url", "contains", "github", "p1", None);

        // URL is None, so the url condition should not match
        let result = RuleEngine::classify_by_rules(&conn, "Chrome", "GitHub", None, None);
        assert!(result.is_none());
    }

    // -----------------------------------------------------------------------
    // classify_by_history — confidence scaling
    // -----------------------------------------------------------------------

    #[test]
    fn classify_by_history_confidence_scales_with_count() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        // Insert a confirmed pattern with count = 1
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
             VALUES ('vscode', '%project%', 'p1', 'development', 1)",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify_by_history(&conn, "vscode", "VS Code - project", None, None, None);
        assert!(result.is_some());
        let m = result.unwrap();
        // confidence = min(0.5 + 1 * 0.05, 0.90) = 0.55
        assert!((m.confidence - 0.55).abs() < f64::EPSILON);
        assert_eq!(m.source, "pattern");
        // No repo/context signal → the reason cites the matching title pattern.
        assert_eq!(m.reason, "window_title %project%");
    }

    #[test]
    fn classify_by_history_confidence_caps_at_090() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        // With count = 100, confidence should cap at 0.90
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
             VALUES ('vscode', '%project%', 'p1', 'development', 100)",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify_by_history(&conn, "vscode", "VS Code - project", None, None, None);
        assert!(result.is_some());
        assert!((result.unwrap().confidence - 0.90).abs() < f64::EPSILON);
    }

    #[test]
    fn classify_by_history_picks_best_confidence() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Project A");
        insert_project(&conn, "p2", "Project B");

        // Pattern with low count
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
             VALUES ('chrome', '%docs%', 'p1', 'writing', 1)",
            [],
        ).expect("insert pattern 1");

        // Pattern with high count — should win
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
             VALUES ('chrome', '%docs%', 'p2', 'research', 8)",
            [],
        ).expect("insert pattern 2");

        let result = RuleEngine::classify_by_history(&conn, "chrome", "Google Docs - report", None, None, None);
        assert!(result.is_some());
        let m = result.unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p2"));
        // confidence = min(0.5 + 8 * 0.05, 0.90) = 0.90
        assert!((m.confidence - 0.90).abs() < f64::EPSILON);
    }

    #[test]
    fn classify_by_history_no_patterns_returns_none() {
        let conn = setup_db();
        let result = RuleEngine::classify_by_history(&conn, "vscode", "title", None, None, None);
        assert!(result.is_none());
    }

    #[test]
    fn classify_by_history_no_matching_title_returns_none() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
             VALUES ('vscode', '%special_term%', 'p1', 'development', 5)",
            [],
        ).expect("insert pattern");

        // Window title does not match the pattern
        let result = RuleEngine::classify_by_history(&conn, "vscode", "unrelated title", None, None, None);
        assert!(result.is_none());
    }

    #[test]
    fn classify_by_history_no_pattern_matches_by_app_name_alone() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        // Insert pattern with NULL window_title_pattern — should match any title for that app
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
             VALUES ('Figma', NULL, 'p1', 'design', 3)",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify_by_history(&conn, "Figma", "any title here", None, None, None);
        assert!(result.is_some());
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p1"));
    }

    // -----------------------------------------------------------------------
    // classify — combined: rules before history
    // -----------------------------------------------------------------------

    #[test]
    fn classify_rules_take_priority_over_history() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Rule Project");
        insert_project(&conn, "p2", "History Project");

        // Rule matching app_name
        insert_rule(&conn, 10, "app_name", "equals", "vscode", "p1", Some("development"));

        // Confirmed pattern for same app but different project
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
             VALUES ('vscode', NULL, 'p2', 'development', 50)",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify(&conn, "vscode", "title", None, None, None);
        assert!(result.is_some());
        // Rule should win
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p1"));
    }

    #[test]
    fn classify_falls_back_to_history_when_no_rules_match() {
        let conn = setup_db();
        insert_project(&conn, "p1", "History Project");

        // No rules, but there's a confirmed pattern
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, category, confirmation_count)
             VALUES ('Figma', NULL, 'p1', 'design', 5)",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify(&conn, "Figma", "title", None, None, None);
        assert!(result.is_some());
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p1"));
    }

    // -----------------------------------------------------------------------
    // confirm_pattern — create and increment
    // -----------------------------------------------------------------------

    #[test]
    fn confirm_pattern_creates_new_entry() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("vscode", "title"), Some("p1"), None, Some("development"))
            .expect("confirm_pattern");

        let (count, category): (i64, Option<String>) = conn
            .query_row(
                "SELECT confirmation_count, category FROM confirmed_patterns WHERE app_name = 'vscode' AND project_id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query pattern");

        assert_eq!(count, 1);
        assert_eq!(category.as_deref(), Some("development"));
    }

    #[test]
    fn confirm_pattern_increments_existing() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        // Confirm twice
        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("vscode", "title"), Some("p1"), None, Some("development"))
            .expect("first confirm");
        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("vscode", "title"), Some("p1"), None, Some("development"))
            .expect("second confirm");

        let count: i64 = conn
            .query_row(
                "SELECT confirmation_count FROM confirmed_patterns WHERE app_name = 'vscode' AND project_id = 'p1'",
                [],
                |row| row.get(0),
            )
            .expect("query count");

        assert_eq!(count, 2);
    }

    #[test]
    fn confirm_pattern_different_project_creates_separate_entry() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Project A");
        insert_project(&conn, "p2", "Project B");

        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("vscode", "title"), Some("p1"), None, None)
            .expect("confirm p1");
        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("vscode", "title"), Some("p2"), None, None)
            .expect("confirm p2");

        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM confirmed_patterns", [], |row| row.get(0))
            .expect("count");

        assert_eq!(total, 2);
    }

    // -----------------------------------------------------------------------
    // title tokenization + tie-breaker
    // -----------------------------------------------------------------------

    #[test]
    fn title_tokens_splits_and_filters() {
        assert_eq!(
            title_tokens("main.rs — timetrack-desktop"),
            vec!["main", "rs", "timetrack", "desktop"]
        );
        // Single-char tokens dropped.
        assert_eq!(title_tokens("a-bb-c"), vec!["bb"]);
    }

    #[test]
    fn title_token_overlap_counts_shared_tokens() {
        assert_eq!(
            title_token_overlap("index.ts — my-api", "%my-api%"),
            2 // "my" + "api"
        );
        assert_eq!(title_token_overlap("index.ts — web", "%api%"), 0);
    }

    #[test]
    fn classify_by_history_tiebreak_prefers_token_overlap() {
        let conn = setup_db();
        insert_project(&conn, "p_api", "API");
        insert_project(&conn, "p_web", "Web");

        // Two patterns for the same app with the SAME confirmation_count (=> same
        // confidence). The one whose pattern shares tokens with the title must win.
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count)
             VALUES ('code', '%web%', 'p_web', 5)",
            [],
        ).expect("insert web pattern");
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count)
             VALUES ('code', '%my-api%', 'p_api', 5)",
            [],
        ).expect("insert api pattern");

        // Title matches both LIKE patterns? Only the api one (contains "my-api").
        // Use a title that matches BOTH to exercise the tie-break.
        let result = RuleEngine::classify_by_history(&conn, "code", "index.ts - web my-api", None, None, None);
        assert!(result.is_some());
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p_api"));
    }

    #[test]
    fn classify_by_history_tiebreak_is_deterministic_on_full_tie() {
        // Two patterns: same confirmation_count (=> same confidence) AND the same
        // token overlap with the title. The result must be deterministic across
        // runs regardless of SQLite's natural row order. We assert the lower
        // project_id wins (ORDER BY ... project_id ASC).
        let conn = setup_db();
        insert_project(&conn, "p_aaa", "AAA");
        insert_project(&conn, "p_zzz", "ZZZ");

        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count)
             VALUES ('code', '%shared%', 'p_zzz', 5)",
            [],
        ).expect("insert zzz pattern");
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count)
             VALUES ('code', '%shared%', 'p_aaa', 5)",
            [],
        ).expect("insert aaa pattern");

        // Same confidence (count=5), same overlap (both "%shared%" share "shared").
        let result = RuleEngine::classify_by_history(&conn, "code", "index.ts - shared", None, None, None);
        assert!(result.is_some());
        assert_eq!(result.unwrap().project_id.as_deref(), Some("p_aaa"));
    }

    // -----------------------------------------------------------------------
    // git_repo / context_path — anti-misattribution guard + bonus
    // -----------------------------------------------------------------------

    #[test]
    fn history_pattern_with_different_git_repo_is_skipped() {
        let conn = setup_db();
        insert_project(&conn, "p_a", "Kunde A");

        // Pattern learned in kunde-a/web — title matches the activity, but the
        // activity is in a DIFFERENT customer's repo.
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count, git_repo)
             VALUES ('code', '%index%', 'p_a', 10, 'kunde-a/web')",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify_by_history(
            &conn,
            "code",
            "index.ts - editing",
            None,
            Some("kunde-b/api"),
            None,
        );
        assert!(result.is_none(), "pattern from another repo must not match");
    }

    #[test]
    fn history_pattern_with_different_context_path_is_skipped() {
        let conn = setup_db();
        insert_project(&conn, "p_a", "Kunde A");

        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count, context_path)
             VALUES ('orca', NULL, 'p_a', 10, 'C:/work/kunde-a')",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify_by_history(
            &conn,
            "orca",
            "Orca",
            None,
            None,
            Some("C:/work/kunde-b"),
        );
        assert!(result.is_none(), "pattern from another context path must not match");
    }

    #[test]
    fn history_exact_git_repo_match_boosts_confidence_above_cap() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        // count = 8 → base = min(0.5 + 8*0.05, 0.90) = 0.90; exact repo match
        // adds +0.07 → 0.97, deliberately above the 0.95 auto-confirm threshold.
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count, git_repo)
             VALUES ('code', '%project%', 'p1', 8, 'myorg/repo')",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify_by_history(
            &conn,
            "code",
            "VS Code - project",
            None,
            Some("myorg/repo"),
            None,
        );
        assert!(result.is_some());
        let m = result.unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p1"));
        assert!((m.confidence - 0.97).abs() < f64::EPSILON);
        // Exact repo match is the strongest signal → the reason cites the repo.
        assert_eq!(m.source, "pattern");
        assert_eq!(m.reason, "git_repo myorg/repo");
    }

    #[test]
    fn history_context_path_match_gives_same_bonus_not_stacked() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        // Both git_repo AND context_path match — bonus applies exactly once.
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count, git_repo, context_path)
             VALUES ('code', '%project%', 'p1', 8, 'myorg/repo', 'C:/work/repo')",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify_by_history(
            &conn,
            "code",
            "VS Code - project",
            None,
            Some("myorg/repo"),
            Some("C:/work/repo"),
        );
        assert!(result.is_some());
        // 0.90 + 0.07 = 0.97, NOT 0.90 + 0.14
        assert!((result.unwrap().confidence - 0.97).abs() < f64::EPSILON);
    }

    #[test]
    fn history_pattern_without_git_repo_matches_as_before() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        // Legacy pattern (NULL git_repo/context_path) must keep matching
        // activities regardless of their repo — backwards compatibility —
        // and must NOT receive the bonus.
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count)
             VALUES ('code', '%project%', 'p1', 5)",
            [],
        ).expect("insert pattern");

        let result = RuleEngine::classify_by_history(
            &conn,
            "code",
            "VS Code - project",
            None,
            Some("any/repo"),
            Some("C:/anywhere"),
        );
        assert!(result.is_some());
        // base = min(0.5 + 5*0.05, 0.90) = 0.75 — no bonus for NULL pattern fields
        assert!((result.unwrap().confidence - 0.75).abs() < f64::EPSILON);
    }

    #[test]
    fn confirm_pattern_stores_and_backfills_git_repo_and_context_path() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        // First confirm without repo/path — row gets NULLs.
        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("code", "title"), Some("p1"), None, None)
            .expect("first confirm");

        let (git_repo, context_path): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT git_repo, context_path FROM confirmed_patterns WHERE app_name = 'code' AND project_id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query pattern");
        assert!(git_repo.is_none());
        assert!(context_path.is_none());

        // Second confirm with known repo/path — NULLs are backfilled.
        RuleEngine::confirm_pattern(
            &conn,
            &ActivitySignals {
                git_repo: Some("myorg/repo".to_string()),
                context_path: Some("C:/work/repo".to_string()),
                ..ActivitySignals::titled("code", "title")
            },
            Some("p1"),
            None,
            None,
        )
        .expect("second confirm");

        let (count, git_repo, context_path): (i64, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT confirmation_count, git_repo, context_path FROM confirmed_patterns WHERE app_name = 'code' AND project_id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("query pattern");
        assert_eq!(count, 2);
        assert_eq!(git_repo.as_deref(), Some("myorg/repo"));
        assert_eq!(context_path.as_deref(), Some("C:/work/repo"));

        // Third confirm with a DIFFERENT repo — existing values are kept, not overwritten.
        RuleEngine::confirm_pattern(
            &conn,
            &ActivitySignals {
                git_repo: Some("other/repo".to_string()),
                ..ActivitySignals::titled("code", "title")
            },
            Some("p1"),
            None,
            None,
        )
        .expect("third confirm");

        let git_repo: Option<String> = conn
            .query_row(
                "SELECT git_repo FROM confirmed_patterns WHERE app_name = 'code' AND project_id = 'p1'",
                [],
                |row| row.get(0),
            )
            .expect("query pattern");
        assert_eq!(git_repo.as_deref(), Some("myorg/repo"));
    }

    #[test]
    fn derived_app_context_improves_history_match() {
        use crate::tracker::title::derive_app_context;

        let conn = setup_db();
        insert_project(&conn, "p1", "Kunde A");

        // A confirmed Figma pattern that stored the derived project-context
        // fragment. count = 8 → base 0.90.
        let ctx = derive_app_context("Figma", "Kunde A — Landingpage")
            .expect("figma context derives");
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count, context_path)
             VALUES ('Figma', '%Landingpage%', 'p1', 8, ?1)",
            rusqlite::params![ctx],
        )
        .expect("insert pattern");

        // WITH the derived context the exact-match bonus lifts confidence over
        // the 0.95 auto-confirm threshold; WITHOUT it stays at the base.
        let with_ctx = RuleEngine::classify_by_history(
            &conn,
            "Figma",
            "Kunde A — Landingpage",
            None,
            None,
            Some(ctx.as_str()),
        )
        .expect("match with context");
        let without_ctx = RuleEngine::classify_by_history(
            &conn,
            "Figma",
            "Kunde A — Landingpage",
            None,
            None,
            None,
        )
        .expect("match without context");

        assert!((with_ctx.confidence - 0.97).abs() < f64::EPSILON);
        assert!((without_ctx.confidence - 0.90).abs() < f64::EPSILON);
        assert!(with_ctx.confidence > without_ctx.confidence);
    }

    // -----------------------------------------------------------------------
    // suggest_from_context — manual timer-start project suggestion
    // -----------------------------------------------------------------------

    #[test]
    fn suggest_from_context_returns_rule_match_with_app_title_reason() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Kunde A");
        // A title rule → full confidence (0.98), no repo/context signal.
        insert_rule(&conn, 10, "window_title", "contains", "kunde-a", "p1", None);

        let s = suggest_from_context(&conn, "Figma", "Kunde-A — Landingpage", None, None, None)
            .expect("confident rule match suggests");
        assert_eq!(s.project_id, "p1");
        assert_eq!(s.project_name, "Kunde A");
        // No repo/context path → reason falls back to the app.
        assert_eq!(s.reason_kind, "app_title");
        assert_eq!(s.reason_detail, "Figma");
        assert!(s.confidence >= SUGGESTION_MIN_CONFIDENCE);
    }

    #[test]
    fn suggest_from_context_uses_git_repo_reason_on_history_match() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Kunde Web");
        // count 8 → base 0.90, exact repo bonus → 0.97, well over the threshold.
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count, git_repo)
             VALUES ('code', '%project%', 'p1', 8, 'kunde-web')",
            [],
        ).expect("insert pattern");

        let s = suggest_from_context(
            &conn,
            "code",
            "VS Code - project",
            None,
            Some("kunde-web"),
            None,
        )
        .expect("confident history match suggests");
        assert_eq!(s.project_id, "p1");
        assert_eq!(s.reason_kind, "git_repo");
        assert_eq!(s.reason_detail, "kunde-web");
    }

    #[test]
    fn suggest_from_context_returns_none_below_threshold() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Kunde A");
        // count 1 → confidence 0.55, below the 0.70 suggestion bar → no guess.
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern, project_id, confirmation_count)
             VALUES ('code', '%project%', 'p1', 1)",
            [],
        ).expect("insert pattern");

        let s = suggest_from_context(&conn, "code", "VS Code - project", None, None, None);
        assert!(s.is_none(), "low-confidence match must not pre-fill");
    }

    #[test]
    fn suggest_from_context_returns_none_without_match() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Kunde A");

        let s = suggest_from_context(&conn, "code", "unrelated window", None, None, None);
        assert!(s.is_none());
    }

    #[test]
    fn suggest_from_context_skips_archived_project() {
        let conn = setup_db();
        insert_project(&conn, "p1", "Kunde A");
        insert_rule(&conn, 10, "window_title", "contains", "kunde-a", "p1", None);
        conn.execute("UPDATE projects SET is_archived = 1 WHERE id = 'p1'", [])
            .expect("archive project");

        let s = suggest_from_context(&conn, "Figma", "Kunde-A — Landingpage", None, None, None);
        assert!(s.is_none(), "a match to an archived project must not be shown");
    }

    #[test]
    fn confirm_pattern_new_entry_stores_git_repo_and_context_path() {
        let conn = setup_db();
        insert_project(&conn, "p1", "My Project");

        RuleEngine::confirm_pattern(
            &conn,
            &ActivitySignals {
                git_repo: Some("kunde-a/web".to_string()),
                context_path: Some("C:/work/kunde-a".to_string()),
                ..ActivitySignals::titled("code", "title")
            },
            Some("p1"),
            None,
            Some("development"),
        )
        .expect("confirm");

        let (git_repo, context_path): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT git_repo, context_path FROM confirmed_patterns WHERE app_name = 'code' AND project_id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query pattern");
        assert_eq!(git_repo.as_deref(), Some("kunde-a/web"));
        assert_eq!(context_path.as_deref(), Some("C:/work/kunde-a"));
    }
}

// -----------------------------------------------------------------------
// Rules that target a CUSTOMER without a project
// -----------------------------------------------------------------------

#[cfg(test)]
mod customer_tests {
    use super::*;
    use crate::db::schema::SCHEMA;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable foreign keys");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn
    }

    fn insert_client(conn: &Connection, id: &str, name: &str) {
        conn.execute(
            "INSERT INTO clients (id, name) VALUES (?1, ?2)",
            rusqlite::params![id, name],
        )
        .expect("insert client");
    }

    fn insert_project_for_client(conn: &Connection, id: &str, client_id: &str, name: &str) {
        conn.execute(
            "INSERT INTO projects (id, name, client_id) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, name, client_id],
        )
        .expect("insert project");
    }

    /// A rule that names only a customer — no project.
    fn insert_client_rule(conn: &Connection, cond_type: &str, cond_value: &str, client_id: &str) {
        conn.execute(
            "INSERT INTO classification_rules
                 (name, priority, condition_type, condition_op, condition_value, target_client_id, target_category)
             VALUES ('kunde-regel', 10, ?1, 'equals', ?2, ?3, 'consulting')",
            rusqlite::params![cond_type, cond_value, client_id],
        )
        .expect("insert customer rule");
    }

    #[test]
    fn rule_targeting_a_customer_without_a_project_matches() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Kunde A");
        insert_client_rule(&conn, "git_repo", "kunde-a/support", "c1");

        let m = RuleEngine::classify_by_rules(&conn, "code", "some file", None, Some("kunde-a/support"))
            .expect("a customer rule must produce a match even with no project");

        assert_eq!(m.project_id, None, "the rule names no project");
        assert_eq!(m.client_id.as_deref(), Some("c1"), "the rule names a customer");
    }

    #[test]
    fn rule_targeting_both_a_project_and_a_customer_keeps_both() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Kunde A");
        insert_project_for_client(&conn, "p1", "c1", "Kunde A - website");
        conn.execute(
            "INSERT INTO classification_rules
                 (name, priority, condition_type, condition_op, condition_value, target_project_id, target_client_id)
             VALUES ('begge', 10, 'git_repo', 'equals', 'kunde-a/web', 'p1', 'c1')",
            [],
        )
        .expect("insert rule");

        let m = RuleEngine::classify_by_rules(&conn, "code", "f", None, Some("kunde-a/web")).unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p1"));
        assert_eq!(m.client_id.as_deref(), Some("c1"));
    }

    #[test]
    fn project_rule_carries_the_projects_customer() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Kunde A");
        insert_project_for_client(&conn, "p1", "c1", "Kunde A - website");
        conn.execute(
            "INSERT INTO classification_rules
                 (name, priority, condition_type, condition_op, condition_value, target_project_id)
             VALUES ('projekt-regel', 10, 'git_repo', 'equals', 'kunde-a/web', 'p1')",
            [],
        )
        .expect("insert rule");

        let m = RuleEngine::classify_by_rules(&conn, "code", "f", None, Some("kunde-a/web")).unwrap();
        assert_eq!(
            m.client_id.as_deref(),
            Some("c1"),
            "a project rule must resolve its own customer, so billing never depends on the caller"
        );
    }

    #[test]
    fn rule_with_neither_project_nor_customer_does_not_match() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO classification_rules
                 (name, priority, condition_type, condition_op, condition_value, target_category)
             VALUES ('uconfigureret', 10, 'git_repo', 'equals', 'kunde-a/web', 'development')",
            [],
        )
        .expect("insert rule");

        assert!(
            RuleEngine::classify_by_rules(&conn, "code", "f", None, Some("kunde-a/web")).is_none(),
            "a rule naming nobody must not classify to nobody"
        );
    }

    #[test]
    fn project_without_customer_leaves_the_customer_unset() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO projects (id, name) VALUES ('p1', 'Orphan project')",
            [],
        )
        .expect("a project with no customer is legal");
        conn.execute(
            "INSERT INTO classification_rules
                 (name, priority, condition_type, condition_op, condition_value, target_project_id)
             VALUES ('projekt-regel', 10, 'git_repo', 'equals', 'kunde-a/web', 'p1')",
            [],
        )
        .expect("insert rule");

        let m = RuleEngine::classify_by_rules(&conn, "code", "f", None, Some("kunde-a/web")).unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p1"));
        assert_eq!(m.client_id, None, "no customer to resolve is not an error");
    }

    // ---- confirmed_patterns: the same customer-without-project shape ----

    /// A pattern learned for a customer alone classifies to that customer.
    /// Before `client_id` existed this row could not even be written, and
    /// `classify_by_history` read `project_id` as `String` — so a NULL there
    /// made rusqlite error, the loop skipped the row, and the whole pattern
    /// layer went quiet for that app.
    #[test]
    fn pattern_for_customer_without_project_classifies_to_the_customer() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Kunde uden projekter");
        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("mail", "Post"), None, Some("c1"), None)
            .expect("confirm for customer only");

        let m = RuleEngine::classify_by_history(&conn, "mail", "Post", None, None, None)
            .expect("the learned pattern must classify");
        assert_eq!(m.project_id, None);
        assert_eq!(m.client_id.as_deref(), Some("c1"));
    }

    /// The same signal confirmed twice must stay ONE row. The lookup matches
    /// project AND customer, NULL-safely: `project_id = NULL` is never true in
    /// SQL, so a plain comparison would insert a duplicate, and the two rows
    /// would then score identically — which one wins becomes arbitrary.
    #[test]
    fn customer_only_pattern_is_incremented_not_duplicated() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Kunde");
        for _ in 0..3 {
            RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("mail", "Post"), None, Some("c1"), None)
                .expect("confirm");
        }

        let (rows, count): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), MAX(confirmation_count) FROM confirmed_patterns",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query");
        assert_eq!(rows, 1, "the same signal must not be learned twice");
        assert_eq!(count, 3);
    }

    /// A customer-only pattern and a project pattern for the same app/title are
    /// different facts, so they stay separate rows — and a pattern's own
    /// customer wins over a lookup, exactly like a rule's.
    #[test]
    fn customer_only_and_project_patterns_stay_separate() {
        let conn = setup_db();
        insert_client(&conn, "c1", "Kunde");
        insert_project_for_client(&conn, "p1", "c1", "Projekt");
        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("code", "title"), None, Some("c1"), None)
            .expect("confirm customer only");
        RuleEngine::confirm_pattern(&conn, &ActivitySignals::titled("code", "title"), Some("p1"), Some("c1"), None)
            .expect("confirm project");

        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM confirmed_patterns", [], |row| row.get(0))
            .expect("query");
        assert_eq!(rows, 2);
    }

    /// A pattern naming neither is unconfigured (a customer may have been
    /// deleted) and is skipped, never classified to nobody.
    #[test]
    fn pattern_with_neither_project_nor_customer_is_skipped() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO confirmed_patterns (app_name, window_title_pattern) VALUES ('code', 'title')",
            [],
        )
        .expect("a pattern may name nobody");

        assert!(
            RuleEngine::classify_by_history(&conn, "code", "title", None, None, None).is_none(),
            "an unconfigured pattern must not classify the activity to nobody"
        );
    }
}
