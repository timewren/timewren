//! Farveregning på rå hex-værdier (`0xRRGGBB`): blanding og WCAG-kontrast.
//!
//! Samme regler som web's `color-contrast.ts` og `client-accent.ts`, så en
//! kundefarve ser ens ud i web, på opgaverne og i kalenderen. Ingen GPUI her,
//! så alt kan testes.

use gpui_kit::{Hsla, rgb};

/// Kortets egen baggrund, som kundefarvens optoning blandes ind over
/// (web: Tailwind `bg-white` / `dark:bg-gray-800`).
pub const CARD_LIGHT: u32 = 0xFFFFFF;
pub const CARD_DARK: u32 = 0x1F2937;

/// "#RRGGBB" eller "#RGB" (med eller uden #) til `0xRRGGBB`.
pub fn parse_hex(s: &str) -> Option<u32> {
    let h = s.trim().trim_start_matches('#');
    let full: String = match h.len() {
        3 => h.chars().flat_map(|c| [c, c]).collect(),
        6 => h.to_owned(),
        _ => return None,
    };
    if !full.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(&full, 16).ok()
}

fn channels(c: u32) -> (f64, f64, f64) {
    (
        f64::from((c >> 16) & 0xFF),
        f64::from((c >> 8) & 0xFF),
        f64::from(c & 0xFF),
    )
}

fn from_channels(r: f64, g: f64, b: f64) -> u32 {
    let q = |v: f64| v.round().clamp(0.0, 255.0) as u32;
    (q(r) << 16) | (q(g) << 8) | q(b)
}

fn lum_channel(v: f64) -> f64 {
    let s = v / 255.0;
    if s <= 0.03928 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

/// WCAG relativ luminans, 0 (sort) til 1 (hvid).
pub fn luminance(c: u32) -> f64 {
    let (r, g, b) = channels(c);
    0.2126 * lum_channel(r) + 0.7152 * lum_channel(g) + 0.0722 * lum_channel(b)
}

/// WCAG-kontrastforhold, 1 til 21.
pub fn contrast(a: u32, b: u32) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// `fg` blandet over `bg` med `alpha` (0-1) til en opak farve.
pub fn mix(fg: u32, bg: u32, alpha: f64) -> u32 {
    let (fr, fg_, fb) = channels(fg);
    let (br, bg_, bb) = channels(bg);
    from_channels(
        fr * alpha + br * (1.0 - alpha),
        fg_ * alpha + bg_ * (1.0 - alpha),
        fb * alpha + bb * (1.0 - alpha),
    )
}

fn to_hsl(c: u32) -> (f64, f64, f64) {
    let (r, g, b) = channels(c);
    let (r, g, b) = (r / 255.0, g / 255.0, b / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < f64::EPSILON {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if (max - r).abs() < f64::EPSILON {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h / 6.0, s, l)
}

fn from_hsl(h: f64, s: f64, l: f64) -> u32 {
    if s == 0.0 {
        let v = l * 255.0;
        return from_channels(v, v, v);
    }
    let hue = |p: f64, q: f64, t: f64| {
        let t = if t < 0.0 {
            t + 1.0
        } else if t > 1.0 {
            t - 1.0
        } else {
            t
        };
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    from_channels(
        hue(p, q, h + 1.0 / 3.0) * 255.0,
        hue(p, q, h) * 255.0,
        hue(p, q, h - 1.0 / 3.0) * 255.0,
    )
}

/// Justerer lysstyrken af `fg`, til den har mindst `min_ratio` kontrast mod
/// `bg`, uden at ændre farvetonen. Lykkes det ikke, er det sort eller hvid.
pub fn accessible_text(fg: u32, bg: u32, min_ratio: f64) -> u32 {
    if contrast(fg, bg) >= min_ratio {
        return fg;
    }
    let (h, s, mut l) = to_hsl(fg);
    let bg_light = luminance(bg) > 0.5;
    let step = if bg_light { -0.02 } else { 0.02 };
    for _ in 0..50 {
        l = (l + step).clamp(0.0, 1.0);
        let cand = from_hsl(h, s, l);
        if contrast(cand, bg) >= min_ratio {
            return cand;
        }
        if l <= 0.0 || l >= 1.0 {
            break;
        }
    }
    if bg_light { 0x000000 } else { 0xFFFFFF }
}

/// WCAG AA for normal tekst.
pub const AA: f64 = 4.5;

/// Det en kundefarve bliver til på et kort eller en kalenderpost.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Accent {
    /// Kundens egen farve, fuld styrke (venstrekant, prik).
    pub edge: u32,
    /// Let optoning af kortets baggrund.
    pub tint: u32,
    /// Tekst på `tint`, mindst AA.
    pub text: u32,
}

/// Kantfarve, optoning og tekstfarve for en kundefarve i lyst eller mørkt tema.
/// Optoningen er web's (12 % lyst, 26 % mørkt over kortets baggrund).
pub fn accent(color: u32, dark: bool) -> Accent {
    let (surface, alpha) = if dark {
        (CARD_DARK, 0.26)
    } else {
        (CARD_LIGHT, 0.12)
    };
    let tint = mix(color, surface, alpha);
    // Brødtekst følger temaet; kundefarven bruges kun til tekst, når den kan
    // holde AA, så den aldrig bliver svær at læse. Kantfarven er altid
    // kundens egen.
    let base = if dark { 0xF3F4F6 } else { 0x111827 };
    Accent {
        edge: color,
        tint,
        text: accessible_text(base, tint, AA),
    }
}

/// Kundefarven som tekst/ikon oven på `bg` (fx badge), mindst AA.
pub fn readable(color: u32, bg: u32) -> u32 {
    accessible_text(color, bg, AA)
}

/// Kundens farve som tal: den egne fra web (`clients.color`), ellers den
/// udledte af id'et (web's `clientHue`), som `ui::farver` leverer. Alle
/// kunder har dermed en farve, ligesom i web's kalender.
pub fn customer_color(c: &crate::backend::Customer) -> Option<u32> {
    Some(hsla_to_hex(crate::ui::farver::customer_color(c)))
}

fn hsla_to_hex(h: Hsla) -> u32 {
    let r = gpui_kit::Rgba::from(h);
    let q = |v: f32| (v * 255.0).round().clamp(0.0, 255.0) as u32;
    (q(r.r) << 16) | (q(r.g) << 8) | q(r.b)
}

/// Kundens kant, optoning og tekstfarve, eller `None` uden farve.
pub fn customer_accent(c: Option<&crate::backend::Customer>, dark: bool) -> Option<Accent> {
    c.and_then(customer_color).map(|col| accent(col, dark))
}

pub fn hsla(c: u32) -> Hsla {
    rgb(c).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_parses_with_and_without_hash_and_short_form() {
        assert_eq!(parse_hex("#1E5B47"), Some(0x1E5B47));
        assert_eq!(parse_hex("1e5b47"), Some(0x1E5B47));
        assert_eq!(parse_hex("#abc"), Some(0xAABBCC));
        assert_eq!(parse_hex("#12345"), None);
        assert_eq!(parse_hex("#GGGGGG"), None);
        assert_eq!(parse_hex(""), None);
    }

    #[test]
    fn contrast_matches_wcag_reference_values() {
        assert!((contrast(0x000000, 0xFFFFFF) - 21.0).abs() < 0.01);
        assert!((contrast(0x777777, 0xFFFFFF) - 4.48).abs() < 0.02);
        assert!((contrast(0x123456, 0x123456) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn mix_is_web_mixhex() {
        // web: mixHex("#ff0000", "#ffffff", 0.12) = #ffe0e0
        assert_eq!(mix(0xFF0000, 0xFFFFFF, 0.12), 0xFFE0E0);
        assert_eq!(mix(0x123456, 0xFFFFFF, 1.0), 0x123456);
        assert_eq!(mix(0x123456, 0xFFFFFF, 0.0), 0xFFFFFF);
    }

    #[test]
    fn accessible_text_keeps_good_colours_and_fixes_bad_ones() {
        assert_eq!(accessible_text(0x000000, 0xFFFFFF, AA), 0x000000);
        // Gul på hvid er ulæselig; resultatet skal holde AA og bevare tonen.
        let fixed = accessible_text(0xFACC15, 0xFFFFFF, AA);
        assert!(contrast(fixed, 0xFFFFFF) >= AA);
        assert_ne!(fixed, 0xFACC15);
        // Mørk blå på mørk baggrund lysnes.
        let fixed = accessible_text(0x1E3A8A, 0x111111, AA);
        assert!(contrast(fixed, 0x111111) >= AA);
    }

    #[test]
    fn accent_text_has_aa_for_every_kind_of_colour_in_both_themes() {
        let colours = [
            0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF,
            0x1E5B47, 0xFACC15, 0x7C3AED, 0xF97316, 0x0EA5E9, 0x808080, 0xEF4444, 0x22C55E,
        ];
        for dark in [false, true] {
            for c in colours {
                let a = accent(c, dark);
                assert_eq!(a.edge, c);
                assert!(
                    contrast(a.text, a.tint) >= AA,
                    "#{c:06X} dark={dark}: {:.2}",
                    contrast(a.text, a.tint)
                );
            }
        }
    }

    #[test]
    fn kundefarver_fra_web_og_udledte_giver_laesbar_tekst() {
        use crate::backend::Customer;
        let mut checked = 0;
        for n in 0..200 {
            for own in [None, Some("#3b82f6"), Some("#facc15"), Some("#111111")] {
                let c = Customer {
                    id: format!("kunde-{n}"),
                    color: own.map(str::to_owned),
                    ..Default::default()
                };
                let col = customer_color(&c).expect("alle kunder har en farve");
                for dark in [false, true] {
                    let a = accent(col, dark);
                    assert!(contrast(a.text, a.tint) >= AA, "{} {own:?} dark={dark}", c.id);
                    checked += 1;
                }
            }
        }
        assert_eq!(checked, 1600);
        // Egen farve vinder.
        let c = Customer {
            id: "x".into(),
            color: Some("#ef4444".into()),
            ..Default::default()
        };
        assert_eq!(customer_color(&c), Some(0xEF4444));
    }
}
