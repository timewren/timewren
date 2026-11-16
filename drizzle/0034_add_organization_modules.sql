CREATE TABLE IF NOT EXISTS "organization_modules" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "module_key" varchar(50) NOT NULL,
  "is_available" boolean NOT NULL DEFAULT false,
  "is_enabled" boolean NOT NULL DEFAULT false,
  "available_at" timestamp,
  "enabled_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" text,
  CONSTRAINT "organization_modules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "organization_modules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_modules_org_key_idx" ON "organization_modules" ("organization_id", "module_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_modules_org_idx" ON "organization_modules" ("organization_id");
