import { NextResponse } from "next/server";
import { isWatchFresh, WATCH_STALE_AFTER_MINUTES } from "@/lib/health/summary";

export const dynamic = "force-dynamic";

/**
 * Dead-man's switch for stabilitetsvagten. Vagtens egen cron_stale-
 * detektor kan ikke opdage, at vagten selv (eller hele cron-sidecaren) er
 * død — det skal en ekstern uptime-check gøre: 200 når stability-watch har
 * kørt inden for 45 min, ellers 503. Ingen detaljer ud over alderen.
 * Bruges ikke af Docker-healthcheck'et (det er /api/health).
 */
export async function GET() {
  const now = new Date();
  try {
    const [{ db }, { queryLastWatchAttempt }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/stability/queries"),
    ]);
    const lastRun = await queryLastWatchAttempt(db);
    const fresh = isWatchFresh(lastRun, now);
    return NextResponse.json(
      {
        status: fresh ? "ok" : "stale",
        lastRunAgeSeconds: lastRun
          ? Math.round((now.getTime() - lastRun.getTime()) / 1000)
          : null,
        staleAfterMinutes: WATCH_STALE_AFTER_MINUTES,
      },
      { status: fresh ? 200 : 503 },
    );
  } catch (error) {
    console.error("[Health/watch] Check failed:", error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
