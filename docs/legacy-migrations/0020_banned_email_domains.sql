-- Banned email domains table for spam protection
-- Admin can ban specific email domains to prevent spam signups

CREATE TABLE IF NOT EXISTS "banned_email_domains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "domain" varchar(255) NOT NULL UNIQUE,
  "reason" text,
  "banned_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Index for fast lookup by domain
CREATE INDEX IF NOT EXISTS "banned_email_domains_domain_idx" ON "banned_email_domains" ("domain");
