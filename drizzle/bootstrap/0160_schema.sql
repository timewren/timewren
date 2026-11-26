-- Schema through 0160_test_account_classification, generated from schema.ts.
-- Keep this SQL fixed. Changes after 0160 belong in the main migration journal.
CREATE TABLE "absence_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"absence_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"half_day_start" boolean DEFAULT false NOT NULL,
	"half_day_end" boolean DEFAULT false NOT NULL,
	"hours_per_day" numeric(4, 2),
	"total_days" numeric(5, 2),
	"deducted_days" numeric(5, 2),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"registered_by" text,
	"reported_well_at" timestamp,
	"approved_by" text,
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"note" text,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"closure_period_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "absence_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(7) DEFAULT '#3b82f6',
	"icon" varchar(50),
	"deducts_vacation" boolean DEFAULT false NOT NULL,
	"vacation_pool" varchar(20) DEFAULT 'vacation' NOT NULL,
	"deducts_overtime" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"category" varchar(20) DEFAULT 'other' NOT NULL,
	"requires_documentation" boolean DEFAULT false NOT NULL,
	"annual_cap_days" numeric(4, 1),
	"visible_to_colleagues" boolean DEFAULT true NOT NULL,
	"payroll_code" varchar(50),
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"idToken" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"entity_name" varchar(255),
	"changes" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(7) DEFAULT '#6366f1' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"payroll_code" varchar(50),
	"default_billable" boolean,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "activity_types_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "admin_activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" text NOT NULL,
	"action" varchar(100) NOT NULL,
	"target_user_id" text,
	"details" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "admin_user_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"is_important" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_processing_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"source_type" varchar(20) NOT NULL,
	"source_id" varchar(255),
	"operation" varchar(50) NOT NULL,
	"model" varchar(50) NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"confidence" numeric(3, 2),
	"status" varchar(20) NOT NULL,
	"was_accepted" boolean,
	"user_override" jsonb,
	"processing_time_ms" integer,
	"token_count" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alunta_klippekort_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"token_hash" varchar(64),
	"token_encrypted" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "alunta_klippekort_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "alunta_plan_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"token_id" uuid NOT NULL,
	"alunta_plan_uuid" varchar(100) NOT NULL,
	"alunta_plan_name" varchar(255) NOT NULL,
	"client_id" uuid NOT NULL,
	"hours_per_period" numeric(8, 2) NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"renewal_behavior" varchar(20) DEFAULT 'parallel' NOT NULL,
	"clip_size_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(100) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"scopes" jsonb DEFAULT '["*"]'::jsonb NOT NULL,
	"last_used_at" timestamp,
	"last_used_ip" varchar(45),
	"expires_at" timestamp,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "banned_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"reason" varchar(500),
	"banned_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "banned_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "banned_email_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"reason" text,
	"banned_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "banned_email_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "beta_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"company" varchar(255),
	"current_tool" varchar(50),
	"message" text,
	"status" varchar(50) DEFAULT 'pending',
	"referral_source" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "beta_signups_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"provider" varchar(20) NOT NULL,
	"provider_account_id" varchar(255),
	"access_token" text,
	"refresh_token" text,
	"token_expiry" timestamp,
	"granted_scopes" text,
	"calendar_id" varchar(255) DEFAULT 'primary',
	"calendar_name" varchar(255),
	"calendar_color" varchar(7),
	"parent_connection_id" uuid,
	"sync_enabled" boolean DEFAULT true,
	"sync_direction" varchar(20) DEFAULT 'both',
	"last_synced" timestamp,
	"sync_error" text,
	"consecutive_sync_failures" integer DEFAULT 0,
	"sync_disabled_until" timestamp,
	"webhook_channel_id" varchar(255),
	"webhook_expiry" timestamp,
	"webhook_token_hash" varchar(64),
	"sync_token" text,
	"sync_filters" jsonb,
	"privacy_mode" varchar(20) DEFAULT 'off',
	"auto_track_mode" varchar(20) DEFAULT 'off',
	"default_project_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"calendar_connection_id" uuid,
	"external_id" varchar(255),
	"external_etag" varchar(255),
	"title" varchar(255) NOT NULL,
	"description" text,
	"location" varchar(255),
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"is_all_day" boolean DEFAULT false,
	"timezone" varchar(50),
	"event_type" varchar(20) DEFAULT 'external',
	"linked_task_id" uuid,
	"linked_project_id" uuid,
	"sync_direction" varchar(20) DEFAULT 'inbound',
	"last_synced_at" timestamp,
	"linked_time_entry_id" uuid,
	"response_status" varchar(20),
	"is_cancelled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_matching_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"pattern" varchar(255) NOT NULL,
	"project_id" uuid,
	"client_id" uuid,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"last_matched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changelogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(20) NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"published_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"checked_in_at" timestamp NOT NULL,
	"checked_out_at" timestamp,
	"time_entry_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "churn_playbook_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"playbook_key" varchar(50) NOT NULL,
	"risk_score" integer NOT NULL,
	"reasons" jsonb,
	"triggered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_portal_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"organization_id" text,
	"freelancer_id" text NOT NULL,
	"access_type" varchar(20) DEFAULT 'token' NOT NULL,
	"access_token_hash" varchar(64),
	"access_token_encrypted" text,
	"token_expires_at" timestamp,
	"email" varchar(255),
	"password_hash" varchar(255),
	"email_verified" boolean DEFAULT false,
	"email_verification_token_hash" varchar(64),
	"password_reset_expires_at" timestamp,
	"can_view_invoices" boolean DEFAULT true,
	"can_view_projects" boolean DEFAULT true,
	"can_view_time_entries" boolean DEFAULT true,
	"can_view_prepaid" boolean DEFAULT true,
	"can_approve_time" boolean DEFAULT false,
	"can_download_invoices" boolean DEFAULT true,
	"is_active" boolean DEFAULT true,
	"last_accessed_at" timestamp,
	"access_count" integer DEFAULT 0,
	"invitation_sent_at" timestamp,
	"invitation_accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_access_access_token_hash_unique" UNIQUE("access_token_hash")
);
--> statement-breakpoint
CREATE TABLE "client_portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_access_id" uuid NOT NULL,
	"session_token_hash" varchar(64),
	"expires_at" timestamp NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_sessions_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "client_tags" (
	"client_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_tags_client_id_tag_id_pk" PRIMARY KEY("client_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"company" varchar(255),
	"address" text,
	"city" varchar(100),
	"postal_code" varchar(20),
	"country" varchar(100) DEFAULT 'Danmark',
	"cvr_number" varchar(20),
	"notes" text,
	"user_id" text NOT NULL,
	"organization_id" text,
	"default_hourly_rate" numeric(10, 2),
	"payment_terms_days" integer,
	"monthly_status_report_enabled" boolean DEFAULT false NOT NULL,
	"auto_reminder_enabled" boolean DEFAULT false NOT NULL,
	"monthly_status_note" text,
	"status_report_last_sent_at" timestamp,
	"rounding_enabled" boolean,
	"rounding_minutes" integer,
	"rounding_method" varchar(10),
	"hide_prepaid_value" boolean,
	"default_billable" boolean DEFAULT true NOT NULL,
	"color" varchar(7),
	"is_active" boolean DEFAULT true,
	"is_archived" boolean DEFAULT false,
	"is_demo_data" boolean DEFAULT false NOT NULL,
	"billy_id" varchar(255),
	"dinero_id" varchar(255),
	"economic_customer_number" integer,
	"approval_workflow" varchar(20),
	"domains" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(255) NOT NULL,
	"cvr_number" varchar(20),
	"email" varchar(255) NOT NULL,
	"phone" varchar(50),
	"address" text,
	"postal_code" varchar(20),
	"city" varchar(100),
	"country" varchar(100) DEFAULT 'Danmark',
	"bank_reg_nr" varchar(10),
	"bank_account_nr" varchar(50),
	"vat_registered" boolean DEFAULT false,
	"vat_number" varchar(50),
	"logo_url" text,
	"company_type" varchar(20),
	"vat_period" varchar(20),
	"fiscal_year_end" varchar(5),
	"has_employees" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(50) DEFAULT 'new',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_job_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "dashboard_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"layout" jsonb NOT NULL,
	"active_widgets" text[] NOT NULL,
	"breakpoint" varchar(10) DEFAULT 'lg',
	"cols" integer DEFAULT 4,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "data_export_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"request_type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"format" varchar(10) DEFAULT 'json' NOT NULL,
	"data_types" text[],
	"date_from" timestamp,
	"date_to" timestamp,
	"download_token_hash" varchar(64),
	"download_token_encrypted" text,
	"expires_at" timestamp NOT NULL,
	"processed_at" timestamp,
	"downloaded_at" timestamp,
	"file_size_bytes" integer,
	"error_message" text,
	"request_ip" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_export_requests_download_token_hash_unique" UNIQUE("download_token_hash")
);
--> statement-breakpoint
CREATE TABLE "day_off_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"department_id" uuid,
	"user_id" text,
	"preset" varchar(20) DEFAULT 'private' NOT NULL,
	"optional_days" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "day_off_calendars_scope" CHECK ((user_id IS NOT NULL AND organization_id IS NULL AND department_id IS NULL) OR (user_id IS NULL AND organization_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "department_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"department_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(20) DEFAULT 'lead' NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_analytics" (
	"id" text PRIMARY KEY NOT NULL,
	"event" varchar(100) NOT NULL,
	"properties" jsonb,
	"app_version" varchar(20),
	"platform" varchar(50),
	"language" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_device" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_name" varchar(255),
	"machine_id" varchar(255) NOT NULL,
	"os" varchar(50),
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_license_device" (
	"id" text PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"machine_id" varchar(255) NOT NULL,
	"device_name" varchar(255),
	"os" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "desktop_license" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"license_key" varchar(50) NOT NULL,
	"tier" varchar(20) NOT NULL,
	"email" varchar(255),
	"max_devices" integer DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"amount_paid_dkk" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "desktop_license_license_key_unique" UNIQUE("license_key")
);
--> statement-breakpoint
CREATE TABLE "desktop_sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" text NOT NULL,
	"action" varchar(20) NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_sync_tombstones" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"deleted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_trial" (
	"id" text PRIMARY KEY NOT NULL,
	"machine_id" varchar(255) NOT NULL,
	"os" varchar(50),
	"started_at" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_trial_machine_id_unique" UNIQUE("machine_id")
);
--> statement-breakpoint
CREATE TABLE "desktop_waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "device_auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"state" varchar(256) NOT NULL,
	"code_challenge" varchar(128) NOT NULL,
	"device_id" varchar(128) NOT NULL,
	"device_name" varchar(255),
	"device_os" varchar(50),
	"client_kind" varchar(16) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_auth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "device_idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"org_key" text NOT NULL,
	"scope" varchar(32) NOT NULL,
	"key" varchar(64) NOT NULL,
	"result_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_import_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity" varchar(16) NOT NULL,
	"local_id" varchar(64) NOT NULL,
	"server_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_learned_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"pattern" jsonb NOT NULL,
	"votes" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_match_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"pattern" varchar(500) NOT NULL,
	"project_id" uuid,
	"client_id" uuid,
	"not_work" boolean DEFAULT false NOT NULL,
	"source" varchar(16) DEFAULT 'desktop' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dinero_oauth_pending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"token_expiry" timestamp NOT NULL,
	"organizations" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_classification_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sender_domain" varchar(255) NOT NULL,
	"is_actionable" boolean NOT NULL,
	"confidence" numeric(3, 2),
	"sample_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "email_class_cache_user_domain_unique" UNIQUE("user_id","sender_domain")
);
--> statement-breakpoint
CREATE TABLE "email_delivery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar(255),
	"to" varchar(255) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"template_type" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"user_id" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"bounced_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resend_email_id" varchar(255) NOT NULL,
	"event_type" varchar(30) NOT NULL,
	"metadata" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_filter_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"rule_type" varchar(30) NOT NULL,
	"pattern" varchar(255) NOT NULL,
	"source_task_id" uuid,
	"source_email_subject" text,
	"source_email_from" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"last_matched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_filter_rules_user_pattern_unique" UNIQUE("user_id","rule_type","pattern")
);
--> statement-breakpoint
CREATE TABLE "email_forwarding_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid,
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
--> statement-breakpoint
CREATE TABLE "email_forwarding_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"from_pattern" varchar(255) NOT NULL,
	"to_address" varchar(255) NOT NULL,
	"to_pattern" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"forward_attachments" boolean DEFAULT true NOT NULL,
	"subject_prefix" varchar(100),
	"match_count" integer DEFAULT 0 NOT NULL,
	"last_matched_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"imap_host" varchar(255) NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_username" varchar(255) NOT NULL,
	"imap_password" text NOT NULL,
	"imap_use_ssl" boolean DEFAULT true NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"sync_frequency_minutes" integer DEFAULT 15 NOT NULL,
	"last_synced_at" timestamp,
	"last_sync_status" varchar(20),
	"last_sync_error" text,
	"target_mailbox" varchar(100) DEFAULT 'INBOX' NOT NULL,
	"processed_emails_count" integer DEFAULT 0 NOT NULL,
	"consecutive_sync_failures" integer DEFAULT 0 NOT NULL,
	"sync_disabled_until" timestamp,
	"uid_validity" integer,
	"highest_processed_uid" integer,
	"last_heartbeat" timestamp,
	"client_domains_only" boolean DEFAULT false NOT NULL,
	"sender_whitelist" text[],
	"sender_blacklist" text[],
	"subject_filters" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_integrations_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"weekly_report" boolean DEFAULT true,
	"monthly_report" boolean DEFAULT true,
	"unbilled_reminder" boolean DEFAULT true,
	"password_changed" boolean DEFAULT true,
	"new_login_alert" boolean DEFAULT true,
	"email_changed" boolean DEFAULT true,
	"onboarding_milestones" boolean DEFAULT true,
	"inactivity_reminder" boolean DEFAULT true,
	"tips_and_tricks" boolean DEFAULT false,
	"product_updates" boolean DEFAULT true,
	"client_invoices" boolean DEFAULT true,
	"client_prepaid_alerts" boolean DEFAULT false,
	"client_project_updates" boolean DEFAULT false,
	"weekly_report_day" varchar(20) DEFAULT 'monday',
	"weekly_report_time" varchar(10) DEFAULT '08:00',
	"monthly_report_day" integer DEFAULT 1,
	"unbilled_reminder_frequency" varchar(20) DEFAULT 'weekly',
	"inactivity_reminder_days" integer DEFAULT 7,
	"end_of_day_enabled" boolean DEFAULT false,
	"end_of_day_time" varchar(10) DEFAULT '17:00',
	"quiet_hours_enabled" boolean DEFAULT false,
	"quiet_hours_start" varchar(10) DEFAULT '22:00',
	"quiet_hours_end" varchar(10) DEFAULT '08:00',
	"last_inactivity_email_sent_at" timestamp,
	"drip_emails" boolean DEFAULT true,
	"digest_mode" boolean DEFAULT false,
	"digest_frequency" varchar(20) DEFAULT 'daily',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "email_sync_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_for" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error_message" text,
	"error_stack" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"content" jsonb NOT NULL,
	"html_content" text,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"is_system" boolean DEFAULT false,
	"usage_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"task_id" uuid,
	"message_id" varchar(255) NOT NULL,
	"thread_id" varchar(255),
	"in_reply_to" varchar(255),
	"references" text[],
	"conversation_id" varchar(255),
	"thread_position" integer,
	"sender_priority" varchar(10) DEFAULT 'normal',
	"subject" text NOT NULL,
	"from_email" varchar(255) NOT NULL,
	"from_name" varchar(255),
	"to_emails" text[] NOT NULL,
	"cc_emails" text[],
	"received_date" timestamp NOT NULL,
	"body_text" text,
	"body_html" text,
	"attachments" jsonb,
	"is_processed" boolean DEFAULT false NOT NULL,
	"processing_error" text,
	"matched_client_id" uuid,
	"match_confidence" numeric(3, 2),
	"is_read" boolean DEFAULT false,
	"is_flagged" boolean DEFAULT false,
	"subject_domain_hash" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_threads_user_message_id_unique" UNIQUE("user_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "employee_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"department_id" uuid,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"employment_type" varchar(20) DEFAULT 'full_time' NOT NULL,
	"weekly_hours" numeric(4, 1) DEFAULT '37.0' NOT NULL,
	"conversion_factor" numeric(5, 3) DEFAULT '1.000' NOT NULL,
	"manager_id" uuid,
	"working_days" jsonb DEFAULT '["1","2","3","4","5"]'::jsonb NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_self_scheduler" boolean DEFAULT false NOT NULL,
	"vacation_days_per_year" integer DEFAULT 25 NOT NULL,
	"extra_vacation_days_per_year" numeric(4, 1) DEFAULT '5.0' NOT NULL,
	"daily_norm_hours" numeric(4, 1),
	"break_minutes" integer,
	"employee_number" varchar(50),
	"external_payroll_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employment_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_profile_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"weekly_hours" numeric(4, 1) DEFAULT '37.0' NOT NULL,
	"conversion_factor" numeric(5, 3) DEFAULT '1.000' NOT NULL,
	"employment_type" varchar(20) DEFAULT 'full_time' NOT NULL,
	"department_id" uuid,
	"position" varchar(255),
	"working_days" jsonb DEFAULT '["1","2","3","4","5"]'::jsonb NOT NULL,
	"daily_norm_hours" numeric(4, 1),
	"break_minutes" integer,
	"end_reason" varchar(50),
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"token_hash" varchar(64),
	"name" varchar(100) NOT NULL,
	"last_used_at" timestamp,
	"last_used_ip" varchar(45),
	"usage_count" integer DEFAULT 0,
	"expires_at" timestamp,
	"is_revoked" boolean DEFAULT false,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"device_id" varchar(128),
	"device_name" varchar(255),
	"device_os" varchar(50),
	"client_kind" varchar(16),
	"refresh_token_hash" varchar(64),
	"previous_refresh_token_hash" varchar(64),
	"refresh_expires_at" timestamp,
	CONSTRAINT "extension_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "extension_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash"),
	CONSTRAINT "extension_tokens_previous_refresh_token_hash_unique" UNIQUE("previous_refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "feedback_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"install_id" varchar(64),
	"contact_email" varchar(255),
	"organization_id" text,
	"type" varchar(20) NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"screenshot_key" text,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flex_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"expected_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"actual_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"delta" numeric(5, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "flex_entries_user_date_org_unique" UNIQUE("user_id","date","organization_id")
);
--> statement-breakpoint
CREATE TABLE "generated_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_template_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"scheduled_date" timestamp NOT NULL,
	"generated_date" timestamp DEFAULT now() NOT NULL,
	"is_completed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"question_key" varchar(500) NOT NULL,
	"value" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "help_feedback_user_question_unique" UNIQUE("user_id","question_key")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"date" date NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"source" varchar(20) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"preview_data" jsonb,
	"conflict_resolutions" jsonb,
	"id_mapping" jsonb,
	"total_entries" integer DEFAULT 0 NOT NULL,
	"processed_entries" integer DEFAULT 0 NOT NULL,
	"imported_entries" integer DEFAULT 0 NOT NULL,
	"skipped_entries" integer DEFAULT 0 NOT NULL,
	"failed_entries" integer DEFAULT 0 NOT NULL,
	"last_processed_page" integer,
	"results" jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb,
	"credentials" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"integration_type" varchar(50) NOT NULL,
	"operation" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"items_processed" integer DEFAULT 0,
	"items_failed" integer DEFAULT 0,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"inviter_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"time_entry_id" uuid,
	"task_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(255) NOT NULL,
	"description" text,
	"payment_terms_days" integer DEFAULT 14,
	"vat_rate" numeric(5, 2) DEFAULT '25.00',
	"currency" varchar(10) DEFAULT 'DKK',
	"header_text" text,
	"footer_text" text,
	"terms_text" text,
	"bank_name" varchar(255),
	"bank_account" varchar(50),
	"bank_reg_number" varchar(20),
	"logo_url" text,
	"primary_color" varchar(20) DEFAULT '#3b82f6',
	"is_default" boolean DEFAULT false,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"amount" numeric(10, 2) NOT NULL,
	"status" varchar(50) DEFAULT 'draft',
	"kind" varchar(20) DEFAULT 'invoice' NOT NULL,
	"related_invoice_id" uuid,
	"template_id" uuid,
	"friendly_reminder_sent_at" timestamp,
	"issue_date" timestamp NOT NULL,
	"due_date" timestamp,
	"paid_date" timestamp,
	"notes" text,
	"billy_invoice_id" varchar(255),
	"dinero_invoice_guid" varchar(255),
	"economic_invoice_number" integer,
	"reminder_sent_at" timestamp,
	"reminder_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"tool" varchar(100) NOT NULL,
	"payload" jsonb,
	"consent_text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_client_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"access_level" varchar(10) DEFAULT 'manage' NOT NULL,
	"granted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"project_id" uuid,
	"client_id" uuid,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"cost_rate" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"token" text NOT NULL,
	"platform" varchar(10) NOT NULL,
	"device_name" text,
	"app_version" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"channel_type" varchar(20) NOT NULL,
	"discord_webhook_url" text,
	"discord_webhook_name" varchar(100),
	"slack_webhook_url" text,
	"slack_channel_name" varchar(100),
	"slack_bot_token" text,
	"push_subscription" jsonb,
	"sms_phone_number" varchar(20),
	"is_enabled" boolean DEFAULT true,
	"active_days" integer[] DEFAULT '{0,1,2,3,4,5,6}' NOT NULL,
	"send_daily_digest" boolean DEFAULT true,
	"send_deadline_reminders" boolean DEFAULT true,
	"send_overdue_alerts" boolean DEFAULT true,
	"send_weekly_review" boolean DEFAULT false,
	"send_unbilled_reminders" boolean DEFAULT true,
	"send_ai_suggestions" boolean DEFAULT false,
	"send_timer_start" boolean DEFAULT false,
	"send_timer_stop" boolean DEFAULT false,
	"send_idle_warning" boolean DEFAULT false,
	"send_end_of_day" boolean DEFAULT false,
	"last_tested_at" timestamp,
	"last_test_status" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"event" varchar(50) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notification_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"event" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauthAccessToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text,
	"referenceId" text,
	"authorizationCodeId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"refreshId" text,
	"expiresAt" timestamp,
	"createdAt" timestamp,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauthAccessToken_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauthClientAssertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauthClientResource" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"resourceId" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauthClient" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"clientSecret" text,
	"clientDiscoveryId" text,
	"disabled" boolean DEFAULT false,
	"skipConsent" boolean,
	"enableEndSession" boolean,
	"subjectType" text,
	"scopes" text[],
	"clientCredentialsScopes" text[],
	"userId" text,
	"createdAt" timestamp,
	"updatedAt" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"softwareId" text,
	"softwareVersion" text,
	"softwareStatement" text,
	"redirectUris" text[] NOT NULL,
	"postLogoutRedirectUris" text[],
	"backchannelLogoutUri" text,
	"backchannelLogoutSessionRequired" boolean,
	"tokenEndpointAuthMethod" text,
	"applicationType" text,
	"jwks" text,
	"jwksUri" text,
	"grantTypes" text[],
	"responseTypes" text[],
	"requirePKCE" boolean,
	"dpopBoundAccessTokens" boolean DEFAULT false,
	"referenceId" text,
	"metadata" jsonb,
	CONSTRAINT "oauthClient_clientId_unique" UNIQUE("clientId")
);
--> statement-breakpoint
CREATE TABLE "oauthConsent" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"userId" text,
	"referenceId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"scopes" text[] NOT NULL,
	"createdAt" timestamp,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauthRefreshToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text NOT NULL,
	"referenceId" text,
	"authorizationCodeId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"expiresAt" timestamp,
	"createdAt" timestamp,
	"revoked" timestamp,
	"rotatedAt" timestamp,
	"rotationReplayResponse" text,
	"rotationReplayExpiresAt" timestamp,
	"authTime" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauthRefreshToken_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauthResource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"accessTokenTtl" integer,
	"refreshTokenTtl" integer,
	"signingAlgorithm" text,
	"signingKeyId" text,
	"allowedScopes" text[],
	"customClaims" jsonb,
	"dpopBoundAccessTokensRequired" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"createdAt" timestamp,
	"updatedAt" timestamp,
	"policyVersion" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauthResource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"current_step" varchar(50),
	"completed_steps" text[],
	"import_source" varchar(50),
	"import_completed_at" timestamp,
	"clients_imported" integer DEFAULT 0,
	"projects_imported" integer DEFAULT 0,
	"time_entries_imported" integer DEFAULT 0,
	"prepaid_packages_imported" integer DEFAULT 0,
	"is_completed" boolean DEFAULT false,
	"completed_at" timestamp,
	"time_to_complete_minutes" integer,
	"primary_use" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_progress_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "org_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text,
	"actor_label" varchar(255),
	"action" varchar(50) NOT NULL,
	"target_email" varchar(255),
	"target_user_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_closure_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"absence_type_id" uuid NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_dpa_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"version" varchar(20) NOT NULL,
	"accepted_by" text,
	"accepted_by_email" varchar(255) NOT NULL,
	"accepted_by_name" varchar(255),
	"ip_address" varchar(64),
	"user_agent" text,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_notification_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"teams_webhook_url" text,
	"teams_enabled" boolean DEFAULT false NOT NULL,
	"manager_digest" varchar(10) DEFAULT 'off' NOT NULL,
	"escalation_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_notification_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "org_period_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"locked_before" timestamp,
	"locked_by_user_id" text NOT NULL,
	"note" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_verified_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"verification_token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp,
	"last_checked_at" timestamp,
	"last_check_error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"module_key" varchar(50) NOT NULL,
	"is_available" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"available_at" timestamp,
	"enabled_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" varchar(20) DEFAULT 'timetrack' NOT NULL,
	"founding_since" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"logo" text,
	"metadata" jsonb,
	"is_test_account" boolean DEFAULT false NOT NULL,
	"overtime_threshold_hours" numeric(4, 1),
	"vacation_overdraft_days" numeric(4, 1) DEFAULT '0' NOT NULL,
	"vacation_year_start_month" integer DEFAULT 1 NOT NULL,
	"vacation_accrual_mode" varchar(20) DEFAULT 'upfront' NOT NULL,
	"vacation_carry_over_max_days" numeric(4, 1) DEFAULT '5' NOT NULL,
	"vacation_pay_out_remaining" boolean DEFAULT false NOT NULL,
	"vacation_settings_changed_at" timestamp,
	"default_weekly_hours" numeric(4, 1) DEFAULT '37.0' NOT NULL,
	"daily_norm_hours" numeric(4, 1),
	"break_minutes_per_day" integer DEFAULT 0 NOT NULL,
	"break_policy" varchar(20) DEFAULT 'none' NOT NULL,
	"enforce_compliance_blocking" boolean DEFAULT false NOT NULL,
	"compliance_reference_period_months" integer DEFAULT 4 NOT NULL,
	"compliance_rule_48h" varchar(10) DEFAULT 'warn' NOT NULL,
	"compliance_rule_daily_rest" varchar(10) DEFAULT 'warn' NOT NULL,
	"compliance_rule_weekly_rest" varchar(10) DEFAULT 'warn' NOT NULL,
	"timesheet_max_hours_per_day" numeric(4, 1) DEFAULT '24.0' NOT NULL,
	"timesheet_warn_over_norm" boolean DEFAULT true NOT NULL,
	"timesheet_block_empty_workdays" boolean DEFAULT false NOT NULL,
	"timesheet_lock_after_weeks" integer,
	"payroll_system" varchar(20) DEFAULT 'generic' NOT NULL,
	"payroll_period_type" varchar(20) DEFAULT 'month' NOT NULL,
	"payroll_period_start_day" integer DEFAULT 1 NOT NULL,
	"sso_tenant_id" varchar(64),
	"auto_join_default_role" varchar(20) DEFAULT 'member' NOT NULL,
	"require_sso_for_domains" boolean DEFAULT false NOT NULL,
	"require_two_factor_for_managers" boolean DEFAULT false NOT NULL,
	"flex_norm_period" varchar(10) DEFAULT 'week' NOT NULL,
	"flex_norm_year_start" varchar(10) DEFAULT 'calendar' NOT NULL,
	"flex_norm_annual_hours" numeric(6, 1),
	"flex_carryover_max_hours" numeric(6, 1),
	"flex_carryover_max_deficit_hours" numeric(6, 1),
	"flex_norm_start_date" date,
	"period_closing_interval" varchar(10),
	"timesheet_auto_lock_weekday" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outgoing_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(100) NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"retry_count" integer DEFAULT 3 NOT NULL,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"total_deliveries" integer DEFAULT 0 NOT NULL,
	"successful_deliveries" integer DEFAULT 0 NOT NULL,
	"failed_deliveries" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp,
	"last_delivery_status" varchar(20),
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp,
	"disabled_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overtime_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"user_label" varchar(255),
	"type" varchar(20) NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"week_start" date,
	"absence_request_id" uuid,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"deviceType" varchar(50),
	"backedUp" boolean DEFAULT false,
	"transports" text,
	"aaguid" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_credentialID_unique" UNIQUE("credentialID")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"stripe_payment_method_id" varchar(255) NOT NULL,
	"card_brand" varchar(50),
	"card_last_4" varchar(4),
	"card_exp_month" integer,
	"card_exp_year" integer,
	"is_default" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_stripe_payment_method_id_unique" UNIQUE("stripe_payment_method_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_mapping_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"wage_type_id" uuid NOT NULL,
	"source" varchar(30) NOT NULL,
	"activity_type_id" uuid,
	"absence_type_id" uuid,
	"day_condition" varchar(20) DEFAULT 'any' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_wage_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"unit" varchar(10) DEFAULT 'hours' NOT NULL,
	"kind" varchar(20) DEFAULT 'time' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_wage_types_org_code_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "period_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period_type" varchar(10) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"summary" jsonb,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"acknowledged_at" timestamp,
	"unlocked_by" text,
	"unlocked_at" timestamp,
	"unlock_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "period_closings_org_user_period_unique" UNIQUE("organization_id","user_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "portal_activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_access_id" uuid NOT NULL,
	"freelancer_id" text NOT NULL,
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" uuid,
	"entity_name" varchar(255),
	"metadata" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_branding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"brand_name" varchar(255),
	"logo_url" text,
	"favicon_url" text,
	"primary_color" varchar(7) DEFAULT '#3b82f6',
	"secondary_color" varchar(7) DEFAULT '#1e40af',
	"accent_color" varchar(7) DEFAULT '#10b981',
	"background_color" varchar(7) DEFAULT '#ffffff',
	"text_color" varchar(7) DEFAULT '#111827',
	"heading_font" varchar(100) DEFAULT 'Inter',
	"body_font" varchar(100) DEFAULT 'Inter',
	"custom_domain" varchar(255),
	"custom_domain_verified" boolean DEFAULT false,
	"custom_domain_verified_at" timestamp,
	"domain_verification_token" varchar(255),
	"footer_text" text,
	"support_email" varchar(255),
	"support_phone" varchar(50),
	"show_invoices" boolean DEFAULT true,
	"show_projects" boolean DEFAULT true,
	"show_time_entries" boolean DEFAULT true,
	"show_prepaid" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_branding_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "prepaid_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"total_hours" numeric(8, 2) NOT NULL,
	"used_hours" numeric(8, 2) DEFAULT '0',
	"remaining_hours" numeric(8, 2) NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"total_value" numeric(10, 2) NOT NULL,
	"purchase_date" timestamp NOT NULL,
	"expiry_date" timestamp,
	"is_active" boolean DEFAULT true,
	"is_archived" boolean DEFAULT false,
	"hidden_from_portal" boolean DEFAULT false NOT NULL,
	"description" text,
	"clip_size_minutes" integer,
	"auto_deduct" boolean DEFAULT true NOT NULL,
	"overdraft_policy" varchar(10) DEFAULT 'block' NOT NULL,
	"overdraft_rate" numeric(10, 2),
	"overdraft_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"renewal_interval" varchar(10),
	"renewal_rollover" varchar(10) DEFAULT 'none' NOT NULL,
	"renewal_next_at" timestamp,
	"renewal_base_hours" numeric(8, 2),
	"renewed_from_id" uuid,
	"low_balance_alert_sent_at" timestamp,
	"expiry_alert_sent_at" timestamp,
	"alunta_mapping_id" uuid,
	"alunta_invoice_uuid" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prepaid_packages_remaining_non_negative" CHECK (remaining_hours >= 0),
	CONSTRAINT "prepaid_packages_remaining_within_total" CHECK (remaining_hours <= total_hours)
);
--> statement-breakpoint
CREATE TABLE "prepaid_renewal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prepaid_package_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"freelancer_id" text NOT NULL,
	"organization_id" text,
	"portal_access_id" uuid,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"message" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prepaid_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(255) NOT NULL,
	"total_hours" numeric(8, 2) NOT NULL,
	"hourly_rate" numeric(10, 2),
	"clip_size_minutes" integer,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prepaid_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prepaid_package_id" uuid NOT NULL,
	"time_entry_id" uuid,
	"hours_used" numeric(8, 2) NOT NULL,
	"overdraft_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"value_used" numeric(12, 2) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"event" varchar(50) NOT NULL,
	"source" varchar(20) DEFAULT 'web' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_activity_types" (
	"project_id" uuid NOT NULL,
	"activity_type_id" uuid NOT NULL,
	CONSTRAINT "project_activity_types_pk" PRIMARY KEY("project_id","activity_type_id")
);
--> statement-breakpoint
CREATE TABLE "project_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_assignments_org_project_user_unique" UNIQUE("organization_id","project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"notified_level" integer DEFAULT 0 NOT NULL,
	"notified_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tags" (
	"project_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_tags_project_id_tag_id_pk" PRIMARY KEY("project_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"client_id" uuid,
	"user_id" text NOT NULL,
	"organization_id" text,
	"hourly_rate" numeric(10, 2),
	"rounding_enabled" boolean,
	"rounding_minutes" integer,
	"rounding_method" varchar(10),
	"fixed_price" numeric(10, 2),
	"monthly_budget_hours" numeric(7, 2),
	"budget_hours" numeric(7, 2),
	"status" varchar(50) DEFAULT 'active',
	"start_date" timestamp,
	"end_date" timestamp,
	"url_patterns" jsonb DEFAULT '[]'::jsonb,
	"available_to_all" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"endpoint" text NOT NULL,
	"p256dh_key" text,
	"auth_key" text,
	"user_agent" text,
	"device_name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"client_id" uuid,
	"project_id" uuid,
	"old_rate" numeric(10, 2),
	"new_rate" numeric(10, 2) NOT NULL,
	"rate_type" varchar(50) NOT NULL,
	"effective_date" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoice_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_invoice_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"invoice_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"prepaid_package_id" uuid,
	"name" varchar(255) NOT NULL,
	"billing_mode" varchar(10) DEFAULT 'fixed' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invoice_template_id" uuid,
	"payment_terms_days" integer,
	"notes" text,
	"interval" varchar(10) NOT NULL,
	"anchor_day" integer NOT NULL,
	"next_run_date" date NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_template_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid
);
--> statement-breakpoint
CREATE TABLE "recurring_time_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"user_id" text NOT NULL,
	"organization_id" text,
	"prepaid_package_id" uuid,
	"description" text NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"billable_rate" numeric(10, 2),
	"is_prepaid" boolean DEFAULT false,
	"template_type" varchar(20) DEFAULT 'time_entry' NOT NULL,
	"frequency" varchar(50),
	"day_of_week" integer,
	"day_of_month" integer,
	"start_date" timestamp,
	"end_date" timestamp,
	"is_active" boolean DEFAULT true,
	"is_paused" boolean DEFAULT false,
	"paused_until" timestamp,
	"pause_reason" varchar(255),
	"last_generated" timestamp,
	"next_due" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"report_template_id" uuid NOT NULL,
	"report_type" varchar(30) DEFAULT 'time' NOT NULL,
	"frequency" varchar(10) NOT NULL,
	"send_day" integer DEFAULT 1 NOT NULL,
	"recipients" jsonb NOT NULL,
	"format" varchar(10) DEFAULT 'pdf' NOT NULL,
	"subject" varchar(200),
	"message" text,
	"restrict_to_own_entries" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64),
	"token_encrypted" text,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(120) NOT NULL,
	"config" jsonb NOT NULL,
	"restrict_to_own_entries" boolean DEFAULT false NOT NULL,
	"locked_dates" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"organization_id" text,
	"report_type" varchar(30) DEFAULT 'time' NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"client_id" uuid,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_plan_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"activity_type_id" uuid,
	"week_start" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_plan_entries_hours_range" CHECK (hours > 0 AND hours <= 168)
);
--> statement-breakpoint
CREATE TABLE "roadmap_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"category" varchar(50),
	"priority" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"role_name" varchar(50) NOT NULL,
	"module_key" varchar(50) NOT NULL,
	"access_level" varchar(10) DEFAULT 'write' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_rate_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"client_id" uuid,
	"project_id" uuid,
	"new_rate" numeric(10, 2) NOT NULL,
	"old_rate" numeric(10, 2),
	"effective_date" date NOT NULL,
	"applied_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_rate_changes_one_target" CHECK ((client_id IS NOT NULL) <> (project_id IS NOT NULL)),
	CONSTRAINT "scheduled_rate_changes_rate_non_negative" CHECK (new_rate >= 0)
);
--> statement-breakpoint
CREATE TABLE "sent_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resend_email_id" varchar(255),
	"user_id" text NOT NULL,
	"organization_id" text,
	"email_type" varchar(50) NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"subject" varchar(500),
	"invoice_id" uuid,
	"client_id" uuid,
	"latest_status" varchar(30) DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"bounced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sent_emails_resend_email_id_unique" UNIQUE("resend_email_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"impersonatedBy" text,
	"activeOrganizationId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stability_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"detector" varchar(40) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"fingerprint" varchar(200) NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"user_id" text,
	"organization_id" text,
	"title" text NOT NULL,
	"first_seen" timestamp NOT NULL,
	"last_seen" timestamp NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"sample" jsonb,
	"last_alerted_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolution_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(20) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"notification_type" varchar(80),
	"subscription_id" uuid,
	"outcome" varchar(30),
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" varchar(255) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'success' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_webhook_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"billing_cycle" varchar(20) NOT NULL,
	"status" varchar(50) DEFAULT 'trialing' NOT NULL,
	"is_trial" boolean DEFAULT true,
	"trial_starts_at" timestamp DEFAULT now(),
	"trial_ends_at" timestamp NOT NULL,
	"alunta_subscription_id" varchar(255),
	"alunta_customer_id" varchar(255),
	"alunta_plan_id" varchar(255),
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"stripe_price_id" varchar(255),
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"canceled_at" timestamp,
	"promo_code" varchar(50),
	"promo_months_free" integer DEFAULT 0,
	"founding_tier" varchar(30),
	"discount_percent" integer DEFAULT 0,
	"discount_expires_at" timestamp,
	"past_due_since" timestamp,
	"seat_count" integer DEFAULT 1 NOT NULL,
	"max_seats" integer DEFAULT 1 NOT NULL,
	"plan_tier" varchar(20) DEFAULT 'solo' NOT NULL,
	"store_provider" varchar(20),
	"store_product_id" varchar(255),
	"store_original_transaction_id" varchar(255),
	"store_purchase_token" text,
	"store_environment" varchar(20),
	"store_status" varchar(30),
	"store_last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "support_inboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(7) DEFAULT '#3b82f6' NOT NULL,
	"signature" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "support_inboxes_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"direction" varchar(10) NOT NULL,
	"from_email" varchar(255) NOT NULL,
	"from_name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"body_text" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"message_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_reply_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"subject" varchar(200),
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" varchar(10) NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" varchar(500) NOT NULL,
	"sender_email" varchar(255) NOT NULL,
	"sender_name" varchar(255) NOT NULL,
	"user_id" text,
	"organization_id" text,
	"inbox_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"priority" varchar(10) DEFAULT 'normal' NOT NULL,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(50) NOT NULL,
	"color" varchar(7) DEFAULT '#3b82f6' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea",
	"source_email_id" varchar(255),
	"storage_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"content" jsonb NOT NULL,
	"content_html" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"scope" varchar(10) NOT NULL,
	"project_id" uuid,
	"name" varchar(50) NOT NULL,
	"color" varchar(7) NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"is_archive" boolean DEFAULT false NOT NULL,
	"category" varchar(20) DEFAULT 'not_started' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_statuses_scope_project_check" CHECK (
		("scope" = 'general' AND "project_id" IS NULL)
		OR ("scope" = 'project' AND "project_id" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"assigned_to_user_id" text,
	"title" varchar(255) NOT NULL,
	"description" text,
	"notes" text,
	"project_id" uuid,
	"client_id" uuid,
	"status" varchar(20) DEFAULT 'backlog' NOT NULL,
	"status_id" uuid,
	"priority" varchar(20) DEFAULT 'medium',
	"deadline" timestamp,
	"completed_at" timestamp,
	"parent_task_id" uuid,
	"position" integer DEFAULT 0,
	"estimated_minutes" integer,
	"actual_minutes" integer,
	"source_type" varchar(20) DEFAULT 'manual',
	"source_id" varchar(255),
	"source_url" text,
	"ai_suggested_project" uuid,
	"ai_suggested_client" uuid,
	"ai_suggested_priority" varchar(20),
	"ai_suggested_deadline" timestamp,
	"ai_confidence" numeric(3, 2),
	"ai_processed_at" timestamp,
	"calendar_event_id" uuid,
	"active_time_entry_id" uuid,
	"thread_email_count" integer DEFAULT 1,
	"last_thread_update" timestamp,
	"email_relevance_feedback" varchar(10),
	"feedback_provided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_alunta_subscriptions" (
	"subscription_id" varchar(255) PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"client_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"period_start" date,
	"period_end" date,
	"invoice_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"entry_ids" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp,
	"response_note" text
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"client_id" uuid,
	"user_id" text NOT NULL,
	"organization_id" text,
	"prepaid_package_id" uuid,
	"recurring_template_id" uuid,
	"invoice_id" uuid,
	"task_id" uuid,
	"activity_type_id" uuid,
	"description" text,
	"notes" text,
	"hours" numeric(5, 2) NOT NULL,
	"date" timestamp NOT NULL,
	"start_time" timestamp,
	"end_time" timestamp,
	"billable_rate" numeric(10, 2),
	"cost_rate" numeric(10, 2),
	"is_billable" boolean DEFAULT true,
	"is_billed" boolean DEFAULT false,
	"is_prepaid" boolean DEFAULT false,
	"is_from_template" boolean DEFAULT false,
	"source" varchar(20) DEFAULT 'manual',
	"client_entry_id" varchar(36),
	"timer_session_id" uuid,
	"approval_status" varchar(20) DEFAULT 'not_required' NOT NULL,
	"approved_at" timestamp,
	"approved_by" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"duration_minutes" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry_tags" (
	"entry_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"inherited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "time_entry_tags_entry_id_tag_id_pk" PRIMARY KEY("entry_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "timer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"event" varchar(32) NOT NULL,
	"source" varchar(16) NOT NULL,
	"client_hint" varchar(64),
	"version_before" integer,
	"version_after" integer,
	"start_time" timestamp,
	"base_seconds" integer,
	"project_id" uuid,
	"client_id" uuid,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "timer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"status" varchar(12) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"project_id" uuid,
	"client_id" uuid,
	"task_id" uuid,
	"description" text DEFAULT '',
	"version" integer DEFAULT 1 NOT NULL,
	"saved_entry_id" uuid,
	"continues_entry_id" uuid,
	"start_op_id" varchar(36),
	"source" varchar(16),
	"client_hint" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timer_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"is_running" boolean DEFAULT false,
	"start_time" timestamp,
	"elapsed_seconds" integer DEFAULT 0,
	"base_seconds" integer DEFAULT 0,
	"project_id" uuid,
	"client_id" uuid,
	"task_id" uuid,
	"description" text DEFAULT '',
	"last_synced_at" timestamp DEFAULT now(),
	"last_synced_from" varchar(20),
	"version" integer DEFAULT 0 NOT NULL,
	"intent" varchar(20),
	"intent_at" timestamp,
	"intent_from" varchar(20),
	"is_idle" boolean DEFAULT false,
	"idle_detected_at" timestamp,
	"idle_threshold_minutes" integer DEFAULT 5,
	"auto_pause_after_minutes" integer DEFAULT 120,
	"last_activity_at" timestamp,
	"last_client_op_id" varchar(36),
	"current_session_id" uuid,
	"prepaid_choice" varchar(10),
	"prepaid_package_id" uuid,
	"prepaid_choice_client_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timer_states_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "timer_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(255) NOT NULL,
	"project_id" uuid,
	"client_id" uuid,
	"description" text,
	"color" varchar(20) DEFAULT '#3b82f6',
	"is_favorite" boolean DEFAULT false,
	"usage_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_hidden_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_hidden_projects_org_user_project_unique" UNIQUE("organization_id","user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "timesheet_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"template_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_templates_user_name_org_unique" UNIQUE("user_id","name","organization_id")
);
--> statement-breakpoint
CREATE TABLE "timesheet_week_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"user_label" varchar(255),
	"week_start" date NOT NULL,
	"event" varchar(20) NOT NULL,
	"actor_id" text,
	"actor_label" varchar(255),
	"reason" text,
	"total_hours" numeric(6, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"week_start" date NOT NULL,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"total_hours" numeric(6, 2),
	"submitted_at" timestamp,
	"decided_by" text,
	"decided_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_weeks_user_week_org_unique" UNIQUE("user_id","week_start","organization_id")
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"device_token" text NOT NULL,
	"user_agent" text,
	"ip_address" varchar(45),
	"last_used" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_devices_device_token_unique" UNIQUE("device_token")
);
--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failedVerificationCount" integer DEFAULT 0,
	"lockedUntil" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "twoFactor_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" varchar(20) DEFAULT 'timetrack' NOT NULL,
	"email" varchar(255) NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"image" text,
	"phoneNumber" varchar(50),
	"phoneNumberVerified" boolean DEFAULT false,
	"default_hourly_rate" numeric(10, 2),
	"rounding_enabled" boolean,
	"rounding_minutes" integer,
	"rounding_method" varchar(10),
	"hide_prepaid_value" boolean DEFAULT false NOT NULL,
	"billy_api_key" text,
	"billy_organization_id" varchar(255),
	"dinero_api_key" text,
	"dinero_organization_id" varchar(255),
	"dinero_refresh_token" text,
	"dinero_token_expiry" timestamp,
	"dinero_org_name" varchar(255),
	"economic_app_secret_token" text,
	"economic_agreement_grant_token" text,
	"timeops_api_key" text,
	"billy_default_account_id" varchar(255),
	"billy_default_product_id" varchar(255),
	"billy_klippekort_product_id" varchar(255),
	"billy_line_type" varchar(20) DEFAULT 'per_entry',
	"billy_line_template" text DEFAULT '{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}',
	"dinero_default_account_number" integer,
	"dinero_product_guid_time" varchar(255),
	"dinero_product_guid_klippekort" varchar(255),
	"dinero_line_type" varchar(20) DEFAULT 'per_entry',
	"dinero_line_template" text DEFAULT '{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}',
	"economic_default_layout_number" integer,
	"economic_default_product_number" varchar(50),
	"economic_klippekort_product_number" varchar(50),
	"economic_default_payment_terms_number" integer,
	"economic_line_type" varchar(20) DEFAULT 'per_entry',
	"economic_line_template" text DEFAULT '{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}',
	"onboarding_completed" boolean DEFAULT false,
	"theme" varchar(20) DEFAULT 'light',
	"prepaid_alert_recipient" varchar(20) DEFAULT 'owner',
	"weekly_hour_goal" numeric(4, 1) DEFAULT '37.0',
	"inbound_email_id" varchar(32),
	"ai_autonomy_level" varchar(20) DEFAULT 'auto_all',
	"ai_email_processing" boolean DEFAULT true,
	"ai_provider" varchar(20) DEFAULT 'system',
	"ai_api_key" text,
	"ai_api_url" varchar(500),
	"ai_model" varchar(100),
	"working_hours_start" varchar(5) DEFAULT '09:00',
	"working_hours_end" varchar(5) DEFAULT '17:00',
	"working_days" text[] DEFAULT '{"1","2","3","4","5"}',
	"work_schedule" jsonb,
	"coverage_reminder_threshold" integer,
	"dismissed_banners" text[] DEFAULT '{}',
	"timezone" varchar(50) DEFAULT 'Europe/Copenhagen',
	"twoFactorEnabled" boolean DEFAULT false,
	"default_accounting_integration" varchar(20),
	"auto_sync_invoices" boolean DEFAULT false,
	"role" varchar(20) DEFAULT 'user',
	"resend_contact_id" varchar(255),
	"is_flagged" boolean DEFAULT false,
	"flagged_reason" text,
	"flagged_at" timestamp,
	"flagged_by" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"is_demo" boolean DEFAULT false,
	"attr_source" varchar(100),
	"attr_medium" varchar(100),
	"attr_campaign" varchar(200),
	"attr_referrer" text,
	"attr_landing_page" text,
	"attr_gclid" varchar(120),
	"locale" varchar(10) DEFAULT 'da',
	"last_seen_changelog_id" uuid,
	"approval_workflow" varchar(20) DEFAULT 'off',
	"start_page" text,
	"company_type" varchar(30),
	"vat_period" varchar(20),
	"fiscal_year_end" varchar(5),
	"has_employees" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phoneNumber_unique" UNIQUE("phoneNumber"),
	CONSTRAINT "user_inbound_email_id_unique" UNIQUE("inbound_email_id")
);
--> statement-breakpoint
CREATE TABLE "vacation_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"rolled_over_at" timestamp,
	"total_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"used_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"remaining_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"extra_total_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"extra_used_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"extra_remaining_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacation_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"user_label" varchar(255),
	"pool" varchar(10) DEFAULT 'vacation' NOT NULL,
	"entry_type" varchar(20) NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"vacation_year_start" date NOT NULL,
	"ref_type" varchar(30),
	"ref_id" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"event_id" uuid,
	"payload" jsonb NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) NOT NULL,
	"response_status" integer,
	"response_body" text,
	"response_time_ms" integer,
	"error_message" text,
	"scheduled_for" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"source" varchar(50) DEFAULT 'alunta' NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'success' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "week_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"week_start" timestamp NOT NULL,
	"closed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_day_deviations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"kind" varchar(20) DEFAULT 'worked' NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"break_minutes" integer,
	"hours" numeric(5, 2) NOT NULL,
	"note" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_day_deviations_org_user_date_unique" UNIQUE("organization_id","user_id","date")
);
--> statement-breakpoint
CREATE TABLE "work_plan_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" text,
	"department_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_plan_assignments_target" CHECK ((user_id IS NOT NULL AND department_id IS NULL) OR (user_id IS NULL AND department_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "work_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"rotation_weeks" integer DEFAULT 1 NOT NULL,
	"rotation_anchor" date,
	"weeks" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_plan_versions_plan_valid_from_unique" UNIQUE("plan_id","valid_from"),
	CONSTRAINT "work_plan_versions_rotation" CHECK (rotation_weeks IN (1, 2))
);
--> statement-breakpoint
CREATE TABLE "work_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"preset" varchar(30),
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_absence_type_id_absence_types_id_fk" FOREIGN KEY ("absence_type_id") REFERENCES "public"."absence_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_registered_by_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_closure_period_id_org_closure_periods_id_fk" FOREIGN KEY ("closure_period_id") REFERENCES "public"."org_closure_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_types" ADD CONSTRAINT "absence_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_types" ADD CONSTRAINT "activity_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_activity_logs" ADD CONSTRAINT "admin_activity_logs_admin_user_id_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_activity_logs" ADD CONSTRAINT "admin_activity_logs_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_notes" ADD CONSTRAINT "admin_user_notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_notes" ADD CONSTRAINT "admin_user_notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_processing_logs" ADD CONSTRAINT "ai_processing_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_processing_logs" ADD CONSTRAINT "ai_processing_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alunta_klippekort_tokens" ADD CONSTRAINT "alunta_klippekort_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alunta_klippekort_tokens" ADD CONSTRAINT "alunta_klippekort_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alunta_plan_mappings" ADD CONSTRAINT "alunta_plan_mappings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alunta_plan_mappings" ADD CONSTRAINT "alunta_plan_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alunta_plan_mappings" ADD CONSTRAINT "alunta_plan_mappings_token_id_alunta_klippekort_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."alunta_klippekort_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alunta_plan_mappings" ADD CONSTRAINT "alunta_plan_mappings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banned_domains" ADD CONSTRAINT "banned_domains_banned_by_user_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banned_email_domains" ADD CONSTRAINT "banned_email_domains_banned_by_user_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_parent_connection_id_calendar_connections_id_fk" FOREIGN KEY ("parent_connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_default_project_id_projects_id_fk" FOREIGN KEY ("default_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_connection_id_calendar_connections_id_fk" FOREIGN KEY ("calendar_connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_linked_task_id_tasks_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_linked_time_entry_id_time_entries_id_fk" FOREIGN KEY ("linked_time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_matching_rules" ADD CONSTRAINT "calendar_matching_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_matching_rules" ADD CONSTRAINT "calendar_matching_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_matching_rules" ADD CONSTRAINT "calendar_matching_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_matching_rules" ADD CONSTRAINT "calendar_matching_rules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_playbook_runs" ADD CONSTRAINT "churn_playbook_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_freelancer_id_user_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_sessions" ADD CONSTRAINT "client_portal_sessions_portal_access_id_client_portal_access_id_fk" FOREIGN KEY ("portal_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_preferences" ADD CONSTRAINT "dashboard_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_preferences" ADD CONSTRAINT "dashboard_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_off_calendars" ADD CONSTRAINT "day_off_calendars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_off_calendars" ADD CONSTRAINT "day_off_calendars_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_off_calendars" ADD CONSTRAINT "day_off_calendars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_off_calendars" ADD CONSTRAINT "day_off_calendars_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_device" ADD CONSTRAINT "desktop_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_license_device" ADD CONSTRAINT "desktop_license_device_license_id_desktop_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."desktop_license"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_license" ADD CONSTRAINT "desktop_license_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sync_log" ADD CONSTRAINT "desktop_sync_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sync_log" ADD CONSTRAINT "desktop_sync_log_device_id_desktop_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."desktop_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sync_tombstones" ADD CONSTRAINT "desktop_sync_tombstones_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sync_tombstones" ADD CONSTRAINT "desktop_sync_tombstones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_auth_codes" ADD CONSTRAINT "device_auth_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_auth_codes" ADD CONSTRAINT "device_auth_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_idempotency_keys" ADD CONSTRAINT "device_idempotency_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_import_map" ADD CONSTRAINT "device_import_map_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_import_map" ADD CONSTRAINT "device_import_map_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_learned_patterns" ADD CONSTRAINT "device_learned_patterns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_learned_patterns" ADD CONSTRAINT "device_learned_patterns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_match_rules" ADD CONSTRAINT "device_match_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_match_rules" ADD CONSTRAINT "device_match_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_match_rules" ADD CONSTRAINT "device_match_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_match_rules" ADD CONSTRAINT "device_match_rules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dinero_oauth_pending" ADD CONSTRAINT "dinero_oauth_pending_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dinero_oauth_pending" ADD CONSTRAINT "dinero_oauth_pending_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_classification_cache" ADD CONSTRAINT "email_classification_cache_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_logs" ADD CONSTRAINT "email_delivery_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_filter_rules" ADD CONSTRAINT "email_filter_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_filter_rules" ADD CONSTRAINT "email_filter_rules_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_forwarding_logs" ADD CONSTRAINT "email_forwarding_logs_rule_id_email_forwarding_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."email_forwarding_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_forwarding_rules" ADD CONSTRAINT "email_forwarding_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_integrations" ADD CONSTRAINT "email_integrations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_integrations" ADD CONSTRAINT "email_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sync_queue" ADD CONSTRAINT "email_sync_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_matched_client_id_clients_id_fk" FOREIGN KEY ("matched_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_manager_id_employee_profiles_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employee_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_employee_profile_id_employee_profiles_id_fk" FOREIGN KEY ("employee_profile_id") REFERENCES "public"."employee_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flex_entries" ADD CONSTRAINT "flex_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flex_entries" ADD CONSTRAINT "flex_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_time_entries" ADD CONSTRAINT "generated_time_entries_recurring_template_id_recurring_time_templates_id_fk" FOREIGN KEY ("recurring_template_id") REFERENCES "public"."recurring_time_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_time_entries" ADD CONSTRAINT "generated_time_entries_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_feedback" ADD CONSTRAINT "help_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_logs" ADD CONSTRAINT "integration_sync_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_logs" ADD CONSTRAINT "integration_sync_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_oauthRefreshToken_id_fk" FOREIGN KEY ("refreshId") REFERENCES "public"."oauthRefreshToken"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_oauthResource_identifier_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."oauthResource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_audit_logs" ADD CONSTRAINT "org_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_audit_logs" ADD CONSTRAINT "org_audit_logs_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_closure_periods" ADD CONSTRAINT "org_closure_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_closure_periods" ADD CONSTRAINT "org_closure_periods_absence_type_id_absence_types_id_fk" FOREIGN KEY ("absence_type_id") REFERENCES "public"."absence_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_closure_periods" ADD CONSTRAINT "org_closure_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_dpa_acceptances" ADD CONSTRAINT "org_dpa_acceptances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_dpa_acceptances" ADD CONSTRAINT "org_dpa_acceptances_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_notification_settings" ADD CONSTRAINT "org_notification_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_period_locks" ADD CONSTRAINT "org_period_locks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_period_locks" ADD CONSTRAINT "org_period_locks_locked_by_user_id_user_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_verified_domains" ADD CONSTRAINT "org_verified_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_verified_domains" ADD CONSTRAINT "org_verified_domains_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_webhooks" ADD CONSTRAINT "outgoing_webhooks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_webhooks" ADD CONSTRAINT "outgoing_webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_webhooks" ADD CONSTRAINT "outgoing_webhooks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_webhooks" ADD CONSTRAINT "outgoing_webhooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD CONSTRAINT "overtime_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD CONSTRAINT "overtime_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD CONSTRAINT "overtime_ledger_absence_request_id_absence_requests_id_fk" FOREIGN KEY ("absence_request_id") REFERENCES "public"."absence_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD CONSTRAINT "overtime_ledger_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_wage_type_id_payroll_wage_types_id_fk" FOREIGN KEY ("wage_type_id") REFERENCES "public"."payroll_wage_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_mapping_rules" ADD CONSTRAINT "payroll_mapping_rules_absence_type_id_absence_types_id_fk" FOREIGN KEY ("absence_type_id") REFERENCES "public"."absence_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_wage_types" ADD CONSTRAINT "payroll_wage_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_unlocked_by_user_id_fk" FOREIGN KEY ("unlocked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_activity_logs" ADD CONSTRAINT "portal_activity_logs_portal_access_id_client_portal_access_id_fk" FOREIGN KEY ("portal_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_activity_logs" ADD CONSTRAINT "portal_activity_logs_freelancer_id_user_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_branding" ADD CONSTRAINT "portal_branding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_branding" ADD CONSTRAINT "portal_branding_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD CONSTRAINT "prepaid_packages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD CONSTRAINT "prepaid_packages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD CONSTRAINT "prepaid_packages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD CONSTRAINT "prepaid_packages_alunta_mapping_id_alunta_plan_mappings_id_fk" FOREIGN KEY ("alunta_mapping_id") REFERENCES "public"."alunta_plan_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_freelancer_id_user_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_portal_access_id_client_portal_access_id_fk" FOREIGN KEY ("portal_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_templates" ADD CONSTRAINT "prepaid_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_templates" ADD CONSTRAINT "prepaid_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_usage" ADD CONSTRAINT "prepaid_usage_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_usage" ADD CONSTRAINT "prepaid_usage_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_types" ADD CONSTRAINT "project_activity_types_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity_types" ADD CONSTRAINT "project_activity_types_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_alerts" ADD CONSTRAINT "project_budget_alerts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_recurring_invoice_id_recurring_invoices_id_fk" FOREIGN KEY ("recurring_invoice_id") REFERENCES "public"."recurring_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_invoice_template_id_invoice_templates_id_fk" FOREIGN KEY ("invoice_template_id") REFERENCES "public"."invoice_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template_clients" ADD CONSTRAINT "recurring_template_clients_template_id_recurring_time_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recurring_time_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template_clients" ADD CONSTRAINT "recurring_template_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_template_clients" ADD CONSTRAINT "recurring_template_clients_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_time_templates" ADD CONSTRAINT "recurring_time_templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_time_templates" ADD CONSTRAINT "recurring_time_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_time_templates" ADD CONSTRAINT "recurring_time_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_time_templates" ADD CONSTRAINT "recurring_time_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_time_templates" ADD CONSTRAINT "recurring_time_templates_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_report_template_id_report_templates_id_fk" FOREIGN KEY ("report_template_id") REFERENCES "public"."report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_plan_entries" ADD CONSTRAINT "resource_plan_entries_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_rate_changes" ADD CONSTRAINT "scheduled_rate_changes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_rate_changes" ADD CONSTRAINT "scheduled_rate_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_rate_changes" ADD CONSTRAINT "scheduled_rate_changes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_rate_changes" ADD CONSTRAINT "scheduled_rate_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_billing_events" ADD CONSTRAINT "store_billing_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_reply_templates" ADD CONSTRAINT "support_reply_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_inbox_id_support_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."support_inboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_statuses" ADD CONSTRAINT "task_statuses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_statuses" ADD CONSTRAINT "task_statuses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_statuses" ADD CONSTRAINT "task_statuses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_task_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."task_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ai_suggested_project_projects_id_fk" FOREIGN KEY ("ai_suggested_project") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ai_suggested_client_clients_id_fk" FOREIGN KEY ("ai_suggested_client") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_approval_requests" ADD CONSTRAINT "time_approval_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_approval_requests" ADD CONSTRAINT "time_approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_approval_requests" ADD CONSTRAINT "time_approval_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_approval_requests" ADD CONSTRAINT "time_approval_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_recurring_template_id_recurring_time_templates_id_fk" FOREIGN KEY ("recurring_template_id") REFERENCES "public"."recurring_time_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_segments" ADD CONSTRAINT "time_entry_segments_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_tags" ADD CONSTRAINT "time_entry_tags_entry_id_time_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_tags" ADD CONSTRAINT "time_entry_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_events" ADD CONSTRAINT "timer_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_sessions" ADD CONSTRAINT "timer_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_prepaid_choice_client_id_clients_id_fk" FOREIGN KEY ("prepaid_choice_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_templates" ADD CONSTRAINT "timer_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_templates" ADD CONSTRAINT "timer_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_templates" ADD CONSTRAINT "timer_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_templates" ADD CONSTRAINT "timer_templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_hidden_projects" ADD CONSTRAINT "timesheet_hidden_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_hidden_projects" ADD CONSTRAINT "timesheet_hidden_projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_hidden_projects" ADD CONSTRAINT "timesheet_hidden_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_templates" ADD CONSTRAINT "timesheet_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_templates" ADD CONSTRAINT "timesheet_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_week_events" ADD CONSTRAINT "timesheet_week_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_week_events" ADD CONSTRAINT "timesheet_week_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_week_events" ADD CONSTRAINT "timesheet_week_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD CONSTRAINT "vacation_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD CONSTRAINT "vacation_balances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_ledger" ADD CONSTRAINT "vacation_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_ledger" ADD CONSTRAINT "vacation_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_ledger" ADD CONSTRAINT "vacation_ledger_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_outgoing_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."outgoing_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_closures" ADD CONSTRAINT "week_closures_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_deviations" ADD CONSTRAINT "work_day_deviations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_deviations" ADD CONSTRAINT "work_day_deviations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_deviations" ADD CONSTRAINT "work_day_deviations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_deviations" ADD CONSTRAINT "work_day_deviations_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_plan_id_work_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."work_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_assignments" ADD CONSTRAINT "work_plan_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_versions" ADD CONSTRAINT "work_plan_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_versions" ADD CONSTRAINT "work_plan_versions_plan_id_work_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."work_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plan_versions" ADD CONSTRAINT "work_plan_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_requests_org_status_idx" ON "absence_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "absence_requests_user_org_idx" ON "absence_requests" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "absence_requests_closure_period_idx" ON "absence_requests" USING btree ("closure_period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "absence_requests_timesheet_day_unique" ON "absence_requests" USING btree ("user_id","organization_id","absence_type_id","start_date") WHERE "absence_requests"."source" = 'timesheet' AND "absence_requests"."status" IN ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "activity_logs_org_id_idx" ON "activity_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "activity_types_org_idx" ON "activity_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "admin_user_notes_user_id_idx" ON "admin_user_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_user_notes_author_id_idx" ON "admin_user_notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "alunta_plan_mappings_token_plan_idx" ON "alunta_plan_mappings" USING btree ("token_id","alunta_plan_uuid","is_active");--> statement-breakpoint
CREATE INDEX "alunta_plan_mappings_client_idx" ON "alunta_plan_mappings" USING btree ("client_id","is_active");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "calendar_events_org_id_idx" ON "calendar_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "check_ins_user_org_idx" ON "check_ins" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "check_ins_user_open_idx" ON "check_ins" USING btree ("user_id","checked_out_at");--> statement-breakpoint
CREATE INDEX "churn_playbook_runs_user_idx" ON "churn_playbook_runs" USING btree ("user_id","playbook_key","triggered_at");--> statement-breakpoint
CREATE INDEX "clients_user_id_idx" ON "clients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "clients_org_id_idx" ON "clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "clients_user_archived_idx" ON "clients" USING btree ("user_id","is_archived");--> statement-breakpoint
CREATE INDEX "clients_org_archived_idx" ON "clients" USING btree ("organization_id","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "company_profiles_org_id_idx" ON "company_profiles" USING btree ("organization_id") WHERE "organization_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cron_job_logs_job_name_idx" ON "cron_job_logs" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "cron_job_logs_started_at_idx" ON "cron_job_logs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "day_off_calendars_org_unique" ON "day_off_calendars" USING btree ("organization_id") WHERE department_id IS NULL AND user_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "day_off_calendars_department_unique" ON "day_off_calendars" USING btree ("department_id") WHERE department_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "day_off_calendars_user_unique" ON "day_off_calendars" USING btree ("user_id") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "department_managers_org_dept_user_idx" ON "department_managers" USING btree ("organization_id","department_id","user_id");--> statement-breakpoint
CREATE INDEX "department_managers_org_user_idx" ON "department_managers" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "desktop_analytics_event_idx" ON "desktop_analytics" USING btree ("event");--> statement-breakpoint
CREATE INDEX "desktop_analytics_created_at_idx" ON "desktop_analytics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "desktop_devices_user_id_idx" ON "desktop_device" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "desktop_devices_machine_id_idx" ON "desktop_device" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "desktop_license_device_license_id_idx" ON "desktop_license_device" USING btree ("license_id");--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_license_device_license_machine_unique" ON "desktop_license_device" USING btree ("license_id","machine_id");--> statement-breakpoint
CREATE INDEX "desktop_licenses_user_id_idx" ON "desktop_license" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "desktop_licenses_key_idx" ON "desktop_license" USING btree ("license_key");--> statement-breakpoint
CREATE INDEX "desktop_licenses_stripe_customer_idx" ON "desktop_license" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "desktop_licenses_stripe_pi_idx" ON "desktop_license" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "desktop_sync_log_user_id_idx" ON "desktop_sync_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "desktop_sync_log_device_id_idx" ON "desktop_sync_log" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "desktop_sync_log_entity_idx" ON "desktop_sync_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "desktop_sync_tombstones_user_deleted_idx" ON "desktop_sync_tombstones" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "desktop_sync_tombstones_org_deleted_idx" ON "desktop_sync_tombstones" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE INDEX "desktop_trials_machine_id_idx" ON "desktop_trial" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "device_auth_codes_user_idx" ON "device_auth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_idempotency_keys_uq" ON "device_idempotency_keys" USING btree ("user_id","org_key","scope","key");--> statement-breakpoint
CREATE INDEX "device_idempotency_keys_created_idx" ON "device_idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_import_map_local_uq" ON "device_import_map" USING btree ("organization_id","user_id","entity","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_learned_patterns_key_uq" ON "device_learned_patterns" USING btree ("user_id","organization_id","key_hash");--> statement-breakpoint
CREATE INDEX "device_learned_patterns_user_updated_idx" ON "device_learned_patterns" USING btree ("user_id","organization_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_match_rules_scope_uq" ON "device_match_rules" USING btree ("user_id","organization_id","kind","pattern");--> statement-breakpoint
CREATE INDEX "device_match_rules_user_updated_idx" ON "device_match_rules" USING btree ("user_id","organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "email_delivery_logs_template_type_idx" ON "email_delivery_logs" USING btree ("template_type");--> statement-breakpoint
CREATE INDEX "email_delivery_logs_status_idx" ON "email_delivery_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_delivery_logs_sent_at_idx" ON "email_delivery_logs" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "email_delivery_logs_user_id_idx" ON "email_delivery_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_events_resend_email_id_idx" ON "email_events" USING btree ("resend_email_id");--> statement-breakpoint
CREATE INDEX "email_events_event_type_idx" ON "email_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "email_filter_rules_user_active_idx" ON "email_filter_rules" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "email_fwd_logs_rule_id_idx" ON "email_forwarding_logs" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "email_fwd_logs_status_idx" ON "email_forwarding_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_fwd_logs_received_at_idx" ON "email_forwarding_logs" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "email_fwd_logs_from_address_idx" ON "email_forwarding_logs" USING btree ("from_address");--> statement-breakpoint
CREATE INDEX "email_fwd_rules_from_pattern_idx" ON "email_forwarding_rules" USING btree ("from_pattern");--> statement-breakpoint
CREATE INDEX "email_fwd_rules_is_active_idx" ON "email_forwarding_rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "email_sync_queue_status_priority_idx" ON "email_sync_queue" USING btree ("status","priority","scheduled_for");--> statement-breakpoint
CREATE INDEX "email_templates_org_id_idx" ON "email_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_threads_message_id_idx" ON "email_threads" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_threads_thread_id_idx" ON "email_threads" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_threads_task_id_idx" ON "email_threads" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "email_threads_conversation_id_idx" ON "email_threads" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "email_threads_subject_domain_hash_idx" ON "email_threads" USING btree ("user_id","subject_domain_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_profiles_org_user_idx" ON "employee_profiles" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_profiles_org_employee_number_unique" ON "employee_profiles" USING btree ("organization_id","employee_number") WHERE "employee_profiles"."employee_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employee_profiles_org_active_idx" ON "employee_profiles" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "employment_periods_profile_from_idx" ON "employment_periods" USING btree ("employee_profile_id","valid_from");--> statement-breakpoint
CREATE INDEX "employment_periods_org_user_idx" ON "employment_periods" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "flex_entries_user_org_date_idx" ON "flex_entries" USING btree ("user_id","organization_id","date");--> statement-breakpoint
CREATE INDEX "generated_time_entries_template_id_idx" ON "generated_time_entries" USING btree ("recurring_template_id");--> statement-breakpoint
CREATE INDEX "holidays_org_date_idx" ON "holidays" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "imports_user_id_status_idx" ON "imports" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "imports_status_idx" ON "imports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_sync_logs_org_id_idx" ON "integration_sync_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitations_org_status_idx" ON "invitations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_templates_user_id_idx" ON "invoice_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoice_templates_org_id_idx" ON "invoice_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_invoice_number_unique" ON "invoices" USING btree ("organization_id","invoice_number") WHERE organization_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_user_invoice_number_unique" ON "invoices" USING btree ("user_id","invoice_number") WHERE organization_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_related_credit_note_unique" ON "invoices" USING btree ("related_invoice_id") WHERE kind = 'credit_note';--> statement-breakpoint
CREATE INDEX "invoices_client_id_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_user_id_idx" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoices_org_id_idx" ON "invoices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "invoices_org_status_idx" ON "invoices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "invoices_user_status_idx" ON "invoices" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "invoices_org_created_idx" ON "invoices" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_user_created_idx" ON "invoices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_leads_email_tool_idx" ON "marketing_leads" USING btree ("email","tool");--> statement-breakpoint
CREATE UNIQUE INDEX "mca_org_member_client_idx" ON "member_client_access" USING btree ("organization_id","member_id","client_id");--> statement-breakpoint
CREATE INDEX "mca_member_idx" ON "member_client_access" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "mca_client_idx" ON "member_client_access" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "member_rates_lookup_idx" ON "member_rates" USING btree ("organization_id","member_id","project_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_org_user_idx" ON "members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_id_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mobile_push_tokens_user_idx" ON "mobile_push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_channels_user_id_idx" ON "notification_channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_org_created_idx" ON "notification_deliveries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_inbox_user_read_idx" ON "notification_inbox" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauthAccessToken" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauthAccessToken" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken" USING btree ("authorizationCodeId");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauthAccessToken" USING btree ("refreshId");--> statement-breakpoint
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource" USING btree ("resourceId");--> statement-breakpoint
CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauthConsent_userId_idx" ON "oauthConsent" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken" USING btree ("authorizationCodeId");--> statement-breakpoint
CREATE INDEX "org_audit_logs_org_id_idx" ON "org_audit_logs" USING btree ("organization_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "org_closure_periods_org_start_idx" ON "org_closure_periods" USING btree ("organization_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "org_dpa_acceptances_org_version_unique" ON "org_dpa_acceptances" USING btree ("organization_id","version");--> statement-breakpoint
CREATE INDEX "org_period_locks_org_idx" ON "org_period_locks" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_verified_domains_org_domain_unique" ON "org_verified_domains" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "org_verified_domains_verified_unique" ON "org_verified_domains" USING btree ("domain") WHERE "org_verified_domains"."status" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX "org_modules_org_key_idx" ON "organization_modules" USING btree ("organization_id","module_key");--> statement-breakpoint
CREATE INDEX "org_modules_org_idx" ON "organization_modules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "outgoing_webhooks_user_active_idx" ON "outgoing_webhooks" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "outgoing_webhooks_org_id_idx" ON "outgoing_webhooks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "overtime_ledger_user_org_idx" ON "overtime_ledger" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "payroll_mapping_rules_org_idx" ON "payroll_mapping_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payroll_mapping_rules_wage_type_idx" ON "payroll_mapping_rules" USING btree ("wage_type_id");--> statement-breakpoint
CREATE INDEX "payroll_wage_types_org_idx" ON "payroll_wage_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "period_closings_org_period_idx" ON "period_closings" USING btree ("organization_id","period_start");--> statement-breakpoint
CREATE INDEX "portal_branding_custom_domain_idx" ON "portal_branding" USING btree ("custom_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_branding_org_id_idx" ON "portal_branding" USING btree ("organization_id") WHERE "organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prepaid_packages_alunta_invoice_idx" ON "prepaid_packages" USING btree ("alunta_invoice_uuid");--> statement-breakpoint
CREATE INDEX "prepaid_packages_alunta_mapping_idx" ON "prepaid_packages" USING btree ("alunta_mapping_id","is_active","is_archived");--> statement-breakpoint
CREATE INDEX "prepaid_packages_user_id_idx" ON "prepaid_packages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prepaid_packages_client_id_idx" ON "prepaid_packages" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "prepaid_packages_org_id_idx" ON "prepaid_packages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "prepaid_packages_org_active_idx" ON "prepaid_packages" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "prepaid_renewal_requests_package_idx" ON "prepaid_renewal_requests" USING btree ("prepaid_package_id");--> statement-breakpoint
CREATE INDEX "prepaid_renewal_requests_freelancer_idx" ON "prepaid_renewal_requests" USING btree ("freelancer_id","status");--> statement-breakpoint
CREATE INDEX "prepaid_usage_package_id_idx" ON "prepaid_usage" USING btree ("prepaid_package_id");--> statement-breakpoint
CREATE INDEX "prepaid_usage_time_entry_id_idx" ON "prepaid_usage" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX "product_events_event_idx" ON "product_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "product_events_user_idx" ON "product_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "project_activity_types_activity_idx" ON "project_activity_types" USING btree ("activity_type_id");--> statement-breakpoint
CREATE INDEX "project_assignments_user_org_idx" ON "project_assignments" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budget_alerts_project_month_idx" ON "project_budget_alerts" USING btree ("project_id","month");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_org_id_idx" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projects_client_id_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "rate_history_user_id_idx" ON "rate_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_history_client_id_idx" ON "rate_history" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "rate_history_project_id_idx" ON "rate_history" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_invoice_runs_period_unique" ON "recurring_invoice_runs" USING btree ("recurring_invoice_id","period_start");--> statement-breakpoint
CREATE INDEX "recurring_invoices_org_idx" ON "recurring_invoices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recurring_invoices_user_idx" ON "recurring_invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_invoices_client_idx" ON "recurring_invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "recurring_invoices_due_idx" ON "recurring_invoices" USING btree ("next_run_date") WHERE is_paused = false AND is_archived = false;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_invoices_prepaid_unique" ON "recurring_invoices" USING btree ("prepaid_package_id") WHERE prepaid_package_id IS NOT NULL AND is_archived = false;--> statement-breakpoint
CREATE UNIQUE INDEX "rtc_template_client_idx" ON "recurring_template_clients" USING btree ("template_id","client_id");--> statement-breakpoint
CREATE INDEX "recurring_time_templates_user_id_idx" ON "recurring_time_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_time_templates_client_id_idx" ON "recurring_time_templates" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "recurring_time_templates_project_id_idx" ON "recurring_time_templates" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "recurring_time_templates_next_due_idx" ON "recurring_time_templates" USING btree ("next_due") WHERE "is_active" = true;--> statement-breakpoint
CREATE INDEX "recurring_time_templates_org_id_idx" ON "recurring_time_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "report_schedules_user_id_idx" ON "report_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_schedules_active_idx" ON "report_schedules" USING btree ("is_active","frequency");--> statement-breakpoint
CREATE UNIQUE INDEX "report_shares_token_hash_unique" ON "report_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "report_shares_user_id_idx" ON "report_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_templates_user_id_idx" ON "report_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_templates_user_client_idx" ON "report_templates" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_templates_user_name_unique" ON "report_templates" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "report_templates_org_type_idx" ON "report_templates" USING btree ("organization_id","report_type");--> statement-breakpoint
CREATE UNIQUE INDEX "report_templates_org_shared_name_unique" ON "report_templates" USING btree ("organization_id","name") WHERE "report_templates"."user_id" IS NULL;--> statement-breakpoint
CREATE INDEX "report_templates_org_id_idx" ON "report_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_plan_entries_cell_unique" ON "resource_plan_entries" USING btree ("organization_id","user_id","project_id","week_start") WHERE activity_type_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_plan_entries_activity_cell_unique" ON "resource_plan_entries" USING btree ("organization_id","user_id","project_id","activity_type_id","week_start") WHERE activity_type_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "resource_plan_entries_org_week_idx" ON "resource_plan_entries" USING btree ("organization_id","week_start");--> statement-breakpoint
CREATE INDEX "resource_plan_entries_project_idx" ON "resource_plan_entries" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_perms_org_role_module_idx" ON "role_permissions" USING btree ("organization_id","role_name","module_key");--> statement-breakpoint
CREATE INDEX "scheduled_rate_changes_client_id_idx" ON "scheduled_rate_changes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "scheduled_rate_changes_project_id_idx" ON "scheduled_rate_changes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scheduled_rate_changes_pending_idx" ON "scheduled_rate_changes" USING btree ("effective_date","applied_at");--> statement-breakpoint
CREATE INDEX "sent_emails_user_id_idx" ON "sent_emails" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sent_emails_org_id_idx" ON "sent_emails" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sent_emails_email_type_idx" ON "sent_emails" USING btree ("email_type");--> statement-breakpoint
CREATE INDEX "sent_emails_invoice_id_idx" ON "sent_emails" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sent_emails_recipient_email_idx" ON "sent_emails" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "sent_emails_resend_email_id_idx" ON "sent_emails" USING btree ("resend_email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stability_findings_open_fingerprint_uq" ON "stability_findings" USING btree ("fingerprint") WHERE "stability_findings"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "stability_findings_status_idx" ON "stability_findings" USING btree ("status","last_seen");--> statement-breakpoint
CREATE INDEX "stability_findings_detector_first_seen_idx" ON "stability_findings" USING btree ("detector","first_seen");--> statement-breakpoint
CREATE UNIQUE INDEX "store_billing_events_provider_event_idx" ON "store_billing_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_store_original_tx_idx" ON "subscriptions" USING btree ("store_original_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_store_purchase_token_idx" ON "subscriptions" USING btree ("store_purchase_token");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_id_idx" ON "support_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_messages_message_id_idx" ON "support_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "support_tickets_inbox_id_idx" ON "support_tickets" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_idx" ON "tags" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "tags_org_id_idx" ON "tags" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "task_attachments_task_id_idx" ON "task_attachments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_attachments_user_id_idx" ON "task_attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_id_idx" ON "task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_comments_user_id_idx" ON "task_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_statuses_scope_idx" ON "task_statuses" USING btree ("user_id","scope","project_id");--> statement-breakpoint
CREATE INDEX "task_statuses_org_scope_idx" ON "task_statuses" USING btree ("organization_id","scope","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_statuses_org_scope_name_idx" ON "task_statuses" USING btree ("organization_id","scope",COALESCE("project_id", '00000000-0000-0000-0000-000000000000'),"name");--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_org_id_idx" ON "tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tasks_project_id_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_client_id_idx" ON "tasks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_user_id_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_org_status_idx" ON "tasks" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "tasks_assigned_to_idx" ON "tasks" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "time_approval_requests_org_id_idx" ON "time_approval_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "time_entries_client_id_idx" ON "time_entries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "time_entries_project_id_idx" ON "time_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "time_entries_task_id_idx" ON "time_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "time_entries_user_id_date_idx" ON "time_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "time_entries_org_id_idx" ON "time_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "time_entries_org_date_idx" ON "time_entries" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_client_entry_id_uq" ON "time_entries" USING btree ("client_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_timer_session_id_uq" ON "time_entries" USING btree ("timer_session_id") WHERE "time_entries"."timer_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "time_entries_org_activity_idx" ON "time_entries" USING btree ("organization_id","activity_type_id");--> statement-breakpoint
CREATE INDEX "time_entries_created_at_idx" ON "time_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "time_entries_user_invoice_idx" ON "time_entries" USING btree ("user_id","invoice_id");--> statement-breakpoint
CREATE INDEX "time_entries_user_billed_idx" ON "time_entries" USING btree ("user_id","is_billed");--> statement-breakpoint
CREATE INDEX "time_entries_user_created_idx" ON "time_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "time_entries_org_user_date_idx" ON "time_entries" USING btree ("organization_id","user_id","date");--> statement-breakpoint
CREATE INDEX "timer_events_user_created_idx" ON "timer_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "timer_events_created_idx" ON "timer_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timer_sessions_user_active_uq" ON "timer_sessions" USING btree ("user_id") WHERE "timer_sessions"."status" IN ('running', 'paused', 'stopping');--> statement-breakpoint
CREATE INDEX "timer_sessions_user_created_idx" ON "timer_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timer_sessions_user_start_op_uq" ON "timer_sessions" USING btree ("user_id","start_op_id") WHERE "timer_sessions"."start_op_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "timer_templates_user_id_idx" ON "timer_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "timer_templates_org_id_idx" ON "timer_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timesheet_templates_user_org_idx" ON "timesheet_templates" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "timesheet_week_events_org_user_week_idx" ON "timesheet_week_events" USING btree ("organization_id","user_id","week_start");--> statement-breakpoint
CREATE INDEX "timesheet_weeks_org_status_idx" ON "timesheet_weeks" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_notification_preferences_org_user_idx" ON "user_notification_preferences" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_balances_user_org_period_idx" ON "vacation_balances" USING btree ("user_id","organization_id","period_start");--> statement-breakpoint
CREATE INDEX "vacation_ledger_org_user_period_idx" ON "vacation_ledger" USING btree ("organization_id","user_id","vacation_year_start");--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_ledger_system_ref_idx" ON "vacation_ledger" USING btree ("organization_id","user_id","pool","entry_type","ref_type","ref_id","vacation_year_start") WHERE "vacation_ledger"."ref_type" IN ('cron', 'rollover', 'period_open', 'migration');--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_created_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "week_closures_user_week_idx" ON "week_closures" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "work_plan_assignments_org_user_idx" ON "work_plan_assignments" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "work_plan_assignments_org_department_idx" ON "work_plan_assignments" USING btree ("organization_id","department_id");--> statement-breakpoint
CREATE INDEX "work_plans_org_idx" ON "work_plans" USING btree ("organization_id");
