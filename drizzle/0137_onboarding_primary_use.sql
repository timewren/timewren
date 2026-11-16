-- #91: valgfrit velkomstspørgsmål på Hjem ("Hvad vil du primært bruge
-- TimeTrack til?"). Svaret styrer kun hvilke signaler Hjem viser og deles
-- ikke eksternt. Nullable: intet svar = standardvisning.
ALTER TABLE "onboarding_progress" ADD COLUMN IF NOT EXISTS "primary_use" varchar(20);
