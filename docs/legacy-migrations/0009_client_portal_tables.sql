-- Migration: Add client portal tables
-- These tables enable clients to access a portal to view their invoices, projects, time entries, etc.

-- Client Portal Access - Access credentials for each client
CREATE TABLE IF NOT EXISTS "client_portal_access" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" UUID NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "freelancer_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,

  -- Adgangstype: 'token' (link-based) eller 'account' (email/password)
  "access_type" VARCHAR(20) NOT NULL DEFAULT 'token',

  -- For token-baseret adgang
  "access_token" VARCHAR(255) UNIQUE,
  "token_expires_at" TIMESTAMP,

  -- For konto-baseret adgang
  "email" VARCHAR(255),
  "password_hash" VARCHAR(255),
  "email_verified" BOOLEAN DEFAULT false,
  "email_verification_token" VARCHAR(255),
  "password_reset_token" VARCHAR(255),
  "password_reset_expires_at" TIMESTAMP,

  -- Permissions
  "can_view_invoices" BOOLEAN DEFAULT true,
  "can_view_projects" BOOLEAN DEFAULT true,
  "can_view_time_entries" BOOLEAN DEFAULT true,
  "can_view_prepaid" BOOLEAN DEFAULT true,
  "can_approve_time" BOOLEAN DEFAULT false,
  "can_download_invoices" BOOLEAN DEFAULT true,

  -- Status
  "is_active" BOOLEAN DEFAULT true,
  "last_accessed_at" TIMESTAMP,
  "access_count" INTEGER DEFAULT 0,

  -- Invitation tracking
  "invitation_sent_at" TIMESTAMP,
  "invitation_accepted_at" TIMESTAMP,

  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Client Portal Sessions - Active sessions for logged in clients
CREATE TABLE IF NOT EXISTS "client_portal_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "portal_access_id" UUID NOT NULL REFERENCES "client_portal_access"("id") ON DELETE CASCADE,

  "session_token" VARCHAR(255) UNIQUE NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "ip_address" VARCHAR(45),
  "user_agent" TEXT,

  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Portal Activity Log - Track client portal activity
CREATE TABLE IF NOT EXISTS "portal_activity_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "portal_access_id" UUID NOT NULL REFERENCES "client_portal_access"("id") ON DELETE CASCADE,
  "freelancer_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,

  -- Action: 'login', 'view_invoice', 'download_invoice', 'view_project', etc.
  "action" VARCHAR(50) NOT NULL,

  -- Entity that was accessed (if applicable)
  "entity_type" VARCHAR(50),
  "entity_id" UUID,
  "entity_name" VARCHAR(255),

  -- Additional metadata
  "metadata" JSONB,
  "ip_address" VARCHAR(45),
  "user_agent" TEXT,

  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "client_portal_access_client_id_idx" ON "client_portal_access"("client_id");
CREATE INDEX IF NOT EXISTS "client_portal_access_freelancer_id_idx" ON "client_portal_access"("freelancer_id");
CREATE INDEX IF NOT EXISTS "client_portal_access_access_token_idx" ON "client_portal_access"("access_token");
CREATE INDEX IF NOT EXISTS "client_portal_sessions_portal_access_id_idx" ON "client_portal_sessions"("portal_access_id");
CREATE INDEX IF NOT EXISTS "portal_activity_logs_portal_access_id_idx" ON "portal_activity_logs"("portal_access_id");
CREATE INDEX IF NOT EXISTS "portal_activity_logs_freelancer_id_idx" ON "portal_activity_logs"("freelancer_id");

COMMENT ON TABLE "client_portal_access" IS 'Stores client portal access credentials and permissions';
COMMENT ON TABLE "client_portal_sessions" IS 'Stores active client portal sessions';
COMMENT ON TABLE "portal_activity_logs" IS 'Logs all client portal activity for audit purposes';
