CREATE TABLE IF NOT EXISTS "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"event" varchar(50) NOT NULL,
	"source" varchar(20) DEFAULT 'web' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_events_user_id_user_id_fk') THEN
    ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_events_event_idx" ON "product_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_events_user_idx" ON "product_events" USING btree ("user_id","created_at");