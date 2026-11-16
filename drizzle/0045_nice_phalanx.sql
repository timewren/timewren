CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"checked_in_at" timestamp NOT NULL,
	"checked_out_at" timestamp,
	"time_entry_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_license" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_ins_user_org_idx" ON "check_ins" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "check_ins_user_open_idx" ON "check_ins" USING btree ("user_id","checked_out_at");