-- Fakturerbarhed pr. aktivitetstype (#704): valgfri standard for nye
-- tidsposter med aktiviteten. NULL = arv (uændret adfærd for eksisterende
-- typer). Nullable og uden default, så migrationen er additiv. Idempotent.
ALTER TABLE "activity_types" ADD COLUMN IF NOT EXISTS "default_billable" boolean;
