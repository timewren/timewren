//! Opdateringer i appen (pakning): tjek ved start og hver 6. time, vis
//! "Version X er klar" under Indstillinger → Opdateringer, og hent,
//! installér og genstart først, når brugeren trykker på knappen.
//!
//! Selve kanalen, signaturtjekket og installationen ligger i `crate::updater`.

use std::time::Duration;

use gpui_kit::component::button::ButtonVariants as _;
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::UpdateChannel;
use crate::brand::brand;
use crate::i18n::{t, tf};
use crate::ui::{self, Tone};
use crate::updater::{self, Installed, Update};

const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const FIRST_CHECK: Duration = Duration::from_secs(20);

/// Release-noter til skærmbilleder (`TT_UPDATE_DEMO`), skrevet som på GitHub.
pub(crate) const DEMO_NOTER: &str = "### Tilføjet\n\
- **Sporing:** titel-eksklusion og foldning af korte skift\n\
- **Opdateringer:** noterne vises som tekst, og knappen står øverst\n\
\n\
### Rettet\n\
- **Klippekort:** saldoen opdateres straks efter en ny post\n\
\x20 - også når posten ligger i en anden måned\n\
- Hurtigere forslag på `Hjem`, se [ændringerne](https://example.invalid/aendringer)\n\
\n\
### Kendte fejl\n\
- Genveje virker ikke, før vinduet har fået fokus én gang\n";

#[derive(Clone, Debug, PartialEq)]
pub enum State {
    Idle,
    Checking,
    UpToDate,
    Available(Update),
    /// Henter og installerer.
    Installing(Update),
    /// Installeret; venter på genstart.
    Ready(Update, Installed),
    Failed(String),
}

/// Opdateringspanelet. Ét for hele appen (`global`), så tjekket i baggrunden
/// og Indstillinger viser det samme.
pub struct UpdatePanel {
    ctx: AppCtx,
    pub state: State,
    /// Release-noterne er foldet ud. Som standard foldet sammen.
    pub notes_open: bool,
}

struct Handle(Entity<UpdatePanel>);
impl Global for Handle {}

/// Autotjek er slået fra i demo, skærmbilleder, røgtest og med
/// `TT_NO_UPDATE_CHECK`.
fn auto_check_enabled() -> bool {
    [
        "TT_DEMO",
        "TT_SHOT",
        "TT_EXIT_AFTER_FIRST_FRAME",
        "TT_NO_UPDATE_CHECK",
    ]
    .iter()
    .all(|v| std::env::var_os(v).is_none())
}

impl UpdatePanel {
    /// Opret panelet og start baggrundstjekket. Kaldes én gang fra roden.
    pub fn install(ctx: AppCtx, cx: &mut App) {
        // App Store-udgaven: App Store opdaterer appen; intet panel, intet tjek.
        if !crate::mas::UPDATER || cx.has_global::<Handle>() {
            return;
        }
        // Skærmbilleder: TT_DEMO + TT_UPDATE_DEMO=0.2.24 viser en klar version.
        let state = match std::env::var("TT_UPDATE_DEMO") {
            Ok(v) if std::env::var_os("TT_DEMO").is_some() => State::Available(Update {
                version: v,
                notes: Some(DEMO_NOTER.into()),
                url: String::new(),
                signature: String::new(),
            }),
            _ => State::Idle,
        };
        let notes_open = std::env::var_os("TT_DEMO").is_some()
            && std::env::var("TT_UPDATE_NOTES").is_ok_and(|v| v == "open");
        let panel = cx.new(|_| UpdatePanel {
            ctx,
            state,
            notes_open,
        });
        cx.set_global(Handle(panel.clone()));
        if !auto_check_enabled() {
            return;
        }
        let weak = panel.downgrade();
        cx.spawn(async move |cx| {
            let mut wait = FIRST_CHECK;
            loop {
                cx.background_executor().timer(wait).await;
                wait = CHECK_EVERY;
                let alive = weak.update(cx, |p, cx| {
                    // Tjek ikke midt i en installation, eller når en er klar.
                    if matches!(p.state, State::Idle | State::UpToDate | State::Failed(_)) {
                        p.check(true, cx);
                    }
                });
                if alive.is_err() {
                    break;
                }
            }
        })
        .detach();
    }

    pub fn global(cx: &App) -> Option<Entity<UpdatePanel>> {
        cx.try_global::<Handle>().map(|h| h.0.clone())
    }

    /// Spørg kanalen. `quiet` = baggrundstjek: kun besked, hvis der er en ny.
    pub fn check(&mut self, quiet: bool, cx: &mut Context<Self>) {
        self.state = State::Checking;
        cx.notify();
        let backend = self.ctx.backend.clone();
        cx.spawn(async move |this, cx| {
            let res = cx
                .background_executor()
                .spawn(async move {
                    let beta = backend
                        .settings()
                        .map(|s| s.update_channel == UpdateChannel::Beta)
                        .unwrap_or(false);
                    updater::check_channel(beta, env!("CARGO_PKG_VERSION"))
                })
                .await;
            let _ = this.update(cx, |p, cx| {
                p.state = match res {
                    Ok(Some(u)) => {
                        p.ctx.notify_user(
                            tf("opdatering.notice_ready", &[("version", &u.version)]),
                            cx,
                        );
                        State::Available(u)
                    }
                    Ok(None) => State::UpToDate,
                    // Et baggrundstjek uden net skal ikke forstyrre.
                    Err(_) if quiet => State::Idle,
                    Err(e) => State::Failed(e.to_string()),
                };
                cx.notify();
            });
        })
        .detach();
    }

    /// Hent, tjek signaturen og installér. Genstart venter på brugeren.
    fn install_update(&mut self, update: Update, cx: &mut Context<Self>) {
        self.state = State::Installing(update.clone());
        cx.notify();
        cx.spawn(async move |this, cx| {
            let u = update.clone();
            let res = cx
                .background_executor()
                .spawn(async move { updater::download(&u).and_then(|b| updater::install(&b)) })
                .await;
            let _ = this.update(cx, |p, cx| {
                p.state = match res {
                    Ok(installed) => State::Ready(update, installed),
                    Err(e) => State::Failed(e.to_string()),
                };
                cx.notify();
            });
        })
        .detach();
    }

    fn restart(&mut self, cx: &mut Context<Self>) {
        if let State::Ready(_, installed) = &self.state {
            match updater::relaunch(installed) {
                Ok(()) => cx.quit(),
                Err(e) => {
                    self.state = State::Failed(e.to_string());
                    cx.notify();
                }
            }
        }
    }

    /// Dansk statuslinje (bruges også af tests).
    pub fn status_text(&self) -> String {
        match &self.state {
            State::Idle => t("opdatering.idle").into(),
            State::Checking => t("opdatering.checking").into(),
            State::UpToDate => t("opdatering.up_to_date").into(),
            State::Available(u) => tf("opdatering.available", &[("version", &u.version)]),
            State::Installing(u) => tf("opdatering.installing", &[("version", &u.version)]),
            State::Ready(u, Installed::Installer(_)) => {
                tf("opdatering.ready_installer", &[("version", &u.version)])
            }
            State::Ready(u, _) => tf("opdatering.ready", &[("version", &u.version)]),
            State::Failed(e) => e.clone(),
        }
    }
}

impl Render for UpdatePanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let tone = match &self.state {
            State::Failed(_) => Some(Tone::Danger),
            State::Available(_) | State::Ready(..) => Some(Tone::Primary),
            _ => None,
        };
        let status = ui::text("opdatering-status", self.status_text()).text_sm();
        let status = match tone {
            Some(t) => h_flex()
                .gap_2()
                .items_center()
                .child(ui::badge(
                    &b,
                    "opdatering-maerke",
                    if t == Tone::Danger {
                        crate::i18n::t("opdatering.badge_error")
                    } else {
                        crate::i18n::t("opdatering.badge_new")
                    },
                    t,
                ))
                .child(status)
                .into_any_element(),
            None => status.into_any_element(),
        };
        let notes = match &self.state {
            State::Available(u) | State::Ready(u, _) => u.notes.clone(),
            _ => None,
        };
        let busy = matches!(self.state, State::Checking | State::Installing(_));
        let action = match &self.state {
            State::Available(u) => {
                let u = u.clone();
                ui::a11y_button(
                    "opdatering-installer",
                    t("opdatering.install"),
                    false,
                    |b| b.primary().small(),
                    cx.listener(move |p, _, _, cx| p.install_update(u.clone(), cx)),
                )
            }
            State::Ready(..) => ui::a11y_button(
                "opdatering-genstart",
                t("opdatering.restart"),
                false,
                |b| b.primary().small(),
                cx.listener(|p, _, _, cx| p.restart(cx)),
            ),
            _ => ui::a11y_button(
                "opdatering-soeg",
                t("opdatering.check"),
                busy,
                move |b| b.small().loading(busy),
                cx.listener(|p, _, _, cx| p.check(false, cx)),
            ),
        };
        let has_notes = notes.is_some();
        let open = self.notes_open;
        let toggle = ui::a11y_button(
            "opdatering-noter-knap",
            if open {
                t("opdatering.hide_notes")
            } else {
                t("opdatering.show_notes")
            },
            false,
            |b| b.ghost().small(),
            cx.listener(|p, _, _, cx| {
                p.notes_open = !p.notes_open;
                cx.notify();
            }),
        )
        .aria_expanded(open);
        // Handlingen står øverst; noterne er foldet sammen, til man beder om dem.
        v_flex()
            .id("opdatering")
            .gap_2()
            .child(status)
            .child(
                h_flex()
                    .gap_2()
                    .child(action)
                    .when(has_notes, |el| el.child(toggle)),
            )
            .when_some(notes.filter(|_| open), |el, n| {
                el.child(ui::markdown(&b, "opdatering-noter", &n))
            })
    }
}
