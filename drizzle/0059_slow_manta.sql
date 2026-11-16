ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "template_id" uuid;