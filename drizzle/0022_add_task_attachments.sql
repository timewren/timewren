CREATE TABLE IF NOT EXISTS "task_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "filename" varchar(255) NOT NULL,
  "content_type" varchar(255) NOT NULL,
  "size_bytes" integer NOT NULL,
  "content" bytea NOT NULL,
  "source_email_id" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "task_attachments_task_id_idx" ON "task_attachments" USING btree ("task_id");
CREATE INDEX IF NOT EXISTS "task_attachments_user_id_idx" ON "task_attachments" USING btree ("user_id");
