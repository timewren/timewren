/**
 * extension.klippekort.*: opret, fyld op, list og arkivér via token — med
 * web's tier-grænse og org-isolation.
 */

import { describe, expect, it } from "vitest";
import { deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

describe.skipIf(!enabled)("extension.klippekort (token-API)", () => {
  it("opret, fyld op, list og arkivér", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Klippekortkunde" },
    });

    const card = await api.klippekort.create({
      token: acc.token,
      data: {
        name: "10 timer",
        clientId: client.id,
        totalHours: 10,
        hourlyRate: 800,
        purchaseDate: "2026-10-01",
      },
    });
    expect(card.organizationId).toBe(acc.orgId);

    await api.klippekort.topUp({ token: acc.token, id: card.id, hours: 5 });
    const fetched = await api.klippekort.get({ token: acc.token, id: card.id });
    expect(Number(fetched.totalHours)).toBe(15);

    const listed = await api.klippekort.list({
      token: acc.token,
      filter: { clientId: client.id },
    });
    expect(listed.map((p: { id: string }) => p.id)).toContain(card.id);

    await api.klippekort.archive({ token: acc.token, id: card.id });
    const active = await api.klippekort.list({
      token: acc.token,
      filter: { clientId: client.id },
    });
    expect(active.map((p: { id: string }) => p.id)).not.toContain(card.id);
  });

  it("en anden org kan ikke se eller ændre kortet", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: a.token,
      data: { name: "Kunde A" },
    });
    const card = await api.klippekort.create({
      token: a.token,
      data: {
        name: "A's kort",
        clientId: client.id,
        totalHours: 10,
        hourlyRate: 800,
        purchaseDate: "2026-10-01",
      },
    });

    const listed = await api.klippekort.list({ token: b.token });
    expect(listed.map((p: { id: string }) => p.id)).not.toContain(card.id);
    // Thunks: hvert kald startes først, når det afventes.
    for (const call of [
      () => api.klippekort.get({ token: b.token, id: card.id }),
      () => api.klippekort.topUp({ token: b.token, id: card.id, hours: 1 }),
      () => api.klippekort.archive({ token: b.token, id: card.id }),
    ]) {
      expect((await errorOf(call())).code).toBe("NOT_FOUND");
    }
  });
});
