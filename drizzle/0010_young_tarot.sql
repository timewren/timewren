CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"entity_name" varchar(255),
	"changes" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
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
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"logo" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" varchar(50),
	"backed_up" boolean DEFAULT false,
	"transports" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billy_id" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "dinero_id" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "economic_customer_number" integer;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD COLUMN "monthly_report_day" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD COLUMN "unbilled_reminder_frequency" varchar(20) DEFAULT 'weekly';--> statement-breakpoint
ALTER TABLE "email_preferences" ADD COLUMN "inactivity_reminder_days" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD COLUMN "quiet_hours_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD COLUMN "quiet_hours_start" varchar(10) DEFAULT '22:00';--> statement-breakpoint
ALTER TABLE "email_preferences" ADD COLUMN "quiet_hours_end" varchar(10) DEFAULT '08:00';--> statement-breakpoint
ALTER TABLE "email_preferences" ADD COLUMN "digest_mode" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD COLUMN "digest_frequency" varchar(20) DEFAULT 'daily';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "billy_invoice_id" varchar(255);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "dinero_invoice_guid" varchar(255);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "economic_invoice_number" integer;--> statement-breakpoint
ALTER TABLE "recurring_time_templates" ADD COLUMN "is_paused" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "recurring_time_templates" ADD COLUMN "paused_until" timestamp;--> statement-breakpoint
ALTER TABLE "recurring_time_templates" ADD COLUMN "pause_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "economic_app_secret_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "economic_agreement_grant_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "billy_default_account_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dinero_default_account_number" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "economic_default_layout_number" integer;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_logs" ADD CONSTRAINT "integration_sync_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number");