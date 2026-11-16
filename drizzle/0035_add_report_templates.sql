CREATE TABLE IF NOT EXISTS "report_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "name" varchar(120) NOT NULL,
  "description" text,
  "client_id" uuid,
  "config" jsonb NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_system" boolean NOT NULL DEFAULT false,
  "usage_count" integer NOT NULL DEFAULT 0,
  "last_used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "report_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "report_templates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_templates_user_id_idx" ON "report_templates" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_templates_user_client_idx" ON "report_templates" ("user_id", "client_id");
