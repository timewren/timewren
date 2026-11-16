import { and, asc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { syncT } from "@/i18n/sync-text";
import * as schema from "@/lib/db/schema";
import { logOrgAudit } from "@/lib/org-audit";
import { copenhagenToday } from "@/lib/time/copenhagen";
import {
  calculateDailyNorm,
  DEFAULT_WORKING_DAYS,
  type NormProfile,
  type OrgWorkSettings,
} from "./timesheet";

/**
 * Ansættelseshistorik (#465, E7) — ÉT opslagspunkt for "hvad gjaldt på
 * datoen": ugetimer, FTE, afdeling, arbejdsdage og dagsnorm-override.
 *
 * Regler:
 *  - En periode dækker [validFrom, validTo], begge inklusive. validFrom NULL
 *    = siden ansættelsens start (dato ukendt); validTo NULL = åben.
 *  - Ingen perioder (profil fra før migreringen, eller ukendt kodesti) =
 *    bagudkompatibel adfærd: profilens egne felter gælder for alle datoer.
 *  - En dato uden dækkende periode (før første, efter fratrædelse, eller i
 *    et hul mellem to ansættelser) = IKKE ansat → normtid 0, ingen
 *    optjening, ingen påmindelser.
 */

type Db = PostgresJsDatabase<typeof schema>;

/** Minimum af en periode som beregningerne har brug for. */
export type EmploymentPeriodLike = {
  validFrom: string | null;
  validTo: string | null;
  weeklyHours: number | string;
  conversionFactor?: number | string | null;
  employmentType?: string | null;
  departmentId?: string | null;
  workingDays: string[] | null;
  dailyNormHours?: number | string | null;
  breakMinutes?: number | null;
  endReason?: string | null;
};

/** Profil-felter der cacher den seneste periode. */
export type EmploymentProfileLike = NormProfile & {
  breakMinutes?: number | null;
  departmentId?: string | null;
  employmentType?: string | null;
};

/** Lukket interval [start, end] — NULL = åben i den retning. */
export type EmploymentInterval = {
  start: string | null;
  end: string | null;
};

function covers(period: EmploymentInterval, date: string): boolean {
  if (period.start && period.start > date) return false;
  if (period.end && period.end < date) return false;
  return true;
}

/** Sortér perioder kronologisk (NULL validFrom først). */
export function sortPeriods<T extends { validFrom: string | null }>(
  periods: readonly T[],
): T[] {
  return [...periods].sort((a, b) => {
    if (a.validFrom === b.validFrom) return 0;
    if (a.validFrom == null) return -1;
    if (b.validFrom == null) return 1;
    return a.validFrom < b.validFrom ? -1 : 1;
  });
}

/**
 * Perioden der gjaldt på `date` — null hvis ingen dækker (ikke ansat).
 * Med en tom liste returneres null; brug `isEmployedOn` for at skelne
 * "ingen historik" fra "fratrådt".
 */
export function resolveEmploymentAt<T extends EmploymentPeriodLike>(
  periods: readonly T[],
  date: string,
): T | null {
  // Ved overlap vinder den senest startende periode (sidste i sorteringen)
  let found: T | null = null;
  for (const p of sortPeriods(periods)) {
    if (covers({ start: p.validFrom, end: p.validTo }, date)) found = p;
  }
  return found;
}

/** Seneste periode (højeste validFrom) — profilens "nuværende" projektion. */
export function latestPeriod<T extends { validFrom: string | null }>(
  periods: readonly T[],
): T | null {
  const sorted = sortPeriods(periods);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/**
 * Var medarbejderen ansat på datoen? Uden historik (tom liste) svares
 * altid ja — så profiler fra før migreringen opfører sig som før.
 */
export function isEmployedOn(
  periods: readonly EmploymentPeriodLike[],
  date: string,
): boolean {
  if (periods.length === 0) return true;
  return resolveEmploymentAt(periods, date) !== null;
}

/** Var medarbejderen ansat på mindst én dag i [from, to]? */
export function isEmployedInRange(
  periods: readonly EmploymentPeriodLike[],
  from: string,
  to: string,
): boolean {
  if (periods.length === 0) return true;
  return periods.some(
    (p) =>
      (p.validFrom == null || p.validFrom <= to) &&
      (p.validTo == null || p.validTo >= from),
  );
}

/**
 * Normprofil for en dato: periodens værdier oven på profilens (profilen er
 * fallback for felter perioden ikke har, og hele fallback'en uden historik).
 * Returnerer null når medarbejderen ikke var ansat på datoen.
 */
export function normProfileAt<P extends EmploymentProfileLike>(
  periods: readonly EmploymentPeriodLike[],
  profile: P,
  date: string,
): (P & EmploymentPeriodLike) | P | null {
  if (periods.length === 0) return profile;
  const period = resolveEmploymentAt(periods, date);
  if (!period) return null;
  return {
    ...profile,
    weeklyHours: period.weeklyHours,
    workingDays: period.workingDays ?? profile.workingDays ?? null,
    dailyNormHours: period.dailyNormHours ?? null,
    breakMinutes: period.breakMinutes ?? null,
    departmentId: period.departmentId ?? null,
    employmentType: period.employmentType ?? profile.employmentType ?? null,
  };
}

/** Dagsnorm på datoen — 0 når ikke ansat. */
export function dailyNormAt(
  periods: readonly EmploymentPeriodLike[],
  profile: EmploymentProfileLike,
  date: string,
  orgSettings: OrgWorkSettings | null | undefined,
): number {
  const eff = normProfileAt(periods, profile, date);
  return eff ? calculateDailyNorm(eff, orgSettings) : 0;
}

/** Arbejdsdage på datoen — tom liste når ikke ansat. */
export function workingDaysAt(
  periods: readonly EmploymentPeriodLike[],
  profile: EmploymentProfileLike,
  date: string,
): readonly string[] {
  const eff = normProfileAt(periods, profile, date);
  if (!eff) return [];
  return eff.workingDays ?? DEFAULT_WORKING_DAYS;
}

/**
 * Ansættelsesintervaller til ferie-optjening: sammenhængende perioder
 * (ændrede vilkår uden hul) smeltes sammen, så en FTE-ændring midt i en
 * måned ikke bryder "ansat hele måneden". Uden historik bruges profilens
 * start-/slutdato.
 */
export function employmentIntervals(
  periods: readonly EmploymentPeriodLike[],
  fallback?: { startDate?: string | null; endDate?: string | null },
): EmploymentInterval[] {
  if (periods.length === 0) {
    return [
      { start: fallback?.startDate ?? null, end: fallback?.endDate ?? null },
    ];
  }
  const out: EmploymentInterval[] = [];
  for (const p of sortPeriods(periods)) {
    const last = out[out.length - 1];
    if (last && last.end != null && p.validFrom != null) {
      if (nextDay(last.end) >= p.validFrom) {
        // Støder op til (eller overlapper) forrige → forlæng
        last.end =
          p.validTo == null
            ? null
            : last.end > p.validTo
              ? last.end
              : p.validTo;
        continue;
      }
    } else if (last && last.end == null) {
      // Forrige er åben — alt efter den er dækket
      continue;
    }
    out.push({ start: p.validFrom, end: p.validTo });
  }
  return out;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

/** Dagen før (YYYY-MM-DD). */
export function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

export type PeriodDateNeighbours = {
  validFrom: string | null;
  validTo: string | null;
  /** Fratrædelsesårsag på perioden selv (null = afløst af næste periode) */
  endReason: string | null;
  prev: {
    validFrom: string | null;
    validTo: string | null;
    endReason: string | null;
  } | null;
  next: { validFrom: string | null } | null;
};

/**
 * Validér en periodes datoer mod nabo-perioderne (#465). Returnerer en dansk
 * fejltekst eller null. Regler: ingen overlap (heller ikke med en afsluttet
 * ansættelse før en genansættelse), og en afløst periode (uden
 * fratrædelsesårsag) skal støde direkte op til den næste — ingen tavse huller.
 */
export function validatePeriodDates(p: PeriodDateNeighbours): string | null {
  const { validFrom, validTo, endReason, prev, next } = p;
  if (validFrom != null && validTo != null && validTo < validFrom) {
    return syncT("enterprise.employment.endBeforeStart");
  }
  if (prev) {
    if (validFrom == null) {
      return syncT("enterprise.employment.onlyFirstUnknown");
    }
    if (prev.validFrom != null && validFrom <= prev.validFrom) {
      return syncT("enterprise.employment.startAfterPrevStart", {
        date: prev.validFrom,
      });
    }
    if (
      prev.endReason != null &&
      prev.validTo != null &&
      validFrom <= prev.validTo
    ) {
      return syncT("enterprise.employment.startAfterPrevEnd", {
        date: prev.validTo,
      });
    }
  }
  if (next?.validFrom != null) {
    if (validTo == null || validTo >= next.validFrom) {
      return syncT("enterprise.employment.endBeforeNext", {
        date: next.validFrom,
      });
    }
    const abutting = previousDay(next.validFrom);
    if (endReason == null && validTo !== abutting) {
      return syncT("enterprise.employment.endDayBeforeNext", {
        date: abutting,
      });
    }
  }
  return null;
}

// ─── DB-opslag ───────────────────────────────────────────────────────────────

export type EmploymentPeriodRow = typeof schema.employmentPeriods.$inferSelect;

/** Alle perioder for en liste af brugere i org'en, kronologisk pr. bruger. */
export async function loadEmploymentPeriods(
  db: Db,
  orgId: string,
  userIds: readonly string[],
): Promise<Map<string, EmploymentPeriodRow[]>> {
  const map = new Map<string, EmploymentPeriodRow[]>();
  if (userIds.length === 0) return map;
  const rows = await db.query.employmentPeriods.findMany({
    where: and(
      eq(schema.employmentPeriods.organizationId, orgId),
      inArray(schema.employmentPeriods.userId, [...userIds]),
    ),
    orderBy: [asc(schema.employmentPeriods.validFrom)],
  });
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push(row);
    map.set(row.userId, list);
  }
  for (const [k, list] of map) map.set(k, sortPeriods(list));
  return map;
}

/** Alle perioder for én bruger, kronologisk. */
export async function loadEmploymentPeriodsForUser(
  db: Db,
  userId: string,
  orgId: string,
): Promise<EmploymentPeriodRow[]> {
  return (await loadEmploymentPeriods(db, orgId, [userId])).get(userId) ?? [];
}

/**
 * Perioden der gjaldt for brugeren på datoen. `null` = ikke ansat på datoen
 * ELLER ingen historik — brug `getEmploymentContext` når forskellen betyder
 * noget for beregningen.
 */
export async function getEmploymentAt(
  db: Db,
  userId: string,
  orgId: string,
  date: string,
): Promise<EmploymentPeriodRow | null> {
  const periods = await loadEmploymentPeriodsForUser(db, userId, orgId);
  return resolveEmploymentAt(periods, date);
}

/**
 * Batch-variant til rapporter/ugeoversigter: én forespørgsel, derefter rene
 * opslag pr. (bruger, dato).
 */
export async function getEmploymentBatch(
  db: Db,
  orgId: string,
  userIds: readonly string[],
): Promise<{
  at: (userId: string, date: string) => EmploymentPeriodRow | null;
  periodsFor: (userId: string) => EmploymentPeriodRow[];
  employedOn: (userId: string, date: string) => boolean;
}> {
  const map = await loadEmploymentPeriods(db, orgId, userIds);
  const periodsFor = (userId: string) => map.get(userId) ?? [];
  return {
    periodsFor,
    at: (userId, date) => resolveEmploymentAt(periodsFor(userId), date),
    employedOn: (userId, date) => isEmployedOn(periodsFor(userId), date),
  };
}

/**
 * Effektiv profil på en dato for én bruger — det de fleste mutationer har
 * brug for (fraværsanmodning, dagsregistrering): profilen med periodens
 * ugetimer/arbejdsdage/norm-override lagt over. `null` = ikke ansat.
 */
export async function effectiveProfileAt<P extends EmploymentProfileLike>(
  db: Db,
  params: { userId: string; orgId: string; profile: P; date: string },
): Promise<(P & EmploymentPeriodLike) | P | null> {
  const periods = await loadEmploymentPeriodsForUser(
    db,
    params.userId,
    params.orgId,
  );
  return normProfileAt(periods, params.profile, params.date);
}

/** Opslag pr. dato med profil-fallback — bruges af uge-/rapport-lag. */
export function makeDayResolver(
  periods: readonly EmploymentPeriodLike[],
  profile: EmploymentProfileLike,
  orgSettings: OrgWorkSettings | null | undefined,
): (
  date: string,
) => { dailyNorm: number; workingDays: readonly string[] } | null {
  return (date) => {
    const eff = normProfileAt(periods, profile, date);
    if (!eff) return null;
    return {
      dailyNorm: calculateDailyNorm(eff, orgSettings),
      workingDays: eff.workingDays ?? DEFAULT_WORKING_DAYS,
    };
  };
}

/**
 * Dagligt (cron): profiler med passeret fratrædelsesdato sættes inaktive —
 * kun i orgs med enterprise-modulet. Idempotent (kun aktive rækker rammes),
 * data bevares, og hver deaktivering audit-logges (aktør = medarbejderen
 * selv, metadata.source = "system", da actor_id er NOT NULL → users).
 */
export async function deactivateEndedEmployments(
  db: Db,
  today: string = copenhagenToday(),
): Promise<number> {
  const enterpriseOrgs = await db.query.organizationModules.findMany({
    where: and(
      eq(schema.organizationModules.moduleKey, "enterprise"),
      eq(schema.organizationModules.isEnabled, true),
    ),
    columns: { organizationId: true },
  });
  const orgIds = enterpriseOrgs.map((o) => o.organizationId);
  if (orgIds.length === 0) return 0;

  const rows = await db
    .update(schema.employeeProfiles)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        inArray(schema.employeeProfiles.organizationId, orgIds),
        eq(schema.employeeProfiles.isActive, true),
        isNotNull(schema.employeeProfiles.endDate),
        lt(schema.employeeProfiles.endDate, today),
      ),
    )
    .returning({
      id: schema.employeeProfiles.id,
      organizationId: schema.employeeProfiles.organizationId,
      userId: schema.employeeProfiles.userId,
      endDate: schema.employeeProfiles.endDate,
    });
  for (const row of rows) {
    await logOrgAudit(
      db,
      row.organizationId,
      row.userId,
      "employee_profile_deactivated",
      {
        targetUserId: row.userId,
        metadata: {
          profileId: row.id,
          source: "system",
          cron: "vacation-year-rollover",
          endDate: row.endDate,
        },
      },
    );
  }
  return rows.length;
}
