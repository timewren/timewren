import { and, eq } from "drizzle-orm";
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
 * POST /api/desktop/license/deactivate
 *
 * Deactivate a device from a license, freeing up a device slot.
 *
 * Body: {
 *   licenseKey: "TT-XXXX-XXXX-XXXX-XXXX",
 *   machineId: "..."
 * }
 *
 * Returns: { success: true, devicesRemaining: number }
 */
export async function POST(request: Request) {
  const demo = demoUnavailableResponse();
  if (demo) return demo;
  // Uden login: throttle pr. IP, så nøgler ikke kan afprøves i bulk (#1103).
  const limit = await rateLimiter.check(
    ipRateLimitKey(getClientIp(request.headers), "desktopLicense"),
    "desktopLicense",
  );
  if (!limit.allowed) return rateLimitResponse();

  try {
    const body = await request.json();
    const { licenseKey, machineId } = body as {
      licenseKey?: string;
      machineId?: string;
    };

    if (!licenseKey || !machineId) {
      return NextResponse.json(
        { error: "licenseKey and machineId are required" },
        { status: 400 },
      );
    }

    // Look up license
    const license = await db.query.desktopLicenses.findFirst({
      where: eq(desktopLicenses.licenseKey, licenseKey),
    });

    // A licence only works on its own brand's host (TT- on TimeTrack, TW- on
    // TimeWren); anywhere else it is "not found", so keys do not leak.
    if (
      !license ||
      !licenseMatchesHost(license.licenseKey, request.headers.get("host"))
    ) {
      return NextResponse.json(
        { error: "Invalid license key" },
        { status: 404 },
      );
    }

    if (!license.userId) {
      return NextResponse.json(
        { error: "License is not assigned to a user" },
        { status: 400 },
      );
    }

    // Find and remove the device
    const device = await db.query.desktopDevices.findFirst({
      where: and(
        eq(desktopDevices.userId, license.userId),
        eq(desktopDevices.machineId, machineId),
      ),
    });

    if (!device) {
      return NextResponse.json(
        { error: "Device not found for this license" },
        { status: 404 },
      );
    }

    // Delete the device registration
    await db.delete(desktopDevices).where(eq(desktopDevices.id, device.id));

    // Count remaining devices
    const remaining = await db
      .select({ id: desktopDevices.id })
      .from(desktopDevices)
      .where(eq(desktopDevices.userId, license.userId));

    return NextResponse.json({
      success: true,
      devicesRemaining: remaining.length,
      devicesAllowed: license.maxDevices,
    });
  } catch (error) {
    console.error("[Desktop License Deactivate] Error:", error);
    return NextResponse.json(
      { error: "Device deactivation failed" },
      { status: 500 },
    );
  }
}
