-- Migration: Fix passkey table schema for Better-Auth compatibility
-- Better-Auth expects table name "passkey" (singular) with camelCase column names

-- Step 1: Rename table from "passkeys" to "passkey"
ALTER TABLE IF EXISTS "passkeys" RENAME TO "passkey";

--> statement-breakpoint

-- Step 2: Rename columns from snake_case to camelCase
ALTER TABLE "passkey" RENAME COLUMN "public_key" TO "publicKey";

--> statement-breakpoint

ALTER TABLE "passkey" RENAME COLUMN "user_id" TO "userId";

--> statement-breakpoint

ALTER TABLE "passkey" RENAME COLUMN "credential_id" TO "credentialID";

--> statement-breakpoint

ALTER TABLE "passkey" RENAME COLUMN "device_type" TO "deviceType";

--> statement-breakpoint

ALTER TABLE "passkey" RENAME COLUMN "backed_up" TO "backedUp";

--> statement-breakpoint

ALTER TABLE "passkey" RENAME COLUMN "created_at" TO "createdAt";

--> statement-breakpoint

-- Step 3: Update the unique constraint name if needed
ALTER TABLE "passkey" DROP CONSTRAINT IF EXISTS "passkeys_credential_id_unique";

--> statement-breakpoint

ALTER TABLE "passkey" ADD CONSTRAINT "passkey_credentialID_unique" UNIQUE ("credentialID");
