-- Offline-kø (#703): idempotensnøgle for en køet timerstart. Klienten sender
-- et UUID pr. operation; serveren gemmer det på rækken, så en afspilning af
-- samme start (svaret gik tabt) genkendes og ikke skriver igen. Nullable og
-- uden default — eksisterende rækker er uændrede. Idempotent.
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "last_client_op_id" varchar(36);
