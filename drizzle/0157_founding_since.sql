-- Founding-kunde (docs: founding-mærke): hvilke organisationer der var kunder
-- før TimeWren-overgangen.
--
-- Rent additivt: én nullable kolonne uden default. Postgres 11+ tilføjer den
-- som ren metadataændring (ingen tabel-omskrivning, kort ACCESS EXCLUSIVE-lås).
-- Ingen backfill her: scripts/founding/mark-founding.ts sætter værdien, efter
-- migrationen er kørt. Idempotent.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "founding_since" timestamp with time zone;
