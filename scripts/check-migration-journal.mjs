// Guard against migration drift: every .sql file in drizzle/ must have an
// entry in drizzle/meta/_journal.json — otherwise `drizzle migrate` silently
// skips it and the schema quietly diverges from what the code expects.
// (Exactly this happened with the orphan 0002_add_performance_and_integrity,
// see docs/legacy-migrations/README.md.)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const drizzleDir = join(process.cwd(), "drizzle");
const journal = JSON.parse(
  readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8"),
);
const journalTags = new Set(journal.entries.map((e) => e.tag));

const sqlFiles = readdirSync(drizzleDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""));

const orphans = sqlFiles.filter((f) => !journalTags.has(f));
const missing = [...journalTags].filter((t) => !sqlFiles.includes(t));

if (orphans.length > 0) {
  console.error(
    `FEJL: .sql-filer i drizzle/ uden entry i meta/_journal.json (køres ALDRIG af drizzle migrate):\n  ${orphans.join("\n  ")}\n` +
      "Journalfør migrationen korrekt (npm run db:generate) eller flyt filen til docs/legacy-migrations/.",
  );
  process.exit(1);
}

if (missing.length > 0) {
  console.error(
    `FEJL: journal-entries uden tilhørende .sql-fil i drizzle/:\n  ${missing.join("\n  ")}`,
  );
  process.exit(1);
}

console.log(
  `OK: ${sqlFiles.length} migrationsfiler matcher journalens ${journalTags.size} entries.`,
);
