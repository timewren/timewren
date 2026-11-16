-- Migration: Add Billy invoice line template settings
-- Allows users to customize how invoice line descriptions are formatted

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "billy_line_type" VARCHAR(20) DEFAULT 'per_entry';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "billy_line_template" TEXT DEFAULT '{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}';

COMMENT ON COLUMN "user"."billy_line_type" IS 'Invoice line type: per_entry (one line per time entry) or combined (all entries in one line)';
COMMENT ON COLUMN "user"."billy_line_template" IS 'Template for invoice line descriptions with variables like {{beskrivelse}}, {{dato}}, {{tidsforbrug}}';
