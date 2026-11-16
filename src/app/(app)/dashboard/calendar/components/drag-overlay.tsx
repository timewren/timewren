import type { DragState } from "../hooks/use-calendar-drag";
import { minutesToPercent } from "../utils/calendar-math";

interface DragOverlayProps {
  dragState: DragState;
}

function formatMinutesAsTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDurationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}t ${m}m` : `${h}t`;
}

export function DragOverlay({ dragState }: DragOverlayProps) {
  if (dragState.type !== "create") return null;

  const startMin = Math.min(dragState.startMinutes, dragState.endMinutes);
  const endMin = Math.max(dragState.startMinutes, dragState.endMinutes);
  const top = minutesToPercent(startMin);
  const bottom = minutesToPercent(endMin);
  const height = bottom - top;
  const durationMinutes = endMin - startMin;

  const timeLabel = `${formatMinutesAsTime(startMin)}–${formatMinutesAsTime(endMin)} (${formatDurationLabel(durationMinutes)})`;

  const isShort = durationMinutes < 20;

  return (
    <div
      className="absolute left-1 right-1 z-30 pointer-events-none"
      style={{
        top: `${top}%`,
        height: `${height}%`,
        minHeight: 20,
      }}
    >
      {/* Blue overlay background */}
      <div className="absolute inset-0 rounded-md border-2 border-brand-500 bg-brand-100/60 dark:bg-tt-gran-lys" />

      {/* Time label */}
      <div
        className={`absolute left-0 right-0 flex items-center justify-center px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-200 whitespace-nowrap ${
          isShort
            ? "bottom-full mb-1 rounded-md bg-brand-100/90 dark:bg-tt-gran-lys border border-brand-300 dark:border-brand-700"
            : "inset-0"
        }`}
      >
        {timeLabel}
      </div>
    </div>
  );
}
