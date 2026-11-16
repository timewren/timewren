// DB-lag for periodeafslutning (#518). Reglerne ligger i ./period-closing,
// normen og flexen i ./norm-period(-load) — opgørelsen er den samme
// beregning som flexsaldoen, bare for afslutningsperioden.

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { isEnterpriseEnabled } from "@/lib/coverage/load";
import type { db as DbClient } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { notify, resolveManagerRecipientIds } from "@/lib/notifications/bus";
import { logOrgAudit } from "@/lib/org-audit";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { isEmployedInRange, loadEmploymentPeriods } from "./employment";
import {
  balanceStart,
  buildPeriodBalances,
  type DateBounds,
  normPeriodBounds,
  sumNormDays,
} from "./norm-period";
import {
  loadEarnedOvertimeByDate,
  loadFlexNormSettings,
  loadNormDays,
} from "./norm-period-load";
import {
  type ClosingSummary,
  closingPeriodLabel,
  isPeriodClosingInterval,
  type PeriodClosingInterval,
  previousClosingPeriod,
  toClosingSummary,
} from "./period-closing";

type Db = typeof DbClient;
type TxOrDb = Pick<Db, "query">;

/** Org'ens interval — null når periodeafslutning er slået fra. */
export async function loadPeriodClosingInterval(
  db: TxOrDb,
  orgId: string,
): Promise<PeriodClosingInterval | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
    columns: { periodClosingInterval: true },
  });
  const v = org?.periodClosingInterval;
  return isPeriodClosingInterval(v) ? v : null;
}

/**
 * Opgørelse pr. bruger for perioden: registreret, brutto-/nettonorm, flex,
 * fravær — og den løbende flexsaldo i normperioden pr. periodens slut.
 */
export async function computeClosingSummaries(
  db: Db,
  params: { orgId: string; userIds: readonly string[]; bounds: DateBounds },
): Promise<Map<string, ClosingSummary>> {
  const { orgId, bounds } = params;
  const out = new Map<string, ClosingSummary>();
  if (params.userIds.length === 0) return out;
  const settings = await loadFlexNormSettings(db, orgId);
  const balanceFrom = balanceStart(settings, bounds.end);
  const normPeriod = normPeriodBounds(
    settings.period,
    settings.yearStart,
    bounds.end,
  );
  const from = balanceFrom < bounds.start ? balanceFrom : bounds.start;
  const to = normPeriod.end > bounds.end ? normPeriod.end : bounds.end;
  const [days, earned] = await Promise.all([
    loadNormDays(db, {
      orgId,
      userIds: params.userIds,
      from,
      to,
      settings,
      today: bounds.end,
    }),
    loadEarnedOvertimeByDate(db, orgId, params.userIds, from, to),
  ]);
  const now = new Date();
  for (const [userId, list] of days) {
    const earnedByDate = earned.get(userId);
    const totals = sumNormDays(list, {
      from: bounds.start,
      to: bounds.end,
      earnedOvertimeByDate: earnedByDate,
    });
    const balances = buildPeriodBalances(
      list,
      settings,
      bounds.end,
      earnedByDate,
      { partialToday: false },
    );
    out.set(
      userId,
      toClosingSummary(
        totals,
        balances.length > 0 ? balances[balances.length - 1].balance : null,
        now,
      ),
    );
  }
  return out;
}

/** Medarbejdere med ansættelse i perioden (også fratrådte undervejs). */
export async function closingEmployees(
  db: Db,
  orgId: string,
  bounds: DateBounds,
): Promise<string[]> {
  const profiles = await db.query.employeeProfiles.findMany({
    where: eq(schema.employeeProfiles.organizationId, orgId),
    columns: { userId: true, isActive: true, startDate: true, endDate: true },
  });
  if (profiles.length === 0) return [];
  const periods = await loadEmploymentPeriods(
    db,
    orgId,
    profiles.map((p) => p.userId),
  );
  return profiles
    .filter((p) => {
      const list = periods.get(p.userId) ?? [];
      if (list.length > 0)
        return isEmployedInRange(list, bounds.start, bounds.end);
      return (
        p.isActive &&
        (p.startDate == null || p.startDate <= bounds.end) &&
        (p.endDate == null || p.endDate >= bounds.start)
      );
    })
    .map((p) => p.userId);
}

/**
 * Dan opgørelser for perioden (idempotent: eksisterende rækker røres ikke).
 * Returnerer de nye rækkers bruger-id'er. Lederne får én samlet besked.
 */
export async function generatePeriodClosings(
  db: Db,
  params: {
    orgId: string;
    interval: PeriodClosingInterval;
    bounds: DateBounds;
    /** Kun disse (inden for kalderens scope); udeladt = alle ansatte */
    userIds?: readonly string[];
    /** Aktøren (leder); udeladt = systemet (cron) */
    actorId?: string;
  },
): Promise<string[]> {
  const { orgId, interval, bounds } = params;
  const eligible = await closingEmployees(db, orgId, bounds);
  const wanted = params.userIds
    ? eligible.filter((id) => params.userIds?.includes(id))
    : eligible;
  if (wanted.length === 0) return [];

  // Enhver eksisterende opgørelse der overlapper perioden (også af en anden
  // type, hvis org'en har skiftet interval) — så låse aldrig overlapper
  const existing = await db.query.periodClosings.findMany({
    where: and(
      eq(schema.periodClosings.organizationId, orgId),
      lte(schema.periodClosings.periodStart, bounds.end),
      gte(schema.periodClosings.periodEnd, bounds.start),
      inArray(schema.periodClosings.userId, wanted),
    ),
    columns: { userId: true },
  });
  const have = new Set(existing.map((e) => e.userId));
  const missing = wanted.filter((id) => !have.has(id));
  if (missing.length === 0) return [];

  const summaries = await computeClosingSummaries(db, {
    orgId,
    userIds: missing,
    bounds,
  });
  const created = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.periodClosings)
      .values(
        missing.map((userId) => ({
          organizationId: orgId,
          userId,
          periodType: interval,
          periodStart: bounds.start,
          periodEnd: bounds.end,
          status: "open",
          summary: summaries.get(userId) ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ userId: schema.periodClosings.userId });
    for (const r of rows) {
      await logOrgAudit(
        tx,
        orgId,
        params.actorId ?? r.userId,
        "period_closing_generated",
        {
          targetUserId: r.userId,
          metadata: {
            periodStart: bounds.start,
            periodEnd: bounds.end,
            periodType: interval,
            source: params.actorId ? "manager" : "system",
          },
        },
      );
    }
    return rows.map((r) => r.userId);
  });

  await notifyManagersOfClosings(db, {
    orgId,
    userIds: created,
    periodLabel: closingPeriodLabel(interval, bounds),
    excludeUserId: params.actorId,
  });
  return created;
}

/** Én besked pr. leder med antallet af opgørelser der venter. */
async function notifyManagersOfClosings(
  db: Db,
  params: {
    orgId: string;
    userIds: readonly string[];
    periodLabel: string;
    excludeUserId?: string;
  },
): Promise<void> {
  if (params.userIds.length === 0) return;
  const counts = new Map<string, number>();
  for (const userId of params.userIds) {
    const managers = await resolveManagerRecipientIds(db, {
      orgId: params.orgId,
      employeeUserId: userId,
      excludeUserId: userId,
    });
    for (const m of managers) {
      if (m === params.excludeUserId) continue;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  }
  let first = true;
  for (const [managerId, count] of counts) {
    void notify({
      orgId: params.orgId,
      event: "period.closing_ready",
      payload: { periodLabel: params.periodLabel, count },
      userIds: [managerId],
      // Teams-kanalen (org-niveau) får kun én besked
      skipOrgChannels: !first,
    });
    first = false;
  }
}

/**
 * Daglig cron: for hver enterprise-org med periodeafslutning dannes
 * opgørelserne for den senest afsluttede periode. Idempotent — kører den
 * igen (eller indhenter en mistet dag), dannes kun de manglende.
 */
export async function runPeriodClosingCron(
  db: Db,
  today: string = copenhagenToday(),
): Promise<{ orgs: number; created: number; failed: number }> {
  const orgs = await db.query.organizations.findMany({
    columns: { id: true, periodClosingInterval: true },
  });
  let processed = 0;
  let created = 0;
  let failed = 0;
  for (const org of orgs) {
    const interval = org.periodClosingInterval;
    if (!isPeriodClosingInterval(interval)) continue;
    if (!(await isEnterpriseEnabled(db, org.id))) continue;
    processed++;
    try {
      const ids = await generatePeriodClosings(db, {
        orgId: org.id,
        interval,
        bounds: previousClosingPeriod(interval, today),
      });
      created += ids.length;
    } catch (error) {
      failed++;
      console.error(`[period-closing] org ${org.id} fejlede`, error);
    }
  }
  return { orgs: processed, created, failed };
}
