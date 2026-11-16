// Fast arbejdsplan (#510): arbejdstiden registreres på forhånd efter en
// ugeskabelon (evt. 14-dages rotation), og medarbejderen registrerer kun
// afvigelser. Ren logik — DB-laget ligger i ./work-plan-load.
//
// DESIGNVALG: planen materialiseres IKKE som tidsposter. En dag "efter plan"
// beregnes ved visning ud fra (1) den planversion der gjaldt på datoen,
// (2) fridagskalenderen (#526), (3) godkendt fravær og (4) en evt. afvigelse.
// Historikken står fast, fordi planversioner og tildelinger kun kan ændres
// fremadrettet (validFrom >= i morgen/i dag) — en fortidig dag beregnes
// altid ens. Tidsposter (projekter, klippekort, fakturering, billed-lock)
// røres ikke; arbejdstidsregistreringen er sit eget lag.

import { syncT } from "@/i18n/sync-text";
import type { DayOff } from "@/lib/holidays/danish";
import {
  addDaysToDateStr,
  copenhagenWallTime,
  isoWeekdayOfDateStr,
} from "@/lib/time/copenhagen";

export const WORK_PLAN_ROTATIONS = [1, 2] as const;
export type WorkPlanRotation = (typeof WORK_PLAN_ROTATIONS)[number];

/** Én arbejdsdag i skabelonen. weekday: 1 = mandag … 7 = søndag. */
export interface WorkPlanDay {
  weekday: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM", efter start (natarbejde over midnat understøttes ikke)
  breakMinutes: number;
}

/** weeks[0] = uge A, weeks[1] = uge B (kun ved 14-dages rotation). */
export type WorkPlanWeeks = WorkPlanDay[][];

export interface WorkPlanVersionLike {
  planId: string;
  validFrom: string;
  rotationWeeks: number;
  /** Mandag i en uge A; null = ugen for validFrom */
  rotationAnchor?: string | null;
  weeks: WorkPlanWeeks;
}

export interface WorkPlanAssignmentLike {
  planId: string;
  userId: string | null;
  departmentId: string | null;
  validFrom: string;
  validTo: string | null;
}

export const MAX_PLAN_NAME = 100;
export const MAX_DEVIATION_NOTE = 500;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeStr(v: string): boolean {
  return TIME_RE.test(v);
}

export function minutesOf(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function timeOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Arbejdstimer for et tidsrum minus pause (aldrig negativ). */
export function spanHours(
  start: string,
  end: string,
  breakMinutes: number,
): number {
  const span = minutesOf(end) - minutesOf(start);
  if (!Number.isFinite(span) || span <= 0) return 0;
  return round2(Math.max(0, span - Math.max(0, breakMinutes)) / 60);
}

/**
 * Validér en skabelon. Returnerer en dansk fejltekst eller null.
 * Regler: 1-2 uger, ugedag 1-7 højst én gang pr. uge, HH:MM, slut efter
 * start, pause 0-240 min og kortere end tidsrummet.
 */
export function validateWeeks(
  weeks: WorkPlanWeeks,
  rotationWeeks: number,
): string | null {
  if (!(WORK_PLAN_ROTATIONS as readonly number[]).includes(rotationWeeks)) {
    return syncT("enterprise.workPlan.rotation");
  }
  if (weeks.length !== rotationWeeks) {
    return syncT("enterprise.workPlan.weekCount");
  }
  for (const [i, week] of weeks.entries()) {
    const label =
      rotationWeeks === 2
        ? syncT("enterprise.workPlan.inWeek", { week: i === 0 ? "A" : "B" })
        : "";
    const seen = new Set<number>();
    for (const day of week) {
      if (!Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 7)
        return syncT("enterprise.workPlan.invalidWeekday", { label });
      if (seen.has(day.weekday))
        return syncT("enterprise.workPlan.duplicateWeekday", { label });
      seen.add(day.weekday);
      if (!isTimeStr(day.start) || !isTimeStr(day.end))
        return syncT("enterprise.workPlan.timeFormat", { label });
      const span = minutesOf(day.end) - minutesOf(day.start);
      if (span <= 0)
        return syncT("enterprise.workPlan.endAfterStart", { label });
      if (
        !Number.isInteger(day.breakMinutes) ||
        day.breakMinutes < 0 ||
        day.breakMinutes > 240
      )
        return syncT("enterprise.workPlan.breakRange", { label });
      if (day.breakMinutes >= span)
        return syncT("enterprise.workPlan.breakShorter", { label });
    }
  }
  return null;
}

/** Timer pr. uge i skabelonen (uge A, evt. uge B). */
export function weeklyHours(weeks: WorkPlanWeeks): number[] {
  return weeks.map((w) =>
    round2(
      w.reduce((s, d) => s + spanHours(d.start, d.end, d.breakMinutes), 0),
    ),
  );
}

/** Hele uger mellem to mandage (kan være negativ). */
function weeksBetween(fromMonday: string, toMonday: string): number {
  const a = Date.UTC(
    Number(fromMonday.slice(0, 4)),
    Number(fromMonday.slice(5, 7)) - 1,
    Number(fromMonday.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(toMonday.slice(0, 4)),
    Number(toMonday.slice(5, 7)) - 1,
    Number(toMonday.slice(8, 10)),
  );
  return Math.round((b - a) / (7 * 86_400_000));
}

function mondayOf(date: string): string {
  return addDaysToDateStr(date, 1 - isoWeekdayOfDateStr(date));
}

/**
 * Rotationsugen (0 = A, 1 = B) for en dato, talt fra ankeret (en dato i en
 * uge A — som udgangspunkt ugen hvor den første version trådte i kraft).
 */
export function rotationWeekIndex(
  anchor: string,
  rotationWeeks: number,
  date: string,
): number {
  if (rotationWeeks <= 1) return 0;
  const n = weeksBetween(mondayOf(anchor), mondayOf(date));
  return ((n % rotationWeeks) + rotationWeeks) % rotationWeeks;
}

/**
 * Ankeret for en ny version: fortsætter forrige versions rotation, så en
 * rettelse midt i en uge B ikke bytter om på uge A og B. Uden forrige
 * 14-dages version starter rotationen i ugen for validFrom (null).
 */
export function inheritedRotationAnchor(
  previous: Pick<
    WorkPlanVersionLike,
    "validFrom" | "rotationWeeks" | "rotationAnchor"
  > | null,
  rotationWeeks: number,
): string | null {
  if (rotationWeeks !== 2 || previous?.rotationWeeks !== 2) return null;
  return mondayOf(previous.rotationAnchor ?? previous.validFrom);
}

/** Versionen med senest validFrom <= date. */
export function versionAt<V extends { validFrom: string }>(
  versions: readonly V[],
  date: string,
): V | null {
  let best: V | null = null;
  for (const v of versions) {
    if (v.validFrom <= date && (!best || v.validFrom > best.validFrom)) {
      best = v;
    }
  }
  return best;
}

function covers(a: WorkPlanAssignmentLike, date: string): boolean {
  return a.validFrom <= date && (a.validTo == null || a.validTo >= date);
}

/**
 * Tildelingen der gælder for brugeren på datoen: personlig tildeling
 * vinder over afdelingens. Ved overlap vinder den senest startede.
 */
export function assignmentAt<A extends WorkPlanAssignmentLike>(
  assignments: readonly A[],
  userId: string,
  departmentId: string | null,
  date: string,
): A | null {
  const pick = (list: A[]) =>
    list.reduce<A | null>(
      (best, a) => (!best || a.validFrom > best.validFrom ? a : best),
      null,
    );
  const own = pick(
    assignments.filter((a) => a.userId === userId && covers(a, date)),
  );
  if (own) return own;
  if (!departmentId) return null;
  return pick(
    assignments.filter(
      (a) => !a.userId && a.departmentId === departmentId && covers(a, date),
    ),
  );
}

/** Planens dag før fridage og fravær. */
export interface PlannedDay {
  planId: string;
  /** 0 = uge A, 1 = uge B */
  weekIndex: number;
  start: string;
  end: string;
  breakMinutes: number;
  hours: number;
}

/** Den rå plan for datoen (null = ingen plan eller fri ifølge skabelonen). */
export function plannedDayFromVersion(
  version: WorkPlanVersionLike | null,
  date: string,
): PlannedDay | null {
  if (!version) return null;
  const weekIndex = rotationWeekIndex(
    version.rotationAnchor ?? version.validFrom,
    version.rotationWeeks,
    date,
  );
  const weekday = isoWeekdayOfDateStr(date);
  const day = version.weeks[weekIndex]?.find((d) => d.weekday === weekday);
  if (!day) return null;
  return {
    planId: version.planId,
    weekIndex,
    start: day.start,
    end: day.end,
    breakMinutes: day.breakMinutes,
    hours: spanHours(day.start, day.end, day.breakMinutes),
  };
}

/** Opslag pr. bruger: datoen → rå plan (null = ingen plan den dag). */
export type PlanLookup = (date: string) => PlannedDay | null;

/** Har brugeren overhovedet en plan på datoen (også på fridage i skabelonen)? */
export type PlanCoverage = (date: string) => boolean;

export function makePlanLookup(params: {
  userId: string;
  /** Afdelingen på datoen (ansættelseshistorik), så historikken står fast */
  departmentAt: (date: string) => string | null;
  assignments: readonly WorkPlanAssignmentLike[];
  versionsByPlan: ReadonlyMap<string, readonly WorkPlanVersionLike[]>;
}): { planFor: PlanLookup; hasPlan: PlanCoverage } {
  const versionFor = (date: string) => {
    const a = assignmentAt(
      params.assignments,
      params.userId,
      params.departmentAt(date),
      date,
    );
    if (!a) return null;
    return versionAt(params.versionsByPlan.get(a.planId) ?? [], date);
  };
  return {
    planFor: (date) => plannedDayFromVersion(versionFor(date), date),
    hasPlan: (date) => versionFor(date) !== null,
  };
}

/** Halv fridag: halvdelen af tidsrummet og pausen, samme starttid. */
export function halveDay(day: PlannedDay): PlannedDay {
  const span = minutesOf(day.end) - minutesOf(day.start);
  const breakMinutes = Math.round(day.breakMinutes / 2);
  const end = timeOf(minutesOf(day.start) + Math.round(span / 2));
  return {
    ...day,
    end,
    breakMinutes,
    hours: spanHours(day.start, end, breakMinutes),
  };
}

export const DEVIATION_KINDS = ["worked", "absence"] as const;
export type DeviationKind = (typeof DEVIATION_KINDS)[number];

export interface DeviationLike {
  date: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number | null;
  hours: number;
  note: string | null;
  updatedAt?: Date | null;
  updatedByLabel?: string | null;
}

export type RegisteredStatus =
  | "plan" // efter plan
  | "deviation" // medarbejderen/lederen har rettet dagen
  | "day_off" // hel fridag (helligdag/firmafridag)
  | "absence" // godkendt fravær hele dagen
  | "free"; // planen har ingen arbejdstid denne dag

export interface RegisteredDay {
  date: string;
  status: RegisteredStatus;
  /** Planen efter fridage/fravær (null på fridag/fravær/fri) */
  planned: PlannedDay | null;
  dayOff: Pick<DayOff, "name" | "isHalfDay"> | null;
  deviation: DeviationLike | null;
  /** Registreret arbejdstid: afvigelsen hvis den findes, ellers planen */
  hours: number;
  start: string | null;
  end: string | null;
  breakMinutes: number | null;
}

/**
 * Den registrerede arbejdsdag. Afvigelsen vinder altid; ellers planen med
 * fridage (hel = 0, halv = halv dag) og godkendt heldagsfravær (0).
 */
export function registeredDay(params: {
  date: string;
  planned: PlannedDay | null;
  dayOff: Pick<DayOff, "name" | "isHalfDay"> | null;
  absence: boolean;
  deviation: DeviationLike | null;
}): RegisteredDay {
  const { date, dayOff, absence, deviation } = params;
  let planned = params.planned;
  let status: RegisteredStatus = planned ? "plan" : "free";
  if (planned && dayOff) {
    if (dayOff.isHalfDay) planned = halveDay(planned);
    else {
      planned = null;
      status = "day_off";
    }
  }
  if (planned && absence) {
    planned = null;
    status = "absence";
  }
  if (deviation) {
    return {
      date,
      status: "deviation",
      planned,
      dayOff,
      deviation,
      hours: deviation.hours,
      start: deviation.startTime,
      end: deviation.endTime,
      breakMinutes: deviation.breakMinutes,
    };
  }
  return {
    date,
    status,
    planned,
    dayOff,
    deviation: null,
    hours: planned?.hours ?? 0,
    start: planned?.start ?? null,
    end: planned?.end ?? null,
    breakMinutes: planned?.breakMinutes ?? null,
  };
}

/** Alle datoer i [from, to] (begge inkl.). */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToDateStr(d, 1)) out.push(d);
  return out;
}

/**
 * Normalisér input til en afvigelse: med tidsrum beregnes timerne af
 * tidsrummet; uden tidsrum bruges de angivne timer. Fravær = 0 timer.
 */
export function normalizeDeviation(input: {
  kind: DeviationKind;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number | null;
  hours?: number | null;
}):
  | {
      ok: true;
      value: {
        kind: DeviationKind;
        startTime: string | null;
        endTime: string | null;
        breakMinutes: number | null;
        hours: number;
      };
    }
  | { ok: false; error: string } {
  if (input.kind === "absence") {
    return {
      ok: true,
      value: {
        kind: "absence",
        startTime: null,
        endTime: null,
        breakMinutes: null,
        hours: 0,
      },
    };
  }
  const start = input.startTime || null;
  const end = input.endTime || null;
  if (start || end) {
    if (!start || !end || !isTimeStr(start) || !isTimeStr(end)) {
      return { ok: false, error: syncT("enterprise.workPlan.enterBothTimes") };
    }
    const span = minutesOf(end) - minutesOf(start);
    if (span <= 0) {
      return {
        ok: false,
        error: syncT("enterprise.workPlan.endAfterStartPlain"),
      };
    }
    const breakMinutes = input.breakMinutes ?? 0;
    if (breakMinutes < 0 || breakMinutes >= span) {
      return {
        ok: false,
        error: syncT("enterprise.workPlan.breakShorterPlain"),
      };
    }
    return {
      ok: true,
      value: {
        kind: "worked",
        startTime: start,
        endTime: end,
        breakMinutes,
        hours: spanHours(start, end, breakMinutes),
      },
    };
  }
  const hours = input.hours ?? null;
  if (hours == null || !Number.isFinite(hours) || hours < 0 || hours > 24) {
    return { ok: false, error: syncT("enterprise.workPlan.rangeOrHours") };
  }
  return {
    ok: true,
    value: {
      kind: "worked",
      startTime: null,
      endTime: null,
      breakMinutes: null,
      hours: round2(hours),
    },
  };
}

// ─── Forudindstillinger ───────────────────────────────────────────────

export const WORK_PLAN_PRESETS = ["standard", "teachers"] as const;
export type WorkPlanPreset = (typeof WORK_PLAN_PRESETS)[number];

const day = (
  weekday: number,
  start: string,
  end: string,
  breakMinutes = 30,
): WorkPlanDay => ({ weekday, start, end, breakMinutes });

export const WORK_PLAN_PRESET_DEFS: Record<
  WorkPlanPreset,
  {
    label: string;
    description: string;
    rotationWeeks: WorkPlanRotation;
    weeks: WorkPlanWeeks;
  }
> = {
  standard: {
    label: "Fast dagarbejde (37 t)",
    description: "Mandag-torsdag 8-16, fredag 8-15.30, 30 min. pause.",
    rotationWeeks: 1,
    weeks: [
      [
        day(1, "08:00", "16:00"),
        day(2, "08:00", "16:00"),
        day(3, "08:00", "16:00"),
        day(4, "08:00", "16:00"),
        day(5, "08:00", "15:30"),
      ],
    ],
  },
  teachers: {
    label: "Undervisere / mødeplan",
    description:
      "14-dages mødeplan: uge B har lang mødedag mandag og kort fredag. 37 t pr. uge. Ret tiderne til skemaet.",
    rotationWeeks: 2,
    weeks: [
      [
        day(1, "08:00", "16:00"),
        day(2, "08:00", "16:00"),
        day(3, "08:00", "16:00"),
        day(4, "08:00", "16:00"),
        day(5, "08:00", "15:30"),
      ],
      [
        day(1, "08:00", "17:00"),
        day(2, "08:00", "16:00"),
        day(3, "08:00", "16:00"),
        day(4, "08:00", "16:00"),
        day(5, "08:00", "14:30"),
      ],
    ],
  },
};

// ─── Eksport (§ 4 b, stk. 2: adgang til egne oplysninger) ─────────────

/** Statusnavne i eksporten; hentes ved brug, så de følger kaldets sprog (ellers dansk). */
export const STATUS_LABELS: Record<RegisteredStatus, string> = {
  get plan() {
    return syncT("enterprise.workPlanExport.planned");
  },
  get deviation() {
    return syncT("enterprise.workPlanExport.deviation");
  },
  get day_off() {
    return syncT("enterprise.workPlanExport.dayOff");
  },
  get absence() {
    return syncT("enterprise.workPlanExport.absence");
  },
  get free() {
    return syncT("enterprise.workPlanExport.free");
  },
};

export function exportRows(
  days: readonly RegisteredDay[],
): Array<Array<string | number>> {
  return days.map((d) => [
    d.date,
    STATUS_LABELS[d.status],
    d.planned ? `${d.planned.start}-${d.planned.end}` : "",
    d.planned?.hours ?? 0,
    d.start && d.end ? `${d.start}-${d.end}` : "",
    d.breakMinutes ?? "",
    d.hours,
    d.dayOff?.name ?? "",
    d.deviation?.note ?? "",
    d.deviation?.updatedByLabel ?? "",
    d.deviation?.updatedAt ? d.deviation.updatedAt.toISOString() : "",
  ]);
}

/** Kolonneoverskrifter i CSV-eksporten på kaldets sprog (ellers dansk). */
export function exportHeaders(): string[] {
  return [
    "hDate",
    "hStatus",
    "hPlan",
    "hPlanHours",
    "hRegisteredRange",
    "hBreak",
    "hRegisteredHours",
    "hDayOff",
    "hNote",
    "hEditedBy",
    "hEditedUtc",
  ].map((key) => syncT(`enterprise.workPlanExport.${key}`));
}

// ─── Compliance (48 t, hviletid) ──────────────────────────────────────

export interface PlanComplianceEntry {
  date: string;
  hours?: number;
  startTime?: Date | null;
  endTime?: Date | null;
}

/**
 * Flet de registrerede plandage ind i compliance-posterne — samme regel som
 * flex (recalculateFlexDay):
 *  - en afvigelse ER dagens arbejdstid og erstatter dagens tidsposter;
 *  - en dag efter plan tæller med planens tid, når tidsposterne er færre
 *    (ellers ville en plan-medarbejder uden tidsposter se ud til at arbejde
 *    0 t).
 * Planen kun for afsluttede dage (før `today`), afvigelser også i dag. Med
 * klokkeslæt lægges posten fra start og `hours` frem (pausen trækkes fra i
 * slutningen), så timetallet er præcist; uden klokkeslæt kun timerne.
 */
export function mergeRegisteredIntoEntries<E extends PlanComplianceEntry>(
  entries: readonly E[],
  days: readonly RegisteredDay[],
  today: string,
  wallTime: (date: string, time: string) => Date,
  preserveEnd = false,
): Array<E | PlanComplianceEntry> {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    const h =
      e.startTime && e.endTime
        ? (e.endTime.getTime() - e.startTime.getTime()) / 3_600_000
        : (e.hours ?? 0);
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + Math.max(0, h));
  }
  const replace = new Map<string, PlanComplianceEntry | null>();
  for (const d of days) {
    const isDeviation = d.status === "deviation";
    if (d.date > today || (d.date === today && !isDeviation)) continue;
    if (isDeviation && d.hours <= 0) {
      replace.set(d.date, null); // ingen arbejdstid denne dag
      continue;
    }
    if (d.hours <= 0) continue;
    if (!isDeviation && (byDate.get(d.date) ?? 0) + 0.005 >= d.hours) continue;
    if (d.start) {
      let startTime = wallTime(d.date, d.start);
      let endTime =
        preserveEnd && d.end
          ? wallTime(d.date, d.end)
          : new Date(startTime.getTime() + d.hours * 3_600_000);
      if (preserveEnd && !isDeviation) {
        for (const entry of entries) {
          if (entry.date !== d.date) continue;
          if (entry.startTime && entry.startTime < startTime)
            startTime = entry.startTime;
          if (entry.endTime && entry.endTime > endTime) endTime = entry.endTime;
        }
      }
      replace.set(d.date, {
        date: d.date,
        hours: d.hours,
        startTime,
        endTime,
      });
    } else {
      replace.set(d.date, { date: d.date, hours: d.hours, startTime: null });
    }
  }
  if (replace.size === 0) return [...entries];
  return [
    ...entries.filter((e) => !replace.has(e.date)),
    ...[...replace.values()].filter((e): e is PlanComplianceEntry => !!e),
  ];
}

/** Dansk vægur-tid for en plandag (til compliance-posterne). */
export function planWallTime(date: string, time: string): Date {
  return copenhagenWallTime(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
    Math.floor(minutesOf(time) / 60),
    minutesOf(time) % 60,
  );
}
