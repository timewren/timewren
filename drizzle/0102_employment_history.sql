-- #465 (E7): ansættelseshistorik — tidsstemplede perioder pr. medarbejder.
-- 0100 = E5 (#487), 0101 = E10 — denne er 0102. Alle trin er idempotente
-- (IF NOT EXISTS / NOT EXISTS-guards), så den kan køres igen uden skade.
CREATE TABLE IF NOT EXISTS "employment_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_profile_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"weekly_hours" numeric(4, 1) DEFAULT '37.0' NOT NULL,
	"conversion_factor" numeric(5, 3) DEFAULT '1.000' NOT NULL,
	"employment_type" varchar(20) DEFAULT 'full_time' NOT NULL,
	"department_id" uuid,
	"position" varchar(255),
	"working_days" jsonb DEFAULT '["1","2","3","4","5"]'::jsonb NOT NULL,
	"daily_norm_hours" numeric(4, 1),
	"break_minutes" integer,
	"end_reason" varchar(50),
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employment_periods_organization_id_organizations_id_fk') THEN
    ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employment_periods_employee_profile_id_employee_profiles_id_fk') THEN
    ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_employee_profile_id_employee_profiles_id_fk" FOREIGN KEY ("employee_profile_id") REFERENCES "public"."employee_profiles"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employment_periods_user_id_user_id_fk') THEN
    ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employment_periods_department_id_departments_id_fk') THEN
    ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employment_periods_created_by_user_id_fk') THEN
    ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employment_periods_profile_from_idx" ON "employment_periods" USING btree ("employee_profile_id","valid_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employment_periods_org_user_idx" ON "employment_periods" USING btree ("organization_id","user_id");--> statement-breakpoint
-- Backfill: én periode pr. eksisterende profil fra de nuværende værdier.
-- valid_from = profilens startdato (NULL = ukendt/siden start), valid_to =
-- fratrædelsesdato. Idempotent: profiler der allerede har perioder springes over.
INSERT INTO "employment_periods" (
  "organization_id", "employee_profile_id", "user_id", "valid_from", "valid_to",
  "weekly_hours", "conversion_factor", "employment_type", "department_id",
  "working_days", "daily_norm_hours", "break_minutes", "end_reason",
  "created_at", "updated_at"
)
SELECT
  p."organization_id", p."id", p."user_id", p."start_date", p."end_date",
  p."weekly_hours", p."conversion_factor", p."employment_type", p."department_id",
  p."working_days", p."daily_norm_hours", p."break_minutes",
  CASE WHEN p."end_date" IS NOT NULL THEN 'migrated' ELSE NULL END,
  p."created_at", now()
FROM "employee_profiles" p
WHERE NOT EXISTS (
  SELECT 1 FROM "employment_periods" ep WHERE ep."employee_profile_id" = p."id"
);
