-- Kalender-OAuth pr. brand (docs/specs/timewren-cloud.md → 5, "Kalender"):
-- hvilket brands OAuth-klient (Google/Outlook) der udstedte en forbindelses
-- tokens, så refresh, synk og webhooks bruger samme klient.
--
-- Rent additivt: én ny kolonne med default 'timetrack'. Alle eksisterende
-- forbindelser er oprettet med TimeTracks Google-klient (TimeWren-konti kunne
-- ikke forbinde Google), så default er korrekt for dem uden backfill. INSERT'er
-- der ikke kender kolonnen er uændrede. Idempotent.
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "oauth_brand" varchar(20) DEFAULT 'timetrack' NOT NULL;
