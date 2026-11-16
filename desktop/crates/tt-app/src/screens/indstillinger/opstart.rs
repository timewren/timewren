//! Indstillinger → Sporing: "Start ved login" (OS'ets autostart) og "Start
//! sporing ved opstart" (gendan, som 0.2's TrackingSettings).

use gpui_kit::component::switch::Switch;
use gpui_kit::component::v_flex;
use gpui_kit::*;

use super::{Data, IndstillingerScreen, row};
use crate::autostart;
use crate::backend::BackendError;
use crate::brand::Brand;
use crate::i18n::t;

impl IndstillingerScreen {
    /// Hent OS'ets autostart-tilstand (på Windows et kald til reg.exe, så i baggrunden).
    pub(super) fn load_autostart(&mut self, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            |_| Ok(autostart::is_enabled()),
            |this, res, cx| {
                this.autostart = res.ok();
                cx.notify();
            },
        );
    }

    fn set_autostart(&mut self, on: bool, cx: &mut Context<Self>) {
        self.autostart = Some(on);
        self.ctx.fetch(
            cx,
            move |_| {
                autostart::set_enabled(on).map_err(BackendError::Other)?;
                Ok(autostart::is_enabled())
            },
            move |this, res, cx| {
                this.notice = Some(match res {
                    Ok(now) => {
                        this.autostart = Some(now);
                        let ok = if now { "gendan.opstart.login_on" } else { "gendan.opstart.login_off" };
                        (t(ok).into(), false)
                    }
                    Err(e) => {
                        this.load_autostart(cx);
                        (e.to_string().into(), true)
                    }
                });
                cx.notify();
            },
        );
        cx.notify();
    }

    pub(super) fn render_opstart(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> Div {
        let tracking_on = d.settings.tracking.start_on_launch;
        v_flex()
            .child(
                row(b, "sporing-login", t("gendan.opstart.login"), t("gendan.opstart.login_help")).child(
                    Switch::new("sporing-login-kontakt")
                        .checked(self.autostart.unwrap_or(false))
                        .accessibility_label(t("gendan.opstart.login"))
                        .on_click(cx.listener(|this, checked: &bool, _, cx| this.set_autostart(*checked, cx))),
                ),
            )
            .child(
                row(
                    b,
                    "sporing-opstart",
                    t("gendan.opstart.tracking"),
                    t("gendan.opstart.tracking_help"),
                )
                .child(
                    Switch::new("sporing-opstart-kontakt")
                        .checked(tracking_on)
                        .accessibility_label(t("gendan.opstart.tracking"))
                        .on_click(cx.listener(|this, checked: &bool, _, cx| {
                            let on = *checked;
                            this.update(
                                if on { t("gendan.opstart.tracking_on") } else { t("gendan.opstart.tracking_off") },
                                move |s| s.tracking.start_on_launch = on,
                                cx,
                            );
                        })),
                ),
            )
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use gpui_kit::TestAppContext;

    use super::IndstillingerScreen;
    use crate::autostart;
    use crate::backend::Backend as _;
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    #[gpui_kit::test]
    fn start_ved_login_og_sporing_ved_opstart(cx: &mut TestAppContext) {
        let _g = autostart::TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        autostart::set_enabled(false).unwrap();
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-sporing");
        p.assert_label(cx, "Start ved login");
        p.assert_label(cx, "Start sporing ved opstart");
        // Rækkerne ligger under testvinduets kant; handlingerne kaldes direkte.
        let screen = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        cx.update(|cx| screen.update(cx, |s, cx| s.set_autostart(true, cx)));
        p.settle(cx);
        p.assert_label(cx, "TimeTrack starter nu ved login");
        assert!(autostart::is_enabled(), "i sandkassen, ikke i den rigtige LaunchAgents-mappe");
        cx.update(|cx| screen.update(cx, |s, cx| s.set_autostart(false, cx)));
        p.settle(cx);
        assert!(!autostart::is_enabled());
        cx.update(|cx| {
            screen.update(cx, |s, cx| {
                s.update("ok", |st| st.tracking.start_on_launch = true, cx)
            })
        });
        p.settle(cx);
        assert!(p.mock.settings().unwrap().tracking.start_on_launch);
    }
}
