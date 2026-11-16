ALTER TABLE "feedback_submissions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD COLUMN "install_id" varchar(64);--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD COLUMN "contact_email" varchar(255);