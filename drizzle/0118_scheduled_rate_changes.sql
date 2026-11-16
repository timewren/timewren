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
ALTER TABLE "scheduled_rate_changes" ADD CONSTRAINT "scheduled_rate_changes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_rate_changes" ADD CONSTRAINT "scheduled_rate_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_rate_changes" ADD CONSTRAINT "scheduled_rate_changes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_rate_changes" ADD CONSTRAINT "scheduled_rate_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_rate_changes_client_id_idx" ON "scheduled_rate_changes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "scheduled_rate_changes_project_id_idx" ON "scheduled_rate_changes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scheduled_rate_changes_pending_idx" ON "scheduled_rate_changes" USING btree ("effective_date","applied_at");