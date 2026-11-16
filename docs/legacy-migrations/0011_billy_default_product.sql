-- Migration: Add Billy default product ID column
-- Billy requires a productId for each invoice line

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "billy_default_product_id" VARCHAR(255);

COMMENT ON COLUMN "user"."billy_default_product_id" IS 'Default Billy product ID for invoice lines';
