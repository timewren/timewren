ALTER TABLE "desktop_license" ADD COLUMN "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "desktop_license" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
CREATE INDEX "desktop_licenses_stripe_customer_idx" ON "desktop_license" USING btree ("stripe_customer_id");