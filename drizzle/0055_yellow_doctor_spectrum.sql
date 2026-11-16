CREATE INDEX IF NOT EXISTS "invoices_org_status_idx" ON "invoices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepaid_usage_package_id_idx" ON "prepaid_usage" USING btree ("prepaid_package_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepaid_usage_time_entry_id_idx" ON "prepaid_usage" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_org_id_idx" ON "time_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_org_date_idx" ON "time_entries" USING btree ("organization_id","date");