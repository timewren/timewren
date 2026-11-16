-- Migration: Fix Better-Auth schema for full compatibility
-- Better-Auth expects singular table names and camelCase column names
-- This migration renames tables and columns to match Better-Auth expectations

-- =============================================
-- STEP 1: Rename tables to singular form
-- =============================================

-- Rename users -> user
ALTER TABLE IF EXISTS "users" RENAME TO "user";

--> statement-breakpoint

-- Rename accounts -> account
ALTER TABLE IF EXISTS "accounts" RENAME TO "account";

--> statement-breakpoint

-- Rename sessions -> session
ALTER TABLE IF EXISTS "sessions" RENAME TO "session";

--> statement-breakpoint

-- Rename verifications -> verification
ALTER TABLE IF EXISTS "verifications" RENAME TO "verification";

--> statement-breakpoint

-- Rename two_factors -> twoFactor
ALTER TABLE IF EXISTS "two_factors" RENAME TO "twoFactor";

--> statement-breakpoint

-- =============================================
-- STEP 2: Rename user table columns to camelCase
-- =============================================

ALTER TABLE "user" RENAME COLUMN "email_verified" TO "emailVerified";
ALTER TABLE "user" RENAME COLUMN "phone_number" TO "phoneNumber";
ALTER TABLE "user" RENAME COLUMN "phone_number_verified" TO "phoneNumberVerified";
ALTER TABLE "user" RENAME COLUMN "two_factor_enabled" TO "twoFactorEnabled";
ALTER TABLE "user" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "user" RENAME COLUMN "updated_at" TO "updatedAt";

--> statement-breakpoint

-- =============================================
-- STEP 3: Rename account table columns to camelCase
-- =============================================

ALTER TABLE "account" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE "account" RENAME COLUMN "account_id" TO "accountId";
ALTER TABLE "account" RENAME COLUMN "provider_id" TO "providerId";
ALTER TABLE "account" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "account" RENAME COLUMN "updated_at" TO "updatedAt";

--> statement-breakpoint

-- Add OAuth token columns to account table
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "accessToken" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "refreshToken" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt" timestamp;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" timestamp;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "scope" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "idToken" text;

--> statement-breakpoint

-- =============================================
-- STEP 4: Rename session table columns to camelCase
-- =============================================

ALTER TABLE "session" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE "session" RENAME COLUMN "expires_at" TO "expiresAt";
ALTER TABLE "session" RENAME COLUMN "ip_address" TO "ipAddress";
ALTER TABLE "session" RENAME COLUMN "user_agent" TO "userAgent";
ALTER TABLE "session" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "session" RENAME COLUMN "updated_at" TO "updatedAt";

--> statement-breakpoint

-- =============================================
-- STEP 5: Rename verification table columns to camelCase
-- =============================================

ALTER TABLE "verification" RENAME COLUMN "expires_at" TO "expiresAt";
ALTER TABLE "verification" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "verification" RENAME COLUMN "updated_at" TO "updatedAt";

--> statement-breakpoint

-- =============================================
-- STEP 6: Rename twoFactor table columns to camelCase
-- =============================================

ALTER TABLE "twoFactor" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE "twoFactor" RENAME COLUMN "backup_codes" TO "backupCodes";
ALTER TABLE "twoFactor" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "twoFactor" RENAME COLUMN "updated_at" TO "updatedAt";

--> statement-breakpoint

-- =============================================
-- STEP 7: Update foreign key constraints
-- =============================================

-- Drop old constraints and create new ones with correct table references
-- Note: These might fail if constraints don't exist, that's OK

-- account table foreign key
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "accounts_user_id_users_id_fk";
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

--> statement-breakpoint

-- session table foreign key
ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "sessions_user_id_users_id_fk";
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

--> statement-breakpoint

-- twoFactor table foreign key
ALTER TABLE "twoFactor" DROP CONSTRAINT IF EXISTS "two_factors_user_id_users_id_fk";
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

--> statement-breakpoint

-- passkey table foreign key (if not already updated)
ALTER TABLE "passkey" DROP CONSTRAINT IF EXISTS "passkeys_user_id_users_id_fk";
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

--> statement-breakpoint

-- =============================================
-- STEP 8: Create indexes for performance
-- =============================================

CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "session_token_idx" ON "session" ("token");
CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor" ("userId");
