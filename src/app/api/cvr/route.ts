import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import {
  type CvrLookupErrorKind,
  isCvrLookupError,
  lookupCVR,
  searchCVR,
} from "@/lib/integrations/cvr";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";

const CVR_HTTP_STATUS: Record<CvrLookupErrorKind, number> = {
  invalid: 400,
  not_found: 404,
  rate_limited: 429,
  timeout: 504,
  unavailable: 502,
};

/** Forventede cvrapi.dk-fejl får en dansk besked, som klienten viser direkte. */
function cvrErrorResponse(error: unknown, fallback: string) {
  if (isCvrLookupError(error)) {
    return NextResponse.json(
      { error: error.message },
      { status: CVR_HTTP_STATUS[error.kind] },
    );
  }
  console.error("CVR lookup error:", error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  // Require authentication
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Apply rate limiting
  const ip = getClientIp(request.headers);
  const rateLimitKey = ipRateLimitKey(ip, "cvr");
  const rateCheck = await rateLimiter.check(rateLimitKey, "cvr");

  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.tooManyRequestsLater") },
      { status: 429 },
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("query");
  const cvrNumber = searchParams.get("cvr");

  // Support both ?query= (smart search) and ?cvr= (legacy exact lookup)
  if (query) {
    if (query.length < 2) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.cvr.queryMin2") },
        { status: 400 },
      );
    }

    try {
      // searchCVR cacher selv svaret i Valkey i et døgn.
      const company = await searchCVR(query);

      if (!company) {
        return NextResponse.json(
          { error: await tr("serverErrors", "api.cvr.noCompany") },
          { status: 404 },
        );
      }

      return NextResponse.json(company);
    } catch (error) {
      return cvrErrorResponse(
        error,
        await tr("serverErrors", "api.cvr.searchFailed"),
      );
    }
  }

  if (!cvrNumber) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.cvr.numberOrQueryRequired") },
      { status: 400 },
    );
  }

  // Clean CVR number (remove spaces and dashes)
  const cleanCVR = cvrNumber.replace(/[\s-]/g, "");

  if (!/^\d{8}$/.test(cleanCVR)) {
    return NextResponse.json(
      { error: await tr("serverErrors", "api.cvr.eightDigits") },
      { status: 400 },
    );
  }

  try {
    // lookupCVR cacher selv svaret i Valkey i et døgn.
    const company = await lookupCVR(cleanCVR);

    if (!company) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.cvr.noCompanyForNumber") },
        { status: 404 },
      );
    }

    return NextResponse.json(company);
  } catch (error) {
    return cvrErrorResponse(
      error,
      await tr("serverErrors", "api.cvr.lookupFailed"),
    );
  }
}
