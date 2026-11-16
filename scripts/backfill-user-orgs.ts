/**
 * Backfill script: Create personal workspace orgs for users without any org membership.
 *
 * Idempotent — safe to run multiple times. Only creates orgs for users
 * who have no existing membership in any organization.
 *
 * Usage:
 *   npx tsx scripts/backfill-user-orgs.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/freelance_crm";

async function main() {
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    console.log("🔍 Finding users without any org membership...");

    // Find all users who don't have any membership
    const usersWithoutOrg = await db.execute(sql`
      SELECT u.id, u.name, u.email
      FROM "user" u
      LEFT JOIN members m ON m."user_id" = u.id
      WHERE m.id IS NULL
    `);

    const users = usersWithoutOrg as unknown as Array<{
      id: string;
      name: string;
      email: string;
    }>;

    if (users.length === 0) {
      console.log(
        "✅ All users already have an org membership. Nothing to do.",
      );
      return;
    }

    console.log(`📋 Found ${users.length} users without org membership.`);

    let created = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        // Generate slug from name or email
        const baseSlug = (user.name || user.email.split("@")[0])
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48);

        let slug = baseSlug || "workspace";
        let suffix = 0;

        // Handle slug conflicts by appending -1, -2, etc.
        while (true) {
          const existing = await db.execute(
            sql`SELECT id FROM organizations WHERE slug = ${slug} LIMIT 1`,
          );
          if ((existing as unknown[]).length === 0) break;
          suffix++;
          slug = `${baseSlug}-${suffix}`;
          if (suffix > 99) {
            // Fallback: use random suffix
            slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
            break;
          }
        }

        const orgId = crypto.randomUUID();
        const memberId = crypto.randomUUID();
        const displayName =
          user.name || user.email.split("@")[0] || "Workspace";

        // Wrap org + membership + modules in a transaction
        await db.execute(sql`BEGIN`);
        try {
          // Create org
          await db.execute(sql`
            INSERT INTO organizations (id, name, slug, metadata, created_at)
            VALUES (
              ${orgId},
              ${`${displayName}'s workspace`},
              ${slug},
              '{"type":"freelance"}'::jsonb,
              now()
            )
          `);

          // Create owner membership
          await db.execute(sql`
            INSERT INTO members (id, organization_id, user_id, role, created_at)
            VALUES (
              ${memberId},
              ${orgId},
              ${user.id},
              'owner',
              now()
            )
          `);

          // Seed FREELANCE_BUNDLE modules
          const freelanceModules = [
            "projects",
            "reports",
            "clients",
            "invoicing",
            "klippekort",
            "integrations",
            "tasks",
            "public_api",
            "browser_extension",
          ];

          for (const moduleKey of freelanceModules) {
            await db.execute(sql`
              INSERT INTO organization_modules (id, organization_id, module_key, is_available, is_enabled, available_at, enabled_at, updated_at)
              VALUES (
                ${crypto.randomUUID()},
                ${orgId},
                ${moduleKey},
                true,
                true,
                now(),
                now(),
                now()
              )
              ON CONFLICT (organization_id, module_key) DO NOTHING
            `);
          }

          await db.execute(sql`COMMIT`);
        } catch (txError) {
          await db.execute(sql`ROLLBACK`);
          throw txError;
        }

        created++;
        console.log(
          `  ✅ Created org for ${user.email} (slug: ${slug}, orgId: ${orgId})`,
        );
      } catch (error) {
        skipped++;
        console.error(
          `  ❌ Failed for ${user.email}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log("");
    console.log(`📊 Done: ${created} orgs created, ${skipped} skipped/failed.`);
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
