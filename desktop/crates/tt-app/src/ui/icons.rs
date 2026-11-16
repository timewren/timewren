//! Fælles ikoner: lucide (ISC, se `LICENSES.md`) som indlejrede SVG'er.
//!
//! ```ignore
//! use crate::ui::icons::{Icon, icon};
//! icon(Icon::Clock).size(16.).color(b.grey)
//! Button::new("ny").icon(Icon::Plus).label(t("…"))   // gpui-kit-knapper
//! ```
//!
//! SVG'erne ligger i `assets/icons/` og bliver lagt ind i binæren af
//! `include_bytes!`. `Assets` serverer dem under `tt-icons/` og sender alle
//! andre stier videre til gpui-kit's egne ikoner. Ikonerne er pynt: de har
//! ingen rolle i a11y-træet, så knappen eller rækken bærer navnet.
//!
//! Mangler et ikon: kopiér SVG'en fra lucide til `assets/icons/` og tilføj en
//! linje i `icons!` herunder (additivt, så de andre skærme ikke rammes).

use std::borrow::Cow;

use gpui_kit::component::IconNamed;
use gpui_kit::*;

macro_rules! icons {
    ($($name:ident => $file:literal,)*) => {
        /// Alle ikoner, appen bruger. Navnene følger lucide.
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum Icon {
            $($name,)*
        }

        impl Icon {
            pub const ALL: &[Icon] = &[$(Icon::$name,)*];

            /// Stien i `Assets` (`tt-icons/<lucide-navn>.svg`).
            pub fn path(self) -> &'static str {
                match self {
                    $(Icon::$name => concat!("tt-icons/", $file, ".svg"),)*
                }
            }

            fn bytes(self) -> &'static [u8] {
                match self {
                    $(Icon::$name => include_bytes!(concat!("../../assets/icons/", $file, ".svg")),)*
                }
            }
        }
    };
}

icons! {
    // TimeTracks mærke (web: docs/brand/logo/tt-maerke-currentcolor.svg).
    TimeTrack => "tt-maerke",
    // Navigation
    Home => "house",
    Calendar => "calendar",
    Activity => "activity",
    Users => "users",
    User => "user",
    Folder => "folder",
    CreditCard => "credit-card",
    Ticket => "ticket",
    ListTodo => "list-todo",
    FileText => "file-text",
    BarChart3 => "chart-column",
    Settings => "settings",
    PanelLeftClose => "panel-left-close",
    PanelLeftOpen => "panel-left-open",
    // Timer
    Play => "play",
    Pause => "pause",
    Square => "square",
    Timer => "timer",
    Coffee => "coffee",
    // Handlinger
    Plus => "plus",
    Search => "search",
    X => "x",
    Check => "check",
    Pencil => "pencil",
    Trash2 => "trash",
    Archive => "archive",
    Download => "download",
    Upload => "upload",
    RefreshCw => "refresh-cw",
    ExternalLink => "external-link",
    ArrowRight => "arrow-right",
    LogOut => "log-out",
    UserPlus => "user-plus",
    FolderPlus => "folder-plus",
    ChevronLeft => "chevron-left",
    ChevronRight => "chevron-right",
    ChevronDown => "chevron-down",
    ChevronUp => "chevron-up",
    // Status (opgaver: samme ikoner som web)
    Circle => "circle",
    Clock => "clock",
    PlayCircle => "circle-play",
    CheckCircle2 => "circle-check",
    XCircle => "circle-x", // tavle-egne-kolonner: annulleret
    AlertTriangle => "triangle-alert",
    AlertCircle => "circle-alert",
    Info => "info",
    Flag => "flag",
    CalendarClock => "calendar-clock", // ux-opgaver
    GripVertical => "grip-vertical", // ux-opgaver
    Tag => "tag",
    Link => "link",
    Bell => "bell",
    // Indstillinger, sporing og AI
    Sparkles => "sparkles",
    WandSparkles => "wand-sparkles",
    Lock => "lock",
    Eye => "eye",
    EyeOff => "eye-off",
    Monitor => "monitor",
    Globe => "globe",
    GitBranch => "git-branch",
    File => "file",
    Mail => "mail",
    Send => "send",
    Video => "video",
    Inbox => "inbox",
    Keyboard => "keyboard",
    Cloud => "cloud",
    HardDrive => "hard-drive",
    Receipt => "receipt",
    Sun => "sun",
    Moon => "moon",
    Languages => "languages",
}

/// gpui-kit's `Button::icon(…)` og `Icon::new(…)` tager vores ikoner direkte.
impl IconNamed for Icon {
    fn path(self) -> SharedString {
        Icon::path(self).into()
    }
}

/// Asset-kilden for appen: vores ikoner plus gpui-kit's (vælgere, inputs …).
#[derive(Clone, Copy, Debug, Default)]
pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        if let Some(icon) = lookup(path) {
            return Ok(Some(Cow::Borrowed(icon.bytes())));
        }
        gpui_kit::assets::Assets.load(path)
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut out: Vec<SharedString> = Icon::ALL
            .iter()
            .map(|i| i.path())
            .filter(|p| p.starts_with(path))
            .map(SharedString::from)
            .collect();
        out.extend(gpui_kit::assets::Assets.list(path)?);
        Ok(out)
    }
}

fn lookup(path: &str) -> Option<Icon> {
    if !path.starts_with("tt-icons/") {
        return None;
    }
    Icon::ALL.iter().copied().find(|i| i.path() == path)
}

/// Et ikon i en bestemt størrelse og farve. Standard: 16 px i tekstfarven.
#[derive(IntoElement)]
pub struct IconEl {
    icon: Icon,
    size: Pixels,
    color: Option<Hsla>,
}

/// `icon(Icon::Clock).size(16.).color(b.grey)`.
pub fn icon(icon: Icon) -> IconEl {
    IconEl {
        icon,
        size: px(16.),
        color: None,
    }
}

impl IconEl {
    pub fn size(mut self, px_: f32) -> Self {
        self.size = px(px_);
        self
    }

    pub fn color(mut self, color: impl Into<Hsla>) -> Self {
        self.color = Some(color.into());
        self
    }
}

impl RenderOnce for IconEl {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or_else(|| window.text_style().color);
        svg()
            .path(self.icon.path())
            .flex_none()
            .size(self.size)
            .text_color(color)
    }
}

#[cfg(test)]
mod tests {
    use super::{Assets, Icon, IconNamed};
    use gpui_kit::AssetSource as _;

    /// Hvert ikon findes som gyldig lucide-SVG og kan hentes gennem `Assets`.
    #[test]
    fn alle_ikoner_er_indlejret_og_kan_hentes() {
        for &i in Icon::ALL {
            let bytes = Assets.load(i.path()).unwrap().expect("ikonet findes");
            let svg = std::str::from_utf8(&bytes).expect("utf-8");
            assert!(svg.contains("<svg"), "{i:?} er ikke en SVG");
            if i != Icon::TimeTrack {
                assert!(
                    svg.contains("viewBox=\"0 0 24 24\""),
                    "{i:?} er ikke lucide"
                );
            }
            assert!(svg.contains("currentColor"), "{i:?} kan ikke farves");
        }
    }

    #[test]
    fn stier_er_unikke() {
        let mut paths: Vec<_> = Icon::ALL.iter().map(|i| i.path()).collect();
        paths.sort();
        let before = paths.len();
        paths.dedup();
        assert_eq!(before, paths.len(), "to ikoner peger på samme fil");
    }

    /// gpui-kit's egne ikoner (vælgerens pile, søgefeltet) virker stadig.
    #[test]
    fn gpui_kit_ikoner_sendes_videre() {
        let p = IconNamed::path(gpui_kit::component::IconName::Search);
        assert!(Assets.load(&p).unwrap().is_some(), "{p} mangler");
        assert!(!matches!(
            Assets.load("tt-icons/findes-ikke.svg"),
            Ok(Some(_))
        ));
    }

    #[test]
    fn listen_indeholder_vores_ikoner() {
        let list = Assets.list("tt-icons/").unwrap();
        assert_eq!(list.len(), Icon::ALL.len());
    }
}
