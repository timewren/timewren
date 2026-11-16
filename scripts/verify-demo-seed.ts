/**
 * Funktionel verifikation af demo-eksempeldata (#86) mod en database.
 * Opretter en midlertidig testbruger, seeder, verificerer invarianter,
 * tester race-guarden og bevar-ved-brug-adfærden (faktura på demo-
 * klient), rydder — og sletter testbrugeren igen.
 *
 * Usage: npx tsx scripts/verify-demo-seed.ts
 */
import { randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import { and, eq, isNull } from "drizzle-orm";

dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const { clearDemoData, hasDemoData, isAccountEmpty, seedDemoData } =
    await import("@/lib/demo/seed-demo-data");

  const userId = `demo-verify-${randomUUID()}`;
  const scope = { userId };
  const fail = (msg: string): never => {
    throw new Error(`VERIFIKATION FEJLEDE: ${msg}`);
  };

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Demo Verify",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    // ── 1. Tom konto → seed ──────────────────────────────────────────────
    if (!(await isAccountEmpty(db, scope))) fail("konto ikke tom fra start");
    if (!(await seedDemoData(db, scope))) fail("seed returnerede false");
    if (!(await hasDemoData(db, scope))) fail("hasDemoData=false efter seed");

    // Race-guard: andet kald må være no-op
    if (await seedDemoData(db, scope)) fail("dobbelt-seed blev ikke afvist");

    // ── 2. Invarianter ──────────────────────────────────────────────────
    const demoClients = await db.query.clients.findMany({
      where: and(
        eq(schema.clients.userId, userId),
        isNull(schema.clients.organizationId),
      ),
    });
    if (demoClients.length !== 3) fail(`${demoClients.length} klienter != 3`);
    if (!demoClients.every((c) => c.isDemoData)) fail("klient uden isDemoData");

    const pkg = await db.query.prepaidPackages.findFirst({
      where: eq(schema.prepaidPackages.userId, userId),
    });
    if (!pkg) return fail("intet klippekort");
    const total = Number(pkg.totalHours);
    const used = Number(pkg.usedHours);
    const remaining = Number(pkg.remainingHours);
    if (Math.abs(total - used - remaining) > 0.001)
      fail(`saldo-invariant brudt: ${total} - ${used} != ${remaining}`);

    const usage = await db.query.prepaidUsage.findMany({
      where: eq(schema.prepaidUsage.prepaidPackageId, pkg.id),
    });
    const usageSum = usage.reduce((s, u) => s + Number(u.hoursUsed), 0);
    if (Math.abs(usageSum - used) > 0.001)
      fail(`usage-sum ${usageSum} != usedHours ${used}`);

    const entries = await db.query.timeEntries.findMany({
      where: eq(schema.timeEntries.userId, userId),
    });
    if (entries.length !== 11) fail(`${entries.length} tidsposter != 11`);

    // ── 3. Ryd (rent) → alt væk ─────────────────────────────────────────
    const clean = await clearDemoData(db, scope);
    if (clean.cleared !== 3 || clean.kept !== 0)
      fail(
        `ren ryd gav cleared=${clean.cleared}, kept=${clean.kept} (forventede 3/0)`,
      );
    const after = await Promise.all([
      db.query.clients.findFirst({ where: eq(schema.clients.userId, userId) }),
      db.query.projects.findFirst({
        where: eq(schema.projects.userId, userId),
      }),
      db.query.timeEntries.findFirst({
        where: eq(schema.timeEntries.userId, userId),
      }),
      db.query.prepaidPackages.findFirst({
        where: eq(schema.prepaidPackages.userId, userId),
      }),
    ]);
    if (after.some(Boolean)) fail("rest-data efter ren ryd");
    if (await hasDemoData(db, scope)) fail("hasDemoData=true efter ryd");

    // ── 4. Bevar-ved-brug: faktura på demo-klient blokerer sletning ────
    if (!(await seedDemoData(db, scope))) fail("re-seed fejlede");
    const nordlys = await db.query.clients.findFirst({
      where: and(
        eq(schema.clients.userId, userId),
        eq(schema.clients.name, "Nordlys Media ApS"),
      ),
    });
    if (!nordlys) return fail("Nordlys mangler efter re-seed");
    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        userId,
        clientId: nordlys.id,
        invoiceNumber: `DEMO-VERIFY-${Date.now()}`,
        amount: "1250.00",
        status: "draft",
        issueDate: new Date(),
        dueDate: new Date(),
      })
      .returning({ id: schema.invoices.id });

    const mixed = await clearDemoData(db, scope);
    if (mixed.cleared !== 2 || mixed.kept !== 1)
      fail(
        `blandet ryd gav cleared=${mixed.cleared}, kept=${mixed.kept} (forventede 2/1)`,
      );
    const keptClient = await db.query.clients.findFirst({
      where: eq(schema.clients.id, nordlys.id),
    });
    if (!keptClient) return fail("faktureret demo-klient blev slettet!");
    if (keptClient.isDemoData) fail("bevaret klient har stadig isDemoData");
    if (await hasDemoData(db, scope))
      fail("hasDemoData=true efter blandet ryd");

    // Oprydning af scenariet
    await db.delete(schema.invoices).where(eq(schema.invoices.id, invoice.id));
    await db
      .delete(schema.timeEntries)
      .where(eq(schema.timeEntries.userId, userId));
    await db.delete(schema.projects).where(eq(schema.projects.userId, userId));
    await db.delete(schema.clients).where(eq(schema.clients.userId, userId));

    console.log(
      "✅ ALLE DEMO-SEED-VERIFIKATIONER BESTÅET (inkl. bevar-ved-brug)",
    );
  } finally {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
