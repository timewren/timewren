CREATE TABLE IF NOT EXISTS "activity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(7) DEFAULT '#6366f1' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"payroll_code" varchar(50),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "activity_types_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_activity_types" (
	"project_id" uuid NOT NULL,
	"activity_type_id" uuid NOT NULL,
	CONSTRAINT "project_activity_types_pk" PRIMARY KEY("project_id","activity_type_id")
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "activity_type_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_types" ADD CONSTRAINT "activity_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_activity_types" ADD CONSTRAINT "project_activity_types_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_activity_types" ADD CONSTRAINT "project_activity_types_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_types_org_idx" ON "activity_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_activity_types_activity_idx" ON "project_activity_types" USING btree ("activity_type_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_org_activity_idx" ON "time_entries" USING btree ("organization_id","activity_type_id");
