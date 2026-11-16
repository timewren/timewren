CREATE TABLE "ai_processing_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
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
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_account_id" varchar(255),
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_expiry" timestamp,
	"calendar_id" varchar(255) DEFAULT 'primary',
	"calendar_name" varchar(255),
	"sync_enabled" boolean DEFAULT true,
	"sync_direction" varchar(20) DEFAULT 'both',
	"last_synced" timestamp,
	"sync_error" text,
	"webhook_channel_id" varchar(255),
	"webhook_expiry" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
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
	"is_cancelled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"channel_type" varchar(20) NOT NULL,
	"discord_webhook_url" text,
	"discord_webhook_name" varchar(100),
	"push_subscription" jsonb,
	"sms_phone_number" varchar(20),
	"is_enabled" boolean DEFAULT true,
	"send_daily_digest" boolean DEFAULT true,
	"send_deadline_reminders" boolean DEFAULT true,
	"send_overdue_alerts" boolean DEFAULT true,
	"send_weekly_review" boolean DEFAULT false,
	"send_ai_suggestions" boolean DEFAULT false,
	"last_tested_at" timestamp,
	"last_test_status" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'backlog';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "position" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "estimated_minutes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "actual_minutes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_type" varchar(20) DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_id" varchar(255);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_suggested_project" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_suggested_client" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_suggested_priority" varchar(20);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_suggested_deadline" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_confidence" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_processed_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "calendar_event_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "active_time_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "inbound_email_id" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_autonomy_level" varchar(20) DEFAULT 'auto_all';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_email_processing" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "working_hours_start" varchar(5) DEFAULT '09:00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "working_hours_end" varchar(5) DEFAULT '17:00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "working_days" text[] DEFAULT '{"1","2","3","4","5"}';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" varchar(50) DEFAULT 'Europe/Copenhagen';--> statement-breakpoint
ALTER TABLE "ai_processing_logs" ADD CONSTRAINT "ai_processing_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_connection_id_calendar_connections_id_fk" FOREIGN KEY ("calendar_connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_linked_task_id_tasks_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ai_suggested_project_projects_id_fk" FOREIGN KEY ("ai_suggested_project") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ai_suggested_client_clients_id_fk" FOREIGN KEY ("ai_suggested_client") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_inbound_email_id_unique" UNIQUE("inbound_email_id");