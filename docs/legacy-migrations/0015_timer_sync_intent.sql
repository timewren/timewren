-- Timer Sync Intent-Based Synchronization
-- Adds version control and intent tracking for reliable timer sync between webapp and extension

-- Add version column for optimistic locking
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;

-- Add intent tracking columns
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent" varchar(20);
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent_at" timestamp;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent_from" varchar(20);

-- Create index for cleanup queries
CREATE INDEX IF NOT EXISTS "timer_states_intent_idx" ON "timer_states" ("intent", "intent_at") WHERE "intent" IS NOT NULL;
