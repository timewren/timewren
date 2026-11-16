/**
 * INTEGRATION (#1112, fund 26): `clients.bulkDelete` på en klient med
 * klippekort-historik. `prepaid_usage` og `generated_time_entries` peger på
 * `time_entries`, `prepaid_packages` og `recurring_time_templates` uden
 * ON DELETE, så kaskaden skal slette børnene før forældrene — ellers vælter
 * hele transaktionen med en rå FK-fejl, og klienten kan aldrig slettes.
 *
 * `LIKE … INCLUDING ALL` kopierer ikke fremmednøgler, så testen lægger de
 * relevante FK'er på scratch-tabellerne som i prod (NO ACTION).
 *
 *   TEST_DATABASE_URL=postgres://… npx vitest run <denne fil>
 */

import { inArray } from "drizzle-orm";
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
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/email/engagement", () => ({
  sendFirstClientEmail: vi.fn(),
  sendFirstTimeEntryEmail: vi.fn(),
  sendFirstProjectEmail: vi.fn(),
}));

import * as schema from "@/lib/db/schema";
import {
  clients,
  generatedTimeEntries,
  members,
  organizations,
  prepaidPackages,
  prepaidUsage,
  recurringTimeTemplates,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { clientsRouter } from "../clients";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const CLONED = [
  "user",
  "organizations",
  "members",
  "organization_modules",
  "employee_profiles",
  "clients",
  "projects",
  "time_entries",
  "prepaid_packages",
  "prepaid_usage",
  "rate_history",
  "recurring_time_templates",
  "generated_time_entries",
  "invoices",
  "activity_logs",
];

/** FK'erne uden ON DELETE, som kaskaden skal respektere (prod: NO ACTION). */
const FOREIGN_KEYS: Array<[string, string, string]> = [
  ["prepaid_usage", "time_entry_id", "time_entries"],
  ["prepaid_usage", "prepaid_package_id", "prepaid_packages"],
  ["generated_time_entries", "time_entry_id", "time_entries"],
  [
    "generated_time_entries",
    "recurring_template_id",
    "recurring_time_templates",
  ],
  ["time_entries", "prepaid_package_id", "prepaid_packages"],
  ["time_entries", "recurring_template_id", "recurring_time_templates"],
  ["time_entries", "client_id", "clients"],
  ["time_entries", "project_id", "projects"],
  ["prepaid_packages", "client_id", "clients"],
  ["projects", "client_id", "clients"],
  ["recurring_time_templates", "client_id", "clients"],
  ["recurring_time_templates", "prepaid_package_id", "prepaid_packages"],
];

const USER = "bulkdel-kk-owner";
const ORG = "bulkdel-kk-org";
const CLIENT_A = "aaaaaaa1-1111-4111-8111-111111111112";
const ENTRY_A = "ddddddd4-4444-4444-8444-444444444442";
const ENTRY_B = "eeeeeee5-5555-4555-8555-555555555552";
const PACKAGE_A = "fffffff6-6666-4666-8666-666666666662";
const TEMPLATE_A = "1234abcd-7777-4777-8777-777777777772";

describe.skipIf(!TEST_DATABASE_URL)(
  "clients.bulkDelete med klippekort-historik (integration)",
  () => {
    const scratch = `bulkdel_kk_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    async function seed(): Promise<void> {
      await db.insert(users).values({
        id: USER,
        email: "anna@example.com",
        name: "Anna Test",
        role: "admin",
      } as never);
      await db.insert(organizations).values({
        id: ORG,
        name: "Test Org",
        slug: "test-org-kk",
      } as never);
      await db.insert(members).values({
        id: "m-kk-owner",
        organizationId: ORG,
        userId: USER,
        role: "owner",
      } as never);
      await db.insert(clients).values({
        id: CLIENT_A,
        userId: USER,
        organizationId: ORG,
        name: "Testkunde ApS",
      } as never);
      await db.insert(prepaidPackages).values({
        id: PACKAGE_A,
        userId: USER,
        organizationId: ORG,
        clientId: CLIENT_A,
        name: "Klippekort A",
        totalHours: "10.00",
        usedHours: "3.00",
        remainingHours: "7.00",
        hourlyRate: "800.00",
        totalValue: "8000.00",
        purchaseDate: new Date("2026-10-01T00:00:00.000Z"),
      } as never);
      await db.insert(recurringTimeTemplates).values({
        id: TEMPLATE_A,
        userId: USER,
        organizationId: ORG,
        clientId: CLIENT_A,
        prepaidPackageId: PACKAGE_A,
        name: "Fast support",
        description: "Fast support",
        hours: "1.00",
        isPrepaid: true,
      } as never);
      await db.insert(timeEntries).values([
        {
          // Trukket på kortet
          id: ENTRY_A,
          userId: USER,
          organizationId: ORG,
          clientId: CLIENT_A,
          prepaidPackageId: PACKAGE_A,
          isPrepaid: true,
          hours: "2.00",
          date: new Date("2026-10-01T00:00:00.000Z"),
        },
        {
          // Genereret fra en fast skabelon
          id: ENTRY_B,
          userId: USER,
          organizationId: ORG,
          clientId: CLIENT_A,
          recurringTemplateId: TEMPLATE_A,
          hours: "1.00",
          date: new Date("2026-10-02T00:00:00.000Z"),
        },
      ] as never);
      await db.insert(prepaidUsage).values([
        {
          prepaidPackageId: PACKAGE_A,
          timeEntryId: ENTRY_A,
          hoursUsed: "2.00",
          valueUsed: "1600.00",
        },
        {
          // Manuelt træk uden tidspost
          prepaidPackageId: PACKAGE_A,
          timeEntryId: null,
          hoursUsed: "1.00",
          valueUsed: "800.00",
          description: "Manuelt træk",
        },
      ] as never);
      await db.insert(generatedTimeEntries).values({
        recurringTemplateId: TEMPLATE_A,
        timeEntryId: ENTRY_B,
        scheduledDate: new Date("2026-10-02T00:00:00.000Z"),
      } as never);
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of CLONED) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      for (const [table, column, target] of FOREIGN_KEYS) {
        await admin.unsafe(
          `ALTER TABLE ${scratch}."${table}" ADD FOREIGN KEY ("${column}") REFERENCES ${scratch}."${target}"("id")`,
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
      await seed();
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("sletter klienten med kort, usage-rækker og genererede poster", async () => {
      const result = await clientsRouter
        .createCaller({
          db,
          headers: new Headers(),
          session: { user: { id: USER }, activeOrganizationId: ORG },
        } as never)
        .bulkDelete({ ids: [CLIENT_A] });

      expect(result).toEqual({ success: true, count: 1 });
      expect(
        await db
          .select({ id: clients.id })
          .from(clients)
          .where(inArray(clients.id, [CLIENT_A])),
      ).toEqual([]);
      expect(
        await db
          .select({ id: timeEntries.id })
          .from(timeEntries)
          .where(inArray(timeEntries.id, [ENTRY_A, ENTRY_B])),
      ).toEqual([]);
      expect(await db.select().from(prepaidPackages)).toEqual([]);
      expect(await db.select().from(prepaidUsage)).toEqual([]);
      expect(await db.select().from(generatedTimeEntries)).toEqual([]);
      expect(await db.select().from(recurringTimeTemplates)).toEqual([]);
    });
  },
);
