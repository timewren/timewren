/**
 * Cron'en for gentagne fakturaer (#1113). Pengevejen her er, HVILKE skabeloner
 * der får en kladde: en ejer uden brugbart abonnement må ikke faktureres,
 * dubletter og tomme kørsler må ikke tælle som oprettede, en fejlet skabelon
 * må ikke stoppe de andre, og brugeren skal have ÉN besked — ikke én pr.
 * kladde.
 *
 * `runDueRecurringInvoice` er mocket; selve kladde-transaktionen har sine egne
 * tests i src/lib/recurring-invoices/.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const state = vi.hoisted(() => ({
  due: [] as Record<string, unknown>[],
  planChecks: [] as string[],
  allowed: true,
  /** Argumenterne til db-forespørgslen, så udvælgelsen kan efterses. */
  dueQueries: [] as { where?: unknown; columns?: unknown }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      recurringInvoices: {
        findMany: async (args: { where?: unknown; columns?: unknown }) => {
          state.dueQueries.push(args);
          return state.due;
        },
      },
    },
  },
}));
vi.mock("@/lib/recurring-invoices/plan", () => ({
  ownerAllowsRecurringInvoices: vi.fn(
    async (_db: unknown, userId: string, orgId: string | null) => {
      state.planChecks.push(`${orgId ?? ""}:${userId}`);
      return state.allowed;
    },
  ),
}));
vi.mock("@/lib/recurring-invoices/run", () => ({
  runDueRecurringInvoice: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ sendNotification: vi.fn() }));
vi.mock("@/lib/org/region.server", () => ({
  getOrgRegion: async (_db: unknown, orgId: string | null) => ({
    currency: orgId === "org-eur" ? "EUR" : "DKK",
    country: null,
    locale: null,
  }),
}));

import { sendNotification } from "@/lib/notifications";
import { ownerAllowsRecurringInvoices } from "@/lib/recurring-invoices/plan";
import { runDueRecurringInvoice } from "@/lib/recurring-invoices/run";
import { GET } from "./route";

type Result = {
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  metadata: {
    created: number;
    empty: number;
    duplicates: number;
    skippedPlan: number;
  };
};

const run = () =>
  (GET as unknown as (r: Request) => Promise<Result>)(
    new Request("http://localhost/api/cron/recurring-invoices"),
  );

const template = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: "user-1",
  organizationId: "org-1",
  ...over,
});

/** Udfald fra runDueRecurringInvoice for én skabelon. */
const outcome = (
  name: string,
  results: { status: string; amount: number }[],
  userId = "user-1",
) => ({ template: { name, userId }, results });

beforeEach(() => {
  state.due = [template("tpl-1")];
  state.planChecks = [];
  state.allowed = true;
  state.dueQueries = [];
  vi.mocked(runDueRecurringInvoice).mockResolvedValue(
    outcome("Månedlig drift", [{ status: "created", amount: 4000 }]) as never,
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("recurring-invoices cron: hvilke skabeloner hentes", () => {
  /** Den rendrede WHERE fra db-forespørgslen. */
  const dueWhere = () => {
    const where = state.dueQueries[0]?.where;
    if (!where) throw new Error("findMany blev kaldt uden where");
    return new PgDialect().sqlToQuery(where as SQL);
  };

  it("henter kun aktive, ikke-arkiverede skabeloner uden klippekort, som er forfaldne", async () => {
    await run();

    const { sql, params } = dueWhere();
    // Pauserede og arkiverede skabeloner må ikke faktureres …
    expect(sql).toContain("is_paused");
    expect(sql).toContain("is_archived");
    // … klippekort-koblede skabeloner faktureres af prepaid-renewals, så de
    // skal være filtreret væk her (ellers faktureres kunden to gange) …
    expect(sql).toMatch(/prepaid_package_id"? is null/);
    // … og kun skabeloner hvis næste kørselsdato er nået.
    expect(sql).toMatch(/next_run_date"? <=/);
    expect(params).toEqual([false, false, expect.any(String)]);
  });

  it("bruger den danske kalenderdag som forfaldsgrænse", async () => {
    await run();

    const today = dueWhere().params.at(-1);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Samme dag som `copenhagenToday` ville give for nu.
    expect(today).toBe(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Copenhagen",
      }).format(new Date()),
    );
  });

  it("henter kun de kolonner kørslen bruger", async () => {
    await run();

    expect(state.dueQueries[0].columns).toEqual({
      id: true,
      userId: true,
      organizationId: true,
    });
  });
});

describe("recurring-invoices cron", () => {
  it("opretter kladden og giver brugeren besked med beløbet", async () => {
    const result = await run();

    expect(result).toMatchObject({
      itemsProcessed: 1,
      itemsSucceeded: 1,
      itemsFailed: 0,
      metadata: { created: 1, empty: 0, duplicates: 0, skippedPlan: 0 },
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "recurring_invoice_draft",
        userId: "user-1",
        i18n: expect.objectContaining({ key: "recurringOne" }),
        url: "/dashboard/invoices?status=draft",
      }),
    );
  });

  it("fakturerer ikke for en ejer uden brugbart abonnement", async () => {
    state.allowed = false;

    const result = await run();

    expect(runDueRecurringInvoice).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      itemsSucceeded: 0,
      metadata: { created: 0, skippedPlan: 1 },
    });
  });

  it("slår abonnementet op én gang pr. ejer, ikke pr. skabelon", async () => {
    state.due = [
      template("tpl-1"),
      template("tpl-2"),
      template("tpl-3", { userId: "user-2", organizationId: null }),
    ];

    await run();

    expect(ownerAllowsRecurringInvoices).toHaveBeenCalledTimes(2);
    expect(state.planChecks).toEqual(["org-1:user-1", ":user-2"]);
  });

  it("tæller tomme kørsler og dubletter som ikke-oprettede", async () => {
    state.due = [template("tpl-1"), template("tpl-2")];
    vi.mocked(runDueRecurringInvoice)
      .mockResolvedValueOnce(
        outcome("Tom", [{ status: "empty", amount: 0 }]) as never,
      )
      .mockResolvedValueOnce(
        outcome("Dublet", [{ status: "duplicate", amount: 0 }]) as never,
      );

    const result = await run();

    expect(result).toMatchObject({
      itemsProcessed: 2,
      itemsSucceeded: 0,
      metadata: { created: 0, empty: 1, duplicates: 1 },
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("samler flere kladder til én besked pr. bruger", async () => {
    state.due = [template("tpl-1"), template("tpl-2")];
    vi.mocked(runDueRecurringInvoice)
      .mockResolvedValueOnce(
        outcome("Drift", [{ status: "created", amount: 4000 }]) as never,
      )
      .mockResolvedValueOnce(
        outcome("Hosting", [{ status: "created", amount: 500 }]) as never,
      );

    const result = await run();

    expect(result.metadata.created).toBe(2);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        i18n: expect.objectContaining({
          key: "recurringMany",
          values: expect.objectContaining({ count: 2 }),
        }),
      }),
    );
  });

  it("giver hver ejer sin egen besked", async () => {
    state.due = [
      template("tpl-1"),
      template("tpl-2", { userId: "user-2", organizationId: null }),
    ];
    vi.mocked(runDueRecurringInvoice)
      .mockResolvedValueOnce(
        outcome("Drift", [{ status: "created", amount: 4000 }]) as never,
      )
      .mockResolvedValueOnce(
        outcome(
          "Support",
          [{ status: "created", amount: 1000 }],
          "user-2",
        ) as never,
      );

    await run();

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(sendNotification).mock.calls.map(([c]) => c.userId),
    ).toEqual(["user-1", "user-2"]);
  });

  it("skriver beløbet i organisationens valuta (fund 19)", async () => {
    state.due = [
      template("tpl-1"),
      template("tpl-2", { organizationId: "org-eur" }),
    ];
    vi.mocked(runDueRecurringInvoice)
      .mockResolvedValueOnce(
        outcome("Drift", [{ status: "created", amount: 4000 }]) as never,
      )
      .mockResolvedValueOnce(
        outcome("Support", [{ status: "created", amount: 1700 }]) as never,
      );

    await run();

    // Samme bruger i to organisationer: én besked pr. organisation.
    const amounts = vi
      .mocked(sendNotification)
      .mock.calls.map(([c]) => String(c.i18n?.values?.amount));
    expect(amounts).toHaveLength(2);
    expect(amounts[0]).not.toContain("EUR");
    expect(amounts[1]).toContain("EUR");
  });

  it("tæller en fejlet skabelon og kører videre", async () => {
    state.due = [template("tpl-1"), template("tpl-2")];
    vi.mocked(runDueRecurringInvoice)
      .mockRejectedValueOnce(new Error("linjerne kunne ikke skrives"))
      .mockResolvedValueOnce(
        outcome("Drift", [{ status: "created", amount: 4000 }]) as never,
      );

    const result = await run();

    expect(result).toMatchObject({
      itemsProcessed: 2,
      itemsSucceeded: 1,
      itemsFailed: 1,
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("vælter ikke kørslen når notifikationen fejler", async () => {
    vi.mocked(sendNotification).mockRejectedValue(new Error("push nede"));

    const result = await run();

    expect(result).toMatchObject({ itemsSucceeded: 1, itemsFailed: 0 });
  });
});
