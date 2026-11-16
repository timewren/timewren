-- Migration: Add email-to-task integration tables

CREATE TABLE IF NOT EXISTS "email_integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "imap_host" varchar(255) NOT NULL,
  "imap_port" integer NOT NULL DEFAULT 993,
  "imap_username" varchar(255) NOT NULL,
  "imap_password" text NOT NULL,
  "imap_use_ssl" boolean NOT NULL DEFAULT true,
  "sync_enabled" boolean NOT NULL DEFAULT true,
  "sync_frequency_minutes" integer NOT NULL DEFAULT 15,
  "last_synced_at" timestamp,
  "last_sync_status" varchar(20),
  "last_sync_error" text,
  "target_mailbox" varchar(100) NOT NULL DEFAULT 'INBOX',
  "processed_emails_count" integer NOT NULL DEFAULT 0,
  "consecutive_sync_failures" integer NOT NULL DEFAULT 0,
  "sync_disabled_until" timestamp,
  "sender_whitelist" text[],
  "sender_blacklist" text[],
  "subject_filters" text[],
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "email_integrations_user_id_unique" ON "email_integrations" ("user_id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "email_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "message_id" varchar(255) NOT NULL,
  "thread_id" varchar(255),
  "in_reply_to" varchar(255),
  "references" text[],
  "subject" text NOT NULL,
  "from_email" varchar(255) NOT NULL,
  "from_name" varchar(255),
  "to_emails" text[] NOT NULL,
  "cc_emails" text[],
  "received_date" timestamp NOT NULL,
  "body_text" text,
  "body_html" text,
  "attachments" jsonb,
  "is_processed" boolean NOT NULL DEFAULT false,
  "processing_error" text,
  "matched_client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "match_confidence" decimal(3,2),
  "is_read" boolean DEFAULT false,
  "is_flagged" boolean DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "email_threads_user_message_id_unique" ON "email_threads" ("user_id", "message_id");
CREATE INDEX IF NOT EXISTS "email_threads_message_id_idx" ON "email_threads" ("message_id");
CREATE INDEX IF NOT EXISTS "email_threads_thread_id_idx" ON "email_threads" ("thread_id");
CREATE INDEX IF NOT EXISTS "email_threads_task_id_idx" ON "email_threads" ("task_id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "email_sync_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "job_type" varchar(50) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL,
  "priority" integer NOT NULL DEFAULT 5,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "scheduled_for" timestamp NOT NULL DEFAULT now(),
  "started_at" timestamp,
  "completed_at" timestamp,
  "error_message" text,
  "error_stack" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "email_sync_queue_status_priority_idx" ON "email_sync_queue" ("status", "priority", "scheduled_for");
