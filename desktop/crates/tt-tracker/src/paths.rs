//! Sti-normalisering, så samme mappe altid giver samme segment-identitet,
//! uanset om den kom fra editorens state, terminalens cwd eller en titel.

use std::path::PathBuf;

/// Normaliserer en sti: små bogstaver, `\` foldet til `/`, ingen afsluttende
/// separator. Windows-stier er case-ufølsomme og blander separatorer i
/// praksis (`C:\Projects\x` mod `c:/projects/x`).
pub fn normalize_path(path: &str) -> String {
    let folded = path.trim().replace('\\', "/").to_lowercase();
    let trimmed = folded.trim_end_matches('/');
    if trimmed.is_empty() && folded.starts_with('/') {
        return "/".to_string();
    }
    trimmed.to_string()
}

/// Sand når `path` er `prefix` eller ligger under den. Grænsen respekteres,
/// så `/projects/foo-bar` IKKE ligger i `/projects/foo`. Begge sider skal
/// være normaliseret med [`normalize_path`].
pub fn path_is_within(path: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return false;
    }
    if path == prefix {
        return true;
    }
    path.strip_prefix(prefix)
        .is_some_and(|rest| rest.starts_with('/') || prefix.ends_with('/'))
}

/// `file:///Users/x/dev/a%20b/` → `/Users/x/dev/a b/`. Windows:
/// `file:///c%3A/Projects/x` → `c:/Projects/x`. Andre strenge returneres
/// uændret, hvis de ligner en absolut sti.
pub fn path_from_file_uri(s: &str) -> Option<String> {
    let s = s.trim();
    let Some(rest) = s.strip_prefix("file://") else {
        return looks_absolute(s).then(|| s.to_string());
    };
    // `file://host/sti`: værten ignoreres (UNC understøttes ikke).
    let rest = if rest.starts_with('/') {
        rest
    } else {
        rest.find('/').map(|i| &rest[i..])?
    };
    let decoded = percent_decode(rest)?;
    // `/c:/Projects` → `c:/Projects`
    let b = decoded.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        return Some(decoded[1..].to_string());
    }
    Some(decoded)
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Ligner det en absolut sti på macOS eller Windows?
pub fn looks_absolute(s: &str) -> bool {
    let b = s.as_bytes();
    (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
        || s.starts_with("\\\\")
        || (s.starts_with('/') && s.len() > 1)
}

/// Brugerens hjemmemappe (`HOME`, på Windows `USERPROFILE`).
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|h| !h.is_empty()))
        .map(PathBuf::from)
}

/// Udvider `~/` og `$USER_HOME$` (JetBrains) til hjemmemappen.
pub fn expand_home(s: &str) -> String {
    let Some(home) = home_dir() else {
        return s.to_string();
    };
    let home = home.to_string_lossy();
    if let Some(rest) = s.strip_prefix("~/") {
        return format!("{}/{}", home.trim_end_matches(['/', '\\']), rest);
    }
    if s == "~" {
        return home.to_string();
    }
    s.replace("$USER_HOME$", &home)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_folds_separators_and_case() {
        assert_eq!(
            normalize_path(r"C:\Projects\Freelance\Kunde-A\"),
            "c:/projects/freelance/kunde-a"
        );
        assert_eq!(normalize_path("/home/mads/repo/"), "/home/mads/repo");
        assert_eq!(normalize_path("/"), "/");
    }

    #[test]
    fn path_prefix_respects_directory_boundary() {
        assert!(path_is_within("c:/projects/foo", "c:/projects/foo"));
        assert!(path_is_within("c:/projects/foo/src/lib", "c:/projects/foo"));
        assert!(!path_is_within("c:/projects/foo-bar", "c:/projects/foo"));
        assert!(!path_is_within("c:/projects", "c:/projects/foo"));
        assert!(path_is_within("/users/x", "/"));
        assert!(!path_is_within("/x", ""));
    }

    #[test]
    fn file_uri_decodes_mac_and_windows() {
        assert_eq!(
            path_from_file_uri("file:///Users/mads/dev/a%20b/").as_deref(),
            Some("/Users/mads/dev/a b/")
        );
        assert_eq!(
            path_from_file_uri("file:///c%3A/Projects/Kunde%C3%A6").as_deref(),
            Some("c:/Projects/Kundeæ")
        );
        assert_eq!(
            path_from_file_uri("file://localhost/tmp/x").as_deref(),
            Some("/tmp/x")
        );
        assert_eq!(path_from_file_uri("/Users/x").as_deref(), Some("/Users/x"));
        assert_eq!(path_from_file_uri("vscode-remote://ssh-remote+h/x"), None);
        assert_eq!(path_from_file_uri("relativ/sti"), None);
        assert_eq!(path_from_file_uri("file:///x%zz"), None);
    }

    #[test]
    fn looks_absolute_both_platforms() {
        assert!(looks_absolute(r"C:\Projects"));
        assert!(looks_absolute("c:/projects"));
        assert!(looks_absolute(r"\\server\share"));
        assert!(looks_absolute("/Users/x"));
        assert!(!looks_absolute("/"));
        assert!(!looks_absolute("projects/x"));
    }
}
