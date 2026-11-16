ALTER TABLE "employee_profiles" ADD COLUMN IF NOT EXISTS "daily_norm_hours" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN IF NOT EXISTS "break_minutes" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "default_weekly_hours" numeric(4, 1) DEFAULT '37.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "daily_norm_hours" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "break_minutes_per_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "break_policy" varchar(20) DEFAULT 'none' NOT NULL;