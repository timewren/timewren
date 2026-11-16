// src/lib/reports/seed.ts
import { sql } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import { reportTemplates } from "@/lib/db/schema";
import { SYSTEM_TEMPLATES } from "./defaults";

type Db = typeof defaultDb;

/**
 * Seed system report templates for every user. Idempotent — re-running
 * with the same templates updates `config` on existing rows and leaves
 * user-customized rows untouched (matched by `(user_id, name)` where
 * `is_system=true`).
 */
export async function seedSystemReportTemplates(db: Db): Promise<void> {
  const allUsers = await db.query.users.findMany({ columns: { id: true } });
  if (allUsers.length === 0) return;

  const now = new Date();
  const rows = allUsers.flatMap((u) =>
    SYSTEM_TEMPLATES.map((t, idx) => ({
      userId: u.id,
      name: t.name,
      description: t.description,
      config: t.config,
      isDefault: idx === 0,
      isSystem: true,
      updatedAt: now,
    })),
  );

  await db
    .insert(reportTemplates)
    .values(rows)
    .onConflictDoUpdate({
      target: [reportTemplates.userId, reportTemplates.name],
      set: {
        config: sql`excluded.config`,
        description: sql`excluded.description`,
        isSystem: sql`true`,
        updatedAt: now,
      },
    });
}
