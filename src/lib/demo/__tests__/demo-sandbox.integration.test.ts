/**
 * INTEGRATION: den offentlige demo (DEMO_MODE=1) mod det fulde schema (alle
 * FK'er og ON DELETE-regler som i prod).
 *
 * - createDemoAccount: isoleret bruger + organisation med demodata, to gange;
 * - seedDemoSandbox: de forventede antal, saldi og fakturabeløb, hurtigt;
 * - loftet over levende demobrugere;
 * - cleanupExpiredDemoUsers: sletter kun udløbne demobrugere med alle data,
 *   aldrig en rigtig bruger (isDemo false eller NULL, eller anden adresse).
 *
 * Kører kun med TEST_DATABASE_URL sat til en kasseret database med repoets
 * schema (`drizzle-kit push`, som CI's Unit Tests-job). Skriver i sin egen
 * klon af test-databasen (isolatedTestDatabase), som slettes bagefter.
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import {
  connectTestDb,
  isolatedTestDatabase,
  testPostgres,
} from "@/test/test-db";

const h = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const real = h.db as Record<string | symbol, unknown>;
        const value = real[prop];
        return typeof value === "function" ? value.bind(real) : value;
      },
    },
  ),
}));
vi.mock("@/lib/alunta", () => ({
  alunta: { subscriptions: { cancel: vi.fn(async () => ({})) } },
}));
vi.mock("@/lib/notifications/admin", () => ({ notifyAdmin: vi.fn() }));

import * as schema from "@/lib/db/schema";
import { cleanupExpiredDemoUsers } from "../cleanup";
import { createDemoAccount } from "../create-demo-account";
import { buildSandboxEntriesForTests } from "../seed-demo-sandbox";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  "offentlig demo: konto, demodata og oprydning (integration)",
  () => {
    const run = randomUUID().slice(0, 8);
    const testDb = isolatedTestDatabase();
    const pg = testPostgres({ max: 2, database: testDb.name });
    const db = drizzle(pg, { schema });
    h.db = db;

    beforeAll(async () => {
      await testDb.create();
      await connectTestDb(pg);
      // Som på demo-instansen
      vi.stubEnv("DEMO_MODE", "1");
      delete process.env.S3_ENDPOINT;
      vi.spyOn(console, "info").mockImplementation(() => {});
    });

    afterAll(async () => {
      await pg.end();
      await testDb.drop();
      vi.unstubAllEnvs();
    });

    const count = async (table: string, orgId: string) => {
      const [row] = await pg.unsafe(
        `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
        [orgId],
      );
      return row.n as number;
    };

    async function newDemo(now?: Date, locale?: Locale) {
      const result = await createDemoAccount(db as never, { now, locale });
      if (!result.ok) throw new Error("demo-loftet er nået");
      return result;
    }

    it("opretter en isoleret demokonto med ejer-org og demodata, også to gange", async () => {
      const a = await newDemo();
      const b = await newDemo(undefined, "de");
      expect(a.orgId).not.toBe(b.orgId);
      expect(a.email).toMatch(/^demo-eur-[0-9a-f]{12}@demo\.invalid$/);

      for (const acc of [a, b]) {
        const [user] = await pg`
          SELECT is_demo, "emailVerified", onboarding_completed, role, locale, default_hourly_rate
          FROM "user" WHERE id = ${acc.userId}`;
        expect(user).toMatchObject({
          is_demo: true,
          emailVerified: true,
          onboarding_completed: true,
          role: "user",
          locale: acc === a ? "en" : "de",
          default_hourly_rate: "90.00",
        });
        const memberships = await pg`
          SELECT organization_id, role FROM members WHERE user_id = ${acc.userId}`;
        expect(memberships).toEqual([
          { organization_id: acc.orgId, role: "owner" },
        ]);
        const [cred] = await pg`
          SELECT "providerId", password FROM account WHERE "userId" = ${acc.userId}`;
        expect(cred.providerId).toBe("credential");
        expect(cred.password).not.toContain(acc.password);

        // Antal i databasen = det seederen melder
        expect(await count("clients", acc.orgId)).toBe(acc.counts.clients);
        expect(await count("projects", acc.orgId)).toBe(acc.counts.projects);
        expect(await count("prepaid_packages", acc.orgId)).toBe(
          acc.counts.prepaidPackages,
        );
        expect(await count("time_entries", acc.orgId)).toBe(
          acc.counts.timeEntries,
        );
        expect(await count("tasks", acc.orgId)).toBe(acc.counts.tasks);
        expect(await count("invoices", acc.orgId)).toBe(acc.counts.invoices);
        expect(await count("rate_history", acc.orgId)).toBe(
          acc.counts.rateHistory,
        );
        // Ingen af b's rækker hører til a's org og omvendt
        const [cross] = await pg`
          SELECT count(*)::int AS n FROM time_entries
          WHERE user_id = ${acc.userId} AND organization_id <> ${acc.orgId}`;
        expect(cross.n).toBe(0);
      }
      expect(a.counts).toMatchObject({
        clients: 5,
        projects: 6,
        prepaidPackages: 3,
        prepaidUsage: 15,
        tasks: 4,
        invoices: 3,
        rateHistory: 3,
      });
    });

    it("kontoen kan logge ind med better-auth (som /api/demo/start gør)", async () => {
      const acc = await newDemo();
      const { auth } = await import("@/lib/auth");
      const { headers } = await auth.api.signInEmail({
        body: { email: acc.email, password: acc.password },
        headers: new Headers(),
        returnHeaders: true,
      });
      expect(headers.getSetCookie().join(";")).toContain("session_token=");
      const [session] = await pg`
        SELECT count(*)::int AS n FROM session WHERE "userId" = ${acc.userId}`;
      expect(session.n).toBe(1);
      const [user] = await pg`SELECT role FROM "user" WHERE id = ${acc.userId}`;
      expect(user.role).toBe("user");
    });

    it("seeder seks uger med klippekort, lav saldo og fakturaer i tre tilstande", async () => {
      // Onsdag: 42 dage = 30 hverdage + 6 mandage med intern tid + 15 træk
      const now = new Date(2026, 10, 18, 12, 0, 0);
      expect(buildSandboxEntriesForTests(now)).toHaveLength(51);

      const started = performance.now();
      const acc = await newDemo(now);
      const ms = performance.now() - started;
      expect(acc.counts.timeEntries).toBe(51);
      expect(ms).toBeLessThan(2000);

      const clientRows = await pg`
        SELECT name, email FROM clients
        WHERE organization_id = ${acc.orgId} ORDER BY name`;
      expect(clientRows.map((c) => c.name)).toEqual([
        "Greenleaf Shop",
        "Harbour Architects",
        "Hilltop Brewery",
        "Northwind Studio",
        "Saltwater Communications",
      ]);
      for (const client of clientRows) {
        expect(client.email).toMatch(/\.example$/);
      }

      const pkgs = await pg`
        SELECT p.name, p.total_hours, p.used_hours, p.remaining_hours,
               p.total_value, p.hourly_rate,
               COALESCE(SUM(u.hours_used), 0) AS usage
        FROM prepaid_packages p
        LEFT JOIN prepaid_usage u ON u.prepaid_package_id = p.id
        WHERE p.organization_id = ${acc.orgId}
        GROUP BY p.id ORDER BY p.total_hours`;
      for (const p of pkgs) {
        expect(Number(p.total_value)).toBe(
          Number(p.total_hours) * Number(p.hourly_rate),
        );
        expect(Number(p.usage)).toBeCloseTo(Number(p.used_hours));
        expect(Number(p.total_hours) - Number(p.used_hours)).toBeCloseTo(
          Number(p.remaining_hours),
        );
      }
      // Ét næsten opbrugt klippekort (10 t, 1 t tilbage)
      expect(pkgs[0]).toMatchObject({
        name: "Prepaid 10 hours",
        remaining_hours: "1.00",
        total_value: "950.00",
      });

      const inv = await pg`
        SELECT i.status, i.amount, template.currency, l.amount AS line_amount, COALESCE(SUM(t.hours * t.billable_rate), 0) AS entries,
               bool_and(t.is_billed) AS billed
        FROM invoices i
        JOIN invoice_templates template ON template.id = i.template_id
        JOIN invoice_lines l ON l.invoice_id = i.id
        LEFT JOIN time_entries t ON t.invoice_id = i.id
        WHERE i.organization_id = ${acc.orgId}
        GROUP BY i.id, template.currency, l.amount ORDER BY i.status`;
      expect(inv.map((i) => i.status)).toEqual(["draft", "paid", "sent"]);
      for (const i of inv) {
        expect(i.currency).toBe("EUR");
        expect(i.amount).toBe(i.line_amount);
        expect(Number(i.amount)).toBeGreaterThan(0);
        expect(Number(i.amount)).toBeCloseTo(Number(i.entries));
        expect(i.billed).toBe(i.status !== "draft");
      }

      // Tidsposterne dækker de seneste seks uger frem til i dag
      const [span] = await pg`
        SELECT min(date) AS first, max(date) AS last FROM time_entries
        WHERE organization_id = ${acc.orgId}`;
      const days = (d: Date | string) =>
        (now.getTime() - new Date(d).getTime()) / 86_400_000;
      expect(days(span.first)).toBeLessThanOrEqual(42);
      expect(days(span.first)).toBeGreaterThan(35);
      expect(days(span.last)).toBeLessThan(1);
    });

    it("siger nej, når loftet over levende demobrugere er nået", async () => {
      const [live] = await pg`
        SELECT count(*)::int AS n FROM "user"
        WHERE is_demo = true AND email LIKE '%@demo.invalid'`;
      const result = await createDemoAccount(db as never, {
        maxLiveUsers: live.n,
      });
      expect(result).toEqual({ ok: false, reason: "full" });
      const [after] = await pg`
        SELECT count(*)::int AS n FROM "user"
        WHERE is_demo = true AND email LIKE '%@demo.invalid'`;
      expect(after.n).toBe(live.n);
    });

    it("oprydningen sletter kun udløbne demobrugere og alle deres data", async () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const expired = await newDemo(old);
      const fresh = await newDemo();

      // Rigtige brugere, der aldrig må røres, også gamle og på demodomænet
      const real = async (
        name: string,
        isDemo: boolean | null,
        email: string,
      ) => {
        const id = `demo-it-${run}-${name}`;
        await pg`
          INSERT INTO "user" (id, email, name, "emailVerified", is_demo, "createdAt")
          VALUES (${id}, ${email}, ${`Testperson ${name}`}, true, ${isDemo}, ${old.toISOString()})`;
        const orgId = `${id}-org`;
        await pg`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Testkunde ApS', ${orgId})`;
        await pg`INSERT INTO members (id, organization_id, user_id, role) VALUES (${`${orgId}-m`}, ${orgId}, ${id}, 'owner')`;
        await pg`INSERT INTO clients (name, user_id, organization_id) VALUES ('Testkunde ApS', ${id}, ${orgId})`;
        return id;
      };
      const notDemo = await real("false", false, `false-${run}@demo.invalid`);
      const nullDemo = await real("null", null, `null-${run}@demo.invalid`);
      const salesDemo = await real("sales", true, `anna-${run}@example.com`);

      const result = await cleanupExpiredDemoUsers(db as never);
      expect(result.failed).toBe(0);
      expect(result.deleted).toBeGreaterThanOrEqual(1);

      const [gone] =
        await pg`SELECT 1 FROM "user" WHERE id = ${expired.userId}`;
      expect(gone).toBeUndefined();
      const [org] =
        await pg`SELECT 1 FROM organizations WHERE id = ${expired.orgId}`;
      expect(org).toBeUndefined();
      for (const table of [
        "clients",
        "projects",
        "prepaid_packages",
        "time_entries",
        "tasks",
        "invoices",
        "invoice_templates",
        "rate_history",
      ]) {
        expect(await count(table, expired.orgId), table).toBe(0);
      }
      const [usage] = await pg`
        SELECT count(*)::int AS n FROM prepaid_usage u
        LEFT JOIN prepaid_packages p ON p.id = u.prepaid_package_id
        WHERE p.id IS NULL`;
      expect(usage.n).toBe(0);

      // Den friske demobruger og alle rigtige brugere består med deres data
      for (const id of [fresh.userId, notDemo, nullDemo, salesDemo]) {
        const [row] = await pg`SELECT email FROM "user" WHERE id = ${id}`;
        expect(row, id).toBeDefined();
      }
      expect(await count("clients", fresh.orgId)).toBe(5);
      for (const id of [notDemo, nullDemo, salesDemo]) {
        expect(await count("clients", `${id}-org`)).toBe(1);
      }
    });
  },
);
