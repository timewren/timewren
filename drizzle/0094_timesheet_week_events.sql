-- #466 (E8): append-only godkendelseslog for timesedler. Rækker slettes
-- aldrig (5 års opbevaring). 0093 er reserveret til E9 (#467).
CREATE TABLE IF NOT EXISTS "timesheet_week_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"week_start" date NOT NULL,
	"event" varchar(20) NOT NULL,
	"actor_id" text,
	"reason" text,
	"total_hours" numeric(6, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timesheet_week_events" ADD CONSTRAINT "timesheet_week_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timesheet_week_events" ADD CONSTRAINT "timesheet_week_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timesheet_week_events" ADD CONSTRAINT "timesheet_week_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timesheet_week_events_org_user_week_idx" ON "timesheet_week_events" USING btree ("organization_id","user_id","week_start");
