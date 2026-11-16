-- Migration: Add missing columns to timer_states table for browser extension sync
-- These columns were defined in schema but never migrated to production

-- Add version column for optimistic locking
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;

--> statement-breakpoint

-- Add intent tracking columns for stop synchronization
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent" varchar(20);
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent_at" timestamp;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "intent_from" varchar(20);

--> statement-breakpoint

-- Add task_id column for linking timers to tasks
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL;

--> statement-breakpoint

-- Add idle detection columns
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "is_idle" boolean DEFAULT false;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "idle_detected_at" timestamp;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "idle_threshold_minutes" integer DEFAULT 5;
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp;

--> statement-breakpoint

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "timer_states_intent_idx" ON "timer_states" ("intent", "intent_at") WHERE "intent" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "timer_states_task_id_idx" ON "timer_states" ("task_id");
CREATE INDEX IF NOT EXISTS "timer_states_idle_idx" ON "timer_states" ("is_idle") WHERE "is_idle" = true;
