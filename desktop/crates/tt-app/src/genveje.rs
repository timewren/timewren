//! Genveje: parsing, regler og konflikter, uden GPUI. Bruges af Indstillinger
//! (optagelse af en ny genvej) og af `hotkeys` (registrering hos OS'et).
//!
//! Genvejene gemmes normaliseret som `ctrl-alt-shift-cmd-tast`, fx
//! `ctrl-alt-t` eller `ctrl-shift-f8` (samme format som `shortcut_from`).
//!
//! **AltGr.** På et dansk Windows-tastatur er AltGr det samme som Ctrl+Alt
//! (`@` = AltGr+2, `{` = AltGr+7, `[` = AltGr+8). En genvej med både Ctrl og
//! Alt ville sluge de tastetryk i alle programmer, så den afvises på Windows.
//! På macOS skriver Option særlige tegn (`@` = Option+2), så Alt alene uden
//! Ctrl eller Cmd afvises begge steder. Tasterne æ, ø og å og tegnene, der
//! kræver AltGr, kan ikke være genvejstaster.

use global_hotkey::hotkey::{Code, HotKey, Modifiers};

use crate::i18n::{t, tf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Mac,
    Windows,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else {
            Os::Windows
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chord {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    /// Cmd på macOS, Windows-tasten på Windows.
    pub cmd: bool,
    pub key: String,
}

/// "ctrl-alt-t" → akkorden. `None`, hvis formen er forkert.
pub fn parse(keys: &str) -> Option<Chord> {
    let (mods, key) = keys.rsplit_once('-')?;
    if key.is_empty() {
        return None;
    }
    let mut c = Chord {
        ctrl: false,
        alt: false,
        shift: false,
        cmd: false,
        key: key.to_lowercase(),
    };
    for m in mods.split('-') {
        match m {
            "ctrl" => c.ctrl = true,
            "alt" => c.alt = true,
            "shift" => c.shift = true,
            "cmd" => c.cmd = true,
            _ => return None,
        }
    }
    Some(c)
}

impl Chord {
    pub fn normalized(&self) -> String {
        let mut parts = vec![];
        if self.ctrl {
            parts.push("ctrl");
        }
        if self.alt {
            parts.push("alt");
        }
        if self.shift {
            parts.push("shift");
        }
        if self.cmd {
            parts.push("cmd");
        }
        parts.push(&self.key);
        parts.join("-")
    }
}

const NAMED_KEYS: &[&str] = &[
    "space",
    "enter",
    "tab",
    "up",
    "down",
    "left",
    "right",
    "home",
    "end",
    "pageup",
    "pagedown",
    "insert",
    "delete",
    "backspace",
];

fn is_function_key(key: &str) -> bool {
    key.strip_prefix('f')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=24).contains(&n))
}

fn is_plain_key(key: &str) -> bool {
    let mut cs = key.chars();
    match (cs.next(), cs.next()) {
        (Some(c), None) => c.is_ascii_lowercase() || c.is_ascii_digit(),
        _ => false,
    }
}

/// Tegn, der kan stå som tast i en genvej i appen, men aldrig globalt.
fn is_local_punctuation(key: &str) -> bool {
    matches!(key, "," | "." | "/" | ";" | "-" | "=")
}

fn key_error(key: &str) -> String {
    if matches!(key, "æ" | "ø" | "å") {
        return tf("d21.keys.key_danish", &[("key", &key.to_uppercase())]);
    }
    if key.chars().count() == 1 {
        return tf("d21.keys.key_char", &[("key", key)]);
    }
    tf("d21.keys.key_other", &[("key", key)])
}

/// Genveje, operativsystemet eller alle programmer bruger. Afvises, så vi
/// ikke tager dem fra brugeren.
fn reserved(c: &Chord, os: Os) -> Option<&'static str> {
    let only =
        |ctrl, alt, shift, cmd| c.ctrl == ctrl && c.alt == alt && c.shift == shift && c.cmd == cmd;
    match os {
        Os::Mac => {
            if only(false, false, false, true)
                && matches!(
                    c.key.as_str(),
                    "c" | "v" | "x" | "z" | "a" | "q" | "w" | "h" | "m" | "space" | "tab"
                )
            {
                return Some("d21.keys.reserved_mac");
            }
            if only(true, false, false, true) && c.key == "q" {
                return Some("d21.keys.reserved_lock");
            }
        }
        Os::Windows => {
            if only(true, false, false, false)
                && matches!(c.key.as_str(), "c" | "v" | "x" | "z" | "y" | "a")
            {
                return Some("d21.keys.reserved_edit");
            }
            if only(true, false, true, false) && c.key == "escape" {
                return Some("d21.keys.reserved_taskmgr");
            }
            if c.cmd && matches!(c.key.as_str(), "l" | "d" | "e" | "r" | "tab" | "space") {
                return Some("d21.keys.reserved_windows");
            }
        }
    }
    None
}

/// Må genvejen bruges? `global`: virker, selv når appen ikke har fokus.
/// Fejlen er en besked på det valgte sprog, der kan vises direkte.
pub fn check(c: &Chord, os: Os, global: bool) -> Result<(), String> {
    if !(c.ctrl || c.alt || c.cmd) {
        return Err(t("d21.keys.need_modifier").to_owned());
    }
    let key_ok = is_plain_key(&c.key)
        || is_function_key(&c.key)
        || NAMED_KEYS.contains(&c.key.as_str())
        || (!global && is_local_punctuation(&c.key));
    if !key_ok {
        return Err(key_error(&c.key));
    }
    if os == Os::Windows && c.ctrl && c.alt {
        return Err(t("d21.keys.altgr").to_owned());
    }
    if c.alt && !c.ctrl && !c.cmd {
        return Err(t("d21.keys.alt_alone").to_owned());
    }
    if let Some(why) = reserved(c, os) {
        return Err(t(why).to_owned());
    }
    Ok(())
}

pub fn check_keys(keys: &str, os: Os, global: bool) -> Result<(), String> {
    let c = parse(keys).ok_or_else(|| t("d21.keys.unreadable").to_owned())?;
    check(&c, os, global)
}

/// Navnet på en anden genvej, der allerede bruger `keys`.
pub fn conflict<'a>(
    keys: &str,
    action: &str,
    others: impl IntoIterator<Item = (&'a str, &'a str, &'a str)>,
) -> Option<String> {
    let wanted = parse(keys)?.normalized();
    others
        .into_iter()
        .find(|(a, _, k)| *a != action && parse(k).is_some_and(|c| c.normalized() == wanted))
        .map(|(_, label, _)| label.to_owned())
}

/// Standardgenvejene for de globale handlinger. `ctrl-alt` bruges kun på
/// macOS. På Windows er timer og sporing de samme som i den gamle app
/// (Ctrl+Shift+T og Ctrl+Shift+Mellemrum), så eksisterende brugere beholder
/// dem.
pub fn default_global(action: &str, os: Os) -> Option<&'static str> {
    Some(match (action, os) {
        ("timer.toggle", Os::Mac) => "ctrl-alt-t",
        ("timer.stop", Os::Mac) => "ctrl-alt-s",
        ("app.show", Os::Mac) => "ctrl-alt-v",
        ("tracking.toggle", Os::Mac) => "ctrl-alt-p",
        ("timer.toggle", Os::Windows) => "ctrl-shift-t",
        ("timer.stop", Os::Windows) => "ctrl-shift-f9",
        ("app.show", Os::Windows) => "ctrl-shift-f10",
        ("tracking.toggle", Os::Windows) => "ctrl-shift-space",
        _ => return None,
    })
}

/// En ekstra, fast genvej til samme handling, som registreres ved siden af
/// den valgte, når den ikke kolliderer med en af de andre: Ctrl+Shift+F8 var
/// standarden for timeren, før Windows fik den gamle apps Ctrl+Shift+T.
pub fn alternate_global(action: &str, os: Os) -> Option<&'static str> {
    match (action, os) {
        ("timer.toggle", Os::Windows) => Some("ctrl-shift-f8"),
        _ => None,
    }
}

/// Den gamle apps faste genveje på macOS (⌘⇧T timer, ⌘⇧Mellemrum sporing).
/// Brugere, der kommer fra den gamle app, beholder dem (`migrate`); nye
/// brugere får ⌃⌥, fordi ⌘⇧T genåbner faner i alle browsere.
pub const OLD_APP_MAC: [(&str, &str); 2] =
    [("timer.toggle", "cmd-shift-t"), ("tracking.toggle", "cmd-shift-space")];

pub fn code_for(key: &str) -> Option<Code> {
    use Code::*;
    const LETTERS: [Code; 26] = [
        KeyA, KeyB, KeyC, KeyD, KeyE, KeyF, KeyG, KeyH, KeyI, KeyJ, KeyK, KeyL, KeyM, KeyN, KeyO,
        KeyP, KeyQ, KeyR, KeyS, KeyT, KeyU, KeyV, KeyW, KeyX, KeyY, KeyZ,
    ];
    const DIGITS: [Code; 10] = [
        Digit0, Digit1, Digit2, Digit3, Digit4, Digit5, Digit6, Digit7, Digit8, Digit9,
    ];
    const FUNCTION: [Code; 24] = [
        F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19, F20,
        F21, F22, F23, F24,
    ];
    let b = key.as_bytes();
    if b.len() == 1 {
        return match b[0] {
            c @ b'a'..=b'z' => Some(LETTERS[(c - b'a') as usize]),
            c @ b'0'..=b'9' => Some(DIGITS[(c - b'0') as usize]),
            _ => None,
        };
    }
    if is_function_key(key) {
        let n: usize = key[1..].parse().ok()?;
        return Some(FUNCTION[n - 1]);
    }
    Some(match key {
        "space" => Space,
        "enter" => Enter,
        "tab" => Tab,
        "up" => ArrowUp,
        "down" => ArrowDown,
        "left" => ArrowLeft,
        "right" => ArrowRight,
        "home" => Home,
        "end" => End,
        "pageup" => PageUp,
        "pagedown" => PageDown,
        "insert" => Insert,
        "delete" => Delete,
        "backspace" => Backspace,
        _ => return None,
    })
}

/// Genvejen som OS-genvej (efter `check`).
pub fn to_hotkey(keys: &str, os: Os) -> Result<HotKey, String> {
    let c = parse(keys).ok_or_else(|| t("d21.keys.unreadable").to_owned())?;
    check(&c, os, true)?;
    let code = code_for(&c.key).ok_or_else(|| key_error(&c.key))?;
    let mut m = Modifiers::empty();
    if c.ctrl {
        m |= Modifiers::CONTROL;
    }
    if c.alt {
        m |= Modifiers::ALT;
    }
    if c.shift {
        m |= Modifiers::SHIFT;
    }
    if c.cmd {
        m |= Modifiers::META;
    }
    Ok(HotKey::new(Some(m), code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_og_normalisering() {
        let c = parse("alt-ctrl-t").unwrap();
        assert!(c.ctrl && c.alt && !c.shift && !c.cmd);
        assert_eq!(c.normalized(), "ctrl-alt-t");
        assert_eq!(parse("ctrl-shift-f8").unwrap().key, "f8");
        assert!(parse("t").is_none());
        assert!(parse("hyper-t").is_none());
        assert!(parse("ctrl-").is_none());
    }

    #[test]
    fn altgr_afvises_paa_windows() {
        let err = check_keys("ctrl-alt-t", Os::Windows, true).unwrap_err();
        assert!(err.contains("AltGr"), "{err}");
        // Også for genveje i appen: de ville sluge @ i et tekstfelt
        assert!(check_keys("ctrl-alt-2", Os::Windows, false).is_err());
        assert!(check_keys("ctrl-alt-shift-t", Os::Windows, true).is_err());
        // På macOS er Ctrl+Alt ikke AltGr (og er standarden)
        assert!(check_keys("ctrl-alt-t", Os::Mac, true).is_ok());
    }

    #[test]
    fn alt_alene_afvises_overalt() {
        for os in [Os::Mac, Os::Windows] {
            for keys in ["alt-2", "alt-shift-t", "alt-7"] {
                let err = check_keys(keys, os, true).unwrap_err();
                assert!(err.contains("særlige tegn"), "{keys}: {err}");
            }
        }
        assert!(check_keys("alt-cmd-t", Os::Mac, true).is_ok());
    }

    #[test]
    fn tegn_der_kraever_altgr_og_aeoeaa_kan_ikke_vaere_taster() {
        for key in [
            "@", "{", "[", "]", "}", "\\", "|", "€", "$", "~", "æ", "ø", "å",
        ] {
            let keys = format!("ctrl-shift-{key}");
            let err = check_keys(&keys, Os::Windows, true).unwrap_err();
            assert!(err.contains("kan ikke bruges"), "{key}: {err}");
            let err = check_keys(&format!("cmd-shift-{key}"), Os::Mac, false).unwrap_err();
            assert!(err.contains("kan ikke bruges"), "{key}: {err}");
        }
        assert!(
            check_keys("ctrl-shift-æ", Os::Windows, true)
                .unwrap_err()
                .contains("dansk")
        );
    }

    #[test]
    fn gyldige_genveje() {
        for (keys, os, global) in [
            ("ctrl-shift-f8", Os::Windows, true),
            ("ctrl-alt-s", Os::Mac, true),
            ("cmd-shift-t", Os::Mac, false),
            ("ctrl-shift-t", Os::Windows, false),
            ("cmd-,", Os::Mac, false),
            ("ctrl-shift-space", Os::Windows, true),
            ("ctrl-1", Os::Windows, false),
        ] {
            assert_eq!(check_keys(keys, os, global), Ok(()), "{keys}");
        }
        // Tegnsætning kun i appen
        assert!(check_keys("cmd-,", Os::Mac, true).is_err());
    }

    #[test]
    fn mindst_cmd_ctrl_eller_alt_og_ikke_systemgenveje() {
        assert!(check_keys("shift-t", Os::Mac, true).is_err());
        assert!(check_keys("t", Os::Mac, true).is_err());
        assert!(
            check_keys("cmd-q", Os::Mac, true)
                .unwrap_err()
                .contains("macOS")
        );
        assert!(check_keys("cmd-space", Os::Mac, true).is_err());
        assert!(check_keys("ctrl-c", Os::Windows, false).is_err());
        assert!(check_keys("cmd-l", Os::Windows, true).is_err());
    }

    #[test]
    fn konflikter_med_andre_genveje() {
        let list = [
            ("timer.toggle", "Start eller pause timeren", "ctrl-alt-t"),
            ("timer.stop", "Stop og gem timeren", "ctrl-alt-s"),
        ];
        assert_eq!(
            conflict("alt-ctrl-s", "timer.toggle", list),
            Some("Stop og gem timeren".into())
        );
        // Samme handling er ingen konflikt med sig selv
        assert_eq!(conflict("ctrl-alt-t", "timer.toggle", list), None);
        assert_eq!(conflict("ctrl-alt-v", "timer.toggle", list), None);
    }

    #[test]
    fn standarderne_er_gyldige_paa_deres_os_og_unikke() {
        for os in [Os::Mac, Os::Windows] {
            let mut seen = vec![];
            for a in ["timer.toggle", "timer.stop", "app.show", "tracking.toggle"] {
                let k = default_global(a, os).unwrap();
                assert_eq!(check_keys(k, os, true), Ok(()), "{a} {os:?}");
                assert!(to_hotkey(k, os).is_ok());
                assert!(!seen.contains(&k));
                seen.push(k);
            }
            for a in ["timer.toggle", "timer.stop", "app.show", "tracking.toggle"] {
                if let Some(k) = alternate_global(a, os) {
                    assert_eq!(check_keys(k, os, true), Ok(()), "alternativ {a}");
                    assert!(!seen.contains(&k), "alternativet {k} kolliderer");
                    seen.push(k);
                }
            }
        }
        assert!(default_global("palette.open", Os::Mac).is_none());
    }

    #[test]
    fn windows_har_den_gamle_apps_genveje_og_f8_som_alternativ() {
        assert_eq!(default_global("timer.toggle", Os::Windows), Some("ctrl-shift-t"));
        assert_eq!(default_global("tracking.toggle", Os::Windows), Some("ctrl-shift-space"));
        assert_eq!(alternate_global("timer.toggle", Os::Windows), Some("ctrl-shift-f8"));
        assert_eq!(alternate_global("timer.toggle", Os::Mac), None);
        let h = to_hotkey("ctrl-shift-space", Os::Windows).unwrap();
        assert_eq!(h.mods, Modifiers::CONTROL | Modifiers::SHIFT);
        assert_eq!(h.key, Code::Space);
        for (a, k) in OLD_APP_MAC {
            assert_eq!(check_keys(k, Os::Mac, true), Ok(()), "{a}");
        }
    }

    #[test]
    fn hotkey_har_de_rigtige_modifikatorer_og_kode() {
        let h = to_hotkey("ctrl-shift-f8", Os::Windows).unwrap();
        assert_eq!(h.mods, Modifiers::CONTROL | Modifiers::SHIFT);
        assert_eq!(h.key, Code::F8);
        let h = to_hotkey("ctrl-alt-t", Os::Mac).unwrap();
        assert_eq!(h.mods, Modifiers::CONTROL | Modifiers::ALT);
        assert_eq!(h.key, Code::KeyT);
        assert!(to_hotkey("ctrl-alt-t", Os::Windows).is_err(), "AltGr");
        assert_eq!(code_for("7"), Some(Code::Digit7));
        assert_eq!(code_for("pagedown"), Some(Code::PageDown));
        assert_eq!(code_for("æ"), None);
    }
}
