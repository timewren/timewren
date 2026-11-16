-- Migration: Add time_entry_segments table for multiple work periods per entry
-- Allows tracking like "9:00-11:30 + 14:00-16:00" on the same time entry

CREATE TABLE IF NOT EXISTS time_entry_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  duration_minutes INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for efficient lookups by time entry
CREATE INDEX IF NOT EXISTS idx_time_entry_segments_entry_id ON time_entry_segments(time_entry_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_time_entry_segments_start_time ON time_entry_segments(start_time);

COMMENT ON TABLE time_entry_segments IS 'Stores individual work periods within a time entry, allowing for broken work sessions';
COMMENT ON COLUMN time_entry_segments.duration_minutes IS 'Calculated duration in minutes (end_time - start_time)';
