// DB-lag for fridagskalenderen (#526). Hvilken kalender gælder for en
// bruger: afdelingens > organisationens > brugerens egen > standarden
// (officielle helligdage). Selve beregningen er ren og ligger i ./danish.
//
// Brugerens egen kalender gælder kun for den, der selv styrer sin
// arbejdstid (#742): er brugeren aktiv medarbejder (employeeProfile) i
// org'en, er det HR-normtiden, og så kan en egen kalender ikke sænke
// normtid, flex eller dækningsgrad — heller ikke når org'en ikke har valgt
// en kalender (så gælder standarden).
//
// Organisationens ældre helligdagsliste (tabellen `holidays`, #4xx) flettes
// stadig ind, så intet går tabt: egne rækker altid, de genererede
// system-rækker kun så længe der ikke er valgt en kalender (ellers ville en
// gammel "juleaftensdag" overtrumfe det nye valg).

import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import {
  type CustomDayOff,
  createDayOffLookup,
  type DayOff,
  type DayOffConfig,
  type DayOffLookup,
  daysOffInRange,
  normalizeDayOffConfig,
} from "./danish";

type Db = PostgresJsDatabase<typeof schema>;

export type DayOffCalendarSource = "department" | "org" | "user" | "default";

/** Hvorfor brugerens egen kalender ikke gælder (null = den må gælde). */
export type PersonalCalendarBlock = "department" | "org" | "employee" | null;

export interface ResolvedDayOffCalendar {
  source: DayOffCalendarSource;
  /** Kun beregnet, når der er en bruger (ellers null) */
  personalBlockedBy: PersonalCalendarBlock;
  config: DayOffConfig;
  lookup: DayOffLookup;
}

type CalendarRow = typeof schema.dayOffCalendars.$inferSelect;

export function configFromRow(row: CalendarRow | null | undefined) {
  return normalizeDayOffConfig(
    row
      ? {
          preset: row.preset,
          optionalDays: row.optionalDays,
          customDays: row.customDays,
        }
      : undefined,
  );
}

interface LegacyRow {
  date: string;
  name: string;
  isHalfDay: boolean;
  isSystem: boolean;
}

/** Org'ens (og evt. systembrede) rækker fra den ældre helligdagsliste. */
async function loadLegacyRows(
  db: Db,
  orgId: string | null,
): Promise<LegacyRow[]> {
  return db.query.holidays.findMany({
    where: and(
      orgId
        ? or(
            eq(schema.holidays.organizationId, orgId),
            isNull(schema.holidays.organizationId),
          )
        : isNull(schema.holidays.organizationId),
      eq(schema.holidays.isArchived, false),
    ),
    columns: { date: true, name: true, isHalfDay: true, isSystem: true },
  });
}

export function legacyExtra(
  rows: readonly LegacyRow[],
  source: DayOffCalendarSource,
): CustomDayOff[] {
  // Et aktivt valg (afdeling/org/egen) erstatter de genererede rækker
  const chose = source !== "default";
  return rows
    .filter((r) => !(chose && r.isSystem))
    .map((r) => ({ date: r.date, name: r.name, isHalfDay: r.isHalfDay }));
}

export function pickCalendarRow(
  rows: readonly CalendarRow[],
  orgId: string | null,
  departmentId: string | null,
  userId: string | null,
  opts: { allowPersonal?: boolean } = {},
): { source: DayOffCalendarSource; row: CalendarRow | null } {
  const dept = departmentId
    ? rows.find((r) => r.departmentId === departmentId)
    : undefined;
  if (dept) return { source: "department", row: dept };
  const org = orgId
    ? rows.find(
        (r) => r.organizationId === orgId && !r.departmentId && !r.userId,
      )
    : undefined;
  if (org) return { source: "org", row: org };
  const own =
    userId && opts.allowPersonal !== false
      ? rows.find((r) => r.userId === userId)
      : undefined;
  if (own) return { source: "user", row: own };
  return { source: "default", row: null };
}

/**
 * Hvorfor brugerens egen kalender ikke gælder: org'ens/afdelingens kalender
 * bestemmer, eller brugeren er medarbejder med HR-normtid.
 */
export function personalCalendarBlock(
  source: DayOffCalendarSource,
  isEmployee: boolean,
): PersonalCalendarBlock {
  if (source === "department" || source === "org") return source;
  return isEmployee ? "employee" : null;
}

/** Kalender-rækker der kan være relevante for org'en og brugerne. */
async function loadCalendarRows(
  db: Db,
  orgId: string | null,
  userIds: readonly string[],
): Promise<CalendarRow[]> {
  const conds: SQL[] = [];
  if (orgId) conds.push(eq(schema.dayOffCalendars.organizationId, orgId));
  if (userIds.length > 0) {
    conds.push(inArray(schema.dayOffCalendars.userId, [...userIds]));
  }
  if (conds.length === 0) return [];
  return db.query.dayOffCalendars.findMany({
    where: conds.length === 1 ? conds[0] : or(...conds),
  });
}

/**
 * Brugerens medarbejderprofil i org'en (enterprise): afdelingen, og om
 * brugeren er aktiv medarbejder (så gælder en egen kalender ikke).
 */
async function employmentOf(
  db: Db,
  orgId: string,
  userId: string,
): Promise<{ departmentId: string | null; isEmployee: boolean }> {
  const profile = await db.query.employeeProfiles.findFirst({
    where: and(
      eq(schema.employeeProfiles.organizationId, orgId),
      eq(schema.employeeProfiles.userId, userId),
    ),
    columns: { departmentId: true, isActive: true },
  });
  return {
    departmentId: profile?.departmentId ?? null,
    isEmployee: profile?.isActive === true,
  };
}

/**
 * Fridagskalenderen for en bruger (eller org'en som helhed, uden userId).
 * `departmentId` kan gives med, hvis den allerede er kendt; ellers slås den
 * op i medarbejderprofilen. Det samme gælder `isEmployee` (aktiv
 * medarbejderprofil), medmindre kalderen allerede ved det.
 */
export async function loadDayOffCalendar(
  db: Db,
  params: {
    orgId: string | null;
    userId?: string | null;
    departmentId?: string | null;
    isEmployee?: boolean;
  },
): Promise<ResolvedDayOffCalendar> {
  const orgId = params.orgId ?? null;
  const userId = params.userId ?? null;
  const employment =
    orgId &&
    userId &&
    (params.departmentId === undefined || params.isEmployee === undefined)
      ? await employmentOf(db, orgId, userId)
      : { departmentId: null, isEmployee: false };
  const departmentId =
    params.departmentId !== undefined
      ? params.departmentId
      : employment.departmentId;
  const isEmployee = params.isEmployee ?? employment.isEmployee;

  const [rows, legacy] = await Promise.all([
    loadCalendarRows(db, orgId, userId ? [userId] : []),
    loadLegacyRows(db, orgId),
  ]);
  const { source, row } = pickCalendarRow(rows, orgId, departmentId, userId, {
    allowPersonal: !isEmployee,
  });
  const config = configFromRow(row);
  return {
    source,
    personalBlockedBy: userId
      ? personalCalendarBlock(source, isEmployee)
      : null,
    config,
    lookup: createDayOffLookup(config, legacyExtra(legacy, source)),
  };
}

/**
 * Fridage i [start, end] for brugeren/org'en — samme form som rækkerne fra
 * den ældre `holidays`-tabel ({ date, name, isHalfDay }).
 */
export async function loadDaysOff(
  db: Db,
  params: {
    orgId: string | null;
    userId?: string | null;
    departmentId?: string | null;
    start: string;
    end: string;
  },
): Promise<DayOff[]> {
  const { lookup } = await loadDayOffCalendar(db, params);
  return daysOffInRange(lookup, params.start, params.end);
}

/**
 * Batch til teamvisninger og HR-rapporter: ét opslag pr. medarbejder
 * (afdeling > org > standard), kun to forespørgsler i alt. Medlemmerne er
 * medarbejdere, så deres egne kalendere indgår ikke (#742). Rapporter kan
 * angive isEmployee=false for selvstyrede medlemmer med egen kalender.
 */
export async function loadDayOffLookupsForUsers(
  db: Db,
  orgId: string | null,
  members: ReadonlyArray<{
    userId: string;
    departmentId: string | null;
    isEmployee?: boolean;
  }>,
): Promise<Map<string, DayOffLookup>> {
  const [rows, legacy] = await Promise.all([
    loadCalendarRows(
      db,
      orgId,
      members.filter((m) => m.isEmployee === false).map((m) => m.userId),
    ),
    loadLegacyRows(db, orgId),
  ]);
  // Én lookup pr. kalender-række (og kilde), så år-cachen deles
  const shared = new Map<string, DayOffLookup>();
  const out = new Map<string, DayOffLookup>();
  for (const m of members) {
    const { source, row } = pickCalendarRow(
      rows,
      orgId,
      m.departmentId,
      m.userId,
      { allowPersonal: m.isEmployee === false },
    );
    const key = `${source}:${row?.id ?? "default"}`;
    let lookup = shared.get(key);
    if (!lookup) {
      lookup = createDayOffLookup(
        configFromRow(row),
        legacyExtra(legacy, source),
      );
      shared.set(key, lookup);
    }
    out.set(m.userId, lookup);
  }
  return out;
}
