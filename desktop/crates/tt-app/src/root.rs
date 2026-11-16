//! Vinduets rod: onboarding ved første start, derefter app-roden.
//!
//! Roden tager også imod deep links (`timetrack://auth?code=…&state=…`) fra
//! OS'et og sender dem til onboarding, og den kobler datalagets og
//! detektionens hændelser på `AppCtx`, så alle skærme, trayen og paletten
//! opdaterer sig ved ændringer fra web eller trackeren.

use std::path::PathBuf;
use std::sync::Arc;

use gpui_kit::*;

use crate::app::{AppCtx, AppView};
use crate::backend::Backend;
use crate::backend::repo::Notice;
use crate::backend::services::{ChangeRx, IdleRx};
use crate::deeplink::{self, Route};
use crate::screens::onboarding::{OnboardingDone, OnboardingView};
use crate::{brand, hotkeys, tjenester, tray};

/// Det, appen starter med.
pub struct Startup {
    pub backend: Arc<dyn Backend>,
    /// Signaler om ændrede data (tt-data's hændelser, nye forslag).
    pub changes: Vec<ChangeRx>,
    /// Danske beskeder til brugeren (fx "Du er logget ud").
    pub notices: Option<async_channel::Receiver<Notice>>,
    /// Markørfil for gennemført onboarding. `None` = vis aldrig onboarding.
    pub onboarded_marker: Option<PathBuf>,
    /// Trackerens idle-signal (brugeren er tilbage efter en lang pause).
    pub idle: Option<IdleRx>,
    /// Besked om overgangen fra 0.2.x, vist i onboardingen (`migrate`).
    pub migration_notice: Option<String>,
    /// Køres, når appen afsluttes (Cmd+Q, Afslut i trayen, log ud): gemmer
    /// det igangværende aktivitetssegment.
    pub on_quit: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Startup {
    pub fn needs_onboarding(&self) -> bool {
        self.onboarded_marker.as_ref().is_some_and(|p| !p.exists())
    }
}

pub struct RootView {
    backend: Arc<dyn Backend>,
    onboarding: Option<Entity<OnboardingView>>,
    app: Option<Entity<AppView>>,
    marker: Option<PathBuf>,
    idle: Option<IdleRx>,
    _subs: Vec<Subscription>,
}

impl RootView {
    pub fn new(startup: &Startup, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut this = RootView {
            backend: startup.backend.clone(),
            onboarding: None,
            app: None,
            marker: startup.onboarded_marker.clone(),
            idle: startup.idle.clone(),
            _subs: vec![],
        };
        if startup.needs_onboarding() {
            brand::apply(brand::is_dark(brand::chosen(&*startup.backend), window), cx);
            let ctx = AppCtx::new(startup.backend.clone(), cx);
            cx.set_global(ctx.clone());
            let notice = startup.migration_notice.clone();
            let ob = cx.new(|cx| {
                let mut ob = OnboardingView::new(ctx, window, cx);
                ob.set_migration_notice(notice, cx);
                ob
            });
            this._subs.push(cx.subscribe_in(
                &ob,
                window,
                |this, _, _: &OnboardingDone, window, cx| {
                    this.finish_onboarding(window, cx);
                },
            ));
            this.onboarding = Some(ob);
        } else {
            this.open_app(window, cx);
        }
        this
    }

    fn open_app(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let backend = self.backend.clone();
        let app = cx.new(|cx| AppView::new(backend, window, cx));
        self.app = Some(app);
        // Trayen og de globale genveje bruger app-rodens `AppCtx`.
        tray::install(AppCtx::global(cx), cx);
        hotkeys::install(AppCtx::global(cx), cx);
        // Pomodoro, påmindelser, licens-tjek og idle-spørgsmålet.
        tjenester::install(AppCtx::global(cx), self.idle.take(), cx);
        crate::screens::opdatering::UpdatePanel::install(AppCtx::global(cx), cx);
    }

    fn finish_onboarding(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(m) = &self.marker {
            if let Some(dir) = m.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Err(e) = std::fs::write(m, b"1\n") {
                eprintln!("TT kunne ikke gemme onboarding-markør: {e}");
            }
        }
        self.onboarding = None;
        self.open_app(window, cx);
        cx.notify();
    }

    /// Deep link fra OS'et. Kun onboarding venter på login-linket.
    pub fn open_url(&mut self, url: &str, cx: &mut Context<Self>) {
        match (deeplink::route(url), &self.onboarding) {
            (Route::AuthCallback(url), Some(ob)) => {
                ob.update(cx, |ob, cx| ob.receive_callback(&url, cx))
            }
            (Route::AuthCallback(_), None) => {
                eprintln!("TT login-link ignoreret (ingen login i gang)")
            }
            (Route::Activate, _) => {}
            // kalender: knapper i notifikationer (Windows-toast → deep link).
            (Route::Action(a), None) => crate::app::perform_action(Some(a), cx),
            (Route::Action(_), Some(_)) => eprintln!("TT handling ignoreret under onboarding"),
            (Route::Unknown, _) => eprintln!("TT ukendt link ignoreret"),
        }
    }

    pub fn is_onboarding(&self) -> bool {
        self.onboarding.is_some()
    }

    pub fn app_view(&self) -> Option<&Entity<AppView>> {
        self.app.as_ref()
    }
}

impl Render for RootView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let content: AnyView = match (&self.onboarding, &self.app) {
            (Some(ob), _) => ob.clone().into(),
            (None, Some(app)) => app.clone().into(),
            (None, None) => return div().size_full().into_any_element(),
        };
        div().size_full().child(content).into_any_element()
    }
}

/// Læs hændelseskanalerne og giv den aktuelle `AppCtx` besked. Tasken lever,
/// så længe kanalerne er åbne.
pub fn bridge_events(startup: &Startup, cx: &mut App) {
    for rx in &startup.changes {
        let rx = rx.clone();
        cx.spawn(async move |cx| {
            while rx.recv().await.is_ok() {
                // Saml en byge af signaler til én genindlæsning.
                while rx.try_recv().is_ok() {}
                cx.update(|cx| {
                    if cx.has_global::<AppCtx>() {
                        AppCtx::global(cx).changed(cx);
                    }
                });
            }
        })
        .detach();
    }
    if let Some(rx) = startup.notices.clone() {
        cx.spawn(async move |cx| {
            while let Ok(msg) = rx.recv().await {
                cx.update(|cx| {
                    if cx.has_global::<AppCtx>() {
                        AppCtx::global(cx).notify_user(msg.text, cx);
                    }
                });
            }
        })
        .detach();
    }
}
