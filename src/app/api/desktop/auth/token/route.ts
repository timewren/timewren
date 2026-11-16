import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  accounts,
  desktopDevices,
  desktopLicenses,
  sessions,
  users,
} from "@/lib/db/schema";
import { generateDeviceToken } from "@/lib/desktop-auth";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";
import { findVerifiedOrgForEmail } from "@/lib/enterprise/sso/auto-join";

/**
 * better-auth gemmer scrypt-hashes ("salt:key") og kaster på andre formater.
 * En hash den ikke kan læse er et mislykket login, ikke en serverfejl.
 */
async function passwordMatches(hash: string, password: string) {
  try {
    return await verifyPassword({ hash, password });
  } catch {
    return false;
  }
}

/**
 * POST /api/desktop/auth/token
 *
 * Authenticate a desktop device and return a long-lived JWT.
 *
 * Body (option A — email/password):
 *   { email: string, password: string, machineId: string, deviceName?: string, os?: string }
 *
 * Body (option B — existing session token from browser):
 *   { sessionToken: string, machineId: string, deviceName?: string, os?: string }
 *
 * Returns:
 *   { token: string, user: { id, name, email }, tier: string, expiresAt: string }
 */
export async function POST(request: Request) {
  // Rate limit: 10 requests per minute per IP (brute-force protection)
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`auth-token:${ip}`, 10, 60_000))) {
    return rateLimitResponse();
  }
  try {
    const body = await request.json();
    const { machineId, deviceName, os } = body as {
      machineId?: string;
      deviceName?: string;
      os?: string;
    };

    if (!machineId) {
      return NextResponse.json(
        { error: "machineId is required" },
        { status: 400 },
      );
    }

    let userId: string;
    let userName: string;
    let userEmail: string;

    // Option A: email/password authentication
    if (body.email && body.password) {
      const user = await db.query.users.findFirst({
        where: eq(users.email, body.email),
      });
      if (!user) {
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 },
        );
      }

      if (user.banned) {
        return NextResponse.json(
          { error: "Account is suspended" },
          { status: 403 },
        );
      }

      // Find the credential account (providerId = "credential")
      const account = await db.query.accounts.findFirst({
        where: and(
          eq(accounts.userId, user.id),
          eq(accounts.providerId, "credential"),
        ),
      });

      if (!account?.password) {
        return NextResponse.json(
          {
            error:
              "No password set for this account. Use session token authentication instead.",
          },
          { status: 400 },
        );
      }

      // better-auths egen verifikation: hashene er scrypt, ikke bcrypt (#935).
      const valid = await passwordMatches(account.password, body.password);
      if (!valid) {
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 },
        );
      }

      // Samme politikker som web-login, ellers er ruten en omvej uden om dem.
      // Tjekkes først efter adgangskoden, så kontoens tilstand ikke afsløres.
      if (user.twoFactorEnabled) {
        return NextResponse.json(
          {
            error:
              "Two-factor authentication is enabled. Sign in via the browser instead.",
            code: "two_factor_required",
          },
          { status: 403 },
        );
      }

      if (!user.emailVerified) {
        return NextResponse.json(
          { error: "Email not verified", code: "email_not_verified" },
          { status: 403 },
        );
      }

      // Kun-SSO (E12, #470) håndhæves kun når Microsoft-login er sat op, som
      // i auth.ts' before-hook.
      if (
        process.env.MICROSOFT_CLIENT_ID &&
        process.env.MICROSOFT_CLIENT_SECRET
      ) {
        const match = await findVerifiedOrgForEmail(db, user.email);
        if (match?.requireSsoForDomains) {
          return NextResponse.json(
            {
              error: "Your organization requires Microsoft sign-in.",
              code: "sso_required",
            },
            { status: 403 },
          );
        }
      }

      userId = user.id;
      userName = user.name;
      userEmail = user.email;
    }
    // Option B: session token authentication
    else if (body.sessionToken) {
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.token, body.sessionToken),
      });

      if (!session || session.expiresAt < new Date()) {
        return NextResponse.json(
          { error: "Invalid or expired session token" },
          { status: 401 },
        );
      }

      const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
      });

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 401 });
      }

      if (user.banned) {
        return NextResponse.json(
          { error: "Account is suspended" },
          { status: 403 },
        );
      }

      userId = user.id;
      userName = user.name;
      userEmail = user.email;
    } else {
      return NextResponse.json(
        {
          error:
            "Provide either { email, password } or { sessionToken } for authentication",
        },
        { status: 400 },
      );
    }

    // Check if user has an active desktop license
    const license = await db.query.desktopLicenses.findFirst({
      where: and(
        eq(desktopLicenses.userId, userId),
        eq(desktopLicenses.isActive, true),
      ),
    });

    // Default tier if no license found (free tier / trial)
    const tier = license?.tier ?? "free";

    // Find or create device registration
    let device = await db.query.desktopDevices.findFirst({
      where: and(
        eq(desktopDevices.userId, userId),
        eq(desktopDevices.machineId, machineId),
      ),
    });

    if (!device) {
      // If license exists, check device count
      if (license) {
        const deviceCount = await db
          .select({ id: desktopDevices.id })
          .from(desktopDevices)
          .where(eq(desktopDevices.userId, userId));

        if (deviceCount.length >= license.maxDevices) {
          return NextResponse.json(
            {
              error: `Maximum devices reached (${license.maxDevices}). Deactivate a device first.`,
              devicesUsed: deviceCount.length,
              devicesAllowed: license.maxDevices,
            },
            { status: 403 },
          );
        }
      }

      const [newDevice] = await db
        .insert(desktopDevices)
        .values({
          userId,
          machineId,
          deviceName: deviceName ?? null,
          os: os ?? null,
        })
        .returning();
      device = newDevice;
    } else {
      // Update device info if provided
      if (deviceName || os) {
        await db
          .update(desktopDevices)
          .set({
            ...(deviceName ? { deviceName } : {}),
            ...(os ? { os } : {}),
          })
          .where(eq(desktopDevices.id, device.id));
      }
    }

    // Generate 90-day JWT
    const token = await generateDeviceToken(userId, device.id, tier);

    // Calculate expiry (90 days from now)
    const expiresAt = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    return NextResponse.json({
      token,
      user: {
        id: userId,
        name: userName,
        email: userEmail,
      },
      tier,
      deviceId: device.id,
      expiresAt,
    });
  } catch (error) {
    console.error("[Desktop Auth] Token error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 },
    );
  }
}
