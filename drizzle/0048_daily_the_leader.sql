-- Idempotent: `tasks.assigned_to_user_id` was added to the schema in #111 and
-- tracked in the meta snapshots, but its ALTER was never emitted as a numbered
-- migration (it reached dev via db:push). Guard every statement so this applies
-- cleanly whether or not the column / constraint / index already exists.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assigned_to_user_id" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assigned_to_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_org_user_idx" ON "members" USING btree ("organization_id","user_id");
