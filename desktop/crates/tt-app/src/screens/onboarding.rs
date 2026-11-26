//! Første start: vælg cloud (log ind med TimeTrack) eller lokal (licens eller
//! prøve), giv macOS-tilladelser med forklaring, se et første forslag, og
//! flyt evt. lokale data op i TimeTrack.
//!
//! `OnboardingView` er et selvstændigt view. App-roden viser det i stedet for
//! navigationen, til det sender `OnboardingDone`. Deep linket fra browseren
//! (`timetrack://auth?…`) kommer via `Application::on_open_urls` og afleveres
//! med `OnboardingView::receive_callback`.
//!
//! `ImportPanel` (lokal → cloud med dry-run) bruges også under Indstillinger.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Disableable as _, Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{ImportReport, LoginStart, Permission, PermissionState, Permissions};
use crate::brand::{self, Brand, brand};
use crate::i18n::{t, tf};
use crate::screens::login::parse_auth_callback;
use crate::ui::{self, Tone};

/// Køb af livstidslicens (Stripe via web), pr. udgave: se `Edition::buy_url`.
pub const BUY_URL: &str = tt_core::edition::EDITION.buy_url;

// ---------- Import ----------

#[derive(Clone, Debug, PartialEq)]
enum ImportState {
    Idle,
    Running { dry_run: bool },
    Report(ImportReport),
    Failed(SharedString),
}

/// Rækker i importrapporten: (id, tekst, antal).
pub fn import_rows(r: &ImportReport) -> Vec<(&'static str, &'static str, u32)> {
    vec![
        ("kunder", t("onboarding.import.row_customers"), r.customers),
        ("projekter", t("onboarding.import.row_projects"), r.projects),
        ("poster", t("onboarding.import.row_entries"), r.entries),
        ("klippekort", t("onboarding.import.row_punch_cards"), r.punch_cards),
        ("opgaver", t("onboarding.import.row_tasks"), r.tasks),
        ("fakturaer", t("onboarding.import.row_invoices"), r.invoices),
    ]
}

/// Overskrift på rapporten.
pub fn import_summary(r: &ImportReport) -> String {
    let n = r.total();
    if r.failed > 0 {
        return if r.dry_run {
            tf(
                "onboarding.import.summary_dry_failed",
                &[("n", &n.to_string()), ("failed", &r.failed.to_string())],
            )
        } else {
            tf(
                "onboarding.import.summary_failed",
                &[("n", &n.to_string()), ("failed", &r.failed.to_string())],
            )
        };
    }
    match (r.dry_run, n, r.skipped) {
        (true, 0, 0) => t("onboarding.import.summary_dry_nothing").into(),
        (true, 0, s) => tf(
            "onboarding.import.summary_dry_all_moved",
            &[("skipped", &s.to_string())],
        ),
        (true, n, _) => tf("onboarding.import.summary_dry", &[("n", &n.to_string())]),
        (false, 0, _) => t("onboarding.import.summary_nothing_new").into(),
        (false, n, _) => tf("onboarding.import.summary_done", &[("n", &n.to_string())]),
    }
}

pub struct ImportPanel {
    ctx: AppCtx,
    state: ImportState,
}

impl ImportPanel {
    pub fn new(ctx: AppCtx, _cx: &mut Context<Self>) -> Self {
        ImportPanel {
            ctx,
            state: ImportState::Idle,
        }
    }

    pub fn run(&mut self, dry_run: bool, cx: &mut Context<Self>) {
        self.state = ImportState::Running { dry_run };
        cx.notify();
        let op = move |b: &dyn crate::backend::Backend| b.import_local_to_cloud(dry_run);
        let done =
            |this: &mut Self, res: crate::backend::Result<ImportReport>, _: &mut Context<Self>| {
                this.state = match res {
                    Ok(r) => ImportState::Report(r),
                    Err(e) => ImportState::Failed(e.to_string().into()),
                };
            };
        if dry_run {
            self.ctx.fetch(cx, op, done);
        } else {
            self.ctx.mutate(cx, op, done);
        }
    }
}

impl Render for ImportPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let mut col = v_flex().gap_2();
        match &self.state {
            ImportState::Idle => {}
            ImportState::Running { dry_run } => {
                col = col.child(ui::loading_state(
                    &b,
                    "import-koerer",
                    if *dry_run {
                        t("onboarding.import.loading_dry")
                    } else {
                        t("onboarding.import.loading_run")
                    },
                ));
            }
            ImportState::Failed(e) => {
                col = col.child(ui::error_state(&b, "import-fejl", e.clone()));
            }
            ImportState::Report(r) => {
                let summary = import_summary(r);
                col = col
                    .child(
                        ui::el("import-resultat", Role::Status, summary.clone())
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(summary),
                    )
                    .child(ui::list("import-rapport", t("onboarding.import.report")).children(
                        import_rows(r).into_iter().map(|(id, label, n)| {
                            ui::list_row(
                                &b,
                                SharedString::from(format!("import-{id}")),
                                format!("{label}: {n}"),
                            )
                            .px_0()
                            .py_0p5()
                            .child(div().w(px(160.)).child(label))
                            .child(div().text_color(b.grey).child(n.to_string()))
                        }),
                    ))
                    .when(r.skipped > 0, |c| {
                        c.child(ui::muted(
                            &b,
                            "import-sprunget-over",
                            tf("onboarding.import.skipped", &[("n", &r.skipped.to_string())]),
                        ))
                    })
                    .children(r.errors.iter().enumerate().map(|(i, e)| {
                        ui::el(("import-fejl", i), Role::Alert, e.clone())
                            .text_sm()
                            .text_color(b.danger)
                            .child(e.clone())
                    }))
                    .children(r.warnings.iter().enumerate().map(|(i, w)| {
                        ui::el(("import-advarsel", i), Role::Note, w.clone())
                            .text_sm()
                            .text_color(b.warning)
                            .child(w.clone())
                    }));
            }
        }
        let running = matches!(self.state, ImportState::Running { .. });
        let can_import =
            matches!(&self.state, ImportState::Report(r) if r.dry_run && r.total() > 0);
        col.child(
            h_flex()
                .gap_2()
                .child(
                    Button::new("import-proeve")
                        .label(t("onboarding.import.dry_button"))
                        .small()
                        .disabled(running)
                        .on_click(cx.listener(|this, _, _, cx| this.run(true, cx))),
                )
                .child(
                    Button::new("import-flyt")
                        .label(t("onboarding.import.move_button"))
                        .primary()
                        .small()
                        .disabled(running || !can_import)
                        .tooltip(t("onboarding.import.move_tooltip"))
                        .on_click(cx.listener(|this, _, _, cx| this.run(false, cx))),
                ),
        )
    }
}

// ---------- Onboarding ----------

#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    Choose,
    /// Venter på deep linket fra browseren.
    LoginWaiting(LoginStart),
    Local,
    Permissions,
    Demo,
    Import,
}

impl Step {
    /// `TT_ONBOARDING_STEP` til skærmbilleder.
    pub fn from_key(k: &str) -> Option<Step> {
        Some(match k {
            "valg" => Step::Choose,
            "login" => Step::LoginWaiting(LoginStart {
                url: "https://app.timetrack.dk/desktop/login".into(),
                state: "demo".into(),
            }),
            "lokal" => Step::Local,
            "tilladelser" => Step::Permissions,
            "demo" => Step::Demo,
            "import" => Step::Import,
            _ => return None,
        })
    }
}

/// Hvilken tilstand brugeren valgte.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chosen {
    Cloud,
    Local,
}

/// Sendes, når onboarding er færdig. App-roden skifter så til navigationen.
pub struct OnboardingDone;

/// Tilladelser, der stadig mangler (Windows: ingen).
pub fn missing_permissions(p: Permissions) -> Vec<Permission> {
    let mut v = vec![];
    if matches!(
        p.accessibility,
        PermissionState::Denied | PermissionState::Unknown
    ) {
        v.push(Permission::Accessibility);
    }
    if matches!(
        p.screen_recording,
        PermissionState::Denied | PermissionState::Unknown
    ) {
        v.push(Permission::ScreenRecording);
    }
    v
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DemoAnswer {
    Confirmed,
    Corrected,
    Rejected,
}

pub struct OnboardingView {
    ctx: AppCtx,
    pub step: Step,
    chosen: Option<Chosen>,
    license_key: Entity<InputState>,
    paste: Entity<InputState>,
    /// Egen server (self-host); kun i TimeWren.
    server: Entity<InputState>,
    permissions: Option<Permissions>,
    demo: Option<DemoAnswer>,
    import: Entity<ImportPanel>,
    error: Option<SharedString>,
    busy: bool,
    /// Besked om overgangen fra 0.2.x (pakning, `migrate::MigrationReport::notice`).
    migration_notice: Option<SharedString>,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

impl EventEmitter<OnboardingDone> for OnboardingView {}

/// Onboarding som vinduets rod, uden app-roden (skærmbilleder, tests og
/// første start). Sætter tema og den globale `AppCtx`.
pub fn standalone(
    backend: std::sync::Arc<dyn crate::backend::Backend>,
    window: &mut Window,
    cx: &mut App,
) -> Entity<OnboardingView> {
    brand::apply(brand::is_dark(brand::chosen(&*backend), window), cx);
    let ctx = AppCtx::new(backend, cx);
    cx.set_global(ctx.clone());
    cx.new(|cx| OnboardingView::new(ctx, window, cx))
}

impl OnboardingView {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let license_key =
            cx.new(|cx| InputState::new(window, cx).placeholder("TT-XXXX-XXXX-XXXX-XXXX"));
        let paste =
            cx.new(|cx| InputState::new(window, cx).placeholder(format!("{}?code=…&state=…", tt_core::edition::EDITION.redirect_uri())));
        let server = cx.new(|cx| InputState::new(window, cx).placeholder(tt_core::edition::EDITION.web_url));
        let mut subs = vec![
            cx.subscribe(&license_key, |this: &mut Self, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::PressEnter { .. }) {
                    this.activate_license(cx);
                }
            }),
            cx.subscribe(&paste, |this: &mut Self, input, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::PressEnter { .. }) {
                    let url = input.read(cx).value().to_string();
                    this.receive_callback(&url, cx);
                }
            }),
        ];
        // App Store-udgaven: licensdelen tegnes igen ved køb og gendannelse.
        subs.extend(crate::store::observe(cx));
        let import = {
            let ctx = ctx.clone();
            cx.new(|cx| ImportPanel::new(ctx, cx))
        };
        let step = std::env::var("TT_ONBOARDING_STEP")
            .ok()
            .and_then(|k| Step::from_key(&k))
            .unwrap_or(Step::Choose);
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let mut this = OnboardingView {
            ctx,
            step: Step::Choose,
            chosen: None,
            license_key,
            paste,
            server,
            permissions: None,
            demo: None,
            import,
            error: None,
            busy: false,
            migration_notice: None,
            focus,
            _subs: subs,
        };
        this.go(step, cx);
        this
    }

    /// Vis, hvad der er flyttet fra 0.2.x, og om man skal logge ind igen.
    pub fn set_migration_notice(&mut self, text: Option<String>, cx: &mut Context<Self>) {
        self.migration_notice = text.map(SharedString::from);
        cx.notify();
    }

    fn go(&mut self, step: Step, cx: &mut Context<Self>) {
        self.error = None;
        // App Store-udgaven spørger ikke om tilladelser (`render_mas`).
        if step == Step::Permissions && !crate::mas::ENABLED {
            self.ctx.fetch(
                cx,
                |b| b.permissions(),
                |this, res, cx| match res {
                    Ok(p)
                        if missing_permissions(p).is_empty()
                            && this.permissions.is_none()
                            && p.accessibility == PermissionState::NotNeeded =>
                    {
                        // Windows: intet at give. Videre til demoen.
                        this.permissions = Some(p);
                        this.go(Step::Demo, cx);
                    }
                    Ok(p) => this.permissions = Some(p),
                    Err(e) => this.error = Some(e.to_string().into()),
                },
            );
        }
        self.step = step;
        cx.notify();
    }

    pub fn start_login(&mut self, cx: &mut Context<Self>) {
        self.chosen = Some(Chosen::Cloud);
        self.busy = true;
        // Tomt felt: udgavens standardserver. Kun TimeWren viser feltet.
        let server = if tt_core::edition::EDITION.is_timewren() {
            self.server.read(cx).value().trim().to_string()
        } else {
            String::new()
        };
        self.ctx.fetch(
            cx,
            move |b| {
                b.set_server_url(Some(server.as_str()))?;
                b.begin_login()
            },
            |this, res, cx| {
                this.busy = false;
                match res {
                    Ok(start) => {
                        cx.open_url(&start.url);
                        this.go(Step::LoginWaiting(start), cx);
                    }
                    Err(e) => this.error = Some(e.to_string().into()),
                }
            },
        );
    }

    /// Deep linket fra browseren. Kaldes af app-roden (`on_open_urls`) eller
    /// fra indsæt-feltet.
    pub fn receive_callback(&mut self, url: &str, cx: &mut Context<Self>) {
        let Step::LoginWaiting(start) = &self.step else {
            return;
        };
        match parse_auth_callback(url, &start.state) {
            Ok(code) => {
                self.busy = true;
                self.ctx.mutate(
                    cx,
                    move |b| b.complete_login(&code),
                    |this, res, cx| {
                        this.busy = false;
                        match res {
                            Ok(_) => this.go(Step::Permissions, cx),
                            Err(e) => this.error = Some(e.to_string().into()),
                        }
                    },
                );
            }
            Err(e) => {
                self.error = Some(e.to_string().into());
                cx.notify();
            }
        }
    }

    fn activate_license(&mut self, cx: &mut Context<Self>) {
        let key = self.license_key.read(cx).value().to_string();
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| b.activate_license(&key),
            |this, res, cx| {
                this.busy = false;
                match res {
                    Ok(_) => this.go(Step::Permissions, cx),
                    Err(e) => this.error = Some(e.to_string().into()),
                }
            },
        );
    }

    fn start_trial(&mut self, cx: &mut Context<Self>) {
        self.ctx.mutate(
            cx,
            |b| b.start_trial(),
            |this, res, cx| match res {
                Ok(_) => this.go(Step::Permissions, cx),
                Err(e) => this.error = Some(e.to_string().into()),
            },
        );
    }

    fn request(&mut self, p: Permission, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            move |b| {
                b.request_permission(p)?;
                b.permissions()
            },
            |this, res, _| match res {
                Ok(p) => this.permissions = Some(p),
                Err(e) => this.error = Some(e.to_string().into()),
            },
        );
    }

    fn finish(&mut self, cx: &mut Context<Self>) {
        cx.emit(OnboardingDone);
    }

    fn after_demo(&mut self, cx: &mut Context<Self>) {
        if self.chosen == Some(Chosen::Cloud) {
            self.go(Step::Import, cx);
        } else {
            self.finish(cx);
        }
    }

    fn back(&mut self, cx: &mut Context<Self>) {
        let prev = match self.step {
            Step::LoginWaiting(_) | Step::Local => Step::Choose,
            Step::Permissions => {
                if self.chosen == Some(Chosen::Local) {
                    Step::Local
                } else {
                    Step::Choose
                }
            }
            Step::Demo => Step::Permissions,
            // App Store-udgaven har intet demo-trin.
            Step::Import if crate::mas::ENABLED => Step::Permissions,
            Step::Import => Step::Demo,
            Step::Choose => return,
        };
        self.go(prev, cx);
    }
}

/// Trinene i fremskridtslinjen. "Dine data" (import til TimeTrack) findes
/// kun med konto; lokalt slutter onboardingen efter første forslag.
/// App Store-udgaven: konto, "Denne udgave" (i stedet for tilladelser og
/// første forslag, som kræver sporing) og evt. dine data.
fn step_names(chosen: Option<Chosen>) -> Vec<&'static str> {
    let mut names = if crate::mas::ENABLED {
        vec![t("onboarding.steps.account"), t("mas.onboarding.trin")]
    } else {
        vec![
            t("onboarding.steps.account"),
            t("onboarding.steps.permissions"),
            t("onboarding.steps.first_suggestion"),
        ]
    };
    if chosen != Some(Chosen::Local) {
        names.push(t("onboarding.steps.your_data"));
    }
    names
}

fn step_index(s: &Step) -> usize {
    match s {
        Step::Choose | Step::LoginWaiting(_) | Step::Local => 0,
        Step::Permissions => 1,
        Step::Demo => 2,
        Step::Import if crate::mas::ENABLED => 2,
        Step::Import => 3,
    }
}

impl OnboardingView {
    fn render_choose(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let option = |id: &'static str, title: &'static str, body: &'static str| {
            ui::card(b, id, title)
                .flex_1()
                .min_w_0()
                .child(
                    ui::heading(b, SharedString::from(format!("{id}-titel")), title, 3).text_base(),
                )
                .child(ui::muted(
                    b,
                    SharedString::from(format!("{id}-tekst")),
                    body,
                ))
        };
        v_flex()
            .gap_4()
            .child(ui::heading(b, "velkommen-titel", t("onboarding.choose.title"), 1))
            .when_some(self.migration_notice.clone(), |el, text| {
                el.child(
                    ui::card(b, "migrering", t("onboarding.migration.title"))
                        .child(ui::text("migrering-tekst", text).text_sm()),
                )
            })
            .child(ui::muted(
                b,
                "velkommen-tekst",
                t("onboarding.choose.intro"),
            ))
            .child(
                h_flex()
                    .gap_4()
                    .items_stretch()
                    .child(
                        option(
                            "valg-cloud",
                            t("onboarding.choose.cloud_title"),
                            t("onboarding.choose.cloud_body"),
                        )
                        .child(
                            Button::new("valg-log-ind")
                                .icon(Icon::Cloud)
                                .label(t("onboarding.choose.cloud_button"))
                                .primary()
                                .loading(self.busy)
                                .on_click(cx.listener(|this, _, _, cx| this.start_login(cx))),
                        )
                        .when(tt_core::edition::EDITION.is_timewren(), |el| {
                            el.child(ui::muted(b, "server-hjaelp", t("login.server.hint")))
                                .child(
                                    Input::new(&self.server)
                                        .id("server-url")
                                        .aria_label(t("login.server.label")),
                                )
                        }),
                    )
                    .child(
                        option(
                            "valg-lokal",
                            t("onboarding.choose.local_title"),
                            // App Store-udgaven nævner ingen pris uden for App Store.
                            if crate::mas::ENABLED {
                                t("mas.licens.valg")
                            } else {
                                t("onboarding.choose.local_body")
                            },
                        )
                        .child(
                            Button::new("valg-lokalt")
                                .icon(Icon::HardDrive)
                                .label(t("onboarding.choose.local_button"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.chosen = Some(Chosen::Local);
                                    this.go(Step::Local, cx);
                                })),
                        ),
                    ),
            )
            .into_any_element()
    }

    fn render_login_waiting(
        &self,
        b: &Brand,
        start: &LoginStart,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let url = start.url.clone();
        v_flex()
            .gap_4()
            .child(ui::heading(b, "login-titel", t("onboarding.login.title"), 1))
            .child(ui::muted(
                b,
                "login-tekst",
                t("onboarding.login.text"),
            ))
            .child(
                ui::el("login-venter", Role::ProgressIndicator, t("onboarding.login.waiting_label"))
                    .flex()
                    .gap_2()
                    .items_center()
                    .text_sm()
                    .child(div().size(px(8.)).rounded_full().bg(b.primary))
                    .child(t("onboarding.login.waiting")),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("login-aabn-igen")
                            .label(t("onboarding.login.reopen"))
                            .small()
                            .on_click(move |_, _, cx| cx.open_url(&url)),
                    )
                    .child(
                        Button::new("login-annuller")
                            .label(t("onboarding.login.cancel"))
                            .ghost()
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| this.go(Step::Choose, cx))),
                    ),
            )
            .child(
                v_flex()
                    .gap_1()
                    .pt_4()
                    .child(ui::heading(b, "login-indsaet-titel", t("onboarding.login.paste_title"), 3))
                    .child(ui::muted(
                        b,
                        "login-indsaet-tekst",
                        t("onboarding.login.paste_text"),
                    ))
                    .child(
                        h_flex()
                            .gap_2()
                            .child(div().w(px(420.)).child(Input::new(&self.paste).id("login-indsaet").aria_label(t("onboarding.login.paste_label"))))
                            .child(
                                Button::new("login-indsaet-fortsaet")
                                    .label(t("onboarding.login.continue"))
                                    .small()
                                    .loading(self.busy)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        let url = this.paste.read(cx).value().to_string();
                                        this.receive_callback(&url, cx);
                                    })),
                            ),
                    ),
            )
            .into_any_element()
    }

    /// App Store-udgaven: gratis til personlig brug; erhvervslicensen kan
    /// købes i appen nu eller senere under Indstillinger → Konto.
    fn render_local_mas(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        v_flex()
            .gap_4()
            .child(ui::heading(b, "lokal-titel", t("onboarding.local.title"), 1))
            .child(ui::muted(b, "lokal-tekst", t("onboarding.local.text")))
            .child(
                ui::card(b, "lokal-licens", t("mas.licens.titel"))
                    .child(crate::store::license_panel(b, "lokal-licens")),
            )
            .child(
                h_flex().child(
                    Button::new("lokal-fortsaet")
                        .label(t("mas.licens.fortsaet"))
                        .primary()
                        .on_click(cx.listener(|this, _, _, cx| this.go(Step::Permissions, cx))),
                ),
            )
            .into_any_element()
    }

    fn render_local(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        if crate::mas::ENABLED {
            return self.render_local_mas(b, cx);
        }
        v_flex()
            .gap_4()
            .child(ui::heading(b, "lokal-titel", t("onboarding.local.title"), 1))
            .child(ui::muted(
                b,
                "lokal-tekst",
                t("onboarding.local.text"),
            ))
            .child(
                ui::card(b, "lokal-licens", t("onboarding.local.license_title"))
                    .child(ui::heading(b, "lokal-licens-titel", t("onboarding.local.license_title"), 3))
                    .child(
                        h_flex()
                            .gap_2()
                            .child(div().w(px(300.)).child(Input::new(&self.license_key).id("lokal-licensnoegle").aria_label(t("onboarding.local.license_label"))))
                            .child(
                                Button::new("lokal-aktiver")
                                    .label(t("onboarding.local.activate"))
                                    .primary()
                                    .small()
                                    .loading(self.busy)
                                    .on_click(cx.listener(|this, _, _, cx| this.activate_license(cx))),
                            ),
                    ),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("lokal-koeb")
                            .label(t("onboarding.local.buy"))
                            .on_click(|_, _, cx| cx.open_url(BUY_URL)),
                    )
                    .child(
                        Button::new("lokal-proeve")
                            .label(t("onboarding.local.trial"))
                            .ghost()
                            .on_click(cx.listener(|this, _, _, cx| this.start_trial(cx))),
                    ),
            )
            .into_any_element()
    }

    fn render_permissions(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let p = self.permissions.unwrap_or(Permissions {
            accessibility: PermissionState::Unknown,
            screen_recording: PermissionState::Unknown,
        });
        let item = |id: &'static str,
                    perm: Permission,
                    title: &'static str,
                    why: &'static str,
                    state: PermissionState,
                    cx: &mut Context<Self>| {
            let (badge, tone) = match state {
                PermissionState::Granted => (t("onboarding.perm.granted"), Tone::Primary),
                PermissionState::Denied => (t("onboarding.perm.denied"), Tone::Danger),
                PermissionState::Unknown => (t("onboarding.perm.unknown"), Tone::Warning),
                PermissionState::NotNeeded => (t("onboarding.perm.not_needed"), Tone::Neutral),
            };
            ui::card(b, id, title)
                .child(
                    h_flex()
                        .justify_between()
                        .items_center()
                        .child(
                            ui::heading(b, SharedString::from(format!("{id}-titel")), title, 3)
                                .text_base(),
                        )
                        .child(ui::badge(
                            b,
                            SharedString::from(format!("{id}-status")),
                            badge,
                            tone,
                        )),
                )
                .child(ui::muted(
                    b,
                    SharedString::from(format!("{id}-hvorfor")),
                    why,
                ))
                .when(
                    state != PermissionState::Granted && state != PermissionState::NotNeeded,
                    |c| {
                        c.child(
                            h_flex().child(
                                Button::new(SharedString::from(format!("{id}-giv")))
                                    .label(t("onboarding.perm.open_settings"))
                                    .small()
                                    .accessibility_label(tf("onboarding.perm.grant_label", &[("title", title)]))
                                    .on_click(
                                        cx.listener(move |this, _, _, cx| this.request(perm, cx)),
                                    ),
                            ),
                        )
                    },
                )
        };
        let all_given = missing_permissions(p).is_empty();
        v_flex()
            .gap_4()
            .child(ui::heading(b, "tilladelser-titel", t("onboarding.perm.title"), 1))
            .child(ui::muted(
                b,
                "tilladelser-tekst",
                t("onboarding.perm.text"),
            ))
            .child(item(
                "tilladelse-ax",
                Permission::Accessibility,
                t("onboarding.perm.ax_title"),
                t("onboarding.perm.ax_why"),
                p.accessibility,
                cx,
            ))
            .child(item(
                "tilladelse-skaerm",
                Permission::ScreenRecording,
                t("onboarding.perm.screen_title"),
                t("onboarding.perm.screen_why"),
                p.screen_recording,
                cx,
            ))
            // Automatisering (AppleScript til browser-adressen) kan ikke
            // tjekkes på forhånd; macOS spørger pr. browser. Forklar det her.
            .child(ui::muted(
                b,
                "tilladelser-automatisering",
                t("onboarding.perm.automation_note"),
            ))
            // observer: ingen opsætning; appen spørger, når den har set nok.
            .child(ui::muted(b, "tilladelser-observer", t("observer.onboarding")))
            .child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(
                        Button::new("tilladelser-fortsaet")
                            .label(t("onboarding.perm.continue"))
                            .primary()
                            .disabled(!all_given)
                            .on_click(cx.listener(|this, _, _, cx| this.go(Step::Demo, cx))),
                    )
                    .when(!all_given, |r| {
                        r.child(
                            Button::new("tilladelser-spring-over")
                                .label(t("onboarding.perm.skip"))
                                .ghost()
                                .on_click(cx.listener(|this, _, _, cx| this.go(Step::Demo, cx))),
                        )
                        .child(ui::muted(
                            b,
                            "tilladelser-uden",
                            t("onboarding.perm.without"),
                        ))
                    }),
            )
            .into_any_element()
    }

    /// App Store-udgaven: i stedet for tilladelserne en forklaring på, hvad
    /// udgaven kan, og et link til den fulde udgave. Ingen demo bagefter.
    fn render_mas(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        v_flex()
            .gap_4()
            .child(ui::heading(b, "mas-titel", t("mas.onboarding.titel"), 1))
            .child(crate::mas::tracking_notice(b, "mas-sporing"))
            .child(
                h_flex().child(
                    Button::new("mas-fortsaet")
                        .label(t("mas.onboarding.videre"))
                        .primary()
                        .on_click(cx.listener(|this, _, _, cx| this.after_demo(cx))),
                ),
            )
            .into_any_element()
    }

    fn render_demo(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let answer: Option<(&str, &str)> = self.demo.map(|a| match a {
            DemoAnswer::Confirmed => (
                t("onboarding.demo.confirmed"),
                t("onboarding.demo.confirmed_body"),
            ),
            DemoAnswer::Corrected => (
                t("onboarding.demo.corrected"),
                t("onboarding.demo.corrected_body"),
            ),
            DemoAnswer::Rejected => (
                t("onboarding.demo.rejected"),
                t("onboarding.demo.rejected_body"),
            ),
        });
        let set = |a: DemoAnswer| {
            move |this: &mut Self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>| {
                this.demo = Some(a);
                cx.notify();
            }
        };
        v_flex()
            .gap_4()
            .child(ui::heading(b, "demo-titel", t("onboarding.demo.title"), 1))
            .child(ui::muted(
                b,
                "demo-tekst",
                t("onboarding.demo.text"),
            ))
            .child(
                ui::card(b, "demo-forslag", t("onboarding.demo.card_label"))
                    .border_color(b.suggestion)
                    .child(
                        h_flex()
                            .justify_between()
                            .child(ui::text("demo-tid", "09:00-11:00").font_weight(FontWeight::SEMIBOLD))
                            .child(ui::badge(b, "demo-sikkerhed", t("onboarding.demo.confidence"), Tone::Primary)),
                    )
                    .child(ui::text("demo-hvem", t("onboarding.demo.who")).text_base().font_weight(FontWeight::MEDIUM))
                    .child(ui::muted(b, "demo-hvorfor", t("onboarding.demo.why")))
                    .child(
                        h_flex()
                            .gap_2()
                            .child(Button::new("demo-bekraeft").label(t("onboarding.demo.confirm")).primary().small().on_click(cx.listener(set(DemoAnswer::Confirmed))))
                            .child(Button::new("demo-ret").label(t("onboarding.demo.correct")).small().on_click(cx.listener(set(DemoAnswer::Corrected))))
                            .child(Button::new("demo-afvis").label(t("onboarding.demo.reject")).ghost().small().on_click(cx.listener(set(DemoAnswer::Rejected)))),
                    )
                                        .children(answer.map(|(head, body)| {
                        let text = tf("onboarding.demo.answer", &[("head", head), ("body", body)]);
                        ui::el("demo-svar", Role::Status, text.clone())
                            .text_sm()
                            .text_color(b.primary)
                            .child(text)
                    })),
            )
            .child(
                h_flex().child(
                    Button::new("demo-videre")
                        .label(if self.chosen == Some(Chosen::Cloud) {
                            t("onboarding.demo.next_cloud")
                        } else {
                            t("onboarding.demo.next_local")
                        })
                        .primary()
                        .on_click(cx.listener(|this, _, _, cx| this.after_demo(cx))),
                ),
            )
            .into_any_element()
    }

    fn render_import(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        v_flex()
            .gap_4()
            .child(ui::heading(b, "import-titel", t("onboarding.import.title"), 1))
            .child(ui::muted(
                b,
                "import-tekst",
                t("onboarding.import.text"),
            ))
            .child(ui::card(b, "import-kort", t("onboarding.import.card")).child(self.import.clone()))
            .child(
                h_flex().child(
                    Button::new("import-faerdig")
                        .label(t("onboarding.import.done"))
                        .primary()
                        .on_click(cx.listener(|this, _, _, cx| this.finish(cx))),
                ),
            )
            .into_any_element()
    }
}

impl Render for OnboardingView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        let step = self.step.clone();
        let content = match &step {
            Step::Choose => self.render_choose(&b, cx),
            Step::LoginWaiting(s) => self.render_login_waiting(&b, s, cx),
            Step::Local => self.render_local(&b, cx),
            Step::Permissions if crate::mas::ENABLED => self.render_mas(&b, cx),
            Step::Permissions => self.render_permissions(&b, cx),
            Step::Demo => self.render_demo(&b, cx),
            Step::Import => self.render_import(&b, cx),
        };
        let names = step_names(self.chosen);
        let current = step_index(&step).min(names.len() - 1);
        let progress = ui::el(
            "onboarding-trin",
            Role::List,
            tf(
                "onboarding.steps.progress",
                &[
                    ("n", &(current + 1).to_string()),
                    ("total", &names.len().to_string()),
                    ("name", names[current]),
                ],
            ),
        )
        .flex()
        .gap_4()
        .children(names.iter().enumerate().map(|(i, n)| {
            let active = i == current;
            ui::el(
                ("onboarding-trin", i),
                Role::ListItem,
                tf(
                    if active {
                        "onboarding.steps.item_current"
                    } else {
                        "onboarding.steps.item"
                    },
                    &[("n", &(i + 1).to_string()), ("name", n)],
                ),
            )
            .flex()
            .gap_1()
            .items_center()
            .text_xs()
            .text_color(if active { b.primary } else { b.grey })
            .when(active, |d| d.font_weight(FontWeight::SEMIBOLD))
            .child(div().size(px(8.)).rounded_full().bg(if i <= current {
                b.primary
            } else {
                b.border
            }))
            .child(n.to_string())
        }));
        let error = self.error.clone().map(|e| {
            ui::el("onboarding-fejl", Role::Alert, e.clone())
                .text_sm()
                .text_color(b.danger)
                .child(e)
        });
        div()
            .id("onboarding")
            .test_support()
            .role(Role::Main)
            .aria_label(t("onboarding.main_label"))
            .track_focus(&self.focus)
            .key_context("Onboarding")
            .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _, cx| {
                if ev.keystroke.key == "escape" {
                    this.back(cx);
                    cx.stop_propagation();
                }
            }))
            .size_full()
            .bg(b.surface)
            .text_color(b.ink)
            .font_family(brand::FONT)
            .overflow_y_scroll()
            .flex()
            .justify_center()
            .child(
                v_flex()
                    .w_full()
                    .max_w(px(760.))
                    .gap_6()
                    .px_8()
                    .py_10()
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                h_flex()
                                    .gap_2()
                                    .items_center()
                                    .child(ui::icon(Icon::TimeTrack).size(22.).color(b.mark))
                                    .child(
                                        ui::text("onboarding-app", tt_core::edition::EDITION.name)
                                            .font_weight(FontWeight::BOLD),
                                    ),
                            )
                            .child(progress),
                    )
                    .children(error)
                    .child(content)
                    .when(step != Step::Choose, |c| {
                        c.child(
                            h_flex().child(
                                Button::new("onboarding-tilbage")
                                    .label(t("onboarding.back"))
                                    .ghost()
                                    .small()
                                    .tooltip("Esc")
                                    .on_click(cx.listener(|this, _, _, cx| this.back(cx))),
                            ),
                        )
                    }),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ImportReport, Permission, PermissionState, Permissions, Step, import_rows, import_summary,
        missing_permissions,
    };

    #[test]
    fn manglende_tilladelser() {
        let p = |a, s| Permissions {
            accessibility: a,
            screen_recording: s,
        };
        use PermissionState::*;
        assert_eq!(
            missing_permissions(p(Unknown, Denied)),
            vec![Permission::Accessibility, Permission::ScreenRecording]
        );
        assert_eq!(
            missing_permissions(p(Granted, Unknown)),
            vec![Permission::ScreenRecording]
        );
        assert!(
            missing_permissions(p(NotNeeded, NotNeeded)).is_empty(),
            "Windows"
        );
    }

    #[test]
    fn importrapport_tekster() {
        let mut r = ImportReport {
            dry_run: true,
            customers: 2,
            entries: 10,
            ..Default::default()
        };
        assert_eq!(
            import_summary(&r),
            "Prøven fandt 12 ting, der kan flyttes. Intet er ændret endnu"
        );
        r.dry_run = false;
        assert_eq!(import_summary(&r), "12 ting er flyttet til TimeTrack");
        let again = ImportReport {
            dry_run: true,
            skipped: 12,
            ..Default::default()
        };
        assert_eq!(
            import_summary(&again),
            "Alt er allerede flyttet (12 findes i TimeTrack)"
        );
        let failed = ImportReport { failed: 2, errors: vec!["entry e1: Kunde k1 blev ikke importeret".into()], ..r.clone() };
        assert_eq!(import_summary(&failed), "12 ting er flyttet, men 2 blev afvist. Ret fejlene, og flyt igen");
        assert_eq!(import_rows(&r).len(), 6);
        assert_eq!(import_rows(&r)[2], ("poster", "Registreringer", 10));
    }

    #[test]
    #[cfg(not(feature = "mas"))]
    fn lokal_onboarding_har_tre_trin() {
        // Set på en rigtig Mac: "Trin 3 af 4", men "Kom i gang" sluttede
        // onboardingen, fordi "Dine data" kun findes med konto.
        assert_eq!(super::step_names(Some(super::Chosen::Local)).len(), 3);
        assert_eq!(super::step_names(Some(super::Chosen::Cloud)).len(), 4);
        assert_eq!(super::step_names(None).len(), 4);
    }

    /// App Store-udgaven: konto og "Denne udgave" (ingen tilladelser og intet
    /// første forslag), plus dine data med konto.
    #[test]
    #[cfg(feature = "mas")]
    fn mas_onboarding_spoerger_ikke_om_tilladelser() {
        let lokal = super::step_names(Some(super::Chosen::Local));
        assert_eq!(lokal.len(), 2);
        assert!(!lokal.contains(&crate::i18n::t("onboarding.steps.permissions")));
        assert_eq!(super::step_names(Some(super::Chosen::Cloud)).len(), 3);
        assert_eq!(super::step_index(&Step::Import), 2);
    }

    #[test]
    fn trin_fra_miljoe() {
        assert_eq!(Step::from_key("demo"), Some(Step::Demo));
        assert!(matches!(
            Step::from_key("login"),
            Some(Step::LoginWaiting(_))
        ));
        assert_eq!(Step::from_key("x"), None);
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use std::cell::Cell;
    use std::rc::Rc;
    use std::sync::Arc;

    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{
        AnyWindowHandle, AppContext as _, Bounds, Entity, Point, TestAppContext, WindowBounds,
        WindowOptions, px, size,
    };

    use super::{OnboardingDone, OnboardingView, Step, standalone};
    use crate::backend::{Backend as _, MockBackend};
    #[cfg(not(feature = "mas"))]
    use crate::backend::{LicenseKind, PermissionState, Permissions};
    use crate::testing;

    fn open_onboarding(
        cx: &mut TestAppContext,
        mock: Arc<MockBackend>,
    ) -> (AnyWindowHandle, Entity<OnboardingView>) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            crate::brand::register_fonts(cx);
        });
        let out = cx.update(|cx| {
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(1200.), px(900.)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| standalone(mock, window, cx),
            )
            .expect("vindue")
        });
        settle(cx, out.0);
        out
    }

    fn settle(cx: &mut TestAppContext, h: AnyWindowHandle) {
        for _ in 0..3 {
            cx.run_until_parked();
            testing::render(cx, h);
        }
    }

    fn click(cx: &mut TestAppContext, h: AnyWindowHandle, id: &'static str) {
        cx.update_window(h, |_, w, cx| w.click(id, cx)).unwrap();
        settle(cx, h);
    }

    fn has(cx: &mut TestAppContext, h: AnyWindowHandle, part: &str) -> bool {
        testing::a11y(cx, h).has_label_containing(part)
    }

    #[gpui_kit::test]
    fn cloud_login_med_deep_link(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_local_account();
        let (h, v) = open_onboarding(cx, mock.clone());
        let a = testing::a11y(cx, h);
        assert_eq!(a.with_label, a.with_role, "alle roller har label");
        assert!(has(cx, h, "Velkommen til TimeTrack"));
        click(cx, h, "valg-log-ind");
        assert!(has(cx, h, "Venter på login fra browseren"));
        // Fremmed state afvises (login-CSRF).
        v.update(cx, |v, cx| {
            v.receive_callback("timetrack://auth?code=x&state=fremmed", cx)
        });
        settle(cx, h);
        assert!(has(cx, h, "hører ikke til dette login"));
        assert!(matches!(
            v.read_with(cx, |v, _| v.step.clone()),
            Step::LoginWaiting(_)
        ));
        // Rigtig state logger ind.
        v.update(cx, |v, cx| {
            v.receive_callback("timetrack://auth?code=abc&state=mock-state-7f3a9c", cx)
        });
        settle(cx, h);
        assert_eq!(v.read_with(cx, |v, _| v.step.clone()), Step::Permissions);
        assert!(matches!(
            mock.account().unwrap().mode,
            crate::backend::Mode::Cloud { .. }
        ));
    }

    /// App Store-udgaven: ingen tilladelser og ingen demo. Trinnet forklarer
    /// udgaven og linker til den fulde; Fortsæt går til import (konto).
    #[gpui_kit::test]
    #[cfg(feature = "mas")]
    fn mas_forklarer_udgaven_i_stedet_for_tilladelser(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, v) = open_onboarding(cx, mock.clone());
        let done = Rc::new(Cell::new(false));
        let d2 = done.clone();
        let _sub = cx.update(|cx| cx.subscribe(&v, move |_, _: &OnboardingDone, _| d2.set(true)));
        v.update(cx, |v, cx| {
            v.chosen = Some(super::Chosen::Cloud);
            v.go(Step::Permissions, cx)
        });
        settle(cx, h);
        assert!(has(cx, h, "Sådan virker denne udgave"));
        assert!(has(cx, h, "Automatisk sporing findes i den fulde udgave"));
        assert!(has(cx, h, "Hent den fulde udgave"));
        assert!(!has(cx, h, "Tilgængelighed"), "ingen tilladelser");
        click(cx, h, "mas-fortsaet");
        assert_eq!(v.read_with(cx, |v, _| v.step.clone()), Step::Import);
        click(cx, h, "import-faerdig");
        assert!(done.get(), "OnboardingDone sendt");
        // Lokalt slutter onboardingen efter forklaringen.
        let (h, v) = open_onboarding(cx, testing::mock());
        let done = Rc::new(Cell::new(false));
        let d2 = done.clone();
        let _sub = cx.update(|cx| cx.subscribe(&v, move |_, _: &OnboardingDone, _| d2.set(true)));
        v.update(cx, |v, cx| {
            v.chosen = Some(super::Chosen::Local);
            v.go(Step::Permissions, cx)
        });
        settle(cx, h);
        click(cx, h, "mas-fortsaet");
        assert!(done.get(), "lokal: færdig efter forklaringen");
    }

    /// App Store-udgaven, lokalt: gratis til personlig brug, erhvervslicensen
    /// kan købes i appen, og Fortsæt går videre uden licens. Ingen
    /// licensnøgle, prøve eller pris uden for App Store.
    #[gpui_kit::test]
    #[cfg(feature = "mas")]
    fn mas_lokal_er_gratis_med_koeb_i_app_store(cx: &mut TestAppContext) {
        use crate::store::{self, PRODUCT_ID};
        let _l = store::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        store::reset();
        cx.update(store::install);
        // Broens hændelse og gentegningen (i appen: lyttetasken).
        let feed = |cx: &mut TestAppContext, line: &str| {
            store::receive(line);
            cx.update(store::changed);
        };
        let mock = testing::mock();
        mock.set_local_account();
        let (h, v) = open_onboarding(cx, mock.clone());
        assert!(has(cx, h, "Gratis til personlig brug"));
        assert!(!has(cx, h, tt_core::edition::EDITION.local_price), "ingen pris uden for App Store");
        click(cx, h, "valg-lokalt");
        assert!(has(cx, h, "Personlig brug er gratis"));
        assert!(has(cx, h, "Gendan køb"));
        assert!(!has(cx, h, "Licensnøgle"));
        assert!(!has(cx, h, "Prøv gratis"));
        feed(cx, &format!(r#"{{"event":"product","id":"{PRODUCT_ID}","price":"499,00 kr."}}"#));
        settle(cx, h);
        assert!(has(cx, h, "Køb erhvervslicens, 499,00 kr."));
        click(cx, h, "lokal-fortsaet");
        assert_eq!(v.read_with(cx, |v, _| v.step.clone()), Step::Permissions);
        assert!(mock.account().unwrap().license.is_none(), "ingen licensfil");
        store::reset();
    }

    #[gpui_kit::test]
    #[cfg(not(feature = "mas"))]
    fn tilladelser_spring_over_demo_og_import(cx: &mut TestAppContext) {
        let mock = testing::mock();
        let (h, v) = open_onboarding(cx, mock.clone());
        let done = Rc::new(Cell::new(false));
        let d2 = done.clone();
        let _sub = cx.update(|cx| cx.subscribe(&v, move |_, _: &OnboardingDone, _| d2.set(true)));
        v.update(cx, |v, cx| {
            v.chosen = Some(super::Chosen::Cloud);
            v.go(Step::Permissions, cx)
        });
        settle(cx, h);
        assert!(has(cx, h, "Tilgængelighed"));
        assert!(has(cx, h, "spørger macOS også, om TimeTrack må styre den"));
        assert!(has(cx, h, "Der optages aldrig billeder"));
        // Giv den ene; Fortsæt er stadig slået fra, men Spring over virker.
        click(cx, h, "tilladelse-ax-giv");
        assert_eq!(
            mock.permissions().unwrap().accessibility,
            PermissionState::Granted
        );
        click(cx, h, "tilladelser-spring-over");
        assert_eq!(v.read_with(cx, |v, _| v.step.clone()), Step::Demo);
        click(cx, h, "demo-ret");
        assert!(has(cx, h, "lærer appen mønsteret"));
        click(cx, h, "demo-videre");
        assert_eq!(v.read_with(cx, |v, _| v.step.clone()), Step::Import);
        click(cx, h, "import-proeve");
        assert!(has(cx, h, "Intet er ændret endnu"));
        click(cx, h, "import-flyt");
        assert!(has(cx, h, "flyttet til TimeTrack"));
        // Anden kørsel: idempotent.
        click(cx, h, "import-proeve");
        assert!(has(cx, h, "Alt er allerede flyttet"));
        click(cx, h, "import-faerdig");
        assert!(done.get(), "OnboardingDone sendt");
    }

    #[gpui_kit::test]
    #[cfg(not(feature = "mas"))]
    fn lokal_licens_og_proeve(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_local_account();
        mock.set_permissions(Permissions {
            accessibility: PermissionState::Granted,
            screen_recording: PermissionState::Granted,
        });
        let (h, v) = open_onboarding(cx, mock.clone());
        click(cx, h, "valg-lokalt");
        assert!(has(cx, h, "Brug TimeTrack lokalt"));
        cx.update_window(h, |_, w, cx| {
            v.update(cx, |v, cx| {
                v.license_key.update(cx, |i, cx| i.set_value("TT-1", w, cx))
            })
        })
        .unwrap();
        click(cx, h, "lokal-aktiver");
        assert!(has(cx, h, "TT-XXXX"), "fejl ved forkert nøgle");
        click(cx, h, "lokal-proeve");
        assert_eq!(v.read_with(cx, |v, _| v.step.clone()), Step::Permissions);
        assert!(matches!(
            mock.account().unwrap().license.map(|l| l.kind),
            Some(LicenseKind::Trial { days_left: 14 })
        ));
        // Begge givet: Fortsæt virker, og Esc går tilbage.
        click(cx, h, "tilladelser-fortsaet");
        assert_eq!(v.read_with(cx, |v, _| v.step.clone()), Step::Demo);
        cx.update_window(h, |_, w, cx| w.press("escape", cx))
            .unwrap();
        settle(cx, h);
        assert_eq!(v.read_with(cx, |v, _| v.step.clone()), Step::Permissions);
    }
}
