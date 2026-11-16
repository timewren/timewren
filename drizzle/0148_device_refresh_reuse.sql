-- Genbrug af refresh-tokens (desktop 1.0): hash af det refresh-token, der
-- blev roteret væk ved sidste fornyelse. Rent additiv; null for alle
-- eksisterende tokens.
ALTER TABLE "extension_tokens" ADD COLUMN IF NOT EXISTS "previous_refresh_token_hash" varchar(64);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_previous_refresh_token_hash_unique" UNIQUE("previous_refresh_token_hash");
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
