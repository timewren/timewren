-- E5 (#463): lønmapping — lønarter, mapping-regler, medarbejdernummer,
-- lønart pr. fraværstype og org'ens lønsystem/lønperiode. Idempotent
-- (IF NOT EXISTS-guards) — se migrationskæde-incident (#408).
CREATE TABLE IF NOT EXISTS "payroll_mapping_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"wage_type_id" uuid NOT NULL,
	"source" varchar(30) NOT NULL,
	"activity_type_id" uuid,
	"absence_type_id" uuid,
	"day_condition" varchar(20) DEFAULT 'any' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_wage_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"unit" varchar(10) DEFAULT 'hours' NOT NULL,
	"kind" varchar(20) DEFAULT 'time' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_wage_types_org_code_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
ALTER TABLE "absence_types" ADD COLUMN IF NOT EXISTS "payroll_code" varchar(50);--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN IF NOT EXISTS "employee_number" varchar(50);--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN IF NOT EXISTS "external_payroll_id" varchar(100);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "payroll_system" varchar(20) DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "payroll_period_type" varchar(20) DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "payroll_period_start_day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_wage_type_id_payroll_wage_types_id_fk" FOREIGN KEY ("wage_type_id") REFERENCES "public"."payroll_wage_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_absence_type_id_absence_types_id_fk" FOREIGN KEY ("absence_type_id") REFERENCES "public"."absence_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_wage_types" ADD CONSTRAINT "payroll_wage_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_mapping_rules_org_idx" ON "payroll_mapping_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_mapping_rules_wage_type_idx" ON "payroll_mapping_rules" USING btree ("wage_type_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_wage_types_org_idx" ON "payroll_wage_types" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_profiles_org_employee_number_unique" ON "employee_profiles" USING btree ("organization_id","employee_number") WHERE "employee_profiles"."employee_number" IS NOT NULL;