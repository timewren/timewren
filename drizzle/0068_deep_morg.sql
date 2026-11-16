CREATE TABLE IF NOT EXISTS "prepaid_renewal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prepaid_package_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"freelancer_id" text NOT NULL,
	"organization_id" text,
	"portal_access_id" uuid,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"message" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_renewal_requests_prepaid_package_id_prepaid_packages_id_fk') THEN
    ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_prepaid_package_id_prepaid_packages_id_fk" FOREIGN KEY ("prepaid_package_id") REFERENCES "public"."prepaid_packages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_renewal_requests_client_id_clients_id_fk') THEN
    ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_renewal_requests_freelancer_id_user_id_fk') THEN
    ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_freelancer_id_user_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_renewal_requests_organization_id_organizations_id_fk') THEN
    ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_renewal_requests_portal_access_id_client_portal_access_id_fk') THEN
    ALTER TABLE "prepaid_renewal_requests" ADD CONSTRAINT "prepaid_renewal_requests_portal_access_id_client_portal_access_id_fk" FOREIGN KEY ("portal_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepaid_renewal_requests_package_idx" ON "prepaid_renewal_requests" USING btree ("prepaid_package_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepaid_renewal_requests_freelancer_idx" ON "prepaid_renewal_requests" USING btree ("freelancer_id","status");