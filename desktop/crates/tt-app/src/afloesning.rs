//! Den nye app afløser den gamle Tauri-app (til og med 0.2.22), så de to
//! aldrig kører samtidig.
//!
//! - **Windows.** Den gamle hed `timetrack-desktop.exe`, den nye hedder
//!   `timetrack.exe`. Installeren (`bundle/windows/installer.nsi`) stopper
//!   den gamle proces, fjerner exe'en og retter genveje og autostart. Startes
//!   den nye exe uden installeren (fx direkte fra en download), gør appen
//!   selv det vigtigste ved start: stopper den gamle proces, peger autostart
//!   (`HKCU\…\Run`, værdien `TimeTrack`) på sig selv og fjerner den gamle exe,
//!   hvis den ligger i samme mappe.
//! - **macOS.** Samme bundle-id, navn og exe-navn som før, så opdateringen
//!   erstatter den gamle `.app` på stedet. Autostart (LaunchAgent fra den
//!   gamle app, `~/Library/LaunchAgents/TimeTrack.plist`) får `--autostart`,
//!   så appen starter skjult i menulinjen.
//!
//! Autostart med [`AUTOSTART_ARG`] betyder "start skjult i tray" (`vindue::start_hidden`).

/// Argumentet, autostart giver appen: start skjult i tray/menulinjen.
pub const AUTOSTART_ARG: &str = "--autostart";
/// Den gamle apps exe på Windows.
pub const OLD_EXE_WINDOWS: &str = "timetrack-desktop.exe";
/// Den nye apps exe på Windows.
pub const NEW_EXE_WINDOWS: &str = "timetrack.exe";
/// Navnet på autostart-værdien under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
/// (det samme som den gamle apps).
pub const RUN_VALUE: &str = "TimeTrack";
pub const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

use std::sync::atomic::{AtomicBool, Ordering};

use crate::i18n::{t, tf};

/// Exe-stien i en kommandolinje (`"C:\a b\x.exe" --arg` eller `C:\x.exe`).
pub(crate) fn exe_of(cmd: &str) -> &str {
    let cmd = cmd.trim();
    if let Some(rest) = cmd.strip_prefix('"') {
        rest.split('"').next().unwrap_or("")
    } else {
        cmd.split_whitespace().next().unwrap_or("")
    }
}

fn file_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

/// Peger kommandolinjen på den gamle apps exe?
pub fn points_to_old_exe(cmd: &str) -> bool {
    file_name(exe_of(cmd)).eq_ignore_ascii_case(OLD_EXE_WINDOWS)
}

/// Den autostart-værdi, der skal skrives, når den nuværende er `current` og
/// appen ligger i `exe`. `None`: intet at gøre. Kun den gamle apps værdi og
/// vores egen uden [`AUTOSTART_ARG`] rettes; peger den på en anden
/// installation af den nye app, røres den ikke (en midlertidig kopi i
/// Overførsler må ikke overtage autostart). Autostart slås aldrig til her;
/// findes værdien ikke, var den slået fra.
pub fn autostart_update(current: Option<&str>, exe: &str) -> Option<String> {
    let current = current?.trim();
    let ours = exe_of(current).eq_ignore_ascii_case(exe);
    let has_flag = current.split_whitespace().any(|a| a.eq_ignore_ascii_case(AUTOSTART_ARG));
    (points_to_old_exe(current) || (ours && !has_flag))
        .then(|| format!("\"{exe}\" {AUTOSTART_ARG}"))
}

/// Værdien `name` i output fra `reg query <nøgle> /v <name>`.
pub fn parse_reg_query(out: &str, name: &str) -> Option<String> {
    out.lines().find_map(|line| {
        let line = line.trim();
        let rest = line.strip_prefix(name)?;
        if !rest.starts_with([' ', '\t']) {
            return None;
        }
        let rest = rest.trim_start();
        let (_, value) = rest
            .split_once("REG_EXPAND_SZ")
            .or_else(|| rest.split_once("REG_SZ"))?;
        Some(value.trim().to_owned())
    })
}

/// LaunchAgent-plisten med [`AUTOSTART_ARG`] i `ProgramArguments`. `None`,
/// hvis den allerede er der, eller filen ikke har formen.
pub fn launch_agent_with_flag(plist: &str) -> Option<String> {
    let key = plist.find("<key>ProgramArguments</key>")?;
    let open = key + plist[key..].find("<array>")?;
    let close = open + plist[open..].find("</array>")?;
    let args = &plist[open..close];
    if args.contains(&format!("<string>{AUTOSTART_ARG}</string>")) {
        return None;
    }
    // Samme indrykning som den første <string> i arrayet.
    let indent = args
        .find("<string>")
        .map(|i| {
            let line_start = args[..i].rfind('\n').map(|n| n + 1).unwrap_or(0);
            args[line_start..i].to_owned()
        })
        .filter(|s| s.chars().all(char::is_whitespace))
        .unwrap_or_else(|| "    ".into());
    let before = plist[..close].trim_end_matches([' ', '\t']);
    let sep = if before.ends_with('\n') { "" } else { "\n" };
    let close_indent = &plist[before.len()..close];
    Some(format!(
        "{before}{sep}{indent}<string>{AUTOSTART_ARG}</string>\n{close_indent}{}",
        &plist[close..]
    ))
}

// ---------------------------------------------------------------- MSI (0.2.x)

/// Produktnavnet i `src-tauri/tauri.conf.json` (`productName`). MSI'en og
/// NSIS-installeren viser begge dette som `DisplayName`.
pub const PRODUCT_NAME: &str = "TimeTrack";
/// Afinstallationsnøglerne for programmer, installeret for alle brugere (64- og
/// 32-bit-visningen). MSI'en fra 0.2.x kan ligge i begge.
pub const HKLM_UNINSTALL_KEYS: [&str; 2] = [
    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
];

/// Én post under en `Uninstall`-nøgle.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UninstallEntry {
    /// Undernøglens navn (for en MSI produktkoden, `{GUID}`).
    pub key: String,
    pub display_name: Option<String>,
    pub display_version: Option<String>,
    pub uninstall_string: Option<String>,
    pub windows_installer: bool,
}

/// En MSI-installation af 0.2.x, som den nye app ikke kan fjerne selv.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OldMsi {
    /// `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`, klar til `msiexec /x`.
    pub product_code: String,
    pub version: Option<String>,
}

/// Posterne i output fra `reg query <Uninstall-nøgle> /s`.
pub fn parse_uninstall_dump(out: &str) -> Vec<UninstallEntry> {
    let mut entries: Vec<UninstallEntry> = Vec::new();
    let mut block = String::new();
    let mut key: Option<String> = None;
    let flush = |key: Option<String>, block: &str, entries: &mut Vec<UninstallEntry>| {
        let Some(key) = key else { return };
        // Nøgler uden visningsnavn (rodnøglen, tekniske poster) er ikke programmer.
        if parse_reg_query(block, "DisplayName").is_none() {
            return;
        }
        entries.push(UninstallEntry {
            key,
            display_name: parse_reg_query(block, "DisplayName"),
            display_version: parse_reg_query(block, "DisplayVersion"),
            uninstall_string: parse_reg_query(block, "UninstallString"),
            windows_installer: parse_reg_dword(block, "WindowsInstaller") == Some(1),
        });
    };
    for line in out.lines() {
        if line.starts_with("HKEY_") {
            flush(key.take(), &block, &mut entries);
            block.clear();
            key = line.trim().rsplit('\\').next().map(str::to_owned);
        } else {
            block.push_str(line);
            block.push('\n');
        }
    }
    flush(key, &block, &mut entries);
    entries
}

/// Et DWORD i output fra `reg query` (`Navn    REG_DWORD    0x1`).
fn parse_reg_dword(out: &str, name: &str) -> Option<u32> {
    out.lines().find_map(|line| {
        let rest = line.trim().strip_prefix(name)?;
        if !rest.starts_with([' ', '\t']) {
            return None;
        }
        let (_, v) = rest.split_once("REG_DWORD")?;
        let v = v.trim();
        match v.strip_prefix("0x").or_else(|| v.strip_prefix("0X")) {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => v.parse().ok(),
        }
    })
}

/// `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` (hex). Kun en sådan må ende i en
/// kommandolinje til `msiexec`.
fn is_product_code(s: &str) -> bool {
    let Some(inner) = s.strip_prefix('{').and_then(|s| s.strip_suffix('}')) else {
        return false;
    };
    let parts: Vec<&str> = inner.split('-').collect();
    parts.len() == 5
        && parts
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(p, n)| p.len() == n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Produktkoden i en `MsiExec.exe /X{GUID}`-streng.
fn product_code_in(cmd: &str) -> Option<String> {
    let start = cmd.find('{')?;
    let end = start + cmd[start..].find('}')?;
    let code = &cmd[start..=end];
    is_product_code(code).then(|| code.to_owned())
}

/// Er der en MSI-installation af en ældre TimeTrack blandt posterne?
///
/// MSI'en kendes på `DisplayName` = [`PRODUCT_NAME`] og enten
/// `WindowsInstaller=1` eller en `msiexec`-afinstallationsstreng. NSIS-
/// installationen (samme navn) har ingen af delene. Produktkoden skal være en
/// gyldig GUID, ellers returneres intet.
pub fn find_old_msi(entries: &[UninstallEntry], current_version: &str) -> Option<OldMsi> {
    let current = semver::Version::parse(current_version).ok();
    entries.iter().find_map(|e| {
        if !e.display_name.as_deref()?.trim().eq_ignore_ascii_case(PRODUCT_NAME) {
            return None;
        }
        let msiexec = e
            .uninstall_string
            .as_deref()
            .is_some_and(|s| s.to_ascii_lowercase().contains("msiexec"));
        if !(e.windows_installer || msiexec) {
            return None;
        }
        let version = e.display_version.as_deref().map(str::trim).filter(|v| !v.is_empty());
        // Ikke en gammel installation, hvis den er lige så ny som os.
        if let (Some(v), Some(cur)) = (version.and_then(|v| semver::Version::parse(v).ok()), &current)
            && v >= *cur
        {
            return None;
        }
        let product_code = if is_product_code(&e.key) {
            e.key.clone()
        } else {
            product_code_in(e.uninstall_string.as_deref()?)?
        };
        Some(OldMsi {
            product_code,
            version: version.map(str::to_owned),
        })
    })
}

/// Genveje, MSI'en lægger i startmenuen for alle brugere
/// (`%ProgramData%\Microsoft\Windows\Start Menu\Programs`). Vores egen
/// genvej ligger pr. bruger og er ikke med.
pub fn msi_start_menu_shortcuts(common_programs: &std::path::Path) -> Vec<std::path::PathBuf> {
    vec![
        common_programs.join(format!("{PRODUCT_NAME}.lnk")),
        common_programs.join(PRODUCT_NAME).join(format!("{PRODUCT_NAME}.lnk")),
    ]
}

/// Skal beskeden om den gamle MSI vises? Kun én gang pr. produktkode, så den
/// ikke kommer ved hver start.
pub fn msi_notice_due(shown_for: Option<&str>, product_code: &str) -> bool {
    shown_for.map(str::trim) != Some(product_code)
}

/// Beskeden, brugeren får, når en MSI-installation af 0.2.x ligger tilbage.
pub fn msi_notice_text(version: Option<&str>) -> String {
    match version {
        Some(v) => tf("afloesning.msi_version", &[("version", v)]),
        None => t("afloesning.msi").to_owned(),
    }
}

static TAKEOVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Kører afløsningen stadig? De globale genveje venter på den, fordi den gamle
/// app holder dem, til den er stoppet (`hotkeys::retry_taken`).
pub fn takeover_pending() -> bool {
    TAKEOVER_RUNNING.load(Ordering::SeqCst)
}

/// Kør afløsningen i en tråd og markér den som i gang, til den er færdig.
pub fn spawn_replace_old_app() {
    spawn_takeover(replace_old_app);
}

fn spawn_takeover(job: impl FnOnce() + Send + 'static) -> std::thread::JoinHandle<()> {
    struct Done;
    impl Drop for Done {
        // Også hvis jobbet går i panik.
        fn drop(&mut self) {
            TAKEOVER_RUNNING.store(false, Ordering::SeqCst);
        }
    }
    TAKEOVER_RUNNING.store(true, Ordering::SeqCst);
    std::thread::spawn(move || {
        let _done = Done;
        job();
    })
}

/// Afløs den gamle app (se modulets dokumentation). Fejl logges kun; appen
/// starter under alle omstændigheder.
pub fn replace_old_app() {
    #[cfg(target_os = "windows")]
    windows::replace();
    #[cfg(target_os = "macos")]
    macos::fix_launch_agent();
}

#[cfg(target_os = "macos")]
mod macos {
    pub fn fix_launch_agent() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let path = std::path::Path::new(&home).join("Library/LaunchAgents/TimeTrack.plist");
        let Ok(plist) = std::fs::read_to_string(&path) else {
            return;
        };
        if let Some(fixed) = super::launch_agent_with_flag(&plist)
            && let Err(e) = std::fs::write(&path, fixed)
        {
            eprintln!("TT autostart kunne ikke opdateres: {e}");
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    use super::*;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn quiet(cmd: &mut Command) -> &mut Command {
        cmd.creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
    }

    pub fn replace() {
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        // Kører vi selv som den gamle exe (en gammel installation), rører vi intet.
        if exe
            .file_name()
            .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(OLD_EXE_WINDOWS))
        {
            return;
        }
        // 1. Stop den gamle app (den lukker til tray, så /F).
        let killed = quiet(Command::new("taskkill.exe").args(["/F", "/T", "/IM", OLD_EXE_WINDOWS]))
            .stdout(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        // 2. Autostart peger på os.
        let out = quiet(Command::new("reg.exe").args(["query", RUN_KEY, "/v", RUN_VALUE]))
            .stdout(Stdio::piped())
            .output();
        let current = out
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| parse_reg_query(&String::from_utf8_lossy(&o.stdout), RUN_VALUE));
        if let Some(value) = autostart_update(current.as_deref(), &exe.to_string_lossy()) {
            let ok = quiet(Command::new("reg.exe").args([
                "add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", value.as_str(), "/f",
            ]))
            .stdout(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
            if !ok {
                eprintln!("TT autostart kunne ikke flyttes til den nye app");
            }
        }
        // 3. Den gamle exe ved siden af os (installeren gør det også).
        if let Some(old) = exe.parent().map(|d| d.join(OLD_EXE_WINDOWS))
            && old.is_file()
        {
            for _ in 0..10 {
                if std::fs::remove_file(&old).is_ok() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
        }
        if killed {
            eprintln!("TT den gamle TimeTrack (timetrack-desktop.exe) blev lukket");
        }
        // 4. En MSI-installation (pr. maskine, Program Files) kan kun fjernes med
        //    administratorrettigheder.
        handle_old_msi();
    }

    /// Find en MSI-installation af 0.2.x i `HKLM\...\Uninstall` (begge visninger),
    /// prøv at fjerne dens startmenu-genvej for alle brugere, og fortæl
    /// brugeren, hvordan resten fjernes. Appen prøver ikke at hæve sine
    /// rettigheder selv: `msiexec /x` uden admin fejler for en pr.-maskine-
    /// installation, og en UAC-prompt midt i opstarten uden forklaring er værre
    /// end beskeden. Installeren (`installer.nsi`) tilbyder afinstallationen
    /// med UAC, når brugeren kører den interaktivt.
    fn handle_old_msi() {
        let mut entries = Vec::new();
        for key in HKLM_UNINSTALL_KEYS {
            let out = quiet(Command::new("reg.exe").args(["query", key, "/s"]))
                .stdout(Stdio::piped())
                .output();
            if let Ok(o) = out
                && o.status.success()
            {
                entries.extend(parse_uninstall_dump(&String::from_utf8_lossy(&o.stdout)));
            }
        }
        let Some(msi) = find_old_msi(&entries, env!("CARGO_PKG_VERSION")) else {
            return;
        };
        if let Some(pd) = std::env::var_os("ProgramData") {
            let common = std::path::Path::new(&pd).join(r"Microsoft\Windows\Start Menu\Programs");
            for lnk in msi_start_menu_shortcuts(&common) {
                match std::fs::remove_file(&lnk) {
                    Ok(()) => eprintln!("TT genvejen {} fra den gamle MSI er fjernet", lnk.display()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    // Typisk "adgang nægtet": genvejen ligger i All Users.
                    Err(e) => eprintln!("TT genvejen {} kunne ikke fjernes: {e}", lnk.display()),
                }
            }
            // Mappen, hvis den nu er tom (fejler ellers, og det er fint).
            let _ = std::fs::remove_dir(common.join(PRODUCT_NAME));
        }
        let marker = crate::backend::services::data_dir().join("msi-besked-vist");
        let shown = std::fs::read_to_string(&marker).ok();
        if !msi_notice_due(shown.as_deref(), &msi.product_code) {
            return;
        }
        let n = crate::notify::Notification::new(
            crate::notify::NotificationKind::System,
            PRODUCT_NAME,
            msi_notice_text(msi.version.as_deref()),
        );
        match crate::notify::Notifier::send(&crate::notify::OsNotifier, &n) {
            Ok(()) => {
                let _ = std::fs::write(&marker, &msi.product_code);
            }
            Err(e) => eprintln!("TT beskeden om den gamle MSI kunne ikke vises: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn afloesningen_er_i_gang_til_jobbet_er_faerdigt_ogsaa_ved_panik() {
        let (go_tx, go_rx) = std::sync::mpsc::channel::<()>();
        let h = spawn_takeover(move || {
            let _ = go_rx.recv();
        });
        assert!(takeover_pending(), "markeret, før tråden når at starte");
        go_tx.send(()).unwrap();
        h.join().unwrap();
        assert!(!takeover_pending());

        let h = spawn_takeover(|| panic!("taskkill fejlede"));
        assert!(h.join().is_err());
        assert!(!takeover_pending(), "en død tråd må ikke holde genvejene tilbage");
    }

    #[test]
    fn gammel_exe_genkendes_i_kommandolinjer() {
        assert!(points_to_old_exe(r#""C:\Users\a b\AppData\Local\TimeTrack\timetrack-desktop.exe""#));
        assert!(points_to_old_exe(r"C:\x\TIMETRACK-DESKTOP.EXE --minimized"));
        assert!(!points_to_old_exe(r#""C:\x\timetrack.exe" --autostart"#));
        assert!(!points_to_old_exe(""));
    }

    #[test]
    fn autostart_flyttes_til_den_nye_exe_men_slaas_aldrig_til() {
        let exe = r"C:\Users\a\AppData\Local\TimeTrack\timetrack.exe";
        let wanted = format!("\"{exe}\" --autostart");
        // Den gamle apps værdi (ingen argumenter)
        assert_eq!(
            autostart_update(Some(r#""C:\Users\a\AppData\Local\TimeTrack\timetrack-desktop.exe""#), exe),
            Some(wanted.clone())
        );
        // Den nye exe uden flaget
        assert_eq!(autostart_update(Some(&format!("\"{exe}\"")), exe), Some(wanted.clone()));
        // Allerede rigtig (også med andre store/små bogstaver)
        assert_eq!(autostart_update(Some(&wanted), exe), None);
        assert_eq!(autostart_update(Some(&wanted.to_uppercase()), exe), None);
        // En anden installation af den nye app: en kopi i Overførsler overtager den ikke.
        let installed = format!("\"{exe}\" --autostart");
        assert_eq!(autostart_update(Some(&installed), r"C:\Users\a\Downloads\timetrack.exe"), None);
        // Slået fra: forbliver slået fra
        assert_eq!(autostart_update(None, exe), None);
    }

    #[test]
    fn reg_query_laeses() {
        let out = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    TimeTrack    REG_SZ    \"C:\\Users\\a\\AppData\\Local\\TimeTrack\\timetrack-desktop.exe\"\r\n\r\n";
        assert_eq!(
            parse_reg_query(out, "TimeTrack").as_deref(),
            Some(r#""C:\Users\a\AppData\Local\TimeTrack\timetrack-desktop.exe""#)
        );
        let other = "    TimeTrackHelper    REG_SZ    x\r\n";
        assert_eq!(parse_reg_query(other, "TimeTrack"), None);
        let expand = "    TimeTrack    REG_EXPAND_SZ    %LOCALAPPDATA%\\TimeTrack\\timetrack.exe\r\n";
        assert_eq!(
            parse_reg_query(expand, "TimeTrack").as_deref(),
            Some(r"%LOCALAPPDATA%\TimeTrack\timetrack.exe")
        );
    }

    // ---- MSI

    const GUID: &str = "{3F2504E0-4F89-11D3-9A0C-0305E82C3301}";

    /// Som `reg query HKLM\...\Uninstall /s` (64-bit-visningen), med en MSI,
    /// en NSIS-installation, et andet MSI-program og rod imellem.
    fn dump() -> String {
        let base = r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
        format!(
            "\r\n{base}\r\n\r\n\
{base}\\{GUID}\r\n\
    AuthorizedCDFPrefix    REG_SZ    \r\n\
    DisplayName    REG_SZ    TimeTrack\r\n\
    DisplayVersion    REG_SZ    0.2.22\r\n\
    Publisher    REG_SZ    timetrack\r\n\
    WindowsInstaller    REG_DWORD    0x1\r\n\
    UninstallString    REG_EXPAND_SZ    MsiExec.exe /X{GUID}\r\n\
\r\n\
{base}\\TimeTrack\r\n\
    DisplayName    REG_SZ    TimeTrack\r\n\
    DisplayVersion    REG_SZ    0.2.22\r\n\
    UninstallString    REG_SZ    \"C:\\Program Files\\TimeTrack\\uninstall.exe\"\r\n\
\r\n\
{base}\\{{11111111-2222-3333-4444-555555555555}}\r\n\
    DisplayName    REG_SZ    TimeTracker Pro\r\n\
    WindowsInstaller    REG_DWORD    0x1\r\n\
\r\n\
{base}\\Ukendt\r\n\
    Version    REG_DWORD    0x10000\r\n"
        )
    }

    fn msi_entry(name: &str, key: &str, version: &str) -> UninstallEntry {
        UninstallEntry {
            key: key.into(),
            display_name: Some(name.into()),
            display_version: Some(version.into()),
            uninstall_string: None,
            windows_installer: true,
        }
    }

    #[test]
    fn uninstall_poster_laeses_fra_reg_query() {
        let e = parse_uninstall_dump(&dump());
        let msi = e.iter().find(|e| e.key == GUID).expect("MSI-posten");
        assert_eq!(msi.display_name.as_deref(), Some("TimeTrack"));
        assert_eq!(msi.display_version.as_deref(), Some("0.2.22"));
        assert!(msi.windows_installer);
        assert_eq!(
            msi.uninstall_string.as_deref(),
            Some(format!("MsiExec.exe /X{GUID}").as_str())
        );
        let nsis = e.iter().find(|e| e.key == "TimeTrack").expect("NSIS-posten");
        assert!(!nsis.windows_installer);
        assert!(nsis.uninstall_string.as_deref().unwrap().contains("uninstall.exe"));
        // Rodnøglen har ingen værdier og giver ingen post med navn.
        assert!(e.iter().all(|e| e.key != "Uninstall"));
    }

    #[test]
    fn msi_findes_ved_visningsnavn_og_windows_installer() {
        let e = parse_uninstall_dump(&dump());
        let m = find_old_msi(&e, "0.2.23").expect("MSI");
        assert_eq!(m.product_code, GUID);
        assert_eq!(m.version.as_deref(), Some("0.2.22"));
    }

    #[test]
    fn nsis_installationen_og_andre_programmer_er_ikke_msi() {
        let e = parse_uninstall_dump(&dump());
        let without: Vec<_> = e.into_iter().filter(|e| e.key != GUID).collect();
        assert_eq!(find_old_msi(&without, "0.2.23"), None);
        assert_eq!(find_old_msi(&[], "0.2.23"), None);
    }

    #[test]
    fn produktkoden_tages_fra_afinstallationsstrengen_naar_noeglen_ikke_er_en_guid() {
        let mut e = msi_entry("timetrack", "TimeTrack", "0.2.20");
        e.windows_installer = false;
        e.uninstall_string = Some(format!("MsiExec.exe /I{GUID}"));
        assert_eq!(find_old_msi(&[e], "0.2.23").unwrap().product_code, GUID);
    }

    #[test]
    fn ugyldig_produktkode_gives_aldrig_videre_til_msiexec() {
        let mut e = msi_entry("TimeTrack", "TimeTrack", "0.2.22");
        e.uninstall_string = Some("MsiExec.exe /X{ikke-en-guid} & del C:\\*".into());
        assert_eq!(find_old_msi(&[e], "0.2.23"), None);
        let e = msi_entry("TimeTrack", "{3F2504E0-4F89-11D3-9A0C-0305E82C330Z}", "0.2.22");
        assert_eq!(find_old_msi(&[e], "0.2.23"), None);
    }

    #[test]
    fn en_msi_af_den_nye_version_eller_nyere_er_ikke_gammel() {
        let e = msi_entry("TimeTrack", GUID, "0.2.23");
        assert_eq!(find_old_msi(std::slice::from_ref(&e), "0.2.23"), None);
        let e = msi_entry("TimeTrack", GUID, "0.2.22");
        assert!(find_old_msi(&[e], "0.2.23").is_some());
        // Ukendt version: regnes for gammel (hellere en besked for meget).
        let e = msi_entry("TimeTrack", GUID, "");
        assert!(find_old_msi(&[e], "0.2.23").is_some());
    }

    #[test]
    fn visningsnavnet_sammenlignes_uden_hensyn_til_store_og_smaa_bogstaver() {
        let e = msi_entry(" timetrack ", GUID, "0.2.22");
        assert!(find_old_msi(&[e], "0.2.23").is_some());
    }

    #[test]
    fn startmenu_genveje_for_alle_brugere_fjernes_men_ikke_vores_egen() {
        use std::path::Path;
        let common = Path::new("C:/ProgramData/Microsoft/Windows/Start Menu/Programs");
        let s = msi_start_menu_shortcuts(common);
        assert!(s.contains(&common.join("TimeTrack.lnk")));
        assert!(s.contains(&common.join("TimeTrack").join("TimeTrack.lnk")));
        assert!(s.iter().all(|p| p.starts_with(common)));
    }

    #[test]
    fn beskeden_om_msi_vises_en_gang_pr_produktkode() {
        assert!(msi_notice_due(None, GUID));
        assert!(!msi_notice_due(Some(GUID), GUID));
        assert!(!msi_notice_due(Some(&format!("{GUID}\n")), GUID), "ekstra linjeskift i filen");
        assert!(msi_notice_due(Some("{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}"), GUID));
    }

    #[test]
    fn beskeden_siger_hvordan_den_gamle_fjernes_paa_begge_sprog() {
        use crate::backend::Language;
        crate::i18n::set(Language::Da);
        let da = msi_notice_text(Some("0.2.22"));
        crate::i18n::set(Language::En);
        let en = msi_notice_text(Some("0.2.22"));
        crate::i18n::set(Language::Da);
        assert!(da.contains("Indstillinger → Apps → TimeTrack (gammel version) → Afinstallér"), "{da}");
        assert!(da.contains("0.2.22"), "{da}");
        assert!(en.contains("Settings → Apps → TimeTrack (old version) → Uninstall"), "{en}");
        assert!(!en.contains("Afinstallér"), "{en}");
        assert!(msi_notice_text(None).contains("Afinstallér"));
    }

    const AGENT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
  <key>Label</key>
  <string>TimeTrack</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/TimeTrack.app/Contents/MacOS/timetrack-desktop</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  </dict>
</plist>
"#;

    #[test]
    fn launch_agent_faar_autostart_flaget_en_gang() {
        let fixed = launch_agent_with_flag(AGENT).unwrap();
        assert!(fixed.contains(
            "    <string>/Applications/TimeTrack.app/Contents/MacOS/timetrack-desktop</string>\n    <string>--autostart</string>\n  </array>"
        ), "{fixed}");
        // Resten er uændret
        assert_eq!(fixed.replace("    <string>--autostart</string>\n", ""), AGENT);
        // Anden gang: intet at gøre
        assert_eq!(launch_agent_with_flag(&fixed), None);
        assert_eq!(launch_agent_with_flag("<plist/>"), None);
    }
}
