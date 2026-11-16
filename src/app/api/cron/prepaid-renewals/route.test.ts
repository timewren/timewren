/**
 * Fornyelses-cron'en for periodiske klippekort (#1113). Pengevejen: hver
 * forfalden pakke fornyes PRÆCIS én gang, låsen genlæses inde i
 * transaktionen (to samtidige kørsler må ikke forny dobbelt), og en fejlet
 * mail eller notifikation må aldrig rulle fornyelsen tilbage eller stoppe
 * resten af køen.
 *
 * `renewPackageInTx` er mocket — selve fornyelses-transaktionen har sine egne
 * tests i src/lib/prepaid/renewal.test.ts og dækkes mod rigtig Postgres.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const state = vi.hoisted(() => ({
  due: [] as Record<string, unknown>[],
  /** Rækken som transaktionen ser den efter `FOR UPDATE` (null = væk). */
  locked: null as Record<string, unknown> | null,
  client: null as Record<string, unknown> | null,
  renewals: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      prepaidPackages: { findMany: async () => state.due },
      clients: { findFirst: async () => state.client ?? undefined },
      companyProfiles: { findFirst: async () => ({ name: "Mit Firma" }) },
    },
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => (state.locked ? [state.locked] : []),
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({
              for: async () => (state.locked ? [state.locked] : []),
            }),
          }),
        }),
      }),
  },
}));

vi.mock("@/lib/prepaid/renew-package", () => ({
  renewPackageInTx: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ sendNotification: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));
vi.mock("@/lib/portal/client-url", () => ({
  getClientPortalUrl: vi.fn(async () => "https://portal.example.com/abc"),
}));
vi.mock("@/lib/email/mail-brand", () => ({
  resolveMailBrand: vi.fn(async () => ({
    key: "timetrack",
    from: "ingen-svar@example.com",
    locale: "da",
  })),
}));
vi.mock("@/lib/email/recipient-locale", () => ({
  getRecipientLocale: vi.fn(async () => "da"),
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "ingen-svar@example.com",
  resend: { emails: { send: vi.fn(async () => ({ error: null })) } },
}));

import { sendNotification } from "@/lib/notifications";
import { renewPackageInTx } from "@/lib/prepaid/renew-package";
import { resend } from "@/lib/resend";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { GET } from "./route";

type Result = {
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  metadata: { duePackages: number };
};

const run = () =>
  (GET as unknown as (r: Request) => Promise<Result>)(
    new Request("http://localhost/api/cron/prepaid-renewals"),
  );

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);

function pkg(over: Record<string, unknown> = {}) {
  return {
    id: "pkg-1",
    userId: "user-1",
    organizationId: "org-1",
    clientId: "client-1",
    name: "Klippekort 10 timer",
    isActive: true,
    renewalInterval: "monthly",
    renewalNextAt: YESTERDAY,
    ...over,
  };
}

beforeEach(() => {
  state.due = [pkg()];
  state.locked = pkg();
  state.client = { name: "Testkunde ApS", email: "kontakt@example.com" };
  state.renewals = [];
  vi.mocked(renewPackageInTx).mockImplementation(async (_tx, locked) => {
    state.renewals.push((locked as { id: string }).id);
    return { newPackageId: "pkg-2", draftInvoiceId: "invoice-1" };
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("prepaid-renewals cron", () => {
  it("fornyer en forfalden pakke én gang og varsler alle kanaler", async () => {
    const result = await run();

    expect(state.renewals).toEqual(["pkg-1"]);
    expect(result).toMatchObject({
      itemsProcessed: 1,
      itemsSucceeded: 1,
      itemsFailed: 0,
      metadata: { duePackages: 1 },
    });
    // Kladdefakturaen skal gennemses af brugeren (#198).
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "recurring_invoice_draft",
        userId: "user-1",
        url: "/dashboard/invoices/invoice-1",
      }),
    );
    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "kontakt@example.com" }),
    );
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "prepaid.created",
        data: expect.objectContaining({ renewedFrom: "pkg-1" }),
      }),
    );
  });

  it("fornyer ikke når den låste række ikke længere er forfalden", async () => {
    // En samtidig kørsel (eller en manuel fornyelse) har flyttet datoen.
    state.locked = pkg({ renewalNextAt: new Date(Date.now() + 86_400_000) });

    const result = await run();

    expect(renewPackageInTx).not.toHaveBeenCalled();
    expect(result).toMatchObject({ itemsSucceeded: 0, itemsFailed: 0 });
    expect(resend.emails.send).not.toHaveBeenCalled();
  });

  it("fornyer ikke en pakke der er blevet deaktiveret eller har mistet intervallet", async () => {
    for (const locked of [
      pkg({ isActive: false }),
      pkg({ renewalInterval: null }),
      pkg({ renewalNextAt: null }),
      null,
    ]) {
      state.locked = locked;
      const result = await run();
      expect(renewPackageInTx).not.toHaveBeenCalled();
      expect(result.itemsSucceeded).toBe(0);
    }
  });

  it("tæller en fejlet fornyelse og kører videre med næste pakke", async () => {
    state.due = [pkg(), pkg({ id: "pkg-9" })];
    state.locked = pkg();
    vi.mocked(renewPackageInTx)
      .mockRejectedValueOnce(new Error("constraint-fejl"))
      .mockResolvedValueOnce({ newPackageId: "pkg-3", draftInvoiceId: null });

    const result = await run();

    expect(result).toMatchObject({
      itemsProcessed: 2,
      itemsSucceeded: 1,
      itemsFailed: 1,
    });
  });

  it("ruller ikke fornyelsen tilbage når kundemailen fejler", async () => {
    vi.mocked(resend.emails.send).mockRejectedValue(new Error("Resend nede"));

    const result = await run();

    expect(result).toMatchObject({ itemsSucceeded: 1, itemsFailed: 0 });
    expect(emitWebhookEvent).toHaveBeenCalled();
  });

  it("ruller ikke fornyelsen tilbage når notifikationen fejler", async () => {
    vi.mocked(sendNotification).mockRejectedValue(new Error("push nede"));

    const result = await run();

    expect(result).toMatchObject({ itemsSucceeded: 1, itemsFailed: 0 });
    expect(resend.emails.send).toHaveBeenCalled();
  });

  it("sender ingen kundemail når kunden ikke har en mailadresse", async () => {
    state.client = { name: "Testkunde ApS", email: null };

    const result = await run();

    expect(result.itemsSucceeded).toBe(1);
    expect(resend.emails.send).not.toHaveBeenCalled();
  });

  it("varsler ikke om en kladde når fornyelsen ikke lavede en", async () => {
    vi.mocked(renewPackageInTx).mockResolvedValue({
      newPackageId: "pkg-2",
      draftInvoiceId: null,
    });

    const result = await run();

    expect(result.itemsSucceeded).toBe(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
