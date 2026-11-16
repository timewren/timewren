-- #726 (trin 4 af #713): drop klartekst-kolonnerne for link-/adgangstokens.
-- 0126 nulstillede dem og droppede de unikke indeks; koden kender dem ikke
-- længere. Efter denne migration kan #727-koden (der stadig har kolonnerne i
-- sit schema) ikke længere køre, så en rollback kræver backup.
--
-- calendar_connections.access_token er den levende OAuth-kolonne og røres IKKE;
-- kun client_portal_access.access_token er en rest.
--
-- GUARD: migrationen fejler højlydt, hvis en af kolonnerne stadig indeholder en
-- ikke-NULL værdi (fx fordi 0126 ikke har kørt, eller ny klartekst er skrevet
-- siden). Kolonner der allerede er væk springes over, så migrationen kan
-- gentages. Alle ventende migrationer kører i én transaktion, så en fejl her
-- efterlader schemaet urørt.
DO $$
DECLARE
  t record;
  bad bigint;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('extension_tokens',         'token'),
      ('client_portal_access',     'access_token'),
      ('client_portal_access',     'email_verification_token'),
      ('client_portal_access',     'password_reset_token'),
      ('client_portal_sessions',   'session_token'),
      ('alunta_klippekort_tokens', 'token'),
      ('report_shares',            'token'),
      ('data_export_requests',     'download_token'),
      ('calendar_connections',     'webhook_token')
    ) AS v(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = t.tbl AND column_name = t.col
    ) THEN
      EXECUTE format('SELECT count(*) FROM %I WHERE %I IS NOT NULL', t.tbl, t.col)
        INTO bad;
      IF bad > 0 THEN
        RAISE EXCEPTION
          '0153: %.% har % række(r) med ikke-NULL klartekst. Drop afbrudt; undersøg og nulstil først (se 0126).',
          t.tbl, t.col, bad;
      END IF;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "extension_tokens" DROP COLUMN IF EXISTS "token";--> statement-breakpoint
ALTER TABLE "client_portal_access" DROP COLUMN IF EXISTS "access_token";--> statement-breakpoint
ALTER TABLE "client_portal_access" DROP COLUMN IF EXISTS "email_verification_token";--> statement-breakpoint
ALTER TABLE "client_portal_access" DROP COLUMN IF EXISTS "password_reset_token";--> statement-breakpoint
ALTER TABLE "client_portal_sessions" DROP COLUMN IF EXISTS "session_token";--> statement-breakpoint
ALTER TABLE "alunta_klippekort_tokens" DROP COLUMN IF EXISTS "token";--> statement-breakpoint
ALTER TABLE "report_shares" DROP COLUMN IF EXISTS "token";--> statement-breakpoint
ALTER TABLE "data_export_requests" DROP COLUMN IF EXISTS "download_token";--> statement-breakpoint
ALTER TABLE "calendar_connections" DROP COLUMN IF EXISTS "webhook_token";
