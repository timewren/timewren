-- #510: fast arbejdsplan (arbejdstidsloven § 4 b). Rent additiv: fire nye
-- tabeller, intet eksisterende ændres. Uden tildelt plan er alt som før.
CREATE TABLE "work_day_deviations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"kind" varchar(20) DEFAULT 'worked' NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"break_minutes" integer,
	"hours" numeric(5, 2) NOT NULL,
	"note" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_day_deviations_org_user_date_unique" UNIQUE("organization_id","user_id","date")
);
--> statement-breakpoint
CREATE TABLE "work_plan_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" text,
	"department_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_plan_assignments_target" CHECK ((user_id IS NOT NULL AND department_id IS NULL) OR (user_id IS NULL AND department_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "work_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"rotation_weeks" integer DEFAULT 1 NOT NULL,
	"rotation_anchor" date,
	"weeks" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_plan_versions_plan_valid_from_unique" UNIQUE("plan_id","valid_from"),
	CONSTRAINT "work_plan_versions_rotation" CHECK (rotation_weeks IN (1, 2))
);
--> statement-breakpoint
CREATE TABLE "work_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"preset" varchar(30),
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_day_deviations" ADD CONSTRAINT "work_day_deviations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_deviations" ADD CONSTRAINT "work_day_deviations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_deviations" ADD CONSTRAINT "work_day_deviations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_deviations" ADD CONSTRAINT "work_day_deviations_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_plan_id_work_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."work_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_versions" ADD CONSTRAINT "work_plan_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_versions" ADD CONSTRAINT "work_plan_versions_plan_id_work_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."work_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_versions" ADD CONSTRAINT "work_plan_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_plan_assignments_org_user_idx" ON "work_plan_assignments" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "work_plan_assignments_org_department_idx" ON "work_plan_assignments" USING btree ("organization_id","department_id");--> statement-breakpoint
CREATE INDEX "work_plans_org_idx" ON "work_plans" USING btree ("organization_id");