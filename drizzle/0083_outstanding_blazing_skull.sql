CREATE TABLE "overtime_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar(20) NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"week_start" date,
	"absence_request_id" uuid,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absence_types" ADD COLUMN "deducts_overtime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "overtime_threshold_hours" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD CONSTRAINT "overtime_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD CONSTRAINT "overtime_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD CONSTRAINT "overtime_ledger_absence_request_id_absence_requests_id_fk" FOREIGN KEY ("absence_request_id") REFERENCES "public"."absence_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD CONSTRAINT "overtime_ledger_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "overtime_ledger_user_org_idx" ON "overtime_ledger" USING btree ("user_id","organization_id");