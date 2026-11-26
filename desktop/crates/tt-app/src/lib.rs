//! TimeTrack Desktop (den nye app, fra 0.2.23): GPUI-appen.
//!
//! - `brand`: tema (lys/mørk, granskov, Schibsted Grotesk).
//! - `backend`: `Backend`-traitet (UI'ets kopi af tt-data's `Repository`) og `MockBackend`.
//! - `app`: rod-view med navigation, `AppCtx` og genveje.
//! - `screens`: én fil pr. skærm.
//! - `ui`: delte komponenter og danske formater.

// Afløsning af den gamle Tauri-app (proces, exe og autostart).
pub mod afloesning;
// gendan: start ved login som valg.
pub mod autostart;
pub mod app;
pub mod backend;
pub mod brand;
// Pakning: timetrack://-links og én kørende instans.
pub mod deeplink;
// aktfix: `--diagnose-activity` (tal om Aktivitet, intet UI).
pub mod diagnose;
pub mod engine;
// screens-b: PDF, CSV og kroner uden GPUI.
pub mod export;
// D21: genvejsregler (AltGr, konflikter) uden GPUI.
pub mod genveje;
pub mod hotkeys;
// Oversættelseslag (dansk, engelsk).
pub mod i18n;
// Mac App Store-udgaven (feature mas): hvad den lettere udgave kan.
pub mod mas;
// App Store-udgaven: erhvervslicensen som in-app-køb (StoreKit).
pub mod store;
// D21: idle-spørgsmål.
pub mod idle;
// kalender: kalenderkilder, møder og notifikationernes knapper.
pub mod handling;
pub mod kalenderkilder;
pub mod moeder;
pub mod moedekort;
#[cfg(target_os = "macos")]
pub mod notify_mac;
// D21: OS-notifikationer, påmindelser og pomodoro.
pub mod notify;
pub mod paamindelser;
// Pakning: import fra den gamle Tauri-app (0.2.x) ved første start.
pub mod migrate;
pub mod palette;
pub mod pomodoro;
// Integration: vinduets rod (onboarding, deep links, hændelser) og opstart.
pub mod root;
pub mod startup;
pub mod screens;
pub mod timer;
// Baggrundstjenester: pomodoro, påmindelser, adgang og idle-spørgsmål.
pub mod tjenester;
// Pakning: opdateringer via Tauri-updaterens kanal og nøgle.
pub mod updater;
pub mod tray;
pub mod ui;
// ret-win: X skjuler vinduet, appen lever videre i tray/menulinjen.
pub mod vindue;
// Ur der kan skiftes ud i tests (licens, påmindelser, pomodoro).
pub mod ur;
// Afviste registreringer (offline-køens dead-letter): banner og dialog.
pub mod afviste;

#[cfg(feature = "probe")]
pub mod testing;
// screens-b
#[cfg(feature = "probe")]
pub mod testing_b;

use gpui_kit::*;

use crate::root::RootView;

/// Starter appen. `TT_DEMO` (fx `TT_DEMO=1` eller `TT_DEMO=timer`) kører mod
/// `MockBackend` med demodata; ellers åbnes de rigtige data (`startup::real`).
pub fn run() {
    // Kun tal på stdout; før én-instans-lås, afløsning og deep links.
    if diagnose::wanted(std::env::args_os().skip(1)) {
        diagnose::print_activity();
        return;
    }
    // Deep links (timetrack://auth/callback?…) kommer uden for GPUI's
    // kontekst; de sendes videre gennem en kanal og afleveres til roden.
    let (url_tx, url_rx) = async_channel::unbounded::<deeplink::Message>();
    // Startet ved login (installerens Run-nøgle: --autostart): start skjult.
    let hidden = vindue::start_hidden(std::env::args_os().skip(1));
    let argv_urls: Vec<_> = deeplink::urls_from_args(std::env::args().skip(1))
        .into_iter()
        .map(deeplink::Message::Url)
        .collect();
    // Windows starter en ny proces for hvert link. Kører appen allerede, får
    // den linket, og denne proces slutter. macOS klarer det selv.
    let _instance = if single_instance_wanted() {
        let tx = url_tx.clone();
        match deeplink::SingleInstance::claim(
            &backend::services::data_dir(),
            &argv_urls,
            move |m| {
                let _ = tx.send_blocking(m);
            },
        ) {
            Ok(deeplink::Claim::Forwarded) => return,
            Ok(deeplink::Claim::Primary(i)) => Some(i),
            Err(e) => {
                eprintln!("TT én-instans-lås: {e}");
                None
            }
        }
    } else {
        None
    };
    #[cfg(target_os = "windows")]
    if std::env::var_os("TT_DEMO").is_none()
        && let Err(e) = deeplink::register_scheme()
    {
        eprintln!("TT kunne ikke registrere {}://: {e}", tt_core::edition::EDITION.url_scheme);
    }
    // Den gamle app må ikke køre samtidig, og autostart skal pege på os.
    // Kun TimeTrack har en gammel 0.2.x-app (Tauri) at afløse, og ikke fra
    // App Store-udgavens sandkasse.
    if std::env::var_os("TT_DEMO").is_none() && mas::LEGACY_APP {
        afloesning::spawn_replace_old_app();
    }
    for m in argv_urls {
        let _ = url_tx.send_blocking(m);
    }
    let app = gpui_kit::application().with_assets(ui::icons::Assets);
    app.on_open_urls(move |urls| {
        for u in urls {
            let _ = url_tx.send_blocking(deeplink::Message::Url(u));
        }
    });
    // macOS: klik på Dock-ikonet viser vinduet igen.
    app.on_reopen(vindue::show);
    app.run(move |cx| {
        gpui_kit::init(cx);
        brand::register_fonts(cx);
        app::bind_keys(cx);
        vindue::init(cx);
        // App Store-udgaven: StoreKit-broen, før skærmene observerer den.
        if mas::ENABLED {
            store::install(cx);
        }
        // TT_WINDOW_WIDTH: smalle vinduer til skærmbilleder (UX-runden).
        let width = std::env::var("TT_WINDOW_WIDTH")
            .ok()
            .and_then(|w| w.parse::<f32>().ok())
            .unwrap_or(1200.)
            .max(900.);
        // `TT_WINDOW_SIZE=1200x1900`: også højden, til skærmbilleder af lange skærme.
        let (w, h) = std::env::var("TT_WINDOW_SIZE")
            .ok()
            .and_then(|v| {
                let (w, h) = v.split_once('x')?;
                Some((w.parse().ok()?, h.parse().ok()?))
            })
            .unwrap_or((width, 800.));
        let bounds = Bounds::centered(None, size(px(w), px(h)), cx);
        let opts = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            window_min_size: Some(size(px(900.), px(600.))),
            titlebar: Some(TitlebarOptions {
                title: Some(tt_core::edition::EDITION.name.into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let startup = startup::build();
        // Afslutning (Cmd+Q, Afslut i trayen, log ud, sluk): gem det
        // igangværende segment, før processen slutter.
        if let Some(stop) = startup.on_quit.clone() {
            cx.on_app_quit(move |_| {
                stop();
                async {}
            })
            .detach();
        }
        // Onboarding skal ses; ellers skjult ved autostart.
        let hidden = hidden && !startup.needs_onboarding();
        // screens-b: TT_SCREEN=onboarding viser onboarding alene (skærmbilleder).
        if std::env::var("TT_SCREEN").as_deref() == Ok("onboarding") {
            let backend = startup.backend.clone();
            gpui_kit::open_window(opts, cx, |window, cx| {
                let view = screens::onboarding::standalone(backend, window, cx);
                #[cfg(feature = "shots")]
                shots::schedule(window, cx);
                #[cfg(not(feature = "shots"))]
                exit_after_first_frame(window);
                view
            })
            .expect("vindue");
            cx.activate(true);
            return;
        }
        let opts = WindowOptions {
            show: !hidden,
            focus: !hidden,
            ..opts
        };
        let (_, root) = gpui_kit::open_window(opts, cx, |window, cx| {
            vindue::install(window, cx);
            let view = cx.new(|cx| RootView::new(&startup, window, cx));
            #[cfg(feature = "shots")]
            shots::schedule(window, cx);
            #[cfg(not(feature = "shots"))]
            exit_after_first_frame(window);
            view
        })
        .expect("vindue");
        root::bridge_events(&startup, cx);
        if hidden {
            vindue::mark_hidden(cx);
            // Uden tray er der ingen vej til vinduet på Windows: vis det.
            if vindue::on_close(tray::is_installed(cx), cfg!(target_os = "macos"))
                == vindue::OnClose::Quit
            {
                vindue::show(cx);
            }
        }
        let root = root.downgrade();
        cx.spawn(async move |cx| {
            while let Ok(m) = url_rx.recv().await {
                match m {
                    deeplink::Message::Url(url) => {
                        let _ = root.update(cx, |r, cx| r.open_url(&url, cx));
                    }
                    deeplink::Message::Activate => {}
                }
                // En anden start eller et link bringer vinduet frem (også skjult).
                cx.update(vindue::show);
            }
        })
        .detach();
        if !hidden {
            cx.activate(true);
        }
    });
}

/// Én kørende instans på Windows (og på macOS med `TT_SINGLE_INSTANCE=1`, til
/// test). Demodata, skærmbilleder og røgtest kører altid for sig selv.
fn single_instance_wanted() -> bool {
    let off = std::env::var_os("TT_DEMO").is_some()
        || std::env::var_os("TT_SHOT").is_some()
        || std::env::var_os("TT_EXIT_AFTER_FIRST_FRAME").is_some();
    !off && (cfg!(target_os = "windows") || std::env::var_os("TT_SINGLE_INSTANCE").is_some())
}

/// `TT_EXIT_AFTER_FIRST_FRAME=1`: luk efter første frame (røgtest fra scripts).
#[cfg(not(feature = "shots"))]
fn exit_after_first_frame(window: &mut Window) {
    if std::env::var("TT_EXIT_AFTER_FIRST_FRAME").is_ok() {
        window.on_next_frame(|_, cx| {
            eprintln!("TT first_frame");
            cx.quit();
        });
    }
}

/// Skærmbilleder via `render_to_image`, så de virker med låst skærm.
/// `TT_SHOT=sti.png` (og evt. `TT_SHOT_DELAY_MS`) tager ét billede og lukker appen.
#[cfg(feature = "shots")]
mod shots {
    use gpui_kit::*;

    pub fn schedule(window: &mut Window, cx: &mut App) {
        let Ok(path) = std::env::var("TT_SHOT") else {
            return;
        };
        let delay = std::env::var("TT_SHOT_DELAY_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1500);
        let handle = window.window_handle();
        cx.spawn(async move |cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(delay))
                .await;
            let _ = cx.update_window(handle, |_, window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                match window.render_to_image() {
                    Ok(img) => {
                        img.save(&path).expect("gem png");
                        eprintln!("TT shot {path}");
                    }
                    Err(e) => eprintln!("TT shot-fejl {e}"),
                }
                cx.quit();
            });
        })
        .detach();
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe;

// kalender: idle-dialogens fire valg, mødekortet og Indstillinger → Kalender.
#[cfg(all(test, feature = "probe"))]
mod moedekort_probe;
// ret-win: fund fra testen på Windows 11.
#[cfg(all(test, feature = "probe"))]
mod probe_win;
// Opdateringspanelet findes ikke i App Store-udgaven.
#[cfg(all(test, feature = "probe", not(feature = "mas")))]
mod probe_opdatering;
// UX-runden 0.2.28: sidemenuen, der kan minimeres.
#[cfg(all(test, feature = "probe"))]
mod probe_design;
