import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { alunta, resolveAluntaPlanTier } from "@/lib/alunta";
import { resolvePrimaryOrgId } from "@/lib/auth/active-org";
import { isAluntaEnabled } from "@/lib/billing/billing-enabled";
import {
  campaignDiscountEndForPayment,
  findCampaignCode,
} from "@/lib/billing/campaign-codes";
import {
  formatDuplicateReason,
  isPossibleDuplicateEvent,
  WEBHOOK_STATUS_NEEDS_REVIEW,
} from "@/lib/billing/duplicate-subscriptions";
import {
  type AluntaSubSummary,
  baseCheckoutRelinkDecision,
  cancelSubscriptionsSafely,
  findObsoleteSeatsSubs,
  findObsoleteSubsOnUpgrade,
  isLiveAluntaStatus,
  parseReplacesUuids,
  resolveBaseEventSeatCount,
} from "@/lib/billing/seats";
import {
  clampSeats,
  FOUNDING_MEMBER,
  getAppUrl,
  includedSeatsForTier,
  isAluntaSeatsPlan,
  maxSeatsForTier,
  resolveAluntaSeatCount,
} from "@/lib/config";
import { db } from "@/lib/db";
import { members, subscriptions, users, webhookEvents } from "@/lib/db/schema";
import {
  sendPaymentFailedEmail,
  sendTrialEndingEmail,
} from "@/lib/email/billing";
import { toLocalDateStr } from "@/lib/format";
import { grantEnterpriseForTierSafe } from "@/lib/modules/plan-grants";
import { notifyAdmin } from "@/lib/notifications/admin";
import { storeProviderLabel } from "@/lib/store-billing/products";
import { isStoreManaged } from "@/lib/store-billing/state";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { captureRouteError } from "@/lib/utils/sentry";

// ── Types matching Alunta's actual payload structure ─────────────────

interface AluntaWebhookPayload {
  event: string;
  test_mode: boolean;
  timestamp: string;
  data: {
    plan?: {
      name: string;
      slug: string;
      uuid: string;
    };
    team?: {
      slug: string;
    };
    customer?: {
      uuid: string;
      name: string;
      email: string;
      phone?: string;
      address?: string;
      zip?: string;
      city?: string;
      country?: string;
      reg_number?: string;
      customer_type?: string;
      created_at?: string;
    };
    subscription?: {
      uuid: string;
      status: string;
      currency?: string;
      interval?: number;
      /** Seat/unit count for per-seat plans. */
      quantity?: number;
      metadata?: Record<string, unknown> | null;
      start_date?: string;
      end_date?: string | null;
      current_period_end?: string | null;
      end_reason?: string | null;
      standard_price?: number;
      trial?: {
        start_date: string;
        end_date: string;
        is_active: boolean;
      } | null;
      plan?: {
        name: string;
        uuid: string;
      };
      customer?: {
        name: string;
        uuid: string;
      };
    };
    external_customer_id?: string;
    // Invoice events
    invoice?: {
      uuid: string;
      status: string;
      amount_due?: number;
      subscription_uuid?: string;
    };
    [key: string]: unknown;
  };
}

/**
 * Handlere returnerer normalt intet. `needsReview` betyder: eventet er
 * behandlet uden fejl, men et menneske skal kigge (fx muligt dobbelt-
 * abonnement) — POST'en gemmer det som status 'needs_review' så det kan
 * findes i admin/webhooks i stedet for at drukne som 'success'.
 */
type HandlerOutcome = { needsReview: string } | undefined;

/**
 * Rækken faktureres af App Store/Google Play (køb i appen). Et Alunta-event
 * må aldrig ændre dens status, tier eller periode — så ville et gammelt
 * web-abonnement kunne nedgradere eller opsige det betalte butiksabonnement.
 * Et Alunta-event her betyder muligvis, at kunden betaler to steder, så det
 * gemmes som needs_review til et menneske.
 */
function storeManagedReview(
  sub: { id: string; storeProvider: string | null },
  eventType: string,
  eventSubUuid: string | null | undefined,
): HandlerOutcome {
  const note = `Rækken ${sub.id} faktureres via ${storeProviderLabel(sub.storeProvider)} (køb i appen): Alunta-event ${eventType} for sub ${eventSubUuid ?? "n/a"} er ikke anvendt. Tjek for dobbelt-abonnement.`;
  console.warn(`[Alunta Webhook] ${note}`);
  return { needsReview: note };
}

function verifyAluntaSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

// Throttle admin alerts for rejected requests — the endpoint is public, so a
// flood of unsigned requests must not spam (or rate-limit-exhaust) the shared
// admin Discord webhook. Rejections themselves are still logged per request.
const REJECT_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
let lastRejectAlertAt = 0;

function notifyWebhookRejected(reason: string) {
  const now = Date.now();
  if (now - lastRejectAlertAt < REJECT_ALERT_COOLDOWN_MS) return;
  lastRejectAlertAt = now;
  void notifyAdmin("webhook_rejected", { reason });
}

export async function POST(request: Request) {
  try {
    const body = await request.text();

    // Verify signature — Alunta uses "Signature" header with HMAC-SHA256.
    // Policy (fail closed, #1103):
    //   - Alunta not enabled (no ALUNTA_API_KEY) → 404, nothing is processed.
    //   - No secret configured  → 503, nothing is processed. This is the
    //     billing webhook — forged events could grant free access or cancel
    //     paying customers.
    //   - Secret configured     → requests with a missing OR invalid
    //     signature are rejected with 401.
    //   - ALUNTA_WEBHOOK_ALLOW_UNSIGNED=1 → explicit dev-only opt-out that
    //     accepts a missing signature with a loud warning. Ignored when
    //     NODE_ENV=production.
    if (!isAluntaEnabled()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const signature = request.headers.get("Signature");
    const webhookSecret = process.env.ALUNTA_WEBHOOK_SECRET;
    const allowUnsigned =
      process.env.NODE_ENV !== "production" &&
      (process.env.ALUNTA_WEBHOOK_ALLOW_UNSIGNED === "1" ||
        process.env.ALUNTA_WEBHOOK_ALLOW_UNSIGNED === "true");

    if (!webhookSecret) {
      console.error(
        "[Alunta Webhook] ALUNTA_WEBHOOK_SECRET not configured — rejecting (fail closed)",
      );
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 503 },
      );
    } else if (!signature) {
      if (!allowUnsigned) {
        console.error(
          "[Alunta Webhook] Missing Signature header — rejecting (fail closed)",
        );
        notifyWebhookRejected(
          "Alunta: usigneret request afvist (manglende Signature-header)",
        );
        return NextResponse.json(
          { error: "Missing signature" },
          { status: 401 },
        );
      }
      console.warn(
        "[Alunta Webhook] No Signature header — accepted because ALUNTA_WEBHOOK_ALLOW_UNSIGNED is set (dev only, never use in prod)",
      );
    } else if (!verifyAluntaSignature(body, signature, webhookSecret)) {
      console.error("[Alunta Webhook] Signature verification failed");
      notifyWebhookRejected("Alunta: request med ugyldig signatur afvist");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: AluntaWebhookPayload = JSON.parse(body);
    const eventType = payload.event;

    // Replay-window guard (defense-in-depth alongside signature + idempotency
    // key). Events more than 30 minutes old or 2 minutes in the future get
    // logged and acknowledged with 200 — we do NOT want Alunta to stop
    // retrying a legitimately-delayed event. The idempotency key prevents
    // double-processing of replays that make it through this window.
    const ts = Date.parse(payload.timestamp);
    if (Number.isFinite(ts)) {
      const skewMs = Date.now() - ts;
      if (skewMs > 30 * 60 * 1000 || skewMs < -2 * 60 * 1000) {
        console.warn(
          `[Alunta Webhook] Event outside replay window (logged, not processed): skew=${Math.round(skewMs / 1000)}s event=${eventType}`,
        );
        return NextResponse.json({
          received: true,
          ignored: "timestamp_skew",
        });
      }
    }

    console.warn(
      `[Alunta Webhook] Received event: ${eventType}`,
      `subscription=${payload.data.subscription?.uuid ?? "n/a"}`,
      `customer=${payload.data.customer?.uuid ?? "n/a"}`,
    );

    // Build idempotency key from event type + timestamp + resource UUID
    const resourceId =
      payload.data.subscription?.uuid ||
      payload.data.customer?.uuid ||
      payload.data.invoice?.uuid ||
      "";
    const eventId = `${eventType}-${payload.timestamp}-${resourceId}`;

    // Idempotency check. Rækker med status='error' springes bevidst OVER
    // (#424 fund 5): POST'en svarer altid 200, så Aluntas redelivery /
    // manuel replay er eneste vej til at genkøre et fejlet event — dedup må
    // ikke blokere den. Succesfuldt behandlede events forbliver deduperet.
    const existing = await db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.eventId, eventId),
        ne(webhookEvents.status, "error"),
      ),
    });
    if (existing) {
      console.warn(`[Alunta Webhook] Duplicate event ${eventId}, skipping`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Process event
    let processingError: string | null = null;
    let reviewNote: string | null = null;
    try {
      switch (eventType) {
        // Checkout completed — subscription created with payment method
        case "checkout.completed":
        case "subscription.started":
        case "subscription.created":
          reviewNote =
            (await handleCheckoutCompleted(payload.data))?.needsReview ?? null;
          break;

        case "subscription.updated":
        case "subscription.renewed":
        case "subscription.resumed":
          reviewNote =
            (await handleSubscriptionUpdated(payload.data))?.needsReview ??
            null;
          break;

        case "subscription.cancelled":
        case "subscription.canceled":
        case "subscription.ended":
          reviewNote =
            (await handleSubscriptionCancelled(payload.data))?.needsReview ??
            null;
          break;

        case "subscription.trial_ending":
          await handleTrialEnding(payload.data);
          break;

        case "invoice.paid":
          reviewNote =
            (await handleInvoicePaid(payload.data))?.needsReview ?? null;
          break;

        case "invoice.created":
          // Invoice created — don't change subscription status, just log
          console.warn(
            `[Alunta Webhook] Invoice created for customer ${payload.data.customer?.uuid}`,
          );
          break;

        case "subscription.payment_failed":
          reviewNote =
            (await handlePaymentFailed(payload.data))?.needsReview ?? null;
          break;

        case "customer.created":
        case "customer.updated":
        case "customer.deleted":
          // Log but no action needed — we link via external_customer_id
          console.warn(
            `[Alunta Webhook] Customer event: ${eventType} for ${payload.data.customer?.name || "unknown"}`,
          );
          break;

        default:
          console.warn(`[Alunta Webhook] Unhandled event: ${eventType}`);
      }
    } catch (err) {
      processingError = err instanceof Error ? err.message : String(err);
      console.error(`[Alunta Webhook] Error processing ${eventType}:`, err);
      captureRouteError(err, {
        route: "/api/alunta/webhook",
        type: "webhook",
        extra: { eventType, resourceId },
      });
    }

    // Record event. Upsert på eventId: et replayet event der fejlede første
    // gang har allerede en 'error'-række — genkørslen skal kunne opdatere den
    // til 'success' i stedet for at fejle på unique-constrainten.
    const recordStatus = processingError
      ? "error"
      : reviewNote
        ? WEBHOOK_STATUS_NEEDS_REVIEW
        : "success";
    const recordMessage = processingError ?? reviewNote;
    try {
      await db
        .insert(webhookEvents)
        .values({
          eventId,
          source: "alunta",
          eventType,
          status: recordStatus,
          errorMessage: recordMessage,
        })
        .onConflictDoUpdate({
          target: webhookEvents.eventId,
          set: {
            status: recordStatus,
            errorMessage: recordMessage,
            processedAt: new Date(),
          },
        });
    } catch (insertErr) {
      console.error("[Alunta Webhook] Failed to record event:", insertErr);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Alunta Webhook] Error:", error);
    captureRouteError(error, {
      route: "/api/alunta/webhook",
      type: "webhook",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── Helpers — plan tier resolution ──────────────────────────────────

/**
 * Map an Alunta plan UUID back to our planTier + maxSeats by comparing
 * against the env-var plan IDs we configured. Falls back to "solo"/1
 * if the UUID is unknown or env vars are not set.
 */
function resolvePlanTier(planUuid: string | null | undefined): {
  planTier: string;
  maxSeats: number;
} {
  const planTier = resolveAluntaPlanTier(planUuid);
  return {
    planTier,
    maxSeats: planTier === "solo" ? 1 : maxSeatsForTier(planTier),
  };
}

/** Parse a positive integer from a value that may be a string or number. */
function toPositiveInt(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Seat count from our checkout metadata (metadata.seat_count), or null. */
function readMetadataSeatCount(
  subData: NonNullable<AluntaWebhookPayload["data"]["subscription"]>,
): number | null {
  return toPositiveInt(subData.metadata?.seat_count);
}

/**
 * Compute the total seat count to store from an Alunta subscription payload.
 * Delegates to the shared `resolveAluntaSeatCount` so the webhook and the
 * seat-reconciliation cron compute seats identically (base plan ignores
 * quantity; seats add-on adds quantity to the included seats).
 */
function effectiveSeatCount(
  subData: NonNullable<AluntaWebhookPayload["data"]["subscription"]>,
  planUuid: string | null | undefined,
  tier: string,
  existingSeats: number | null | undefined,
): number {
  return resolveAluntaSeatCount({
    planUuid,
    tier,
    quantity: toPositiveInt(subData.quantity),
    metadataSeatCount: readMetadataSeatCount(subData),
    existingSeats,
  });
}

/**
 * Erstat-og-annullér (#420/#424): når en ny subscription aktiveres som
 * erstatning (nyt antal ekstra pladser, eller tier-opgradering), annulleres
 * de gamle subscriptions den erstatter hos Alunta.
 *
 * Ankerprincip (#424): annullér ALDRIG ud fra klassificering alene. Den
 * primære mekanisme er `metadata.replaces_subscription_uuids` som checkouten
 * udpegede — vi verificerer at hver UUID stadig er live og annullerer præcis
 * dem. Klassificerings-heuristikken bruges KUN som backstop når metadataen
 * mangler (ældre checkouts / portal-køb), og altid med høj alarm.
 *
 * Fejl her må ALDRIG vælte webhook-behandlingen — den nye subscription er
 * allerede skrevet til DB'en; alt uventet (tom liste, fejlet cancel,
 * fejlet opslag) logges + sendes til Sentry. Tavse no-ops er forbudt på
 * denne destruktive sti.
 */
async function cancelReplacedSubscriptions(
  externalId: string,
  activatedSubUuid: string,
  replacement:
    | { kind: "seats"; replacesUuids: string[] | null }
    | { kind: "upgrade"; newTier: string; replacesUuids: string[] | null },
) {
  const alarm = (message: string, extra: Record<string, unknown> = {}) => {
    console.error(`[Alunta Webhook] ${message}`);
    captureRouteError(new Error(message), {
      route: "/api/alunta/webhook",
      type: "webhook",
      extra: {
        phase: "replace-cancel",
        kind: replacement.kind,
        activatedSubUuid,
        externalId,
        ...extra,
      },
    });
  };

  try {
    let targets: AluntaSubSummary[] = [];

    if (replacement.replacesUuids !== null) {
      // Primær mekanisme: præcis de UUID'er checkouten udpegede.
      if (replacement.replacesUuids.length === 0) {
        alarm(
          "Erstatnings-checkout uden udpegede subscriptions at annullere (replaces_subscription_uuids=[]). Verificér manuelt, at kunden ikke dobbeltbetaler.",
        );
        return;
      }
      for (const uuid of replacement.replacesUuids) {
        if (uuid === activatedSubUuid) continue; // aldrig den nye selv
        try {
          const { data } = await alunta.subscriptions.get(uuid);
          if (isLiveAluntaStatus(data.status)) {
            targets.push({
              uuid: data.uuid,
              status: data.status,
              plan: data.plan ? { uuid: data.plan.uuid } : null,
            });
          } else {
            console.warn(
              `[Alunta Webhook] Replaced sub ${uuid} is already ${data.status} — nothing to cancel (idempotent)`,
            );
          }
        } catch (err) {
          alarm(
            `Kunne ikke verificere erstattet sub ${uuid}. Den annulleres IKKE i denne omgang. Replay eventet eller annullér manuelt.`,
            { replacedSubUuid: uuid, error: String(err) },
          );
        }
      }
    } else {
      // Backstop: metadataen mangler (ældre checkout / portal-køb) — brug
      // klassificerings-heuristikken, men aldrig tavst.
      const aluntaSubs =
        await alunta.subscriptions.listAllByExternalCustomerId(externalId);
      targets =
        replacement.kind === "seats"
          ? findObsoleteSeatsSubs(activatedSubUuid, aluntaSubs)
          : findObsoleteSubsOnUpgrade(
              activatedSubUuid,
              replacement.newTier,
              aluntaSubs,
            );
      if (targets.length > 0) {
        alarm(
          `Backstop-heuristik uden metadata annullerer ${targets.length} sub(s): [${targets.map((s) => s.uuid).join(",")}]. Checkouts bør altid bære replaces_subscription_uuids.`,
        );
      }
    }

    if (targets.length === 0) return;

    const result = await cancelSubscriptionsSafely(
      targets,
      (uuid) => alunta.subscriptions.cancel(uuid),
      (uuid, err) => {
        alarm(
          `Annullering af erstattet sub ${uuid} FEJLEDE. Kunden risikerer dobbeltbetaling. Annullér manuelt i Alunta.`,
          { replacedSubUuid: uuid, error: String(err) },
        );
      },
    );
    console.warn(
      `[Alunta Webhook] Replace-and-cancel (${replacement.kind}) for ${externalId}: cancelled=[${result.cancelled.join(",")}] failed=[${result.failed.join(",")}]`,
    );
  } catch (err) {
    alarm(
      `Replace-and-cancel fejlede uventet for ${externalId}. De erstattede subscriptions kører muligvis stadig.`,
      { error: String(err) },
    );
  }
}

/**
 * Selvheling (#424 fund 8): er rækkens nuværende linkede Alunta-sub stadig
 * live? Bruges i de ikke-linkede grene til at afgøre om et event fra en anden
 * sub skal adopteres (linket sub er død → re-point/handl) eller ignoreres
 * (linket sub lever → eventet er støj fra en erstattet/gammel sub).
 * Returnerer null ved usikkerhed (API-fejl) — kalderen skal da IKKE handle.
 */
async function isLinkedSubStillLive(
  linkedSubUuid: string,
): Promise<boolean | null> {
  try {
    const { data } = await alunta.subscriptions.get(linkedSubUuid);
    return isLiveAluntaStatus(data.status);
  } catch (err) {
    // 404 = subben findes ikke længere hos Alunta → definitivt ikke live.
    if (err instanceof Error && /Alunta API 404/.test(err.message))
      return false;
    console.error(
      `[Alunta Webhook] Could not verify linked sub ${linkedSubUuid}:`,
      err,
    );
    captureRouteError(err, {
      route: "/api/alunta/webhook",
      type: "webhook",
      extra: { phase: "linked-sub-liveness", linkedSubUuid },
    });
    return null;
  }
}

type LocalSubRow = NonNullable<
  Awaited<ReturnType<typeof findSubscriptionByExternalId>>
>;

/** Alunta customer.uuid fra et event — ligger på data.customer eller på subben. */
function eventCustomerUuid(data: AluntaWebhookPayload["data"]): string | null {
  return data.customer?.uuid ?? data.subscription?.customer?.uuid ?? null;
}

async function findSubscriptionByCustomerUuid(customerUuid: string) {
  return db.query.subscriptions.findFirst({
    where: eq(subscriptions.aluntaCustomerId, customerUuid),
  });
}

/**
 * Dobbelt-abonnement-vagt (kunde B-incident 1/9-2026): et event om en
 * sub der IKKE er rækkens linkede, men hører til samme Alunta-kunde. Før
 * returnerede handlerne stille ("Missing external_customer_id") og eventet
 * blev gemt som success — kunden blev faktureret dobbelt i to måneder.
 *
 * Nu: er eventets sub stadig under fakturering og den linkede sub ikke
 * bekræftet død → høj alarm (log + Sentry + Discord) og `needsReview`.
 * Der annulleres ALDRIG automatisk — penge og kundeforhold er en manuel
 * beslutning. Kalderen må ikke mutere rækken ud fra dette event.
 *
 * `eventSubStatus` udeladt (fx invoice.paid uden sub-objekt) → status slås
 * op hos Alunta; 404 = ikke live, anden fejl = ukendt (alarmér hellere).
 */
async function reviewForeignSubEvent(params: {
  sub: LocalSubRow;
  eventSubUuid: string;
  eventSubStatus?: string | null;
  /** Fra eventets subscription-objekt; opsagt m. end_date = fornyer ikke. */
  eventSubEndDate?: string | null;
  eventSubCurrentPeriodEnd?: string | null;
  eventType: string;
}): Promise<HandlerOutcome> {
  const { sub, eventSubUuid, eventType } = params;
  const linkedSubUuid = sub.aluntaSubscriptionId ?? null;

  let eventSubStatus = params.eventSubStatus;
  let eventSubEndDate = params.eventSubEndDate;
  let eventSubCurrentPeriodEnd = params.eventSubCurrentPeriodEnd;
  if (eventSubStatus == null) {
    try {
      const { data } = await alunta.subscriptions.get(eventSubUuid);
      eventSubStatus = data.status;
      eventSubEndDate = data.end_date;
      const periodEnd = data.current_period_end;
      eventSubCurrentPeriodEnd =
        typeof periodEnd === "string" ? periodEnd : null;
    } catch (err) {
      eventSubStatus =
        err instanceof Error && /Alunta API 404/.test(err.message)
          ? "cancelled"
          : "active"; // ukendt → antag fakturering, hellere én alarm for meget
    }
  }

  const linkedSubLive = linkedSubUuid
    ? await isLinkedSubStillLive(linkedSubUuid)
    : null;

  if (
    !isPossibleDuplicateEvent({
      linkedSubUuid,
      eventSubUuid,
      eventSubStatus,
      eventSubEndDate,
      eventSubCurrentPeriodEnd,
      linkedSubLive,
    })
  ) {
    console.warn(
      `[Alunta Webhook] Ignoring ${eventType} from non-linked sub ${eventSubUuid} (row ${sub.id} linked to ${linkedSubUuid ?? "none"}, event status ${eventSubStatus}, end_date ${eventSubEndDate ?? "none"}, linked live=${String(linkedSubLive)})`,
    );
    return undefined;
  }

  const reason = formatDuplicateReason({
    source: `Webhook ${eventType}`,
    customerUuid: sub.aluntaCustomerId ?? "ukendt",
    linkedSubUuid,
    foreignSubUuids: [eventSubUuid],
  });
  console.error(`[Alunta Webhook] ${reason}`);
  captureRouteError(new Error(reason), {
    route: "/api/alunta/webhook",
    type: "webhook",
    extra: {
      phase: "duplicate-subscription",
      eventType,
      subscriptionRowId: sub.id,
      linkedSubUuid,
      eventSubUuid,
      linkedSubLive,
    },
  });
  const user = await resolveUserByExternalId(
    sub.organizationId ?? sub.userId,
    sub.userId,
  );
  await notifyAdmin("subscription_duplicate", {
    userName: user?.name ?? undefined,
    userEmail: user?.email,
    userId: sub.userId,
    reason,
  });
  return { needsReview: reason };
}

// ── Event Handlers ──────────────────────────────────────────────────

async function handleCheckoutCompleted(
  data: AluntaWebhookPayload["data"],
): Promise<HandlerOutcome> {
  const subData = data.subscription;
  const externalId = data.external_customer_id;
  const customerData = data.customer;

  if (!subData?.uuid) {
    console.error(
      "[Alunta Webhook] Missing subscription.uuid in checkout event",
    );
    return;
  }

  if (!externalId) {
    // Fremmed sub startet direkte i Alunta (uden vores checkout) — kan kun
    // kobles til en kunde via customer.uuid. Aldrig link/mutér herfra.
    const customerUuid = eventCustomerUuid(data);
    const byCustomer = customerUuid
      ? await findSubscriptionByCustomerUuid(customerUuid)
      : undefined;
    if (!byCustomer) {
      console.error(
        `[Alunta Webhook] Missing external_customer_id in checkout event and no row matches customer ${customerUuid ?? "n/a"} (sub ${subData.uuid})`,
      );
      return;
    }
    if (byCustomer.aluntaSubscriptionId === subData.uuid) {
      console.warn(
        `[Alunta Webhook] Event without external_customer_id for already-linked sub ${subData.uuid} — nothing to do`,
      );
      return;
    }
    return reviewForeignSubEvent({
      sub: byCustomer,
      eventSubUuid: subData.uuid,
      eventSubStatus: subData.status,
      eventSubEndDate: subData.end_date,
      eventSubCurrentPeriodEnd: subData.current_period_end,
      eventType: "checkout/subscription.started",
    });
  }

  // external_customer_id may be an orgId (new flow) or userId (legacy flow)
  const sub = await findSubscriptionByExternalId(externalId);
  if (!sub) {
    console.error(
      `[Alunta Webhook] No subscription found for external_customer_id ${externalId}`,
    );
    return;
  }
  if (isStoreManaged(sub)) {
    return storeManagedReview(
      sub,
      "checkout/subscription.started",
      subData.uuid,
    );
  }

  // Ensure subscription has organizationId (backfill for pre-migration records)
  let orgId = sub.organizationId;
  if (!orgId) {
    orgId = await resolveUserOrgId(sub.userId);
  }

  // If already linked to this Alunta subscription, skip the DB write — men
  // kør stadig erstat-og-annullér for replacement-markerede events: et replay
  // efter et crash mellem DB-skrivning og annullering må ikke efterlade de
  // erstattede subscriptions kørende (#424). Idempotent — allerede
  // annullerede UUID'er springes over.
  if (sub.aluntaSubscriptionId === subData.uuid) {
    console.warn(
      `[Alunta Webhook] Subscription already linked for external_customer_id ${externalId}`,
    );
    const linkedReplaces = parseReplacesUuids(
      subData.metadata?.replaces_subscription_uuids,
    );
    if (linkedReplaces !== null || subData.metadata?.upgrade_from) {
      const linkedPlanUuid = subData.plan?.uuid || data.plan?.uuid || null;
      await cancelReplacedSubscriptions(
        externalId,
        subData.uuid,
        isAluntaSeatsPlan(linkedPlanUuid)
          ? { kind: "seats", replacesUuids: linkedReplaces }
          : {
              kind: "upgrade",
              newTier: resolveAluntaPlanTier(linkedPlanUuid),
              replacesUuids: linkedReplaces,
            },
      );
    }
    return;
  }

  const aluntaStatus = mapAluntaStatus(subData.status || "active");

  // Keep trial status if our local subscription is trialing and Alunta says active
  // This means the user added payment during trial — don't end their trial early
  const keepTrial = sub.status === "trialing" && sub.trialEndsAt > new Date();

  // Sync trial end date from Alunta if present
  const aluntaTrialEnd =
    subData.trial?.is_active && subData.trial.end_date
      ? new Date(subData.trial.end_date)
      : undefined;

  // Sync billingCycle from Alunta — protects against mo→yearly upgrades
  // done in the Alunta portal that would otherwise never hit our DB.
  const detectedCycle = guessBillingCycle(subData);

  // Resolve plan tier from Alunta plan UUID, and seats from the purchased
  // quantity (don't downgrade existing seats if Alunta sends none).
  const planUuid = subData.plan?.uuid || data.plan?.uuid || null;
  const { planTier } = resolvePlanTier(planUuid);

  // De konkrete sub-UUID'er denne checkout erstatter (udpeget på
  // checkout-tidspunktet, #424) — null når metadataen mangler.
  const replacesUuids = parseReplacesUuids(
    subData.metadata?.replaces_subscription_uuids,
  );

  // Seats-add-on checkout ved siden af en allerede linket BASE-sub (#420):
  // rækken er kanonisk linket til basen, så et seats-køb må KUN justere
  // pladstallet — aldrig re-pointe link/tier/cyklus/status til add-on'en
  // (samme regel som handleSubscriptionUpdated). Derefter annulleres kundens
  // GAMLE seats-subscriptions (erstat-og-annullér — Alunta kan ikke ændre
  // quantity på en eksisterende subscription).
  const isSeatsCheckout = isAluntaSeatsPlan(planUuid);
  const checkoutLinkedToDifferentSub =
    !!sub.aluntaSubscriptionId && sub.aluntaSubscriptionId !== subData.uuid;
  if (isSeatsCheckout && checkoutLinkedToDifferentSub) {
    // Basens tier styrer inkluderede pladser; fald kun tilbage til
    // seats-planens tier hvis rækken (usædvanligt) mangler en.
    const seatTier = sub.planTier ?? planTier;
    const addonSeatCount = effectiveSeatCount(
      subData,
      planUuid,
      seatTier,
      sub.seatCount,
    );
    await db
      .update(subscriptions)
      .set({
        seatCount: addonSeatCount,
        maxSeats: addonSeatCount,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));
    console.warn(
      `[Alunta Webhook] Seats add-on activated for ${externalId}: sub ${subData.uuid}, total seats ${addonSeatCount} (base link kept: ${sub.aluntaSubscriptionId})`,
    );
    await cancelReplacedSubscriptions(externalId, subData.uuid, {
      kind: "seats",
      replacesUuids,
    });
    return;
  }

  // BASE-checkout-event fra en ANDEN sub end den rækken er linket til (#424
  // fund 7): re-point kun ved legitime opgraderinger (vores egne
  // upgrade-metadata, eller højere tier). En gammel, ikke-annulleret sub der
  // "vågner" må aldrig nedgradere rækken — men er rækkens linkede sub død og
  // event-subben live, adopteres den (selvheling, fund 8: portal-/support-
  // erstattede subs skal stadig kunne overtage rækken).
  if (!isSeatsCheckout && checkoutLinkedToDifferentSub) {
    const hasUpgradeMetadata =
      !!subData.metadata?.upgrade_from || replacesUuids !== null;
    const decision = baseCheckoutRelinkDecision({
      hasUpgradeMetadata,
      eventTier: planTier,
      rowTier: sub.planTier,
    });
    if (decision === "verify-adoption") {
      const linkedLive = await isLinkedSubStillLive(
        sub.aluntaSubscriptionId as string,
      );
      const eventLive = isLiveAluntaStatus(subData.status);
      if (linkedLive !== false || !eventLive) {
        console.warn(
          `[Alunta Webhook] Ignoring base checkout event from non-linked sub ${subData.uuid} (row linked to ${sub.aluntaSubscriptionId}, linked live=${String(linkedLive)}, event live=${eventLive})`,
        );
        return;
      }
      console.warn(
        `[Alunta Webhook] Adopting sub ${subData.uuid} — linked sub ${sub.aluntaSubscriptionId} is no longer live`,
      );
    }
  }

  // Seats add-on plans count extra seats only (total = included + qty); base
  // plans carry the total. Fallback to existing seats clamps to the tier.
  // Base-checkoutens metadata.seat_count er et frossent øjebliksbillede og må
  // aldrig sænke pladser som et seats-add-on-køb har hævet (#424 fund 3) —
  // deraf max mod rækkens nuværende.
  const seatCount = resolveBaseEventSeatCount(
    planTier,
    effectiveSeatCount(subData, planUuid, planTier, sub.seatCount),
    sub.seatCount,
  );

  await db
    .update(subscriptions)
    .set({
      aluntaSubscriptionId: subData.uuid,
      aluntaCustomerId: customerData?.uuid || null,
      aluntaPlanId: planUuid,
      billingCycle: detectedCycle,
      status: keepTrial ? "trialing" : aluntaStatus,
      isTrial: keepTrial ? true : aluntaStatus === "trialing",
      // Preserve any known period when Alunta omits dates (parity with the
      // update handler) — don't wipe it to null.
      currentPeriodStart: subData.start_date
        ? new Date(subData.start_date)
        : undefined,
      currentPeriodEnd: subData.end_date
        ? new Date(subData.end_date)
        : undefined,
      ...(aluntaTrialEnd ? { trialEndsAt: aluntaTrialEnd } : {}),
      // Backfill organizationId for pre-migration subscriptions
      ...(orgId && !sub.organizationId ? { organizationId: orgId } : {}),
      planTier,
      seatCount,
      maxSeats: seatCount,
      pastDueSince: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  // Virksomhed-planen giver enterprise-modulet (best-effort, aldrig fjernelse).
  await grantEnterpriseForTierSafe(
    db,
    orgId,
    planTier,
    "alunta.checkout_completed",
  );

  // Sync any pending discount to Alunta (founding member or admin-set)
  if (sub.discountPercent && sub.discountPercent > 0) {
    try {
      const isFoundingMember = sub.foundingTier === "founding_member";
      // Kampagnerabatten regnes fra betalingsdagen, så en kunde der betaler
      // sent stadig får alle rabatmånederne.
      const campaign = isFoundingMember
        ? null
        : findCampaignCode(sub.promoCode);
      const discountEnd = campaign
        ? campaignDiscountEndForPayment(
            campaign,
            new Date(),
            sub.discountExpiresAt,
          )
        : sub.discountExpiresAt;
      const discountName = isFoundingMember
        ? `${FOUNDING_MEMBER.label} ${FOUNDING_MEMBER.discountPercent}%`
        : campaign
          ? `${campaign.label} ${sub.discountPercent}%`
          : `Rabat ${sub.discountPercent}%`;

      const today = copenhagenToday();
      await alunta.subscriptions.addDiscount(subData.uuid, {
        discount_name: discountName,
        discount_type: "percent",
        discount_value: sub.discountPercent,
        from_date: today,
        to_date: discountEnd ? toLocalDateStr(discountEnd) : undefined,
      });
      console.warn(
        `[Alunta Webhook] Synced ${sub.discountPercent}% discount to Alunta for sub ${subData.uuid}`,
      );
    } catch (discountErr) {
      console.error(
        "[Alunta Webhook] Failed to sync discount to Alunta:",
        discountErr,
      );
    }
  }

  // Erstat-og-annullér (#420):
  // - Seats-checkout der landede her (rækken var endnu ikke linket til en
  //   base): annullér kundens gamle seats-subscriptions.
  // - Base-checkout på team/business: en tier-opgradering efterlader gamle
  //   base-subs på lavere tier (og team-seats ved team→business) — annullér
  //   dem. Idempotent og ufarlig for førstegangskøb (ingen gamle subs at
  //   finde). Solo-basen kan aldrig være en opgradering.
  if (isSeatsCheckout) {
    await cancelReplacedSubscriptions(externalId, subData.uuid, {
      kind: "seats",
      replacesUuids,
    });
  } else if (planTier === "team" || planTier === "business") {
    await cancelReplacedSubscriptions(externalId, subData.uuid, {
      kind: "upgrade",
      newTier: planTier,
      replacesUuids,
    });
  }

  console.warn(
    `[Alunta Webhook] Checkout completed for external_customer_id ${externalId}, sub ${subData.uuid}, status kept as ${keepTrial ? "trialing" : aluntaStatus}`,
  );

  // Notify admin of new subscription — resolve user from the subscription record
  const user = await resolveUserByExternalId(externalId, sub.userId);
  notifyAdmin("subscription_started", {
    userName: user?.name || customerData?.name || "ukendt",
    userEmail: user?.email || customerData?.email,
    userId: sub.userId,
    planName: subData.plan?.name || data.plan?.name,
  });
}

async function handleSubscriptionUpdated(
  data: AluntaWebhookPayload["data"],
): Promise<HandlerOutcome> {
  const subData = data.subscription;
  const subUuid = subData?.uuid;
  if (!subUuid) return;

  // Try to find by Alunta subscription ID first
  let sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.aluntaSubscriptionId, subUuid),
  });

  // Fallback: find by external_customer_id (may be orgId or userId)
  if (!sub && data.external_customer_id) {
    sub = await findSubscriptionByExternalId(data.external_customer_id);
  }

  // Fallback uden external_customer_id: fremmed sub på en kendt Alunta-kunde
  // → kun dobbelt-abonnement-vagt, ingen mutation.
  if (!sub && !data.external_customer_id) {
    const customerUuid = eventCustomerUuid(data);
    const byCustomer = customerUuid
      ? await findSubscriptionByCustomerUuid(customerUuid)
      : undefined;
    if (byCustomer) {
      return reviewForeignSubEvent({
        sub: byCustomer,
        eventSubUuid: subUuid,
        eventSubStatus: subData.status,
        eventSubEndDate: subData.end_date,
        eventSubCurrentPeriodEnd: subData.current_period_end,
        eventType: "subscription.updated",
      });
    }
  }

  if (!sub) {
    console.warn(
      `[Alunta Webhook] No local subscription for ${subUuid}, skipping update`,
    );
    return;
  }
  if (isStoreManaged(sub)) {
    return storeManagedReview(sub, "subscription.updated", subUuid);
  }

  const newStatus = mapAluntaStatus(subData.status || "active");

  // Sync trial end date from Alunta if present
  const trialUpdate: { trialEndsAt?: Date; isTrial?: boolean } = {};
  if (subData.trial) {
    if (subData.trial.is_active && subData.trial.end_date) {
      trialUpdate.trialEndsAt = new Date(subData.trial.end_date);
      trialUpdate.isTrial = true;
    } else if (!subData.trial.is_active) {
      trialUpdate.isTrial = false;
    }
  }

  // Keep billingCycle in sync with Alunta — catches plan upgrades/downgrades
  // (monthly → yearly or vice versa) that happen in the Alunta portal.
  const detectedCycle = guessBillingCycle(subData);

  // Resolve plan tier + seats — picks up upgrades/downgrades + seat changes
  // made via the Alunta portal.
  const updatedPlanUuid = subData.plan?.uuid || null;
  const { planTier: updatedPlanTier } = resolvePlanTier(updatedPlanUuid);
  // Seats add-on plans count extra seats only (total = included + qty); base
  // plans carry the total. Fallback to existing seats clamps to the tier.
  const updatedSeatCount = effectiveSeatCount(
    subData,
    updatedPlanUuid,
    updatedPlanTier,
    sub.seatCount,
  );
  // BASE-events: den frosne checkout-metadata.seat_count må aldrig sænke
  // pladser som et senere seats-add-on-køb har hævet (#424 fund 3). Seats-
  // events er derimod autoritative for antallet (køb NED skal slå igennem).
  const guardedSeatCount = isAluntaSeatsPlan(subData.plan?.uuid ?? null)
    ? updatedSeatCount
    : resolveBaseEventSeatCount(
        updatedPlanTier,
        updatedSeatCount,
        sub.seatCount,
      );

  // A Team customer holds TWO Alunta subs (flat_rate base + seats add-on) but
  // we keep ONE DB row canonically linked to the BASE sub. An event from the
  // seats add-on must only adjust the seat count — it must NOT re-point the
  // link/tier/cycle/period/status to the add-on, or a later base
  // cancellation/renewal would no longer match this row. Only take over the
  // canonical fields when this IS the linked sub, or the row isn't linked yet.
  const isSeatsEvent = isAluntaSeatsPlan(updatedPlanUuid);
  const linkedToDifferentSub =
    !!sub.aluntaSubscriptionId && sub.aluntaSubscriptionId !== subUuid;
  const seatsAddonOnly = isSeatsEvent && linkedToDifferentSub;

  // Update-event fra en ANDEN base-sub end den rækken er linket til: normalt
  // ignorér — efter en tier-opgradering (erstat-og-annullér, #420) sender den
  // gamle, erstattede base-sub stadig events, og de må ikke re-pointe rækken
  // tilbage og nedgradere tier/pladser. MEN (selvheling, #424 fund 8): er
  // rækkens linkede sub død og event-subben live, adopteres event-subben i
  // stedet (portal-/support-erstattede subs skal kunne overtage rækken).
  if (linkedToDifferentSub && !isSeatsEvent) {
    const linkedLive = await isLinkedSubStillLive(
      sub.aluntaSubscriptionId as string,
    );
    const eventLive = isLiveAluntaStatus(subData.status);
    if (linkedLive !== false || !eventLive) {
      console.warn(
        `[Alunta Webhook] Ignoring update from non-linked sub ${subUuid} (row linked to ${sub.aluntaSubscriptionId}, linked live=${String(linkedLive)}, event live=${eventLive})`,
      );
      return;
    }
    console.warn(
      `[Alunta Webhook] Adopting sub ${subUuid} via update event — linked sub ${sub.aluntaSubscriptionId} is no longer live`,
    );
  }

  if (seatsAddonOnly) {
    await db
      .update(subscriptions)
      .set({
        seatCount: updatedSeatCount,
        maxSeats: updatedSeatCount,
        pastDueSince:
          newStatus === "active" || newStatus === "trialing" ? null : undefined,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));
  } else {
    await db
      .update(subscriptions)
      .set({
        status: newStatus,
        isTrial: trialUpdate.isTrial ?? subData.status === "trialing",
        aluntaSubscriptionId: subUuid,
        aluntaPlanId: updatedPlanUuid || undefined,
        billingCycle: detectedCycle,
        currentPeriodStart: subData.start_date
          ? new Date(subData.start_date)
          : undefined,
        currentPeriodEnd: subData.end_date
          ? new Date(subData.end_date)
          : undefined,
        ...(trialUpdate.trialEndsAt
          ? { trialEndsAt: trialUpdate.trialEndsAt }
          : {}),
        planTier: updatedPlanTier,
        seatCount: guardedSeatCount,
        maxSeats: guardedSeatCount,
        pastDueSince:
          newStatus === "active" || newStatus === "trialing" ? null : undefined,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));

    // Opgradering til Virksomhed via portalen giver enterprise-modulet
    // (best-effort, aldrig fjernelse ved nedgradering).
    if (updatedPlanTier === "business") {
      const grantOrgId =
        sub.organizationId ??
        (await resolveUserOrgId(sub.userId).catch(() => null));
      await grantEnterpriseForTierSafe(
        db,
        grantOrgId,
        updatedPlanTier,
        "alunta.subscription_updated",
      );
    }
  }

  console.warn(
    `[Alunta Webhook] Subscription updated: ${subUuid} → ${subData.status}${seatsAddonOnly ? " (seats add-on only)" : ""}${subData.trial?.is_active ? ` (trial ends ${subData.trial.end_date})` : ""}`,
  );
}

async function handleSubscriptionCancelled(
  data: AluntaWebhookPayload["data"],
): Promise<HandlerOutcome> {
  const subUuid = data.subscription?.uuid;
  if (!subUuid) return;

  let sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.aluntaSubscriptionId, subUuid),
  });
  // Fallback via external_customer_id (parity with the update/payment_failed
  // handlers) — a seats-add-on cancellation carries the add-on's UUID, which
  // isn't the base UUID the row is linked to.
  if (!sub && data.external_customer_id) {
    sub = await findSubscriptionByExternalId(data.external_customer_id);
  }
  if (!sub) return;
  // Et gammelt web-abonnement der udløber, må ikke opsige butiksabonnementet.
  if (isStoreManaged(sub)) {
    return storeManagedReview(sub, "subscription.cancelled", subUuid);
  }

  // Cancelling ONLY the seats add-on (the base subscription still lives) is a
  // seat reduction, NOT a full cancellation — drop back to the tier's included
  // seats and keep the subscription active.
  const cancelledPlanUuid =
    data.subscription?.plan?.uuid || data.plan?.uuid || null;
  const linkedToDifferentSub =
    !!sub.aluntaSubscriptionId && sub.aluntaSubscriptionId !== subUuid;
  if (isAluntaSeatsPlan(cancelledPlanUuid) && linkedToDifferentSub) {
    // Erstat-og-annullér (#420): når et seats-køb erstattes af et nyt antal,
    // annullerer webhooken den GAMLE seats-sub — og dette event er så blot
    // ekkoet af den annullering. Har kunden stadig en anden live seats-sub
    // (den nye), må vi IKKE reducere pladstallet; det ville klippe det netop
    // købte antal væk. Og reduceres der, er gulvet base-subbens
    // metadata.seat_count (kapacitet båret med fra fx en tier-opgradering,
    // #424 fund 1/3) — aldrig blindt de inkluderede pladser.
    const externalId =
      data.external_customer_id || sub.organizationId || sub.userId;
    const tier = sub.planTier ?? "solo";
    let survivingSeatsSubs: ReturnType<typeof findObsoleteSeatsSubs>;
    let baseMetaSeatCount: number | null = null;
    try {
      const aluntaSubs =
        await alunta.subscriptions.listAllByExternalCustomerId(externalId);
      survivingSeatsSubs = findObsoleteSeatsSubs(subUuid, aluntaSubs);
      if (sub.aluntaSubscriptionId) {
        const baseSub =
          aluntaSubs.find((s) => s.uuid === sub.aluntaSubscriptionId) ??
          (await alunta.subscriptions.get(sub.aluntaSubscriptionId)).data;
        baseMetaSeatCount = toPositiveInt(baseSub?.metadata?.seat_count);
      }
    } catch (err) {
      // Sikker fallback (#424 fund 5): kan vi ikke afgøre situationen,
      // BEHOLDES nuværende pladser (et gæt kunne fjerne betalte pladser) —
      // og der alarmeres højt i stedet for at kaste.
      const message = `Seats-annullering ${subUuid}: kunne ikke verificere overlevende seats-subs/basens kapacitet, så nuværende pladstal beholdes (${sub.seatCount}). Kør seat-reconciliation eller replay eventet.`;
      console.error(`[Alunta Webhook] ${message}`, err);
      captureRouteError(err, {
        route: "/api/alunta/webhook",
        type: "webhook",
        extra: { phase: "seats-cancellation", subUuid, externalId, message },
      });
      return;
    }
    if (survivingSeatsSubs.length > 0) {
      console.warn(
        `[Alunta Webhook] Seats add-on ${subUuid} cancelled but replacement seats sub(s) [${survivingSeatsSubs.map((s) => s.uuid).join(",")}] are live — keeping seat count`,
      );
      return;
    }

    const reducedSeats = clampSeats(
      tier,
      Math.max(includedSeatsForTier(tier), baseMetaSeatCount ?? 0),
    );
    await db
      .update(subscriptions)
      .set({
        seatCount: reducedSeats,
        maxSeats: reducedSeats,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));
    console.warn(
      `[Alunta Webhook] Seats add-on cancelled for user ${sub.userId} — seats reduced to ${reducedSeats} (base metadata floor ${baseMetaSeatCount ?? "n/a"}), subscription kept active`,
    );
    return;
  }

  // Annullering af en ANDEN base-sub end den rækken er linket til: normalt
  // den gamle, erstattede base fra en tier-opgradering (#420) — kundens nye
  // base lever videre, så rækken må ikke markeres som opsagt. MEN
  // (selvheling, #424 fund 8): er den linkede sub OGSÅ død, var dette
  // kundens sidste sub — så skal rækken reelt deaktiveres.
  if (linkedToDifferentSub) {
    const linkedLive = await isLinkedSubStillLive(
      sub.aluntaSubscriptionId as string,
    );
    if (linkedLive !== false) {
      console.warn(
        `[Alunta Webhook] Ignoring cancellation of non-linked sub ${subUuid} (row is linked to ${sub.aluntaSubscriptionId}, linked live=${String(linkedLive)})`,
      );
      return;
    }
    console.warn(
      `[Alunta Webhook] Linked sub ${sub.aluntaSubscriptionId} is also dead — processing cancellation of ${subUuid} as the customer's last live sub`,
    );
  }

  await db
    .update(subscriptions)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      pastDueSince: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  console.warn(
    `[Alunta Webhook] Subscription cancelled for user ${sub.userId}`,
  );

  // Notify admin of cancellation
  const cancelledUser = await db.query.users.findFirst({
    where: eq(users.id, sub.userId),
    columns: { name: true, email: true },
  });
  notifyAdmin("subscription_cancelled", {
    userName: cancelledUser?.name || "ukendt",
    userEmail: cancelledUser?.email,
    userId: sub.userId,
  });
}

async function handleTrialEnding(data: AluntaWebhookPayload["data"]) {
  const externalId = data.external_customer_id;
  if (!externalId) return;

  // external_customer_id may be an orgId (new flow) or userId (legacy flow)
  const sub = await findSubscriptionByExternalId(externalId);
  if (!sub) return;
  // Ingen "prøveperioden udløber"-mail med web-links til en butikskunde.
  if (isStoreManaged(sub)) return;

  const user = await db.query.users.findFirst({
    where: eq(users.id, sub.userId),
    columns: { email: true, name: true },
  });
  if (!user?.email) return;

  const trialEnd = data.subscription?.end_date
    ? new Date(data.subscription.end_date)
    : sub.trialEndsAt;
  const daysLeft = Math.max(
    0,
    Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  try {
    await sendTrialEndingEmail({
      to: user.email,
      userName: user.name || "bruger",
      daysRemaining: daysLeft,
      organizationId: sub.organizationId,
      upgradeUrl: `${getAppUrl()}/dashboard/settings/subscription`,
      userId: sub.userId,
    });
  } catch (err) {
    console.error("[Alunta Webhook] Failed to send trial ending email:", err);
  }

  // Notify admin (Discord only — trial_ending supportsEmail=false)
  notifyAdmin("trial_ending", {
    userName: user.name || "ukendt",
    userEmail: user.email,
    userId: sub.userId,
    daysLeft,
  });
}

async function handleInvoicePaid(
  data: AluntaWebhookPayload["data"],
): Promise<HandlerOutcome> {
  // Invoice events only contain customer + invoice objects (no subscription).
  // Find subscription via customer UUID, or subscription UUID if present.
  const customerUuid = data.customer?.uuid;
  // Invoice events carry the sub id under invoice.subscription_uuid; older
  // payloads used subscription.uuid. Try both before the customer fallback.
  const subUuid = data.subscription?.uuid || data.invoice?.subscription_uuid;

  // Try to find subscription by Alunta sub ID, then customer ID
  let sub = subUuid
    ? await db.query.subscriptions.findFirst({
        where: eq(subscriptions.aluntaSubscriptionId, subUuid),
      })
    : null;

  if (!sub && customerUuid) {
    sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.aluntaCustomerId, customerUuid),
    });
  }

  if (!sub) {
    console.warn(
      `[Alunta Webhook] No subscription found for invoice event, customer: ${customerUuid}`,
    );
    return;
  }
  if (isStoreManaged(sub)) {
    return storeManagedReview(sub, "invoice.paid", subUuid);
  }

  // Fundet via customer-fallback (#424 fund 6): bærer eventet en sub-UUID,
  // skal den matche rækkens linkede sub — en faktura fra en netop erstattet
  // sub må ikke flippe trial/status på den sunde række. (Events helt uden
  // sub-UUID kan ikke verificeres og behandles som før.)
  // En betalt faktura på en fremmed sub der stadig er live = kunden betaler
  // to steder → dobbelt-abonnement-vagt (status slås op hos Alunta).
  if (subUuid && sub.aluntaSubscriptionId !== subUuid) {
    return reviewForeignSubEvent({
      sub,
      eventSubUuid: subUuid,
      eventType: "invoice.paid",
    });
  }

  // Don't resurrect a cancelled subscription — a late or final invoice payment
  // on a canceled sub must not flip it back to active.
  if (sub.status === "canceled") {
    console.warn(
      `[Alunta Webhook] Invoice paid for canceled subscription ${sub.id}, not reactivating`,
    );
    return;
  }

  // A real (non-zero) charge means the trial converted — end it regardless of
  // our local trialEndsAt, which may lag Alunta by a day. Only a $0 trial
  // invoice (amount_due 0/absent) while still inside the trial keeps trialing.
  const amountDue = data.invoice?.amount_due;
  const isRealCharge = typeof amountDue === "number" && amountDue > 0;
  const keepTrial =
    !isRealCharge && sub.status === "trialing" && sub.trialEndsAt > new Date();

  await db
    .update(subscriptions)
    .set({
      status: keepTrial ? "trialing" : "active",
      isTrial: keepTrial,
      pastDueSince: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  console.warn(
    `[Alunta Webhook] Invoice paid for subscription ${subUuid || sub.aluntaSubscriptionId}${keepTrial ? " (trial preserved)" : ""}`,
  );
}

async function handlePaymentFailed(
  data: AluntaWebhookPayload["data"],
): Promise<HandlerOutcome> {
  const subUuid = data.subscription?.uuid;
  if (!subUuid) return;

  // Try by Alunta subscription ID first, then by external_customer_id (may be orgId or userId)
  let sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.aluntaSubscriptionId, subUuid),
  });
  if (!sub && data.external_customer_id) {
    sub = await findSubscriptionByExternalId(data.external_customer_id);
  }
  // Fallback uden external_customer_id: fremmed sub hos en kendt Alunta-kunde
  // (kunde B-incident) — kan kun findes via customer.uuid.
  if (!sub && !data.external_customer_id) {
    const customerUuid = eventCustomerUuid(data);
    sub = customerUuid
      ? await findSubscriptionByCustomerUuid(customerUuid)
      : undefined;
  }
  if (!sub) return;
  if (isStoreManaged(sub)) {
    return storeManagedReview(sub, "subscription.payment_failed", subUuid);
  }

  // Fundet via fallback (#424 fund 6): mutér kun når eventet vedrører rækkens
  // linkede sub — et payment_failed fra en netop erstattet/gammel sub må ikke
  // sætte den sunde række past_due. Er den fremmede sub stadig under
  // fakturering, er det et muligt dobbelt-abonnement → alarm + needs_review.
  if (sub.aluntaSubscriptionId !== subUuid) {
    return reviewForeignSubEvent({
      sub,
      eventSubUuid: subUuid,
      eventSubStatus: data.subscription?.status,
      eventSubEndDate: data.subscription?.end_date,
      eventSubCurrentPeriodEnd: data.subscription?.current_period_end,
      eventType: "subscription.payment_failed",
    });
  }

  // Don't move a cancelled subscription into past_due on a payment-retry event.
  if (sub.status === "canceled") return;

  await db
    .update(subscriptions)
    .set({
      status: "past_due",
      pastDueSince: sub.pastDueSince ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  // Send payment failed email
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, sub.userId),
      columns: { email: true, name: true },
    });

    if (user?.email) {
      const price = data.subscription?.standard_price;
      const amountDue = price
        ? `${(price / 100).toFixed(2).replace(".", ",")} kr`
        : "ukendt beløb";

      await sendPaymentFailedEmail({
        to: user.email,
        userName: user.name || "bruger",
        amountDue,
        billingPortalUrl: `${getAppUrl()}/dashboard/settings/subscription`,
        userId: sub.userId,
      });

      // Notify org admins about payment failure
      if (sub.organizationId) {
        try {
          const adminMembers = await db.query.members.findMany({
            where: and(
              eq(members.organizationId, sub.organizationId),
              or(eq(members.role, "admin"), eq(members.role, "owner")),
            ),
            with: {
              user: { columns: { id: true, email: true, name: true } },
            },
          });

          for (const admin of adminMembers) {
            if (admin.userId === sub.userId) continue;
            try {
              await sendPaymentFailedEmail({
                to: admin.user.email,
                userName: admin.user.name ?? admin.user.email,
                amountDue,
                billingPortalUrl: `${getAppUrl()}/dashboard/settings/subscription`,
              });
            } catch (err) {
              console.error(
                `[Webhook] Failed to notify admin ${admin.userId}:`,
                err,
              );
            }
          }
        } catch (err) {
          console.error("[Webhook] Failed to notify org admins:", err);
        }
      }

      // Notify admin of payment failure
      notifyAdmin("payment_failed", {
        userName: user.name || "ukendt",
        userEmail: user.email,
        userId: sub.userId,
      });
    }
  } catch (err) {
    console.error("[Alunta Webhook] Failed to send payment failed email:", err);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Find a subscription by external_customer_id which may be an orgId (new flow)
 * or a userId (legacy flow). Tries organizationId first, then userId.
 */
async function findSubscriptionByExternalId(externalId: string) {
  return db.query.subscriptions.findFirst({
    where: or(
      eq(subscriptions.organizationId, externalId),
      eq(subscriptions.userId, externalId),
    ),
  });
}

/**
 * Resolve user info from an external_customer_id that may be an orgId or userId.
 * Tries direct user lookup first; if that fails, finds the org owner via members table.
 * Accepts an optional knownUserId (from the subscription record) as a fast path.
 */
async function resolveUserByExternalId(
  externalId: string,
  knownUserId?: string,
): Promise<{ name: string | null; email: string } | null> {
  // Fast path: if we have the userId from the subscription record, use it directly
  if (knownUserId) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, knownUserId),
      columns: { name: true, email: true },
    });
    if (user) return user;
  }

  // Try direct user lookup (legacy flow where externalId = userId)
  const directUser = await db.query.users.findFirst({
    where: eq(users.id, externalId),
    columns: { name: true, email: true },
  });
  if (directUser) return directUser;

  // externalId is likely an orgId — find the org owner via members table
  const ownerMembership = await db.query.members.findFirst({
    where: eq(members.organizationId, externalId),
    orderBy: [sql`CASE WHEN ${members.role} = 'owner' THEN 0 ELSE 1 END`],
    columns: { userId: true },
  });
  if (ownerMembership) {
    const ownerUser = await db.query.users.findFirst({
      where: eq(users.id, ownerMembership.userId),
      columns: { name: true, email: true },
    });
    return ownerUser ?? null;
  }

  return null;
}

/**
 * Resolve the user's primary organization from their membership.
 */
async function resolveUserOrgId(userId: string): Promise<string | null> {
  return resolvePrimaryOrgId({ db, userId });
}

function mapAluntaStatus(status: string): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "cancelled":
    case "canceled":
    case "expired":
      return "canceled";
    default:
      // Fail closed: an unknown/new Alunta status (unpaid, paused, incomplete…)
      // must not silently grant access. past_due withholds premium but is
      // recoverable once a real status arrives.
      console.warn(
        `[Alunta Webhook] Unknown Alunta status "${status}" → past_due`,
      );
      return "past_due";
  }
}

/**
 * Derive billingCycle from Alunta's subscription data. Alunta's `interval`
 * is the number of months between charges (1 = monthly, 12 = yearly).
 * Falls back to plan name matching if interval is missing. Never returns
 * null — defaults to "monthly" when unknown, which matches our legacy
 * default.
 */
function guessBillingCycle(
  sub: AluntaWebhookPayload["data"]["subscription"],
): "monthly" | "yearly" {
  if (sub?.interval === 12) return "yearly";
  if (sub?.interval === 1) return "monthly";
  const planName = (sub?.plan?.name || "").toLowerCase();
  if (planName.includes("year") || planName.includes("årlig")) return "yearly";
  return "monthly";
}
