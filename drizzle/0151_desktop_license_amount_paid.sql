-- Desktop-licens 499 kr (27/10-2026): gem det faktisk betalte beløb pr.
-- licens, så en prisændring ikke forvrænger omsætningsrapporten for
-- tidligere køb til den gamle pris. Rent additiv, nullable.
ALTER TABLE "desktop_license" ADD COLUMN IF NOT EXISTS "amount_paid_dkk" integer;
