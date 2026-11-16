//! Ikoner på opgaveskærmen: de samme lucide-ikoner som web's opgaveside
//! (Circle, Clock, PlayCircle og CheckCircle2 til statusserne), hentet fra det
//! fælles ikonmodul.

use gpui_kit::Hsla;

use crate::backend::{LaneCategory, TaskLane, TaskPriority, TaskStatus};
use crate::ui::icons::{self, Icon};

/// Skærmens ikoner under skærmens egne navne.
pub type Ic = Icon;

/// Statusikonet som i web.
pub fn status_icon(s: TaskStatus) -> Ic {
    match s {
        TaskStatus::Backlog => Icon::Circle,
        TaskStatus::Todo => Icon::Clock,
        TaskStatus::InProgress => Icon::PlayCircle,
        TaskStatus::Done => Icon::CheckCircle2,
    }
}

/// Kolonnens ikon: statusikonet for kolonnens kategori, et kryds for
/// annulleret.
pub fn lane_icon(lane: &TaskLane) -> Ic {
    match lane.category {
        LaneCategory::Cancelled => Icon::XCircle,
        _ => status_icon(super::logic::legacy_status_for_lane(lane, TaskStatus::Todo)),
    }
}

/// Prioritetens ikon: flaget; urgent har en advarselstrekant.
pub fn priority_icon(p: TaskPriority) -> Ic {
    match p {
        TaskPriority::Urgent => Icon::AlertTriangle,
        _ => Icon::Flag,
    }
}

/// Et ikon i `size` pixels og `color`. Dekorativt: skærmlæseren får teksten
/// ved siden af, ikke ikonet.
pub fn ikon(ic: Ic, size: f32, color: Hsla) -> icons::IconEl {
    icons::icon(ic).size(size).color(color)
}
