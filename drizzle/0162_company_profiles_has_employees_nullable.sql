-- has_employees on company_profiles: NULL now means "never saved on the
-- profile", so getCompanySettings falls back to the user's own value.
-- Expand-only: the column stays, only the default goes.
ALTER TABLE "company_profiles" ALTER COLUMN "has_employees" DROP DEFAULT;--> statement-breakpoint
-- Profiles created while the default was false hide a user's saved true.
-- Until now the deadlines read the user row, so NULL keeps exactly what those
-- users saw; a false saved on the profile can't be told apart from the default.
UPDATE "company_profiles" cp
SET "has_employees" = NULL
FROM "user" u
WHERE cp."user_id" = u."id"
  AND cp."has_employees" = false
  AND u."has_employees" = true;
