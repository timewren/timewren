import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { db as DbHandle } from "@/lib/db";
import * as dbSchema from "@/lib/db/schema";
import {
  clients,
  invoices,
  prepaidPackages,
  projects,
  recurringInvoiceRuns,
  recurringInvoices,
  subscriptions,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { renewPackageInTx } from "@/lib/prepaid/renew-package";
import { copenhagenDayStart, toCopenhagenDateStr } from "@/lib/time/copenhagen";
import { connectTestDb, testPostgres } from "@/test/test-db";
import { generateRecurringInvoiceInTx } from "../generate";
import { syncPrepaidLinkedRecurringInvoice } from "../prepaid-link";
import { runDueRecurringInvoice } from "../run";

// Gentagne fakturaer (#198) mod en rigtig Postgres: idempotens (samme periode
// giver aldrig to kladder — heller ikke ved samtidige kørsler), interval-
// rytmen 31/1 → 28/2 → 31/3, registreret tid i perioden og koblingen til
// klippekort-fornyelsen. Hele skemaet bygges fra Drizzle-definitionen i et
// eget Postgres-schema. Uden TEST_DATABASE_URL skippes blokken.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type Db = typeof DbHandle;

describe.skipIf(!TEST_DATABASE_URL)("gentagne fakturaer (integration)", () => {
  const schemaName = `recurring_inv_${Date.now()}`;
  const admin = testPostgres({
    max: 1,
    onnotice: () => {},
  });
  let pool: ReturnType<typeof postgres>;
  let db: Db;

  const USER = "user-rec-1";
  let clientId: string;
  let projectId: string;

  beforeAll(async () => {
    await connectTestDb(admin);
    const { generateDrizzleJson, generateMigration } = await import(
      "drizzle-kit/api"
    );
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(dbSchema as Record<string, unknown>),
    );
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    pool = testPostgres({
      max: 4,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });
    await connectTestDb(pool);
    for (const stmt of statements) {
      await pool.unsafe(stmt.replaceAll('"public".', `"${schemaName}".`));
    }
    db = drizzle(pool, { schema: dbSchema }) as unknown as Db;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.end();
  });

  beforeEach(async () => {
    await pool.unsafe(`
        TRUNCATE recurring_invoice_runs, recurring_invoices, invoice_lines,
          invoices, prepaid_usage, prepaid_packages, time_entries, projects,
          clients, subscriptions, "user" CASCADE
      `);
    await db.insert(users).values({
      id: USER,
      email: "rec@example.com",
      name: "Rec Test",
    });
    // Selvstændig: må fakturere (plan-gaten i klippekort-fornyelsen)
    await db.insert(subscriptions).values({
      userId: USER,
      billingCycle: "monthly",
      status: "active",
      planTier: "solo",
      trialEndsAt: new Date("2026-01-01T00:00:00Z"),
    });
    const [c] = await db
      .insert(clients)
      .values({ name: "Acme ApS", userId: USER, paymentTermsDays: 8 })
      .returning({ id: clients.id });
    clientId = c.id;
    const [p] = await db
      .insert(projects)
      .values({ name: "Drift", userId: USER, clientId })
      .returning({ id: projects.id });
    projectId = p.id;
  }, 30_000);

  async function createTemplate(
    over: Partial<typeof recurringInvoices.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(recurringInvoices)
      .values({
        userId: USER,
        clientId,
        name: "Teknisk partner",
        billingMode: "fixed",
        lines: [
          {
            description: "Teknisk partner, {periode}",
            quantity: "1",
            unitPrice: "15000",
          },
        ],
        interval: "monthly",
        anchorDay: 31,
        nextRunDate: "2026-01-31",
        ...over,
      })
      .returning();
    return row;
  }

  async function invoicesForClient() {
    return db.query.invoices.findMany({
      where: eq(invoices.clientId, clientId),
      with: { lines: true },
    });
  }

  it("31/1 → 28/2 → 31/3: én kladde pr. periode og rytmen glider ikke", async () => {
    const tpl = await createTemplate();

    const jan = await runDueRecurringInvoice(db, tpl.id, "2026-01-31");
    expect(jan.results.map((r) => r.status)).toEqual(["created"]);
    let row = await db.query.recurringInvoices.findFirst({
      where: eq(recurringInvoices.id, tpl.id),
    });
    expect(row?.nextRunDate).toBe("2026-02-28");

    await runDueRecurringInvoice(db, tpl.id, "2026-02-28");
    row = await db.query.recurringInvoices.findFirst({
      where: eq(recurringInvoices.id, tpl.id),
    });
    expect(row?.nextRunDate).toBe("2026-03-31");

    const all = await invoicesForClient();
    expect(all).toHaveLength(2);
    for (const inv of all) {
      expect(inv.status).toBe("draft");
      expect(inv.invoiceNumber.startsWith("UDKAST-")).toBe(true);
      expect(inv.amount).toBe("15000.00");
    }
    const descriptions = all.flatMap((i) => i.lines.map((l) => l.description));
    expect(descriptions).toContain("Teknisk partner, 31.01.2026–27.02.2026");
    expect(descriptions).toContain("Teknisk partner, 28.02.2026–30.03.2026");
    // Kundens betalingsbetingelser (8 dage) fra kørselsdatoen
    const janInvoice = all.find((i) =>
      i.lines.some((l) => l.description.includes("31.01.2026")),
    );
    expect(janInvoice?.dueDate?.toISOString().slice(0, 10)).toBe("2026-02-08");
  });

  it("idempotens: samme periode giver aldrig to fakturaer", async () => {
    const tpl = await createTemplate();

    // Gentagen kørsel samme dag: andet kald er en no-op
    await runDueRecurringInvoice(db, tpl.id, "2026-01-31");
    const again = await runDueRecurringInvoice(db, tpl.id, "2026-01-31");
    expect(again.results).toEqual([]);

    // Direkte genkørsel af perioden (fx nextRunDate sat tilbage) → duplicate
    const dup = await db.transaction((tx) =>
      generateRecurringInvoiceInTx(tx, tpl, "2026-01-31"),
    );
    expect(dup.status).toBe("duplicate");

    // Samtidige kørsler af en NY periode: præcis én vinder
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        db.transaction((tx) =>
          generateRecurringInvoiceInTx(tx, tpl, "2026-04-30"),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "duplicate")).toHaveLength(2);

    expect(await invoicesForClient()).toHaveLength(2);
    const runs = await db.query.recurringInvoiceRuns.findMany({
      where: eq(recurringInvoiceRuns.recurringInvoiceId, tpl.id),
    });
    expect(runs.map((r) => r.periodStart).sort()).toEqual([
      "2026-01-31",
      "2026-04-30",
    ]);
  });

  it("en slettet kladde genoprettes ikke for samme periode", async () => {
    const tpl = await createTemplate();
    await runDueRecurringInvoice(db, tpl.id, "2026-01-31");
    const [inv] = await invoicesForClient();
    await db.delete(invoices).where(eq(invoices.id, inv.id));

    const dup = await db.transaction((tx) =>
      generateRecurringInvoiceInTx(tx, tpl, "2026-01-31"),
    );
    expect(dup.status).toBe("duplicate");
    expect(await invoicesForClient()).toHaveLength(0);
  });

  it("pausede og slettede skabeloner kører ikke", async () => {
    const paused = await createTemplate({ isPaused: true });
    const archived = await createTemplate({
      isArchived: true,
      name: "Gammel",
    });
    expect(
      (await runDueRecurringInvoice(db, paused.id, "2026-02-01")).results,
    ).toEqual([]);
    expect(
      (await runDueRecurringInvoice(db, archived.id, "2026-02-01")).results,
    ).toEqual([]);
    expect(await invoicesForClient()).toHaveLength(0);
  });

  it("registreret tid i perioden: kun ufaktureret tid på kunden, markeres faktureret", async () => {
    const entry = (date: string, over = {}) => ({
      userId: USER,
      clientId,
      projectId,
      date: new Date(`${date}T00:00:00Z`),
      hours: "2.5",
      billableRate: "900",
      description: "Opdateringer",
      ...over,
    });
    const inserted = await db
      .insert(timeEntries)
      .values([
        entry("2026-10-01"),
        entry("2026-10-31", { hours: "1" }),
        // Uden for perioden
        entry("2026-11-01"),
        // Allerede faktureret / ikke fakturerbar / klippekort
        entry("2026-10-10", { isBilled: true }),
        entry("2026-10-11", { isBillable: false }),
        entry("2026-10-12", { isPrepaid: true }),
      ])
      .returning({ id: timeEntries.id, date: timeEntries.date });

    const tpl = await createTemplate({
      billingMode: "time",
      lines: [],
      anchorDay: 1,
      nextRunDate: "2026-11-01",
    });
    const outcome = await runDueRecurringInvoice(db, tpl.id, "2026-11-01");
    expect(outcome.results[0]).toMatchObject({
      status: "created",
      amount: 3150,
      period: { start: "2026-10-01", end: "2026-10-31" },
    });

    const [inv] = await invoicesForClient();
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0].description).toBe("01.10.2026 – Drift: Opdateringer");
    const billed = await db.query.timeEntries.findMany({
      where: and(
        eq(timeEntries.invoiceId, inv.id),
        eq(timeEntries.isBilled, true),
      ),
    });
    expect(billed).toHaveLength(2);
    const nov = inserted.find(
      (e) => e.date.toISOString().slice(0, 10) === "2026-11-01",
    );
    const novRow = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, nov?.id ?? ""),
    });
    expect(novRow?.isBilled).toBe(false);
  });

  it("registreret tid uden poster i perioden giver ingen tom kladde", async () => {
    const tpl = await createTemplate({
      billingMode: "time",
      lines: [],
      anchorDay: 1,
      nextRunDate: "2026-11-01",
    });
    const outcome = await runDueRecurringInvoice(db, tpl.id, "2026-11-01");
    expect(outcome.results[0].status).toBe("empty");
    expect(await invoicesForClient()).toHaveLength(0);
  });

  async function createPeriodicPackage() {
    const [pkg] = await db
      .insert(prepaidPackages)
      .values({
        name: "Support",
        clientId,
        userId: USER,
        totalHours: "10",
        remainingHours: "4",
        usedHours: "6",
        hourlyRate: "850",
        totalValue: "8500",
        purchaseDate: new Date("2026-09-01T00:00:00Z"),
        renewalInterval: "monthly",
        renewalNextAt: copenhagenDayStart("2026-10-01"),
        renewalBaseHours: "10",
      })
      .returning();
    return pkg;
  }

  it("klippekort-fornyelse → kladde fra den koblede skabelon, koblingen følger kæden", async () => {
    const pkg = await createPeriodicPackage();
    const tpl = await createTemplate({
      prepaidPackageId: pkg.id,
      lines: [
        {
          description: "Klippekort {måned}",
          quantity: "10",
          unitPrice: "850",
        },
      ],
      anchorDay: 1,
      nextRunDate: "2026-10-01",
      paymentTermsDays: 30,
    });

    const now = new Date("2026-10-01T05:00:00Z");
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(prepaidPackages)
        .where(eq(prepaidPackages.id, pkg.id))
        .for("update");
      return renewPackageInTx(tx, locked, now);
    });

    expect(result.draftInvoiceId).not.toBeNull();
    const inv = await db.query.invoices.findFirst({
      where: eq(invoices.id, result.draftInvoiceId ?? ""),
      with: { lines: true },
    });
    expect(inv?.status).toBe("draft");
    expect(inv?.amount).toBe("8500.00");
    expect(inv?.lines.map((l) => l.description)).toEqual([
      "Klippekort oktober 2026",
    ]);
    expect(inv?.dueDate?.toISOString().slice(0, 10)).toBe("2026-10-31");

    const relinked = await db.query.recurringInvoices.findFirst({
      where: eq(recurringInvoices.id, tpl.id),
    });
    expect(relinked?.prepaidPackageId).toBe(result.newPackageId);
    const newPkg = await db.query.prepaidPackages.findFirst({
      where: eq(prepaidPackages.id, result.newPackageId),
    });
    expect(newPkg?.renewalNextAt).toBeTruthy();
    expect(relinked?.nextRunDate).toBe(
      toCopenhagenDateStr(newPkg?.renewalNextAt ?? now),
    );

    // Samme periode igen (fx genkørsel) → ingen ny kladde
    const dup = await db.transaction((tx) =>
      generateRecurringInvoiceInTx(tx, relinked ?? tpl, "2026-10-01", {
        period: { start: "2026-10-01", end: "2026-10-31" },
      }),
    );
    expect(dup.status).toBe("duplicate");
    const lines = await db.query.invoiceLines.findMany();
    expect(lines).toHaveLength(1);
  });

  it("klippekort-fornyelse med skabelon på pause opretter ingen kladde", async () => {
    const pkg = await createPeriodicPackage();
    await createTemplate({
      prepaidPackageId: pkg.id,
      isPaused: true,
      anchorDay: 1,
      nextRunDate: "2026-10-01",
    });
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(prepaidPackages)
        .where(eq(prepaidPackages.id, pkg.id))
        .for("update");
      return renewPackageInTx(tx, locked, new Date("2026-10-01T05:00:00Z"));
    });
    expect(result.draftInvoiceId).toBeNull();
    expect(await invoicesForClient()).toHaveLength(0);
  });

  it("klippekort uden skabelon: standard-kladden som før", async () => {
    const pkg = await createPeriodicPackage();
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(prepaidPackages)
        .where(eq(prepaidPackages.id, pkg.id))
        .for("update");
      return renewPackageInTx(tx, locked, new Date("2026-10-01T05:00:00Z"));
    });
    const all = await invoicesForClient();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(result.draftInvoiceId);
    expect(all[0].lines[0].description).toContain('Klippekort "Support"');
  });
  it("arkiveret kunde: ingen kladde, og datoen rykkes ikke", async () => {
    const tpl = await createTemplate();
    await db
      .update(clients)
      .set({ isArchived: true })
      .where(eq(clients.id, clientId));
    const outcome = await runDueRecurringInvoice(db, tpl.id, "2026-01-31");
    expect(outcome.results).toEqual([]);
    const row = await db.query.recurringInvoices.findFirst({
      where: eq(recurringInvoices.id, tpl.id),
    });
    expect(row?.nextRunDate).toBe("2026-01-31");
    expect(await invoicesForClient()).toHaveLength(0);
  });

  it("nedgraderet til Gratis: fornyelsen bruger skabelonen, for fakturering er ikke låst bag en plan (#1012)", async () => {
    await db
      .update(subscriptions)
      .set({ planTier: "free" })
      .where(eq(subscriptions.userId, USER));
    const pkg = await createPeriodicPackage();
    const tpl = await createTemplate({
      prepaidPackageId: pkg.id,
      lines: [{ description: "Skabelon", quantity: "1", unitPrice: "1" }],
      anchorDay: 1,
      nextRunDate: "2026-10-01",
    });
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(prepaidPackages)
        .where(eq(prepaidPackages.id, pkg.id))
        .for("update");
      return renewPackageInTx(tx, locked, new Date("2026-10-01T05:00:00Z"));
    });
    const all = await invoicesForClient();
    expect(all).toHaveLength(1);
    expect(all[0].lines[0].description).toContain("Skabelon");
    const row = await db.query.recurringInvoices.findFirst({
      where: eq(recurringInvoices.id, tpl.id),
    });
    expect(row?.prepaidPackageId).toBe(result.newPackageId);
  });

  it("uden brugbart abonnement: fornyelsen bruger ikke skabelonen, men koblingen følger med", async () => {
    await db
      .update(subscriptions)
      .set({
        status: "past_due",
        pastDueSince: new Date("2026-09-01T00:00:00Z"),
      })
      .where(eq(subscriptions.userId, USER));
    const pkg = await createPeriodicPackage();
    const tpl = await createTemplate({
      prepaidPackageId: pkg.id,
      lines: [{ description: "Skabelon", quantity: "1", unitPrice: "1" }],
      anchorDay: 1,
      nextRunDate: "2026-10-01",
    });
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(prepaidPackages)
        .where(eq(prepaidPackages.id, pkg.id))
        .for("update");
      return renewPackageInTx(tx, locked, new Date("2026-10-01T05:00:00Z"));
    });
    const all = await invoicesForClient();
    expect(all).toHaveLength(1);
    expect(all[0].lines[0].description).toContain('Klippekort "Support"');
    const row = await db.query.recurringInvoices.findFirst({
      where: eq(recurringInvoices.id, tpl.id),
    });
    expect(row?.prepaidPackageId).toBe(result.newPackageId);
  });

  it("fornyelse slået fra: koblingen løses og skabelonen sættes på pause", async () => {
    const pkg = await createPeriodicPackage();
    const tpl = await createTemplate({
      prepaidPackageId: pkg.id,
      anchorDay: 1,
      nextRunDate: "2026-10-01",
    });
    await syncPrepaidLinkedRecurringInvoice(db, pkg.id, null);
    const row = await db.query.recurringInvoices.findFirst({
      where: eq(recurringInvoices.id, tpl.id),
    });
    expect(row?.prepaidPackageId).toBeNull();
    expect(row?.isPaused).toBe(true);
  });

  it("sletning af kunden fjerner skabelonerne (blokerer ikke)", async () => {
    const tpl = await createTemplate();
    await runDueRecurringInvoice(db, tpl.id, "2026-01-31");
    await db.delete(invoices).where(eq(invoices.clientId, clientId));
    await db.delete(projects).where(eq(projects.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
    expect(await db.query.recurringInvoices.findMany()).toHaveLength(0);
    expect(await db.query.recurringInvoiceRuns.findMany()).toHaveLength(0);
  });
});
