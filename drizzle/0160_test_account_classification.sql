ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "is_test_account" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "test_alunta_subscriptions" (
  "subscription_id" varchar(255) PRIMARY KEY
);
