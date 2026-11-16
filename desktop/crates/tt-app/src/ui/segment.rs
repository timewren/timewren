//! Segment-valg (screens-b): en række knapper, hvor én er valgt. Til
//! filtre ("Alle / Kladder / Sendt") og små valg ("Uge / Måned / Periode").
//!
//! Gruppen har rolle `RadioGroup` og hver knap rolle `RadioButton` med
//! `selected` og `toggled`, så skærmlæseren siger "valgt". Knapperne er gpui-kit's
//! `Button`, så Tab og Mellemrum/Enter virker.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{Selectable as _, Sizable as _};
use gpui_kit::*;

use crate::ui::{self, El};

/// Bygger gruppen. `on_select(indeks, window, app)` kaldes ved valg.
/// Ids: `{id}` for gruppen og `{id}-{indeks}` for knapperne.
pub fn segment(
    id: &str,
    label: &str,
    options: &[&str],
    selected: usize,
    on_select: impl Fn(usize, &mut Window, &mut App) + 'static,
) -> El {
    let on_select = std::rc::Rc::new(on_select);
    ui::el(SharedString::from(id.to_string()), Role::RadioGroup, label.to_string())
        .flex()
        .flex_row()
        .flex_wrap()
        .gap_1()
        .children(options.iter().enumerate().map(|(i, opt)| {
            let f = on_select.clone();
            let b = Button::new(SharedString::from(format!("{id}-{i}")))
                .label(opt.to_string())
                .role(Role::RadioButton)
                .small()
                .selected(i == selected)
                // macOS læser radioknappens tilstand fra toggled (AXValue),
                // ikke fra selected; uden den siger VoiceOver aldrig "valgt".
                .toggled(i == selected)
                .on_click(move |_, w, cx| f(i, w, cx));
            if i == selected { b.primary() } else { b.ghost() }
        }))
}
