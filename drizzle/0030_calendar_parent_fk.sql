DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'calendar_connections_parent_connection_id_fkey'
  ) THEN
    ALTER TABLE "calendar_connections"
      ADD CONSTRAINT "calendar_connections_parent_connection_id_fkey"
      FOREIGN KEY ("parent_connection_id")
      REFERENCES "calendar_connections"("id")
      ON DELETE CASCADE;
  END IF;
END $$;
