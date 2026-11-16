-- Performance indexes for hot multi-tenant access patterns.
--
-- Every tRPC query scoped to `WHERE user_id = ?` previously ran against
-- unindexed columns on the core tables. This migration adds composite
-- indexes aligned with the real access patterns used in
-- `src/lib/trpc/routers/*.ts`.
--
-- Safe to run multiple times (IF NOT EXISTS).

-- clients: list(userId [, isArchived]) ORDER BY createdAt DESC
CREATE INDEX IF NOT EXISTS "clients_user_id_idx" ON "clients" ("user_id");
CREATE INDEX IF NOT EXISTS "clients_user_archived_idx" ON "clients" ("user_id", "is_archived");

-- projects: list(userId), getByClient(userId, clientId)
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");
CREATE INDEX IF NOT EXISTS "projects_client_id_idx" ON "projects" ("client_id");

-- invoices: list(userId), getByClient, getStats (status)
CREATE INDEX IF NOT EXISTS "invoices_user_id_idx" ON "invoices" ("user_id");
CREATE INDEX IF NOT EXISTS "invoices_user_status_idx" ON "invoices" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "invoices_client_id_idx" ON "invoices" ("client_id");

-- invoice_lines: lookups by invoiceId (loads on every invoice detail view)
CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_id_idx" ON "invoice_lines" ("invoice_id");

-- tasks: list/filter by user + status (Kanban), and project/client drilldowns
CREATE INDEX IF NOT EXISTS "tasks_user_id_idx" ON "tasks" ("user_id");
CREATE INDEX IF NOT EXISTS "tasks_user_status_idx" ON "tasks" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "tasks_project_id_idx" ON "tasks" ("project_id");
CREATE INDEX IF NOT EXISTS "tasks_client_id_idx" ON "tasks" ("client_id");
CREATE INDEX IF NOT EXISTS "tasks_parent_task_id_idx" ON "tasks" ("parent_task_id");

-- prepaid_packages: widget shows active packages per user/client
CREATE INDEX IF NOT EXISTS "prepaid_packages_user_id_idx" ON "prepaid_packages" ("user_id");
CREATE INDEX IF NOT EXISTS "prepaid_packages_client_id_idx" ON "prepaid_packages" ("client_id");

-- prepaid_usage: joined to time entries and package views
CREATE INDEX IF NOT EXISTS "prepaid_usage_package_id_idx" ON "prepaid_usage" ("prepaid_package_id");
CREATE INDEX IF NOT EXISTS "prepaid_usage_time_entry_id_idx" ON "prepaid_usage" ("time_entry_id");

-- rate_history: listed by user in settings + change tracking
CREATE INDEX IF NOT EXISTS "rate_history_user_id_idx" ON "rate_history" ("user_id");

-- time_entries: cover a few more common filter combinations.
-- (user_id, date), (client_id), (project_id), (task_id) already exist.
CREATE INDEX IF NOT EXISTS "time_entries_user_invoice_idx" ON "time_entries" ("user_id", "invoice_id");
CREATE INDEX IF NOT EXISTS "time_entries_user_billed_idx" ON "time_entries" ("user_id", "is_billed");

-- recurring_time_templates / timer_templates / invoice_templates: listed by user
CREATE INDEX IF NOT EXISTS "recurring_time_templates_user_id_idx" ON "recurring_time_templates" ("user_id");
CREATE INDEX IF NOT EXISTS "timer_templates_user_id_idx" ON "timer_templates" ("user_id");
CREATE INDEX IF NOT EXISTS "invoice_templates_user_id_idx" ON "invoice_templates" ("user_id");
