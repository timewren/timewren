/**
 * Mærk nuværende kunder som Founding-kunder (organizations.founding_since).
 *
 *   npx tsx scripts/founding/mark-founding.ts --before 2026-11-09            # dry-run
 *   npx tsx scripts/founding/mark-founding.ts --before 2026-11-09 --apply
 *
 * Udvælgelse: organisationer oprettet før --before, som har eller har haft et
 * betalt abonnement, ELLER har registreret tid inden for de seneste 90 dage.
 * Idempotent: allerede mærkede organisationer røres ikke. Udskriver kun antal
 * og org-id'er, aldrig navne eller mails.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { markFounding, selectFoundingOrgs } from "./lib";

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) {
    throw new Error("--apply og --dry-run kan ikke bruges sammen");
  }
  const i = argv.indexOf("--before");
  const raw = i >= 0 ? argv[i + 1] : undefined;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("--before YYYY-MM-DD er påkrævet");
  }
  const before = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(before.getTime())) throw new Error(`Ugyldig dato: ${raw}`);
  return { apply, before };
}

async function main() {
  const { apply, before } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL mangler");
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  try {
    const now = new Date();
    const sel = await selectFoundingOrgs(db, { before, now });
    console.log(`Tilstand: ${apply ? "APPLY" : "dry-run"}`);
    console.log(`Før: ${before.toISOString().slice(0, 10)}`);
    console.log(`Allerede mærket: ${sel.alreadyMarked}`);
    console.log(`Kandidater: ${sel.candidates.length}`);
    for (const id of sel.candidates) console.log(`  ${id}`);
    if (apply) {
      const done = await markFounding(db, sel.candidates, now);
      console.log(`Mærket nu: ${done.length}`);
    } else {
      console.log("Intet ændret (kør med --apply for at mærke).");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // Kun beskeden: ingen forbindelsesstreng eller stak i loggen.
  console.error(err instanceof Error ? err.message : "ukendt fejl");
  process.exit(1);
});
