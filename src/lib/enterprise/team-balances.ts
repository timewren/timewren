import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { getEarnedOvertimeByUser } from "./flex";
import { type BalanceProjection, projectVacationBalance } from "./vacation";

/**
 * Saldi pr. medarbejder til leder-godkendelsesbilledet (kunde C-ønske: "kan
 * lederne se ferie, flex osv. i godkendelsesbilledet?").
 *
 * Én batch for hele holdet — ingen N+1. Beregningerne spejler de enkelte
 * sider: ferie = ledger-projektion for den aktuelle ferieperiode (som
 * absence.getVacationBalance), flex = SUM(flex_entries.delta) t.o.m. asOf
 * minus optjent overtid (som flex.getBalance), afspadsering =
 * SUM(overtime_ledger.hours) (som overtime.getOvertimeOverview).
 */

export type PoolBalance = {
  earned: number;
  used: number;
  remaining: number;
};

export type MemberBalances = {
  /** null når medarbejderen ingen ledger-poster har i perioden */
  vacation: PoolBalance | null;
  /** Feriefridage (extra-puljen) — null uden ledger-data */
  extraDays: PoolBalance | null;
  /** Flex-saldo i timer pr. asOf (positiv = til gode) */
  flexHours: number;
  /** Afspadseringssaldo i timer; null når overtid ikke er relevant for org'en */
  overtimeHours: number | null;
};

export type VacationLedgerSumRow = {
  userId: string;
  pool: string | null;
  entryType: string;
  days: number | string;
  atPeriodStart?: boolean | null;
};

export type AggregateInput = {
  userIds: string[];
  vacationLedgerRows: VacationLedgerSumRow[];
  /** SUM(delta) pr. bruger t.o.m. asOf */
  flexDeltaByUser: Map<string, number>;
  /** Optjent overtid pr. bruger t.o.m. asOf — trækkes fra flex */
  earnedOvertimeByUser: Map<string, number>;
  /** Samlet overtidssaldo (alle typer) pr. bruger */
  overtimeByUser: Map<string, number>;
  /** Org'en bruger overtid (ugetærskel sat) eller nogen har saldo */
  overtimeEnabled: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function toPool(p: BalanceProjection["vacation"]): PoolBalance {
  return {
    earned: round2(p.total),
    used: round2(p.used),
    remaining: round2(p.remaining),
  };
}

/** Ren aggregering — testes uden DB. */
export function aggregateTeamBalances(
  input: AggregateInput,
): Record<string, MemberBalances> {
  const ledgerByUser = new Map<string, VacationLedgerSumRow[]>();
  for (const row of input.vacationLedgerRows) {
    const list = ledgerByUser.get(row.userId) ?? [];
    list.push(row);
    ledgerByUser.set(row.userId, list);
  }

  const out: Record<string, MemberBalances> = {};
  for (const userId of input.userIds) {
    const rows = ledgerByUser.get(userId);
    const projection =
      rows && rows.length > 0 ? projectVacationBalance(rows) : null;
    const flex = round2(
      (input.flexDeltaByUser.get(userId) ?? 0) -
        (input.earnedOvertimeByUser.get(userId) ?? 0),
    );
    const overtime = input.overtimeByUser.get(userId) ?? 0;
    out[userId] = {
      vacation: projection ? toPool(projection.vacation) : null,
      extraDays: projection ? toPool(projection.extra) : null,
      flexHours: flex,
      overtimeHours:
        input.overtimeEnabled || overtime !== 0 ? round2(overtime) : null,
    };
  }
  return out;
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Henter grundlaget i fire parallelle, grupperede queries og aggregerer.
 * `periodStart` = ferieårets start (vacationPeriodFor), `asOf` = sidste dato
 * der medregnes i flex (typisk min(ugens søndag, i dag)).
 */
export async function loadTeamBalances(
  db: Db,
  params: {
    orgId: string;
    userIds: string[];
    periodStart: string;
    asOf: string;
    overtimeEnabled: boolean;
  },
): Promise<Record<string, MemberBalances>> {
  const { orgId, userIds, periodStart, asOf } = params;
  if (userIds.length === 0) return {};

  const vl = schema.vacationLedger;
  const fe = schema.flexEntries;
  const ol = schema.overtimeLedger;

  const [ledgerRows, flexRows, earnedOvertimeByUser, overtimeRows] =
    await Promise.all([
      db
        .select({
          // user_id er nullable (SET NULL ved sletning, #499) men filtreres på userIds
          userId: sql<string>`${vl.userId}`,
          pool: vl.pool,
          entryType: vl.entryType,
          days: sql<string>`COALESCE(SUM(${vl.days}), 0)`,
          atPeriodStart: sql<boolean>`${vl.effectiveDate} = ${vl.vacationYearStart}`,
        })
        .from(vl)
        .where(
          and(
            eq(vl.organizationId, orgId),
            inArray(vl.userId, userIds),
            eq(vl.vacationYearStart, periodStart),
          ),
        )
        .groupBy(
          vl.userId,
          vl.pool,
          vl.entryType,
          sql`${vl.effectiveDate} = ${vl.vacationYearStart}`,
        ),
      db
        .select({
          userId: fe.userId,
          total: sql<string>`COALESCE(SUM(${fe.delta}::numeric), 0)`,
        })
        .from(fe)
        .where(
          and(
            eq(fe.organizationId, orgId),
            inArray(fe.userId, userIds),
            lte(fe.date, asOf),
          ),
        )
        .groupBy(fe.userId),
      getEarnedOvertimeByUser(db, orgId, userIds, { end: asOf }),
      db
        .select({
          userId: sql<string>`${ol.userId}`,
          total: sql<string>`COALESCE(SUM(${ol.hours}::numeric), 0)`,
        })
        .from(ol)
        .where(and(eq(ol.organizationId, orgId), inArray(ol.userId, userIds)))
        .groupBy(ol.userId),
    ]);

  return aggregateTeamBalances({
    userIds,
    vacationLedgerRows: ledgerRows,
    flexDeltaByUser: new Map(flexRows.map((r) => [r.userId, Number(r.total)])),
    earnedOvertimeByUser,
    overtimeByUser: new Map(
      overtimeRows.map((r) => [r.userId, Number(r.total)]),
    ),
    overtimeEnabled: params.overtimeEnabled,
  });
}
