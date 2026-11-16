import { buildCsv } from "./csv";

/**
 * Lønrapportens CSV-filer (#459): rene byggefunktioner så kolonnesættet kan
 * testes uden UI. Oversigten får én timer-kolonne pr. aktivitetstype med
 * timer i perioden; detaljerne får Aktivitet + Lønart pr. registrering.
 */

export type PayrollSummaryEmployee = {
  name: string;
  email: string;
  department: string;
  weeklyHours: number;
  totalHours: number;
  breakDeductedHours: number;
  flexDelta: number;
  absences: Record<string, number>;
  absenceHours: Record<string, number>;
  activityHours: Record<string, number>;
};

export function buildPayrollSummaryCsv(params: {
  employees: PayrollSummaryEmployee[];
  absenceTypes: string[];
  activityTypes: string[];
  showBreak: boolean;
}): string {
  const { employees, absenceTypes, activityTypes, showBreak } = params;
  return buildCsv(
    [
      "Medarbejder",
      "Email",
      "Afdeling",
      "Timer/uge",
      "Registrerede timer",
      ...activityTypes.map((t) => `${t} (timer)`),
      ...(showBreak ? ["Pause fratrukket (timer)"] : []),
      "Flex (+/-)",
      ...absenceTypes.map((t) => `${t} (dage)`),
      ...absenceTypes.map((t) => `${t} (timer)`),
    ],
    employees.map((e) => [
      e.name,
      e.email,
      e.department,
      e.weeklyHours,
      e.totalHours,
      ...activityTypes.map((t) => e.activityHours[t] ?? 0),
      ...(showBreak ? [e.breakDeductedHours] : []),
      e.flexDelta,
      ...absenceTypes.map((t) => e.absences[t] ?? 0),
      ...absenceTypes.map((t) => e.absenceHours[t] ?? 0),
    ]),
  );
}

export type PayrollDetailEntry = {
  name: string;
  email: string;
  department: string;
  date: string;
  hours: number;
  project: string;
  activity: string;
  payrollCode: string;
  description: string;
  source: string;
};

export function buildPayrollDetailsCsv(entries: PayrollDetailEntry[]): string {
  return buildCsv(
    [
      "Medarbejder",
      "Email",
      "Afdeling",
      "Dato",
      "Timer",
      "Projekt",
      "Aktivitet",
      "Lønart",
      "Beskrivelse",
      "Kilde",
    ],
    entries.map((e) => [
      e.name,
      e.email,
      e.department,
      e.date,
      e.hours,
      e.project,
      e.activity,
      e.payrollCode,
      e.description,
      e.source,
    ]),
  );
}
