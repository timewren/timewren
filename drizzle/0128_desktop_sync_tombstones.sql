CREATE TABLE "desktop_sync_tombstones" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"deleted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_sync_tombstones" ADD CONSTRAINT "desktop_sync_tombstones_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sync_tombstones" ADD CONSTRAINT "desktop_sync_tombstones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desktop_sync_tombstones_user_deleted_idx" ON "desktop_sync_tombstones" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "desktop_sync_tombstones_org_deleted_idx" ON "desktop_sync_tombstones" USING btree ("organization_id","deleted_at");