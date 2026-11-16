CREATE TABLE IF NOT EXISTS "tags" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" VARCHAR(50) NOT NULL,
  "color" VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_user_name_idx" ON "tags" ("user_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entry_tags" (
  "entry_id" UUID NOT NULL REFERENCES "time_entries"("id") ON DELETE CASCADE,
  "tag_id" UUID NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  "inherited" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("entry_id", "tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_tags" (
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "tag_id" UUID NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("project_id", "tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_tags" (
  "client_id" UUID NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "tag_id" UUID NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("client_id", "tag_id")
);
