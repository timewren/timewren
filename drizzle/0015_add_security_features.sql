-- Migration: Add security features (2FA, trusted devices)
-- Run this migration after 0014_open_fantastic_four.sql

-- Add two_factor_enabled column to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;

--> statement-breakpoint

-- Create two_factors table for TOTP secrets
CREATE TABLE IF NOT EXISTS "two_factors" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Create trusted_devices table for 2FA skip on trusted devices
CREATE TABLE IF NOT EXISTS "trusted_devices" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_token" text NOT NULL UNIQUE,
  "user_agent" text,
  "ip_address" varchar(45),
  "last_used" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "two_factors_user_id_idx" ON "two_factors" ("user_id");
CREATE INDEX IF NOT EXISTS "trusted_devices_user_id_idx" ON "trusted_devices" ("user_id");
CREATE INDEX IF NOT EXISTS "trusted_devices_expires_at_idx" ON "trusted_devices" ("expires_at");

--> statement-breakpoint

-- Add aaguid column to passkeys table (required by Better-Auth passkey plugin)
ALTER TABLE "passkeys" ADD COLUMN IF NOT EXISTS "aaguid" text;
