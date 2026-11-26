//! Formularer (screens-a): danske parsere til felter, valglister oven på
//! gpui-kit's `Select`, og en modal med rolle `Dialog`.
//!
//! Parserne er rene funktioner, så de kan testes uden GPUI. Fejltekster er
//! danske og kan vises direkte under feltet.

use crate::i18n::{t, tf};
use chrono::{Datelike, Days, NaiveDate};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::InputState;
use gpui_kit::component::select::{Select, SelectItem, SelectState, SearchableVec};
use gpui_kit::component::input::Input;
use gpui_kit::component::{Disableable as _, IndexPath, Selectable as _, Sizable as _, h_flex, v_flex};
use gpui_kit::*;

use crate::brand::Brand;
use crate::ui::{self, El};

// ---------- Parsere ----------

/// "26.10.2026", "26.10.26", "26.10", "26/10", "2026-10-26", "i dag", "i går",
/// "i morgen". Uden år bruges `today`'s år.
pub fn parse_date(s: &str, today: NaiveDate) -> Option<NaiveDate> {
    let s = s.trim().to_lowercase();
    match s.as_str() {
        "i dag" | "idag" | "today" => return Some(today),
        "i går" | "igår" | "yesterday" => return today.checked_sub_days(Days::new(1)),
        "i morgen" | "imorgen" | "tomorrow" => return today.checked_add_days(Days::new(1)),
        _ => {}
    }
    if let Ok(d) = NaiveDate::parse_from_str(&s, "%Y-%m-%d") {
        return Some(d);
    }
    let parts: Vec<&str> = s
        .split(['.', '/', '-'])
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    let (d, m, y) = match parts.as_slice() {
        [d, m] => (d.parse().ok()?, m.parse().ok()?, today.year()),
        [d, m, y] => {
            let y: i32 = y.parse().ok()?;
            let y = if y < 100 { 2000 + y } else { y };
            (d.parse().ok()?, m.parse().ok()?, y)
        }
        _ => return None,
    };
    NaiveDate::from_ymd_opt(y, m, d)
}

/// Kroner til øre: "850", "850,50", "1.250", "1.250,5 kr". Tomt felt = `None`.
/// I TimeWren (euro) er et punkt med 1-2 cifre efter sig et decimaltegn:
/// "12.50" er 12,50 €, ikke 1250 (se [`point_as_decimal`]).
pub fn parse_kr(s: &str) -> Result<Option<i64>, &'static str> {
    parse_kr_for(s, tt_core::edition::EDITION.currency_code != "DKK")
}

/// "12.50" → "12,50", hvis der er ét punkt, intet komma og 1-2 cifre efter
/// punktummet. "1.250" (tre cifre) er stadig tusindtalsskilletegn.
fn point_as_decimal(s: &str) -> String {
    if !s.contains(',')
        && s.matches('.').count() == 1
        && let Some((w, f)) = s.split_once('.')
        && (1..=2).contains(&f.len())
        && f.chars().all(|c| c.is_ascii_digit())
    {
        return format!("{w},{f}");
    }
    s.to_owned()
}

fn parse_kr_for(s: &str, dot_is_decimal: bool) -> Result<Option<i64>, &'static str> {
    let s = s
        .trim()
        .trim_end_matches("kr")
        .trim_end_matches('€')
        .trim_start_matches('€')
        .trim()
        .trim_end_matches('.');
    let owned = if dot_is_decimal { point_as_decimal(s) } else { s.to_owned() };
    let s = owned.as_str();
    if s.is_empty() {
        return Ok(None);
    }
    let (whole, frac) = match s.rsplit_once(',') {
        Some((w, f)) => (w, f),
        None => (s, ""),
    };
    let whole: String = whole.chars().filter(|c| *c != '.' && *c != ' ').collect();
    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) {
        return Err(t("ui.form.amount_empty"));
    }
    if frac.len() > 2 || !frac.chars().all(|c| c.is_ascii_digit()) {
        return Err(t("ui.form.amount_decimals"));
    }
    let kr: i64 = whole.parse().map_err(|_| t("ui.form.amount_too_big"))?;
    let oere = match frac.len() {
        0 => 0,
        1 => frac.parse::<i64>().unwrap_or(0) * 10,
        _ => frac.parse::<i64>().unwrap_or(0),
    };
    kr.checked_mul(100)
        .and_then(|v| v.checked_add(oere))
        .map(Some)
        .ok_or(t("ui.form.amount_too_big"))
}

/// Øre som feltværdi uden enhed: 85000 → "850", 85050 → "850,50".
pub fn kr_field(oere: i64) -> String {
    if oere % 100 == 0 {
        (oere / 100).to_string()
    } else {
        format!("{},{:02}", oere / 100, (oere % 100).abs())
    }
}

/// Minutter som feltværdi: 90 → "1,5", 60 → "1".
pub fn hours_field(minutes: u32) -> String {
    crate::ui::format::hours_number(minutes as i64)
}

/// CVR: 8 cifre, mellemrum tilladt. Tomt felt = `None`.
pub fn parse_cvr(s: &str) -> Result<Option<String>, &'static str> {
    let digits: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if digits.is_empty() {
        return Ok(None);
    }
    if digits.len() != 8 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(t("ui.form.cvr"));
    }
    Ok(Some(digits))
}

/// Enkel kontrol af e-mail. Tomt felt = `None`.
pub fn parse_email(s: &str) -> Result<Option<String>, &'static str> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(None);
    }
    let ok = s.split_once('@').is_some_and(|(local, domain)| {
        !local.is_empty()
            && domain.contains('.')
            && !domain.starts_with('.')
            && !domain.ends_with('.')
            && !s.contains(char::is_whitespace)
    });
    if ok {
        Ok(Some(s.to_string()))
    } else {
        Err(t("ui.form.email"))
    }
}

/// Valgfrit timetal ("" = `None`), ellers som `format::parse_hours`.
pub fn parse_optional_hours(s: &str) -> Result<Option<u32>, &'static str> {
    if s.trim().is_empty() {
        Ok(None)
    } else {
        crate::ui::format::parse_hours(s).map(Some)
    }
}

/// Søgning: alle ord i `query` skal findes i `text` (uden forskel på store og små bogstaver).
pub fn matches_query(text: &str, query: &str) -> bool {
    let text = text.to_lowercase();
    query
        .to_lowercase()
        .split_whitespace()
        .all(|w| text.contains(w))
}

// ---------- Valglister ----------

/// Et valg i en `Select`. Tom `value` betyder "intet valgt" (fx "Intet projekt").
#[derive(Clone, Debug, PartialEq)]
pub struct Choice {
    pub value: SharedString,
    pub label: SharedString,
}

impl Choice {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Choice {
            value: value.into(),
            label: label.into(),
        }
    }
}

impl SelectItem for Choice {
    type Value = SharedString;

    fn title(&self) -> SharedString {
        self.label.clone()
    }

    fn value(&self) -> &SharedString {
        &self.value
    }
}

pub type ChoiceList = SearchableVec<Choice>;
pub type ChoiceState = SelectState<ChoiceList>;

/// Ny valgliste med `selected` valgt (eller første punkt).
pub fn choice_state<V: 'static>(
    items: Vec<Choice>,
    selected: Option<&str>,
    window: &mut Window,
    cx: &mut Context<V>,
) -> Entity<ChoiceState> {
    let ix = selected
        .and_then(|v| items.iter().position(|c| c.value.as_ref() == v))
        .or(if items.is_empty() { None } else { Some(0) });
    let searchable = items.len() > 8;
    cx.new(|cx| {
        SelectState::new(
            SearchableVec::new(items),
            ix.map(IndexPath::new),
            window,
            cx,
        )
        .searchable(searchable)
    })
}

/// Skifter punkterne og vælger `selected` (eller første punkt).
pub fn set_choices(
    state: &Entity<ChoiceState>,
    items: Vec<Choice>,
    selected: Option<&str>,
    window: &mut Window,
    cx: &mut App,
) {
    let ix = selected
        .and_then(|v| items.iter().position(|c| c.value.as_ref() == v))
        .or(if items.is_empty() { None } else { Some(0) });
    state.update(cx, |s, cx| {
        s.set_items(SearchableVec::new(items), window, cx);
        s.set_selected_index(ix.map(IndexPath::new), window, cx);
    });
}

/// Vælger punktet med værdien `value`.
pub fn select_value(state: &Entity<ChoiceState>, value: &str, window: &mut Window, cx: &mut App) {
    let v: SharedString = value.to_string().into();
    state.update(cx, |s, cx| s.set_selected_value(&v, window, cx));
}

/// Den valgte værdi; `None` hvis intet er valgt eller værdien er tom.
pub fn chosen(state: &Entity<ChoiceState>, cx: &App) -> Option<String> {
    state
        .read(cx)
        .selected_value()
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
}

/// Valgliste med synlig etiket. Listens id er `id`.
pub fn select_field(
    b: &Brand,
    id: &'static str,
    label: &'static str,
    state: &Entity<ChoiceState>,
) -> Div {
    v_flex()
        .gap_1()
        .child(
            ui::text(SharedString::from(format!("{id}-etiket")), label)
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .text_color(b.grey),
        )
        .child(
            Select::new(state)
                .id(id)
                .accessibility_label(label)
                .search_placeholder(t("ui.form.search"))
                .menu_max_h(px(320.)),
        )
}

/// Tekstfelt med synlig etiket, label til skærmlæseren og fejl under.
/// Feltets id er `id`, fejlens `{id}-fejl`.
pub fn text_field(
    b: &Brand,
    id: &'static str,
    label: &'static str,
    input: &Entity<InputState>,
    error: Option<SharedString>,
) -> Div {
    v_flex()
        .gap_1()
        .flex_1()
        .child(
            ui::text(SharedString::from(format!("{id}-etiket")), label)
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .text_color(b.grey),
        )
        .child(Input::new(input).id(id).aria_label(label))
        .children(error.map(|e| form_error(b, SharedString::from(format!("{id}-fejl")), e)))
}

/// Feltets tekst, trimmet.
pub fn value(input: &Entity<InputState>, cx: &App) -> String {
    input.read(cx).value().trim().to_string()
}

/// Nyt tekstfelt med pladsholder og startværdi.
pub fn input<V: 'static>(
    placeholder: &str,
    initial: &str,
    window: &mut Window,
    cx: &mut Context<V>,
) -> Entity<InputState> {
    let placeholder = placeholder.to_string();
    let initial = initial.to_string();
    cx.new(|cx| {
        InputState::new(window, cx)
            .placeholder(placeholder)
            .default_value(initial)
    })
}

// ---------- Modal ----------

/// Modal oven på skærmen: dæmpet baggrund og et kort med rolle `Dialog`.
/// Skærmens rod skal være `.relative()`. Læg felter og knapper på med `.child`.
pub fn modal(b: &Brand, id: &'static str, title: impl Into<SharedString>) -> (Div, El) {
    let title = title.into();
    let overlay = div()
        .absolute()
        .inset_0()
        .flex()
        .items_center()
        .justify_center()
        .bg(gpui_kit::black().opacity(if b.dark { 0.6 } else { 0.35 }))
        .occlude();
    let dialog = div()
        .id(id)
        .test_support()
        .role(Role::Dialog)
        .aria_label(title.clone())
        .w(px(460.))
        .max_h(relative(0.9))
        .overflow_y_scroll()
        .flex()
        .flex_col()
        .gap_3()
        .p_5()
        .rounded(px(14.))
        .bg(b.surface)
        .border_1()
        .border_color(b.border)
        .shadow_lg()
        .child(ui::heading(
            b,
            SharedString::from(format!("{id}-titel")),
            title,
            1,
        ));
    (overlay, dialog)
}

/// Fejl i en formular (rolle `Alert`).
pub fn form_error(b: &Brand, id: impl Into<ElementId>, msg: impl Into<SharedString>) -> El {
    let msg = msg.into();
    div()
        .id(id)
        .test_support()
        .role(Role::Alert)
        .aria_label(msg.clone())
        .text_sm()
        .text_color(b.danger)
        .child(msg)
}

/// "Gem" og "Annullér" til højre i bunden af en formular.
pub fn form_buttons(
    id: &'static str,
    save_label: &'static str,
    busy: bool,
    on_save: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    on_cancel: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Div {
    h_flex()
        .justify_end()
        .gap_2()
        .pt_2()
        .child(
            Button::new(SharedString::from(format!("{id}-annuller")))
                .label(t("ui.form.cancel"))
                .ghost()
                .on_click(on_cancel),
        )
        .child(
            Button::new(SharedString::from(format!("{id}-gem")))
                .label(save_label)
                .primary()
                .loading(busy)
                .disabled(busy)
                .on_click(on_save),
        )
}

/// Segmentkontrol ("Aktive | Arkiverede", "Uge | Dag") af knapper med
/// `selected`. Ikke `TabBar`, fordi navigationens faner er de eneste `Tab`-roller.
/// Knappernes ids er `{id}-{indeks}`.
pub fn segmented(
    b: &Brand,
    id: &'static str,
    label: &'static str,
    options: &[&'static str],
    selected: usize,
    on_select: impl Fn(usize, &mut Window, &mut App) + 'static,
) -> El {
    let on_select = std::rc::Rc::new(on_select);
    ui::el(id, Role::RadioGroup, label)
        .flex()
        .flex_row()
        .gap_0p5()
        .p_0p5()
        .rounded(px(8.))
        .bg(b.border.opacity(0.5))
        .children(options.iter().enumerate().map(|(i, opt)| {
            let on_select = on_select.clone();
            let btn = Button::new(SharedString::from(format!("{id}-{i}")))
                .label(*opt)
                .small();
            let btn = if i == selected { btn.primary() } else { btn.ghost() };
            btn.selected(i == selected)
                .accessibility_label(if i == selected {
                    tf("ui.form.selected", &[("option", opt)])
                } else {
                    opt.to_string()
                })
                .on_click(move |_, window, cx| on_select(i, window, cx))
        }))
}

/// Lille knap til handlinger i lister.
pub fn small_button(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Button {
    Button::new(id).label(label).small().outline()
}

/// To tryk før en arkivering, som web's bekræftelsesdialog ("Er du sikker?"):
/// første tryk på et element sætter `pending` og giver `false` (spørg),
/// andet tryk på samme element rydder den og giver `true` (udfør). Et tryk
/// på et andet element spørger forfra.
pub fn confirm_twice(pending: &mut Option<String>, id: &str) -> bool {
    if pending.as_deref() == Some(id) {
        *pending = None;
        true
    } else {
        *pending = Some(id.to_string());
        false
    }
}

/// Antal dage til forfald, som web (`paymentTermsDays`: heltal 0-365). Tomt
/// felt = standarden (`None`).
pub fn parse_payment_terms(s: &str) -> Result<Option<u32>, &'static str> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(None);
    }
    match s.parse::<u32>() {
        Ok(d) if d <= 365 => Ok(Some(d)),
        _ => Err(t("ui.form.payment_terms")),
    }
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::{
        confirm_twice, hours_field, kr_field, matches_query, parse_cvr, parse_date, parse_email, parse_kr,
        parse_kr_for, parse_optional_hours, parse_payment_terms,
    };

    #[test]
    fn arkivering_kraever_to_tryk() {
        let mut pending = None;
        assert!(!confirm_twice(&mut pending, "k1"), "første tryk spørger");
        assert_eq!(pending.as_deref(), Some("k1"));
        assert!(!confirm_twice(&mut pending, "k2"), "et andet element spørger forfra");
        assert!(confirm_twice(&mut pending, "k2"), "andet tryk udfører");
        assert_eq!(pending, None);
        assert!(!confirm_twice(&mut pending, "k2"), "og næste gang spørges igen");
    }

    #[test]
    fn betalingsfrist_valideres() {
        assert_eq!(parse_payment_terms(""), Ok(None));
        assert_eq!(parse_payment_terms(" 30 "), Ok(Some(30)));
        assert_eq!(parse_payment_terms("0"), Ok(Some(0)));
        assert_eq!(parse_payment_terms("365"), Ok(Some(365)));
        assert!(parse_payment_terms("366").is_err());
        assert!(parse_payment_terms("-1").is_err());
        assert!(parse_payment_terms("14,5").is_err());
        assert!(parse_payment_terms("x").is_err());
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
    }

    #[test]
    fn datoer_paa_dansk() {
        let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd);
        assert_eq!(parse_date("26.10.2026", today()), d(2026, 10, 26));
        assert_eq!(parse_date("1.2.27", today()), d(2027, 2, 1));
        assert_eq!(parse_date("24/12", today()), d(2026, 12, 24));
        assert_eq!(parse_date("2026-11-03", today()), d(2026, 11, 3));
        assert_eq!(parse_date("i morgen", today()), d(2026, 10, 27));
        assert_eq!(parse_date("I går", today()), d(2026, 10, 25));
        assert_eq!(parse_date("31.2.2026", today()), None);
        assert_eq!(parse_date("hej", today()), None);
    }

    #[test]
    fn kroner_til_oere() {
        assert_eq!(parse_kr(""), Ok(None));
        // Punktum som decimaltegn (kun euro) og valutategn.
        assert_eq!(parse_kr_for("12.50", true), Ok(Some(1_250)));
        assert_eq!(parse_kr_for("€ 12.5", true), Ok(Some(1_250)));
        assert_eq!(parse_kr_for("850 €", true), Ok(Some(85_000)));
        assert_eq!(parse_kr_for("1.250", true), Ok(Some(125_000)), "tre cifre: tusindtal");
        assert_eq!(parse_kr_for("1.250,50", true), Ok(Some(125_050)));
        assert_eq!(parse_kr_for("12.50", false), Ok(Some(125_000)), "kr: som før");
        assert_eq!(parse_kr("850"), Ok(Some(85_000)));
        assert_eq!(parse_kr("850,5"), Ok(Some(85_050)));
        assert_eq!(parse_kr("1.250,75 kr"), Ok(Some(125_075)));
        assert_eq!(parse_kr("14.000"), Ok(Some(1_400_000)));
        assert!(parse_kr("85o").is_err());
        assert!(parse_kr("1,234").is_err());
        assert!(parse_kr("-5").is_err());
        assert_eq!(kr_field(85_000), "850");
        assert_eq!(kr_field(85_050), "850,50");
    }

    #[test]
    fn cvr_og_email() {
        assert_eq!(parse_cvr(""), Ok(None));
        assert_eq!(parse_cvr("1234 5678"), Ok(Some("12345678".into())));
        assert!(parse_cvr("1234567").is_err());
        assert!(parse_cvr("1234567a").is_err());
        assert_eq!(parse_email(" "), Ok(None));
        assert_eq!(parse_email("a@b.dk"), Ok(Some("a@b.dk".into())));
        assert!(parse_email("a@b").is_err());
        assert!(parse_email("@b.dk").is_err());
        assert!(parse_email("a b@c.dk").is_err());
    }

    #[test]
    fn valgfrie_timer() {
        assert_eq!(parse_optional_hours(""), Ok(None));
        assert_eq!(parse_optional_hours("1,5"), Ok(Some(90)));
        assert!(parse_optional_hours("x").is_err());
        assert_eq!(hours_field(90), "1,5");
    }

    #[test]
    fn soegning_paa_alle_ord() {
        assert!(matches_query("Bageriet på Hjørnet", "bager hjør"));
        assert!(matches_query("Café Åbrinken", "åbr"));
        assert!(!matches_query("Café Åbrinken", "bager"));
        assert!(matches_query("hvad som helst", ""));
    }
}
