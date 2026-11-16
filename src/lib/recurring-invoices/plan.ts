import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { isFreeSubscription } from "@/lib/billing/plan-limits";
import type { db as DbHandle } from "@/lib/db";
import { subscriptions, users } from "@/lib/db/schema";

type Db = typeof DbHandle;

export interface PlanSubscriptionLike {
  status: string;
  planTier: string | null;
  trialEndsAt: Date;
  pastDueSince: Date | null;
}

const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Må ejeren af en gentagen faktura få oprettet kladder? Samme regel som
 * `moduleWriteProcedure("invoices")`: et brugbart abonnement (aktivt, prøve
 * der ikke er udløbet, Gratis, eller past_due inden for 7 dages frist).
 * Fakturering er ikke låst bag en plan (#1012): Gratis og Privat må også.
 * Admins har ingen plan-grænser.
 */
export function subscriptionAllowsRecurringInvoices(
  sub: PlanSubscriptionLike | null | undefined,
  opts: { isAdmin?: boolean; now?: Date } = {},
): boolean {
  if (opts.isAdmin || !isBillingEnabled()) return true;
  if (!sub) return false;
  if (isFreeSubscription(sub)) return true;
  const now = (opts.now ?? new Date()).getTime();
  return (
    sub.status === "active" ||
    (sub.status === "trialing" && sub.trialEndsAt.getTime() > now) ||
    (sub.status === "past_due" &&
      (!sub.pastDueSince ||
        now - sub.pastDueSince.getTime() <= PAST_DUE_GRACE_MS))
  );
}

/**
 * Cron-siden af plan-gaten: slå ejerens abonnement op med samme præference
 * som tRPC-guarden (aktiv/prøve først, så Alunta-koblet, så nyeste) — org
 * først, ellers brugerens eget.
 */
export async function ownerAllowsRecurringInvoices(
  db: Db,
  userId: string,
  orgId: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  });
  if (user?.role === "admin" || !isBillingEnabled()) return true;

  const orderBy = [
    desc(
      sql`case when ${subscriptions.status} in ('active','trialing') then 1 else 0 end`,
    ),
    desc(
      sql`case when ${subscriptions.aluntaSubscriptionId} is not null or ${subscriptions.storeProvider} is not null then 1 else 0 end`,
    ),
    desc(subscriptions.createdAt),
  ];
  let sub = orgId
    ? await db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, orgId),
        orderBy,
      })
    : undefined;
  if (!sub) {
    // Ejerens personlige/legacy række, aldrig en række fra en ANDEN org —
    // ellers kunne en tidligere (forladt) organisations plan styre om denne
    // ejers gentagne fakturaer/klippekort må oprettes.
    sub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        orgId
          ? or(
              isNull(subscriptions.organizationId),
              eq(subscriptions.organizationId, orgId),
            )
          : isNull(subscriptions.organizationId),
      ),
      orderBy,
    });
  }
  return subscriptionAllowsRecurringInvoices(sub ?? null, { now });
}
