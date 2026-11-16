//! Afrunding af registreret tid til et interval (5, 10, 15, 30 eller 60
//! minutter) op, ned eller til nærmeste.
//!
//! Web: `src/lib/utils/rounding.ts`. Indstillingen findes på projekt, kunde og
//! bruger; projektet vinder over kunden, kunden over brugeren.

use serde::{Deserialize, Serialize};

/// Afrundingens retning. Ukendte værdier fra databasen afrunder ikke (web
/// caster strengen og falder igennem til "uændret").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoundingMethod {
    Up,
    Nearest,
    Down,
    #[serde(other)]
    Unknown,
}

impl RoundingMethod {
    /// Læs kolonnen `rounding_method`.
    pub fn parse(value: &str) -> Self {
        match value {
            "up" => Self::Up,
            "nearest" => Self::Nearest,
            "down" => Self::Down,
            _ => Self::Unknown,
        }
    }
}

/// Den gældende afrunding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoundingConfig {
    pub enabled: bool,
    pub minutes: i32,
    pub method: RoundingMethod,
}

/// Afrundingsfelterne på projekt, kunde eller bruger (`roundingEnabled`,
/// `roundingMinutes`, `roundingMethod`); `None` = ikke sat på dette niveau.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RoundingFields {
    pub rounding_enabled: Option<bool>,
    pub rounding_minutes: Option<i32>,
    pub rounding_method: Option<RoundingMethod>,
}

fn level(fields: &RoundingFields) -> Option<RoundingConfig> {
    fields.rounding_enabled.map(|enabled| RoundingConfig {
        enabled,
        minutes: fields.rounding_minutes.unwrap_or(15),
        method: fields.rounding_method.unwrap_or(RoundingMethod::Up),
    })
}

/// Projekt → kunde → bruger: det første niveau med `rounding_enabled` sat
/// vinder, også når det er `false` (`resolveRoundingConfig`). Manglende
/// interval er 15 minutter, manglende retning "op".
pub fn resolve_rounding_config(
    user: &RoundingFields,
    client: &RoundingFields,
    project: &RoundingFields,
) -> Option<RoundingConfig> {
    level(project)
        .or_else(|| level(client))
        .or_else(|| level(user))
}

/// Rund timer efter konfigurationen; uændret uden eller med slået-fra
/// afrunding (`roundHours`). Op-afrunding giver aldrig 0 for positiv tid.
pub fn round_hours(hours: f64, config: Option<&RoundingConfig>) -> f64 {
    let Some(config) = config.filter(|c| c.enabled) else {
        return hours;
    };
    let total_minutes = hours * 60.0;
    let interval = f64::from(config.minutes);
    match config.method {
        RoundingMethod::Up => ((total_minutes / interval).ceil() * interval) / 60.0,
        RoundingMethod::Down => ((total_minutes / interval).floor() * interval) / 60.0,
        RoundingMethod::Nearest => (crate::js::round(total_minutes / interval) * interval) / 60.0,
        RoundingMethod::Unknown => hours,
    }
}
