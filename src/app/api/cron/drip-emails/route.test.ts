import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Uden betalingsudbyder (selvhost) må drip-emails hverken sende win-back- eller
// opgraderingsmails (#1014). Med Cloud-env er adfærden som før.

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));
vi.mock("@/lib/cron/get-user-org", () => ({ getUserOrgId: async () => null }));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
vi.mock("@/lib/onboarding/activation", async (orig) => ({
  ...(await orig<typeof import("@/lib/onboarding/activation")>()),
  isWithinDripSendWindow: () => true,
  pickActivationDrip: () => null,
}));

const DAY = 86_400_000;
const h = vi.hoisted(() => ({
  lastSeenDaysAgo: 90,
  signupDaysAgo: 100,
  trialEndsInDays: 2,
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const chain = (table?: unknown) => {
    const rows = () => {
      if (table === schema.users)
        return [
          {
            user: {
              id: "u1",
              email: "bruger@example.test",
              name: "Test",
              emailVerified: true,
              createdAt: new Date(Date.now() - h.signupDaysAgo * DAY),
            },
            prefs: null,
          },
        ];
      if (table === schema.sessions)
        return [{ createdAt: new Date(Date.now() - h.lastSeenDaysAgo * DAY) }];
      return [];
    };
    const c: Promise<unknown> & Record<string, unknown> = Object.assign(
      Promise.resolve(rows()),
      { from: (t: unknown) => chain(t) } as Record<string, unknown>,
    );
    for (const m of ["where", "orderBy", "limit", "leftJoin"]) c[m] = () => c;
    return c;
  };
  return {
    db: {
      select: () => chain(),
      query: {
        members: { findFirst: async () => undefined },
        subscriptions: {
          findFirst: async () => ({
            isTrial: true,
            trialEndsAt: new Date(Date.now() + h.trialEndsInDays * DAY),
          }),
        },
      },
    },
  };
});

const sent = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("@/lib/email/drip", () => {
  const fn = (name: string) => async () => {
    sent.names.push(name);
  };
  return {
    sendDripAiFeaturesEmail: fn("ai"),
    sendDripClientNoKlippekortEmail: fn("clientNoKlippekort"),
    sendDripExtensionTipsEmail: fn("extension"),
    sendDripFirstWeekStatsEmail: fn("firstWeek"),
    sendDripGettingStartedEmail: fn("gettingStarted"),
    sendDripKlippekortTipsEmail: fn("klippekortTips"),
    sendDripNeedHelpEmail: fn("needHelp"),
    sendDripNoTimeEntryEmail: fn("noTime"),
    sendDripTimeNoInvoiceEmail: fn("timeNoInvoice"),
    sendDripUpgradeReminderEmail: fn("upgradeReminder"),
    sendDripWinBack30Email: fn("winBack30"),
    sendDripWinBack60Email: fn("winBack60"),
  };
});

import { GET } from "./route";

const run = () =>
  (GET as unknown as (r: Request) => Promise<unknown>)(
    new Request("http://localhost/api/cron/drip-emails"),
  );

describe("drip-emails billing-grene", () => {
  beforeEach(() => {
    sent.names = [];
    h.lastSeenDaysAgo = 90;
    h.signupDaysAgo = 100;
    h.trialEndsInDays = 2;
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("selvhost: ingen win-back-mail til inaktiv bruger", async () => {
    await run();
    expect(sent.names).not.toContain("winBack60");
    expect(sent.names).not.toContain("winBack30");
  });

  it("Cloud-env: win-back-mail sendes til inaktiv bruger", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "cloud-key");
    await run();
    expect(sent.names).toEqual(["winBack60"]);
  });

  it("selvhost: ingen opgraderingsmail ved udløbende prøveperiode", async () => {
    h.lastSeenDaysAgo = 1;
    h.signupDaysAgo = 12;
    await run();
    expect(sent.names).not.toContain("upgradeReminder");
  });

  it("Cloud-env: opgraderingsmail sendes ved udløbende prøveperiode", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    h.lastSeenDaysAgo = 1;
    h.signupDaysAgo = 12;
    await run();
    expect(sent.names).toEqual(["upgradeReminder"]);
  });
});
