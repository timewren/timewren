/**
 * Set a customer's plan tier + seat allowance.
 *
 * Two ways to run it:
 *
 * 1. One-off from a shell (e.g. to unblock a customer right now):
 *      npx tsx scripts/set-org-plan.ts <ownerEmail> <tier> [maxSeats]
 *
 * 2. At release / deploy time, gated by env vars in migrate-safe.ts:
 *      UNBLOCK_PLAN_EMAIL=bruger@example.dk UNBLOCK_PLAN_TIER=team UNBLOCK_PLAN_SEATS=4
 *    Runs on the next deploy (MIGRATE_ON_START=1) and is idempotent, so the
 *    env vars can be left in place or removed afterwards.
 *
 * Use this to unblock a team/business customer who needs seats *now* — e.g. a
 * customer who signed up before the self-serve team flow existed, so their
 * trial subscription is still planTier=solo / maxSeats=1 and the invite button
 * is disabled.
 *
 * Looks the customer up by owner email, updates their subscription's
 * planTier/maxSeats/seatCount, and backfills organizationId on the subscription
 * if they own exactly one org so the seat check resolves via either path.
 *
 * Examples:
 *   npx tsx scripts/set-org-plan.ts bruger@example.dk team        # team, 10 seats
 *   npx tsx scripts/set-org-plan.ts bruger@example.dk team 4       # team, 4 seats
 *   npx tsx scripts/set-org-plan.ts bruger@example.dk business 25  # business, 25 seats
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/freelance_crm";

export const DEFAULT_MAX_SEATS: Record<string, number> = {
  solo: 1,
  team: 10,
  business: 50,
};

export interface SetOrgPlanResult {
  updated: boolean;
  reason?: "user_not_found" | "subscription_not_found";
  previous?: { planTier: string; maxSeats: number };
  next?: { planTier: string; maxSeats: number };
  backfilledOrgId?: string | null;
}

/**
 * Idempotent. Safe to run multiple times — an update to the same values is a
 * no-op. Does not throw on "not found" so it can run unconditionally at deploy
 * time without failing the migration; the caller decides how to log.
 */
export async function setOrgPlan(
  db: ReturnType<typeof drizzle>,
  opts: { email: string; tier: string; maxSeats?: number },
): Promise<SetOrgPlanResult> {
  const tier = opts.tier;
  if (!DEFAULT_MAX_SEATS[tier]) {
    throw new Error(`Invalid tier "${tier}" — expected solo | team | business`);
  }
  const maxSeats = opts.maxSeats ?? DEFAULT_MAX_SEATS[tier];
  if (!Number.isFinite(maxSeats) || maxSeats < 1) {
    throw new Error(`Invalid maxSeats: ${opts.maxSeats}`);
  }

  const userRows = (await db.execute(
    sql`SELECT id, name, email FROM "user" WHERE lower(email) = lower(${opts.email}) LIMIT 1`,
  )) as unknown as Array<{ id: string; name: string; email: string }>;

  const user = userRows[0];
  if (!user) return { updated: false, reason: "user_not_found" };

  // Find the org this user owns (to backfill organizationId + report it)
  const ownedOrgs = (await db.execute(sql`
    SELECT o.id, o.name
    FROM organizations o
    JOIN members m ON m.organization_id = o.id
    WHERE m.user_id = ${user.id} AND m.role = 'owner'
  `)) as unknown as Array<{ id: string; name: string }>;

  const subRows = (await db.execute(sql`
    SELECT id, plan_tier, max_seats, organization_id
    FROM subscriptions
    WHERE user_id = ${user.id}
    ORDER BY (organization_id IS NOT NULL) DESC, created_at DESC
    LIMIT 1
  `)) as unknown as Array<{
    id: string;
    plan_tier: string;
    max_seats: number;
    organization_id: string | null;
  }>;

  const sub = subRows[0];
  if (!sub) return { updated: false, reason: "subscription_not_found" };

  const backfillOrgId =
    !sub.organization_id && ownedOrgs.length === 1 ? ownedOrgs[0].id : null;

  await db.execute(sql`
    UPDATE subscriptions
    SET plan_tier = ${tier},
        max_seats = ${maxSeats},
        seat_count = ${maxSeats},
        ${backfillOrgId ? sql`organization_id = ${backfillOrgId},` : sql``}
        updated_at = now()
    WHERE id = ${sub.id}
  `);

  return {
    updated: true,
    previous: { planTier: sub.plan_tier, maxSeats: sub.max_seats },
    next: { planTier: tier, maxSeats },
    backfilledOrgId: backfillOrgId,
  };
}

async function main() {
  const [email, tier, maxSeatsArg] = process.argv.slice(2);

  if (!email || !tier || !DEFAULT_MAX_SEATS[tier]) {
    console.error(
      "Usage: npx tsx scripts/set-org-plan.ts <ownerEmail> <solo|team|business> [maxSeats]",
    );
    process.exit(1);
  }

  const maxSeats = maxSeatsArg ? Number.parseInt(maxSeatsArg, 10) : undefined;

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    const result = await setOrgPlan(db, { email, tier, maxSeats });

    if (!result.updated) {
      if (result.reason === "user_not_found") {
        console.error(`❌ No user found with email ${email}`);
      } else {
        console.error(
          `❌ No subscription found for ${email}. They must start onboarding first.`,
        );
      }
      process.exit(1);
    }

    console.log(`✅ Updated subscription for ${email}:`);
    console.log(
      `   ${result.previous?.planTier}/${result.previous?.maxSeats} → ${result.next?.planTier}/${result.next?.maxSeats}`,
    );
    if (result.backfilledOrgId) {
      console.log(`   Backfilled organizationId → ${result.backfilledOrgId}`);
    }
    console.log(
      "   They can now invite team members up to the new seat limit.",
    );
  } catch (error) {
    console.error("❌ Failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("set-org-plan.ts")
) {
  main();
}
