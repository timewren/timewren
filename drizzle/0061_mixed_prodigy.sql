CREATE TABLE IF NOT EXISTS "report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"name" varchar(120) NOT NULL,
	"config" jsonb NOT NULL,
	"restrict_to_own_entries" boolean DEFAULT false NOT NULL,
	"locked_dates" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_shares_user_id_user_id_fk') THEN
    ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_shares_organization_id_organizations_id_fk') THEN
    ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_shares_token_unique" ON "report_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_shares_user_id_idx" ON "report_shares" USING btree ("user_id");