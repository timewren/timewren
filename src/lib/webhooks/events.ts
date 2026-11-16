import type { WebhookEventType } from "@/lib/db/schema";
import { triggerWebhooks } from "./delivery";

interface WebhookEventParams {
  userId: string;
  orgId?: string | null;
  eventType: WebhookEventType;
  /** Primary entity id (time entry, invoice, client, ...) */
  eventId: string | null;
  data: Record<string, unknown>;
  /** Optional filters — webhooks can be scoped to a client/project */
  clientId?: string | null;
  projectId?: string | null;
}

/**
 * Fire-and-forget webhook emission for mutation sites.
 *
 * Call WITHOUT awaiting after the mutation has succeeded — delivery happens in
 * the background (sequential fetches with per-webhook timeout) and must never
 * block or fail the request that caused the event. Errors are logged only.
 */
export function emitWebhookEvent(params: WebhookEventParams): void {
  triggerWebhooks(
    params.userId,
    params.eventType,
    params.eventId,
    params.data,
    {
      clientId: params.clientId ?? undefined,
      projectId: params.projectId ?? undefined,
    },
    params.orgId ?? null,
  ).catch((err) => {
    console.error(
      `[Webhooks] Delivery failed for ${params.eventType}:`,
      err instanceof Error ? err.message : err,
    );
  });
}
