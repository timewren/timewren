//! Deep links (`timetrack://…`) og én kørende instans.
//!
//! - macOS: skemaet står i bundlets `Info.plist` (`scripts/bundle-macos.sh`),
//!   og LaunchServices afleverer linket til den kørende app via GPUI's
//!   `on_open_urls`.
//! - Windows: skemaet registreres under `HKCU\Software\Classes\timetrack`
//!   af installeren og igen ved hver start (`register_scheme`). Windows
//!   starter en ny proces med linket i argv. Den sender linket til den
//!   kørende instans (`SingleInstance`) og afslutter.
//!
//! Den kørende instans lytter på en tilfældig port på 127.0.0.1. Porten og et
//! engangs-token står i `instance.lock` i datamappen. En anden proces kan
//! højst aflevere et link; login-linket virker kun med den `state`, appen
//! selv startede med (`screens::login::parse_auth_callback`).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SCHEME: &str = "timetrack";

/// Hvad et link fra OS'et skal bruges til.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    /// `timetrack://auth/callback?code=…&state=…` (og den ældre
    /// `timetrack://auth?…`): svaret på browser-login.
    AuthCallback(String),
    /// Bring vinduet frem (anden start uden link, eller `timetrack://`).
    Activate,
    /// `timetrack://handling/…`: en knap i en notifikation (kalender).
    Action(crate::notify::NotifyAction),
    /// Et ukendt `timetrack://`-link eller noget helt andet.
    Unknown,
}

/// Skema, vært og sti uden query og fragment, med små bogstaver.
fn head(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://")?;
    if !scheme.eq_ignore_ascii_case(SCHEME) {
        return None;
    }
    let rest = rest.split(['?', '#']).next().unwrap_or("");
    let (host, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    Some((
        host.to_ascii_lowercase(),
        path.trim_end_matches('/').to_ascii_lowercase(),
    ))
}

/// Er linket et svar på browser-login? Web bruger
/// `tt_data::cloud::auth::REDIRECT_URI` (`timetrack://auth/callback`).
pub fn is_auth_callback(url: &str) -> bool {
    matches!(head(url), Some((h, p)) if h == "auth" && (p.is_empty() || p == "/callback"))
}

pub fn route(url: &str) -> Route {
    match head(url) {
        Some(_) if is_auth_callback(url) => Route::AuthCallback(url.trim().to_string()),
        Some((h, p)) if h.is_empty() && p.is_empty() => Route::Activate,
        Some((h, _)) if h == "handling" => crate::notify::NotifyAction::parse(url)
            .map(Route::Action)
            .unwrap_or(Route::Unknown),
        _ => Route::Unknown,
    }
}

/// Links i kommandolinjen (Windows starter `timetrack.exe "timetrack://…"`).
pub fn urls_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter(|a| head(a).is_some())
        .map(|a| a.trim().to_string())
        .collect()
}

// ---------- Én instans ----------

/// Det, en ny proces sender til den kørende: et link eller "kom frem".
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Message {
    Url(String),
    Activate,
}

const LOCK_FILE: &str = "instance.lock";
const HELLO: &str = "TIMETRACK1";

/// Den kørende instans' lytter. Lever, så længe appen kører.
pub struct SingleInstance {
    lock: PathBuf,
    token: String,
}

/// Resultatet af at starte: enten er vi den første instans, eller beskederne
/// er afleveret til den, der kører, og processen skal afslutte.
pub enum Claim {
    Primary(SingleInstance),
    Forwarded,
}

impl SingleInstance {
    /// Prøv at aflevere `messages` (tom = "kom frem") til en kørende instans.
    /// Lykkes det ikke, bliver denne proces den kørende og lytter efter andre.
    /// `on_message` kaldes fra en baggrundstråd.
    pub fn claim(
        dir: &Path,
        messages: &[Message],
        on_message: impl Fn(Message) + Send + Sync + 'static,
    ) -> std::io::Result<Claim> {
        let lock = dir.join(LOCK_FILE);
        if let Some((port, token)) = read_lock(&lock)
            && forward(port, &token, messages).is_ok()
        {
            return Ok(Claim::Forwarded);
        }
        std::fs::create_dir_all(dir)?;
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
        let port = listener.local_addr()?.port();
        let token = new_token();
        std::fs::write(&lock, format!("{port}\n{token}\n"))?;
        let expected = std::sync::Arc::new(token.clone());
        let on_message = std::sync::Arc::new(on_message);
        std::thread::Builder::new()
            .name("tt-single-instance".into())
            .spawn(move || {
                // Én kortlivet tråd pr. forbindelse, så en langsom klient ikke
                // kan blokere den næste.
                for stream in listener.incoming().flatten() {
                    let (expected, on_message) = (expected.clone(), on_message.clone());
                    let _ = std::thread::Builder::new()
                        .name("tt-single-instance-conn".into())
                        .spawn(move || {
                            for m in read_messages(stream, &expected) {
                                on_message(m);
                            }
                        });
                }
            })?;
        Ok(Claim::Primary(SingleInstance { lock, token }))
    }
}

impl Drop for SingleInstance {
    fn drop(&mut self) {
        // Fjern kun låsen, hvis den stadig er vores.
        if read_lock(&self.lock).is_some_and(|(_, t)| t == self.token) {
            let _ = std::fs::remove_file(&self.lock);
        }
    }
}

fn read_lock(path: &Path) -> Option<(u16, String)> {
    let s = std::fs::read_to_string(path).ok()?;
    let mut lines = s.lines();
    let port = lines.next()?.trim().parse().ok()?;
    let token = lines.next()?.trim().to_string();
    (!token.is_empty()).then_some((port, token))
}

fn new_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    // RandomState er tilfældigt seedet pr. proces; to runder giver 128 bit.
    let mut out = String::new();
    for i in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn forward(port: u16, token: &str, messages: &[Message]) -> std::io::Result<()> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(500))?;
    s.set_write_timeout(Some(Duration::from_secs(2)))?;
    s.set_read_timeout(Some(Duration::from_secs(2)))?;
    let mut body = format!("{HELLO} {token}\n");
    if messages.is_empty() {
        body.push_str("ACTIVATE\n");
    }
    for m in messages {
        match m {
            Message::Activate => body.push_str("ACTIVATE\n"),
            // Et link indeholder aldrig linjeskift; fjern dem for en sikkerheds skyld.
            Message::Url(u) => body.push_str(&format!("URL {}\n", u.replace(['\r', '\n'], ""))),
        }
    }
    body.push_str("END\n");
    s.write_all(body.as_bytes())?;
    s.flush()?;
    // Vent på kvittering, så vi ved, at en TimeTrack (og ikke en fremmed
    // proces på en genbrugt port) tog imod.
    let mut ack = String::new();
    BufReader::new(s).read_line(&mut ack)?;
    if ack.trim() == "OK" {
        Ok(())
    } else {
        Err(std::io::Error::other("ingen kvittering"))
    }
}

fn read_messages(stream: TcpStream, token: &str) -> Vec<Message> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let Ok(mut writer) = stream.try_clone() else {
        return vec![];
    };
    // Højst 64 KB pr. forbindelse (et link er langt mindre).
    let mut lines = BufReader::new(stream.take(64 * 1024)).lines();
    let hello = format!("{HELLO} {token}");
    match lines.next() {
        Some(Ok(l)) if l == hello => {}
        _ => return vec![],
    }
    let mut out = vec![];
    for line in lines {
        let Ok(line) = line else { return vec![] };
        if line == "END" {
            let _ = writer.write_all(b"OK\n");
            return out;
        }
        if line == "ACTIVATE" {
            out.push(Message::Activate);
        } else if let Some(u) = line.strip_prefix("URL ") {
            out.push(Message::Url(u.to_string()));
        }
        if out.len() > 16 {
            return vec![];
        }
    }
    vec![]
}

// ---------- Registrering af skemaet på Windows ----------

/// Registreringsdatabasens nøgler for skemaet (under `HKCU\Software\Classes`):
/// (undernøgle, navn, værdi). Navn `""` er standardværdien.
pub fn windows_scheme_entries(exe: &str) -> Vec<(String, &'static str, String)> {
    let root = format!(r"Software\Classes\{SCHEME}");
    vec![
        (root.clone(), "", "URL:TimeTrack".into()),
        (root.clone(), "URL Protocol", String::new()),
        (format!(r"{root}\DefaultIcon"), "", format!("\"{exe}\",0")),
        (
            format!(r"{root}\shell\open\command"),
            "",
            format!("\"{exe}\" \"%1\""),
        ),
    ]
}

/// Standardværdien i output fra `reg query <nøgle> /ve`. Navnet på
/// standardværdien afhænger af Windows' sprog (`(Default)`, `(Standard)`), så
/// den findes på typen i stedet for navnet.
pub fn parse_reg_default(out: &str) -> Option<String> {
    out.lines().find_map(|line| {
        let line = line.trim();
        if line.starts_with("HKEY_") {
            return None;
        }
        let (_, value) = line
            .split_once("REG_EXPAND_SZ")
            .or_else(|| line.split_once("REG_SZ"))?;
        Some(value.trim().to_owned())
    })
}

/// Skal denne exe overtage `timetrack://`?
///
/// Skemaet må ikke flytte rundt til en vilkårlig kopi (fx den, brugeren pakkede
/// ud i Overførsler). Kun:
///
/// - den installerede exe (ligger i en af `installed_dirs`, normalt
///   `%LOCALAPPDATA%\TimeTrack`) overtager altid, så en flyttet installation
///   retter sig selv;
/// - en anden kopi overtager kun, hvis intet er registreret, eller den
///   registrerede exe ikke findes længere (`exists`).
///
/// `registered` er kommandoen i `shell\open\command` (`"C:\x\timetrack.exe" "%1"`).
/// På macOS er der intet at beslutte: LaunchServices læser `CFBundleURLTypes` i
/// `Info.plist` for de `.app`-pakker, systemet kender, og appen registrerer
/// ikke selv noget ved start.
pub fn should_register_scheme(
    exe: &str,
    registered: Option<&str>,
    installed_dirs: &[String],
    exists: impl Fn(&str) -> bool,
) -> bool {
    let norm = |p: &str| p.trim().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let in_installed = norm(exe)
        .rsplit_once('\\')
        .is_some_and(|(dir, _)| installed_dirs.iter().any(|d| norm(d) == dir));
    if in_installed {
        return true;
    }
    match registered.map(crate::afloesning::exe_of).filter(|p| !p.is_empty()) {
        None => true,
        Some(path) => !exists(path),
    }
}

/// Registrér `timetrack://` til denne exe for den aktuelle bruger, hvis
/// [`should_register_scheme`] siger ja. Installeren registrerer den installerede
/// exe; her sikrer vi, at stien passer, hvis appen er flyttet.
#[cfg(target_os = "windows")]
pub fn register_scheme() -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let exe = std::env::current_exe()?;
    let exe = exe.to_string_lossy();

    let query_default = |key: &str| -> Option<String> {
        let out = std::process::Command::new("reg.exe")
            .args(["query", key, "/ve"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()
            .filter(|o| o.status.success())?;
        parse_reg_default(&String::from_utf8_lossy(&out.stdout))
    };
    // Den installerede mappe: installerens standard og den, den selv har gemt.
    let mut installed_dirs = vec![];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        installed_dirs.push(format!("{}\\TimeTrack", local.to_string_lossy()));
    }
    installed_dirs.extend(
        query_default(r"HKCU\Software\timetrack\TimeTrack")
            .map(|d| d.trim_matches('"').to_owned())
            .filter(|d| !d.is_empty()),
    );
    let registered = query_default(&format!(r"HKCU\Software\Classes\{SCHEME}\shell\open\command"));
    if !should_register_scheme(&exe, registered.as_deref(), &installed_dirs, |p| {
        std::path::Path::new(p).is_file()
    }) {
        eprintln!("TT {SCHEME}:// peger på en anden kopi af appen og flyttes ikke til {exe}");
        return Ok(());
    }
    for (key, name, value) in windows_scheme_entries(&exe) {
        let mut cmd = std::process::Command::new("reg.exe");
        cmd.arg("add").arg(format!(r"HKCU\{key}"));
        if name.is_empty() {
            cmd.arg("/ve");
        } else {
            cmd.arg("/v").arg(name);
        }
        let status = cmd
            .args(["/t", "REG_SZ", "/d", &value, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()?;
        if !status.success() {
            return Err(std::io::Error::other(format!("reg add {key} fejlede")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn webs_redirect_er_login_svar() {
        let url = format!("{}?code=a&state=s", tt_data::cloud::auth::REDIRECT_URI);
        assert_eq!(route(&url), Route::AuthCallback(url.clone()));
        assert!(is_auth_callback("timetrack://auth?code=a&state=s"));
        assert!(is_auth_callback(" TIMETRACK://Auth/Callback/?code=a "));
        assert!(!is_auth_callback("timetrack://auth/andet?code=a"));
        assert!(!is_auth_callback("https://timetrack.dk/auth/callback?code=a"));
    }

    #[test]
    fn andre_links() {
        assert_eq!(route("timetrack://"), Route::Activate);
        assert_eq!(route("timetrack://ukendt/sti"), Route::Unknown);
        assert_eq!(route("mailto:x@y.dk"), Route::Unknown);
    }

    #[test]
    fn links_fra_argv() {
        let args = ["C:\\TimeTrack\\timetrack.exe", "--flag", "timetrack://auth/callback?code=1"]
            .map(String::from);
        assert_eq!(urls_from_args(args), vec!["timetrack://auth/callback?code=1".to_string()]);
    }

    const INSTALLED: &str = r"C:\Users\a\AppData\Local\TimeTrack\timetrack.exe";
    const COPY: &str = r"C:\Users\a\Downloads\TimeTrack\timetrack.exe";

    fn dirs() -> Vec<String> {
        vec![r"C:\Users\a\AppData\Local\TimeTrack".to_string()]
    }

    fn cmd(exe: &str) -> String {
        format!("\"{exe}\" \"%1\"")
    }

    #[test]
    fn den_installerede_exe_overtager_altid() {
        // Intet registreret, registreret andetsteds (også en eksisterende kopi) eller allerede os.
        assert!(should_register_scheme(INSTALLED, None, &dirs(), |_| true));
        assert!(should_register_scheme(INSTALLED, Some(&cmd(COPY)), &dirs(), |_| true));
        assert!(should_register_scheme(INSTALLED, Some(&cmd(INSTALLED)), &dirs(), |_| true));
        // Store og små bogstaver og skråstreger er lige gyldige i Windows-stier.
        assert!(should_register_scheme(
            r"c:/users/A/appdata/local/timetrack/TimeTrack.exe",
            Some(&cmd(COPY)),
            &dirs(),
            |_| true
        ));
    }

    #[test]
    fn en_kopi_i_overfoersler_overtager_ikke_en_eksisterende_registrering() {
        assert!(!should_register_scheme(COPY, Some(&cmd(INSTALLED)), &dirs(), |_| true));
        // Heller ikke en anden kopi, så længe den registrerede findes.
        assert!(!should_register_scheme(
            COPY,
            Some(&cmd(r"C:\Tools\timetrack.exe")),
            &dirs(),
            |p| p.eq_ignore_ascii_case(r"C:\Tools\timetrack.exe")
        ));
    }

    #[test]
    fn en_kopi_overtager_hvis_intet_er_registreret_eller_stien_er_vaek() {
        assert!(should_register_scheme(COPY, None, &dirs(), |_| true));
        assert!(should_register_scheme(COPY, Some(""), &dirs(), |_| true));
        assert!(should_register_scheme(COPY, Some(&cmd(INSTALLED)), &dirs(), |_| false));
    }

    #[test]
    fn en_mappe_der_blot_starter_med_den_installerede_er_ikke_installeret() {
        let near = r"C:\Users\a\AppData\Local\TimeTrack-kopi\timetrack.exe";
        assert!(!should_register_scheme(near, Some(&cmd(INSTALLED)), &dirs(), |_| true));
        let sub = r"C:\Users\a\AppData\Local\TimeTrack\gammel\timetrack.exe";
        assert!(!should_register_scheme(sub, Some(&cmd(INSTALLED)), &dirs(), |_| true));
    }

    #[test]
    fn registreret_kommando_uden_anfoerselstegn_laeses() {
        let plain = format!("{INSTALLED} %1");
        assert!(!should_register_scheme(COPY, Some(&plain), &dirs(), |p| p == INSTALLED));
    }

    #[test]
    fn standardvaerdien_laeses_uanset_sprog() {
        let da = "\r\nHKEY_CURRENT_USER\\Software\\Classes\\timetrack\\shell\\open\\command\r\n    (Standard)    REG_SZ    \"C:\\x y\\timetrack.exe\" \"%1\"\r\n\r\n";
        assert_eq!(parse_reg_default(da).as_deref(), Some(r#""C:\x y\timetrack.exe" "%1""#));
        let en = "HKEY_CURRENT_USER\\Software\\timetrack\\TimeTrack\r\n    (Default)    REG_SZ    C:\\Users\\a\\AppData\\Local\\TimeTrack\r\n";
        assert_eq!(parse_reg_default(en).as_deref(), Some(r"C:\Users\a\AppData\Local\TimeTrack"));
        assert_eq!(parse_reg_default("FEJL: Det angivne registreringsdatabasenøgle blev ikke fundet"), None);
    }

    #[test]
    fn windows_registrering() {
        let e = windows_scheme_entries(r"C:\Users\a\AppData\Local\TimeTrack\timetrack.exe");
        assert_eq!(e[0], (r"Software\Classes\timetrack".into(), "", "URL:TimeTrack".into()));
        assert_eq!(e[1].1, "URL Protocol");
        assert_eq!(
            e[3],
            (
                r"Software\Classes\timetrack\shell\open\command".into(),
                "",
                r#""C:\Users\a\AppData\Local\TimeTrack\timetrack.exe" "%1""#.into()
            )
        );
    }

    fn collect() -> (Arc<Mutex<Vec<Message>>>, impl Fn(Message) + Send + Sync + 'static) {
        let got = Arc::new(Mutex::new(vec![]));
        let g = got.clone();
        (got, move |m| g.lock().unwrap().push(m))
    }

    fn wait_for(got: &Arc<Mutex<Vec<Message>>>, n: usize) -> Vec<Message> {
        for _ in 0..200 {
            if got.lock().unwrap().len() >= n {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        got.lock().unwrap().clone()
    }

    #[test]
    fn anden_proces_afleverer_link_til_den_foerste() {
        let dir = tempfile::tempdir().unwrap();
        let (got, sink) = collect();
        let first = SingleInstance::claim(dir.path(), &[], sink).unwrap();
        assert!(matches!(first, Claim::Primary(_)));

        let link = Message::Url("timetrack://auth/callback?code=k&state=s".into());
        let second = SingleInstance::claim(dir.path(), std::slice::from_ref(&link), |_| {
            panic!("anden instans må ikke lytte")
        })
        .unwrap();
        assert!(matches!(second, Claim::Forwarded));
        // Tredje start uden link beder bare om at komme frem.
        let third = SingleInstance::claim(dir.path(), &[], |_| panic!()).unwrap();
        assert!(matches!(third, Claim::Forwarded));
        assert_eq!(wait_for(&got, 2), vec![link, Message::Activate]);
        drop(first);
        assert!(!dir.path().join(LOCK_FILE).exists(), "låsen fjernes ved lukning");
    }

    #[test]
    fn foraeldet_laas_overtages() {
        let dir = tempfile::tempdir().unwrap();
        // En lås fra en proces, der er død (porten lytter ikke længere).
        let dead = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = dead.local_addr().unwrap().port();
        drop(dead);
        std::fs::write(dir.path().join(LOCK_FILE), format!("{port}\ngammel\n")).unwrap();
        let (_, sink) = collect();
        let c = SingleInstance::claim(dir.path(), &[], sink).unwrap();
        assert!(matches!(c, Claim::Primary(_)));
        assert_ne!(read_lock(&dir.path().join(LOCK_FILE)).unwrap().1, "gammel");
    }

    #[test]
    fn langsom_eller_stor_klient_blokerer_ikke() {
        let dir = tempfile::tempdir().unwrap();
        let (got, sink) = collect();
        let _first = SingleInstance::claim(dir.path(), &[], sink).unwrap();
        let (port, token) = read_lock(&dir.path().join(LOCK_FILE)).unwrap();
        // En klient, der sender en kæmpe linje og så intet mere.
        let mut slow = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let _ = slow.write_all(&vec![b'x'; 200 * 1024]);
        // Den næste aflevering virker alligevel.
        let link = Message::Url("timetrack://auth/callback?code=1&state=s".into());
        forward(port, &token, std::slice::from_ref(&link)).unwrap();
        assert_eq!(wait_for(&got, 1), vec![link]);
    }

    #[test]
    fn forkert_token_afvises() {
        let dir = tempfile::tempdir().unwrap();
        let (got, sink) = collect();
        let _first = SingleInstance::claim(dir.path(), &[], sink).unwrap();
        let (port, _) = read_lock(&dir.path().join(LOCK_FILE)).unwrap();
        assert!(forward(port, "forkert", &[Message::Url("timetrack://x".into())]).is_err());
        std::thread::sleep(Duration::from_millis(50));
        assert!(got.lock().unwrap().is_empty());
    }
}
