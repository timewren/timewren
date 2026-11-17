import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { desktopTrials } from "@/lib/db/schema";
import { demoUnavailableResponse } from "@/lib/demo/route-guard";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";
import { copenhagenToday } from "@/lib/time/copenhagen";

/**
 * POST /api/desktop/license/trial
 *
 * Register or check a machine-bound trial. If the machineId already
 * has a trial, returns the existing started_at date (preventing reset).
 * If no trial exists, creates one with today's date.
 *
 * Body: { machineId: string, os?: string }
 * Response: { started_at: "YYYY-MM-DD", days_remaining: number }
 */
export async function POST(request: Request) {
  const demo = demoUnavailableResponse();
  if (demo) return demo;
  // Rate limit: 3 requests per minute per IP
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`license-trial:${ip}`, 3, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = await request.json();
    const { machineId, os } = body as {
      machineId?: string;
      os?: string;
    };

    if (!machineId) {
      return NextResponse.json(
        { error: "machineId is required" },
        { status: 400 },
      );
    }

    // Check if trial already exists for this machine
    const existing = await db.query.desktopTrials.findFirst({
      where: eq(desktopTrials.machineId, machineId),
    });

    if (existing) {
      const startedAt = existing.startedAt;
      const daysRemaining = computeDaysRemaining(startedAt);

      return NextResponse.json({
        started_at: startedAt,
        days_remaining: daysRemaining,
      });
    }

    // Create new trial
    const today = copenhagenToday();

    await db.insert(desktopTrials).values({
      machineId,
      os: os ?? null,
      startedAt: today,
    });

    return NextResponse.json({
      started_at: today,
      days_remaining: 30,
    });
  } catch (error) {
    console.error("[Desktop Trial] Error:", error);
    return NextResponse.json({ error: "Trial check failed" }, { status: 500 });
  }
}

function computeDaysRemaining(startedAt: string): number {
  const started = new Date(startedAt);
  const now = new Date();
  const elapsed = Math.floor(
    (now.getTime() - started.getTime()) / (1000 * 60 * 60 * 24),
  );
  return Math.max(30 - elapsed, 0);
}
