//! Hovedvinduet lever videre i baggrunden.
//!
//! Lukkes vinduet (X, Alt+F4, den røde knap eller Cmd+W), skjules det, og
//! appen kører videre i tray/menulinjen: sporing, timer, påmindelser og
//! genveje fortsætter. "Vis TimeTrack" i trayen (eller en ny start, et
//! link, Dock-ikonet) viser det igen. Kun "Afslut" (tray, Cmd+Q) afslutter.
//!
//! Før lukkede X hele processen på Windows, fordi GPUI som standard
//! afslutter, når det sidste vindue lukkes (`QuitMode::Default`).
//!
//! Startes appen ved login (`--autostart`, som installerens Run-nøgle
//! sætter; `--hidden` virker også), åbnes vinduet skjult.

use std::ffi::OsStr;

use gpui_kit::*;

use crate::i18n::t;

actions!(timetrack, [LukVindue, Afslut]);

/// Argumenterne, der starter appen skjult i tray/menulinjen.
pub const AUTOSTART_ARGS: [&str; 2] = [crate::afloesning::AUTOSTART_ARG, "--hidden"];

/// Er appen startet af OS'et ved login (skal starte skjult)?
pub fn start_hidden<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    args.into_iter()
        .any(|a| AUTOSTART_ARGS.iter().any(|f| a.as_ref() == OsStr::new(f)))
}

/// Hvad et klik på X gør.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnClose {
    /// Skjul vinduet; appen lever videre i tray/menulinjen.
    Hide,
    /// Afslut: der er intet sted at vise vinduet fra igen.
    Quit,
}

/// Skjul kun, når brugeren kan komme tilbage: med en tray, eller på macOS,
/// hvor Dock-ikonet altid viser vinduet igen.
pub fn on_close(tray: bool, macos: bool) -> OnClose {
    if tray || macos {
        OnClose::Hide
    } else {
        OnClose::Quit
    }
}

/// Hovedvinduet og om det er skjult af os.
struct MainWindow {
    handle: AnyWindowHandle,
    hidden: bool,
}
impl Global for MainWindow {}

fn main_mut(cx: &mut App) -> Option<&mut MainWindow> {
    cx.has_global::<MainWindow>()
        .then(|| cx.global_mut::<MainWindow>())
}

/// Kaldes én gang ved opstart (før vinduet åbnes): afslut kun på
/// opfordring, genveje og macOS-menuen.
pub fn init(cx: &mut App) {
    cx.set_quit_mode(QuitMode::Explicit);
    cx.on_action(|_: &Afslut, cx| cx.quit());
    cx.on_action(|_: &LukVindue, cx| {
        // Handlingen kommer under dispatch i vinduet; skjul bagefter.
        cx.defer(hide_main);
    });
    #[cfg(target_os = "macos")]
    {
        cx.bind_keys([
            KeyBinding::new("cmd-w", LukVindue, None),
            KeyBinding::new("cmd-q", Afslut, None),
        ]);
        cx.set_menus([Menu::new("TimeTrack").items([
            MenuItem::action(t("app.vindue.luk"), LukVindue),
            MenuItem::separator(),
            MenuItem::action(t("tray.menu.quit"), Afslut),
        ])]);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = t;
}

/// Gør `window` til hovedvinduet: X skjuler det i stedet for at lukke.
pub fn install(window: &mut Window, cx: &mut App) {
    cx.set_global(MainWindow {
        handle: window.window_handle(),
        hidden: false,
    });
    window.on_window_should_close(cx, |window, cx| {
        match on_close(crate::tray::is_installed(cx), cfg!(target_os = "macos")) {
            OnClose::Hide => {
                hide(window, cx);
                false
            }
            OnClose::Quit => {
                cx.quit();
                true
            }
        }
    });
}

/// Markér hovedvinduet som skjult fra start (`--autostart`).
pub fn mark_hidden(cx: &mut App) {
    if let Some(m) = main_mut(cx) {
        m.hidden = true;
    }
}

/// Er hovedvinduet skjult af os (luk, Cmd+W eller `--autostart`)?
pub fn is_hidden(cx: &App) -> bool {
    cx.try_global::<MainWindow>().is_some_and(|m| m.hidden)
}

fn hide_main(cx: &mut App) {
    let Some(handle) = cx.try_global::<MainWindow>().map(|m| m.handle) else {
        return;
    };
    let _ = handle.update(cx, |_, window, cx| hide(window, cx));
}

fn hide(window: &mut Window, cx: &mut App) {
    if let Some(m) = main_mut(cx) {
        m.hidden = true;
    }
    platform::hide(window, cx);
}

/// Vis hovedvinduet igen og bring det frem (tray, ny start, link, Dock).
pub fn show(cx: &mut App) {
    let Some(handle) = main_mut(cx).map(|m| {
        m.hidden = false;
        m.handle
    }) else {
        return;
    };
    let _ = handle.update(cx, |_, window, _| {
        platform::show(window);
        window.activate_window();
    });
    platform::activate(cx);
}

/// Platformskaldene. I tests (GPUI's testplatform har ingen `hide`) gøres intet.
#[cfg(not(test))]
mod platform {
    use gpui_kit::{App, Window};

    pub fn activate(cx: &mut App) {
        cx.activate(true);
    }

    /// macOS: skjul appen (vinduet kommer frem igen med Dock, Cmd+Tab og
    /// tray). Windows: skjul vinduet, så det også forsvinder fra proceslinjen.
    pub fn hide(window: &mut Window, cx: &mut App) {
        #[cfg(target_os = "macos")]
        {
            let _ = window;
            cx.hide();
        }
        #[cfg(target_os = "windows")]
        {
            let _ = cx;
            win32::show_window(window, false);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = cx;
            window.minimize_window();
        }
    }

    pub fn show(window: &mut Window) {
        #[cfg(target_os = "windows")]
        win32::show_window(window, true);
        #[cfg(not(target_os = "windows"))]
        let _ = window;
    }

    #[cfg(target_os = "windows")]
    mod win32 {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        const SW_HIDE: i32 = 0;
        const SW_SHOW: i32 = 5;

        #[link(name = "user32")]
        unsafe extern "system" {
            fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
        }

        /// GPUI har ingen skjul/vis af ét vindue på Windows (kun minimér).
        pub fn show_window(window: &gpui_kit::Window, visible: bool) {
            // Ikke `Window::window_handle` (GPUI-håndtaget), men raw-window-handle.
            let Ok(handle) = HasWindowHandle::window_handle(window) else {
                return;
            };
            if let RawWindowHandle::Win32(h) = handle.as_raw() {
                // SAFETY: HWND'et tilhører vores eget, levende vindue.
                unsafe {
                    ShowWindow(h.hwnd.get(), if visible { SW_SHOW } else { SW_HIDE });
                }
            }
        }
    }
}

#[cfg(test)]
mod platform {
    use gpui_kit::{App, Window};

    pub fn activate(_: &mut App) {}
    pub fn hide(_: &mut Window, _: &mut App) {}
    pub fn show(_: &mut Window) {}
}

#[cfg(test)]
mod tests {
    use super::{OnClose, on_close, start_hidden};

    #[test]
    fn autostart_argumenter() {
        assert!(start_hidden(["--autostart"]));
        assert!(start_hidden(["timetrack://auth/callback", "--hidden"]));
        assert!(!start_hidden(["timetrack://auth/callback"]));
        assert!(!start_hidden(Vec::<String>::new()));
        assert!(!start_hidden(["--autostarten"]));
    }

    #[test]
    fn x_skjuler_kun_med_vej_tilbage() {
        assert_eq!(on_close(true, false), OnClose::Hide, "Windows med tray");
        assert_eq!(on_close(false, false), OnClose::Quit, "Windows uden tray");
        assert_eq!(on_close(false, true), OnClose::Hide, "macOS har Dock");
        assert_eq!(on_close(true, true), OnClose::Hide);
    }
}
