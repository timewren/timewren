//! Privatliv: afgør om et forgrundsvindue skal udelades helt (gemmes aldrig).
//! Tre lag:
//!   1. Lås- og login-skærme udelades altid.
//!   2. Indbygget heuristik for private/inkognito-vinduer (titelmarkører).
//!   3. Brugerens regler (app, titel eller URL; equals|contains|starts_with|regex).

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Markører (små bogstaver) for private browservinduer på tværs af browsere
/// og sprog (en/da/de/sv/nb). Matches som understreng i den normaliserede
/// titel ([`normalize_for_markers`]). Markørerne er bevidst specifikke:
/// "privat" alene ville ramme "Privat regnskab.xlsx".
const INCOGNITO_MARKERS: &[&str] = &[
    // Chrome, Brave, Opera, Vivaldi og Arc (Windows skriver markøren i titlen).
    "incognito", // en
    "inkognito", // da, de, sv, nb
    // Edge hedder InPrivate på alle sprog.
    "inprivate",
    // Diverse.
    "(private)",
    "(privat)",
    "[private]",
    "[privat]",
];

/// Markører, der også er almindelige ord i en sidetitel ("Hvad er en privat
/// browser?"). De tæller kun, når de står sidst i titlen, som browserne sætter
/// dem (efter evt. afsluttende parentes).
const SUFFIX_MARKERS: &[&str] = &[
    "private window",    // Brave, Opera (en)
    // Firefox og varianter (Zen, LibreWolf, Waterfox).
    "private browsing",  // en
    "privat browsing",   // da
    "privater modus",    // de
    "privat surfning",   // sv
    "privat nettlesing", // nb
    // Safari.
    "privat browser",    // da: AX-titlen ", privat browser" (macOS 26, set på en rigtig Mac)
    "privates surfen",   // de, ikke set på en rigtig Mac
    "privates fenster",  // de
    "privat surfing",    // nb, ikke set på en rigtig Mac
    "privat fönster",    // sv
    "privat vindue",     // da
    "privat vindu",      // nb
];

/// Systemprocesser, der aldrig er arbejde: mens maskinen er låst, er låse-
/// eller login-skærmen forgrundsvinduet. Bekræftet på rigtige data: Windows'
/// låseskærm alene stod for timevis af fantom-aktivitet i 0.2.
const SYSTEM_NEVER_TRACK_APPS: &[&str] = &[
    "lockapp",           // Windows-låseskærm
    "logonui",           // Windows login/lås
    "loginwindow",       // macOS lås/login
    "screensaverengine", // macOS pauseskærm
];

/// Sand hvis appen er en låse- eller login-skærm.
pub fn is_system_never_track(app_name: &str) -> bool {
    let lower = app_name.trim().to_lowercase();
    SYSTEM_NEVER_TRACK_APPS
        .iter()
        .any(|a| lower == *a || lower.starts_with(a))
}

pub const FIELD_APP: &str = "app_name";
pub const FIELD_TITLE: &str = "window_title";
pub const FIELD_URL: &str = "url";

pub const VALID_FIELDS: &[&str] = &[FIELD_APP, FIELD_TITLE, FIELD_URL];
pub const VALID_OPS: &[&str] = &["equals", "contains", "starts_with", "regex"];

/// Én brugerregel. Strengbaseret som i 0.2, så lagring er enkel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExclusionRule {
    /// "app_name" | "window_title" | "url"
    pub field: String,
    /// "equals" | "contains" | "starts_with" | "regex"
    pub op: String,
    pub value: String,
}

impl ExclusionRule {
    pub fn new(field: &str, op: &str, value: &str) -> Self {
        Self {
            field: field.to_string(),
            op: op.to_string(),
            value: value.to_string(),
        }
    }
}

/// Validerer en regel, før den gemmes. Fejltekst på dansk til UI'et.
pub fn validate_rule(field: &str, op: &str, value: &str) -> Result<(), String> {
    if !VALID_FIELDS.contains(&field) {
        return Err(format!("Ugyldigt felt: {field}"));
    }
    if !VALID_OPS.contains(&op) {
        return Err(format!("Ugyldig operator: {op}"));
    }
    if value.trim().is_empty() {
        return Err("Værdi må ikke være tom".to_string());
    }
    if op == "regex" {
        if value.len() > MAX_REGEX_LEN {
            return Err("Det regulære udtryk er for langt".to_string());
        }
        if Regex::new(value).is_err() {
            return Err("Ugyldigt regulært udtryk".to_string());
        }
    }
    Ok(())
}

/// Sand hvis titlen ligner et privat/inkognito-browservindue.
pub fn is_incognito_window(window_title: &str) -> bool {
    let norm = normalize_for_markers(window_title);
    if INCOGNITO_MARKERS.iter().any(|m| norm.contains(m)) {
        return true;
    }
    let end = norm.trim_end_matches([')', ']', '.', ' ']);
    SUFFIX_MARKERS.iter().any(|m| end.ends_with(m))
}

/// Sand hvis en af vinduets øvrige tilgængelighedstekster (macOS: AXIdentifier,
/// AXDescription, AXSubrole) nævner et privat vindue.
pub fn hints_say_private<S: AsRef<str>>(hints: &[S]) -> bool {
    hints.iter().any(|h| is_incognito_window(h.as_ref()))
}

/// Små bogstaver, med alle slags mellemrum (også ikke-brydende og usynlige)
/// samlet til ét mellemrum, så "Privat\u{a0}browser" rammer markøren.
fn normalize_for_markers(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_space = false;
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_whitespace() || matches!(c, '\u{200b}' | '\u{200e}' | '\u{200f}' | '\u{feff}') {
            if !last_space && !out.is_empty() {
                out.push(' ');
            }
            last_space = true;
        } else {
            out.push(c);
            last_space = false;
        }
    }
    out
}

/// Skal vinduet udelades? `true` betyder: gem det IKKE.
///
/// Køres på den RÅ titel, så private markører, som normaliseringen kunne
/// fjerne, stadig ses. URL-regler køres igen, når URL'en er kendt.
pub fn should_exclude(
    app_name: &str,
    window_title: &str,
    url: Option<&str>,
    rules: &[ExclusionRule],
    exclude_incognito: bool,
) -> bool {
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
            FIELD_URL => match url {
                Some(u) => u,
                None => continue,
            },
            _ => continue,
        };
        if matches_rule(field_value, &rule.op, &rule.value) {
            return true;
        }
    }
    false
}

/// Grænse for brugerens regex (ReDoS-værn).
const MAX_REGEX_LEN: usize = 500;

fn matches_rule(field: &str, op: &str, pattern: &str) -> bool {
    match op {
        "equals" => field.to_lowercase() == pattern.to_lowercase(),
        "contains" => field.to_lowercase().contains(&pattern.to_lowercase()),
        "starts_with" => field.to_lowercase().starts_with(&pattern.to_lowercase()),
        "regex" => {
            if pattern.len() > MAX_REGEX_LEN {
                return false;
            }
            Regex::new(pattern)
                .map(|re| re.is_match(field))
                .unwrap_or(false)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(field: &str, op: &str, value: &str) -> ExclusionRule {
        ExclusionRule::new(field, op, value)
    }

    #[test]
    fn incognito_detected_across_browsers() {
        assert!(is_incognito_window("Some page - Google Chrome (Incognito)"));
        assert!(is_incognito_window("Bank [InPrivate] - Microsoft Edge"));
        assert!(is_incognito_window(
            "Search — Mozilla Firefox Private Browsing"
        ));
        assert!(is_incognito_window("Søgning — Firefox Privat browsing"));
        assert!(is_incognito_window("Side - Google Chrome (Inkognito)"));
    }

    #[test]
    fn safari_privat_vindue_paa_dansk_macos() {
        // AX-titlen på et privat Safari-vindue på macOS 26 med dansk sprog
        // (set på en rigtig Mac 27/10-2026).
        assert!(is_incognito_window("Example Domain, privat browser"));
        assert!(!is_incognito_window("Example Domain"));
    }

    /// Titler som browserne sætter dem (Windows-titler og macOS AX-titler),
    /// pr. browser og sprog (en, da, de, sv, nb).
    const PRIVATE_TITLES: &[(&str, &str)] = &[
        ("chrome en", "Example - Google Chrome (Incognito)"),
        ("chrome da/de/sv/nb", "Example - Google Chrome (Inkognito)"),
        ("brave en", "Example - Brave (Private)"),
        ("brave da", "Example - Brave (Privat)"),
        ("brave window", "Example - Brave Private Window"),
        ("edge en", "Example - [InPrivate] - Microsoft\u{200b} Edge"),
        ("edge da/sv/nb", "Example - InPrivate - Microsoft Edge"),
        ("edge de", "Example – InPrivate – Microsoft Edge"),
        ("firefox en", "Example — Mozilla Firefox Private Browsing"),
        ("firefox da", "Example — Mozilla Firefox (Privat browsing)"),
        ("firefox de", "Example — Mozilla Firefox (Privater Modus)"),
        ("firefox sv", "Example — Mozilla Firefox (Privat surfning)"),
        ("firefox nb", "Example — Mozilla Firefox (Privat nettlesing)"),
        ("safari en", "Example Domain, Private Browsing"),
        ("safari da", "Example Domain, privat browser"),
        ("safari da nbsp", "Example Domain, privat\u{a0}browser"),
        ("safari de", "Example Domain, Privates Fenster"),
        ("safari de surfen", "Example Domain, Privates Surfen"),
        ("safari sv", "Example Domain, Privat surfning"),
        ("safari nb", "Example Domain, Privat surfing"),
        ("arc", "Example – Arc Incognito"),
        ("opera", "Example - Opera (Private)"),
        ("vivaldi", "Example - Vivaldi [Private]"),
        ("store bogstaver", "EXAMPLE - GOOGLE CHROME (INKOGNITO)"),
    ];

    #[test]
    fn private_vinduer_genkendes_pr_browser_og_sprog() {
        for (navn, titel) in PRIVATE_TITLES {
            assert!(is_incognito_window(titel), "{navn}: {titel}");
            assert!(should_exclude("browser", titel, None, &[], true), "{navn}");
            assert!(
                !should_exclude("browser", titel, None, &[], false),
                "{navn}: sporing slået til"
            );
        }
    }

    #[test]
    fn almindelige_titler_er_ikke_private() {
        for titel in [
            "Privat regnskab.xlsx - Excel",
            "Private repo settings - GitHub - Google Chrome",
            "Privatlivspolitik - Safari",
            "Datenschutz und privater Bereich - Firefox",
            "Inkomst 2026 - Brave",
            "Edge cases in parsing - Mozilla Firefox",
            "Hvad er en privat browser? - Google Søgning - Google Chrome",
            "Private browsing explained - Wikipedia - Mozilla Firefox",
            "Sådan åbner du et privat vindue i Chrome - Safari",
            "Example Domain",
        ] {
            assert!(!is_incognito_window(titel), "{titel}");
        }
    }

    #[test]
    fn ax_tekster_kan_afsloere_et_privat_vindue() {
        assert!(hints_say_private(&["", "Incognito window"]));
        assert!(!hints_say_private(&["AXStandardWindow"]));
        assert!(!hints_say_private::<&str>(&[]));
    }

    #[test]
    fn non_incognito_not_flagged() {
        assert!(!is_incognito_window("GitHub - Google Chrome"));
        assert!(!is_incognito_window("main.rs — timetrack-desktop"));
        assert!(!is_incognito_window(""));
    }

    #[test]
    fn lock_screen_is_always_excluded() {
        assert!(should_exclude("LockApp", "", None, &[], false));
        assert!(should_exclude(
            "lockapp",
            "Windows Default Lock Screen",
            None,
            &[],
            false
        ));
        assert!(should_exclude("LogonUI", "", None, &[], false));
        assert!(should_exclude("loginwindow", "", None, &[], false));
        assert!(should_exclude("ScreenSaverEngine", "", None, &[], false));
        assert!(!should_exclude("warp", "zsh", None, &[], false));
        assert!(!should_exclude("Code", "main.rs", None, &[], false));
    }

    #[test]
    fn should_exclude_respects_incognito_toggle() {
        let title = "X - Chrome (Incognito)";
        assert!(should_exclude("chrome", title, None, &[], true));
        assert!(!should_exclude("chrome", title, None, &[], false));
    }

    #[test]
    fn user_rule_contains_on_title() {
        let rules = vec![rule("window_title", "contains", "secret project")];
        assert!(should_exclude(
            "code",
            "Secret Project - VS Code",
            None,
            &rules,
            false
        ));
        assert!(!should_exclude(
            "code",
            "Public Project - VS Code",
            None,
            &rules,
            false
        ));
    }

    #[test]
    fn user_rule_equals_on_app_handles_non_ascii_case() {
        let rules = vec![rule("app_name", "equals", "KeePass")];
        assert!(should_exclude("keepass", "anything", None, &rules, false));
        assert!(!should_exclude("chrome", "anything", None, &rules, false));
        let rules = vec![rule("app_name", "equals", "ØKONOMI")];
        assert!(should_exclude("økonomi", "x", None, &rules, false));
    }

    #[test]
    fn user_rule_regex_and_starts_with() {
        let regex_rules = vec![rule("window_title", "regex", r"^Private:")];
        assert!(should_exclude(
            "app",
            "Private: notes",
            None,
            &regex_rules,
            false
        ));
        let sw_rules = vec![rule("app_name", "starts_with", "Sign")];
        assert!(should_exclude("Signal", "chat", None, &sw_rules, false));
    }

    #[test]
    fn url_rule_applies_only_when_url_known() {
        let rules = vec![rule("url", "contains", "netbank.dk")];
        assert!(should_exclude(
            "Safari",
            "Bank",
            Some("https://www.netbank.dk/x"),
            &rules,
            false
        ));
        assert!(!should_exclude("Safari", "Bank", None, &rules, false));
        assert!(!should_exclude(
            "Safari",
            "Bank",
            Some("https://a.dk/"),
            &rules,
            false
        ));
    }

    #[test]
    fn invalid_regex_does_not_match_or_panic() {
        let rules = vec![rule("window_title", "regex", "[unclosed")];
        assert!(!should_exclude("app", "anything", None, &rules, false));
    }

    #[test]
    fn unknown_field_or_op_is_ignored() {
        let bad_field = vec![rule("document", "contains", "x")];
        assert!(!should_exclude("app", "x", None, &bad_field, false));
        let bad_op = vec![rule("app_name", "matches", "app")];
        assert!(!should_exclude("app", "x", None, &bad_op, false));
    }

    #[test]
    fn no_rules_no_incognito_keeps_activity() {
        assert!(!should_exclude("code", "main.rs", None, &[], true));
    }

    #[test]
    fn validate_rule_rejects_bad_input() {
        assert!(validate_rule("app_name", "contains", "x").is_ok());
        assert!(validate_rule("url", "regex", r"^https://bank").is_ok());
        assert_eq!(
            validate_rule("foo", "contains", "x"),
            Err("Ugyldigt felt: foo".into())
        );
        assert_eq!(
            validate_rule("app_name", "like", "x"),
            Err("Ugyldig operator: like".into())
        );
        assert_eq!(
            validate_rule("app_name", "contains", "  "),
            Err("Værdi må ikke være tom".into())
        );
        assert!(validate_rule("window_title", "regex", "[").is_err());
        assert!(validate_rule("window_title", "regex", &"a".repeat(501)).is_err());
    }
}
