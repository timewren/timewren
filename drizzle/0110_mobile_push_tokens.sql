-- Native mobilapp: Expo Push-tokens (ExponentPushToken[...]) pr. enhed.
-- Idempotent (IF NOT EXISTS / duplicate_object-guards) — se migrationskæde-incident.
CREATE TABLE IF NOT EXISTS "mobile_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"token" text NOT NULL,
	"platform" varchar(10) NOT NULL,
	"device_name" text,
	"app_version" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_push_tokens_user_idx" ON "mobile_push_tokens" USING btree ("user_id");
