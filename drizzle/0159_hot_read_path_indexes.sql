-- Indeks til varme læsestier, rent additivt og idempotent.
--
-- invoices (organization_id|user_id, created_at): invoices.list og listPage
-- filtrerer på org (eller bruger) og sorterer på created_at DESC med limit.
-- De eksisterende indeks dækker kun (org, status) og (user, status), så
-- Postgres måtte hente og sortere alle organisationens fakturaer.
-- time_entries (user_id, created_at): time.getRecent (kaldt af timerbjælken
-- på hver side) henter brugerens 50 nyeste ikke-fakturerede poster sorteret
-- på created_at; der fandtes kun (user_id, is_billed) og created_at alene.
--
-- Ikke CONCURRENTLY, af samme grund som i 0158: drizzles migrate() kører alle
-- ventende migrationer i én transaktion, og Postgres afviser CREATE INDEX
-- CONCURRENTLY dér.
CREATE INDEX IF NOT EXISTS "invoices_org_created_idx" ON "invoices" ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_user_created_idx" ON "invoices" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_user_created_idx" ON "time_entries" ("user_id", "created_at");
