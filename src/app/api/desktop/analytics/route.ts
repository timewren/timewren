import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { desktopAnalytics } from "@/lib/db/schema";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";

/**
 * POST /api/desktop/analytics
 *
 * Receives anonymous usage events from the desktop app.
 * No PII, no user identification, no validation of sender.
 * Used to understand feature usage and prioritize development.
 */
export async function POST(request: Request) {
  // Rate limit: 60 requests per minute per IP
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`analytics:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = await request.json();
    const { event, properties, app_version, platform, language } = body as {
      event?: string;
      properties?: Record<string, unknown>;
      app_version?: string;
      platform?: string;
      language?: string;
      timestamp?: string;
    };

    if (!event || typeof event !== "string") {
      return NextResponse.json({ error: "event is required" }, { status: 400 });
    }

    // Limit event name length
    const sanitizedEvent = event.slice(0, 100);

    await db.insert(desktopAnalytics).values({
      event: sanitizedEvent,
      properties: properties ?? null,
      appVersion: app_version?.slice(0, 20) ?? null,
      platform: platform?.slice(0, 50) ?? null,
      language: language?.slice(0, 10) ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Desktop Analytics] Error:", error);
    return NextResponse.json(
      { error: "Failed to record event" },
      { status: 500 },
    );
  }
}
