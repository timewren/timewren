ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "renewal_interval" varchar(10);--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "renewal_rollover" varchar(10) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "renewal_next_at" timestamp;--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "renewed_from_id" uuid;