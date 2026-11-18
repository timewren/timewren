/**
 * INTEGRATION: trial-expire og trial-reminder med TimeWren Cloud-prøver
 * (Stripe). Stripe afslutter selv prøven og opkræver kortet, så cronen må
 * hverken sætte rækken på Gratis lige efter prøvens slutning eller sende
 * "vælg en plan"-mailen. Med TimeWren-betalingen slået fra opfører cronerne
 * sig som før, også for rækker med et historisk Stripe-id. En kontrolrække
 * uden Stripe behandles i begge tilfælde, så testen beviseligt kan fejle, og
 * en TimeTrack-række med historisk Stripe-id behandles som før, også med
 * TimeWren-betalingen slået til.
 *
 * Kører kun med TEST_DATABASE_URL sat (se account-deletion.test.ts).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

const h = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const real = h.db as Record<string | symbol, unknown>;
        const value = real[prop];
        return typeof value === "function" ? value.bind(real) : value;
      },
    },
  ),
}));
vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging:
    (_name: string, handler: (req: Request) => Promise<unknown>) =>
    async (req: Request) =>
      handler(req),
}));
vi.mock("@/lib/email/billing", () => ({
  sendTrialEndingEmail: vi.fn(async () => {}),
}));

import { GET as trialExpireGET } from "@/app/api/cron/trial-expire/route";
import { GET as trialReminderGET } from "@/app/api/cron/trial-reminder/route";
import * as schema from "@/lib/db/schema";
import {
  emailDeliveryLogs,
  organizations,
  subscriptions,
  users,
} from "@/lib/db/schema";
import { sendTrialEndingEmail } from "@/lib/email/billing";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "MULTIBRAND_ENABLED",
  "TIMEWREN_APP_ENABLED",
] as const;
const cronRequest = () => new Request("http://test/api/cron");

describe.skipIf(!TEST_DATABASE_URL)(
  "trial-croner og Stripe-prøver (integration)",
  () => {
    const scratch = `tw_stripe_trials_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });
    h.db = db;
    const saved: Record<string, string | undefined> = {};

    const sub = (userId: string) =>
      db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });

    function enableTimewrenStripe(on: boolean) {
      if (on) {
        process.env.STRIPE_SECRET_KEY = "stripe-test-placeholder";
        process.env.MULTIBRAND_ENABLED = "1";
        process.env.TIMEWREN_APP_ENABLED = "1";
      } else {
        // Stadig betaling (TimeTrack Cloud), men ingen TimeWren-Stripe.
        process.env.STRIPE_SECRET_KEY = "stripe-test-placeholder";
        delete process.env.MULTIBRAND_ENABLED;
        delete process.env.TIMEWREN_APP_ENABLED;
      }
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of [
        "subscriptions",
        "organizations",
        "members",
        "user",
        "email_delivery_logs",
        "sent_emails",
      ]) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      await db.insert(organizations).values([
        { id: "org-tw", name: "TW", slug: `tw-${scratch}`, brand: "timewren" },
        { id: "org-tt", name: "TT", slug: `tt-${scratch}`, brand: "timetrack" },
      ]);
    });

    beforeEach(async () => {
      for (const k of ENV_KEYS) saved[k] = process.env[k];
      await db.delete(subscriptions);
      vi.mocked(sendTrialEndingEmail).mockClear();
    });

    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    async function seedExpired() {
      const yesterday = new Date(Date.now() - DAY);
      await db.insert(subscriptions).values([
        {
          userId: "te-uden-stripe",
          billingCycle: "monthly",
          status: "trialing",
          planTier: "solo",
          trialEndsAt: yesterday,
        },
        {
          userId: "te-stripe",
          organizationId: "org-tw",
          billingCycle: "monthly",
          status: "trialing",
          planTier: "team",
          stripeSubscriptionId: "sub_tw_trial",
          trialEndsAt: yesterday,
        },
        {
          userId: "te-tt-historisk-stripe",
          organizationId: "org-tt",
          billingCycle: "monthly",
          status: "trialing",
          planTier: "solo",
          stripeSubscriptionId: "sub_tt_legacy",
          trialEndsAt: yesterday,
        },
      ]);
    }

    it("trial-expire: Stripe-prøven får fristen, når TimeWren-betaling er slået til", async () => {
      enableTimewrenStripe(true);
      await seedExpired();
      await trialExpireGET(cronRequest());
      expect((await sub("te-uden-stripe"))?.status).toBe("free");
      expect(await sub("te-stripe")).toMatchObject({
        status: "trialing",
        planTier: "team",
      });
      // TimeTrack med historisk Stripe-id: ingen ekstra frist.
      expect((await sub("te-tt-historisk-stripe"))?.status).toBe("free");
    });

    it("trial-expire: uden TimeWren-betaling som før, også med Stripe-id", async () => {
      enableTimewrenStripe(false);
      await seedExpired();
      await trialExpireGET(cronRequest());
      expect((await sub("te-uden-stripe"))?.status).toBe("free");
      expect((await sub("te-stripe"))?.status).toBe("free");
      expect((await sub("te-tt-historisk-stripe"))?.status).toBe("free");
    });

    async function seedReminder() {
      const inSevenDays = new Date(Date.now() + 7 * DAY);
      for (const id of ["tr-uden-stripe", "tr-stripe", "tr-tt-stripe"]) {
        await db
          .insert(users)
          .values({ id, email: `${id}@example.test`, name: id })
          .onConflictDoNothing();
      }
      await db.insert(subscriptions).values([
        {
          userId: "tr-uden-stripe",
          billingCycle: "monthly",
          status: "trialing",
          trialEndsAt: inSevenDays,
        },
        {
          userId: "tr-stripe",
          organizationId: "org-tw",
          billingCycle: "monthly",
          status: "trialing",
          stripeSubscriptionId: "sub_tw_reminder",
          trialEndsAt: inSevenDays,
        },
        {
          userId: "tr-tt-stripe",
          organizationId: "org-tt",
          billingCycle: "monthly",
          status: "trialing",
          stripeSubscriptionId: "sub_tt_legacy_reminder",
          trialEndsAt: inSevenDays,
        },
      ]);
    }

    const remindedUsers = () =>
      vi
        .mocked(sendTrialEndingEmail)
        .mock.calls.map((c) => (c[0] as { to?: string }).to);

    it("trial-reminder: ingen 'vælg en plan'-mail til en Stripe-prøve", async () => {
      enableTimewrenStripe(true);
      await db.delete(emailDeliveryLogs);
      await seedReminder();
      await trialReminderGET(cronRequest());
      // TimeTrack-prøven med historisk Stripe-id får stadig sin påmindelse.
      expect(remindedUsers().sort()).toEqual([
        "tr-tt-stripe@example.test",
        "tr-uden-stripe@example.test",
      ]);
    });

    it("trial-reminder: uden TimeWren-betaling som før", async () => {
      enableTimewrenStripe(false);
      await db.delete(emailDeliveryLogs);
      await seedReminder();
      await trialReminderGET(cronRequest());
      expect(remindedUsers().sort()).toEqual([
        "tr-stripe@example.test",
        "tr-tt-stripe@example.test",
        "tr-uden-stripe@example.test",
      ]);
    });
  },
);
