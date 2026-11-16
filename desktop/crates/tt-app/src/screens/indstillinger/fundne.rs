//! Indstillinger → AI → "Fundet på denne computer": sprogmodeller, som andre
//! programmer (Ollama, LM Studio, Meetily …) allerede har hentet. De bruges
//! direkte fra deres egen mappe, uden kopi og uden ekstra download.

use std::time::Duration;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{Disableable as _, Selectable as _, Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::{Data, IndstillingerScreen, size_label};
use crate::backend::{AiMode, AiServerKind, FoundModel, ModelFit};
use crate::brand::Brand;
use crate::i18n::{t, tf, tf_n};
use crate::ui::{self, Loadable, Tone};

/// "4B", "1.7B": antal parametre som modellerne selv hedder.
fn params_label(p: f32) -> String {
    if p >= 10.0 {
        format!("{p:.0}B")
    } else {
        let s = format!("{p:.1}");
        format!("{}B", s.strip_suffix(".0").unwrap_or(&s))
    }
}

/// "4B · Q4_K_M · 32k kontekst · 2,5 GB".
pub(super) fn detail(m: &FoundModel) -> String {
    let mut parts: Vec<String> = Vec::new();
    parts.extend(m.params_b.map(params_label));
    parts.extend(m.quant.clone());
    if let Some(c) = m.context {
        parts.push(tf(
            "indstillinger.ai.fundet_kontekst",
            &[("n", &(c / 1024).max(1).to_string())],
        ));
    }
    parts.push(size_label(m.size_mb));
    parts.join(" · ")
}

/// Mærkat og tone for egnetheden på denne computer.
fn fit_badge(m: &FoundModel) -> (&'static str, Tone) {
    match (m.available, m.fit, m.recommended, m.supported) {
        (false, ..) => (t("indstillinger.ai.fundet_vaek"), Tone::Danger),
        (_, ModelFit::TooBig, ..) => (t("indstillinger.ai.fundet_for_stor"), Tone::Danger),
        (_, ModelFit::Tight, ..) => (t("indstillinger.ai.fundet_taet"), Tone::Warning),
        (_, _, true, _) => (t("indstillinger.ai.fundet_anbefalet"), Tone::Primary),
        (_, _, _, false) => (t("indstillinger.ai.fundet_ukendt_format"), Tone::Neutral),
        _ => (t("indstillinger.ai.fundet_passer"), Tone::Neutral),
    }
}

impl IndstillingerScreen {
    /// Søger på disken igen ("Søg igen"). Kører på en baggrundstråd.
    pub(super) fn rescan_found(&mut self, cx: &mut Context<Self>) {
        self.found_scanning = true;
        cx.notify();
        self.ctx.fetch(
            cx,
            |b| b.rescan_models(),
            |this, res, _| {
                this.found_scanning = false;
                match res {
                    Ok(f) => {
                        let mut n = f.models.len();
                        if let Loadable::Ready(d) = &mut this.data {
                            // Tæl det, listen viser (uden modeller, der kører som server).
                            n = f.visible(&d.servers).len();
                            d.found = f;
                        }
                        this.notice = Some((
                            tf_n("indstillinger.ai.fundet_antal", n, &[]).into(),
                            false,
                        ));
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
            },
        );
    }

    /// Starter Ollama-serveren efter brugerens eget valg og finder serverne igen.
    pub(super) fn start_ollama(&mut self, cx: &mut Context<Self>) {
        self.ollama_starting = true;
        cx.notify();
        self.ctx.fetch(
            cx,
            |b| {
                b.start_ollama()?;
                b.discover_ai_servers()
            },
            |this, res, _| {
                this.ollama_starting = false;
                match res {
                    Ok(servers) => {
                        if let Loadable::Ready(d) = &mut this.data {
                            d.servers = servers;
                            d.found.ollama_stopped = false;
                        }
                        this.notice = Some((t("indstillinger.ai.ollama_startet").into(), false));
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
            },
        );
    }

    /// Mens en søgning kører i baggrunden, hentes resultatet igen indtil den er færdig.
    pub(super) fn poll_found(&mut self, cx: &mut Context<Self>) {
        if self.found_polling {
            return;
        }
        self.found_polling = true;
        cx.spawn(async move |this, cx| {
            for _ in 0..40 {
                cx.background_executor()
                    .timer(Duration::from_millis(1500))
                    .await;
                let Ok(keep) = this.update(cx, |this, cx| {
                    let scanning =
                        matches!(&this.data, Loadable::Ready(d) if d.found.scanning);
                    if !scanning {
                        this.found_polling = false;
                        return false;
                    }
                    this.ctx.fetch(
                        cx,
                        |b| b.found_models(),
                        |this, res, cx| {
                            if let (Ok(f), Loadable::Ready(d)) = (res, &mut this.data) {
                                d.found = f;
                            }
                            cx.notify();
                        },
                    );
                    true
                }) else {
                    return;
                };
                if !keep {
                    return;
                }
            }
            let _ = this.update(cx, |this, _| this.found_polling = false);
        })
        .detach();
    }

    /// "Ollama er installeret, men kører ikke" med en knap til at starte den.
    pub(super) fn render_ollama_stopped(
        &self,
        b: &Brand,
        d: &Data,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let running = d.servers.iter().any(|s| s.kind == AiServerKind::Ollama);
        if !d.found.ollama_stopped || running {
            return None;
        }
        Some(
            ui::list("ai-ollama", t("indstillinger.ai.servere_titel"))
                .child(
            ui::list_row(b, "ai-ollama-stoppet", t("indstillinger.ai.ollama_stoppet"))
                .px_0()
                .child(
                    v_flex()
                        .flex_1()
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .child(t("indstillinger.ai.ollama_stoppet")),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(b.grey)
                                .child(t("indstillinger.ai.ollama_stoppet_hjaelp")),
                        ),
                )
                .child(
                    Button::new("ai-ollama-start")
                        .label(t("indstillinger.ai.ollama_start"))
                        .small()
                        .loading(self.ollama_starting)
                        .accessibility_label(t("indstillinger.ai.ollama_start_aria"))
                        .on_click(cx.listener(|this, _, _, cx| this.start_ollama(cx))),
                ))
                .into_any_element(),
        )
    }

    /// Hele sektionen, grupperet efter program.
    pub(super) fn render_found(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let ai = &d.settings.ai;
        let visible = d.found.visible(&d.servers);
        let mut groups: Vec<(&str, Vec<&FoundModel>)> = Vec::new();
        for m in visible {
            match groups.iter_mut().find(|(label, _)| *label == m.source.as_str()) {
                Some((_, v)) => v.push(m),
                None => groups.push((m.source.as_str(), vec![m])),
            }
        }
        let status: Option<AnyElement> = if self.found_scanning || d.found.scanning {
            Some(
                ui::muted(b, "ai-fundet-soeger", t("indstillinger.ai.fundet_soeger"))
                    .text_xs()
                    .into_any_element(),
            )
        } else if groups.is_empty() {
            Some(
                ui::muted(b, "ai-fundet-tom", t("indstillinger.ai.fundet_tom"))
                    .text_xs()
                    .into_any_element(),
            )
        } else {
            None
        };
        let mut list = v_flex().gap_2();
        let mut index = 0usize;
        for (gi, (label, models)) in groups.iter().enumerate() {
            let rows = models.iter().map(|m| {
                let i = index;
                index += 1;
                let selected = ai.mode == AiMode::Builtin
                    && ai.builtin_model.as_deref() == Some(m.id.as_str());
                let (badge_text, tone) = fit_badge(m);
                let line = detail(m);
                let row_label = tf(
                    "indstillinger.ai.fundet_raekke",
                    &[
                        ("navn", &m.name),
                        ("program", &m.source),
                        ("detalje", &line),
                        ("tilstand", badge_text),
                    ],
                );
                let id = m.id.clone();
                let usable = m.available;
                ui::list_row(b, ("ai-fundet", i), row_label)
                    .px_0()
                    .child(
                        v_flex()
                            .flex_1()
                            .child(
                                h_flex()
                                    .gap_2()
                                    .child(
                                        div().font_weight(FontWeight::MEDIUM).child(m.name.clone()),
                                    )
                                    .child(ui::badge(b, ("ai-fundet-maerke", i), badge_text, tone)),
                            )
                            .child(div().text_xs().text_color(b.grey).child(line))
                            .when(selected, |c| {
                                c.child(
                                    ui::text(
                                        ("ai-fundet-delt", i),
                                        tf(
                                            "indstillinger.ai.fundet_delt",
                                            &[("program", &m.source)],
                                        ),
                                    )
                                    .text_xs()
                                    .text_color(b.primary),
                                )
                            }),
                    )
                    .child(
                        Button::new(("ai-fundet-brug", i))
                            .label(if selected {
                                t("indstillinger.ai.valgt")
                            } else {
                                t("indstillinger.ai.brug")
                            })
                            .small()
                            .selected(selected)
                            .disabled(selected || !usable)
                            .accessibility_label(tf(
                                "indstillinger.ai.fundet_brug_model",
                                &[("navn", &m.name), ("program", &m.source)],
                            ))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let id = id.clone();
                                this.update(
                                    t("indstillinger.ai.model_valgt"),
                                    move |s| {
                                        s.ai.builtin_model = Some(id);
                                        s.ai.mode = AiMode::Builtin;
                                    },
                                    cx,
                                );
                            })),
                    )
            });
            list = list.child(
                v_flex()
                    .child(ui::heading(
                        b,
                        ("ai-fundet-gruppe", gi),
                        tf(
                            "indstillinger.ai.fundet_gruppe",
                            &[("program", label), ("antal", &models.len().to_string())],
                        ),
                        4,
                    ))
                    .child(
                        ui::list(("ai-fundet-liste", gi), (*label).to_string())
                            .children(rows),
                    ),
            );
        }
        v_flex()
            .gap_2()
            .child(
                h_flex()
                    .justify_between()
                    .items_center()
                    .pt_2()
                    .child(ui::heading(
                        b,
                        "ai-fundet-titel",
                        t("indstillinger.ai.fundet_titel"),
                        3,
                    ))
                    .child(
                        Button::new("ai-fundet-soeg")
                            .label(t("indstillinger.ai.soeg_igen"))
                            .ghost()
                            .small()
                            .loading(self.found_scanning)
                            .accessibility_label(t("indstillinger.ai.fundet_soeg_aria"))
                            .on_click(cx.listener(|this, _, _, cx| this.rescan_found(cx))),
                    ),
            )
            .child(
                ui::muted(b, "ai-fundet-hjaelp", t("indstillinger.ai.fundet_hjaelp")).text_xs(),
            )
            .when(d.found.ram_gb > 0, |c| {
                c.child(
                    ui::muted(
                        b,
                        "ai-fundet-ram",
                        tf(
                            "indstillinger.ai.fundet_ram",
                            &[("ram", &d.found.ram_gb.to_string())],
                        ),
                    )
                    .text_xs(),
                )
            })
            .children(status)
            .child(list)
            .when(d.found.other_count > 0, |c| {
                c.child(
                    ui::muted(
                        b,
                        "ai-fundet-andre",
                        tf_n("indstillinger.ai.fundet_andre", d.found.other_count, &[]),
                    )
                    .text_xs(),
                )
            })
            .into_any_element()
    }
}
