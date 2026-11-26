import { randomInt } from "node:crypto";
import { errors, jwtVerify, SignJWT } from "jose";
import { NextResponse } from "next/server";
import type { BrandKey } from "@/lib/brands/registry";
import { licenseKeyPrefix } from "@/lib/desktop-license-brand";
import { getSigningSecret } from "@/lib/security/signing-secret";

const DEVICE_TOKEN_EXPIRY = "90d"; // 90-day token lifetime

export interface DeviceTokenPayload {
  userId: string;
  deviceId: string;
  tier: string;
}

/**
 * Generate a long-lived device token (90-day JWT) for desktop app authentication.
 */
export async function generateDeviceToken(
  userId: string,
  deviceId: string,
  tier: string,
): Promise<string> {
  return new SignJWT({ userId, deviceId, tier })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DEVICE_TOKEN_EXPIRY)
    .setSubject(userId)
    .sign(getSigningSecret());
}

/**
 * Verify and decode a device JWT token.
 * Throws if the token is invalid or expired.
 */
export async function verifyDeviceToken(
  token: string,
): Promise<DeviceTokenPayload> {
  const { payload } = await jwtVerify(token, getSigningSecret());
  const { userId, deviceId, tier } = payload as unknown as DeviceTokenPayload;

  if (!userId || !deviceId || !tier) {
    throw new Error("Invalid device token payload");
  }

  return { userId, deviceId, tier };
}

/**
 * Extract and verify device token from Authorization header.
 * Returns the decoded payload or throws.
 */
export async function authenticateDevice(
  request: Request,
): Promise<DeviceTokenPayload> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new DeviceAuthError(
      "missing_token",
      "Missing or invalid Authorization header",
    );
  }
  const token = auth.slice(7);
  // Manglende server-hemmelighed er en konfigurationsfejl (500), ikke et
  // ugyldigt token: kastes uden for try/catch, så den ikke bliver til 401.
  getSigningSecret();
  try {
    return await verifyDeviceToken(token);
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw new DeviceAuthError("token_expired", "Device token expired");
    }
    // Forkert signatur, vrøvl-token eller manglende felter i payload er alle
    // et login-problem, ikke en serverfejl.
    throw new DeviceAuthError("invalid_token", "Invalid device token", {
      cause: error,
    });
  }
}

/**
 * Kastes af `authenticateDevice` når klienten skal logge ind igen.
 * Ruterne svarer 401, som skrivebordsappen viser som "session udløbet".
 */
export class DeviceAuthError extends Error {
  constructor(
    readonly code: "missing_token" | "token_expired" | "invalid_token",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DeviceAuthError";
  }
}

/** 401-svar for en `DeviceAuthError`, ellers `null`. */
export function deviceAuthErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof DeviceAuthError)) return null;
  return NextResponse.json({ error: error.code }, { status: 401 });
}

/**
 * Generate a license key in the format TT-XXXX-XXXX-XXXX-XXXX (TW- for
 * TimeWren; the prefix is what scopes a licence to its brand, see
 * desktop-license-brand.ts).
 */
export function generateLicenseKey(brand: BrandKey = "timetrack"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I, O, 0, 1 to avoid confusion
  const segment = () => {
    let s = "";
    for (let i = 0; i < 4; i++) {
      s += chars[randomInt(chars.length)];
    }
    return s;
  };
  return `${licenseKeyPrefix(brand)}-${segment()}-${segment()}-${segment()}-${segment()}`;
}

/**
 * Sign a license proof for offline verification by the desktop app.
 * Uses HMAC-SHA256 with the server secret.
 */
export async function signLicenseProof(proof: {
  license_key: string;
  tier: string;
  valid_until: string | null;
  devices_allowed: number;
  issued_at: string;
}): Promise<string> {
  // Create a deterministic string from the proof fields
  const message = [
    proof.license_key,
    proof.tier,
    proof.valid_until ?? "lifetime",
    proof.devices_allowed.toString(),
    proof.issued_at,
  ].join("|");

  // Sign with HMAC-SHA256
  const key = await crypto.subtle.importKey(
    "raw",
    getSigningSecret(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );

  // Return base64url-encoded signature
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
