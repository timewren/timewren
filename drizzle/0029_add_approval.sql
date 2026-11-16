-- Time approval workflow
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "approval_workflow" varchar(20) DEFAULT 'off';
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "approval_workflow" varchar(20);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approval_status" varchar(20) NOT NULL DEFAULT 'not_required';
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approved_by" text;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "type" varchar(20) NOT NULL,
  "period_start" date,
  "period_end" date,
  "invoice_id" uuid REFERENCES "invoices"("id"),
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "entry_ids" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "responded_at" timestamp,
  "response_note" text
);
