-- #713: bearer-/link-tokens hashes (SHA-256) i stedet for klartekst-opslag.
-- Trin 1 af 2: nye *_hash-kolonner (+ *_encrypted for tokens der skal kunne
-- vises igen), og klartekst-kolonnerne bliver nullable, så nye rækker ikke
-- gemmer klartekst. Eksisterende rækker beholder klarteksten, indtil
-- scripts/backfill-token-hashes.ts har udfyldt hash/krypteret, og et senere
-- trin rydder klartekst-kolonnerne. Rent additivt og idempotent.
ALTER TABLE "alunta_klippekort_tokens" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client_portal_sessions" ALTER COLUMN "session_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "data_export_requests" ALTER COLUMN "download_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extension_tokens" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "report_shares" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alunta_klippekort_tokens" ADD COLUMN IF NOT EXISTS "token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "alunta_klippekort_tokens" ADD COLUMN IF NOT EXISTS "token_encrypted" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "webhook_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD COLUMN IF NOT EXISTS "access_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD COLUMN IF NOT EXISTS "access_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD COLUMN IF NOT EXISTS "email_verification_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "client_portal_sessions" ADD COLUMN IF NOT EXISTS "session_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "data_export_requests" ADD COLUMN IF NOT EXISTS "download_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "data_export_requests" ADD COLUMN IF NOT EXISTS "download_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "report_shares" ADD COLUMN IF NOT EXISTS "token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "report_shares" ADD COLUMN IF NOT EXISTS "token_encrypted" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_shares_token_hash_unique" ON "report_shares" USING btree ("token_hash");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alunta_klippekort_tokens" ADD CONSTRAINT "alunta_klippekort_tokens_token_hash_unique" UNIQUE("token_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_access_token_hash_unique" UNIQUE("access_token_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_portal_sessions" ADD CONSTRAINT "client_portal_sessions_session_token_hash_unique" UNIQUE("session_token_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_download_token_hash_unique" UNIQUE("download_token_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_token_hash_unique" UNIQUE("token_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
