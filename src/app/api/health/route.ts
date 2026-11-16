import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { summarizeRealtime } from "@/lib/health/summary";

export const dynamic = "force-dynamic";

/** `?detail=1` kræver CRON_SECRET — detaljen koster et DB-opslag. */
function isAuthorizedForDetail(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  const expected = `Bearer ${secret}`;
  return (
    header.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}

export async function GET(request: Request) {
  const checks: Record<string, { status: string }> = {};

  // Check database connection — never expose error details publicly
  try {
    const { db } = await import("@/lib/db");
    await db.execute("SELECT 1");
    checks.database = { status: "ok" };
  } catch (error) {
    console.error("[Health] Database check failed:", error);
    checks.database = { status: "error" };
  }

  // Check auth module
  try {
    const { auth } = await import("@/lib/auth");
    checks.auth = { status: auth ? "ok" : "error" };
  } catch (error) {
    console.error("[Health] Auth check failed:", error);
    checks.auth = { status: "error" };
  }

  // Signeringshemmelighed: tokens kan ikke signeres uden (#1013). Kun
  // tilstedeværelse, aldrig værdien.
  checks.signing_secret = {
    status: process.env.BETTER_AUTH_SECRET ? "ok" : "error",
  };

  // Realtime: kun processens hukommelse (intet netværkskald). "degraded"
  // fælder IKKE health-checket — polling er reserven, og en container-
  // genstart pga. Valkey ville gøre ondt værre. Stabilitetsvagten alarmerer.
  const now = new Date();
  let realtime: ReturnType<typeof summarizeRealtime> | { status: "error" };
  try {
    const { getRealtimeStatus } = await import("@/lib/realtime");
    realtime = summarizeRealtime(getRealtimeStatus(), now);
  } catch (error) {
    console.error("[Health] Realtime check failed:", error);
    realtime = { status: "error" };
  }

  const hasErrors = Object.values(checks).some((c) => c.status === "error");

  let detail: Record<string, unknown> | undefined;
  const url = new URL(request.url);
  if (url.searchParams.has("detail") && isAuthorizedForDetail(request)) {
    try {
      const [{ db }, { queryCronLastRuns }, { summarizeCron }, sched] =
        await Promise.all([
          import("@/lib/db"),
          import("@/lib/stability/queries"),
          import("@/lib/health/summary"),
          import("@/lib/cron/expected-schedule"),
        ]);
      detail = {
        cron: summarizeCron(
          await queryCronLastRuns(db),
          sched.EXPECTED_INTERVAL_MINUTES,
          now,
        ),
      };
    } catch (error) {
      console.error("[Health] Detail check failed:", error);
      detail = { cron: { status: "error" } };
    }
  }

  return NextResponse.json(
    {
      status: hasErrors ? "unhealthy" : "healthy",
      timestamp: now.toISOString(),
      service: "timetrack",
      checks: { ...checks, realtime },
      ...(detail ? { detail } : {}),
    },
    { status: hasErrors ? 503 : 200 },
  );
}
