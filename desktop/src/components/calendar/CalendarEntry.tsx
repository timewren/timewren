import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { timeToHours } from "@/lib/calendar";
import { formatDuration, formatTime } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

interface CalendarEntryProps {
  entry: TimeEntry;
  hourHeight: number;
  startHour: number;
  onClick: (entry: TimeEntry) => void;
  /** Override the start time for display (used for midnight-split segments) */
  displayStart?: string;
  /** Override the end time for display (used for midnight-split segments) */
  displayEnd?: string;
}

/**
 * Determine if white text has enough contrast on a given background color.
 * Returns true if the color is dark enough for white text.
 */
function isDarkColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // Relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.55;
}

export function CalendarEntry({
  entry,
  hourHeight,
  startHour,
  onClick,
  displayStart,
  displayEnd,
}: CalendarEntryProps) {
  const { t } = useTranslation();
  const style = useMemo(() => {
    const effectiveStart = displayStart ?? entry.start_time;
    const effectiveEnd = displayEnd ?? entry.end_time;
    const startH = timeToHours(effectiveStart);
    const endH = effectiveEnd ? timeToHours(effectiveEnd) : startH + 0.25; // Default 15-min block for running entries

    const top = (startH - startHour) * hourHeight;
    const height = Math.max((endH - startH) * hourHeight, 4); // Min 4px

    const bgColor = entry.project_color ?? "#6b7280";
    const dark = isDarkColor(bgColor);

    return {
      top: `${top}px`,
      height: `${height}px`,
      backgroundColor: `${bgColor}cc`, // ~80% opacity
      color: dark ? "#ffffff" : "#1a1a1a",
      minHeight: "18px",
    };
  }, [entry, hourHeight, startHour, displayStart, displayEnd]);

  const duration = entry.duration ?? 0;
  const isCompact = parseFloat(style.height) < 40;

  return (
    <button
      type="button"
      onClick={() => onClick(entry)}
      className="absolute inset-x-1 z-10 cursor-pointer overflow-hidden rounded-md px-2 py-0.5 text-left transition-opacity hover:opacity-90 active:opacity-80"
      style={style}
      title={
        entry.description
          ? `${entry.project_name ?? t("calendar.noProject")}: ${entry.description}`
          : (entry.project_name ?? t("calendar.noProject"))
      }
    >
      {isCompact ? (
        <span className="truncate text-[10px] font-medium leading-tight">
          {entry.project_name ?? "—"} · {formatDuration(duration)}
        </span>
      ) : (
        <>
          <div className="truncate text-xs font-semibold leading-tight">
            {entry.project_name ?? t("calendar.noProject")}
          </div>
          <div className="truncate text-[10px] leading-tight opacity-80">
            {formatTime(entry.start_time)}
            {entry.end_time ? `–${formatTime(entry.end_time)}` : " →"} ·{" "}
            {formatDuration(duration)}
          </div>
          {entry.description && !isCompact && (
            <div className="mt-0.5 truncate text-[10px] leading-tight opacity-60">
              {entry.description}
            </div>
          )}
        </>
      )}
    </button>
  );
}
