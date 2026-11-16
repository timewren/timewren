-- Migration: 0023_email_forwarding.sql
-- Creates email forwarding rules and logs tables for Resend inbound webhook handling

-- Email Forwarding Rules table
CREATE TABLE IF NOT EXISTS "email_forwarding_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "description" text,
  "from_pattern" varchar(255) NOT NULL,
  "to_address" varchar(255) NOT NULL,
  "to_pattern" varchar(255),
  "is_active" boolean NOT NULL DEFAULT true,
  "forward_attachments" boolean NOT NULL DEFAULT true,
  "subject_prefix" varchar(100),
  "match_count" integer NOT NULL DEFAULT 0,
  "last_matched_at" timestamp,
  "created_by" text REFERENCES "user"(id) ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_fwd_rules_from_pattern_idx" ON "email_forwarding_rules"("from_pattern");
CREATE INDEX IF NOT EXISTS "email_fwd_rules_is_active_idx" ON "email_forwarding_rules"("is_active");

-- Email Forwarding Logs table
CREATE TABLE IF NOT EXISTS "email_forwarding_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_id" uuid REFERENCES "email_forwarding_rules"(id) ON DELETE SET NULL,
  "resend_email_id" varchar(255) NOT NULL,
  "from_address" varchar(255) NOT NULL,
  "to_address" varchar(255) NOT NULL,
  "original_to" varchar(255) NOT NULL,
  "subject" varchar(500),
  "status" varchar(20) NOT NULL,
  "forwarded_message_id" varchar(255),
  "error_message" text,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "forwarded_at" timestamp,
  "metadata" jsonb
);

CREATE INDEX IF NOT EXISTS "email_fwd_logs_rule_id_idx" ON "email_forwarding_logs"("rule_id");
CREATE INDEX IF NOT EXISTS "email_fwd_logs_status_idx" ON "email_forwarding_logs"("status");
CREATE INDEX IF NOT EXISTS "email_fwd_logs_received_at_idx" ON "email_forwarding_logs"("received_at");
CREATE INDEX IF NOT EXISTS "email_fwd_logs_from_address_idx" ON "email_forwarding_logs"("from_address");
