-- Skjul et klippekort helt for kunden i portalen (kunde A 8/9-2026). Idempotent.
ALTER TABLE "prepaid_packages" ADD COLUMN IF NOT EXISTS "hidden_from_portal" boolean DEFAULT false NOT NULL;
