-- Migration: Add integration preferences to users table
-- Allows users to set default accounting integration and enable auto-sync

-- Add default accounting integration preference
-- Values: 'billy', 'dinero', 'economic', or NULL (none)
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS default_accounting_integration VARCHAR(20);

-- Add auto-sync invoices flag
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS auto_sync_invoices BOOLEAN DEFAULT false;

COMMENT ON COLUMN "user".default_accounting_integration IS 'Default accounting system for invoice export (billy, dinero, economic, or NULL)';
COMMENT ON COLUMN "user".auto_sync_invoices IS 'Enable automatic invoice status synchronization with accounting systems';
