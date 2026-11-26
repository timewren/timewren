import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  baselineUntrackedDatabase,
  bootstrapEmptyDatabase,
  migrateDatabase,
} from "./lib/migration-bootstrap";
import {
  acquireMigrationLock,
  lockTimeoutFromEnv,
  MIGRATION_LOCK_KEY,
  postgresLockClient,
} from "./lib/migration-lock";

// Load .env.local in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/freelance_crm";

async function checkTableExists(
  db: PostgresJsDatabase<Record<string, never>>,
  tableName: string,
): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      );
    `);
    return (result[0] as { exists: boolean })?.exists || false;
  } catch {
    return false;
  }
}

async function checkUserIdType(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<"text" | "uuid" | "missing"> {
  try {
    // Better Auth uses singular table name "user"
    const result = await db.execute(sql`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'user'
      AND column_name = 'id';
    `);
    const dataType = (result[0] as { data_type?: string })?.data_type;
    if (dataType === "text" || dataType === "uuid") {
      return dataType;
    }
    return "missing";
  } catch {
    return "missing";
  }
}

async function checkDrizzleMigrationsExist(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'drizzle'
        AND table_name = '__drizzle_migrations'
      );
    `);
    return (result[0] as { exists: boolean })?.exists || false;
  } catch {
    return false;
  }
}

async function getMigrationCount(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<number> {
  try {
    const result = await db.execute(
      sql`SELECT COUNT(*) as count FROM drizzle.__drizzle_migrations`,
    );
    return Number((result[0] as { count: string })?.count) || 0;
  } catch {
    return 0;
  }
}

/**
 * Apply ALL idempotent ADD COLUMN patches from migrations that may have
 * been baselined but never actually executed on the database.
 * Each statement uses IF NOT EXISTS so it's safe to run repeatedly.
 */
async function applySchemaPatches(
  db: PostgresJsDatabase<Record<string, never>>,
) {
  console.log("🔧 Applying schema patches (idempotent)...");

  const patches = [
    // Migration 0001: time_entries + users
    `ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "invoice_id" uuid REFERENCES "invoices"("id")`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean DEFAULT false`,

    // Migration 0003: users theme
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "theme" varchar(20) DEFAULT 'light'`,

    // Migration 0005: prepaid_usage
    `ALTER TABLE "prepaid_usage" ADD COLUMN IF NOT EXISTS "description" text`,

    // Migration 0009: prepaid_packages alerts + users
    `ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "low_balance_alert_sent_at" timestamp`,
    `ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "expiry_alert_sent_at" timestamp`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "prepaid_alert_recipient" varchar(20) DEFAULT 'owner'`,

    // Migration 0010: users weekly hour goal
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "weekly_hour_goal" numeric(4, 1) DEFAULT '37.0'`,

    // Migration 0012: integration IDs + recurring template pausing
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "billy_id" varchar(255)`,
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "dinero_id" varchar(255)`,
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "economic_customer_number" integer`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "billy_invoice_id" varchar(255)`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "dinero_invoice_guid" varchar(255)`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "economic_invoice_number" integer`,
    `ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "is_paused" boolean DEFAULT false`,
    `ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "paused_until" timestamp`,
    `ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "pause_reason" varchar(255)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone_number" varchar(50)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean DEFAULT false`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_app_secret_token" text`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_agreement_grant_token" text`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "billy_default_account_id" varchar(255)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_default_account_number" integer`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_default_layout_number" integer`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_default_product_number" varchar(50)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_klippekort_product_number" varchar(50)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_default_payment_terms_number" integer`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_line_type" varchar(20) DEFAULT 'per_entry'`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "economic_line_template" text DEFAULT '{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}'`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "monthly_report_day" integer DEFAULT 1`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "unbilled_reminder_frequency" varchar(20) DEFAULT 'weekly'`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "inactivity_reminder_days" integer DEFAULT 7`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_enabled" boolean DEFAULT false`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_start" varchar(10) DEFAULT '22:00'`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "quiet_hours_end" varchar(10) DEFAULT '08:00'`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "digest_mode" boolean DEFAULT false`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "digest_frequency" varchar(20) DEFAULT 'daily'`,

    // Migration 0014: tasks AI fields + users AI config
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" uuid`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "estimated_minutes" integer`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "actual_minutes" integer`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_type" varchar(20) DEFAULT 'manual'`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_id" varchar(255)`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_url" text`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_suggested_project" uuid`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_suggested_client" uuid`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_suggested_priority" varchar(20)`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_suggested_deadline" timestamp`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_confidence" numeric(3, 2)`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_processed_at" timestamp`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "calendar_event_id" uuid`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "active_time_entry_id" uuid`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "inbound_email_id" varchar(32)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ai_autonomy_level" varchar(20) DEFAULT 'auto_all'`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ai_email_processing" boolean DEFAULT true`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "working_hours_start" varchar(5) DEFAULT '09:00'`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "working_hours_end" varchar(5) DEFAULT '17:00'`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "working_days" text[] DEFAULT '{"1","2","3","4","5"}'`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "timezone" varchar(50) DEFAULT 'Europe/Copenhagen'`,

    // Migration 0015: security features
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false`,
    `ALTER TABLE "passkey" ADD COLUMN IF NOT EXISTS "aaguid" text`,

    // Migration 0018: timer states columns
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent" varchar(20)`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent_at" timestamp`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent_from" varchar(20)`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "is_idle" boolean DEFAULT false`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "idle_detected_at" timestamp`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "idle_threshold_minutes" integer DEFAULT 5`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp`,

    // Missing from initial migration
    `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "url_patterns" jsonb DEFAULT '[]'`,
    `ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false`,

    // Dinero line template settings (mirrors Billy)
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_line_type" varchar(20) DEFAULT 'per_entry'`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_line_template" text DEFAULT '{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}'`,

    // Migration 0020: drip emails preference
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "drip_emails" boolean DEFAULT true`,

    // Inactivity email cooldown tracking
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "last_inactivity_email_sent_at" timestamp`,

    // Migration 0023: template optional fields + clientId
    `ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "client_id" UUID REFERENCES "clients"("id")`,

    // Founding member tier columns on subscriptions
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "founding_tier" varchar(30)`,
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "discount_percent" integer DEFAULT 0`,
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "discount_expires_at" timestamp`,

    // Stripe webhook idempotency + past_due grace period
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "past_due_since" timestamp`,

    // Calendar sync enhancements
    `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "sync_token" text`,
    `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "sync_filters" jsonb`,
    `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "privacy_mode" varchar(20) DEFAULT 'off'`,
    `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "auto_track_mode" varchar(20) DEFAULT 'off'`,
    `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "default_project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL`,
    `ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "linked_time_entry_id" uuid REFERENCES "time_entries"("id") ON DELETE SET NULL`,
    `ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "response_status" varchar(20)`,

    // Calendar matching rules
    `CREATE TABLE IF NOT EXISTS "calendar_matching_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "pattern" varchar(255) NOT NULL,
      "project_id" uuid REFERENCES "projects"("id") ON DELETE CASCADE,
      "client_id" uuid REFERENCES "clients"("id") ON DELETE CASCADE,
      "match_count" integer NOT NULL DEFAULT 0,
      "last_matched_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS "email_filter_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "rule_type" varchar(30) NOT NULL,
      "pattern" varchar(255) NOT NULL,
      "source_task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL,
      "source_email_subject" text,
      "source_email_from" varchar(255),
      "is_active" boolean NOT NULL DEFAULT true,
      "match_count" integer NOT NULL DEFAULT 0,
      "last_matched_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now(),
      UNIQUE("user_id", "rule_type", "pattern")
    )`,

    `CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "stripe_event_id" varchar(255) NOT NULL UNIQUE,
      "event_type" varchar(100) NOT NULL,
      "processed_at" timestamp NOT NULL DEFAULT now(),
      "status" varchar(20) NOT NULL DEFAULT 'success',
      "error_message" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,

    // Email IMAP sync improvements
    // F3: UID-based sync tracking
    `ALTER TABLE "email_integrations" ADD COLUMN IF NOT EXISTS "uid_validity" integer`,
    `ALTER TABLE "email_integrations" ADD COLUMN IF NOT EXISTS "highest_processed_uid" integer`,
    `ALTER TABLE "email_integrations" ADD COLUMN IF NOT EXISTS "last_heartbeat" timestamp`,
    `ALTER TABLE "email_integrations" ADD COLUMN IF NOT EXISTS "client_domains_only" boolean DEFAULT false NOT NULL`,

    // F2: Thread grouping
    `ALTER TABLE "email_threads" ADD COLUMN IF NOT EXISTS "conversation_id" varchar(255)`,
    `ALTER TABLE "email_threads" ADD COLUMN IF NOT EXISTS "thread_position" integer`,
    `ALTER TABLE "email_threads" ADD COLUMN IF NOT EXISTS "sender_priority" varchar(10) DEFAULT 'normal'`,
    `ALTER TABLE "email_threads" ADD COLUMN IF NOT EXISTS "subject_domain_hash" varchar(32)`,
    `CREATE INDEX IF NOT EXISTS "email_threads_conversation_id_idx" ON "email_threads" ("conversation_id")`,
    `CREATE INDEX IF NOT EXISTS "email_threads_subject_domain_hash_idx" ON "email_threads" ("user_id", "subject_domain_hash")`,

    // F2/F5: Task email thread tracking + feedback
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "thread_email_count" integer DEFAULT 1`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "last_thread_update" timestamp`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "email_relevance_feedback" varchar(10)`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "feedback_provided_at" timestamp`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "notes" text`,

    // F1: Email classification cache
    `CREATE TABLE IF NOT EXISTS "email_classification_cache" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "sender_domain" varchar(255) NOT NULL,
      "is_actionable" boolean NOT NULL,
      "confidence" numeric(3, 2),
      "sample_count" integer NOT NULL DEFAULT 1,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "expires_at" timestamp NOT NULL,
      UNIQUE("user_id", "sender_domain")
    )`,

    // Alunta migration: new columns on subscriptions
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "alunta_subscription_id" varchar(255)`,
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "alunta_customer_id" varchar(255)`,
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "alunta_plan_id" varchar(255)`,

    // Alunta webhook events table
    `CREATE TABLE IF NOT EXISTS "webhook_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "event_id" varchar(255) NOT NULL UNIQUE,
      "source" varchar(50) NOT NULL DEFAULT 'alunta',
      "event_type" varchar(100) NOT NULL,
      "processed_at" timestamp NOT NULL DEFAULT now(),
      "status" varchar(20) NOT NULL DEFAULT 'success',
      "error_message" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,

    // Help feedback table
    `CREATE TABLE IF NOT EXISTS "help_feedback" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "question_key" VARCHAR(500) NOT NULL,
      "value" VARCHAR(10) NOT NULL,
      "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
      "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL,
      CONSTRAINT "help_feedback_user_question_unique" UNIQUE ("user_id", "question_key")
    )`,

    // Separate unbilled reminders from overdue alerts
    `ALTER TABLE "notification_channels" ADD COLUMN IF NOT EXISTS "send_unbilled_reminders" boolean DEFAULT true`,

    // Migration 0039: weekend notification filtering
    `ALTER TABLE "notification_channels" ADD COLUMN IF NOT EXISTS "active_days" integer[] DEFAULT '{0,1,2,3,4,5,6}' NOT NULL`,

    // Dinero OAuth 2.0 (Visma Connect)
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_refresh_token" text`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_token_expiry" timestamp`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_org_name" varchar(255)`,

    // Klippekort clip size (rounds deductions up to nearest clip)
    `ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "clip_size_minutes" integer`,

    // Rounding columns
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "rounding_enabled" BOOLEAN`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "rounding_minutes" INTEGER`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "rounding_method" VARCHAR(10)`,
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_enabled" BOOLEAN`,
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_minutes" INTEGER`,
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_method" VARCHAR(10)`,
    `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_enabled" BOOLEAN`,
    `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_minutes" INTEGER`,
    `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_method" VARCHAR(10)`,

    // Multi-calendar support
    `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "calendar_color" VARCHAR(7)`,
    `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "parent_connection_id" UUID`,
    // FK constraint for parent_connection_id (self-reference, cascade delete)
    `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'calendar_connections_parent_connection_id_fkey'
      ) THEN
        ALTER TABLE "calendar_connections"
          ADD CONSTRAINT "calendar_connections_parent_connection_id_fkey"
          FOREIGN KEY ("parent_connection_id")
          REFERENCES "calendar_connections"("id")
          ON DELETE CASCADE;
      END IF;
    END $$`,
    // Matching rules source tracking
    `ALTER TABLE "calendar_matching_rules" ADD COLUMN IF NOT EXISTS "source" VARCHAR(20) NOT NULL DEFAULT 'manual'`,
    // i18n locale
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "locale" VARCHAR(10) DEFAULT 'da'`,

    // Klippekort templates — reusable package configurations
    `CREATE TABLE IF NOT EXISTS "prepaid_templates" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "name" varchar(255) NOT NULL,
      "total_hours" decimal(8, 2) NOT NULL,
      "hourly_rate" decimal(10, 2),
      "clip_size_minutes" integer,
      "description" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,

    // Migration 0025: API keys for Public REST API authentication
    `CREATE TABLE IF NOT EXISTS "api_keys" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "name" varchar(100) NOT NULL,
      "key_hash" varchar(64) NOT NULL UNIQUE,
      "key_prefix" varchar(16) NOT NULL,
      "scopes" jsonb NOT NULL DEFAULT '["*"]',
      "last_used_at" timestamp,
      "last_used_ip" varchar(45),
      "expires_at" timestamp,
      "is_revoked" boolean NOT NULL DEFAULT false,
      "revoked_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "api_keys_key_hash_idx" ON "api_keys" ("key_hash")`,

    // Tags - user-defined labels
    `CREATE TABLE IF NOT EXISTS "tags" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "name" varchar(50) NOT NULL,
      "color" varchar(7) NOT NULL DEFAULT '#3b82f6',
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "tags_user_name_idx" ON "tags" ("user_id", "name")`,

    `CREATE TABLE IF NOT EXISTS "time_entry_tags" (
      "entry_id" uuid NOT NULL REFERENCES "time_entries"("id") ON DELETE CASCADE,
      "tag_id" uuid NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
      "inherited" boolean NOT NULL DEFAULT false,
      "created_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("entry_id", "tag_id")
    )`,

    `CREATE TABLE IF NOT EXISTS "project_tags" (
      "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "tag_id" uuid NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
      "created_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("project_id", "tag_id")
    )`,

    `CREATE TABLE IF NOT EXISTS "client_tags" (
      "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
      "tag_id" uuid NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
      "created_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("client_id", "tag_id")
    )`,

    // Migration 0029: time approval workflow
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "approval_workflow" varchar(20) DEFAULT 'off'`,
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "approval_workflow" varchar(20)`,
    `ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'not_required'`,
    `ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approved_at" timestamp`,
    `ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approved_by" text`,
    `ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp`,
    `ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "rejection_reason" text`,
    `CREATE TABLE IF NOT EXISTS "time_approval_requests" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
      "type" varchar(20) NOT NULL,
      "period_start" date,
      "period_end" date,
      "invoice_id" uuid REFERENCES "invoices"("id"),
      "status" varchar(20) NOT NULL DEFAULT 'pending',
      "entry_ids" jsonb NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "responded_at" timestamp,
      "response_note" text
    )`,

    // Migration 0031: TimeOps import
    `CREATE TABLE IF NOT EXISTS "imports" (
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
  "last_processed_page" integer,
  "results" jsonb,
  "errors" jsonb DEFAULT '[]',
  "credentials" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "started_at" timestamp,
  "completed_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
)`,
    `CREATE INDEX IF NOT EXISTS "imports_user_id_status_idx" ON "imports" ("user_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "imports_status_idx" ON "imports" ("status")`,
    `ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "last_processed_page" integer`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "timeops_api_key" text`,

    // PERF: indexes for hot multi-tenant access patterns (audit 2026-04)
    `CREATE INDEX IF NOT EXISTS "clients_user_id_idx" ON "clients" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "clients_user_archived_idx" ON "clients" ("user_id", "is_archived")`,
    `CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "projects_client_id_idx" ON "projects" ("client_id")`,
    `CREATE INDEX IF NOT EXISTS "invoices_user_id_idx" ON "invoices" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "invoices_user_status_idx" ON "invoices" ("user_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "invoices_client_id_idx" ON "invoices" ("client_id")`,
    `CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_id_idx" ON "invoice_lines" ("invoice_id")`,
    `CREATE INDEX IF NOT EXISTS "tasks_user_id_idx" ON "tasks" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "tasks_user_status_idx" ON "tasks" ("user_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "tasks_project_id_idx" ON "tasks" ("project_id")`,
    `CREATE INDEX IF NOT EXISTS "tasks_client_id_idx" ON "tasks" ("client_id")`,
    `CREATE INDEX IF NOT EXISTS "tasks_parent_task_id_idx" ON "tasks" ("parent_task_id")`,
    `CREATE INDEX IF NOT EXISTS "prepaid_packages_user_id_idx" ON "prepaid_packages" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "prepaid_packages_client_id_idx" ON "prepaid_packages" ("client_id")`,
    `CREATE INDEX IF NOT EXISTS "prepaid_usage_package_id_idx" ON "prepaid_usage" ("prepaid_package_id")`,
    `CREATE INDEX IF NOT EXISTS "prepaid_usage_time_entry_id_idx" ON "prepaid_usage" ("time_entry_id")`,
    `CREATE INDEX IF NOT EXISTS "rate_history_user_id_idx" ON "rate_history" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "time_entries_user_invoice_idx" ON "time_entries" ("user_id", "invoice_id")`,
    `CREATE INDEX IF NOT EXISTS "time_entries_user_billed_idx" ON "time_entries" ("user_id", "is_billed")`,
    `CREATE INDEX IF NOT EXISTS "recurring_time_templates_user_id_idx" ON "recurring_time_templates" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "timer_templates_user_id_idx" ON "timer_templates" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "invoice_templates_user_id_idx" ON "invoice_templates" ("user_id")`,

    // Changelogs (What's New)
    `CREATE TABLE IF NOT EXISTS "changelogs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version" varchar(20) NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL,
  "published_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_seen_changelog_id" uuid`,

    // Admin settings (key-value config for admin notifications etc.)
    `CREATE TABLE IF NOT EXISTS "admin_settings" (
      "id" varchar(50) PRIMARY KEY,
      "value" text NOT NULL,
      "updated_at" timestamp NOT NULL DEFAULT now(),
      "updated_by" text REFERENCES "user"("id")
    )`,

    // Support inbox tables
    `CREATE TABLE IF NOT EXISTS "support_inboxes" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" varchar(255) NOT NULL UNIQUE,
      "name" varchar(100) NOT NULL,
      "color" varchar(7) NOT NULL DEFAULT '#3b82f6',
      "signature" text,
      "is_default" boolean NOT NULL DEFAULT false,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS "support_tickets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "subject" varchar(500) NOT NULL,
      "sender_email" varchar(255) NOT NULL,
      "sender_name" varchar(255) NOT NULL,
      "user_id" text REFERENCES "user"("id"),
      "inbox_id" uuid NOT NULL REFERENCES "support_inboxes"("id"),
      "status" varchar(20) NOT NULL DEFAULT 'open',
      "assigned_to" text REFERENCES "user"("id"),
      "priority" varchar(10) NOT NULL DEFAULT 'normal',
      "closed_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "support_tickets_inbox_id_idx" ON "support_tickets" ("inbox_id")`,
    `CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON "support_tickets" ("status")`,

    `CREATE TABLE IF NOT EXISTS "support_messages" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
      "direction" varchar(10) NOT NULL,
      "from_email" varchar(255) NOT NULL,
      "from_name" varchar(255) NOT NULL,
      "body" text NOT NULL,
      "body_text" text,
      "is_internal" boolean NOT NULL DEFAULT false,
      "message_id" varchar(255),
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "support_messages_ticket_id_idx" ON "support_messages" ("ticket_id")`,
    `CREATE INDEX IF NOT EXISTS "support_messages_message_id_idx" ON "support_messages" ("message_id")`,

    // ============================================
    // Enterprise Edition Tables
    // ============================================

    // Departments
    `CREATE TABLE IF NOT EXISTS "departments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" varchar(255) NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,

    // Employee profiles
    `CREATE TABLE IF NOT EXISTS "employee_profiles" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "department_id" uuid REFERENCES "departments"("id") ON DELETE SET NULL,
      "role" varchar(20) NOT NULL DEFAULT 'member',
      "employment_type" varchar(20) NOT NULL DEFAULT 'full_time',
      "weekly_hours" numeric(4, 1) NOT NULL DEFAULT '37.0',
      "conversion_factor" numeric(5, 3) NOT NULL DEFAULT '1.000',
      "manager_id" uuid REFERENCES "employee_profiles"("id") ON DELETE SET NULL,
      "start_date" date,
      "end_date" date,
      "is_active" boolean NOT NULL DEFAULT true,
      "vacation_days_per_year" integer NOT NULL DEFAULT 25,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`,
    `DROP INDEX IF EXISTS "employee_profiles_org_user_idx"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "employee_profiles_org_user_idx" ON "employee_profiles" ("organization_id", "user_id")`,
    `CREATE INDEX IF NOT EXISTS "employee_profiles_org_active_idx" ON "employee_profiles" ("organization_id", "is_active")`,
    `ALTER TABLE "employee_profiles" ADD COLUMN IF NOT EXISTS "is_self_scheduler" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "enforce_compliance_blocking" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "compliance_reference_period_months" integer NOT NULL DEFAULT 4`,

    // Absence types
    `CREATE TABLE IF NOT EXISTS "absence_types" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" varchar(255) NOT NULL,
      "color" varchar(7) DEFAULT '#3b82f6',
      "icon" varchar(50),
      "deducts_vacation" boolean NOT NULL DEFAULT false,
      "requires_approval" boolean NOT NULL DEFAULT true,
      "is_default" boolean NOT NULL DEFAULT false,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,

    // Absence requests
    `CREATE TABLE IF NOT EXISTS "absence_requests" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "absence_type_id" uuid NOT NULL REFERENCES "absence_types"("id"),
      "start_date" date NOT NULL,
      "end_date" date NOT NULL,
      "half_day_start" boolean NOT NULL DEFAULT false,
      "half_day_end" boolean NOT NULL DEFAULT false,
      "total_days" numeric(5, 2),
      "status" varchar(20) NOT NULL DEFAULT 'pending',
      "approved_by" text REFERENCES "user"("id") ON DELETE SET NULL,
      "approved_at" timestamp,
      "rejected_at" timestamp,
      "rejection_reason" text,
      "note" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "absence_requests_org_status_idx" ON "absence_requests" ("organization_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "absence_requests_user_org_idx" ON "absence_requests" ("user_id", "organization_id")`,

    // Holidays
    `CREATE TABLE IF NOT EXISTS "holidays" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text REFERENCES "organizations"("id") ON DELETE CASCADE,
      "date" date NOT NULL,
      "name" varchar(255) NOT NULL,
      "is_half_day" boolean NOT NULL DEFAULT false,
      "is_system" boolean NOT NULL DEFAULT false,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "holidays_org_date_idx" ON "holidays" ("organization_id", "date")`,

    // Flex entries
    `CREATE TABLE IF NOT EXISTS "flex_entries" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "date" date NOT NULL,
      "expected_hours" numeric(5, 2) NOT NULL DEFAULT '0',
      "actual_hours" numeric(5, 2) NOT NULL DEFAULT '0',
      "delta" numeric(5, 2) NOT NULL DEFAULT '0',
      "note" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      UNIQUE ("user_id", "date", "organization_id")
    )`,
    `CREATE INDEX IF NOT EXISTS "flex_entries_user_org_date_idx" ON "flex_entries" ("user_id", "organization_id", "date")`,

    // Vacation balances
    `CREATE TABLE IF NOT EXISTS "vacation_balances" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "year" integer NOT NULL,
      "total_days" numeric(5, 2) NOT NULL DEFAULT '0',
      "used_days" numeric(5, 2) NOT NULL DEFAULT '0',
      "remaining_days" numeric(5, 2) NOT NULL DEFAULT '0',
      "updated_at" timestamp NOT NULL DEFAULT now(),
      UNIQUE ("user_id", "year", "organization_id")
    )`,
    `CREATE INDEX IF NOT EXISTS "vacation_balances_user_year_org_idx" ON "vacation_balances" ("user_id", "year", "organization_id")`,

    // Better-Auth admin plugin (impersonation + ban). Adds impersonatedBy on
    // session + banned/banReason/banExpires on user. See admin plugin in
    // src/lib/auth.ts.
    `ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonatedBy" text`,
    `ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "activeOrganizationId" text`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ban_reason" text`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ban_expires" timestamp`,

    // Signup attribution (UTMs + referrer captured at signup via cookie)
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "attr_source" varchar(100)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "attr_medium" varchar(100)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "attr_campaign" varchar(200)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "attr_referrer" text`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "attr_landing_page" text`,

    // Demo/test flag so seed data doesn't pollute admin metrics
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false`,

    // Reports revamp: saved report templates
    `CREATE TABLE IF NOT EXISTS "report_templates" (
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
    )`,
    `CREATE INDEX IF NOT EXISTS "report_templates_user_id_idx" ON "report_templates" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "report_templates_user_client_idx" ON "report_templates" ("user_id", "client_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "report_templates_user_name_unique" ON "report_templates" ("user_id", "name")`,

    // Performance indexes on high-traffic FK columns (audit 2026-04-17)
    `CREATE INDEX IF NOT EXISTS "rate_history_user_id_idx" ON "rate_history" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "rate_history_client_id_idx" ON "rate_history" ("client_id")`,
    `CREATE INDEX IF NOT EXISTS "rate_history_project_id_idx" ON "rate_history" ("project_id")`,
    `CREATE INDEX IF NOT EXISTS "recurring_time_templates_user_id_idx" ON "recurring_time_templates" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "recurring_time_templates_client_id_idx" ON "recurring_time_templates" ("client_id")`,
    `CREATE INDEX IF NOT EXISTS "recurring_time_templates_project_id_idx" ON "recurring_time_templates" ("project_id")`,
    `CREATE INDEX IF NOT EXISTS "recurring_time_templates_next_due_idx" ON "recurring_time_templates" ("next_due") WHERE "is_active" = true`,
    `CREATE INDEX IF NOT EXISTS "generated_time_entries_template_id_idx" ON "generated_time_entries" ("recurring_template_id")`,
    `CREATE INDEX IF NOT EXISTS "prepaid_usage_package_id_idx" ON "prepaid_usage" ("prepaid_package_id")`,
    `CREATE INDEX IF NOT EXISTS "prepaid_usage_time_entry_id_idx" ON "prepaid_usage" ("time_entry_id")`,

    // Danish deadline personalization fields
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "company_type" varchar(30)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "vat_period" varchar(20)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "fiscal_year_end" varchar(5)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "has_employees" boolean DEFAULT false`,

    // Dinero org selector: pending OAuth table
    `CREATE TABLE IF NOT EXISTS "dinero_oauth_pending" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "encrypted_access_token" text NOT NULL,
      "encrypted_refresh_token" text NOT NULL,
      "token_expiry" timestamp NOT NULL,
      "organizations" jsonb NOT NULL,
      "expires_at" timestamp NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,

    // Dinero product mapping columns
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_product_guid_time" varchar(255)`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "dinero_product_guid_klippekort" varchar(255)`,

    // Billy klippekort product mapping
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "billy_klippekort_product_id" varchar(255)`,

    // Enterprise soft-delete columns
    `ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "absence_types" ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "holidays" ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false`,

    // ============================================
    // Org-scoped data migration: add organization_id to all user-data tables
    // ============================================
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "task_statuses" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "rate_history" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "timer_templates" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "invoice_templates" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "report_templates" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "integration_sync_logs" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "dashboard_preferences" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "notification_channels" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "prepaid_templates" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "data_export_requests" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "time_approval_requests" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "trusted_devices" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "ai_processing_logs" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "email_integrations" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "calendar_matching_rules" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "company_profiles" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "onboarding_progress" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "dinero_oauth_pending" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `ALTER TABLE "sent_emails" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,

    // Indexes for most queried org-scoped tables
    `CREATE INDEX IF NOT EXISTS "clients_org_id_idx" ON "clients" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "projects_org_id_idx" ON "projects" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "time_entries_org_id_idx" ON "time_entries" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "invoices_org_id_idx" ON "invoices" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "tasks_org_id_idx" ON "tasks" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "prepaid_packages_org_id_idx" ON "prepaid_packages" ("organization_id")`,

    `CREATE INDEX IF NOT EXISTS "sent_emails_org_id_idx" ON "sent_emails" ("organization_id")`,

    // Additional org-scoped indexes for frequently queried tables
    `CREATE INDEX IF NOT EXISTS "tags_org_id_idx" ON "tags" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "recurring_time_templates_org_id_idx" ON "recurring_time_templates" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "activity_logs_org_id_idx" ON "activity_logs" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "integration_sync_logs_org_id_idx" ON "integration_sync_logs" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "email_templates_org_id_idx" ON "email_templates" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "timer_templates_org_id_idx" ON "timer_templates" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "invoice_templates_org_id_idx" ON "invoice_templates" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "report_templates_org_id_idx" ON "report_templates" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "calendar_events_org_id_idx" ON "calendar_events" ("organization_id")`,
    `CREATE INDEX IF NOT EXISTS "time_approval_requests_org_id_idx" ON "time_approval_requests" ("organization_id")`,

    // Composite org-scoped indexes for hot query patterns
    `CREATE INDEX IF NOT EXISTS "clients_org_archived_idx" ON "clients" ("organization_id", "is_archived")`,
    `CREATE INDEX IF NOT EXISTS "time_entries_org_date_idx" ON "time_entries" ("organization_id", "date")`,
    `CREATE INDEX IF NOT EXISTS "time_entries_org_user_date_idx" ON "time_entries" ("organization_id", "user_id", "date")`,
    `CREATE INDEX IF NOT EXISTS "invoices_org_status_idx" ON "invoices" ("organization_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "tasks_org_status_idx" ON "tasks" ("organization_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "prepaid_packages_org_active_idx" ON "prepaid_packages" ("organization_id", "is_active")`,
    `CREATE INDEX IF NOT EXISTS "task_statuses_org_scope_idx" ON "task_statuses" ("organization_id", "scope", "project_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "task_statuses_org_scope_name_idx" ON "task_statuses" ("organization_id", "scope", COALESCE("project_id", '00000000-0000-0000-0000-000000000000'), "name")`,
    `CREATE INDEX IF NOT EXISTS "invitations_org_status_idx" ON "invitations" ("organization_id", "status")`,

    // Seat-based billing columns
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "seat_count" integer DEFAULT 1`,
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "max_seats" integer DEFAULT 1`,
    `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan_tier" varchar(20) DEFAULT 'solo'`,
    `UPDATE "subscriptions" SET seat_count = COALESCE(seat_count, 1), max_seats = COALESCE(max_seats, 1), plan_tier = COALESCE(plan_tier, 'solo') WHERE seat_count IS NULL OR max_seats IS NULL OR plan_tier IS NULL`,
    `ALTER TABLE "subscriptions" ALTER COLUMN "seat_count" SET NOT NULL`,
    `ALTER TABLE "subscriptions" ALTER COLUMN "max_seats" SET NOT NULL`,
    `ALTER TABLE "subscriptions" ALTER COLUMN "plan_tier" SET NOT NULL`,

    // Organization audit logs
    `CREATE TABLE IF NOT EXISTS "org_audit_logs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "actor_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "action" varchar(50) NOT NULL,
      "target_email" varchar(255),
      "target_user_id" text,
      "metadata" jsonb,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "org_audit_logs_org_id_idx" ON "org_audit_logs" ("organization_id", "created_at" DESC)`,

    // Recurring templates: template_type + multi-client join table
    `ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "template_type" varchar(20) NOT NULL DEFAULT 'time_entry'`,
    `CREATE TABLE IF NOT EXISTS "recurring_template_clients" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "template_id" uuid NOT NULL REFERENCES "recurring_time_templates"("id") ON DELETE CASCADE,
      "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
      "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "rtc_template_client_idx" ON "recurring_template_clients" ("template_id", "client_id")`,

    // Outgoing webhooks org-scoped
    `ALTER TABLE "outgoing_webhooks" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `CREATE INDEX IF NOT EXISTS "outgoing_webhooks_org_id_idx" ON "outgoing_webhooks" ("organization_id")`,

    // Company profiles: add org-scoped unique index (one profile per org)
    `CREATE UNIQUE INDEX IF NOT EXISTS "company_profiles_org_id_idx" ON "company_profiles" ("organization_id") WHERE "organization_id" IS NOT NULL`,

    // Company settings on company_profiles (moved from user row)
    `ALTER TABLE "company_profiles" ADD COLUMN IF NOT EXISTS "company_type" varchar(20)`,
    `ALTER TABLE "company_profiles" ADD COLUMN IF NOT EXISTS "vat_period" varchar(20)`,
    `ALTER TABLE "company_profiles" ADD COLUMN IF NOT EXISTS "fiscal_year_end" varchar(5)`,
    `ALTER TABLE "company_profiles" ADD COLUMN IF NOT EXISTS "has_employees" boolean`,

    // Portal branding org-scoped
    `ALTER TABLE "portal_branding" ADD COLUMN IF NOT EXISTS "organization_id" text REFERENCES "organizations"("id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "portal_branding_org_id_idx" ON "portal_branding" ("organization_id") WHERE "organization_id" IS NOT NULL`,

    // Client color
    `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "color" varchar(7)`,

    // Task comments table
    `CREATE TABLE IF NOT EXISTS "task_comments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "organization_id" text REFERENCES "organizations"("id"),
      "content" jsonb NOT NULL,
      "content_html" text NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "task_comments_task_id_idx" ON "task_comments" ("task_id")`,
    `CREATE INDEX IF NOT EXISTS "task_comments_user_id_idx" ON "task_comments" ("user_id")`,

    // Member rates table (per-member hourly rates scoped to project/client)
    `CREATE TABLE IF NOT EXISTS "member_rates" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "member_id" text NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
      "project_id" uuid REFERENCES "projects"("id") ON DELETE CASCADE,
      "client_id" uuid REFERENCES "clients"("id") ON DELETE CASCADE,
      "hourly_rate" decimal(10, 2) NOT NULL,
      "effective_from" timestamp NOT NULL DEFAULT now(),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "member_rates_lookup_idx" ON "member_rates" ("organization_id", "member_id", "project_id", "client_id")`,

    // Role permissions (per-org role-based access control)
    `CREATE TABLE IF NOT EXISTS "role_permissions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "role_name" varchar(50) NOT NULL,
      "module_key" varchar(50) NOT NULL,
      "access_level" varchar(10) NOT NULL DEFAULT 'write',
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "role_perms_org_role_module_idx" ON "role_permissions" ("organization_id", "role_name", "module_key")`,

    // Member client access (per-member client visibility)
    `CREATE TABLE IF NOT EXISTS "member_client_access" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "member_id" text NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
      "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
      "access_level" varchar(10) NOT NULL DEFAULT 'manage',
      "granted_by" text REFERENCES "user"("id"),
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "mca_org_member_client_idx" ON "member_client_access" ("organization_id", "member_id", "client_id")`,
    `CREATE INDEX IF NOT EXISTS "mca_member_idx" ON "member_client_access" ("member_id")`,
    `CREATE INDEX IF NOT EXISTS "mca_client_idx" ON "member_client_access" ("client_id")`,

    // Task attachments: storage_url column
    `ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "storage_url" text`,

    // Task-grouped invoicing: link invoice lines to tasks
    `ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL`,

    // Desktop license admin notes
    `ALTER TABLE "desktop_license" ADD COLUMN IF NOT EXISTS "note" text`,

    // Task assignment to a team member (separate from creator userId)
    `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assigned_to_user_id" text REFERENCES "user"("id") ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS "tasks_assigned_to_idx" ON "tasks" ("assigned_to_user_id")`,

    // BEMÆRK: tilføj IKKE patches for nye migrationer. Patches kører FØR
    // migrate() og er kun til gamle migrationer, der kan være baselinet uden
    // at være udført. En patch for en ny migration opretter kolonnen først,
    // hvorefter selve migrationen fejler med "column already exists" og
    // standser hele kæden — det skete for 0082 (auto_deduct) 3/8-2026.
  ];

  let applied = 0;
  let skipped = 0;

  for (const patch of patches) {
    try {
      await db.execute(sql.raw(patch));
      applied++;
    } catch (err) {
      // Log but continue — some patches may fail if table doesn't exist yet
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already exists")) {
        console.warn(`  ⚠️  Patch warning: ${patch.slice(0, 80)}... — ${msg}`);
      }
      skipped++;
    }
  }

  // Also ensure nullable columns are nullable (DROP NOT NULL is idempotent)
  const nullablePatches = [
    `ALTER TABLE "calendar_connections" ALTER COLUMN "access_token" DROP NOT NULL`,
    `ALTER TABLE "recurring_time_templates" ALTER COLUMN "project_id" DROP NOT NULL`,
    `ALTER TABLE "recurring_time_templates" ALTER COLUMN "frequency" DROP NOT NULL`,
    `ALTER TABLE "recurring_time_templates" ALTER COLUMN "start_date" DROP NOT NULL`,
    `ALTER TABLE "recurring_time_templates" ALTER COLUMN "next_due" DROP NOT NULL`,
    `ALTER TABLE "prepaid_usage" ALTER COLUMN "time_entry_id" DROP NOT NULL`,
    `ALTER TABLE "task_attachments" ALTER COLUMN "content" DROP NOT NULL`,
  ];

  for (const patch of nullablePatches) {
    try {
      await db.execute(sql.raw(patch));
    } catch {
      // Ignore — column may already be nullable or table may not exist
    }
  }

  console.log(
    `  ✅ Schema patches applied (${applied} ok, ${skipped} skipped)`,
  );

  // Kanban custom lanes (apr 2026)
  await db.execute(sql`CREATE TABLE IF NOT EXISTS task_statuses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    scope varchar(10) NOT NULL,
    project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
    name varchar(50) NOT NULL,
    color varchar(7) NOT NULL,
    "order" integer NOT NULL DEFAULT 0,
    is_archive boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS task_statuses_scope_idx
    ON task_statuses (user_id, scope, project_id)`);

  // Enforce the scope ↔ projectId invariant at the DB level.
  // Idempotent: only add the constraint if it doesn't already exist.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'task_statuses'::regclass
          AND conname = 'task_statuses_scope_project_check'
      ) THEN
        ALTER TABLE task_statuses
        ADD CONSTRAINT task_statuses_scope_project_check
        CHECK (
          (scope = 'general' AND project_id IS NULL)
          OR (scope = 'project' AND project_id IS NOT NULL)
        );
      END IF;
    END $$;
  `);

  // Ensure status_id exists and has ON DELETE SET NULL semantics.
  // On first deploy the column+FK is created fresh. On redeploys we drop
  // the FK (if present) and re-add with SET NULL — idempotent.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'status_id'
      ) THEN
        ALTER TABLE tasks ADD COLUMN status_id uuid;
      END IF;
    END $$;
  `);
  // Drop the old FK (could be named tasks_status_id_fkey or tasks_status_id_task_statuses_id_fk depending on version).
  await db.execute(sql`
    DO $$
    DECLARE
      fk_name text;
    BEGIN
      SELECT conname INTO fk_name
      FROM pg_constraint
      WHERE conrelid = 'tasks'::regclass
        AND conname LIKE 'tasks_status_id%';
      IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', fk_name);
      END IF;
    END $$;
  `);
  await db.execute(sql`
    ALTER TABLE tasks
    ADD CONSTRAINT tasks_status_id_fkey
    FOREIGN KEY (status_id) REFERENCES task_statuses(id) ON DELETE SET NULL;
  `);

  // Enterprise v2 schema drift — these columns were added to schema.ts after
  // initial table creation, so existing DBs need them backfilled.
  await db.execute(sql`
    ALTER TABLE employee_profiles
      ADD COLUMN IF NOT EXISTS working_days jsonb NOT NULL DEFAULT '["1","2","3","4","5"]'::jsonb
  `);
  await db.execute(sql`
    ALTER TABLE absence_requests
      ADD COLUMN IF NOT EXISTS deducted_days numeric(5,2)
  `);

  // Ensure organization_modules table exists
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS organization_modules (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      module_key varchar(50) NOT NULL,
      is_available boolean NOT NULL DEFAULT false,
      is_enabled boolean NOT NULL DEFAULT false,
      available_at timestamp,
      enabled_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now(),
      updated_by text REFERENCES "user"(id) ON DELETE SET NULL
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS org_modules_org_key_idx
      ON organization_modules(organization_id, module_key);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS org_modules_org_idx
      ON organization_modules(organization_id);
  `);

  // Data-migration: populate FREELANCE_BUNDLE for every org that has no rows
  // in organization_modules. Excludes enterprise-tagged orgs so a deliberately
  // empty enterprise org doesn't get silently downgraded to freelance on next
  // boot. Batched as a single INSERT ... SELECT to avoid N×9 round-trips.
  await db.execute(sql`
    INSERT INTO organization_modules
      (id, organization_id, module_key, is_available, is_enabled, available_at, enabled_at)
    SELECT
      gen_random_uuid()::text,
      o.id,
      k.key,
      true,
      true,
      now(),
      now()
    FROM organizations o
    CROSS JOIN (
      VALUES
        ('projects'), ('reports'), ('clients'), ('invoicing'),
        ('klippekort'), ('integrations'), ('tasks'),
        ('public_api'), ('browser_extension')
    ) AS k(key)
    WHERE NOT EXISTS (
      SELECT 1 FROM organization_modules om WHERE om.organization_id = o.id
    )
      AND coalesce(o.metadata->>'type', 'freelance') <> 'enterprise'
    ON CONFLICT (organization_id, module_key) DO NOTHING
  `);

  // Tag orgs without a type as freelance (only those that just got freelance
  // modules — skip enterprise orgs entirely).
  // Guard: only touch rows where metadata is NULL or a JSONB object. A scalar
  // value (legacy rows with `"null"` or a plain string) would make jsonb_set
  // throw "cannot set path in scalar" and abort the whole migration.
  await db.execute(sql`
    UPDATE organizations
    SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{type}',
      '"freelance"'::jsonb,
      true
    )
    WHERE (
      metadata IS NULL
      OR (jsonb_typeof(metadata) = 'object' AND metadata->>'type' IS NULL)
    )
  `);

  // Admin power features (apr 2026)
  await db.execute(sql`CREATE TABLE IF NOT EXISTS support_reply_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL,
    subject varchar(200),
    body text NOT NULL,
    variables jsonb NOT NULL DEFAULT '[]',
    scope varchar(10) NOT NULL,
    created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS banned_domains (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain varchar(255) NOT NULL UNIQUE,
    reason varchar(500),
    banned_by text NOT NULL REFERENCES "user"(id),
    created_at timestamp NOT NULL DEFAULT now()
  )`);

  // Backfill company settings from users to company_profiles
  try {
    await db.execute(sql`
      UPDATE company_profiles cp
      SET
        company_type = COALESCE(cp.company_type, u.company_type),
        vat_period = COALESCE(cp.vat_period, u.vat_period),
        fiscal_year_end = COALESCE(cp.fiscal_year_end, u.fiscal_year_end),
        has_employees = CASE WHEN u.has_employees = true THEN true ELSE cp.has_employees END
      FROM "user" u
      WHERE cp.user_id = u.id
        AND cp.company_type IS NULL
        AND u.company_type IS NOT NULL
    `);
  } catch {
    /* table may not exist yet */
  }
}

/**
 * Backfill organization_id for all existing rows that have user_id but no
 * organization_id yet. Uses each user's oldest "owner" membership (their
 * personal workspace) as the target org. Idempotent — only touches rows
 * where organization_id IS NULL. Safe to run on every boot.
 */
async function backfillOrganizationIds(
  db: PostgresJsDatabase<Record<string, never>>,
) {
  console.log("🔄 Backfilling organization_id on legacy rows...");

  const tables = [
    "clients",
    "projects",
    "time_entries",
    "invoices",
    "prepaid_packages",
    "tasks",
    "task_statuses",
    "tags",
    "recurring_time_templates",
    "rate_history",
    "timer_templates",
    "invoice_templates",
    "report_templates",
    "email_preferences",
    "email_templates",
    "activity_logs",
    "integration_sync_logs",
    "calendar_connections",
    "calendar_events",
    "imports",
    "extension_tokens",
    "timer_states",
    "api_keys",
    "subscriptions",
    "dashboard_preferences",
    "notification_channels",
    "prepaid_templates",
    "data_export_requests",
    "time_approval_requests",
    "trusted_devices",
    "push_subscriptions",
    "ai_processing_logs",
    "email_integrations",
    "calendar_matching_rules",
    "company_profiles",
    "onboarding_progress",
    "payment_methods",
    "dinero_oauth_pending",
    "support_tickets",
    "outgoing_webhooks",
    "sent_emails",
    "portal_branding",
  ];

  let totalUpdated = 0;

  for (const table of tables) {
    try {
      const result = await db.execute(
        sql.raw(`
        UPDATE "${table}" t
        SET organization_id = sub.org_id
        FROM (
          SELECT DISTINCT ON (m.user_id) m.user_id, m.organization_id AS org_id
          FROM "members" m
          ORDER BY m.user_id, CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.created_at ASC
        ) sub
        WHERE t.user_id = sub.user_id
          AND t.organization_id IS NULL
      `),
      );
      const count =
        typeof result === "object" && result !== null && "count" in result
          ? Number(result.count)
          : ((result as unknown[])?.length ?? 0);
      if (count > 0) {
        console.log(`  ✅ ${table}: ${count} rows backfilled`);
        totalUpdated += count;
      }
    } catch (err) {
      // Table might not exist yet — that's fine, skip it
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("does not exist")) {
        console.warn(`  ⚠️  ${table}: ${msg}`);
      }
    }
  }

  if (totalUpdated > 0) {
    console.log(`  📊 Total rows backfilled: ${totalUpdated}`);
  } else {
    console.log("  ✅ No rows needed backfilling");
  }
}

async function seedChangelogs(db: PostgresJsDatabase<Record<string, never>>) {
  const entries = [
    {
      version: "1.8.0",
      title: "Importér fra TimeOps",
      publishedAt: "2026-04-08T16:00:00Z",
      content: `Ny 4-trins import-wizard der gør det nemt at flytte fra TimeOps til TimeTrack:\n\n- **Forbind** — indtast din TimeOps API-nøgle\n- **Forhåndsvis** — se hvor mange klienter, projekter og registreringer der importeres\n- **Konflikter** — vælg hvad der skal ske med dubletter\n- **Import** — følg fremgangen med live progress-bar\n\nFind den under **Indstillinger → Integrationer → TimeOps**.`,
    },
    {
      version: "1.9.0",
      title: "Tidsregistrering uden projekt",
      publishedAt: "2026-04-09T10:00:00Z",
      content: `Du kan nu oprette tidsregistreringer **uden at vælge et projekt**:\n\n- **Klient-kun** — registrér tid direkte på en klient uden projekt\n- **Intern tid** — registrér intern tid som admin, transport eller møder\n- Brug tags til at kategorisere intern tid\n\nKlippekort og fakturering kræver stadig et projekt.`,
    },
    {
      version: "1.10.0",
      title: "Ny browser extension",
      publishedAt: "2026-04-10T06:00:00Z",
      content: `## Nye genveje\n\n- **Alt+Shift+N** — hurtig tidsregistrering fra browseren\n- **Alt+Shift+S** — start/stop timer\n- **Alt+Shift+T** — åbn extension\n\n## Daglig påmindelse\n\nFå en notifikation kl. 15:00 hvis du har registreret under 4 timer.\n\n## Genstart og kopiér\n\n- Klik ▶ på en tidligere registrering for at starte timer med samme projekt\n- Klik 📋 for at udfylde formularen med data fra en tidligere registrering`,
    },
    {
      version: "1.10.1",
      title: "Forbedret klippekort-oversigt",
      publishedAt: "2026-04-10T08:00:00Z",
      content: `Dashboard-widgets viser nu tydeligt forskel på klippekort der **snart udløber** og klippekort der **allerede er udløbet**:\n\n- "Udløber om 5 dage" → orange badge\n- "Udløbet for 3 dage siden" → rød badge med tydelig tekst`,
    },
    {
      version: "1.10.2",
      title: "Nyheder i TimeTrack",
      publishedAt: "2026-04-10T12:00:00Z",
      content: `Fra nu af vil du automatisk se en oversigt over nye funktioner når vi udgiver noget nyt.\n\nDu kan altid genåbne denne dialog via **din profil-menu → Nyheder** for at se tidligere opdateringer.`,
    },
    {
      version: "1.11.0",
      title: "Dinero-integration er live!",
      publishedAt: "2026-04-23T10:00:00Z",
      content: `TimeTrack er nu forbundet med **Dinero** — Danmarks populære bogføringssystem.\n\n## Kom i gang\n\n- Gå til **Indstillinger → Integrationer → Dinero**\n- Klik **Forbind til Dinero** og log ind med din Dinero-konto\n- Færdig! Dine fakturaer synkroniseres automatisk\n\n## Hvad kan du?\n\n- **Synkronisér fakturaer** direkte fra TimeTrack til Dinero\n- **Automatisk bogføring** — slip for dobbeltarbejde\n- **Ét-klik forbindelse** via sikker OAuth-login\n\nHar du spørgsmål? Skriv til os via **Hjælp → Kontakt**.`,
    },
  ];

  let seeded = 0;
  for (const e of entries) {
    const existing = await db.execute(
      sql`SELECT 1 FROM changelogs WHERE version = ${e.version} LIMIT 1`,
    );
    if ((existing as unknown[]).length > 0) continue;
    await db.execute(
      sql`INSERT INTO changelogs (version, title, content, published_at)
          VALUES (${e.version}, ${e.title}, ${e.content}, ${e.publishedAt}::timestamp)`,
    );
    seeded++;
  }
  if (seeded > 0) {
    console.log(`📰 Seeded ${seeded} changelog entries`);
  }
}

async function main() {
  console.log("🔄 Running safe database migrations...");

  const migrationClient = postgres(databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);
  const lockClient = postgresLockClient(migrationClient);
  let holdsLock = false;

  try {
    // Kun én instans migrerer ad gangen (#630). Uden låsen racede samtidige
    // container-starter om den samme CREATE, og taberen udløste en falsk
    // alarm. Venter vi forgæves, er det en ægte fejl, og exit 1 sender den
    // eksisterende alarm fra startup.sh.
    const timeoutMs = lockTimeoutFromEnv();
    const lock = await acquireMigrationLock(lockClient, { timeoutMs });
    if (!lock.acquired) {
      throw new Error(
        `Fik ikke migrationslåsen inden for ${Math.round(timeoutMs / 1000)} s — en anden migration ser ud til at hænge`,
      );
    }
    holdsLock = true;

    // Check database state — Better Auth uses singular table names
    const hasUser = await checkTableExists(db, "user");
    const hasAccount = await checkTableExists(db, "account");
    const hasVerification = await checkTableExists(db, "verification");
    const hasClients = await checkTableExists(db, "clients");
    const userIdType = await checkUserIdType(db);
    const hasDrizzleMigrations = await checkDrizzleMigrationsExist(db);

    console.log("📊 Database status:");
    console.log(
      `  - user table: ${hasUser ? `✅ exists (id type: ${userIdType})` : "❌ missing"}`,
    );
    console.log(
      `  - account table: ${hasAccount ? "✅ exists" : "❌ missing"}`,
    );
    console.log(
      `  - verification table: ${hasVerification ? "✅ exists" : "❌ missing"}`,
    );
    console.log(
      `  - clients table: ${hasClients ? "✅ exists" : "❌ missing"}`,
    );
    console.log(
      `  - migration tracking: ${hasDrizzleMigrations ? "✅ exists" : "❌ missing"}`,
    );

    if (hasUser && userIdType === "uuid") {
      throw new Error('Cannot migrate a legacy database with a UUID "user".id');
    }

    // Existing database without migration tracking — baseline it
    // Also baseline if tracking table exists but is empty (from a prior failed deploy)
    const migrationCountBeforeBaseline = hasDrizzleMigrations
      ? await getMigrationCount(db)
      : 0;
    let baselineApplied = 0;

    if (
      hasUser &&
      hasClients &&
      (!hasDrizzleMigrations || migrationCountBeforeBaseline === 0)
    ) {
      console.log("📌 Recording the legacy migration baseline...");
      baselineApplied = await baselineUntrackedDatabase(db);
    }

    const isFreshDatabase =
      !hasUser && !hasAccount && !hasVerification && !hasClients;
    if (isFreshDatabase) {
      console.log("🆕 Empty database — installing the SQL checkpoint...");
      if (!(await bootstrapEmptyDatabase(db))) {
        throw new Error(
          "Refusing to initialize: the public schema contains tables",
        );
      }
    }

    // Repair installations whose older migrations were tracked but never run.
    if ((hasUser && hasClients) || isFreshDatabase) {
      await applySchemaPatches(db);
    }

    console.log("🔄 Running migrations...");
    const migrationCount = await getMigrationCount(db);
    await migrateDatabase(db);
    const applied =
      baselineApplied + (await getMigrationCount(db)) - migrationCount;
    if (applied > 0) {
      console.log(`✅ ${applied} new migration(s) applied`);
    } else {
      console.log("✅ Database is up to date — no new migrations");
    }

    // Data-level steps that go through the Drizzle schema MUST run after
    // migrate(): the schema may reference columns a pending migration adds
    // (28/8-26: seedSystemReportTemplates inserted "report_type" before 0095
    // had created it → whole script exited 1 and 0094-0096 were never
    // applied). They are idempotent and non-critical, so a failure here is
    // logged but must never block the migrations above.
    if ((hasUser && hasClients) || isFreshDatabase) {
      try {
        const { seedSystemReportTemplates } = await import(
          "@/lib/reports/seed"
        );
        const schema = await import("@/lib/db/schema");
        await seedSystemReportTemplates(drizzle(migrationClient, { schema }));
        await backfillOrganizationIds(db);
      } catch (err) {
        console.error("⚠️  Post-migration seed/backfill failed:", err);
      }
    }

    // Seed initial changelog entries (idempotent — skips existing versions)
    await seedChangelogs(db);

    // One-off plan/seat unblock at release. Set UNBLOCK_PLAN_EMAIL (and
    // optionally UNBLOCK_PLAN_TIER / UNBLOCK_PLAN_SEATS) to grant a customer
    // their tier + seats on deploy. Idempotent — re-running is a no-op, so the
    // env vars can be left in place. Used to onboard team customers created
    // before the self-serve team flow existed.
    if (process.env.UNBLOCK_PLAN_EMAIL) {
      try {
        const { setOrgPlan } = await import("./set-org-plan");
        const seats = process.env.UNBLOCK_PLAN_SEATS
          ? Number.parseInt(process.env.UNBLOCK_PLAN_SEATS, 10)
          : undefined;
        const result = await setOrgPlan(db, {
          email: process.env.UNBLOCK_PLAN_EMAIL,
          tier: process.env.UNBLOCK_PLAN_TIER || "team",
          maxSeats: seats,
        });
        if (result.updated) {
          console.log(
            `[unblock-plan] ${process.env.UNBLOCK_PLAN_EMAIL}: ${result.previous?.planTier}/${result.previous?.maxSeats} → ${result.next?.planTier}/${result.next?.maxSeats}`,
          );
        } else {
          console.log(
            `[unblock-plan] ${process.env.UNBLOCK_PLAN_EMAIL}: skipped (${result.reason})`,
          );
        }
      } catch (err) {
        console.error("[unblock-plan] failed:", err);
        // Don't fail migrations on unblock error
      }
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    // Låsen slippes også når forbindelsen lukkes, men vi frigiver den
    // eksplicit, så en ventende instans kommer videre med det samme.
    if (holdsLock) {
      await lockClient.unlock(MIGRATION_LOCK_KEY).catch(() => {});
    }
    await migrationClient.end();
  }
}

main();
