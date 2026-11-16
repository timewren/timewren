//! Board: tavlens egne kolonner fra web (navn, farve og rækkefølge; uden
//! forbindelse de sidst kendte, ellers de fire faste). Kort kan trækkes
//! mellem kolonner; tastaturet bruger det valgte kort og `[` / `]`, eller
//! statusknapperne i panelet.

use chrono::{Datelike as _, NaiveDate};
use gpui_kit::component::input::Input;
use gpui_kit::component::select::Select;
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::*;

use super::ikon::{Ic, ikon, lane_icon, priority_icon};
use super::logic::{self, Palette};
use super::widgets::{dot, hsla_of, icon_button, pill, pressable, progress_bar};
use super::{Data, OpgaverScreen, place_label, priority_label, status_label};
use crate::brand::Brand;
use crate::i18n::{t, tf};
use crate::backend::{Task, TaskLane, TaskStatus};
use crate::ui::{self, format};

/// Det, der trækkes: kortets opgave.
#[derive(Clone, Debug)]
pub struct DragTask {
    pub id: String,
    pub title: SharedString,
    /// Kolonnen (indeks på tavlen), kortet kommer fra.
    pub from: Option<usize>,
    pub palette: Palette,
}

/// Kortet under musen, mens der trækkes.
struct DragPreview {
    title: SharedString,
    palette: Palette,
}

impl Render for DragPreview {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        h_flex()
            .w(px(240.))
            .gap_2()
            .px_3()
            .py_2()
            .rounded(px(10.))
            .border_1()
            .border_color(hsla_of(self.palette.accent))
            .bg(hsla_of(self.palette.bg))
            .text_color(hsla_of(self.palette.fg))
            .text_sm()
            .font_weight(FontWeight::MEDIUM)
            .shadow_lg()
            .child(ikon(Ic::GripVertical, 14., hsla_of(self.palette.accent)))
            .child(self.title.clone())
    }
}

impl OpgaverScreen {
    pub(super) fn render_board(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let today = self.ctx.backend.today();
        let mut filters = self.filters(cx);
        // Boardets kolonner er statusserne; listens statusfilter hører ikke til.
        filters.status = None;
        let cols = logic::board_columns(
            &d.tasks,
            &d.customers,
            &d.projects,
            &filters,
            today,
            &d.lanes,
        );
        if d.tasks.is_empty() {
            return self.render_empty(b, d, &filters, cx);
        }
        let any = cols.iter().any(|c| !c.is_empty());
        let hint = if !any && (filters.narrows() || filters.hide_done) {
            Some(
                ui::muted(b, "opgaver-board-ingen", t("opgaver.list.none_body"))
                    .px_1()
                    .into_any_element(),
            )
        } else {
            None
        };
        v_flex()
            .gap_3()
            .children(hint)
            .child(
                div()
                    .id("opgaver-board")
                    .flex()
                    .flex_row()
                    .gap_3()
                    .items_start()
                    .overflow_x_scroll()
                    .pb_2()
                    .children(d.lanes.iter().zip(cols).enumerate().map(
                        |(ix, (lane, tasks))| self.render_column(b, d, ix, lane, tasks, today, cx),
                    )),
            )
            .into_any_element()
    }

    #[allow(clippy::too_many_arguments)]
    fn render_column(
        &self,
        b: &Brand,
        d: &Data,
        ix: usize,
        lane: &TaskLane,
        tasks: Vec<&Task>,
        today: NaiveDate,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let dark = b.dark;
        let p = logic::lane_palette(lane, dark);
        let name = lane.name.as_str();
        // Hurtig oprettelse giver kolonnens gamle status (som web's "+").
        let status = logic::legacy_status_for_lane(lane, TaskStatus::Todo);
        let count = tasks.len();
        let over = b.primary_soft;
        let edge = b.primary;
        let adding = self.inline.as_ref().is_some_and(|i| i.lane == Some(ix));
        let header = h_flex()
            .gap_2()
            .items_center()
            .child(ikon(lane_icon(lane), 18., hsla_of(p.accent)))
            .child(ui::heading(
                b,
                SharedString::from(format!("kolonne-{ix}-titel")),
                name,
                3,
            ))
            .child(
                div()
                    .px_1p5()
                    .rounded_full()
                    .text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .bg(hsla_of(p.bg))
                    .text_color(hsla_of(p.fg))
                    .child(count.to_string()),
            )
            .child(div().flex_1())
            .child(
                icon_button(
                    b,
                    SharedString::from(format!("kolonne-{ix}-tilfoej")),
                    Ic::Plus,
                    tf("opx.board.add_in", &[("status", name)]),
                    b.grey,
                )
                .on_click(cx.listener(move |this, _, w, cx| {
                    this.open_inline(status, Some(ix), w, cx)
                })),
            );
        let cards: Vec<AnyElement> = tasks
            .iter()
            .map(|t| self.render_card(b, d, t, today, cx))
            .collect();
        let empty_column = cards.is_empty() && !adding;
        let body = if cards.is_empty() && !adding {
            vec![
                div()
                    .px_3()
                    .py_6()
                    .rounded(px(10.))
                    .border_1()
                    .border_dashed()
                    .border_color(b.border)
                    .text_xs()
                    .text_color(b.grey)
                    .text_center()
                    .child(t("opx.board.empty_column"))
                    .into_any_element(),
            ]
        } else {
            cards
        };
        ui::el(
            SharedString::from(format!("kolonne-{ix}")),
            Role::Group,
            if count == 1 {
                tf("opx.board.column_label_one", &[("status", name)])
            } else {
                tf(
                    "opx.board.column_label",
                    &[("status", name), ("count", &count.to_string())],
                )
            },
        )
        .flex_1()
        .min_w(px(236.))
        .flex()
        .flex_col()
        .gap_2()
        .p_2()
        .rounded(px(12.))
        .bg(b.sidebar)
        .border_1()
        .border_color(b.border)
        .drag_over::<DragTask>(move |s, _, _, _| s.bg(over).border_color(edge))
        .on_drop(cx.listener(move |this, drag: &DragTask, _, cx| {
            if drag.from != Some(ix) {
                this.move_to_lane(&drag.id, ix, cx);
            }
        }))
        .child(header)
        .children(self.render_inline(b, Some(ix), cx))
        .child(if empty_column {
            body.into_iter().next().unwrap_or_else(|| div().into_any_element())
        } else {
            ui::list(
                SharedString::from(format!("kolonne-{ix}-kort")),
                tf(
                    "opx.board.cards_label",
                    &[("status", name), ("count", &count.to_string())],
                ),
            )
            .gap_2()
            .children(body)
            .into_any_element()
        })
        .into_any_element()
    }

    /// Hurtig oprettelse øverst i kolonnen `lane` (eller øverst på listen
    /// med `None`).
    pub(super) fn render_inline(
        &self,
        b: &Brand,
        lane: Option<usize>,
        cx: &mut Context<Self>,
    ) -> Option<Div> {
        let f = self.inline.as_ref().filter(|i| i.lane == lane)?;
        let where_ = match lane.and_then(|ix| self.data.ready()?.lanes.get(ix)) {
            Some(l) => l.name.clone(),
            None => status_label(f.status).to_string(),
        };
        let save_busy = f.busy;
        let projects_left = f.project.read(cx).selected_value().is_some();
        let card = v_flex()
            .gap_2()
            .p_2()
            .rounded(px(10.))
            .bg(b.surface)
            .border_1()
            .border_color(b.primary)
            .child(
                ui::el(
                    "opgaver-inline",
                    Role::Group,
                    tf("opx.inline.label", &[("status", &where_)]),
                )
                .flex()
                .flex_col()
                .gap_2()
                .child(Input::new(&f.title).id("opgaver-inline-titel").aria_label(t("opx.inline.title_label")))
                .child(if projects_left {
                    div()
                        .child(
                            Select::new(&f.project)
                                .id("opgaver-inline-projekt")
                                .accessibility_label(t("opgaver.field.project"))
                                .small()
                                .menu_max_h(px(280.)),
                        )
                        .into_any_element()
                } else {
                    ui::muted(b, "opgaver-inline-intet-projekt", t("opx.inline.no_project"))
                        .into_any_element()
                }),
            )
            .children(f.error.clone().map(|e| {
                crate::ui::forms::form_error(b, "opgaver-inline-fejl", e)
            }))
            .child(
                h_flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        gpui_kit::component::button::Button::new("opgaver-inline-annuller")
                            .label(t("ui.form.cancel"))
                            .small()
                            .on_click(cx.listener(|this, _, w, cx| this.close_inline(w, cx))),
                    )
                    .child({
                        use gpui_kit::component::Disableable as _;
                        use gpui_kit::component::button::ButtonVariants as _;
                        gpui_kit::component::button::Button::new("opgaver-inline-gem")
                            .label(t("opx.inline.save"))
                            .small()
                            .primary()
                            .loading(save_busy)
                            .disabled(save_busy)
                            .on_click(cx.listener(|this, _, _, cx| this.save_inline(cx)))
                    }),
            );
        Some(card)
    }

    fn render_card(
        &self,
        b: &Brand,
        d: &Data,
        task: &Task,
        today: NaiveDate,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let dark = b.dark;
        let year = today.year();
        let customer = logic::customer_of(&d.customers, &d.projects, task);
        let lane = logic::resolve_lane(task, &d.lanes);
        let lane_name = lane
            .and_then(|ix| d.lanes.get(ix))
            .map_or_else(|| status_label(task.status).to_string(), |l| l.name.clone());
        let accent = logic::customer_accent(customer, dark);
        let sp = lane
            .and_then(|ix| d.lanes.get(ix))
            .map_or_else(|| logic::status_palette(task.status, dark), |l| logic::lane_palette(l, dark));
        let overdue = logic::is_overdue(task, today);
        let selected = self.selected.as_deref() == Some(task.id.as_str());
        let (edge, bg, ink) = match accent {
            Some(a) => (hsla_of(a.edge), hsla_of(a.tint), hsla_of(a.text)),
            None => (b.border, b.card, b.ink),
        };
        let sub = match accent {
            Some(a) => hsla_of(a.text),
            None => b.grey,
        };
        let place = place_label(d, task);
        let due_text = task.due.map(|d| format::date_medium(d, year));
        let time = logic::time_text(task, t("opx.card.of"), t("opx.unit.minute"), t("ui.unit.hour"));
        let over_estimate = task
            .estimate_minutes
            .is_some_and(|e| e > 0 && task.logged_minutes > e);
        let mut parts: Vec<String> = [Some(task.title.clone()), place.clone(), Some(lane_name)]
            .into_iter()
            .flatten()
            .collect();
        if let Some(p) = task.priority {
            parts.push(tf("opx.card.priority", &[("priority", priority_label(p))]));
        }
        if let Some(due) = &due_text {
            parts.push(tf("opgaver.row.due", &[("date", due)]));
        }
        if overdue {
            parts.push(t("opx.card.overdue_word").to_string());
        }
        parts.push(time.clone());
        let label = parts.join(", ");
        let open_id = task.id.clone();
        let timer_id = task.id.clone();
        let drag = DragTask {
            id: task.id.clone(),
            title: task.title.clone().into(),
            from: lane,
            palette: sp,
        };
        let body = pressable(
            b,
            SharedString::from(format!("kort-{}", task.id)),
            Role::ListItem,
            label,
        )
        .aria_selected(selected)
        .w_full()
        .flex()
        .flex_col()
        .gap_2()
        .p_2p5()
        .pr(px(34.))
        .child(
            div()
                .text_sm()
                .font_weight(FontWeight::MEDIUM)
                .text_color(ink)
                .child(task.title.clone()),
        )
        // Kunde · Projekt; linjen udelades, når opgaven har ingen af dem.
        .children(place.map(|place| {
            h_flex()
                .gap_1p5()
                .items_center()
                .text_xs()
                .text_color(sub)
                .child(dot(b, customer.and_then(logic::customer_color)))
                .child(div().min_w_0().child(place))
        }))
        .child(
            h_flex()
                .gap_1()
                .flex_wrap()
                .children(task.priority.map(|p| {
                    pill(
                        Some(priority_icon(p)),
                        priority_label(p),
                        logic::priority_palette(p, dark),
                    )
                }))
                .children(due_text.map(|due| {
                    if overdue {
                        pill(
                            Some(Ic::AlertTriangle),
                            format!("{due} · {}", t("opx.card.overdue")),
                            logic::priority_palette(crate::backend::TaskPriority::Urgent, dark),
                        )
                    } else {
                        h_flex()
                            .gap_1()
                            .items_center()
                            .text_xs()
                            .text_color(sub)
                            .child(ikon(Ic::Calendar, 12., sub))
                            .child(due)
                    }
                }))
                .child(
                    h_flex()
                        .gap_1()
                        .items_center()
                        .text_xs()
                        .text_color(if over_estimate { b.danger } else { sub })
                        .child(ikon(Ic::Clock, 12., if over_estimate { b.danger } else { sub }))
                        .child(time),
                ),
        )
        .children(
            logic::progress_fraction(task)
                .map(|f| progress_bar(b, f, sp.accent, over_estimate)),
        )
        .on_click(cx.listener(move |this, _, _, cx| this.select(&open_id, cx)));
        div()
            .id(SharedString::from(format!("kort-ramme-{}", task.id)))
            .relative()
            .w_full()
            .rounded(px(10.))
            .overflow_hidden()
            .border_1()
            .border_color(if selected { b.primary } else { b.border })
            .bg(edge)
            .pl(px(4.))
            .cursor_grab()
            .on_drag(drag, |d, _, _, cx| {
                cx.new(|_| DragPreview {
                    title: d.title.clone(),
                    palette: d.palette,
                })
            })
            .child(div().w_full().bg(bg).child(body))
            .child(
                div().absolute().top(px(4.)).right(px(4.)).child(
                    icon_button(
                        b,
                        SharedString::from(format!("kort-{}-timer", task.id)),
                        Ic::Play,
                        tf("opgaver.row.start_timer_on", &[("title", &task.title)]),
                        if accent.is_some() { ink } else { b.primary },
                    )
                    .on_click(cx.listener(move |this, _, _, cx| this.start_timer(&timer_id, cx))),
                ),
            )
            .into_any_element()
    }
}
