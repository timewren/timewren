CREATE TABLE "client_portal_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"freelancer_id" text NOT NULL,
	"access_type" varchar(20) DEFAULT 'token' NOT NULL,
	"access_token" varchar(255),
	"token_expires_at" timestamp,
	"email" varchar(255),
	"password_hash" varchar(255),
	"email_verified" boolean DEFAULT false,
	"email_verification_token" varchar(255),
	"password_reset_token" varchar(255),
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
	CONSTRAINT "client_portal_access_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
CREATE TABLE "client_portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_access_id" uuid NOT NULL,
	"session_token" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
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
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_freelancer_id_users_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_sessions" ADD CONSTRAINT "client_portal_sessions_portal_access_id_client_portal_access_id_fk" FOREIGN KEY ("portal_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_activity_logs" ADD CONSTRAINT "portal_activity_logs_portal_access_id_client_portal_access_id_fk" FOREIGN KEY ("portal_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_activity_logs" ADD CONSTRAINT "portal_activity_logs_freelancer_id_users_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_branding" ADD CONSTRAINT "portal_branding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;