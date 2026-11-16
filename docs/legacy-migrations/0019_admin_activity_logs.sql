-- Admin activity logs table for audit trail
CREATE TABLE IF NOT EXISTS "admin_activity_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "action" varchar(100) NOT NULL,
  "target_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "details" jsonb,
  "ip_address" varchar(45),
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Index for querying by admin user
CREATE INDEX IF NOT EXISTS "admin_activity_logs_admin_user_idx" ON "admin_activity_logs" ("admin_user_id");

-- Index for querying by target user
CREATE INDEX IF NOT EXISTS "admin_activity_logs_target_user_idx" ON "admin_activity_logs" ("target_user_id");

-- Index for querying by action type
CREATE INDEX IF NOT EXISTS "admin_activity_logs_action_idx" ON "admin_activity_logs" ("action");

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS "admin_activity_logs_created_at_idx" ON "admin_activity_logs" ("created_at" DESC);
