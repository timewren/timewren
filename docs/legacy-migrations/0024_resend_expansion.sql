-- Migration: Resend Feature Expansion
-- Adds sent_emails, email_events tables, resend_contact_id on users, product_updates on email_preferences

-- Sent Emails table for tracking all outgoing emails
CREATE TABLE IF NOT EXISTS "sent_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resend_email_id" varchar(255) UNIQUE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "email_type" varchar(50) NOT NULL,
  "recipient_email" varchar(255) NOT NULL,
  "subject" varchar(500),
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "latest_status" varchar(30) NOT NULL DEFAULT 'sent',
  "sent_at" timestamp NOT NULL DEFAULT now(),
  "delivered_at" timestamp,
  "opened_at" timestamp,
  "bounced_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sent_emails_user_id_idx" ON "sent_emails" ("user_id");
CREATE INDEX IF NOT EXISTS "sent_emails_email_type_idx" ON "sent_emails" ("email_type");
CREATE INDEX IF NOT EXISTS "sent_emails_invoice_id_idx" ON "sent_emails" ("invoice_id");
CREATE INDEX IF NOT EXISTS "sent_emails_resend_email_id_idx" ON "sent_emails" ("resend_email_id");

-- Email Events table for delivery tracking
CREATE TABLE IF NOT EXISTS "email_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resend_email_id" varchar(255) NOT NULL,
  "event_type" varchar(30) NOT NULL,
  "metadata" jsonb,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_events_resend_email_id_idx" ON "email_events" ("resend_email_id");
CREATE INDEX IF NOT EXISTS "email_events_event_type_idx" ON "email_events" ("event_type");

-- Add resend_contact_id to users table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "resend_contact_id" varchar(255);

-- Add product_updates to email_preferences table
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "product_updates" boolean DEFAULT true;
