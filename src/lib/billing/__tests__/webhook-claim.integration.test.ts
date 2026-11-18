/**
 * INTEGRATION: claimWebhookEvent mod PostgreSQL. Kravet på et brandet
 * Stripe-event må overtage en fejlet række og en forældet 'processing'-række
 * (handleren døde), men aldrig en afsluttet række eller et aktivt krav. Uden
 * klausulen for forældede krav ville et opsigelsesevent efter et procesnedbrud
 * få 409 for evigt; testen "forældet krav" fejler, hvis klausulen fjernes.
 *
 * Kører kun med TEST_DATABASE_URL sat (se account-deletion.test.ts).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { webhookEvents } from "@/lib/db/schema";
import { connectTestDb, testPostgres } from "@/test/test-db";
import { CLAIM_STALE_MS, claimWebhookEvent } from "../webhook-claim";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("claimWebhookEvent (integration)", () => {
  const scratch = `webhook_claim_it_${Date.now()}`;
  const admin = testPostgres({ max: 1 });
  const client = testPostgres({
    max: 1,
    connection: { search_path: scratch },
  });
  const db = drizzle(client, { schema });
  const claim = (at: Date) => claimWebhookEvent(db as never, event, at);
  const event = { id: "evt_claim_1", type: "customer.subscription.deleted" };
  const now = new Date("2026-11-18T12:00:00Z");

  async function seed(status: string, ageMs: number) {
    await db.insert(webhookEvents).values({
      eventId: event.id,
      source: "stripe",
      eventType: event.type,
      status,
      processedAt: new Date(now.getTime() - ageMs),
    });
  }

  async function row() {
    return db.query.webhookEvents.findFirst({
      where: eq(webhookEvents.eventId, event.id),
    });
  }

  beforeAll(async () => {
    await connectTestDb(admin, client);
    await admin.unsafe(`CREATE SCHEMA ${scratch}`);
    await admin.unsafe(
      `CREATE TABLE ${scratch}."webhook_events" (LIKE public."webhook_events" INCLUDING ALL)`,
    );
  });

  beforeEach(async () => {
    await admin.unsafe(`DELETE FROM ${scratch}."webhook_events"`);
  });

  afterAll(async () => {
    await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
    await client.end();
    await admin.end();
  });

  it("nyt event: kravet lykkes og står som processing", async () => {
    expect(await claim(now)).toBe(true);
    expect((await row())?.status).toBe("processing");
  });

  it("fejlet event: overtages", async () => {
    await seed("error", 1_000);
    expect(await claim(now)).toBe(true);
    expect((await row())?.status).toBe("processing");
  });

  it("aktivt krav: overtages ikke", async () => {
    await seed("processing", CLAIM_STALE_MS - 60_000);
    expect(await claim(now)).toBe(false);
  });

  it("forældet krav fra en død handler: overtages", async () => {
    await seed("processing", CLAIM_STALE_MS + 60_000);
    expect(await claim(now)).toBe(true);
    expect((await row())?.processedAt.getTime()).toBe(now.getTime());
  });

  it("afsluttet event: overtages ikke", async () => {
    await seed("success", CLAIM_STALE_MS * 10);
    expect(await claim(now)).toBe(false);
    expect((await row())?.status).toBe("success");
  });
});
