-- E11 (#469): compliance i drift — off | warn | block pr. regel.
-- Idempotent (IF NOT EXISTS) — se migrationskæde-incident. Backfill:
-- orgs der allerede blokerede på 48 t-reglen beholder den adfærd.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "compliance_rule_48h" varchar(10) DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "compliance_rule_daily_rest" varchar(10) DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "compliance_rule_weekly_rest" varchar(10) DEFAULT 'warn' NOT NULL;--> statement-breakpoint
UPDATE "organizations" SET "compliance_rule_48h" = 'block' WHERE "enforce_compliance_blocking" = true AND "compliance_rule_48h" = 'warn';
