import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { capacityLimitsApply } from "./billing/capacity-gate";
import { isFreeSubscription, planLimits } from "./billing/plan-limits";
import { db } from "./db";
import * as schema from "./db/schema";

// Prefer a live (active/trialing), Alunta-linked, newest row — so a stray
// canceled/free row never wins over the org's paid sub and caps it at Gratis.
const SUB_PREFERENCE = [
  desc(
    sql`case when ${schema.subscriptions.status} in ('active','trialing') then 1 else 0 end`,
  ),
  desc(
    sql`case when ${schema.subscriptions.aluntaSubscriptionId} is not null or ${schema.subscriptions.storeProvider} is not null then 1 else 0 end`,
  ),
  desc(schema.subscriptions.createdAt),
];

/**
 * Resolve an org's seat allowance: prefer the org subscription, fall back to
 * the owner's personal subscription (trial subs may still be user-scoped).
 * Shared by the invitation + accept seat checks and domain auto-join.
 * Gratis-tier always gets FREE_MAX_SEATS regardless of the stored maxSeats:
 * rows downgraded before 1/10-2026 still store 1, and canceled payers keep
 * their old (higher) paid count.
 */
export async function resolveOrgSeatPolicy(
  orgId: string,
): Promise<{ maxSeats: number; isFree: boolean }> {
  // Selvhost uden billing: ingen pladsgrænse
  if (!capacityLimitsApply()) {
    return { maxSeats: Number.MAX_SAFE_INTEGER, isFree: false };
  }
  let sub = await db.query.subscriptions.findFirst({
    where: eq(schema.subscriptions.organizationId, orgId),
    columns: { maxSeats: true, planTier: true, status: true },
    orderBy: SUB_PREFERENCE,
  });
  if (!sub) {
    const owner = await db.query.members.findFirst({
      where: and(
        eq(schema.members.organizationId, orgId),
        eq(schema.members.role, "owner"),
      ),
      columns: { userId: true },
    });
    if (owner) {
      // Ejerens personlige/legacy række, aldrig en række fra en ANDEN org —
      // ellers kunne ejerens tidligere (forladte) organisation styre denne
      // orgs pladsloft.
      sub = await db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.userId, owner.userId),
          or(
            isNull(schema.subscriptions.organizationId),
            eq(schema.subscriptions.organizationId, orgId),
          ),
        ),
        columns: { maxSeats: true, planTier: true, status: true },
        orderBy: SUB_PREFERENCE,
      });
    }
  }
  if (sub && isFreeSubscription(sub)) {
    return { maxSeats: planLimits("free").maxSeats, isFree: true };
  }
  return { maxSeats: sub?.maxSeats ?? 1, isFree: false };
}

/** Seat allowance only — see resolveOrgSeatPolicy. */
export async function resolveOrgMaxSeats(orgId: string): Promise<number> {
  return (await resolveOrgSeatPolicy(orgId)).maxSeats;
}

/** Count current members of an org. */
export async function countOrgMembers(orgId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.members)
    .where(eq(schema.members.organizationId, orgId));
  return rows[0]?.count ?? 0;
}
