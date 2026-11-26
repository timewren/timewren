-- vat_registered_chosen: has the user made their own VAT choice? Until they
-- have, vat_registered follows the CVR rule (src/lib/invoices/vat-default.ts):
-- on for a Danish company with a full CVR number, off otherwise.
-- Expand-only: a new column with a default.
ALTER TABLE "company_profiles" ADD COLUMN IF NOT EXISTS "vat_registered_chosen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing stored choices are never overridden: a profile that is already
-- VAT registered, or already has a full CVR number, counts as chosen.
UPDATE "company_profiles"
SET "vat_registered_chosen" = true
WHERE "vat_registered" = true
  OR regexp_replace(coalesce("cvr_number", ''), '\s', '', 'g') ~* '^(dk)?[0-9]{8}$';
