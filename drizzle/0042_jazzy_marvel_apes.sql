CREATE TABLE "desktop_device" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_name" varchar(255),
	"machine_id" varchar(255) NOT NULL,
	"os" varchar(50),
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_license" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"license_key" varchar(50) NOT NULL,
	"tier" varchar(20) NOT NULL,
	"max_devices" integer DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "desktop_license_license_key_unique" UNIQUE("license_key")
);
--> statement-breakpoint
CREATE TABLE "desktop_sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" text NOT NULL,
	"action" varchar(20) NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_device" ADD CONSTRAINT "desktop_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_license" ADD CONSTRAINT "desktop_license_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sync_log" ADD CONSTRAINT "desktop_sync_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sync_log" ADD CONSTRAINT "desktop_sync_log_device_id_desktop_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."desktop_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desktop_devices_user_id_idx" ON "desktop_device" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "desktop_devices_machine_id_idx" ON "desktop_device" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "desktop_licenses_user_id_idx" ON "desktop_license" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "desktop_licenses_key_idx" ON "desktop_license" USING btree ("license_key");--> statement-breakpoint
CREATE INDEX "desktop_sync_log_user_id_idx" ON "desktop_sync_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "desktop_sync_log_device_id_idx" ON "desktop_sync_log" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "desktop_sync_log_entity_idx" ON "desktop_sync_log" USING btree ("entity_type","entity_id");