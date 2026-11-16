-- #198: gentagne fakturaer/retainere. Rent additiv: to nye tabeller, intet
-- eksisterende ændres. recurring_invoice_runs er idempotens-nøglen
-- (skabelon + periodestart), så samme periode aldrig giver to kladder.
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
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_recurring_invoice_id_recurring_invoices_id_fk" FOREIGN KEY ("recurring_invoice_id") REFERENCES "public"."recurring_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_invoice_template_id_invoice_templates_id_fk" FOREIGN KEY ("invoice_template_id") REFERENCES "public"."invoice_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_invoice_runs_period_unique" ON "recurring_invoice_runs" USING btree ("recurring_invoice_id","period_start");--> statement-breakpoint
CREATE INDEX "recurring_invoices_org_idx" ON "recurring_invoices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recurring_invoices_user_idx" ON "recurring_invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_invoices_client_idx" ON "recurring_invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "recurring_invoices_due_idx" ON "recurring_invoices" USING btree ("next_run_date") WHERE is_paused = false AND is_archived = false;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_invoices_prepaid_unique" ON "recurring_invoices" USING btree ("prepaid_package_id") WHERE prepaid_package_id IS NOT NULL AND is_archived = false;
