import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { toIntlLocale } from "@/i18n/format-locale";
import { activeLocale, st, tr } from "@/i18n/server-text";
import type { db as dbClient } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/pg-errors";
import {
  absenceRequests,
  absenceTypes,
  activityTypes,
  employeeProfiles,
  flexEntries,
  overtimeLedger,
  projectActivityTypes,
  projectAssignments,
  projects,
  timeEntries,
  timesheetHiddenProjects,
  timesheetTemplates,
  timesheetWeeks,
} from "@/lib/db/schema";
import {
  absenceCoversDate,
  effectiveEndDate,
} from "@/lib/enterprise/absence-registration";
import {
  allowedActivitiesForProject,
  buildTimesheetRows,
  type GridActivityType,
} from "@/lib/enterprise/activity-types";
import {
  assertEntryCompliant,
  checkEntryCompliance,
} from "@/lib/enterprise/compliance-guard";
import { assertEntryEditable } from "@/lib/enterprise/edit-guard";
import {
  loadEmploymentPeriodsForUser,
  makeDayResolver,
  normProfileAt,
} from "@/lib/enterprise/employment";
import {
  getEarnedOvertimeByUser,
  recalculateFlexDay,
} from "@/lib/enterprise/flex";
import { insertOvertimeLedger } from "@/lib/enterprise/overtime-ledger";
import { isWeekClosingLocked } from "@/lib/enterprise/period-closing-lock";
import { ownTimeEntriesInOrg } from "@/lib/enterprise/time-entry-scope";
import {
  buildAbsenceRows,
  calculateDailyNorm,
  calculateWeeklyNorm,
  cellsFromTemplateData,
  cellsFromWeekEntries,
  DEFAULT_WORKING_DAYS,
  dayOffsetFromWeekStart,
  hoursToAbsenceDays,
  type NormProfile,
  overtimeDeductionForAbsence,
  pickAbsenceCellRequest,
  planWeekFill,
  templateDataFromCells,
  weekCellKey,
} from "@/lib/enterprise/timesheet";
import { insertTimesheetWeekEvent } from "@/lib/enterprise/timesheet-events";
import {
  isAutoLocked,
  isRollingLocked,
  noteToDescription,
  TIMESHEET_NOTE_MAX_LENGTH,
  validateTimesheetWeek,
} from "@/lib/enterprise/timesheet-validation";
import { canSubmitWeek } from "@/lib/enterprise/timesheet-week-status";
import {
  applyConversionFactor,
  evaluateVacationGuard,
  getVacationOrgSettings,
  getVacationOverdraft,
  lockVacationBalance,
  postVacationUsage,
  remainingInPool,
  toVacationPool,
  vacationDeductionFactor,
  vacationGuardMessage,
} from "@/lib/enterprise/vacation";
import { loadOrgWorkSettings } from "@/lib/enterprise/work-settings";
import { loadDayOffCalendar, loadDaysOff } from "@/lib/holidays/load";
import { notify, resolveManagerRecipientIds } from "@/lib/notifications/bus";
import { logOrgAudit } from "@/lib/org-audit";
import { type OrgRole, roleSatisfies } from "@/lib/permissions/org-role";
import { assertNoEntriesBilled } from "@/lib/time/billed-lock";
import {
  copenhagenToday,
  copenhagenTodayAnchor,
  entryDateFromStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import { copenhagenDateRange, copenhagenDateSql } from "@/lib/time/date-bounds";
import { resolveDefaultBillable } from "@/lib/time/default-billable";
import { router } from "../../trpc";
import { organizationProcedure } from "./middleware";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Grid-managed entries are tagged so cell edits never touch detailed
 *  registrations made via timer/kalender/manuel indtastning. */
const TIMESHEET_SOURCE = "timesheet";

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Range boundaries follow the same Danish calendar as the grid and validation.
function timeEntryDateRange(from: Date, until: Date) {
  return copenhagenDateRange(
    timeEntries.date,
    toDateStr(from),
    toDateStr(until),
  );
}

/**
 * Normtid pr. dag for én uge: 0 på fridage, helligdage (½ ved halvdag) og
 * godkendt heldags-fravær. Fælles for grid'et og valideringen ved indsend.
 */
function computeWeekNorms(params: {
  days: readonly string[];
  workingDays: readonly string[];
  dailyNorm: number;
  holidays: ReadonlyArray<{ date: string; isHalfDay: boolean }>;
  absences: ReadonlyArray<{
    status: string;
    startDate: string;
    endDate: string | null;
  }>;
  today: string;
  /**
   * Ansættelseshistorik (#465): dagsnorm/arbejdsdage som de gjaldt på dagen.
   * null for en dag = ikke ansat → norm 0. Uden resolver bruges
   * dailyNorm/workingDays for hele ugen.
   */
  resolveDay?: (
    date: string,
  ) => { dailyNorm: number; workingDays: readonly string[] } | null;
}): {
  norms: Record<string, number>;
  /** Norm pr. dag FØR fravær trækkes — det en fraværscelle er "værd" (#457). */
  baseNorms: Record<string, number>;
  workingDates: Set<string>;
  absenceDates: Set<string>;
} {
  const holidayByDate = new Map(params.holidays.map((h) => [h.date, h]));
  // Kun GODKENDT fravær sænker normen — afventende ansøgninger gør ikke.
  const approved = params.absences.filter((a) => a.status === "approved");
  const active = params.absences.filter(
    (a) => a.status === "approved" || a.status === "pending",
  );
  const norms: Record<string, number> = {};
  const baseNorms: Record<string, number> = {};
  const workingDates = new Set<string>();
  const absenceDates = new Set<string>();
  for (const dateStr of params.days) {
    const d = entryDateFromStr(dateStr);
    const isoDay = d.getUTCDay() === 0 ? "7" : String(d.getUTCDay());
    if (active.some((a) => absenceCoversDate(a, dateStr, params.today))) {
      absenceDates.add(dateStr);
    }
    const day = params.resolveDay ? params.resolveDay(dateStr) : undefined;
    if (day === null) {
      norms[dateStr] = 0;
      baseNorms[dateStr] = 0;
      continue;
    }
    const workingDays = day?.workingDays ?? params.workingDays;
    const dailyNorm = day?.dailyNorm ?? params.dailyNorm;
    if (!workingDays.includes(isoDay)) {
      norms[dateStr] = 0;
      baseNorms[dateStr] = 0;
      continue;
    }
    const holiday = holidayByDate.get(dateStr);
    if (holiday) {
      baseNorms[dateStr] = holiday.isHalfDay ? dailyNorm / 2 : 0;
      norms[dateStr] = approved.some((a) =>
        absenceCoversDate(a, dateStr, params.today),
      )
        ? 0
        : baseNorms[dateStr];
      if (holiday.isHalfDay) workingDates.add(dateStr);
      continue;
    }
    workingDates.add(dateStr);
    baseNorms[dateStr] = dailyNorm;
    const absent = approved.some((a) =>
      absenceCoversDate(a, dateStr, params.today),
    );
    norms[dateStr] = absent ? 0 : dailyNorm;
  }
  return { norms, baseNorms, workingDates, absenceDates };
}

/**
 * Org'ens aktivitetstyper (inkl. arkiverede — poster kan pege på dem) og
 * tilladt-listen pr. projekt (#459). Tom liste for et projekt = alle aktive.
 */
async function loadActivityContext(
  db: Pick<typeof dbClient, "query" | "select">,
  orgId: string,
): Promise<{
  types: GridActivityType[];
  allowedByProject: Map<string, Set<string>>;
}> {
  const [types, links] = await Promise.all([
    db.query.activityTypes.findMany({
      where: eq(activityTypes.organizationId, orgId),
      columns: {
        id: true,
        name: true,
        color: true,
        sortOrder: true,
        isArchived: true,
      },
      orderBy: [asc(activityTypes.sortOrder), asc(activityTypes.name)],
    }),
    db
      .select({
        projectId: projectActivityTypes.projectId,
        activityTypeId: projectActivityTypes.activityTypeId,
      })
      .from(projectActivityTypes)
      .innerJoin(projects, eq(projects.id, projectActivityTypes.projectId))
      .where(eq(projects.organizationId, orgId)),
  ]);
  const allowedByProject = new Map<string, Set<string>>();
  for (const link of links) {
    let set = allowedByProject.get(link.projectId);
    if (!set) {
      set = new Set();
      allowedByProject.set(link.projectId, set);
    }
    set.add(link.activityTypeId);
  }
  return { types, allowedByProject };
}

/**
 * Udfyld tomme celler i en uge med grid-poster (source=timesheet). Celler der
 * allerede har timer for (projekt, aktivitet), springes over — kopiering og
 * skabeloner overskriver aldrig eksisterende registreringer.
 */
async function fillWeekCells(
  db: typeof dbClient,
  orgId: string,
  userId: string,
  role: OrgRole | null,
  weekStart: string,
  cells: Array<{
    projectId: string;
    activityTypeId: string | null;
    dayOffset: number;
    hours: number;
  }>,
): Promise<{ filled: number; skipped: number }> {
  const weekStartDate = entryDateFromStr(weekStart);
  const weekEnd = addDays(weekStartDate, 7);

  // Fælles guard (#467): periodelås, ugestatus og rullende lås for de dage
  // der faktisk skrives til
  await assertEntryEditable(db, {
    orgId,
    userId,
    role,
    dates: cells
      .filter((c) => c.hours > 0 && c.dayOffset >= 0 && c.dayOffset <= 6)
      .map((c) => toDateStr(addDays(weekStartDate, c.dayOffset))),
  });

  const [orgProjects, activityCtx] = await Promise.all([
    db.query.projects.findMany({
      where: and(
        eq(projects.organizationId, orgId),
        eq(projects.status, "active"),
      ),
      columns: { id: true, clientId: true },
    }),
    loadActivityContext(db, orgId),
  ]);
  const projectById = new Map(orgProjects.map((p) => [p.id, p]));
  const activeActivityIds = new Set(
    activityCtx.types.filter((t) => !t.isArchived).map((t) => t.id),
  );

  const existing = await db.query.timeEntries.findMany({
    where: and(
      ownTimeEntriesInOrg(userId, orgId),
      timeEntryDateRange(weekStartDate, weekEnd),
    ),
    columns: { projectId: true, activityTypeId: true, date: true, hours: true },
  });
  const occupied = new Set<string>();
  for (const e of existing) {
    if ((Number(e.hours) || 0) <= 0) continue;
    const offset = dayOffsetFromWeekStart(e.date, weekStartDate);
    occupied.add(weekCellKey(e.projectId, e.activityTypeId, offset));
  }

  // Aktiviteten skal stadig findes og være tilladt på projektet (skabeloner
  // kan være ældre end en arkivering/indsnævring)
  const { toInsert, skipped } = planWeekFill({
    cells,
    occupied,
    knownProjectIds: new Set(projectById.keys()),
    isActivityAllowed: (projectId, activityTypeId) =>
      activeActivityIds.has(activityTypeId) &&
      allowedActivitiesForProject(
        projectId,
        activityCtx.types,
        activityCtx.allowedByProject,
      ).some((t) => t.id === activityTypeId),
  });

  const now = new Date();
  const touchedDays = new Set<string>();

  // Fakturerbarhed afhænger kun af (projekt, aktivitet) — slå op én gang pr. par
  const billableByKey = new Map<string, boolean>();
  for (const cell of toInsert) {
    const project = projectById.get(cell.projectId);
    if (!project) continue;
    const billableKey = `${cell.projectId}|${cell.activityTypeId ?? ""}`;
    let isBillable = billableByKey.get(billableKey);
    if (isBillable === undefined) {
      // Aktivitetstypens fakturerbarhed (#704); ellers som før: false
      isBillable = await resolveDefaultBillable(
        db,
        {
          projectId: cell.projectId,
          clientId: project.clientId,
          activityTypeId: cell.activityTypeId,
        },
        null,
        { fallback: false },
      );
      billableByKey.set(billableKey, isBillable);
    }
    const entryDate = addDays(weekStartDate, cell.dayOffset);
    await db.insert(timeEntries).values({
      userId,
      organizationId: orgId,
      projectId: cell.projectId,
      clientId: project.clientId,
      activityTypeId: cell.activityTypeId,
      description: noteToDescription(null),
      hours: cell.hours.toFixed(2),
      date: entryDate,
      isBillable,
      source: TIMESHEET_SOURCE,
      createdAt: now,
      updatedAt: now,
    });
    touchedDays.add(toDateStr(entryDate));
  }

  for (const day of touchedDays) {
    await recalculateFlexDay(db, { userId, orgId, date: day });
  }

  return { filled: toInsert.length, skipped };
}

/** Byg skabelon-/kopierings-celler ud fra en uges faktiske registreringer. */
async function buildCellsFromWeek(
  db: typeof dbClient,
  orgId: string,
  userId: string,
  weekStart: string,
): Promise<
  Array<{
    projectId: string;
    activityTypeId: string | null;
    dayOffset: number;
    hours: number;
  }>
> {
  const weekStartDate = entryDateFromStr(weekStart);
  const weekEnd = addDays(weekStartDate, 7);
  const entries = await db.query.timeEntries.findMany({
    where: and(
      ownTimeEntriesInOrg(userId, orgId),
      timeEntryDateRange(weekStartDate, weekEnd),
    ),
    columns: { projectId: true, activityTypeId: true, date: true, hours: true },
  });

  return cellsFromWeekEntries(entries, weekStartDate);
}

export const enterpriseTimesheetRouter = router({
  /**
   * getTimesheetWeek — alt grid'et skal bruge for én uge (egen tid):
   * rækker pr. projekt med dagstotaler, normtid, fravær, helligdage,
   * flex-saldo og listen af org-projekter til "Tilføj række".
   */
  getTimesheetWeek: organizationProcedure
    .input(z.object({ weekStart: dateString }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const weekStart = entryDateFromStr(input.weekStart);
      const weekEnd = addDays(weekStart, 7); // exclusive
      const days = Array.from({ length: 7 }, (_, i) =>
        toDateStr(addDays(weekStart, i)),
      );
      const weekEndStr = days[6];

      const [
        profile,
        entries,
        weekHolidays,
        absences,
        orgProjects,
        flexSum,
        weekRow,
        assignedRows,
        hiddenRows,
        orgAbsenceTypes,
        orgSettings,
        activityCtx,
      ] = await Promise.all([
        ctx.db.query.employeeProfiles.findFirst({
          where: and(
            eq(employeeProfiles.userId, userId),
            eq(employeeProfiles.organizationId, ctx.orgId),
          ),
        }),
        ctx.db.query.timeEntries.findMany({
          where: and(
            ownTimeEntriesInOrg(userId, ctx.orgId),
            timeEntryDateRange(weekStart, weekEnd),
          ),
          columns: {
            projectId: true,
            activityTypeId: true,
            date: true,
            hours: true,
            source: true,
            description: true,
          },
          with: { project: { columns: { id: true, name: true } } },
        }),
        // Fridagskalenderen (#526): afdeling > org > standard
        loadDaysOff(ctx.db, {
          orgId: ctx.orgId,
          userId,
          start: input.weekStart,
          end: weekEndStr,
        }),
        ctx.db.query.absenceRequests.findMany({
          where: and(
            eq(absenceRequests.userId, userId),
            eq(absenceRequests.organizationId, ctx.orgId),
            ne(absenceRequests.status, "rejected"),
            ne(absenceRequests.status, "cancelled"),
            lte(absenceRequests.startDate, weekEndStr),
            // Åben periode (endDate NULL, #460) dækker til og med i dag
            or(
              isNull(absenceRequests.endDate),
              gte(absenceRequests.endDate, input.weekStart),
            ),
          ),
          with: {
            absenceType: { columns: { name: true, color: true } },
          },
        }),
        ctx.db.query.projects.findMany({
          where: and(
            eq(projects.organizationId, ctx.orgId),
            eq(projects.status, "active"),
          ),
          columns: { id: true, name: true, availableToAll: true },
          orderBy: [asc(projects.name)],
        }),
        ctx.db
          .select({
            total: sql<string>`COALESCE(SUM(${flexEntries.delta}::numeric), 0)`,
          })
          .from(flexEntries)
          .where(
            and(
              eq(flexEntries.userId, userId),
              eq(flexEntries.organizationId, ctx.orgId),
            ),
          ),
        ctx.db.query.timesheetWeeks.findFirst({
          where: and(
            eq(timesheetWeeks.userId, userId),
            eq(timesheetWeeks.organizationId, ctx.orgId),
            eq(timesheetWeeks.weekStart, input.weekStart),
          ),
        }),
        // Faste rækker (#432): projekter tildelt brugeren
        ctx.db
          .select({ projectId: projectAssignments.projectId })
          .from(projectAssignments)
          .where(
            and(
              eq(projectAssignments.organizationId, ctx.orgId),
              eq(projectAssignments.userId, userId),
            ),
          ),
        // Rækker brugeren selv har skjult
        ctx.db
          .select({ projectId: timesheetHiddenProjects.projectId })
          .from(timesheetHiddenProjects)
          .where(
            and(
              eq(timesheetHiddenProjects.organizationId, ctx.orgId),
              eq(timesheetHiddenProjects.userId, userId),
            ),
          ),
        // Fraværsrækker (#433): én række pr. aktiv fraværstype
        ctx.db.query.absenceTypes.findMany({
          where: and(
            eq(absenceTypes.organizationId, ctx.orgId),
            eq(absenceTypes.isArchived, false),
          ),
          columns: {
            id: true,
            name: true,
            color: true,
            requiresApproval: true,
            isDefault: true,
          },
        }),
        loadOrgWorkSettings(ctx.db, ctx.orgId),
        loadActivityContext(ctx.db, ctx.orgId),
      ]);

      // Rækker pr. (projekt, aktivitet) — se buildTimesheetRows (#459).
      // Uden aktivitetstyper i org'en: præcis én række pr. projekt som før.
      const { rows, hiddenProjects } = buildTimesheetRows({
        entries: entries.map((e) => ({
          projectId: e.projectId,
          projectName: e.project?.name ?? null,
          activityTypeId: e.activityTypeId,
          date: toCopenhagenDateStr(e.date),
          hours: Number(e.hours) || 0,
          source: e.source,
          description: e.description,
        })),
        days,
        orgProjects,
        assignedProjectIds: new Set(assignedRows.map((a) => a.projectId)),
        hiddenProjectIds: new Set(hiddenRows.map((h) => h.projectId)),
        activityTypes: activityCtx.types,
        allowedByProject: activityCtx.allowedByProject,
      });
      const activeActivityTypes = activityCtx.types.filter(
        (t) => !t.isArchived,
      );

      // Ansættelseshistorik (#465): normen pr. dag følger den periode der
      // gjaldt på dagen; visningsværdierne (dagsnorm/ugenorm) tager ugens
      // sidste ansatte dag
      const employmentPeriods = profile
        ? await loadEmploymentPeriodsForUser(ctx.db, userId, ctx.orgId)
        : [];
      const normProfile: NormProfile = profile
        ? (normProfileAt(employmentPeriods, profile, weekEndStr) ??
          normProfileAt(employmentPeriods, profile, input.weekStart) ?? {
            weeklyHours: 0,
            workingDays: [],
          })
        : { weeklyHours: 37, workingDays: null };
      const workingDays = normProfile.workingDays ?? DEFAULT_WORKING_DAYS;
      const dailyNorm = calculateDailyNorm(normProfile, orgSettings);
      // Faktisk ugenorm (dagsnorm × arbejdsdage) — ikke rå ugetimer (#449)
      const weeklyHours = calculateWeeklyNorm(normProfile, orgSettings);

      const today = copenhagenToday();
      const { norms, baseNorms, workingDates } = computeWeekNorms({
        days,
        workingDays,
        dailyNorm,
        holidays: weekHolidays,
        absences,
        today,
        resolveDay: profile
          ? makeDayResolver(employmentPeriods, profile, orgSettings)
          : undefined,
      });

      // Rullende lås (#467): hele ugen er låst for medarbejdere når den
      // ligger før grænsen — admin/manager må stadig rette
      const rollingLocked =
        orgSettings.timesheetLockAfterWeeks != null &&
        !roleSatisfies(ctx.orgRole, "manager") &&
        isRollingLocked(
          weekEndStr,
          copenhagenTodayAnchor(),
          orgSettings.timesheetLockAfterWeeks,
        );
      // Auto-lås på fast ugedag (#518) — samme undtagelse som rullende lås
      const autoLocked =
        !rollingLocked &&
        orgSettings.timesheetAutoLockWeekday != null &&
        !roleSatisfies(ctx.orgRole, "manager") &&
        isAutoLocked(
          weekEndStr,
          copenhagenTodayAnchor(),
          orgSettings.timesheetAutoLockWeekday,
        );
      // Periodeafslutning (#518): godkendt/kvitteret periode — gælder alle
      const periodLocked = await isWeekClosingLocked(
        ctx.db,
        ctx.orgId,
        userId,
        input.weekStart,
      );

      // Åbne perioder afgrænses til i dag før rækkeopbygningen (#460)
      const absenceRows = buildAbsenceRows({
        types: orgAbsenceTypes,
        requests: absences.map((a) => ({
          ...a,
          endDate: effectiveEndDate(a.startDate, a.endDate, today),
        })),
        days,
        dailyNorm,
        norms: baseNorms,
        workingDates,
      });

      return {
        days,
        rows,
        // Aktivitetstyper (#459): tom liste = grid'et er ét-rækket pr. projekt
        activityTypes: activeActivityTypes.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          sortOrder: t.sortOrder,
        })),
        // Tilladte aktiviteter pr. projekt (kun projekter med indsnævring;
        // manglende nøgle = alle) — til "Tilføj projekt-række" i UI'et
        allowedActivitiesByProject: Object.fromEntries(
          Array.from(activityCtx.allowedByProject.entries()).map(
            ([projectId, ids]) => [projectId, Array.from(ids)],
          ),
        ) as Record<string, string[]>,
        norms,
        dailyNorm,
        weeklyHours,
        flexBalance:
          Math.round(
            (Number(flexSum[0]?.total ?? 0) -
              ((await getEarnedOvertimeByUser(ctx.db, ctx.orgId, [userId])).get(
                userId,
              ) ?? 0)) *
              100,
          ) / 100,
        holidays: weekHolidays.map((h) => ({
          date: h.date,
          name: h.name,
          isHalfDay: h.isHalfDay,
        })),
        absences: absences.map((a) => ({
          id: a.id,
          startDate: a.startDate,
          endDate: a.endDate,
          status: a.status,
          typeName: a.absenceType?.name ?? st("enterprise.team.absenceLabel"),
          typeColor: a.absenceType?.color ?? "#6b7280",
        })),
        // Redigerbare fraværsrækker (#433) — én pr. aktiv fraværstype
        absenceRows,
        projects: orgProjects.map((p) => ({ id: p.id, name: p.name })),
        // Faste rækker brugeren har skjult (og som ikke har timer i ugen)
        hiddenProjects,
        // Godkendelsesflow: null = kladde (redigerbar)
        weekStatus: weekRow?.status ?? null,
        rejectionReason:
          weekRow?.status === "rejected" ? weekRow.rejectionReason : null,
        // Rullende lås (#467): ugen er ældre end org'ens grænse
        rollingLocked,
        lockAfterWeeks: orgSettings.timesheetLockAfterWeeks,
        autoLocked,
        autoLockWeekday: orgSettings.timesheetAutoLockWeekday,
        periodLocked,
      };
    }),

  /**
   * submitTimesheetWeek — indsend egen uge til leder-godkendelse.
   * Ugen låses (grid-redigering afvises) indtil leder godkender/afviser.
   */
  submitTimesheetWeek: organizationProcedure
    .input(
      z.object({
        weekStart: dateString,
        // Advarsler (over norm, tomme dage) kræver bekræftelse (#467)
        confirm: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const weekStart = entryDateFromStr(input.weekStart);
      const weekEnd = addDays(weekStart, 7);
      const days = Array.from({ length: 7 }, (_, i) =>
        toDateStr(addDays(weekStart, i)),
      );
      const weekEndStr = days[6];

      const existing = await ctx.db.query.timesheetWeeks.findFirst({
        where: and(
          eq(timesheetWeeks.userId, userId),
          eq(timesheetWeeks.organizationId, ctx.orgId),
          eq(timesheetWeeks.weekStart, input.weekStart),
        ),
      });
      if (existing && !canSubmitWeek(existing.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            existing.status === "approved"
              ? await tr(
                  "serverErrors",
                  "enterprise.timesheet.weekApprovedAskManager",
                )
              : await tr(
                  "serverErrors",
                  "enterprise.timesheet.weekAlreadySubmitted",
                ),
        });
      }

      const totals = await ctx.db
        .select({
          total: sql<string>`COALESCE(SUM(${timeEntries.hours}::numeric), 0)`,
        })
        .from(timeEntries)
        .where(
          and(
            ownTimeEntriesInOrg(userId, ctx.orgId),
            timeEntryDateRange(weekStart, weekEnd),
          ),
        );
      const totalHours = Number(totals[0]?.total ?? 0);
      if (totalHours <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.timesheet.weekNothingToSubmit",
          ),
        });
      }

      // Validering ved indsend (#467): fejl blokerer, advarsler kræver
      // bekræftelse fra medarbejderen
      const [dayRows, profile, weekHolidays, absences, orgSettings] =
        await Promise.all([
          ctx.db
            .select({
              day: copenhagenDateSql(timeEntries.date),
              total: sql<string>`SUM(${timeEntries.hours}::numeric)`,
            })
            .from(timeEntries)
            .where(
              and(
                ownTimeEntriesInOrg(userId, ctx.orgId),
                timeEntryDateRange(weekStart, weekEnd),
              ),
            )
            .groupBy(copenhagenDateSql(timeEntries.date)),
          ctx.db.query.employeeProfiles.findFirst({
            where: and(
              eq(employeeProfiles.userId, userId),
              eq(employeeProfiles.organizationId, ctx.orgId),
            ),
          }),
          // Fridagskalenderen (#526): afdeling > org > standard
          loadDaysOff(ctx.db, {
            orgId: ctx.orgId,
            userId,
            start: input.weekStart,
            end: weekEndStr,
          }),
          ctx.db.query.absenceRequests.findMany({
            where: and(
              eq(absenceRequests.userId, userId),
              eq(absenceRequests.organizationId, ctx.orgId),
              ne(absenceRequests.status, "rejected"),
              ne(absenceRequests.status, "cancelled"),
              lte(absenceRequests.startDate, weekEndStr),
              or(
                isNull(absenceRequests.endDate),
                gte(absenceRequests.endDate, input.weekStart),
              ),
            ),
            columns: { status: true, startDate: true, endDate: true },
          }),
          loadOrgWorkSettings(ctx.db, ctx.orgId),
        ]);
      const dayTotals: Record<string, number> = {};
      for (const row of dayRows) {
        dayTotals[toDateStr(new Date(row.day))] =
          Math.round(Number(row.total) * 100) / 100;
      }
      const employmentPeriods = profile
        ? await loadEmploymentPeriodsForUser(ctx.db, userId, ctx.orgId)
        : [];
      const normProfile: NormProfile = profile
        ? (normProfileAt(employmentPeriods, profile, weekEndStr) ??
          normProfileAt(employmentPeriods, profile, input.weekStart) ?? {
            weeklyHours: 0,
            workingDays: [],
          })
        : { weeklyHours: 37, workingDays: null };
      const dailyNorm = calculateDailyNorm(normProfile, orgSettings);
      const { norms, workingDates, absenceDates } = computeWeekNorms({
        days,
        workingDays: normProfile.workingDays ?? DEFAULT_WORKING_DAYS,
        dailyNorm,
        holidays: weekHolidays,
        absences,
        today: copenhagenToday(),
        resolveDay: profile
          ? makeDayResolver(employmentPeriods, profile, orgSettings)
          : undefined,
      });
      const validation = validateTimesheetWeek(
        {
          days,
          totals: dayTotals,
          norms,
          weeklyNorm: calculateWeeklyNorm(normProfile, orgSettings),
          workingDates,
          absenceDates,
        },
        orgSettings.timesheetValidation,
      );
      // Arbejdstidsregler for hele ugen (E11, #469): block → fejl, warn →
      // advarsel der kræver bekræftelse, som den øvrige validering
      const compliance = await checkEntryCompliance(ctx.db, {
        orgId: ctx.orgId,
        userId,
        weekStart: input.weekStart,
      });
      validation.errors.push(...compliance.blocked);
      validation.warnings.push(...compliance.warnings);
      if (validation.errors.length > 0) {
        return {
          status: "blocked" as const,
          errors: validation.errors,
          warnings: validation.warnings,
        };
      }
      if (validation.warnings.length > 0 && !input.confirm) {
        return {
          status: "needs_confirmation" as const,
          errors: [] as string[],
          warnings: validation.warnings,
        };
      }

      const now = new Date();
      // Status, hændelse (#466) og markering af poster i ÉN transaktion
      await ctx.db.transaction(async (tx) => {
        if (existing) {
          await tx
            .update(timesheetWeeks)
            .set({
              status: "submitted",
              totalHours: totalHours.toFixed(2),
              submittedAt: now,
              decidedBy: null,
              decidedAt: null,
              rejectionReason: null,
              updatedAt: now,
            })
            .where(eq(timesheetWeeks.id, existing.id));
        } else {
          await tx.insert(timesheetWeeks).values({
            userId,
            organizationId: ctx.orgId,
            weekStart: input.weekStart,
            status: "submitted",
            totalHours: totalHours.toFixed(2),
            submittedAt: now,
          });
        }

        await insertTimesheetWeekEvent(tx, {
          organizationId: ctx.orgId,
          userId,
          weekStart: input.weekStart,
          event: "submitted",
          actorId: userId,
          totalHours: totalHours.toFixed(2),
        });
        await logOrgAudit(tx, ctx.orgId, userId, "timesheet_week_submitted", {
          targetUserId: userId,
          metadata: {
            weekStart: input.weekStart,
            totalHours,
            previousStatus: existing?.status ?? null,
          },
        });

        // Markér ugens registreringer som afventende godkendelse
        await tx
          .update(timeEntries)
          .set({ approvalStatus: "pending", updatedAt: now })
          .where(
            and(
              ownTimeEntriesInOrg(userId, ctx.orgId),
              timeEntryDateRange(weekStart, weekEnd),
            ),
          );
      });

      // Besked til leder(e) via notifikationsbussen (E10) — best effort,
      // bussen kaster aldrig. Advarsler fra arbejdstidsreglerne (E11) sendes
      // som egen hændelse til samme modtagere.
      try {
        const profile = await ctx.db.query.employeeProfiles.findFirst({
          where: and(
            eq(employeeProfiles.userId, userId),
            eq(employeeProfiles.organizationId, ctx.orgId),
          ),
          with: { user: { columns: { name: true } } },
        });
        const employeeName = profile?.user?.name ?? "En medarbejder";
        const managerIds = await resolveManagerRecipientIds(ctx.db, {
          orgId: ctx.orgId,
          employeeUserId: userId,
          excludeUserId: userId,
        });
        void notify({
          orgId: ctx.orgId,
          event: "timesheet.submitted",
          payload: {
            employeeName,
            employeeUserId: userId,
            weekStart: input.weekStart,
            totalHours,
          },
          userIds: managerIds,
        });
        if (compliance.warnings.length > 0) {
          void notify({
            orgId: ctx.orgId,
            event: "compliance.warning",
            payload: {
              employeeName,
              employeeUserId: userId,
              weekStart: input.weekStart,
              findings: compliance.warnings,
            },
            userIds: managerIds,
          });
        }
      } catch (e) {
        console.error("[timesheet] Kunne ikke sende leder-notifikation:", e);
      }

      return {
        status: "submitted" as const,
        totalHours,
        errors: [] as string[],
        warnings: validation.warnings,
      };
    }),

  /**
   * setTimesheetCell — sæt dagstotalen for et projekt. Grid'et ejer én
   * aggregeret post pr. projekt/dag (source="timesheet"); detaljerede
   * registreringer fra timer/kalender røres ikke, så cellens værdi kan
   * aldrig sættes lavere end summen af dem.
   */
  setTimesheetCell: organizationProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        // Aktivitetstype (#459): udeladt/null = række uden aktivitet
        activityTypeId: z.string().uuid().nullable().optional(),
        date: dateString,
        hours: z.number().min(0).max(24),
        // Cellenote (#467): udeladt = behold eksisterende, "" = fjern
        note: z.string().max(TIMESHEET_NOTE_MAX_LENGTH).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const activityTypeId = input.activityTypeId ?? null;

      // Fælles guard (#467): periodelås, ugestatus, rullende lås
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        role: ctx.orgRole,
        dates: [input.date],
      });

      // Projektet skal tilhøre organisationen
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, ctx.orgId),
        ),
        columns: { id: true, clientId: true },
      });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.projectNotInOrg"),
        });
      }

      // Læs → skriv → flex i én transaktion (#1112). Der er ingen unik nøgle
      // pr. grid-celle, så samtidige autosaves serialiseres med en lås pr.
      // medarbejder og dag — ellers ser begge en tom celle og indsætter hver
      // sin post, og flex-rækken for dagen kolliderer.
      return ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`timesheet-day:${ctx.orgId}:${userId}:${input.date}`}))`,
        );

        const dayStart = entryDateFromStr(input.date);
        const dayEnd = addDays(dayStart, 1);
        // Nøglen er (projekt, aktivitet, dag) — poster med en anden aktivitet
        // er egne celler og røres ikke (#459)
        const dayEntries = await tx.query.timeEntries.findMany({
          where: and(
            ownTimeEntriesInOrg(userId, ctx.orgId),
            eq(timeEntries.projectId, input.projectId),
            activityTypeId
              ? eq(timeEntries.activityTypeId, activityTypeId)
              : isNull(timeEntries.activityTypeId),
            timeEntryDateRange(dayStart, dayEnd),
          ),
        });

        // Ny registrering på en aktivitet kræver at typen er aktiv i org'en og
        // tilladt på projektet. Eksisterende celler (fx arkiveret type) må
        // stadig rettes og nulstilles.
        if (activityTypeId && dayEntries.length === 0 && input.hours > 0) {
          const activityCtx = await loadActivityContext(tx, ctx.orgId);
          const allowed = allowedActivitiesForProject(
            input.projectId,
            activityCtx.types,
            activityCtx.allowedByProject,
          );
          if (!allowed.some((t) => t.id === activityTypeId)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.timesheet.activityNotAllowed",
              ),
            });
          }
        }

        const gridEntries = dayEntries.filter(
          (e) => e.source === TIMESHEET_SOURCE,
        );
        // Fakturerede grid-poster er låst (#702) — cellen overskriver dem
        assertNoEntriesBilled(gridEntries, "ændres");
        const otherSum = dayEntries
          .filter((e) => e.source !== TIMESHEET_SOURCE)
          .reduce((sum, e) => sum + (Number(e.hours) || 0), 0);

        const targetGridHours =
          Math.round((input.hours - otherSum) * 100) / 100;
        const description =
          input.note === undefined ? undefined : noteToDescription(input.note);
        if (targetGridHours < -0.001) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr(
              "serverErrors",
              "enterprise.timesheet.dayHasDetailed",
              {
                hours: otherSum.toLocaleString(toIntlLocale(activeLocale()), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }),
              },
            ),
          });
        }

        // Arbejdstidsregler (E11, #469): grid-posterne cellen erstatter regnes
        // ikke med; kandidaten er den nye grid-andel (uden klokkeslæt →
        // dagsum-heuristik for 11 t-reglen)
        const complianceWarnings = await assertEntryCompliant(tx, {
          orgId: ctx.orgId,
          userId,
          candidate: { date: input.date, hours: Math.max(targetGridHours, 0) },
          excludeEntryIds: gridEntries.map((e) => e.id),
        });

        const entryDate = dayStart;

        if (gridEntries.length > 0) {
          const [first, ...rest] = gridEntries;
          // Konsolidér evt. flere grid-poster til én
          for (const extra of rest) {
            await tx.delete(timeEntries).where(eq(timeEntries.id, extra.id));
          }
          if (targetGridHours <= 0.001) {
            await tx.delete(timeEntries).where(eq(timeEntries.id, first.id));
          } else {
            await tx
              .update(timeEntries)
              .set({
                hours: targetGridHours.toFixed(2),
                date: entryDate,
                ...(description !== undefined ? { description } : {}),
                updatedAt: new Date(),
              })
              .where(eq(timeEntries.id, first.id));
          }
        } else if (targetGridHours > 0.001) {
          await tx.insert(timeEntries).values({
            userId,
            organizationId: ctx.orgId,
            projectId: input.projectId,
            clientId: project.clientId,
            activityTypeId,
            description: description ?? noteToDescription(null),
            hours: targetGridHours.toFixed(2),
            date: entryDate,
            // Aktivitetstypens fakturerbarhed (#704); ellers som før: false
            isBillable: await resolveDefaultBillable(
              tx,
              {
                projectId: input.projectId,
                clientId: project.clientId,
                activityTypeId,
              },
              null,
              { fallback: false },
            ),
            source: TIMESHEET_SOURCE,
          });
        }

        // Hold flex-saldoen i sync med det samme
        await recalculateFlexDay(tx, {
          userId,
          orgId: ctx.orgId,
          date: input.date,
        });

        return {
          projectId: input.projectId,
          activityTypeId,
          date: input.date,
          total:
            Math.round((otherSum + Math.max(targetGridHours, 0)) * 100) / 100,
          complianceWarnings,
        };
      });
    }),

  /**
   * reassignEntriesActivity (#475) — flyt egne grid-poster (source=timesheet)
   * på et projekt fra én aktivitet (typisk null = "(uden aktivitet)") til en
   * anden. Kun poster i den angivne uge, ellers alle. Timerne pr. dag er
   * uændrede, så flex røres ikke; setTimesheetCell konsoliderer evt. dubletter
   * i mål-cellen ved næste redigering. Detaljerede registreringer (timer/
   * kalender) røres aldrig — de redigeres under Tidsregistrering.
   */
  reassignEntriesActivity: organizationProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        fromActivityTypeId: z.string().uuid().nullable(),
        toActivityTypeId: z.string().uuid(),
        weekStart: dateString.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (input.fromActivityTypeId === input.toActivityTypeId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.timesheet.chooseOtherActivity",
          ),
        });
      }
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, ctx.orgId),
        ),
        columns: { id: true, name: true },
      });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.projectNotInOrg"),
        });
      }
      const activityCtx = await loadActivityContext(ctx.db, ctx.orgId);
      const target = allowedActivitiesForProject(
        input.projectId,
        activityCtx.types,
        activityCtx.allowedByProject,
      ).find((t) => t.id === input.toActivityTypeId);
      if (!target) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.timesheet.activityNotAllowed",
          ),
        });
      }

      const weekStartDate = input.weekStart
        ? entryDateFromStr(input.weekStart)
        : null;
      const candidates = await ctx.db.query.timeEntries.findMany({
        where: and(
          ownTimeEntriesInOrg(userId, ctx.orgId),
          eq(timeEntries.projectId, input.projectId),
          eq(timeEntries.source, TIMESHEET_SOURCE),
          input.fromActivityTypeId
            ? eq(timeEntries.activityTypeId, input.fromActivityTypeId)
            : isNull(timeEntries.activityTypeId),
          ...(weekStartDate
            ? [timeEntryDateRange(weekStartDate, addDays(weekStartDate, 7))]
            : []),
        ),
        columns: { id: true, date: true, isBilled: true, invoiceId: true },
      });
      if (candidates.length === 0) return { moved: 0 };
      // Fakturerede poster er låst (#702)
      assertNoEntriesBilled(candidates, "flyttes");

      // Fælles guard (#467): periodelås, ugestatus, rullende lås for de dage
      // der faktisk flyttes
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        role: ctx.orgRole,
        dates: Array.from(
          new Set(candidates.map((e) => toCopenhagenDateStr(e.date))),
        ),
      });

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(timeEntries)
          .set({
            activityTypeId: input.toActivityTypeId,
            updatedAt: new Date(),
          })
          .where(
            inArray(
              timeEntries.id,
              candidates.map((e) => e.id),
            ),
          );
        await logOrgAudit(tx, ctx.orgId, userId, "time_entry_updated", {
          targetUserId: userId,
          metadata: {
            reason: "reassign_activity",
            projectId: project.id,
            projectName: project.name,
            fromActivityTypeId: input.fromActivityTypeId,
            toActivityTypeId: target.id,
            toActivityName: target.name,
            weekStart: input.weekStart ?? null,
            count: candidates.length,
          },
        });
      });

      return { moved: candidates.length };
    }),

  /**
   * setAbsenceCell (#433) — skriv timer i en fraværsrække. Grid'et kender
   * kun hele og halve dage: timer ≥ dagsnorm ⇒ heldag, 0 < timer < norm ⇒
   * halv dag, 0 ⇒ slet (pending) / annullér (approved). Skriver én 1-dags
   * absence_request pr. type/dag; status følger typens requiresApproval.
   * Dage der er dækket af en flerdages periode kan kun rettes under Fravær.
   */
  setAbsenceCell: organizationProcedure
    .input(
      z.object({
        date: dateString,
        absenceTypeId: z.string().uuid(),
        hours: z.number().min(0).max(24),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Fælles guard (#467): periodelås, ugestatus, rullende lås
      await assertEntryEditable(ctx.db, {
        orgId: ctx.orgId,
        userId,
        role: ctx.orgRole,
        dates: [input.date],
      });
      const cellDate = entryDateFromStr(input.date);

      // Alle læsninger der påvirker beslutningen OG alle skrivninger
      // (anmodning, feriesaldo, overtidssaldo, flex) i én transaktion (#452),
      // så to samtidige kald ikke begge ser "ingen dækkende anmodning".
      // Sidste værn er det partielle unikke indeks
      // absence_requests_timesheet_day_unique (migration 0089).
      return ctx.db
        .transaction(async (tx) => {
          const [profile, absenceType, holiday, covering] = await Promise.all([
            tx.query.employeeProfiles.findFirst({
              where: and(
                eq(employeeProfiles.userId, userId),
                eq(employeeProfiles.organizationId, ctx.orgId),
              ),
            }),
            tx.query.absenceTypes.findFirst({
              where: and(
                eq(absenceTypes.id, input.absenceTypeId),
                eq(absenceTypes.organizationId, ctx.orgId),
              ),
            }),
            // Fridagskalenderen (#526) — læses uden for transaktionen
            loadDayOffCalendar(ctx.db, { orgId: ctx.orgId, userId }).then(
              (calendar) => calendar.lookup(input.date),
            ),
            // Alle aktive anmodninger der dækker dagen (uanset type)
            tx.query.absenceRequests.findMany({
              where: and(
                eq(absenceRequests.userId, userId),
                eq(absenceRequests.organizationId, ctx.orgId),
                not(inArray(absenceRequests.status, ["cancelled", "rejected"])),
                lte(absenceRequests.startDate, input.date),
                or(
                  isNull(absenceRequests.endDate),
                  gte(absenceRequests.endDate, input.date),
                ),
              ),
              with: {
                absenceType: {
                  columns: { deductsVacation: true, vacationPool: true },
                },
              },
            }),
          ]);
          const orgSettings = await loadOrgWorkSettings(tx, ctx.orgId);

          if (!profile) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.timesheet.noEmployeeProfile",
              ),
            });
          }
          if (!absenceType || absenceType.isArchived) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: await tr(
                "serverErrors",
                "enterprise.absenceTypeNotFound",
              ),
            });
          }

          if (covering.some((r) => r.source === "closure")) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: await tr(
                "serverErrors",
                "enterprise.timesheet.fixedHoliday",
              ),
            });
          }
          if (covering.some((r) => r.startDate !== r.endDate)) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: await tr(
                "serverErrors",
                "enterprise.timesheet.coveredByLongAbsence",
              ),
            });
          }
          // Kun grid'ets egne poster (source=timesheet) kan overtages (#457);
          // en manuel anmodning eller en anden type på dagen er "fremmed"
          const { existing, foreign } = pickAbsenceCellRequest(
            covering,
            input.absenceTypeId,
          );
          const foreignSameType =
            foreign?.absenceTypeId === input.absenceTypeId;
          const rejectForeign = (): never => {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: foreignSameType
                ? st("enterprise.timesheet.coveredByRequest")
                : st("enterprise.timesheet.otherTypeAbsence"),
            });
          };

          // Ansættelseshistorik (#465): vilkårene som de gjaldt på dagen
          const employment = normProfileAt(
            await loadEmploymentPeriodsForUser(tx, userId, ctx.orgId),
            profile,
            input.date,
          );
          if (!employment) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: await tr(
                "serverErrors",
                "enterprise.timesheet.notEmployed",
              ),
            });
          }
          const workingDays = employment.workingDays ?? DEFAULT_WORKING_DAYS;
          const isoDay =
            cellDate.getUTCDay() === 0 ? "7" : String(cellDate.getUTCDay());
          // Effektiv dagsnorm: halveret på en halvdags-helligdag, så en "hel"
          // fraværsdag dér svarer til den halve norm — i celle-tolkning,
          // svar-timer og afspadserings-fradrag (#452).
          const dailyNorm = calculateDailyNorm(employment, orgSettings);
          const effectiveNorm = holiday?.isHalfDay ? dailyNorm / 2 : dailyNorm;
          const { days, halfDay } = hoursToAbsenceDays(
            input.hours,
            effectiveNorm,
          );
          const pool = toVacationPool(absenceType.vacationPool);

          /** Tilbagefør en godkendt anmodnings virkning på ferie- og overtidssaldo. */
          const reverseApproved = async (
            req: (typeof covering)[number],
          ): Promise<void> => {
            if (req.status !== "approved") return;
            if (req.absenceType.deductsVacation && req.deductedDays) {
              await postVacationUsage(tx, {
                userId,
                orgId: ctx.orgId,
                date: req.startDate,
                days: -Number(req.deductedDays),
                pool: toVacationPool(req.absenceType.vacationPool),
                refType: "absence_request",
                refId: req.id,
                note: "Ændret i timeseddel",
                createdBy: ctx.session.user.id,
              });
            }
            await tx
              .delete(overtimeLedger)
              .where(
                and(
                  eq(overtimeLedger.organizationId, ctx.orgId),
                  eq(overtimeLedger.absenceRequestId, req.id),
                ),
              );
          };

          // 0 timer: fjern cellen (pending slettes, approved annulleres).
          // Viser cellen en manuel anmodning af typen, kan den ikke ryddes her.
          if (days === 0) {
            if (!existing && foreignSameType) rejectForeign();
            if (existing) {
              await reverseApproved(existing);
              if (existing.status === "pending") {
                await tx
                  .delete(absenceRequests)
                  .where(eq(absenceRequests.id, existing.id));
              } else {
                await tx
                  .update(absenceRequests)
                  .set({ status: "cancelled", updatedAt: new Date() })
                  .where(eq(absenceRequests.id, existing.id));
              }
              await logOrgAudit(
                tx,
                ctx.orgId,
                userId,
                "absence_request_cancelled",
                {
                  targetUserId: userId,
                  metadata: {
                    requestId: existing.id,
                    absenceTypeId: absenceType.id,
                    date: input.date,
                    previousStatus: existing.status,
                    source: "timesheet",
                  },
                },
              );
              await recalculateFlexDay(tx, {
                userId,
                orgId: ctx.orgId,
                date: input.date,
              });
            }
            return {
              date: input.date,
              requestId: null as string | null,
              status: null as "pending" | "approved" | null,
              hours: 0,
              warning: false,
            };
          }

          if (
            !workingDays.includes(isoDay) ||
            (holiday && !holiday.isHalfDay)
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.timesheet.holidayNoAbsence",
              ),
            });
          }
          if (foreign) rejectForeign();

          // Feriedage trækkes med samme faktor som createRequest (#461):
          // 1:1 i monthly-orgs, FTE-konverteret i upfront-orgs
          let deductedDays: number | null = null;
          let warning = false;
          if (absenceType.deductsVacation) {
            const vacationSettings = await getVacationOrgSettings(
              tx,
              ctx.orgId,
            );
            const factor = vacationDeductionFactor(
              vacationSettings,
              Number(employment.weeklyHours),
            );
            deductedDays = applyConversionFactor(days, factor);
            // Lås saldo-rækken (FOR UPDATE) FØR guarden, så samtidige
            // registreringer serialiseres og ikke begge passerer (#452).
            const balance = await lockVacationBalance(
              tx,
              userId,
              ctx.orgId,
              input.date,
            );
            // Saldo-guarden ser kun på den EKSTRA belastning ift. det allerede
            // godkendte, så en heldag → halvdag aldrig afvises.
            const alreadyDeducted =
              existing?.status === "approved"
                ? Number(existing.deductedDays ?? 0)
                : 0;
            const remaining = remainingInPool(balance, pool) + alreadyDeducted;
            const overdraft = await getVacationOverdraft(tx, ctx.orgId);
            const guard = evaluateVacationGuard(
              remaining,
              deductedDays,
              overdraft,
            );
            if (!guard.allowed) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: vacationGuardMessage(
                  pool,
                  remaining,
                  deductedDays,
                  overdraft,
                ),
              });
            }
            warning = guard.warning;
          }

          const status: "pending" | "approved" = absenceType.requiresApproval
            ? "pending"
            : "approved";
          const now = new Date();
          let requestId: string;

          if (existing) {
            await reverseApproved(existing);
            await tx
              .update(absenceRequests)
              .set({
                halfDayStart: halfDay,
                halfDayEnd: false,
                totalDays: String(days),
                deductedDays:
                  deductedDays !== null ? String(deductedDays) : null,
                status,
                approvedBy: null,
                approvedAt: status === "approved" ? now : null,
                rejectionReason: null,
                updatedAt: now,
              })
              .where(eq(absenceRequests.id, existing.id));
            requestId = existing.id;
          } else {
            const [created] = await tx
              .insert(absenceRequests)
              .values({
                userId,
                organizationId: ctx.orgId,
                absenceTypeId: input.absenceTypeId,
                startDate: input.date,
                endDate: input.date,
                halfDayStart: halfDay,
                halfDayEnd: false,
                totalDays: String(days),
                deductedDays:
                  deductedDays !== null ? String(deductedDays) : null,
                status,
                approvedAt: status === "approved" ? now : null,
                note: "Registreret i timeseddel",
                source: "timesheet",
              })
              .returning({ id: absenceRequests.id });
            requestId = created.id;
          }

          await logOrgAudit(
            tx,
            ctx.orgId,
            userId,
            existing ? "absence_request_updated" : "absence_request_created",
            {
              targetUserId: userId,
              metadata: {
                requestId,
                absenceTypeId: absenceType.id,
                date: input.date,
                days,
                status,
                source: "timesheet",
                ...(existing
                  ? {
                      diff: {
                        totalDays: {
                          from: Number(existing.totalDays ?? 0),
                          to: days,
                        },
                      },
                    }
                  : {}),
              },
            },
          );

          if (status === "approved" && deductedDays !== null) {
            await postVacationUsage(tx, {
              userId,
              orgId: ctx.orgId,
              date: input.date,
              days: deductedDays,
              pool,
              refType: "absence_request",
              refId: requestId,
              note: "Registreret i timeseddel",
              createdBy: ctx.session.user.id,
            });
          }

          // Afspadsering auto-godkendt i grid'et: samme negative ledger-post
          // som approveRequest, knyttet til anmodningen så reverseApproved
          // kan fjerne den igen ved sletning/annullering (#452).
          if (status === "approved" && absenceType.deductsOvertime) {
            // Kalender-dage × effektiv norm — ikke FTE-skalerede deductedDays
            const deduction = overtimeDeductionForAbsence({
              days,
              dailyNorm: effectiveNorm,
              startDate: input.date,
              endDate: input.date,
            });
            if (deduction) {
              await insertOvertimeLedger(tx, {
                organizationId: ctx.orgId,
                userId,
                type: "used",
                hours: deduction.hours,
                absenceRequestId: requestId,
                note: deduction.note,
                createdBy: userId,
              });
            }
          }

          await recalculateFlexDay(tx, {
            userId,
            orgId: ctx.orgId,
            date: input.date,
          });

          return {
            date: input.date,
            requestId: requestId as string | null,
            status: status as "pending" | "approved" | null,
            hours: Math.round(days * effectiveNorm * 100) / 100,
            // Feriesaldoen bliver negativ (inden for tolerancen) — UI viser advarsel
            warning,
          };
        })
        .catch((err: unknown) => {
          // Det unikke indeks fangede en samtidig registrering af samme
          // type/dag — bed brugeren genindlæse i stedet for en 500'er.
          if (isUniqueViolation(err)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: st("enterprise.timesheet.absenceRecordedElsewhere"),
            });
          }
          throw err;
        });
    }),

  /**
   * copyTimesheetWeek — kopiér sidste uges fordeling ind i en uge.
   * Overskriver aldrig celler der allerede har timer.
   */
  copyTimesheetWeek: organizationProcedure
    .input(z.object({ weekStart: dateString }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const sourceWeek = toDateStr(
        addDays(entryDateFromStr(input.weekStart), -7),
      );
      const cells = await buildCellsFromWeek(
        ctx.db,
        ctx.orgId,
        userId,
        sourceWeek,
      );
      if (cells.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.timesheet.lastWeekEmpty",
          ),
        });
      }
      return fillWeekCells(
        ctx.db,
        ctx.orgId,
        userId,
        ctx.orgRole,
        input.weekStart,
        cells,
      );
    }),

  /** saveTimesheetTemplate — gem en uges fordeling som navngiven skabelon. */
  saveTimesheetTemplate: organizationProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1, { error: () => st("zod.templateNameRequired") })
          .max(100),
        weekStart: dateString,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const cells = await buildCellsFromWeek(
        ctx.db,
        ctx.orgId,
        userId,
        input.weekStart,
      );
      if (cells.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.timesheet.weekNothingToSave",
          ),
        });
      }
      const templateData = templateDataFromCells(cells);

      const existing = await ctx.db.query.timesheetTemplates.findFirst({
        where: and(
          eq(timesheetTemplates.userId, userId),
          eq(timesheetTemplates.organizationId, ctx.orgId),
          eq(timesheetTemplates.name, input.name),
        ),
        columns: { id: true },
      });
      if (existing) {
        await ctx.db
          .update(timesheetTemplates)
          .set({ templateData, updatedAt: new Date() })
          .where(eq(timesheetTemplates.id, existing.id));
        return { id: existing.id, updated: true };
      }
      const [created] = await ctx.db
        .insert(timesheetTemplates)
        .values({
          userId,
          organizationId: ctx.orgId,
          name: input.name,
          templateData,
        })
        .returning({ id: timesheetTemplates.id });
      return { id: created.id, updated: false };
    }),

  /** listTimesheetTemplates — egne skabeloner med ugetotal. */
  listTimesheetTemplates: organizationProcedure.query(async ({ ctx }) => {
    const templates = await ctx.db.query.timesheetTemplates.findMany({
      where: and(
        eq(timesheetTemplates.userId, ctx.session.user.id),
        eq(timesheetTemplates.organizationId, ctx.orgId),
      ),
      orderBy: (t, { asc: ascFn }) => [ascFn(t.name)],
    });
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      totalHours:
        Math.round(t.templateData.reduce((sum, c) => sum + c.hours, 0) * 100) /
        100,
    }));
  }),

  /** applyTimesheetTemplate — udfyld en uge fra en gemt skabelon. */
  applyTimesheetTemplate: organizationProcedure
    .input(z.object({ templateId: z.string().uuid(), weekStart: dateString }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const template = await ctx.db.query.timesheetTemplates.findFirst({
        where: and(
          eq(timesheetTemplates.id, input.templateId),
          eq(timesheetTemplates.userId, userId),
          eq(timesheetTemplates.organizationId, ctx.orgId),
        ),
      });
      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.timesheet.templateMissing",
          ),
        });
      }
      // Skabeloner fra før #459 har ingen aktivitet (→ null)
      const cells = cellsFromTemplateData(template.templateData);
      return fillWeekCells(
        ctx.db,
        ctx.orgId,
        userId,
        ctx.orgRole,
        input.weekStart,
        cells,
      );
    }),

  /** deleteTimesheetTemplate — slet egen skabelon. */
  deleteTimesheetTemplate: organizationProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(timesheetTemplates)
        .where(
          and(
            eq(timesheetTemplates.id, input.templateId),
            eq(timesheetTemplates.userId, ctx.session.user.id),
            eq(timesheetTemplates.organizationId, ctx.orgId),
          ),
        );
      return { deleted: true };
    }),

  /**
   * exportMyTimeData — egne registreringer som liste (arbejdstidslovens krav
   * om medarbejder-adgang til egne arbejdstidsdata). Maks 50.000 rækker.
   */
  exportMyTimeData: organizationProcedure
    .input(z.object({ from: dateString, to: dateString }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const fromDate = entryDateFromStr(input.from);
      const toDate = addDays(entryDateFromStr(input.to), 1);
      const MAX_ROWS = 50_000;

      const entries = await ctx.db.query.timeEntries.findMany({
        where: and(
          ownTimeEntriesInOrg(userId, ctx.orgId),
          timeEntryDateRange(fromDate, toDate),
        ),
        columns: {
          date: true,
          hours: true,
          description: true,
          source: true,
          approvalStatus: true,
        },
        with: {
          project: { columns: { name: true } },
          activityType: { columns: { name: true } },
        },
        orderBy: (t, { asc: ascFn }) => [ascFn(t.date)],
        limit: MAX_ROWS + 1,
      });

      const truncated = entries.length > MAX_ROWS;
      return {
        truncated,
        entries: (truncated ? entries.slice(0, MAX_ROWS) : entries).map(
          (e) => ({
            date: toCopenhagenDateStr(e.date),
            hours: Number(e.hours) || 0,
            project: e.project?.name ?? "",
            activity: e.activityType?.name ?? "",
            description: e.description ?? "",
            source: e.source ?? "manual",
            approvalStatus: e.approvalStatus,
          }),
        ),
      };
    }),
});
