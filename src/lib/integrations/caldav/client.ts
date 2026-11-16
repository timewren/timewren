/**
 * Tynd, read-only CalDAV-klient oven på tsdav (MIT).
 *
 * TimeTrack læser kun fra CalDAV — der findes bevidst ingen skrivemetoder
 * her (#676). Klienten er isoleret bag `CalDavSource`, så synk-logikken kan
 * testes uden netværk.
 */

import { createDAVClient } from "tsdav";
import { syncT } from "@/i18n/sync-text";

export const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";

/** Timeout pr. CalDAV-kald — iCloud kan hænge ved overbelastning */
const REQUEST_TIMEOUT_MS = 20_000;

export interface CalDavCredentials {
  username: string;
  password: string;
}

export interface RemoteCalendar {
  url: string;
  displayName: string;
  color: string | null;
  ctag: string | null;
}

export interface RemoteCalendarObject {
  url: string;
  etag: string | null;
  data: string;
}

export interface CalDavSource {
  listCalendars(): Promise<RemoteCalendar[]>;
  fetchObjects(
    calendarUrl: string,
    range: { start: Date; end: Date },
  ): Promise<RemoteCalendarObject[]>;
}

export type CalDavErrorKind = "auth" | "network" | "unknown";

/** Fejl med klassifikation, så UI kan vise "forbind igen" ved auth-fejl */
export class CalDavError extends Error {
  constructor(
    public readonly kind: CalDavErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CalDavError";
  }
}

/** Standardtekster (dansk); `classifyCalDavError` bruger kaldets sprog. */
export const CALDAV_AUTH_ERROR_MESSAGE = syncT("integrations.caldav.auth");
export const CALDAV_NETWORK_ERROR_MESSAGE = syncT(
  "integrations.caldav.network",
);

export function classifyCalDavError(error: unknown): CalDavError {
  if (error instanceof CalDavError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid credentials|\b401\b|unauthorized/i.test(message)) {
    return new CalDavError("auth", syncT("integrations.caldav.auth"), {
      cause: error,
    });
  }
  if (
    /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout|aborted|\b5\d\d\b/i.test(
      message,
    )
  ) {
    return new CalDavError("network", syncT("integrations.caldav.network"), {
      cause: error,
    });
  }
  return new CalDavError(
    "unknown",
    syncT("integrations.caldav.unknown", { message }),
    { cause: error },
  );
}

/**
 * Kun HTTPS-URL'er på iCloud-domæner må få brugerens credentials. Kalender-
 * URL'er kommer fra serveren og gemmes i DB; tjekket forhindrer at en
 * manipuleret URL sender Basic-auth til en fremmed host (SSRF/credential-læk).
 */
export function isAllowedICloudUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "caldav.icloud.com" ||
        parsed.hostname.endsWith(".icloud.com"))
    );
  } catch {
    return false;
  }
}

function toText(value: unknown): string | null {
  // tsdav konverterer rene tal-strenge (fx en ctag) til number
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    const obj = value as { _cdata?: unknown; _text?: unknown };
    if (typeof obj._cdata === "string") return obj._cdata.trim() || null;
    if (typeof obj._text === "string") return obj._text.trim() || null;
  }
  return null;
}

/** Apple sender farver som #RRGGBBAA — kolonnen rummer kun #RRGGBB */
export function normalizeCalendarColor(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const match = /^#([0-9a-f]{6})/i.exec(text);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function withTimeout(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) =>
    fetchImpl(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
}

/**
 * Log ind og returnér en read-only kilde. Kaster `CalDavError` (kind "auth")
 * ved forkert Apple-ID eller app-specifikt password.
 */
export async function createCalDavSource(
  credentials: CalDavCredentials,
  options: { serverUrl?: string; fetch?: typeof fetch } = {},
): Promise<CalDavSource> {
  const fetchImpl = withTimeout(options.fetch ?? globalThis.fetch);
  let client: Awaited<ReturnType<typeof createDAVClient>>;
  try {
    client = await createDAVClient({
      serverUrl: options.serverUrl ?? ICLOUD_CALDAV_URL,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
      fetch: fetchImpl,
    });
  } catch (error) {
    throw classifyCalDavError(error);
  }

  return {
    async listCalendars() {
      try {
        const calendars = await client.fetchCalendars();
        return calendars
          .filter(
            (cal) =>
              !cal.components?.length || cal.components.includes("VEVENT"),
          )
          .map((cal) => ({
            url: cal.url,
            displayName: toText(cal.displayName) ?? "Kalender uden navn",
            color: normalizeCalendarColor(cal.calendarColor),
            ctag: toText(cal.ctag),
          }));
      } catch (error) {
        throw classifyCalDavError(error);
      }
    },

    async fetchObjects(calendarUrl, range) {
      // Egen calendar-query i stedet for tsdav's fetchCalendarObjects: den
      // filtrerer fejlsvar (fx 401) væk og returnerer en tom liste, hvilket
      // ville ligne "alle hændelser slettet".
      let responses: Awaited<ReturnType<typeof client.calendarQuery>>;
      try {
        responses = await client.calendarQuery({
          url: calendarUrl,
          props: { "d:getetag": {}, "c:calendar-data": {} },
          filters: [
            {
              "comp-filter": {
                _attributes: { name: "VCALENDAR" },
                "comp-filter": {
                  _attributes: { name: "VEVENT" },
                  "time-range": {
                    _attributes: {
                      start: toCalDavTimestamp(range.start),
                      end: toCalDavTimestamp(range.end),
                    },
                  },
                },
              },
            },
          ] as unknown as Record<string, unknown>,
          depth: "1",
        });
      } catch (error) {
        throw classifyCalDavError(error);
      }
      return parseCalendarQueryResponses(responses, calendarUrl);
    },
  };
}

/** CalDAV time-range-format: 20260930T120000Z */
export function toCalDavTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

interface CalendarQueryResponse {
  href?: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  props?: Record<string, unknown>;
}

/**
 * Omsæt tsdav's multistatus-svar til kalenderobjekter. Et svar uden props
 * (hele requesten fejlede) kastes som fejl, så synken aldrig tolker en
 * afvist request som en tom kalender.
 */
export function parseCalendarQueryResponses(
  responses: CalendarQueryResponse[],
  calendarUrl: string,
): RemoteCalendarObject[] {
  const failed = responses.find((r) => !r.ok && !r.props);
  if (failed) {
    throw classifyCalDavError(
      new Error(
        `CalDAV REPORT returned ${failed.status ?? "?"} ${failed.statusText ?? ""}`.trim(),
      ),
    );
  }
  const objects: RemoteCalendarObject[] = [];
  for (const response of responses) {
    if (!response.ok || !response.href) continue;
    const data = toText(response.props?.calendarData);
    if (!data) continue;
    objects.push({
      url: new URL(response.href, calendarUrl).href,
      etag: toText(response.props?.getetag),
      data,
    });
  }
  return objects;
}
