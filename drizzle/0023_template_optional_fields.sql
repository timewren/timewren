-- Add clientId column to recurring_time_templates
ALTER TABLE "recurring_time_templates" ADD COLUMN IF NOT EXISTS "client_id" UUID REFERENCES "clients"("id");

-- Make projectId nullable (drop NOT NULL)
ALTER TABLE "recurring_time_templates" ALTER COLUMN "project_id" DROP NOT NULL;

-- Make frequency nullable (null = simple template, not recurring)
ALTER TABLE "recurring_time_templates" ALTER COLUMN "frequency" DROP NOT NULL;

-- Make start_date nullable
ALTER TABLE "recurring_time_templates" ALTER COLUMN "start_date" DROP NOT NULL;

-- Make next_due nullable
ALTER TABLE "recurring_time_templates" ALTER COLUMN "next_due" DROP NOT NULL;
