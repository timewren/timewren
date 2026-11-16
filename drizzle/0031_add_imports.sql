CREATE TABLE IF NOT EXISTS "imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "source" varchar(20) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'pending',
  "preview_data" jsonb,
  "conflict_resolutions" jsonb,
  "id_mapping" jsonb,
  "total_entries" integer NOT NULL DEFAULT 0,
  "processed_entries" integer NOT NULL DEFAULT 0,
  "imported_entries" integer NOT NULL DEFAULT 0,
  "skipped_entries" integer NOT NULL DEFAULT 0,
  "failed_entries" integer NOT NULL DEFAULT 0,
  "results" jsonb,
  "errors" jsonb DEFAULT '[]',
  "credentials" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "started_at" timestamp,
  "completed_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "imports_user_id_status_idx" ON "imports" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "imports_status_idx" ON "imports" ("status");

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "timeops_api_key" text;
