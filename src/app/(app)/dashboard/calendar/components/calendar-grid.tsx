import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragState } from "../hooks/use-calendar-drag";
import { computeOverlapLayout } from "../hooks/use-overlap-layout";
import type { ClientMatch, TimeBlock } from "../types";
import {
  blockToMinutes,
  END_HOUR,
  HOUR_HEIGHT,
  minutesToPercent,
  pixelToMinutes,
  START_HOUR,
  TOTAL_HOURS,
} from "../utils/calendar-math";
import { DragOverlay } from "./drag-overlay";
import { EventDetailPopup } from "./event-detail-popup";
import { TimeBlockComponent } from "./time-block";

interface CalendarGridColumnProps {
  blocks: TimeBlock[];
  date: Date;
  dateStr: string;
  isToday: boolean;
  dragState: DragState | null;
  selectedBlockId: string | null;
  eventMatches: Record<string, ClientMatch | null>;
  selectedBlock: TimeBlock | null;
  onBlockClick: (block: TimeBlock) => void;
  onStartTimer: (block: TimeBlock) => void;
  onCreateEntry: (block: TimeBlock) => void;
  onEditEntry?: (block: TimeBlock) => void;
  onDeleteEntry?: (block: TimeBlock) => void;
  onContinueAsSegment?: (block: TimeBlock) => void;
  onNewEntryForTask?: (block: TimeBlock) => void;
  onQuickRegister: (block: TimeBlock, match: ClientMatch) => void;
  registerGridRef: (dateStr: string, el: HTMLDivElement | null) => void;
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
  onGridTouchStart: (e: React.TouchEvent, dateStr: string, date: Date) => void;
  onTouchEnd: () => void;
  onGridDoubleClick?: (
    dateStr: string,
    date: Date,
    startMinutes: number,
  ) => void;
}

export function CalendarGridColumn({
  blocks,
  date,
  dateStr,
  isToday,
  dragState,
  selectedBlock,
  selectedBlockId,
  eventMatches,
  onBlockClick,
  onStartTimer,
  onCreateEntry,
  onEditEntry,
  onDeleteEntry,
  onContinueAsSegment,
  onNewEntryForTask,
  onQuickRegister,
  registerGridRef,
  onGridMouseDown,
  onBlockMouseDown,
  onResizeMouseDown,
  onGridTouchStart,
  onTouchEnd,
  onGridDoubleClick,
}: CalendarGridColumnProps) {
  const t = useTranslations("calendar");
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  const showNowLine =
    isToday && nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;
  const nowTop = minutesToPercent(nowMinutes);

  // Filter out all-day events
  const timedBlocks = useMemo(
    () => blocks.filter((b) => !b.isAllDay),
    [blocks],
  );

  // Compute overlap layout (uses blockToMinutes for midnight-crossing safety)
  const blockTimings = useMemo(
    () =>
      timedBlocks.map((b) => {
        const { startMin, endMin } = blockToMinutes(b.startTime, b.endTime);
        return { id: b.id, startMinutes: startMin, endMinutes: endMin };
      }),
    [timedBlocks],
  );
  const layoutMap = useMemo(
    () => computeOverlapLayout(blockTimings),
    [blockTimings],
  );

  // Adjust block minutes if being dragged (move or resize)
  const getBlockMinutes = useCallback(
    (block: TimeBlock) => {
      const { startMin, endMin } = blockToMinutes(
        block.startTime,
        block.endTime,
      );

      if (
        dragState &&
        (dragState.type === "move" ||
          dragState.type === "resize-top" ||
          dragState.type === "resize-bottom") &&
        dragState.blockId === block.rawId &&
        dragState.dateStr === dateStr
      ) {
        return {
          startMin: dragState.startMinutes,
          endMin: dragState.endMinutes,
        };
      }

      return { startMin, endMin };
    },
    [dragState, dateStr],
  );

  const showCreateOverlay =
    dragState?.type === "create" && dragState.dateStr === dateStr;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: kun-mus-håndtag til træk/resize; tiderne kan også rettes via redigeringsformularen
    <div
      ref={(el) => registerGridRef(dateStr, el)}
      className="relative flex-1 min-w-0 cursor-crosshair select-none"
      style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
      onMouseDown={(e) => {
        // Only fire if clicking on the grid itself, not on a block
        if ((e.target as HTMLElement).closest("[data-block]")) return;
        onGridMouseDown(e, dateStr, date);
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-block]")) return;
        if (!onGridDoubleClick || dragState) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const minutes = pixelToMinutes(y, rect.height);
        onGridDoubleClick(dateStr, date, minutes);
      }}
      onTouchStart={(e) => onGridTouchStart(e, dateStr, date)}
      onTouchEnd={onTouchEnd}
    >
      {/* Hour lines */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
          key={`h-${i}`}
          className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800"
          style={{ top: i * HOUR_HEIGHT }}
        />
      ))}

      {/* Now line */}
      {showNowLine && (
        <div
          className="absolute left-0 right-0 z-20 border-t-2 border-red-500"
          style={{ top: `${nowTop}%` }}
        >
          <div className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-red-500" />
        </div>
      )}

      {/* Empty state hint for today */}
      {isToday && timedBlocks.length === 0 && (
        <div
          className="absolute inset-x-0 pointer-events-none flex items-center justify-center text-xs text-gray-300 dark:text-gray-600"
          style={{ top: "40%" }}
        >
          {t("grid.doubleClickHint")}
        </div>
      )}

      {/* Time blocks */}
      {timedBlocks.map((block) => {
        const { startMin, endMin } = getBlockMinutes(block);
        const top = minutesToPercent(Math.max(startMin, START_HOUR * 60));
        const bottom = minutesToPercent(Math.min(endMin, END_HOUR * 60));
        const height = bottom - top;

        if (height <= 0) return null;

        const layout = layoutMap.get(block.id);
        const isDragTarget =
          !!dragState &&
          dragState.blockId === block.rawId &&
          dragState.type === "move" &&
          dragState.dateStr !== dateStr;
        const match = block.type === "event" ? eventMatches[block.rawId] : null;

        return (
          <div
            key={block.id}
            data-block
            style={{
              position: "absolute",
              top: `${top}%`,
              height: `${height}%`,
              minHeight: 20,
              left: 0,
              right: 0,
            }}
          >
            <TimeBlockComponent
              block={block}
              layout={layout}
              dateStr={dateStr}
              date={date}
              blockStartMinutes={startMin}
              blockEndMinutes={endMin}
              isSelected={selectedBlockId === block.id}
              isDragTarget={isDragTarget}
              eventMatch={match}
              onBlockClick={onBlockClick}
              onBlockMouseDown={onBlockMouseDown}
              onResizeMouseDown={onResizeMouseDown}
              onQuickRegister={onQuickRegister}
            />
            {selectedBlock?.id === block.id && (
              // biome-ignore lint/a11y/noStaticElementInteractions: wrapper stopper kun bobling af klik, den er ikke selv et kontrolelement
              <div onMouseDown={(e) => e.stopPropagation()}>
                <EventDetailPopup
                  block={block}
                  onClose={() => onBlockClick(block)}
                  onStartTimer={onStartTimer}
                  onCreateEntry={onCreateEntry}
                  onEditEntry={onEditEntry}
                  onDeleteEntry={onDeleteEntry}
                  onContinueAsSegment={onContinueAsSegment}
                  onNewEntryForTask={onNewEntryForTask}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Drag-to-create overlay */}
      {showCreateOverlay && <DragOverlay dragState={dragState} />}
    </div>
  );
}
