import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import {
  desktopLicenseDevices,
  desktopLicenses,
  users,
  webhookEvents,
} from "@/lib/db/schema";
import { generateLicenseKey } from "@/lib/desktop-auth";
import { sendLicenseKeyEmail } from "@/lib/email/desktop-license";
import { captureRouteError } from "@/lib/utils/sentry";

/**
 * Stripe Webhook Handler for Desktop License Keys
 *
 * Handles:
 * - checkout.session.completed -> generate license key, link to user, send via email
 * - customer.subscription.updated -> update license status
 * - customer.subscription.deleted -> deactivate license
 * - charge.refunded -> revoke license + release devices (30-day money-back)
 *
 * Setup:
 * 1. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to env
 * 2. Create webhook endpoint in Stripe dashboard pointing to /api/webhooks/stripe
 * 3. Subscribe to: checkout.session.completed, customer.subscription.updated,
 *    customer.subscription.deleted, charge.refunded
 */

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(key);
}

/**
 * Record the outcome of an event. Upsert on eventId: a retry of a failed
 * event must be able to overwrite its earlier 'error' row (eventId is unique).
 */
async function recordWebhookEvent(
  event: Stripe.Event,
  status: "success" | "error",
  errorMessage?: string,
): Promise<void> {
  await db
    .insert(webhookEvents)
    .values({
      eventId: event.id,
      source: "stripe",
      eventType: event.type,
      status,
      errorMessage,
    })
    .onConflictDoUpdate({
      target: webhookEvents.eventId,
      set: {
        status,
        errorMessage: errorMessage ?? null,
        processedAt: new Date(),
      },
    });
}

export async function POST(request: Request) {
  const stripe = getStripe();

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 401 },
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  // Verify webhook signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error(
      "[Stripe Webhook] Signature verification failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Idempotency check. Rows with status 'error' are skipped on purpose: we
  // answer 500 on failure so Stripe retries, and that retry must be processed.
  const existing = await db.query.webhookEvents.findFirst({
    where: and(
      eq(webhookEvents.eventId, event.id),
      ne(webhookEvents.status, "error"),
    ),
  });
  if (existing) {
    console.warn(`[Stripe Webhook] Duplicate event ${event.id}, skipping`);
    return NextResponse.json({ received: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          stripe,
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      default:
        console.warn(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    // Log successful processing
    await recordWebhookEvent(event, "success");

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, error);

    // Log failed processing
    await recordWebhookEvent(
      event,
      "error",
      error instanceof Error ? error.message : "Unknown error",
    );

    captureRouteError(error, {
      route: "/api/webhooks/stripe",
      type: "webhook",
      extra: { eventType: event.type, eventId: event.id },
    });

    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}

/**
 * Handle checkout.session.completed
 * - Look up or note customer email
 * - Find/create user in database
 * - Generate license key
 * - Save to desktop_license table
 * - Send license key via email
 */
async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  const customerEmail =
    session.customer_details?.email || session.customer_email;
  if (!customerEmail) {
    console.error("[Stripe Webhook] No customer email in checkout session");
    return;
  }

  // Extract tier from metadata (set on the Checkout Session or Price)
  const tier =
    (session.metadata?.tier as string) ||
    (session.metadata?.license_tier as string) ||
    "solo";

  const maxDevices = Number.parseInt(session.metadata?.max_devices || "2", 10);

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || null;

  // One-time purchases carry a PaymentIntent (no subscription). Store it so a
  // later refund can find and revoke the exact license.
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  // Stripe amounts are in øre (smallest DKK unit); store whole DKK so the
  // admin revenue report reflects the price actually paid, not whatever
  // DESKTOP_LIFETIME_PRICE happens to be today (see LEGACY_DESKTOP_LIFETIME_PRICE).
  const amountPaidDkk =
    typeof session.amount_total === "number"
      ? Math.round(session.amount_total / 100)
      : null;

  // Find user by email (may not exist if purchased without an account)
  const user = await db.query.users.findFirst({
    where: eq(users.email, customerEmail.toLowerCase()),
    columns: { id: true, name: true },
  });

  // A retried event may find the license already created (e.g. the key email
  // failed last time). Re-send the existing key instead of creating a second.
  const existingLicense = paymentIntentId
    ? await db.query.desktopLicenses.findFirst({
        where: eq(desktopLicenses.stripePaymentIntentId, paymentIntentId),
      })
    : subscriptionId
      ? await db.query.desktopLicenses.findFirst({
          where: eq(desktopLicenses.stripeSubscriptionId, subscriptionId),
        })
      : null;

  if (existingLicense) {
    await sendLicenseKeyEmail({
      to: customerEmail,
      licenseKey: existingLicense.licenseKey,
      tier: existingLicense.tier,
      name: user?.name,
      maxDevices: existingLicense.maxDevices,
    });
    console.warn(
      `[Stripe Webhook] License already existed for session ${session.id}; key email re-sent`,
    );
    return;
  }

  // Generate the license key
  const licenseKey = generateLicenseKey();

  // Determine expiration — one-time purchases are lifetime, subscriptions expire
  let expiresAt: Date | null = null;
  if (subscriptionId) {
    // For subscriptions, fetch the current period end from the first item
    // (Stripe API v2025+ moved current_period_end to SubscriptionItem)
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["items.data"],
      });
      const firstItem = subscription.items?.data?.[0];
      if (firstItem?.current_period_end) {
        expiresAt = new Date(firstItem.current_period_end * 1000);
      } else {
        // Fallback: 1 year from now
        expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }
    } catch {
      // If we can't fetch, set a reasonable default (1 year)
      expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }
  }

  // Store the license
  await db.insert(desktopLicenses).values({
    userId: user?.id || null,
    licenseKey,
    email: customerEmail.toLowerCase(),
    tier,
    maxDevices,
    isActive: true,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePaymentIntentId: paymentIntentId,
    amountPaidDkk,
    expiresAt,
  });

  // Send license key via email
  await sendLicenseKeyEmail({
    to: customerEmail,
    licenseKey,
    tier,
    name: user?.name,
    maxDevices,
  });

  console.warn(
    `[Stripe Webhook] License created (tier: ${tier}, devices: ${maxDevices})`,
  );
}

/**
 * Handle charge.refunded
 * - When a desktop license purchase is refunded (e.g. within the 30-day
 *   money-back window), deactivate the license and release its devices.
 */
async function handleChargeRefunded(charge: Stripe.Charge) {
  // Only act on full refunds — partial refunds keep the license active.
  if (!charge.refunded) {
    console.warn(
      `[Stripe Webhook] charge ${charge.id} refunded partially — license kept active`,
    );
    return;
  }

  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id || null;

  if (!paymentIntentId) {
    console.warn(
      `[Stripe Webhook] charge.refunded ${charge.id} has no payment_intent — cannot match license`,
    );
    return;
  }

  const license = await db.query.desktopLicenses.findFirst({
    where: eq(desktopLicenses.stripePaymentIntentId, paymentIntentId),
  });

  if (!license) {
    console.warn(
      `[Stripe Webhook] No license found for refunded payment_intent ${paymentIntentId}`,
    );
    return;
  }

  // Deactivate the license — activate/verify both reject inactive licenses.
  await db
    .update(desktopLicenses)
    .set({ isActive: false })
    .where(eq(desktopLicenses.id, license.id));

  // Release activated devices so the license shows 0 used in admin.
  await db
    .delete(desktopLicenseDevices)
    .where(eq(desktopLicenseDevices.licenseId, license.id));

  console.warn(
    `[Stripe Webhook] License revoked after refund: ${license.id} (payment_intent: ${paymentIntentId})`,
  );
}

/**
 * Handle customer.subscription.updated
 * - Update license expiration date when subscription renews
 * - Handle cancellation at period end
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  // Find license(s) by Stripe customer ID
  const licenses = await db.query.desktopLicenses.findMany({
    where: eq(desktopLicenses.stripeCustomerId, customerId),
  });

  if (licenses.length === 0) {
    console.warn(
      `[Stripe Webhook] No desktop license found for customer ${customerId}`,
    );
    return;
  }

  // Get current period end from the first subscription item
  // (Stripe API v2025+ moved current_period_end to SubscriptionItem)
  const firstItem = subscription.items?.data?.[0];
  const periodEnd = firstItem?.current_period_end;

  for (const license of licenses) {
    const isActive =
      subscription.status === "active" || subscription.status === "trialing";

    const updateData: { isActive: boolean; expiresAt?: Date } = { isActive };
    if (periodEnd) {
      updateData.expiresAt = new Date(periodEnd * 1000);
    }

    await db
      .update(desktopLicenses)
      .set(updateData)
      .where(eq(desktopLicenses.id, license.id));

    console.warn(
      `[Stripe Webhook] License ${license.id} updated: active=${isActive}${periodEnd ? `, expires=${new Date(periodEnd * 1000).toISOString()}` : ""}`,
    );
  }
}

/**
 * Handle customer.subscription.deleted
 * - Deactivate the license when subscription is cancelled
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  // Find license(s) by Stripe customer ID
  const licenses = await db.query.desktopLicenses.findMany({
    where: eq(desktopLicenses.stripeCustomerId, customerId),
  });

  if (licenses.length === 0) {
    console.warn(
      `[Stripe Webhook] No desktop license found for customer ${customerId} (deletion)`,
    );
    return;
  }

  for (const license of licenses) {
    await db
      .update(desktopLicenses)
      .set({ isActive: false })
      .where(eq(desktopLicenses.id, license.id));

    console.warn(
      `[Stripe Webhook] License ${license.id} deactivated (subscription deleted)`,
    );
  }
}
