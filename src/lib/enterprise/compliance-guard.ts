import { TRPCError } from "@trpc/server";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
} from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import type { db as DbClient } from "@/lib/db";
import {
  absenceRequests,
  employeeProfiles,
  organizationModules,
  organizations,
  timeEntries,
} from "@/lib/db/schema";
import { copenhagenToday, copenhagenTodayAnchor } from "@/lib/time/copenhagen";
import {
  type ComplianceEvaluation,
  type ComplianceRuleMode,
  type ComplianceRuleSettings,
  type DatedTimeEntry,
  DEFAULT_COMPLIANCE_RULE_SETTINGS,
  evaluateEntryCompliance,
} from "./compliance";
import { ownTimeEntriesInOrg } from "./time-entry-scope";

type Db = typeof DbClient;
type TxOrDb = Pick<Db, "query">;

/**
 * Compliance-guard (E11, #469) — DB-laget rundt om den rene motor i
 * compliance.ts. Samme mønster som assertEntryEditable (#467): kaldes fra
 * ALLE registreringsveje FØR skrivning; no-op uden org (solo-brugere).
 *
 *  - loadComplianceRuleSettings: off/warn/block pr. regel + referenceperiode
 *  - loadApprovedAbsenceDates: godkendte hele fraværsdage (inkl. åbne
 *    sygeperioder til og med i dag)
 *  - checkEntryCompliance: vurdér en kandidat (eller en hel uge)
 *  - assertEntryCompliant: kast FORBIDDEN ved block, returnér advarsler
 */

const RULE_MODES: readonly ComplianceRuleMode[] = ["off", "warn", "block"];

function toMode(value: string | null | undefined): ComplianceRuleMode | null {
  return RULE_MODES.includes(value as ComplianceRuleMode)
    ? (value as ComplianceRuleMode)
    : null;
}

export type OrgComplianceRow = Pick<
  typeof organizations.$inferSelect,
  | "enforceComplianceBlocking"
  | "complianceReferencePeriodMonths"
  | "complianceRule48h"
  | "complianceRuleDailyRest"
  | "complianceRuleWeeklyRest"
>;

export type OrgComplianceSettings = {
  rules: ComplianceRuleSettings;
  referencePeriodMonths: number;
  /** Bagudkompatibelt spejl: rule48h === "block" */
  enforceComplianceBlocking: boolean;
};

/** Map en organisations-række til regel-indstillinger (ren, testbar). */
export function toComplianceSettings(
  org: OrgComplianceRow | null | undefined,
): OrgComplianceSettings {
  if (!org) {
    return {
      rules: DEFAULT_COMPLIANCE_RULE_SETTINGS,
      referencePeriodMonths: 4,
      enforceComplianceBlocking: false,
    };
  }
  // Før migration 0098 har kørt findes kolonnerne ikke → legacy-flaget
  // afgør 48 t-reglen alene, som før.
  const rule48h =
    toMode(org.complianceRule48h) ??
    (org.enforceComplianceBlocking ? "block" : "warn");
  const rules: ComplianceRuleSettings = {
    rule48h,
    dailyRest:
      toMode(org.complianceRuleDailyRest) ??
      DEFAULT_COMPLIANCE_RULE_SETTINGS.dailyRest,
    weeklyRest:
      toMode(org.complianceRuleWeeklyRest) ??
      DEFAULT_COMPLIANCE_RULE_SETTINGS.weeklyRest,
  };
  return {
    rules,
    referencePeriodMonths: org.complianceReferencePeriodMonths === 12 ? 12 : 4,
    enforceComplianceBlocking: rules.rule48h === "block",
  };
}

export async function loadComplianceRuleSettings(
  db: TxOrDb,
  orgId: string,
): Promise<OrgComplianceSettings> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: {
      enforceComplianceBlocking: true,
      complianceReferencePeriodMonths: true,
      complianceRule48h: true,
      complianceRuleDailyRest: true,
      complianceRuleWeeklyRest: true,
    },
  });
  return toComplianceSettings(org);
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toLocalDate(d: Date | string): Date {
  if (typeof d === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(d);
  }
  return d;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay();
  out.setDate(out.getDate() - (dow === 0 ? 6 : dow - 1));
  return out;
}

/** Start på referenceperioden: i dag minus N måneder (lokal midnat). */
export function referencePeriodStart(months: number, today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Godkendte HELE fraværsdage for brugeren i [from, to] (YYYY-MM-DD, begge
 * inkl.). Åbne perioder (endDate NULL, #460) dækker til og med i dag.
 * Halve dage og delvist fravær i timer tæller ikke som hviledag.
 * `neutralAbsenceDates` er delmængden der er neutral i 48 t-gennemsnittet
 * (alt undtagen afspadsering, jf. `expandNeutralAbsenceDates`).
 * Læser kun absence_requests — muterer ikke (E3-grænse).
 */
export async function loadApprovedAbsenceDates(
  db: TxOrDb,
  params: {
    orgId: string;
    userId: string;
    from: string;
    to: string;
    today?: string;
  },
): Promise<{ absenceDates: Set<string>; neutralAbsenceDates: Set<string> }> {
  const today = params.today ?? copenhagenToday();
  const rows = await db.query.absenceRequests.findMany({
    where: and(
      eq(absenceRequests.organizationId, params.orgId),
      eq(absenceRequests.userId, params.userId),
      eq(absenceRequests.status, "approved"),
      lte(absenceRequests.startDate, params.to),
      // Åben periode (endDate NULL) dækker til og med i dag
      or(
        isNull(absenceRequests.endDate),
        gte(absenceRequests.endDate, params.from),
      ),
    ),
    columns: {
      startDate: true,
      endDate: true,
      halfDayStart: true,
      halfDayEnd: true,
      hoursPerDay: true,
    },
    with: { absenceType: { columns: { deductsOvertime: true } } },
  });

  const flat = rows.map((r) => ({
    ...r,
    deductsOvertime: r.absenceType?.deductsOvertime ?? false,
  }));
  return {
    absenceDates: expandAbsenceDates(flat, params.from, params.to, today),
    neutralAbsenceDates: expandNeutralAbsenceDates(
      flat,
      params.from,
      params.to,
      today,
    ),
  };
}

export type AbsenceDateRow = {
  startDate: string;
  endDate: string | null;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  hoursPerDay: string | number | null;
  /** Fraværstypen trækker fra overtidssaldoen (afspadsering) */
  deductsOvertime?: boolean;
};

/**
 * Udfold fraværsperioder til hele fraværsdage i [from, to] (ren, testbar).
 * Åben periode → til og med `today`; halve dage og timer-fravær udelades.
 */
export function expandAbsenceDates(
  rows: AbsenceDateRow[],
  from: string,
  to: string,
  today: string,
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.hoursPerDay != null && Number(r.hoursPerDay) > 0) continue;
    const end = r.endDate ?? today;
    if (end < from) continue;
    const start = r.startDate < from ? from : r.startDate;
    const stop = end > to ? to : end;
    let cur = parseLocalDate(start);
    const last = parseLocalDate(stop);
    while (cur <= last) {
      const date = toDateStr(cur);
      const isHalf =
        (r.halfDayStart && date === r.startDate) ||
        (r.halfDayEnd && date === r.endDate);
      if (!isHalf) out.add(date);
      cur = addDays(cur, 1);
    }
  }
  return out;
}

/**
 * Hele fraværsdage der er NEUTRALE i 48 t-gennemsnittet (#728).
 * Arbejdstidslovens § 4, 2. pkt. nævner ferie og sygeorlov; øvrigt fravær
 * (barsel/orlov, omsorgsdage, barns sygedag, feriefridage, kursus …) er
 * uafklaret og behandles konservativt som neutralt, da 0 t i nævneren
 * kan skjule et brud. Afspadsering er IKKE neutral: den er netop den hvile,
 * der udligner overarbejdet i gennemsnittet.
 */
export function expandNeutralAbsenceDates(
  rows: AbsenceDateRow[],
  from: string,
  to: string,
  today: string,
): Set<string> {
  return expandAbsenceDates(
    rows.filter((r) => !r.deductsOvertime),
    from,
    to,
    today,
  );
}

export type ComplianceCheckInput = {
  /** Aktiv org — null/undefined = solo-bruger, ingen regler. */
  orgId: string | null | undefined;
  /** Ejeren af registreringen. */
  userId: string;
  /** Ny/ændret post. Udeladt = vurdér ugen `weekStart` som den står. */
  candidate?: {
    date: Date | string;
    hours: number;
    startTime?: Date | string | null;
    endTime?: Date | string | null;
  };
  /** Mandag (YYYY-MM-DD) for ugevurdering uden kandidat. */
  weekStart?: string;
  /** Poster kandidaten erstatter (opdatering / timeseddel-celle). */
  excludeEntryIds?: string[];
  /**
   * Registreringen er et faktum, ikke en plan (timer-stop, check-ud):
   * block nedgraderes til advarsel — ingen må miste registreret tid.
   */
  neverBlock?: boolean;
  /** Forudindlæste indstillinger (undgår dobbelt-opslag). */
  settings?: OrgComplianceSettings;
  /**
   * Om enterprise-modulet er aktivt for org'en (ctx.modules.isEnabled).
   * Udeladt → slås op. Loven gælder ikke selvstændige: uden modulet ingen fund.
   */
  enterpriseEnabled?: boolean;
  /** Referencedato (tests). */
  today?: Date;
};

const NO_FINDINGS: ComplianceEvaluation = {
  allowed: true,
  blocked: [],
  warnings: [],
  findings: [],
};

/** Er enterprise-modulet tilgængeligt OG slået til? Ingen rækker = freelance. */
export async function isEnterpriseModuleEnabled(
  db: TxOrDb,
  orgId: string,
): Promise<boolean> {
  const rows = await db.query.organizationModules.findMany({
    where: and(
      eq(organizationModules.organizationId, orgId),
      eq(organizationModules.moduleKey, "enterprise"),
    ),
    columns: { isAvailable: true, isEnabled: true },
  });
  return rows.some((r) => r.isAvailable && r.isEnabled);
}

/**
 * Nedgradér blokeringer til advarsler (ren, testbar). Bruges når
 *  - registreringen er et faktum (neverBlock), eller
 *  - kandidaten ikke øger belastningen: timer ≤ summen af de poster den
 *    erstatter, eller 0 timer — ellers kan en bruger i overtrædelse aldrig
 *    rette NED (lock-in).
 */
export function downgradeBlocks(
  result: ComplianceEvaluation,
  opts: {
    neverBlock?: boolean;
    candidateHours?: number;
    replacedHours?: number;
  },
): ComplianceEvaluation {
  if (result.allowed) return result;
  const reducing =
    opts.candidateHours != null &&
    (opts.candidateHours <= 0.005 ||
      (opts.replacedHours != null &&
        opts.candidateHours <= opts.replacedHours + 0.005));
  if (!opts.neverBlock && !reducing) return result;
  return {
    allowed: true,
    blocked: [],
    warnings: [...result.blocked, ...result.warnings],
    findings: result.findings,
  };
}

/**
 * Vurdér en registrering (eller en uge) mod org'ens compliance-regler.
 * Læser org-indstillinger, profil (§2-undtagelse), poster i reference-
 * perioden og godkendt fravær — og kalder den rene motor.
 */
export async function checkEntryCompliance(
  db: TxOrDb,
  input: ComplianceCheckInput,
): Promise<ComplianceEvaluation> {
  const { orgId, userId } = input;
  if (!orgId) return NO_FINDINGS;

  // Alle signups får en org — reglerne gælder kun enterprise-orgs
  const enterpriseEnabled =
    input.enterpriseEnabled ?? (await isEnterpriseModuleEnabled(db, orgId));
  if (!enterpriseEnabled) return NO_FINDINGS;

  const settings =
    input.settings ?? (await loadComplianceRuleSettings(db, orgId));
  const { rules } = settings;
  if (
    rules.rule48h === "off" &&
    rules.dailyRest === "off" &&
    rules.weeklyRest === "off"
  ) {
    return NO_FINDINGS;
  }

  const profile = await db.query.employeeProfiles.findFirst({
    where: and(
      eq(employeeProfiles.userId, userId),
      eq(employeeProfiles.organizationId, orgId),
    ),
    columns: { isSelfScheduler: true },
  });
  if (profile?.isSelfScheduler) return NO_FINDINGS;

  const today = input.today ?? copenhagenTodayAnchor();
  const candidateDate = input.candidate
    ? toLocalDate(input.candidate.date)
    : null;
  const weekStartDate = input.weekStart
    ? parseLocalDate(input.weekStart)
    : candidateDate
      ? mondayOf(candidateDate)
      : null;
  if (!weekStartDate) return NO_FINDINGS;

  // Vindue: referenceperioden bagud, og frem til dagen efter ugen/kandidaten
  // (11 t-reglen ser på næste dags start).
  const refStart = referencePeriodStart(settings.referencePeriodMonths, today);
  const windowEndExclusive = addDays(
    candidateDate && candidateDate > addDays(weekStartDate, 6)
      ? candidateDate
      : addDays(weekStartDate, 6),
    2,
  );
  const from = refStart < weekStartDate ? refStart : weekStartDate;

  const excludeIds = input.excludeEntryIds ?? [];
  const [rows, { absenceDates, neutralAbsenceDates }, replacedRows] =
    await Promise.all([
      db.query.timeEntries.findMany({
        where: and(
          ownTimeEntriesInOrg(userId, orgId),
          gte(timeEntries.date, from),
          lt(timeEntries.date, windowEndExclusive),
          ...(excludeIds.length > 0
            ? [notInArray(timeEntries.id, excludeIds)]
            : []),
        ),
        columns: { date: true, hours: true, startTime: true, endTime: true },
      }),
      loadApprovedAbsenceDates(db, {
        orgId,
        userId,
        from: toDateStr(from),
        to: toDateStr(addDays(windowEndExclusive, -1)),
        today: toDateStr(today),
      }),
      // Timer på de poster kandidaten erstatter — til lock-in-undtagelsen
      excludeIds.length > 0
        ? db.query.timeEntries.findMany({
            where: and(
              ownTimeEntriesInOrg(userId, orgId),
              inArray(timeEntries.id, excludeIds),
            ),
            columns: { hours: true },
          })
        : Promise.resolve([] as Array<{ hours: string | null }>),
    ]);
  const replacedHours = replacedRows.reduce(
    (sum, r) => sum + (Number(r.hours) || 0),
    0,
  );

  const entries: DatedTimeEntry[] = rows.map((r) => ({
    date: toDateStr(r.date),
    hours: Number(r.hours) || 0,
    startTime: r.startTime ?? null,
    endTime: r.endTime ?? null,
  }));

  const result = evaluateEntryCompliance({
    settings: rules,
    isSelfScheduler: false,
    candidate:
      input.candidate && candidateDate
        ? {
            date: toDateStr(candidateDate),
            hours: input.candidate.hours,
            startTime: input.candidate.startTime
              ? new Date(input.candidate.startTime)
              : null,
            endTime: input.candidate.endTime
              ? new Date(input.candidate.endTime)
              : null,
          }
        : undefined,
    weekStart: toDateStr(weekStartDate),
    entries,
    absenceDates,
    neutralAbsenceDates,
  });
  return downgradeBlocks(result, {
    neverBlock: input.neverBlock,
    candidateHours: input.candidate?.hours,
    replacedHours: excludeIds.length > 0 ? replacedHours : undefined,
  });
}

/**
 * Kast FORBIDDEN med dansk besked hvis en regel i block-tilstand er
 * overtrådt; ellers returnér advarslerne (til toast/banner i UI).
 */
export async function assertEntryCompliant(
  db: TxOrDb,
  input: ComplianceCheckInput,
): Promise<string[]> {
  const result = await checkEntryCompliance(db, input);
  if (!result.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "enterprise.compliance.rejected", {
        reasons: result.blocked.join(" · "),
      }),
    });
  }
  return result.warnings;
}
