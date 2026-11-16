-- OAuth 2.1-autorisationsserver til MCP-forbindelser (#912), tabellerne som
-- @better-auth/oauth-provider 1.7.13 kræver. Rent additivt: nye tabeller,
-- ingen ændringer i eksisterende. Idempotent (IF NOT EXISTS), så en
-- gentagen kørsel er harmløs.
CREATE TABLE IF NOT EXISTS "oauthClient" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"clientSecret" text,
	"clientDiscoveryId" text,
	"disabled" boolean DEFAULT false,
	"skipConsent" boolean,
	"enableEndSession" boolean,
	"subjectType" text,
	"scopes" text[],
	"clientCredentialsScopes" text[],
	"userId" text,
	"createdAt" timestamp,
	"updatedAt" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"softwareId" text,
	"softwareVersion" text,
	"softwareStatement" text,
	"redirectUris" text[] NOT NULL,
	"postLogoutRedirectUris" text[],
	"backchannelLogoutUri" text,
	"backchannelLogoutSessionRequired" boolean,
	"tokenEndpointAuthMethod" text,
	"applicationType" text,
	"jwks" text,
	"jwksUri" text,
	"grantTypes" text[],
	"responseTypes" text[],
	"requirePKCE" boolean,
	"dpopBoundAccessTokens" boolean DEFAULT false,
	"referenceId" text,
	"metadata" jsonb,
	CONSTRAINT "oauthClient_clientId_unique" UNIQUE("clientId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauthResource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"accessTokenTtl" integer,
	"refreshTokenTtl" integer,
	"signingAlgorithm" text,
	"signingKeyId" text,
	"allowedScopes" text[],
	"customClaims" jsonb,
	"dpopBoundAccessTokensRequired" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"createdAt" timestamp,
	"updatedAt" timestamp,
	"policyVersion" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauthResource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauthClientResource" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"resourceId" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauthRefreshToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text NOT NULL,
	"referenceId" text,
	"authorizationCodeId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"expiresAt" timestamp,
	"createdAt" timestamp,
	"revoked" timestamp,
	"rotatedAt" timestamp,
	"rotationReplayResponse" text,
	"rotationReplayExpiresAt" timestamp,
	"authTime" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauthRefreshToken_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text,
	"referenceId" text,
	"authorizationCodeId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"refreshId" text,
	"expiresAt" timestamp,
	"createdAt" timestamp,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauthAccessToken_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauthConsent" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"userId" text,
	"referenceId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"scopes" text[] NOT NULL,
	"createdAt" timestamp,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauthClientAssertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_oauthResource_identifier_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."oauthResource"("identifier") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_oauthRefreshToken_id_fk" FOREIGN KEY ("refreshId") REFERENCES "public"."oauthRefreshToken"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthClientResource_clientId_idx" ON "oauthClientResource" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthClientResource_resourceId_idx" ON "oauthClientResource" USING btree ("resourceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_userId_idx" ON "oauthRefreshToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken" USING btree ("authorizationCodeId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_clientId_idx" ON "oauthAccessToken" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_sessionId_idx" ON "oauthAccessToken" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_userId_idx" ON "oauthAccessToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken" USING btree ("authorizationCodeId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthAccessToken_refreshId_idx" ON "oauthAccessToken" USING btree ("refreshId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthConsent_clientId_idx" ON "oauthConsent" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauthConsent_userId_idx" ON "oauthConsent" USING btree ("userId");
