import { and, eq, isNull, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { logOrgAudit } from "@/lib/org-audit";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { employmentIntervals, loadEmploymentPeriods } from "./employment";
import {
  accruedMonthsForIntervals,
  ensureVacationPeriod,
  getVacationOrgSettings,
  lockVacationBalance,
  monthEndDate,
  nextVacationPeriod,
  planRollover,
  postMonthlyAccruals,
  postVacationLedger,
  previousMonthKey,
  recomputeVacationBalance,
  type VacationOrgSettings,
  vacationPeriodFor,
} from "./vacation";

/**
 * Løbende optjening og årsskifte (#461, E3). Begge jobs er idempotente:
 * optjening via det unikke system-ref-indeks (cron/YYYY-MM), årsskiftet via
 * vacation_balances.rolled_over_at + rollover/period_start-referencer.
 */

type Db = PostgresJsDatabase<typeof schema>;

export type AccrualRunResult = {
  orgs: number;
  employees: number;
  posted: number;
  failed: number;
};

/** Org'er med løbende optjening. */
async function monthlyAccrualOrgs(db: Db): Promise<string[]> {
  const orgs = await db.query.organizations.findMany({
    where: eq(schema.organizations.vacationAccrualMode, "monthly"),
    columns: { id: true },
  });
  return orgs.map((o) => o.id);
}

/**
 * Postér optjening for måneden `month` ('YYYY-MM', default: forrige måned)
 * for alle aktive medarbejdere i org'er med monthly-mode. Flat 2,08 dage
 * pr. medarbejder, kun hvis vedkommende var ansat hele måneden.
 */
export async function runMonthlyVacationAccrual(
  db: Db,
  options: { month?: string; today?: string } = {},
): Promise<AccrualRunResult> {
  const today = options.today ?? copenhagenToday();
  const month = options.month ?? previousMonthKey(today);
  const monthEnd = monthEndDate(month);
  const result: AccrualRunResult = {
    orgs: 0,
    employees: 0,
    posted: 0,
    failed: 0,
  };

  for (const orgId of await monthlyAccrualOrgs(db)) {
    result.orgs++;
    const settings = await getVacationOrgSettings(db, orgId);
    const profiles = await db.query.employeeProfiles.findMany({
      where: and(
        eq(schema.employeeProfiles.organizationId, orgId),
        eq(schema.employeeProfiles.isActive, true),
      ),
      columns: { userId: true, startDate: true, endDate: true },
    });
    const period = vacationPeriodFor(monthEnd, settings.yearStartMonth);
    // Ansættelseshistorik (#465) i ét batch-opslag pr. org
    const periodsByUser = await loadEmploymentPeriods(
      db,
      orgId,
      profiles.map((p) => p.userId),
    );

    for (const profile of profiles) {
      result.employees++;
      // Kun hele ansættelsesmåneder tæller (samme regel som catch-up), og
      // aldrig måneder før org'en skiftede til monthly (#532)
      const eligible = accruedMonthsForIntervals(
        period,
        today,
        employmentIntervals(periodsByUser.get(profile.userId) ?? [], profile),
        settings.settingsChangedAt,
      ).includes(month);
      if (!eligible) continue;
      try {
        await db.transaction(async (tx) => {
          // Sørger for perioden — og catch-up af tidligere måneder ved åbning
          await ensureVacationPeriod(
            tx,
            profile.userId,
            orgId,
            monthEnd,
            settings,
          );
          const inserted = await postMonthlyAccruals(tx, {
            userId: profile.userId,
            orgId,
            period,
            months: [month],
          });
          if (inserted > 0) {
            await recomputeVacationBalance(
              tx,
              profile.userId,
              orgId,
              period.start,
            );
            result.posted += inserted;
          }
        });
      } catch (err) {
        result.failed++;
        console.error(
          `[vacation-accrual] ${orgId}/${profile.userId} ${month}:`,
          err,
        );
      }
    }
  }
  return result;
}

export type RolloverRunResult = {
  candidates: number;
  rolledOver: number;
  skipped: number;
  failed: number;
  /** Udløbne perioder fra en tidligere ferieår-indstilling — rulles aldrig */
  legacy: number;
};

/**
 * Årsskifte for én saldo-periode: overfør min(rest, loft) til det nye
 * ferieår som 'carried_over' (negativ i det gamle, positiv i det nye), resten
 * som 'forfeited' eller 'paid_out'. Feriefridage (extra) overføres ikke —
 * resten fortabes/udbetales. Markerer rækken med rolled_over_at og logger
 * i hændelsesloggen. Idempotent via rollover/period_start-referencer.
 */
export async function rolloverVacationPeriod(
  db: Db,
  params: {
    balance: typeof schema.vacationBalances.$inferSelect;
    settings: VacationOrgSettings;
    /** Aktør i hændelsesloggen — cron bruger medarbejderen selv (system) */
    actorId?: string;
    /** Dags dato (test-hook) — afgør hvilke måneder der er færdig-optjent */
    today?: string;
  },
): Promise<"rolled_over" | "skipped"> {
  const { balance, settings } = params;
  const orgId = balance.organizationId;
  const userId = balance.userId;
  const today = params.today ?? copenhagenToday();
  const oldPeriod = vacationPeriodFor(
    balance.periodStart,
    settings.yearStartMonth,
  );
  // Perioder fra en tidligere indstilling (fx kalenderår før skift til 1/9)
  // rulles ikke automatisk — de ville overlappe det nye ferieår.
  if (
    oldPeriod.start !== balance.periodStart ||
    oldPeriod.end !== balance.periodEnd
  ) {
    return "skipped";
  }
  const newPeriod = nextVacationPeriod(oldPeriod, settings.yearStartMonth);

  await db.transaction(async (tx) => {
    let locked = await lockVacationBalance(
      tx,
      userId,
      orgId,
      oldPeriod.start,
      settings,
    );
    if (locked.rolledOverAt) return;

    // Vagt: hvis måneds-cronen ikke har nået at postere alle optjente
    // måneder (fx august, når rollover kører 1/9 før accrual-jobbet),
    // catch-up'es de her — ellers strander dagene i det gamle ferieår.
    // Aldrig længere tilbage end org'ens skift til monthly (#532) — en
    // periode åbnet med 'opening' må ikke også få retroaktiv optjening.
    if (settings.accrualMode === "monthly") {
      const profile = await tx.query.employeeProfiles.findFirst({
        where: and(
          eq(schema.employeeProfiles.userId, userId),
          eq(schema.employeeProfiles.organizationId, orgId),
        ),
        columns: { startDate: true, endDate: true },
      });
      const months = accruedMonthsForIntervals(
        oldPeriod,
        today,
        employmentIntervals(
          (await loadEmploymentPeriods(tx, orgId, [userId])).get(userId) ?? [],
          profile,
        ),
        settings.settingsChangedAt,
      );
      const inserted = await postMonthlyAccruals(tx, {
        userId,
        orgId,
        period: oldPeriod,
        months,
      });
      if (inserted > 0) {
        locked = await recomputeVacationBalance(
          tx,
          userId,
          orgId,
          oldPeriod.start,
        );
      }
    }

    const plans = {
      vacation: planRollover(
        locked.remainingDays,
        settings.carryOverMaxDays,
        settings.payOutRemaining,
      ),
      extra: planRollover(
        locked.extraRemainingDays,
        0,
        settings.payOutRemaining,
      ),
    } as const;

    // Det nye ferieår skal findes (og være låst) før overførslen posteres
    await lockVacationBalance(tx, userId, orgId, newPeriod.start, settings);

    for (const pool of ["vacation", "extra"] as const) {
      const plan = plans[pool];
      if (plan.carry !== 0) {
        await postVacationLedger(tx, {
          userId,
          orgId,
          pool,
          entryType: "carried_over",
          days: -plan.carry,
          effectiveDate: oldPeriod.end,
          vacationYearStart: oldPeriod.start,
          refType: "rollover",
          refId: oldPeriod.start,
          note: `Overført til ${newPeriod.label}`,
          createdBy: params.actorId ?? null,
        });
        await postVacationLedger(tx, {
          userId,
          orgId,
          pool,
          entryType: "carried_over",
          days: plan.carry,
          effectiveDate: newPeriod.start,
          vacationYearStart: newPeriod.start,
          refType: "rollover",
          refId: oldPeriod.start,
          note: `Overført fra ${oldPeriod.label}`,
          createdBy: params.actorId ?? null,
        });
      }
      if (plan.forfeited > 0) {
        await postVacationLedger(tx, {
          userId,
          orgId,
          pool,
          entryType: "forfeited",
          days: plan.forfeited,
          effectiveDate: oldPeriod.end,
          vacationYearStart: oldPeriod.start,
          refType: "rollover",
          refId: oldPeriod.start,
          note: "Fortabt ved ferieårets udløb",
          createdBy: params.actorId ?? null,
        });
      }
      if (plan.paidOut > 0) {
        await postVacationLedger(tx, {
          userId,
          orgId,
          pool,
          entryType: "paid_out",
          days: plan.paidOut,
          effectiveDate: oldPeriod.end,
          vacationYearStart: oldPeriod.start,
          refType: "rollover",
          refId: oldPeriod.start,
          note: "Udbetalt ved ferieårets udløb",
          createdBy: params.actorId ?? null,
        });
      }
    }

    await recomputeVacationBalance(tx, userId, orgId, oldPeriod.start);
    await recomputeVacationBalance(tx, userId, orgId, newPeriod.start);
    await tx
      .update(schema.vacationBalances)
      .set({ rolledOverAt: new Date() })
      .where(eq(schema.vacationBalances.id, balance.id));

    await logOrgAudit(
      tx,
      orgId,
      params.actorId ?? userId,
      "vacation_year_rolled_over",
      {
        targetUserId: userId,
        metadata: {
          system: !params.actorId,
          fromPeriodStart: oldPeriod.start,
          toPeriodStart: newPeriod.start,
          vacation: plans.vacation,
          extra: plans.extra,
        },
      },
    );
  });
  return "rolled_over";
}

/**
 * Dagligt tjek: alle saldo-perioder der er udløbet (period_end < i dag) uden
 * rollover, i org'er med løbende optjening. Freelance-orgs (upfront) rulles
 * ikke — deres kalenderår-saldi forbliver uændrede (bagudkompatibilitet).
 */
export async function runVacationYearRollover(
  db: Db,
  options: { today?: string } = {},
): Promise<RolloverRunResult> {
  const today = options.today ?? copenhagenToday();
  const result: RolloverRunResult = {
    candidates: 0,
    rolledOver: 0,
    skipped: 0,
    failed: 0,
    legacy: 0,
  };
  for (const orgId of await monthlyAccrualOrgs(db)) {
    const settings = await getVacationOrgSettings(db, orgId);
    const expired = await db.query.vacationBalances.findMany({
      where: and(
        eq(schema.vacationBalances.organizationId, orgId),
        lt(schema.vacationBalances.periodEnd, today),
        isNull(schema.vacationBalances.rolledOverAt),
      ),
    });
    for (const balance of expired) {
      // Perioder fra en tidligere startmåned (fx kalenderår før skift til
      // 1/9) tælles ikke som kandidater — de ville overlappe det nye ferieår.
      const expected = vacationPeriodFor(
        balance.periodStart,
        settings.yearStartMonth,
      );
      if (
        expected.start !== balance.periodStart ||
        expected.end !== balance.periodEnd
      ) {
        result.legacy++;
        continue;
      }
      result.candidates++;
      try {
        const outcome = await rolloverVacationPeriod(db, {
          balance,
          settings,
          today,
        });
        if (outcome === "rolled_over") result.rolledOver++;
        else result.skipped++;
      } catch (err) {
        result.failed++;
        console.error(
          `[vacation-year-rollover] ${orgId}/${balance.userId} ${balance.periodStart}:`,
          err,
        );
      }
    }
  }
  return result;
}
