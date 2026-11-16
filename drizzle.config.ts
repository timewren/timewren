import * as dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local in development, use environment variables in production
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL || "postgresql://localhost:5432/freelance_crm",
  },
});
