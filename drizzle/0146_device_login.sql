-- Enheds-login til desktop 1.0: enhedsinfo og refresh-token på
-- extension_tokens samt engangskoder fra browser-godkendelsen. Rent additiv;
-- eksisterende tokens (udvidelsen, manuelle) får null i de nye kolonner.
CREATE TABLE IF NOT EXISTS "device_auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"state" varchar(256) NOT NULL,
	"code_challenge" varchar(128) NOT NULL,
	"device_id" varchar(128) NOT NULL,
	"device_name" varchar(255),
	"device_os" varchar(50),
	"client_kind" varchar(16) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_auth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "device_id" varchar(128);--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "device_name" varchar(255);--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "device_os" varchar(50);--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "client_kind" varchar(16);--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "refresh_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "refresh_expires_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_auth_codes" ADD CONSTRAINT "device_auth_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_auth_codes" ADD CONSTRAINT "device_auth_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_auth_codes_user_idx" ON "device_auth_codes" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
