//! Opstart: vælg datalag og detektion.
//!
//! - `TT_DEMO` sat (fx `TT_DEMO=1`, `TT_DEMO=timer`, `TT_DEMO=palet`):
//!   `MockBackend` med demodata, ingen onboarding, intet skrives på disken.
//!   `TT_DEMO_LANG=de` (sv, nb, en) viser demoen på et andet sprog.
//! - Ellers: de rigtige data (`real`).

use std::sync::Arc;

use crate::backend::Backend as _;
use crate::backend::repo::RepoBackend;
use crate::backend::services::{Detection, data_dir};
use crate::backend::{self, MockBackend};
use crate::engine::Engine;
use crate::migrate;
use crate::root::Startup;

pub fn build() -> Startup {
    if std::env::var_os("TT_DEMO").is_some() {
        demo()
    } else {
        real()
    }
}

pub fn demo() -> Startup {
    let backend = Arc::new(MockBackend::demo());
    // TT_DEMO=afviste: tre registreringer, web har afvist (dead-letter).
    if std::env::var("TT_DEMO").is_ok_and(|d| d.contains("afviste")) {
        backend.set_rejected(backend::MockRejected::demo(backend.today()));
    }
    // TT_DEMO=opg-kolonner…: tavlen med egne kolonner fra web.
    if std::env::var("TT_DEMO").is_ok_and(|d| d.contains("kolonner")) {
        backend.demo_custom_lanes();
    }
    if let Ok(lang) = std::env::var("TT_DEMO_LANG") {
        crate::i18n::set(backend::Language::from_locale(Some(&lang)));
    }
    // TT_DEMO=timer: en timer, der har kørt 1:23:07 (til skærmbilleder).
    if std::env::var("TT_DEMO").is_ok_and(|d| d.contains("timer")) {
        backend.demo_timer(
            backend::TimerTarget {
                customer_id: Some("kunde_bageriet".into()),
                project_id: Some("proj_webshop".into()),
                task_id: None,
                description: "Produktsider og kurv".into(),
            },
            3600 + 23 * 60 + 7,
        );
    }
    // kalender: møder og målvælger virker også i demoen (intet gemmes).
    crate::kalenderkilder::install_global(Arc::new(crate::kalenderkilder::Kalender::new(
        None,
        Box::new(|_| vec![]),
    )));
    // TT_DEMO=lokal: demoen i lokal tilstand (fakturaopsætning, backup).
    if std::env::var("TT_DEMO").is_ok_and(|d| d.contains("lokal")) {
        backend.set_local(true);
    }
    Startup {
        backend,
        changes: vec![],
        notices: None,
        onboarded_marker: None,
        idle: None,
        migration_notice: None,
        on_quit: None,
    }
}

/// Første start af den nye app (0.2.23): hent indstillinger og lokale data fra 0.2.x
/// (`migrate`). Med `TT_DATA_DIR` (tests og skærmbilleder) kun, hvis
/// `TT_OLD_DATA_DIR` også er sat, så rigtige data aldrig havner i en testmappe.
fn migrate_from_0_2(dir: &std::path::Path) -> Option<migrate::MigrationReport> {
    // TimeWren har aldrig haft en 0.2.x-app: dens datamappe må ikke fyldes med TimeTracks data.
    // App Store-udgaven kan ikke se 0.2.x' mappe uden for sandkassen.
    if !crate::mas::LEGACY_APP {
        return None;
    }
    if std::env::var_os("TT_DATA_DIR").is_some() && std::env::var_os("TT_OLD_DATA_DIR").is_none() {
        return None;
    }
    let old = migrate::old_data_dir()?;
    let device = device(dir)?;
    let report = migrate::run_once(&old, dir, device.clone());
    if let Some(e) = &report.error {
        eprintln!("TT migrering fra 0.2: {e}");
    } else {
        // Læringen (bindinger, regler, mønstre, aktivitet) for alle, også dem,
        // der allerede er migreret. Før motoren åbner sine filer, og først
        // når importen ovenfor er lykkedes (den bruger dens id'er lokalt).
        let laering = migrate::laering::run_once(&old, dir, device);
        if let Some(e) = &laering.error {
            eprintln!("TT migrering af læring fra 0.2: {e}");
        }
    }
    Some(report)
}

/// Beskeden om overgangen fra 0.2 på brugerens sprog. Sproget kan lige være
/// flyttet med fra 0.2, så det sættes først. Beskeden hører til første
/// start; bagefter er onboarding gennemført.
fn migration_notice(
    report: Option<migrate::MigrationReport>,
    language: Option<backend::Language>,
) -> Option<String> {
    if let Some(lang) = language {
        crate::i18n::set(lang);
    }
    report?.notice()
}

fn device(dir: &std::path::Path) -> Option<tt_data::DeviceInfo> {
    Some(tt_data::DeviceInfo {
        device_id: tt_data::DeviceInfo::load_or_create_id(&dir.join("device-id")).ok()?,
        device_name: crate::backend::repo::device_name(),
        os: std::env::consts::OS.to_owned(),
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
    })
}

/// De rigtige data i `data_dir()`:detektion (tracker, matcher, AI) og
/// datalaget (lokal SQLite eller cloud). Miljø til tests og skærmbilleder:
/// `TT_DATA_DIR` (datamappe), `TT_NO_TRACKER` (ingen OS-sporing),
/// `TT_SKIP_ONBOARDING` (gå direkte til appen), `TT_MEMORY_SECRETS`
/// (login-token i hukommelsen i stedet for nøgleringen).
pub fn real() -> Startup {
    let dir = data_dir();
    let migration = migrate_from_0_2(&dir);
    let engine = if std::env::var_os("TT_NO_TRACKER").is_some() {
        Engine::new(dir.join("detektion"), None)
    } else {
        Engine::native(dir.join("detektion"))
    };
    for w in engine.warnings() {
        eprintln!("TT detektion: {w}");
    }
    let engine = Arc::new(engine);
    let on_quit: Arc<dyn Fn() + Send + Sync> = {
        let engine = engine.clone();
        Arc::new(move || engine.stop_tracking())
    };
    let detection_changes = engine.changes();
    // kalender: kalenderforslag oven på detektionen, og møder ud fra
    // trackerens forgrundsvindue.
    let kalender = Arc::new(crate::kalenderkilder::Kalender::native(dir.join("kalender")));
    {
        let engine = engine.clone();
        kalender.set_foreground(Box::new(move || {
            crate::moeder::Foreground::from_segment(engine.current_segment().as_ref())
        }));
    }
    crate::kalenderkilder::install_global(kalender.clone());
    // macOS: notifikationernes delegat sættes før appen er startet, så et
    // klik, der starter appen, ikke tabes (svarene venter i en kanal).
    #[cfg(target_os = "macos")]
    crate::notify_mac::install();
    let detection = Arc::new(crate::kalenderkilder::CalendarDetection::new(engine, kalender));
    let repo = match RepoBackend::open(dir.clone(), detection) {
        Ok(r) => r,
        Err(e) => {
            // Uden datalag kan appen ikke vise noget rigtigt. Vis hellere
            // fejlen end tomme skærme eller demodata.
            eprintln!("TT kan ikke åbne data i {}: {e}", dir.display());
            std::process::exit(1);
        }
    };
    // Sproget: det gemte, ellers systemets (første start, se Settings::first_start).
    let migration_notice = migration_notice(migration, repo.settings().ok().map(|s| s.language));
    // gendan: "Start sporing ved opstart".
    if let Err(e) = crate::autostart::apply_start_on_launch(&repo) {
        eprintln!("TT sporingen kunne ikke slås til ved opstart: {e}");
    }
    let mut changes = vec![repo.changes()];
    changes.extend(detection_changes);
    let notices = Some(repo.notices());
    let idle = repo.idle_returns();
    let onboarded_marker = if std::env::var_os("TT_SKIP_ONBOARDING").is_some() {
        None
    } else {
        Some(dir.join("onboarded"))
    };
    Startup {
        backend: Arc::new(repo),
        changes,
        notices,
        onboarded_marker,
        idle,
        migration_notice,
        on_quit: Some(on_quit),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beskeden_om_0_2_bruger_det_flyttede_sprog() {
        // Set på en rigtig Mac: 0.2 kørte på engelsk, onboardingen var på
        // engelsk, men beskeden om de flyttede data stod på dansk, fordi den
        // blev lavet, før sproget fra 0.2 var sat.
        crate::i18n::set(backend::Language::Da);
        let report = migrate::MigrationReport {
            found: true,
            customers: 2,
            ..Default::default()
        };
        let en = migration_notice(Some(report.clone()), Some(backend::Language::En)).unwrap();
        crate::i18n::set(backend::Language::Da);
        assert!(en.contains("We moved 2 clients"), "{en}");
        assert_eq!(migration_notice(None, Some(backend::Language::Da)), None);
    }
}
