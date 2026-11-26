/**
 * Billy-eksport med "send på mail" mod en rigtig Postgres (#1222): samtidige
 * og gentagne afsendelser af samme faktura, et usikkert mailresultat, en
 * faktura der er ændret efter bekræftelsen, og mange samtidige eksporter
 * (mailforsøget skrives på eksportens egen forbindelse, så poolen ikke
 * løber tør). Billy's API er en falsk `fetch`; databasen er rigtig.
 */

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  clients,
  integrationSyncLogs,
  invoiceLines,
  invoices,
  users,
} from "@/lib/db/schema";
import { encrypt } from "@/lib/utils/encryption";
import { type Account, seedAccount, webCaller } from "../ext/__tests__/fixture";

const enabled = process.env.TT_DB_TESTS === "1";
process.env.ENCRYPTION_KEY ??= "a".repeat(64);

const CLIENT_EMAIL = "faktura@kunde.test";

type SendMode = "ok" | "fail500" | "refuse422";

/** Billy's API: counts creates and sends, slow enough to overlap calls. */
const billy = {
  creates: 0,
  sends: 0,
  sendMode: "ok" as SendMode,
  delayMs: 150,
  /** Runs while Billy handles POST /send, before it answers. */
  onSend: undefined as (() => Promise<void>) | undefined,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fakeBilly(url: string, init?: RequestInit) {
  const { pathname } = new URL(url);
  const method = (init?.method ?? "GET").toUpperCase();
  await new Promise((r) => setTimeout(r, billy.delayMs));
  if (pathname.endsWith("/v2/organization")) {
    return json({ organization: { id: "billy-org", name: "Billy Org" } });
  }
  const send = pathname.match(/\/v2\/invoices\/([^/]+)\/send$/);
  if (send && method === "POST") {
    billy.sends++;
    await billy.onSend?.();
    if (billy.sendMode === "fail500") return json({ error: "boom" }, 500);
    if (billy.sendMode === "refuse422") return json({ error: "nope" }, 422);
    return json({});
  }
  if (pathname.endsWith("/v2/invoices") && method === "POST") {
    billy.creates++;
    return json({
      invoices: [{ id: `b-${billy.creates}`, state: "draft", contactId: "c" }],
    });
  }
  const one = pathname.match(/\/v2\/invoices\/([^/]+)$/);
  if (one && method === "PUT") {
    return json({
      invoices: [{ id: one[1], state: "approved", invoiceNo: "77" }],
    });
  }
  return json({ error: "not found" }, 404);
}

async function seedInvoice(acc: Account, clientId: string, amount = "1000") {
  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber: `T-${Math.random().toString(36).slice(2, 10)}`,
      clientId,
      userId: acc.userId,
      organizationId: acc.orgId,
      amount,
      status: "draft",
      issueDate: new Date("2026-11-01"),
      dueDate: new Date("2026-11-15"),
    } as never)
    .returning();
  await db.insert(invoiceLines).values({
    invoiceId: invoice.id,
    description: "Rådgivning",
    quantity: "1",
    unitPrice: amount,
    amount,
    sortOrder: 0,
  } as never);
  return invoice;
}

async function seedWorld() {
  const acc = await seedAccount();
  await db
    .update(users)
    .set({ billyApiKey: encrypt("billy-test-key") } as never)
    .where(eq(users.id, acc.userId));
  const [client] = await db
    .insert(clients)
    .values({
      userId: acc.userId,
      organizationId: acc.orgId,
      name: "Sendekunde ApS",
      email: CLIENT_EMAIL,
      billyId: "contact-1",
    } as never)
    .returning();
  return { acc, client };
}

async function reviewOf(acc: Account, invoiceId: string) {
  const preview = await webCaller(acc).invoices.sendPreview({
    id: invoiceId,
    paymentTermsDays: 14,
  });
  return {
    invoiceNumber: preview.invoiceNumber,
    total: preview.total,
    currency: preview.currency,
    lineCount: preview.lineCount,
    recipient: CLIENT_EMAIL,
  };
}

function sendInput(
  invoiceId: string,
  expectedInvoice: Awaited<ReturnType<typeof reviewOf>>,
) {
  return {
    invoiceId,
    action: "send" as const,
    productId: "product-1",
    expectedRecipient: CLIENT_EMAIL,
    expectedInvoice,
  };
}

async function mailAttempts(invoiceId: string) {
  const rows = await db
    .select({
      status: integrationSyncLogs.status,
      metadata: integrationSyncLogs.metadata,
    })
    .from(integrationSyncLogs)
    .where(
      and(
        eq(integrationSyncLogs.integrationType, "billy"),
        eq(integrationSyncLogs.operation, "send_invoice_email"),
      ),
    );
  return rows.filter(
    (r) => (r.metadata as { invoiceId?: string })?.invoiceId === invoiceId,
  );
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

describe.skipIf(!enabled)(
  "Billy: send på mail, serialiseret pr. faktura",
  () => {
    beforeEach(() => {
      billy.creates = 0;
      billy.sends = 0;
      billy.sendMode = "ok";
      billy.delayMs = 150;
      billy.onSend = undefined;
      vi.stubGlobal("fetch", vi.fn(fakeBilly));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("to samtidige afsendelser: én går igennem, den anden afvises, Billy mailer én gang", async () => {
      const { acc, client } = await seedWorld();
      const invoice = await seedInvoice(acc, client.id);
      const expected = await reviewOf(acc, invoice.id);
      const api = webCaller(acc).integrations;

      const results = await Promise.allSettled([
        api.exportInvoiceToBilly(sendInput(invoice.id, expected)),
        api.exportInvoiceToBilly(sendInput(invoice.id, expected)),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.code).toBe("CONFLICT");
      expect(rejected[0].reason.message).toBe(
        "Fakturaen eksporteres allerede. Prøv igen om lidt.",
      );
      expect(billy.creates).toBe(1);
      expect(billy.sends).toBe(1);

      const row = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoice.id),
      });
      expect(row?.billyInvoiceId).toBe("b-1");
      expect((await mailAttempts(invoice.id)).map((a) => a.status)).toEqual([
        "success",
      ]);
      const link = await db.query.integrationSyncLogs.findFirst({
        where: and(
          eq(integrationSyncLogs.operation, "link_invoice_draft"),
          eq(integrationSyncLogs.organizationId, acc.orgId),
        ),
      });
      expect(link?.metadata).toMatchObject({
        invoiceId: invoice.id,
        externalId: "b-1",
        accountId: "billy-org",
      });
    });

    it("en gentagelse efter afsendelsen afvises uden at maile igen", async () => {
      const { acc, client } = await seedWorld();
      const invoice = await seedInvoice(acc, client.id);
      const expected = await reviewOf(acc, invoice.id);
      const api = webCaller(acc).integrations;

      await api.exportInvoiceToBilly(sendInput(invoice.id, expected));
      const err = await errorOf(
        api.exportInvoiceToBilly(sendInput(invoice.id, expected)),
      );
      expect(err.code).toBe("BAD_REQUEST");
      expect(billy.sends).toBe(1);
    });

    it("et usikkert mailresultat gemmes og blokerer al afsendelse, til brugeren har tjekket Billy", async () => {
      const { acc, client } = await seedWorld();
      const invoice = await seedInvoice(acc, client.id);
      const expected = await reviewOf(acc, invoice.id);
      const caller = webCaller(acc);
      billy.sendMode = "fail500";

      const err = await errorOf(
        caller.integrations.exportInvoiceToBilly(
          sendInput(invoice.id, expected),
        ),
      );
      expect(err.code).toBe("CONFLICT");
      expect(err.message).toContain("Tjek mailstatus i Billy eller Dinero");

      // Eksporten committer hver skrivning: link og forsøg findes trods fejlen.
      const row = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoice.id),
      });
      expect(row?.billyInvoiceId).toBe("b-1");
      expect((await mailAttempts(invoice.id)).map((a) => a.status)).toEqual([
        "partial",
      ]);
      await expect(
        caller.invoices.providerEmailState({ id: invoice.id }),
      ).resolves.toEqual({ billy: "uncertain", dinero: "available" });
      const preview = await caller.invoices.sendPreview({ id: invoice.id });
      expect(preview.uncertainProviderEmail).toBe("billy");

      // TimeTracks egen mail afvises også.
      const mailErr = await errorOf(
        caller.invoices.sendEmail({
          id: invoice.id,
          expectedRecipient: CLIENT_EMAIL,
        }),
      );
      expect(mailErr.code).toBe("CONFLICT");
      expect(billy.sends).toBe(1);

      // Brugeren har tjekket Billy: mailen blev ikke sendt.
      await expect(
        caller.invoices.resolveProviderEmail({
          id: invoice.id,
          provider: "billy",
          wasSent: false,
        }),
      ).resolves.toEqual({ resolved: true });
      await expect(
        caller.invoices.providerEmailState({ id: invoice.id }),
      ).resolves.toEqual({ billy: "available", dinero: "available" });
    });

    it("link og mailforsøg er committet, før Billy sender, så et nedbrud midt i eksporten ikke åbner for en ny afsendelse", async () => {
      const { acc, client } = await seedWorld();
      const invoice = await seedInvoice(acc, client.id);
      const expected = await reviewOf(acc, invoice.id);
      const caller = webCaller(acc);

      // Set fra en anden forbindelse, mens Billy behandler POST /send: det er
      // det, der står tilbage, hvis processen dør lige nu.
      let duringSend:
        | {
            billyInvoiceId: string | null | undefined;
            attempts: string[];
            state: unknown;
          }
        | undefined;
      billy.onSend = async () => {
        const row = await db.query.invoices.findFirst({
          where: eq(invoices.id, invoice.id),
        });
        duringSend = {
          billyInvoiceId: row?.billyInvoiceId,
          attempts: (await mailAttempts(invoice.id)).map((a) => a.status),
          state: await caller.invoices.providerEmailState({ id: invoice.id }),
        };
      };

      await caller.integrations.exportInvoiceToBilly(
        sendInput(invoice.id, expected),
      );
      expect(duringSend).toEqual({
        billyInvoiceId: "b-1",
        attempts: ["partial"],
        state: { billy: "uncertain", dinero: "available" },
      });
    });

    it("et sikkert afslag fra Billy efterlader intet usikkert forsøg", async () => {
      const { acc, client } = await seedWorld();
      const invoice = await seedInvoice(acc, client.id);
      const expected = await reviewOf(acc, invoice.id);
      billy.sendMode = "refuse422";

      await errorOf(
        webCaller(acc).integrations.exportInvoiceToBilly(
          sendInput(invoice.id, expected),
        ),
      );
      expect(await mailAttempts(invoice.id)).toEqual([]);
      await expect(
        webCaller(acc).invoices.providerEmailState({ id: invoice.id }),
      ).resolves.toEqual({ billy: "available", dinero: "available" });
    });

    it("afviser, når fakturaen er ændret efter bekræftelsen, før noget oprettes i Billy", async () => {
      const { acc, client } = await seedWorld();
      const invoice = await seedInvoice(acc, client.id);
      const expected = await reviewOf(acc, invoice.id);
      await db
        .update(invoiceLines)
        .set({ amount: "1500", unitPrice: "1500" } as never)
        .where(eq(invoiceLines.invoiceId, invoice.id));

      const err = await errorOf(
        webCaller(acc).integrations.exportInvoiceToBilly(
          sendInput(invoice.id, expected),
        ),
      );
      expect(err.code).toBe("CONFLICT");
      expect(err.message).toBe(
        "Fakturaen er ændret, efter du bekræftede den. Åbn bekræftelsen igen.",
      );
      expect(billy.creates).toBe(0);
      expect(billy.sends).toBe(0);
    });

    it("25 samtidige eksporter af forskellige fakturaer løber ikke poolen (20) tør", async () => {
      const { acc, client } = await seedWorld();
      billy.delayMs = 300;
      const seeded = [];
      for (let i = 0; i < 25; i++) {
        const invoice = await seedInvoice(acc, client.id);
        seeded.push({ invoice, expected: await reviewOf(acc, invoice.id) });
      }
      const api = webCaller(acc).integrations;

      let timer: ReturnType<typeof setTimeout> | undefined;
      const results = await Promise.race([
        Promise.allSettled(
          seeded.map(({ invoice, expected }) =>
            api.exportInvoiceToBilly(sendInput(invoice.id, expected)),
          ),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("eksporterne hænger: poolen er løbet tør")),
            90_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));

      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      expect(billy.sends).toBe(25);
    }, 120_000);
  },
);
