/**
 * Engangs-script (#435): opret standard-fraværstyper for alle organisationer
 * der har enterprise-modulet slået til. Idempotent — eksisterende typer
 * (match på navn, case-insensitivt, også arkiverede) røres ikke.
 *
 *   npx tsx scripts/seed-absence-defaults.ts            # skriver
 *   npx tsx scripts/seed-absence-defaults.ts --dry-run  # viser kun
 */
import * as dotenv from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import {
  DEFAULT_ABSENCE_TYPES,
  ensureDefaultAbsenceTypes,
} from "../src/lib/enterprise/absence-defaults";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const dryRun = process.argv.includes("--dry-run");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL mangler");
  process.exit(1);
}

async function main() {
  const client = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(client, { schema });

  const enterpriseOrgs = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.organizationModules)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.organizationModules.organizationId),
    )
    .where(
      and(
        eq(schema.organizationModules.moduleKey, "enterprise"),
        eq(schema.organizationModules.isEnabled, true),
      ),
    );

  console.log(
    `${enterpriseOrgs.length} org(s) med enterprise-modul${dryRun ? " (dry-run)" : ""}`,
  );

  let createdTotal = 0;
  for (const org of enterpriseOrgs) {
    if (dryRun) {
      const existing = await db.query.absenceTypes.findMany({
        where: eq(schema.absenceTypes.organizationId, org.id),
        columns: { name: true },
      });
      const names = new Set(existing.map((t) => t.name.trim().toLowerCase()));
      const missing = DEFAULT_ABSENCE_TYPES.filter(
        (t) => !names.has(t.name.toLowerCase()),
      ).map((t) => t.name);
      console.log(
        `  ${org.name}: mangler ${missing.length} — ${missing.join(", ") || "(ingen)"}`,
      );
      createdTotal += missing.length;
      continue;
    }
    const created = await ensureDefaultAbsenceTypes(db, org.id);
    createdTotal += created.length;
    console.log(
      `  ${org.name}: oprettede ${created.length} — ${created.join(", ") || "(ingen)"}`,
    );
  }

  console.log(
    `Færdig: ${createdTotal} type(r) ${dryRun ? "ville blive" : ""} oprettet`,
  );
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
