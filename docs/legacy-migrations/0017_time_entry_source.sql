-- Add source column to time_entries to track where entries came from
-- Values: manual, timer, auto_track, recurring, import, api
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';

-- Add index for filtering by source
CREATE INDEX IF NOT EXISTS idx_time_entries_source ON time_entries(source);
