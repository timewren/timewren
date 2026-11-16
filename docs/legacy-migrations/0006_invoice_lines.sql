-- Migration: Add invoice_lines table for detailed invoice line items
-- Allows editing individual lines instead of just total amount

CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for efficient lookups by invoice
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);

-- Index for time entry reference lookups
CREATE INDEX IF NOT EXISTS idx_invoice_lines_time_entry_id ON invoice_lines(time_entry_id);

COMMENT ON TABLE invoice_lines IS 'Stores individual line items for invoices, allowing for detailed editing';
COMMENT ON COLUMN invoice_lines.quantity IS 'Number of units (e.g., hours, items)';
COMMENT ON COLUMN invoice_lines.unit_price IS 'Price per unit';
COMMENT ON COLUMN invoice_lines.amount IS 'Calculated total: quantity * unit_price';
COMMENT ON COLUMN invoice_lines.time_entry_id IS 'Optional link to a time entry if line was generated from it';
COMMENT ON COLUMN invoice_lines.sort_order IS 'Order of lines on the invoice (0 = first)';

-- Add reminder tracking to invoices (for future reminder feature)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0;

COMMENT ON COLUMN invoices.reminder_sent_at IS 'When the last payment reminder was sent';
COMMENT ON COLUMN invoices.reminder_count IS 'Number of reminders sent for this invoice';
