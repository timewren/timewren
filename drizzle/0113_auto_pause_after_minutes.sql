-- Hård auto-pause efter lang stilstand (kunde A runde 6, #588). NULL = fra.
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "auto_pause_after_minutes" integer DEFAULT 120;
