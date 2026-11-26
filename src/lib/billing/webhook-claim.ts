import { and, eq, lt, or } from "drizzle-orm";
import type { db as DbHandle } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";

type Db = typeof DbHandle;

/** En 'processing'-række ældre end dette regnes som en død handler. */
export const CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * Et krav før behandling udelukker to samtidige leveringer af samme event. Kravet lykkes
 * for et nyt event, et event der fejlede, og et krav fra en handler, der er
 * død (en 'processing'-række ældre end CLAIM_STALE_MS). Bruges af Stripe og
 * de signerede Billy/Dinero-leveringer.
 */
export async function claimWebhookEvent(
  db: Db,
  event: { id: string; type: string; source?: "stripe" | "billy" | "dinero" },
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .insert(webhookEvents)
    .values({
      eventId: event.id,
      source: event.source ?? "stripe",
      eventType: event.type,
      status: "processing",
      processedAt: now,
    })
    .onConflictDoUpdate({
      target: webhookEvents.eventId,
      set: {
        status: "processing",
        errorMessage: null,
        processedAt: now,
      },
      setWhere: or(
        eq(webhookEvents.status, "error"),
        and(
          eq(webhookEvents.status, "processing"),
          lt(
            webhookEvents.processedAt,
            new Date(now.getTime() - CLAIM_STALE_MS),
          ),
        ),
      ),
    })
    .returning({ id: webhookEvents.id });
  return rows.length > 0;
}
