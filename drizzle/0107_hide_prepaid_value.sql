-- kunde A-ønske: skjul kroner på klippekort-visninger, globalt (user) med
-- override pr. kunde (clients, null = arv). Idempotent (IF NOT EXISTS) — se
-- migrationskæde-incident.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "hide_prepaid_value" boolean;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "hide_prepaid_value" boolean DEFAULT false NOT NULL;
