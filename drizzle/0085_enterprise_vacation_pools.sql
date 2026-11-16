ALTER TABLE "absence_types" ADD COLUMN IF NOT EXISTS "vacation_pool" varchar(20) DEFAULT 'vacation' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN IF NOT EXISTS "extra_vacation_days_per_year" numeric(4, 1) DEFAULT '5.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD COLUMN IF NOT EXISTS "extra_total_days" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD COLUMN IF NOT EXISTS "extra_used_days" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD COLUMN IF NOT EXISTS "extra_remaining_days" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- Backfill: eksisterende saldo-rækker får feriefridage-puljen fra profilen (kun hvor den er 0)
UPDATE "vacation_balances" vb
  SET "extra_total_days" = ep."extra_vacation_days_per_year",
      "extra_remaining_days" = ep."extra_vacation_days_per_year" - vb."extra_used_days"
  FROM "employee_profiles" ep
  WHERE ep."user_id" = vb."user_id" AND ep."organization_id" = vb."organization_id"
    AND vb."extra_total_days" = 0;
