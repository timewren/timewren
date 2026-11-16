import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Load .env.local in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/freelance_crm";

async function main() {
  console.log("⚠️  WARNING: This will DROP ALL TABLES in the database!");
  console.log("Database:", databaseUrl.replace(/:[^:@]+@/, ":****@"));

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    // Drop all tables
    console.log("🗑️  Dropping all tables...");

    await db.execute(sql`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    console.log("✅ All tables dropped successfully");
    console.log("ℹ️  Run 'npm run db:migrate' to recreate tables");
  } catch (error) {
    console.error("❌ Reset failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
