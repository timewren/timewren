/**
 * Kundens skatte-id på serveren (Greptile P1 på #1275): clients.create og
 * clients.update tager et udenlandsk skattenummer (fx et amerikansk EIN) og
 * gemmer det som skrevet, med bindestreg. EU-formen tjekkes kun i
 * formularen (src/components/clients/client-tax-id.ts).
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { seedAccount, webCaller } from "../ext/__tests__/fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function storedTaxId(id: string) {
  const row = await db.query.clients.findFirst({
    where: eq(clients.id, id),
    columns: { cvrNumber: true },
  });
  return row?.cvrNumber;
}

describe.skipIf(!enabled)("kundens skatte-id på serveren", () => {
  it("gemmer et amerikansk EIN som skrevet", async () => {
    const api = webCaller(await seedAccount()).clients;
    const client = await api.create({
      name: "Acme Inc.",
      country: "USA",
      cvrNumber: "12-3456789",
    });
    expect(await storedTaxId(client.id)).toBe("12-3456789");

    await api.update({
      id: client.id,
      data: { name: "Acme Inc.", country: "USA", cvrNumber: "98-7654321" },
    });
    expect(await storedTaxId(client.id)).toBe("98-7654321");
  });

  it("gemmer et dansk CVR og et EU-momsnummer som før", async () => {
    const api = webCaller(await seedAccount()).clients;
    const dk = await api.create({
      name: "Kunde ApS",
      country: "Danmark",
      cvrNumber: "12345678",
    });
    const de = await api.create({
      name: "Kunde GmbH",
      country: "Deutschland",
      cvrNumber: "DE123456789",
    });
    expect(await storedTaxId(dk.id)).toBe("12345678");
    expect(await storedTaxId(de.id)).toBe("DE123456789");
  });

  it("gemmer intet nummer som null", async () => {
    const api = webCaller(await seedAccount()).clients;
    const client = await api.create({ name: "Uden nummer", cvrNumber: "" });
    expect(await storedTaxId(client.id)).toBeNull();
  });
});
