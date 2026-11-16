ALTER TABLE "prepaid_usage" ALTER COLUMN "hours_used" SET DATA TYPE numeric(8, 2);--> statement-breakpoint
ALTER TABLE "prepaid_usage" ALTER COLUMN "value_used" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_packages_remaining_non_negative') THEN
    ALTER TABLE "prepaid_packages" ADD CONSTRAINT "prepaid_packages_remaining_non_negative" CHECK (remaining_hours >= 0);
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_packages_remaining_within_total') THEN
    ALTER TABLE "prepaid_packages" ADD CONSTRAINT "prepaid_packages_remaining_within_total" CHECK (remaining_hours <= total_hours);
  END IF;
END $$;