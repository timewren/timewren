/**
 * Desktop som web (PARITET-WEB afsnit 9): moms fra web's PDF-beregning,
 * slet kladde, kreditnota, modtager og mailstatus, integrationer,
 * indstillinger, virksomhed, opgaver (slet, underopgave, tildeling),
 * medlemmer og `device.me`. Hver procedure afviser en anden org og et
 * medlem uden adgang, og svarenes form er låst (desktop parser dem).
 */

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  invoices,
  organizationModules,
  tasks,
  timeEntries,
} from "@/lib/db/schema";
import { MODULE_KEYS } from "@/lib/modules/constants";
import {
  type Account,
  deviceCaller,
  seedAccount,
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

const keys = (o: object) => Object.keys(o).sort();

/** Kunde + projekt (850 kr/t) + to ufakturerede poster (3,5 t). */
async function seedBillable(acc: Account, email = "faktura@kunde.test") {
  const api = deviceCaller().extension;
  const client = await api.clients.create({
    token: acc.token,
    data: { name: "Paritetskunde", email },
  });
  const project = await api.projects.create({
    token: acc.token,
    data: { name: "Paritetsprojekt", clientId: client.id, hourlyRate: "850" },
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

async function seedDraft(acc: Account) {
  const billable = await seedBillable(acc);
  const draft = await deviceCaller().extension.invoices.createDraft({
    token: acc.token,
    data: { clientId: billable.client.id, timeEntryIds: billable.entryIds },
  });
  return { ...billable, invoiceId: draft.invoice.id };
}

describe.skipIf(!enabled)("extension: desktop som web", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("totals: moms som web's PDF, også efter momsregistrering", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { invoiceId } = await seedDraft(acc);

    const before = await api.invoices.totals({
      token: acc.token,
      id: invoiceId,
    });
    expect(keys(before)).toEqual([
      "currency",
      "showVat",
      "subtotal",
      "total",
      "vatAmount",
      "vatRate",
    ]);
    expect(before).toEqual({
      subtotal: "2975.00",
      vatRate: "25.00",
      vatAmount: "0.00",
      total: "2975.00",
      showVat: false,
      currency: "DKK",
    });

    await api.company.update({
      token: acc.token,
      data: {
        name: "Paritet ApS",
        email: "firma@paritet.test",
        vatRegistered: true,
      },
    });
    const after = await api.invoices.totals({
      token: acc.token,
      id: invoiceId,
    });
    expect(after).toMatchObject({
      subtotal: "2975.00",
      vatAmount: "743.75",
      total: "3718.75",
      showVat: true,
    });
    // Samme tal som web's afsendelsesdialog (og PDF'en, samme funktion).
    const preview = await webCaller(acc).invoices.sendPreview({
      id: invoiceId,
    });
    expect(preview.total.toFixed(2)).toBe(after.total);
    expect(preview.currency).toBe(after.currency);
    // Dialogens "inkl. moms" følger samme flag som PDF'ens momslinje.
    expect(preview.showVat).toBe(after.showVat);

    const company = await api.company.get({ token: acc.token });
    expect(keys(company)).toEqual(["companyProfile", "defaultInvoiceTemplate"]);
    expect(company.companyProfile?.vatRegistered).toBe(true);
    expect(company.companyProfile?.organizationId).toBe(acc.orgId);
    expect(company.defaultInvoiceTemplate).toBeNull();
  }, 60_000);

  it("totals, emailStatus, slet og kreditnota: anden org og medlem uden kundeadgang afvises", async () => {
    const owner = await seedAccount("solo");
    const other = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { invoiceId } = await seedDraft(owner);
    const synlig = await api.clients.create({
      token: owner.token,
      data: { name: "Synlig kunde" },
    });
    const member = await seedMember(owner, { clientIds: [synlig.id] });

    for (const call of [
      () => api.invoices.totals({ token: other.token, id: invoiceId }),
      () => api.invoices.emailStatus({ token: other.token, id: invoiceId }),
      () => api.invoices.delete({ token: other.token, id: invoiceId }),
      () =>
        api.invoices.createCreditNote({
          token: other.token,
          invoiceId,
        }),
    ]) {
      expect((await errorOf(call())).code).toBe("NOT_FOUND");
    }
    for (const call of [
      () => api.invoices.totals({ token: member.token, id: invoiceId }),
      () => api.invoices.emailStatus({ token: member.token, id: invoiceId }),
      () => api.invoices.delete({ token: member.token, id: invoiceId }),
      () =>
        api.invoices.createCreditNote({
          token: member.token,
          invoiceId,
        }),
    ]) {
      expect((await errorOf(call())).code).toBe("FORBIDDEN");
    }
    const row = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
    });
    expect(row?.status).toBe("draft");
  }, 60_000);

  it("slet kladde frigiver posterne; kreditnota er idempotent", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const draft = await seedDraft(acc);

    expect(
      await api.invoices.delete({ token: acc.token, id: draft.invoiceId }),
    ).toEqual({ success: true });
    const deleted = await db.query.invoices.findFirst({
      where: eq(invoices.id, draft.invoiceId),
    });
    expect(deleted?.status).toBe("deleted");
    const released = await db.query.timeEntries.findMany({
      where: eq(timeEntries.isBilled, true),
      columns: { id: true },
    });
    for (const id of draft.entryIds) {
      expect(released.map((r) => r.id)).not.toContain(id);
    }

    const issued = await seedDraft(acc);
    await api.invoices.update({
      token: acc.token,
      data: { id: issued.invoiceId, status: "sent" },
    });
    const key = `kreditnota-${issued.invoiceId}`;
    const credit = await api.invoices.createCreditNote({
      token: acc.token,
      invoiceId: issued.invoiceId,
      idempotencyKey: key,
    });
    expect(credit.kind).toBe("credit_note");
    expect(credit.relatedInvoiceId).toBe(issued.invoiceId);
    expect(credit.organizationId).toBe(acc.orgId);
    expect(Number(credit.amount)).toBe(-2975);
    // Offline-køen gentager kaldet: samme kreditnota, ingen fejl.
    const again = await api.invoices.createCreditNote({
      token: acc.token,
      invoiceId: issued.invoiceId,
      idempotencyKey: key,
    });
    expect(again.id).toBe(credit.id);
  }, 60_000);

  it("send til en anden modtager, og mailstatus viser den", async () => {
    // Log-transporten "sender" uden netværk og giver et mail-id.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MAIL_TRANSPORT", "log");
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const { invoiceId } = await seedDraft(acc);

    expect(
      await api.invoices.emailStatus({ token: acc.token, id: invoiceId }),
    ).toBeNull();

    const changed = await errorOf(
      api.invoices.send({
        token: acc.token,
        id: invoiceId,
        expectedRecipient: "gammel@kunde.test",
      }),
    );
    expect(changed.code).toBe("BAD_REQUEST");
    const invalid = await errorOf(
      api.invoices.send({
        token: acc.token,
        id: invoiceId,
        recipientEmail: "ikke-en-mail",
      }),
    );
    expect(invalid.code).toBe("BAD_REQUEST");
    let row = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
    });
    expect(row?.status).toBe("draft");

    expect(
      await api.invoices.send({
        token: acc.token,
        id: invoiceId,
        recipientEmail: "bogholder@kunde.test",
        expectedRecipient: "faktura@kunde.test",
      }),
    ).toEqual({ success: true });
    row = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
    });
    expect(row?.status).toBe("sent");

    const status = await api.invoices.emailStatus({
      token: acc.token,
      id: invoiceId,
    });
    expect(status && keys(status)).toEqual([
      "bouncedAt",
      "deliveredAt",
      "latestStatus",
      "openedAt",
      "recipientEmail",
      "resendEmailId",
      "sentAt",
    ]);
    expect(status?.recipientEmail).toBe("bogholder@kunde.test");
    expect(status?.latestStatus).toBe("sent");
  }, 60_000);

  it("integrationer: status og eksportvalg som web, modul-vagt", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    expect(await api.integrations.status({ token: acc.token })).toEqual({
      billy: false,
      dinero: false,
      economic: false,
    });
    // Ikke forbundet: web's fejl.
    for (const system of ["billy", "economic"] as const) {
      const err = await errorOf(
        api.integrations.exportOptions({ token: acc.token, system }),
      );
      expect(err.code).toBe("BAD_REQUEST");
    }

    const off = await seedAccount("solo");
    await db.insert(organizationModules).values(
      MODULE_KEYS.map((moduleKey) => ({
        organizationId: off.orgId,
        moduleKey,
        isAvailable: true,
        isEnabled: moduleKey !== "integrations",
      })),
    );
    const err = await errorOf(
      api.integrations.exportOptions({ token: off.token, system: "billy" }),
    );
    expect(err.code).toBe("FORBIDDEN");
  });

  it("brugerindstillinger læses og rettes med web's updateProfile", async () => {
    const acc = await seedAccount("solo");
    const api = deviceCaller().extension;
    const first = await api.user.settings({ token: acc.token });
    expect(keys(first)).toEqual([
      "defaultHourlyRate",
      "roundingEnabled",
      "roundingMethod",
      "roundingMinutes",
      "vatPeriod",
      "weeklyHourGoal",
    ]);

    await api.user.updateSettings({
      token: acc.token,
      data: {
        defaultHourlyRate: "900",
        roundingEnabled: true,
        roundingMinutes: 30,
        roundingMethod: "nearest",
        weeklyHourGoal: "32",
      },
    });
    expect(await api.user.settings({ token: acc.token })).toMatchObject({
      defaultHourlyRate: "900.00",
      roundingEnabled: true,
      roundingMinutes: 30,
      roundingMethod: "nearest",
      weeklyHourGoal: 32,
    });
    // Web's validering: afrunding kræver minutter og metode.
    const err = await errorOf(
      api.user.updateSettings({
        token: acc.token,
        data: { roundingEnabled: true, roundingMinutes: null },
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("virksomheden: kun admin/ejer kan rette; medlem ser egen org", async () => {
    const owner = await seedAccount("solo");
    const api = deviceCaller().extension;
    await api.company.update({
      token: owner.token,
      data: { name: "Ejer ApS", email: "ejer@firma.test" },
    });
    const member = await seedMember(owner, { readOnlyModules: ["templates"] });

    const err = await errorOf(
      api.company.update({
        token: member.token,
        data: { name: "Kapret ApS", email: "kapret@firma.test" },
      }),
    );
    expect(err.code).toBe("FORBIDDEN");
    const seen = await api.company.get({ token: member.token });
    expect(seen.companyProfile?.name).toBe("Ejer ApS");

    const other = await seedAccount("solo");
    expect(
      (await api.company.get({ token: other.token })).companyProfile,
    ).toBeNull();
  });

  it("opgaver: slet, underopgave (org-vagt) og tildeling", async () => {
    const owner = await seedAccount("solo");
    const other = await seedAccount("solo");
    const api = deviceCaller().extension;
    const colleague = await seedMember(owner, { role: "admin" });
    const reader = await seedMember(owner, { readOnlyModules: ["tasks"] });

    const parent = await api.tasks.create({
      token: owner.token,
      data: { title: "Forælder", priority: "high" },
    });

    // En kollega (admin) i samme org kan lave en underopgave under ejerens opgave
    // (org-modellen, ikke kun egne opgaver).
    const key = `sub-${parent.id}`;
    const sub = await api.tasks.createSubtask({
      token: colleague.token,
      parentTaskId: parent.id,
      title: "Underopgave",
      idempotencyKey: key,
    });
    expect(sub.parentTaskId).toBe(parent.id);
    expect(sub.organizationId).toBe(owner.orgId);
    expect(sub.priority).toBe("high");
    const again = await api.tasks.createSubtask({
      token: colleague.token,
      parentTaskId: parent.id,
      title: "Underopgave",
      idempotencyKey: key,
    });
    expect(again.id).toBe(sub.id);

    // Medlemmer og eget id til tildeling.
    const me = await api.device.me({ token: colleague.token });
    expect(keys(me)).toEqual(["organizationId", "user"]);
    expect(keys(me.user)).toEqual(["email", "id", "name"]);
    expect(me.user.id).toBe(colleague.userId);
    expect(me.organizationId).toBe(owner.orgId);
    const roster = await api.org.members({ token: owner.token });
    expect(roster.map((m) => m.userId).sort()).toEqual(
      [owner.userId, colleague.userId, reader.userId].sort(),
    );
    for (const m of roster) {
      expect(keys(m)).toEqual(["email", "image", "name", "role", "userId"]);
    }
    expect(
      (await api.org.members({ token: other.token })).map((m) => m.userId),
    ).toEqual([other.userId]);

    const assigned = await api.tasks.setAssignee({
      token: owner.token,
      id: parent.id,
      assignedToUserId: colleague.userId,
    });
    expect(assigned?.assignedToUserId).toBe(colleague.userId);
    // Kun medlemmer af org'en kan tildeles.
    expect(
      (
        await errorOf(
          api.tasks.setAssignee({
            token: owner.token,
            id: parent.id,
            assignedToUserId: other.userId,
          }),
        )
      ).code,
    ).toBe("BAD_REQUEST");

    // Anden org: NOT_FOUND på alle veje.
    for (const call of [
      () =>
        api.tasks.createSubtask({
          token: other.token,
          parentTaskId: parent.id,
          title: "Udefra",
        }),
      () =>
        api.tasks.setAssignee({
          token: other.token,
          id: parent.id,
          assignedToUserId: null,
        }),
      () => api.tasks.delete({ token: other.token, id: parent.id }),
    ]) {
      expect((await errorOf(call())).code).toBe("NOT_FOUND");
    }
    // Medlem med kun læseadgang til opgaver: FORBIDDEN.
    for (const call of [
      () =>
        api.tasks.createSubtask({
          token: reader.token,
          parentTaskId: parent.id,
          title: "Læser",
        }),
      () =>
        api.tasks.setAssignee({
          token: reader.token,
          id: parent.id,
          assignedToUserId: null,
        }),
      () => api.tasks.delete({ token: reader.token, id: parent.id }),
    ]) {
      expect((await errorOf(call())).code).toBe("FORBIDDEN");
    }

    expect(
      await api.tasks.delete({ token: owner.token, id: parent.id }),
    ).toEqual({ success: true });
    for (const id of [parent.id, sub.id]) {
      expect(
        await db.query.tasks.findFirst({ where: eq(tasks.id, id) }),
      ).toBeUndefined();
    }
  }, 60_000);

  it("alle nye procedurer afviser en org, brugeren ikke er medlem af", async () => {
    const acc = await seedAccount("solo");
    const other = await seedAccount("solo");
    const api = deviceCaller().extension;
    const id = "00000000-0000-4000-8000-000000000000";
    const auth = { token: acc.token, organizationId: other.orgId };
    for (const call of [
      () => api.invoices.totals({ ...auth, id }),
      () => api.invoices.emailStatus({ ...auth, id }),
      () => api.invoices.delete({ ...auth, id }),
      () => api.invoices.createCreditNote({ ...auth, invoiceId: id }),
      () => api.integrations.status(auth),
      () => api.integrations.exportOptions({ ...auth, system: "dinero" }),
      () => api.user.settings(auth),
      () => api.user.updateSettings({ ...auth, data: { name: "Ny" } }),
      () => api.company.get(auth),
      () =>
        api.company.update({
          ...auth,
          data: { name: "Ny ApS", email: "ny@firma.test" },
        }),
      () => api.tasks.delete({ ...auth, id }),
      () => api.tasks.createSubtask({ ...auth, parentTaskId: id, title: "x" }),
      () => api.tasks.setAssignee({ ...auth, id, assignedToUserId: null }),
      () => api.org.members(auth),
      () => api.device.me(auth),
    ]) {
      expect((await errorOf(call())).code).toBe("FORBIDDEN");
    }
  });
});
