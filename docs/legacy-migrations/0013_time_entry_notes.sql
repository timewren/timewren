-- Migration: Add notes column to time_entries for detailed descriptions
-- Allows users to add longer detailed notes separate from the short description

ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "notes" TEXT;

COMMENT ON COLUMN "time_entries"."notes" IS 'Detailed notes/description for longer explanations beyond the short description';
