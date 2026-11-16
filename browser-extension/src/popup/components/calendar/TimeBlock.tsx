import { memo } from "react";
import { formatMinutesOfDay } from "../../../utils/calendar-math";

interface TimeBlockProps {
  id: string;
  rawId: string;
  title: string;
  subtitle: string;
  isRunning: boolean;
  color: string;
  topPercent: number;
  heightPercent: number;
  dateStr: string;
  date: Date;
  startMin: number;
  endMin: number;
  isSelected: boolean;
  onClick: (id: string) => void;
  onBlockMouseDown: (
    e: React.MouseEvent,
    blockId: string,
    dateStr: string,
    date: Date,
    startMin: number,
    endMin: number,
  ) => void;
  onResizeMouseDown: (
    e: React.MouseEvent,
    blockId: string,
    dateStr: string,
    date: Date,
    startMin: number,
    endMin: number,
    edge: "top" | "bottom",
  ) => void;
}

export const TimeBlock = memo(function TimeBlock({
  id,
  rawId,
  title,
  subtitle,
  isRunning,
  color,
  topPercent,
  heightPercent,
  dateStr,
  date,
  startMin,
  endMin,
  isSelected,
  onClick,
  onBlockMouseDown,
  onResizeMouseDown,
}: TimeBlockProps) {
  const isSmall = heightPercent < 4;
  const timeRange = `${formatMinutesOfDay(startMin)}–${formatMinutesOfDay(endMin)}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: blokken har træk-håndtag inde i sig og kan ikke være en <button>
    <div
      role="button"
      tabIndex={0}
      aria-label={`${title}${subtitle ? `, ${subtitle}` : ""}, kl. ${timeRange}`}
      aria-pressed={isSelected}
      className={`tt-kal-blok absolute left-1 right-1 rounded-md overflow-hidden cursor-pointer transition-transform duration-100 group ${
        isSelected
          ? "ring-2 ring-primary-600 ring-offset-1"
          : "hover:scale-x-[1.02]"
      }`}
      style={
        {
          top: `${topPercent}%`,
          height: `${Math.max(heightPercent, 1.5)}%`,
          "--kal": color,
        } as React.CSSProperties
      }
      onClick={(e) => {
        e.stopPropagation();
        onClick(rawId);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(rawId);
        }
      }}
      onMouseDown={(e) =>
        onBlockMouseDown(e, id, dateStr, date, startMin, endMin)
      }
    >
      {/* Resize handle - top */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen */}
      <div
        className="tt-kal-greb absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={(e) =>
          onResizeMouseDown(e, id, dateStr, date, startMin, endMin, "top")
        }
      />

      {/* Content */}
      <div className="px-1.5 py-0.5 h-full flex flex-col justify-center overflow-hidden">
        <div className="flex items-center gap-1">
          {isRunning && (
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--kal)] animate-pulse-dot shrink-0" />
          )}
          <span
            className={`font-semibold truncate leading-tight text-[var(--color-text-primary)] ${
              isSmall ? "text-[11px]" : "text-xs"
            }`}
          >
            {title}
          </span>
        </div>
        {!isSmall && subtitle && (
          <span className="text-[11px] leading-tight text-[var(--color-text-secondary)] truncate">
            {subtitle}
          </span>
        )}
      </div>

      {/* Resize handle - bottom */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen */}
      <div
        className="tt-kal-greb absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={(e) =>
          onResizeMouseDown(e, id, dateStr, date, startMin, endMin, "bottom")
        }
      />
    </div>
  );
});
