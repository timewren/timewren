//! Window-title normalization.
//!
//! Raw window titles carry transient decorations that change without the
//! underlying work changing: unsaved-markers (`● fil.rs`), notification
//! counters (`(3) Indbakke`), and the app's own name as a suffix
//! (`… - Google Chrome`). Every such change splits a tracking segment, and
//! the resulting 2-5s fragments are dropped under `min_activity_duration` —
//! shredding the day and losing time. Normalizing once at capture gives
//! stable segment identity, cleaner history matching, and cheaper AI
//! grouping.

/// App-name suffixes that browsers/apps append to their window titles,
/// matched case-insensitively after a ` - `/` — `/` – ` separator.
const APP_TITLE_SUFFIXES: &[&str] = &[
    // Browsers
    "google chrome",
    "microsoft\u{200b} edge", // Edge sometimes embeds a zero-width space
    "microsoft edge",
    "mozilla firefox",
    "firefox",
    "brave",
    "opera",
    "vivaldi",
    "safari",
    // Office
    "microsoft word",
    "microsoft excel",
    "microsoft powerpoint",
    "word",
    "excel",
    "powerpoint",
    "microsoft outlook",
    "outlook",
    // Kommunikation & design
    "microsoft teams",
    "slack",
    "discord",
    "figma",
    "obsidian",
    "notion",
];

/// Separators that precede an app-name suffix in a window title.
const TITLE_SEPARATORS: &[&str] = &[" - ", " \u{2014} ", " \u{2013} ", " | "];

/// Normalizes a window title for segment identity, storage and grouping.
///
/// - trims and collapses whitespace
/// - strips leading unsaved markers (`●`, `*`, `•`)
/// - strips leading notification counters like `(3) ` / `(12+) `
/// - strips trailing app-name suffixes (`… - Google Chrome`, `… | Microsoft
///   Teams`), including when the suffix matches the capturing app's own name
///
/// The result is never empty: if stripping removes everything, the trimmed
/// raw title is returned instead.
pub fn normalize_title(app_name: &str, raw: &str) -> String {
    let trimmed = raw.trim();
    let mut s = trimmed.to_string();

    // Leading unsaved markers, possibly repeated ("● ● fil.rs" seen in the wild).
    loop {
        let stripped = s
            .trim_start_matches(['\u{25cf}', '*', '\u{2022}'])
            .trim_start();
        if stripped.len() == s.len() {
            break;
        }
        s = stripped.to_string();
    }

    // Leading notification counter: "(3) " / "(12+) ".
    if let Some(rest) = strip_notification_counter(&s) {
        s = rest;
    }

    // Trailing app-name suffix — repeat so "Side - Profil 1 - Google Chrome"
    // style double suffixes collapse too, but only while a known suffix matches.
    let app_lower = app_name.trim().to_lowercase();
    while let Some(shorter) = strip_app_suffix(&s, &app_lower) {
        s = shorter;
    }

    // Collapse internal whitespace runs.
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");

    if s.is_empty() {
        trimmed.to_string()
    } else {
        s
    }
}

/// Strips a leading "(N) " / "(N+) " notification counter, returning the rest.
fn strip_notification_counter(s: &str) -> Option<String> {
    let rest = s.strip_prefix('(')?;
    let close = rest.find(')')?;
    let inner = &rest[..close];
    if inner.is_empty() || inner.len() > 5 {
        return None;
    }
    let digits = inner.strip_suffix('+').unwrap_or(inner);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let after = rest[close + 1..].trim_start();
    if after.is_empty() {
        return None;
    }
    Some(after.to_string())
}

/// Strips ONE trailing app-suffix segment (`… - Google Chrome`), if the last
/// separator-delimited segment matches a known app suffix or the app's own
/// name. Returns `None` when nothing was stripped.
fn strip_app_suffix(s: &str, app_lower: &str) -> Option<String> {
    for sep in TITLE_SEPARATORS {
        if let Some(idx) = s.rfind(sep) {
            let (head, tail) = s.split_at(idx);
            let tail = tail[sep.len()..].trim();
            let tail_lower = tail.to_lowercase();
            let matches_known = APP_TITLE_SUFFIXES.contains(&tail_lower.as_str());
            // The capturing app's own name ("chrome" in "Google Chrome").
            let matches_app = !app_lower.is_empty()
                && (tail_lower == app_lower || tail_lower.contains(app_lower));
            if (matches_known || matches_app) && !head.trim().is_empty() {
                return Some(head.trim_end().to_string());
            }
        }
    }
    None
}

/// Office document extensions stripped from Word/Excel/PowerPoint titles so the
/// document name — not its file format — becomes the stable context signal.
const OFFICE_EXTENSIONS: &[&str] = &[
    ".docx", ".doc", ".xlsx", ".xls", ".xlsm", ".pptx", ".ppt", ".csv",
];

/// Image extensions stripped from Photoshop titles for the same reason.
const IMAGE_EXTENSIONS: &[&str] =
    &[".psd", ".psb", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".gif", ".webp"];

/// A recognized app family whose window title names the artefact being worked
/// on (document / design / page / API collection) rather than a project folder.
/// For these the tracker derives a normalized project-context fragment and
/// feeds it in via `context_path` — the same signal terminals use — so history
/// matching and the AI prompt get a stronger cue than the raw title.
#[cfg_attr(test, derive(Debug, PartialEq))]
pub(crate) enum AppFamily {
    Figma,
    Office,
    Notion,
    Obsidian,
    Photoshop,
    Postman,
}

/// True if `needle` (ASCII) appears in `haystack` as a whole word — bounded on
/// both sides by a non-alphanumeric byte or a string end. Prevents a short,
/// generic name like "word" from matching inside "1password" (a privacy leak,
/// since a misclassified app's title is fed to the AI prompt).
fn contains_word(haystack: &str, needle: &str) -> bool {
    let bytes = haystack.as_bytes();
    let nlen = needle.len();
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(needle) {
        let i = start + pos;
        let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        let after = i + nlen;
        let after_ok = after >= bytes.len() || !bytes[after].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        start = i + 1;
    }
    false
}

/// Maps an executable name to its app family, or `None` for unrecognized apps
/// (which fall back to app+title unchanged). Browsers are deliberately absent —
/// they are multi-project and handled by the opt-in address-bar URL capture.
pub(crate) fn app_family(app_lower: &str) -> Option<AppFamily> {
    if app_lower.contains("figma") {
        Some(AppFamily::Figma)
    } else if app_lower.contains("winword")
        || app_lower.contains("powerpnt")
        // Whole-word matches so short names ("word", "excel") don't match
        // INSIDE unrelated apps — e.g. "1password" must never be read as Office
        // and have its window title routed into the AI prompt. Covers both the
        // macOS owner names ("Microsoft Word") and a bare "word".
        || contains_word(app_lower, "word")
        || contains_word(app_lower, "excel")
        || contains_word(app_lower, "powerpoint")
    {
        Some(AppFamily::Office)
    } else if app_lower.contains("notion") {
        Some(AppFamily::Notion)
    } else if app_lower.contains("obsidian") {
        Some(AppFamily::Obsidian)
    } else if app_lower.contains("photoshop") {
        Some(AppFamily::Photoshop)
    } else if app_lower.contains("postman") {
        Some(AppFamily::Postman)
    } else {
        None
    }
}

/// Derives a normalized project-context fragment from an app-family window
/// title (which has already passed [`normalize_title`]). Returns `None` for
/// unrecognized apps or when no meaningful fragment can be extracted, so the
/// caller keeps the raw app+title unchanged (never a panic, never an empty
/// context that would overwrite a real one).
///
/// The output is a stable, label-prefixed fragment (e.g. `"Figma: Kunde A —
/// Landingpage"`). Because it is a pure function of the app name and the
/// already-normalized title, it never introduces new segment splits. Sensitive
/// query strings (API tokens in Postman endpoints) are stripped for privacy.
pub fn derive_app_context(app_name: &str, title: &str) -> Option<String> {
    let app_lower = app_name.trim().to_lowercase();
    let family = app_family(&app_lower)?;
    let (label, fragment) = match family {
        AppFamily::Figma => ("Figma", extract_figma(title)),
        AppFamily::Office => ("Dokument", extract_office(title)),
        AppFamily::Notion => ("Notion", extract_notion(title)),
        AppFamily::Obsidian => ("Obsidian", extract_obsidian(title)),
        AppFamily::Photoshop => ("Photoshop", extract_photoshop(title)),
        AppFamily::Postman => ("Postman", extract_postman(title)),
    };
    let fragment = collapse_ws(&fragment?);
    if fragment.is_empty() {
        return None;
    }
    Some(format!("{}: {}", label, fragment))
}

/// Collapses internal whitespace runs to single spaces and trims the ends.
fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Splits a title on the known title separators (` - `, ` — `, ` – `, ` | `),
/// trimming each part and dropping empties.
fn split_segments(s: &str) -> Vec<String> {
    let mut parts = vec![s.to_string()];
    for sep in TITLE_SEPARATORS {
        parts = parts
            .into_iter()
            .flat_map(|p| p.split(sep).map(str::to_string).collect::<Vec<_>>())
            .collect();
    }
    parts
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Strips a trailing `{separator}{word}` segment (case-insensitive) if present,
/// defending against a suffix that [`normalize_title`] did not remove.
fn strip_trailing_word(s: &str, word: &str) -> String {
    for sep in TITLE_SEPARATORS {
        if let Some(idx) = s.rfind(sep) {
            let tail = s[idx + sep.len()..].trim();
            if tail.eq_ignore_ascii_case(word) {
                return s[..idx].trim_end().to_string();
            }
        }
    }
    s.to_string()
}

/// Strips one trailing extension from `s` if it matches any in `exts`.
fn strip_ext(s: &str, exts: &[&str]) -> String {
    let lower = s.to_lowercase();
    for ext in exts {
        if lower.ends_with(ext) {
            return s[..s.len() - ext.len()].trim_end().to_string();
        }
    }
    s.to_string()
}

/// Removes a URL query string (`?token=…`) up to the next whitespace, so API
/// tokens in a Postman endpoint are never stored.
fn strip_query(s: &str) -> String {
    match s.find('?') {
        Some(q) => {
            let after = &s[q..];
            let end = after.find(char::is_whitespace).map(|i| q + i).unwrap_or(s.len());
            format!("{}{}", &s[..q], &s[end..])
        }
        None => s.to_string(),
    }
}

/// Figma: the title (after suffix strip) is the file/page name.
fn extract_figma(title: &str) -> Option<String> {
    let s = strip_trailing_word(title, "figma");
    let s = s.trim();
    if s.is_empty() || s.eq_ignore_ascii_case("figma") {
        None
    } else {
        Some(s.to_string())
    }
}

/// Word / Excel / PowerPoint: the document name is the first segment; strip the
/// file extension so `Tilbud.docx` and a later-renamed `Tilbud.doc` match.
fn extract_office(title: &str) -> Option<String> {
    let first = split_segments(title).into_iter().next()?;
    let name = strip_ext(&first, OFFICE_EXTENSIONS);
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Notion: the title (after suffix strip) is the page path.
fn extract_notion(title: &str) -> Option<String> {
    let s = strip_trailing_word(title, "notion");
    let s = s.trim();
    if s.is_empty() || s.eq_ignore_ascii_case("notion") {
        None
    } else {
        Some(s.to_string())
    }
}

/// Obsidian: title is `Note - Vault - Obsidian vX`. The versioned suffix
/// survives [`normalize_title`], so drop it here, then keep note (+ vault).
fn extract_obsidian(title: &str) -> Option<String> {
    let mut segs = split_segments(title);
    if segs
        .last()
        .is_some_and(|s| s.to_lowercase().starts_with("obsidian"))
    {
        segs.pop();
    }
    let note = segs.first()?.clone();
    if note.is_empty() {
        return None;
    }
    if segs.len() >= 2 {
        // `segs` har lige nu mindst to elementer, så `last` kan ikke være
        // `None`. Skriver vi det med `?` i stedet for `unwrap()`, kan vi ikke
        // få et `panic` i title-teksten — og hele funktionen beholder sin
        // `Option`-signatur, så kald slipper den bare videre.
        Some(format!("{} ({})", note, segs.last()?))
    } else {
        Some(note)
    }
}

/// Photoshop: title is `file.psd @ 200% (RGB/8) - Adobe Photoshop 2024`. Keep
/// the filename, dropping the zoom/color-mode noise and the app-name segment.
fn extract_photoshop(title: &str) -> Option<String> {
    let head = split_segments(title).into_iter().next()?;
    if head.to_lowercase().contains("photoshop") {
        return None;
    }
    let name = match head.split_once(" @ ") {
        Some((before, _)) => before.trim().to_string(),
        None => head,
    };
    let name = strip_ext(&name, IMAGE_EXTENSIONS);
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Postman: title is `GET /endpoint?token=… - Collection - Postman`. Drop the
/// app-name segment and any query string (privacy), keep method + endpoint +
/// collection.
fn extract_postman(title: &str) -> Option<String> {
    let kept: Vec<String> = split_segments(title)
        .into_iter()
        .filter(|s| !s.eq_ignore_ascii_case("postman"))
        .collect();
    if kept.is_empty() {
        return None;
    }
    let stripped = strip_query(&kept.join(" - "));
    let stripped = stripped.trim();
    if stripped.is_empty() {
        None
    } else {
        Some(stripped.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_collapses_whitespace() {
        assert_eq!(normalize_title("code", "  main.rs   —  projekt  "), "main.rs — projekt");
    }

    #[test]
    fn strips_unsaved_markers() {
        assert_eq!(normalize_title("code", "● main.rs - projekt"), "main.rs - projekt");
        assert_eq!(normalize_title("code", "* udkast.md"), "udkast.md");
        assert_eq!(normalize_title("code", "● ● dobbelt.rs"), "dobbelt.rs");
    }

    #[test]
    fn strips_notification_counters() {
        assert_eq!(
            normalize_title("chrome", "(2) Indbakke - Gmail"),
            "Indbakke - Gmail"
        );
        assert_eq!(normalize_title("slack", "(12+) Slack"), "Slack");
    }

    #[test]
    fn keeps_parenthesized_non_counters() {
        assert_eq!(
            normalize_title("code", "(WIP) refaktor - projekt"),
            "(WIP) refaktor - projekt"
        );
    }

    #[test]
    fn strips_browser_suffix() {
        assert_eq!(
            normalize_title("chrome", "Kundens side - Google Chrome"),
            "Kundens side"
        );
        assert_eq!(
            normalize_title("msedge", "Dokumentation \u{2014} Microsoft Edge"),
            "Dokumentation"
        );
        assert_eq!(
            normalize_title("firefox", "Forside \u{2013} Mozilla Firefox"),
            "Forside"
        );
    }

    #[test]
    fn strips_office_and_comm_suffixes() {
        assert_eq!(normalize_title("winword", "Tilbud.docx - Word"), "Tilbud.docx");
        assert_eq!(
            normalize_title("teams", "Statusmøde | Microsoft Teams"),
            "Statusmøde"
        );
        assert_eq!(normalize_title("figma", "Design v2 \u{2013} Figma"), "Design v2");
    }

    #[test]
    fn strips_suffix_matching_app_name() {
        assert_eq!(
            normalize_title("orca", "timetrack-desktop - Orca"),
            "timetrack-desktop"
        );
    }

    #[test]
    fn strips_double_suffix() {
        assert_eq!(
            normalize_title("chrome", "(1) Side - Profil - Google Chrome"),
            "Side - Profil"
        );
    }

    #[test]
    fn never_returns_empty() {
        assert_eq!(normalize_title("chrome", "Google Chrome"), "Google Chrome");
        assert_eq!(normalize_title("code", "   "), "");
        // A title that is ONLY a counter stays untouched
        assert_eq!(normalize_title("slack", "(3)"), "(3)");
    }

    #[test]
    fn strips_editor_own_name_suffix() {
        assert_eq!(
            normalize_title("code", "main.rs - timetrack - Visual Studio Code"),
            "main.rs - timetrack"
        );
    }

    #[test]
    fn plain_titles_untouched() {
        assert_eq!(normalize_title("notepad", "noter.txt"), "noter.txt");
        assert_eq!(
            normalize_title("chrome", "Faktura - kunde.dk"),
            "Faktura - kunde.dk"
        );
    }

    // -----------------------------------------------------------------------
    // derive_app_context — per app-family extraction
    // -----------------------------------------------------------------------

    #[test]
    fn app_context_figma_file_fragment() {
        // Title arrives already suffix-stripped (" – Figma" removed by normalize).
        assert_eq!(
            derive_app_context("Figma", "Kunde A — Landingpage"),
            Some("Figma: Kunde A — Landingpage".to_string())
        );
        // Defensive: a still-attached suffix is stripped too.
        assert_eq!(
            derive_app_context("figma", "Nyt design \u{2013} Figma"),
            Some("Figma: Nyt design".to_string())
        );
    }

    #[test]
    fn app_context_office_document_name() {
        assert_eq!(
            derive_app_context("WINWORD", "Tilbud til Kunde ApS.docx"),
            Some("Dokument: Tilbud til Kunde ApS".to_string())
        );
        assert_eq!(
            derive_app_context("EXCEL", "Budget 2026.xlsx"),
            Some("Dokument: Budget 2026".to_string())
        );
        assert_eq!(
            derive_app_context("POWERPNT", "Pitch.pptx"),
            Some("Dokument: Pitch".to_string())
        );
    }

    #[test]
    fn office_matches_macos_owner_names_but_not_1password() {
        // macOS reports the owner name ("Microsoft Word"), not an exe stem.
        assert_eq!(app_family("microsoft word"), Some(AppFamily::Office));
        assert_eq!(app_family("microsoft excel"), Some(AppFamily::Office));
        assert_eq!(app_family("microsoft powerpoint"), Some(AppFamily::Office));
        // Privacy regression: a password manager must NEVER be read as Office —
        // that would route its window title into the AI prompt.
        assert_eq!(app_family("1password"), None);
        assert_eq!(app_family("1password 7"), None);
        // A password manager title must fall back to app+title (no context).
        assert_eq!(derive_app_context("1Password", "Bank login — vault"), None);
        // "excellent"-style names must not trip the Excel match.
        assert_eq!(app_family("excellent-tool"), None);
    }

    #[test]
    fn app_context_notion_page() {
        assert_eq!(
            derive_app_context("Notion", "Kunde X / Sprint 3"),
            Some("Notion: Kunde X / Sprint 3".to_string())
        );
    }

    #[test]
    fn app_context_obsidian_note_and_vault() {
        // Obsidian keeps a versioned suffix that normalize_title cannot strip.
        assert_eq!(
            derive_app_context("Obsidian", "Møde-noter - Kunde Vault - Obsidian v1.4.16"),
            Some("Obsidian: Møde-noter (Kunde Vault)".to_string())
        );
        // Single segment → note only, no vault parenthesis.
        assert_eq!(
            derive_app_context("obsidian", "Løs note - Obsidian v1.5.0"),
            Some("Obsidian: Løs note".to_string())
        );
    }

    #[test]
    fn app_context_photoshop_strips_zoom_and_colormode_noise() {
        assert_eq!(
            derive_app_context(
                "Photoshop",
                "kunde-logo.psd @ 200% (RGB/8) - Adobe Photoshop 2024"
            ),
            Some("Photoshop: kunde-logo".to_string())
        );
        assert_eq!(
            derive_app_context(
                "photoshop",
                "banner.psb @ 66,7% (RGB/8#) - Adobe Photoshop 2024"
            ),
            Some("Photoshop: banner".to_string())
        );
    }

    #[test]
    fn app_context_postman_strips_query_params() {
        // Privacy: the query string (tokens) must be dropped, endpoint kept.
        assert_eq!(
            derive_app_context(
                "Postman",
                "GET https://api.kunde.dk/users?token=abc123 - Kunde API - Postman"
            ),
            Some("Postman: GET https://api.kunde.dk/users - Kunde API".to_string())
        );
    }

    #[test]
    fn app_context_unknown_app_returns_none() {
        // Fallback: unknown apps yield no context so the caller keeps app+title.
        assert_eq!(derive_app_context("notepad", "noter.txt"), None);
        // Browsers are handled by URL capture, not app-family parsing.
        assert_eq!(derive_app_context("chrome", "Gmail"), None);
    }

    #[test]
    fn app_context_empty_fragment_returns_none() {
        // A title that is only the app's own name yields nothing usable.
        assert_eq!(derive_app_context("Postman", "Postman"), None);
        assert_eq!(derive_app_context("Figma", "Figma"), None);
        assert_eq!(derive_app_context("WINWORD", "   "), None);
    }
}
