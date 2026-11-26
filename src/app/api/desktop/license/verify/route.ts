import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { desktopDevices, desktopLicenses } from "@/lib/db/schema";
import { demoUnavailableResponse } from "@/lib/demo/route-guard";
import { licenseMatchesHost } from "@/lib/desktop-license-brand";
import { rateLimitResponse } from "@/lib/desktop-rate-limit";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";

/**
 * GET /api/desktop/license/verify?key=TT-XXXX-XXXX-XXXX-XXXX
 *
 * Verify a license key and return its status.
 *
 * Returns: {
 *   valid: boolean,
 *   tier: string,
 *   devicesUsed: number,
 *   devicesAllowed: number,
 *   expiresAt: string | null
 * }
 */
export async function GET(request: NextRequest) {
  const demo = demoUnavailableResponse();
  if (demo) return demo;
  // Uden login: throttle pr. IP, så nøgler ikke kan afprøves i bulk (#1103).
  const limit = await rateLimiter.check(
    ipRateLimitKey(getClientIp(request.headers), "desktopLicense"),
    "desktopLicense",
  );
  if (!limit.allowed) return rateLimitResponse();

  try {
    const key = request.nextUrl.searchParams.get("key");

    if (!key) {
      return NextResponse.json(
        { error: "key parameter is required" },
        { status: 400 },
      );
    }

    const license = await db.query.desktopLicenses.findFirst({
      where: eq(desktopLicenses.licenseKey, key),
    });

    // A licence only verifies on its own brand's host (TT- on TimeTrack, TW-
    // on TimeWren); anywhere else it is "not found".
    if (
      !license ||
      !licenseMatchesHost(license.licenseKey, request.headers.get("host"))
    ) {
      return NextResponse.json({
        valid: false,
        error: "License key not found",
      });
    }

    // Check if expired
    const expired = license.expiresAt ? license.expiresAt < new Date() : false;

    // Count devices
    let devicesUsed = 0;
    if (license.userId) {
      const devices = await db
        .select({ id: desktopDevices.id })
        .from(desktopDevices)
        .where(eq(desktopDevices.userId, license.userId));
      devicesUsed = devices.length;
    }

    return NextResponse.json({
      valid: license.isActive && !expired,
      tier: license.tier,
      devicesUsed,
      devicesAllowed: license.maxDevices,
      expiresAt: license.expiresAt?.toISOString() ?? null,
      isActive: license.isActive,
      isExpired: expired,
    });
  } catch (error) {
    console.error("[Desktop License Verify] Error:", error);
    return NextResponse.json(
      { error: "License verification failed" },
      { status: 500 },
    );
  }
}
