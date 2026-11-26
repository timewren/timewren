/**
 * Overtræks-politikken på et eksisterende klippekort (#1319): den kan ændres
 * via prepaid.update uden at røre felter, kaldet ikke sender, og et tomt kort
 * med overtræk tilladt forbliver valgbart i kortvælgeren (getActiveForClient).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import {
  clients,
  members,
  organizations,
  prepaidPackages,
  subscriptions,
  users,
} from "@/lib/db/schema";
import { findAutoDeductPackageForClient } from "@/lib/prepaid/auto-select.server";
import {
  connectTestDb,
  isolatedTestDatabase,
  testPostgres,
} from "@/test/test-db";
import { prepaidRouter } from "../prepaid";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));

const org = "overdraft-edit-org";
const user = "overdraft-edit-owner";
const date = (day: number) => new Date(Date.UTC(2026, 10, day));

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "prepaid: overtræk på et eksisterende kort (#1319)",
  () => {
    const database = isolatedTestDatabase();
    const pg = testPostgres({ max: 2, database: database.name });
    const db = drizzle(pg, { schema });
    let caller: ReturnType<typeof prepaidRouter.createCaller>;
    let clientId: string;

    const baseData = () => ({
      name: "Kort A",
      clientId,
      totalHours: 10,
      hourlyRate: 100,
      purchaseDate: "2026-11-01",
    });

    async function insertCard(
      over: Partial<typeof prepaidPackages.$inferInsert>,
    ) {
      const [row] = await db
        .insert(prepaidPackages)
        .values({
          userId: user,
          organizationId: org,
          clientId,
          name: "Kort A",
          totalHours: "10",
          usedHours: "0",
          remainingHours: "10",
          hourlyRate: "100",
          totalValue: "1000",
          purchaseDate: date(1),
          ...over,
        })
        .returning({ id: prepaidPackages.id });
      return row.id;
    }

    async function readCard(id: string) {
      const row = await db.query.prepaidPackages.findFirst({
        where: eq(prepaidPackages.id, id),
      });
      if (!row) throw new Error("kort mangler");
      return row;
    }

    beforeAll(async () => {
      await database.create();
      await connectTestDb(pg);
      await db.insert(users).values({
        id: user,
        name: "Test Owner",
        email: "owner@overdraft-edit.demo",
      });
      await db.insert(organizations).values({
        id: org,
        name: "Test Studio",
        slug: org,
      });
      await db.insert(members).values({
        id: "overdraft-edit-membership",
        organizationId: org,
        userId: user,
        role: "owner",
      });
      const [client] = await db
        .insert(clients)
        .values({ name: "Kunde A", userId: user, organizationId: org })
        .returning({ id: clients.id });
      clientId = client.id;
      await db.insert(subscriptions).values({
        userId: user,
        organizationId: org,
        status: "active",
        planTier: "team",
        billingCycle: "monthly",
        trialEndsAt: date(30),
      });
      caller = prepaidRouter.createCaller({
        db,
        headers: new Headers(),
        orgOverride: org,
        session: { user: { id: user } },
      } as never);
    });

    afterAll(async () => {
      await pg.end();
      await database.drop();
    });

    it("skifter politikken og lader en gemt sats stå, når satsen ikke sendes", async () => {
      const id = await insertCard({
        overdraftPolicy: "invoice",
        overdraftRate: "950",
      });

      await caller.update({
        id,
        data: { ...baseData(), overdraftPolicy: "allow" },
      });

      const card = await readCard(id);
      expect(card.overdraftPolicy).toBe("allow");
      expect(card.overdraftRate).toBe("950.00");
    });

    it("en opdatering uden politik ændrer ikke politikken", async () => {
      const id = await insertCard({ overdraftPolicy: "allow" });

      await caller.update({
        id,
        data: { ...baseData(), name: "Kort A omdøbt" },
      });

      const card = await readCard(id);
      expect(card.name).toBe("Kort A omdøbt");
      expect(card.overdraftPolicy).toBe("allow");
    });

    it("et tomt kort er kun valgbart, når overtræk er tilladt", async () => {
      const empty = {
        usedHours: "10",
        remainingHours: "0",
        overdraftHours: "2",
      };
      const allowId = await insertCard({ ...empty, overdraftPolicy: "allow" });
      const invoiceId = await insertCard({
        ...empty,
        overdraftPolicy: "invoice",
      });
      const blockId = await insertCard({ ...empty, overdraftPolicy: "block" });

      const active = await caller.getActiveForClient({ clientId });
      const ids = active.map((p) => p.id);
      expect(ids).toContain(allowId);
      expect(ids).toContain(invoiceId);
      expect(ids).not.toContain(blockId);
      expect(active.find((p) => p.id === allowId)?.overdraftPolicy).toBe(
        "allow",
      );
    });

    it("serverens auto-valg (quickStop) finder et tomt kort med overtræk", async () => {
      const [otherClient] = await db
        .insert(clients)
        .values({ name: "Kunde B", userId: user, organizationId: org })
        .returning({ id: clients.id });
      const allowId = await insertCard({
        clientId: otherClient.id,
        usedHours: "10",
        remainingHours: "0",
        overdraftPolicy: "allow",
        autoDeduct: true,
      });

      const picked = await findAutoDeductPackageForClient(db, {
        userId: user,
        orgId: org,
        clientId: otherClient.id,
      });
      expect(picked?.id).toBe(allowId);

      await db
        .update(prepaidPackages)
        .set({ overdraftPolicy: "block" })
        .where(eq(prepaidPackages.id, allowId));
      expect(
        await findAutoDeductPackageForClient(db, {
          userId: user,
          orgId: org,
          clientId: otherClient.id,
        }),
      ).toBeNull();
    });
  },
);
