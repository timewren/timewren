CREATE TABLE IF NOT EXISTS "org_period_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"locked_before" timestamp,
	"locked_by_user_id" text NOT NULL,
	"note" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_period_locks_organization_id_organizations_id_fk') THEN
    ALTER TABLE "org_period_locks" ADD CONSTRAINT "org_period_locks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_period_locks_locked_by_user_id_user_id_fk') THEN
    ALTER TABLE "org_period_locks" ADD CONSTRAINT "org_period_locks_locked_by_user_id_user_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_period_locks_org_idx" ON "org_period_locks" USING btree ("organization_id","created_at");