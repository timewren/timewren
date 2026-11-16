/**
 * Migrér eksisterende feriesaldi til ferie-ledgeren (#461) — idempotent.
 *
 *   npx tsx scripts/migrate-vacation-to-ledger.ts --org <id|slug|all> [--dry-run]
 *
 * For hver vacation_balances-række oprettes åbningsposter i vacation_ledger:
 * 'earned' (total_days) og 'used' (used_days) pr. pulje med effective_date =
 * period_start, ref_type 'migration' og ref_id = saldo-id. Det unikke
 * system-ref-indeks gør gentagne kørsler til no-ops. Migration 0099 gør det
 * samme i SQL ved deploy — scriptet er reparationsværktøjet (fx efter en
 * saldo-række oprettet af gammel kode) og afslutter med at genberegne
 * projektionen, så saldo-kolonnerne = ledgeren.
 */
import * as dotenv from "dotenv";
import { eq, or } from "drizzle-orm";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

type Args = { org?: string; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--org":
        args.org = argv[i + 1];
        i++;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Ukendt argument: ${flag}`);
    }
  }
  if (!args.org) throw new Error("--org <id|slug|all> er påkrævet");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db } = await import("@/lib/db");
  const { organizations, vacationBalances } = await import("@/lib/db/schema");
  const { postVacationLedger, recomputeVacationBalance } = await import(
    "@/lib/enterprise/vacation"
  );

  let orgIds: string[];
  if (args.org === "all") {
    const orgs = await db.query.organizations.findMany({
      columns: { id: true },
    });
    orgIds = orgs.map((o) => o.id);
  } else {
    const org = await db.query.organizations.findFirst({
      where: or(
        eq(organizations.id, args.org as string),
        eq(organizations.slug, args.org as string),
      ),
      columns: { id: true, name: true, slug: true },
    });
    if (!org) throw new Error(`Organisation ikke fundet: ${args.org}`);
    console.log(`Org: ${org.name} (${org.slug}, ${org.id})`);
    orgIds = [org.id];
  }

  let rows = 0;
  let posted = 0;
  for (const orgId of orgIds) {
    const balances = await db.query.vacationBalances.findMany({
      where: eq(vacationBalances.organizationId, orgId),
    });
    for (const b of balances) {
      rows++;
      const entries = [
        {
          pool: "vacation" as const,
          entryType: "earned" as const,
          days: Number(b.totalDays),
        },
        {
          pool: "vacation" as const,
          entryType: "used" as const,
          days: Number(b.usedDays),
        },
        {
          pool: "extra" as const,
          entryType: "earned" as const,
          days: Number(b.extraTotalDays),
        },
        {
          pool: "extra" as const,
          entryType: "used" as const,
          days: Number(b.extraUsedDays),
        },
      ].filter((e) => e.days !== 0);
      if (args.dryRun) {
        console.log(
          `[dry-run] ${b.userId} ${b.periodStart}: ${entries.map((e) => `${e.pool}/${e.entryType}=${e.days}`).join(", ") || "ingen"}`,
        );
        continue;
      }
      await db.transaction(async (tx) => {
        for (const e of entries) {
          const ok = await postVacationLedger(tx, {
            userId: b.userId,
            orgId,
            pool: e.pool,
            entryType: e.entryType,
            days: e.days,
            effectiveDate: b.periodStart,
            vacationYearStart: b.periodStart,
            refType: "migration",
            refId: b.id,
            note:
              e.entryType === "earned"
                ? "Åbningssaldo (migrering til ferie-ledger)"
                : "Afholdt før ferie-ledger (migrering)",
          });
          if (ok) posted++;
        }
        await recomputeVacationBalance(tx, b.userId, orgId, b.periodStart);
      });
    }
  }
  console.log(
    `${args.dryRun ? "[dry-run] " : ""}${rows} saldo-rækker gennemgået, ${posted} nye ledger-poster.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
