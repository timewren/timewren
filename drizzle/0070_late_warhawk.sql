ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "cost_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "cost_rate" numeric(10, 2);