-- #508: ressourceplan — planlagte timer pr. medarbejder × projekt (evt.
-- aktivitetstype) pr. uge. Rent additiv: ny tabel, intet eksisterende ændres.
CREATE TABLE "resource_plan_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"activity_type_id" uuid,
	"week_start" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_plan_entries_hours_range" CHECK (hours > 0 AND hours <= 168)
);
--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_plan_entries_cell_unique" ON "resource_plan_entries" USING btree ("organization_id","user_id","project_id","week_start") WHERE activity_type_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_plan_entries_activity_cell_unique" ON "resource_plan_entries" USING btree ("organization_id","user_id","project_id","activity_type_id","week_start") WHERE activity_type_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "resource_plan_entries_org_week_idx" ON "resource_plan_entries" USING btree ("organization_id","week_start");--> statement-breakpoint
CREATE INDEX "resource_plan_entries_project_idx" ON "resource_plan_entries" USING btree ("project_id");