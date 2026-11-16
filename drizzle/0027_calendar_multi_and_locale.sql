ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "calendar_color" VARCHAR(7);
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "parent_connection_id" UUID;
ALTER TABLE "calendar_matching_rules" ADD COLUMN IF NOT EXISTS "source" VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "locale" VARCHAR(10) DEFAULT 'da';
