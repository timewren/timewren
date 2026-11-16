ALTER TABLE "absence_requests" ALTER COLUMN "end_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD COLUMN IF NOT EXISTS "hours_per_day" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "absence_requests" ADD COLUMN IF NOT EXISTS "registered_by" text;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD COLUMN IF NOT EXISTS "reported_well_at" timestamp;--> statement-breakpoint
ALTER TABLE "absence_types" ADD COLUMN IF NOT EXISTS "category" varchar(20) DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_types" ADD COLUMN IF NOT EXISTS "requires_documentation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_types" ADD COLUMN IF NOT EXISTS "annual_cap_days" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "absence_types" ADD COLUMN IF NOT EXISTS "visible_to_colleagues" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'absence_requests_registered_by_user_id_fk'
  ) THEN
    ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_registered_by_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
UPDATE "absence_types" SET "category" = 'sickness', "visible_to_colleagues" = false WHERE "category" = 'other' AND lower("name") IN ('sygdom', 'barns 1. sygedag', 'barns 2. sygedag');--> statement-breakpoint
UPDATE "absence_types" SET "annual_cap_days" = 2 WHERE "annual_cap_days" IS NULL AND lower("name") = 'barns 1. sygedag';--> statement-breakpoint
UPDATE "absence_types" SET "category" = 'vacation' WHERE "category" = 'other' AND lower("name") IN ('ferie', 'feriefridage');--> statement-breakpoint
UPDATE "absence_types" SET "category" = 'leave' WHERE "category" = 'other' AND lower("name") IN ('barsel', 'orlov');
