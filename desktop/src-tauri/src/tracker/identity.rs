//! Project identity — the missing link between captured context and projects.
//!
//! The tracker reliably captures WHAT you were in (a git repo, a working
//! directory, a browser domain), but a project historically had no way to say
//! "that repo IS me". So the classifier could only guess from project NAMES,
//! and the learning layer could not start until the user confirmed something
//! (which they never did, because the guesses were bad — a cold-start deadlock).
//!
//! A `project_matcher` binds one concrete signal to one project:
//!
//! | kind       | value example                      | matches when                       |
//! |------------|------------------------------------|------------------------------------|
//! | `git_repo` | `ruflo`                            | repo name equals it                |
//! | `path`     | `c:/projects/freelance/kunde-a`    | working dir is at/below it         |
//! | `domain`   | `kunde-a.example.com`              | URL host equals it or is a subdomain|
//! | `keyword`  | `minecraft`                        | window title contains it           |
//! | `app`      | `spark desktop`                    | the app name equals it             |
//!
//! A matcher with a NULL `project_id` marks a signal as deliberately NOT work
//! (facebook, a webshop) — it suppresses classification AND stops the discovery
//! flow from asking about it again.
//!
//! Matching is exact and deterministic: no fuzzy scoring, no model. That is the
//! point — it is the layer that must never be wrong.

use rusqlite::Connection;

use super::rules::RuleMatch;

/// Signal kinds a project can be identified by, strongest evidence first.
/// The order here IS the precedence order used when several matchers hit.
pub const KIND_GIT_REPO: &str = "git_repo";
pub const KIND_PATH: &str = "path";
pub const KIND_DOMAIN: &str = "domain";
pub const KIND_KEYWORD: &str = "keyword";
/// The whole app is one thing: a game, a mail client, an accounting tool. Only
/// valid for apps that do NOT host many projects at once — see
/// `rules::is_multi_project_app`, which the write path enforces.
pub const KIND_APP: &str = "app";

/// All valid matcher kinds — used to reject garbage from the IPC boundary.
pub const ALL_KINDS: &[&str] =
    &[KIND_GIT_REPO, KIND_PATH, KIND_DOMAIN, KIND_KEYWORD, KIND_APP];

/// Confidence per kind. A repo or a working directory is hard evidence about
/// WHICH codebase you were in, so both sit above the tracker's 0.95
/// auto-confirm threshold. A domain is nearly as strong but a shared host
/// (github.com) could span projects, so it lands just below. A title keyword is
/// a hint, not proof, and always requires review.
fn confidence_for(kind: &str) -> f64 {
    match kind {
        KIND_GIT_REPO => 0.98,
        KIND_PATH => 0.96,
        KIND_DOMAIN => 0.94,
        // An app or a title keyword identifies the WORK, not the codebase, so
        // both stay below the tracker's 0.95 auto-confirm threshold: they
        // pre-fill a suggestion the user reviews rather than silently becoming
        // billable time.
        KIND_APP => 0.85,
        _ => 0.80,
    }
}

/// Normalizes a git repository name: trimmed and lowercased.
pub fn normalize_repo(repo: &str) -> String {
    repo.trim().to_lowercase()
}

/// Normalizes a filesystem path for prefix comparison: lowercased, backslashes
/// folded to `/`, and any trailing separator removed. Windows paths are
/// case-insensitive and mixed-separator in practice (`C:\Projects\x` vs
/// `c:/projects/x`), so both sides are folded to one canonical form.
pub fn normalize_path(path: &str) -> String {
    let folded = path.trim().replace('\\', "/").to_lowercase();
    let trimmed = folded.trim_end_matches('/');
    trimmed.to_string()
}

/// Extracts a comparable host from a URL or bare host string: scheme stripped,
/// path/port/credentials removed, lowercased, and a leading `www.` dropped so
/// `www.example.com` and `example.com` are the same site.
pub fn normalize_domain(url: &str) -> String {
    let s = url.trim().to_lowercase();
    let s = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
        .unwrap_or(&s);
    // Drop credentials, then path, then port.
    let s = s.rsplit('@').next().unwrap_or(s);
    let s = s.split('/').next().unwrap_or(s);
    let s = s.split(':').next().unwrap_or(s);
    s.strip_prefix("www.").unwrap_or(s).to_string()
}

/// True when `path` is at or below the directory `prefix`. Guards the boundary
/// so `/projects/foo-bar` is NOT considered inside `/projects/foo`.
pub fn path_is_within(path: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return false;
    }
    if path == prefix {
        return true;
    }
    path.strip_prefix(prefix)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// True when `host` is the site `domain` or a subdomain of it.
fn domain_matches(host: &str, domain: &str) -> bool {
    if domain.is_empty() {
        return false;
    }
    host == domain || host.ends_with(&format!(".{}", domain))
}

/// A candidate matcher row, already normalized.
struct Matcher {
    project_id: Option<String>,
    client_id: Option<String>,
    kind: String,
    value: String,
}

/// Scores how strongly a matcher hits the given signals, or `None` if it does
/// not apply. The score breaks ties between competing matchers: kind confidence
/// first, then specificity (a longer path/domain is a more specific claim, so
/// `…/kunde-a/projekt-b-mcp` beats `…/kunde-a`).
fn score(
    m: &Matcher,
    app: &str,
    title: &str,
    host: Option<&str>,
    repo: Option<&str>,
    path: Option<&str>,
) -> Option<(f64, usize)> {
    let hit = match m.kind.as_str() {
        KIND_GIT_REPO => repo.is_some_and(|r| r == m.value),
        KIND_PATH => path.is_some_and(|p| path_is_within(p, &m.value)),
        KIND_DOMAIN => host.is_some_and(|h| domain_matches(h, &m.value)),
        KIND_KEYWORD => !m.value.is_empty() && title.contains(&m.value),
        KIND_APP => !m.value.is_empty() && app == m.value,
        _ => false,
    };
    hit.then(|| (confidence_for(&m.kind), m.value.len()))
}

/// Classifies an activity from its project-identity matchers.
///
/// This is the FIRST and most trusted layer: it is exact, deterministic, needs
/// no training data, and works from the very first activity. Returns `None`
/// when nothing matches, or when the winning matcher names neither a project
/// nor a customer ("not work") — in that case the activity is deliberately
/// left unclassified rather than guessed at.
pub fn classify_by_identity(
    conn: &Connection,
    app_name: &str,
    window_title: &str,
    url: Option<&str>,
    git_repo: Option<&str>,
    context_path: Option<&str>,
) -> Option<RuleMatch> {
    let repo = git_repo.map(normalize_repo).filter(|s| !s.is_empty());
    let path = context_path.map(normalize_path).filter(|s| !s.is_empty());
    let host = url.map(normalize_domain).filter(|s| !s.is_empty());
    let title = window_title.to_lowercase();
    let app = app_name.trim().to_lowercase();

    // Nothing to match on → skip the query entirely.
    if repo.is_none() && path.is_none() && host.is_none() && title.is_empty() && app.is_empty() {
        return None;
    }

    let mut stmt = conn
        .prepare("SELECT project_id, client_id, kind, value FROM project_matchers")
        .ok()?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Matcher {
                project_id: row.get::<_, Option<String>>(0)?,
                client_id: row.get::<_, Option<String>>(1)?,
                kind: row.get::<_, String>(2)?,
                value: row.get::<_, String>(3)?,
            })
        })
        .ok()?;

    let mut best: Option<(f64, usize, Matcher)> = None;
    for m in rows.flatten() {
        if let Some((conf, spec)) =
            score(&m, &app, &title, host.as_deref(), repo.as_deref(), path.as_deref())
        {
            let better = match &best {
                None => true,
                Some((bc, bs, _)) => conf > *bc || (conf == *bc && spec > *bs),
            };
            if better {
                best = Some((conf, spec, m));
            }
        }
    }

    let (confidence, _, m) = best?;
    // Naming NEITHER a project nor a customer is an explicit "this is not work"
    // marker: suppress classification instead of falling through to a weaker
    // guessing layer. A customer-only row is a real target — that is how a
    // client with no projects gets its portal and inbox billed.
    if m.project_id.is_none() && m.client_id.is_none() {
        return None;
    }

    // The customer follows the project, in one direction only: a project binding
    // resolves its own customer, and only a customer-only binding carries one of
    // its own. Otherwise a repo bound to project A (customer X) plus a stale
    // customer column would name two customers for one activity, and bill the
    // wrong one.
    let client_id = m
        .project_id
        .as_deref()
        .and_then(|p| super::rules::client_of_project(conn, p))
        .or(m.client_id);

    Some(RuleMatch {
        project_id: m.project_id,
        // An identity match names a project or a customer, so it names the
        // customer that gets billed. Resolved here so every layer of `classify`
        // returns the same customer for the same signal.
        client_id,
        category: None,
        confidence,
        source: "identity".to_string(),
        reason: format!("{} {}", m.kind, m.value),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- normalization ----

    #[test]
    fn normalize_path_folds_separators_and_case() {
        assert_eq!(
            normalize_path(r"C:\Projects\Freelance\Kunde-A\"),
            "c:/projects/freelance/kunde-a"
        );
        assert_eq!(normalize_path("/home/mads/repo/"), "/home/mads/repo");
    }

    #[test]
    fn normalize_domain_strips_scheme_path_port_and_www() {
        assert_eq!(normalize_domain("https://www.Example.com/a/b?q=1"), "example.com");
        assert_eq!(normalize_domain("http://kunde-a.example.com:8080/x"), "kunde-a.example.com");
        assert_eq!(normalize_domain("example.com"), "example.com");
    }

    // ---- boundary correctness: the bugs that would misbill a client ----

    #[test]
    fn path_prefix_respects_directory_boundary() {
        assert!(path_is_within("c:/projects/foo", "c:/projects/foo"));
        assert!(path_is_within("c:/projects/foo/src/lib", "c:/projects/foo"));
        // A sibling that merely SHARES a prefix must not match — otherwise work
        // on `foo-bar` would be billed to project `foo`.
        assert!(!path_is_within("c:/projects/foo-bar", "c:/projects/foo"));
        assert!(!path_is_within("c:/projects", "c:/projects/foo"));
    }

    #[test]
    fn domain_matches_subdomains_but_not_lookalikes() {
        assert!(domain_matches("example.com", "example.com"));
        assert!(domain_matches("kunde-a.example.com", "example.com"));
        // `notexample.com` must not match `example.com`.
        assert!(!domain_matches("notexample.com", "example.com"));
    }

    // ---- matching + precedence ----

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::schema::SCHEMA).unwrap();
        conn.execute_batch(
            "INSERT INTO clients (id, name) VALUES ('c1','Kunde');
             INSERT INTO clients (id, name) VALUES ('c2','Kunde uden projekter');
             INSERT INTO projects (id, client_id, name) VALUES ('p-ruflo','c1','Ruflo');
             INSERT INTO projects (id, client_id, name) VALUES ('p-kunde-a','c1','Kunde-A');
             INSERT INTO projects (id, client_id, name) VALUES ('p-projekt-b','c1','Projekt-B');",
        )
        .unwrap();
        conn
    }

    fn add(conn: &Connection, project: Option<&str>, kind: &str, value: &str) {
        conn.execute(
            "INSERT INTO project_matchers (project_id, kind, value) VALUES (?1,?2,?3)",
            rusqlite::params![project, kind, value],
        )
        .unwrap();
    }

    /// A signal bound to a customer on its own — the shape a client with no
    /// projects needs.
    fn add_client(conn: &Connection, client: &str, kind: &str, value: &str) {
        conn.execute(
            "INSERT INTO project_matchers (client_id, kind, value) VALUES (?1,?2,?3)",
            rusqlite::params![client, kind, value],
        )
        .unwrap();
    }

    #[test]
    fn git_repo_matcher_classifies_orca_work() {
        // The real-world case: Orca's window title is literally just "Orca", so
        // the repo is the ONLY usable signal.
        let conn = db();
        add(&conn, Some("p-ruflo"), KIND_GIT_REPO, "ruflo");

        let m = classify_by_identity(&conn, "Orca", "Orca", None, Some("Ruflo"), None)
            .expect("repo should classify");
        assert_eq!(m.project_id.as_deref(), Some("p-ruflo"));
        assert_eq!(m.source, "identity");
        assert!(m.confidence > 0.95, "an exact repo match is hard evidence");
    }

    #[test]
    fn most_specific_path_wins_over_parent() {
        let conn = db();
        add(&conn, Some("p-kunde-a"), KIND_PATH, "c:/projects/freelance/kunde-a");
        add(&conn, Some("p-projekt-b"), KIND_PATH, "c:/projects/freelance/kunde-a/projekt-b-mcp");

        let m = classify_by_identity(
            &conn,
            "Orca",
            "Orca",
            None,
            None,
            Some(r"C:\Projects\Freelance\kunde-a\projekt-b-mcp\src"),
        )
        .expect("path should classify");
        assert_eq!(m.project_id.as_deref(), Some("p-projekt-b"), "the deeper folder is the more specific claim");
    }

    #[test]
    fn repo_beats_domain_when_both_match() {
        let conn = db();
        add(&conn, Some("p-ruflo"), KIND_GIT_REPO, "ruflo");
        add(&conn, Some("p-kunde-a"), KIND_DOMAIN, "example.com");

        let m = classify_by_identity(&conn, "Orca", "x", Some("https://example.com/a"), Some("ruflo"), None).unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p-ruflo"), "a repo is stronger evidence than a domain");
    }

    #[test]
    fn domain_matcher_classifies_browser_time() {
        let conn = db();
        add(&conn, Some("p-kunde-a"), KIND_DOMAIN, "kunde-a.example.com");
        let m = classify_by_identity(&conn, "vivaldi", "Vivaldi", Some("https://kunde-a.example.com/wp-admin"), None, None)
            .expect("domain should classify");
        assert_eq!(m.project_id.as_deref(), Some("p-kunde-a"));
    }

    #[test]
    fn null_project_marks_signal_as_not_work() {
        // "Stop asking me about facebook" — suppresses classification entirely
        // rather than letting a weaker layer guess a project.
        let conn = db();
        add(&conn, None, KIND_DOMAIN, "facebook.com");
        assert!(
            classify_by_identity(&conn, "vivaldi", "Vivaldi", Some("https://www.facebook.com/feed"), None, None).is_none(),
            "a not-work signal must never produce a project"
        );
    }

    #[test]
    fn client_only_matcher_bills_a_customer_without_a_project() {
        // The real case this closes: a customer with NO projects at all. Their
        // portal is a domain, their kickoff is a title — and there is no project
        // to attach it to, so before this the signal could only be marked
        // "not work", which silently discarded billable time.
        let conn = db();
        add_client(&conn, "c2", KIND_DOMAIN, "kunde.dk");

        let m = classify_by_identity(&conn, "vivaldi", "Vivaldi", Some("https://kunde.dk/login"), None, None)
            .expect("a customer-only signal must classify");
        assert_eq!(m.project_id, None, "there is no project, and none is invented");
        assert_eq!(m.client_id.as_deref(), Some("c2"), "the customer is what gets billed");
    }

    #[test]
    fn a_row_naming_neither_project_nor_client_is_still_not_work() {
        // "Stop asking me about facebook" must keep working: "not work" moved
        // from `project_id IS NULL` to BOTH columns NULL, so a customer-only row
        // is no longer mistaken for it.
        let conn = db();
        add(&conn, None, KIND_DOMAIN, "facebook.com");
        assert!(
            classify_by_identity(&conn, "vivaldi", "Vivaldi", Some("https://www.facebook.com/feed"), None, None).is_none(),
            "a signal with no project AND no customer is still not-work"
        );
    }

    #[test]
    fn the_projects_customer_wins_over_the_matchers_own_column() {
        // One activity must never name two customers. A project binding resolves
        // its own customer; the row's own column is a fallback for exactly the
        // rows that have no project.
        let conn = db();
        conn.execute(
            "INSERT INTO project_matchers (project_id, client_id, kind, value)
             VALUES ('p-ruflo', 'c2', 'git_repo', 'ruflo')",
            [],
        )
        .unwrap();

        let m = classify_by_identity(&conn, "Orca", "Orca", None, Some("Ruflo"), None)
            .expect("repo should classify");
        assert_eq!(m.project_id.as_deref(), Some("p-ruflo"));
        assert_eq!(
            m.client_id.as_deref(),
            Some("c1"),
            "the project's own customer wins, or the entry names two customers"
        );
    }

    #[test]
    fn keyword_matcher_catches_signal_that_lives_only_in_the_title() {
        // Real case: `javaw` running Minecraft. There is no repo, no folder and
        // no URL — the ONLY evidence is the window title, and it was being
        // tracked as work.
        let conn = db();
        add(&conn, None, KIND_KEYWORD, "minecraft");
        assert!(
            classify_by_identity(
                &conn,
                "javaw",
                "Minecraft* 1.21.11 - Multiplayer (3rd-party Server)",
                None,
                None,
                None
            )
            .is_none(),
            "a title keyword must be able to mark time as not-work"
        );
    }

    #[test]
    fn app_matcher_classifies_a_single_purpose_app() {
        // A mail client's title is constant ("Spark Desktop") — the app itself
        // is the only signal there is.
        let conn = db();
        add(&conn, Some("p-kunde-a"), KIND_APP, "spark desktop");
        let m = classify_by_identity(&conn, "Spark Desktop", "Spark Desktop", None, None, None)
            .expect("app should classify");
        assert_eq!(m.project_id.as_deref(), Some("p-kunde-a"));
        assert!(
            m.confidence < 0.95,
            "an app binding must stay below auto-confirm — the user reviews it"
        );
    }

    #[test]
    fn stronger_signals_outrank_an_app_binding() {
        // Binding an app must never override the repo the user is actually in.
        let conn = db();
        add(&conn, Some("p-kunde-a"), KIND_APP, "orca");
        add(&conn, Some("p-ruflo"), KIND_GIT_REPO, "ruflo");
        let m = classify_by_identity(&conn, "Orca", "Orca", None, Some("ruflo"), None).unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p-ruflo"));
    }

    #[test]
    fn no_matchers_yields_no_match() {
        let conn = db();
        assert!(classify_by_identity(&conn, "Orca", "Orca", None, Some("ruflo"), None).is_none());
    }

    #[test]
    fn unrelated_signals_do_not_match() {
        let conn = db();
        add(&conn, Some("p-ruflo"), KIND_GIT_REPO, "ruflo");
        assert!(classify_by_identity(&conn, "Orca", "Orca", None, Some("something-else"), None).is_none());
    }
}
