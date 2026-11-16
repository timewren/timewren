import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../../i18n";
import { clientColorVar } from "../../../utils/calendar-colors";
import type { DragState } from "../../hooks/useCalendarDrag";
import {
  END_HOUR,
  minutesToPercent,
  START_HOUR,
  TOTAL_HOURS,
  toLocalDateStr,
} from "../../utils/calendar-math";
import { TimeBlock } from "./TimeBlock";

interface CalendarEntry {
  id: string;
  description: string;
  hours: number;
  startTime: string | null;
  endTime: string | null;
  projectName: string | null;
  clientName: string | null;
  clientId: string | null;
}

interface DayGridProps {
  date: Date;
  entries: CalendarEntry[];
  dragState: DragState | null;
  selectedBlockId: string | null;
  onBlockClick: (id: string) => void;
  registerGridRef: (el: HTMLDivElement | null) => void;
  onGridMouseDown: (e: React.MouseEvent, dateStr: string, date: Date) => void;
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
  onGridDoubleClick: (e: React.MouseEvent, dateStr: string, date: Date) => void;
}

interface BlockData {
  id: string;
  rawId: string;
  title: string;
  subtitle: string;
  color: string;
  topPercent: number;
  heightPercent: number;
  startMin: number;
  endMin: number;
  isRunning: boolean;
}

export function DayGrid({
  date,
  entries,
  dragState,
  selectedBlockId,
  onBlockClick,
  registerGridRef,
  onGridMouseDown,
  onBlockMouseDown,
  onResizeMouseDown,
  onGridDoubleClick,
}: DayGridProps) {
  const { t } = useT();
  const dateStr = toLocalDateStr(date);
  const todayStr = toLocalDateStr(new Date());
  const isToday = dateStr === todayStr;
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Update now-line every minute
  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(interval);
  }, [isToday]);

  // Auto-scroll to current hour on mount
  useEffect(() => {
    if (!gridContainerRef.current) return;
    const now = new Date();
    const currentHour = now.getHours();
    // Scroll so current hour is roughly in the top third
    const scrollTarget = Math.max(
      0,
      (currentHour - START_HOUR - 2) / TOTAL_HOURS,
    );
    gridContainerRef.current.scrollTop =
      gridContainerRef.current.scrollHeight * scrollTarget;
  }, []);

  // Build block data from entries with startTime/endTime
  const blocks: BlockData[] = useMemo(() => {
    return entries
      .flatMap((entry) =>
        entry.startTime && entry.endTime
          ? [{ entry, startTime: entry.startTime, endTime: entry.endTime }]
          : [],
      )
      .map(({ entry, startTime, endTime }) => {
        const start = new Date(startTime);
        const end = new Date(endTime);
        const startMin = start.getHours() * 60 + start.getMinutes();
        let endMin = end.getHours() * 60 + end.getMinutes();
        if (endMin <= startMin) endMin = END_HOUR * 60;

        return {
          id: `block-${entry.id}`,
          rawId: entry.id,
          title: entry.clientName || t("views.calendar.internal"),
          subtitle: entry.projectName || entry.description || "",
          color: clientColorVar(entry.clientId),
          topPercent: minutesToPercent(startMin),
          heightPercent: minutesToPercent(endMin) - minutesToPercent(startMin),
          startMin,
          endMin,
          isRunning: false,
        };
      });
  }, [entries, t]);

  // Hour labels
  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i),
    [],
  );

  const showNowLine =
    isToday && nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;
  const nowPercent = minutesToPercent(nowMinutes);

  // Drag overlay for create
  const dragOverlay = useMemo(() => {
    if (dragState?.type !== "create") return null;
    const start = Math.min(dragState.startMinutes, dragState.endMinutes);
    const end = Math.max(dragState.startMinutes, dragState.endMinutes);
    const top = minutesToPercent(start);
    const height = minutesToPercent(end) - top;
    return { top, height };
  }, [dragState]);

  return (
    <div ref={gridContainerRef} className="flex-1 overflow-y-auto">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen */}
      <div
        ref={registerGridRef}
        className="relative select-none"
        style={{ height: `${TOTAL_HOURS * 44}px` }}
        onMouseDown={(e) => {
          // Only trigger on direct grid clicks (not on blocks)
          if (
            e.target === e.currentTarget ||
            (e.target as HTMLElement).dataset.gridline
          ) {
            onGridMouseDown(e, dateStr, date);
          }
        }}
        onDoubleClick={(e) => {
          if (
            e.target === e.currentTarget ||
            (e.target as HTMLElement).dataset.gridline
          ) {
            onGridDoubleClick(e, dateStr, date);
          }
        }}
      >
        {/* Hour lines + labels */}
        {hours.map((hour) => {
          const top = ((hour - START_HOUR) / TOTAL_HOURS) * 100;
          return (
            <div
              key={hour}
              className="absolute left-0 right-0 pointer-events-none"
              style={{ top: `${top}%` }}
            >
              <div className="flex items-start">
                <span className="text-[10px] text-[var(--color-text-muted)] w-6 text-right pr-1 -mt-1.5">
                  {String(hour).padStart(2, "0")}
                </span>
                <div
                  data-gridline="true"
                  className="flex-1 border-t border-[var(--color-border-subtle)] pointer-events-auto"
                />
              </div>
            </div>
          );
        })}

        {/* Time blocks */}
        <div className="absolute inset-0 ml-7">
          {blocks.map((block) => (
            <TimeBlock
              key={block.id}
              id={block.id}
              rawId={block.rawId}
              title={block.title}
              subtitle={block.subtitle}
              isRunning={block.isRunning}
              color={block.color}
              topPercent={block.topPercent}
              heightPercent={block.heightPercent}
              dateStr={dateStr}
              date={date}
              startMin={block.startMin}
              endMin={block.endMin}
              isSelected={selectedBlockId === block.rawId}
              onClick={onBlockClick}
              onBlockMouseDown={onBlockMouseDown}
              onResizeMouseDown={onResizeMouseDown}
            />
          ))}

          {/* Drag-to-create overlay */}
          {dragOverlay && (
            <div
              className="absolute left-1 right-1 rounded-md border-2 border-dashed border-primary-400 bg-primary-50/50 pointer-events-none"
              style={{
                top: `${dragOverlay.top}%`,
                height: `${Math.max(dragOverlay.height, 1)}%`,
              }}
            />
          )}
        </div>

        {/* Now line */}
        {showNowLine && (
          <div
            className="absolute left-6 right-0 z-20 pointer-events-none"
            style={{ top: `${nowPercent}%` }}
          >
            <div className="relative">
              <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
              <div className="border-t border-red-500 ml-1" />
            </div>
          </div>
        )}

        {/* Empty state hint */}
        {isToday && blocks.length === 0 && !dragState && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-base)] px-2 py-1 rounded">
              {t("views.calendar.dragHint")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
