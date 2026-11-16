-- Migration: 0022_admin_monitoring_tables.sql
-- Creates cron job logs, email delivery logs, and admin user notes tables

-- Cron Job Logs table
CREATE TABLE IF NOT EXISTS "cron_job_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_name" varchar(100) NOT NULL,
  "status" varchar(20) NOT NULL,
  "started_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "duration_ms" integer,
  "items_processed" integer DEFAULT 0,
  "items_succeeded" integer DEFAULT 0,
  "items_failed" integer DEFAULT 0,
  "error_message" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cron_job_logs_job_name_idx" ON "cron_job_logs"("job_name");
CREATE INDEX IF NOT EXISTS "cron_job_logs_started_at_idx" ON "cron_job_logs"("started_at");

-- Email Delivery Logs table
CREATE TABLE IF NOT EXISTS "email_delivery_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" varchar(255),
  "to" varchar(255) NOT NULL,
  "subject" varchar(500) NOT NULL,
  "template_type" varchar(50) NOT NULL,
  "status" varchar(20) NOT NULL,
  "error_message" text,
  "user_id" text REFERENCES "user"(id) ON DELETE SET NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "delivered_at" timestamp,
  "bounced_at" timestamp,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_delivery_logs_template_type_idx" ON "email_delivery_logs"("template_type");
CREATE INDEX IF NOT EXISTS "email_delivery_logs_status_idx" ON "email_delivery_logs"("status");
CREATE INDEX IF NOT EXISTS "email_delivery_logs_sent_at_idx" ON "email_delivery_logs"("sent_at");
CREATE INDEX IF NOT EXISTS "email_delivery_logs_user_id_idx" ON "email_delivery_logs"("user_id");

-- Admin User Notes table
CREATE TABLE IF NOT EXISTS "admin_user_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "author_id" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "content" text NOT NULL,
  "is_important" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_user_notes_user_id_idx" ON "admin_user_notes"("user_id");
CREATE INDEX IF NOT EXISTS "admin_user_notes_author_id_idx" ON "admin_user_notes"("author_id");
