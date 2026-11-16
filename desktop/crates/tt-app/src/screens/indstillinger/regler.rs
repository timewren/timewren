//! Indstillinger → Sporing → Regler (ux-vaelger): brugerens regler og de
//! lærte mønstre med mål og træffere de sidste 14 dage. Ret målet (i den
//! fælles mål-vælger), slå fra på denne computer, og slet.

use gpui_kit::component::button::ButtonVariants as _;
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::{Customer, Id, Project, RuleOrigin, RuleRow};
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf, tf_n};
use crate::ui::icons::Icon;
use crate::ui::maal::PickTarget;
use crate::ui::maalvaelger::{TargetPicker, TargetPickerEvent};
use crate::ui::{self, Loadable, Tone, farver, pickers};

#[derive(Clone, Debug)]
pub struct Data {
    pub rows: Vec<RuleRow>,
    pub customers: Vec<Customer>,
    pub projects: Vec<Project>,
}

impl Data {
    /// Målet som tekst: "Kunde · Projekt", "Intern tid · Projekt" eller "Ikke arbejde".
    pub fn target_label(&self, r: &RuleRow) -> String {
        if r.not_work {
            return t("maal.regler.ikke_arbejde").into();
        }
        let customer = r.customer_id.as_deref().map(|c| {
            self.customers
                .iter()
                .find(|x| x.id == c)
                .map_or_else(|| t("maal.ukendt_kunde").to_string(), |x| x.name.clone())
        });
        let project = r
            .project_id
            .as_deref()
            .and_then(|p| self.projects.iter().find(|x| x.id == p))
            .map(|p| p.name.clone());
        match (customer, project) {
            (Some(c), Some(p)) => format!("{c} · {p}"),
            (Some(c), None) => c,
            (None, Some(p)) => format!("{} · {p}", t("maal.intern")),
            (None, None) => t("maal.intern").into(),
        }
    }

    /// Skærmlæserens tekst for en række.
    pub fn row_label(&self, r: &RuleRow) -> String {
        let kilde = match r.origin {
            RuleOrigin::Rule => t("maal.regler.regel").to_string(),
            RuleOrigin::Pattern => tf("maal.regler.laert", &[("n", &r.confirmations.to_string())]),
        };
        let mut s = tf(
            "maal.regler.raekke",
            &[
                ("slags", t(r.kind.key())),
                ("vaerdi", &r.value),
                ("maal", &self.target_label(r)),
                ("kilde", &kilde),
                ("traeffere", &tf_n("maal.regler.traeffere", r.hits, &[])),
            ],
        );
        if !r.active {
            s.push_str(", ");
            s.push_str(t("maal.regler.slaaet_fra"));
        }
        s
    }
}

pub struct Regler {
    ctx: AppCtx,
    pub data: Loadable<Data>,
    picker: Entity<TargetPicker>,
    /// Rækken, hvis mål rettes i vælgeren.
    pub retarget: Option<RuleRow>,
    /// Rækken, der spørges om at slette.
    pub confirm_delete: Option<Id>,
    notice: Option<(SharedString, bool)>,
    busy: bool,
    _subs: Vec<Subscription>,
}

impl Regler {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let picker = cx.new(|cx| TargetPicker::new(ctx.clone(), "regel-vaelger", window, cx).without_bare_internal());
        let subs = vec![
            cx.observe(&ctx.hub, |this: &mut Self, _, cx| this.reload(cx)),
            cx.subscribe_in(&picker, window, Self::on_picker),
        ];
        let mut this = Regler {
            ctx,
            data: Loadable::Loading,
            picker,
            retarget: None,
            confirm_delete: None,
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
                Ok(Data {
                    rows: b.rule_rows()?,
                    customers: b.customers(true)?,
                    projects: b.projects(None, true)?,
                })
            },
            |this, res, _| {
                this.data = match res {
                    Ok(d) => Loadable::Ready(d),
                    Err(e) => Loadable::Failed(e.to_string().into()),
                };
            },
        );
    }

    fn run(&mut self, msg: &'static str, cx: &mut Context<Self>, op: impl FnOnce(&dyn crate::backend::Backend) -> crate::backend::Result<()> + Send + 'static) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.notice = None;
        self.ctx.mutate(cx, op, move |this, res, cx| {
            this.busy = false;
            this.notice = Some(match res {
                Ok(()) => (t(msg).into(), false),
                Err(e) => (e.to_string().into(), true),
            });
            this.reload(cx);
        });
    }

    pub fn open_retarget(&mut self, row: RuleRow, window: &mut Window, cx: &mut Context<Self>) {
        let what = format!("{} {}", t(row.kind.key()).to_lowercase(), row.value);
        let title = tf("maal.regler.ret_titel", &[("hvad", &what)]);
        self.retarget = Some(row);
        self.picker.update(cx, |p, cx| p.open(title, vec![], window, cx));
        cx.notify();
    }

    fn on_picker(&mut self, _: &Entity<TargetPicker>, ev: &TargetPickerEvent, _: &mut Window, cx: &mut Context<Self>) {
        let Some(row) = self.retarget.take() else {
            return;
        };
        if let TargetPickerEvent::Picked(target) = ev {
            let PickTarget { customer_id, project_id, .. } = target.clone();
            self.run("maal.regler.gemt", cx, move |b| b.set_rule_target(&row, customer_id, project_id));
        }
        cx.notify();
    }

    pub fn toggle(&mut self, row: RuleRow, cx: &mut Context<Self>) {
        let active = !row.active;
        self.run("maal.regler.gemt", cx, move |b| b.set_rule_active(&row, active));
    }

    pub fn delete(&mut self, row: RuleRow, cx: &mut Context<Self>) {
        self.confirm_delete = None;
        self.run("maal.regler.slettet", cx, move |b| b.delete_rule_row(&row));
    }

    fn render_row(&self, b: &Brand, d: &Data, i: usize, r: &RuleRow, cx: &mut Context<Self>) -> AnyElement {
        let color = if r.not_work {
            b.grey
        } else {
            farver::color_in(&d.customers, r.customer_id.as_deref())
        };
        let kilde = match r.origin {
            RuleOrigin::Rule => t("maal.regler.regel").to_string(),
            RuleOrigin::Pattern => tf("maal.regler.laert", &[("n", &r.confirmations.to_string())]),
        };
        let asking = self.confirm_delete.as_ref() == Some(&r.id);
        let (r1, r2, r3) = (r.clone(), r.clone(), r.clone());
        let what = format!("{} {}", t(r.kind.key()).to_lowercase(), r.value);
        ui::list_row(b, SharedString::from(format!("regel-{i}")), d.row_label(r))
            .when(!r.active, |d| d.opacity(0.6))
            .child(div().size(px(10.)).flex_none().rounded_full().bg(color))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .min_w_0()
                            .child(ui::badge(b, SharedString::from(format!("regel-{i}-slags")), t(r.kind.key()), Tone::Neutral))
                            .child(div().truncate().font_weight(FontWeight::MEDIUM).child(r.value.clone())),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(b.grey)
                            .truncate()
                            .child(format!(
                                "→ {} · {} · {}",
                                d.target_label(r),
                                kilde,
                                tf_n("maal.regler.traeffere", r.hits, &[])
                            )),
                    ),
            )
            .when(!r.active, |d| {
                d.child(ui::badge(b, SharedString::from(format!("regel-{i}-fra")), t("maal.regler.slaaet_fra"), Tone::Warning))
            })
            .child(if asking {
                h_flex()
                    .gap_1()
                    .items_center()
                    .child(ui::text(SharedString::from(format!("regel-{i}-spoerg")), tf("maal.regler.slet_spoerg", &[("hvad", &what)])).text_xs())
                    .child(ui::a11y_button(
                        SharedString::from(format!("regel-{i}-slet-ja")),
                        t("maal.regler.slet_ja"),
                        self.busy,
                        |b| b.danger().small(),
                        cx.listener(move |this, _, _, cx| this.delete(r3.clone(), cx)),
                    ))
                    .child(ui::a11y_button(
                        SharedString::from(format!("regel-{i}-slet-nej")),
                        t("maal.regler.slet_nej"),
                        false,
                        |b| b.ghost().small(),
                        cx.listener(|this, _, _, cx| {
                            this.confirm_delete = None;
                            cx.notify();
                        }),
                    ))
                    .into_any_element()
            } else {
                let id = r.id.clone();
                let active = r.active;
                h_flex()
                    .gap_1()
                    .child(ui::a11y_button(
                        SharedString::from(format!("regel-{i}-ret")),
                        t("maal.regler.ret"),
                        self.busy,
                        |b| b.ghost().small().icon(Icon::Pencil),
                        cx.listener(move |this, _, w, cx| this.open_retarget(r1.clone(), w, cx)),
                    ))
                    .child(ui::a11y_button(
                        SharedString::from(format!("regel-{i}-til-fra")),
                        if r.active { t("maal.regler.fra") } else { t("maal.regler.til") },
                        self.busy,
                        move |b| b.ghost().small().icon(if active { Icon::EyeOff } else { Icon::Eye }),
                        cx.listener(move |this, _, _, cx| this.toggle(r2.clone(), cx)),
                    ))
                    .child(ui::a11y_button(
                        SharedString::from(format!("regel-{i}-slet")),
                        t("maal.regler.slet"),
                        self.busy,
                        |b| b.ghost().small().icon(Icon::Trash2),
                        cx.listener(move |this, _, _, cx| {
                            this.confirm_delete = Some(id.clone());
                            cx.notify();
                        }),
                    ))
                    .into_any_element()
            })
            .into_any_element()
    }
}

impl Render for Regler {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let body: AnyElement = match &self.data {
            Loadable::Loading => ui::loading_state(&b, "regler-indlaeser", t("maal.regler.henter")).into_any_element(),
            Loadable::Failed(e) => ui::error_state(&b, "regler-fejl", e.clone()).into_any_element(),
            Loadable::Ready(d) if d.rows.is_empty() => ui::muted(&b, "regler-tom", t("maal.regler.tom")).into_any_element(),
            Loadable::Ready(d) => {
                let d = d.clone();
                let mut list = ui::list("regler-liste", t("maal.regler.titel"));
                for (i, r) in d.rows.iter().enumerate() {
                    list = list.child(self.render_row(&b, &d, i, r, cx));
                }
                list.into_any_element()
            }
        };
        let notice = self
            .notice
            .clone()
            .map(|(m, err)| pickers::notice(&b, "regler-besked", m, err));
        v_flex()
            .id("regler")
            .gap_2()
            .pt_4()
            .border_t_1()
            .border_color(b.border)
            .child(ui::heading(&b, "regler-titel", t("maal.regler.titel"), 3))
            .child(ui::muted(&b, "regler-hjaelp", t("maal.regler.hjaelp")).text_xs())
            .children(notice)
            .child(body)
            .when(self.retarget.is_some(), |d| {
                d.child(ui::modal(
                    "regel-vaelger-dialog",
                    self.picker.read(cx).title(),
                    self.picker.clone(),
                    cx.listener(|this, _: &MouseDownEvent, _, cx| {
                        this.retarget = None;
                        cx.notify();
                    }),
                ))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::Data;
    use crate::backend::{Backend, MockBackend};
    use chrono::NaiveDate;

    #[test]
    fn maal_og_label_for_regler_og_moenstre() {
        let m = MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 28).unwrap());
        let d = Data {
            rows: m.rule_rows().unwrap(),
            customers: m.customers(true).unwrap(),
            projects: m.projects(None, true).unwrap(),
        };
        assert_eq!(d.target_label(&d.rows[0]), "Bageriet på Hjørnet · Ny webshop");
        assert_eq!(d.target_label(&d.rows[1]), crate::i18n::t("maal.regler.ikke_arbejde"));
        assert_eq!(
            d.row_label(&d.rows[1]),
            "App Spotify → Ikke arbejde, Regel, 11 træffere, Slået fra"
        );
        assert!(d.row_label(&d.rows[2]).contains("Lært (7×)"));
    }
}
