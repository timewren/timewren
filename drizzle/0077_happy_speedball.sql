CREATE TABLE "timesheet_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"template_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_templates_user_name_org_unique" UNIQUE("user_id","name","organization_id")
);
--> statement-breakpoint
ALTER TABLE "timesheet_templates" ADD CONSTRAINT "timesheet_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_templates" ADD CONSTRAINT "timesheet_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timesheet_templates_user_org_idx" ON "timesheet_templates" USING btree ("user_id","organization_id");