-- Add api_keys table for Public REST API authentication
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "key_hash" varchar(64) NOT NULL UNIQUE,
  "key_prefix" varchar(16) NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '["*"]',
  "last_used_at" timestamp,
  "last_used_ip" varchar(45),
  "expires_at" timestamp,
  "is_revoked" boolean NOT NULL DEFAULT false,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
