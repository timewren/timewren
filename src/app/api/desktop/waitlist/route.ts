import { NextResponse } from "next/server";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { db } from "@/lib/db";
import { desktopWaitlist } from "@/lib/db/schema";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";

const waitlistSchema = z.object({
  email: z.string().email().max(255),
});

export async function POST(request: Request) {
  // Rate limit: 5 requests per minute per IP
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`waitlist:${ip}`, 5, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = await request.json();
    const { email } = waitlistSchema.parse(body);

    // Idempotent: ON CONFLICT DO NOTHING so duplicates don't error
    await db
      .insert(desktopWaitlist)
      .values({ email: email.toLowerCase().trim() })
      .onConflictDoNothing({ target: desktopWaitlist.email });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: await tr("serverErrors", "api.invalidEmail") },
        { status: 400 },
      );
    }
    console.error("[Desktop Waitlist] Error:", error);
    return NextResponse.json(
      { success: false, error: await tr("serverErrors", "api.genericError") },
      { status: 500 },
    );
  }
}
