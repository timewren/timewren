ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "overdraft_policy" varchar(10) DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "overdraft_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "overdraft_hours" numeric(8, 2) DEFAULT '0' NOT NULL;