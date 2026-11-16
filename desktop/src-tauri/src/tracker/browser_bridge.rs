use crate::i18n;
use serde::{Deserialize, Serialize};

/// Native messaging host name used for browser extension communication.
const HOST_NAME: &str = "dk.timetrack.desktop";

/// Browser extension ID for Chrome Web Store.
const CHROME_EXTENSION_ID: &str = "chrome-extension://timetrack-desktop/";

/// Browser extension ID for Firefox Add-ons.
const FIREFOX_EXTENSION_ID: &str = "timetrack@timetrack.dk";

/// Status of native messaging host registration for each browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserExtensionStatus {
    pub chrome: bool,
    pub edge: bool,
    pub firefox: bool,
}

/// Represents the native messaging host manifest JSON.
#[derive(Debug, Serialize)]
struct NativeMessagingManifest {
    name: String,
    description: String,
    path: String,
    #[serde(rename = "type")]
    host_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    allowed_origins: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allowed_extensions: Option<Vec<String>>,
}

/// Helper to get the user's home directory without external crates.
#[cfg(not(target_os = "windows"))]
fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(std::path::PathBuf::from)
}

pub struct BrowserBridge;

impl BrowserBridge {
    /// Register native messaging host manifests for Chrome, Edge, and Firefox.
    ///
    /// On Windows this writes registry keys and JSON manifest files.
    /// On macOS this writes manifest files to the appropriate directories.
    pub fn register_manifests(
        app_exe_path: &str,
        app_data_dir: &std::path::Path,
    ) -> Result<String, String> {
        let manifest_dir = app_data_dir.join("native-messaging");
        std::fs::create_dir_all(&manifest_dir)
            .map_err(|e| i18n::t_fmt("browser.couldNotCreateManifestDir", &[&e.to_string()]))?;

        let mut registered = Vec::new();

        // Chrome manifest
        match Self::register_chrome(app_exe_path, &manifest_dir) {
            Ok(_) => registered.push("Chrome"),
            Err(e) => eprintln!("Chrome registration failed: {}", e),
        }

        // Edge manifest (same format as Chrome)
        match Self::register_edge(app_exe_path, &manifest_dir) {
            Ok(_) => registered.push("Edge"),
            Err(e) => eprintln!("Edge registration failed: {}", e),
        }

        // Firefox manifest
        match Self::register_firefox(app_exe_path, &manifest_dir) {
            Ok(_) => registered.push("Firefox"),
            Err(e) => eprintln!("Firefox registration failed: {}", e),
        }

        if registered.is_empty() {
            Err(i18n::t("browser.couldNotRegister"))
        } else {
            Ok(i18n::t_fmt("browser.registeredFor", &[&registered.join(", ")]))
        }
    }

    /// Check which browsers have the native messaging host registered.
    pub fn get_status() -> BrowserExtensionStatus {
        BrowserExtensionStatus {
            chrome: Self::is_chrome_registered(),
            edge: Self::is_edge_registered(),
            firefox: Self::is_firefox_registered(),
        }
    }

    // --- Chrome ---

    fn chrome_manifest(app_exe_path: &str) -> NativeMessagingManifest {
        NativeMessagingManifest {
            name: HOST_NAME.to_string(),
            description: "TimeTrack Desktop native messaging host".to_string(),
            path: app_exe_path.to_string(),
            host_type: "stdio".to_string(),
            allowed_origins: Some(vec![CHROME_EXTENSION_ID.to_string()]),
            allowed_extensions: None,
        }
    }

    #[cfg(target_os = "windows")]
    fn register_chrome(app_exe_path: &str, manifest_dir: &std::path::Path) -> Result<(), String> {
        let manifest_path = manifest_dir.join("chrome-manifest.json");
        let manifest = Self::chrome_manifest(app_exe_path);
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        std::fs::write(&manifest_path, json).map_err(|e| e.to_string())?;

        Self::write_registry_key(
            r"Software\Google\Chrome\NativeMessagingHosts",
            HOST_NAME,
            &manifest_path.to_string_lossy(),
        )
    }

    #[cfg(not(target_os = "windows"))]
    fn register_chrome(app_exe_path: &str, manifest_dir: &std::path::Path) -> Result<(), String> {
        let manifest = Self::chrome_manifest(app_exe_path);
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;

        let home = home_dir().ok_or(&i18n::t("browser.couldNotFindHome"))?;
        let manifest_path = if cfg!(target_os = "macos") {
            home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        } else {
            home.join(".config/google-chrome/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        };

        if let Some(parent) = manifest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&manifest_path, json).map_err(|e| e.to_string())?;
        let _ = manifest_dir;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn is_chrome_registered() -> bool {
        Self::check_registry_key(r"Software\Google\Chrome\NativeMessagingHosts", HOST_NAME)
    }

    #[cfg(not(target_os = "windows"))]
    fn is_chrome_registered() -> bool {
        let home = match home_dir() {
            Some(h) => h,
            None => return false,
        };
        let path = if cfg!(target_os = "macos") {
            home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        } else {
            home.join(".config/google-chrome/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        };
        path.exists()
    }

    // --- Edge ---

    fn edge_manifest(app_exe_path: &str) -> NativeMessagingManifest {
        NativeMessagingManifest {
            name: HOST_NAME.to_string(),
            description: "TimeTrack Desktop native messaging host".to_string(),
            path: app_exe_path.to_string(),
            host_type: "stdio".to_string(),
            allowed_origins: Some(vec![CHROME_EXTENSION_ID.to_string()]),
            allowed_extensions: None,
        }
    }

    #[cfg(target_os = "windows")]
    fn register_edge(app_exe_path: &str, manifest_dir: &std::path::Path) -> Result<(), String> {
        let manifest_path = manifest_dir.join("edge-manifest.json");
        let manifest = Self::edge_manifest(app_exe_path);
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        std::fs::write(&manifest_path, json).map_err(|e| e.to_string())?;

        Self::write_registry_key(
            r"Software\Microsoft\Edge\NativeMessagingHosts",
            HOST_NAME,
            &manifest_path.to_string_lossy(),
        )
    }

    #[cfg(not(target_os = "windows"))]
    fn register_edge(app_exe_path: &str, manifest_dir: &std::path::Path) -> Result<(), String> {
        let manifest = Self::edge_manifest(app_exe_path);
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;

        let home = home_dir().ok_or(&i18n::t("browser.couldNotFindHome"))?;
        let manifest_path = if cfg!(target_os = "macos") {
            home.join("Library/Application Support/Microsoft Edge/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        } else {
            home.join(".config/microsoft-edge/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        };

        if let Some(parent) = manifest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&manifest_path, json).map_err(|e| e.to_string())?;
        let _ = manifest_dir;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn is_edge_registered() -> bool {
        Self::check_registry_key(r"Software\Microsoft\Edge\NativeMessagingHosts", HOST_NAME)
    }

    #[cfg(not(target_os = "windows"))]
    fn is_edge_registered() -> bool {
        let home = match home_dir() {
            Some(h) => h,
            None => return false,
        };
        let path = if cfg!(target_os = "macos") {
            home.join("Library/Application Support/Microsoft Edge/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        } else {
            home.join(".config/microsoft-edge/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        };
        path.exists()
    }

    // --- Firefox ---

    fn firefox_manifest(app_exe_path: &str) -> NativeMessagingManifest {
        NativeMessagingManifest {
            name: HOST_NAME.to_string(),
            description: "TimeTrack Desktop native messaging host".to_string(),
            path: app_exe_path.to_string(),
            host_type: "stdio".to_string(),
            allowed_origins: None,
            allowed_extensions: Some(vec![FIREFOX_EXTENSION_ID.to_string()]),
        }
    }

    #[cfg(target_os = "windows")]
    fn register_firefox(app_exe_path: &str, manifest_dir: &std::path::Path) -> Result<(), String> {
        let manifest_path = manifest_dir.join("firefox-manifest.json");
        let manifest = Self::firefox_manifest(app_exe_path);
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        std::fs::write(&manifest_path, json).map_err(|e| e.to_string())?;

        Self::write_registry_key(
            r"Software\Mozilla\NativeMessagingHosts",
            HOST_NAME,
            &manifest_path.to_string_lossy(),
        )
    }

    #[cfg(not(target_os = "windows"))]
    fn register_firefox(app_exe_path: &str, manifest_dir: &std::path::Path) -> Result<(), String> {
        let manifest = Self::firefox_manifest(app_exe_path);
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;

        let home = home_dir().ok_or(&i18n::t("browser.couldNotFindHome"))?;
        let manifest_path = if cfg!(target_os = "macos") {
            home.join("Library/Application Support/Mozilla/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        } else {
            home.join(".mozilla/native-messaging-hosts")
                .join(format!("{}.json", HOST_NAME))
        };

        if let Some(parent) = manifest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&manifest_path, json).map_err(|e| e.to_string())?;
        let _ = manifest_dir;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn is_firefox_registered() -> bool {
        Self::check_registry_key(r"Software\Mozilla\NativeMessagingHosts", HOST_NAME)
    }

    #[cfg(not(target_os = "windows"))]
    fn is_firefox_registered() -> bool {
        let home = match home_dir() {
            Some(h) => h,
            None => return false,
        };
        let path = if cfg!(target_os = "macos") {
            home.join("Library/Application Support/Mozilla/NativeMessagingHosts")
                .join(format!("{}.json", HOST_NAME))
        } else {
            home.join(".mozilla/native-messaging-hosts")
                .join(format!("{}.json", HOST_NAME))
        };
        path.exists()
    }

    // --- Windows registry helpers ---

    #[cfg(target_os = "windows")]
    fn write_registry_key(subkey: &str, name: &str, manifest_path: &str) -> Result<(), String> {
        use crate::util::CommandExtHidden;
        let full_key = format!(r"{}\{}", subkey, name);
        let output = std::process::Command::new("reg")
            .hidden_console()
            .args([
                "add",
                &format!(r"HKCU\{}", full_key),
                "/ve",
                "/t",
                "REG_SZ",
                "/d",
                manifest_path,
                "/f",
            ])
            .output()
            .map_err(|e| i18n::t_fmt("browser.couldNotRunReg", &[&e.to_string()]))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(i18n::t_fmt("browser.registryError", &[&stderr]))
        }
    }

    #[cfg(target_os = "windows")]
    fn check_registry_key(subkey: &str, name: &str) -> bool {
        use crate::util::CommandExtHidden;
        let full_key = format!(r"HKCU\{}\{}", subkey, name);
        std::process::Command::new("reg")
            .hidden_console()
            .args(["query", &full_key, "/ve"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
