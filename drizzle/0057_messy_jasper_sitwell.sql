ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "kind" varchar(20) DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "related_invoice_id" uuid;