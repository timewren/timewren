import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { claimWebhookEvent } from "@/lib/billing/webhook-claim";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/schema";

export async function claimAccountingDelivery(
  source: "billy" | "dinero",
  eventType: string,
  signedBody: string,
) {
  // Both envelopes lack a delivery ID. Hash the body verified by the route
  // so byte-identical deliveries share a claim without storing invoice data.
  const eventId = `${source}:${createHash("sha256").update(signedBody).digest("hex")}`;
  const claimedAt = new Date();
  if (
    !(await claimWebhookEvent(
      db,
      { id: eventId, type: eventType, source },
      claimedAt,
    ))
  ) {
    return null;
  }

  return async (status: "success" | "error") => {
    await db
      .update(webhookEvents)
      .set({ status })
      .where(
        and(
          eq(webhookEvents.eventId, eventId),
          eq(webhookEvents.status, "processing"),
          eq(webhookEvents.processedAt, claimedAt),
        ),
      );
  };
}
