-- better-auths twoFactor-plugin (1.6) læser og skriver verified,
-- failedVerificationCount og lockedUntil ved 2FA-verificering. Uden kolonnerne
-- (og felterne i Drizzle-schemaet) svarer /two-factor/enable og alle
-- verify-endpoints 500, så 2FA-brugere ikke kan logge ind. Eksisterende rækker
-- er tilmeldinger fra før felterne fandtes og får verified=true (pluginets default).
ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "failedVerificationCount" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "lockedUntil" timestamp;
