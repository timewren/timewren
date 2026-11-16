-- Samlet timebudget pr. projekt (kunde A runde 4, punkt 8). Idempotent.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "budget_hours" numeric(7, 2);
