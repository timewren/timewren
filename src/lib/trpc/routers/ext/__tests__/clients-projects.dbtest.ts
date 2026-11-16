/**
 * Token-API'et (desktop 1.0): plan-grænser, kunder/projekter og org-
 * isolation mod en rigtig Postgres og de rigtige routere. Grænserne skal
 * være PRÆCIS web's — token-kaldene går gennem web's egne procedurer.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FREE_CLIENT_LIMIT_MESSAGE } from "@/lib/billing/plan-limits";
import { db } from "@/lib/db";
import { clients, extensionTokens, projects } from "@/lib/db/schema";
import { deviceCaller, seedAccount, webCaller } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

describe.skipIf(!enabled)("extension.* token-API: kunder og projekter", () => {
  it("afviser et ugyldigt og et tilbagekaldt token", async () => {
    const acc = await seedAccount();
    const api = deviceCaller();
    expect(
      (await errorOf(api.extension.clients.list({ token: "forkert" }))).code,
    ).toBe("UNAUTHORIZED");

    await db
      .update(extensionTokens)
      .set({ isRevoked: true })
      .where(eq(extensionTokens.id, acc.tokenId));
    expect(
      (await errorOf(api.extension.clients.list({ token: acc.token }))).code,
    ).toBe("UNAUTHORIZED");
  });

  it("afviser en org, brugeren ikke er medlem af (ingen stille fallback)", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    const err = await errorOf(
      deviceCaller().extension.clients.list({
        token: a.token,
        organizationId: b.orgId,
      }),
    );
    expect(err.code).toBe("FORBIDDEN");
  });

  it("Gratis: 4. aktive kunde afvises med web's besked, også ved genaktivering", async () => {
    const acc = await seedAccount("free");
    const api = deviceCaller().extension.clients;
    const ids: string[] = [];
    for (const name of ["Kunde 1", "Kunde 2", "Kunde 3"]) {
      const c = await api.create({ token: acc.token, data: { name } });
      ids.push(c.id);
    }
    const err = await errorOf(
      api.create({ token: acc.token, data: { name: "Kunde 4" } }),
    );
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe(FREE_CLIENT_LIMIT_MESSAGE);

    // Web giver samme svar for samme konto.
    const webErr = await errorOf(
      webCaller(acc).clients.create({ name: "Kunde 4" }),
    );
    expect(webErr.message).toBe(err.message);

    // Arkivér én → plads til en ny; genaktivering ville give 4 aktive.
    await api.archive({ token: acc.token, id: ids[0] });
    await api.create({ token: acc.token, data: { name: "Kunde 4" } });
    const unarchiveErr = await errorOf(
      api.unarchive({ token: acc.token, id: ids[0] }),
    );
    expect(unarchiveErr.message).toBe(FREE_CLIENT_LIMIT_MESSAGE);

    const ent = await deviceCaller().extension.entitlements.get({
      token: acc.token,
    });
    expect(ent.plan?.tier).toBe("free");
    expect(ent.limits?.maxActiveClients).toBe(3);
    expect(ent.usage?.activeClients).toBe(3);
    expect(ent.features.canAddActiveClient).toBe(false);
    // #1012: ingen funktionslås. Gratis har fakturering og klippekort; kun
    // kapacitet (canAddActiveClient) er begrænset.
    expect(ent.features.invoices).toBe(true);
    expect(ent.features.klippekort).toBe(true);
    expect(ent.features.timeTracking).toBe(true);
  });

  it("betalt plan: ubegrænsede kunder og erhvervsfunktioner i entitlements", async () => {
    const acc = await seedAccount("solo");
    const ent = await deviceCaller().extension.entitlements.get({
      token: acc.token,
    });
    expect(ent.plan?.tier).toBe("solo");
    expect(ent.limits?.maxActiveClients).toBeNull();
    expect(ent.features.invoices).toBe(true);
    expect(ent.features.klippekort).toBe(true);
    expect(ent.role).toBe("owner");
  });

  it("CRUD + arkivering bruger web's felter og holder sig i egen org", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    const api = deviceCaller().extension;

    const client = await api.clients.create({
      token: a.token,
      data: {
        name: "Bageriet",
        defaultHourlyRate: "850",
        roundingEnabled: true,
        roundingMinutes: 15,
        roundingMethod: "up",
      },
    });
    const row = await db.query.clients.findFirst({
      where: eq(clients.id, client.id),
    });
    expect(row?.organizationId).toBe(a.orgId);
    expect(row?.defaultHourlyRate).toBe("850.00");

    await api.clients.update({
      token: a.token,
      id: client.id,
      data: { name: "Bageriet på hjørnet" },
    });
    const project = await api.projects.create({
      token: a.token,
      data: {
        name: "Ny webshop",
        clientId: client.id,
        hourlyRate: "900",
        budgetHours: "40",
      },
    });
    expect(project.organizationId).toBe(a.orgId);

    // B kan hverken se eller ændre A's data.
    const bClients = await api.clients.list({ token: b.token });
    expect(bClients.map((c) => c.id)).not.toContain(client.id);
    expect(
      (await errorOf(api.clients.get({ token: b.token, id: client.id }))).code,
    ).toBeDefined();
    expect(
      (await errorOf(api.clients.archive({ token: b.token, id: client.id })))
        .code,
    ).toBe("NOT_FOUND");
    expect(
      (await errorOf(api.projects.archive({ token: b.token, id: project.id })))
        .code,
    ).toBe("NOT_FOUND");

    // Arkivering: projekt via status, kunde via isArchived.
    await api.projects.archive({ token: a.token, id: project.id });
    const p = await db.query.projects.findFirst({
      where: eq(projects.id, project.id),
    });
    expect(p?.status).toBe("archived");
    await api.projects.setStatus({
      token: a.token,
      id: project.id,
      status: "active",
    });

    await api.clients.archive({ token: a.token, id: client.id });
    expect(
      (await api.clients.list({ token: a.token })).map((c) => c.id),
    ).not.toContain(client.id);
    expect(
      (await api.clients.list({ token: a.token, includeArchived: true })).find(
        (c) => c.id === client.id,
      )?.isArchived,
    ).toBe(true);
  });
});
