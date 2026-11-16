CREATE TABLE "invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"payment_terms_days" integer DEFAULT 14,
	"vat_rate" numeric(5, 2) DEFAULT '25.00',
	"currency" varchar(10) DEFAULT 'DKK',
	"header_text" text,
	"footer_text" text,
	"terms_text" text,
	"bank_name" varchar(255),
	"bank_account" varchar(50),
	"bank_reg_number" varchar(20),
	"logo_url" text,
	"primary_color" varchar(20) DEFAULT '#3b82f6',
	"is_default" boolean DEFAULT false,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weekly_hour_goal" numeric(4, 1) DEFAULT '37.0';--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;