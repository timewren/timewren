/**
 * Seed standard-aktivitetstyper (#459) for én organisation. Idempotent —
 * eksisterende typer (match på navn, case-insensitivt, også arkiverede)
 * røres ikke. Demo-org'en (kunde C) får dermed Undervisning/Forberedelse/Møder/
 * Administration/Andet.
 *
 *   npx tsx scripts/seed-activity-types.ts --org <slug>            # skriver
 *   npx tsx scripts/seed-activity-types.ts --org <slug> --dry-run  # viser kun
 */
import * as dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import {
  ensureDefaultActivityTypes,
  planDefaultActivityTypes,
} from "../src/lib/enterprise/activity-types";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const orgIndex = args.indexOf("--org");
const orgSlug = orgIndex >= 0 ? args[orgIndex + 1] : undefined;

if (!orgSlug) {
  console.error("Brug: --org <slug> [--dry-run]");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL mangler");
  process.exit(1);
}

async function main() {
  const client = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const org = await db.query.organizations.findFirst({
      where: eq(schema.organizations.slug, orgSlug as string),
      columns: { id: true, name: true },
    });
    if (!org) {
      console.error(`Organisation med slug "${orgSlug}" findes ikke`);
      process.exit(1);
    }

    const existing = await db.query.activityTypes.findMany({
      where: eq(schema.activityTypes.organizationId, org.id),
      columns: { name: true, isDefault: true, sortOrder: true },
    });
    const missing = planDefaultActivityTypes(existing);
    console.log(
      `${org.name}: ${existing.length} eksisterende, ${missing.length} mangler${
        dryRun ? " (dry-run)" : ""
      } — ${missing.map((t) => t.name).join(", ") || "(ingen)"}`,
    );

    if (dryRun || missing.length === 0) return;
    const created = await ensureDefaultActivityTypes(db, org.id);
    console.log(`Oprettede ${created.length}: ${created.join(", ")}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
