/**
 * Lønmapping-motor (E5, #463): fakta fra rapport-datasættet (timer pr.
 * aktivitet, fraværsdage, overtid, flex, pausefradrag) → linjer pr.
 * (medarbejder, dag, lønart). Ren og deterministisk — ingen DB, ingen I/O.
 *
 * Regler:
 *   - En regel matcher når kilden passer, typen passer (specifik id eller
 *     NULL = alle typer af kilden) og dagsbetingelsen passer (any/weekend/
 *     helligdag).
 *   - Laveste `priority` vinder. Ved lighed vinder den mest specifikke
 *     (specifik type > alle typer; dagsbetingelse > any).
 *   - Lønarter af typen `supplement` (tillæg) er ADDITIVE: de lægges oven
 *     på grundlønarten (fx weekendtillæg + almindelige timer). Alle andre
 *     er eksklusive — kun den bedste regel bruges.
 *   - Fallback uden regel: aktivitetstypens/fraværstypens payroll_code.
 *     Findes heller ikke den, ender faktaen i `unmapped` så lønkontoret
 *     kan se hvad der mangler. Flex og pausefradrag eksporteres KUN når en
 *     regel findes (de er afledte tal, ikke lønudløsende i sig selv).
 *   - Afrunding sker først når linjerne summeres (summarizeWageLines), så
 *     0,333 + 0,333 + 0,334 bliver 1,00 og ikke 0,99.
 */
import type {
  AbsenceFact,
  CalendarDay,
  CheckInFact,
  DatasetEmployee,
  FlexFact,
  OvertimeFact,
  TimeFact,
} from "../reporting/types";

export const WAGE_TYPE_UNITS = ["hours", "days"] as const;
export type WageTypeUnit = (typeof WAGE_TYPE_UNITS)[number];

export const WAGE_TYPE_KINDS = ["time", "absence", "supplement"] as const;
export type WageTypeKind = (typeof WAGE_TYPE_KINDS)[number];

export const MAPPING_SOURCES = [
  "activity",
  "absence",
  "overtime_earned",
  "overtime_used",
  "overtime_paid_out",
  "flex_positive",
  "flex_negative",
  "break_deduction",
] as const;
export type MappingSource = (typeof MAPPING_SOURCES)[number];

export const DAY_CONDITIONS = [
  "any",
  "weekend",
  "holiday",
  "weekend_or_holiday",
] as const;
export type DayCondition = (typeof DAY_CONDITIONS)[number];

export const WAGE_TYPE_UNIT_LABELS: Record<WageTypeUnit, string> = {
  hours: "Timer",
  days: "Dage",
};

export const WAGE_TYPE_KIND_LABELS: Record<WageTypeKind, string> = {
  time: "Tid (grundlønart)",
  absence: "Fravær",
  supplement: "Tillæg (lægges oven på)",
};

export const MAPPING_SOURCE_LABELS: Record<MappingSource, string> = {
  activity: "Registrerede timer (aktivitet)",
  absence: "Fravær (fraværstype)",
  overtime_earned: "Overtid optjent",
  overtime_used: "Afspadsering",
  overtime_paid_out: "Overtid udbetalt",
  flex_positive: "Flex (plus-timer)",
  flex_negative: "Flex (minus-timer)",
  break_deduction: "Pausefradrag (ubetalt pause)",
};

export const DAY_CONDITION_LABELS: Record<DayCondition, string> = {
  any: "Alle dage",
  weekend: "Weekend (lør/søn)",
  holiday: "Helligdag",
  weekend_or_holiday: "Weekend eller helligdag",
};

export type WageType = {
  id: string;
  code: string;
  name: string;
  unit: WageTypeUnit;
  kind: WageTypeKind;
  isArchived: boolean;
};

export type MappingRule = {
  id: string;
  wageTypeId: string;
  source: MappingSource;
  /** NULL = alle aktivitetstyper (kun source = activity) */
  activityTypeId: string | null;
  /** NULL = alle fraværstyper (kun source = absence) */
  absenceTypeId: string | null;
  dayCondition: DayCondition;
  priority: number;
  isArchived: boolean;
};

export type PayrollMappingConfig = {
  wageTypes: WageType[];
  rules: MappingRule[];
};

export const EMPTY_PAYROLL_CONFIG: PayrollMappingConfig = {
  wageTypes: [],
  rules: [],
};

export type WageLine = {
  userId: string;
  date: string;
  source: MappingSource;
  /** NULL = fallback-kode fra aktivitets-/fraværstypen (ingen regel) */
  wageTypeId: string | null;
  code: string;
  name: string;
  unit: WageTypeUnit;
  quantity: number;
  /** Tillæg (additiv linje) */
  supplement: boolean;
  projectId: string | null;
  projectName: string;
  activityTypeId: string | null;
  activityTypeName: string;
  absenceTypeId: string | null;
  absenceTypeName: string;
};

export type UnmappedFact = {
  userId: string;
  date: string;
  source: MappingSource;
  /** Aktivitets-/fraværstypens navn eller kildens label */
  label: string;
  unit: WageTypeUnit;
  quantity: number;
};

export type MappingResult = {
  lines: WageLine[];
  unmapped: UnmappedFact[];
};

export type DayInfo = { isWeekend: boolean; isHoliday: boolean };

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isWeekendDate(date: string): boolean {
  const dow = parseDate(date).getDay();
  return dow === 0 || dow === 6;
}

/**
 * Dagsinfo pr. dato og medarbejder. "Helligdag" = løn-helligdag (#742):
 * lovbestemt helligdag eller valgfri dag, kalenderen giver hel eller halv
 * fri — ikke egne firmafridage. Medarbejderens egen (afdelings)kalender
 * bruges, når den kendes; ellers den fælles rapportkalender.
 */
export function buildDayInfoLookup(
  calendar: readonly CalendarDay[],
  byUser?: Readonly<Record<string, readonly string[]>>,
): (date: string, userId?: string) => DayInfo {
  const shared = new Set(
    calendar.filter((d) => d.isPayrollHoliday).map((d) => d.date),
  );
  const perUser = new Map<string, Set<string>>();
  for (const [userId, dates] of Object.entries(byUser ?? {})) {
    perUser.set(userId, new Set(dates));
  }
  return (date, userId) => ({
    isWeekend: isWeekendDate(date),
    isHoliday: ((userId && perUser.get(userId)) || shared).has(date),
  });
}

export function dayConditionMatches(
  condition: DayCondition,
  day: DayInfo,
): boolean {
  switch (condition) {
    case "any":
      return true;
    case "weekend":
      return day.isWeekend;
    case "holiday":
      return day.isHoliday;
    case "weekend_or_holiday":
      return day.isWeekend || day.isHoliday;
  }
}

export type MatchContext = {
  source: MappingSource;
  activityTypeId?: string | null;
  absenceTypeId?: string | null;
  day: DayInfo;
};

function ruleSpecificity(rule: MappingRule): number {
  let score = 0;
  if (rule.activityTypeId || rule.absenceTypeId) score += 2;
  if (rule.dayCondition !== "any") score += 1;
  return score;
}

/** Sortér kandidater: prioritet (lav først), derefter mest specifik først. */
export function sortRules(rules: MappingRule[]): MappingRule[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const spec = ruleSpecificity(b) - ruleSpecificity(a);
    if (spec !== 0) return spec;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Find den vindende (eksklusive) regel og alle matchende tillægsregler for
 * en fakta. Arkiverede regler og regler til arkiverede lønarter ignoreres.
 */
export function matchRules(
  config: PayrollMappingConfig,
  ctx: MatchContext,
): { primary: MappingRule | null; supplements: MappingRule[] } {
  const wageTypeById = new Map(config.wageTypes.map((w) => [w.id, w]));
  const candidates = config.rules.filter((r) => {
    if (r.isArchived || r.source !== ctx.source) return false;
    const wt = wageTypeById.get(r.wageTypeId);
    if (!wt || wt.isArchived) return false;
    if (
      ctx.source === "activity" &&
      r.activityTypeId &&
      r.activityTypeId !== (ctx.activityTypeId ?? null)
    ) {
      return false;
    }
    if (
      ctx.source === "absence" &&
      r.absenceTypeId &&
      r.absenceTypeId !== (ctx.absenceTypeId ?? null)
    ) {
      return false;
    }
    return dayConditionMatches(r.dayCondition, ctx.day);
  });
  const sorted = sortRules(candidates);
  let primary: MappingRule | null = null;
  const supplements: MappingRule[] = [];
  const seenSupplement = new Set<string>();
  for (const r of sorted) {
    const wt = wageTypeById.get(r.wageTypeId);
    if (!wt) continue;
    if (wt.kind === "supplement") {
      if (!seenSupplement.has(wt.id)) {
        seenSupplement.add(wt.id);
        supplements.push(r);
      }
    } else if (!primary) {
      primary = r;
    }
  }
  return { primary, supplements };
}

export type MappingInput = {
  config: PayrollMappingConfig;
  calendar: readonly CalendarDay[];
  /** Løn-helligdage pr. medarbejder (dataset.payrollHolidaysByUser) */
  payrollHolidaysByUser?: Readonly<Record<string, readonly string[]>>;
  /** Allerede filtrerede fakta (rapportens filtre er anvendt af kalderen) */
  time: readonly TimeFact[];
  absence: readonly AbsenceFact[];
  overtime: readonly OvertimeFact[];
  flex: readonly FlexFact[];
  checkIns: readonly CheckInFact[];
  /** Fraværstyper med fallback-lønart (payrollCode) */
  absenceTypes: ReadonlyArray<{
    id: string;
    name: string;
    payrollCode: string;
  }>;
};

/** Antal i lønartens enhed for en fraværsdag. */
export function absenceQuantity(fact: AbsenceFact, unit: WageTypeUnit): number {
  return unit === "days" ? fact.days : fact.hours;
}

/** Kortlæg alle fakta til lønart-linjer (uafrundede). */
export function mapFactsToWageLines(input: MappingInput): MappingResult {
  const { config } = input;
  const wageTypeById = new Map(config.wageTypes.map((w) => [w.id, w]));
  const dayInfo = buildDayInfoLookup(
    input.calendar,
    input.payrollHolidaysByUser,
  );
  const absenceTypeById = new Map(input.absenceTypes.map((t) => [t.id, t]));
  const lines: WageLine[] = [];
  const unmapped: UnmappedFact[] = [];

  const base = (
    f: { userId: string; date: string },
    source: MappingSource,
  ) => ({
    userId: f.userId,
    date: f.date,
    source,
    projectId: null as string | null,
    projectName: "",
    activityTypeId: null as string | null,
    activityTypeName: "",
    absenceTypeId: null as string | null,
    absenceTypeName: "",
  });

  const pushForRule = (
    rule: MappingRule,
    line: Omit<
      WageLine,
      "wageTypeId" | "code" | "name" | "unit" | "quantity" | "supplement"
    >,
    quantityFor: (unit: WageTypeUnit) => number,
    supplement: boolean,
  ) => {
    const wt = wageTypeById.get(rule.wageTypeId);
    if (!wt) return;
    const quantity = quantityFor(wt.unit);
    if (quantity === 0) return;
    lines.push({
      ...line,
      wageTypeId: wt.id,
      code: wt.code,
      name: wt.name,
      unit: wt.unit,
      quantity,
      supplement,
    });
  };

  // 1) Timer pr. aktivitet
  for (const f of input.time) {
    if (f.hours === 0) continue;
    const line = {
      ...base(f, "activity"),
      projectId: f.projectId,
      projectName: f.projectName,
      activityTypeId: f.activityTypeId,
      activityTypeName: f.activityTypeName,
    };
    const { primary, supplements } = matchRules(config, {
      source: "activity",
      activityTypeId: f.activityTypeId,
      day: dayInfo(f.date, f.userId),
    });
    if (primary) {
      pushForRule(primary, line, () => f.hours, false);
    } else if (f.payrollCode) {
      lines.push({
        ...line,
        wageTypeId: null,
        code: f.payrollCode,
        name: f.activityTypeName || f.payrollCode,
        unit: "hours",
        quantity: f.hours,
        supplement: false,
      });
    } else {
      unmapped.push({
        userId: f.userId,
        date: f.date,
        source: "activity",
        label: f.activityTypeId ? f.activityTypeName : "(uden aktivitet)",
        unit: "hours",
        quantity: f.hours,
      });
    }
    for (const s of supplements) pushForRule(s, line, () => f.hours, true);
  }

  // 2) Fravær pr. dag
  for (const f of input.absence) {
    if (f.days === 0 && f.hours === 0) continue;
    const line = {
      ...base(f, "absence"),
      absenceTypeId: f.absenceTypeId,
      absenceTypeName: f.absenceTypeName,
    };
    const { primary, supplements } = matchRules(config, {
      source: "absence",
      absenceTypeId: f.absenceTypeId,
      day: dayInfo(f.date, f.userId),
    });
    if (primary) {
      pushForRule(primary, line, (unit) => absenceQuantity(f, unit), false);
    } else {
      const fallback = absenceTypeById.get(f.absenceTypeId)?.payrollCode;
      if (fallback) {
        lines.push({
          ...line,
          wageTypeId: null,
          code: fallback,
          name: f.absenceTypeName,
          unit: "days",
          quantity: f.days,
          supplement: false,
        });
      } else {
        unmapped.push({
          userId: f.userId,
          date: f.date,
          source: "absence",
          label: f.absenceTypeName,
          unit: "days",
          quantity: f.days,
        });
      }
    }
    for (const s of supplements) {
      pushForRule(s, line, (unit) => absenceQuantity(f, unit), true);
    }
  }

  // 3) Overtid — lønudløsende: uden regel → unmapped
  for (const f of input.overtime) {
    const source: MappingSource | null =
      f.type === "earned"
        ? "overtime_earned"
        : f.type === "used"
          ? "overtime_used"
          : f.type === "paid_out"
            ? "overtime_paid_out"
            : null;
    if (!source) continue;
    const hours = Math.abs(f.hours);
    if (hours === 0) continue;
    const line = base(f, source);
    const { primary, supplements } = matchRules(config, {
      source,
      day: dayInfo(f.date, f.userId),
    });
    if (primary) pushForRule(primary, line, () => hours, false);
    else {
      unmapped.push({
        userId: f.userId,
        date: f.date,
        source,
        label: MAPPING_SOURCE_LABELS[source],
        unit: "hours",
        quantity: hours,
      });
    }
    for (const s of supplements) pushForRule(s, line, () => hours, true);
  }

  // 4) Flex — kun når org'en har en regel (afledt tal)
  for (const f of input.flex) {
    if (f.delta === 0) continue;
    const source: MappingSource =
      f.delta > 0 ? "flex_positive" : "flex_negative";
    const hours = Math.abs(f.delta);
    const { primary, supplements } = matchRules(config, {
      source,
      day: dayInfo(f.date, f.userId),
    });
    const line = base(f, source);
    if (primary) pushForRule(primary, line, () => hours, false);
    for (const s of supplements) pushForRule(s, line, () => hours, true);
  }

  // 5) Pausefradrag — kun med regel
  for (const f of input.checkIns) {
    if (f.breakDeductedHours === 0) continue;
    const { primary, supplements } = matchRules(config, {
      source: "break_deduction",
      day: dayInfo(f.date, f.userId),
    });
    const line = base(f, "break_deduction");
    if (primary) pushForRule(primary, line, () => f.breakDeductedHours, false);
    for (const s of supplements) {
      pushForRule(s, line, () => f.breakDeductedHours, true);
    }
  }

  return { lines, unmapped };
}

export function roundQuantity(n: number): number {
  return Math.round(n * 100) / 100;
}

export type WageLineTotal = {
  userId: string;
  employeeNumber: string;
  externalPayrollId: string;
  employeeName: string;
  departmentName: string;
  code: string;
  name: string;
  unit: WageTypeUnit;
  /** Afrundet til 2 decimaler EFTER summering */
  quantity: number;
  supplement: boolean;
};

/** Pivot-label for en lønart: "0100 Normaltimer (timer)". */
export function wageTypeLabel(line: {
  code: string;
  name: string;
  unit: WageTypeUnit;
}): string {
  const unit = line.unit === "days" ? "dage" : "timer";
  const name = line.name && line.name !== line.code ? ` ${line.name}` : "";
  return `${line.code}${name} (${unit})`;
}

/**
 * Summér linjer pr. medarbejder × lønart. Sorteret på medarbejdernavn,
 * derefter lønart-kode. Medarbejdere uden nummer får tom streng — eksporten
 * markerer dem som fejl.
 */
export function summarizeWageLines(
  lines: readonly WageLine[],
  employees: readonly Pick<
    DatasetEmployee,
    | "userId"
    | "name"
    | "employeeNumber"
    | "externalPayrollId"
    | "departmentName"
  >[],
): WageLineTotal[] {
  const byUser = new Map(employees.map((e) => [e.userId, e]));
  const totals = new Map<string, WageLineTotal>();
  for (const l of lines) {
    const key = `${l.userId}|${l.code}|${l.unit}`;
    let t = totals.get(key);
    if (!t) {
      const e = byUser.get(l.userId);
      t = {
        userId: l.userId,
        employeeNumber: e?.employeeNumber ?? "",
        externalPayrollId: e?.externalPayrollId ?? "",
        employeeName: e?.name ?? "Ukendt",
        departmentName: e?.departmentName ?? "",
        code: l.code,
        name: l.name,
        unit: l.unit,
        quantity: 0,
        supplement: l.supplement,
      };
      totals.set(key, t);
    }
    t.quantity += l.quantity;
  }
  return Array.from(totals.values())
    .map((t) => ({ ...t, quantity: roundQuantity(t.quantity) }))
    .filter((t) => t.quantity !== 0)
    .sort(
      (a, b) =>
        a.employeeName.localeCompare(b.employeeName, "da") ||
        a.code.localeCompare(b.code, "da") ||
        a.unit.localeCompare(b.unit),
    );
}

/** Summér unmapped pr. (kilde, label) — til advarsel i UI/eksport. */
export function summarizeUnmapped(unmapped: readonly UnmappedFact[]): Array<{
  source: MappingSource;
  label: string;
  unit: WageTypeUnit;
  quantity: number;
  employeeCount: number;
}> {
  const map = new Map<
    string,
    {
      source: MappingSource;
      label: string;
      unit: WageTypeUnit;
      quantity: number;
      users: Set<string>;
    }
  >();
  for (const u of unmapped) {
    const key = `${u.source}|${u.label}`;
    let m = map.get(key);
    if (!m) {
      m = {
        source: u.source,
        label: u.label,
        unit: u.unit,
        quantity: 0,
        users: new Set(),
      };
      map.set(key, m);
    }
    m.quantity += u.quantity;
    m.users.add(u.userId);
  }
  return Array.from(map.values())
    .map((m) => ({
      source: m.source,
      label: m.label,
      unit: m.unit,
      quantity: roundQuantity(m.quantity),
      employeeCount: m.users.size,
    }))
    .sort((a, b) => b.quantity - a.quantity);
}
