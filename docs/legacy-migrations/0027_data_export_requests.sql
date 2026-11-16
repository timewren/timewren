-- Data Export Requests table for GDPR and selective data exports
CREATE TABLE IF NOT EXISTS "data_export_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "request_type" varchar(20) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "format" varchar(10) NOT NULL DEFAULT 'json',
  "data_types" text[],
  "date_from" timestamp,
  "date_to" timestamp,
  "download_token" varchar(64) UNIQUE NOT NULL,
  "expires_at" timestamp NOT NULL,
  "processed_at" timestamp,
  "downloaded_at" timestamp,
  "file_size_bytes" integer,
  "error_message" text,
  "request_ip" varchar(45),
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Index for finding pending exports
CREATE INDEX IF NOT EXISTS "data_export_requests_status_idx" ON "data_export_requests" ("status");
-- Index for looking up by user
CREATE INDEX IF NOT EXISTS "data_export_requests_user_id_idx" ON "data_export_requests" ("user_id");
-- Index for token lookup
CREATE INDEX IF NOT EXISTS "data_export_requests_token_idx" ON "data_export_requests" ("download_token");
