//! Sidemenuen: fuld bredde eller smal ikonrail.
//!
//! Brugerens valg (knappen og ⌘\ / Ctrl+\) gemmes i `ui-state.json` i
//! datamappen. Under `NAV_AUTO_COLLAPSE_BELOW` klapper menuen selv sammen;
//! her kan den foldes ud midlertidigt uden at ændre det gemte valg, og når
//! vinduet bliver bredt igen, gælder valget igen.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::ui::tokens::{NAV_AUTO_COLLAPSE_BELOW, NAV_RAIL_WIDTH, NAV_WIDTH};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Stored {
    #[serde(default)]
    nav_collapsed: bool,
}

#[derive(Clone, Debug)]
pub struct NavState {
    /// Det gemte valg (gælder i brede vinduer).
    pub pref_collapsed: bool,
    /// Foldet ud midlertidigt i et smalt vindue.
    narrow_expanded: bool,
    /// Hvor valget gemmes. `None` med demodata og i tests.
    path: Option<PathBuf>,
}

impl NavState {
    /// Læs det gemte valg. `TT_NAV=smal|bred` tvinger (skærmbilleder), og
    /// med demodata (`TT_DEMO`) og i tests gemmes intet.
    pub fn load() -> Self {
        let path = if cfg!(test) || std::env::var_os("TT_DEMO").is_some() {
            None
        } else {
            Some(crate::backend::services::data_dir().join("ui-state.json"))
        };
        let mut s = Self::from_path(path);
        match std::env::var("TT_NAV").as_deref() {
            Ok("smal") => s.pref_collapsed = true,
            Ok("bred") => s.pref_collapsed = false,
            _ => {}
        }
        s
    }

    fn from_path(path: Option<PathBuf>) -> Self {
        let stored = path
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice::<Stored>(&b).ok())
            .unwrap_or_default();
        NavState {
            pref_collapsed: stored.nav_collapsed,
            narrow_expanded: false,
            path,
        }
    }

    pub fn is_narrow(width: f32) -> bool {
        width < NAV_AUTO_COLLAPSE_BELOW
    }

    /// Er menuen smal ved denne vinduesbredde?
    pub fn collapsed(&self, window_width: f32) -> bool {
        if Self::is_narrow(window_width) {
            !self.narrow_expanded
        } else {
            self.pref_collapsed
        }
    }

    /// Menuens bredde ved denne vinduesbredde.
    pub fn width(&self, window_width: f32) -> f32 {
        if self.collapsed(window_width) {
            NAV_RAIL_WIDTH
        } else {
            NAV_WIDTH
        }
    }

    /// Kaldes ved hver tegning: et bredt vindue glemmer den midlertidige udfoldning.
    pub fn observe_width(&mut self, window_width: f32) {
        if !Self::is_narrow(window_width) {
            self.narrow_expanded = false;
        }
    }

    /// Knappen og genvejen. Gemmer kun valget i brede vinduer.
    pub fn toggle(&mut self, window_width: f32) {
        if Self::is_narrow(window_width) {
            self.narrow_expanded = !self.narrow_expanded;
        } else {
            self.pref_collapsed = !self.pref_collapsed;
            self.save();
        }
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        let body = serde_json::to_vec_pretty(&Stored {
            nav_collapsed: self.pref_collapsed,
        })
        .expect("Stored kan altid serialiseres");
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // Atomisk: skriv ved siden af og omdøb.
        let tmp = path.with_extension("json.tmp");
        if let Err(e) = std::fs::write(&tmp, body).and_then(|_| std::fs::rename(&tmp, path)) {
            eprintln!("TT kunne ikke gemme menuens bredde: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{NAV_AUTO_COLLAPSE_BELOW, NAV_RAIL_WIDTH, NAV_WIDTH, NavState};

    const WIDE: f32 = 1200.;
    const NARROW: f32 = NAV_AUTO_COLLAPSE_BELOW - 1.;

    #[test]
    fn valget_gemmes_og_huskes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-state.json");
        let mut s = NavState::from_path(Some(path.clone()));
        assert!(!s.collapsed(WIDE), "fuld bredde som standard");
        s.toggle(WIDE);
        assert!(s.collapsed(WIDE));
        assert_eq!(s.width(WIDE), NAV_RAIL_WIDTH);
        // Ny start læser valget.
        let again = NavState::from_path(Some(path.clone()));
        assert!(again.collapsed(WIDE));
        let mut again = again;
        again.toggle(WIDE);
        assert!(!NavState::from_path(Some(path)).collapsed(WIDE));
    }

    #[test]
    fn smalt_vindue_klapper_sammen_uden_at_aendre_valget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-state.json");
        let mut s = NavState::from_path(Some(path.clone()));
        assert!(s.collapsed(NARROW), "smalt vindue: smal menu");
        // Midlertidigt foldet ud i det smalle vindue.
        s.toggle(NARROW);
        assert!(!s.collapsed(NARROW));
        assert_eq!(s.width(NARROW), NAV_WIDTH);
        assert!(!path.exists(), "det midlertidige valg gemmes ikke");
        // Bredt igen: valget gælder, og udfoldningen glemmes.
        s.observe_width(WIDE);
        assert!(!s.collapsed(WIDE));
        assert!(s.collapsed(NARROW));
    }

    #[test]
    fn oedelagt_fil_giver_standard() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-state.json");
        std::fs::write(&path, b"{ikke json").unwrap();
        assert!(!NavState::from_path(Some(path)).collapsed(WIDE));
    }

    #[test]
    fn uden_sti_gemmes_intet() {
        let mut s = NavState::from_path(None);
        s.toggle(WIDE);
        assert!(s.collapsed(WIDE));
    }
}
