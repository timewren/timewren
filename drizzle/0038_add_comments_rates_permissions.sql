CREATE TABLE IF NOT EXISTS "task_comments" (
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
CREATE TABLE IF NOT EXISTS "member_rates" (
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
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"role_name" varchar(50) NOT NULL,
	"module_key" varchar(50) NOT NULL,
	"access_level" varchar(10) DEFAULT 'write' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_client_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"access_level" varchar(10) DEFAULT 'manage' NOT NULL,
	"granted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_attachments" ALTER COLUMN "content" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "task_attachments" ADD COLUMN IF NOT EXISTS "storage_url" text;
--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_rates" ADD CONSTRAINT "member_rates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_client_access" ADD CONSTRAINT "member_client_access_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_task_id_idx" ON "task_comments" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_user_id_idx" ON "task_comments" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_rates_lookup_idx" ON "member_rates" USING btree ("organization_id","member_id","project_id","client_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_perms_org_role_module_idx" ON "role_permissions" USING btree ("organization_id","role_name","module_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mca_org_member_client_idx" ON "member_client_access" USING btree ("organization_id","member_id","client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mca_member_idx" ON "member_client_access" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mca_client_idx" ON "member_client_access" USING btree ("client_id");
