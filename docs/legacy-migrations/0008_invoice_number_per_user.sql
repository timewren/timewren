-- Migration: Change invoice_number unique constraint to be per-user
-- This fixes the issue where users couldn't create invoices because another user
-- already had the same invoice number (e.g., INV-001)

-- Drop the existing global unique constraint on invoice_number
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_invoice_number_unique";

-- Also try to drop the index if it exists (some Drizzle versions create an index)
DROP INDEX IF EXISTS "invoices_invoice_number_unique";

-- Add a new composite unique constraint on (user_id, invoice_number)
-- This allows each user to have their own INV-001, INV-002, etc.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_invoice_number_unique"
  UNIQUE ("user_id", "invoice_number");

COMMENT ON CONSTRAINT "invoices_user_invoice_number_unique" ON "invoices"
  IS 'Invoice numbers are unique per user, allowing each user to have their own sequence';
