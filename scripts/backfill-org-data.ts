/**
 * Backfill script: Populate organization_id on all existing data rows.
 *
 * For each table that has both user_id and organization_id, sets organization_id
 * by looking up the user's org membership (preferring owner role).
 *
 * Idempotent — only updates rows where organization_id IS NULL.
 *
 * Usage:
 *   npx tsx scripts/backfill-org-data.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/freelance_crm";

// All tables with both user_id and organization_id columns (SQL table names)
const TABLES = [
  "clients",
  "projects",
  "time_entries",
  "invoices",
  "prepaid_packages",
  "tasks",
  "task_statuses",
  "tags",
  "recurring_time_templates",
  "rate_history",
  "timer_templates",
  "invoice_templates",
  "report_templates",
  "email_preferences",
  "email_templates",
  "activity_logs",
  "integration_sync_logs",
  "calendar_connections",
  "calendar_events",
  "imports",
  "extension_tokens",
  "timer_states",
  "api_keys",
  "subscriptions",
  "dashboard_preferences",
  "notification_channels",
  "prepaid_templates",
  "data_export_requests",
  "time_approval_requests",
  "trusted_devices",
  "push_subscriptions",
  "ai_processing_logs",
  "email_integrations",
  "calendar_matching_rules",
  "company_profiles",
  "onboarding_progress",
  "payment_methods",
  "dinero_oauth_pending",
  "support_tickets",
];

async function main() {
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    console.log("🔍 Building user → org mapping (preferring owner role)...");

    // Build a mapping of user_id → organization_id using a ranked approach:
    // 1. Pick memberships with role = 'owner' first
    // 2. Fall back to any membership
    // This is done per-UPDATE using a subquery so it handles users with
    // multiple memberships correctly.

    let totalUpdated = 0;

    for (const table of TABLES) {
      try {
        // Check if table exists and has the organization_id column
        const colCheck = await db.execute(sql`
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ${table}
            AND column_name = 'organization_id'
          LIMIT 1
        `);

        if ((colCheck as unknown[]).length === 0) {
          console.log(`  ⏭️  ${table} — no organization_id column, skipping`);
          continue;
        }

        // Count rows needing backfill
        const countResult = await db.execute(
          sql.raw(
            `SELECT COUNT(*) as cnt FROM "${table}" WHERE organization_id IS NULL AND user_id IS NOT NULL`,
          ),
        );
        const count = Number((countResult[0] as { cnt: string })?.cnt || "0");

        if (count === 0) {
          console.log(`  ✅ ${table} — already fully populated`);
          continue;
        }

        // Update using a lateral subquery that picks owner membership first,
        // then falls back to any membership
        await db.execute(
          sql.raw(`
            UPDATE "${table}" t
            SET organization_id = m.organization_id
            FROM (
              SELECT DISTINCT ON (sub.user_id) sub.user_id, sub.organization_id
              FROM members sub
              ORDER BY sub.user_id, CASE WHEN sub.role = 'owner' THEN 0 ELSE 1 END, sub.created_at ASC
            ) m
            WHERE t.user_id = m.user_id
              AND t.organization_id IS NULL
          `),
        );

        totalUpdated += count;
        console.log(`  ✓ ${table}: backfilled`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Skip gracefully if table doesn't exist
        if (msg.includes("does not exist") || msg.includes("relation")) {
          console.log(`  ⏭️  ${table} — table not found, skipping`);
        } else {
          console.error(`  ❌ ${table} — error: ${msg}`);
        }
      }
    }

    console.log("");
    console.log(
      `📊 Done: backfilled organization_id across ${TABLES.length} tables.`,
    );
    console.log(`   Total rows needing update: ${totalUpdated}`);
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
