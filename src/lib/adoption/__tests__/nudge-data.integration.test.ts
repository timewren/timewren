import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

// Undgå DB-forbindelse ved import af server-moduler; testen giver sin egen db
vi.mock("@/lib/db", () => ({ db: {} }));

import * as dbSchema from "@/lib/db/schema";
import {
  loadInvoiceNudges,
  loadInvoicePreview,
  loadPrepaidSuggestions,
} from "../nudge-data";

// Nudge-loaderne (#89/#90) mod en rigtig Postgres: SQL-aggregaterne, scoping
// og datoerne. Uden TEST_DATABASE_URL skippes blokken (samme mønster som
// holidays/load.integration.test.ts). Solo-scope (ingen org), så
// rolle-/klientadgangsopslagene kortsluttes.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const USER = "u-solo";
const OTHER_USER = "u-other";
const C_BIG = "11111111-1111-4111-8111-111111111111";
const C_RECENT = "22222222-2222-4222-8222-222222222222";
const C_MONTHLY = "33333333-3333-4333-8333-333333333333";
const C_INTERNAL = "44444444-4444-4444-8444-444444444444";
const C_OTHER = "55555555-5555-4555-8555-555555555555";
const P_WEB = "66666666-6666-4666-8666-666666666666";

describe.skipIf(!TEST_DATABASE_URL)("nudge-data (integration)", () => {
  const schema = `nudges_${Date.now()}`;
  const admin = testPostgres({ max: 1 });
  let pool: ReturnType<typeof postgres>;
  let db: Parameters<typeof loadInvoiceNudges>[0];

  beforeAll(async () => {
    await connectTestDb(admin);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    // Kun de kolonner loaderne læser
    await admin.unsafe(`
      CREATE TABLE ${schema}."user" (
        id text PRIMARY KEY,
        dismissed_banners text[] DEFAULT '{}'
      );
      CREATE TABLE ${schema}.clients (
        id uuid PRIMARY KEY,
        name varchar(255) NOT NULL,
        user_id text NOT NULL,
        organization_id text,
        default_billable boolean DEFAULT true NOT NULL,
        default_hourly_rate numeric(10,2),
        is_archived boolean DEFAULT false
      );
      CREATE TABLE ${schema}.projects (
        id uuid PRIMARY KEY,
        name varchar(255) NOT NULL,
        client_id uuid
      );
      CREATE TABLE ${schema}.time_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        organization_id text,
        client_id uuid,
        project_id uuid,
        hours numeric(5,2) NOT NULL,
        billable_rate numeric(10,2),
        date timestamp NOT NULL,
        is_billed boolean DEFAULT false,
        is_billable boolean DEFAULT true,
        is_prepaid boolean DEFAULT false,
        approval_status varchar(20) DEFAULT 'not_required' NOT NULL
      );
      CREATE TABLE ${schema}.invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL,
        user_id text NOT NULL,
        organization_id text,
        kind varchar(20) DEFAULT 'invoice' NOT NULL,
        status varchar(50) DEFAULT 'draft',
        issue_date timestamp NOT NULL
      );
      CREATE TABLE ${schema}.prepaid_packages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL,
        is_active boolean DEFAULT true,
        is_archived boolean DEFAULT false
      );
    `);
    pool = testPostgres({
      max: 2,
      connection: { search_path: schema },
    });
    await connectTestDb(pool);
    db = drizzle(pool, { schema: dbSchema }) as unknown as typeof db;
  });

  afterAll(async () => {
    await pool?.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  beforeEach(async () => {
    // Kun Date — postgres-klientens timere skal køre normalt
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T10:00:00Z"));

    const entry = (
      client: string | null,
      date: string,
      hours: number,
      extra: Partial<{
        project: string;
        rate: number | null;
        user: string;
        billed: boolean;
        billable: boolean | null;
        prepaid: boolean;
        approval: string;
      }> = {},
    ) =>
      `('${extra.user ?? USER}', ${client ? `'${client}'` : "NULL"}, ${
        extra.project ? `'${extra.project}'` : "NULL"
      }, ${hours}, ${extra.rate === undefined ? 800 : extra.rate === null ? "NULL" : extra.rate}, '${date}', ${
        extra.billed ?? false
      }, ${extra.billable === undefined ? true : extra.billable === null ? "NULL" : extra.billable}, ${
        extra.prepaid ?? false
      }, '${extra.approval ?? "not_required"}')`;

    await admin.unsafe(`
      DELETE FROM ${schema}.time_entries;
      DELETE FROM ${schema}.invoices;
      DELETE FROM ${schema}.prepaid_packages;
      DELETE FROM ${schema}.projects;
      DELETE FROM ${schema}.clients;
      DELETE FROM ${schema}."user";
      INSERT INTO ${schema}."user" (id) VALUES ('${USER}'), ('${OTHER_USER}');
      INSERT INTO ${schema}.clients (id, name, user_id, default_billable, default_hourly_rate) VALUES
        ('${C_BIG}', 'Stor Kunde', '${USER}', true, NULL),
        ('${C_RECENT}', 'Nyfaktureret', '${USER}', true, NULL),
        ('${C_MONTHLY}', 'Fast Kunde', '${USER}', true, 650),
        ('${C_INTERNAL}', 'Intern', '${USER}', false, NULL),
        ('${C_OTHER}', 'Andens Kunde', '${OTHER_USER}', true, NULL);
      INSERT INTO ${schema}.projects (id, name, client_id) VALUES
        ('${P_WEB}', 'Hjemmeside', '${C_BIG}');
      INSERT INTO ${schema}.time_entries
        (user_id, client_id, project_id, hours, billable_rate, date, is_billed, is_billable, is_prepaid, approval_status)
      VALUES
        -- Stor Kunde: 12 t ufaktureret, ældste 2026-08-01; én post kun via projektet
        ${entry(C_BIG, "2026-08-01", 4)},
        ${entry(null, "2026-09-15", 6, { project: P_WEB })},
        ${entry(C_BIG, "2026-09-30", 2, { rate: null })},
        -- tæller ikke: faktureret, ikke-fakturerbar, klippekort, afventer godkendelse
        ${entry(C_BIG, "2026-09-01", 50, { billed: true })},
        ${entry(C_BIG, "2026-09-02", 50, { billable: false })},
        ${entry(C_BIG, "2026-09-03", 50, { prepaid: true })},
        ${entry(C_BIG, "2026-09-04", 50, { approval: "pending" })},
        -- Nyfaktureret: 10 t, men faktura for 10 dage siden
        ${entry(C_RECENT, "2026-07-01", 10)},
        -- Fast Kunde: 3-5 t i hver af jul/aug/sep (fakturerede tæller i historikken)
        ${entry(C_MONTHLY, "2026-07-10", 3, { billed: true })},
        ${entry(C_MONTHLY, "2026-08-10", 4, { billed: true })},
        ${entry(C_MONTHLY, "2026-09-10", 5, { rate: null })},
        -- Intern kunde og anden brugers tid må aldrig dukke op
        ${entry(C_INTERNAL, "2026-07-01", 40)},
        ${entry(C_OTHER, "2026-07-01", 40, { user: OTHER_USER })};
      INSERT INTO ${schema}.invoices (client_id, user_id, kind, status, issue_date) VALUES
        ('${C_RECENT}', '${USER}', 'invoice', 'sent', '2026-09-22 09:00:00'),
        -- slettet kladde og kreditnota tæller ikke som "sidste faktura"
        ('${C_BIG}', '${USER}', 'invoice', 'deleted', '2026-09-30 09:00:00'),
        ('${C_BIG}', '${USER}', 'credit_note', 'sent', '2026-09-30 09:00:00');
    `);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const scope = { userId: USER, orgId: null };

  it("faktura-nudge: kun kunder over tærsklerne, i eget scope", async () => {
    const nudges = await loadInvoiceNudges(db, scope, { limit: 10 });
    expect(nudges.map((n) => n.clientId)).toEqual([C_BIG]);
    expect(nudges[0]).toMatchObject({
      clientName: "Stor Kunde",
      hours: 12,
      value: 8000,
      oldestUnbilledDate: "2026-08-01",
      lastInvoiceDate: null,
      since: "oldest_entry",
      daysSince: 62,
    });
  });

  it("faktura-nudge: snoozet kunde filtreres fra, og snooze udløber", async () => {
    await admin.unsafe(
      `UPDATE ${schema}."user" SET dismissed_banners = ARRAY['nudge:invoice:${C_BIG}:2026-11-01'] WHERE id = '${USER}'`,
    );
    expect(await loadInvoiceNudges(db, scope, { limit: 10 })).toEqual([]);
    // 1/11: snoozen er udløbet. Nu er der også gået 30 dage for de andre
    // kunder, så kun tilstedeværelsen af C_BIG tjekkes.
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    expect(
      (await loadInvoiceNudges(db, scope, { limit: 10 })).map(
        (n) => n.clientId,
      ),
    ).toContain(C_BIG);
  });

  it("forhåndsvisning: grupperet pr. projekt med præcis de fakturerbare poster", async () => {
    const preview = await loadInvoicePreview(db, scope, {
      clientId: C_BIG,
      period: "all",
    });
    expect(preview?.clientName).toBe("Stor Kunde");
    expect(preview?.entryCount).toBe(3);
    expect(preview?.totalHours).toBe(12);
    expect(preview?.totalAmount).toBe(8000);
    expect(preview?.hoursWithoutRate).toBe(2);
    expect(preview?.firstDate).toBe("2026-08-01");
    expect(preview?.lastDate).toBe("2026-09-30");
    expect(preview?.groups.map((g) => [g.label, g.hours])).toEqual([
      ["Hjemmeside", 6],
      ["Direkte tid", 6],
    ]);
  });

  it("forhåndsvisning: periodefilter og fremmed kunde", async () => {
    const lastMonth = await loadInvoicePreview(db, scope, {
      clientId: C_BIG,
      period: "last_month",
    });
    expect(lastMonth?.entryCount).toBe(2);
    expect(lastMonth?.firstDate).toBe("2026-09-15");
    expect(
      await loadInvoicePreview(db, scope, { clientId: C_OTHER, period: "all" }),
    ).toBeNull();
  });

  it("klippekort-forslag: fast månedlig tid, historisk sats", async () => {
    const suggestions = await loadPrepaidSuggestions(db, scope, { limit: 10 });
    expect(suggestions.map((s) => s.clientId)).toEqual([C_MONTHLY]);
    // 12 t over 3 mdr → 15-timers pakke; sats = 5600 kr / 7 t med sats
    expect(suggestions[0]).toMatchObject({
      clientName: "Fast Kunde",
      hours: 15,
      hourlyRate: 800,
      avgMonthlyHours: 4,
    });
  });

  it("klippekort-forslag: ikke når kunden har et aktivt klippekort eller har afvist", async () => {
    await admin.unsafe(
      `INSERT INTO ${schema}.prepaid_packages (client_id) VALUES ('${C_MONTHLY}')`,
    );
    expect(await loadPrepaidSuggestions(db, scope, { limit: 10 })).toEqual([]);
    await admin.unsafe(`
      UPDATE ${schema}.prepaid_packages SET is_active = false;
      UPDATE ${schema}."user" SET dismissed_banners = ARRAY['nudge:prepaid:${C_MONTHLY}'] WHERE id = '${USER}';
    `);
    expect(await loadPrepaidSuggestions(db, scope, { limit: 10 })).toEqual([]);
  });
});
