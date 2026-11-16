-- Stability constraints migration
-- Adds CHECK constraints and indexes for data integrity

-- CHECK constraint: remaining_hours cannot go negative
ALTER TABLE "prepaid_packages" ADD CONSTRAINT "prepaid_packages_remaining_hours_non_negative"
  CHECK ("remaining_hours" >= 0);

-- CHECK constraint: used_hours cannot exceed total_hours
ALTER TABLE "prepaid_packages" ADD CONSTRAINT "prepaid_packages_used_hours_lte_total"
  CHECK ("used_hours" <= "total_hours");

-- FK constraint: tasks.parent_task_id references tasks.id
-- (only if not already present — the schema change handles new deploys,
--  this handles existing databases)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_parent_task_id_tasks_id_fk'
    AND table_name = 'tasks'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk"
      FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes on time_entries FK columns (if not already present)
CREATE INDEX IF NOT EXISTS "time_entries_client_id_idx" ON "time_entries" ("client_id");
CREATE INDEX IF NOT EXISTS "time_entries_project_id_idx" ON "time_entries" ("project_id");
CREATE INDEX IF NOT EXISTS "time_entries_task_id_idx" ON "time_entries" ("task_id");
CREATE INDEX IF NOT EXISTS "time_entries_user_id_date_idx" ON "time_entries" ("user_id", "date");
