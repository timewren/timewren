import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { emailSyncQueue } from "@/lib/db/schema";

type Db = typeof dbType;

/** Et sync-job har ikke brug for over en time; ældre `processing`-jobs hænger. */
export const STALE_PROCESSING_AFTER_MS = 60 * 60 * 1000;

/**
 * Markerer jobs, der har stået i `processing` i over en time, som `failed`.
 *
 * Planlæggeren springer en bruger over, så længe der findes et job i
 * `pending` eller `processing`. Et job, hvis proces døde midt i en sync
 * (genstart, timeout), blev aldrig ryddet op og blokerede derfor al fremtidig
 * sync for brugeren. Jobbet sættes til `failed` (ikke tilbage til `pending`),
 * så en sync, der fejlede af en grund, ikke kører i ring.
 */
export async function failStaleProcessingJobs(
  db: Db,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_PROCESSING_AFTER_MS);

  const stale = await db
    .update(emailSyncQueue)
    .set({
      status: "failed",
      errorMessage: "Afbrudt: jobbet stod i 'processing' i over 1 time",
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailSyncQueue.status, "processing"),
        // startedAt sættes når jobbet tages; updatedAt er fallback for rækker
        // uden startedAt.
        or(
          lte(emailSyncQueue.startedAt, cutoff),
          and(
            isNull(emailSyncQueue.startedAt),
            lte(emailSyncQueue.updatedAt, cutoff),
          ),
        ),
      ),
    )
    .returning({ id: emailSyncQueue.id });

  if (stale.length > 0) {
    console.warn(
      `[EmailSync] ${stale.length} hængende job(s) i 'processing' markeret som failed`,
    );
  }
  return stale.length;
}
