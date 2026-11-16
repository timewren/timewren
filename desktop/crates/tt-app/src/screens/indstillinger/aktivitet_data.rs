//! Indstillinger → Sporing: "Det gemmer TimeTrack" (dage, segmenter og
//! størrelse på disken) og "Slet al aktivitet" med bekræftelse. // aktivitet

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::{ActivityStorage, StoredExclusion};
use crate::brand::brand;
use crate::i18n::{t, tf};
use crate::ui::{self, Loadable, pickers};

/// "1,8 MB", "512 kB".
pub fn size_text(bytes: u64) -> String {
    if bytes >= 1_000_000 {
        let mb = (bytes as f64 / 100_000.0).round() / 10.0;
        format!("{} MB", format!("{mb:.1}").replace('.', ","))
    } else {
        format!("{} kB", bytes.div_ceil(1_000))
    }
}

/// "Vinduestitel indeholder \"Privat\"".
pub fn exclusion_text(r: &StoredExclusion) -> String {
    let field = match r.field.as_str() {
        "app_name" => t("aktivitet.regel.app"),
        "window_title" => t("aktivitet.regel.titel"),
        _ => t("aktivitet.regel.adresse"),
    };
    let op = match r.op.as_str() {
        "equals" => t("aktivitet.regel.er"),
        "starts_with" => t("aktivitet.regel.starter"),
        "regex" => t("aktivitet.regel.regex"),
        _ => t("aktivitet.regel.indeholder"),
    };
    format!("{field} {op} \"{}\"", r.value)
}

/// "9 dage, 1.248 segmenter, 1,8 MB på disken".
pub fn storage_text(s: &ActivityStorage) -> String {
    tf(
        "aktivitet.data.oversigt",
        &[
            ("dage", &s.days.to_string()),
            ("segmenter", &thousands(s.segments)),
            ("stoerrelse", &size_text(s.bytes)),
        ],
    )
}

fn thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    out
}

pub struct AktivitetData {
    ctx: AppCtx,
    pub storage: Loadable<ActivityStorage>,
    /// Udelukkelser fra 0.2 i aktivitets-DB'en.
    pub exclusions: Vec<StoredExclusion>,
    pub confirm: bool,
    notice: Option<(SharedString, bool)>,
    busy: bool,
    _subs: Vec<Subscription>,
}

impl AktivitetData {
    pub fn new(ctx: AppCtx, cx: &mut Context<Self>) -> Self {
        let subs = vec![cx.observe(&ctx.hub, |this: &mut Self, _, cx| this.reload(cx))];
        let mut this = AktivitetData {
            ctx,
            storage: Loadable::Loading,
            exclusions: vec![],
            confirm: false,
            notice: None,
            busy: false,
            _subs: subs,
        };
        this.reload(cx);
        this
    }

    pub fn reload(&mut self, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            |b| {
                Ok((
                    b.activity_storage(),
                    b.stored_exclusions().unwrap_or_default(),
                ))
            },
            |this, res: crate::backend::Result<_>, _| {
                let Ok((storage, exclusions)) = res else {
                    return;
                };
                this.exclusions = exclusions;
                this.storage = match storage {
                    Ok(s) => Loadable::Ready(s),
                    Err(e) => Loadable::Failed(e.to_string().into()),
                };
            },
        );
    }

    pub fn remove_exclusion(&mut self, id: i64, cx: &mut Context<Self>) {
        self.ctx.mutate(
            cx,
            move |b| b.remove_stored_exclusion(id),
            |this, res, _| {
                this.notice = Some(match res {
                    Ok(()) => (t("aktivitet.regel.fjernet").into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    pub fn delete_all(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.ctx.mutate(
            cx,
            |b| b.delete_all_activity(),
            |this, res, _| {
                this.busy = false;
                this.confirm = false;
                this.notice = Some(match res {
                    Ok(()) => (t("aktivitet.data.slettet").into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }
}

impl Render for AktivitetData {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let overview = match &self.storage {
            Loadable::Ready(s) => storage_text(s),
            Loadable::Failed(e) => e.to_string(),
            Loadable::Loading => t("aktivitet.data.henter").into(),
        };
        v_flex()
            .gap_2()
            .py_2()
            .child(ui::heading(
                &b,
                "aktivitet-data-titel",
                t("aktivitet.data.titel"),
                3,
            ))
            .child(ui::text("aktivitet-data-oversigt", overview).text_sm())
            .child(ui::muted(&b, "aktivitet-data-hjaelp", t("aktivitet.data.hjaelp")).text_xs())
            .when(!self.exclusions.is_empty(), |d| {
                d.child(ui::heading(
                    &b,
                    "aktivitet-regler-titel",
                    t("aktivitet.regel.titel_liste"),
                    3,
                ))
                .child(
                    ui::muted(&b, "aktivitet-regler-hjaelp", t("aktivitet.regel.hjaelp")).text_xs(),
                )
                .child(
                    ui::list("aktivitet-regler", t("aktivitet.regel.titel_liste")).children(
                        self.exclusions.iter().enumerate().map(|(i, r)| {
                            let text = exclusion_text(r);
                            let id = r.id;
                            ui::list_row(&b, ("aktivitet-regel", i), text.clone())
                                .py_0p5()
                                .child(div().flex_1().child(text.clone()))
                                .child(
                                    Button::new(("aktivitet-regel-fjern", i))
                                        .label("×")
                                        .ghost()
                                        .xsmall()
                                        .accessibility_label(tf(
                                            "aktivitet.regel.fjern",
                                            &[("regel", &text)],
                                        ))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.remove_exclusion(id, cx)
                                        })),
                                )
                        }),
                    ),
                )
            })
            .children(
                self.notice
                    .clone()
                    .map(|(m, err)| pickers::notice(&b, "aktivitet-data-besked", m, err)),
            )
            .child(if self.confirm {
                ui::el(
                    "aktivitet-data-bekraeft",
                    Role::Alert,
                    t("aktivitet.data.bekraeft"),
                )
                .flex()
                .flex_col()
                .gap_2()
                .p_3()
                .rounded(px(8.))
                .border_1()
                .border_color(b.danger)
                .child(
                    div()
                        .text_sm()
                        .text_color(b.ink)
                        .child(t("aktivitet.data.bekraeft")),
                )
                .child(
                    h_flex()
                        .gap_2()
                        .child(ui::a11y_button(
                            "aktivitet-data-slet-ja",
                            t("aktivitet.data.slet_ja"),
                            self.busy,
                            |b| b.danger().small(),
                            cx.listener(|this, _, _, cx| this.delete_all(cx)),
                        ))
                        .child(ui::a11y_button(
                            "aktivitet-data-slet-nej",
                            t("aktivitet.annuller"),
                            false,
                            |b| b.ghost().small(),
                            cx.listener(|this, _, _, cx| {
                                this.confirm = false;
                                cx.notify();
                            }),
                        )),
                )
                .into_any_element()
            } else {
                h_flex()
                    .child(ui::a11y_button(
                        "aktivitet-data-slet",
                        t("aktivitet.data.slet"),
                        false,
                        |b| b.outline().small(),
                        cx.listener(|this, _, _, cx| {
                            this.confirm = true;
                            this.notice = None;
                            cx.notify();
                        }),
                    ))
                    .into_any_element()
            })
    }
}

#[cfg(test)]
mod tests {
    use super::{size_text, storage_text, thousands};
    use crate::backend::ActivityStorage;

    #[test]
    fn stoerrelse_og_oversigt() {
        assert_eq!(size_text(4_096), "5 kB");
        assert_eq!(size_text(1_843_200), "1,8 MB");
        assert_eq!(thousands(1248), "1.248");
        assert_eq!(thousands(12), "12");
        assert_eq!(
            storage_text(&ActivityStorage {
                days: 9,
                segments: 1248,
                bytes: 1_843_200
            }),
            "9 dage, 1.248 segmenter, 1,8 MB på disken"
        );
    }
}
