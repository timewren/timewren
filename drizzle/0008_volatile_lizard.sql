CREATE TABLE "email_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"weekly_report" boolean DEFAULT true,
	"monthly_report" boolean DEFAULT true,
	"unbilled_reminder" boolean DEFAULT true,
	"password_changed" boolean DEFAULT true,
	"new_login_alert" boolean DEFAULT true,
	"email_changed" boolean DEFAULT true,
	"onboarding_milestones" boolean DEFAULT true,
	"inactivity_reminder" boolean DEFAULT true,
	"tips_and_tricks" boolean DEFAULT false,
	"client_invoices" boolean DEFAULT true,
	"client_prepaid_alerts" boolean DEFAULT false,
	"client_project_updates" boolean DEFAULT false,
	"weekly_report_day" varchar(20) DEFAULT 'monday',
	"weekly_report_time" varchar(10) DEFAULT '08:00',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;