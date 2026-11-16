-- #479: Audit-retention vs. GDPR. Aktør/medarbejder på audit- og
-- hændelsesrækker må ikke CASCADE-slettes med brugeren (5 års opbevaring,
-- tidsregistreringsloven) — FK'erne skiftes til ON DELETE SET NULL, og et
-- tekst-snapshot af navn/e-mail på hændelsestidspunktet gemmes i
-- *_label-kolonner. Alle trin er idempotente (kan køres igen uden fejl).

-- Snapshot-kolonner
ALTER TABLE "org_audit_logs" ADD COLUMN IF NOT EXISTS "actor_label" varchar(255);--> statement-breakpoint
ALTER TABLE "timesheet_week_events" ADD COLUMN IF NOT EXISTS "user_label" varchar(255);--> statement-breakpoint
ALTER TABLE "timesheet_week_events" ADD COLUMN IF NOT EXISTS "actor_label" varchar(255);--> statement-breakpoint

-- Nullable aktør/medarbejder
ALTER TABLE "org_audit_logs" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_week_events" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint

-- Constraint-swap: CASCADE -> SET NULL. FK-navnet er IKKE stabilt i prod
-- (org_audit_logs har "org_audit_logs_actor_id_fkey", ikke drizzle-
-- konventionen), så constrainten slås op i pg_constraint på
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
      AND (
        (c.conrelid = 'org_audit_logs'::regclass AND a.attname = 'actor_id') OR
        (c.conrelid = 'timesheet_week_events'::regclass AND a.attname = 'user_id')
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;

  ALTER TABLE "org_audit_logs"
    ADD CONSTRAINT "org_audit_logs_actor_id_user_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
  ALTER TABLE "timesheet_week_events"
    ADD CONSTRAINT "timesheet_week_events_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
END $$;--> statement-breakpoint

-- Backfill af labels fra "user" (kun hvor label mangler)
UPDATE "org_audit_logs" a
   SET "actor_label" = CASE
         WHEN u."name" IS NOT NULL AND u."name" <> '' AND u."email" IS NOT NULL
           THEN u."name" || ' (' || u."email" || ')'
         ELSE COALESCE(NULLIF(u."name", ''), u."email")
       END
  FROM "user" u
 WHERE a."actor_id" = u."id" AND a."actor_label" IS NULL;--> statement-breakpoint

UPDATE "timesheet_week_events" e
   SET "user_label" = CASE
         WHEN u."name" IS NOT NULL AND u."name" <> '' AND u."email" IS NOT NULL
           THEN u."name" || ' (' || u."email" || ')'
         ELSE COALESCE(NULLIF(u."name", ''), u."email")
       END
  FROM "user" u
 WHERE e."user_id" = u."id" AND e."user_label" IS NULL;--> statement-breakpoint

UPDATE "timesheet_week_events" e
   SET "actor_label" = CASE
         WHEN u."name" IS NOT NULL AND u."name" <> '' AND u."email" IS NOT NULL
           THEN u."name" || ' (' || u."email" || ')'
         ELSE COALESCE(NULLIF(u."name", ''), u."email")
       END
  FROM "user" u
 WHERE e."actor_id" = u."id" AND e."actor_label" IS NULL;
