ALTER TABLE "users" ADD COLUMN "ai_provider" varchar(20) DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_api_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_api_url" varchar(500);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_model" varchar(100);