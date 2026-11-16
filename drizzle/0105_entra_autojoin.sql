-- E12 (#470): Entra ID auto-join pr. org — verificerede domæner (DNS TXT),
-- tenant-binding, kun-SSO, 2FA-krav for ledere og DPA-accept. Idempotent
-- (IF NOT EXISTS-guards) — se migrationskæde-incident (#408).
CREATE TABLE IF NOT EXISTS "org_dpa_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"version" varchar(20) NOT NULL,
	"accepted_by" text,
	"accepted_by_email" varchar(255) NOT NULL,
	"accepted_by_name" varchar(255),
	"ip_address" varchar(64),
	"user_agent" text,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_verified_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"verification_token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp,
	"last_checked_at" timestamp,
	"last_check_error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "sso_tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "auto_join_default_role" varchar(20) DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "require_sso_for_domains" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "require_two_factor_for_managers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_dpa_acceptances" ADD CONSTRAINT "org_dpa_acceptances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_dpa_acceptances" ADD CONSTRAINT "org_dpa_acceptances_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_verified_domains" ADD CONSTRAINT "org_verified_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_verified_domains" ADD CONSTRAINT "org_verified_domains_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_dpa_acceptances_org_version_unique" ON "org_dpa_acceptances" USING btree ("organization_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_verified_domains_org_domain_unique" ON "org_verified_domains" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_verified_domains_verified_unique" ON "org_verified_domains" USING btree ("domain") WHERE "org_verified_domains"."status" = 'verified';