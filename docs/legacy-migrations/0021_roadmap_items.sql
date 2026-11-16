-- Roadmap Items table for public product roadmap
CREATE TABLE IF NOT EXISTS "roadmap_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "title" varchar(255) NOT NULL,
    "description" text,
    "status" varchar(20) NOT NULL DEFAULT 'planned',
    "category" varchar(50),
    "priority" integer NOT NULL DEFAULT 0,
    "completed_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Index for efficient querying by status
CREATE INDEX IF NOT EXISTS "roadmap_items_status_idx" ON "roadmap_items" ("status");
