-- HOTFIX: Migration 0026 used singular table names ("client", "project") that
-- don't exist in the actual schema. The real tables are "clients" and "projects".
-- This migration adds the rounding columns to the correct tables.
-- The bad ALTERs in 0026 were no-ops (IF NOT EXISTS on non-existent tables).
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_enabled" BOOLEAN;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_minutes" INTEGER;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rounding_method" VARCHAR(10);

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_enabled" BOOLEAN;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_minutes" INTEGER;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "rounding_method" VARCHAR(10);
