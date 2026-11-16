//! `BusinessRules` oven på tt-core, som har paritetstests mod web. Det er
//! standarden for både `LocalRepo` og `CloudRepo`.
//!
//! tt-core regner i `f64` som web (JavaScript-tal) og runder til 2 decimaler
//! som web's `decimal(…, 2)`-kolonner. Her oversættes til og fra `Decimal`.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use tt_core::{afrunding, faktura, klippekort, tid};

use crate::error::DataError;
use crate::model::PrepaidPackage;
use crate::rules::{BusinessRules, Deduction, RoundingConfig, RoundingMethod};

#[derive(Debug, Clone, Copy, Default)]
pub struct CoreRules;

fn f(d: Decimal) -> f64 {
    d.to_f64().unwrap_or(0.0)
}

/// `f64` fra tt-core tilbage til `Decimal` med 2 decimaler (web's kolonner).
fn dec(x: f64) -> Decimal {
    Decimal::from_f64(x).unwrap_or_default().round_dp(2)
}

fn rounding_fields(c: RoundingConfig) -> afrunding::RoundingFields {
    afrunding::RoundingFields {
        rounding_enabled: c.enabled,
        rounding_minutes: c.minutes,
        rounding_method: c.method.map(|m| match m {
            RoundingMethod::Up => afrunding::RoundingMethod::Up,
            RoundingMethod::Down => afrunding::RoundingMethod::Down,
            RoundingMethod::Nearest => afrunding::RoundingMethod::Nearest,
        }),
    }
}

fn to_core(p: &PrepaidPackage) -> klippekort::Klippekort {
    klippekort::Klippekort {
        id: p.id.clone(),
        client_id: Some(p.client_id.clone()),
        name: p.name.clone(),
        total_hours: f(p.total_hours),
        used_hours: f(p.used_hours),
        remaining_hours: f(p.remaining_hours),
        overdraft_hours: p.overdraft_hours.map(f).unwrap_or(0.0),
        hourly_rate: f(p.hourly_rate),
        auto_deduct: p.auto_deduct,
        is_active: Some(p.is_active),
        is_archived: p.is_archived.unwrap_or(false),
        expiry_date: p.expiry_date,
        purchase_date: p.purchase_date,
        clip_size_minutes: p.clip_size_minutes,
        overdraft_policy: match p.overdraft_policy.as_deref() {
            Some("allow") => klippekort::OverdraftPolicy::Allow,
            Some("invoice") => klippekort::OverdraftPolicy::Invoice,
            _ => klippekort::OverdraftPolicy::Block,
        },
        overdraft_rate: p.overdraft_rate.map(f),
    }
}

impl CoreRules {
    /// Som [`BusinessRules::deduct`], men med et fast "nu" (tests).
    pub fn deduct_at(
        &self,
        package: &PrepaidPackage,
        hours: Decimal,
        now: DateTime<Utc>,
    ) -> Result<Deduction, DataError> {
        let request = klippekort::DeductRequest {
            hours: f(hours),
            for_time_entry: false,
            client_id: Some(package.client_id.clone()),
            allow_inactive: false,
        };
        let r = klippekort::deduct(&to_core(package), &request, now)
            .map_err(|e| DataError::Validation(e.to_string()))?;
        if r.overflowed_to_invoice {
            // Politik "invoice" uden saldo nok: kortet røres ikke, og hele
            // posten faktureres (evt. til overtræks-satsen), som i web.
            return Ok(Deduction {
                hours_from_package: Decimal::ZERO,
                overdraft_hours: Decimal::ZERO,
                overflow_to_invoice: hours,
            });
        }
        let total = dec(r.hours_deducted);
        let over = dec(r.overdrafted_hours);
        Ok(Deduction {
            hours_from_package: total - over,
            overdraft_hours: over,
            overflow_to_invoice: Decimal::ZERO,
        })
    }
}

impl BusinessRules for CoreRules {
    fn effective_rate(
        &self,
        project_rate: Option<Decimal>,
        client_rate: Option<Decimal>,
        global_rate: Option<Decimal>,
    ) -> Option<Decimal> {
        // Web's `getRateFromCache` springer kun tomme satser over; en sats på
        // 0 er en gyldig sats. Medlemssatser og planlagte prisskift findes
        // ikke i lokal tilstand.
        project_rate.or(client_rate).or(global_rate)
    }

    fn round_hours(
        &self,
        hours: Decimal,
        user: RoundingConfig,
        client: RoundingConfig,
        project: RoundingConfig,
    ) -> Decimal {
        let config = afrunding::resolve_rounding_config(
            &rounding_fields(user),
            &rounding_fields(client),
            &rounding_fields(project),
        );
        match config.filter(|c| c.enabled) {
            Some(c) => dec(afrunding::round_hours(f(hours), Some(&c))),
            None => hours,
        }
    }

    fn deduct(&self, package: &PrepaidPackage, hours: Decimal) -> Result<Deduction, DataError> {
        self.deduct_at(package, hours, Utc::now())
    }

    fn pick_auto_deduct_package<'a>(
        &self,
        packages: &'a [PrepaidPackage],
        client_id: &str,
        date: NaiveDate,
    ) -> Option<&'a PrepaidPackage> {
        let own: Vec<klippekort::Klippekort> = packages
            .iter()
            .filter(|p| p.client_id == client_id && !p.is_archived.unwrap_or(false))
            .map(to_core)
            .collect();
        // Dagens start i dansk tid: et kort gælder hele udløbsdagen.
        let now = tid::copenhagen_day_start(date);
        let picked = klippekort::pick_auto_deduct(&own, now)?;
        packages.iter().find(|p| p.id == picked.id)
    }

    fn vat(&self, net: Decimal) -> Decimal {
        let t = faktura::totals_from_subtotal(f(net), None, true);
        Decimal::new(t.vat_ore, 2)
    }

    fn next_invoice_number(&self, issued: &[String]) -> String {
        faktura::next_invoice_number(issued.iter().map(String::as_str))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn d(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    fn kort(remaining: &str, policy: Option<&str>) -> PrepaidPackage {
        PrepaidPackage {
            id: "k".into(),
            name: "Kort".into(),
            client_id: "c".into(),
            total_hours: d("10"),
            used_hours: d("10") - d(remaining),
            remaining_hours: d(remaining),
            hourly_rate: d("800"),
            is_active: true,
            auto_deduct: true,
            overdraft_policy: policy.map(Into::into),
            ..Default::default()
        }
    }

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 26, 12, 0, 0).unwrap()
    }

    #[test]
    fn block_afviser_med_webs_besked() {
        let e = CoreRules.deduct_at(&kort("2", None), d("3"), now()).unwrap_err();
        assert!(matches!(e, DataError::Validation(ref m) if m.contains("2")), "{e:?}");
    }

    #[test]
    fn allow_trækker_saldoen_og_fører_resten_som_overtræk() {
        let x = CoreRules.deduct_at(&kort("2", Some("allow")), d("3"), now()).unwrap();
        assert_eq!((x.hours_from_package, x.overdraft_hours), (d("2"), d("1")));
    }

    #[test]
    fn invoice_rører_ikke_kortet() {
        let x = CoreRules.deduct_at(&kort("2", Some("invoice")), d("3"), now()).unwrap();
        assert_eq!(x.hours_from_package, Decimal::ZERO);
        assert_eq!(x.overflow_to_invoice, d("3"));
    }

    #[test]
    fn klip_runder_op_til_hele_klip() {
        let mut k = kort("5", None);
        k.clip_size_minutes = Some(30);
        let x = CoreRules.deduct_at(&k, d("0.6"), now()).unwrap();
        assert_eq!(x.hours_from_package, d("1"));
    }

    #[test]
    fn udløbet_kort_afvises_og_vælges_ikke() {
        let mut k = kort("5", None);
        k.expiry_date = Some(Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap());
        assert!(CoreRules.deduct_at(&k, d("1"), now()).is_err());
        let date = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        assert!(CoreRules.pick_auto_deduct_package(&[k], "c", date).is_none());
    }

    #[test]
    fn kortet_gælder_hele_udløbsdagen() {
        let mut k = kort("5", None);
        // 26/10 dansk midnat gemt som UTC.
        k.expiry_date = Some(Utc.with_ymd_and_hms(2026, 10, 25, 23, 0, 0).unwrap());
        let date = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        assert_eq!(CoreRules.pick_auto_deduct_package(std::slice::from_ref(&k), "c", date).unwrap().id, "k");
    }

    #[test]
    fn fakturanummer_som_web() {
        assert_eq!(CoreRules.next_invoice_number(&[]), "INV-001");
        let issued = vec!["INV-009".to_string(), "UDKAST-123".into(), "2025-14".into()];
        assert_eq!(CoreRules.next_invoice_number(&issued), "INV-015");
    }

    #[test]
    fn afrunding_projekt_kunde_bruger() {
        let user = RoundingConfig { enabled: Some(true), minutes: Some(15), method: None };
        let off = RoundingConfig::default();
        assert_eq!(CoreRules.round_hours(d("1.1"), user, off, off), d("1.25"));
        let client_off = RoundingConfig { enabled: Some(false), ..off };
        assert_eq!(CoreRules.round_hours(d("1.1"), user, client_off, off), d("1.1"));
    }

    #[test]
    fn moms_25_procent_i_øre() {
        assert_eq!(CoreRules.vat(d("1000")), d("250"));
        assert_eq!(CoreRules.vat(d("10.05")), d("2.51"));
    }
}
