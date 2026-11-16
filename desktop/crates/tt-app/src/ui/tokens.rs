//! Designtokens: mellemrum, radier, typografi, skygger, bevægelse, layout og
//! web's farver, samlet ét sted. Farverne for lys og mørk står i
//! `crate::brand` (`LIGHT`/`DARK`, hentes med `brand(cx)`); her ligger resten.
//!
//! Kilden er TimeTracks `docs/BRAND.md` i web-repoet: Schibsted Grotesk,
//! granskov, radius 8 på knapper og inputs, 14 på kort og vinduer, pille på
//! chips, fokus som 2 px granskov-ring.
//!
//! ```ignore
//! use crate::ui::tokens as tk;
//! div().gap(px(tk::SPACE_3)).rounded(px(tk::RADIUS_CARD)).text_size(px(tk::TEXT_SM))
//! ```

use std::time::Duration;

use gpui_kit::*;

use crate::brand::Brand;

// ---------- Mellemrum (4 px-grid) ----------

pub const SPACE_0_5: f32 = 2.;
pub const SPACE_1: f32 = 4.;
pub const SPACE_1_5: f32 = 6.;
pub const SPACE_2: f32 = 8.;
pub const SPACE_3: f32 = 12.;
pub const SPACE_4: f32 = 16.;
pub const SPACE_5: f32 = 20.;
pub const SPACE_6: f32 = 24.;
pub const SPACE_8: f32 = 32.;
pub const SPACE_10: f32 = 40.;
pub const SPACE_12: f32 = 48.;

/// Afstand mellem kort i en kolonne og mellem kolonner.
pub const GAP_SECTION: f32 = SPACE_4;
/// Indvendig luft i et kort.
pub const PAD_CARD: f32 = SPACE_5;

// ---------- Radier (BRAND.md: "hjørneradius efter hierarki") ----------

/// Små mærker og felter i tætte lister.
pub const RADIUS_SM: f32 = 6.;
/// Knapper, inputs og navigationspunkter.
pub const RADIUS_MD: f32 = 8.;
/// Kort og dialoger.
pub const RADIUS_CARD: f32 = 14.;
/// Chips og mærker (pille).
pub const RADIUS_FULL: f32 = 999.;

// ---------- Typografi (Schibsted Grotesk, vægt 400-700) ----------

pub const TEXT_XS: f32 = 12.;
pub const TEXT_SM: f32 = 14.;
pub const TEXT_BASE: f32 = 15.;
pub const TEXT_LG: f32 = 18.;
pub const TEXT_XL: f32 = 20.;
/// Skærmens titel (h1).
pub const TEXT_TITLE: f32 = 24.;
/// Det store ur på I dag.
pub const TEXT_DISPLAY: f32 = 56.;

pub const WEIGHT_REGULAR: FontWeight = FontWeight::NORMAL;
pub const WEIGHT_MEDIUM: FontWeight = FontWeight::MEDIUM;
pub const WEIGHT_SEMIBOLD: FontWeight = FontWeight::SEMIBOLD;
pub const WEIGHT_BOLD: FontWeight = FontWeight::BOLD;

// ---------- Ikoner ----------

pub const ICON_SM: f32 = 14.;
pub const ICON_MD: f32 = 16.;
pub const ICON_LG: f32 = 20.;
/// Ikonet i en tom tilstand.
pub const ICON_EMPTY: f32 = 32.;

// ---------- Layout ----------

/// Sidemenuen i fuld bredde.
pub const NAV_WIDTH: f32 = 220.;
/// Sidemenuen som smal ikonrail.
pub const NAV_RAIL_WIDTH: f32 = 60.;
/// Under denne vinduesbredde klapper menuen selv sammen.
pub const NAV_AUTO_COLLAPSE_BELOW: f32 = 1040.;
/// Indholdet bliver ikke bredere end dette (lange linjer er svære at læse).
pub const CONTENT_MAX_WIDTH: f32 = 1240.;
/// Skærmens kant-luft i normal og smal bredde.
pub const PAGE_PAD: f32 = SPACE_8;
pub const PAGE_PAD_NARROW: f32 = SPACE_5;
/// Under denne indholdsbredde står kolonnerne under hinanden.
pub const TWO_COLUMNS_FROM: f32 = 880.;

// ---------- Bevægelse ----------

/// Korte, lydløse overgange. Slås fra ved "Reducer bevægelse".
pub const MOTION_FAST: Duration = Duration::from_millis(120);
pub const MOTION_BASE: Duration = Duration::from_millis(160);

/// Varighed for en overgang: nul, når brugeren har bedt om mindre bevægelse.
pub fn motion(d: Duration) -> Duration {
    if reduce_motion() { Duration::ZERO } else { d }
}

/// "Reducer bevægelse" i systemet (macOS: Tilgængelighed → Skærm).
/// `TT_REDUCE_MOTION=1|0` tvinger (tests og skærmbilleder).
pub fn reduce_motion() -> bool {
    // Tests klikker straks efter et skift; en halvfærdig overgang må ikke
    // afhænge af, hvor travlt maskinen har.
    if cfg!(test) {
        return true;
    }
    resolve_reduce_motion(
        std::env::var("TT_REDUCE_MOTION").ok().as_deref(),
        system_reduce_motion,
    )
}

fn resolve_reduce_motion(env: Option<&str>, system: impl FnOnce() -> bool) -> bool {
    match env {
        Some("1") => true,
        Some("0") => false,
        _ => system(),
    }
}

#[cfg(target_os = "macos")]
fn system_reduce_motion() -> bool {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    // SAFETY: NSWorkspace findes altid i AppKit, og begge beskeder er
    // dokumenterede uden argumenter; sharedWorkspace er aldrig nil.
    unsafe {
        let ws: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        if ws.is_null() {
            return false;
        }
        let reduce: bool = msg_send![ws, accessibilityDisplayShouldReduceMotion];
        reduce
    }
}

#[cfg(not(target_os = "macos"))]
fn system_reduce_motion() -> bool {
    // Windows: "Vis animationer i Windows" kræver SystemParametersInfo; uden
    // den bruger vi korte overgange (120-160 ms), som også er lydløse.
    false
}

// ---------- Skygger ----------

/// Let skygge til kort, der skal løfte sig (timeren, dialoger).
pub fn shadow_sm(b: &Brand) -> Vec<BoxShadow> {
    vec![BoxShadow {
        color: hsla(0., 0., 0., if b.dark { 0.4 } else { 0.06 }),
        offset: point(px(0.), px(1.)),
        blur_radius: px(2.),
        spread_radius: px(0.),
        inset: false,
    }]
}

/// Dialoger og beskeder over indholdet.
pub fn shadow_lg(b: &Brand) -> Vec<BoxShadow> {
    vec![
        BoxShadow {
            color: hsla(0., 0., 0., if b.dark { 0.5 } else { 0.08 }),
            offset: point(px(0.), px(8.)),
            blur_radius: px(24.),
            spread_radius: px(-4.),
            inset: false,
        },
        BoxShadow {
            color: hsla(0., 0., 0., if b.dark { 0.4 } else { 0.05 }),
            offset: point(px(0.), px(2.)),
            blur_radius: px(6.),
            spread_radius: px(0.),
            inset: false,
        },
    ]
}

// ---------- Fokus og hover ----------

/// Synlig fokusring (BRAND.md: 2 px granskov). Kun ved tastaturfokus.
pub fn focus_ring<E: InteractiveElement + Styled>(el: E, b: &Brand) -> E {
    let ring = b.primary;
    el.border_2()
        .border_color(transparent_black())
        .focus_visible(move |s| s.border_color(ring))
}

/// Baggrund ved hover på rækker og navigationspunkter.
pub fn hover_bg(b: &Brand) -> Hsla {
    if b.dark {
        hsla(0., 0., 1., 0.06)
    } else {
        hsla(0., 0., 0., 0.045)
    }
}

// ---------- Web's farver (Tailwind, præcise hex) ----------
//
// Opgavestatus og -prioritet i web (`src/app/dashboard/tasks/page.tsx`):
// tekst `*-600` på baggrund `*-100`. Web har ingen `dark:`-varianter på
// netop de mærker, så mørk tilstand bruger de samme par.

pub mod tw {
    pub const GRAY_100: u32 = 0xF3F4F6;
    pub const GRAY_500: u32 = 0x6B7280;
    pub const GRAY_600: u32 = 0x4B5563;
    pub const BLUE_100: u32 = 0xDBEAFE;
    pub const BLUE_600: u32 = 0x2563EB;
    pub const AMBER_100: u32 = 0xFEF3C7;
    pub const AMBER_600: u32 = 0xD97706;
    pub const GREEN_100: u32 = 0xDCFCE7;
    pub const GREEN_600: u32 = 0x16A34A;
    pub const ORANGE_100: u32 = 0xFFEDD5;
    pub const ORANGE_600: u32 = 0xEA580C;
    pub const RED_100: u32 = 0xFEE2E2;
    pub const RED_600: u32 = 0xDC2626;
}

/// Tekst- og baggrundsfarve for et mærke (`fg` på `bg`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pair {
    pub fg: u32,
    pub bg: u32,
}

/// Web's statusfarver: `backlog`, `todo`, `in_progress`, `done`.
pub fn web_task_status(status: &str) -> Pair {
    use tw::*;
    match status {
        "todo" => Pair {
            fg: BLUE_600,
            bg: BLUE_100,
        },
        "in_progress" => Pair {
            fg: AMBER_600,
            bg: AMBER_100,
        },
        "done" => Pair {
            fg: GREEN_600,
            bg: GREEN_100,
        },
        _ => Pair {
            fg: GRAY_600,
            bg: GRAY_100,
        },
    }
}

/// Web's prioritetsfarver: `low`, `medium`, `high`, `urgent`.
pub fn web_task_priority(priority: &str) -> Pair {
    use tw::*;
    match priority {
        "medium" => Pair {
            fg: BLUE_600,
            bg: BLUE_100,
        },
        "high" => Pair {
            fg: ORANGE_600,
            bg: ORANGE_100,
        },
        "urgent" => Pair {
            fg: RED_600,
            bg: RED_100,
        },
        _ => Pair {
            fg: GRAY_600,
            bg: GRAY_100,
        },
    }
}

/// Kundens farve fra web (`clients.color`, `#RRGGBB` eller null).
pub fn parse_hex(color: Option<&str>) -> Option<u32> {
    let s = color?.trim().strip_prefix('#')?;
    if s.len() != 6 {
        return None;
    }
    u32::from_str_radix(s, 16).ok()
}

#[cfg(test)]
mod tests {
    use super::{
        Pair, SPACE_1, SPACE_2, SPACE_3, SPACE_4, SPACE_5, SPACE_6, SPACE_8, SPACE_10, SPACE_12,
        parse_hex, resolve_reduce_motion, web_task_priority, web_task_status,
    };
    use crate::brand::contrast;

    #[test]
    fn mellemrum_foelger_4px_grid() {
        for s in [
            SPACE_1, SPACE_2, SPACE_3, SPACE_4, SPACE_5, SPACE_6, SPACE_8, SPACE_10, SPACE_12,
        ] {
            assert_eq!(s % 4., 0., "{s} er ikke på 4 px-grid");
        }
    }

    #[test]
    fn web_farver_er_praecise() {
        assert_eq!(
            web_task_status("in_progress"),
            Pair {
                fg: 0xD97706,
                bg: 0xFEF3C7
            }
        );
        assert_eq!(web_task_status("ukendt"), web_task_status("backlog"));
        assert_eq!(web_task_priority("urgent").fg, 0xDC2626);
        assert_eq!(web_task_priority("low"), web_task_status("backlog"));
    }

    /// Mærkerne er små; web's par skal mindst holde 3:1 (ikoner, WCAG
    /// 1.4.11). Undtagelse: amber-600 på amber-100 ("I gang") er web's valg
    /// og giver kun ca. 2,9:1, så mærket skal altid have ikon og tekst.
    #[test]
    fn web_maerker_kan_laeses() {
        for s in ["backlog", "todo", "done"] {
            let p = web_task_status(s);
            assert!(contrast(p.fg, p.bg) >= 3.0, "{s}");
        }
        let amber = web_task_status("in_progress");
        assert!(contrast(amber.fg, amber.bg) >= 2.5);
        for s in ["low", "medium", "high", "urgent"] {
            let p = web_task_priority(s);
            assert!(contrast(p.fg, p.bg) >= 3.0, "{s}");
        }
    }

    #[test]
    fn kundefarve_fra_web() {
        assert_eq!(parse_hex(Some("#1E5B47")), Some(0x1E5B47));
        assert_eq!(parse_hex(Some(" #ff0000 ")), Some(0xFF0000));
        assert_eq!(parse_hex(Some("1E5B47")), None);
        assert_eq!(parse_hex(Some("#12345")), None);
        assert_eq!(parse_hex(Some("#GGGGGG")), None);
        assert_eq!(parse_hex(None), None);
    }

    #[test]
    fn reducer_bevaegelse_kan_tvinges() {
        assert!(resolve_reduce_motion(Some("1"), || false));
        assert!(!resolve_reduce_motion(Some("0"), || true));
        assert!(resolve_reduce_motion(None, || true));
        assert!(!resolve_reduce_motion(Some("x"), || false));
    }
}
