//! Tid og satser som dansk tekst efter BRAND.md (Tal, priser og tid):
//! mellemrum før enheden, komma som decimaltegn, højst to decimaler uden
//! nuller til sidst ("7,5 t", "1,25 t", "8 t"), under en time i minutter
//! ("45 min"), og "kr." med punktum ("850 kr./t").
//!
//! Web: `browser-extension/src/lib/format-hours.ts` og `formatTimer` i
//! `src/components/klippekort/huller-model.ts`.

use crate::js;

/// Timer med danske decimaler: "7,5", "2,25", "20" (`formatTimer`).
pub fn format_timer(hours: f64) -> String {
    js::format_da(hours, 0, 2)
}

/// Kort varighed: "7,5 t", "45 min", "0 t" for nul og ugyldige tal
/// (`formatHoursShort`).
pub fn format_hours_short(hours: f64) -> String {
    if !hours.is_finite() || hours <= 0.0 {
        return "0 t".into();
    }
    if hours < 1.0 {
        return format!("{} min", js::round(hours * 60.0));
    }
    format!("{} t", js::format_da(hours, 0, 2))
}

/// Timepris: "850 kr./t", "1.250 kr./t", "712,5 kr./t" (`formatHourlyRate`).
pub fn format_hourly_rate(rate: f64) -> String {
    format!("{} kr./t", js::format_da(rate, 0, 2))
}
