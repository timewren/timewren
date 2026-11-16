/**
 * INTEGRATION: `clients.bulkDelete` sletter fire rækketyper i kaskade, og alle
 * fire skal have en tombstone — ellers beholder skrivebordsenheden klienten,
 * projekterne, tidsposterne og klippekortene i sin lokale db, selvom serveren
 * har slettet dem. Der var ingen `RETURNING` på kaskaden, så de slettede id'er
 * var ikke engang kendt uden for transaktionen.
 *
 * Håndlavede db-mocks kan ikke se det (samfejlklasse som
 * sync-tombstones.integration.test.ts): en mock har intet `.transaction`, så
 * intet i den kan rulle tilbage, og den er ikke Postgres' `DELETE ..
 * RETURNING`. Derfor kører denne fil mod en rigtig Postgres med et klonet,
 * minimalt schema i en scratch-schema.
 *
 * Sæt TEST_DATABASE_URL til en kasseret database med repoets schema
 * (`DATABASE_URL=… npx drizzle-kit push --force`), så klonerne findes:
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:unit
 */

import { eq, inArray } from "drizzle-orm";
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

// Analytics og velkomstmail er ikke emnet her, og de ville åbne en connection til
// DATABASE_URL i stedet for testens.
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/email/engagement", () => ({
  sendFirstClientEmail: vi.fn(),
  sendFirstTimeEntryEmail: vi.fn(),
  sendFirstProjectEmail: vi.fn(),
}));

import * as schema from "@/lib/db/schema";
import {
  clients,
  desktopSyncTombstones,
  members,
  organizations,
  prepaidPackages,
  projects,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { clientsRouter } from "../clients";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Tabeller `clients.bulkDelete` rører. `desktop_sync_tombstones` laves fra
 * migrationen 0128, så den ligner den Mads skal køre.
 */
const CLONED = [
  "user",
  // `members`/`organizations` læses af trpc's org-opløsning før mutationen.
  "organizations",
  "members",
  "organization_modules",
  "employee_profiles",
  "clients",
  "projects",
  "time_entries",
  "prepaid_packages",
  // Kaskaden sletter også disse to; de får ingen tombstone (de synkede ikke
  // til skrivebordet), men koden rører dem.
  "rate_history",
  "recurring_time_templates",
  // Børn uden ON DELETE, som kaskaden rydder før forældrene (#1112).
  "prepaid_usage",
  "generated_time_entries",
  "invoices",
  "activity_logs",
];

const USER = "bulkdel-owner";
const ORG = "bulkdel-org";
const CLIENT_A = "aaaaaaa1-1111-4111-8111-111111111111";
const CLIENT_B = "bbbbbbb2-2222-4222-8222-222222222222";
const PROJECT_A = "ccccccc3-3333-4333-8333-333333333333";
const ENTRY_A = "ddddddd4-4444-4444-8444-444444444444";
const ENTRY_B = "eeeeeee5-5555-4555-8555-555555555555";
const PACKAGE_A = "fffffff6-6666-4666-8666-666666666666";

describe.skipIf(!TEST_DATABASE_URL)(
  "clients.bulkDelete skriver tombstones (integration)",
  () => {
    const scratch = `bulkdel_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    // KUN scratch: ellers ville `public` give testen tabeller at finde.
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

    async function seed(): Promise<void> {
      await admin.unsafe(`TRUNCATE ${scratch}.clients, ${scratch}.projects,
        ${scratch}.time_entries, ${scratch}.prepaid_packages,
        ${scratch}.desktop_sync_tombstones`);

      const existing = await client`SELECT 1 FROM "user" WHERE id = ${USER}`;
      if (existing.length === 0) {
        await db.insert(users).values({
          id: USER,
          email: `${USER}@example.test`,
          name: "Bulk Owner",
          // Admin springer abonnements- og modulporten over, så testen kun
          // handler om kaskaden. Adgangskontrol er dækket andre steder.
          role: "admin",
        } as never);
      }
      await ensureMembership();

      await db.insert(clients).values([
        { id: CLIENT_A, userId: USER, organizationId: ORG, name: "Kunde A" },
        // B skal overleve: kaskaden skal ikke ramme en klient uden for input.
        { id: CLIENT_B, userId: USER, name: "Kunde B" },
      ] as never);
      await db.insert(projects).values({
        id: PROJECT_A,
        userId: USER,
        organizationId: ORG,
        clientId: CLIENT_A,
        name: "Projekt A",
      } as never);
      await db.insert(timeEntries).values([
        {
          id: ENTRY_A,
          userId: USER,
          organizationId: ORG,
          clientId: CLIENT_A,
          projectId: PROJECT_A,
          hours: "2.00",
          date: new Date("2026-10-01T00:00:00.000Z"),
        },
        {
          // Kun via projektet, ingen clientId — den kaskadevej, der før krævede
          // at projekt-id'erne blev hentet først.
          id: ENTRY_B,
          userId: USER,
          organizationId: ORG,
          projectId: PROJECT_A,
          hours: "1.00",
          date: new Date("2026-10-01T00:00:00.000Z"),
        },
      ] as never);
      await db.insert(prepaidPackages).values({
        id: PACKAGE_A,
        userId: USER,
        organizationId: ORG,
        clientId: CLIENT_A,
        name: "Klippekort A",
        totalHours: "10.00",
        usedHours: "0.00",
        remainingHours: "10.00",
        hourlyRate: "800.00",
        totalValue: "8000.00",
        purchaseDate: new Date("2026-10-01T00:00:00.000Z"),
      } as never);
    }

    async function remaining(table: { id: unknown }, ids: string[]) {
      return (
        db
          // biome-ignore lint/suspicious/noExplicitAny: generisk nødvendig her
          .select({ id: (table as any).id })
          // biome-ignore lint/suspicious/noExplicitAny: generisk nødvendig her
          .from(table as any)
          // biome-ignore lint/suspicious/noExplicitAny: generisk nødvendig her
          .where(inArray((table as any).id, ids))
      );
    }

    /** Mutationen med en aktiv organisation i sessionen — orgless-gaten
     * kræver nu medlemskab for al organisationsdata (#848). */
    function orgBulkDelete(ids: string[]) {
      return clientsRouter
        .createCaller({
          db,
          headers: new Headers(),
          session: { user: { id: USER }, activeOrganizationId: ORG },
        } as never)
        .bulkDelete({ ids });
    }

    async function tombstones() {
      return db
        .select({
          entityType: desktopSyncTombstones.entityType,
          entityId: desktopSyncTombstones.entityId,
          userId: desktopSyncTombstones.userId,
          organizationId: desktopSyncTombstones.organizationId,
        })
        .from(desktopSyncTombstones);
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

    it("skriver en tombstone for alle fire slettede rækketyper", async () => {
      await seed();

      expect(await orgBulkDelete([CLIENT_A])).toEqual({
        success: true,
        count: 1,
      });

      // Rækkerne er væk — også den tidspost der kun hang på projektet.
      expect(await remaining(clients, [CLIENT_A, CLIENT_B])).toEqual([
        { id: CLIENT_B },
      ]);
      expect(await remaining(projects, [PROJECT_A])).toEqual([]);
      expect(await remaining(timeEntries, [ENTRY_A, ENTRY_B])).toEqual([]);
      expect(await remaining(prepaidPackages, [PACKAGE_A])).toEqual([]);

      // …og hver slettet række hører om i sin ejers enhed. Klippekort-typen er
      // `klippekort`, ikke `prepaid_package` — det er det navn pull sender.
      expect((await tombstones()).toSorted(byType)).toEqual([
        {
          entityType: "client",
          entityId: CLIENT_A,
          userId: USER,
          organizationId: ORG,
        },
        {
          entityType: "klippekort",
          entityId: PACKAGE_A,
          userId: USER,
          organizationId: ORG,
        },
        {
          entityType: "project",
          entityId: PROJECT_A,
          userId: USER,
          organizationId: ORG,
        },
        {
          entityType: "time_entry",
          entityId: ENTRY_A,
          userId: USER,
          organizationId: ORG,
        },
        {
          entityType: "time_entry",
          entityId: ENTRY_B,
          userId: USER,
          organizationId: ORG,
        },
      ]);
    });

    it("uden tabellen: kaskaden bliver committet, mutationen svarer success", async () => {
      await seed();

      // Migrationen 0128 er skrevet, men ikke kørt — som på en kasse database.
      const result = await withoutTombstoneTable(() =>
        orgBulkDelete([CLIENT_A]),
      );

      expect(result).toEqual({ success: true, count: 1 });
      // Kernen i O16 + O18: skriverne ligger UDEN FOR transaktionen, så en
      // slugt 42P01 kan ikke rulle kaskaden tilbage.
      expect(await remaining(clients, [CLIENT_A, CLIENT_B])).toEqual([
        { id: CLIENT_B },
      ]);
      expect(await remaining(projects, [PROJECT_A])).toEqual([]);
      expect(await remaining(timeEntries, [ENTRY_A, ENTRY_B])).toEqual([]);
      expect(await remaining(prepaidPackages, [PACKAGE_A])).toEqual([]);
    });

    it("skriver nøglen på rækkens ejer, ikke på den slettendes", async () => {
      await seed();
      // En org-ejer sletter en klient, hvis tidsposter tilhører en kollega.
      // Kaskaden filtrerer på organisationen, så kollegas rækker falder med —
      // og det er kollegas enhed der skal ryddes, ikke ejerens.
      const OTHER = "bulkdel-other";
      const orgExists =
        await client`SELECT 1 FROM organizations WHERE id = ${ORG}`;
      if (orgExists.length === 0) {
        await db.insert(organizations).values({
          id: ORG,
          name: "Test Org",
          slug: "test-org",
        } as never);
      }
      for (const [memberId, memberUserId, role] of [
        ["m-owner", USER, "owner"],
        ["m-other", OTHER, "member"],
      ] as const) {
        const memberUser =
          await client`SELECT 1 FROM "user" WHERE id = ${memberUserId}`;
        if (memberUser.length === 0) {
          await db.insert(users).values({
            id: memberUserId,
            email: `${memberUserId}@example.test`,
            name: memberUserId,
            role: "admin",
          } as never);
        }
        await db
          .insert(members)
          .values({
            id: memberId,
            organizationId: ORG,
            userId: memberUserId,
            role,
          } as never)
          .onConflictDoNothing();
      }

      // Rækkerne flyttes ind i orgen, og ENTRY_B tilhører kollegaen.
      await db
        .update(clients)
        .set({ organizationId: ORG })
        .where(inArray(clients.id, [CLIENT_A, CLIENT_B]));
      await db
        .update(projects)
        .set({ organizationId: ORG })
        .where(eq(projects.id, PROJECT_A));
      await db
        .update(prepaidPackages)
        .set({ organizationId: ORG })
        .where(eq(prepaidPackages.id, PACKAGE_A));
      await db
        .update(timeEntries)
        .set({ organizationId: ORG })
        .where(eq(timeEntries.id, ENTRY_A));
      await db
        .update(timeEntries)
        .set({ organizationId: ORG, userId: OTHER })
        .where(eq(timeEntries.id, ENTRY_B));

      await orgBulkDelete([CLIENT_A]);

      const written = await tombstones();
      // Kernen: nøglen skal pege på ejeren af RÆKKEN.
      expect(written.find((t) => t.entityId === ENTRY_B)?.userId).toBe(OTHER);
      expect(written.find((t) => t.entityId === ENTRY_A)?.userId).toBe(USER);
      expect(written.find((t) => t.entityId === CLIENT_A)?.userId).toBe(USER);
      // Og den er stadig synlig for hele orgen, så ingen enhed sidder med en
      // slettet post liggende.
      expect(written.find((t) => t.entityId === ENTRY_B)?.organizationId).toBe(
        ORG,
      );
    });
  },
);

function byType(
  a: { entityType: string; entityId: string },
  b: { entityType: string; entityId: string },
): number {
  return `${a.entityType}${a.entityId}`.localeCompare(
    `${b.entityType}${b.entityId}`,
  );
}
