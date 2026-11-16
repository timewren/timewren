-- E4 (#462): enterprise-rapporter deler report_templates/report_schedules med
-- freelance-motoren. report_type diskriminerer; org-delte skabeloner har
-- user_id NULL. Idempotent (IF NOT EXISTS-guards) — se migrationskæde-incident.
ALTER TABLE "report_templates" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN IF NOT EXISTS "report_type" varchar(30) DEFAULT 'time' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_templates" ADD COLUMN IF NOT EXISTS "report_type" varchar(30) DEFAULT 'time' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_templates_org_type_idx" ON "report_templates" USING btree ("organization_id","report_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_templates_org_shared_name_unique" ON "report_templates" USING btree ("organization_id","name") WHERE "report_templates"."user_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_owner_check" CHECK ("user_id" IS NOT NULL OR "organization_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;
