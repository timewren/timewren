//! Privacy exclusion: decide whether a captured foreground window should be
//! dropped from tracking entirely (never stored). Two layers:
//!   1. A built-in incognito / private-browsing heuristic (title markers).
//!   2. User-defined exclusion rules (app/title equals|contains|starts_with|regex).
//!
//! The matching mirrors `rules::match_condition` (same operators + ReDoS guard)
//! so storage can reuse the same string-based shape.

use regex::Regex;

/// Case-insensitive substring markers that indicate a private/incognito
/// browser window across the common browsers and locales (da/en).
const INCOGNITO_MARKERS: &[&str] = &[
    "incognito",        // Chrome, Brave, Opera (en)
    "inprivate",        // Edge
    "private browsing", // Firefox/Safari (en)
    "privat browsing",  // Firefox (da)
    "(private)",        // misc
    "(privat)",         // misc (da)
];

/// System processes that are never real work: while the machine is locked the
/// OS lock/login screen is the foreground window, and the tracker would
/// otherwise record it as activity until idle detection kicks in (up to the
/// idle threshold each time). Confirmed against real data — the Windows lock
/// screen alone accounted for hours of phantom "LockApp" activity. Always
/// excluded, regardless of user settings. Matched on the app/exe name.
const SYSTEM_NEVER_TRACK_APPS: &[&str] = &[
    "lockapp",     // Windows lock screen
    "logonui",     // Windows login / lock UI
    "loginwindow", // macOS lock / login screen
];

/// True if the app is a lock/login screen that must never be tracked.
pub fn is_system_never_track(app_name: &str) -> bool {
    let lower = app_name.trim().to_lowercase();
    SYSTEM_NEVER_TRACK_APPS
        .iter()
        .any(|a| lower == *a || lower.starts_with(a))
}

/// Field a user exclusion rule matches against.
const FIELD_APP: &str = "app_name";
const FIELD_TITLE: &str = "window_title";

/// A single user-defined exclusion rule. String-based to mirror
/// `classification_rules` and ease storage/migration.
#[derive(Debug, Clone)]
pub struct ExclusionRule {
    /// "app_name" | "window_title"
    pub field: String,
    /// "equals" | "contains" | "starts_with" | "regex"
    pub op: String,
    pub value: String,
}

/// Returns true if the window title looks like a private/incognito browser window.
pub fn is_incognito_window(window_title: &str) -> bool {
    let lower = window_title.to_lowercase();
    INCOGNITO_MARKERS.iter().any(|m| lower.contains(m))
}

/// Decide whether a captured window should be excluded from tracking.
///
/// `exclude_incognito` toggles the built-in private-browsing heuristic.
/// Returns true => the activity must NOT be stored.
pub fn should_exclude(
    app_name: &str,
    window_title: &str,
    rules: &[ExclusionRule],
    exclude_incognito: bool,
) -> bool {
    // Lock/login screens are never work — always excluded.
    if is_system_never_track(app_name) {
        return true;
    }

    if exclude_incognito && is_incognito_window(window_title) {
        return true;
    }

    for rule in rules {
        let field_value = match rule.field.as_str() {
            FIELD_APP => app_name,
            FIELD_TITLE => window_title,
            _ => continue,
        };
        if matches_rule(field_value, &rule.op, &rule.value) {
            return true;
        }
    }

    false
}

/// Evaluates a single exclusion condition (mirrors `rules::match_condition`).
fn matches_rule(field: &str, op: &str, pattern: &str) -> bool {
    match op {
        "equals" => field.eq_ignore_ascii_case(pattern),
        "contains" => field.to_lowercase().contains(&pattern.to_lowercase()),
        "starts_with" => field
            .to_lowercase()
            .starts_with(&pattern.to_lowercase()),
        "regex" => {
            // Limit pattern length to prevent ReDoS from user-supplied regexes.
            if pattern.len() > 500 {
                return false;
            }
            Regex::new(pattern).map(|re| re.is_match(field)).unwrap_or(false)
        }
        _ => false,
    }
}

/// Loads active exclusion rules from the `exclusion_rules` table.
/// Returns an empty list on any error so tracking degrades safely.
pub fn load_exclusion_rules(conn: &rusqlite::Connection) -> Vec<ExclusionRule> {
    let mut stmt = match conn
        .prepare("SELECT field, op, value FROM exclusion_rules WHERE is_active = 1")
    {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([], |row| {
        Ok(ExclusionRule {
            field: row.get(0)?,
            op: row.get(1)?,
            value: row.get(2)?,
        })
    });

    match rows {
        Ok(iter) => iter.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(SCHEMA).expect("create schema");
        conn
    }

    fn rule(field: &str, op: &str, value: &str) -> ExclusionRule {
        ExclusionRule {
            field: field.to_string(),
            op: op.to_string(),
            value: value.to_string(),
        }
    }

    #[test]
    fn incognito_detected_across_browsers() {
        assert!(is_incognito_window("Some page - Google Chrome (Incognito)"));
        assert!(is_incognito_window("Bank [InPrivate] - Microsoft Edge"));
        assert!(is_incognito_window("Search — Mozilla Firefox Private Browsing"));
        assert!(is_incognito_window("Søgning — Firefox Privat browsing"));
    }

    #[test]
    fn non_incognito_not_flagged() {
        assert!(!is_incognito_window("GitHub - Google Chrome"));
        assert!(!is_incognito_window("main.rs — timetrack-desktop"));
        assert!(!is_incognito_window(""));
    }

    #[test]
    fn lock_screen_is_always_excluded() {
        // Lock/login screens are never work — excluded regardless of settings.
        assert!(should_exclude("LockApp", "", &[], false));
        assert!(should_exclude("lockapp", "Windows Default Lock Screen", &[], false));
        assert!(should_exclude("LogonUI", "", &[], false));
        assert!(should_exclude("loginwindow", "", &[], false)); // macOS
        // Real work is not excluded.
        assert!(!should_exclude("warp", "zsh", &[], false));
        assert!(!should_exclude("Code", "main.rs", &[], false));
    }

    #[test]
    fn should_exclude_respects_incognito_toggle() {
        let title = "X - Chrome (Incognito)";
        assert!(should_exclude("chrome", title, &[], true));
        // Toggle off => incognito is tracked normally.
        assert!(!should_exclude("chrome", title, &[], false));
    }

    #[test]
    fn user_rule_contains_on_title() {
        let rules = vec![rule("window_title", "contains", "secret project")];
        assert!(should_exclude("code", "Secret Project - VS Code", &rules, false));
        assert!(!should_exclude("code", "Public Project - VS Code", &rules, false));
    }

    #[test]
    fn user_rule_equals_on_app() {
        let rules = vec![rule("app_name", "equals", "KeePass")];
        assert!(should_exclude("keepass", "anything", &rules, false));
        assert!(!should_exclude("chrome", "anything", &rules, false));
    }

    #[test]
    fn user_rule_regex_and_starts_with() {
        let regex_rules = vec![rule("window_title", "regex", r"^Private:")];
        assert!(should_exclude("app", "Private: notes", &regex_rules, false));

        let sw_rules = vec![rule("app_name", "starts_with", "Sign")];
        assert!(should_exclude("Signal", "chat", &sw_rules, false));
    }

    #[test]
    fn invalid_regex_does_not_match_or_panic() {
        let rules = vec![rule("window_title", "regex", "[unclosed")];
        assert!(!should_exclude("app", "anything", &rules, false));
    }

    #[test]
    fn unknown_field_or_op_is_ignored() {
        let bad_field = vec![rule("url", "contains", "x")];
        assert!(!should_exclude("app", "x", &bad_field, false));
        let bad_op = vec![rule("app_name", "matches", "app")];
        assert!(!should_exclude("app", "x", &bad_op, false));
    }

    #[test]
    fn no_rules_no_incognito_keeps_activity() {
        assert!(!should_exclude("code", "main.rs", &[], true));
    }

    #[test]
    fn load_returns_only_active_rules() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO exclusion_rules (field, op, value) VALUES ('window_title','contains','secret')",
            [],
        )
        .expect("insert active");
        conn.execute(
            "INSERT INTO exclusion_rules (field, op, value, is_active) VALUES ('app_name','equals','foo',0)",
            [],
        )
        .expect("insert inactive");

        let rules = load_exclusion_rules(&conn);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].field, "window_title");
        assert!(should_exclude("code", "my secret thing", &rules, false));
    }

    #[test]
    fn load_empty_when_no_rules() {
        let conn = setup_db();
        assert!(load_exclusion_rules(&conn).is_empty());
    }
}
