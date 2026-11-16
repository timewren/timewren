//! Små fælles hjælpere til listeskærmene (Projekter, Klippekort, Opgaver):
//! skift af valglistens punkter uden for en render, kvittering/fejl og
//! Enter-for-at-gemme i formularfelter.

use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::*;

use crate::brand::Brand;
use crate::ui::forms::{self, Choice, ChoiceState};
use crate::ui::{El, el, format};

/// Skifter punkterne i en valgliste fra en baggrundshentning, hvor der ikke er
/// et `Window` ved hånden. `keep` vælges igen, hvis det stadig findes.
pub fn refresh_choices(
    window: AnyWindowHandle,
    state: &Entity<ChoiceState>,
    items: Vec<Choice>,
    keep: Option<String>,
    cx: &mut App,
) {
    let state = state.clone();
    let _ = window.update(cx, move |_, window, cx| {
        forms::set_choices(&state, items, keep.as_deref(), window, cx);
    });
}

/// Timer til budget, klippekort og estimat: som `format::parse_hours`, men uden
/// loftet på 24 timer (højst 10.000 t). Fejlen er dansk.
pub fn parse_total_hours(s: &str) -> Result<u32, &'static str> {
    let first = format::parse_hours(s);
    if first.is_ok() || s.trim().is_empty() {
        return first;
    }
    let t = s.trim().trim_end_matches(['t', 'h']).trim().replace(',', ".");
    let v: f64 = t.parse().map_err(|_| crate::i18n::t("ui.hours.invalid_total"))?;
    if !v.is_finite() || v <= 0.0 {
        return Err(crate::i18n::t("ui.hours.over_zero"));
    }
    if v > 10_000.0 {
        return Err(crate::i18n::t("ui.hours.max_10000"));
    }
    Ok((v * 60.0).round() as u32)
}

/// Valgfrit timetal ("" = `None`), ellers som `parse_total_hours`.
pub fn parse_optional_total_hours(s: &str) -> Result<Option<u32>, &'static str> {
    if s.trim().is_empty() {
        Ok(None)
    } else {
        parse_total_hours(s).map(Some)
    }
}

/// Kvittering (rolle `Status`) eller fejl (rolle `Alert`) efter en handling.
pub fn notice(b: &Brand, id: &'static str, msg: SharedString, is_err: bool) -> El {
    el(
        id,
        if is_err { Role::Alert } else { Role::Status },
        msg.clone(),
    )
    .text_sm()
    .text_color(if is_err { b.danger } else { b.primary })
    .child(msg)
}

/// Enter i et tekstfelt gemmer formularen.
pub fn enter_to_save<V: 'static>(
    input: &Entity<InputState>,
    window: &mut Window,
    cx: &mut Context<V>,
    save: fn(&mut V, &mut Context<V>),
) -> Subscription {
    cx.subscribe_in(input, window, move |this, _, ev: &InputEvent, _, cx| {
        if matches!(ev, InputEvent::PressEnter { .. }) {
            save(this, cx);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_optional_total_hours, parse_total_hours};

    #[test]
    fn timer_uden_loft_paa_24() {
        assert_eq!(parse_total_hours("1,5"), Ok(90));
        assert_eq!(parse_total_hours("40"), Ok(2400));
        assert_eq!(parse_total_hours("120 t"), Ok(7200));
        assert_eq!(parse_total_hours("2:30"), Ok(150));
        assert!(parse_total_hours("0").is_err());
        assert!(parse_total_hours("-3").is_err());
        assert!(parse_total_hours("abc").is_err());
        assert!(parse_total_hours("20000").is_err());
        assert_eq!(parse_optional_total_hours(" "), Ok(None));
        assert_eq!(parse_optional_total_hours("40"), Ok(Some(2400)));
    }
}
