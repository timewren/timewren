// Lås fra periodeafslutning (#518) — let modul uden notifikations-/norm-
// afhængigheder, så edit-guarden kan importere det.

import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { db as DbClient } from "@/lib/db";
import { periodClosings } from "@/lib/db/schema";
import { addDaysToDateStr, toCopenhagenDateStr } from "@/lib/time/copenhagen";
import {
  closingLockedMessage,
  LOCKED_CLOSING_STATUSES,
  lockedDates,
} from "./period-closing";

type TxOrDb = Pick<typeof DbClient, "query">;

/**
 * Edit-guard-laget (#518): kaster FORBIDDEN hvis en af datoerne ligger i en
 * godkendt/kvitteret periode for brugeren. Gælder alle — også ledere og
 * administratorer; oplåsning sker eksplicit med en logget årsag.
 */
export async function assertClosingUnlocked(
  db: TxOrDb,
  orgId: string,
  userId: string,
  dates: readonly string[],
): Promise<void> {
  if (dates.length === 0) return;
  const sorted = [...dates].sort();
  const rows = await db.query.periodClosings.findMany({
    where: and(
      eq(periodClosings.organizationId, orgId),
      eq(periodClosings.userId, userId),
      inArray(periodClosings.status, [...LOCKED_CLOSING_STATUSES]),
      lte(periodClosings.periodStart, sorted[sorted.length - 1]),
      gte(periodClosings.periodEnd, sorted[0]),
    ),
    columns: { periodStart: true, periodEnd: true, status: true },
  });
  if (lockedDates(dates, rows).length > 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: closingLockedMessage() });
  }
}

/** Er (mindst én dag i) ugen låst af en periodeafslutning? */
export async function isWeekClosingLocked(
  db: TxOrDb,
  orgId: string,
  userId: string,
  weekStart: string,
): Promise<boolean> {
  try {
    await assertClosingUnlocked(
      db,
      orgId,
      userId,
      Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i)),
    );
    return false;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") return true;
    throw error;
  }
}

/** Dansk dato for en posts dato (ren dato-streng eller tidspunkt). */
function entryDateKey(d: Date | string): string | null {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : toCopenhagenDateStr(date);
}

/**
 * Samme lås for registreringsveje uden edit-guarden (browser-extension og
 * desktop-sync), der ellers kun tjekker org-periodelåsen. No-op uden org.
 */
export async function assertEntriesOutsideClosedPeriods(
  db: TxOrDb,
  orgId: string | null | undefined,
  userId: string,
  dates: ReadonlyArray<Date | string | null | undefined>,
): Promise<void> {
  if (!orgId) return;
  const keys = dates
    .filter((d): d is Date | string => d != null)
    .map(entryDateKey)
    .filter((d): d is string => d !== null);
  await assertClosingUnlocked(db, orgId, userId, keys);
}
