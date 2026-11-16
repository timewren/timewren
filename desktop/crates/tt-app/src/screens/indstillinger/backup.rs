//! Indstillinger → Backup: eksportér lokale data og indstillinger til én fil,
//! og gendan fra en fil (som 0.2's Backup). Gendannelse viser først, hvad
//! filen indeholder, og kræver et ekstra klik. Datalaget tager en
//! sikkerhedskopi, før noget erstattes.
//!
//! `TT_BACKUP_FILE` vælger en fil på forhånd (skærmbilleder og tests).

use std::path::PathBuf;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{Disableable as _, h_flex, v_flex};
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{BackupSummary, Mode};
use crate::brand::{Brand, brand};
use crate::export;
use crate::i18n::{t, tf};
use crate::ui::{self, Loadable, forms, format};

/// Teksten om backuppens indhold: "12 kunder, 340 poster, …".
pub fn summary_text(s: &BackupSummary) -> String {
    let created = s
        .created
        .map(|d| format::date_short(d.date_naive()))
        .unwrap_or_else(|| "?".into());
    tf(
        "gendan.backup.summary",
        &[
            ("date", &created),
            ("customers", &s.customers.to_string()),
            ("projects", &s.projects.to_string()),
            ("entries", &s.entries.to_string()),
            ("invoices", &s.invoices.to_string()),
            ("cards", &s.punch_cards.to_string()),
        ],
    )
}

pub struct BackupPanel {
    ctx: AppCtx,
    /// Valgt fil og dens indhold (valideret).
    chosen: Option<(PathBuf, Loadable<BackupSummary>)>,
    notice: Option<(SharedString, bool)>,
    last_file: Option<PathBuf>,
    busy: bool,
}

impl BackupPanel {
    pub fn new(ctx: AppCtx, cx: &mut Context<Self>) -> Self {
        let mut this = BackupPanel {
            ctx,
            chosen: None,
            notice: None,
            last_file: None,
            busy: false,
        };
        if let Some(p) = std::env::var_os("TT_BACKUP_FILE") {
            this.choose(PathBuf::from(p), cx);
        }
        this
    }

    fn export(&mut self, cx: &mut Context<Self>) {
        self.busy = true;
        self.ctx.fetch(
            cx,
            |b| b.export_backup(&export::export_dir()),
            |this, res, cx| {
                this.busy = false;
                match res {
                    Ok(p) => {
                        this.notice = Some((
                            tf("gendan.backup.exported", &[("path", &p.display().to_string())]).into(),
                            false,
                        ));
                        this.last_file = Some(p);
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
                cx.notify();
            },
        );
        cx.notify();
    }

    fn pick(&mut self, cx: &mut Context<Self>) {
        let rx = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(t("gendan.backup.pick_prompt").into()),
        });
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(Some(paths))) = rx.await
                && let Some(p) = paths.into_iter().next()
            {
                let _ = this.update(cx, |this, cx| this.choose(p, cx));
            }
        })
        .detach();
    }

    /// Vælg en fil: valider den og vis indholdet før gendannelse.
    pub fn choose(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.notice = None;
        self.chosen = Some((path.clone(), Loadable::Loading));
        self.ctx.fetch(
            cx,
            move |b| b.inspect_backup(&path),
            |this, res, cx| {
                if let Some((_, l)) = &mut this.chosen {
                    *l = Loadable::from_result(res);
                }
                cx.notify();
            },
        );
        cx.notify();
    }

    fn restore(&mut self, cx: &mut Context<Self>) {
        let Some((path, Loadable::Ready(_))) = &self.chosen else { return };
        let path = path.clone();
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| b.restore_backup(&path),
            |this, res, cx| {
                this.busy = false;
                match res {
                    Ok(r) => {
                        this.chosen = None;
                        this.notice = Some((
                            tf(
                                "gendan.backup.restored",
                                &[
                                    ("summary", &summary_text(&r.summary)),
                                    ("path", &r.safety_copy.display().to_string()),
                                ],
                            )
                            .into(),
                            false,
                        ));
                        this.last_file = Some(r.safety_copy);
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
                cx.notify();
            },
        );
        cx.notify();
    }
}

impl Render for BackupPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        if !matches!(self.ctx.backend.mode(), Mode::Local) {
            return ui::card(&b, "backup-web", t("gendan.backup.title"))
                .child(ui::heading(&b, "backup-web-titel", t("gendan.backup.title"), 2))
                .child(ui::muted(&b, "backup-web-tekst", t("gendan.backup.cloud")))
                .into_any_element();
        }
        v_flex()
            .gap_3()
            .child(
                ui::card(&b, "backup-eksport", t("gendan.backup.title"))
                    .child(ui::heading(&b, "backup-eksport-titel", t("gendan.backup.title"), 2))
                    .child(ui::muted(&b, "backup-eksport-hjaelp", t("gendan.backup.help")))
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                Button::new("backup-eksporter")
                                    .icon(Icon::Download)
                                    .label(t("gendan.backup.export"))
                                    .primary()
                                    .loading(self.busy && self.chosen.is_none())
                                    .disabled(self.busy)
                                    .on_click(cx.listener(|this, _, _, cx| this.export(cx))),
                            )
                            .child(
                                Button::new("backup-vaelg")
                                    .label(t("gendan.backup.pick"))
                                    .disabled(self.busy)
                                    .on_click(cx.listener(|this, _, _, cx| this.pick(cx))),
                            ),
                    )
                    .children(self.render_notice(&b, cx)),
            )
            .children(self.render_chosen(&b, cx))
            .into_any_element()
    }
}

impl BackupPanel {
    fn render_notice(&self, b: &Brand, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (msg, err) = self.notice.clone()?;
        if err {
            return Some(forms::form_error(b, "backup-besked", msg).into_any_element());
        }
        Some(
            v_flex()
                .gap_1()
                .child(ui::el("backup-besked", Role::Status, msg.clone()).text_sm().child(msg))
                .children(self.last_file.as_ref().map(|_| {
                    h_flex().child(
                        Button::new("backup-vis-fil")
                            .label(t("gendan.backup.reveal"))
                            .ghost()
                            .on_click(cx.listener(|this, _, _, cx| {
                                if let Some(p) = &this.last_file {
                                    cx.reveal_path(p);
                                }
                            })),
                    )
                }))
                .into_any_element(),
        )
    }

    fn render_chosen(&self, b: &Brand, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (path, state) = self.chosen.as_ref()?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let card = ui::card(b, "backup-gendan", t("gendan.backup.restore_title")).child(ui::heading(
            b,
            "backup-gendan-titel",
            tf("gendan.backup.restore_heading", &[("file", &name)]),
            2,
        ));
        let card = match state {
            Loadable::Loading => card.child(ui::loading_state(b, "backup-tjekker", t("gendan.backup.checking"))),
            Loadable::Failed(e) => card
                .child(forms::form_error(b, "backup-ugyldig", e.clone()))
                .child(
                    h_flex().child(
                        Button::new("backup-fortryd")
                            .label(t("gendan.backup.cancel"))
                            .ghost()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.chosen = None;
                                cx.notify();
                            })),
                    ),
                ),
            Loadable::Ready(s) => card
                .child(ui::text("backup-indhold", summary_text(s)).text_sm())
                .child(
                    ui::el("backup-advarsel", Role::Alert, t("gendan.backup.warning"))
                        .text_sm()
                        .text_color(b.danger)
                        .child(t("gendan.backup.warning")),
                )
                .child(
                    h_flex()
                        .gap_2()
                        .child(
                            Button::new("backup-gendan-knap")
                                .label(t("gendan.backup.restore"))
                                .danger()
                                .loading(self.busy)
                                .disabled(self.busy)
                                .on_click(cx.listener(|this, _, _, cx| this.restore(cx))),
                        )
                        .child(
                            Button::new("backup-fortryd")
                                .label(t("gendan.backup.cancel"))
                                .ghost()
                                .disabled(self.busy)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.chosen = None;
                                    cx.notify();
                                })),
                        ),
                ),
        };
        Some(card.into_any_element())
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use gpui_kit::TestAppContext;

    use super::super::IndstillingerScreen;
    use crate::backend::Backend as _;
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    #[gpui_kit::test]
    fn eksport_valg_og_gendannelse(cx: &mut TestAppContext) {
        let dir = std::env::temp_dir().join(format!("tt-backup-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // SAFETY: alle tests, der eksporterer, sætter samme mappe.
        unsafe { std::env::set_var("TT_EXPORT_DIR", &dir) };
        let mock = testing::mock();
        mock.set_local(true);
        let p = open(cx, mock, Screen::Indstillinger);
        p.click(cx, "indstilling-backup");
        p.assert_label(cx, "Eksportér backup");
        p.assert_all_labelled(cx);
        p.click(cx, "backup-eksporter");
        p.assert_label(cx, "Backuppen er gemt");
        let file = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|e| e == "ttbackup"))
            .expect("backupfil");

        // En ugyldig fil afvises med en besked.
        let bad = dir.join("ugyldig.ttbackup");
        std::fs::write(&bad, "nej").unwrap();
        let screen = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        let panel = cx.update(|cx| screen.read(cx).backup.clone());
        cx.update(|cx| panel.update(cx, |b, cx| b.choose(bad, cx)));
        p.settle(cx);
        p.assert_label(cx, "ikke en TimeTrack-backup");
        p.assert_no_label(cx, "Gendan og erstat");

        // En gyldig fil viser indholdet og kræver bekræftelse.
        cx.update(|cx| panel.update(cx, |b, cx| b.choose(file.clone(), cx)));
        p.settle(cx);
        p.assert_label(cx, "kunder");
        p.assert_label(cx, "sikkerhedskopi");
        p.click(cx, "backup-gendan-knap");
        p.assert_label(cx, "Data er gendannet");
        assert!(p.mock.inspect_backup(&file).is_ok());
    }

    #[gpui_kit::test]
    fn cloud_har_ingen_backup(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-backup");
        p.assert_label(cx, "ligger dine data på kontoen");
        p.assert_no_label(cx, "Eksportér backup");
    }
}
