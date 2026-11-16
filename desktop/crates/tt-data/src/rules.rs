//! Forretningsregler, som `LocalRepo` kalder: klippekort-træk og overløb,
//! afrunding, timepris-hierarki, moms og fakturanumre.
//!
//! Standarden er [`crate::CoreRules`] oven på tt-core (paritet med web).
//! `DefaultRules` er en simpel reference, som kun nogle tests bruger.

use chrono::NaiveDate;
use rust_decimal::Decimal;

use crate::error::DataError;
use crate::model::PrepaidPackage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RoundingMethod {
    #[default]
    Up,
    Down,
    Nearest,
}

impl RoundingMethod {
    pub fn parse(s: &str) -> Self {
        match s {
            "down" => RoundingMethod::Down,
            "nearest" => RoundingMethod::Nearest,
            _ => RoundingMethod::Up,
        }
    }
}

/// Afrundingsindstilling på ét niveau (bruger, kunde eller projekt). `None`
/// = arv fra niveauet over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RoundingConfig {
    pub enabled: Option<bool>,
    pub minutes: Option<i32>,
    pub method: Option<RoundingMethod>,
}

/// Resultatet af et klippekort-træk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deduction {
    /// Timer trukket fra kortets saldo.
    pub hours_from_package: Decimal,
    /// Timer ud over saldoen, ført som overtræk (politik `allow`).
    pub overdraft_hours: Decimal,
    /// Timer ud over saldoen, der faktureres normalt (politik `invoice`).
    pub overflow_to_invoice: Decimal,
}

pub trait BusinessRules: Send + Sync {
    /// Timepris: projekt → kunde → global (indstillinger).
    fn effective_rate(
        &self,
        project_rate: Option<Decimal>,
        client_rate: Option<Decimal>,
        global_rate: Option<Decimal>,
    ) -> Option<Decimal>;

    /// Afrund timer efter hierarkiet projekt → kunde → bruger.
    fn round_hours(
        &self,
        hours: Decimal,
        user: RoundingConfig,
        client: RoundingConfig,
        project: RoundingConfig,
    ) -> Decimal;

    /// Træk `hours` fra kortet efter dets overtræks-politik.
    fn deduct(&self, package: &PrepaidPackage, hours: Decimal) -> Result<Deduction, DataError>;

    /// Kort, der automatisk skal trækkes fra for kunden på dagen (eller None).
    fn pick_auto_deduct_package<'a>(
        &self,
        packages: &'a [PrepaidPackage],
        client_id: &str,
        date: NaiveDate,
    ) -> Option<&'a PrepaidPackage>;

    /// Moms af et nettobeløb.
    fn vat(&self, net: Decimal) -> Decimal;

    /// Næste fakturanummer ud fra de udstedte.
    fn next_invoice_number(&self, issued: &[String]) -> String;
}

/// Simpel reference uden web's klip, udløb og nummerformat. Kun til tests.
#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultRules;

impl BusinessRules for DefaultRules {
    fn effective_rate(
        &self,
        project_rate: Option<Decimal>,
        client_rate: Option<Decimal>,
        global_rate: Option<Decimal>,
    ) -> Option<Decimal> {
        project_rate.or(client_rate).or(global_rate)
    }

    fn round_hours(
        &self,
        hours: Decimal,
        user: RoundingConfig,
        client: RoundingConfig,
        project: RoundingConfig,
    ) -> Decimal {
        let enabled = project.enabled.or(client.enabled).or(user.enabled).unwrap_or(false);
        let minutes = project.minutes.or(client.minutes).or(user.minutes).unwrap_or(0);
        if !enabled || minutes <= 0 {
            return hours;
        }
        let method = project.method.or(client.method).or(user.method).unwrap_or_default();
        let step = Decimal::from(minutes);
        let total_minutes = hours * Decimal::from(60);
        let units = total_minutes / step;
        let rounded = match method {
            RoundingMethod::Up => units.ceil(),
            RoundingMethod::Down => units.floor(),
            RoundingMethod::Nearest => units.round(),
        };
        (rounded * step / Decimal::from(60)).round_dp(2)
    }

    fn deduct(&self, package: &PrepaidPackage, hours: Decimal) -> Result<Deduction, DataError> {
        let remaining = package.remaining_hours.max(Decimal::ZERO);
        if hours <= remaining {
            return Ok(Deduction {
                hours_from_package: hours,
                overdraft_hours: Decimal::ZERO,
                overflow_to_invoice: Decimal::ZERO,
            });
        }
        let rest = hours - remaining;
        match package.overdraft_policy.as_deref().unwrap_or("block") {
            "allow" => Ok(Deduction {
                hours_from_package: remaining,
                overdraft_hours: rest,
                overflow_to_invoice: Decimal::ZERO,
            }),
            "invoice" => Ok(Deduction {
                hours_from_package: remaining,
                overdraft_hours: Decimal::ZERO,
                overflow_to_invoice: rest,
            }),
            _ => Err(DataError::Validation(format!(
                "Klippekortet \"{}\" har kun {} timer tilbage",
                package.name,
                remaining.normalize()
            ))),
        }
    }

    fn pick_auto_deduct_package<'a>(
        &self,
        packages: &'a [PrepaidPackage],
        client_id: &str,
        date: NaiveDate,
    ) -> Option<&'a PrepaidPackage> {
        let mut candidates: Vec<&PrepaidPackage> = packages
            .iter()
            .filter(|p| {
                p.client_id == client_id
                    && p.is_active
                    && !p.is_archived.unwrap_or(false)
                    && p.auto_deduct
                    && p.remaining_hours > Decimal::ZERO
                    && p.expiry_date.is_none_or(|e| e.date_naive() >= date)
            })
            .collect();
        // Udløber først først; uden udløb sidst; ældste køb som tie-break.
        candidates.sort_by_key(|p| {
            (p.expiry_date.is_none(), p.expiry_date, p.purchase_date)
        });
        candidates.into_iter().next()
    }

    fn vat(&self, net: Decimal) -> Decimal {
        (net * Decimal::new(25, 2)).round_dp(2)
    }

    fn next_invoice_number(&self, issued: &[String]) -> String {
        let max = issued.iter().filter_map(|n| n.trim().parse::<u64>().ok()).max().unwrap_or(0);
        (max + 1).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn d(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    #[test]
    fn rate_hierarchy() {
        let r = DefaultRules;
        assert_eq!(r.effective_rate(Some(d("900")), Some(d("800")), Some(d("700"))), Some(d("900")));
        assert_eq!(r.effective_rate(None, Some(d("800")), Some(d("700"))), Some(d("800")));
        assert_eq!(r.effective_rate(None, None, Some(d("700"))), Some(d("700")));
        assert_eq!(r.effective_rate(None, None, None), None);
    }

    #[test]
    fn rounding_follows_hierarchy() {
        let r = DefaultRules;
        let user = RoundingConfig { enabled: Some(true), minutes: Some(15), method: None };
        let off = RoundingConfig::default();
        assert_eq!(r.round_hours(d("1.1"), user, off, off), d("1.25"));
        let project_down =
            RoundingConfig { enabled: None, minutes: None, method: Some(RoundingMethod::Down) };
        assert_eq!(r.round_hours(d("1.1"), user, off, project_down), d("1"));
        let client_off = RoundingConfig { enabled: Some(false), ..off };
        assert_eq!(r.round_hours(d("1.1"), user, client_off, off), d("1.1"));
    }

    #[test]
    fn overdraft_policies() {
        let r = DefaultRules;
        let mut p = PrepaidPackage { name: "Kort".into(), remaining_hours: d("2"), ..Default::default() };
        assert!(r.deduct(&p, d("3")).is_err());
        assert_eq!(r.deduct(&p, d("1.5")).unwrap().hours_from_package, d("1.5"));
        p.overdraft_policy = Some("allow".into());
        assert_eq!(r.deduct(&p, d("3")).unwrap().overdraft_hours, d("1"));
        p.overdraft_policy = Some("invoice".into());
        let x = r.deduct(&p, d("3")).unwrap();
        assert_eq!((x.hours_from_package, x.overflow_to_invoice), (d("2"), d("1")));
    }

    #[test]
    fn auto_deduct_picks_expiring_first() {
        let r = DefaultRules;
        let mk = |id: &str, exp: Option<u32>, remaining: &str| PrepaidPackage {
            id: id.into(),
            client_id: "c".into(),
            remaining_hours: d(remaining),
            is_active: true,
            auto_deduct: true,
            expiry_date: exp.map(|day| Utc.with_ymd_and_hms(2026, 11, day, 0, 0, 0).unwrap()),
            ..Default::default()
        };
        let today = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        let pkgs = vec![mk("ingen-udløb", None, "5"), mk("snart", Some(2), "1"), mk("tom", Some(1), "0")];
        assert_eq!(r.pick_auto_deduct_package(&pkgs, "c", today).unwrap().id, "snart");
        assert!(r.pick_auto_deduct_package(&pkgs, "anden", today).is_none());
    }

    #[test]
    fn vat_and_numbers() {
        let r = DefaultRules;
        assert_eq!(r.vat(d("1000")), d("250"));
        assert_eq!(r.next_invoice_number(&[]), "1");
        assert_eq!(r.next_invoice_number(&["7".into(), "12".into(), "UDKAST".into()]), "13");
    }
}
