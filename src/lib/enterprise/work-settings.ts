import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import {
  BREAK_POLICIES,
  type BreakPolicy,
  DEFAULT_ORG_WORK_SETTINGS,
  type OrgWorkSettings,
} from "./timesheet";
import { DEFAULT_TIMESHEET_VALIDATION_SETTINGS } from "./timesheet-validation";

type OrgWorkRow = Pick<
  typeof schema.organizations.$inferSelect,
  | "defaultWeeklyHours"
  | "dailyNormHours"
  | "breakMinutesPerDay"
  | "breakPolicy"
  | "timesheetMaxHoursPerDay"
  | "timesheetWarnOverNorm"
  | "timesheetBlockEmptyWorkdays"
  | "timesheetLockAfterWeeks"
> &
  Partial<
    Pick<typeof schema.organizations.$inferSelect, "timesheetAutoLockWeekday">
  >;

/** Map en organisations-række til rene tal (numeric kommer som streng fra pg). */
export function toOrgWorkSettings(
  org: OrgWorkRow | null | undefined,
): OrgWorkSettings {
  if (!org) return DEFAULT_ORG_WORK_SETTINGS;
  const policy = BREAK_POLICIES.includes(org.breakPolicy as BreakPolicy)
    ? (org.breakPolicy as BreakPolicy)
    : "none";
  const dailyNorm =
    org.dailyNormHours == null ? null : Number(org.dailyNormHours);
  return {
    defaultWeeklyHours:
      Number(org.defaultWeeklyHours) > 0
        ? Number(org.defaultWeeklyHours)
        : DEFAULT_ORG_WORK_SETTINGS.defaultWeeklyHours,
    dailyNormHours: dailyNorm != null && dailyNorm > 0 ? dailyNorm : null,
    breakMinutesPerDay: Math.max(0, Number(org.breakMinutesPerDay) || 0),
    breakPolicy: policy,
    timesheetValidation: {
      maxHoursPerDay:
        Number(org.timesheetMaxHoursPerDay) > 0
          ? Number(org.timesheetMaxHoursPerDay)
          : DEFAULT_TIMESHEET_VALIDATION_SETTINGS.maxHoursPerDay,
      warnOverNorm: org.timesheetWarnOverNorm ?? true,
      blockEmptyWorkdays: org.timesheetBlockEmptyWorkdays ?? false,
    },
    timesheetLockAfterWeeks:
      org.timesheetLockAfterWeeks != null && org.timesheetLockAfterWeeks >= 0
        ? org.timesheetLockAfterWeeks
        : null,
    timesheetAutoLockWeekday:
      org.timesheetAutoLockWeekday != null &&
      org.timesheetAutoLockWeekday >= 1 &&
      org.timesheetAutoLockWeekday <= 7
        ? org.timesheetAutoLockWeekday
        : null,
  };
}

/**
 * Hent org'ens arbejdstids-indstillinger (#449) — kald ÉN gang pr. request
 * og send resultatet videre til calculateDailyNorm/recalculateFlexDay.
 */
export async function loadOrgWorkSettings(
  db: PostgresJsDatabase<typeof schema>,
  orgId: string,
): Promise<OrgWorkSettings> {
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
    columns: {
      defaultWeeklyHours: true,
      dailyNormHours: true,
      breakMinutesPerDay: true,
      breakPolicy: true,
      timesheetMaxHoursPerDay: true,
      timesheetWarnOverNorm: true,
      timesheetBlockEmptyWorkdays: true,
      timesheetLockAfterWeeks: true,
      timesheetAutoLockWeekday: true,
    },
  });
  return toOrgWorkSettings(org);
}
