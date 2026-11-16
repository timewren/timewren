-- #526: fridagskalender (helligdage-forudindstilling + firmafridage) pr.
-- bruger, organisation eller afdeling. Rent additiv: ny tabel, intet
-- eksisterende ændres. Uden række bruges standarden (officielle helligdage).
CREATE TABLE "day_off_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"department_id" uuid,
	"user_id" text,
	"preset" varchar(20) DEFAULT 'private' NOT NULL,
	"optional_days" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "day_off_calendars_scope" CHECK ((user_id IS NOT NULL AND organization_id IS NULL AND department_id IS NULL) OR (user_id IS NULL AND organization_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "day_off_calendars" ADD CONSTRAINT "day_off_calendars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_off_calendars" ADD CONSTRAINT "day_off_calendars_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_off_calendars" ADD CONSTRAINT "day_off_calendars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_off_calendars" ADD CONSTRAINT "day_off_calendars_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_off_calendars_org_unique" ON "day_off_calendars" USING btree ("organization_id") WHERE department_id IS NULL AND user_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "day_off_calendars_department_unique" ON "day_off_calendars" USING btree ("department_id") WHERE department_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "day_off_calendars_user_unique" ON "day_off_calendars" USING btree ("user_id") WHERE user_id IS NOT NULL;