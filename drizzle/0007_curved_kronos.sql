CREATE TABLE "timer_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
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
ALTER TABLE "prepaid_packages" ADD COLUMN "low_balance_alert_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "prepaid_packages" ADD COLUMN "expiry_alert_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "prepaid_alert_recipient" varchar(20) DEFAULT 'owner';--> statement-breakpoint
ALTER TABLE "timer_templates" ADD CONSTRAINT "timer_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_templates" ADD CONSTRAINT "timer_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_templates" ADD CONSTRAINT "timer_templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;