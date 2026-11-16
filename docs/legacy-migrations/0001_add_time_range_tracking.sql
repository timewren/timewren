-- Migration: Add time range tracking to time_entries
-- Created: 2026-01-11
-- Description: Adds startTime and endTime columns to track when work actually happened

-- Add startTime column (nullable for backwards compatibility)
ALTER TABLE time_entries
ADD COLUMN IF NOT EXISTS start_time TIMESTAMP;

-- Add endTime column (nullable for backwards compatibility)
ALTER TABLE time_entries
ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;

-- Add comment for documentation
COMMENT ON COLUMN time_entries.start_time IS 'When the work session started (nullable for legacy entries)';
COMMENT ON COLUMN time_entries.end_time IS 'When the work session ended (nullable for legacy entries)';

-- Optional: Create index for time range queries (uncomment if needed)
-- CREATE INDEX IF NOT EXISTS idx_time_entries_time_range ON time_entries (start_time, end_time) WHERE start_time IS NOT NULL;
