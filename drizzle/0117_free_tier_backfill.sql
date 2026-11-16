-- Gratis-tier (reverse trial): udløbne trials uden betaling flyttes til den
-- permanente Gratis-tier i stedet for at sidde bag betalingsmuren. Al data
-- bevares — kun status, tier og pladser ændres.
-- Organisationer med 2+ medlemmer forbliver 'trial_expired' (Gratis har intet
-- team); spejler trialExpiryOutcome() i src/lib/billing/plan-limits.ts.
UPDATE "subscriptions" AS s
SET
  "status" = 'free',
  "plan_tier" = 'free',
  "is_trial" = false,
  "seat_count" = 1,
  "max_seats" = 1,
  "updated_at" = now()
WHERE s."status" = 'trial_expired'
  AND (
    s."organization_id" IS NULL
    OR (
      SELECT count(*) FROM "members" AS m
      WHERE m."organization_id" = s."organization_id"
    ) <= 1
  );
