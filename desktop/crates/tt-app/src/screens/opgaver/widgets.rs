//! Små byggeklodser til opgaveskærmen: tastaturfokuserbare knapper med
//! ikon, filterchips og mærker. Alle med rolle og label til skærmlæseren og
//! en synlig fokusmarkering.

use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::*;

use super::ikon::{Ic, ikon};
use super::logic::Palette;
use crate::brand::Brand;
use crate::ui::{self, El, farve};

fn h(c: u32) -> Hsla {
    farve::hsla(c)
}

pub fn hsla_of(c: u32) -> Hsla {
    h(c)
}

/// Element, der kan tabbes til, har fokusmarkering og reagerer på klik (og på
/// Enter/Space, når det har fokus).
pub fn pressable(
    b: &Brand,
    id: impl Into<ElementId>,
    role: Role,
    label: impl Into<SharedString>,
) -> El {
    let focus = b.primary;
    ui::el(id, role, label)
        .focusable()
        .cursor_pointer()
        .border_1()
        .border_color(gpui_kit::transparent_black())
        .focus_visible(move |s| s.border_color(focus))
}

/// Rund ikonknap (28 px) med label. `color` er ikonets farve.
pub fn icon_button(
    b: &Brand,
    id: impl Into<ElementId>,
    ic: Ic,
    label: impl Into<SharedString>,
    color: Hsla,
) -> El {
    let hover = b.border.opacity(0.7);
    pressable(b, id, Role::Button, label)
        .size(px(28.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(6.))
        .hover(move |s| s.bg(hover))
        .child(ikon(ic, 16., color))
}

/// Filterchip med ikon og tekst. Til/fra vises med farve, og skærmlæseren får
/// tilstanden som `toggled`.
pub fn chip(b: &Brand, id: impl Into<ElementId>, ic: Option<Ic>, label: SharedString, on: bool) -> El {
    let (bg, fg, edge) = if on {
        (b.primary_soft, b.primary, b.primary)
    } else {
        (gpui_kit::transparent_black(), b.ink, b.border)
    };
    let hover = b.border.opacity(0.5);
    let toggled = if on {
        accesskit::Toggled::True
    } else {
        accesskit::Toggled::False
    };
    pressable(b, id, Role::CheckBox, label.clone())
        .aria_toggled(toggled)
        .h(px(30.))
        .px_3()
        .flex()
        .flex_row()
        .items_center()
        .gap_1p5()
        .rounded_full()
        .text_sm()
        .bg(bg)
        .text_color(fg)
        .border_color(edge)
        .hover(move |s| s.bg(hover))
        .children(ic.map(|ic| ikon(ic, 14., fg)))
        .child(label)
}

/// Mærke med ikon og tekst på en fast flade (prioritet, frist, status).
/// Dekorativt: teksten indgår i kortets samlede label.
pub fn pill(ic: Option<Ic>, text: impl Into<SharedString>, p: Palette) -> Div {
    h_flex()
        .flex_none()
        .items_center()
        .gap_1()
        .px_1p5()
        .py_0p5()
        .rounded_full()
        .text_xs()
        .font_weight(FontWeight::MEDIUM)
        .bg(h(p.bg))
        .text_color(h(p.fg))
        .children(ic.map(|ic| ikon(ic, 12., h(p.accent))))
        .child(text.into())
}

/// Kundens farveprik (8 px). Uden farve: en tom ring i dæmpet farve, så
/// rækken ikke hopper.
pub fn dot(b: &Brand, color: Option<u32>) -> Div {
    match color {
        Some(c) => div().size(px(8.)).flex_none().rounded_full().bg(h(c)),
        None => div()
            .size(px(8.))
            .flex_none()
            .rounded_full()
            .border_1()
            .border_color(b.grey),
    }
}

/// Smal fremdriftsbjælke (4 px) for tid brugt af estimat.
pub fn progress_bar(b: &Brand, fraction: f32, fill: u32, over: bool) -> Div {
    let fill = if over { b.danger } else { h(fill) };
    div()
        .h(px(4.))
        .w_full()
        .rounded_full()
        .bg(b.border)
        .child(div().h_full().rounded_full().bg(fill).w(relative(fraction)))
}

/// Etiket over en værdi i panelet.
pub fn labelled(b: &Brand, label: &'static str, value: impl IntoElement) -> Div {
    v_flex()
        .gap_0p5()
        .child(
            div()
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .text_color(b.grey)
                .child(label),
        )
        .child(div().text_sm().text_color(b.ink).child(value))
}
