import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import type { db as Database } from "@/lib/db";
import {
  clients,
  prepaidPackages,
  prepaidUsage,
  projects,
  rateHistory,
  timeEntries,
} from "@/lib/db/schema";

/**
 * Demo-eksempeldata i onboarding (#86): seeder en lille, realistisk
 * freelancer-verden — 3 kunder, 2 projekter, klippekort med træk og to
 * ugers tidsposter — så dashboardet viser værdi fra minut ét i stedet
 * for tomme widgets.
 *
 * Oprydning ("Ryd demo-data") er bevidst konservativ: KUN rene
 * demo-rækker slettes. Alt brugeren selv har bygget ovenpå (fakturaer,
 * egne tidsposter, opgaver m.m.) bevares — en demo-klient der er taget
 * i brug degraderes til en almindelig klient (isDemoData fjernes) i
 * stedet for at blive slettet. Det håndhæves generisk med savepoints:
 * blokerer NOGEN fremmednøgle sletningen, beholdes klienten.
 */

type Db = typeof Database;

interface Scope {
  userId: string;
  orgId?: string;
}

const DEMO_PACKAGE_MARKER = "Demo-eksempel:%";

function tenantFilter(scope: Scope) {
  return scope.orgId
    ? eq(clients.organizationId, scope.orgId)
    : and(eq(clients.userId, scope.userId), isNull(clients.organizationId));
}

function entryTenantFilter(scope: Scope) {
  return scope.orgId
    ? eq(timeEntries.organizationId, scope.orgId)
    : and(
        eq(timeEntries.userId, scope.userId),
        isNull(timeEntries.organizationId),
      );
}

/** Serialiserer seed/clear pr. konto — lukker read-then-write-racen. */
async function acquireScopeLock(tx: Db, scope: Scope): Promise<void> {
  const key = `demo-seed:${scope.orgId ?? scope.userId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

/** Har kontoen demo-data liggende? (til banner + guards) */
export async function hasDemoData(db: Db, scope: Scope): Promise<boolean> {
  const row = await db.query.clients.findFirst({
    where: and(tenantFilter(scope), eq(clients.isDemoData, true)),
    columns: { id: true },
  });
  return !!row;
}

/** Er kontoen tom nok til at seede? (ingen klienter overhovedet) */
export async function isAccountEmpty(db: Db, scope: Scope): Promise<boolean> {
  const row = await db.query.clients.findFirst({
    where: tenantFilter(scope),
    columns: { id: true },
  });
  return !row;
}

function daysAgo(days: number, hour = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Seeder demo-verdenen. Guard (tom konto) og insert sker atomisk i én
 * transaktion bag en advisory lock, så to samtidige kald ikke kan seede
 * dobbelt. Returnerer false hvis kontoen ikke (længere) var tom.
 */
export async function seedDemoData(db: Db, scope: Scope): Promise<boolean> {
  return db.transaction(async (tx) => {
    await acquireScopeLock(tx as unknown as Db, scope);
    if (!(await isAccountEmpty(tx as unknown as Db, scope))) {
      return false;
    }

    const base = { userId: scope.userId, organizationId: scope.orgId ?? null };

    // ── Kunder (opdigtede — ingen ægte PII) ──────────────────────────────
    const [nordlys, brandt, groenHave] = await tx
      .insert(clients)
      .values([
        {
          ...base,
          name: "Nordlys Media ApS",
          company: "Nordlys Media ApS",
          email: "kontakt@eksempel-nordlys.dk",
          defaultHourlyRate: "850",
          color: "#3b82f6",
          notes:
            "Demo-eksempel oprettet af TimeTrack — kan ryddes fra banneret på dashboardet.",
          isDemoData: true,
        },
        {
          ...base,
          name: "Brandt & Partnere",
          company: "Brandt & Partnere",
          email: "mb@eksempel-brandt.dk",
          defaultHourlyRate: "950",
          color: "#8b5cf6",
          notes: "Demo-eksempel oprettet af TimeTrack.",
          isDemoData: true,
        },
        {
          ...base,
          name: "Grøn Have Webshop",
          company: "Grøn Have Webshop",
          email: "hej@eksempel-groenhave.dk",
          defaultHourlyRate: "750",
          color: "#22c55e",
          notes: "Demo-eksempel oprettet af TimeTrack.",
          isDemoData: true,
        },
      ])
      .returning({ id: clients.id });

    // ── Projekter ────────────────────────────────────────────────────────
    const [redesign, raadgivning] = await tx
      .insert(projects)
      .values([
        {
          ...base,
          name: "Website-redesign",
          description: "Nyt design + implementering af landingssider",
          clientId: nordlys.id,
          status: "active",
        },
        {
          ...base,
          name: "Løbende rådgivning",
          description: "Sparring og månedlige statusmøder",
          clientId: brandt.id,
          status: "active",
        },
      ])
      .returning({ id: projects.id });

    // ── Klippekort på Grøn Have: 10 timer, 3,5 brugt ─────────────────────
    const [pakke] = await tx
      .insert(prepaidPackages)
      .values({
        ...base,
        name: "Klippekort 10 timer",
        clientId: groenHave.id,
        totalHours: "10.00",
        usedHours: "3.50",
        remainingHours: "6.50",
        hourlyRate: "750",
        totalValue: "7500.00",
        purchaseDate: daysAgo(20),
        expiryDate: daysAgo(-345), // ~11½ måned frem
        description: "Demo-eksempel: forudbetalte support-timer",
      })
      .returning({ id: prepaidPackages.id });

    // ── Tidsposter: to ugers realistisk aktivitet ────────────────────────
    const entry = (v: {
      clientId?: string;
      projectId?: string;
      days: number;
      hours: string;
      description: string;
      billable?: boolean;
      prepaid?: boolean;
      rate?: string;
    }) => ({
      ...base,
      clientId: v.clientId ?? null,
      projectId: v.projectId ?? null,
      prepaidPackageId: v.prepaid ? pakke.id : null,
      description: v.description,
      hours: v.hours,
      date: daysAgo(v.days),
      billableRate: v.rate ?? null,
      isBillable: v.billable ?? true,
      isPrepaid: v.prepaid ?? false,
      source: "demo",
    });

    const inserted = await tx
      .insert(timeEntries)
      .values([
        // Nordlys / redesign — ufaktureret (fylder "ufakturerede timer")
        entry({
          clientId: nordlys.id,
          projectId: redesign.id,
          days: 13,
          hours: "4.50",
          description: "Wireframes og struktur",
          rate: "850",
        }),
        entry({
          clientId: nordlys.id,
          projectId: redesign.id,
          days: 11,
          hours: "6.00",
          description: "Design af forside",
          rate: "850",
        }),
        entry({
          clientId: nordlys.id,
          projectId: redesign.id,
          days: 8,
          hours: "3.25",
          description: "Feedback-runde med kunden",
          rate: "850",
        }),
        entry({
          clientId: nordlys.id,
          projectId: redesign.id,
          days: 4,
          hours: "5.50",
          description: "Implementering af landingssider",
          rate: "850",
        }),
        entry({
          clientId: nordlys.id,
          projectId: redesign.id,
          days: 1,
          hours: "2.75",
          description: "Responsivt design + tilretninger",
          rate: "850",
        }),
        // Brandt / rådgivning
        entry({
          clientId: brandt.id,
          projectId: raadgivning.id,
          days: 9,
          hours: "1.50",
          description: "Statusmøde + opfølgning",
          rate: "950",
        }),
        entry({
          clientId: brandt.id,
          projectId: raadgivning.id,
          days: 5,
          hours: "2.00",
          description: "Gennemgang af kampagnetal",
          rate: "950",
        }),
        entry({
          clientId: brandt.id,
          projectId: raadgivning.id,
          days: 2,
          hours: "1.25",
          description: "Sparring om Q4-plan",
          rate: "950",
        }),
        // Grøn Have — trukket på klippekortet (summer til 3,50)
        entry({
          clientId: groenHave.id,
          days: 6,
          hours: "2.00",
          description: "Fejlretning i checkout",
          prepaid: true,
          rate: "750",
        }),
        entry({
          clientId: groenHave.id,
          days: 3,
          hours: "1.50",
          description: "Opsætning af fragtregler",
          prepaid: true,
          rate: "750",
        }),
        // Intern tid (hverken kunde eller projekt)
        entry({
          days: 7,
          hours: "1.00",
          description: "Bogføring og administration",
          billable: false,
        }),
      ])
      .returning({
        id: timeEntries.id,
        hours: timeEntries.hours,
        isPrepaid: timeEntries.isPrepaid,
      });

    // ── Klippekort-træk (usage-rækker matcher de prepaid tidsposter) ─────
    const prepaidEntries = inserted.filter((e) => e.isPrepaid);
    await tx.insert(prepaidUsage).values(
      prepaidEntries.map((e) => ({
        prepaidPackageId: pakke.id,
        timeEntryId: e.id,
        hoursUsed: e.hours,
        valueUsed: (Number(e.hours) * 750).toFixed(2),
      })),
    );

    return true;
  });
}

export interface ClearResult {
  /** Antal demo-klienter der blev slettet helt. */
  cleared: number;
  /** Antal demo-klienter der var taget i brug og blev bevaret som almindelige klienter. */
  kept: number;
}

/**
 * Rydder demo-data konservativt (se modul-kommentaren). Hele forløbet
 * kører i én transaktion; pr. klient bruges et savepoint, så en klient
 * med fremmednøgle-afhængigheder (faktura, opgaver, egne poster …)
 * bevares intakt som almindelig klient i stedet for at efterlade en
 * halvt ryddet konto.
 */
export async function clearDemoData(
  db: Db,
  scope: Scope,
): Promise<ClearResult> {
  return db.transaction(async (tx) => {
    await acquireScopeLock(tx as unknown as Db, scope);

    const demoClients = await tx.query.clients.findMany({
      where: and(tenantFilter(scope), eq(clients.isDemoData, true)),
      columns: { id: true },
    });
    const ids = demoClients.map((c) => c.id);
    if (ids.length === 0) return { cleared: 0, kept: 0 };

    // 1. Rene demo-tidsposter (aldrig fakturerede) — inkl. den interne
    //    post uden klient. Usage-rækker der peger på dem fjernes først
    //    (FK), og pakkens saldo er seedet så den matcher præcis disse træk.
    const demoEntries = await tx.query.timeEntries.findMany({
      where: and(
        entryTenantFilter(scope),
        eq(timeEntries.source, "demo"),
        isNull(timeEntries.invoiceId),
      ),
      columns: { id: true },
    });
    const demoEntryIds = demoEntries.map((e) => e.id);
    if (demoEntryIds.length > 0) {
      await tx
        .delete(prepaidUsage)
        .where(inArray(prepaidUsage.timeEntryId, demoEntryIds));
      await tx.delete(timeEntries).where(inArray(timeEntries.id, demoEntryIds));
    }

    // 2. Pr. klient: forsøg fuld sletning i et savepoint. Enhver
    //    FK-blokering (faktura, egne poster, opgaver, skabeloner …)
    //    ruller KUN den klients sletning tilbage — klienten beholdes
    //    som almindelig klient.
    let cleared = 0;
    let kept = 0;
    for (const clientId of ids) {
      try {
        await tx.transaction(async (inner) => {
          await inner
            .delete(rateHistory)
            .where(eq(rateHistory.clientId, clientId));
          const pkgs = await inner.query.prepaidPackages.findMany({
            where: and(
              eq(prepaidPackages.clientId, clientId),
              like(prepaidPackages.description, DEMO_PACKAGE_MARKER),
            ),
            columns: { id: true },
          });
          const pkgIds = pkgs.map((p) => p.id);
          if (pkgIds.length > 0) {
            await inner
              .delete(prepaidUsage)
              .where(inArray(prepaidUsage.prepaidPackageId, pkgIds));
            await inner
              .delete(prepaidPackages)
              .where(inArray(prepaidPackages.id, pkgIds));
          }
          await inner.delete(projects).where(eq(projects.clientId, clientId));
          await inner.delete(clients).where(eq(clients.id, clientId));
        });
        cleared++;
      } catch {
        // Klienten er taget i brug — degradér til almindelig klient.
        await tx
          .update(clients)
          .set({ isDemoData: false, updatedAt: new Date() })
          .where(eq(clients.id, clientId));
        kept++;
      }
    }

    return { cleared, kept };
  });
}
