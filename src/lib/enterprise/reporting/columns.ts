import { sharedT } from "@/i18n/shared-text";

/**
 * Kolonnekatalog for enterprise-rapporter (E4, #462) — danske labels, format
 * og hvilken slags kolonne det er:
 *
 *   dimension  — nøglen rapporten er grupperet på (vises kun hvis dimensionen
 *                er valgt; ellers tom)
 *   attribute  — medarbejder-felt der følger employee-dimensionen
 *   measure    — aggregeret mål (sum/antal/procent)
 *   pivot      — udfoldes til én kolonne pr. type i datasættet
 *                (fx "Sygdom (dage)", "Ferie (dage)")
 *
 * ÉT mapping herfra driver tabel, CSV, XLSX og PDF (render.ts).
 * `payrollCode` er lønart fra activity_types; `employeeNumber` og pivoten
 * `quantityByWageType` (antal pr. lønart via mapping-motoren) kom med E5.
 */

export type ColumnFormat =
  | "text"
  | "hours"
  | "days"
  | "percent"
  | "integer"
  | "boolean";

export type ColumnKind = "dimension" | "attribute" | "measure" | "pivot";

export type EnterpriseColumnDef = {
  label: string;
  format: ColumnFormat;
  kind: ColumnKind;
  /** Kort forklaring til builderen */
  help?: string;
  /** Pivot-kolonnens label-skabelon: {name} erstattes med typenavn */
  pivotLabel?: string;
};

export const ENTERPRISE_COLUMNS = {
  // Dimensioner
  employee: { label: "Medarbejder", format: "text", kind: "dimension" },
  department: { label: "Afdeling", format: "text", kind: "dimension" },
  project: { label: "Projekt", format: "text", kind: "dimension" },
  activityType: { label: "Aktivitet", format: "text", kind: "dimension" },
  absenceType: { label: "Fraværstype", format: "text", kind: "dimension" },
  day: { label: "Dato", format: "text", kind: "dimension" },
  week: { label: "Uge", format: "text", kind: "dimension" },
  month: { label: "Måned", format: "text", kind: "dimension" },
  vacationYear: { label: "Ferieår", format: "text", kind: "dimension" },

  // Medarbejder-attributter (følger employee-dimensionen)
  email: { label: "Email", format: "text", kind: "attribute" },
  employmentType: {
    label: "Ansættelsestype",
    format: "text",
    kind: "attribute",
  },
  weeklyHours: { label: "Timer/uge", format: "hours", kind: "attribute" },
  dailyNorm: { label: "Dagsnorm", format: "hours", kind: "attribute" },
  employeeNumber: {
    label: "Medarbejdernr.",
    format: "text",
    kind: "attribute",
    help: "Medarbejdernummer i lønsystemet (følger medarbejder-dimensionen)",
  },
  payrollCode: {
    label: "Lønart",
    format: "text",
    kind: "attribute",
    help: "Lønart fra aktivitetstypen (følger aktivitet-dimensionen)",
  },

  // Mål — tid
  hours: { label: "Registrerede timer", format: "hours", kind: "measure" },
  normHours: {
    label: "Normtid",
    format: "hours",
    kind: "measure",
    help: "Dagsnorm × arbejdsdage i perioden (helligdage fratrukket)",
  },
  workDays: {
    label: "Arbejdsdage",
    format: "days",
    kind: "measure",
    help: "Planlagte arbejdsdage i perioden (uden helligdage/lukkedage)",
  },
  employeeCount: {
    label: "Antal medarbejdere",
    format: "integer",
    kind: "measure",
  },
  flexDelta: { label: "Flex (+/-)", format: "hours", kind: "measure" },
  breakDeductedHours: {
    label: "Pause fratrukket",
    format: "hours",
    kind: "measure",
    help: "Kun ved ubetalt pause (check-ind/ud)",
  },
  checkInHours: {
    label: "Tilstedeværelse (check-ind)",
    format: "hours",
    kind: "measure",
  },

  // Mål — compliance (E11, #469): pr. medarbejder-dag/-uge i gruppen
  workedDays: {
    label: "Dage med registreringer",
    format: "integer",
    kind: "measure",
  },
  maxDayHours: {
    label: "Længste dag",
    format: "hours",
    kind: "measure",
    help: "Højeste dagsum for én medarbejder i gruppen",
  },
  longDays: {
    label: "Dage over 13 t",
    format: "integer",
    kind: "measure",
    help: "Dagsum over 13 t levner under 11 t hvile (11-timers-reglen)",
  },
  avgWeeklyHours: {
    label: "Gns. timer/uge",
    format: "hours",
    kind: "measure",
    help: "Registrerede timer pr. medarbejder-uge med registreringer eller fravær (48-timers-reglen)",
  },
  weeksOver48h: {
    label: "Uger over 48 t",
    format: "integer",
    kind: "measure",
    help: "Antal medarbejder-uger med over 48 t registreret",
  },
  fullWeeks: {
    label: "Uger uden fridag",
    format: "integer",
    kind: "measure",
    help: "Uger med registreringer alle 7 dage og ingen fraværsdag (24 t ugehvile)",
  },

  // Mål — fravær
  absenceDays: { label: "Fravær (dage)", format: "days", kind: "measure" },
  absenceHours: { label: "Fravær (timer)", format: "hours", kind: "measure" },
  absencePeriods: {
    label: "Fraværsperioder",
    format: "integer",
    kind: "measure",
  },
  sickDays: { label: "Sygedage", format: "days", kind: "measure" },
  sickHours: { label: "Sygetimer", format: "hours", kind: "measure" },
  sickPeriods: { label: "Sygeperioder", format: "integer", kind: "measure" },
  sickPct: {
    label: "Sygefravær %",
    format: "percent",
    kind: "measure",
    help: "Sygedage / arbejdsdage",
  },
  longTermSick: {
    label: "Langtidssyg",
    format: "boolean",
    kind: "measure",
    help: "Sammenhængende sygeperiode over 30 dage i perioden",
  },
  longTermSickCount: {
    label: "Langtidssyge",
    format: "integer",
    kind: "measure",
    help: "Antal medarbejdere med sygeperiode over 30 dage",
  },

  // Mål — overtid
  overtimeEarned: {
    label: "Overtid optjent",
    format: "hours",
    kind: "measure",
  },
  overtimeUsed: {
    label: "Afspadseret",
    format: "hours",
    kind: "measure",
  },
  overtimePaidOut: {
    label: "Overtid udbetalt",
    format: "hours",
    kind: "measure",
  },
  overtimeNet: {
    label: "Overtid netto",
    format: "hours",
    kind: "measure",
    help: "Optjent − afspadseret − udbetalt",
  },

  // Mål — ferieregnskab (pr. ferieår)
  vacationAllotted: {
    label: "Ferie tildelt",
    format: "days",
    kind: "measure",
  },
  vacationUsed: { label: "Ferie brugt", format: "days", kind: "measure" },
  vacationRemaining: {
    label: "Ferie rest",
    format: "days",
    kind: "measure",
  },
  extraVacationAllotted: {
    label: "Feriefridage tildelt",
    format: "days",
    kind: "measure",
  },
  extraVacationUsed: {
    label: "Feriefridage brugt",
    format: "days",
    kind: "measure",
  },
  extraVacationRemaining: {
    label: "Feriefridage rest",
    format: "days",
    kind: "measure",
  },
  vacationDaysInPeriod: {
    label: "Ferie afholdt i perioden",
    format: "days",
    kind: "measure",
    help: "Feriedage (typer der trækker feriesaldo) inden for rapportperioden",
  },

  // Pivot-kolonner
  hoursByActivity: {
    label: "Timer pr. aktivitet",
    format: "hours",
    kind: "pivot",
    pivotLabel: "{name} (timer)",
  },
  absenceDaysByType: {
    label: "Fravær pr. type (dage)",
    format: "days",
    kind: "pivot",
    pivotLabel: "{name} (dage)",
  },
  absenceHoursByType: {
    label: "Fravær pr. type (timer)",
    format: "hours",
    kind: "pivot",
    pivotLabel: "{name} (timer)",
  },
  quantityByWageType: {
    label: "Antal pr. lønart",
    format: "hours",
    kind: "pivot",
    pivotLabel: "{name}",
    help: "Timer/dage pr. lønart via lønmapping (Indstillinger → Løn)",
  },
} as const satisfies Record<string, EnterpriseColumnDef>;

export type EnterpriseColumnKey = keyof typeof ENTERPRISE_COLUMNS;

export const ENTERPRISE_COLUMN_KEYS = Object.keys(
  ENTERPRISE_COLUMNS,
) as EnterpriseColumnKey[];

export function columnDef(key: EnterpriseColumnKey): EnterpriseColumnDef {
  return ENTERPRISE_COLUMNS[key];
}

/** Kolonnegrupper til builderens checkbokse. */
export const COLUMN_GROUPS: Array<{
  label: string;
  keys: EnterpriseColumnKey[];
}> = [
  {
    label: "Dimensioner",
    keys: [
      "employee",
      "department",
      "project",
      "activityType",
      "absenceType",
      "day",
      "week",
      "month",
      "vacationYear",
    ],
  },
  {
    label: "Medarbejder",
    keys: [
      "email",
      "employeeNumber",
      "employmentType",
      "weeklyHours",
      "dailyNorm",
      "payrollCode",
    ],
  },
  {
    label: "Tid",
    keys: [
      "hours",
      "normHours",
      "workDays",
      "employeeCount",
      "flexDelta",
      "breakDeductedHours",
      "checkInHours",
      "hoursByActivity",
    ],
  },
  {
    label: "Compliance",
    keys: [
      "workedDays",
      "maxDayHours",
      "longDays",
      "avgWeeklyHours",
      "weeksOver48h",
      "fullWeeks",
    ],
  },
  {
    label: "Fravær",
    keys: [
      "absenceDays",
      "absenceHours",
      "absencePeriods",
      "absenceDaysByType",
      "absenceHoursByType",
      "sickDays",
      "sickHours",
      "sickPeriods",
      "sickPct",
      "longTermSick",
      "longTermSickCount",
    ],
  },
  {
    label: "Overtid",
    keys: ["overtimeEarned", "overtimeUsed", "overtimePaidOut", "overtimeNet"],
  },
  {
    label: "Løn",
    keys: ["quantityByWageType"],
  },
  {
    label: "Ferieregnskab",
    keys: [
      "vacationAllotted",
      "vacationUsed",
      "vacationRemaining",
      "extraVacationAllotted",
      "extraVacationUsed",
      "extraVacationRemaining",
      "vacationDaysInPeriod",
    ],
  },
];

/** Formatér en celle til visning/CSV (dansk decimalkomma). */
export function formatCellValue(
  value: string | number | boolean | null | undefined,
  format: ColumnFormat,
): string {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") {
    return sharedT("sharedFormat", value ? "yes" : "no");
  }
  if (typeof value === "string") return value;
  switch (format) {
    case "integer":
      return String(Math.round(value));
    case "percent":
      return `${value.toFixed(1).replace(".", ",")} %`;
    case "hours":
    case "days":
      return value.toFixed(2).replace(".", ",");
    default:
      return String(value);
  }
}

/** Kolonnens label på kaldets sprog (`ENTERPRISE_COLUMNS[k].label` er den danske standard). */
export function enterpriseColumnLabel(
  key: EnterpriseColumnKey,
  locale?: string | null,
): string {
  return sharedT(
    "enterpriseReports",
    `columns.${key}.label`,
    undefined,
    locale,
  );
}

/** Pivot-kolonnens label for ét typenavn ("Sygdom (dage)"). */
export function enterprisePivotLabel(
  key: EnterpriseColumnKey,
  name: string,
  locale?: string | null,
): string {
  switch (key) {
    case "absenceDaysByType":
      return sharedT("sharedReports", "enterprise.pivotDays", { name }, locale);
    case "quantityByWageType":
      return name;
    default:
      return sharedT(
        "sharedReports",
        "enterprise.pivotHours",
        { name },
        locale,
      );
  }
}
