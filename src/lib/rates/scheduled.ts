/**
 * Planlagte satsændringer — rene funktioner til dato-bevidst sats-opslag.
 *
 * En klient eller et projekt kan have en ny timepris der gælder fra en dato
 * (fx 600 → 800 kr/t pr. 1. november). Tidsposter stemples efter deres egen
 * dato, ikke efter hvornår de oprettes, så tid registreret bagud får den sats
 * der gjaldt på dagen.
 *
 * Reglerne for én klient/ét projekt og en post dateret D:
 *   a. Findes en ikke-annulleret, IKKE-anvendt ændring med effectiveDate ≤ D,
 *      bruges newRate fra den seneste af dem.
 *   b. Ellers: findes en ANVENDT ændring med effectiveDate > D, ligger posten
 *      før skiftet, og oldRate fra den tidligste af dem bruges.
 *   c. Ellers den nuværende sats.
 *
 * Datoer sammenlignes som "YYYY-MM-DD"-strenge i dansk tid.
 */

export const RATE_TIME_ZONE = "Europe/Copenhagen";

export interface ScheduledRateChangeLite {
  id: string;
  clientId: string | null;
  projectId: string | null;
  newRate: string;
  oldRate: string | null;
  /** "YYYY-MM-DD" */
  effectiveDate: string;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const copenhagenDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: RATE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Datoen (YYYY-MM-DD) et tidspunkt falder på i dansk tid. */
export function copenhagenDateKey(date: Date): string {
  // en-CA formaterer som YYYY-MM-DD
  return copenhagenDateFormat.format(date);
}

/** Dagens dato i dansk tid (YYYY-MM-DD). */
export function copenhagenToday(now: Date = new Date()): string {
  return copenhagenDateKey(now);
}

/**
 * Normalisér en posts dato til "YYYY-MM-DD".
 *
 * Rene datostrenge bruges som de er. Tidsposters `date` gemmes som timestamp
 * (typisk UTC-midnat, men timer-, kalender- og importposter kan have et
 * klokkeslæt), så Date-værdier læses i dansk tid — samme dag som brugeren ser
 * i UI'et. Returnerer undefined for ugyldige værdier.
 */
export function toRateDateKey(
  value: string | Date | null | undefined,
): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    if (DATE_ONLY_RE.test(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? undefined
      : copenhagenDateKey(parsed);
  }
  return Number.isNaN(value.getTime()) ? undefined : copenhagenDateKey(value);
}

function byEffectiveThenCreated(
  a: ScheduledRateChangeLite,
  b: ScheduledRateChangeLite,
): number {
  if (a.effectiveDate !== b.effectiveDate) {
    return a.effectiveDate < b.effectiveDate ? -1 : 1;
  }
  const aOrder = (a.appliedAt ?? a.createdAt).getTime();
  const bOrder = (b.appliedAt ?? b.createdAt).getTime();
  return aOrder - bOrder;
}

/**
 * Satsen for én klient/ét projekt på en given dato.
 *
 * @param changes Ændringer for netop denne klient/dette projekt (andre
 *   ignoreres ikke automatisk — filtrér før kald).
 * @param currentRate Den nuværende sats på klienten/projektet.
 * @param date Postens dato (YYYY-MM-DD). Uden dato bruges den nuværende sats.
 */
export function resolveRateAtDate(
  changes: readonly ScheduledRateChangeLite[],
  currentRate: string | null,
  date: string | undefined,
): string | null {
  if (!date || changes.length === 0) return currentRate;

  const active = changes.filter((c) => !c.cancelledAt);

  // a. Seneste ikke-anvendte ændring der er trådt i kraft på datoen
  const pendingInEffect = active
    .filter((c) => !c.appliedAt && c.effectiveDate <= date)
    .sort(byEffectiveThenCreated);
  if (pendingInEffect.length > 0) {
    return pendingInEffect[pendingInEffect.length - 1].newRate;
  }

  // b. Posten ligger før en allerede anvendt ændring → satsen fra før skiftet
  const appliedAfter = active
    .filter((c) => c.appliedAt && c.effectiveDate > date)
    .sort(byEffectiveThenCreated);
  if (appliedAfter.length > 0) {
    return appliedAfter[0].oldRate;
  }

  // c. Nuværende sats
  return currentRate;
}

export interface ScheduledChangeIndex {
  byClient: Map<string, ScheduledRateChangeLite[]>;
  byProject: Map<string, ScheduledRateChangeLite[]>;
}

/** Gruppér ændringer pr. klient og projekt (annullerede udelades). */
export function indexScheduledChanges(
  changes: readonly ScheduledRateChangeLite[],
): ScheduledChangeIndex {
  const byClient = new Map<string, ScheduledRateChangeLite[]>();
  const byProject = new Map<string, ScheduledRateChangeLite[]>();
  for (const change of changes) {
    if (change.cancelledAt) continue;
    if (change.projectId) {
      const list = byProject.get(change.projectId) ?? [];
      list.push(change);
      byProject.set(change.projectId, list);
    } else if (change.clientId) {
      const list = byClient.get(change.clientId) ?? [];
      list.push(change);
      byClient.set(change.clientId, list);
    }
  }
  return { byClient, byProject };
}

/** Tom indeks — bruges når der ikke er planlagte ændringer. */
export function emptyScheduledChangeIndex(): ScheduledChangeIndex {
  return { byClient: new Map(), byProject: new Map() };
}

/** Konvertér en databaserække til den lette form. */
export function toScheduledRateChangeLite(row: {
  id: string;
  clientId: string | null;
  projectId: string | null;
  newRate: string;
  oldRate: string | null;
  effectiveDate: string;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}): ScheduledRateChangeLite {
  return {
    id: row.id,
    clientId: row.clientId,
    projectId: row.projectId,
    newRate: row.newRate,
    oldRate: row.oldRate,
    effectiveDate: row.effectiveDate,
    appliedAt: row.appliedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
  };
}
