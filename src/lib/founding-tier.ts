import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { FOUNDING_MEMBER } from "./config";
import type * as schema from "./db/schema";

type DB = PostgresJsDatabase<typeof schema>;

/**
 * Count how many founding member subscriptions exist.
 */
export async function getFoundingMemberCount(db: DB): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int as count
    FROM subscriptions
    WHERE founding_tier = 'founding_member'
  `);
  return (result[0] as { count: number })?.count || 0;
}

/**
 * Get founding member availability info (for admin).
 */
export async function getFoundingAvailability(db: DB) {
  const taken = await getFoundingMemberCount(db);
  const remaining = Math.max(0, FOUNDING_MEMBER.maxSlots - taken);
  return {
    label: FOUNDING_MEMBER.label,
    maxSlots: FOUNDING_MEMBER.maxSlots,
    taken,
    remaining,
    discountPercent: FOUNDING_MEMBER.discountPercent,
    freeMonths: FOUNDING_MEMBER.freeMonths,
    discountForever: FOUNDING_MEMBER.discountForever,
    isFull: remaining === 0,
  };
}
