CREATE TABLE IF NOT EXISTS "week_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"week_start" timestamp NOT NULL,
	"closed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'week_closures_user_id_user_id_fk') THEN
    ALTER TABLE "week_closures" ADD CONSTRAINT "week_closures_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "week_closures_user_week_idx" ON "week_closures" USING btree ("user_id","week_start");