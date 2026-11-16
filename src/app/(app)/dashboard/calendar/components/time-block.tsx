import { AlertTriangle, Calendar, Check, Clock, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/providers/theme-provider";
import type { BlockLayout } from "../hooks/use-overlap-layout";
import type { ClientMatch, TimeBlock as TimeBlockType } from "../types";
import { formatTime } from "../utils/calendar-math";

/** Generate a deterministic HSL hue from a taskId string. */
function taskHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ((hash % 360) + 360) % 360;
}

interface TimeBlockProps {
  block: TimeBlockType;
  layout?: BlockLayout;
  dateStr: string;
  date: Date;
  blockStartMinutes: number;
  blockEndMinutes: number;
  isSelected: boolean;
  isDragTarget: boolean;
  eventMatch?: ClientMatch | null;
  onBlockClick: (block: TimeBlockType) => void;
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
  onQuickRegister?: (block: TimeBlockType, match: ClientMatch) => void;
}

export function TimeBlockComponent({
  block,
  layout,
  dateStr,
  date,
  blockStartMinutes,
  blockEndMinutes,
  isSelected,
  isDragTarget,
  eventMatch,
  onBlockClick,
  onBlockMouseDown,
  onResizeMouseDown,
  onQuickRegister,
}: TimeBlockProps) {
  const t = useTranslations("calendar");
  const isEvent = block.type === "event";
  const isEntry = block.type === "entry";
  const hasLinked = !!block.linkedTimeEntryId;
  const hasHighConfidenceMatch = eventMatch && eventMatch.score > 150;
  const isUnregisteredEvent = isEvent && !hasLinked;
  const heightMinutes = blockEndMinutes - blockStartMinutes;

  // Only entries are draggable (not ghost events)
  const canDrag = isEntry;

  // Client-based color: hex from DB (#3b82f6) or auto-hue string ("210")
  const { actualTheme } = useTheme();
  const isHex = block.clientColor?.startsWith("#");
  const hasClientColor = isEntry && !!block.clientColor;
  const clientColorStyle = (() => {
    const color = block.clientColor;
    if (!hasClientColor || !color) return undefined;
    if (isHex) {
      const hex = color;
      return actualTheme === "dark"
        ? { backgroundColor: `${hex}33`, borderColor: `${hex}66` }
        : { backgroundColor: `${hex}1a`, borderColor: `${hex}55` };
    }
    const hue = Number(block.clientColor);
    return actualTheme === "dark"
      ? {
          backgroundColor: `hsl(${hue} 45% 20%)`,
          borderColor: `hsl(${hue} 45% 30%)`,
        }
      : {
          backgroundColor: `hsl(${hue} 40% 90%)`,
          borderColor: `hsl(${hue} 40% 75%)`,
        };
  })();

  // Task-based left border color for same-task grouping
  const taskBorderStyle =
    isEntry && block.taskId
      ? {
          borderLeftColor: `hsl(${taskHue(block.taskId)}, 70%, 60%)`,
          borderLeftWidth: "3px",
        }
      : undefined;

  return (
    <div
      className={`absolute inset-y-0 z-10 ${isDragTarget ? "opacity-50" : ""}`}
      style={{
        left: layout?.left ?? "4px",
        width: layout?.width ?? "calc(100% - 8px)",
      }}
    >
      {/* Resize handle: top */}
      {canDrag && (
        // biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen
        <div
          className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-20 group"
          onMouseDown={(e) =>
            onResizeMouseDown(
              e,
              block.rawId,
              dateStr,
              date,
              blockStartMinutes,
              blockEndMinutes,
              "top",
            )
          }
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-transparent group-hover:bg-gray-400 transition-colors" />
        </div>
      )}

      {/* Block body */}
      <button
        type="button"
        onClick={() => onBlockClick(block)}
        onMouseDown={(e) => {
          if (canDrag) {
            onBlockMouseDown(
              e,
              block.rawId,
              dateStr,
              date,
              blockStartMinutes,
              blockEndMinutes,
            );
          }
        }}
        style={{ ...clientColorStyle, ...taskBorderStyle }}
        className={`h-full w-full overflow-hidden rounded-md px-2 py-1 text-left text-xs shadow-sm transition-all ${
          isEvent
            ? hasLinked
              ? "border border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/60 dark:text-green-200"
              : "border border-dashed border-brand-300 bg-brand-50/50 text-brand-800 dark:border-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
            : hasClientColor
              ? "border text-gray-700 dark:text-gray-200"
              : "border border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
        } ${isSelected ? "ring-2 ring-brand-500 ring-offset-1" : ""} ${
          canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        }`}
      >
        <div className="flex items-center gap-1">
          {isEvent ? (
            hasLinked ? (
              <Check className="h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
            ) : (
              <Calendar className="h-3 w-3 shrink-0 opacity-60" />
            )
          ) : (
            <Clock className="h-3 w-3 shrink-0 opacity-60" />
          )}
          <span className="truncate font-medium">{block.title}</span>
          {block.continues && (
            <span
              title={t("block.continuesNext")}
              className="shrink-0 opacity-60"
            >
              →
            </span>
          )}
          {block.isContinuation && (
            <span
              title={t("block.continuesFromPrev")}
              className="shrink-0 opacity-60"
            >
              ←
            </span>
          )}
          {layout?.hasOverlap && (
            <span title={t("block.overlaps")}>
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
            </span>
          )}
          {isUnregisteredEvent && !hasHighConfidenceMatch && (
            <span className="relative ml-auto shrink-0 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
          )}
        </div>
        {heightMinutes > 20 && (
          <div className="truncate opacity-70">
            {formatTime(block.startTime)}–{formatTime(block.endTime)}
            {block.clientName && ` · ${block.clientName}`}
            {block.projectName && ` · ${block.projectName}`}
          </div>
        )}
      </button>

      {/* Quick-register for high-confidence matches */}
      {isUnregisteredEvent &&
        hasHighConfidenceMatch &&
        heightMinutes > 25 &&
        onQuickRegister && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickRegister(block, eventMatch);
            }}
            className="absolute right-2 bottom-1 z-20 inline-flex items-center gap-0.5 rounded bg-green-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm hover:bg-green-700 backdrop-blur-sm"
          >
            <Zap className="h-2.5 w-2.5" />
            {eventMatch.clientName}
          </button>
        )}

      {/* Resize handle: bottom */}
      {canDrag && (
        // biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen
        <div
          className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize z-20 group"
          onMouseDown={(e) =>
            onResizeMouseDown(
              e,
              block.rawId,
              dateStr,
              date,
              blockStartMinutes,
              blockEndMinutes,
              "bottom",
            )
          }
        >
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-transparent group-hover:bg-gray-400 transition-colors" />
        </div>
      )}
    </div>
  );
}
