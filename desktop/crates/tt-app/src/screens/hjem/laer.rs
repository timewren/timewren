//! Kortet "Lær TimeTrack at kende" på I dag: observér først, spørg bagefter.
//!
//! Før der er nok aktivitet, viser kortet, hvor langt observatøren er. Derefter
//! stilles ét spørgsmål ad gangen: "Det ligner, at A og B hører sammen. Er det
//! Kunden?" med "Ja", "Vælg en anden …" (vælgeren), "Opret kunden X" (ét
//! klik), "Spring over" og "Aldrig for denne". Svaret lærer mønstre, der også
//! gælder bagud, så forslagene hentes igen bagefter.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{Disableable, Sizable, h_flex, v_flex};
use gpui_kit::*;

use super::{HjemScreen, PickFor, Snapshot};
use crate::backend::{ObserverCard, ObserverGroup, ObserverReply, ObserverSourceKind};
use crate::brand::Brand;
use crate::i18n::{t, tf};
use crate::ui::{self, Tone, format};

/// Kortets tilstand i `HjemScreen`.
#[derive(Default)]
pub struct Laer {
    pub card: Option<ObserverCard>,
    /// Et svar er sendt; knapperne er slået fra, til kortet er hentet igen.
    pub busy: bool,
    pub error: Option<SharedString>,
    seq: u64,
}

fn kind_key(k: ObserverSourceKind) -> &'static str {
    match k {
        ObserverSourceKind::Repo => "observer.kilde.repo",
        ObserverSourceKind::Folder => "observer.kilde.mappe",
        ObserverSourceKind::Domain => "observer.kilde.domaene",
        ObserverSourceKind::Document => "observer.kilde.dokument",
        ObserverSourceKind::Title => "observer.kilde.titel",
    }
}

/// "repoet acme/bageriet-shop", "domænet bageriet.dk".
pub fn source_text(kind: ObserverSourceKind, label: &str) -> String {
    tf(kind_key(kind), &[("navn", label)])
}

/// "A og B" / "A, B og C" på det valgte sprog.
fn join(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [a] => a.clone(),
        [rest @ .., last] => tf(
            "observer.og",
            &[("foran", &rest.join(", ")), ("sidste", last)],
        ),
    }
}

/// Overskriften på et spørgsmål.
pub fn question_text(g: &ObserverGroup) -> String {
    let shown: Vec<String> = g
        .sources
        .iter()
        .take(3)
        .map(|s| source_text(s.kind, &s.label))
        .collect();
    if shown.len() == 1 {
        tf("observer.spoergsmaal.en", &[("kilde", &shown[0])])
    } else {
        tf("observer.spoergsmaal.flere", &[("kilder", &join(&shown))])
    }
}

impl HjemScreen {
    /// Henter kortet (baggrund). Kaldes fra `reload`.
    pub(super) fn load_laer(&mut self, cx: &mut Context<Self>) {
        self.laer.seq += 1;
        let seq = self.laer.seq;
        self.ctx.fetch(
            cx,
            |b| b.observer_card(),
            move |this, res, cx| {
                if seq != this.laer.seq {
                    return;
                }
                this.laer.busy = false;
                match res {
                    Ok(card) => {
                        this.laer.card = Some(card);
                        this.laer.error = None;
                    }
                    // Kortet er en hjælp; en fejl skjuler det ikke resten.
                    Err(e) => this.laer.error = Some(e.to_string().into()),
                }
                cx.notify();
            },
        );
    }

    pub(super) fn answer_laer(&mut self, id: String, reply: ObserverReply, cx: &mut Context<Self>) {
        if self.laer.busy {
            return;
        }
        self.laer.busy = true;
        self.laer.error = None;
        self.ctx.mutate(
            cx,
            move |b| b.answer_observer(&id, reply),
            |this, res, cx| {
                if let Err(e) = res {
                    this.laer.busy = false;
                    this.laer.error = Some(e.to_string().into());
                    // Spørgsmålet kan være ændret: vis det aktuelle.
                    this.load_laer(cx);
                }
                // Ved succes henter `changed` alt igen, også kortet.
                cx.notify();
            },
        );
    }

    /// "Vælg en anden …": vælgeren svarer på spørgsmålet.
    fn pick_laer(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.open_picker(PickFor::Observer(id), window, cx);
    }

    pub(super) fn render_laer(
        &self,
        d: &Snapshot,
        b: &Brand,
        cx: &mut Context<Self>,
    ) -> Option<impl IntoElement + use<>> {
        let card = self.laer.card.as_ref().filter(|c| c.active)?;
        // Intet at spørge om, og nok data: kortet har gjort sit arbejde.
        let ready = card.observed_minutes >= card.ready_after_minutes;
        if ready && card.question.is_none() {
            return None;
        }
        let actions = match &card.question {
            Some(_) if card.remaining > 0 => ui::badge(
                b,
                "laer-tilbage",
                tf("observer.tilbage", &[("n", &card.remaining.to_string())]),
                Tone::Neutral,
            )
            .into_any_element(),
            _ => div().into_any_element(),
        };
        let mut el = ui::titled_card(b, "laer", t("observer.titel"), actions);
        if let Some(e) = &self.laer.error {
            el = el.child(
                ui::el("laer-fejl", Role::Alert, e.clone())
                    .text_sm()
                    .text_color(b.danger)
                    .child(e.clone()),
            );
        }
        let Some(q) = card.question.clone() else {
            // Før nok data: hvor langt er vi.
            let share = (card.observed_minutes as f32 / card.ready_after_minutes.max(1) as f32).min(1.0);
            let progress = tf(
                "observer.fremskridt",
                &[
                    ("set", &format::hours(card.observed_minutes)),
                    ("maal", &format::hours(card.ready_after_minutes)),
                ],
            );
            return Some(
                el.child(ui::muted(b, "laer-intro", t("observer.intro")))
                    .child(
                        ui::el("laer-bjaelke", Role::ProgressIndicator, progress.clone())
                            .h(px(6.))
                            .w_full()
                            .rounded(px(3.))
                            .bg(b.surface)
                            .child(div().h_full().w(relative(share)).rounded(px(3.)).bg(b.primary)),
                    )
                    .child(ui::muted(b, "laer-fremskridt", progress)),
            );
        };

        let busy = self.laer.busy;
        let chips = h_flex().flex_wrap().gap_1().children(q.sources.iter().enumerate().map(|(i, s)| {
            let text = source_text(s.kind, &s.label);
            ui::badge(
                b,
                ("laer-kilde", i),
                format!("{text} · {}", format::hours(s.minutes)),
                Tone::Primary,
            )
        }));
        let mut body = v_flex()
            .gap_2()
            .child(
                ui::text("laer-spoergsmaal", question_text(&q))
                    .text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(b.ink),
            )
            .child(chips);
        if !q.hints.is_empty() {
            body = body.child(ui::muted(
                b,
                "laer-hint",
                tf("observer.hint", &[("ord", &q.hints.join(", "))]),
            ));
        }

        let suggested = q
            .customer_id
            .as_deref()
            .map(|c| d.suggestion_label(Some(c), q.project_id.as_deref()));
        let ask = match &suggested {
            Some(name) => tf("observer.er_det", &[("maal", name)]),
            None => t("observer.hvem").to_string(),
        };
        body = body.child(ui::text("laer-spoerg", ask).text_sm().text_color(b.ink));
        if let Some(r) = &q.reason {
            body = body.child(ui::muted(b, "laer-hvorfor", r.clone()).text_xs());
        }

        let mut buttons = h_flex().flex_wrap().gap_2();
        if let (Some(name), Some(customer)) = (&suggested, q.customer_id.clone()) {
            let id = q.id.clone();
            let project = q.project_id.clone();
            buttons = buttons.child(
                Button::new("laer-ja")
                    .primary()
                    .small()
                    .disabled(busy)
                    .label(tf("observer.ja", &[("maal", name)]))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.answer_laer(
                            id.clone(),
                            ObserverReply::Target {
                                customer_id: customer.clone(),
                                project_id: project.clone(),
                            },
                            cx,
                        )
                    })),
            );
        } else if let Some(name) = q.new_name.clone() {
            let id = q.id.clone();
            buttons = buttons.child(
                Button::new("laer-opret")
                    .primary()
                    .small()
                    .disabled(busy)
                    .label(tf("observer.opret", &[("navn", &name)]))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.answer_laer(id.clone(), ObserverReply::NewCustomer { name: name.clone() }, cx)
                    })),
            );
        }
        let id_pick = q.id.clone();
        let id_skip = q.id.clone();
        let id_never = q.id.clone();
        buttons = buttons
            .child(
                Button::new("laer-vaelg")
                    .outline()
                    .small()
                    .disabled(busy)
                    .label(if suggested.is_some() {
                        t("observer.vaelg_anden")
                    } else {
                        t("observer.vaelg")
                    })
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.pick_laer(id_pick.clone(), window, cx)
                    })),
            )
            .child(
                Button::new("laer-spring")
                    .ghost()
                    .small()
                    .disabled(busy)
                    .label(t("observer.spring_over"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.answer_laer(id_skip.clone(), ObserverReply::Skip, cx)
                    })),
            )
            .child(
                Button::new("laer-aldrig")
                    .ghost()
                    .small()
                    .disabled(busy)
                    .label(t("observer.aldrig"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.answer_laer(id_never.clone(), ObserverReply::Never, cx)
                    })),
            );
        Some(
            el.child(
                ui::el("laer-gruppe", Role::Group, question_text(&q).to_string())
                    .flex()
                    .flex_col()
                    .gap_3()
                    .p_3()
                    .rounded(px(8.))
                    .bg(b.suggestion)
                    .child(body)
                    .child(buttons),
            )
            .child(ui::muted(b, "laer-bagud", t("observer.bagud")).text_xs()),
        )
    }
}

/// Headless tests af kortet: `cargo test -p tt-app --features probe laer`.
#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AnyWindowHandle, AppContext as _, Entity, TestAppContext};

    use super::super::{HjemScreen, PickFor};
    use crate::app::AppView;
    use crate::backend::Backend as _;
    use crate::screens::Screen;
    use crate::testing;

    fn open(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<HjemScreen>, std::sync::Arc<crate::backend::MockBackend>) {
        let m = testing::mock();
        let (handle, app): (AnyWindowHandle, Entity<AppView>) = testing::open_app(cx, m.clone());
        testing::navigate(cx, handle, &app, Screen::Hjem);
        let hjem = app
            .read_with(cx, |a, _| a.view_for(Screen::Hjem))
            .unwrap()
            .downcast::<HjemScreen>()
            .ok()
            .unwrap();
        settle(cx, handle);
        (handle, hjem, m)
    }

    fn settle(cx: &mut TestAppContext, handle: AnyWindowHandle) {
        for _ in 0..3 {
            cx.run_until_parked();
            testing::render(cx, handle);
        }
    }

    fn click(cx: &mut TestAppContext, handle: AnyWindowHandle, id: &'static str) {
        cx.update_window(handle, |_, w, cx| w.click(id, cx)).unwrap();
        settle(cx, handle);
    }

    #[gpui_kit::test]
    fn kortet_spoerger_med_roller_og_danske_labels(cx: &mut TestAppContext) {
        let (handle, _, _) = open(cx);
        let a = testing::a11y(cx, handle);
        assert!(a.has_label("Lær TimeTrack at kende"), "{:?}", a.labels);
        assert!(a.has_label("Det ligner, at repoet acme/bageriet-shop og bageriet.dk hører sammen."));
        assert!(a.has_label("Er det Bageriet på Hjørnet?"));
        assert!(a.has_label_containing("Ja, Bageriet på Hjørnet"));
        assert!(a.has_label_containing("Aldrig for denne"));
        // Opgaven fra git står på forslaget.
        assert!(a.has_label("Opgave: Kurv og betaling med MobilePay"));
    }

    #[gpui_kit::test]
    fn ja_og_opret_kunde_med_et_klik(cx: &mut TestAppContext) {
        let (handle, _, m) = open(cx);
        click(cx, handle, "laer-ja");
        let a = testing::a11y(cx, handle);
        // Næste spørgsmål: intet kendt mål, så kunden kan oprettes med ét klik.
        assert!(a.has_label("Hvem er det til?"), "{:?}", a.labels);
        assert!(a.has_label_containing("Opret kunden Nordlys"));
        let before = m.customers(false).unwrap().len();
        click(cx, handle, "laer-opret");
        assert_eq!(m.customers(false).unwrap().len(), before + 1);
        assert!(m.customers(false).unwrap().iter().any(|c| c.name == "Nordlys"));
        // Ingen spørgsmål tilbage og nok data: kortet er væk.
        let a = testing::a11y(cx, handle);
        assert!(!a.has_label("Lær TimeTrack at kende"));
    }

    #[gpui_kit::test]
    fn spring_over_og_vaelg_en_anden(cx: &mut TestAppContext) {
        let (handle, hjem, _) = open(cx);
        click(cx, handle, "laer-spring");
        assert!(testing::a11y(cx, handle).has_label_containing("Opret kunden Nordlys"));
        click(cx, handle, "laer-vaelg");
        let pick = hjem.read_with(cx, |h, _| h.pick_for.clone());
        assert_eq!(pick, Some(PickFor::Observer("demo-nordlys".into())));
    }
}
