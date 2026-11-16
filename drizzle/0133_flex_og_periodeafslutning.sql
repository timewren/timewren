-- #507 normperiode og flexsaldo + #518 periodeafslutning. Rent additiv: en ny
-- tabel og nye nullable/default-kolonner på organizations. Standardværdierne
-- (ugenorm, ingen periodeafslutning, ingen auto-lås) giver uændret adfærd.
CREATE TABLE "period_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period_type" varchar(10) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"summary" jsonb,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"acknowledged_at" timestamp,
	"unlocked_by" text,
	"unlocked_at" timestamp,
	"unlock_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "period_closings_org_user_period_unique" UNIQUE("organization_id","user_id","period_start")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "flex_norm_period" varchar(10) DEFAULT 'week' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "flex_norm_year_start" varchar(10) DEFAULT 'calendar' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "flex_norm_annual_hours" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "flex_carryover_max_hours" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "flex_carryover_max_deficit_hours" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "flex_norm_start_date" date;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "period_closing_interval" varchar(10);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "timesheet_auto_lock_weekday" integer;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closings" ADD CONSTRAINT "period_closings_unlocked_by_user_id_fk" FOREIGN KEY ("unlocked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_closings_org_period_idx" ON "period_closings" USING btree ("organization_id","period_start");