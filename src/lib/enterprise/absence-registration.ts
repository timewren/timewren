import { syncT } from "@/i18n/sync-text";
/**
 * Rene hjælpere til fravær som *registrering* (#460): åbne perioder
 * (sygdom uden kendt slutdato), delvis fravær i timer, årsloft pr. type og
 * synligheds-maskering over for kolleger. Ingen DB-adgang — testes direkte.
 */

export const ABSENCE_CATEGORIES = [
  "vacation",
  "sickness",
  "leave",
  "other",
] as const;
export type AbsenceCategory = (typeof ABSENCE_CATEGORIES)[number];

export const ABSENCE_CATEGORY_LABELS: Record<AbsenceCategory, string> = {
  vacation: "Ferie",
  sickness: "Sygdom",
  leave: "Orlov",
  other: "Andet",
};

export function toAbsenceCategory(value: string | null | undefined) {
  return (ABSENCE_CATEGORIES as readonly string[]).includes(value ?? "")
    ? (value as AbsenceCategory)
    : "other";
}

/** Kun sygdom og orlov må registreres uden slutdato. */
export function allowsOpenPeriod(category: string | null | undefined) {
  const c = toAbsenceCategory(category);
  return c === "sickness" || c === "leave";
}

/**
 * Effektiv slutdato for en periode: den registrerede, eller — for åbne
 * perioder — dags dato (dog aldrig før startdatoen, så en fremtidig åben
 * sygemelding tæller som én dag indtil den er begyndt).
 */
export function effectiveEndDate(
  startDate: string,
  endDate: string | null | undefined,
  today: string,
): string {
  if (endDate) return endDate;
  return today < startDate ? startDate : today;
}

/** Dækker perioden datoen? Åben periode dækker start … i dag. */
export function absenceCoversDate(
  req: { startDate: string; endDate: string | null },
  date: string,
  today: string,
): boolean {
  return (
    req.startDate <= date &&
    effectiveEndDate(req.startDate, req.endDate, today) >= date
  );
}

/** Afrund til nærmeste kvarte dag (0,25). */
export function roundToQuarterDay(days: number): number {
  return Math.round(days * 4) / 4;
}

/**
 * Delvis fravær (#460): timer pr. dag omregnes til dage via dagsnormen og
 * afrundes til kvarte dage. Timer ≥ dagsnorm = hele dage. Dagsnorm ≤ 0 → 0.
 */
export function partialAbsenceDays(params: {
  workingDays: number;
  hoursPerDay: number;
  dailyNorm: number;
}): number {
  const { workingDays, hoursPerDay, dailyNorm } = params;
  if (!(workingDays > 0) || !(hoursPerDay > 0) || !(dailyNorm > 0)) return 0;
  const fraction = Math.min(1, hoursPerDay / dailyNorm);
  return roundToQuarterDay(workingDays * fraction);
}

/**
 * Årsloft pr. type (fx barns 1. sygedag = 2 dage/år). `usedDays` = allerede
 * registrerede dage i samme år (pending + approved). Returnerer om den nye
 * registrering kan rummes, og hvor mange dage der er tilbage FØR den.
 */
export function evaluateAnnualCap(params: {
  capDays: number | null | undefined;
  usedDays: number;
  requestedDays: number;
}): { allowed: boolean; remaining: number | null } {
  const { capDays, usedDays, requestedDays } = params;
  if (capDays == null || !(capDays > 0))
    return { allowed: true, remaining: null };
  const remaining = Math.max(0, Math.round((capDays - usedDays) * 100) / 100);
  // Tolerance på 0,005 så 1,995 ≈ 2 ikke afvises pga. flydende tal
  return { allowed: requestedDays <= remaining + 0.005, remaining };
}

export function annualCapMessage(params: {
  typeName: string;
  capDays: number;
  remaining: number;
  year: number;
}): string {
  const fmt = (n: number) => String(n).replace(".", ",");
  return params.remaining <= 0
    ? syncT("enterprise.absenceCap.used", {
        type: params.typeName,
        year: params.year,
        cap: fmt(params.capDays),
      })
    : syncT("enterprise.absenceCap.left", {
        remaining: fmt(params.remaining),
        cap: fmt(params.capDays),
        type: params.typeName.toLowerCase(),
        year: params.year,
      });
}

export type AbsenceViewer = {
  viewerUserId: string;
  /** admin/owner/HR — ser alt */
  isPrivileged: boolean;
  /** userIds som viewer er leder for */
  managedUserIds: ReadonlySet<string>;
};

/** Må viewer se den rigtige fraværstype for denne medarbejder? */
export function canSeeAbsenceType(
  viewer: AbsenceViewer,
  ownerUserId: string,
  visibleToColleagues: boolean,
): boolean {
  if (visibleToColleagues) return true;
  if (viewer.isPrivileged) return true;
  if (viewer.viewerUserId === ownerUserId) return true;
  return viewer.managedUserIds.has(ownerUserId);
}

export const MASKED_ABSENCE = { name: "Fravær", color: "#6b7280" } as const;

/**
 * Maskér typen som neutral "Fravær" for kolleger, når typen ikke er synlig
 * for dem (sygdom er persondata). Ejer, dennes ledere og admin ser alt.
 */
export function maskAbsenceType<
  T extends { name: string; color: string | null },
>(
  viewer: AbsenceViewer,
  ownerUserId: string,
  type: T & { visibleToColleagues: boolean },
): T {
  if (canSeeAbsenceType(viewer, ownerUserId, type.visibleToColleagues)) {
    return type;
  }
  return { ...type, name: MASKED_ABSENCE.name, color: MASKED_ABSENCE.color };
}
