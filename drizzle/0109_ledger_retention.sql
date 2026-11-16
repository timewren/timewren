-- #499: Ledger-retention vs. GDPR (opfølgning på #479/0104). Medarbejderen
-- på vacation_ledger og overtime_ledger må ikke CASCADE-slettes med brugeren
-- (5 års opbevaring for offentlige arbejdsgivere) — FK'erne skiftes til
-- ON DELETE SET NULL, og et tekst-snapshot af navn/e-mail gemmes i user_label.
-- Alle trin er idempotente (kan køres igen uden fejl).

-- Snapshot-kolonner
ALTER TABLE "vacation_ledger" ADD COLUMN IF NOT EXISTS "user_label" varchar(255);--> statement-breakpoint
ALTER TABLE "overtime_ledger" ADD COLUMN IF NOT EXISTS "user_label" varchar(255);--> statement-breakpoint

-- Nullable medarbejder
ALTER TABLE "vacation_ledger" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "overtime_ledger" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint

-- Constraint-swap: CASCADE -> SET NULL. FK-navne er IKKE stabile i prod (se
-- 0104/0106), så constrainten slås op i pg_constraint på
-- (tabel, kolonne -> "user".id) og ALLE match droppes før ADD.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS tbl
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = '"user"'::regclass
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'user_id'
      AND c.conrelid IN ('vacation_ledger'::regclass, 'overtime_ledger'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;

  ALTER TABLE "vacation_ledger"
    ADD CONSTRAINT "vacation_ledger_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
  ALTER TABLE "overtime_ledger"
    ADD CONSTRAINT "overtime_ledger_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
END $$;--> statement-breakpoint

-- Backfill af labels fra "user" (kun hvor label mangler) — samme udtryk som
-- formatUserLabel() i src/lib/org-audit.ts og 0104.
UPDATE "vacation_ledger" l
   SET "user_label" = CASE
         WHEN u."name" IS NOT NULL AND u."name" <> '' AND u."email" IS NOT NULL
           THEN u."name" || ' (' || u."email" || ')'
         ELSE COALESCE(NULLIF(u."name", ''), u."email")
       END
  FROM "user" u
 WHERE l."user_id" = u."id" AND l."user_label" IS NULL;--> statement-breakpoint

UPDATE "overtime_ledger" l
   SET "user_label" = CASE
         WHEN u."name" IS NOT NULL AND u."name" <> '' AND u."email" IS NOT NULL
           THEN u."name" || ' (' || u."email" || ')'
         ELSE COALESCE(NULLIF(u."name", ''), u."email")
       END
  FROM "user" u
 WHERE l."user_id" = u."id" AND l."user_label" IS NULL;
