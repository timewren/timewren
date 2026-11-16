-- Multibrand (TimeWren Cloud, docs/specs/timewren-cloud.md): hvilket brand en
-- konto og en organisation hører til.
--
-- Rent additivt: to nye kolonner med default 'timetrack', så alle eksisterende
-- rækker (og alle INSERT'er der ikke kender kolonnen) er uændrede. Ingen
-- backfill, ingen constraint ud over NOT NULL DEFAULT. Idempotent.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "brand" varchar(20) DEFAULT 'timetrack' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "brand" varchar(20) DEFAULT 'timetrack' NOT NULL;
