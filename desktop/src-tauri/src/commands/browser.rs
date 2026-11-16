use crate::i18n;
use crate::tracker::browser_bridge::{BrowserBridge, BrowserExtensionStatus};
use tauri::Manager;

/// Register native messaging host manifests for Chrome, Edge, and Firefox.
/// This enables the TimeTrack browser extension to communicate with the desktop app.
#[tauri::command]
pub fn register_browser_extension(app: tauri::AppHandle) -> Result<String, String> {
    // Get the path to the current executable
    let exe_path = std::env::current_exe()
        .map_err(|e| i18n::t_fmt("browser.couldNotFindExe", &[&e.to_string()]))?;

    let app_exe_path = exe_path
        .to_str()
        .ok_or_else(|| i18n::t("browser.invalidExePath"))?;

    // Get the app data directory for storing manifest files
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| i18n::t_fmt("browser.couldNotFindAppData", &[&e.to_string()]))?;

    BrowserBridge::register_manifests(app_exe_path, &app_data_dir)
}

/// Check whether native messaging host manifests are registered for each browser.
#[tauri::command]
pub fn get_browser_extension_status() -> Result<BrowserExtensionStatus, String> {
    Ok(BrowserBridge::get_status())
}
