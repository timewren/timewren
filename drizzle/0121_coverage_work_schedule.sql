-- Dækningsgrad (#679): normal arbejdstid pr. ugedag + valgfri tærskel for
-- påmindelse om lav dækningsgrad. Begge kolonner er nullable og uden default,
-- så eksisterende brugere er uændrede (NULL = afledt af working_days /
-- påmindelse slået fra). Idempotent.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "work_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "coverage_reminder_threshold" integer;
