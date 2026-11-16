//! Delte UI-byggesten. Alle har id og rolle, så VoiceOver/UIA kan læse dem
//! (a11y-reglen fra spiken: kun elementer med både `.id()` og `.role()` når
//! skærmlæseren). Brug altid disse eller gpui-kit's komponenter frem for rå
//! `div().child("tekst")`.
//!
//! Ids skal være unikke blandt søskende. Brug `(navn, indeks)` i lister.

pub mod farve;
pub mod farver;
pub mod format;
pub mod fuzzy;
pub mod icons;
pub mod maal;
pub mod maalvaelger;
pub mod markdown;
pub mod navstate;
pub mod picker;
pub mod punch;
// screens-b
pub mod segment;
pub mod states;
pub mod tokens;

use gpui_kit::component::Disableable as _;
use gpui_kit::component::button::Button;
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::*;

use crate::brand::Brand;

pub use picker::{Picker, PickerEvent, PickerItem};
pub use punch::punch_card_holes;
pub use segment::segment;
pub use icons::{Icon, icon};
pub use states::{Loadable, empty_state, empty_state_icon, error_state, loading_state};

/// Element med id, der er registreret til probe-testen (`.test_support()` er
/// en no-op uden feature `probe`). Sæt rolle og label på det.
pub type El = gpui_kit::base::ObservedElement<Stateful<Div>>;

/// Grundbyggestenen: `div` med id, rolle og label. Brug den til alt, der
/// ikke findes som hjælper herunder eller som gpui-kit-komponent.
/// Kræver `.track_focus` bagefter? Det går fint: `.test_support()` står først.
pub fn el(id: impl Into<ElementId>, role: Role, label: impl Into<SharedString>) -> El {
    div().id(id).test_support().role(role).aria_label(label)
}

/// Tekst som skærmlæseren kan læse (rolle `Label`).
pub fn text(id: impl Into<ElementId>, s: impl Into<SharedString>) -> El {
    let s = s.into();
    div()
        .id(id)
        .test_support()
        .role(Role::Label)
        .aria_label(s.clone())
        .child(s)
}

/// Dæmpet sekundærtekst.
pub fn muted(b: &Brand, id: impl Into<ElementId>, s: impl Into<SharedString>) -> El {
    text(id, s).text_sm().text_color(b.grey)
}

/// Overskrift. `level` 1 = skærmens titel, 2 = kortets titel.
pub fn heading(
    b: &Brand,
    id: impl Into<ElementId>,
    s: impl Into<SharedString>,
    level: usize,
) -> El {
    let s = s.into();
    let d = div()
        .id(id)
        .test_support()
        .role(Role::Heading)
        .aria_level(level)
        .aria_label(s.clone())
        .child(s);
    match level {
        1 => d
            .text_size(px(24.))
            .font_weight(FontWeight::BOLD)
            .text_color(b.ink),
        2 => d
            .text_size(px(tokens::TEXT_BASE))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(b.ink),
        _ => d
            .text_sm()
            .font_weight(FontWeight::MEDIUM)
            .text_color(b.ink),
    }
}

/// Kort: afgrænset gruppe med en titel, som skærmlæseren annoncerer.
pub fn card(b: &Brand, id: impl Into<ElementId>, label: impl Into<SharedString>) -> El {
    div()
        .id(id)
        .test_support()
        .role(Role::Group)
        .aria_label(label)
        .flex()
        .flex_col()
        .gap_3()
        .p(px(tokens::PAD_CARD))
        .rounded(px(tokens::RADIUS_CARD))
        .bg(b.card)
        .border_1()
        .border_color(b.border)
}

/// Kort med titel-række. `actions` kan være knapper til højre for titlen.
pub fn titled_card(
    b: &Brand,
    id: &'static str,
    title: impl Into<SharedString>,
    actions: impl IntoElement,
) -> El {
    let title = title.into();
    card(b, id, title.clone()).child(
        h_flex()
            .justify_between()
            .gap_2()
            .child(heading(
                b,
                SharedString::from(format!("{id}-titel")),
                title,
                2,
            ))
            .child(actions),
    )
}

/// Skærmens ramme: titel, valgfri undertitel og indhold, der kan scrolle.
pub fn page(
    b: &Brand,
    id: &'static str,
    title: impl Into<SharedString>,
    subtitle: Option<SharedString>,
) -> El {
    let title = title.into();
    div()
        .id(id)
        .test_support()
        .role(Role::Main)
        .aria_label(title.clone())
        .size_full()
        .flex()
        .flex_col()
        .gap(px(tokens::GAP_SECTION + 4.))
        .px(px(tokens::PAGE_PAD))
        .pt(px(tokens::SPACE_6 + 4.))
        .pb(px(tokens::PAGE_PAD))
        .overflow_y_scroll()
        .child(
            v_flex()
                .gap_1()
                .child(heading(b, "side-titel", title, 1))
                .children(subtitle.map(|s| muted(b, "side-undertitel", s))),
        )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Neutral,
    Primary,
    Danger,
    Warning,
}

/// Lille statusmærke ("Kladde", "Forfalden", "fra web").
pub fn badge(b: &Brand, id: impl Into<ElementId>, s: impl Into<SharedString>, tone: Tone) -> El {
    let s = s.into();
    badge_base(b, id, s.clone(), tone).0.child(s)
}

fn badge_base(b: &Brand, id: impl Into<ElementId>, s: SharedString, tone: Tone) -> (El, Hsla) {
    let (bg, fg) = match tone {
        Tone::Neutral => (b.border, b.ink),
        Tone::Primary => (b.primary_soft, b.primary),
        Tone::Danger => (b.danger.opacity(0.12), b.danger),
        Tone::Warning => (b.warning.opacity(0.14), b.warning),
    };
    let el = el(id, Role::Label, s)
        .flex_none()
        .text_xs()
        .font_weight(FontWeight::MEDIUM)
        .px_2()
        .py_0p5()
        .rounded_full()
        .bg(bg)
        .text_color(fg);
    (el, fg)
}

/// Statusmærke med ikon foran. Farven alene bærer aldrig betydningen
/// (BRAND.md): ikon og tekst siger det samme.
pub fn badge_icon(
    b: &Brand,
    id: impl Into<ElementId>,
    s: impl Into<SharedString>,
    tone: Tone,
    icon: Icon,
) -> El {
    let s = s.into();
    let (el, fg) = badge_base(b, id, s.clone(), tone);
    el.flex()
        .items_center()
        .gap_1()
        .pl(px(tokens::SPACE_1_5))
        .child(icons::icon(icon).size(tokens::ICON_SM - 2.).color(fg))
        .child(s)
}

/// Felt med synlig etiket og fejltekst under. Feltets id er `id`, fejlens `{id}-fejl`.
pub fn field(
    b: &Brand,
    id: &'static str,
    label: &'static str,
    input: &Entity<InputState>,
    error: Option<SharedString>,
) -> Div {
    v_flex()
        .gap_1()
        .child(
            text(SharedString::from(format!("{id}-etiket")), label)
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .text_color(b.grey),
        )
        .child(Input::new(input).id(id).aria_label(label))
        .children(error.map(|e| {
            div()
                .id(SharedString::from(format!("{id}-fejl")))
                .test_support()
                .role(Role::Alert)
                .aria_label(e.clone())
                .text_xs()
                .text_color(b.danger)
                .child(e)
        }))
}

/// En række i en liste (kunder, poster, fakturaer). Rolle `ListItem` med samlet label.
pub fn list_row(b: &Brand, id: impl Into<ElementId>, label: impl Into<SharedString>) -> El {
    div()
        .id(id)
        .test_support()
        .role(Role::ListItem)
        .aria_label(label)
        .flex()
        .flex_row()
        .items_center()
        .gap_3()
        .px_3()
        .py_2()
        .rounded(px(8.))
        .text_sm()
        .text_color(b.ink)
}

/// Liste-beholder (rolle `List`).
pub fn list(id: impl Into<ElementId>, label: impl Into<SharedString>) -> El {
    div()
        .id(id)
        .test_support()
        .role(Role::List)
        .aria_label(label)
        .flex()
        .flex_col()
        .gap_1()
}

/// Modalt lag over hele vinduet med indholdet centreret foroven. Klik på
/// baggrunden (`{id}-lag`) kalder `on_dismiss`.
/// Læg det som sidste barn i en `relative()` beholder.
///
/// Samme mønster som `forms::modal` ("Ny kunde"): laget er uden rolle, og
/// rollen `Dialog` med label og id `id` sidder på selve kortet. Før sad
/// rollen på laget over hele vinduet, og på Windows kunne UI Automation
/// ikke finde vælgerens søgefelt og træffere.
pub fn modal(
    id: &'static str,
    label: impl Into<SharedString>,
    content: impl IntoElement,
    on_dismiss: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
) -> El {
    div()
        .id(SharedString::from(format!("{id}-lag")))
        .test_support()
        .absolute()
        .inset_0()
        .flex()
        .justify_center()
        .items_start()
        .pt(px(90.))
        .bg(hsla(0., 0., 0., 0.4))
        // Klik må ikke gå igennem til det, der ligger under.
        .occlude()
        .on_mouse_down(MouseButton::Left, on_dismiss)
        .child(
            el(id, Role::Dialog, label)
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(content),
        )
}

/// Knap, som skærmlæseren kan aktivere (UI Automation Invoke på Windows,
/// AXPress på macOS).
///
/// gpui-kit's `Button` kan ikke få en egen a11y-handling. Uden den spiller
/// GPUI en Click fra hjælpeteknologi af som et museklik i midten af
/// elementet, og det går gennem hit-test: en knap udenfor det viste område
/// (fx under en lang tekst i en scroll) eller bag et lag svarer ikke.
///
/// Derfor: et element med rolle `Button`, label og en eksplicit
/// `Click`-handling, der kalder `handler` direkte, og indeni selve knappen
/// uden rolle (så den ikke står to gange i a11y-træet). Musen og tastaturet
/// går som før til den indre knap. `id` er det udvendige elements id.
/// Deaktiveret: ingen a11y-handling og ingen klik-handler.
pub fn a11y_button(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    disabled: bool,
    style: impl FnOnce(Button) -> Button,
    handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> El {
    let id: SharedString = id.into();
    let label = label.into();
    let handler = std::rc::Rc::new(handler);
    let click = handler.clone();
    let inner = style(Button::new(SharedString::from(format!("{id}-knap"))).label(label.clone()))
        .role(None::<Role>)
        .disabled(disabled)
        .on_click(move |ev, window, cx| click(ev, window, cx));
    let outer = el(id, Role::Button, label);
    let outer = if disabled {
        outer
    } else {
        outer.on_a11y_action(AccessibleAction::Click, move |_, window, cx| {
            let ev = ClickEvent::Keyboard(KeyboardClickEvent {
                button: KeyboardButton::Enter,
                bounds: Bounds::default(),
            });
            handler(&ev, window, cx);
        })
    };
    outer.child(inner)
}

/// Release-noter (markdown) som blokke: overskrifter med niveau, afsnit og
/// punkter. `id` er præfiks til elementernes id'er.
pub fn markdown(b: &Brand, id: &'static str, src: &str) -> AnyElement {
    use markdown::{Block, Run};

    fn styled(runs: &[Run]) -> StyledText {
        let mut text = String::new();
        let mut hl = Vec::new();
        for r in runs {
            match r {
                Run::Text(t) => text.push_str(t),
                Run::Bold(t) => {
                    let start = text.len();
                    text.push_str(t);
                    hl.push((
                        start..text.len(),
                        HighlightStyle {
                            font_weight: Some(FontWeight::BOLD),
                            ..Default::default()
                        },
                    ));
                }
            }
        }
        StyledText::new(text).with_highlights(hl)
    }

    let mut col = v_flex().gap_1().id(SharedString::from(id.to_string()));
    for (i, block) in markdown::parse(src).iter().enumerate() {
        let bid = SharedString::from(format!("{id}-{i}"));
        let el = match block {
            Block::Heading { level, runs } => {
                heading(b, bid, markdown::plain(runs), *level as usize)
                    .mt_2()
                    .into_any_element()
            }
            Block::Paragraph(runs) => el(bid, Role::Label, markdown::plain(runs))
                .text_sm()
                .text_color(b.grey)
                .child(styled(runs))
                .into_any_element(),
            Block::ListItem { depth, runs } => el(bid, Role::ListItem, markdown::plain(runs))
                .flex()
                .flex_row()
                .gap_2()
                .pl(px(8. + 16. * f32::from(*depth)))
                .text_sm()
                .text_color(b.grey)
                .child(div().child(if *depth == 0 { "•" } else { "–" }))
                .child(div().flex_1().child(styled(runs)))
                .into_any_element(),
        };
        col = col.child(el);
    }
    col.into_any_element()
}

/// Tastaturgenvej vist som tekst ("⌘K" på macOS, "Ctrl+K" ellers).
pub fn shortcut_label(key: &str) -> String {
    if cfg!(target_os = "macos") {
        format!("⌘{}", key.to_uppercase())
    } else {
        format!("Ctrl+{}", key.to_uppercase())
    }
}

// screens-a
pub mod forms;
pub mod pickers;
