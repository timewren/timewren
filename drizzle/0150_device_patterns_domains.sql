-- Desktop 0.2.23: kundens domæner, "ikke arbejde"-regler og lærte mønstre
-- fra detektionen (generaliserede nøgler, aldrig rå aktivitet, spec D3).
-- Rent additiv.
CREATE TABLE IF NOT EXISTS "device_learned_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"pattern" jsonb NOT NULL,
	"votes" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "domains" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "device_match_rules" ADD COLUMN IF NOT EXISTS "not_work" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_learned_patterns" ADD CONSTRAINT "device_learned_patterns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_learned_patterns" ADD CONSTRAINT "device_learned_patterns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_learned_patterns_key_uq" ON "device_learned_patterns" USING btree ("user_id","organization_id","key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_learned_patterns_user_updated_idx" ON "device_learned_patterns" USING btree ("user_id","organization_id","updated_at");
