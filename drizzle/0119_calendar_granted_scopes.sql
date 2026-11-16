-- #678: Google-kalender er read-only som standard. Gem hvilke OAuth-scopes
-- tokenet faktisk har, så skrivende handlinger kan afvises med en forklaring
-- i stedet for en 403 fra Google. NULL = forbindelse oprettet før denne
-- ændring (fik altid calendar.events) og behandles som læse og skrive.
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "granted_scopes" text;
