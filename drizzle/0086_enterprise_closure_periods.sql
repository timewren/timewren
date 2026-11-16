CREATE TABLE IF NOT EXISTS "org_closure_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"absence_type_id" uuid NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absence_requests" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD COLUMN IF NOT EXISTS "closure_period_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_closure_periods" ADD CONSTRAINT "org_closure_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_closure_periods" ADD CONSTRAINT "org_closure_periods_absence_type_id_absence_types_id_fk" FOREIGN KEY ("absence_type_id") REFERENCES "public"."absence_types"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_closure_periods" ADD CONSTRAINT "org_closure_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_closure_periods_org_start_idx" ON "org_closure_periods" USING btree ("organization_id","start_date");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_closure_period_id_org_closure_periods_id_fk" FOREIGN KEY ("closure_period_id") REFERENCES "public"."org_closure_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "absence_requests_closure_period_idx" ON "absence_requests" USING btree ("closure_period_id");
