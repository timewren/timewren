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

const DRAG_THRESHOLD = 5;

export function useCalendarDrag(options: UseDragOptions) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const isDragging = dragState !== null;
  const dragRef = useRef<DragState | null>(null);
  const optionsRef = useRef(options);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const mouseStartPos = useRef<{ x: number; y: number } | null>(null);
  const hasDragged = useRef(false);

  useEffect(() => {
    dragRef.current = dragState;
  }, [dragState]);

  optionsRef.current = options;

  /** Register the single grid element */
  const registerGridRef = useCallback((el: HTMLDivElement | null) => {
    gridRef.current = el;
  }, []);

  /** Convert clientY to minutes since midnight, relative to the grid */
  const clientYToMinutes = useCallback((clientY: number): number => {
    const el = gridRef.current;
    if (!el) return START_HOUR * 60;
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top;
    return pixelToMinutes(y, rect.height);
  }, []);

  // --- Create ---
  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent, dateStr: string, date: Date) => {
      if (e.button !== 0) return;
      if (!gridRef.current) return;
      mouseStartPos.current = { x: e.clientX, y: e.clientY };
      hasDragged.current = false;
      const minutes = clientYToMinutes(e.clientY);
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
      mouseStartPos.current = { x: e.clientX, y: e.clientY };
      hasDragged.current = false;
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

  // --- Global mousemove/mouseup handlers ---
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (mouseStartPos.current) {
        const dx = e.clientX - mouseStartPos.current.x;
        const dy = e.clientY - mouseStartPos.current.y;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          hasDragged.current = true;
        }
      }

      const minutes = clientYToMinutes(e.clientY);

      if (drag.type === "create") {
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
        const { originalStartMinutes, originalEndMinutes } = drag;
        if (originalStartMinutes == null || originalEndMinutes == null) return;
        const duration = originalEndMinutes - originalStartMinutes;
        const newStart = snapMinutes(
          Math.max(
            START_HOUR * 60,
            Math.min(END_HOUR * 60 - duration, minutes),
          ),
        );
        setDragState((prev) =>
          prev
            ? {
                ...prev,
                startMinutes: newStart,
                endMinutes: newStart + duration,
              }
            : null,
        );
      }

      if (drag.type === "resize-bottom") {
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

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDragging, clientYToMinutes]);

  return {
    dragState,
    isDragging,
    registerGridRef,
    handleGridMouseDown,
    handleBlockMouseDown,
    handleResizeMouseDown,
  };
}
