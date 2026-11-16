-- Indeks til varme opslag (#1115), rent additivt og idempotent.
--
-- members.user_id: aktiv-org-opløsningen slår brugerens medlemskab op på
-- user_id alene ved hvert request; det eneste indeks var (organization_id,
-- user_id), som ikke kan bruges uden organization_id.
-- notification_channels.user_id: cron-løkkerne filtrerer kanaler pr. bruger,
-- og tabellen havde intet indeks ud over primærnøglen.
--
-- Ikke CONCURRENTLY: drizzles migrate() kører alle ventende migrationer i én
-- transaktion (drizzle-orm pg-core/dialect.js), og Postgres afviser CREATE
-- INDEX CONCURRENTLY i en transaktion, så hele deployet ville fejle. Begge
-- tabeller har én række pr. medlemskab/kanal, så byggeriet holder kun
-- skrivelåsen kortvarigt.
CREATE INDEX IF NOT EXISTS "members_user_id_idx" ON "members" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_channels_user_id_idx" ON "notification_channels" ("user_id");
