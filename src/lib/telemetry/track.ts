import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { productEvents } from "@/lib/db/schema";

// Produkt-telemetri (#150): server-side forretningshændelser — ikke
// klik-tracking. Fire-and-forget: må ALDRIG blokere eller fejle den
// mutation der udløser eventen.

export type ProductEvent =
  | "client.created"
  | "time_entry.created"
  | "invoice.created"
  | "invoice.sent"
  | "prepaid.created"
  | "prepaid.bulk_assigned"
  | "prepaid.renewal_requested"
  | "prepaid.renewal_approved"
  | "report.exported"
  | "report.share_created"
  | "report.schedule_created"
  | "portal.access_created"
  | "integration.connected"
  | "week.closed"
  // Kontekstuelle nudges (#89/#90) — metadata: { nudge, surface, clientId }
  | "nudge.shown"
  | "nudge.clicked"
  | "nudge.dismissed"
  // Aktivering (#91): første tidspost nogensinde, med minutter fra signup
  | "activation.first_time_entry";

export type ProductEventSource = "web" | "extension" | "desktop" | "api";

export function trackEvent(params: {
  userId: string;
  orgId?: string | null;
  event: ProductEvent;
  source?: ProductEventSource;
  metadata?: Record<string, unknown>;
}): void {
  db.insert(productEvents)
    .values({
      userId: params.userId,
      organizationId: params.orgId ?? null,
      event: params.event,
      source: params.source ?? "web",
      metadata: params.metadata ?? null,
    })
    .catch((err) => {
      console.error(
        `[Telemetry] ${params.event} kunne ikke gemmes:`,
        err instanceof Error ? err.message : err,
      );
    });

  if (params.event === "time_entry.created") {
    trackFirstTimeEntry(params.userId, params.orgId ?? null, params.source);
  }
}

/**
 * Aktiveringsmåling (#91): "nået første tidspost" + tid fra signup.
 * Ét INSERT … SELECT … WHERE NOT EXISTS, så eventen kun skrives én gang pr.
 * bruger (fire-and-forget som resten af telemetrien). Kun når brugerens
 * ældste tidspost er helt ny — ellers ville første post efter release blive
 * talt som "første" for brugere, der allerede havde tid. Måles fx med:
 *   SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY
 *     (metadata->>'minutesSinceSignup')::int)
 *   FROM product_events WHERE event = 'activation.first_time_entry';
 */
function trackFirstTimeEntry(
  userId: string,
  orgId: string | null,
  source: ProductEventSource = "web",
): void {
  db.execute(sql`
    INSERT INTO product_events (user_id, organization_id, event, source, metadata)
    SELECT u.id, ${orgId}, 'activation.first_time_entry', ${source},
      jsonb_build_object(
        'minutesSinceSignup',
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (first.at - u."createdAt")) / 60))::int
      )
    FROM "user" u
    CROSS JOIN LATERAL (
      SELECT min(te.created_at) AS at FROM time_entries te WHERE te.user_id = u.id
    ) first
    WHERE u.id = ${userId}
      AND first.at > now() - interval '10 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM product_events pe
        WHERE pe.user_id = ${userId}
          AND pe.event = 'activation.first_time_entry'
      )
  `).catch((err) => {
    console.error(
      "[Telemetry] activation.first_time_entry kunne ikke gemmes:",
      err instanceof Error ? err.message : err,
    );
  });
}
