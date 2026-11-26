/**
 * INTEGRATION: en helt ny konto må ikke få "Nyheder" over velkomsten ved
 * første login med nyheder fra før kontoen fandtes (gennemgang af første
 * oplevelse, 2026-11-22). Uden et sidst-set-nyhed-id får kontoen kun nyheder
 * udgivet efter oprettelsen; med et id er reglen uændret.
 *
 * Kører kun med TEST_DATABASE_URL sat.
 */

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

import * as schema from "@/lib/db/schema";
import { changelogs, members, organizations, users } from "@/lib/db/schema";
import { changelogRouter } from "../changelog";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const DAY = 24 * 60 * 60 * 1000;
const NEW_USER = "user-changelog-new";
const OLD_USER = "user-changelog-old";
const SEEN_USER = "user-changelog-seen";
const OLD_NEWS = "00000000-0000-4000-8000-0000000c1001";
const NEW_NEWS = "00000000-0000-4000-8000-0000000c1002";

describe.skipIf(!TEST_DATABASE_URL)(
  "changelog.getUnseen — nye konti (integration)",
  () => {
    const scratch = `changelog_unseen_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    function unseenFor(userId: string) {
      return changelogRouter
        .createCaller({
          db,
          headers: new Headers(),
          session: { user: { id: userId } },
        } as never)
        .getUnseen();
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of [
        "user",
        "changelogs",
        "members",
        "organizations",
        "organization_modules",
      ]) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      const now = Date.now();
      await db.insert(changelogs).values([
        {
          id: OLD_NEWS,
          version: "1.0.0",
          title: "Gammel nyhed",
          content: "Fra før kontoen",
          publishedAt: new Date(now - 10 * DAY),
        },
        {
          id: NEW_NEWS,
          version: "1.1.0",
          title: "Ny nyhed",
          content: "Efter oprettelsen",
          publishedAt: new Date(now - 1 * DAY),
        },
      ]);
      await db.insert(users).values([
        // Oprettet i dag: begge nyheder er ældre end kontoen.
        {
          id: NEW_USER,
          email: "ny@example.invalid",
          name: "Ny",
          createdAt: new Date(now),
        },
        // Oprettet for fem dage siden: kun den nye nyhed er nyere.
        {
          id: OLD_USER,
          email: "gammel@example.invalid",
          name: "Gammel",
          createdAt: new Date(now - 5 * DAY),
        },
        // Har set den gamle nyhed; reglen for set-id er uændret.
        {
          id: SEEN_USER,
          email: "set@example.invalid",
          name: "Set",
          createdAt: new Date(now - 30 * DAY),
          lastSeenChangelogId: OLD_NEWS,
        },
      ]);
    });

    beforeAll(async () => {
      // Routerne kræver et medlemskab (org-løse kald afvises).
      await db
        .insert(organizations)
        .values({ id: "org-changelog", name: "Test", slug: "changelog-it" });
      await db.insert(members).values(
        [NEW_USER, OLD_USER, SEEN_USER].map((userId, i) => ({
          id: `m-changelog-${i}`,
          organizationId: "org-changelog",
          userId,
          role: "owner",
        })),
      );
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("viser ingen nyheder fra før kontoen fandtes", async () => {
      expect(await unseenFor(NEW_USER)).toEqual([]);
    });

    it("viser nyheder udgivet efter oprettelsen", async () => {
      const rows = await unseenFor(OLD_USER);
      expect(rows.map((r) => r.id)).toEqual([NEW_NEWS]);
    });

    it("bruger stadig sidst-sete nyhed, når den findes", async () => {
      const rows = await unseenFor(SEEN_USER);
      expect(rows.map((r) => r.id)).toEqual([NEW_NEWS]);
    });
  },
);
