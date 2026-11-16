-- Sprint 4: Integrations Schema Changes
-- Add URL patterns for browser extension auto-detection
-- Add timer states table for extension sync
-- Add Slack webhook support

-- 1. Add URL patterns to projects for auto-detection
ALTER TABLE projects ADD COLUMN IF NOT EXISTS url_patterns JSONB DEFAULT '[]';

-- 2. Create timer_states table for browser extension sync (if not exists)
CREATE TABLE IF NOT EXISTS timer_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,

  -- Timer state
  is_running BOOLEAN DEFAULT false,
  start_time TIMESTAMP,
  elapsed_seconds INTEGER DEFAULT 0,
  base_seconds INTEGER DEFAULT 0,

  -- Associated project/client
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,

  -- Description
  description TEXT DEFAULT '',

  -- Sync tracking
  last_synced_at TIMESTAMP DEFAULT NOW(),
  last_synced_from VARCHAR(20),

  -- Idle detection
  is_idle BOOLEAN DEFAULT false,
  idle_detected_at TIMESTAMP,
  idle_threshold_minutes INTEGER DEFAULT 5,
  last_activity_at TIMESTAMP,

  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- 3. Add Slack webhook support to notification_channels
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS slack_channel_name VARCHAR(100);
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS slack_bot_token TEXT;

-- 4. Add timer notification settings to notification_channels
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS send_timer_start BOOLEAN DEFAULT false;
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS send_timer_stop BOOLEAN DEFAULT false;
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS send_idle_warning BOOLEAN DEFAULT false;

-- 5. Create index for URL pattern lookups (GIN index for JSONB array)
CREATE INDEX IF NOT EXISTS idx_projects_url_patterns ON projects USING GIN (url_patterns);

-- 6. Create index for idle detection queries
CREATE INDEX IF NOT EXISTS idx_timer_states_idle ON timer_states(is_idle) WHERE is_idle = true;

-- 7. Create index for timer states user lookup
CREATE INDEX IF NOT EXISTS idx_timer_states_user_id ON timer_states(user_id);
