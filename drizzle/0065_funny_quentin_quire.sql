ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "monthly_status_report_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "monthly_status_note" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "status_report_last_sent_at" timestamp;