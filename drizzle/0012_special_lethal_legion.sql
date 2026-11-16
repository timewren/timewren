CREATE TABLE "extension_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"last_used_at" timestamp,
	"last_used_ip" varchar(45),
	"usage_count" integer DEFAULT 0,
	"expires_at" timestamp,
	"is_revoked" boolean DEFAULT false,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "extension_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "timer_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"is_running" boolean DEFAULT false,
	"start_time" timestamp,
	"elapsed_seconds" integer DEFAULT 0,
	"base_seconds" integer DEFAULT 0,
	"project_id" uuid,
	"client_id" uuid,
	"description" text DEFAULT '',
	"last_synced_at" timestamp DEFAULT now(),
	"last_synced_from" varchar(20),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timer_states_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;