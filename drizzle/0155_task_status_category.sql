-- Kategori på brugerdefinerede kanban-kolonner (task_statuses). Hver kolonne
-- hører til én af fire faste kategorier, så omdøbte og nye kolonner stadig
-- giver den rigtige tasks.status (rapporter, filtre, desktop, API).
--
-- Rent additivt: én ny kolonne med default, ingen ændringer i tasks. De
-- eksisterende kolonner får den kategori, deres nuværende adfærd svarer
-- til: arkivkolonnen (Afsluttet) er done, "I gang" er in_progress, resten
-- (Backlog, Todo og egne kolonner) er not_started. Idempotent: UPDATE'ene
-- rører kun rækker, der stadig står på default.
ALTER TABLE "task_statuses" ADD COLUMN IF NOT EXISTS "category" varchar(20) DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
UPDATE "task_statuses" SET "category" = 'done' WHERE "is_archive" = true AND "category" = 'not_started';
--> statement-breakpoint
UPDATE "task_statuses" SET "category" = 'in_progress' WHERE "is_archive" = false AND "name" = 'I gang' AND "category" = 'not_started';
