/**
 * Rapport-datasættet (E4, #462): ét normaliseret, DB-frit datasæt som alle
 * enterprise-rapporter (løn, sygdom, fravær, flex/overtid, projekt/aktivitet,
 * ferieregnskab, custom) aggregeres fra. dataset.ts bygger det fra DB;
 * aggregate.ts er ren og testbar.
 *
 * Fakta er allerede org-scopede og scope-filtrerede (getVisibleScope) når de
 * ligger her — aggregeringen filtrerer kun på rapportens egne filtre.
 */
import type { PayrollMappingConfig } from "../payroll/mapping";

/**
 * Ansættelsesperiode med færdigberegnet dagsnorm (#465) — rapportlaget slår
 * normen op pr. dato uden at kende org-indstillingerne.
 */
export type EmploymentNorm = {
  validFrom: string | null;
  validTo: string | null;
  weeklyHours: number;
  dailyNorm: number;
  workingDays: string[];
  departmentId: string | null;
};

export type DatasetEmployee = {
  userId: string;
  profileId: string;
  name: string;
  email: string;
  departmentId: string | null;
  departmentName: string;
  employmentType: string;
  weeklyHours: number;
  /** Dagsnorm via calculateDailyNorm (org-indstillinger + profil) — nuværende */
  dailyNorm: number;
  /** ISO-ugedage "1".."7" — nuværende */
  workingDays: string[];
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  /** Medarbejdernummer i lønsystemet (E5) — tom når ikke sat */
  employeeNumber: string;
  externalPayrollId: string;
  /**
   * Ansættelseshistorik (#465), kronologisk. Tom = ingen historik →
   * dailyNorm/workingDays gælder alle datoer (bagudkompatibelt).
   */
  employment: EmploymentNorm[];
};

/** Timer pr. (medarbejder, dag, projekt, aktivitet, kilde, status) — SQL-aggregeret */
export type TimeFact = {
  userId: string;
  date: string;
  projectId: string | null;
  projectName: string;
  activityTypeId: string | null;
  activityTypeName: string;
  payrollCode: string;
  source: string;
  approvalStatus: string;
  hours: number;
};

/** Én fraværsdag (eller brøkdel) udfoldet fra en absence_request */
export type AbsenceFact = {
  userId: string;
  date: string;
  requestId: string;
  absenceTypeId: string;
  absenceTypeName: string;
  category: string; // vacation | sickness | leave | other
  vacationPool: string; // vacation | extra
  deductsVacation: boolean;
  /** Afspadsering — ikke neutral i 48 t-gennemsnittet (#728) */
  deductsOvertime?: boolean;
  status: string;
  source: string;
  /** Andel af en dag: 1, 0,5 eller timer/dagsnorm */
  days: number;
  hours: number;
  /** Åben periode (uden slutdato) */
  isOpen: boolean;
};

/** Én fraværsperiode (= én absence_request) med effektiv længde */
export type AbsencePeriod = {
  requestId: string;
  userId: string;
  absenceTypeId: string;
  absenceTypeName: string;
  category: string;
  status: string;
  startDate: string;
  /** Registreret slutdato eller i dag for åbne perioder */
  effectiveEndDate: string;
  /** Kalenderdage start..effektiv slut (begge inkl.) */
  calendarDays: number;
  isOpen: boolean;
};

export type FlexFact = {
  userId: string;
  date: string;
  expectedHours: number;
  actualHours: number;
  delta: number;
};

export type OvertimeFact = {
  userId: string;
  date: string;
  /** earned | used | paid_out | other */
  type: string;
  hours: number;
};

export type CheckInFact = {
  userId: string;
  date: string;
  /** Brutto-tilstedeværelse (check-ind → check-ud) */
  hours: number;
  /** Ubetalt pause fratrukket (kun ved policy unpaid_excluded) */
  breakDeductedHours: number;
};

export type CalendarDay = {
  date: string;
  /** Fridag efter kalenderen (normtid) — også egne firmafridage */
  isHoliday: boolean;
  /**
   * Helligdag i lønnens forstand (#742): lovbestemt helligdag eller valgfri
   * dag, kalenderen giver fri — ikke egne firmafridage. Se isPayrollHoliday.
   */
  isPayrollHoliday: boolean;
  isHalfHoliday: boolean;
  holidayName: string | null;
  /** Dækket af en lukkeperiode (org_closure_periods) */
  isClosure: boolean;
};

export type VacationBalanceFact = {
  userId: string;
  year: number;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  extraTotalDays: number;
  extraUsedDays: number;
  extraRemainingDays: number;
};

export type EnterpriseDataset = {
  orgId: string;
  from: string;
  to: string;
  /** Dags dato (YYYY-MM-DD) — åbne perioder tæller til og med denne */
  today: string;
  employees: DatasetEmployee[];
  calendar: CalendarDay[];
  /**
   * Fridage pr. medarbejder (#526): userId → dato → er halv dag. Når en
   * medarbejder findes her, er det hans kalender (afdeling/egen), der
   * gælder for normtiden — ellers den fælles `calendar`.
   */
  daysOffByUser?: Record<string, Record<string, boolean>>;
  /**
   * Løn-helligdage pr. medarbejder (#742) efter hans kalender (afdeling >
   * org > standard) — lønreglernes dagbetingelse "helligdag".
   */
  payrollHolidaysByUser?: Record<string, string[]>;
  time: TimeFact[];
  absence: AbsenceFact[];
  absencePeriods: AbsencePeriod[];
  flex: FlexFact[];
  overtime: OvertimeFact[];
  checkIns: CheckInFact[];
  vacationBalances: VacationBalanceFact[];
  /** Fraværstyper i org'en (til kolonne-pivot, filtre og lønart-fallback) */
  absenceTypes: Array<{
    id: string;
    name: string;
    category: string;
    payrollCode: string;
  }>;
  activityTypes: Array<{ id: string; name: string; payrollCode: string }>;
  breakPolicy: string;
  /** Lønarter + mapping-regler (E5) — tom config = kun fallback-koder */
  payroll: PayrollMappingConfig;
};
