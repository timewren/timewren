//! Klippekortet som huller (fyldte, halve og tomme cirkler), som app,
//! kundeportal og udvidelse viser det.
//!
//! Web: `src/components/klippekort/huller-model.ts` (kopieret 1:1 til
//! `browser-extension/src/lib/klippekort-huller.ts`). Reglerne (BRAND.md):
//! 1 hul = 1 time op til 20 timer, derover 1 hul = 5 timer med en note;
//! brugte timer er fyldte huller, en rest under et helt hul et halvt; over 40
//! huller vises kortet som bjælke; saldoen formuleres som det, der er tilbage.

use serde::{Deserialize, Serialize};

use crate::format::format_timer;
use crate::js;

pub const HOURS_PER_HOLE_SMALL: f64 = 1.0;
pub const HOURS_PER_HOLE_LARGE: f64 = 5.0;
pub const SMALL_CARD_MAX_HOURS: f64 = 20.0;
/// Over 40 huller (kort på mere end 200 t) vises kortet som bjælke.
pub const MAX_HOLES: usize = 40;

/// Et huls tilstand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Hul {
    Brugt,
    Halv,
    Tom,
}

/// Visningsmodellen for et klippekort.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KlippekortModel {
    pub total_hours: f64,
    pub remaining_hours: f64,
    pub used_hours: f64,
    pub overdraft_hours: f64,
    pub hours_per_hole: f64,
    pub holes: Vec<Hul>,
    /// Kortet er for stort til huller og vises som bjælke.
    pub use_bar: bool,
    /// Andel brugt, 0-1.
    pub used_fraction: f64,
    /// "1 hul = 5 t" eller `None`.
    pub note: Option<String>,
    /// Tilgængelig tekst, fx "7 t tilbage af 20".
    pub label: String,
}

fn finite(n: f64) -> f64 {
    if n.is_finite() { n } else { 0.0 }
}

/// Afrund til 3 decimaler mod flydende-komma-støj (fx 20,000000001 t).
fn round3(n: f64) -> f64 {
    js::round(n * 1000.0) / 1000.0
}

/// `klippekortModel(totalHours, remainingHours)`.
pub fn klippekort_model(total_hours: f64, remaining_hours: f64) -> KlippekortModel {
    let total_hours = finite(total_hours).max(0.0);
    let raw_remaining = finite(remaining_hours);
    let remaining_hours = raw_remaining.max(0.0).min(total_hours);
    let overdraft_hours = if raw_remaining < 0.0 {
        -raw_remaining
    } else {
        0.0
    };
    let used_hours = total_hours - remaining_hours;

    let hours_per_hole = if total_hours > SMALL_CARD_MAX_HOURS {
        HOURS_PER_HOLE_LARGE
    } else {
        HOURS_PER_HOLE_SMALL
    };
    let hole_count = round3(total_hours / hours_per_hole).ceil() as usize;
    let used = round3(used_hours);

    let use_bar = hole_count > MAX_HOLES;
    let holes = if use_bar {
        Vec::new()
    } else {
        (0..hole_count)
            .map(|i| {
                let start = i as f64 * hours_per_hole;
                let end = ((i + 1) as f64 * hours_per_hole).min(total_hours);
                if used >= round3(end) {
                    Hul::Brugt
                } else if used > round3(start) {
                    Hul::Halv
                } else {
                    Hul::Tom
                }
            })
            .collect()
    };

    let mut label = format!(
        "{} t tilbage af {}",
        format_timer(remaining_hours),
        format_timer(total_hours)
    );
    if overdraft_hours > 0.0 {
        label.push_str(&format!(
            ", {} t overtrukket",
            format_timer(overdraft_hours)
        ));
    }

    KlippekortModel {
        total_hours,
        remaining_hours,
        used_hours,
        overdraft_hours,
        hours_per_hole,
        holes,
        use_bar,
        used_fraction: if total_hours > 0.0 {
            used_hours / total_hours
        } else {
            0.0
        },
        note: if hours_per_hole == HOURS_PER_HOLE_SMALL {
            None
        } else {
            Some(format!("1 hul = {hours_per_hole} t"))
        },
        label,
    }
}
