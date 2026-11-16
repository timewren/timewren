//! Editorens arbejdsmappe, læst fra editorens egne state-filer.
//!
//! Titlen siger kun mappenavnet ("main.rs - website - Visual Studio Code").
//! Den gamle tracker gættede stien ved at lede efter mappenavnet i faste
//! mapper (`~/projects`, `~/dev` ...). Det ramte forkert, når to kunder havde
//! hver sin "website", og fandt intet, når projekterne lå i `C:\Projects`.
//!
//! Nu læses de fulde stier fra editorens state:
//!
//! | Editor | Kilde |
//! |---|---|
//! | VS Code, Insiders, Cursor, Windsurf, VSCodium | `User/globalStorage/storage.json` (åbne vinduer) og `state.vscdb` (seneste) |
//! | Zed | `db/0-stable/db.sqlite`, tabellen `workspaces` |
//! | JetBrains (IntelliJ, WebStorm, PhpStorm, PyCharm, Rider, GoLand, CLion, RustRover, DataGrip) | `options/recentProjects.xml` |
//!
//! Titlens mappenavn vælger derefter blandt de kendte stier. Findes intet,
//! søges de konfigurerbare rødder (fx `C:\Projects`) med [`find_in_roots`].

use std::path::{Path, PathBuf};

use crate::paths::{expand_home, home_dir, path_from_file_uri};

/// Editorfamilie, afgjort ud fra app-id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorKind {
    /// VS Code-familien. Værdien er mappenavnet under brugerens config-mappe.
    VsCode(&'static str),
    Zed,
    JetBrains,
}

/// Et kendt workspace i editoren.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    /// Mappen (ikke normaliseret).
    pub path: String,
    /// Visningsnavnet, editoren bruger i titlen.
    pub name: String,
    /// Sand hvis editoren har det åbent lige nu (så vidt state-filen ved).
    pub open: bool,
}

/// Afgør editorfamilien ud fra app-id (exe- eller bundle-navn, små bogstaver).
pub fn editor_kind(app_id: &str) -> Option<EditorKind> {
    let id = app_id.trim().to_lowercase();
    let id = id.trim_end_matches(".exe");
    match id {
        "code" | "visual studio code" | "electron" => Some(EditorKind::VsCode("Code")),
        "code - insiders" | "visual studio code - insiders" => {
            Some(EditorKind::VsCode("Code - Insiders"))
        }
        "cursor" => Some(EditorKind::VsCode("Cursor")),
        "windsurf" => Some(EditorKind::VsCode("Windsurf")),
        "vscodium" | "codium" => Some(EditorKind::VsCode("VSCodium")),
        "zed" | "zed preview" => Some(EditorKind::Zed),
        _ if JETBRAINS_IDS.iter().any(|j| id.starts_with(j)) => Some(EditorKind::JetBrains),
        _ => None,
    }
}

const JETBRAINS_IDS: &[&str] = &[
    "idea",
    "intellij idea",
    "webstorm",
    "phpstorm",
    "pycharm",
    "goland",
    "rider",
    "clion",
    "rustrover",
    "datagrip",
    "android studio",
    "rubymine",
    "fleet",
];

/// Workspaces for en editor fra standardplaceringerne på denne maskine.
/// Åbne vinduer først, derefter seneste brugte.
pub fn workspaces_for(kind: EditorKind) -> Vec<Workspace> {
    match kind {
        EditorKind::VsCode(dir) => match config_root() {
            Some(root) => vscode_workspaces(&root.join(dir).join("User").join("globalStorage")),
            None => Vec::new(),
        },
        EditorKind::Zed => zed_db_path()
            .map(|p| zed_workspaces(&p))
            .unwrap_or_default(),
        EditorKind::JetBrains => match config_root() {
            Some(root) => jetbrains_workspaces(&root.join("JetBrains")),
            None => Vec::new(),
        },
    }
}

/// `~/Library/Application Support` på macOS, `%APPDATA%` på Windows.
fn config_root() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        home_dir().map(|h| h.join("Library").join("Application Support"))
    } else {
        home_dir().map(|h| h.join(".config"))
    }
}

fn zed_db_path() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Zed"))
    } else if cfg!(target_os = "macos") {
        home_dir().map(|h| h.join("Library").join("Application Support").join("Zed"))
    } else {
        home_dir().map(|h| h.join(".local").join("share").join("zed"))
    }?;
    let db = base.join("db");
    // Stabil kanal først, derefter preview/nightly.
    for ch in ["0-stable", "0-preview", "0-nightly", "0-dev"] {
        let p = db.join(ch).join("db.sqlite");
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// VS Code-familien
// ---------------------------------------------------------------------------

/// Læser `storage.json` (åbne vinduer) og `state.vscdb` (seneste) i
/// `globalStorage`-mappen.
pub fn vscode_workspaces(global_storage: &Path) -> Vec<Workspace> {
    let mut out = Vec::new();
    if let Ok(raw) = std::fs::read_to_string(global_storage.join("storage.json")) {
        out.extend(parse_vscode_storage_json(&raw));
    }
    if let Some(raw) = read_vscdb_recent(&global_storage.join("state.vscdb")) {
        for w in parse_vscode_recent(&raw) {
            push_unique(&mut out, w);
        }
    }
    out
}

/// `storage.json`: `windowsState.lastActiveWindow`, `windowsState.openedWindows`
/// og `backupWorkspaces`. Alle er åbne vinduer.
pub fn parse_vscode_storage_json(raw: &str) -> Vec<Workspace> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let ws = &v["windowsState"];
    let mut windows: Vec<&serde_json::Value> = vec![&ws["lastActiveWindow"]];
    if let Some(list) = ws["openedWindows"].as_array() {
        windows.extend(list.iter());
    }
    for w in windows {
        if let Some(uri) = w["folder"].as_str().or_else(|| w["folderUri"].as_str()) {
            if let Some(ws) = workspace_from_folder_uri(uri, true) {
                push_unique(&mut out, ws);
            }
        } else if let Some(uri) = w["workspace"]["configPath"].as_str()
            && let Some(ws) = workspace_from_config_uri(uri, true)
        {
            push_unique(&mut out, ws);
        }
    }
    if let Some(list) = v["backupWorkspaces"]["folders"].as_array() {
        for f in list {
            if let Some(ws) = f["folderUri"]
                .as_str()
                .and_then(|u| workspace_from_folder_uri(u, true))
            {
                push_unique(&mut out, ws);
            }
        }
    }
    out
}

/// `history.recentlyOpenedPathsList` fra `state.vscdb`.
pub fn parse_vscode_recent(raw: &str) -> Vec<Workspace> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for e in v["entries"].as_array().into_iter().flatten() {
        let ws = if let Some(uri) = e["folderUri"].as_str() {
            workspace_from_folder_uri(uri, false)
        } else if let Some(uri) = e["workspace"]["configPath"].as_str() {
            workspace_from_config_uri(uri, false)
        } else {
            None
        };
        if let Some(ws) = ws {
            push_unique(&mut out, ws);
        }
    }
    out
}

fn read_vscdb_recent(db: &Path) -> Option<String> {
    if !db.is_file() {
        return None;
    }
    let conn = rusqlite::Connection::open_with_flags(
        db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(100));
    conn.query_row(
        "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

fn workspace_from_folder_uri(uri: &str, open: bool) -> Option<Workspace> {
    // Fjern-workspaces (ssh, wsl, containere) har ingen lokal sti.
    let path = path_from_file_uri(uri)?;
    let name = crate::git::repo_name(&path)?;
    Some(Workspace {
        path: path.trim_end_matches(['/', '\\']).to_string(),
        name,
        open,
    })
}

/// Multi-root workspace: titlen viser filens navn uden `.code-workspace`, og
/// mappen er den, filen ligger i.
fn workspace_from_config_uri(uri: &str, open: bool) -> Option<Workspace> {
    let file = path_from_file_uri(uri)?;
    let file_name = crate::git::repo_name(&file)?;
    let name = file_name
        .strip_suffix(".code-workspace")
        .unwrap_or(&file_name)
        .to_string();
    let parent = Path::new(&file).parent()?.to_string_lossy().to_string();
    Some(Workspace {
        path: parent,
        name,
        open,
    })
}

// ---------------------------------------------------------------------------
// Zed
// ---------------------------------------------------------------------------

/// Læser Zeds `workspaces`-tabel. Skemaet har ændret sig over tid: nyere
/// versioner har `paths` (tekst, én sti pr. linje), ældre `local_paths`
/// (bincode-serialiseret `Vec<PathBuf>`).
pub fn zed_workspaces(db: &Path) -> Vec<Workspace> {
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(100));
    let cols: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('workspaces')")
        .and_then(|mut s| {
            s.query_map([], |r| r.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .unwrap_or_default();
    let has = |c: &str| cols.iter().any(|x| x == c);
    let order = if has("timestamp") {
        " ORDER BY timestamp DESC"
    } else {
        ""
    };

    let mut out = Vec::new();
    let column = if has("paths") {
        "paths"
    } else if has("local_paths") {
        "local_paths"
    } else {
        return out;
    };
    let sql = format!("SELECT {column} FROM workspaces WHERE {column} IS NOT NULL{order}");
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return out;
    };
    let rows = stmt.query_map([], |r| {
        let v: rusqlite::types::Value = r.get(0)?;
        Ok(v)
    });
    let Ok(rows) = rows else { return out };
    for (i, v) in rows.filter_map(Result::ok).enumerate() {
        let paths = match v {
            rusqlite::types::Value::Text(t) => t.lines().map(str::to_string).collect(),
            rusqlite::types::Value::Blob(b) => parse_bincode_paths(&b),
            _ => Vec::new(),
        };
        for p in paths {
            let p = p.trim().to_string();
            if p.is_empty() {
                continue;
            }
            if let Some(name) = crate::git::repo_name(&p) {
                // Zed fører ikke "åben"-status; det nyeste workspace er det
                // bedste bud på det åbne.
                push_unique(
                    &mut out,
                    Workspace {
                        path: p,
                        name,
                        open: i == 0,
                    },
                );
            }
        }
    }
    out
}

/// bincode af `Vec<PathBuf>`: u64 antal, derefter (u64 længde, bytes) pr. sti.
fn parse_bincode_paths(b: &[u8]) -> Vec<String> {
    fn read_u64(b: &[u8], at: usize) -> Option<u64> {
        Some(u64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?))
    }
    let mut out = Vec::new();
    let Some(n) = read_u64(b, 0) else { return out };
    let mut at = 8;
    for _ in 0..n.min(64) {
        let Some(len) = read_u64(b, at) else { break };
        at += 8;
        let Some(bytes) = b.get(at..at + len as usize) else {
            break;
        };
        at += len as usize;
        if let Ok(s) = std::str::from_utf8(bytes) {
            out.push(s.to_string());
        }
    }
    out
}

// ---------------------------------------------------------------------------
// JetBrains
// ---------------------------------------------------------------------------

/// Læser `options/recentProjects.xml` i alle produktmapper under `root`
/// (`~/Library/Application Support/JetBrains` eller `%APPDATA%\JetBrains`).
pub fn jetbrains_workspaces(root: &Path) -> Vec<Workspace> {
    let Ok(dirs) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut all: Vec<(Workspace, i64)> = Vec::new();
    for d in dirs.flatten() {
        let f = d.path().join("options").join("recentProjects.xml");
        if let Ok(raw) = std::fs::read_to_string(&f) {
            all.extend(parse_jetbrains_recent(&raw));
        }
    }
    // Åbne først, derefter nyeste aktivering.
    all.sort_by(|a, b| b.0.open.cmp(&a.0.open).then(b.1.cmp(&a.1)));
    let mut out = Vec::new();
    for (w, _) in all {
        push_unique(&mut out, w);
    }
    out
}

/// Parser `recentProjects.xml`. Returnerer workspace og tidsstempel for
/// seneste aktivering (0 hvis ukendt).
pub fn parse_jetbrains_recent(xml: &str) -> Vec<(Workspace, i64)> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<entry key=\"") {
        rest = &rest[i + "<entry key=\"".len()..];
        let Some(end) = rest.find('"') else { break };
        let key = xml_unescape(&rest[..end]);
        // Attributterne for denne post står frem til næste <entry.
        let block_end = rest.find("<entry key=\"").unwrap_or(rest.len());
        let block = &rest[..block_end];
        let open = block.contains("opened=\"true\"");
        let ts = attr_i64(block, "activationTimestamp")
            .or_else(|| attr_i64(block, "projectOpenTimestamp"))
            .unwrap_or(0);
        let path = expand_home(&key);
        // JetBrains-titlen starter med projektmappens navn ("api – Main.kt").
        if let Some(name) = crate::git::repo_name(&path) {
            out.push((Workspace { path, name, open }, ts));
        }
    }
    out
}

fn attr_str(block: &str, name: &str) -> Option<String> {
    let pat = format!("{name}=\"");
    let i = block.find(&pat)? + pat.len();
    let end = block[i..].find('"')?;
    Some(xml_unescape(&block[i..i + end]))
}

fn attr_i64(block: &str, name: &str) -> Option<i64> {
    attr_str(block, name)?.parse().ok()
}

fn xml_unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

// ---------------------------------------------------------------------------
// Valg ud fra titlen
// ---------------------------------------------------------------------------

fn push_unique(out: &mut Vec<Workspace>, w: Workspace) {
    let key = crate::paths::normalize_path(&w.path);
    if let Some(existing) = out
        .iter_mut()
        .find(|x| crate::paths::normalize_path(&x.path) == key)
    {
        existing.open |= w.open;
        return;
    }
    out.push(w);
}

/// Titelstykker: split på editorernes separatorer, trim markører.
pub fn title_segments(title: &str) -> Vec<String> {
    let mut parts = vec![title.to_string()];
    for sep in [" - ", " \u{2014} ", " \u{2013} ", " | "] {
        parts = parts
            .iter()
            .flat_map(|p| p.split(sep).map(str::to_string).collect::<Vec<_>>())
            .collect();
    }
    parts
        .into_iter()
        .map(|p| {
            p.trim()
                .trim_start_matches(['●', '•', '*', ' '])
                .trim_end_matches(" (Workspace)")
                .trim()
                .to_string()
        })
        .filter(|p| !p.is_empty())
        .collect()
}

/// Vælger workspacet, som en editortitel peger på.
///
/// 1. Et titelstykke, der selv er en absolut sti, vinder.
/// 2. Ellers et workspace, hvis navn er lig et titelstykke. Åbne vinduer går
///    forud for seneste brugte, og rækkefølgen bevares.
/// 3. Matcher intet, og er der præcis ét åbent workspace, bruges det.
pub fn pick_workspace(title: &str, workspaces: &[Workspace]) -> Option<String> {
    let segs = title_segments(title);
    if let Some(abs) = segs.iter().find(|s| crate::paths::looks_absolute(s)) {
        return Some(abs.clone());
    }
    let matches = |w: &&Workspace| segs.iter().any(|s| s.eq_ignore_ascii_case(&w.name));
    if let Some(w) = workspaces.iter().filter(|w| w.open).find(matches) {
        return Some(w.path.clone());
    }
    if let Some(w) = workspaces.iter().find(matches) {
        return Some(w.path.clone());
    }
    let mut open = workspaces.iter().filter(|w| w.open);
    match (open.next(), open.next()) {
        (Some(only), None) if segs.len() <= 1 => Some(only.path.clone()),
        _ => None,
    }
}

/// Finder en mappe med navnet `name` i de konfigurerbare rødder, op til to
/// niveauer nede (`C:\Projects\Freelance\kunde`). Kun når præcis én mappe
/// har navnet: to kunders "website" giver hellere intet end et forkert svar.
pub fn find_in_roots(name: &str, roots: &[PathBuf]) -> Option<PathBuf> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return None;
    }
    let mut hits: Vec<PathBuf> = Vec::new();
    for root in roots {
        let direct = root.join(name);
        if direct.is_dir() {
            push_path(&mut hits, direct);
        }
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for e in entries.flatten() {
            if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let cand = e.path().join(name);
            if cand.is_dir() {
                push_path(&mut hits, cand);
            }
        }
    }
    if hits.len() == 1 { hits.pop() } else { None }
}

fn push_path(hits: &mut Vec<PathBuf>, p: PathBuf) {
    if !hits.contains(&p) {
        hits.push(p);
    }
}

/// Standardrødder, når brugeren ikke har sat nogen: de gængse
/// projektmapper under hjemmemappen og `C:\Projects` på Windows.
pub fn default_roots() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(h) = home_dir() {
        for d in [
            "dev",
            "Developer",
            "Projects",
            "projects",
            "repos",
            "src",
            "code",
            "Code",
            "Documents/GitHub",
            "git",
        ] {
            let p = h.join(d);
            if p.is_dir() && !out.contains(&p) {
                out.push(p);
            }
        }
    }
    if cfg!(windows) {
        for d in [r"C:\Projects", r"C:\dev", r"C:\src", r"D:\Projects"] {
            let p = PathBuf::from(d);
            if p.is_dir() {
                out.push(p);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws(path: &str, open: bool) -> Workspace {
        Workspace {
            path: path.into(),
            name: crate::git::repo_name(path).unwrap(),
            open,
        }
    }

    #[test]
    fn editor_kind_recognizes_families() {
        assert_eq!(editor_kind("Code.exe"), Some(EditorKind::VsCode("Code")));
        assert_eq!(
            editor_kind("visual studio code"),
            Some(EditorKind::VsCode("Code"))
        );
        assert_eq!(editor_kind("cursor"), Some(EditorKind::VsCode("Cursor")));
        assert_eq!(
            editor_kind("windsurf"),
            Some(EditorKind::VsCode("Windsurf"))
        );
        assert_eq!(editor_kind("zed"), Some(EditorKind::Zed));
        assert_eq!(editor_kind("idea64"), Some(EditorKind::JetBrains));
        assert_eq!(editor_kind("webstorm"), Some(EditorKind::JetBrains));
        assert_eq!(editor_kind("phpstorm64.exe"), Some(EditorKind::JetBrains));
        assert_eq!(editor_kind("safari"), None);
    }

    #[test]
    fn storage_json_reads_open_windows_and_workspaces() {
        let raw = r#"{
          "windowsState": {
            "lastActiveWindow": {"folder": "file:///Users/m/dev/kunder/bageriet/website", "backupPath": "x"},
            "openedWindows": [
              {"folder": "file:///Users/m/dev/kunder/frisoeren/website"},
              {"workspace": {"id": "1", "configPath": "file:///Users/m/dev/mono.code-workspace"}},
              {"folder": "vscode-remote://ssh-remote%2Bhost/home/x"}
            ]
          },
          "backupWorkspaces": {"folders": [{"folderUri": "file:///c%3A/Projects/Kunde%C3%A6"}]}
        }"#;
        let w = parse_vscode_storage_json(raw);
        assert_eq!(w.len(), 4);
        assert_eq!(w[0].path, "/Users/m/dev/kunder/bageriet/website");
        assert!(w[0].open);
        assert_eq!(w[2].name, "mono");
        assert_eq!(w[2].path, "/Users/m/dev");
        assert_eq!(w[3].path, "c:/Projects/Kundeæ");
        assert_eq!(parse_vscode_storage_json("ikke json"), vec![]);
    }

    #[test]
    fn recent_list_parses_folders_and_skips_files() {
        let raw = r#"{"entries":[
          {"folderUri":"file:///Users/m/dev/a"},
          {"fileUri":"file:///Users/m/notes.md"},
          {"workspace":{"configPath":"file:///Users/m/ws/team.code-workspace"}}
        ]}"#;
        let w = parse_vscode_recent(raw);
        assert_eq!(
            w.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(),
            vec!["a", "team"]
        );
        assert!(w.iter().all(|x| !x.open));
    }

    #[test]
    fn vscode_reads_files_from_global_storage() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("storage.json"),
            r#"{"windowsState":{"lastActiveWindow":{"folder":"file:///p/open"}}}"#,
        )
        .unwrap();
        let conn = rusqlite::Connection::open(tmp.path().join("state.vscdb")).unwrap();
        conn.execute_batch(
            "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ItemTable VALUES ('history.recentlyOpenedPathsList', ?1)",
            [r#"{"entries":[{"folderUri":"file:///p/open"},{"folderUri":"file:///p/old"}]}"#],
        )
        .unwrap();
        drop(conn);
        let w = vscode_workspaces(tmp.path());
        assert_eq!(w, vec![ws("/p/open", true), ws("/p/old", false)]);
    }

    #[test]
    fn zed_reads_new_text_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("db.sqlite");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE workspaces (workspace_id INTEGER PRIMARY KEY, paths TEXT, paths_order TEXT, timestamp TEXT);
             INSERT INTO workspaces VALUES (1, '/Users/m/dev/old', '0', '2026-10-01 10:00:00');
             INSERT INTO workspaces VALUES (2, '/Users/m/dev/new\n/Users/m/dev/lib', '0,1', '2026-10-26 10:00:00');",
        )
        .unwrap();
        drop(conn);
        let w = zed_workspaces(&db);
        assert_eq!(w[0], ws("/Users/m/dev/new", true));
        assert_eq!(w[1], ws("/Users/m/dev/lib", true));
        assert_eq!(w[2], ws("/Users/m/dev/old", false));
    }

    #[test]
    fn zed_reads_old_bincode_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("db.sqlite");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE workspaces (workspace_id INTEGER PRIMARY KEY, local_paths BLOB, timestamp TEXT);",
        )
        .unwrap();
        let mut blob = 1u64.to_le_bytes().to_vec();
        let p = "/Users/m/dev/zedproj";
        blob.extend((p.len() as u64).to_le_bytes());
        blob.extend(p.as_bytes());
        conn.execute(
            "INSERT INTO workspaces VALUES (1, ?1, '2026-10-26')",
            [blob],
        )
        .unwrap();
        drop(conn);
        assert_eq!(zed_workspaces(&db), vec![ws("/Users/m/dev/zedproj", true)]);
        assert_eq!(
            zed_workspaces(&tmp.path().join("findes-ikke.sqlite")),
            vec![]
        );
    }

    #[test]
    fn jetbrains_parses_recent_projects() {
        let xml = r#"<application>
  <component name="RecentProjectsManager">
    <option name="additionalInfo">
      <map>
        <entry key="$USER_HOME$/dev/gammel">
          <value><RecentProjectMetaInfo frameTitle="gammel – README.md" projectOpenTimestamp="100" activationTimestamp="200" /></value>
        </entry>
        <entry key="C:/Projects/Kunde &amp; Co/api">
          <value><RecentProjectMetaInfo opened="true" frameTitle="api – Main.kt" activationTimestamp="300" /></value>
        </entry>
      </map>
    </option>
  </component>
</application>"#;
        let w = parse_jetbrains_recent(xml);
        assert_eq!(w.len(), 2);
        assert!(w[0].0.path.ends_with("/dev/gammel"));
        assert!(!w[0].0.path.contains("$USER_HOME$"));
        assert_eq!(w[0].1, 200);
        assert_eq!(w[1].0.path, "C:/Projects/Kunde & Co/api");
        assert_eq!(w[1].0.name, "api");
        assert!(w[1].0.open);
    }

    #[test]
    fn jetbrains_merges_products_open_first() {
        let tmp = tempfile::tempdir().unwrap();
        for (prod, xml) in [
            (
                "WebStorm2025.2",
                r#"<entry key="/a/web"><RecentProjectMetaInfo activationTimestamp="900" /></entry>"#,
            ),
            (
                "IntelliJIdea2025.2",
                r#"<entry key="/a/idea"><RecentProjectMetaInfo opened="true" activationTimestamp="10" /></entry>"#,
            ),
        ] {
            let d = tmp.path().join(prod).join("options");
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("recentProjects.xml"), xml).unwrap();
        }
        let w = jetbrains_workspaces(tmp.path());
        assert_eq!(w, vec![ws("/a/idea", true), ws("/a/web", false)]);
    }

    #[test]
    fn pick_workspace_uses_title_folder_and_prefers_open() {
        let list = vec![
            ws("/k/bageriet/website", true),
            ws("/k/frisoeren/website", false),
            ws("/k/api", true),
        ];
        assert_eq!(
            pick_workspace("index.html - website - Visual Studio Code", &list).as_deref(),
            Some("/k/bageriet/website")
        );
        assert_eq!(
            pick_workspace("● main.rs — api", &list).as_deref(),
            Some("/k/api")
        );
        assert_eq!(
            pick_workspace("api – Main.kt", &list).as_deref(),
            Some("/k/api")
        );
        // Absolut sti i titlen vinder.
        assert_eq!(
            pick_workspace("x.rs - C:\\Projects\\y - Visual Studio Code", &list).as_deref(),
            Some("C:\\Projects\\y")
        );
        // Ukendt mappe, to åbne: intet gæt.
        assert_eq!(
            pick_workspace("a.rs - ukendt - Visual Studio Code", &list),
            None
        );
    }

    #[test]
    fn pick_workspace_single_open_window_without_folder_in_title() {
        let list = vec![ws("/k/eneste", true), ws("/k/gammel", false)];
        assert_eq!(pick_workspace("Zed", &list).as_deref(), Some("/k/eneste"));
        assert_eq!(pick_workspace("x - y - z", &list), None);
    }

    #[test]
    fn find_in_roots_requires_unique_hit() {
        let tmp = tempfile::tempdir().unwrap();
        let r = tmp.path();
        std::fs::create_dir_all(r.join("Freelance/bageriet/website")).unwrap();
        std::fs::create_dir_all(r.join("Freelance/frisoeren/website")).unwrap();
        std::fs::create_dir_all(r.join("Egne/timetrack")).unwrap();
        let roots = vec![r.join("Freelance"), r.join("Egne")];
        assert_eq!(
            find_in_roots("timetrack", &roots),
            Some(r.join("Egne/timetrack"))
        );
        // To "website": hellere intet end forkert kunde.
        assert_eq!(find_in_roots("website", &roots), None);
        assert_eq!(find_in_roots("findes-ikke", &roots), None);
        assert_eq!(find_in_roots("../x", &roots), None);
    }

    #[test]
    fn title_segments_strip_markers() {
        assert_eq!(
            title_segments("● main.rs - mono (Workspace) - Visual Studio Code"),
            vec!["main.rs", "mono", "Visual Studio Code"]
        );
    }
}
