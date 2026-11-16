//! Mødekortet og målvælgeren.
//!
//! - **Mødekortet** (øverst til højre): "Mødet med Bageriet varede 42 min.
//!   Registrér?" med **Registrér**, **Ret** og **Ignorér**, som i
//!   notifikationen. Det står, til mødet er besvaret, så et møde uden for
//!   arbejdstiden (ingen notifikation) heller ikke tabes.
//! - **Målvælgeren**: kunde eller kunde · projekt til "Ret" på et møde og
//!   til idle-spørgsmålets "Træk fra og tildel til …".

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::h_flex;
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::TimerTarget;
use crate::brand::brand;
use crate::handling::{self, MeetingOutcome};
use crate::i18n::{t, tf};
use crate::idle::IdlePrompt;
use crate::kalenderkilder::{self, PendingMeeting};
use crate::ui::maal::{Hint, PickTarget};
use crate::ui::maalvaelger::{TargetPicker, TargetPickerEvent};
use crate::ui;

/// Hvad målvælgeren er åbnet til.
#[derive(Clone, Debug, PartialEq)]
pub enum PickFor {
    Meeting(PendingMeeting),
    Idle(IdlePrompt),
}

pub struct MoedeKort {
    ctx: AppCtx,
    picker: Entity<TargetPicker>,
    pick_for: Option<PickFor>,
    _subs: Vec<Subscription>,
}

/// Teksten på kortet og i notifikationen.
pub fn meeting_text(p: &PendingMeeting) -> String {
    crate::moeder::notification_body(
        p.meeting.kind,
        p.title.as_deref(),
        p.customer_name.as_deref(),
        p.minutes(),
    )
}


/// Aktivitet: dagens aftaler og ventende møder. `None` uden nogen.
pub fn day_card(b: &crate::brand::Brand, items: &[kalenderkilder::DayItem]) -> Option<impl IntoElement + use<>> {
    if items.is_empty() {
        return None;
    }
    Some(
        ui::card(b, "aktivitet-kalender", t("kalenderkilder.dag.titel"))
            .child(ui::heading(b, "aktivitet-kalender-titel", t("kalenderkilder.dag.titel"), 3))
            .child(ui::list("aktivitet-kalender-liste", t("kalenderkilder.dag.titel")).children(
                items.iter().enumerate().map(|(i, it)| {
                    let span = format!("{}-{}", it.start.format("%H:%M"), it.end.format("%H:%M"));
                    let who = it.customer.clone().unwrap_or_else(|| t("kalenderkilder.dag.ingen_kunde").into());
                    let status = if it.waiting { t("kalenderkilder.dag.venter") } else { "" };
                    let label = [span.as_str(), it.title.as_str(), who.as_str(), status]
                        .into_iter()
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join(" · ");
                    ui::list_row(b, SharedString::from(format!("aktivitet-kalender-{i}")), label.clone())
                        .child(ui::text(SharedString::from(format!("aktivitet-kalender-{i}-tekst")), label).text_sm())
                }),
            )),
    )
}

impl MoedeKort {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let picker = cx.new(|cx| TargetPicker::new(ctx.clone(), "maalvaelger", window, cx));
        let subs = vec![
            cx.subscribe_in(&picker, window, Self::on_pick),
            cx.observe(&ctx.hub, |_, _, cx| cx.notify()),
        ];
        MoedeKort {
            ctx,
            picker,
            pick_for: None,
            _subs: subs,
        }
    }

    pub fn is_picking(&self) -> bool {
        self.pick_for.is_some()
    }

    /// Hent møderne fra kalenderen ind i `DataHub` (efter et svar).
    pub fn sync_hub(ctx: &AppCtx, cx: &mut App) {
        let pending = kalenderkilder::global().map(|k| k.pending()).unwrap_or_default();
        ctx.hub.update(cx, |h, cx| {
            if h.meetings != pending {
                h.meetings = pending;
                cx.notify();
            }
        });
    }

    /// Åbn vælgeren. Kunder og projekter hentes i baggrunden.
    pub fn open(&mut self, what: PickFor, window: &mut Window, cx: &mut Context<Self>) {
        let title = match &what {
            PickFor::Meeting(_) => t("moeder.picker.meeting"),
            PickFor::Idle(_) => t("moeder.picker.idle"),
        };
        // Et møde, der allerede står i vælgeren, må ikke tabes (P1 i reviewen).
        if let Some(PickFor::Meeting(old)) = self.pick_for.take()
            && let Some(k) = kalenderkilder::global()
        {
            k.put_back(old);
        }
        // Mødets kunde (fra kalenderaftalen) står øverst med aftalens titel.
        let hints = match &what {
            PickFor::Meeting(m) if m.customer_id.is_some() || m.project_id.is_some() => vec![Hint {
                target: PickTarget::from_parts(m.customer_id.as_deref(), m.project_id.as_deref(), None),
                reason: m.title.clone().unwrap_or_else(|| meeting_text(m)),
            }],
            _ => vec![],
        };
        self.pick_for = Some(what);
        self.picker.update(cx, |p, cx| p.open(title, hints, window, cx));
        cx.notify();
    }

    /// "Ret" på et møde: tag det ud af køen, mens vælgeren er åben.
    pub fn edit_meeting(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(m) = kalenderkilder::global().and_then(|k| k.take_pending(id)) else {
            return;
        };
        Self::sync_hub(&self.ctx, cx);
        self.open(PickFor::Meeting(m), window, cx);
    }

    fn close(&mut self, cx: &mut Context<Self>) {
        // Et møde, der ikke blev registreret, venter igen.
        if let Some(PickFor::Meeting(m)) = self.pick_for.take()
            && let Some(k) = kalenderkilder::global()
        {
            k.put_back(m);
        }
        Self::sync_hub(&self.ctx, cx);
        cx.notify();
    }

    fn on_pick(&mut self, _: &Entity<TargetPicker>, ev: &TargetPickerEvent, _: &mut Window, cx: &mut Context<Self>) {
        let TargetPickerEvent::Picked(t) = ev else {
            self.close(cx);
            return;
        };
        let target = TimerTarget {
            customer_id: t.customer_id.clone(),
            project_id: t.project_id.clone(),
            task_id: t.task_id.clone(),
            description: String::new(),
        };
        let Some(what) = self.pick_for.take() else { return };
        let ctx = self.ctx.clone();
        match what {
            PickFor::Meeting(m) => {
                let Some(k) = kalenderkilder::global() else { return };
                // Uden kunde = intern tid (et projekt uden kunde).
                let customer = target.customer_id.clone().unwrap_or_default();
                self.ctx.mutate(
                    cx,
                    move |b| handling::register_on(b, &k, m, customer, target.project_id),
                    move |_, res, cx| {
                        ctx.notify_user(res.unwrap_or_else(|e| e.to_string()), cx);
                        Self::sync_hub(&ctx, cx);
                    },
                );
            }
            PickFor::Idle(p) => {
                // Spørgsmålet er besvaret: tag det ud af køen (det vises øverst).
                ctx.hub.update(cx, |h, cx| {
                    if h.idle.current() == Some(&p) {
                        h.idle.take();
                    }
                    cx.notify();
                });
                let again = p.clone();
                self.ctx.mutate(
                    cx,
                    move |b| crate::idle::resolve_assign(b, &p, &target),
                    move |_, res, cx| match res {
                        Ok(out) => ctx.notify_user(out.message(), cx),
                        Err(e) => {
                            // Intet er ændret: stil spørgsmålet igen, så det kan besvares.
                            ctx.hub.update(cx, |h, cx| {
                                h.idle.push(again);
                                cx.notify();
                            });
                            ctx.notify_user(e.to_string(), cx);
                        }
                    },
                );
            }
        }
        cx.notify();
    }

    pub fn register(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(k) = kalenderkilder::global() else { return };
        // Uden kunde: vælg først (som "Ret").
        if k.pending().iter().any(|m| m.meeting.id == id && m.customer_id.is_none()) {
            self.edit_meeting(&id, window, cx);
            return;
        }
        let ctx = self.ctx.clone();
        self.ctx.mutate(
            cx,
            move |b| handling::register_meeting(b, &k, &id),
            move |_, res, cx| {
                match res {
                    Ok(MeetingOutcome::Registered(msg)) => ctx.notify_user(msg, cx),
                    // Kunden forsvandt imens; mødet venter igen på kortet.
                    Ok(MeetingOutcome::NeedsTarget(_)) => {}
                    Err(e) => ctx.notify_user(e.to_string(), cx),
                }
                Self::sync_hub(&ctx, cx);
            },
        );
    }

    pub fn ignore(&mut self, id: &str, cx: &mut Context<Self>) {
        if let Some(k) = kalenderkilder::global() {
            handling::ignore_meeting(&k, id);
        }
        Self::sync_hub(&self.ctx, cx);
    }

    fn render_card(&self, p: &PendingMeeting, more: usize, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let b = brand(cx);
        let id = p.meeting.id.clone();
        let (id2, id3) = (id.clone(), id.clone());
        let text = meeting_text(p);
        ui::card(&b, "moede-kort", t("moeder.card.label"))
            .w(px(420.))
            .child(ui::heading(&b, "moede-titel", t("moeder.notify.title"), 3))
            .child(div().w_full().child(ui::text("moede-tekst", text).text_sm()))
            .when(more > 0, |d| {
                d.child(ui::muted(
                    &b,
                    "moede-flere",
                    tf("moeder.card.more", &[("n", &more.to_string())]),
                ))
            })
            .child(
                h_flex()
                    .gap_2()
                    .pt_2()
                    .child(
                        Button::new("moede-registrer")
                            .primary()
                            .label(t("handling.moede-registrer"))
                            .accessibility_label(t("moeder.card.register_label"))
                            .on_click(cx.listener(move |this, _, w, cx| this.register(id.clone(), w, cx))),
                    )
                    .child(
                        Button::new("moede-ret")
                            .label(t("handling.moede-ret"))
                            .accessibility_label(t("moeder.card.edit_label"))
                            .on_click(cx.listener(move |this, _, w, cx| this.edit_meeting(&id2, w, cx))),
                    )
                    .child(
                        Button::new("moede-ignorer")
                            .ghost()
                            .label(t("handling.moede-ignorer"))
                            .accessibility_label(t("moeder.card.ignore_label"))
                            .on_click(cx.listener(move |this, _, _, cx| this.ignore(&id3, cx))),
                    ),
            )
    }
}

use gpui_kit::prelude::FluentBuilder as _;

impl Render for MoedeKort {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let meetings = self.ctx.hub.read(cx).meetings.clone();
        let picking = self.pick_for.is_some();
        let label = self.picker.read(cx).title();
        // Ingen flex-plads i app-roden: kortet ligger nederst til venstre over
        // indholdet (beskeden står nederst til højre), vælgeren over det hele.
        if picking {
            return div().absolute().inset_0().child(ui::modal(
                "maalvaelger-dialog",
                label,
                self.picker.clone(),
                cx.listener(|this, _: &MouseDownEvent, _, cx| this.close(cx)),
            ));
        }
        div()
            .absolute()
            .bottom(px(16.))
            .left(px(228.))
            .when_some(meetings.first(), |d, p| {
                d.child(self.render_card(p, meetings.len() - 1, cx))
            })
    }
}
