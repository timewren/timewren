/**
 * extension.invoices.*: kladde fra ufaktureret tid, linjer, betalt og PDF
 * via token — uden funktionslås (Gratis kan fakturere; kun kapacitet begrænser) og
 * org-isolation på alle veje, også PDF-ruten.
 */

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as getPdf } from "@/app/api/ext/invoices/[id]/pdf/route";
import { FREE_CLIENT_LIMIT_MESSAGE } from "@/lib/billing/plan-limits";
import { db } from "@/lib/db";
import {
  invoices,
  organizationModules,
  rolePermissions,
  timeEntries,
} from "@/lib/db/schema";
import { MODULE_KEYS } from "@/lib/modules/constants";
import {
  type Account,
  deviceCaller,
  seedAccount,
  seedCompanyProfile,
  seedMember,
  webCaller,
} from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

/** Kunde + projekt (850 kr/t) + to ufakturerede poster. */
async function seedBillable(acc: Account) {
  const api = deviceCaller().extension;
  const client = await api.clients.create({
    token: acc.token,
    data: { name: "Fakturakunde", email: "faktura@kunde.test" },
  });
  const project = await api.projects.create({
    token: acc.token,
    data: { name: "Fakturaprojekt", clientId: client.id, hourlyRate: "850" },
  });
  const entryIds: string[] = [];
  for (const hours of [2, 1.5]) {
    const entry = await api.entries.create({
      token: acc.token,
      data: {
        projectId: project.id,
        clientId: client.id,
        description: `Arbejde ${hours} t`,
        hours,
        date: "2026-10-20",
      },
    });
    entryIds.push(entry.id);
  }
  return { client, project, entryIds };
}

function pdfRequest(token: string, invoiceId: string) {
  return getPdf(
    new NextRequest(`http://localhost/api/ext/invoices/${invoiceId}/pdf`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ id: invoiceId }) },
  );
}

describe.skipIf(!enabled)("extension.invoices (token-API)", () => {
  it("Gratis kan fakturere (ingen funktionslås), men ikke ud over 3 aktive kunder", async () => {
    const acc = await seedAccount("free");
    const api = deviceCaller().extension;
    const { client, entryIds } = await seedBillable(acc);
    const draft = await api.invoices.createDraft({
      token: acc.token,
      data: { clientId: client.id, timeEntryIds: entryIds },
    });
    expect(draft.invoice.organizationId).toBe(acc.orgId);
    expect(Number(draft.invoice.amount)).toBe(3.5 * 850);
    expect(await api.invoices.list({ token: acc.token })).toHaveLength(1);

    // Kapacitet er grænsen: kunde 2 og 3 er med, den 4. aktive afvises.
    for (const n of [2, 3]) {
      await api.clients.create({
        token: acc.token,
        data: { name: `Gratiskunde ${n}` },
      });
    }
    const err = await errorOf(
      api.clients.create({ token: acc.token, data: { name: "Gratiskunde 4" } }),
    );
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe(FREE_CLIENT_LIMIT_MESSAGE);
  });

  it("kladde fra ufaktureret tid → linjer → sendt → betalt → PDF", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { client, entryIds } = await seedBillable(acc);

    const uninvoiced = await api.invoices.uninvoicedEntries({
      token: acc.token,
      clientId: client.id,
    });
    expect(uninvoiced.map((e: { id: string }) => e.id).sort()).toEqual(
      [...entryIds].sort(),
    );

    const draft = await api.invoices.createDraft({
      token: acc.token,
      data: { clientId: client.id, timeEntryIds: entryIds },
    });
    const invoiceId = draft.invoice.id;
    expect(draft.invoice.organizationId).toBe(acc.orgId);
    // Timeprisen kommer fra hierarkiet (projektets 850 kr/t).
    expect(Number(draft.invoice.amount)).toBe(3.5 * 850);

    // En genereret kladde har én linje pr. post; linjerne gemmes samlet som
    // i web.
    const lines = await api.invoices.lines({ token: acc.token, id: invoiceId });
    expect(lines).toHaveLength(2);
    await api.invoices.saveLines({
      token: acc.token,
      data: {
        invoiceId,
        lines: lines.map((l, i) => ({
          id: l.id,
          description: i === 0 ? "Rettet linje" : l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          amount: String(l.amount),
          timeEntryId: l.timeEntryId,
          sortOrder: i,
        })),
      },
    });
    const after = await api.invoices.lines({ token: acc.token, id: invoiceId });
    expect(after.map((l) => l.description)).toContain("Rettet linje");
    expect(after).toHaveLength(2);

    // Posterne er nu på fakturaen og ikke længere ufakturerede.
    const stillOpen = await api.invoices.uninvoicedEntries({
      token: acc.token,
      clientId: client.id,
    });
    expect(stillOpen).toHaveLength(0);

    await api.invoices.update({
      token: acc.token,
      data: { id: invoiceId, status: "sent" },
    });
    await api.invoices.markPaid({
      token: acc.token,
      id: invoiceId,
      paidDate: "2026-10-25",
    });
    const row = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
    });
    expect(row?.status).toBe("paid");
    const billed = await db.query.timeEntries.findMany({
      where: eq(timeEntries.invoiceId, invoiceId),
      columns: { id: true },
    });
    expect(billed).toHaveLength(2);

    const link = await api.invoices.pdfLink({
      token: acc.token,
      id: invoiceId,
    });
    expect(link.path).toBe(
      `/api/ext/invoices/${invoiceId}/pdf?organizationId=${encodeURIComponent(acc.orgId)}`,
    );
    const pdf = await pdfRequest(acc.token, invoiceId);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  }, 60_000);

  it("en anden org kan ikke læse, rette, markere eller hente PDF", async () => {
    const a = await seedAccount("solo");
    const b = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { client, entryIds } = await seedBillable(a);
    const draft = await api.invoices.createDraft({
      token: a.token,
      data: { clientId: client.id, timeEntryIds: entryIds },
    });
    const invoiceId = draft.invoice.id;

    expect(
      (await api.invoices.list({ token: b.token })).map(
        (i: { id: string }) => i.id,
      ),
    ).not.toContain(invoiceId);
    // Thunks: kaldene startes først i løkken, så ingen afvisning står
    // uhåndteret, mens en tidligere afventes.
    for (const call of [
      () => api.invoices.get({ token: b.token, id: invoiceId }),
      () => api.invoices.lines({ token: b.token, id: invoiceId }),
      () => api.invoices.pdfLink({ token: b.token, id: invoiceId }),
      () => api.invoices.markPaid({ token: b.token, id: invoiceId }),
      () =>
        api.invoices.createDraft({
          token: b.token,
          data: { clientId: client.id, timeEntryIds: entryIds },
        }),
    ]) {
      expect((await errorOf(call())).code).toBe("NOT_FOUND");
    }
    expect((await pdfRequest(b.token, invoiceId)).status).toBe(404);
    expect((await pdfRequest("forkert", invoiceId)).status).toBe(401);
  }, 60_000);

  it("PDF-ruten har web's modul- og rollevagt", async () => {
    const owner = await seedAccount("solo");
    const { client, entryIds } = await seedBillable(owner);
    const draft = await deviceCaller().extension.invoices.createDraft({
      token: owner.token,
      data: { clientId: client.id, timeEntryIds: entryIds },
    });
    const invoiceId = draft.invoice.id;

    // Medlemsrollen uden adgang til fakturamodulet.
    const member = await seedMember(owner);
    await db.insert(rolePermissions).values({
      organizationId: owner.orgId,
      roleName: "member",
      moduleKey: "invoices",
      accessLevel: "none",
    } as never);
    expect((await pdfRequest(member.token, invoiceId)).status).toBe(403);

    // Org'en har slået fakturering fra.
    await db.insert(organizationModules).values(
      MODULE_KEYS.map((moduleKey) => ({
        organizationId: owner.orgId,
        moduleKey,
        isAvailable: true,
        isEnabled: moduleKey !== "invoicing",
      })),
    );
    expect((await pdfRequest(owner.token, invoiceId)).status).toBe(403);
  });

  it("første faktura: web kræver virksomhedsprofil, token-vejen gør ikke", async () => {
    const web = await seedAccount();
    const webBill = await seedBillable(web);
    const generate = () =>
      webCaller(web).invoices.generateFromTimeEntries({
        clientId: webBill.client.id,
        timeEntryIds: webBill.entryIds,
        requireCompanyProfile: true,
      });

    const err = await errorOf(generate());
    expect(err.code).toBe("BAD_REQUEST");
    expect(
      await db.query.invoices.findMany({
        where: eq(invoices.organizationId, web.orgId),
      }),
    ).toHaveLength(0);
    // Posterne er ikke låst af det afviste forsøg.
    for (const id of webBill.entryIds) {
      const entry = await db.query.timeEntries.findFirst({
        where: eq(timeEntries.id, id),
      });
      expect(entry?.isBilled).toBe(false);
    }

    await seedCompanyProfile(web);
    const created = await generate();
    expect(created.invoice.organizationId).toBe(web.orgId);

    // Desktop/mobil: en ny org uden profil laver stadig sin første kladde.
    const device = await seedAccount();
    const deviceBill = await seedBillable(device);
    const draft = await deviceCaller().extension.invoices.createDraft({
      token: device.token,
      data: {
        clientId: deviceBill.client.id,
        timeEntryIds: deviceBill.entryIds,
      },
    });
    expect(draft.invoice.organizationId).toBe(device.orgId);
  }, 60_000);
});
