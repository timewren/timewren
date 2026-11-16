-- Lokal → cloud-import fra desktop 1.0: lokalt id → server-id, så importen
-- er idempotent. Rent additiv.
CREATE TABLE IF NOT EXISTS "device_import_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity" varchar(16) NOT NULL,
	"local_id" varchar(64) NOT NULL,
	"server_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_import_map" ADD CONSTRAINT "device_import_map_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_import_map" ADD CONSTRAINT "device_import_map_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_import_map_local_uq" ON "device_import_map" USING btree ("organization_id","user_id","entity","local_id");
