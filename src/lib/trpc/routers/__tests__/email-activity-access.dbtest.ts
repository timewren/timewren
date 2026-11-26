/**
 * `emailActivity` følger fakturaernes adgang: i en org med begrænset
 * kundeadgang ser et medlem kun mails for kunder, det må se, og uden
 * læseadgang til fakturamodulet ingen fakturamails. Ejeren og et medlem med
 * adgang ser dem stadig. Rækker uden org (før fakturamails fik org'en) ses
 * kun af afsenderen og med samme adgang; personlige kontomails uden org
 * (velkomst, drip, rykkere, login) hører ikke til org'ens aktivitet, alle
 * andre typer (faktura, klippekort, timesedler, fravær) bliver stående.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { emailEvents, rolePermissions, sentEmails } from "@/lib/db/schema";
import { createRequestMemo } from "@/lib/trpc/request-memo";
import { appRouter } from "@/lib/trpc/routers";
import {
  type Account,
  deviceCaller,
  seedAccount,
  seedMember,
  webCaller,
} from "../ext/__tests__/fixture";

const enabled = process.env.TT_DB_TESTS === "1";

/** Kunde med projekt, én ufaktureret post og en fakturakladde. */
async function seedClientInvoice(acc: Account, name: string) {
  const api = deviceCaller().extension;
  const client = await api.clients.create({
    token: acc.token,
    data: { name, email: `faktura@${name.toLowerCase()}.test` },
  });
  const project = await api.projects.create({
    token: acc.token,
    data: { name: `${name} projekt`, clientId: client.id, hourlyRate: "850" },
  });
  const entry = await api.entries.create({
    token: acc.token,
    data: {
      projectId: project.id,
      clientId: client.id,
      description: "Arbejde",
      hours: 2,
      date: "2026-10-20",
    },
  });
  const draft = await api.invoices.createDraft({
    token: acc.token,
    data: { clientId: client.id, timeEntryIds: [entry.id] },
  });
  return { clientId: client.id, invoiceId: draft.invoice.id };
}

async function seedMail(values: {
  userId: string;
  organizationId: string | null;
  emailType?: string;
  invoiceId?: string | null;
  clientId?: string | null;
}) {
  const resendEmailId = `re-${randomUUID()}`;
  await db.insert(sentEmails).values({
    resendEmailId,
    userId: values.userId,
    organizationId: values.organizationId,
    emailType: values.emailType ?? "invoice",
    recipientEmail: "modtager@kunde.test",
    subject: "Faktura",
    invoiceId: values.invoiceId ?? null,
    clientId: values.clientId ?? null,
    latestStatus: "sent",
  } as never);
  // Et hændelsesforløb, så getTimeline har noget at lække.
  await db
    .insert(emailEvents)
    .values({ resendEmailId, eventType: "delivered" } as never);
  return resendEmailId;
}

async function visibleIds(acc: Account) {
  const { items, total } = await webCaller(acc).emailActivity.list({
    limit: 100,
  });
  expect(total).toBe(items.length);
  return new Set(items.map((i) => i.resendEmailId));
}

describe.skipIf(!enabled)("emailActivity: kundeadgang og fakturamodul", () => {
  it("medlem med begrænset kundeadgang ser ikke en anden kundes fakturamail", async () => {
    const owner = await seedAccount("solo");
    const a = await seedClientInvoice(owner, "Synlig");
    const b = await seedClientInvoice(owner, "Skjult");
    const restricted = await seedMember(owner, { clientIds: [a.clientId] });
    const allowed = await seedMember(owner, {
      clientIds: [a.clientId, b.clientId],
    });

    const mailA = await seedMail({
      userId: owner.userId,
      organizationId: owner.orgId,
      invoiceId: a.invoiceId,
      clientId: a.clientId,
    });
    const mailB = await seedMail({
      userId: owner.userId,
      organizationId: owner.orgId,
      invoiceId: b.invoiceId,
      clientId: b.clientId,
    });
    // Kun koblet via fakturaen: kunden findes gennem invoices.client_id.
    const mailBViaInvoice = await seedMail({
      userId: owner.userId,
      organizationId: owner.orgId,
      invoiceId: b.invoiceId,
    });
    // Org-mail uden faktura og kunde: synlig for hele org'en som før.
    const orgMail = await seedMail({
      userId: owner.userId,
      organizationId: owner.orgId,
      emailType: "test",
    });
    // Gamle rækker uden org: kun afsenderen ser dem.
    const ownerLegacy = await seedMail({
      userId: owner.userId,
      organizationId: null,
      invoiceId: b.invoiceId,
      clientId: b.clientId,
    });
    // Medlemmets personlige systemmail hører ikke til org'ens aktivitet.
    await seedMail({
      userId: restricted.userId,
      organizationId: null,
      emailType: "drip_welcome",
    });

    const r = await visibleIds(restricted);
    expect(r).toEqual(new Set([mailA, orgMail]));

    const web = webCaller(restricted).emailActivity;
    expect(await web.getInvoiceStatus({ invoiceId: b.invoiceId })).toBeNull();
    expect(
      (await web.getInvoiceStatus({ invoiceId: a.invoiceId }))?.resendEmailId,
    ).toBe(mailA);
    expect(await web.getTimeline({ resendEmailId: mailB })).toEqual([]);
    expect(await web.getTimeline({ resendEmailId: mailBViaInvoice })).toEqual(
      [],
    );
    expect((await web.getStats()).totalSent).toBe(2);

    expect(await visibleIds(allowed)).toEqual(
      new Set([mailA, mailB, mailBViaInvoice, orgMail]),
    );
    const allowedWeb = webCaller(allowed).emailActivity;
    expect(
      await allowedWeb.getInvoiceStatus({ invoiceId: b.invoiceId }),
    ).not.toBeNull();
    expect(await allowedWeb.getTimeline({ resendEmailId: mailB })).toHaveLength(
      1,
    );

    expect(await visibleIds(owner)).toEqual(
      new Set([mailA, mailB, mailBViaInvoice, orgMail, ownerLegacy]),
    );
    expect((await webCaller(owner).emailActivity.getStats()).totalSent).toBe(5);
  }, 120_000);

  it("uden læseadgang til fakturamodulet ses ingen fakturamails", async () => {
    const owner = await seedAccount("solo");
    const a = await seedClientInvoice(owner, "Kunde");
    const admin = await seedMember(owner, { role: "admin" });
    await db.insert(rolePermissions).values({
      organizationId: owner.orgId,
      roleName: "admin",
      moduleKey: "invoices",
      accessLevel: "none",
    } as never);

    const invoiceMail = await seedMail({
      userId: owner.userId,
      organizationId: owner.orgId,
      invoiceId: a.invoiceId,
      clientId: a.clientId,
    });
    const orgMail = await seedMail({
      userId: owner.userId,
      organizationId: owner.orgId,
      emailType: "test",
    });

    expect(await visibleIds(admin)).toEqual(new Set([orgMail]));
    const web = webCaller(admin).emailActivity;
    expect(await web.getInvoiceStatus({ invoiceId: a.invoiceId })).toBeNull();
    expect(await web.getTimeline({ resendEmailId: invoiceMail })).toEqual([]);
    expect(await visibleIds(owner)).toEqual(new Set([invoiceMail, orgMail]));
    expect(
      await webCaller(owner).emailActivity.getTimeline({
        resendEmailId: invoiceMail,
      }),
    ).toHaveLength(1);
  }, 120_000);

  it("rækker uden org: afsenderens arbejdsmails, ikke kontomails, og kun med adgang", async () => {
    const owner = await seedAccount("solo");
    const a = await seedClientInvoice(owner, "Egen");
    const b = await seedClientInvoice(owner, "Fremmed");
    const member = await seedMember(owner, { clientIds: [a.clientId] });

    // Personlige systemmails uden org vises hverken i listen eller tallene.
    for (const emailType of ["drip_welcome", "payment_failed", "new_login"]) {
      await seedMail({
        userId: member.userId,
        organizationId: null,
        emailType,
      });
    }
    // Gamle fakturamails fra medlemmet, før de fik org'en.
    const legacyA = await seedMail({
      userId: member.userId,
      organizationId: null,
      invoiceId: a.invoiceId,
      clientId: a.clientId,
    });
    const legacyB = await seedMail({
      userId: member.userId,
      organizationId: null,
      invoiceId: b.invoiceId,
      clientId: b.clientId,
    });
    // Forretningsmails, der stadig logges uden org: kundebundne går gennem
    // kundeadgangen, budgetadvarslen (uden kunde) ses af afsenderen.
    const lowBalanceA = await seedMail({
      userId: member.userId,
      organizationId: null,
      emailType: "low_balance_alert",
      clientId: a.clientId,
    });
    await seedMail({
      userId: member.userId,
      organizationId: null,
      emailType: "portal_invitation",
      clientId: b.clientId,
    });
    const budgetAlert = await seedMail({
      userId: member.userId,
      organizationId: null,
      emailType: "project_budget_alert",
    });
    // Arbejdsmails uden org, kunde eller faktura (sendTimesheetEmail,
    // sendAbsenceEmail) ses også af afsenderen.
    const timesheet = await seedMail({
      userId: member.userId,
      organizationId: null,
      emailType: "timesheet_submitted",
    });
    const absence = await seedMail({
      userId: member.userId,
      organizationId: null,
      emailType: "absence_requested",
    });

    // Med request-memo som /api/trpc, så de memoiserede opslag også køres.
    const memoCaller = appRouter.createCaller({
      session: {
        user: {
          id: member.userId,
          email: `${member.userId}@device.test`,
          name: "Medlem Test",
        },
        session: { id: `sess-${member.userId}`, userId: member.userId },
        activeOrganizationId: member.orgId,
      },
      db,
      headers: new Headers(),
      memo: createRequestMemo(),
    } as never).emailActivity;
    const { items } = await memoCaller.list({ limit: 100 });
    expect(new Set(items.map((i) => i.resendEmailId))).toEqual(
      new Set([legacyA, lowBalanceA, budgetAlert, timesheet, absence]),
    );
    expect((await memoCaller.getStats()).totalSent).toBe(5);
    expect(await memoCaller.getTimeline({ resendEmailId: legacyB })).toEqual(
      [],
    );

    // Ejeren ser ikke medlemmets rækker uden org.
    expect(await visibleIds(owner)).toEqual(new Set());

    // Uden læseadgang til fakturamodulet forsvinder de gamle fakturamails;
    // klippekort- og budgetmails kræver ikke fakturamodulet.
    await db.insert(rolePermissions).values({
      organizationId: owner.orgId,
      roleName: "member",
      moduleKey: "invoices",
      accessLevel: "none",
    } as never);
    expect(await visibleIds(member)).toEqual(
      new Set([lowBalanceA, budgetAlert, timesheet, absence]),
    );
  }, 120_000);
});
