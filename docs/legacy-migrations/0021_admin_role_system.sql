-- Migration: 0021_admin_role_system.sql
-- Replaces isAdmin boolean with role varchar and adds flag system

-- Step 1: Add new role column
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" varchar(20) DEFAULT 'user';

-- Step 2: Migrate existing isAdmin values to role
UPDATE "user" SET "role" = 'admin' WHERE "is_admin" = true;
UPDATE "user" SET "role" = 'user' WHERE "is_admin" = false OR "is_admin" IS NULL;

-- Step 3: Drop the old isAdmin column
ALTER TABLE "user" DROP COLUMN IF EXISTS "is_admin";

-- Step 4: Add flag system columns
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_flagged" boolean DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "flagged_reason" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "flagged_at" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "flagged_by" text REFERENCES "user"(id) ON DELETE SET NULL;

-- Step 5: Create index for role lookups
CREATE INDEX IF NOT EXISTS "user_role_idx" ON "user"("role");
