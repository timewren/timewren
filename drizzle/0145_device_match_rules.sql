-- Bekræftede matchningsregler til desktop 1.0 og udvidelsen (domæne, URL,
-- repo, app, titel → projekt/kunde). Rent additiv. Kun bekræftede regler
-- gemmes, aldrig rå aktivitet (spec D3).
CREATE TABLE IF NOT EXISTS "device_match_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"pattern" varchar(500) NOT NULL,
	"project_id" uuid,
	"client_id" uuid,
	"source" varchar(16) DEFAULT 'desktop' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_match_rules" ADD CONSTRAINT "device_match_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_match_rules" ADD CONSTRAINT "device_match_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_match_rules" ADD CONSTRAINT "device_match_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_match_rules" ADD CONSTRAINT "device_match_rules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_match_rules_scope_uq" ON "device_match_rules" USING btree ("user_id","organization_id","kind","pattern");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_match_rules_user_updated_idx" ON "device_match_rules" USING btree ("user_id","organization_id","updated_at");
