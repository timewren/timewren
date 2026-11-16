/**
 * INTEGRATION: `extension.createTimeEntry` må aldrig give en bruger en
 * *anden* brugers tidsregistrering tilbage.
 *
 * O15: gentagelsen efter en tabt respons slår posten op på `clientEntryId`
 * uden `userId`. `time_entries_client_entry_id_uq` er et globalt indeks, så
 * en nøgle der allerede findes hos en anden bruger låser insertet
 * (`onConflictDoNothing`), og opslaget returnerede den andens post-id.
 *
 * Håndlavede db-mocks kan ikke se det: en mock har ingen reel
 * `onConflictDoNothing` på et unikt indeks, så den kan ikke få to brugere til
 * at kollidere. Derfor kører denne fil mod en rigtig Postgres med et klonet,
 * minimalt schema i en scratch-schema.
 *
 * Sæt TEST_DATABASE_URL til en kasseret database med repoets schema
 * (`DATABASE_URL=… npx drizzle-kit push --force`), så klonerne findes:
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:unit
 */

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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

// Analytics ville åbne en connection til DATABASE_URL i stedet for testens.
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));

import * as schema from "@/lib/db/schema";
import { extensionTokens, timeEntries, users } from "@/lib/db/schema";
import { hashToken } from "@/lib/security/token-hash";
import { extensionRouter } from "../extension";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Tabeller `createTimeEntry` rører. Ingen org: begge brugere er solo. */
const CLONED = [
  "user",
  "members",
  "organizations",
  "extension_tokens",
  "time_entries",
  "clients",
  "projects",
  "tasks",
  "timer_states",
];

const USER_A = "ext-idem-a";
const USER_B = "ext-idem-b";
const TOKEN_A = "token-ext-idem-a";
const TOKEN_B = "token-ext-idem-b";
const CLIENT_ENTRY_ID = "99999999-9999-4999-8999-999999999999";

describe("extension.createTimeEntry brugerscoping (#760)", () => {
  function fixture() {
    const rows: Record<string, unknown>[] = [];
    let currentUser = USER_A;
    const dialect = new PgDialect();
    const db = {
      query: {
        members: { findMany: async () => [] },
        extensionTokens: {
          findFirst: async () => ({ id: currentUser, userId: currentUser }),
        },
        timeEntries: {
          findFirst: async ({ where }: { where: SQL }) => {
            const params = dialect.sqlToQuery(where).params;
            return rows.find(
              (row) =>
                params.includes(row.clientEntryId) &&
                params.includes(row.userId),
            );
          },
        },
      },
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              if (
                rows.some((row) => row.clientEntryId === values.clientEntryId)
              )
                return [];
              const row = { ...values, id: `entry-${rows.length}` };
              rows.push(row);
              return [row];
            },
          }),
        }),
      }),
      transaction: async (fn: (tx: unknown) => unknown): Promise<unknown> =>
        fn(db),
    };
    const create = (userId: string) => {
      currentUser = userId;
      return extensionRouter
        .createCaller({ db, headers: new Headers() } as never)
        .createTimeEntry({
          token: "fixture-token",
          description: "Test",
          hours: 1,
          date: "2026-10-01",
          clientEntryId: CLIENT_ENTRY_ID,
        });
    };
    return { rows, create };
  }

  it("opretter hver brugers række og genfinder deres gentagelser", async () => {
    const { rows, create } = fixture();
    const a = await create(USER_A);
    const b = await create(USER_B);
    expect(a.id).not.toBe(b.id);
    expect((await create(USER_A)).id).toBe(a.id);
    expect((await create(USER_B)).id).toBe(b.id);
    expect(rows).toHaveLength(2);
  });

  it("genfinder ældre rå UUID'er uden at give dem til en anden bruger", async () => {
    const { rows, create } = fixture();
    rows.push({ id: "legacy", userId: USER_A, clientEntryId: CLIENT_ENTRY_ID });
    expect((await create(USER_A)).id).toBe("legacy");
    expect((await create(USER_B)).id).not.toBe("legacy");
    expect(rows).toHaveLength(2);
  });
});

describe.skipIf(!TEST_DATABASE_URL)(
  "extension.createTimeEntry idempotens pr. bruger (integration)",
  () => {
    const scratch = `ext_idem_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    // KUN scratch: ellers ville `public` give testen tabeller at finde.
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    async function seed(): Promise<void> {
      await admin.unsafe(
        `TRUNCATE ${scratch}.extension_tokens, ${scratch}.time_entries`,
      );

      for (const [id, email, name] of [
        [USER_A, "a@example.test", "Bruger A"],
        [USER_B, "b@example.test", "Bruger B"],
      ] as const) {
        const existing = await client`SELECT 1 FROM "user" WHERE id = ${id}`;
        if (existing.length === 0) {
          await db.insert(users).values({
            id,
            email,
            name,
            role: "admin",
          } as never);
        }
      }

      await db
        .insert(extensionTokens)
        .values([
          {
            userId: USER_A,
            // Kun hashen gemmes (#725); opslaget sker på tokenHash.
            tokenHash: hashToken(TOKEN_A),
            name: "Token A",
            isRevoked: false,
          },
          {
            userId: USER_B,
            // Kun hashen gemmes (#725); opslaget sker på tokenHash.
            tokenHash: hashToken(TOKEN_B),
            name: "Token B",
            isRevoked: false,
          },
        ] as never)
        .onConflictDoNothing();
    }

    function create(token: string) {
      return extensionRouter
        .createCaller({ db, headers: new Headers() } as never)
        .createTimeEntry({
          token,
          description: "Auto-tracket",
          hours: 1,
          date: "2026-10-01",
          clientEntryId: CLIENT_ENTRY_ID,
        });
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of CLONED) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("en gentagelse giver den samem post tilbage", async () => {
      await seed();

      const first = await create(TOKEN_A);
      expect(first.success).toBe(true);

      // Offline-køen sender igen efter tabt svar: samme nøgle, ingen dublet.
      const replay = await create(TOKEN_A);
      expect(replay).toEqual({ id: first.id, success: true });

      const rows = await db.select().from(timeEntries);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(USER_A);
    });

    it("samme nøgle hos en anden bruger opretter en selvstændig post", async () => {
      await seed();

      const a = await create(TOKEN_A);
      expect(a.success).toBe(true);

      // B bruger den samme nøgle. Det globale unique-indeks låser Bs insert,
      // så den gamle kode svarede med A's post-id.
      const b = await create(TOKEN_B);
      expect(b.success).toBe(true);
      expect(b.id).not.toBe(a.id);

      const rows = await db.select().from(timeEntries);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.userId).sort()).toEqual([USER_A, USER_B]);
    });
  },
);
