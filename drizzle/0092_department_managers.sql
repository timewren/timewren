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
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_managers_org_dept_user_idx" ON "department_managers" USING btree ("organization_id","department_id","user_id");--> statement-breakpoint
CREATE INDEX "department_managers_org_user_idx" ON "department_managers" USING btree ("organization_id","user_id");