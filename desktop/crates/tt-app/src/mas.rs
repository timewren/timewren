//! Mac App Store-udgaven (cargo-featuren `mas`, kombinerbar med
//! `brand-timewren`). Ét sted, der afgør, hvad den lettere udgave kan:
//!
//! - **Ingen updater.** App Store opdaterer appen; `updater` kalder aldrig
//!   kanalen, og opdateringspanelet findes ikke.
//! - **Ingen sporing** af programmer, vinduer og browserfaner. Det kræver
//!   Tilgængelighed, Apple Events og andre programmers vinduer, som App Sandbox
//!   ikke tillader (tt-tracker bygges med sin `mas`-feature uden sonderne).
//!   Onboarding spørger ikke om tilladelserne.
//! - **Ingen afløsning og migrering** af den gamle 0.2.x-app: dens filer og
//!   LaunchAgent ligger uden for sandkassen.
//! - **Ingen modelsøgning** i andre programmers mapper og ingen "Start Ollama"
//!   (en anden apps program kan ikke startes fra sandkassen). Den indbyggede
//!   model hentes ind i appens egen datamappe og virker som i den fulde udgave.
//! - **Autostart** via `SMAppService` i stedet for en LaunchAgent-fil
//!   (`autostart.rs`).
//! - **Licens som in-app-køb.** Gratis til personlig brug (lokal tilstand
//!   låses aldrig), erhvervslicensen købes og gendannes med StoreKit
//!   (`store.rs`). Ingen licensnøgle, prøve eller køb uden for appen.
//!
//! Skærmene viser i stedet en kort forklaring og et link til den fulde udgave
//! ([`full_version_url`]). Teksterne står i `locales/*/mas.json`.
//!
//! Alle filer (data, logs, modeller, cache) ligger under `HOME`, som i
//! sandkassen er appens container (`~/Library/Containers/<bundle-id>/Data`).
//! Se `docs/v1/MAC-APP-STORE.md`.

use gpui_kit::component::{Sizable as _, h_flex};
use gpui_kit::*;

use crate::brand::Brand;
use crate::i18n::t;
use crate::ui::{self, Icon};

/// Er dette App Store-udgaven?
pub const ENABLED: bool = cfg!(feature = "mas");

/// Den indbyggede updater (kanal, download, installation og panelet).
pub const UPDATER: bool = !ENABLED;

/// Søgning efter modeller, som andre programmer har hentet, og "Start Ollama".
pub const OTHER_APPS_MODELS: bool = !ENABLED;

/// Afløsning af og import fra den gamle 0.2.x-app (kun TimeTrack, ikke i App Store-udgaven).
pub const LEGACY_APP: bool = !ENABLED && tt_core::edition::EDITION.has_legacy_tauri_app;

/// Nøglerne i `locales/*/mas.json` (testen `i18n::tests::mas_noeglerne_findes_paa_alle_sprog`).
pub const KEYS: [&str; 37] = [
    "mas.link",
    "mas.hjem.forslag.ingen",
    "mas.sporing.titel",
    "mas.sporing.tekst",
    "mas.sporing.kort",
    "mas.opdateringer.titel",
    "mas.opdateringer.tekst",
    "mas.onboarding.titel",
    "mas.onboarding.videre",
    "mas.onboarding.trin",
    "mas.ai.ollama",
    // Erhvervslicensen som in-app-køb (`store.rs`).
    "mas.licens.titel",
    "mas.licens.personlig",
    "mas.licens.personlig_tekst",
    "mas.licens.maerke_personlig",
    "mas.licens.erhverv",
    "mas.licens.erhverv_tekst",
    "mas.licens.tjekker",
    "mas.licens.koeb",
    "mas.licens.koeb_henter",
    "mas.licens.gendan",
    "mas.licens.proev_igen",
    "mas.licens.ingen_produkt",
    "mas.licens.koeber",
    "mas.licens.gendanner",
    "mas.licens.venter",
    "mas.licens.afbrudt",
    "mas.licens.fejl",
    "mas.licens.fejl_detalje",
    "mas.licens.ikke_bekraeftet",
    "mas.licens.koebt",
    "mas.licens.gendannet",
    "mas.licens.intet_at_gendanne",
    "mas.licens.gendan_fejl",
    "mas.licens.gendan_fejl_detalje",
    "mas.licens.valg",
    "mas.licens.fortsaet",
];

/// Download-siden med den fulde udgave: `https://timetrack.dk/download` eller
/// `https://timewren.com/download`.
pub fn full_version_url() -> String {
    full_version_url_for(&tt_core::edition::EDITION)
}

pub fn full_version_url_for(e: &tt_core::edition::Edition) -> String {
    format!("{}/download", e.web_url.trim_end_matches('/'))
}

/// Kortet, der står i stedet for sporingens skærme og indstillinger: hvad
/// denne udgave ikke kan, og et link til den fulde udgave. `id` er kortets
/// id; overskrift, tekst og knap får `<id>-titel`, `<id>-tekst` og `<id>-link`.
pub fn notice(b: &Brand, id: &'static str, title: &'static str, body: &'static str) -> ui::El {
    ui::card(b, id, title)
        .child(ui::heading(b, SharedString::from(format!("{id}-titel")), title, 2))
        .child(ui::muted(b, SharedString::from(format!("{id}-tekst")), body))
        .child(
            h_flex().child(ui::a11y_button(
                format!("{id}-link"),
                t("mas.link"),
                false,
                |btn| btn.icon(Icon::ExternalLink).outline().small(),
                |_, _, cx| cx.open_url(&full_version_url()),
            )),
        )
}

/// Sporingens kort ([`notice`] med standardteksterne).
pub fn tracking_notice(b: &Brand, id: &'static str) -> ui::El {
    notice(b, id, t("mas.sporing.titel"), t("mas.sporing.tekst"))
}

#[cfg(test)]
mod tests {
    use super::{ENABLED, LEGACY_APP, OTHER_APPS_MODELS, UPDATER, full_version_url_for};
    use tt_core::edition::{TIMETRACK, TIMEWREN};

    #[test]
    fn download_siderne() {
        assert_eq!(full_version_url_for(&TIMETRACK), "https://timetrack.dk/download");
        assert_eq!(full_version_url_for(&TIMEWREN), "https://timewren.com/download");
    }

    /// Feature-gaten: i App Store-udgaven er updater, modelsøgning og
    /// afløsning slået fra; uden featuren er de som før. Sporingen følger
    /// `ENABLED` (motoren og tt-tracker's feature `mas`).
    #[test]
    fn gaten_foelger_featuren() {
        let mas = cfg!(feature = "mas");
        assert_eq!(ENABLED, mas);
        assert_eq!(UPDATER, !mas);
        assert_eq!(OTHER_APPS_MODELS, !mas);
        if mas {
            assert_eq!([LEGACY_APP], [false]);
        } else {
            assert_eq!(LEGACY_APP, tt_core::edition::EDITION.has_legacy_tauri_app);
        }
    }
}
