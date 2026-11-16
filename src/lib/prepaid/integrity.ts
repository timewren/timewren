import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function countPrepaidIntegrityOrphans(): Promise<number> {
  const [orphanRow] = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM time_entries te
    WHERE te.is_prepaid = true
      AND NOT EXISTS (
        SELECT 1 FROM prepaid_usage pu WHERE pu.time_entry_id = te.id
      )
  `);
  return Number((orphanRow as { count?: number })?.count ?? 0);
}
