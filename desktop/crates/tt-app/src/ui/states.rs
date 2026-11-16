//! Tilstande for tom, fejl og indlæsning, og `Loadable<T>` til data, der
//! hentes på background executor.

use crate::i18n::{t, tf};
use gpui_kit::component::v_flex;
use gpui_kit::*;

use crate::brand::Brand;
use crate::ui::icons::{Icon, icon};
use crate::ui::{El, tokens};

/// Data, der hentes asynkront fra `Backend`.
#[derive(Clone, Debug, Default)]
pub enum Loadable<T> {
    #[default]
    Loading,
    Ready(T),
    Failed(SharedString),
}

impl<T> Loadable<T> {
    pub fn ready(&self) -> Option<&T> {
        match self {
            Loadable::Ready(t) => Some(t),
            _ => None,
        }
    }

    pub fn is_loading(&self) -> bool {
        matches!(self, Loadable::Loading)
    }

    pub fn from_result<E: std::fmt::Display>(r: Result<T, E>) -> Self {
        match r {
            Ok(t) => Loadable::Ready(t),
            Err(e) => Loadable::Failed(e.to_string().into()),
        }
    }
}

fn frame(b: &Brand, id: impl Into<ElementId>, role: Role, label: SharedString) -> El {
    div()
        .id(id)
        .test_support()
        .role(role)
        .aria_label(label)
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap_2()
        .py_8()
        .px_4()
        .text_color(b.grey)
}

/// "Indlæser …" (rolle `ProgressIndicator`).
pub fn loading_state(b: &Brand, id: impl Into<ElementId>, what: &str) -> El {
    let label: SharedString = tf("ui.states.loading", &[("what", what)]).into();
    frame(b, id, Role::ProgressIndicator, label.clone()).child(
        v_flex()
            .gap_2()
            .items_center()
            .child(div().size(px(8.)).rounded_full().bg(b.primary))
            .child(div().text_sm().child(label)),
    )
}

/// Tom tilstand med titel og forklaring. Læg selv en handling på med `.child(Button…)`.
pub fn empty_state(b: &Brand, id: impl Into<ElementId>, title: &str, body: &str) -> El {
    empty_state_icon(b, id, Icon::Inbox, title, body)
}

/// Tom tilstand med et ikon, der passer til skærmen (fx `Icon::Users` på Kunder).
pub fn empty_state_icon(
    b: &Brand,
    id: impl Into<ElementId>,
    glyph: Icon,
    title: &str,
    body: &str,
) -> El {
    frame(b, id, Role::Status, format!("{title}. {body}").into())
        .child(
            div()
                .size(px(tokens::ICON_EMPTY + 24.))
                .rounded_full()
                .bg(b.card)
                .border_1()
                .border_color(b.border)
                .flex()
                .items_center()
                .justify_center()
                .mb_1()
                .child(icon(glyph).size(tokens::ICON_LG + 4.).color(b.grey)),
        )
        .child(
            div()
                .text_base()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(b.ink)
                .child(title.to_string()),
        )
        .child(
            div()
                .text_sm()
                .text_center()
                .max_w(px(420.))
                .child(body.to_string()),
        )
}

/// Fejl (rolle `Alert`, så skærmlæseren siger den med det samme).
/// Læg selv "Prøv igen" på med `.child(Button…)`.
pub fn error_state(b: &Brand, id: impl Into<ElementId>, message: impl Into<SharedString>) -> El {
    let message = message.into();
    frame(b, id, Role::Alert, format!("Fejl: {message}").into())
        .child(icon(Icon::AlertCircle).size(tokens::ICON_LG + 4.).color(b.danger))
        .child(
            div()
                .text_base()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(b.danger)
                .child(t("ui.states.failed")),
        )
        .child(div().text_sm().text_center().max_w(px(420.)).child(message))
}

#[cfg(test)]
mod tests {
    use super::Loadable;

    #[test]
    fn loadable_fra_result() {
        let ok: Loadable<u32> = Loadable::from_result(Ok::<_, String>(3));
        assert_eq!(ok.ready(), Some(&3));
        let err: Loadable<u32> = Loadable::from_result(Err::<u32, _>("offline"));
        assert!(matches!(err, Loadable::Failed(ref m) if m.as_ref() == "offline"));
        assert!(Loadable::<u32>::default().is_loading());
    }
}
