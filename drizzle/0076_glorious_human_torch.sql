DROP INDEX "prepaid_packages_alunta_invoice_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "prepaid_packages_alunta_invoice_idx" ON "prepaid_packages" USING btree ("alunta_invoice_uuid");