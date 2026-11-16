-- Migration: Add portal branding and email templates tables
-- These tables enable freelancers to customize their client portal appearance

-- Portal Branding - Customization settings for each freelancer's portal
CREATE TABLE IF NOT EXISTS "portal_branding" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE UNIQUE,

  -- Basis branding
  "brand_name" VARCHAR(255),
  "logo_url" TEXT,
  "favicon_url" TEXT,

  -- Farver
  "primary_color" VARCHAR(7) DEFAULT '#3b82f6',
  "secondary_color" VARCHAR(7) DEFAULT '#1e40af',
  "accent_color" VARCHAR(7) DEFAULT '#10b981',
  "background_color" VARCHAR(7) DEFAULT '#ffffff',
  "text_color" VARCHAR(7) DEFAULT '#111827',

  -- Fonts
  "heading_font" VARCHAR(100) DEFAULT 'Inter',
  "body_font" VARCHAR(100) DEFAULT 'Inter',

  -- Custom domæne
  "custom_domain" VARCHAR(255),
  "custom_domain_verified" BOOLEAN DEFAULT false,
  "custom_domain_verified_at" TIMESTAMP,
  "domain_verification_token" VARCHAR(255),

  -- Ekstra indstillinger
  "footer_text" TEXT,
  "support_email" VARCHAR(255),
  "support_phone" VARCHAR(50),

  -- Portal features toggle
  "show_invoices" BOOLEAN DEFAULT true,
  "show_projects" BOOLEAN DEFAULT true,
  "show_time_entries" BOOLEAN DEFAULT true,
  "show_prepaid" BOOLEAN DEFAULT true,

  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Email Templates - Custom email templates per freelancer
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,

  -- Template info
  "name" VARCHAR(255) NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,

  -- Content (JSON struktur for visual editor blocks)
  "content" JSONB NOT NULL,

  -- Pre-rendered HTML (cached for sending)
  "html_content" TEXT,

  -- Settings
  "is_default" BOOLEAN DEFAULT false,
  "is_active" BOOLEAN DEFAULT true,
  "is_system" BOOLEAN DEFAULT false,

  -- Usage tracking
  "usage_count" INTEGER DEFAULT 0,
  "last_used_at" TIMESTAMP,

  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "portal_branding_user_id_idx" ON "portal_branding"("user_id");
CREATE INDEX IF NOT EXISTS "email_templates_user_id_idx" ON "email_templates"("user_id");
CREATE INDEX IF NOT EXISTS "email_templates_type_idx" ON "email_templates"("type");

COMMENT ON TABLE "portal_branding" IS 'Stores portal branding settings per freelancer';
COMMENT ON TABLE "email_templates" IS 'Stores custom email templates per freelancer';
