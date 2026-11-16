import { useCallback, useEffect, useRef, useState } from "react";
import {
  END_HOUR,
  pixelToMinutes,
  SNAP_MINUTES,
  START_HOUR,
  snapMinutes,
} from "../utils/calendar-math";

export type DragType = "create" | "move" | "resize-top" | "resize-bottom";

export interface DragState {
  type: DragType;
  /** Date of the column being dragged in (YYYY-MM-DD) */
  dateStr: string;
  /** Date object for the column */
  date: Date;
  /** Start minutes since midnight (snapped) */
  startMinutes: number;
  /** End minutes since midnight (snapped) */
  endMinutes: number;
  /** For move/resize: the original block id being modified */
  blockId?: string;
  /** For move: original start minutes before drag started */
  originalStartMinutes?: number;
  /** For move: original end minutes before drag started */
  originalEndMinutes?: number;
}

interface UseDragOptions {
  onCreateEnd: (
    dateStr: string,
    date: Date,
    startMinutes: number,
    endMinutes: number,
  ) => void;
  onMoveEnd: (
    blockId: string,
    dateStr: string,
    date: Date,
    startMinutes: number,
    endMinutes: number,
  ) => void;
  onResizeEnd: (
    blockId: string,
    startMinutes: number,
    endMinutes: number,
  ) => void;
}

const DRAG_THRESHOLD = 5; // px — minimum mouse movement to count as a drag vs. click

export function useCalendarDrag(options: UseDragOptions) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const isDragging = dragState !== null;
  const dragRef = useRef<DragState | null>(null);
  const optionsRef = useRef(options);
  const gridRefMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseStartPos = useRef<{ x: number; y: number } | null>(null);
  const hasDragged = useRef(false);

  // Keep refs in sync with state/props for event handlers
  useEffect(() => {
    dragRef.current = dragState;
  }, [dragState]);

  optionsRef.current = options;

  /** Register a grid column element for a specific date */
  const registerGridRef = useCallback(
    (dateStr: string, el: HTMLDivElement | null) => {
      if (el) {
        gridRefMap.current.set(dateStr, el);
      } else {
        gridRefMap.current.delete(dateStr);
      }
    },
    [],
  );

  /** Convert clientY to minutes since midnight, relative to a grid element */
  const clientYToMinutes = useCallback(
    (clientY: number, gridEl: HTMLDivElement): number => {
      const rect = gridEl.getBoundingClientRect();
      const y = clientY - rect.top;
      return pixelToMinutes(y, rect.height);
    },
    [],
  );

  /** Find which date column the clientX is over (for cross-day move in week view) */
  const findDateAtX = useCallback(
    (clientX: number): { dateStr: string; el: HTMLDivElement } | null => {
      for (const [dateStr, el] of gridRefMap.current) {
        const rect = el.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) {
          return { dateStr, el };
        }
      }
      return null;
    },
    [],
  );

  // --- Create ---
  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent, dateStr: string, date: Date) => {
      if (e.button !== 0) return;
      const gridEl = gridRefMap.current.get(dateStr);
      if (!gridEl) return;
      mouseStartPos.current = { x: e.clientX, y: e.clientY };
      hasDragged.current = false;
      const minutes = clientYToMinutes(e.clientY, gridEl);
      const state: DragState = {
        type: "create",
        dateStr,
        date,
        startMinutes: minutes,
        endMinutes: minutes + SNAP_MINUTES,
      };
      setDragState(state);
      e.preventDefault();
    },
    [clientYToMinutes],
  );

  // --- Move ---
  const handleBlockMouseDown = useCallback(
    (
      e: React.MouseEvent,
      blockId: string,
      dateStr: string,
      date: Date,
      blockStartMinutes: number,
      blockEndMinutes: number,
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      mouseStartPos.current = { x: e.clientX, y: e.clientY };
      hasDragged.current = false;
      const state: DragState = {
        type: "move",
        dateStr,
        date,
        startMinutes: blockStartMinutes,
        endMinutes: blockEndMinutes,
        blockId,
        originalStartMinutes: blockStartMinutes,
        originalEndMinutes: blockEndMinutes,
      };
      setDragState(state);
      e.preventDefault();
    },
    [],
  );

  // --- Resize ---
  const handleResizeMouseDown = useCallback(
    (
      e: React.MouseEvent,
      blockId: string,
      dateStr: string,
      date: Date,
      blockStartMinutes: number,
      blockEndMinutes: number,
      edge: "top" | "bottom",
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const state: DragState = {
        type: edge === "top" ? "resize-top" : "resize-bottom",
        dateStr,
        date,
        startMinutes: blockStartMinutes,
        endMinutes: blockEndMinutes,
        blockId,
        originalStartMinutes: blockStartMinutes,
        originalEndMinutes: blockEndMinutes,
      };
      setDragState(state);
      e.preventDefault();
    },
    [],
  );

  // --- Touch handlers (long-press to activate) ---
  const handleGridTouchStart = useCallback(
    (e: React.TouchEvent, dateStr: string, date: Date) => {
      const touch = e.touches[0];
      const gridEl = gridRefMap.current.get(dateStr);
      if (!gridEl) return;
      const minutes = clientYToMinutes(touch.clientY, gridEl);
      longPressTimer.current = setTimeout(() => {
        const state: DragState = {
          type: "create",
          dateStr,
          date,
          startMinutes: minutes,
          endMinutes: minutes + SNAP_MINUTES,
        };
        setDragState(state);
      }, 300);
    },
    [clientYToMinutes],
  );

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // --- Global mousemove/mouseup handlers ---
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      // Track whether mouse actually moved (click vs drag)
      if (mouseStartPos.current) {
        const dx = e.clientX - mouseStartPos.current.x;
        const dy = e.clientY - mouseStartPos.current.y;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          hasDragged.current = true;
        }
      }

      if (drag.type === "create") {
        const gridEl = gridRefMap.current.get(drag.dateStr);
        if (!gridEl) return;
        const minutes = clientYToMinutes(e.clientY, gridEl);
        setDragState((prev) =>
          prev
            ? {
                ...prev,
                endMinutes: Math.max(minutes, prev.startMinutes + SNAP_MINUTES),
              }
            : null,
        );
      }

      if (drag.type === "move") {
        const target = findDateAtX(e.clientX);
        if (!target) return;
        const minutes = clientYToMinutes(e.clientY, target.el);
        const { originalStartMinutes, originalEndMinutes } = drag;
        if (originalStartMinutes == null || originalEndMinutes == null) return;
        const duration = originalEndMinutes - originalStartMinutes;
        const newStart = snapMinutes(
          Math.max(
            START_HOUR * 60,
            Math.min(END_HOUR * 60 - duration, minutes),
          ),
        );
        const newDate = new Date(`${target.dateStr}T00:00:00`);
        setDragState((prev) =>
          prev
            ? {
                ...prev,
                dateStr: target.dateStr,
                date: newDate,
                startMinutes: newStart,
                endMinutes: newStart + duration,
              }
            : null,
        );
      }

      if (drag.type === "resize-bottom") {
        const gridEl = gridRefMap.current.get(drag.dateStr);
        if (!gridEl) return;
        const minutes = clientYToMinutes(e.clientY, gridEl);
        setDragState((prev) =>
          prev
            ? {
                ...prev,
                endMinutes: Math.max(minutes, prev.startMinutes + SNAP_MINUTES),
              }
            : null,
        );
      }

      if (drag.type === "resize-top") {
        const gridEl = gridRefMap.current.get(drag.dateStr);
        if (!gridEl) return;
        const minutes = clientYToMinutes(e.clientY, gridEl);
        setDragState((prev) =>
          prev
            ? {
                ...prev,
                startMinutes: Math.min(minutes, prev.endMinutes - SNAP_MINUTES),
              }
            : null,
        );
      }
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;

      const start = Math.min(drag.startMinutes, drag.endMinutes);
      const end = Math.max(drag.startMinutes, drag.endMinutes);

      if (drag.type === "create" && hasDragged.current) {
        const finalEnd = end - start < SNAP_MINUTES ? start + 30 : end;
        optionsRef.current.onCreateEnd(
          drag.dateStr,
          drag.date,
          start,
          Math.min(finalEnd, END_HOUR * 60),
        );
      }

      // Only fire move/resize if the mouse actually moved (not just a click)
      if (drag.type === "move" && drag.blockId && hasDragged.current) {
        optionsRef.current.onMoveEnd(
          drag.blockId,
          drag.dateStr,
          drag.date,
          start,
          end,
        );
      }

      if (
        (drag.type === "resize-top" || drag.type === "resize-bottom") &&
        drag.blockId &&
        hasDragged.current
      ) {
        optionsRef.current.onResizeEnd(drag.blockId, start, end);
      }

      setDragState(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDragState(null);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      handleMouseMove({
        clientX: touch.clientX,
        clientY: touch.clientY,
      } as MouseEvent);
    };

    const handleTouchEndGlobal = () => {
      handleMouseUp();
      handleTouchEnd();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEndGlobal);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEndGlobal);
    };
  }, [isDragging, clientYToMinutes, findDateAtX, handleTouchEnd]);

  return {
    dragState,
    isDragging,
    registerGridRef,
    handleGridMouseDown,
    handleBlockMouseDown,
    handleResizeMouseDown,
    handleGridTouchStart,
    handleTouchEnd,
  };
}
