CREATE TABLE "desktop_analytics" (
	"id" text PRIMARY KEY NOT NULL,
	"event" varchar(100) NOT NULL,
	"properties" jsonb,
	"app_version" varchar(20),
	"platform" varchar(50),
	"language" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_trial" (
	"id" text PRIMARY KEY NOT NULL,
	"machine_id" varchar(255) NOT NULL,
	"os" varchar(50),
	"started_at" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_trial_machine_id_unique" UNIQUE("machine_id")
);
--> statement-breakpoint
CREATE TABLE "desktop_waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "desktop_analytics_event_idx" ON "desktop_analytics" USING btree ("event");--> statement-breakpoint
CREATE INDEX "desktop_analytics_created_at_idx" ON "desktop_analytics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "desktop_trials_machine_id_idx" ON "desktop_trial" USING btree ("machine_id");