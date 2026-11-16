-- Månedsbudget-advarsler (#592): husk hvilket niveau (80/100 %) der sidst er
-- advaret om pr. projekt pr. måned, så cronen ikke sender dubletter.
-- Idempotent.
CREATE TABLE IF NOT EXISTS "project_budget_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  -- Kalendermåned i dansk tid, "YYYY-MM"
  "month" varchar(7) NOT NULL,
  -- Højeste tærskel der er advaret om i måneden: 80 eller 100
  "notified_level" integer DEFAULT 0 NOT NULL,
  "notified_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_budget_alerts_project_month_idx"
  ON "project_budget_alerts" ("project_id", "month");
