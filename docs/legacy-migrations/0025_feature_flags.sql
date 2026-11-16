CREATE TABLE IF NOT EXISTS "feature_flags" (
  "key" varchar(100) PRIMARY KEY NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "description" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Seed default flags (all enabled)
INSERT INTO "feature_flags" ("key", "enabled", "description") VALUES
  ('calendar', true, 'Google/Outlook kalender integration og synkronisering'),
  ('ai', true, 'AI-baseret opgaveparsing, kategorisering og tidsestimering'),
  ('emailToTask', true, 'Opret opgaver automatisk fra indgående emails'),
  ('clientPortal', true, 'White-label portal hvor klienter kan se fakturaer og tid'),
  ('browserExtension', true, 'Chrome/Firefox extension til tidstracking'),
  ('prepaidPackages', true, 'Forudbetalte timepakker med saldosporing'),
  ('accountingSync', true, 'Synkronisering med Billy, Dinero og e-conomic'),
  ('notifications', true, 'Email, Discord, Slack, Push og SMS notifikationer'),
  ('recurringTemplates', true, 'Automatisk generering af tidsregistreringer'),
  ('organizations', true, 'Team workspaces og samarbejdsfunktioner'),
  ('systemAiKey', true, 'Tillad brug af TimeTrack''s egen AI-nøgle. Når deaktiveret skal brugere medbringe egen nøgle (BYOK)')
ON CONFLICT ("key") DO NOTHING;
