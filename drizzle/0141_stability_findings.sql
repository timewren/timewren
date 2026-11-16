-- Stabilitetsvagten: fund fra cron'en stability-watch (hvert 15. min).
-- Rent additiv: ny tabel + ét nyt indeks på time_entries(created_at), så
-- vagtens "poster oprettet i vinduet" ikke seq-scanner hele tabellen.
-- Ingen FK til user/organization: fundet skal overleve sletninger.
CREATE TABLE IF NOT EXISTS "stability_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"detector" varchar(40) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"fingerprint" varchar(200) NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"user_id" text,
	"organization_id" text,
	"title" text NOT NULL,
	"first_seen" timestamp NOT NULL,
	"last_seen" timestamp NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"sample" jsonb,
	"last_alerted_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolution_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stability_findings_open_fingerprint_uq" ON "stability_findings" USING btree ("fingerprint") WHERE "stability_findings"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stability_findings_status_idx" ON "stability_findings" USING btree ("status","last_seen");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stability_findings_detector_first_seen_idx" ON "stability_findings" USING btree ("detector","first_seen");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_created_at_idx" ON "time_entries" USING btree ("created_at");
