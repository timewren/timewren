-- Migration: Add taskId column to time_entries for Time Blocking feature
-- This allows linking time entries to tasks for tracking estimated vs actual time

-- Add taskId column (nullable for backwards compatibility)
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- Create index for faster lookups of time entries by task
CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);
