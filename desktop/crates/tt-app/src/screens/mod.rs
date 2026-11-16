//! Én fil pr. skærm. Hver skærm er en GPUI-view med samme konstruktør:
//!
//! ```ignore
//! pub struct XScreen { ctx: AppCtx, … }
//! impl XScreen {
//!     pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self
//! }
//! impl Render for XScreen { … }
//! ```
//!
//! Skærmen henter data med `ctx.fetch`/`ctx.mutate` (background executor) og
//! lytter på `ctx.hub` for at genindlæse, når en anden skærm eller web har
//! ændret noget. Brug `ui::page` som ramme og `ui::*` til indhold.

// Aktivitet: rå aktivitet som blokke (0.2.25).
pub mod aktivitet;
pub mod fakturaer;
pub mod hjem;
pub mod indstillinger;
pub mod kalender;
pub mod klippekort;
pub mod kunder;
// screens-b: login og onboarding (ikke i navigationen).
pub mod login;
pub mod onboarding;
pub mod opdatering;
pub mod opgaver;
pub mod projekter;
pub mod rapporter;

use gpui_kit::*;

use crate::app::AppCtx;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Screen {
    Hjem,
    Kalender,
    Aktivitet,
    Kunder,
    Projekter,
    Klippekort,
    Opgaver,
    Fakturaer,
    Rapporter,
    Indstillinger,
}

impl Screen {
    /// Rækkefølgen i navigationen. Cmd/Ctrl+1-9 følger den.
    pub const ALL: [Screen; 10] = [
        Screen::Hjem,
        Screen::Kalender,
        Screen::Aktivitet,
        Screen::Kunder,
        Screen::Projekter,
        Screen::Klippekort,
        Screen::Opgaver,
        Screen::Fakturaer,
        Screen::Rapporter,
        Screen::Indstillinger,
    ];

    /// Stabilt nøgleord til ids og `TT_SCREEN`.
    pub fn key(self) -> &'static str {
        match self {
            Screen::Hjem => "hjem",
            Screen::Kalender => "kalender",
            Screen::Aktivitet => "aktivitet",
            Screen::Kunder => "kunder",
            Screen::Projekter => "projekter",
            Screen::Klippekort => "klippekort",
            Screen::Opgaver => "opgaver",
            Screen::Fakturaer => "fakturaer",
            Screen::Rapporter => "rapporter",
            Screen::Indstillinger => "indstillinger",
        }
    }

    /// Navnet i navigationen.
    pub fn title(self) -> &'static str {
        match self {
            Screen::Hjem => crate::i18n::t("nav.screen.hjem"),
            Screen::Kalender => crate::i18n::t("nav.screen.kalender"),
            Screen::Aktivitet => crate::i18n::t("nav.screen.aktivitet"),
            Screen::Kunder => crate::i18n::t("nav.screen.kunder"),
            Screen::Projekter => crate::i18n::t("nav.screen.projekter"),
            Screen::Klippekort => crate::i18n::t("nav.screen.klippekort"),
            Screen::Opgaver => crate::i18n::t("nav.screen.opgaver"),
            Screen::Fakturaer => crate::i18n::t("nav.screen.fakturaer"),
            Screen::Rapporter => crate::i18n::t("nav.screen.rapporter"),
            Screen::Indstillinger => crate::i18n::t("nav.screen.indstillinger"),
        }
    }

    /// Ikonet i navigationen (lucide, `ui::icons`).
    pub fn icon(self) -> crate::ui::Icon {
        use crate::ui::Icon;
        match self {
            Screen::Hjem => Icon::Home,
            Screen::Kalender => Icon::Calendar,
            Screen::Aktivitet => Icon::Activity,
            Screen::Kunder => Icon::Users,
            Screen::Projekter => Icon::Folder,
            Screen::Klippekort => Icon::Ticket,
            Screen::Opgaver => Icon::ListTodo,
            Screen::Fakturaer => Icon::FileText,
            Screen::Rapporter => Icon::BarChart3,
            Screen::Indstillinger => Icon::Settings,
        }
    }

    pub fn from_key(key: &str) -> Option<Screen> {
        Screen::ALL.into_iter().find(|s| s.key() == key)
    }

    pub fn index(self) -> usize {
        Screen::ALL.iter().position(|s| *s == self).unwrap_or(0)
    }
}

/// Bygger skærmens view. Kaldes første gang skærmen vises; derefter genbruges den.
pub fn build(screen: Screen, ctx: &AppCtx, window: &mut Window, cx: &mut App) -> AnyView {
    let ctx = ctx.clone();
    match screen {
        Screen::Hjem => cx.new(|cx| hjem::HjemScreen::new(ctx, window, cx)).into(),
        Screen::Kalender => cx
            .new(|cx| kalender::KalenderScreen::new(ctx, window, cx))
            .into(),
        Screen::Aktivitet => cx
            .new(|cx| aktivitet::AktivitetScreen::new(ctx, window, cx))
            .into(),
        Screen::Kunder => cx
            .new(|cx| kunder::KunderScreen::new(ctx, window, cx))
            .into(),
        Screen::Projekter => cx
            .new(|cx| projekter::ProjekterScreen::new(ctx, window, cx))
            .into(),
        Screen::Klippekort => cx
            .new(|cx| klippekort::KlippekortScreen::new(ctx, window, cx))
            .into(),
        Screen::Opgaver => cx
            .new(|cx| opgaver::OpgaverScreen::new(ctx, window, cx))
            .into(),
        Screen::Fakturaer => cx
            .new(|cx| fakturaer::FakturaerScreen::new(ctx, window, cx))
            .into(),
        Screen::Rapporter => cx
            .new(|cx| rapporter::RapporterScreen::new(ctx, window, cx))
            .into(),
        Screen::Indstillinger => cx
            .new(|cx| indstillinger::IndstillingerScreen::new(ctx, window, cx))
            .into(),
    }
}

#[cfg(test)]
mod tests {
    use super::Screen;

    #[test]
    fn ti_skaerme_med_unikke_noegler() {
        let mut keys: Vec<_> = Screen::ALL.iter().map(|s| s.key()).collect();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), 10);
        for s in Screen::ALL {
            assert_eq!(Screen::from_key(s.key()), Some(s));
        }
        assert_eq!(Screen::Hjem.title(), "I dag");
    }
}
