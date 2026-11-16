-- Add end-of-day notification fields
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "end_of_day_enabled" boolean DEFAULT false;
ALTER TABLE "email_preferences" ADD COLUMN IF NOT EXISTS "end_of_day_time" varchar(10) DEFAULT '17:00';
ALTER TABLE "notification_channels" ADD COLUMN IF NOT EXISTS "send_end_of_day" boolean DEFAULT false;
