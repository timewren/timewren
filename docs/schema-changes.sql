-- Schema Changes for Webhooks & Calendar Sync
-- Generated: 2026-01-10
-- Run these migrations in order

-- ============================================
-- 1. Add Billy Organization ID to users table
-- ============================================
ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "billy_organization_id" VARCHAR(255);

-- ============================================
-- 2. Add Calendar Sync Backoff Fields
-- ============================================
ALTER TABLE "calendar_connections"
ADD COLUMN IF NOT EXISTS "consecutive_sync_failures" INTEGER DEFAULT 0;

ALTER TABLE "calendar_connections"
ADD COLUMN IF NOT EXISTS "sync_disabled_until" TIMESTAMP;

-- ============================================
-- 3. Create Outgoing Webhooks Table
-- ============================================
CREATE TABLE IF NOT EXISTS "outgoing_webhooks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,

  -- Webhook configuration
  "name" VARCHAR(100) NOT NULL,
  "url" TEXT NOT NULL,
  "secret" TEXT NOT NULL,

  -- Events (JSONB array of event types)
  "events" JSONB NOT NULL DEFAULT '[]',

  -- Optional filtering
  "client_id" UUID REFERENCES "clients"("id") ON DELETE CASCADE,
  "project_id" UUID REFERENCES "projects"("id") ON DELETE CASCADE,

  -- Status
  "is_active" BOOLEAN NOT NULL DEFAULT true,

  -- Delivery settings
  "retry_count" INTEGER NOT NULL DEFAULT 3,
  "timeout_ms" INTEGER NOT NULL DEFAULT 30000,

  -- Stats
  "total_deliveries" INTEGER NOT NULL DEFAULT 0,
  "successful_deliveries" INTEGER NOT NULL DEFAULT 0,
  "failed_deliveries" INTEGER NOT NULL DEFAULT 0,
  "last_delivery_at" TIMESTAMP,
  "last_delivery_status" VARCHAR(20),
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,

  -- Auto-disable
  "disabled_at" TIMESTAMP,
  "disabled_reason" TEXT,

  -- Timestamps
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- 4. Create Webhook Deliveries Table
-- ============================================
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_id" UUID NOT NULL REFERENCES "outgoing_webhooks"("id") ON DELETE CASCADE,

  -- Event info
  "event_type" VARCHAR(50) NOT NULL,
  "event_id" UUID,
  "payload" JSONB NOT NULL,

  -- Delivery attempt info
  "attempt_number" INTEGER NOT NULL DEFAULT 1,
  "status" VARCHAR(20) NOT NULL, -- 'pending_retry', 'success', 'failed'

  -- Response info
  "response_status" INTEGER,
  "response_body" TEXT,
  "response_time_ms" INTEGER,

  -- Error info
  "error_message" TEXT,

  -- Timing
  "scheduled_for" TIMESTAMP NOT NULL DEFAULT NOW(),
  "delivered_at" TIMESTAMP,

  -- Timestamps
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- 5. Create Indexes for Performance
-- ============================================

-- Index for finding active webhooks per user (used in triggerWebhooks)
CREATE INDEX IF NOT EXISTS "outgoing_webhooks_user_active_idx"
ON "outgoing_webhooks" ("user_id", "is_active");

-- Index for retry job (finding pending_retry deliveries)
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_idx"
ON "webhook_deliveries" ("status");

-- Index for delivery history queries per webhook
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_created_idx"
ON "webhook_deliveries" ("webhook_id", "created_at");

-- ============================================
-- Verification Queries
-- ============================================
-- Run these to verify the migration:

-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'user' AND column_name = 'billy_organization_id';

-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'calendar_connections' AND column_name IN ('consecutive_sync_failures', 'sync_disabled_until');

-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('outgoing_webhooks', 'webhook_deliveries');

-- SELECT indexname FROM pg_indexes
-- WHERE indexname LIKE '%webhook%';
