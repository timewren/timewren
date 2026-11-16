-- #461 (E3): ferie-ledger som kilde til sandhed, ferieår pr. org (1/9–31/8
-- eller kalenderår) og løbende optjening. 0095 = E4, 0096 = E9, 0098 = E11 (#485) — denne er 0099.
-- Alle trin er idempotente (IF NOT EXISTS / NOT EXISTS-guards).
CREATE TABLE IF NOT EXISTS "vacation_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pool" varchar(10) DEFAULT 'vacation' NOT NULL,
	"entry_type" varchar(20) NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"vacation_year_start" date NOT NULL,
	"ref_type" varchar(30),
	"ref_id" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "vacation_year_start_month" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "vacation_accrual_mode" varchar(20) DEFAULT 'upfront' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "vacation_carry_over_max_days" numeric(4, 1) DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "vacation_pay_out_remaining" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD COLUMN IF NOT EXISTS "period_start" date;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD COLUMN IF NOT EXISTS "period_end" date;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD COLUMN IF NOT EXISTS "rolled_over_at" timestamp;--> statement-breakpoint
-- Eksisterende saldi er kalenderår: period = 1/1–31/12 i "year".
UPDATE "vacation_balances"
SET "period_start" = make_date("year", 1, 1),
    "period_end" = make_date("year", 12, 31)
WHERE "period_start" IS NULL OR "period_end" IS NULL;--> statement-breakpoint
ALTER TABLE "vacation_balances" ALTER COLUMN "period_start" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_balances" ALTER COLUMN "period_end" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vacation_ledger" ADD CONSTRAINT "vacation_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vacation_ledger" ADD CONSTRAINT "vacation_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vacation_ledger" ADD CONSTRAINT "vacation_ledger_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacation_ledger_org_user_period_idx" ON "vacation_ledger" USING btree ("organization_id","user_id","vacation_year_start");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_ledger_system_ref_idx" ON "vacation_ledger" USING btree ("organization_id","user_id","pool","entry_type","ref_type","ref_id","vacation_year_start") WHERE "vacation_ledger"."ref_type" IN ('cron', 'rollover', 'period_open', 'migration');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_balances_user_org_period_idx" ON "vacation_balances" USING btree ("user_id","organization_id","period_start");--> statement-breakpoint
-- Den gamle unikke (user, year, org) ville blokere oprettelse af et 1/9-ferieår
-- der deler startår med et eksisterende kalenderår efter skift af indstilling.
ALTER TABLE "vacation_balances" DROP CONSTRAINT IF EXISTS "vacation_balances_user_year_org_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "vacation_balances_user_year_org_idx";--> statement-breakpoint
-- Åbningsposter: hver eksisterende saldo-række bliver til earned (total) og
-- used (used) pr. pulje, så projektionen fra ledgeren giver PRÆCIS de tal
-- freelance-orgs har i dag. ref_type 'migration' + ref_id = saldo-id gør
-- det idempotent (unikt indeks ovenfor) — scripts/migrate-vacation-to-ledger.ts
-- kan køres igen som reparation uden dubletter.
INSERT INTO "vacation_ledger" ("organization_id","user_id","pool","entry_type","days","effective_date","vacation_year_start","ref_type","ref_id","note")
SELECT b."organization_id", b."user_id", 'vacation', 'earned', b."total_days", b."period_start", b."period_start", 'migration', b."id"::text, 'Åbningssaldo (migrering til ferie-ledger)'
FROM "vacation_balances" b
WHERE b."total_days" <> 0
  AND NOT EXISTS (SELECT 1 FROM "vacation_ledger" l WHERE l."organization_id" = b."organization_id" AND l."user_id" = b."user_id" AND l."pool" = 'vacation' AND l."entry_type" = 'earned' AND l."ref_type" = 'migration' AND l."ref_id" = b."id"::text);--> statement-breakpoint
INSERT INTO "vacation_ledger" ("organization_id","user_id","pool","entry_type","days","effective_date","vacation_year_start","ref_type","ref_id","note")
SELECT b."organization_id", b."user_id", 'vacation', 'used', b."used_days", b."period_start", b."period_start", 'migration', b."id"::text, 'Afholdt før ferie-ledger (migrering)'
FROM "vacation_balances" b
WHERE b."used_days" <> 0
  AND NOT EXISTS (SELECT 1 FROM "vacation_ledger" l WHERE l."organization_id" = b."organization_id" AND l."user_id" = b."user_id" AND l."pool" = 'vacation' AND l."entry_type" = 'used' AND l."ref_type" = 'migration' AND l."ref_id" = b."id"::text);--> statement-breakpoint
INSERT INTO "vacation_ledger" ("organization_id","user_id","pool","entry_type","days","effective_date","vacation_year_start","ref_type","ref_id","note")
SELECT b."organization_id", b."user_id", 'extra', 'earned', b."extra_total_days", b."period_start", b."period_start", 'migration', b."id"::text, 'Åbningssaldo (migrering til ferie-ledger)'
FROM "vacation_balances" b
WHERE b."extra_total_days" <> 0
  AND NOT EXISTS (SELECT 1 FROM "vacation_ledger" l WHERE l."organization_id" = b."organization_id" AND l."user_id" = b."user_id" AND l."pool" = 'extra' AND l."entry_type" = 'earned' AND l."ref_type" = 'migration' AND l."ref_id" = b."id"::text);--> statement-breakpoint
INSERT INTO "vacation_ledger" ("organization_id","user_id","pool","entry_type","days","effective_date","vacation_year_start","ref_type","ref_id","note")
SELECT b."organization_id", b."user_id", 'extra', 'used', b."extra_used_days", b."period_start", b."period_start", 'migration', b."id"::text, 'Afholdt før ferie-ledger (migrering)'
FROM "vacation_balances" b
WHERE b."extra_used_days" <> 0
  AND NOT EXISTS (SELECT 1 FROM "vacation_ledger" l WHERE l."organization_id" = b."organization_id" AND l."user_id" = b."user_id" AND l."pool" = 'extra' AND l."entry_type" = 'used' AND l."ref_type" = 'migration' AND l."ref_id" = b."id"::text);
