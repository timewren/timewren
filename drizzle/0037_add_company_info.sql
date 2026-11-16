ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "company_type" varchar(30);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "vat_period" varchar(20);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "fiscal_year_end" varchar(5);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "has_employees" boolean DEFAULT false;
