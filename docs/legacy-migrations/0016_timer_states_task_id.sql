-- Add taskId column to timer_states for linking timers to tasks
ALTER TABLE timer_states ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_timer_states_task_id ON timer_states(task_id);
