/**
 * INTEGRATION: `resolveActiveSubscription(..., { stripe: true })` (kun
 * timewrenBilling) på en organisation med en ældre Stripe-række og en nyere
 * Gratis-række. Stripe-rækken styrer, også mens den er past_due, så ejeren kan
 * rette kortet i portalen i stedet for at få tilbudt endnu et checkout. Uden
 * tilvalget (TimeTrack, hvor rækker kan have historiske Stripe-id'er fra før
 * Alunta) er rækkefølgen som før.
 *
 * Kører kun med TEST_DATABASE_URL sat (se account-deletion.test.ts).
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

import * as schema from "@/lib/db/schema";
import { subscriptions } from "@/lib/db/schema";
import { resolveActiveSubscription } from "../subscription";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORG = "org-stripe-og-gratis";
const OWNER = "bruger-ejer";

describe.skipIf(!TEST_DATABASE_URL)(
  "styrende abonnement med Stripe-række (integration)",
  () => {
    const scratch = `subscription_stripe_governing_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });
    let stripeRowId = "";
    let freeRowId = "";

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      await admin.unsafe(
        `CREATE TABLE ${scratch}."subscriptions" (LIKE public."subscriptions" INCLUDING ALL)`,
      );
      const base = {
        userId: OWNER,
        organizationId: ORG,
        billingCycle: "monthly",
        trialEndsAt: new Date("2026-01-01T00:00:00Z"),
      };
      const [stripeRow] = await db
        .insert(subscriptions)
        .values({
          ...base,
          status: "active",
          planTier: "team",
          stripeCustomerId: "cus_tw",
          stripeSubscriptionId: "sub_tw",
          createdAt: new Date("2026-10-01T00:00:00Z"),
        })
        .returning({ id: subscriptions.id });
      stripeRowId = stripeRow.id;
      const [freeRow] = await db
        .insert(subscriptions)
        .values({
          ...base,
          // Et andet medlems onboarding (user_id er unik).
          userId: "bruger-medlem",
          status: "active",
          planTier: "free",
          createdAt: new Date("2026-11-01T00:00:00Z"),
        })
        .returning({ id: subscriptions.id });
      freeRowId = freeRow.id;
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("aktiv Stripe-række vinder over en nyere Gratis-række", async () => {
      const sub = await resolveActiveSubscription(db, ORG, OWNER, {
        stripe: true,
      });
      expect(sub?.id).toBe(stripeRowId);
    });

    it("past_due Stripe-række styrer stadig; uden tilvalg som før", async () => {
      await db
        .update(subscriptions)
        .set({ status: "past_due" })
        .where(eq(subscriptions.id, stripeRowId));
      const tw = await resolveActiveSubscription(db, ORG, OWNER, {
        stripe: true,
      });
      expect(tw?.id).toBe(stripeRowId);
      expect(tw?.status).toBe("past_due");

      const tt = await resolveActiveSubscription(db, ORG, OWNER);
      expect(tt?.id).toBe(freeRowId);
    });
  },
);
