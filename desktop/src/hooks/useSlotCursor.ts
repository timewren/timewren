import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  initialSlotCursor,
  moveSlotCursor,
  resizeSlotCursor,
  type SlotCursor,
  slotCursorToTimes,
} from "@/lib/calendarSlots";

const DEFAULT_SIZE_QUARTERS = 4; // one hour

interface SlotCursorOptions {
  /** First hour shown on the grid, e.g. 6 for a 6–23 grid. */
  startHour: number;
  /** Hours shown on the grid. */
  totalHours: number;
  /** Pixels per quarter hour, needed to scroll the block into view. */
  quarterHeight: number;
  /** The scrolling container holding the grid. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Called when the user confirms the block. */
  onCreate: (startTime: string, endTime: string) => void;
  /** Block length in quarter hours (default one hour). */
  sizeQuarters?: number;
  /**
   * Called for ArrowLeft/ArrowRight. Return true if the key was handled, so
   * the caller can move between day columns without the cursor reacting.
   */
  onHorizontal?: (delta: -1 | 1) => boolean;
}

export interface SlotCursorState {
  /** The block the user is positioning. */
  cursor: SlotCursor;
  /** "HH:MM" for both ends. */
  times: { startTime: string; endTime: string };
  /** Key handler for the focusable cursor button. */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Confirm the block — opens the create form. */
  create: () => void;
  /** Pixels: the block's top offset and height within the grid. */
  geometry: { top: number; height: number };
}

/**
 * Keyboard cursor for the calendar grid: a movable block of time that the user
 * positions with the arrow keys and turns into a time entry with Enter. This
 * is the keyboard equivalent of drag-to-create, which only ever worked with a
 * mouse.
 *
 * Up/Down moves the block, Shift+Up/Down changes its length, Enter creates.
 */
export function useSlotCursor(options: SlotCursorOptions): SlotCursorState {
  const {
    startHour,
    totalHours,
    quarterHeight,
    scrollRef,
    onCreate,
    sizeQuarters = DEFAULT_SIZE_QUARTERS,
    onHorizontal,
  } = options;

  const totalQuarters = totalHours * 4;
  // The cursor exists from mount, sitting at the current time, so the block is
  // visible before the user ever presses a key.
  const [cursor, setCursor] = useState<SlotCursor>(() =>
    initialSlotCursor(new Date(), startHour, totalQuarters, sizeQuarters),
  );

  // Callbacks are read through refs so the key handler stays stable and the
  // grid does not re-render on every parent render.
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const onHorizontalRef = useRef(onHorizontal);
  onHorizontalRef.current = onHorizontal;

  // Keep the block visible when the user moves it past the edge of the
  // scrolled viewport.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = cursor.startQ * quarterHeight;
    const bottom = cursor.endQ * quarterHeight;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight;
    }
  }, [cursor, quarterHeight, scrollRef]);

  const create = useCallback(() => {
    const { startTime, endTime } = slotCursorToTimes(cursor, startHour);
    onCreateRef.current(startTime, endTime);
  }, [cursor, startHour]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const vertical = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      const horizontal =
        e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;

      if (horizontal !== 0) {
        if (onHorizontalRef.current?.(horizontal) === true) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const { startTime, endTime } = slotCursorToTimes(cursor, startHour);
        onCreateRef.current(startTime, endTime);
        return;
      }

      if (vertical === 0) return;
      e.preventDefault();

      setCursor((prev) =>
        e.shiftKey
          ? resizeSlotCursor(prev, vertical, totalQuarters)
          : moveSlotCursor(prev, vertical, totalQuarters),
      );
    },
    [cursor, totalQuarters, startHour],
  );

  const geometry = useMemo(
    () => ({
      top: cursor.startQ * quarterHeight,
      height: Math.max((cursor.endQ - cursor.startQ) * quarterHeight, 8),
    }),
    [cursor, quarterHeight],
  );

  return {
    cursor,
    times: slotCursorToTimes(cursor, startHour),
    handleKeyDown,
    create,
    geometry,
  };
}
