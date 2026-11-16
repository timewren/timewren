import {
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAppleVerifier } from "@/lib/store-billing/apple";
import {
  handleAppleNotification,
  isStoreBillingEnabled,
} from "@/lib/store-billing/service";
import { captureRouteError } from "@/lib/utils/sentry";

/**
 * App Store Server Notifications V2 (køb i appen). Body: `{ signedPayload }`,
 * signeret af Apple og verificeret lokalt mod Apples rodcertifikater.
 * Idempotent via notificationUUID (store_billing_events) og ordnet via
 * signedDate. Svarer 200 når notifikationen er behandlet eller bevidst
 * ignoreret; 400 ved ugyldig signatur; 500 ved fejl (Apple leverer igen).
 * Mørk (404) indtil STORE_BILLING_ENABLED=1.
 *
 * Opsætning: App Store Connect → appen → App Information → App Store Server
 * Notifications → Version 2, Production + Sandbox URL
 * https://app.timetrack.dk/api/webhooks/app-store
 */
export async function POST(request: Request) {
  if (!isStoreBillingEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let signedPayload: unknown;
  try {
    signedPayload = ((await request.json()) as { signedPayload?: unknown })
      ?.signedPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof signedPayload !== "string" || !signedPayload) {
    return NextResponse.json(
      { error: "Missing signedPayload" },
      { status: 400 },
    );
  }

  try {
    const result = await handleAppleNotification(
      db,
      signedPayload,
      getAppleVerifier(),
    );
    console.warn(
      `[App Store Webhook] ${result.notificationType || "?"} → ${result.outcome}`,
      `event=${result.eventId ?? "n/a"} sub=${result.subscriptionId ?? "n/a"}`,
    );
    if (result.outcome === "account_mismatch") {
      captureRouteError(
        new Error("App Store-notifikation: konto matcher ikke"),
        {
          route: "/api/webhooks/app-store",
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
    if (
      err instanceof VerificationException &&
      err.status !== VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
    ) {
      console.error(
        `[App Store Webhook] Signaturen kunne ikke verificeres (status ${err.status})`,
      );
      captureRouteError(
        new Error(`App Store-notifikation afvist (status ${err.status})`),
        { route: "/api/webhooks/app-store", type: "webhook" },
      );
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    console.error("[App Store Webhook] Fejl under behandling:", err);
    captureRouteError(err, {
      route: "/api/webhooks/app-store",
      type: "webhook",
    });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
