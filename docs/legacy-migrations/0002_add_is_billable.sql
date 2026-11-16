-- Migration: Add isBillable column to time_entries
-- Created: 2026-01-11
-- Description: Adds isBillable boolean column to distinguish billable from non-billable time entries

-- Add isBillable column (defaults to true for backwards compatibility)
ALTER TABLE time_entries
ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT TRUE;

-- Add comment for documentation
COMMENT ON COLUMN time_entries.is_billable IS 'Whether this time entry is billable. Defaults to true. Set to false for internal/admin time.';
