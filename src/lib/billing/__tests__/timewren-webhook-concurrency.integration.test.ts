import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleTimewrenStripeEvent,
  timewrenWebhookDatabase,
} from "@/lib/billing/timewren-stripe-webhook";
import * as schema from "@/lib/db/schema";
import { organizations, subscriptions } from "@/lib/db/schema";
import { testPostgres } from "@/test/test-db";

afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "TimeWren webhook concurrency",
  () => {
    it("rejects a stale Stripe read without holding a database connection during the read", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
      vi.stubEnv("MULTIBRAND_ENABLED", "1");
      vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
      const orgId = randomUUID();
      const scratch = `tw_sync_${orgId.replaceAll("-", "")}`;
      const client = testPostgres({
        max: 1,
        connection: { search_path: scratch },
      });
      const db = drizzle(client, { schema });
      const readEntered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let first: Promise<unknown> | undefined;

      const stripeSubscription = (status: Stripe.Subscription.Status) =>
        ({
          id: "sub_tw_sync",
          status,
          metadata: {
            brand: "timewren",
            organizationId: orgId,
            userId: "user_tw_sync",
            planTier: "solo",
          },
        }) as unknown as Stripe.Subscription;
      const event = {
        id: "evt_tw_sync",
        type: "customer.subscription.updated",
        data: { object: stripeSubscription("active") },
      } as Stripe.Event;

      try {
        await client.unsafe(`CREATE SCHEMA ${scratch}`);
        for (const table of [organizations, subscriptions]) {
          await db.execute(
            sql`create table ${table} (like public.${table} including all)`,
          );
        }
        await db.insert(organizations).values({
          id: orgId,
          name: "TimeWren test",
          slug: orgId,
          createdAt: new Date(),
          brand: "timewren",
        });
        const deps = {
          ...timewrenWebhookDatabase(db),
          retrieveInvoice: vi.fn(),
          sendCancellation: vi.fn(),
          sendPaymentFailed: vi.fn(),
          appUrl: "https://timewren.com",
          formatAmount: String,
        };

        const delayed = handleTimewrenStripeEvent(event, {
          ...deps,
          retrieveSubscription: async () => {
            readEntered.resolve();
            await release.promise;
            return stripeSubscription("active");
          },
        });
        first = expect(delayed).rejects.toThrow("changed during Stripe read");
        await readEntered.promise;
        await expect(
          handleTimewrenStripeEvent(
            { ...event, id: "evt_tw_sync_newer" },
            {
              ...deps,
              retrieveSubscription: async () => stripeSubscription("past_due"),
            },
          ),
        ).resolves.toMatchObject({ outcome: "applied" });
        release.resolve();
        await first;
        await expect(
          db.query.subscriptions.findFirst({
            where: eq(subscriptions.organizationId, orgId),
            columns: { status: true },
          }),
        ).resolves.toEqual({ status: "past_due" });
      } finally {
        release.resolve();
        await first?.catch(() => undefined);
        try {
          await client.unsafe(`drop schema if exists ${scratch} cascade`);
        } finally {
          await client.end();
        }
      }
    });
  },
);
