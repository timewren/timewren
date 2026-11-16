//! Licens og adgang: hvad appen må, ud fra licensen (lokal) eller planen
//! (cloud), og hvad der sker offline og når en prøve udløber.
//!
//! Reglerne (spec D6 og web's `entitlements.get`):
//!
//! - **Lokal:** livstidslicens eller en gyldig prøve giver fuld adgang. Uden
//!   begge er appen låst for nye registreringer.
//! - **Cloud:** serveren håndhæver planen. Klienten gemmer det sidst kendte
//!   svar med tidsstempel. Er web utilgængelig, virker appen i
//!   [`OFFLINE_GRACE_DAYS`] dage fra sidste bekræftelse; derefter låses nye
//!   registreringer, indtil appen har talt med serveren igen.
//! - **Låsning er aldrig destruktiv.** Lokale data røres ikke, alt kan
//!   læses og eksporteres, og en timer, der kører, kan altid stoppes og
//!   gemmes. Låsningen sker kun på nye start/oprettelser, aldrig midt i en
//!   kørende timer.
//!
//! Alt her er rene funktioner af et ur og et input, så tidsgrænserne kan
//! testes med [`crate::ur::ManualClock`].

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tt_data::Entitlements;

use super::BackendError;
use crate::i18n::{t, tf};

/// Specen nævner ikke en offline-grænse; 14 dage er opgavens standard.
pub const OFFLINE_GRACE_DAYS: i64 = 14;

/// Hvorfor appen er låst for nye registreringer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LockReason {
    /// Prøveperioden (lokal eller web) er udløbet.
    TrialExpired,
    /// Lokal tilstand uden livstidslicens og uden prøve.
    NoLicense,
    /// Cloud: planen er ikke bekræftet i mere end [`OFFLINE_GRACE_DAYS`] dage.
    OfflineGraceExpired { last_verified: DateTime<Utc> },
    /// Cloud: planen er aldrig bekræftet på denne maskine, og web svarer ikke.
    NeverVerified,
    /// Brugerens plads i organisationen er låst (web's `memberLocked`).
    MemberLocked,
    /// Planen tillader ikke tidsregistrering (web's `features.timeTracking`).
    PlanDoesNotAllow,
}

impl LockReason {
    /// Besked til brugeren. Siger altid, at data er bevaret.
    pub fn message(&self) -> String {
        match self {
            LockReason::TrialExpired => t("d21.licens.trial_expired").to_owned(),
            LockReason::NoLicense => t("d21.licens.no_license").to_owned(),
            LockReason::OfflineGraceExpired { .. } => tf(
                "d21.licens.grace_expired",
                &[("days", &OFFLINE_GRACE_DAYS.to_string())],
            ),
            LockReason::NeverVerified => t("d21.licens.never_verified").to_owned(),
            LockReason::MemberLocked => t("d21.licens.member_locked").to_owned(),
            LockReason::PlanDoesNotAllow => t("d21.licens.plan_blocks").to_owned(),
        }
    }
}

/// Appens adgang lige nu.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Access {
    /// Alt virker.
    Full,
    /// Prøve i gang: alt virker, men der er `days_left` dage tilbage.
    Trial { days_left: u32 },
    /// Cloud uden forbindelse: virker på det sidst kendte svar.
    OfflineGrace {
        days_left: u32,
        last_verified: DateTime<Utc>,
    },
    /// Nye registreringer er låst. Læsning, eksport og stop af en kørende
    /// timer virker stadig.
    Locked(LockReason),
}

impl Access {
    pub fn is_locked(&self) -> bool {
        matches!(self, Access::Locked(_))
    }

    /// Kort dansk linje til et banner øverst i appen. `None` = intet at sige.
    pub fn banner(&self, timer_active: bool) -> Option<String> {
        match self {
            Access::Full => None,
            Access::Trial { days_left } if *days_left <= 3 => Some(match days_left {
                0 | 1 => t("d21.licens.trial_soon").to_owned(),
                n => tf("d21.licens.trial_days", &[("n", &n.to_string())]),
            }),
            Access::Trial { .. } => None,
            Access::OfflineGrace { days_left, .. } => Some(tf(
                "d21.licens.offline",
                &[("days", &days_left.to_string())],
            )),
            Access::Locked(reason) => {
                let mut msg = reason.message();
                if timer_active {
                    msg.push_str(t("d21.licens.timer_note"));
                }
                Some(msg)
            }
        }
    }

    /// Må handlingen udføres? Er den ikke, er svaret en dansk besked.
    ///
    /// `timer_active`: en timer kører eller er på pause. Så kan den ændres
    /// og stoppes, og posten, den giver, gemmes, selv om appen er låst.
    pub fn check(&self, action: Action, timer_active: bool) -> Result<(), BackendError> {
        let Access::Locked(reason) = self else {
            return Ok(());
        };
        match action {
            Action::Read | Action::Export | Action::EndTimer | Action::EditEntry => Ok(()),
            // Låsningen rammer aldrig en timer, der allerede er i gang.
            Action::Write if timer_active => Ok(()),
            Action::StartTimer | Action::Write => Err(BackendError::PlanLimit(reason.message())),
        }
    }
}

/// Det, brugeren forsøger. Kun nogle af dem låses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// Læsning, visning og rapporter.
    Read,
    /// PDF, CSV og anden eksport af registreret tid.
    Export,
    /// Stop (og gem), pause eller kassér en timer, der allerede findes.
    EndTimer,
    /// Start eller genoptag en timer.
    StartTimer,
    /// Opret eller ret kunder, projekter, poster, fakturaer, opgaver osv.
    Write,
    /// Ret (eller slet) en post, der allerede er registreret. Låsen gælder
    /// kun ny tid, så rettelser af eksisterende tid er altid tilladt.
    EditEntry,
}

// ---------------------------------------------------------------- lokal

/// Det, de lokale licensfiler siger (se `repo/files.rs`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalLicense {
    pub lifetime: bool,
    pub trial_started: Option<NaiveDate>,
    /// Seneste dato appen har set. Et ur, der stilles tilbage, forlænger
    /// ikke prøven.
    pub last_seen: Option<NaiveDate>,
}

/// Dage tilbage af en prøve på `trial_days` dage, der startede `started`.
pub fn trial_days_left(started: NaiveDate, today: NaiveDate, trial_days: i64) -> i64 {
    (trial_days - (today - started).num_days()).max(0)
}

pub fn local_access(l: &LocalLicense, today: NaiveDate, trial_days: i64) -> Access {
    if l.lifetime {
        return Access::Full;
    }
    let Some(started) = l.trial_started else {
        return Access::Locked(LockReason::NoLicense);
    };
    // Aldrig tidligere end det, vi har set: tilbagestillet ur giver ingen dage.
    let today = l.last_seen.map_or(today, |s| s.max(today));
    match trial_days_left(started, today, trial_days) {
        0 => Access::Locked(LockReason::TrialExpired),
        n => Access::Trial {
            days_left: n as u32,
        },
    }
}

// ---------------------------------------------------------------- cloud

/// Det sidst kendte svar fra `entitlements.get`, gemt med tidsstempel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementCache {
    pub entitlements: Entitlements,
    /// Hvornår serveren sidst bekræftede planen.
    pub fetched_at: DateTime<Utc>,
    /// Seneste tidspunkt appen har set. Et ur, der stilles tilbage, forlænger
    /// ikke offline-perioden.
    pub last_seen: DateTime<Utc>,
}

impl EntitlementCache {
    pub fn new(entitlements: Entitlements, now: DateTime<Utc>) -> Self {
        EntitlementCache {
            entitlements,
            fetched_at: now,
            last_seen: now,
        }
    }

    /// Husk, at appen har set `now`. Returnerer det tidspunkt, der skal
    /// regnes med (aldrig før det, vi har set).
    pub fn observe(&mut self, now: DateTime<Utc>) -> DateTime<Utc> {
        self.last_seen = self.last_seen.max(now);
        self.last_seen
    }
}

/// Adgang i cloud-tilstand.
///
/// `online`: det seneste forsøg på at hente planen lykkedes (og `cache` er
/// så netop opdateret). `cache` er det sidst kendte svar, hvis der er et.
pub fn cloud_access(cache: Option<&EntitlementCache>, online: bool, now: DateTime<Utc>) -> Access {
    let Some(cache) = cache else {
        return if online {
            Access::Full
        } else {
            Access::Locked(LockReason::NeverVerified)
        };
    };
    let now = now.max(cache.last_seen);

    // Planen først: den gælder, uanset om vi er online. En prøve, der udløb
    // mens vi var offline, er udløbet.
    if let Some(plan) = &cache.entitlements.plan {
        if plan.member_locked {
            return Access::Locked(LockReason::MemberLocked);
        }
        let ended = plan.trial_ends_at.is_some_and(|t| t < now);
        if plan.is_trial_expired || (plan.is_trial && ended) {
            return Access::Locked(LockReason::TrialExpired);
        }
        if !cache.entitlements.features.time_tracking {
            return Access::Locked(LockReason::PlanDoesNotAllow);
        }
    }

    if online {
        return Access::Full;
    }
    let age = now - cache.fetched_at;
    let grace = Duration::days(OFFLINE_GRACE_DAYS);
    if age > grace {
        return Access::Locked(LockReason::OfflineGraceExpired {
            last_verified: cache.fetched_at,
        });
    }
    let left = grace - age;
    Access::OfflineGrace {
        // Rund op, så "0 dage" aldrig vises, mens appen stadig virker.
        days_left: ((left.num_seconds() + 86_399) / 86_400) as u32,
        last_verified: cache.fetched_at,
    }
}

/// Frø planens cache fra tt-data's cachede `entitlements`-svar, når
/// `entitlements.json` mangler (fx efter en opdatering fra en version, der ikke
/// gemte den). `existing` har altid forrang. Seedet regnes fra det tidspunkt,
/// svaret blev hentet, ikke fra nu: en gammel cache giver ingen ny respit.
pub fn seed_cache(
    existing: Option<&EntitlementCache>,
    cached: Option<(Entitlements, DateTime<Utc>)>,
    now: DateTime<Utc>,
) -> Option<EntitlementCache> {
    if existing.is_some() {
        return None;
    }
    let (entitlements, fetched_at) = cached?;
    // Et tidsstempel fra fremtiden (ur, der var foran) giver ingen ekstra respit.
    let at = fetched_at.min(now);
    Some(EntitlementCache {
        entitlements,
        fetched_at: at,
        last_seen: at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ur::{Clock, ManualClock};
    use chrono::TimeZone;
    use tt_data::{Features, Plan};

    fn t0() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 26, 8, 0, 0).unwrap()
    }

    fn ent(plan: Plan) -> Entitlements {
        Entitlements {
            plan: Some(plan),
            features: Features::all(),
            ..Default::default()
        }
    }

    fn paid() -> Entitlements {
        ent(Plan {
            tier: Some("solo".into()),
            ..Default::default()
        })
    }

    #[test]
    fn opdatering_offline_med_cachet_plan_er_ikke_laast() {
        let now = t0() + Duration::days(2);
        let seed = seed_cache(None, Some((paid(), t0())), now).expect("seed");
        assert_eq!(seed.fetched_at, t0());
        assert_eq!(
            cloud_access(Some(&seed), false, now),
            Access::OfflineGrace {
                days_left: 12,
                last_verified: t0()
            }
        );
    }

    #[test]
    fn uden_kilde_er_cloud_stadig_never_verified() {
        assert!(seed_cache(None, None, t0()).is_none());
        assert_eq!(
            cloud_access(None, false, t0()),
            Access::Locked(LockReason::NeverVerified)
        );
    }

    #[test]
    fn cache_aeldre_end_respitten_giver_laast() {
        let now = t0() + Duration::days(20);
        let seed = seed_cache(None, Some((paid(), t0())), now).expect("seed");
        assert_eq!(
            cloud_access(Some(&seed), false, now),
            Access::Locked(LockReason::OfflineGraceExpired { last_verified: t0() })
        );
    }

    #[test]
    fn seed_overskriver_aldrig_en_eksisterende_cache() {
        let c = EntitlementCache::new(paid(), t0());
        let now = t0() + Duration::days(1);
        assert!(seed_cache(Some(&c), Some((paid(), now)), now).is_none());
    }

    #[test]
    fn seed_fra_fremtiden_klippes_til_nu() {
        // Cachen er stemplet af et ur, der var foran: ingen ekstra respit.
        let now = t0();
        let seed = seed_cache(None, Some((paid(), t0() + Duration::days(30))), now).unwrap();
        assert_eq!(seed.fetched_at, now);
        assert_eq!(seed.last_seen, now);
    }

    #[test]
    fn online_med_betalt_abonnement_er_fuld_adgang() {
        let c = EntitlementCache::new(paid(), t0());
        assert_eq!(cloud_access(Some(&c), true, t0()), Access::Full);
    }

    #[test]
    fn offline_virker_i_14_dage_og_tæller_ned() {
        let clock = ManualClock::new(t0());
        let c = EntitlementCache::new(paid(), clock.now());

        clock.advance(Duration::days(1));
        assert_eq!(
            cloud_access(Some(&c), false, clock.now()),
            Access::OfflineGrace {
                days_left: 13,
                last_verified: t0()
            }
        );

        // Præcis 14 dage er stadig inde i respiten, med en dag tilbage på tælleren.
        clock.set(t0() + Duration::days(14));
        assert_eq!(
            cloud_access(Some(&c), false, clock.now()),
            Access::OfflineGrace {
                days_left: 0,
                last_verified: t0()
            }
        );

        clock.set(t0() + Duration::days(14) + Duration::seconds(1));
        assert_eq!(
            cloud_access(Some(&c), false, clock.now()),
            Access::Locked(LockReason::OfflineGraceExpired {
                last_verified: t0()
            })
        );
    }

    #[test]
    fn online_igen_efter_udløbet_respit_låser_op() {
        let c = EntitlementCache::new(paid(), t0());
        let later = t0() + Duration::days(30);
        assert!(cloud_access(Some(&c), false, later).is_locked());
        // Serveren svarer igen: nyt svar, nyt tidsstempel.
        let c = EntitlementCache::new(paid(), later);
        assert_eq!(cloud_access(Some(&c), true, later), Access::Full);
    }

    #[test]
    fn tilbagestillet_ur_forlænger_ikke_offline_perioden() {
        let mut c = EntitlementCache::new(paid(), t0());
        c.observe(t0() + Duration::days(20));
        // Brugeren stiller uret tilbage til dag 1.
        let rolled_back = t0() + Duration::days(1);
        assert!(cloud_access(Some(&c), false, rolled_back).is_locked());
    }

    #[test]
    fn udløbet_web_prøve_låser_også_online() {
        let c = EntitlementCache::new(
            ent(Plan {
                is_trial: true,
                is_trial_expired: true,
                ..Default::default()
            }),
            t0(),
        );
        assert_eq!(
            cloud_access(Some(&c), true, t0()),
            Access::Locked(LockReason::TrialExpired)
        );
    }

    #[test]
    fn prøve_der_udløber_mens_appen_er_offline_er_udløbet() {
        let c = EntitlementCache::new(
            ent(Plan {
                is_trial: true,
                trial_ends_at: Some(t0() + Duration::days(3)),
                ..Default::default()
            }),
            t0(),
        );
        assert!(!cloud_access(Some(&c), false, t0() + Duration::days(2)).is_locked());
        assert_eq!(
            cloud_access(Some(&c), false, t0() + Duration::days(4)),
            Access::Locked(LockReason::TrialExpired)
        );
    }

    #[test]
    fn låst_medlem_og_plan_uden_tidsregistrering() {
        let locked = EntitlementCache::new(
            ent(Plan {
                member_locked: true,
                ..Default::default()
            }),
            t0(),
        );
        assert_eq!(
            cloud_access(Some(&locked), true, t0()),
            Access::Locked(LockReason::MemberLocked)
        );
        let mut no_time = paid();
        no_time.features.time_tracking = false;
        assert_eq!(
            cloud_access(Some(&EntitlementCache::new(no_time, t0())), true, t0()),
            Access::Locked(LockReason::PlanDoesNotAllow)
        );
    }

    #[test]
    fn aldrig_bekræftet_og_offline_er_låst_men_online_uden_cache_er_fuld() {
        assert_eq!(
            cloud_access(None, false, t0()),
            Access::Locked(LockReason::NeverVerified)
        );
        assert_eq!(cloud_access(None, true, t0()), Access::Full);
    }

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn lokal_licens_prøve_og_udløb() {
        let lifetime = LocalLicense {
            lifetime: true,
            ..Default::default()
        };
        assert_eq!(local_access(&lifetime, d(2030, 1, 1), 14), Access::Full);

        assert_eq!(
            local_access(&LocalLicense::default(), d(2026, 10, 26), 14),
            Access::Locked(LockReason::NoLicense)
        );

        let trial = LocalLicense {
            trial_started: Some(d(2026, 10, 1)),
            ..Default::default()
        };
        assert_eq!(
            local_access(&trial, d(2026, 10, 1), 14),
            Access::Trial { days_left: 14 }
        );
        assert_eq!(
            local_access(&trial, d(2026, 10, 14), 14),
            Access::Trial { days_left: 1 }
        );
        assert_eq!(
            local_access(&trial, d(2026, 10, 15), 14),
            Access::Locked(LockReason::TrialExpired)
        );
    }

    #[test]
    fn tilbagestillet_ur_forlænger_ikke_lokal_prøve() {
        let trial = LocalLicense {
            trial_started: Some(d(2026, 10, 1)),
            last_seen: Some(d(2026, 10, 20)),
            ..Default::default()
        };
        assert_eq!(
            local_access(&trial, d(2026, 10, 2), 14),
            Access::Locked(LockReason::TrialExpired)
        );
    }

    #[test]
    fn låsning_rammer_aldrig_læsning_eksport_eller_en_kørende_timer() {
        let locked = Access::Locked(LockReason::TrialExpired);
        for a in [Action::Read, Action::Export, Action::EndTimer, Action::EditEntry] {
            assert!(locked.check(a, false).is_ok(), "{a:?}");
            assert!(locked.check(a, true).is_ok(), "{a:?}");
        }
        assert!(matches!(
            locked.check(Action::StartTimer, false),
            Err(BackendError::PlanLimit(_))
        ));
        assert!(matches!(
            locked.check(Action::Write, false),
            Err(BackendError::PlanLimit(_))
        ));
        // Midt i en kørende timer: den kan ændres, og dens post kan gemmes.
        assert!(locked.check(Action::Write, true).is_ok());
        // ... men en ny timer kan ikke startes ovenpå.
        assert!(locked.check(Action::StartTimer, true).is_err());
        assert!(Access::Full.check(Action::StartTimer, false).is_ok());
    }

    #[test]
    fn beskeden_siger_at_data_er_bevaret() {
        for r in [
            LockReason::TrialExpired,
            LockReason::NoLicense,
            LockReason::OfflineGraceExpired {
                last_verified: t0(),
            },
            LockReason::NeverVerified,
            LockReason::MemberLocked,
            LockReason::PlanDoesNotAllow,
        ] {
            assert!(r.message().contains("bevaret"), "{r:?}");
        }
    }

    #[test]
    fn banner_nævner_kørende_timer_når_låst() {
        let locked = Access::Locked(LockReason::TrialExpired);
        assert!(locked.banner(true).unwrap().contains("kørende timer"));
        assert!(!locked.banner(false).unwrap().contains("kørende timer"));
        assert!(Access::Full.banner(false).is_none());
        assert!(Access::Trial { days_left: 10 }.banner(false).is_none());
        assert!(Access::Trial { days_left: 2 }.banner(false).is_some());
    }
}
