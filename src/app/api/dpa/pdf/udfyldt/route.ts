import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadFilledDpa } from "@/lib/enterprise/dpa/filled";
import { filledAccessForSession, pdfHeaders } from "@/lib/enterprise/dpa/http";
import { dpaPdfFilename } from "@/lib/enterprise/dpa/meta";
import { renderDpaPdf } from "@/lib/enterprise/dpa/pdf";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";

/**
 * GET /api/dpa/pdf/udfyldt: aftalen udfyldt med den aktive organisations
 * navn, CVR og accept. Kun ejere og administratorer. Organisationen tages
 * fra sessionen, aldrig fra URL'en. Renderes pr. forespørgsel og caches ikke.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  const access = await filledAccessForSession(
    db,
    session as unknown as Record<string, unknown> | null,
  );
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.status, headers: { "Cache-Control": NO_STORE } },
    );
  }

  const limit = await rateLimiter.check(
    userRateLimitKey(access.userId, "dpaPdfFilled"),
    "dpaPdfFilled",
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.tooManyRequestsLater") },
      {
        status: 429,
        headers: {
          "Cache-Control": NO_STORE,
          "Retry-After": String(Math.ceil(limit.resetIn / 1000)),
        },
      },
    );
  }

  try {
    const data = await loadFilledDpa(db, access.orgId);
    const pdf = await renderDpaPdf(data);
    return new NextResponse(new Uint8Array(pdf), {
      headers: pdfHeaders(dpaPdfFilename(true), NO_STORE),
    });
  } catch (error) {
    console.error("[dpa-pdf] udfyldt render fejlede", error);
    return NextResponse.json(
      { error: await tr("serverErrors", "api.dpa.pdfFailed") },
      { status: 500, headers: { "Cache-Control": NO_STORE } },
    );
  }
}
