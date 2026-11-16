-- Server-udstedte timer-sessioner, fase 1 (docs/architecture/timer-sessions.md).
-- Rent additiv og uden backfill: en kørende timer får sit sessionId dovent
-- ved sin næste skrivning. Ingen FK fra timer_states/time_entries til
-- timer_sessions — sessionen er identitet og log, ikke en afhængighed.
CREATE TABLE IF NOT EXISTS "timer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"status" varchar(12) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"project_id" uuid,
	"client_id" uuid,
	"task_id" uuid,
	"description" text DEFAULT '',
	"version" integer DEFAULT 1 NOT NULL,
	"saved_entry_id" uuid,
	"continues_entry_id" uuid,
	"start_op_id" varchar(36),
	"source" varchar(16),
	"client_hint" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timer_sessions" ADD CONSTRAINT "timer_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "timer_sessions_user_active_uq" ON "timer_sessions" USING btree ("user_id") WHERE "timer_sessions"."status" IN ('running', 'paused', 'stopping');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timer_sessions_user_created_idx" ON "timer_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "timer_sessions_user_start_op_uq" ON "timer_sessions" USING btree ("user_id","start_op_id") WHERE "timer_sessions"."start_op_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "timer_states" ADD COLUMN IF NOT EXISTS "current_session_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "timer_session_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_entries_timer_session_id_uq" ON "time_entries" USING btree ("timer_session_id") WHERE "time_entries"."timer_session_id" IS NOT NULL;
