/**
 * Ren planlægning af en CalDAV-synk: sammenlign hændelser fra serveren med
 * dem vi allerede har i calendar_events og returnér hvad der skal indsættes,
 * opdateres og markeres aflyst. Ingen DB — så logikken kan unit-testes.
 */
import { passesFilters, type SyncFilters } from "@/lib/calendar/sync-filters";
import type { ParsedCalDavEvent } from "./ics";

export type PrivacyMode = "off" | "mask_titles" | "mask_all";

export interface ExistingCalDavEvent {
  id: string;
  externalId: string | null;
  externalEtag: string | null;
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean | null;
  responseStatus: string | null;
  isCancelled: boolean | null;
}

export interface IncomingCalDavEvent extends ParsedCalDavEvent {
  etag: string | null;
}

export interface CalDavEventValues {
  externalId: string;
  externalEtag: string | null;
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  timezone: string | null;
  responseStatus: string | null;
  isCancelled: boolean;
}

export interface CalDavSyncPlan {
  inserts: CalDavEventValues[];
  updates: { id: string; values: CalDavEventValues }[];
  cancels: string[];
  filtered: number;
}

const MASKED_TITLE = "Optaget";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Map til Googles event-form, så de fælles synk-filtre kan genbruges */
function toFilterShape(event: ParsedCalDavEvent) {
  return {
    summary: event.title,
    start: event.isAllDay
      ? { date: isoDate(event.startTime) }
      : { dateTime: event.startTime.toISOString() },
    end: event.isAllDay
      ? { date: isoDate(event.endTime) }
      : { dateTime: event.endTime.toISOString() },
    attendees: event.responseStatus
      ? [{ self: true, responseStatus: event.responseStatus }]
      : undefined,
  };
}

export function toEventValues(
  event: IncomingCalDavEvent,
  privacyMode: PrivacyMode,
): CalDavEventValues {
  const masked = privacyMode === "mask_titles" || privacyMode === "mask_all";
  return {
    externalId: event.externalId,
    externalEtag: event.etag,
    title: masked ? MASKED_TITLE : (event.title ?? "Uden titel").slice(0, 255),
    description: masked ? null : event.description,
    location: masked ? null : (event.location?.slice(0, 255) ?? null),
    startTime: event.startTime,
    endTime: event.endTime,
    isAllDay: event.isAllDay,
    timezone: event.timezone?.slice(0, 50) ?? null,
    responseStatus: event.responseStatus,
    isCancelled: false,
  };
}

function differs(existing: ExistingCalDavEvent, next: CalDavEventValues) {
  return (
    existing.title !== next.title ||
    existing.description !== next.description ||
    existing.location !== next.location ||
    existing.startTime.getTime() !== next.startTime.getTime() ||
    existing.endTime.getTime() !== next.endTime.getTime() ||
    Boolean(existing.isAllDay) !== next.isAllDay ||
    existing.responseStatus !== next.responseStatus ||
    Boolean(existing.isCancelled) ||
    existing.externalEtag !== next.externalEtag
  );
}

/**
 * @param existing hændelser for forbindelsen inden for synk-vinduet
 * @param incoming alle hændelser serveren returnerede for samme vindue
 */
export function planCalDavSync(
  existing: ExistingCalDavEvent[],
  incoming: IncomingCalDavEvent[],
  settings: {
    privacyMode: PrivacyMode;
    filters: SyncFilters | null;
    /**
     * false når et eller flere objekter ikke kunne læses: så ved vi ikke,
     * om en manglende hændelse er slettet, og lader den stå.
     */
    cancelMissing?: boolean;
  },
): CalDavSyncPlan {
  const plan: CalDavSyncPlan = {
    inserts: [],
    updates: [],
    cancels: [],
    filtered: 0,
  };
  const existingByKey = new Map<string, ExistingCalDavEvent>();
  for (const event of existing) {
    if (event.externalId) existingByKey.set(event.externalId, event);
  }

  const seen = new Set<string>();
  for (const event of incoming) {
    if (seen.has(event.externalId)) continue;
    seen.add(event.externalId);
    const current = existingByKey.get(event.externalId);

    if (event.isCancelled) {
      if (current && !current.isCancelled) plan.cancels.push(current.id);
      continue;
    }
    // Samme regel som Google: nye hændelser uden titel springes over
    if (!event.title && !current) continue;
    if (!passesFilters(toFilterShape(event), settings.filters)) {
      plan.filtered++;
      // En hændelse der nu filtreres fra, skal ikke blive hængende
      if (current && !current.isCancelled) plan.cancels.push(current.id);
      continue;
    }

    const values = toEventValues(event, settings.privacyMode);
    if (!current) {
      plan.inserts.push(values);
    } else if (differs(current, values)) {
      plan.updates.push({ id: current.id, values });
    }
  }

  // Slettet i iCloud (eller flyttet ud af vinduet): markér som aflyst, så
  // evt. koblede tidsregistreringer bevares, men hændelsen forsvinder.
  if (settings.cancelMissing === false) return plan;
  for (const event of existing) {
    if (!event.externalId || seen.has(event.externalId)) continue;
    if (!event.isCancelled) plan.cancels.push(event.id);
  }

  return plan;
}
