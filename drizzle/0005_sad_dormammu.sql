ALTER TABLE "prepaid_usage" ALTER COLUMN "time_entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prepaid_usage" ADD COLUMN "description" text;