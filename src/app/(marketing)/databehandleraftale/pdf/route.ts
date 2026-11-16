import { NextResponse } from "next/server";
import {
  generalDpaEtag,
  generalDpaPdf,
  pdfHeaders,
} from "@/lib/enterprise/dpa/http";
import { dpaPdfFilename } from "@/lib/enterprise/dpa/meta";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";

/**
 * GET /databehandleraftale/pdf: den generelle databehandleraftale som PDF,
 * med tomme felter til Kunden. Ingen login og ingen cookies i svaret, så den
 * må caches offentligt. Ligger bevidst uden for /api, hvor next.config sætter
 * no-store på alt. Den udfyldte ligger på /api/dpa/pdf/udfyldt (no-store).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const ip = getClientIp(request.headers);
  const limit = await rateLimiter.check(ipRateLimitKey(ip, "dpaPdf"), "dpaPdf");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange forespørgsler. Prøv igen senere." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.resetIn / 1000)) },
      },
    );
  }

  try {
    const [pdf, etag] = await Promise.all([generalDpaPdf(), generalDpaEtag()]);
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        ...pdfHeaders(
          dpaPdfFilename(false),
          "public, max-age=3600, s-maxage=86400",
        ),
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("[dpa-pdf] generel render fejlede", error);
    return NextResponse.json(
      { error: "PDF'en kunne ikke laves lige nu" },
      { status: 500 },
    );
  }
}
