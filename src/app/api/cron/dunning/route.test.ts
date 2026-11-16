import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Rykkere dedupliceres på mailtype, ikke på det danske emne (#1108):
// emnet oversættes pr. modtager, så en engelsk modtager fik ellers den
// samme rykker hver dag.

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));

const state = vi.hoisted(() => ({
  pastDueSince: new Date(),
  sentRows: [] as { userId: string }[],
  where: null as unknown,
  send: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/email/billing", () => ({
  sendPaymentReminderEmail: vi.fn(async (args: Record<string, unknown>) => {
    state.send.push(args);
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      subscriptions: {
        findMany: async () => [
          {
            id: "sub-1",
            status: "past_due",
            pastDueSince: state.pastDueSince,
            organizationId: "org-1",
            userId: "u-en",
          },
        ],
      },
      members: {
        findMany: async () => [
          {
            role: "owner",
            user: { id: "u-en", email: "owner@example.com", name: "Owner" },
          },
        ],
      },
      users: { findFirst: async () => undefined },
      sentEmails: {
        findMany: async (args: { where: unknown }) => {
          state.where = args.where;
          return state.sentRows;
        },
      },
    },
  },
}));

import { GET } from "./route";

const DAY = 24 * 60 * 60 * 1000;
const run = () =>
  (GET as unknown as (r: Request) => Promise<unknown>)(
    new Request("http://localhost/api/cron/dunning"),
  );
const rendered = () => new PgDialect().sqlToQuery(state.where as SQL);

describe("dunning cron: dedup pr. mailtype", () => {
  beforeEach(() => {
    state.sentRows = [];
    state.where = null;
    state.send = [];
    state.pastDueSince = new Date(Date.now() - 4 * DAY);
  });

  it("sender ikke igen når modtageren allerede har fået advarslen", async () => {
    state.sentRows = [{ userId: "u-en" }];
    await run();
    expect(state.send).toHaveLength(0);
  });

  it("slår op på den sprogneutrale type med en overgang for gamle rækker", async () => {
    await run();
    const { sql, params } = rendered();
    expect(sql).toContain('"email_type" = $');
    expect(params).toContain("dunning_warning");
    expect(sql).toContain("LIKE");
    expect(params).toContain("Påmindelse%");
    expect(params).not.toContain("Sidste advarsel%");
    // Typen alene skal kunne matche: LIKE må kun gælde de gamle rækker
    expect(params).toContain("dunning_reminder");
  });

  it("sender advarslen når den ikke er sendt før", async () => {
    await run();
    expect(state.send).toHaveLength(1);
    expect(state.send[0]).toMatchObject({
      urgency: "warning",
      userId: "u-en",
    });
  });

  it("bruger typen for sidste advarsel efter 7 dage", async () => {
    state.pastDueSince = new Date(Date.now() - 8 * DAY);
    await run();
    expect(state.send).toHaveLength(1);
    expect(state.send[0]).toMatchObject({ urgency: "urgent" });
    const { params } = rendered();
    expect(params).toContain("dunning_urgent");
    expect(params).toContain("Sidste advarsel%");
    expect(params).not.toContain("Påmindelse%");
  });
});
