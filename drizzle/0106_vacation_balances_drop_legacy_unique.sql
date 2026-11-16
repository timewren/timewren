-- #531 + #532 (E3): den gamle unikke (user_id, year, organization_id) på
-- vacation_balances overlevede 0099 i prod, fordi den dér hedder
-- "vacation_balances_user_id_year_organization_id_key" (PG-default-navn) og
-- 0099 kun droppede drizzle-navnet. Resultat: årsskiftet til et 1/9-ferieår
-- fejlede med duplicate key, når kalenderår-rækken med samme startår findes.
-- Samme fejlklasse som #479 (0104): constraints må ALDRIG droppes efter navn.
-- Her slås ALLE unikke constraints og unikke indeks med præcis kolonnesættet
-- {user_id, year, organization_id} op i kataloget og droppes. Idempotent.
DO $$
DECLARE
  r record;
  wanted int[];
BEGIN
  SELECT array_agg(a.attnum::int ORDER BY a.attnum) INTO wanted
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vacation_balances'::regclass
    AND a.attname IN ('user_id', 'year', 'organization_id')
    AND NOT a.attisdropped;

  -- Unikke constraints (og PK'er ville ikke matche kolonnesættet)
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.vacation_balances'::regclass
      AND c.contype IN ('u', 'p')
      AND (SELECT array_agg(k::int ORDER BY k) FROM unnest(c.conkey) AS k) = wanted
  LOOP
    EXECUTE format('ALTER TABLE public.vacation_balances DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE '0106: droppede constraint %', r.conname;
  END LOOP;

  -- Unikke indeks uden constraint (og evt. ikke-unikt indeks på samme sæt)
  FOR r IN
    SELECT i.indexrelid::regclass::text AS idxname
    FROM pg_index i
    WHERE i.indrelid = 'public.vacation_balances'::regclass
      AND i.indnkeyatts = 3
      AND (SELECT array_agg(k::int ORDER BY k) FROM unnest(i.indkey::int2[]) AS k) = wanted
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', r.idxname);
    RAISE NOTICE '0106: droppede indeks %', r.idxname;
  END LOOP;
END $$;--> statement-breakpoint
-- Den rigtige unikke nøgle (user, org, period_start) skal findes — 0099
-- opretter den, men vi sikrer den her igen (IF NOT EXISTS).
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_balances_user_org_period_idx" ON "vacation_balances" USING btree ("user_id","organization_id","period_start");--> statement-breakpoint
-- #532: tidspunkt for seneste skift af optjeningsmodel/ferieår-start. NULL =
-- aldrig skiftet (ingen grænse for catch-up). Sættes af
-- scripts/set-org-vacation-settings.ts og updateVacationSettings.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "vacation_settings_changed_at" timestamp;
