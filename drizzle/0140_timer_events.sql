-- A6: hændelseslog for timeren. Én række pr. tilstandsovergang/afvisning
-- (vellykkede heartbeats logges ikke), så en kundeklage kan rekonstrueres.
-- Rent additiv: ny tabel, intet eksisterende ændres. Ingen IP, ingen
-- beskrivelsestekst. Slettes efter 30 dage (webhook-cleanup-cron'en).
-- Nummer 0140 holder afstand til release-PR'ernes 0130-0137.
CREATE TABLE IF NOT EXISTS "timer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"event" varchar(32) NOT NULL,
	"source" varchar(16) NOT NULL,
	"client_hint" varchar(64),
	"version_before" integer,
	"version_after" integer,
	"start_time" timestamp,
	"base_seconds" integer,
	"project_id" uuid,
	"client_id" uuid,
	"detail" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "timer_events" ADD CONSTRAINT "timer_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timer_events_user_created_idx" ON "timer_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timer_events_created_idx" ON "timer_events" USING btree ("created_at");
