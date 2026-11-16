/**
 * INTEGRATION: en sletning må ikke gå tabt, fordi en notits-række ikke kunne
 * skrives.
 *
 * Review-fund (HØJ): `recordDeletionTombstones` sluger sin egen fejl, og den
 * blev kalt *inde i* transaktionen, der slettede rækken. Postgres afbryder en
 * transaktion ved det første fejlede statement. Scenarie: `0128` er skrevet,
 * men Mads kører den. Så sletter en bruger en tidspost → `DELETE FROM
 * time_entries` → `42P01` på tombstone-inserten sluges → transaktionen er
 * død → kullet kaster, og sletningen er rullet tilbage. Brugeren kan ikke
 * slette en tidspost, før migrationen er kørt.
 *
 * Håndlavede db-mocks kan ikke se det: en mock har intet `.transaction`, så
 * intet i den kan rulle tilbage. Derfor kører denne fil mod en rigtig Postgres
 * med et klonet, minimalt schema i en scratch-schema.
 *
 * Sæt TEST_DATABASE_URL til en kasseret database med repoets schema
 * (`DATABASE_URL=… npx drizzle-kit push --force`), så klonerne findes:
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:unit
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

// Analytics, webhooks og velkomstmail er ikke emnet her, og de ville åbne en
// connection til DATABASE_URL i stedet for testens.
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));
vi.mock("@/lib/email/engagement", () => ({
  sendFirstTimeEntryEmail: vi.fn(),
  sendFirstProjectEmail: vi.fn(),
}));

import * as schema from "@/lib/db/schema";
import {
  desktopSyncTombstones,
  members,
  organizations,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { timeRouter } from "../time";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Tabeller `time.delete` rører. `desktop_sync_tombstones` er med, så den kan
 * omdøbes væk i den enkelte test — så simuleres en kasse database hvor
 * migrationen 0128 ikke er kørt. `organizations`/`members`/`organization_modules`
 * og lås-tabellerne er med, fordi brugeren nu skal have et medlemskab for at
 * komme forbi orgless-gaten (#848) — de forbliver tomme, så ingen lås rammer.
 * `org_audit_logs` er med, fordi sletningen nu har et orgId og derfor også
 * skriver en auditlog (ellers fejler det insert stille i hver test).
 */
const CLONED = [
  "user",
  "organizations",
  "members",
  "organization_modules",
  "org_audit_logs",
  "time_entries",
  "tasks",
  "generated_time_entries",
  "prepaid_usage",
  "timesheet_weeks",
  "period_closings",
  "org_period_locks",
];

const USER = "tomb-owner";
const ORG = "tomb-org";
const ENTRY = "77777777-7777-4777-8777-777777777777";
const ENTRY_2 = "88888888-8888-4888-8888-888888888888";

describe.skipIf(!TEST_DATABASE_URL)(
  "time.delete med en manglende tombstone-tabel (integration)",
  () => {
    const scratch = `tombstone_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    // KUN scratch: ellers ville `public` give fundet en tabel at finde, og
    // testen ville aldrig ramme den 42P01 den skal ramme.
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    /** Org + ejer-medlemskab for USER — orgless-gaten kræver det nu (#848). */
    async function ensureMembership(): Promise<void> {
      const orgExists =
        await client`SELECT 1 FROM organizations WHERE id = ${ORG}`;
      if (orgExists.length === 0) {
        await db.insert(organizations).values({
          id: ORG,
          name: "Test Org",
          slug: "test-org",
        } as never);
      }
      await db
        .insert(members)
        .values({
          id: "m-owner",
          organizationId: ORG,
          userId: USER,
          role: "owner",
        } as never)
        .onConflictDoNothing();
    }

    /** Opretter/fornyer en tidspost, så hver test starter fra samme tilstand. */
    async function seedEntry(id: string): Promise<void> {
      const existing = await client`SELECT 1 FROM "user" WHERE id = ${USER}`;
      if (existing.length === 0) {
        await db.insert(users).values({
          id: USER,
          email: `${USER}@example.test`,
          name: "Tomb Owner",
          // Admin springer abonnementsporten over, så testen kun handler om
          // sletningen. Adgangskontrol er dækket andre steder.
          role: "admin",
        } as never);
      }
      await ensureMembership();
      await db.insert(timeEntries).values({
        id,
        userId: USER,
        organizationId: ORG,
        hours: "2.00",
        date: new Date("2026-09-30T00:00:00.000Z"),
      });
    }

    async function entryExists(id: string): Promise<boolean> {
      const rows = await db
        .select({ id: timeEntries.id })
        .from(timeEntries)
        .where(eq(timeEntries.id, id));
      return rows.length > 0;
    }

    async function deleteEntry(id: string) {
      return timeRouter
        .createCaller({
          db,
          headers: new Headers(),
          session: { user: { id: USER }, activeOrganizationId: ORG },
        } as never)
        .delete({ id });
    }

    /** Køres mens `desktop_sync_tombstones` er omdøbt væk. */
    async function withoutTombstoneTable<T>(run: () => Promise<T>): Promise<T> {
      await admin.unsafe(
        `ALTER TABLE ${scratch}.desktop_sync_tombstones RENAME TO _gemt`,
      );
      try {
        return await run();
      } finally {
        await admin.unsafe(
          `ALTER TABLE ${scratch}._gemt RENAME TO desktop_sync_tombstones`,
        );
      }
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      // Klon de rigtige tabeller, så kolonner, typer og NOT NULL er dem fra
      // schemaet — ikke håndskrevede. `desktop_sync_tombstones` laves fra
      // migrationen 0128, så den ligner den Mads skal køre.
      for (const table of CLONED) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      await admin.unsafe(`
        CREATE TABLE ${scratch}.desktop_sync_tombstones (
          id text PRIMARY KEY NOT NULL,
          entity_type varchar(50) NOT NULL,
          entity_id text NOT NULL,
          user_id text NOT NULL,
          organization_id text,
          deleted_at timestamp DEFAULT now() NOT NULL
        )`);
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("positiv kontrol: med tabellen skriver den tombstone OG sletter", async () => {
      await seedEntry(ENTRY);

      expect(await deleteEntry(ENTRY)).toEqual({ success: true });
      expect(await entryExists(ENTRY)).toBe(false);
      const tombstones = await db
        .select({ entityId: desktopSyncTombstones.entityId })
        .from(desktopSyncTombstones);
      expect(tombstones.map((t) => t.entityId)).toEqual([ENTRY]);
    });

    it("uden tabellen: sletningen bliver committet, mutationen svarer success", async () => {
      // Migrationen 0128 er skrevet, men ikke kørt — som på en kasse database.
      await seedEntry(ENTRY_2);

      const result = await withoutTombstoneTable(() => deleteEntry(ENTRY_2));

      expect(result).toEqual({ success: true });
      // Kernen i fundet: før rettelsen blev transaktionen abortet af den
      // slugte 42P01, så kullet kastede og rækken lå tilbage.
      expect(await entryExists(ENTRY_2)).toBe(false);
    });
  },
);
