/**
 * Quarter-hour math for the calendar's keyboard cursor.
 *
 * The grid shows hours, but the cursor moves in 15-minute steps, so all
 * positions are kept as quarter-hours ("q") counted from the grid's start
 * hour. Keeping it a plain integer avoids float drift when a user holds an
 * arrow key down for a few seconds.
 */

export const QUARTERS_PER_HOUR = 4;

/** A block of time on the grid, in quarter-hours from the grid's start hour. */
export interface SlotCursor {
  /** Quarter-hours from the start hour to the block's first quarter. */
  startQ: number;
  /** Quarter-hours from the start hour to the block's end (exclusive). */
  endQ: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The cursor's first position: the current time, snapped to a quarter hour.
 * When the current time is outside the visible range (early morning, or a
 * future day viewed at the current time) it clamps to the nearest edge, and
 * the block always fits inside the grid.
 */
export function initialSlotCursor(
  now: Date,
  startHour: number,
  totalQuarters: number,
  sizeQuarters: number,
): SlotCursor {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const raw = (minutes - startHour * 60) / 15;
  const size = Math.min(sizeQuarters, totalQuarters);
  const startQ = clamp(Math.round(raw), 0, Math.max(0, totalQuarters - size));
  return { startQ, endQ: startQ + size };
}

/** Move the whole block, keeping its length. */
export function moveSlotCursor(
  cursor: SlotCursor,
  deltaQ: number,
  totalQuarters: number,
): SlotCursor {
  const size = cursor.endQ - cursor.startQ;
  const startQ = clamp(
    cursor.startQ + deltaQ,
    0,
    Math.max(0, totalQuarters - size),
  );
  return { startQ, endQ: startQ + size };
}

/**
 * Move only the end of the block, so its length changes. A block is always at
 * least one quarter hour — a zero-length entry has no meaning.
 */
export function resizeSlotCursor(
  cursor: SlotCursor,
  deltaQ: number,
  totalQuarters: number,
): SlotCursor {
  const endQ = clamp(
    cursor.endQ + deltaQ,
    cursor.startQ + 1,
    Math.max(cursor.startQ + 1, totalQuarters),
  );
  return { startQ: cursor.startQ, endQ };
}

/** "8.5" → "08:30". Rounding to whole minutes first means "08:59.9" can
 * never turn into the non-existent "09:60". */
export function formatQuarterTime(
  quartersFromStart: number,
  startHour: number,
): string {
  const totalMinutes = Math.round(
    (startHour * 60 + quartersFromStart * 15) as number,
  );
  const safe = totalMinutes < 0 ? 0 : totalMinutes;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** The cursor as the "HH:MM" strings the create form expects. */
export function slotCursorToTimes(
  cursor: SlotCursor,
  startHour: number,
): { startTime: string; endTime: string } {
  return {
    startTime: formatQuarterTime(cursor.startQ, startHour),
    endTime: formatQuarterTime(cursor.endQ, startHour),
  };
}
