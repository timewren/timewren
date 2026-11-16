CREATE TABLE "timesheet_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"week_start" date NOT NULL,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"total_hours" numeric(6, 2),
	"submitted_at" timestamp,
	"decided_by" text,
	"decided_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_weeks_user_week_org_unique" UNIQUE("user_id","week_start","organization_id")
);
--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timesheet_weeks_org_status_idx" ON "timesheet_weeks" USING btree ("organization_id","status");