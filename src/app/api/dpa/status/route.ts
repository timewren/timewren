import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentDpaAcceptance } from "@/lib/enterprise/dpa/accept";
import { DPA_VERSION } from "@/lib/enterprise/dpa/content";
import {
  blockedByTwoFactor,
  resolveDpaViewer,
} from "@/lib/enterprise/dpa/filled";

/**
 * GET /api/dpa/status: hvad den besøgende kan på /databehandleraftale.
 * Holder selve siden statisk; kun denne lille forespørgsel læser sessionen.
 * Acceptdata vises kun for ejere og administratorer (med 2FA, hvis org'en
 * kræver det).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type DpaStatusResponse = {
  viewer: "anonymous" | "no-org" | "member" | "admin" | "admin-2fa";
  version: string;
  acceptance: { acceptedAt: string; name: string; version: string } | null;
};

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await resolveDpaViewer(
    db,
    session as unknown as Record<string, unknown> | null,
  );
  let acceptance: DpaStatusResponse["acceptance"] = null;
  let kind: DpaStatusResponse["viewer"] = viewer.kind;
  // Kræver org'en 2FA, og mangler administratoren det, vises hverken
  // acceptdata eller den udfyldte PDF (samme regel som /api/dpa/pdf/udfyldt).
  if (
    viewer.kind === "admin" &&
    (await blockedByTwoFactor(db, viewer.orgId, viewer.userId))
  ) {
    kind = "admin-2fa";
  } else if (viewer.kind === "admin") {
    const row = await currentDpaAcceptance(db, viewer.orgId);
    if (row) {
      acceptance = {
        acceptedAt: row.acceptedAt.toISOString(),
        name: row.acceptedByName?.trim() || row.acceptedByEmail,
        version: row.version,
      };
    }
  }
  const body: DpaStatusResponse = {
    viewer: kind,
    version: DPA_VERSION,
    acceptance,
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
