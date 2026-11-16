-- Klippekort-valg for den kørende timer (#422): et eksplicit kortvalg eller
-- "Intet klippekort" gemmes på timerrækken, så stop fra web, extension og app
-- trækker fra samme kort. Alle kolonner er nullable uden default (NULL =
-- automatisk valg) — eksisterende rækker er uændrede. Idempotent.
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "prepaid_choice" varchar(10);--> statement-breakpoint
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "prepaid_package_id" uuid;--> statement-breakpoint
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "prepaid_choice_client_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_prepaid_choice_client_id_clients_id_fk" FOREIGN KEY ("prepaid_choice_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
