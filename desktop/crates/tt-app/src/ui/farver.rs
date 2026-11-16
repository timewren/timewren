//! Kundefarver som i web: kundens egen farve (`clients.color`, "#RRGGBB"),
//! ellers en farve udledt af kunde-id'et med web's `clientHue`
//! (`src/app/dashboard/calendar/page.tsx`). Samme kunde får dermed samme
//! farve i desktop og i web's kalender.

use gpui_kit::{Hsla, hsla, rgb, rgba};

use crate::backend::Customer;

/// Paletten i web's kundeformular (`clients/new/page.tsx`): Tailwind 500.
pub const PALETTE: [&str; 8] = [
    "#3b82f6", // blue-500
    "#10b981", // emerald-500
    "#f59e0b", // amber-500
    "#ef4444", // red-500
    "#8b5cf6", // violet-500
    "#ec4899", // pink-500
    "#06b6d4", // cyan-500
    "#84cc16", // lime-500
];

/// Web's `clientHue`: `hash = c + ((hash << 5) - hash)` over UTF-16-enheder
/// med JavaScripts talregler (`<<` på int32, resten som double), og
/// `((hash % 360) + 360) % 360`.
pub fn web_hue(id: &str) -> u32 {
    let mut hash: f64 = 0.0;
    for c in id.encode_utf16() {
        let shifted = to_int32(hash).wrapping_shl(5) as f64;
        hash = c as f64 + (shifted - hash);
    }
    (((hash % 360.0) + 360.0) % 360.0) as u32
}

/// JavaScripts ToInt32.
fn to_int32(v: f64) -> i32 {
    if !v.is_finite() {
        return 0;
    }
    let m = v.trunc().rem_euclid(4_294_967_296.0);
    (if m >= 2_147_483_648.0 { m - 4_294_967_296.0 } else { m }) as i32
}

/// "#RRGGBB" → 0xRRGGBB.
pub fn parse_hex(s: &str) -> Option<u32> {
    let h = s.trim().strip_prefix('#')?;
    (h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(h, 16).ok())
        .flatten()
}

/// Normaliserer brugerens indtastning ("3B82F6", "#3b82f6 ") til "#3b82f6".
/// Tom = `Ok(None)`.
pub fn normalize_hex(s: &str) -> Result<Option<String>, &'static str> {
    let t = s.trim();
    if t.is_empty() {
        return Ok(None);
    }
    let with_hash = if t.starts_with('#') { t.to_string() } else { format!("#{t}") };
    parse_hex(&with_hash)
        .map(|v| Some(format!("#{v:06x}")))
        .ok_or("ugyldig")
}

/// Kundens farve til prikker, badges og kanter.
pub fn color_for(id: &str, color: Option<&str>) -> Hsla {
    match color.and_then(parse_hex) {
        Some(v) => rgb(v).into(),
        // Mellemtone af web's fallback-farvetone, så prikken kan ses i begge tilstande.
        None => hsla(web_hue(id) as f32 / 360.0, 0.55, 0.5, 1.0),
    }
}

pub fn customer_color(c: &Customer) -> Hsla {
    color_for(&c.id, c.color.as_deref())
}

/// Farven for en kunde-id i en liste (grå uden kunde = intern tid).
pub fn color_in(customers: &[Customer], id: Option<&str>) -> Hsla {
    match id.filter(|i| !i.is_empty()) {
        Some(id) => {
            let color = customers.iter().find(|c| c.id == id).and_then(|c| c.color.as_deref());
            color_for(id, color)
        }
        // gray-400
        None => rgb(0x9ca3af).into(),
    }
}

/// Baggrund og kant på en post i kalenderen som web's `time-block.tsx`:
/// hex med 10 %/33 % (lys) eller 20 %/40 % (mørk) dækning, ellers farvetonen
/// som `hsl(h 40% 90%)`/`hsl(h 40% 75%)` og `hsl(h 45% 20%)`/`hsl(h 45% 30%)`.
pub fn block_colors(id: &str, color: Option<&str>, dark: bool) -> (Hsla, Hsla) {
    match color.and_then(parse_hex) {
        Some(v) => {
            let (bg, border) = if dark { (0x33, 0x66) } else { (0x1a, 0x55) };
            (rgba((v << 8) | bg).into(), rgba((v << 8) | border).into())
        }
        None => {
            let h = web_hue(id) as f32 / 360.0;
            if dark {
                (hsla(h, 0.45, 0.20, 1.0), hsla(h, 0.45, 0.30, 1.0))
            } else {
                (hsla(h, 0.40, 0.90, 1.0), hsla(h, 0.40, 0.75, 1.0))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn farvetone_som_web() {
        // Udregnet i Node med web's clientHue.
        assert_eq!(web_hue(""), 0);
        assert_eq!(web_hue("a"), 97);
        assert_eq!(web_hue("abc"), 234);
        assert_eq!(web_hue("c-bageriet"), 29);
        // Lange id'er går gennem int32-overløb; æøå er UTF-16 som i JS.
        assert_eq!(web_hue("7f3c2a10-5b1e-4c7d-9a3e-2f1b0c9d8e7a"), 128);
        assert_eq!(web_hue("Ærø-kunde-æøå-0123456789abcdef"), 123);
    }

    #[test]
    fn hex_normaliseres_og_valideres() {
        assert_eq!(normalize_hex(" 3B82F6 "), Ok(Some("#3b82f6".into())));
        assert_eq!(normalize_hex("#10b981"), Ok(Some("#10b981".into())));
        assert_eq!(normalize_hex(""), Ok(None));
        assert!(normalize_hex("#12345").is_err());
        assert!(normalize_hex("blå").is_err());
        assert_eq!(parse_hex("#ffffff"), Some(0xffffff));
    }

    #[test]
    fn egen_farve_vinder_over_udledt() {
        let own = color_for("x", Some("#ef4444"));
        let derived = color_for("x", None);
        assert_ne!(own, derived);
        assert_eq!(own, Hsla::from(rgb(0xef4444)));
        // Ugyldig farve fra web: udledt i stedet.
        assert_eq!(color_for("x", Some("rød")), derived);
    }

    #[test]
    fn kalenderblok_lys_og_moerk() {
        let (bg, border) = block_colors("x", Some("#3b82f6"), false);
        assert!((bg.a - 0x1a as f32 / 255.0).abs() < 0.01);
        assert!((border.a - 0x55 as f32 / 255.0).abs() < 0.01);
        let (bg, _) = block_colors("x", None, true);
        assert!((bg.l - 0.20).abs() < 0.01);
    }
}
