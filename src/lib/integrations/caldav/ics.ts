/**
 * Parsing af iCalendar-objekter (RFC 5545) fra CalDAV-servere som iCloud.
 *
 * Hvert CalDAV-objekt er én VCALENDAR med én master-VEVENT og evt.
 * undtagelser (RECURRENCE-ID). Gentagelser udfoldes her i stedet for via
 * CalDAV's <expand>, fordi ikke alle servere (bl.a. iCloud) understøtter det
 * stabilt. Resultatet er flade hændelser i UTC, klar til calendar_events.
 */
import { createHash } from "node:crypto";
import ICAL from "ical.js";

/** Tidszone for "flydende" tider uden TZID (samme default som resten af appen). */
const DEFAULT_TIMEZONE = "Europe/Copenhagen";
/** Loft over udfoldede forekomster pr. objekt — beskytter mod uendelige RRULE'er. */
const MAX_OCCURRENCES = 500;
/** Loft over gennemløb af RRULE (daglige serier fra mange år tilbage) */
const MAX_ITERATIONS = 20_000;

export type CalDavResponseStatus =
  | "accepted"
  | "declined"
  | "tentative"
  | "needsAction";

export interface ParsedCalDavEvent {
  /** Stabil nøgle pr. forekomst — gemmes som calendar_events.external_id */
  externalId: string;
  uid: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  timezone: string | null;
  isCancelled: boolean;
  responseStatus: CalDavResponseStatus | null;
}

export interface ParseOptions {
  rangeStart: Date;
  rangeEnd: Date;
  /** Brugerens egne adresser (Apple-ID m.fl.) til at finde egen deltagerstatus */
  selfEmails?: string[];
}

const PARTSTAT_MAP: Record<string, CalDavResponseStatus> = {
  ACCEPTED: "accepted",
  DECLINED: "declined",
  TENTATIVE: "tentative",
  "NEEDS-ACTION": "needsAction",
};

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Omregn en vægurs-tid i en IANA-tidszone til UTC. Bruges når objektet
 * refererer til en TZID uden medfølgende VTIMEZONE, eller til flydende tider.
 */
export function zonedWallTimeToUtc(
  wall: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  },
  timeZone: string,
): Date {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const firstOffset = tzOffsetMs(guess, tz);
  let utc = guess - firstOffset;
  const secondOffset = tzOffsetMs(utc, tz);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return new Date(utc);
}

function toUtcDate(time: ICAL.Time, fallbackTzid: string | null): Date {
  if (time.isDate) {
    // Heldagsdatoer gemmes som UTC-midnat — samme form som Google-synken
    // (new Date("YYYY-MM-DD")).
    return new Date(Date.UTC(time.year, time.month - 1, time.day));
  }
  if (time.zone && time.zone !== ICAL.Timezone.localTimezone) {
    // UTC eller en TZID med medfølgende VTIMEZONE
    return time.toJSDate();
  }
  return zonedWallTimeToUtc(time, fallbackTzid ?? DEFAULT_TIMEZONE);
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildExternalId(uid: string, occurrence: Date | null): string {
  const raw = occurrence ? `${uid}@${occurrence.toISOString()}` : uid;
  const key = `caldav:${raw}`;
  if (key.length <= 255) return key;
  return `caldav:sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function findResponseStatus(
  vevent: ICAL.Component,
  selfEmails: string[],
): CalDavResponseStatus | null {
  if (selfEmails.length === 0) return null;
  const wanted = new Set(selfEmails.map((e) => e.trim().toLowerCase()));
  for (const attendee of vevent.getAllProperties("attendee")) {
    const value = String(attendee.getFirstValue() ?? "").toLowerCase();
    const email = value.replace(/^mailto:/, "");
    if (!wanted.has(email)) continue;
    const partstat = attendee.getParameter("partstat");
    const key = typeof partstat === "string" ? partstat.toUpperCase() : "";
    return PARTSTAT_MAP[key] ?? null;
  }
  return null;
}

function tzidOf(vevent: ICAL.Component): string | null {
  const prop = vevent.getFirstProperty("dtstart");
  const tzid = prop?.getParameter("tzid");
  return typeof tzid === "string" ? tzid : null;
}

function beskriv(
  vevent: ICAL.Component,
  start: Date,
  end: Date,
  isAllDay: boolean,
  externalId: string,
  uid: string,
  selfEmails: string[],
): ParsedCalDavEvent {
  const status = String(vevent.getFirstPropertyValue("status") ?? "");
  return {
    externalId,
    uid,
    title: textOrNull(vevent.getFirstPropertyValue("summary")),
    description: textOrNull(vevent.getFirstPropertyValue("description")),
    location: textOrNull(vevent.getFirstPropertyValue("location")),
    startTime: start,
    endTime: end,
    isAllDay,
    timezone: tzidOf(vevent),
    isCancelled: status.toUpperCase() === "CANCELLED",
    responseStatus: findResponseStatus(vevent, selfEmails),
  };
}

/**
 * Parse ét CalDAV-kalenderobjekt til flade hændelser inden for intervallet.
 * Kaster ved ugyldig iCalendar-syntaks — kalderen logger og springer over.
 */
export function parseCalendarObject(
  ics: string,
  options: ParseOptions,
): ParsedCalDavEvent[] {
  const selfEmails = options.selfEmails ?? [];
  const root = new ICAL.Component(ICAL.parse(ics));
  const vevents = root.getAllSubcomponents("vevent");
  if (vevents.length === 0) return [];

  const master =
    vevents.find((v) => !v.hasProperty("recurrence-id")) ?? vevents[0];
  const event = new ICAL.Event(master);
  const uid = event.uid;
  if (!uid) return [];

  for (const exception of vevents) {
    if (exception !== master && exception.hasProperty("recurrence-id")) {
      event.relateException(exception);
    }
  }

  const fallbackTzid = tzidOf(master);
  const rangeStartMs = options.rangeStart.getTime();
  const rangeEndMs = options.rangeEnd.getTime();

  if (!event.isRecurring()) {
    if (!event.startDate) return [];
    const isAllDay = event.startDate.isDate;
    const start = toUtcDate(event.startDate, fallbackTzid);
    const end = event.endDate
      ? toUtcDate(event.endDate, fallbackTzid)
      : new Date(start.getTime() + (isAllDay ? 24 * 60 * 60 * 1000 : 0));
    if (end.getTime() < rangeStartMs || start.getTime() > rangeEndMs) return [];
    return [
      beskriv(
        master,
        start,
        end,
        isAllDay,
        buildExternalId(uid, null),
        uid,
        selfEmails,
      ),
    ];
  }

  const results: ParsedCalDavEvent[] = [];
  const iterator = event.iterator();
  let next = iterator.next();
  let guard = 0;
  while (next && guard < MAX_ITERATIONS) {
    guard++;
    const details = event.getOccurrenceDetails(next);
    const occurrenceTzid = tzidOf(details.item.component) ?? fallbackTzid;
    const isAllDay = details.startDate.isDate;
    const start = toUtcDate(details.startDate, occurrenceTzid);
    const end = toUtcDate(details.endDate, occurrenceTzid);
    const recurrenceStart = toUtcDate(details.recurrenceId, fallbackTzid);

    // Forekomster sorteres efter oprindelig start; en flyttet forekomst kan
    // ligge uden for sin plads, så vi stopper først når den oprindelige
    // start er klart efter intervallet.
    if (recurrenceStart.getTime() > rangeEndMs) break;
    if (end.getTime() >= rangeStartMs && start.getTime() <= rangeEndMs) {
      results.push(
        beskriv(
          details.item.component,
          start,
          end,
          isAllDay,
          buildExternalId(uid, recurrenceStart),
          uid,
          selfEmails,
        ),
      );
      if (results.length >= MAX_OCCURRENCES) break;
    }
    next = iterator.next();
  }
  if (next && guard >= MAX_ITERATIONS) {
    // Serien nåede ikke frem til vinduet — behandles som parse-fejl, så
    // synken ikke tolker det som "ingen hændelser" og aflyser eksisterende
    throw new Error(`RRULE for ${uid} overskred ${MAX_ITERATIONS} gennemløb`);
  }
  return results;
}
