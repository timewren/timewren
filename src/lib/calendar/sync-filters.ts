/**
 * Synk-filtre for eksterne kalendere (Google og CalDAV/iCloud).
 * Hændelser beskrives i Googles form; CalDAV-synken mapper til samme form.
 */

export interface SyncFilters {
  ignoreWords?: string[];
  minDurationMinutes?: number;
  ignoreAllDay?: boolean;
  onlyAccepted?: boolean;
}

/**
 * Check if an event passes the user's sync filters
 */
export function passesFilters(
  event: {
    summary?: string | null;
    start?: { dateTime?: string | null; date?: string | null };
    end?: { dateTime?: string | null; date?: string | null };
    attendees?: { self?: boolean; responseStatus?: string }[];
  },
  filters: SyncFilters | null,
): boolean {
  if (!filters) return true;

  const title = (event.summary || "").toLowerCase();

  // Ignore words filter
  if (filters.ignoreWords?.length) {
    for (const word of filters.ignoreWords) {
      if (title.includes(word.toLowerCase())) return false;
    }
  }

  // Ignore all-day events
  if (filters.ignoreAllDay && !event.start?.dateTime) return false;

  // Minimum duration filter
  if (
    filters.minDurationMinutes &&
    event.start?.dateTime &&
    event.end?.dateTime
  ) {
    const durationMs =
      new Date(event.end.dateTime).getTime() -
      new Date(event.start.dateTime).getTime();
    if (durationMs < filters.minDurationMinutes * 60 * 1000) return false;
  }

  // Only accepted events
  if (filters.onlyAccepted && event.attendees) {
    const self = event.attendees.find((a) => a.self);
    if (self && self.responseStatus === "declined") return false;
  }

  return true;
}
