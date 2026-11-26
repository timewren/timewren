import { toCopenhagenDateStr } from "@/lib/time/copenhagen";
import { timerEntryStart } from "@/lib/timer/entry-span";
import { isBilledLocked } from "./billed-lock";

/**
 * Én timer-session = én tidspost (kunde A 1/10).
 *
 * Samme session blev i prod gemt 2–3 gange som separate poster med samme
 * start (±1 s) og senere slut — hver gang en genopstanden timer blev stoppet
 * igen. Sikkerhedsnettet: når en timer-gemning har en starttid inden for
 * ±2 s af en eksisterende post fra samme bruger, er det samme session. Den
 * seneste gemning indeholder hele sessionen, så den eksisterende post
 * forlænges (slut = max, timer = max) i stedet for at få en dublet.
 *
 * Det er KUN samme session, når også projekt og kunde er de samme, den
 * eksisterende post stammer fra en timer (ikke kalender/import/
 * tilbagevendende/API), og den nye gemning slutter samtidig med eller efter
 * den eksisterende (en gen-gemning indeholder hele sessionen). Ellers er det
 * to bevidste poster med samme start — fx to kalenderposter for hver sin
 * kunde — og der indsættes som hidtil.
 *
 * Faktureret/låst post: rør den ikke — fald tilbage til en ny post som hidtil.
 */
export const SAME_SESSION_START_TOLERANCE_MS = 2000;

/**
 * Kilder en timer-gemning lander med: extensionens stop (`auto_track`),
 * web/mobilens timer-stop via time.create (`manual`) og extensionens
 * quickStop (`timer`).
 */
export const TIMER_ENTRY_SOURCES: readonly string[] = [
  "auto_track",
  "manual",
  "timer",
];

function sameId(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a || null) === (b || null);
}

/**
 * Samme projekt og kunde, null-sikkert. På samme projekt er kunden givet af
 * projektet: web gemmer projekt-poster uden kunde-id, extensionen med
 * projektets kunde — en manglende kunde-id er derfor ikke en anden kunde.
 */
function sameOwner(
  a: {
    projectId: string | null | undefined;
    clientId: string | null | undefined;
  },
  b: {
    projectId: string | null | undefined;
    clientId: string | null | undefined;
  },
): boolean {
  if (!sameId(a.projectId, b.projectId)) return false;
  if (a.projectId && (!a.clientId || !b.clientId)) return true;
  return sameId(a.clientId, b.clientId);
}

export function isSameSessionStart(
  a: Date | null | undefined,
  b: Date | null | undefined,
): boolean {
  if (!a || !b) return false;
  return Math.abs(a.getTime() - b.getTime()) <= SAME_SESSION_START_TOLERANCE_MS;
}

/**
 * En timer-gemning, hvis start er normaliseret til slut − timer
 * (lib/timer/entry-span.ts), har en start der afhænger af det afrundede
 * timetal: timer gemmes i hundrededele (±18 s), så to gemninger af samme
 * session kan ligge op til 36 s fra hinanden.
 */
export const NORMALIZED_START_TOLERANCE_MS =
  SAME_SESSION_START_TOLERANCE_MS + 36_000;

/**
 * Starttids-vinduerne en eksisterende post fra samme session kan stå i: den
 * start klienten sendte (±2 s), og — er den flyttet af normaliseringen — den
 * normaliserede start (±38 s).
 */
export function sessionStartWindows(incoming: {
  startTime: Date;
  clientStartTime?: Date | null;
}): Array<[Date, Date]> {
  const window = (at: Date, ms: number): [Date, Date] => [
    new Date(at.getTime() - ms),
    new Date(at.getTime() + ms),
  ];
  const client = incoming.clientStartTime;
  if (!client || client.getTime() === incoming.startTime.getTime()) {
    return [window(incoming.startTime, SAME_SESSION_START_TOLERANCE_MS)];
  }
  return [
    window(client, SAME_SESSION_START_TOLERANCE_MS),
    window(incoming.startTime, NORMALIZED_START_TOLERANCE_MS),
  ];
}

function inSessionStartWindow(
  existing: Date | null | undefined,
  incoming: { startTime: Date; clientStartTime?: Date | null },
): boolean {
  if (!existing) return false;
  const t = existing.getTime();
  return sessionStartWindows(incoming).some(
    ([from, to]) => t >= from.getTime() && t <= to.getTime(),
  );
}

/** `time_entries.hours` er numeric(5,2): sammenlign og gem i hundrededele. */
function toCents(hours: number): number {
  return Math.round(hours * 100);
}

export type SameSessionDecision =
  | { action: "insert" }
  | {
      action: "merge";
      /** Postens nye timetal (max af eksisterende og indkommende). */
      hours: number;
      endTime: Date | null;
      /** Postens start — flyttet, hvis timetallet ellers ikke kan rummes. */
      startTime: Date | null;
      /** Ændres timetallet? Kun da skal klippekort/opgave/godkendelse følge. */
      hoursChanged: boolean;
    };

export function decideSameSessionMerge(input: {
  existing: {
    startTime: Date | null;
    endTime: Date | null;
    hours: string | number;
    isBilled: boolean | null;
    invoiceId?: string | null;
    projectId: string | null;
    clientId: string | null;
    source: string | null;
  } | null;
  /** Periodelås/ugestatus o.l. — afgjort af kalderen. */
  existingLocked: boolean;
  incoming: {
    startTime: Date;
    /** Klientens start, når normaliseringen har flyttet den (se ovenfor). */
    clientStartTime?: Date | null;
    endTime: Date | null;
    hours: number;
    projectId: string | null | undefined;
    clientId: string | null | undefined;
  };
}): SameSessionDecision {
  const { existing, incoming } = input;
  if (!existing) return { action: "insert" };
  if (!inSessionStartWindow(existing.startTime, incoming)) {
    return { action: "insert" };
  }
  if (!sameOwner(existing, incoming)) {
    return { action: "insert" };
  }
  if (!TIMER_ENTRY_SOURCES.includes(existing.source ?? "manual")) {
    return { action: "insert" };
  }
  // En gen-gemning af samme session slutter samtidig med eller senere.
  if (
    !incoming.endTime ||
    (existing.endTime &&
      incoming.endTime.getTime() < existing.endTime.getTime())
  ) {
    return { action: "insert" };
  }
  if (input.existingLocked || isBilledLocked(existing)) {
    return { action: "insert" };
  }

  const oldCents = toCents(Number(existing.hours));
  const newCents = Math.max(oldCents, toCents(incoming.hours));
  const endTime = incoming.endTime;
  const hours = newCents / 100;

  return {
    action: "merge",
    hours,
    endTime,
    startTime: mergedStartTime(existing.startTime, endTime, hours),
    hoursChanged: newCents !== oldCents,
  };
}

/**
 * Den forlængede posts start: uændret, medmindre det nye timetal ikke kan
 * rummes i tidsrummet (lib/timer/entry-span.ts). Så flyttes starten til
 * slut − timer, men kun inden for postens danske dag — datoen følger ikke med
 * ved en sammenlægning (periodelåsen er tjekket på den eksisterende dato).
 */
function mergedStartTime(
  start: Date | null,
  end: Date | null,
  hours: number,
): Date | null {
  const next = timerEntryStart({ startTime: start, endTime: end, hours });
  if (!start || !next || next.getTime() === start.getTime()) return start;
  return toCopenhagenDateStr(next) === toCopenhagenDateStr(start)
    ? next
    : start;
}
