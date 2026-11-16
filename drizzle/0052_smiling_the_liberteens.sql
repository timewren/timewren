CREATE TABLE IF NOT EXISTS "desktop_license_device" (
	"id" text PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"machine_id" varchar(255) NOT NULL,
	"device_name" varchar(255),
	"os" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "desktop_license" ADD COLUMN IF NOT EXISTS "email" varchar(255);--> statement-breakpoint
ALTER TABLE "desktop_license" ADD COLUMN IF NOT EXISTS "stripe_payment_intent_id" varchar(255);--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'desktop_license_device_license_id_desktop_license_id_fk') THEN
  ALTER TABLE "desktop_license_device" ADD CONSTRAINT "desktop_license_device_license_id_desktop_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."desktop_license"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_license_device_license_id_idx" ON "desktop_license_device" USING btree ("license_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "desktop_license_device_license_machine_unique" ON "desktop_license_device" USING btree ("license_id","machine_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_licenses_stripe_pi_idx" ON "desktop_license" USING btree ("stripe_payment_intent_id");
