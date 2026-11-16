import { and, eq, lt, sql } from "drizzle-orm";
import type { db as Db } from "@/lib/db";
import { imports } from "@/lib/db/schema";

/**
 * Statusser hvor en import er i gang. Cron-importen sætter rækken til
 * "processing", mens den arbejder, så den status tæller også som aktiv.
 */
export const ACTIVE_IMPORT_STATUSES = [
  "pending",
  "previewing",
  "running",
  "processing",
] as const;

/** Statusser hvor brugeren kan annullere importen. */
export const CANCELLABLE_IMPORT_STATUSES = [
  "preview_ready",
  "previewing",
  "running",
  "processing",
] as const;

/**
 * Cron-importen skriver fremskridt (og updatedAt) for hver side. En række
 * der har stået i "processing" uden fremskridt så længe, er forladt, typisk
 * fordi appen blev redeployet midt i kørslen.
 */
export const STALE_PROCESSING_MS = 30 * 60 * 1000;

/**
 * Markerer forladte "processing"-imports som failed. De sættes bevidst ikke
 * tilbage til "running": en ny kørsel starter forfra og ville oprette
 * kunder og projekter med "create_new" igen, altså dubletter.
 * Returnerer antallet af rækker der blev markeret.
 */
export async function failStaleProcessingImports(
  database: typeof Db,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_PROCESSING_MS);
  const error = JSON.stringify([
    {
      resource: "entry",
      message:
        "Importen blev afbrudt (ingen fremskridt i 30 min). Tjek de importerede data, og start en ny import for resten.",
      timestamp: now.toISOString(),
    },
  ]);
  const rows = await database
    .update(imports)
    .set({
      status: "failed",
      errors: sql`coalesce(${imports.errors}, '[]'::jsonb) || ${error}::jsonb`,
      completedAt: now,
      credentials: null,
      updatedAt: now,
    })
    .where(and(eq(imports.status, "processing"), lt(imports.updatedAt, cutoff)))
    .returning({ id: imports.id });
  return rows.length;
}
