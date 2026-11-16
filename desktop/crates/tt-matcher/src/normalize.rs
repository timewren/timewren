//! Normalisering af tekst og signaler.
//!
//! Tekstdelen er en port af udvidelsens `smartMatching.ts` (`normalizeText`,
//! `foldDanish`, `compactKeys`, `decodePunycodeLabel`). Resten er de kanoniske
//! former for repo-remote, sti, domæne og titel, som både matching og læring
//! sammenligner på.

/// Små bogstaver, kun bogstaver/tal/mellemrum, sammenklappede mellemrum.
/// Bevarer æøå (som udvidelsen efter rettelsen af "Bageriet p hjrnet").
pub fn normalize_text(text: &str) -> String {
    let composed = compose_ring(text);
    let mut out = String::with_capacity(composed.len());
    let mut last_space = true;
    for ch in composed.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            out.push(ch);
            last_space = false;
        } else if ch.is_whitespace() && !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.trim_end().to_string()
}

/// `a` + kombinerende ring (U+030A) → `å`. Den eneste dekomponerede form af
/// æøå, der findes i praksis (macOS-filnavne). `ø` og `æ` har ingen kanonisk
/// dekomponering.
fn compose_ring(text: &str) -> String {
    if !text.contains('\u{030A}') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch == '\u{030A}' {
            match out.pop() {
                Some('a') => out.push('å'),
                Some('A') => out.push('Å'),
                Some(prev) => out.push(prev),
                None => {}
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// Stavemåde for æøå uden de danske bogstaver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fold {
    /// æ→ae, ø→oe, å→aa ("hjoernet").
    Double,
    /// æ→a, ø→o, å→a ("hjornet").
    Single,
}

/// Erstatter æøå (små bogstaver) efter `variant`.
pub fn fold_danish(text: &str, variant: Fold) -> String {
    let mut out = String::with_capacity(text.len() + 4);
    for ch in text.chars() {
        match (ch, variant) {
            ('æ', Fold::Double) => out.push_str("ae"),
            ('ø', Fold::Double) => out.push_str("oe"),
            ('å', Fold::Double) => out.push_str("aa"),
            ('æ', Fold::Single) => out.push('a'),
            ('ø', Fold::Single) => out.push('o'),
            ('å', Fold::Single) => out.push('a'),
            _ => out.push(ch),
        }
    }
    out
}

/// Kompakte nøgler uden mellemrum i begge stavemåder (deduplikeret).
pub fn compact_keys(text: &str) -> Vec<String> {
    let compact: String = normalize_text(text)
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let mut keys = vec![fold_danish(&compact, Fold::Double)];
    let single = fold_danish(&compact, Fold::Single);
    if single != keys[0] {
        keys.push(single);
    }
    keys.retain(|k| !k.is_empty());
    keys
}

/// Afkoder én `xn--`-label (RFC 3492). Ugyldig input returneres uændret.
pub fn decode_punycode_label(label: &str) -> String {
    let lower = label.to_lowercase();
    let Some(input) = lower.strip_prefix("xn--") else {
        return label.to_string();
    };
    const BASE: u32 = 36;
    const T_MIN: u32 = 1;
    const T_MAX: u32 = 26;
    const SKEW: u32 = 38;
    const DAMP: u32 = 700;
    let bytes = input.as_bytes();
    let basic = input.rfind('-');
    let mut output: Vec<char> = match basic {
        Some(b) if b > 0 => input[..b].chars().collect(),
        _ => Vec::new(),
    };
    let adapt = |delta_in: u32, num_points: u32, first: bool| -> u32 {
        let mut delta = if first {
            delta_in / DAMP
        } else {
            delta_in >> 1
        };
        delta += delta / num_points;
        let mut k = 0;
        while delta > ((BASE - T_MIN) * T_MAX) >> 1 {
            delta /= BASE - T_MIN;
            k += BASE;
        }
        k + ((BASE - T_MIN + 1) * delta) / (delta + SKEW)
    };
    let digit = |b: u8| -> Option<u32> {
        match b {
            b'0'..=b'9' => Some(u32::from(b - b'0') + 26),
            b'a'..=b'z' => Some(u32::from(b - b'a')),
            _ => None,
        }
    };
    let mut n: u32 = 128;
    let mut bias: u32 = 72;
    let mut i: u32 = 0;
    let mut pos = match basic {
        Some(b) if b > 0 => b + 1,
        _ => 0,
    };
    while pos < bytes.len() {
        let old_i = i;
        let mut w: u32 = 1;
        let mut k = BASE;
        loop {
            let Some(&b) = bytes.get(pos) else {
                return label.to_string();
            };
            pos += 1;
            let Some(d) = digit(b) else {
                return label.to_string();
            };
            let Some(next) = d.checked_mul(w).and_then(|x| i.checked_add(x)) else {
                return label.to_string();
            };
            i = next;
            let t = if k <= bias {
                T_MIN
            } else if k >= bias + T_MAX {
                T_MAX
            } else {
                k - bias
            };
            if d < t {
                break;
            }
            let Some(next_w) = w.checked_mul(BASE - t) else {
                return label.to_string();
            };
            w = next_w;
            k += BASE;
        }
        let len = output.len() as u32 + 1;
        bias = adapt(i - old_i, len, old_i == 0);
        let Some(next_n) = n.checked_add(i / len) else {
            return label.to_string();
        };
        n = next_n;
        i %= len;
        let Some(ch) = char::from_u32(n) else {
            return label.to_string();
        };
        output.insert(i as usize, ch);
        i += 1;
    }
    output.into_iter().collect()
}

/// Afkoder alle `xn--`-labels i et domæne.
pub fn decode_domain(domain: &str) -> String {
    domain
        .split('.')
        .map(decode_punycode_label)
        .collect::<Vec<_>>()
        .join(".")
}

/// Host fra en URL eller et bart domæne: uden skema, login, sti, port og
/// `www.`, små bogstaver og punycode afkodet (så `hjørnet.dk` og
/// `xn--hjrnet-cya.dk` er samme site).
pub fn normalize_domain(url_or_host: &str) -> String {
    let s = url_or_host.trim().to_lowercase();
    let s = match s.find("://") {
        // Kun web-adresser har et domæne: chrome://newtab, file:// og
        // chrome-extension:// er ikke sites.
        Some(i) if matches!(&s[..i], "http" | "https") => &s[i + 3..],
        Some(_) => return String::new(),
        // about:blank, mailto:x, data:… (et skema uden //). En port som i
        // localhost:3000 er tal og tæller ikke som skema.
        None if s.split_once(':').is_some_and(|(scheme, rest)| {
            !scheme.contains('.')
                && !rest
                    .split('/')
                    .next()
                    .unwrap_or("")
                    .chars()
                    .all(|c| c.is_ascii_digit())
        }) =>
        {
            return String::new();
        }
        None => &s[..],
    };
    let authority = s.split(['/', '?', '#']).next().unwrap_or(s);
    let host = authority.rsplit('@').next().unwrap_or(authority);
    // IPv6: [::1]:3000 → [::1]
    let host = match host.strip_prefix('[') {
        Some(rest) => {
            return rest
                .split(']')
                .next()
                .map(|h| format!("[{h}]"))
                .unwrap_or_default();
        }
        None => host.split(':').next().unwrap_or(host),
    };
    let host = host.trim_end_matches('.');
    let host = host.strip_prefix("www.").unwrap_or(host);
    decode_domain(host)
}

/// Domænet for et segment: det angivne, ellers udledt af URL'en.
pub fn segment_host(domain: Option<&str>, url: Option<&str>) -> Option<String> {
    let raw = domain
        .filter(|d| !d.trim().is_empty())
        .or(url.filter(|u| !u.trim().is_empty()))?;
    let host = normalize_domain(raw);
    (!host.is_empty()).then_some(host)
}

/// True, når `host` er `domain` eller et underdomæne af det.
pub fn domain_matches(host: &str, domain: &str) -> bool {
    !domain.is_empty() && (host == domain || host.ends_with(&format!(".{domain}")))
}

/// Domænenavn uden kendte underdomæner og TLD: `app.acmecorp.com` → `acmecorp`.
/// Port af `extractDomainName`.
pub fn extract_domain_name(domain: &str) -> String {
    const COMMON: &[&str] = &[
        "www",
        "app",
        "portal",
        "admin",
        "dashboard",
        "dev",
        "staging",
        "test",
    ];
    let decoded = decode_domain(domain);
    let parts: Vec<&str> = decoded.split('.').collect();
    let mut relevant: Vec<&str> = parts
        .iter()
        .copied()
        .filter(|p| !COMMON.contains(&p.to_lowercase().as_str()))
        .collect();
    if relevant.is_empty() {
        relevant = parts;
    }
    if relevant.len() > 1 {
        relevant.pop();
    }
    relevant.concat()
}

/// Kanonisk repo-remote: `host/ejer/navn`, små bogstaver, uden skema, login,
/// port og `.git`.
///
/// `git@github.com:acme/Timetrack.git`, `https://github.com/acme/timetrack`
/// og `ssh://git@github.com:22/acme/timetrack.git` bliver alle til
/// `github.com/acme/timetrack`.
pub fn normalize_repo_remote(remote: &str) -> String {
    let s = remote.trim().to_lowercase();
    let (host, path) = match s.find("://") {
        Some(i) => {
            let rest = &s[i + 3..];
            let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
            let host = authority.rsplit('@').next().unwrap_or(authority);
            (
                host.split(':').next().unwrap_or(host).to_string(),
                path.to_string(),
            )
        }
        None => {
            // scp-form (git@host:ejer/navn) eller bart host/ejer/navn.
            let (authority, path) = match (s.find(':'), s.find('/')) {
                (Some(c), Some(sl)) if c < sl => (&s[..c], &s[c + 1..]),
                (Some(c), None) => (&s[..c], &s[c + 1..]),
                (_, Some(sl)) => (&s[..sl], &s[sl + 1..]),
                (None, None) => (&s[..], ""),
            };
            let host = authority.rsplit('@').next().unwrap_or(authority);
            (host.to_string(), path.to_string())
        }
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path).trim_matches('/');
    if path.is_empty() {
        host
    } else {
        format!("{host}/{path}")
    }
}

/// Ejer og navn fra en kanonisk remote: `github.com/acme/timetrack` →
/// (`acme`, `timetrack`).
pub fn repo_owner_and_name(normalized: &str) -> (Option<&str>, Option<&str>) {
    let mut parts = normalized.split('/').skip(1).collect::<Vec<_>>();
    let name = parts.pop();
    let owner = parts.last().copied();
    (owner, name)
}

/// Sti til sammenligning: små bogstaver, `/` som skilletegn, uden afsluttende `/`.
pub fn normalize_path(path: &str) -> String {
    path.trim()
        .replace('\\', "/")
        .to_lowercase()
        .trim_end_matches('/')
        .to_string()
}

/// True, når `path` er `prefix` eller ligger under den (`/a/foo-bar` er ikke under `/a/foo`).
pub fn path_is_within(path: &str, prefix: &str) -> bool {
    !prefix.is_empty()
        && (path == prefix
            || path
                .strip_prefix(prefix)
                .is_some_and(|r| r.starts_with('/')))
}

/// Mappenavne i en sti, der kan bære et kunde- eller projektnavn
/// (uden drev, hjemmemappe og generiske mapper).
pub fn path_components(path: &str) -> Vec<String> {
    const GENERIC: &[&str] = &[
        "users",
        "home",
        "dev",
        "src",
        "projects",
        "projekter",
        "code",
        "repos",
        "git",
        "documents",
        "dokumenter",
        "desktop",
        "skrivebord",
        "work",
        "arbejde",
        "freelance",
        "kunder",
        "egne",
        "worktrees",
        "tmp",
        "library",
        "applications",
        "volumes",
        "mnt",
        "opt",
        "var",
    ];
    let normalized = normalize_path(path);
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|p| !p.is_empty() && !p.ends_with(':'))
        .collect();
    let mut out = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        // Mappen lige efter users/home er brugernavnet.
        if i > 0 && matches!(parts[i - 1], "users" | "home") {
            continue;
        }
        if GENERIC.contains(part) || part.starts_with('.') {
            continue;
        }
        out.push(part.to_string());
    }
    out
}

/// Programnavn til sammenligning: små bogstaver, uden `.exe` og `.app`.
pub fn normalize_app(app: &str) -> String {
    let lower = app.trim().to_lowercase();
    let lower = lower.strip_suffix(".exe").unwrap_or(&lower);
    let lower = lower.strip_suffix(".app").unwrap_or(lower);
    lower.to_string()
}

/// Suffikser browsere og apps sætter efter titlen (`… - Google Chrome`).
const APP_TITLE_SUFFIXES: &[&str] = &[
    "google chrome",
    "microsoft\u{200b} edge",
    "microsoft edge",
    "mozilla firefox",
    "firefox",
    "brave",
    "opera",
    "vivaldi",
    "safari",
    "arc",
    "microsoft word",
    "microsoft excel",
    "microsoft powerpoint",
    "word",
    "excel",
    "powerpoint",
    "microsoft outlook",
    "outlook",
    "microsoft teams",
    "slack",
    "discord",
    "figma",
    "obsidian",
    "notion",
    "visual studio code",
    "cursor",
    "zed",
    "windsurf",
];

/// Skilletegn mellem titelsegmenter.
const TITLE_SEPARATORS: &[&str] = &[" - ", " \u{2014} ", " \u{2013} ", " | ", " · ", " • "];

/// Vinduestitel uden flygtigt pynt: ugemt-markører (`●`), notifikationstællere
/// (`(3) `) og programmets eget navn som suffiks. Port af trackerens
/// `normalize_title`. Bliver aldrig tom, hvis input ikke er tomt.
pub fn clean_title(app: &str, raw: &str) -> String {
    let trimmed = raw.trim();
    let mut s = trimmed.to_string();
    loop {
        let stripped = s
            .trim_start_matches(['\u{25cf}', '*', '\u{2022}'])
            .trim_start();
        if stripped.len() == s.len() {
            break;
        }
        s = stripped.to_string();
    }
    if let Some(rest) = strip_notification_counter(&s) {
        s = rest;
    }
    let app_lower = normalize_app(app);
    while let Some(shorter) = strip_app_suffix(&s, &app_lower) {
        s = shorter;
    }
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() { trimmed.to_string() } else { s }
}

fn strip_notification_counter(s: &str) -> Option<String> {
    let rest = s.strip_prefix('(')?;
    let close = rest.find(')')?;
    let inner = &rest[..close];
    let digits = inner.strip_suffix('+').unwrap_or(inner);
    if digits.is_empty() || digits.len() > 4 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let after = rest[close + 1..].trim_start();
    (!after.is_empty()).then(|| after.to_string())
}

fn strip_app_suffix(s: &str, app_lower: &str) -> Option<String> {
    for sep in TITLE_SEPARATORS {
        if let Some(idx) = s.rfind(sep) {
            let (head, tail) = s.split_at(idx);
            let tail = tail[sep.len()..].trim().to_lowercase();
            let known = APP_TITLE_SUFFIXES.contains(&tail.as_str());
            // Programmets eget navn som helt ord ("code" i "visual studio
            // code"), ikke som delstreng ("arc" i "research").
            let own =
                !app_lower.is_empty() && format!(" {tail} ").contains(&format!(" {app_lower} "));
            if (known || own) && !head.trim().is_empty() {
                return Some(head.trim_end().to_string());
            }
        }
    }
    None
}

/// Titlen delt ved skilletegnene (`Ordre 1234 – Bageriet Admin` → to dele).
pub fn title_segments(title: &str) -> Vec<String> {
    let mut parts = vec![title.to_string()];
    for sep in TITLE_SEPARATORS {
        parts = parts
            .iter()
            .flat_map(|p| p.split(sep).map(str::to_string).collect::<Vec<_>>())
            .collect();
    }
    parts
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Et ord er variabelt, når det bærer tal, ligner et id eller er en mailadresse.
fn is_variable_token(token: &str) -> bool {
    token.chars().any(|c| c.is_ascii_digit())
        || token.contains('@')
        || (token.len() >= 8 && token.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Skabelon af en tekst: normaliseret og foldet (ae/oe/aa), variable ord
/// erstattet af `#`. `Faktura 2024-117 til Bageriet` → `faktura # til bageriet`.
pub fn template_of(text: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for raw in text.split_whitespace() {
        let token = if is_variable_token(raw) {
            "#".to_string()
        } else {
            let norm = fold_danish(&normalize_text(raw), Fold::Double);
            if norm.is_empty() {
                continue;
            }
            norm
        };
        if token == "#" && out.last().is_some_and(|t| t == "#") {
            continue;
        }
        out.push(token);
    }
    out.join(" ")
}

/// Titler uden indhold, der aldrig må læres eller matches.
pub fn is_generic_title(template: &str) -> bool {
    const GENERIC: &[&str] = &[
        "",
        "#",
        "new tab",
        "ny fane",
        "untitled",
        "uden titel",
        "unavngivet",
        "start",
        "home",
        "forside",
        "inbox",
        "indbakke",
        "settings",
        "indstillinger",
        "loading",
        "indlaeser",
        "google",
        "search",
        "soeg",
        "dashboard",
        "login",
        "log ind",
        "sign in",
        "welcome",
        "velkommen",
        "terminal",
        "bash",
        "zsh",
        "powershell",
    ];
    if GENERIC.contains(&template) {
        return true;
    }
    // Mindst ét rigtigt ord på 3+ bogstaver.
    !template
        .split(' ')
        .any(|t| t != "#" && t.chars().count() >= 3)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_text_keeps_danish_letters() {
        assert_eq!(
            normalize_text("  Bageriet PÅ hjørnet!! "),
            "bageriet på hjørnet"
        );
        assert_eq!(normalize_text("Æble-Ø  & co."), "æbleø co");
    }

    #[test]
    fn decomposed_aa_is_composed() {
        assert_eq!(normalize_text("Ga\u{030A}rden"), "gården");
    }

    #[test]
    fn fold_variants() {
        assert_eq!(
            fold_danish("hjørnet på æble", Fold::Double),
            "hjoernet paa aeble"
        );
        assert_eq!(
            fold_danish("hjørnet på æble", Fold::Single),
            "hjornet pa able"
        );
    }

    #[test]
    fn compact_keys_has_both_spellings() {
        assert_eq!(
            compact_keys("Bageriet på hjørnet"),
            vec!["bagerietpaahjoernet", "bagerietpahjornet"]
        );
        assert_eq!(compact_keys("Acme Corp"), vec!["acmecorp"]);
        assert!(compact_keys("!!").is_empty());
    }

    #[test]
    fn punycode_decodes_danish_domains() {
        assert_eq!(decode_punycode_label("xn--hjrnet-cya"), "hjørnet");
        assert_eq!(decode_punycode_label("xn--blbrgrd-fxak7p"), "blåbærgrød");
        assert_eq!(decode_punycode_label("example"), "example");
        // Ugyldig input kommer uændret tilbage.
        assert_eq!(decode_punycode_label("xn--!!"), "xn--!!");
        assert_eq!(decode_domain("www.xn--hjrnet-cya.dk"), "www.hjørnet.dk");
    }

    #[test]
    fn domain_normalization() {
        assert_eq!(
            normalize_domain("https://user:pw@WWW.Bageriet.dk:8443/shop?x=1"),
            "bageriet.dk"
        );
        assert_eq!(normalize_domain("xn--hjrnet-cya.dk"), "hjørnet.dk");
        assert_eq!(normalize_domain("http://localhost:3000/"), "localhost");
        assert!(domain_matches("shop.bageriet.dk", "bageriet.dk"));
        assert!(!domain_matches("minbageriet.dk", "bageriet.dk"));
        assert_eq!(
            segment_host(None, Some("https://a.b.dk/x")),
            Some("a.b.dk".into())
        );
        assert_eq!(segment_host(Some(""), None), None);
    }

    #[test]
    fn non_web_urls_have_no_domain() {
        assert_eq!(normalize_domain("chrome://newtab"), "");
        assert_eq!(normalize_domain("chrome-extension://abc/popup.html"), "");
        assert_eq!(normalize_domain("about:blank"), "");
        assert_eq!(normalize_domain("file:///Users/mads/x.html"), "");
        assert_eq!(normalize_domain("mailto:a@b.dk"), "");
        assert_eq!(normalize_domain("localhost:3000"), "localhost");
        assert_eq!(normalize_domain("bageriet.dk"), "bageriet.dk");
        assert_eq!(normalize_domain("http://[::1]:3000/x"), "[::1]");
        assert_eq!(segment_host(None, Some("chrome://newtab")), None);
    }

    #[test]
    fn punycode_never_panics_on_garbage() {
        for label in [
            "xn--xw902716a",
            "xn--99999999999",
            "xn--a-zzzzzzzzzzzz",
            "xn--",
            "xn---",
            "xn--ø",
        ] {
            let _ = decode_punycode_label(label);
        }
        assert_eq!(decode_punycode_label("xn--xw902716a"), "xn--xw902716a");
    }

    #[test]
    fn domain_name_extraction() {
        assert_eq!(extract_domain_name("app.acmecorp.com"), "acmecorp");
        assert_eq!(extract_domain_name("www.xn--hjrnet-cya.dk"), "hjørnet");
        assert_eq!(extract_domain_name("localhost"), "localhost");
    }

    #[test]
    fn repo_remote_forms_are_equal() {
        let want = "github.com/acme/timetrack";
        for r in [
            "git@github.com:acme/Timetrack.git",
            "https://github.com/acme/timetrack",
            "https://token@github.com/acme/timetrack.git/",
            "ssh://git@github.com:22/acme/timetrack.git",
            "github.com/acme/timetrack",
        ] {
            assert_eq!(normalize_repo_remote(r), want, "{r}");
        }
        assert_eq!(
            normalize_repo_remote("ssh://git@git.example.com:2222/acme/x.git"),
            "git.example.com/acme/x"
        );
        assert_eq!(
            repo_owner_and_name(want),
            (Some("acme"), Some("timetrack"))
        );
    }

    #[test]
    fn paths() {
        assert_eq!(
            normalize_path("C:\\Projects\\Kunder\\Bageriet\\"),
            "c:/projects/kunder/bageriet"
        );
        assert!(path_is_within("/a/foo/src", "/a/foo"));
        assert!(!path_is_within("/a/foo-bar", "/a/foo"));
        assert_eq!(
            path_components("/Users/mads/dev/kunder/bageriet-web/src"),
            vec!["bageriet-web"]
        );
        assert_eq!(
            path_components("C:\\Projects\\Freelance\\kunde-a"),
            vec!["kunde-a"]
        );
    }

    #[test]
    fn titles() {
        assert_eq!(
            clean_title("chrome", "(3) Indbakke - Gmail - Google Chrome"),
            "Indbakke - Gmail"
        );
        assert_eq!(
            clean_title("Code", "● main.rs - timetrack - Visual Studio Code"),
            "main.rs - timetrack"
        );
        assert_eq!(clean_title("x", "   "), "");
        assert_eq!(
            clean_title("Arc", "Udkast - Research - Arc"),
            "Udkast - Research"
        );
        assert_eq!(
            title_segments("Ordre 1234 – Bageriet Admin | Shop"),
            vec!["Ordre 1234", "Bageriet Admin", "Shop"]
        );
    }

    #[test]
    fn templates_drop_variable_parts() {
        assert_eq!(
            template_of("Faktura 2024-117 til Bageriet på Hjørnet"),
            "faktura # til bageriet paa hjoernet"
        );
        assert_eq!(template_of("PR #42 af 1a2b3c4d5e"), "pr # af #");
        assert_eq!(template_of("mail@kunde.dk skrev"), "# skrev");
        assert!(is_generic_title("ny fane"));
        assert!(is_generic_title("# #"));
        assert!(is_generic_title("pr #"));
        assert!(!is_generic_title("faktura # til bageriet"));
    }
}
