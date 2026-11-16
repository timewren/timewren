use crate::i18n;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_timer =
        MenuItem::with_id(app, "toggle_timer", i18n::t("tray.startTimer"), true, None::<&str>)?;
    let pause_tracking =
        MenuItem::with_id(app, "pause_tracking", i18n::t("tray.pauseTracking"), true, None::<&str>)?;
    let open_timeline =
        MenuItem::with_id(app, "open_timeline", i18n::t("tray.openTimeline"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let daily_total =
        MenuItem::with_id(app, "daily_total", i18n::t("tray.dailyTotal"), false, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let settings =
        MenuItem::with_id(app, "settings", i18n::t("tray.settings"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", i18n::t("tray.quit"), true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_timer,
            &pause_tracking,
            &open_timeline,
            &sep1,
            &daily_total,
            &sep2,
            &settings,
            &quit,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::new()
        .tooltip("TimeTrack")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "toggle_timer" => {
                    let _ = app.emit("toggle-timer", ());
                }
                "pause_tracking" => {
                    let _ = app.emit("toggle-tracking", ());
                }
                "open_timeline" => {
                    show_main_window(app);
                    let _ = app.emit("navigate", "/timeline");
                }
                "settings" => {
                    show_main_window(app);
                    let _ = app.emit("navigate", "/settings");
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_window(app);
            }
        });

    // Only set an icon if one is embedded; otherwise build a menu-only tray
    // rather than panicking on a missing default window icon.
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    // On macOS, use a dedicated monochrome (black + alpha) glyph and mark it as
    // a template image so the system tints it automatically to match the
    // light/dark menubar (black on light, white on dark). The colored window
    // icon set above would otherwise be desaturated to a muddy luminance blob.
    #[cfg(target_os = "macos")]
    {
        if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray-template.png"
        )) {
            tray_builder = tray_builder.icon(icon);
        }
        tray_builder = tray_builder.icon_as_template(true);
    }

    let _tray = tray_builder.build(app)?;

    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
