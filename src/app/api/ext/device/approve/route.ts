import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { resolvePrimaryOrgId } from "@/lib/auth/active-org";
import { getAppUrl } from "@/lib/config";
import { db } from "@/lib/db";
import { deviceAuthCodes, members } from "@/lib/db/schema";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";
import {
  cleanDeviceLabel,
  DEVICE_CLIENT_KINDS,
  DEVICE_CODE_TTL_MS,
  type DeviceClientKind,
  deviceCallbackUrl,
  generateDeviceCode,
  isValidCodeChallenge,
  isValidDeviceId,
  isValidState,
} from "@/lib/device-login";
import { hashToken } from "@/lib/security/token-hash";

/**
 * POST /api/ext/device/approve
 *
 * Kaldes fra /auth/device, når den indloggede bruger godkender en enhed.
 * Laver en engangskode bundet til `state`, PKCE-challenge og enheds-id og
 * svarer med deep linket, som siden sender browseren videre til. Selve
 * tokenet udstedes først, når appen veksler koden med sin verifier
 * (extension.device.exchangeCode), så det aldrig står i en URL.
 *
 * Body: { state, codeChallenge, deviceId, deviceName?, os?, kind?, organizationId? }
 * Svar: { redirectUrl: "timetrack://auth/callback?code=…&state=…" }
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`ext-device-approve:${ip}`, 10, 60_000))) {
    return rateLimitResponse();
  }

  // Kun fra web-appens egen side: en fremmed side må ikke kunne udløse en
  // godkendelse med brugerens cookie (SameSite=Lax er første forsvar).
  const origin = request.headers.get("origin");
  if (origin && !isSameOrigin(origin, request)) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.invalidOrigin") },
      { status: 403 },
    );
  }

  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.notAuthorized") },
        { status: 401 },
      );
    }
    const userId = session.user.id;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.invalidRequest") },
        { status: 400 },
      );
    }

    const { state, codeChallenge, deviceId } = body;
    if (
      !isValidState(state) ||
      !isValidCodeChallenge(codeChallenge) ||
      !isValidDeviceId(deviceId)
    ) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.ext.invalidLoginLink") },
        { status: 400 },
      );
    }
    const kind: DeviceClientKind = DEVICE_CLIENT_KINDS.includes(
      body.kind as DeviceClientKind,
    )
      ? (body.kind as DeviceClientKind)
      : "desktop";

    // Org: den valgte, hvis brugeren er medlem; ellers primær-orgen.
    let organizationId: string | null = null;
    if (typeof body.organizationId === "string" && body.organizationId) {
      const membership = await db.query.members.findFirst({
        where: and(
          eq(members.userId, userId),
          eq(members.organizationId, body.organizationId),
        ),
        columns: { organizationId: true },
      });
      if (!membership) {
        return NextResponse.json(
          { error: await tr("serverErrors", "api.notMemberOfChosenOrg") },
          { status: 403 },
        );
      }
      organizationId = membership.organizationId;
    } else {
      organizationId = await resolvePrimaryOrgId({ db, userId });
    }

    const code = generateDeviceCode();
    await db.insert(deviceAuthCodes).values({
      codeHash: hashToken(code),
      userId,
      organizationId,
      state,
      codeChallenge,
      deviceId,
      deviceName: cleanDeviceLabel(body.deviceName, 255),
      deviceOs: cleanDeviceLabel(body.os, 50),
      clientKind: kind,
      expiresAt: new Date(Date.now() + DEVICE_CODE_TTL_MS),
    });

    return NextResponse.json({ redirectUrl: deviceCallbackUrl(code, state) });
  } catch (error) {
    console.error("[ext device approve] error:", error);
    return NextResponse.json(
      { error: await tr("serverErrors", "api.approvalFailed") },
      { status: 500 },
    );
  }
}

function isSameOrigin(origin: string, request: Request): boolean {
  try {
    const o = new URL(origin);
    if (o.origin === new URL(getAppUrl()).origin) return true;
    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return !!host && o.host === host;
  } catch {
    return false;
  }
}
