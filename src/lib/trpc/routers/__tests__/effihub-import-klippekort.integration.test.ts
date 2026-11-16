/**
 * INTEGRATION (#1112, fund 25): Effihub-importen satte `isPrepaid: true` på
 * posten uden en `prepaid_usage`-række og opdaterede kortet med en
 * read-modify-write uden for en transaktion, hvis fejl blev slugt. Posten
 * blev dermed holdt ude af fakturering, men kunne aldrig refunderes, og
 * kortet blev talt dobbelt: saldoen kom allerede fra CSV'ens "Klip brugt",
 * og hver post lagde sine timer oveni.
 *
 * Nu skrives posten og dens usage-række i én transaktion. Saldoen kommer
 * kun fra "Klip brugt" (historikken er allerede forbrugt), og et lukket
 * eller udløbet kort gør aldrig den historiske tid fakturerbar.
 *
 *   TEST_DATABASE_URL=postgres://… npx vitest run <denne fil>
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

import * as schema from "@/lib/db/schema";
import {
  clients,
  members,
  organizations,
  prepaidPackages,
  prepaidUsage,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { integrationsRouter } from "../integrations";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const CLONED = [
  "user",
  "organizations",
  "members",
  "organization_modules",
  "employee_profiles",
  "clients",
  "prepaid_packages",
  "prepaid_usage",
  "time_entries",
  "activity_logs",
];

const USER = "effihub-kk-owner";
const ORG = "effihub-kk-org";
const CLIENT = "aaaaaaa1-1111-4111-8111-111111111113";
const CLIENT_NAME = "Testkunde ApS";

const CUSTOMERS_CSV = "Kunde ID;Navn\n";
const PLAN_HEADER =
  "Klippekort ID;Kunde;Klip;Klip værdi;Klip enhed;Klip brugt;Klip status;Salgspris;Udløbsdato;Klippekort navn";
const TASK_HEADER =
  "Kunde;Forbrug;Forbrugsenhed;Opgavebeskrivelse;Dato;Klippekort ID;Opgave type;Faktureringsstatus;Opgave detaljer";

// "Klip brugt" = summen af opgaverne, som i et rigtigt Effihub-eksport
function plan(status: string, used: number): string {
  return `${PLAN_HEADER}\nK1;${CLIENT_NAME};10;1;timer;${used};${status};8.000,00;---;Klippekort 10 t\n`;
}
const TASKS_CSV = `${TASK_HEADER}\n${CLIENT_NAME};02:00;timer;Support;01.10.2026;K1;Timeseddel;;\n`;

describe.skipIf(!TEST_DATABASE_URL)(
  "Effihub-import trækker klippekort atomisk (integration)",
  () => {
    const scratch = `effihub_kk_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    function runImport(status: string, used: number) {
      return integrationsRouter
        .createCaller({
          db,
          headers: new Headers(),
          session: { user: { id: USER }, activeOrganizationId: ORG },
        } as never)
        .importEffihub({
          customersCSV: CUSTOMERS_CSV,
          usersCSV: null,
          tasksCSV: TASKS_CSV,
          prepaidPlansCSV: plan(status, used),
          planTemplatesCSV: null,
          labelsCSV: null,
          billingFilter: "all",
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
      await db.insert(users).values({
        id: USER,
        email: "anna@example.com",
        name: "Anna Test",
        role: "admin",
      } as never);
      await db.insert(organizations).values({
        id: ORG,
        name: "Test Org",
        slug: "test-org-effihub",
      } as never);
      await db.insert(members).values({
        id: "m-effihub-owner",
        organizationId: ORG,
        userId: USER,
        role: "owner",
      } as never);
    });

    beforeEach(async () => {
      await admin.unsafe(`TRUNCATE ${scratch}.prepaid_usage,
        ${scratch}.time_entries, ${scratch}.prepaid_packages,
        ${scratch}.clients`);
      await db.insert(clients).values({
        id: CLIENT,
        userId: USER,
        organizationId: ORG,
        name: CLIENT_NAME,
      } as never);
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    async function expectHistoricUsage(hours: number) {
      const [pkg] = await db.select().from(prepaidPackages);
      const [entry] = await db.select().from(timeEntries);
      expect(entry.isPrepaid).toBe(true);
      expect(entry.prepaidPackageId).toBe(pkg.id);
      expect(entry.isBillable).toBe(true);
      expect(entry.isBilled).toBe(false);

      const usage = await db
        .select()
        .from(prepaidUsage)
        .where(eq(prepaidUsage.timeEntryId, entry.id));
      expect(usage).toHaveLength(1);
      expect(Number(usage[0].hoursUsed)).toBe(hours);
      expect(Number(usage[0].valueUsed)).toBe(hours * 800);
      return pkg;
    }

    it("aktivt kort: usage-række, saldoen kommer kun fra Klip brugt", async () => {
      const result = await runImport("Aktiv", 2);
      expect(result.timeEntries).toBe(1);

      const pkg = await expectHistoricUsage(2);
      // Ikke 4/6: posten er allerede med i "Klip brugt"
      expect(Number(pkg.usedHours)).toBe(2);
      expect(Number(pkg.remainingHours)).toBe(8);
      expect(pkg.isActive).toBe(true);
    });

    it("lukket kort: historikken forbliver klippekort-tid, ikke fakturerbar", async () => {
      const result = await runImport("Afsluttet", 2);
      expect(result.timeEntries).toBe(1);

      const pkg = await expectHistoricUsage(2);
      expect(Number(pkg.usedHours)).toBe(2);
      expect(Number(pkg.remainingHours)).toBe(8);
      expect(pkg.isActive).toBe(false);
    });

    it("opbrugt kort: historikken afvises ikke af blok-politikken", async () => {
      const result = await runImport("Aktiv", 10);
      expect(result.timeEntries).toBe(1);

      const pkg = await expectHistoricUsage(2);
      expect(Number(pkg.usedHours)).toBe(10);
      expect(Number(pkg.remainingHours)).toBe(0);
      expect(Number(pkg.overdraftHours)).toBe(0);
    });
  },
);
