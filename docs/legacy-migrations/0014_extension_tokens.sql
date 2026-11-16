-- Extension tokens for browser extension authentication
CREATE TABLE IF NOT EXISTS "extension_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token" VARCHAR(64) NOT NULL UNIQUE,
  "name" VARCHAR(100) NOT NULL,
  "last_used_at" TIMESTAMP,
  "last_used_ip" VARCHAR(45),
  "usage_count" INTEGER DEFAULT 0,
  "expires_at" TIMESTAMP,
  "is_revoked" BOOLEAN DEFAULT FALSE,
  "revoked_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Timer states for syncing between web app and extension
CREATE TABLE IF NOT EXISTS "timer_states" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
  "is_running" BOOLEAN DEFAULT FALSE,
  "start_time" TIMESTAMP,
  "elapsed_seconds" INTEGER DEFAULT 0,
  "base_seconds" INTEGER DEFAULT 0,
  "project_id" UUID REFERENCES "projects"("id") ON DELETE SET NULL,
  "client_id" UUID REFERENCES "clients"("id") ON DELETE SET NULL,
  "description" TEXT DEFAULT '',
  "last_synced_at" TIMESTAMP,
  "last_synced_from" VARCHAR(20),
  "is_idle" BOOLEAN DEFAULT FALSE,
  "idle_detected_at" TIMESTAMP,
  "last_activity_at" TIMESTAMP,
  "idle_threshold_minutes" INTEGER DEFAULT 5,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS "extension_tokens_user_id_idx" ON "extension_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "extension_tokens_token_idx" ON "extension_tokens"("token");
CREATE INDEX IF NOT EXISTS "timer_states_user_id_idx" ON "timer_states"("user_id");
