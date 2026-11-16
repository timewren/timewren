-- Migration: Make email_threads.task_id nullable
-- Allows storing non-actionable email records without creating a task

ALTER TABLE "email_threads" ALTER COLUMN "task_id" DROP NOT NULL;
