-- Idempotensnøgler på token-API'ets create-procedurer (desktop 0.2.23):
-- samme nøgle fra samme bruger/org inden for 24 timer giver det oprindelige
-- objekt. Rent additiv.
CREATE TABLE IF NOT EXISTS "device_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"org_key" text NOT NULL,
	"scope" varchar(32) NOT NULL,
	"key" varchar(64) NOT NULL,
	"result_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_idempotency_keys" ADD CONSTRAINT "device_idempotency_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_idempotency_keys_uq" ON "device_idempotency_keys" USING btree ("user_id","org_key","scope","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_idempotency_keys_created_idx" ON "device_idempotency_keys" USING btree ("created_at");
