CREATE TABLE "marketing_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"tool" varchar(100) NOT NULL,
	"payload" jsonb,
	"consent_text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_leads_email_tool_idx" ON "marketing_leads" USING btree ("email","tool");