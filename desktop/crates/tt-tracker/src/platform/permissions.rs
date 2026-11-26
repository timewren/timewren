//! macOS-tilladelser og forklaringer til onboarding.
//!
//! Uden **Skærmoptagelse** er vinduestitler tomme, og uden **Tilgængelighed**
//! kan trackeren ikke læse det fokuserede vindues titel og dokument.
//! **Automatisering** spørges der om pr. browser og terminal første gang,
//! URL eller arbejdsmappe læses via AppleScript. På Windows kræves intet.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Permission {
    Accessibility,
    ScreenRecording,
    /// AppleScript-styring af browsere og terminaler. macOS spørger selv pr.
    /// app, første gang den bruges; status kan ikke tjekkes på forhånd.
    Automation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionState {
    Granted,
    Denied,
    /// Kan ikke afgøres uden at spørge (Automation).
    Unknown,
    /// Platformen kræver ikke tilladelsen (Windows).
    NotRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub permission: Permission,
    pub state: PermissionState,
    /// Overskrift til UI'et.
    pub title: &'static str,
    /// Hvorfor appen beder om det, på dansk.
    pub explanation: &'static str,
    /// Hvad brugeren mister uden.
    pub without: &'static str,
}

impl Permission {
    pub const ALL: [Permission; 3] = [
        Permission::Accessibility,
        Permission::ScreenRecording,
        Permission::Automation,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Permission::Accessibility => "Tilgængelighed",
            Permission::ScreenRecording => "Skærmoptagelse",
            Permission::Automation => "Automatisering",
        }
    }

    pub fn explanation(self) -> &'static str {
        match self {
            Permission::Accessibility => {
                "TimeTrack læser navnet på det vindue, du arbejder i, og hvilket dokument eller hvilken mappe det viser. Det bruges kun til forslag på din egen maskine."
            }
            Permission::ScreenRecording => {
                "macOS gemmer vinduestitler bag tilladelsen Skærmoptagelse. TimeTrack tager aldrig billeder af skærmen; den læser kun titlen på det aktive vindue."
            }
            Permission::Automation => {
                "Første gang spørger macOS, om TimeTrack må spørge din browser om adressen på den aktive fane og din terminal om dens mappe. Adressen gemmes uden søgeord og parametre og forlader aldrig maskinen."
            }
        }
    }

    pub fn without(self) -> &'static str {
        match self {
            Permission::Accessibility => {
                "Uden den ser TimeTrack kun programnavnet, og forslagene bliver grove."
            }
            Permission::ScreenRecording => {
                "Uden den er titlerne tomme, og TimeTrack kan ikke skelne mellem kunder i samme program."
            }
            Permission::Automation => {
                "Uden den kendes ingen hjemmesider eller terminalmapper, kun programmet."
            }
        }
    }

    pub fn state(self) -> PermissionState {
        imp::state(self)
    }

    /// Beder om tilladelsen. På macOS viser systemet sin dialog (Tilgængelighed
    /// og Skærmoptagelse) eller åbner Systemindstillinger. Returnerer den nye
    /// tilstand, så vidt den kan ses med det samme (ofte først efter genstart).
    pub fn request(self) -> PermissionState {
        imp::request(self)
    }

    /// Åbner det rigtige panel i Systemindstillinger.
    pub fn open_settings(self) -> bool {
        imp::open_settings(self)
    }

    pub fn status(self) -> PermissionStatus {
        PermissionStatus {
            permission: self,
            state: self.state(),
            title: self.title(),
            explanation: self.explanation(),
            without: self.without(),
        }
    }
}

/// Status for alle tilladelser, til onboarding-skærmen.
pub fn all_statuses() -> Vec<PermissionStatus> {
    Permission::ALL.iter().map(|p| p.status()).collect()
}

/// Sand hvis trackeren har det, den skal bruge for titler.
pub fn capture_ready() -> bool {
    Permission::ALL.iter().all(|p| {
        matches!(
            p.state(),
            PermissionState::Granted | PermissionState::NotRequired | PermissionState::Unknown
        )
    })
}

#[cfg(all(target_os = "macos", not(feature = "mas")))]
mod imp {
    use super::{Permission, PermissionState};
    use objc2_core_foundation::{CFBoolean, CFDictionary, CFString};

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const CFDictionary) -> bool;
        static kAXTrustedCheckOptionPrompt: *const CFString;
    }

    pub fn state(p: Permission) -> PermissionState {
        match p {
            Permission::Accessibility => {
                if unsafe { AXIsProcessTrusted() } {
                    PermissionState::Granted
                } else {
                    PermissionState::Denied
                }
            }
            Permission::ScreenRecording => {
                if objc2_core_graphics::CGPreflightScreenCaptureAccess() {
                    PermissionState::Granted
                } else {
                    PermissionState::Denied
                }
            }
            Permission::Automation => PermissionState::Unknown,
        }
    }

    pub fn request(p: Permission) -> PermissionState {
        match p {
            Permission::Accessibility => {
                // SAFETY: kAXTrustedCheckOptionPrompt er en statisk CFString,
                // som ApplicationServices ejer.
                let key: &CFString = unsafe { &*kAXTrustedCheckOptionPrompt };
                let value = CFBoolean::new(true);
                let dict = CFDictionary::<CFString, CFBoolean>::from_slices(&[key], &[value]);
                let raw: *const CFDictionary =
                    (&*dict as *const CFDictionary<CFString, CFBoolean>).cast();
                if unsafe { AXIsProcessTrustedWithOptions(raw) } {
                    PermissionState::Granted
                } else {
                    PermissionState::Denied
                }
            }
            Permission::ScreenRecording => {
                if objc2_core_graphics::CGRequestScreenCaptureAccess() {
                    PermissionState::Granted
                } else {
                    PermissionState::Denied
                }
            }
            Permission::Automation => {
                open_settings(p);
                PermissionState::Unknown
            }
        }
    }

    pub fn open_settings(p: Permission) -> bool {
        let anchor = match p {
            Permission::Accessibility => "Privacy_Accessibility",
            Permission::ScreenRecording => "Privacy_ScreenCapture",
            Permission::Automation => "Privacy_Automation",
        };
        let url = format!("x-apple.systempreferences:com.apple.preference.security?{anchor}");
        std::process::Command::new("/usr/bin/open")
            .arg(url)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

// Andre systemer og App Store-udgaven (`mas`): intet at bede om. Sandkassen
// har ingen sporing og må aldrig vise macOS' dialoger for tilladelserne.
#[cfg(any(not(target_os = "macos"), feature = "mas"))]
mod imp {
    use super::{Permission, PermissionState};

    pub fn state(_p: Permission) -> PermissionState {
        PermissionState::NotRequired
    }

    pub fn request(_p: Permission) -> PermissionState {
        PermissionState::NotRequired
    }

    pub fn open_settings(_p: Permission) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_permission_has_danish_copy() {
        for p in Permission::ALL {
            let s = p.status();
            assert!(!s.title.is_empty());
            assert!(s.explanation.len() > 40);
            assert!(s.without.starts_with("Uden"));
            assert!(!s.explanation.to_lowercase().contains("klient"));
        }
    }

    /// App Store-udgaven beder aldrig om tilladelser og åbner ikke
    /// Systemindstillinger.
    #[cfg(feature = "mas")]
    #[test]
    fn mas_requires_no_permissions() {
        for p in Permission::ALL {
            assert_eq!(p.state(), PermissionState::NotRequired);
            assert_eq!(p.request(), PermissionState::NotRequired);
            assert!(!p.open_settings());
        }
    }

    #[test]
    fn state_does_not_prompt_or_panic() {
        // state() må aldrig vise dialoger; den kaldes ved hver opstart.
        for p in Permission::ALL {
            let _ = p.state();
        }
        let _ = capture_ready();
    }
}
