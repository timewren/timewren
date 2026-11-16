-- Intern klient (#541): nye tidsposter uden eksplicit isBillable arver
-- klientens default. Eksisterende poster røres ikke. Idempotent
-- (IF NOT EXISTS) — se migrationskæde-incident.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "default_billable" boolean DEFAULT true NOT NULL;
