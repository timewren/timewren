CREATE TABLE IF NOT EXISTS "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"report_template_id" uuid NOT NULL,
	"frequency" varchar(10) NOT NULL,
	"send_day" integer DEFAULT 1 NOT NULL,
	"recipients" jsonb NOT NULL,
	"format" varchar(10) DEFAULT 'pdf' NOT NULL,
	"subject" varchar(200),
	"message" text,
	"restrict_to_own_entries" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_schedules_user_id_user_id_fk') THEN
    ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_schedules_organization_id_organizations_id_fk') THEN
    ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_schedules_report_template_id_report_templates_id_fk') THEN
    ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_report_template_id_report_templates_id_fk" FOREIGN KEY ("report_template_id") REFERENCES "public"."report_templates"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_user_id_idx" ON "report_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_active_idx" ON "report_schedules" USING btree ("is_active","frequency");