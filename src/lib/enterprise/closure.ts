import { and, eq, gte, inArray, isNull, lte, not, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { syncT } from "@/i18n/sync-text";
import * as schema from "@/lib/db/schema";
import { toLocalDateStr } from "@/lib/format";
import { loadDaysOff } from "@/lib/holidays/load";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { recalculateFlexDay } from "./flex";
import {
  applyConversionFactor,
  countWorkingDays,
  ensureVacationPeriod,
  evaluateVacationGuard,
  getVacationOrgSettings,
  getVacationOverdraft,
  postVacationUsage,
  remainingInPool,
  toVacationPool,
  type VacationOrgSettings,
  vacationDeductionFactor,
  vacationGuardMessage,
} from "./vacation";

/**
 * Faste ferieuger / lukkeperioder (#436).
 *
 * Institutionen lukker i en periode (fx uge 42), og alle aktive medarbejdere
 * holder ferie. Perioden materialiseres som én GODKENDT absence_request pr.
 * medarbejder (source = "closure", closure_period_id sat), så saldo, norm og
 * flex følger den almindelige fraværslogik — og medarbejderen kan ikke selv
 * ændre eller annullere den.
 */

type Db = PostgresJsDatabase<typeof schema>;

export type ClosurePeriodInput = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  absenceTypeId: string;
};

export type ClosureAbsenceType = {
  id: string;
  deductsVacation: boolean;
  vacationPool: string | null;
};

export type ClosureEmployee = {
  userId: string;
  weeklyHours: number;
  workingDays: string[] | null;
};

export type ClosureSkipReason =
  | "overlap"
  | "no_working_days"
  | "balance"
  | "error";

export type MaterializeResult =
  | { status: "created"; requestId: string; totalDays: number }
  | { status: "skipped"; reason: ClosureSkipReason; message: string };

/** Maks. længde på en lukkeperiode (dage, inkl.). */
export const MAX_CLOSURE_DAYS = 31;

/** Tekster hentes ved brug (getters), så de følger kaldets sprog; uden sprog er de danske. */
export const CLOSURE_SKIP_LABELS: Record<ClosureSkipReason, string> = {
  get overlap() {
    return syncT("enterprise.closure.overlap");
  },
  get no_working_days() {
    return syncT("enterprise.closure.noWorkingDays");
  },
  get balance() {
    return syncT("enterprise.closure.balance");
  },
  get error() {
    return syncT("enterprise.closure.error");
  },
};

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Antal kalenderdage i perioden (begge ender inkl.). */
export function closureLengthDays(startDate: string, endDate: string): number {
  const ms = parseDate(endDate).getTime() - parseDate(startDate).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Datoer i perioden der er arbejdsdage for profilen og ikke heldags-
 * helligdage — dem der skal have flex genberegnet.
 */
export function closureWorkingDates(
  startDate: string,
  endDate: string,
  workingDays: string[],
  holidayDates: string[],
): string[] {
  const holidaySet = new Set(holidayDates);
  const out: string[] = [];
  const current = parseDate(startDate);
  const end = parseDate(endDate);
  while (current <= end) {
    const dateStr = toLocalDateStr(current);
    const isoDay = current.getDay() === 0 ? "7" : String(current.getDay());
    if (workingDays.includes(isoDay) && !holidaySet.has(dateStr)) {
      out.push(dateStr);
    }
    current.setDate(current.getDate() + 1);
  }
  return out;
}

/**
 * Hele fridage (org'ens fridagskalender, #526) i intervallet, som
 * YYYY-MM-DD. Lukkeperioder gælder hele org'en, så afdelingskalendere
 * indgår ikke her.
 */
export async function getFullDayHolidayDates(
  db: Db,
  orgId: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const days = await loadDaysOff(db, {
    orgId,
    userId: null,
    departmentId: null,
    start: startDate,
    end: endDate,
  });
  return days.filter((h) => !h.isHalfDay).map((h) => h.date);
}

/**
 * Opret den godkendte lukke-anmodning for én medarbejder (delt af
 * createClosurePeriod og nyansættelse). Springer over ved overlap med
 * eksisterende fravær, ingen arbejdsdage, eller manglende feriesaldo.
 */
export async function materializeClosureForEmployee(
  db: Db,
  params: {
    orgId: string;
    period: ClosurePeriodInput;
    absenceType: ClosureAbsenceType;
    employee: ClosureEmployee;
    holidayDates: string[];
    halfDayHolidayDates?: string[];
    createdBy: string | null;
    /** Org'ens tilladte overtræk af feriesaldoen (dage) */
    overdraft: number;
    /** Org'ens ferie-indstillinger — afgør fradragsfaktoren (#461) */
    settings: VacationOrgSettings;
  },
): Promise<MaterializeResult> {
  const { orgId, period, absenceType, employee, holidayDates, createdBy } =
    params;
  const workingDays = employee.workingDays ?? ["1", "2", "3", "4", "5"];

  const overlapping = await db.query.absenceRequests.findFirst({
    where: and(
      eq(schema.absenceRequests.userId, employee.userId),
      eq(schema.absenceRequests.organizationId, orgId),
      not(inArray(schema.absenceRequests.status, ["cancelled", "rejected"])),
      lte(schema.absenceRequests.startDate, period.endDate),
      or(
        isNull(schema.absenceRequests.endDate),
        gte(schema.absenceRequests.endDate, period.startDate),
      ),
    ),
    columns: { id: true },
  });
  if (overlapping) {
    return {
      status: "skipped",
      reason: "overlap",
      message: CLOSURE_SKIP_LABELS.overlap,
    };
  }

  const dates = closureWorkingDates(
    period.startDate,
    period.endDate,
    workingDays,
    holidayDates,
  );
  const totalDays = countWorkingDays(
    period.startDate,
    period.endDate,
    workingDays,
    holidayDates,
    "full",
    "full",
    params.halfDayHolidayDates,
  );
  if (totalDays === 0) {
    return {
      status: "skipped",
      reason: "no_working_days",
      message: CLOSURE_SKIP_LABELS.no_working_days,
    };
  }

  const pool = toVacationPool(absenceType.vacationPool);
  let deductedDays: number | null = null;
  if (absenceType.deductsVacation) {
    deductedDays = applyConversionFactor(
      totalDays,
      vacationDeductionFactor(params.settings, employee.weeklyHours),
    );
    const balance = await ensureVacationPeriod(
      db,
      employee.userId,
      orgId,
      period.startDate,
    );
    const remaining = remainingInPool(balance, pool);
    const guard = evaluateVacationGuard(
      remaining,
      deductedDays,
      params.overdraft,
    );
    if (!guard.allowed) {
      return {
        status: "skipped",
        reason: "balance",
        message: vacationGuardMessage(
          pool,
          remaining,
          deductedDays,
          params.overdraft,
        ),
      };
    }
  }

  const now = new Date();
  const [created] = await db
    .insert(schema.absenceRequests)
    .values({
      userId: employee.userId,
      organizationId: orgId,
      absenceTypeId: absenceType.id,
      startDate: period.startDate,
      endDate: period.endDate,
      halfDayStart: false,
      halfDayEnd: false,
      totalDays: String(totalDays),
      deductedDays: deductedDays !== null ? String(deductedDays) : null,
      status: "approved",
      approvedBy: createdBy,
      approvedAt: now,
      note: `Fast ferie: ${period.name}`,
      source: "closure",
      closurePeriodId: period.id,
    })
    .returning({ id: schema.absenceRequests.id });

  if (deductedDays !== null) {
    await postVacationUsage(db, {
      userId: employee.userId,
      orgId,
      date: period.startDate,
      days: deductedDays,
      pool,
      refType: "closure",
      refId: created.id,
      note: `Fast ferie: ${period.name}`,
      createdBy,
    });
  }

  for (const date of dates) {
    await recalculateFlexDay(db, { userId: employee.userId, orgId, date });
  }

  return { status: "created", requestId: created.id, totalDays };
}

/**
 * Fjern alle lukke-anmodninger for en periode og tilbagefør saldo/flex.
 * Returnerer antal fjernede anmodninger.
 */
export async function removeClosureRequests(
  db: Db,
  orgId: string,
  closurePeriodId: string,
): Promise<number> {
  const requests = await db.query.absenceRequests.findMany({
    where: and(
      eq(schema.absenceRequests.organizationId, orgId),
      eq(schema.absenceRequests.closurePeriodId, closurePeriodId),
    ),
    with: {
      absenceType: { columns: { deductsVacation: true, vacationPool: true } },
    },
  });
  if (requests.length === 0) return 0;

  const profiles = await db.query.employeeProfiles.findMany({
    where: and(
      eq(schema.employeeProfiles.organizationId, orgId),
      inArray(
        schema.employeeProfiles.userId,
        requests.map((r) => r.userId),
      ),
    ),
    columns: { userId: true, workingDays: true },
  });
  const workingDaysByUser = new Map(
    profiles.map((p) => [p.userId, p.workingDays ?? ["1", "2", "3", "4", "5"]]),
  );

  // Helligdage hentes én gang pr. dato-interval — alle anmodninger i en
  // lukkeperiode deler start/slut, så det er typisk ét opslag i alt (#452).
  const holidayCache = new Map<string, string[]>();
  const holidaysFor = async (start: string, end: string) => {
    const key = `${start}|${end}`;
    let dates = holidayCache.get(key);
    if (!dates) {
      dates = await getFullDayHolidayDates(db, orgId, start, end);
      holidayCache.set(key, dates);
    }
    return dates;
  };

  for (const req of requests) {
    if (
      req.status === "approved" &&
      req.absenceType.deductsVacation &&
      req.deductedDays
    ) {
      await postVacationUsage(db, {
        userId: req.userId,
        orgId,
        date: req.startDate,
        days: -Number(req.deductedDays),
        pool: toVacationPool(req.absenceType.vacationPool),
        refType: "closure",
        refId: req.id,
        note: "Lukkeperiode fjernet",
      });
    }
    await db
      .delete(schema.overtimeLedger)
      .where(
        and(
          eq(schema.overtimeLedger.organizationId, orgId),
          eq(schema.overtimeLedger.absenceRequestId, req.id),
        ),
      );
    await db
      .delete(schema.absenceRequests)
      .where(eq(schema.absenceRequests.id, req.id));

    // Lukkeperiode-anmodninger har altid slutdato; fallback kun for typen
    const reqEnd = req.endDate ?? req.startDate;
    const holidayDates = await holidaysFor(req.startDate, reqEnd);
    const dates = closureWorkingDates(
      req.startDate,
      reqEnd,
      workingDaysByUser.get(req.userId) ?? ["1", "2", "3", "4", "5"],
      holidayDates,
    );
    for (const date of dates) {
      await recalculateFlexDay(db, { userId: req.userId, orgId, date });
    }
  }

  return requests.length;
}

/** Alt der skal bruges for at materialisere fremtidige lukkeperioder — indlæses ÉN gang pr. batch. */
export type FutureClosureContext = {
  periods: Array<ClosurePeriodInput & { absenceType: ClosureAbsenceType }>;
  overdraft: number;
  settings: VacationOrgSettings;
  holidayDatesByPeriod: Map<string, string[]>;
  halfDayHolidayDatesByPeriod?: Map<string, string[]>;
};

export type EmployeeClosureResult = {
  periodId: string;
  periodName: string;
  result: MaterializeResult;
};

/**
 * Indlæs fremtidige lukkeperioder (slutdato ≥ i dag), org'ens overtræk og
 * heldags-helligdage pr. periode. Brug ved batch (CSV-import) så det ikke
 * hentes pr. medarbejder.
 */
export async function loadFutureClosureContext(
  db: Db,
  orgId: string,
): Promise<FutureClosureContext> {
  const today = copenhagenToday();
  const periods = await db.query.orgClosurePeriods.findMany({
    where: and(
      eq(schema.orgClosurePeriods.organizationId, orgId),
      gte(schema.orgClosurePeriods.endDate, today),
    ),
    with: {
      absenceType: {
        columns: { id: true, deductsVacation: true, vacationPool: true },
      },
    },
  });
  if (periods.length === 0) {
    return {
      periods: [],
      overdraft: 0,
      settings: await getVacationOrgSettings(db, orgId),
      holidayDatesByPeriod: new Map(),
    };
  }
  const [overdraft, settings] = await Promise.all([
    getVacationOverdraft(db, orgId),
    getVacationOrgSettings(db, orgId),
  ]);
  const holidayDatesByPeriod = new Map<string, string[]>();
  const halfDayHolidayDatesByPeriod = new Map<string, string[]>();
  for (const period of periods) {
    const days = await loadDaysOff(db, {
      orgId,
      userId: null,
      departmentId: null,
      start: period.startDate,
      end: period.endDate,
    });
    holidayDatesByPeriod.set(
      period.id,
      days.filter((h) => !h.isHalfDay).map((h) => h.date),
    );
    halfDayHolidayDatesByPeriod.set(
      period.id,
      days.filter((h) => h.isHalfDay).map((h) => h.date),
    );
  }
  return {
    periods,
    overdraft,
    settings,
    holidayDatesByPeriod,
    halfDayHolidayDatesByPeriod,
  };
}

/**
 * Nyansat (#436): materialisér alle FREMTIDIGE lukkeperioder for den nye
 * medarbejder. Best-effort — fejl må ikke vælte profil-oprettelsen; de
 * returneres som skipped (reason "error"). Send `context` ind ved batch.
 */
export async function materializeFutureClosuresForEmployee(
  db: Db,
  params: {
    orgId: string;
    userId: string;
    weeklyHours: number;
    workingDays: string[] | null;
    createdBy: string | null;
  },
  context?: FutureClosureContext,
): Promise<EmployeeClosureResult[]> {
  const ctx = context ?? (await loadFutureClosureContext(db, params.orgId));
  const results: EmployeeClosureResult[] = [];

  for (const period of ctx.periods) {
    try {
      const result = await materializeClosureForEmployee(db, {
        orgId: params.orgId,
        period,
        absenceType: period.absenceType,
        employee: {
          userId: params.userId,
          weeklyHours: params.weeklyHours,
          workingDays: params.workingDays,
        },
        holidayDates: ctx.holidayDatesByPeriod.get(period.id) ?? [],
        halfDayHolidayDates:
          ctx.halfDayHolidayDatesByPeriod?.get(period.id) ?? [],
        createdBy: params.createdBy,
        overdraft: ctx.overdraft,
        settings: ctx.settings,
      });
      results.push({ periodId: period.id, periodName: period.name, result });
    } catch (err) {
      console.error(
        `[closure] kunne ikke materialisere "${period.name}" for ${params.userId}:`,
        err,
      );
      results.push({
        periodId: period.id,
        periodName: period.name,
        result: {
          status: "skipped",
          reason: "error",
          // Detaljen er logget ovenfor — UI'et får kun den neutrale label,
          // aldrig rå fejltekst fra DB/kode (#452).
          message: CLOSURE_SKIP_LABELS.error,
        },
      });
    }
  }

  return results;
}

/** Kun de perioder der IKKE blev materialiseret — til rapportering i UI. */
export function skippedClosures(
  results: EmployeeClosureResult[],
): Array<{ periodId: string; periodName: string; message: string }> {
  return results.flatMap((r) =>
    r.result.status === "skipped"
      ? [
          {
            periodId: r.periodId,
            periodName: r.periodName,
            message: r.result.message,
          },
        ]
      : [],
  );
}
