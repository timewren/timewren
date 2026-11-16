import { formatClientHint, resolveRequestClient } from "@/lib/client-version";
import type { db as dbType } from "@/lib/db";
import { timerEvents } from "@/lib/db/schema";
import type { TimerEventName, TimerEventSource } from "./event-names";

/**
 * Hændelseslog for timeren (stabilitetsprogram A6).
 *
 * `timer_states` er én muterbar række pr. bruger — når en kunde melder "timeren
 * skiftede kunde / sprang i tid / lavede en dublet", er der ellers intet spor
 * af HVILKEN overflade der gjorde hvad, i hvilken rækkefølge. Her logges hver
 * tilstandsovergang og hver afvisning (men ikke vellykkede heartbeats — de er
 * for mange og siger intet).
 *
 * Regler:
 * - Loggen skrives EFTER den atomiske skrivning og indgår aldrig i en guard.
 *   Den læser ikke timer_states for at bestemme noget; klassifikationen bruger
 *   den læsning kalderen allerede har lavet (kan være lidt forældet under et
 *   kapløb — versionerne i loggen er de autoritative).
 * - Den må aldrig fælde brugerens request: fejl sluges og logges til konsollen.
 * - Privatliv: ingen IP, ingen beskrivelsestekst. Kun en grov klient-familie
 *   (fx "chrome/windows", "mobilapp/ios") og id'er.
 */

export {
  TIMER_EVENT_NAMES,
  TIMER_EVENT_RETENTION_DAYS,
  TIMER_REJECTION_EVENTS,
  type TimerEventName,
  type TimerEventSource,
} from "./event-names";

const MAX_HINT_LENGTH = 64;
const MAX_DETAIL_LENGTH = 1000;

/**
 * Grov klient-familie ud fra User-Agent/Origin — aldrig hele strengen, aldrig
 * versionsnumre på browseren. Nok til at skelne fane, extension, mobilapp og
 * desktop ad, ikke nok til at fingeraftrykke nogen.
 *
 * Sender klienten `x-timetrack-client`, foranstilles TimeTrack-klientens
 * egen type og version (`extension@2.5.2 extension/chrome`) — det er ikke
 * et fingeraftryk, men det der afgør om en gammel klient stadig skriver.
 */
export function clientHintFromHeaders(
  headers: Pick<Headers, "get"> | null | undefined,
): string | null {
  if (!headers) return null;
  return formatClientHint(
    resolveRequestClient(headers),
    legacyClientHint(headers),
  );
}

function legacyClientHint(headers: Pick<Headers, "get">): string | null {
  const ua = headers.get("user-agent") ?? "";
  const origin = headers.get("origin") ?? "";

  if (origin.startsWith("chrome-extension://")) return "extension/chrome";
  if (origin.startsWith("moz-extension://")) return "extension/firefox";
  if (origin.startsWith("safari-web-extension://")) return "extension/safari";

  if (!ua) return null;

  const os = /Android/i.test(ua)
    ? "android"
    : /iPhone|iPad|iOS|CFNetwork|Darwin/i.test(ua)
      ? "ios"
      : /Windows/i.test(ua)
        ? "windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "mac"
          : /Linux/i.test(ua)
            ? "linux"
            : "ukendt";

  if (/Expo|okhttp|CFNetwork|TimeTrackApp/i.test(ua)) {
    return `mobilapp/${os === "mac" ? "ios" : os}`;
  }
  if (/Tauri/i.test(ua)) return `desktop-tauri/${os}`;
  if (/Electron/i.test(ua)) return `desktop-electron/${os}`;

  const family = /Edg\//.test(ua)
    ? "edge"
    : /Firefox\//.test(ua)
      ? "firefox"
      : /Chrome\/|CriOS\//.test(ua)
        ? "chrome"
        : /Safari\//.test(ua)
          ? "safari"
          : /curl|node|undici|python|Go-http/i.test(ua)
            ? "script"
            : "andet";
  return `${family}/${os}`.slice(0, MAX_HINT_LENGTH);
}

/**
 * Den overflade der skrev. Mobilappen sender `source: "web"` til timerSync
 * (wire-kompatibilitet), så User-Agent'en afgør det dér.
 */
export function resolveTimerEventSource(
  declared: string | null | undefined,
  clientHint: string | null,
): TimerEventSource {
  if (
    clientHint?.startsWith("mobilapp/") ||
    clientHint?.startsWith("mobile@")
  ) {
    return "mobile";
  }
  if (
    clientHint?.startsWith("desktop-") ||
    clientHint?.startsWith("desktop@")
  ) {
    return "desktop";
  }
  switch (declared) {
    case "extension":
    case "mobile":
    case "desktop":
    case "cron":
    case "api":
      return declared;
    default:
      return "web";
  }
}

/** Hint + kilde for en request i ét kald. */
export function timerEventOrigin(
  headers: Pick<Headers, "get"> | null | undefined,
  declared: string | null | undefined,
): { clientHint: string | null; source: TimerEventSource } {
  const clientHint = clientHintFromHeaders(headers);
  return {
    clientHint,
    source: resolveTimerEventSource(declared, clientHint),
  };
}

export interface TimerSnapshot {
  isRunning: boolean | null;
  startTime: Date | null;
  elapsedSeconds: number | null;
  baseSeconds: number | null;
  projectId: string | null;
  clientId: string | null;
}

/** Spring i starttid/basetid over denne grænse logges som `time_change`. */
const TIME_JUMP_TOLERANCE_SECONDS = 60;

/**
 * Hvilken overgang er en VELLYKKET timer-skrivning? `null` = intet at logge
 * (typisk et heartbeat der bare holder en uændret timer i live).
 *
 * `prev` er kalderens læsning før skrivningen, `next` den tilstand der blev
 * skrevet (for delvise opdateringer: flettet med `prev`).
 */
export function classifyTimerWrite(
  prev: TimerSnapshot | null | undefined,
  next: TimerSnapshot,
): TimerEventName | null {
  const prevRunning = !!prev?.isRunning;
  const assignmentChanged =
    !!prev &&
    ((prev.projectId ?? null) !== (next.projectId ?? null) ||
      (prev.clientId ?? null) !== (next.clientId ?? null));

  if (next.isRunning) {
    if (!prevRunning) {
      return (next.baseSeconds ?? 0) > 0 ? "resume" : "start";
    }
    if (assignmentChanged) return "client_change";
    const prevStart = prev?.startTime?.getTime() ?? null;
    const nextStart = next.startTime?.getTime() ?? null;
    const startJump =
      prevStart !== null && nextStart !== null
        ? Math.abs(prevStart - nextStart) / 1000
        : prevStart === nextStart
          ? 0
          : Number.POSITIVE_INFINITY;
    const baseJump = Math.abs(
      (prev?.baseSeconds ?? 0) - (next.baseSeconds ?? 0),
    );
    if (
      startJump > TIME_JUMP_TOLERANCE_SECONDS ||
      baseJump > TIME_JUMP_TOLERANCE_SECONDS
    ) {
      return "time_change";
    }
    return null;
  }

  const carriesTime =
    (next.elapsedSeconds ?? 0) > 0 || (next.baseSeconds ?? 0) > 0;
  if (carriesTime) {
    if (prevRunning) return "pause";
    return assignmentChanged ? "client_change" : null;
  }

  const prevHadSomething =
    !!prev &&
    (prevRunning ||
      (prev.elapsedSeconds ?? 0) > 0 ||
      (prev.baseSeconds ?? 0) > 0 ||
      !!prev.projectId ||
      !!prev.clientId);
  if (prevHadSomething) {
    // En pause efter 0 sekunder beholder projekt/kunde — det er en pause,
    // ikke en nulstilling.
    if (prevRunning && (next.projectId || next.clientId)) return "pause";
    return "clear";
  }
  return assignmentChanged ? "client_change" : null;
}

export interface TimerEventInput {
  userId: string;
  organizationId?: string | null;
  event: TimerEventName;
  source: TimerEventSource;
  clientHint?: string | null;
  versionBefore?: number | null;
  versionAfter?: number | null;
  startTime?: Date | null;
  baseSeconds?: number | null;
  projectId?: string | null;
  clientId?: string | null;
  detail?: Record<string, unknown> | null;
}

function compactDetail(
  detail: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!detail) return null;
  const entries = Object.entries(detail).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  const compact = Object.fromEntries(entries);
  try {
    if (JSON.stringify(compact).length > MAX_DETAIL_LENGTH) {
      return { truncated: true, keys: Object.keys(compact).slice(0, 20) };
    }
  } catch {
    return { unserializable: true };
  }
  return compact;
}

/** Den række der indsættes — ren funktion, så den kan testes. */
export function buildTimerEventRow(input: TimerEventInput) {
  return {
    userId: input.userId,
    organizationId: input.organizationId ?? null,
    event: input.event,
    source: input.source,
    clientHint: input.clientHint
      ? input.clientHint.slice(0, MAX_HINT_LENGTH)
      : null,
    versionBefore: input.versionBefore ?? null,
    versionAfter: input.versionAfter ?? null,
    startTime:
      input.startTime && !Number.isNaN(input.startTime.getTime())
        ? input.startTime
        : null,
    baseSeconds:
      input.baseSeconds === null || input.baseSeconds === undefined
        ? null
        : Math.max(0, Math.round(input.baseSeconds)),
    projectId: input.projectId ?? null,
    clientId: input.clientId ?? null,
    detail: compactDetail(input.detail),
  };
}

type InsertCapable = Pick<typeof dbType, "insert">;

/**
 * Skriv én hændelse. Afventes af kalderen (så den lander i samme request),
 * men kaster ALDRIG — en fejlet log må ikke fælde et timer-stop.
 */
export async function logTimerEvent(
  database: InsertCapable,
  input: TimerEventInput,
): Promise<void> {
  try {
    await database.insert(timerEvents).values(buildTimerEventRow(input));
  } catch (err) {
    console.error(
      `[TimerEvents] ${input.event} kunne ikke gemmes:`,
      err instanceof Error ? err.message : err,
    );
  }
}
