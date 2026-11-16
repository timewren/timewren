-- #726 (trin 2 af #713): ryd klartekst-kolonnerne for link-/adgangstokens.
-- Koden slår nu kun op på *_hash og viser kun tokens fra *_encrypted, og
-- schema.ts kender ikke længere klartekst-kolonnerne.
--
-- Kolonnerne sættes til NULL her; DROP COLUMN sker i en senere migration
-- (1-2 uger efter), så en rollback til #727-koden (som stadig har kolonnerne
-- i sit schema) ikke vælter på manglende kolonner.
--
-- GUARD: migrationen fejler højlydt, hvis en række stadig har klartekst uden
-- en matchende hash — eller, for tokens der skal kunne vises igen, uden en
-- krypteret kopi. Så slettes intet token, som backfill
-- (scripts/backfill-token-hashes.ts fra #727; fjernet i #726, men findes i
-- det forrige image og i git-historikken) ikke har dækket. Alle ventende
-- migrationer kører i én transaktion, så en fejl her ruller hele kørslen
-- tilbage og efterlader klarteksten urørt.
DO $$
DECLARE
  t record;
  bad bigint;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('extension_tokens',         'token',                    'token_hash',                    NULL),
      ('client_portal_access',     'access_token',             'access_token_hash',             'access_token_encrypted'),
      ('client_portal_access',     'email_verification_token', 'email_verification_token_hash', NULL),
      ('client_portal_sessions',   'session_token',            'session_token_hash',            NULL),
      ('alunta_klippekort_tokens', 'token',                    'token_hash',                    'token_encrypted'),
      ('report_shares',            'token',                    'token_hash',                    'token_encrypted'),
      ('data_export_requests',     'download_token',           'download_token_hash',           'download_token_encrypted'),
      ('calendar_connections',     'webhook_token',            'webhook_token_hash',            NULL)
    ) AS v(tbl, plain, hash, enc)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %1$I
        WHERE %2$I IS NOT NULL AND %2$I <> ''''
          AND (%3$I IS NULL
               OR %3$I <> encode(sha256(convert_to(%2$I, ''UTF8'')), ''hex'')%4$s)',
      t.tbl, t.plain, t.hash,
      CASE WHEN t.enc IS NULL THEN '' ELSE format(' OR %I IS NULL', t.enc) END
    ) INTO bad;
    IF bad > 0 THEN
      RAISE EXCEPTION
        '0126: %.% har % række(r) med klartekst uden matchende % (eller uden krypteret kopi). Kør scripts/backfill-token-hashes.ts --apply fra #727-imaget før denne migration.',
        t.tbl, t.plain, bad, t.hash;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
UPDATE "extension_tokens" SET "token" = NULL WHERE "token" IS NOT NULL;--> statement-breakpoint
UPDATE "client_portal_access" SET "access_token" = NULL, "email_verification_token" = NULL, "password_reset_token" = NULL WHERE "access_token" IS NOT NULL OR "email_verification_token" IS NOT NULL OR "password_reset_token" IS NOT NULL;--> statement-breakpoint
UPDATE "client_portal_sessions" SET "session_token" = NULL WHERE "session_token" IS NOT NULL;--> statement-breakpoint
UPDATE "alunta_klippekort_tokens" SET "token" = NULL WHERE "token" IS NOT NULL;--> statement-breakpoint
UPDATE "report_shares" SET "token" = NULL WHERE "token" IS NOT NULL;--> statement-breakpoint
UPDATE "data_export_requests" SET "download_token" = NULL WHERE "download_token" IS NOT NULL;--> statement-breakpoint
UPDATE "calendar_connections" SET "webhook_token" = NULL WHERE "webhook_token" IS NOT NULL;--> statement-breakpoint
-- Unikke indeks på de (nu tomme) klartekst-kolonner — inkl. navne fra de
-- gamle håndskrevne migrationer (docs/legacy-migrations), hvis de findes.
ALTER TABLE "alunta_klippekort_tokens" DROP CONSTRAINT IF EXISTS "alunta_klippekort_tokens_token_unique";--> statement-breakpoint
ALTER TABLE "client_portal_access" DROP CONSTRAINT IF EXISTS "client_portal_access_access_token_unique";--> statement-breakpoint
ALTER TABLE "client_portal_access" DROP CONSTRAINT IF EXISTS "client_portal_access_access_token_key";--> statement-breakpoint
ALTER TABLE "client_portal_sessions" DROP CONSTRAINT IF EXISTS "client_portal_sessions_session_token_unique";--> statement-breakpoint
ALTER TABLE "client_portal_sessions" DROP CONSTRAINT IF EXISTS "client_portal_sessions_session_token_key";--> statement-breakpoint
ALTER TABLE "data_export_requests" DROP CONSTRAINT IF EXISTS "data_export_requests_download_token_unique";--> statement-breakpoint
ALTER TABLE "data_export_requests" DROP CONSTRAINT IF EXISTS "data_export_requests_download_token_key";--> statement-breakpoint
ALTER TABLE "extension_tokens" DROP CONSTRAINT IF EXISTS "extension_tokens_token_unique";--> statement-breakpoint
ALTER TABLE "extension_tokens" DROP CONSTRAINT IF EXISTS "extension_tokens_token_key";--> statement-breakpoint
DROP INDEX IF EXISTS "report_shares_token_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "client_portal_access_access_token_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "data_export_requests_token_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "extension_tokens_token_idx";
