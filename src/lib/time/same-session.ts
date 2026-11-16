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
    endTime: Date | null;
    hours: number;
    projectId: string | null | undefined;
    clientId: string | null | undefined;
  };
}): SameSessionDecision {
  const { existing, incoming } = input;
  if (!existing) return { action: "insert" };
  if (!isSameSessionStart(existing.startTime, incoming.startTime)) {
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

  return {
    action: "merge",
    hours: newCents / 100,
    endTime,
    hoursChanged: newCents !== oldCents,
  };
}
