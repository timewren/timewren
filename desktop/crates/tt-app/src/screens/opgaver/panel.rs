//! Detaljepanelet: åbnes ved klik på en opgave. Titel, kunde/projekt, frist
//! og beskrivelse rettes direkte i panelet; status (tavlens kolonner) og
//! prioritet er knapper. Under dem estimat, brugt tid og tidsposterne.

use chrono::Datelike as _;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{Disableable as _, Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::ikon::{Ic, ikon, lane_icon, priority_icon, status_icon};
use super::logic;
use super::widgets::{hsla_of, icon_button, labelled, pill, pressable, progress_bar};
use super::{OpgaverScreen, priority_label};
use crate::backend::TaskPriority;
use crate::brand::Brand;
use crate::i18n::{t, tf};
use crate::ui::forms;
use crate::ui::{self, Loadable, format};

impl OpgaverScreen {
    /// Panelet som skuffe til højre. `None`, når ingen opgave er valgt.
    pub(super) fn render_panel(&self, b: &Brand, cx: &mut Context<Self>) -> Option<AnyElement> {
        let id = self.selected.as_deref()?;
        let d = self.data.ready()?;
        let task = d.tasks.iter().find(|t| t.id == id)?;
        let today = self.ctx.backend.today();
        let dark = b.dark;
        let year = today.year();
        let sp = logic::status_palette(task.status, dark);
        let lane = logic::resolve_lane(task, &d.lanes);
        let overdue = logic::is_overdue(task, today);
        let over_estimate = task
            .estimate_minutes
            .is_some_and(|e| e > 0 && task.logged_minutes > e);

        let tid = task.id.clone();
        let edit_id = task.id.clone();
        let timer_id = task.id.clone();
        let log_id = task.id.clone();

        let header = h_flex()
            .gap_2()
            .items_start()
            .child(
                div()
                    .pt_0p5()
                    .child(ikon(status_icon(task.status), 20., hsla_of(sp.accent))),
            )
            .child(
                div().flex_1().min_w_0().child(ui::heading(
                    b,
                    "opgave-panel-titel",
                    task.title.clone(),
                    2,
                )
                .text_color(b.ink)
                .text_base()),
            )
            .child(
                icon_button(
                    b,
                    "opgave-panel-luk",
                    Ic::X,
                    t("opx.panel.close"),
                    b.grey,
                )
                .on_click(cx.listener(|this, _, w, cx| this.deselect(w, cx))),
            );

        // Tavlens kolonner (egne statusser), i tavlens rækkefølge.
        let status_row = h_flex().gap_1().flex_wrap().children(
            d.lanes.iter().enumerate().map(|(n, l)| {
                let p = logic::lane_palette(l, dark);
                let on = lane == Some(n);
                let task_id = tid.clone();
                pressable(
                    b,
                    SharedString::from(format!("panel-status-{n}")),
                    Role::Button,
                    tf(
                        if on {
                            "opgaver.row.status_selected"
                        } else {
                            "opgaver.row.status_set"
                        },
                        &[("title", &task.title), ("status", &l.name)],
                    ),
                )
                .aria_selected(on)
                .h(px(30.))
                .px_2()
                .flex()
                .items_center()
                .gap_1()
                .rounded(px(8.))
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .map(|d| {
                    if on {
                        d.bg(hsla_of(p.bg))
                            .text_color(hsla_of(p.fg))
                            .border_color(hsla_of(p.accent))
                    } else {
                        d.text_color(b.grey).border_color(b.border)
                    }
                })
                .child(ikon(lane_icon(l), 14., hsla_of(p.accent)))
                .child(l.name.clone())
                .on_click(cx.listener(move |this, _, _, cx| this.move_to_lane(&task_id, n, cx)))
            }),
        );

        let priority_row = h_flex().gap_1().flex_wrap().children(
            TaskPriority::ALL.into_iter().enumerate().map(|(n, p)| {
                let pal = logic::priority_palette(p, dark);
                let on = task.priority == Some(p);
                let task_id = tid.clone();
                pressable(
                    b,
                    SharedString::from(format!("panel-prioritet-{n}")),
                    Role::Button,
                    tf(
                        if on {
                            "opx.panel.priority_selected"
                        } else {
                            "opx.panel.priority_set"
                        },
                        &[("priority", priority_label(p))],
                    ),
                )
                .aria_selected(on)
                .h(px(28.))
                .px_2()
                .flex()
                .items_center()
                .gap_1()
                .rounded(px(8.))
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .map(|d| {
                    if on {
                        d.bg(hsla_of(pal.bg))
                            .text_color(hsla_of(pal.fg))
                            .border_color(hsla_of(pal.accent))
                    } else {
                        d.text_color(b.grey).border_color(b.border)
                    }
                })
                .child(ikon(
                    priority_icon(p),
                    13.,
                    if on { hsla_of(pal.accent) } else { b.grey },
                ))
                .child(priority_label(p))
                .on_click(cx.listener(move |this, _, _, cx| this.set_priority(&task_id, p, cx)))
            }),
        );

        // Fristen rettes i feltet; en overskredet frist vises som mærke.
        let overdue_pill = task.due.filter(|_| overdue).map(|dd| {
            pill(
                Some(Ic::AlertTriangle),
                format!("{} · {}", format::date_medium(dd, year), t("opx.card.overdue")),
                logic::priority_palette(TaskPriority::Urgent, dark),
            )
        });
        let estimate = task
            .estimate_minutes
            .map_or_else(|| t("opx.panel.no_estimate").to_string(), super::mins);
        let logged = super::mins(task.logged_minutes);
        let progress = logic::progress_fraction(task)
            .map(|f| progress_bar(b, f, sp.accent, over_estimate).mt_1());

        let fields = self.render_edit(b, cx);

        let entries = self.render_entries(b);

        let actions = h_flex()
            .gap_2()
            .child(
                Button::new("opgave-panel-timer")
                    .label(t("opgaver.row.start_timer"))
                    .primary()
                    .small()
                    .accessibility_label(tf(
                        "opgaver.row.start_timer_on",
                        &[("title", &task.title)],
                    ))
                    .on_click(cx.listener(move |this, _, _, cx| this.start_timer(&timer_id, cx))),
            )
            .child(
                Button::new("opgave-panel-tid")
                    .label(t("opx.log.open"))
                    .small()
                    .disabled(self.log.is_some())
                    .accessibility_label(tf("opx.log.open_for", &[("title", &task.title)]))
                    .on_click(cx.listener(move |this, _, w, cx| this.open_log(&log_id, w, cx))),
            )
            .child(
                Button::new("opgave-panel-ret")
                    .label(t("opgaver.row.edit"))
                    .small()
                    .accessibility_label(tf("opgaver.row.edit_for", &[("title", &task.title)]))
                    .on_click(
                        cx.listener(move |this, _, w, cx| this.open_form(Some(&edit_id), w, cx)),
                    ),
            );
        let log = self.render_log(b, cx);

        Some(
            ui::el(
                "opgave-panel",
                Role::Complementary,
                tf("opx.panel.label", &[("title", &task.title)]),
            )
            .absolute()
            .top_0()
            .right_0()
            .bottom_0()
            .w(px(400.))
            .max_w(relative(0.92))
            .flex()
            .flex_col()
            .gap_4()
            .p_5()
            .overflow_y_scroll()
            .bg(b.surface)
            .border_l_1()
            .border_color(b.border)
            .shadow_lg()
            .child(header)
            .children(fields)
            .children(overdue_pill)
            .child(labelled(b, t("opx.field.status"), status_row))
            .child(labelled(b, t("opx.field.priority"), priority_row))
            .child(
                h_flex()
                    .gap_6()
                    .child(labelled(b, t("opx.panel.estimate"), estimate))
                    .child(labelled(b, t("opx.panel.logged"), logged)),
            )
            .children(progress)
            .child(actions)
            .children(log)
            .child(entries)
            .into_any_element(),
        )
    }

    /// Felterne, der rettes direkte: titel, kunde/projekt, frist og
    /// beskrivelse, med "Gem ændringer" og "Fortryd", når noget er ændret.
    fn render_edit(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let e = self.edit.as_ref()?;
        let dirty = self.edit_dirty(cx);
        let err = |x: Option<&'static str>| x.map(SharedString::from);
        Some(
            v_flex()
                .gap_3()
                .child(forms::text_field(
                    b,
                    "panel-titel",
                    t("opgaver.field.title"),
                    &e.title,
                    err(e.errors.title),
                ))
                .child(forms::select_field(
                    b,
                    "panel-sted",
                    t("opx.panel.place"),
                    &e.place,
                ))
                .child(div().w(px(180.)).child(forms::text_field(
                    b,
                    "panel-frist",
                    t("opgaver.field.due"),
                    &e.due,
                    err(e.errors.due),
                )))
                .child(forms::text_field(
                    b,
                    "panel-beskrivelse",
                    t("opx.field.description"),
                    &e.description,
                    None,
                ))
                .children(
                    e.error
                        .clone()
                        .map(|m| forms::form_error(b, "panel-fejl", m)),
                )
                .when(dirty || e.busy, |d| {
                    d.child(
                        h_flex()
                            .gap_2()
                            .child({
                                use gpui_kit::component::Disableable as _;
                                Button::new("panel-gem")
                                    .label(t("opx.panel.save"))
                                    .primary()
                                    .small()
                                    .loading(e.busy)
                                    .disabled(e.busy)
                                    .on_click(cx.listener(|this, _, _, cx| this.save_edit(cx)))
                            })
                            .child(
                                Button::new("panel-fortryd")
                                    .label(t("opx.panel.revert"))
                                    .small()
                                    .on_click(cx.listener(|this, _, _, cx| this.revert_edit(cx))),
                            ),
                    )
                }),
        )
    }

    /// "Registrér tid" på opgaven: dato, timer og tekst.
    fn render_log(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let f = self.log.as_ref()?;
        let err = |e: Option<&'static str>| e.map(SharedString::from);
        Some(
            v_flex()
                .gap_2()
                .p_3()
                .rounded_md()
                .border_1()
                .border_color(b.border)
                .child(ui::heading(b, "opgave-tid-titel", t("opx.log.title"), 3))
                .child(
                    h_flex()
                        .gap_2()
                        .items_start()
                        .child(forms::text_field(b, "opgave-tid-dato", t("opx.log.date"), &f.date, err(f.errors.date)))
                        .child(forms::text_field(b, "opgave-tid-timer", t("opx.log.hours"), &f.hours, err(f.errors.hours))),
                )
                .child(forms::text_field(
                    b,
                    "opgave-tid-tekst",
                    t("opx.log.description"),
                    &f.description,
                    None,
                ))
                .children(f.error.clone().map(|e| forms::form_error(b, "opgave-tid-fejl", e)))
                .child(
                    h_flex()
                        .gap_2()
                        .child(
                            Button::new("opgave-tid-gem")
                                .label(t("opx.log.save"))
                                .primary()
                                .small()
                                .loading(f.busy)
                                .disabled(f.busy)
                                .on_click(cx.listener(|this, _, _, cx| this.save_log(cx))),
                        )
                        .child(
                            Button::new("opgave-tid-annuller")
                                .label(t("opx.log.cancel"))
                                .small()
                                .ghost()
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.log = None;
                                    cx.notify();
                                })),
                        ),
                ),
        )
    }

    /// Tidsposterne på opgaven.
    fn render_entries(&self, b: &Brand) -> Div {
        let year = self.ctx.backend.today().year();
        let heading = ui::heading(b, "opgave-panel-poster-titel", t("opx.panel.entries"), 3);
        let body: AnyElement = match &self.entries {
            Loadable::Loading => ui::muted(b, "opgave-panel-poster-indlaeser", t("opx.panel.loading"))
                .into_any_element(),
            Loadable::Failed(e) => crate::ui::forms::form_error(b, "opgave-panel-poster-fejl", e.clone())
                .into_any_element(),
            Loadable::Ready(v) if v.is_empty() => {
                ui::muted(b, "opgave-panel-poster-tom", t("opx.panel.no_entries")).into_any_element()
            }
            Loadable::Ready(v) => {
                let total: u32 = v.iter().map(|e| e.minutes).sum();
                ui::list(
                    "opgave-panel-poster",
                    tf(
                        "opx.panel.entries_label",
                        &[
                            ("count", &v.len().to_string()),
                            ("total", &super::mins(total)),
                        ],
                    ),
                )
                .children(v.iter().map(|e| {
                    let date = format::date_medium(e.date, year);
                    let mins = super::mins(e.minutes);
                    let desc = if e.description.trim().is_empty() {
                        t("opx.panel.no_entry_text").to_string()
                    } else {
                        e.description.clone()
                    };
                    ui::list_row(
                        b,
                        SharedString::from(format!("opgave-post-{}", e.id)),
                        format!("{date}, {mins}, {desc}"),
                    )
                    .px_2()
                    .py_1()
                    .gap_2()
                    .child(
                        div()
                            .w(px(72.))
                            .flex_none()
                            .text_xs()
                            .text_color(b.grey)
                            .child(date),
                    )
                    .child(div().flex_1().min_w_0().text_sm().child(desc))
                    .child(
                        div()
                            .flex_none()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .child(mins),
                    )
                }))
                .into_any_element()
            }
        };
        v_flex().gap_1().child(heading).child(body)
    }
}
