CREATE TABLE IF NOT EXISTS "churn_playbook_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"playbook_key" varchar(50) NOT NULL,
	"risk_score" integer NOT NULL,
	"reasons" jsonb,
	"triggered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'churn_playbook_runs_user_id_user_id_fk') THEN
    ALTER TABLE "churn_playbook_runs" ADD CONSTRAINT "churn_playbook_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "churn_playbook_runs_user_idx" ON "churn_playbook_runs" USING btree ("user_id","playbook_key","triggered_at");