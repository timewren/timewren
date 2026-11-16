# Legacy migrations (ARKIV — anvendes IKKE)

Denne mappe er et arkiv. Ingen af filerne her køres af noget værktøj.

**Den autoritative migrationskilde er `drizzle/`** (jf. `drizzle.config.ts`),
kørt via `npm run db:migrate` / `scripts/migrate-safe.ts` (`MIGRATE_ON_START=1`
i Docker). Kun filer med en entry i `drizzle/meta/_journal.json` anvendes —
CI-checket `scripts/check-migration-journal.mjs` fejler, hvis en `.sql`-fil
ligger i `drizzle/` uden journal-entry.

## Indhold

- `0001_…`–`0031_…` (31 filer): den gamle håndskrevne migrationsmappe
  (`migrations/` i repo-roden). Historisk kørt manuelt mod databasen før
  Drizzle-journalen blev autoritativ. Flyttet hertil 2026-07-04 (#185).
- `0002_add_performance_and_integrity.sql`: orphan-fil der lå i `drizzle/`
  ved siden af den journalførte `0002_yielding_micromacro.sql`, men aldrig
  stod i journalen og derfor aldrig blev kørt af `drizzle migrate`.
  **Indholdet ER anvendt i prod ad anden vej** — verificeret 2026-07-04
  mod prod-databasen: alle `check_*`-constraints og de nævnte indeks
  findes. De indeks der manglede i `schema.ts`, er efterfølgende
  deklareret dér og journalført i `drizzle/0055_*` (#184).

## Hvis du mangler noget herfra

Skriv en ny, journalført migration i `drizzle/` (via `npm run db:generate`)
i stedet for at genoplive disse filer.
