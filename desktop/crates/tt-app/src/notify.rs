//! OS-notifikationer til idle-spørgsmål, påmindelser og pomodoro.
//!
//! Uden ekstra afhængigheder: macOS bruger `osascript`, Windows en toast via
//! PowerShell. Brugeren kan slå alle eller hver slags fra i Indstillinger
//! (`NotificationSettings`); [`Dispatcher`] tjekker det, før noget sendes.

use std::process::Command;
use std::sync::{Arc, Mutex};

use crate::backend::d21::NotificationSettings;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationKind {
    IdleReturn,
    Reminder,
    Pomodoro,
    /// Et møde eller opkald er slut (`moeder`).
    Meeting,
    /// Besked om selve appen (fx en gammel installation, der blev liggende).
    /// Sendes altid; kan ikke slås fra som de andre.
    System,
}

/// En knap i notifikationen. Knappen er et `timetrack://handling/…`-link:
/// på Windows åbner toasten linket (protokol-aktivering, samme vej som
/// login-linket), på macOS sender `notify_mac` det samme link til appen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NotifyAction {
    /// Start en timer på den seneste registrerings kunde/projekt.
    StartLast,
    /// Åbn appen med vælgeren (kommandopaletten).
    Choose,
    /// Bekræft forslaget med dette id.
    Confirm(String),
    /// Åbn appen på Hjem, hvor forslagene står.
    Review,
    MeetingRegister(String),
    MeetingEdit(String),
    MeetingIgnore(String),
}

/// Tilfældigt token for denne kørsel. Knappernes links bærer det, så kun
/// appens egne notifikationer kan udløse en handling (`NotifyAction::parse`).
pub fn action_token() -> &'static str {
    use std::hash::{BuildHasher, Hasher};
    static T: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    T.get_or_init(|| {
        // RandomState har tilfældige nøgler pr. proces; to af dem giver 128 bit.
        let part = |salt: u64| {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(salt);
            h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
            h.finish()
        };
        format!("{:016x}{:016x}", part(1), part(2))
    })
}

/// Procent-kodning af id'et i linket (kalender-id'er har `:` og `@`).
fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

impl NotifyAction {
    pub fn verb(&self) -> &'static str {
        match self {
            NotifyAction::StartLast => "start-sidste",
            NotifyAction::Choose => "vaelg",
            NotifyAction::Confirm(_) => "bekraeft",
            NotifyAction::Review => "gennemgaa",
            NotifyAction::MeetingRegister(_) => "moede-registrer",
            NotifyAction::MeetingEdit(_) => "moede-ret",
            NotifyAction::MeetingIgnore(_) => "moede-ignorer",
        }
    }

    pub fn reference(&self) -> Option<&str> {
        match self {
            NotifyAction::Confirm(r)
            | NotifyAction::MeetingRegister(r)
            | NotifyAction::MeetingEdit(r)
            | NotifyAction::MeetingIgnore(r) => Some(r),
            _ => None,
        }
    }

    /// Knappens tekst.
    pub fn label(&self) -> &'static str {
        crate::i18n::t(&format!("handling.{}", self.verb()))
    }

    /// Åbner knappen appen (eller gør den det i baggrunden)?
    pub fn opens_app(&self) -> bool {
        matches!(
            self,
            NotifyAction::Choose | NotifyAction::Review | NotifyAction::MeetingEdit(_)
        )
    }

    /// Linket med kørslens token (se [`action_token`]).
    pub fn url(&self) -> String {
        let base = format!("{}://handling/{}", crate::deeplink::SCHEME, self.verb());
        let token = action_token();
        match self.reference() {
            Some(r) => format!("{base}?ref={}&t={token}", encode(r)),
            None => format!("{base}?t={token}"),
        }
    }

    /// Ud fra knappens verbum og id (macOS giver dem hver for sig).
    pub fn from_parts(verb: &str, reference: Option<String>) -> Option<Self> {
        let r = || reference.clone().filter(|r| !r.is_empty());
        Some(match verb {
            "start-sidste" => NotifyAction::StartLast,
            "vaelg" => NotifyAction::Choose,
            "gennemgaa" => NotifyAction::Review,
            "bekraeft" => NotifyAction::Confirm(r()?),
            "moede-registrer" => NotifyAction::MeetingRegister(r()?),
            "moede-ret" => NotifyAction::MeetingEdit(r()?),
            "moede-ignorer" => NotifyAction::MeetingIgnore(r()?),
            _ => return None,
        })
    }

    /// `timetrack://handling/<verbum>?ref=<id>`.
    pub fn parse(url: &str) -> Option<Self> {
        let (scheme, rest) = url.trim().split_once("://")?;
        if !scheme.eq_ignore_ascii_case(crate::deeplink::SCHEME) {
            return None;
        }
        let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
        let verb = path.strip_prefix("handling/")?.trim_end_matches('/');
        let reference = query
            .split('&')
            .find_map(|kv| kv.strip_prefix("ref="))
            .and_then(decode);
        // Kun links fra appens egne notifikationer i denne kørsel. Et link fra
        // en webside eller et andet program (eller en gammel toast efter en
        // genstart) gør intet.
        let token = query.split('&').find_map(|kv| kv.strip_prefix("t="));
        if token != Some(action_token()) {
            return None;
        }
        Self::from_parts(&verb.to_ascii_lowercase(), reference)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notification {
    pub kind: NotificationKind,
    pub title: String,
    pub body: String,
    /// Knapper (højst tre vises på Windows og macOS).
    pub actions: Vec<NotifyAction>,
}

impl Notification {
    pub fn new(kind: NotificationKind, title: impl Into<String>, body: impl Into<String>) -> Self {
        Notification {
            kind,
            title: title.into(),
            body: body.into(),
            actions: Vec::new(),
        }
    }

    pub fn with_actions(mut self, actions: Vec<NotifyAction>) -> Self {
        self.actions = actions;
        self
    }

    /// macOS-kategori: knapperne er faste pr. kategori.
    pub fn category(&self) -> String {
        let verbs: Vec<&str> = self.actions.iter().map(NotifyAction::verb).collect();
        format!("tt.{}", verbs.join("+"))
    }

    /// Fælles id for knapperne (de deler det, se `NotifyAction::url`).
    pub fn reference(&self) -> Option<&str> {
        self.actions.iter().find_map(NotifyAction::reference)
    }
}

/// Må denne slags notifikation sendes efter indstillingerne?
pub fn allowed(s: &NotificationSettings, kind: NotificationKind) -> bool {
    kind == NotificationKind::System
        || s.enabled
            && match kind {
                NotificationKind::IdleReturn => s.idle_return,
                NotificationKind::Reminder => s.reminders,
                NotificationKind::Pomodoro => s.pomodoro,
                NotificationKind::Meeting => s.meetings,
                NotificationKind::System => true,
            }
}

pub trait Notifier: Send + Sync {
    fn send(&self, n: &Notification) -> Result<(), String>;
}

/// Sender gennem OS'et.
pub struct OsNotifier;

impl Notifier for OsNotifier {
    fn send(&self, n: &Notification) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            // I et rigtigt bundle: UNUserNotificationCenter med knapper.
            // Uden bundle (cargo run) kan den ikke bruges; så osascript.
            if crate::notify_mac::available() {
                return crate::notify_mac::send(n);
            }
            let out = Command::new("osascript")
                .arg("-e")
                .arg(macos_script(n))
                .output()
                .map_err(|e| format!("osascript kunne ikke startes: {e}"))?;
            if out.status.success() {
                Ok(())
            } else {
                Err("macOS afviste notifikationen".into())
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let out = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command"])
                .arg(windows_script(n))
                .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
                .output()
                .map_err(|e| format!("PowerShell kunne ikke startes: {e}"))?;
            if out.status.success() {
                Ok(())
            } else {
                Err("Windows afviste notifikationen".into())
            }
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = (n, Command::new("true"));
            Ok(())
        }
    }
}

/// AppleScript-tekst: backslash og citationstegn escapes, linjeskift
/// erstattes med mellemrum.
pub fn applescript_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' | '\r' => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn macos_script(n: &Notification) -> String {
    format!(
        "display notification {} with title {}",
        applescript_string(&n.body),
        applescript_string(&n.title)
    )
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
        // PowerShell regner også ‘ ’ ‚ ‛ som enkelt-citationstegn; som
        // XML-tegnreferencer vises de ens, men kan ikke lukke strengen.
        .replace('\u{2018}', "&#x2018;")
        .replace('\u{2019}', "&#x2019;")
        .replace('\u{201A}', "&#x201A;")
        .replace('\u{201B}', "&#x201B;")
}

/// Toastens XML. Knapperne er protokol-aktivering: Windows åbner
/// `timetrack://handling/…`, og den kørende instans får linket
/// (`deeplink`). Et klik på selve toasten åbner appen.
pub fn windows_toast_xml(n: &Notification) -> String {
    let actions: String = n
        .actions
        .iter()
        .take(3)
        .map(|a| {
            format!(
                "<action content=\"{}\" arguments=\"{}\" activationType=\"protocol\"/>",
                xml_escape(a.label()),
                xml_escape(&a.url())
            )
        })
        .collect();
    let actions = if actions.is_empty() {
        String::new()
    } else {
        format!("<actions>{actions}</actions>")
    };
    format!(
        "<toast activationType=\"protocol\" launch=\"{}://\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual>{actions}</toast>",
        crate::deeplink::SCHEME,
        xml_escape(&n.title),
        xml_escape(&n.body)
    )
}

/// PowerShell-kode til en toast. Teksten XML-escapes og lægges i en
/// enkeltciteret streng (hvor kun `'` skal fordobles).
pub fn windows_script(n: &Notification) -> String {
    let xml = windows_toast_xml(n);
    let xml = xml.replace('\'', "''");
    format!(
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; \
         [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null; \
         $x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml('{xml}'); \
         $t = [Windows.UI.Notifications.ToastNotification]::new($x); \
         [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('TimeTrack').Show($t)"
    )
}

/// Sender kun det, indstillingerne tillader.
#[derive(Clone)]
pub struct Dispatcher {
    notifier: Arc<dyn Notifier>,
}

impl Dispatcher {
    pub fn new(notifier: Arc<dyn Notifier>) -> Self {
        Dispatcher { notifier }
    }

    pub fn os() -> Self {
        Dispatcher::new(Arc::new(OsNotifier))
    }

    /// `true` hvis notifikationen blev sendt.
    pub fn dispatch(&self, settings: &NotificationSettings, n: &Notification) -> bool {
        if !allowed(settings, n.kind) {
            return false;
        }
        match self.notifier.send(n) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("TT notifikation fejlede: {e}");
                false
            }
        }
    }
}

/// Husker det, den får at sende (tests).
#[derive(Default)]
pub struct RecordingNotifier {
    pub sent: Mutex<Vec<Notification>>,
}

impl Notifier for RecordingNotifier {
    fn send(&self, n: &Notification) -> Result<(), String> {
        self.sent
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(n.clone());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(kind: NotificationKind) -> Notification {
        Notification::new(kind, "Tid til en pause", "Du har arbejdet i 25 minutter")
    }

    #[test]
    fn indstillingerne_styrer_hvad_der_sendes() {
        let rec = Arc::new(RecordingNotifier::default());
        let d = Dispatcher::new(rec.clone());
        let mut s = NotificationSettings::default();
        assert!(d.dispatch(&s, &n(NotificationKind::Pomodoro)));
        assert!(d.dispatch(&s, &n(NotificationKind::Reminder)));
        assert!(d.dispatch(&s, &n(NotificationKind::IdleReturn)));
        assert_eq!(rec.sent.lock().unwrap().len(), 3);

        s.pomodoro = false;
        assert!(!d.dispatch(&s, &n(NotificationKind::Pomodoro)));
        assert!(d.dispatch(&s, &n(NotificationKind::Reminder)));

        s.enabled = false;
        assert!(!d.dispatch(&s, &n(NotificationKind::Reminder)));
        assert!(!d.dispatch(&s, &n(NotificationKind::IdleReturn)));
        assert_eq!(rec.sent.lock().unwrap().len(), 4);
    }

    #[test]
    fn applescript_escaper_citationstegn_og_baglæns_skråstreg() {
        assert_eq!(
            applescript_string(r#"Ret "Bageriet" \ nu"#),
            r#""Ret \"Bageriet\" \\ nu""#
        );
        assert_eq!(applescript_string("a\nb"), "\"a b\"");
        let s = macos_script(&Notification::new(
            NotificationKind::Reminder,
            "Æblet",
            "Start \"timer\"",
        ));
        assert_eq!(
            s,
            "display notification \"Start \\\"timer\\\"\" with title \"Æblet\""
        );
    }

    #[test]
    fn windows_toast_er_xml_og_powershell_sikker() {
        let s = windows_script(&Notification::new(
            NotificationKind::Reminder,
            "A & B <c>",
            "Det er Mads' timer",
        ));
        assert!(s.contains("A &amp; B &lt;c&gt;"));
        // Apostroffen er XML-escapet, så den ikke kan lukke PowerShell-strengen
        assert!(s.contains("Mads&apos; timer"), "{s}");
        assert!(!s.contains("Mads' timer"));
        assert_eq!(xml_escape("it's"), "it&apos;s");
    }

    /// PowerShell regner også de typografiske ‘ ’ ‚ ‛ som enkelt-citationstegn.
    #[test]
    fn typografiske_apostroffer_kan_ikke_lukke_powershell_strengen() {
        let s = windows_script(&Notification::new(
            NotificationKind::Reminder,
            "Kunde‘A’",
            "Mads’ timer‚ ‛x'); Remove-Item C:\\ #",
        ));
        for q in ['\u{2018}', '\u{2019}', '\u{201A}', '\u{201B}'] {
            assert!(!s.contains(q), "{q:?} i {s}");
        }
        assert!(s.contains("Mads&#x2019; timer"), "{s}");
    }

    // ---- knapper (kalender)

    #[test]
    fn knapper_er_links_der_kan_laeses_tilbage() {
        let all = [
            NotifyAction::StartLast,
            NotifyAction::Choose,
            NotifyAction::Confirm("kal:ics1a2b:uid@google.com:1761469200".into()),
            NotifyAction::Review,
            NotifyAction::MeetingRegister("1761469200-1761471720".into()),
            NotifyAction::MeetingEdit("x y/z?&=".into()),
            NotifyAction::MeetingIgnore("æøå".into()),
        ];
        for a in all {
            let url = a.url();
            assert!(url.starts_with("timetrack://handling/"), "{url}");
            assert!(!url["timetrack://".len()..].contains(['@', ' ', '&', ':']) || url.contains("?ref="), "{url}");
            assert_eq!(NotifyAction::parse(&url), Some(a.clone()), "{url}");
            assert_eq!(NotifyAction::from_parts(a.verb(), a.reference().map(str::to_string)), Some(a));
        }
        let tok = action_token();
        assert_eq!(NotifyAction::parse(&format!("timetrack://handling/bekraeft?t={tok}")), None, "id mangler");
        assert_eq!(NotifyAction::parse(&format!("https://handling/vaelg?t={tok}")), None);
        assert_eq!(NotifyAction::parse(&format!("timetrack://handling/slet-alt?t={tok}")), None);
        // Uden eller med forkert token (en webside, et andet program) gør linket intet
        assert_eq!(NotifyAction::parse("timetrack://handling/start-sidste"), None);
        assert_eq!(NotifyAction::parse("timetrack://handling/bekraeft?ref=x&t=0000"), None);
        assert_eq!(
            crate::deeplink::route("timetrack://handling/start-sidste"),
            crate::deeplink::Route::Unknown
        );
        assert_eq!(
            crate::deeplink::route(&NotifyAction::StartLast.url()),
            crate::deeplink::Route::Action(NotifyAction::StartLast)
        );
        assert_eq!(tok.len(), 32);
        assert_eq!(crate::deeplink::route("timetrack://handling/ukendt"), crate::deeplink::Route::Unknown);
    }

    #[test]
    fn windows_toast_har_protokol_knapper() {
        let n = Notification::new(NotificationKind::Meeting, "Mødet er slut", "Mødet med A & B varede 42 min")
            .with_actions(vec![
                NotifyAction::MeetingRegister("1-2".into()),
                NotifyAction::MeetingEdit("1-2".into()),
                NotifyAction::MeetingIgnore("1-2".into()),
            ]);
        let xml = windows_toast_xml(&n);
        assert!(xml.contains(r#"<actions><action content="Registrér" arguments="timetrack://handling/moede-registrer?ref=1-2&amp;t="#), "{xml}");
        assert!(xml.contains(r#"" activationType="protocol"/>"#), "{xml}");
        assert!(xml.contains(r#"content="Ignorér""#));
        assert!(xml.contains("A &amp; B"));
        assert!(xml.starts_with(r#"<toast activationType="protocol" launch="timetrack://">"#));
        // Uden knapper: ingen <actions>
        assert!(!windows_toast_xml(&Notification::new(NotificationKind::Reminder, "a", "b")).contains("<actions>"));
        assert_eq!(n.category(), "tt.moede-registrer+moede-ret+moede-ignorer");
        assert_eq!(n.reference(), Some("1-2"));
    }

    #[test]
    fn moedenotifikationer_kan_slaas_fra() {
        let mut s = NotificationSettings::default();
        assert!(allowed(&s, NotificationKind::Meeting));
        s.meetings = false;
        assert!(!allowed(&s, NotificationKind::Meeting));
        assert!(allowed(&s, NotificationKind::Reminder));
    }
}
