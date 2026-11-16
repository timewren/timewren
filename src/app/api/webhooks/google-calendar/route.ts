import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarConnections } from "@/lib/db/schema";
import { verifyCalendarChannelToken } from "@/lib/integrations/calendar-webhook-token";
import { syncCalendarEvents } from "@/lib/integrations/google-calendar";

/**
 * Google Calendar Push Notification webhook handler.
 *
 * When a user's calendar changes, Google POSTs a notification to this endpoint.
 * We look up the connection by channel ID and trigger an incremental sync.
 *
 * Headers sent by Google:
 * - X-Goog-Channel-ID: the channel ID we registered
 * - X-Goog-Resource-ID: Google's resource ID
 * - X-Goog-Resource-State: "sync" (initial) | "exists" (change) | "not_exists"
 * - X-Goog-Channel-Expiration: expiration timestamp
 */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceState = req.headers.get("x-goog-resource-state");
  const channelToken = req.headers.get("x-goog-channel-token");

  if (!channelId) {
    return NextResponse.json({ error: "Missing channel ID" }, { status: 400 });
  }

  // Channel ID format: "tt-cal-{connectionId}" — look up the connection
  // first so we can verify against its per-channel token.
  const connectionId = channelId.replace("tt-cal-", "");
  const connection = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.id, connectionId),
      eq(calendarConnections.provider, "google"),
    ),
  });

  if (!connection) {
    // Channel might be for a disconnected user — just 200 OK to stop retries
    return NextResponse.json({ ok: true });
  }

  // Verify the channel token against the connection-specific token hash (set
  // on registration, #713). The daily `calendar-webhook-renew` cron
  // re-registers channels with a fresh (hashed) token.
  if (!verifyCalendarChannelToken(channelToken, connection)) {
    console.warn(
      `[Calendar Webhook] Rejected channel ${channelId} — missing/invalid token`,
    );
    return NextResponse.json({ ok: true, ignored: "invalid_token" });
  }

  // "sync" is the initial verification — just acknowledge
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true });
  }

  if (!connection.syncEnabled) {
    return NextResponse.json({ ok: true });
  }

  // Trigger incremental sync for this user
  try {
    await syncCalendarEvents(connection.userId);
  } catch (err) {
    console.error(
      `[Webhook] Sync failed for connection ${connection.id}:`,
      err,
    );
    // Still return 200 to prevent Google from disabling the channel
  }

  return NextResponse.json({ ok: true });
}

// Google also sends a GET for verification in some cases
export async function GET() {
  return NextResponse.json({ status: "Calendar webhook endpoint active" });
}
