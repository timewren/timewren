//! App-roden: navigation til venstre, den aktive skærm til højre, og den
//! delte `AppCtx`, som alle skærme får.

use std::collections::HashMap;
use std::sync::Arc;

use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::backend::licens::Access;
use crate::backend::{self, Backend, Mode};
use crate::brand::{self, brand};
use crate::i18n::{t, tf};
use crate::idle::{IdleChoice, IdlePrompt, IdleQueue};
use crate::palette::{self, PaletteCmd};
use crate::screens::hjem::HjemScreen;
use crate::screens::{self, Screen};
use crate::timer;
use crate::ui::{self, Picker, PickerEvent};
use gpui_kit::component::Sizable;
use gpui_kit::component::button::{Button, ButtonVariants};

actions!(
    timetrack,
    [
        GaTilHjem,
        GaTilKalender,
        GaTilAktivitet,
        GaTilKunder,
        GaTilProjekter,
        GaTilKlippekort,
        GaTilOpgaver,
        GaTilFakturaer,
        GaTilRapporter,
        GaTilIndstillinger,
        AabnPalet,
        StartPauseTimer,
        StopTimer,
        LukDagen,
        SkiftMenu,
    ]
);

/// Tæller, der stiger hver gang data er ændret (af en skærm, timeren eller
/// web via SSE). Skærme lytter med `cx.observe(&ctx.hub, …)` og genindlæser.
pub struct DataHub {
    pub revision: u64,
    /// Besked til brugeren (fejl fra tray, genveje, palet). Vises af `AppView`.
    pub notice: Option<SharedString>,
    /// Hvad licensen eller planen tillader (opdateres af `tjenester`).
    pub access: Access,
    /// Spørgsmålene efter en lang pause, mens en timer kørte. Det første
    /// vises; flere pauser for samme timer lægges sammen (se `IdleQueue`).
    pub idle: IdleQueue,
    /// Pomodoro-linjen ('Arbejde 12:34 · runde 2 af 4'), hvis den er slået til.
    pub pomodoro: Option<String>,
    /// En timer kører eller er på pause (til banneret ved låst adgang).
    pub timer_active: bool,
    /// Møder, der er slut og venter på svar (kalender, `moedekort`).
    pub meetings: Vec<crate::kalenderkilder::PendingMeeting>,
}

/// Det, alle skærme deler. Billig at klone.
#[derive(Clone)]
pub struct AppCtx {
    pub backend: Arc<dyn Backend>,
    pub hub: Entity<DataHub>,
}

impl Global for AppCtx {}

impl AppCtx {
    pub fn new(backend: Arc<dyn Backend>, cx: &mut App) -> Self {
        let hub = cx.new(|_| DataHub {
            revision: 0,
            notice: None,
            access: Access::Full,
            idle: IdleQueue::default(),
            pomodoro: None,
            timer_active: false,
            meetings: Vec::new(),
        });
        AppCtx { backend, hub }
    }

    /// Den globale kontekst (sat i `AppView::new`). Til tray, palet og genveje.
    pub fn global(cx: &App) -> AppCtx {
        cx.global::<AppCtx>().clone()
    }

    /// Fortæl alle skærme, at data er ændret.
    pub fn changed(&self, cx: &mut App) {
        self.hub.update(cx, |h, cx| {
            h.revision += 1;
            cx.notify();
        });
    }

    /// Vis en besked til brugeren (nederst i vinduet, rolle `Alert`).
    pub fn notify_user(&self, msg: impl Into<SharedString>, cx: &mut App) {
        let msg = msg.into();
        eprintln!("TT besked: {msg}");
        self.hub.update(cx, |h, cx| {
            h.notice = Some(msg);
            cx.notify();
        });
    }

    /// Ændring uden for et view (tray, globale genveje, palet): kører `op` på
    /// background executor; succes giver `changed`, fejl vises med `notify_user`.
    pub fn run<T: Send + 'static>(
        &self,
        cx: &mut App,
        op: impl FnOnce(&dyn Backend) -> backend::Result<T> + Send + 'static,
    ) {
        let me = self.clone();
        let backend = self.backend.clone();
        cx.spawn(async move |cx| {
            let res = cx
                .background_executor()
                .spawn(async move { op(&*backend).map(|_| ()) })
                .await;
            cx.update(|cx| match res {
                Ok(()) => me.changed(cx),
                Err(e) => me.notify_user(e.to_string(), cx),
            });
        })
        .detach();
    }

    /// Kør `query` på background executor og aflevér svaret på UI-tråden.
    /// Viewet får `cx.notify()` bagefter.
    pub fn fetch<V: 'static, T: Send + 'static>(
        &self,
        cx: &mut Context<V>,
        query: impl FnOnce(&dyn Backend) -> backend::Result<T> + Send + 'static,
        done: impl FnOnce(&mut V, backend::Result<T>, &mut Context<V>) + 'static,
    ) {
        let backend = self.backend.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move { query(&*backend) })
                .await;
            let _ = this.update(cx, |view, cx| {
                done(view, res, cx);
                cx.notify();
            });
        })
        .detach();
    }

    /// Som `fetch`, men ved succes får alle skærme besked (`changed`).
    pub fn mutate<V: 'static, T: Send + 'static>(
        &self,
        cx: &mut Context<V>,
        op: impl FnOnce(&dyn Backend) -> backend::Result<T> + Send + 'static,
        done: impl FnOnce(&mut V, backend::Result<T>, &mut Context<V>) + 'static,
    ) {
        let me = self.clone();
        self.fetch(cx, op, move |view, res, cx| {
            let ok = res.is_ok();
            done(view, res, cx);
            if ok {
                me.changed(cx);
            }
        });
    }
}

/// Genvej med Cmd på macOS og Ctrl ellers. `KeyBinding::new` kan ikke selv
/// løse `secondary-` (kræver OS), så det sker ved kompilering.
#[cfg(target_os = "macos")]
macro_rules! sek {
    ($k:literal) => {
        concat!("cmd-", $k)
    };
}
#[cfg(not(target_os = "macos"))]
macro_rules! sek {
    ($k:literal) => {
        concat!("ctrl-", $k)
    };
}
#[allow(unused_imports)]
pub(crate) use sek;

/// Registrerer tastaturgenveje. Kaldes én gang ved opstart.
pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new(sek!("1"), GaTilHjem, None),
        KeyBinding::new(sek!("2"), GaTilKalender, None),
        KeyBinding::new(sek!("3"), GaTilAktivitet, None),
        KeyBinding::new(sek!("4"), GaTilKunder, None),
        KeyBinding::new(sek!("5"), GaTilProjekter, None),
        KeyBinding::new(sek!("6"), GaTilKlippekort, None),
        KeyBinding::new(sek!("7"), GaTilOpgaver, None),
        KeyBinding::new(sek!("8"), GaTilFakturaer, None),
        KeyBinding::new(sek!("9"), GaTilRapporter, None),
        KeyBinding::new(sek!(","), GaTilIndstillinger, None),
        KeyBinding::new(sek!("k"), AabnPalet, None),
        KeyBinding::new(sek!("shift-t"), StartPauseTimer, None),
        KeyBinding::new(sek!("shift-s"), StopTimer, None),
        KeyBinding::new(sek!("\\"), SkiftMenu, None),
        // ⌘\ ligger bag ⌥⇧7 (Mac) og AltGr (Windows) på danske tastaturer.
        KeyBinding::new(sek!("b"), SkiftMenu, None),
    ]);
    fallback_actions(cx);
}

/// App-roden, som genvejene falder tilbage på (sat i `AppView::new`).
struct NavTarget {
    window: AnyWindowHandle,
    app: WeakEntity<AppView>,
}
impl Global for NavTarget {}

/// En knap i en notifikation (Windows via deep link, macOS via
/// `notify_mac`). `None` = klik på selve notifikationen: kom frem.
pub fn perform_action(action: Option<crate::notify::NotifyAction>, cx: &mut App) {
    let Some(target) = cx.try_global::<NavTarget>() else {
        return;
    };
    let (window, app) = (target.window, target.app.clone());
    cx.defer(move |cx| {
        let _ = window.update(cx, |_, w, cx| {
            app.update(cx, |a, cx| a.handle_action(action, w, cx))
        });
    });
}

/// Genveje virker også, når intet har fokus. Forsvinder det fokuserede felt
/// (fx "Ny kunde" → Gem), starter GPUI's dispatch i vinduets rod, og så når
/// handlingen aldrig `AppView`'s lyttere. Globale lyttere kører til sidst i
/// boble-fasen og kun, hvis ingen i vinduet tog handlingen.
fn fallback_actions(cx: &mut App) {
    fn on<A: Action>(
        cx: &mut App,
        f: impl Fn(&mut AppView, &mut Window, &mut Context<AppView>) + Clone + 'static,
    ) {
        cx.on_action(move |_: &A, cx| {
            let Some(target) = cx.try_global::<NavTarget>() else {
                return;
            };
            let (window, app) = (target.window, target.app.clone());
            let f = f.clone();
            // Vinduet er optaget under dispatch; kør bagefter.
            cx.defer(move |cx| {
                let _ = window.update(cx, |_, w, cx| {
                    app.update(cx, |a, cx| {
                        a.focus.focus(w, cx);
                        f(a, w, cx);
                    })
                });
            });
        });
    }
    macro_rules! go {
        ($($action:ty => $screen:expr),* $(,)?) => {
            $(on::<$action>(cx, |a, w, cx| a.navigate($screen, w, cx));)*
        };
    }
    go!(
        GaTilHjem => Screen::Hjem,
        GaTilKalender => Screen::Kalender,
        GaTilAktivitet => Screen::Aktivitet,
        GaTilKunder => Screen::Kunder,
        GaTilProjekter => Screen::Projekter,
        GaTilKlippekort => Screen::Klippekort,
        GaTilOpgaver => Screen::Opgaver,
        GaTilFakturaer => Screen::Fakturaer,
        GaTilRapporter => Screen::Rapporter,
        GaTilIndstillinger => Screen::Indstillinger,
    );
    on::<AabnPalet>(cx, |a, w, cx| a.open_palette(w, cx));
    on::<LukDagen>(cx, |a, w, cx| a.close_day(w, cx));
    on::<SkiftMenu>(cx, |a, w, cx| a.toggle_nav(w, cx));
    on::<StartPauseTimer>(cx, |a, _, cx| timer::toggle(&a.ctx, cx));
    on::<StopTimer>(cx, |a, _, cx| timer::stop(&a.ctx, cx));
}

pub struct AppView {
    pub ctx: AppCtx,
    pub screen: Screen,
    views: HashMap<Screen, AnyView>,
    focus: FocusHandle,
    pub palette: Entity<Picker>,
    pub palette_open: bool,
    palette_cmds: Vec<PaletteCmd>,
    _subs: Vec<Subscription>,
    /// Banner og dialog for afviste registreringer (`afviste.rs`).
    pub afviste: Entity<crate::afviste::AfvisteView>,
    /// Mødekortet og målvælgeren (kalender, `moedekort.rs`).
    pub moeder: Entity<crate::moedekort::MoedeKort>,
    /// Sidemenuen: fuld eller smal (`ui::navstate`).
    pub nav: ui::navstate::NavState,
    /// Igangværende overgang i menuens bredde: (fra, til, nummer).
    nav_anim: Option<(f32, f32, usize)>,
    /// Fokus for hvert punkt i menuen (Tab, pile, Enter).
    pub(crate) nav_focus: Vec<FocusHandle>,
}

impl AppView {
    pub fn new(backend: Arc<dyn Backend>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        brand::apply(brand::is_dark(brand::chosen(&*backend), window), cx);
        let ctx = AppCtx::new(backend, cx);
        cx.set_global(ctx.clone());
        let palette = cx.new(|cx| {
            Picker::new(
                "palet",
                t("nav.palette.title"),
                t("nav.palette.placeholder"),
                window,
                cx,
            )
        });
        let subs = vec![
            cx.observe_window_appearance(window, |this, window, cx| {
                let choice = brand::chosen(&*this.ctx.backend);
                brand::apply(brand::is_dark(choice, window), cx);
                window.refresh();
            }),
            cx.observe(&ctx.hub, |_, _, cx| cx.notify()),
            cx.subscribe_in(&palette, window, Self::on_palette),
        ];
        let start = std::env::var("TT_SCREEN")
            .ok()
            .and_then(|k| Screen::from_key(&k))
            .unwrap_or(Screen::Hjem);
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let afviste = cx.new(|cx| crate::afviste::AfvisteView::new(ctx.clone(), cx));
        let moeder = cx.new(|cx| crate::moedekort::MoedeKort::new(ctx.clone(), window, cx));
        cx.set_global(NavTarget {
            window: window.window_handle(),
            app: cx.weak_entity(),
        });
        let mut this = AppView {
            ctx,
            screen: start,
            views: HashMap::new(),
            focus,
            palette,
            palette_open: false,
            palette_cmds: vec![],
            _subs: subs,
            afviste,
            moeder,
            nav: ui::navstate::NavState::load(),
            nav_anim: None,
            nav_focus: Screen::ALL
                .iter()
                .map(|_| cx.focus_handle().tab_stop(true))
                .collect(),
        };
        this.ensure_view(start, window, cx);
        // TT_DEMO=palet: åbn kommandopaletten (til skærmbilleder).
        if std::env::var("TT_DEMO").is_ok_and(|d| d.contains("palet")) {
            this.open_palette(window, cx);
        }
        // TT_DEMO=idle, laast eller pomodoro: viser D21-flader til skærmbilleder.
        if let Ok(demo) = std::env::var("TT_DEMO") {
            let now = chrono::Local::now();
            this.ctx.hub.update(cx, |h, _| {
                if demo.contains("idlesamlet") {
                    // To pauser for samme timer, lagt sammen i ét spørgsmål.
                    let started = Some(now - chrono::Duration::hours(3));
                    for (from, to) in [(95, 70), (30, 0)] {
                        h.idle.push(IdlePrompt {
                            away_since: now - chrono::Duration::minutes(from),
                            back_at: now - chrono::Duration::minutes(to),
                            away_secs: ((from - to) * 60) as u64,
                            target: Default::default(),
                            timer_started: started,
                            periods: 1,
                        });
                    }
                } else if demo.contains("idle") {
                    h.idle.push(IdlePrompt {
                        away_since: now - chrono::Duration::minutes(24),
                        back_at: now,
                        away_secs: 24 * 60,
                        target: Default::default(),
                        timer_started: None,
                        periods: 1,
                    });
                }
                if demo.contains("laast") {
                    h.access = Access::Locked(crate::backend::licens::LockReason::TrialExpired);
                }
                if demo.contains("moede")
                    && let Some(k) = crate::kalenderkilder::global()
                {
                    k.put_back(crate::kalenderkilder::demo_meeting());
                    h.meetings = k.pending();
                }
                if demo.contains("pomodoro") {
                    h.pomodoro = Some("Arbejde 18:42 · runde 2 af 4".into());
                }
            });
        }
        this
    }

    fn ensure_view(
        &mut self,
        screen: Screen,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyView {
        if let Some(v) = self.views.get(&screen) {
            return v.clone();
        }
        let v = screens::build(screen, &self.ctx, window, cx);
        self.views.insert(screen, v.clone());
        v
    }

    pub fn navigate(&mut self, screen: Screen, window: &mut Window, cx: &mut Context<Self>) {
        self.screen = screen;
        let view = self.ensure_view(screen, window, cx);
        // Aktivitet styres med tastaturet (pile, T, N …) lige fra start.
        if let Ok(a) = view.downcast::<screens::aktivitet::AktivitetScreen>() {
            let focus = a.read(cx).focus_handle().clone();
            focus.focus(window, cx);
        }
        cx.notify();
    }

    /// "Luk dagen" (tray og palet): Aktivitet med panelet åbent.
    pub fn close_day(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.navigate(Screen::Aktivitet, window, cx);
        if let Some(v) = self
            .views
            .get(&Screen::Aktivitet)
            .cloned()
            .and_then(|v| v.downcast::<screens::aktivitet::AktivitetScreen>().ok())
        {
            v.update(cx, |s, cx| {
                s.focus_handle().focus(window, cx);
                s.open_close_day(cx);
            });
        }
    }

    /// Åbner kommandopaletten. Kunder og projekter kommer til, når de er hentet.
    pub fn open_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (cmds, items): (Vec<_>, Vec<_>) = palette::base_commands().into_iter().unzip();
        self.palette_cmds = cmds;
        self.palette_open = true;
        self.palette.update(cx, |p, cx| {
            p.set_items(items, cx);
            p.open(window, cx);
        });
        self.ctx.fetch(
            cx,
            |b| Ok((b.customers(false)?, b.projects(None, false)?)),
            |this, res, cx| {
                let Ok((customers, projects)) = res else {
                    return;
                };
                if !this.palette_open {
                    return;
                }
                let (mut cmds, mut items): (Vec<_>, Vec<_>) =
                    palette::base_commands().into_iter().unzip();
                let (c2, i2): (Vec<_>, Vec<_>) = palette::target_commands(&customers, &projects)
                    .into_iter()
                    .unzip();
                cmds.extend(c2);
                items.extend(i2);
                this.palette_cmds = cmds;
                this.palette.update(cx, |p, cx| p.set_items(items, cx));
            },
        );
        cx.notify();
    }

    fn close_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.palette_open = false;
        self.focus.focus(window, cx);
        cx.notify();
    }

    fn on_palette(
        &mut self,
        _: &Entity<Picker>,
        ev: &PickerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let cmd = match ev {
            PickerEvent::Dismissed | PickerEvent::Create(_) | PickerEvent::NewCustomer(_) => None,
            PickerEvent::Picked(ix) => self.palette_cmds.get(*ix).cloned(),
        };
        self.close_palette(window, cx);
        if let Some(cmd) = cmd {
            self.run_command(cmd, window, cx);
        }
    }

    pub fn run_command(&mut self, cmd: PaletteCmd, window: &mut Window, cx: &mut Context<Self>) {
        match cmd {
            PaletteCmd::Go(s) => self.navigate(s, window, cx),
            PaletteCmd::ToggleTimer => timer::toggle(&self.ctx, cx),
            PaletteCmd::StopTimer => timer::stop(&self.ctx, cx),
            PaletteCmd::DiscardTimer => {
                self.navigate(Screen::Hjem, window, cx);
                if let Some(h) = self
                    .view_for(Screen::Hjem)
                    .and_then(|v| v.downcast::<HjemScreen>().ok())
                {
                    h.update(cx, |h, cx| {
                        // Står timeren stille, er der intet at kassere.
                        h.confirm_discard = h
                            .data
                            .ready()
                            .is_some_and(|d| d.timer.status != crate::backend::TimerStatus::Idle);
                        cx.notify();
                    });
                }
            }
            PaletteCmd::ConfirmDay => self.ctx.run(cx, |b| b.confirm_day(b.today())),
            PaletteCmd::CloseDay => self.close_day(window, cx),
            PaletteCmd::StartOn(t) => self.ctx.run(cx, move |b| palette::start_on(b, t)),
        }
    }

    fn render_notice(&self, cx: &mut Context<Self>) -> Option<impl IntoElement + use<>> {
        let msg = self.ctx.hub.read(cx).notice.clone()?;
        let b = brand(cx);
        Some(
            ui::el("besked", Role::Alert, msg.clone())
                .absolute()
                .bottom(px(16.))
                .right(px(16.))
                .max_w(px(460.))
                .flex()
                .items_center()
                .gap_3()
                .p_3()
                .rounded(px(10.))
                .bg(b.card)
                .border_1()
                .border_color(b.danger)
                .shadow_lg()
                // min_w_0: teksten må krympe og ombrydes i stedet for at
                // skubbe beskeden ud over vinduets højre kant.
                .child(div().flex_1().min_w_0().text_sm().text_color(b.ink).child(msg))
                .child(
                    Button::new("besked-luk")
                        .ghost()
                        .small()
                        .label(t("nav.app.close"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.ctx.hub.update(cx, |h, cx| {
                                h.notice = None;
                                cx.notify();
                            });
                        })),
                ),
        )
    }

    /// Banner øverst, når licensen eller planen kræver noget af brugeren
    /// (prøve ved at udløbe, offline-respit, låst for nye registreringer).
    fn render_banner(&self, cx: &mut Context<Self>) -> Option<impl IntoElement + use<>> {
        let (text, locked) = {
            let hub = self.ctx.hub.read(cx);
            (hub.access.banner(hub.timer_active)?, hub.access.is_locked())
        };
        let b = brand(cx);
        Some(
            ui::el("licens-banner", Role::Alert, text.clone())
                .flex()
                .items_center()
                .gap_3()
                .px_4()
                .py_2()
                .bg(if locked { b.card } else { b.primary_soft })
                .border_b_1()
                .border_color(if locked { b.danger } else { b.border })
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_sm()
                        .text_color(b.ink)
                        .child(text),
                )
                .when(locked, |d| {
                    d.child(
                        Button::new("licens-banner-konto")
                            .ghost()
                            .small()
                            .label(t("d21.licens.open_account"))
                            .on_click(cx.listener(|this, _, w, cx| {
                                this.navigate(Screen::Indstillinger, w, cx)
                            })),
                    )
                }),
        )
    }

    /// Svar på idle-spørgsmålet (`Behold` ændrer intet).
    fn answer_idle(&mut self, choice: IdleChoice, cx: &mut Context<Self>) {
        let ctx = self.ctx.clone();
        let Some(prompt) = ctx.hub.update(cx, |h, cx| {
            cx.notify();
            h.idle.take()
        }) else {
            return;
        };
        cx.spawn(async move |_, cx| {
            let backend = ctx.backend.clone();
            let res = cx
                .background_executor()
                .spawn(async move { crate::idle::resolve(&*backend, &prompt, choice) })
                .await;
            cx.update(|cx| {
                match res {
                    Ok(out) if choice != IdleChoice::Keep => ctx.notify_user(out.message(), cx),
                    Ok(_) => {}
                    Err(e) => ctx.notify_user(e.to_string(), cx),
                }
                ctx.changed(cx);
            });
        })
        .detach();
    }

    fn render_idle(&self, p: &IdlePrompt, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let b = brand(cx);
        let prompt = p.clone();
        let content = ui::card(&b, "idle-kort", t("d21.idle.title"))
            .w(px(460.))
            .child(ui::heading(&b, "idle-titel", t("d21.idle.title"), 2))
            .child(ui::text("idle-tekst", p.text()))
            .child(
                h_flex()
                    .gap_2()
                    .pt_2()
                    .child(
                        Button::new("idle-behold")
                            .primary()
                            .label(t("d21.idle.keep"))
                            .accessibility_label(t("d21.idle.keep_label"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.answer_idle(IdleChoice::Keep, cx)
                            })),
                    )
                    // Clockifys fire valg (kalender): "Træk fra" stopper timeren.
                    .child(
                        Button::new("idle-traek-fra-stop")
                            .label(t("d21.idle.subtract_stop"))
                            .accessibility_label(t("d21.idle.subtract_stop_label"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.answer_idle(IdleChoice::SubtractAndStop, cx)
                            })),
                    )
                    .child(
                        Button::new("idle-traek-fra")
                            .label(t("d21.idle.subtract"))
                            .accessibility_label(t("d21.idle.subtract_label"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.answer_idle(IdleChoice::Subtract, cx)
                            })),
                    ),
            )
            .child(
                h_flex().pt_1().child(
                    Button::new("idle-tildel")
                        .ghost()
                        .label(t("kalenderkilder.idle.assign"))
                        .accessibility_label(t("kalenderkilder.idle.assign_label"))
                        .on_click(cx.listener(move |this, _, w, cx| {
                            let p = prompt.clone();
                            this.moeder.update(cx, |m, cx| {
                                m.open(crate::moedekort::PickFor::Idle(p), w, cx)
                            });
                        })),
                ),
            );
        // Der klikkes ikke væk: spørgsmålet skal besvares (Behold er det trygge valg).
        ui::modal("idle-dialog", t("d21.idle.title"), content, |_, _, _| {})
    }

    /// En knap i en notifikation (kalender). Knapper, der viser noget,
    /// bringer vinduet frem; de andre kører i baggrunden med en besked.
    pub fn handle_action(
        &mut self,
        action: Option<crate::notify::NotifyAction>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::notify::NotifyAction as A;
        type Op = Box<dyn FnOnce(&dyn Backend) -> backend::Result<String> + Send>;
        let report = |ctx: &AppCtx, cx: &mut Context<Self>, op: Op| {
            let ctx = ctx.clone();
            let backend = ctx.backend.clone();
            cx.spawn(async move |_, cx| {
                let res = cx.background_executor().spawn(async move { op(&*backend) }).await;
                cx.update(|cx| {
                    ctx.notify_user(res.unwrap_or_else(|e| e.to_string()), cx);
                    ctx.changed(cx);
                });
            })
            .detach();
        };
        let Some(action) = action else {
            crate::vindue::show(cx);
            return;
        };
        if action.opens_app() {
            crate::vindue::show(cx);
        }
        match action {
            A::StartLast => report(&self.ctx, cx, Box::new(crate::handling::start_last)),
            A::Confirm(id) => {
                report(&self.ctx, cx, Box::new(move |b| crate::handling::confirm(b, &id)))
            }
            A::Choose => self.open_palette(window, cx),
            A::Review => self.navigate(Screen::Hjem, window, cx),
            A::MeetingRegister(id) => self.moeder.update(cx, |m, cx| m.register(id, window, cx)),
            A::MeetingEdit(id) => {
                crate::vindue::show(cx);
                self.moeder.update(cx, |m, cx| m.edit_meeting(&id, window, cx))
            }
            A::MeetingIgnore(id) => self.moeder.update(cx, |m, cx| m.ignore(&id, cx)),
        }
    }

    /// Den bygget view for en skærm (til tests).
    pub fn view_for(&self, screen: Screen) -> Option<AnyView> {
        self.views.get(&screen).cloned()
    }

    /// ⌘\ / Ctrl+\ og knappen nederst i menuen.
    pub fn toggle_nav(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ww = window.viewport_size().width / px(1.);
        let from = self.nav.width(ww);
        self.nav.toggle(ww);
        let to = self.nav.width(ww);
        let n = self.nav_anim.map_or(0, |(_, _, n)| n + 1);
        self.nav_anim = (!ui::tokens::reduce_motion()).then_some((from, to, n));
        cx.notify();
    }

    fn render_nav(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        use ui::Icon;
        use ui::tokens as tk;
        let b = brand(cx);
        let ww = window.viewport_size().width / px(1.);
        self.nav.observe_width(ww);
        let collapsed = self.nav.collapsed(ww);
        let width = self.nav.width(ww);
        if self.nav_anim.is_some_and(|(_, to, _)| to != width) {
            self.nav_anim = None;
        }
        let (mode, mode_icon) = match self.ctx.backend.mode() {
            Mode::Cloud { organization } => (
                tf("nav.app.mode_cloud", &[("organization", &organization)]),
                Icon::Cloud,
            ),
            Mode::Local => (t("nav.app.mode_local").to_string(), Icon::HardDrive),
        };
        let toggle_text = if collapsed {
            t("design.nav.expand")
        } else {
            t("design.nav.collapse")
        };
        let toggle_tip = format!(
            "{toggle_text} ({} / {})",
            ui::shortcut_label("\\"),
            ui::shortcut_label("b")
        );
        let hover = tk::hover_bg(&b);

        let item = |this: &Self, i: usize, s: Screen, cx: &mut Context<Self>| {
            let active = s == this.screen;
            let shortcut = if s == Screen::Indstillinger {
                ui::shortcut_label(",")
            } else {
                ui::shortcut_label(&(i + 1).to_string())
            };
            let fg = if active { b.primary } else { b.ink };
            // Tablist-mønstret: kun det aktive punkt er et Tab-stop.
            let _ = this.nav_focus[i].clone().tab_stop(active);
            let row = div()
                .id(SharedString::from(format!("nav-{}", s.key())))
                .test_support()
                .role(Role::Tab)
                .aria_label(s.title())
                .aria_selected(active)
                .aria_keyshortcuts(shortcut.clone())
                .track_focus(&this.nav_focus[i])
                .flex()
                .items_center()
                .h(px(36.))
                .rounded(px(tk::RADIUS_MD))
                .cursor_pointer()
                .text_size(px(tk::TEXT_SM))
                .text_color(fg)
                .when(active, |d| d.bg(b.primary_soft).font_weight(tk::WEIGHT_SEMIBOLD))
                .when(!active, |d| d.hover(move |d| d.bg(hover)))
                .on_click(cx.listener(move |this, _, window, cx| this.navigate(s, window, cx)))
                .on_a11y_action(
                    AccessibleAction::Click,
                    {
                        let me = cx.entity().downgrade();
                        move |_, window, cx| {
                            let _ = me.update(cx, |this, cx| this.navigate(s, window, cx));
                        }
                    },
                )
                .on_key_down(cx.listener(move |this, ev: &KeyDownEvent, window, cx| {
                    if ev.keystroke.modifiers.modified() {
                        return;
                    }
                    let n = this.nav_focus.len();
                    match ev.keystroke.key.as_str() {
                        "enter" | "space" => this.navigate(s, window, cx),
                        "down" => this.nav_focus[(i + 1) % n].focus(window, cx),
                        "up" => this.nav_focus[(i + n - 1) % n].focus(window, cx),
                        _ => return,
                    }
                    cx.stop_propagation();
                }));
            let row = tk::focus_ring(row, &b);
            let icon = ui::icon(s.icon())
                .size(tk::ICON_LG - 2.)
                .color(if active { b.primary } else { b.grey });
            if collapsed {
                let title = s.title();
                row.w(px(40.))
                    .justify_center()
                    .child(icon)
                    .tooltip(move |w, cx| {
                        gpui_kit::component::tooltip::Tooltip::new(title)
                            .action(&*nav_action(s), None)
                            .build(w, cx)
                    })
                    .into_any_element()
            } else {
                row.w_full()
                    .px(px(tk::SPACE_2 + 2.))
                    .gap(px(tk::SPACE_3 - 2.))
                    .child(icon)
                    .child(div().flex_1().min_w_0().truncate().child(s.title()))
                    .child(
                        div()
                            .text_size(px(tk::TEXT_XS))
                            .text_color(b.grey)
                            .child(shortcut),
                    )
                    .into_any_element()
            }
        };

        // Grupper: dagen, arbejdet, pengene. Indstillinger står nederst.
        let groups: [&[Screen]; 3] = [
            &[Screen::Hjem, Screen::Kalender, Screen::Aktivitet],
            &[
                Screen::Kunder,
                Screen::Projekter,
                Screen::Klippekort,
                Screen::Opgaver,
            ],
            &[Screen::Fakturaer, Screen::Rapporter],
        ];
        let index = |s: Screen| Screen::ALL.iter().position(|x| *x == s).unwrap_or(0);
        let mut tabs = div()
            .id("navigation")
            .test_support()
            .role(Role::TabList)
            .aria_label(t("nav.app.navigation"))
            .aria_orientation(Orientation::Vertical)
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .when(collapsed, |d| d.items_center())
            .px(px(tk::SPACE_2 + 2.));
        for (g, group) in groups.iter().enumerate() {
            if g > 0 {
                tabs = tabs.child(
                    div()
                        .h(px(1.))
                        .my(px(tk::SPACE_2 + 2.))
                        .mx(px(tk::SPACE_1))
                        .when(collapsed, |d| d.w(px(28.)))
                        .when(!collapsed, |d| d.self_stretch())
                        .bg(b.border),
                );
            }
            let mut col = v_flex().gap(px(tk::SPACE_0_5)).w_full();
            if collapsed {
                col = col.items_center();
            }
            for s in group.iter() {
                col = col.child(item(self, index(*s), *s, cx));
            }
            tabs = tabs.child(col);
        }
        tabs = tabs.child(div().flex_1()).child(item(
            self,
            index(Screen::Indstillinger),
            Screen::Indstillinger,
            cx,
        ));

        let header = if collapsed {
            h_flex()
                .h(px(56.))
                .justify_center()
                .child(brand_mark(&b, 22.))
        } else {
            h_flex()
                .h(px(56.))
                .px(px(tk::SPACE_4 + 2.))
                .gap(px(tk::SPACE_2 + 2.))
                .child(brand_mark(&b, 22.))
                .child(
                    ui::text("app-navn", tt_core::edition::EDITION.name)
                        .text_size(px(tk::TEXT_LG))
                        .font_weight(tk::WEIGHT_BOLD)
                        .text_color(b.ink),
                )
        };

        let toggle = Button::new("nav-skift")
            .ghost()
            .small()
            .icon(if collapsed {
                Icon::PanelLeftOpen
            } else {
                Icon::PanelLeftClose
            })
            .accessibility_label(t("design.nav.toggle_label"))
            .tooltip(toggle_tip)
            .on_click(cx.listener(|this, _, w, cx| this.toggle_nav(w, cx)));

        let pomodoro = self.ctx.hub.read(cx).pomodoro.clone();
        let footer = if collapsed {
            v_flex()
                .items_center()
                .gap(px(tk::SPACE_2))
                .pt(px(tk::SPACE_3))
                .pb(px(tk::SPACE_4))
                .when_some(pomodoro, |d, p| {
                    d.child(
                        ui::el("pomodoro", Role::Label, p.clone())
                            .child(ui::icon(Icon::Timer).size(tk::ICON_MD).color(b.primary))
                            .tooltip(move |w, cx| {
                                gpui_kit::component::tooltip::Tooltip::new(p.clone()).build(w, cx)
                            }),
                    )
                })
                .child(
                    ui::el("tilstand", Role::Label, mode.clone())
                        .child(ui::icon(mode_icon).size(tk::ICON_MD).color(b.grey))
                        .tooltip(move |w, cx| {
                            gpui_kit::component::tooltip::Tooltip::new(mode.clone()).build(w, cx)
                        }),
                )
                .child(toggle)
        } else {
            v_flex()
                .gap(px(tk::SPACE_1))
                .px(px(tk::SPACE_4))
                .pt(px(tk::SPACE_3))
                .pb(px(tk::SPACE_3))
                .when_some(pomodoro, |d, p| {
                    d.child(
                        h_flex()
                            .gap(px(tk::SPACE_2))
                            .child(ui::icon(Icon::Timer).size(tk::ICON_SM).color(b.primary))
                            .child(ui::muted(&b, "pomodoro", p).text_xs()),
                    )
                })
                .child(
                    h_flex()
                        .gap(px(tk::SPACE_2))
                        .child(ui::icon(mode_icon).size(tk::ICON_SM).color(b.grey))
                        .child(ui::muted(&b, "tilstand", mode).flex_1().min_w_0().truncate().text_xs())
                        .child(toggle),
                )
        };

        let nav = v_flex()
            .id("sidemenu")
            .flex_none()
            .h_full()
            .overflow_hidden()
            .bg(b.sidebar)
            .border_r_1()
            .border_color(b.border)
            .child(header)
            .child(tabs.pt(px(tk::SPACE_2)))
            .child(footer);
        match self.nav_anim {
            Some((from, to, n)) if to == width => nav
                .with_animation(
                    ("sidemenu-bredde", n),
                    Animation::new(tk::MOTION_BASE).with_easing(ease_out_quint()),
                    move |el, d| el.w(px(from + (to - from) * d)),
                )
                .into_any_element(),
            _ => nav.w(px(width)).into_any_element(),
        }
    }
}

/// Handlingen bag et punkt i menuen (til genvejen i tooltip'en).
fn nav_action(s: Screen) -> Box<dyn Action> {
    match s {
        Screen::Hjem => Box::new(GaTilHjem),
        Screen::Kalender => Box::new(GaTilKalender),
        Screen::Aktivitet => Box::new(GaTilAktivitet),
        Screen::Kunder => Box::new(GaTilKunder),
        Screen::Projekter => Box::new(GaTilProjekter),
        Screen::Klippekort => Box::new(GaTilKlippekort),
        Screen::Opgaver => Box::new(GaTilOpgaver),
        Screen::Fakturaer => Box::new(GaTilFakturaer),
        Screen::Rapporter => Box::new(GaTilRapporter),
        Screen::Indstillinger => Box::new(GaTilIndstillinger),
    }
}

/// Udgavens mærke (`Brand::mark`).
fn brand_mark(b: &brand::Brand, size: f32) -> impl IntoElement {
    ui::icon(ui::Icon::TimeTrack).size(size).color(b.mark)
}

impl Render for AppView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let current = self.ensure_view(self.screen, window, cx);
        h_flex()
            .id("app")
            .track_focus(&self.focus)
            .key_context("TimeTrack")
            .size_full()
            .bg(b.surface)
            .text_color(b.ink)
            .font_family(brand::FONT)
            .on_action(cx.listener(|this, _: &GaTilHjem, w, cx| this.navigate(Screen::Hjem, w, cx)))
            .on_action(
                cx.listener(|this, _: &GaTilKalender, w, cx| {
                    this.navigate(Screen::Kalender, w, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &GaTilAktivitet, w, cx| {
                this.navigate(Screen::Aktivitet, w, cx)
            }))
            .on_action(cx.listener(|this, _: &LukDagen, w, cx| this.close_day(w, cx)))
            .on_action(
                cx.listener(|this, _: &GaTilKunder, w, cx| this.navigate(Screen::Kunder, w, cx)),
            )
            .on_action(cx.listener(|this, _: &GaTilProjekter, w, cx| {
                this.navigate(Screen::Projekter, w, cx)
            }))
            .on_action(cx.listener(|this, _: &GaTilKlippekort, w, cx| {
                this.navigate(Screen::Klippekort, w, cx)
            }))
            .on_action(
                cx.listener(|this, _: &GaTilOpgaver, w, cx| this.navigate(Screen::Opgaver, w, cx)),
            )
            .on_action(cx.listener(|this, _: &GaTilFakturaer, w, cx| {
                this.navigate(Screen::Fakturaer, w, cx)
            }))
            .on_action(cx.listener(|this, _: &GaTilRapporter, w, cx| {
                this.navigate(Screen::Rapporter, w, cx)
            }))
            .on_action(cx.listener(|this, _: &GaTilIndstillinger, w, cx| {
                this.navigate(Screen::Indstillinger, w, cx)
            }))
            .child(self.render_nav(window, cx))
            .on_action(cx.listener(|this, _: &AabnPalet, w, cx| this.open_palette(w, cx)))
            .on_action(cx.listener(|this, _: &SkiftMenu, w, cx| this.toggle_nav(w, cx)))
            .on_action(cx.listener(|this, _: &StartPauseTimer, _, cx| timer::toggle(&this.ctx, cx)))
            .on_action(cx.listener(|this, _: &StopTimer, _, cx| timer::stop(&this.ctx, cx)))
            .relative()
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .children(self.render_banner(cx))
                    .child(div().flex_1().min_h_0().child(current))
                    .child(self.afviste.clone()),
            )
            .children(self.render_notice(cx))
            .children(
                self.ctx
                    .hub
                    .read(cx)
                    .idle
                    .current()
                    .cloned()
                    .map(|p| self.render_idle(&p, cx)),
            )
            // Over idle-dialogen: målvælgeren til "Træk fra og tildel til …".
            .child(self.moeder.clone())
            .when(self.palette_open, |d| {
                d.child(ui::modal(
                    "palet-dialog",
                    t("nav.palette.title"),
                    self.palette.clone(),
                    cx.listener(|this, _: &MouseDownEvent, w, cx| this.close_palette(w, cx)),
                ))
            })
    }
}
