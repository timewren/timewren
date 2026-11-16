//! Indstillinger → Kalender: kalenderkilder (ICS-adresse og macOS-kalenderen)
//! og mødedetektionen. Der læses kun; appen skriver aldrig i kalenderen.
//!
//! Tastatur: Tab mellem felterne, Enter i adressefeltet gemmer.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{Disableable as _, Selectable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::row;
use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::Settings;
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf, tf_n};
use crate::kalenderkilder::{self, CalendarSettings};
use crate::ui::{self, forms};

/// Valgene for "Mødet er slut efter" (sekunder).
pub const END_AFTER: [u32; 3] = [60, 120, 300];

/// Statuslinjen under adressen: antal aftaler og tidspunkt, eller fejlen.
pub fn status_text() -> Option<(String, bool)> {
    let k = kalenderkilder::global()?;
    if let Some(e) = k.last_error() {
        return Some((tf("kalenderkilder.panel.error", &[("error", &e)]), true));
    }
    Some(match k.last_refresh() {
        Some(at) => (
            status_line(
                k.event_count(),
                &at.with_timezone(&chrono::Local).format("%H:%M").to_string(),
            ),
            false,
        ),
        None => (t("kalenderkilder.panel.status_none").into(), false),
    })
}

/// "12 aftaler hentet kl. 09:30", med ental for én aftale.
fn status_line(n: usize, time: &str) -> String {
    tf_n("kalenderkilder.panel.status", n, &[("time", time)])
}

pub struct KalenderPanel {
    ctx: AppCtx,
    settings: Option<Settings>,
    url: Entity<InputState>,
    notice: Option<(SharedString, bool)>,
    busy: bool,
    /// macOS: adgangen til systemets kalender.
    #[cfg(target_os = "macos")]
    access: kalenderkilder::eventkit::Access,
    _subs: Vec<Subscription>,
}

impl KalenderPanel {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let url = forms::input(t("kalenderkilder.panel.ics_placeholder"), "", window, cx);
        let subs = vec![cx.subscribe(&url, |this: &mut Self, _, ev: &InputEvent, cx| {
            if let InputEvent::PressEnter { .. } = ev {
                this.save_url(cx);
            }
        })];
        let mut this = KalenderPanel {
            ctx,
            settings: None,
            url,
            notice: None,
            busy: false,
            #[cfg(target_os = "macos")]
            access: kalenderkilder::eventkit::Access::NotDetermined,
            _subs: subs,
        };
        this.load(Some(window), cx);
        this
    }

    fn load(&mut self, window: Option<&mut Window>, cx: &mut Context<Self>) {
        #[cfg(target_os = "macos")]
        {
            self.access = kalenderkilder::eventkit::access();
        }
        let handle = window.map(|w| w.window_handle());
        self.ctx.fetch(
            cx,
            |b| b.settings(),
            move |this, res, cx| {
                if let Ok(s) = res {
                    let url = s.calendar.ics_url.clone().unwrap_or_default();
                    this.settings = Some(s);
                    if let Some(h) = handle {
                        let input = this.url.clone();
                        let _ = h.update(cx, |_, w, cx| input.update(cx, |i, cx| i.set_value(url, w, cx)));
                    }
                }
            },
        );
    }

    /// Ret indstillingerne og gem; `refresh` henter kilderne bagefter.
    fn change(
        &mut self,
        f: impl FnOnce(&mut CalendarSettings, &mut Settings) + Send + 'static,
        refresh: bool,
        ok: Option<&'static str>,
        cx: &mut Context<Self>,
    ) {
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| {
                let mut s = b.settings()?;
                let mut c = s.calendar.clone();
                f(&mut c, &mut s);
                s.calendar = c;
                let saved = b.save_settings(s)?;
                if refresh && let Some(k) = kalenderkilder::global() {
                    k.apply(&saved.calendar);
                    k.refresh(chrono::Utc::now(), true);
                }
                Ok(saved)
            },
            move |this, res, cx| {
                this.busy = false;
                match res {
                    Ok(s) => {
                        this.settings = Some(s);
                        this.notice = ok.map(|k| (t(k).into(), false));
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
                cx.notify();
            },
        );
        cx.notify();
    }

    fn save_url(&mut self, cx: &mut Context<Self>) {
        let url = forms::value(&self.url, cx);
        let ok = if url.is_empty() {
            "kalenderkilder.panel.removed"
        } else {
            "kalenderkilder.panel.saved"
        };
        self.change(
            move |c, _| c.ics_url = (!url.is_empty()).then_some(url),
            true,
            Some(ok),
            cx,
        );
    }

    fn refresh_now(&mut self, cx: &mut Context<Self>) {
        self.busy = true;
        self.ctx.mutate(
            cx,
            |_| {
                if let Some(k) = kalenderkilder::global() {
                    k.refresh(chrono::Utc::now(), true);
                }
                Ok(())
            },
            |this, _, cx| {
                this.busy = false;
                this.notice = None;
                cx.notify();
            },
        );
        cx.notify();
    }

    #[cfg(target_os = "macos")]
    fn request_access(&mut self, cx: &mut Context<Self>) {
        let (tx, rx) = async_channel::bounded(1);
        kalenderkilder::eventkit::request_access(move |ok| {
            let _ = tx.try_send(ok);
        });
        cx.spawn(async move |this, cx| {
            if rx.recv().await.is_ok() {
                let _ = this.update(cx, |this, cx| {
                    this.access = kalenderkilder::eventkit::access();
                    if this.access == kalenderkilder::eventkit::Access::Granted {
                        this.change(|c, _| c.system_calendar = true, true, None, cx);
                    }
                    cx.notify();
                });
            }
        })
        .detach();
    }

    #[cfg(target_os = "macos")]
    fn render_system(&self, b: &Brand, c: &CalendarSettings, cx: &mut Context<Self>) -> Div {
        use kalenderkilder::eventkit::Access;
        let status = match self.access {
            Access::Granted => Some((t("kalenderkilder.panel.access_granted"), false)),
            Access::Denied | Access::Restricted => Some((t("kalenderkilder.panel.access_denied"), true)),
            Access::WriteOnly => Some((t("kalenderkilder.panel.access_write_only"), true)),
            Access::NotDetermined => None,
        };
        v_flex()
            .child(
                row(
                    b,
                    "kal-system",
                    t("kalenderkilder.panel.system_title"),
                    t("kalenderkilder.panel.system_help"),
                )
                .child(if self.access == Access::NotDetermined {
                    Button::new("kal-adgang")
                        .label(t("kalenderkilder.panel.access"))
                        .accessibility_label(t("kalenderkilder.panel.access_label"))
                        .on_click(cx.listener(|this, _, _, cx| this.request_access(cx)))
                        .into_any_element()
                } else {
                    Switch::new("kal-system-kontakt")
                        .checked(c.system_calendar && self.access == Access::Granted)
                        .disabled(self.access != Access::Granted)
                        .accessibility_label(t("kalenderkilder.panel.system_title"))
                        .on_click(cx.listener(|this, on: &bool, _, cx| {
                            let on = *on;
                            this.change(move |c, _| c.system_calendar = on, true, None, cx)
                        }))
                        .into_any_element()
                }),
            )
            .children(status.map(|(s, err)| ui::pickers::notice(b, "kal-adgang-status", s.into(), err)))
    }

    #[cfg(not(target_os = "macos"))]
    fn render_system(&self, b: &Brand, _: &CalendarSettings, _: &mut Context<Self>) -> Div {
        v_flex().child(ui::muted(b, "kal-windows", t("kalenderkilder.panel.windows_help")).text_sm())
    }
}

impl Render for KalenderPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let Some(s) = self.settings.clone() else {
            return v_flex().child(ui::muted(&b, "kal-indlaeser", "…"));
        };
        let c = s.calendar.clone();
        let busy = self.busy;
        let status = status_text();
        v_flex()
            .gap_2()
            .child(ui::heading(&b, "kal-titel", t("kalenderkilder.panel.title"), 2))
            .child(ui::muted(&b, "kal-intro", t("kalenderkilder.panel.intro")).text_sm())
            // ---- ICS
            .child(
                v_flex()
                    .gap_1()
                    .pt_2()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_end()
                            .child(forms::text_field(
                                &b,
                                "kal-ics",
                                t("kalenderkilder.panel.ics_title"),
                                &self.url,
                                None,
                            ))
                            .child(
                                Button::new("kal-gem")
                                    .primary()
                                    .label(t("kalenderkilder.panel.save"))
                                    .accessibility_label(t("kalenderkilder.panel.save_label"))
                                    .disabled(busy)
                                    .on_click(cx.listener(|this, _, _, cx| this.save_url(cx))),
                            )
                            .child(
                                Button::new("kal-hent")
                                    .icon(Icon::RefreshCw)
                                    .label(t("kalenderkilder.panel.refresh"))
                                    .accessibility_label(t("kalenderkilder.panel.refresh_label"))
                                    .disabled(busy || c.ics_url.is_none() && !c.system_calendar)
                                    .on_click(cx.listener(|this, _, _, cx| this.refresh_now(cx))),
                            ),
                    )
                    .child(ui::muted(&b, "kal-ics-hjaelp", t("kalenderkilder.panel.ics_help")).text_xs())
                    .when(c.ics_url.is_some() || c.system_calendar, |d| {
                        d.children(status.map(|(s, err)| ui::pickers::notice(&b, "kal-status", s.into(), err)))
                    })
                    .children(
                        self.notice
                            .clone()
                            .map(|(m, err)| ui::pickers::notice(&b, "kal-besked", m.to_string().into(), err)),
                    ),
            )
            .child(self.render_system(&b, &c, cx))
            // ---- forslag og møder
            .child(
                row(
                    &b,
                    "kal-forslag",
                    t("kalenderkilder.panel.suggestions_title"),
                    t("kalenderkilder.panel.suggestions_help"),
                )
                .child(
                    Switch::new("kal-forslag-kontakt")
                        .checked(c.suggestions)
                        .accessibility_label(t("kalenderkilder.panel.suggestions_title"))
                        .on_click(cx.listener(|this, on: &bool, _, cx| {
                            let on = *on;
                            this.change(move |c, _| c.suggestions = on, false, None, cx)
                        })),
                ),
            )
            .child(
                row(
                    &b,
                    "kal-moeder",
                    t("kalenderkilder.panel.meetings_title"),
                    t("kalenderkilder.panel.meetings_help"),
                )
                .child(
                    Switch::new("kal-moeder-kontakt")
                        .checked(c.meetings.enabled)
                        .accessibility_label(t("kalenderkilder.panel.meetings_title"))
                        .on_click(cx.listener(|this, on: &bool, _, cx| {
                            let on = *on;
                            this.change(move |c, _| c.meetings.enabled = on, false, None, cx)
                        })),
                ),
            )
            .when(c.meetings.enabled, |d| {
                d.child(
                    row(
                        &b,
                        "kal-moede-notifikation",
                        t("kalenderkilder.panel.notify_title"),
                        t("kalenderkilder.panel.notify_help"),
                    )
                    .child(
                        Switch::new("kal-moede-notifikation-kontakt")
                            .checked(s.d21.notifications.meetings)
                            .accessibility_label(t("kalenderkilder.panel.notify_title"))
                            .on_click(cx.listener(|this, on: &bool, _, cx| {
                                let on = *on;
                                this.change(move |_, s| s.d21.notifications.meetings = on, false, None, cx)
                            })),
                    ),
                )
                .child(
                    row(
                        &b,
                        "kal-slut-efter",
                        t("kalenderkilder.panel.end_after"),
                        t("kalenderkilder.panel.end_after_help"),
                    )
                    .child(
                        ui::el("kal-slut-efter-valg", Role::RadioGroup, t("kalenderkilder.panel.end_after"))
                            .flex()
                            .gap_1()
                            .children(END_AFTER.into_iter().map(|secs| {
                                let label = tf("kalenderkilder.panel.end_after_option", &[("n", &(secs / 60).to_string())]);
                                let on = c.meetings.end_after_secs == secs;
                                let btn = Button::new(SharedString::from(format!("kal-slut-{secs}")))
                                    .label(label.clone())
                                    .accessibility_label(label)
                                    .role(Role::RadioButton)
                                    .selected(on)
                                    .toggled(on)
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.change(move |c, _| c.meetings.end_after_secs = secs, false, None, cx)
                                    }));
                                if on { btn.primary() } else { btn.ghost() }
                            })),
                    ),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn status_med_en_aftale_er_ental() {
        // Set på en rigtig Mac: "1 aftaler hentet kl. 23:12".
        assert_eq!(super::status_line(1, "23:12"), "1 aftale hentet kl. 23:12");
        assert_eq!(super::status_line(3, "23:12"), "3 aftaler hentet kl. 23:12");
    }
}
