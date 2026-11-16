//! Afviste registreringer (offline-køens dead-letter) i UI'et.
//!
//! - Nederst i indholdet (statuslinje): et banner med antallet ("3 registreringer blev afvist af
//!   serveren"), når der er nogen, med en knap til at se dem.
//! - Dialogen viser hver post (dato, tid, kunde/projekt og web's fejltekst)
//!   med "Send igen" og "Kassér" (kræver bekræftelse) og nederst "Send alle
//!   igen" og "Eksportér CSV". Eksporten gemmes som rapporternes CSV
//!   (`export::export_dir`, normalt Overførsler), og stien vises.
//!
//! Viewet er sidste barn i app-rodens indholdskolonne (tegnes over skærmen).
//! Åben fylder det kolonnen
//! (absolut), så dialogen ligger over den aktuelle skærm.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{Disableable as _, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{Id, Rejected, RetryResult};
use crate::brand::{Brand, brand};
use crate::export;
use crate::i18n::{t, tf};
use crate::ui::states::Loadable;
use crate::ui::{self, format};

pub struct AfvisteView {
    ctx: AppCtx,
    pub count: usize,
    pub items: Loadable<Vec<Rejected>>,
    pub open: bool,
    /// "Kassér" er trykket for denne post; venter på bekræftelse.
    pub confirm: Option<Id>,
    /// Besked i dialogen (tekst, er fejl).
    pub notice: Option<(SharedString, bool)>,
    busy: bool,
    revision: u64,
    _subs: Vec<Subscription>,
}

impl AfvisteView {
    pub fn new(ctx: AppCtx, cx: &mut Context<Self>) -> Self {
        let subs = vec![cx.observe(&ctx.hub, |this: &mut Self, hub, cx| {
            let rev = hub.read(cx).revision;
            if rev != this.revision {
                this.revision = rev;
                this.reload(cx);
            }
        })];
        let mut this = AfvisteView {
            ctx,
            count: 0,
            items: Loadable::Loading,
            open: false,
            confirm: None,
            notice: None,
            busy: false,
            revision: 0,
            _subs: subs,
        };
        // TT_DEMO=afviste-vis: åbn dialogen (til skærmbilleder);
        // TT_DEMO=afviste-kasser: med bekræftelsen af "Kassér" fremme.
        if let Ok(demo) = std::env::var("TT_DEMO") {
            this.open = demo.contains("afviste-vis") || demo.contains("afviste-kasser");
            if demo.contains("afviste-kasser") {
                this.confirm = Some("afvist_1".into());
            }
        }
        this.reload(cx);
        this
    }

    /// Hent antal (og listen, hvis dialogen er åben).
    pub fn reload(&mut self, cx: &mut Context<Self>) {
        let open = self.open;
        self.ctx.fetch(
            cx,
            move |b| {
                let count = b.rejected_count();
                let items = if open || count > 0 { Some(b.rejected()) } else { None };
                Ok((count, items))
            },
            |this, res: crate::backend::Result<_>, _| {
                if let Ok((count, items)) = res {
                    this.count = count;
                    if let Some(items) = items {
                        this.items = Loadable::from_result(items);
                    }
                    if this.count == 0 && this.open && this.notice.is_none() {
                        this.open = false;
                    }
                }
            },
        );
    }

    pub fn show(&mut self, cx: &mut Context<Self>) {
        self.open = true;
        self.notice = None;
        self.confirm = None;
        self.reload(cx);
        cx.notify();
    }

    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.open = false;
        self.confirm = None;
        self.notice = None;
        cx.notify();
    }

    fn retry(&mut self, id: Option<Id>, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.confirm = None;
        self.ctx.mutate(
            cx,
            move |b| b.retry_rejected(id.as_deref()),
            |this, res, cx| {
                this.busy = false;
                this.notice = Some(match res {
                    Ok(r) => (retry_text(r).into(), r.rejected > 0),
                    Err(e) => (tf("afviste.notice.failed", &[("error", &e.to_string())]).into(), true),
                });
                this.reload(cx);
            },
        );
    }

    fn discard(&mut self, id: Id, cx: &mut Context<Self>) {
        self.confirm = None;
        self.ctx.mutate(
            cx,
            move |b| b.discard_rejected(&id),
            |this, res, cx| {
                this.notice = Some(match res {
                    Ok(()) => (t("afviste.notice.discarded").into(), false),
                    Err(e) => (tf("afviste.notice.failed", &[("error", &e.to_string())]).into(), true),
                });
                this.reload(cx);
            },
        );
    }

    fn export_csv(&mut self, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            |b| {
                let csv = b.rejected_csv()?;
                export::write_unique(&export::export_dir(), crate::backend::REJECTED_CSV, csv.as_bytes())
                    .map_err(|e| crate::backend::BackendError::Other(e.to_string()))
            },
            |this, res, _| {
                this.notice = Some(match res {
                    Ok(p) => (tf("afviste.notice.csv_saved", &[("path", &p.display().to_string())]).into(), false),
                    Err(e) => (tf("afviste.notice.failed", &[("error", &e.to_string())]).into(), true),
                });
            },
        );
    }

    fn render_banner(&self, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let text = banner_text(self.count);
        ui::el("afviste-banner", Role::Alert, text.clone())
            .flex()
            .items_center()
            .gap_3()
            .px_4()
            .py_2()
            .bg(b.card)
            .border_t_1()
            .border_color(b.danger)
            .child(div().size(px(8.)).flex_none().rounded_full().bg(b.danger))
            .child(div().flex_1().min_w_0().text_sm().text_color(b.ink).child(text))
            .child(
                Button::new("afviste-vis")
                    .ghost()
                    .small()
                    .label(t("afviste.banner.show"))
                    .on_click(cx.listener(|this, _, _, cx| this.show(cx))),
            )
    }

    fn render_row(&self, ix: usize, r: &Rejected, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let headline = headline(r, self.ctx.backend.today());
        let context = context_line(r);
        let error = tf("afviste.row.error", &[("error", &r.error)]);
        let label = [headline.clone(), context.clone(), error.clone()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(". ");
        let confirming = self.confirm.as_deref() == Some(r.id.as_str());
        let id_send = r.id.clone();
        let id_discard = r.id.clone();
        let id_yes = r.id.clone();
        ui::list_row(b, SharedString::from(format!("afvist-{ix}")), label)
            .items_start()
            .border_1()
            .border_color(b.border)
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_0p5()
                    .child(div().font_weight(FontWeight::MEDIUM).child(headline))
                    .when(!context.is_empty(), |d| d.child(div().text_xs().text_color(b.grey).child(context)))
                    .child(div().text_xs().text_color(b.danger).child(error))
                    .when(confirming, |d| {
                        d.child(
                            h_flex()
                                .pt_1()
                                .gap_2()
                                .child(
                                    ui::text("afviste-kasser-spoergsmaal", t("afviste.confirm.question"))
                                        .text_xs()
                                        .text_color(b.ink),
                                )
                                .child(
                                    Button::new("afviste-kasser-ja")
                                        .danger()
                                        .small()
                                        .label(t("afviste.confirm.yes"))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.discard(id_yes.clone(), cx)
                                        })),
                                )
                                .child(
                                    Button::new("afviste-kasser-nej")
                                        .ghost()
                                        .small()
                                        .label(t("afviste.confirm.no"))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.confirm = None;
                                            cx.notify();
                                        })),
                                ),
                        )
                    }),
            )
            .child(
                h_flex()
                    .flex_none()
                    .gap_1()
                    .child(
                        Button::new(SharedString::from(format!("afviste-send-{ix}")))
                            .small()
                            .label(t("afviste.row.retry"))
                            .disabled(self.busy)
                            .on_click(cx.listener(move |this, _, _, cx| this.retry(Some(id_send.clone()), cx))),
                    )
                    .child(
                        Button::new(SharedString::from(format!("afviste-kasser-{ix}")))
                            .ghost()
                            .small()
                            .label(t("afviste.row.discard"))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.confirm = Some(id_discard.clone());
                                this.notice = None;
                                cx.notify();
                            })),
                    ),
            )
    }

    fn render_dialog(&self, b: &Brand, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let body: AnyElement = match &self.items {
            Loadable::Loading => ui::states::loading_state(b, "afviste-indlaeser", t("afviste.dialog.what")).into_any_element(),
            Loadable::Failed(e) => ui::states::error_state(b, "afviste-fejl", e.clone()).into_any_element(),
            Loadable::Ready(items) if items.is_empty() => ui::empty_state_icon(
                b,
                "afviste-tom",
                Icon::CheckCircle2,
                t("afviste.empty.title"),
                t("afviste.empty.body"),
            )
            .into_any_element(),
            Loadable::Ready(items) => ui::list("afviste-liste", t("afviste.dialog.title"))
                .max_h(px(380.))
                .overflow_y_scroll()
                .gap_2()
                .children(items.iter().enumerate().map(|(i, r)| self.render_row(i, r, b, cx)))
                .into_any_element(),
        };
        let has_items = self.items.ready().is_some_and(|i| !i.is_empty());
        let content = ui::card(b, "afviste-kort", t("afviste.dialog.title"))
            .w(px(680.))
            .child(ui::heading(b, "afviste-titel", t("afviste.dialog.title"), 1).text_size(px(20.)))
            .child(ui::muted(b, "afviste-forklaring", t("afviste.dialog.intro")))
            .children(self.notice.clone().map(|(msg, is_error)| {
                ui::el("afviste-besked", Role::Status, msg.clone())
                    .text_sm()
                    .text_color(if is_error { b.danger } else { b.ink })
                    .child(msg)
            }))
            .child(body)
            .child(
                h_flex()
                    .pt_2()
                    .gap_2()
                    .child(
                        Button::new("afviste-send-alle")
                            .primary()
                            .label(t("afviste.dialog.retry_all"))
                            .disabled(!has_items || self.busy)
                            .on_click(cx.listener(|this, _, _, cx| this.retry(None, cx))),
                    )
                    .child(
                        Button::new("afviste-csv")
                            .icon(Icon::Download)
                            .label(t("afviste.dialog.export"))
                            .disabled(!has_items)
                            .on_click(cx.listener(|this, _, _, cx| this.export_csv(cx))),
                    )
                    .child(div().flex_1())
                    .child(
                        Button::new("afviste-luk")
                            .ghost()
                            .label(t("afviste.dialog.close"))
                            .on_click(cx.listener(|this, _, _, cx| this.close(cx))),
                    ),
            );
        div().absolute().inset_0().child(ui::modal(
            "afviste-dialog",
            t("afviste.dialog.title"),
            content,
            cx.listener(|this, _: &MouseDownEvent, _, cx| this.close(cx)),
        ))
    }
}

impl Render for AfvisteView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let b = brand(cx);
        if self.open {
            return self.render_dialog(&b, cx).into_any_element();
        }
        if self.count == 0 {
            return div().into_any_element();
        }
        self.render_banner(&b, cx).into_any_element()
    }
}

/// "1 registrering blev afvist af serveren" / "3 registreringer …".
pub fn banner_text(count: usize) -> String {
    if count == 1 {
        t("afviste.banner.one").into()
    } else {
        tf("afviste.banner.many", &[("count", &count.to_string())])
    }
}

fn kind_label(r: &Rejected) -> String {
    let label = match r.kind.as_str() {
        "create_entry" => t("afviste.kind.create_entry"),
        "update_entry" => t("afviste.kind.update_entry"),
        "delete_entry" => t("afviste.kind.delete_entry"),
        "archive_client" => t("afviste.kind.archive_client"),
        "unarchive_client" => t("afviste.kind.unarchive_client"),
        "project_status" => t("afviste.kind.project_status"),
        "update_task" => t("afviste.kind.update_task"),
        "task_status" => t("afviste.kind.task_status"),
        "create_client" => t("afviste.kind.create_client"),
        "create_project" => t("afviste.kind.create_project"),
        "create_task" => t("afviste.kind.create_task"),
        "create_klippekort" => t("afviste.kind.create_klippekort"),
        _ => t("afviste.kind.other"),
    };
    match &r.subject {
        Some(s) => format!("{label}: {s}"),
        None => label.to_owned(),
    }
}

/// Første linje: dag, tid og varighed for en tidspost; ellers handlingen.
pub fn headline(r: &Rejected, today: chrono::NaiveDate) -> String {
    match r.date {
        Some(d) => {
            let mut s = format::date_relative(d, today);
            if r.start.is_some() {
                s.push_str(&format!(", {}", format::span(r.start, r.end)));
            }
            if let Some(m) = r.minutes {
                s.push_str(&format!(" ({})", format::hours(m)));
            }
            if r.kind != "create_entry" {
                s = format!("{}: {s}", kind_label(r));
            }
            s
        }
        None => kind_label(r),
    }
}

/// Anden linje: kunde, projekt og beskrivelse, hvis kendt.
pub fn context_line(r: &Rejected) -> String {
    [r.customer.clone(), r.project.clone(), r.description.clone()]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}

fn retry_text(r: RetryResult) -> String {
    let mut parts = Vec::new();
    if r.sent > 0 {
        parts.push(tf("afviste.notice.sent", &[("count", &r.sent.to_string())]));
    }
    if r.rejected > 0 {
        parts.push(tf("afviste.notice.rejected_again", &[("count", &r.rejected.to_string())]));
    }
    if r.queued > 0 {
        parts.push(tf("afviste.notice.queued", &[("count", &r.queued.to_string())]));
    }
    if parts.is_empty() {
        return t("afviste.notice.nothing").into();
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::{banner_text, context_line, headline, retry_text};
    use crate::backend::{MockRejected, RetryResult};
    use chrono::NaiveDate;

    #[test]
    fn tekster_til_banner_og_raekker() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        assert_eq!(banner_text(1), "1 registrering blev afvist af serveren. Den er gemt og kan sendes igen");
        assert!(banner_text(3).starts_with("3 registreringer blev afvist af serveren"));
        let demo = MockRejected::demo(today);
        assert_eq!(headline(&demo[0], today), "I går, 09:00-11:30 (2,5 t)");
        assert_eq!(context_line(&demo[0]), "Bageriet på Hjørnet · Ny webshop · Produktsider og kurv");
        assert_eq!(headline(&demo[2], today), "Ny kunde: Cykelsmeden");
        assert_eq!(context_line(&demo[2]), "");
        assert_eq!(
            retry_text(RetryResult { sent: 2, rejected: 1, queued: 0 }),
            "2 sendt og gemt. 1 afvist igen. Se fejlteksten."
        );
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use std::sync::Arc;

    use gpui_kit::TestAppContext;

    use crate::backend::{Backend as _, MockBackend, MockRejected};
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    fn with_rejected() -> Arc<MockBackend> {
        let mock = testing::mock();
        mock.set_rejected(MockRejected::demo(testing::today()));
        mock
    }

    #[gpui_kit::test]
    fn intet_banner_uden_afviste(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Hjem);
        p.assert_no_label(cx, "blev afvist af serveren");
    }

    #[gpui_kit::test]
    fn banner_aabner_listen(cx: &mut TestAppContext) {
        let p = open(cx, with_rejected(), Screen::Hjem);
        p.assert_label(cx, "3 registreringer blev afvist af serveren");
        p.click(cx, "afviste-vis");
        p.assert_label(cx, "Afviste registreringer");
        p.assert_label(cx, "I går, 09:00-11:30 (2,5 t). Bageriet på Hjørnet · Ny webshop · Produktsider og kurv. Serveren: Din plan er låst");
        p.assert_label(cx, "Ny kunde: Cykelsmeden");
        p.assert_all_labelled(cx);
        let a = p.a11y(cx);
        assert_eq!(a.count("Dialog"), 1);
        assert!(a.count("ListItem") >= 3);
        p.click(cx, "afviste-luk");
        p.assert_no_label(cx, "Serveren: Din plan er låst");
        p.assert_label(cx, "3 registreringer blev afvist af serveren");
    }

    #[gpui_kit::test]
    fn kasser_kraever_bekraeftelse(cx: &mut TestAppContext) {
        let p = open(cx, with_rejected(), Screen::Kalender);
        p.click(cx, "afviste-vis");
        p.click(cx, "afviste-kasser-0");
        p.assert_label(cx, "Kassér for altid?");
        assert_eq!(p.mock.rejected_count(), 3, "intet slettet før bekræftelsen");
        p.click(cx, "afviste-kasser-nej");
        p.assert_no_label(cx, "Kassér for altid?");
        assert_eq!(p.mock.rejected_count(), 3);
        p.click(cx, "afviste-kasser-1");
        p.click(cx, "afviste-kasser-ja");
        assert_eq!(p.mock.rejected_count(), 2);
        p.assert_label(cx, "Registreringen er kasseret");
        p.assert_no_label(cx, "Serveren: Perioden er låst for ændringer");
        p.assert_label(cx, "Produktsider og kurv");
    }

    #[gpui_kit::test]
    fn send_igen_afvist_og_saa_gemt(cx: &mut TestAppContext) {
        let p = open(cx, with_rejected(), Screen::Hjem);
        p.mock.set_retry_error(Some("Stadig låst"));
        p.click(cx, "afviste-vis");
        p.click(cx, "afviste-send-0");
        p.assert_label(cx, "1 afvist igen");
        p.assert_label(cx, "Serveren: Stadig låst");
        assert_eq!(p.mock.rejected_count(), 3);

        p.mock.set_retry_error(None);
        p.click(cx, "afviste-send-alle");
        p.assert_label(cx, "3 sendt og gemt.");
        assert_eq!(p.mock.rejected_count(), 0);
        p.assert_label(cx, "Ingen afviste registreringer");
        p.click(cx, "afviste-luk");
        p.assert_no_label(cx, "blev afvist af serveren");
    }

    #[gpui_kit::test]
    fn eksport_csv(cx: &mut TestAppContext) {
        let dir = std::env::temp_dir().join(format!("tt-export-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // SAFETY: alle tests, der eksporterer, sætter samme mappe.
        unsafe { std::env::set_var("TT_EXPORT_DIR", &dir) };
        let p = open(cx, with_rejected(), Screen::Hjem);
        p.click(cx, "afviste-vis");
        p.click(cx, "afviste-csv");
        p.assert_label(cx, "CSV gemt");
        let f = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .find(|e| e.file_name().to_string_lossy().starts_with("afviste-registreringer"))
            .expect("csv skrevet");
        let text = std::fs::read_to_string(f.path()).unwrap();
        std::fs::remove_file(f.path()).ok();
        assert!(text.starts_with("\u{feff}Dato;Start;Slut;Timer;Kunde;Projekt;Beskrivelse\r\n"));
        assert!(text.contains("2026-10-25;09:00;11:30;2,50;\"Bageriet på Hjørnet\";\"Ny webshop\";\"Produktsider og kurv\""));
        assert!(!text.contains("Cykelsmeden"), "ny kunde er ikke en tidspost");
    }
}
