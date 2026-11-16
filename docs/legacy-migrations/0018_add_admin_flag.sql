-- Add is_admin column to user table for admin access control
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false;

-- Create index for quick admin lookups
CREATE INDEX IF NOT EXISTS "user_is_admin_idx" ON "user" ("is_admin") WHERE "is_admin" = true;
