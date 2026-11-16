ALTER TABLE "time_entries" ADD COLUMN "client_entry_id" varchar(36);--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_client_entry_id_uq" ON "time_entries" USING btree ("client_entry_id");