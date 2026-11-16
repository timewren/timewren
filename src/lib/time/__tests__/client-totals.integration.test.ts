/**
 * INTEGRATION (#1115): kundesidens timer og omsætning skal summeres i SQL over
 * ALLE kundens poster. Før blev de regnet i browseren ud fra de seneste 1000
 * poster, så en kunde med flere poster end det fik stille forkerte tal.
 *
 * Kører kun med TEST_DATABASE_URL sat (se account-deletion.test.ts).
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

import * as schema from "@/lib/db/schema";
import { timeEntries } from "@/lib/db/schema";
import { sumClientEntries } from "../client-scope";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORG = "org-kundetotal-it";
const OTHER_ORG = "org-kundetotal-anden";
const USER = "user-kundetotal-it";
const CLIENT = "00000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "00000000-0000-4000-8000-000000000002";
const PROJECT_RATED = "00000000-0000-4000-8000-000000000011";
const PROJECT_UNRATED = "00000000-0000-4000-8000-000000000012";
const PROJECT_OTHER = "00000000-0000-4000-8000-000000000013";

describe.skipIf(!TEST_DATABASE_URL)(
  "sumClientEntries (integration, #1115)",
  () => {
    const scratch = `client_totals_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of ["clients", "projects", "time_entries"]) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING DEFAULTS)`,
        );
      }
      await client.unsafe(`
        INSERT INTO clients (id, user_id, organization_id, name, default_hourly_rate) VALUES
          ('${CLIENT}', '${USER}', '${ORG}', 'Testkunde ApS', 500),
          ('${OTHER_CLIENT}', '${USER}', '${ORG}', 'Anden Kunde ApS', 900);
        INSERT INTO projects (id, user_id, organization_id, client_id, name, hourly_rate) VALUES
          ('${PROJECT_RATED}', '${USER}', '${ORG}', '${CLIENT}', 'Projekt med takst', 800),
          ('${PROJECT_UNRATED}', '${USER}', '${ORG}', '${CLIENT}', 'Projekt uden takst', NULL),
          ('${PROJECT_OTHER}', '${USER}', '${ORG}', '${OTHER_CLIENT}', 'Andet projekt', 700);
      `);
      // 1200 poster direkte på kunden med egen takst — flere end kundesidens
      // gamle grænse på 1000.
      await client.unsafe(`
        INSERT INTO time_entries (user_id, organization_id, client_id, hours, date, description, billable_rate)
        SELECT '${USER}', '${ORG}', '${CLIENT}', 1, now() - (g || ' minutes')::interval, 'x', 600
        FROM generate_series(1, 1200) g;
      `);
      await client.unsafe(`
        INSERT INTO time_entries (user_id, organization_id, client_id, project_id, hours, date, description, billable_rate, is_prepaid) VALUES
          -- projektpost uden client_id: projektets takst
          ('${USER}', '${ORG}', NULL, '${PROJECT_RATED}', 2, now(), 'x', NULL, false),
          -- projekt uden takst og ingen posttakst: kundens standardtakst
          ('${USER}', '${ORG}', NULL, '${PROJECT_UNRATED}', 3, now(), 'x', NULL, false),
          -- klippekort: tæller i timer, ikke i omsætning
          ('${USER}', '${ORG}', '${CLIENT}', NULL, 4, now(), 'x', 600, true),
          -- en anden kundes post og projekt tæller ikke med
          ('${USER}', '${ORG}', '${OTHER_CLIENT}', NULL, 5, now(), 'x', 900, false),
          ('${USER}', '${ORG}', NULL, '${PROJECT_OTHER}', 6, now(), 'x', NULL, false),
          -- en anden organisations post filtreres fra af scopet
          ('${USER}', '${OTHER_ORG}', '${CLIENT}', NULL, 7, now(), 'x', 600, false);
      `);
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("summerer alle kundens poster med postens, projektets eller kundens takst", async () => {
      const totals = await sumClientEntries(
        db,
        CLIENT,
        eq(timeEntries.organizationId, ORG),
      );
      // 1200 + 2 + 3 + 4 timer
      expect(totals.hours).toBe(1209);
      // 1200 × 600 + 2 × 800 + 3 × 500 (klippekortposten tæller ikke)
      expect(totals.revenue).toBe(1200 * 600 + 2 * 800 + 3 * 500);
    });
  },
);
