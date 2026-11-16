ALTER TABLE "client_portal_access" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: inherit each portal access's org from its client so existing team
-- portal accesses become visible/manageable org-wide (not just to the creator).
UPDATE "client_portal_access" AS cpa
SET "organization_id" = c."organization_id"
FROM "clients" AS c
WHERE cpa."client_id" = c."id" AND c."organization_id" IS NOT NULL;
