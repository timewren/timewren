import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  desktopDevices,
  desktopLicenseDevices,
  desktopLicenses,
} from "@/lib/db/schema";
import { demoUnavailableResponse } from "@/lib/demo/route-guard";
import { signLicenseProof } from "@/lib/desktop-auth";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";

/**
 * POST /api/desktop/license/activate
 *
 * Activate a license key for a device.
 *
 * Body: {
 *   licenseKey: "TT-XXXX-XXXX-XXXX-XXXX",
 *   machineId: "...",
 *   deviceName?: "...",
 *   os?: "windows" | "macos" | "linux"
 * }
 *
 * Returns: {
 *   proof: {
 *     license_key, tier, valid_until, devices_allowed, issued_at, signature
 *   }
 * }
 */
export async function POST(request: Request) {
  const demo = demoUnavailableResponse();
  if (demo) return demo;
  // Rate limit: 5 requests per minute per IP
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`license-activate:${ip}`, 5, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = await request.json();
    const { licenseKey, machineId, deviceName, os } = body as {
      licenseKey?: string;
      machineId?: string;
      deviceName?: string;
      os?: string;
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

    if (!license) {
      return NextResponse.json(
        { error: "Invalid license key" },
        { status: 404 },
      );
    }

    if (!license.isActive) {
      return NextResponse.json(
        { error: "License has been deactivated" },
        { status: 403 },
      );
    }

    // Check expiry (null = lifetime, never expires)
    if (license.expiresAt && license.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "License has expired" },
        { status: 403 },
      );
    }

    // Enforce device count per license. This works for account-less lifetime
    // licenses too (userId is null, so the userId-keyed desktopDevices table
    // below would never track them — see anti-piracy note).
    const existingLicenseDevice =
      await db.query.desktopLicenseDevices.findFirst({
        where: and(
          eq(desktopLicenseDevices.licenseId, license.id),
          eq(desktopLicenseDevices.machineId, machineId),
        ),
      });

    if (existingLicenseDevice) {
      await db
        .update(desktopLicenseDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(desktopLicenseDevices.id, existingLicenseDevice.id));
    } else {
      const licenseDevices = await db
        .select({ id: desktopLicenseDevices.id })
        .from(desktopLicenseDevices)
        .where(eq(desktopLicenseDevices.licenseId, license.id));

      if (licenseDevices.length >= license.maxDevices) {
        return NextResponse.json(
          {
            error: `Maximum devices reached (${license.maxDevices}). Deactivate a device first.`,
            devicesUsed: licenseDevices.length,
            devicesAllowed: license.maxDevices,
          },
          { status: 403 },
        );
      }

      await db.insert(desktopLicenseDevices).values({
        licenseId: license.id,
        machineId,
        deviceName: deviceName ?? null,
        os: os ?? null,
        lastSeenAt: new Date(),
      });
    }

    // Check if this machineId is already registered for this license's user
    // (cloud-sync accounts also track devices in the userId-keyed table).
    if (license.userId) {
      const existingDevice = await db.query.desktopDevices.findFirst({
        where: and(
          eq(desktopDevices.userId, license.userId),
          eq(desktopDevices.machineId, machineId),
        ),
      });

      if (!existingDevice) {
        // Check device count
        const devices = await db
          .select({ id: desktopDevices.id })
          .from(desktopDevices)
          .where(eq(desktopDevices.userId, license.userId));

        if (devices.length >= license.maxDevices) {
          return NextResponse.json(
            {
              error: `Maximum devices reached (${license.maxDevices}). Deactivate a device first.`,
              devicesUsed: devices.length,
              devicesAllowed: license.maxDevices,
            },
            { status: 403 },
          );
        }

        // Register new device
        await db.insert(desktopDevices).values({
          userId: license.userId,
          machineId,
          deviceName: deviceName ?? null,
          os: os ?? null,
        });
      }
    }

    // Generate signed proof
    const issuedAt = new Date().toISOString();
    const validUntil = license.expiresAt
      ? license.expiresAt.toISOString()
      : null;

    const proofData = {
      license_key: license.licenseKey,
      tier: license.tier,
      valid_until: validUntil,
      devices_allowed: license.maxDevices,
      issued_at: issuedAt,
    };

    const signature = await signLicenseProof(proofData);

    return NextResponse.json({
      proof: {
        ...proofData,
        signature,
      },
    });
  } catch (error) {
    console.error("[Desktop License Activate] Error:", error);
    return NextResponse.json(
      { error: "License activation failed" },
      { status: 500 },
    );
  }
}
