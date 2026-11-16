//! Projekter: liste grupperet pr. kunde, filter på kunde, valg af om
//! arkiverede vises, opret og ret, arkivér og genaktivér.
//!
//! Tastatur: N = nyt projekt (når skærmen har fokus), Enter i et felt gemmer,
//! Esc lukker formularen.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::InputState;
use gpui_kit::component::select::SelectEvent;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{BackendError, Customer, Id, Project, ProjectInput, ProjectStatus};
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf};
use crate::ui::forms::{self, Choice, ChoiceList, ChoiceState};
use crate::ui::pickers;
use crate::ui::{self, Loadable, Tone, format};

/// Alt skærmen viser, hentet samlet.
#[derive(Clone, Debug)]
pub struct Data {
    pub customers: Vec<Customer>,
    pub projects: Vec<Project>,
}

/// Fejl pr. felt i projektformularen.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProjectErrors {
    pub customer: Option<&'static str>,
    pub name: Option<&'static str>,
    pub rate: Option<&'static str>,
    pub budget: Option<&'static str>,
}

/// Validerer formularens felter. Ren funktion, så den kan testes.
pub fn validate_project(
    customer_id: Option<&str>,
    name: &str,
    rate: &str,
    budget: &str,
) -> Result<ProjectInput, ProjectErrors> {
    let mut err = ProjectErrors::default();
    if customer_id.is_none() {
        err.customer = Some(t("projekter.fejl.kunde"));
    }
    if name.trim().is_empty() {
        err.name = Some(t("projekter.fejl.navn"));
    }
    let rate = forms::parse_kr(rate).map_err(|e| err.rate = Some(e)).ok();
    let budget = pickers::parse_optional_total_hours(budget)
        .map_err(|e| err.budget = Some(e))
        .ok();
    if err != ProjectErrors::default() {
        return Err(err);
    }
    Ok(ProjectInput {
        customer_id: customer_id.unwrap_or_default().to_string(),
        name: name.trim().to_string(),
        hourly_rate: rate.flatten(),
        budget_minutes: budget.flatten(),
    })
}

/// Projekterne grupperet pr. kunde (kundens navn A-Å, projekter A-Å).
/// `customer` indsnævrer til én kunde; arkiverede projekter vises kun med `archived`.
/// Kunder uden synlige projekter udelades.
pub fn group_projects<'a>(
    customers: &'a [Customer],
    projects: &'a [Project],
    customer: Option<&str>,
    archived: bool,
) -> Vec<(&'a Customer, Vec<&'a Project>)> {
    let mut groups: Vec<(&Customer, Vec<&Project>)> = customers
        .iter()
        .filter(|c| customer.is_none_or(|id| c.id == id))
        .filter_map(|c| {
            let mut ps: Vec<&Project> = projects
                .iter()
                .filter(|p| p.customer_id == c.id)
                .filter(|p| archived || p.status != ProjectStatus::Archived)
                .collect();
            ps.sort_by_key(|p| p.name.to_lowercase());
            (!ps.is_empty()).then_some((c, ps))
        })
        .collect();
    groups.sort_by_key(|(c, _)| c.name.to_lowercase());
    groups
}

/// Nøgle til statusvalget i formularen.
pub fn status_key(s: ProjectStatus) -> &'static str {
    match s {
        ProjectStatus::Active => "active",
        ProjectStatus::Paused => "paused",
        ProjectStatus::Completed => "completed",
        ProjectStatus::Archived => "archived",
    }
}

pub fn status_from_key(key: &str) -> Option<ProjectStatus> {
    [
        ProjectStatus::Active,
        ProjectStatus::Paused,
        ProjectStatus::Completed,
        ProjectStatus::Archived,
    ]
    .into_iter()
    .find(|s| status_key(*s) == key)
}

/// Statussens navn på det valgte sprog.
pub fn status_label(s: ProjectStatus) -> &'static str {
    match s {
        ProjectStatus::Active => t("projekter.status.aktiv"),
        ProjectStatus::Paused => t("projekter.status.pause"),
        ProjectStatus::Completed => t("projekter.status.afsluttet"),
        ProjectStatus::Archived => t("projekter.status.arkiveret"),
    }
}

/// Statusvalg i formularen. "Arkiveret" er kun med, når projektet allerede er det.
pub fn status_choices(include_archived: bool) -> Vec<Choice> {
    let mut v: Vec<ProjectStatus> = vec![
        ProjectStatus::Active,
        ProjectStatus::Paused,
        ProjectStatus::Completed,
    ];
    if include_archived {
        v.push(ProjectStatus::Archived);
    }
    v.into_iter()
        .map(|s| Choice::new(status_key(s), status_label(s)))
        .collect()
}

fn status_tone(s: ProjectStatus) -> Tone {
    match s {
        ProjectStatus::Active => Tone::Primary,
        ProjectStatus::Paused => Tone::Warning,
        ProjectStatus::Completed | ProjectStatus::Archived => Tone::Neutral,
    }
}

/// "850,00 kr/t" eller "Kundens sats".
pub fn rate_text(p: &Project) -> String {
    p.hourly_rate
        .map(|r| tf("projekter.sats.pr_time", &[("pris", &format::money(r))]))
        .unwrap_or_else(|| t("projekter.sats.kundens").into())
}

/// "Budget 40 t" eller "Intet budget".
pub fn budget_text(p: &Project) -> String {
    p.budget_minutes
        .map(|m| tf("projekter.budget.med", &[("timer", &format::hours(m))]))
        .unwrap_or_else(|| t("projekter.budget.intet").into())
}

struct ProjectForm {
    editing: Option<(Id, ProjectStatus)>,
    customer: Entity<ChoiceState>,
    name: Entity<InputState>,
    rate: Entity<InputState>,
    budget: Entity<InputState>,
    status: Entity<ChoiceState>,
    errors: ProjectErrors,
    error: Option<SharedString>,
    busy: bool,
    _subs: Vec<Subscription>,
}

pub struct ProjekterScreen {
    ctx: AppCtx,
    focus: FocusHandle,
    window: AnyWindowHandle,
    data: Loadable<Data>,
    filter: Entity<ChoiceState>,
    show_archived: bool,
    form: Option<ProjectForm>,
    /// Kvittering eller fejl efter en handling (rolle `Status`/`Alert`).
    notice: Option<(SharedString, bool)>,
    _subs: Vec<Subscription>,
}

impl ProjekterScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter = forms::choice_state(vec![Choice::new("", t("projekter.filter.alle_kunder"))], None, window, cx);
        let subs = vec![
            cx.observe(&ctx.hub, |this, _, cx| this.reload(cx)),
            cx.subscribe(&filter, |_, _, _: &SelectEvent<ChoiceList>, cx| cx.notify()),
        ];
        let mut this = ProjekterScreen {
            ctx,
            focus: cx.focus_handle(),
            window: window.window_handle(),
            data: Loadable::Loading,
            filter,
            show_archived: false,
            form: None,
            notice: None,
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
                    customers: b.customers(true)?,
                    projects: b.projects(None, true)?,
                })
            },
            |this, res, cx| {
                this.data = Loadable::from_result(res);
                this.refresh_filter(cx);
            },
        );
    }

    fn refresh_filter(&mut self, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let mut items = vec![Choice::new("", t("projekter.filter.alle_kunder"))];
        let mut cs: Vec<&Customer> = d
            .customers
            .iter()
            .filter(|c| !c.archived || d.projects.iter().any(|p| p.customer_id == c.id))
            .collect();
        cs.sort_by_key(|c| c.name.to_lowercase());
        items.extend(cs.into_iter().map(|c| Choice::new(c.id.clone(), c.name.clone())));
        let keep = forms::chosen(&self.filter, cx);
        pickers::refresh_choices(self.window, &self.filter, items, keep, cx);
    }

    /// Vælger kunde i filteret (bruges af tests og genveje).
    pub fn set_customer_filter(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        forms::select_value(&self.filter, id, window, cx);
        cx.notify();
    }

    fn customer_filter(&self, cx: &App) -> Option<String> {
        forms::chosen(&self.filter, cx)
    }

    fn set_archived_view(&mut self, on: bool, cx: &mut Context<Self>) {
        self.show_archived = on;
        cx.notify();
    }

    pub fn open_form(&mut self, edit: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(d) = self.data.ready() else {
            return;
        };
        let existing = edit.and_then(|id| d.projects.iter().find(|p| p.id == id)).cloned();
        let current_customer = existing
            .as_ref()
            .map(|p| p.customer_id.clone())
            .or_else(|| self.customer_filter(cx));
        let mut cs: Vec<&Customer> = d
            .customers
            .iter()
            .filter(|c| !c.archived || Some(&c.id) == current_customer.as_ref())
            .collect();
        cs.sort_by_key(|c| c.name.to_lowercase());
        let customer_items: Vec<Choice> = cs
            .into_iter()
            .map(|c| Choice::new(c.id.clone(), c.name.clone()))
            .collect();
        let status = existing.as_ref().map_or(ProjectStatus::Active, |p| p.status);
        let p = existing.as_ref();
        let customer = forms::choice_state(customer_items, current_customer.as_deref(), window, cx);
        let name = forms::input(
            t("projekter.formular.navn_placeholder"),
            p.map_or("", |p| &p.name),
            window,
            cx,
        );
        let rate = forms::input(
            t("projekter.formular.timepris_placeholder"),
            &p.and_then(|p| p.hourly_rate).map(forms::kr_field).unwrap_or_default(),
            window,
            cx,
        );
        let budget = forms::input(
            t("projekter.formular.budget_placeholder"),
            &p.and_then(|p| p.budget_minutes).map(forms::hours_field).unwrap_or_default(),
            window,
            cx,
        );
        let status_state = forms::choice_state(
            status_choices(status == ProjectStatus::Archived),
            Some(status_key(status)),
            window,
            cx,
        );
        let subs = [&name, &rate, &budget]
            .into_iter()
            .map(|i| pickers::enter_to_save(i, window, cx, Self::save_form))
            .collect();
        name.update(cx, |s, cx| s.focus(window, cx));
        self.form = Some(ProjectForm {
            editing: existing.map(|p| (p.id, p.status)),
            customer,
            name,
            rate,
            budget,
            status: status_state,
            errors: ProjectErrors::default(),
            error: None,
            busy: false,
            _subs: subs,
        });
        cx.notify();
    }

    fn close_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.form = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn save_form(&mut self, cx: &mut Context<Self>) {
        let Some(form) = self.form.as_mut() else {
            return;
        };
        if form.busy {
            return;
        }
        let customer = forms::chosen(&form.customer, cx);
        let res = validate_project(
            customer.as_deref(),
            &forms::value(&form.name, cx),
            &forms::value(&form.rate, cx),
            &forms::value(&form.budget, cx),
        );
        let input = match res {
            Ok(i) => i,
            Err(e) => {
                form.errors = e;
                cx.notify();
                return;
            }
        };
        let want = forms::chosen(&form.status, cx)
            .and_then(|k| status_from_key(&k))
            .unwrap_or(ProjectStatus::Active);
        form.errors = ProjectErrors::default();
        form.error = None;
        form.busy = true;
        let editing = form.editing.clone();
        self.ctx.mutate(
            cx,
            move |b| {
                let p = match &editing {
                    Some((id, _)) => b.update_project(id, input)?,
                    None => b.create_project(input)?,
                };
                if p.status != want {
                    b.set_project_status(&p.id, want)?;
                }
                Ok(p.name)
            },
            |this, res, cx| match res {
                Ok(name) => {
                    this.form = None;
                    this.notice = Some((tf("projekter.besked.gemt", &[("navn", &name)]).into(), false));
                    cx.notify();
                }
                Err(e) => {
                    if let Some(f) = this.form.as_mut() {
                        f.busy = false;
                        f.error = Some(e.to_string().into());
                    }
                }
            },
        );
    }

    pub fn set_status(&mut self, id: &str, status: ProjectStatus, cx: &mut Context<Self>) {
        let id = id.to_string();
        self.ctx.mutate(
            cx,
            move |b| b.set_project_status(&id, status),
            move |this, res: Result<(), BackendError>, _| match res {
                Ok(()) => {
                    let msg = match status {
                        ProjectStatus::Archived => t("projekter.besked.arkiveret"),
                        ProjectStatus::Active => t("projekter.besked.aktivt_igen"),
                        _ => t("projekter.besked.status_aendret"),
                    };
                    this.notice = Some((msg.into(), false));
                }
                Err(e) => this.notice = Some((e.to_string().into(), true)),
            },
        );
    }

    fn on_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.form.is_some() || !self.focus.is_focused(window) {
            return;
        }
        let m = &ev.keystroke.modifiers;
        if m.platform || m.control || m.alt {
            return;
        }
        if ev.keystroke.key == "n" {
            self.open_form(None, window, cx);
            cx.stop_propagation();
        }
    }

    fn render_row(&self, b: &Brand, p: &Project, cx: &mut Context<Self>) -> AnyElement {
        let archived = p.status == ProjectStatus::Archived;
        let rate = rate_text(p);
        let budget = budget_text(p);
        let edit_id = p.id.clone();
        let status_id = p.id.clone();
        let next = if archived { ProjectStatus::Active } else { ProjectStatus::Archived };
        ui::list_row(
            b,
            SharedString::from(format!("projekt-{}", p.id)),
            tf(
                "projekter.raekke.label",
                &[
                    ("navn", &p.name),
                    ("status", status_label(p.status)),
                    ("sats", &rate),
                    ("budget", &budget),
                ],
            ),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .font_weight(FontWeight::MEDIUM)
                .text_color(if archived { b.grey } else { b.ink })
                .child(p.name.clone()),
        )
        .child(div().w(px(90.)).child(ui::badge(
            b,
            SharedString::from(format!("projekt-{}-status", p.id)),
            status_label(p.status),
            status_tone(p.status),
        )))
        .child(div().w(px(120.)).text_color(b.grey).child(rate))
        .child(div().w(px(110.)).text_color(b.grey).child(budget))
        .child(
            h_flex()
                .gap_2()
                .child(
                    forms::small_button(SharedString::from(format!("projekt-ret-{}", p.id)), t("projekter.raekke.ret"))
                        .accessibility_label(tf(
                            "projekter.raekke.ret_label",
                            &[("navn", &p.name)],
                        ))
                        .on_click(cx.listener(move |this, _, w, cx| {
                            this.open_form(Some(&edit_id), w, cx)
                        })),
                )
                .child(
                    forms::small_button(
                        SharedString::from(format!("projekt-arkiv-{}", p.id)),
                        if archived {
                            t("projekter.raekke.genaktiver")
                        } else {
                            t("projekter.raekke.arkiver")
                        },
                    )
                    .accessibility_label(tf(
                        if archived {
                            "projekter.raekke.genaktiver_label"
                        } else {
                            "projekter.raekke.arkiver_label"
                        },
                        &[("navn", &p.name)],
                    ))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.set_status(&status_id, next, cx)
                    })),
                ),
        )
        .into_any_element()
    }

    fn render_groups(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let filter = self.customer_filter(cx);
        let groups = group_projects(&d.customers, &d.projects, filter.as_deref(), self.show_archived);
        if groups.is_empty() {
            let (title, body) = if d.projects.is_empty() {
                (
                    t("projekter.tom.ingen_endnu"),
                    t("projekter.tom.ingen_endnu_tekst"),
                )
            } else if filter.is_some() {
                (
                    t("projekter.tom.ingen"),
                    t("projekter.tom.ingen_kunde_tekst"),
                )
            } else {
                (
                    t("projekter.tom.ingen"),
                    t("projekter.tom.alle_arkiveret_tekst"),
                )
            };
            return ui::empty_state_icon(b, "projekter-tom", Icon::Folder, title, body)
                .child(
                    Button::new("projekter-tom-ny")
                        .icon(Icon::FolderPlus)
                        .label(t("projekter.nyt"))
                        .primary()
                        .on_click(cx.listener(|this, _, w, cx| this.open_form(None, w, cx))),
                )
                .into_any_element();
        }
        v_flex()
            .gap_5()
            .children(groups.into_iter().map(|(c, ps)| {
                v_flex()
                    .gap_1()
                    .child(ui::heading(
                        b,
                        SharedString::from(format!("projekter-gruppe-{}", c.id)),
                        c.name.clone(),
                        3,
                    ))
                    .child(
                        ui::list(
                            SharedString::from(format!("projekter-liste-{}", c.id)),
                            tf("projekter.gruppe.liste_label", &[("kunde", &c.name)]),
                        )
                        .children(ps.into_iter().map(|p| self.render_row(b, p, cx))),
                    )
            }))
            .into_any_element()
    }

    fn render_form(&self, b: &Brand, cx: &mut Context<Self>) -> Option<Div> {
        let f = self.form.as_ref()?;
        let title = if f.editing.is_some() {
            t("projekter.formular.titel_ret")
        } else {
            t("projekter.nyt")
        };
        let (overlay, dialog) = forms::modal(b, "projekt-formular", title);
        let err = |e: Option<&'static str>| e.map(SharedString::from);
        Some(
            overlay.child(
                dialog
                    .child(forms::select_field(b, "projekt-kunde", t("projekter.formular.kunde"), &f.customer))
                    .children(f.errors.customer.map(|e| {
                        forms::form_error(b, "projekt-kunde-fejl", e)
                    }))
                    .child(forms::text_field(b, "projekt-navn", t("projekter.formular.navn"), &f.name, err(f.errors.name)))
                    .child(
                        h_flex()
                            .gap_3()
                            .items_start()
                            .child(forms::text_field(
                                b,
                                "projekt-timepris",
                                t("projekter.formular.timepris"),
                                &f.rate,
                                err(f.errors.rate),
                            ))
                            .child(forms::text_field(
                                b,
                                "projekt-budget",
                                t("projekter.formular.budget"),
                                &f.budget,
                                err(f.errors.budget),
                            )),
                    )
                    .child(forms::select_field(b, "projekt-status", t("projekter.formular.status"), &f.status))
                    .children(f.error.clone().map(|e| forms::form_error(b, "projekt-formular-fejl", e)))
                    .child(forms::form_buttons(
                        "projekt-formular",
                        t("projekter.formular.gem"),
                        f.busy,
                        cx.listener(|this, _, _, cx| this.save_form(cx)),
                        cx.listener(|this, _, w, cx| this.close_form(w, cx)),
                    )),
            ),
        )
    }
}

impl Render for ProjekterScreen {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let subtitle = self.data.ready().map(|d| {
            let n = d.projects.iter().filter(|p| p.status == ProjectStatus::Active).count();
            SharedString::from(if n == 1 {
                t("projekter.side.et_aktivt").to_string()
            } else {
                tf("projekter.side.aktive", &[("n", &n.to_string())])
            })
        });
        let toolbar = h_flex()
            .gap_3()
            .items_end()
            .child(div().w(px(260.)).child(forms::select_field(
                &b,
                "projekter-kunde",
                t("projekter.formular.kunde"),
                &self.filter,
            )))
            .child(forms::segmented(
                &b,
                "projekter-arkiv",
                t("projekter.arkiv.label"),
                &[t("projekter.arkiv.uden"), t("projekter.arkiv.med")],
                self.show_archived as usize,
                {
                    let view = cx.entity().downgrade();
                    move |ix, _, cx| {
                        let _ = view.update(cx, |this, cx| this.set_archived_view(ix == 1, cx));
                    }
                },
            ))
            .child(div().flex_1())
            .child(
                Button::new("projekt-ny")
                    .icon(Icon::FolderPlus)
                    .label(t("projekter.nyt"))
                    .primary()
                    .tooltip("N")
                    .on_click(cx.listener(|this, _, w, cx| this.open_form(None, w, cx))),
            );
        let content = match &self.data {
            Loadable::Loading => ui::loading_state(&b, "projekter-indlaeser", t("projekter.side.indlaeser")).into_any_element(),
            Loadable::Failed(e) => ui::error_state(&b, "projekter-fejl", e.clone())
                .child(
                    Button::new("projekter-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("projekter.side.proev_igen"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.data = Loadable::Loading;
                            this.reload(cx);
                        })),
                )
                .into_any_element(),
            Loadable::Ready(d) => {
                let d = d.clone();
                self.render_groups(&b, &d, cx)
            }
        };
        let notice = self
            .notice
            .clone()
            .map(|(msg, is_err)| pickers::notice(&b, "projekter-besked", msg, is_err));
        div()
            .relative()
            .size_full()
            .track_focus(&self.focus)
            .key_context("Projekter")
            .on_key_down(cx.listener(Self::on_key))
            .capture_key_down(cx.listener(|this, ev: &KeyDownEvent, w, cx| {
                if ev.keystroke.key == "escape" && this.form.is_some() {
                    this.close_form(w, cx);
                    cx.stop_propagation();
                }
            }))
            .child(
                ui::page(&b, "projekter", t("projekter.side.titel"), subtitle)
                    .child(toolbar)
                    .children(notice)
                    .child(content),
            )
            .children(self.render_form(&b, cx))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        budget_text, group_projects, rate_text, status_choices, status_from_key, status_key,
        validate_project,
    };
    use crate::backend::{Customer, Project, ProjectStatus};

    fn c(id: &str, name: &str) -> Customer {
        Customer {
            id: id.into(),
            name: name.into(),
            email: None,
            hourly_rate: None,
            archived: false,
            cvr: None,
            ..Default::default()
        }
    }

    fn p(id: &str, customer: &str, name: &str, status: ProjectStatus) -> Project {
        Project {
            id: id.into(),
            customer_id: customer.into(),
            name: name.into(),
            status,
            hourly_rate: None,
            budget_minutes: None,
            url_patterns: vec![],
        }
    }

    #[test]
    fn validering_samler_alle_fejl() {
        let e = validate_project(None, " ", "abc", "x").unwrap_err();
        assert_eq!(e.customer, Some("Vælg en kunde"));
        assert_eq!(e.name, Some("Skriv projektets navn"));
        assert!(e.rate.is_some() && e.budget.is_some());
        let ok = validate_project(Some("k1"), " Webshop ", "850,5", "40").unwrap();
        assert_eq!(ok.customer_id, "k1");
        assert_eq!(ok.name, "Webshop");
        assert_eq!(ok.hourly_rate, Some(85_050));
        assert_eq!(ok.budget_minutes, Some(2400));
        let tom = validate_project(Some("k1"), "A", "", "").unwrap();
        assert_eq!((tom.hourly_rate, tom.budget_minutes), (None, None));
    }

    #[test]
    fn gruppering_pr_kunde_med_filter_og_arkiv() {
        let customers = vec![c("k2", "Ærø Café"), c("k1", "Bageriet"), c("k3", "Tom kunde")];
        let projects = vec![
            p("a", "k1", "Webshop", ProjectStatus::Active),
            p("b", "k1", "Drift", ProjectStatus::Paused),
            p("c", "k2", "Menukort", ProjectStatus::Archived),
        ];
        let names = |g: Vec<(&Customer, Vec<&Project>)>| {
            g.into_iter()
                .map(|(c, ps)| {
                    (
                        c.name.clone(),
                        ps.into_iter().map(|p| p.name.clone()).collect::<Vec<_>>(),
                    )
                })
                .collect::<Vec<_>>()
        };
        let g = names(group_projects(&customers, &projects, None, false));
        assert_eq!(g, vec![("Bageriet".to_string(), vec!["Drift".to_string(), "Webshop".to_string()])]);
        let g = names(group_projects(&customers, &projects, None, true));
        assert_eq!(g.len(), 2);
        assert_eq!(g[1].0, "Ærø Café");
        let g = names(group_projects(&customers, &projects, Some("k2"), false));
        assert!(g.is_empty());
        let g = names(group_projects(&customers, &projects, Some("k2"), true));
        assert_eq!(g.len(), 1);
    }

    #[test]
    fn status_noegler_og_valg() {
        for s in [
            ProjectStatus::Active,
            ProjectStatus::Paused,
            ProjectStatus::Completed,
            ProjectStatus::Archived,
        ] {
            assert_eq!(status_from_key(status_key(s)), Some(s));
        }
        assert_eq!(status_from_key("x"), None);
        assert_eq!(status_choices(false).len(), 3);
        assert_eq!(status_choices(true).len(), 4);
        assert_eq!(status_choices(false)[1].label.as_ref(), "På pause");
    }

    #[test]
    fn sats_og_budget_som_tekst() {
        let mut x = p("a", "k", "X", ProjectStatus::Active);
        assert_eq!(rate_text(&x), "Kundens sats");
        assert_eq!(budget_text(&x), "Intet budget");
        x.hourly_rate = Some(85_000);
        x.budget_minutes = Some(40 * 60);
        assert_eq!(rate_text(&x), "850,00 kr/t");
        assert_eq!(budget_text(&x), "Budget 40 t");
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe {
    use std::sync::Arc;

    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AppContext as _, TestAppContext};

    use super::ProjekterScreen;
    use crate::backend::{Backend as _, BackendError, MockBackend, ProjectStatus};
    use crate::screens::Screen;
    use crate::testing;

    fn screen(
        cx: &mut TestAppContext,
        app: &gpui_kit::Entity<crate::app::AppView>,
    ) -> gpui_kit::Entity<ProjekterScreen> {
        app.read_with(cx, |a, _| a.view_for(Screen::Projekter))
            .expect("view")
            .downcast::<ProjekterScreen>()
            .expect("projekter")
    }

    #[gpui_kit::test]
    fn projekter_vises_grupperet_og_kan_filtreres(cx: &mut TestAppContext) {
        let (h, app) = testing::open_app(cx, testing::mock());
        testing::navigate(cx, h, &app, Screen::Projekter);
        let a = testing::a11y(cx, h);
        println!("PROBE projekter {:?}", a.roles);
        assert_eq!(a.with_label, a.with_role, "alle roller har label");
        assert_eq!(a.count("Tab"), 10);
        assert_eq!(a.count("Main"), 1);
        assert!(a.has_label("Bageriet på Hjørnet"));
        assert!(a.has_label("Projekter for Bageriet på Hjørnet"));
        assert!(a.has_label("Ny webshop, Aktiv, Kundens sats, Budget 40 t"));
        assert!(a.has_label("SEO-løft, På pause, Kundens sats, Intet budget"));
        assert!(a.has_label_containing("9 aktive projekter"));
        // Arkiverede er skjult som standard.
        assert!(!a.has_label_containing("Hjemmeside, Arkiveret"));
        cx.update_window(h, |_, w, cx| w.click("projekter-arkiv-1", cx)).unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label_containing("Hjemmeside, Arkiveret"));

        // Filter på kunde.
        let s = screen(cx, &app);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_customer_filter("kunde_klinik", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert!(a.has_label("Booking-modul, Aktiv, Kundens sats, Budget 25 t"));
        assert!(!a.has_label_containing("Ny webshop"));
    }

    #[gpui_kit::test]
    fn opret_med_validering_ret_og_arkiver(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, app) = testing::open_app(cx, mock.clone());
        testing::navigate(cx, h, &app, Screen::Projekter);
        cx.update_window(h, |_, w, cx| w.click("projekt-ny", cx)).unwrap();
        cx.run_until_parked();
        // Tom formular: navn mangler, forkert timepris.
        cx.update_window(h, |_, w, cx| {
            w.click("projekt-timepris", cx);
            w.input("abc", cx);
            w.click("projekt-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 1);
        assert!(a.has_label("Skriv projektets navn"));
        assert!(a.has_label("Skriv et beløb i kroner, fx 850"));
        // Udfyld og gem med status "På pause".
        let s = screen(cx, &app);
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| {
                let f = s.form.as_ref().expect("form");
                crate::ui::forms::select_value(&f.customer, "kunde_yoga", w, cx);
                crate::ui::forms::select_value(&f.status, "paused", w, cx);
            });
            w.click("projekt-navn", cx);
            w.input("Nyt medlemssystem", cx);
            w.click("projekt-timepris", cx);
            w.press("cmd-a", cx);
            w.input("950", cx);
            w.click("projekt-budget", cx);
            w.input("12,5", cx);
            w.click("projekt-formular-gem", cx);
        })
        .unwrap();
        cx.run_until_parked();
        let a = testing::a11y(cx, h);
        assert_eq!(a.count("Dialog"), 0, "formularen lukker");
        assert!(a.has_label("Nyt medlemssystem er gemt"));
        let p = mock
            .projects(Some("kunde_yoga"), true)
            .unwrap()
            .into_iter()
            .find(|p| p.name == "Nyt medlemssystem")
            .expect("gemt");
        assert_eq!(p.status, ProjectStatus::Paused);
        assert_eq!(p.hourly_rate, Some(95_000));
        assert_eq!(p.budget_minutes, Some(750));
        assert!(a.has_label("Nyt medlemssystem, På pause, 950,00 kr/t, Budget 12,5 t"));

        // Ret navnet. Filtrér først, så rækken er synlig uden at scrolle.
        let id = p.id.clone();
        cx.update_window(h, |_, w, cx| {
            s.update(cx, |s, cx| s.set_customer_filter("kunde_yoga", w, cx))
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(h, |_, w, cx| w.click(format!("projekt-ret-{id}"), cx)).unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 1);
        cx.update_window(h, |_, w, cx| {
            w.click("projekt-navn", cx);
            w.press("cmd-a", cx);
            w.input("Medlemsportal", cx);
            w.press("enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 0);
        let after = mock.projects(Some("kunde_yoga"), true).unwrap();
        assert!(after.iter().any(|x| x.id == id && x.name == "Medlemsportal"));

        // Arkivér og genaktivér.
        cx.update_window(h, |_, w, cx| w.click(format!("projekt-arkiv-{id}"), cx)).unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Projektet er arkiveret"));
        let st = |m: &MockBackend| {
            m.projects(None, true).unwrap().into_iter().find(|x| x.id == id).unwrap().status
        };
        assert_eq!(st(&mock), ProjectStatus::Archived);
        // Skjult nu, indtil arkiverede vises.
        assert!(!testing::a11y(cx, h).has_label_containing("Medlemsportal, Arkiveret"));
        cx.update_window(h, |_, w, cx| w.click("projekter-arkiv-1", cx)).unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label_containing("Medlemsportal, Arkiveret"));
        cx.update_window(h, |_, w, cx| w.click(format!("projekt-arkiv-{id}"), cx)).unwrap();
        cx.run_until_parked();
        assert!(testing::a11y(cx, h).has_label("Projektet er aktivt igen"));
        assert_eq!(st(&mock), ProjectStatus::Active);

        // Esc lukker en åben formular.
        cx.update_window(h, |_, w, cx| w.click("projekt-ny", cx)).unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 1);
        cx.update_window(h, |_, w, cx| w.press("escape", cx)).unwrap();
        cx.run_until_parked();
        assert_eq!(testing::a11y(cx, h).count("Dialog"), 0);
    }

    #[gpui_kit::test]
    fn tom_og_fejl(cx: &mut TestAppContext) {
        let empty = Arc::new(MockBackend::empty(testing::today()));
        let (h, app) = testing::open_app(cx, empty);
        testing::navigate(cx, h, &app, Screen::Projekter);
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Ingen projekter endnu"));
        assert_eq!(a.with_label, a.with_role);

        let broken = testing::mock();
        broken.set_failure(Some(BackendError::Offline));
        let (h, app) = testing::open_app(cx, broken);
        testing::navigate(cx, h, &app, Screen::Projekter);
        let a = testing::a11y(cx, h);
        assert!(a.has_label_containing("Fejl: Du er offline"));
        assert!(a.has_label("Prøv igen"));
    }
}
