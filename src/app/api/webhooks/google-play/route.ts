import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getGooglePlayClient } from "@/lib/store-billing/google";
import {
  handleGooglePlayNotification,
  isStoreBillingEnabled,
  type PubSubPushBody,
} from "@/lib/store-billing/service";
import { captureRouteError } from "@/lib/utils/sentry";

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Google Play Real-time developer notifications via Pub/Sub push (køb i
 * appen). Beskyttet med et hemmeligt token i URL'en
 * (`?token=GOOGLE_PLAY_WEBHOOK_TOKEN`); selve købet slås altid op frisk hos
 * Google, så en forfalsket besked kan ikke give adgang. Idempotent via
 * Pub/Sub messageId. 2xx = behandlet/ignoreret; 500 = forbigående fejl
 * (Pub/Sub leverer igen). Mørk (404) indtil STORE_BILLING_ENABLED=1.
 */
export async function POST(request: Request) {
  const expected = process.env.GOOGLE_PLAY_WEBHOOK_TOKEN;
  if (!isStoreBillingEnabled() || !expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const token = new URL(request.url).searchParams.get("token");
  if (!tokenMatches(token, expected)) {
    console.error("[Google Play Webhook] Ugyldigt token — afvist");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PubSubPushBody;
  try {
    body = (await request.json()) as PubSubPushBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await handleGooglePlayNotification(
      db,
      body,
      getGooglePlayClient(),
    );
    console.warn(
      `[Google Play Webhook] ${result.notificationType || "?"} → ${result.outcome}`,
      `event=${result.eventId ?? "n/a"} sub=${result.subscriptionId ?? "n/a"}`,
    );
    if (result.outcome === "account_mismatch") {
      captureRouteError(
        new Error("Google Play-notifikation: konto matcher ikke"),
        {
          route: "/api/webhooks/google-play",
          type: "webhook",
          extra: {
            eventId: result.eventId,
            subscriptionId: result.subscriptionId,
          },
        },
      );
    }
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (err) {
    console.error("[Google Play Webhook] Fejl under behandling:", err);
    captureRouteError(err, {
      route: "/api/webhooks/google-play",
      type: "webhook",
    });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
