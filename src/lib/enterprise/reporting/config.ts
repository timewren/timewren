/**
 * Enterprise-rapport-config (E4, #462) — gemmes som jsonb i report_templates
 * med `reportType` som diskriminator, så freelance-motoren (reportType
 * "time") og enterprise-typerne deler tabel, skabeloner og planlægning.
 * Ren zod — deles af klient (builder) og server (run/export/cron).
 */
import { z } from "zod";
import { copenhagenTodayAnchor } from "@/lib/time/copenhagen";
import { getPeriodPreset, type PeriodPreset } from "../period";
import { vacationYearRange } from "./aggregate";
import { ENTERPRISE_COLUMN_KEYS, type EnterpriseColumnKey } from "./columns";

export const ENTERPRISE_REPORT_TYPES = [
  "payroll",
  "sickness",
  "absence",
  "flex_overtime",
  "project_activity",
  "vacation_account",
  "compliance",
  "custom",
] as const;
export type EnterpriseReportType = (typeof ENTERPRISE_REPORT_TYPES)[number];

export const REPORT_DIMENSIONS = [
  "employee",
  "department",
  "project",
  "activityType",
  "absenceType",
  "day",
  "week",
  "month",
  "vacationYear",
] as const;
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<ReportDimension, string> = {
  employee: "Medarbejder",
  department: "Afdeling",
  project: "Projekt",
  activityType: "Aktivitet",
  absenceType: "Fraværstype",
  day: "Dag",
  week: "Uge",
  month: "Måned",
  vacationYear: "Ferieår",
};

const PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
  "last_year",
] as const satisfies readonly PeriodPreset[];

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportPeriodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), preset: z.enum(PERIOD_PRESETS) }),
  z.object({ kind: z.literal("custom"), from: dateString, to: dateString }),
  /** Ferieår — startår (fx 2025 = 2025/26 ved 1/9-start, ellers kalenderår) */
  z.object({
    kind: z.literal("vacationYear"),
    year: z.number().int().min(2000).max(2100),
  }),
]);
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

export const reportFiltersSchema = z.object({
  departmentIds: z.array(z.string().uuid()).max(100).default([]),
  userIds: z.array(z.string()).max(500).default([]),
  projectIds: z.array(z.string().uuid()).max(200).default([]),
  activityTypeIds: z.array(z.string().uuid()).max(100).default([]),
  absenceTypeIds: z.array(z.string().uuid()).max(100).default([]),
  absenceCategories: z
    .array(z.enum(["vacation", "sickness", "leave", "other"]))
    .max(4)
    .default([]),
  /** Kun timer med approvalStatus = approved */
  onlyApproved: z.boolean().default(false),
  /** Medtag afviste timer (default: ekskluderet, #462) */
  includeRejected: z.boolean().default(false),
  /** Fraværsstatusser der tæller (default kun godkendt) */
  absenceStatuses: z
    .array(z.enum(["approved", "pending"]))
    .min(1)
    .default(["approved"]),
  /** Medtag inaktive (fratrådte) medarbejdere */
  includeInactive: z.boolean().default(false),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const enterpriseReportConfigSchema = z.object({
  reportType: z.enum(ENTERPRISE_REPORT_TYPES),
  period: reportPeriodSchema,
  filters: reportFiltersSchema.default(() => reportFiltersSchema.parse({})),
  dimensions: z.array(z.enum(REPORT_DIMENSIONS)).max(4).default([]),
  columns: z.array(z.enum(ENTERPRISE_COLUMN_KEYS)).min(1).max(60),
  /** Detaljerækker (én pr. tidspost) — kun løn/custom; cappes server-side */
  includeDetails: z.boolean().default(false),
  title: z.string().max(120).optional(),
});
export type EnterpriseReportConfig = z.infer<
  typeof enterpriseReportConfigSchema
>;

/** Kolonner der er tilladt for enhver type; typerne begrænser ikke yderligere. */
export type ReportTypeDefinition = {
  type: EnterpriseReportType;
  label: string;
  description: string;
  /** Kun HR/admin/owner (løn er persondata for hele org'en) */
  restricted: boolean;
  defaultDimensions: ReportDimension[];
  defaultColumns: EnterpriseColumnKey[];
  /** Kolonner som builderen foreslår først for typen */
  suggestedColumns: EnterpriseColumnKey[];
  supportsDetails: boolean;
};

export const REPORT_TYPE_DEFINITIONS: Record<
  EnterpriseReportType,
  ReportTypeDefinition
> = {
  payroll: {
    type: "payroll",
    label: "Lønrapport",
    description:
      "Pr. medarbejder for lønperioden: timer, fravær i dage og timer pr. type, flex, overtid og pausefradrag. Til lønkontoret.",
    restricted: true,
    defaultDimensions: ["employee"],
    defaultColumns: [
      "employee",
      "employeeNumber",
      "email",
      "department",
      "weeklyHours",
      "hours",
      "hoursByActivity",
      "breakDeductedHours",
      "flexDelta",
      "overtimeEarned",
      "overtimeUsed",
      "absenceDaysByType",
      "absenceHoursByType",
      "quantityByWageType",
    ],
    suggestedColumns: [
      "employee",
      "employeeNumber",
      "email",
      "department",
      "employmentType",
      "weeklyHours",
      "normHours",
      "hours",
      "hoursByActivity",
      "breakDeductedHours",
      "checkInHours",
      "flexDelta",
      "overtimeEarned",
      "overtimeUsed",
      "overtimePaidOut",
      "absenceDays",
      "absenceHours",
      "absenceDaysByType",
      "absenceHoursByType",
      "quantityByWageType",
    ],
    supportsDetails: true,
  },
  sickness: {
    type: "sickness",
    label: "Sygefravær",
    description:
      "Sygefraværsstatistik pr. afdeling og måned: sygedage, perioder, fraværsprocent og langtidssygdom (over 30 dage).",
    restricted: false,
    defaultDimensions: ["department", "month"],
    defaultColumns: [
      "department",
      "month",
      "employeeCount",
      "workDays",
      "sickDays",
      "sickHours",
      "sickPeriods",
      "sickPct",
      "longTermSickCount",
    ],
    suggestedColumns: [
      "department",
      "month",
      "employee",
      "employeeCount",
      "workDays",
      "sickDays",
      "sickHours",
      "sickPeriods",
      "sickPct",
      "longTermSick",
      "longTermSickCount",
    ],
    supportsDetails: false,
  },
  absence: {
    type: "absence",
    label: "Fravær",
    description:
      "Alle fraværstyper (ferie, sygdom, orlov, omsorg…) pr. medarbejder eller afdeling — dage og timer.",
    restricted: false,
    defaultDimensions: ["employee", "absenceType"],
    defaultColumns: [
      "employee",
      "department",
      "absenceType",
      "absenceDays",
      "absenceHours",
      "absencePeriods",
    ],
    suggestedColumns: [
      "employee",
      "department",
      "absenceType",
      "month",
      "absenceDays",
      "absenceHours",
      "absencePeriods",
      "absenceDaysByType",
      "absenceHoursByType",
    ],
    supportsDetails: false,
  },
  flex_overtime: {
    type: "flex_overtime",
    label: "Flex og overtid",
    description:
      "Periodiseret saldo-udvikling: normtid, registrerede timer, flex-delta og optjent/afspadseret/udbetalt overtid.",
    restricted: false,
    defaultDimensions: ["employee", "month"],
    defaultColumns: [
      "employee",
      "department",
      "month",
      "normHours",
      "hours",
      "flexDelta",
      "overtimeEarned",
      "overtimeUsed",
      "overtimePaidOut",
      "overtimeNet",
    ],
    suggestedColumns: [
      "employee",
      "department",
      "week",
      "month",
      "normHours",
      "hours",
      "flexDelta",
      "overtimeEarned",
      "overtimeUsed",
      "overtimePaidOut",
      "overtimeNet",
    ],
    supportsDetails: false,
  },
  project_activity: {
    type: "project_activity",
    label: "Projekt og aktivitet",
    description:
      "Timer fordelt på projekt, aktivitetstype og afdeling — til opfølgning på undervisning, forberedelse, møder m.m.",
    restricted: false,
    defaultDimensions: ["project", "activityType", "department"],
    defaultColumns: [
      "project",
      "activityType",
      "payrollCode",
      "department",
      "hours",
      "employeeCount",
    ],
    suggestedColumns: [
      "project",
      "activityType",
      "payrollCode",
      "department",
      "employee",
      "month",
      "hours",
      "hoursByActivity",
      "employeeCount",
    ],
    supportsDetails: true,
  },
  vacation_account: {
    type: "vacation_account",
    label: "Ferieregnskab",
    description:
      "Ferieregnskab pr. ferieår: tildelt, brugt og rest for ferie og feriefridage — pr. medarbejder.",
    restricted: false,
    defaultDimensions: ["employee", "vacationYear"],
    defaultColumns: [
      "employee",
      "department",
      "vacationYear",
      "vacationAllotted",
      "vacationUsed",
      "vacationRemaining",
      "extraVacationAllotted",
      "extraVacationUsed",
      "extraVacationRemaining",
      "vacationDaysInPeriod",
    ],
    suggestedColumns: [
      "employee",
      "department",
      "vacationYear",
      "vacationAllotted",
      "vacationUsed",
      "vacationRemaining",
      "extraVacationAllotted",
      "extraVacationUsed",
      "extraVacationRemaining",
      "vacationDaysInPeriod",
    ],
    supportsDetails: false,
  },
  compliance: {
    type: "compliance",
    label: "Compliance (arbejdstidsloven)",
    description:
      "Overtrædelser og advarsler pr. medarbejder og uge: dage over 13 t (11 t hvile), uger over 48 t, uger uden fridag (24 t ugehvile) og gennemsnitlig ugentlig arbejdstid.",
    restricted: false,
    defaultDimensions: ["employee", "week"],
    defaultColumns: [
      "employee",
      "department",
      "week",
      "hours",
      "workedDays",
      "maxDayHours",
      "longDays",
      "weeksOver48h",
      "fullWeeks",
      "absenceDays",
    ],
    suggestedColumns: [
      "employee",
      "department",
      "week",
      "month",
      "hours",
      "normHours",
      "workedDays",
      "maxDayHours",
      "longDays",
      "avgWeeklyHours",
      "weeksOver48h",
      "fullWeeks",
      "absenceDays",
    ],
    supportsDetails: true,
  },
  custom: {
    type: "custom",
    label: "Tilpasset",
    description:
      "Frit valg af dimensioner og kolonner fra hele kataloget — byg præcis den rapport I mangler.",
    restricted: false,
    defaultDimensions: ["employee"],
    defaultColumns: ["employee", "department", "hours", "absenceDays"],
    suggestedColumns: [...ENTERPRISE_COLUMN_KEYS],
    supportsDetails: true,
  },
};

/** Standard-config for en type (bruges af builderen og seedede skabeloner). */
export function defaultConfigFor(
  type: EnterpriseReportType,
): EnterpriseReportConfig {
  const def = REPORT_TYPE_DEFINITIONS[type];
  return enterpriseReportConfigSchema.parse({
    reportType: type,
    period:
      type === "vacation_account"
        ? { kind: "preset", preset: "this_year" }
        : { kind: "preset", preset: "last_month" },
    filters: {},
    dimensions: def.defaultDimensions,
    columns: def.defaultColumns,
    includeDetails: false,
  });
}

/**
 * Default-startmåned for ferieåret når org-indstillingen ikke er kendt
 * (kalenderår). Serveren (run.ts) og builderen sender org'ens
 * vacationYearStartMonth (#461) — 9 = ferielovens 1/9–31/8.
 */
export const VACATION_YEAR_START_MONTH = 1;

/** Konkret fra/til for en rapportperiode (ren — bruges også i builderen). */
export function resolveReportPeriod(
  period: ReportPeriod,
  now: Date = copenhagenTodayAnchor(),
  vacationYearStartMonth: number = VACATION_YEAR_START_MONTH,
): { from: string; to: string } {
  switch (period.kind) {
    case "preset":
      return getPeriodPreset(period.preset, now);
    case "custom":
      return { from: period.from, to: period.to };
    case "vacationYear":
      return vacationYearRange(period.year, vacationYearStartMonth);
  }
}

/** Er configen en enterprise-config (vs. freelance "time")? Ren type-guard. */
export function isEnterpriseReportType(
  value: unknown,
): value is EnterpriseReportType {
  return (
    typeof value === "string" &&
    (ENTERPRISE_REPORT_TYPES as readonly string[]).includes(value)
  );
}
