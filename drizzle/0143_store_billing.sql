-- Køb i appen (App Store / Google Play), se src/lib/store-billing/.
-- Rent additiv: nullable kolonner på subscriptions og en ny tabel. Beta og
-- prod deler database, så intet her må ændre eller kræve eksisterende data.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "store_provider" varchar(20);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "store_product_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "store_original_transaction_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "store_purchase_token" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "store_environment" varchar(20);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "store_status" varchar(30);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "store_last_event_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_store_original_tx_idx" ON "subscriptions" USING btree ("store_original_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_store_purchase_token_idx" ON "subscriptions" USING btree ("store_purchase_token");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(20) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"notification_type" varchar(80),
	"subscription_id" uuid,
	"outcome" varchar(30),
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_billing_events" ADD CONSTRAINT "store_billing_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_billing_events_provider_event_idx" ON "store_billing_events" USING btree ("provider","event_id");
