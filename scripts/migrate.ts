import * as dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Load .env.local in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/freelance_crm";

async function main() {
  console.log("🔄 Running database migrations...");

  const migrationClient = postgres(databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✅ Migrations completed successfully");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

main();
