import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import type { db as DbClient } from "@/lib/db";
import {
  employeeProfiles,
  members,
  organizations,
  timesheetWeeks,
} from "@/lib/db/schema";
import { assertPeriodUnlocked } from "@/lib/org/period-lock";
import {
  maxOrgRole,
  type OrgRole,
  roleSatisfies,
} from "@/lib/permissions/org-role";
import {
  copenhagenTodayAnchor,
  isDateStr,
  toCopenhagenDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";
import { assertClosingUnlocked } from "./period-closing-lock";
import {
  autoLockMessage,
  isAutoLocked,
  isRollingLocked,
  rollingLockMessage,
} from "./timesheet-validation";

type Db = typeof DbClient;
type TxOrDb = Pick<Db, "query">;

export type EditGuardInput = {
  /** Aktiv org — null/undefined = solo-bruger, ingen låse. */
  orgId: string | null | undefined;
  /** Ejeren af registreringen (ugestatus og rullende lås gælder ejeren). */
  userId: string;
  /** Alle datoer der berøres (gammel + ny ved flytning). */
  dates: ReadonlyArray<Date | string | null | undefined>;
  /**
   * Den handlendes org-rolle, hvis kendt (organizationProcedure). Udeladt →
   * slås op for `actorUserId ?? userId`. Admin/manager er undtaget den
   * rullende lås — ikke periodelås og ugestatus.
   */
  role?: OrgRole | null;
  actorUserId?: string;
  /** Eksisterende poster der redigeres/slettes (til approvalStatus-laget). */
  entries?: ReadonlyArray<{ approvalStatus: string | null }>;
  /** Referencedato for den rullende lås (tests). */
  today?: Date;
  /**
   * Kun lag 1 (periodelås + periodeafslutning). Til "marker faktureret",
   * der kun sætter isBilled og skal kunne ske efter godkendelse (#1107).
   */
  periodOnly?: boolean;
};

/** Mandag (YYYY-MM-DD) i ugen der indeholder datoen. */
export function weekStartOf(date: Date | string): string {
  return weekStartDateStr(
    typeof date === "string" ? date : toCopenhagenDateStr(date),
  );
}

/** Højeste af members.role og employee_profiles.role — som organizationProcedure. */
export async function resolveOrgRole(
  db: TxOrDb,
  orgId: string,
  userId: string,
): Promise<OrgRole | null> {
  const [membership, profile] = await Promise.all([
    db.query.members.findFirst({
      where: and(eq(members.organizationId, orgId), eq(members.userId, userId)),
      columns: { role: true },
    }),
    db.query.employeeProfiles.findFirst({
      where: and(
        eq(employeeProfiles.organizationId, orgId),
        eq(employeeProfiles.userId, userId),
      ),
      columns: { role: true },
    }),
  ]);
  if (!membership) return null;
  const base = membership.role as OrgRole;
  const profileRole = profile?.role as OrgRole | undefined;
  return profileRole ? maxOrgRole(base, profileRole) : base;
}

/**
 * Fælles redigeringsguard for ALLE registreringsveje (#467): kaster hvis en
 * af datoerne ikke må ændres for brugeren. Lagene, i rækkefølge:
 *  1. org-periodelås (org_period_locks, #144) og periodeafslutning
 *     (period_closings godkendt/kvitteret, #518) — ingen undtagelser
 *  2. ugestatus (timesheet_weeks submitted/approved)
 *  3. godkendte poster (approvalStatus=approved i en uge med ugerække)
 *  4. rullende lås (organizations.timesheet_lock_after_weeks) og auto-lås
 *     på fast ugedag (timesheet_auto_lock_weekday, #518) — undtaget
 *     admin/manager
 * No-op uden org. Kald FØR skrivning; ved flytning med både gammel og ny dato.
 */
export async function assertEntryEditable(
  db: TxOrDb,
  input: EditGuardInput,
): Promise<void> {
  const { orgId, userId } = input;
  if (!orgId) return;

  const dates: (Date | string)[] = [];
  const danishDates: string[] = [];
  for (const raw of input.dates) {
    if (!raw) continue;
    const instant = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(instant.getTime())) continue;
    dates.push(raw);
    danishDates.push(
      typeof raw === "string" && isDateStr(raw)
        ? raw
        : toCopenhagenDateStr(instant),
    );
  }
  if (dates.length === 0) return;

  // 1. Periodelås + periodeafslutning
  await assertPeriodUnlocked(db, orgId, dates);
  await assertClosingUnlocked(db, orgId, userId, danishDates);
  if (input.periodOnly) return;

  // 2. Ugestatus for alle berørte uger
  const weekRows = await db.query.timesheetWeeks.findMany({
    where: and(
      eq(timesheetWeeks.userId, userId),
      eq(timesheetWeeks.organizationId, orgId),
      inArray(timesheetWeeks.weekStart, [
        ...new Set(danishDates.map(weekStartOf)),
      ]),
    ),
    columns: { weekStart: true, status: true },
  });
  for (const row of weekRows) {
    if (row.status === "approved") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "enterprise.edit.weekApprovedLocked"),
      });
    }
    if (row.status === "submitted") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "enterprise.edit.weekSubmitted"),
      });
    }
  }

  // 3. Godkendte poster i timeseddel-flowet. Kun når ugen har en ugerække,
  // så freelance-flowets kunde-godkendelse (per_entry) ikke låser posterne.
  if (
    weekRows.length > 0 &&
    input.entries?.some((e) => e.approvalStatus === "approved")
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "enterprise.edit.entryApproved"),
    });
  }

  // 4. Rullende lås + auto-lås på fast ugedag
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { timesheetLockAfterWeeks: true, timesheetAutoLockWeekday: true },
  });
  const lockAfterWeeks = org?.timesheetLockAfterWeeks ?? null;
  const autoLockWeekday = org?.timesheetAutoLockWeekday ?? null;
  if (lockAfterWeeks == null && autoLockWeekday == null) return;

  // Dansk dato som anker uanset processens TZ (#649)
  const today = copenhagenTodayAnchor(input.today);
  const rolling = danishDates.some((d) =>
    isRollingLocked(d, today, lockAfterWeeks),
  );
  const auto = danishDates.some((d) => isAutoLocked(d, today, autoLockWeekday));
  if (!rolling && !auto) return;

  const role =
    input.role === undefined
      ? await resolveOrgRole(db, orgId, input.actorUserId ?? userId)
      : input.role;
  if (roleSatisfies(role, "manager")) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      rolling && lockAfterWeeks != null
        ? rollingLockMessage(lockAfterWeeks)
        : autoLockMessage(autoLockWeekday ?? 0),
  });
}
