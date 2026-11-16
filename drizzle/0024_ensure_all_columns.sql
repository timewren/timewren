-- Ensure ALL columns from all migrations exist.
-- This covers databases created via db:push where migrations were baselined
-- but never actually executed. All statements are idempotent.

-- Migration 0001
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "invoice_id" uuid REFERENCES "invoices"("id");
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean DEFAULT false;

-- Migration 0003
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "theme" varchar(20) DEFAULT 'light';

-- Migration 0005
ALTER TABLE "prepaid_usage" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "prepaid_usage" ALTER COLUMN "time_entry_id" DROP NOT NULL;

-- Migration 0009
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "low_balance_alert_sent_at" timestamp;
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "expiry_alert_sent_at" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "prepaid_alert_recipient" varchar(20) DEFAULT 'owner';

-- Migration 0010
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "weekly_hour_goal" numeric(4, 1) DEFAULT '37.0';

-- Migration 0012: integration IDs
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "billy_id" varchar(255);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "dinero_id" varchar(255);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "economic_customer_number" integer;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "billy_invoice_id" varchar(255);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "dinero_invoice_guid" varchar(255);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "economic_invoice_number" integer;

-- Migration 0012: recurring template pausing
ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "is_paused" boolean DEFAULT false;
ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "paused_until" timestamp;
ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "pause_reason" varchar(255);

-- Migration 0012: users integration fields
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone_number" varchar(50);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_app_secret_token" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_agreement_grant_token" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "billy_default_account_id" varchar(255);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_default_account_number" integer;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_default_layout_number" integer;

-- Migration 0012: email preferences
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "monthly_report_day" integer DEFAULT 1;
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "unbilled_reminder_frequency" varchar(20) DEFAULT 'weekly';
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "inactivity_reminder_days" integer DEFAULT 7;
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_enabled" boolean DEFAULT false;
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_start" varchar(10) DEFAULT '22:00';
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_end" varchar(10) DEFAULT '08:00';
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "digest_mode" boolean DEFAULT false;
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "digest_frequency" varchar(20) DEFAULT 'daily';

-- Migration 0014: tasks AI fields
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" uuid;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "estimated_minutes" integer;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "actual_minutes" integer;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_type" varchar(20) DEFAULT 'manual';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_id" varchar(255);
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_url" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_suggested_project" uuid;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_suggested_client" uuid;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_suggested_priority" varchar(20);
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_suggested_deadline" timestamp;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_confidence" numeric(3, 2);
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_processed_at" timestamp;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "calendar_event_id" uuid;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "active_time_entry_id" uuid;

-- Migration 0014: users AI config
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "inbound_email_id" varchar(32);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ai_autonomy_level" varchar(20) DEFAULT 'auto_all';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ai_email_processing" boolean DEFAULT true;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "working_hours_start" varchar(5) DEFAULT '09:00';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "working_hours_end" varchar(5) DEFAULT '17:00';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "working_days" text[] DEFAULT '{"1","2","3","4","5"}';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "timezone" varchar(50) DEFAULT 'Europe/Copenhagen';

-- Migration 0015: security features
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;
ALTER TABLE "passkey" ADD COLUMN IF NOT EXISTS "aaguid" text;

-- Migration 0018: timer states columns
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent" varchar(20);
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent_at" timestamp;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent_from" varchar(20);
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "is_idle" boolean DEFAULT false;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "idle_detected_at" timestamp;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "idle_threshold_minutes" integer DEFAULT 5;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp;

-- Missing from initial migration: projects.url_patterns
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "url_patterns" jsonb DEFAULT '[]';

-- Missing from initial migration: prepaid_packages.is_archived
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false;

-- Migration 0020: drip emails preference
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "drip_emails" boolean DEFAULT true;

-- Migration 0023: template optional fields
ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "client_id" UUID REFERENCES "clients"("id");
ALTER TABLE "recurring_time_templates" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "recurring_time_templates" ALTER COLUMN "frequency" DROP NOT NULL;
ALTER TABLE "recurring_time_templates" ALTER COLUMN "start_date" DROP NOT NULL;
ALTER TABLE "recurring_time_templates" ALTER COLUMN "next_due" DROP NOT NULL;
