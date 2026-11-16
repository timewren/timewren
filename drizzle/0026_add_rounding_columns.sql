-- Add rounding columns to user, clients and projects tables
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "rounding_enabled" BOOLEAN;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "rounding_minutes" INTEGER;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "rounding_method" VARCHAR(10);

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_enabled" BOOLEAN;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_minutes" INTEGER;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_method" VARCHAR(10);

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_enabled" BOOLEAN;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_minutes" INTEGER;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_method" VARCHAR(10);
