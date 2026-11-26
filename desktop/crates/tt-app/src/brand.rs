//! Udgavens brand lagt oven på gpui-kit's tema: TimeTrack (docs/BRAND.md) eller
//! TimeWren (brandkittets fem farver, `tt_core::edition::TIMEWREN.colors`).
//!
//! Brandet ligger som `Global`, så alle skærme kan hente det med `brand(cx)`.

use std::borrow::Cow;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::{App, Global, Hsla, Rgba, Window, WindowAppearance, px, rgb};

use crate::backend::{Appearance, Backend};

pub const FONT: &str = "Schibsted Grotesk";

/// Farver appen selv tegner med (uden for gpui-kit's komponenter).
#[derive(Clone, Copy, Debug)]
pub struct Brand {
    pub dark: bool,
    /// Mærkets farve (logoet i sidebjælken og på startskærmen). TimeTrack: som
    /// `primary`. TimeWren: Wren på lyse flader, Lichen på mørke.
    pub mark: Hsla,
    /// Granskov. Mørk tilstand bruger den løftede #3F9A78 for kontrastens skyld.
    pub primary: Hsla,
    /// Tekst oven på `primary` (knapper, aktive chips).
    pub on_primary: Hsla,
    pub primary_soft: Hsla,
    pub ink: Hsla,
    pub grey: Hsla,
    pub surface: Hsla,
    pub sidebar: Hsla,
    pub card: Hsla,
    pub border: Hsla,
    /// Kant på inputs og sekundærknapper (BRAND.md `--tt-kant`, mindst 3:1).
    pub edge: Hsla,
    pub danger: Hsla,
    pub warning: Hsla,
    pub suggestion: Hsla,
}

impl Global for Brand {}

/// Rå hex-værdier, så kontrasten kan testes uden GPUI.
#[derive(Clone, Copy, Debug)]
pub struct Palette {
    pub mark: u32,
    pub primary: u32,
    pub on_primary: u32,
    pub primary_soft: u32,
    pub ink: u32,
    pub grey: u32,
    pub surface: u32,
    pub sidebar: u32,
    pub card: u32,
    pub border: u32,
    pub edge: u32,
    pub danger: u32,
    pub warning: u32,
    pub suggestion: u32,
}

pub const TIMETRACK_LIGHT: Palette = Palette {
    mark: 0x1E5B47,
    primary: 0x1E5B47,
    on_primary: 0xFFFFFF,
    // Tokens fra web's docs/BRAND.md (gran-lys, blæk, grå, streg, kant).
    primary_soft: 0xE2EDE8,
    ink: 0x1A1D1C,
    grey: 0x5F6663,
    surface: 0xFFFFFF,
    sidebar: 0xF3F5F4,
    card: 0xF8F9F8,
    border: 0xDFE2DE,
    edge: 0x8A918D,
    danger: 0xB3261E,
    warning: 0x8A5300,
    suggestion: 0xEEF5F2,
};

pub const TIMETRACK_DARK: Palette = Palette {
    mark: 0x5FB38F,
    // Granskov løftet som i BRAND.md's dark mode (links, fokus, knapper).
    primary: 0x5FB38F,
    // Hvid på #5FB38F er kun 2,5:1, så knapteksten er næsten sort i mørk tilstand.
    on_primary: 0x0A0A0A,
    primary_soft: 0x18291F,
    ink: 0xECEFED,
    grey: 0xA3ABA7,
    surface: 0x0A0A0A,
    sidebar: 0x101211,
    card: 0x151816,
    border: 0x2A2F2D,
    edge: 0x6B736F,
    danger: 0xF07167,
    warning: 0xE8B04B,
    suggestion: 0x1B2B25,
};

// TimeWren: kun brandkittets fem farver (web: public/brand/timewren/README.md):
// Ink 1C2119, Wren 8A5A2B, Thicket 3F5A3A, Lichen E8EDE3 og Dawn E8B04B.
// Flader og grå toner er blandinger af Ink og Lichen (og hvid i lys tilstand),
// så der ikke kommer en sjette farve ind. Danger er en funktionsfarve, ikke en
// brandfarve. Dawn er kun advarselsfarven i mørk tilstand: ét element ad gangen.
pub const TIMEWREN_LIGHT: Palette = Palette {
    mark: 0x8A5A2B,
    primary: 0x3F5A3A,
    on_primary: 0xFFFFFF,
    primary_soft: 0xE8EDE3,
    ink: 0x1C2119,
    grey: 0x60645E,
    surface: 0xFFFFFF,
    sidebar: 0xEFF2EB,
    card: 0xF5F7F2,
    border: 0xD0D5CB,
    edge: 0x7B7E7A,
    danger: 0xB3261E,
    warning: 0x8A5A2B,
    suggestion: 0xE8EDE3,
};

pub const TIMEWREN_DARK: Palette = Palette {
    mark: 0xE8EDE3,
    primary: 0xE8EDE3,
    on_primary: 0x1C2119,
    primary_soft: 0x3F5A3A,
    ink: 0xE8EDE3,
    grey: 0xC4C9BF,
    surface: 0x1C2119,
    sidebar: 0x283525,
    card: 0x232C20,
    border: 0x3A4637,
    edge: 0x787D74,
    danger: 0xF07167,
    warning: 0xE8B04B,
    suggestion: 0x2E3E2A,
};

/// Udgavens paletter (valgt ved kompilering som `EDITION`).
pub const LIGHT: Palette = if cfg!(feature = "brand-timewren") {
    TIMEWREN_LIGHT
} else {
    TIMETRACK_LIGHT
};
pub const DARK: Palette = if cfg!(feature = "brand-timewren") {
    TIMEWREN_DARK
} else {
    TIMETRACK_DARK
};

fn c(hex: u32) -> Hsla {
    rgb(hex).into()
}

impl Brand {
    pub fn new(dark: bool) -> Self {
        let p = if dark { DARK } else { LIGHT };
        Brand {
            dark,
            mark: c(p.mark),
            primary: c(p.primary),
            on_primary: c(p.on_primary),
            primary_soft: c(p.primary_soft),
            ink: c(p.ink),
            grey: c(p.grey),
            surface: c(p.surface),
            sidebar: c(p.sidebar),
            card: c(p.card),
            border: c(p.border),
            edge: c(p.edge),
            danger: c(p.danger),
            warning: c(p.warning),
            suggestion: c(p.suggestion),
        }
    }
}

/// Henter brandet. Panikker ikke: falder tilbage til lys tilstand, hvis `apply` ikke er kørt.
pub fn brand(cx: &App) -> Brand {
    cx.try_global::<Brand>()
        .copied()
        .unwrap_or_else(|| Brand::new(false))
}

pub fn register_fonts(cx: &mut App) {
    let fonts: Vec<Cow<'static, [u8]>> = vec![
        Cow::Borrowed(include_bytes!(
            "../assets/fonts/SchibstedGrotesk-Regular.ttf"
        )),
        Cow::Borrowed(include_bytes!(
            "../assets/fonts/SchibstedGrotesk-Medium.ttf"
        )),
        Cow::Borrowed(include_bytes!(
            "../assets/fonts/SchibstedGrotesk-SemiBold.ttf"
        )),
        Cow::Borrowed(include_bytes!("../assets/fonts/SchibstedGrotesk-Bold.ttf")),
    ];
    cx.text_system()
        .add_fonts(fonts)
        .expect("Schibsted Grotesk er indlejret");
}

/// Mørk tilstand: tving med `TT_APPEARANCE=dark|light`, ellers brugerens
/// valg i Indstillinger, og ved "Som systemet" systemet.
pub fn is_dark(choice: Appearance, window: &Window) -> bool {
    let system = matches!(
        window.appearance(),
        WindowAppearance::Dark | WindowAppearance::VibrantDark
    );
    resolve(
        std::env::var("TT_APPEARANCE").ok().as_deref(),
        choice,
        system,
    )
}

/// Det gemte valg; "Som systemet", hvis indstillingerne ikke kan læses.
pub fn chosen(backend: &dyn Backend) -> Appearance {
    backend
        .settings()
        .map(|s| s.appearance)
        .unwrap_or(Appearance::System)
}

fn resolve(env: Option<&str>, choice: Appearance, system_dark: bool) -> bool {
    match (env, choice) {
        (Some("dark"), _) => true,
        (Some("light"), _) => false,
        (_, Appearance::Dark) => true,
        (_, Appearance::Light) => false,
        (_, Appearance::System) => system_dark,
    }
}

/// Sætter gpui-kit's tema og brandets `Global`. Kaldes ved start og ved systemskift.
pub fn apply(dark: bool, cx: &mut App) -> Brand {
    let b = Brand::new(dark);
    Theme::change(
        if dark {
            ThemeMode::Dark
        } else {
            ThemeMode::Light
        },
        None,
        cx,
    );
    Theme::update(cx, |t| {
        t.font_family = FONT.into();
        t.font_size = px(15.);
        t.radius = px(8.);
        t.radius_lg = px(12.);
        t.background = b.surface;
        t.foreground = b.ink;
        t.muted_foreground = b.grey;
        t.border = b.border;
        // Inputs skal kunne ses (WCAG 1.4.11): kant, ikke streg.
        t.input = b.edge;
        t.ring = b.primary;
        t.caret = b.primary;
        t.primary = b.primary;
        t.primary_hover = b.primary.opacity(0.9);
        t.primary_active = b.primary.opacity(0.8);
        t.primary_foreground = b.on_primary;
        t.button_primary = b.primary;
        t.button_primary_hover = b.primary.opacity(0.9);
        t.button_primary_active = b.primary.opacity(0.8);
        t.button_primary_foreground = b.on_primary;
        t.list_active = b.primary_soft;
        t.list_active_border = b.primary;
        t.link = b.primary;
        t.danger = b.danger;
    });
    cx.set_global(b);
    b
}

/// WCAG 2.x kontrastforhold mellem to sRGB-farver.
pub fn contrast(a: u32, b: u32) -> f32 {
    fn lum(hex: u32) -> f32 {
        let c: Rgba = rgb(hex);
        let ch = |v: f32| {
            if v <= 0.03928 {
                v / 12.92
            } else {
                ((v + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
    }
    let (la, lb) = (lum(a), lum(b));
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Begge udgavers paletter testes uanset hvilken feature der er slået til.
    const ALLE: [(&str, Palette); 4] = [
        ("TimeTrack lys", TIMETRACK_LIGHT),
        ("TimeTrack mørk", TIMETRACK_DARK),
        ("TimeWren lys", TIMEWREN_LIGHT),
        ("TimeWren mørk", TIMEWREN_DARK),
    ];

    fn hex(s: &str) -> u32 {
        u32::from_str_radix(s.trim_start_matches('#'), 16).unwrap()
    }

    /// Paletterne bygger på udgavens `colors`, og mærket kan ses på fladerne.
    #[test]
    fn paletterne_stemmer_med_udgavens_farver() {
        use tt_core::edition::{TIMETRACK, TIMEWREN};
        assert_eq!(TIMETRACK_LIGHT.ink, hex(TIMETRACK.colors.ink));
        assert_eq!(TIMETRACK_LIGHT.primary, hex(TIMETRACK.colors.deep));
        assert_eq!(TIMETRACK_LIGHT.primary_soft, hex(TIMETRACK.colors.light));
        assert_eq!(TIMETRACK_DARK.warning, hex(TIMETRACK.colors.accent));
        let c = TIMEWREN.colors;
        assert_eq!(TIMEWREN_LIGHT.mark, hex(c.mark));
        assert_eq!(TIMEWREN_LIGHT.ink, hex(c.ink));
        assert_eq!(TIMEWREN_LIGHT.primary, hex(c.deep));
        assert_eq!(TIMEWREN_LIGHT.primary_soft, hex(c.light));
        assert_eq!(TIMEWREN_DARK.surface, hex(c.ink));
        assert_eq!(TIMEWREN_DARK.primary, hex(c.light));
        assert_eq!(TIMEWREN_DARK.primary_soft, hex(c.deep));
        assert_eq!(TIMEWREN_DARK.warning, hex(c.accent));
        for (navn, p) in ALLE {
            for bg in [p.surface, p.sidebar] {
                let r = contrast(p.mark, bg);
                assert!(r >= 3.0, "{navn}: mærket har kun {r:.2}:1");
            }
        }
    }

    /// Det gemte valg gælder fra start og også, når systemet skifter.
    #[test]
    fn gemt_udseende_vinder_over_systemet() {
        use Appearance::*;
        assert!(!resolve(None, Light, true), "Lys i et mørkt system");
        assert!(resolve(None, Dark, false), "Mørk i et lyst system");
        assert!(resolve(None, System, true));
        assert!(!resolve(None, System, false));
        // TT_APPEARANCE (skærmbilleder) vinder over alt
        assert!(resolve(Some("dark"), Light, false));
        assert!(!resolve(Some("light"), Dark, true));
        assert!(resolve(Some("andet"), System, true));
    }

    /// AA: 4,5:1 for brødtekst. Alle par, appen faktisk tegner tekst med.
    #[test]
    fn kontrast_aa_i_begge_tilstande() {
        for (navn, p) in ALLE {
            let par = [
                ("ink/surface", p.ink, p.surface),
                ("ink/card", p.ink, p.card),
                ("ink/sidebar", p.ink, p.sidebar),
                ("grey/surface", p.grey, p.surface),
                ("grey/card", p.grey, p.card),
                ("grey/sidebar", p.grey, p.sidebar),
                ("primary/surface", p.primary, p.surface),
                ("primary/card", p.primary, p.card),
                ("primary/primary_soft", p.primary, p.primary_soft),
                ("on_primary/primary", p.on_primary, p.primary),
                ("ink/suggestion", p.ink, p.suggestion),
                ("grey/suggestion", p.grey, p.suggestion),
                ("grey/primary_soft", p.grey, p.primary_soft),
                ("danger/surface", p.danger, p.surface),
                ("danger/card", p.danger, p.card),
                ("warning/card", p.warning, p.card),
            ];
            for (hvad, fg, bg) in par {
                let r = contrast(fg, bg);
                assert!(r >= 4.5, "{navn}: {hvad} har kun {r:.2}:1");
            }
        }
    }

    /// Kanter på inputs og fokus skal holde 3:1 mod fladerne (WCAG 1.4.11).
    #[test]
    fn kanter_og_fokus_kan_ses() {
        for (navn, p) in ALLE {
            for (hvad, fg, bg) in [
                ("edge/surface", p.edge, p.surface),
                ("edge/card", p.edge, p.card),
                ("primary/sidebar", p.primary, p.sidebar),
            ] {
                let r = contrast(fg, bg);
                assert!(r >= 3.0, "{navn}: {hvad} har kun {r:.2}:1");
            }
        }
    }

    #[test]
    fn kontrast_kendte_vaerdier() {
        assert!((contrast(0x000000, 0xFFFFFF) - 21.0).abs() < 0.01);
        assert!((contrast(0xFFFFFF, 0xFFFFFF) - 1.0).abs() < 0.01);
    }
}
